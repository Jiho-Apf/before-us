-- 3일 교류 다듬기 3(2026-10-29)
--  1. B 둘째 날: 머무는 방식·쉬어 갈 곳을 첫날 고른 곳(전시·산책·서점·카페·공원·피크닉·시장 골목·작은 공연)에 맞춰 고른다.
--     첫날 답이 함께 열렸으면 두 분이 고른 곳 가운데 하나(place)를, 열리지 않았으면 내가 고른 곳을 기준으로 한다(첫날 답을 보내지 않았으면 일곱 곳 중에서).
--     예전 화면에서 보내는 공통 목록(짧게 둘러보기 · 조용한 카페 …)도 그대로 받는다(이미 저장된 답·열려 있던 화면을 위해).
--  2. B 고른 이유: 첫째·둘째 날 모두 적지 않아도 되고, 적으면 한 줄(60자 안)로. 셋째 날에는 이유를 받지 않는다.
--  3. B 나를 소개하는 짧은 질문(about)은 날마다 꼭 답한다(화면과 같은 기준).
--  4. 첫 장면 맞추기: 둘째 날 답이 함께 열리지 않았으면, 맞추려는 장소에 맞는 목록에서 고른다.
--  5. 지난 교류 다시 읽기: 새 교류가 시작돼도, 다시 읽을 수 있는 마무리된 교류(program_readable)를 모두 돌려준다(my_readable_programs).
--  편지(A)의 질문·예시는 화면에만 있다. 예시는 읽기만 하는 참고라 서버에는 아무 영향이 없다(편지에는 본문만 저장한다).

-- ─────────────────────────────────────────────────────────
-- 1. 장소별 머무는 방식·쉬어 갈 곳(화면 backend/program.ts SCENE_STAY와 같은 목록)
create or replace function public.scene_stay_options(p_activity text, p_field text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_field
    when 'flow' then case p_activity
      when 'exhibition' then array['한 전시만 천천히 보기', '마음에 든 작품 앞에서 오래 머물기', '가볍게 보고 나와 걷기']
      when 'walk' then array['가볍게 한 바퀴 걷기', '천천히 오래 걷기', '걷다가 끌리는 곳에 들르기']
      when 'bookstore' then array['각자 한 권씩 골라 보기', '좋아하는 책 서로 소개하기', '짧게 둘러보고 나오기']
      when 'cafe' then array['한 곳에서 오래 이야기하기', '두 곳을 옮겨 가며 머물기', '커피 들고 근처 걷기']
      when 'park' then array['돗자리 펴고 오래 머물기', '가볍게 걷다가 쉬기', '간단히 먹고 산책하기']
      when 'market' then array['조금씩 맛보며 걷기', '구경하며 천천히 돌기', '한 곳에 앉아 먹으며 이야기하기']
      when 'performance' then array['공연 보고 짧게 이야기하기', '공연 전에 가볍게 먹기', '공연 뒤 천천히 걷기'] end
    when 'rest' then case p_activity
      when 'exhibition' then array['미술관 안 카페', '근처 조용한 카페', '전시장 앞 벤치', '디저트 가게']
      when 'walk' then array['강가 벤치', '공원 쉼터', '길가 작은 카페', '동네 빵집']
      when 'bookstore' then array['서점 안 카페', '근처 조용한 카페', '책 읽기 좋은 벤치', '디저트·빵집']
      when 'cafe' then array['근처 공원 벤치', '디저트 가게', '조용한 산책길']
      when 'park' then array['나무 그늘 아래', '물가 벤치', '공원 앞 카페', '잔디밭 한쪽']
      when 'market' then array['골목 작은 카페', '시장 안 분식집', '근처 공원 벤치', '디저트·빵집']
      when 'performance' then array['공연장 근처 카페', '조용한 식당', '근처 공원 벤치'] end
    -- 예전 공통 목록(이미 저장된 답·예전 화면을 위해 계속 받는다)
    when 'legacy-flow' then array['짧게 둘러보기', '천천히 머물기', '발길 닿는 대로']
    when 'legacy-rest' then array['조용한 카페', '공공 야외 공간', '디저트·빵집', '강가·벤치'] end
$$;

-- ─────────────────────────────────────────────────────────
-- 2. 교류 글: 편지(A) · 답장(A, 다음 날 09:00까지) · 첫 장면(B, 나를 소개하는 답은 꼭 · 고른 이유는 선택 · 둘째 날은 고른 곳에 맞춰)
create or replace function public.submit_program_entry(p_program uuid, p_day int, p_kind text, p_body text, p_payload jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); plan text; day_date date; body text := nullif(trim(coalesce(p_body, '')), ''); n int; partner uuid;
  label text := case p_kind when 'letter' then '편지' when 'reply' then '답장' else '첫 장면' end; t timestamptz := public.app_now();
  clean jsonb; prev_opened boolean; own_first text; partner_first text; places text[]; place text; legacy boolean;
  all_places text[] := array['exhibition', 'walk', 'bookstore', 'cafe', 'park', 'market', 'performance'];
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
    -- 둘째 날 기준이 되는 곳: 첫날 답이 함께 열렸으면 두 분이 고른 곳, 아니면 내가 고른 곳(첫날 답이 없으면 일곱 곳 모두)
    if p_day = 2 then
      select payload ->> 'activity' into own_first from public.program_entries where program_id = p.id and day = 1 and kind = 'scene' and author = me;
      select payload ->> 'activity' into partner_first from public.program_entries where program_id = p.id and day = 1 and kind = 'scene' and author = partner;
      places := case when own_first is not null and partner_first is not null then array[own_first, partner_first]
                     when own_first is not null then array[own_first] else all_places end;
      place := case when p_payload ->> 'place' = any (places) then p_payload ->> 'place' end;
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
    if p_day = 1 and coalesce(clean ->> 'activity', '') <> all (all_places) then raise exception '시작하고 싶은 분위기를 골라 주세요.'; end if;
    if p_day = 2 then
      legacy := coalesce(clean ->> 'flow' = any (public.scene_stay_options(null, 'legacy-flow')), false)
            and coalesce(clean ->> 'rest' = any (public.scene_stay_options(null, 'legacy-rest')), false);
      if not legacy and not (place is not null and coalesce(clean ->> 'flow' = any (public.scene_stay_options(place, 'flow')), false)
                                              and coalesce(clean ->> 'rest' = any (public.scene_stay_options(place, 'rest')), false)) then
        raise exception '첫날 고른 곳에 맞는 머무는 방식과 쉬어 갈 곳을 골라 주세요.';
      end if;
    end if;
    if p_day = 3 then body := null; end if;
    if p_day = 3 and clean ->> 'topic' is null then raise exception '함께 나누고 싶은 이야기를 적어 주세요.'; end if;
    if char_length(coalesce(clean ->> 'topic', '')) > 80 then raise exception '나누고 싶은 이야기는 80자 안으로 적어 주세요.'; end if;
    if clean ->> 'about' is null then raise exception '나를 소개하는 짧은 질문에 답해 주세요.'; end if;
    if char_length(clean ->> 'about') > 100 then raise exception '나를 소개하는 답은 100자 안으로 적어 주세요.'; end if;
    if char_length(coalesce(clean ->> 'reaction', '')) > 150 then raise exception '상대에게 건네는 한마디는 150자 안으로 적어 주세요.'; end if;
    if prev_opened and clean ->> 'reaction' is null then raise exception '어제 함께 열린 상대의 선택에 한마디를 남겨 주세요.'; end if;
    if body is not null and char_length(body) > 60 then raise exception '고른 이유는 한 줄(60자 안)로 적어 주세요.'; end if;
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

-- ─────────────────────────────────────────────────────────
-- 3. B 마지막 맞추기: 셋째 날 답이 함께 열리면 두 분이 고른 것 중에서 하나씩 고른다.
-- 첫날 답이 열리지 않았으면 일곱 곳에서, 둘째 날 답이 열리지 않았으면 맞추려는 장소에 맞는 목록에서 고른다. 두 분의 선택이 같으면 정해진다.
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
  if jsonb_typeof(p_pick) is distinct from 'object' then raise exception '두 분이 고른 것 중에서 하나씩 골라 주세요.'; end if;
  partner := public.program_partner(p, me);
  select case when count(*) = 2 then array_agg(distinct payload ->> 'activity') else array['exhibition', 'walk', 'bookstore', 'cafe', 'park', 'market', 'performance'] end into acts
    from public.program_entries where program_id = p.id and day = 1 and kind = 'scene';
  select case when count(*) = 2 then array_agg(distinct payload ->> 'flow') end, case when count(*) = 2 then array_agg(distinct payload ->> 'rest') end into flows, rests
    from public.program_entries where program_id = p.id and day = 2 and kind = 'scene';
  if flows is null then
    flows := coalesce(public.scene_stay_options(p_pick ->> 'activity', 'flow'), '{}') || public.scene_stay_options(null, 'legacy-flow');
    rests := coalesce(public.scene_stay_options(p_pick ->> 'activity', 'rest'), '{}') || public.scene_stay_options(null, 'legacy-rest');
  end if;
  select array_agg(distinct payload ->> 'topic') into topics from public.program_entries where program_id = p.id and day = 3 and kind = 'scene';
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
-- 4. 지난 교류 다시 읽기: 다시 읽을 수 있는 마무리된 교류(넷째 날 두 분 모두 만나고 싶다고 했고, 마무리 후 30일 안, 차단 없음)를 최근 순으로.
-- my_program은 가장 최근 교류 하나만 돌려주므로, 새 교류가 시작된 뒤에도 지난 교류를 읽을 수 있게 따로 돌려준다.
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
           'entries', public.program_entries_json(p.id, auth.uid(), public.program_partner(p, auth.uid()))
         ) order by p.closed_at desc), '[]'::jsonb)
    from public.programs p
   where auth.uid() is not null and auth.uid() in (p.member_a, p.member_b) and public.program_readable(p, auth.uid())
$$;

-- ─────────────────────────────────────────────────────────
-- 권한
revoke all on function public.scene_stay_options(text, text) from public, anon, authenticated;
revoke all on function public.submit_program_entry(uuid, int, text, text, jsonb), public.choose_first_scene(uuid, jsonb), public.my_readable_programs() from public, anon;
grant execute on function public.submit_program_entry(uuid, int, text, text, jsonb), public.choose_first_scene(uuid, jsonb), public.my_readable_programs() to authenticated;
