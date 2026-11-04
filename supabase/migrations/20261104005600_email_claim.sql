-- 5600: GPT 1차 검수 대응 ③ — 메일 발송 선점·결과 기록·호출 확인(C7)
--
-- 메일 작업이 ‘보낼 목록 읽기 → 보내기 → 보낸 시각 기록’ 순서라, 두 작업이 겹치면 같은 메일을 두 번 보낼 수 있었고
-- 기록이 실패하면 다음 차례에 다시 보냈다. 또 누구나 함수 주소를 불러 작업을 돌릴 수 있었다.
--  · claim_email_notifications(): 보낼 메일을 잠금 건너뛰기로 집어 ‘처리 중(기한 10분)’으로 표시하고 시도 횟수를 올린다.
--  · record_email_result(): sent(보냄) · failed(실패, 3번까지 다시) · unknown(보냈는지 불확실 — 다시 보내지 않고 남긴다) · released(연결 실패, 횟수 되돌림)
--  · 예약 작업 열쇠(private_values.cron_token): 대표가 따로 넣을 비밀 값 없이 서버가 만든다. 예약 작업이 머리글로 보내고 함수가 확인한다.
--    (5800 일정 마이그레이션에서 메일·사진 정리 작업이 이 열쇠를 함께 보내게 바꾼다.)

alter table public.notifications add column if not exists email_lease_until timestamptz,
  add column if not exists email_status text check (email_status in ('unknown'));
alter table public.email_queue add column if not exists email_lease_until timestamptz,
  add column if not exists email_status text check (email_status in ('unknown'));

insert into public.private_values (name, value)
values ('cron_token', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text))
on conflict (name) do nothing;

create or replace function public.cron_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_token, '') <> '' and exists (select 1 from public.private_values where name = 'cron_token' and value = p_token)
$$;
revoke all on function public.cron_token_ok(text) from public, anon, authenticated;
grant execute on function public.cron_token_ok(text) to service_role;

create or replace function public.claim_email_notifications(p_limit integer default 50, p_lease_seconds integer default 600)
returns table (id uuid, email text, title text, body text, link text, source text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare quiet boolean := extract(hour from (public.app_now() at time zone 'Asia/Seoul')) not between 8 and 21;
  lease timestamptz := now() + make_interval(secs => p_lease_seconds); taken int := 0;
begin
  return query
  with picked as (
    select n.id from public.notifications n
      join public.profiles p on p.id = n.member_id and (p.status = 'active' or (p.status = 'suspended' and n.kind = 'account-suspended'))
      join auth.users u on u.id = p.id and u.email_confirmed_at is not null
     where n.emailed_at is null and n.email_status is null and n.email_attempts < 3 and n.created_at > now() - interval '2 days'
       and (n.email_lease_until is null or n.email_lease_until < now())
       and case public.email_class(n.kind)
             when 'always' then true
             when 'important' then public.email_beta_mode() or p.notify_email
             else p.email_all and (public.email_beta_mode() or p.notify_email) end
       and (public.email_class(n.kind) = 'always' or not quiet)
     order by n.email_attempts, case public.email_class(n.kind) when 'important' then 0 when 'always' then 1 else 2 end, n.created_at
     limit p_limit
     for update of n skip locked),
  claimed as (
    update public.notifications x set email_lease_until = lease, email_attempts = x.email_attempts + 1
      from picked where x.id = picked.id
    returning x.id, x.member_id, x.title, x.body, x.link)
  select c.id, pr.email, c.title, c.body, c.link, 'notification'::text from claimed c join public.profiles pr on pr.id = c.member_id;
  get diagnostics taken = row_count;
  if taken < p_limit and not quiet then
    return query
    with picked as (
      select q.id from public.email_queue q
       where q.emailed_at is null and q.email_status is null and q.email_attempts < 3 and q.created_at > now() - interval '3 days'
         and (q.email_lease_until is null or q.email_lease_until < now())
       order by q.email_attempts, q.created_at
       limit p_limit - taken
       for update of q skip locked),
    claimed as (
      update public.email_queue x set email_lease_until = lease, email_attempts = x.email_attempts + 1
        from picked where x.id = picked.id
      returning x.id, x.email, x.title, x.body, x.link)
    select c.id, c.email, c.title, c.body, c.link, 'queue'::text from claimed c;
  end if;
end $$;

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
      email_lease_until = null
     where id = p_id and emailed_at is null returning email_attempts into n;
  else
    update public.notifications set
      emailed_at = case when p_status = 'sent' then now() else emailed_at end,
      email_status = case when p_status = 'unknown' then 'unknown' else email_status end,
      email_error = case when p_status in ('failed', 'unknown') then err when p_status = 'sent' then null else email_error end,
      email_attempts = case when p_status = 'released' then greatest(email_attempts - 1, 0) else email_attempts end,
      email_lease_until = null
     where id = p_id and emailed_at is null returning email_attempts into n;
  end if;
  return coalesce(n, 0);
end $$;
revoke all on function public.claim_email_notifications(integer, integer), public.record_email_result(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_email_notifications(integer, integer), public.record_email_result(text, uuid, text, text) to service_role;

-- 기다리는 메일 확인(설정이 없을 때 대시보드 경고용)도 보냈는지 불확실한 메일은 빼고 센다.
CREATE OR REPLACE FUNCTION public.pending_email_notifications(p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, email text, title text, body text, link text, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select x.id, x.email, x.title, x.body, x.link, x.source from (
    select n.id, p.email, n.title, n.body, n.link, 'notification'::text as source, n.created_at, n.email_attempts as attempts,
           public.email_class(n.kind) = 'always' as urgent,
           case public.email_class(n.kind) when 'important' then 0 when 'always' then 1 else 2 end as rank
      from public.notifications n
      join public.profiles p on p.id = n.member_id and (p.status = 'active' or (p.status = 'suspended' and n.kind = 'account-suspended'))
      join auth.users u on u.id = p.id and u.email_confirmed_at is not null
     where n.emailed_at is null and n.email_status is null and n.email_attempts < 3 and n.created_at > now() - interval '2 days'
       and case public.email_class(n.kind)
             when 'always' then true
             when 'important' then public.email_beta_mode() or p.notify_email
             else p.email_all and (public.email_beta_mode() or p.notify_email) end
    union all
    select q.id, q.email, q.title, q.body, q.link, 'queue'::text, q.created_at, q.email_attempts, false, 0
      from public.email_queue q where q.emailed_at is null and q.email_status is null and q.email_attempts < 3 and q.created_at > now() - interval '3 days'
  ) x
  where x.urgent or extract(hour from (public.app_now() at time zone 'Asia/Seoul')) between 8 and 21
  order by x.attempts, x.rank, x.created_at
  limit p_limit
$function$;
