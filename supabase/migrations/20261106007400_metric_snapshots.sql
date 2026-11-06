-- 7400: GPT 3차 검수 R3-30 — 원문을 지운 뒤에도 남는 최소 집계(숫자만)
--
-- 목적: 베타·기수 결과 판단(가입→신청→승인→소개→서로 선택→교류→마무리, 본인 만남 응답)을 원문 보존 없이 하기 위해.
-- 담는 것: 숫자만. 회원 번호·이름·글·사진 경로는 담지 않는다. 기수 번호별로 나눈 숫자(기수 없음은 -1).
-- 접근: 운영진(대표·운영 · 2단계 인증)만 admin_metric_snapshots()로 본다. 회원·비회원은 표를 읽을 수 없다. 작은 숫자는 밖에 공개하지 않는다.
-- 보존: metric_daily 2년(run_retention 이 지움) · metric_counters 는 누적 숫자 한 칸씩(서비스 종료 때까지 · 개인정보 아님).
-- 두 종류를 나눈다:
--   · ever(한 번이라도 도달) — metric_counters: 상태가 처음 바뀌는 순간 트리거가 +1(계정·글이 지워져도 줄지 않음)
--       signed_up · applied(처음 제출) · approved_ever(처음 승인) · introduced(소개 공개, 쌍 단위) · mutual(서로 선택, 쌍 단위)
--       · program_started · program_completed(약속일 지나 마무리 — 실제 만남 아님) · withdrawal_requested
--       · self_report_met / self_report_not_met / self_report_skip(본인 응답, 사람 단위 · 바꾸면 옮겨 셈)
--   · current(그날 현재) — metric_daily.counts.current: 지금 승인 상태인 회원 수 등(지워진 계정은 빠진다)
--   스냅숏은 보존 정리(run_retention)가 지우기 직전과, 운영진이 원할 때 찍는다(하루 한 줄 · 같은 날은 덮어씀).

create table if not exists public.metric_counters (
  name text not null,
  cohort integer not null default -1,
  value bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (name, cohort)
);
create table if not exists public.metric_daily (
  day date primary key,
  taken_at timestamptz not null default now(),
  reason text not null,
  counts jsonb not null
);
alter table public.metric_counters enable row level security;
alter table public.metric_daily enable row level security;
revoke all on public.metric_counters, public.metric_daily from anon, authenticated;

alter table public.applications add column if not exists approved_once boolean not null default false;

create or replace function public.bump_metric(p_name text, p_cohort integer, p_delta integer default 1) returns void
language sql security definer set search_path = '' as $$
  insert into public.metric_counters (name, cohort, value) values (p_name, coalesce(p_cohort, -1), p_delta)
  on conflict (name, cohort) do update set value = public.metric_counters.value + p_delta, updated_at = now()
$$;

create or replace function public.metric_on_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then perform public.bump_metric('signed_up', null); return new; end if;
  if new.status = 'withdrawal_requested' and old.status is distinct from 'withdrawal_requested' then
    perform public.bump_metric('withdrawal_requested', (select a.cohort_number from public.applications a where a.member_id = new.id));
  end if;
  return new;
end $$;
create or replace function public.metric_on_application() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.submitted_at is not null and (tg_op = 'INSERT' or old.submitted_at is null) then perform public.bump_metric('applied', new.cohort_number); end if;
  if new.status = 'approved' and not new.approved_once then
    new.approved_once := true;
    perform public.bump_metric('approved_ever', new.cohort_number);
  end if;
  return new;
end $$;
create or replace function public.metric_on_introduction() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c int := (select a.cohort_number from public.applications a where a.member_id = new.member_a);
begin
  if new.published_at is not null and (tg_op = 'INSERT' or old.published_at is null) then perform public.bump_metric('introduced', c); end if;
  if new.mutual_at is not null and (tg_op = 'INSERT' or old.mutual_at is null) then perform public.bump_metric('mutual', c); end if;
  return new;
end $$;
create or replace function public.metric_on_program() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c int := (select a.cohort_number from public.applications a where a.member_id = new.member_a);
begin
  if new.started_at is not null and (tg_op = 'INSERT' or old.started_at is null) then perform public.bump_metric('program_started', c); end if;
  if new.status = 'closed' and new.end_reason = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'closed') then perform public.bump_metric('program_completed', c); end if;
  return new;
end $$;
create or replace function public.metric_on_reflection() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c int := (select a.cohort_number from public.applications a where a.member_id = new.member_id);
begin
  if new.met is not distinct from (case when tg_op = 'UPDATE' then old.met end) then return new; end if;
  if tg_op = 'UPDATE' and old.met is not null then perform public.bump_metric('self_report_' || old.met, c, -1); end if;
  if new.met is not null then perform public.bump_metric('self_report_' || new.met, c); end if;
  return new;
end $$;
drop trigger if exists metric_profile on public.profiles;
create trigger metric_profile after insert or update of status on public.profiles for each row execute function public.metric_on_profile();
drop trigger if exists metric_application on public.applications;
create trigger metric_application before insert or update of status, submitted_at on public.applications for each row execute function public.metric_on_application();
drop trigger if exists metric_introduction on public.introductions;
create trigger metric_introduction after insert or update of published_at, mutual_at on public.introductions for each row execute function public.metric_on_introduction();
drop trigger if exists metric_program on public.programs;
create trigger metric_program after insert or update of started_at, status on public.programs for each row execute function public.metric_on_program();
drop trigger if exists metric_reflection on public.reflections;
create trigger metric_reflection after insert or update of met on public.reflections for each row execute function public.metric_on_reflection();

-- 처음 한 번: 지금 남아 있는 자료로 누적 숫자를 채운다(이미 지워진 과거는 알 수 없어 ‘이때부터’ 기준 · backfilled 표시)
do $$
begin
  if not exists (select 1 from public.metric_counters) then
    update public.applications set approved_once = true where status = 'approved';
    insert into public.metric_counters (name, cohort, value)
    select 'signed_up', -1, count(*) from public.profiles
    union all select 'applied', coalesce(cohort_number, -1), count(*) from public.applications where submitted_at is not null group by 2
    union all select 'approved_ever', coalesce(cohort_number, -1), count(*) from public.applications where approved_once group by 2
    union all select 'introduced', coalesce(a.cohort_number, -1), count(*) from public.introductions i left join public.applications a on a.member_id = i.member_a where i.published_at is not null group by 2
    union all select 'mutual', coalesce(a.cohort_number, -1), count(*) from public.introductions i left join public.applications a on a.member_id = i.member_a where i.mutual_at is not null group by 2
    union all select 'program_started', coalesce(a.cohort_number, -1), count(*) from public.programs g left join public.applications a on a.member_id = g.member_a where g.started_at is not null group by 2
    union all select 'program_completed', coalesce(a.cohort_number, -1), count(*) from public.programs g left join public.applications a on a.member_id = g.member_a where g.status = 'closed' and g.end_reason = 'completed' group by 2
    union all select 'backfilled_at_epoch', -1, extract(epoch from now())::bigint;
  end if;
end $$;

-- 그날의 숫자 한 줄(같은 날은 덮어씀)
create or replace function public.take_metric_snapshot(p_reason text default 'manual') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur jsonb; ever jsonb; snap jsonb;
begin
  select jsonb_build_object(
    'membersActive', (select count(*) from public.profiles where status = 'active'),
    'applicationsSubmittedNow', (select count(*) from public.applications where status in ('submitted', 'reviewing')),
    'approvedNow', (select count(*) from public.applications a join public.profiles p on p.id = a.member_id where a.status = 'approved' and p.status = 'active'),
    'pausedNow', (select count(*) from public.profiles where status = 'active' and paused_at is not null),
    'introductionsOpenNow', (select count(*) from public.introductions where status in ('reserved', 'published', 'mutual')),
    'programsOpenNow', (select count(*) from public.programs where status <> 'closed'),
    'withdrawalPendingNow', (select count(*) from public.profiles where status = 'withdrawal_requested'))
    into cur;
  select coalesce(jsonb_object_agg(name || case when cohort = -1 then '' else '@' || cohort end, value), '{}'::jsonb) into ever from public.metric_counters;
  snap := jsonb_build_object('current', cur, 'ever', ever);
  insert into public.metric_daily (day, taken_at, reason, counts) values (public.kst_today(), now(), left(coalesce(p_reason, 'manual'), 40), snap)
  on conflict (day) do update set taken_at = excluded.taken_at, reason = excluded.reason, counts = excluded.counts;
  delete from public.metric_daily where day < public.kst_today() - interval '2 years';
  return snap;
end $$;

create or replace function public.admin_metric_snapshots(p_days integer default 60) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영진 권한이 필요해요.'; end if;
  perform public.take_metric_snapshot('admin');
  return jsonb_build_object(
    'definitions', jsonb_build_object('current', '그날 현재 상태(지워진 계정은 빠짐)', 'ever', '한 번이라도 도달한 누적(지워져도 줄지 않음 · 처음 적용 때 남은 자료로 채움)',
      'program_completed', '약속일 지나 마무리(실제 만남 증명 아님)', 'self_report', '본인 만남 응답(사람 단위 · 자기보고)'),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'takenAt', d.taken_at, 'reason', d.reason, 'counts', d.counts) order by d.day desc)
                        from public.metric_daily d where d.day >= public.kst_today() - make_interval(days => greatest(coalesce(p_days, 60), 1))), '[]'::jsonb));
end $$;

revoke all on function public.bump_metric(text, integer, integer), public.metric_on_profile(), public.metric_on_application(), public.metric_on_introduction(),
  public.metric_on_program(), public.metric_on_reflection(), public.take_metric_snapshot(text), public.admin_metric_snapshots(integer) from public, anon, authenticated;
grant execute on function public.admin_metric_snapshots(integer) to authenticated;

-- 보존 정리 바로 앞에서 그날 숫자를 찍는다(본문은 그대로 · 맨 앞에 한 줄)
do $$
declare def text := pg_get_functiondef('public.run_retention()'::regprocedure);
  anchor text := 'insert into public.job_runs (job) values (''retention'') returning id into run_id;';
begin
  if position(anchor in def) = 0 then raise exception 'run_retention을 바꾸지 못했어요'; end if;
  execute replace(def, anchor, anchor || '
  begin perform public.take_metric_snapshot(''retention''); exception when others then
    insert into public.job_runs (job, finished_at, ok, detail) values (''metric-snapshot'', now(), false, jsonb_build_object(''error'', left(sqlerrm, 300))); end;');
end $$;
