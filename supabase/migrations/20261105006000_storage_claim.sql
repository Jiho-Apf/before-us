-- 6000: GPT 2차 검수 T02 — 사진 파일을 지우는 동안 그 파일을 다시 쓰지 못하게(선점)
--
-- 문제: storage-cleanup 함수는 ① storage_cleanup_recheck 로 ‘아직 안 쓰임’을 확인하고(트랜잭션 끝) ② Storage API로 파일을 지운다.
--       ①과 ② 사이에 같은 경로를 다시 쓰는 일(신청 사진 등록 · 교체 사진 · 소개 사본 · 편지 사진)이 끝나면, 방금 쓰기 시작한 파일이 지워진다.
--       (실제 PostgreSQL 두 연결로 재현: supabase/tests/realpg/storage-race.test.mjs 대조군)
-- 고침:
--   · 지우기 직전 확인(storage_cleanup_recheck)이 그 경로를 ‘지우는 중’으로 선점한다(claimed_at). 이미 배포된 정리 함수도 그대로 이 선점을 쓴다.
--   · 경로를 새로 쓰는 모든 곳(표 4개의 트리거)이 storage_path_take 로 먼저 확인한다:
--       지우는 중이면 거절(‘사진을 다시 올려 주세요’) · 대기열에만 있으면 대기열에서 뺀다.
--   · 두 쪽이 같은 경로 열쇠(advisory 잠금)를 잡는다. 쓰는 쪽이 끝나지 않았으면 선점하지 않고 건너뛴다(다음 날 다시 확인).
--   · 지우다 실패하면 storage_cleanup_release 로 선점을 푼다. 정리 함수가 중간에 멈춰도 30분 뒤에는 다시 선점할 수 있다.

alter table public.storage_cleanup add column if not exists claimed_at timestamptz;

-- 경로 하나의 열쇠(같은 경로를 쓰는 쪽과 지우는 쪽이 함께 잡는다). 앞 숫자 6000은 이 용도 표시.
create or replace function public.storage_path_key(p_bucket text, p_path text) returns integer
language sql immutable set search_path = '' as $$ select hashtext(p_bucket || ':' || p_path) $$;

-- 경로를 새로 쓰기 전에: 지우는 중이면 거절하고, 대기열에만 있으면 뺀다(쓰는 트랜잭션이 끝날 때까지 열쇠를 쥔다).
create or replace function public.storage_path_take(p_bucket text, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_path is null or p_path = '' then return; end if;
  perform pg_advisory_xact_lock(6000, public.storage_path_key(p_bucket, p_path));
  if exists (select 1 from public.storage_cleanup c where c.bucket = p_bucket and c.path = p_path and c.claimed_at is not null) then
    raise exception '이 사진 파일은 정리 중이라 쓸 수 없어요. 사진을 다시 올려 주세요.';
  end if;
  delete from public.storage_cleanup c where c.bucket = p_bucket and c.path = p_path;
end $$;

create or replace function public.take_photo_path() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.path is distinct from old.path then
    perform public.storage_path_take('application-photos', new.path);
  end if;
  return new;
end $$;

create or replace function public.take_snapshot_photos() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p text;
begin
  if new.status not in ('reserved', 'published', 'mutual') then return new; end if;
  for p in
    select distinct x ->> 'path'
      from jsonb_array_elements(
             (case when jsonb_typeof(new.snapshot_a -> 'photos') = 'array' then new.snapshot_a -> 'photos' else '[]'::jsonb end)
          || (case when jsonb_typeof(new.snapshot_b -> 'photos') = 'array' then new.snapshot_b -> 'photos' else '[]'::jsonb end)) x
     where x ->> 'path' is not null
  loop
    perform public.storage_path_take('application-photos', p);
  end loop;
  return new;
end $$;

create or replace function public.take_letter_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'letter' and new.payload ->> 'photo' is not null
     and (tg_op = 'INSERT' or (new.payload ->> 'photo') is distinct from (old.payload ->> 'photo') or new.kind is distinct from old.kind) then
    perform public.storage_path_take('letter-photos', new.payload ->> 'photo');
  end if;
  return new;
end $$;

drop trigger if exists application_photos_take_path on public.application_photos;
create trigger application_photos_take_path before insert or update of path on public.application_photos
  for each row execute function public.take_photo_path();
drop trigger if exists photo_replacements_take_path on public.photo_replacements;
create trigger photo_replacements_take_path before insert or update of path on public.photo_replacements
  for each row execute function public.take_photo_path();
drop trigger if exists introductions_take_photos on public.introductions;
create trigger introductions_take_photos before insert or update of snapshot_a, snapshot_b on public.introductions
  for each row execute function public.take_snapshot_photos();
drop trigger if exists program_entries_take_photo on public.program_entries;
create trigger program_entries_take_photo before insert or update of payload, kind on public.program_entries
  for each row execute function public.take_letter_photo();

-- 지울 목록: 쓰이지 않고, 다른 정리 함수가 지우는 중이 아닌 것(멈춘 지 30분이 지난 선점은 다시 고른다)
create or replace function public.storage_cleanup_batch(p_limit integer default 200)
returns table (bucket text, path text)
language sql stable security definer set search_path = '' as $$
  select c.bucket, c.path from public.storage_cleanup c
   where not public.storage_path_in_use(c.bucket, c.path)
     and (c.claimed_at is null or c.claimed_at < now() - interval '30 minutes')
   order by c.queued_at
   limit p_limit
$$;

-- 지우기 직전 확인 + 선점: 지금 지워도 되는 경로만 ‘지우는 중’으로 표시해 돌려준다.
--  · 쓰는 쪽이 아직 끝나지 않은 경로(열쇠를 못 잡음)는 이번에 건너뛴다.
--  · 다시 쓰이게 된 경로는 대기열에서 뺀다(예전과 같음).
create or replace function public.storage_cleanup_recheck(p_bucket text, p_paths text[]) returns text[]
language plpgsql security definer set search_path = '' as $$
declare x text; safe text[] := '{}';
begin
  for x in select distinct u from unnest(coalesce(p_paths, '{}')) u where u is not null order by 1 loop
    if not pg_try_advisory_xact_lock(6000, public.storage_path_key(p_bucket, x)) then continue; end if;
    if public.storage_path_in_use(p_bucket, x) then
      delete from public.storage_cleanup c where c.bucket = p_bucket and c.path = x;
      continue;
    end if;
    update public.storage_cleanup c set claimed_at = now()
     where c.bucket = p_bucket and c.path = x and (c.claimed_at is null or c.claimed_at < now() - interval '30 minutes');
    if found then safe := safe || x; end if;
  end loop;
  return safe;
end $$;

-- 파일을 지운 뒤: 선점한 줄을 대기열에서 뺀다 / 지우지 못했을 때: 선점을 푼다(다음에 다시)
create or replace function public.storage_cleanup_done(p_bucket text, p_paths text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.storage_cleanup c where c.bucket = p_bucket and c.path = any (coalesce(p_paths, '{}')) and c.claimed_at is not null;
  get diagnostics n = row_count;
  return n;
end $$;
create or replace function public.storage_cleanup_release(p_bucket text, p_paths text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.storage_cleanup c set claimed_at = null where c.bucket = p_bucket and c.path = any (coalesce(p_paths, '{}')) and c.claimed_at is not null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.storage_path_key(text, text), public.storage_path_take(text, text), public.take_photo_path(), public.take_snapshot_photos(),
  public.take_letter_photo(), public.storage_cleanup_batch(integer), public.storage_cleanup_recheck(text, text[]),
  public.storage_cleanup_done(text, text[]), public.storage_cleanup_release(text, text[]) from public, anon, authenticated;
grant execute on function public.storage_cleanup_batch(integer), public.storage_cleanup_recheck(text, text[]),
  public.storage_cleanup_done(text, text[]), public.storage_cleanup_release(text, text[]) to service_role;
