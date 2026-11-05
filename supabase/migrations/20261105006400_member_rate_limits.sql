-- 6400: GPT 2차 검수 3.1 — 회원이 반복해 부를 수 있는 접수 함수에 횟수 제한
--
-- 문제: 신고(submit_report · report_partner)와 문의·요청(submit_member_request)은 로그인한 계정이면 횟수 제한 없이 넣을 수 있어,
--       한 계정이 운영진 대시보드(긴급 표시 포함)를 채워 다른 회원의 신고를 묻을 수 있었다. 비회원 문의(submit_inquiry)·화면 오류 기록에는 이미 제한이 있다.
-- 고침: 한 계정당 1시간 5건 · 하루 20건까지. 넘으면 한국어 안내(급한 일은 문의하기 · 이미 받은 건은 운영진이 확인 중).
--       본문·검사 순서는 20261016000400 정의 그대로이고, 제한 확인만 앞에 더했다.

create or replace function public.member_submit_limited(p_member uuid, p_hour int, p_day int) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.reports r where r.reporter_id = p_member and r.source = 'member' and r.created_at > now() - interval '1 hour')
       + (select count(*) from public.member_requests m where m.member_id = p_member and m.created_at > now() - interval '1 hour') >= p_hour
      or (select count(*) from public.reports r where r.reporter_id = p_member and r.source = 'member' and r.created_at > now() - interval '1 day')
       + (select count(*) from public.member_requests m where m.member_id = p_member and m.created_at > now() - interval '1 day') >= p_day
$$;
revoke all on function public.member_submit_limited(uuid, int, int) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_report(p_target uuid, p_type text, p_description text, p_urgent boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); intro uuid; new_id uuid;
begin
  if me is null then raise exception '로그인한 뒤 신고해 주세요.'; end if;
  if public.member_submit_limited(me, 5, 20) then
    raise exception '짧은 시간에 신고·요청이 많이 접수됐어요. 받은 내용은 운영진이 확인하고 있어요. 더 알릴 내용은 잠시 뒤 문의하기로 남겨 주세요.';
  end if;
  if coalesce(trim(p_type), '') = '' then raise exception '신고 유형을 골라 주세요.'; end if;
  if p_target is not null then
    select id into intro from public.introductions
     where status <> 'cancelled' and least(member_a, member_b) = least(me, p_target) and greatest(member_a, member_b) = greatest(me, p_target)
     order by reveal_at desc limit 1;
    if intro is null then raise exception '소개받은 상대만 신고할 수 있어요. 그 밖의 일은 문의하기로 남겨 주세요.'; end if;
  end if;
  insert into public.reports (source, reporter_id, target_id, introduction_id, type, description, urgent)
  values ('member', me, p_target, intro, trim(p_type), nullif(trim(coalesce(p_description, '')), ''), coalesce(p_urgent, false))
  returning id into new_id;
  return new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.submit_member_request(p_kind text, p_description text DEFAULT NULL::text, p_urgent boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception '로그인한 뒤 요청해 주세요.'; end if;
  if p_kind = 'withdrawal' then raise exception '탈퇴는 계정 화면에서 진행해 주세요.'; end if;
  if public.member_submit_limited(auth.uid(), 5, 20) then
    raise exception '짧은 시간에 신고·요청이 많이 접수됐어요. 받은 내용은 운영진이 확인하고 있어요. 더 알릴 내용은 잠시 뒤 문의하기로 남겨 주세요.';
  end if;
  insert into public.member_requests (member_id, kind, description, urgent)
  values (auth.uid(), p_kind, nullif(trim(coalesce(p_description, '')), ''), coalesce(p_urgent, false))
  returning id into new_id;
  return new_id;
end $function$;

revoke all on function public.submit_report(uuid, text, text, boolean), public.submit_member_request(text, text, boolean) from public, anon;
grant execute on function public.submit_report(uuid, text, text, boolean), public.submit_member_request(text, text, boolean) to authenticated;
