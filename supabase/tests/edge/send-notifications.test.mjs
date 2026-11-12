// 메일 함수(send-notifications) 단계별 강제 종료 시험(GPT 3차 검수 R3-15 · 6700 · 6800). 가짜 메일 서버 · 가짜 자료만 쓴다.
// 실행: node supabase/tests/edge/send-notifications.test.mjs
// 함수 원본(index.ts)을 Node에서 그대로 돌리고(harness.mjs), ‘작업이 멈춤’은 그 지점에서 영영 끝나지 않게 붙잡아 흉내 낸다.
//  K0 보낼 메일 0통이어도 작업 기록 한 줄(zero) · 열쇠가 틀리면 401이고 기록 없음
//  K1 선점 직후 멈춤(보내기 시작 전) → 기한 뒤 다시 보낸다(확실히 안 보냄) · 한 통만 도착
//  K2 보내기 시작 뒤·메일 서버 전송 중 멈춤 → 기한 뒤 ‘불확실’, 자동으로 다시 보내지 않음 → 운영진 확인·다시 보내기 → 한 통
//  K3 메일 서버가 받은(250) 뒤 결과 기록 전 멈춤 → ‘불확실’, 다시 보내지 않음(도착은 한 통)
//  K4 결과 기록이 한 번 실패 → 다시 시도해 ‘보냄’ · 두 번 다 실패 → ‘불확실’로 남김
//  K5 보내기 직전 선점 기한이 이미 지남 → 보내지 않음(다른 작업이 넘겨받을 수 있어서) → 다음 차례에 한 통
//  K6 메일 서버 거절(550) 세 번 → 더 보내지 않음(포기) · 운영진 목록에 보임
//  K7 본문을 보내는 도중 연결이 끊김(끝 표시 전) → 확실히 안 감 → 선점을 풀고 다음 차례에 보냄
//  K8 Resend 경로: 보내기 시작 뒤 응답 없이 멈춤 → 불확실 · 정상이면 보냄(멱등키 notification-<id>)
//  K9 복구 환경 스위치(outbound_paused)가 켜져 있으면 아무것도 잡지 않는다
//  K10 (GPT 4차 R4-02) 메일 설정이 없으면 차례마다 ‘보낼 수 없음’(ok=false) — 경고 줄만 한 시간에 한 번 · 대기 0통도 구분 · 설정을 고치면 정상
import assert from "node:assert/strict"
import { join } from "node:path"
import { startEdge, repo } from "./harness.mjs"
import { serial } from "./fake-supabase.mjs"

let passed = 0
const ok = (label, value) => { assert.ok(value, label); passed++; console.log("✓", label) }
const FN = join(repo, "supabase/functions/send-notifications/index.ts")
const enc = new TextEncoder(), dec = new TextDecoder()
const never = () => new Promise(() => {}) // 영영 끝나지 않음 = 그 지점에서 작업이 멈춤

// 가짜 메일 서버: 연결마다 새로. hangAt(명령 앞부분에서 답 없이 멈춤) · afterData: ok|reject|drop · dropInBody(본문 중간에 끊김)
const delivered = []
let smtp = {}
function fakeConn() {
  const st = { mode: "command", inbox: "", data: "", replies: ["220 fake ready\r\n"], closed: false, waiters: [], n: 0 }
  const push = (t) => { st.replies.push(t); st.waiters.splice(0).forEach((w) => w()) }
  const close = () => { st.closed = true; st.waiters.splice(0).forEach((w) => w()) }
  const onLine = (line) => {
    st.n++
    if (smtp.hangAt && line.startsWith(smtp.hangAt)) return // 답하지 않음(멈춤)
    if (line.startsWith("EHLO")) push("250-fake\r\n250 AUTH LOGIN\r\n")
    else if (line === "AUTH LOGIN") push("334 VXNlcm5hbWU6\r\n")
    else if (st.n === 3) push("334 UGFzc3dvcmQ6\r\n")
    else if (st.n === 4) push("235 ok\r\n")
    else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO") || line === "RSET") push("250 ok\r\n")
    else if (line === "DATA") { st.mode = "data"; push("354 go\r\n") }
    else if (line === "QUIT") { push("221 bye\r\n"); close() }
  }
  return {
    async write(bytes) {
      if (st.closed) throw new Error("broken pipe")
      const text = dec.decode(bytes)
      if (st.mode === "data") {
        st.data += text
        if (smtp.dropInBody && st.data.length > 200) { close(); throw new Error("connection reset") }
        const end = st.data.indexOf("\r\n.\r\n")
        if (end >= 0) {
          const message = st.data.slice(0, end); st.mode = "command"; st.data = ""
          const after = typeof smtp.afterData === "function" ? smtp.afterData() : (smtp.afterData ?? "ok")
          if (after === "ok") { delivered.push(message); push("250 2.0.0 queued\r\n") }
          else if (after === "reject") push("550 5.1.1 no such user\r\n")
          else close()
        }
      } else {
        st.inbox += text
        let at
        while ((at = st.inbox.indexOf("\r\n")) >= 0) { const line = st.inbox.slice(0, at); st.inbox = st.inbox.slice(at + 2); onLine(line) }
      }
      return bytes.length
    },
    async read(buffer) {
      for (;;) {
        if (st.replies.length) { const b = enc.encode(st.replies.shift()); buffer.set(b); return b.length }
        if (st.closed) return null
        await new Promise((r) => st.waiters.push(r))
      }
    },
    close() { st.closed = true },
  }
}

const edge = await startEdge({ env: { SMTP_HOST: "smtp.example.test", SMTP_USER: "sender@example.test", SMTP_PASS: "app-password", MAIL_FROM: "플라비 <sender@example.test>", SITE_URL: "https://site.test" } })
edge.state.connectTls = async () => fakeConn()
const q = edge.q
await q("select set_config('app.now', (public.kst_at(public.kst_today(), '13:00'))::text, false)")
const token = (await q("select value from public.private_values where name = 'cron_token'"))[0].value
let handler = await edge.load(FN)
const call = (withToken = true) => handler(new Request("http://edge.test/send-notifications", { method: "POST", headers: withToken ? { "x-cron-token": token } : { "x-cron-token": "wrong" } }))
const settle = () => new Promise((r) => setTimeout(r, 50))
let seq = 0
const member = async () => {
  const id = (await q("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [`mail-${++seq}@example.test`, { adult: true, terms_version: "t", privacy_version: "t" }]))[0].id
  await q("update public.profiles set notify_email = true where id = $1", [id])
  return id
}
const notice = async (m) => { await q("select public.notify($1, 'new-introduction', '오늘의 인연이 도착했어요', '확인해 주세요.', '/us', $2)", [m, `mail-test:${m}`]); return (await q("select id from public.notifications where member_id = $1", [m]))[0].id }
const row = async (id) => (await q("select emailed_at, email_status, email_attempts, email_lease_until, email_send_started_at, email_error from public.notifications where id = $1", [id]))[0]
const expire = (id) => q("update public.notifications set email_lease_until = now() - interval '1 second' where id = $1 and email_lease_until is not null", [id])
const reset = () => { smtp = {}; edge.state.beforeRpc = null; edge.state.rpcError = null }
const deliveredTo = (m) => delivered.filter((x) => x.includes(`mail-${m}@example.test`)).length
const lastEmailRun = async () => (await q("select ok, detail from public.job_runs where job = 'email' order by id desc limit 1"))[0]
const asAdmin = async (O, sql, params = []) => serial(async () => {
  await edge.db.query("begin")
  try {
    await edge.db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: O, role: "authenticated", aal: "aal2" })])
    await edge.db.query("set local role authenticated")
    const rows = (await edge.db.query(sql, params)).rows
    await edge.db.query("commit"); return rows
  } catch (error) { await edge.db.query("rollback"); throw error }
})
const O = (await q("insert into auth.users (email, raw_user_meta_data) values ('owner-mail@example.test', $1) returning id", [{ adult: true, terms_version: "t", privacy_version: "t" }]))[0].id
await q("insert into public.admin_roles (user_id, role) values ($1, 'owner')", [O])

// K0
{
  const before = (await q("select count(*)::int n from public.job_runs where job = 'email'"))[0].n
  const res = await (await call()).json()
  const run = await lastEmailRun()
  ok("K0: 보낼 메일이 0통이어도 작업 기록 한 줄(ok · zero)", res.sent === 0 && (await q("select count(*)::int n from public.job_runs where job = 'email'"))[0].n === before + 1 && run.ok === true && run.detail.zero === true)
  const wrong = await call(false)
  ok("K0: 열쇠가 틀리면 401이고 작업 기록은 남지 않는다(→ 점검·공개 상태에서는 ‘늦음’으로 보임)", wrong.status === 401 && (await q("select count(*)::int n from public.job_runs where job = 'email'"))[0].n === before + 1)
}
// K1
{
  reset()
  const m = seq + 1, M = await member(), id = await notice(M)
  edge.state.beforeRpc = async (name) => { if (name === "email_send_started") await never() }
  call(); await settle()
  const stuck = await row(id)
  ok("K1: 선점 직후 멈춤 — 선점 기한만 있고 ‘보내기 시작’은 없다", stuck.email_lease_until && !stuck.email_send_started_at && deliveredTo(m) === 0)
  await expire(id); reset()
  const res = await (await call()).json()
  const done = await row(id)
  ok("K1: 기한 뒤 다음 차례에 다시 잡아 보낸다(불확실로 막지 않음) · 한 통만 도착", res.sent === 1 && done.emailed_at && !done.email_status && deliveredTo(m) === 1 && done.email_attempts === 2)
}
// K2
{
  reset()
  const m = seq + 1, M = await member(), id = await notice(M)
  smtp = { hangAt: "MAIL FROM" }
  call(); await settle()
  const stuck = await row(id)
  ok("K2: 보내기 시작을 남긴 뒤 메일 서버와 주고받는 중 멈춤", !!stuck.email_send_started_at && !stuck.emailed_at)
  await expire(id); reset()
  const res = await (await call()).json()
  const after = await row(id)
  const run = (await q("select ok, detail from public.job_runs where job = 'email' and ok = false order by id desc limit 1"))[0]
  ok("K2: 기한 뒤 ‘불확실’로 두고 자동으로 다시 보내지 않는다", after.email_status === "unknown" && !after.emailed_at && deliveredTo(m) === 0 && res.sent === 0)
  ok("K2: 작업 기록(메일 · 실패)에 불확실 수가 남는다", run && run.detail.unknown >= 1)
  const issues = (await asAdmin(O, "select public.admin_email_issues(7) v"))[0].v
  ok("K2: 운영진 목록에 ‘불확실’로 보인다(회원 요약은 다른 운영 화면과 같고, 메일 본문은 없다)", issues.some((x) => x.id === id && x.state === "unknown" && x.sendStartedAt && x.member?.id === M) && !JSON.stringify(issues).includes("확인해 주세요"))
  let refused = null
  try { await asAdmin(O, "select public.admin_email_retry('notification', $1, '짧음')", [id]) } catch (e) { refused = e.message }
  ok("K2: 다시 보내기는 이유(5자 이상)가 있어야 한다", /5자 이상/.test(refused ?? ""))
  await asAdmin(O, "select public.admin_email_retry('notification', $1, '회원이 메일을 못 받았다고 문의함')", [id])
  const res2 = await (await call()).json()
  ok("K2: 운영진이 확인해 다시 보내기로 하면 다음 차례에 한 통 보낸다 · 감사 기록", res2.sent === 1 && deliveredTo(m) === 1 && (await row(id)).emailed_at && (await q("select count(*)::int n from public.audit_log where action = '메일 다시 보내기'"))[0].n >= 1)
}
// K3
{
  reset()
  const m = seq + 1, M = await member(), id = await notice(M)
  edge.state.beforeRpc = async (name, args) => { if (name === "record_email_result" && args.p_id === id) await never() }
  call(); await settle()
  ok("K3: 메일 서버가 받았다(250) — 결과 기록 전에 멈춤", deliveredTo(m) === 1 && !(await row(id)).emailed_at)
  await expire(id); reset()
  await call()
  const after = await row(id)
  ok("K3: ‘불확실’로 남기고 다시 보내지 않는다(도착은 여전히 한 통)", after.email_status === "unknown" && deliveredTo(m) === 1)
}
// K4
{
  reset()
  const m = seq + 1, M = await member(), id = await notice(M)
  let failures = 1
  edge.state.rpcError = (name, args) => (name === "record_email_result" && args.p_id === id && args.p_status === "sent" && failures-- > 0 ? "시험용 DB 오류" : null)
  const res = await (await call()).json()
  ok("K4: 결과 기록이 한 번 실패해도 다시 시도해 ‘보냄’으로 남긴다", res.sent === 1 && (await row(id)).emailed_at && deliveredTo(m) === 1)
  reset()
  const m2 = seq + 1, M2 = await member(), id2 = await notice(M2)
  edge.state.rpcError = (name, args) => (name === "record_email_result" && args.p_id === id2 && args.p_status === "sent" ? "시험용 DB 오류" : null)
  const res2 = await (await call()).json()
  ok("K4: ‘보냄’ 기록이 두 번 다 실패하면 ‘불확실’로 남겨 다시 보내지 않는다", res2.unknown === 1 && (await row(id2)).email_status === "unknown" && deliveredTo(m2) === 1)
}
// K5
{
  reset()
  const m = seq + 1, M = await member(), id = await notice(M)
  edge.state.beforeRpc = async (name, args) => { if (name === "email_send_started" && args.p_id === id) await q("update public.notifications set email_lease_until = now() - interval '1 second' where id = $1", [id]) }
  await call()
  const mid = await row(id)
  ok("K5: 보내기 직전 선점 기한이 이미 지났으면 보내지 않는다", deliveredTo(m) === 0 && !mid.email_send_started_at && !mid.emailed_at)
  reset()
  await call()
  ok("K5: 다음 차례에 한 통만 보낸다", deliveredTo(m) === 1 && (await row(id)).emailed_at)
}
// K6
{
  reset()
  const m = seq + 1, M = await member(), id = await notice(M)
  smtp = { afterData: "reject" }
  for (let i = 0; i < 4; i++) await call()
  const after = await row(id)
  const issues = (await asAdmin(O, "select public.admin_email_issues(7) v"))[0].v
  ok("K6: 메일 서버가 거절하면 세 번까지만 시도하고 멈춘다(도착 0통)", after.email_attempts === 3 && !after.emailed_at && deliveredTo(m) === 0)
  ok("K6: 포기한 메일은 운영진 목록에 ‘gave-up’으로 보인다", issues.some((x) => x.id === id && x.state === "gave-up"))
}
// K7
{
  reset()
  const m = seq + 1, M = await member(), id = await notice(M)
  smtp = { dropInBody: true }
  await call()
  const mid = await row(id)
  ok("K7: 본문 도중 끊기면 확실히 안 간 것 → 선점을 풀고 시도 횟수를 되돌린다(불확실 아님)", !mid.email_status && !mid.email_lease_until && !mid.email_send_started_at && mid.email_attempts === 0 && deliveredTo(m) === 0)
  reset()
  await call()
  ok("K7: 다음 차례에 한 통 보낸다", deliveredTo(m) === 1 && (await row(id)).emailed_at)
}
// K8 Resend
{
  reset()
  edge.state.env.RESEND_API_KEY = "re_test_fake"
  const sentKeys = []
  let mode = "hang"
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      sentKeys.push(init.headers["Idempotency-Key"])
      if (mode === "hang") return never()
      return new Response(JSON.stringify({ id: "fake" }), { status: 200 })
    }
    throw new Error("시험에서는 바깥으로 나가지 않아요")
  }
  const M = await member(), id = await notice(M)
  call(); await settle()
  ok("K8: Resend — 보내기 시작을 남긴 뒤 응답을 못 받고 멈춤", !!(await row(id)).email_send_started_at && sentKeys.includes(`notification-${id}`))
  await expire(id); mode = "ok"
  await call()
  ok("K8: Resend — 기한 뒤 ‘불확실’, 자동으로 다시 부르지 않는다", (await row(id)).email_status === "unknown" && sentKeys.filter((k) => k === `notification-${id}`).length === 1)
  const M2 = await member(), id2 = await notice(M2)
  const res = await (await call()).json()
  ok("K8: Resend — 정상 응답이면 ‘보냄’(멱등키 notification-<id>)", res.sent === 1 && (await row(id2)).emailed_at && sentKeys.includes(`notification-${id2}`))
  delete edge.state.env.RESEND_API_KEY
}
// K9
{
  reset()
  const m = seq + 1, M = await member(), id = await notice(M)
  await q("insert into public.private_values (name, value) values ('outbound_paused', 'true') on conflict (name) do update set value = 'true'")
  const res = await (await call()).json()
  ok("K9: 복구 환경 스위치가 켜져 있으면 메일을 하나도 잡지 않는다", res.sent === 0 && !(await row(id)).email_lease_until && deliveredTo(m) === 0)
  await q("delete from public.private_values where name = 'outbound_paused'")
  await call()
  ok("K9: 스위치를 끄면 다시 보낸다", deliveredTo(m) === 1)
}
// 대조군: 지금 운영(6600까지 DB + v18 함수)에서 K1(선점 직후 멈춤)을 재현 → 기한 뒤 ‘불확실’로 묶여 영영 가지 않음
{
  const old = await startEdge({ until: "20261106006700", env: { SMTP_HOST: "smtp.example.test", SMTP_USER: "sender@example.test", SMTP_PASS: "app-password", MAIL_FROM: "플라비 <sender@example.test>" } })
  old.state.connectTls = async () => fakeConn()
  smtp = {}
  await old.q("select set_config('app.now', (public.kst_at(public.kst_today(), '13:00'))::text, false)")
  const oldToken = (await old.q("select value from public.private_values where name = 'cron_token'"))[0].value
  const h = await old.load(join(repo, "supabase/tests/edge/fixtures/send-notifications-v18-f3a4df7/index.ts"))
  const go = () => h(new Request("http://edge.test/send-notifications", { method: "POST", headers: { "x-cron-token": oldToken } }))
  const M = (await old.q("insert into auth.users (email, raw_user_meta_data) values ('mail-old@example.test', $1) returning id", [{ adult: true, terms_version: "t", privacy_version: "t" }]))[0].id
  await old.q("update public.profiles set notify_email = true where id = $1", [M])
  await old.q("select public.notify($1, 'new-introduction', '오늘의 인연이 도착했어요', '확인해 주세요.', '/us', 'mail-old')", [M])
  const id = (await old.q("select id from public.notifications where member_id = $1", [M]))[0].id
  // v18에는 ‘보내기 시작’이 없어, 선점 직후 멈춤은 메일 서버 로그인 단계에서 붙잡아 흉내 낸다
  smtp = { hangAt: "EHLO" }
  go(); await settle()
  await old.q("update public.notifications set email_lease_until = now() - interval '1 second' where id = $1", [id])
  smtp = {}
  await go()
  const r = (await old.q("select email_status, emailed_at from public.notifications where id = $1", [id]))[0]
  ok("대조군(운영 지금: 6600까지 DB + v18): 선점 직후(보내기 전) 멈춘 메일이 ‘불확실’로 묶여 다시 보내지 않는다(결함 재현)", r.email_status === "unknown" && !r.emailed_at && delivered.filter((x) => x.includes("mail-old@example.test")).length === 0)
}
// 되돌리기 호환: 이번 DB(6700 이후) + 예전 함수 v18 — v18은 ‘보내기 시작’을 남기지 않으므로 DB가 잡는 순간을 시작으로 본다(보수적).
//   메일 서버가 받은 뒤 기록 전에 멈춰도 다시 보내지 않는다(두 통 없음). 대신 6100처럼 ‘보내기 전 멈춤’도 불확실로 남는다.
{
  const nw = await startEdge({ env: { SMTP_HOST: "smtp.example.test", SMTP_USER: "sender@example.test", SMTP_PASS: "app-password", MAIL_FROM: "플라비 <sender@example.test>" } })
  nw.state.connectTls = async () => fakeConn()
  smtp = {}
  await nw.q("select set_config('app.now', (public.kst_at(public.kst_today(), '13:00'))::text, false)")
  const tok = (await nw.q("select value from public.private_values where name = 'cron_token'"))[0].value
  const h = await nw.load(join(repo, "supabase/tests/edge/fixtures/send-notifications-v18-f3a4df7/index.ts"))
  const go = () => h(new Request("http://edge.test/send-notifications", { method: "POST", headers: { "x-cron-token": tok } }))
  const M = (await nw.q("insert into auth.users (email, raw_user_meta_data) values ('mail-rollback@example.test', $1) returning id", [{ adult: true, terms_version: "t", privacy_version: "t" }]))[0].id
  await nw.q("update public.profiles set notify_email = true where id = $1", [M])
  await nw.q("select public.notify($1, 'new-introduction', '오늘의 인연이 도착했어요', '확인해 주세요.', '/us', 'mail-rollback')", [M])
  const id = (await nw.q("select id from public.notifications where member_id = $1", [M]))[0].id
  nw.state.beforeRpc = async (name) => { if (name === "record_email_result") await never() }
  go(); await settle()
  const delivered1 = delivered.filter((x) => x.includes("mail-rollback@example.test")).length
  nw.state.beforeRpc = null
  await nw.q("update public.notifications set email_lease_until = now() - interval '1 second' where id = $1", [id])
  await go()
  const r = (await nw.q("select email_status, emailed_at from public.notifications where id = $1", [id]))[0]
  ok("되돌리기(이번 DB + 예전 함수 v18): 메일 서버가 받은 뒤 기록 전 멈춤 → 불확실로 남고 다시 보내지 않는다(두 통 없음)", delivered1 === 1 && r.email_status === "unknown" && delivered.filter((x) => x.includes("mail-rollback@example.test")).length === 1)
}
// 배포 순서가 바뀐 경우: 새 함수 v19 + 6700 이전 DB — 새 인자·함수가 없어도 예전 방식으로 보낸다(보내기 시작 구분만 없음)
{
  const od = await startEdge({ until: "20261106006700", env: { SMTP_HOST: "smtp.example.test", SMTP_USER: "sender@example.test", SMTP_PASS: "app-password", MAIL_FROM: "플라비 <sender@example.test>" } })
  od.state.connectTls = async () => fakeConn()
  smtp = {}
  await od.q("select set_config('app.now', (public.kst_at(public.kst_today(), '13:00'))::text, false)")
  const tok = (await od.q("select value from public.private_values where name = 'cron_token'"))[0].value
  const h = await od.load(FN)
  const M = (await od.q("insert into auth.users (email, raw_user_meta_data) values ('mail-order@example.test', $1) returning id", [{ adult: true, terms_version: "t", privacy_version: "t" }]))[0].id
  await od.q("update public.profiles set notify_email = true where id = $1", [M])
  await od.q("select public.notify($1, 'new-introduction', '오늘의 인연이 도착했어요', '확인해 주세요.', '/us', 'mail-order')", [M])
  const res = await (await h(new Request("http://edge.test/send-notifications", { method: "POST", headers: { "x-cron-token": tok } }))).json()
  ok("배포 순서 바뀜(새 함수 v19 + 6700 이전 DB): 예전 방식으로 보낸다(한 통)", res.sent === 1 && delivered.filter((x) => x.includes("mail-order@example.test")).length === 1)
}
// K10 (R4-02 · E01): 메일 설정 없음 — ‘함수가 불림(생존)’과 ‘보낼 수 있음(준비)’을 나눈다
{
  const mk = async (file, env = {}) => {
    const e = await startEdge({ env })
    e.state.connectTls = async () => fakeConn()
    await e.q("select set_config('app.now', (public.kst_at(public.kst_today(), '13:00'))::text, false)")
    const tok = (await e.q("select value from public.private_values where name = 'cron_token'"))[0].value
    const h = await e.load(file)
    const go = async () => (await h(new Request("http://edge.test/send-notifications", { method: "POST", headers: { "x-cron-token": tok } }))).json()
    const runs = () => e.q("select ok, detail from public.job_runs where job = 'email' order by id")
    const health = async () => (await e.q("select public.public_health() v"))[0].v
    const waitOne = async (name) => {
      const M = (await e.q("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [`${name}@example.test`, { adult: true, terms_version: "t", privacy_version: "t" }]))[0].id
      await e.q("update public.profiles set notify_email = true where id = $1", [M])
      await e.q("select public.notify($1, 'new-introduction', '오늘의 인연이 도착했어요', '확인해 주세요.', '/us', $2)", [M, name])
      return M
    }
    return { e, go, runs, health, waitOne }
  }
  // 대조군(고치기 전 함수 8aa3231): 설정 없음 + 대기 1통 → 첫 차례는 실패, 둘째 차례는 ok=true 로 바뀐다(결함 재현 · 검수 E01)
  {
    const c = await mk(join(repo, "supabase/tests/edge/fixtures/send-notifications-v19-8aa3231/index.ts"))
    await c.waitOne("mail-blocked-old")
    await c.go(); await c.go()
    const r = await c.runs()
    ok("K10 대조군(고치기 전 8aa3231): 설정 없음 + 대기 1통의 둘째 차례가 ok=true 로 기록된다(결함 재현)", r.length === 2 && r[0].ok === false && r[1].ok === true && r[1].detail.notConfigured === true)
    ok("K10 대조군: 그래서 공개 상태의 메일 작업이 ‘최근 실패 아님’으로 바뀐다(가짜 정상)", (await c.health()).jobs.find((j) => j.job === "email").lastFailed === false)
  }
  // 고친 함수
  const n = await mk(FN)
  // 설정 없음 + 대기 0통: 성공이 아니다(보낼 수 없음) · 대기 없음으로 구분 · 조용한 줄
  const r0 = await n.go()
  let rows = await n.runs()
  ok("K10: 설정 없음 + 대기 0통 → ok=false · blocked · waiting=false(조용한 줄 zero)", r0.blocked === true && r0.waiting === false && rows.length === 1 && rows[0].ok === false && rows[0].detail.blocked === true && rows[0].detail.waiting === false && rows[0].detail.zero === true && !rows[0].detail.reason)
  // 설정 없음 + 대기 1통: 첫 차례는 경고 줄(reason), 반복 차례는 조용한 줄 — 그래도 계속 ok=false
  const W = await n.waitOne("mail-blocked-new")
  await n.go(); await n.go(); await n.go()
  rows = await n.runs()
  ok("K10: 설정 없음 + 대기 1통 첫 차례 → 경고 줄(ok=false · 이유 · waiting=true)", rows[1].ok === false && /메일 발송 설정/.test(rows[1].detail.reason) && rows[1].detail.waiting === true && rows[1].detail.zero !== true)
  ok("K10: 반복 차례 → 경고 줄은 늘지 않지만(zero) 상태는 계속 ok=false · blocked", rows.length === 4 && rows.slice(2).every((r) => r.ok === false && r.detail.blocked === true && r.detail.zero === true && !r.detail.reason))
  let h = await n.health()
  ok("K10: 공개 상태 — 메일 작업 lastFailed=true · mailReady=false · ok=false(호출은 살아 있어 late=false)", h.jobs.find((j) => j.job === "email").lastFailed === true && h.jobs.find((j) => j.job === "email").late === false && h.mailReady === false && h.ok === false)
  // 한 시간이 지나면 경고 줄을 다시 한 번 남긴다
  await n.e.q("update public.job_runs set started_at = started_at - interval '61 minutes' where job = 'email'")
  await n.go()
  rows = await n.runs()
  ok("K10: 한 시간 뒤에도 그대로면 경고 줄을 다시 한 번 남긴다", rows.length === 5 && /메일 발송 설정/.test(rows[4].detail.reason) && rows[4].ok === false)
  ok("K10: 보내지 못한 메일은 그대로 대기(선점·시도 횟수 변화 없음)", await n.e.q("select email_attempts, emailed_at, email_lease_until from public.notifications where member_id = $1", [W]).then((r) => r[0].email_attempts === 0 && !r[0].emailed_at && !r[0].email_lease_until))
  // 설정 복구: 같은 DB에 설정을 넣으면 보내고 ok=true · mailReady=true
  Object.assign(n.e.state.env, { SMTP_HOST: "smtp.example.test", SMTP_USER: "sender@example.test", SMTP_PASS: "app-password", MAIL_FROM: "플라비 <sender@example.test>" })
  smtp = {}
  const fixed = await n.go()
  rows = await n.runs()
  h = await n.health()
  ok("K10: 설정을 고치면 대기 메일을 보내고 ok=true · mailReady=true 로 돌아온다", fixed.sent === 1 && rows.at(-1).ok === true && !rows.at(-1).detail.blocked && h.mailReady === true && h.jobs.find((j) => j.job === "email").lastFailed === false && delivered.filter((x) => x.includes("mail-blocked-new@example.test")).length === 1)
  // 되돌리기 호환: 고친 함수 + 6800 이전 DB(record_job_run 없음) — 경고 줄만 예전처럼 표에 남기고, ok=true 줄은 만들지 않는다
  {
    const o = await startEdge({ until: "20261106006800", env: {} })
    const tok = (await o.q("select value from public.private_values where name = 'cron_token'"))[0].value
    const hh = await o.load(FN)
    const M = (await o.q("insert into auth.users (email, raw_user_meta_data) values ('mail-blocked-olddb@example.test', $1) returning id", [{ adult: true, terms_version: "t", privacy_version: "t" }]))[0].id
    await o.q("update public.profiles set notify_email = true where id = $1", [M])
    await o.q("select public.notify($1, 'new-introduction', '오늘의 인연이 도착했어요', '확인해 주세요.', '/us', 'mail-blocked-olddb')", [M])
    for (let i = 0; i < 3; i++) await hh(new Request("http://edge.test/send-notifications", { method: "POST", headers: { "x-cron-token": tok } }))
    const r = await o.q("select ok from public.job_runs where job = 'email' order by id")
    ok("K10 되돌리기(고친 함수 + 6800 이전 DB): 경고 줄 한 번(ok=false)만 남고 ok=true 줄은 생기지 않는다", r.length === 1 && r[0].ok === false)
  }
}
console.log(`메일 함수 단계별 멈춤 시험 통과: ${passed}개`)
process.exit(0)
