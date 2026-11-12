-- 7600: GPT 4차 재검수 대응(2026-11-12) — R4-09 회고 집계 단위 · R4-10 시험 계정 격리 · R4-11 문의 조회 잠금 · R4-12 공개 상태 · R4-18 장애 구제
-- 앞선 6500~7500 파일은 고치지 않고 여기서 전진 수정한다.

-- ─────────────────────────────────────────────────────────
-- 1. R4-10 시험 계정 격리
--    · 대표(2단계 인증)만 지정·해제한다. 회원은 표를 읽지도 바꾸지도 못한다. payment_testers(결제 시험)와는 별개다.
--    · 지정은 ‘소개가 한 건도 없는’ 계정만(처음부터 격리). 지정하는 순간 그 계정이 이미 올린 누적 숫자(가입·신청·처음 승인·탈퇴 요청)를 빼고,
--      해제하면 되돌린다(뺀 내용은 uncounted 에 이름·기수 숫자만 남긴다).
--    · 시험 계정과 실회원은 소개로 묶을 수 없다(시험 계정끼리만) — 표 트리거라 어느 경로로 넣어도 막힌다.
--    · 집계(누적 트리거 · 그날 현재 숫자 · 기수 자리 수)에서 뺀다.
create table if not exists public.test_accounts (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  reason text check (reason is null or char_length(reason) <= 200),
  uncounted jsonb not null default '[]'::jsonb
);
alter table public.test_accounts enable row level security;
revoke all on public.test_accounts from anon, authenticated;

create or replace function public.is_test_account(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_member is not null and exists (select 1 from public.test_accounts t where t.member_id = p_member)
$$;

create or replace function public.admin_set_test_account(p_member uuid, p_test boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.applications; pr public.profiles; items jsonb := '[]'::jsonb; x jsonb; was boolean;
begin
  if not public.is_admin(array['owner']) then raise exception '대표만 시험 계정을 지정할 수 있어요.'; end if;
  select * into pr from public.profiles where id = p_member for update;
  if pr.id is null then raise exception '회원을 찾을 수 없어요.'; end if;
  if exists (select 1 from public.introductions i where p_member in (i.member_a, i.member_b)) then
    raise exception '이미 소개 기록이 있는 계정은 시험 계정으로 바꾸거나 되돌릴 수 없어요. 새 계정으로 시험해 주세요.';
  end if;
  was := public.is_test_account(p_member);
  if coalesce(p_test, false) = was then return jsonb_build_object('member', p_member, 'test', was, 'changed', false); end if;
  select * into a from public.applications where member_id = p_member;
  if p_test then
    items := jsonb_build_array(jsonb_build_object('n', 'signed_up', 'c', -1));
    if a.submitted_at is not null then items := items || jsonb_build_object('n', 'applied', 'c', coalesce(a.cohort_number, -1)); end if;
    if a.approved_once then items := items || jsonb_build_object('n', 'approved_ever', 'c', coalesce(a.cohort_number, -1)); end if;
    if pr.status = 'withdrawal_requested' then items := items || jsonb_build_object('n', 'withdrawal_requested', 'c', coalesce(a.cohort_number, -1)); end if;
    for x in select * from jsonb_array_elements(items) loop perform public.bump_metric(x ->> 'n', (x ->> 'c')::int, -1); end loop;
    insert into public.test_accounts (member_id, set_by, reason, uncounted) values (p_member, auth.uid(), left(nullif(trim(coalesce(p_reason, '')), ''), 200), items);
    perform public.write_audit('시험 계정 지정', p_member::text, left(coalesce(p_reason, ''), 200));
  else
    select uncounted into items from public.test_accounts where member_id = p_member;
    for x in select * from jsonb_array_elements(coalesce(items, '[]'::jsonb)) loop perform public.bump_metric(x ->> 'n', (x ->> 'c')::int, 1); end loop;
    delete from public.test_accounts where member_id = p_member;
    perform public.write_audit('시험 계정 해제', p_member::text, left(coalesce(p_reason, ''), 200));
  end if;
  return jsonb_build_object('member', p_member, 'test', coalesce(p_test, false), 'changed', true);
end $$;

-- 운영진이 화면에 ‘시험’ 표시를 달 수 있게 번호 목록만 준다
create or replace function public.admin_test_accounts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('member', t.member_id, 'setAt', t.set_at, 'reason', t.reason) order by t.set_at) from public.test_accounts t), '[]'::jsonb);
end $$;

create or replace function public.check_intro_test_mix() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.is_test_account(new.member_a) is distinct from public.is_test_account(new.member_b) then
    raise exception '시험 계정과 실제 회원은 서로 소개할 수 없어요. 시험 계정끼리만 소개해 주세요.';
  end if;
  return new;
end $$;
drop trigger if exists introductions_test_mix on public.introductions;
create trigger introductions_test_mix before insert on public.introductions for each row execute function public.check_intro_test_mix();

-- 기수 자리 수: 시험 계정은 세지 않는다
create or replace function public.cohort_count(p_number int, p_gender text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.applications a
   where a.cohort_number = p_number and a.status in ('submitted', 'reviewing', 'needs_changes', 'approved', 'held')
     and a.draft -> 'values' ->> 'self.gender' = p_gender
     and not exists (select 1 from public.test_accounts t where t.member_id = a.member_id)
$$;

-- 누적 집계 트리거(7400 정의 + 시험 계정 제외)
create or replace function public.metric_on_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then perform public.bump_metric('signed_up', null); return new; end if;
  if new.status = 'withdrawal_requested' and old.status is distinct from 'withdrawal_requested' and not public.is_test_account(new.id) then
    perform public.bump_metric('withdrawal_requested', (select a.cohort_number from public.applications a where a.member_id = new.id));
  end if;
  return new;
end $$;
create or replace function public.metric_on_application() returns trigger
language plpgsql security definer set search_path = '' as $$
declare test boolean := public.is_test_account(new.member_id);
begin
  if new.submitted_at is not null and (tg_op = 'INSERT' or old.submitted_at is null) and not test then perform public.bump_metric('applied', new.cohort_number); end if;
  if new.status = 'approved' and not new.approved_once then
    new.approved_once := true;
    if not test then perform public.bump_metric('approved_ever', new.cohort_number); end if;
  end if;
  return new;
end $$;
create or replace function public.metric_on_introduction() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c int := (select a.cohort_number from public.applications a where a.member_id = new.member_a);
begin
  if public.is_test_account(new.member_a) or public.is_test_account(new.member_b) then return new; end if;
  if new.published_at is not null and (tg_op = 'INSERT' or old.published_at is null) then perform public.bump_metric('introduced', c); end if;
  if new.mutual_at is not null and (tg_op = 'INSERT' or old.mutual_at is null) then perform public.bump_metric('mutual', c); end if;
  return new;
end $$;
create or replace function public.metric_on_program() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c int := (select a.cohort_number from public.applications a where a.member_id = new.member_a);
begin
  if public.is_test_account(new.member_a) or public.is_test_account(new.member_b) then return new; end if;
  if new.started_at is not null and (tg_op = 'INSERT' or old.started_at is null) then perform public.bump_metric('program_started', c); end if;
  if new.status = 'closed' and new.end_reason = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'closed') then perform public.bump_metric('program_completed', c); end if;
  return new;
end $$;

-- 그날 현재 숫자(7400 정의 + 시험 계정 제외 · 시험 계정 수는 따로 한 칸)
create or replace function public.take_metric_snapshot(p_reason text default 'manual') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur jsonb; ever jsonb; snap jsonb;
begin
  select jsonb_build_object(
    'membersActive', (select count(*) from public.profiles p where p.status = 'active' and not public.is_test_account(p.id)),
    'applicationsSubmittedNow', (select count(*) from public.applications a where a.status in ('submitted', 'reviewing') and not public.is_test_account(a.member_id)),
    'approvedNow', (select count(*) from public.applications a join public.profiles p on p.id = a.member_id where a.status = 'approved' and p.status = 'active' and not public.is_test_account(p.id)),
    'pausedNow', (select count(*) from public.profiles p where p.status = 'active' and p.paused_at is not null and not public.is_test_account(p.id)),
    'introductionsOpenNow', (select count(*) from public.introductions i where i.status in ('reserved', 'published', 'mutual') and not public.is_test_account(i.member_a)),
    'programsOpenNow', (select count(*) from public.programs g where g.status <> 'closed' and not public.is_test_account(g.member_a)),
    'withdrawalPendingNow', (select count(*) from public.profiles p where p.status = 'withdrawal_requested' and not public.is_test_account(p.id)),
    'testAccountsNow', (select count(*) from public.test_accounts))
    into cur;
  select coalesce(jsonb_object_agg(name || case when cohort = -1 then '' else '@' || cohort end, value), '{}'::jsonb) into ever from public.metric_counters;
  snap := jsonb_build_object('current', cur, 'ever', ever);
  insert into public.metric_daily (day, taken_at, reason, counts) values (public.kst_today(), now(), left(coalesce(p_reason, 'manual'), 40), snap)
  on conflict (day) do update set taken_at = excluded.taken_at, reason = excluded.reason, counts = excluded.counts;
  delete from public.metric_daily where day < public.kst_today() - interval '2 years';
  return snap;
end $$;

-- ─────────────────────────────────────────────────────────
-- 2. R4-09 만남 자기보고 집계: 단위는 ‘회원 × 교류’(한 교류에 대한 한 회원의 응답 하나)
--    · 줄마다 ‘어느 값으로 · 어느 기수 칸에 세었는지’(counted_met · counted_cohort — 숫자·값 이름만)를 남겨, 같은 줄은 한 번만 센다.
--    · 응답을 바꾸면 옮겨 세고(기수를 옮겼어도 셌던 칸에서 뺀다), 회원이 스스로 지우면(delete_reflection) 셌던 칸에서 뺀다 → 다시 쓰면 다시 +1(중복 없음).
--    · 보존 기간 파기(1년)·탈퇴로 줄이 지워질 때는 빼지 않는다(DELETE 트리거를 두지 않는다) → 원문 없이 누적이 남는다.
alter table public.reflections add column if not exists counted_met text check (counted_met is null or counted_met in ('met', 'not_met', 'skip'));
alter table public.reflections add column if not exists counted_cohort integer;
update public.reflections r set counted_met = r.met, counted_cohort = coalesce((select a.cohort_number from public.applications a where a.member_id = r.member_id), -1)
 where r.met is not null and r.counted_met is null;

-- 셈은 UPDATE 앞에서만 한다. 새 줄(INSERT)은 넣은 뒤 한 번 건드려 같은 길로 센다
-- (save_reflection 의 ‘넣거나 고치기’에서 INSERT 앞 트리거는 고치기로 끝나도 불려 두 번 세게 되므로 쓰지 않는다).
create or replace function public.metric_on_reflection() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- 셈 칸은 이 트리거만 바꾼다(다른 경로로 바뀌지 않게 예전 값으로 되돌려 놓고 시작)
  new.counted_met := old.counted_met; new.counted_cohort := old.counted_cohort;
  if old.counted_met is not null and old.counted_met is distinct from new.met then
    perform public.bump_metric('self_report_' || old.counted_met, old.counted_cohort, -1);
    new.counted_met := null; new.counted_cohort := null;
  end if;
  if new.met is not null and new.counted_met is null and not public.is_test_account(new.member_id) then
    new.counted_cohort := coalesce((select a.cohort_number from public.applications a where a.member_id = new.member_id), -1);
    new.counted_met := new.met;
    perform public.bump_metric('self_report_' || new.met, new.counted_cohort);
  end if;
  return new;
end $$;
create or replace function public.metric_on_reflection_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.met is not null or new.counted_met is not null then
    update public.reflections set counted_met = null, counted_cohort = null where member_id = new.member_id and program_id = new.program_id;
  end if;
  return null;
end $$;
drop trigger if exists metric_reflection on public.reflections;
create trigger metric_reflection before update on public.reflections for each row execute function public.metric_on_reflection();
drop trigger if exists metric_reflection_insert on public.reflections;
create trigger metric_reflection_insert after insert on public.reflections for each row execute function public.metric_on_reflection_insert();

-- 회원이 스스로 지움(정정·철회): 셌던 칸에서 뺀다. 반영된 한 줄은 지금처럼 지울 수 없다.
create or replace function public.delete_reflection(p_program uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cm text; cc integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.'; end if;
  delete from public.reflections where member_id = auth.uid() and program_id = p_program and used_at is null
  returning counted_met, counted_cohort into cm, cc;
  if not found then raise exception '지울 수 있는 한 줄이 없어요.'; end if;
  if cm is not null then perform public.bump_metric('self_report_' || cm, cc, -1); end if;
end $$;

do $$
declare def text := pg_get_functiondef('public.admin_metric_snapshots(integer)'::regprocedure);
  old text := '''self_report'', ''본인 만남 응답(사람 단위 · 자기보고)''';
begin
  if position(old in def) = 0 then raise exception 'admin_metric_snapshots 정의 문구를 바꾸지 못했어요'; end if;
  execute replace(def, old, '''self_report'', ''본인 만남 응답(회원×교류 단위 · 자기보고 · 바꾸면 옮겨 세고 스스로 지우면 뺌 · 기간 파기는 그대로)'', ''testAccounts'', ''시험 계정은 모든 숫자에서 뺌''');
end $$;

-- ─────────────────────────────────────────────────────────
-- 3. R4-11 비회원 문의 조회: 맞는 접수 번호 + 메일은 실패 횟수와 상관없이 언제나 보여 준다
--    · 예전: 누가 남의 메일로 틀린 번호를 10번 넣으면 그 메일의 주인도 1시간 조회하지 못했다(전체 300번도 같은 문제).
--    · 지금: 먼저 찾는다. 맞으면 그대로 돌려준다. 틀린 조회만 세고, 한도를 넘은 ‘틀린 조회’만 안내 문장으로 거절한다(기록도 더 쌓지 않는다).
--    · 남의 문의가 있는지는 여전히 알 수 없다(틀리면 null 또는 같은 안내). 접수 번호는 날짜 + 임의 8자리(32비트)라 한도 없이도 맞히기 어렵고,
--      서버는 요청자의 주소를 믿을 수 있게 알 수 없어 요청자별 제한은 두지 않았다.
create or replace function public.find_inquiry(p_id text, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k text := md5('inquiry-lookup:' || lower(trim(coalesce(p_email, '')))); found jsonb;
begin
  select jsonb_build_object('id', id, 'type', type, 'name', name, 'body', body, 'at', created_at, 'status', status,
                            'answer', case when answer_body is null then null else jsonb_build_object('body', answer_body, 'at', answered_at) end)
    into found
    from public.inquiries
   where id = upper(trim(p_id)) and email = lower(trim(p_email));
  if found is not null then return found; end if;
  delete from public.inquiry_lookup_failures where at < now() - interval '1 day';
  if (select count(*) from public.inquiry_lookup_failures f where f.key_hash = k and f.at > now() - interval '1 hour') >= 10
     or (select count(*) from public.inquiry_lookup_failures f where f.at > now() - interval '10 minutes') >= 300 then
    raise exception '접수 번호나 메일이 맞지 않아요. 확인 요청이 많아 잠시 뒤 다시 시도해 주세요. 접수 번호를 잃어버렸다면 같은 메일로 문의를 새로 남겨 주세요.';
  end if;
  insert into public.inquiry_lookup_failures (key_hash) values (k);
  return null;
end $$;
revoke all on function public.find_inquiry(text, text) from public;
grant execute on function public.find_inquiry(text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- 4. R4-18 장애 시간에 응답 기회를 잃은 소개의 구제(대표·운영 · 2단계 인증)
--    가장 보수적인 쪽을 골랐다: 닫힌 소개를 다시 열지 않는다(공개 시각·마감·이미 한 응답·알림을 바꾸지 않음).
--    대신 그 소개에 ‘운영 사정’ 표시를 남겨 ① 같은 두 사람을 다시 소개할 수 있게 하고(기존 재소개 예외 규칙과 같은 길: 정오에 새로 예약),
--    ② 답하지 못한 쪽의 ‘무응답 1번’으로 세지 않고(두 번 연속 자동 쉬기 · 소개 횟수), ③ 이 소개 때문에 자동으로 쉬게 된 회원은 쉬기를 푼다.
--    대상: 무응답(nonresponse)으로 닫힌 지 14일 안의 소개만. 실제 거절(negative)·서로 선택·신고가 있는 소개는 거절한다. 이유(5자 이상)와 감사 기록.
alter table public.introductions add column if not exists outage_excused_at timestamptz;
alter table public.introductions add column if not exists outage_excused_by uuid references auth.users (id) on delete set null;
alter table public.introductions add column if not exists outage_reason text check (outage_reason is null or char_length(outage_reason) between 5 and 300);

create or replace function public.reintro_reason(i public.introductions) returns text
language sql stable set search_path = '' as $$
  select case
    when exists (select 1 from public.reports r where r.introduction_id = i.id) then 'reported'
    when i.mutual_at is not null or i.status = 'mutual' then 'mutual'
    when 'negative' in (coalesce(i.response_a, ''), coalesce(i.response_b, '')) then 'declined'
    when i.status = 'cancelled' or coalesce(i.end_reason, '') in ('admin-cancel', 'missed-window', 'precheck') then null
    when i.status in ('reserved', 'published') then 'active'
    when i.end_reason = 'nonresponse' and i.outage_excused_at is not null then null
    when i.end_reason = 'nonresponse' then
      case when (i.response_a is not null or i.opened_a_at is null) and (i.response_b is not null or i.opened_b_at is null) then null else 'nonresponse' end
    else 'ended' end
$$;
create or replace function public.reintro_exception(i public.introductions) returns text
language sql stable set search_path = '' as $$
  select case
    when public.reintro_reason(i) is not null then null
    when coalesce(i.end_reason, '') in ('admin-cancel', 'missed-window', 'precheck') then i.end_reason
    when i.end_reason = 'nonresponse' and i.outage_excused_at is not null then 'outage'
    when i.end_reason = 'nonresponse' then 'unopened'
    when i.status = 'cancelled' then 'cancelled'
  end
$$;
create or replace function public.intro_counts(i public.introductions, p_member uuid) returns boolean
language sql stable set search_path = '' as $$
  select case
    when public.is_unlimited_member(p_member) then false
    when i.status = 'cancelled' then false
    when coalesce(i.end_reason, '') in ('admin-cancel', 'missed-window', 'precheck') then false
    when i.end_reason = 'nonresponse' and i.outage_excused_at is not null then false
    when i.end_reason = 'nonresponse' then (case when i.member_a = p_member then i.response_a else i.response_b end) is null
    when i.end_reason in ('blocked', 'withdrawn', 'suspended') then i.ended_by is not distinct from p_member
    else true end
$$;

-- 응답 마감 작업: ‘최근 두 번 무응답’에서 운영 사정으로 표시한 소개는 세지 않는다
do $$
declare def text := pg_get_functiondef('public.run_introduction_deadlines()'::regprocedure);
  old text := 'where last2.end_reason = ''nonresponse'' and (case when last2.member_a = m then last2.response_a else last2.response_b end) is null;';
begin
  if position(old in def) = 0 then raise exception 'run_introduction_deadlines(무응답 세기)를 바꾸지 못했어요'; end if;
  execute replace(def, old, 'where last2.end_reason = ''nonresponse'' and last2.outage_excused_at is null and (case when last2.member_a = m then last2.response_a else last2.response_b end) is null;');
end $$;

create or replace function public.admin_excuse_nonresponse(p_introduction uuid, p_reason text, p_notify boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.introductions; why text := trim(coalesce(p_reason, '')); m uuid; resumed uuid[] := '{}';
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영진 권한이 필요해요.'; end if;
  if char_length(why) < 5 or char_length(why) > 300 then raise exception '이유를 5~300자로 적어 주세요(감사 기록에 남아요).'; end if;
  select * into i from public.introductions where id = p_introduction for update;
  if i.id is null then raise exception '소개를 찾을 수 없어요.'; end if;
  if i.published_at is null then raise exception '공개되지 않은 소개예요. 공개 전 취소는 그대로 다시 예약할 수 있어요.'; end if;
  if i.status <> 'closed' or i.end_reason is distinct from 'nonresponse' then raise exception '답이 없어 마무리된 소개만 표시할 수 있어요.'; end if;
  if 'negative' in (coalesce(i.response_a, ''), coalesce(i.response_b, '')) or i.mutual_at is not null then raise exception '이미 답한 내용이 있는 소개는 되돌리지 않아요.'; end if;
  if exists (select 1 from public.reports r where r.introduction_id = i.id) then raise exception '신고가 있는 소개는 표시할 수 없어요.'; end if;
  if i.closed_at < now() - interval '14 days' then raise exception '마무리된 지 14일이 지난 소개예요.'; end if;
  if i.outage_excused_at is not null then return jsonb_build_object('introduction', i.id, 'changed', false, 'excusedAt', i.outage_excused_at); end if;
  update public.introductions set outage_excused_at = now(), outage_excused_by = auth.uid(), outage_reason = why, count_a = false, count_b = false where id = i.id;
  foreach m in array array[i.member_a, i.member_b] loop
    continue when m is null;
    -- 이 소개의 무응답 때문에 자동으로 쉬게 된 회원만 쉬기를 푼다(본인이 고른 쉬기·운영진 쉬기는 그대로)
    if exists (select 1 from public.notifications n where n.dedupe_key = 'autopause:' || i.id || ':' || m) then
      update public.profiles set paused_at = null, paused_by = null, updated_at = now() where id = m and paused_at is not null and paused_by = 'auto';
      if found then resumed := resumed || m; end if;
    end if;
    if coalesce(p_notify, true) then
      perform public.notify(m, 'closed', '서비스 사정으로 답할 시간이 충분하지 않았어요',
        '불편을 드려 죄송해요. 이번 소개는 답하지 않은 것으로 세지 않았어요. 잘 맞는 분이 준비되면 다시 정오에 소개해 드릴게요.', '/today', 'outage:' || i.id || ':' || m);
    end if;
  end loop;
  perform public.write_audit('장애 구제(무응답 소개)', i.id::text, why);
  return jsonb_build_object('introduction', i.id, 'changed', true, 'responseA', i.response_a, 'responseB', i.response_b, 'resumed', cardinality(resumed), 'notified', coalesce(p_notify, true));
end $$;

-- ─────────────────────────────────────────────────────────
-- 5. R4-12 공개 상태(public_health): ‘호출이 살아 있음’과 ‘실제로 준비됨’을 나눠 보여 준다
--    · ok 는 서버 예약 작업만 본다는 사실을 응답에 적는다(okCovers · backupIncludedInOk=false) + 백업은 backupOk 로 따로.
--    · mailReady: 메일 함수의 마지막 기록이 ‘설정 없음(blocked)’이 아니고 실패도 아닐 때만 true(기록이 없으면 false).
--    · 정오 공개: 26시간 신선도가 아니라 예정 시각 기준 — 한국 시각 12:15가 지났는데 오늘 12:00 뒤 기록이 없으면 늦음(noonLateToday).
--    · 작업 줄의 모양(job · lastRunMinutes · late · lastFailed · ownerPc)은 그대로. 개인정보 없음.
create or replace function public.noon_run_late(p_now timestamptz, p_last timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select (p_now at time zone 'Asia/Seoul')::time >= time '12:15'
     and (p_last is null or p_last < (((p_now at time zone 'Asia/Seoul')::date + time '12:00') at time zone 'Asia/Seoul'))
$$;

create or replace function public.public_health() returns jsonb
language sql stable security definer set search_path = '' as $$
  with jobs as (
    select e.job, e.within_minutes, e.job like 'backup%' as owner_pc, l.started_at as last_run, l.ok as last_ok, l.detail as last_detail
      from public.job_expectations() e
      left join lateral (select j.started_at, j.ok, j.detail from public.job_runs j where j.job = e.job order by j.started_at desc, j.id desc limit 1) l on true),
  judged as (
    select *, (last_run is null or last_run < now() - make_interval(mins => within_minutes)
               or (job = 'noon' and public.noon_run_late(now(), last_run))) as late
      from jobs)
  select jsonb_build_object(
    'ok', coalesce(bool_and(not late and last_ok is true) filter (where not owner_pc), false),
    'okCovers', 'server-jobs',
    'backupIncludedInOk', false,
    'backupOk', coalesce(bool_and(not late and last_ok is true) filter (where owner_pc), false),
    'mailReady', coalesce(bool_and(last_run is not null and last_ok is true and coalesce(last_detail ->> 'blocked', 'false') <> 'true') filter (where job = 'email'), false),
    'noonLateToday', coalesce(bool_or(public.noon_run_late(now(), last_run)) filter (where job = 'noon'), false),
    'checkedAt', now(),
    'jobs', jsonb_agg(jsonb_build_object(
      'job', job,
      'lastRunMinutes', case when last_run is null then null else floor(extract(epoch from now() - last_run) / 60)::int end,
      'late', late,
      'lastFailed', coalesce(last_ok = false, false),
      'ownerPc', owner_pc) order by owner_pc, job))
  from judged
$$;
revoke all on function public.public_health() from public;
grant execute on function public.public_health() to anon, authenticated, service_role;

-- 작업 점검(매시간)도 같은 기준으로 정오 누락을 찾는다(26시간 기준과 겹치지 않게 그 안쪽일 때만 한 줄)
do $$
declare def text := pg_get_functiondef('public.run_job_watchdog()'::regprocedure);
  anchor text := '  if cardinality(problems) > 0 then';
begin
  if position(anchor in def) = 0 then raise exception 'run_job_watchdog를 바꾸지 못했어요'; end if;
  execute replace(def, anchor, '  if public.noon_run_late(now(), (select max(j.started_at) from public.job_runs j where j.job = ''noon''))
     and exists (select 1 from public.job_runs j where j.job = ''noon'' and j.started_at >= now() - interval ''26 hours'') then
    problems := problems || ''정오 공개(noon) 오늘 12시 뒤 기록 없음''::text;
  end if;
' || anchor);
end $$;

revoke all on function public.is_test_account(uuid), public.admin_set_test_account(uuid, boolean, text), public.admin_test_accounts(), public.check_intro_test_mix(), public.metric_on_reflection_insert(),
  public.admin_excuse_nonresponse(uuid, text, boolean), public.noon_run_late(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_set_test_account(uuid, boolean, text), public.admin_test_accounts(), public.admin_excuse_nonresponse(uuid, text, boolean) to authenticated;
