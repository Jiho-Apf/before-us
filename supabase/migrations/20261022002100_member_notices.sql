-- 회원 알림 다듬기
--  - 신청서 결정(승인·보완 요청·보류·어려움)을 회원에게 알린다(전에는 오늘 화면에서만 보였다).
--  - 교류 알림 문장 다듬기(‘편지이(가)’ → ‘편지가’), 서로 선택 알림은 교류 화면으로 바로 이어지게.

create or replace function public.admin_decide_application(p_member uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare current_status text; problem text; c public.cohorts; label text;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_status not in ('reviewing', 'approved', 'needs_changes', 'held', 'rejected') then raise exception '결정 값을 확인해 주세요.'; end if;
  select status into current_status from public.applications where member_id = p_member for update;
  if current_status is null then raise exception '신청서를 찾을 수 없어요.'; end if;
  if current_status in ('draft', 'withdrawn') then raise exception '제출된 신청서만 결정할 수 있어요.'; end if;
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
  -- 회원에게 결과를 알린다(사이트 알림 + 메일을 고른 회원은 메일). 보완·보류·어려움의 자세한 사유는 오늘 화면에서만 보인다.
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

create or replace function public.submit_program_entry(p_program uuid, p_day int, p_kind text, p_body text, p_payload jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); plan text; day_date date; body text := nullif(trim(coalesce(p_body, '')), ''); n int; partner uuid;
  label text := case p_kind when 'letter' then '편지' when 'reply' then '답장' else '첫 장면' end;
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'started' then raise exception '교류가 열려 있을 때만 보낼 수 있어요.'; end if;
  plan := p.plan_a; partner := public.program_partner(p, me);
  if p_kind not in ('letter', 'reply', 'scene') or p_day not between 1 and 3 then raise exception '보낼 글을 확인해 주세요.'; end if;
  if (p_kind in ('letter', 'reply') and plan <> 'A') or (p_kind = 'scene' and plan <> 'B') then raise exception '이 교류 방식에서 쓰는 글이 아니에요.'; end if;
  day_date := p.start_on + p_day - 1;
  if public.kst_date(public.app_now()) <> day_date or public.app_now() < public.kst_at(day_date, '09:00') then
    raise exception '그날의 글은 그날 09:00~23:59(한국 시간)에만 쓸 수 있어요.';
  end if;
  if p_kind = 'reply' and (select count(*) from public.program_entries where program_id = p.id and day = p_day and kind = 'letter') < 2 then
    raise exception '그날의 편지가 두 분 모두에게 열린 뒤에 답장할 수 있어요.';
  end if;
  if p_kind = 'letter' and (body is null or char_length(body) < 20) then raise exception '편지는 20자 이상 써 주세요.'; end if;
  if p_kind = 'reply' and (body is null or char_length(body) > 600) then raise exception '답장은 1~600자로 써 주세요.'; end if;
  if p_kind = 'scene' then
    if jsonb_typeof(p_payload) is distinct from 'object' or char_length(p_payload::text) > 1000 then raise exception '첫 장면 답을 확인해 주세요.'; end if;
    if p_day = 1 and coalesce(p_payload ->> 'activity', '') not in ('exhibition', 'walk', 'bookstore') then raise exception '시작하고 싶은 분위기를 골라 주세요.'; end if;
    if p_day = 2 and (coalesce(p_payload ->> 'flow', '') not in ('짧게 둘러보기', '천천히 머물기') or coalesce(p_payload ->> 'rest', '') not in ('조용한 카페', '공공 야외 공간')) then raise exception '흐름과 쉬어 갈 곳을 골라 주세요.'; end if;
    if p_day = 3 and coalesce(trim(p_payload ->> 'topic'), '') = '' then raise exception '함께 나누고 싶은 이야기를 적어 주세요.'; end if;
    if body is not null and char_length(body) > 300 then raise exception '이유는 300자 안으로 적어 주세요.'; end if;
  end if;
  perform public.check_member_text(concat_ws(' ', body, p_payload::text), '교류 ' || label);
  if exists (select 1 from public.program_entries where program_id = p.id and day = p_day and kind = p_kind and author = me) then
    raise exception '이미 보낸 %은(는) 고치거나 다시 보낼 수 없어요.', label;
  end if;
  insert into public.program_entries (program_id, day, kind, author, body, payload) values (p.id, p_day, p_kind, me, body, case when p_kind = 'scene' then p_payload end);
  select count(*) into n from public.program_entries where program_id = p.id and day = p_day and kind = p_kind;
  if n = 2 then
    perform public.notify(m, 'program-open', 'DAY0' || p_day || ' ' || case p_kind when 'letter' then '편지가' when 'reply' then '답장이' else '첫 장면 답이' end || ' 열렸어요', '두 분이 모두 보내서 함께 열렸어요.', '/exchange', 'open:' || p.id || ':' || p_day || ':' || p_kind || ':' || m)
      from unnest(array[p.member_a, p.member_b]) m;
  else
    perform public.notify(partner, 'program-sent', '상대가 오늘의 ' || case p_kind when 'letter' then '편지를' when 'reply' then '답장을' else '첫 장면 답을' end || ' 보냈어요', '내 글도 보내면 23:59 전에 함께 열려요.', '/exchange', 'sent:' || p.id || ':' || p_day || ':' || p_kind || ':' || me);
  end if;
  return public.my_program();
end $$;

create or replace function public.respond_introduction(p_id uuid, p_choice text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
  if i.response_a is not null and i.response_b is not null then
    if i.response_a = 'positive' and i.response_b = 'positive' then
      update public.introductions set status = 'mutual', mutual_at = now(), view_until = respond_by + interval '10 days' where id = p_id;
      perform public.notify(i.member_a, 'mutual', '두 분 모두 알아가고 싶다고 답했어요', '48시간 안에 3일 교류 방식(A 편지·B 첫 장면)과 시작일을 함께 정해 주세요.', '/exchange', 'mutual:' || p_id || ':' || i.member_a);
      perform public.notify(i.member_b, 'mutual', '두 분 모두 알아가고 싶다고 답했어요', '48시간 안에 3일 교류 방식(A 편지·B 첫 장면)과 시작일을 함께 정해 주세요.', '/exchange', 'mutual:' || p_id || ':' || i.member_b);
    else
      perform public.close_introduction(p_id, 'rejected');
      perform public.notify(i.member_a, 'closed', '이번 소개는 여기서 마무리됐어요', '다음 소개가 준비되면 정오에 알려 드릴게요.', '/today', 'closed:' || p_id || ':' || i.member_a);
      perform public.notify(i.member_b, 'closed', '이번 소개는 여기서 마무리됐어요', '다음 소개가 준비되면 정오에 알려 드릴게요.', '/today', 'closed:' || p_id || ':' || i.member_b);
    end if;
  end if;
  return public.my_introduction();
end $$;
