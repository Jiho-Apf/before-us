-- 운영진 후보 목록에 ‘새 소개를 기다리기 시작한 때’(waiting_since)를 더한다.
-- 마지막 소개·교류가 끝난 때, 쉬기를 풀고 다시 받은 때, 승인된 때, 기수 첫 정오 중 가장 늦은 때.
-- 방금 마무리된 회원 다음으로, 오래 기다린 회원이 위에 온다.
drop function if exists public.admin_ready_members();
create function public.admin_ready_members() returns table (
  member_id uuid, name text, gender text, desired text, age int, province text, area text, purpose text,
  last_published_at timestamptz, introductions int, blocked uuid[], previous uuid[], avoided uuid[], released_at timestamptz, history text[],
  waiting_since timestamptz
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
           )
      from public.applications a
      join public.profiles p on p.id = a.member_id and p.status = 'active' and p.paused_at is null
     where a.status = 'approved'
       and not exists (select 1 from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status in ('reserved', 'published', 'mutual'))
     order by 14 desc nulls last, 16 asc nulls last, 9 nulls first;
end $$;

revoke all on function public.admin_ready_members() from public, anon;
grant execute on function public.admin_ready_members() to authenticated;
