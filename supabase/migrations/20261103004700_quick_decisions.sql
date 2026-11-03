-- 4700: 정하는 단계 줄이기
--
-- 1) 교류 방식·시작일: ‘이대로 시작’ 한 번(quick_start_program). 고른 방식으로 기본 시작일(내일 09:00)에 바로 시작해도 좋다는 뜻(ready_*)을
--    남겨 두고, 두 분의 방식이 같아져 상대가 확인하는 순간 내 확인도 함께 남겨 일정이 정해진다. 다른 날짜를 제안하면 상대의 ‘이대로’는 지운다.
-- 2) 넷째 날: ‘만나고 싶어요’를 고를 때 가능한 날·시간대(낮·오후·저녁)와 편한 지역을 함께 받는다(avail_* · region_*).
--    두 분 모두 만나고 싶으면 겹치는 시간만 보여 주고(상대가 고른 전체는 보이지 않음), 하나를 누르면 그 자리에서 약속이 정해진다(book_meeting_slot).
--    교류가 끝나면 고른 시간·지역은 지운다.

alter table public.programs
  add column if not exists ready_a text check (ready_a in ('A', 'B')),
  add column if not exists ready_b text check (ready_b in ('A', 'B')),
  add column if not exists avail_a jsonb,
  add column if not exists avail_b jsonb,
  add column if not exists region_a text check (region_a is null or char_length(region_a) <= 40),
  add column if not exists region_b text check (region_b is null or char_length(region_b) <= 40);

-- 마무리되면 고른 시간·지역은 지운다.
create or replace function public.close_program(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.programs;
begin
  update public.programs set status = 'closed', closed_at = now(), end_reason = p_reason, updated_at = now(),
         avail_a = null, avail_b = null, region_a = null, region_b = null, ready_a = null, ready_b = null
   where id = p_id and status <> 'closed' returning * into p;
  if p is null then return; end if;
  perform public.close_introduction(p.introduction_id, 'program-' || p_reason);
end $$;

-- 두 분이 같은 방식·시작일을 모두 확인했으면 일정을 정하고 알린다.
create or replace function public.program_schedule_if_ready(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare p public.programs;
begin
  select * into p from public.programs where id = p_id;
  if p.status <> 'choosing' or p.plan_a is null or p.plan_a is distinct from p.plan_b or p.start_on is null or p.confirm_a is null or p.confirm_b is null then return false; end if;
  update public.programs set status = 'scheduled', updated_at = now() where id = p.id;
  perform public.notify(m, 'program-scheduled', '교류 일정이 정해졌어요', to_char(p.start_on, 'FMMM"월" FMDD"일"') || ' 09:00에 첫날이 열려요.', '/exchange', 'scheduled:' || p.id || ':' || m)
    from unnest(array[p.member_a, p.member_b]) m where m is not null;
  return true;
end $$;
revoke all on function public.program_schedule_if_ready(uuid) from public, anon, authenticated;

create or replace function public.choose_program_plan(p_program uuid, p_plan text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); is_a boolean; tomorrow date := public.kst_date(public.app_now()) + 1; partner uuid; partner_plan text;
begin
  if p_plan not in ('A', 'B') then raise exception 'A 또는 B를 골라 주세요.'; end if;
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'choosing' or public.app_now() >= p.agree_by then raise exception '지금은 방식을 바꿀 수 없어요.'; end if;
  is_a := p.member_a = me; partner := public.program_partner(p, me);
  if (case when is_a then p.plan_a else p.plan_b end) is not distinct from p_plan then return public.my_program(); end if;
  -- 방식을 바꾸면 내 ‘이대로 시작’은 그 방식일 때만 남긴다.
  if is_a then update public.programs set plan_a = p_plan, confirm_a = null, confirm_b = null, ready_a = case when ready_a = p_plan then ready_a end, updated_at = now() where id = p.id returning * into p;
  else update public.programs set plan_b = p_plan, confirm_a = null, confirm_b = null, ready_b = case when ready_b = p_plan then ready_b end, updated_at = now() where id = p.id returning * into p; end if;
  if p.plan_a = p.plan_b and (p.start_on is null or p.start_on < tomorrow) then update public.programs set start_on = tomorrow where id = p.id; end if;
  partner_plan := case when is_a then p.plan_b else p.plan_a end;
  if partner is not null then
    perform public.notify(partner, 'program-plan', '상대가 ' || public.program_plan_name(p_plan) || '를 골랐어요',
      case when partner_plan = p_plan then '두 분의 방식이 같아졌어요. 시작일을 확인해 주세요.'
           when partner_plan is null then '나도 방식을 골라 주세요. 두 분이 같은 방식을 고르면 시작일을 확인해요.'
           else '두 분의 방식이 달라요. 교류 화면에서 상대 방식으로 맞추거나, 상대가 바꾸기를 기다려 주세요.' end,
      '/exchange', 'plan:' || p.id || ':' || me || ':' || p_plan || ':' || extract(epoch from clock_timestamp())::bigint);
  end if;
  if partner_plan = p_plan then return public.my_program() || jsonb_build_object('notice', '두 분의 방식이 같아졌어요. 이제 시작일을 확인해 주세요.'); end if;
  return public.my_program();
end $$;

create or replace function public.propose_program_start(p_program uuid, p_date date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); today date := public.kst_date(public.app_now()); partner uuid;
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'choosing' or public.app_now() >= p.agree_by then raise exception '지금은 시작일을 바꿀 수 없어요.'; end if;
  if p.plan_a is null or p.plan_a is distinct from p.plan_b then raise exception '두 분이 같은 방식을 고른 뒤 시작일을 정할 수 있어요.'; end if;
  if p_date is null or p_date < today + 1 or p_date > today + 14 then raise exception '내일부터 14일 안의 날짜를 골라 주세요.'; end if;
  if p.start_on is not distinct from p_date then return public.my_program(); end if;
  partner := public.program_partner(p, me);
  -- 제안한 사람은 이 날짜로 확인한 것으로 보고, 상대의 확인만 다시 받는다(상대의 ‘이대로 시작’은 기본 날짜 기준이라 지운다).
  update public.programs set start_on = p_date, confirm_a = case when member_a = me then now() end, confirm_b = case when member_b = me then now() end,
         ready_a = case when member_a = me then ready_a end, ready_b = case when member_b = me then ready_b end, updated_at = now() where id = p.id;
  if partner is not null then
    perform public.notify(partner, 'program-date', '상대가 시작일을 제안했어요', to_char(p_date, 'FMMM"월" FMDD"일"') || ' 09:00 시작이에요. 상대는 이 날짜로 확인했어요. 내 확인만 남았어요.', '/exchange', 'date:' || p.id || ':' || me || ':' || p_date);
  end if;
  return public.my_program() || jsonb_build_object('notice', '새 시작일을 제안하고 내 확인도 해 두었어요. 상대가 확인하면 일정이 정해져요.');
end $$;

create or replace function public.confirm_program(p_program uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); today date := public.kst_date(public.app_now()); partner uuid; partner_ready boolean;
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'choosing' or public.app_now() >= p.agree_by then raise exception '지금은 확인할 수 없어요.'; end if;
  if p.plan_a is null or p.plan_a is distinct from p.plan_b or p.start_on is null then raise exception '같은 방식과 시작일이 먼저 필요해요.'; end if;
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

-- ‘이대로 시작’: 고른 방식으로 기본 시작일에 바로 시작해도 좋다는 뜻을 남긴다. 두 분의 방식이 이미 같으면 바로 확인한다.
create or replace function public.quick_start_program(p_program uuid, p_plan text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); is_a boolean;
begin
  if p_plan not in ('A', 'B') then raise exception 'A 또는 B를 골라 주세요.'; end if;
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'choosing' or public.app_now() >= p.agree_by then raise exception '지금은 방식을 정할 수 없어요.'; end if;
  is_a := p.member_a = me;
  if (case when is_a then p.plan_a else p.plan_b end) is distinct from p_plan then perform public.choose_program_plan(p_program, p_plan); end if;
  update public.programs set ready_a = case when is_a then p_plan else ready_a end, ready_b = case when is_a then ready_b else p_plan end, updated_at = now()
   where id = p_program returning * into p;
  if p.plan_a = p.plan_b and p.start_on is not null then
    perform public.confirm_program(p_program);
    select * into p from public.programs where id = p_program;
    if p.status = 'scheduled' then
      return public.my_program() || jsonb_build_object('notice', '두 분 모두 이대로 시작해요. ' || to_char(p.start_on, 'FMMM"월" FMDD"일"') || ' 09:00에 첫날이 열려요.');
    end if;
    return public.my_program() || jsonb_build_object('notice', '이대로 시작을 눌렀어요. 상대가 확인하면 바로 정해져요.');
  end if;
  return public.my_program() || jsonb_build_object('notice', '이대로 시작을 눌렀어요. 상대가 같은 방식을 고르면 그때 바로 정해져요.');
end $$;

-- 가능한 때: ['YYYY-MM-DD|noon' …] (낮 12~15시 · 오후 15~18시 · 저녁 18~21시), 내일부터 2주 안, 최대 45칸
create or replace function public.clean_availability(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare today date := public.kst_date(public.app_now()); x text; d date; picked text[] := '{}';
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 45 then raise exception '가능한 때를 다시 골라 주세요.'; end if;
  for x in select jsonb_array_elements_text(p) loop
    if x !~ '^\d{4}-\d{2}-\d{2}\|(noon|afternoon|evening)$' then raise exception '가능한 때를 다시 골라 주세요.'; end if;
    d := split_part(x, '|', 1)::date;
    if d < today + 1 or d > today + 14 then raise exception '가능한 때는 내일부터 2주 안에서 골라 주세요.'; end if;
    if not (x = any(picked)) then picked := picked || x; end if;
  end loop;
  return to_jsonb(picked);
end $$;

create or replace function public.availability_band(p_band text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_band when 'noon' then array['12:00', '15:00'] when 'afternoon' then array['15:00', '18:00'] when 'evening' then array['18:00', '21:00'] end
$$;

drop function if exists public.choose_meeting(uuid, text);
create function public.choose_meeting(p_program uuid, p_choice text, p_avail jsonb default null, p_region text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); avail jsonb; region text;
begin
  if p_choice not in ('positive', 'negative') then raise exception '답을 골라 주세요.'; end if;
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'deciding' or public.app_now() >= p.meeting_by then raise exception '지금은 만남을 고를 수 없어요.'; end if;
  if (case when p.member_a = me then p.meeting_a else p.meeting_b end) is not null then raise exception '이미 골랐어요. 답은 바꿀 수 없어요.'; end if;
  if p_choice = 'positive' then
    avail := public.clean_availability(p_avail);
    region := nullif(trim(coalesce(p_region, '')), '');
    if region is not null then
      if char_length(region) > 40 then raise exception '지역은 40자 안으로 적어 주세요.'; end if;
      perform public.check_member_text(region, '만나기 편한 지역');
    end if;
  end if;
  if p.member_a = me then update public.programs set meeting_a = p_choice, meeting_a_at = now(), avail_a = avail, region_a = region, updated_at = now() where id = p.id returning * into p;
  else update public.programs set meeting_b = p_choice, meeting_b_at = now(), avail_b = avail, region_b = region, updated_at = now() where id = p.id returning * into p; end if;
  -- 두 분 모두 만나고 싶을 때만 바로 연다. 그 밖에는 마감에 함께 마무리한다(run_programs).
  if p.meeting_a = 'positive' and p.meeting_b = 'positive' then
    update public.programs set status = 'arranging', arrange_by = now() + interval '7 days', updated_at = now() where id = p.id;
    perform public.notify(m, 'meeting-mutual', '두 분 모두 만나고 싶다고 했어요', '7일 안에 약속을 함께 정해 주세요.', '/meeting', 'meet:' || p.id || ':' || m) from unnest(array[p.member_a, p.member_b]) m;
  end if;
  return public.my_program();
end $$;

-- 가능한 때·지역 고치기: 만나고 싶다고 답한 뒤(마감 전) 또는 약속을 정하는 동안(아직 정해지기 전).
create or replace function public.set_meeting_availability(p_program uuid, p_avail jsonb, p_region text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); avail jsonb := public.clean_availability(p_avail); region text := nullif(trim(coalesce(p_region, '')), '');
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if not ((p.status = 'deciding' and public.app_now() < p.meeting_by and (case when p.member_a = me then p.meeting_a else p.meeting_b end) = 'positive')
          or (p.status = 'arranging' and p.meeting_on is null and public.app_now() < p.arrange_by)) then
    raise exception '지금은 가능한 때를 고칠 수 없어요.';
  end if;
  if region is not null then
    if char_length(region) > 40 then raise exception '지역은 40자 안으로 적어 주세요.'; end if;
    perform public.check_member_text(region, '만나기 편한 지역');
  end if;
  if p.member_a = me then update public.programs set avail_a = avail, region_a = region, updated_at = now() where id = p.id;
  else update public.programs set avail_b = avail, region_b = region, updated_at = now() where id = p.id; end if;
  return public.my_program();
end $$;

-- 두 분 모두 되는 시간 하나를 누르면 그 자리에서 약속이 정해진다(다른 시간은 지금처럼 새로 제안할 수 있다).
create or replace function public.book_meeting_slot(p_program uuid, p_slot text, p_activity text, p_region text, p_place text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); d date; band text[]; s jsonb; new_id uuid;
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'arranging' or (p.meeting_on is null and public.app_now() >= p.arrange_by) then raise exception '지금은 약속을 정할 수 없어요.'; end if;
  if p.meeting_on is not null and public.app_now() >= public.kst_at(p.meeting_on, '00:00') then raise exception '만나는 날이 되어 약속을 바꿀 수 없어요. 일정이 어려우면 문의해 주세요.'; end if;
  if coalesce(p_slot, '') !~ '^\d{4}-\d{2}-\d{2}\|(noon|afternoon|evening)$' then raise exception '시간을 다시 골라 주세요.'; end if;
  if not (coalesce(p.avail_a, '[]'::jsonb) ? p_slot and coalesce(p.avail_b, '[]'::jsonb) ? p_slot) then raise exception '두 분 모두 되는 시간이 아니에요. 다른 시간을 골라 주세요.'; end if;
  d := split_part(p_slot, '|', 1)::date; band := public.availability_band(split_part(p_slot, '|', 2));
  if d <= public.kst_date(public.app_now()) then raise exception '지난 날짜예요. 다른 시간을 골라 주세요.'; end if;
  if coalesce(trim(p_activity), '') = '' or coalesce(trim(p_region), '') = '' then raise exception '무엇을 할지와 만날 지역을 적어 주세요.'; end if;
  if char_length(trim(p_region)) > 40 or char_length(coalesce(trim(p_place), '')) > 80 then raise exception '지역은 40자, 장소는 80자 안으로 적어 주세요.'; end if;
  perform public.check_member_text(concat_ws(' ', p_activity, p_region, p_place), '약속 정하기');
  s := jsonb_build_object('date', d::text, 'start', band[1], 'end', band[2]);
  update public.appointment_proposals set status = 'replaced' where program_id = p.id and status in ('open', 'accepted');
  insert into public.appointment_proposals (program_id, author, slots, activity, region, place, status, selected, accepted_at)
  values (p.id, me, jsonb_build_array(s), trim(p_activity), trim(p_region), nullif(trim(coalesce(p_place, '')), ''), 'accepted', s, now())
  returning id into new_id;
  update public.programs set meeting_on = d, meeting_time = band[1] || '~' || band[2], contact_a = null, contact_b = null, updated_at = now() where id = p.id;
  perform public.notify(m, 'appointment-final', '약속이 정해졌어요',
    to_char(d, 'FMMM"월" FMDD"일"') || ' ' || band[1] || ' · ' || trim(p_activity) || ' · ' || trim(p_region) || ' · 두 분 모두 되는 시간으로 정했어요.', '/meeting', 'final:' || new_id || ':' || m)
    from unnest(array[p.member_a, p.member_b]) m;
  return public.my_program();
end $$;

revoke all on function public.quick_start_program(uuid, text), public.choose_meeting(uuid, text, jsonb, text), public.set_meeting_availability(uuid, jsonb, text),
  public.book_meeting_slot(uuid, text, text, text, text) from public, anon;
grant execute on function public.quick_start_program(uuid, text), public.choose_meeting(uuid, text, jsonb, text), public.set_meeting_availability(uuid, jsonb, text),
  public.book_meeting_slot(uuid, text, text, text, text) to authenticated;

-- 회원 교류 화면: ‘이대로 시작’ 상태, 내가 고른 가능한 때, 약속을 정할 때 두 분 모두 되는 시간과 상대가 편한 지역
CREATE OR REPLACE FUNCTION public.my_program()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'ownReady', case when is_a then p.ready_a else p.ready_b end,
    'partnerReady', (case when is_a then p.ready_b else p.ready_a end) is not null and (case when is_a then p.ready_b else p.ready_a end) is not distinct from partner_plan,
    'ownAvailability', coalesce(case when is_a then p.avail_a else p.avail_b end, '[]'::jsonb),
    'ownRegion', case when is_a then p.region_a else p.region_b end,
    'partnerRegion', case when p.status = 'arranging' then (case when is_a then p.region_b else p.region_a end) end,
    'partnerAvailabilitySet', p.status = 'arranging' and jsonb_array_length(coalesce(case when is_a then p.avail_b else p.avail_a end, '[]'::jsonb)) > 0,
    'overlap', case when p.status = 'arranging' then (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(p.avail_a, '[]'::jsonb)) x
                 where coalesce(p.avail_b, '[]'::jsonb) ? x and split_part(x, '|', 1)::date > today) else '[]'::jsonb end,
    'arrangeBy', p.arrange_by, 'meetingOn', p.meeting_on, 'meetingTime', p.meeting_time,
    'proposals', proposals,
    'ownContact', (case when is_a then p.contact_a else p.contact_b end) is not null,
    'contactReleaseAt', case when p.meeting_on is not null then public.kst_at(p.meeting_on, '00:00') end,
    'contactUntil', case when p.meeting_on is not null then public.kst_at(p.meeting_on + 2, '00:00') - interval '1 second' end,
    'contactReleased', released,
    'partnerPhone', phone
  );
end $function$;
