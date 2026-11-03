-- 4900: 서로 선택 알림에 소개 전 편지 소식 더하기
--   내가 써 둔 편지가 전해졌으면 ‘써 두신 편지가 함께 전해졌어요.’,
--   상대가 써 둔 편지가 왔으면 ‘상대가 소개 전에 써 둔 편지도 교류 화면에서 읽을 수 있어요.’를 덧붙인다.

CREATE OR REPLACE FUNCTION public.respond_introduction(p_id uuid, p_choice text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- 아직 모르는 당신에게: 두 분이 써 둔 편지를 이 소개에 붙인다(상대에게 보인다).
    update public.prelude_letters set introduction_id = p_id, delivered_at = now()
     where introduction_id is null and member_id in (i.member_a, i.member_b);
    -- 써 둔 편지가 전해졌는지(내 편지) · 상대가 써 둔 편지가 왔는지를 알림에 함께 적는다.
    perform public.notify(m, 'mutual', '두 분 모두 알아가고 싶다고 답했어요',
      '48시간 안에 3일 교류 방식(A 편지·B 첫 장면)과 시작일을 함께 정해 주세요.'
        || case when exists (select 1 from public.prelude_letters l where l.introduction_id = p_id and l.member_id = m) then ' 써 두신 편지가 함께 전해졌어요.' else '' end
        || case when exists (select 1 from public.prelude_letters l where l.introduction_id = p_id and l.member_id <> m) then ' 상대가 소개 전에 써 둔 편지도 교류 화면에서 읽을 수 있어요.' else '' end,
      '/exchange', 'mutual:' || p_id || ':' || m)
      from unnest(array[i.member_a, i.member_b]) m where m is not null;
  end if;
  return public.my_introduction();
end $function$;
