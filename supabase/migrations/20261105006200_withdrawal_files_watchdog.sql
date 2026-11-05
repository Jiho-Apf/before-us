-- 6200: GPT 2차 검수 T07 — 탈퇴 뒤 ‘7일 안에’ 사진 파일까지 · 예약 작업이 늦거나 실패하면 보이게
--
-- 문제 1: 탈퇴 계정은 매시간(기한 1시간 전부터) 지웠지만, 사진 파일은 하루 한 번(04:00) 정리 함수가 지워서
--         계정을 지운 뒤 최대 하루 가까이 파일이 남아 ‘계정·신청서·사진 7일 안에’를 넘길 수 있었다.
--         또 등록하지 않고 올리기만 한 사진·편지 사진은 다음 날 보존 정리가 찾아야 대기열에 올랐다.
-- 고침: · 계정을 지울 때 그 회원 폴더의 신청 사진·편지 사진 파일을 함께 정리 대기열에 넣는다.
--       · 기한 2시간 전부터 지우고(아래 6300에서 사진 정리를 매시간 :45로 바꿈) → 계정 :15 삭제, 파일 :45 삭제 모두 기한 전에 끝난다.
-- 문제 2: 탈퇴 삭제 작업은 작업 기록을 남기지 않아, 실패하거나 멈춰도 운영진이 알 수 없었다. 예약 작업이 아예 돌지 않는 것도 보이지 않았다.
-- 고침: · 탈퇴 삭제: 지운 계정이 있거나, 기한이 지난 계정이 남았거나, 오류가 나면 작업 기록(withdrawals)에 남긴다(실패는 대시보드 맨 위 경고).
--       · 작업 점검(run_job_watchdog, 매시간): 기한 지난 탈퇴 계정 · 하루 넘게 못 지운 파일 · pg_cron 실패/늦음 · 함수 호출(pg_net) 실패를
--         찾으면 작업 기록(job-watchdog · 실패)으로 남긴다.

create or replace function public.run_withdrawal_deletion() returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; overdue int := 0; files int := 0;
begin
  begin
    -- 지울 계정의 사진 파일(신청 사진 폴더 · 편지 사진의 내 폴더)을 먼저 정리 대기열에 넣는다.
    insert into public.storage_cleanup (bucket, path)
    select o.bucket_id, o.name from storage.objects o
      join public.profiles p on p.status = 'withdrawal_requested' and p.deletion_due_at <= now() + interval '2 hours'
       and ((o.bucket_id = 'application-photos' and split_part(o.name, '/', 1) = p.id::text)
         or (o.bucket_id = 'letter-photos' and split_part(o.name, '/', 2) = p.id::text))
    on conflict do nothing;
    get diagnostics files = row_count;
    with gone as (
      delete from auth.users u using public.profiles p
       where p.id = u.id and p.status = 'withdrawal_requested' and p.deletion_due_at <= now() + interval '2 hours'
      returning u.id)
    insert into public.deletion_log (member_id) select id from gone
    on conflict (member_id) do update set deleted_at = now();
    get diagnostics n = row_count;
  exception when others then
    insert into public.job_runs (job, finished_at, ok, detail) values ('withdrawals', now(), false, jsonb_build_object('error', left(sqlerrm, 300)));
    return 0;
  end;
  select count(*) into overdue from public.profiles where status = 'withdrawal_requested' and deletion_due_at < now();
  if n > 0 or overdue > 0 then
    insert into public.job_runs (job, finished_at, ok, detail)
    values ('withdrawals', now(), overdue = 0, jsonb_build_object('deleted', n, 'files', files)
      || case when overdue > 0 then jsonb_build_object('overdue', overdue, 'error', format('기한이 지난 탈퇴 계정 %s개가 남아 있어요.', overdue)) else '{}'::jsonb end);
  end if;
  return n;
end $$;
revoke all on function public.run_withdrawal_deletion() from public, anon, authenticated;

-- 예약 작업 점검(매시간). 문제를 찾으면 작업 기록(job-watchdog · 실패)으로 남긴다 → 운영진 대시보드 맨 위 ‘예약 작업이 실패했어요’.
-- pg_cron·pg_net 기록은 실제 Supabase에만 있어, 없으면 그 부분은 건너뛴다.
create or replace function public.run_job_watchdog() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare problems text[] := '{}'; r record; overdue int; stuck int; calls int;
begin
  select count(*) into overdue from public.profiles where status = 'withdrawal_requested' and deletion_due_at < now();
  if overdue > 0 then problems := problems || format('기한이 지난 탈퇴 계정 %s개', overdue); end if;
  select count(*) into stuck from public.storage_cleanup c
   where c.queued_at < now() - interval '1 day' and not public.storage_path_in_use(c.bucket, c.path);
  if stuck > 0 then problems := problems || format('하루 넘게 지우지 못한 사진 파일 %s개', stuck); end if;
  if to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then
    for r in execute $q$
      select j.jobname,
             max(d.start_time) as last_start,
             count(*) filter (where d.status = 'failed' and d.start_time > now() - interval '1 hour') as failed
        from cron.job j
        left join cron.job_run_details d on d.jobid = j.jobid and d.start_time > now() - interval '3 days'
       where j.active and j.jobname like 'before-us-%'
       group by j.jobname $q$
    loop
      if r.failed > 0 then problems := problems || format('%s 실패 %s번', r.jobname, r.failed); end if;
      -- 늦음: 마지막 실행이 평소 간격의 두 배 넘게 지났을 때(하루 작업 26시간 · 매시간 작업 2시간 · 몇 분마다 30분)
      if r.last_start is null or r.last_start < now() - (case
           when r.jobname in ('before-us-email-notifications', 'before-us-deadlines', 'before-us-programs', 'before-us-reminders') then interval '30 minutes'
           when r.jobname in ('before-us-withdrawals', 'before-us-storage-cleanup', 'before-us-job-watchdog') then interval '2 hours'
           else interval '26 hours' end) then
        problems := problems || format('%s 늦음(마지막 실행 %s)', r.jobname, coalesce(to_char(r.last_start at time zone 'Asia/Seoul', 'MM-DD HH24:MI'), '없음'));
      end if;
    end loop;
  end if;
  if to_regclass('net._http_response') is not null then
    execute $q$ select count(*)::int from net._http_response
                 where created > now() - interval '1 hour' and (timed_out or error_msg is not null or status_code not between 200 and 299) $q$ into calls;
    if calls > 0 then problems := problems || format('메일·사진 정리 함수 호출 실패 %s번(최근 1시간)', calls); end if;
  end if;
  if cardinality(problems) > 0 then
    insert into public.job_runs (job, finished_at, ok, detail) values ('job-watchdog', now(), false, jsonb_build_object('error', array_to_string(problems, ' · ')));
  end if;
  return jsonb_build_object('problems', to_jsonb(problems));
end $$;
revoke all on function public.run_job_watchdog() from public, anon, authenticated;
