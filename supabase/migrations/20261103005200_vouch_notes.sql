-- 5200: 친구 추천사 · 이번 주 노트
--
-- 친구 추천사: 회원이 링크를 만들어 친구에게 보내면, 친구가 로그인 없이 ‘이 친구는 이런 사람이에요’ 한 줄과 관계만 남긴다.
--   친구의 이름·연락처는 받지 않는다. 회원 본인과 운영진만 읽고(소개할 분을 고를 때 참고), 소개된 상대에게는 보이지 않는다.
--   링크는 회원마다 하나(새로 만들면 예전 링크는 닫힌다) · 14일 · 추천사는 회원마다 세 개까지. 회원이 지우거나 탈퇴하면 함께 지운다.
-- 이번 주 노트: 운영진이 일주일에 한 번쯤 남기는 짧은 글. 회원 오늘 화면에 14일 동안 가장 최근 것 하나만 보인다.

create table if not exists public.vouch_links (
  member uuid primary key references public.profiles (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table if not exists public.vouches (
  id uuid primary key default gen_random_uuid(),
  member uuid not null references public.profiles (id) on delete cascade,
  relation text not null check (char_length(relation) between 1 and 20),
  body text not null check (char_length(body) between 10 and 150),
  created_at timestamptz not null default now()
);
create index if not exists vouches_member on public.vouches (member, created_at desc);
create table if not exists public.weekly_notes (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(body) between 10 and 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists weekly_notes_at on public.weekly_notes (created_at desc);
alter table public.vouch_links enable row level security;
alter table public.vouches enable row level security;
alter table public.weekly_notes enable row level security;
revoke all on public.vouch_links, public.vouches, public.weekly_notes from anon, authenticated;

-- 링크 상태(친구 화면): 회원이 누구인지는 알려 주지 않는다.
create or replace function public.vouch_link_state(p_token text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare l public.vouch_links;
begin
  select * into l from public.vouch_links where token = lower(trim(coalesce(p_token, '')));
  if l.member is null or not exists (select 1 from public.profiles p where p.id = l.member and p.status = 'active') then return 'missing'; end if;
  if l.expires_at <= public.app_now() then return 'expired'; end if;
  if (select count(*) from public.vouches v where v.member = l.member) >= 3 then return 'full'; end if;
  return 'ok';
end $$;
revoke all on function public.vouch_link_state(text) from public, anon, authenticated;

-- 회원: 링크 만들기(이미 있으면 새 링크로 바꾼다 · 예전 링크는 바로 닫힌다)
create or replace function public.vouch_link() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); l public.vouch_links;
begin
  if me is null or not public.is_active_member() then raise exception '로그인하면 추천사 링크를 만들 수 있어요.'; end if;
  if (select count(*) from public.vouches where member = me) >= 3 then raise exception '추천사는 세 개까지 받을 수 있어요. 하나를 지우면 다시 받을 수 있어요.'; end if;
  -- 기한이 한참 지난 링크는 이때 함께 정리한다(링크에는 회원 정보가 없다).
  delete from public.vouch_links where expires_at < public.app_now() - interval '30 days';
  insert into public.vouch_links (member, token, expires_at)
  values (me, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), public.app_now() + interval '14 days')
  on conflict (member) do update set token = excluded.token, created_at = now(), expires_at = excluded.expires_at
  returning * into l;
  return jsonb_build_object('token', l.token, 'expiresAt', l.expires_at);
end $$;

create or replace function public.vouch_close() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.'; end if;
  delete from public.vouch_links where member = auth.uid();
end $$;

create or replace function public.my_vouches() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception '로그인이 필요해요.'; end if;
  return jsonb_build_object(
    'link', (select jsonb_build_object('token', l.token, 'expiresAt', l.expires_at, 'expired', l.expires_at <= public.app_now()) from public.vouch_links l where l.member = me),
    'vouches', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'relation', v.relation, 'body', v.body, 'at', v.created_at) order by v.created_at desc) from public.vouches v where v.member = me), '[]'::jsonb),
    'max', 3);
end $$;

create or replace function public.vouch_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.vouches where id = p_id and member = auth.uid();
  if not found then raise exception '지울 수 있는 추천사가 없어요.'; end if;
end $$;

-- 친구(로그인 없이): 링크 확인과 한 줄 남기기
create or replace function public.vouch_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare state text := public.vouch_link_state(p_token);
begin
  return jsonb_build_object('ok', state = 'ok', 'reason', case when state = 'ok' then null else state end);
end $$;

create or replace function public.vouch_write(p_token text, p_relation text, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare state text; l public.vouch_links; relation text := trim(coalesce(p_relation, '')); clean text := trim(coalesce(p_body, '')); new_id uuid;
begin
  select * into l from public.vouch_links where token = lower(trim(coalesce(p_token, ''))) for update;
  state := public.vouch_link_state(p_token);
  if state = 'missing' then raise exception '링크를 찾을 수 없어요. 친구에게 링크를 다시 받아 주세요.'; end if;
  if state = 'expired' then raise exception '링크 기한이 지났어요. 친구에게 새 링크를 부탁해 주세요.'; end if;
  if state = 'full' then raise exception '이 친구는 추천사를 이미 충분히 받았어요. 마음만 고맙게 받을게요.'; end if;
  if auth.uid() = l.member then raise exception '내 추천사는 친구가 써 줘야 해요. 링크를 친구에게 보내 주세요.'; end if;
  if char_length(relation) < 1 or char_length(relation) > 20 then raise exception '관계는 20자 안으로 적어 주세요.'; end if;
  if char_length(clean) < 10 or char_length(clean) > 150 then raise exception '10~150자로 적어 주세요.'; end if;
  -- 친구는 회원이 아니라 금전 의심 표시(회원 기준)는 쓰지 않고, 연락처·SNS·링크만 막는다.
  if public.has_contact(normalize(relation, NFKC)) or public.has_contact(normalize(clean, NFKC)) then
    raise exception '연락처·SNS 아이디·링크는 적을 수 없어요. 친구가 어떤 사람인지만 적어 주세요.';
  end if;
  insert into public.vouches (member, relation, body) values (l.member, relation, clean) returning id into new_id;
  perform public.notify(l.member, 'vouch', '친구가 한 줄을 써 줬어요', '내 정보에서 읽어 볼 수 있어요.', '/profile#vouch', 'vouch:' || new_id);
  return jsonb_build_object('ok', true);
end $$;

-- 운영진: 신청자 화면에서 추천사 보기(창가 질문 답과 같은 역할)
create or replace function public.admin_member_vouches(p_member uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner', 'operator', 'counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'relation', v.relation, 'body', v.body, 'at', v.created_at) order by v.created_at desc)
    from public.vouches v where v.member = p_member), '[]'::jsonb);
end $$;

-- ── 이번 주 노트
create or replace function public.admin_notes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare current_id uuid;
begin
  if not public.is_admin(array['owner', 'operator', 'counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  select id into current_id from public.weekly_notes where created_at > public.app_now() - interval '14 days' and created_at <= public.app_now() order by created_at desc limit 1;
  return coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
    select jsonb_build_object('id', n.id, 'body', n.body, 'at', n.created_at, 'current', n.id = current_id) x
      from public.weekly_notes n order by n.created_at desc limit 20) t), '[]'::jsonb);
end $$;

create or replace function public.admin_note_write(p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare clean text := trim(coalesce(p_body, '')); new_id uuid;
begin
  if not public.is_admin(array['owner', 'operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if char_length(clean) < 10 or char_length(clean) > 200 then raise exception '10~200자로 적어 주세요.'; end if;
  insert into public.weekly_notes (body, created_by, created_at) values (clean, auth.uid(), public.app_now()) returning id into new_id;
  delete from public.weekly_notes where created_at < public.app_now() - interval '1 year';
  perform public.write_audit('이번 주 노트 씀', 'note:' || new_id, null);
  return public.admin_notes();
end $$;

create or replace function public.admin_note_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner', 'operator']) then raise exception '운영 권한이 필요해요.'; end if;
  delete from public.weekly_notes where id = p_id;
  if not found then raise exception '지울 노트가 없어요.'; end if;
  perform public.write_audit('이번 주 노트 지움', 'note:' || p_id, null);
  return public.admin_notes();
end $$;

-- 회원 오늘 화면: 14일 안에 쓴 가장 최근 노트 하나(없으면 null)
create or replace function public.current_note() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.'; end if;
  return (select jsonb_build_object('body', n.body, 'at', n.created_at) from public.weekly_notes n
           where n.created_at > public.app_now() - interval '14 days' and n.created_at <= public.app_now() order by n.created_at desc limit 1);
end $$;

revoke all on function public.vouch_info(text), public.vouch_write(text, text, text) from public;
grant execute on function public.vouch_info(text), public.vouch_write(text, text, text) to anon, authenticated;
revoke all on function public.vouch_link(), public.vouch_close(), public.my_vouches(), public.vouch_delete(uuid), public.admin_member_vouches(uuid),
  public.admin_notes(), public.admin_note_write(text), public.admin_note_delete(uuid), public.current_note() from public, anon;
grant execute on function public.vouch_link(), public.vouch_close(), public.my_vouches(), public.vouch_delete(uuid), public.admin_member_vouches(uuid),
  public.admin_notes(), public.admin_note_write(text), public.admin_note_delete(uuid), public.current_note() to authenticated;
