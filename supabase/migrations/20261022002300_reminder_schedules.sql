-- 마감 전 알림: 10분마다
select cron.schedule('before-us-reminders', '*/10 * * * *', $$select public.run_reminders()$$);
