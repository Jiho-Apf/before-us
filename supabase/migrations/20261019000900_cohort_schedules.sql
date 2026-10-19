-- 기수 시작 전날 정오 알림(12:00 KST = 03:00 UTC)
select cron.schedule('before-us-cohort-eve', '1 3 * * *', $$select public.run_cohort_eve()$$);
