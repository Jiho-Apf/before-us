-- 결제(2026-10-29) · 테스트 모드부터
--  - 사업자등록 전이라 테스트 결제만 한다(토스페이먼츠 테스트 키 · 승인돼도 실제로 돈이 나가지 않는다).
--  - 베타 흐름(신청·소개·교류)은 결제와 무관하다. 이 표를 읽는 다른 서버 함수는 없고, 결제해도 소개·교류 상태는 바뀌지 않는다.
--  - 금액·모드는 서버가 정한다(payment_config 한 곳). 화면이 보낸 금액은 쓰지 않는다.
--    src/app/config.ts 의 pricing.introduction · pricing.exchangePerPerson · payments.mode 와 같이 바꾼다(db.test.mjs 가 둘을 비교한다).
--  - PG(토스페이먼츠)에 맞춘 부분은 edge function(payments-confirm · payments-cancel · _shared/toss.ts)과 src/app/backend/payments.ts 에만 둔다.
--    이 표와 함수는 PG를 바꿔도(예: 포트원) 그대로 쓴다.
--  - 쓰기: 회원은 주문 만들기(create_payment_order)와 결제창 실패 표시(mark_payment_failed)만 한다.
--    승인·실패·취소 결과는 service_role 만 남긴다(record_payment_result · edge function이 부른다).

-- ─────────────────────────────────────────────────────────
-- 결제 기록(주문 1건 = 결제 시도 1번). 탈퇴로 회원이 지워져도 거래 기록은 남긴다(member_id 만 비운다).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('introduction', 'exchange')),
  program_id uuid references public.programs (id) on delete set null,
  order_id text not null unique check (order_id ~ '^[A-Za-z0-9_=-]{6,64}$'),
  amount int not null check (amount > 0),
  order_name text not null,
  status text not null default 'ready' check (status in ('ready', 'paid', 'failed', 'cancelled')),
  provider text not null,
  mode text not null check (mode in ('test', 'live')),
  payment_key text unique,
  method text,
  approved_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  failure_code text,
  failure_message text,
  -- PG 응답에서 필요한 값만 추려 둔다(카드 번호·승인 번호 같은 값은 edge function이 빼고 보낸다).
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'introduction' and program_id is null or kind = 'exchange')
);
create index payments_member_idx on public.payments (member_id, created_at desc);
-- 같은 것을 두 번 결제하지 않게: 소개비는 회원당 결제 완료 1건, 교류비는 교류마다 1건(취소된 결제는 빼고).
create unique index payments_one_paid_introduction on public.payments (member_id) where kind = 'introduction' and status = 'paid';
create unique index payments_one_paid_exchange on public.payments (member_id, program_id) where kind = 'exchange' and status = 'paid';
alter table public.payments enable row level security;
create policy "payments: 본인 조회" on public.payments for select to authenticated
  using (member_id = auth.uid());
revoke insert, update, delete on public.payments from anon, authenticated;
revoke all on public.payments from anon;

-- PG에 넘기는 구매자 식별 값(customerKey). 이메일·회원 번호처럼 짐작할 수 있는 값을 쓰지 않으려고 따로 무작위로 만든다.
-- 토스 규칙: 영문·숫자·-_=.@ 중 하나 이상을 포함한 10~50자(BU_ + 32자리).
create table public.payment_customers (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  customer_key text not null unique default ('BU_' || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz not null default now()
);
alter table public.payment_customers enable row level security;
revoke all on public.payment_customers from anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- 결제 설정 한 곳: PG·모드·금액·주문 이름. config.ts 와 같이 바꾼다.
-- 정식(라이브)으로 바꿀 때는 새 마이그레이션에서 이 함수의 mode 를 'live' 로 바꾸고, TOSS_SECRET_KEY(라이브 키)를 비밀 값으로 넣는다.
create or replace function public.payment_config() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'provider', 'toss', 'mode', 'test', 'currency', 'KRW',
    'introduction', 10000, 'exchange', 29000,
    'introductionName', '비포어스 소개비', 'exchangeName', '비포어스 교류비')
$$;

-- 지금도 결제할 수 있는 주문인지(주문을 만든 뒤 신청 상태나 교류 단계가 바뀌었을 수 있다).
--  소개비: 신청서가 승인된 이용 중 회원 · 교류비: 그 교류의 두 사람 중 하나이고 교류가 시작 전(방식·시작일 맞추는 중 또는 시작 전)
create or replace function public.payment_eligible(p_member uuid, p_kind text, p_program uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = p_member and status = 'active')
     and case p_kind
       when 'introduction' then p_program is null and exists (select 1 from public.applications where member_id = p_member and status = 'approved')
       when 'exchange' then exists (select 1 from public.programs where id = p_program and p_member in (member_a, member_b) and status in ('choosing', 'scheduled'))
       else false end
$$;

-- 회원·edge function에 돌려줄 결제 한 건의 모양
create or replace function public.payment_json(p public.payments) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'orderId', p.order_id, 'kind', p.kind, 'programId', p.program_id, 'amount', p.amount, 'orderName', p.order_name,
    'status', p.status, 'provider', p.provider, 'mode', p.mode, 'method', p.method, 'approvedAt', p.approved_at,
    'cancelledAt', p.cancelled_at, 'cancelReason', p.cancel_reason, 'failureCode', p.failure_code, 'failureMessage', p.failure_message,
    'createdAt', p.created_at)
$$;

-- ─────────────────────────────────────────────────────────
-- 회원: 주문 만들기. 금액은 서버 설정에서만 정한다. 결제창은 이 주문 번호·금액으로 연다.
create or replace function public.create_payment_order(p_kind text, p_program uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); cfg jsonb := public.payment_config(); st text; prog_status text;
  v_amount int; v_name text; v_key text; v_order text; recent int;
begin
  if me is null or not public.is_active_member() then raise exception '로그인한 회원만 결제할 수 있어요.'; end if;
  if p_kind = 'introduction' then
    if p_program is not null then raise exception '소개비에는 교류를 고르지 않아요.'; end if;
    select status into st from public.applications where member_id = me;
    if st is distinct from 'approved' then raise exception '신청서가 승인된 뒤에 소개비를 낼 수 있어요.'; end if;
    v_amount := (cfg ->> 'introduction')::int; v_name := cfg ->> 'introductionName';
  elsif p_kind = 'exchange' then
    select status into prog_status from public.programs where id = p_program and me in (member_a, member_b);
    if prog_status is null then raise exception '교류를 찾을 수 없어요.'; end if;
    if prog_status not in ('choosing', 'scheduled') then raise exception '교류비는 3일 교류를 시작하기 전에만 낼 수 있어요.'; end if;
    v_amount := (cfg ->> 'exchange')::int; v_name := cfg ->> 'exchangeName';
  else
    raise exception '결제 종류를 알 수 없어요.';
  end if;
  if exists (select 1 from public.payments where member_id = me and kind = p_kind and program_id is not distinct from p_program and status = 'paid') then
    raise exception '이미 결제했어요. 결제 내역에서 확인해 주세요.';
  end if;
  select count(*) into recent from public.payments where member_id = me and created_at > now() - interval '1 day';
  if recent >= 20 then raise exception '오늘은 결제 시도가 너무 많아요. 내일 다시 시도해 주세요.'; end if;
  insert into public.payment_customers (member_id) values (me) on conflict (member_id) do nothing;
  select customer_key into v_key from public.payment_customers where member_id = me;
  -- 주문 번호: 토스 규칙(영문·숫자·-_= 6~64자). BUI-(소개비) · BUE-(교류비) + 무작위 32자리
  v_order := case p_kind when 'introduction' then 'BUI-' else 'BUE-' end || replace(gen_random_uuid()::text, '-', '');
  if cfg ->> 'mode' = 'test' then v_name := '[테스트] ' || v_name; end if;
  insert into public.payments (member_id, kind, program_id, order_id, amount, order_name, provider, mode)
  values (me, p_kind, p_program, v_order, v_amount, v_name, cfg ->> 'provider', cfg ->> 'mode');
  return jsonb_build_object('orderId', v_order, 'amount', v_amount, 'orderName', v_name, 'customerKey', v_key,
    'kind', p_kind, 'programId', p_program, 'mode', cfg ->> 'mode', 'provider', cfg ->> 'provider');
end $$;

-- 회원(edge function이 회원 로그인 토큰으로 부른다): 승인 전에 내 주문인지·금액·중복·지금도 결제할 수 있는지 확인한다.
create or replace function public.my_payment_order(p_order_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.payments;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.'; end if;
  select * into p from public.payments where order_id = p_order_id and member_id = auth.uid();
  if p.id is null then raise exception '주문을 찾을 수 없어요.'; end if;
  return public.payment_json(p) || jsonb_build_object(
    'paymentKey', p.payment_key,
    'duplicate', p.status <> 'paid' and exists (select 1 from public.payments o where o.member_id = p.member_id and o.kind = p.kind
                   and o.program_id is not distinct from p.program_id and o.status = 'paid' and o.id <> p.id),
    'eligible', public.payment_eligible(p.member_id, p.kind, p.program_id));
end $$;

-- 회원: 결제창에서 실패·취소로 돌아왔을 때 결제 전 주문을 실패로 표시한다(돈이 나가지 않은 주문만).
create or replace function public.mark_payment_failed(p_order_id text, p_code text, p_message text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.'; end if;
  update public.payments
     set status = 'failed', failure_code = left(nullif(trim(p_code), ''), 80), failure_message = left(nullif(trim(p_message), ''), 300), updated_at = now()
   where order_id = p_order_id and member_id = auth.uid() and status = 'ready';
end $$;

-- ─────────────────────────────────────────────────────────
-- service_role 전용(edge function): PG 승인·실패·취소 결과를 남긴다. 같은 결과를 다시 보내도 한 번만 바뀐다.
--  p_status 'paid'      : 결제 전·실패 → 결제 완료. 이미 같은 결제 키로 완료면 그대로 돌려준다.
--                         같은 항목의 다른 결제 완료가 있으면 '중복 결제' 오류(edge function이 PG에서 바로 취소한다).
--  p_status 'failed'    : 결제 전 → 실패(p_code · p_message). 완료·취소된 결제는 실패로 되돌리지 않는다.
--  p_status 'cancelled' : 결제 완료(또는 중복으로 바로 취소한 결제 전 주문) → 취소. p_message 는 취소 이유.
create or replace function public.record_payment_result(p_order_id text, p_status text, p_payment_key text default null, p_method text default null,
  p_at timestamptz default null, p_code text default null, p_message text default null, p_raw jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.payments;
begin
  if p_status is null or p_status not in ('paid', 'failed', 'cancelled') then raise exception '결과 상태를 알 수 없어요.'; end if;
  select * into p from public.payments where order_id = p_order_id for update;
  if p.id is null then raise exception '주문을 찾을 수 없어요.'; end if;
  if p_status = 'paid' then
    if p.status = 'paid' then
      if p.payment_key is distinct from p_payment_key then raise exception '이미 다른 결제로 끝난 주문이에요.'; end if;
      return public.payment_json(p);
    end if;
    if p.status = 'cancelled' then raise exception '취소된 주문이에요.'; end if;
    if coalesce(trim(p_payment_key), '') = '' then raise exception '결제 키가 없어요.'; end if;
    if exists (select 1 from public.payments o where o.member_id = p.member_id and o.kind = p.kind and o.program_id is not distinct from p.program_id
                and o.status = 'paid' and o.id <> p.id) then
      raise exception '이미 결제한 항목이에요(중복 결제).';
    end if;
    update public.payments
       set status = 'paid', payment_key = p_payment_key, method = left(p_method, 40), approved_at = coalesce(p_at, now()),
           failure_code = null, failure_message = null, raw = coalesce(raw, '{}'::jsonb) || coalesce(p_raw, '{}'::jsonb), updated_at = now()
     where id = p.id returning * into p;
  elsif p_status = 'failed' then
    if p.status in ('paid', 'cancelled') then return public.payment_json(p); end if;
    update public.payments
       set status = 'failed', failure_code = left(nullif(trim(p_code), ''), 80), failure_message = left(nullif(trim(p_message), ''), 300),
           raw = coalesce(raw, '{}'::jsonb) || coalesce(p_raw, '{}'::jsonb), updated_at = now()
     where id = p.id returning * into p;
  else
    if p.status = 'cancelled' then return public.payment_json(p); end if;
    if p.status <> 'paid' and coalesce(trim(p_payment_key), '') = '' then raise exception '결제되지 않은 주문은 취소할 수 없어요.'; end if;
    update public.payments
       set status = 'cancelled', payment_key = coalesce(payment_key, p_payment_key), cancelled_at = coalesce(p_at, now()),
           cancel_reason = left(nullif(trim(p_message), ''), 200), raw = coalesce(raw, '{}'::jsonb) || coalesce(p_raw, '{}'::jsonb), updated_at = now()
     where id = p.id returning * into p;
  end if;
  return public.payment_json(p);
end $$;

-- ─────────────────────────────────────────────────────────
-- 운영진: 결제 목록(대표·운영·정산 + 2단계 인증). p_status 를 비우면 결제 전(ready)을 뺀 전부, 최근 300건.
create or replace function public.admin_list_payments(p_status text default null, p_mode text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator','finance']) then raise exception '결제 내역은 대표·운영·정산 권한만 볼 수 있어요.'; end if;
  return coalesce((select jsonb_agg(x.row order by x.created_at desc) from (
    select p.created_at, public.payment_json(p) || jsonb_build_object(
      'memberId', p.member_id, 'email', pr.email, 'name', a.draft -> 'values' ->> 'self.name') as row
      from public.payments p
      left join public.profiles pr on pr.id = p.member_id
      left join public.applications a on a.member_id = p.member_id
     where (case when p_status is null then p.status <> 'ready' else p.status = p_status end)
       and (p_mode is null or p.mode = p_mode)
     order by p.created_at desc limit 300) x), '[]'::jsonb);
end $$;

-- 운영진: 테스트 결제 취소 시작(대표·운영 + 2단계 인증). payments-cancel edge function이 운영진 로그인 토큰으로 부른다.
-- 권한·상태를 확인하고 감사 기록을 남긴 뒤, PG 취소에 필요한 값을 돌려준다(취소 결과는 edge function이 record_payment_result 로 남긴다).
-- 실제(라이브) 결제의 환불은 환불 기준에 따라 따로 처리하므로 여기서는 테스트 결제만 취소한다.
create or replace function public.admin_begin_payment_cancel(p_payment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.payments; reason text := trim(coalesce(p_reason, ''));
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if reason = '' then raise exception '취소하는 이유를 적어 주세요(감사 기록에 남아요).'; end if;
  if length(reason) > 200 then raise exception '취소 이유는 200자 안으로 적어 주세요.'; end if;
  select * into p from public.payments where id = p_payment;
  if p.id is null then raise exception '결제를 찾을 수 없어요.'; end if;
  if p.mode <> 'test' then raise exception '여기서는 테스트 결제만 취소할 수 있어요. 실제 결제 환불은 환불 기준에 따라 따로 처리해요.'; end if;
  if p.status <> 'paid' then raise exception '결제 완료된 것만 취소할 수 있어요.'; end if;
  perform public.write_audit('테스트 결제 취소 요청', p.order_id, reason);
  return jsonb_build_object('orderId', p.order_id, 'paymentKey', p.payment_key, 'amount', p.amount, 'mode', p.mode, 'provider', p.provider, 'reason', reason);
end $$;

-- ─────────────────────────────────────────────────────────
-- 함수 실행 권한: 내부 도우미는 닫고, 결과 기록은 service_role 만, 회원·운영진 함수는 로그인한 사람에게 열고 함수 안에서 확인한다.
revoke all on function public.payment_config(), public.payment_eligible(uuid, text, uuid), public.payment_json(public.payments) from public, anon, authenticated;
revoke all on function public.record_payment_result(text, text, text, text, timestamptz, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_payment_result(text, text, text, text, timestamptz, text, text, jsonb) to service_role;
revoke all on function public.create_payment_order(text, uuid), public.my_payment_order(text), public.mark_payment_failed(text, text, text),
  public.admin_list_payments(text, text), public.admin_begin_payment_cancel(uuid, text) from public, anon;
grant execute on function public.create_payment_order(text, uuid), public.my_payment_order(text), public.mark_payment_failed(text, text, text),
  public.admin_list_payments(text, text), public.admin_begin_payment_cancel(uuid, text) to authenticated;
