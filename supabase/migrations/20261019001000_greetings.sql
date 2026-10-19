-- 첫 마디(V6-greeting-01)
--  - 회원이 기다리는 동안 적어 두는 짧은 인사(5~60자). 소개가 열리면 상대가 내 프로필에서 가장 먼저 본다.
--  - 홈에 보이는 것은 본인이 따로 켠 경우에만, 운영진이 확인한 뒤, 이름·사진 없이 문장만.
--  - 홈에는 확인된 첫 마디가 12개 이상일 때만 보여 준다(적을 때 같은 문장이 반복돼 보이지 않게).
--  - 연락처·SNS 아이디·링크·계좌번호는 저장하지 않는다(편지와 같은 기준).

create table public.greetings (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 5 and 60),
  show_on_home boolean not null default false,
  home_status text not null default 'none' check (home_status in ('none', 'pending', 'approved', 'rejected')),
  home_reason text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.greetings enable row level security;
create policy "greetings: 본인 조회" on public.greetings for select to authenticated using (member_id = auth.uid());
revoke insert, update, delete on public.greetings from anon, authenticated;
revoke all on public.greetings from anon;

-- 연락처·링크가 들어 있는지(화면의 message-safety.ts와 같은 기준)
create or replace function public.has_contact(p_text text) returns boolean
language sql immutable set search_path = '' as $$
  select p_text ~* '(\+?82[\s.-]?)?0?1[016789][\s.-]?\d{3,4}[\s.-]?\d{4}|(\d[\s.-]?){10,11}|공일공|영일영'
      or p_text ~* '[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z.]{2,}'
      or p_text ~* 'https?://|www\.|\y[a-z0-9-]+\.(com|net|org|kr|me|io|ly|link|app|page)\y'
      or p_text ~* '(카톡|카카오톡|텔레그램|오픈\s*채팅|오픈톡|라인)\s*(아이디|id|주소|링크|추가)|(인스타|instagram|insta)\s*(아이디|계정|id|팔로우|디엠|dm)|(아이디|id)\s*(는|은|:)\s*[a-z0-9_.]{3,}|(^|\s)@[a-z0-9_.]{3,}'
      or p_text ~ '\d{2,6}-\d{2,6}-\d{2,7}'
$$;

create or replace function public.save_greeting(p_body text, p_show_on_home boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_body text := regexp_replace(trim(coalesce(p_body, '')), '\s+', ' ', 'g'); prev public.greetings;
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '로그인한 회원만 저장할 수 있어요.'; end if;
  if char_length(v_body) < 5 or char_length(v_body) > 60 then raise exception '첫 마디는 5~60자로 적어 주세요.'; end if;
  if public.has_contact(v_body) then raise exception '연락처·SNS 아이디·링크는 첫 마디에 넣을 수 없어요.'; end if;
  select * into prev from public.greetings where member_id = auth.uid();
  insert into public.greetings (member_id, body, show_on_home, home_status, updated_at)
  values (auth.uid(), v_body, coalesce(p_show_on_home, false), case when coalesce(p_show_on_home, false) then 'pending' else 'none' end, now())
  on conflict (member_id) do update set
    body = excluded.body, show_on_home = excluded.show_on_home, updated_at = now(),
    -- 문장이 같고 이미 확인된 상태면 그대로, 바뀌면 다시 확인
    home_status = case when not excluded.show_on_home then 'none'
                       when prev.body = excluded.body and prev.home_status in ('approved', 'rejected') then prev.home_status
                       else 'pending' end,
    home_reason = case when prev.body = excluded.body then prev.home_reason end;
  return (select jsonb_build_object('body', body, 'showOnHome', show_on_home, 'homeStatus', home_status) from public.greetings where member_id = auth.uid());
end $$;

create or replace function public.delete_greeting() returns void
language sql security definer set search_path = '' as $$ delete from public.greetings where member_id = auth.uid() $$;

-- 홈: 확인된 첫 마디가 12개 이상일 때만, 문장만, 섞어서 최대 40개
create or replace function public.public_greetings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when count(*) >= 12 then (select jsonb_agg(body) from (select body from public.greetings g2 join public.profiles p2 on p2.id = g2.member_id and p2.status = 'active' where g2.show_on_home and g2.home_status = 'approved' order by random() limit 40) x) else '[]'::jsonb end
    from public.greetings g join public.profiles p on p.id = g.member_id and p.status = 'active'
   where g.show_on_home and g.home_status = 'approved'
$$;

create or replace function public.admin_list_greetings(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator','counselor']) then raise exception '운영진 권한이 필요해요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('memberId', g.member_id, 'body', g.body, 'homeStatus', g.home_status, 'reason', g.home_reason, 'updatedAt', g.updated_at,
      'name', a.draft -> 'values' ->> 'self.name', 'cohort', a.cohort_number) order by g.updated_at)
    from public.greetings g left join public.applications a on a.member_id = g.member_id
   where g.show_on_home and (p_status is null or g.home_status = p_status)), '[]'::jsonb);
end $$;

create or replace function public.admin_review_greeting(p_member uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(array['owner','operator']) then raise exception '운영 권한이 필요해요.'; end if;
  if p_status not in ('approved', 'rejected') then raise exception '확인 값을 골라 주세요.'; end if;
  if p_status = 'rejected' and coalesce(trim(p_reason), '') = '' then raise exception '홈에 싣지 않는 이유를 적어 주세요(회원에게 보여요).'; end if;
  update public.greetings set home_status = p_status, home_reason = case when p_status = 'rejected' then trim(p_reason) end, reviewed_by = auth.uid(), reviewed_at = now()
   where member_id = p_member and show_on_home;
  if not found then raise exception '홈 공개를 신청한 첫 마디가 없어요.'; end if;
  perform public.write_audit('첫 마디 홈 공개 · ' || p_status, p_member::text);
end $$;

-- 소개 사본에 첫 마디를 함께 담는다(상대가 가장 먼저 보는 한마디)
create or replace function public.public_profile(p_member uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d jsonb; v jsonb; s jsonb; items jsonb := '[]'::jsonb; photo_list jsonb; field text; val jsonb; profile_ver int; member_age int; first_word text;
begin
  select a.draft, a.profile_version into d, profile_ver from public.applications a where a.member_id = p_member;
  if d is null then return null; end if;
  v := coalesce(d -> 'values', '{}'::jsonb);
  s := coalesce(d -> 'sharing', '{}'::jsonb);
  foreach field in array public.public_field_ids() loop
    if field = 'self.age' then
      member_age := public.age_from(v ->> 'self.birthDate');
      if member_age is not null and member_age >= 19 and coalesce((s ->> 'self.age')::boolean, true) then
        items := items || jsonb_build_array(jsonb_build_object('id', field, 'value', member_age || '세'));
      end if;
      continue;
    end if;
    val := v -> field;
    if val is null or val = '""'::jsonb or val = 'false'::jsonb or val = '[]'::jsonb or val = '"답하지 않음"'::jsonb or val = '"미선택"'::jsonb then continue; end if;
    if coalesce((s ->> field)::boolean, false) then
      items := items || jsonb_build_array(jsonb_build_object('id', field, 'value', val));
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('slot', p.slot, 'path', p.path) order by p.slot = 'photo.daily', p.slot), '[]'::jsonb)
    into photo_list
    from public.application_photos p
    where p.member_id = p_member and (p.slot <> 'photo.daily' or coalesce((s ->> 'photo.daily')::boolean, false));
  select g.body into first_word from public.greetings g where g.member_id = p_member;
  return jsonb_build_object('version', profile_ver, 'items', items, 'photos', photo_list, 'greeting', first_word);
end $$;

revoke all on function public.has_contact(text), public.public_profile(uuid) from public, anon, authenticated;
revoke all on function public.public_greetings() from public;
grant execute on function public.public_greetings() to anon, authenticated;
revoke all on function public.save_greeting(text, boolean), public.delete_greeting(), public.admin_list_greetings(text), public.admin_review_greeting(uuid, text, text) from public, anon;
grant execute on function public.save_greeting(text, boolean), public.delete_greeting(), public.admin_list_greetings(text), public.admin_review_greeting(uuid, text, text) to authenticated;
