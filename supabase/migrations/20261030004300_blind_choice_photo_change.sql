-- 4300: 상대의 답이 드러나지 않게 · 사진 교체 요청
--
-- 1) 서로 선택은 두 분 모두 ‘알아가고 싶어요’를 고른 순간 바로 열린다. 한 분이라도 넘긴 소개는 바로 닫지 않고
--    응답 마감(다음 날 11:00)에 함께 마무리한다. 그래야 늦게 답한 분이 상대가 이미 넘겼는지, 넘긴 분이 상대가
--    이미 답했는지 알 수 없다. 넘김으로 정해진 소개의 회원은 운영진이 바로 다음 정오로 예약할 수 있다.
-- 2) 이미 소개를 받고 있는(승인된) 회원의 확인된 사진은 내리지 않는다. 운영진은 ‘교체 요청’을 남기고(사이트·메일 알림),
--    회원이 올린 새 사진은 photo_replacements 에서 확인을 기다린다. 확인하면 그 자리에서 바꾸고, 그동안 신청 상태와
--    소개는 그대로 이어진다. 승인 전 신청서는 지금처럼 ‘재등록 요청’ → 다시 올린 사진을 확인해야 승인된다.

-- ─────────────────────────────────────────────────────────
-- 1) 답을 드러내지 않는 응답
create or replace function public.respond_introduction(p_id uuid, p_choice text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  -- 두 분 모두 ‘알아가고 싶어요’면 바로 서로 선택. 그 밖의 소개는 응답 마감에 함께 마무리한다(run_introduction_deadlines).
  if i.response_a = 'positive' and i.response_b = 'positive' then
    update public.introductions set status = 'mutual', mutual_at = now(), view_until = respond_by + interval '10 days' where id = p_id;
    perform public.notify(i.member_a, 'mutual', '두 분 모두 알아가고 싶다고 답했어요', '48시간 안에 3일 교류 방식(A 편지·B 첫 장면)과 시작일을 함께 정해 주세요.', '/exchange', 'mutual:' || p_id || ':' || i.member_a);
    perform public.notify(i.member_b, 'mutual', '두 분 모두 알아가고 싶다고 답했어요', '48시간 안에 3일 교류 방식(A 편지·B 첫 장면)과 시작일을 함께 정해 주세요.', '/exchange', 'mutual:' || p_id || ':' || i.member_b);
  end if;
  return public.my_introduction();
end $$;

-- 응답 마감: 두 분 모두 답했으면 넘김(rejected), 아니면 무응답(nonresponse)으로 마무리한다.
create or replace function public.run_introduction_deadlines() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; m uuid; own text; other text; misses int;
begin
  begin
    for r in select * from public.introductions where status = 'published' and respond_by <= now() order by respond_by for update skip locked loop
      continue when r.status <> 'published';
      perform public.close_introduction(r.id, case when r.response_a is not null and r.response_b is not null then 'rejected' else 'nonresponse' end);
      foreach m in array array[r.member_a, r.member_b] loop
        continue when m is null;
        own := case when m = r.member_a then r.response_a else r.response_b end;
        other := case when m = r.member_a then r.response_b else r.response_a end;
        if own = 'positive' and other is null then
          perform public.notify(m, 'closed', '상대가 기한 안에 답하지 않았어요', '거절이 아니라 답이 오지 않아 이번 소개가 마무리됐어요. 잘 맞는 분이 준비되면 다시 정오에 소개해 드릴게요.', '/today', 'closed:' || r.id || ':' || m);
        elsif own is not null then
          perform public.notify(m, 'closed', '이번 소개는 여기서 마무리됐어요', '다음 소개가 준비되면 정오에 알려 드릴게요.', '/today', 'closed:' || r.id || ':' || m);
        else
          perform public.notify(m, 'closed', '답 기한이 지나 소개가 마무리됐어요', '다음 소개부터는 다음 날 오전 11시 전에 답해 주세요. 두 번 이어서 답하지 않으면 새 소개를 잠시 쉬어요.', '/today', 'closed:' || r.id || ':' || m);
          -- 최근 두 소개 모두 내가 답하지 않고 끝났다면 새 소개를 잠시 쉰다.
          select count(*) into misses from (
            select i.* from public.introductions i where m in (i.member_a, i.member_b) and i.status = 'closed' order by i.closed_at desc limit 2) last2
           where last2.end_reason = 'nonresponse' and (case when last2.member_a = m then last2.response_a else last2.response_b end) is null;
          if misses = 2 then
            update public.profiles set paused_at = coalesce(paused_at, now()), paused_by = coalesce(paused_by, 'auto'), updated_at = now() where id = m and paused_at is null;
            if found then
              perform public.notify(m, 'auto-paused', '새 소개를 잠시 쉬고 있어요', '두 번 이어서 답하지 않아 새 소개를 잠시 멈췄어요. 내 정보에서 ‘다시 받기’를 누르면 다음 정오부터 다시 준비해요.', '/profile', 'autopause:' || r.id || ':' || m);
            end if;
          end if;
        end if;
      end loop;
      n := n + 1;
    end loop;
    if n > 0 then insert into public.job_runs (job, finished_at, ok, detail) values ('deadlines', now(), true, jsonb_build_object('closed', n)); end if;
  exception when others then
    insert into public.job_runs (job, finished_at, ok, detail) values ('deadlines', now(), false, jsonb_build_object('error', sqlerrm));
  end;
  return n;
end $$;

-- 아직 서로 선택이 될 수 있는 소개인지(예약·답을 기다리는 중·서로 선택). 한 분이라도 넘긴 소개는 마감에 마무리될 것이 정해져 있다.
create or replace function public.intro_open(i public.introductions) returns boolean
language sql immutable set search_path = '' as $$
  select i.status in ('reserved', 'mutual')
      or (i.status = 'published' and 'negative' not in (coalesce(i.response_a, ''), coalesce(i.response_b, '')))
$$;
revoke all on function public.intro_open(public.introductions) from public, anon, authenticated;

create or replace function public.admin_reserve_introduction(p_a uuid, p_b uuid, p_date date, p_note text, p_match jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare reveal timestamptz; snap_a jsonb; snap_b jsonb; new_id uuid; m uuid; ga text; gb text; da text; db text; why text; compat jsonb;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_a = p_b then raise exception '서로 다른 두 회원이 필요해요.'; end if;
  if public.avoid_conflict(p_a, p_b) then raise exception '아는 사람 피하기로 서로 소개하지 않는 두 사람이에요.'; end if;
  if public.held_pair(p_a, p_b) then raise exception '예전 계정에서 차단 관계였던 두 사람으로 보여요. 소개할 수 없어요.'; end if;
  reveal := public.kst_at(p_date, '12:00');
  if reveal <= now() then raise exception '이미 지난 정오에는 예약할 수 없어요. 다음 정오를 골라 주세요.'; end if;
  if char_length(coalesce(trim(p_note), '')) < 10 then raise exception '두 분에게 보일 소개 이유를 10자 이상 적어 주세요.'; end if;
  compat := public.clean_match(p_match);
  foreach m in array array[p_a, p_b] loop
    if not exists (select 1 from public.applications a join public.profiles p on p.id = a.member_id
                    where a.member_id = m and a.status = 'approved' and p.status = 'active') then
      raise exception '승인된 활동 회원만 소개할 수 있어요.';
    end if;
    if exists (select 1 from public.profiles where id = m and paused_at is not null) then
      raise exception '새 소개를 쉬고 있는 회원이에요.';
    end if;
    if exists (select 1 from public.introductions i where m in (i.member_a, i.member_b) and public.intro_open(i)) then
      raise exception '이미 진행 중이거나 예약된 소개가 있는 회원이에요.';
    end if;
    -- 넘김으로 정해져 마감을 기다리는 소개는, 그 마감 뒤 정오로만 다음 소개를 예약할 수 있다.
    if exists (select 1 from public.introductions i where m in (i.member_a, i.member_b) and i.status = 'published' and i.respond_by > reveal) then
      raise exception '지금 소개의 응답 마감 뒤 정오로 예약해 주세요.';
    end if;
    if exists (select 1 from public.introductions where m in (member_a, member_b) and status <> 'cancelled'
                and (reveal_at at time zone 'Asia/Seoul')::date = p_date) then
      raise exception '같은 날 두 번 소개할 수 없어요.';
    end if;
    if (select count(*) from public.application_photos where member_id = m and slot in ('photo.face','photo.upper','photo.style') and review = '기준 확인') < 3 then
      raise exception '필수 사진 세 장의 기준 확인이 필요해요.';
    end if;
  end loop;
  -- 서로 원하는 상대 성별: 성별이 ‘직접 확인’ 상태면 먼저 확인하고, 양쪽 모두 상대를 원해야 한다.
  select a.draft -> 'values' ->> 'self.gender', a.draft -> 'values' ->> 'desired.gender' into ga, da from public.applications a where a.member_id = p_a;
  select a.draft -> 'values' ->> 'self.gender', a.draft -> 'values' ->> 'desired.gender' into gb, db from public.applications a where a.member_id = p_b;
  if coalesce(ga, '') not in ('여성', '남성') or coalesce(gb, '') not in ('여성', '남성') then
    raise exception '성별을 직접 확인해야 하는 회원이 있어요. 신청서에서 성별을 먼저 확인해 주세요.';
  end if;
  if coalesce(da, '') not in (gb, '선호 없음') or coalesce(db, '') not in (ga, '선호 없음') then
    raise exception '서로 원하는 상대 성별이 맞지 않아요.';
  end if;
  -- 다시 소개하지 않는 두 사람(차단·신고·서로 선택·넘김·열어 본 분의 무응답·그 밖의 마무리)
  why := public.pair_reintro_reason(p_a, p_b);
  if why = 'blocked' then raise exception '차단 관계인 두 사람은 소개할 수 없어요.'; end if;
  if why = 'reported' then raise exception '신고 기록이 있는 두 사람은 다시 소개하지 않아요.'; end if;
  if why is not null then
    raise exception '이미 소개한 적 있는 두 사람이에요 · %. 다시 소개하지 않아요.',
      case why when 'mutual' then '서로 선택했던 사이예요' when 'declined' then '한 분이 넘긴 소개가 있어요'
               when 'nonresponse' then '열어 본 분이 답하지 않은 소개가 있어요' when 'active' then '진행 중인 소개가 있어요'
               else '공개된 뒤 마무리된 소개가 있어요' end;
  end if;
  snap_a := public.public_profile(p_a);
  snap_b := public.public_profile(p_b);
  insert into public.introductions (member_a, member_b, note, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, created_by, match)
  values (p_a, p_b, trim(p_note), reveal, public.kst_at(p_date + 1, '11:00'), public.kst_at(p_date + 1, '11:00'), snap_a, snap_b, auth.uid(), compat)
  returning id into new_id;
  perform public.write_audit('정오 소개 예약 · ' || p_date, new_id::text, case when compat is not null then '궁합 함께 보냄' || coalesce(' · ' || (compat ->> 'score'), '') end);
  return new_id;
end $$;

-- 소개 가능 회원: 넘김으로 정해져 마감만 기다리는 소개가 있는 회원도 다음 정오 예약 대상에 넣는다.
CREATE OR REPLACE FUNCTION public.admin_ready_members()
 RETURNS TABLE(member_id uuid, name text, gender text, desired text, age integer, province text, area text, purpose text, last_published_at timestamp with time zone, introductions integer, blocked uuid[], previous uuid[], avoided uuid[], released_at timestamp with time zone, history text[], waiting_since timestamp with time zone, held uuid[], photos_confirmed integer, cohort integer, cohort_starts_on date, profile jsonb, perk text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       and not exists (select 1 from public.introductions i where a.member_id in (i.member_a, i.member_b) and public.intro_open(i))
     order by 14 desc nulls last, 16 asc nulls last, 9 nulls first;
end $function$;

-- ─────────────────────────────────────────────────────────
-- 2) 사진 교체 요청
alter table public.application_photos
  add column if not exists change_reason text,
  add column if not exists change_requested_at timestamptz;

create table if not exists public.photo_replacements (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  slot text not null check (slot in ('photo.face', 'photo.upper', 'photo.style', 'photo.daily')),
  path text not null unique,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  bytes int not null check (bytes > 0 and bytes <= 10485760),
  width int not null check (width > 0),
  height int not null check (height > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  recent_confirmed boolean not null check (recent_confirmed),
  rights_confirmed boolean not null check (rights_confirmed),
  review text not null default '대기' check (review in ('대기', '재등록 요청')),
  reason text,
  created_at timestamptz not null default now(),
  unique (member_id, slot)
);
alter table public.photo_replacements enable row level security;
drop policy if exists "photo_replacements: 본인 조회" on public.photo_replacements;
create policy "photo_replacements: 본인 조회" on public.photo_replacements for select to authenticated using (member_id = auth.uid());
revoke insert, update, delete on public.photo_replacements from anon, authenticated;
revoke all on public.photo_replacements from anon;

-- 버린 교체 사진 파일은 저장소 정리로 지운다(확인돼 지금 사진이 된 파일은 남긴다).
create or replace function public.queue_replacement_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.application_photos where path = old.path) then
    insert into public.storage_cleanup (bucket, path) values ('application-photos', old.path) on conflict do nothing;
  end if;
  return old;
end $$;
drop trigger if exists photo_replacements_cleanup on public.photo_replacements;
create trigger photo_replacements_cleanup after delete on public.photo_replacements
  for each row execute function public.queue_replacement_cleanup();
revoke all on function public.queue_replacement_cleanup() from public, anon, authenticated;

-- 확인을 기다리는 교체 사진 파일은 회원이 저장소에서 직접 지울 수 없다(취소는 delete_photo_replacement 로).
do $$
begin
  drop policy if exists "사진: 본인 폴더에서 지우기" on storage.objects;
  create policy "사진: 본인 폴더에서 지우기" on storage.objects for delete to authenticated
    using (bucket_id = 'application-photos' and (storage.foldername(name))[1] = auth.uid()::text
           and not exists (select 1 from public.application_photos p where p.path = name)
           and not exists (select 1 from public.photo_replacements r where r.path = name));
exception when insufficient_privilege then
  raise notice '저장소 삭제 정책은 그대로 둡니다: %', sqlerrm;
end $$;

-- 예약만 된(아직 공개 전) 소개의 내 프로필 사본을 지금 사진으로 맞춘다. 공개된 소개는 그대로 둔다.
create or replace function public.refresh_reserved_snapshots(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.introductions set snapshot_a = public.public_profile(member_a) where status = 'reserved' and member_a = p_member;
  update public.introductions set snapshot_b = public.public_profile(member_b) where status = 'reserved' and member_b = p_member;
end $$;
revoke all on function public.refresh_reserved_snapshots(uuid) from public, anon, authenticated;

create or replace function public.photo_slot_label(p_slot text) returns text
language sql immutable set search_path = '' as $$
  select case p_slot when 'photo.face' then '대표 얼굴' when 'photo.upper' then '자연스러운 상반신' when 'photo.style' then '전체 스타일' when 'photo.daily' then '취향·일상' else '사진' end
$$;

create or replace function public.register_photo(p_slot text, p_path text, p_mime text, p_bytes integer, p_width integer, p_height integer, p_sha256 text, p_recent boolean, p_rights boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; st text; cur public.application_photos;
begin
  if split_part(p_path, '/', 1) <> auth.uid()::text then raise exception '본인 폴더의 사진만 등록할 수 있어요.'; end if;
  select status into st from public.applications where member_id = auth.uid();
  if st = 'approved' then
    -- 이미 소개를 받고 있는 회원: 신청 상태와 진행 중인 소개는 그대로 둔다.
    if not public.is_active_member() then raise exception '로그인한 회원만 고칠 수 있어요.'; end if;
    select * into cur from public.application_photos where member_id = auth.uid() and slot = p_slot;
    if cur.id is not null and cur.review = '기준 확인' then
      -- 확인된 사진은 내리지 않고, 새 사진을 교체 대기로 받는다. 운영진이 확인하면 그때 바뀐다.
      if exists (select 1 from public.application_photos where member_id = auth.uid() and sha256 = p_sha256)
         or exists (select 1 from public.photo_replacements where member_id = auth.uid() and sha256 = p_sha256 and slot <> p_slot) then
        raise exception '이미 올린 사진과 같은 사진이에요. 다른 사진을 골라 주세요.';
      end if;
      delete from public.photo_replacements where member_id = auth.uid() and slot = p_slot;
      insert into public.photo_replacements (member_id, slot, path, mime, bytes, width, height, sha256, recent_confirmed, rights_confirmed)
      values (auth.uid(), p_slot, p_path, p_mime, p_bytes, p_width, p_height, p_sha256, p_recent, p_rights)
      returning id into new_id;
      perform public.write_audit('사진 교체 제출', auth.uid()::text, p_slot);
      return new_id;
    end if;
    -- 확인 전이거나 다시 올려 달라고 한 칸, 비어 있던 선택 칸은 바로 바꾼다(확인 전까지 상대에게 보이지 않는다).
  else
    perform public.prepare_application_edit();
  end if;
  if exists (select 1 from public.application_photos where member_id = auth.uid() and sha256 = p_sha256 and slot <> p_slot) then
    raise exception '다른 칸에 같은 사진이 있어요. 서로 다른 사진을 골라 주세요.';
  end if;
  delete from public.photo_replacements where member_id = auth.uid() and slot = p_slot;
  delete from public.application_photos where member_id = auth.uid() and slot = p_slot;
  insert into public.application_photos (member_id, slot, path, mime, bytes, width, height, sha256, recent_confirmed, rights_confirmed)
  values (auth.uid(), p_slot, p_path, p_mime, p_bytes, p_width, p_height, p_sha256, p_recent, p_rights)
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.delete_photo(p_slot text) returns void
language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  select status into st from public.applications where member_id = auth.uid();
  if st = 'approved' then
    if not public.is_active_member() then raise exception '로그인한 회원만 고칠 수 있어요.'; end if;
    if p_slot <> 'photo.daily' then raise exception '필수 사진은 지울 수 없어요. 새 사진을 올리면 확인한 뒤 바꿔 드려요.'; end if;
    if exists (select 1 from public.introductions where auth.uid() in (member_a, member_b) and status in ('published', 'mutual'))
       or exists (select 1 from public.programs where auth.uid() in (member_a, member_b) and status <> 'closed') then
      raise exception '지금 진행 중인 소개나 교류가 있어요. 이번 소개·교류가 끝난 뒤에 지울 수 있어요.';
    end if;
  else
    perform public.prepare_application_edit();
  end if;
  delete from public.photo_replacements where member_id = auth.uid() and slot = p_slot;
  delete from public.application_photos where member_id = auth.uid() and slot = p_slot;
  if st = 'approved' then perform public.refresh_reserved_snapshots(auth.uid()); end if;
end $$;

-- 확인을 기다리는 교체 사진 취소(지금 사진은 그대로)
create or replace function public.delete_photo_replacement(p_slot text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.'; end if;
  delete from public.photo_replacements where member_id = auth.uid() and slot = p_slot;
  if not found then raise exception '취소할 사진이 없어요.'; end if;
end $$;

-- 운영진: 확인된 사진에 교체 요청 남기기(사유가 비어 있으면 요청 취소). 사진은 내리지 않는다.
create or replace function public.admin_request_photo_change(p_member uuid, p_slot text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.application_photos;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  select * into r from public.application_photos where member_id = p_member and slot = p_slot for update;
  if r.id is null then raise exception '사진을 찾을 수 없어요.'; end if;
  if coalesce(trim(p_reason), '') = '' then
    if r.change_reason is null then raise exception '남아 있는 교체 요청이 없어요.'; end if;
    update public.application_photos set change_reason = null, change_requested_at = null where id = r.id;
    perform public.write_audit('사진 교체 요청 취소', p_member::text, p_slot);
    return;
  end if;
  if r.review <> '기준 확인' then raise exception '확인을 마친 사진에만 교체를 요청할 수 있어요. 확인 전 사진은 재등록 요청을 써 주세요.'; end if;
  update public.application_photos set change_reason = trim(p_reason), change_requested_at = now() where id = r.id;
  perform public.notify(p_member, 'photo-change', '사진 한 장을 바꿔 주세요',
    public.photo_slot_label(p_slot) || ' 사진 · ' || trim(p_reason) || '. 새 사진을 올려 주시면 확인한 뒤 바꿔 드려요. 그동안 신청과 소개는 그대로 이어지고, 지금 사진도 그대로 보여요.',
    '/profile#photos', 'photo-change:' || r.id || ':' || extract(epoch from now())::bigint);
  perform public.write_audit('사진 교체 요청', p_member::text, p_slot || ' · ' || trim(p_reason));
end $$;

-- 운영진: 교체 사진 확인. ‘기준 확인’이면 그 자리에서 바꾸고(이전 파일은 열람이 끝난 뒤 정리), ‘재등록 요청’이면 지금 사진은 그대로 둔다.
create or replace function public.admin_review_replacement(p_member uuid, p_slot text, p_review text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.photo_replacements; cur public.application_photos;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_review not in ('기준 확인', '재등록 요청') then raise exception '검토 값을 확인해 주세요.'; end if;
  select * into r from public.photo_replacements where member_id = p_member and slot = p_slot for update;
  if r.id is null then raise exception '확인할 교체 사진이 없어요.'; end if;
  if p_review = '재등록 요청' then
    if coalesce(trim(p_reason), '') = '' then raise exception '재등록 사유를 골라 주세요.'; end if;
    update public.photo_replacements set review = '재등록 요청', reason = trim(p_reason) where id = r.id;
    perform public.notify(p_member, 'photo-change', '바꿀 사진을 한 번 더 골라 주세요',
      public.photo_slot_label(p_slot) || ' 사진 · ' || trim(p_reason) || '. 다른 사진으로 다시 올려 주세요. 지금 사진은 그대로 보여요.',
      '/profile#photos', 'photo-retry:' || r.id || ':' || extract(epoch from now())::bigint);
    perform public.write_audit('교체 사진 재등록 요청', p_member::text, p_slot || ' · ' || trim(p_reason));
    return;
  end if;
  if exists (select 1 from public.application_photos where member_id = p_member and sha256 = r.sha256 and slot <> p_slot) then
    raise exception '다른 칸의 사진과 같은 사진이에요. 재등록을 요청해 주세요.';
  end if;
  select * into cur from public.application_photos where member_id = p_member and slot = p_slot for update;
  if cur.id is null then
    insert into public.application_photos (member_id, slot, path, mime, bytes, width, height, sha256, recent_confirmed, rights_confirmed, review)
    values (p_member, p_slot, r.path, r.mime, r.bytes, r.width, r.height, r.sha256, true, true, '기준 확인');
  else
    insert into public.storage_cleanup (bucket, path) values ('application-photos', cur.path) on conflict do nothing;
    update public.application_photos
       set path = r.path, mime = r.mime, bytes = r.bytes, width = r.width, height = r.height, sha256 = r.sha256,
           recent_confirmed = true, rights_confirmed = true, review = '기준 확인', reason = null,
           change_reason = null, change_requested_at = null, created_at = now()
     where id = cur.id;
  end if;
  delete from public.photo_replacements where id = r.id;
  perform public.refresh_reserved_snapshots(p_member);
  perform public.notify(p_member, 'photo-changed', '새 사진으로 바꿨어요',
    public.photo_slot_label(p_slot) || ' 사진을 새 사진으로 바꿨어요. 다음 소개부터 새 사진이 보여요.',
    '/profile', 'photo-changed:' || r.id);
  perform public.write_audit('교체 사진 확인', p_member::text, p_slot);
end $$;

-- 확인된 사진을 ‘재등록 요청’으로 내리지 않는다: 이미 소개를 받고 있는 회원이면 교체 요청으로 남긴다.
create or replace function public.admin_review_photo(p_member uuid, p_slot text, p_review text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare st text; current_review text;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_review not in ('대기', '기준 확인', '재등록 요청') then raise exception '검토 값을 확인해 주세요.'; end if;
  if p_review = '재등록 요청' and coalesce(p_reason, '') = '' then raise exception '재등록 사유를 골라 주세요.'; end if;
  select a.status into st from public.applications a where a.member_id = p_member;
  select p.review into current_review from public.application_photos p where p.member_id = p_member and p.slot = p_slot;
  if st = 'approved' and current_review = '기준 확인' and p_review <> '기준 확인' then
    if p_review = '재등록 요청' then perform public.admin_request_photo_change(p_member, p_slot, p_reason); return; end if;
    raise exception '이미 소개를 받고 있는 회원의 확인된 사진은 내리지 않아요. 바꿔야 하면 교체 요청을 남겨 주세요.';
  end if;
  update public.application_photos set review = p_review, reason = case when p_review = '재등록 요청' then p_reason end
   where member_id = p_member and slot = p_slot;
  if not found then raise exception '사진을 찾을 수 없어요.'; end if;
  if st = 'approved' then perform public.refresh_reserved_snapshots(p_member); end if;
  perform public.write_audit('사진 검토 · ' || p_review, p_member::text, p_slot);
end $$;

-- 재등록 요청 알림: 접수만 된 신청서에도 보내고, 승인 전이면 새 사진을 확인하기 전까지 소개를 준비하지 않는다고 알린다.
create or replace function public.notify_photo_reupload() returns trigger
language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  select status into st from public.applications where member_id = new.member_id;
  if new.review = '재등록 요청' and old.review is distinct from new.review and st in ('submitted', 'reviewing', 'approved', 'held') then
    perform public.notify(new.member_id, 'photo-reupload', '사진 한 장을 다시 올려 주세요',
      public.photo_slot_label(new.slot) || ' 사진 · ' || coalesce(new.reason, '운영진 안내 확인') || '. 이 칸의 사진만 다시 올려 주세요. '
        || case when st = 'approved' then '확인한 뒤 상대에게 보여요.' else '새 사진을 확인하기 전까지는 소개를 준비하지 않아요.' end,
      case when st = 'approved' then '/profile#photos' else '/apply?edit=1&step=1' end,
      'photo:' || new.id || ':' || extract(epoch from now())::bigint);
  end if;
  return new;
end $$;

create or replace function public.admin_get_application(p_member uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.applications; photos jsonb; replacements jsonb;
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  select * into a from public.applications where member_id = p_member;
  if a is null then raise exception '신청서를 찾을 수 없어요.'; end if;
  if not exists (
    select 1 from public.audit_log
     where actor_id = auth.uid() and action = '회원 정보 열람' and target = p_member::text
       and (at at time zone 'Asia/Seoul')::date = public.kst_today()
  ) then
    perform public.write_audit('회원 정보 열람', p_member::text, '신청서 검토');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('slot', slot, 'path', path, 'review', review, 'reason', reason, 'width', width, 'height', height, 'createdAt', created_at,
                                               'changeReason', change_reason, 'changeRequestedAt', change_requested_at) order by slot), '[]'::jsonb)
    into photos from public.application_photos where member_id = p_member;
  select coalesce(jsonb_agg(jsonb_build_object('slot', slot, 'path', path, 'review', review, 'reason', reason, 'width', width, 'height', height, 'createdAt', created_at) order by slot), '[]'::jsonb)
    into replacements from public.photo_replacements where member_id = p_member;
  return jsonb_build_object(
    'memberId', a.member_id, 'status', a.status, 'profileVersion', a.profile_version,
    'submittedAt', a.submitted_at, 'decidedAt', a.decided_at, 'decisionNote', a.decision_note,
    'draft', public.application_for_operator(a.draft), 'photos', photos, 'replacements', replacements);
end $$;

-- 신청자 목록: 확인할 사진(확인 전 사진·교체 사진)과 남아 있는 교체 요청 수를 함께 준다.
drop function if exists public.admin_list_applications(text);
create function public.admin_list_applications(p_status text default null) returns table (
  member_id uuid, status text, submitted_at timestamptz, updated_at timestamptz, name text, gender text, desired text,
  province text, area text, age integer, source text, photo_count integer, photo_requests integer, cohort integer,
  photo_checks integer, photo_changes integer
) language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return query
    select a.member_id, a.status, a.submitted_at, a.updated_at,
           a.draft -> 'values' ->> 'self.name', a.draft -> 'values' ->> 'self.gender', a.draft -> 'values' ->> 'desired.gender',
           a.draft -> 'values' ->> 'self.province', a.draft -> 'values' ->> 'self.area',
           public.age_from(a.draft -> 'values' ->> 'self.birthDate'), a.draft -> 'values' ->> 'self.source',
           (select count(*)::int from public.application_photos p where p.member_id = a.member_id),
           (select count(*)::int from public.application_photos p where p.member_id = a.member_id and p.review = '재등록 요청'),
           a.cohort_number,
           (select count(*)::int from public.application_photos p where p.member_id = a.member_id and p.review = '대기')
             + (select count(*)::int from public.photo_replacements r where r.member_id = a.member_id and r.review = '대기'),
           (select count(*)::int from public.application_photos p where p.member_id = a.member_id and p.change_reason is not null)
      from public.applications a
      join public.profiles pr on pr.id = a.member_id and pr.status = 'active'
     where (p_status is null and a.status <> 'draft') or a.status = p_status
     order by a.submitted_at nulls last;
end $$;

revoke all on function public.admin_list_applications(text), public.admin_request_photo_change(uuid, text, text),
  public.admin_review_replacement(uuid, text, text, text), public.delete_photo_replacement(text) from public, anon;
grant execute on function public.admin_list_applications(text), public.admin_request_photo_change(uuid, text, text),
  public.admin_review_replacement(uuid, text, text, text), public.delete_photo_replacement(text) to authenticated;
