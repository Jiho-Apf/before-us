-- 교류 예약 작업: 10분마다 기한·시작·DAY 열림·만남 선택·연락처 공개·마무리, 매일 03:40 KST 교류 글 보존 기간 정리
select cron.schedule('before-us-programs', '*/10 * * * *', $$select public.run_programs()$$);
select cron.schedule('before-us-program-retention', '40 18 * * *', $$select public.run_program_retention()$$);
