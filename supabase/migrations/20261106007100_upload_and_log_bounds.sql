-- 7100: GPT 3차 검수 R3-18 — 화면을 거치지 않은 업로드·오류 기록도 서버가 막는다
--
-- 사진(서버 쪽 경계):
--   · 신청 사진 저장소(application-photos)는 JPG만 받는다(화면은 늘 JPG로 다시 그려 올린다 · PNG·WebP 직접 업로드는 저장소가 거절).
--     크기 10MB(신청 사진)·5MB(편지 사진), 본인 폴더만 올리기(저장소 정책)는 그대로.
--   · register_photo: 형식은 JPG만, 크기 1바이트~10MB, 가로·세로 1~8192px만 받는다. 저장소에 파일 기록이 있으면
--     (운영 Supabase의 storage.objects.metadata) 실제 크기·형식이 같은지도 본다.
--   · 실제 바이트(EXIF 위치 정보 · 진짜 JPG인지)는 상대에게 주소를 줄 때 함수(partner-photo · letter-photo)가 확인한다(_shared/photo-check.ts).
-- 화면 오류 기록(client_errors):
--   · 들어오는 모든 글에서 메일 주소 · 토큰(JWT · Bearer · key/token=) · 서명 주소 · 주소의 물음표 뒤 · 휴대폰 번호 · 긴 숫자 ·
--     따옴표 안 긴 글(회원이 쓴 문장일 수 있음) · 회원 번호(uuid)를 서버가 지운다(트리거 · 화면의 정리와 별개로).
--   · path 는 경로 틀만 남긴다(물음표·# 뒤 삭제, uuid → :id, 4자리 넘는 숫자 → :n).

do $$
begin
  update storage.buckets set allowed_mime_types = array['image/jpeg'], file_size_limit = 10485760 where id = 'application-photos';
  update storage.buckets set allowed_mime_types = array['image/jpeg'], file_size_limit = 5242880 where id = 'letter-photos';
end $$;

-- 오류 기록 글 지우기(순수 함수)
create or replace function public.redact_log_text(p_text text) returns text
language sql immutable set search_path = '' as $$
  select case when p_text is null then null else
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      p_text,
      'https?://[^\s"''<>]*/storage/v1/object/(sign|authenticated|public)/[^\s"''<>]*', '[저장소 주소]', 'gi'),
      '(https?://[^\s?#"''<>]+)[?#][^\s"''<>]*', '\1?[가림]', 'gi'),
      'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}', '[토큰]', 'g'),
      '(bearer)\s+[A-Za-z0-9._~+/=-]{8,}', '\1 [토큰]', 'gi'),
      '((access_token|refresh_token|id_token|token|apikey|api_key|key|signature|sig|code|password|secret)["'']?\s*[=:]\s*["'']?)[^\s&"'',;}]+', '\1[가림]', 'gi'),
      '(sb_(publishable|secret)_|sk_|re_|ghp_)[A-Za-z0-9_-]{8,}', '[키]', 'gi'),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[메일]', 'g'),
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', '[id]', 'g'),
      '(\+?82[-\s.]?|0)1[016789][-\s.]?[0-9]{3,4}[-\s.]?[0-9]{4}', '[번호]', 'g'),
      '(?:[0-9][\s-]?){9,}[0-9]', '[숫자]', 'g'),
      '("[^"]{24,}"|''[^'']{24,}''|“[^”]{12,}”|‘[^’]{12,}’|「[^」]{12,}」)', '"[글]"', 'g')
  end
$$;

-- 경로 틀만(물음표·# 뒤 삭제 · uuid → :id · 4자리 넘는 숫자 → :n)
create or replace function public.route_template(p_path text) returns text
language sql immutable set search_path = '' as $$
  select case when p_path is null then null else
    regexp_replace(regexp_replace(split_part(split_part(p_path, '?', 1), '#', 1),
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', ':id', 'g'),
      '[0-9]{4,}', ':n', 'g') end
$$;

create or replace function public.redact_client_error() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.context := left(public.redact_log_text(new.context), 120);
  new.message := left(public.redact_log_text(new.message), 1000);
  new.stack := left(public.redact_log_text(new.stack), 4000);
  new.path := left(public.route_template(new.path), 200);
  new.release := left(regexp_replace(coalesce(new.release, ''), '[^A-Za-z0-9._+-]', '', 'g'), 60);
  new.user_agent := left(public.redact_log_text(new.user_agent), 300);
  return new;
end $$;
drop trigger if exists client_errors_redact on public.client_errors;
create trigger client_errors_redact before insert or update on public.client_errors for each row execute function public.redact_client_error();
revoke all on function public.redact_client_error() from public, anon, authenticated;

-- 이미 쌓인 오류 기록도 같은 기준으로 지운다(30일 보존 안의 것)
update public.client_errors set message = message;

-- 사진 등록: 형식·크기·가로세로를 서버가 확인(나머지는 기존 정의 그대로)
do $$
declare def text := pg_get_functiondef('public.register_photo(text, text, text, integer, integer, integer, text, boolean, boolean)'::regprocedure);
  anchor text := 'if split_part(p_path, ''/'', 1) <> auth.uid()::text then raise exception ''본인 폴더의 사진만 등록할 수 있어요.''; end if;';
begin
  if position(anchor in def) = 0 then raise exception 'register_photo를 바꾸지 못했어요'; end if;
  execute replace(def, anchor, anchor || '
  if p_mime is distinct from ''image/jpeg'' then raise exception ''사진은 JPG로만 올릴 수 있어요. 화면에서 다시 올려 주세요.''; end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > 10485760 then raise exception ''사진 파일 크기를 확인해 주세요(10MB까지).''; end if;
  if p_width is null or p_height is null or p_width < 1 or p_height < 1 or p_width > 8192 or p_height > 8192 then raise exception ''사진 크기를 확인해 주세요.''; end if;
  if exists (select 1 from storage.objects o where o.bucket_id = ''application-photos'' and o.name = p_path
              and ((to_jsonb(o) -> ''metadata'' ->> ''size'') is not null and (to_jsonb(o) -> ''metadata'' ->> ''size'')::bigint <> p_bytes
                or (to_jsonb(o) -> ''metadata'' ->> ''mimetype'') is not null and (to_jsonb(o) -> ''metadata'' ->> ''mimetype'') <> ''image/jpeg'')) then
    raise exception ''올린 파일과 사진 정보가 달라요. 화면에서 다시 올려 주세요.'';
  end if;');
end $$;

-- 상대에게 주소를 주기 전 바이트 확인에서 걸린 사진을 운영진에게 알린다(함수가 service_role 로 부른다 · 경로는 운영진 기록에만)
create or replace function public.flag_photo_content(p_bucket text, p_path text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_bucket not in ('application-photos', 'letter-photos') then raise exception '버킷을 확인해 주세요.'; end if;
  insert into public.job_runs (job, finished_at, ok, detail)
  values ('photo-check', now(), false, jsonb_build_object('bucket', p_bucket, 'path', left(p_path, 200), 'error', '상대에게 보이기 전 확인에서 걸린 사진: ' || left(coalesce(p_reason, ''), 100)));
end $$;
revoke all on function public.redact_log_text(text), public.route_template(text), public.flag_photo_content(text, text, text) from public, anon, authenticated;
grant execute on function public.flag_photo_content(text, text, text) to service_role;
