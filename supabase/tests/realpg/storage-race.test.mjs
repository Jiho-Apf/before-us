// 실제 PostgreSQL 사진 파일 정리 경합 시험(GPT 2차 검수 T02): 정리 함수가 ‘안 쓰임’을 확인한 뒤 파일을 지우기 전에, 회원이 같은 경로를 다시 쓰면?
// 실행: FLAVIE_PG_MODULES=<node_modules> node supabase/tests/realpg/storage-race.test.mjs
// storage-cleanup 함수의 순서를 그대로 흉내 낸다: ① storage_cleanup_recheck(트랜잭션 끝) → (멈춤) → ② Storage API로 파일 지우기(storage.objects 줄 삭제) → ③ 대기열 정리
//  A) 대조군(고치기 전, 20261105006000 빼고 올림): 멈춘 사이 회원이 그 경로를 등록하면 등록된 사진의 파일이 지워진다 → 결함 재현
//  B) 고친 뒤: 멈춘 사이 등록은 ‘정리 중’으로 거절되고, 등록된 사진 중 파일이 없는 것은 없다
//  C) 고친 뒤 반대 순서: 회원 등록이 끝나지 않은 동안 확인하면 그 경로는 건너뛰고, 등록이 끝난 뒤에는 대기열에서 빠진다(파일 유지)
//  D) 고친 뒤 같은 순간 출발 N번(기본 50): 어느 쪽이 먼저든 ‘등록됐는데 파일이 없음’은 한 번도 없다
import assert from "node:assert/strict"
import { startPostgres, prepareDatabase, asUser } from "./env.mjs"

const ROUNDS = Number(process.env.ROUNDS ?? 50)
const log = (...a) => console.log(new Date().toISOString(), ...a)
let passed = 0
const ok = (label, value) => { assert.ok(value, label); passed++; log("✓", label) }
const hex = (n) => n.toString(16).padStart(64, "0")

async function world(until) {
  const server = await startPostgres()
  const main = await server.connect(), worker = await server.connect(), member = await server.connect(), gate = await server.connect()
  await prepareDatabase(main, { until })
  const signup = async (email) => (await main.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, { adult: true, terms_version: "t", privacy_version: "t" }])).rows[0].id
  const asWorker = async () => { await asUser(worker, "postgres"); await worker.query("set role service_role") }
  let seq = 0
  // 이틀 넘게 쓰이지 않아 정리 대기열에 오른 사진 파일 하나
  const orphan = async (X) => {
    const path = `${X}/photo.face-${++seq}.jpg`
    await main.query("insert into storage.objects (bucket_id, name, owner, created_at) values ('application-photos', $1, $2, now() - interval '3 days')", [path, X])
    await main.query("insert into public.storage_cleanup (bucket, path) values ('application-photos', $1)", [path])
    return path
  }
  const register = (X, path) => asUser(member, X).then(() => member.query("select public.register_photo('photo.face', $1, 'image/jpeg', 1000, 800, 1000, $2, true, true)", [path, hex(++seq)]))
  // Storage API의 remove 흉내 + 대기열 정리(고친 뒤에는 storage_cleanup_done, 예전에는 표에서 직접)
  const removeFiles = async (paths) => {
    if (!paths.length) return
    await asUser(main, "postgres")
    await main.query("delete from storage.objects where bucket_id = 'application-photos' and name = any($1)", [paths])
    if (until) await main.query("delete from public.storage_cleanup where bucket = 'application-photos' and path = any($1)", [paths])
    else await main.query("select public.storage_cleanup_done('application-photos', $1)", [paths])
  }
  const broken = async () => (await main.query("select count(*)::int n from public.application_photos ap where not exists (select 1 from storage.objects o where o.bucket_id = 'application-photos' and o.name = ap.path)")).rows[0].n
  const fileExists = async (path) => (await main.query("select count(*)::int n from storage.objects where name = $1", [path])).rows[0].n === 1
  const registered = async (path) => (await main.query("select count(*)::int n from public.application_photos where path = $1", [path])).rows[0].n === 1
  return { server, main, worker, member, gate, signup, asWorker, orphan, register, removeFiles, broken, fileExists, registered,
    close: async () => { for (const c of [main, worker, member, gate]) await c.end().catch(() => {}); await server.stop() } }
}

const watchdog = setTimeout(() => { log("시간 초과"); process.exit(3) }, Number(process.env.WATCHDOG_MS ?? 300000))
try {
  // ── A) 대조군: 고치기 전
  {
    const w = await world("20261105006000")
    log("대조군 준비 완료(20261105006000 이전 마이그레이션만)")
    const X = await w.signup("race-old@example.test")
    const P = await w.orphan(X)
    await w.asWorker()
    const safe = (await w.worker.query("select public.storage_cleanup_recheck('application-photos', $1) v", [[P]])).rows[0].v
    // ── 여기서 멈춤: 정리 함수가 Storage API를 부르기 직전
    const result = await w.register(X, P).then(() => "등록됨", (e) => `거절: ${e.message}`)
    await w.removeFiles(safe)
    log("대조군: 확인 결과", JSON.stringify(safe), "· 멈춘 사이 등록:", result, "· 파일:", await w.fileExists(P), "· 파일 없는 등록 사진:", await w.broken())
    ok("대조군(고치기 전): 확인과 삭제 사이에 등록한 사진의 파일이 지워진다(결함 재현)", result === "등록됨" && (await w.registered(P)) && (await w.broken()) === 1)
    await w.close()
  }

  // ── B~D) 고친 뒤
  {
    const w = await world(undefined)
    log("고친 뒤 준비 완료(마이그레이션 전부)")
    {
      const X = await w.signup("race-new@example.test")
      const P = await w.orphan(X)
      await w.asWorker()
      const safe = (await w.worker.query("select public.storage_cleanup_recheck('application-photos', $1) v", [[P]])).rows[0].v
      const result = await w.register(X, P).then(() => "등록됨", (e) => `거절: ${e.message}`)
      await w.removeFiles(safe)
      log("B: 확인 결과", JSON.stringify(safe), "· 멈춘 사이 등록:", result)
      ok("B: 지우는 중인 경로를 등록하면 ‘정리 중’으로 거절된다", result.startsWith("거절") && /정리 중/.test(result))
      ok("B: 파일은 지워졌고, 그 파일을 가리키는 등록 사진은 없다", !(await w.fileExists(P)) && !(await w.registered(P)) && (await w.broken()) === 0)
      ok("B: 대기열에서도 빠졌다", (await w.main.query("select count(*)::int n from public.storage_cleanup where path = $1", [P])).rows[0].n === 0)
    }
    {
      const X = await w.signup("race-reverse@example.test")
      const P = await w.orphan(X)
      await asUser(w.member, X)
      await w.member.query("begin")
      await w.member.query("select public.register_photo('photo.face', $1, 'image/jpeg', 1000, 800, 1000, $2, true, true)", [P, hex(990001)])
      await w.asWorker()
      const t0 = Date.now()
      const during = (await w.worker.query("select public.storage_cleanup_recheck('application-photos', $1) v", [[P]])).rows[0].v
      const waited = Date.now() - t0
      await w.member.query("commit")
      const after = (await w.worker.query("select public.storage_cleanup_recheck('application-photos', $1) v", [[P]])).rows[0].v
      await w.removeFiles([...during, ...after])
      log("C: 등록 중 확인", JSON.stringify(during), `(${waited}ms) · 등록 뒤 확인`, JSON.stringify(after))
      ok("C: 등록이 끝나지 않은 경로는 기다리지 않고 건너뛴다", during.length === 0 && waited < 2000)
      ok("C: 등록이 끝난 뒤에는 쓰이는 경로라 지우지 않고 대기열에서 뺀다", after.length === 0 && (await w.fileExists(P)) && (await w.registered(P))
        && (await w.main.query("select count(*)::int n from public.storage_cleanup where path = $1", [P])).rows[0].n === 0)
    }
    {
      const X = await w.signup("race-rounds@example.test")
      const tally = { registered: 0, refused: 0, broken: 0, other: 0 }
      for (let round = 0; round < ROUNDS; round++) {
        const P = await w.orphan(X)
        await w.gate.query("select pg_advisory_lock(4242)")
        await w.asWorker()
        await asUser(w.member, X)
        const cleaner = (async () => {
          await w.worker.query("begin")
          await w.worker.query("select pg_advisory_xact_lock_shared(4242)")
          // 순서를 섞는다: 짝수 번째는 정리 쪽이 조금 늦게 출발(회원 등록이 먼저 끝나는 경우도 만든다)
          if (round % 2 === 0) await w.worker.query("select pg_sleep($1)", [Math.random() * 0.02])
          const safe = (await w.worker.query("select public.storage_cleanup_recheck('application-photos', $1) v", [[P]])).rows[0].v
          await w.worker.query("commit")
          return safe
        })()
        const registering = (async () => {
          await w.member.query("begin")
          try {
            await w.member.query("select pg_advisory_xact_lock_shared(4242)")
            await w.member.query("select public.register_photo('photo.face', $1, 'image/jpeg', 1000, 800, 1000, $2, true, true)", [P, hex(500000 + round)])
            await w.member.query("commit")
            return "등록됨"
          } catch (e) { await w.member.query("rollback"); return `거절: ${e.message}` }
        })()
        await new Promise((r) => setTimeout(r, 5))
        await w.gate.query("select pg_advisory_unlock(4242)")
        const [safe, result] = await Promise.all([cleaner, registering])
        await w.removeFiles(safe)
        const bad = await w.broken()
        if (bad) tally.broken++
        else if (result === "등록됨") tally.registered++
        else if (/정리 중/.test(result)) tally.refused++
        else { tally.other++; log("D: 예상 밖 결과", result) }
      }
      log(`D: 같은 순간 출발 ${ROUNDS}번`, JSON.stringify(tally))
      ok(`D: ${ROUNDS}번 모두 ‘등록됐는데 파일이 없음’은 없다`, tally.broken === 0 && tally.other === 0 && tally.registered + tally.refused === ROUNDS)
      ok("D: 두 순서(등록 먼저 · 정리 먼저)가 모두 나왔다", tally.registered > 0 && tally.refused > 0)
    }
    await w.close()
  }
  log(`실제 PostgreSQL 사진 정리 경합 시험 통과: ${passed}개`)
} finally {
  clearTimeout(watchdog)
}
