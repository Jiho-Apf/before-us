-- 6900: GPT 3차 검수 R3-16 — 정오 공개 장애를 ‘미공개 · 공개 뒤 응답 유실 · 한쪽 메일 실패’로 나눠 보는 운영진 복구 함수
--
-- 원칙: 이미 공개한 소개(published_at 있음)는 절대 다음 날로 옮기지 않는다. run_noon 은 status='reserved' 인 소개만 공개·취소하므로
--       같은 날 두 번(12:00·12:05) 돌거나 운영진이 다시 불러도 공개 시각·응답 마감·알림이 바뀌지 않는다(알림은 dedupe_key 로 한 번).
--   · admin_noon_status(날짜): 그날 정오 소개마다 published_at · 현재 상태 · 양쪽 응답 · 알림 번호와 메일 상태 · 그날 정오 작업 기록.
--     판정(verdict): not-published(아직 공개 전 · 예약 그대로) / missed(30분 넘게 못 열어 취소 · 기존 규칙대로 다시 예약) /
--                    published(공개됨 · 메일만 확인) / mail-issue(공개됐지만 한쪽 이상 메일 불확실·실패) / closed(그 뒤 마무리)
--   · admin_run_noon(): 정오 작업을 지금 한 번 더 돌린다(같은 결과면 아무것도 바뀌지 않음 · 감사 기록). 아직 공개 전인 소개만 대상.
--   · 메일 복구는 admin_email_issues · admin_email_retry(6700)로 한다(공개는 그대로).

create or replace function public.admin_noon_status(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d date := coalesce(p_day, public.kst_today()); result jsonb;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영진 권한이 필요해요.'; end if;
  select jsonb_build_object(
    'day', d,
    'noonRuns', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'startedAt', j.started_at, 'finishedAt', j.finished_at, 'ok', j.ok, 'detail', j.detail) order by j.started_at)
                            from public.job_runs j where j.job = 'noon' and (j.started_at at time zone 'Asia/Seoul')::date = d), '[]'::jsonb),
    'introductions', coalesce((select jsonb_agg(x order by x ->> 'revealAt') from (
      select jsonb_build_object(
        'id', i.id, 'status', i.status, 'endReason', i.end_reason, 'revealAt', i.reveal_at, 'publishedAt', i.published_at, 'respondBy', i.respond_by,
        'closedAt', i.closed_at,
        'a', jsonb_build_object('member', public.admin_member_brief(i.member_a), 'openedAt', i.opened_a_at, 'response', i.response_a, 'respondedAt', i.response_a_at,
               'notification', (select jsonb_build_object('id', n.id, 'emailedAt', n.emailed_at, 'emailStatus', n.email_status, 'attempts', n.email_attempts,
                                                         'sendStartedAt', n.email_send_started_at, 'readAt', n.read_at)
                                  from public.notifications n where n.dedupe_key = 'intro:' || i.id || ':' || i.member_a)),
        'b', jsonb_build_object('member', public.admin_member_brief(i.member_b), 'openedAt', i.opened_b_at, 'response', i.response_b, 'respondedAt', i.response_b_at,
               'notification', (select jsonb_build_object('id', n.id, 'emailedAt', n.emailed_at, 'emailStatus', n.email_status, 'attempts', n.email_attempts,
                                                         'sendStartedAt', n.email_send_started_at, 'readAt', n.read_at)
                                  from public.notifications n where n.dedupe_key = 'intro:' || i.id || ':' || i.member_b)),
        'verdict', case
          when i.published_at is null and i.status = 'reserved' then 'not-published'
          when i.published_at is null and i.end_reason = 'missed-window' then 'missed'
          when i.published_at is null then 'cancelled'
          when exists (select 1 from public.notifications n where n.dedupe_key in ('intro:' || i.id || ':' || i.member_a, 'intro:' || i.id || ':' || i.member_b)
                        and n.emailed_at is null and (n.email_status = 'unknown' or n.email_attempts >= 3)) then 'mail-issue'
          when i.status in ('published', 'mutual') then 'published'
          else 'closed' end) x
      from public.introductions i where (i.reveal_at at time zone 'Asia/Seoul')::date = d) s), '[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function public.admin_run_noon() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영진 권한이 필요해요.'; end if;
  r := public.run_noon();
  perform public.write_audit('정오 작업 다시 실행', public.kst_today()::text, left(r::text, 200));
  return r;
end $$;

revoke all on function public.admin_noon_status(date), public.admin_run_noon() from public, anon, authenticated;
grant execute on function public.admin_noon_status(date), public.admin_run_noon() to authenticated;
