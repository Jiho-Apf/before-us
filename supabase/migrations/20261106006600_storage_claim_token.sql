-- 6600: GPT 3차 검수 R3-20·R3-13 — 사진 파일 정리 선점에 ‘선점 표(claim_id)’를 붙인다
--
-- 문제: 6000의 선점은 시각(claimed_at)만 있어, 멈췄던 예전 정리 작업이 30분 뒤 다시 선점한 새 작업의 줄을
--       storage_cleanup_release 로 풀거나 storage_cleanup_done(또는 b27a043 함수의 표 직접 삭제)으로 지울 수 있었다.
--       그러면 새 작업이 파일을 지우기 전에 그 경로를 다시 쓸 수 있게 되어, 다시 등록한 경로의 파일이 지워질 수 있다.
--       (Edge 함수 한 번의 실행 시간 상한은 30분보다 훨씬 짧아 실제로 일어나기는 어렵지만, 늦게 도착한 요청까지 막는다.)
-- 고침:
--   · 새 함수 storage_cleanup_claim 은 선점할 때 임의 표(claim_id)를 만들어 돌려준다.
--     storage_cleanup_finish · storage_cleanup_unclaim 은 그 표가 맞는 줄만 지우거나 푼다(다른 작업의 선점은 건드리지 않음).
--   · 예전 함수(2인자 recheck/done/release · storage-cleanup v8)는 표 없는 선점(claim_id null)만 다룬다 → v8로 되돌려도 그대로 돈다.
--   · 표가 붙은 줄은 표가 맞을 때만 지워진다(트리거). b27a043 함수처럼 표를 직접 지우는 예전 작업도 다른 작업의 선점은 지우지 못한다.

alter table public.storage_cleanup add column if not exists claim_id uuid;

-- 표 없는 선점(예전 방식): 6000 정의 그대로 + claim_id 를 비운다
create or replace function public.storage_cleanup_recheck(p_bucket text, p_paths text[]) returns text[]
language plpgsql security definer set search_path = '' as $$
declare x text; safe text[] := '{}';
begin
  for x in select distinct u from unnest(coalesce(p_paths, '{}')) u where u is not null order by 1 loop
    if not pg_try_advisory_xact_lock(6000, public.storage_path_key(p_bucket, x)) then continue; end if;
    if public.storage_path_in_use(p_bucket, x) then
      delete from public.storage_cleanup c where c.bucket = p_bucket and c.path = x and c.claim_id is null;
      continue;
    end if;
    update public.storage_cleanup c set claimed_at = now(), claim_id = null
     where c.bucket = p_bucket and c.path = x and (c.claimed_at is null or c.claimed_at < now() - interval '30 minutes');
    if found then safe := safe || x; end if;
  end loop;
  return safe;
end $$;

-- 새 선점: 지워도 되는 경로만 선점하고 {claim, paths} 를 돌려준다
create or replace function public.storage_cleanup_claim(p_bucket text, p_paths text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare x text; safe text[] := '{}'; token uuid := gen_random_uuid();
begin
  for x in select distinct u from unnest(coalesce(p_paths, '{}')) u where u is not null order by 1 loop
    if not pg_try_advisory_xact_lock(6000, public.storage_path_key(p_bucket, x)) then continue; end if;
    if public.storage_path_in_use(p_bucket, x) then
      delete from public.storage_cleanup c where c.bucket = p_bucket and c.path = x and c.claim_id is null;
      continue;
    end if;
    update public.storage_cleanup c set claimed_at = now(), claim_id = token
     where c.bucket = p_bucket and c.path = x and (c.claimed_at is null or c.claimed_at < now() - interval '30 minutes');
    if found then safe := safe || x; end if;
  end loop;
  return jsonb_build_object('claim', token, 'paths', to_jsonb(safe));
end $$;

-- 파일을 지운 뒤: 내 표가 맞는 줄만 대기열에서 뺀다(지운 수를 돌려준다 · 모자라면 다른 작업이 선점을 넘겨받은 것)
create or replace function public.storage_cleanup_finish(p_bucket text, p_paths text[], p_claim uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_claim is null then return 0; end if;
  perform set_config('flavie.cleanup_claim', p_claim::text, true);
  delete from public.storage_cleanup c where c.bucket = p_bucket and c.path = any (coalesce(p_paths, '{}')) and c.claim_id = p_claim;
  get diagnostics n = row_count;
  perform set_config('flavie.cleanup_claim', '', true);
  return n;
end $$;

-- 지우지 못했을 때: 내 표가 맞는 선점만 푼다
create or replace function public.storage_cleanup_unclaim(p_bucket text, p_paths text[], p_claim uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_claim is null then return 0; end if;
  update public.storage_cleanup c set claimed_at = null, claim_id = null
   where c.bucket = p_bucket and c.path = any (coalesce(p_paths, '{}')) and c.claim_id = p_claim;
  get diagnostics n = row_count;
  return n;
end $$;

-- 예전 함수(v8): 표 없는 선점만
create or replace function public.storage_cleanup_done(p_bucket text, p_paths text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.storage_cleanup c where c.bucket = p_bucket and c.path = any (coalesce(p_paths, '{}')) and c.claimed_at is not null and c.claim_id is null;
  get diagnostics n = row_count;
  return n;
end $$;
create or replace function public.storage_cleanup_release(p_bucket text, p_paths text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.storage_cleanup c set claimed_at = null where c.bucket = p_bucket and c.path = any (coalesce(p_paths, '{}')) and c.claimed_at is not null and c.claim_id is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- 표가 붙은 선점 줄은 표가 맞는 finish 로만 지운다(표를 직접 지우는 예전 작업·다른 경로가 남의 선점을 지우지 못하게)
create or replace function public.guard_claimed_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.claim_id is not null and coalesce(current_setting('flavie.cleanup_claim', true), '') <> old.claim_id::text then
    return null;
  end if;
  return old;
end $$;
drop trigger if exists storage_cleanup_guard on public.storage_cleanup;
create trigger storage_cleanup_guard before delete on public.storage_cleanup for each row execute function public.guard_claimed_cleanup();

revoke all on function public.storage_cleanup_claim(text, text[]), public.storage_cleanup_finish(text, text[], uuid),
  public.storage_cleanup_unclaim(text, text[], uuid), public.guard_claimed_cleanup() from public, anon, authenticated;
grant execute on function public.storage_cleanup_claim(text, text[]), public.storage_cleanup_finish(text, text[], uuid),
  public.storage_cleanup_unclaim(text, text[], uuid) to service_role;
