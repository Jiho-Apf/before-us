-- 베타 운영(결제 없이): 베타 기수(번호 0, 화면에는 ‘베타’) · 문의 유형 ‘베타 의견’
--  - 베타 기수: 신청 마감 2026-11-12, 첫 소개 2026-11-16 정오. 날짜·인원은 운영진 ‘기수’ 메뉴에서 바꿀 수 있다.
--  - 마감 뒤 신청은 다음 기수(1기)로 이어진다.
alter table public.cohorts drop constraint if exists cohorts_number_check;
alter table public.cohorts add constraint cohorts_number_check check (number >= 0);
insert into public.cohorts (number, starts_on, application_deadline, min_per_gender, max_per_gender, note)
values (0, '2026-11-16', '2026-11-12', 5, 50, '베타 · 결제 없이')
on conflict (number) do nothing;

-- 지금까지 제출한 신청서(시험 계정 포함)는 베타 기수로 옮긴다.
update public.applications set cohort_number = 0
 where cohort_number = 1 and status in ('submitted', 'reviewing', 'needs_changes', 'approved', 'held');

create or replace function public.run_cohort_eve() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select a.member_id, c.number from public.applications a join public.cohorts c on c.number = a.cohort_number
            join public.profiles p on p.id = a.member_id and p.status = 'active'
           where a.status = 'approved' and c.starts_on = public.kst_today() + 1 loop
    perform public.notify(r.member_id, 'cohort-eve', case when r.number = 0 then '베타' else r.number || '기' end || ' 첫 소개가 내일 정오에 도착해요', '잘 맞는 분을 준비해 두었어요. 내일 정오에 오늘 화면에서 확인해 주세요.', '/today', 'cohort-eve:' || r.number || ':' || r.member_id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.submit_inquiry(p_type text, p_name text, p_email text, p_body text, p_consent boolean, p_website text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(p_email)); v_body text := trim(p_body); nm text := trim(coalesce(p_name, '')); new_id text;
begin
  if coalesce(p_website, '') <> '' then return jsonb_build_object('error', '요청을 처리할 수 없어요.'); end if;
  if p_type not in ('서비스 이용 방법', '신청·검토', '소개·교류', '결제·환불', '개인정보·탈퇴', '안전·신고', '제휴·기타', '베타 의견') then return jsonb_build_object('error', '문의 유형을 골라 주세요.'); end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then return jsonb_build_object('error', '답변받을 이메일 주소를 확인해 주세요.'); end if;
  if char_length(nm) > 20 then return jsonb_build_object('error', '부르실 이름은 20자 이하로 적어 주세요.'); end if;
  if char_length(v_body) < 10 or char_length(v_body) > 1000 then return jsonb_build_object('error', '문의 내용은 10~1000자로 적어 주세요.'); end if;
  if v_body ~ '\d{6}\s?-\s?[1-4]\d{6}' or v_body ~ '\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}' then
    return jsonb_build_object('error', '주민등록번호나 카드번호는 적지 말아 주세요. 필요한 경우 운영진이 안전한 방법으로 따로 확인해요.');
  end if;
  if not coalesce(p_consent, false) then return jsonb_build_object('error', '문의 응대를 위한 개인정보 수집·이용에 동의해 주세요.'); end if;
  if exists (select 1 from public.inquiries i where i.email = v_email and i.body = v_body and i.created_at > now() - interval '10 minutes') then
    return jsonb_build_object('error', '같은 문의가 방금 접수됐어요. 잠시 후 접수 번호로 진행 상태를 확인해 주세요.');
  end if;
  if (select count(*) from public.inquiries i where i.email = v_email and i.created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.inquiries i where i.created_at > now() - interval '10 minutes') >= 60 then
    return jsonb_build_object('error', '짧은 시간에 문의가 많이 접수됐어요. 잠시 후 다시 남겨 주세요.');
  end if;
  -- 접수 번호: 날짜 + 임의 8자리(순번이면 이메일만 알아도 남의 문의를 찾아볼 수 있어서).
  new_id := 'Q-' || to_char(now() at time zone 'Asia/Seoul', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.inquiries (id, user_id, type, name, email, body, consent_at, policy_version)
  values (new_id, auth.uid(), p_type, nm, v_email, v_body, now(), 'V6-inquiry-01');
  return jsonb_build_object('id', new_id);
end $$;
