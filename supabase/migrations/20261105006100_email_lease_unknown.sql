-- 6100: GPT 2차 검수 T06 — 보내는 도중 멈춘 메일은 다시 보내지 않는다
--
-- 문제: 메일 함수가 메일을 선점(10분 기한)한 뒤 메일 서버가 받아들였는데 결과를 기록하기 전에 함수가 멈추면(시간 초과·배포·네트워크),
--       10분 뒤 선점 기한이 지나 같은 메일을 다시 잡아 한 번 더 보냈다(최대 3번).
-- 고침: 결과 기록(record_email_result)은 늘 선점 기한을 비운다. 그러니 ‘기한이 지났는데 결과가 없는’ 메일은 보내는 도중 멈춘 것이다.
--       이런 메일은 다시 잡지 않고 ‘불확실(unknown)’로 남긴다(사이트 안 알림은 그대로 보인다).
--       그런 메일이 있으면 작업 기록(job_runs · email · 실패)에 남겨 운영진 대시보드 메일 줄에 보이게 한다.

create or replace function public.claim_email_notifications(p_limit integer default 50, p_lease_seconds integer default 600)
returns table (id uuid, email text, title text, body text, link text, source text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare quiet boolean := extract(hour from (public.app_now() at time zone 'Asia/Seoul')) not between 8 and 21;
  lease timestamptz := now() + make_interval(secs => p_lease_seconds); taken int := 0; stuck_n int := 0; stuck_q int := 0;
  stuck_note constant text := '보내는 도중 작업이 멈춰 보냈는지 알 수 없어요. 두 번 가지 않게 다시 보내지 않았어요.';
begin
  -- 보내는 도중 멈춘 메일(선점 기한이 지났는데 결과가 없음): 다시 보내지 않고 불확실로 남긴다.
  update public.notifications n set email_status = 'unknown', email_error = stuck_note, email_lease_until = null
   where n.emailed_at is null and n.email_status is null and n.email_lease_until is not null and n.email_lease_until < now();
  get diagnostics stuck_n = row_count;
  update public.email_queue q set email_status = 'unknown', email_error = stuck_note, email_lease_until = null
   where q.emailed_at is null and q.email_status is null and q.email_lease_until is not null and q.email_lease_until < now();
  get diagnostics stuck_q = row_count;
  if stuck_n + stuck_q > 0 then
    insert into public.job_runs (job, finished_at, ok, detail)
    values ('email', now(), false, jsonb_build_object('sent', 0, 'failed', 0, 'unknown', stuck_n + stuck_q, 'reason', stuck_note));
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
         and q.email_lease_until is null
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
revoke all on function public.claim_email_notifications(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_email_notifications(integer, integer) to service_role;
