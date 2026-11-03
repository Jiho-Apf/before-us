-- 4800: 플라비만의 재미 — 아직 모르는 당신에게 · 창가 질문 · 닮은 두 문장 · 한 줄 엽서 · 셋째 날 질문 · 책갈피 · 우리의 사흘, 한 권
--
-- 1) 아직 모르는 당신에게: 승인된 회원은 아직 모르는 다음 사람에게 편지 한 장을 써 둔다(20~600자).
--    두 분 모두 ‘알아가고 싶어요’를 고른 순간에만 그 소개에 붙어 상대에게 보이고, 넘긴 소개에는 아무것도 가지 않는다.
--    정오에 열린 소개에 답하는 동안(응답 마감 전)에는 고치거나 지울 수 없다. 운영진은 읽지 않는다.
-- 2) 창가 질문: 2주마다 바뀌는 질문 하나(2026-11-02부터). 답은 운영진만 보고, 소개를 고를 때 참고하면 그 소개에 표시한다.
-- 3) 닮은 두 문장: 운영진이 두 분의 공개 소개에서 한 문장씩 골라 나란히 보여 준다(각자 직접 쓴 문장 그대로만).
-- 4) 한 줄 엽서(A): 바쁜 날 편지 대신 5~80자 엽서 한 줄. 사흘 중 한 번. 편지와 똑같이 두 분 모두 보내면 함께 열린다.
-- 5) 셋째 날 질문(A · 선택): 둘째 날 09:00~셋째 날 09:00에 상대에게 물을 질문을 내면, 상대의 셋째 날 질문이 그것으로 바뀐다.
--    낸 질문은 셋째 날 09:00에 상대에게 보인다. 내지 않으면 원래 질문 그대로.
-- 6) 책갈피: 사흘 동안 상대 글(함께 열린 글)에서 문장 하나에 밑줄. 넷째 날 09:00부터 상대에게 ‘밑줄 그은 내 문장’으로 보인다.
-- 7) 우리의 사흘, 한 권: 넷째 날 두 분 모두 만나고 싶다고 한 교류는, 두 분 모두 동의하면 한 권(인쇄용 화면)으로 펼칠 수 있다.

alter table public.programs
  add column if not exists ask_a text check (char_length(ask_a) between 5 and 80),
  add column if not exists ask_b text check (char_length(ask_b) between 5 and 80),
  add column if not exists mark_a text check (char_length(mark_a) between 2 and 300),
  add column if not exists mark_b text check (char_length(mark_b) between 2 and 300),
  add column if not exists book_a timestamptz,
  add column if not exists book_b timestamptz;

alter table public.introductions
  add column if not exists echo_a text check (char_length(echo_a) between 4 and 120),
  add column if not exists echo_b text check (char_length(echo_b) between 4 and 120),
  add column if not exists window_a boolean not null default false,
  add column if not exists window_b boolean not null default false;

-- ─────────────────────────────────────────────────────────
-- 1) 아직 모르는 당신에게
create table if not exists public.prelude_letters (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 20 and 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  introduction_id uuid references public.introductions (id) on delete cascade,
  delivered_at timestamptz
);
create unique index if not exists prelude_letters_draft on public.prelude_letters (member_id) where introduction_id is null;
create unique index if not exists prelude_letters_intro on public.prelude_letters (introduction_id, member_id) where introduction_id is not null;
alter table public.prelude_letters enable row level security;
revoke all on public.prelude_letters from anon, authenticated;

-- 정오에 열린 소개에 답하는 동안(응답 마감 전)에는 고치거나 지우지 않는다(아직 모르는 사람에게 쓴 편지로 남게).
create or replace function public.prelude_locked(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.introductions i where p_member in (i.member_a, i.member_b)
                  and i.status = 'published' and i.reveal_at <= now() and now() < i.respond_by)
$$;
revoke all on function public.prelude_locked(uuid) from public, anon, authenticated;

create or replace function public.my_prelude() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); l public.prelude_letters;
begin
  if me is null then return null; end if;
  select * into l from public.prelude_letters where member_id = me and introduction_id is null;
  return jsonb_build_object('body', l.body, 'updatedAt', l.updated_at, 'locked', public.prelude_locked(me),
    'delivered', (select count(*)::int from public.prelude_letters where member_id = me and introduction_id is not null));
end $$;

create or replace function public.save_prelude(p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); clean text := trim(coalesce(p_body, ''));
begin
  if me is null or not public.is_active_member() then raise exception '로그인한 회원만 쓸 수 있어요.'; end if;
  if not exists (select 1 from public.applications where member_id = me and status = 'approved') then raise exception '신청서가 승인된 뒤에 쓸 수 있어요.'; end if;
  if public.prelude_locked(me) then raise exception '정오에 받은 소개에 답하는 동안에는 고칠 수 없어요.'; end if;
  if char_length(clean) < 20 or char_length(clean) > 600 then raise exception '20~600자로 써 주세요.'; end if;
  perform public.check_member_text(clean, '소개 전 편지');
  insert into public.prelude_letters (member_id, body) values (me, clean)
  on conflict (member_id) where introduction_id is null do update set body = excluded.body, updated_at = now();
  return public.my_prelude();
end $$;

create or replace function public.delete_prelude() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception '로그인이 필요해요.'; end if;
  if public.prelude_locked(me) then raise exception '정오에 받은 소개에 답하는 동안에는 지울 수 없어요.'; end if;
  delete from public.prelude_letters where member_id = me and introduction_id is null;
  if not found then raise exception '지울 편지가 없어요.'; end if;
  return public.my_prelude();
end $$;

revoke all on function public.my_prelude(), public.save_prelude(text), public.delete_prelude() from public, anon;
grant execute on function public.my_prelude(), public.save_prelude(text), public.delete_prelude() to authenticated;

-- ─────────────────────────────────────────────────────────
-- 2) 창가 질문: 2주마다(2026-11-02 월요일부터) 하나씩. 질문은 뒤에만 덧붙인다.
create table if not exists public.window_answers (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  period int not null,
  question text not null,
  body text not null check (char_length(body) between 2 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  used_at timestamptz,
  used_intro uuid references public.introductions (id) on delete set null,
  unique (member_id, period)
);
alter table public.window_answers enable row level security;
revoke all on public.window_answers from anon, authenticated;

create or replace function public.window_period(p_day date) returns int
language sql immutable set search_path = '' as $$ select floor((p_day - date '2026-11-02') / 14.0)::int $$;
create or replace function public.window_question(p_period int) returns text
language sql immutable set search_path = '' as $$
  select (array[
    '요즘 가장 오래 머문 장소는 어디예요?',
    '최근에 혼자 웃었던 순간이 있나요?',
    '요즘 자주 듣는 노래 한 곡을 알려 주세요.',
    '누군가와 함께라면 해 보고 싶은 작은 일은요?',
    '하루 중 가장 아끼는 시간대는 언제예요?',
    '최근에 마음이 편해졌던 장면 하나를 들려주세요.',
    '처음 만난 사람에게 편안함을 느끼는 순간은 언제예요?',
    '이번 계절에 꼭 해 보고 싶은 것 하나는요?',
    '요즘의 나를 한 단어로 말한다면요?',
    '대화가 잘 통한다고 느끼는 사람은 어떤 사람이에요?',
    '쉬는 날 아침, 가장 먼저 하는 일은요?',
    '요즘 새로 배워 보고 싶은 것이 있나요?'
  ])[((p_period % 12) + 12) % 12 + 1]
$$;

create or replace function public.my_window() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); n int := public.window_period(public.kst_date(public.app_now())); w public.window_answers;
begin
  if me is null then return null; end if;
  select * into w from public.window_answers where member_id = me and period = n;
  return jsonb_build_object('period', n, 'question', public.window_question(n), 'until', date '2026-11-02' + n * 14 + 13,
    'nextOn', date '2026-11-02' + (n + 1) * 14, 'answer', w.body, 'usedAt', w.used_at);
end $$;

create or replace function public.save_window_answer(p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); clean text := trim(coalesce(p_body, '')); n int := public.window_period(public.kst_date(public.app_now())); w public.window_answers;
begin
  if me is null or not public.is_active_member() then raise exception '로그인한 회원만 답할 수 있어요.'; end if;
  if not exists (select 1 from public.applications where member_id = me and status = 'approved') then raise exception '신청서가 승인된 뒤에 답할 수 있어요.'; end if;
  if char_length(clean) < 2 or char_length(clean) > 200 then raise exception '2~200자로 적어 주세요.'; end if;
  perform public.check_member_text(clean, '창가 질문');
  select * into w from public.window_answers where member_id = me and period = n for update;
  if w.used_at is not null then raise exception '이미 소개를 고를 때 참고한 답이라 고칠 수 없어요.'; end if;
  insert into public.window_answers (member_id, period, question, body) values (me, n, public.window_question(n), clean)
  on conflict (member_id, period) do update set body = excluded.body, updated_at = now();
  return public.my_window();
end $$;

create or replace function public.delete_window_answer() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.'; end if;
  delete from public.window_answers where member_id = auth.uid() and period = public.window_period(public.kst_date(public.app_now())) and used_at is null;
  if not found then raise exception '지울 수 있는 답이 없어요.'; end if;
  return public.my_window();
end $$;

revoke all on function public.my_window(), public.save_window_answer(text), public.delete_window_answer() from public, anon;
grant execute on function public.my_window(), public.save_window_answer(text), public.delete_window_answer() to authenticated;

-- ─────────────────────────────────────────────────────────
-- 3) 닮은 두 문장: 상대에게 보이는 소개(사본)의 글. 이름은 빼고, 여러 개 고른 값은 줄마다 하나씩.
create or replace function public.profile_text(p_snapshot jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce(string_agg(case when jsonb_typeof(x -> 'value') = 'array'
                                  then (select string_agg(v, E'\n') from jsonb_array_elements_text(x -> 'value') v)
                                  else x ->> 'value' end, E'\n'), '') || E'\n' || coalesce(p_snapshot ->> 'greeting', '')
    from jsonb_array_elements(coalesce(p_snapshot -> 'items', '[]'::jsonb)) x
   where x ->> 'id' <> 'self.name'
$$;

-- 운영진 매칭 화면: 닮은 두 문장을 고를 수 있게, 상대에게 보이는 소개 글만 돌려준다.
create or replace function public.admin_public_profile(p_member uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  return public.public_profile(p_member) - 'photos';
end $$;
revoke all on function public.admin_public_profile(uuid) from public, anon;
grant execute on function public.admin_public_profile(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────
-- 5) 셋째 날 질문 · 6) 책갈피 · 7) 한 권
create or replace function public.set_day3_question(p_program uuid, p_question text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); clean text := nullif(trim(coalesce(p_question, '')), ''); t timestamptz := public.app_now();
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'started' or p.plan_a <> 'A' then raise exception '편지 나누기 교류에서만 낼 수 있어요.'; end if;
  if t < public.kst_at(p.start_on + 1, '09:00') or t >= public.kst_at(p.start_on + 2, '09:00') then
    raise exception '셋째 날 질문은 둘째 날 09:00부터 셋째 날 09:00 전까지 낼 수 있어요.';
  end if;
  if clean is not null then
    if char_length(clean) < 5 or char_length(clean) > 80 then raise exception '질문은 5~80자로 적어 주세요.'; end if;
    perform public.check_member_text(clean, '셋째 날 질문');
  end if;
  if p.member_a = me then update public.programs set ask_a = clean, updated_at = now() where id = p.id;
  else update public.programs set ask_b = clean, updated_at = now() where id = p.id; end if;
  return public.my_program();
end $$;

create or replace function public.set_bookmark(p_program uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); partner uuid; clean text := nullif(trim(coalesce(p_text, '')), ''); txt text;
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'started' then raise exception '밑줄은 사흘 동안(넷째 날 09:00 전까지) 그을 수 있어요.'; end if;
  partner := public.program_partner(p, me);
  if clean is not null then
    if char_length(clean) < 2 or char_length(clean) > 300 then raise exception '밑줄은 300자 안의 문장 하나에 그어 주세요.'; end if;
    -- 함께 열린 상대 글(편지·답장·첫 장면 답·첫 장면 이야기)과 상대가 남긴 한마디에서만
    select string_agg(concat_ws(E'\n', e.body, e.payload ->> 'about', e.payload ->> 'reaction'), E'\n') into txt
      from public.program_entries e
     where e.program_id = p.id and e.author = partner
       and (e.kind in ('comment', 'piece-comment')
            or (select count(*) from public.program_entries x where x.program_id = p.id and x.day = e.day and x.kind = e.kind) = 2);
    if txt is null or position(clean in txt) = 0 then raise exception '상대가 쓴 글에서 문장 하나를 골라 주세요.'; end if;
  end if;
  if p.member_a = me then update public.programs set mark_a = clean, updated_at = now() where id = p.id;
  else update public.programs set mark_b = clean, updated_at = now() where id = p.id; end if;
  return public.my_program();
end $$;

create or replace function public.set_book_consent(p_program uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid();
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.meeting_a is distinct from 'positive' or p.meeting_b is distinct from 'positive' then
    raise exception '넷째 날 두 분 모두 만나고 싶다고 한 교류만 한 권으로 남길 수 있어요.';
  end if;
  if not (p.status = 'arranging' or public.program_readable(p, me)) then raise exception '다시 읽을 수 있는 동안에만 정할 수 있어요.'; end if;
  if p.member_a = me then update public.programs set book_a = case when p_on then coalesce(book_a, now()) end, updated_at = now() where id = p.id returning * into p;
  else update public.programs set book_b = case when p_on then coalesce(book_b, now()) end, updated_at = now() where id = p.id returning * into p; end if;
  return jsonb_build_object('ownBook', p_on, 'bookOpen', p.book_a is not null and p.book_b is not null);
end $$;

revoke all on function public.set_day3_question(uuid, text), public.set_bookmark(uuid, text), public.set_book_consent(uuid, boolean) from public, anon;
grant execute on function public.set_day3_question(uuid, text), public.set_bookmark(uuid, text), public.set_book_consent(uuid, boolean) to authenticated;

-- 교류 화면에 덧붙이는 것: 내 이름(한 권 표지) · 소개 전 편지 · 셋째 날 질문 · 책갈피 · 한 권 동의 · 닮은 두 문장
-- 상대가 낸 질문은 셋째 날 09:00부터, 상대가 그은 밑줄은 넷째 날(만남 선택)부터 보인다.
create or replace function public.program_extras(p public.programs, p_me uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare is_a boolean := p.member_a = p_me; i public.introductions; own_name text;
  ask_open boolean := p.start_on is not null and public.app_now() >= public.kst_at(p.start_on + 2, '09:00');
  mark_open boolean := p.status in ('deciding', 'arranging', 'closed');
begin
  select * into i from public.introductions where id = p.introduction_id;
  select x ->> 'value' into own_name from jsonb_array_elements(coalesce(case when is_a then i.snapshot_a else i.snapshot_b end -> 'items', '[]'::jsonb)) x where x ->> 'id' = 'self.name';
  return jsonb_build_object(
    'ownName', own_name,
    'prelude', jsonb_build_object(
      'own', (select l.body from public.prelude_letters l where l.introduction_id = p.introduction_id and l.member_id = p_me),
      'partner', (select l.body from public.prelude_letters l where l.introduction_id = p.introduction_id and l.member_id = public.program_partner(p, p_me))),
    'ownAsk', case when is_a then p.ask_a else p.ask_b end,
    'partnerAsk', case when ask_open then (case when is_a then p.ask_b else p.ask_a end) end,
    'ownMark', case when is_a then p.mark_a else p.mark_b end,
    'partnerMark', case when mark_open then (case when is_a then p.mark_b else p.mark_a end) end,
    'ownBook', (case when is_a then p.book_a else p.book_b end) is not null,
    'bookOpen', p.book_a is not null and p.book_b is not null,
    'echo', case when i.echo_a is not null and i.echo_b is not null
                 then jsonb_build_object('own', case when is_a then i.echo_a else i.echo_b end, 'partner', case when is_a then i.echo_b else i.echo_a end) end);
end $$;
revoke all on function public.program_extras(public.programs, uuid) from public, anon, authenticated;

-- 교류 화면: 덧붙이는 것(program_extras)을 함께 돌려준다.
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
           'readableUntil', p.closed_at + interval '30 days', 'letterSet', p.letter_set) || public.program_extras(p, me) else '{}'::jsonb end;
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
  ) || public.program_extras(p, me);
end $function$;

CREATE OR REPLACE FUNCTION public.my_readable_programs()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
         ) || public.program_extras(p, auth.uid()) order by p.closed_at desc), '[]'::jsonb)
    from public.programs p
   where auth.uid() is not null and auth.uid() in (p.member_a, p.member_b) and public.program_readable(p, auth.uid())
$function$;

-- 서로 선택: 써 둔 소개 전 편지를 전한다.
CREATE OR REPLACE FUNCTION public.respond_introduction(p_id uuid, p_choice text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.introductions; me uuid := auth.uid(); is_a boolean;
begin
  if p_choice not in ('positive', 'negative') then raise exception '응답을 골라 주세요.'; end if;
  if p_reason is not null and p_reason not in ('거리', '나이', '관심사·대화 결', '사진·첫인상', '그냥 느낌', '말하고 싶지 않아요') then raise exception '이유를 다시 골라 주세요.'; end if;
  select * into i from public.introductions where id = p_id for update;
  if i is null or me not in (i.member_a, i.member_b) then raise exception '소개를 찾을 수 없어요.'; end if;
  is_a := i.member_a = me;
  if i.status <> 'published' or now() >= i.respond_by then raise exception '응답 기한이 지났거나 이미 마무리된 소개예요.'; end if;
  if (case when is_a then i.opened_a_at else i.opened_b_at end) is null then raise exception '상대 프로필을 확인한 뒤 응답해 주세요.'; end if;
  if (case when is_a then i.response_a else i.response_b end) is not null then raise exception '이미 응답했어요. 응답은 바꿀 수 없어요.'; end if;
  if is_a then
    update public.introductions set response_a = p_choice, response_a_at = now(), reason_a = case when p_choice = 'negative' then p_reason end where id = p_id returning * into i;
  else
    update public.introductions set response_b = p_choice, response_b_at = now(), reason_b = case when p_choice = 'negative' then p_reason end where id = p_id returning * into i;
  end if;
  -- 두 분 모두 ‘알아가고 싶어요’면 바로 서로 선택. 그 밖의 소개는 응답 마감에 함께 마무리한다(run_introduction_deadlines).
  if i.response_a = 'positive' and i.response_b = 'positive' then
    update public.introductions set status = 'mutual', mutual_at = now(), view_until = respond_by + interval '10 days' where id = p_id;
    -- 아직 모르는 당신에게: 두 분이 써 둔 편지를 이 소개에 붙인다(상대에게 보인다).
    update public.prelude_letters set introduction_id = p_id, delivered_at = now()
     where introduction_id is null and member_id in (i.member_a, i.member_b);
    perform public.notify(i.member_a, 'mutual', '두 분 모두 알아가고 싶다고 답했어요', '48시간 안에 3일 교류 방식(A 편지·B 첫 장면)과 시작일을 함께 정해 주세요.', '/exchange', 'mutual:' || p_id || ':' || i.member_a);
    perform public.notify(i.member_b, 'mutual', '두 분 모두 알아가고 싶다고 답했어요', '48시간 안에 3일 교류 방식(A 편지·B 첫 장면)과 시작일을 함께 정해 주세요.', '/exchange', 'mutual:' || p_id || ':' || i.member_b);
  end if;
  return public.my_introduction();
end $function$;

-- 한 줄 엽서: 편지 대신 5~80자 한 줄(사흘 중 한 번).
CREATE OR REPLACE FUNCTION public.submit_program_entry(p_program uuid, p_day integer, p_kind text, p_body text, p_payload jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.programs; me uuid := auth.uid(); plan text; day_date date; body text := nullif(trim(coalesce(p_body, '')), ''); n int; partner uuid;
  label text := case p_kind when 'letter' then '편지' when 'reply' then '답장' else '첫 장면' end; t timestamptz := public.app_now();
  clean jsonb; prev_opened boolean; prev_commented boolean; own_first text; partner_first text; places text[]; place text; legacy boolean; photo text;
  all_places text[] := array['exhibition', 'walk', 'bookstore', 'cafe', 'park', 'market', 'performance'];
  postcard boolean := p_kind = 'letter' and coalesce(p_payload ->> 'postcard', '') = '1';
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
  if postcard then
    if body is null or char_length(body) < 5 or char_length(body) > 80 then raise exception '한 줄 엽서는 5~80자로 써 주세요.'; end if;
    if exists (select 1 from public.program_entries where program_id = p.id and kind = 'letter' and author = me and payload ->> 'postcard' = '1') then
      raise exception '한 줄 엽서는 사흘 중 한 번만 보낼 수 있어요.';
    end if;
  elsif p_kind = 'letter' and (body is null or char_length(body) < 20) then raise exception '편지는 20자 이상 써 주세요.'; end if;
  if p_kind = 'reply' and (body is null or char_length(body) > 600) then raise exception '답장은 1~600자로 써 주세요.'; end if;
  if postcard then
    clean := jsonb_build_object('postcard', '1');
  elsif p_kind = 'letter' then
    -- 사진 한 장(선택): 이 교류 · 내 폴더 · 그날 칸에 올린 사진만. 다른 값은 저장하지 않는다(본문 + 사진 경로만).
    photo := nullif(trim(coalesce(p_payload ->> 'photo', '')), '');
    if photo is not null then
      if photo !~ ('^' || p.id || '/' || me || '/day' || p_day || '-[A-Za-z0-9_-]{4,40}\.jpg$') then raise exception '사진을 다시 골라 주세요.'; end if;
      if not exists (select 1 from storage.objects o where o.bucket_id = 'letter-photos' and o.name = photo) then raise exception '사진이 아직 올라가지 않았어요. 사진을 다시 골라 주세요.'; end if;
      if public.letter_photo_attached(photo) then raise exception '이미 보낸 사진이에요. 사진을 다시 골라 주세요.'; end if;
      clean := jsonb_build_object('photo', photo);
    end if;
  end if;
  if p_kind = 'scene' then
    if jsonb_typeof(p_payload) is distinct from 'object' or char_length(p_payload::text) > 1500 then raise exception '첫 장면 답을 확인해 주세요.'; end if;
    prev_opened := p_day > 1 and (select count(*) from public.program_entries where program_id = p.id and day = p_day - 1 and kind = 'scene') = 2;
    prev_commented := p_day > 1 and exists (select 1 from public.program_entries where program_id = p.id and day = p_day - 1 and kind = 'comment' and author = me);
    -- 둘째 날 기준이 되는 곳: 첫날 답이 함께 열렸으면 두 분이 고른 곳, 아니면 내가 고른 곳(첫날 답이 없으면 일곱 곳 또는 직접 쓴 곳)
    if p_day = 2 then
      select payload ->> 'activity' into own_first from public.program_entries where program_id = p.id and day = 1 and kind = 'scene' and author = me;
      select payload ->> 'activity' into partner_first from public.program_entries where program_id = p.id and day = 1 and kind = 'scene' and author = partner;
      places := case when own_first is not null and partner_first is not null then array[own_first, partner_first]
                     when own_first is not null then array[own_first] else all_places end;
      place := case when p_payload ->> 'place' = any (places) then p_payload ->> 'place'
                    when own_first is null and public.scene_custom_ok(p_payload ->> 'place') then p_payload ->> 'place' end;
    end if;
    -- 그날 쓰는 칸만 남긴다(다른 값은 저장하지 않는다).
    clean := jsonb_strip_nulls(jsonb_build_object(
      'activity', case when p_day = 1 then p_payload ->> 'activity' end,
      'place', place,
      'flow', case when p_day = 2 then p_payload ->> 'flow' end,
      'rest', case when p_day = 2 then p_payload ->> 'rest' end,
      'topic', case when p_day = 3 then nullif(trim(coalesce(p_payload ->> 'topic', '')), '') end,
      'reaction', case when p_day > 1 then nullif(trim(coalesce(p_payload ->> 'reaction', '')), '') end,
      'about', nullif(trim(coalesce(p_payload ->> 'about', '')), '')));
    if p_day = 1 and not (coalesce(clean ->> 'activity', '') = any (all_places) or public.scene_custom_ok(clean ->> 'activity')) then
      raise exception '시작하고 싶은 분위기를 골라 주세요. 직접 쓴다면 20자 안으로 적어 주세요.';
    end if;
    if p_day = 2 then
      -- 예전 화면(곳을 보내지 않음)의 공통 목록만 그대로 받는다. 곳을 보냈다면 그곳 기준으로 확인한다.
      legacy := p_payload ->> 'place' is null
            and coalesce(clean ->> 'flow' = any (public.scene_stay_options(null, 'legacy-flow')), false)
            and coalesce(clean ->> 'rest' = any (public.scene_stay_options(null, 'legacy-rest')), false);
      if not legacy and not (place is not null
          and (coalesce(clean ->> 'flow' = any (public.scene_options(place, 'flow')), false) or public.scene_custom_ok(clean ->> 'flow'))
          and (coalesce(clean ->> 'rest' = any (public.scene_options(place, 'rest')), false) or public.scene_custom_ok(clean ->> 'rest'))) then
        raise exception '첫날 고른 곳에 맞는 머무는 방식과 쉬어 갈 곳을 골라 주세요. 직접 쓴다면 20자 안으로 적어 주세요.';
      end if;
    end if;
    if p_day = 3 then body := null; end if;
    if p_day = 3 and clean ->> 'topic' is null then raise exception '함께 나누고 싶은 이야기를 적어 주세요.'; end if;
    if char_length(coalesce(clean ->> 'topic', '')) > 80 then raise exception '나누고 싶은 이야기는 80자 안으로 적어 주세요.'; end if;
    if clean ->> 'about' is null then raise exception '나를 소개하는 짧은 질문에 답해 주세요.'; end if;
    if char_length(clean ->> 'about') > 100 then raise exception '나를 소개하는 답은 100자 안으로 적어 주세요.'; end if;
    if char_length(coalesce(clean ->> 'reaction', '')) > 150 then raise exception '상대에게 건네는 한마디는 150자 안으로 적어 주세요.'; end if;
    if prev_opened and not prev_commented and clean ->> 'reaction' is null then raise exception '어제 함께 열린 상대의 선택에 한마디를 남겨 주세요.'; end if;
    if body is not null and char_length(body) > 60 then raise exception '고른 이유는 한 줄(60자 안)로 적어 주세요.'; end if;
  end if;
  -- 연락처 검사는 직접 쓴 말의 표시('custom:')를 뺀 글로 한다(표시 뒤에 붙여 쓰는 우회 막기).
  perform public.check_member_text(regexp_replace(concat_ws(' ', body, (select string_agg(v, ' ') from jsonb_each_text(case when p_kind = 'scene' then coalesce(clean, '{}'::jsonb) else '{}'::jsonb end) as x(k, v))), 'custom:', ' ', 'g'), '교류 ' || label);
  if exists (select 1 from public.program_entries where program_id = p.id and day = p_day and kind = p_kind and author = me) then
    raise exception '이미 보낸 %은(는) 고치거나 다시 보낼 수 없어요.', label;
  end if;
  insert into public.program_entries (program_id, day, kind, author, body, payload) values (p.id, p_day, p_kind, me, body, clean);
  select count(*) into n from public.program_entries where program_id = p.id and day = p_day and kind = p_kind;
  if n = 2 and p_kind = 'reply' then
    perform public.notify(m, 'program-open', 'DAY0' || p_day || ' 답장이 열렸어요', '두 분의 답장이 함께 열렸어요.', '/exchange', 'open:' || p.id || ':' || p_day || ':' || p_kind || ':' || m)
      from unnest(array[p.member_a, p.member_b]) m where m is not null;
  elsif n = 2 then
    -- 편지·첫 장면 답이 열린 알림은 할 일(답장·한마디·다음 고르기)이 생기는 알림이라 메일로도 보낸다.
    perform public.notify(m, 'program-opened', 'DAY0' || p_day || ' ' || case p_kind when 'letter' then '편지가' else '첫 장면 답이' end || ' 열렸어요',
      case when p_kind = 'letter' then '두 분이 모두 보내서 함께 열렸어요. 열린 편지에는 ' || to_char(day_date + 1, 'FMMM"월" FMDD"일"') || ' 09:00까지 답장을 한 번 보낼 수 있어요.'
           when p_day = 3 then '두 분이 모두 보내서 함께 열렸어요. 이제 두 분이 고른 것 중에서 첫 장면을 함께 맞춰요.'
           else '두 분이 모두 보내서 함께 열렸어요. 상대가 무엇을 골랐는지 보고, ' || to_char(day_date + 1, 'FMMM"월" FMDD"일"') || ' 09:00까지 한마디를 남길 수 있어요.' end,
      '/exchange', 'open:' || p.id || ':' || p_day || ':' || p_kind || ':' || m)
      from unnest(array[p.member_a, p.member_b]) m where m is not null;
  elsif partner is not null then
    perform public.notify(partner, 'program-sent', '상대가 DAY0' || p_day || ' ' || case when postcard then '한 줄 엽서를' when p_kind = 'letter' then '편지를' when p_kind = 'reply' then '답장을' else '첫 장면 답을' end || ' 보냈어요',
      case when p_kind = 'reply' then '내 답장도 보내면 함께 열려요. ' || to_char(day_date + 1, 'FMMM"월" FMDD"일"') || ' 09:00까지예요.' else '내 글도 보내면 23:59 전에 함께 열려요.' end,
      '/exchange', 'sent:' || p.id || ':' || p_day || ':' || p_kind || ':' || me);
  end if;
  return public.my_program();
end $function$;

-- 소개 예약: 창가 질문을 참고했는지 · 닮은 두 문장
drop function if exists public.admin_reserve_introduction(uuid, uuid, date, text, jsonb, uuid[]);
create function public.admin_reserve_introduction(p_a uuid, p_b uuid, p_date date, p_note text, p_match jsonb default null, p_reflected uuid[] default '{}', p_window uuid[] default '{}', p_echo jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare reveal timestamptz; snap_a jsonb; snap_b jsonb; new_id uuid; m uuid; ga text; gb text; da text; db text; why text; compat jsonb; hold timestamptz; used int;
  ea text := nullif(trim(coalesce(p_echo ->> 'a', '')), ''); eb text := nullif(trim(coalesce(p_echo ->> 'b', '')), '');
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_a = p_b then raise exception '서로 다른 두 회원이 필요해요.'; end if;
  if public.avoid_conflict(p_a, p_b) then raise exception '아는 사람 피하기로 서로 소개하지 않는 두 사람이에요.'; end if;
  if public.held_pair(p_a, p_b) then raise exception '예전 계정에서 차단 관계였던 두 사람으로 보여요. 소개할 수 없어요.'; end if;
  reveal := public.kst_at(p_date, '12:00');
  if reveal <= now() then raise exception '이미 지난 정오에는 예약할 수 없어요. 다음 정오를 골라 주세요.'; end if;
  if char_length(coalesce(trim(p_note), '')) < 10 then raise exception '두 분에게 보일 소개 이유를 10자 이상 적어 주세요.'; end if;
  compat := public.clean_match(p_match);
  foreach m in array array[p_a, p_b] loop
    if not exists (select 1 from public.applications a join public.profiles p on p.id = a.member_id
                    where a.member_id = m and a.status = 'approved' and p.status = 'active') then
      raise exception '승인된 활동 회원만 소개할 수 있어요.';
    end if;
    if exists (select 1 from public.profiles where id = m and paused_at is not null) then
      raise exception '새 소개를 쉬고 있는 회원이에요.';
    end if;
    if exists (select 1 from public.introductions i where m in (i.member_a, i.member_b) and public.intro_open(i)) then
      raise exception '이미 진행 중이거나 예약된 소개가 있는 회원이에요.';
    end if;
    -- 넘김으로 정해져 마감을 기다리는 소개는, 그 마감 뒤 정오로만 다음 소개를 예약할 수 있다.
    if exists (select 1 from public.introductions i where m in (i.member_a, i.member_b) and i.status = 'published' and i.respond_by > reveal) then
      raise exception '지금 소개의 응답 마감 뒤 정오로 예약해 주세요.';
    end if;
    hold := public.photo_hold_at(m);
    if hold is not null and hold <= reveal then
      raise exception '사진 교체 요청 뒤 7일이 지나(%부터) 새 소개를 멈추는 회원이에요. 새 사진을 받은 뒤 예약해 주세요.', to_char(hold at time zone 'Asia/Seoul', 'FMMM"월" FMDD"일" HH24:MI');
    end if;
    if exists (select 1 from public.introductions where m in (member_a, member_b) and status <> 'cancelled'
                and (reveal_at at time zone 'Asia/Seoul')::date = p_date) then
      raise exception '같은 날 두 번 소개할 수 없어요.';
    end if;
    if (select count(*) from public.application_photos where member_id = m and slot in ('photo.face','photo.upper','photo.style') and review = '기준 확인') < 3 then
      raise exception '필수 사진 세 장의 기준 확인이 필요해요.';
    end if;
  end loop;
  -- 서로 원하는 상대 성별: 성별이 ‘직접 확인’ 상태면 먼저 확인하고, 양쪽 모두 상대를 원해야 한다.
  select a.draft -> 'values' ->> 'self.gender', a.draft -> 'values' ->> 'desired.gender' into ga, da from public.applications a where a.member_id = p_a;
  select a.draft -> 'values' ->> 'self.gender', a.draft -> 'values' ->> 'desired.gender' into gb, db from public.applications a where a.member_id = p_b;
  if coalesce(ga, '') not in ('여성', '남성') or coalesce(gb, '') not in ('여성', '남성') then
    raise exception '성별을 직접 확인해야 하는 회원이 있어요. 신청서에서 성별을 먼저 확인해 주세요.';
  end if;
  if coalesce(da, '') not in (gb, '선호 없음') or coalesce(db, '') not in (ga, '선호 없음') then
    raise exception '서로 원하는 상대 성별이 맞지 않아요.';
  end if;
  -- 다시 소개하지 않는 두 사람(차단·신고·서로 선택·넘김·열어 본 분의 무응답·그 밖의 마무리)
  why := public.pair_reintro_reason(p_a, p_b);
  if why = 'blocked' then raise exception '차단 관계인 두 사람은 소개할 수 없어요.'; end if;
  if why = 'reported' then raise exception '신고 기록이 있는 두 사람은 다시 소개하지 않아요.'; end if;
  if why is not null then
    raise exception '이미 소개한 적 있는 두 사람이에요 · %. 다시 소개하지 않아요.',
      case why when 'mutual' then '서로 선택했던 사이예요' when 'declined' then '한 분이 넘긴 소개가 있어요'
               when 'nonresponse' then '열어 본 분이 답하지 않은 소개가 있어요' when 'active' then '진행 중인 소개가 있어요'
               else '공개된 뒤 마무리된 소개가 있어요' end;
  end if;
  snap_a := public.public_profile(p_a);
  snap_b := public.public_profile(p_b);
  -- 닮은 두 문장: 두 분 모두 한 문장씩, 각자 상대에게 보이는 소개에 직접 쓴 문장 그대로만
  if (ea is null) <> (eb is null) then raise exception '닮은 두 문장은 두 분 모두 한 문장씩 골라 주세요.'; end if;
  if ea is not null then
    if char_length(ea) not between 4 and 120 or char_length(eb) not between 4 and 120 then raise exception '닮은 두 문장은 4~120자 문장으로 골라 주세요.'; end if;
    if position(ea in public.profile_text(snap_a)) = 0 or position(eb in public.profile_text(snap_b)) = 0 then
      raise exception '닮은 두 문장은 각자 상대에게 보이는 소개에 직접 쓴 문장에서만 고를 수 있어요.';
    end if;
  end if;
  insert into public.introductions (member_a, member_b, note, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, created_by, match, echo_a, echo_b)
  values (p_a, p_b, trim(p_note), reveal, public.kst_at(p_date + 1, '11:00'), public.kst_at(p_date + 1, '11:00'), snap_a, snap_b, auth.uid(), compat, ea, eb)
  returning id into new_id;
  -- 반영한 한 줄: 아직 반영하지 않은 한 줄이 있는 회원만 표시한다(없으면 표시하지 않음).
  foreach m in array array[p_a, p_b] loop
    continue when not (m = any(coalesce(p_reflected, '{}')));
    update public.reflections set used_at = now(), used_intro = new_id where member_id = m and used_at is null;
    get diagnostics used = row_count;
    if used > 0 then
      update public.introductions set reflected_a = reflected_a or m = p_a, reflected_b = reflected_b or m = p_b where id = new_id;
    end if;
  end loop;
  -- 창가 질문: 아직 참고하지 않은 답이 있는 회원만 표시한다.
  foreach m in array array[p_a, p_b] loop
    continue when not (m = any(coalesce(p_window, '{}')));
    update public.window_answers set used_at = now(), used_intro = new_id where member_id = m and used_at is null;
    get diagnostics used = row_count;
    if used > 0 then
      update public.introductions set window_a = window_a or m = p_a, window_b = window_b or m = p_b where id = new_id;
    end if;
  end loop;
  perform public.write_audit('정오 소개 예약 · ' || p_date, new_id::text, concat_ws(' · ',
    case when compat is not null then '궁합 함께 보냄' || coalesce(' · ' || (compat ->> 'score'), '') end,
    case when exists (select 1 from public.introductions where id = new_id and (reflected_a or reflected_b)) then '회고 반영' end,
    case when exists (select 1 from public.introductions where id = new_id and (window_a or window_b)) then '창가 질문 반영' end,
    case when ea is not null then '닮은 두 문장' end));
  return new_id;
end $$;
revoke all on function public.admin_reserve_introduction(uuid, uuid, date, text, jsonb, uuid[], uuid[], jsonb) from public, anon;
grant execute on function public.admin_reserve_introduction(uuid, uuid, date, text, jsonb, uuid[], uuid[], jsonb) to authenticated;

-- 회원의 소개 화면: 창가 질문을 참고했는지 · 닮은 두 문장
create or replace function public.my_introduction() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.introductions; me uuid := auth.uid(); is_a boolean; readable boolean;
begin
  if me is null then return null; end if;
  select * into i from public.introductions
   where me in (member_a, member_b) and status in ('published', 'mutual', 'closed') and reveal_at <= now()
   order by reveal_at desc limit 1;
  if i.id is null then
    return jsonb_build_object('status', 'waiting');
  end if;
  is_a := i.member_a = me;
  readable := i.status in ('published', 'mutual') and now() < i.view_until;
  return jsonb_build_object(
    'id', i.id,
    'status', case when i.status = 'published' and now() >= i.respond_by then 'expired' else i.status end,
    'publishedAt', i.published_at,
    'dueAt', i.respond_by,
    'viewUntil', i.view_until,
    'note', case when readable then i.note end,
    'match', case when readable and (case when is_a then i.response_a else i.response_b end) is distinct from 'negative' then public.member_match(i.match) end,
    'profile', case when readable then (case when is_a then i.snapshot_b else i.snapshot_a end) end,
    'ownResponse', case when is_a then i.response_a else i.response_b end,
    'ownResponseAt', case when is_a then i.response_a_at else i.response_b_at end,
    'opened', (case when is_a then i.opened_a_at else i.opened_b_at end) is not null,
    'mutual', i.status = 'mutual',
    'endReason', i.end_reason,
    'endedByMe', i.ended_by is not distinct from me and i.ended_by is not null,
    'counted', case when is_a then i.count_a else i.count_b end,
    'closedAt', i.closed_at,
    'reflected', case when is_a then i.reflected_a else i.reflected_b end,
    'windowed', case when is_a then i.window_a else i.window_b end,
    'echo', case when readable and i.echo_a is not null and i.echo_b is not null
                 then jsonb_build_object('own', case when is_a then i.echo_a else i.echo_b end, 'partner', case when is_a then i.echo_b else i.echo_a end) end
  );
end $$;

-- 운영진 신청서·매칭 화면: 최근 창가 질문 답 다섯 개
create or replace function public.admin_get_application(p_member uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.applications; photos jsonb; replacements jsonb; notes jsonb; answers jsonb;
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  select * into a from public.applications where member_id = p_member;
  if a is null then raise exception '신청서를 찾을 수 없어요.'; end if;
  if not exists (
    select 1 from public.audit_log
     where actor_id = auth.uid() and action = '회원 정보 열람' and target = p_member::text
       and (at at time zone 'Asia/Seoul')::date = public.kst_today()
  ) then
    perform public.write_audit('회원 정보 열람', p_member::text, '신청서 검토');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('slot', slot, 'path', path, 'review', review, 'reason', reason, 'width', width, 'height', height, 'createdAt', created_at,
                                               'changeReason', change_reason, 'changeRequestedAt', change_requested_at) order by slot), '[]'::jsonb)
    into photos from public.application_photos where member_id = p_member;
  select coalesce(jsonb_agg(jsonb_build_object('slot', slot, 'path', path, 'review', review, 'reason', reason, 'width', width, 'height', height, 'createdAt', created_at) order by slot), '[]'::jsonb)
    into replacements from public.photo_replacements where member_id = p_member;
  select coalesce(jsonb_agg(jsonb_build_object('body', x.body, 'createdAt', x.created_at, 'usedAt', x.used_at, 'met', x.met) order by x.created_at desc), '[]'::jsonb)
    into notes from (
      select r.body, r.created_at, r.used_at, pr.end_reason = 'completed' met
        from public.reflections r left join public.programs pr on pr.id = r.program_id
       where r.member_id = p_member order by r.created_at desc limit 5) x;
  select coalesce(jsonb_agg(jsonb_build_object('question', x.question, 'body', x.body, 'createdAt', x.created_at, 'usedAt', x.used_at) order by x.created_at desc), '[]'::jsonb)
    into answers from (select w.question, w.body, w.created_at, w.used_at from public.window_answers w where w.member_id = p_member order by w.created_at desc limit 5) x;
  return jsonb_build_object(
    'memberId', a.member_id, 'status', a.status, 'profileVersion', a.profile_version,
    'submittedAt', a.submitted_at, 'decidedAt', a.decided_at, 'decisionNote', a.decision_note,
    'draft', public.application_for_operator(a.draft), 'photos', photos, 'replacements', replacements,
    'reflections', notes, 'windowAnswers', answers, 'photoHoldAt', public.photo_hold_at(p_member));
end $$;

-- 보존 정리: 닮은 두 문장도 소개 사본과 함께 지운다 · 소개 전 편지 · 창가 질문 답
CREATE OR REPLACE FUNCTION public.run_retention()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare run_id bigint; result jsonb; members int; snapshots int; inquiries int; audits int; notes int; test_payments int;
begin
  insert into public.job_runs (job) values ('retention') returning id into run_id;
  begin
    with gone as (
      delete from auth.users u using public.profiles p
       where p.id = u.id and p.status = 'withdrawal_requested' and p.deletion_due_at <= now()
      returning u.id)
    select count(*) into members from gone;

    with cleared as (
      update public.introductions
         set snapshot_a = jsonb_build_object('deleted', true), snapshot_b = jsonb_build_object('deleted', true), match = null, echo_a = null, echo_b = null
       where status in ('closed', 'cancelled') and closed_at <= now() - interval '30 days' and not (snapshot_a ? 'deleted')
      returning id)
    select count(*) into snapshots from cleared;
    -- 예전에 사본만 지워지고 궁합이 남은 소개도 함께 정리한다.
    update public.introductions set match = null where match is not null and snapshot_a ? 'deleted';

    with old as (delete from public.inquiries where status = 'answered' and answered_at <= now() - interval '3 years' returning id)
    select count(*) into inquiries from old;

    -- 테스트 결제(실제로 돈이 오가지 않은 기록)는 90일 뒤 지운다. 실제(라이브) 결제는 법에서 정한 기간 동안 남긴다.
    with old as (delete from public.payments where mode = 'test' and created_at <= now() - interval '90 days' returning id)
    select count(*) into test_payments from old;

    perform set_config('before_us.retention', 'on', true);
    with old as (delete from public.audit_log where at <= now() - interval '365 days' returning id)
    select count(*) into audits from old;
    perform set_config('before_us.retention', 'off', true);

    with old as (delete from public.notifications where read_at <= now() - interval '90 days' returning id)
    select count(*) into notes from old;
    delete from public.reflections where created_at <= now() - interval '1 year';
    delete from public.withdrawal_feedback where created_at <= now() - interval '1 year';
    -- 소개 전 편지: 전해진 소개가 마무리되고 30일이 지나면(다시 읽기 기간과 같게) 지운다. 창가 질문 답은 1년.
    delete from public.prelude_letters l using public.introductions i
     where l.introduction_id = i.id and i.status in ('closed', 'cancelled') and i.closed_at <= now() - interval '30 days';
    delete from public.window_answers where created_at <= now() - interval '1 year';
    delete from public.job_runs where started_at <= now() - interval '90 days' and id <> run_id;

    result := jsonb_build_object('members', members, 'snapshots', snapshots, 'inquiries', inquiries, 'audits', audits, 'notifications', notes, 'testPayments', test_payments);
    update public.job_runs set finished_at = now(), ok = true, detail = result where id = run_id;
  exception when others then
    result := jsonb_build_object('error', sqlerrm);
    update public.job_runs set finished_at = now(), ok = false, detail = result where id = run_id;
  end;
  return result;
end $function$;
