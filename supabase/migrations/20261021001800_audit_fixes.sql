-- 베타 전 점검에서 나온 것 고치기
--  1) ‘베타 의견’ 문의가 저장되지 않던 것(문의 유형 제약)
--  2) 제출 뒤 고친 신청서도 승인 전에 같은 기준으로 다시 확인(만 19세·번호·동의·필수 항목·사진·소개 글의 연락처)
--  3) 기수 시작 전에는 ‘오늘은 소개가 없어요’ 알림을 보내지 않는다
--  4) 상대에게는 기준 확인한 사진만 보인다
--  5) 닫힌 교류(차단·탈퇴·정지 포함)는 글·이름·약속을 더 보여 주지 않는다
--  6) 약속 후보 시간에는 날짜·시각만 저장하고, 만나는 날에는 수락으로 약속을 바꾸지 않는다
--  7) 문의 전체 제한은 비로그인 문의에만(회원의 안전 신고가 막히지 않게)
--  8) 남은 사진 파일 정리
alter table public.inquiries drop constraint if exists inquiries_type_check;
alter table public.inquiries add constraint inquiries_type_check check (type in ('서비스 이용 방법', '신청·검토', '소개·교류', '결제·환불', '개인정보·탈퇴', '안전·신고', '제휴·기타', '베타 의견'));

-- 신청서가 제출·승인할 수 있는 상태인지 확인한다(문제가 있으면 회원이 읽을 안내, 없으면 null).
-- 제출할 때와 운영진이 승인할 때 같은 기준을 쓴다(제출 뒤 고친 내용도 승인 전에 다시 확인).
create or replace function public.application_problem(p_member uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; age int; missing text[]; ch jsonb; field text;
begin
  if not exists (select 1 from public.profiles p where p.id = p_member and p.adult_confirmed_at is not null and p.terms_agreed_at is not null and p.privacy_agreed_at is not null) then
    return '만 19세 확인과 약관·개인정보 동의가 필요해요. 문의하기로 알려 주세요.';
  end if;
  select coalesce(a.draft -> 'values', '{}'::jsonb) into v from public.applications a where a.member_id = p_member;
  if v is null then return '먼저 신청서를 저장해 주세요.'; end if;
  age := public.age_from(v ->> 'self.birthDate');
  if age is null or age < 19 then return '만 19세 이상만 신청할 수 있어요.'; end if;
  if not public.valid_phone(v ->> 'self.phone') then return '휴대폰 번호를 확인해 주세요.'; end if;
  ch := case when jsonb_typeof(v -> 'self.notifyChannels') = 'array' then v -> 'self.notifyChannels' else '[]'::jsonb end;
  if not ch ?| array['카카오톡', '문자'] then return '알림 받을 방법으로 카카오톡이나 문자 중 하나는 골라 주세요.'; end if;
  select array_agg(k) into missing from unnest(array['consent.collection','consent.matching','consent.provision','consent.review','self.statement','self.pledge']) k
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
      return '소개 글에 연락처·SNS 아이디·링크는 넣을 수 없어요. 연락처는 두 분이 동의하면 만나는 날 비포어스에서 열려요.';
    end if;
  end loop;
  return null;
end $$;

create or replace function public.submit_application() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.applications; v jsonb; ch jsonb; problem text;
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '로그인한 회원만 신청할 수 있어요.'; end if;
  select * into a from public.applications where member_id = auth.uid() for update;
  if a is null then raise exception '먼저 신청서를 저장해 주세요.'; end if;
  if a.status not in ('draft', 'needs_changes', 'submitted') then raise exception '지금은 제출할 수 없는 상태예요.'; end if;
  v := coalesce(a.draft -> 'values', '{}'::jsonb);
  problem := public.application_problem(auth.uid());
  if problem is not null then raise exception '%', problem; end if;
  ch := case when jsonb_typeof(v -> 'self.notifyChannels') = 'array' then v -> 'self.notifyChannels' else '[]'::jsonb end;
  update public.profiles
     set notice_daily_waiting = coalesce(v ->> 'consent.noon' = 'true', false),
         marketing_opt_in = coalesce(v ->> 'consent.marketing' = 'true', false),
         notify_kakao = ch ? '카카오톡', notify_sms = ch ? '문자', notify_email = ch ? '메일',
         updated_at = now()
   where id = auth.uid();
  update public.applications
     set status = 'submitted', submitted_at = coalesce(case when a.status = 'submitted' then a.submitted_at end, now()), updated_at = now(),
         profile_version = case when a.status = 'needs_changes' then a.profile_version + 1 else a.profile_version end
   where member_id = auth.uid();
  perform public.write_audit(case when a.status = 'submitted' then '신청서 수정 제출' else '신청서 제출' end, auth.uid()::text);
  return jsonb_build_object('status', 'submitted', 'submittedAt', now(), 'edited', a.status = 'submitted');
end $$;

create or replace function public.admin_decide_application(p_member uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare current_status text; problem text;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_status not in ('reviewing', 'approved', 'needs_changes', 'held', 'rejected') then raise exception '결정 값을 확인해 주세요.'; end if;
  select status into current_status from public.applications where member_id = p_member for update;
  if current_status is null then raise exception '신청서를 찾을 수 없어요.'; end if;
  if current_status in ('draft', 'withdrawn') then raise exception '제출된 신청서만 결정할 수 있어요.'; end if;
  if p_status in ('needs_changes', 'held', 'rejected') and coalesce(trim(p_note), '') = '' then raise exception '회원에게 보낼 안내를 적어 주세요.'; end if;
  if p_status = 'approved' and exists (select 1 from public.application_photos where member_id = p_member and review <> '기준 확인' and slot <> 'photo.daily') then
    raise exception '필수 사진 세 장을 모두 기준 확인한 뒤 승인해 주세요.';
  end if;
  if p_status = 'approved' then
    problem := public.application_problem(p_member);
    if problem is not null then raise exception '승인할 수 없어요 · %', problem; end if;
  end if;
  update public.applications
     set status = p_status, decided_at = now(), decided_by = auth.uid(),
         decision_note = case when p_status = 'reviewing' then decision_note else nullif(trim(p_note), '') end,
         updated_at = now()
   where member_id = p_member;
  perform public.write_audit('신청서 결정 · ' || p_status, p_member::text);
end $$;

create or replace function public.run_noon() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run_id bigint; published int := 0; missed int := 0; waiting int := 0; r record; today date := public.kst_today(); result jsonb;
begin
  insert into public.job_runs (job) values ('noon') returning id into run_id;
  begin
    -- 정오에서 30분 넘게 늦은 예약은 한쪽만 늦게 공개하지 않고 취소한다(운영진이 다시 예약).
    for r in update public.introductions set status = 'cancelled', closed_at = now(), end_reason = 'missed-window'
               where status = 'reserved' and reveal_at <= now() - interval '30 minutes' returning id loop
      missed := missed + 1;
    end loop;
    for r in update public.introductions set status = 'published', published_at = now()
               where status = 'reserved' and reveal_at <= now() returning id, member_a, member_b loop
      published := published + 1;
      perform public.notify(r.member_a, 'new-introduction', '오늘의 인연이 도착했어요', '내일 오전 11시까지 답해 주세요.', '/us', 'intro:' || r.id || ':' || r.member_a);
      perform public.notify(r.member_b, 'new-introduction', '오늘의 인연이 도착했어요', '내일 오전 11시까지 답해 주세요.', '/us', 'intro:' || r.id || ':' || r.member_b);
    end loop;
    -- 소개가 없는 날 알림은 받기로 한 회원에게만
    for r in select p.id from public.profiles p join public.applications a on a.member_id = p.id
              join public.cohorts c on c.number = a.cohort_number and c.starts_on <= today
              where p.status = 'active' and p.paused_at is null and a.status = 'approved' and p.notice_daily_waiting
                and not exists (select 1 from public.introductions i where p.id in (i.member_a, i.member_b) and i.status in ('published', 'mutual')) loop
      waiting := waiting + 1;
      perform public.notify(r.id, 'waiting', '오늘은 소개가 없어요', '잘 맞는 분이 준비되면 정오에 알려 드릴게요.', '/today', 'waiting:' || today || ':' || r.id);
    end loop;
    result := jsonb_build_object('published', published, 'missed', missed, 'waiting', waiting);
    update public.job_runs set finished_at = now(), ok = true, detail = result where id = run_id;
  exception when others then
    -- 안쪽 작업만 되돌리고 실패 기록은 남긴다(운영진이 다시 실행).
    result := jsonb_build_object('error', sqlerrm);
    update public.job_runs set finished_at = now(), ok = false, detail = result where id = run_id;
  end;
  return result;
end $$;

create or replace function public.public_profile(p_member uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d jsonb; v jsonb; s jsonb; items jsonb := '[]'::jsonb; photo_list jsonb; field text; val jsonb; profile_ver int; member_age int; first_word text;
begin
  select a.draft, a.profile_version into d, profile_ver from public.applications a where a.member_id = p_member;
  if d is null then return null; end if;
  v := coalesce(d -> 'values', '{}'::jsonb);
  s := coalesce(d -> 'sharing', '{}'::jsonb);
  foreach field in array public.public_field_ids() loop
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
    where p.member_id = p_member and p.review = '기준 확인' and (p.slot <> 'photo.daily' or coalesce((s ->> 'photo.daily')::boolean, false));
  select g.body into first_word from public.greetings g where g.member_id = p_member;
  return jsonb_build_object('version', profile_ver, 'items', items, 'photos', photo_list, 'greeting', first_word);
end $$;

create or replace function public.my_program() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); is_a boolean; partner uuid; i public.introductions; today date := public.kst_date(public.app_now());
  own_plan text; partner_plan text; entries jsonb; proposals jsonb; released boolean; phone text; day_now int; name text;
begin
  if me is null then return null; end if;
  p := public.my_program_row();
  if p.id is null then return null; end if;
  if p.status = 'closed' then
    return jsonb_build_object('id', p.id, 'introductionId', p.introduction_id, 'status', p.status, 'endReason', p.end_reason, 'closedAt', p.closed_at,
      'today', today, 'entries', '[]'::jsonb, 'proposals', '[]'::jsonb, 'meetingOn', p.meeting_on, 'ownContact', false, 'contactReleased', false);
  end if;
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
  p_slots := (select jsonb_agg(jsonb_build_object('date', x ->> 'date', 'start', x ->> 'start', 'end', x ->> 'end')) from jsonb_array_elements(p_slots) x);
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
  if p.meeting_on is not null and public.app_now() >= public.kst_at(p.meeting_on, '00:00') then raise exception '만나는 날이 되어 약속을 바꿀 수 없어요. 일정이 어려우면 문의해 주세요.'; end if;
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

create or replace function public.submit_inquiry(p_type text, p_name text, p_email text, p_body text, p_consent boolean, p_website text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(p_email)); v_body text := trim(p_body); nm text := trim(coalesce(p_name, '')); new_id text;
begin
  if coalesce(p_website, '') <> '' then return jsonb_build_object('error', '요청을 처리할 수 없어요.'); end if;
  if p_type not in ('서비스 이용 방법', '신청·검토', '소개·교류', '결제·환불', '개인정보·탈퇴', '안전·신고', '제휴·기타', '베타 의견') then return jsonb_build_object('error', '문의 유형을 골라 주세요.'); end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then return jsonb_build_object('error', '답변받을 이메일 주소를 확인해 주세요.'); end if;
  if char_length(nm) > 20 then return jsonb_build_object('error', '부르실 이름은 20자 이하로 적어 주세요.'); end if;
  if char_length(v_body) < 10 or char_length(v_body) > 1000 then return jsonb_build_object('error', '문의 내용은 10~1000자로 적어 주세요.'); end if;
  if v_body ~ '\d{6}\s?-\s?[1-4]\d{6}' or v_body ~ '\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}' then
    return jsonb_build_object('error', '주민등록번호나 카드번호는 적지 말아 주세요. 필요한 경우 운영진이 안전한 방법으로 따로 확인해요.');
  end if;
  if not coalesce(p_consent, false) then return jsonb_build_object('error', '문의 응대를 위한 개인정보 수집·이용에 동의해 주세요.'); end if;
  if exists (select 1 from public.inquiries i where i.email = v_email and i.body = v_body and i.created_at > now() - interval '10 minutes') then
    return jsonb_build_object('error', '같은 문의가 방금 접수됐어요. 잠시 후 접수 번호로 진행 상태를 확인해 주세요.');
  end if;
  if (select count(*) from public.inquiries i where i.email = v_email and i.created_at > now() - interval '1 hour') >= 5
     or (auth.uid() is null and (select count(*) from public.inquiries i where i.user_id is null and i.created_at > now() - interval '10 minutes') >= 60) then
    return jsonb_build_object('error', '짧은 시간에 문의가 많이 접수됐어요. 잠시 후 다시 남겨 주세요.');
  end if;
  -- 접수 번호: 날짜 + 임의 8자리(순번이면 이메일만 알아도 남의 문의를 찾아볼 수 있어서).
  new_id := 'Q-' || to_char(now() at time zone 'Asia/Seoul', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.inquiries (id, user_id, type, name, email, body, consent_at, policy_version)
  values (new_id, auth.uid(), p_type, nm, v_email, v_body, now(), 'V6-inquiry-01');
  return jsonb_build_object('id', new_id);
end $$;

create or replace function public.run_program_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e int; a int; o int;
begin
  delete from public.program_entries x using public.programs p where x.program_id = p.id and p.status = 'closed' and p.closed_at < now() - interval '30 days';
  get diagnostics e = row_count;
  delete from public.appointment_proposals x using public.programs p where x.program_id = p.id and p.status = 'closed'
     and coalesce(public.kst_at(p.meeting_on, '00:00'), p.closed_at) < now() - interval '90 days';
  get diagnostics a = row_count;
  -- 탈퇴한 회원 폴더의 파일, 등록되지 않은 채 이틀이 지난 파일(소개 사본에 쓰이는 것은 제외)을 정리 대기열에 넣는다.
  insert into public.storage_cleanup (bucket, path)
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'application-photos'
     and (not exists (select 1 from public.profiles pr where pr.id::text = split_part(o.name, '/', 1))
          or (o.created_at < now() - interval '2 days'
              and not exists (select 1 from public.application_photos ap where ap.path = o.name)
              and not exists (select 1 from public.introductions i where (i.snapshot_a -> 'photos') @> jsonb_build_array(jsonb_build_object('path', o.name)) or (i.snapshot_b -> 'photos') @> jsonb_build_array(jsonb_build_object('path', o.name)))))
  on conflict do nothing;
  get diagnostics o = row_count;
  insert into public.job_runs (job, finished_at, ok, detail) values ('program-retention', now(), true, jsonb_build_object('entries', e, 'proposals', a, 'orphanPhotos', o));
  return jsonb_build_object('entries', e, 'proposals', a, 'orphanPhotos', o);
end $$;

revoke all on function public.application_problem(uuid) from public, anon, authenticated;
