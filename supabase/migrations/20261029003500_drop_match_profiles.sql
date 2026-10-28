-- 궁합 분석은 운영진 화면 안에서만(외부 AI 없이) 하기로 해서, 외부 분석용으로 신청서를 꺼내 주던 함수를 없앤다.
drop function if exists public.admin_match_profiles(uuid, uuid);
