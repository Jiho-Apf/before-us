-- 7000: GPT 3차 검수 R3-17 — 횟수 제한이 안전 접근을 막지 않게 · 재시도는 한 건으로 · 비회원 문의 조회 남용 제한
--
-- 문제(6400): 신고와 일반 요청이 한 카운터(1시간 5건·하루 20건)를 함께 써서, 일반 문의를 반복한 회원은 위협·노쇼 신고를 새로 낼 수 없었다.
--       개인정보 권리 행사(삭제·정정·처리 정지·동의 철회 요청)도 같은 제한을 받았다. 응답을 못 받고 다시 누르면 같은 신고가 두 건이 됐다.
--       비회원 문의 조회(find_inquiry)는 제한이 없었다(접수 번호 + 메일을 대입해 볼 수 있음).
-- 고침:
--   · 신고 카운터와 일반 요청 카운터를 나눈다(각각 1시간 5건·하루 20건). 차단·탈퇴는 원래부터 제한 없음(시험으로 확인).
--   · 개인정보 권리 요청(deletion·correction·restriction·revoke)은 제한하지 않는다. 같은 종류의 처리 중 요청이 있으면 그 건에 이어 붙인다(한 건).
--   · 같은 내용을 짧은 시간에 다시 보내면(응답 유실 뒤 재시도) 새로 만들지 않고 같은 번호를 돌려준다(신고 1시간 · 요청 10분).
--   · 같은 상대에 대해 아직 처리 중인 신고가 있으면, 새 신고 대신 그 신고에 ‘보완’으로 붙인다(제한에 세지 않음 · 운영진에게 알림).
--   · 비회원 문의 조회: 틀린 조회를 메일별 1시간 10번 · 전체 10분 300번까지(메일은 해시로만 남기고 하루 뒤 지움). 맞는 조회는 세지 않는다.

alter table public.reports add column if not exists supplements jsonb not null default '[]'::jsonb,
  add column if not exists supplemented_at timestamptz;

create or replace function public.privacy_request_kinds() returns text[]
language sql immutable set search_path = '' as $$ select array['deletion', 'correction', 'restriction', 'revoke'] $$;

-- 일반 요청 카운터(권리 요청·탈퇴 기록은 세지 않음)
create or replace function public.member_submit_limited(p_member uuid, p_hour int, p_day int) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.member_requests m where m.member_id = p_member and m.created_at > now() - interval '1 hour'
            and not (m.kind = any(public.privacy_request_kinds())) and m.kind <> 'withdrawal') >= p_hour
      or (select count(*) from public.member_requests m where m.member_id = p_member and m.created_at > now() - interval '1 day'
            and not (m.kind = any(public.privacy_request_kinds())) and m.kind <> 'withdrawal') >= p_day
$$;
-- 신고 카운터(따로)
create or replace function public.member_report_limited(p_member uuid, p_hour int, p_day int) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.reports r where r.reporter_id = p_member and r.source = 'member' and r.created_at > now() - interval '1 hour') >= p_hour
      or (select count(*) from public.reports r where r.reporter_id = p_member and r.source = 'member' and r.created_at > now() - interval '1 day') >= p_day
$$;
revoke all on function public.member_submit_limited(uuid, int, int), public.member_report_limited(uuid, int, int), public.privacy_request_kinds() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_report(p_target uuid, p_type text, p_description text, p_urgent boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); intro uuid; new_id uuid; clean text := nullif(trim(coalesce(p_description, '')), ''); kind text := trim(coalesce(p_type, '')); open_r public.reports; a uuid;
begin
  if me is null then raise exception '로그인한 뒤 신고해 주세요.'; end if;
  if kind = '' then raise exception '신고 유형을 골라 주세요.'; end if;
  if clean is not null and char_length(clean) > 1000 then raise exception '설명은 1000자 안으로 적어 주세요.'; end if;
  -- 같은 회원의 신고는 한 줄씩 차례로(동시에 두 번 눌러도 한 건)
  perform pg_advisory_xact_lock(7000, hashtext(me::text));
  -- 재시도(응답을 못 받고 다시 보냄): 1시간 안 같은 상대·유형·설명이면 같은 번호
  select r.id into new_id from public.reports r
   where r.reporter_id = me and r.source = 'member' and r.target_id is not distinct from p_target and r.type = kind
     and r.description is not distinct from clean and r.created_at > now() - interval '1 hour'
   order by r.created_at desc limit 1;
  if new_id is not null then return new_id; end if;
  if p_target is not null then
    select id into intro from public.introductions
     where status <> 'cancelled' and least(member_a, member_b) = least(me, p_target) and greatest(member_a, member_b) = greatest(me, p_target)
     order by reveal_at desc limit 1;
    if intro is null then raise exception '소개받은 상대만 신고할 수 있어요. 그 밖의 일은 문의하기로 남겨 주세요.'; end if;
    -- 보완: 같은 상대에 대해 아직 처리 중인 신고가 있으면 그 신고에 붙인다(제한에 세지 않음)
    select * into open_r from public.reports r
     where r.reporter_id = me and r.source = 'member' and r.target_id = p_target and r.status <> 'closed'
     order by r.created_at desc limit 1;
    if open_r.id is not null then
      if jsonb_array_length(open_r.supplements) >= 10 then raise exception '이 신고에는 보완을 더 붙일 수 없어요. 문의하기로 남겨 주세요.'; end if;
      update public.reports set supplements = supplements || jsonb_build_array(jsonb_build_object('at', now(), 'type', kind, 'description', clean, 'urgent', coalesce(p_urgent, false))),
             supplemented_at = now(), urgent = urgent or coalesce(p_urgent, false)
       where id = open_r.id;
      for a in select ar.user_id from public.admin_roles ar join public.profiles p on p.id = ar.user_id where ar.role in ('owner', 'operator') loop
        perform public.notify(a, 'admin-report', '신고에 보완 내용이 붙었어요', '운영진 화면의 신고 목록에서 확인해 주세요.', '/admin',
          'report-supplement:' || open_r.id || ':' || (jsonb_array_length(open_r.supplements) + 1) || ':' || a);
      end loop;
      return open_r.id;
    end if;
  end if;
  if public.member_report_limited(me, 5, 20) then
    raise exception '짧은 시간에 신고가 많이 접수됐어요. 받은 신고는 운영진이 확인하고 있어요. 같은 상대에 대한 내용은 그 신고에 이어 붙어요. 급한 위험은 112에 먼저 알려 주세요.';
  end if;
  insert into public.reports (source, reporter_id, target_id, introduction_id, type, description, urgent)
  values ('member', me, p_target, intro, kind, clean, coalesce(p_urgent, false))
  returning id into new_id;
  return new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.submit_member_request(p_kind text, p_description text DEFAULT NULL::text, p_urgent boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); new_id uuid; clean text := nullif(trim(coalesce(p_description, '')), ''); cur public.member_requests;
begin
  if me is null then raise exception '로그인한 뒤 요청해 주세요.'; end if;
  if p_kind = 'withdrawal' then raise exception '탈퇴는 계정 화면에서 진행해 주세요.'; end if;
  if clean is not null and char_length(clean) > 1000 then raise exception '내용은 1000자 안으로 적어 주세요.'; end if;
  perform pg_advisory_xact_lock(7000, hashtext(me::text));
  -- 재시도: 10분 안 같은 종류·내용이면 같은 번호
  select m.id into new_id from public.member_requests m
   where m.member_id = me and m.kind = p_kind and m.description is not distinct from clean and m.created_at > now() - interval '10 minutes'
   order by m.created_at desc limit 1;
  if new_id is not null then return new_id; end if;
  -- 개인정보 권리 요청: 제한 없음 · 같은 종류의 처리 중 요청이 있으면 그 건에 이어 붙인다
  if p_kind = any(public.privacy_request_kinds()) then
    select * into cur from public.member_requests m where m.member_id = me and m.kind = p_kind and m.status <> 'decided' order by m.created_at desc limit 1;
    if cur.id is not null then
      if clean is not null then
        update public.member_requests set description = left(coalesce(description || E'\n', '') || '추가: ' || clean, 1000), urgent = urgent or coalesce(p_urgent, false)
         where id = cur.id;
      end if;
      return cur.id;
    end if;
  elsif public.member_submit_limited(me, 5, 20) then
    raise exception '짧은 시간에 요청이 많이 접수됐어요. 받은 내용은 운영진이 확인하고 있어요. 신고·차단·탈퇴·개인정보 요청은 제한 없이 할 수 있어요.';
  end if;
  insert into public.member_requests (member_id, kind, description, urgent)
  values (me, p_kind, clean, coalesce(p_urgent, false))
  returning id into new_id;
  return new_id;
end $function$;

revoke all on function public.submit_report(uuid, text, text, boolean), public.submit_member_request(text, text, boolean) from public, anon;
grant execute on function public.submit_report(uuid, text, text, boolean), public.submit_member_request(text, text, boolean) to authenticated;

-- 운영진 신고 목록에 보완 내용 함께(나머지는 기존 정의 그대로)
CREATE OR REPLACE FUNCTION public.admin_list_reports(p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'source', r.source, 'type', r.type, 'description', r.description, 'urgent', r.urgent, 'status', r.status,
      'createdAt', r.created_at, 'resolution', r.resolution, 'handledAt', r.handled_at,
      'supplements', r.supplements, 'supplementedAt', r.supplemented_at,
      'reporter', public.admin_member_brief(r.reporter_id), 'target', public.admin_member_brief(r.target_id),
      'introductionId', r.introduction_id, 'introductionStatus', i.status, 'introductionRevealAt', i.reveal_at,
      'programId', (select g.id from public.programs g where g.introduction_id = r.introduction_id limit 1),
      'programStatus', (select g.status from public.programs g where g.introduction_id = r.introduction_id limit 1)
    ) order by r.status = 'closed', r.urgent desc, coalesce(r.supplemented_at, r.created_at) desc)
    from (select * from public.reports x where p_status is null or x.status = p_status order by x.created_at desc limit 200) r
    left join public.introductions i on i.id = r.introduction_id), '[]'::jsonb);
end $function$;

-- 비회원 문의 조회: 틀린 조회 횟수 제한(메일은 해시로만 · 하루 뒤 지움)
create table if not exists public.inquiry_lookup_failures (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  key_hash text not null
);
alter table public.inquiry_lookup_failures enable row level security;
revoke all on public.inquiry_lookup_failures from anon, authenticated;
create index if not exists inquiry_lookup_failures_key on public.inquiry_lookup_failures (key_hash, at);

CREATE OR REPLACE FUNCTION public.find_inquiry(p_id text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k text := md5('inquiry-lookup:' || lower(trim(coalesce(p_email, '')))); found jsonb;
begin
  delete from public.inquiry_lookup_failures where at < now() - interval '1 day';
  if (select count(*) from public.inquiry_lookup_failures f where f.key_hash = k and f.at > now() - interval '1 hour') >= 10
     or (select count(*) from public.inquiry_lookup_failures f where f.at > now() - interval '10 minutes') >= 300 then
    raise exception '확인 요청이 많아요. 잠시 뒤 다시 시도해 주세요. 접수 번호를 잃어버렸다면 같은 메일로 문의를 새로 남겨 주세요.';
  end if;
  select jsonb_build_object('id', id, 'type', type, 'name', name, 'body', body, 'at', created_at, 'status', status,
                            'answer', case when answer_body is null then null else jsonb_build_object('body', answer_body, 'at', answered_at) end)
    into found
    from public.inquiries
   where id = upper(trim(p_id)) and email = lower(trim(p_email));
  if found is null then insert into public.inquiry_lookup_failures (key_hash) values (k); end if;
  return found;
end $function$;
revoke all on function public.find_inquiry(text, text) from public;
grant execute on function public.find_inquiry(text, text) to anon, authenticated;
