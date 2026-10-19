-- 신청서 고치기 · 휴대폰 번호(V6-edit-01)
--  - 제출한 뒤에도 신청서를 고칠 수 있다.
--    · 접수(submitted) 상태: 그대로 고친다(운영진 검토 전).
--    · 검토 중·승인·보류: 고치면 다시 확인 받는다(status → submitted, 프로필 버전 +1). 그동안 새 소개 준비에서 빠진다.
--    · 진행 중인 소개(예약·공개·서로 선택)가 있으면 그 소개가 끝난 뒤에 고친다.
--  - 휴대폰 번호(self.phone): 운영진만 본다. 상대에게는 두 분이 동의한 만나는 날에만 공개(교류 단계에서 연결).

create or replace function public.prepare_application_edit() returns text
language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '로그인한 회원만 고칠 수 있어요.'; end if;
  select status into st from public.applications where member_id = auth.uid() for update;
  if st is null then
    insert into public.applications (member_id) values (auth.uid());
    return 'draft';
  end if;
  if st in ('withdrawn', 'rejected') then raise exception '이 신청서는 고칠 수 없어요. 문의하기로 남겨 주세요.'; end if;
  if st in ('reviewing', 'approved', 'held') then
    if exists (select 1 from public.introductions where auth.uid() in (member_a, member_b) and status in ('reserved', 'published', 'mutual')) then
      raise exception '진행 중인 소개가 끝난 뒤에 고칠 수 있어요.';
    end if;
    update public.applications
       set status = 'submitted', profile_version = profile_version + 1, decided_at = null, decided_by = null, decision_note = null, updated_at = now()
     where member_id = auth.uid();
    perform public.write_audit('신청서 수정 · 다시 확인 요청', auth.uid()::text);
    return 'submitted';
  end if;
  return st;
end $$;

create or replace function public.save_application_draft(p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare clean jsonb; st text;
begin
  if jsonb_typeof(p_draft) <> 'object' then raise exception '신청서 형식을 확인해 주세요.'; end if;
  st := public.prepare_application_edit();
  -- 사진 파일 정보와 검토 상태는 서버 표가 기준이므로 본문에서 뺀다.
  clean := p_draft - 'photos' - 'review' - 'completedDemo';
  update public.applications set draft = clean, updated_at = now() where member_id = auth.uid();
  return jsonb_build_object('savedAt', now(), 'status', st);
end $$;

create or replace function public.register_photo(p_slot text, p_path text, p_mime text, p_bytes int, p_width int, p_height int, p_sha256 text, p_recent boolean, p_rights boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if split_part(p_path, '/', 1) <> auth.uid()::text then raise exception '본인 폴더의 사진만 등록할 수 있어요.'; end if;
  perform public.prepare_application_edit();
  if exists (select 1 from public.application_photos where member_id = auth.uid() and sha256 = p_sha256 and slot <> p_slot) then
    raise exception '다른 칸에 같은 사진이 있어요. 서로 다른 사진을 골라 주세요.';
  end if;
  delete from public.application_photos where member_id = auth.uid() and slot = p_slot;
  insert into public.application_photos (member_id, slot, path, mime, bytes, width, height, sha256, recent_confirmed, rights_confirmed)
  values (auth.uid(), p_slot, p_path, p_mime, p_bytes, p_width, p_height, p_sha256, p_recent, p_rights)
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.delete_photo(p_slot text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.prepare_application_edit();
  delete from public.application_photos where member_id = auth.uid() and slot = p_slot;
end $$;

create or replace function public.valid_phone(p_phone text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(regexp_replace(p_phone, '[\s-]', '', 'g') ~ '^01[016789]\d{7,8}$', false)
$$;

-- 제출: 처음 제출(draft·보완 요청)과, 고친 뒤 다시 확인 요청(submitted)을 모두 받는다.
create or replace function public.submit_application() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.applications; v jsonb; age int; missing text[];
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '로그인한 회원만 신청할 수 있어요.'; end if;
  select * into a from public.applications where member_id = auth.uid() for update;
  if a is null then raise exception '먼저 신청서를 저장해 주세요.'; end if;
  if a.status not in ('draft', 'needs_changes', 'submitted') then raise exception '지금은 제출할 수 없는 상태예요.'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.adult_confirmed_at is not null and p.terms_agreed_at is not null and p.privacy_agreed_at is not null) then
    raise exception '만 19세 확인과 약관·개인정보 동의가 필요해요. 문의하기로 알려 주세요.';
  end if;
  v := coalesce(a.draft -> 'values', '{}'::jsonb);
  age := public.age_from(v ->> 'self.birthDate');
  if age is null or age < 19 then raise exception '만 19세 이상만 신청할 수 있어요.'; end if;
  if not public.valid_phone(v ->> 'self.phone') then raise exception '휴대폰 번호를 확인해 주세요.'; end if;
  select array_agg(k) into missing from unnest(array['consent.collection','consent.matching','consent.provision','consent.review','self.statement','self.pledge']) k
    where coalesce((v ->> k)::boolean, false) is not true;
  if missing is not null then raise exception '필수 확인 항목이 남아 있어요.'; end if;
  select array_agg(k) into missing from unnest(array['self.name','self.gender','desired.gender','self.province','self.area','self.purpose','self.bio']) k
    where coalesce(v ->> k, '') = '';
  if missing is not null then raise exception '필수 항목이 남아 있어요.'; end if;
  if (select count(*) from public.application_photos where member_id = auth.uid() and slot in ('photo.face','photo.upper','photo.style') and review <> '재등록 요청') < 3 then
    raise exception '필수 사진 세 장이 필요해요.';
  end if;
  update public.profiles
     set notice_daily_waiting = coalesce(v ->> 'consent.noon' = 'true', false),
         marketing_opt_in = coalesce(v ->> 'consent.marketing' = 'true', false),
         updated_at = now()
   where id = auth.uid();
  update public.applications
     set status = 'submitted', submitted_at = coalesce(case when a.status = 'submitted' then a.submitted_at end, now()), updated_at = now(),
         profile_version = case when a.status = 'needs_changes' then a.profile_version + 1 else a.profile_version end
   where member_id = auth.uid();
  perform public.write_audit(case when a.status = 'submitted' then '신청서 수정 제출' else '신청서 제출' end, auth.uid()::text);
  return jsonb_build_object('status', 'submitted', 'submittedAt', now(), 'edited', a.status = 'submitted');
end $$;

revoke all on function public.prepare_application_edit(), public.valid_phone(text) from public, anon, authenticated;
revoke all on function public.save_application_draft(jsonb), public.submit_application(), public.register_photo(text, text, text, int, int, int, text, boolean, boolean), public.delete_photo(text) from public, anon;
grant execute on function public.save_application_draft(jsonb), public.submit_application(), public.register_photo(text, text, text, int, int, int, text, boolean, boolean), public.delete_photo(text) to authenticated;
