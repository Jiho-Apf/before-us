// 실제 PostgreSQL 동시 실행 시험(GPT 2차 검수 T01·C1): 서로 다른 연결 두 개를 겹치게 실행한다.
// 실행: FLAVIE_PG_MODULES=<node_modules> node supabase/tests/realpg/concurrency.test.mjs
//  1) 강제로 겹치기: 연결 1이 예약을 끝내지 않은 채(트랜잭션 열어 둠) 연결 2가 같은 회원을 예약 → 연결 2가 잠금에서 기다리는지 확인 → 연결 1 확정 → 연결 2 거절
//  2) 동시에 출발: 세 번째 연결이 잡은 잠금(advisory)을 풀면 두 연결이 같은 순간 예약을 시작 → 매번 하나만 성공(반복)
//  3) 다른 생성 경로(소개 표에 직접 넣기)도 같은 방식으로
//  4) 대조군: 막는 장치(트리거)를 끄면 둘 다 들어가는 것을 보여 시험이 결함을 잡을 수 있음을 확인
//  5) 약속(C1): 연락처 동의 ↔ 약속 바꾸기, 제안 수락 ↔ 다시 제안 을 겹쳐 실행
//  6) 메일(T06): 두 작업이 같은 순간 메일을 잡아도 겹치지 않음(반복)
//  7) 결제(T10): 같은 항목의 두 주문이 같은 순간 완료로 기록돼도 하나만 완료(반복)
import assert from "node:assert/strict"
import { startPostgres, prepareDatabase, asUser } from "./env.mjs"

const ROUNDS = Number(process.env.ROUNDS ?? 50)
const log = (...a) => console.log(new Date().toISOString(), ...a)
let passed = 0
const ok = (label, value) => { assert.ok(value, label); passed++; log("✓", label) }

const server = await startPostgres()
// 어디서 멈추면 원인을 남기고 끝낸다(잠금이 풀리지 않는 결함도 여기서 드러난다).
const watchdog = setTimeout(async () => { log("시간 초과 — 기다리는 연결:"); try { const c = await server.connect(); log(JSON.stringify((await c.query("select pid, state, wait_event_type, left(query, 120) q from pg_stat_activity where datname = 'flavie'")).rows)) } catch {} await server.stop(); process.exit(3) }, Number(process.env.WATCHDOG_MS ?? 240000))
const main = await server.connect(), c1 = await server.connect(), c2 = await server.connect(), gate = await server.connect()
try {
  await prepareDatabase(main)
  log("마이그레이션 적용 완료")
  // 화면 확인용과 같게 1기가 이미 시작된 것으로 둔다(예약 날짜 검사 통과용).
  await main.query("update public.cohorts set starts_on = public.kst_today() - 1, application_deadline = public.kst_today() - 5 where number = 1")
  const q = async (c, who, sql, params = [], aal) => { await asUser(c, who, aal); const r = await c.query(sql, params); await asUser(c, "postgres"); return r.rows }
  const signup = async (email) => (await main.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, { adult: true, terms_version: "t", privacy_version: "t" }])).rows[0].id
  const O = await signup("owner@example.test")
  await main.query("insert into public.admin_roles (user_id, role) values ($1, 'owner')", [O])
  const hex = (n) => n.toString(16).padStart(64, "0")
  let seq = 0
  const member = async (name, gender, desired) => {
    const id = await signup(`${name}-${++seq}@example.test`)
    const values = { "self.name": name, "self.birthDate": "1995-06-06", "self.gender": gender, "desired.gender": desired, "self.province": "서울", "self.area": "마포구", "self.purpose": "천천히 알아가며 연애", "self.bio": "산책을 좋아해요. 천천히 알아가고 싶어요.", "self.statement": true, "self.pledge": true, "self.phone": `010-4${String(seq).padStart(3, "0")}-${String(seq).padStart(4, "0")}`, "self.notifyChannels": ["카카오톡", "메일"], "consent.collection": true, "consent.matching": true, "consent.provision": true, "consent.review": true, "consent.noon": true }
    await q(main, id, "select public.save_application_draft($1)", [{ values, sharing: { "self.name": true, "self.age": true, "self.province": true, "self.area": true, "self.purpose": true, "self.bio": true }, step: 3, visited: [0, 1, 2, 3] }])
    for (const [i, slot] of ["photo.face", "photo.upper", "photo.style"].entries()) await q(main, id, "select public.register_photo($1, $2, 'image/jpeg', 1000, 800, 1000, $3, true, true)", [slot, `${id}/${slot}-${i}.jpg`, hex(seq * 10 + i)])
    await q(main, id, "select public.submit_application()")
    for (const slot of ["photo.face", "photo.upper", "photo.style"]) await q(main, O, "select public.admin_review_photo($1, $2, '기준 확인')", [id, slot], "aal2")
    await q(main, O, "select public.admin_decide_application($1, 'approved')", [id], "aal2")
    await q(main, O, "select public.admin_move_member_cohort($1, 1)", [id], "aal2")
    return id
  }
  const reserveSql = "select public.admin_reserve_introduction($1, $2, (public.kst_today() + 3), '두 분 모두 산책을 좋아하셨어요.') id"
  const openIntros = async (m) => (await main.query("select count(*)::int n from public.introductions where (member_a = $1 or member_b = $1) and status in ('reserved', 'published', 'mutual')", [m])).rows[0].n
  const waitingOnLock = async (pid) => { for (let i = 0; i < 50; i++) { const r = (await main.query("select wait_event_type from pg_stat_activity where pid = $1", [pid])).rows[0]; if (r?.wait_event_type === "Lock") return true; await new Promise((s) => setTimeout(s, 40)) } return false }
  const pidOf = async (c) => (await c.query("select pg_backend_pid() p")).rows[0].p

  // ── 1) 강제로 겹치기(예약 함수)
  {
    const A = await member("가윤", "여성", "남성"), B = await member("나준", "남성", "여성"), C = await member("다훈", "남성", "여성")
    const before = { notes: (await main.query("select count(*)::int n from public.notifications")).rows[0].n, pay: (await main.query("select count(*)::int n from public.payments")).rows[0].n }
    await asUser(c1, O, "aal2"); await asUser(c2, O, "aal2")
    await c1.query("begin")
    const first = (await c1.query(reserveSql, [A, B])).rows[0].id
    const pid2 = await pidOf(c2)
    const second = c2.query(reserveSql, [A, C]).then(() => "성공", (e) => `거절: ${e.message}`)
    ok("T01 강제 겹치기: 연결 2는 연결 1이 끝날 때까지 회원 잠금에서 기다린다", await waitingOnLock(pid2))
    await c1.query("commit")
    const result = await second
    log("연결 2 결과:", result)
    ok("T01 강제 겹치기: 연결 1이 확정되면 연결 2는 거절된다", result.startsWith("거절") && /진행 중|예약된/.test(result))
    ok("T01 강제 겹치기: 회원 A의 열린 소개는 하나뿐", (await openIntros(A)) === 1 && !!first)
    ok("T01 강제 겹치기: 거절된 쪽(A–C)은 소개·사본·알림·결제 기록을 남기지 않는다",
      (await main.query("select count(*)::int n from public.introductions where (member_a = $1 and member_b = $2) or (member_a = $2 and member_b = $1)", [A, C])).rows[0].n === 0
      && (await main.query("select count(*)::int n from public.notifications")).rows[0].n === before.notes
      && (await main.query("select count(*)::int n from public.payments")).rows[0].n === before.pay)
    await asUser(c1, "postgres"); await asUser(c2, "postgres")
  }

  // ── 2) 같은 순간 출발(반복)
  {
    const A = await member("라온", "여성", "남성"), B = await member("마루", "남성", "여성"), C = await member("바다", "남성", "여성")
    const tally = { one: 0, both: 0, none: 0 }
    for (let round = 0; round < ROUNDS; round++) {
      await gate.query("select pg_advisory_lock(4242)")
      const run = (c, b) => (async () => {
        await asUser(c, O, "aal2")
        await c.query("begin")
        try {
          await c.query("select pg_advisory_xact_lock_shared(4242)") // 트랜잭션이 끝나면 저절로 풀린다(실패해도)
          await c.query(reserveSql, [A, b])
          await c.query("commit"); return 1
        } catch { await c.query("rollback"); return 0 } finally { await asUser(c, "postgres") }
      })()
      const runs = [run(c1, B), run(c2, C)]
      await new Promise((s) => setTimeout(s, 30))
      await gate.query("select pg_advisory_unlock(4242)")
      const wins = (await Promise.all(runs)).reduce((a, b) => a + b, 0)
      tally[wins === 1 ? "one" : wins === 2 ? "both" : "none"]++
      if (wins === 2 || (await openIntros(A)) !== wins) log("이상:", round, wins, await openIntros(A))
      await main.query("delete from public.introductions where member_a = $1 or member_b = $1", [A])
    }
    log(`동시 출발 ${ROUNDS}번:`, JSON.stringify(tally))
    ok(`T01 동시 출발 ${ROUNDS}번: 매번 정확히 하나만 성공`, tally.one === ROUNDS)
  }

  // ── 3) 다른 생성 경로: 소개 표에 직접 넣기(트리거가 막는다)
  const insertSql = "insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b) values ($1, $2, '직접 넣기로 만든 시험 소개예요.', 'reserved', now() + interval '1 day', now() + interval '2 days', now() + interval '2 days', '{}', '{}') returning id"
  {
    const A = await member("사랑", "여성", "남성"), B = await member("아톰", "남성", "여성"), C = await member("자두", "남성", "여성")
    await c1.query("begin")
    await c1.query(insertSql, [A, B])
    const pid2 = await pidOf(c2)
    const second = c2.query(insertSql, [A, C]).then(() => "성공", (e) => `거절: ${e.message}`)
    ok("T01 직접 넣기: 두 번째 연결은 잠금에서 기다린다", await waitingOnLock(pid2))
    await c1.query("commit")
    const result = await second
    log("직접 넣기 연결 2 결과:", result)
    ok("T01 직접 넣기: 첫 번째가 확정되면 두 번째는 거절", result.startsWith("거절"))
    ok("T01 직접 넣기: 회원 A의 열린 소개는 하나뿐", (await openIntros(A)) === 1)
    // 예약 함수 ↔ 직접 넣기 섞어서
    const D = await member("차미", "여성", "남성"), E = await member("카이", "남성", "여성"), F = await member("타오", "남성", "여성")
    await asUser(c1, O, "aal2")
    await c1.query("begin")
    await c1.query(reserveSql, [D, E])
    const pid = await pidOf(c2)
    const mixed = c2.query(insertSql, [D, F]).then(() => "성공", (e) => `거절: ${e.message}`)
    ok("T01 섞어서: 직접 넣기도 예약 함수의 잠금을 기다린다", await waitingOnLock(pid))
    await c1.query("commit"); await asUser(c1, "postgres")
    ok("T01 섞어서: 하나만 남는다", (await mixed).startsWith("거절") && (await openIntros(D)) === 1)
  }

  // ── 4) 대조군: 막는 장치를 끄면 겹친다(이 시험이 결함을 실제로 잡는지 확인) — 끝나면 다시 켠다
  {
    const A = await member("파랑", "여성", "남성"), B = await member("하늘", "남성", "여성"), C = await member("구름", "남성", "여성")
    await main.query("alter table public.introductions disable trigger introductions_one_at_a_time")
    try {
      await c1.query("begin"); await c1.query(insertSql, [A, B])
      const second = c2.query(insertSql, [A, C]).then(() => "성공", (e) => `거절: ${e.message}`)
      await c1.query("commit")
      ok("대조군: 막는 장치를 끄면 한 회원에게 소개가 둘 들어간다(시험이 결함을 잡을 수 있음)", (await second) === "성공" && (await openIntros(A)) === 2)
    } finally {
      await main.query("alter table public.introductions enable trigger introductions_one_at_a_time")
    }
  }

  // ── 5) 약속(C1): 동의 ↔ 약속 바꾸기, 수락 ↔ 다시 제안
  {
    const M = await member("나연", "여성", "남성"), P = await member("태오", "남성", "여성")
    const intro = (await q(main, O, reserveSql, [M, P], "aal2"))[0].id
    await main.query("update public.introductions set reveal_at = now() - interval '1 minute', respond_by = now() + interval '23 hours', view_until = now() + interval '23 hours' where id = $1", [intro])
    await main.query("select public.run_noon()")
    for (const m of [M, P]) { await q(main, m, "select public.record_introduction_view($1)", [intro]); await q(main, m, "select public.respond_introduction($1, 'positive')", [intro]) }
    const prog = (await q(main, M, "select public.my_program() v"))[0].v.id
    for (const m of [M, P]) await q(main, m, "select public.choose_program_plan($1, 'A')", [prog])
    const start = (await main.query("select (public.kst_today() + 2)::text d")).rows[0].d
    await q(main, P, "select public.propose_program_start($1, $2::date)", [prog, start])
    await q(main, M, "select public.confirm_program($1, $2::date)", [prog, start])
    // 사흘을 실제 함수로 지나 넷째 날까지(시계는 연결마다 따로라 세 연결 모두 옮긴다)
    const at = async (date, time) => { const t = (await main.query("select public.kst_at($1::date, $2::time)::text t", [date, time])).rows[0].t; for (const c of [main, c1, c2]) await c.query("select set_config('app.now', $1, false)", [t]) }
    const plus = async (date, days) => (await main.query("select ($1::date + $2::int)::text d", [date, days])).rows[0].d
    await at(start, "09:30"); await main.query("select public.run_programs()")
    for (const day of [1, 2, 3]) {
      if (day > 1) { await at(await plus(start, day - 1), "10:00"); await main.query("select public.run_programs()") }
      for (const m of [M, P]) await q(main, m, "select public.submit_program_entry($1, $2, 'letter', $3, null)", [prog, day, `${day}일째 편지예요. 오늘은 천천히 걷는 이야기를 적어요.`])
    }
    await at(await plus(start, 3), "09:05"); await main.query("select public.run_programs()")
    for (const m of [M, P]) await q(main, m, "select public.choose_meeting($1, 'positive')", [prog])
    const meet = (await main.query("select ($1::date + 6)::text d", [start])).rows[0].d
    const slots = (date, s, e) => JSON.stringify([{ date, start: s, end: e }])
    const p1 = (await q(main, M, "select public.propose_appointment($1, $2, '전시·미술관', '종로구', '미술관', null) v", [prog, slots(meet, "14:00", "17:00")]))[0].v.proposals[0]
    await q(main, P, "select public.accept_appointment($1, 0)", [p1.id])
    const rev = async () => (await q(main, M, "select public.my_program() v"))[0].v.meetingRev
    const oldRev = await rev()
    // 5-1) 약속 바꾸기(연결 1, 확정 전) ↔ 예전 판으로 연락처 동의(연결 2)
    await asUser(c1, P); await asUser(c2, M)
    await c1.query("begin")
    await c1.query("select public.propose_appointment($1, $2, '산책', '성동구', '서울숲 입구', null)", [prog, slots(meet, "11:00", "13:00")])
    const pidC = await pidOf(c2)
    const consent = c2.query("select public.set_contact_consent($1, true, $2)", [prog, oldRev]).then(() => "성공", (e) => `거절: ${e.message}`)
    const blocked = await waitingOnLock(pidC)
    await c1.query("commit")
    const consentResult = await consent
    log("C1 동의 결과:", consentResult, "기다림:", blocked)
    ok("C1 겹치기: 약속을 바꾸는 중에 예전 판으로 누른 동의는 바뀐 뒤 거절된다", consentResult.startsWith("거절") && /약속이 바뀌었어요/.test(consentResult))
    // 5-2) 다시 제안(연결 1, 확정 전) ↔ 예전 제안 수락(연결 2)
    const p2 = (await q(main, M, "select public.propose_appointment($1, $2, '카페', '마포구', '연남동', null) v", [prog, slots(meet, "15:00", "17:00")]))[0].v.proposals[0]
    await asUser(c1, M); await asUser(c2, P)
    const pidC2 = await pidOf(c2) // 연결 2가 기다리는 동안에는 그 연결로 물어볼 수 없어서 미리 알아 둔다
    await c1.query("begin")
    await c1.query("select public.propose_appointment($1, $2, '공원', '마포구', '하늘공원', null)", [prog, slots(meet, "10:00", "12:00")])
    const accept = c2.query("select public.accept_appointment($1, 0)", [p2.id]).then(() => "성공", (e) => `거절: ${e.message}`)
    ok("C1 겹치기: 두 번째 연결은 교류 잠금에서 기다린다", await waitingOnLock(pidC2))
    await c1.query("commit")
    const acceptResult = await accept
    log("C1 수락 결과:", acceptResult)
    ok("C1 겹치기: 새 제안이 확정되면 예전 제안 수락은 거절된다", acceptResult.startsWith("거절"))
    // 5-3) 동의(연결 1, 확정 전) ↔ 약속 바꾸기(연결 2): 바꾼 뒤에는 그 동의가 새 약속에 쓰이지 않는다
    const p3 = (await q(main, P, "select public.my_program() v"))[0].v.proposals.find((x) => x.status === "open")
    await q(main, P, "select public.accept_appointment($1, 0)", [p3.id])
    const rev3 = await rev()
    await asUser(c1, M); await asUser(c2, P)
    await c1.query("begin")
    await c1.query("select public.set_contact_consent($1, true, $2)", [prog, rev3])
    const change = c2.query("select public.propose_appointment($1, $2, '산책', '중구', '덕수궁', null)", [prog, slots(meet, "16:00", "18:00")]).then(() => "성공", (e) => `거절: ${e.message}`)
    ok("C1 겹치기: 두 번째 연결은 교류 잠금에서 기다린다", await waitingOnLock(pidC2))
    await c1.query("commit")
    log("C1 바꾸기 결과:", await change)
    const after = (await main.query("select meeting_rev, contact_a, contact_b, contact_a_rev, contact_b_rev, member_a = $2 as m_is_a from public.programs where id = $1", [prog, M])).rows[0]
    const myRev = after.m_is_a ? after.contact_a_rev : after.contact_b_rev
    const myConsent = after.m_is_a ? after.contact_a : after.contact_b
    ok("C1 겹치기: 동의 직후 약속이 바뀌면 그 동의는 예전 판에 묶여 새 약속에 쓰이지 않는다", !myConsent || myRev !== after.meeting_rev)
    await asUser(c1, "postgres"); await asUser(c2, "postgres")
  }

  // ── 6) 메일(T06): 두 작업이 같은 순간 메일을 잡아도 같은 메일을 두 번 잡지 않는다(반복)
  {
    const R = await member("메일", "여성", "남성")
    await main.query("update public.profiles set notify_email = true where id = $1", [R])
    const noon = (await main.query("select public.kst_at(public.kst_today(), '13:00')::text t")).rows[0].t
    for (const c of [main, c1, c2]) await c.query("select set_config('app.now', $1, false)", [noon])
    const tally = { disjoint: 0, overlap: 0, missed: 0 }
    const mailRounds = Math.min(ROUNDS, 20)
    for (let round = 0; round < mailRounds; round++) {
      // 앞 시험에서 쌓인 다른 회원 알림은 보낸 것으로 두어, 이번 30통만 잡을 대상이 되게 한다(두 작업 합쳐 40통까지 잡음)
      await main.query("update public.notifications set emailed_at = now() where member_id <> $1 and emailed_at is null", [R])
      for (let k = 0; k < 30; k++) await main.query("select public.notify($1, 'new-introduction', '오늘의 인연이 도착했어요', '확인해 주세요.', '/us', $2)", [R, `conc-mail:${round}:${k}`])
      const ids = (await main.query("select id from public.notifications where member_id = $1 and emailed_at is null and email_status is null", [R])).rows.map((r) => r.id)
      await gate.query("select pg_advisory_lock(4242)")
      const worker = async (c) => {
        await asUser(c, "postgres"); await c.query("set role service_role")
        await c.query("begin")
        await c.query("select pg_advisory_xact_lock_shared(4242)")
        const got = (await c.query("select id from public.claim_email_notifications(20)")).rows.map((r) => r.id)
        await c.query("commit")
        return got
      }
      const both = Promise.all([worker(c1), worker(c2)])
      await new Promise((r) => setTimeout(r, 5))
      await gate.query("select pg_advisory_unlock(4242)")
      const [a, b] = await both
      const overlap = a.filter((id) => b.includes(id)).length
      const covered = new Set([...a, ...b])
      if (process.env.DEBUG_MAIL) log("메일 차례", round, "대상", ids.length, "작업1", a.length, "작업2", b.length, "겹침", overlap)
      if (overlap) tally.overlap++
      else if (!ids.every((id) => covered.has(id))) tally.missed++
      else tally.disjoint++
      await asUser(main, "postgres"); await main.query("set role service_role")
      for (const id of covered) await main.query("select public.record_email_result('notification', $1, 'sent')", [id])
      await main.query("reset role")
    }
    for (const c of [main, c1, c2]) await c.query("select set_config('app.now', '', false)")
    log(`메일 두 작업 동시 ${mailRounds}번:`, JSON.stringify(tally))
    ok(`T06 동시 선점 ${mailRounds}번: 두 작업이 잡은 메일은 한 통도 겹치지 않고, 30통 모두 둘 중 하나가 잡았다`, tally.disjoint === mailRounds)
    await asUser(c1, "postgres"); await asUser(c2, "postgres")
  }

  // ── 7) 결제(T10): 같은 항목(소개비)의 두 주문이 같은 순간 결제 완료로 기록되면 하나만 완료(반복)
  {
    const R = await member("결제", "남성", "여성")
    const tally = { one: 0, both: 0, none: 0 }
    const payRounds = Math.min(ROUNDS, 20)
    for (let round = 0; round < payRounds; round++) {
      const orders = []
      for (const n of [1, 2]) {
        const orderId = `BUI-conc${round}x${n}${"0".repeat(20)}`.slice(0, 36)
        await main.query("insert into public.payments (member_id, kind, order_id, amount, order_name, provider, mode) values ($1, 'introduction', $2, 10000, '[테스트] 플라비 소개비', 'toss', 'test')", [R, orderId])
        orders.push(orderId)
      }
      await gate.query("select pg_advisory_lock(4242)")
      const pay = async (c, orderId, n) => {
        await asUser(c, "postgres"); await c.query("set role service_role")
        await c.query("begin")
        try {
          await c.query("select pg_advisory_xact_lock_shared(4242)")
          await c.query("select public.record_payment_result($1, 'paid', $2, '카드')", [orderId, `tpk_conc_${round}_${n}`])
          await c.query("commit"); return "완료"
        } catch (e) { await c.query("rollback"); return `거절: ${e.message}` }
      }
      const both = Promise.all([pay(c1, orders[0], 1), pay(c2, orders[1], 2)])
      await new Promise((r) => setTimeout(r, 5))
      await gate.query("select pg_advisory_unlock(4242)")
      const results = await both
      const paid = (await main.query("select count(*)::int n from public.payments where member_id = $1 and status = 'paid'", [R])).rows[0].n
      const wins = results.filter((r) => r === "완료").length
      if (wins === 1 && paid === 1 && results.some((r) => /중복 결제/.test(r))) tally.one++
      else if (wins === 2 || paid > 1) tally.both++
      else { tally.none++; log("결제 예상 밖:", JSON.stringify(results)) }
      // 다음 차례를 위해 완료된 결제를 취소로 남긴다(테스트 결제 취소와 같은 기록)
      await main.query("set role service_role")
      for (const orderId of orders) await main.query("select public.record_payment_result($1, 'cancelled', null, null, now(), null, '동시 실행 시험 정리')", [orderId]).catch(() => null)
      await main.query("reset role")
    }
    log(`결제 두 완료 동시 ${payRounds}번:`, JSON.stringify(tally))
    ok(`T10 동시 완료 ${payRounds}번: 같은 항목은 매번 하나만 결제 완료, 다른 하나는 ‘중복 결제’로 거절(토스 자동 취소 대상)`, tally.one === payRounds)
    await asUser(c1, "postgres"); await asUser(c2, "postgres")
  }
  log(`실제 PostgreSQL 동시 실행 시험 통과: ${passed}개`)
} finally {
  clearTimeout(watchdog)
  for (const c of [main, c1, c2, gate]) await c.end().catch(() => {})
  await server.stop()
}
