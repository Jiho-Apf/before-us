-- 3일 교류 다듬기 4(2026-10-29)
--  1. A 편지 사진 한 장(선택): 비공개 저장소 letter-photos, 경로 {교류 id}/{쓴 사람 id}/day{n}-{임의값}.jpg.
--     화면에서 다시 그려 JPG로 올리므로 촬영 위치 같은 정보는 남지 않는다. 쓴 사람은 언제든, 상대는 그날 편지가 함께 열린 뒤
--     (교류가 이어지는 동안 · 마무리 뒤 다시 읽기 기간)에만 볼 수 있다. 차단 관계가 생기면 바로 볼 수 없다.
--     보내기 전에는 지울 수 있고, 보낸 뒤에는 편지처럼 고칠 수 없다. 보존 기간이 지나면(교류 글과 함께) 정리 대기열로 보낸다.
--  2. B 직접 작성: 장소(첫째 날) · 머무는 방식 · 쉬어 갈 곳(둘째 날)에 목록 말고 직접 쓴 짧은 말(20자 안)을 고를 수 있다.
--     저장은 'custom:' + 글. 직접 쓴 장소를 기준으로 하는 둘째 날에는 공통 목록(짧게 둘러보기 … / 조용한 카페 …)과 직접 작성에서 고른다.
--     첫 장면 맞추기에서도 직접 쓴 것을 고를 수 있다(그날 열리지 않았으면 내가 쓴 것 · 상대가 첫 장면에 고른 것).
--  3. B 내가 고른 첫 장면에 대해(kind = 'piece'): 첫 장면을 고른 뒤 10~300자. 두 분 모두 쓰면 함께 열린다.
--     만남 선택 마감(다섯째 날 09:00)까지.
--  4. B 한마디(kind = 'comment' · 'piece-comment'): 함께 열린 그날 답과 첫 장면 이야기에 한 번씩, 100자 안.
--     이미 함께 열린 글에 건네는 말이라 쓰는 즉시 상대에게 보인다. 그날 답에는 다음 날 09:00까지, 첫 장면 이야기에는 만남 선택 마감까지.
--     전날 답에 한마디를 남겼다면 다음 날 답에서는 한마디(reaction)를 다시 묻지 않는다.
--  알림 종류는 기존 것(program-sent · program-open, 사이트 알림)을 써서 메일 정책(email_class)은 그대로 둔다.

-- ─────────────────────────────────────────────────────────
-- 1. 교류 글 종류
alter table public.program_entries drop constraint program_entries_kind_check;
alter table public.program_entries add constraint program_entries_kind_check check (kind in ('letter', 'reply', 'scene', 'final', 'piece', 'comment', 'piece-comment'));

-- ─────────────────────────────────────────────────────────
-- 2. 편지 사진 저장소(비공개 · JPG만 · 한 장 5MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('letter-photos', 'letter-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- 올리기: 진행 중인 A 교류의 내 폴더에만, 하루 12장까지
create or replace function public.letter_photo_upload_ok(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and coalesce(p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/day[1-3]-[A-Za-z0-9_-]{4,40}\.jpg$', false)
     and split_part(p_name, '/', 2) = auth.uid()::text
     and exists (select 1 from public.programs p where p.id::text = split_part(p_name, '/', 1) and auth.uid() in (p.member_a, p.member_b)
                   and p.status = 'started' and p.plan_a = 'A' and p.plan_b = 'A')
     and (select count(*) from storage.objects o where o.bucket_id = 'letter-photos' and split_part(o.name, '/', 2) = auth.uid()::text
            and o.created_at > now() - interval '1 day') < 12
$$;

-- 보낸 편지에 붙은 사진인지
create or replace function public.letter_photo_attached(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.program_entries e where e.kind = 'letter' and e.payload ->> 'photo' = p_name)
$$;

-- 보기: 쓴 사람은 늘. 상대는 그날 편지가 함께 열렸고, 교류가 이어지는 중이거나 다시 읽을 수 있는 마무리 교류이며, 차단이 없을 때만.
create or replace function public.can_view_letter_photo(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    split_part(p_name, '/', 2) = auth.uid()::text
    or exists (
      select 1 from public.program_entries e join public.programs p on p.id = e.program_id
       where e.kind = 'letter' and e.payload ->> 'photo' = p_name
         and p.id::text = split_part(p_name, '/', 1) and e.author::text = split_part(p_name, '/', 2)
         and auth.uid() in (p.member_a, p.member_b) and auth.uid() <> e.author
         and (select count(*) from public.program_entries l where l.program_id = p.id and l.day = e.day and l.kind = 'letter') = 2
         and (p.status in ('started', 'deciding', 'arranging') or public.program_readable(p, auth.uid()))
         and not exists (select 1 from public.blocks b where (b.member_id = auth.uid() and b.blocked_id = e.author) or (b.member_id = e.author and b.blocked_id = auth.uid()))))
$$;

create policy "편지 사진: 진행 중인 교류의 내 폴더에 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'letter-photos' and public.letter_photo_upload_ok(name));
create policy "편지 사진: 쓴 사람과 함께 열린 뒤의 상대만 보기" on storage.objects for select to authenticated
  using (bucket_id = 'letter-photos' and public.can_view_letter_photo(name));
create policy "편지 사진: 보내기 전 내 사진만 지우기" on storage.objects for delete to authenticated
  using (bucket_id = 'letter-photos' and split_part(name, '/', 2) = auth.uid()::text and not public.letter_photo_attached(name));

-- ─────────────────────────────────────────────────────────
-- 3. B 직접 작성: 'custom:' + 1~20자(앞뒤 빈칸·줄바꿈 없이)
create or replace function public.scene_custom_ok(p_value text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_value ~ '^custom:\S' and p_value !~ '\s$' and p_value !~ '[[:cntrl:]]' and char_length(p_value) <= 27, false)
$$;

-- 장소에 맞는 머무는 방식·쉬어 갈 곳(직접 쓴 장소는 공통 목록)
create or replace function public.scene_options(p_place text, p_field text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(public.scene_stay_options(p_place, p_field), case when public.scene_custom_ok(p_place) then public.scene_stay_options(null, 'legacy-' || p_field) end)
$$;

-- ─────────────────────────────────────────────────────────
-- 4. 그날 글 묶음: 한마디(comment · piece-comment)는 쓰는 즉시 상대에게 보인다. 다른 글은 두 분 모두 보냈을 때만.
create or replace function public.program_entries_json(p_program uuid, p_me uuid, p_partner uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'kind', d.kind,
           'own', (select jsonb_build_object('body', e.body, 'payload', e.payload, 'at', e.created_at) from public.program_entries e where e.program_id = p_program and e.day = d.day and e.kind = d.kind and e.author = p_me),
           'partnerSent', exists (select 1 from public.program_entries e where e.program_id = p_program and e.day = d.day and e.kind = d.kind and e.author = p_partner),
           'partner', case when d.kind in ('comment', 'piece-comment') or (select count(*) from public.program_entries e where e.program_id = p_program and e.day = d.day and e.kind = d.kind) = 2
             then (select jsonb_build_object('body', e.body, 'payload', e.payload, 'at', e.created_at) from public.program_entries e where e.program_id = p_program and e.day = d.day and e.kind = d.kind and e.author = p_partner) end
         ) order by d.day, d.kind), '[]'::jsonb)
    from (select distinct day, kind from public.program_entries where program_id = p_program) d
$$;

-- ─────────────────────────────────────────────────────────
-- 5. 교류 글: 편지(A, 사진 한 장 선택) · 답장(A) · 첫 장면(B, 직접 작성 · 전날 한마디를 남겼으면 reaction 생략 가능)
create or replace function public.submit_program_entry(p_program uuid, p_day int, p_kind text, p_body text, p_payload jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); plan text; day_date date; body text := nullif(trim(coalesce(p_body, '')), ''); n int; partner uuid;
  label text := case p_kind when 'letter' then '편지' when 'reply' then '답장' else '첫 장면' end; t timestamptz := public.app_now();
  clean jsonb; prev_opened boolean; prev_commented boolean; own_first text; partner_first text; places text[]; place text; legacy boolean; photo text;
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
  if p_kind = 'letter' then
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
    perform public.notify(partner, 'program-sent', '상대가 DAY0' || p_day || ' ' || case p_kind when 'letter' then '편지를' when 'reply' then '답장을' else '첫 장면 답을' end || ' 보냈어요',
      case when p_kind = 'reply' then '내 답장도 보내면 함께 열려요. ' || to_char(day_date + 1, 'FMMM"월" FMDD"일"') || ' 09:00까지예요.' else '내 글도 보내면 23:59 전에 함께 열려요.' end,
      '/exchange', 'sent:' || p.id || ':' || p_day || ':' || p_kind || ':' || me);
  end if;
  return public.my_program();
end $$;

-- ─────────────────────────────────────────────────────────
-- 6. B 마지막 맞추기: 두 분이 고른 것 중에서 하나씩. 그날 답이 열리지 않았으면 처음 목록(장소에 맞는 목록)에서,
--    직접 쓴 것은 내가 쓴 것과 상대가 첫 장면에 고른 것(상대 선택으로 맞추기)도 고를 수 있다.
create or replace function public.choose_first_scene(p_program uuid, p_pick jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); partner uuid; pick jsonb; mine jsonb; theirs jsonb; own1 jsonb; own2 jsonb;
  acts text[]; flows text[]; rests text[]; topics text[];
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
  select payload into mine from public.program_entries where program_id = p.id and day = 3 and kind = 'final' and author = me;
  select payload into theirs from public.program_entries where program_id = p.id and day = 3 and kind = 'final' and author = partner;
  select payload into own1 from public.program_entries where program_id = p.id and day = 1 and kind = 'scene' and author = me;
  select payload into own2 from public.program_entries where program_id = p.id and day = 2 and kind = 'scene' and author = me;
  select case when count(*) = 2 then array_agg(distinct payload ->> 'activity') else array['exhibition', 'walk', 'bookstore', 'cafe', 'park', 'market', 'performance'] end into acts
    from public.program_entries where program_id = p.id and day = 1 and kind = 'scene';
  select case when count(*) = 2 then array_agg(distinct payload ->> 'flow') end, case when count(*) = 2 then array_agg(distinct payload ->> 'rest') end into flows, rests
    from public.program_entries where program_id = p.id and day = 2 and kind = 'scene';
  if flows is null then
    flows := coalesce(public.scene_options(p_pick ->> 'activity', 'flow'), '{}') || public.scene_stay_options(null, 'legacy-flow');
    rests := coalesce(public.scene_options(p_pick ->> 'activity', 'rest'), '{}') || public.scene_stay_options(null, 'legacy-rest');
  end if;
  -- 직접 쓴 것: 내가 쓴 것 · 상대가 첫 장면에 고른 것
  acts := acts || array_remove(array[case when public.scene_custom_ok(own1 ->> 'activity') then own1 ->> 'activity' end, case when public.scene_custom_ok(theirs ->> 'activity') then theirs ->> 'activity' end], null);
  flows := flows || array_remove(array[case when public.scene_custom_ok(own2 ->> 'flow') then own2 ->> 'flow' end, case when public.scene_custom_ok(theirs ->> 'flow') then theirs ->> 'flow' end], null);
  rests := rests || array_remove(array[case when public.scene_custom_ok(own2 ->> 'rest') then own2 ->> 'rest' end, case when public.scene_custom_ok(theirs ->> 'rest') then theirs ->> 'rest' end], null);
  select array_agg(distinct payload ->> 'topic') into topics from public.program_entries where program_id = p.id and day = 3 and kind = 'scene';
  pick := jsonb_build_object('activity', p_pick ->> 'activity', 'flow', p_pick ->> 'flow', 'rest', p_pick ->> 'rest', 'topic', p_pick ->> 'topic');
  if not (coalesce(pick ->> 'activity' = any (acts), false) and coalesce(pick ->> 'flow' = any (flows), false)
          and coalesce(pick ->> 'rest' = any (rests), false) and coalesce(pick ->> 'topic' = any (topics), false)) then
    raise exception '두 분이 고른 것 중에서 하나씩 골라 주세요.';
  end if;
  if mine is not null and theirs is not null and mine = theirs then raise exception '두 분이 이미 같은 장면으로 정했어요.'; end if;
  insert into public.program_entries (program_id, day, kind, author, payload) values (p.id, 3, 'final', me, pick)
    on conflict (program_id, day, kind, author) do update set payload = excluded.payload, created_at = now();
  if theirs is null then
    if partner is not null then
      perform public.notify(partner, 'program-final', '상대가 첫 장면을 골랐어요', '나도 고르면 두 분의 선택이 함께 열려요.', '/exchange', 'final-sent:' || p.id || ':' || me);
    end if;
    return public.my_program() || jsonb_build_object('notice', '골랐어요. 상대도 고르면 두 분의 선택이 함께 열려요. 이제 이 장면에 대해 짧게 써 볼 수 있어요.');
  elsif theirs = pick then
    perform public.notify(m, 'program-final', '두 분의 첫 장면이 정해졌어요', '같은 장면을 골랐어요. 이 장면에 대해 짧게 써서 나눠 보세요. 두 분 모두 만나고 싶다고 하면 약속 제안에 그대로 담겨요.', '/exchange', 'final-agreed:' || p.id || ':' || m)
      from unnest(array[p.member_a, p.member_b]) m where m is not null;
    return public.my_program() || jsonb_build_object('notice', '두 분이 같은 장면을 골랐어요. 첫 장면이 정해졌어요.');
  end if;
  perform public.notify(partner, 'program-final', '첫 장면에 서로 다른 부분이 있어요', '두 분의 선택을 비교해 보고, 맞출 부분을 다시 골라 주세요.', '/exchange', 'final-diff:' || p.id || ':' || me || ':' || extract(epoch from clock_timestamp())::bigint);
  return public.my_program() || jsonb_build_object('notice', '상대와 다른 부분이 있어요. 아래에서 비교하고 다시 고를 수 있어요.');
end $$;

-- ─────────────────────────────────────────────────────────
-- 7. B 내가 고른 첫 장면에 대해: 내 첫 장면을 고른 뒤, 만남 선택 마감(다섯째 날 09:00)까지 한 번. 두 분 모두 쓰면 함께 열린다.
--    쓸 때 고른 장면을 함께 남긴다(나중에 다시 골라도 어떤 장면을 떠올리며 썼는지 보이게).
create or replace function public.write_scene_piece(p_program uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); partner uuid; body text := nullif(trim(coalesce(p_body, '')), ''); mine jsonb; n int; until timestamptz;
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.plan_a is distinct from 'B' then raise exception '첫 장면 이야기는 B 방식에서만 써요.'; end if;
  until := public.kst_at(p.start_on + 4, '09:00');
  if p.status not in ('started', 'deciding', 'arranging') or public.app_now() >= until then
    raise exception '첫 장면 이야기는 만남 선택 마감(다섯째 날 09:00)까지 쓸 수 있어요.';
  end if;
  select payload into mine from public.program_entries where program_id = p.id and day = 3 and kind = 'final' and author = me;
  if mine is null then raise exception '첫 장면을 먼저 골라 주세요.'; end if;
  if body is null or char_length(body) < 10 or char_length(body) > 300 then raise exception '첫 장면 이야기는 10~300자로 써 주세요.'; end if;
  perform public.check_member_text(body, '첫 장면 이야기');
  if exists (select 1 from public.program_entries where program_id = p.id and day = 3 and kind = 'piece' and author = me) then
    raise exception '이미 보낸 첫 장면 이야기는 고치거나 다시 보낼 수 없어요.';
  end if;
  insert into public.program_entries (program_id, day, kind, author, body, payload) values (p.id, 3, 'piece', me, body, mine);
  partner := public.program_partner(p, me);
  select count(*) into n from public.program_entries where program_id = p.id and day = 3 and kind = 'piece';
  if n = 2 then
    perform public.notify(m, 'program-open', '첫 장면 이야기가 함께 열렸어요', '두 분이 그린 첫 장면을 읽어 보고, 한마디를 남겨 보세요.', '/exchange', 'piece-open:' || p.id || ':' || m)
      from unnest(array[p.member_a, p.member_b]) m where m is not null;
    return public.my_program() || jsonb_build_object('notice', '보냈어요. 두 분의 첫 장면 이야기가 함께 열렸어요.');
  elsif partner is not null then
    perform public.notify(partner, 'program-sent', '상대가 첫 장면 이야기를 썼어요',
      '나도 쓰면 함께 열려요. ' || to_char(p.start_on + 4, 'FMMM"월" FMDD"일"') || ' 09:00까지예요.', '/exchange', 'piece-sent:' || p.id || ':' || me);
  end if;
  return public.my_program() || jsonb_build_object('notice', '보냈어요. 상대도 쓰면 함께 열려요.');
end $$;

-- ─────────────────────────────────────────────────────────
-- 8. B 한마디: 함께 열린 그날 답(다음 날 09:00까지)·첫 장면 이야기(만남 선택 마감까지)에 한 번씩, 100자 안. 쓰는 즉시 상대에게 보인다.
create or replace function public.leave_scene_comment(p_program uuid, p_on text, p_day int, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); partner uuid; body text := nullif(trim(coalesce(p_body, '')), ''); k text; d int; until timestamptz;
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.plan_a is distinct from 'B' then raise exception '한마디는 B 방식에서 남겨요.'; end if;
  if p_on not in ('scene', 'piece') then raise exception '한마디를 남길 글을 확인해 주세요.'; end if;
  if p.status not in ('started', 'deciding', 'arranging') then raise exception '지금은 한마디를 남길 수 없어요.'; end if;
  if p_on = 'scene' then
    if p_day is null or p_day not between 1 and 3 then raise exception '한마디를 남길 글을 확인해 주세요.'; end if;
    if (select count(*) from public.program_entries where program_id = p.id and day = p_day and kind = 'scene') < 2 then
      raise exception '그날 답이 두 분 모두에게 열린 뒤에 한마디를 남길 수 있어요.';
    end if;
    k := 'comment'; d := p_day; until := public.kst_at(p.start_on + p_day, '09:00');
    if public.app_now() >= until then raise exception '그날 답에 남기는 한마디는 다음 날 09:00(한국 시간)까지예요.'; end if;
  else
    if (select count(*) from public.program_entries where program_id = p.id and day = 3 and kind = 'piece') < 2 then
      raise exception '두 분의 첫 장면 이야기가 함께 열린 뒤에 한마디를 남길 수 있어요.';
    end if;
    k := 'piece-comment'; d := 3; until := public.kst_at(p.start_on + 4, '09:00');
    if public.app_now() >= until then raise exception '첫 장면 이야기에 남기는 한마디는 만남 선택 마감(다섯째 날 09:00)까지예요.'; end if;
  end if;
  if body is null or char_length(body) > 100 then raise exception '한마디는 1~100자로 남겨 주세요.'; end if;
  perform public.check_member_text(body, '교류 한마디');
  if exists (select 1 from public.program_entries where program_id = p.id and day = d and kind = k and author = me) then
    raise exception '한마디는 한 번만 남길 수 있어요.';
  end if;
  insert into public.program_entries (program_id, day, kind, author, body) values (p.id, d, k, me, body);
  partner := public.program_partner(p, me);
  if partner is not null then
    perform public.notify(partner, 'program-sent',
      case when k = 'comment' then '상대가 DAY0' || d || ' 내 선택에 한마디 남겼어요' else '상대가 내 첫 장면 이야기에 한마디 남겼어요' end,
      case when exists (select 1 from public.program_entries where program_id = p.id and day = d and kind = k and author = partner) then '교류 화면에서 확인해 보세요.'
           else '교류 화면에서 확인해 보세요. 나도 ' || to_char(until at time zone 'Asia/Seoul', 'FMMM"월" FMDD"일" HH24:MI') || '까지 한마디를 남길 수 있어요.' end,
      '/exchange', 'comment:' || p.id || ':' || k || ':' || d || ':' || me);
  end if;
  return public.my_program() || jsonb_build_object('notice', '남겼어요. 상대에게 바로 보여요.');
end $$;

-- ─────────────────────────────────────────────────────────
-- 9. 보존 기간 정리: 20261028002600의 run_program_retention 그대로에, 편지 사진 정리를 더한다.
--    보낸 편지에 붙어 있지 않은 사진(보내지 않은 사진 · 교류 글이 지워진 사진)은 올린 지 2일이 지나면 정리 대기열로 보낸다.
--    신고로 글을 남겨 둔 교류의 사진은 글과 함께 남는다.
create or replace function public.run_program_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e int; a int; o int; lp int;
begin
  delete from public.program_entries x using public.programs p where x.program_id = p.id and p.status = 'closed' and p.closed_at < now() - interval '30 days'
     and not exists (select 1 from public.reports r where r.introduction_id = p.introduction_id and (r.status <> 'closed' or coalesce(r.handled_at, r.created_at) > now() - interval '3 years'));
  get diagnostics e = row_count;
  delete from public.appointment_proposals x using public.programs p where x.program_id = p.id and p.status = 'closed'
     and coalesce(public.kst_at(p.meeting_on, '00:00'), p.closed_at) < now() - interval '90 days';
  get diagnostics a = row_count;
  update public.programs set meeting_time = null where status = 'closed' and meeting_time is not null
     and coalesce(public.kst_at(meeting_on, '00:00'), closed_at) < now() - interval '90 days';
  insert into public.storage_cleanup (bucket, path)
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'application-photos'
     and (not exists (select 1 from public.profiles pr where pr.id::text = split_part(o.name, '/', 1))
          or (o.created_at < now() - interval '2 days'
              and not exists (select 1 from public.application_photos ap where ap.path = o.name)
              and not exists (select 1 from public.introductions i where (i.snapshot_a -> 'photos') @> jsonb_build_array(jsonb_build_object('path', o.name)) or (i.snapshot_b -> 'photos') @> jsonb_build_array(jsonb_build_object('path', o.name)))))
  on conflict do nothing;
  get diagnostics o = row_count;
  insert into public.storage_cleanup (bucket, path)
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'letter-photos' and o.created_at < now() - interval '2 days' and not public.letter_photo_attached(o.name)
  on conflict do nothing;
  get diagnostics lp = row_count;
  delete from auth.users u where u.email_confirmed_at is null and u.created_at < now() - interval '7 days'
     and not exists (select 1 from public.admin_roles ar where ar.user_id = u.id);
  delete from public.client_errors where at < now() - interval '30 days';
  insert into public.job_runs (job, finished_at, ok, detail) values ('program-retention', now(), true, jsonb_build_object('entries', e, 'proposals', a, 'orphanPhotos', o, 'letterPhotos', lp));
  return jsonb_build_object('entries', e, 'proposals', a, 'orphanPhotos', o, 'letterPhotos', lp);
end $$;

-- ─────────────────────────────────────────────────────────
-- 권한
revoke all on function public.scene_custom_ok(text), public.scene_options(text, text),
  public.program_entries_json(uuid, uuid, uuid), public.run_program_retention() from public, anon, authenticated;
-- 저장소 정책이 회원 권한으로 부르는 함수(안에서 auth.uid()로 확인한다)
revoke all on function public.letter_photo_upload_ok(text), public.can_view_letter_photo(text), public.letter_photo_attached(text) from public, anon;
grant execute on function public.letter_photo_upload_ok(text), public.can_view_letter_photo(text), public.letter_photo_attached(text) to authenticated;
revoke all on function public.submit_program_entry(uuid, int, text, text, jsonb), public.choose_first_scene(uuid, jsonb),
  public.write_scene_piece(uuid, text), public.leave_scene_comment(uuid, text, int, text) from public, anon;
grant execute on function public.submit_program_entry(uuid, int, text, text, jsonb), public.choose_first_scene(uuid, jsonb),
  public.write_scene_piece(uuid, text), public.leave_scene_comment(uuid, text, int, text) to authenticated;
