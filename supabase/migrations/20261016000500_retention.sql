-- 비포어스 서버 7단계: 보존 기간이 지난 자료 삭제(V6-privacy-01 초안)
--  - 탈퇴 요청 7일 뒤: 계정과 회원 자료 삭제(신고 기록은 안전 증빙으로 남기되 회원 연결은 끊긴다)
--  - 끝난 소개 30일 뒤: 상대에게 보였던 프로필 사본 삭제
--  - 답변 완료 문의 3년 뒤, 감사 기록 365일 뒤, 읽은 알림 90일 뒤, 작업 기록 90일 뒤 삭제
--  - 사진 파일은 storage_cleanup 대기열에 쌓이고, storage-cleanup 함수가 Storage API로 지운다.

create or replace function public.run_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run_id bigint; result jsonb; members int; snapshots int; inquiries int; audits int; notes int;
begin
  insert into public.job_runs (job) values ('retention') returning id into run_id;
  begin
    with gone as (
      delete from auth.users u using public.profiles p
       where p.id = u.id and p.status = 'withdrawal_requested' and p.deletion_due_at <= now()
      returning u.id)
    select count(*) into members from gone;

    with cleared as (
      update public.introductions
         set snapshot_a = jsonb_build_object('deleted', true), snapshot_b = jsonb_build_object('deleted', true)
       where status in ('closed', 'cancelled') and closed_at <= now() - interval '30 days' and not (snapshot_a ? 'deleted')
      returning id)
    select count(*) into snapshots from cleared;

    with old as (delete from public.inquiries where status = 'answered' and answered_at <= now() - interval '3 years' returning id)
    select count(*) into inquiries from old;

    perform set_config('before_us.retention', 'on', true);
    with old as (delete from public.audit_log where at <= now() - interval '365 days' returning id)
    select count(*) into audits from old;
    perform set_config('before_us.retention', 'off', true);

    with old as (delete from public.notifications where read_at <= now() - interval '90 days' returning id)
    select count(*) into notes from old;
    delete from public.job_runs where started_at <= now() - interval '90 days' and id <> run_id;

    result := jsonb_build_object('members', members, 'snapshots', snapshots, 'inquiries', inquiries, 'audits', audits, 'notifications', notes);
    update public.job_runs set finished_at = now(), ok = true, detail = result where id = run_id;
  exception when others then
    result := jsonb_build_object('error', sqlerrm);
    update public.job_runs set finished_at = now(), ok = false, detail = result where id = run_id;
  end;
  return result;
end $$;

-- 저장소 정리 함수가 가져갈 파일 목록: 아직 열람 기간인 소개 사본에 쓰이는 사진은 남겨 둔다.
create or replace function public.storage_cleanup_batch(p_limit int default 200) returns table (bucket text, path text)
language sql stable security definer set search_path = '' as $$
  select c.bucket, c.path from public.storage_cleanup c
   where not exists (
     select 1 from public.introductions i
      where i.status in ('reserved', 'published', 'mutual') and now() < i.view_until
        and (i.snapshot_a -> 'photos' @> jsonb_build_array(jsonb_build_object('path', c.path))
          or i.snapshot_b -> 'photos' @> jsonb_build_array(jsonb_build_object('path', c.path))))
   order by c.queued_at
   limit p_limit
$$;

revoke all on function public.run_retention(), public.storage_cleanup_batch(int) from public, anon, authenticated;
grant execute on function public.storage_cleanup_batch(int) to service_role;
