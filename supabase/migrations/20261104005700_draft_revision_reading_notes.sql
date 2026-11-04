-- 5700: GPT 1차 검수 대응 ④ — 신청서 판 번호(C9) · 운영진이 신청서에서 실제로 읽은 한 문장(F1)
--
-- C9  신청서 저장은 전체를 덮어써서, 빠르게 넘기거나 두 화면을 열면 늦게 도착한 예전 저장이 새 답을 덮을 수 있었다.
--     applications.draft_rev(본문이 바뀔 때마다 오름)를 두고, 저장할 때 화면이 알고 있는 판을 함께 보내면 다를 때 거부한다(오류 코드 P0409).
--     판을 보내지 않는 저장(예전 화면)은 그대로 받는다.
-- F1  승인 뒤 기다리는 회원에게 ‘사람이 읽고 있다’는 것을 보여 주는 한 문장. 운영진이 신청서에서 실제로 확인한 부분만 20~80자로 직접 쓴다
--     (자동 문장 금지 · 운영진이 읽지 않는 소개 전 편지는 근거로 쓰지 않는다). 회원 본인과 운영진만 보고, 계정을 지우면 함께 지워진다.

-- ── C9
alter table public.applications add column if not exists draft_rev integer not null default 0;
create or replace function public.bump_draft_rev() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.draft is distinct from old.draft then new.draft_rev := old.draft_rev + 1; end if;
  return new;
end $$;
revoke all on function public.bump_draft_rev() from public, anon, authenticated;
drop trigger if exists applications_draft_rev on public.applications;
create trigger applications_draft_rev before update of draft on public.applications for each row execute function public.bump_draft_rev();

drop function if exists public.save_application_draft(jsonb);
create or replace function public.save_application_draft(p_draft jsonb, p_revision integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare clean jsonb; st text; cur int; saved int;
begin
  if jsonb_typeof(p_draft) <> 'object' then raise exception '신청서 형식을 확인해 주세요.'; end if;
  st := public.prepare_application_edit();
  select draft_rev into cur from public.applications where member_id = auth.uid() for update;
  if p_revision is not null and cur is distinct from p_revision then
    raise exception '다른 화면에서 먼저 저장된 내용이 있어요. 새로 불러온 뒤 이어서 써 주세요.' using errcode = 'P0409';
  end if;
  -- 사진 파일 정보와 검토 상태는 서버 표가 기준이므로 본문에서 뺀다.
  clean := p_draft - 'photos' - 'review' - 'completedDemo';
  update public.applications set draft = clean, updated_at = now() where member_id = auth.uid() returning draft_rev into saved;
  return jsonb_build_object('savedAt', now(), 'status', st, 'revision', coalesce(saved, cur));
end $$;
revoke all on function public.save_application_draft(jsonb, integer) from public, anon;
grant execute on function public.save_application_draft(jsonb, integer) to authenticated;

-- ── F1
create table if not exists public.reading_notes (
  member uuid primary key references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 20 and 80),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.reading_notes enable row level security;
revoke all on public.reading_notes from public, anon, authenticated;

create or replace function public.admin_set_reading_note(p_member uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare clean text := trim(coalesce(p_body, '')); r public.reading_notes;
begin
  if not public.is_admin(array['owner', 'operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if not exists (select 1 from public.profiles where id = p_member) then raise exception '회원을 찾을 수 없어요.'; end if;
  if clean = '' then
    delete from public.reading_notes where member = p_member;
    if found then perform public.write_audit('읽은 한 문장 지움', p_member::text, null); end if;
    return null;
  end if;
  if char_length(clean) < 20 or char_length(clean) > 80 then raise exception '20~80자로 적어 주세요.'; end if;
  if public.has_contact(normalize(clean, NFKC)) then raise exception '연락처·SNS 아이디·링크는 적을 수 없어요.'; end if;
  insert into public.reading_notes (member, body, created_by) values (p_member, clean, auth.uid())
  on conflict (member) do update set body = excluded.body, created_by = excluded.created_by, updated_at = now()
  returning * into r;
  perform public.write_audit('읽은 한 문장 남김', p_member::text, null);
  return jsonb_build_object('body', r.body, 'at', r.updated_at);
end $$;

create or replace function public.admin_reading_note(p_member uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner', 'operator', 'counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return (select jsonb_build_object('body', r.body, 'at', r.updated_at) from public.reading_notes r where r.member = p_member);
end $$;

create or replace function public.my_reading_note() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('body', r.body, 'at', r.updated_at) from public.reading_notes r where r.member = auth.uid()
$$;

revoke all on function public.admin_set_reading_note(uuid, text), public.admin_reading_note(uuid), public.my_reading_note() from public, anon;
grant execute on function public.admin_set_reading_note(uuid, text), public.admin_reading_note(uuid), public.my_reading_note() to authenticated;
