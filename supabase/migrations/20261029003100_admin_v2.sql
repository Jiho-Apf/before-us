-- 운영진 화면 2차 다듬기(2026-10-29)
--  - 매칭 화면: 후보 목록에 사진 확인 상태·기수·지워진 계정 시절 차단 관계(held)·매칭에 쓰는 신청서 항목을 더한다.
--  - 소개 예약: 서로 원하는 상대 성별이 맞는지 서버에서도 확인한다.
--  - 다시 받기: 운영진·자동 쉬기만 푼다. 회원이 직접 건 쉬기는 사유를 적고 따로 확인해야 푼다.
--  - 신청서 결정: 같은 상태로 다시 누르면 막는다(알림이 두 번 가지 않게).
--  - 신고: 종결에는 처리 메모가 필요하고, 종결된 신고는 바꾸지 않는다.
--  - 회원 요청: 빈 답변이 이전 답변을 지우지 않고, 처리 완료에는 답변이 필요하다.
--  - 목록 함수: 신고·회원 요청·문의·감사로그·교류에 회원 이름과 지금 상태를 붙여 준다.

-- ─────────────────────────────────────────────────────────
-- 도우미: 운영진 화면에 붙일 회원 요약(이름·이메일·계정 상태·신청 상태·지금 진행 중인 소개·교류)
create or replace function public.admin_member_brief(p_member uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'email', p.email, 'status', p.status, 'pausedBy', case when p.paused_at is not null then coalesce(p.paused_by, 'member') end,
    'name', a.draft -> 'values' ->> 'self.name', 'application', a.status, 'cohort', a.cohort_number,
    'intro', (select i.status from public.introductions i where p.id in (i.member_a, i.member_b) and i.status in ('reserved', 'published', 'mutual') order by i.reveal_at desc limit 1),
    'program', (select g.status from public.programs g where p.id in (g.member_a, g.member_b) and g.status <> 'closed' order by g.created_at desc limit 1)
  ) end
    from (select 1) one
    left join public.profiles p on p.id = p_member
    left join public.applications a on a.member_id = p.id
$$;

-- ─────────────────────────────────────────────────────────
-- 소개 가능한 회원: 매칭 화면이 왼쪽·오른쪽 후보를 고르고 규칙 점수를 계산할 자료를 함께 준다.
--  held: 지워진 계정 시절 차단 관계였던 사람(서로 소개하지 않는다)
--  photos_confirmed: 필수 사진 세 장 중 ‘기준 확인’된 장수(3이어야 예약할 수 있다)
--  profile: 매칭에 쓰는 신청서 항목(이름·휴대폰·생년월일 원래 값·알림 채널·유입·진술·동의 제외)과 선호 설정
drop function if exists public.admin_ready_members();
create function public.admin_ready_members() returns table (
  member_id uuid, name text, gender text, desired text, age int, province text, area text, purpose text,
  last_published_at timestamptz, introductions int, blocked uuid[], previous uuid[], avoided uuid[], released_at timestamptz, history text[],
  waiting_since timestamptz, held uuid[], photos_confirmed int, cohort int, cohort_starts_on date, profile jsonb
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
             'preferences', coalesce(a.draft -> 'preferences', '{}'))
      from public.applications a
      join public.profiles p on p.id = a.member_id and p.status = 'active' and p.paused_at is null
     where a.status = 'approved'
       and not exists (select 1 from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status in ('reserved', 'published', 'mutual'))
     order by 14 desc nulls last, 16 asc nulls last, 9 nulls first;
end $$;

-- ─────────────────────────────────────────────────────────
-- 소개 예약: (2600 정의 그대로) + 서로 원하는 상대 성별이 맞는지 서버에서도 확인한다.
create or replace function public.admin_reserve_introduction(p_a uuid, p_b uuid, p_date date, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare reveal timestamptz; snap_a jsonb; snap_b jsonb; new_id uuid; m uuid; ga text; gb text; da text; db text;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_a = p_b then raise exception '서로 다른 두 회원이 필요해요.'; end if;
  if public.avoid_conflict(p_a, p_b) then raise exception '아는 사람 피하기로 서로 소개하지 않는 두 사람이에요.'; end if;
  if public.held_pair(p_a, p_b) then raise exception '예전 계정에서 차단 관계였던 두 사람으로 보여요. 소개할 수 없어요.'; end if;
  reveal := public.kst_at(p_date, '12:00');
  if reveal <= now() then raise exception '이미 지난 정오에는 예약할 수 없어요. 다음 정오를 골라 주세요.'; end if;
  if char_length(coalesce(trim(p_note), '')) < 10 then raise exception '두 분에게 보일 소개 이유를 10자 이상 적어 주세요.'; end if;
  foreach m in array array[p_a, p_b] loop
    if not exists (select 1 from public.applications a join public.profiles p on p.id = a.member_id
                    where a.member_id = m and a.status = 'approved' and p.status = 'active') then
      raise exception '승인된 활동 회원만 소개할 수 있어요.';
    end if;
    if exists (select 1 from public.profiles where id = m and paused_at is not null) then
      raise exception '새 소개를 쉬고 있는 회원이에요.';
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
  -- 서로 원하는 상대 성별: 성별이 ‘직접 확인’ 상태면 먼저 확인하고, 양쪽 모두 상대를 원해야 한다.
  select a.draft -> 'values' ->> 'self.gender', a.draft -> 'values' ->> 'desired.gender' into ga, da from public.applications a where a.member_id = p_a;
  select a.draft -> 'values' ->> 'self.gender', a.draft -> 'values' ->> 'desired.gender' into gb, db from public.applications a where a.member_id = p_b;
  if coalesce(ga, '') not in ('여성', '남성') or coalesce(gb, '') not in ('여성', '남성') then
    raise exception '성별을 직접 확인해야 하는 회원이 있어요. 신청서에서 성별을 먼저 확인해 주세요.';
  end if;
  if coalesce(da, '') not in (gb, '선호 없음') or coalesce(db, '') not in (ga, '선호 없음') then
    raise exception '서로 원하는 상대 성별이 맞지 않아요.';
  end if;
  if exists (select 1 from public.blocks where (member_id = p_a and blocked_id = p_b) or (member_id = p_b and blocked_id = p_a)) then
    raise exception '차단 관계인 두 사람은 소개할 수 없어요.';
  end if;
  if exists (select 1 from public.introductions i where least(i.member_a, i.member_b) = least(p_a, p_b) and greatest(i.member_a, i.member_b) = greatest(p_a, p_b) and public.blocks_reintro(i)) then
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

-- ─────────────────────────────────────────────────────────
-- 회원 상태: 다시 받기(resume)는 운영진·자동 쉬기만 푼다.
-- 회원이 직접 건 쉬기는 resume_override로만 풀고, 사유를 감사 기록에 남기며 회원에게 알린다.
create or replace function public.admin_set_member_state(p_member uuid, p_state text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; changed int; by_whom text;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_state not in ('pause', 'resume', 'resume_override', 'suspend', 'unsuspend') then raise exception '바꿀 상태를 골라 주세요.'; end if;
  if p_state = 'suspend' and coalesce(trim(p_reason), '') = '' then raise exception '이용 정지 사유를 적어 주세요(회원에게 보여요).'; end if;
  if p_state = 'resume_override' and coalesce(trim(p_reason), '') = '' then raise exception '회원이 직접 건 쉬기를 푸는 이유를 적어 주세요(감사 기록에 남아요).'; end if;
  if p_state = 'resume' then
    select case when paused_at is not null then coalesce(paused_by, 'member') end into by_whom from public.profiles where id = p_member;
    if by_whom = 'member' then raise exception '회원이 직접 쉬기로 한 상태예요. 꼭 풀어야 한다면 ‘회원 쉬기 풀기’로 사유를 적어 주세요.'; end if;
  end if;
  if p_state = 'pause' then update public.profiles set paused_at = coalesce(paused_at, now()), paused_by = 'operator', updated_at = now() where id = p_member and paused_by is distinct from 'operator';
  elsif p_state in ('resume', 'resume_override') then update public.profiles set paused_at = null, paused_by = null, updated_at = now() where id = p_member and paused_at is not null;
  elsif p_state = 'suspend' then update public.profiles set status = 'suspended', suspended_reason = trim(p_reason), updated_at = now() where id = p_member and status = 'active';
  else update public.profiles set status = 'active', suspended_reason = null, updated_at = now() where id = p_member and status = 'suspended';
  end if;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception '회원을 찾을 수 없거나 이미 그 상태예요.'; end if;
  if p_state = 'suspend' then
    for r in select id from public.introductions where p_member in (member_a, member_b) and status in ('reserved', 'published', 'mutual') loop
      perform public.close_introduction(r.id, 'suspended', p_member);
      perform public.notify_intro_ended(r.id);
    end loop;
    perform public.notify(p_member, 'account-suspended', '이용이 잠시 멈췄어요', '운영진 안내를 오늘 화면에서 확인해 주세요. 다르게 생각되면 문의·요청에서 재검토를 요청할 수 있어요.', '/today', 'suspend:' || p_member || ':' || extract(epoch from now())::bigint);
  elsif p_state = 'unsuspend' then
    perform public.notify(p_member, 'account-resumed', '다시 이용할 수 있어요', '이용 정지가 풀렸어요. 잘 맞는 분이 준비되면 정오에 소개해 드릴게요.', '/today', 'unsuspend:' || p_member || ':' || extract(epoch from now())::bigint);
  elsif p_state = 'pause' then
    perform public.notify(p_member, 'operator-paused', '새 소개를 잠시 멈췄어요', '운영진이 확인할 일이 있어 새 소개 준비를 잠시 멈췄어요. 진행 중인 소개는 그대로예요. 궁금한 점은 문의하기로 남겨 주세요.', '/today', 'opause:' || p_member || ':' || extract(epoch from now())::bigint);
  else
    perform public.notify(p_member, 'operator-resumed', '새 소개를 다시 준비해요', '운영진이 새 소개 받기를 다시 켰어요. 쉬고 싶다면 오늘 화면에서 언제든 다시 쉴 수 있어요.', '/today', 'oresume:' || p_member || ':' || extract(epoch from now())::bigint);
  end if;
  perform public.write_audit('회원 상태 변경 · ' || p_state, p_member::text, nullif(trim(coalesce(p_reason, '')), ''));
end $$;

-- 회원 목록: 누가 쉬기를 걸었는지(pausedBy)와 다시 받은 때를 더한다.
create or replace function public.admin_list_members(p_query text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(lower(trim(coalesce(p_query, ''))), '');
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(row order by (row ->> 'createdAt') desc) from (
    select jsonb_build_object(
      'id', p.id, 'email', p.email, 'status', p.status, 'pausedAt', p.paused_at, 'pausedBy', case when p.paused_at is not null then coalesce(p.paused_by, 'member') end,
      'resumedAt', p.resumed_at, 'suspendedReason', p.suspended_reason, 'createdAt', p.created_at,
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
-- 신청서 결정: (2100 정의 그대로) + 같은 상태로 다시 누르면 막는다(회원 알림이 두 번 가지 않게).
create or replace function public.admin_decide_application(p_member uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare current_status text; problem text; c public.cohorts; label text;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_status not in ('reviewing', 'approved', 'needs_changes', 'held', 'rejected') then raise exception '결정 값을 확인해 주세요.'; end if;
  select status into current_status from public.applications where member_id = p_member for update;
  if current_status is null then raise exception '신청서를 찾을 수 없어요.'; end if;
  if current_status in ('draft', 'withdrawn') then raise exception '제출된 신청서만 결정할 수 있어요.'; end if;
  if current_status = p_status then raise exception '이미 그 상태로 기록된 신청서예요.'; end if;
  if p_status in ('needs_changes', 'held', 'rejected') and coalesce(trim(p_note), '') = '' then raise exception '회원에게 보낼 안내를 적어 주세요.'; end if;
  if p_status = 'approved' and exists (select 1 from public.application_photos where member_id = p_member and review <> '기준 확인' and slot <> 'photo.daily') then
    raise exception '필수 사진 세 장을 모두 기준 확인한 뒤 승인해 주세요.';
  end if;
  if p_status = 'approved' then
    problem := public.application_problem(p_member);
    if problem is not null then raise exception '승인할 수 없어요 · %', problem; end if;
  end if;
  update public.applications
     set status = p_status, decided_at = now(), decided_by = auth.uid(),
         decision_note = case when p_status = 'reviewing' then decision_note else nullif(trim(p_note), '') end,
         updated_at = now()
   where member_id = p_member;
  if p_status = 'approved' then
    select co.* into c from public.applications a join public.cohorts co on co.number = a.cohort_number where a.member_id = p_member;
    label := case when c.number = 0 then '베타' when c.number is not null then c.number || '기' end;
    perform public.notify(p_member, 'application-approved', '소개 신청이 승인됐어요',
      case when c.starts_on is not null and c.starts_on > public.kst_today()
           then label || ' 첫 소개는 ' || to_char(c.starts_on, 'FMMM"월" FMDD"일"') || ' 정오부터예요. 잘 맞는 분이 준비되면 그날 정오에 알려 드릴게요.'
           else '잘 맞는 분이 준비되는 날 정오에 소개해 드릴게요. 매일 소개를 보장하지는 않아요.' end,
      '/today', 'decision:' || p_member || ':' || extract(epoch from now())::bigint);
  elsif p_status = 'needs_changes' then
    perform public.notify(p_member, 'application-changes', '신청서에 보완할 부분이 있어요', '운영진 안내를 확인하고 신청서를 고쳐 주세요. 다시 제출하면 바로 확인할게요.', '/apply', 'decision:' || p_member || ':' || extract(epoch from now())::bigint);
  elsif p_status = 'held' then
    perform public.notify(p_member, 'application-held', '신청서 확인이 조금 늦어지고 있어요', '운영진 안내를 오늘 화면에서 확인해 주세요.', '/today', 'decision:' || p_member || ':' || extract(epoch from now())::bigint);
  elsif p_status = 'rejected' then
    perform public.notify(p_member, 'application-rejected', '이번에는 소개를 이어 가기 어려워요', '자세한 안내는 오늘 화면에서 확인해 주세요. 궁금한 점은 문의하기로 남겨 주세요.', '/today', 'decision:' || p_member || ':' || extract(epoch from now())::bigint);
  end if;
  perform public.write_audit('신청서 결정 · ' || p_status, p_member::text);
end $$;

-- ─────────────────────────────────────────────────────────
-- 신고 처리: 종결된 신고는 바꾸지 않고, 종결에는 처리 메모가 필요하다.
create or replace function public.admin_update_report(p_id uuid, p_status text, p_resolution text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.reports; memo text := nullif(trim(coalesce(p_resolution, '')), '');
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  if p_status not in ('reviewing', 'checking', 'action', 'closed') then raise exception '상태 값을 확인해 주세요.'; end if;
  if char_length(memo) > 1000 then raise exception '처리 메모는 1000자 안으로 적어 주세요.'; end if;
  select * into r from public.reports where id = p_id for update;
  if r.id is null then raise exception '신고를 찾을 수 없어요.'; end if;
  if r.status = 'closed' then raise exception '이미 종결된 신고예요.'; end if;
  if p_status = 'closed' and coalesce(memo, nullif(trim(coalesce(r.resolution, '')), '')) is null then raise exception '종결하려면 처리 메모를 적어 주세요.'; end if;
  if p_status = r.status and memo is null then raise exception '이미 그 상태예요. 메모를 더하려면 처리 메모를 적어 주세요.'; end if;
  update public.reports set status = p_status, resolution = coalesce(memo, resolution), handled_by = auth.uid(), handled_at = now() where id = p_id;
  perform public.write_audit('신고 처리 · ' || p_status, p_id::text);
end $$;

-- 회원 요청 처리: 빈 답변은 이전 답변을 지우지 않고, 처리 완료에는 회원에게 보일 답변이 필요하다.
create or replace function public.admin_decide_request(p_id uuid, p_status text, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.member_requests; d text := nullif(trim(coalesce(p_decision, '')), '');
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  if p_status not in ('protection', 'checking', 'decided', 'reconsidering') then raise exception '상태 값을 확인해 주세요.'; end if;
  if char_length(d) > 1000 then raise exception '답변은 1000자 안으로 적어 주세요.'; end if;
  select * into r from public.member_requests where id = p_id for update;
  if r.id is null then raise exception '요청을 찾을 수 없어요.'; end if;
  if p_status = 'decided' and coalesce(d, nullif(trim(coalesce(r.decision, '')), '')) is null then raise exception '처리 완료에는 회원에게 보일 답변을 적어 주세요.'; end if;
  if p_status = r.status and d is null then raise exception '이미 그 상태예요.'; end if;
  update public.member_requests set status = p_status, decision = coalesce(d, decision), decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform public.write_audit('회원 요청 처리 · ' || p_status, p_id::text);
end $$;

-- ─────────────────────────────────────────────────────────
-- 목록 함수(운영진 화면용)
-- 신고: 신고한 분·대상의 이름과 지금 상태, 이어진 소개·교류
create or replace function public.admin_list_reports(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'source', r.source, 'type', r.type, 'description', r.description, 'urgent', r.urgent, 'status', r.status,
      'createdAt', r.created_at, 'resolution', r.resolution, 'handledAt', r.handled_at,
      'reporter', public.admin_member_brief(r.reporter_id), 'target', public.admin_member_brief(r.target_id),
      'introductionId', r.introduction_id, 'introductionStatus', i.status, 'introductionRevealAt', i.reveal_at,
      'programId', (select g.id from public.programs g where g.introduction_id = r.introduction_id limit 1),
      'programStatus', (select g.status from public.programs g where g.introduction_id = r.introduction_id limit 1)
    ) order by r.status = 'closed', r.urgent desc, r.created_at desc)
    from (select * from public.reports x where p_status is null or x.status = p_status order by x.created_at desc limit 200) r
    left join public.introductions i on i.id = r.introduction_id), '[]'::jsonb);
end $$;

-- 회원 요청: 어느 회원의 요청인지
create or replace function public.admin_list_requests(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator','counselor','finance']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'description', r.description, 'status', r.status, 'decision', r.decision, 'urgent', r.urgent,
      'createdAt', r.created_at, 'decidedAt', r.decided_at, 'member', public.admin_member_brief(r.member_id)
    ) order by r.status = 'decided', r.urgent desc, r.created_at desc)
    from (select * from public.member_requests x where p_status is null or x.status = p_status order by x.created_at desc limit 200) r), '[]'::jsonb);
end $$;

-- 고객 문의: 로그인한 회원이 남긴 문의면 이름·신청 상태·지금 진행 중인 소개를 붙인다.
create or replace function public.admin_list_inquiries(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', q.id, 'userId', q.user_id, 'type', q.type, 'name', q.name, 'email', q.email, 'body', q.body, 'status', q.status,
      'answerBody', q.answer_body, 'answeredAt', q.answered_at, 'createdAt', q.created_at,
      'member', case when q.user_id is not null then public.admin_member_brief(q.user_id) end
    ) order by q.created_at desc)
    from (select * from public.inquiries x where p_status is null or x.status = p_status order by x.created_at desc limit 200) q), '[]'::jsonb);
end $$;

-- 감사로그(대표만): 기록한 운영진 이메일과 대상 회원 이름을 붙인다. 날짜·기록 이름으로 거른다.
create or replace function public.admin_list_audit(p_from date default null, p_to date default null, p_action text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare act text := nullif(trim(coalesce(p_action, '')), '');
begin
  if not public.is_admin(array['owner']) then raise exception '대표 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.id, 'at', l.at, 'actorRole', l.actor_role, 'actorEmail', ap.email, 'action', l.action, 'target', l.target, 'reason', l.reason,
      'targetName', (select coalesce(a.draft -> 'values' ->> 'self.name', tp.email) from public.profiles tp left join public.applications a on a.member_id = tp.id where tp.id::text = l.target limit 1)
    ) order by l.id desc)
    from (select * from public.audit_log x
           where (p_from is null or x.at >= public.kst_at(p_from, '00:00'))
             and (p_to is null or x.at < public.kst_at(p_to + 1, '00:00'))
             and (act is null or x.action ilike '%' || act || '%')
           order by x.id desc limit 300) l
    left join public.profiles ap on ap.id = l.actor_id), '[]'::jsonb);
end $$;

-- 교류 목록: (1500 정의 그대로) + 두 회원 id·이메일(회원 화면으로 잇는 링크용)
create or replace function public.admin_list_programs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'introductionId', p.introduction_id, 'status', p.status, 'endReason', p.end_reason, 'createdAt', p.created_at, 'closedAt', p.closed_at,
      'memberA', p.member_a, 'memberB', p.member_b, 'emailA', pa.email, 'emailB', pb.email,
      'nameA', aa.draft -> 'values' ->> 'self.name', 'nameB', ab.draft -> 'values' ->> 'self.name',
      'planA', p.plan_a, 'planB', p.plan_b, 'startOn', p.start_on, 'agreeBy', p.agree_by, 'confirmed', (p.confirm_a is not null)::int + (p.confirm_b is not null)::int,
      'entriesA', (select count(*) from public.program_entries e where e.program_id = p.id and e.author = p.member_a and e.kind <> 'final'),
      'entriesB', (select count(*) from public.program_entries e where e.program_id = p.id and e.author = p.member_b and e.kind <> 'final'),
      'meetingAnswers', (p.meeting_a is not null)::int + (p.meeting_b is not null)::int, 'meetingBy', p.meeting_by,
      'arrangeBy', p.arrange_by, 'meetingOn', p.meeting_on, 'meetingTime', p.meeting_time, 'contacts', (p.contact_a is not null)::int + (p.contact_b is not null)::int
    ) order by p.status = 'closed', p.created_at desc)
    from public.programs p
    left join public.applications aa on aa.member_id = p.member_a
    left join public.applications ab on ab.member_id = p.member_b
    left join public.profiles pa on pa.id = p.member_a
    left join public.profiles pb on pb.id = p.member_b
    where p.status <> 'closed' or p.closed_at > now() - interval '30 days'), '[]'::jsonb);
end $$;

-- ─────────────────────────────────────────────────────────
-- 권한: 도우미는 서버 안에서만, 운영진 함수는 로그인한 사람에게 열고 함수 안에서 역할을 확인한다.
revoke all on function public.admin_member_brief(uuid) from public, anon, authenticated;
revoke all on function public.admin_ready_members(), public.admin_reserve_introduction(uuid, uuid, date, text), public.admin_set_member_state(uuid, text, text),
  public.admin_list_members(text), public.admin_decide_application(uuid, text, text), public.admin_update_report(uuid, text, text),
  public.admin_decide_request(uuid, text, text), public.admin_list_reports(text), public.admin_list_requests(text), public.admin_list_inquiries(text),
  public.admin_list_audit(date, date, text), public.admin_list_programs() from public, anon;
grant execute on function public.admin_ready_members(), public.admin_reserve_introduction(uuid, uuid, date, text), public.admin_set_member_state(uuid, text, text),
  public.admin_list_members(text), public.admin_decide_application(uuid, text, text), public.admin_update_report(uuid, text, text),
  public.admin_decide_request(uuid, text, text), public.admin_list_reports(text), public.admin_list_requests(text), public.admin_list_inquiries(text),
  public.admin_list_audit(date, date, text), public.admin_list_programs() to authenticated;
