-- 운영진 매칭 참고: 두 회원의 신청서 항목을 궁합 분석(match-insight 함수)에 넘길 모양으로 돌려준다.
-- 이름·휴대폰·생년월일 원래 값·알림 채널·알게 된 경로·동의 항목·사진은 넘기지 않는다(나이는 숫자로만).
-- shared는 상대 공개로 켠 항목 id 목록 — 두 사람에게 보일 소개 이유 초안은 이 항목만 쓴다.
create or replace function public.admin_match_profiles(p_a uuid, p_b uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_a is null or p_b is null or p_a = p_b then raise exception '서로 다른 두 회원이 필요해요.'; end if;
  select jsonb_object_agg(case when a.member_id = p_a then 'a' else 'b' end, jsonb_build_object(
           'age', public.age_from(a.draft -> 'values' ->> 'self.birthDate'),
           'values', coalesce((select jsonb_object_agg(v.key, v.value) from jsonb_each(coalesce(a.draft -> 'values', '{}')) v
                                where v.key not in ('self.name', 'self.phone', 'self.birthDate', 'self.notifyChannels', 'self.source', 'self.statement', 'self.pledge')
                                  and v.key not like 'consent.%' and v.value not in ('""'::jsonb, '[]'::jsonb, 'null'::jsonb)), '{}'),
           'preferences', coalesce(a.draft -> 'preferences', '{}'),
           'shared', coalesce((select jsonb_agg(s.key) from jsonb_each(coalesce(a.draft -> 'sharing', '{}')) s where s.value <> 'false'::jsonb), '[]')))
    into result
    from public.applications a
   where a.member_id in (p_a, p_b) and a.status = 'approved';
  if result is null or not (result ? 'a' and result ? 'b') then raise exception '두 분 모두 승인된 신청서가 있어야 해요.'; end if;
  perform public.write_audit('match-insight', p_a::text || ',' || p_b::text, null);
  return result;
end $$;

revoke all on function public.admin_match_profiles(uuid, uuid) from public, anon;
grant execute on function public.admin_match_profiles(uuid, uuid) to authenticated;
