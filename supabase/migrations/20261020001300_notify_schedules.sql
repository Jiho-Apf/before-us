-- 메일 알림 보내기: 5분마다 send-notifications 함수를 부른다(키가 없으면 함수가 그냥 건너뛴다).
select cron.schedule('before-us-email-notifications', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://mmrqcefipllmcqztksqm.supabase.co/functions/v1/send-notifications',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb)
$$);
