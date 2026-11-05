-- 6300: GPT 2차 검수 T07 — 예약 작업 바꾸기(실제 Supabase에서만 · 로컬 점검은 건너뛴다)
--  - 사진 파일 정리를 하루 한 번(04:00)에서 매시간 :45로 바꾼다. 탈퇴 계정(:15 삭제, 기한 2시간 전부터)의 파일이 기한 전에 지워진다.
--  - 예약 작업 점검(run_job_watchdog)을 매시간 :50에 돌린다.
--  적용 순서: 6000~6200을 함께 적용한 뒤(같은 db push) storage-cleanup 함수를 배포한다(예전 함수도 6000의 선점을 그대로 쓰므로 순서가 바뀌어도 안전).
select cron.schedule('before-us-storage-cleanup', '45 * * * *', $$
  select net.http_post(
    url := 'https://mmrqcefipllmcqztksqm.supabase.co/functions/v1/storage-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-token', (select value from public.private_values where name = 'cron_token')),
    body := '{}'::jsonb)
$$);
select cron.schedule('before-us-job-watchdog', '50 * * * *', $$select public.run_job_watchdog()$$);
