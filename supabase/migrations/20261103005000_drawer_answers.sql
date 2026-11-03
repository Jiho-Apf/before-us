-- 5000: 정오의 서랍 · 오늘의 질문에 이름 없이 답하고 댓글 나누기
--
-- 보는 것은 누구나(로그인 없이), 남기는 것은 로그인한 활동 회원만. 화면에는 이름 대신 글마다 새로 붙는 별명만 보인다
-- (같은 글 안에서는 같은 사람이 같은 별명, 글쓴이는 ‘글쓴이’). 연락처·SNS는 막고, 서로 다른 세 분이 신고하면 바로 가린 뒤
-- 운영진이 확인한다. 답은 그날 정오부터 다음 날 정오 전까지 하루 하나, 답과 댓글은 30일 뒤 지운다.
-- 질문은 화면(NoonDrawer.tsx DAILY)과 같은 목록·같은 순서다(1970-01-01부터 날 수 % 31). 뒤에만 덧붙이고 둘을 함께 바꾼다.

create table if not exists public.drawer_answers (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  author uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 2 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by text check (hidden_by in ('reports', 'operator')),
  unique (day, author)
);
create index if not exists drawer_answers_day on public.drawer_answers (day, created_at desc);
create table if not exists public.drawer_comments (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.drawer_answers (id) on delete cascade,
  author uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by text check (hidden_by in ('reports', 'operator'))
);
create index if not exists drawer_comments_answer on public.drawer_comments (answer_id, created_at);
create table if not exists public.drawer_reports (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('answer', 'comment')),
  target_id uuid not null,
  reporter uuid not null references public.profiles (id) on delete cascade,
  reason text check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (target_kind, target_id, reporter)
);
alter table public.drawer_answers enable row level security;
alter table public.drawer_comments enable row level security;
alter table public.drawer_reports enable row level security;
revoke all on public.drawer_answers, public.drawer_comments, public.drawer_reports from anon, authenticated;

create or replace function public.drawer_question(p_day date) returns text
language sql immutable set search_path = '' as $$
  select (array[
    '오늘 하루 중 가장 조용했던 순간은 언제였나요?',
    '요즘 자꾸 손이 가는 음식이 있나요?',
    '어릴 적 살던 동네에서 가장 기억나는 길은요?',
    '최근에 산 것 중 가장 마음에 드는 물건은요?',
    '지금 창밖에는 무엇이 보이나요?',
    '요즘 나도 모르게 자주 쓰는 말이 있나요?',
    '비 오는 날에만 하고 싶어지는 일이 있나요?',
    '요즘 휴대폰에서 가장 자주 여는 것은 무엇인가요?',
    '올해 처음 해 본 일은 무엇인가요?',
    '오늘 누군가에게 고맙다고 말했나요?',
    '가장 오래 간직한 물건은 무엇인가요?',
    '요즘 가방 속에 늘 들고 다니는 것은요?',
    '최근에 미뤄 두었다가 결국 해낸 일이 있나요?',
    '좋아하는 계절의 냄새를 떠올린다면요?',
    '누군가 나를 한 문장으로 소개한다면, 어떻게 말해 주면 좋겠어요?',
    '요즘 아껴 두고 조금씩 보는 것이 있나요?',
    '걷다가 자주 멈춰 서게 되는 것은요?',
    '요즘 휴대폰 배경 화면은 무엇인가요?',
    '잠들기 전에 마지막으로 하는 일은요?',
    '다시 가 보고 싶은 여행지 한 곳은요?',
    '나만 아는 작은 맛집이 있나요?',
    '요즘 내 방에서 가장 좋아하는 자리는 어디예요?',
    '최근에 새로 알게 된 단어나 사실이 있나요?',
    '오늘의 기분을 날씨로 말한다면요?',
    '사진첩에서 가장 최근에 찍은 사진은 무엇인가요?',
    '어떤 소리를 들으면 마음이 편해지나요?',
    '내일 아침이 기다려지는 이유가 하나 있다면요?',
    '요즘 다시 보고 싶은 영화나 책이 있나요?',
    '친구들이 나에게 자주 묻는 것은 무엇인가요?',
    '계절이 바뀌는 걸 가장 먼저 느끼는 순간은요?',
    '오늘 정오에는 어디에 있었나요?'
  ])[((p_day - date '1970-01-01') % 31) + 1]
$$;
-- 답을 남길 수 있는 날: 그날 정오부터 다음 날 정오 전까지
create or replace function public.drawer_open_day(p_day date) returns boolean
language sql stable set search_path = '' as $$
  select public.app_now() >= public.kst_at(p_day, '12:00') and public.app_now() < public.kst_at(p_day + 1, '12:00')
$$;
-- 별명: 답(글)마다 새로 붙고, 같은 글 안에서는 같은 사람이 같은 별명
create or replace function public.drawer_alias(p_answer uuid, p_author uuid) returns text
language sql immutable set search_path = '' as $$
  select (array['창가의', '정오의', '늦은 오후의', '조용한', '따뜻한', '느린', '바람 부는', '햇살 든', '비 오는 날의', '잎 그림자 아래'])[(abs(hashtext(p_answer::text || ':' || p_author::text)) % 10) + 1]
      || ' ' || (array['산책자', '고양이', '편지', '우산', '서점', '찻잔', '나무', '구름', '벤치', '엽서'])[((abs(hashtext(p_author::text || ':' || p_answer::text)) / 7) % 10) + 1]
$$;
revoke all on function public.drawer_open_day(date), public.drawer_alias(uuid, uuid) from public, anon, authenticated;

-- 그날의 질문과 답(가린 글 빼고, 최근 것부터 60개). 정오 전에는 그날 답을 보여 주지 않는다. 최근 7일까지만.
create or replace function public.drawer_day(p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); today date := public.kst_date(public.app_now());
begin
  if p_day is null or p_day > today or p_day < today - 6 then raise exception '볼 수 없는 날이에요.'; end if;
  if public.app_now() < public.kst_at(p_day, '12:00') then
    return jsonb_build_object('day', p_day, 'opened', false, 'open', false, 'answers', '[]'::jsonb);
  end if;
  return jsonb_build_object('day', p_day, 'opened', true, 'question', public.drawer_question(p_day), 'open', public.drawer_open_day(p_day),
    'signedIn', me is not null,
    'mine', (select jsonb_build_object('id', a.id, 'body', a.body, 'hidden', a.hidden_at is not null) from public.drawer_answers a where a.day = p_day and a.author = me),
    'answers', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
      select jsonb_build_object('id', a.id, 'alias', public.drawer_alias(a.id, a.author), 'body', a.body, 'at', a.created_at, 'mine', a.author = me,
             'comments', (select count(*)::int from public.drawer_comments c where c.answer_id = a.id and c.hidden_at is null)) x
        from public.drawer_answers a where a.day = p_day and a.hidden_at is null order by a.created_at desc limit 60) t), '[]'::jsonb));
end $$;

create or replace function public.drawer_comments_of(p_answer uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); a public.drawer_answers;
begin
  select * into a from public.drawer_answers where id = p_answer and hidden_at is null;
  if a.id is null then raise exception '글을 찾을 수 없어요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'alias', case when c.author = a.author then '글쓴이' else public.drawer_alias(a.id, c.author) end,
           'body', c.body, 'at', c.created_at, 'mine', c.author = me) order by c.created_at)
    from public.drawer_comments c where c.answer_id = a.id and c.hidden_at is null), '[]'::jsonb);
end $$;

create or replace function public.drawer_answer(p_day date, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); clean text := trim(coalesce(p_body, '')); a public.drawer_answers;
begin
  if me is null or not public.is_active_member() then raise exception '로그인하면 이름 없이 답을 남길 수 있어요.'; end if;
  if not public.drawer_open_day(p_day) then raise exception '이 질문에는 그날 정오부터 다음 날 정오 전까지 답할 수 있어요.'; end if;
  if char_length(clean) < 2 or char_length(clean) > 200 then raise exception '2~200자로 적어 주세요.'; end if;
  perform public.check_member_text(clean, '서랍 답');
  select * into a from public.drawer_answers where day = p_day and author = me for update;
  if a.hidden_at is not null then raise exception '가려진 답이 있어 이 질문에는 다시 남길 수 없어요.'; end if;
  insert into public.drawer_answers (day, author, body) values (p_day, me, clean)
  on conflict (day, author) do update set body = excluded.body, updated_at = now();
  return public.drawer_day(p_day);
end $$;

create or replace function public.drawer_delete_answer(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.drawer_answers where id = p_id and author = auth.uid();
  if not found then raise exception '지울 수 있는 글이 없어요.'; end if;
end $$;

create or replace function public.drawer_comment(p_answer uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); clean text := trim(coalesce(p_body, '')); a public.drawer_answers;
begin
  if me is null or not public.is_active_member() then raise exception '로그인하면 이름 없이 댓글을 남길 수 있어요.'; end if;
  select * into a from public.drawer_answers where id = p_answer and hidden_at is null;
  if a.id is null then raise exception '글을 찾을 수 없어요.'; end if;
  if a.day < public.kst_date(public.app_now()) - 1 then raise exception '이틀이 지난 글에는 댓글을 남길 수 없어요.'; end if;
  if char_length(clean) < 1 or char_length(clean) > 200 then raise exception '200자 안으로 적어 주세요.'; end if;
  perform public.check_member_text(clean, '서랍 댓글');
  if (select count(*) from public.drawer_comments where author = me and created_at > now() - interval '1 day') >= 30 then
    raise exception '오늘은 댓글을 충분히 남겼어요. 내일 다시 이어 주세요.';
  end if;
  insert into public.drawer_comments (answer_id, author, body) values (a.id, me, clean);
  return public.drawer_comments_of(a.id);
end $$;

create or replace function public.drawer_delete_comment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.drawer_comments where id = p_id and author = auth.uid();
  if not found then raise exception '지울 수 있는 댓글이 없어요.'; end if;
end $$;

-- 신고: 내 글은 신고할 수 없고, 서로 다른 세 분이 신고하면 바로 가린 뒤 운영진이 확인한다.
create or replace function public.drawer_report(p_kind text, p_id uuid, p_reason text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); owner uuid; n int;
begin
  if me is null or not public.is_active_member() then raise exception '로그인하면 신고할 수 있어요.'; end if;
  if p_kind = 'answer' then select author into owner from public.drawer_answers where id = p_id;
  elsif p_kind = 'comment' then select author into owner from public.drawer_comments where id = p_id;
  else raise exception '신고할 글을 확인해 주세요.'; end if;
  if owner is null then raise exception '글을 찾을 수 없어요.'; end if;
  if owner = me then raise exception '내 글은 지우기로 정리해 주세요.'; end if;
  insert into public.drawer_reports (target_kind, target_id, reporter, reason) values (p_kind, p_id, me, nullif(left(trim(coalesce(p_reason, '')), 200), ''))
  on conflict (target_kind, target_id, reporter) do nothing;
  select count(*) into n from public.drawer_reports where target_kind = p_kind and target_id = p_id and resolved_at is null;
  if n >= 3 then
    if p_kind = 'answer' then update public.drawer_answers set hidden_at = coalesce(hidden_at, now()), hidden_by = coalesce(hidden_by, 'reports') where id = p_id;
    else update public.drawer_comments set hidden_at = coalesce(hidden_at, now()), hidden_by = coalesce(hidden_by, 'reports') where id = p_id; end if;
  end if;
  return '신고를 받았어요. 운영진이 확인할게요.';
end $$;

-- 운영진: 신고된 글·가려진 글 보기와 처리(가리기·되돌리기·신고 닫기)
create or replace function public.admin_drawer_reports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner', 'operator', 'counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'lastAt' desc) from (
    select jsonb_build_object('kind', t.kind, 'id', t.id, 'day', t.day, 'body', t.body, 'createdAt', t.created_at, 'hidden', t.hidden_at is not null, 'hiddenBy', t.hidden_by,
             'reports', (select count(*)::int from public.drawer_reports r where r.target_kind = t.kind and r.target_id = t.id and r.resolved_at is null),
             'reasons', (select coalesce(jsonb_agg(r.reason) filter (where r.reason is not null), '[]'::jsonb) from public.drawer_reports r where r.target_kind = t.kind and r.target_id = t.id and r.resolved_at is null),
             'lastAt', greatest(t.hidden_at, (select max(r.created_at) from public.drawer_reports r where r.target_kind = t.kind and r.target_id = t.id))) x
      from (select 'answer' kind, a.id, a.day, a.body, a.created_at, a.hidden_at, a.hidden_by from public.drawer_answers a
            union all select 'comment', c.id, (select a.day from public.drawer_answers a where a.id = c.answer_id), c.body, c.created_at, c.hidden_at, c.hidden_by from public.drawer_comments c) t
     where t.hidden_at is not null or exists (select 1 from public.drawer_reports r where r.target_kind = t.kind and r.target_id = t.id and r.resolved_at is null)) y), '[]'::jsonb);
end $$;

create or replace function public.admin_drawer_moderate(p_kind text, p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner', 'operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_kind not in ('answer', 'comment') or p_action not in ('hide', 'restore', 'dismiss') then raise exception '처리할 내용을 확인해 주세요.'; end if;
  if p_action = 'hide' then
    if p_kind = 'answer' then update public.drawer_answers set hidden_at = coalesce(hidden_at, now()), hidden_by = 'operator' where id = p_id;
    else update public.drawer_comments set hidden_at = coalesce(hidden_at, now()), hidden_by = 'operator' where id = p_id; end if;
  elsif p_action = 'restore' then
    if p_kind = 'answer' then update public.drawer_answers set hidden_at = null, hidden_by = null where id = p_id;
    else update public.drawer_comments set hidden_at = null, hidden_by = null where id = p_id; end if;
  end if;
  update public.drawer_reports set resolved_at = now() where target_kind = p_kind and target_id = p_id and resolved_at is null;
  perform public.write_audit('서랍 글 ' || case p_action when 'hide' then '가림' when 'restore' then '되돌림' else '신고 닫음' end, p_kind || ':' || p_id, null);
end $$;

revoke all on function public.drawer_day(date), public.drawer_comments_of(uuid) from public;
grant execute on function public.drawer_day(date), public.drawer_comments_of(uuid) to anon, authenticated;
revoke all on function public.drawer_answer(date, text), public.drawer_delete_answer(uuid), public.drawer_comment(uuid, text), public.drawer_delete_comment(uuid),
  public.drawer_report(text, uuid, text), public.admin_drawer_reports(), public.admin_drawer_moderate(text, uuid, text) from public, anon;
grant execute on function public.drawer_answer(date, text), public.drawer_delete_answer(uuid), public.drawer_comment(uuid, text), public.drawer_delete_comment(uuid),
  public.drawer_report(text, uuid, text), public.admin_drawer_reports(), public.admin_drawer_moderate(text, uuid, text) to authenticated;

-- 보존 정리: 서랍 답·댓글 30일 · 처리한 신고 90일
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
         set snapshot_a = jsonb_build_object('deleted', true), snapshot_b = jsonb_build_object('deleted', true), match = null, echo_a = null, echo_b = null
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
    delete from public.withdrawal_feedback where created_at <= now() - interval '1 year';
    -- 소개 전 편지: 전해진 소개가 마무리되고 30일이 지나면(다시 읽기 기간과 같게) 지운다. 창가 질문 답은 1년.
    delete from public.prelude_letters l using public.introductions i
     where l.introduction_id = i.id and i.status in ('closed', 'cancelled') and i.closed_at <= now() - interval '30 days';
    delete from public.window_answers where created_at <= now() - interval '1 year';
    -- 정오의 서랍 답·댓글은 30일, 처리한 신고는 90일 뒤 지운다(답을 지우면 댓글·신고 묶음도 함께).
    delete from public.drawer_answers where day < public.kst_date(now()) - 30;
    delete from public.drawer_reports where created_at <= now() - interval '90 days';
    delete from public.job_runs where started_at <= now() - interval '90 days' and id <> run_id;

    result := jsonb_build_object('members', members, 'snapshots', snapshots, 'inquiries', inquiries, 'audits', audits, 'notifications', notes, 'testPayments', test_payments);
    update public.job_runs set finished_at = now(), ok = true, detail = result where id = run_id;
  exception when others then
    result := jsonb_build_object('error', sqlerrm);
    update public.job_runs set finished_at = now(), ok = false, detail = result where id = run_id;
  end;
  return result;
end $function$;
