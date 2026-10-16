-- 비포어스 서버 1단계: 회원 프로필 · 관리자 역할 · 감사 기록 · 예약 작업 기록
-- 원칙
--  - 모든 표는 RLS를 켠다. 회원은 자기 자료만, 운영진은 역할에 맞는 자료만 본다.
--  - 운영진 권한은 2단계 인증(aal2)을 마친 로그인에서만 인정한다.
--  - 상태를 바꾸는 일은 대부분 RPC(서버 함수)로만 한다. 화면이 표를 직접 고치지 않는다.

-- ─────────────────────────────────────────────────────────
-- 회원 프로필 (auth.users 1:1)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  status text not null default 'active' check (status in ('active', 'withdrawal_requested', 'suspended')),
  adult_confirmed_at timestamptz,
  terms_version text,
  terms_agreed_at timestamptz,
  privacy_version text,
  privacy_agreed_at timestamptz,
  marketing_opt_in boolean not null default false,
  notice_new_introduction boolean not null default false,
  notice_daily_waiting boolean not null default false,
  withdrawal_requested_at timestamptz,
  deletion_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- 운영진 역할: owner(대표) · operator(운영) · counselor(상담) · finance(정산)
create table public.admin_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'operator', 'counselor', 'finance')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null
);
alter table public.admin_roles enable row level security;

-- ─────────────────────────────────────────────────────────
-- 권한 도우미
create or replace function public.admin_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.admin_roles where user_id = auth.uid()
$$;

-- 운영진이면서 2단계 인증을 마친 로그인인지. roles를 주면 그 역할만 인정한다.
create or replace function public.is_admin(roles text[] default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
     and exists (
       select 1 from public.admin_roles
       where user_id = auth.uid() and (roles is null or role = any (roles))
     )
$$;

-- 지금 로그인한 회원이 활동 중인지(탈퇴 요청·정지가 아님).
create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active')
$$;

-- ─────────────────────────────────────────────────────────
-- 가입 시 프로필 자동 생성. 화면에서 받은 동의(만 19세·약관·개인정보·마케팅)를 함께 남긴다.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, adult_confirmed_at, terms_version, terms_agreed_at, privacy_version, privacy_agreed_at, marketing_opt_in)
  values (
    new.id,
    lower(new.email),
    case when meta ->> 'adult' = 'true' then now() end,
    meta ->> 'terms_version',
    case when meta ->> 'terms_version' is not null then now() end,
    meta ->> 'privacy_version',
    case when meta ->> 'privacy_version' is not null then now() end,
    coalesce(meta ->> 'marketing' = 'true', false)
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────
-- 감사 기록: 쓰기만 가능하고 고치거나 지울 수 없다(보존 기간이 지난 기록만 정리 작업이 지운다).
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_role text,
  action text not null,
  target text,
  reason text
);
alter table public.audit_log enable row level security;

create or replace function public.audit_log_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('before_us.retention', true) = 'on' then
    return old;
  end if;
  raise exception '감사 기록은 고치거나 지울 수 없어요.';
end $$;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.audit_log_guard();

-- 내부용: 다른 서버 함수가 부른다.
create or replace function public.write_audit(p_action text, p_target text, p_reason text default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, actor_role, action, target, reason)
  values (auth.uid(), coalesce(public.admin_role(), case when auth.uid() is null then 'system' else 'member' end), p_action, p_target, p_reason)
$$;

-- 예약 작업 실행 기록(정오 공개·기한 처리·삭제 예약)
create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  detail jsonb
);
alter table public.job_runs enable row level security;

-- ─────────────────────────────────────────────────────────
-- RLS 정책
create policy "profiles: 본인 조회" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
-- 회원은 알림·마케팅 설정만 직접 바꿀 수 있다(열 단위 권한).
create policy "profiles: 본인 설정 변경" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (marketing_opt_in, notice_new_introduction, notice_daily_waiting) on public.profiles to authenticated;

create policy "admin_roles: 본인 역할 조회" on public.admin_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin(array['owner']));
revoke insert, update, delete on public.admin_roles from anon, authenticated;

create policy "audit_log: 대표만 조회" on public.audit_log for select to authenticated
  using (public.is_admin(array['owner']));
revoke insert, update, delete on public.audit_log from anon, authenticated;

create policy "job_runs: 운영진 조회" on public.job_runs for select to authenticated
  using (public.is_admin());
revoke insert, update, delete on public.job_runs from anon, authenticated;

revoke all on public.profiles, public.admin_roles, public.audit_log, public.job_runs from anon;

-- ─────────────────────────────────────────────────────────
-- 대표가 다른 운영진 역할을 주고 뺀다.
create or replace function public.grant_admin_role(p_email text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if not public.is_admin(array['owner']) then raise exception '대표 권한이 필요해요.'; end if;
  select id into target from public.profiles where email = lower(trim(p_email));
  if target is null then raise exception '먼저 그 이메일로 가입해야 해요.'; end if;
  if p_role is null then
    if target = auth.uid() then raise exception '자기 역할은 뺄 수 없어요.'; end if;
    delete from public.admin_roles where user_id = target;
  else
    insert into public.admin_roles (user_id, role, granted_by) values (target, p_role, auth.uid())
    on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by, granted_at = now();
  end if;
  perform public.write_audit(case when p_role is null then '운영진 역할 회수' else '운영진 역할 부여 · ' || p_role end, target::text);
end $$;

-- 함수 실행 권한: 기본으로 모두에게 열려 있으므로 닫고 필요한 것만 연다.
revoke all on function public.admin_role(), public.is_admin(text[]), public.is_active_member() from public, anon;
grant execute on function public.admin_role(), public.is_admin(text[]), public.is_active_member() to authenticated;
revoke all on function public.handle_new_user(), public.audit_log_guard(), public.write_audit(text, text, text) from public, anon, authenticated;
revoke all on function public.grant_admin_role(text, text) from public, anon;
grant execute on function public.grant_admin_role(text, text) to authenticated;
