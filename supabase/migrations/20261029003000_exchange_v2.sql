-- 3일 교류 다듬기 2(2026-10-29)
--  1. 연락처 검사: 날짜(2026-10-28 · 2026.10.28)·시각·가격은 막지 않는다. 휴대폰 번호·메일·SNS 아이디·링크·계좌번호는 그대로 막는다.
--     날짜 바로 앞에 숫자가 붙어 있으면(예: 010 2026-10-28) 날짜로 보지 않는다(번호를 날짜처럼 쓰는 우회 막기).
--  2. 방식이 다를 때: 바꾼 사람이 고른 방식을 알림에 적는다. 서로 선택하고 24시간이 지나도 다르면 두 분 모두에게 한 번 알린다.
--  3. 답장(A): 편지가 함께 열린 뒤 다음 날 09:00까지 보낼 수 있다(셋째 날 답장은 넷째 날 09:00까지).
--     편지·첫 장면 답이 함께 열렸다는 알림(program-opened)은 메일로도 보낸다(밤 10시~아침 8시에는 아침에). 답장이 열린 알림은 사이트만.
--  4. B 첫 장면: 날마다 짧은 ‘나를 소개하는 답(about)’을 받고, 둘째·셋째 날에는 전날 함께 열린 상대의 선택에 한마디(reaction)를 받는다.
--     셋째 날 답이 함께 열리면 두 분이 고른 것 중에서 장소·흐름·쉬어 갈 곳·이야기를 하나씩 골라 맞춘다(kind = 'final').
--     두 분의 선택이 같으면 첫 장면이 정해진다. 다르면 서로의 선택이 보이고, 정해지기 전까지는 다시 고를 수 있다.
--  5. 시작일을 제안한 사람은 그 날짜로 확인한 것으로 본다(상대의 확인만 남는다).
--  6. 넷째 날 두 분 모두 ‘만나고 싶어요’였던 교류는, 마무리된 뒤에도 보존 기간(마무리 후 30일, run_program_retention) 동안
--     주고받은 글을 다시 읽을 수 있다. 차단 관계가 생기면 보이지 않는다.
--  7. 18:00 알림: 그날 편지가 함께 열렸는데 답장을 보내지 않았으면 한 번 알린다.

-- ─────────────────────────────────────────────────────────
-- 1. 연락처·링크 검사(화면의 backend/program.ts contactProblem과 같은 기준)
create or replace function public.has_contact(p_text text) returns boolean
language sql immutable set search_path = '' as $$
  select s ~* '(?<![0-9])(\+?82[\s.-]?)?0?1[016789][\s.-]?[0-9]{3,4}[\s.-]?[0-9]{4}|([0-9][\s.-]?){10,11}|공일공|영일영'
      or s ~* '[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z.]{2,}'
      or s ~* 'https?://|www\.|\y[a-z0-9-]+\.(com|net|org|kr|me|io|ly|link|app|page)\y'
      or s ~* '(카톡|카카오톡|텔레그램|오픈\s*채팅|오픈톡|라인)\s*(아이디|id|주소|링크|추가)|(인스타|instagram|insta)\s*(아이디|계정|id|팔로우|디엠|dm)|(아이디|id)\s*(는|은|:)\s*[a-z0-9_.]{3,}|(^|\s)@[a-z0-9_.]{3,}'
      or s ~ '[0-9]{2,6}-[0-9]{2,6}-[0-9]{2,7}'
    from (select regexp_replace(coalesce(p_text, ''),
      -- 날짜(19xx·20xx년 월 일)는 숫자 검사 전에 지운다. 앞에 숫자가 붙었거나 뒤에 숫자가 이어지면 날짜로 보지 않는다.
      '(?<![0-9./-])(?<![0-9][\s./-])(19|20)[0-9]{2}\s?([./-]|년)\s?(0?[1-9]|1[0-2])\s?([./-]|월)\s?(0?[1-9]|[12][0-9]|3[01])(?![0-9])(?![./-][0-9])', ' ', 'g') as s) x
$$;

-- ─────────────────────────────────────────────────────────
-- 2. 교류 글 묶음 · 마무리 뒤 다시 읽기
alter table public.program_entries drop constraint program_entries_kind_check;
alter table public.program_entries add constraint program_entries_kind_check check (kind in ('letter', 'reply', 'scene', 'final'));

-- 그날 글: 내 글은 늘 보이고, 상대 글은 두 사람 모두 보냈을 때만 보인다(상대가 보냈는지는 내가 보내기 전에도 알 수 있다).
create or replace function public.program_entries_json(p_program uuid, p_me uuid, p_partner uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'kind', d.kind,
           'own', (select jsonb_build_object('body', e.body, 'payload', e.payload, 'at', e.created_at) from public.program_entries e where e.program_id = p_program and e.day = d.day and e.kind = d.kind and e.author = p_me),
           'partnerSent', exists (select 1 from public.program_entries e where e.program_id = p_program and e.day = d.day and e.kind = d.kind and e.author = p_partner),
           'partner', case when (select count(*) from public.program_entries e where e.program_id = p_program and e.day = d.day and e.kind = d.kind) = 2
             then (select jsonb_build_object('body', e.body, 'payload', e.payload, 'at', e.created_at) from public.program_entries e where e.program_id = p_program and e.day = d.day and e.kind = d.kind and e.author = p_partner) end
         ) order by d.day, d.kind), '[]'::jsonb)
    from (select distinct day, kind from public.program_entries where program_id = p_program) d
$$;

-- 마무리된 교류를 다시 읽을 수 있는지: 넷째 날 두 분 모두 ‘만나고 싶어요’였고, 만남까지 마쳤거나 약속 기한이 지나 끝났으며,
-- 보존 기간(마무리 후 30일) 안이고, 두 사람 사이에 차단이 없을 때만.
create or replace function public.program_readable(p public.programs, p_me uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p.status = 'closed' and p.meeting_a = 'positive' and p.meeting_b = 'positive'
     and coalesce(p.end_reason, '') in ('completed', 'arrange-expired') and p.closed_at > now() - interval '30 days'
     and not exists (select 1 from public.blocks b
                      where (b.member_id = p_me and b.blocked_id = public.program_partner(p, p_me))
                         or (b.blocked_id = p_me and b.member_id = public.program_partner(p, p_me)))
$$;

-- 내 교류 찾기(진행 중 · 닫힌 지 3일 안 · 다시 읽을 수 있는 마무리된 교류)
create or replace function public.my_program_row() returns public.programs
language sql stable security definer set search_path = '' as $$
  select * from public.programs p
   where auth.uid() in (p.member_a, p.member_b)
     and (p.status <> 'closed' or p.closed_at > now() - interval '3 days' or public.program_readable(p, auth.uid()))
   order by p.created_at desc limit 1
$$;

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
           'readableUntil', p.closed_at + interval '30 days') else '{}'::jsonb end;
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

-- ─────────────────────────────────────────────────────────
-- 3. 합의: 방식 고르기(고른 방식을 알림에 적는다) · 시작일 제안(제안한 사람은 확인한 것으로 본다)
create or replace function public.program_plan_name(p_plan text) returns text
language sql immutable set search_path = '' as $$ select case p_plan when 'A' then 'A 편지 나누기' when 'B' then 'B 첫 장면 만들기' end $$;

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
  if is_a then update public.programs set plan_a = p_plan, confirm_a = null, confirm_b = null, updated_at = now() where id = p.id returning * into p;
  else update public.programs set plan_b = p_plan, confirm_a = null, confirm_b = null, updated_at = now() where id = p.id returning * into p; end if;
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
  -- 제안한 사람은 이 날짜로 확인한 것으로 보고, 상대의 확인만 다시 받는다.
  update public.programs set start_on = p_date, confirm_a = case when member_a = me then now() end, confirm_b = case when member_b = me then now() end, updated_at = now() where id = p.id;
  if partner is not null then
    perform public.notify(partner, 'program-date', '상대가 시작일을 제안했어요', to_char(p_date, 'FMMM"월" FMDD"일"') || ' 09:00 시작이에요. 상대는 이 날짜로 확인했어요. 내 확인만 남았어요.', '/exchange', 'date:' || p.id || ':' || me || ':' || p_date);
  end if;
  return public.my_program() || jsonb_build_object('notice', '새 시작일을 제안하고 내 확인도 해 두었어요. 상대가 확인하면 일정이 정해져요.');
end $$;

-- ─────────────────────────────────────────────────────────
-- 4. 교류 글: 편지(A) · 답장(A, 다음 날 09:00까지) · 첫 장면(B, 나를 소개하는 답·전날 선택에 한마디)
create or replace function public.submit_program_entry(p_program uuid, p_day int, p_kind text, p_body text, p_payload jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); plan text; day_date date; body text := nullif(trim(coalesce(p_body, '')), ''); n int; partner uuid;
  label text := case p_kind when 'letter' then '편지' when 'reply' then '답장' else '첫 장면' end; t timestamptz := public.app_now();
  clean jsonb; prev_opened boolean;
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'started' then raise exception '교류가 열려 있을 때만 보낼 수 있어요.'; end if;
  plan := p.plan_a; partner := public.program_partner(p, me);
  if p_kind not in ('letter', 'reply', 'scene') or p_day not between 1 and 3 then raise exception '보낼 글을 확인해 주세요.'; end if;
  if (p_kind in ('letter', 'reply') and plan <> 'A') or (p_kind = 'scene' and plan <> 'B') then raise exception '이 교류 방식에서 쓰는 글이 아니에요.'; end if;
  day_date := p.start_on + p_day - 1;
  if p_kind = 'reply' then
    -- 답장은 그날 편지가 함께 열린 뒤부터 다음 날 09:00까지(셋째 날 답장은 넷째 날 09:00까지)
    if t < public.kst_at(day_date, '09:00') or t >= public.kst_at(day_date + 1, '09:00') then
      raise exception '답장은 편지가 열린 날부터 다음 날 09:00(한국 시간)까지 보낼 수 있어요.';
    end if;
    if (select count(*) from public.program_entries where program_id = p.id and day = p_day and kind = 'letter') < 2 then
      raise exception '그날의 편지가 두 분 모두에게 열린 뒤에 답장할 수 있어요.';
    end if;
  elsif public.kst_date(t) <> day_date or t < public.kst_at(day_date, '09:00') then
    raise exception '그날의 글은 그날 09:00~23:59(한국 시간)에만 쓸 수 있어요.';
  end if;
  if p_kind = 'letter' and (body is null or char_length(body) < 20) then raise exception '편지는 20자 이상 써 주세요.'; end if;
  if p_kind = 'reply' and (body is null or char_length(body) > 600) then raise exception '답장은 1~600자로 써 주세요.'; end if;
  if p_kind = 'scene' then
    if jsonb_typeof(p_payload) is distinct from 'object' or char_length(p_payload::text) > 1500 then raise exception '첫 장면 답을 확인해 주세요.'; end if;
    prev_opened := p_day > 1 and (select count(*) from public.program_entries where program_id = p.id and day = p_day - 1 and kind = 'scene') = 2;
    -- 그날 쓰는 칸만 남긴다(다른 값은 저장하지 않는다).
    clean := jsonb_strip_nulls(jsonb_build_object(
      'activity', case when p_day = 1 then p_payload ->> 'activity' end,
      'flow', case when p_day = 2 then p_payload ->> 'flow' end,
      'rest', case when p_day = 2 then p_payload ->> 'rest' end,
      'topic', case when p_day = 3 then nullif(trim(coalesce(p_payload ->> 'topic', '')), '') end,
      'reaction', case when p_day > 1 then nullif(trim(coalesce(p_payload ->> 'reaction', '')), '') end,
      'about', nullif(trim(coalesce(p_payload ->> 'about', '')), '')));
    if p_day = 1 and coalesce(clean ->> 'activity', '') not in ('exhibition', 'walk', 'bookstore', 'cafe', 'park', 'market', 'performance') then raise exception '시작하고 싶은 분위기를 골라 주세요.'; end if;
    if p_day = 2 and (coalesce(clean ->> 'flow', '') not in ('짧게 둘러보기', '천천히 머물기', '발길 닿는 대로')
                      or coalesce(clean ->> 'rest', '') not in ('조용한 카페', '공공 야외 공간', '디저트·빵집', '강가·벤치')) then raise exception '흐름과 쉬어 갈 곳을 골라 주세요.'; end if;
    if p_day = 3 and clean ->> 'topic' is null then raise exception '함께 나누고 싶은 이야기를 적어 주세요.'; end if;
    if char_length(coalesce(clean ->> 'topic', '')) > 80 then raise exception '나누고 싶은 이야기는 80자 안으로 적어 주세요.'; end if;
    if char_length(coalesce(clean ->> 'about', '')) > 100 then raise exception '나를 소개하는 답은 100자 안으로 적어 주세요.'; end if;
    if char_length(coalesce(clean ->> 'reaction', '')) > 150 then raise exception '상대에게 건네는 한마디는 150자 안으로 적어 주세요.'; end if;
    if prev_opened and clean ->> 'reaction' is null then raise exception '어제 함께 열린 상대의 선택에 한마디를 남겨 주세요.'; end if;
    if body is not null and char_length(body) > 300 then raise exception '이유는 300자 안으로 적어 주세요.'; end if;
  end if;
  perform public.check_member_text(concat_ws(' ', body, (select string_agg(v, ' ') from jsonb_each_text(coalesce(clean, '{}'::jsonb)) as x(k, v))), '교류 ' || label);
  if exists (select 1 from public.program_entries where program_id = p.id and day = p_day and kind = p_kind and author = me) then
    raise exception '이미 보낸 %은(는) 고치거나 다시 보낼 수 없어요.', label;
  end if;
  insert into public.program_entries (program_id, day, kind, author, body, payload) values (p.id, p_day, p_kind, me, body, clean);
  select count(*) into n from public.program_entries where program_id = p.id and day = p_day and kind = p_kind;
  if n = 2 and p_kind = 'reply' then
    perform public.notify(m, 'program-open', 'DAY0' || p_day || ' 답장이 열렸어요', '두 분의 답장이 함께 열렸어요.', '/exchange', 'open:' || p.id || ':' || p_day || ':' || p_kind || ':' || m)
      from unnest(array[p.member_a, p.member_b]) m where m is not null;
  elsif n = 2 then
    -- 편지·첫 장면 답이 열린 알림은 할 일(답장·다음 고르기)이 생기는 알림이라 메일로도 보낸다.
    perform public.notify(m, 'program-opened', 'DAY0' || p_day || ' ' || case p_kind when 'letter' then '편지가' else '첫 장면 답이' end || ' 열렸어요',
      case when p_kind = 'letter' then '두 분이 모두 보내서 함께 열렸어요. 열린 편지에는 ' || to_char(day_date + 1, 'FMMM"월" FMDD"일"') || ' 09:00까지 답장을 한 번 보낼 수 있어요.'
           when p_day = 3 then '두 분이 모두 보내서 함께 열렸어요. 이제 두 분이 고른 것 중에서 첫 장면을 함께 맞춰요.'
           else '두 분이 모두 보내서 함께 열렸어요. 상대가 무엇을 골랐는지 확인해 보세요.' end,
      '/exchange', 'open:' || p.id || ':' || p_day || ':' || p_kind || ':' || m)
      from unnest(array[p.member_a, p.member_b]) m where m is not null;
  elsif partner is not null then
    perform public.notify(partner, 'program-sent', '상대가 DAY0' || p_day || ' ' || case p_kind when 'letter' then '편지를' when 'reply' then '답장을' else '첫 장면 답을' end || ' 보냈어요',
      case when p_kind = 'reply' then '내 답장도 보내면 함께 열려요. ' || to_char(day_date + 1, 'FMMM"월" FMDD"일"') || ' 09:00까지예요.' else '내 글도 보내면 23:59 전에 함께 열려요.' end,
      '/exchange', 'sent:' || p.id || ':' || p_day || ':' || p_kind || ':' || me);
  end if;
  return public.my_program();
end $$;

-- B 마지막 맞추기: 셋째 날 답이 함께 열리면 두 분이 고른 것 중에서 하나씩 고른다.
-- 그날 답이 열리지 않았던 칸(장소·흐름·쉬어 갈 곳)은 처음 목록에서 고른다. 두 분의 선택이 같으면 정해지고, 그 뒤에는 바꿀 수 없다.
create or replace function public.choose_first_scene(p_program uuid, p_pick jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); partner uuid; pick jsonb; mine jsonb; theirs jsonb; acts text[]; flows text[]; rests text[]; topics text[];
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.plan_a is distinct from 'B' then raise exception '첫 장면 맞추기는 B 방식에서만 해요.'; end if;
  if p.status not in ('started', 'deciding', 'arranging') or p.meeting_on is not null then raise exception '지금은 첫 장면을 고를 수 없어요.'; end if;
  if (select count(*) from public.program_entries where program_id = p.id and day = 3 and kind = 'scene') < 2 then
    raise exception '셋째 날 답이 두 분 모두에게 열린 뒤에 첫 장면을 맞출 수 있어요.';
  end if;
  partner := public.program_partner(p, me);
  select case when count(*) = 2 then array_agg(distinct payload ->> 'activity') else array['exhibition', 'walk', 'bookstore', 'cafe', 'park', 'market', 'performance'] end into acts
    from public.program_entries where program_id = p.id and day = 1 and kind = 'scene';
  select case when count(*) = 2 then array_agg(distinct payload ->> 'flow') else array['짧게 둘러보기', '천천히 머물기', '발길 닿는 대로'] end,
         case when count(*) = 2 then array_agg(distinct payload ->> 'rest') else array['조용한 카페', '공공 야외 공간', '디저트·빵집', '강가·벤치'] end into flows, rests
    from public.program_entries where program_id = p.id and day = 2 and kind = 'scene';
  select array_agg(distinct payload ->> 'topic') into topics from public.program_entries where program_id = p.id and day = 3 and kind = 'scene';
  if jsonb_typeof(p_pick) is distinct from 'object' then raise exception '두 분이 고른 것 중에서 하나씩 골라 주세요.'; end if;
  pick := jsonb_build_object('activity', p_pick ->> 'activity', 'flow', p_pick ->> 'flow', 'rest', p_pick ->> 'rest', 'topic', p_pick ->> 'topic');
  if not (coalesce(pick ->> 'activity' = any (acts), false) and coalesce(pick ->> 'flow' = any (flows), false)
          and coalesce(pick ->> 'rest' = any (rests), false) and coalesce(pick ->> 'topic' = any (topics), false)) then
    raise exception '두 분이 고른 것 중에서 하나씩 골라 주세요.';
  end if;
  select payload into mine from public.program_entries where program_id = p.id and day = 3 and kind = 'final' and author = me;
  select payload into theirs from public.program_entries where program_id = p.id and day = 3 and kind = 'final' and author = partner;
  if mine is not null and theirs is not null and mine = theirs then raise exception '두 분이 이미 같은 장면으로 정했어요.'; end if;
  insert into public.program_entries (program_id, day, kind, author, payload) values (p.id, 3, 'final', me, pick)
    on conflict (program_id, day, kind, author) do update set payload = excluded.payload, created_at = now();
  if theirs is null then
    if partner is not null then
      perform public.notify(partner, 'program-final', '상대가 첫 장면을 골랐어요', '나도 고르면 두 분의 선택이 함께 열려요.', '/exchange', 'final-sent:' || p.id || ':' || me);
    end if;
    return public.my_program() || jsonb_build_object('notice', '골랐어요. 상대도 고르면 두 분의 선택이 함께 열려요.');
  elsif theirs = pick then
    perform public.notify(m, 'program-final', '두 분의 첫 장면이 정해졌어요', '같은 장면을 골랐어요. 두 분 모두 만나고 싶다고 하면 약속 제안에 그대로 담겨요.', '/exchange', 'final-agreed:' || p.id || ':' || m)
      from unnest(array[p.member_a, p.member_b]) m where m is not null;
    return public.my_program() || jsonb_build_object('notice', '두 분이 같은 장면을 골랐어요. 첫 장면이 정해졌어요.');
  end if;
  perform public.notify(partner, 'program-final', '첫 장면에 서로 다른 부분이 있어요', '두 분의 선택을 비교해 보고, 맞출 부분을 다시 골라 주세요.', '/exchange', 'final-diff:' || p.id || ':' || me || ':' || extract(epoch from clock_timestamp())::bigint);
  return public.my_program() || jsonb_build_object('notice', '상대와 다른 부분이 있어요. 아래에서 비교하고 다시 고를 수 있어요.');
end $$;

-- ─────────────────────────────────────────────────────────
-- 5. 알림 종류별 메일: 편지·첫 장면 답이 열린 알림(program-opened)은 메일로도. 답장이 열린 알림·상대의 움직임·첫 장면 맞추기는 사이트만.
create or replace function public.email_class(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind = 'announcement' then 'always'
    when p_kind in ('waiting', 'program-sent', 'program-open', 'program-final') then 'site'
    else 'important' end
$$;

-- ─────────────────────────────────────────────────────────
-- 6. 마감 전 알림: 20261028002600의 run_reminders 그대로에, 열린 편지 답장 알림과 방식이 다를 때 알림을 더한다.
create or replace function public.run_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; t timestamptz := public.app_now(); today date := public.kst_date(public.app_now()); key text;
begin
  begin
  -- 소개 응답(당일 저녁): 오늘 공개된 소개에 20:00~22:00 사이 아직 답하지 않은 회원
  for r in select i.id, m.member, m.opened from public.introductions i
             cross join lateral (values (i.member_a, i.response_a, i.opened_a_at is not null), (i.member_b, i.response_b, i.opened_b_at is not null)) as m(member, response, opened)
            where i.status = 'published' and m.member is not null and m.response is null and public.kst_date(i.published_at) = today
              and t >= public.kst_at(today, '20:00') and t < public.kst_at(today, '22:00') loop
    key := 'remind-intro-eve:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-response',
        case when r.opened then '오늘의 인연에 아직 답하지 않았어요' else '오늘의 인연을 아직 열어 보지 않았어요' end,
        '내일 오전 11시까지 답해 주세요. 답이 없으면 이번 소개는 마무리돼요.', '/us', key);
      n := n + 1;
    end if;
  end loop;
  -- 소개 응답: 마감(다음 날 11:00) 2시간 전까지 답하지 않은 회원
  for r in select i.id, m.member from public.introductions i
             cross join lateral (values (i.member_a, i.response_a), (i.member_b, i.response_b)) as m(member, response)
            where i.status = 'published' and m.member is not null and m.response is null and t >= i.respond_by - interval '2 hours' and t < i.respond_by loop
    key := 'remind-intro:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-response', '답 마감까지 2시간 남았어요', '오늘 오전 11시까지 답하지 않으면 이번 소개는 마무리돼요.', '/us', key);
      n := n + 1;
    end if;
  end loop;
  -- 그날 글: 18:00까지 보내지 않은 회원
  for r in select p.id, p.plan_a, m.member, today - p.start_on + 1 as day from public.programs p
             cross join lateral (values (p.member_a), (p.member_b)) as m(member)
            where p.status = 'started' and m.member is not null and today between p.start_on and p.start_on + 2 and t >= public.kst_at(today, '18:00')
              and not exists (select 1 from public.program_entries e where e.program_id = p.id and e.day = today - p.start_on + 1 and e.kind in ('letter', 'scene') and e.author = m.member) loop
    key := 'remind-letter:' || r.id || ':' || r.day || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-letter', case when r.plan_a = 'A' then '오늘의 편지를 아직 보내지 않았어요' else '오늘의 첫 장면 답을 아직 보내지 않았어요' end,
        '23:59까지 보내야 상대의 글과 함께 열려요.', '/exchange', key);
      n := n + 1;
    end if;
  end loop;
  -- 열린 편지 답장: 18:00 이후, 그날 편지가 함께 열렸는데 아직 답장을 보내지 않은 회원(답장은 다음 날 09:00까지)
  for r in select p.id, p.start_on, m.member, today - p.start_on + 1 as day from public.programs p
             cross join lateral (values (p.member_a), (p.member_b)) as m(member)
            where p.status = 'started' and p.plan_a = 'A' and m.member is not null and today between p.start_on and p.start_on + 2 and t >= public.kst_at(today, '18:00')
              and (select count(*) from public.program_entries e where e.program_id = p.id and e.day = today - p.start_on + 1 and e.kind = 'letter') = 2
              and not exists (select 1 from public.program_entries e where e.program_id = p.id and e.day = today - p.start_on + 1 and e.kind = 'reply' and e.author = m.member) loop
    key := 'remind-reply:' || r.id || ':' || r.day || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-letter', '열린 편지에 아직 답장하지 않았어요',
        '답장은 ' || to_char(today + 1, 'FMMM"월" FMDD"일"') || ' 09:00까지 한 번 보낼 수 있어요. 두 분 모두 보내면 함께 열려요.', '/exchange', key);
      n := n + 1;
    end if;
  end loop;
  -- 교류 방식이 다를 때: 서로 선택하고 24시간이 지나도(합의 마감 24시간 전) 두 분이 고른 방식이 다르면 두 분 모두에게 한 번
  for r in select p.id, p.agree_by, m.member, m.own, m.other from public.programs p
             cross join lateral (values (p.member_a, p.plan_a, p.plan_b), (p.member_b, p.plan_b, p.plan_a)) as m(member, own, other)
            where p.status = 'choosing' and m.member is not null and p.plan_a is not null and p.plan_b is not null and p.plan_a <> p.plan_b
              and t >= p.agree_by - interval '24 hours' and t < p.agree_by loop
    key := 'remind-plan:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-agreement', '두 분이 고른 교류 방식이 달라요',
        '나는 ' || public.program_plan_name(r.own) || ', 상대는 ' || public.program_plan_name(r.other) || '를 골랐어요. 한 분이 상대 방식으로 맞추면 시작일 확인으로 넘어가요. '
        || to_char(r.agree_by at time zone 'Asia/Seoul', 'FMMM"월" FMDD"일" HH24:MI') || '까지 정하지 않으면 이번 소개는 마무리돼요.', '/exchange', key);
      n := n + 1;
    end if;
  end loop;
  -- 교류 합의: 마감 12시간 전까지 확인하지 않은 회원
  for r in select p.id, m.member from public.programs p
             cross join lateral (values (p.member_a, p.confirm_a), (p.member_b, p.confirm_b)) as m(member, confirmed)
            where p.status = 'choosing' and m.member is not null and m.confirmed is null and t >= p.agree_by - interval '12 hours' and t < p.agree_by loop
    key := 'remind-agree:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-agreement', '교류 방식·시작일 마감이 12시간 남았어요', '두 분이 같은 방식과 시작일을 확인해야 교류가 시작돼요. 마감이 지나면 이번 소개는 마무리돼요.', '/exchange', key);
      n := n + 1;
    end if;
  end loop;
  -- 만남 선택: 마감(DAY05 09:00) 14시간 전까지 고르지 않은 회원
  for r in select p.id, m.member from public.programs p
             cross join lateral (values (p.member_a, p.meeting_a), (p.member_b, p.meeting_b)) as m(member, choice)
            where p.status = 'deciding' and m.member is not null and m.choice is null and t >= p.meeting_by - interval '14 hours' and t < p.meeting_by loop
    key := 'remind-meet:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-meeting', '만남 선택 마감이 다가와요', '내일 오전 9시까지 골라 주세요. 답이 없으면 이번 교류는 마무리돼요.', '/exchange', key);
      n := n + 1;
    end if;
  end loop;
  -- 약속 정하기: 마감 이틀 전까지 약속이 없으면 두 분 모두
  for r in select p.id, m.member from public.programs p cross join lateral (values (p.member_a), (p.member_b)) as m(member)
            where p.status = 'arranging' and m.member is not null and p.meeting_on is null and t >= p.arrange_by - interval '48 hours' and t < p.arrange_by loop
    key := 'remind-arrange:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-arrange', '약속 정하기 마감이 이틀 남았어요', '마감까지 약속이 정해지지 않으면 이번 교류는 마무리돼요.', '/meeting', key);
      n := n + 1;
    end if;
  end loop;
  -- 연락처 공개 동의: 만나기 전날 19:00부터, 아직 동의하지 않은 회원
  for r in select p.id, m.member from public.programs p
             cross join lateral (values (p.member_a, p.contact_a), (p.member_b, p.contact_b)) as m(member, consent)
            where p.status = 'arranging' and p.meeting_on is not null and m.member is not null and m.consent is null
              and t >= public.kst_at(p.meeting_on - 1, '19:00') and t < public.kst_at(p.meeting_on, '00:00') loop
    key := 'remind-contact:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-contact', '내일 만나는 날이에요', '연락처 공개에 두 분 모두 동의해야 만나는 날 서로의 번호가 열려요. 약속 화면에서 확인해 주세요.', '/meeting', key);
      n := n + 1;
    end if;
  end loop;
  -- 신청서: 가입하고 하루가 지나도 신청서를 내지 않은 회원에게 딱 한 번(메일 확인을 마친 회원만)
  for r in select p.id as member, c.number, c.application_deadline from public.profiles p
             join auth.users u on u.id = p.id and u.email_confirmed_at is not null
             left join public.applications a on a.member_id = p.id
             left join lateral (select number, application_deadline from public.cohorts where application_deadline >= today order by number limit 1) c on true
            where p.status = 'active' and (a.member_id is null or a.status = 'draft')
              and not exists (select 1 from public.admin_roles ar where ar.user_id = p.id)
              and coalesce(a.updated_at, p.created_at) < t - interval '24 hours' and coalesce(a.updated_at, p.created_at) > t - interval '7 days' loop
    key := 'remind-draft:' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-application', '소개 신청서를 마저 써 주세요',
        '단계마다 저장돼서 쓰던 곳부터 이어서 쓸 수 있어요.' || case when r.application_deadline is not null then ' ' || case when r.number = 0 then '베타' else r.number || '기' end || ' 신청 마감은 ' || to_char(r.application_deadline, 'FMMM"월" FMDD"일"') || '이에요.' else '' end,
        '/apply', key);
      n := n + 1;
    end if;
  end loop;
  if n > 0 then insert into public.job_runs (job, finished_at, ok, detail) values ('reminders', now(), true, jsonb_build_object('sent', n)); end if;
  exception when others then
    insert into public.job_runs (job, finished_at, ok, detail) values ('reminders', now(), false, jsonb_build_object('error', sqlerrm));
  end;
  return n;
end $$;

-- ─────────────────────────────────────────────────────────
-- 권한
revoke all on function public.has_contact(text), public.program_entries_json(uuid, uuid, uuid), public.program_readable(public.programs, uuid), public.my_program_row(),
  public.program_plan_name(text), public.email_class(text), public.run_reminders() from public, anon, authenticated;
revoke all on function public.my_program(), public.choose_program_plan(uuid, text), public.propose_program_start(uuid, date),
  public.submit_program_entry(uuid, int, text, text, jsonb), public.choose_first_scene(uuid, jsonb) from public, anon;
grant execute on function public.my_program(), public.choose_program_plan(uuid, text), public.propose_program_start(uuid, date),
  public.submit_program_entry(uuid, int, text, text, jsonb), public.choose_first_scene(uuid, jsonb) to authenticated;
