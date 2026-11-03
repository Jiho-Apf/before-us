-- 고민 편지함: 매일 12:01(한국 시간)에 정오에 도착한 편지를 받는 분께 알린다.
select cron.schedule('before-us-letters-noon', '1 3 * * *', $$select public.run_letter_delivery()$$);
