-- 전체 공지(사이트 알림 + 메일)와 기수 전날 알림 다듬기
--  - 베타 종료·정식 전환 같은 중요한 안내는 7일 전에 모든 회원에게 사이트와 메일로 알린다.
--    공지는 ‘메일 알림’을 고르지 않은 회원에게도 메일로 간다(서비스 이용에 꼭 필요한 안내).
--  - 기수 시작 전날 알림: 내일 소개가 예약된 회원에게만 ‘준비해 두었어요’, 아직 예약이 없으면 ‘준비되는 대로’로 안내한다.

create or replace function public.admin_broadcast(p_title text, p_body text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; batch text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_admin(array['owner']) then raise exception '전체 공지는 대표만 보낼 수 있어요.'; end if;
  if char_length(coalesce(trim(p_title), '')) not between 5 and 60 then raise exception '공지 제목은 5~60자로 적어 주세요.'; end if;
  if char_length(coalesce(trim(p_body), '')) not between 10 and 1000 then raise exception '공지 내용은 10~1000자로 적어 주세요.'; end if;
  insert into public.notifications (member_id, kind, title, body, link, dedupe_key)
  select p.id, 'announcement', trim(p_title), trim(p_body), '/today', 'announce:' || batch || ':' || p.id
    from public.profiles p
   where p.status = 'active' and not exists (select 1 from public.admin_roles r where r.user_id = p.id);
  get diagnostics n = row_count;
  perform public.write_audit('전체 공지 · ' || n || '명', batch, trim(p_title));
  return n;
end $$;

create or replace function public.pending_email_notifications(p_limit int default 50) returns table (id uuid, email text, title text, body text, link text)
language sql stable security definer set search_path = '' as $$
  select n.id, p.email, n.title, n.body, n.link from public.notifications n join public.profiles p on p.id = n.member_id and p.status = 'active'
   where n.emailed_at is null and (p.notify_email or n.kind = 'announcement') and n.created_at > now() - interval '1 day'
   order by n.kind = 'announcement' desc, n.created_at limit p_limit
$$;

create or replace function public.run_cohort_eve() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; label text; ready boolean;
begin
  for r in select a.member_id, c.number, c.starts_on from public.applications a join public.cohorts c on c.number = a.cohort_number
            join public.profiles p on p.id = a.member_id and p.status = 'active'
           where a.status = 'approved' and c.starts_on = public.kst_today() + 1 loop
    label := case when r.number = 0 then '베타' else r.number || '기' end;
    ready := exists (select 1 from public.introductions i where r.member_id in (i.member_a, i.member_b) and i.status = 'reserved'
                      and (i.reveal_at at time zone 'Asia/Seoul')::date = r.starts_on);
    perform public.notify(r.member_id, 'cohort-eve',
      case when ready then label || ' 첫 소개가 내일 정오에 도착해요' else label || '가 내일 정오에 시작해요' end,
      case when ready then '잘 맞는 분을 준비해 두었어요. 내일 정오에 오늘 화면에서 확인해 주세요.' else '잘 맞는 분이 준비되는 날 정오에 알려 드릴게요. 매일 소개를 보장하지는 않아요.' end,
      '/today', 'cohort-eve:' || r.number || ':' || r.member_id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.admin_broadcast(text, text) from public, anon;
grant execute on function public.admin_broadcast(text, text) to authenticated;
revoke all on function public.pending_email_notifications(int) from public, anon, authenticated;
grant execute on function public.pending_email_notifications(int) to service_role;
