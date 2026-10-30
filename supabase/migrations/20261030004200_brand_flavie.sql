-- 서비스 이름 바꾸기: 비포어스 → 플라비(2026-10-30)
--  회원에게 보이는 서버 문구(알림·막는 이유·결제 상품명)에 남은 옛 이름을 바꾼다.
--  함수 본문을 그대로 다시 쓰면 길고 틀리기 쉬워서, 지금 정의를 읽어 이름만 바꿔 다시 만든다.
--  create or replace 는 소유자·권한·security definer·search_path 를 그대로 둔다.
--  이미 보낸 알림과 지난 결제 기록은 그때의 이름으로 남긴다(기록이라 고치지 않는다).
--  예약 작업 이름(before-us-noon 등)과 저장 키는 회원에게 보이지 않아 그대로 둔다.
do $$
declare
  fn record;
  changed int := 0;
begin
  for fn in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%비포어스%'
  loop
    execute replace(pg_get_functiondef(fn.oid), '비포어스', '플라비');
    changed := changed + 1;
  end loop;
  raise notice '이름을 바꾼 서버 함수: %개', changed;
end $$;

-- 확인: 옛 이름이 남은 함수가 없어야 한다.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%비포어스%'
  ) then
    raise exception '옛 이름(비포어스)이 남은 서버 함수가 있어요';
  end if;
end $$;
