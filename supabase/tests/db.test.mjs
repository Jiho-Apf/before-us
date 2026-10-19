// 서버 데이터베이스 점검: 실제 Supabase 대신 내 컴퓨터 안의 Postgres(PGlite)에 마이그레이션을 올리고
// 회원·운영진·비회원 입장에서 권한(RLS)과 서버 함수를 확인한다. 실행: node supabase/tests/db.test.mjs
import { PGlite } from "@electric-sql/pglite"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import assert from "node:assert/strict"

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, "..", "migrations")
const db = new PGlite()

// Supabase가 기본으로 갖고 있는 것들을 흉내 낸다(auth·storage 스키마, 역할, 기본 권한).
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage; create schema extensions;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text, owner uuid default auth.uid(), created_at timestamptz default now(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  grant select, insert, delete on storage.objects to authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`)
for (const file of readdirSync(migrations).sort()) {
  if (file.includes("schedules")) continue // pg_cron·pg_net은 실제 Supabase에서만
  try { await db.exec(readFileSync(join(migrations, file), "utf8")) }
  catch (error) { console.error(`마이그레이션 실패: ${file}\n${error.message}`); process.exit(1) }
}

// ── 도우미
let passed = 0
const as = async (who, aal = "aal1") => {
  await db.exec("reset role")
  if (who === "postgres") { await db.query("select set_config('request.jwt.claims', '', false)"); return }
  await db.query("select set_config('request.jwt.claims', $1, false)", [who === "anon" ? JSON.stringify({ role: "anon" }) : JSON.stringify({ sub: who, role: "authenticated", aal })])
  await db.exec(`set role ${who === "anon" ? "anon" : "authenticated"}`)
}
const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
const fails = async (label, sql, params = [], pattern) => {
  try { await db.query(sql, params) } catch (error) {
    if (pattern && !pattern.test(error.message)) throw new Error(`${label}: 다른 오류 → ${error.message}`)
    passed++; return
  }
  throw new Error(`${label}: 실패해야 하는데 통과했어요`)
}
const ok = (label, value) => { assert.ok(value, label); passed++ }
const eq = (label, actual, expected) => { assert.deepEqual(actual, expected, label); passed++ }

// ── 가입
await as("postgres")
const signup = async (email, meta = { adult: true, terms_version: "draft-1", privacy_version: "draft-1" }) =>
  (await one("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, meta])).id
const A = await signup("a@example.test"), B = await signup("b@example.test"), C = await signup("c@example.test")
const O = await signup("owner@example.test")
await q("insert into public.admin_roles (user_id, role) values ($1, 'owner')", [O])
const profile = await one("select * from public.profiles where id = $1", [A])
ok("가입하면 프로필이 생긴다", profile && profile.email === "a@example.test" && profile.adult_confirmed_at && profile.terms_version === "draft-1")

// ── 회원 설정: 알림·마케팅만 직접 바꿀 수 있다
await as(A)
await q("update public.profiles set marketing_opt_in = true where id = $1", [A])
eq("알림·마케팅 설정은 바꿀 수 있다", (await one("select marketing_opt_in from public.profiles where id = $1", [A])).marketing_opt_in, true)
await fails("회원 상태는 직접 바꿀 수 없다", "update public.profiles set status = 'suspended' where id = $1", [A])
await q("update public.profiles set marketing_opt_in = true where id = $1", [B])
await as("postgres")
eq("남의 설정은 바꿀 수 없다", (await one("select marketing_opt_in from public.profiles where id = $1", [B])).marketing_opt_in, false)
await as("postgres")

// ── 신청서·사진
const draft = (name, gender, desired, birth) => ({
  values: {
    "self.name": name, "self.birthDate": birth, "self.gender": gender, "desired.gender": desired, "self.province": "서울", "self.area": "마포구",
    "self.purpose": "천천히 알아가며 연애", "self.bio": "산책과 음악을 좋아해요. 천천히 알아가고 싶어요.", "self.statement": true, "self.pledge": true, "self.phone": "010-1234-5678", "self.notifyChannels": ["카카오톡", "메일"],
    "self.height": "170", "self.smoking": "안 함",
    "consent.collection": true, "consent.matching": true, "consent.provision": true, "consent.review": true, "consent.noon": true,
  },
  sharing: { "self.name": true, "self.age": true, "self.province": true, "self.area": true, "self.purpose": true, "self.bio": true, "self.height": false, "self.smoking": true },
  photos: { ignored: true }, step: 3, visited: [0, 1, 2, 3],
})
const hex = (n) => n.toString(16).padStart(64, "0")
const photos = async (member, base) => {
  for (const [i, slot] of ["photo.face", "photo.upper", "photo.style"].entries())
    await q("select public.register_photo($1, $2, 'image/jpeg', 1000, 800, 1000, $3, true, true)", [slot, `${member}/${slot}-${i}.jpg`, hex(base + i)])
}

await as("anon")
await fails("비회원은 신청서를 저장할 수 없다", "select public.save_application_draft($1)", [draft("가", "여성", "남성", "1995-03-01")])

await as(A)
await q("select public.save_application_draft($1)", [draft("하윤", "여성", "남성", "1995-03-01")])
const savedA = await one("select draft from public.applications where member_id = $1", [A])
ok("저장된 신청서에는 사진·검토 정보가 섞이지 않는다", !("photos" in savedA.draft))
await fails("사진 없이 제출하면 막힌다", "select public.submit_application()", [], /사진/)
await as("anon")
await as(A)
await photos(A, 1)
await fails("같은 사진을 다른 칸에 올리면 막힌다", "select public.register_photo('photo.daily', $1, 'image/jpeg', 1000, 800, 1000, $2, true, true)", [`${A}/daily.jpg`, hex(1)], /같은 사진/)
await fails("남의 폴더 경로로는 사진을 등록할 수 없다", "select public.register_photo('photo.daily', $1, 'image/jpeg', 1000, 800, 1000, $2, true, true)", [`${B}/x.jpg`, hex(99)], /본인 폴더/)
await q("select public.submit_application()")
eq("제출하면 submitted", (await one("select status from public.applications where member_id = $1", [A])).status, "submitted")
eq("알림 받을 방법이 내 정보에 반영된다", { ...(await one("select notify_kakao k, notify_sms s, notify_email e from public.profiles where id = $1", [A])) }, { k: true, s: false, e: true })
eq("신청서의 정오 알림 동의가 내 설정에 반영된다", (await one("select notice_daily_waiting from public.profiles where id = $1", [A])).notice_daily_waiting, true)
eq("검토 전에는 제출한 신청서를 고칠 수 있다(상태 그대로)", (await one("select public.save_application_draft($1) r", [draft("하윤", "여성", "남성", "1995-03-01")])).r.status, "submitted")
eq("고친 뒤 다시 제출할 수 있다", (await one("select public.submit_application() r")).r.edited, true)
await fails("표를 직접 고칠 수 없다", "update public.applications set status = 'approved' where member_id = $1", [A])

await as(B)
await q("select public.save_application_draft($1)", [draft("준", "남성", "여성", "2010-01-01")])
await photos(B, 10)
await fails("만 19세 미만은 제출할 수 없다", "select public.submit_application()", [], /19세/)
await q("select public.save_application_draft($1)", [{ ...draft("준", "남성", "여성", "1993-07-15"), values: { ...draft("준", "남성", "여성", "1993-07-15").values, "self.phone": "02-123-4567" } }])
await fails("휴대폰 번호가 아니면 제출할 수 없다", "select public.submit_application()", [], /휴대폰/)
await q("select public.save_application_draft($1)", [{ ...draft("준", "남성", "여성", "1993-07-15"), values: { ...draft("준", "남성", "여성", "1993-07-15").values, "self.notifyChannels": ["메일"] } }])
await fails("카카오톡·문자 중 하나는 골라야 제출된다", "select public.submit_application()", [], /카카오톡이나 문자/)
await q("select public.save_application_draft($1)", [draft("준", "남성", "여성", "1993-07-15")])
await q("select public.submit_application()")
eq("남의 신청서는 보이지 않는다", (await q("select * from public.applications where member_id = $1", [A])).length, 0)
await fails("회원은 운영진 함수를 못 쓴다", "select * from public.admin_list_applications()", [], /운영진/)

await as(C)
await q("select public.save_application_draft($1)", [draft("도윤", "남성", "여성", "1992-11-02")])
await photos(C, 20)
await q("select public.submit_application()")

// 화면을 거치지 않고 동의 없이 가입한 계정은 신청할 수 없다
await as("postgres")
const E = await signup("e@example.test", {})
await as(E)
await q("select public.save_application_draft($1)", [draft("도하", "여성", "남성", "1994-01-01")])
await photos(E, 40)
await fails("동의 기록 없는 계정은 신청할 수 없다", "select public.submit_application()", [], /동의/)

// ── 운영진 검토
await as(O, "aal1")
await fails("2단계 인증 전에는 운영진 권한이 없다", "select * from public.admin_list_applications()", [], /운영진/)
await as(O, "aal2")
const list = await q("select * from public.admin_list_applications()")
eq("제출된 신청서 3건", list.length, 3)
const detail = (await one("select public.admin_get_application($1) as d", [A])).d
ok("운영진에게 생년월일 원값은 가지 않는다", !("self.birthDate" in detail.draft.values) && typeof detail.draft.values["self.age"] === "number")
await one("select public.admin_get_application($1)", [A])
eq("열람 기록은 하루 한 번", (await one("select count(*)::int n from public.audit_log where action = '회원 정보 열람' and target = $1", [A])).n, 1)
await fails("사진 확인 전에는 승인할 수 없다", "select public.admin_decide_application($1, 'approved')", [A], /사진/)
await fails("보완 요청에는 안내가 필요하다", "select public.admin_decide_application($1, 'needs_changes', '')", [A], /안내/)
for (const m of [A, B, C]) {
  for (const slot of ["photo.face", "photo.upper", "photo.style"]) await q("select public.admin_review_photo($1, $2, '기준 확인')", [m, slot])
  await q("select public.admin_decide_application($1, 'approved')", [m])
}
eq("소개 가능한 회원 3명", (await q("select * from public.admin_ready_members()")).length, 3)

// ── 정오 소개
// ── 첫 마디
await as(A)
await fails("첫 마디에 연락처는 넣을 수 없다", "select public.save_greeting('카톡 아이디 hayun123 추가해 주세요', false)", [], /연락처/)
eq("첫 마디를 저장한다(홈 공개는 확인 대기)", (await one("select public.save_greeting('천천히 알아가고 싶어요. 반가워요!', true) g")).g.homeStatus, "pending")
await as("anon")
eq("확인 전·12개 미만이면 홈에 보이지 않는다", (await one("select public.public_greetings() g")).g, [])
await as(O, "aal2")
eq("운영진은 확인 대기 첫 마디를 본다", (await one("select public.admin_list_greetings() g")).g.length, 1)
await q("select public.admin_review_greeting($1, 'approved')", [A])
await as("postgres")
for (let i = 0; i < 11; i++) { const id = await signup(`g${i}@example.test`); await q("insert into public.greetings (member_id, body, show_on_home, home_status) values ($1, $2, true, 'approved')", [id, `반가워요, 천천히 알아가요 ${i}`]) }
await as("anon")
eq("확인된 첫 마디가 12개가 되면 홈에 보인다", (await one("select public.public_greetings() g")).g.length, 12)
await as(A)
eq("같은 문장으로 다시 저장하면 확인 상태가 유지된다", (await one("select public.save_greeting('천천히 알아가고 싶어요. 반가워요!', true) g")).g.homeStatus, "approved")
eq("문장을 바꾸면 다시 확인한다", (await one("select public.save_greeting('주말 산책을 좋아해요. 반가워요!', true) g")).g.homeStatus, "pending")
await as("postgres")
await q("delete from public.greetings where member_id <> $1", [A])

// ── 기수제
await as(A)
eq("제출하면 1기에 배정된다", (await one("select public.my_cohort() c")).c.number, 1)
await as("anon")
eq("공개 기수 정보에는 번호와 날짜만 있다", Object.keys((await one("select public.public_cohort() c")).c).sort(), ["applicationDeadline", "number", "startsOn"])
await fails("비회원은 모집 현황을 볼 수 없다", "select public.admin_cohort_overview()")
await as(A)
await fails("회원은 모집 현황을 볼 수 없다", "select public.admin_cohort_overview()", [], /운영진/)
await as(O, "aal2")
const overview = (await one("select public.admin_cohort_overview() o")).o
eq("운영진은 성별 인원을 본다", [overview[0].counts["여성"]?.total, overview[0].counts["남성"]?.total], [1, 2])
const early = (await one("select (public.kst_today() + 1)::text d")).d
await fails("기수 시작일 전에는 소개를 예약할 수 없다", "select public.admin_reserve_introduction($1, $2, $3::date, '두 분 모두 천천히 알아가는 연애를 원하셨어요.')", [A, B, early], /기수 시작일/)
await q("select public.admin_update_cohort(1, '2026-12-31', '2026-12-27', 1, 1, '{}')")
await as("postgres")
const F = await signup("f@example.test")
await as(F); await q("select public.save_application_draft($1)", [draft("나래", "여성", "남성", "1997-02-02")]); await photos(F, 50); await q("select public.submit_application()")
eq("성별 최대 인원이 차면 다음 기수로 배정된다", (await one("select public.my_cohort() c")).c.number, 2)
await as(O, "aal2")
await q("select public.admin_update_cohort(1, '2026-12-31', '2026-12-27', 10, 50, '{}')")
const nextCohort = (await one("select public.admin_create_next_cohort() n")).n
await as("postgres")
eq("다음 기수는 매달 마지막 날 규칙으로 만든다", (await one("select starts_on::text s, application_deadline::text d from public.cohorts where number = $1", [nextCohort])), { s: "2027-02-28", d: "2027-02-24" })
await as(O, "aal2")
await q("select public.admin_move_member_cohort($1, 1)", [F])
// 이후 소개 점검을 위해 1기를 이미 시작한 것으로 둔다
await as("postgres")
await q("update public.cohorts set starts_on = public.kst_today() - 1, application_deadline = public.kst_today() - 2 where number = 1")
await as(O, "aal2")

const tomorrow = (await one("select (public.kst_today() + 1)::text d")).d
const intro1 = (await one("select public.admin_reserve_introduction($1, $2, $3::date, '두 분 모두 천천히 알아가는 연애를 원하셨어요.') id", [A, B, tomorrow])).id
await fails("같은 사람을 겹쳐 예약할 수 없다", "select public.admin_reserve_introduction($1, $2, $3::date, '다른 소개 이유를 적어 봅니다.')", [A, C, tomorrow], /진행 중|예약된/)
await fails("지난 정오에는 예약할 수 없다", "select public.admin_reserve_introduction($1, $2, '2020-01-01'::date, '다른 소개 이유를 적어 봅니다.')", [B, C], /지난 정오/)
await as(A)
eq("정오 전에는 기다림", (await one("select public.my_introduction() v")).v.status, "waiting")
eq("회원은 소개 표를 직접 볼 수 없다", (await q("select * from public.introductions")).length, 0)
// 시간을 정오 뒤로 돌린 것처럼 만든다
await as("postgres")
await q("update public.introductions set reveal_at = now() - interval '1 minute', respond_by = now() + interval '23 hours', view_until = now() + interval '23 hours' where id = $1", [intro1])
const noon = (await one("select public.run_noon() r")).r
eq("정오 공개 1건", noon.published, 1)
await one("select public.run_noon()")
eq("정오 작업을 다시 돌려도 알림은 한 번", (await one("select count(*)::int n from public.notifications where kind = 'new-introduction'")).n, 2)
await as(A)
const view = (await one("select public.my_introduction() v")).v
ok("공개 뒤 상대 프로필이 보인다", view.status === "published" && view.profile.items.some((item) => item.id === "self.name" && item.value === "준"))
ok("상대 프로필에 첫 마디가 함께 담긴다(B는 첫 마디 없음)", "greeting" in view.profile)
ok("상대 프로필에 생년월일은 없고 나이만 있다", !view.profile.items.some((item) => item.id === "self.birthDate") && view.profile.items.some((item) => item.id === "self.age" && item.value.endsWith("세")))
ok("공개하지 않기로 한 항목은 빠진다", !view.profile.items.some((item) => item.id === "self.height"))
const partnerPhoto = view.profile.photos[0].path
ok("열람 기간에는 상대 사진을 볼 수 있다", (await one("select public.can_view_partner_photo($1) v", [partnerPhoto])).v)
await as(C)
ok("제3자는 그 사진을 볼 수 없다", !(await one("select public.can_view_partner_photo($1) v", [partnerPhoto])).v)
await as(A)
await fails("진행 중인 소개가 있으면 신청서를 고칠 수 없다", "select public.save_application_draft($1)", [draft("하윤", "여성", "남성", "1995-03-01")], /진행 중인 소개/)
await fails("프로필을 열기 전에는 답할 수 없다", "select public.respond_introduction($1, 'positive')", [intro1], /확인한 뒤/)
await q("select public.record_introduction_view($1)", [intro1])
await q("select public.respond_introduction($1, 'positive')", [intro1])
await fails("응답은 바꿀 수 없다", "select public.respond_introduction($1, 'negative')", [intro1], /바꿀 수 없/)
await as(B)
await q("select public.record_introduction_view($1)", [intro1])
await q("select public.respond_introduction($1, 'negative', '그냥 느낌')", [intro1])
await as(A)
const closed = (await one("select public.my_introduction() v")).v
ok("한쪽이 거절하면 닫히고 프로필이 사라진다", closed.status === "closed" && closed.profile === null && closed.note === null)
ok("닫힌 뒤 상대 사진도 막힌다", !(await one("select public.can_view_partner_photo($1) v", [partnerPhoto])).v)

// 승인된 회원이 고치면 다시 확인 받는다
await as(C)
const beforeEdit = (await one("select status, profile_version from public.applications where member_id = $1", [C]))
eq("승인 상태에서 고치면 다시 확인으로 돌아간다", (await one("select public.save_application_draft($1) r", [draft("도윤", "남성", "여성", "1992-11-02")])).r.status, "submitted")
await as("postgres")
eq("다시 확인할 때 프로필 버전이 올라간다", (await one("select profile_version from public.applications where member_id = $1", [C])).profile_version, beforeEdit.profile_version + 1)
await q("update public.applications set status = 'approved' where member_id = $1", [C])

// 서로 선택 → 차단
await as(O, "aal2")
const tomorrow2 = (await one("select (public.kst_today() + 2)::text d")).d
await fails("이미 소개한 두 사람은 다시 소개하지 않는다", "select public.admin_reserve_introduction($1, $2, $3::date, '다시 한번 소개해 봅니다.')", [A, B, tomorrow2], /이미 소개/)
const intro2 = (await one("select public.admin_reserve_introduction($1, $2, $3::date, '두 분 모두 산책을 좋아하셨어요.') id", [A, C, tomorrow2])).id
await as("postgres")
await q("update public.introductions set reveal_at = now() - interval '1 minute', respond_by = now() + interval '23 hours', view_until = now() + interval '23 hours' where id = $1", [intro2])
await one("select public.run_noon()")
for (const m of [A, C]) { await as(m); await q("select public.record_introduction_view($1)", [intro2]); await q("select public.respond_introduction($1, 'positive')", [intro2]) }
await as(C)
eq("두 사람 모두 원하면 서로 선택", (await one("select public.my_introduction() v")).v.status, "mutual")
ok("소개 번호로 상대를 신고할 수 있다", (await one("select public.report_partner($1, '불쾌한 말', '설명', false) id", [intro2])).id)
await as(O)
await fails("남의 소개로는 신고할 수 없다", "select public.report_partner($1, '불쾌한 말', '설명', false)", [intro2], /찾을 수 없/)
await as(C)
await fails("소개받지 않은 사람은 차단할 수 없다", "select public.block_member($1)", [O], /소개받은/)
await q("select public.block_partner($1)", [intro2])
eq("차단하면 소개가 바로 닫힌다", (await one("select public.my_introduction() v")).v.status, "closed")

// 응답 마감
await as("postgres")
const D = await signup("d@example.test")
await as(D); await q("select public.save_application_draft($1)", [draft("서연", "여성", "남성", "1996-05-05")]); await photos(D, 30); await q("select public.submit_application()")
await as(O, "aal2")
for (const slot of ["photo.face", "photo.upper", "photo.style"]) await q("select public.admin_review_photo($1, $2, '기준 확인')", [D, slot])
await q("select public.admin_decide_application($1, 'approved')", [D])
await q("select public.admin_move_member_cohort($1, 1)", [D])
const intro3 = (await one("select public.admin_reserve_introduction($1, $2, $3::date, '두 분 모두 음악을 좋아하셨어요.') id", [D, B, tomorrow2])).id
await as("postgres")
await q("update public.introductions set status = 'published', published_at = now() - interval '1 day', reveal_at = now() - interval '1 day', respond_by = now() - interval '1 minute', view_until = now() - interval '1 minute' where id = $1", [intro3])
eq("마감이 지나면 미응답으로 닫힌다", (await one("select public.run_introduction_deadlines() n")).n, 1)
eq("닫힌 사유", (await one("select end_reason from public.introductions where id = $1", [intro3])).end_reason, "nonresponse")

// ── 저장소 권한
await as(A)
await q("insert into storage.objects (bucket_id, name) values ('application-photos', $1)", [`${A}/extra.jpg`])
await fails("남의 폴더에는 올릴 수 없다", "insert into storage.objects (bucket_id, name) values ('application-photos', $1)", [`${B}/extra.jpg`])
eq("남의 사진 파일은 보이지 않는다", (await q("select * from storage.objects where name like $1", [`${B}/%`])).length, 0)
await as("postgres")
await q("insert into storage.objects (bucket_id, name) values ('application-photos', $1)", [`${B}/photo.face-0.jpg`])
await as(O, "aal2")
eq("운영진은 사진 파일을 볼 수 있다", (await q("select * from storage.objects where name like $1", [`${B}/%`])).length, 1)

// ── 문의
await as("anon")
const inquiry = (await one("select public.submit_inquiry('서비스 이용 방법', '', 'Guest@Example.test', '정오 소개는 어떻게 받나요? 궁금해요.', true) r")).r
ok("비회원도 문의를 남길 수 있다(접수 번호는 추측할 수 없게)", /^Q-\d{6}-[0-9A-F]{8}$/.test(inquiry.id))
ok("같은 문의는 10분 안에 다시 받지 않는다", (await one("select public.submit_inquiry('서비스 이용 방법', '', 'guest@example.test', '정오 소개는 어떻게 받나요? 궁금해요.', true) r")).r.error)
ok("카드번호는 받지 않는다", (await one("select public.submit_inquiry('결제·환불', '', 'guest@example.test', '카드 1234-5678-1234-5678 환불해 주세요', true) r")).r.error)
eq("이메일이 다르면 보이지 않는다", (await one("select public.find_inquiry($1, 'other@example.test') r", [inquiry.id])).r, null)
eq("접수 번호와 이메일이 맞으면 보인다", (await one("select public.find_inquiry($1, 'guest@example.test') r", [inquiry.id])).r.status, "received")
await fails("비회원은 문의 표를 볼 수 없다", "select * from public.inquiries")
await as(O, "aal2")
await q("select public.admin_inquiry_status($1)", [inquiry.id])
await q("select public.admin_inquiry_status($1, '정오에 사이트에서 확인하실 수 있어요.')", [inquiry.id])
await as("anon")
eq("답변이 보인다", (await one("select public.find_inquiry($1, 'guest@example.test') r", [inquiry.id])).r.answer.body, "정오에 사이트에서 확인하실 수 있어요.")

// ── 신고·자동 감지
await as(A)
await q("select public.submit_report($1, '불쾌한 연락', '설명', false)", [C])
await fails("소개받지 않은 사람은 신고할 수 없다", "select public.submit_report($1, '불쾌한 연락', '설명', false)", [D], /소개받은/)
await as("postgres")
await q("select public.flag_member_text($1, '편지', '연락처·링크 전달 시도(차단됨)')", [A])
await q("select public.flag_member_text($1, '편지', '연락처·링크 전달 시도(차단됨)')", [A])
eq("자동 감지는 같은 건을 한 번만 남긴다", (await one("select count(*)::int n from public.reports where source = 'auto'")).n, 1)
await as(A)
await fails("회원은 자동 감지 함수를 직접 못 부른다", "select public.flag_member_text($1, '편지', '조작')", [B])

// ── 감사 기록은 고칠 수 없다
await as("postgres")
await fails("감사 기록 수정 불가", "update public.audit_log set action = 'x'", [], /고치거나 지울 수 없/)
await fails("감사 기록 삭제 불가", "delete from public.audit_log", [], /고치거나 지울 수 없/)

// ── 탈퇴와 삭제 예약
await as(B)
const due = (await one("select public.request_withdrawal() r")).r
ok("탈퇴 요청은 7일 뒤 삭제 예정", Date.parse(due.deletionDueAt) - Date.now() > 6.9 * 86400000)
await fails("탈퇴 요청 뒤에는 신청서를 저장할 수 없다", "select public.save_application_draft($1)", [draft("준", "남성", "여성", "1993-07-15")], /로그인한 회원/)
await as("postgres")
await q("update public.profiles set deletion_due_at = now() - interval '1 minute' where id = $1", [B])
await q("update public.introductions set closed_at = now() - interval '31 days' where id = $1", [intro1])
const retention = (await one("select public.run_retention() r")).r
eq("탈퇴 회원 1명 삭제", retention.members, 1)
eq("계정이 지워졌다", (await q("select * from auth.users where id = $1", [B])).length, 0)
ok("지운 회원의 사진 파일은 정리 대기열에 들어간다", (await one("select count(*)::int n from public.storage_cleanup where path like $1", [`${B}/%`])).n >= 3)
ok("작업 기록이 남는다", (await one("select ok from public.job_runs where job = 'retention' order by id desc limit 1")).ok)

// ── 운영 편의: 회원 목록·일시정지·이용 정지·사진 횟수·오류 모으기·메일 알림
await as(O, "aal2")
const members = (await one("select public.admin_list_members() m")).m
ok("운영진은 회원 목록에서 휴대폰 번호를 본다", members.some((m) => m.email === "a@example.test" && m.phone === "010-1234-5678"))
ok("운영진 계정은 회원 목록에서 빠진다", !members.some((m) => m.email === "owner@example.test"))
ok("번호 일부로 찾을 수 있다", (await one("select public.admin_list_members('1234-56') m")).m.length >= 1)
eq("없는 이름은 나오지 않는다", (await one("select public.admin_list_members('없는사람') m")).m.length, 0)
await as(A)
await fails("회원은 회원 목록을 못 본다", "select public.admin_list_members()", [], /운영진 권한/)
await fails("카카오톡·문자를 모두 끌 수는 없다", "select public.set_notify_channels(false, false, true)", [], /카카오톡이나 문자/)
await as("postgres")
await q("update public.introductions set status = 'closed', closed_at = now() where (member_a = $1 or member_b = $1) and status in ('reserved', 'published', 'mutual')", [A])
await q("update public.applications set status = 'approved' where member_id = $1", [A])
await as(O, "aal2")
ok("준비된 회원은 소개 가능 목록에 있다", (await q("select member_id from public.admin_ready_members()")).some((r) => r.member_id === A))
await as(A)
eq("회원이 스스로 일시정지할 수 있다", (await one("select public.set_paused(true) r")).r.paused, true)
await as(O, "aal2")
ok("일시정지 회원은 소개 가능 목록에서 빠진다", !(await q("select member_id from public.admin_ready_members()")).some((r) => r.member_id === A))
await as(A)
await q("select public.set_paused(false)")
await as(O, "aal2")
ok("다시 받기로 바꾸면 목록에 돌아온다", (await q("select member_id from public.admin_ready_members()")).some((r) => r.member_id === A))
await fails("이용 정지에는 사유가 필요하다", "select public.admin_set_member_state($1, 'suspend', '')", [A], /사유/)
await q("select public.admin_set_member_state($1, 'suspend', '반복된 연락처 요구')", [A])
await fails("같은 상태로 두 번 바꿀 수 없다", "select public.admin_set_member_state($1, 'suspend', '다시')", [A], /이미 그 상태/)
await as(A)
await fails("이용 정지 회원은 신청서를 고칠 수 없다", "select public.save_application_draft($1)", [draft("하윤", "여성", "남성", "1995-03-01")], /로그인한 회원/)
eq("이용 정지 사유를 본인이 볼 수 있다", (await one("select status, suspended_reason r from public.profiles where id = $1", [A])).r, "반복된 연락처 요구")
await as(O, "aal2")
await q("select public.admin_set_member_state($1, 'unsuspend')", [A])
ok("정지·해제는 감사 기록에 남는다", (await one("select count(*)::int n from public.audit_log where action like '회원 상태 변경%' and target = $1", [A])).n >= 2)

await as("postgres")
const used = (await one("select count(*)::int n from storage.objects where owner = $1", [A])).n
await as(A)
for (let i = used; i < 30; i++) await q("insert into storage.objects (bucket_id, name) values ('application-photos', $1)", [`${A}/quota-${i}.jpg`])
await fails("사진은 하루 30장까지 올릴 수 있다", "insert into storage.objects (bucket_id, name) values ('application-photos', $1)", [`${A}/quota-over.jpg`])

await as("anon")
await q("select public.report_client_error($1)", [{ context: "test", message: "화면 오류", path: "/today" }])
await fails("화면 오류 기록은 아무나 읽을 수 없다", "select * from public.client_errors")
await as(O, "aal2")
eq("운영진은 화면 오류를 본다", (await q("select message from public.client_errors")).map((r) => r.message), ["화면 오류"])
await as(A)
await fails("회원은 메일 보낼 목록을 못 본다", "select * from public.pending_email_notifications()")
await as("postgres")
await q("update public.profiles set notify_email = false where id <> $1", [A])
const mails = await q("select email from public.pending_email_notifications()")
ok("메일 알림을 고른 회원의 알림만 메일 목록에 오른다", mails.length > 0 && mails.every((r) => r.email === "a@example.test"))

// ── 역할 관리
await as(O, "aal2")
await q("select public.grant_admin_role('c@example.test', 'counselor')")
await as(C, "aal2")
eq("상담 역할은 신청서 목록을 볼 수 있다", (await q("select * from public.admin_list_applications()")).length >= 1, true)
await fails("상담 역할은 승인할 수 없다", "select public.admin_decide_application($1, 'approved')", [A], /운영 권한/)
await fails("상담 역할은 역할을 줄 수 없다", "select public.grant_admin_role('d@example.test', 'owner')", [], /대표 권한/)

console.log(`서버 데이터베이스 점검 통과: ${passed}개`)
