-- 5800: GPT 1차 검수 대응 — 예약 작업 바꾸기(실제 Supabase에서만 · 로컬 점검은 건너뛴다)
--  - 고민 편지함 정오 배달(before-us-letters-noon)을 멈춘다(C6).
--  - 탈퇴 계정 삭제를 매시간 돌린다(C5 · ‘7일 안에’를 넘기지 않게).
--  - 메일 보내기·사진 파일 정리 함수를 부를 때 예약 작업 열쇠(cron_token)를 머리글로 함께 보낸다(C7 · 함수는 열쇠가 없으면 거절한다).
--    적용 순서: 이 마이그레이션을 먼저 적용한 뒤 두 함수를 배포한다(옛 함수는 머리글을 무시하므로 순서가 바뀌어도 메일이 멈추지 않는다).
select cron.unschedule(jobid) from cron.job where jobname = 'before-us-letters-noon';
select cron.schedule('before-us-withdrawals', '15 * * * *', $$select public.run_withdrawal_deletion()$$);
select cron.schedule('before-us-email-notifications', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://mmrqcefipllmcqztksqm.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-token', (select value from public.private_values where name = 'cron_token')),
    body := '{}'::jsonb)
$$);
select cron.schedule('before-us-storage-cleanup', '0 19 * * *', $$
  select net.http_post(
    url := 'https://mmrqcefipllmcqztksqm.supabase.co/functions/v1/storage-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-token', (select value from public.private_values where name = 'cron_token')),
    body := '{}'::jsonb)
$$);
