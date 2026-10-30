-- 4400: 넷째 날 만남 선택도 상대의 답이 드러나지 않게.
-- 두 분 모두 ‘만나고 싶어요’면 바로 약속 정하기가 열리고, 한 분이라도 ‘여기까지’면 바로 닫지 않고
-- 만남 선택 마감(다음 날 09:00)에 함께 마무리한다(소개 응답과 같은 원칙 · 4300).

create or replace function public.choose_meeting(p_program uuid, p_choice text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid();
begin
  if p_choice not in ('positive', 'negative') then raise exception '답을 골라 주세요.'; end if;
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'deciding' or public.app_now() >= p.meeting_by then raise exception '지금은 만남을 고를 수 없어요.'; end if;
  if (case when p.member_a = me then p.meeting_a else p.meeting_b end) is not null then raise exception '이미 골랐어요. 답은 바꿀 수 없어요.'; end if;
  if p.member_a = me then update public.programs set meeting_a = p_choice, meeting_a_at = now(), updated_at = now() where id = p.id returning * into p;
  else update public.programs set meeting_b = p_choice, meeting_b_at = now(), updated_at = now() where id = p.id returning * into p; end if;
  -- 두 분 모두 만나고 싶을 때만 바로 연다. 그 밖에는 마감에 함께 마무리한다(run_programs).
  if p.meeting_a = 'positive' and p.meeting_b = 'positive' then
    update public.programs set status = 'arranging', arrange_by = now() + interval '7 days', updated_at = now() where id = p.id;
    perform public.notify(m, 'meeting-mutual', '두 분 모두 만나고 싶다고 했어요', '7일 안에 약속을 함께 정해 주세요.', '/meeting', 'meet:' || p.id || ':' || m) from unnest(array[p.member_a, p.member_b]) m;
  end if;
  return public.my_program();
end $$;

-- 만남 선택 마감: 두 분 모두 답했으면 ‘만남 안 함’(누가 어떤 답을 했는지는 알리지 않음), 아니면 무응답으로 마무리한다.
CREATE OR REPLACE FUNCTION public.run_programs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; t timestamptz := public.app_now(); d int; n jsonb := '{}'::jsonb; c int := 0;
begin
  begin
  for r in select * from public.programs where status = 'choosing' and agree_by <= t for update skip locked loop
    continue when r.status <> 'choosing';
    perform public.close_program(r.id, 'agreement-expired');
    perform public.notify(m, 'program-closed', '교류 방식이 정해지지 않았어요', '합의 기한(48시간)이 지나 이번 소개는 여기서 마무리돼요. 다음 소개를 준비할게요.', '/today', 'pclosed:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m where m is not null;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('expired', c); c := 0;
  for r in select * from public.programs where status = 'scheduled' and t >= public.kst_at(start_on, '09:00') loop
    update public.programs set status = 'started', started_at = t, updated_at = now() where id = r.id and status = 'scheduled';
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('started', c); c := 0;
  for r in select * from public.programs where status = 'started' loop
    for d in 1..3 loop
      if t >= public.kst_at(r.start_on + d - 1, '09:00') and public.kst_date(t) = r.start_on + d - 1 then
        perform public.notify(m, 'program-day', 'DAY0' || d || '이 열렸어요', case when d > 1 and (select count(*) from public.program_entries e where e.program_id = r.id and e.day = d - 1 and e.kind in ('letter', 'scene')) = 2 then case when r.plan_a = 'A' then '어제 편지가 함께 열렸어요. ' else '어제 첫 장면 답이 함께 열렸어요. ' end else '' end || case when r.plan_a = 'A' then '오늘의 편지를 23:59까지 보내 주세요.' else '오늘의 첫 장면 질문에 23:59까지 답해 주세요.' end, '/exchange', 'day:' || r.id || ':' || d || ':' || m)
          from unnest(array[r.member_a, r.member_b]) m where m is not null;
      end if;
    end loop;
    if t >= public.kst_at(r.start_on + 3, '09:00') then
      update public.programs set status = 'deciding', meeting_by = public.kst_at(r.start_on + 3, '09:00') + interval '24 hours', updated_at = now() where id = r.id and status = 'started';
      perform public.notify(m, 'meeting-open', '만남을 정할 시간이에요', case when (select count(*) from public.program_entries e where e.program_id = r.id and e.day = 3 and e.kind in ('letter', 'scene')) = 2 then 'DAY03 글도 함께 열렸어요. ' else '' end || '내일 09:00까지 만나고 싶은지 골라 주세요. 상대의 답은 알려 드리지 않아요.', '/exchange', 'decide:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m where m is not null;
      c := c + 1;
    end if;
  end loop;
  n := n || jsonb_build_object('deciding', c); c := 0;
  for r in select * from public.programs where status = 'deciding' and meeting_by <= t for update skip locked loop
    continue when r.status <> 'deciding';
    perform public.close_program(r.id, case when r.meeting_a is not null and r.meeting_b is not null then 'meeting-declined' else 'meeting-nonresponse' end);
    perform public.notify(m, 'program-closed', '이번 교류는 여기서 마무리됐어요',
      case when r.meeting_a is not null and r.meeting_b is not null then '누가 어떤 답을 했는지는 알려 드리지 않아요. 다음 소개를 준비할게요.'
           when (case when m = r.member_a then r.meeting_a else r.meeting_b end) is null then '만남 선택 기한이 지났어요. 다음 소개를 준비할게요.' else '상대의 만남 선택이 기한 안에 오지 않았어요. 다음 소개를 준비할게요.' end,
      '/today', 'pclosed:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m where m is not null;
    c := c + 1;
  end loop;
  for r in select * from public.programs where status = 'arranging' and meeting_on is null and arrange_by <= t for update skip locked loop
    continue when r.status <> 'arranging' or r.meeting_on is not null;
    perform public.close_program(r.id, 'arrange-expired');
    perform public.notify(m, 'program-closed', '약속이 정해지지 않았어요', '7일 안에 약속이 정해지지 않아 이번 교류는 여기서 마무리돼요. 다음 소개를 준비할게요.', '/today', 'pclosed:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m where m is not null;
    c := c + 1;
  end loop;
  for r in select * from public.programs where status = 'arranging' and meeting_on is not null and contact_a is not null and contact_b is not null and t >= public.kst_at(meeting_on, '00:00') and t < public.kst_at(meeting_on + 2, '00:00') loop
    perform public.notify(m, 'contact-released', '오늘 만나는 분의 연락처가 열렸어요', '내일 23:59까지 플라비 안에서 볼 수 있어요.', '/meeting', 'contact:' || r.id || ':' || r.meeting_on || ':' || m) from unnest(array[r.member_a, r.member_b]) m where m is not null;
  end loop;
  for r in select * from public.programs where status = 'arranging' and meeting_on is not null and t >= public.kst_at(meeting_on + 2, '00:00') loop
    perform public.close_program(r.id, 'completed');
    update public.profiles set paused_at = coalesce(paused_at, now()), paused_by = coalesce(paused_by, 'auto'), updated_at = now()
     where id in (r.member_a, r.member_b) and paused_at is null;
    perform public.notify(m, 'program-completed', '만남은 어떠셨나요?', '이번 교류는 마무리됐어요. 새 소개는 잠시 쉬어 둘게요. 다시 받고 싶을 때 내 정보에서 ‘다시 받기’를 눌러 주세요. 불편한 일이 있었다면 문의·신고로 알려 주세요.', '/today', 'done:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m where m is not null;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('closed', c);
  if (n ->> 'expired')::int + (n ->> 'started')::int + (n ->> 'deciding')::int + (n ->> 'closed')::int > 0 then
    insert into public.job_runs (job, finished_at, ok, detail) values ('programs', now(), true, n);
  end if;
  exception when others then
    n := jsonb_build_object('error', sqlerrm);
    insert into public.job_runs (job, finished_at, ok, detail) values ('programs', now(), false, n);
  end;
  return n;
end $function$;
