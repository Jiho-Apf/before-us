-- 아는 사람 피하기(2026-10-27)
--  - 회원이 피하고 싶은 사람의 휴대폰 번호를 적어 두면, 그 번호로 신청한 회원과는 서로 소개하지 않는다(어느 한쪽만 적어도 막는다).
--  - 원래 번호는 저장하지 않는다. 숫자만 남겨 서버 비밀 값과 함께 sha256으로 바꾼 값과, 화면에 보일 뒤 네 자리, 짧은 메모만 둔다.
--  - 상대에게는 아무것도 알리지 않는다. 운영진은 후보 목록에서 ‘서로 피하는 사이’ 표시만 보고, 누가 누구를 적었는지는 보지 않는다.
--  - 표는 회원도 직접 읽거나 쓰지 못하고, 아래 함수로만 다룬다.

create table public.private_values (
  name text primary key,
  value text not null
);
alter table public.private_values enable row level security;
revoke all on public.private_values from public, anon, authenticated;
insert into public.private_values (name, value)
values ('avoid_salt', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text))
on conflict (name) do nothing;

create table public.avoid_contacts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  phone_hash text not null,
  tail text not null check (tail ~ '^\d{4}$'),
  memo text check (memo is null or char_length(memo) <= 20),
  created_at timestamptz not null default now(),
  unique (member_id, phone_hash)
);
alter table public.avoid_contacts enable row level security;
revoke all on public.avoid_contacts from public, anon, authenticated;
create index avoid_contacts_hash on public.avoid_contacts (phone_hash);

-- 휴대폰 번호를 숫자만 남겨 010… 형태로(+82 10… 도 같은 번호로 본다)
create or replace function public.phone_digits(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case
    when d ~ '^8210\d{7,8}$' then '0' || substr(d, 3)
    when d ~ '^821[16789]\d{7,8}$' then '0' || substr(d, 3)
    else d end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') d) x
$$;

create or replace function public.phone_hash(p_phone text) returns text
language sql stable security definer set search_path = '' as $$
  select encode(sha256(convert_to(public.phone_digits(p_phone) || ':' || (select value from public.private_values where name = 'avoid_salt'), 'UTF8')), 'hex')
$$;

-- 회원: 내가 적어 둔 번호(뒤 네 자리와 메모만)
create or replace function public.my_avoid_contacts() returns table (id uuid, tail text, memo text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.tail, c.memo, c.created_at from public.avoid_contacts c where c.member_id = auth.uid() order by c.created_at desc
$$;

-- 회원: 번호 여러 개를 한 번에 적기. 형식이 맞지 않는 번호는 건너뛰고, 이미 적은 번호는 다시 넣지 않는다. 새로 더한 개수를 돌려준다.
create or replace function public.add_avoid_contacts(p_phones text[], p_memo text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); phone text; digits text; added int := 0; total int; memo text := nullif(trim(coalesce(p_memo, '')), '');
begin
  if me is null then raise exception '로그인이 필요해요.'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception '회원 정보를 찾지 못했어요.'; end if;
  if memo is not null and char_length(memo) > 20 then raise exception '메모는 20자까지 적을 수 있어요.'; end if;
  if coalesce(array_length(p_phones, 1), 0) = 0 then raise exception '번호를 하나 이상 적어 주세요.'; end if;
  if array_length(p_phones, 1) > 50 then raise exception '한 번에 50개까지 적을 수 있어요.'; end if;
  select count(*) into total from public.avoid_contacts where member_id = me;
  foreach phone in array p_phones loop
    digits := public.phone_digits(phone);
    continue when not (digits ~ '^01[016789]\d{7,8}$');
    exit when total + added >= 200;
    insert into public.avoid_contacts (member_id, phone_hash, tail, memo)
    values (me, public.phone_hash(digits), right(digits, 4), memo)
    on conflict (member_id, phone_hash) do nothing;
    if found then added := added + 1; end if;
  end loop;
  if added = 0 and not exists (select 1 from unnest(p_phones) p where public.phone_digits(p) ~ '^01[016789]\d{7,8}$') then
    raise exception '휴대폰 번호 형식을 확인해 주세요. 예: 010-1234-5678';
  end if;
  return added;
end $$;

create or replace function public.delete_avoid_contact(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.'; end if;
  delete from public.avoid_contacts where id = p_id and member_id = auth.uid();
end $$;

-- 두 회원이 서로 피하는 사이인지(한쪽만 적어도 true). 신청서의 휴대폰 번호로 맞춰 본다.
create or replace function public.avoid_conflict(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from (values (p_a, p_b), (p_b, p_a)) pair(owner, other)
      join public.applications a on a.member_id = pair.other
      join public.avoid_contacts c on c.member_id = pair.owner
     where nullif(a.draft -> 'values' ->> 'self.phone', '') is not null
       and c.phone_hash = public.phone_hash(a.draft -> 'values' ->> 'self.phone')
  )
$$;

-- 운영진 후보 목록: ‘서로 피하는 사이’(avoided)를 더한다. 반환 열이 바뀌어 지우고 다시 만든다.
drop function if exists public.admin_ready_members();
create function public.admin_ready_members() returns table (
  member_id uuid, name text, gender text, desired text, age int, province text, area text, purpose text,
  last_published_at timestamptz, introductions int, blocked uuid[], previous uuid[], avoided uuid[]
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
           (select count(*)::int from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status <> 'cancelled'),
           coalesce((select array_agg(case when b.member_id = a.member_id then b.blocked_id else b.member_id end) from public.blocks b where a.member_id in (b.member_id, b.blocked_id)), '{}'),
           coalesce((select array_agg(case when i.member_a = a.member_id then i.member_b else i.member_a end) from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status <> 'cancelled'), '{}'),
           coalesce((select array_agg(distinct o.member_id) from hashed o
                      where o.member_id <> a.member_id
                        and (exists (select 1 from public.avoid_contacts c where c.member_id = a.member_id and c.phone_hash = o.h)
                             or exists (select 1 from public.avoid_contacts c join hashed me on me.member_id = a.member_id
                                         where c.member_id = o.member_id and c.phone_hash = me.h))), '{}')
      from public.applications a
      join public.profiles p on p.id = a.member_id and p.status = 'active' and p.paused_at is null
     where a.status = 'approved'
       and not exists (select 1 from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status in ('reserved', 'published', 'mutual'))
     order by 9 nulls first;
end $$;

-- 소개 예약: 서로 피하는 사이면 막는다(나머지 확인은 처음 정의와 같다).
create or replace function public.admin_reserve_introduction(p_a uuid, p_b uuid, p_date date, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare reveal timestamptz; snap_a jsonb; snap_b jsonb; new_id uuid; m uuid;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_a = p_b then raise exception '서로 다른 두 회원이 필요해요.'; end if;
  if public.avoid_conflict(p_a, p_b) then raise exception '아는 사람 피하기로 서로 소개하지 않는 두 사람이에요.'; end if;
  reveal := public.kst_at(p_date, '12:00');
  if reveal <= now() then raise exception '이미 지난 정오에는 예약할 수 없어요. 다음 정오를 골라 주세요.'; end if;
  if char_length(coalesce(trim(p_note), '')) < 10 then raise exception '두 분에게 보일 소개 이유를 10자 이상 적어 주세요.'; end if;
  foreach m in array array[p_a, p_b] loop
    if not exists (select 1 from public.applications a join public.profiles p on p.id = a.member_id
                    where a.member_id = m and a.status = 'approved' and p.status = 'active') then
      raise exception '승인된 활동 회원만 소개할 수 있어요.';
    end if;
    if exists (select 1 from public.introductions where m in (member_a, member_b) and status in ('reserved', 'published', 'mutual')) then
      raise exception '이미 진행 중이거나 예약된 소개가 있는 회원이에요.';
    end if;
    if exists (select 1 from public.introductions where m in (member_a, member_b) and status <> 'cancelled'
                and (reveal_at at time zone 'Asia/Seoul')::date = p_date) then
      raise exception '같은 날 두 번 소개할 수 없어요.';
    end if;
    if (select count(*) from public.application_photos where member_id = m and slot in ('photo.face','photo.upper','photo.style') and review = '기준 확인') < 3 then
      raise exception '필수 사진 세 장의 기준 확인이 필요해요.';
    end if;
  end loop;
  if exists (select 1 from public.blocks where (member_id = p_a and blocked_id = p_b) or (member_id = p_b and blocked_id = p_a)) then
    raise exception '차단 관계인 두 사람은 소개할 수 없어요.';
  end if;
  if exists (select 1 from public.introductions where least(member_a, member_b) = least(p_a, p_b) and greatest(member_a, member_b) = greatest(p_a, p_b) and status <> 'cancelled') then
    raise exception '이미 소개한 적 있는 두 사람이에요.';
  end if;
  snap_a := public.public_profile(p_a);
  snap_b := public.public_profile(p_b);
  insert into public.introductions (member_a, member_b, note, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, created_by)
  values (p_a, p_b, trim(p_note), reveal, public.kst_at(p_date + 1, '11:00'), public.kst_at(p_date + 1, '11:00'), snap_a, snap_b, auth.uid())
  returning id into new_id;
  perform public.write_audit('정오 소개 예약 · ' || p_date, new_id::text);
  return new_id;
end $$;

revoke all on function public.phone_digits(text), public.phone_hash(text), public.avoid_conflict(uuid, uuid) from public, anon, authenticated;
revoke all on function public.my_avoid_contacts(), public.add_avoid_contacts(text[], text), public.delete_avoid_contact(uuid), public.admin_ready_members() from public, anon;
grant execute on function public.my_avoid_contacts(), public.add_avoid_contacts(text[], text), public.delete_avoid_contact(uuid), public.admin_ready_members() to authenticated;
