-- 4500: 사진 교체 7일 기한 · 교류 뒤 한 줄 회고(다음 소개에 반영)
--
-- 1) 운영진이 사진 교체를 요청하고 7일이 지나도 새 사진을 올리지 않으면 새 소개를 잠시 멈춘다.
--    따로 다시 알리지는 않고(대표 결정), 새 사진을 올리면(확인 대기) 바로 풀린다. 진행 중인 소개는 그대로다.
-- 2) 교류를 마친 회원은 운영진에게만 보이는 ‘다음 소개를 위한 한 줄’을 남길 수 있다(교류가 끝나고 30일 안).
--    운영진이 그 한 줄을 반영해 다음 소개를 예약하면, 소개를 받을 때 ‘남겨 주신 한 줄을 참고해 골랐어요’가 보인다.
--    한 줄은 상대에게 보이지 않고, 탈퇴하면 지우며, 1년이 지나면 지운다.

-- ─────────────────────────────────────────────────────────
-- 1) 사진 교체 7일 기한
-- 새 소개를 멈추기 시작하는 때(남아 있는 교체 요청 중 가장 이른 것 + 7일). 확인을 기다리는 새 사진이 있는 칸은 세지 않는다. 없으면 null.
create or replace function public.photo_hold_at(p_member uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select min(p.change_requested_at) + interval '7 days'
    from public.application_photos p
   where p.member_id = p_member and p.change_reason is not null and p.change_requested_at is not null
     and not exists (select 1 from public.photo_replacements r where r.member_id = p.member_id and r.slot = p.slot and r.review = '대기')
$$;
revoke all on function public.photo_hold_at(uuid) from public, anon, authenticated;

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
    public.photo_slot_label(p_slot) || ' 사진 · ' || trim(p_reason) || '. 새 사진을 올려 주시면 확인한 뒤 바꿔 드려요. 그동안 지금 사진이 그대로 보여요. '
      || to_char((now() + interval '7 days') at time zone 'Asia/Seoul', 'FMMM"월" FMDD"일"') || '까지 올리지 않으면 새 소개를 잠시 멈춰요(진행 중인 소개는 그대로예요).',
    '/profile#photos', 'photo-change:' || r.id || ':' || extract(epoch from now())::bigint);
  perform public.write_audit('사진 교체 요청', p_member::text, p_slot || ' · ' || trim(p_reason));
end $$;

-- ─────────────────────────────────────────────────────────
-- 2) 교류 뒤 한 줄 회고
create table if not exists public.reflections (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  program_id uuid references public.programs (id) on delete set null,
  body text not null check (char_length(body) between 5 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  used_at timestamptz,
  used_intro uuid references public.introductions (id) on delete set null,
  unique (member_id, program_id)
);
alter table public.reflections enable row level security;
drop policy if exists "reflections: 본인 조회" on public.reflections;
create policy "reflections: 본인 조회" on public.reflections for select to authenticated using (member_id = auth.uid());
revoke insert, update, delete on public.reflections from anon, authenticated;
revoke all on public.reflections from anon;

alter table public.introductions
  add column if not exists reflected_a boolean not null default false,
  add column if not exists reflected_b boolean not null default false;

-- 회원: 마친 교류에 한 줄 남기기(다시 쓰면 고친다). 운영진이 반영한 뒤에는 고칠 수 없다.
create or replace function public.save_reflection(p_program uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); clean text := trim(coalesce(p_body, '')); r public.reflections;
begin
  if me is null or not public.is_active_member() then raise exception '로그인한 회원만 남길 수 있어요.'; end if;
  select * into p from public.programs where id = p_program;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'closed' or p.started_at is null then raise exception '교류를 마친 뒤에 남길 수 있어요.'; end if;
  if p.closed_at < now() - interval '30 days' then raise exception '교류를 마친 지 30일이 지나 남길 수 없어요.'; end if;
  if char_length(clean) < 5 or char_length(clean) > 200 then raise exception '5~200자로 적어 주세요.'; end if;
  if public.has_contact(normalize(clean, NFKC)) then raise exception '연락처·SNS 아이디·링크는 적을 수 없어요.'; end if;
  select * into r from public.reflections where member_id = me and program_id = p_program for update;
  if r.used_at is not null then raise exception '이미 다음 소개에 반영한 한 줄이라 고칠 수 없어요.'; end if;
  insert into public.reflections (member_id, program_id, body) values (me, p_program, clean)
  on conflict (member_id, program_id) do update set body = excluded.body, updated_at = now()
  returning * into r;
  return jsonb_build_object('programId', r.program_id, 'body', r.body, 'usedAt', r.used_at, 'updatedAt', r.updated_at);
end $$;

create or replace function public.delete_reflection(p_program uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.'; end if;
  delete from public.reflections where member_id = auth.uid() and program_id = p_program and used_at is null;
  if not found then raise exception '지울 수 있는 한 줄이 없어요.'; end if;
end $$;

-- 운영진 신청서·매칭 화면: 최근 한 줄 다섯 개(반영 여부 · 만남까지 이어졌는지)
create or replace function public.admin_get_application(p_member uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.applications; photos jsonb; replacements jsonb; notes jsonb;
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
  select coalesce(jsonb_agg(jsonb_build_object('body', x.body, 'createdAt', x.created_at, 'usedAt', x.used_at, 'met', x.met) order by x.created_at desc), '[]'::jsonb)
    into notes from (
      select r.body, r.created_at, r.used_at, pr.end_reason = 'completed' met
        from public.reflections r left join public.programs pr on pr.id = r.program_id
       where r.member_id = p_member order by r.created_at desc limit 5) x;
  return jsonb_build_object(
    'memberId', a.member_id, 'status', a.status, 'profileVersion', a.profile_version,
    'submittedAt', a.submitted_at, 'decidedAt', a.decided_at, 'decisionNote', a.decision_note,
    'draft', public.application_for_operator(a.draft), 'photos', photos, 'replacements', replacements,
    'reflections', notes, 'photoHoldAt', public.photo_hold_at(p_member));
end $$;

-- 예약: 사진 교체 기한이 소개 전에 지나는 회원은 막고, 반영한 한 줄은 그 소개에 표시한다(p_reflected = 한 줄을 반영한 회원).
drop function if exists public.admin_reserve_introduction(uuid, uuid, date, text, jsonb);
create function public.admin_reserve_introduction(p_a uuid, p_b uuid, p_date date, p_note text, p_match jsonb default null, p_reflected uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare reveal timestamptz; snap_a jsonb; snap_b jsonb; new_id uuid; m uuid; ga text; gb text; da text; db text; why text; compat jsonb; hold timestamptz; used int;
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
    hold := public.photo_hold_at(m);
    if hold is not null and hold <= reveal then
      raise exception '사진 교체 요청 뒤 7일이 지나(%부터) 새 소개를 멈추는 회원이에요. 새 사진을 받은 뒤 예약해 주세요.', to_char(hold at time zone 'Asia/Seoul', 'FMMM"월" FMDD"일" HH24:MI');
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
  -- 반영한 한 줄: 아직 반영하지 않은 한 줄이 있는 회원만 표시한다(없으면 표시하지 않음).
  foreach m in array array[p_a, p_b] loop
    continue when not (m = any(coalesce(p_reflected, '{}')));
    update public.reflections set used_at = now(), used_intro = new_id where member_id = m and used_at is null;
    get diagnostics used = row_count;
    if used > 0 then
      update public.introductions set reflected_a = reflected_a or m = p_a, reflected_b = reflected_b or m = p_b where id = new_id;
    end if;
  end loop;
  perform public.write_audit('정오 소개 예약 · ' || p_date, new_id::text, concat_ws(' · ',
    case when compat is not null then '궁합 함께 보냄' || coalesce(' · ' || (compat ->> 'score'), '') end,
    case when exists (select 1 from public.introductions where id = new_id and (reflected_a or reflected_b)) then '회고 반영' end));
  return new_id;
end $$;
revoke all on function public.admin_reserve_introduction(uuid, uuid, date, text, jsonb, uuid[]) from public, anon;
grant execute on function public.admin_reserve_introduction(uuid, uuid, date, text, jsonb, uuid[]) to authenticated;

-- 회원의 소개 화면: 내가 남긴 한 줄을 반영해 고른 소개인지
create or replace function public.my_introduction() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.introductions; me uuid := auth.uid(); is_a boolean; readable boolean;
begin
  if me is null then return null; end if;
  select * into i from public.introductions
   where me in (member_a, member_b) and status in ('published', 'mutual', 'closed') and reveal_at <= now()
   order by reveal_at desc limit 1;
  if i.id is null then
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
    'match', case when readable and (case when is_a then i.response_a else i.response_b end) is distinct from 'negative' then public.member_match(i.match) end,
    'profile', case when readable then (case when is_a then i.snapshot_b else i.snapshot_a end) end,
    'ownResponse', case when is_a then i.response_a else i.response_b end,
    'ownResponseAt', case when is_a then i.response_a_at else i.response_b_at end,
    'opened', (case when is_a then i.opened_a_at else i.opened_b_at end) is not null,
    'mutual', i.status = 'mutual',
    'endReason', i.end_reason,
    'endedByMe', i.ended_by is not distinct from me and i.ended_by is not null,
    'counted', case when is_a then i.count_a else i.count_b end,
    'closedAt', i.closed_at,
    'reflected', case when is_a then i.reflected_a else i.reflected_b end
  );
end $$;

revoke all on function public.save_reflection(uuid, text), public.delete_reflection(uuid) from public, anon;
grant execute on function public.save_reflection(uuid, text), public.delete_reflection(uuid) to authenticated;

-- 소개 가능 회원: 사진 교체 기한(요청 뒤 7일)이 지난 회원은 뺀다.
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
       and coalesce(public.photo_hold_at(a.member_id) > now(), true)
     order by 14 desc nulls last, 16 asc nulls last, 9 nulls first;
end $function$;

-- 보존 정리: 교류 뒤 한 줄은 1년이 지나면 지운다.
CREATE OR REPLACE FUNCTION public.run_retention()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare run_id bigint; result jsonb; members int; snapshots int; inquiries int; audits int; notes int; test_payments int;
begin
  insert into public.job_runs (job) values ('retention') returning id into run_id;
  begin
    with gone as (
      delete from auth.users u using public.profiles p
       where p.id = u.id and p.status = 'withdrawal_requested' and p.deletion_due_at <= now()
      returning u.id)
    select count(*) into members from gone;

    with cleared as (
      update public.introductions
         set snapshot_a = jsonb_build_object('deleted', true), snapshot_b = jsonb_build_object('deleted', true), match = null
       where status in ('closed', 'cancelled') and closed_at <= now() - interval '30 days' and not (snapshot_a ? 'deleted')
      returning id)
    select count(*) into snapshots from cleared;
    -- 예전에 사본만 지워지고 궁합이 남은 소개도 함께 정리한다.
    update public.introductions set match = null where match is not null and snapshot_a ? 'deleted';

    with old as (delete from public.inquiries where status = 'answered' and answered_at <= now() - interval '3 years' returning id)
    select count(*) into inquiries from old;

    -- 테스트 결제(실제로 돈이 오가지 않은 기록)는 90일 뒤 지운다. 실제(라이브) 결제는 법에서 정한 기간 동안 남긴다.
    with old as (delete from public.payments where mode = 'test' and created_at <= now() - interval '90 days' returning id)
    select count(*) into test_payments from old;

    perform set_config('before_us.retention', 'on', true);
    with old as (delete from public.audit_log where at <= now() - interval '365 days' returning id)
    select count(*) into audits from old;
    perform set_config('before_us.retention', 'off', true);

    with old as (delete from public.notifications where read_at <= now() - interval '90 days' returning id)
    select count(*) into notes from old;
    delete from public.reflections where created_at <= now() - interval '1 year';
    delete from public.job_runs where started_at <= now() - interval '90 days' and id <> run_id;

    result := jsonb_build_object('members', members, 'snapshots', snapshots, 'inquiries', inquiries, 'audits', audits, 'notifications', notes, 'testPayments', test_payments);
    update public.job_runs set finished_at = now(), ok = true, detail = result where id = run_id;
  exception when others then
    result := jsonb_build_object('error', sqlerrm);
    update public.job_runs set finished_at = now(), ok = false, detail = result where id = run_id;
  end;
  return result;
end $function$;
