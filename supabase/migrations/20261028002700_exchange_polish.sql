-- 3일 교류 다듬기(2026-10-28)
--  1. B 첫 장면의 고를 거리를 늘린다: 분위기 7가지(전시·산책·서점·카페·공원·시장 골목·작은 공연), 흐름 3가지, 쉬어 갈 곳 4가지.
--  2. 시작일 확인 중 날짜가 지나 하루 미뤄질 때, 누른 사람의 확인은 남기고 상대에게 다시 확인해 달라고 알린다(전에는 두 분 확인이 모두 조용히 지워졌다).
--  3. '상대가 방식을 골랐어요', '상대가 일정을 확인했어요'는 할 일이 생기는 알림이라 메일로도 보낸다.

create or replace function public.submit_program_entry(p_program uuid, p_day int, p_kind text, p_body text, p_payload jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); plan text; day_date date; body text := nullif(trim(coalesce(p_body, '')), ''); n int; partner uuid;
  label text := case p_kind when 'letter' then '편지' when 'reply' then '답장' else '첫 장면' end;
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'started' then raise exception '교류가 열려 있을 때만 보낼 수 있어요.'; end if;
  plan := p.plan_a; partner := public.program_partner(p, me);
  if p_kind not in ('letter', 'reply', 'scene') or p_day not between 1 and 3 then raise exception '보낼 글을 확인해 주세요.'; end if;
  if (p_kind in ('letter', 'reply') and plan <> 'A') or (p_kind = 'scene' and plan <> 'B') then raise exception '이 교류 방식에서 쓰는 글이 아니에요.'; end if;
  day_date := p.start_on + p_day - 1;
  if public.kst_date(public.app_now()) <> day_date or public.app_now() < public.kst_at(day_date, '09:00') then
    raise exception '그날의 글은 그날 09:00~23:59(한국 시간)에만 쓸 수 있어요.';
  end if;
  if p_kind = 'reply' and (select count(*) from public.program_entries where program_id = p.id and day = p_day and kind = 'letter') < 2 then
    raise exception '그날의 편지가 두 분 모두에게 열린 뒤에 답장할 수 있어요.';
  end if;
  if p_kind = 'letter' and (body is null or char_length(body) < 20) then raise exception '편지는 20자 이상 써 주세요.'; end if;
  if p_kind = 'reply' and (body is null or char_length(body) > 600) then raise exception '답장은 1~600자로 써 주세요.'; end if;
  if p_kind = 'scene' then
    if jsonb_typeof(p_payload) is distinct from 'object' or char_length(p_payload::text) > 1000 then raise exception '첫 장면 답을 확인해 주세요.'; end if;
    if p_day = 1 and coalesce(p_payload ->> 'activity', '') not in ('exhibition', 'walk', 'bookstore', 'cafe', 'park', 'market', 'performance') then raise exception '시작하고 싶은 분위기를 골라 주세요.'; end if;
    if p_day = 2 and (coalesce(p_payload ->> 'flow', '') not in ('짧게 둘러보기', '천천히 머물기', '발길 닿는 대로')
                      or coalesce(p_payload ->> 'rest', '') not in ('조용한 카페', '공공 야외 공간', '디저트·빵집', '강가·벤치')) then raise exception '흐름과 쉬어 갈 곳을 골라 주세요.'; end if;
    if p_day = 3 and coalesce(trim(p_payload ->> 'topic'), '') = '' then raise exception '함께 나누고 싶은 이야기를 적어 주세요.'; end if;
    if body is not null and char_length(body) > 300 then raise exception '이유는 300자 안으로 적어 주세요.'; end if;
  end if;
  perform public.check_member_text(concat_ws(' ', body, p_payload::text), '교류 ' || label);
  if exists (select 1 from public.program_entries where program_id = p.id and day = p_day and kind = p_kind and author = me) then
    raise exception '이미 보낸 %은(는) 고치거나 다시 보낼 수 없어요.', label;
  end if;
  insert into public.program_entries (program_id, day, kind, author, body, payload) values (p.id, p_day, p_kind, me, body, case when p_kind = 'scene' then p_payload end);
  select count(*) into n from public.program_entries where program_id = p.id and day = p_day and kind = p_kind;
  if n = 2 then
    perform public.notify(m, 'program-open', 'DAY0' || p_day || ' ' || case p_kind when 'letter' then '편지가' when 'reply' then '답장이' else '첫 장면 답이' end || ' 열렸어요', '두 분이 모두 보내서 함께 열렸어요.', '/exchange', 'open:' || p.id || ':' || p_day || ':' || p_kind || ':' || m)
      from unnest(array[p.member_a, p.member_b]) m where m is not null;
  elsif partner is not null then
    perform public.notify(partner, 'program-sent', '상대가 오늘의 ' || case p_kind when 'letter' then '편지를' when 'reply' then '답장을' else '첫 장면 답을' end || ' 보냈어요', '내 글도 보내면 23:59 전에 함께 열려요.', '/exchange', 'sent:' || p.id || ':' || p_day || ':' || p_kind || ':' || me);
  end if;
  return public.my_program();
end $$;

create or replace function public.confirm_program(p_program uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); today date := public.kst_date(public.app_now()); partner uuid;
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'choosing' or public.app_now() >= p.agree_by then raise exception '지금은 확인할 수 없어요.'; end if;
  if p.plan_a is null or p.plan_a is distinct from p.plan_b or p.start_on is null then raise exception '같은 방식과 시작일이 먼저 필요해요.'; end if;
  partner := public.program_partner(p, me);
  if p.start_on <= today then
    -- 날짜가 지나 하루 미뤄진다: 누른 사람의 확인은 남기고, 상대에게 새 날짜를 다시 확인해 달라고 알린다.
    update public.programs set start_on = today + 1,
           confirm_a = case when member_a = me then now() end, confirm_b = case when member_b = me then now() end, updated_at = now()
     where id = p.id;
    if partner is not null then
      perform public.notify(partner, 'program-date', '교류 시작일이 하루 미뤄졌어요', to_char(today + 1, 'FMMM"월" FMDD"일"') || ' 09:00 시작으로 바뀌었어요. 상대는 확인했어요. 내 확인만 남았어요.', '/exchange', 'date:' || p.id || ':roll:' || (today + 1));
    end if;
    return public.my_program() || jsonb_build_object('notice', '시작일이 지나 내일 09:00 시작으로 바꾸고 확인해 두었어요. 상대의 확인만 남았어요.');
  end if;
  if p.member_a = me then update public.programs set confirm_a = now(), updated_at = now() where id = p.id returning * into p;
  else update public.programs set confirm_b = now(), updated_at = now() where id = p.id returning * into p; end if;
  if p.confirm_a is not null and p.confirm_b is not null then
    update public.programs set status = 'scheduled', updated_at = now() where id = p.id;
    perform public.notify(m, 'program-scheduled', '교류 일정이 정해졌어요', to_char(p.start_on, 'FMMM"월" FMDD"일"') || ' 09:00에 첫날이 열려요.', '/exchange', 'scheduled:' || p.id || ':' || m)
      from unnest(array[p.member_a, p.member_b]) m where m is not null;
  elsif partner is not null then
    perform public.notify(partner, 'program-confirm', '상대가 교류 일정을 확인했어요', '내 확인만 남았어요.', '/exchange', 'confirm:' || p.id || ':' || me || ':' || p.start_on);
  end if;
  return public.my_program();
end $$;

create or replace function public.email_class(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind = 'announcement' then 'always'
    when p_kind in ('waiting', 'program-sent', 'program-open') then 'site'
    else 'important' end
$$;

revoke all on function public.email_class(text) from public, anon, authenticated;
revoke all on function public.submit_program_entry(uuid, int, text, text, jsonb), public.confirm_program(uuid) from public, anon;
grant execute on function public.submit_program_entry(uuid, int, text, text, jsonb), public.confirm_program(uuid) to authenticated;
