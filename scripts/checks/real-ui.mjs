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

const browser = await puppeteer.launch({ executablePath: chromePath(opt.chrome), headless: "new", args: ["--hide-scrollbars"] })
try {
  // ── 공개 화면
  const vouch = (await one(M, "select public.vouch_link() v")).v.token
  for (const [name, url, dark] of [["00 시작 화면(인스타그램 링크로 온 첫 방문)", "/start?utm_source=instagram", true], ["01 홈", "/", true], ["02 두 가지 시작", "/two-starts"], ["03 이용 요금", "/pricing"], ["04 자주 묻는 질문", "/faq"], ["05 문의하기", "/contact"], ["06 로그인", "/login"], ["07 회원가입", "/signup"], ["08 개인정보처리방침", "/privacy"], ["09 이용약관", "/terms"], ["10 친구 추천사 쓰기", `/vouch/${vouch}`]])
    await shoot(browser, "1 공개 화면", name, null, url, { dark })

  // ── 회원: 신청 쓰는 중 · 접수(검토 전) · 승인 뒤 기다리는 중
  await shoot(browser, "2 회원 화면", "01 소개 신청서(쓰는 중)", D, "/apply")
  await shoot(browser, "2 회원 화면", "02 오늘(검토 기다리는 중)", W, "/today")
  await sql(O, "select public.admin_set_reading_note($1, '주말을 보내는 방식과 편하게 대화할 수 있는 속도를 함께 살펴보고 있어요.')", [M], "aal2").catch((e) => console.log("읽은 한 문장:", e.message))
  await sql(O, "select public.admin_note_write('이번 주에는 천천히 걷는 걸 좋아하는 분들의 신청서를 오래 읽었어요.')", [], "aal2")
  await sql(null, "select public.vouch_write($1, '오랜 친구', '약속 장소에 늘 먼저 와서, 늦는 사람을 웃으며 기다려 주는 친구예요.')", [vouch])
  await shoot(browser, "2 회원 화면", "03 오늘(승인 · 소개 기다리는 중)", M, "/today", { dark: true })
  await shoot(browser, "2 회원 화면", "04 내 정보", M, "/profile")
  await shoot(browser, "2 회원 화면", "04-1 시작 화면(로그인한 회원)", M, "/start")

  // ── 소개 도착(정오)
  const intro = (await one(O, "select public.admin_reserve_introduction($1, $2, (public.kst_today() + 3), '두 분 모두 ‘말이 끊겨도 편한 대화’를 좋아한다고 적으셨어요.') id", [M, P], "aal2")).id
  await pg("update public.introductions set reveal_at = now() - interval '1 minute', respond_by = now() + interval '23 hours', view_until = now() + interval '23 hours' where id = $1", [intro])
  await pg("select public.run_noon()")
  await shoot(browser, "2 회원 화면", "05 오늘(소개 도착)", M, "/today")
  await shoot(browser, "2 회원 화면", "06 두 사람(소개 보기)", M, "/us", { dark: true })
  for (const m of [M, P]) { await sql(m, "select public.record_introduction_view($1)", [intro]); await sql(m, "select public.respond_introduction($1, 'positive')", [intro]) }
  await shoot(browser, "2 회원 화면", "07 교류(방식 고르기)", M, "/exchange")

  // ── 교류 A: 방식·시작일 → 사흘
  const prog = (await one(M, "select public.my_program() v")).v
  await sql(M, "select public.choose_program_plan($1, 'A')", [prog.id])
  await sql(P, "select public.choose_program_plan($1, 'A')", [prog.id])
  const start = (await pg("select (public.kst_today() + 2)::text d"))[0].d
  await sql(P, "select public.propose_program_start($1, $2::date)", [prog.id, start])
  await shoot(browser, "2 회원 화면", "08 교류(시작일 확인)", M, "/exchange")
  await sql(M, "select public.confirm_program($1, $2::date)", [prog.id, start])
  await at(start, "09:30"); await pg("select public.run_programs()")
  const letter = (who, day, kind, body) => sql(who, "select public.submit_program_entry($1, $2, $3, $4, null)", [prog.id, day, kind, body])
  await letter(M, 1, "letter", "쉬는 날엔 늦잠을 자고 오후에 도서관 창가 자리에서 책을 읽어요. 요즘은 퇴근길에 한 정거장 먼저 내려 걸어요.")
  await shoot(browser, "2 회원 화면", "09 교류 첫째 날(내 편지만 보냄)", M, "/exchange")
  await letter(P, 1, "letter", "토요일 아침마다 친구들과 배드민턴을 치고 국밥을 먹어요. 말이 끊겨도 어색하지 않은 대화가 좋아요.")
  await at(start, "17:00")
  await letter(M, 1, "reply", "배드민턴 치고 먹는 국밥, 상상만 해도 좋아요.")
  await letter(P, 1, "reply", "도서관 창가 자리, 저도 좋아하는 자리예요.")
  await at(await plus(start, 1), "10:00"); await pg("select public.run_programs()")
  await letter(M, 2, "letter", "요즘은 가족과 저녁을 함께 먹는 시간을 가장 아껴요.")
  await letter(P, 2, "letter", "작은 약속이라도 지키는 사람이고 싶어서 요즘 노력하고 있어요.")
  await shoot(browser, "2 회원 화면", "10 교류 둘째 날(함께 열린 편지)", M, "/exchange", { dark: true })
  await at(await plus(start, 2), "10:00"); await pg("select public.run_programs()")
  await letter(P, 3, "letter", "만나게 된다면 강가를 같이 천천히 걷고 싶어요.")
  await letter(M, 3, "letter", "조용한 전시를 보고 근처 카페에서 이야기를 나누고 싶어요.")
  await shoot(browser, "2 회원 화면", "11 교류 셋째 날", M, "/exchange")
  await at(await plus(start, 3), "09:05"); await pg("select public.run_programs()")
  await shoot(browser, "2 회원 화면", "12 넷째 날(만남 선택)", M, "/exchange")
  await sql(M, "select public.choose_meeting($1, 'positive')", [prog.id])
  await sql(P, "select public.choose_meeting($1, 'positive')", [prog.id])
  const meet = await plus(start, 6)
  const proposal = (await one(M, "select public.propose_appointment($1, $2, '전시·미술관', '종로구', '공개된 미술관', '천천히 보고 카페에서 이야기해요') v", [prog.id, JSON.stringify([{ date: meet, start: "14:00", end: "17:00" }])])).v.proposals[0]
  await shoot(browser, "2 회원 화면", "13 약속(제안 보냄)", M, "/meeting")
  await sql(P, "select public.accept_appointment($1, 0)", [proposal.id])
  for (const m of [M, P]) await sql(m, "select public.set_contact_consent($1, true, (public.my_program() ->> 'meetingRev')::int)", [prog.id])
  await shoot(browser, "2 회원 화면", "14 약속(정해짐 · 연락처 동의)", M, "/meeting", { dark: true })
  await at(meet, "08:00")
  await shoot(browser, "2 회원 화면", "15 만나는 날(연락처 열림)", M, "/meeting")
  await at(await plus(meet, 2), "00:05"); await pg("select public.run_programs()")
  await shoot(browser, "2 회원 화면", "16 오늘(만남 뒤 · 한 줄)", M, "/today")
  await shoot(browser, "2 회원 화면", "17 교류(마무리 · 다시 읽기)", M, "/exchange")
  await shootRetry(browser, "5 실패·다시 시도", "01 오늘 화면", M, "/today", "rpc/my_program", "다시 불러오기")
  await shootRetry(browser, "5 실패·다시 시도", "02 교류 화면", M, "/exchange", "rpc/my_program", "다시 불러오기")
  await shootRetry(browser, "5 실패·다시 시도", "03 내 정보", M, "/profile", "rpc/my_program", "다시 불러오기")
  await clock(null)

  // ── 추가 경로: B 첫 장면 사흘 · A/B 서로 다른 방식 · 운영진 실제 업무(가짜 사례)
  const KB1 = await member("sua@example.test", "수아", "여성", "남성", 500, "010-3101-0011", "주말엔 전시를 자주 봐요. 천천히 걷는 걸 좋아해요.")
  const KB2 = await member("jiho@example.test", "지호", "남성", "여성", 600, "010-3101-0012", "주말엔 한강에서 자전거를 타요.")
  NAMES[KB1] = "수아"; NAMES[KB2] = "지호"
  const introB = (await one(O, "select public.admin_reserve_introduction($1, $2, (public.kst_today() + 3), '두 분 모두 ‘처음엔 조용하지만 걸으면 말이 많아진다’고 적으셨어요.') id", [KB1, KB2], "aal2")).id
  await pg("update public.introductions set reveal_at = now() - interval '1 minute', respond_by = now() + interval '23 hours', view_until = now() + interval '23 hours' where id = $1", [introB])
  await pg("select public.run_noon()")
  for (const m of [KB1, KB2]) { await sql(m, "select public.record_introduction_view($1)", [introB]); await sql(m, "select public.respond_introduction($1, 'positive')", [introB]) }
  const pb = (await one(KB1, "select public.my_program() v")).v
  await sql(KB1, "select public.choose_program_plan($1, 'B')", [pb.id])
  await sql(KB2, "select public.choose_program_plan($1, 'A')", [pb.id])
  await shoot(browser, "4 추가 경로", "01 방식이 서로 다를 때", KB1, "/exchange")
  await sql(KB2, "select public.choose_program_plan($1, 'B')", [pb.id])
  const startB = (await one(KB1, "select public.my_program() v")).v.startOn
  for (const m of [KB2, KB1]) await sql(m, "select public.confirm_program($1, (public.my_program() ->> 'startOn')::date)", [pb.id])
  await at(startB, "09:30"); await pg("select public.run_programs()")
  const scene = (who, day, body, payload) => sql(who, "select public.submit_program_entry($1, $2, 'scene', $3, $4)", [pb.id, day, body, JSON.stringify(payload)])
  await shoot(browser, "4 추가 경로", "02 B 첫째 날(아직 안 씀)", KB1, "/exchange")
  await scene(KB1, 1, null, { activity: "exhibition", about: "주말엔 전시를 자주 봐요." })
  await scene(KB2, 1, "날이 좋으면 밖에서 오래 이야기하고 싶어서요.", { activity: "park", about: "주말엔 한강에서 자전거를 타요." })
  await at(await plus(startB, 1), "10:00"); await pg("select public.run_programs()")
  await shoot(browser, "4 추가 경로", "03 B 둘째 날(첫날 함께 열림)", KB1, "/exchange", { dark: true })
  await scene(KB1, 2, "공원 이야기를 듣고 나니 가 보고 싶어졌어요.", { place: "park", flow: "돗자리 펴고 오래 머물기", rest: "나무 그늘 아래", reaction: "공원 피크닉이라니 날씨 좋은 날 꼭 가 보고 싶어요.", about: "걸으면서 이야기하면 편해져요." })
  await scene(KB2, 2, null, { place: "exhibition", flow: "한 전시만 천천히 보기", rest: "미술관 안 카페", reaction: "전시 좋아요. 요즘 본 전시가 궁금해요.", about: "처음엔 조금 조용한 편이에요." })
  await at(await plus(startB, 2), "10:00"); await pg("select public.run_programs()")
  await scene(KB1, 3, null, { topic: "요즘 읽는 책 이야기", reaction: "미술관 카페 좋아요.", about: "친구들은 저를 느긋하다고 해요." })
  await scene(KB2, 3, null, { topic: "최근에 다녀온 곳", reaction: "돗자리 피크닉 좋아요.", about: "궁금한 건 바로 물어보는 편이에요." })
  await shoot(browser, "4 추가 경로", "04 B 셋째 날 · 첫 장면 맞추기", KB1, "/exchange")
  await clock(null)
  // 운영진 실제 업무: 검토할 신청서 여러 건(긴 이름·긴 소개), 사진 교체 요청, 신고 한 건
  for (let i = 0; i < 8; i++) await member(`queue${i}@example.test`, ["서윤", "하은", "민서", "지안", "다인", "예린", "수빈", "채원"][i] + (i === 3 ? "아주긴이름확인용" : ""), i % 2 ? "남성" : "여성", i % 2 ? "여성" : "남성", 700 + i * 10, `010-3101-1${String(i).padStart(3, "0")}`, i === 5 ? "퇴근 후엔 동네를 한 바퀴 걷고, 주말에는 작은 서점과 카페를 오래 둘러봐요. 처음엔 말수가 적지만 편해지면 이야기가 길어지는 편이에요. 천천히 알아가는 관계를 바라요." : "주말엔 산책을 좋아해요.", { approve: false })
  await sql(O, "select public.admin_request_photo_change($1, 'photo.face', '얼굴 확인 어려움')", [KB2], "aal2").catch((e) => console.log("사진 교체 요청:", e.message))
  await sql(KB1, "select public.report_partner($1, '불쾌한 말', '교류 중에 불편한 표현이 있었어요. 확인 부탁드려요.', false)", [introB]).catch((e) => console.log("신고:", e.message))
  for (const [name, url, before] of [["05 운영진 대시보드(일이 있을 때)", "/admin"], ["06 운영진 신청자 목록(여러 건)", "/admin/applicants"], ["07 운영진 신고·문의(한 건)", "/admin/safety"]])
    await shoot(browser, "4 추가 경로", name, O, url, { aal: "aal2", before })

  // ── 운영진(2단계 인증을 마친 것으로)
  for (const [name, url, before] of [["01 대시보드", "/admin"], ["02 신청자", "/admin/applicants", click("지원")], ["03 회원", "/admin/members"], ["04 소개·매칭", "/admin/introductions"], ["05 교류", "/admin/programs"], ["06 신고·문의", "/admin/safety"], ["07 기수", "/admin/cohorts"], ["08 설정", "/admin/settings"]])
    await shoot(browser, "3 운영진 화면", name, O, url, { aal: "aal2", before })
} finally {
  if (SCAN_OUT) writeFileSync(SCAN_OUT, JSON.stringify(SCANNED, null, 1))
  await browser.close()
}
