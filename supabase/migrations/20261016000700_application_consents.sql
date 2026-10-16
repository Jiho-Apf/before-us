-- 신청서의 선택 동의(정오 알림·마케팅)를 회원 설정에 반영한다.
create or replace function public.submit_application() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.applications; v jsonb; age int; missing text[];
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '로그인한 회원만 신청할 수 있어요.'; end if;
  select * into a from public.applications where member_id = auth.uid() for update;
  if a is null then raise exception '먼저 신청서를 저장해 주세요.'; end if;
  if a.status not in ('draft', 'needs_changes') then raise exception '이미 접수된 신청서예요.'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.adult_confirmed_at is not null and p.terms_agreed_at is not null and p.privacy_agreed_at is not null) then
    raise exception '만 19세 확인과 약관·개인정보 동의가 필요해요. 문의하기로 알려 주세요.';
  end if;
  v := coalesce(a.draft -> 'values', '{}'::jsonb);
  age := public.age_from(v ->> 'self.birthDate');
  if age is null or age < 19 then raise exception '만 19세 이상만 신청할 수 있어요.'; end if;
  select array_agg(k) into missing from unnest(array['consent.collection','consent.matching','consent.provision','consent.review','self.statement','self.pledge']) k
    where coalesce((v ->> k)::boolean, false) is not true;
  if missing is not null then raise exception '필수 확인 항목이 남아 있어요.'; end if;
  select array_agg(k) into missing from unnest(array['self.name','self.gender','desired.gender','self.province','self.area','self.purpose','self.bio']) k
    where coalesce(v ->> k, '') = '';
  if missing is not null then raise exception '필수 항목이 남아 있어요.'; end if;
  if (select count(*) from public.application_photos where member_id = auth.uid() and slot in ('photo.face','photo.upper','photo.style') and review <> '재등록 요청') < 3 then
    raise exception '필수 사진 세 장이 필요해요.';
  end if;
  -- 신청서 마지막 단계에서 고른 선택 동의(정오 알림·마케팅 안내)를 내 정보 설정에 맞춘다.
  update public.profiles
     set notice_daily_waiting = coalesce(v ->> 'consent.noon' = 'true', false),
         marketing_opt_in = coalesce(v ->> 'consent.marketing' = 'true', false),
         updated_at = now()
   where id = auth.uid();
  update public.applications
     set status = 'submitted', submitted_at = now(), updated_at = now(),
         profile_version = case when a.status = 'needs_changes' then a.profile_version + 1 else a.profile_version end
   where member_id = auth.uid();
  perform public.write_audit('신청서 제출', auth.uid()::text);
  return jsonb_build_object('status', 'submitted', 'submittedAt', now());
end $$;
