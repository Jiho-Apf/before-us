-- 5900: 마무리된 교류에도 ‘시작한 시각(startedAt)’을 함께 돌려준다.
-- 오늘 화면의 ‘교류 뒤 한 줄’(만남 뒤, 남기는 한 줄)은 실제로 시작한 교류에만 보이는데(startedAt 확인), 마무리된 교류의
-- my_program 응답에는 이 값이 빠져 있어 카드가 한 번도 보이지 않았다(GPT 2차 검수 준비 중 실제 서버 코드 캡처에서 발견).
-- my_program 본문 전체를 다시 쓰지 않고, 마무리된 교류를 돌려주는 한 곳에만 값을 더한다(같은 자리가 정확히 한 곳일 때만).
do $$
declare
  def text := pg_get_functiondef('public.my_program()'::regprocedure);
  needle text := '''today'', today, ''entries'', case when readable then';
  hits int;
begin
  if position('''startedAt'', p.started_at, ''today'', today, ''entries''' in def) > 0 then return; end if;
  hits := (length(def) - length(replace(def, needle, ''))) / length(needle);
  if hits <> 1 then raise exception 'my_program 마무리 응답 자리를 찾지 못했어요(%곳)', hits; end if;
  execute replace(def, needle, '''startedAt'', p.started_at, ' || needle);
end $$;
