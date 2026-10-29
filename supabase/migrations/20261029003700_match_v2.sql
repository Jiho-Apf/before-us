-- 매칭 2차(2026-10-29)
--  1. 다시 소개하지 않는 두 사람을 넓힌다(서버가 막고, 매칭 화면 ‘자동 필터’가 까닭과 함께 거른다).
--     막음: 서로 선택했던 사이(그 뒤 교류가 어떻게 끝났든, 운영 취소여도) · 한 분이라도 ‘넘길게요’ · 신고 기록 ·
--           열어 본 분이 답하지 않은 무응답 · 차단 · 그 밖에 공개된 뒤 마무리된 소개(탈퇴·이용 정지 등)
--     예외(다시 소개할 수 있지만 운영진 화면에 노랑으로 표시): 운영 취소 · 정오 놓침 · 공개 직전 확인 · 공개 전 취소 ·
--           답하지 않은 분이 모두 프로필을 열지 않은 무응답(아무도 넘기지 않았을 때만)
--  2. 두 사람 소개 기록(admin_pair_history): 왼쪽 회원과 소개·차단·신고로 얽힌 분마다 대표 소개와 다시 소개할 수 있는지.
--  3. 회원에게 보일 궁합(introductions.match): 예약할 때 운영진 화면이 두 분 모두 ‘상대 공개’로 둔 항목만으로 만든
--     점수·한 줄 요약·이유를 함께 보낸다. 서버는 모양과 길이를 확인해 저장하고, 정오 공개부터 두 분에게만 보여 준다.
--     점수는 65 이상일 때만 숫자로 내보낸다(그 아래는 이유만).
--  4. 소개 기록(admin_list_introductions)에 저장된 궁합을 함께 준다.

-- ─────────────────────────────────────────────────────────
-- 0. 궁합 저장 칸
alter table public.introductions add column match jsonb check (match is null or jsonb_typeof(match) = 'object');

-- ─────────────────────────────────────────────────────────
-- 1. 다시 소개하지 않는 까닭(소개 한 건 기준). null이면 이 소개 때문에 막지는 않는다.
--    reported · mutual · declined · nonresponse · active(진행 중) · ended(공개 뒤 그 밖의 마무리)
create or replace function public.reintro_reason(i public.introductions) returns text
language sql stable set search_path = '' as $$
  select case
    when exists (select 1 from public.reports r where r.introduction_id = i.id) then 'reported'
    when i.mutual_at is not null or i.status = 'mutual' then 'mutual'
    when 'negative' in (coalesce(i.response_a, ''), coalesce(i.response_b, '')) then 'declined'
    when i.status = 'cancelled' or coalesce(i.end_reason, '') in ('admin-cancel', 'missed-window', 'precheck') then null
    when i.status in ('reserved', 'published') then 'active'
    when i.end_reason = 'nonresponse' then
      case when (i.response_a is not null or i.opened_a_at is null) and (i.response_b is not null or i.opened_b_at is null) then null else 'nonresponse' end
    else 'ended' end
$$;

-- 다시 소개할 수 있지만 운영진이 알아 둘 예외(막는 까닭이 있으면 null)
create or replace function public.reintro_exception(i public.introductions) returns text
language sql stable set search_path = '' as $$
  select case
    when public.reintro_reason(i) is not null then null
    when coalesce(i.end_reason, '') in ('admin-cancel', 'missed-window', 'precheck') then i.end_reason
    when i.end_reason = 'nonresponse' then 'unopened'
    when i.status = 'cancelled' then 'cancelled'
  end
$$;

-- 2600 정의를 바꾼다: 같은 두 사람을 다시 소개하지 않는 기준이 되는 소개인지(admin_ready_members.previous도 이것을 쓴다)
create or replace function public.blocks_reintro(i public.introductions) returns boolean
language sql stable set search_path = '' as $$ select public.reintro_reason(i) is not null $$;

-- 두 사람 사이에서 가장 무거운 까닭: blocked > reported > mutual > declined > nonresponse > active > ended. 없으면 null.
create or replace function public.pair_reintro_reason(p_a uuid, p_b uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    case when exists (select 1 from public.blocks b where (b.member_id = p_a and b.blocked_id = p_b) or (b.member_id = p_b and b.blocked_id = p_a)) then 'blocked' end,
    case when exists (select 1 from public.reports r where (r.reporter_id = p_a and r.target_id = p_b) or (r.reporter_id = p_b and r.target_id = p_a)) then 'reported' end,
    (select x.reason from (
        select public.reintro_reason(i) as reason, i.reveal_at from public.introductions i
         where least(i.member_a, i.member_b) = least(p_a, p_b) and greatest(i.member_a, i.member_b) = greatest(p_a, p_b)) x
      where x.reason is not null
      order by array_position(array['reported', 'mutual', 'declined', 'nonresponse', 'active', 'ended'], x.reason), x.reveal_at desc
      limit 1))
$$;

-- ─────────────────────────────────────────────────────────
-- 2. 두 사람 소개 기록(운영: 대표·운영). 왼쪽 회원과 소개·차단·신고로 얽힌 분마다 한 줄.
--    대표 소개 = 다시 소개를 막는 소개 중 가장 무거운 것(같으면 최근), 없으면 가장 최근 소개.
--    reason: 다시 소개하지 않는 까닭(blocked·reported·mutual·declined·nonresponse·active·ended), exception: 다시 소개할 수 있는 예외.
create or replace function public.admin_pair_history(p_member uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_member is null then raise exception '회원을 골라 주세요.'; end if;
  return coalesce((
    with mine as (
      select i.id, i.reveal_at, i.status, i.end_reason, i.mutual_at, i.response_a, i.response_b,
             case when i.member_a = p_member then i.member_b else i.member_a end as other,
             public.reintro_reason(i) as reason, public.reintro_exception(i) as exception
        from public.introductions i
       where p_member in (i.member_a, i.member_b) and i.member_a is not null and i.member_b is not null
    ), others as (
      select m.other from mine m
      union
      select case when b.member_id = p_member then b.blocked_id else b.member_id end from public.blocks b where p_member in (b.member_id, b.blocked_id)
      union
      select case when r.reporter_id = p_member then r.target_id else r.reporter_id end from public.reports r
       where p_member in (r.reporter_id, r.target_id) and r.reporter_id is not null and r.target_id is not null and r.reporter_id <> r.target_id
    ), lines as (
      select o.other, pick.reveal_at as at, jsonb_build_object(
        'other', o.other,
        'name', (select a.draft -> 'values' ->> 'self.name' from public.applications a where a.member_id = o.other),
        'count', (select count(*)::int from mine m where m.other = o.other and m.status <> 'cancelled'),
        'blockedRelation', exists (select 1 from public.blocks b where (b.member_id = p_member and b.blocked_id = o.other) or (b.member_id = o.other and b.blocked_id = p_member)),
        'reported', exists (select 1 from public.reports r where (r.reporter_id = p_member and r.target_id = o.other) or (r.reporter_id = o.other and r.target_id = p_member)),
        'introductionId', pick.id, 'revealAt', pick.reveal_at, 'status', pick.status, 'endReason', pick.end_reason,
        'mutual', coalesce(pick.mutual_at is not null, false),
        'declined', coalesce('negative' in (coalesce(pick.response_a, ''), coalesce(pick.response_b, '')), false),
        'programStatus', g.status, 'programEnd', g.end_reason,
        'reason', public.pair_reintro_reason(p_member, o.other),
        'exception', case when public.pair_reintro_reason(p_member, o.other) is null then pick.exception end
      ) as item
        from others o
        left join lateral (
          select m.* from mine m where m.other = o.other
           order by array_position(array['reported', 'mutual', 'declined', 'nonresponse', 'active', 'ended'], m.reason) nulls last, m.reveal_at desc
           limit 1) pick on true
        left join public.programs g on g.introduction_id = pick.id
       where o.other is not null and o.other <> p_member
    )
    select jsonb_agg(l.item order by l.at desc nulls last) from lines l
  ), '[]'::jsonb);
end $$;

-- ─────────────────────────────────────────────────────────
-- 3. 회원에게 보일 궁합: 모양·길이 확인 후 정리해서 돌려준다(없으면 null).
--    { score: 0~100 정수 | null, headline: 4~80자, why: 1~3개, together: 1~3개(각 4~140자) } · 연락처·링크는 막는다.
create or replace function public.clean_match(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare k text; s numeric; head text; item jsonb; part text; t text; why jsonb := '[]'::jsonb; together jsonb := '[]'::jsonb;
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) <> 'object' then raise exception '궁합 내용의 형식을 확인해 주세요.'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('version', 'score', 'headline', 'why', 'together') then raise exception '궁합 내용에 알 수 없는 항목이 있어요(%).', k; end if;
  end loop;
  if coalesce(jsonb_typeof(p -> 'score'), 'null') <> 'null' then
    if jsonb_typeof(p -> 'score') <> 'number' then raise exception '궁합 점수는 숫자로 보내 주세요.'; end if;
    s := (p ->> 'score')::numeric;
    if s < 0 or s > 100 or s <> trunc(s) then raise exception '궁합 점수는 0~100 사이의 정수로 보내 주세요.'; end if;
  end if;
  if coalesce(jsonb_typeof(p -> 'headline'), '') <> 'string' then raise exception '궁합 한 줄 요약이 필요해요.'; end if;
  head := regexp_replace(btrim(p ->> 'headline'), '\s+', ' ', 'g');
  if char_length(head) not between 4 and 80 then raise exception '궁합 한 줄 요약은 4~80자로 보내 주세요.'; end if;
  if public.has_contact(head) then raise exception '궁합 내용에 연락처·링크는 넣을 수 없어요.'; end if;
  foreach part in array array['why', 'together'] loop
    if coalesce(jsonb_typeof(p -> part), '') <> 'array' or jsonb_array_length(p -> part) not between 1 and 3 then
      raise exception '궁합 이유는 ‘왜 어울리는지’와 ‘함께일 때 빛나는 점’에 각각 1~3개씩 보내 주세요.';
    end if;
    for item in select value from jsonb_array_elements(p -> part) loop
      if jsonb_typeof(item) <> 'string' then raise exception '궁합 이유는 글로 보내 주세요.'; end if;
      t := regexp_replace(btrim(item #>> '{}'), '\s+', ' ', 'g');
      if char_length(t) not between 4 and 140 then raise exception '궁합 이유는 하나에 4~140자로 보내 주세요.'; end if;
      if public.has_contact(t) then raise exception '궁합 내용에 연락처·링크는 넣을 수 없어요.'; end if;
      if part = 'why' then why := why || to_jsonb(t); else together := together || to_jsonb(t); end if;
    end loop;
  end loop;
  if jsonb_array_length(why) + jsonb_array_length(together) > 5 then raise exception '궁합 이유는 모두 합쳐 5개까지 보내 주세요.'; end if;
  return jsonb_build_object('version', 1, 'score', s::int, 'headline', head, 'why', why, 'together', together);
end $$;

-- 회원에게 내보낼 모양: 점수는 65 이상일 때만 숫자로(그 아래는 null), 이유는 그대로.
create or replace function public.member_match(m jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when m is null or jsonb_typeof(m) <> 'object' then null else jsonb_build_object(
    'score', case when jsonb_typeof(m -> 'score') = 'number' and (m ->> 'score')::numeric >= 65 then (m ->> 'score')::int end,
    'headline', m ->> 'headline',
    'why', coalesce(m -> 'why', '[]'::jsonb),
    'together', coalesce(m -> 'together', '[]'::jsonb)) end
$$;

-- ─────────────────────────────────────────────────────────
-- 소개 예약: (3100 정의 그대로) + 넓힌 재소개 기준(까닭을 말해 준다) + 회원에게 보일 궁합(p_match, 선택).
-- 인자 하나를 더하므로 예전 것을 지우고 다시 만든다(PostgREST가 한 가지 모양만 보게).
drop function if exists public.admin_reserve_introduction(uuid, uuid, date, text);
create function public.admin_reserve_introduction(p_a uuid, p_b uuid, p_date date, p_note text, p_match jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
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

-- ─────────────────────────────────────────────────────────
-- 회원의 지금 소개(2600 정의 그대로) + 궁합: 열람 기간(정오 공개 ~ 응답 마감, 서로 선택이면 교류가 끝날 때까지)에만 두 분에게.
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
    'match', case when readable then public.member_match(i.match) end,
    'profile', case when readable then (case when is_a then i.snapshot_b else i.snapshot_a end) end,
    'ownResponse', case when is_a then i.response_a else i.response_b end,
    'ownResponseAt', case when is_a then i.response_a_at else i.response_b_at end,
    'opened', (case when is_a then i.opened_a_at else i.opened_b_at end) is not null,
    'mutual', i.status = 'mutual',
    'endReason', i.end_reason,
    'endedByMe', i.ended_by is not distinct from me and i.ended_by is not null,
    'counted', case when is_a then i.count_a else i.count_b end,
    'closedAt', i.closed_at
  );
end $$;

-- ─────────────────────────────────────────────────────────
-- 4. 소개 기록(0300 정의) + 저장된 궁합(운영진은 65 미만 점수도 본다)
drop function if exists public.admin_list_introductions(date);
create function public.admin_list_introductions(p_from date default null) returns table (
  id uuid, status text, reveal_at timestamptz, respond_by timestamptz, member_a uuid, member_b uuid,
  name_a text, name_b text, response_a text, response_b text, opened_a boolean, opened_b boolean, end_reason text, note text,
  mutual boolean, match jsonb
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return query
    select i.id, i.status, i.reveal_at, i.respond_by, i.member_a, i.member_b,
           (select a.draft -> 'values' ->> 'self.name' from public.applications a where a.member_id = i.member_a),
           (select a.draft -> 'values' ->> 'self.name' from public.applications a where a.member_id = i.member_b),
           i.response_a, i.response_b, i.opened_a_at is not null, i.opened_b_at is not null, i.end_reason, i.note,
           i.mutual_at is not null, i.match
      from public.introductions i
     where p_from is null or i.reveal_at >= public.kst_at(p_from, '00:00')
     order by i.reveal_at desc
     limit 200;
end $$;

-- ─────────────────────────────────────────────────────────
-- 권한: 도우미는 서버 안에서만, 운영진·회원 함수는 로그인한 사람에게 열고 함수 안에서 역할·본인을 확인한다.
revoke all on function public.reintro_reason(public.introductions), public.reintro_exception(public.introductions), public.blocks_reintro(public.introductions),
  public.pair_reintro_reason(uuid, uuid), public.clean_match(jsonb), public.member_match(jsonb) from public, anon, authenticated;
revoke all on function public.admin_pair_history(uuid), public.admin_reserve_introduction(uuid, uuid, date, text, jsonb),
  public.admin_list_introductions(date), public.my_introduction() from public, anon;
grant execute on function public.admin_pair_history(uuid), public.admin_reserve_introduction(uuid, uuid, date, text, jsonb),
  public.admin_list_introductions(date), public.my_introduction() to authenticated;
