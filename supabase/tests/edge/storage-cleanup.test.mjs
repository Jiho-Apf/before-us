// 사진 파일 정리 함수(storage-cleanup)의 DB·함수 버전 조합 시험(GPT 3차 검수 R3-13·R3-20). 가짜 자료만 쓴다.
// 실행: node supabase/tests/edge/storage-cleanup.test.mjs
// 함수 원본을 Node에서 그대로 돌린다(harness.mjs): b27a043(예전 · 표 직접 삭제) · v8(f3a4df7 운영) · v9(이번 변경).
// DB: ‘운영 지금’ = 20261106006500 이전 마이그레이션까지 · ‘이번 변경 뒤’ = 전부.
//  1) 조합마다: 쓰이지 않는 파일만 지우고 쓰이는 파일은 남김 · 401 · 지우기 실패 뒤 다음 차례 · 정리 중인 경로 등록 거절
//  2) v9 + 운영 지금 DB = 새 함수가 없어 아무것도 지우지 않음 → ‘사용 금지 조합’(배포 순서: 마이그레이션 먼저)
//  3) 늦게 끝난 예전 작업이 새 작업의 선점을 풀거나 지우지 못함(선점 표) · 대조군(운영 지금 DB)에서는 다시 등록한 파일이 지워짐
//  4) 하루 1회 정리로 되돌리면 탈퇴 7일 기한을 넘김(일정 계산) → 대체 실행 없이 쓰지 않음
import assert from "node:assert/strict"
import { join } from "node:path"
import { startEdge, fixture, repo } from "./harness.mjs"
import { serial } from "./fake-supabase.mjs"

let passed = 0
const ok = (label, value) => { assert.ok(value, label); passed++; console.log("✓", label) }
const V9 = join(repo, "supabase/functions/storage-cleanup/index.ts")
const WORKERS = { b27a043: fixture("storage-cleanup-b27a043.ts"), v8: fixture("storage-cleanup-v8-f3a4df7.ts"), v9: V9 }
const OLD_DB = "20261106006500"
const hex = (n) => n.toString(16).padStart(64, "0")
let seq = 0

async function world(until) {
  const edge = await startEdge({ until })
  const token = (await edge.q("select value from public.private_values where name = 'cron_token'"))[0].value
  const call = (handler, withToken = true) => handler(new Request("http://edge.test/storage-cleanup", { method: "POST", headers: withToken ? { "x-cron-token": token } : {} }))
  const signup = async () => (await edge.q("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [`sc-${++seq}@example.test`, { adult: true, terms_version: "t", privacy_version: "t" }]))[0].id
  const asMember = (id, sql, params = []) => serial(async () => {
    await edge.db.query("begin")
    try {
      await edge.db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated", aal: "aal1" })])
      await edge.db.query("set local role authenticated")
      const rows = (await edge.db.query(sql, params)).rows
      await edge.db.query("commit")
      return rows
    } catch (error) { await edge.db.query("rollback"); throw error }
  })
  const orphan = async (X, name) => {
    const path = `${X}/${name}-${++seq}.jpg`
    await edge.q("insert into storage.objects (bucket_id, name, owner, created_at) values ('application-photos', $1, $2, now() - interval '3 days')", [path, X])
    await edge.q("insert into public.storage_cleanup (bucket, path) values ('application-photos', $1)", [path])
    return path
  }
  const exists = async (path) => (await edge.q("select count(*)::int n from storage.objects where name = $1", [path]))[0].n === 1
  const queued = async (path) => (await edge.q("select count(*)::int n from public.storage_cleanup where path = $1", [path]))[0].n === 1
  const broken = async () => (await edge.q("select count(*)::int n from public.application_photos ap where not exists (select 1 from storage.objects o where o.bucket_id = 'application-photos' and o.name = ap.path)"))[0].n
  const register = (X, path) => asMember(X, "select public.register_photo('photo.face', $1, 'image/jpeg', 1000, 800, 1000, $2, true, true)", [path, hex(++seq)]).then(() => "등록됨", (e) => `거절: ${e.message}`)
  return { edge, call, signup, orphan, exists, queued, broken, register }
}

// ── 1) 조합별 기본 동작
const combos = [["운영 지금(6400까지)", OLD_DB, ["b27a043", "v8"]], ["이번 변경 뒤(6600 포함)", undefined, ["b27a043", "v8", "v9"]]]
for (const [dbName, until, workers] of combos) {
  for (const version of workers) {
    const w = await world(until)
    const handler = await w.edge.load(WORKERS[version])
    const tag = `${dbName} + ${version}`
    const X = await w.signup()
    const used = `${X}/photo.face-used-${++seq}.jpg`
    await w.edge.q("insert into storage.objects (bucket_id, name, owner) values ('application-photos', $1, $2)", [used, X])
    const usedResult = await w.register(X, used)
    await w.edge.q("insert into public.storage_cleanup (bucket, path) values ('application-photos', $1)", [used])
    const A = await w.orphan(X, "photo.upper"), B = await w.orphan(X, "photo.style")
    ok(`${tag}: 열쇠 없이 부르면 401`, (await w.call(handler, false)).status === 401)
    // 지우기 실패 → 이번 차례는 아무것도 지우지 않음
    w.edge.state.storageFail = (op) => (op === "remove" ? "시험용 저장소 오류" : null)
    const failed = await w.call(handler)
    w.edge.state.storageFail = null
    const claims = await w.edge.q("select count(*)::int n from public.storage_cleanup where claimed_at is not null")
    ok(`${tag}: 지우기가 실패하면 500 · 파일은 그대로 · 작업 기록(실패)`, failed.status === 500 && (await w.exists(A)) && (await w.exists(B))
      && (await w.edge.q("select ok from public.job_runs where job = 'storage-cleanup' order by id desc limit 1"))[0].ok === false)
    if (version === "b27a043") {
      ok(`${tag}: (예전 함수) 실패해도 선점을 풀지 않는다 → 30분 동안 그 경로 등록은 거절`, claims[0].n === 2 && /정리 중/.test(await w.register(X, A)))
      await w.edge.q("update public.storage_cleanup set claimed_at = now() - interval '31 minutes' where claimed_at is not null")
    } else {
      ok(`${tag}: 실패하면 선점을 푼다(다음 차례에 다시)`, claims[0].n === 0)
    }
    const res = await (await w.call(handler)).json()
    ok(`${tag}: 다음 차례에 쓰이지 않는 파일 둘을 지우고 대기열에서 뺀다`, res.removed === 2 && !(await w.exists(A)) && !(await w.exists(B)) && !(await w.queued(A)) && !(await w.queued(B)))
    ok(`${tag}: 쓰이는 파일(등록된 신청 사진)은 지우지 않는다`, usedResult === "등록됨" && (await w.exists(used)) && (await w.broken()) === 0)
    // 목록을 받은 뒤 ‘지우기 직전 확인’ 전에 다시 쓰이게 된 파일: 지우지 않고 대기열에서 뺀다
    const Q = await w.orphan(X, "photo.upper")
    let reused = null
    w.edge.state.beforeRpc = async (name) => { if (["storage_cleanup_recheck", "storage_cleanup_claim"].includes(name) && reused === null) reused = await w.register(X, Q) }
    await w.call(handler)
    w.edge.state.beforeRpc = null
    ok(`${tag}: 목록을 받은 뒤 다시 등록된 파일은 지우지 않고 대기열에서 뺀다`, reused === "등록됨" && (await w.exists(Q)) && !(await w.queued(Q)) && (await w.broken()) === 0)
    // 선점 중 등록 거절(지우기 직전에 멈춘 사이 회원이 같은 경로를 등록)
    const P = await w.orphan(X, "photo.daily")
    let during = null
    w.edge.state.beforeStorage = async (op, bucket, paths) => { if (paths.includes(P)) during = await w.register(X, P) }
    await w.call(handler)
    w.edge.state.beforeStorage = null
    ok(`${tag}: 지우는 중인 경로를 등록하면 ‘정리 중’으로 거절되고, 파일 없는 등록 사진은 없다`, /정리 중/.test(during ?? "") && (await w.broken()) === 0)
  }
}

// ── 2) v9 + 운영 지금 DB: 새 선점 함수가 없다 → 아무것도 지우지 않고 실패만 남김(사용 금지 · 배포 순서)
{
  const w = await world(OLD_DB)
  const handler = await w.edge.load(V9)
  const X = await w.signup()
  const A = await w.orphan(X, "photo.upper")
  const res = await w.call(handler)
  const run = (await w.edge.q("select ok, detail from public.job_runs where job = 'storage-cleanup' order by id desc limit 1"))[0]
  ok("금지 조합(운영 지금 DB + v9): 파일을 지우지 못하고 실패로 남는다 → 마이그레이션 6600을 먼저 적용해야 한다", res.status === 500 && (await w.exists(A)) && run.ok === false && /storage_cleanup_claim/.test(run.detail.error))
}

// ── 3) 늦게 끝난 예전 작업(W1) ↔ 30분 뒤 다시 선점한 새 작업(W2)
//    W1이 파일을 지운 뒤 대기열 줄을 정리하기 직전에 멈춤 → (30분 지남) → W2가 같은 경로를 선점하고 파일을 지우기 직전에 멈춤
//    → W1이 깨어나 줄을 정리(표 직접 삭제 또는 2인자 done) → 회원이 같은 경로에 새 파일을 올려 등록 시도 → W2가 파일 지우기
for (const [label, until, stale, fresh, expectSafe] of [
  ["대조군(운영 지금 DB · b27a043 ↔ v8)", OLD_DB, "b27a043", "v8", false],
  ["대조군(운영 지금 DB · v8 ↔ v8)", OLD_DB, "v8", "v8", false],
  ["한계(이번 DB에서 v8로 되돌린 뒤 · v8 ↔ v8: 표 없는 선점끼리는 보호 못 함 → Edge 실행 상한만 남음)", undefined, "v8", "v8", false],
  ["이번 변경 뒤(b27a043 ↔ v9)", undefined, "b27a043", "v9", true],
  ["이번 변경 뒤(v8 ↔ v9)", undefined, "v8", "v9", true],
]) {
  const w = await world(until)
  const h1 = await w.edge.load(WORKERS[stale]), h2 = await w.edge.load(WORKERS[fresh])
  const X = await w.signup()
  const P = await w.orphan(X, "photo.face")
  let wake1, paused1 = new Promise((r) => { wake1 = r }), reached1
  const atW1 = new Promise((r) => { reached1 = r })
  let wake2, paused2 = new Promise((r) => { wake2 = r }), reached2
  const atW2 = new Promise((r) => { reached2 = r })
  let phase = 1
  // W1: 줄 정리 직전에 멈춤(b27a043은 표 삭제, v8은 storage_cleanup_done)
  w.edge.state.beforeQuery = async (table, op) => { if (phase === 1 && table === "storage_cleanup" && op === "delete") { reached1(); await paused1 } }
  w.edge.state.beforeRpc = async (name) => { if (phase === 1 && name === "storage_cleanup_done") { reached1(); await paused1 } }
  const run1 = w.call(h1)
  await atW1
  await w.edge.q("update public.storage_cleanup set claimed_at = now() - interval '31 minutes' where path = $1", [P])
  // W2: 다시 선점한 뒤 파일을 지우기 직전에 멈춤
  phase = 2
  w.edge.state.beforeStorage = async (op, bucket, paths) => { if (phase === 2 && paths.includes(P)) { reached2(); await paused2 } }
  const run2 = w.call(h2)
  await atW2
  phase = 3
  wake1(); await run1
  // 회원이 같은 경로에 새 파일을 올리고 등록을 시도한다
  await w.edge.q("insert into storage.objects (bucket_id, name, owner) values ('application-photos', $1, $2) on conflict do nothing", [P, X])
  const result = await w.register(X, P)
  wake2(); await run2
  w.edge.state.beforeQuery = w.edge.state.beforeRpc = w.edge.state.beforeStorage = null
  const brokenCount = await w.broken()
  console.log(`  ${label}: 등록 시도 → ${result} · 파일 없는 등록 사진 ${brokenCount}`)
  if (expectSafe) ok(`${label}: 늦게 끝난 예전 작업은 새 작업의 선점 줄을 지우지 못해, 같은 경로 등록은 거절되고 파일 없는 등록 사진은 없다`, /정리 중/.test(result) && brokenCount === 0)
  else ok(`${label}: (결함 재현) 늦게 끝난 작업이 새 선점 줄을 지워 경로가 풀리고, 다시 등록한 사진의 파일이 지워진다`, result === "등록됨" && brokenCount === 1)
}
// 선점 표: 늦은 작업이 풀거나(unclaim) 정리(finish)하려 해도 다른 표의 선점은 그대로
{
  const w = await world(undefined)
  const X = await w.signup()
  const P = await w.orphan(X, "photo.face")
  const svc = (sql, params) => serial(async () => { await w.edge.db.query("begin"); await w.edge.db.query("set local role service_role"); const r = (await w.edge.db.query(sql, params)).rows; await w.edge.db.query("commit"); return r })
  const t1 = (await svc("select public.storage_cleanup_claim('application-photos', $1) v", [[P]]))[0].v
  await w.edge.q("update public.storage_cleanup set claimed_at = now() - interval '31 minutes' where path = $1", [P])
  const t2 = (await svc("select public.storage_cleanup_claim('application-photos', $1) v", [[P]]))[0].v
  ok("선점 표: 30분 지난 선점은 새 표로 다시 선점된다", t1.paths[0] === P && t2.paths[0] === P && t1.claim !== t2.claim)
  const unclaimed = (await svc("select public.storage_cleanup_unclaim('application-photos', $1, $2) n", [[P], t1.claim]))[0].n
  const finished = (await svc("select public.storage_cleanup_finish('application-photos', $1, $2) n", [[P], t1.claim]))[0].n
  const released = (await svc("select public.storage_cleanup_release('application-photos', $1) n", [[P]]))[0].n
  const done = (await svc("select public.storage_cleanup_done('application-photos', $1) n", [[P]]))[0].n
  ok("선점 표: 예전 표·2인자 함수로는 새 표의 선점을 풀거나 지우지 못한다", unclaimed === 0 && finished === 0 && released === 0 && done === 0 && (await w.queued(P)))
  await svc("delete from public.storage_cleanup where path = $1", [[P][0]])
  ok("선점 표: 표를 직접 지우는 예전 방식(service_role 표 삭제)으로도 지워지지 않는다", await w.queued(P))
  ok("선점 표: 맞는 표로만 정리된다", (await svc("select public.storage_cleanup_finish('application-photos', $1, $2) n", [[P], t2.claim]))[0].n === 1 && !(await w.queued(P)))
}

// ── 4) 일정 계산: 하루 1회(예전 04:00 KST)로 되돌리면 탈퇴 7일 기한을 넘긴다 / 매시간 :45는 지킨다
{
  const worst = (cleanup) => {
    const withdrawMinute = 15, windowHours = 2
    let late = -Infinity
    for (let minute = 0; minute < 60 * 24; minute++) {
      const dueAt = minute + 7 * 24 * 60
      const run = Math.ceil((dueAt - windowHours * 60 - withdrawMinute) / 60) * 60 + withdrawMinute
      late = Math.max(late, cleanup(run) - dueAt)
    }
    return late
  }
  const hourly = (run) => { let t = Math.ceil((run - 45) / 60) * 60 + 45; if (t < run) t += 60; return t }
  const daily = (run) => { const at = 19 * 60; let t = Math.floor(run / 1440) * 1440 + at; if (t < run) t += 1440; return t }
  const h = worst(hourly), d = worst(daily)
  console.log(`  일정 계산: 매시간 :45 → 가장 늦어도 기한 ${-h}분 전 · 하루 1회 04:00 → 가장 늦으면 기한 ${Math.round(d / 60)}시간 뒤`)
  ok("일정: 매시간 :45 정리는 요청 시각과 상관없이 기한 전", h < 0)
  ok("일정: 하루 1회(04:00)로 되돌리면 기한을 넘기는 경우가 있다 → 대체 실행 없이 쓰지 않음", d > 0)
}
console.log(`사진 정리 함수 조합 시험 통과: ${passed}개`)
