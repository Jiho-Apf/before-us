-- 5100: 정오의 서랍 ‘고마워요’ · 고민 편지함(고민은 글로, 답장은 편지로 · 정오에 도착)
--
-- 고마워요: 서랍 답·댓글에 남기는 조용한 반응. 숫자는 누구에게도 공개하지 않고, 쓴 사람에게만 “누군가 고마워했어요”가 간다.
-- 고민 편지함: 회원이 고민을 이름 없이 글로 올리면(누구나 읽기), 다른 회원은 댓글 대신 편지로만 답한다.
--   글마다 편지가 몇 통 왔는지만 보이고, 편지 내용은 고민을 쓴 분만 읽는다. 편지는 쓴 다음 정오에 도착하고(정오 전에 쓰면 그날 정오),
--   받은 편지에는 횟수 제한 없이 답장을 주고받을 수 있다(내 정보 > 고민 편지함). 어느 쪽이든 그만 주고받기를 누를 수 있다.
--   연락처·SNS는 막고, 글은 서로 다른 세 분이 신고하면 바로 가린다. 편지는 받은 분이 신고하면 그 편지를 가리고 주고받기를 멈춘다.
-- 보존: 고민 글은 30일, 편지는 마지막 편지 뒤 90일. 처리한 신고는 90일.

-- ── 고마워요
create table if not exists public.drawer_thanks (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid references public.drawer_answers (id) on delete cascade,
  comment_id uuid references public.drawer_comments (id) on delete cascade,
  member uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((answer_id is null) <> (comment_id is null)),
  unique (answer_id, member),
  unique (comment_id, member)
);
alter table public.drawer_thanks enable row level security;
revoke all on public.drawer_thanks from anon, authenticated;

-- 서랍 알림(고마워요·편지 도착·친구 추천사)은 사이트에서 보여 주고, 메일은 ‘모두 받기’를 고른 분에게만 보낸다.
create or replace function public.email_class(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind = 'announcement' then 'always'
    when p_kind in ('waiting', 'program-sent', 'program-open', 'program-final', 'drawer-thanks', 'worry-letter', 'vouch') then 'site'
    else 'important' end
$$;

-- 고마워요 누르기·거두기. 내 글에는 누를 수 없다. 쓴 분에게는 글마다 처음 한 번만 알린다(숫자 없이).
create or replace function public.drawer_thank(p_kind text, p_id uuid, p_on boolean default true) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); owner uuid; hidden timestamptz;
begin
  if me is null or not public.is_active_member() then raise exception '로그인하면 고마워요를 남길 수 있어요.'; end if;
  if p_kind = 'answer' then select author, hidden_at into owner, hidden from public.drawer_answers where id = p_id;
  elsif p_kind = 'comment' then select author, hidden_at into owner, hidden from public.drawer_comments where id = p_id;
  else raise exception '글을 확인해 주세요.'; end if;
  if owner is null or hidden is not null then raise exception '글을 찾을 수 없어요.'; end if;
  if owner = me then raise exception '내 글에는 고마워요를 남길 수 없어요.'; end if;
  if not coalesce(p_on, true) then
    delete from public.drawer_thanks where member = me and (case when p_kind = 'answer' then answer_id else comment_id end) = p_id;
    return false;
  end if;
  if p_kind = 'answer' then insert into public.drawer_thanks (answer_id, member) values (p_id, me) on conflict do nothing;
  else insert into public.drawer_thanks (comment_id, member) values (p_id, me) on conflict do nothing; end if;
  perform public.notify(owner, 'drawer-thanks', '누군가 고마워했어요',
    case when p_kind = 'answer' then '정오의 서랍에 남긴 답을 읽고 누군가 고마워했어요.' else '정오의 서랍에 남긴 댓글을 읽고 누군가 고마워했어요.' end,
    '/drawer', 'thanks:' || p_kind || ':' || p_id);
  return true;
end $$;

-- 그날의 질문과 답: 고마워요(내가 눌렀는지 · 내 글이면 받은 수)를 더한다. 받은 수는 쓴 분에게만 간다.
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
             'comments', (select count(*)::int from public.drawer_comments c where c.answer_id = a.id and c.hidden_at is null),
             'thanked', me is not null and exists (select 1 from public.drawer_thanks t where t.answer_id = a.id and t.member = me),
             'thanks', case when a.author = me then (select count(*)::int from public.drawer_thanks t where t.answer_id = a.id) end) x
        from public.drawer_answers a where a.day = p_day and a.hidden_at is null order by a.created_at desc limit 60) t), '[]'::jsonb));
end $$;

create or replace function public.drawer_comments_of(p_answer uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); a public.drawer_answers;
begin
  select * into a from public.drawer_answers where id = p_answer and hidden_at is null;
  if a.id is null then raise exception '글을 찾을 수 없어요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'alias', case when c.author = a.author then '글쓴이' else public.drawer_alias(a.id, c.author) end,
           'body', c.body, 'at', c.created_at, 'mine', c.author = me,
           'thanked', me is not null and exists (select 1 from public.drawer_thanks t where t.comment_id = c.id and t.member = me),
           'thanks', case when c.author = me then (select count(*)::int from public.drawer_thanks t where t.comment_id = c.id) end) order by c.created_at)
    from public.drawer_comments c where c.answer_id = a.id and c.hidden_at is null), '[]'::jsonb);
end $$;

-- ── 고민 편지함
create table if not exists public.worry_posts (
  id uuid primary key default gen_random_uuid(),
  author uuid not null references public.profiles (id) on delete cascade,
  topic text not null check (topic in ('love', 'people', 'work', 'mind')),
  body text not null check (char_length(body) between 10 and 600),
  created_at timestamptz not null default now(),
  closes_at timestamptz not null,
  hidden_at timestamptz,
  hidden_by text check (hidden_by in ('reports', 'operator'))
);
create index if not exists worry_posts_created on public.worry_posts (created_at desc);
create table if not exists public.worry_threads (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.worry_posts (id) on delete cascade,
  writer uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by text check (closed_by in ('author', 'writer', 'report', 'operator')),
  unique (post_id, writer)
);
create table if not exists public.worry_letters (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.worry_threads (id) on delete cascade,
  sender uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 5 and 1000),
  created_at timestamptz not null default now(),
  deliver_at timestamptz not null,
  read_at timestamptz,
  notified_at timestamptz,
  hidden_at timestamptz,
  hidden_by text check (hidden_by in ('report', 'operator'))
);
create index if not exists worry_letters_thread on public.worry_letters (thread_id, created_at);
create index if not exists worry_letters_deliver on public.worry_letters (deliver_at) where notified_at is null;
create table if not exists public.worry_reports (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('post', 'letter')),
  target_id uuid not null,
  reporter uuid not null references public.profiles (id) on delete cascade,
  reason text check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (target_kind, target_id, reporter)
);
alter table public.worry_posts enable row level security;
alter table public.worry_threads enable row level security;
alter table public.worry_letters enable row level security;
alter table public.worry_reports enable row level security;
revoke all on public.worry_posts, public.worry_threads, public.worry_letters, public.worry_reports from anon, authenticated;

-- 편지가 도착하는 때: 쓴 다음 정오(정오 전에 쓰면 그날 정오)
create or replace function public.worry_deliver_at(p_at timestamptz) returns timestamptz
language sql stable set search_path = '' as $$
  select case when p_at < public.kst_at(public.kst_date(p_at), '12:00') then public.kst_at(public.kst_date(p_at), '12:00')
              else public.kst_at(public.kst_date(p_at) + 1, '12:00') end
$$;
-- 편지 쪽 별명: 주고받는 편지(묶음)마다 새로 붙는다. 고민 글의 별명과는 따로다.
create or replace function public.worry_alias(p_seed uuid, p_member uuid) returns text
language sql immutable set search_path = '' as $$
  select (array['창가의', '정오의', '늦은 오후의', '조용한', '따뜻한', '느린', '바람 부는', '햇살 든', '비 오는 날의', '잎 그림자 아래'])[(abs(hashtext('w:' || p_seed::text || ':' || p_member::text)) % 10) + 1]
      || ' ' || (array['산책자', '고양이', '편지', '우산', '서점', '찻잔', '나무', '구름', '벤치', '엽서'])[((abs(hashtext(p_member::text || ':w:' || p_seed::text)) / 7) % 10) + 1]
$$;
revoke all on function public.worry_deliver_at(timestamptz), public.worry_alias(uuid, uuid) from public, anon, authenticated;

-- 고민 목록: 누구나 읽는다(최근 14일 · 가린 글 빼고 · 최신 40개). 편지는 통 수만 보인다.
create or replace function public.worry_board(p_topic text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if p_topic is not null and p_topic not in ('love', 'people', 'work', 'mind') then raise exception '주제를 확인해 주세요.'; end if;
  return jsonb_build_object('signedIn', me is not null,
    'canPost', me is not null and public.is_active_member(),
    'posts', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
      select jsonb_build_object('id', p.id, 'alias', public.drawer_alias(p.id, p.author), 'topic', p.topic, 'body', p.body, 'at', p.created_at,
               'closesAt', p.closes_at, 'open', public.app_now() < p.closes_at, 'mine', p.author = me,
               'letters', (select count(*)::int from public.worry_threads t where t.post_id = p.id
                            and exists (select 1 from public.worry_letters l where l.thread_id = t.id and l.sender = t.writer and l.hidden_at is null)),
               'sent', me is not null and exists (select 1 from public.worry_threads t where t.post_id = p.id and t.writer = me)) x
        from public.worry_posts p
       where p.hidden_at is null and p.created_at > public.app_now() - interval '14 days' and (p_topic is null or p.topic = p_topic)
       order by p.created_at desc limit 40) y), '[]'::jsonb));
end $$;

-- 고민 올리기: 하루 하나, 편지를 받는 고민은 한 번에 둘까지. 7일 동안 편지를 받는다.
create or replace function public.worry_post(p_topic text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); clean text := trim(coalesce(p_body, '')); new_id uuid;
begin
  if me is null or not public.is_active_member() then raise exception '로그인하면 이름 없이 고민을 남길 수 있어요.'; end if;
  if p_topic is null or p_topic not in ('love', 'people', 'work', 'mind') then raise exception '주제를 골라 주세요.'; end if;
  if char_length(clean) < 10 or char_length(clean) > 600 then raise exception '10~600자로 적어 주세요.'; end if;
  perform public.check_member_text(clean, '고민 글');
  if exists (select 1 from public.worry_posts where author = me and public.kst_date(created_at) = public.kst_date(public.app_now())) then
    raise exception '고민은 하루에 하나씩 남길 수 있어요.';
  end if;
  if (select count(*) from public.worry_posts where author = me and closes_at > public.app_now() and hidden_at is null) >= 2 then
    raise exception '편지를 받는 고민이 이미 둘 있어요. 하나가 마무리된 뒤 남겨 주세요.';
  end if;
  insert into public.worry_posts (author, topic, body, created_at, closes_at) values (me, p_topic, clean, public.app_now(), public.app_now() + interval '7 days') returning id into new_id;
  return new_id;
end $$;

create or replace function public.worry_delete_post(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.worry_posts where id = p_id and author = auth.uid();
  if not found then raise exception '지울 수 있는 고민이 없어요.'; end if;
end $$;

-- 한 편지 묶음(고민 글 하나 × 편지를 쓴 분 한 명). 나에게 온 편지는 도착한 것만 보이고, 열면 읽음으로 바꾼다.
create or replace function public.worry_thread(p_thread uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); t public.worry_threads; p public.worry_posts; role text;
begin
  select * into t from public.worry_threads where id = p_thread;
  if t.id is null then raise exception '편지를 찾을 수 없어요.'; end if;
  select * into p from public.worry_posts where id = t.post_id;
  if me = p.author then role := 'author'; elsif me = t.writer then role := 'writer'; else raise exception '편지를 찾을 수 없어요.'; end if;
  update public.worry_letters set read_at = public.app_now()
   where thread_id = t.id and sender <> me and read_at is null and deliver_at <= public.app_now() and hidden_at is null;
  return jsonb_build_object('id', t.id, 'role', role, 'closed', t.closed_at is not null, 'closedBy', t.closed_by,
    'partner', case when role = 'author' then public.worry_alias(t.id, t.writer) else '고민을 쓴 분' end,
    'post', jsonb_build_object('id', p.id, 'topic', p.topic, 'body', case when p.hidden_at is null or role = 'author' then p.body end, 'at', p.created_at, 'hidden', p.hidden_at is not null),
    'letters', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'mine', l.sender = me, 'body', l.body, 'at', l.created_at, 'deliverAt', l.deliver_at,
                 'delivered', l.deliver_at <= public.app_now(), 'read', l.read_at is not null) order by l.created_at)
       from public.worry_letters l where l.thread_id = t.id and l.hidden_at is null and (l.sender = me or l.deliver_at <= public.app_now())), '[]'::jsonb));
end $$;

-- 편지 보내기: 다른 분의 고민에 첫 편지(한 분에 한 번 · 편지를 받는 7일 동안), 이어지는 답장은 횟수 제한 없이.
create or replace function public.worry_letter_check(p_body text) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); clean text := trim(coalesce(p_body, ''));
begin
  if me is null or not public.is_active_member() then raise exception '로그인하면 편지를 보낼 수 있어요.'; end if;
  if char_length(clean) < 5 or char_length(clean) > 1000 then raise exception '5~1000자로 적어 주세요.'; end if;
  perform public.check_member_text(clean, '편지');
  if (select count(*) from public.worry_letters where sender = me and created_at > public.app_now() - interval '1 day') >= 40 then
    raise exception '오늘은 편지를 충분히 보냈어요. 내일 다시 이어 주세요.';
  end if;
  return clean;
end $$;
revoke all on function public.worry_letter_check(text) from public, anon, authenticated;

create or replace function public.worry_send_letter(p_post uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); clean text; p public.worry_posts; thread uuid;
begin
  clean := public.worry_letter_check(p_body);
  select * into p from public.worry_posts where id = p_post and hidden_at is null;
  if p.id is null then raise exception '고민을 찾을 수 없어요.'; end if;
  if p.author = me then raise exception '내 고민에는 편지를 보낼 수 없어요.'; end if;
  if public.app_now() >= p.closes_at then raise exception '편지를 받는 기간이 끝난 고민이에요.'; end if;
  if exists (select 1 from public.worry_threads where post_id = p.id and writer = me) then
    raise exception '이 고민에는 이미 편지를 보냈어요. 이어지는 편지는 내 정보 > 고민 편지함에서 쓸 수 있어요.';
  end if;
  if (select count(*) from public.worry_threads where writer = me and created_at > public.app_now() - interval '1 day') >= 10 then
    raise exception '오늘은 새 편지를 충분히 보냈어요. 내일 다시 이어 주세요.';
  end if;
  insert into public.worry_threads (post_id, writer, created_at) values (p.id, me, public.app_now()) returning id into thread;
  insert into public.worry_letters (thread_id, sender, body, created_at, deliver_at) values (thread, me, clean, public.app_now(), public.worry_deliver_at(public.app_now()));
  return public.worry_thread(thread);
end $$;

create or replace function public.worry_reply(p_thread uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); clean text; t public.worry_threads; p public.worry_posts;
begin
  clean := public.worry_letter_check(p_body);
  select * into t from public.worry_threads where id = p_thread for update;
  if t.id is null then raise exception '편지를 찾을 수 없어요.'; end if;
  select * into p from public.worry_posts where id = t.post_id;
  if me <> p.author and me <> t.writer then raise exception '편지를 찾을 수 없어요.'; end if;
  if t.closed_at is not null then raise exception '더는 주고받지 않기로 한 편지예요.'; end if;
  if p.hidden_at is not null then raise exception '가려진 고민이라 편지를 이어 갈 수 없어요.'; end if;
  insert into public.worry_letters (thread_id, sender, body, created_at, deliver_at) values (t.id, me, clean, public.app_now(), public.worry_deliver_at(public.app_now()));
  return public.worry_thread(t.id);
end $$;

-- 정오 전이면 보낸 편지를 거둘 수 있다(첫 편지를 거두면 묶음도 함께 사라진다).
create or replace function public.worry_cancel_letter(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); l public.worry_letters;
begin
  select * into l from public.worry_letters where id = p_id and sender = me;
  if l.id is null then raise exception '거둘 수 있는 편지가 없어요.'; end if;
  if l.deliver_at <= public.app_now() then raise exception '이미 도착한 편지는 거둘 수 없어요.'; end if;
  delete from public.worry_letters where id = l.id;
  delete from public.worry_threads t where t.id = l.thread_id and not exists (select 1 from public.worry_letters x where x.thread_id = t.id);
end $$;

-- 그만 주고받기(어느 쪽이든). 이미 보낸 편지는 그대로 두고, 새 편지만 막는다.
create or replace function public.worry_close_thread(p_thread uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); t public.worry_threads; author uuid;
begin
  select * into t from public.worry_threads where id = p_thread;
  select p.author into author from public.worry_posts p where p.id = t.post_id;
  if t.id is null or (me <> author and me <> t.writer) then raise exception '편지를 찾을 수 없어요.'; end if;
  update public.worry_threads set closed_at = coalesce(closed_at, public.app_now()), closed_by = coalesce(closed_by, case when me = author then 'author' else 'writer' end) where id = t.id;
end $$;

-- 내 편지함(내 정보): 내 고민에 온 편지 묶음과 내가 보낸 편지 묶음. 마지막 편지 미리보기와 아직 읽지 않은 수.
create or replace function public.worry_mailbox() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); now_at timestamptz := public.app_now();
begin
  if me is null then raise exception '로그인이 필요해요.'; end if;
  return jsonb_build_object(
    'posts', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
      select jsonb_build_object('id', p.id, 'topic', p.topic, 'body', p.body, 'at', p.created_at, 'open', now_at < p.closes_at, 'hidden', p.hidden_at is not null,
               'threads', coalesce((select jsonb_agg(th order by th ->> 'lastAt' desc) from (
                 select jsonb_build_object('id', t.id, 'partner', public.worry_alias(t.id, t.writer), 'closed', t.closed_at is not null,
                          'unread', (select count(*)::int from public.worry_letters l where l.thread_id = t.id and l.sender <> me and l.read_at is null and l.deliver_at <= now_at and l.hidden_at is null),
                          'lastAt', (select max(l.created_at) from public.worry_letters l where l.thread_id = t.id and l.hidden_at is null and (l.sender = me or l.deliver_at <= now_at)),
                          'last', (select left(l.body, 80) from public.worry_letters l where l.thread_id = t.id and l.hidden_at is null and (l.sender = me or l.deliver_at <= now_at) order by l.created_at desc limit 1),
                          'waiting', (select count(*)::int from public.worry_letters l where l.thread_id = t.id and l.sender <> me and l.deliver_at > now_at and l.hidden_at is null)) th
                   from public.worry_threads t where t.post_id = p.id) z where (z.th ->> 'last') is not null or (z.th ->> 'waiting')::int > 0), '[]'::jsonb)) x
        from public.worry_posts p where p.author = me) y), '[]'::jsonb),
    'sent', coalesce((select jsonb_agg(x order by x ->> 'lastAt' desc) from (
      select jsonb_build_object('id', t.id, 'topic', p.topic, 'post', left(p.body, 80), 'closed', t.closed_at is not null or p.hidden_at is not null,
               'unread', (select count(*)::int from public.worry_letters l where l.thread_id = t.id and l.sender <> me and l.read_at is null and l.deliver_at <= now_at and l.hidden_at is null),
               'lastAt', (select max(l.created_at) from public.worry_letters l where l.thread_id = t.id and l.hidden_at is null and (l.sender = me or l.deliver_at <= now_at)),
               'last', (select left(l.body, 80) from public.worry_letters l where l.thread_id = t.id and l.hidden_at is null and (l.sender = me or l.deliver_at <= now_at) order by l.created_at desc limit 1)) x
        from public.worry_threads t join public.worry_posts p on p.id = t.post_id where t.writer = me) y), '[]'::jsonb));
end $$;

-- 신고: 고민 글은 서로 다른 세 분이 신고하면 바로 가린다. 편지는 받은 분만 신고할 수 있고, 신고하면 그 편지를 가리고 주고받기를 멈춘다.
create or replace function public.worry_report(p_kind text, p_id uuid, p_reason text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); owner uuid; t public.worry_threads; author uuid; n int;
begin
  if me is null or not public.is_active_member() then raise exception '로그인하면 신고할 수 있어요.'; end if;
  if p_kind = 'post' then
    select p.author into owner from public.worry_posts p where p.id = p_id;
    if owner is null then raise exception '글을 찾을 수 없어요.'; end if;
    if owner = me then raise exception '내 글은 지우기로 정리해 주세요.'; end if;
  elsif p_kind = 'letter' then
    select l.sender into owner from public.worry_letters l where l.id = p_id;
    if owner is null then raise exception '편지를 찾을 수 없어요.'; end if;
    select x.* into t from public.worry_threads x where x.id = (select l.thread_id from public.worry_letters l where l.id = p_id);
    select p.author into author from public.worry_posts p where p.id = t.post_id;
    if owner = me or (me <> author and me <> t.writer) then raise exception '받은 편지만 신고할 수 있어요.'; end if;
  else raise exception '신고할 글을 확인해 주세요.'; end if;
  insert into public.worry_reports (target_kind, target_id, reporter, reason) values (p_kind, p_id, me, nullif(left(trim(coalesce(p_reason, '')), 200), ''))
  on conflict (target_kind, target_id, reporter) do nothing;
  if p_kind = 'post' then
    select count(*) into n from public.worry_reports where target_kind = 'post' and target_id = p_id and resolved_at is null;
    if n >= 3 then update public.worry_posts set hidden_at = coalesce(hidden_at, now()), hidden_by = coalesce(hidden_by, 'reports') where id = p_id; end if;
  else
    update public.worry_letters set hidden_at = coalesce(hidden_at, now()), hidden_by = coalesce(hidden_by, 'report') where id = p_id;
    update public.worry_threads set closed_at = coalesce(closed_at, now()), closed_by = coalesce(closed_by, 'report') where id = t.id;
  end if;
  return '신고를 받았어요. 운영진이 확인할게요.';
end $$;

-- 정오 배달 알림(매일 12:01): 도착한 편지를 받는 분마다 한 번에 묶어 알린다.
create or replace function public.run_letter_delivery() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in
    select case when l.sender = p.author then t.writer else p.author end as recipient, count(*)::int as letters, array_agg(l.id) as ids
      from public.worry_letters l join public.worry_threads t on t.id = l.thread_id join public.worry_posts p on p.id = t.post_id
     where l.notified_at is null and l.deliver_at <= public.app_now() and l.hidden_at is null
     group by 1
  loop
    perform public.notify(r.recipient, 'worry-letter', '정오에 편지가 도착했어요',
      case when r.letters > 1 then '고민 편지함에 편지 ' || r.letters || '통이 와 있어요.' else '고민 편지함에 편지 한 통이 와 있어요.' end,
      '/profile#mailbox', 'worry:' || r.recipient || ':' || public.kst_date(public.app_now()));
    update public.worry_letters set notified_at = public.app_now() where id = any (r.ids);
    n := n + 1;
  end loop;
  return n;
end $$;

-- 운영진: 신고된 고민·편지와 가려진 고민(편지는 신고된 것만 보인다).
create or replace function public.admin_worry_reports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner', 'operator', 'counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'lastAt' desc) from (
    select jsonb_build_object('kind', t.kind, 'id', t.id, 'topic', t.topic, 'body', t.body, 'createdAt', t.created_at, 'hidden', t.hidden_at is not null, 'hiddenBy', t.hidden_by,
             'reports', (select count(*)::int from public.worry_reports r where r.target_kind = t.kind and r.target_id = t.id and r.resolved_at is null),
             'reasons', (select coalesce(jsonb_agg(r.reason) filter (where r.reason is not null), '[]'::jsonb) from public.worry_reports r where r.target_kind = t.kind and r.target_id = t.id and r.resolved_at is null),
             'lastAt', greatest(t.hidden_at, (select max(r.created_at) from public.worry_reports r where r.target_kind = t.kind and r.target_id = t.id))) x
      from (select 'post' kind, p.id, p.topic, p.body, p.created_at, p.hidden_at, p.hidden_by from public.worry_posts p
            union all select 'letter', l.id, p.topic, l.body, l.created_at, l.hidden_at, l.hidden_by
              from public.worry_letters l join public.worry_threads th on th.id = l.thread_id join public.worry_posts p on p.id = th.post_id
             where exists (select 1 from public.worry_reports r where r.target_kind = 'letter' and r.target_id = l.id)) t
     where (t.kind = 'post' and t.hidden_at is not null) or exists (select 1 from public.worry_reports r where r.target_kind = t.kind and r.target_id = t.id and r.resolved_at is null)) y), '[]'::jsonb);
end $$;

create or replace function public.admin_worry_moderate(p_kind text, p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner', 'operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_kind not in ('post', 'letter') or p_action not in ('hide', 'restore', 'dismiss') then raise exception '처리할 내용을 확인해 주세요.'; end if;
  if p_action = 'hide' then
    if p_kind = 'post' then update public.worry_posts set hidden_at = coalesce(hidden_at, now()), hidden_by = 'operator' where id = p_id;
    else
      update public.worry_letters set hidden_at = coalesce(hidden_at, now()), hidden_by = 'operator' where id = p_id;
      update public.worry_threads set closed_at = coalesce(closed_at, now()), closed_by = 'operator' where id = (select thread_id from public.worry_letters where id = p_id);
    end if;
  elsif p_action = 'restore' then
    if p_kind = 'post' then update public.worry_posts set hidden_at = null, hidden_by = null where id = p_id;
    else update public.worry_letters set hidden_at = null, hidden_by = null where id = p_id; end if;
  end if;
  update public.worry_reports set resolved_at = now() where target_kind = p_kind and target_id = p_id and resolved_at is null;
  perform public.write_audit('고민 편지함 ' || case p_kind when 'post' then '글 ' else '편지 ' end || case p_action when 'hide' then '가림' when 'restore' then '되돌림' else '신고 닫음' end, p_kind || ':' || p_id, null);
end $$;

revoke all on function public.worry_board(text) from public;
grant execute on function public.worry_board(text) to anon, authenticated;
revoke all on function public.drawer_thank(text, uuid, boolean), public.worry_post(text, text), public.worry_delete_post(uuid), public.worry_thread(uuid),
  public.worry_send_letter(uuid, text), public.worry_reply(uuid, text), public.worry_cancel_letter(uuid), public.worry_close_thread(uuid), public.worry_mailbox(),
  public.worry_report(text, uuid, text), public.admin_worry_reports(), public.admin_worry_moderate(text, uuid, text) from public, anon;
grant execute on function public.drawer_thank(text, uuid, boolean), public.worry_post(text, text), public.worry_delete_post(uuid), public.worry_thread(uuid),
  public.worry_send_letter(uuid, text), public.worry_reply(uuid, text), public.worry_cancel_letter(uuid), public.worry_close_thread(uuid), public.worry_mailbox(),
  public.worry_report(text, uuid, text), public.admin_worry_reports(), public.admin_worry_moderate(text, uuid, text) to authenticated;
revoke all on function public.run_letter_delivery() from public, anon, authenticated;

-- 보존 정리: 고민 글 30일(편지가 오가는 동안은 그대로) · 편지 묶음은 마지막 편지 뒤 90일 · 처리한 신고 90일
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
    -- 고민 편지함: 마지막 편지 뒤 90일이 지난 편지 묶음, 30일이 지나고 이어지는 편지가 없는 고민 글, 처리한 신고 90일
    delete from public.worry_threads t
     where t.created_at <= now() - interval '90 days'
       and not exists (select 1 from public.worry_letters l where l.thread_id = t.id and l.created_at > now() - interval '90 days');
    delete from public.worry_posts p
     where p.created_at <= now() - interval '30 days' and not exists (select 1 from public.worry_threads t where t.post_id = p.id);
    delete from public.worry_reports where created_at <= now() - interval '90 days' and resolved_at is not null;
    delete from public.job_runs where started_at <= now() - interval '90 days' and id <> run_id;

    result := jsonb_build_object('members', members, 'snapshots', snapshots, 'inquiries', inquiries, 'audits', audits, 'notifications', notes, 'testPayments', test_payments);
    update public.job_runs set finished_at = now(), ok = true, detail = result where id = run_id;
  exception when others then
    result := jsonb_build_object('error', sqlerrm);
    update public.job_runs set finished_at = now(), ok = false, detail = result where id = run_id;
  end;
  return result;
end $function$;
