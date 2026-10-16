-- 비포어스 서버 6단계: 고객 문의 · 신고 · 회원 요청 · 탈퇴

-- ─────────────────────────────────────────────────────────
-- 고객 문의(V6-inquiry-01). 회원·비회원 모두 남길 수 있고, 접수 번호 + 이메일로 확인한다.
create table public.inquiries (
  id text primary key,
  user_id uuid references public.profiles (id) on delete set null,
  type text not null check (type in ('서비스 이용 방법', '신청·검토', '소개·교류', '결제·환불', '개인정보·탈퇴', '안전·신고', '제휴·기타')),
  name text not null default '' check (char_length(name) <= 20),
  email text not null,
  body text not null check (char_length(body) between 10 and 1000),
  status text not null default 'received' check (status in ('received', 'checking', 'answered')),
  answer_body text check (answer_body is null or char_length(answer_body) between 5 and 1500),
  answered_at timestamptz,
  consent_at timestamptz not null,
  policy_version text not null,
  created_at timestamptz not null default now()
);
alter table public.inquiries enable row level security;
create index inquiries_email on public.inquiries (email, created_at desc);

create or replace function public.submit_inquiry(p_type text, p_name text, p_email text, p_body text, p_consent boolean, p_website text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(p_email)); v_body text := trim(p_body); nm text := trim(coalesce(p_name, '')); new_id text;
begin
  if coalesce(p_website, '') <> '' then return jsonb_build_object('error', '요청을 처리할 수 없어요.'); end if;
  if p_type not in ('서비스 이용 방법', '신청·검토', '소개·교류', '결제·환불', '개인정보·탈퇴', '안전·신고', '제휴·기타') then return jsonb_build_object('error', '문의 유형을 골라 주세요.'); end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then return jsonb_build_object('error', '답변받을 이메일 주소를 확인해 주세요.'); end if;
  if char_length(nm) > 20 then return jsonb_build_object('error', '부르실 이름은 20자 이하로 적어 주세요.'); end if;
  if char_length(v_body) < 10 or char_length(v_body) > 1000 then return jsonb_build_object('error', '문의 내용은 10~1000자로 적어 주세요.'); end if;
  if v_body ~ '\d{6}\s?-\s?[1-4]\d{6}' or v_body ~ '\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}' then
    return jsonb_build_object('error', '주민등록번호나 카드번호는 적지 말아 주세요. 필요한 경우 운영진이 안전한 방법으로 따로 확인해요.');
  end if;
  if not coalesce(p_consent, false) then return jsonb_build_object('error', '문의 응대를 위한 개인정보 수집·이용에 동의해 주세요.'); end if;
  if exists (select 1 from public.inquiries i where i.email = v_email and i.body = v_body and i.created_at > now() - interval '10 minutes') then
    return jsonb_build_object('error', '같은 문의가 방금 접수됐어요. 잠시 후 접수 번호로 진행 상태를 확인해 주세요.');
  end if;
  if (select count(*) from public.inquiries i where i.email = v_email and i.created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.inquiries i where i.created_at > now() - interval '10 minutes') >= 60 then
    return jsonb_build_object('error', '짧은 시간에 문의가 많이 접수됐어요. 잠시 후 다시 남겨 주세요.');
  end if;
  -- 접수 번호: 날짜 + 임의 8자리(순번이면 이메일만 알아도 남의 문의를 찾아볼 수 있어서).
  new_id := 'Q-' || to_char(now() at time zone 'Asia/Seoul', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.inquiries (id, user_id, type, name, email, body, consent_at, policy_version)
  values (new_id, auth.uid(), p_type, nm, v_email, v_body, now(), 'V6-inquiry-01');
  return jsonb_build_object('id', new_id);
end $$;

-- 접수 번호와 이메일이 모두 맞을 때만 보여 준다.
create or replace function public.find_inquiry(p_id text, p_email text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'type', type, 'name', name, 'body', body, 'at', created_at, 'status', status,
                            'answer', case when answer_body is null then null else jsonb_build_object('body', answer_body, 'at', answered_at) end)
    from public.inquiries
   where id = upper(trim(p_id)) and email = lower(trim(p_email))
$$;

create or replace function public.admin_inquiry_status(p_id text, p_answer text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  select status into st from public.inquiries where id = p_id for update;
  if st is null then raise exception '문의를 찾을 수 없어요.'; end if;
  if p_answer is null then
    if st <> 'received' then raise exception '접수 상태의 문의만 확인 중으로 바꿀 수 있어요.'; end if;
    update public.inquiries set status = 'checking' where id = p_id;
    perform public.write_audit('문의 확인 시작', p_id, '본문·이메일 미기록');
  else
    if char_length(trim(p_answer)) < 5 or char_length(p_answer) > 1500 then raise exception '답변은 5~1500자로 적어 주세요.'; end if;
    if p_answer ~ '\d{6}\s?-\s?[1-4]\d{6}' or p_answer ~ '\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}' then raise exception '답변에 주민등록번호·카드번호를 넣을 수 없어요.'; end if;
    update public.inquiries set status = 'answered', answer_body = trim(p_answer), answered_at = now() where id = p_id;
    perform public.write_audit(case when st = 'answered' then '문의 답변 수정' else '문의 답변 기록' end, p_id, '본문·이메일 미기록');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────
-- 신고(회원 신고 + 편지 안전 검사의 자동 감지)
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('member', 'auto')),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_id uuid references public.profiles (id) on delete set null,
  introduction_id uuid references public.introductions (id) on delete set null,
  type text not null,
  description text check (description is null or char_length(description) <= 1000),
  urgent boolean not null default false,
  status text not null default 'new' check (status in ('new', 'reviewing', 'checking', 'action', 'closed')),
  resolution text,
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;

create or replace function public.submit_report(p_target uuid, p_type text, p_description text, p_urgent boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); intro uuid; new_id uuid;
begin
  if me is null then raise exception '로그인한 뒤 신고해 주세요.'; end if;
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
end $$;

-- 편지·답장의 연락처·금전 표현 자동 감지(원문은 남기지 않는다). 교류 단계의 서버 검사에서 부른다.
create or replace function public.flag_member_text(p_member uuid, p_where text, p_type text) returns void
language sql security definer set search_path = '' as $$
  insert into public.reports (source, target_id, type, description, urgent)
  select 'auto', p_member, p_type, p_where || '에서 감지 · 원문은 신고 확인 뒤에만 열람', p_type like '금전%'
   where not exists (select 1 from public.reports where source = 'auto' and target_id = p_member and type = p_type and description like p_where || '에서 감지%')
$$;

create or replace function public.admin_update_report(p_id uuid, p_status text, p_resolution text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  if p_status not in ('reviewing', 'checking', 'action', 'closed') then raise exception '상태 값을 확인해 주세요.'; end if;
  update public.reports set status = p_status, resolution = coalesce(nullif(trim(coalesce(p_resolution, '')), ''), resolution), handled_by = auth.uid(), handled_at = now() where id = p_id;
  if not found then raise exception '신고를 찾을 수 없어요.'; end if;
  perform public.write_audit('신고 처리 · ' || p_status, p_id::text);
end $$;

-- ─────────────────────────────────────────────────────────
-- 회원 요청(일시정지·재개·환불·정정·삭제·처리정지·재검토 등)
create table public.member_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('pause', 'resume', 'refund', 'inquiry', 'report', 'block', 'interrupt', 'revoke', 'withdrawal', 'deletion', 'correction', 'restriction', 'reconsider')),
  description text check (description is null or char_length(description) <= 1000),
  urgent boolean not null default false,
  status text not null default 'requested' check (status in ('requested', 'protection', 'checking', 'decided', 'reconsidering')),
  decision text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.member_requests enable row level security;

create or replace function public.submit_member_request(p_kind text, p_description text default null, p_urgent boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception '로그인한 뒤 요청해 주세요.'; end if;
  if p_kind = 'withdrawal' then raise exception '탈퇴는 계정 화면에서 진행해 주세요.'; end if;
  insert into public.member_requests (member_id, kind, description, urgent)
  values (auth.uid(), p_kind, nullif(trim(coalesce(p_description, '')), ''), coalesce(p_urgent, false))
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.admin_decide_request(p_id uuid, p_status text, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  if p_status not in ('protection', 'checking', 'decided', 'reconsidering') then raise exception '상태 값을 확인해 주세요.'; end if;
  update public.member_requests set status = p_status, decision = nullif(trim(coalesce(p_decision, '')), ''), decided_by = auth.uid(), decided_at = now() where id = p_id;
  if not found then raise exception '요청을 찾을 수 없어요.'; end if;
  perform public.write_audit('회원 요청 처리 · ' || p_status, p_id::text);
end $$;

-- ─────────────────────────────────────────────────────────
-- 탈퇴: (화면에서 비밀번호를 다시 확인한 뒤) 탈퇴 요청을 기록한다.
-- 상대 노출·알림은 바로 멈추고, 자료는 7일 뒤 삭제 작업이 지운다.
create or replace function public.request_withdrawal() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); due timestamptz := now() + interval '7 days'; r record;
begin
  if me is null then raise exception '로그인한 뒤 진행해 주세요.'; end if;
  update public.profiles set status = 'withdrawal_requested', withdrawal_requested_at = now(), deletion_due_at = due, updated_at = now()
   where id = me and status <> 'withdrawal_requested';
  if not found then raise exception '이미 탈퇴를 요청한 계정이에요.'; end if;
  for r in select id from public.introductions where me in (member_a, member_b) and status in ('reserved', 'published', 'mutual') loop
    perform public.close_introduction(r.id, 'withdrawn');
  end loop;
  insert into public.member_requests (member_id, kind, description, status) values (me, 'withdrawal', '계정 화면에서 탈퇴 요청', 'checking');
  perform public.write_audit('탈퇴 요청', me::text);
  return jsonb_build_object('deletionDueAt', due);
end $$;

-- ─────────────────────────────────────────────────────────
-- RLS
create policy "inquiries: 운영진 조회" on public.inquiries for select to authenticated using (public.is_admin(array['owner','operator','counselor']));
create policy "reports: 본인 신고·운영진 조회" on public.reports for select to authenticated using (reporter_id = auth.uid() or public.is_admin(array['owner','operator','counselor']));
create policy "member_requests: 본인·운영진 조회" on public.member_requests for select to authenticated using (member_id = auth.uid() or public.is_admin(array['owner','operator','counselor','finance']));
revoke insert, update, delete on public.inquiries, public.reports, public.member_requests from anon, authenticated;
revoke all on public.inquiries, public.reports, public.member_requests from anon;

revoke all on function public.flag_member_text(uuid, text, text) from public, anon, authenticated;
revoke all on function public.submit_inquiry(text, text, text, text, boolean, text), public.find_inquiry(text, text) from public;
grant execute on function public.submit_inquiry(text, text, text, text, boolean, text), public.find_inquiry(text, text) to anon, authenticated;
revoke all on function public.admin_inquiry_status(text, text), public.submit_report(uuid, text, text, boolean), public.admin_update_report(uuid, text, text),
  public.submit_member_request(text, text, boolean), public.admin_decide_request(uuid, text, text), public.request_withdrawal() from public, anon;
grant execute on function public.admin_inquiry_status(text, text), public.submit_report(uuid, text, text, boolean), public.admin_update_report(uuid, text, text),
  public.submit_member_request(text, text, boolean), public.admin_decide_request(uuid, text, text), public.request_withdrawal() to authenticated;

-- ─────────────────────────────────────────────────────────
-- 두 사람 화면에서 쓰는 차단·신고: 회원은 상대의 회원 번호를 모르므로 소개 번호로 상대를 찾는다.
create or replace function public.partner_of(p_introduction uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case when member_a = auth.uid() then member_b when member_b = auth.uid() then member_a end
    from public.introductions where id = p_introduction and status <> 'cancelled' and reveal_at <= now()
$$;

create or replace function public.block_partner(p_introduction uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare target uuid := public.partner_of(p_introduction);
begin
  if target is null then raise exception '소개를 찾을 수 없어요.'; end if;
  perform public.block_member(target);
end $$;

create or replace function public.report_partner(p_introduction uuid, p_type text, p_description text, p_urgent boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target uuid := public.partner_of(p_introduction);
begin
  if target is null then raise exception '소개를 찾을 수 없어요.'; end if;
  return public.submit_report(target, p_type, p_description, p_urgent);
end $$;

revoke all on function public.partner_of(uuid) from public, anon, authenticated;
revoke all on function public.block_partner(uuid), public.report_partner(uuid, text, text, boolean) from public, anon;
grant execute on function public.block_partner(uuid), public.report_partner(uuid, text, text, boolean) to authenticated;
