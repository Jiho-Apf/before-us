-- 화면 오류 기록은 30일만 둔다(새 기록이 들어올 때 지난 기록을 함께 지운다).
create or replace function public.report_client_error(p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.client_errors where at < now() - interval '30 days';
  if (select count(*) from public.client_errors where at > now() - interval '10 minutes') >= 200 then return; end if;
  insert into public.client_errors (context, message, stack, path, release, user_agent)
  values (left(p_payload ->> 'context', 120), left(p_payload ->> 'message', 1000), left(p_payload ->> 'stack', 4000), left(p_payload ->> 'path', 200), left(p_payload ->> 'release', 60), left(p_payload ->> 'userAgent', 300));
end $$;
