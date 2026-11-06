-- 7500: GPT 3차 검수 R3-04 — 복구 뒤 삭제 이력을 다시 적용할 때 사진 파일까지
--
-- 문제: apply_deletion_log() 는 계정(auth.users → 연결된 자료)만 다시 지웠다. 백업에서 되살린 Storage 파일(신청 사진·편지 사진)은 남아,
--       탈퇴한 사람의 사진이 복구한 저장소에 그대로 있을 수 있었다.
-- 고침: 계정을 지우기 전에 그 회원 폴더의 파일을 정리 대기열(storage_cleanup)에 넣는다(run_withdrawal_deletion 과 같은 기준).
--       파일은 정리 함수(storage-cleanup)가 지운다. 복구 절차는 이 함수 뒤 정리 함수를 한 번 돌리고 남은 파일 수를 확인한다.
--       돌려주는 값(지운 계정 수)은 그대로다.

CREATE OR REPLACE FUNCTION public.apply_deletion_log()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n int;
begin
  insert into public.storage_cleanup (bucket, path)
  select o.bucket_id, o.name from storage.objects o
    join public.deletion_log d on (o.bucket_id = 'application-photos' and split_part(o.name, '/', 1) = d.member_id::text)
                               or (o.bucket_id = 'letter-photos' and split_part(o.name, '/', 2) = d.member_id::text)
  on conflict do nothing;
  delete from auth.users u using public.deletion_log d where u.id = d.member_id;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.apply_deletion_log() from public, anon, authenticated;
