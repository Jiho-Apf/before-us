-- 비포어스 서버 5단계: 서로 선택한 뒤의 교류 · 만남 선택 · 약속 · 연락처(V6-program-01, 베타는 결제 없이)
--  1) 합의: 두 사람이 같은 방식(A 편지 · B 첫 장면)과 시작일을 고르고 각자 확인한다. 기한 48시간.
--  2) 교류: 시작일 09:00부터 3일. 그날 글은 두 사람 모두 보내야 함께 열린다(09:00~23:59).
--     A: 하루 한 통 편지 + 열린 편지에 답장 한 번. B: 그날의 첫 장면 질문에 각자 답한다.
--  3) DAY04 09:00: 만나고 싶은지 각자 고른다(24시간). 둘 다 ‘만나고 싶어요’일 때만 약속으로 간다.
--     누가 어떤 답을 했는지는 알려 주지 않는다.
--  4) 약속: 한 사람이 후보 시간(최대 3개)·활동·지역을 제안하고, 상대가 시간 하나를 골라 확정한다. 7일 안에.
--  5) 연락처: 약속이 정해진 뒤 두 사람이 각자 동의하면, 만나는 날 00:00부터 다음 날 23:59까지만 서로의 번호가 보인다.
--  6) 끝: 만나는 날 다음 날 23:59가 지나면 마무리되고, 소개도 닫힌다(다음 소개 준비).
--  차단·신고·탈퇴·이용 정지·운영 취소로 소개가 닫히면 교류도 바로 닫힌다.

-- 시험에서만 시각을 바꿔 볼 수 있게 한다(app.now). 실제 서버에서는 늘 now() 다.
create or replace function public.app_now() returns timestamptz
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('app.now', true), '')::timestamptz, now())
$$;
create or replace function public.kst_date(p_at timestamptz) returns date
language sql immutable set search_path = '' as $$ select (p_at at time zone 'Asia/Seoul')::date $$;

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  introduction_id uuid not null unique references public.introductions (id) on delete cascade,
  member_a uuid not null references public.profiles (id) on delete cascade,
  member_b uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'choosing' check (status in ('choosing', 'scheduled', 'started', 'deciding', 'arranging', 'closed')),
  plan_a text check (plan_a in ('A', 'B')),
  plan_b text check (plan_b in ('A', 'B')),
  start_on date,
  confirm_a timestamptz,
  confirm_b timestamptz,
  agree_by timestamptz not null,
  started_at timestamptz,
  meeting_by timestamptz,
  meeting_a text check (meeting_a in ('positive', 'negative')),
  meeting_a_at timestamptz,
  meeting_b text check (meeting_b in ('positive', 'negative')),
  meeting_b_at timestamptz,
  arrange_by timestamptz,
  meeting_on date,
  meeting_time text,
  contact_a timestamptz,
  contact_b timestamptz,
  closed_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (member_a <> member_b)
);
alter table public.programs enable row level security;
create index programs_member_a on public.programs (member_a, status);
create index programs_member_b on public.programs (member_b, status);

create table public.program_entries (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  day int not null check (day between 1 and 3),
  kind text not null check (kind in ('letter', 'reply', 'scene')),
  author uuid not null references public.profiles (id) on delete cascade,
  body text check (body is null or char_length(body) <= 1000),
  payload jsonb,
  created_at timestamptz not null default now(),
  unique (program_id, day, kind, author)
);
alter table public.program_entries enable row level security;

create table public.appointment_proposals (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  author uuid not null references public.profiles (id) on delete cascade,
  slots jsonb not null,
  activity text not null check (char_length(activity) between 1 and 40),
  region text not null check (char_length(region) between 1 and 40),
  place text check (place is null or char_length(place) <= 80),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'accepted', 'replaced', 'withdrawn')),
  selected jsonb,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.appointment_proposals enable row level security;
create index appointment_proposals_program on public.appointment_proposals (program_id, status);

revoke all on public.programs, public.program_entries, public.appointment_proposals from anon, authenticated;
-- 세 표 모두 회원·운영진이 RPC로만 읽고 쓴다(정책 없음 = 직접 조회 불가).

-- ─────────────────────────────────────────────────────────
-- 도우미
create or replace function public.program_partner(p public.programs, p_me uuid) returns uuid
language sql immutable set search_path = '' as $$ select case when p.member_a = p_me then p.member_b else p.member_a end $$;

-- 교류를 닫는다. 소개도 함께 닫는다(다음 소개 준비로 돌아간다).
create or replace function public.close_program(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.programs;
begin
  update public.programs set status = 'closed', closed_at = now(), end_reason = p_reason, updated_at = now()
   where id = p_id and status <> 'closed' returning * into p;
  if p is null then return; end if;
  perform public.close_introduction(p.introduction_id, 'program-' || p_reason);
end $$;

-- 서로 선택하면 교류 합의를 연다. 열람 기간은 교류가 끝날 때까지로 늘린다.
create or replace function public.open_program_on_mutual() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'mutual' and old.status is distinct from 'mutual' then
    insert into public.programs (introduction_id, member_a, member_b, agree_by)
    values (new.id, new.member_a, new.member_b, now() + interval '48 hours') on conflict (introduction_id) do nothing;
    update public.introductions set view_until = 'infinity' where id = new.id;
  elsif new.status in ('closed', 'cancelled') and old.status is distinct from new.status then
    update public.programs set status = 'closed', closed_at = now(), end_reason = coalesce(nullif(regexp_replace(coalesce(new.end_reason, ''), '^program-', ''), ''), 'closed'), updated_at = now()
     where introduction_id = new.id and status <> 'closed';
  end if;
  return null;
end $$;
create trigger introductions_program after update of status on public.introductions
  for each row execute function public.open_program_on_mutual();

-- 이미 서로 선택한 소개(이 단계 전)는 지금부터 합의를 시작한다.
insert into public.programs (introduction_id, member_a, member_b, agree_by)
select id, member_a, member_b, now() + interval '48 hours' from public.introductions where status = 'mutual'
on conflict (introduction_id) do nothing;
update public.introductions set view_until = 'infinity' where status = 'mutual';

-- 회원 글 검사: 연락처·링크는 막고, 돈 이야기는 운영진 신고함에 자동 표시한다(원문은 남기지 않는다).
create or replace function public.check_member_text(p_text text, p_where text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_text is null or p_text = '' then return; end if;
  if public.has_contact(normalize(p_text, NFKC)) then
    raise exception '연락처·SNS 아이디·링크·계좌번호는 보낼 수 없어요. 연락처는 두 분이 동의하면 만나는 날 비포어스에서 열려요.';
  end if;
  if normalize(p_text, NFKC) ~ '송금|입금|이체|계좌|돈\s*(좀|을|빌려|보내)|빌려\s*(줄|주실|줘)|투자|코인|비트코인|리딩방|대출|상품권|급하게\s*돈' then
    perform public.flag_member_text(auth.uid(), p_where, '금전 요구 의심');
  end if;
end $$;

-- 내 교류 찾기(진행 중이거나 닫힌 지 3일 안)
create or replace function public.my_program_row() returns public.programs
language sql stable security definer set search_path = '' as $$
  select * from public.programs
   where auth.uid() in (member_a, member_b) and (status <> 'closed' or closed_at > now() - interval '3 days')
   order by created_at desc limit 1
$$;

-- ─────────────────────────────────────────────────────────
-- 회원 화면: 내 교류 한눈에
create or replace function public.my_program() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); is_a boolean; partner uuid; i public.introductions; today date := public.kst_date(public.app_now());
  own_plan text; partner_plan text; entries jsonb; proposals jsonb; released boolean; phone text; day_now int; name text;
begin
  if me is null then return null; end if;
  p := public.my_program_row();
  if p.id is null then return null; end if;
  is_a := p.member_a = me; partner := public.program_partner(p, me);
  select * into i from public.introductions where id = p.introduction_id;
  select x ->> 'value' into name from jsonb_array_elements(case when is_a then i.snapshot_b else i.snapshot_a end -> 'items') x where x ->> 'id' = 'self.name';
  own_plan := case when is_a then p.plan_a else p.plan_b end;
  partner_plan := case when is_a then p.plan_b else p.plan_a end;
  day_now := case when p.status = 'started' and today between p.start_on and p.start_on + 2 then today - p.start_on + 1 end;
  -- 그날 글: 내 글은 늘 보이고, 상대 글은 두 사람 모두 보냈을 때만 보인다.
  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'kind', d.kind,
           'own', (select jsonb_build_object('body', e.body, 'payload', e.payload, 'at', e.created_at) from public.program_entries e where e.program_id = p.id and e.day = d.day and e.kind = d.kind and e.author = me),
           'partnerSent', exists (select 1 from public.program_entries e where e.program_id = p.id and e.day = d.day and e.kind = d.kind and e.author = partner),
           'partner', case when (select count(*) from public.program_entries e where e.program_id = p.id and e.day = d.day and e.kind = d.kind) = 2
             then (select jsonb_build_object('body', e.body, 'payload', e.payload, 'at', e.created_at) from public.program_entries e where e.program_id = p.id and e.day = d.day and e.kind = d.kind and e.author = partner) end
         ) order by d.day, d.kind), '[]'::jsonb) into entries
    from (select distinct day, kind from public.program_entries where program_id = p.id) d;
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
    'entries', entries,
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

-- 1) 합의: 방식 고르기 · 시작일 제안 · 확인
create or replace function public.choose_program_plan(p_program uuid, p_plan text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); is_a boolean; tomorrow date := public.kst_date(public.app_now()) + 1;
begin
  if p_plan not in ('A', 'B') then raise exception 'A 또는 B를 골라 주세요.'; end if;
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'choosing' or public.app_now() >= p.agree_by then raise exception '지금은 방식을 바꿀 수 없어요.'; end if;
  is_a := p.member_a = me;
  if (case when is_a then p.plan_a else p.plan_b end) is distinct from p_plan then
    if is_a then update public.programs set plan_a = p_plan, confirm_a = null, confirm_b = null, updated_at = now() where id = p.id returning * into p;
    else update public.programs set plan_b = p_plan, confirm_a = null, confirm_b = null, updated_at = now() where id = p.id returning * into p; end if;
    if p.plan_a = p.plan_b and (p.start_on is null or p.start_on < tomorrow) then update public.programs set start_on = tomorrow where id = p.id; end if;
    perform public.notify(public.program_partner(p, me), 'program-plan', '상대가 교류 방식을 골랐어요', '두 분이 같은 방식을 고르면 시작일을 함께 확인해요.', '/exchange', 'plan:' || p.id || ':' || me || ':' || p_plan);
  end if;
  return public.my_program();
end $$;

create or replace function public.propose_program_start(p_program uuid, p_date date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); today date := public.kst_date(public.app_now());
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'choosing' or public.app_now() >= p.agree_by then raise exception '지금은 시작일을 바꿀 수 없어요.'; end if;
  if p.plan_a is null or p.plan_a is distinct from p.plan_b then raise exception '두 분이 같은 방식을 고른 뒤 시작일을 정할 수 있어요.'; end if;
  if p_date is null or p_date < today + 1 or p_date > today + 14 then raise exception '내일부터 14일 안의 날짜를 골라 주세요.'; end if;
  if p.start_on is distinct from p_date then
    update public.programs set start_on = p_date, confirm_a = null, confirm_b = null, updated_at = now() where id = p.id;
    perform public.notify(public.program_partner(p, me), 'program-date', '상대가 시작일을 제안했어요', to_char(p_date, 'FMMM"월" FMDD"일"') || ' 09:00 시작이에요. 확인해 주세요.', '/exchange', 'date:' || p.id || ':' || me || ':' || p_date);
  end if;
  return public.my_program();
end $$;

create or replace function public.confirm_program(p_program uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); today date := public.kst_date(public.app_now());
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'choosing' or public.app_now() >= p.agree_by then raise exception '지금은 확인할 수 없어요.'; end if;
  if p.plan_a is null or p.plan_a is distinct from p.plan_b or p.start_on is null then raise exception '같은 방식과 시작일이 먼저 필요해요.'; end if;
  if p.start_on <= today then
    update public.programs set start_on = today + 1, confirm_a = null, confirm_b = null, updated_at = now() where id = p.id;
    return public.my_program() || jsonb_build_object('notice', '시작일이 지나 내일로 다시 제안했어요. 두 분 모두 다시 확인해 주세요.');
  end if;
  if p.member_a = me then update public.programs set confirm_a = now(), updated_at = now() where id = p.id returning * into p;
  else update public.programs set confirm_b = now(), updated_at = now() where id = p.id returning * into p; end if;
  if p.confirm_a is not null and p.confirm_b is not null then
    update public.programs set status = 'scheduled', updated_at = now() where id = p.id;
    perform public.notify(m, 'program-scheduled', '교류 일정이 정해졌어요', to_char(p.start_on, 'FMMM"월" FMDD"일"') || ' 09:00에 첫날이 열려요.', '/exchange', 'scheduled:' || p.id || ':' || m)
      from unnest(array[p.member_a, p.member_b]) m;
  else
    perform public.notify(public.program_partner(p, me), 'program-confirm', '상대가 교류 일정을 확인했어요', '내 확인만 남았어요.', '/exchange', 'confirm:' || p.id || ':' || me || ':' || p.start_on);
  end if;
  return public.my_program();
end $$;

-- 2) 교류 글: 편지(A) · 답장(A) · 첫 장면(B)
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
    if p_day = 1 and coalesce(p_payload ->> 'activity', '') not in ('exhibition', 'walk', 'bookstore') then raise exception '시작하고 싶은 분위기를 골라 주세요.'; end if;
    if p_day = 2 and (coalesce(p_payload ->> 'flow', '') not in ('짧게 둘러보기', '천천히 머물기') or coalesce(p_payload ->> 'rest', '') not in ('조용한 카페', '공공 야외 공간')) then raise exception '흐름과 쉬어 갈 곳을 골라 주세요.'; end if;
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
    perform public.notify(m, 'program-open', 'DAY0' || p_day || ' ' || label || '이(가) 열렸어요', '두 분이 모두 보내서 함께 열렸어요.', '/exchange', 'open:' || p.id || ':' || p_day || ':' || p_kind || ':' || m)
      from unnest(array[p.member_a, p.member_b]) m;
  else
    perform public.notify(partner, 'program-sent', '상대가 오늘의 ' || label || '을(를) 보냈어요', '내 글도 보내면 23:59 전에 함께 열려요.', '/exchange', 'sent:' || p.id || ':' || p_day || ':' || p_kind || ':' || me);
  end if;
  return public.my_program();
end $$;

-- 3) DAY04: 만나고 싶은지 고르기
create or replace function public.choose_meeting(p_program uuid, p_choice text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid();
begin
  if p_choice not in ('positive', 'negative') then raise exception '답을 골라 주세요.'; end if;
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'deciding' or public.app_now() >= p.meeting_by then raise exception '지금은 만남을 고를 수 없어요.'; end if;
  if (case when p.member_a = me then p.meeting_a else p.meeting_b end) is not null then raise exception '이미 골랐어요. 답은 바꿀 수 없어요.'; end if;
  if p.member_a = me then update public.programs set meeting_a = p_choice, meeting_a_at = now(), updated_at = now() where id = p.id returning * into p;
  else update public.programs set meeting_b = p_choice, meeting_b_at = now(), updated_at = now() where id = p.id returning * into p; end if;
  if p.meeting_a is not null and p.meeting_b is not null then
    if p.meeting_a = 'positive' and p.meeting_b = 'positive' then
      update public.programs set status = 'arranging', arrange_by = now() + interval '7 days', updated_at = now() where id = p.id;
      perform public.notify(m, 'meeting-mutual', '두 분 모두 만나고 싶다고 했어요', '7일 안에 약속을 함께 정해 주세요.', '/meeting', 'meet:' || p.id || ':' || m) from unnest(array[p.member_a, p.member_b]) m;
    else
      perform public.close_program(p.id, 'meeting-declined');
      perform public.notify(m, 'program-closed', '이번 교류는 여기서 마무리됐어요', '누가 어떤 답을 했는지는 알려 드리지 않아요. 다음 소개를 준비할게요.', '/today', 'pclosed:' || p.id || ':' || m) from unnest(array[p.member_a, p.member_b]) m;
    end if;
  end if;
  return public.my_program();
end $$;

-- 4) 약속: 제안 · 수락(시간 하나 고르기)
create or replace function public.propose_appointment(p_program uuid, p_slots jsonb, p_activity text, p_region text, p_place text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); s jsonb; today date := public.kst_date(public.app_now()); dates date[] := '{}';
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'arranging' or (p.meeting_on is null and public.app_now() >= p.arrange_by) then raise exception '지금은 약속을 제안할 수 없어요.'; end if;
  if p.meeting_on is not null and public.app_now() >= public.kst_at(p.meeting_on, '00:00') then raise exception '만나는 날이 되어 약속을 바꿀 수 없어요. 일정이 어려우면 문의해 주세요.'; end if;
  if jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots) not between 1 and 3 then raise exception '후보 시간을 1~3개 골라 주세요.'; end if;
  for s in select * from jsonb_array_elements(p_slots) loop
    if coalesce(s ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(s ->> 'start', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' or coalesce(s ->> 'end', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' or s ->> 'start' >= s ->> 'end' then
      raise exception '후보 시간의 날짜와 시작·끝 시각을 확인해 주세요.';
    end if;
    if (s ->> 'date')::date < today + 1 or (s ->> 'date')::date > today + 21 then raise exception '내일부터 3주 안의 날짜로 제안해 주세요.'; end if;
    if (s ->> 'date')::date = any (dates) then raise exception '후보 날짜는 서로 달라야 해요.'; end if;
    dates := dates || (s ->> 'date')::date;
  end loop;
  perform public.check_member_text(concat_ws(' ', p_activity, p_region, p_place, p_note), '약속 제안');
  update public.appointment_proposals set status = 'replaced' where program_id = p.id and status = 'open';
  insert into public.appointment_proposals (program_id, author, slots, activity, region, place, note)
  values (p.id, me, p_slots, trim(p_activity), trim(p_region), nullif(trim(coalesce(p_place, '')), ''), nullif(trim(coalesce(p_note, '')), ''));
  perform public.notify(public.program_partner(p, me), 'appointment-new', '약속 제안이 도착했어요', '후보 시간 중 하나를 고르거나 다른 시간을 제안해 주세요.', '/meeting', 'proposal:' || p.id || ':' || me || ':' || extract(epoch from now())::bigint);
  return public.my_program();
end $$;

create or replace function public.accept_appointment(p_proposal uuid, p_slot int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointment_proposals; p public.programs; me uuid := auth.uid(); s jsonb;
begin
  select * into a from public.appointment_proposals where id = p_proposal for update;
  if a.id is null then raise exception '약속 제안을 찾을 수 없어요.'; end if;
  select * into p from public.programs where id = a.program_id for update;
  if me not in (p.member_a, p.member_b) then raise exception '약속 제안을 찾을 수 없어요.'; end if;
  if a.author = me then raise exception '내가 보낸 제안은 상대가 골라야 해요.'; end if;
  if a.status <> 'open' or p.status <> 'arranging' then raise exception '이미 정해졌거나 바뀐 제안이에요.'; end if;
  s := a.slots -> p_slot;
  if s is null then raise exception '후보 시간을 하나 골라 주세요.'; end if;
  if (s ->> 'date')::date <= public.kst_date(public.app_now()) then raise exception '지난 날짜예요. 새 시간을 제안해 주세요.'; end if;
  update public.appointment_proposals set status = 'replaced' where program_id = p.id and status = 'accepted';
  update public.appointment_proposals set status = 'accepted', selected = s, accepted_at = now() where id = a.id;
  -- 약속이 바뀌면 연락처 동의도 새 약속 기준으로 다시 받는다.
  update public.programs set meeting_on = (s ->> 'date')::date, meeting_time = (s ->> 'start') || '~' || (s ->> 'end'), contact_a = null, contact_b = null, updated_at = now() where id = p.id;
  perform public.notify(m, 'appointment-final', '약속이 정해졌어요', to_char((s ->> 'date')::date, 'FMMM"월" FMDD"일"') || ' ' || (s ->> 'start') || ' · ' || a.activity || ' · ' || a.region, '/meeting', 'final:' || a.id || ':' || m)
    from unnest(array[p.member_a, p.member_b]) m;
  return public.my_program();
end $$;

-- 5) 연락처 공개 동의(만나는 날 00:00부터 다음 날 23:59까지만 보인다)
create or replace function public.set_contact_consent(p_program uuid, p_allowed boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid();
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'arranging' or p.meeting_on is null then raise exception '약속이 정해진 뒤에 고를 수 있어요.'; end if;
  if public.app_now() >= public.kst_at(p.meeting_on + 2, '00:00') then raise exception '연락처 공개 기간이 지났어요.'; end if;
  if not p_allowed and public.app_now() >= public.kst_at(p.meeting_on, '00:00') and p.contact_a is not null and p.contact_b is not null then
    raise exception '이미 열린 연락처는 거둘 수 없어요. 불편한 일이 있으면 신고해 주세요.';
  end if;
  if p.member_a = me then update public.programs set contact_a = case when p_allowed then coalesce(contact_a, now()) end, updated_at = now() where id = p.id;
  else update public.programs set contact_b = case when p_allowed then coalesce(contact_b, now()) end, updated_at = now() where id = p.id; end if;
  return public.my_program();
end $$;

-- ─────────────────────────────────────────────────────────
-- 예약 작업(10분마다): 기한·시작·DAY 열림·만남 선택·연락처 공개·마무리
create or replace function public.run_programs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; t timestamptz := public.app_now(); d int; n jsonb := '{}'::jsonb; c int := 0;
begin
  for r in select * from public.programs where status = 'choosing' and agree_by <= t loop
    perform public.close_program(r.id, 'agreement-expired');
    perform public.notify(m, 'program-closed', '교류 방식이 정해지지 않았어요', '합의 기한(48시간)이 지나 이번 소개는 여기서 마무리돼요. 다음 소개를 준비할게요.', '/today', 'pclosed:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('expired', c); c := 0;
  for r in select * from public.programs where status = 'scheduled' and t >= public.kst_at(start_on, '09:00') loop
    update public.programs set status = 'started', started_at = t, updated_at = now() where id = r.id;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('started', c); c := 0;
  for r in select * from public.programs where status = 'started' loop
    for d in 1..3 loop
      if t >= public.kst_at(r.start_on + d - 1, '09:00') and public.kst_date(t) = r.start_on + d - 1 then
        perform public.notify(m, 'program-day', 'DAY0' || d || '이 열렸어요', case when r.plan_a = 'A' then '오늘의 편지를 23:59까지 보내 주세요.' else '오늘의 첫 장면 질문에 23:59까지 답해 주세요.' end, '/exchange', 'day:' || r.id || ':' || d || ':' || m)
          from unnest(array[r.member_a, r.member_b]) m;
      end if;
    end loop;
    if t >= public.kst_at(r.start_on + 3, '09:00') then
      update public.programs set status = 'deciding', meeting_by = public.kst_at(r.start_on + 3, '09:00') + interval '24 hours', updated_at = now() where id = r.id;
      perform public.notify(m, 'meeting-open', '만남을 정할 시간이에요', '내일 09:00까지 만나고 싶은지 골라 주세요. 상대의 답은 알려 드리지 않아요.', '/exchange', 'decide:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m;
      c := c + 1;
    end if;
  end loop;
  n := n || jsonb_build_object('deciding', c); c := 0;
  for r in select * from public.programs where status = 'deciding' and meeting_by <= t loop
    perform public.close_program(r.id, 'meeting-nonresponse');
    perform public.notify(m, 'program-closed', '이번 교류는 여기서 마무리됐어요', '만남 선택 기한이 지났어요. 다음 소개를 준비할게요.', '/today', 'pclosed:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m;
    c := c + 1;
  end loop;
  for r in select * from public.programs where status = 'arranging' and meeting_on is null and arrange_by <= t loop
    perform public.close_program(r.id, 'arrange-expired');
    perform public.notify(m, 'program-closed', '약속이 정해지지 않았어요', '7일 안에 약속이 정해지지 않아 이번 교류는 여기서 마무리돼요. 다음 소개를 준비할게요.', '/today', 'pclosed:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m;
    c := c + 1;
  end loop;
  for r in select * from public.programs where status = 'arranging' and meeting_on is not null and contact_a is not null and contact_b is not null and t >= public.kst_at(meeting_on, '00:00') and t < public.kst_at(meeting_on + 2, '00:00') loop
    perform public.notify(m, 'contact-released', '오늘 만나는 분의 연락처가 열렸어요', '내일 23:59까지 비포어스 안에서 볼 수 있어요.', '/meeting', 'contact:' || r.id || ':' || r.meeting_on || ':' || m) from unnest(array[r.member_a, r.member_b]) m;
  end loop;
  for r in select * from public.programs where status = 'arranging' and meeting_on is not null and t >= public.kst_at(meeting_on + 2, '00:00') loop
    perform public.close_program(r.id, 'completed');
    perform public.notify(m, 'program-completed', '만남은 어떠셨나요?', '이번 교류는 마무리됐어요. 불편한 일이 있었다면 문의·신고로 알려 주세요.', '/today', 'done:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('closed', c);
  if (n ->> 'expired')::int + (n ->> 'started')::int + (n ->> 'deciding')::int + (n ->> 'closed')::int > 0 then
    insert into public.job_runs (job, finished_at, ok, detail) values ('programs', now(), true, n);
  end if;
  return n;
end $$;

-- 보존: 편지·첫 장면은 교류가 끝나고 30일 뒤, 약속 상세는 만난 날부터 90일 뒤 지운다.
create or replace function public.run_program_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e int; a int;
begin
  delete from public.program_entries x using public.programs p where x.program_id = p.id and p.status = 'closed' and p.closed_at < now() - interval '30 days';
  get diagnostics e = row_count;
  delete from public.appointment_proposals x using public.programs p where x.program_id = p.id and p.status = 'closed'
     and coalesce(public.kst_at(p.meeting_on, '00:00'), p.closed_at) < now() - interval '90 days';
  get diagnostics a = row_count;
  insert into public.job_runs (job, finished_at, ok, detail) values ('program-retention', now(), true, jsonb_build_object('entries', e, 'proposals', a));
  return jsonb_build_object('entries', e, 'proposals', a);
end $$;

-- ─────────────────────────────────────────────────────────
-- 운영진: 교류 목록 · 운영 종료. 글 원문은 보지 않는다(신고가 확인된 경우에만 따로 연다).
create or replace function public.admin_list_programs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'introductionId', p.introduction_id, 'status', p.status, 'endReason', p.end_reason, 'createdAt', p.created_at, 'closedAt', p.closed_at,
      'nameA', aa.draft -> 'values' ->> 'self.name', 'nameB', ab.draft -> 'values' ->> 'self.name',
      'planA', p.plan_a, 'planB', p.plan_b, 'startOn', p.start_on, 'agreeBy', p.agree_by, 'confirmed', (p.confirm_a is not null)::int + (p.confirm_b is not null)::int,
      'entriesA', (select count(*) from public.program_entries e where e.program_id = p.id and e.author = p.member_a),
      'entriesB', (select count(*) from public.program_entries e where e.program_id = p.id and e.author = p.member_b),
      'meetingAnswers', (p.meeting_a is not null)::int + (p.meeting_b is not null)::int, 'meetingBy', p.meeting_by,
      'arrangeBy', p.arrange_by, 'meetingOn', p.meeting_on, 'meetingTime', p.meeting_time, 'contacts', (p.contact_a is not null)::int + (p.contact_b is not null)::int
    ) order by p.status = 'closed', p.created_at desc)
    from public.programs p
    left join public.applications aa on aa.member_id = p.member_a
    left join public.applications ab on ab.member_id = p.member_b
    where p.status <> 'closed' or p.closed_at > now() - interval '30 days'), '[]'::jsonb);
end $$;

create or replace function public.admin_close_program(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.programs;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '종료 사유를 적어 주세요(감사 기록에만 남아요).'; end if;
  select * into p from public.programs where id = p_id;
  if p.id is null or p.status = 'closed' then raise exception '닫을 수 있는 교류가 없어요.'; end if;
  perform public.close_program(p_id, 'admin-cancel');
  perform public.notify(m, 'program-closed', '이번 교류는 여기서 마무리됐어요', '운영 사정으로 교류를 마무리했어요. 궁금한 점은 문의로 남겨 주세요.', '/today', 'pclosed:' || p_id || ':' || m) from unnest(array[p.member_a, p.member_b]) m;
  perform public.write_audit('교류 운영 종료', p_id::text, p_reason);
end $$;

-- 권한
revoke all on function public.app_now(), public.close_program(uuid, text), public.open_program_on_mutual(), public.check_member_text(text, text),
  public.my_program_row(), public.run_programs(), public.run_program_retention(), public.program_partner(public.programs, uuid) from public, anon, authenticated;
revoke all on function public.my_program(), public.choose_program_plan(uuid, text), public.propose_program_start(uuid, date), public.confirm_program(uuid),
  public.submit_program_entry(uuid, int, text, text, jsonb), public.choose_meeting(uuid, text), public.propose_appointment(uuid, jsonb, text, text, text, text),
  public.accept_appointment(uuid, int), public.set_contact_consent(uuid, boolean), public.admin_list_programs(), public.admin_close_program(uuid, text) from public, anon;
grant execute on function public.my_program(), public.choose_program_plan(uuid, text), public.propose_program_start(uuid, date), public.confirm_program(uuid),
  public.submit_program_entry(uuid, int, text, text, jsonb), public.choose_meeting(uuid, text), public.propose_appointment(uuid, jsonb, text, text, text, text),
  public.accept_appointment(uuid, int), public.set_contact_consent(uuid, boolean), public.admin_list_programs(), public.admin_close_program(uuid, text) to authenticated;
