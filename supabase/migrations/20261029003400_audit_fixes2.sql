-- 점검 고치기 2(2026-10-29)
--  1. 철회한 신청서 다시 열기: 운영진(대표·운영)이 철회(withdrawn)를 작성 중(draft)으로 되돌리고 회원에게 알린다(admin_reopen_application).
--  2. 탈퇴 요청 취소: 삭제 예정 시각 전이면 운영진이 회원 상태를 되돌리고 삭제 예약을 지운 뒤 알린다(admin_cancel_withdrawal).
--     회원 목록에 탈퇴 요청 시각과 삭제 예정 시각을 더한다(admin_list_members).
--  3. 신청서 제출이 내 정보의 알림·광고 수신 설정을 덮어쓰지 않게: 처음 제출할 때(submitted_at 없음)만 신청서 값을 옮긴다(submit_application).
--  4. 메일 발송: 실패한 메일은 3번까지만 다시 보내고(email_attempts), 새 알림이 밀리지 않게 처음 보내는 것부터 보낸다.
--     가입 확인 메일을 확인하지 않은 계정에는 보내지 않는다(pending_email_notifications · admin_broadcast).
--  5. 신청서 고치기: 회원이 볼 수 있는 진행 중 소개·교류가 있을 때만 막고, 회원이 모르는 정오 예약은 알리지 않고 취소한다(prepare_application_edit).
--  6. 운영진이 쉬기를 풀 때 알림 문구: 쉬기는 내 정보에서 한다(admin_set_member_state, 3100 정의에서 문구만 바꿈).
--  7. 오늘 화면에 보여 준 알림만 읽음으로(mark_shown_notifications_read).

-- ─────────────────────────────────────────────────────────
-- 1. 철회한 신청서 다시 열기
create or replace function public.admin_reopen_application(p_member uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare st text; member_status text;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '다시 여는 이유를 적어 주세요(감사 기록에 남아요).'; end if;
  select a.status, p.status into st, member_status
    from public.applications a join public.profiles p on p.id = a.member_id
   where a.member_id = p_member for update of a;
  if st is null then raise exception '신청서를 찾을 수 없어요.'; end if;
  if st <> 'withdrawn' then raise exception '철회한 신청서만 다시 열 수 있어요.'; end if;
  if member_status <> 'active' then raise exception '이용 중인 회원의 신청서만 다시 열 수 있어요(탈퇴 요청·이용 정지 상태 확인).'; end if;
  -- 처음 제출한 때(submitted_at)는 남겨 둔다: 다시 제출해도 내 정보의 알림 설정을 덮어쓰지 않기 위해서다.
  update public.applications
     set status = 'draft', decided_at = null, decided_by = null, decision_note = null, updated_at = now()
   where member_id = p_member;
  perform public.write_audit('신청서 다시 열기', p_member::text, trim(p_reason));
  perform public.notify(p_member, 'application-reopened', '신청서를 다시 열었어요',
    '이어서 고친 뒤 다시 제출해 주세요. 제출하면 운영진이 다시 확인해요.', '/apply',
    'reopen:' || p_member || ':' || extract(epoch from now())::bigint);
end $$;

-- ─────────────────────────────────────────────────────────
-- 2. 탈퇴 요청 취소(삭제 예정 시각 전에만). 탈퇴 요청 때 끝난 소개·교류는 다시 열지 않는다.
create or replace function public.admin_cancel_withdrawal(p_member uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare st text; due timestamptz;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '취소하는 이유를 적어 주세요(감사 기록에 남아요).'; end if;
  select status, deletion_due_at into st, due from public.profiles where id = p_member for update;
  if st is null then raise exception '회원을 찾을 수 없어요. 이미 지워졌을 수 있어요.'; end if;
  if st <> 'withdrawal_requested' then raise exception '탈퇴를 요청한 회원이 아니에요.'; end if;
  if due is not null and due <= now() then raise exception '삭제 예정 시각이 지나 취소할 수 없어요.'; end if;
  update public.profiles
     set status = 'active', withdrawal_requested_at = null, deletion_due_at = null, updated_at = now()
   where id = p_member;
  -- 탈퇴 요청 기록은 처리 완료로(탈퇴 요청은 결과 알림 트리거에서 빠지므로 알림이 두 번 가지 않는다).
  update public.member_requests
     set status = 'decided', decision = '운영진이 탈퇴 요청을 취소했어요.', decided_by = auth.uid(), decided_at = now()
   where member_id = p_member and kind = 'withdrawal' and status <> 'decided';
  perform public.write_audit('탈퇴 요청 취소', p_member::text, trim(p_reason));
  perform public.notify(p_member, 'withdrawal-cancelled', '탈퇴 요청을 취소했어요',
    '다시 로그인해 이어서 이용할 수 있어요. 탈퇴 요청 때 끝난 소개와 교류는 다시 열리지 않아요.', '/today',
    'unwithdraw:' || p_member || ':' || extract(epoch from now())::bigint);
end $$;

-- 회원 목록(3100 정의 그대로) + 탈퇴 요청 시각·삭제 예정 시각
create or replace function public.admin_list_members(p_query text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(lower(trim(coalesce(p_query, ''))), '');
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(row order by (row ->> 'createdAt') desc) from (
    select jsonb_build_object(
      'id', p.id, 'email', p.email, 'status', p.status, 'pausedAt', p.paused_at, 'pausedBy', case when p.paused_at is not null then coalesce(p.paused_by, 'member') end,
      'resumedAt', p.resumed_at, 'suspendedReason', p.suspended_reason, 'createdAt', p.created_at,
      'withdrawalRequestedAt', p.withdrawal_requested_at, 'deletionDueAt', p.deletion_due_at,
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

-- ─────────────────────────────────────────────────────────
-- 3. 제출(1800 정의) — 알림·광고 수신 설정은 처음 제출할 때만 신청서 값으로 정한다.
--    그 뒤(보완 뒤 다시 제출·고친 뒤 다시 확인·다시 연 신청서)에는 내 정보의 설정이 기준이라 건드리지 않는다.
--    (회원이 내 정보에서 끈 광고 수신이 제출만으로 다시 켜지지 않게. 신청서 화면은 고칠 때 내 정보 값을 보여 주고, 바꾼 것만 따로 저장한다.)
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
  return jsonb_build_object('status', 'submitted', 'submittedAt', now(), 'edited', a.status = 'submitted');
end $$;

-- ─────────────────────────────────────────────────────────
-- 4. 메일 발송 실패 횟수: 3번 실패하면 더 보내지 않는다(사이트 알림은 그대로 보인다).
alter table public.notifications add column if not exists email_attempts int not null default 0;
alter table public.notifications add column if not exists email_error text;
alter table public.email_queue add column if not exists email_attempts int not null default 0;
alter table public.email_queue add column if not exists email_error text;

-- 보내지 못한 메일 한 통을 기록하고, 지금까지 실패한 횟수를 돌려준다(발송 함수만 부른다).
create or replace function public.record_email_failure(p_source text, p_id uuid, p_error text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_source = 'queue' then
    update public.email_queue set email_attempts = email_attempts + 1, email_error = left(coalesce(p_error, ''), 300)
     where id = p_id and emailed_at is null returning email_attempts into n;
  else
    update public.notifications set email_attempts = email_attempts + 1, email_error = left(coalesce(p_error, ''), 300)
     where id = p_id and emailed_at is null returning email_attempts into n;
  end if;
  return coalesce(n, 0);
end $$;

-- 보낼 메일(2600 정의) + 가입 확인을 마친 계정만 · 3번 실패한 것은 빼기 · 처음 보내는 것부터, 중요한 안내 → 공지 → 그 밖의 순서.
-- 돌려주는 모양과 권한은 그대로다.
create or replace function public.pending_email_notifications(p_limit int default 50) returns table (id uuid, email text, title text, body text, link text, source text)
language sql stable security definer set search_path = '' as $$
  select x.id, x.email, x.title, x.body, x.link, x.source from (
    select n.id, p.email, n.title, n.body, n.link, 'notification'::text as source, n.created_at, n.email_attempts as attempts,
           public.email_class(n.kind) = 'always' as urgent,
           case public.email_class(n.kind) when 'important' then 0 when 'always' then 1 else 2 end as rank
      from public.notifications n
      join public.profiles p on p.id = n.member_id and (p.status = 'active' or (p.status = 'suspended' and n.kind = 'account-suspended'))
      join auth.users u on u.id = p.id and u.email_confirmed_at is not null
     where n.emailed_at is null and n.email_attempts < 3 and n.created_at > now() - interval '2 days'
       and case public.email_class(n.kind)
             when 'always' then true
             when 'important' then public.email_beta_mode() or p.notify_email
             else p.email_all and (public.email_beta_mode() or p.notify_email) end
    union all
    select q.id, q.email, q.title, q.body, q.link, 'queue'::text, q.created_at, q.email_attempts, false, 0
      from public.email_queue q where q.emailed_at is null and q.email_attempts < 3 and q.created_at > now() - interval '3 days'
  ) x
  where x.urgent or extract(hour from (public.app_now() at time zone 'Asia/Seoul')) between 8 and 21
  order by x.attempts, x.rank, x.created_at
  limit p_limit
$$;

-- 전체 공지(2000 정의) + 가입 확인을 마친 회원에게만(확인하지 않은 계정은 로그인도 메일도 받을 수 없다).
create or replace function public.admin_broadcast(p_title text, p_body text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; batch text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_admin(array['owner']) then raise exception '전체 공지는 대표만 보낼 수 있어요.'; end if;
  if char_length(coalesce(trim(p_title), '')) not between 5 and 60 then raise exception '공지 제목은 5~60자로 적어 주세요.'; end if;
  if char_length(coalesce(trim(p_body), '')) not between 10 and 1000 then raise exception '공지 내용은 10~1000자로 적어 주세요.'; end if;
  insert into public.notifications (member_id, kind, title, body, link, dedupe_key)
  select p.id, 'announcement', trim(p_title), trim(p_body), '/today', 'announce:' || batch || ':' || p.id
    from public.profiles p join auth.users u on u.id = p.id and u.email_confirmed_at is not null
   where p.status = 'active' and not exists (select 1 from public.admin_roles r where r.user_id = p.id);
  get diagnostics n = row_count;
  perform public.write_audit('전체 공지 · ' || n || '명', batch, trim(p_title));
  return n;
end $$;

-- ─────────────────────────────────────────────────────────
-- 5. 신청서 고치기(2600 정의): 회원이 볼 수 있는 진행 중 소개(공개·서로 선택)나 교류가 있을 때만 막는다.
--    회원이 아직 모르는 정오 예약은 드러내지 않고 취소한다(공개 직전 확인과 같은 까닭 · 상대에게 알리지 않고 횟수에 넣지 않는다).
create or replace function public.prepare_application_edit() returns text
language plpgsql security definer set search_path = '' as $$
declare st text; r record;
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '로그인한 회원만 고칠 수 있어요.'; end if;
  select status into st from public.applications where member_id = auth.uid() for update;
  if st is null then
    insert into public.applications (member_id) values (auth.uid());
    return 'draft';
  end if;
  if st in ('withdrawn', 'rejected') then raise exception '이 신청서는 고칠 수 없어요. 문의하기로 남겨 주세요.'; end if;
  if st in ('reviewing', 'approved', 'held') then
    if exists (select 1 from public.introductions where auth.uid() in (member_a, member_b) and status in ('published', 'mutual'))
       or exists (select 1 from public.programs where auth.uid() in (member_a, member_b) and status <> 'closed') then
      raise exception '지금 진행 중인 소개나 교류가 있어요. 이번 소개·교류가 끝난 뒤에 고친 내용을 보낼 수 있어요.';
    end if;
    for r in select id from public.introductions where auth.uid() in (member_a, member_b) and status = 'reserved' loop
      perform public.close_introduction(r.id, 'precheck');
    end loop;
    update public.applications
       set status = 'submitted', profile_version = profile_version + 1, decided_at = null, decided_by = null, decision_note = null, updated_at = now()
     where member_id = auth.uid();
    perform public.write_audit('신청서 수정 · 다시 확인 요청', auth.uid()::text);
    return 'submitted';
  end if;
  return st;
end $$;

-- ─────────────────────────────────────────────────────────
-- 6. 회원 상태(3100 정의 그대로) — 다시 받기 알림 문구만: 쉬기는 내 정보에서 한다.
create or replace function public.admin_set_member_state(p_member uuid, p_state text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; changed int; by_whom text;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_state not in ('pause', 'resume', 'resume_override', 'suspend', 'unsuspend') then raise exception '바꿀 상태를 골라 주세요.'; end if;
  if p_state = 'suspend' and coalesce(trim(p_reason), '') = '' then raise exception '이용 정지 사유를 적어 주세요(회원에게 보여요).'; end if;
  if p_state = 'resume_override' and coalesce(trim(p_reason), '') = '' then raise exception '회원이 직접 건 쉬기를 푸는 이유를 적어 주세요(감사 기록에 남아요).'; end if;
  if p_state = 'resume' then
    select case when paused_at is not null then coalesce(paused_by, 'member') end into by_whom from public.profiles where id = p_member;
    if by_whom = 'member' then raise exception '회원이 직접 쉬기로 한 상태예요. 꼭 풀어야 한다면 ‘회원 쉬기 풀기’로 사유를 적어 주세요.'; end if;
  end if;
  if p_state = 'pause' then update public.profiles set paused_at = coalesce(paused_at, now()), paused_by = 'operator', updated_at = now() where id = p_member and paused_by is distinct from 'operator';
  elsif p_state in ('resume', 'resume_override') then update public.profiles set paused_at = null, paused_by = null, updated_at = now() where id = p_member and paused_at is not null;
  elsif p_state = 'suspend' then update public.profiles set status = 'suspended', suspended_reason = trim(p_reason), updated_at = now() where id = p_member and status = 'active';
  else update public.profiles set status = 'active', suspended_reason = null, updated_at = now() where id = p_member and status = 'suspended';
  end if;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception '회원을 찾을 수 없거나 이미 그 상태예요.'; end if;
  if p_state = 'suspend' then
    for r in select id from public.introductions where p_member in (member_a, member_b) and status in ('reserved', 'published', 'mutual') loop
      perform public.close_introduction(r.id, 'suspended', p_member);
      perform public.notify_intro_ended(r.id);
    end loop;
    perform public.notify(p_member, 'account-suspended', '이용이 잠시 멈췄어요', '운영진 안내를 오늘 화면에서 확인해 주세요. 다르게 생각되면 문의·요청에서 재검토를 요청할 수 있어요.', '/today', 'suspend:' || p_member || ':' || extract(epoch from now())::bigint);
  elsif p_state = 'unsuspend' then
    perform public.notify(p_member, 'account-resumed', '다시 이용할 수 있어요', '이용 정지가 풀렸어요. 잘 맞는 분이 준비되면 정오에 소개해 드릴게요.', '/today', 'unsuspend:' || p_member || ':' || extract(epoch from now())::bigint);
  elsif p_state = 'pause' then
    perform public.notify(p_member, 'operator-paused', '새 소개를 잠시 멈췄어요', '운영진이 확인할 일이 있어 새 소개 준비를 잠시 멈췄어요. 진행 중인 소개는 그대로예요. 궁금한 점은 문의하기로 남겨 주세요.', '/today', 'opause:' || p_member || ':' || extract(epoch from now())::bigint);
  else
    perform public.notify(p_member, 'operator-resumed', '새 소개를 다시 준비해요', '운영진이 새 소개 받기를 다시 켰어요. 쉬고 싶다면 내 정보에서 언제든 다시 쉴 수 있어요.', '/today', 'oresume:' || p_member || ':' || extract(epoch from now())::bigint);
  end if;
  perform public.write_audit('회원 상태 변경 · ' || p_state, p_member::text, nullif(trim(coalesce(p_reason, '')), ''));
end $$;

-- ─────────────────────────────────────────────────────────
-- 7. 화면에 보여 준 알림만 읽음으로(보여 주지 않은 지난 알림은 그대로 둔다). 읽음으로 바꾼 수를 돌려준다.
create or replace function public.mark_shown_notifications_read(p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then raise exception '로그인한 뒤 진행해 주세요.'; end if;
  update public.notifications set read_at = now()
   where member_id = auth.uid() and read_at is null and id = any(coalesce(p_ids, array[]::uuid[]));
  get diagnostics n = row_count;
  return n;
end $$;

-- ─────────────────────────────────────────────────────────
-- 권한: 발송 함수용은 service_role만, 운영진·회원 함수는 로그인한 사람에게 열고 함수 안에서 확인한다.
revoke all on function public.record_email_failure(text, uuid, text), public.pending_email_notifications(int) from public, anon, authenticated;
grant execute on function public.record_email_failure(text, uuid, text), public.pending_email_notifications(int) to service_role;
revoke all on function public.admin_reopen_application(uuid, text), public.admin_cancel_withdrawal(uuid, text), public.admin_list_members(text),
  public.submit_application(), public.admin_broadcast(text, text), public.prepare_application_edit(), public.admin_set_member_state(uuid, text, text),
  public.mark_shown_notifications_read(uuid[]) from public, anon;
grant execute on function public.admin_reopen_application(uuid, text), public.admin_cancel_withdrawal(uuid, text), public.admin_list_members(text),
  public.submit_application(), public.admin_broadcast(text, text), public.prepare_application_edit(), public.admin_set_member_state(uuid, text, text),
  public.mark_shown_notifications_read(uuid[]) to authenticated;
