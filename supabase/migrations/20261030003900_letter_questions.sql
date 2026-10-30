-- A 편지 질문 묶음(2026-10-30)
--  1. 편지 질문을 여러 묶음(한 묶음 = DAY 01~03 질문 세 개와, 전날 편지가 열리지 않았을 때의 둘째·셋째 날 질문)으로 두고,
--     A 교류마다 한 묶음을 정해 programs.letter_set(0부터)에 남긴다. 질문 글은 화면(backend/program.ts LETTER_SETS)에만 있고 서버는 번호만 안다.
--     LETTER_SETS는 뒤에만 덧붙이고 순서를 바꾸지 않는다. 묶음을 늘리면 새 마이그레이션에서 letter_set_count()도 같은 수로 바꾼다.
--  2. 정하는 때: 두 분이 A로 일정을 확정해 'scheduled'가 될 때(늦어도 시작할 때). 한 번 정한 묶음은 바꾸지 않는다.
--  3. 고르는 기준(같은 상황이면 늘 같은 답):
--     두 분 중 누구도 앞서 시작한 A 교류에서 받은 적 없는 묶음 → 모두 받았다면 받아 본 사람이 적은 묶음
--     → 그중 가장 오래전에 받은 묶음 → 그중 받은 횟수가 적은 묶음 → 번호 순.
--  4. 이 마이그레이션 전에 시작한 A 교류는 기존 질문(0번 묶음)을 받았으므로 0으로 채운다. 다시 읽을 때도 그때 질문이 보인다.
--  5. my_program · my_readable_programs가 letterSet을 함께 돌려준다(20261029003000 · 20261029003300 정의 그대로에 한 칸 더).

-- ─────────────────────────────────────────────────────────
-- 1. 묶음 번호
alter table public.programs add column letter_set int check (letter_set is null or letter_set >= 0);
update public.programs set letter_set = 0
 where letter_set is null and plan_a = 'A' and plan_b = 'A' and (started_at is not null or status in ('started', 'deciding', 'arranging'));

-- 화면의 LETTER_SETS 길이와 같아야 한다.
create or replace function public.letter_set_count() returns int
language sql immutable set search_path = '' as $$ select 6 $$;

-- 두 사람에게 줄 묶음 고르기(p_program은 지금 정하는 교류라 셈에서 뺀다). 앞서 시작한 A 교류만 ‘받은 것’으로 센다.
create or replace function public.pick_letter_set(p_a uuid, p_b uuid, p_program uuid) returns int
language sql stable security definer set search_path = '' as $$
  select s.n from generate_series(0, public.letter_set_count() - 1) s(n)
    cross join lateral (
      select count(distinct m.id) seen_by, count(*) uses, max(coalesce(p.started_at, p.created_at)) last_at
        from public.programs p cross join lateral unnest(array[p.member_a, p.member_b]) m(id)
       where p.id is distinct from p_program and p.letter_set = s.n
         and (p.started_at is not null or p.status in ('started', 'deciding', 'arranging'))
         and m.id in (p_a, p_b)
    ) u
   order by u.seen_by, u.last_at nulls first, u.uses, s.n
   limit 1
$$;

-- A 일정이 정해지거나 시작될 때 아직 묶음이 없으면 정한다(confirm_program · 시작 작업 · 운영진 수정 어디서 바뀌어도).
create or replace function public.assign_letter_set() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.letter_set := public.pick_letter_set(new.member_a, new.member_b, new.id);
  return new;
end $$;

create trigger programs_letter_set before insert or update on public.programs
  for each row when (new.letter_set is null and new.plan_a = 'A' and new.plan_b = 'A' and new.status in ('scheduled', 'started', 'deciding', 'arranging'))
  execute function public.assign_letter_set();

-- 이미 일정이 정해져 시작을 기다리는 A 교류는 지금 정해 둔다.
update public.programs set letter_set = public.pick_letter_set(member_a, member_b, id)
 where letter_set is null and plan_a = 'A' and plan_b = 'A' and status = 'scheduled';

-- ─────────────────────────────────────────────────────────
-- 2. 내 교류 · 지난 교류 다시 읽기: letterSet을 함께 돌려준다.
create or replace function public.my_program() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); is_a boolean; partner uuid; i public.introductions; today date := public.kst_date(public.app_now());
  own_plan text; partner_plan text; proposals jsonb; released boolean; phone text; day_now int; name text; readable boolean;
begin
  if me is null then return null; end if;
  p := public.my_program_row();
  if p.id is null then return null; end if;
  is_a := p.member_a = me; partner := public.program_partner(p, me);
  own_plan := case when is_a then p.plan_a else p.plan_b end;
  partner_plan := case when is_a then p.plan_b else p.plan_a end;
  select * into i from public.introductions where id = p.introduction_id;
  select x ->> 'value' into name from jsonb_array_elements(case when is_a then i.snapshot_b else i.snapshot_a end -> 'items') x where x ->> 'id' = 'self.name';
  if p.status = 'closed' then
    -- 마무리된 교류: 다시 읽을 수 있을 때만 글과 상대 이름을 함께 돌려준다.
    readable := public.program_readable(p, me);
    return jsonb_build_object('id', p.id, 'introductionId', p.introduction_id, 'status', p.status, 'endReason', p.end_reason, 'closedAt', p.closed_at,
      'today', today, 'entries', case when readable then public.program_entries_json(p.id, me, partner) else '[]'::jsonb end, 'proposals', '[]'::jsonb,
      'meetingOn', p.meeting_on, 'ownContact', false, 'contactReleased', false)
      || case when readable then jsonb_build_object('partnerName', name, 'ownPlan', own_plan, 'partnerPlan', partner_plan, 'startOn', p.start_on,
           'readableUntil', p.closed_at + interval '30 days', 'letterSet', p.letter_set) else '{}'::jsonb end;
  end if;
  day_now := case when p.status = 'started' and today between p.start_on and p.start_on + 2 then today - p.start_on + 1 end;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'mine', a.author = me, 'slots', a.slots, 'activity', a.activity, 'region', a.region, 'place', a.place, 'note', a.note,
           'status', a.status, 'selected', a.selected, 'acceptedAt', a.accepted_at, 'createdAt', a.created_at) order by a.created_at desc), '[]'::jsonb) into proposals
    from public.appointment_proposals a where a.program_id = p.id and a.status in ('open', 'accepted');
  released := p.status = 'arranging' and p.meeting_on is not null and p.contact_a is not null and p.contact_b is not null
              and public.app_now() >= public.kst_at(p.meeting_on, '00:00') and public.app_now() < public.kst_at(p.meeting_on + 2, '00:00');
  if released then
    select a.draft -> 'values' ->> 'self.phone' into phone from public.applications a where a.member_id = partner;
  end if;
  return jsonb_build_object(
    'id', p.id, 'introductionId', p.introduction_id, 'status', p.status, 'endReason', p.end_reason, 'closedAt', p.closed_at, 'partnerName', name,
    'ownPlan', own_plan, 'partnerPlan', partner_plan, 'startOn', p.start_on, 'agreeBy', p.agree_by,
    'ownConfirmed', (case when is_a then p.confirm_a else p.confirm_b end) is not null,
    'partnerConfirmed', (case when is_a then p.confirm_b else p.confirm_a end) is not null,
    'startedAt', p.started_at, 'today', today, 'day', day_now,
    'letterSet', p.letter_set,
    'entries', public.program_entries_json(p.id, me, partner),
    'meetingOpensAt', case when p.start_on is not null then public.kst_at(p.start_on + 3, '09:00') end,
    'meetingBy', p.meeting_by,
    'ownMeeting', case when is_a then p.meeting_a else p.meeting_b end,
    'arrangeBy', p.arrange_by, 'meetingOn', p.meeting_on, 'meetingTime', p.meeting_time,
    'proposals', proposals,
    'ownContact', (case when is_a then p.contact_a else p.contact_b end) is not null,
    'contactReleaseAt', case when p.meeting_on is not null then public.kst_at(p.meeting_on, '00:00') end,
    'contactUntil', case when p.meeting_on is not null then public.kst_at(p.meeting_on + 2, '00:00') - interval '1 second' end,
    'contactReleased', released,
    'partnerPhone', phone
  );
end $$;

create or replace function public.my_readable_programs() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'introductionId', p.introduction_id, 'status', p.status, 'endReason', p.end_reason, 'closedAt', p.closed_at,
           'partnerName', (select x ->> 'value' from public.introductions i
                             cross join lateral jsonb_array_elements(coalesce(case when p.member_a = auth.uid() then i.snapshot_b else i.snapshot_a end -> 'items', '[]'::jsonb)) x
                            where i.id = p.introduction_id and x ->> 'id' = 'self.name' limit 1),
           'ownPlan', case when p.member_a = auth.uid() then p.plan_a else p.plan_b end,
           'partnerPlan', case when p.member_a = auth.uid() then p.plan_b else p.plan_a end,
           'startOn', p.start_on, 'meetingOn', p.meeting_on, 'today', public.kst_date(public.app_now()),
           'readableUntil', p.closed_at + interval '30 days',
           'letterSet', p.letter_set,
           'entries', public.program_entries_json(p.id, auth.uid(), public.program_partner(p, auth.uid()))
         ) order by p.closed_at desc), '[]'::jsonb)
    from public.programs p
   where auth.uid() is not null and auth.uid() in (p.member_a, p.member_b) and public.program_readable(p, auth.uid())
$$;

-- ─────────────────────────────────────────────────────────
-- 권한
revoke all on function public.letter_set_count(), public.pick_letter_set(uuid, uuid, uuid), public.assign_letter_set() from public, anon, authenticated;
revoke all on function public.my_program(), public.my_readable_programs() from public, anon;
grant execute on function public.my_program(), public.my_readable_programs() to authenticated;
