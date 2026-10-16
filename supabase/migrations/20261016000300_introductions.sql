-- 비포어스 서버 4단계: 정오 소개 · 사이트 안 알림 · 차단 · 사진 열람 권한
-- 열람 기간(V6-provision-01)
--  - 소개: 정오 공개 ~ 다음 날 11:00 응답 마감
--  - 서로 선택: 교류·약속이 끝날 때까지(교류 단계가 연결되기 전에는 응답 마감 + 10일로 둔다)
--  - 종료·차단·탈퇴: 즉시 닫힘. 끝난 소개를 다시 볼 수 없다.

create table public.introductions (
  id uuid primary key default gen_random_uuid(),
  member_a uuid not null references public.profiles (id) on delete cascade,
  member_b uuid not null references public.profiles (id) on delete cascade,
  note text not null check (char_length(note) between 10 and 300),  -- 두 사람에게 함께 보이는 운영진의 소개 이유
  status text not null default 'reserved' check (status in ('reserved', 'published', 'mutual', 'closed', 'cancelled')),
  reveal_at timestamptz not null,
  respond_by timestamptz not null,
  view_until timestamptz not null,
  snapshot_a jsonb not null,   -- A의 공개 프로필(B에게 보임)
  snapshot_b jsonb not null,   -- B의 공개 프로필(A에게 보임)
  opened_a_at timestamptz,     -- 상대 프로필을 처음 실제로 연 때(소개 제공 개시)
  opened_b_at timestamptz,
  response_a text check (response_a in ('positive', 'negative')),
  response_a_at timestamptz,
  reason_a text,
  response_b text check (response_b in ('positive', 'negative')),
  response_b_at timestamptz,
  reason_b text,
  published_at timestamptz,
  mutual_at timestamptz,
  closed_at timestamptz,
  end_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (member_a <> member_b),
  check (respond_by > reveal_at)
);
alter table public.introductions enable row level security;
-- 같은 두 사람은 다시 소개하지 않는다(공개 전에 취소된 건은 제외).
create unique index introductions_pair_once on public.introductions (least(member_a, member_b), greatest(member_a, member_b)) where status <> 'cancelled';
create index introductions_member_a on public.introductions (member_a, status);
create index introductions_member_b on public.introductions (member_b, status);

create table public.blocks (
  member_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, blocked_id)
);
alter table public.blocks enable row level security;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.notifications enable row level security;
create index notifications_member on public.notifications (member_id, created_at desc);

-- ─────────────────────────────────────────────────────────
create or replace function public.kst_at(p_date date, p_time time) returns timestamptz
language sql immutable set search_path = '' as $$ select (p_date + p_time) at time zone 'Asia/Seoul' $$;

create or replace function public.notify(p_member uuid, p_kind text, p_title text, p_body text, p_link text, p_key text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (member_id, kind, title, body, link, dedupe_key)
  values (p_member, p_kind, p_title, p_body, p_link, p_key)
  on conflict (dedupe_key) do nothing
$$;

-- 소개를 닫는다(열람도 바로 끝난다).
create or replace function public.close_introduction(p_id uuid, p_reason text) returns void
language sql security definer set search_path = '' as $$
  update public.introductions
     set status = case when status = 'reserved' then 'cancelled' else 'closed' end,
         closed_at = now(), end_reason = p_reason, view_until = least(view_until, now())
   where id = p_id and status in ('reserved', 'published', 'mutual')
$$;

-- 이 회원이 지금 볼 수 있는 상대 사진 경로인지(저장소 열람 권한에 쓴다)
create or replace function public.can_view_partner_photo(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.introductions i
     where i.status in ('published', 'mutual') and i.reveal_at <= now() and now() < i.view_until
       and ((i.member_a = auth.uid() and i.snapshot_b -> 'photos' @> jsonb_build_array(jsonb_build_object('path', p_path)))
         or (i.member_b = auth.uid() and i.snapshot_a -> 'photos' @> jsonb_build_array(jsonb_build_object('path', p_path))))
  )
$$;

-- ─────────────────────────────────────────────────────────
-- 운영진: 소개할 수 있는 회원 목록(승인·활동 중, 진행 중 소개 없음)
create or replace function public.admin_ready_members() returns table (
  member_id uuid, name text, gender text, desired text, age int, province text, area text, purpose text,
  last_published_at timestamptz, introductions int, blocked uuid[], previous uuid[]
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  return query
    select a.member_id, a.draft -> 'values' ->> 'self.name', a.draft -> 'values' ->> 'self.gender', a.draft -> 'values' ->> 'desired.gender',
           public.age_from(a.draft -> 'values' ->> 'self.birthDate'), a.draft -> 'values' ->> 'self.province', a.draft -> 'values' ->> 'self.area',
           a.draft -> 'values' ->> 'self.purpose',
           (select max(i.published_at) from public.introductions i where a.member_id in (i.member_a, i.member_b)),
           (select count(*)::int from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status <> 'cancelled'),
           coalesce((select array_agg(case when b.member_id = a.member_id then b.blocked_id else b.member_id end) from public.blocks b where a.member_id in (b.member_id, b.blocked_id)), '{}'),
           coalesce((select array_agg(case when i.member_a = a.member_id then i.member_b else i.member_a end) from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status <> 'cancelled'), '{}')
      from public.applications a
      join public.profiles p on p.id = a.member_id and p.status = 'active'
     where a.status = 'approved'
       and not exists (select 1 from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status in ('reserved', 'published', 'mutual'))
     order by 9 nulls first;
end $$;

-- 운영진: 정오 소개 예약. 공개 프로필 사본은 이 시점에 만든다.
create or replace function public.admin_reserve_introduction(p_a uuid, p_b uuid, p_date date, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare reveal timestamptz; snap_a jsonb; snap_b jsonb; new_id uuid; m uuid;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_a = p_b then raise exception '서로 다른 두 회원이 필요해요.'; end if;
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

create or replace function public.admin_cancel_introduction(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '취소 사유를 적어 주세요.'; end if;
  if not exists (select 1 from public.introductions where id = p_id and status in ('reserved', 'published', 'mutual')) then
    raise exception '취소할 수 있는 소개가 없어요.';
  end if;
  perform public.close_introduction(p_id, 'admin-cancel');
  perform public.write_audit('소개 취소', p_id::text, p_reason);
end $$;

create or replace function public.admin_list_introductions(p_from date default null) returns table (
  id uuid, status text, reveal_at timestamptz, respond_by timestamptz, member_a uuid, member_b uuid,
  name_a text, name_b text, response_a text, response_b text, opened_a boolean, opened_b boolean, end_reason text, note text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return query
    select i.id, i.status, i.reveal_at, i.respond_by, i.member_a, i.member_b,
           (select a.draft -> 'values' ->> 'self.name' from public.applications a where a.member_id = i.member_a),
           (select a.draft -> 'values' ->> 'self.name' from public.applications a where a.member_id = i.member_b),
           i.response_a, i.response_b, i.opened_a_at is not null, i.opened_b_at is not null, i.end_reason, i.note
      from public.introductions i
     where p_from is null or i.reveal_at >= public.kst_at(p_from, '00:00')
     order by i.reveal_at desc
     limit 200;
end $$;

-- ─────────────────────────────────────────────────────────
-- 회원: 지금의 소개. 열람 기간 안에서만 상대 프로필을 돌려준다.
create or replace function public.my_introduction() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.introductions; me uuid := auth.uid(); is_a boolean; readable boolean;
begin
  if me is null then return null; end if;
  select * into i from public.introductions
   where me in (member_a, member_b) and status in ('published', 'mutual', 'closed') and reveal_at <= now()
   order by reveal_at desc limit 1;
  if i is null then
    return jsonb_build_object('status', 'waiting');
  end if;
  is_a := i.member_a = me;
  readable := i.status in ('published', 'mutual') and now() < i.view_until;
  return jsonb_build_object(
    'id', i.id,
    'status', case when i.status = 'published' and now() >= i.respond_by then 'expired' else i.status end,
    'publishedAt', i.published_at,
    'dueAt', i.respond_by,
    'viewUntil', i.view_until,
    'note', case when readable then i.note end,
    'profile', case when readable then (case when is_a then i.snapshot_b else i.snapshot_a end) end,
    'ownResponse', case when is_a then i.response_a else i.response_b end,
    'ownResponseAt', case when is_a then i.response_a_at else i.response_b_at end,
    'opened', (case when is_a then i.opened_a_at else i.opened_b_at end) is not null,
    'mutual', i.status = 'mutual',
    'endReason', i.end_reason,
    'closedAt', i.closed_at
  );
end $$;

-- 상대 프로필을 처음 실제로 열었을 때(소개 제공 개시 · 소개비 환불 기준)
create or replace function public.record_introduction_view(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.introductions
     set opened_a_at = case when member_a = auth.uid() then coalesce(opened_a_at, now()) else opened_a_at end,
         opened_b_at = case when member_b = auth.uid() then coalesce(opened_b_at, now()) else opened_b_at end
   where id = p_id and auth.uid() in (member_a, member_b) and status in ('published', 'mutual') and now() < view_until;
end $$;

create or replace function public.respond_introduction(p_id uuid, p_choice text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.introductions; me uuid := auth.uid(); is_a boolean;
begin
  if p_choice not in ('positive', 'negative') then raise exception '응답을 골라 주세요.'; end if;
  if p_reason is not null and p_reason not in ('거리', '나이', '관심사·대화 결', '사진·첫인상', '그냥 느낌', '말하고 싶지 않아요') then raise exception '이유를 다시 골라 주세요.'; end if;
  select * into i from public.introductions where id = p_id for update;
  if i is null or me not in (i.member_a, i.member_b) then raise exception '소개를 찾을 수 없어요.'; end if;
  is_a := i.member_a = me;
  if i.status <> 'published' or now() >= i.respond_by then raise exception '응답 기한이 지났거나 이미 마무리된 소개예요.'; end if;
  if (case when is_a then i.opened_a_at else i.opened_b_at end) is null then raise exception '상대 프로필을 확인한 뒤 응답해 주세요.'; end if;
  if (case when is_a then i.response_a else i.response_b end) is not null then raise exception '이미 응답했어요. 응답은 바꿀 수 없어요.'; end if;
  if is_a then
    update public.introductions set response_a = p_choice, response_a_at = now(), reason_a = case when p_choice = 'negative' then p_reason end where id = p_id returning * into i;
  else
    update public.introductions set response_b = p_choice, response_b_at = now(), reason_b = case when p_choice = 'negative' then p_reason end where id = p_id returning * into i;
  end if;
  if i.response_a is not null and i.response_b is not null then
    if i.response_a = 'positive' and i.response_b = 'positive' then
      update public.introductions set status = 'mutual', mutual_at = now(), view_until = respond_by + interval '10 days' where id = p_id;
      perform public.notify(i.member_a, 'mutual', '두 분 모두 알아가고 싶다고 답했어요', '다음 단계를 확인해 주세요.', '/us', 'mutual:' || p_id || ':' || i.member_a);
      perform public.notify(i.member_b, 'mutual', '두 분 모두 알아가고 싶다고 답했어요', '다음 단계를 확인해 주세요.', '/us', 'mutual:' || p_id || ':' || i.member_b);
    else
      perform public.close_introduction(p_id, 'rejected');
      perform public.notify(i.member_a, 'closed', '이번 소개는 여기서 마무리됐어요', '다음 소개가 준비되면 정오에 알려 드릴게요.', '/today', 'closed:' || p_id || ':' || i.member_a);
      perform public.notify(i.member_b, 'closed', '이번 소개는 여기서 마무리됐어요', '다음 소개가 준비되면 정오에 알려 드릴게요.', '/today', 'closed:' || p_id || ':' || i.member_b);
    end if;
  end if;
  return public.my_introduction();
end $$;

-- 차단: 소개받은 적 있는 상대만 차단할 수 있고, 진행 중인 소개는 바로 닫힌다. 사유는 묻지 않는다.
create or replace function public.block_member(p_target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); i record;
begin
  if me is null or p_target = me then raise exception '차단할 상대를 확인해 주세요.'; end if;
  if not exists (select 1 from public.introductions where status <> 'cancelled' and least(member_a, member_b) = least(me, p_target) and greatest(member_a, member_b) = greatest(me, p_target)) then
    raise exception '소개받은 상대만 차단할 수 있어요.';
  end if;
  insert into public.blocks (member_id, blocked_id) values (me, p_target) on conflict do nothing;
  for i in select id from public.introductions where status in ('published', 'mutual') and least(member_a, member_b) = least(me, p_target) and greatest(member_a, member_b) = greatest(me, p_target) loop
    perform public.close_introduction(i.id, 'blocked');
  end loop;
  perform public.write_audit('회원 차단', me::text, '상대 비공개');
end $$;

create or replace function public.mark_notifications_read() returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now() where member_id = auth.uid() and read_at is null
$$;

-- ─────────────────────────────────────────────────────────
-- 예약 작업: 매일 12:00 KST
create or replace function public.run_noon() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run_id bigint; published int := 0; missed int := 0; waiting int := 0; r record; today date := public.kst_today(); result jsonb;
begin
  insert into public.job_runs (job) values ('noon') returning id into run_id;
  begin
    -- 정오에서 30분 넘게 늦은 예약은 한쪽만 늦게 공개하지 않고 취소한다(운영진이 다시 예약).
    for r in update public.introductions set status = 'cancelled', closed_at = now(), end_reason = 'missed-window'
               where status = 'reserved' and reveal_at <= now() - interval '30 minutes' returning id loop
      missed := missed + 1;
    end loop;
    for r in update public.introductions set status = 'published', published_at = now()
               where status = 'reserved' and reveal_at <= now() returning id, member_a, member_b loop
      published := published + 1;
      perform public.notify(r.member_a, 'new-introduction', '오늘의 인연이 도착했어요', '내일 오전 11시까지 답해 주세요.', '/us', 'intro:' || r.id || ':' || r.member_a);
      perform public.notify(r.member_b, 'new-introduction', '오늘의 인연이 도착했어요', '내일 오전 11시까지 답해 주세요.', '/us', 'intro:' || r.id || ':' || r.member_b);
    end loop;
    -- 소개가 없는 날 알림은 받기로 한 회원에게만
    for r in select p.id from public.profiles p join public.applications a on a.member_id = p.id
              where p.status = 'active' and a.status = 'approved' and p.notice_daily_waiting
                and not exists (select 1 from public.introductions i where p.id in (i.member_a, i.member_b) and i.status in ('published', 'mutual')) loop
      waiting := waiting + 1;
      perform public.notify(r.id, 'waiting', '오늘은 소개가 없어요', '잘 맞는 분이 준비되면 정오에 알려 드릴게요.', '/today', 'waiting:' || today || ':' || r.id);
    end loop;
    result := jsonb_build_object('published', published, 'missed', missed, 'waiting', waiting);
    update public.job_runs set finished_at = now(), ok = true, detail = result where id = run_id;
  exception when others then
    -- 안쪽 작업만 되돌리고 실패 기록은 남긴다(운영진이 다시 실행).
    result := jsonb_build_object('error', sqlerrm);
    update public.job_runs set finished_at = now(), ok = false, detail = result where id = run_id;
  end;
  return result;
end $$;

-- 예약 작업: 10분마다 응답 마감 처리
create or replace function public.run_introduction_deadlines() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id, member_a, member_b from public.introductions where status = 'published' and respond_by <= now() loop
    perform public.close_introduction(r.id, 'nonresponse');
    perform public.notify(r.member_a, 'closed', '이번 소개는 여기서 마무리됐어요', '다음 소개가 준비되면 정오에 알려 드릴게요.', '/today', 'closed:' || r.id || ':' || r.member_a);
    perform public.notify(r.member_b, 'closed', '이번 소개는 여기서 마무리됐어요', '다음 소개가 준비되면 정오에 알려 드릴게요.', '/today', 'closed:' || r.id || ':' || r.member_b);
    n := n + 1;
  end loop;
  if n > 0 then insert into public.job_runs (job, finished_at, ok, detail) values ('deadlines', now(), true, jsonb_build_object('closed', n)); end if;
  return n;
end $$;

-- ─────────────────────────────────────────────────────────
-- RLS
create policy "blocks: 본인 조회" on public.blocks for select to authenticated using (member_id = auth.uid());
create policy "notifications: 본인 조회" on public.notifications for select to authenticated using (member_id = auth.uid());
revoke insert, update, delete on public.introductions, public.blocks, public.notifications from anon, authenticated;
revoke all on public.introductions, public.blocks, public.notifications from anon;
-- introductions 표는 회원·운영진 모두 RPC로만 읽는다(정책 없음 = 직접 조회 불가).

revoke all on function public.notify(uuid, text, text, text, text, text), public.close_introduction(uuid, text),
  public.run_noon(), public.run_introduction_deadlines() from public, anon, authenticated;
revoke all on function public.can_view_partner_photo(text), public.admin_ready_members(), public.admin_reserve_introduction(uuid, uuid, date, text),
  public.admin_cancel_introduction(uuid, text), public.admin_list_introductions(date), public.my_introduction(),
  public.record_introduction_view(uuid), public.respond_introduction(uuid, text, text), public.block_member(uuid),
  public.mark_notifications_read() from public, anon;
grant execute on function public.can_view_partner_photo(text), public.admin_ready_members(), public.admin_reserve_introduction(uuid, uuid, date, text),
  public.admin_cancel_introduction(uuid, text), public.admin_list_introductions(date), public.my_introduction(),
  public.record_introduction_view(uuid), public.respond_introduction(uuid, text, text), public.block_member(uuid),
  public.mark_notifications_read() to authenticated;

-- ─────────────────────────────────────────────────────────
-- 사진 저장소(비공개). 회원 폴더: {회원 id}/{칸}-{임의값}.{확장자}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('application-photos', 'application-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "사진: 본인 폴더에 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'application-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "사진: 본인·운영진·열람 기간의 상대만 보기" on storage.objects for select to authenticated
  using (bucket_id = 'application-photos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin(array['owner','operator','counselor'])
    or public.can_view_partner_photo(name)));
create policy "사진: 본인 폴더에서 지우기" on storage.objects for delete to authenticated
  using (bucket_id = 'application-photos' and (storage.foldername(name))[1] = auth.uid()::text
         and not exists (select 1 from public.application_photos p where p.path = name));
