-- 운영 편의와 알림 방법(V6-ops-02)
--  - 회원 일시정지(본인) · 이용 정지(운영진) · 운영진 ‘회원’ 목록
--  - 사진 올리기 하루 횟수 제한(30장)
--  - 화면 오류 모으기(client_errors)
--  - 알림 받을 방법: 카카오톡·문자 중 1개 이상(필수), 메일(선택). 메일 알림은 send-notifications 함수가 보낸다.

alter table public.profiles add column paused_at timestamptz;
alter table public.profiles add column suspended_reason text;
alter table public.profiles add column notify_kakao boolean not null default false;
alter table public.profiles add column notify_sms boolean not null default false;
alter table public.profiles add column notify_email boolean not null default false;
alter table public.notifications add column emailed_at timestamptz;

-- 본인 일시정지·다시 받기: 새 소개 준비에서만 빠진다(진행 중인 소개·교류는 그대로).
create or replace function public.set_paused(p_paused boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '로그인한 회원만 바꿀 수 있어요.'; end if;
  update public.profiles set paused_at = case when p_paused then coalesce(paused_at, now()) end, updated_at = now() where id = auth.uid();
  perform public.write_audit(case when p_paused then '회원 일시정지' else '회원 다시 받기' end, auth.uid()::text);
  return jsonb_build_object('paused', p_paused);
end $$;

-- 운영진: 회원 목록(검색) — 연락처는 운영진만 본다
create or replace function public.admin_list_members(p_query text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(lower(trim(coalesce(p_query, ''))), '');
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(row order by (row ->> 'createdAt') desc) from (
    select jsonb_build_object(
      'id', p.id, 'email', p.email, 'status', p.status, 'pausedAt', p.paused_at, 'suspendedReason', p.suspended_reason, 'createdAt', p.created_at,
      'name', a.draft -> 'values' ->> 'self.name', 'phone', a.draft -> 'values' ->> 'self.phone', 'gender', a.draft -> 'values' ->> 'self.gender',
      'age', public.age_from(a.draft -> 'values' ->> 'self.birthDate'), 'area', concat_ws(' ', a.draft -> 'values' ->> 'self.province', a.draft -> 'values' ->> 'self.area'),
      'application', a.status, 'cohort', a.cohort_number,
      'channels', jsonb_build_object('kakao', p.notify_kakao, 'sms', p.notify_sms, 'email', p.notify_email),
      'introductions', (select count(*) from public.introductions i where p.id in (i.member_a, i.member_b) and i.status <> 'cancelled'),
      'reports', (select count(*) from public.reports r where r.target_id = p.id)
    ) as row
    from public.profiles p left join public.applications a on a.member_id = p.id
    where not exists (select 1 from public.admin_roles ar where ar.user_id = p.id)
      and (q is null or lower(p.email) like '%' || q || '%' or lower(coalesce(a.draft -> 'values' ->> 'self.name', '')) like '%' || q || '%'
           or regexp_replace(coalesce(a.draft -> 'values' ->> 'self.phone', ''), '\D', '', 'g') like '%' || regexp_replace(q, '\D', '', 'g') || '%' and regexp_replace(q, '\D', '', 'g') <> '')
    limit 300) x), '[]'::jsonb);
end $$;

-- 운영진: 일시정지·이용 정지·해제
create or replace function public.admin_set_member_state(p_member uuid, p_state text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; changed int;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_state not in ('pause', 'resume', 'suspend', 'unsuspend') then raise exception '바꿀 상태를 골라 주세요.'; end if;
  if p_state = 'suspend' and coalesce(trim(p_reason), '') = '' then raise exception '이용 정지 사유를 적어 주세요(회원에게 보여요).'; end if;
  if p_state = 'pause' then update public.profiles set paused_at = now(), updated_at = now() where id = p_member and paused_at is null;
  elsif p_state = 'resume' then update public.profiles set paused_at = null, updated_at = now() where id = p_member and paused_at is not null;
  elsif p_state = 'suspend' then update public.profiles set status = 'suspended', suspended_reason = trim(p_reason), updated_at = now() where id = p_member and status = 'active';
  else update public.profiles set status = 'active', suspended_reason = null, updated_at = now() where id = p_member and status = 'suspended';
  end if;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception '회원을 찾을 수 없거나 이미 그 상태예요.'; end if;
  if p_state = 'suspend' then
    -- 진행 중인 소개는 닫고, 상대에게는 사유 없이 마무리 안내만 보낸다.
    for r in select id, case when member_a = p_member then member_b else member_a end as partner, status from public.introductions
              where p_member in (member_a, member_b) and status in ('reserved', 'published', 'mutual') loop
      perform public.close_introduction(r.id, 'admin-cancel');
      if r.status <> 'reserved' then
        perform public.notify(r.partner, 'introduction-closed', '진행 중이던 소개가 마무리됐어요', '운영 사정으로 이번 소개는 여기서 끝나요. 다음 소개를 준비할게요.', '/today', 'closed:' || r.id || ':' || r.partner);
      end if;
    end loop;
  end if;
  perform public.write_audit('회원 상태 변경 · ' || p_state, p_member::text, nullif(trim(coalesce(p_reason, '')), ''));
end $$;

-- 일시정지 회원은 소개 가능 목록·정오 대기 알림에서 뺀다
create or replace function public.admin_ready_members() returns table (
  member_id uuid, name text, gender text, desired text, age int, province text, area text, purpose text,
  last_published_at timestamptz, introductions int, blocked uuid[], previous uuid[]
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  return query
    select a.member_id, a.draft -> 'values' ->> 'self.name', a.draft -> 'values' ->> 'self.gender', a.draft -> 'values' ->> 'desired.gender',
           public.age_from(a.draft -> 'values' ->> 'self.birthDate'), a.draft -> 'values' ->> 'self.province', a.draft -> 'values' ->> 'self.area',
           a.draft -> 'values' ->> 'self.purpose',
           (select max(i.published_at) from public.introductions i where a.member_id in (i.member_a, i.member_b)),
           (select count(*)::int from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status <> 'cancelled'),
           coalesce((select array_agg(case when b.member_id = a.member_id then b.blocked_id else b.member_id end) from public.blocks b where a.member_id in (b.member_id, b.blocked_id)), '{}'),
           coalesce((select array_agg(case when i.member_a = a.member_id then i.member_b else i.member_a end) from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status <> 'cancelled'), '{}')
      from public.applications a
      join public.profiles p on p.id = a.member_id and p.status = 'active' and p.paused_at is null
     where a.status = 'approved'
       and not exists (select 1 from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status in ('reserved', 'published', 'mutual'))
     order by 9 nulls first;
end $$;

-- 정오 작업: 일시정지 회원은 ‘오늘은 소개가 없어요’ 알림에서 뺀다
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

-- 사진 올리기 하루 30장까지(저장소 올리기 정책에서 확인)
create or replace function public.photo_upload_quota_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from storage.objects o where o.bucket_id = 'application-photos' and o.owner = auth.uid() and o.created_at > now() - interval '1 day') < 30
$$;
drop policy "사진: 본인 폴더에 올리기" on storage.objects;
create policy "사진: 본인 폴더에 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'application-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.photo_upload_quota_ok());

-- 화면 오류 모으기: 누구나 보낼 수 있지만 10분에 200건까지, 개인정보는 화면에서 지워서 보낸다.
create table public.client_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  context text, message text, stack text, path text, release text, user_agent text
);
alter table public.client_errors enable row level security;
create policy "client_errors: 운영진 조회" on public.client_errors for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.client_errors from anon, authenticated;
revoke all on public.client_errors from anon;
create or replace function public.report_client_error(p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.client_errors where at > now() - interval '10 minutes') >= 200 then return; end if;
  insert into public.client_errors (context, message, stack, path, release, user_agent)
  values (left(p_payload ->> 'context', 120), left(p_payload ->> 'message', 1000), left(p_payload ->> 'stack', 4000), left(p_payload ->> 'path', 200), left(p_payload ->> 'release', 60), left(p_payload ->> 'userAgent', 300));
end $$;

-- 제출할 때 알림 받을 방법을 확인하고 내 정보에 맞춘다(카톡·문자 중 1개 이상 필수, 메일은 선택)
create or replace function public.submit_application() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.applications; v jsonb; age int; missing text[]; ch jsonb;
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
  ch := case when jsonb_typeof(v -> 'self.notifyChannels') = 'array' then v -> 'self.notifyChannels' else '[]'::jsonb end;
  if not ch ?| array['카카오톡', '문자'] then raise exception '알림 받을 방법으로 카카오톡이나 문자 중 하나는 골라 주세요.'; end if;
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

create or replace function public.set_notify_channels(p_kakao boolean, p_sms boolean, p_email boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '로그인한 회원만 바꿀 수 있어요.'; end if;
  if not coalesce(p_kakao, false) and not coalesce(p_sms, false) then raise exception '카카오톡이나 문자 중 하나는 골라 주세요.'; end if;
  update public.profiles set notify_kakao = p_kakao, notify_sms = p_sms, notify_email = coalesce(p_email, false), updated_at = now() where id = auth.uid();
end $$;

-- 메일 보낼 알림(send-notifications 함수가 가져간다)
create or replace function public.pending_email_notifications(p_limit int default 50) returns table (id uuid, email text, title text, body text, link text)
language sql stable security definer set search_path = '' as $$
  select n.id, p.email, n.title, n.body, n.link from public.notifications n join public.profiles p on p.id = n.member_id and p.status = 'active'
   where n.emailed_at is null and p.notify_email and n.created_at > now() - interval '1 day'
   order by n.created_at limit p_limit
$$;

revoke all on function public.photo_upload_quota_ok(), public.pending_email_notifications(int) from public, anon, authenticated;
grant execute on function public.pending_email_notifications(int) to service_role;
grant execute on function public.photo_upload_quota_ok() to authenticated;
revoke all on function public.report_client_error(jsonb) from public;
grant execute on function public.report_client_error(jsonb) to anon, authenticated;
revoke all on function public.set_paused(boolean), public.admin_list_members(text), public.admin_set_member_state(uuid, text, text), public.admin_ready_members(), public.set_notify_channels(boolean, boolean, boolean) from public, anon;
grant execute on function public.set_paused(boolean), public.admin_list_members(text), public.admin_set_member_state(uuid, text, text), public.admin_ready_members(), public.set_notify_channels(boolean, boolean, boolean) to authenticated;
