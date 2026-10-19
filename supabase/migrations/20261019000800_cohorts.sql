-- 기수제(V6-cohort-01)
--  - 기수마다 시작일(정오 첫 소개)·신청 마감·성별 최소/최대 인원을 둔다. 운영진이 언제든 바꿀 수 있다.
--  - 기본 규칙: 매달 마지막 날 시작, 신청 마감은 시작 4일 전, 최소 10명·최대 50명(성별마다).
--  - 신청서를 제출하면 지금 받는 기수 중 그 성별 자리가 남은 가장 이른 기수에 배정한다. 없으면 다음 기수를 만든다.
--  - 소개는 그 회원 기수의 시작일 정오부터만 예약할 수 있다. 모인 인원은 운영진만 본다.

create table public.cohorts (
  number int primary key check (number > 0),
  starts_on date not null,
  application_deadline date not null,
  min_per_gender int not null default 10 check (min_per_gender >= 0),
  max_per_gender int not null default 50 check (max_per_gender > 0),
  closed_genders text[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (application_deadline <= starts_on),
  check (min_per_gender <= max_per_gender)
);
alter table public.cohorts enable row level security;
revoke all on public.cohorts from anon, authenticated;

insert into public.cohorts (number, starts_on, application_deadline) values
  (1, '2026-12-31', '2026-12-27'),
  (2, '2027-01-31', '2027-01-27');

alter table public.applications add column cohort_number int references public.cohorts (number);

-- 매달 마지막 날 규칙으로 다음 기수를 만든다.
create or replace function public.ensure_next_cohort() returns int
language plpgsql security definer set search_path = '' as $$
declare last_row public.cohorts; next_start date;
begin
  select * into last_row from public.cohorts order by number desc limit 1;
  next_start := (date_trunc('month', last_row.starts_on) + interval '2 months' - interval '1 day')::date;
  insert into public.cohorts (number, starts_on, application_deadline, min_per_gender, max_per_gender)
  values (last_row.number + 1, next_start, next_start - 4, last_row.min_per_gender, last_row.max_per_gender);
  return last_row.number + 1;
end $$;

-- 성별 인원(제출 이후 단계만 센다: 접수·검토 중·보완 요청·승인·보류)
create or replace function public.cohort_count(p_number int, p_gender text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.applications a
   where a.cohort_number = p_number and a.status in ('submitted', 'reviewing', 'needs_changes', 'approved', 'held')
     and a.draft -> 'values' ->> 'self.gender' = p_gender
$$;

-- 지금 신청하면 들어갈 기수(성별 자리 기준). 자리가 있는 기수가 없으면 새로 만든다.
create or replace function public.assign_cohort(p_gender text) returns int
language plpgsql security definer set search_path = '' as $$
declare c public.cohorts; tries int := 0;
begin
  loop
    for c in select * from public.cohorts where application_deadline >= public.kst_today() order by number loop
      if not (p_gender = any (c.closed_genders)) and public.cohort_count(c.number, p_gender) < c.max_per_gender then
        return c.number;
      end if;
    end loop;
    perform public.ensure_next_cohort();
    tries := tries + 1;
    if tries > 24 then raise exception '배정할 기수를 찾지 못했어요.'; end if;
  end loop;
end $$;

-- 제출할 때 기수를 배정한다(이미 배정됐으면 그대로).
create or replace function public.assign_cohort_on_submit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'submitted' and new.cohort_number is null then
    new.cohort_number := public.assign_cohort(coalesce(new.draft -> 'values' ->> 'self.gender', ''));
  end if;
  return new;
end $$;
create trigger applications_assign_cohort before update of status on public.applications
  for each row execute function public.assign_cohort_on_submit();

-- 공개용: 지금 신청하면 들어가는 기수의 번호와 날짜만(인원은 주지 않는다)
create or replace function public.public_cohort() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('number', number, 'startsOn', starts_on, 'applicationDeadline', application_deadline)
    from public.cohorts where application_deadline >= public.kst_today() order by number limit 1
$$;

-- 회원용: 내 기수의 번호와 날짜
create or replace function public.my_cohort() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('number', c.number, 'startsOn', c.starts_on, 'applicationDeadline', c.application_deadline)
    from public.applications a join public.cohorts c on c.number = a.cohort_number
   where a.member_id = auth.uid()
$$;

-- 운영진: 기수별 모집 현황(성별·단계·나이대·지역)
create or replace function public.admin_cohort_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'number', c.number, 'startsOn', c.starts_on, 'applicationDeadline', c.application_deadline,
      'minPerGender', c.min_per_gender, 'maxPerGender', c.max_per_gender, 'closedGenders', c.closed_genders, 'note', c.note,
      'counts', (select coalesce(jsonb_object_agg(g.gender, g.stats), '{}'::jsonb) from (
          select a.draft -> 'values' ->> 'self.gender' as gender,
                 jsonb_build_object('total', count(*), 'approved', count(*) filter (where a.status = 'approved'),
                   'reviewing', count(*) filter (where a.status in ('submitted', 'reviewing')),
                   'needsChanges', count(*) filter (where a.status = 'needs_changes'),
                   'held', count(*) filter (where a.status = 'held')) as stats
            from public.applications a join public.profiles p on p.id = a.member_id and p.status = 'active'
           where a.cohort_number = c.number and a.status in ('submitted', 'reviewing', 'needs_changes', 'approved', 'held')
           group by 1) g),
      'ages', (select coalesce(jsonb_object_agg(b.band, b.n), '{}'::jsonb) from (
          select case when age < 25 then '19~24' when age < 30 then '25~29' when age < 35 then '30~34' when age < 40 then '35~39' else '40+' end as band, count(*) as n
            from (select public.age_from(a.draft -> 'values' ->> 'self.birthDate') as age from public.applications a
                   where a.cohort_number = c.number and a.status in ('submitted', 'reviewing', 'needs_changes', 'approved', 'held')) x
           where age is not null group by 1) b),
      'regions', (select coalesce(jsonb_object_agg(r.province, r.n), '{}'::jsonb) from (
          select a.draft -> 'values' ->> 'self.province' as province, count(*) as n from public.applications a
           where a.cohort_number = c.number and a.status in ('submitted', 'reviewing', 'needs_changes', 'approved', 'held')
           group by 1) r)
    ) order by c.number)
    from public.cohorts c
  ), '[]'::jsonb);
end $$;

-- 운영진: 기수 날짜·인원 바꾸기, 성별 마감, 다음 기수 만들기, 회원 기수 옮기기
create or replace function public.admin_update_cohort(p_number int, p_starts_on date, p_deadline date, p_min int, p_max int, p_closed text[], p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_deadline > p_starts_on then raise exception '신청 마감은 시작일보다 늦을 수 없어요.'; end if;
  if p_min > p_max then raise exception '최소 인원이 최대 인원보다 많아요.'; end if;
  update public.cohorts set starts_on = p_starts_on, application_deadline = p_deadline, min_per_gender = p_min, max_per_gender = p_max,
         closed_genders = coalesce(p_closed, '{}'), note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
   where number = p_number;
  if not found then raise exception '기수를 찾을 수 없어요.'; end if;
  perform public.write_audit('기수 설정 변경 · ' || p_number || '기', p_number::text, p_starts_on || ' 시작 · 마감 ' || p_deadline || ' · ' || p_min || '~' || p_max);
end $$;

create or replace function public.admin_create_next_cohort() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  n := public.ensure_next_cohort();
  perform public.write_audit('기수 추가 · ' || n || '기', n::text);
  return n;
end $$;

create or replace function public.admin_move_member_cohort(p_member uuid, p_number int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if not exists (select 1 from public.cohorts where number = p_number) then raise exception '기수를 찾을 수 없어요.'; end if;
  update public.applications set cohort_number = p_number, updated_at = now() where member_id = p_member;
  if not found then raise exception '신청서를 찾을 수 없어요.'; end if;
  perform public.write_audit('회원 기수 이동 · ' || p_number || '기', p_member::text);
end $$;

-- 소개 예약: 두 사람 모두 기수 시작일 이후 정오에만
create or replace function public.check_intro_cohort() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m uuid; starts date;
begin
  foreach m in array array[new.member_a, new.member_b] loop
    select c.starts_on into starts from public.applications a join public.cohorts c on c.number = a.cohort_number where a.member_id = m;
    if starts is not null and (new.reveal_at at time zone 'Asia/Seoul')::date < starts then
      raise exception '기수 시작일(%) 전에는 소개를 예약할 수 없어요.', starts;
    end if;
  end loop;
  return new;
end $$;
create trigger introductions_cohort_start before insert on public.introductions
  for each row execute function public.check_intro_cohort();

-- 기수 시작 전날 정오: 그 기수의 승인된 회원에게 ‘내일 정오에 첫 소개’ 알림
create or replace function public.run_cohort_eve() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select a.member_id, c.number from public.applications a join public.cohorts c on c.number = a.cohort_number
            join public.profiles p on p.id = a.member_id and p.status = 'active'
           where a.status = 'approved' and c.starts_on = public.kst_today() + 1 loop
    perform public.notify(r.member_id, 'cohort-eve', r.number || '기 첫 소개가 내일 정오에 도착해요', '잘 맞는 분을 준비해 두었어요. 내일 정오에 오늘 화면에서 확인해 주세요.', '/today', 'cohort-eve:' || r.number || ':' || r.member_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- 관리자 신청서 목록에 기수 번호를 함께 준다
drop function public.admin_list_applications(text);
create or replace function public.admin_list_applications(p_status text default null) returns table (
  member_id uuid, status text, submitted_at timestamptz, updated_at timestamptz, name text, gender text, desired text,
  province text, area text, age int, source text, photo_count int, photo_requests int, cohort int
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return query
    select a.member_id, a.status, a.submitted_at, a.updated_at,
           a.draft -> 'values' ->> 'self.name', a.draft -> 'values' ->> 'self.gender', a.draft -> 'values' ->> 'desired.gender',
           a.draft -> 'values' ->> 'self.province', a.draft -> 'values' ->> 'self.area',
           public.age_from(a.draft -> 'values' ->> 'self.birthDate'), a.draft -> 'values' ->> 'self.source',
           (select count(*)::int from public.application_photos p where p.member_id = a.member_id),
           (select count(*)::int from public.application_photos p where p.member_id = a.member_id and p.review = '재등록 요청'),
           a.cohort_number
      from public.applications a
      join public.profiles pr on pr.id = a.member_id and pr.status = 'active'
     where (p_status is null and a.status <> 'draft') or a.status = p_status
     order by a.submitted_at nulls last;
end $$;

revoke all on function public.ensure_next_cohort(), public.cohort_count(int, text), public.assign_cohort(text), public.assign_cohort_on_submit(),
  public.check_intro_cohort(), public.run_cohort_eve() from public, anon, authenticated;
revoke all on function public.public_cohort() from public;
grant execute on function public.public_cohort() to anon, authenticated;
revoke all on function public.my_cohort(), public.admin_cohort_overview(), public.admin_update_cohort(int, date, date, int, int, text[], text),
  public.admin_create_next_cohort(), public.admin_move_member_cohort(uuid, int), public.admin_list_applications(text) from public, anon;
grant execute on function public.my_cohort(), public.admin_cohort_overview(), public.admin_update_cohort(int, date, date, int, int, text[], text),
  public.admin_create_next_cohort(), public.admin_move_member_cohort(uuid, int), public.admin_list_applications(text) to authenticated;
