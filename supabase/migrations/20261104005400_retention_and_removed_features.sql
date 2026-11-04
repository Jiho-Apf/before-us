-- 5400: GPT 1차 검수 대응 ① — 내린 기능 닫기(C6) · 개인정보 파기 다시 짜기(C5) · 교체 사진 보호(C2) · 지운 계정 기록(O2)
--
-- C6  정오의 서랍·고민 편지함은 화면에서 내렸는데(§103) 서버 함수는 열려 있어 글을 받을 수 있었다. 표·함수를 모두 지운다
--     (정오 배달 예약 작업은 5800 일정 마이그레이션에서 멈춘다).
-- C5  ‘어느 표를 지울까’가 아니라 ‘개인정보의 원문과 복사본이 어디 있나’로 정리한다(개인정보처리방침 3번이 기준).
--     · 교류 종료 30일: 교류 글과 그 복사본(셋째 날 질문·책갈피)·한 권 동의(신고된 교류는 종결 뒤 3년까지 보존)
--     · 약속 90일: 날짜·시간과 약속 제안(활동·지역·장소)을 함께
--     · 3년: 종결한 신고, 끝난 소개·교류 진행 기록(신고 보존 중이 아닌 것)
--     · 어떤 경로로 닫혀도(정상 종료·차단·탈퇴·정지·소개 닫힘) 고른 시간·지역·‘이대로 시작’을 지운다(트리거 하나)
--     · 탈퇴 계정 삭제는 매시간 돈다(한 시간 안에 기한이 오는 계정까지) — 7일을 넘기지 않게
--     · 그동안 빠져 있던 것: 기한이 지난 안전 이력, 메일 대기열(30일), 만료된 추천사 링크, 1년 지난 이번 주 노트
-- C2  심사 중인 교체 사진이 ‘쓰이지 않는 파일’로 잡혀 지워질 수 있었다. 쓰이는지 판단을 한 함수로 모으고, 목록에 넣을 때와
--     실제로 지우기 직전(storage_cleanup_batch · storage_cleanup_recheck) 모두 다시 확인한다.
-- O2  백업을 되살렸을 때 지운 계정이 돌아오지 않게, 탈퇴로 지운 계정 번호를 35일 남기고(백업은 30일까지) 복구 뒤 다시 지운다.

-- ── C6: 서랍·고민 편지함 지우기
drop function if exists public.drawer_alias(uuid, uuid), public.drawer_answer(date, text), public.drawer_comment(uuid, text), public.drawer_comments_of(uuid),
  public.drawer_day(date), public.drawer_delete_answer(uuid), public.drawer_delete_comment(uuid), public.drawer_open_day(date), public.drawer_question(date),
  public.drawer_report(text, uuid, text), public.drawer_thank(text, uuid, boolean), public.admin_drawer_moderate(text, uuid, text), public.admin_drawer_reports(),
  public.worry_alias(uuid, uuid), public.worry_board(text), public.worry_cancel_letter(uuid), public.worry_close_thread(uuid), public.worry_delete_post(uuid),
  public.worry_deliver_at(timestamptz), public.worry_letter_check(text), public.worry_mailbox(), public.worry_post(text, text), public.worry_reply(uuid, text),
  public.worry_report(text, uuid, text), public.worry_send_letter(uuid, text), public.worry_thread(uuid), public.admin_worry_moderate(text, uuid, text),
  public.admin_worry_reports(), public.run_letter_delivery();
drop table if exists public.drawer_thanks, public.drawer_reports, public.drawer_comments, public.drawer_answers,
  public.worry_reports, public.worry_letters, public.worry_threads, public.worry_posts cascade;

-- ── O2: 지운 계정 기록
create table if not exists public.deletion_log (
  member_id uuid primary key,
  deleted_at timestamptz not null default now()
);
alter table public.deletion_log enable row level security;
revoke all on public.deletion_log from public, anon, authenticated;

-- 탈퇴 계정 삭제(매시간 · 보존 정리에서도 부른다). 한 시간 안에 기한이 오는 계정까지 지워 ‘7일 안에’를 넘기지 않는다.
create or replace function public.run_withdrawal_deletion() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with gone as (
    delete from auth.users u using public.profiles p
     where p.id = u.id and p.status = 'withdrawal_requested' and p.deletion_due_at <= now() + interval '1 hour'
    returning u.id)
  insert into public.deletion_log (member_id) select id from gone
  on conflict (member_id) do update set deleted_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- 백업을 되살린 뒤 한 번 부른다: 지운 계정이 다시 살아나지 않게 지운다(나머지는 계정 삭제에 따라 함께 지워진다).
create or replace function public.apply_deletion_log() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from auth.users u using public.deletion_log d where u.id = d.member_id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.run_withdrawal_deletion(), public.apply_deletion_log() from public, anon, authenticated;

-- ── C5: 신고로 보존 중인 소개인지(교류 글·진행 기록을 지우지 않는다) · 보존 사유와 만료일
create or replace function public.retention_hold(p_introduction uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reports r
                  where r.introduction_id = p_introduction
                    and (r.status <> 'closed' or coalesce(r.handled_at, r.created_at) > now() - interval '3 years'))
$$;
create or replace view public.retention_holds with (security_invoker = true) as
  select r.introduction_id, '신고'::text as reason,
         case when bool_and(r.status = 'closed') then max(coalesce(r.handled_at, r.created_at)) + interval '3 years' end as hold_until
    from public.reports r
   where r.introduction_id is not null
   group by r.introduction_id;
revoke all on public.retention_holds from public, anon, authenticated;
revoke all on function public.retention_hold(uuid) from public, anon, authenticated;

-- 어떤 경로로 닫혀도 같은 정리(고른 시간·지역·‘이대로 시작’)
create or replace function public.program_close_cleanup() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.avail_a := null; new.avail_b := null; new.region_a := null; new.region_b := null; new.ready_a := null; new.ready_b := null;
  end if;
  return new;
end $$;
drop trigger if exists programs_close_cleanup on public.programs;
create trigger programs_close_cleanup before update of status on public.programs for each row execute function public.program_close_cleanup();

-- ── C2: 이 파일이 아직 쓰이는지(신청 사진 · 심사 중인 교체 사진 · 열람 중인 소개 사본 · 보낸 편지 사진)
create or replace function public.storage_path_in_use(p_bucket text, p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_bucket
    when 'application-photos' then
      exists (select 1 from public.application_photos ap where ap.path = p_path)
      or exists (select 1 from public.photo_replacements r where r.path = p_path)
      or exists (select 1 from public.introductions i
                  where i.status in ('reserved', 'published', 'mutual') and now() < i.view_until
                    and (i.snapshot_a -> 'photos' @> jsonb_build_array(jsonb_build_object('path', p_path))
                      or i.snapshot_b -> 'photos' @> jsonb_build_array(jsonb_build_object('path', p_path))))
    when 'letter-photos' then public.letter_photo_attached(p_path)
    else false end
$$;
revoke all on function public.storage_path_in_use(text, text) from public, anon, authenticated;

create or replace function public.storage_cleanup_batch(p_limit integer default 200)
returns table (bucket text, path text)
language sql stable security definer set search_path = '' as $$
  select c.bucket, c.path from public.storage_cleanup c
   where not public.storage_path_in_use(c.bucket, c.path)
   order by c.queued_at
   limit p_limit
$$;

-- 지우기 직전 한 번 더: 아직 지워도 되는 경로만 돌려주고, 다시 쓰이게 된 경로는 목록에서 뺀다.
create or replace function public.storage_cleanup_recheck(p_bucket text, p_paths text[]) returns text[]
language plpgsql security definer set search_path = '' as $$
declare keep text[];
begin
  select coalesce(array_agg(x), '{}') into keep from unnest(coalesce(p_paths, '{}')) x where public.storage_path_in_use(p_bucket, x);
  delete from public.storage_cleanup c where c.bucket = p_bucket and c.path = any (keep);
  return coalesce((select array_agg(x) from unnest(coalesce(p_paths, '{}')) x where not (x = any (keep))), '{}');
end $$;
revoke all on function public.storage_cleanup_batch(integer), public.storage_cleanup_recheck(text, text[]) from public, anon, authenticated;
grant execute on function public.storage_cleanup_batch(integer), public.storage_cleanup_recheck(text, text[]) to service_role;

-- ── 교류 보존 정리(매일): 교류 글·복사본 30일 · 약속 90일 · 쓰이지 않는 사진 파일 · 화면 오류 · 미확인 계정
create or replace function public.run_program_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e int; c int; a int; m int; o int; lp int; r int;
begin
  -- 교류 글(편지·첫 장면·엽서·한마디·댓글): 끝난 지 30일(신고 보존 중이면 남김)
  delete from public.program_entries x using public.programs p
   where x.program_id = p.id and p.status = 'closed' and p.closed_at < now() - interval '30 days' and not public.retention_hold(p.introduction_id);
  get diagnostics e = row_count;
  -- 교류 글의 복사본(셋째 날 질문·상대 문장 책갈피)과 한 권 동의도 같은 기준
  update public.programs p set ask_a = null, ask_b = null, mark_a = null, mark_b = null, book_a = null, book_b = null
   where p.status = 'closed' and p.closed_at < now() - interval '30 days'
     and (p.ask_a is not null or p.ask_b is not null or p.mark_a is not null or p.mark_b is not null or p.book_a is not null or p.book_b is not null)
     and not public.retention_hold(p.introduction_id);
  get diagnostics c = row_count;
  -- 약속(날짜·시간·활동·지역·장소): 만난 날(없으면 끝난 날)부터 90일
  delete from public.appointment_proposals x using public.programs p where x.program_id = p.id and p.status = 'closed'
     and coalesce(public.kst_at(p.meeting_on, '00:00'), p.closed_at) < now() - interval '90 days';
  get diagnostics a = row_count;
  update public.programs set meeting_on = null, meeting_time = null
   where status = 'closed' and (meeting_on is not null or meeting_time is not null)
     and coalesce(public.kst_at(meeting_on, '00:00'), closed_at) < now() - interval '90 days';
  get diagnostics m = row_count;
  -- 쓰이지 않는 신청 사진 파일(계정이 없거나, 이틀 지났고 어디에도 쓰이지 않는 것 · 심사 중인 교체 사진은 쓰이는 것)
  insert into public.storage_cleanup (bucket, path)
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'application-photos'
     and (not exists (select 1 from public.profiles pr where pr.id::text = split_part(o.name, '/', 1))
          or (o.created_at < now() - interval '2 days' and not public.storage_path_in_use('application-photos', o.name)
              and not exists (select 1 from public.introductions i where (i.snapshot_a -> 'photos') @> jsonb_build_array(jsonb_build_object('path', o.name)) or (i.snapshot_b -> 'photos') @> jsonb_build_array(jsonb_build_object('path', o.name)))))
  on conflict do nothing;
  get diagnostics o = row_count;
  insert into public.storage_cleanup (bucket, path)
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'letter-photos' and o.created_at < now() - interval '2 days' and not public.letter_photo_attached(o.name)
  on conflict do nothing;
  get diagnostics lp = row_count;
  -- 목록에 들어간 뒤 다시 쓰이게 된 파일(교체 승인 등)은 목록에서 뺀다(계정이 지워진 파일은 그대로 지운다).
  delete from public.storage_cleanup c2
   where public.storage_path_in_use(c2.bucket, c2.path) and exists (select 1 from public.profiles pr where pr.id::text = split_part(c2.path, '/', 1));
  get diagnostics r = row_count;
  delete from auth.users u where u.email_confirmed_at is null and u.created_at < now() - interval '7 days'
     and not exists (select 1 from public.admin_roles ar where ar.user_id = u.id);
  delete from public.client_errors where at < now() - interval '30 days';
  insert into public.job_runs (job, finished_at, ok, detail) values ('program-retention', now(), true,
    jsonb_build_object('entries', e, 'copies', c, 'proposals', a, 'meetings', m, 'orphanPhotos', o, 'letterPhotos', lp, 'released', r));
  return jsonb_build_object('entries', e, 'copies', c, 'proposals', a, 'meetings', m, 'orphanPhotos', o, 'letterPhotos', lp, 'released', r);
end $$;

-- ── 보존 정리(매일)
CREATE OR REPLACE FUNCTION public.run_retention()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare run_id bigint; result jsonb; members int; snapshots int; inquiries int; audits int; notes int; test_payments int; reports int; records int;
begin
  insert into public.job_runs (job) values ('retention') returning id into run_id;
  begin
    -- 탈퇴 계정(매시간 작업과 같은 함수 · 지운 번호는 deletion_log에 남는다)
    members := public.run_withdrawal_deletion();

    -- 상대에게 보였던 사본·궁합·닮은 두 문장·소개 이유: 끝난 지 30일
    with cleared as (
      update public.introductions
         set snapshot_a = jsonb_build_object('deleted', true), snapshot_b = jsonb_build_object('deleted', true), match = null, echo_a = null, echo_b = null,
             note = '보존 기간이 지나 지운 소개 이유예요.'
       where status in ('closed', 'cancelled') and closed_at <= now() - interval '30 days' and not (snapshot_a ? 'deleted')
      returning id)
    select count(*) into snapshots from cleared;
    update public.introductions set match = null where match is not null and snapshot_a ? 'deleted';

    -- 3년: 종결한 신고 → 신고 보존이 끝난 소개·교류 진행 기록(교류·글·약속은 함께 지워진다)
    with old as (delete from public.reports where status = 'closed' and coalesce(handled_at, created_at) <= now() - interval '3 years' returning id)
    select count(*) into reports from old;
    with old as (delete from public.introductions i where i.status in ('closed', 'cancelled') and i.closed_at <= now() - interval '3 years'
                   and not public.retention_hold(i.id) returning id)
    select count(*) into records from old;
    delete from public.member_requests where status = 'decided' and decided_at <= now() - interval '3 years';

    with old as (delete from public.inquiries where status = 'answered' and answered_at <= now() - interval '3 years' returning id)
    select count(*) into inquiries from old;

    -- 테스트 결제(실제로 돈이 오가지 않은 기록)는 90일 뒤 지운다. 실제(라이브) 결제는 법에서 정한 기간 동안 남긴다.
    with old as (delete from public.payments where mode = 'test' and created_at <= now() - interval '90 days' returning id)
    select count(*) into test_payments from old;

    perform set_config('before_us.retention', 'on', true);
    with old as (delete from public.audit_log where at <= now() - interval '365 days' returning id)
    select count(*) into audits from old;
    perform set_config('before_us.retention', 'off', true);

    with old as (delete from public.notifications where read_at <= now() - interval '90 days' returning id)
    select count(*) into notes from old;
    delete from public.reflections where created_at <= now() - interval '1 year';
    delete from public.withdrawal_feedback where created_at <= now() - interval '1 year';
    -- 소개 전 편지: 전해진 소개가 마무리되고 30일이 지나면(다시 읽기 기간과 같게) 지운다. 창가 질문 답은 1년.
    delete from public.prelude_letters l using public.introductions i
     where l.introduction_id = i.id and i.status in ('closed', 'cancelled') and i.closed_at <= now() - interval '30 days';
    delete from public.window_answers where created_at <= now() - interval '1 year';
    -- 그동안 빠져 있던 정리: 기한이 지난 안전 이력 · 메일 대기열 30일 · 닫히고 30일 지난 추천사 링크 · 1년 지난 이번 주 노트 · 지운 계정 기록 35일
    delete from public.safety_holds where expires_at < now();
    delete from public.email_queue where created_at <= now() - interval '30 days';
    delete from public.vouch_links where expires_at < now() - interval '30 days';
    delete from public.weekly_notes where created_at < now() - interval '1 year';
    delete from public.deletion_log where deleted_at < now() - interval '35 days';
    delete from public.job_runs where started_at <= now() - interval '90 days' and id <> run_id;

    result := jsonb_build_object('members', members, 'snapshots', snapshots, 'inquiries', inquiries, 'audits', audits, 'notifications', notes,
      'testPayments', test_payments, 'reports', reports, 'records', records);
    update public.job_runs set finished_at = now(), ok = true, detail = result where id = run_id;
  exception when others then
    result := jsonb_build_object('error', sqlerrm);
    update public.job_runs set finished_at = now(), ok = false, detail = result where id = run_id;
  end;
  return result;
end $function$;
