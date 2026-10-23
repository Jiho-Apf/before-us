-- 베타 나이 범위(1992~2007년생, 한국 나이 20~35세) · 신청서 이어 쓰기 알림 · 메일 확인 안 한 계정 정리
-- 나이 범위는 이 함수 하나만 바꾸면 신청·승인 확인에 모두 적용된다(화면은 config.ts 의 ageBand).
create or replace function public.birth_year_range() returns int[]
language sql immutable set search_path = '' as $$ select array[1992, 2007] $$;

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
  if extract(year from (v ->> 'self.birthDate')::date)::int not between (public.birth_year_range())[1] and (public.birth_year_range())[2] then
    return (public.birth_year_range())[1] || '~' || (public.birth_year_range())[2] || '년생(한국 나이 20~35세)만 신청할 수 있어요.';
  end if;
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

create or replace function public.run_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; t timestamptz := public.app_now(); today date := public.kst_date(public.app_now()); key text;
begin
  -- 소개 응답: 마감(다음 날 11:00) 2시간 전까지 답하지 않은 회원
  for r in select i.id, m.member from public.introductions i
             cross join lateral (values (i.member_a, i.response_a), (i.member_b, i.response_b)) as m(member, response)
            where i.status = 'published' and m.response is null and t >= i.respond_by - interval '2 hours' and t < i.respond_by loop
    key := 'remind-intro:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-response', '답 마감까지 2시간 남았어요', '오늘 오전 11시까지 답하지 않으면 이번 소개는 마무리돼요.', '/us', key);
      n := n + 1;
    end if;
  end loop;
  -- 그날 글: 18:00까지 보내지 않은 회원
  for r in select p.id, p.plan_a, m.member, today - p.start_on + 1 as day from public.programs p
             cross join lateral (values (p.member_a), (p.member_b)) as m(member)
            where p.status = 'started' and today between p.start_on and p.start_on + 2 and t >= public.kst_at(today, '18:00')
              and not exists (select 1 from public.program_entries e where e.program_id = p.id and e.day = today - p.start_on + 1 and e.kind in ('letter', 'scene') and e.author = m.member) loop
    key := 'remind-letter:' || r.id || ':' || r.day || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-letter', case when r.plan_a = 'A' then '오늘의 편지를 아직 보내지 않았어요' else '오늘의 첫 장면 답을 아직 보내지 않았어요' end,
        '23:59까지 보내야 상대의 글과 함께 열려요.', '/exchange', key);
      n := n + 1;
    end if;
  end loop;
  -- 교류 합의: 마감 12시간 전까지 확인하지 않은 회원
  for r in select p.id, m.member from public.programs p
             cross join lateral (values (p.member_a, p.confirm_a), (p.member_b, p.confirm_b)) as m(member, confirmed)
            where p.status = 'choosing' and m.confirmed is null and t >= p.agree_by - interval '12 hours' and t < p.agree_by loop
    key := 'remind-agree:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-agreement', '교류 방식·시작일 마감이 12시간 남았어요', '두 분이 같은 방식과 시작일을 확인해야 교류가 시작돼요. 마감이 지나면 이번 소개는 마무리돼요.', '/exchange', key);
      n := n + 1;
    end if;
  end loop;
  -- 만남 선택: 마감(DAY05 09:00) 14시간 전까지 고르지 않은 회원
  for r in select p.id, m.member from public.programs p
             cross join lateral (values (p.member_a, p.meeting_a), (p.member_b, p.meeting_b)) as m(member, choice)
            where p.status = 'deciding' and m.choice is null and t >= p.meeting_by - interval '14 hours' and t < p.meeting_by loop
    key := 'remind-meet:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-meeting', '만남 선택 마감이 다가와요', '내일 오전 9시까지 골라 주세요. 답이 없으면 이번 교류는 마무리돼요.', '/exchange', key);
      n := n + 1;
    end if;
  end loop;
  -- 약속 정하기: 마감 이틀 전까지 약속이 없으면 두 분 모두
  for r in select p.id, m.member from public.programs p cross join lateral (values (p.member_a), (p.member_b)) as m(member)
            where p.status = 'arranging' and p.meeting_on is null and t >= p.arrange_by - interval '48 hours' and t < p.arrange_by loop
    key := 'remind-arrange:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-arrange', '약속 정하기 마감이 이틀 남았어요', '마감까지 약속이 정해지지 않으면 이번 교류는 마무리돼요.', '/meeting', key);
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
  return n;
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
  -- 7일이 지나도 메일 확인을 하지 않은 계정은 지운다(주소 오타 등으로 남은 계정).
  delete from auth.users u where u.email_confirmed_at is null and u.created_at < now() - interval '7 days'
     and not exists (select 1 from public.admin_roles ar where ar.user_id = u.id);
  insert into public.job_runs (job, finished_at, ok, detail) values ('program-retention', now(), true, jsonb_build_object('entries', e, 'proposals', a, 'orphanPhotos', o));
  return jsonb_build_object('entries', e, 'proposals', a, 'orphanPhotos', o);
end $$;

revoke all on function public.birth_year_range() from public, anon, authenticated;
