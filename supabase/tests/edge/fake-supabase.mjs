// 가짜 `npm:@supabase/supabase-js`(시험 전용). harness.mjs 가 Edge 함수의 import 를 이 파일로 돌린다.
// rpc · from(표).insert/delete/select · storage.from(버킷).remove/createSignedUrl/download 만 흉내 낸다.
// 요청 하나 = 트랜잭션 하나(PostgREST와 같게). 오류는 { data: null, error: { message } } 로 돌려준다.
const S = () => globalThis.__FLAVIE_EDGE__

function roleOf(key, headers) {
  if (key === S().env.SUPABASE_SERVICE_ROLE_KEY) return { role: "service_role" }
  const auth = headers?.Authorization ?? headers?.authorization ?? ""
  const sub = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  return sub && /^[0-9a-f-]{36}$/.test(sub) ? { role: "authenticated", sub } : { role: "anon" }
}

// 연결 하나(PGlite)를 여러 함수 실행이 나눠 쓰므로, 요청 하나(트랜잭션)씩 차례로 돈다.
let chain = Promise.resolve()
export function serial(fn) {
  const next = chain.then(fn)
  chain = next.catch(() => {})
  return next
}
const run = (who, fn) => serial(() => runNow(who, fn))
async function runNow(who, fn) {
  const db = S().db
  await db.query("begin")
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(who.sub ? { sub: who.sub, role: who.role, aal: "aal1" } : { role: who.role })])
    await db.query(`set local role ${who.role}`)
    const out = await fn(db)
    await db.query("commit")
    return { data: out, error: null }
  } catch (error) {
    await db.query("rollback").catch(() => {})
    return { data: null, error: { message: String(error?.message ?? error) } }
  }
}

const cache = new WeakMap() // DB마다 따로(예전 DB·새 DB를 한 시험에서 함께 쓰므로)
async function procOf(name) {
  if (!cache.has(S().db)) cache.set(S().db, new Map())
  const procs = cache.get(S().db)
  if (procs.has(name)) return procs.get(name)
  const rows = (await S().db.query("select proargnames, proretset, prorettype::regtype::text t from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [name])).rows
  procs.set(name, rows)
  return rows
}

class Query {
  constructor(who, table) { this.who = who; this.table = table; this.filters = []; this.op = null }
  insert(row) { this.op = { kind: "insert", row }; return this }
  delete() { this.op = { kind: "delete" }; return this }
  select(cols, opts = {}) { if (!this.op) this.op = { kind: "select", cols, opts }; return this }
  eq(col, value) { this.filters.push([col, "=", value]); return this }
  gt(col, value) { this.filters.push([col, ">", value]); return this }
  in(col, values) { this.filters.push([col, "= any", values]); return this }
  then(resolve, reject) { return this.exec().then(resolve, reject) }
  async exec() {
    S().calls.push({ table: this.table, op: this.op.kind })
    if (S().beforeQuery) await S().beforeQuery(this.table, this.op.kind)
    const params = []
    const where = this.filters.map(([col, op, value]) => { params.push(value); return op === "= any" ? `"${col}" = any($${params.length})` : `"${col}" ${op} $${params.length}` })
    const clause = where.length ? ` where ${where.join(" and ")}` : ""
    return run(this.who, async (db) => {
      if (this.op.kind === "insert") {
        const cols = Object.keys(this.op.row)
        await db.query(`insert into public."${this.table}" (${cols.map((c) => `"${c}"`).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, cols.map((c) => this.op.row[c]))
        return null
      }
      if (this.op.kind === "delete") { await db.query(`delete from public."${this.table}"${clause}`, params); return null }
      return (await db.query(`select * from public."${this.table}"${clause}`, params)).rows
    }).then((result) => {
      if (this.op.kind !== "select" || result.error) return result
      return { data: this.op.opts?.head ? null : result.data, error: null, ...(this.op.opts?.count ? { count: result.data.length } : {}) }
    })
  }
}

export function createClient(_url, key, options = {}) {
  const who = roleOf(key, options.global?.headers)
  return {
    async rpc(name, args = {}) {
      S().calls.push({ rpc: name, args })
      if (S().beforeRpc) await S().beforeRpc(name, args) // 멈춰 두거나(약속을 늦게 풂) throw 해서 ‘작업이 멈춤’을 흉내 낸다
      const injected = S().rpcError?.(name, args) // DB 오류 흉내(문장을 돌려주면 그 오류로 답한다)
      if (injected) return { data: null, error: { message: injected } }
      const candidates = await procOf(name)
      const keys = Object.keys(args)
      const proc = candidates.find((p) => keys.every((k) => (p.proargnames ?? []).includes(k)))
      if (!proc) return { data: null, error: { message: `Could not find the function public.${name}` } }
      const params = keys.map((k) => { const v = args[k]; return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v })
      const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`
      return run(who, async (db) => {
        if (proc.proretset) return (await db.query(`select * from ${call}`, params)).rows
        const value = (await db.query(`select ${call} as v`, params)).rows[0]?.v
        return value === undefined ? null : value
      })
    },
    from(table) { return new Query(who, table) },
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            S().calls.push({ storage: "remove", bucket, paths })
            if (S().beforeStorage) await S().beforeStorage("remove", bucket, paths)
            const failed = S().storageFail?.("remove", bucket, paths)
            if (failed) return { data: null, error: { message: failed } }
            await S().db.query("delete from storage.objects where bucket_id = $1 and name = any($2)", [bucket, paths])
            for (const p of paths) S().bytes.delete(`${bucket}/${p}`)
            return { data: paths.map((name) => ({ name })), error: null }
          },
          async createSignedUrl(path, seconds) {
            S().calls.push({ storage: "sign", bucket, path, seconds })
            const failed = S().storageFail?.("sign", bucket, [path])
            if (failed) return { data: null, error: { message: failed } }
            const n = (await S().db.query("select count(*)::int n from storage.objects where bucket_id = $1 and name = $2", [bucket, path])).rows[0].n
            return n ? { data: { signedUrl: `https://storage.test/sign/${bucket}/${path}?token=fake&ttl=${seconds}` }, error: null } : { data: null, error: { message: "Object not found" } }
          },
          async download(path) {
            S().calls.push({ storage: "download", bucket, path })
            const failed = S().storageFail?.("download", bucket, [path])
            if (failed) return { data: null, error: { message: failed } }
            const bytes = S().bytes.get(`${bucket}/${path}`)
            return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { message: "Object not found" } }
          },
        }
      },
    },
  }
}
export const SupabaseClient = class {}
