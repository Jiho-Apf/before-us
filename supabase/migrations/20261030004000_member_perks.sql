-- 회원 혜택: 무제한 회원(2026-10-30)
--  대표가 고른 회원 계정(운영진 계정이 아닌 보통 회원)을 ‘결제 없이, 횟수 제한 없이’ 쓰게 한다. 운영진 권한은 생기지 않는다.
--  - profiles.perk: null(보통) | 'unlimited'(무제한). 회원은 이 칸을 바꿀 수 없다(열 단위 수정 권한을 주지 않는다).
--  - 바꾸기: admin_set_member_perk(p_member, p_perk, p_reason) — 대표 + 2단계 인증만. 사유를 감사 기록에 남기고, 누구에게도 알리지 않는다.
--  - 결제: create_payment_order 가 ‘이 계정은 결제 없이 이용해요’로 막고, payment_eligible 은 false(남아 있던 결제 전 주문도 승인하지 않는다).
--  - 앞으로 결제를 받아야 쓸 수 있게 바꿀 때(아직 아님)는 자격 확인을 한 곳 member_has_access(회원, 종류[, 교류])로 한다.
--    무제한 회원이거나 그 항목을 결제 완료했으면 true. 서버 함수 안에서만 부른다(회원·운영진 화면에서 직접 부르지 않는다).
--  - 소개 횟수: intro_counts 가 무제한 회원 쪽은 횟수에 넣지 않는다(count_a/count_b = false). 지금 서버에서 ‘5번’을 막는 곳은 없고,
--    운영진 후보 목록의 ‘소개 N번’과 앞으로의 남은 횟수 계산이 이 표시를 쓴다. 혜택을 주기 전에 끝난 소개는 그대로 둔다.
--  - 그대로 두는 것(상대를 지키는 규칙): 차단·신고·재소개 금지·이용 정지·나이 범위·아는 사람 피하기, 한 번에 한 소개·하루 한 명,
--    두 번 이어서 답하지 않으면 자동 쉬기, 교류를 마치면 자동 쉬기.
--  - 상대에게는 보이지 않는다(소개·교류 화면의 어떤 응답에도 넣지 않는다). 운영진 회원 목록·매칭 후보에만 ‘무제한 회원’으로 보인다.

-- ─────────────────────────────────────────────────────────
-- 1. 표시 칸
alter table public.profiles add column perk text constraint profiles_perk_check check (perk in ('unlimited'));
comment on column public.profiles.perk is '회원 혜택: null(보통) | unlimited(결제 없이·횟수 제한 없이). 대표만 admin_set_member_perk 로 바꾼다.';

-- 도우미: 무제한 회원인지(서버 안에서만)
create or replace function public.is_unlimited_member(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = p_member and perk = 'unlimited')
$$;

-- 앞으로 결제로 이용을 나눌 때 쓰는 자격 확인 한 곳(지금은 어떤 흐름도 이것으로 막지 않는다 · 베타는 무료).
--  introduction: 무제한 회원이거나 소개비 결제 완료
--  exchange    : 무제한 회원이거나 그 교류(p_program)의 교류비 결제 완료(교류를 주지 않으면 무제한 회원만 true)
--  계정 상태(이용 중·정지)·신청 승인 같은 다른 조건은 부르는 쪽이 따로 확인한다.
create or replace function public.member_has_access(p_member uuid, p_kind text, p_program uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_member is not null and p_kind in ('introduction', 'exchange')
     and (public.is_unlimited_member(p_member)
          or exists (select 1 from public.payments pay
                      where pay.member_id = p_member and pay.kind = p_kind and pay.status = 'paid'
                        and (p_kind = 'introduction' or (p_program is not null and pay.program_id = p_program))))
$$;

-- ─────────────────────────────────────────────────────────
-- 2. 소개 횟수(2600 정의) + 무제한 회원 쪽은 횟수에 넣지 않는다.
create or replace function public.intro_counts(i public.introductions, p_member uuid) returns boolean
language sql stable set search_path = '' as $$
  select case
    when public.is_unlimited_member(p_member) then false
    when i.status = 'cancelled' then false
    when coalesce(i.end_reason, '') in ('admin-cancel', 'missed-window', 'precheck') then false
    when i.end_reason = 'nonresponse' then (case when i.member_a = p_member then i.response_a else i.response_b end) is null
    when i.end_reason in ('blocked', 'withdrawn', 'suspended') then i.ended_by is not distinct from p_member
    else true end
$$;

-- ─────────────────────────────────────────────────────────
-- 3. 결제(3800 정의) + 무제한 회원은 결제하지 않는다.
create or replace function public.payment_eligible(p_member uuid, p_kind text, p_program uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = p_member and status = 'active')
     and not public.is_unlimited_member(p_member)
     and case p_kind
       when 'introduction' then p_program is null and exists (select 1 from public.applications where member_id = p_member and status = 'approved')
       when 'exchange' then exists (select 1 from public.programs where id = p_program and p_member in (member_a, member_b) and status in ('choosing', 'scheduled'))
       else false end
$$;

create or replace function public.create_payment_order(p_kind text, p_program uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); cfg jsonb := public.payment_config(); st text; prog_status text;
  v_amount int; v_name text; v_key text; v_order text; recent int;
begin
  if me is null or not public.is_active_member() then raise exception '로그인한 회원만 결제할 수 있어요.'; end if;
  if public.is_unlimited_member(me) then raise exception '이 계정은 결제 없이 이용해요. 소개비와 교류비를 내지 않아도 돼요.'; end if;
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

-- ─────────────────────────────────────────────────────────
-- 4. 대표: 무제한 회원으로 바꾸기·되돌리기(p_perk = 'unlimited' | null). 회원 계정에만 준다(운영진 계정 제외).
--    사유는 감사 기록에만 남고, 본인·다른 회원 누구에게도 알리지 않는다.
create or replace function public.admin_set_member_perk(p_member uuid, p_perk text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_perk text := nullif(trim(coalesce(p_perk, '')), ''); reason text := trim(coalesce(p_reason, '')); current_perk text;
begin
  if not public.is_admin(array['owner']) then raise exception '무제한 회원은 대표만 정할 수 있어요.'; end if;
  if v_perk is not null and v_perk <> 'unlimited' then raise exception '회원 혜택을 알 수 없어요.'; end if;
  if reason = '' then raise exception '바꾸는 이유를 적어 주세요(감사 기록에 남아요).'; end if;
  if length(reason) > 200 then raise exception '이유는 200자 안으로 적어 주세요.'; end if;
  if exists (select 1 from public.admin_roles where user_id = p_member) then raise exception '운영진 계정에는 줄 수 없어요. 회원 계정을 골라 주세요.'; end if;
  select perk into current_perk from public.profiles where id = p_member for update;
  if not found then raise exception '회원을 찾을 수 없어요.'; end if;
  if current_perk is not distinct from v_perk then raise exception '이미 그 상태예요.'; end if;
  update public.profiles set perk = v_perk, updated_at = now() where id = p_member;
  perform public.write_audit(case when v_perk is null then '무제한 회원 해제' else '무제한 회원 지정' end, p_member::text, reason);
end $$;

-- ─────────────────────────────────────────────────────────
-- 5. 운영진 화면: 회원 목록·매칭 후보에 혜택(perk)을 붙인다(운영진만 본다).
-- 소개 가능한 회원(3100 정의 그대로) + 맨 끝 칸 perk
drop function if exists public.admin_ready_members();
create function public.admin_ready_members() returns table (
  member_id uuid, name text, gender text, desired text, age int, province text, area text, purpose text,
  last_published_at timestamptz, introductions int, blocked uuid[], previous uuid[], avoided uuid[], released_at timestamptz, history text[],
  waiting_since timestamptz, held uuid[], photos_confirmed int, cohort int, cohort_starts_on date, profile jsonb, perk text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  return query
    with hashed as (
      select x.member_id, public.phone_hash(x.draft -> 'values' ->> 'self.phone') h
        from public.applications x
       where x.status = 'approved' and nullif(x.draft -> 'values' ->> 'self.phone', '') is not null
    )
    select a.member_id, a.draft -> 'values' ->> 'self.name', a.draft -> 'values' ->> 'self.gender', a.draft -> 'values' ->> 'desired.gender',
           public.age_from(a.draft -> 'values' ->> 'self.birthDate'), a.draft -> 'values' ->> 'self.province', a.draft -> 'values' ->> 'self.area',
           a.draft -> 'values' ->> 'self.purpose',
           (select max(i.published_at) from public.introductions i where a.member_id in (i.member_a, i.member_b)),
           (select count(*)::int from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status <> 'cancelled'
              and coalesce(case when i.member_a = a.member_id then i.count_a else i.count_b end, true)),
           coalesce((select array_agg(case when b.member_id = a.member_id then b.blocked_id else b.member_id end) from public.blocks b where a.member_id in (b.member_id, b.blocked_id)), '{}'),
           coalesce((select array_agg(case when i.member_a = a.member_id then i.member_b else i.member_a end) from public.introductions i
                      where a.member_id in (i.member_a, i.member_b) and public.blocks_reintro(i) and i.member_a is not null and i.member_b is not null), '{}'),
           coalesce((select array_agg(distinct o.member_id) from hashed o
                      where o.member_id <> a.member_id
                        and (exists (select 1 from public.avoid_contacts c where c.member_id = a.member_id and c.phone_hash = o.h)
                             or exists (select 1 from public.avoid_contacts c join hashed me on me.member_id = a.member_id
                                         where c.member_id = o.member_id and c.phone_hash = me.h))), '{}'),
           (select max(i.closed_at) from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status = 'closed' and i.closed_at > now() - interval '24 hours'),
           public.safety_history(a.member_id),
           greatest(
             (select max(i.closed_at) from public.introductions i where a.member_id in (i.member_a, i.member_b)),
             (select max(g.closed_at) from public.programs g where a.member_id in (g.member_a, g.member_b)),
             p.resumed_at,
             a.decided_at,
             (select public.kst_at(c.starts_on, '12:00') from public.cohorts c where c.number = a.cohort_number)
           ),
           coalesce((select array_agg(o.member_id) from public.applications o
                      where o.status = 'approved' and o.member_id <> a.member_id
                        and exists (select 1 from public.safety_holds h where h.other_id in (a.member_id, o.member_id) and h.expires_at > now())
                        and public.held_pair(a.member_id, o.member_id)), '{}'),
           (select count(*)::int from public.application_photos ph where ph.member_id = a.member_id and ph.slot in ('photo.face', 'photo.upper', 'photo.style') and ph.review = '기준 확인'),
           a.cohort_number,
           (select c.starts_on from public.cohorts c where c.number = a.cohort_number),
           jsonb_build_object(
             'values', coalesce((select jsonb_object_agg(v.key, v.value) from jsonb_each(coalesce(a.draft -> 'values', '{}')) v
                                  where v.key not in ('self.name', 'self.phone', 'self.birthDate', 'self.notifyChannels', 'self.source', 'self.statement', 'self.pledge')
                                    and v.key not like 'consent.%' and v.value not in ('""'::jsonb, '[]'::jsonb, 'null'::jsonb)), '{}'),
             'preferences', coalesce(a.draft -> 'preferences', '{}')),
           p.perk
      from public.applications a
      join public.profiles p on p.id = a.member_id and p.status = 'active' and p.paused_at is null
     where a.status = 'approved'
       and not exists (select 1 from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status in ('reserved', 'published', 'mutual'))
     order by 14 desc nulls last, 16 asc nulls last, 9 nulls first;
end $$;

-- 회원 목록(3400 정의 그대로) + perk
create or replace function public.admin_list_members(p_query text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(lower(trim(coalesce(p_query, ''))), '');
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(row order by (row ->> 'createdAt') desc) from (
    select jsonb_build_object(
      'id', p.id, 'email', p.email, 'status', p.status, 'pausedAt', p.paused_at, 'pausedBy', case when p.paused_at is not null then coalesce(p.paused_by, 'member') end,
      'resumedAt', p.resumed_at, 'suspendedReason', p.suspended_reason, 'createdAt', p.created_at, 'perk', p.perk,
      'withdrawalRequestedAt', p.withdrawal_requested_at, 'deletionDueAt', p.deletion_due_at,
      'name', a.draft -> 'values' ->> 'self.name', 'phone', a.draft -> 'values' ->> 'self.phone', 'gender', a.draft -> 'values' ->> 'self.gender',
      'age', public.age_from(a.draft -> 'values' ->> 'self.birthDate'), 'area', concat_ws(' ', a.draft -> 'values' ->> 'self.province', a.draft -> 'values' ->> 'self.area'),
      'application', a.status, 'cohort', a.cohort_number,
      'channels', jsonb_build_object('kakao', p.notify_kakao, 'sms', p.notify_sms, 'email', p.notify_email),
      'introductions', (select count(*) from public.introductions i where p.id in (i.member_a, i.member_b) and i.status <> 'cancelled'),
      'reports', (select count(*) from public.reports r where r.target_id = p.id)
    ) as row
    from public.profiles p left join public.applications a on a.member_id = p.id
    where not exists (select 1 from public.admin_roles ar where ar.user_id = p.id)
      and (q is null or lower(p.email) like '%' || q || '%' or lower(coalesce(a.draft -> 'values' ->> 'self.name', '')) like '%' || q || '%'
           or regexp_replace(coalesce(a.draft -> 'values' ->> 'self.phone', ''), '\D', '', 'g') like '%' || regexp_replace(q, '\D', '', 'g') || '%' and regexp_replace(q, '\D', '', 'g') <> '')
    limit 300) x), '[]'::jsonb);
end $$;

-- ─────────────────────────────────────────────────────────
-- 권한: 도우미(혜택 확인·이용 자격)는 서버 안에서만(회원이 남의 결제·혜택을 짐작하지 못하게), 운영진 함수는 로그인한 사람에게 열고 함수 안에서 역할을 확인한다.
-- profiles.perk 에는 수정 권한을 주지 않는다(회원이 바꿀 수 있는 칸은 0100·2200의 grant update 목록뿐).
revoke all on function public.is_unlimited_member(uuid), public.member_has_access(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.intro_counts(public.introductions, uuid), public.payment_eligible(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.create_payment_order(text, uuid), public.admin_set_member_perk(uuid, text, text),
  public.admin_ready_members(), public.admin_list_members(text) from public, anon;
grant execute on function public.create_payment_order(text, uuid), public.admin_set_member_perk(uuid, text, text),
  public.admin_ready_members(), public.admin_list_members(text) to authenticated;
