-- 베타 전 점검 고치기(2026-10-30)
--  1. 편지 사진: 저장소에서 직접 볼 수 있는 사람은 쓴 사람뿐이다(상대가 주소를 마음대로 길게 만들지 못하게).
--     상대는 letter-photo 함수가 can_view_letter_photo 로 확인한 뒤 5분짜리 주소로만 연다(partner-photo 와 같은 길).
--     올리기·보내기 전 지우기 정책은 그대로. 보존 기간 정리(run_program_retention)는 서버 권한으로 돌아서 영향이 없다.
--  2. 탈퇴 요청·이용 정지된 상대의 글: 다시 읽기(program_readable)와 편지 사진(can_view_letter_photo)을 바로 닫는다.
--     쓴 사람 본인의 사진 보기는 그대로 둔다.
--  3. 신고된 교류 열람(admin_report_exchange): 대표·운영·상담 + 2단계 인증, 이유 필수, 감사 기록 ‘신고 교류 열람’.
--     신고에 이어진 교류의 글(모든 종류)과 편지 사진 경로만 돌려준다. 사진은 letter-photo 함수가
--     admin_can_view_letter_photo 로 확인(신고가 있는 교류의 사진인지)·감사 기록을 남긴 뒤 5분짜리 주소로 연다.
--  4. record_payment_result: 거의 같은 때 두 결제가 완료로 바뀌어 유일 색인에 걸리면 ‘중복 결제’ 오류로 바꾼다
--     (payments-confirm 이 이 문장을 보고 토스에서 바로 취소한다).
--  5. run_retention(0500 정의): 프로필 사본을 지울 때 회원에게 보였던 궁합(match)도 지운다 · 90일 지난 테스트 결제 기록을 지운다.
--  6. run_cohort_eve(2600 정의): 돌 때마다 작업 기록(job_runs · cohort-eve)을 남긴다.
--  7. admin_list_programs(3100 정의): 보낸 글 수는 그날의 본 글(편지·첫 장면 답)만 세고, 답장·한마디·첫 장면 이야기는 따로 센다.
--  8. my_introduction(3700 정의): 내가 ‘넘길게요’로 답한 소개에는 궁합을 보내지 않는다.
--  9. choose_first_scene(3600 정의): 상대와 다를 때 다시 고르면 보내는 알림은 내 선택이 실제로 바뀐 때만, 한 시간에 한 번.

-- ─────────────────────────────────────────────────────────
-- 1. 편지 사진 저장소 보기: 쓴 사람만(상대·운영진은 letter-photo 함수로)
drop policy if exists "편지 사진: 쓴 사람과 함께 열린 뒤의 상대만 보기" on storage.objects;
create policy "편지 사진: 쓴 사람만 직접 보기" on storage.objects for select to authenticated
  using (bucket_id = 'letter-photos' and split_part(name, '/', 2) = auth.uid()::text);

-- ─────────────────────────────────────────────────────────
-- 2. 다시 읽기: (3000 정의) + 상대가 이용 중일 때만(탈퇴 요청·이용 정지면 바로 닫힌다)
create or replace function public.program_readable(p public.programs, p_me uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p.status = 'closed' and p.meeting_a = 'positive' and p.meeting_b = 'positive'
     and coalesce(p.end_reason, '') in ('completed', 'arrange-expired') and p.closed_at > now() - interval '30 days'
     and exists (select 1 from public.profiles w where w.id = public.program_partner(p, p_me) and w.status = 'active')
     and not exists (select 1 from public.blocks b
                      where (b.member_id = p_me and b.blocked_id = public.program_partner(p, p_me))
                         or (b.blocked_id = p_me and b.member_id = public.program_partner(p, p_me)))
$$;

-- 편지 사진 보기(3600 정의) + 쓴 사람이 이용 중일 때만 상대에게. 쓴 사람 본인은 늘.
create or replace function public.can_view_letter_photo(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    split_part(p_name, '/', 2) = auth.uid()::text
    or exists (
      select 1 from public.program_entries e join public.programs p on p.id = e.program_id
       where e.kind = 'letter' and e.payload ->> 'photo' = p_name
         and p.id::text = split_part(p_name, '/', 1) and e.author::text = split_part(p_name, '/', 2)
         and auth.uid() in (p.member_a, p.member_b) and auth.uid() <> e.author
         and exists (select 1 from public.profiles w where w.id = e.author and w.status = 'active')
         and (select count(*) from public.program_entries l where l.program_id = p.id and l.day = e.day and l.kind = 'letter') = 2
         and (p.status in ('started', 'deciding', 'arranging') or public.program_readable(p, auth.uid()))
         and not exists (select 1 from public.blocks b where (b.member_id = auth.uid() and b.blocked_id = e.author) or (b.member_id = e.author and b.blocked_id = auth.uid()))))
$$;

-- ─────────────────────────────────────────────────────────
-- 3. 신고된 교류 열람(대표·운영·상담 + 2단계 인증). 신고에 이어진 교류 하나만, 이유를 감사 기록에 남긴다.
create or replace function public.admin_report_exchange(p_report uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reports; p public.programs; reason text := trim(coalesce(p_reason, ''));
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '신고 확인 권한(대표·운영·상담)이 필요해요.'; end if;
  if reason = '' then raise exception '열람하는 이유를 적어 주세요(감사 기록에 남아요).'; end if;
  if char_length(reason) > 200 then raise exception '이유는 200자 안으로 적어 주세요.'; end if;
  select * into r from public.reports where id = p_report;
  if r.id is null then raise exception '신고를 찾을 수 없어요.'; end if;
  select * into p from public.programs where introduction_id = r.introduction_id;
  if r.introduction_id is null or p.id is null then raise exception '이 신고에는 이어진 교류가 없어요.'; end if;
  perform public.write_audit('신고 교류 열람', r.id::text, reason);
  return jsonb_build_object(
    'reportId', r.id, 'programId', p.id, 'status', p.status, 'endReason', p.end_reason, 'plan', p.plan_a, 'startOn', p.start_on,
    'memberA', p.member_a, 'memberB', p.member_b,
    'nameA', (select a.draft -> 'values' ->> 'self.name' from public.applications a where a.member_id = p.member_a),
    'nameB', (select a.draft -> 'values' ->> 'self.name' from public.applications a where a.member_id = p.member_b),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('day', e.day, 'kind', e.kind, 'author', e.author, 'body', e.body, 'payload', e.payload, 'at', e.created_at)
                           order by e.day, e.created_at) from public.program_entries e where e.program_id = p.id), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(e.payload ->> 'photo' order by e.day, e.created_at) from public.program_entries e
                         where e.program_id = p.id and e.kind = 'letter' and e.payload ->> 'photo' is not null), '[]'::jsonb));
end $$;

-- 운영진이 신고된 교류의 편지 사진을 열어도 되는지(letter-photo 함수가 운영진 로그인 토큰으로 부른다). 열 때마다 감사 기록을 남긴다.
create or replace function public.admin_can_view_letter_photo(p_path text, p_reason text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare program_id uuid;
begin
  if not public.is_admin(array['owner','operator','counselor']) then return false; end if;
  select p.id into program_id from public.program_entries e join public.programs p on p.id = e.program_id
   where e.kind = 'letter' and e.payload ->> 'photo' = p_path and p.id::text = split_part(p_path, '/', 1)
     and exists (select 1 from public.reports r where r.introduction_id = p.introduction_id)
   limit 1;
  if program_id is null then return false; end if;
  perform public.write_audit('신고 교류 사진 열람', program_id::text, left(coalesce(nullif(trim(p_reason), ''), '신고 확인'), 200));
  return true;
end $$;

-- ─────────────────────────────────────────────────────────
-- 4. 결제 결과 기록(3800 정의) + 결제 완료로 바꿀 때 같은 항목의 결제 완료 유일 색인에 걸리면 ‘중복 결제’로 알린다.
create or replace function public.record_payment_result(p_order_id text, p_status text, p_payment_key text default null, p_method text default null,
  p_at timestamptz default null, p_code text default null, p_message text default null, p_raw jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.payments; hit text;
begin
  if p_status is null or p_status not in ('paid', 'failed', 'cancelled') then raise exception '결과 상태를 알 수 없어요.'; end if;
  select * into p from public.payments where order_id = p_order_id for update;
  if p.id is null then raise exception '주문을 찾을 수 없어요.'; end if;
  if p_status = 'paid' then
    if p.status = 'paid' then
      if p.payment_key is distinct from p_payment_key then raise exception '이미 다른 결제로 끝난 주문이에요.'; end if;
      return public.payment_json(p);
    end if;
    if p.status = 'cancelled' then raise exception '취소된 주문이에요.'; end if;
    if coalesce(trim(p_payment_key), '') = '' then raise exception '결제 키가 없어요.'; end if;
    if exists (select 1 from public.payments o where o.member_id = p.member_id and o.kind = p.kind and o.program_id is not distinct from p.program_id
                and o.status = 'paid' and o.id <> p.id) then
      raise exception '이미 결제한 항목이에요(중복 결제).';
    end if;
    -- 위 확인과 이 바꾸기 사이에 다른 창의 결제가 먼저 완료되면 유일 색인이 막는다 → 같은 ‘중복 결제’ 문장으로 알린다.
    begin
      update public.payments
         set status = 'paid', payment_key = p_payment_key, method = left(p_method, 40), approved_at = coalesce(p_at, now()),
             failure_code = null, failure_message = null, raw = coalesce(raw, '{}'::jsonb) || coalesce(p_raw, '{}'::jsonb), updated_at = now()
       where id = p.id returning * into p;
    exception when unique_violation then
      get stacked diagnostics hit = constraint_name;
      if hit in ('payments_one_paid_introduction', 'payments_one_paid_exchange') then raise exception '이미 결제한 항목이에요(중복 결제).'; end if;
      raise;
    end;
  elsif p_status = 'failed' then
    if p.status in ('paid', 'cancelled') then return public.payment_json(p); end if;
    update public.payments
       set status = 'failed', failure_code = left(nullif(trim(p_code), ''), 80), failure_message = left(nullif(trim(p_message), ''), 300),
           raw = coalesce(raw, '{}'::jsonb) || coalesce(p_raw, '{}'::jsonb), updated_at = now()
     where id = p.id returning * into p;
  else
    if p.status = 'cancelled' then return public.payment_json(p); end if;
    if p.status <> 'paid' and coalesce(trim(p_payment_key), '') = '' then raise exception '결제되지 않은 주문은 취소할 수 없어요.'; end if;
    update public.payments
       set status = 'cancelled', payment_key = coalesce(payment_key, p_payment_key), cancelled_at = coalesce(p_at, now()),
           cancel_reason = left(nullif(trim(p_message), ''), 200), raw = coalesce(raw, '{}'::jsonb) || coalesce(p_raw, '{}'::jsonb), updated_at = now()
     where id = p.id returning * into p;
  end if;
  return public.payment_json(p);
end $$;

-- ─────────────────────────────────────────────────────────
-- 5. 보존 기간 정리(0500 정의) + 프로필 사본과 함께 궁합(match)도 지운다 · 90일 지난 테스트 결제 기록을 지운다.
create or replace function public.run_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
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
    delete from public.job_runs where started_at <= now() - interval '90 days' and id <> run_id;

    result := jsonb_build_object('members', members, 'snapshots', snapshots, 'inquiries', inquiries, 'audits', audits, 'notifications', notes, 'testPayments', test_payments);
    update public.job_runs set finished_at = now(), ok = true, detail = result where id = run_id;
  exception when others then
    result := jsonb_build_object('error', sqlerrm);
    update public.job_runs set finished_at = now(), ok = false, detail = result where id = run_id;
  end;
  return result;
end $$;

-- ─────────────────────────────────────────────────────────
-- 6. 기수 전날 알림(2600 정의) + 돌 때마다 작업 기록을 남긴다(실패하면 대시보드 맨 위에 경고).
create or replace function public.run_cohort_eve() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; label text; ready boolean;
begin
  begin
    for r in select a.member_id, c.number, c.starts_on from public.applications a join public.cohorts c on c.number = a.cohort_number
              join public.profiles p on p.id = a.member_id and p.status = 'active' and p.paused_at is null
             where a.status = 'approved' and c.starts_on = public.kst_today() + 1 loop
      label := case when r.number = 0 then '베타' else r.number || '기' end;
      ready := exists (select 1 from public.introductions i where r.member_id in (i.member_a, i.member_b) and i.status = 'reserved'
                        and (i.reveal_at at time zone 'Asia/Seoul')::date = r.starts_on);
      perform public.notify(r.member_id, 'cohort-eve',
        case when ready then label || ' 첫 소개가 내일 정오에 도착해요' else label || '가 내일 정오에 시작해요' end,
        case when ready then '잘 맞는 분을 준비해 두었어요. 내일 정오에 오늘 화면에서 확인해 주세요.' else '잘 맞는 분이 준비되는 날 정오에 알려 드릴게요. 매일 소개를 보장하지는 않아요.' end,
        '/today', 'cohort-eve:' || r.number || ':' || r.starts_on || ':' || r.member_id);
      n := n + 1;
    end loop;
    insert into public.job_runs (job, finished_at, ok, detail) values ('cohort-eve', now(), true, jsonb_build_object('notified', n));
  exception when others then
    n := 0;
    insert into public.job_runs (job, finished_at, ok, detail) values ('cohort-eve', now(), false, jsonb_build_object('error', sqlerrm));
  end;
  return n;
end $$;

-- ─────────────────────────────────────────────────────────
-- 7. 교류 목록(3100 정의): 보낸 글은 그날의 본 글(편지·첫 장면 답)만 세고, 답장·한마디·첫 장면 이야기는 extras로 따로 센다.
create or replace function public.admin_list_programs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'introductionId', p.introduction_id, 'status', p.status, 'endReason', p.end_reason, 'createdAt', p.created_at, 'closedAt', p.closed_at,
      'memberA', p.member_a, 'memberB', p.member_b, 'emailA', pa.email, 'emailB', pb.email,
      'nameA', aa.draft -> 'values' ->> 'self.name', 'nameB', ab.draft -> 'values' ->> 'self.name',
      'planA', p.plan_a, 'planB', p.plan_b, 'startOn', p.start_on, 'agreeBy', p.agree_by, 'confirmed', (p.confirm_a is not null)::int + (p.confirm_b is not null)::int,
      'entriesA', (select count(*) from public.program_entries e where e.program_id = p.id and e.author = p.member_a and e.kind in ('letter', 'scene')),
      'entriesB', (select count(*) from public.program_entries e where e.program_id = p.id and e.author = p.member_b and e.kind in ('letter', 'scene')),
      'extrasA', (select count(*) from public.program_entries e where e.program_id = p.id and e.author = p.member_a and e.kind in ('reply', 'piece', 'comment', 'piece-comment')),
      'extrasB', (select count(*) from public.program_entries e where e.program_id = p.id and e.author = p.member_b and e.kind in ('reply', 'piece', 'comment', 'piece-comment')),
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
-- 8. 회원의 지금 소개(3700 정의) + 내가 ‘넘길게요’로 답했으면 궁합은 보내지 않는다.
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
    'closedAt', i.closed_at
  );
end $$;

-- ─────────────────────────────────────────────────────────
-- 9. B 마지막 맞추기(3600 정의) + 상대와 다를 때 보내는 알림은 내 선택이 실제로 바뀐 때만, 같은 사람에게 한 시간에 한 번.
create or replace function public.choose_first_scene(p_program uuid, p_pick jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); partner uuid; pick jsonb; mine jsonb; theirs jsonb; own1 jsonb; own2 jsonb;
  acts text[]; flows text[]; rests text[]; topics text[];
begin
  select * into p from public.programs where id = p_program for update;
  if p.id is null or me not in (p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.plan_a is distinct from 'B' then raise exception '첫 장면 맞추기는 B 방식에서만 해요.'; end if;
  if p.status not in ('started', 'deciding', 'arranging') or p.meeting_on is not null then raise exception '지금은 첫 장면을 고를 수 없어요.'; end if;
  if (select count(*) from public.program_entries where program_id = p.id and day = 3 and kind = 'scene') < 2 then
    raise exception '셋째 날 답이 두 분 모두에게 열린 뒤에 첫 장면을 맞출 수 있어요.';
  end if;
  if jsonb_typeof(p_pick) is distinct from 'object' then raise exception '두 분이 고른 것 중에서 하나씩 골라 주세요.'; end if;
  partner := public.program_partner(p, me);
  select payload into mine from public.program_entries where program_id = p.id and day = 3 and kind = 'final' and author = me;
  select payload into theirs from public.program_entries where program_id = p.id and day = 3 and kind = 'final' and author = partner;
  select payload into own1 from public.program_entries where program_id = p.id and day = 1 and kind = 'scene' and author = me;
  select payload into own2 from public.program_entries where program_id = p.id and day = 2 and kind = 'scene' and author = me;
  select case when count(*) = 2 then array_agg(distinct payload ->> 'activity') else array['exhibition', 'walk', 'bookstore', 'cafe', 'park', 'market', 'performance'] end into acts
    from public.program_entries where program_id = p.id and day = 1 and kind = 'scene';
  select case when count(*) = 2 then array_agg(distinct payload ->> 'flow') end, case when count(*) = 2 then array_agg(distinct payload ->> 'rest') end into flows, rests
    from public.program_entries where program_id = p.id and day = 2 and kind = 'scene';
  if flows is null then
    flows := coalesce(public.scene_options(p_pick ->> 'activity', 'flow'), '{}') || public.scene_stay_options(null, 'legacy-flow');
    rests := coalesce(public.scene_options(p_pick ->> 'activity', 'rest'), '{}') || public.scene_stay_options(null, 'legacy-rest');
  end if;
  -- 직접 쓴 것: 내가 쓴 것 · 상대가 첫 장면에 고른 것
  acts := acts || array_remove(array[case when public.scene_custom_ok(own1 ->> 'activity') then own1 ->> 'activity' end, case when public.scene_custom_ok(theirs ->> 'activity') then theirs ->> 'activity' end], null);
  flows := flows || array_remove(array[case when public.scene_custom_ok(own2 ->> 'flow') then own2 ->> 'flow' end, case when public.scene_custom_ok(theirs ->> 'flow') then theirs ->> 'flow' end], null);
  rests := rests || array_remove(array[case when public.scene_custom_ok(own2 ->> 'rest') then own2 ->> 'rest' end, case when public.scene_custom_ok(theirs ->> 'rest') then theirs ->> 'rest' end], null);
  select array_agg(distinct payload ->> 'topic') into topics from public.program_entries where program_id = p.id and day = 3 and kind = 'scene';
  pick := jsonb_build_object('activity', p_pick ->> 'activity', 'flow', p_pick ->> 'flow', 'rest', p_pick ->> 'rest', 'topic', p_pick ->> 'topic');
  if not (coalesce(pick ->> 'activity' = any (acts), false) and coalesce(pick ->> 'flow' = any (flows), false)
          and coalesce(pick ->> 'rest' = any (rests), false) and coalesce(pick ->> 'topic' = any (topics), false)) then
    raise exception '두 분이 고른 것 중에서 하나씩 골라 주세요.';
  end if;
  if mine is not null and theirs is not null and mine = theirs then raise exception '두 분이 이미 같은 장면으로 정했어요.'; end if;
  insert into public.program_entries (program_id, day, kind, author, payload) values (p.id, 3, 'final', me, pick)
    on conflict (program_id, day, kind, author) do update set payload = excluded.payload, created_at = now();
  if theirs is null then
    if partner is not null then
      perform public.notify(partner, 'program-final', '상대가 첫 장면을 골랐어요', '나도 고르면 두 분의 선택이 함께 열려요.', '/exchange', 'final-sent:' || p.id || ':' || me);
    end if;
    return public.my_program() || jsonb_build_object('notice', '골랐어요. 상대도 고르면 두 분의 선택이 함께 열려요. 이제 이 장면에 대해 짧게 써 볼 수 있어요.');
  elsif theirs = pick then
    perform public.notify(m, 'program-final', '두 분의 첫 장면이 정해졌어요', '같은 장면을 골랐어요. 이 장면에 대해 짧게 써서 나눠 보세요. 두 분 모두 만나고 싶다고 하면 약속 제안에 그대로 담겨요.', '/exchange', 'final-agreed:' || p.id || ':' || m)
      from unnest(array[p.member_a, p.member_b]) m where m is not null;
    return public.my_program() || jsonb_build_object('notice', '두 분이 같은 장면을 골랐어요. 첫 장면이 정해졌어요.');
  end if;
  -- 같은 것을 다시 눌렀을 때는 알리지 않고, 바꿨을 때도 같은 사람에게는 한 시간에 한 번만(한국 시간 기준 시각을 키에 넣는다).
  if partner is not null and mine is distinct from pick then
    perform public.notify(partner, 'program-final', '첫 장면에 서로 다른 부분이 있어요', '두 분의 선택을 비교해 보고, 맞출 부분을 다시 골라 주세요.', '/exchange',
      'final-diff:' || p.id || ':' || me || ':' || to_char(public.app_now() at time zone 'Asia/Seoul', 'YYYYMMDDHH24'));
  end if;
  return public.my_program() || jsonb_build_object('notice', '상대와 다른 부분이 있어요. 아래에서 비교하고 다시 고를 수 있어요.');
end $$;

-- ─────────────────────────────────────────────────────────
-- 권한: 바꾼 함수는 create or replace 라 예전 권한이 그대로 남는다. 새 운영진 함수는 로그인한 사람에게 열고 함수 안에서 역할·2단계 인증을 확인한다.
revoke all on function public.admin_report_exchange(uuid, text), public.admin_can_view_letter_photo(text, text) from public, anon;
grant execute on function public.admin_report_exchange(uuid, text), public.admin_can_view_letter_photo(text, text) to authenticated;
