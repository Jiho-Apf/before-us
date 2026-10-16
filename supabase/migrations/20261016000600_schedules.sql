-- 예약 작업 등록(pg_cron은 UTC 기준. 한국 시간 = UTC + 9)
--  - 12:00, 12:05 KST  정오 공개(두 번째 실행은 첫 실행이 실패했을 때를 대비한 재시도, 같은 일을 두 번 하지 않는다)
--  - 10분마다           응답 마감 처리
--  - 03:30 KST          보존 기간 지난 자료 삭제
--  - 04:00 KST          지운 사진 파일 정리(storage-cleanup 함수 호출)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule('before-us-noon', '0,5 3 * * *', $$select public.run_noon()$$);
select cron.schedule('before-us-deadlines', '*/10 * * * *', $$select public.run_introduction_deadlines()$$);
select cron.schedule('before-us-retention', '30 18 * * *', $$select public.run_retention()$$);
select cron.schedule('before-us-storage-cleanup', '0 19 * * *', $$
  select net.http_post(
    url := 'https://mmrqcefipllmcqztksqm.supabase.co/functions/v1/storage-cleanup',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb)
$$);
