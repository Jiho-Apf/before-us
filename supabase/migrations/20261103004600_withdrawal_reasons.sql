-- 4600: 탈퇴 이유(선택) · 운영진이 보는 탈퇴 이유 모음
--
-- 탈퇴할 때 이유를 여러 개 고르고(선택), 하고 싶은 말을 짧게 남길 수 있다. 어느 단계까지 이용했는지(가입만·신청·승인·소개·서로 선택·교류·약속)를
-- 함께 남겨 어디서 떠나는지 볼 수 있게 한다. 고른 이유와 단계는 계정을 지운 뒤에도 회원과 떼어 1년 보관하고,
-- 직접 적은 말은 계정을 지울 때 함께 지운다(회원을 알아볼 수 있는 내용이 들어 있을 수 있어서).

create or replace function public.withdrawal_reason_list() returns text[]
language sql immutable set search_path = '' as $$
  select array['플라비에서 좋은 분을 만났어요', '다른 곳에서 좋은 분을 만났어요', '소개가 오래 걸려요', '소개받은 분이 잘 맞지 않았어요',
               '과정이 번거로워요', '개인정보가 걱정돼요', '비용이 부담돼요', '잠시 쉬고 싶어요', '그 밖의 이유']
$$;

create table if not exists public.withdrawal_feedback (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.profiles (id) on delete set null,
  reasons text[] not null default '{}',
  note text check (note is null or char_length(note) <= 300),
  stage text not null check (stage in ('signed-up', 'applied', 'approved', 'introduced', 'mutual', 'exchanged', 'met')),
  cohort integer,
  introductions integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.withdrawal_feedback enable row level security;
revoke all on public.withdrawal_feedback from anon, authenticated;

-- 계정을 지우면(회원 연결이 끊기면) 직접 적은 말도 지운다.
create or replace function public.clear_withdrawal_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.member_id is null then new.note := null; end if;
  return new;
end $$;
drop trigger if exists withdrawal_feedback_clear_note on public.withdrawal_feedback;
create trigger withdrawal_feedback_clear_note before update of member_id on public.withdrawal_feedback
  for each row execute function public.clear_withdrawal_note();
revoke all on function public.clear_withdrawal_note() from public, anon, authenticated;

drop function if exists public.request_withdrawal();
create function public.request_withdrawal(p_reasons text[] default '{}', p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); due timestamptz := now() + interval '7 days'; r record; picked text[]; clean text; reached text; summary text;
begin
  if me is null then raise exception '로그인한 뒤 진행해 주세요.'; end if;
  picked := array(select distinct x from unnest(coalesce(p_reasons, '{}')) x where x is not null);
  if exists (select 1 from unnest(picked) x where not (x = any(public.withdrawal_reason_list()))) then raise exception '탈퇴 이유를 다시 골라 주세요.'; end if;
  clean := nullif(trim(coalesce(p_note, '')), '');
  if clean is not null and char_length(clean) > 300 then raise exception '하고 싶은 말은 300자 안으로 적어 주세요.'; end if;
  -- 어디까지 이용했는지(소개를 닫기 전에 센다)
  reached := case
    when exists (select 1 from public.programs pr where me in (pr.member_a, pr.member_b) and pr.meeting_on is not null) then 'met'
    when exists (select 1 from public.programs pr where me in (pr.member_a, pr.member_b) and pr.started_at is not null) then 'exchanged'
    when exists (select 1 from public.introductions i where me in (i.member_a, i.member_b) and i.mutual_at is not null) then 'mutual'
    when exists (select 1 from public.introductions i where me in (i.member_a, i.member_b) and i.published_at is not null) then 'introduced'
    when exists (select 1 from public.applications a where a.member_id = me and a.status = 'approved') then 'approved'
    when exists (select 1 from public.applications a where a.member_id = me and a.status <> 'draft') then 'applied'
    else 'signed-up' end;
  update public.profiles set status = 'withdrawal_requested', withdrawal_requested_at = now(), deletion_due_at = due, updated_at = now()
   where id = me and status <> 'withdrawal_requested';
  if not found then raise exception '이미 탈퇴를 요청한 계정이에요.'; end if;
  insert into public.withdrawal_feedback (member_id, reasons, note, stage, cohort, introductions)
  values (me, picked, clean, reached, (select a.cohort_number from public.applications a where a.member_id = me),
          (select count(*)::int from public.introductions i where me in (i.member_a, i.member_b) and i.published_at is not null));
  for r in select id from public.introductions where me in (member_a, member_b) and status in ('reserved', 'published', 'mutual') loop
    perform public.close_introduction(r.id, 'withdrawn', me);
    perform public.notify_intro_ended(r.id);
  end loop;
  summary := '계정 화면에서 탈퇴 요청' || case when cardinality(picked) > 0 then ' · 이유: ' || array_to_string(picked, ', ') else '' end;
  insert into public.member_requests (member_id, kind, description, status) values (me, 'withdrawal', summary, 'checking');
  perform public.write_audit('탈퇴 요청', me::text);
  return jsonb_build_object('deletionDueAt', due);
end $$;
revoke all on function public.request_withdrawal(text[], text) from public, anon;
grant execute on function public.request_withdrawal(text[], text) to authenticated;

-- 운영진: 최근 탈퇴 이유(이유별 수 · 단계별 수 · 최근 기록). 계정이 남아 있으면 이름도 함께.
create or replace function public.admin_withdrawal_feedback(p_days integer default 90) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 365)));
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  return jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 90), 365)),
    'total', (select count(*) from public.withdrawal_feedback f where f.created_at >= since),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('reason', x.reason, 'count', x.n) order by x.n desc, x.reason)
                 from (select r.reason, count(*)::int n from public.withdrawal_feedback f, unnest(f.reasons) r(reason) where f.created_at >= since group by r.reason) x), '[]'::jsonb),
    'stages', coalesce((select jsonb_object_agg(x.stage, x.n) from (select f.stage, count(*)::int n from public.withdrawal_feedback f where f.created_at >= since group by f.stage) x), '{}'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                 'createdAt', f.created_at, 'reasons', to_jsonb(f.reasons), 'note', f.note, 'stage', f.stage, 'cohort', f.cohort,
                 'introductions', f.introductions, 'memberId', f.member_id, 'name', a.draft -> 'values' ->> 'self.name') order by f.created_at desc)
               from (select * from public.withdrawal_feedback f where f.created_at >= since order by f.created_at desc limit 100) f
               left join public.applications a on a.member_id = f.member_id), '[]'::jsonb));
end $$;
revoke all on function public.admin_withdrawal_feedback(integer) from public, anon;
grant execute on function public.admin_withdrawal_feedback(integer) to authenticated;

-- 보존 정리: 탈퇴 이유는 1년이 지나면 지운다.
CREATE OR REPLACE FUNCTION public.run_retention()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare run_id bigint; result jsonb; members int; snapshots int; inquiries int; audits int; notes int; test_payments int;
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
         set snapshot_a = jsonb_build_object('deleted', true), snapshot_b = jsonb_build_object('deleted', true), match = null
       where status in ('closed', 'cancelled') and closed_at <= now() - interval '30 days' and not (snapshot_a ? 'deleted')
      returning id)
    select count(*) into snapshots from cleared;
    -- 예전에 사본만 지워지고 궁합이 남은 소개도 함께 정리한다.
    update public.introductions set match = null where match is not null and snapshot_a ? 'deleted';

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
    delete from public.job_runs where started_at <= now() - interval '90 days' and id <> run_id;

    result := jsonb_build_object('members', members, 'snapshots', snapshots, 'inquiries', inquiries, 'audits', audits, 'notifications', notes, 'testPayments', test_payments);
    update public.job_runs set finished_at = now(), ok = true, detail = result where id = run_id;
  exception when others then
    result := jsonb_build_object('error', sqlerrm);
    update public.job_runs set finished_at = now(), ok = false, detail = result where id = run_id;
  end;
  return result;
end $function$;
