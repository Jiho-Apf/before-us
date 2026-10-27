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
await one("select public.submit_program_entry($1, 1, 'scene', '골목을 천천히 걷고 싶어요.', $2)", [exProgram, JSON.stringify({ activity: "market" })])
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

console.log(`서버 데이터베이스 점검 통과: ${passed}개`)
