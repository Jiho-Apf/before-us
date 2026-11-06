// Edge 함수 시험 껍데기(GPT 3차 검수 R3-13·15·18·20): Deno에서 도는 함수 원본(index.ts)을 Node에서 그대로 실행한다.
//  - Deno.serve / Deno.env / Deno.connectTls 를 흉내 내고, `npm:@supabase/supabase-js` 를 가짜 클라이언트(fake-supabase.mjs)로 바꿔 끼운다.
//  - 가짜 클라이언트는 실제 SQL 함수를 PGlite(또는 실제 PostgreSQL 연결)에 그대로 부른다(service_role · 로그인 회원 역할로).
//  - Storage는 storage.objects 줄 + 메모리 속 바이트(가짜)로 흉내 낸다. 실제 Storage API·실제 메일·실제 네트워크에는 닿지 않는다.
// 사용: const edge = await startEdge({ until }) → const handler = await edge.load(파일 경로) → await handler(new Request(...))
import { registerHooks } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
export const repo = join(here, "..", "..", "..")
const fake = pathToFileURL(join(here, "fake-supabase.mjs")).href
let hooked = false
let seq = 0 // 불러온 함수 원본마다 새 주소(같은 파일도 다시 실행되게)
function hook() {
  if (hooked) return
  hooked = true
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith("npm:@supabase/supabase-js")) return { url: fake, shortCircuit: true }
      return next(specifier, context)
    },
  })
}

export const SERVICE_KEY = "service-key-for-tests"
export const ANON_KEY = "anon-key-for-tests"

// PGlite에 Supabase 흉내 + 마이그레이션(예약 작업 파일 제외). until: 이 이름부터는 빼고 올린다(예전 DB 재현)
export async function freshDb({ until } = {}) {
  const { PGlite } = await import("@electric-sql/pglite")
  const db = new PGlite()
  await db.exec(readFileSync(join(repo, "supabase/tests/db.test.mjs"), "utf8").match(/await db\.exec\(`([\s\S]*?)`\)/)[1])
  for (const file of readdirSync(join(repo, "supabase/migrations")).sort()) {
    if (file.includes("schedules") || (until && file >= until)) continue
    await db.exec(readFileSync(join(repo, "supabase/migrations", file), "utf8"))
  }
  await db.exec("delete from public.cohorts where number = 0")
  return db
}

export async function startEdge(options = {}) {
  hook()
  const db = options.db ?? await freshDb(options)
  const state = {
    db,
    env: { SUPABASE_URL: "http://supabase.test", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY, ...(options.env ?? {}) },
    handler: null,
    bytes: new Map(), // `${bucket}/${path}` → Uint8Array (가짜 파일 바이트)
    storageFail: null, // (op, bucket, paths) => 오류 문장 | null
    beforeRpc: null, // async (name, args) · 기다리게 하거나 throw 해서 ‘작업이 멈춤’을 흉내 낸다
    beforeQuery: null, // async (table, op)
    beforeStorage: null, // async (op, bucket, paths)
    rpcError: null, // (name, args) => 오류 문장 | null
    calls: [],
    connectTls: null,
  }
  globalThis.__FLAVIE_EDGE__ = state
  globalThis.Deno = {
    serve: (handler) => { state.handler = handler },
    env: { get: (name) => state.env[name] },
    connectTls: (opts) => { if (!state.connectTls) throw new Error("connectTls 흉내가 없어요"); return state.connectTls(opts) },
  }
  return {
    state, db,
    // 같은 파일을 여러 번 불러도 새로 실행되게 주소 뒤에 번호를 붙인다
    load: async (file) => { state.handler = null; await import(`${pathToFileURL(file).href}?v=${++seq}`); if (!state.handler) throw new Error(`Deno.serve가 불리지 않았어요: ${file}`); return state.handler },
    // 시험 쪽 SQL도 함수 실행과 같은 줄에 서서(트랜잭션이 섞이지 않게) postgres 권한으로 돈다
    q: async (sql, params = []) => { const { serial } = await import(fake); return serial(async () => (await db.query(sql, params)).rows) },
  }
}

// 오래된 함수 원본을 시험용 고정 파일로 남겨 둔 것(fixtures/) 경로
export const fixture = (name) => join(here, "fixtures", name)
