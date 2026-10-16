-- 비포어스 서버 2·3단계: 신청서 · 사진 · 운영진 검토
--  - 신청서 본문은 화면의 ApplicationDraft(values·sharing·preferences 등)를 그대로 jsonb로 저장한다.
--  - 생년월일 원값은 운영진에게도 보내지 않고, 만 나이만 계산해 보여 준다.
--  - 사진 파일은 비공개 저장소(application-photos)에 회원 폴더별로 저장한다. 위치정보는 화면에서 다시 그려 지운 뒤 올린다.

create table public.applications (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  draft jsonb not null default '{}'::jsonb check (octet_length(draft::text) <= 65536),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'reviewing', 'needs_changes', 'approved', 'held', 'withdrawn', 'rejected')),
  profile_version int not null default 1,
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text,          -- 회원에게 보이는 보완·보류 안내
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.applications enable row level security;

create table public.application_photos (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  slot text not null check (slot in ('photo.face', 'photo.upper', 'photo.style', 'photo.daily')),
  path text not null unique,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  bytes int not null check (bytes > 0 and bytes <= 10485760),
  width int not null check (width > 0),
  height int not null check (height > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  recent_confirmed boolean not null check (recent_confirmed),
  rights_confirmed boolean not null check (rights_confirmed),
  review text not null default '대기' check (review in ('대기', '기준 확인', '재등록 요청')),
  reason text,
  created_at timestamptz not null default now(),
  unique (member_id, slot),
  unique (member_id, sha256)
);
alter table public.application_photos enable row level security;

-- 지운 사진 파일은 저장소 정리 작업(storage-cleanup 함수)이 Storage API로 지운다.
create table public.storage_cleanup (
  bucket text not null,
  path text not null,
  queued_at timestamptz not null default now(),
  primary key (bucket, path)
);
alter table public.storage_cleanup enable row level security;
revoke all on public.storage_cleanup from anon, authenticated;

create or replace function public.queue_photo_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.storage_cleanup (bucket, path) values ('application-photos', old.path) on conflict do nothing;
  return old;
end $$;
create trigger application_photos_cleanup after delete on public.application_photos
  for each row execute function public.queue_photo_cleanup();

-- ─────────────────────────────────────────────────────────
-- 도우미
create or replace function public.kst_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Seoul')::date $$;

create or replace function public.age_from(p_birth text) returns int
language plpgsql stable set search_path = '' as $$
declare birth date;
begin
  if p_birth is null or p_birth !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  begin birth := p_birth::date; exception when others then return null; end;
  if birth > public.kst_today() then return null; end if;
  return extract(year from age(public.kst_today(), birth))::int;
end $$;

-- 상대에게 보여 줄 수 있는 항목(review-state.ts PUBLIC_FIELD_IDS와 같아야 한다)
create or replace function public.public_field_ids() returns text[]
language sql immutable set search_path = '' as $$
  select array['self.name','self.age','self.province','self.area','self.purpose','self.bio','self.introduction','self.mbti','self.traits','self.currentLikes','self.daysOff','self.relationshipValues','self.momentAnswer','self.height','self.smoking','self.drinking','self.schedule','self.available','self.interests','self.work','self.question','self.answer']
$$;

-- 운영진에게 보여 줄 신청서: 생년월일 원값을 빼고 만 나이를 더한다.
create or replace function public.application_for_operator(p_draft jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_set(
    p_draft #- '{values,self.birthDate}',
    '{values,self.age}',
    coalesce(to_jsonb(public.age_from(p_draft -> 'values' ->> 'self.birthDate')), 'null'::jsonb),
    true)
$$;

-- 상대에게 보일 공개 프로필(소개 예약 시점의 사본). 회원이 공개에 동의한 항목만 담는다.
create or replace function public.public_profile(p_member uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d jsonb; v jsonb; s jsonb; items jsonb := '[]'::jsonb; photo_list jsonb; field text; val jsonb; profile_ver int; member_age int;
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
    where p.member_id = p_member and (p.slot <> 'photo.daily' or coalesce((s ->> 'photo.daily')::boolean, false));
  return jsonb_build_object('version', profile_ver, 'items', items, 'photos', photo_list);
end $$;

-- ─────────────────────────────────────────────────────────
-- 회원 RPC
create or replace function public.save_application_draft(p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_status text; clean jsonb;
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '로그인한 회원만 저장할 수 있어요.'; end if;
  if jsonb_typeof(p_draft) <> 'object' then raise exception '신청서 형식을 확인해 주세요.'; end if;
  -- 사진 파일 정보와 검토 상태는 서버 표가 기준이므로 본문에서 뺀다.
  clean := p_draft - 'photos' - 'review' - 'completedDemo';
  select status into current_status from public.applications where member_id = auth.uid();
  if current_status is null then
    insert into public.applications (member_id, draft) values (auth.uid(), clean);
  elsif current_status in ('draft', 'needs_changes') then
    update public.applications set draft = clean, updated_at = now() where member_id = auth.uid();
  else
    raise exception '검토 중인 신청서는 고칠 수 없어요. 고칠 내용은 문의하기로 남겨 주세요.';
  end if;
  return jsonb_build_object('savedAt', now());
end $$;

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
  update public.applications
     set status = 'submitted', submitted_at = now(), updated_at = now(),
         profile_version = case when a.status = 'needs_changes' then a.profile_version + 1 else a.profile_version end
   where member_id = auth.uid();
  perform public.write_audit('신청서 제출', auth.uid()::text);
  return jsonb_build_object('status', 'submitted', 'submittedAt', now());
end $$;

create or replace function public.withdraw_application() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.applications set status = 'withdrawn', updated_at = now()
   where member_id = auth.uid() and status in ('draft', 'submitted', 'reviewing', 'needs_changes', 'held');
  if not found then raise exception '철회할 수 있는 신청서가 없어요.'; end if;
  perform public.write_audit('신청 철회', auth.uid()::text);
end $$;

-- 사진 등록: 같은 칸의 이전 사진은 지우고(파일은 정리 대기열로) 새 사진을 기록한다.
create or replace function public.register_photo(p_slot text, p_path text, p_mime text, p_bytes int, p_width int, p_height int, p_sha256 text, p_recent boolean, p_rights boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare st text; new_id uuid;
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '로그인한 회원만 사진을 올릴 수 있어요.'; end if;
  if split_part(p_path, '/', 1) <> auth.uid()::text then raise exception '본인 폴더의 사진만 등록할 수 있어요.'; end if;
  select status into st from public.applications where member_id = auth.uid();
  if st is null then
    insert into public.applications (member_id) values (auth.uid());
  elsif st not in ('draft', 'needs_changes') then
    raise exception '검토 중에는 사진을 바꿀 수 없어요.';
  end if;
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
  if (select status from public.applications where member_id = auth.uid()) not in ('draft', 'needs_changes') then
    raise exception '검토 중에는 사진을 지울 수 없어요.';
  end if;
  delete from public.application_photos where member_id = auth.uid() and slot = p_slot;
end $$;

-- ─────────────────────────────────────────────────────────
-- 운영진 RPC
create or replace function public.admin_list_applications(p_status text default null) returns table (
  member_id uuid, status text, submitted_at timestamptz, updated_at timestamptz, name text, gender text, desired text,
  province text, area text, age int, source text, photo_count int, photo_requests int
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return query
    select a.member_id, a.status, a.submitted_at, a.updated_at,
           a.draft -> 'values' ->> 'self.name', a.draft -> 'values' ->> 'self.gender', a.draft -> 'values' ->> 'desired.gender',
           a.draft -> 'values' ->> 'self.province', a.draft -> 'values' ->> 'self.area',
           public.age_from(a.draft -> 'values' ->> 'self.birthDate'), a.draft -> 'values' ->> 'self.source',
           (select count(*)::int from public.application_photos p where p.member_id = a.member_id),
           (select count(*)::int from public.application_photos p where p.member_id = a.member_id and p.review = '재등록 요청')
      from public.applications a
      join public.profiles pr on pr.id = a.member_id and pr.status = 'active'
     where (p_status is null and a.status <> 'draft') or a.status = p_status
     order by a.submitted_at nulls last;
end $$;

-- 신청서 한 건 열람. 열람할 때마다(회원별 하루 한 번) 감사 기록을 남긴다.
create or replace function public.admin_get_application(p_member uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.applications; photos jsonb;
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
  select coalesce(jsonb_agg(jsonb_build_object('slot', slot, 'path', path, 'review', review, 'reason', reason, 'width', width, 'height', height, 'createdAt', created_at) order by slot), '[]'::jsonb)
    into photos from public.application_photos where member_id = p_member;
  return jsonb_build_object(
    'memberId', a.member_id, 'status', a.status, 'profileVersion', a.profile_version,
    'submittedAt', a.submitted_at, 'decidedAt', a.decided_at, 'decisionNote', a.decision_note,
    'draft', public.application_for_operator(a.draft), 'photos', photos);
end $$;

-- 사진 한 장 검토(기준 확인 / 재등록 요청 + 사유)
create or replace function public.admin_review_photo(p_member uuid, p_slot text, p_review text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_review not in ('대기', '기준 확인', '재등록 요청') then raise exception '검토 값을 확인해 주세요.'; end if;
  if p_review = '재등록 요청' and coalesce(p_reason, '') = '' then raise exception '재등록 사유를 골라 주세요.'; end if;
  update public.application_photos set review = p_review, reason = case when p_review = '재등록 요청' then p_reason end
   where member_id = p_member and slot = p_slot;
  if not found then raise exception '사진을 찾을 수 없어요.'; end if;
  perform public.write_audit('사진 검토 · ' || p_review, p_member::text, p_slot);
end $$;

-- 신청서 결정: reviewing(검토 시작) / approved / needs_changes / held / rejected
create or replace function public.admin_decide_application(p_member uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare current_status text;
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
  update public.applications
     set status = p_status, decided_at = now(), decided_by = auth.uid(),
         decision_note = case when p_status = 'reviewing' then decision_note else nullif(trim(p_note), '') end,
         updated_at = now()
   where member_id = p_member;
  perform public.write_audit('신청서 결정 · ' || p_status, p_member::text);
end $$;

-- ─────────────────────────────────────────────────────────
-- RLS: 회원은 자기 신청서·사진만 읽는다. 쓰기는 위 RPC로만.
create policy "applications: 본인 조회" on public.applications for select to authenticated using (member_id = auth.uid());
create policy "application_photos: 본인 조회" on public.application_photos for select to authenticated using (member_id = auth.uid());
revoke insert, update, delete on public.applications, public.application_photos from anon, authenticated;
revoke all on public.applications, public.application_photos from anon;

revoke all on function public.queue_photo_cleanup(), public.public_profile(uuid) from public, anon, authenticated;
revoke all on function public.save_application_draft(jsonb), public.submit_application(), public.withdraw_application(),
  public.register_photo(text, text, text, int, int, int, text, boolean, boolean), public.delete_photo(text),
  public.admin_list_applications(text), public.admin_get_application(uuid), public.admin_review_photo(uuid, text, text, text),
  public.admin_decide_application(uuid, text, text) from public, anon;
grant execute on function public.save_application_draft(jsonb), public.submit_application(), public.withdraw_application(),
  public.register_photo(text, text, text, int, int, int, text, boolean, boolean), public.delete_photo(text),
  public.admin_list_applications(text), public.admin_get_application(uuid), public.admin_review_photo(uuid, text, text, text),
  public.admin_decide_application(uuid, text, text) to authenticated;
