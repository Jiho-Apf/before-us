-- 1기 첫 소개를 2027-01-31(일) 정오로 옮긴다(대표 결정 2026-11-19). 신청 마감은 4일 전 2027-01-27.
-- 아직 시작하지 않은 1기 이후 기수도 한 달씩 뒤로: n기 = 2027년 (n)월 마지막 날, 마감은 4일 전(매달 마지막 날 규칙 그대로).
-- 이미 1기에 배정된 회원은 기수 번호가 그대로라 새 날짜를 따라간다. 몇 명인지 적용 출력(NOTICE)에 남긴다.
do $$
declare
  c record;
  moved int := 0;
  assigned int;
begin
  for c in select number from public.cohorts where number >= 1 and starts_on > public.kst_today() order by number desc loop
    update public.cohorts
       set starts_on = (date '2027-02-01' + make_interval(months => c.number - 1))::date - 1,
           application_deadline = (date '2027-02-01' + make_interval(months => c.number - 1))::date - 5
     where number = c.number;
    moved := moved + 1;
  end loop;
  select count(*) into assigned from public.applications where cohort_number = 1;
  raise notice '기수 날짜를 옮겼어요: %개 기수 · 지금 1기에 배정된 신청 %건', moved, assigned;
end $$;
