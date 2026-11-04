-- 5500: GPT 1차 검수 대응 ② — 참가자 확인(C11) · 약속 판과 동의(C1) · 약속 마감·잠금 순서·시작 장애 복구(C13) · 한 번에 한 사람(C4)
--
-- C11 `me not in (p.member_a, p.member_b)`는 한 분이 탈퇴해 비어(NULL) 있으면 거짓이 아니라 ‘모름’이 되어 제삼자를 통과시켰다.
--     참가자 확인을 not_participant() 하나로 모으고, 서버 함수 전부에서 같은 꼴의 비교를 바꾼다(남아 있으면 마이그레이션이 실패한다).
-- C1  연락처 동의·교류 시작일 확인이 ‘회원이 보고 있던 약속·날짜’와 묶여 있지 않아, 바뀐 뒤 예전 화면에서 누른 동의가 새 약속에 붙었다.
--     programs.meeting_rev(약속이 바뀔 때마다 오름)를 화면에 주고(meetingRev), 동의는 그 판과 같을 때만 받는다. 시작일 확인은 본 날짜를 함께 받는다.
-- C13 약속 수락이 정하기 기한을 보지 않았고(예약 작업이 닫기 전까지 통과), 잠금 순서가 함수마다 달랐다(교류 → 제안으로 통일).
--     시작 작업이 멈췄다 돌아오면 미시작 교류가 한 번에 ‘만남 무응답’으로 끝났다 → 시작일을 놓친 교류는 새 시작일을 두 분께 다시 확인받고,
--     늦게 열린 만남 선택은 지금부터 24시간을 준다.
-- C4  ‘한 번에 한 사람’을 함수의 검사만으로 지키고 있어 동시에 두 예약이 통과할 수 있었다. 두 회원 행을 같은 순서로 잠근 뒤 검사하고,
--     소개를 넣는 모든 경로에서 DB 트리거가 같은 검사를 한 번 더 한다.

-- ── C11
create or replace function public.not_participant(p_me uuid, p_a uuid, p_b uuid) returns boolean
language sql immutable set search_path = '' as $$
  select p_me is null or (p_me is distinct from p_a and p_me is distinct from p_b)
$$;
revoke all on function public.not_participant(uuid, uuid, uuid) from public, anon, authenticated;

do $$
declare fn record; def text; patched text;
begin
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosrc ~* 'not in \(\s*\w+\.member_a\s*,\s*\w+\.member_b\s*\)' loop
    def := pg_get_functiondef(fn.oid);
    patched := regexp_replace(def, '(\w+) not in \((\w+)\.member_a, \2\.member_b\)', 'public.not_participant(\1, \2.member_a, \2.member_b)', 'gi');
    if patched = def then raise exception '참가자 확인을 바꾸지 못한 함수가 있어요: %', fn.oid::regprocedure; end if;
    execute patched;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosrc ~* 'not in \(\s*\w+\.member_a\s*,\s*\w+\.member_b\s*\)') then
    raise exception '‘not in (참가자)’ 비교가 남은 서버 함수가 있어요';
  end if;
end $$;

-- 다시 읽기: 그 교류의 참가자만(탈퇴로 비어 있는 쪽이 있어도 제삼자는 아님)
create or replace function public.program_readable(p public.programs, p_me uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not public.not_participant(p_me, p.member_a, p.member_b)
     and p.status = 'closed' and p.meeting_a = 'positive' and p.meeting_b = 'positive'
     and coalesce(p.end_reason, '') in ('completed', 'arrange-expired') and p.closed_at > now() - interval '30 days'
     and exists (select 1 from public.profiles w where w.id = public.program_partner(p, p_me) and w.status = 'active')
     and not exists (select 1 from public.blocks b
                      where (b.member_id = p_me and b.blocked_id = public.program_partner(p, p_me))
                         or (b.blocked_id = p_me and b.member_id = public.program_partner(p, p_me)))
$$;

-- ── C1: 약속 판
alter table public.programs add column if not exists meeting_rev int not null default 0,
  add column if not exists contact_a_rev int, add column if not exists contact_b_rev int,
  add column if not exists start_missed_at timestamptz;

create or replace function public.bump_meeting_rev() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.meeting_on is distinct from old.meeting_on or new.meeting_time is distinct from old.meeting_time then
    new.meeting_rev := old.meeting_rev + 1;
  end if;
  return new;
end $$;
drop trigger if exists programs_meeting_rev on public.programs;
create trigger programs_meeting_rev before update of meeting_on, meeting_time on public.programs for each row execute function public.bump_meeting_rev();

-- 약속 제안이 새로 오거나 정해지거나 바뀌면(활동·지역·장소가 바뀌는 경우 포함) 판을 올린다.
create or replace function public.bump_meeting_rev_on_proposal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.programs set meeting_rev = meeting_rev + 1 where id = new.program_id;
  return null;
end $$;
drop trigger if exists appointment_proposals_meeting_rev on public.appointment_proposals;
create trigger appointment_proposals_meeting_rev after insert or update on public.appointment_proposals for each row execute function public.bump_meeting_rev_on_proposal();
revoke all on function public.bump_meeting_rev(), public.bump_meeting_rev_on_proposal() from public, anon, authenticated;

-- 연락처 공개 동의: 보고 있던 약속 판과 같을 때만 받고, 어느 판에 대한 동의인지 남긴다.
drop function if exists public.set_contact_consent(uuid, boolean);
create or replace function public.set_contact_consent(p_program uuid, p_allowed boolean, p_meeting_rev int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid();
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or public.not_participant(me, p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'arranging' or p.meeting_on is null then raise exception '약속이 정해진 뒤에 고를 수 있어요.'; end if;
  if p_meeting_rev is null then raise exception '화면을 새로 고친 뒤 다시 눌러 주세요.'; end if;
  if p_meeting_rev <> p.meeting_rev then raise exception '약속이 바뀌었어요. 새 날짜와 장소를 확인한 뒤 다시 동의해 주세요.'; end if;
  if public.app_now() >= public.kst_at(p.meeting_on + 2, '00:00') then raise exception '연락처 공개 기간이 지났어요.'; end if;
  if not p_allowed and public.app_now() >= public.kst_at(p.meeting_on, '00:00') and p.contact_a is not null and p.contact_b is not null then
    raise exception '이미 열린 연락처는 거둘 수 없어요. 불편한 일이 있으면 신고해 주세요.';
  end if;
  if p.member_a = me then
    update public.programs set contact_a = case when p_allowed then coalesce(contact_a, now()) end, contact_a_rev = case when p_allowed then p.meeting_rev end, updated_at = now() where id = p.id;
  else
    update public.programs set contact_b = case when p_allowed then coalesce(contact_b, now()) end, contact_b_rev = case when p_allowed then p.meeting_rev end, updated_at = now() where id = p.id;
  end if;
  return public.my_program();
end $$;
revoke all on function public.set_contact_consent(uuid, boolean, int) from public, anon;
grant execute on function public.set_contact_consent(uuid, boolean, int) to authenticated;

-- 교류 시작일 확인: 보고 있던 시작일과 같을 때만(날짜가 지나 하루 미뤄지는 경우는 그 안내와 함께 그대로)
drop function if exists public.confirm_program(uuid);
create or replace function public.confirm_program(p_program uuid, p_start_on date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); today date := public.kst_date(public.app_now()); partner uuid; partner_ready boolean;
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or public.not_participant(me, p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'choosing' or public.app_now() >= p.agree_by then raise exception '지금은 확인할 수 없어요.'; end if;
  if p.plan_a is null or p.plan_a is distinct from p.plan_b or p.start_on is null then raise exception '같은 방식과 시작일이 먼저 필요해요.'; end if;
  if p_start_on is null then raise exception '화면을 새로 고친 뒤 다시 눌러 주세요.'; end if;
  if p_start_on is distinct from p.start_on then raise exception '시작 날짜가 바뀌었어요. 새 날짜를 확인해 주세요.'; end if;
  partner := public.program_partner(p, me);
  -- 상대가 이 방식으로 ‘이대로 시작’을 눌러 두었으면 상대 확인도 함께 남긴다.
  partner_ready := (case when p.member_a = me then p.ready_b else p.ready_a end) is not distinct from p.plan_a;
  if p.start_on <= today then
    -- 날짜가 지나 하루 미뤄진다: 누른 사람의 확인은 남기고, 상대에게 새 날짜를 다시 확인해 달라고 알린다(상대가 ‘이대로’를 눌러 두었다면 함께 확인).
    update public.programs set start_on = today + 1,
           confirm_a = case when member_a = me or (partner_ready and member_a = partner) then now() end,
           confirm_b = case when member_b = me or (partner_ready and member_b = partner) then now() end, updated_at = now()
     where id = p.id;
    if public.program_schedule_if_ready(p.id) then
      return public.my_program() || jsonb_build_object('notice', '두 분 모두 확인했어요. ' || to_char(today + 1, 'FMMM"월" FMDD"일"') || ' 09:00에 첫날이 열려요.');
    end if;
    if partner is not null then
      perform public.notify(partner, 'program-date', '교류 시작일이 하루 미뤄졌어요', to_char(today + 1, 'FMMM"월" FMDD"일"') || ' 09:00 시작으로 바뀌었어요. 상대는 확인했어요. 내 확인만 남았어요.', '/exchange', 'date:' || p.id || ':roll:' || (today + 1));
    end if;
    return public.my_program() || jsonb_build_object('notice', '시작일이 지나 내일 09:00 시작으로 바꾸고 확인해 두었어요. 상대의 확인만 남았어요.');
  end if;
  update public.programs set confirm_a = case when member_a = me or (partner_ready and member_a = partner) then coalesce(confirm_a, now()) else confirm_a end,
         confirm_b = case when member_b = me or (partner_ready and member_b = partner) then coalesce(confirm_b, now()) else confirm_b end, updated_at = now()
   where id = p.id returning * into p;
  if public.program_schedule_if_ready(p.id) then return public.my_program(); end if;
  if partner is not null then
    perform public.notify(partner, 'program-confirm', '상대가 교류 일정을 확인했어요', '내 확인만 남았어요.', '/exchange', 'confirm:' || p.id || ':' || me || ':' || p.start_on);
  end if;
  return public.my_program();
end $$;
revoke all on function public.confirm_program(uuid, date) from public, anon;
grant execute on function public.confirm_program(uuid, date) to authenticated;

-- ‘이대로 시작’은 지금 정해진 시작일로 확인한다.
do $$
declare def text := pg_get_functiondef('public.quick_start_program(uuid, text)'::regprocedure);
begin
  if position('perform public.confirm_program(p_program);' in def) = 0 then raise exception 'quick_start_program을 바꾸지 못했어요'; end if;
  execute replace(def, 'perform public.confirm_program(p_program);', 'perform public.confirm_program(p_program, p.start_on);');
end $$;

-- 약속 수락: 교류 → 제안 순서로 잠그고, 최신 제안인지·정하기 기한 안인지 서버 시각으로 확인한다.
create or replace function public.accept_appointment(p_proposal uuid, p_slot int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointment_proposals; p public.programs; me uuid := auth.uid(); s jsonb; pid uuid;
begin
  select x.program_id into pid from public.appointment_proposals x where x.id = p_proposal;
  if pid is null then raise exception '약속 제안을 찾을 수 없어요.'; end if;
  select * into p from public.programs where id = pid for update;
  select * into a from public.appointment_proposals where id = p_proposal for update;
  if public.not_participant(me, p.member_a, p.member_b) then raise exception '약속 제안을 찾을 수 없어요.'; end if;
  if a.author = me then raise exception '내가 보낸 제안은 상대가 골라야 해요.'; end if;
  if a.status <> 'open' or p.status <> 'arranging'
     or exists (select 1 from public.appointment_proposals x where x.program_id = p.id and x.id <> a.id and x.created_at > a.created_at) then
    raise exception '이미 정해졌거나 바뀐 제안이에요.';
  end if;
  if p.meeting_on is null and public.app_now() >= p.arrange_by then raise exception '약속을 정할 기한이 지났어요. 이번 교류는 곧 마무리돼요.'; end if;
  if p.meeting_on is not null and public.app_now() >= public.kst_at(p.meeting_on, '00:00') then raise exception '만나는 날이 되어 약속을 바꿀 수 없어요. 일정이 어려우면 문의해 주세요.'; end if;
  s := a.slots -> p_slot;
  if s is null then raise exception '후보 시간을 하나 골라 주세요.'; end if;
  if (s ->> 'date')::date <= public.kst_date(public.app_now()) then raise exception '지난 날짜예요. 새 시간을 제안해 주세요.'; end if;
  update public.appointment_proposals set status = 'replaced' where program_id = p.id and status = 'accepted';
  update public.appointment_proposals set status = 'accepted', selected = s, accepted_at = now() where id = a.id;
  -- 약속이 바뀌면 연락처 동의도 새 약속 기준으로 다시 받는다.
  update public.programs set meeting_on = (s ->> 'date')::date, meeting_time = (s ->> 'start') || '~' || (s ->> 'end'),
         contact_a = null, contact_b = null, contact_a_rev = null, contact_b_rev = null, updated_at = now() where id = p.id;
  perform public.notify(m, 'appointment-final', '약속이 정해졌어요', to_char((s ->> 'date')::date, 'FMMM"월" FMDD"일"') || ' ' || (s ->> 'start') || ' · ' || a.activity || ' · ' || a.region, '/meeting', 'final:' || a.id || ':' || m)
    from unnest(array[p.member_a, p.member_b]) m where m is not null;
  return public.my_program();
end $$;

-- 바로 정하기도 동의 판을 함께 지운다.
do $$
declare def text := pg_get_functiondef('public.book_meeting_slot(uuid, text, text, text, text)'::regprocedure);
begin
  if position('contact_a = null, contact_b = null, updated_at = now() where id = p.id;' in def) = 0 then raise exception 'book_meeting_slot을 바꾸지 못했어요'; end if;
  execute replace(def, 'contact_a = null, contact_b = null, updated_at = now() where id = p.id;', 'contact_a = null, contact_b = null, contact_a_rev = null, contact_b_rev = null, updated_at = now() where id = p.id;');
end $$;

-- 화면에 약속 판과 ‘시작이 밀린 교류’ 표시를 함께 준다.
do $$
declare def text := pg_get_functiondef('public.my_program()'::regprocedure);
begin
  if position('''partnerPhone'', phone' in def) = 0 then raise exception 'my_program을 바꾸지 못했어요'; end if;
  execute replace(def, '''partnerPhone'', phone', '''partnerPhone'', phone, ''meetingRev'', p.meeting_rev, ''startMissedAt'', p.start_missed_at');
end $$;

-- ── C13: 예약 작업(10분마다)
CREATE OR REPLACE FUNCTION public.run_programs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; t timestamptz := public.app_now(); d int; n jsonb := '{}'::jsonb; c int := 0; missed int := 0;
begin
  begin
  for r in select * from public.programs where status = 'choosing' and agree_by <= t for update skip locked loop
    continue when r.status <> 'choosing';
    perform public.close_program(r.id, 'agreement-expired');
    perform public.notify(m, 'program-closed', '교류 방식이 정해지지 않았어요', '합의 기한(48시간)이 지나 이번 소개는 여기서 마무리돼요. 다음 소개를 준비할게요.', '/today', 'pclosed:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m where m is not null;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('expired', c); c := 0;
  for r in select * from public.programs where status = 'scheduled' and t >= public.kst_at(start_on, '09:00') for update skip locked loop
    continue when r.status <> 'scheduled';
    if public.kst_date(t) > r.start_on then
      -- 시작 작업이 멈춰 시작일을 통째로 놓쳤다: 회원의 무응답으로 끝내지 않고, 새 시작일을 두 분께 다시 확인받는다(운영진에게도 알린다).
      update public.programs set status = 'choosing', start_on = public.kst_date(t) + 1, confirm_a = null, confirm_b = null, ready_a = null, ready_b = null,
             agree_by = t + interval '48 hours', start_missed_at = t, updated_at = now()
       where id = r.id;
      perform public.notify(m, 'program-missed', '교류 시작이 늦어졌어요', '저희 쪽 문제로 정해 둔 날 교류가 열리지 못했어요. 죄송해요. 새 시작일을 확인해 주세요.', '/exchange', 'missed:' || r.id || ':' || m)
        from unnest(array[r.member_a, r.member_b]) m where m is not null;
      perform public.notify(ar.user_id, 'admin-program', '열리지 못한 교류가 있어요', '시작 작업이 멈춰 교류가 정해 둔 날 열리지 못했어요. 두 분께 새 시작일 확인을 요청했어요. 작업 기록을 확인해 주세요.', '/admin', 'missed:' || r.id || ':' || ar.user_id)
        from public.admin_roles ar where ar.role in ('owner', 'operator');
      missed := missed + 1;
      continue;
    end if;
    update public.programs set status = 'started', started_at = t, updated_at = now() where id = r.id and status = 'scheduled';
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('started', c, 'missed', missed); c := 0;
  for r in select * from public.programs where status = 'started' loop
    for d in 1..3 loop
      if t >= public.kst_at(r.start_on + d - 1, '09:00') and public.kst_date(t) = r.start_on + d - 1 then
        perform public.notify(m, 'program-day', 'DAY0' || d || '이 열렸어요', case when d > 1 and (select count(*) from public.program_entries e where e.program_id = r.id and e.day = d - 1 and e.kind in ('letter', 'scene')) = 2 then case when r.plan_a = 'A' then '어제 편지가 함께 열렸어요. ' else '어제 첫 장면 답이 함께 열렸어요. ' end else '' end || case when r.plan_a = 'A' then '오늘의 편지를 23:59까지 보내 주세요.' else '오늘의 첫 장면 질문에 23:59까지 답해 주세요.' end, '/exchange', 'day:' || r.id || ':' || d || ':' || m)
          from unnest(array[r.member_a, r.member_b]) m where m is not null;
      end if;
    end loop;
    if t >= public.kst_at(r.start_on + 3, '09:00') then
      -- 만남 선택은 늦게 열렸더라도 지금부터 24시간을 준다(작업이 밀려도 회원이 고를 시간을 잃지 않게).
      update public.programs set status = 'deciding', meeting_by = greatest(public.kst_at(r.start_on + 3, '09:00') + interval '24 hours', t + interval '24 hours'), updated_at = now() where id = r.id and status = 'started';
      perform public.notify(m, 'meeting-open', '만남을 정할 시간이에요', case when (select count(*) from public.program_entries e where e.program_id = r.id and e.day = 3 and e.kind in ('letter', 'scene')) = 2 then 'DAY03 글도 함께 열렸어요. ' else '' end || '내일 09:00까지 만나고 싶은지 골라 주세요. 상대의 답은 알려 드리지 않아요.', '/exchange', 'decide:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m where m is not null;
      c := c + 1;
    end if;
  end loop;
  n := n || jsonb_build_object('deciding', c); c := 0;
  for r in select * from public.programs where status = 'deciding' and meeting_by <= t for update skip locked loop
    continue when r.status <> 'deciding';
    perform public.close_program(r.id, case when r.meeting_a is not null and r.meeting_b is not null then 'meeting-declined' else 'meeting-nonresponse' end);
    perform public.notify(m, 'program-closed', '이번 교류는 여기서 마무리됐어요',
      case when r.meeting_a is not null and r.meeting_b is not null then '누가 어떤 답을 했는지는 알려 드리지 않아요. 다음 소개를 준비할게요.'
           when (case when m = r.member_a then r.meeting_a else r.meeting_b end) is null then '만남 선택 기한이 지났어요. 다음 소개를 준비할게요.' else '상대의 만남 선택이 기한 안에 오지 않았어요. 다음 소개를 준비할게요.' end,
      '/today', 'pclosed:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m where m is not null;
    c := c + 1;
  end loop;
  for r in select * from public.programs where status = 'arranging' and meeting_on is null and arrange_by <= t for update skip locked loop
    continue when r.status <> 'arranging' or r.meeting_on is not null;
    perform public.close_program(r.id, 'arrange-expired');
    perform public.notify(m, 'program-closed', '약속이 정해지지 않았어요', '7일 안에 약속이 정해지지 않아 이번 교류는 여기서 마무리돼요. 다음 소개를 준비할게요.', '/today', 'pclosed:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m where m is not null;
    c := c + 1;
  end loop;
  for r in select * from public.programs where status = 'arranging' and meeting_on is not null and contact_a is not null and contact_b is not null and t >= public.kst_at(meeting_on, '00:00') and t < public.kst_at(meeting_on + 2, '00:00') loop
    perform public.notify(m, 'contact-released', '오늘 만나는 분의 연락처가 열렸어요', '내일 밤 11시 59분까지 플라비 안에서 볼 수 있어요.', '/meeting', 'contact:' || r.id || ':' || r.meeting_on || ':' || m) from unnest(array[r.member_a, r.member_b]) m where m is not null;
  end loop;
  for r in select * from public.programs where status = 'arranging' and meeting_on is not null and t >= public.kst_at(meeting_on + 2, '00:00') loop
    perform public.close_program(r.id, 'completed');
    update public.profiles set paused_at = coalesce(paused_at, now()), paused_by = coalesce(paused_by, 'auto'), updated_at = now()
     where id in (r.member_a, r.member_b) and paused_at is null;
    perform public.notify(m, 'program-completed', '만남은 어떠셨나요?', '이번 교류는 마무리됐어요. 새 소개는 잠시 쉬어 둘게요. 다시 받고 싶을 때 내 정보에서 ‘다시 받기’를 눌러 주세요. 불편한 일이 있었다면 문의·신고로 알려 주세요.', '/today', 'done:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m where m is not null;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('closed', c);
  if (n ->> 'expired')::int + (n ->> 'started')::int + (n ->> 'missed')::int + (n ->> 'deciding')::int + (n ->> 'closed')::int > 0 then
    insert into public.job_runs (job, finished_at, ok, detail) values ('programs', now(), (n ->> 'missed')::int = 0, n);
  end if;
  exception when others then
    n := jsonb_build_object('error', sqlerrm);
    insert into public.job_runs (job, finished_at, ok, detail) values ('programs', now(), false, n);
  end;
  return n;
end $function$;

-- ── C4: 한 번에 한 사람 — 예약 함수는 두 회원을 같은 순서로 잠근 뒤 검사하고, DB는 소개를 넣을 때마다 한 번 더 막는다.
do $$
declare def text := pg_get_functiondef('public.admin_reserve_introduction(uuid, uuid, date, text, jsonb, uuid[], uuid[], jsonb)'::regprocedure);
begin
  if position('compat := public.clean_match(p_match);' in def) = 0 then raise exception 'admin_reserve_introduction을 바꾸지 못했어요'; end if;
  execute replace(def, 'compat := public.clean_match(p_match);',
    'compat := public.clean_match(p_match);
  -- 두 회원을 같은 순서로 잠근 뒤 검사한다(운영진 두 분이 동시에 예약해도 한 회원에게 소개가 둘 잡히지 않게).
  perform 1 from public.profiles where id in (p_a, p_b) order by id for update;');
end $$;

create or replace function public.guard_one_introduction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.intro_open(new) then return new; end if;
  perform 1 from public.profiles where id in (new.member_a, new.member_b) order by id for update;
  if exists (select 1 from public.introductions i
              where i.id is distinct from new.id and public.intro_open(i)
                and (i.member_a in (new.member_a, new.member_b) or i.member_b in (new.member_a, new.member_b))) then
    raise exception '이미 진행 중이거나 예약된 소개가 있는 회원이에요.';
  end if;
  return new;
end $$;
revoke all on function public.guard_one_introduction() from public, anon, authenticated;
drop trigger if exists introductions_one_at_a_time on public.introductions;
create trigger introductions_one_at_a_time before insert on public.introductions for each row execute function public.guard_one_introduction();
