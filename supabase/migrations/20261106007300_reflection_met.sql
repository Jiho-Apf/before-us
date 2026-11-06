-- 7300: GPT 3차 검수 R3-23 — ‘약속일이 지나 마무리됨’과 ‘실제로 만났다(본인 응답)’를 나눈다
--
-- 서버의 교류 마무리(end_reason 'completed')는 연락처 공개 기간이 끝났다는 뜻이지 실제 만남의 증명이 아니다.
--   · reflections.met: 회원이 스스로 고르는 선택 응답 'met'(만났어요) · 'not_met'(아직 만나지 못했어요) · 'skip'(답하지 않을게요) · null(안 고름).
--     자기보고일 뿐 만남 증명으로 쓰지 않고, 회원 상태·권리·소개 횟수에 아무 영향이 없다(이 함수는 reflections 한 줄만 바꾼다).
--   · save_reflection(p_program, p_body, p_met): 한 줄 없이 응답만 남길 수 있다. 한 줄을 줄 때만 5~200자 확인.
--     p_body 가 null·빈칸이면 한 줄은 그대로 두고, p_met 이 null 이면 응답은 그대로 둔다(둘 다 없으면 ‘5~200자’ 안내).
--   · 회원 화면은 reflections 표를 바로 읽는다(본인 줄만 · 정책 그대로) → met 칸이 함께 온다.
--   · 운영진 신청서 보기(admin_get_application)의 한 줄 목록: completed(약속일 지나 마무리 · 예전 met 값) + met(본인 응답)로 나눈다.
--   · 다음 소개에 반영하는 것은 한 줄(body)이 있는 줄만이다.

alter table public.reflections add column if not exists met text check (met in ('met', 'not_met', 'skip'));
alter table public.reflections alter column body drop not null;
alter table public.reflections drop constraint if exists reflections_body_check;
alter table public.reflections add constraint reflections_body_check check (body is null or char_length(body) between 5 and 200);
alter table public.reflections drop constraint if exists reflections_body_or_met;
alter table public.reflections add constraint reflections_body_or_met check (body is not null or met is not null);

drop function if exists public.save_reflection(uuid, text);
create or replace function public.save_reflection(p_program uuid, p_body text default null, p_met text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.programs; me uuid := auth.uid(); clean text := nullif(trim(coalesce(p_body, '')), ''); r public.reflections;
begin
  if me is null or not public.is_active_member() then raise exception '로그인한 회원만 남길 수 있어요.'; end if;
  select * into p from public.programs where id = p_program;
  if p.id is null or public.not_participant(me, p.member_a, p.member_b) then raise exception '교류를 찾을 수 없어요.'; end if;
  if p.status <> 'closed' or p.started_at is null then raise exception '교류를 마친 뒤에 남길 수 있어요.'; end if;
  if p.closed_at < now() - interval '30 days' then raise exception '교류를 마친 지 30일이 지나 남길 수 없어요.'; end if;
  if p_met is not null and p_met not in ('met', 'not_met', 'skip') then raise exception '만남 여부를 다시 골라 주세요.'; end if;
  select * into r from public.reflections where member_id = me and program_id = p_program for update;
  if clean is null and p_met is null then raise exception '5~200자로 적어 주세요.'; end if;
  if clean is not null then
    if char_length(clean) < 5 or char_length(clean) > 200 then raise exception '5~200자로 적어 주세요.'; end if;
    if public.has_contact(normalize(clean, NFKC)) then raise exception '연락처·SNS 아이디·링크는 적을 수 없어요.'; end if;
    if r.used_at is not null and clean is distinct from r.body then raise exception '이미 다음 소개에 반영한 한 줄이라 고칠 수 없어요.'; end if;
  end if;
  insert into public.reflections (member_id, program_id, body, met) values (me, p_program, clean, p_met)
  on conflict (member_id, program_id) do update
    set body = coalesce(excluded.body, public.reflections.body), met = coalesce(excluded.met, public.reflections.met), updated_at = now()
  returning * into r;
  return jsonb_build_object('programId', r.program_id, 'body', r.body, 'met', r.met, 'usedAt', r.used_at, 'updatedAt', r.updated_at);
end $$;
revoke all on function public.save_reflection(uuid, text, text) from public, anon;
grant execute on function public.save_reflection(uuid, text, text) to authenticated;

-- 운영진 신청서 보기: 한 줄 목록의 met(예전 = 교류 마무리 여부)을 completed 로 옮기고, met 은 본인 응답으로
do $$
declare def text := pg_get_functiondef('public.admin_get_application(uuid)'::regprocedure);
  old1 text := 'jsonb_build_object(''body'', x.body, ''createdAt'', x.created_at, ''usedAt'', x.used_at, ''met'', x.met)';
  old2 text := 'select r.body, r.created_at, r.used_at, pr.end_reason = ''completed'' met';
begin
  if position(old1 in def) = 0 or position(old2 in def) = 0 then raise exception 'admin_get_application을 바꾸지 못했어요'; end if;
  def := replace(def, old1, 'jsonb_build_object(''body'', x.body, ''createdAt'', x.created_at, ''usedAt'', x.used_at, ''completed'', x.completed, ''met'', x.met)');
  execute replace(def, old2, 'select r.body, r.created_at, r.used_at, pr.end_reason = ''completed'' completed, r.met');
end $$;

-- 다음 소개에 반영: 한 줄(body)이 있는 줄만 ‘반영함’으로 표시한다
do $$
declare def text := pg_get_functiondef('public.admin_reserve_introduction(uuid, uuid, date, text, jsonb, uuid[], uuid[], jsonb)'::regprocedure);
  old text := 'update public.reflections set used_at = now(), used_intro = new_id where member_id = m and used_at is null;';
begin
  if position(old in def) = 0 then raise exception 'admin_reserve_introduction(반영)을 바꾸지 못했어요'; end if;
  execute replace(def, old, 'update public.reflections set used_at = now(), used_intro = new_id where member_id = m and used_at is null and body is not null;');
end $$;
