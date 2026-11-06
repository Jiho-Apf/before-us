-- 7200: GPT 3차 검수 R3-19 — 무료 베타 동안 일반 회원은 테스트 주문을 만들거나 완료할 수 없다(서버 기준)
--
-- 확인한 사실(바꾸기 전): 결제 기록(payments)을 읽어 권리·소개 횟수·기수를 바꾸는 서버 함수는 없다(member_has_access 는 어디서도 쓰지 않음).
--   그래도 화면에서 결제 버튼을 숨긴 것만으로는 서버 보호가 아니어서, 베타 동안 주문 자체를 지정한 시험 계정으로만 묶는다.
-- 고침:
--   · payments_open(): 정식 결제를 받기 시작했는지(지금은 false · 대표 결정 뒤 마이그레이션으로 바꾼다).
--   · payment_testers: 대표가 지정한 시험 계정. 베타 동안 create_payment_order 는 이 계정만, payment_eligible(승인 확인 함수가 보는 자격)도 같다.
--     → 일반 회원은 주문을 만들 수 없고, 예전에 만든 주문이 있어도 payments-confirm 이 토스 승인을 부르지 않는다(돈이 나가지 않음).
--   · 시험 키·라이브 키 차단(payment_config mode='test' · _shared/toss.ts)은 그대로다.

create or replace function public.payments_open() returns boolean
language sql immutable set search_path = '' as $$ select false $$;

create table if not exists public.payment_testers (
  member_id uuid primary key references public.profiles(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 200),
  added_at timestamptz not null default now()
);
alter table public.payment_testers enable row level security;
drop policy if exists "payment_testers: 운영진 조회" on public.payment_testers;
create policy "payment_testers: 운영진 조회" on public.payment_testers for select to authenticated using (public.is_admin(array['owner', 'operator', 'finance']));
revoke insert, update, delete on public.payment_testers from anon, authenticated;
revoke select on public.payment_testers from anon;

create or replace function public.payment_allowed(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.payments_open() or exists (select 1 from public.payment_testers t where t.member_id = p_member)
$$;

create or replace function public.admin_set_payment_tester(p_member uuid, p_on boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner']) then raise exception '대표 권한이 필요해요.'; end if;
  if p_on then
    insert into public.payment_testers (member_id, added_by, note) values (p_member, auth.uid(), nullif(trim(coalesce(p_note, '')), ''))
    on conflict (member_id) do update set note = excluded.note;
  else
    delete from public.payment_testers where member_id = p_member;
  end if;
  perform public.write_audit(case when p_on then '결제 시험 계정 지정' else '결제 시험 계정 해제' end, p_member::text, left(coalesce(p_note, ''), 200));
  return jsonb_build_object('member', p_member, 'tester', p_on);
end $$;

-- 자격(기존 정의 + 베타 동안은 시험 계정만)
CREATE OR REPLACE FUNCTION public.payment_eligible(p_member uuid, p_kind text, p_program uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.profiles where id = p_member and status = 'active')
     and not public.is_unlimited_member(p_member)
     and public.payment_allowed(p_member)
     and case p_kind
       when 'introduction' then p_program is null and exists (select 1 from public.applications where member_id = p_member and status = 'approved')
       when 'exchange' then exists (select 1 from public.programs where id = p_program and p_member in (member_a, member_b) and status in ('choosing', 'scheduled'))
       else false end
$function$;

-- 주문 만들기: 베타 동안은 시험 계정만(앞에 한 줄 더한다)
do $$
declare def text := pg_get_functiondef('public.create_payment_order(text, uuid)'::regprocedure);
  anchor text := 'if public.is_unlimited_member(me) then raise exception';
begin
  if position(anchor in def) = 0 then raise exception 'create_payment_order를 바꾸지 못했어요'; end if;
  execute replace(def, anchor, 'if not public.payment_allowed(me) then raise exception ''무료 베타 기간에는 결제를 받지 않아요. 소개비와 교류비를 내지 않아도 돼요.''; end if;
  ' || anchor);
end $$;

revoke all on function public.payments_open(), public.payment_allowed(uuid), public.admin_set_payment_tester(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_set_payment_tester(uuid, boolean, text) to authenticated;
