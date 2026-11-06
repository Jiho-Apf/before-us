-- 6800: GPT 3차 검수 R3-33·R3-06(G05) — 예약 작업은 할 일이 없어도 한 줄씩 남기고, ‘늦음·안 돎’을 ‘실패’와 따로 판단한다
--        + 밖에서 볼 수 있는 공개 상태(public_health · 개인정보 없음) + 대표 컴퓨터 백업 작업 기록(record_backup_run)
--
-- 문제: deadlines·programs·reminders·withdrawals·job-watchdog(DB 안)과 email·storage-cleanup(함수)은 한 일이 있거나 실패했을 때만
--       작업 기록(job_runs)을 남겨, ‘0건으로 잘 돎’과 ‘아예 안 돎’이 똑같아 보였다. 운영 화면 안의 경고만으로는 DB·인증이 멈추면 볼 수도 없다.
-- 고침:
--   · record_job_run(): 모든 예약 작업이 차례마다 한 줄을 남긴다. 0건이면 detail.zero = true(개인정보 없음 · 숫자만).
--     0건 줄은 같은 작업의 2일 지난 것부터 지운다(5·10분 작업이 쌓이지 않게: 작업당 최대 약 600줄). 실패·처리 기록은 지금처럼 90일.
--   · job_expectations(): 작업마다 ‘이 시간 안에는 한 번 돌아야 함’(평소 간격의 2~3배). 늦음은 마지막 실행 시각으로, 실패는 따로 센다.
--   · run_job_watchdog(): pg_cron 기록(있을 때) + 작업 기록의 마지막 실행 시각으로 늦음을 찾고, 문제 없을 때도 0건 줄을 남긴다.
--   · public_health(): 비회원도 부를 수 있는 상태 요약(작업 이름 · 마지막 실행까지 분 · 늦음 · 최근 실패 여부 · 백업 나이). 회원 수·이름·내용 없음.
--     바깥 감시 서비스(예: 키워드 감시 `"ok":true`)가 5~10분마다 부르는 용도. 틀린 열쇠(401)로 함수가 안 돌면 기록이 없어 ‘늦음’으로 보인다.

create index if not exists job_runs_job_started on public.job_runs (job, started_at desc);

create or replace function public.job_expectations() returns table (job text, within_minutes integer, label text)
language sql immutable set search_path = '' as $$
  values ('noon', 26 * 60, '정오 공개'), ('deadlines', 30, '응답 마감'), ('programs', 30, '교류 진행'), ('reminders', 30, '알림 만들기'),
         ('email', 20, '메일 보내기'), ('withdrawals', 120, '탈퇴 계정 삭제'), ('storage-cleanup', 120, '사진 파일 정리'),
         ('job-watchdog', 120, '작업 점검'), ('retention', 26 * 60, '보존 기간 정리'), ('program-retention', 26 * 60, '교류 기록 정리'),
         ('cohort-eve', 26 * 60, '기수 시작 전날 안내'),
         ('backup', 8 * 24 * 60, '백업(대표 컴퓨터)'), ('backup-expire', 26 * 60, '백업 만료 정리(대표 컴퓨터)'), ('backup-deletions', 26 * 60, '삭제 이력 내보내기(대표 컴퓨터)')
$$;

create or replace function public.record_job_run(p_job text, p_ok boolean, p_detail jsonb default '{}'::jsonb, p_zero boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.job_runs (job, finished_at, ok, detail)
  values (p_job, now(), coalesce(p_ok, false), coalesce(p_detail, '{}'::jsonb) || case when p_zero then jsonb_build_object('zero', true) else '{}'::jsonb end);
  if p_zero then
    delete from public.job_runs r where r.job = p_job and r.detail ->> 'zero' = 'true' and r.started_at < now() - interval '2 days';
  end if;
end $$;
revoke all on function public.job_expectations(), public.record_job_run(text, boolean, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_job_run(text, boolean, jsonb, boolean) to service_role;

-- DB 안의 예약 작업: 0건이어도 남긴다(본문은 그대로 두고 기록 줄만 바꾼다)
do $$
declare def text;
begin
  def := pg_get_functiondef('public.run_introduction_deadlines()'::regprocedure);
  if position('if n > 0 then insert into public.job_runs (job, finished_at, ok, detail) values (''deadlines'', now(), true, jsonb_build_object(''closed'', n)); end if;' in def) = 0 then
    raise exception 'run_introduction_deadlines 기록 줄을 찾지 못했어요';
  end if;
  execute replace(def, 'if n > 0 then insert into public.job_runs (job, finished_at, ok, detail) values (''deadlines'', now(), true, jsonb_build_object(''closed'', n)); end if;',
    'perform public.record_job_run(''deadlines'', true, jsonb_build_object(''closed'', n), n = 0);');

  def := pg_get_functiondef('public.run_reminders()'::regprocedure);
  if position('if n > 0 then insert into public.job_runs (job, finished_at, ok, detail) values (''reminders'', now(), true, jsonb_build_object(''sent'', n)); end if;' in def) = 0 then
    raise exception 'run_reminders 기록 줄을 찾지 못했어요';
  end if;
  execute replace(def, 'if n > 0 then insert into public.job_runs (job, finished_at, ok, detail) values (''reminders'', now(), true, jsonb_build_object(''sent'', n)); end if;',
    'perform public.record_job_run(''reminders'', true, jsonb_build_object(''sent'', n), n = 0);');

  def := pg_get_functiondef('public.run_programs()'::regprocedure);
  if position('insert into public.job_runs (job, finished_at, ok, detail) values (''programs'', now(), (n ->> ''missed'')::int = 0, n);' in def) = 0
     or position('if (n ->> ''expired'')::int + (n ->> ''started'')::int + (n ->> ''missed'')::int + (n ->> ''deciding'')::int + (n ->> ''closed'')::int > 0 then' in def) = 0 then
    raise exception 'run_programs 기록 줄을 찾지 못했어요';
  end if;
  def := replace(def, 'if (n ->> ''expired'')::int + (n ->> ''started'')::int + (n ->> ''missed'')::int + (n ->> ''deciding'')::int + (n ->> ''closed'')::int > 0 then', 'if true then');
  execute replace(def, 'insert into public.job_runs (job, finished_at, ok, detail) values (''programs'', now(), (n ->> ''missed'')::int = 0, n);',
    'perform public.record_job_run(''programs'', (n ->> ''missed'')::int = 0, n, (n ->> ''expired'')::int + (n ->> ''started'')::int + (n ->> ''missed'')::int + (n ->> ''deciding'')::int + (n ->> ''closed'')::int = 0);');
end $$;

-- 탈퇴 계정 삭제(6200 정의 + 0건도 남김)
create or replace function public.run_withdrawal_deletion() returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; overdue int := 0; files int := 0;
begin
  begin
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
  perform public.record_job_run('withdrawals', overdue = 0, jsonb_build_object('deleted', n, 'files', files)
      || case when overdue > 0 then jsonb_build_object('overdue', overdue, 'error', format('기한이 지난 탈퇴 계정 %s개가 남아 있어요.', overdue)) else '{}'::jsonb end,
    n = 0 and files = 0 and overdue = 0);
  return n;
end $$;
revoke all on function public.run_withdrawal_deletion() from public, anon, authenticated;

-- 작업 점검(6200 정의 + 작업 기록 기준 늦음 + 문제 없을 때도 한 줄)
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
  -- 작업 기록 기준: 서버 안 작업과 함수(메일·사진 정리)가 정해진 시간 안에 한 번은 끝까지 돌았는지(0건 차례 포함)
  for r in select e.job, e.within_minutes, e.label, (select max(j.started_at) from public.job_runs j where j.job = e.job) as last_run
             from public.job_expectations() e where e.job not like 'backup%' and e.job <> 'job-watchdog' loop
    if r.last_run is null or r.last_run < now() - make_interval(mins => r.within_minutes) then
      problems := problems || format('%s(%s) 기록 늦음(마지막 %s)', r.label, r.job, coalesce(to_char(r.last_run at time zone 'Asia/Seoul', 'MM-DD HH24:MI'), '없음'));
    end if;
  end loop;
  if cardinality(problems) > 0 then
    perform public.record_job_run('job-watchdog', false, jsonb_build_object('error', array_to_string(problems, ' · ')), false);
  else
    perform public.record_job_run('job-watchdog', true, jsonb_build_object('problems', 0), true);
  end if;
  return jsonb_build_object('problems', to_jsonb(problems));
end $$;
revoke all on function public.run_job_watchdog() from public, anon, authenticated;

-- 공개 상태(비회원 · 개인정보 없음): 작업마다 마지막 실행까지 분 · 늦음 · 최근 실패(마지막 실행이 실패였는지)
create or replace function public.public_health() returns jsonb
language sql stable security definer set search_path = '' as $$
  with jobs as (
    select e.job, e.within_minutes, e.job like 'backup%' as owner_pc,
           (select j.started_at from public.job_runs j where j.job = e.job order by j.started_at desc limit 1) as last_run,
           (select j.ok from public.job_runs j where j.job = e.job order by j.started_at desc limit 1) as last_ok
      from public.job_expectations() e)
  select jsonb_build_object(
    'ok', bool_and(not owner_pc and last_run is not null and last_run >= now() - make_interval(mins => within_minutes) and last_ok is true or owner_pc),
    'checkedAt', now(),
    'jobs', jsonb_agg(jsonb_build_object(
      'job', job,
      'lastRunMinutes', case when last_run is null then null else floor(extract(epoch from now() - last_run) / 60)::int end,
      'late', last_run is null or last_run < now() - make_interval(mins => within_minutes),
      'lastFailed', coalesce(last_ok = false, false),
      'ownerPc', owner_pc) order by owner_pc, job))
  from jobs
$$;
revoke all on function public.public_health() from public;
grant execute on function public.public_health() to anon, authenticated, service_role;

-- 대표 컴퓨터의 백업 도구가 결과를 남긴다(`npx supabase db query --linked`로 · 숫자만 · 경로·파일 이름 없음)
create or replace function public.record_backup_run(p_job text, p_ok boolean, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_job not in ('backup', 'backup-expire', 'backup-deletions') then raise exception '백업 작업 이름을 확인해 주세요.'; end if;
  insert into public.job_runs (job, finished_at, ok, detail)
  values (p_job, now(), coalesce(p_ok, false), coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(p_detail, '{}'::jsonb)) x(k, v)
                                                         where jsonb_typeof(v) in ('number', 'boolean') or (jsonb_typeof(v) = 'string' and char_length(v #>> '{}') <= 120)), '{}'::jsonb));
end $$;
revoke all on function public.record_backup_run(text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.record_backup_run(text, boolean, jsonb) to service_role;
