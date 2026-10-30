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
  // 다시 고를 때 알림(4100): 실제로 바뀐 때만, 같은 사람에게 한 시간에 한 번
  eq("B 여정: 다르게 고르면 상대에게 한 번 알린다", await notes(`final-diff:${pb.id}:${KB2}:%`), 1)
  await as(KB2)
  await q("select public.choose_first_scene($1, $2)", [pb.id, JSON.stringify({ ...pickB, activity: "park", flow: "돗자리 펴고 오래 머물기" })])
  eq("B 여정: 같은 선택을 다시 눌러도 알림이 더 가지 않는다", await notes(`final-diff:${pb.id}:${KB2}:%`), 1)
  await as(KB2)
  await q("select public.choose_first_scene($1, $2)", [pb.id, JSON.stringify({ ...pickB, activity: "park" })])
  eq("B 여정: 한 시간 안에 여러 번 바꿔도 알림은 한 번", await notes(`final-diff:${pb.id}:${KB2}:%`), 1)
  await at(await plus(startB, 2), "11:05")
  await as(KB2)
  await q("select public.choose_first_scene($1, $2)", [pb.id, JSON.stringify({ ...pickB, flow: "돗자리 펴고 오래 머물기" })])
  eq("B 여정: 한 시간이 지나 다시 바꾸면 한 번 더 알린다", await notes(`final-diff:${pb.id}:${KB2}:%`), 2)
  await as(KB2)
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

// ── 매칭 2차(3700): 다시 소개하지 않는 두 사람(서로 선택·넘김·열어 본 분의 무응답·신고·차단) · 예외는 다시 소개 · 두 사람 소개 기록 · 회원에게 보일 궁합
{
  await as("postgres")
  await clock(null)
  const reason = "두 분 모두 쉬는 날 천천히 걷는 걸 좋아하셨어요."
  const member = async (email, name, gender, desired, base, phone) => {
    await as("postgres")
    const id = await signup(email)
    await as(id)
    const d = draft(name, gender, desired, "1994-04-04")
    await q("select public.save_application_draft($1)", [{ ...d, values: { ...d.values, "self.phone": phone } }])
    await photos(id, base)
    await q("select public.submit_application()")
    await as(O, "aal2")
    for (const slot of ["photo.face", "photo.upper", "photo.style"]) await q("select public.admin_review_photo($1, $2, '기준 확인')", [id, slot])
    await q("select public.admin_decide_application($1, 'approved')", [id])
    await q("select public.admin_move_member_cohort($1, 1)", [id])
    return id
  }
  const W = await member("mw1@example.test", "소윤", "여성", "남성", 37010, "010-3701-0001")
  const W2 = await member("mw2@example.test", "예린", "여성", "남성", 37020, "010-3701-0002")
  const W3 = await member("mw3@example.test", "다인", "여성", "남성", 37030, "010-3701-0003")
  const men = []
  for (let i = 1; i <= 11; i++) men.push(await member(`mm${i}@example.test`, `남${i}`, "남성", "여성", 37100 + i * 10, `010-3702-${String(i).padStart(4, "0")}`))
  const [M1, M2, M3, M4, M5, M6, M7, M8, M9, M10, M11] = men
  // 지난 소개를 직접 만든다(오늘 정오 공개 → 어제 마감으로 끝난 것처럼). fields: 상태·끝난 까닭·서로 선택·응답·열람
  await as("postgres")
  const history = async (a, b, f) => {
    const id = (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at) values ($1, $2, $3, 'published', now() - interval '1 minute', now() + interval '1 hour', now() + interval '1 hour', $4, $4, now() - interval '1 minute') returning id", [a, b, reason, snap])).id
    await q(`update public.introductions set status = $2, end_reason = $3, closed_at = now(), view_until = now(), mutual_at = case when $4 then now() end,
               response_a = $5, response_b = $6, opened_a_at = case when $7 then now() end, opened_b_at = case when $8 then now() end where id = $1`,
      [id, f.status ?? "closed", f.end, !!f.mutual, f.ra ?? null, f.rb ?? null, !!f.oa, !!f.ob])
    return id
  }
  await history(W, M1, { end: "program-completed", mutual: true, ra: "positive", rb: "positive", oa: true, ob: true })
  await history(W, M2, { end: "admin-cancel", mutual: true, ra: "positive", rb: "positive", oa: true, ob: true })
  await history(W, M3, { end: "nonresponse", ra: "negative", oa: true })
  await history(W, M4, { end: "nonresponse", ob: true })
  await history(W, M5, { end: "admin-cancel", oa: true, ob: true })
  await history(W, M6, { end: "nonresponse", ra: "positive", oa: true })
  await history(W, M7, { status: "cancelled", end: "precheck" })
  const reported = await history(W, M8, { end: "admin-cancel", oa: true, ob: true })
  await q("insert into public.reports (source, reporter_id, target_id, introduction_id, type, description) values ('member', $1, $2, $3, '회원 신고', '불편한 말을 들었어요.')", [M8, W, reported])
  await history(W, M9, { end: "blocked", oa: true, ob: true })
  await q("insert into public.blocks (member_id, blocked_id) values ($1, $2)", [M9, W])

  // 두 사람 소개 기록: 운영(대표·운영)만
  await as(W)
  await fails("회원은 두 사람 소개 기록을 볼 수 없다", "select public.admin_pair_history($1)", [W], /운영 권한/)
  await as(C, "aal2")
  await fails("상담 역할은 두 사람 소개 기록을 볼 수 없다", "select public.admin_pair_history($1)", [W], /운영 권한/)
  await as("anon")
  await fails("비회원은 두 사람 소개 기록을 부를 수 없다", "select public.admin_pair_history($1)", [W])
  await as(O, "aal2")
  const pairs = new Map((await one("select public.admin_pair_history($1) h", [W])).h.map((row) => [row.other, row]))
  eq("소개 기록 · 서로 선택 후 교류 마무리는 다시 소개하지 않는다", [pairs.get(M1).reason, pairs.get(M1).mutual], ["mutual", true])
  eq("소개 기록 · 서로 선택 뒤 운영 취소여도 다시 소개하지 않는다", pairs.get(M2).reason, "mutual")
  eq("소개 기록 · 한 분이 넘긴 소개(상대 무응답)는 넘김으로", [pairs.get(M3).reason, pairs.get(M3).declined], ["declined", true])
  eq("소개 기록 · 열어 본 분이 답하지 않은 무응답은 다시 소개하지 않는다", pairs.get(M4).reason, "nonresponse")
  eq("소개 기록 · 운영 취소는 다시 소개할 수 있는 예외", [pairs.get(M5).reason, pairs.get(M5).exception], [null, "admin-cancel"])
  eq("소개 기록 · 답하지 않은 분이 열어 보지도 않은 무응답은 예외", [pairs.get(M6).reason, pairs.get(M6).exception], [null, "unopened"])
  eq("소개 기록 · 공개 직전 확인으로 취소된 소개는 예외", [pairs.get(M7).reason, pairs.get(M7).exception], [null, "precheck"])
  eq("소개 기록 · 신고 기록이 있으면 운영 취소여도 다시 소개하지 않는다", [pairs.get(M8).reason, pairs.get(M8).reported], ["reported", true])
  eq("소개 기록 · 차단 관계", [pairs.get(M9).reason, pairs.get(M9).blockedRelation], ["blocked", true])
  ok("소개 기록에 공개 날짜·상태·이름이 온다", pairs.get(M1).revealAt && pairs.get(M1).status === "closed" && pairs.get(M1).name === "남1" && pairs.get(M1).count === 1)
  ok("후보 목록의 이전 소개(previous)에 서로 선택 뒤 운영 취소된 분이 들어간다", (await q("select previous from public.admin_ready_members() where member_id = $1", [W]))[0].previous.includes(M2))

  // 서버가 다시 소개를 막는다(까닭과 함께)
  const reserve = (a, b, days, match = null) => one("select public.admin_reserve_introduction($1, $2, (public.kst_today() + $3::int), $4, $5::jsonb) id", [a, b, days, reason, match === null ? null : JSON.stringify(match)])
  const tries = "select public.admin_reserve_introduction($1, $2, (public.kst_today() + 3), '두 분 모두 쉬는 날 천천히 걷는 걸 좋아하셨어요.')"
  await fails("서로 선택하고 교류까지 마친 두 사람은 다시 소개하지 않는다", tries, [W, M1], /이미 소개.*서로 선택/)
  await fails("서로 선택 뒤 운영 취소된 두 사람도 다시 소개하지 않는다", tries, [M2, W], /서로 선택/)
  await fails("한 분이 넘긴 두 사람은 다시 소개하지 않는다", tries, [W, M3], /넘긴/)
  await fails("열어 본 분이 답하지 않은 두 사람은 다시 소개하지 않는다", tries, [W, M4], /답하지 않은/)
  await fails("신고 기록이 있는 두 사람은 다시 소개하지 않는다", tries, [W, M8], /신고 기록/)
  await fails("차단 관계는 여전히 막는다", tries, [W, M9], /차단 관계/)
  // 예외는 다시 소개할 수 있다(확인 뒤 예약을 취소해 다음 확인을 이어 간다)
  const again = async (label, man, days) => {
    const id = (await reserve(W, man, days)).id
    ok(label, !!id)
    await q("select public.admin_cancel_introduction($1, '시험 예약 정리')", [id])
  }
  await again("운영 취소로 끝난 두 사람은 다시 소개할 수 있다", M5, 3)
  await again("답하지 않은 분이 열어 보지도 않은 무응답은 다시 소개할 수 있다", M6, 4)
  await again("공개 직전 확인으로 취소된 두 사람은 다시 소개할 수 있다", M7, 5)

  // 회원에게 보일 궁합: 모양·길이 확인
  const good = { score: 86, headline: "  관계를 바라보는 속도가   닮은 두 분이에요. ", why: ["두 분 모두 천천히 알아가는 연애를 바라요.", "‘산책’과 ‘카페’를 두 분 모두 좋아해요."], together: ["함께 걷다 보면 대화가 자연스럽게 길어질 거예요."] }
  const bad = async (label, match, pattern) => fails(label, "select public.admin_reserve_introduction($1, $2, (public.kst_today() + 3), '두 분 모두 쉬는 날 천천히 걷는 걸 좋아하셨어요.', $3::jsonb)", [W2, M10, JSON.stringify(match)], pattern)
  await bad("궁합에 모르는 항목이 있으면 막는다", { ...good, partnerSecret: "x" }, /알 수 없는 항목/)
  await bad("궁합 점수는 0~100 정수만", { ...good, score: 150 }, /0~100/)
  await bad("궁합 점수는 숫자만", { ...good, score: "86" }, /숫자/)
  await bad("궁합 한 줄 요약은 80자까지", { ...good, headline: "가".repeat(81) }, /4~80자/)
  await bad("궁합 이유가 비면 막는다", { ...good, why: [] }, /1~3개/)
  await bad("궁합 이유는 글만", { ...good, together: [3] }, /글로/)
  await bad("궁합 이유는 하나에 140자까지", { ...good, why: ["나".repeat(141)] }, /4~140자/)
  await bad("궁합에 링크·연락처는 넣을 수 없다", { ...good, together: ["인스타 아이디는 beforeus_test 예요"] }, /연락처·링크/)
  await bad("궁합이 객체가 아니면 막는다", ["x"], /형식/)
  const withMatch = (await reserve(W2, M10, 3, good)).id
  await as("postgres")
  eq("궁합은 다듬어 저장한다(앞뒤·겹친 공백 정리, 형식 번호)", (await one("select match m from public.introductions where id = $1", [withMatch])).m, { version: 1, score: 86, headline: "관계를 바라보는 속도가 닮은 두 분이에요.", why: good.why, together: good.together })
  ok("궁합을 함께 보냈다고 감사 기록에 남긴다", (await one("select reason from public.audit_log where target = $1 order by id desc limit 1", [withMatch])).reason === "궁합 함께 보냄 · 86")
  await as(O, "aal2")
  eq("소개 기록에 저장된 궁합이 함께 온다", (await q("select match from public.admin_list_introductions() where id = $1", [withMatch]))[0].match.score, 86)
  // 공개 전에는 회원이 볼 수 없다
  for (const m of [W2, M10]) {
    await as(m)
    eq("정오 공개 전에는 소개도 궁합도 오지 않는다", (await one("select public.my_introduction() v")).v, { status: "waiting" })
    eq("회원은 소개 표에서 궁합을 직접 읽을 수 없다", (await q("select match from public.introductions")).length, 0)
  }
  // 정오 공개 뒤에는 두 분에게만
  await as("postgres")
  await q("update public.introductions set reveal_at = now() - interval '1 minute', respond_by = now() + interval '23 hours', view_until = now() + interval '23 hours' where id = $1", [withMatch])
  await one("select public.run_noon()")
  for (const m of [W2, M10]) {
    await as(m)
    const v = (await one("select public.my_introduction() v")).v
    eq("정오 공개 뒤 두 분 모두에게 궁합이 온다(65 이상은 점수도)", [v.id, v.match], [withMatch, { score: 86, headline: "관계를 바라보는 속도가 닮은 두 분이에요.", why: good.why, together: good.together }])
  }
  await as(W)
  const other = (await one("select public.my_introduction() v")).v
  ok("다른 회원의 소개 궁합은 오지 않는다", other.id !== withMatch && (other.match ?? null) === null)
  // 65 아래 점수는 숫자 없이(운영진은 그대로 본다)
  await as(O, "aal2")
  const low = (await reserve(W3, M11, 3, { ...good, score: 60 })).id
  await as("postgres")
  await q("update public.introductions set reveal_at = now() - interval '1 minute', respond_by = now() + interval '23 hours', view_until = now() + interval '23 hours' where id = $1", [low])
  await one("select public.run_noon()")
  await as(W3)
  const lowView = (await one("select public.my_introduction() v")).v.match
  eq("65 아래 점수는 회원에게 숫자 없이 이유만 보낸다", [lowView.score, lowView.why.length, lowView.together.length], [null, 2, 1])
  await as(O, "aal2")
  eq("운영진 소개 기록에는 65 아래 점수도 남는다", (await q("select match from public.admin_list_introductions() where id = $1", [low]))[0].match.score, 60)
  // 서로 선택한 뒤에도 보이고, 소개가 끝나면 더는 오지 않는다
  for (const m of [W2, M10]) { await as(m); await q("select public.record_introduction_view($1)", [withMatch]); await q("select public.respond_introduction($1, 'positive')", [withMatch]) }
  await as(M10)
  const mutualView = (await one("select public.my_introduction() v")).v
  eq("서로 선택한 뒤에도 궁합이 보인다", [mutualView.status, mutualView.match?.score], ["mutual", 86])
  await as(O, "aal2")
  await q("select public.admin_cancel_introduction($1, '시험 정리')", [withMatch])
  await as(M10)
  eq("끝난 소개에는 궁합이 오지 않는다", (await one("select public.my_introduction() v")).v.match, null)
  await as(O, "aal2")
  await fails("서로 선택했던 두 사람은 운영 취소 뒤에도 다시 소개하지 않는다", tries, [W2, M10], /서로 선택/)
  // 궁합 없이도 예약할 수 있다(예전 방식 그대로) · 이 점검에서 연 소개는 모두 정리한다
  await q("select public.admin_cancel_introduction($1, '시험 정리')", [low])
  const plain = (await one("select public.admin_reserve_introduction($1, $2, (public.kst_today() + 6), '두 분 모두 쉬는 날 천천히 걷는 걸 좋아하셨어요.') id", [W, M5])).id
  await as("postgres")
  eq("궁합 없이 예약하면 궁합 칸은 비어 있다", (await one("select match m from public.introductions where id = $1", [plain])).m, null)
  await as(O, "aal2")
  await q("select public.admin_cancel_introduction($1, '시험 예약 정리')", [plain])
  await as("postgres")
}

// ── 결제(3800): 테스트 모드 · 금액은 서버가 정함(config.ts와 같음) · 자격 · 중복 · 회원끼리 못 봄 · 결과 기록은 service_role만 · 운영진 목록·취소 권한
{
  await as("postgres")
  await clock(null)
  const configText = readFileSync(join(here, "..", "..", "src", "app", "config.ts"), "utf8")
  const priceOf = (name) => Number(configText.match(new RegExp(`pricing: \\{[^}]*\\b${name}: (\\d+)`))[1])
  const cfg = (await one("select public.payment_config() c")).c
  eq("결제: 서버 금액이 화면 설정(config.ts)과 같다", [cfg.introduction, cfg.exchange], [priceOf("introduction"), priceOf("exchangePerPerson")])
  eq("결제: 서버 결제 모드가 화면 설정과 같다(지금은 테스트)", [cfg.mode, cfg.provider], [configText.match(/payments: \{[^}]*mode: "(test|live)"/)[1], "toss"])
  // 서비스 이름(마이그레이션 4200): 결제 상품명은 화면 설정의 이름을 쓰고, 옛 이름이 남은 서버 함수가 없다.
  const brandName = configText.match(/brand: \{ name: "([^"]+)"/)[1]
  eq("이름: 결제 상품명이 화면 설정의 서비스 이름과 같다", [cfg.introductionName, cfg.exchangeName], [`${brandName} 소개비`, `${brandName} 교류비`])
  eq("이름: 옛 이름(비포어스)이 남은 서버 함수가 없다", (await one("select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosrc like '%비포어스%'")).n, 0)
  const asService = async () => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claims', '', false)"); await db.exec("set role service_role") }
  const payFresh = async (email, name, gender, desired, base, phone, approve = true) => {
    await as("postgres")
    const id = await signup(email)
    await as(id)
    const d = draft(name, gender, desired, "1995-06-06")
    await q("select public.save_application_draft($1)", [{ ...d, values: { ...d.values, "self.phone": phone } }])
    await photos(id, base)
    await q("select public.submit_application()")
    if (approve) {
      await as(O, "aal2")
      for (const slot of ["photo.face", "photo.upper", "photo.style"]) await q("select public.admin_review_photo($1, $2, '기준 확인')", [id, slot])
      await q("select public.admin_decide_application($1, 'approved')", [id])
      await q("select public.admin_move_member_cohort($1, 1)", [id])
    }
    return id
  }
  const PA = await payFresh("pay-a@example.test", "서하", "여성", "남성", 3801, "010-3801-0001")
  const PB = await payFresh("pay-b@example.test", "이안", "남성", "여성", 3811, "010-3801-0002")
  const PC = await payFresh("pay-c@example.test", "로운", "남성", "여성", 3821, "010-3801-0003", false)

  // 주문 만들기: 금액은 서버가 · 자격 확인
  await as("anon")
  await fails("결제: 비회원은 주문을 만들 수 없다", "select public.create_payment_order('introduction')")
  await as(PC)
  await fails("결제: 신청서 승인 전에는 소개비 주문을 만들 수 없다", "select public.create_payment_order('introduction')", [], /승인된 뒤/)
  await as(PA)
  await fails("결제: 모르는 결제 종류는 막힌다", "select public.create_payment_order('gift')", [], /결제 종류/)
  await fails("결제: 소개비에는 교류를 붙일 수 없다", "select public.create_payment_order('introduction', gen_random_uuid())", [], /교류를 고르지/)
  await fails("결제: 교류 없이 교류비 주문은 만들 수 없다", "select public.create_payment_order('exchange')", [], /교류를 찾을 수 없어요/)
  const o1 = (await one("select public.create_payment_order('introduction') o")).o
  eq("결제: 소개비 금액은 서버가 정한다", o1.amount, priceOf("introduction"))
  ok("결제: 테스트 주문은 이름에 [테스트]가 붙고 모드가 test", o1.orderName.startsWith("[테스트]") && o1.mode === "test" && o1.provider === "toss" && o1.kind === "introduction")
  ok("결제: 주문 번호·구매자 키가 토스 규칙에 맞다", /^[A-Za-z0-9_=-]{6,64}$/.test(o1.orderId) && /^[A-Za-z0-9_=.@-]{10,50}$/.test(o1.customerKey) && /[-_=.@]/.test(o1.customerKey))
  const o1b = (await one("select public.create_payment_order('introduction') o")).o
  ok("결제: 주문마다 번호는 새로, 구매자 키는 회원마다 같다", o1b.orderId !== o1.orderId && o1b.customerKey === o1.customerKey)
  eq("결제: 회원은 자기 주문을 본다(결제 전)", (await q("select status, amount from public.payments where order_id = $1", [o1.orderId])).map((r) => [r.status, r.amount]), [["ready", priceOf("introduction")]])
  await fails("결제: 회원은 결제 표를 직접 고칠 수 없다", "update public.payments set status = 'paid' where order_id = $1", [o1.orderId])
  await fails("결제: 회원은 결제 기록을 직접 넣을 수 없다", "insert into public.payments (member_id, kind, order_id, amount, order_name, provider, mode, status) values ($1, 'introduction', 'BUI-fake-0001', 10, 'x', 'toss', 'test', 'paid')", [PA])
  await fails("결제: 회원은 구매자 키 표를 볼 수 없다", "select * from public.payment_customers")
  await fails("결제: 회원은 결과 기록 함수를 부를 수 없다", "select public.record_payment_result($1, 'paid', 'tpk_x')", [o1.orderId])
  await as("anon")
  await fails("결제: 비회원도 결과 기록 함수를 부를 수 없다", "select public.record_payment_result($1, 'paid', 'tpk_x')", [o1.orderId])

  // 회원끼리는 서로의 결제를 보거나 바꿀 수 없다
  await as(PB)
  eq("결제: 다른 회원의 결제는 보이지 않는다", (await q("select id from public.payments where order_id = $1", [o1.orderId])).length, 0)
  await fails("결제: 다른 회원의 주문은 승인 확인 함수로도 볼 수 없다", "select public.my_payment_order($1)", [o1.orderId], /주문을 찾을 수 없어요/)
  await q("select public.mark_payment_failed($1, 'X', 'y')", [o1.orderId])
  await as("postgres")
  eq("결제: 남의 주문은 실패로 바꿀 수 없다", (await one("select status from public.payments where order_id = $1", [o1.orderId])).status, "ready")

  // 승인(edge function 흐름): 회원 토큰으로 확인 → service_role 로 기록 · 다시 보내도 한 번만
  await as(PA)
  const check1 = (await one("select public.my_payment_order($1) v", [o1.orderId])).v
  eq("결제: 승인 전 확인은 서버 금액·자격·중복을 알려 준다", [check1.amount, check1.eligible, check1.duplicate, check1.status], [priceOf("introduction"), true, false, "ready"])
  await asService()
  const paid1 = (await one("select public.record_payment_result($1, 'paid', 'tpk_test_0001', '카드', now(), null, null, $2) v", [o1.orderId, { confirm: { status: "DONE", card: { cardType: "신용" } } }])).v
  eq("결제: service_role 은 승인 결과를 남긴다", [paid1.status, paid1.method, !!paid1.approvedAt], ["paid", "카드", true])
  eq("결제: 같은 승인 결과를 다시 보내도 그대로다", (await one("select public.record_payment_result($1, 'paid', 'tpk_test_0001') v", [o1.orderId])).v.status, "paid")
  await fails("결제: 다른 결제 키로 같은 주문을 다시 완료할 수 없다", "select public.record_payment_result($1, 'paid', 'tpk_other')", [o1.orderId], /이미 다른 결제/)
  eq("결제: 완료된 결제는 실패로 되돌리지 않는다", (await one("select public.record_payment_result($1, 'failed', null, null, null, 'X', 'y') v", [o1.orderId])).v.status, "paid")
  await as(PA)
  await fails("결제: 이미 낸 소개비는 다시 주문할 수 없다", "select public.create_payment_order('introduction')", [], /이미 결제했어요/)
  eq("결제: 다른 주문으로 같은 항목을 승인하려 하면 중복으로 알린다", (await one("select public.my_payment_order($1) v", [o1b.orderId])).v.duplicate, true)
  await asService()
  await fails("결제: 같은 항목의 두 번째 결제 완료는 서버가 막는다", "select public.record_payment_result($1, 'paid', 'tpk_test_0002')", [o1b.orderId], /중복 결제/)
  const auto = (await one("select public.record_payment_result($1, 'cancelled', 'tpk_test_0002', null, null, null, '중복 결제 자동 취소') v", [o1b.orderId])).v
  eq("결제: 중복으로 바로 취소한 결제는 취소로 남는다", [auto.status, auto.cancelReason], ["cancelled", "중복 결제 자동 취소"])

  // 교류비: 서로 선택한 뒤 시작 전 교류의 두 사람만 · 각자 한 번
  await as(O, "aal2")
  const payIntro = (await one("select public.admin_reserve_introduction($1, $2, (public.kst_today() + 3), '두 분 모두 산책을 좋아하셨어요.') id", [PA, PB])).id
  await as("postgres")
  await q("update public.introductions set reveal_at = now() - interval '1 minute', respond_by = now() + interval '23 hours', view_until = now() + interval '23 hours' where id = $1", [payIntro])
  await one("select public.run_noon() r")
  for (const m of [PA, PB]) { await as(m); await q("select public.record_introduction_view($1)", [payIntro]); await q("select public.respond_introduction($1, 'positive')", [payIntro]) }
  await as(PA)
  const prog = (await one("select public.my_program() v")).v
  eq("결제: 서로 선택하면 시작 전 교류가 생긴다", prog.status, "choosing")
  const oe = (await one("select public.create_payment_order('exchange', $1) o", [prog.id])).o
  eq("결제: 교류비 금액은 서버가 정한다(한 분당)", [oe.amount, oe.programId, oe.kind], [priceOf("exchangePerPerson"), prog.id, "exchange"])
  await as(PC)
  await fails("결제: 남의 교류에는 교류비 주문을 만들 수 없다", "select public.create_payment_order('exchange', $1)", [prog.id], /교류를 찾을 수 없어요/)
  await as(PA)
  await q("select public.mark_payment_failed($1, 'PAY_PROCESS_ABORTED', '결제가 진행되지 않았어요')", [oe.orderId])
  eq("결제: 결제창 실패는 결제 전 주문을 ‘결제 안 됨’으로 남긴다", { ...(await one("select status, failure_code from public.payments where order_id = $1", [oe.orderId])) }, { status: "failed", failure_code: "PAY_PROCESS_ABORTED" })
  const oe2 = (await one("select public.create_payment_order('exchange', $1) o", [prog.id])).o
  await as(PB)
  const ob = (await one("select public.create_payment_order('exchange', $1) o", [prog.id])).o
  await asService()
  await q("select public.record_payment_result($1, 'paid', 'tpk_test_0003', '간편결제')", [oe2.orderId])
  await as(PA)
  await fails("결제: 이 교류의 교류비를 이미 냈으면 다시 주문할 수 없다", "select public.create_payment_order('exchange', $1)", [prog.id], /이미 결제했어요/)
  eq("결제: 결제해도 교류 상태는 그대로다(베타 흐름과 무관)", (await one("select public.my_program() v")).v.status, "choosing")
  await as(PB)
  eq("결제: 상대가 냈어도 내 교류비는 따로다", (await one("select public.my_payment_order($1) v", [ob.orderId])).v.duplicate, false)

  // 운영진: 목록(대표·운영·정산 + 2단계 인증) · 테스트 결제 취소(대표·운영)
  await as(PA)
  await fails("결제: 회원은 결제 목록을 볼 수 없다", "select public.admin_list_payments()", [], /대표·운영·정산/)
  await fails("결제: 회원은 결제를 취소할 수 없다", "select public.admin_begin_payment_cancel($1, '점검')", [paid1.id], /운영 권한/)
  await as(O)
  await fails("결제: 2단계 인증 전에는 대표도 결제 목록을 볼 수 없다", "select public.admin_list_payments()", [], /대표·운영·정산/)
  await as(O, "aal2")
  const listed = (await one("select public.admin_list_payments() v")).v
  ok("결제: 운영진 목록에 회원 이메일·이름·모드가 보이고 결제 전 주문은 빠진다", listed.some((r) => r.orderId === o1.orderId && r.email === "pay-a@example.test" && r.name === "서하" && r.mode === "test" && r.status === "paid") && !listed.some((r) => r.status === "ready"))
  ok("결제: 상태로 거를 수 있다(결제 전만)", (await one("select public.admin_list_payments('ready') v")).v.every((r) => r.status === "ready"))
  await as("postgres")
  const F = await signup("finance@example.test")
  await q("insert into public.admin_roles (user_id, role) values ($1, 'finance')", [F])
  await as(F, "aal2")
  ok("결제: 정산 역할은 결제 목록을 볼 수 있다", (await one("select public.admin_list_payments() v")).v.length > 0)
  await fails("결제: 정산 역할은 테스트 결제를 취소할 수 없다", "select public.admin_begin_payment_cancel($1, '점검')", [paid1.id], /운영 권한/)
  await as(O, "aal2")
  await fails("결제: 취소 이유가 없으면 막힌다", "select public.admin_begin_payment_cancel($1, ' ')", [paid1.id], /이유/)
  const failedRow = (await one("select public.admin_list_payments('failed') v")).v.find((r) => r.orderId === oe.orderId)
  await fails("결제: 결제 완료가 아닌 것은 취소할 수 없다", "select public.admin_begin_payment_cancel($1, '점검')", [failedRow.id], /결제 완료된 것만/)
  const begin = (await one("select public.admin_begin_payment_cancel($1, '결제 흐름 점검') v", [paid1.id])).v
  eq("결제: 취소 시작은 PG 취소에 필요한 값을 돌려준다", [begin.orderId, begin.paymentKey, begin.mode, begin.reason], [o1.orderId, "tpk_test_0001", "test", "결제 흐름 점검"])
  await as("postgres")
  eq("결제: 취소 요청은 감사 기록에 남는다(한 운영진)", (await one("select count(*)::int n from public.audit_log where action = '테스트 결제 취소 요청' and target = $1 and actor_id = $2", [o1.orderId, O])).n, 1)
  await asService()
  const cancelled = (await one("select public.record_payment_result($1, 'cancelled', null, null, now(), null, '결제 흐름 점검') v", [o1.orderId])).v
  eq("결제: 취소 결과가 남는다", [cancelled.status, cancelled.cancelReason, !!cancelled.cancelledAt], ["cancelled", "결제 흐름 점검", true])
  await fails("결제: 취소된 주문은 다시 완료로 바꿀 수 없다", "select public.record_payment_result($1, 'paid', 'tpk_test_0001')", [o1.orderId], /취소된 주문/)
  await as(PA)
  ok("결제: 테스트 결제를 취소하면 소개비를 다시 시험할 수 있다", !!(await one("select public.create_payment_order('introduction') o")).o.orderId)
  await as("postgres")
  const liveId = (await one("insert into public.payments (member_id, kind, order_id, amount, order_name, provider, mode, status, payment_key) values ($1, 'introduction', 'BUI-live-check-0001', 10000, '비포어스 소개비', 'toss', 'live', 'paid', 'tpk_live_0001') returning id", [PC])).id
  await as(O, "aal2")
  await fails("결제: 실결제는 여기서 취소하지 않는다(환불 기준으로 따로)", "select public.admin_begin_payment_cancel($1, '점검')", [liveId], /테스트 결제만/)
  eq("결제: 모드로 거를 수 있다(실결제만)", (await one("select public.admin_list_payments(null, 'live') v")).v.map((r) => r.orderId), ["BUI-live-check-0001"])

  // 교류가 시작 전이 아니면 교류비는 승인 대상이 아니다(운영진이 교류를 닫은 경우)
  await q("select public.admin_close_program($1, '결제 점검 정리')", [prog.id])
  await as(PB)
  eq("결제: 교류가 끝나면 남은 교류비 주문은 승인하지 않는다", (await one("select public.my_payment_order($1) v", [ob.orderId])).v.eligible, false)
  await fails("결제: 시작 전이 아닌 교류에는 교류비 주문을 만들 수 없다", "select public.create_payment_order('exchange', $1)", [prog.id], /시작하기 전에만/)
  await as("postgres")
}

// ── 3일 교류 다듬기 4(3600): A 편지 사진 한 장 · B 직접 작성 · 한마디 · 내가 고른 첫 장면에 대해 · 편지 사진 정리
{
  await as("postgres")
  await clock(null)
  const at = async (date, time) => clock((await one("select public.kst_at($1::date, $2::time)::text t", [date, time])).t)
  const plus = async (date, days) => (await one("select ($1::date + $2::int)::text d", [date, days])).d
  const today = (await one("select public.kst_today()::text d")).d
  const pairUp = async (a, b, sql, extra = []) => {
    const intro = (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at, mutual_at) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'mutual', now() - interval '1 day', now() + interval '1 hour', 'infinity', $3, $3, now() - interval '1 day', now()) returning id", [a, b, snap])).id
    return { intro, id: (await one(sql, [intro, a, b, ...extra])).id }
  }
  const notes = async (key) => { await as("postgres"); return (await one("select count(*)::int n from public.notifications where dedupe_key like $1", [key])).n }
  const seen = async (who, name) => { await as(who); return (await q("select name from storage.objects where bucket_id = 'letter-photos' and name = $1", [name])).length }
  // 상대의 사진은 저장소에서 직접 보지 못하고(4100), letter-photo 함수가 이 확인을 거쳐 5분짜리 주소를 만든다.
  const canView = async (who, name) => { await as(who); return (await one("select public.can_view_letter_photo($1) v", [name])).v }
  const upload = async (who, name) => { await as(who); await q("insert into storage.objects (bucket_id, name) values ('letter-photos', $1)", [name]) }
  const uploadFails = (label, who, name) => as(who).then(() => fails(label, "insert into storage.objects (bucket_id, name) values ('letter-photos', $1)", [name]))
  const find = (v, day, kind) => v.entries.find((e) => e.day === day && e.kind === kind)
  const startedSql = (plan) => `insert into public.programs (introduction_id, member_a, member_b, status, plan_a, plan_b, start_on, agree_by, started_at) values ($1, $2, $3, 'started', '${plan}', '${plan}', $4::date, now(), now()) returning id`

  // A: 편지 사진 한 장 — 올리기·보내기·보기(함께 열린 뒤에만)·지우기·하루 12장
  const L1 = await signup("l1-3600@example.test"), L2 = await signup("l2-3600@example.test"), L3 = await signup("l3-3600@example.test")
  await as("postgres")
  const startL = await plus(today, -1)
  const { id: letters } = await pairUp(L1, L2, startedSql("A"), [startL])
  await at(startL, "10:00")
  const photo1 = `${letters}/${L1}/day1-a1b2c3d4.jpg`
  await upload(L1, photo1)
  eq("편지 사진: 진행 중인 A 교류의 내 폴더에 올릴 수 있다", await seen(L1, photo1), 1)
  await uploadFails("편지 사진: 상대 폴더에는 올릴 수 없다", L1, `${letters}/${L2}/day1-a1b2c3d4.jpg`)
  await uploadFails("편지 사진: JPG 이름 규칙이 아니면 올릴 수 없다", L1, `${letters}/${L1}/day1-a1b2c3d4.png`)
  await uploadFails("편지 사진: 내 교류가 아니면 올릴 수 없다", L3, `${letters}/${L3}/day1-a1b2c3d4.jpg`)
  const letterBody = "쉬는 날엔 동네 도서관 창가 자리에서 책을 읽어요. 해가 지면 집에 와요."
  const letterFails = (label, payload, pattern) => as(L1).then(() => fails(label, "select public.submit_program_entry($1, 1, 'letter', $2, $3)", [letters, letterBody, JSON.stringify(payload)], pattern))
  await letterFails("편지 사진: 상대 폴더의 사진 경로로는 보낼 수 없다", { photo: `${letters}/${L2}/day1-zzzz9999.jpg` }, /사진을 다시/)
  await letterFails("편지 사진: 다른 날 칸의 사진으로는 보낼 수 없다", { photo: `${letters}/${L1}/day2-a1b2c3d4.jpg` }, /사진을 다시/)
  await letterFails("편지 사진: 올리지 않은 사진은 보낼 수 없다", { photo: `${letters}/${L1}/day1-nothere1.jpg` }, /올라가지 않았어요/)
  await as(L1)
  const sentL = (await one("select public.submit_program_entry($1, 1, 'letter', $2, $3) v", [letters, letterBody, JSON.stringify({ photo: photo1, hint: "예시 문장" })])).v
  eq("편지 사진: 편지에는 본문과 사진 경로만 저장된다", find(sentL, 1, "letter").own.payload, { photo: photo1 })
  eq("편지 사진: 함께 열리기 전에는 상대가 볼 수 없다", [await seen(L2, photo1), await canView(L2, photo1)], [0, false])
  eq("편지 사진: 다른 회원은 볼 수 없다", await seen(L3, photo1), 0)
  await as(L1)
  await q("delete from storage.objects where bucket_id = 'letter-photos' and name = $1", [photo1])
  eq("편지 사진: 보낸 편지의 사진은 지울 수 없다(편지처럼 고칠 수 없다)", await seen(L1, photo1), 1)
  await as(L2)
  const openedL = (await one("select public.submit_program_entry($1, 1, 'letter', '토요일 아침마다 친구들과 배드민턴을 치고 국밥을 먹어요.') v", [letters])).v
  eq("편지 사진: 함께 열리면 상대에게 사진 경로가 보인다", find(openedL, 1, "letter").partner.payload, { photo: photo1 })
  eq("편지 사진: 사진 없이 보낸 편지는 본문만", find(openedL, 1, "letter").own.payload, null)
  eq("편지 사진: 함께 열린 뒤에는 상대가 볼 수 있다(함수 확인)", await canView(L2, photo1), true)
  eq("편지 사진: 상대도 저장소에서 직접 꺼내 보지는 못한다(5분 주소로만)", await seen(L2, photo1), 0)
  eq("편지 사진: 쓴 사람은 저장소에서 직접 볼 수 있다", await seen(L1, photo1), 1)
  eq("편지 사진: 다른 회원은 여전히 볼 수 없다", [await seen(L3, photo1), await canView(L3, photo1)], [0, false])
  await at(await plus(startL, 1), "08:30")
  await as(L1)
  eq("편지 사진: 답장에는 사진을 붙이지 않는다", find((await one("select public.submit_program_entry($1, 1, 'reply', '배드민턴 끝나고 먹는 국밥, 상상만 해도 좋아요.', $2) v", [letters, JSON.stringify({ photo: photo1 })])).v, 1, "reply").own.payload, null)
  await at(await plus(startL, 1), "10:00")
  const draftPhoto = `${letters}/${L1}/day2-e5f6a7b8.jpg`
  await upload(L1, draftPhoto)
  await as(L1)
  await q("delete from storage.objects where bucket_id = 'letter-photos' and name = $1", [draftPhoto])
  eq("편지 사진: 보내기 전 사진은 뺄 수 있다(바로 지워진다)", await seen(L1, draftPhoto), 0)
  await as("postgres")
  const have = (await one("select count(*)::int n from storage.objects where bucket_id = 'letter-photos' and split_part(name, '/', 2) = $1", [L1])).n
  for (let i = have; i < 12; i++) await upload(L1, `${letters}/${L1}/day2-quota${String(i).padStart(3, "0")}.jpg`)
  await uploadFails("편지 사진: 하루 12장까지 올릴 수 있다", L1, `${letters}/${L1}/day2-quota999.jpg`)
  // 마무리 뒤 다시 읽기 기간 · 차단
  await as("postgres")
  await q("update public.programs set status = 'closed', closed_at = now(), end_reason = 'completed', meeting_a = 'positive', meeting_b = 'positive' where id = $1", [letters])
  eq("편지 사진: 다시 읽을 수 있는 마무리 교류에서는 상대가 계속 볼 수 있다", await canView(L2, photo1), true)
  // 쓴 사람이 탈퇴를 요청하면 상대에게 바로 닫힌다(다시 읽기도 함께). 쓴 사람 본인은 그대로.
  await as("postgres"); await q("update public.profiles set status = 'withdrawal_requested' where id = $1", [L1])
  eq("편지 사진: 쓴 사람이 탈퇴를 요청하면 상대는 바로 볼 수 없다", await canView(L2, photo1), false)
  await as(L2)
  eq("다시 읽기: 상대가 탈퇴를 요청하면 지난 교류 목록에서 바로 빠진다", ((await one("select public.my_readable_programs() v")).v ?? []).some((p) => p.id === letters), false)
  eq("편지 사진: 탈퇴를 요청한 쓴 사람도 내 사진 확인은 그대로", await canView(L1, photo1), true)
  await as("postgres"); await q("update public.profiles set status = 'suspended' where id = $1", [L1])
  eq("편지 사진: 쓴 사람이 이용 정지돼도 상대는 볼 수 없다", await canView(L2, photo1), false)
  await as("postgres"); await q("update public.profiles set status = 'active' where id = $1", [L1])
  eq("편지 사진: 다시 이용 중이 되면 다시 읽기 기간 안에서 볼 수 있다", await canView(L2, photo1), true)
  await as(L2)
  eq("다시 읽기: 상대가 이용 중이면 지난 교류 목록에 있다", (await one("select public.my_readable_programs() v")).v.some((p) => p.id === letters), true)
  await uploadFails("편지 사진: 마무리된 교류에는 올릴 수 없다", L2, `${letters}/${L2}/day3-late0001.jpg`)
  await as(L2); await q("select public.block_member($1)", [L1])
  eq("편지 사진: 차단 관계가 생기면 상대는 더 볼 수 없다", await canView(L2, photo1), false)
  eq("편지 사진: 쓴 사람은 차단 뒤에도 내 사진을 볼 수 있다", await seen(L1, photo1), 1)
  // 신고로 남겨 둔 교류의 사진은 글과 함께 남는다
  await as("postgres")
  const M1 = await signup("m1-3600@example.test"), M2 = await signup("m2-3600@example.test")
  const held = await pairUp(M1, M2, "insert into public.programs (introduction_id, member_a, member_b, status, plan_a, plan_b, start_on, agree_by, started_at, closed_at, end_reason) values ($1, $2, $3, 'closed', 'A', 'A', $4::date, now(), now(), now() - interval '31 days', 'blocked') returning id", [startL])
  const heldPhoto = `${held.id}/${M1}/day1-held0001.jpg`
  await q("insert into storage.objects (bucket_id, name, created_at) values ('letter-photos', $1, now() - interval '40 days')", [heldPhoto])
  await q("insert into public.program_entries (program_id, day, kind, author, body, payload) values ($1, 1, 'letter', $2, '신고된 교류에 남은 편지예요. 사진이 함께 있어요.', $3)", [held.id, M1, JSON.stringify({ photo: heldPhoto })])
  await q("insert into public.reports (source, reporter_id, target_id, introduction_id, type, description) values ('member', $1, $2, $3, '불편한 사진', '편지에 불편한 사진이 있었어요.')", [M2, M1, held.intro])
  // 보존 기간(마무리 후 30일)이 지나면 글과 함께 사진도 정리 대기열로
  await q("update public.programs set closed_at = now() - interval '31 days' where id = $1", [letters])
  await q("update storage.objects set created_at = now() - interval '3 days' where bucket_id = 'letter-photos' and name like $1", [`${letters}/%`])
  const swept = (await one("select public.run_program_retention() r")).r
  eq("편지 사진: 보존 기간이 지나면 교류 글이 지워진다", (await one("select count(*)::int n from public.program_entries where program_id = $1", [letters])).n, 0)
  eq("편지 사진: 보낸 사진·보내지 않은 사진 모두 정리 대기열로 간다", (await one("select count(*)::int n from public.storage_cleanup where bucket = 'letter-photos' and path like $1", [`${letters}/%`])).n, 12)
  ok("편지 사진: 정리 결과에 편지 사진 수가 남는다", swept.letterPhotos >= 12)
  eq("편지 사진: 신고로 남겨 둔 교류의 사진은 정리하지 않는다", (await one("select count(*)::int n from public.storage_cleanup where path = $1", [heldPhoto])).n, 0)
  await as(M2)
  eq("편지 사진: 신고로 남겨 둔 마무리 교류라도 상대에게는 보이지 않는다", [(await q("select name from storage.objects where bucket_id = 'letter-photos' and name = $1", [heldPhoto])).length, await canView(M2, heldPhoto)], [0, false])

  // B: 직접 작성 · 한마디(바로 보임) · 내가 고른 첫 장면에 대해(함께 열림)
  await as("postgres")
  await clock(null)
  const S1 = await signup("s1-3600@example.test"), S2 = await signup("s2-3600@example.test")
  const startS = today
  const { id: scenes } = await pairUp(S1, S2, startedSql("B"), [startS])
  const scene = async (who, day, payload, body = null) => { await as(who); return (await one("select public.submit_program_entry($1, $2, 'scene', $3, $4) v", [scenes, day, body, JSON.stringify(payload)])).v }
  const sceneFails = (label, who, day, payload, pattern) => as(who).then(() => fails(label, "select public.submit_program_entry($1, $2, 'scene', null, $3)", [scenes, day, JSON.stringify(payload)], pattern))
  const comment = async (who, on, day, body) => { await as(who); return (await one("select public.leave_scene_comment($1, $2, $3, $4) v", [scenes, on, day, body])).v }
  const commentFails = (label, who, on, day, body, pattern) => as(who).then(() => fails(label, "select public.leave_scene_comment($1, $2, $3, $4)", [scenes, on, day, body], pattern))
  await at(startS, "10:00")
  await sceneFails("B 직접 작성: 20자를 넘는 장소는 받지 않는다", S1, 1, { activity: "custom:" + "가".repeat(21), about: "주말엔 오래 걸어요." }, /20자/)
  await sceneFails("B 직접 작성: 비어 있는 직접 작성은 받지 않는다", S1, 1, { activity: "custom:", about: "주말엔 오래 걸어요." }, /분위기/)
  await sceneFails("B 직접 작성: 직접 쓴 말에도 연락처·SNS 아이디는 넣을 수 없다", S1, 1, { activity: "custom:@sky.walk 팔로우", about: "주말엔 오래 걸어요." }, /연락처/)
  await sceneFails("B 직접 작성: 표시 없는 목록 밖 장소는 여전히 받지 않는다", S1, 1, { activity: "보드게임 카페", about: "주말엔 오래 걸어요." }, /분위기/)
  const s1d1 = await scene(S1, 1, { activity: "custom:보드게임 카페", about: "주말엔 보드게임을 자주 해요." }, "같이 웃을 일이 많을 것 같아서요.")
  eq("B 직접 작성: 직접 쓴 장소가 그대로 저장된다", find(s1d1, 1, "scene").own.payload.activity, "custom:보드게임 카페")
  await commentFails("B 한마디: 그날 답이 함께 열리기 전에는 남길 수 없다", S1, "scene", 1, "좋아요", /열린 뒤/)
  await scene(S2, 1, { activity: "park", about: "주말엔 한강에서 자전거를 타요." })
  ok("B 한마디: 남기면 바로 보인다고 알려 준다", (await comment(S1, "scene", 1, "공원 피크닉이라니, 날 좋은 날이 기다려져요.")).notice.includes("바로"))
  await as(S2)
  const s2view = await mine()
  eq("B 한마디: 상대의 한마디는 내가 남기기 전에도 바로 보인다", [find(s2view, 1, "comment").partner.body, find(s2view, 1, "comment").own], ["공원 피크닉이라니, 날 좋은 날이 기다려져요.", null])
  await as("postgres")
  eq("B 한마디: 상대에게 사이트 알림이 간다(메일 아님)", (await one("select count(*)::int n from public.notifications where dedupe_key = $1 and member_id = $2 and public.email_class(kind) = 'site'", [`comment:${scenes}:comment:1:${S1}`, S2])).n, 1)
  await commentFails("B 한마디: 한 번만 남길 수 있다", S1, "scene", 1, "한 번 더 남겨요", /한 번만/)
  await commentFails("B 한마디: 100자 안으로", S2, "scene", 1, "가".repeat(101), /100자/)
  await commentFails("B 한마디: 연락처는 남길 수 없다", S2, "scene", 1, "카톡 아이디 sky_walk 로 연락 주세요", /연락처/)
  await commentFails("B 한마디: 아직 열리지 않은 날에는 남길 수 없다", S2, "scene", 2, "좋아요", /열린 뒤/)
  await as(L3)
  await fails("B 한마디: 교류 당사자가 아니면 남길 수 없다", "select public.leave_scene_comment($1, 'scene', 1, '안녕하세요')", [scenes], /찾을 수 없어요/)
  await at(await plus(startS, 1), "09:00")
  await commentFails("B 한마디: 그날 답에는 다음 날 09:00까지", S2, "scene", 1, "좋아요", /09:00/)
  // 둘째 날: 한마디를 남긴 S1은 reaction 없이, 남기지 않은 S2는 reaction이 필요하다. 직접 쓴 곳은 공통 목록·직접 작성에서 고른다.
  await at(await plus(startS, 1), "10:00")
  await sceneFails("B 직접 작성: 첫날 고른 곳이 있으면 다른 곳을 직접 쓸 수 없다", S1, 2, { place: "custom:다른 곳", flow: "천천히 머물기", rest: "조용한 카페", about: "처음엔 같이 뭔가 하면 편해져요." }, /첫날 고른 곳/)
  await sceneFails("B 직접 작성: 머무는 방식도 20자 안으로", S1, 2, { place: "custom:보드게임 카페", flow: "custom:" + "가".repeat(21), rest: "조용한 카페", about: "처음엔 같이 뭔가 하면 편해져요." }, /20자/)
  const s1d2 = await scene(S1, 2, { place: "custom:보드게임 카페", flow: "custom:보드게임 하나 같이 하기", rest: "조용한 카페", about: "처음엔 같이 뭔가 하면 편해져요." })
  eq("B 한마디: 전날 한마디를 남겼다면 다음 날 답에서 한마디를 다시 묻지 않는다", "reaction" in find(s1d2, 2, "scene").own.payload, false)
  await sceneFails("B 한마디: 한마디를 남기지 않았다면 전날 선택에 한마디가 여전히 필요하다", S2, 2, { place: "custom:보드게임 카페", flow: "천천히 머물기", rest: "custom:창가 자리", about: "처음엔 조용한 편이에요." }, /한마디/)
  const s2d2 = find(await scene(S2, 2, { place: "custom:보드게임 카페", flow: "천천히 머물기", rest: "custom:창가 자리", reaction: "보드게임 카페 좋아요.", about: "처음엔 조용한 편이에요." }), 2, "scene")
  eq("B 직접 작성: 상대가 직접 쓴 곳을 기준으로 공통 목록·직접 작성에서 고를 수 있다", [s2d2.own.payload.place, s2d2.own.payload.rest, s2d2.partner.payload.flow], ["custom:보드게임 카페", "custom:창가 자리", "custom:보드게임 하나 같이 하기"])
  await at(await plus(startS, 2), "10:00")
  await scene(S1, 3, { topic: "요즘 빠진 보드게임 이야기", reaction: "창가 자리 좋아요.", about: "느긋한 편이에요." })
  await scene(S2, 3, { topic: "최근에 다녀온 곳", reaction: "보드게임 하나 같이 해요.", about: "궁금한 건 바로 물어봐요." })
  // 첫 장면: 직접 쓴 것도 고를 수 있다(두 분이 쓴 것 중에서만)
  const pickS = { activity: "custom:보드게임 카페", flow: "custom:보드게임 하나 같이 하기", rest: "custom:창가 자리", topic: "최근에 다녀온 곳" }
  await as(S1)
  await fails("B 첫 장면: 두 분이 쓰지 않은 직접 작성은 고를 수 없다", "select public.choose_first_scene($1, $2)", [scenes, JSON.stringify({ ...pickS, rest: "custom:없는 곳" })], /하나씩/)
  await fails("B 첫 장면 이야기: 첫 장면을 고르기 전에는 쓸 수 없다", "select public.write_scene_piece($1, $2)", [scenes, "창가 자리에서 보드게임 하나를 천천히 해 보고 싶어요."], /먼저 골라/)
  ok("B 첫 장면: 직접 쓴 것으로 첫 장면을 고를 수 있다", (await one("select public.choose_first_scene($1, $2) v", [scenes, JSON.stringify(pickS)])).v.notice.includes("상대도 고르면"))
  await fails("B 첫 장면 이야기: 10자보다 짧으면 받지 않는다", "select public.write_scene_piece($1, '좋아요')", [scenes], /10~300자/)
  await fails("B 첫 장면 이야기: 연락처는 넣을 수 없다", "select public.write_scene_piece($1, '만나기 전에 010-1234-5678 로 문자 주세요. 기다릴게요.')", [scenes], /연락처/)
  const piece1 = (await one("select public.write_scene_piece($1, $2) v", [scenes, "창가 자리에서 보드게임 하나를 천천히 해 보고 싶어요."])).v
  ok("B 첫 장면 이야기: 먼저 쓰면 상대를 기다린다", piece1.notice.includes("상대도 쓰면") && find(piece1, 3, "piece").partner === null)
  eq("B 첫 장면 이야기: 쓸 때 고른 장면이 함께 남는다", find(piece1, 3, "piece").own.payload, pickS)
  eq("B 첫 장면 이야기: 상대에게 썼다고 알린다", await notes(`piece-sent:${scenes}:${S1}`), 1)
  await as(S1)
  await fails("B 첫 장면 이야기: 한 번만 쓸 수 있다", "select public.write_scene_piece($1, $2)", [scenes, "다시 쓰고 싶은 이야기가 생겼어요. 한 번 더요."], /다시 보낼 수 없어요/)
  await as(S2)
  const waitingPiece = find(await mine(), 3, "piece")
  ok("B 첫 장면 이야기: 상대가 쓴 것은 알 수 있지만 내가 쓰기 전에는 보이지 않는다", waitingPiece.partnerSent && waitingPiece.partner === null && waitingPiece.own === null)
  await commentFails("B 한마디: 첫 장면 이야기가 함께 열리기 전에는 남길 수 없다", S2, "piece", null, "좋아요", /함께 열린 뒤/)
  await as(S2)
  await q("select public.choose_first_scene($1, $2)", [scenes, JSON.stringify(pickS)])
  const piece2 = (await one("select public.write_scene_piece($1, $2) v", [scenes, "창가 자리에서 다녀온 곳 이야기를 들려주고 싶어요."])).v
  eq("B 첫 장면 이야기: 두 분 모두 쓰면 함께 열린다", find(piece2, 3, "piece").partner.body, "창가 자리에서 보드게임 하나를 천천히 해 보고 싶어요.")
  eq("B 첫 장면 이야기: 함께 열렸다고 두 분에게 알린다", await notes(`piece-open:${scenes}:%`), 2)
  await comment(S2, "piece", null, "창가 자리 저도 좋아요.")
  await as(S1)
  eq("B 한마디: 첫 장면 이야기에 남긴 한마디도 바로 보인다", find(await mine(), 3, "piece-comment").partner.body, "창가 자리 저도 좋아요.")
  // 마감: 만남 선택 마감(다섯째 날 09:00)
  await at(await plus(startS, 4), "09:00")
  await commentFails("B 한마디: 첫 장면 이야기에는 만남 선택 마감까지", S1, "piece", null, "좋아요", /마감/)
  await as(S1)
  await fails("B 첫 장면 이야기: 만남 선택 마감이 지나면 쓸 수 없다", "select public.write_scene_piece($1, $2)", [scenes, "마감이 지난 뒤에 쓰는 첫 장면 이야기예요."], /다섯째 날 09:00/)
  // 다른 방식·비회원
  await as(L1)
  await fails("B 한마디: A 교류에서는 남길 수 없다", "select public.leave_scene_comment($1, 'scene', 1, '좋아요')", [letters], /B 방식/)
  await as("anon")
  await fails("비회원은 첫 장면 이야기를 쓸 수 없다", "select public.write_scene_piece($1, '비회원이 쓰는 이야기예요. 열 자 넘게.')", [scenes])
  // 다시 읽기: 마무리된 교류에서도 한마디·첫 장면 이야기가 함께 온다
  await as("postgres")
  await q("update public.programs set status = 'closed', closed_at = now(), end_reason = 'completed', meeting_a = 'positive', meeting_b = 'positive' where id = $1", [scenes])
  await as(S2)
  const reread = (await one("select public.my_readable_programs() v")).v.find((p) => p.id === scenes)
  ok("B 다시 읽기: 한마디·첫 장면 이야기도 함께 다시 읽을 수 있다", !!find(reread, 1, "comment")?.partner && !!find(reread, 3, "piece")?.partner && !!find(reread, 3, "piece-comment")?.own)
  await as("postgres")
  await clock(null)
}

// ── 회원 혜택(4000): 무제한 회원 · 대표만(2단계 인증) 정함 · 회원은 못 바꿈 · 결제 없이 · 이용 자격 한 곳 · 소개 횟수에 넣지 않음 · 상대 보호 규칙은 그대로
{
  await as("postgres")
  await clock(null)
  const perkFresh = async (email, name, gender, desired, base, phone) => {
    await as("postgres")
    const id = await signup(email)
    await as(id)
    const d = draft(name, gender, desired, "1995-07-07")
    await q("select public.save_application_draft($1)", [{ ...d, values: { ...d.values, "self.phone": phone } }])
    await photos(id, base)
    await q("select public.submit_application()")
    await as(O, "aal2")
    for (const slot of ["photo.face", "photo.upper", "photo.style"]) await q("select public.admin_review_photo($1, $2, '기준 확인')", [id, slot])
    await q("select public.admin_decide_application($1, 'approved')", [id])
    await q("select public.admin_move_member_cohort($1, 1)", [id])
    return id
  }
  const U = await perkFresh("perk-u@example.test", "도윤", "남성", "여성", 4001, "010-4000-0001")
  const N = await perkFresh("perk-n@example.test", "유나", "여성", "남성", 4011, "010-4000-0002")
  await as("postgres")
  const OPR = await signup("perk-operator@example.test")
  await q("insert into public.admin_roles (user_id, role) values ($1, 'operator')", [OPR])

  // 혜택 전에 만들어 둔 결제 전 주문(혜택을 받은 뒤에는 승인하지 않아야 한다)
  await as(U)
  const before = (await one("select public.create_payment_order('introduction') o")).o

  // 회원은 혜택 칸을 바꿀 수 없다 · 운영(대표 아님)·2단계 인증 전 대표는 정할 수 없다
  await fails("혜택: 회원은 자기 혜택 칸을 바꿀 수 없다", "update public.profiles set perk = 'unlimited' where id = $1", [U])
  await fails("혜택: 회원은 혜택 함수를 부를 수 없다(대표만)", "select public.admin_set_member_perk($1, 'unlimited', '셀프')", [U], /대표만/)
  await as(OPR, "aal2")
  await fails("혜택: 운영 역할은 무제한 회원을 정할 수 없다", "select public.admin_set_member_perk($1, 'unlimited', '점검')", [U], /대표만/)
  await as(O)
  await fails("혜택: 2단계 인증 전에는 대표도 정할 수 없다", "select public.admin_set_member_perk($1, 'unlimited', '점검')", [U], /대표만/)
  await as(O, "aal2")
  await fails("혜택: 이유가 없으면 막힌다", "select public.admin_set_member_perk($1, 'unlimited', '  ')", [U], /이유/)
  await fails("혜택: 모르는 혜택은 막힌다", "select public.admin_set_member_perk($1, 'vip', '점검')", [U], /알 수 없어요/)
  await fails("혜택: 운영진 계정에는 줄 수 없다", "select public.admin_set_member_perk($1, 'unlimited', '점검')", [OPR], /운영진 계정/)
  await as("postgres")
  const noticesBefore = (await one("select count(*)::int n from public.notifications")).n
  await as(O, "aal2")
  await q("select public.admin_set_member_perk($1, 'unlimited', '대표 본인 회원 계정')", [U])
  await fails("혜택: 같은 상태로 다시 바꾸면 막힌다", "select public.admin_set_member_perk($1, 'unlimited', '다시')", [U], /이미 그 상태/)
  eq("혜택: 대표가 정하면 감사 기록에 남는다(누가·누구·이유)", { ...(await one("select count(*)::int n, max(reason) r from public.audit_log where action = '무제한 회원 지정' and target = $1 and actor_id = $2", [U, O])) }, { n: 1, r: "대표 본인 회원 계정" })
  ok("혜택: 운영진 회원 목록에 무제한 회원으로 보인다", (await one("select public.admin_list_members('perk-') m")).m.some((r) => r.id === U && r.perk === "unlimited"))
  const readyRows = await q("select member_id, perk from public.admin_ready_members() where member_id = any($1)", [[U, N]])
  eq("혜택: 매칭 후보에도 혜택이 함께 온다(보통 회원은 비어 있음)", Object.fromEntries(readyRows.map((r) => [r.member_id, r.perk])), { [U]: "unlimited", [N]: null })
  await as("postgres")
  eq("혜택: 누구에게도 알림이 가지 않는다", (await one("select count(*)::int n from public.notifications")).n, noticesBefore)

  // 결제: 무제한 회원은 주문을 만들 수 없고, 혜택 전 주문도 승인하지 않는다
  await as(U)
  eq("혜택: 본인은 내 정보에서 혜택을 읽을 수 있다", (await one("select perk from public.profiles where id = $1", [U])).perk, "unlimited")
  await fails("혜택: 무제한 회원은 소개비 주문을 만들 수 없다", "select public.create_payment_order('introduction')", [], /결제 없이 이용해요/)
  await fails("혜택: 무제한 회원은 교류비 주문도 만들 수 없다", "select public.create_payment_order('exchange', gen_random_uuid())", [], /결제 없이 이용해요/)
  eq("혜택: 혜택 전에 만든 결제 전 주문은 승인하지 않는다", (await one("select public.my_payment_order($1) v", [before.orderId])).v.eligible, false)
  await as(N)
  const normal = (await one("select public.create_payment_order('introduction') o")).o
  ok("혜택: 보통 회원은 그대로 주문을 만든다", !!normal.orderId)
  await fails("혜택: 회원은 이용 자격 함수를 직접 부를 수 없다", "select public.member_has_access($1, 'introduction')", [U])

  // 이용 자격 한 곳: 무제한 회원이거나 결제 완료
  await as("postgres")
  const access = async (m, kind, program = null) => (await one("select public.member_has_access($1, $2, $3) v", [m, kind, program])).v
  eq("혜택: 무제한 회원은 소개·교류 자격이 있다", [await access(U, "introduction"), await access(U, "exchange")], [true, true])
  eq("혜택: 결제하지 않은 보통 회원은 자격이 없다", [await access(N, "introduction"), await access(N, "exchange")], [false, false])
  eq("혜택: 모르는 종류는 자격이 없다", await access(U, "gift"), false)
  await db.exec("reset role"); await db.query("select set_config('request.jwt.claims', '', false)"); await db.exec("set role service_role")
  await q("select public.record_payment_result($1, 'paid', 'tpk_perk_0001', '카드')", [normal.orderId])
  await as("postgres")
  eq("혜택: 소개비를 결제 완료하면 소개 자격이 생긴다(교류비는 따로)", [await access(N, "introduction"), await access(N, "exchange")], [true, false])

  // 소개 횟수: 무제한 회원 쪽은 넣지 않고, 상대 쪽은 그대로
  const reveal = (await one("select public.kst_at(public.kst_today() + 3, '12:00') t")).t
  const intro = (await one(`insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at)
    values ($1, $2, '두 분 모두 조용한 산책을 좋아하셨어요.', 'published', $3, $3::timestamptz + interval '23 hours', $3::timestamptz + interval '23 hours', '{}', '{}', $3) returning id`, [U, N, reveal])).id
  await q("update public.introductions set response_a = 'negative', response_b = 'positive' where id = $1", [intro])
  await q("select public.close_introduction($1, 'rejected')", [intro])
  eq("혜택: 무제한 회원 쪽은 소개 횟수에 넣지 않고 상대 쪽은 그대로 센다", { ...(await one("select count_a, count_b from public.introductions where id = $1", [intro])) }, { count_a: false, count_b: true })
  ok("혜택: 같은 두 사람 재소개 금지는 그대로다", (await one("select public.blocks_reintro(i) v from public.introductions i where id = $1", [intro])).v === true)

  // 상대를 지키는 자동 쉬기는 그대로: 두 번 이어서 답하지 않으면 무제한 회원도 쉰다
  const V = await signup("perk-v@example.test"), W2 = await signup("perk-w@example.test")
  for (const [k, other] of [[1, V], [2, W2]]) {
    await q(`insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at)
      values ($1, $2, '두 분 모두 조용한 산책을 좋아하셨어요.', 'published', $3::timestamptz + ($4 || ' days')::interval, $3::timestamptz + ($4 || ' days')::interval + interval '23 hours', $3::timestamptz + ($4 || ' days')::interval + interval '23 hours', '{}', '{}', now())`, [U, other, reveal, k])
  }
  await q("update public.introductions set reveal_at = now() - interval '1 day', respond_by = now() - interval '1 minute', view_until = now() - interval '1 minute' where member_a = $1 and status = 'published'", [U])
  await q("select public.run_introduction_deadlines()")
  eq("혜택: 두 번 이어서 답하지 않으면 무제한 회원도 자동으로 쉰다", (await one("select paused_by from public.profiles where id = $1", [U])).paused_by, "auto")

  // 되돌리기: 감사 기록 · 다시 결제 대상 · 지난 소개 기록은 그대로
  await as(O, "aal2")
  await q("select public.admin_set_member_perk($1, null, '시험 끝')", [U])
  await as("postgres")
  eq("혜택: 되돌리면 감사 기록에 남는다", (await one("select count(*)::int n from public.audit_log where action = '무제한 회원 해제' and target = $1", [U])).n, 1)
  eq("혜택: 되돌리면 자격도 결제 기준으로 돌아온다", await access(U, "introduction"), false)
  eq("혜택: 지난 소개의 횟수 표시는 바꾸지 않는다", (await one("select count_a from public.introductions where id = $1", [intro])).count_a, false)
}

// ── A 편지 질문 묶음(3900): 두 분 모두 받은 적 없는 묶음 · 모두 받았으면 받은 사람이 적고 가장 오래전 묶음 · 시작 못 한 교류는 셈에서 뺌 · 정한 묶음은 그대로 · my_program·다시 읽기에 letterSet
{
  await as("postgres")
  await clock(null)
  const sets = (await one("select public.letter_set_count() n")).n
  eq("편지 질문 묶음: 서버 묶음 수 = 화면 LETTER_SETS 수", sets, readFileSync(join(here, "..", "..", "src", "app", "backend", "program.ts"), "utf8").split("{ days: [").length - 1)
  const pairIntro = async (a, b) => (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at, mutual_at) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'mutual', now() - interval '1 day', now() + interval '1 hour', 'infinity', $3, $3, now() - interval '1 day', now()) returning id", [a, b, snap])).id
  // 교류 하나 만들기: ago일 전에 시작(시작 전 상태면 started_at 없음), set을 주면 그 묶음으로
  const program = async (a, b, plan, status = "started", ago = 0, set = null) => {
    await as("postgres")
    return one(`insert into public.programs (introduction_id, member_a, member_b, status, plan_a, plan_b, start_on, agree_by, started_at, letter_set)
      values ($1, $2, $3, $4, $5, $5, public.kst_today() - $6::int, now(), case when $4 in ('choosing', 'scheduled') then null else now() - make_interval(days => $6::int) end, $7::int) returning id, letter_set`, [await pairIntro(a, b), a, b, status, plan, ago, set])
  }
  const setOf = async (id) => { await as("postgres"); return (await one("select letter_set from public.programs where id = $1", [id])).letter_set }
  const [X, Y, Z, W, V] = [await signup("x-3900@example.test"), await signup("y-3900@example.test"), await signup("z-3900@example.test"), await signup("w-3900@example.test"), await signup("v-3900@example.test")]
  const xy = await program(X, Y, "A", "started", 20)
  eq("편지 질문 묶음: 두 분 모두 처음이면 0번 묶음", xy.letter_set, 0)
  const xz = await program(X, Z, "A", "started", 10)
  eq("편지 질문 묶음: 한 분이 받았던 묶음은 피한다", xz.letter_set, 1)
  const yz = await program(Y, Z, "A", "started", 5)
  eq("편지 질문 묶음: 두 분이 각자 받았던 묶음을 모두 피한다", yz.letter_set, 2)
  eq("편지 질문 묶음: B 교류에는 정하지 않는다", (await program(X, W, "B")).letter_set, null)
  // 합의 중에는 정하지 않고, 일정이 정해질 때 정한다. 한 번 정한 묶음은 바뀌지 않는다.
  const xv = await program(X, V, "A", "choosing")
  eq("편지 질문 묶음: 방식·시작일을 정하는 중에는 아직 정하지 않는다", xv.letter_set, null)
  await q("update public.programs set status = 'scheduled', confirm_a = now(), confirm_b = now() where id = $1", [xv.id])
  eq("편지 질문 묶음: 일정이 정해지면 두 분이 받지 않은 묶음으로 정한다", await setOf(xv.id), 2)
  await q("update public.programs set status = 'started', started_at = now() where id = $1", [xv.id])
  await q("update public.programs set status = 'deciding' where id = $1", [xv.id])
  eq("편지 질문 묶음: 시작·넷째 날로 넘어가도 정한 묶음은 그대로", await setOf(xv.id), 2)
  // 모두 받았을 때: 가장 오래전에 받은 묶음(같은 입력이면 늘 같은 답)
  const F = await signup("f-3900@example.test"), G = await signup("g-3900@example.test"), H = await signup("h-3900@example.test"), K = await signup("k-3900@example.test")
  const order = [[3, 60], [1, 50], [5, 40], [0, 30], [2, 20], [4, 10]]
  for (const [set, ago] of order) await program(F, await signup(`f${set}-3900@example.test`), "A", "closed", ago, set)
  await as("postgres")
  eq("편지 질문 묶음: 모두 받았으면 같은 입력에 늘 같은 묶음", [(await one("select public.pick_letter_set($1, $2, null) n", [F, G])).n, (await one("select public.pick_letter_set($1, $2, null) n", [F, G])).n], [3, 3])
  const fg = await program(F, G, "A")
  eq("편지 질문 묶음: 모두 받았으면 가장 오래전에 받은 묶음", fg.letter_set, 3)
  await program(H, K, "A", "closed", 5, 1)
  eq("편지 질문 묶음: 모두 받았어도 두 분 다 받은 묶음보다 한 분만 받은 묶음을 먼저", (await program(F, H, "A")).letter_set, 5)
  // 시작하지 못하고 끝난 교류의 묶음은 받은 것으로 세지 않는다.
  const N1 = await signup("n1-3900@example.test"), N2 = await signup("n2-3900@example.test"), N3 = await signup("n3-3900@example.test")
  const n12 = await program(N1, N2, "A", "scheduled")
  eq("편지 질문 묶음: 시작을 기다리는 교류에도 미리 정해 둔다", n12.letter_set, 0)
  await q("update public.programs set status = 'closed', closed_at = now(), end_reason = 'admin-cancel' where id = $1", [n12.id])
  eq("편지 질문 묶음: 시작 전에 끝난 교류의 질문은 받은 것으로 세지 않는다", (await program(N1, N3, "A")).letter_set, 0)
  // 화면에 내려 주기: 진행 중(my_program) · 지난 교류 다시 읽기
  await as(G)
  const mineG = (await one("select public.my_program() v")).v
  eq("편지 질문 묶음: my_program이 이 교류의 묶음 번호를 돌려준다", [mineG.id, mineG.ownPlan, mineG.letterSet], [fg.id, "A", 3])
  await as(W)
  eq("편지 질문 묶음: B 교류는 묶음 번호가 없다", (await one("select public.my_program() v")).v.letterSet, null)
  await as("postgres")
  await q("update public.programs set status = 'closed', closed_at = now(), end_reason = 'completed', meeting_a = 'positive', meeting_b = 'positive' where id = $1", [xy.id])
  await as(Y)
  eq("편지 질문 묶음: 지난 교류를 다시 읽을 때도 그때의 묶음 번호가 온다", (await one("select public.my_readable_programs() v")).v.find((p) => p.id === xy.id)?.letterSet, 0)
  await as(X)
  await fails("편지 질문 묶음: 회원은 묶음 고르기 함수를 부를 수 없다", "select public.pick_letter_set($1, $2, null)", [X, Y])
  await fails("편지 질문 묶음: 회원은 묶음 번호를 바꿀 수 없다", "update public.programs set letter_set = 4 where id = $1", [xz.id])
  await as("postgres")
}

// ── 베타 전 점검 고치기(4100): 신고 교류 열람 · 중복 결제 · 보존 정리(궁합·테스트 결제) · 교류 글 수 · 넘긴 소개의 궁합 · 기수 전날 작업 기록
{
  await as("postgres")
  await clock(null)
  const match = { version: 1, score: 80, headline: "걷는 속도가 닮은 두 분이에요.", why: ["주말 산책을 좋아해요."], together: ["천천히 걸으며 이야기해요."] }
  const pairIntro = async (a, b, extra = "") => (await one(`insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at, mutual_at) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'mutual', now() - interval '1 day', now() + interval '1 hour', 'infinity', $3, $3, now() - interval '1 day', now()) returning id${extra}`, [a, b, snap])).id
  const started = async (intro, a, b) => (await one("insert into public.programs (introduction_id, member_a, member_b, status, plan_a, plan_b, start_on, agree_by, started_at) values ($1, $2, $3, 'started', 'A', 'A', public.kst_today() - 1, now(), now()) returning id", [intro, a, b])).id
  const entry = (program, day, kind, author, body, payload = null) => q("insert into public.program_entries (program_id, day, kind, author, body, payload) values ($1, $2, $3, $4, $5, $6)", [program, day, kind, author, body, payload && JSON.stringify(payload)])

  // 신고된 교류 열람: 대표·운영·상담 + 2단계 인증 · 이유 필수 · 감사 기록 · 신고에 이어진 교류만
  const R1 = await signup("r1-4100@example.test"), R2 = await signup("r2-4100@example.test"), R3 = await signup("r3-4100@example.test"), R4 = await signup("r4-4100@example.test")
  const FIN = await signup("fin-4100@example.test")
  await as("postgres")
  await q("insert into public.admin_roles (user_id, role) values ($1, 'finance')", [FIN])
  const reportedIntro = await pairIntro(R1, R2), quietIntro = await pairIntro(R3, R4)
  const reported = await started(reportedIntro, R1, R2), quiet = await started(quietIntro, R3, R4)
  const rPhoto = `${reported}/${R1}/day1-rep00001.jpg`, qPhoto = `${quiet}/${R3}/day1-qui00001.jpg`
  await entry(reported, 1, "letter", R1, "신고된 교류의 편지예요. 사진이 함께 있어요.", { photo: rPhoto })
  await entry(reported, 1, "letter", R2, "상대가 보낸 편지예요. 사진은 없어요.")
  await entry(reported, 1, "reply", R2, "답장이에요.")
  await entry(quiet, 1, "letter", R3, "신고가 없는 교류의 편지예요. 사진이 있어요.", { photo: qPhoto })
  const report = (await one("insert into public.reports (source, reporter_id, target_id, introduction_id, type, description) values ('member', $1, $2, $3, '불편한 말', '편지에서 불편한 말을 들었어요.') returning id", [R2, R1, reportedIntro])).id
  const loose = (await one("insert into public.reports (source, reporter_id, target_id, type, description) values ('member', $1, $2, '기타', '이어진 소개가 없는 신고예요.') returning id", [R2, R1])).id
  await as(R2)
  await fails("신고 교류 열람: 회원은 열 수 없다", "select public.admin_report_exchange($1, '확인')", [report], /권한/)
  await as(O)
  await fails("신고 교류 열람: 2단계 인증 전에는 열 수 없다", "select public.admin_report_exchange($1, '확인')", [report], /권한/)
  await as(FIN, "aal2")
  await fails("신고 교류 열람: 정산 권한으로는 열 수 없다", "select public.admin_report_exchange($1, '확인')", [report], /권한/)
  eq("신고 교류 사진: 정산 권한으로는 열 수 없다", (await one("select public.admin_can_view_letter_photo($1, '확인') v", [rPhoto])).v, false)
  await as("anon")
  await fails("신고 교류 열람: 비회원은 부를 수 없다", "select public.admin_report_exchange($1, '확인')", [report])
  await as(O, "aal2")
  await fails("신고 교류 열람: 이유 없이는 열 수 없다", "select public.admin_report_exchange($1, '  ')", [report], /이유/)
  await fails("신고 교류 열람: 이어진 교류가 없는 신고는 열 수 없다", "select public.admin_report_exchange($1, '신고 내용 확인')", [loose], /이어진 교류/)
  const opened = (await one("select public.admin_report_exchange($1, '신고 내용 확인') v", [report])).v
  eq("신고 교류 열람: 신고에 이어진 교류의 글(모든 종류)과 사진 경로만 온다", [opened.programId, opened.entries.length, opened.entries.map((e) => e.kind).sort(), opened.photos], [reported, 3, ["letter", "letter", "reply"], [rPhoto]])
  await as("postgres")
  eq("신고 교류 열람: 감사 기록에 이유와 함께 남는다", { ...(await one("select action, target, reason, actor_role from public.audit_log where action = '신고 교류 열람' order by id desc limit 1")) }, { action: "신고 교류 열람", target: report, reason: "신고 내용 확인", actor_role: "owner" })
  await as(O, "aal2")
  eq("신고 교류 사진: 신고가 있는 교류의 사진은 운영진이 열 수 있다", (await one("select public.admin_can_view_letter_photo($1, '신고 내용 확인') v", [rPhoto])).v, true)
  eq("신고 교류 사진: 신고가 없는 교류의 사진은 운영진도 열 수 없다", (await one("select public.admin_can_view_letter_photo($1, '신고 내용 확인') v", [qPhoto])).v, false)
  await as("postgres")
  eq("신고 교류 사진: 연 사진은 감사 기록에 남는다(신고 없는 교류는 남기지 않는다)", (await q("select target from public.audit_log where action = '신고 교류 사진 열람' order by id")).map((r) => r.target), [reported])
  await as(R2)
  eq("신고 교류 사진: 회원은 운영진 확인으로 열 수 없다", (await one("select public.admin_can_view_letter_photo($1) v", [rPhoto])).v, false)

  // 중복 결제: 확인과 완료 사이에 다른 창의 결제가 먼저 완료되면 유일 색인 위반을 ‘중복 결제’로 알린다(payments-confirm이 바로 취소)
  await as("postgres")
  const pay = (member, order, status = "ready", key = null) => q("insert into public.payments (member_id, kind, order_id, amount, order_name, provider, mode, status, payment_key) values ($1, 'introduction', $2, 10000, '[테스트] 비포어스 소개비', 'toss', 'test', $3, $4)", [member, order, status, key])
  await pay(R3, "RACE-order-1"); await pay(R3, "RACE-order-2")
  await db.exec(`create function public.test_race() returns trigger language plpgsql as $$ begin
    if new.order_id = 'RACE-order-1' and new.status = 'paid' and old.status <> 'paid' then update public.payments set status = 'paid', payment_key = 'tpk_race_first' where order_id = 'RACE-order-2'; end if;
    return new; end $$;
    create trigger test_race before update on public.payments for each row execute function public.test_race();`)
  await fails("중복 결제: 거의 같은 때 먼저 완료된 결제가 있으면 ‘중복 결제’로 알린다", "select public.record_payment_result('RACE-order-1', 'paid', 'tpk_race_second')", [], /중복 결제/)
  await db.exec("drop trigger test_race on public.payments; drop function public.test_race();")
  eq("중복 결제: 막힌 결제는 결제 완료로 남지 않는다", (await q("select order_id, status from public.payments where order_id like 'RACE-%' order by order_id")).map((r) => r.status), ["ready", "ready"])
  await q("select public.record_payment_result('RACE-order-1', 'paid', 'tpk_race_same')")
  await pay(R4, "RACE-order-3")
  try { await db.query("select public.record_payment_result('RACE-order-3', 'paid', 'tpk_race_same')"); throw new Error("같은 결제 키가 통과했어요") }
  catch (error) { ok("중복 결제: 다른 유일 값(같은 결제 키) 위반은 ‘중복 결제’로 바꾸지 않는다", !/중복 결제/.test(error.message) && /unique|payment_key/.test(error.message)) }

  // 보존 정리: 프로필 사본과 함께 궁합도 지운다 · 90일 지난 테스트 결제 기록을 지운다(실제 결제는 남긴다)
  await as("postgres")
  const T1 = await signup("t1-4100@example.test"), T2 = await signup("t2-4100@example.test")
  await as("postgres")
  const oldIntro = (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at, closed_at, end_reason, match) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'closed', now() - interval '40 days', now() - interval '39 days', now() - interval '39 days', $3, $3, now() - interval '40 days', now() - interval '31 days', 'rejected', $4) returning id", [T1, T2, snap, match])).id
  await q("insert into public.payments (member_id, kind, order_id, amount, order_name, provider, mode, status, created_at) values ($1, 'introduction', 'OLD-test-91', 10000, 'x', 'toss', 'test', 'failed', now() - interval '91 days'), ($1, 'introduction', 'OLD-test-89', 10000, 'x', 'toss', 'test', 'failed', now() - interval '89 days'), ($1, 'introduction', 'OLD-live-91', 10000, 'x', 'toss', 'live', 'failed', now() - interval '91 days')", [R4])
  const swept = (await one("select public.run_retention() r")).r
  eq("보존 정리: 프로필 사본을 지울 때 궁합도 지운다", { ...(await one("select snapshot_a ? 'deleted' gone, match from public.introductions where id = $1", [oldIntro])) }, { gone: true, match: null })
  eq("보존 정리: 90일 지난 테스트 결제만 지운다(실제 결제·90일 안은 남긴다)", (await q("select order_id from public.payments where order_id like 'OLD-%' order by order_id")).map((r) => r.order_id), ["OLD-live-91", "OLD-test-89"])
  ok("보존 정리: 지운 테스트 결제 수가 작업 기록에 남는다", swept.testPayments >= 1 && (await one("select ok from public.job_runs where job = 'retention' order by id desc limit 1")).ok)

  // 교류 목록의 보낸 글 수: 본 글(편지·첫 장면 답)과 답장·한마디·이야기를 따로 센다
  await as(O, "aal2")
  const row = (await one("select public.admin_list_programs() v")).v.find((p) => p.id === reported)
  eq("교류 목록: 본 글과 답장·한마디는 따로 센다", [row.entriesA, row.extrasA, row.entriesB, row.extrasB], [1, 0, 1, 1])

  // 내가 넘긴 소개에는 궁합을 보내지 않는다(상대는 답하기 전까지 그대로 본다)
  await as("postgres")
  const N1 = await signup("n1-4100@example.test"), N2 = await signup("n2-4100@example.test")
  const nIntro = (await one("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at, opened_a_at, opened_b_at, match) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'published', now() - interval '1 hour', now() + interval '20 hours', now() + interval '20 hours', $3, $3, now() - interval '1 hour', now(), now(), $4) returning id", [N1, N2, snap, match])).id
  await as(N1)
  eq("넘긴 소개: 답하기 전에는 궁합이 보인다", (await one("select public.my_introduction() v")).v.match?.score, 80)
  await q("select public.respond_introduction($1, 'negative')", [nIntro])
  const after = (await one("select public.my_introduction() v")).v
  eq("넘긴 소개: ‘넘길게요’로 답하면 내 화면에는 궁합이 오지 않는다", [after.id, after.ownResponse, after.match], [nIntro, "negative", null])
  await as(N2)
  eq("넘긴 소개: 아직 답하지 않은 상대에게는 궁합이 그대로 보인다", (await one("select public.my_introduction() v")).v.match?.score, 80)

  // 기수 전날 알림: 돌 때마다 작업 기록을 남긴다
  await as("postgres")
  const eve = (await one("select public.run_cohort_eve() n")).n
  eq("기수 전날 알림: 작업 기록(cohort-eve)이 남는다", { ...(await one("select ok, (detail ->> 'notified')::int n from public.job_runs where job = 'cohort-eve' order by id desc limit 1")) }, { ok: true, n: eve })
  await as("postgres")
}

console.log(`서버 데이터베이스 점검 통과: ${passed}개`)
