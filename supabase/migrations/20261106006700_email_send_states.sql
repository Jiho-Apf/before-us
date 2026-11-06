-- 6700: GPT 3차 검수 R3-15 — 메일 상태를 나눈다: 선점(claim) · 보내기 시작(send started) · 제공자 수락 · 결과 기록
--        + R3-04 복구 환경에서는 메일을 내보내지 않는 스위치(outbound_paused)
--
-- 문제(6100): 선점 기한(10분)이 지났는데 결과가 없으면 모두 ‘불확실(unknown)’로 두어 다시 보내지 않았다.
--       그런데 선점만 하고 메일 서버에 닿기 전에 함수가 멈춘 경우(확실히 안 보냄)까지 불확실로 묶여, 그 안내는 영영 가지 않았다.
-- 고침:
--   · 함수(v19~)는 claim_email_notifications(…, p_tracks_start => true)로 잡고, 메일 서버(또는 Resend)에 보내기 직전에
--     email_send_started(source, id) 로 ‘보내기 시작’을 남긴다. (예전 함수 v18은 잡는 순간을 시작으로 본다 → 되돌려도 안전)
--     선점 기한이 이미 지났으면(다른 작업이 넘겨받을 수 있음) false 를 돌려주고, 함수는 그 메일을 보내지 않는다.
--   · 기한이 지났는데 결과가 없을 때:
--       보내기 시작 기록 없음 → 확실히 안 보냄 → 선점만 풀어 다시 보낸다(시도 횟수는 그대로 세어 3번에서 멈춘다).
--       보내기 시작 기록 있음 → 갔는지 모름 → 불확실(unknown)로 두고 자동으로 다시 보내지 않는다(작업 기록에 경고).
--   · 운영진: admin_email_issues() 로 불확실·포기한 메일을 보고, admin_email_retry() 로 근거를 적고 한 번 더 보내게 할 수 있다.
--   · 제공자 수락(SMTP 250 · Resend 2xx)은 함수 안에서만 알 수 있어, 결과 기록(record_email_result 'sent')이 곧 ‘수락 + 기록’이다.
--     수락 뒤 기록 전에 멈추면 보내기 시작만 남아 불확실로 분류된다(두 통이 가지 않게).
--   · outbound_paused: private_values 에 outbound_paused=true 가 있으면 메일 선점이 아무것도 돌려주지 않는다(복구 환경 기본 차단).

alter table public.notifications add column if not exists email_send_started_at timestamptz;
alter table public.email_queue add column if not exists email_send_started_at timestamptz;

create or replace function public.outbound_paused() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.private_values where name = 'outbound_paused' and value = 'true')
$$;
revoke all on function public.outbound_paused() from public, anon, authenticated;

-- p_tracks_start: 이 함수(send-notifications v19~)가 ‘보내기 시작’을 따로 남기는지. 예전 함수(v18 · 인자 없이 부름)는 false →
--   선점하는 순간을 ‘보내기 시작’으로 본다(6100과 같은 보수적 처리: 기한 뒤 불확실). 그래서 함수만 v18로 되돌려도 두 통이 가지 않는다.
drop function if exists public.claim_email_notifications(integer, integer);
create or replace function public.claim_email_notifications(p_limit integer default 50, p_lease_seconds integer default 600, p_tracks_start boolean default false)
returns table (id uuid, email text, title text, body text, link text, source text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare quiet boolean := extract(hour from (public.app_now() at time zone 'Asia/Seoul')) not between 8 and 21;
  lease timestamptz := now() + make_interval(secs => p_lease_seconds); taken int := 0; stuck_n int := 0; stuck_q int := 0; freed int := 0; n int;
  stuck_note constant text := '보내기 시작한 뒤 작업이 멈춰 보냈는지 알 수 없어요. 두 번 가지 않게 다시 보내지 않았어요. 운영진이 확인한 뒤 다시 보낼 수 있어요.';
begin
  -- 복구 환경 등에서 내보내기를 멈춘 동안에는 아무것도 잡지 않는다.
  if public.outbound_paused() then return; end if;
  -- ① 보내기 시작했는데 결과가 없는 채로 기한이 지난 메일: 불확실로 남기고 다시 보내지 않는다.
  update public.notifications n set email_status = 'unknown', email_error = stuck_note, email_lease_until = null
   where n.emailed_at is null and n.email_status is null and n.email_lease_until is not null and n.email_lease_until < now() and n.email_send_started_at is not null;
  get diagnostics stuck_n = row_count;
  update public.email_queue q set email_status = 'unknown', email_error = stuck_note, email_lease_until = null
   where q.emailed_at is null and q.email_status is null and q.email_lease_until is not null and q.email_lease_until < now() and q.email_send_started_at is not null;
  get diagnostics stuck_q = row_count;
  -- ② 선점만 하고 보내기 전에 멈춘 메일: 확실히 안 보냈으므로 선점을 풀어 다시 보낸다(시도 횟수는 그대로).
  update public.notifications n set email_lease_until = null
   where n.emailed_at is null and n.email_status is null and n.email_lease_until is not null and n.email_lease_until < now() and n.email_send_started_at is null;
  get diagnostics n = row_count; freed := freed + n;
  update public.email_queue q set email_lease_until = null
   where q.emailed_at is null and q.email_status is null and q.email_lease_until is not null and q.email_lease_until < now() and q.email_send_started_at is null;
  get diagnostics n = row_count; freed := freed + n;
  if stuck_n + stuck_q > 0 then
    insert into public.job_runs (job, finished_at, ok, detail)
    values ('email', now(), false, jsonb_build_object('sent', 0, 'failed', 0, 'unknown', stuck_n + stuck_q, 'retried', freed, 'reason', stuck_note));
  end if;

  return query
  with picked as (
    select n.id from public.notifications n
      join public.profiles p on p.id = n.member_id and (p.status = 'active' or (p.status = 'suspended' and n.kind = 'account-suspended'))
      join auth.users u on u.id = p.id and u.email_confirmed_at is not null
     where n.emailed_at is null and n.email_status is null and n.email_attempts < 3 and n.created_at > now() - interval '2 days'
       and n.email_lease_until is null
       and case public.email_class(n.kind)
             when 'always' then true
             when 'important' then public.email_beta_mode() or p.notify_email
             else p.email_all and (public.email_beta_mode() or p.notify_email) end
       and (public.email_class(n.kind) = 'always' or not quiet)
     order by n.email_attempts, case public.email_class(n.kind) when 'important' then 0 when 'always' then 1 else 2 end, n.created_at
     limit p_limit
     for update of n skip locked),
  claimed as (
    update public.notifications x set email_lease_until = lease, email_attempts = x.email_attempts + 1, email_send_started_at = case when p_tracks_start then null else now() end
      from picked where x.id = picked.id
    returning x.id, x.member_id, x.title, x.body, x.link)
  select c.id, pr.email, c.title, c.body, c.link, 'notification'::text from claimed c join public.profiles pr on pr.id = c.member_id;
  get diagnostics taken = row_count;
  if taken < p_limit and not quiet then
    return query
    with picked as (
      select q.id from public.email_queue q
       where q.emailed_at is null and q.email_status is null and q.email_attempts < 3 and q.created_at > now() - interval '3 days'
         and q.email_lease_until is null
       order by q.email_attempts, q.created_at
       limit p_limit - taken
       for update of q skip locked),
    claimed as (
      update public.email_queue x set email_lease_until = lease, email_attempts = x.email_attempts + 1, email_send_started_at = case when p_tracks_start then null else now() end
        from picked where x.id = picked.id
      returning x.id, x.email, x.title, x.body, x.link)
    select c.id, c.email, c.title, c.body, c.link, 'queue'::text from claimed c;
  end if;
end $$;

-- 보내기 직전: 내 선점이 아직 살아 있을 때만 ‘보내기 시작’을 남기고 true. 기한이 지났거나 이미 결과가 있으면 false(보내지 않는다).
create or replace function public.email_send_started(p_source text, p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_source = 'queue' then
    update public.email_queue set email_send_started_at = now()
     where id = p_id and emailed_at is null and email_status is null and email_lease_until is not null and email_lease_until > now();
  elsif p_source = 'notification' then
    update public.notifications set email_send_started_at = now()
     where id = p_id and emailed_at is null and email_status is null and email_lease_until is not null and email_lease_until > now();
  else
    raise exception '메일 종류를 확인해 주세요.';
  end if;
  return found;
end $$;

-- 결과 기록(6100 정의 + 실패·되돌림이면 ‘보내기 시작’ 표시를 지운다)
create or replace function public.record_email_result(p_source text, p_id uuid, p_status text, p_error text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n int; err text := left(coalesce(p_error, ''), 300);
begin
  if p_source not in ('notification', 'queue') or p_status not in ('sent', 'failed', 'unknown', 'released') then raise exception '메일 결과를 확인해 주세요.'; end if;
  if p_source = 'queue' then
    update public.email_queue set
      emailed_at = case when p_status = 'sent' then now() else emailed_at end,
      email_status = case when p_status = 'unknown' then 'unknown' else email_status end,
      email_error = case when p_status in ('failed', 'unknown') then err when p_status = 'sent' then null else email_error end,
      email_attempts = case when p_status = 'released' then greatest(email_attempts - 1, 0) else email_attempts end,
      email_send_started_at = case when p_status in ('failed', 'released') then null else email_send_started_at end,
      email_lease_until = null
     where id = p_id and emailed_at is null returning email_attempts into n;
  else
    update public.notifications set
      emailed_at = case when p_status = 'sent' then now() else emailed_at end,
      email_status = case when p_status = 'unknown' then 'unknown' else email_status end,
      email_error = case when p_status in ('failed', 'unknown') then err when p_status = 'sent' then null else email_error end,
      email_attempts = case when p_status = 'released' then greatest(email_attempts - 1, 0) else email_attempts end,
      email_send_started_at = case when p_status in ('failed', 'released') then null else email_send_started_at end,
      email_lease_until = null
     where id = p_id and emailed_at is null returning email_attempts into n;
  end if;
  return coalesce(n, 0);
end $$;

-- 운영진: 보냈는지 모르는 메일 · 세 번 실패해 멈춘 메일(최근 p_days일). 받는 주소·본문은 보이지 않는다.
create or replace function public.admin_email_issues(p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'createdAt' desc) from (
    select jsonb_build_object('source', 'notification', 'id', n.id, 'kind', n.kind, 'title', n.title, 'member', public.admin_member_brief(n.member_id),
             'state', case when n.email_status = 'unknown' then 'unknown' else 'gave-up' end, 'attempts', n.email_attempts, 'error', n.email_error,
             'sendStartedAt', n.email_send_started_at, 'createdAt', n.created_at) x
      from public.notifications n
     where n.emailed_at is null and (n.email_status = 'unknown' or n.email_attempts >= 3) and n.created_at > now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
    union all
    select jsonb_build_object('source', 'queue', 'id', q.id, 'kind', 'queue', 'title', q.title, 'member', null,
             'state', case when q.email_status = 'unknown' then 'unknown' else 'gave-up' end, 'attempts', q.email_attempts, 'error', q.email_error,
             'sendStartedAt', q.email_send_started_at, 'createdAt', q.created_at)
      from public.email_queue q
     where q.emailed_at is null and (q.email_status = 'unknown' or q.email_attempts >= 3) and q.created_at > now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
  ) s), '[]'::jsonb);
end $$;

-- 운영진: 확인한 뒤 한 번 더 보내기(불확실·포기한 메일만 · 이유 필수 · 감사 기록). 두 통이 갈 수 있음을 알고 고르는 일이다.
create or replace function public.admin_email_retry(p_source text, p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare clean text := nullif(trim(coalesce(p_reason, '')), ''); hit int;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영진 권한이 필요해요.'; end if;
  if clean is null or char_length(clean) < 5 then raise exception '다시 보내는 이유를 5자 이상 적어 주세요.'; end if;
  if p_source = 'queue' then
    update public.email_queue set email_status = null, email_attempts = least(email_attempts, 2), email_lease_until = null, email_send_started_at = null,
           email_error = '운영진이 다시 보내기로 했어요: ' || left(clean, 200)
     where id = p_id and emailed_at is null and (email_status = 'unknown' or email_attempts >= 3) and created_at > now() - interval '3 days';
  elsif p_source = 'notification' then
    update public.notifications set email_status = null, email_attempts = least(email_attempts, 2), email_lease_until = null, email_send_started_at = null,
           email_error = '운영진이 다시 보내기로 했어요: ' || left(clean, 200)
     where id = p_id and emailed_at is null and (email_status = 'unknown' or email_attempts >= 3) and created_at > now() - interval '2 days';
  else
    raise exception '메일 종류를 확인해 주세요.';
  end if;
  get diagnostics hit = row_count;
  if hit = 0 then raise exception '다시 보낼 수 있는 메일이 아니에요(이미 갔거나, 보낼 수 있는 기간이 지났어요).'; end if;
  perform public.write_audit('메일 다시 보내기', p_source || ':' || p_id::text, left(clean, 200));
  return jsonb_build_object('source', p_source, 'id', p_id, 'requeued', true);
end $$;

revoke all on function public.email_send_started(text, uuid), public.admin_email_issues(integer), public.admin_email_retry(text, uuid, text) from public, anon, authenticated;
grant execute on function public.email_send_started(text, uuid) to service_role;
grant execute on function public.admin_email_issues(integer), public.admin_email_retry(text, uuid, text) to authenticated;
revoke all on function public.claim_email_notifications(integer, integer, boolean), public.record_email_result(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_email_notifications(integer, integer, boolean), public.record_email_result(text, uuid, text, text) to service_role;
