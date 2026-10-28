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
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, created_at timestamptz default now(), email_confirmed_at timestamptz default now());
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
// 베타 기수(번호 0)는 날짜가 정해져 있어, 아래 기수 점검은 베타 기수를 뺀 상태로 한다(시험 날짜와 무관하게).
{
  const beta = (await db.query("select number, starts_on::text s, application_deadline::text d from public.cohorts where number = 0")).rows[0]
  if (!beta || beta.s !== "2026-11-16" || beta.d !== "2026-11-12") { console.error("베타 기수가 없거나 날짜가 다릅니다", beta); process.exit(1) }
  await db.query("delete from public.cohorts where number = 0")
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

// ── 아는 사람 피하기: 번호는 해시로만, 한쪽만 적어도 서로 소개하지 않는다
await as("postgres")
await q("update public.applications set draft = jsonb_set(draft, '{values,self.phone}', '\"010-2222-3333\"') where member_id = $1", [B])
await as(A)
eq("형식이 맞는 번호만, 같은 번호는 한 번만 더한다", (await one("select public.add_avoid_contacts(array['010-2222-3333', '+82 10 2222 3333', '02-123-4567'], '회사 동료') n")).n, 1)
await fails("휴대폰 번호가 하나도 없으면 막힌다", "select public.add_avoid_contacts(array['12345'])", [], /형식/)
const avoidList = await q("select * from public.my_avoid_contacts()")
eq("내 목록에는 뒤 네 자리와 메모만 보인다", avoidList.map(row => [row.tail, row.memo]), [["3333", "회사 동료"]])
await fails("회원은 피하기 표를 직접 볼 수 없다", "select * from public.avoid_contacts")
await fails("회원은 비밀 값을 볼 수 없다", "select * from public.private_values")
await as(B)
eq("남이 적은 번호는 보이지 않는다", (await q("select * from public.my_avoid_contacts()")).length, 0)
await as("postgres")
ok("원래 번호는 저장하지 않는다", !JSON.stringify(await q("select * from public.avoid_contacts")).includes("2222"))
await as(O, "aal2")
const readyA = (await q("select * from public.admin_ready_members()")).find(row => row.member_id === A)
eq("운영진 후보 목록에 서로 피하는 사이로 보인다", readyA.avoided, [B])
const tomorrowAvoid = (await one("select (public.kst_today() + 1)::text d")).d
await fails("서로 피하는 두 사람은 소개를 예약할 수 없다", "select public.admin_reserve_introduction($1, $2, $3::date, '두 분 모두 천천히 알아가는 연애를 원하셨어요.')", [B, A, tomorrowAvoid], /아는 사람 피하기/)
await as(A)
await q("select public.delete_avoid_contact($1)", [avoidList[0].id])
eq("지우면 목록에서 빠진다", (await q("select * from public.my_avoid_contacts()")).length, 0)
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

// ── 서버 5단계: 합의 → 3일 교류 → 만남 선택 → 약속 → 연락처
const clock = async (iso) => { await db.query("select set_config('app.now', $1, false)", [iso ?? ""]) }
const kst = async (dayOffset, time) => (await one(`select public.kst_at($1::date + ${dayOffset}, $2::time)::text t`, [startOn, time])).t
const mine = async () => (await one("select public.my_program() v")).v
let prog = await mine()
eq("서로 선택하면 교류 합의가 열린다", prog.status, "choosing")
ok("합의 기한은 48시간", Math.abs(Date.parse(prog.agreeBy) - Date.now() - 48 * 3600000) < 60000)
eq("상대 이름이 보인다", prog.partnerName, "하윤")
await as(A)
await q("select public.choose_program_plan($1, 'A')", [prog.id])
await as(C)
await q("select public.choose_program_plan($1, 'B')", [prog.id])
await fails("방식이 다르면 확인할 수 없다", "select public.confirm_program($1)", [prog.id], /같은 방식/)
prog = (await one("select public.choose_program_plan($1, 'A') v", [prog.id])).v
eq("상대의 방식이 보인다", prog.partnerPlan, "A")
const startOn = prog.startOn
eq("같은 방식이면 기본 시작일은 내일", startOn, (await one("select (public.kst_today() + 1)::text d")).d)
await fails("시작일은 14일 안", "select public.propose_program_start($1, public.kst_today() + 20)", [prog.id], /14일/)
await q("select public.confirm_program($1)", [prog.id])
await as(A)
await fails("다른 사람의 교류는 바꿀 수 없다(교류 번호만으로는 안 된다)", "select public.choose_program_plan(gen_random_uuid(), 'A')", [], /찾을 수 없/)
eq("두 사람 모두 확인하면 일정이 정해진다", (await one("select public.confirm_program($1) v", [prog.id])).v.status, "scheduled")
await as("postgres")
ok("서로 선택한 소개는 교류가 끝날 때까지 열려 있다", (await one("select view_until = 'infinity' f from public.introductions where id = $1", [intro2])).f)
await clock(await kst(0, "08:59"))
await one("select public.run_programs()")
eq("09:00 전에는 시작하지 않는다", (await one("select status from public.programs where id = $1", [prog.id])).status, "scheduled")
await clock(await kst(0, "09:30"))
await one("select public.run_programs()")
eq("시작일 09:00에 교류가 열린다", (await one("select status from public.programs where id = $1", [prog.id])).status, "started")
ok("DAY01 알림이 간다", (await one("select count(*)::int n from public.notifications where member_id = $1 and kind = 'program-day'", [A])).n === 1)
await as(A)
await fails("편지는 20자 이상", "select public.submit_program_entry($1, 1, 'letter', '짧아요')", [prog.id], /20자/)
await fails("편지에 연락처를 넣을 수 없다", "select public.submit_program_entry($1, 1, 'letter', '제 번호는 010-1234-5678 이에요. 편하게 연락 주세요!')", [prog.id], /연락처/)
await fails("다른 날 편지는 미리 쓸 수 없다", "select public.submit_program_entry($1, 2, 'letter', '내일 편지를 미리 써 두고 싶어요. 괜찮을까요?')", [prog.id], /그날/)
await fails("A 방식에서는 첫 장면을 쓰지 않는다", "select public.submit_program_entry($1, 1, 'scene', null, '{\"activity\":\"walk\"}')", [prog.id], /방식/)
await q("select public.submit_program_entry($1, 1, 'letter', '요즘 퇴근하고 한강을 걷는 게 제일 좋은 시간이에요.')", [prog.id])
await fails("같은 날 편지는 한 번만", "select public.submit_program_entry($1, 1, 'letter', '한 통 더 보내고 싶어요. 오늘 하루가 길었거든요.')", [prog.id], /이미 보낸/)
await as(C)
let day1 = (await mine()).entries.find((e) => e.day === 1 && e.kind === "letter")
eq("상대가 보낸 것은 알 수 있지만", day1.partnerSent, true)
eq("내 편지를 보내기 전에는 상대 편지가 열리지 않는다", day1.partner, null)
await fails("편지가 열리기 전에는 답장할 수 없다", "select public.submit_program_entry($1, 1, 'reply', '좋아요')", [prog.id], /열린 뒤/)
await q("select public.submit_program_entry($1, 1, 'letter', '저는 주말 아침 동네 빵집에 가는 시간을 좋아해요.')", [prog.id])
day1 = (await mine()).entries.find((e) => e.day === 1 && e.kind === "letter")
eq("두 사람 모두 보내면 함께 열린다", day1.partner.body, "요즘 퇴근하고 한강을 걷는 게 제일 좋은 시간이에요.")
await q("select public.submit_program_entry($1, 1, 'reply', '한강 산책 좋아요. 어느 쪽을 걸으세요?')", [prog.id])
await clock(await kst(1, "10:00"))
await q("select public.submit_program_entry($1, 2, 'letter', '요즘 코인 투자 얘기를 많이 듣는데 관심 있으세요? 궁금해서요.')", [prog.id])
await as("postgres")
ok("돈 이야기는 운영진 신고함에 자동으로 표시된다(원문 없이)", (await one("select count(*)::int n from public.reports where source = 'auto' and target_id = $1 and type = '금전 요구 의심'", [C])).n === 1)
await clock(await kst(3, "09:05"))
await one("select public.run_programs()")
eq("DAY04 09:00에 만남 선택이 열린다", (await one("select status from public.programs where id = $1", [prog.id])).status, "deciding")
await as(A)
await q("select public.choose_meeting($1, 'positive')", [prog.id])
await fails("만남 답은 바꿀 수 없다", "select public.choose_meeting($1, 'negative')", [prog.id], /바꿀 수 없/)
await as(C)
eq("두 사람 모두 만나고 싶으면 약속으로", (await one("select public.choose_meeting($1, 'positive') v", [prog.id])).v.status, "arranging")
const meetDay = (await one("select ($1::date + 6)::text d", [startOn])).d
await fails("후보 날짜는 서로 달라야 한다", "select public.propose_appointment($1, $2, '산책·공원', '마포구')", [prog.id, JSON.stringify([{ date: meetDay, start: "14:00", end: "16:00" }, { date: meetDay, start: "18:00", end: "20:00" }])], /서로 달라/)
await fails("약속 제안에도 연락처는 못 넣는다", "select public.propose_appointment($1, $2, '산책·공원', '마포구', null, '인스타 아이디 알려 드릴게요')", [prog.id, JSON.stringify([{ date: meetDay, start: "14:00", end: "16:00" }])], /연락처/)
const proposal = (await one("select public.propose_appointment($1, $2, '산책·공원', '마포구', '망원 한강공원', '천천히 걸어요') v", [prog.id, JSON.stringify([{ date: meetDay, start: "14:00", end: "16:00", memo: "010-9876-5432" }])])).v.proposals[0]
ok("후보 시간에는 날짜·시각만 저장된다(다른 값으로 연락처를 넘길 수 없다)", !("memo" in proposal.slots[0]))
await fails("내 제안은 내가 고를 수 없다", "select public.accept_appointment($1, 0)", [proposal.id], /상대가/)
await as(A)
await fails("약속 전에는 연락처를 고르지 않는다", "select public.set_contact_consent($1, true)", [prog.id], /약속이 정해진 뒤/)
eq("상대가 시간을 고르면 약속이 정해진다", (await one("select public.accept_appointment($1, 0) v", [proposal.id])).v.meetingOn, meetDay)
await q("select public.set_contact_consent($1, true)", [prog.id])
await as(C)
await q("select public.set_contact_consent($1, true)", [prog.id])
eq("만나는 날 전에는 번호가 보이지 않는다", (await mine()).partnerPhone, null)
await clock(await kst(6, "08:00"))
eq("만나는 날에는 두 분이 동의한 번호가 보인다", (await mine()).partnerPhone, "010-1234-5678")
await fails("열린 연락처는 거둘 수 없다", "select public.set_contact_consent($1, false)", [prog.id], /거둘 수 없/)
await clock(await kst(8, "00:01"))
eq("다음 날 23:59가 지나면 번호가 사라진다", (await mine()).partnerPhone, null)
await clock(await kst(6, "08:00"))
await as(O, "aal2")
const programs = (await one("select public.admin_list_programs() v")).v
ok("운영진은 교류 진행만 보고 글 원문은 보지 않는다", programs.length >= 1 && !JSON.stringify(programs).includes("한강"))
await clock(null)
await as(C)
ok("소개 번호로 상대를 신고할 수 있다", (await one("select public.report_partner($1, '불쾌한 말', '설명', false) id", [intro2])).id)
await as(O)
await fails("남의 소개로는 신고할 수 없다", "select public.report_partner($1, '불쾌한 말', '설명', false)", [intro2], /찾을 수 없/)
await as(C)
await fails("소개받지 않은 사람은 차단할 수 없다", "select public.block_member($1)", [O], /소개받은/)
await q("select public.block_partner($1)", [intro2])
eq("차단하면 소개가 바로 닫힌다", (await one("select public.my_introduction() v")).v.status, "closed")
const blockedProgram = await mine()
eq("차단하면 교류도 바로 닫힌다", [blockedProgram.status, blockedProgram.endReason], ["closed", "blocked"])
ok("닫힌 교류는 글·상대 이름·번호를 더 보여 주지 않는다", blockedProgram.entries.length === 0 && !("partnerName" in blockedProgram) && !("partnerPhone" in blockedProgram))

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
eq("자동 감지는 같은 건을 한 번만 남긴다", (await one("select count(*)::int n from public.reports where source = 'auto' and target_id = $1", [A])).n, 1)
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
ok("쉬는 동안에는 다시 받은 때가 비어 있다", (await one("select resumed_at from public.profiles where id = $1", [A])).resumed_at === null)
await q("select public.set_paused(false)")
ok("다시 받기로 바꾸면 그때를 기록하고 회원 본인이 읽을 수 있다", (await one("select resumed_at from public.profiles where id = $1", [A])).resumed_at !== null)
await as(O, "aal2")
ok("다시 받기로 바꾸면 목록에 돌아온다", (await q("select member_id from public.admin_ready_members()")).some((r) => r.member_id === A))
eq("후보 목록의 ‘기다리기 시작한 때’는 다시 받은 때 이후로 센다", await one("select (select waiting_since from public.admin_ready_members() where member_id = $1) >= (select resumed_at from public.profiles where id = $1) ok", [A]), { ok: true })
// 궁합 분석은 운영진 화면 안에서만 한다(20261029003500): 외부 분석용으로 두 사람의 신청서를 꺼내 주던 함수는 없앴다.
await as("postgres")
eq("외부 분석용 신청서 함수(admin_match_profiles)는 남아 있지 않다", (await one("select to_regprocedure('public.admin_match_profiles(uuid, uuid)') is null gone")).gone, true)
await as(O, "aal2")
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
await q("select set_config('app.now', $1, false)", [(await one("select public.kst_at(public.kst_today(), '13:00')::text t")).t])
const mails = await q("select email from public.pending_email_notifications(500)")
ok("베타 동안 중요한 알림은 메일 선택과 상관없이 메일로 간다", mails.some((r) => r.email !== "a@example.test"))
ok("소개 없는 날·상대의 움직임 같은 알림은 메일로 가지 않는다", (await one("select count(*)::int n from public.pending_email_notifications(500) x join public.notifications n on n.id = x.id where n.kind in ('waiting', 'program-sent', 'program-open')")).n === 0)
await q("update public.profiles set email_all = true where id = $1", [A])
ok("‘모두 받기’를 고르면 사이트 알림도 메일로 간다", (await one("select count(*)::int n from public.pending_email_notifications(500) x join public.notifications n on n.id = x.id where n.kind in ('waiting', 'closed', 'program-sent', 'program-open', 'program-plan', 'program-confirm')")).n > 0)
await q("update public.profiles set email_all = false where id = $1", [A])
await q("select set_config('app.now', $1, false)", [(await one("select public.kst_at(public.kst_today(), '23:00')::text t")).t])
eq("밤 10시~아침 8시에는 메일을 보내지 않는다", (await q("select * from public.pending_email_notifications(500)")).length, 0)
await q("select set_config('app.now', '', false)")

// ── 베타 전 점검 고친 것
await as("anon")
ok("‘베타 의견’ 문의를 남길 수 있다", (await one("select public.submit_inquiry('베타 의견', '', 'beta@example.test', '신청서가 조금 길어요. 그래도 좋았어요.', true) r")).r.id)
await as("postgres")
const G = await signup("g@example.test")
await as(G)
await q("select public.save_application_draft($1)", [{ ...draft("지민", "여성", "남성", "1994-04-04"), values: { ...draft("지민", "여성", "남성", "1994-04-04").values, "self.bio": "편하게 연락 주세요 인스타 아이디 jimin_94 팔로우해요" } }])
await photos(G, 50)
await fails("소개 글에 연락처·SNS를 넣으면 제출할 수 없다", "select public.submit_application()", [], /연락처/)
await q("select public.save_application_draft($1)", [draft("지민", "여성", "남성", "1994-04-04")])
await q("select public.submit_application()")
await q("select public.save_application_draft($1)", [draft("지민", "여성", "남성", "2010-04-04")])
eq("제출 뒤 고친 신청서는 접수 상태 그대로", (await one("select status from public.applications where member_id = $1", [G])).status, "submitted")
await as(O, "aal2")
for (const slot of ["photo.face", "photo.upper", "photo.style"]) await q("select public.admin_review_photo($1, $2, '기준 확인')", [G, slot])
await fails("승인할 때 같은 기준으로 다시 확인한다(만 19세)", "select public.admin_decide_application($1, 'approved')", [G], /19세/)
await as("postgres")
await q("update public.applications set status = 'approved', cohort_number = (select max(number) from public.cohorts) where member_id = $1", [G])
await q("update public.cohorts set starts_on = public.kst_today() + 30, application_deadline = public.kst_today() + 26 where number = (select max(number) from public.cohorts)")
await q("delete from public.notifications where kind = 'waiting'")
await one("select public.run_noon()")
eq("기수 시작 전에는 ‘오늘은 소개가 없어요’를 보내지 않는다", (await one("select count(*)::int n from public.notifications where member_id = $1 and kind = 'waiting'", [G])).n, 0)
await q("update public.applications set draft = jsonb_set(draft, '{sharing,photo.daily}', 'true') where member_id = $1", [G])
await q("insert into public.application_photos (member_id, slot, path, mime, bytes, width, height, sha256, recent_confirmed, rights_confirmed, review) values ($1, 'photo.daily', $2, 'image/jpeg', 1000, 800, 1000, $3, true, true, '재등록 요청') on conflict do nothing", [G, `${G}/daily.jpg`, hex(77)])
ok("기준 확인하지 않은 사진은 상대에게 보이지 않는다", !JSON.stringify((await one("select public.public_profile($1) p", [G])).p.photos).includes("daily"))

// ── 신청서 결정 알림
ok("승인하면 회원에게 알림이 간다", (await one("select count(*)::int n from public.notifications where member_id = $1 and kind = 'application-approved'", [A])).n >= 1)
ok("교류 알림 문장이 자연스럽다", (await one("select count(*)::int n from public.notifications where title like '%이(가)%' or title like '%을(를)%'")).n === 0)

// ── 전체 공지(사이트 + 메일)
await as(A)
await fails("회원은 전체 공지를 보낼 수 없다", "select public.admin_broadcast('베타가 곧 끝나요', '정식 운영 안내를 드려요. 7일 뒤 바뀌어요.')", [], /대표만/)
await as(O, "aal2")
const sentTo = (await one("select public.admin_broadcast('베타가 곧 끝나요', '정식 운영 안내를 드려요. 7일 뒤 바뀌어요.') n")).n
ok("대표는 모든 회원에게 공지를 보낸다", sentTo >= 2)
await as("postgres")
await q("update public.profiles set notify_email = false where id = $1", [G])
ok("공지는 메일 알림을 고르지 않은 회원에게도 메일로 간다", (await q("select email from public.pending_email_notifications(500)")).some((r) => r.email === "g@example.test"))
ok("운영진 계정에는 공지가 가지 않는다", (await one("select count(*)::int n from public.notifications where kind = 'announcement' and member_id = $1", [O])).n === 0)

// ── 문의 답변 메일 · 마감 전 알림
await as("postgres")
const qid = (await one("select id from public.inquiries where email = 'beta@example.test' limit 1")).id
await as(O, "aal2")
await q("select public.admin_inquiry_status($1, '의견 고마워요. 신청서를 조금 줄여 볼게요.')", [qid])
await as("postgres")
await q("select set_config('app.now', $1, false)", [(await one("select public.kst_at(public.kst_today(), '13:00')::text t")).t])
ok("문의 답변은 문의한 분의 메일로 간다", (await q("select * from public.pending_email_notifications(500)")).some((r) => r.email === "beta@example.test" && r.source === "queue"))
await q("set session_replication_role = replica")
const remindIntro = (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'published', now() - interval '21 hours', public.app_now() + interval '1 hour', public.app_now() + interval '1 hour', '{}', '{}', now() - interval '21 hours') returning id", [A, G])).id
const remindProgram = (await one("insert into public.programs (introduction_id, member_a, member_b, status, plan_a, plan_b, start_on, agree_by, started_at) values ($1, $2, $3, 'started', 'A', 'A', public.kst_today(), now(), now()) returning id", [remindIntro, A, G])).id
await q("set session_replication_role = origin")
await q("insert into public.program_entries (program_id, day, kind, author, body) values ($1, 1, 'letter', $2, '오늘 하루는 조용히 산책하며 보냈어요.')", [remindProgram, A])
await q("select set_config('app.now', $1, false)", [(await one("select public.kst_at(public.kst_today(), '18:30')::text t")).t])
await q("update public.introductions set respond_by = public.app_now() + interval '1 hour' where id = $1", [remindIntro])
await one("select public.run_reminders()")
ok("응답 마감 2시간 전, 답하지 않은 두 분에게 알린다", (await one("select count(*)::int n from public.notifications where kind = 'reminder-response' and dedupe_key like $1", [`remind-intro:${remindIntro}:%`])).n === 2)
ok("18:00까지 글을 보내지 않은 회원에게만 알린다", (await q("select member_id from public.notifications where kind = 'reminder-letter' and dedupe_key like $1", [`remind-letter:${remindProgram}:%`])).map((r) => r.member_id).join() === G)
eq("마감 전 알림은 한 번만 보낸다", await one("select public.run_reminders() n").then((r) => r.n), 0)
await q("select set_config('app.now', '', false)")
await q("delete from public.programs where id = $1", [remindProgram])
await q("set session_replication_role = replica")
await q("delete from public.introductions where id = $1", [remindIntro])
await q("set session_replication_role = origin")

// ── 베타 나이 범위 · 신청서 이어 쓰기 알림
await as("postgres")
const H = await signup("h@example.test")
await as(H)
await q("select public.save_application_draft($1)", [draft("민준", "남성", "여성", "1990-05-05")])
await photos(H, 60)
await fails("1992년생보다 나이가 많으면 제출할 수 없다", "select public.submit_application()", [], /1992~2007년생/)
await q("select public.save_application_draft($1)", [draft("민준", "남성", "여성", "1992-01-01")])
eq("1992년생은 제출할 수 있다", (await one("select public.submit_application() r")).r.status, "submitted")
await as("postgres")
const I = await signup("i@example.test")
await q("update public.profiles set created_at = now() - interval '2 days' where id = $1", [I])
await one("select public.run_reminders()")
eq("가입하고 하루가 지나도 신청서를 내지 않으면 한 번 알린다", (await one("select count(*)::int n from public.notifications where member_id = $1 and kind = 'reminder-application'", [I])).n, 1)
await one("select public.run_reminders()")
eq("이어 쓰기 알림은 한 번만", (await one("select count(*)::int n from public.notifications where member_id = $1 and kind = 'reminder-application'", [I])).n, 1)
eq("제출한 회원에게는 이어 쓰기 알림을 보내지 않는다", (await one("select count(*)::int n from public.notifications where member_id = $1 and kind = 'reminder-application'", [H])).n, 0)

// ── 회원 흐름 다듬기(2026-10-28): 무응답 안내·연속 무응답 쉬기·마감 경쟁·상대 사정 알림·기록 보존·공개 직전 확인·재소개 예외
await as("postgres")
const J = await signup("j@example.test"), K = await signup("k@example.test"), L = await signup("l@example.test"), M = await signup("m@example.test")
const N = await signup("n@example.test")
const snap = JSON.stringify({ version: 1, items: [], photos: [] })
const pub = async (a, b) => (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'published', now() - interval '1 day', now() - interval '1 minute', now() - interval '1 minute', $3, $3, now() - interval '1 day') returning id", [a, b, snap])).id
const n1 = await pub(J, K)
await q("update public.introductions set response_a = 'positive', response_a_at = now(), opened_a_at = now() where id = $1", [n1])
await one("select public.run_introduction_deadlines()")
eq("먼저 답한 쪽에는 상대가 답하지 않았다고 알린다", (await one("select title from public.notifications where dedupe_key = $1", [`closed:${n1}:${J}`])).title, "상대가 기한 안에 답하지 않았어요")
eq("답하지 않은 쪽에는 기한 안내", (await one("select title from public.notifications where dedupe_key = $1", [`closed:${n1}:${K}`])).title, "답 기한이 지나 소개가 마무리됐어요")
eq("상대 무응답은 답한 쪽 횟수에 넣지 않고, 답하지 않은 쪽만 넣는다", await one("select count_a, count_b from public.introductions where id = $1", [n1]), { count_a: false, count_b: true })
const n2 = await pub(L, K)
await one("select public.run_introduction_deadlines()")
eq("두 번 이어서 답하지 않으면 새 소개를 쉬게 한다", await one("select paused_at is not null paused, paused_by from public.profiles where id = $1", [K]), { paused: true, paused_by: "auto" })
ok("쉬게 됐다고 알린다", (await one("select count(*)::int n from public.notifications where member_id = $1 and kind = 'auto-paused'", [K])).n === 1)
ok("두 번째 무응답 소개도 닫혔다", (await one("select status from public.introductions where id = $1", [n2])).status === "closed")
const n3 = await pub(J, M)
await q("update public.introductions set status = 'mutual', mutual_at = now() where id = $1", [n3])
await one("select public.run_introduction_deadlines()")
eq("마감 작업은 이미 서로 선택된 소개를 닫지 않는다", (await one("select status from public.introductions where id = $1", [n3])).status, "mutual")
await q("delete from public.programs where introduction_id = $1", [n3])
await q("update public.introductions set status = 'closed', closed_at = now(), end_reason = 'rejected' where id = $1", [n3])
await q("delete from public.programs where introduction_id = $1", [n3])
// 상대 탈퇴: 남은 쪽에 중립 알림, 남은 쪽 횟수 제외
const n4 = await pub(L, M)
await q("update public.introductions set respond_by = now() + interval '1 day', view_until = now() + interval '1 day' where id = $1", [n4])
await as(L)
await one("select public.request_withdrawal()")
await as("postgres")
ok("상대가 탈퇴하면 남은 쪽에 알린다", (await one("select body from public.notifications where dedupe_key = $1", [`closed:${n4}:${M}`])).body.includes("상대의 사정"))
eq("탈퇴로 끝난 소개는 남은 쪽 횟수에 넣지 않는다", await one("select count_a, count_b, ended_by from public.introductions where id = $1", [n4]), { count_a: true, count_b: false, ended_by: L })
await as(L)
eq("내가 끝낸 소개인지 화면이 알 수 있다", (await one("select public.my_introduction() r")).r.endedByMe, true)
await as(M)
eq("상대가 끝낸 소개는 내가 끝낸 것이 아니다", (await one("select public.my_introduction() r")).r.endedByMe, false)
// 계정이 지워져도 소개 기록은 남는다 · 정지 이력은 암호값으로 보관
await as("postgres")
await q("update public.profiles set status = 'suspended' where id = $1", [L])
await q("delete from auth.users where id = $1", [L])
eq("지워진 회원과의 소개 기록은 연결만 끊고 남긴다", await one("select member_a is null gone, member_b from public.introductions where id = $1", [n4]), { gone: true, member_b: M })
ok("정지됐던 회원이 지워지면 안전 이력을 암호값으로 남긴다", (await one("select count(*)::int n from public.safety_holds where reason = 'suspended' and email_hash = public.secret_hash('l@example.test')")).n === 1)
// 운영진이 건 쉬기는 회원이 풀 수 없다
await q("update public.profiles set paused_at = now(), paused_by = 'operator' where id = $1", [J])
await as(J)
await fails("운영진이 건 쉬기는 회원이 풀 수 없다", "select public.set_paused(false)", [], /운영진이 확인/)
await as("postgres")
await q("update public.profiles set paused_at = null, paused_by = null where id = $1", [J])
// 같은 두 사람 재소개 예외: 운영 취소로 끝난 소개는 다시 소개를 막지 않는다
await q("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, end_reason, closed_at) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'closed', now() - interval '3 day', now() - interval '2 day', now(), $3, $3, 'admin-cancel', now())", [J, K, snap])
await q("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, end_reason, closed_at) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'closed', now() - interval '2 day', now() - interval '1 day', now(), $3, $3, 'rejected', now())", [K, J, snap])
passed++
await fails("거절로 끝난 두 사람은 다시 소개하지 않는다", "insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'published', now(), now() + interval '1 day', now(), $3, $3)", [J, K, snap], /introductions_pair_once/)
// 당일 20시 알림
const n5 = (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at) values ($1, $2, '두 분 모두 음악을 좋아하셨어요.', 'published', public.kst_at(public.kst_today(), '12:00'), public.kst_at(public.kst_today() + 1, '11:00'), public.kst_at(public.kst_today() + 1, '11:00'), $3, $3, public.kst_at(public.kst_today(), '12:00')) returning id", [M, K, snap])).id
await q("update public.introductions set opened_a_at = now() where id = $1", [n5])
await q("select set_config('app.now', $1, false)", [(await one("select public.kst_at(public.kst_today(), '20:30')::text t")).t])
await one("select public.run_reminders()")
eq("저녁 8시에 열어 보지 않았거나 답하지 않은 회원에게 알린다", (await q("select title from public.notifications where dedupe_key like $1 order by title", [`remind-intro-eve:${n5}:%`])).map((r) => r.title), ["오늘의 인연에 아직 답하지 않았어요", "오늘의 인연을 아직 열어 보지 않았어요"])
await q("select set_config('app.now', '', false)")
await q("update public.introductions set status = 'closed', closed_at = now(), end_reason = 'rejected' where id = $1", [n5])
// 정오 공개 직전 확인: 그 사이 쉬기를 누른 회원의 예약은 공개하지 않는다
const n6 = (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b) values ($1, $2, '두 분 모두 전시를 좋아하셨어요.', 'reserved', now() - interval '1 minute', now() + interval '1 day', now() + interval '1 day', $3, $3) returning id", [J, N, snap])).id
await q("update public.profiles set paused_at = now(), paused_by = 'member' where id = $1", [N])
await one("select public.run_noon()")
eq("공개 직전에 쉬는 회원이 있으면 공개하지 않는다", await one("select status, end_reason from public.introductions where id = $1", [n6]), { status: "cancelled", end_reason: "precheck" })
await q("update public.profiles set paused_at = null, paused_by = null where id = $1", [N])
// 신고는 운영진에게 바로 알린다
await as(M)
await one("select public.submit_report($1, '회원 신고', '약속 장소에서 불편한 말을 들었어요.', true)", [J])
await as("postgres")
ok("급한 신고는 운영진에게 바로 알린다", (await one("select count(*)::int n from public.notifications where member_id = $1 and kind = 'admin-report' and title = '급한 신고가 들어왔어요'", [O])).n === 1)

// ── 3일 교류 다듬기: 시작일이 하루 미뤄져도 누른 사람의 확인은 남고 상대에게 알린다 · B 첫 장면 고를 거리
await as("postgres")
const P1 = await signup("p1@example.test"), P2 = await signup("p2@example.test")
const exIntro = (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at, mutual_at) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'mutual', now() - interval '1 day', now() + interval '1 hour', 'infinity', $3, $3, now() - interval '1 day', now()) returning id", [P1, P2, snap])).id
const exProgram = (await one("insert into public.programs (introduction_id, member_a, member_b, status, plan_a, plan_b, start_on, agree_by) values ($1, $2, $3, 'choosing', 'B', 'B', public.kst_today(), now() + interval '1 day') returning id", [exIntro, P1, P2])).id
await as(P1)
const rolled = (await one("select public.confirm_program($1) r", [exProgram])).r
ok("날짜가 지나 하루 미뤄졌다고 안내한다", (rolled.notice ?? "").includes("상대의 확인만 남았어요"))
await as("postgres")
const exRow = await one("select start_on::text s, confirm_a is not null a, confirm_b is not null b from public.programs where id = $1", [exProgram])
eq("미뤄져도 누른 사람의 확인은 남는다", { a: exRow.a, b: exRow.b }, { a: true, b: false })
ok("상대에게 다시 확인해 달라고 알린다", (await one("select count(*)::int n from public.notifications where member_id = $1 and kind = 'program-date'", [P2])).n === 1)
await q("update public.programs set status = 'started', start_on = public.kst_date(public.app_now()), started_at = now() where id = $1", [exProgram])
await q("select set_config('app.now', $1, false)", [(await one("select public.kst_at(public.kst_today(), '10:00')::text t")).t])
await as(P1)
await one("select public.submit_program_entry($1, 1, 'scene', '골목을 천천히 걷고 싶어요.', $2)", [exProgram, JSON.stringify({ activity: "market", about: "주말엔 시장 구경을 자주 가요." })])
await fails("목록에 없는 분위기는 고를 수 없다", "select public.submit_program_entry($1, 1, 'scene', null, $2)", [exProgram, JSON.stringify({ activity: "club" })], /분위기|이미 보낸/)
await as("postgres")
await q("select set_config('app.now', '', false)")
ok("새로 더한 ‘시장 골목’을 고를 수 있다", (await one("select payload ->> 'activity' a from public.program_entries where program_id = $1 and author = $2", [exProgram, P1])).a === "market")

// ── 역할 관리
await as(O, "aal2")
await q("select public.grant_admin_role('c@example.test', 'counselor')")
await as(C, "aal2")
eq("상담 역할은 신청서 목록을 볼 수 있다", (await q("select * from public.admin_list_applications()")).length >= 1, true)
await fails("상담 역할은 승인할 수 없다", "select public.admin_decide_application($1, 'approved')", [A], /운영 권한/)
await fails("상담 역할은 역할을 줄 수 없다", "select public.grant_admin_role('d@example.test', 'owner')", [], /대표 권한/)

// ── 운영진 화면 2차(2026-10-29): 성별 확인·사진 상태·쉬기 주체·요청 답변 보존·신고 종결 메모·목록 함수 권한
await as("postgres")
const X1 = await signup("x1@example.test"), X2 = await signup("x2@example.test"), X3 = await signup("x3@example.test")
for (const [id, name, gender, desired, base] of [[X1, "서준", "남성", "여성", 901], [X2, "시우", "남성", "여성", 911], [X3, "서아", "여성", "남성", 921]]) {
  await as(id)
  await q("select public.save_application_draft($1)", [draft(name, gender, desired, "1995-03-01")])
  await photos(id, base)
  await q("select public.submit_application()")
}
await as(O, "aal2")
for (const m of [X1, X2, X3]) {
  for (const slot of ["photo.face", "photo.upper", "photo.style"]) await q("select public.admin_review_photo($1, $2, '기준 확인')", [m, slot])
  await q("select public.admin_decide_application($1, 'approved')", [m])
}
await fails("같은 결정을 두 번 누르면 막는다(알림이 두 번 가지 않게)", "select public.admin_decide_application($1, 'approved')", [X1], /이미 그 상태/)
const readyX = (await q("select * from public.admin_ready_members()")).find((r) => r.member_id === X1)
eq("후보 목록에 필수 사진 확인 장수가 온다", readyX.photos_confirmed, 3)
ok("후보 목록에 매칭 항목·선호가 오고 휴대폰·이름 원값은 빠진다", readyX.profile.values["self.purpose"] === "천천히 알아가며 연애" && !("self.phone" in readyX.profile.values) && !("self.name" in readyX.profile.values) && "preferences" in readyX.profile)
ok("후보 목록에 기수와 지워진 계정 차단 관계(held) 열이 있다", Array.isArray(readyX.held) && "cohort_starts_on" in readyX)
const farDay = (await one("select (public.kst_today() + 400)::text d")).d
await fails("서로 원하는 상대 성별이 맞지 않으면 예약할 수 없다", "select public.admin_reserve_introduction($1, $2, $3::date, '두 분 모두 산책을 좋아하셨어요.')", [X1, X2, farDay], /상대 성별/)
await as("postgres")
await q("update public.applications set draft = jsonb_set(draft, '{values,self.gender}', '\"직접 확인이 필요해요\"') where member_id = $1", [X2])
await as(O, "aal2")
await fails("성별 확인이 필요한 회원은 예약할 수 없다", "select public.admin_reserve_introduction($1, $2, $3::date, '두 분 모두 산책을 좋아하셨어요.')", [X3, X2, farDay], /성별을 직접 확인/)
// 쉬기 주체: 회원이 직접 건 쉬기는 ‘다시 받기’로 풀 수 없다
await as(X1)
await q("select public.set_paused(true)")
await as(O, "aal2")
eq("회원 목록에 누가 쉬기를 걸었는지 보인다", (await one("select public.admin_list_members('서준') m")).m.find((r) => r.id === X1).pausedBy, "member")
await fails("회원이 직접 건 쉬기는 운영진 다시 받기로 풀 수 없다", "select public.admin_set_member_state($1, 'resume')", [X1], /직접 쉬기/)
await fails("회원 쉬기를 풀 때는 사유가 필요하다", "select public.admin_set_member_state($1, 'resume_override', ' ')", [X1], /이유/)
await q("select public.admin_set_member_state($1, 'resume_override', '회원이 전화로 다시 받겠다고 했어요')", [X1])
await as("postgres")
ok("회원 쉬기를 풀면 쉬기가 풀리고 회원에게 알린다", (await one("select paused_at is null p from public.profiles where id = $1", [X1])).p && (await one("select count(*)::int n from public.notifications where member_id = $1 and kind = 'operator-resumed'", [X1])).n === 1)
await as(O, "aal2")
await q("select public.admin_set_member_state($1, 'pause')", [X1])
eq("운영진이 건 쉬기는 운영진으로 표시된다", (await one("select public.admin_list_members('서준') m")).m.find((r) => r.id === X1).pausedBy, "operator")
await q("select public.admin_set_member_state($1, 'resume')", [X1])
ok("운영진이 건 쉬기는 다시 받기로 풀린다", (await one("select paused_at is null p from public.profiles where id = $1", [X1])).p)
// 회원 요청: 빈 답변은 이전 답변을 지우지 않는다 · 처리 완료에는 답변이 필요하다
await as(X1)
const reqX = (await one("select public.submit_member_request('pause', '한 달 정도 쉬고 싶어요.', true) id")).id
const reqY = (await one("select public.submit_member_request('correction', '지역을 고치고 싶어요.') id")).id
await as(O, "aal2")
await q("select public.admin_decide_request($1, 'checking', '확인하고 있어요. 곧 알려 드릴게요.')", [reqX])
await q("select public.admin_decide_request($1, 'protection', null)", [reqX])
eq("빈 답변으로 상태만 바꾸면 이전 답변이 남는다", (await one("select decision from public.member_requests where id = $1", [reqX])).decision, "확인하고 있어요. 곧 알려 드릴게요.")
await fails("답변 없이 처리 완료할 수 없다", "select public.admin_decide_request($1, 'decided', '')", [reqY], /답변/)
const reqRow = (await one("select public.admin_list_requests() l")).l.find((r) => r.id === reqX)
ok("회원 요청 목록에 회원 이름·이메일·긴급이 온다", reqRow.member.name === "서준" && reqRow.member.email === "x1@example.test" && reqRow.urgent === true)
// 신고: 종결에는 메모가 필요하고 종결된 신고는 바꾸지 않는다
await as("postgres")
const repX = (await one("insert into public.reports (source, reporter_id, target_id, type, description) values ('member', $1, $2, '불편한 말', '대화 중 불편한 말을 들었어요.') returning id", [X3, X1])).id
await as(O, "aal2")
await fails("처리 메모 없이 종결할 수 없다", "select public.admin_update_report($1, 'closed', null)", [repX], /메모/)
await q("select public.admin_update_report($1, 'closed', '두 분께 확인하고 주의 안내를 보냈어요.')", [repX])
await fails("종결된 신고는 바꿀 수 없다", "select public.admin_update_report($1, 'reviewing', null)", [repX], /종결된/)
const repRow = (await one("select public.admin_list_reports() l")).l.find((r) => r.id === repX)
ok("신고 목록에 신고한 분과 대상의 이름·상태가 온다", repRow.reporter.name === "서아" && repRow.target.name === "서준" && repRow.target.status === "active")
ok("감사로그 목록에 기록한 운영진 이메일과 대상 이름이 온다", (await one("select public.admin_list_audit(null, null, '회원 상태 변경') l")).l.some((r) => r.actorEmail === "owner@example.test" && r.targetName === "서준"))
// 새 목록 함수 권한
await as(X1)
for (const fn of ["admin_list_reports()", "admin_list_requests()", "admin_list_inquiries()", "admin_list_audit()"]) await fails(`회원은 ${fn}을 못 쓴다`, `select public.${fn}`, [], /권한/)
await as("anon")
await fails("비회원은 신고 목록 함수를 못 쓴다", "select public.admin_list_reports()")
await as(C, "aal2")
ok("상담 역할은 신고·문의 목록을 본다", Array.isArray((await one("select public.admin_list_reports() l")).l) && Array.isArray((await one("select public.admin_list_inquiries() l")).l))
await fails("상담 역할은 감사로그 목록을 못 본다", "select public.admin_list_audit()", [], /대표 권한/)
await fails("상담 역할은 회원 쉬기를 풀 수 없다", "select public.admin_set_member_state($1, 'resume_override', '확인')", [X1], /운영 권한/)
await fails("상담 역할은 후보 목록을 못 본다", "select * from public.admin_ready_members()", [], /운영 권한/)
await as("postgres")
await fails("회원 요약 도우미는 밖에서 부를 수 없다", "set role authenticated; select public.admin_member_brief($1)", [X1])
await db.exec("reset role")

// ── 3일 교류 다듬기 2: 날짜는 막지 않는 연락처 검사 · 답장 다음 날 09:00까지 · 방식이 다를 때 알림 · 시작일 제안 = 내 확인 · B 마지막 맞추기 · 마무리 뒤 다시 읽기
{
  await as("postgres")
  const contact = async (text) => (await one("select public.has_contact(normalize($1, NFKC)) v", [text])).v
  for (const text of ["2026-10-28 14:00에 만나요", "2026.10.28 오후 3시", "2026. 10. 28.~2026. 10. 30.", "2026/10/28 1400", "가격은 35,000원이에요", "10월 28일 14:30~16:00"])
    eq(`날짜·시각·가격은 연락처로 보지 않는다: ${text}`, await contact(text), false)
  for (const text of ["010-1234-5678", "01012345678", "+82 10 1234 5678", "+821012345678", "010 2026-10-28", "abc@naver.com", "인스타 아이디 sky_walk", "@sky.walk 팔로우해요", "naver.me/abc", "110-123-456789"])
    eq(`연락처·메일·SNS·링크·계좌는 막는다: ${text}`, await contact(text), true)

  const pair = async (a, b, sql, extra = []) => {
    const intro = (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at, mutual_at) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'mutual', now() - interval '1 day', now() + interval '1 hour', 'infinity', $3, $3, now() - interval '1 day', now()) returning id", [a, b, snap])).id
    return (await one(sql, [intro, a, b, ...extra])).id
  }
  const at = async (date, time) => clock((await one("select public.kst_at($1::date, $2::time)::text t", [date, time])).t)
  const plus = async (date, days) => (await one("select ($1::date + $2::int)::text d", [date, days])).d
  const today = (await one("select public.kst_today()::text d")).d

  // 방식이 다를 때 · 고른 방식이 알림에 · 24시간이 지나도 다르면 두 분 모두에게 한 번 · 시작일 제안 = 내 확인
  const V1 = await signup("v1@example.test"), V2 = await signup("v2@example.test")
  const choosing = await pair(V1, V2, "insert into public.programs (introduction_id, member_a, member_b, agree_by) values ($1, $2, $3, now() + interval '20 hours') returning id")
  await as(V1); await q("select public.choose_program_plan($1, 'A')", [choosing])
  await as(V2); await q("select public.choose_program_plan($1, 'B')", [choosing])
  await as("postgres")
  eq("방식을 바꾸면 상대에게 고른 방식을 알린다", (await one("select title from public.notifications where member_id = $1 and kind = 'program-plan'", [V1])).title, "상대가 B 첫 장면 만들기를 골랐어요")
  await one("select public.run_reminders()")
  eq("서로 선택하고 24시간이 지나도 방식이 다르면 두 분 모두에게 알린다", (await one("select count(*)::int n from public.notifications where dedupe_key like $1", [`remind-plan:${choosing}:%`])).n, 2)
  ok("알림에 두 분이 고른 방식이 적혀 있다", (await one("select body from public.notifications where dedupe_key = $1", [`remind-plan:${choosing}:${V1}`])).body.includes("나는 A 편지 나누기, 상대는 B 첫 장면 만들기"))
  await one("select public.run_reminders()")
  eq("방식이 다를 때 알림은 한 번만", (await one("select count(*)::int n from public.notifications where dedupe_key like $1", [`remind-plan:${choosing}:%`])).n, 2)
  await as(V2)
  ok("상대 방식으로 맞추면 같은 방식이 된다", (await one("select public.choose_program_plan($1, 'A') v", [choosing])).v.notice.includes("같아졌어요"))
  const proposed = (await one("select public.propose_program_start($1, public.kst_today() + 3) v", [choosing])).v
  eq("시작일을 제안한 사람은 그 날짜로 확인한 것이 된다", [proposed.ownConfirmed, proposed.partnerConfirmed], [true, false])
  await as(V1)
  eq("상대가 확인하면 바로 일정이 정해진다", (await one("select public.confirm_program($1) v", [choosing])).v.status, "scheduled")

  // A: 날짜가 든 편지는 보낼 수 있다 · 답장은 다음 날 09:00까지 · 편지가 열린 알림은 메일로도 · 18:00 답장 알림
  await as("postgres")
  const W1 = await signup("w1@example.test"), W2 = await signup("w2@example.test")
  const startA = await plus(today, -3)
  const letters = await pair(W1, W2, "insert into public.programs (introduction_id, member_a, member_b, status, plan_a, plan_b, start_on, agree_by, started_at) values ($1, $2, $3, 'started', 'A', 'A', $4::date, now(), now()) returning id", [startA])
  await at(startA, "10:00")
  await as(W1); await q("select public.submit_program_entry($1, 1, 'letter', '2026-10-28 14:00에 전시를 보고 왔어요. 생각보다 오래 머물렀어요.')", [letters])
  await as(W2); await q("select public.submit_program_entry($1, 1, 'letter', '요즘은 퇴근하고 동네를 천천히 걷는 시간이 제일 좋아요.')", [letters])
  await as("postgres")
  eq("편지가 함께 열리면 메일로도 가는 알림을 보낸다", (await q("select public.email_class(kind) c from public.notifications where member_id = $1 and dedupe_key like $2", [W1, `open:${letters}:1:letter:%`])).map((r) => r.c), ["important"])
  eq("답장이 열린 알림·상대의 움직임은 사이트에만", [(await one("select public.email_class('program-open') c")).c, (await one("select public.email_class('program-sent') c")).c], ["site", "site"])
  await at(startA, "18:30")
  await one("select public.run_reminders()")
  eq("18:00에 열린 편지에 답장하지 않은 두 분에게 알린다", (await one("select count(*)::int n from public.notifications where dedupe_key like $1", [`remind-reply:${letters}:1:%`])).n, 2)
  await at(await plus(startA, 1), "08:30")
  await as(W1)
  await q("select public.submit_program_entry($1, 1, 'reply', '전시 이야기 더 듣고 싶어요. 어떤 작품이 기억에 남았어요?')", [letters])
  ok("다음 날 09:00 전에는 전날 편지에 답장할 수 있다", (await mine()).entries.some((e) => e.day === 1 && e.kind === "reply" && e.own))
  await as(W2)
  eq("내가 쓰기 전에도 상대가 답장을 보낸 것을 안다", (await mine()).entries.find((e) => e.day === 1 && e.kind === "reply").partnerSent, true)
  await at(await plus(startA, 1), "09:10")
  await fails("다음 날 09:00이 지나면 전날 편지에는 답장할 수 없다", "select public.submit_program_entry($1, 1, 'reply', '늦었지만 답장 보내요.')", [letters], /다음 날 09:00/)
  await at(await plus(startA, 2), "10:00")
  await q("select public.submit_program_entry($1, 3, 'letter', '만나게 된다면 조용한 서점에서 천천히 이야기하고 싶어요.')", [letters])
  await as(W1); await q("select public.submit_program_entry($1, 3, 'letter', '직접 얼굴을 보고 듣고 싶은 이야기가 하나 있어요. 만나면 꼭 물어볼게요.')", [letters])
  await at(await plus(startA, 3), "08:30")
  await q("select public.submit_program_entry($1, 3, 'reply', '저도 서점 좋아요. 넷째 날 아침에 답장 남겨요.')", [letters])
  ok("셋째 날 편지 답장은 넷째 날 09:00 전까지 보낼 수 있다", (await mine()).entries.some((e) => e.day === 3 && e.kind === "reply" && e.own))

  // B: 전날 선택에 한마디 · 마지막 맞추기 · 마무리 뒤 다시 읽기
  await as("postgres")
  const X1 = await signup("x1@example.test"), X2 = await signup("x2@example.test")
  const startB = await plus(today, -3)
  const scene = await pair(X1, X2, "insert into public.programs (introduction_id, member_a, member_b, status, plan_a, plan_b, start_on, agree_by, started_at) values ($1, $2, $3, 'started', 'B', 'B', $4::date, now(), now()) returning id", [startB])
  const send = async (who, day, body, payload) => { await as(who); return (await one("select public.submit_program_entry($1, $2, 'scene', $3, $4) v", [scene, day, body, JSON.stringify(payload)])).v }
  await at(startB, "10:00")
  const firstB = await send(X1, 1, "책 고르는 걸 옆에서 구경하는 게 좋아서요.", { activity: "bookstore", about: "주말엔 동네 빵집에서 아침을 먹어요.", flow: "섞어 넣은 값" })
  ok("그날 쓰는 칸만 저장된다", !("flow" in firstB.entries.find((e) => e.day === 1).own.payload))
  await send(X2, 1, "조용히 같이 걸을 수 있을 것 같아서요.", { activity: "walk", about: "걷다 보면 생각이 정리돼요." })
  await at(await plus(startB, 1), "10:00")
  await as(X1)
  await fails("전날 답이 함께 열렸으면 상대의 선택에 한마디가 필요하다", "select public.submit_program_entry($1, 2, 'scene', null, $2)", [scene, JSON.stringify({ flow: "천천히 머물기", rest: "조용한 카페", about: "걸으면서 이야기하면 편해져요." })], /한마디/)
  await send(X1, 2, null, { flow: "천천히 머물기", rest: "조용한 카페", reaction: "산책 좋아요. 어디를 자주 걸어요?", about: "걸으면서 이야기하면 편해져요." })
  await send(X2, 2, null, { flow: "짧게 둘러보기", rest: "조용한 카페", reaction: "서점이라니 요즘 읽는 책이 궁금해요.", about: "처음엔 조금 조용한 편이에요." })
  await at(await plus(startB, 2), "10:00")
  await send(X1, 3, null, { topic: "요즘 읽는 책 이야기", reaction: "조용한 카페 좋아요.", about: "친구들은 저를 느긋하다고 해요." })
  await as(X1)
  await fails("셋째 날 답이 함께 열리기 전에는 맞출 수 없다", "select public.choose_first_scene($1, $2)", [scene, JSON.stringify({ activity: "walk", flow: "천천히 머물기", rest: "조용한 카페", topic: "요즘 읽는 책 이야기" })], /셋째 날/)
  await send(X2, 3, null, { topic: "최근에 다녀온 곳", reaction: "천천히 머무는 것도 좋아요.", about: "궁금한 건 바로 물어보는 편이에요." })
  await as(X1)
  await fails("두 분이 고르지 않은 것은 고를 수 없다", "select public.choose_first_scene($1, $2)", [scene, JSON.stringify({ activity: "cafe", flow: "천천히 머물기", rest: "조용한 카페", topic: "요즘 읽는 책 이야기" })], /하나씩/)
  const pick = { activity: "walk", flow: "천천히 머물기", rest: "조용한 카페", topic: "최근에 다녀온 곳" }
  const afterMine = (await one("select public.choose_first_scene($1, $2) v", [scene, JSON.stringify(pick)])).v.entries.find((e) => e.kind === "final")
  eq("내가 고른 첫 장면은 상대가 고르기 전까지 상대에게 보이지 않는다", afterMine.partner, null)
  await as(X2)
  const differ = (await one("select public.choose_first_scene($1, $2) v", [scene, JSON.stringify({ ...pick, flow: "짧게 둘러보기" })])).v
  ok("다른 부분이 있으면 서로의 선택이 보이고 안내한다", differ.notice.includes("다른 부분") && differ.entries.find((e) => e.kind === "final").partner.payload.flow === "천천히 머물기")
  const agreed = (await one("select public.choose_first_scene($1, $2) v", [scene, JSON.stringify(pick)])).v
  ok("같은 장면을 고르면 첫 장면이 정해진다", agreed.notice.includes("정해졌어요"))
  await as("postgres")
  ok("정해지면 두 분에게 알린다", (await one("select count(*)::int n from public.notifications where dedupe_key like $1", [`final-agreed:${scene}:%`])).n === 2)
  await as(X1)
  await fails("정해진 첫 장면은 다시 고를 수 없다", "select public.choose_first_scene($1, $2)", [scene, JSON.stringify({ ...pick, rest: "조용한 카페", flow: "짧게 둘러보기" })], /이미 같은 장면/)

  // 마무리 뒤 다시 읽기: 넷째 날 두 분 모두 만나고 싶다고 했던 교류만, 보존 기간 안에서
  await clock(null)
  await as("postgres")
  await q("update public.programs set status = 'closed', closed_at = now() - interval '10 days', end_reason = 'completed', meeting_a = 'positive', meeting_b = 'positive' where id = $1", [scene])
  await as(X1)
  const closedRead = await mine()
  ok("만남까지 마친 교류는 마무리 뒤에도 주고받은 글을 다시 읽을 수 있다", closedRead.status === "closed" && closedRead.entries.some((e) => e.kind === "scene" && e.partner) && closedRead.ownPlan === "B" && !!closedRead.readableUntil)
  await as("postgres")
  await q("update public.programs set closed_at = now() - interval '31 days' where id = $1", [scene])
  await as(X1)
  eq("보존 기간이 지나면 보이지 않는다", await mine(), null)
  await as("postgres")
  await q("update public.programs set closed_at = now() - interval '1 day', end_reason = 'meeting-declined', meeting_b = 'negative' where id = $1", [scene])
  await as(X1)
  ok("넷째 날 한 분이라도 거절한 교류는 글을 다시 보여 주지 않는다", (await mine()).entries.length === 0)
  await as("postgres")
  await q("update public.programs set end_reason = 'completed', meeting_b = 'positive' where id = $1", [scene])
  await q("insert into public.blocks (member_id, blocked_id) values ($1, $2)", [X2, X1])
  await as(X1)
  ok("차단 관계가 생기면 마무리된 교류의 글도 보이지 않는다", (await mine()).entries.length === 0)
  await as("postgres")
  await clock(null)
}

// ── 처음부터 끝까지(2026-10-29): 정오 소개 → 서로 선택 → 방식·시작일 → 3일 → 넷째 날 → 약속 → 연락처 → 마무리 → 다시 읽기
{
  await as("postgres")
  await clock(null)
  const at = async (date, time) => clock((await one("select public.kst_at($1::date, $2::time)::text t", [date, time])).t)
  const plus = async (date, days) => (await one("select ($1::date + $2::int)::text d", [date, days])).d
  const count = async (sql, params = []) => { await as("postgres"); return (await one(sql, params)).n }
  const notes = (key) => count("select count(*)::int n from public.notifications where dedupe_key like $1", [key])
  const run = async () => { await as("postgres"); const r = (await one("select public.run_programs() r")).r; assert.ok(!r.error, r.error); return r }
  const statusOf = async (id) => { await as("postgres"); return (await one("select status from public.programs where id = $1", [id])).status }
  // 새 회원: 신청서·사진 → 운영진 확인·승인 → 1기
  const fresh = async (email, name, gender, desired, base, phone) => {
    await as("postgres")
    const id = await signup(email)
    await as(id)
    const d = draft(name, gender, desired, "1995-06-06")
    await q("select public.save_application_draft($1)", [{ ...d, values: { ...d.values, "self.phone": phone } }])
    await photos(id, base)
    await q("select public.submit_application()")
    await as(O, "aal2")
    for (const slot of ["photo.face", "photo.upper", "photo.style"]) await q("select public.admin_review_photo($1, $2, '기준 확인')", [id, slot])
    await q("select public.admin_decide_application($1, 'approved')", [id])
    await q("select public.admin_move_member_cohort($1, 1)", [id])
    return id
  }
  // 운영진이 정오 소개를 예약하고, 정오가 된 것처럼 공개한다 → 두 분 모두 열어 보고 알아가고 싶어요
  const noonIntro = async (a, b) => {
    await as(O, "aal2")
    const intro = (await one("select public.admin_reserve_introduction($1, $2, (public.kst_today() + 3), '두 분 모두 쉬는 날 천천히 걷는 걸 좋아하셨어요.') id", [a, b])).id
    await as("postgres")
    await q("update public.introductions set reveal_at = now() - interval '1 minute', respond_by = now() + interval '23 hours', view_until = now() + interval '23 hours' where id = $1", [intro])
    eq("여정: 정오 작업이 소개를 공개한다", (await one("select public.run_noon() r")).r.published >= 1, true)
    eq("여정: 정오 소개 알림이 두 분에게 간다", await notes(`intro:${intro}:%`), 2)
    for (const m of [a, b]) { await as(m); await q("select public.record_introduction_view($1)", [intro]); await q("select public.respond_introduction($1, 'positive')", [intro]) }
    await as(a)
    eq("여정: 두 분 모두 ‘알아가고 싶어요’면 서로 선택", (await one("select public.my_introduction() v")).v.status, "mutual")
    eq("여정: 서로 선택 알림이 두 분에게 간다", await notes(`mutual:${intro}:%`), 2)
    await as(a)
    return intro
  }

  // ── 여정 A: 편지 나누기 → 만남까지 → 마무리 뒤 다시 읽기
  const JA = await fresh("ja@example.test", "나연", "여성", "남성", 3001, "010-3101-0001")
  const JB = await fresh("jb@example.test", "태오", "남성", "여성", 3011, "010-3101-0002")
  await noonIntro(JA, JB)
  let pa = await mine()
  eq("A 여정: 서로 선택하면 교류 합의가 열리고 상대 이름이 보인다", [pa.status, pa.partnerName], ["choosing", "태오"])
  await q("select public.choose_program_plan($1, 'A')", [pa.id])
  eq("A 여정: 방식을 고르면 상대에게 고른 방식을 알린다", await count("select count(*)::int n from public.notifications where member_id = $1 and kind = 'program-plan' and title = '상대가 A 편지 나누기를 골랐어요'", [JB]), 1)
  await as(JB)
  ok("A 여정: 같은 방식을 고르면 시작일 확인으로 넘어간다", (await one("select public.choose_program_plan($1, 'A') v", [pa.id])).v.notice.includes("같아졌어요"))
  const startA = (await one("select (public.kst_today() + 2)::text d")).d
  const proposedA = (await one("select public.propose_program_start($1, $2::date) v", [pa.id, startA])).v
  eq("A 여정: 시작일을 제안한 사람은 그 날짜로 확인한 것이 된다", [proposedA.startOn, proposedA.ownConfirmed, proposedA.partnerConfirmed], [startA, true, false])
  eq("A 여정: 상대에게 시작일 제안을 알린다", await notes(`date:${pa.id}:${JB}:%`), 1)
  await as(JA)
  eq("A 여정: 상대가 확인하면 일정이 정해진다", (await one("select public.confirm_program($1) v", [pa.id])).v.status, "scheduled")
  eq("A 여정: 일정이 정해졌다고 두 분에게 알린다", await notes(`scheduled:${pa.id}:%`), 2)
  await at(startA, "08:50"); await run()
  eq("A 여정: 시작일 09:00 전에는 열리지 않는다", await statusOf(pa.id), "scheduled")
  await at(startA, "09:30"); await run()
  eq("A 여정: 시작일 09:00에 첫날이 열린다", await statusOf(pa.id), "started")
  eq("A 여정: DAY01 알림이 두 분에게 간다", await notes(`day:${pa.id}:1:%`), 2)
  // 편지: 예시·도움말은 화면에만 있다. 편지와 함께 다른 값을 보내도 서버는 본문만 저장한다.
  const letter = async (who, day, kind, body) => { await as(who); return (await one("select public.submit_program_entry($1, $2, $3, $4, $5) v", [pa.id, day, kind, body, JSON.stringify({ hint: "쉬는 날엔 늦잠을 자고", example: 0 })])).v }
  await letter(JA, 1, "letter", "쉬는 날엔 늦잠을 자고 오후에 도서관 창가 자리에서 책을 읽어요.")
  eq("A 여정: 먼저 보내면 상대에게 ‘상대가 보냈어요’를 알린다", await notes(`sent:${pa.id}:1:letter:${JA}`), 1)
  await as(JA)
  eq("A 여정: 상대가 보내기 전에는 내 편지만 보인다", (await mine()).entries.find((e) => e.day === 1 && e.kind === "letter").partner, null)
  const openedA = (await letter(JB, 1, "letter", "토요일 아침마다 친구들과 배드민턴을 치고 국밥을 먹어요.")).entries.find((e) => e.day === 1 && e.kind === "letter")
  eq("A 여정: 두 분 모두 보내면 함께 열린다", openedA.partner.body, "쉬는 날엔 늦잠을 자고 오후에 도서관 창가 자리에서 책을 읽어요.")
  eq("A 여정: 편지가 열렸다는 알림(메일로도 가는 알림)이 두 분에게", await count("select count(*)::int n from public.notifications where dedupe_key like $1 and public.email_class(kind) = 'important'", [`open:${pa.id}:1:letter:%`]), 2)
  eq("A 여정: 예시·도움말 값은 편지에 저장되지 않는다(본문만)", await count("select count(*)::int n from public.program_entries where program_id = $1 and payload is not null", [pa.id]), 0)
  await at(startA, "17:00")
  await letter(JA, 1, "reply", "배드민턴 치고 먹는 국밥, 상상만 해도 좋아요.")
  await at(startA, "18:30")
  await as("postgres"); await one("select public.run_reminders()")
  eq("A 여정: 18:00에 아직 답장하지 않은 사람에게만 알린다", (await q("select member_id from public.notifications where dedupe_key like $1", [`remind-reply:${pa.id}:1:%`])).map((r) => r.member_id), [JB])
  await at(await plus(startA, 1), "08:30")
  await letter(JB, 1, "reply", "도서관 창가 자리, 저도 좋아하는 자리예요.")
  eq("A 여정: 다음 날 아침에 보낸 답장으로 두 분의 답장이 함께 열린다", await notes(`open:${pa.id}:1:reply:%`), 2)
  await as(JA)
  eq("A 여정: 열린 답장이 보인다", (await mine()).entries.find((e) => e.day === 1 && e.kind === "reply").partner.body, "도서관 창가 자리, 저도 좋아하는 자리예요.")
  await at(await plus(startA, 1), "10:00"); await run()
  eq("A 여정: DAY02 알림에 어제 편지가 열렸다고 적는다", await count("select count(*)::int n from public.notifications where dedupe_key like $1 and body like '어제 편지가 함께 열렸어요%'", [`day:${pa.id}:2:%`]), 2)
  await letter(JA, 2, "letter", "요즘은 가족과 저녁을 함께 먹는 시간을 가장 아껴요.")
  await letter(JB, 2, "letter", "작은 약속이라도 지키는 사람이고 싶어서 요즘 노력하고 있어요.")
  await at(await plus(startA, 2), "10:00")
  await letter(JB, 3, "letter", "만나게 된다면 강가를 같이 천천히 걷고 싶어요.")
  await letter(JA, 3, "letter", "조용한 전시를 보고 근처 카페에서 이야기를 나누고 싶어요.")
  await as(JA)
  eq("A 여정: 사흘 편지가 모두 함께 열렸다", (await mine()).entries.filter((e) => e.kind === "letter" && e.own && e.partner).map((e) => e.day), [1, 2, 3])
  await at(await plus(startA, 3), "09:05"); await run()
  eq("A 여정: DAY04 09:00에 만남 선택이 열린다", await statusOf(pa.id), "deciding")
  eq("A 여정: 만남 선택 알림에 DAY03 글이 열렸다고 적는다", await count("select count(*)::int n from public.notifications where dedupe_key like $1 and body like 'DAY03 글도 함께 열렸어요%'", [`decide:${pa.id}:%`]), 2)
  await as(JA); await q("select public.choose_meeting($1, 'positive')", [pa.id])
  eq("A 여정: 한 분만 답하면 아직 결과를 알리지 않는다", await notes(`meet:${pa.id}:%`), 0)
  await as(JB)
  eq("A 여정: 두 분 모두 만나고 싶으면 약속 정하기로", (await one("select public.choose_meeting($1, 'positive') v", [pa.id])).v.status, "arranging")
  eq("A 여정: 두 분 모두 만나고 싶다고 알린다", await notes(`meet:${pa.id}:%`), 2)
  const meetA = await plus(startA, 6)
  await as(JA)
  const proposalA = (await one("select public.propose_appointment($1, $2, '전시·미술관', '종로구', '공개된 미술관', '천천히 보고 카페에서 이야기해요') v", [pa.id, JSON.stringify([{ date: meetA, start: "14:00", end: "17:00" }, { date: await plus(startA, 7), start: "11:00", end: "14:00" }])])).v.proposals[0]
  eq("A 여정: 약속 제안이 상대에게 간다", await count("select count(*)::int n from public.notifications where member_id = $1 and kind = 'appointment-new' and dedupe_key like $2", [JB, `proposal:${pa.id}:${JA}:%`]), 1)
  await as(JB)
  const acceptedA = (await one("select public.accept_appointment($1, 0) v", [proposalA.id])).v
  eq("A 여정: 상대가 시간을 고르면 약속이 정해진다", [acceptedA.meetingOn, acceptedA.meetingTime], [meetA, "14:00~17:00"])
  eq("A 여정: 약속이 정해졌다고 두 분에게 알린다", await notes(`final:${proposalA.id}:%`), 2)
  for (const m of [JA, JB]) { await as(m); await q("select public.set_contact_consent($1, true)", [pa.id]) }
  await as(JB)
  eq("A 여정: 만나는 날 전에는 번호가 보이지 않는다", (await mine()).partnerPhone, null)
  await at(meetA, "08:00")
  await as(JB)
  eq("A 여정: 만나는 날에는 두 분이 동의한 번호가 열린다", [(await mine()).contactReleased, (await mine()).partnerPhone], [true, "010-3101-0001"])
  await run()
  eq("A 여정: 연락처가 열렸다고 두 분에게 알린다", await notes(`contact:${pa.id}:${meetA}:%`), 2)
  await at(await plus(meetA, 2), "00:05"); await run()
  await as("postgres")
  eq("A 여정: 만남 다음 날이 지나면 ‘만남까지 마친 교류’로 닫힌다", { ...(await one("select status, end_reason from public.programs where id = $1", [pa.id])) }, { status: "closed", end_reason: "completed" })
  eq("A 여정: 마치면 두 분 모두 새 소개를 잠시 쉰다(자동)", (await q("select paused_by from public.profiles where id in ($1, $2) and paused_at is not null", [JA, JB])).map((r) => r.paused_by), ["auto", "auto"])
  eq("A 여정: 마무리 알림이 두 분에게 간다", await notes(`done:${pa.id}:%`), 2)
  await as(JA)
  const doneA = await mine()
  ok("A 여정: 마무리된 교류를 다시 읽을 수 있다(글·상대 이름·보관 기한)", doneA.status === "closed" && doneA.partnerName === "태오" && !!doneA.readableUntil && doneA.entries.filter((e) => e.partner).length >= 4)
  eq("A 여정: 마무리 뒤 번호는 더 보이지 않는다", [doneA.contactReleased, "partnerPhone" in doneA], [false, false])
  let listA = (await one("select public.my_readable_programs() v")).v
  eq("A 여정: 지난 교류 목록에 다시 읽을 수 있는 교류가 있다", listA.map((p) => [p.id, p.partnerName, p.ownPlan]), [[pa.id, "태오", "A"]])
  ok("A 여정: 지난 교류 목록에도 주고받은 글이 함께 온다", listA[0].entries.some((e) => e.kind === "reply" && e.partner) && !!listA[0].readableUntil)
  // 새 교류가 시작돼도 지난 교류는 목록에서 다시 읽을 수 있다
  await as("postgres")
  const JC = await signup("jc@example.test")
  const newerIntro = (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at, mutual_at) values ($1, $2, '두 분 모두 음악을 좋아하셨어요.', 'mutual', now() - interval '1 day', now() + interval '1 hour', 'infinity', $3, $3, now() - interval '1 day', now()) returning id", [JA, JC, snap])).id
  const newer = (await one("insert into public.programs (introduction_id, member_a, member_b, status, plan_a, plan_b, start_on, agree_by, started_at) values ($1, $2, $3, 'started', 'B', 'B', public.kst_today(), now(), now()) returning id", [newerIntro, JA, JC])).id
  await as(JA)
  eq("A 여정: 새 교류가 시작되면 교류 화면은 새 교류를 보여 준다", (await mine()).id, newer)
  listA = (await one("select public.my_readable_programs() v")).v
  eq("A 여정: 새 교류가 시작돼도 지난 교류는 다시 읽을 수 있다", listA.map((p) => p.id), [pa.id])
  await as(JC)
  eq("A 여정: 다른 사람의 지난 교류는 보이지 않는다", (await one("select public.my_readable_programs() v")).v, [])
  await as("anon")
  await fails("A 여정: 비회원은 지난 교류 목록을 부를 수 없다", "select public.my_readable_programs()")
  await as("postgres")
  await q("delete from public.programs where id = $1", [newer])
  await clock(null)

  // ── 여정 B: 첫 장면 만들기 → 첫날 서로 다른 곳 → 장소별 둘째 날 → 첫 장면 맞추기 → 넷째 날 한 분 거절
  const KB1 = await fresh("kb1@example.test", "수아", "여성", "남성", 3021, "010-3101-0003")
  const KB2 = await fresh("kb2@example.test", "지호", "남성", "여성", 3031, "010-3101-0004")
  await noonIntro(KB1, KB2)
  let pb = await mine()
  await q("select public.choose_program_plan($1, 'B')", [pb.id])
  await as(KB2)
  pb = (await one("select public.choose_program_plan($1, 'B') v", [pb.id])).v
  const startB = pb.startOn
  eq("B 여정: 같은 방식이면 기본 시작일은 내일", startB, (await one("select (public.kst_today() + 1)::text d")).d)
  await q("select public.confirm_program($1)", [pb.id])
  eq("B 여정: 상대가 확인했다고 알린다", await notes(`confirm:${pb.id}:${KB2}:%`), 1)
  await as(KB1)
  eq("B 여정: 두 분이 모두 확인하면 일정이 정해진다", (await one("select public.confirm_program($1) v", [pb.id])).v.status, "scheduled")
  await at(startB, "09:30"); await run()
  eq("B 여정: 시작일 09:00에 첫날이 열린다", await statusOf(pb.id), "started")
  const scene = async (who, day, body, payload) => { await as(who); return (await one("select public.submit_program_entry($1, $2, 'scene', $3, $4) v", [pb.id, day, body, JSON.stringify(payload)])).v }
  const sceneFails = (label, who, day, body, payload, pattern) => as(who).then(() => fails(label, "select public.submit_program_entry($1, $2, 'scene', $3, $4)", [pb.id, day, body, JSON.stringify(payload)], pattern))
  await sceneFails("B 여정: 나를 소개하는 짧은 질문에 답하지 않으면 보낼 수 없다", KB1, 1, null, { activity: "exhibition" }, /나를 소개하는 짧은 질문/)
  await sceneFails("B 여정: 목록에 없는 장소는 고를 수 없다", KB1, 1, null, { activity: "club", about: "주말엔 전시를 자주 봐요." }, /분위기/)
  await sceneFails("B 여정: 고른 이유는 한 줄(60자 안)로", KB1, 1, "가".repeat(61), { activity: "exhibition", about: "주말엔 전시를 자주 봐요." }, /60자/)
  const firstB = await scene(KB1, 1, null, { activity: "exhibition", about: "주말엔 전시를 자주 봐요.", example: "예시 문장" })
  const ownFirst = firstB.entries.find((e) => e.day === 1).own
  eq("B 여정: 고른 이유는 적지 않아도 되고, 예시 같은 다른 값은 저장되지 않는다", [ownFirst.body, Object.keys(ownFirst.payload).sort()], [null, ["about", "activity"]])
  eq("B 여정: 먼저 보내면 상대에게 알린다", await notes(`sent:${pb.id}:1:scene:${KB1}`), 1)
  await scene(KB2, 1, "날이 좋으면 밖에서 오래 이야기하고 싶어서요.", { activity: "park", about: "주말엔 한강에서 자전거를 타요." })
  eq("B 여정: 첫날 답이 함께 열렸다고 두 분에게 알린다", await notes(`open:${pb.id}:1:scene:%`), 2)
  await as(KB1)
  eq("B 여정: 첫날 두 분이 서로 다른 곳을 골랐다", (await mine()).entries.find((e) => e.day === 1).partner.payload.activity, "park")
  await at(await plus(startB, 1), "10:00")
  const reaction = "공원 피크닉이라니 날씨 좋은 날 꼭 가 보고 싶어요."
  await sceneFails("B 여정: 둘째 날은 두 분이 첫날 고른 곳만 기준으로 고를 수 있다", KB1, 2, null, { place: "cafe", flow: "한 곳에서 오래 이야기하기", rest: "디저트 가게", reaction, about: "걸으면서 이야기하면 편해져요." }, /첫날 고른 곳/)
  await sceneFails("B 여정: 고른 곳과 맞지 않는 머무는 방식은 고를 수 없다", KB1, 2, null, { place: "park", flow: "한 전시만 천천히 보기", rest: "나무 그늘 아래", reaction, about: "걸으면서 이야기하면 편해져요." }, /첫날 고른 곳/)
  await sceneFails("B 여정: 목록에 없는 쉬어 갈 곳은 고를 수 없다", KB1, 2, null, { place: "park", flow: "돗자리 펴고 오래 머물기", rest: "노래방", reaction, about: "걸으면서 이야기하면 편해져요." }, /첫날 고른 곳/)
  await sceneFails("B 여정: 전날 답이 함께 열렸으면 한마디가 필요하다", KB1, 2, null, { place: "park", flow: "돗자리 펴고 오래 머물기", rest: "나무 그늘 아래", about: "걸으면서 이야기하면 편해져요." }, /한마디/)
  await scene(KB1, 2, "공원 이야기를 듣고 나니 가 보고 싶어졌어요.", { place: "park", flow: "돗자리 펴고 오래 머물기", rest: "나무 그늘 아래", reaction, about: "걸으면서 이야기하면 편해져요." })
  const secondB = (await scene(KB2, 2, null, { place: "exhibition", flow: "한 전시만 천천히 보기", rest: "미술관 안 카페", reaction: "전시 좋아요. 요즘 본 전시가 궁금해요.", about: "처음엔 조금 조용한 편이에요." })).entries.find((e) => e.day === 2)
  eq("B 여정: 둘째 날은 장소별 선택과 (적었다면) 이유가 함께 열린다", [secondB.own.payload.place, secondB.own.body, secondB.partner.payload.place, secondB.partner.payload.flow, secondB.partner.body], ["exhibition", null, "park", "돗자리 펴고 오래 머물기", "공원 이야기를 듣고 나니 가 보고 싶어졌어요."])
  await at(await plus(startB, 2), "10:00")
  const thirdB = (await scene(KB1, 3, "셋째 날 이유는 받지 않아요", { topic: "요즘 읽는 책 이야기", reaction: "미술관 카페 좋아요.", about: "친구들은 저를 느긋하다고 해요." })).entries.find((e) => e.day === 3)
  eq("B 여정: 셋째 날에는 이유를 저장하지 않는다", thirdB.own.body, null)
  await scene(KB2, 3, null, { topic: "최근에 다녀온 곳", reaction: "돗자리 피크닉 좋아요.", about: "궁금한 건 바로 물어보는 편이에요." })
  eq("B 여정: 셋째 날 답이 열리면 첫 장면을 맞추자고 알린다", await count("select count(*)::int n from public.notifications where dedupe_key like $1 and body like '%첫 장면을 함께 맞춰요%'", [`open:${pb.id}:3:scene:%`]), 2)
  const pickB = { activity: "exhibition", flow: "한 전시만 천천히 보기", rest: "나무 그늘 아래", topic: "최근에 다녀온 곳" }
  await as(KB1)
  ok("B 여정: 두 분이 고른 것 중에서 고르면 상대를 기다린다", (await one("select public.choose_first_scene($1, $2) v", [pb.id, JSON.stringify(pickB)])).v.notice.includes("상대도 고르면"))
  eq("B 여정: 상대에게 첫 장면을 골랐다고 알린다", await notes(`final-sent:${pb.id}:${KB1}`), 1)
  await as(KB2)
  await fails("B 여정: 두 분이 고르지 않은 쉬어 갈 곳은 첫 장면에 넣을 수 없다", "select public.choose_first_scene($1, $2)", [pb.id, JSON.stringify({ ...pickB, rest: "디저트 가게" })], /하나씩/)
  const diffB = (await one("select public.choose_first_scene($1, $2) v", [pb.id, JSON.stringify({ ...pickB, activity: "park", flow: "돗자리 펴고 오래 머물기" })])).v
  ok("B 여정: 다르면 서로의 선택이 보이고 다시 고를 수 있다", diffB.notice.includes("다른 부분") && diffB.entries.find((e) => e.kind === "final").partner.payload.activity === "exhibition")
  const agreedB = (await one("select public.choose_first_scene($1, $2) v", [pb.id, JSON.stringify(pickB)])).v
  ok("B 여정: 같은 장면을 고르면 첫 장면이 정해진다", agreedB.notice.includes("정해졌어요"))
  eq("B 여정: 첫 장면이 정해졌다고 두 분에게 알린다", await notes(`final-agreed:${pb.id}:%`), 2)
  await as(KB1)
  const finalB = (await mine()).entries.find((e) => e.kind === "final")
  eq("B 여정: 약속 제안에 미리 채울 첫 장면(장소·머무는 방식·쉬어 갈 곳·이야기)이 두 분 모두에게 있다", [finalB.own.payload, finalB.partner.payload], [pickB, pickB])
  await at(await plus(startB, 3), "09:05"); await run()
  eq("B 여정: DAY04 09:00에 만남 선택이 열린다", await statusOf(pb.id), "deciding")
  await as(KB1); await q("select public.choose_meeting($1, 'positive')", [pb.id])
  await as(KB2)
  eq("B 여정: 한 분이라도 ‘이번에는 여기까지’면 조용히 마무리된다", (await one("select public.choose_meeting($1, 'negative') v", [pb.id])).v.endReason, "meeting-declined")
  eq("B 여정: 누가 어떻게 답했는지 밝히지 않는 마무리 알림이 두 분에게", await count("select count(*)::int n from public.notifications where dedupe_key like $1 and body like '누가 어떤 답을 했는지는 알려 드리지 않아요%'", [`pclosed:${pb.id}:%`]), 2)
  await as(KB1)
  const closedB = await mine()
  ok("B 여정: 거절로 끝난 교류는 글·상대 이름을 다시 보여 주지 않는다", closedB.status === "closed" && closedB.entries.length === 0 && !("partnerName" in closedB))
  eq("B 여정: 거절로 끝난 교류는 지난 교류 목록에도 없다", (await one("select public.my_readable_programs() v")).v, [])
  await fails("B 여정: 마무리된 교류에서는 첫 장면을 고를 수 없다", "select public.choose_first_scene($1, $2)", [pb.id, JSON.stringify(pickB)], /지금은/)
  await clock(null)

  // ── 첫날 답이 함께 열리지 않았을 때 둘째 날: 내가 첫날 고른 곳을 기준으로 고른다(첫날 답을 보내지 않았다면 일곱 곳 중에서)
  await as("postgres")
  const Y1 = await signup("y1@example.test"), Y2 = await signup("y2@example.test")
  const soloIntro = (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at, mutual_at) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'mutual', now() - interval '1 day', now() + interval '1 hour', 'infinity', $3, $3, now() - interval '1 day', now()) returning id", [Y1, Y2, snap])).id
  const startY = await plus((await one("select public.kst_today()::text d")).d, -1)
  const solo = (await one("insert into public.programs (introduction_id, member_a, member_b, status, plan_a, plan_b, start_on, agree_by, started_at) values ($1, $2, $3, 'started', 'B', 'B', $4::date, now(), now()) returning id", [soloIntro, Y1, Y2, startY])).id
  await q("insert into public.program_entries (program_id, day, kind, author, payload) values ($1, 1, 'scene', $2, '{\"activity\":\"bookstore\",\"about\":\"주말엔 서점에 가요.\"}')", [solo, Y1])
  await at(await plus(startY, 1), "10:00")
  await as(Y1)
  await fails("첫날이 열리지 않았으면 내가 고른 곳이 아닌 곳으로는 고를 수 없다", "select public.submit_program_entry($1, 2, 'scene', null, $2)", [solo, JSON.stringify({ place: "park", flow: "돗자리 펴고 오래 머물기", rest: "물가 벤치", about: "걸으면 편해져요." })], /첫날 고른 곳/)
  eq("첫날이 열리지 않았으면 내가 고른 곳의 목록에서 고르고, 한마디는 없어도 된다", (await one("select public.submit_program_entry($1, 2, 'scene', null, $2) v", [solo, JSON.stringify({ place: "bookstore", flow: "각자 한 권씩 골라 보기", rest: "서점 안 카페", about: "걸으면 편해져요." })])).v.entries.find((e) => e.day === 2).own.payload.place, "bookstore")
  await as(Y2)
  eq("첫날 답을 보내지 않았으면 일곱 곳 중 한 곳을 기준으로 고를 수 있다", (await one("select public.submit_program_entry($1, 2, 'scene', null, $2) v", [solo, JSON.stringify({ place: "market", flow: "조금씩 맛보며 걷기", rest: "시장 안 분식집", about: "처음엔 듣는 편이에요." })])).v.entries.find((e) => e.day === 2).own.payload.place, "market")
  // 둘째 날도 함께 열리지 않은 경우를 보려고 Y2의 둘째 날 답은 지운다.
  await as("postgres")
  await q("delete from public.program_entries where program_id = $1 and day = 2 and author = $2", [solo, Y2])
  await at(await plus(startY, 2), "10:00")
  for (const [who, topic] of [[Y1, "요즘 읽는 책 이야기"], [Y2, "최근에 다녀온 곳"]]) { await as(who); await q("select public.submit_program_entry($1, 3, 'scene', null, $2)", [solo, JSON.stringify({ topic, about: "느긋한 편이에요." })]) }
  await as(Y1)
  await fails("둘째 날이 열리지 않았으면 맞추려는 장소에 맞지 않는 머무는 방식은 고를 수 없다", "select public.choose_first_scene($1, $2)", [solo, JSON.stringify({ activity: "walk", flow: "조금씩 맛보며 걷기", rest: "강가 벤치", topic: "최근에 다녀온 곳" })], /하나씩/)
  ok("첫날·둘째 날이 열리지 않았으면 일곱 곳 중 한 곳과 그곳에 맞는 목록에서 맞춘다", (await one("select public.choose_first_scene($1, $2) v", [solo, JSON.stringify({ activity: "walk", flow: "천천히 오래 걷기", rest: "강가 벤치", topic: "최근에 다녀온 곳" })])).v.notice.includes("상대도 고르면"))
  await as("postgres")
  await clock(null)
}

// ── 점검 고치기 2(3400): 신청서 다시 열기 · 탈퇴 요청 취소 · 처음 제출만 설정 반영 · 메일 실패 횟수·확인한 계정만 · 신청서 고치기 안내 · 다시 받기 문구 · 보여 준 알림만 읽음
{
  await as("postgres")
  await clock(null)
  const R1 = await signup("r1@example.test"), R2 = await signup("r2@example.test"), R3 = await signup("r3@example.test"), R4 = await signup("r4@example.test")
  const notesOf = async (member, kind) => (await one("select count(*)::int n from public.notifications where member_id = $1 and kind = $2", [member, kind])).n
  const appStatus = async (member) => (await one("select status from public.applications where member_id = $1", [member])).status

  // 4. 알림·광고 수신 설정은 처음 제출할 때만 신청서 값으로 정한다
  const r1Draft = draft("라온", "여성", "남성", "1996-04-01")
  r1Draft.values["consent.marketing"] = true
  await as(R1)
  await q("select public.save_application_draft($1)", [r1Draft])
  await photos(R1, 7001)
  await q("select public.submit_application()")
  eq("처음 제출하면 신청서의 광고 수신 동의가 내 정보에 반영된다", (await one("select marketing_opt_in from public.profiles where id = $1", [R1])).marketing_opt_in, true)
  await q("update public.profiles set marketing_opt_in = false, notice_daily_waiting = false where id = $1", [R1])
  await as("postgres")
  await q("update public.applications set status = 'needs_changes' where member_id = $1", [R1])
  await as(R1)
  await q("select public.save_application_draft($1)", [r1Draft])
  await q("select public.submit_application()")
  eq("다시 제출해도 내 정보에서 끈 광고 수신·정오 알림이 다시 켜지지 않는다", { ...(await one("select marketing_opt_in m, notice_daily_waiting n from public.profiles where id = $1", [R1])) }, { m: false, n: false })

  // 8. 신청서 고치기: 회원이 모르는 정오 예약은 알리지 않고 취소, 진행 중인 소개는 예약을 드러내지 않는 말로 막는다
  await as("postgres")
  // 기수 시작 전에는 예약할 수 없으므로, 시험에서는 기수를 비워 둔다.
  await q("update public.applications set status = 'approved', cohort_number = null where member_id = $1", [R1])
  const reserved = (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'reserved', now() + interval '2 hours', now() + interval '1 day', now() + interval '1 day', '{}', '{}') returning id", [R1, R2])).id
  await as(R1)
  eq("정오 예약만 있으면 신청서를 고칠 수 있다(다시 확인 상태로)", (await one("select public.save_application_draft($1) r", [r1Draft])).r.status, "submitted")
  await as("postgres")
  eq("고치면 회원이 모르는 정오 예약은 공개 직전 취소와 같이 끝난다", { ...(await one("select status, end_reason, count_a, count_b from public.introductions where id = $1", [reserved])) }, { status: "cancelled", end_reason: "precheck", count_a: false, count_b: false })
  eq("취소된 예약은 상대에게 알리지 않는다", (await one("select count(*)::int n from public.notifications where member_id = $1 and created_at > now() - interval '1 minute' and kind like 'intro%'", [R2])).n, 0)
  await q("update public.applications set status = 'approved', cohort_number = null where member_id = $1", [R1])
  await q("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'published', now() - interval '1 hour', now() + interval '1 day', now() + interval '1 day', '{}', '{}', now() - interval '1 hour')", [R1, R3])
  await as(R1)
  let editError = ""
  try { await q("select public.save_application_draft($1)", [r1Draft]) } catch (error) { editError = error.message }
  ok("진행 중인 소개가 있으면 고친 내용을 보낼 수 없고, 안내에 ‘예정’ 소개를 드러내지 않는다", /진행 중인 소개나 교류/.test(editError) && !editError.includes("예정"))
  eq("막혔을 때 신청서 상태는 그대로다", await appStatus(R1), "approved")

  // 1. 철회한 신청서 다시 열기
  await as(R2)
  await q("select public.save_application_draft($1)", [draft("다온", "남성", "여성", "1994-02-01")])
  await q("select public.withdraw_application()")
  await fails("회원은 신청서를 다시 열 수 없다", "select public.admin_reopen_application($1, '문의로 요청')", [R2], /운영 권한/)
  await as(O, "aal2")
  await fails("다시 열 때는 이유를 적어야 한다", "select public.admin_reopen_application($1, ' ')", [R2], /이유/)
  await q("select public.admin_reopen_application($1, '문의로 다시 신청하고 싶다고 했어요')", [R2])
  await as("postgres")
  eq("철회한 신청서를 다시 열면 작성 중이 된다", await appStatus(R2), "draft")
  eq("다시 열면 회원에게 알린다", await notesOf(R2, "application-reopened"), 1)
  eq("다시 연 기록이 감사 기록에 남는다", (await one("select count(*)::int n from public.audit_log where action = '신청서 다시 열기' and target = $1", [R2])).n, 1)
  await as(O, "aal2")
  await fails("철회하지 않은 신청서는 다시 열 수 없다", "select public.admin_reopen_application($1, '다시')", [R2], /철회한 신청서만/)

  // 2. 탈퇴 요청 취소(삭제 예정 시각 전에만)
  await as(R3)
  await q("select public.request_withdrawal()")
  await as(R3)
  await fails("회원은 탈퇴 취소를 직접 할 수 없다", "select public.admin_cancel_withdrawal($1, '취소')", [R3], /운영 권한/)
  await as(O, "aal2")
  const listed = (await one("select public.admin_list_members('r3@') v")).v.find((row) => row.id === R3)
  ok("회원 목록에 삭제 예정 시각이 보인다", listed && listed.status === "withdrawal_requested" && !!listed.deletionDueAt && !!listed.withdrawalRequestedAt)
  await q("select public.admin_cancel_withdrawal($1, '문의로 탈퇴를 취소하고 싶다고 했어요')", [R3])
  await as("postgres")
  eq("탈퇴 요청을 취소하면 이용 중으로 돌아가고 삭제 예약이 지워진다", { ...(await one("select status, deletion_due_at, withdrawal_requested_at from public.profiles where id = $1", [R3])) }, { status: "active", deletion_due_at: null, withdrawal_requested_at: null })
  eq("탈퇴 요청 기록은 처리 완료가 된다", (await one("select status from public.member_requests where member_id = $1 and kind = 'withdrawal'", [R3])).status, "decided")
  eq("탈퇴 취소를 회원에게 알린다(요청 처리 알림과 겹치지 않게 한 번)", [await notesOf(R3, "withdrawal-cancelled"), await notesOf(R3, "request-decided")], [1, 0])
  await as(O, "aal2")
  await fails("탈퇴를 요청하지 않은 회원은 취소할 수 없다", "select public.admin_cancel_withdrawal($1, '다시')", [R3], /탈퇴를 요청한 회원이 아니에요/)
  await as(R4)
  await q("select public.request_withdrawal()")
  await as("postgres")
  await q("update public.profiles set deletion_due_at = now() - interval '1 minute' where id = $1", [R4])
  await as(O, "aal2")
  await fails("삭제 예정 시각이 지나면 탈퇴를 취소할 수 없다", "select public.admin_cancel_withdrawal($1, '늦은 요청')", [R4], /삭제 예정 시각/)

  // 9. 운영진이 쉬기를 풀면 ‘내 정보에서 다시 쉴 수 있다’고 알린다
  await q("select public.admin_set_member_state($1, 'pause', '확인할 일')", [R3])
  await q("select public.admin_set_member_state($1, 'resume')", [R3])
  await as("postgres")
  ok("다시 받기 알림은 쉬기가 있는 내 정보를 가리킨다", (await one("select body from public.notifications where member_id = $1 and kind = 'operator-resumed'", [R3])).body.includes("내 정보에서"))

  // 5·6. 메일: 가입 확인을 마친 계정만, 3번 실패하면 멈추고, 처음 보내는 것이 먼저
  await as("postgres")
  await clock((await one("select public.kst_at(public.kst_today(), '13:00')::text t")).t)
  const pendingIds = async () => (await q("select id from public.pending_email_notifications(5000)")).map((row) => row.id)
  const reopenNote = (await one("select id from public.notifications where member_id = $1 and kind = 'application-reopened'", [R2])).id
  ok("가입 확인을 마친 회원의 알림은 메일로 보낼 차례에 든다", (await pendingIds()).includes(reopenNote))
  await q("update auth.users set email_confirmed_at = null where id = $1", [R2])
  ok("가입 확인을 마치지 않은 계정에는 메일을 보내지 않는다", !(await pendingIds()).includes(reopenNote))
  await as(O, "aal2")
  await q("select public.admin_broadcast('베타 운영 안내예요', '가입 확인을 마친 회원에게만 가는 공지예요.')")
  await as("postgres")
  eq("전체 공지는 가입 확인을 마치지 않은 계정에는 가지 않는다", await notesOf(R2, "announcement"), 0)
  ok("전체 공지는 가입 확인을 마친 회원에게 간다", (await notesOf(R3, "announcement")) >= 1)
  await q("update auth.users set email_confirmed_at = now() where id = $1", [R2])
  const older = (await one("select id from public.notifications where member_id = $1 and kind = 'withdrawal-cancelled'", [R3])).id
  const newer = (await one("select id from public.notifications where member_id = $1 and kind = 'operator-resumed'", [R3])).id
  await q("update public.notifications set created_at = now() - interval '1 hour' where id = $1", [older])
  eq("실패한 메일은 실패 횟수를 돌려준다", (await one("select public.record_email_failure('notification', $1, 'smtp 550') n", [older])).n, 1)
  const order = await pendingIds()
  ok("한 번 실패한 메일보다 처음 보내는 메일이 먼저 나간다", order.includes(older) && order.indexOf(newer) < order.indexOf(older))
  await q("select public.record_email_failure('notification', $1, 'smtp 550')", [older])
  await q("select public.record_email_failure('notification', $1, 'smtp 550')", [older])
  ok("3번 실패한 메일은 더 보내지 않는다", !(await pendingIds()).includes(older))
  await as(R3)
  await fails("회원은 메일 실패 기록 함수를 부를 수 없다", "select public.record_email_failure('notification', $1, 'x')", [older])
  await as("postgres")
  await clock(null)

  // 10. 오늘 화면에 보여 준 알림만 읽음으로
  await as(R3)
  const unread = (await q("select id from public.notifications where member_id = $1 and read_at is null order by created_at desc", [R3])).map((row) => row.id)
  ok("읽지 않은 알림이 둘 이상 있다", unread.length >= 2)
  eq("보여 준 알림만 읽음으로 바뀐다", (await one("select public.mark_shown_notifications_read($1::uuid[]) n", [[unread[0]]])).n, 1)
  eq("보여 주지 않은 알림은 읽지 않음으로 남는다", (await one("select count(*)::int n from public.notifications where member_id = $1 and read_at is null", [R3])).n, unread.length - 1)
  eq("남의 알림은 읽음으로 바꿀 수 없다", (await one("select public.mark_shown_notifications_read($1::uuid[]) n", [[reopenNote]])).n, 0)
  await as("postgres")
}

console.log(`서버 데이터베이스 점검 통과: ${passed}개`)
