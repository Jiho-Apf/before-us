-- 메일 줄이기·놓치지 않기(V6-mail-02)
--  - 메일은 ‘할 일이 있거나 시간이 정해진 알림’만 보낸다. 상대의 움직임·소개 없는 날·소개 마무리는 사이트 알림만.
--  - 베타 동안은 카카오톡·문자 대신, 중요한 알림을 메일 선택과 상관없이 가입한 메일로 보낸다.
--  - 회원이 ‘모두 받기’를 고르면 사이트 알림도 메일로 받는다(email_all).
--  - 밤 10시~아침 8시에는 보내지 않고 아침에 보낸다(운영 공지는 예외).
--  - 마감 전 알림은 아직 하지 않은 회원에게만 한 번(소개 응답·그날 글·교류 합의·만남 선택·약속 정하기).
--  - 문의 답변은 문의한 분의 메일로 보낸다(email_queue).

alter table public.profiles add column email_all boolean not null default false;
grant update (email_all) on public.profiles to authenticated;

create table public.email_queue (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now(),
  emailed_at timestamptz
);
alter table public.email_queue enable row level security;
revoke all on public.email_queue from anon, authenticated;

-- 베타 동안은 중요한 알림을 모두에게 메일로 보낸다. 정식 운영에서 카카오톡·문자를 연결하면 false로 바꾼다.
create or replace function public.email_beta_mode() returns boolean
language sql immutable set search_path = '' as $$ select true $$;

-- 알림 종류별 메일 여부: always(공지) · important(메일) · site(사이트만)
create or replace function public.email_class(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind = 'announcement' then 'always'
    when p_kind in ('waiting', 'closed', 'program-plan', 'program-confirm', 'program-sent', 'program-open') then 'site'
    else 'important' end
$$;

drop function public.pending_email_notifications(int);
create function public.pending_email_notifications(p_limit int default 50) returns table (id uuid, email text, title text, body text, link text, source text)
language sql stable security definer set search_path = '' as $$
  select x.id, x.email, x.title, x.body, x.link, x.source from (
    select n.id, p.email, n.title, n.body, n.link, 'notification'::text as source, n.created_at, public.email_class(n.kind) = 'always' as urgent
      from public.notifications n join public.profiles p on p.id = n.member_id and p.status = 'active'
     where n.emailed_at is null and n.created_at > now() - interval '1 day'
       and case public.email_class(n.kind)
             when 'always' then true
             when 'important' then public.email_beta_mode() or p.notify_email
             else p.email_all and (public.email_beta_mode() or p.notify_email) end
    union all
    select q.id, q.email, q.title, q.body, q.link, 'queue'::text, q.created_at, false
      from public.email_queue q where q.emailed_at is null and q.created_at > now() - interval '3 days'
  ) x
  where x.urgent or extract(hour from (public.app_now() at time zone 'Asia/Seoul')) between 8 and 21
  order by x.urgent desc, x.created_at
  limit p_limit
$$;
revoke all on function public.pending_email_notifications(int), public.email_class(text), public.email_beta_mode() from public, anon, authenticated;
grant execute on function public.pending_email_notifications(int) to service_role;

-- 마감 전 알림(10분마다)
create or replace function public.run_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; t timestamptz := public.app_now(); today date := public.kst_date(public.app_now()); key text;
begin
  -- 소개 응답: 마감(다음 날 11:00) 2시간 전까지 답하지 않은 회원
  for r in select i.id, m.member from public.introductions i
             cross join lateral (values (i.member_a, i.response_a), (i.member_b, i.response_b)) as m(member, response)
            where i.status = 'published' and m.response is null and t >= i.respond_by - interval '2 hours' and t < i.respond_by loop
    key := 'remind-intro:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-response', '답 마감까지 2시간 남았어요', '오늘 오전 11시까지 답하지 않으면 이번 소개는 마무리돼요.', '/us', key);
      n := n + 1;
    end if;
  end loop;
  -- 그날 글: 18:00까지 보내지 않은 회원
  for r in select p.id, p.plan_a, m.member, today - p.start_on + 1 as day from public.programs p
             cross join lateral (values (p.member_a), (p.member_b)) as m(member)
            where p.status = 'started' and today between p.start_on and p.start_on + 2 and t >= public.kst_at(today, '18:00')
              and not exists (select 1 from public.program_entries e where e.program_id = p.id and e.day = today - p.start_on + 1 and e.kind in ('letter', 'scene') and e.author = m.member) loop
    key := 'remind-letter:' || r.id || ':' || r.day || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-letter', case when r.plan_a = 'A' then '오늘의 편지를 아직 보내지 않았어요' else '오늘의 첫 장면 답을 아직 보내지 않았어요' end,
        '23:59까지 보내야 상대의 글과 함께 열려요.', '/exchange', key);
      n := n + 1;
    end if;
  end loop;
  -- 교류 합의: 마감 12시간 전까지 확인하지 않은 회원
  for r in select p.id, m.member from public.programs p
             cross join lateral (values (p.member_a, p.confirm_a), (p.member_b, p.confirm_b)) as m(member, confirmed)
            where p.status = 'choosing' and m.confirmed is null and t >= p.agree_by - interval '12 hours' and t < p.agree_by loop
    key := 'remind-agree:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-agreement', '교류 방식·시작일 마감이 12시간 남았어요', '두 분이 같은 방식과 시작일을 확인해야 교류가 시작돼요. 마감이 지나면 이번 소개는 마무리돼요.', '/exchange', key);
      n := n + 1;
    end if;
  end loop;
  -- 만남 선택: 마감(DAY05 09:00) 14시간 전까지 고르지 않은 회원
  for r in select p.id, m.member from public.programs p
             cross join lateral (values (p.member_a, p.meeting_a), (p.member_b, p.meeting_b)) as m(member, choice)
            where p.status = 'deciding' and m.choice is null and t >= p.meeting_by - interval '14 hours' and t < p.meeting_by loop
    key := 'remind-meet:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-meeting', '만남 선택 마감이 다가와요', '내일 오전 9시까지 골라 주세요. 답이 없으면 이번 교류는 마무리돼요.', '/exchange', key);
      n := n + 1;
    end if;
  end loop;
  -- 약속 정하기: 마감 이틀 전까지 약속이 없으면 두 분 모두
  for r in select p.id, m.member from public.programs p cross join lateral (values (p.member_a), (p.member_b)) as m(member)
            where p.status = 'arranging' and p.meeting_on is null and t >= p.arrange_by - interval '48 hours' and t < p.arrange_by loop
    key := 'remind-arrange:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-arrange', '약속 정하기 마감이 이틀 남았어요', '마감까지 약속이 정해지지 않으면 이번 교류는 마무리돼요.', '/meeting', key);
      n := n + 1;
    end if;
  end loop;
  if n > 0 then insert into public.job_runs (job, finished_at, ok, detail) values ('reminders', now(), true, jsonb_build_object('sent', n)); end if;
  return n;
end $$;
revoke all on function public.run_reminders() from public, anon, authenticated;

create or replace function public.run_programs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; t timestamptz := public.app_now(); d int; n jsonb := '{}'::jsonb; c int := 0;
begin
  for r in select * from public.programs where status = 'choosing' and agree_by <= t loop
    perform public.close_program(r.id, 'agreement-expired');
    perform public.notify(m, 'program-closed', '교류 방식이 정해지지 않았어요', '합의 기한(48시간)이 지나 이번 소개는 여기서 마무리돼요. 다음 소개를 준비할게요.', '/today', 'pclosed:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('expired', c); c := 0;
  for r in select * from public.programs where status = 'scheduled' and t >= public.kst_at(start_on, '09:00') loop
    update public.programs set status = 'started', started_at = t, updated_at = now() where id = r.id;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('started', c); c := 0;
  for r in select * from public.programs where status = 'started' loop
    for d in 1..3 loop
      if t >= public.kst_at(r.start_on + d - 1, '09:00') and public.kst_date(t) = r.start_on + d - 1 then
        perform public.notify(m, 'program-day', 'DAY0' || d || '이 열렸어요', case when d > 1 and (select count(*) from public.program_entries e where e.program_id = r.id and e.day = d - 1 and e.kind in ('letter', 'scene')) = 2 then case when r.plan_a = 'A' then '어제 편지가 함께 열렸어요. ' else '어제 첫 장면 답이 함께 열렸어요. ' end else '' end || case when r.plan_a = 'A' then '오늘의 편지를 23:59까지 보내 주세요.' else '오늘의 첫 장면 질문에 23:59까지 답해 주세요.' end, '/exchange', 'day:' || r.id || ':' || d || ':' || m)
          from unnest(array[r.member_a, r.member_b]) m;
      end if;
    end loop;
    if t >= public.kst_at(r.start_on + 3, '09:00') then
      update public.programs set status = 'deciding', meeting_by = public.kst_at(r.start_on + 3, '09:00') + interval '24 hours', updated_at = now() where id = r.id;
      perform public.notify(m, 'meeting-open', '만남을 정할 시간이에요', case when (select count(*) from public.program_entries e where e.program_id = r.id and e.day = 3 and e.kind in ('letter', 'scene')) = 2 then 'DAY03 글도 함께 열렸어요. ' else '' end || '내일 09:00까지 만나고 싶은지 골라 주세요. 상대의 답은 알려 드리지 않아요.', '/exchange', 'decide:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m;
      c := c + 1;
    end if;
  end loop;
  n := n || jsonb_build_object('deciding', c); c := 0;
  for r in select * from public.programs where status = 'deciding' and meeting_by <= t loop
    perform public.close_program(r.id, 'meeting-nonresponse');
    perform public.notify(m, 'program-closed', '이번 교류는 여기서 마무리됐어요', '만남 선택 기한이 지났어요. 다음 소개를 준비할게요.', '/today', 'pclosed:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m;
    c := c + 1;
  end loop;
  for r in select * from public.programs where status = 'arranging' and meeting_on is null and arrange_by <= t loop
    perform public.close_program(r.id, 'arrange-expired');
    perform public.notify(m, 'program-closed', '약속이 정해지지 않았어요', '7일 안에 약속이 정해지지 않아 이번 교류는 여기서 마무리돼요. 다음 소개를 준비할게요.', '/today', 'pclosed:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m;
    c := c + 1;
  end loop;
  for r in select * from public.programs where status = 'arranging' and meeting_on is not null and contact_a is not null and contact_b is not null and t >= public.kst_at(meeting_on, '00:00') and t < public.kst_at(meeting_on + 2, '00:00') loop
    perform public.notify(m, 'contact-released', '오늘 만나는 분의 연락처가 열렸어요', '내일 23:59까지 비포어스 안에서 볼 수 있어요.', '/meeting', 'contact:' || r.id || ':' || r.meeting_on || ':' || m) from unnest(array[r.member_a, r.member_b]) m;
  end loop;
  for r in select * from public.programs where status = 'arranging' and meeting_on is not null and t >= public.kst_at(meeting_on + 2, '00:00') loop
    perform public.close_program(r.id, 'completed');
    perform public.notify(m, 'program-completed', '만남은 어떠셨나요?', '이번 교류는 마무리됐어요. 불편한 일이 있었다면 문의·신고로 알려 주세요.', '/today', 'done:' || r.id || ':' || m) from unnest(array[r.member_a, r.member_b]) m;
    c := c + 1;
  end loop;
  n := n || jsonb_build_object('closed', c);
  if (n ->> 'expired')::int + (n ->> 'started')::int + (n ->> 'deciding')::int + (n ->> 'closed')::int > 0 then
    insert into public.job_runs (job, finished_at, ok, detail) values ('programs', now(), true, n);
  end if;
  return n;
end $$;

create or replace function public.admin_inquiry_status(p_id text, p_answer text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare st text; v_email text;
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  select status, email into st, v_email from public.inquiries where id = p_id for update;
  if st is null then raise exception '문의를 찾을 수 없어요.'; end if;
  if p_answer is null then
    if st <> 'received' then raise exception '접수 상태의 문의만 확인 중으로 바꿀 수 있어요.'; end if;
    update public.inquiries set status = 'checking' where id = p_id;
    perform public.write_audit('문의 확인 시작', p_id, '본문·이메일 미기록');
  else
    if char_length(trim(p_answer)) < 5 or char_length(p_answer) > 1500 then raise exception '답변은 5~1500자로 적어 주세요.'; end if;
    if p_answer ~ '\d{6}\s?-\s?[1-4]\d{6}' or p_answer ~ '\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}' then raise exception '답변에 주민등록번호·카드번호를 넣을 수 없어요.'; end if;
    update public.inquiries set status = 'answered', answer_body = trim(p_answer), answered_at = now() where id = p_id;
    -- 문의한 분에게 답변을 메일로 보낸다(비회원도 받는다).
    insert into public.email_queue (email, title, body, link)
    values (v_email, case when st = 'answered' then '문의 답변이 고쳐졌어요' else '문의에 답변이 등록됐어요' end,
            '접수 번호 ' || p_id || E'\n\n' || trim(p_answer), '/contact');
    perform public.write_audit(case when st = 'answered' then '문의 답변 수정' else '문의 답변 기록' end, p_id, '본문·이메일 미기록');
  end if;
end $$;
