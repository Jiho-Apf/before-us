// R3-27 과제 흐름 시험: real-ui.mjs의 실제 SQL(PGlite) 하네스를 그대로 쓰고, 찍는 대신 할 일 완료·되돌아오기·위험 행동 취소·저장 실패를 확인해요.
// 실행: node scripts/checks/task-flows.mjs --base=http://localhost:8444 --out=결과.json  (가짜 자료만 써요)
// 실제 화면(로컬 개발 서버) × 실제 서버 함수(내 컴퓨터 안 PGlite에 마이그레이션 전부)를 잇는 하네스.
// 운영 서버에는 아무것도 보내지 않아요(supabase.co 요청은 모두 가로채 PGlite로 답해요). 가짜 회원·가짜 자료만 써요. 사진은 사람이 없는 풍경 사진으로 대신해요.
// 준비: 저장소에서 `pnpm install`(또는 npm), `npm i --no-save puppeteer-core@23.11.1`, live 모드 개발 서버(.claude/launch.json의 before-us-live, 8444)
// 실행: node scripts/checks/real-ui.mjs [이름 필터(|로 여럿)] --base=http://localhost:8444 --out=캡처폴더
//       점검만: --scan=결과.json [--safari]  (캡처 대신 4가지 폭에서 layout-scan.js·target-size.js를 돌려요)
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { args, loadPuppeteer, chromePath } from "./lib.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = join(HERE, "..", "..")
const opt = args({ base: "http://localhost:8444" })
const BASE = String(opt.base).replace(/\/$/, "")
const OUT = opt.out || process.env.CAPTURE_OUT || join(PROJECT, "..", "real-ui-captures")
const only = (opt._ ?? [])[0] ?? ""
const puppeteer = loadPuppeteer()
const { PGlite } = await import(pathToFileURL(join(PROJECT, "node_modules/@electric-sql/pglite/dist/index.js")).href)
const db = new PGlite()
const tests = readFileSync(join(PROJECT, "supabase/tests/db.test.mjs"), "utf8")
await db.exec(tests.match(/await db\.exec\(`([\s\S]*?)`\)/)[1])
for (const file of readdirSync(join(PROJECT, "supabase/migrations")).sort()) if (!file.includes("schedules")) await db.exec(readFileSync(join(PROJECT, "supabase/migrations", file), "utf8"))

let chain = Promise.resolve()
const locked = (fn) => (chain = chain.then(fn, fn))
async function run(who, sql, params = [], aal = "aal1") {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claims', $1, false)", [who ? JSON.stringify({ sub: who, role: "authenticated", aal }) : who === "" ? "" : JSON.stringify({ role: "anon" })])
  if (who !== "") await db.exec(`set role ${who ? "authenticated" : "anon"}`)
  try { return (await db.query(sql, params)).rows } finally { await db.exec("reset role") }
}
const sql = (who, text, params = [], aal) => locked(() => run(who, text, params, aal))
const pg = (text, params = []) => sql("", text, params)
const one = async (who, text, params = [], aal) => (await sql(who, text, params, aal))[0]
const clock = (iso) => locked(() => db.query("select set_config('app.now', $1, false)", [iso ?? ""]))
const at = async (date, time) => clock((await pg("select public.kst_at($1::date, $2::time)::text t", [date, time]))[0].t)
const plus = async (date, days) => (await pg("select ($1::date + $2::int)::text d", [date, days]))[0].d

// ── 가짜 회원
const ADMIN_EMAIL = "owner@example.test"
const signup = async (email) => (await pg("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, { adult: true, terms_version: "beta-2026-11-04", privacy_version: "beta-2026-11-04" }]))[0].id
const draft = (name, gender, desired, birth, phone, bio) => ({
  values: { "self.name": name, "self.birthDate": birth, "self.gender": gender, "desired.gender": desired, "self.province": "서울", "self.area": "마포구", "self.purpose": "천천히 알아가며 연애", "self.bio": bio, "self.statement": true, "self.pledge": true, "self.phone": phone, "self.notifyChannels": ["카카오톡", "메일"], "self.height": "170", "self.smoking": "안 함", "consent.collection": true, "consent.matching": true, "consent.provision": true, "consent.review": true, "consent.noon": true },
  sharing: { "self.name": true, "self.age": true, "self.province": true, "self.area": true, "self.purpose": true, "self.bio": true, "self.height": false, "self.smoking": true }, step: 3, visited: [0, 1, 2, 3],
})
const hex = (n) => n.toString(16).padStart(64, "0")
// 화면 확인용: 1기가 이미 시작된 것으로 둔다(정식 일정과 상관없이 소개를 예약할 수 있게).
await pg("update public.cohorts set starts_on = public.kst_today() - 1, application_deadline = public.kst_today() - 5 where number = 1")
const O = await signup(ADMIN_EMAIL)
await pg("insert into public.admin_roles (user_id, role) values ($1, 'owner')", [O])
async function member(email, name, gender, desired, base, phone, bio, { submit = true, approve = true } = {}) {
  const id = await signup(email)
  await sql(id, "select public.save_application_draft($1)", [draft(name, gender, desired, "1995-06-06", phone, bio)])
  for (const [i, slot] of ["photo.face", "photo.upper", "photo.style"].entries()) await sql(id, "select public.register_photo($1, $2, 'image/jpeg', 1000, 800, 1000, $3, true, true)", [slot, `${id}/${slot}-${i}.jpg`, hex(base + i)])
  if (!submit) return id
  await sql(id, "select public.submit_application()")
  if (!approve) return id
  for (const slot of ["photo.face", "photo.upper", "photo.style"]) await sql(O, "select public.admin_review_photo($1, $2, '기준 확인')", [id, slot], "aal2")
  await sql(O, "select public.admin_decide_application($1, 'approved')", [id], "aal2")
  await sql(O, "select public.admin_move_member_cohort($1, 1)", [id], "aal2")
  return id
}
const M = await member("nayeon@example.test", "나연", "여성", "남성", 100, "010-3101-0001", "쉬는 날엔 늦잠을 자고 오후에 도서관 창가 자리에서 책을 읽어요. 천천히 걷는 산책을 좋아해요.")
const P = await member("taeo@example.test", "태오", "남성", "여성", 200, "010-3101-0002", "토요일 아침마다 배드민턴을 치고 국밥을 먹어요. 말이 끊겨도 편한 대화를 좋아해요.")
const W = await member("jiwon@example.test", "지원", "여성", "남성", 300, "010-3101-0003", "퇴근길에 한 정거장 먼저 내려 걸어요.", { approve: false })
const D = await member("draft@example.test", "서아", "여성", "남성", 400, "010-3101-0004", "아직 쓰는 중이에요.", { submit: false })
const NAMES = { [M]: "나연", [P]: "태오", [W]: "지원", [D]: "서아", [O]: "운영진" }

// ── 화면 띄우기: supabase.co 요청을 가로채 이 DB에서 실행한다(RPC는 함수 그대로, 표 읽기·쓰기는 RLS를 지키는 작은 변환기).
const IMG = `${BASE}/images/hero-meadow-900.jpg`
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url")
function session(uid, aal) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const email = uid === O ? ADMIN_EMAIL : `${NAMES[uid]}@example.test`
  const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: uid, role: "authenticated", aal, amr: [{ method: "password", timestamp: exp - 3600 }], exp, email })}.c2ln`
  const now = new Date().toISOString()
  const user = { id: uid, aud: "authenticated", role: "authenticated", email, email_confirmed_at: now, created_at: now, app_metadata: {}, user_metadata: {}, factors: aal === "aal2" ? [{ id: "f1", factor_type: "totp", status: "verified", friendly_name: "x", created_at: now, updated_at: now }] : [] }
  return { user, value: JSON.stringify({ access_token: token, refresh_token: "r", expires_at: exp, expires_in: 3600, token_type: "bearer", user }) }
}
const typeCache = {}
async function argTypes(name) {
  if (!typeCache[name]) {
    const rows = await pg("select n.name, t.type from pg_proc p, unnest(p.proargnames) with ordinality n(name, i), unnest(p.proargtypes::regtype[]::text[]) with ordinality t(type, j) where p.proname = $1 and p.pronamespace = 'public'::regnamespace and n.i = t.j", [name])
    typeCache[name] = Object.fromEntries(rows.map((r) => [r.name, r.type]))
    const ret = (await pg("select p.proretset s, t.typtype = 'c' c from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = $1 and p.pronamespace = 'public'::regnamespace limit 1", [name]))[0]
    typeCache[name].__set = !!ret?.s
    typeCache[name].__composite = !ret?.s && !!ret?.c
  }
  return typeCache[name]
}
const ident = (name) => `"${name.replace(/"/g, "")}"`
function rest(method, url, body) {
  const u = new URL(url)
  const table = u.pathname.replace("/rest/v1/", "")
  const where = [], params = []
  let order = "", limit = "", cols = "*"
  for (const [k, v] of u.searchParams) {
    if (k === "select") { cols = /[()!:]/.test(v) ? "*" : v.split(",").map((c) => c.trim() === "*" ? "*" : ident(c.trim())).join(", ") }
    else if (k === "order") order = " order by " + v.split(",").map((o) => { const [c, dir] = o.split("."); return `${ident(c)} ${dir === "desc" ? "desc" : "asc"}` }).join(", ")
    else if (k === "limit") limit = ` limit ${Number(v)}`
    else if (k === "offset") limit += ` offset ${Number(v)}`
    else { const [op, ...rest] = v.split("."); const val = rest.join(".")
      if (op === "eq") { params.push(val); where.push(`${ident(k)}::text = $${params.length}`) }
      else if (op === "neq") { params.push(val); where.push(`${ident(k)}::text <> $${params.length}`) }
      else if (op === "is") where.push(`${ident(k)} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`)
      else if (op === "in") { params.push(val.replace(/^\(|\)$/g, "").split(",")); where.push(`${ident(k)}::text = any($${params.length})`) } }
  }
  const w = where.length ? ` where ${where.join(" and ")}` : ""
  if (method === "PATCH") { const sets = Object.keys(body).map((c, i) => `${ident(c)} = $${params.length + i + 1}`); return { text: `update public.${ident(table)} set ${sets.join(", ")}${w} returning *`, params: [...params, ...Object.values(body)] } }
  if (method === "POST") { const rows = Array.isArray(body) ? body : [body]; const c = Object.keys(rows[0]); return { text: `insert into public.${ident(table)} (${c.map(ident).join(", ")}) values (${c.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, params: c.map((k) => rows[0][k]) } }
  if (method === "DELETE") return { text: `delete from public.${ident(table)}${w} returning *`, params }
  return { text: `select ${cols} from public.${ident(table)}${w}${order}${limit}`, params, count: `select count(*)::int n from public.${ident(table)}${w}` }
}
async function open(browser, who, url, { mobile = false, dark = false, aal = "aal1", fail = null } = {}) {
  const page = await browser.newPage()
  page.failing = fail
  await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1366, height: 900 })
  const s = who ? session(who, aal) : null
  await page.evaluateOnNewDocument((v, dark) => {
    Object.keys(localStorage).filter((k) => k.startsWith("sb-") || k.startsWith("flavie:draft")).forEach((k) => localStorage.removeItem(k))
    if (v) localStorage.setItem("sb-mmrqcefipllmcqztksqm-auth-token", v)
    if (dark) localStorage.setItem("before-us:theme", "dark"); else localStorage.removeItem("before-us:theme")
    localStorage.setItem("flavie:home-tip-dismissed", "1")
  }, s?.value ?? null, dark)
  await page.setRequestInterception(true)
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("request", async (req) => {
    const u = req.url()
    if (u.includes("/api/session")) return req.respond({ status: 404, body: "" })
    if (!u.includes("supabase.co")) return req.continue()
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" }
    if (req.method() === "OPTIONS") return req.respond({ status: 204, headers })
    const path = new URL(u).pathname
    const json = (body, status = 200, extra = {}) => req.respond({ status, contentType: "application/json", headers: { ...headers, ...extra }, body: JSON.stringify(body) })
    if (page.failing && new RegExp(page.failing).test(path)) return json({ message: "Service Unavailable" }, 503)
    if (path === "/auth/v1/user") return s ? json(s.user) : json({ message: "no" }, 401)
    if (path.startsWith("/auth/v1/factors")) return json({ all: s?.user.factors ?? [], totp: s?.user.factors ?? [] })
    if (path.startsWith("/auth/v1/")) return json({})
    if (path.startsWith("/storage/v1/object/sign")) {
      const asked = JSON.parse(req.postData() || "{}")
      if (Array.isArray(asked.paths)) return json(asked.paths.map((item) => ({ path: item, signedURL: IMG, signedUrl: IMG, error: null })))
      return json({ signedURL: IMG, signedUrl: IMG })
    }
    if (path.startsWith("/storage/") ) return json({})
    if (path.startsWith("/functions/")) return json({ url: IMG })
    const auth = (req.headers()["authorization"] || "").replace(/^Bearer /, "")
    let sub = null, claimAal = "aal1"
    try { const claims = JSON.parse(Buffer.from(auth.split(".")[1], "base64url").toString()); sub = claims.sub ?? null; claimAal = claims.aal ?? "aal1" } catch {}
    try {
      if (path.startsWith("/rest/v1/rpc/")) {
        const name = path.slice("/rest/v1/rpc/".length)
        const args = JSON.parse(req.postData() || "{}")
        const keys = Object.keys(args)
        const types = await argTypes(name)
        const call = `public.${name}(${keys.map((k, i) => `${k} := $${i + 1}`).join(", ")})`
        const values = keys.map((k) => args[k] !== null && typeof args[k] === "object" && (/json/.test(types[k] ?? "") || !Array.isArray(args[k])) ? JSON.stringify(args[k]) : args[k])
        if (types.__set) return json(await sql(sub, `select * from ${call}`, values, claimAal))
        if (types.__composite) return json((await sql(sub, `select * from ${call}`, values, claimAal))[0] ?? null)
        const rows = await sql(sub, `select ${call} as v`, values, claimAal)
        return json(rows[0]?.v ?? null)
      }
      const method = req.method()
      const q = rest(method === "HEAD" ? "GET" : method, u, JSON.parse(req.postData() || "{}"))
      if (method === "HEAD" || (req.headers()["prefer"] || "").includes("count=exact")) {
        const n = (await sql(sub, q.count, q.params, claimAal))[0].n
        if (method === "HEAD") return req.respond({ status: 200, headers: { ...headers, "content-range": `0-0/${n}` }, body: "" })
      }
      let rows = await sql(sub, q.text, q.params, claimAal)
      const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object")
      return json(single ? rows[0] ?? null : rows)
    } catch (error) {
      return json({ code: "P0001", details: null, hint: null, message: error.message }, 400)
    }
  })
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle0", timeout: 90000 })
  await new Promise((r) => setTimeout(r, 2200))
  page.errors = errors
  return page
}
const settle = async (page, ms = 900) => { try { await page.waitForNetworkIdle({ idleTime: 400, timeout: 10000 }) } catch {} await new Promise((r) => setTimeout(r, ms)) }
const SCAN_OUT = opt.scan || process.env.SCAN_OUT || ""
const SCAN = SCAN_OUT ? readFileSync(join(HERE, "layout-scan.js"), "utf8") : ""
const TARGET = SCAN_OUT ? readFileSync(join(HERE, "target-size.js"), "utf8") : ""
const SCANNED = []
async function shoot(browser, group, name, who, url, opts = {}) {
  if (only && !only.split("|").some((part) => `${group}/${name}`.includes(part))) return
  if (SCAN_OUT) {
    const page = await open(browser, who, url, { ...opts, dark: false })
    if (opts.before) { await opts.before(page); await settle(page) }
    for (const width of [320, 390, 768, 1366]) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 })
      await new Promise((r) => setTimeout(r, 700))
      if (opt.safari || process.env.SAFARI) await page.evaluate(() => { document.querySelectorAll("*").forEach((el) => { if (getComputedStyle(el).textWrapStyle === "pretty") el.style.textWrapStyle = "auto" }) })
      const found = [...await page.evaluate(SCAN), ...await page.evaluate(TARGET)]
      for (const f of found) SCANNED.push({ group, name, width, ...f })
    }
    console.log("점검", group, name, page.errors.length ? JSON.stringify(page.errors.slice(0, 2)) : "")
    await page.close()
    return
  }
  mkdirSync(join(OUT, group), { recursive: true })
  for (const [suffix, extra] of [["데스크톱", {}], ["휴대폰", { mobile: true }], ...(opts.dark ? [["어두운 화면", { dark: true }]] : [])]) {
    const page = await open(browser, who, url, { ...opts, dark: false, ...extra })
    if (opts.before) { await opts.before(page); await settle(page) }
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)) } window.scrollTo(0, 0) })
    await new Promise((r) => setTimeout(r, 900))
    // 아주 긴 화면은 브라우저 한계(약 16,000px)를 넘으면 같은 부분이 반복돼 찍힌다 → 나눠 찍는다.
    const { height, width, dpr } = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, width: document.documentElement.clientWidth, dpr: window.devicePixelRatio }))
    const part = Math.floor(14000 / dpr)
    if (height <= part) await page.screenshot({ path: join(OUT, group, `${name} · ${suffix}.png`), fullPage: true })
    else for (let i = 0, y = 0; y < height; i++, y += part) await page.screenshot({ path: join(OUT, group, `${name} · ${suffix} (${i + 1}).png`), clip: { x: 0, y, width, height: Math.min(part, height - y) }, captureBeyondViewport: true })
    console.log("찍음", group, name, suffix, page.errors.length ? JSON.stringify(page.errors.slice(0, 2)) : "")
    await page.close()
  }
}
async function shootRetry(browser, group, name, who, url, fail, retryText, opts = {}) {
  if (SCAN_OUT) return
  if (only && !only.split("|").some((part) => `${group}/${name}`.includes(part))) return
  mkdirSync(join(OUT, group), { recursive: true })
  const page = await open(browser, who, url, { ...opts, mobile: true, fail })
  await settle(page)
  await page.screenshot({ path: join(OUT, group, `${name} · 1 불러오기 실패 · 휴대폰.png`), fullPage: true })
  page.failing = null
  await page.evaluate((t) => { const el = [...document.querySelectorAll("button, a")].find((x) => x.innerText.replace(/\s+/g, " ").trim().includes(t) && x.offsetParent !== null); el?.click() }, retryText)
  await settle(page, 1500)
  await page.screenshot({ path: join(OUT, group, `${name} · 2 다시 불러온 뒤 · 휴대폰.png`), fullPage: true })
  console.log("찍음", group, name, "실패·다시 시도", page.errors.length ? JSON.stringify(page.errors.slice(0, 2)) : "")
  await page.close()
}
const click = (text) => async (page) => { await page.evaluate((t) => { const el = [...document.querySelectorAll("button, a")].find((x) => x.innerText.replace(/\s+/g, " ").trim().includes(t) && x.offsetParent !== null); el?.click() }, text) }


// ───────── R3-27: 내 정보·운영진 화면에서 ‘할 일을 찾고 → 끝내고 → 제자리로 돌아오는지’ (가짜 자료 · 실제 SQL PGlite)
const results = []
const ok = (name, pass, detail = "") => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? "✓" : "✗"} ${name}${detail ? " · " + detail : ""}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const bodyText = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))
const waitText = async (page, t, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await bodyText(page)).includes(t)) return true; await sleep(200) } return false }
const press = (page, t, scope = "button, a") => page.evaluate((t, scope) => { const el = [...document.querySelectorAll(scope)].find((x) => x.innerText.replace(/\s+/g, " ").trim() === t && x.offsetParent !== null) ?? [...document.querySelectorAll(scope)].find((x) => x.innerText.replace(/\s+/g, " ").trim().includes(t) && x.offsetParent !== null); if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true }, t, scope)
const pressIn = (page, near, t) => page.evaluate((near, t) => { const el = [...document.querySelectorAll("button")].filter((x) => x.offsetParent !== null && x.innerText.replace(/\s+/g, " ").trim() === t).find((x) => { let n = x.parentElement; while (n && n !== document.body) { if (n.innerText.includes(near) && n.innerText.length < 6000) return true; n = n.parentElement } return false }); if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true }, near, t)
const track = (page) => { const calls = []; page.on("request", (r) => { const u = r.url(); if (u.includes("/rest/v1/rpc/") && r.method() === "POST") calls.push(new URL(u).pathname.split("/").pop()) }); return calls }
const inView = (page, id) => page.evaluate((id) => { const el = document.getElementById(id); if (!el) return null; const r = el.getBoundingClientRect(); return Math.round(r.top) }, id)
// 가짜 사례: 검토할 신청 한 건, 다른 두 회원 사이의 신고 한 건
const KB1 = await member("sua@example.test", "수아", "여성", "남성", 500, "010-3101-0011", "주말엔 전시를 자주 봐요. 천천히 걷는 걸 좋아해요.")
const KB2 = await member("jiho@example.test", "지호", "남성", "여성", 600, "010-3101-0012", "주말엔 한강에서 자전거를 타요.")
const introB = (await one(O, "select public.admin_reserve_introduction($1, $2, (public.kst_today() + 3), '두 분 모두 산책을 좋아한다고 적으셨어요.') id", [KB1, KB2], "aal2")).id
await pg("update public.introductions set reveal_at = now() - interval '1 minute', respond_by = now() + interval '23 hours', view_until = now() + interval '23 hours' where id = $1", [introB])
await pg("select public.run_noon()")
await sql(KB1, "select public.report_partner($1, '불쾌한 말', '교류 중에 불편한 표현이 있었어요. 확인 부탁드려요.', false)", [introB])
await member("queue0@example.test", "서윤", "여성", "남성", 700, "010-3101-1000", "주말엔 산책을 좋아해요.", { approve: false })
const browser = await puppeteer.launch({ executablePath: chromePath(opt.chrome), headless: "new", args: ["--hide-scrollbars"] })
try {
  // ── 회원(승인 · 소개 기다리는 중)
  let page = await open(browser, M, "/profile", { mobile: true })
  let calls = track(page)
  ok("내 정보: 바로 가기에 ‘소개 쉬기’가 보여요", await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="내 정보 바로 가기"] a')].some((a) => a.innerText.includes("소개 쉬기"))))
  await press(page, "소개 쉬기", 'nav[aria-label="내 정보 바로 가기"] a'); await sleep(1200)
  const top1 = await inView(page, "pause")
  ok("바로 가기를 누르면 쉬기 칸이 화면 위쪽에 와요", top1 !== null && top1 >= 0 && top1 < 260, `top=${top1}px · 주소 ${await page.evaluate(() => location.hash)}`)
  await press(page, "잠시 쉬기"); await waitText(page, "새 소개를 잠시 쉬어요")
  const paused1 = (await pg("select paused_at is not null p from public.profiles where id = $1", [M]))[0].p
  ok("‘잠시 쉬기’ → 저장 확인 문장 + 서버에 쉬는 중으로 저장", paused1 && (await bodyText(page)).includes("새 소개를 잠시 쉬어요"))
  await page.close()
  page = await open(browser, M, "/today", { mobile: true })
  const t1 = await bodyText(page)
  ok("오늘 화면: ‘지금은 쉬는 중’으로 보이고 정오 시계·다음 사람용 칸이 없어요(R3-22)", t1.includes("지금은 쉬는 중") && !t1.includes("다음 만날 분께") && !(await page.$('[aria-label*="정오까지"]')))
  const backed = await press(page, "내 정보에서 다시 받기"); await sleep(1500)
  const top2 = await inView(page, "pause")
  ok("오늘 화면의 ‘다시 받기’ 링크 → 내 정보의 쉬기 칸으로 돌아와요", backed && (await page.evaluate(() => location.pathname + location.hash)) === "/profile#pause" && top2 !== null && top2 >= 0 && top2 < 300, `top=${top2}px`)
  calls = track(page)
  await press(page, "다시 받기", "#pause button"); await waitText(page, "다시 받기로 바꿨어요")
  const paused2 = (await pg("select paused_at is not null p from public.profiles where id = $1", [M]))[0].p
  ok("‘다시 받기’ → 확인 문장 + 서버에서 쉬기 풀림(자동 재개 아님 · 본인이 누를 때만)", !paused2 && calls.includes("set_paused"))

  // 위험 행동 취소: 추가 정보 동의 거두기
  calls = track(page)
  await press(page, "신청서·알림", 'nav[aria-label="내 정보 바로 가기"] a'); await sleep(800)
  await press(page, "추가 정보 동의 거두기"); await sleep(400)
  const asked = (await bodyText(page)).includes("거두면 키·관심사")
  await press(page, "그만두기"); await sleep(600)
  const before = (await pg("select draft -> 'values' ->> 'consent.matching' m, (draft -> 'values') ? 'self.height' h from public.applications where member_id = $1", [M]))[0]
  ok("추가 정보 동의 거두기: 먼저 무엇이 지워지는지 묻고, ‘그만두기’면 서버를 부르지 않아요", asked && !calls.includes("withdraw_extra_consent") && before.m === "true" && before.h === true)
  await press(page, "추가 정보 동의 거두기"); await sleep(300); await press(page, "동의 거두기", "button"); await waitText(page, "추가 정보 동의를 거뒀어요")
  const after = (await pg("select draft -> 'values' ->> 'consent.matching' m, (draft -> 'values') ? 'self.height' h, status from public.applications where member_id = $1", [M]))[0]
  ok("확인하면 거둬지고 추가 정보(키)가 지워져요 · 신청 상태는 승인 그대로", calls.includes("withdraw_extra_consent") && after.m !== "true" && after.h === false && after.status === "approved", JSON.stringify(after))

  // 위험 행동 취소: 탈퇴(체크하지 않으면 보내지 않음)
  calls = track(page)
  await press(page, "계정·탈퇴", 'nav[aria-label="내 정보 바로 가기"] a'); await sleep(800)
  await press(page, "회원 탈퇴"); await sleep(300); await press(page, "탈퇴 요청하기"); await sleep(500)
  const stillActive = (await pg("select status from public.profiles where id = $1", [M]))[0]
  ok("탈퇴: 확인 체크 없이 누르면 안내만 나오고 서버를 부르지 않아요", (await bodyText(page)).includes("안내를 확인했다고 체크해 주세요") && !calls.some((c) => /withdraw|delete/.test(c) && c !== "withdraw_extra_consent"), JSON.stringify(stillActive))
  await press(page, "회원 탈퇴"); await sleep(300)
  ok("‘회원 탈퇴’를 다시 누르면 접혀요(취소)", !(await page.$("#withdraw-password")))
  await page.close()

  // D3: 이 기기에만 있는 보내지 않은 글이 있으면 로그아웃·탈퇴 전에 알려요(하네스가 새 문서마다 초안 키를 지워서, 같은 화면에서 넣고 다시 그리게 해요)
  page = await open(browser, M, "/profile", { mobile: true })
  const noneNote = (await bodyText(page)).includes("아직 보내지 않은 글")
  await page.evaluate((id) => localStorage.setItem(`flavie:draft:v2:${id}:p1:1:letter`, JSON.stringify({ ownerId: id, body: "가짜 초안", savedAt: Date.now(), expiresAt: Date.now() + 86400000 })), M)
  await press(page, "회원 탈퇴"); await sleep(400)
  const inForm = (await bodyText(page)).includes("로그아웃하거나 탈퇴하면 이 기기에서 함께 지워져요")
  await press(page, "회원 탈퇴"); await sleep(400)
  const inLine = (await bodyText(page)).includes("로그아웃하거나 탈퇴하면 이 기기에서 함께 지워져요")
  ok("D3: 보내지 않은 글이 없으면 안내가 없고, 있으면 탈퇴 안내와 로그아웃 단추 아래에 ‘함께 지워져요’가 보여요", !noneNote && inForm && inLine, `없음=${noneNote} · 탈퇴 안내=${inForm} · 단추 아래=${inLine}`)
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("flavie:draft")).forEach((k) => localStorage.removeItem(k)))
  await page.close()

  // ── 권한: 일반 회원·2단계 인증 전 운영진은 운영진 화면을 쓰지 못해요
  page = await open(browser, M, "/admin")
  const memberAdmin = await bodyText(page)
  ok("일반 회원이 /admin에 오면 운영진 자료가 보이지 않아요", !memberAdmin.includes("예약 작업 기록") && !memberAdmin.includes("신청자"), memberAdmin.slice(0, 80))
  await page.close()
  page = await open(browser, O, "/admin/applicants", { aal: "aal1" })
  const aal1 = await bodyText(page)
  ok("운영진이라도 2단계 인증 전에는 신청자 목록이 보이지 않아요", !aal1.includes("서윤") && /인증/.test(aal1), aal1.slice(0, 80))
  await page.close()

  // ── 운영진(2단계 인증): 신청 보완 요청 · 위험 행동 취소 · 사진 사유 · 신고 종결
  page = await open(browser, O, "/admin/applicants", { aal: "aal2" })
  calls = track(page)
  const q = (await pg("select id from auth.users where email = 'queue0@example.test'"))[0].id
  ok("신청자 목록에서 검토할 분을 찾을 수 있어요", (await bodyText(page)).includes("서윤"))
  await press(page, "서윤"); await sleep(1500)
  ok("이름을 누르면 그분의 신청서가 열려요", await waitText(page, "프로필 버전"))
  const disabledOf = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent !== null && x.innerText.replace(/\s+/g, " ").trim() === t); return b ? b.disabled : null }, t)
  const lock1 = await disabledOf("소개 어려움"), lock2 = await disabledOf("보완 요청")
  ok("‘보완 요청’·‘소개 어려움’은 회원에게 보낼 안내를 적기 전에는 잠겨 있어요", lock1 === true && lock2 === true, `소개 어려움=${lock1} · 보완 요청=${lock2}`)
  await page.type('textarea[aria-label="회원에게 보낼 안내"]', "얼굴이 잘 보이는 사진으로 바꿔 주세요.")
  await sleep(300)
  await press(page, "소개 어려움", "button"); await sleep(500)
  const dialog1 = await page.$('[role="dialog"]')
  await page.keyboard.press("Escape"); await sleep(500)
  const st1 = (await pg("select status from public.applications where member_id = $1", [q]))[0].status
  ok("‘소개 어려움’은 확인 창을 먼저 띄우고, Esc로 닫으면 아무것도 바뀌지 않아요", !!dialog1 && !(await page.$('[role="dialog"]')) && st1 === "submitted" && !calls.includes("admin_decide_application"), st1)
  await press(page, "보완 요청", "button"); await waitText(page, "보완 요청(으)로 기록했어요")
  const st2 = (await pg("select status, decision_note from public.applications where member_id = $1", [q]))[0]
  const listRow = await page.evaluate(() => document.body.innerText.includes("서윤") && document.body.innerText.includes("프로필 버전"))
  ok("‘보완 요청’ → 저장 확인 문장 + 서버 상태 보완 요청(안내 문장 저장) · 목록과 열린 신청서가 그대로 남아요", st2.status === "needs_changes" && st2.decision_note === "얼굴이 잘 보이는 사진으로 바꿔 주세요." && listRow, JSON.stringify(st2))
  const photoBtn = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /재등록 요청|교체 요청/.test(x.innerText) && x.offsetParent !== null); return b ? b.disabled : null })
  ok("사진 재등록·교체 요청은 사유를 고르기 전에는 누를 수 없어요", photoBtn === true, `disabled=${photoBtn}`)
  await page.close()

  page = await open(browser, O, "/admin/safety", { aal: "aal2" })
  calls = track(page)
  const rep = (await pg("select id, status from public.reports order by created_at desc limit 1"))[0]
  ok("신고·문의에서 들어온 신고를 찾을 수 있어요", (await bodyText(page)).includes("불쾌한 말"))
  const closeLock = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent !== null && x.innerText.trim() === "종결"); return b ? b.disabled : null })
  ok("신고 ‘종결’은 처리 메모를 적기 전에는 잠겨 있어요", closeLock === true, `disabled=${closeLock}`)
  await page.type('[aria-label="처리 메모"]', "양쪽 안내 뒤 사실 확인을 마쳤어요.")
  await sleep(300)
  await press(page, "종결", "button"); await sleep(500)
  const dialog2 = await page.$('[role="dialog"]')
  await press(page, "닫기", '[role="dialog"] button'); await sleep(500)
  const r1 = (await pg("select status from public.reports where id = $1", [rep.id]))[0].status
  ok("메모를 적고 ‘종결’을 누르면 되돌릴 수 없다고 먼저 묻고, ‘닫기’면 그대로예요", !!dialog2 && r1 === rep.status && !calls.includes("admin_update_report"), r1)
  await press(page, "종결", "button"); await sleep(400); await press(page, "종결", '[role="dialog"] button'); await sleep(1500)
  const r2 = (await pg("select status, resolution from public.reports where id = $1", [rep.id]))[0]
  ok("확인하면 종결과 처리 메모가 저장되고 ‘기록했어요’가 보여요", r2.status === "closed" && r2.resolution === "양쪽 안내 뒤 사실 확인을 마쳤어요." && (await bodyText(page)).includes("기록했어요"), JSON.stringify(r2))
  await page.close()

  // ── 저장 실패(503) 뒤 다시 시도: 내 정보 쉬기 저장
  page = await open(browser, M, "/profile#pause", { mobile: true, fail: "rpc/set_pause" })
  await press(page, "잠시 쉬기", "#pause button"); await sleep(1500)
  const failText = await page.evaluate(() => document.querySelector('#pause [role="status"]')?.innerText ?? '')
  const paused3 = (await pg("select paused_at is not null p from public.profiles where id = $1", [M]))[0].p
  ok("쉬기 저장이 실패하면 ‘쉬어요’라고 하지 않고 실패 문장(오류 번호)을 보여요 · 서버도 그대로", failText.length > 0 && !failText.includes("새 소개를 잠시 쉬어요") && !paused3, failText)
  page.failing = null
  await press(page, "잠시 쉬기", "#pause button"); await waitText(page, "새 소개를 잠시 쉬어요")
  const paused4 = (await pg("select paused_at is not null p from public.profiles where id = $1", [M]))[0].p
  ok("다시 누르면 저장돼요", paused4)
  await page.close()
} finally {
  const pass = results.filter((r) => r.pass).length
  console.log(`\nR3-27 과제 흐름: ${pass}/${results.length} 통과`)
  if (opt.out) writeFileSync(opt.out, JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, results }, null, 1))
  await browser.close()
  process.exit(pass === results.length ? 0 : 1)
}
