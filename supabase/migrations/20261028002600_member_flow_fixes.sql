-- 회원 흐름 다듬기(2026-10-28, 서비스 전체 점검 반영)
--  1. 소개가 끝난 까닭과 누구 때문에 끝났는지(ended_by)를 남기고, 소개 횟수에 넣을지(count_a/count_b)를 끝날 때 정한다.
--     횟수에 넣지 않음: 운영 취소·정오 준비 실패·공개 직전 확인 취소, 상대 무응답(답한 쪽), 상대의 탈퇴·이용 정지·차단(남은 쪽)
--  2. 상대가 탈퇴·차단·이용 정지되거나 운영진이 취소해도 남은 쪽에 중립 알림(메일 포함)을 보낸다. 약속이 있었다면 함께 취소됐다고 알린다.
--  3. 무응답 마무리: 답한 쪽에는 '상대가 기한 안에 답하지 않았다'고 사실대로, 답하지 않은 쪽에는 기한 안내.
--     두 번 이어서 답하지 않은 회원은 새 소개를 잠시 쉬게 하고 알린다.
--  4. 마감 작업은 잠금을 잡은 행만 상태를 다시 확인해 닫는다(마감 순간 '서로 선택'이 '무응답'으로 덮이지 않게).
--  5. 정오 공개 직전에 두 사람을 다시 확인한다(활동·승인·쉬기 아님·차단·아는 사람 피하기). 어긋나면 공개하지 않고 취소한다.
--  6. 당일 20:00 응답 알림, 만나기 전날 19:00 연락처 동의 알림.
--  7. 회원 계정이 지워져도 소개·교류·편지 기록은 남긴다(연결만 끊는다). 분쟁·신고 증빙을 지키기 위해서다.
--     정지·신고·차단 이력이 있는 회원이 지워지면 메일·번호를 비밀 값과 섞은 암호값으로 3년 보관해 재가입·재소개를 막는다.
--  8. 같은 두 사람 재소개 예외: 운영 취소·정오 준비 실패·공개 직전 취소, 한쪽이 프로필을 열지도 않은 무응답.
--  9. 교류를 마치면 새 소개를 잠시 쉬게 하고, 다시 받을지는 회원이 정한다.
-- 10. 마무리 알림도 메일로 보낸다. 신고는 운영진에게 바로 알리고, 신고와 요청의 처리 결과는 회원에게 알린다.
--     이용 정지·해제는 본인에게 알린다. 승인 뒤 사진 재등록 요청도 알린다. 신고된 교류의 글은 30일 삭제에서 뺀다.
-- 11. 운영진이 건 쉬기는 회원이 스스로 풀 수 없다.
-- 12. 운영진 후보 목록에 '방금(24시간 안) 마무리된 회원'과 '이전 계정 이력'을 보여 준다.

-- ─────────────────────────────────────────────────────────
-- 1. 끝난 까닭·횟수
alter table public.introductions add column ended_by uuid;
alter table public.introductions add column count_a boolean;
alter table public.introductions add column count_b boolean;
alter table public.profiles add column paused_by text check (paused_by in ('member', 'operator', 'auto'));
update public.profiles set paused_by = 'member' where paused_at is not null and paused_by is null;

create or replace function public.intro_counts(i public.introductions, p_member uuid) returns boolean
language sql stable set search_path = '' as $$
  select case
    when i.status = 'cancelled' then false
    when coalesce(i.end_reason, '') in ('admin-cancel', 'missed-window', 'precheck') then false
    when i.end_reason = 'nonresponse' then (case when i.member_a = p_member then i.response_a else i.response_b end) is null
    when i.end_reason in ('blocked', 'withdrawn', 'suspended') then i.ended_by is not distinct from p_member
    else true end
$$;

-- 같은 두 사람을 다시 소개하지 않는 기준이 되는 소개인지(예외: 운영 사정으로 끝났거나, 한쪽이 열지도 않은 무응답)
create or replace function public.blocks_reintro(i public.introductions) returns boolean
language sql stable set search_path = '' as $$
  select i.status <> 'cancelled'
     and coalesce(i.end_reason, '') not in ('admin-cancel', 'missed-window', 'precheck')
     and not (coalesce(i.end_reason, '') = 'nonresponse' and (i.opened_a_at is null or i.opened_b_at is null))
$$;

create or replace function public.close_introduction(p_id uuid, p_reason text, p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.introductions;
begin
  update public.introductions
     set status = case when status = 'reserved' then 'cancelled' else 'closed' end,
         closed_at = now(), end_reason = p_reason, ended_by = p_actor, view_until = least(view_until, now())
   where id = p_id and status in ('reserved', 'published', 'mutual')
  returning * into i;
  if i.id is null then return; end if;
  update public.introductions set count_a = public.intro_counts(i, i.member_a), count_b = public.intro_counts(i, i.member_b) where id = p_id;
end $$;

create or replace function public.close_introduction(p_id uuid, p_reason text) returns void
language sql security definer set search_path = '' as $$ select public.close_introduction(p_id, p_reason, null::uuid) $$;

-- ─────────────────────────────────────────────────────────
-- 2. 상대 사정·운영 취소로 끝났을 때 남은 쪽에 알린다(공개 전 취소는 회원이 몰랐으므로 알리지 않는다).
create or replace function public.notify_intro_ended(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.introductions; pr public.programs; m uuid; title text; body text; booked boolean;
begin
  select * into i from public.introductions where id = p_id;
  if i.id is null or i.status <> 'closed' then return; end if;
  select * into pr from public.programs where introduction_id = p_id;
  booked := pr.id is not null and pr.meeting_on is not null and pr.meeting_on >= public.kst_today();
  foreach m in array array[i.member_a, i.member_b] loop
    continue when m is null or m is not distinct from i.ended_by;
    if i.end_reason = 'admin-cancel' then
      title := case when pr.id is null then '운영진이 이번 소개를 마무리했어요' else '운영진이 이번 교류를 마무리했어요' end;
      body := '운영 사정으로 여기서 마무리했어요. 불편을 드려 죄송해요. 잘 맞는 분이 준비되면 다시 정오에 소개해 드릴게요.';
    else
      title := case when pr.id is null then '이번 소개는 여기서 마무리됐어요' else '이번 교류는 여기서 마무리됐어요' end;
      body := '상대의 사정으로 더 이어 가기 어려워졌어요. 잘 맞는 분이 준비되면 다시 정오에 소개해 드릴게요.';
    end if;
    if booked then body := '정해 둔 약속도 함께 취소됐어요. 약속 장소에 나가지 않으셔도 돼요. ' || body; end if;
    perform public.notify(m, 'closed', title, body, '/today', 'closed:' || p_id || ':' || m);
  end loop;
end $$;

-- 차단: 진행 중인 소개는 바로 닫고, 상대에게는 이유 없이 마무리만 알린다.
create or replace function public.block_member(p_target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); i record;
begin
  if me is null or p_target = me then raise exception '차단할 상대를 확인해 주세요.'; end if;
  if not exists (select 1 from public.introductions where status <> 'cancelled' and least(member_a, member_b) = least(me, p_target) and greatest(member_a, member_b) = greatest(me, p_target)) then
    raise exception '소개받은 상대만 차단할 수 있어요.';
  end if;
  insert into public.blocks (member_id, blocked_id) values (me, p_target) on conflict do nothing;
  for i in select id from public.introductions where status in ('reserved', 'published', 'mutual') and least(member_a, member_b) = least(me, p_target) and greatest(member_a, member_b) = greatest(me, p_target) loop
    perform public.close_introduction(i.id, 'blocked', me);
    perform public.notify_intro_ended(i.id);
  end loop;
  perform public.write_audit('회원 차단', me::text, '상대 비공개');
end $$;

-- 탈퇴: 진행 중인 소개·교류를 닫고, 상대에게 중립 알림을 보낸다.
create or replace function public.request_withdrawal() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); due timestamptz := now() + interval '7 days'; r record;
begin
  if me is null then raise exception '로그인한 뒤 진행해 주세요.'; end if;
  update public.profiles set status = 'withdrawal_requested', withdrawal_requested_at = now(), deletion_due_at = due, updated_at = now()
   where id = me and status <> 'withdrawal_requested';
  if not found then raise exception '이미 탈퇴를 요청한 계정이에요.'; end if;
  for r in select id from public.introductions where me in (member_a, member_b) and status in ('reserved', 'published', 'mutual') loop
    perform public.close_introduction(r.id, 'withdrawn', me);
    perform public.notify_intro_ended(r.id);
  end loop;
  insert into public.member_requests (member_id, kind, description, status) values (me, 'withdrawal', '계정 화면에서 탈퇴 요청', 'checking');
  perform public.write_audit('탈퇴 요청', me::text);
  return jsonb_build_object('deletionDueAt', due);
end $$;

-- 운영진 소개 취소: 공개된 소개였다면 두 사람 모두에게 알린다.
create or replace function public.admin_cancel_introduction(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '취소 사유를 적어 주세요.'; end if;
  if not exists (select 1 from public.introductions where id = p_id and status in ('reserved', 'published', 'mutual')) then
    raise exception '취소할 수 있는 소개가 없어요.';
  end if;
  perform public.close_introduction(p_id, 'admin-cancel');
  perform public.notify_intro_ended(p_id);
  perform public.write_audit('소개 취소', p_id::text, p_reason);
end $$;

-- 운영진: 쉬기·이용 정지·해제. 정지·해제는 본인에게 알리고, 운영진이 건 쉬기는 회원이 스스로 풀 수 없다.
create or replace function public.admin_set_member_state(p_member uuid, p_state text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; changed int;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_state not in ('pause', 'resume', 'suspend', 'unsuspend') then raise exception '바꿀 상태를 골라 주세요.'; end if;
  if p_state = 'suspend' and coalesce(trim(p_reason), '') = '' then raise exception '이용 정지 사유를 적어 주세요(회원에게 보여요).'; end if;
  if p_state = 'pause' then update public.profiles set paused_at = coalesce(paused_at, now()), paused_by = 'operator', updated_at = now() where id = p_member and paused_by is distinct from 'operator';
  elsif p_state = 'resume' then update public.profiles set paused_at = null, paused_by = null, updated_at = now() where id = p_member and paused_at is not null;
  elsif p_state = 'suspend' then update public.profiles set status = 'suspended', suspended_reason = trim(p_reason), updated_at = now() where id = p_member and status = 'active';
  else update public.profiles set status = 'active', suspended_reason = null, updated_at = now() where id = p_member and status = 'suspended';
  end if;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception '회원을 찾을 수 없거나 이미 그 상태예요.'; end if;
  if p_state = 'suspend' then
    for r in select id from public.introductions where p_member in (member_a, member_b) and status in ('reserved', 'published', 'mutual') loop
      perform public.close_introduction(r.id, 'suspended', p_member);
      perform public.notify_intro_ended(r.id);
    end loop;
    perform public.notify(p_member, 'account-suspended', '이용이 잠시 멈췄어요', '운영진 안내를 오늘 화면에서 확인해 주세요. 다르게 생각되면 문의·요청에서 재검토를 요청할 수 있어요.', '/today', 'suspend:' || p_member || ':' || extract(epoch from now())::bigint);
  elsif p_state = 'unsuspend' then
    perform public.notify(p_member, 'account-resumed', '다시 이용할 수 있어요', '이용 정지가 풀렸어요. 잘 맞는 분이 준비되면 정오에 소개해 드릴게요.', '/today', 'unsuspend:' || p_member || ':' || extract(epoch from now())::bigint);
  elsif p_state = 'pause' then
    perform public.notify(p_member, 'operator-paused', '새 소개를 잠시 멈췄어요', '운영진이 확인할 일이 있어 새 소개 준비를 잠시 멈췄어요. 진행 중인 소개는 그대로예요. 궁금한 점은 문의하기로 남겨 주세요.', '/today', 'opause:' || p_member || ':' || extract(epoch from now())::bigint);
  end if;
  perform public.write_audit('회원 상태 변경 · ' || p_state, p_member::text, nullif(trim(coalesce(p_reason, '')), ''));
end $$;

-- 본인 쉬기·다시 받기(운영진이 건 쉬기는 풀 수 없다)
create or replace function public.set_paused(p_paused boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare by_whom text;
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '로그인한 회원만 바꿀 수 있어요.'; end if;
  select paused_by into by_whom from public.profiles where id = auth.uid();
  if not p_paused and by_whom = 'operator' then raise exception '운영진이 확인하는 동안에는 다시 받기를 할 수 없어요. 문의하기로 남겨 주세요.'; end if;
  update public.profiles set paused_at = case when p_paused then coalesce(paused_at, now()) end,
         paused_by = case when p_paused then coalesce(paused_by, 'member') end, updated_at = now()
   where id = auth.uid();
  perform public.write_audit(case when p_paused then '회원 일시정지' else '회원 다시 받기' end, auth.uid()::text);
  return jsonb_build_object('paused', p_paused);
end $$;

-- ─────────────────────────────────────────────────────────
-- 3·4. 응답 마감: 잠금을 잡은 행만, 아직 공개 상태인지 다시 보고 닫는다.
create or replace function public.run_introduction_deadlines() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; m uuid; own text; other text; misses int;
begin
  begin
    for r in select * from public.introductions where status = 'published' and respond_by <= now() order by respond_by for update skip locked loop
      continue when r.status <> 'published';
      perform public.close_introduction(r.id, 'nonresponse');
      foreach m in array array[r.member_a, r.member_b] loop
        continue when m is null;
        own := case when m = r.member_a then r.response_a else r.response_b end;
        other := case when m = r.member_a then r.response_b else r.response_a end;
        if own = 'positive' and other is null then
          perform public.notify(m, 'closed', '상대가 기한 안에 답하지 않았어요', '거절이 아니라 답이 오지 않아 이번 소개가 마무리됐어요. 잘 맞는 분이 준비되면 다시 정오에 소개해 드릴게요.', '/today', 'closed:' || r.id || ':' || m);
        elsif own is not null then
          perform public.notify(m, 'closed', '이번 소개는 여기서 마무리됐어요', '다음 소개가 준비되면 정오에 알려 드릴게요.', '/today', 'closed:' || r.id || ':' || m);
        else
          perform public.notify(m, 'closed', '답 기한이 지나 소개가 마무리됐어요', '다음 소개부터는 다음 날 오전 11시 전에 답해 주세요. 두 번 이어서 답하지 않으면 새 소개를 잠시 쉬어요.', '/today', 'closed:' || r.id || ':' || m);
          -- 최근 두 소개 모두 내가 답하지 않고 끝났다면 새 소개를 잠시 쉰다.
          select count(*) into misses from (
            select i.* from public.introductions i where m in (i.member_a, i.member_b) and i.status = 'closed' order by i.closed_at desc limit 2) last2
           where last2.end_reason = 'nonresponse' and (case when last2.member_a = m then last2.response_a else last2.response_b end) is null;
          if misses = 2 then
            update public.profiles set paused_at = coalesce(paused_at, now()), paused_by = coalesce(paused_by, 'auto'), updated_at = now() where id = m and paused_at is null;
            if found then
              perform public.notify(m, 'auto-paused', '새 소개를 잠시 쉬고 있어요', '두 번 이어서 답하지 않아 새 소개를 잠시 멈췄어요. 내 정보에서 ‘다시 받기’를 누르면 다음 정오부터 다시 준비해요.', '/profile', 'autopause:' || r.id || ':' || m);
            end if;
          end if;
        end if;
      end loop;
      n := n + 1;
    end loop;
    if n > 0 then insert into public.job_runs (job, finished_at, ok, detail) values ('deadlines', now(), true, jsonb_build_object('closed', n)); end if;
  exception when others then
    insert into public.job_runs (job, finished_at, ok, detail) values ('deadlines', now(), false, jsonb_build_object('error', sqlerrm));
  end;
  return n;
end $$;

-- 소개를 받을 수 있는 상태인지(활동 중·승인·쉬지 않음)
create or replace function public.intro_ready(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p join public.applications a on a.member_id = p.id
                  where p.id = p_member and p.status = 'active' and p.paused_at is null and a.status = 'approved')
$$;

-- ─────────────────────────────────────────────────────────
-- 5. 정오: 공개 직전 확인 → 공개 → 소개 없는 날 알림. 준비가 늦어진 예약은 회원에게도 알린다.
create or replace function public.run_noon() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run_id bigint; published int := 0; missed int := 0; checked int := 0; waiting int := 0; r record; m uuid; today date := public.kst_today(); result jsonb;
begin
  insert into public.job_runs (job) values ('noon') returning id into run_id;
  begin
    for r in update public.introductions set status = 'cancelled', closed_at = now(), end_reason = 'missed-window', count_a = false, count_b = false
               where status = 'reserved' and reveal_at <= now() - interval '30 minutes' returning id, member_a, member_b loop
      missed := missed + 1;
      foreach m in array array[r.member_a, r.member_b] loop
        continue when m is null;
        perform public.notify(m, 'intro-delayed', '오늘 소개 준비가 늦어지고 있어요', '운영진이 확인하고 있어요. 준비되는 대로 다시 정오에 알려 드릴게요.', '/today', 'delayed:' || r.id || ':' || m);
      end loop;
    end loop;
    -- 공개 직전 확인: 그 사이 쉬기·결정 변경·차단·아는 사람 피하기가 생겼다면 공개하지 않는다(회원이 모르는 예약이라 알리지 않는다).
    for r in update public.introductions i set status = 'cancelled', closed_at = now(), end_reason = 'precheck', count_a = false, count_b = false
               where i.status = 'reserved' and i.reveal_at <= now()
                 and (not public.intro_ready(i.member_a) or not public.intro_ready(i.member_b)
                      or exists (select 1 from public.blocks b where (b.member_id = i.member_a and b.blocked_id = i.member_b) or (b.member_id = i.member_b and b.blocked_id = i.member_a))
                      or public.avoid_conflict(i.member_a, i.member_b))
               returning i.id loop
      checked := checked + 1;
    end loop;
    for r in update public.introductions set status = 'published', published_at = now()
               where status = 'reserved' and reveal_at <= now() returning id, member_a, member_b loop
      published := published + 1;
      perform public.notify(r.member_a, 'new-introduction', '오늘의 인연이 도착했어요', '내일 오전 11시까지 답해 주세요.', '/us', 'intro:' || r.id || ':' || r.member_a);
      perform public.notify(r.member_b, 'new-introduction', '오늘의 인연이 도착했어요', '내일 오전 11시까지 답해 주세요.', '/us', 'intro:' || r.id || ':' || r.member_b);
    end loop;
    for r in select p.id from public.profiles p join public.applications a on a.member_id = p.id
              join public.cohorts c on c.number = a.cohort_number and c.starts_on <= today
              where p.status = 'active' and p.paused_at is null and a.status = 'approved' and p.notice_daily_waiting
                and not exists (select 1 from public.introductions i where p.id in (i.member_a, i.member_b) and i.status in ('published', 'mutual')) loop
      waiting := waiting + 1;
      perform public.notify(r.id, 'waiting', '오늘은 소개가 없어요', '잘 맞는 분이 준비되면 정오에 알려 드릴게요.', '/today', 'waiting:' || today || ':' || r.id);
    end loop;
    delete from public.safety_holds where expires_at < now();
    result := jsonb_build_object('published', published, 'missed', missed, 'precheck', checked, 'waiting', waiting);
    update public.job_runs set finished_at = now(), ok = true, detail = result where id = run_id;
  exception when others then
    result := jsonb_build_object('error', sqlerrm);
    update public.job_runs set finished_at = now(), ok = false, detail = result where id = run_id;
  end;
  return result;
end $$;

-- 기수 시작 전날 알림: 쉬는 회원은 빼고, 시작일이 바뀌면 다시 보낼 수 있게 시작일을 열쇠에 넣는다.
create or replace function public.run_cohort_eve() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; label text; ready boolean;
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
  return n;
end $$;

-- ─────────────────────────────────────────────────────────
-- 6. 알림: 당일 20:00 응답 알림(열지 않았거나 답하지 않은 회원), 만나기 전날 19:00 연락처 동의 알림을 더한다.
create or replace function public.run_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; t timestamptz := public.app_now(); today date := public.kst_date(public.app_now()); key text;
begin
  begin
  -- 소개 응답(당일 저녁): 오늘 공개된 소개에 20:00~22:00 사이 아직 답하지 않은 회원
  for r in select i.id, m.member, m.opened from public.introductions i
             cross join lateral (values (i.member_a, i.response_a, i.opened_a_at is not null), (i.member_b, i.response_b, i.opened_b_at is not null)) as m(member, response, opened)
            where i.status = 'published' and m.member is not null and m.response is null and public.kst_date(i.published_at) = today
              and t >= public.kst_at(today, '20:00') and t < public.kst_at(today, '22:00') loop
    key := 'remind-intro-eve:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-response',
        case when r.opened then '오늘의 인연에 아직 답하지 않았어요' else '오늘의 인연을 아직 열어 보지 않았어요' end,
        '내일 오전 11시까지 답해 주세요. 답이 없으면 이번 소개는 마무리돼요.', '/us', key);
      n := n + 1;
    end if;
  end loop;
  -- 소개 응답: 마감(다음 날 11:00) 2시간 전까지 답하지 않은 회원
  for r in select i.id, m.member from public.introductions i
             cross join lateral (values (i.member_a, i.response_a), (i.member_b, i.response_b)) as m(member, response)
            where i.status = 'published' and m.member is not null and m.response is null and t >= i.respond_by - interval '2 hours' and t < i.respond_by loop
    key := 'remind-intro:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-response', '답 마감까지 2시간 남았어요', '오늘 오전 11시까지 답하지 않으면 이번 소개는 마무리돼요.', '/us', key);
      n := n + 1;
    end if;
  end loop;
  -- 그날 글: 18:00까지 보내지 않은 회원
  for r in select p.id, p.plan_a, m.member, today - p.start_on + 1 as day from public.programs p
             cross join lateral (values (p.member_a), (p.member_b)) as m(member)
            where p.status = 'started' and m.member is not null and today between p.start_on and p.start_on + 2 and t >= public.kst_at(today, '18:00')
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
            where p.status = 'choosing' and m.member is not null and m.confirmed is null and t >= p.agree_by - interval '12 hours' and t < p.agree_by loop
    key := 'remind-agree:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-agreement', '교류 방식·시작일 마감이 12시간 남았어요', '두 분이 같은 방식과 시작일을 확인해야 교류가 시작돼요. 마감이 지나면 이번 소개는 마무리돼요.', '/exchange', key);
      n := n + 1;
    end if;
  end loop;
  -- 만남 선택: 마감(DAY05 09:00) 14시간 전까지 고르지 않은 회원
  for r in select p.id, m.member from public.programs p
             cross join lateral (values (p.member_a, p.meeting_a), (p.member_b, p.meeting_b)) as m(member, choice)
            where p.status = 'deciding' and m.member is not null and m.choice is null and t >= p.meeting_by - interval '14 hours' and t < p.meeting_by loop
    key := 'remind-meet:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-meeting', '만남 선택 마감이 다가와요', '내일 오전 9시까지 골라 주세요. 답이 없으면 이번 교류는 마무리돼요.', '/exchange', key);
      n := n + 1;
    end if;
  end loop;
  -- 약속 정하기: 마감 이틀 전까지 약속이 없으면 두 분 모두
  for r in select p.id, m.member from public.programs p cross join lateral (values (p.member_a), (p.member_b)) as m(member)
            where p.status = 'arranging' and m.member is not null and p.meeting_on is null and t >= p.arrange_by - interval '48 hours' and t < p.arrange_by loop
    key := 'remind-arrange:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-arrange', '약속 정하기 마감이 이틀 남았어요', '마감까지 약속이 정해지지 않으면 이번 교류는 마무리돼요.', '/meeting', key);
      n := n + 1;
    end if;
  end loop;
  -- 연락처 공개 동의: 만나기 전날 19:00부터, 아직 동의하지 않은 회원
  for r in select p.id, m.member from public.programs p
             cross join lateral (values (p.member_a, p.contact_a), (p.member_b, p.contact_b)) as m(member, consent)
            where p.status = 'arranging' and p.meeting_on is not null and m.member is not null and m.consent is null
              and t >= public.kst_at(p.meeting_on - 1, '19:00') and t < public.kst_at(p.meeting_on, '00:00') loop
    key := 'remind-contact:' || r.id || ':' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-contact', '내일 만나는 날이에요', '연락처 공개에 두 분 모두 동의해야 만나는 날 서로의 번호가 열려요. 약속 화면에서 확인해 주세요.', '/meeting', key);
      n := n + 1;
    end if;
  end loop;
  -- 신청서: 가입하고 하루가 지나도 신청서를 내지 않은 회원에게 딱 한 번(메일 확인을 마친 회원만)
  for r in select p.id as member, c.number, c.application_deadline from public.profiles p
             join auth.users u on u.id = p.id and u.email_confirmed_at is not null
             left join public.applications a on a.member_id = p.id
             left join lateral (select number, application_deadline from public.cohorts where application_deadline >= today order by number limit 1) c on true
            where p.status = 'active' and (a.member_id is null or a.status = 'draft')
              and not exists (select 1 from public.admin_roles ar where ar.user_id = p.id)
              and coalesce(a.updated_at, p.created_at) < t - interval '24 hours' and coalesce(a.updated_at, p.created_at) > t - interval '7 days' loop
    key := 'remind-draft:' || r.member;
    if not exists (select 1 from public.notifications where dedupe_key = key) then
      perform public.notify(r.member, 'reminder-application', '소개 신청서를 마저 써 주세요',
        '단계마다 저장돼서 쓰던 곳부터 이어서 쓸 수 있어요.' || case when r.application_deadline is not null then ' ' || case when r.number = 0 then '베타' else r.number || '기' end || ' 신청 마감은 ' || to_char(r.application_deadline, 'FMMM"월" FMDD"일"') || '이에요.' else '' end,
        '/apply', key);
      n := n + 1;
    end if;
  end loop;
  if n > 0 then insert into public.job_runs (job, finished_at, ok, detail) values ('reminders', now(), true, jsonb_build_object('sent', n)); end if;
  exception when others then
    insert into public.job_runs (job, finished_at, ok, detail) values ('reminders', now(), false, jsonb_build_object('error', sqlerrm));
  end;
  return n;
end $$;

-- 교류 진행: 마감 처리는 잠금을 잡은 행만. 교류를 마치면 새 소개를 잠시 쉬고 다시 받을지 묻는다. 실패하면 기록을 남긴다.
create or replace function public.run_programs() returns jsonb
language plpgsql security definer set search_path = '' as $$
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
    perform public.close_program(r.id, 'meeting-nonresponse');
    perform public.notify(m, 'program-closed', '이번 교류는 여기서 마무리됐어요',
      case when (case when m = r.member_a then r.meeting_a else r.meeting_b end) is null then '만남 선택 기한이 지났어요. 다음 소개를 준비할게요.' else '상대의 만남 선택이 기한 안에 오지 않았어요. 다음 소개를 준비할게요.' end,
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
    perform public.notify(m, 'contact-released', '오늘 만나는 분의 연락처가 열렸어요', '내일 23:59까지 비포어스 안에서 볼 수 있어요.', '/meeting', 'contact:' || r.id || ':' || r.meeting_on || ':' || m) from unnest(array[r.member_a, r.member_b]) m where m is not null;
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
end $$;

-- ─────────────────────────────────────────────────────────
-- 7. 계정이 지워져도 소개·교류·편지 기록은 남긴다(연결만 끊는다).
alter table public.introductions alter column member_a drop not null, alter column member_b drop not null;
alter table public.introductions drop constraint introductions_member_a_fkey, drop constraint introductions_member_b_fkey;
alter table public.introductions add constraint introductions_member_a_fkey foreign key (member_a) references public.profiles (id) on delete set null,
  add constraint introductions_member_b_fkey foreign key (member_b) references public.profiles (id) on delete set null;
alter table public.programs alter column member_a drop not null, alter column member_b drop not null;
alter table public.programs drop constraint programs_member_a_fkey, drop constraint programs_member_b_fkey;
alter table public.programs add constraint programs_member_a_fkey foreign key (member_a) references public.profiles (id) on delete set null,
  add constraint programs_member_b_fkey foreign key (member_b) references public.profiles (id) on delete set null;
alter table public.program_entries alter column author drop not null;
alter table public.program_entries drop constraint program_entries_author_fkey;
alter table public.program_entries add constraint program_entries_author_fkey foreign key (author) references public.profiles (id) on delete set null;
alter table public.appointment_proposals alter column author drop not null;
alter table public.appointment_proposals drop constraint appointment_proposals_author_fkey;
alter table public.appointment_proposals add constraint appointment_proposals_author_fkey foreign key (author) references public.profiles (id) on delete set null;

-- 8. 같은 두 사람 재소개 기준(지워진 회원과의 기록은 빼고, 예외 사유도 뺀다)
drop index public.introductions_pair_once;
create unique index introductions_pair_once on public.introductions (least(member_a, member_b), greatest(member_a, member_b))
  where member_a is not null and member_b is not null and status <> 'cancelled'
    and coalesce(end_reason, '') not in ('admin-cancel', 'missed-window', 'precheck')
    and not (coalesce(end_reason, '') = 'nonresponse' and (opened_a_at is null or opened_b_at is null));

-- 안전 이력(정지·신고·차단 관계가 있던 회원이 지워질 때): 메일·번호를 비밀 값과 섞은 암호값으로 3년 보관
create table public.safety_holds (
  id uuid primary key default gen_random_uuid(),
  email_hash text,
  phone_hash text,
  reason text not null check (reason in ('suspended', 'reported', 'blocked')),
  other_id uuid references public.profiles (id) on delete cascade,  -- 차단 관계였던 상대(다시 소개하지 않는다)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 years'
);
alter table public.safety_holds enable row level security;
revoke all on public.safety_holds from public, anon, authenticated;
create index safety_holds_email on public.safety_holds (email_hash);
create index safety_holds_phone on public.safety_holds (phone_hash);

create or replace function public.secret_hash(p_value text) returns text
language sql stable security definer set search_path = '' as $$
  select case when nullif(trim(coalesce(p_value, '')), '') is null then null
    else encode(sha256(convert_to(lower(trim(p_value)) || ':' || (select value from public.private_values where name = 'avoid_salt'), 'UTF8')), 'hex') end
$$;

create or replace function public.keep_safety_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare eh text := public.secret_hash(old.email); ph text; other uuid;
begin
  select public.phone_hash(a.draft -> 'values' ->> 'self.phone') into ph from public.applications a
   where a.member_id = old.id and nullif(a.draft -> 'values' ->> 'self.phone', '') is not null;
  if old.status = 'suspended' then insert into public.safety_holds (email_hash, phone_hash, reason) values (eh, ph, 'suspended'); end if;
  if exists (select 1 from public.reports where target_id = old.id and source = 'member') then
    insert into public.safety_holds (email_hash, phone_hash, reason) values (eh, ph, 'reported');
  end if;
  for other in select case when b.member_id = old.id then b.blocked_id else b.member_id end from public.blocks b where old.id in (b.member_id, b.blocked_id) loop
    insert into public.safety_holds (email_hash, phone_hash, reason, other_id) values (eh, ph, 'blocked', other);
  end loop;
  return old;
end $$;
create trigger profiles_keep_safety_history before delete on public.profiles for each row execute function public.keep_safety_history();

-- 이 회원과 맞는 안전 이력(운영진 확인용)
create or replace function public.safety_history(p_member uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct h.reason), '{}') from public.safety_holds h
    join public.profiles p on p.id = p_member
    left join public.applications a on a.member_id = p.id
   where h.expires_at > now() and h.other_id is null
     and (h.email_hash = public.secret_hash(p.email) or h.phone_hash = public.phone_hash(a.draft -> 'values' ->> 'self.phone'))
$$;

-- 지워진 계정 시절 차단 관계였던 사람인지
create or replace function public.held_pair(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from (values (p_a, p_b), (p_b, p_a)) pair(me, other)
      join public.profiles p on p.id = pair.other
      left join public.applications a on a.member_id = p.id
      join public.safety_holds h on h.other_id = pair.me and h.expires_at > now()
     where h.email_hash = public.secret_hash(p.email) or h.phone_hash = public.phone_hash(a.draft -> 'values' ->> 'self.phone'))
$$;

-- ─────────────────────────────────────────────────────────
-- 12. 운영진 후보 목록: 방금 마무리된 회원(released_at)과 이전 계정 이력(history)을 더한다.
drop function if exists public.admin_ready_members();
create function public.admin_ready_members() returns table (
  member_id uuid, name text, gender text, desired text, age int, province text, area text, purpose text,
  last_published_at timestamptz, introductions int, blocked uuid[], previous uuid[], avoided uuid[], released_at timestamptz, history text[]
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
           public.safety_history(a.member_id)
      from public.applications a
      join public.profiles p on p.id = a.member_id and p.status = 'active' and p.paused_at is null
     where a.status = 'approved'
       and not exists (select 1 from public.introductions i where a.member_id in (i.member_a, i.member_b) and i.status in ('reserved', 'published', 'mutual'))
     order by 14 desc nulls last, 9 nulls first;
end $$;

-- 소개 예약: 쉬는 회원·다시 소개하지 않는 두 사람·지워진 계정 시절 차단 관계를 서버에서도 막는다.
create or replace function public.admin_reserve_introduction(p_a uuid, p_b uuid, p_date date, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare reveal timestamptz; snap_a jsonb; snap_b jsonb; new_id uuid; m uuid;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_a = p_b then raise exception '서로 다른 두 회원이 필요해요.'; end if;
  if public.avoid_conflict(p_a, p_b) then raise exception '아는 사람 피하기로 서로 소개하지 않는 두 사람이에요.'; end if;
  if public.held_pair(p_a, p_b) then raise exception '예전 계정에서 차단 관계였던 두 사람으로 보여요. 소개할 수 없어요.'; end if;
  reveal := public.kst_at(p_date, '12:00');
  if reveal <= now() then raise exception '이미 지난 정오에는 예약할 수 없어요. 다음 정오를 골라 주세요.'; end if;
  if char_length(coalesce(trim(p_note), '')) < 10 then raise exception '두 분에게 보일 소개 이유를 10자 이상 적어 주세요.'; end if;
  foreach m in array array[p_a, p_b] loop
    if not exists (select 1 from public.applications a join public.profiles p on p.id = a.member_id
                    where a.member_id = m and a.status = 'approved' and p.status = 'active') then
      raise exception '승인된 활동 회원만 소개할 수 있어요.';
    end if;
    if exists (select 1 from public.profiles where id = m and paused_at is not null) then
      raise exception '새 소개를 쉬고 있는 회원이에요.';
    end if;
    if exists (select 1 from public.introductions where m in (member_a, member_b) and status in ('reserved', 'published', 'mutual')) then
      raise exception '이미 진행 중이거나 예약된 소개가 있는 회원이에요.';
    end if;
    if exists (select 1 from public.introductions where m in (member_a, member_b) and status <> 'cancelled'
                and (reveal_at at time zone 'Asia/Seoul')::date = p_date) then
      raise exception '같은 날 두 번 소개할 수 없어요.';
    end if;
    if (select count(*) from public.application_photos where member_id = m and slot in ('photo.face','photo.upper','photo.style') and review = '기준 확인') < 3 then
      raise exception '필수 사진 세 장의 기준 확인이 필요해요.';
    end if;
  end loop;
  if exists (select 1 from public.blocks where (member_id = p_a and blocked_id = p_b) or (member_id = p_b and blocked_id = p_a)) then
    raise exception '차단 관계인 두 사람은 소개할 수 없어요.';
  end if;
  if exists (select 1 from public.introductions i where least(i.member_a, i.member_b) = least(p_a, p_b) and greatest(i.member_a, i.member_b) = greatest(p_a, p_b) and public.blocks_reintro(i)) then
    raise exception '이미 소개한 적 있는 두 사람이에요.';
  end if;
  snap_a := public.public_profile(p_a);
  snap_b := public.public_profile(p_b);
  insert into public.introductions (member_a, member_b, note, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, created_by)
  values (p_a, p_b, trim(p_note), reveal, public.kst_at(p_date + 1, '11:00'), public.kst_at(p_date + 1, '11:00'), snap_a, snap_b, auth.uid())
  returning id into new_id;
  perform public.write_audit('정오 소개 예약 · ' || p_date, new_id::text);
  return new_id;
end $$;

-- 회원의 지금 소개: 끝난 까닭을 화면이 구분할 수 있게 '내가 끝냈는지'와 '횟수에 넣는지'를 더한다.
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

-- 신청서 고치기: 예정·진행 중인 소개가 있을 때의 안내를 회원이 이해할 수 있게.
create or replace function public.prepare_application_edit() returns text
language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '로그인한 회원만 고칠 수 있어요.'; end if;
  select status into st from public.applications where member_id = auth.uid() for update;
  if st is null then
    insert into public.applications (member_id) values (auth.uid());
    return 'draft';
  end if;
  if st in ('withdrawn', 'rejected') then raise exception '이 신청서는 고칠 수 없어요. 문의하기로 남겨 주세요.'; end if;
  if st in ('reviewing', 'approved', 'held') then
    if exists (select 1 from public.introductions where auth.uid() in (member_a, member_b) and status in ('reserved', 'published', 'mutual')) then
      raise exception '지금 예정되었거나 진행 중인 소개가 있어요. 이번 소개가 끝난 뒤에 고친 내용을 보낼 수 있어요.';
    end if;
    update public.applications
       set status = 'submitted', profile_version = profile_version + 1, decided_at = null, decided_by = null, decision_note = null, updated_at = now()
     where member_id = auth.uid();
    perform public.write_audit('신청서 수정 · 다시 확인 요청', auth.uid()::text);
    return 'submitted';
  end if;
  return st;
end $$;

-- ─────────────────────────────────────────────────────────
-- 10. 알림 다듬기
-- 마무리 알림도 메일로(결과를 사이트에 들어와야만 아는 일이 없게)
create or replace function public.email_class(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind = 'announcement' then 'always'
    when p_kind in ('waiting', 'program-plan', 'program-confirm', 'program-sent', 'program-open') then 'site'
    else 'important' end
$$;

-- 이용 정지 안내는 정지된 회원에게도 메일로 보낸다.
create or replace function public.pending_email_notifications(p_limit int default 50) returns table (id uuid, email text, title text, body text, link text, source text)
language sql stable security definer set search_path = '' as $$
  select x.id, x.email, x.title, x.body, x.link, x.source from (
    select n.id, p.email, n.title, n.body, n.link, 'notification'::text as source, n.created_at, public.email_class(n.kind) = 'always' as urgent
      from public.notifications n join public.profiles p on p.id = n.member_id and (p.status = 'active' or (p.status = 'suspended' and n.kind = 'account-suspended'))
     where n.emailed_at is null and n.created_at > now() - interval '2 days'
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

-- 회원 신고가 들어오면 운영진(소유자·운영자)에게 바로 알린다(급한 신고는 제목에 표시).
create or replace function public.notify_admins_on_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a uuid;
begin
  if new.source <> 'member' then return new; end if;
  for a in select ar.user_id from public.admin_roles ar join public.profiles p on p.id = ar.user_id where ar.role in ('owner', 'operator') loop
    perform public.notify(a, 'admin-report', case when new.urgent then '급한 신고가 들어왔어요' else '신고가 들어왔어요' end,
      '운영진 화면의 신고 목록에서 확인해 주세요.', '/admin', 'report:' || new.id || ':' || a);
  end loop;
  return new;
end $$;
create trigger reports_notify_admins after insert on public.reports for each row execute function public.notify_admins_on_report();

-- 신고 처리 결과를 신고한 회원에게 알린다(상대에게 어떤 조치를 했는지는 말하지 않는다).
create or replace function public.notify_report_result() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.reporter_id is not null and new.status in ('action', 'closed') and old.status is distinct from new.status then
    perform public.notify(new.reporter_id, 'report-handled', '신고를 확인했어요', '운영진이 신고 내용을 확인하고 필요한 조치를 했어요. 더 알려 주실 일이 있으면 문의하기로 남겨 주세요.', '/support', 'report-done:' || new.id || ':' || new.status);
  end if;
  return new;
end $$;
create trigger reports_notify_result after update of status on public.reports for each row execute function public.notify_report_result();

-- 회원 요청(정정·삭제·재검토 등) 결정을 알린다.
create or replace function public.notify_request_result() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.member_id is not null and new.kind <> 'withdrawal' and new.status = 'decided' and old.status is distinct from new.status then
    perform public.notify(new.member_id, 'request-decided', '요청하신 일을 처리했어요', coalesce(left(new.decision, 120), '자세한 내용은 문의·요청 화면에서 확인해 주세요.'), '/support', 'request-done:' || new.id);
  end if;
  return new;
end $$;
create trigger member_requests_notify_result after update of status on public.member_requests for each row execute function public.notify_request_result();

-- 승인된 회원의 사진에 재등록을 요청하면 알린다.
create or replace function public.notify_photo_reupload() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.review = '재등록 요청' and old.review is distinct from new.review
     and exists (select 1 from public.applications where member_id = new.member_id and status in ('approved', 'reviewing', 'held')) then
    perform public.notify(new.member_id, 'photo-reupload', '사진 한 장을 다시 올려 주세요', '운영진 안내를 확인하고 해당 칸의 사진만 다시 올려 주세요. 다시 올리면 바로 확인할게요.', '/apply?edit=1&step=1', 'photo:' || new.id || ':' || extract(epoch from now())::bigint);
  end if;
  return new;
end $$;
create trigger application_photos_notify_reupload after update of review on public.application_photos for each row execute function public.notify_photo_reupload();

-- 신고된 교류의 글은 신고가 끝나고 3년이 지날 때까지 30일 삭제에서 뺀다(신고 증빙).
create or replace function public.run_program_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e int; a int; o int;
begin
  delete from public.program_entries x using public.programs p where x.program_id = p.id and p.status = 'closed' and p.closed_at < now() - interval '30 days'
     and not exists (select 1 from public.reports r where r.introduction_id = p.introduction_id and (r.status <> 'closed' or coalesce(r.handled_at, r.created_at) > now() - interval '3 years'));
  get diagnostics e = row_count;
  delete from public.appointment_proposals x using public.programs p where x.program_id = p.id and p.status = 'closed'
     and coalesce(public.kst_at(p.meeting_on, '00:00'), p.closed_at) < now() - interval '90 days';
  get diagnostics a = row_count;
  update public.programs set meeting_time = null where status = 'closed' and meeting_time is not null
     and coalesce(public.kst_at(meeting_on, '00:00'), closed_at) < now() - interval '90 days';
  insert into public.storage_cleanup (bucket, path)
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'application-photos'
     and (not exists (select 1 from public.profiles pr where pr.id::text = split_part(o.name, '/', 1))
          or (o.created_at < now() - interval '2 days'
              and not exists (select 1 from public.application_photos ap where ap.path = o.name)
              and not exists (select 1 from public.introductions i where (i.snapshot_a -> 'photos') @> jsonb_build_array(jsonb_build_object('path', o.name)) or (i.snapshot_b -> 'photos') @> jsonb_build_array(jsonb_build_object('path', o.name)))))
  on conflict do nothing;
  get diagnostics o = row_count;
  delete from auth.users u where u.email_confirmed_at is null and u.created_at < now() - interval '7 days'
     and not exists (select 1 from public.admin_roles ar where ar.user_id = u.id);
  delete from public.client_errors where at < now() - interval '30 days';
  insert into public.job_runs (job, finished_at, ok, detail) values ('program-retention', now(), true, jsonb_build_object('entries', e, 'proposals', a, 'orphanPhotos', o));
  return jsonb_build_object('entries', e, 'proposals', a, 'orphanPhotos', o);
end $$;

-- ─────────────────────────────────────────────────────────
-- 권한
revoke all on function public.intro_counts(public.introductions, uuid), public.blocks_reintro(public.introductions), public.close_introduction(uuid, text, uuid),
  public.close_introduction(uuid, text), public.notify_intro_ended(uuid), public.intro_ready(uuid), public.secret_hash(text), public.keep_safety_history(),
  public.safety_history(uuid), public.held_pair(uuid, uuid), public.notify_admins_on_report(), public.notify_report_result(), public.notify_request_result(),
  public.notify_photo_reupload(), public.run_introduction_deadlines(), public.run_noon(), public.run_cohort_eve(), public.run_reminders(), public.run_programs(),
  public.run_program_retention(), public.email_class(text), public.pending_email_notifications(int) from public, anon, authenticated;
grant execute on function public.pending_email_notifications(int) to service_role;
revoke all on function public.block_member(uuid), public.request_withdrawal(), public.admin_cancel_introduction(uuid, text), public.admin_set_member_state(uuid, text, text),
  public.set_paused(boolean), public.admin_ready_members(), public.admin_reserve_introduction(uuid, uuid, date, text), public.my_introduction(), public.prepare_application_edit() from public, anon;
grant execute on function public.block_member(uuid), public.request_withdrawal(), public.admin_cancel_introduction(uuid, text), public.admin_set_member_state(uuid, text, text),
  public.set_paused(boolean), public.admin_ready_members(), public.admin_reserve_introduction(uuid, uuid, date, text), public.my_introduction(), public.prepare_application_edit() to authenticated;
