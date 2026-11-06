-- 6500: GPT 3차 검수 R3-01 — ‘추가 정보’ 동의(consent.matching)를 선택으로 · 거부·철회하면 선택 정보는 서버가 지운다
--
-- 문제: 추가 사진·키·체형·스타일·흡연·음주·관심사·직업 분야·질문 답변·알게 된 경로를 묶은 동의(consent.matching)가 서버 제출 조건이라,
--       선택 정보를 하나도 쓰지 않은 사람도 이 동의 없이는 신청할 수 없었다(거부할 자유·최소 수집과 맞지 않음).
-- 고침(동의 키 이름은 그대로 consent.matching · 화면과 같은 이름):
--   · 제출·승인 조건(application_problem)의 필수 확인은 consent.collection · consent.provision · consent.review · self.statement · self.pledge 다섯 개.
--   · 핵심 항목(application_core_keys)만으로 신청할 수 있다. 나머지 값(선택 프로필·표현·선호·알게 된 경로)과 선택 사진(photo.daily)은 ‘추가 정보’.
--   · 제출할 때 consent.matching 이 true 가 아니면 서버가 추가 정보를 지운다(초안 값·공개 설정·선택 사진).
--   · 저장할 때 consent.matching 이 false(거부·철회를 직접 고름)이면 그때도 지운다. 아직 답하지 않았으면(값 없음) 초안은 그대로 둔다.
--   · withdraw_extra_consent(): 진행 중인 소개가 있어도 철회할 수 있다(재검토 없이). 아직 공개 전 소개 사본은 다시 만들고,
--     이미 공개된 소개 사본에서도 추가 정보와 선택 사진을 뺀다(이미 본 내용을 되돌릴 수는 없고, 앞으로의 열람만 막는다).
--   · 상대에게 가는 사본(public_profile)은 이 동의가 없으면 핵심 공개 항목과 필수 사진만 담는다(값이 남아 있어도).
--   · 선택 사진 파일: 행을 지우면 기존 트리거가 정리 대기열에 넣고, 쓰이는 동안(공개 중 사본 등)은 지우지 않는다(storage_path_in_use).

-- 추가 정보 동의 없이도 남는 핵심 항목(신청서 values 키). consent.* 는 동의 기록이라 늘 남긴다.
create or replace function public.application_core_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['self.name','self.birthDate','self.phone','self.notifyChannels','self.gender','desired.gender','self.province','self.area',
               'self.purpose','self.bio','self.statement','self.pledge']
$$;

-- 상대 공개 항목 가운데 추가 정보 동의 없이도 보이는 것
create or replace function public.base_public_field_ids() returns text[]
language sql immutable set search_path = '' as $$
  select array['self.name','self.age','self.province','self.area','self.purpose','self.bio']
$$;

create or replace function public.extra_consent_given(p_values jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_values ->> 'consent.matching', '') = 'true'
$$;

-- 초안에서 추가 정보만 뺀다(핵심 항목과 동의 기록은 그대로).
create or replace function public.strip_extra_from_draft(p_draft jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select (coalesce(p_draft, '{}'::jsonb) - 'preferences')
    -- preferences 안 ‘신청 보류 의사·운영진 요청’(request·requestNote)은 추가 정보가 아니라 남긴다(중요도·비공개 표시만 뺀다 · 화면과 같게)
    || case when jsonb_typeof(p_draft -> 'preferences') = 'object' and (p_draft -> 'preferences' ? 'request' or p_draft -> 'preferences' ? 'requestNote')
            then jsonb_build_object('preferences', jsonb_strip_nulls(jsonb_build_object('request', p_draft -> 'preferences' -> 'request', 'requestNote', p_draft -> 'preferences' -> 'requestNote')))
            else '{}'::jsonb end
    || jsonb_build_object(
         'values', coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(coalesce(p_draft -> 'values', '{}'::jsonb)) e
                              where e.key = any(public.application_core_keys()) or e.key like 'consent.%'), '{}'::jsonb),
         'sharing', coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(case when jsonb_typeof(p_draft -> 'sharing') = 'object' then p_draft -> 'sharing' else '{}'::jsonb end) e
                              where e.key = any(public.base_public_field_ids())), '{}'::jsonb))
$$;

-- 한 회원의 추가 정보를 서버에서 지운다: 초안 값 · 공개 설정 · 선택 사진(신청 사진 · 교체 대기) → 파일은 정리 대기열로(쓰이는 동안은 남김)
create or replace function public.strip_extra_application(p_member uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n int := 0; d jsonb;
begin
  select draft into d from public.applications where member_id = p_member for update;
  if d is null then return 0; end if;
  update public.applications set draft = public.strip_extra_from_draft(d), updated_at = now()
   where member_id = p_member and draft is distinct from public.strip_extra_from_draft(d);
  get diagnostics n = row_count;
  delete from public.photo_replacements where member_id = p_member and slot not in ('photo.face', 'photo.upper', 'photo.style');
  delete from public.application_photos where member_id = p_member and slot not in ('photo.face', 'photo.upper', 'photo.style');
  return n;
end $$;
revoke all on function public.application_core_keys(), public.base_public_field_ids(), public.extra_consent_given(jsonb),
  public.strip_extra_from_draft(jsonb), public.strip_extra_application(uuid) from public, anon, authenticated;

-- 상대에게 가는 사본: 추가 정보 동의가 없으면 핵심 공개 항목·필수 사진만(값이 남아 있더라도)
CREATE OR REPLACE FUNCTION public.public_profile(p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d jsonb; v jsonb; s jsonb; items jsonb := '[]'::jsonb; photo_list jsonb; field text; val jsonb; profile_ver int; member_age int; first_word text; extra boolean;
begin
  select a.draft, a.profile_version into d, profile_ver from public.applications a where a.member_id = p_member;
  if d is null then return null; end if;
  v := coalesce(d -> 'values', '{}'::jsonb);
  s := coalesce(d -> 'sharing', '{}'::jsonb);
  extra := public.extra_consent_given(v);
  foreach field in array public.public_field_ids() loop
    if not extra and not (field = any(public.base_public_field_ids())) then continue; end if;
    if field = 'self.age' then
      member_age := public.age_from(v ->> 'self.birthDate');
      if member_age is not null and member_age >= 19 and coalesce((s ->> 'self.age')::boolean, true) then
        items := items || jsonb_build_array(jsonb_build_object('id', field, 'value', member_age || '세'));
      end if;
      continue;
    end if;
    val := v -> field;
    if val is null or val = '""'::jsonb or val = 'false'::jsonb or val = '[]'::jsonb or val = '"답하지 않음"'::jsonb or val = '"미선택"'::jsonb then continue; end if;
    if coalesce((s ->> field)::boolean, false) then
      items := items || jsonb_build_array(jsonb_build_object('id', field, 'value', val));
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('slot', p.slot, 'path', p.path) order by p.slot = 'photo.daily', p.slot), '[]'::jsonb)
    into photo_list
    from public.application_photos p
    where p.member_id = p_member and p.review = '기준 확인'
      and (p.slot <> 'photo.daily' or (extra and coalesce((s ->> 'photo.daily')::boolean, false)));
  select g.body into first_word from public.greetings g where g.member_id = p_member;
  return jsonb_build_object('version', profile_ver, 'items', items, 'photos', photo_list, 'greeting', first_word);
end $function$;

-- 제출·승인 조건: consent.matching 을 필수에서 뺀다(나머지는 23_beta_age_and_drafts 정의 그대로)
CREATE OR REPLACE FUNCTION public.application_problem(p_member uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb; age int; missing text[]; ch jsonb; field text;
begin
  if not exists (select 1 from public.profiles p where p.id = p_member and p.adult_confirmed_at is not null and p.terms_agreed_at is not null and p.privacy_agreed_at is not null) then
    return '만 19세 확인과 약관·개인정보 동의가 필요해요. 문의하기로 알려 주세요.';
  end if;
  select coalesce(a.draft -> 'values', '{}'::jsonb) into v from public.applications a where a.member_id = p_member;
  if v is null then return '먼저 신청서를 저장해 주세요.'; end if;
  age := public.age_from(v ->> 'self.birthDate');
  if age is null or age < 19 then return '만 19세 이상만 신청할 수 있어요.'; end if;
  if extract(year from (v ->> 'self.birthDate')::date)::int not between (public.birth_year_range())[1] and (public.birth_year_range())[2] then
    return (public.birth_year_range())[1] || '~' || (public.birth_year_range())[2] || '년생(한국 나이 20~35세)만 신청할 수 있어요.';
  end if;
  if not public.valid_phone(v ->> 'self.phone') then return '휴대폰 번호를 확인해 주세요.'; end if;
  ch := case when jsonb_typeof(v -> 'self.notifyChannels') = 'array' then v -> 'self.notifyChannels' else '[]'::jsonb end;
  if not ch ?| array['카카오톡', '문자'] then return '알림 받을 방법으로 카카오톡이나 문자 중 하나는 골라 주세요.'; end if;
  select array_agg(k) into missing from unnest(array['consent.collection','consent.provision','consent.review','self.statement','self.pledge']) k
    where coalesce((v ->> k)::boolean, false) is not true;
  if missing is not null then return '필수 확인 항목이 남아 있어요.'; end if;
  select array_agg(k) into missing from unnest(array['self.name','self.gender','desired.gender','self.province','self.area','self.purpose','self.bio']) k
    where coalesce(v ->> k, '') = '';
  if missing is not null then return '필수 항목이 남아 있어요.'; end if;
  if (select count(*) from public.application_photos where member_id = p_member and slot in ('photo.face','photo.upper','photo.style') and review <> '재등록 요청') < 3 then
    return '필수 사진 세 장이 필요해요.';
  end if;
  -- 상대에게 보이는 글에는 연락처·SNS·링크를 넣을 수 없다(연락처는 만나는 날 동의한 경우에만 열린다).
  foreach field in array public.public_field_ids() loop
    if field <> 'self.age' and public.has_contact(normalize(coalesce(v ->> field, ''), NFKC)) then
      return '소개 글에 연락처·SNS 아이디·링크는 넣을 수 없어요. 연락처는 두 분이 동의하면 만나는 날 플라비에서 열려요.';
    end if;
  end loop;
  return null;
end $function$;

-- 저장: consent.matching 을 false 로 고른 초안은 추가 정보를 빼고 저장한다(나머지는 5700 정의 그대로)
CREATE OR REPLACE FUNCTION public.save_application_draft(p_draft jsonb, p_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare clean jsonb; st text; cur int; saved int; refused boolean;
begin
  if jsonb_typeof(p_draft) <> 'object' then raise exception '신청서 형식을 확인해 주세요.'; end if;
  st := public.prepare_application_edit();
  select draft_rev into cur from public.applications where member_id = auth.uid() for update;
  if p_revision is not null and cur is distinct from p_revision then
    raise exception '다른 화면에서 먼저 저장된 내용이 있어요. 새로 불러온 뒤 이어서 써 주세요.' using errcode = 'P0409';
  end if;
  -- 사진 파일 정보와 검토 상태는 서버 표가 기준이므로 본문에서 뺀다.
  clean := p_draft - 'photos' - 'review' - 'completedDemo';
  refused := coalesce(clean -> 'values' ->> 'consent.matching', '') = 'false';
  if refused then clean := public.strip_extra_from_draft(clean); end if;
  update public.applications set draft = clean, updated_at = now() where member_id = auth.uid() returning draft_rev into saved;
  if refused then perform public.strip_extra_application(auth.uid()); end if;
  return jsonb_build_object('savedAt', now(), 'status', st, 'revision', coalesce(saved, cur), 'extraRemoved', refused);
end $function$;

-- 제출: 추가 정보 동의가 없으면 추가 정보를 지운 뒤 확인한다(나머지는 기존 정의 그대로)
CREATE OR REPLACE FUNCTION public.submit_application()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; v jsonb; ch jsonb; problem text; stripped boolean := false;
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '로그인한 회원만 신청할 수 있어요.'; end if;
  select * into a from public.applications where member_id = auth.uid() for update;
  if a is null then raise exception '먼저 신청서를 저장해 주세요.'; end if;
  if a.status not in ('draft', 'needs_changes', 'submitted') then raise exception '지금은 제출할 수 없는 상태예요.'; end if;
  if not public.extra_consent_given(coalesce(a.draft -> 'values', '{}'::jsonb)) then
    perform public.strip_extra_application(auth.uid());
    stripped := true;
    select * into a from public.applications where member_id = auth.uid();
  end if;
  v := coalesce(a.draft -> 'values', '{}'::jsonb);
  problem := public.application_problem(auth.uid());
  if problem is not null then raise exception '%', problem; end if;
  if a.submitted_at is null then
    ch := case when jsonb_typeof(v -> 'self.notifyChannels') = 'array' then v -> 'self.notifyChannels' else '[]'::jsonb end;
    update public.profiles
       set notice_daily_waiting = coalesce(v ->> 'consent.noon' = 'true', false),
           marketing_opt_in = coalesce(v ->> 'consent.marketing' = 'true', false),
           notify_kakao = ch ? '카카오톡', notify_sms = ch ? '문자', notify_email = ch ? '메일',
           updated_at = now()
     where id = auth.uid();
  end if;
  update public.applications
     set status = 'submitted', submitted_at = coalesce(case when a.status = 'submitted' then a.submitted_at end, now()), updated_at = now(),
         profile_version = case when a.status = 'needs_changes' then a.profile_version + 1 else a.profile_version end
   where member_id = auth.uid();
  perform public.write_audit(case when a.status = 'submitted' then '신청서 수정 제출' else '신청서 제출' end, auth.uid()::text);
  return jsonb_build_object('status', 'submitted', 'submittedAt', now(), 'edited', a.status = 'submitted', 'extraRemoved', stripped);
end $function$;

-- 추가 정보 동의 철회(진행 중인 소개가 있어도 · 재검토 없이 · 회원 상태·권리는 그대로)
create or replace function public.withdraw_extra_consent() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); d jsonb; r record; fixed int := 0;
begin
  if me is null or not public.is_active_member() then raise exception '로그인한 회원만 바꿀 수 있어요.'; end if;
  select draft into d from public.applications where member_id = me for update;
  if d is null then raise exception '신청서가 없어요.'; end if;
  update public.applications
     set draft = jsonb_set(public.strip_extra_from_draft(d), '{values,consent.matching}', 'false'::jsonb), updated_at = now()
   where member_id = me;
  perform public.strip_extra_application(me);
  -- 아직 공개 전인 소개 사본은 새로 만들고, 공개 중인 사본에서는 추가 정보·선택 사진만 뺀다.
  perform public.refresh_reserved_snapshots(me);
  for r in select id, member_a = me as is_a from public.introductions
            where me in (member_a, member_b) and status in ('published', 'mutual') loop
    update public.introductions i set
      snapshot_a = case when r.is_a then public.strip_extra_from_snapshot(i.snapshot_a) else i.snapshot_a end,
      snapshot_b = case when r.is_a then i.snapshot_b else public.strip_extra_from_snapshot(i.snapshot_b) end
     where i.id = r.id;
    fixed := fixed + 1;
  end loop;
  perform public.write_audit('추가 정보 동의 철회', me::text, '추가 정보·선택 사진 삭제');
  return jsonb_build_object('withdrawn', true, 'openIntroductionsUpdated', fixed);
end $$;

create or replace function public.strip_extra_from_snapshot(p_snapshot jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' or p_snapshot ? 'deleted' then p_snapshot else
    p_snapshot || jsonb_build_object(
      'items', coalesce((select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(p_snapshot -> 'items') = 'array' then p_snapshot -> 'items' else '[]'::jsonb end) x
                          where x ->> 'id' = any(public.base_public_field_ids())), '[]'::jsonb),
      'photos', coalesce((select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(p_snapshot -> 'photos') = 'array' then p_snapshot -> 'photos' else '[]'::jsonb end) x
                          where x ->> 'slot' in ('photo.face', 'photo.upper', 'photo.style')), '[]'::jsonb)) end
$$;
revoke all on function public.strip_extra_from_snapshot(jsonb), public.withdraw_extra_consent() from public, anon;
revoke all on function public.strip_extra_from_snapshot(jsonb) from authenticated;
grant execute on function public.withdraw_extra_consent() to authenticated;
