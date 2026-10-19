# 서버(Supabase) 구축 · 반영 방법 (2026-10-16)

프로젝트: `mmrqcefipllmcqztksqm` (서울 리전) · 주소 `https://mmrqcefipllmcqztksqm.supabase.co`

## 1. 무엇이 만들어졌나

| 단계 | 서버(데이터베이스·권한) | 화면 연결(실제 서버 모드) |
|---|---|---|
| 1. 로그인·관리자 권한 | `profiles`(가입 시 자동 생성, 동의 기록), `admin_roles`(대표·운영·상담·정산), **운영진 권한은 2단계 인증(aal2)에서만 인정**, `audit_log`(고칠 수 없음), `job_runs` | 회원가입(메일 확인)·로그인·비밀번호 재설정·탈퇴, 운영진 로그인 + 인증 앱(TOTP) 등록·확인 |
| 2. 신청서·사진 | `applications`(작성 중·보완 요청일 때만 고침), `application_photos`, 비공개 저장소 `application-photos`(회원 폴더) | 신청서 단계마다 저장, 실제 사진 올리기(브라우저에서 다시 저장해 위치정보 제거), 5분짜리 사진 주소 |
| 3. 관리자 검토 | 신청서 목록·열람(생년월일 원값 제외, 만 나이만, 하루 한 번 열람 기록)·사진 확인·결정 | 운영진 ‘신청자’ |
| 4. 정오 공개·알림 | `introductions`(공개 프로필 사본, 같은 두 사람 재소개 금지, 하루 한 번), `notifications`, `blocks`, 열람 기간 안에서만 상대 사진 열람 | 회원 ‘오늘’·‘두 사람’(응답·거절 이유·신고·차단), 운영진 ‘소개·매칭’ |
| 5. 교류·약속·연락처 | `programs`(합의·3일·만남 선택·약속·연락처 동의), `program_entries`(그날 두 사람 모두 보내야 열림), `appointment_proposals`, `run_programs`(10분마다), `run_program_retention` | 회원 ‘교류’·‘약속’(연락처 포함), 운영진 ‘교류·약속’ |
| 운영 편의·알림 | 일시정지·이용 정지, 사진 하루 30장, `client_errors`, 알림 받을 방법(`notify_kakao/sms/email`), `send-notifications` 함수(5분마다) | 운영진 ‘회원’·대시보드 화면 오류, 내 정보 ‘잠시 쉬기’·알림 방법 |
| 6. 문의·신고·탈퇴 | `inquiries`(비회원 가능, 접수 번호+이메일로 확인), `reports`(회원 신고 + 자동 감지), `member_requests`, 탈퇴 요청 | 문의하기, 회원 ‘문의·요청’, 운영진 ‘신고·문의’ |
| 7. 삭제 예약·감사 | 탈퇴 7일 뒤 삭제, 끝난 소개 사본 30일 뒤 삭제, 문의 3년·감사 365일·알림 90일, 사진 파일 정리 함수 | 운영진 ‘감사로그’·대시보드 작업 기록 |

- 예약 작업(pg_cron, UTC 기준): 정오 공개 12:00·12:05 KST, 응답 마감 10분마다, 보존 기간 정리 03:30 KST, 사진 파일 정리 04:00 KST.
- 서버 점검: `pnpm test:db` (내 컴퓨터 안의 Postgres로 151개 권한·흐름 점검). 마이그레이션을 고치면 반드시 다시 돌린다.
- 화면은 `VITE_BACKEND=supabase` 로 빌드할 때만 실제 서버를 쓴다. 지정하지 않으면 지금 배포처럼 데모로 동작한다.
  - 로컬: 미리보기 설정 `before-us-live`(포트 8444, `.env.live`).
  - Vercel: `beta` 브랜치를 올리면 실제 서버 모드 미리보기가 만들어지고, `main`(공개 사이트)은 데모 그대로다(`vercel.json`).

## 2. 실제 프로젝트에 반영하기 (한 번만)

> 2026-10-16 반영 완료: 1~3번(마이그레이션 6개, 로그인·메일·인증 앱 설정, `storage-cleanup` 함수). 비회원으로는 모든 표·운영진 함수가 막히는 것까지 확인. 남은 것은 4번(대표 지정).
> 실제 서버 모드 미리보기: `beta` 브랜치 → `https://before-us-3jr4-git-beta-ji-ho-jung-s-projects.vercel.app`

대표가 할 일은 **1번(로그인)과 4번(대표 지정)** 이에요. 나머지는 로그인 뒤 Claude가 실행할 수 있어요.

1. 터미널에서 Supabase 로그인(브라우저가 열리면 승인):
   ```bash
   npx supabase@2.121.0 login
   ```
2. 데이터베이스 반영(마이그레이션 6개):
   ```bash
   npx supabase@2.121.0 link --project-ref mmrqcefipllmcqztksqm
   npx supabase@2.121.0 db push
   ```
   - 데이터베이스 비밀번호를 물으면 프로젝트 만들 때 저장한 비밀번호를 직접 넣는다(채팅에 붙이지 않는다).
3. 로그인·메일·2단계 인증 설정과 사진 정리 함수:
   ```bash
   npx supabase@2.121.0 config push
   npx supabase@2.121.0 functions deploy storage-cleanup --no-verify-jwt
   ```
4. 대표 계정 지정: 실제 서버 모드 사이트에서 회원가입·메일 확인을 마친 뒤, Supabase 대시보드 → SQL Editor에서 한 줄 실행(이메일만 바꾼다):
   ```sql
   insert into public.admin_roles (user_id, role) select id, 'owner' from auth.users where email = '대표 이메일';
   ```
   그다음 `/admin`에 들어가 인증 앱(Google Authenticator 등)으로 QR을 찍어 연결한다. 이후 다른 운영진은 ‘운영진’ 메뉴에서 역할을 준다.

## 3. 정식 출시 전에 꼭 바꿀 것

- **메일 알림 켜기(대표가 직접, 키는 채팅에 붙이지 않기):**
  1. 도메인을 산다(예: 가비아·Cloudflare). Resend(resend.com)에 가입하고 Domains에서 그 도메인을 추가 → 안내된 DNS 기록(TXT·MX)을 도메인 관리 화면에 넣고 Verify.
  2. Resend → API Keys에서 키를 만든다(Sending access).
  3. Supabase 대시보드 → Edge Functions → Secrets(또는 Project Settings → Edge Functions)에 세 값을 넣는다: `RESEND_API_KEY`(위 키), `MAIL_FROM`(예: `비포어스 <hello@도메인>`), `SITE_URL`(회원이 쓰는 사이트 주소).
  4. 넣으면 5분 안에 ‘메일’을 고른 회원에게 알림 메일이 가기 시작한다. 같은 Resend를 아래 가입 확인 메일(SMTP)에도 쓸 수 있다(Resend → SMTP 안내의 호스트·포트·사용자 `resend`·비밀번호=API 키를 Supabase Authentication → SMTP에 입력).

- **메일 발송(베타 전 필수):** Supabase 기본 메일은 Supabase 팀에 등록된 이메일로만, 그것도 시간당 몇 통만 보낸다. 대표 본인 테스트는 되지만 베타 회원은 가입 확인·비밀번호 재설정 메일을 못 받는다. 베타 전에 대시보드 Authentication → SMTP에 발송 서비스(예: Resend)를 연결한다. 보내는 주소는 도메인을 산 뒤 그 도메인으로. 연결한 뒤 `config push`를 하면 비포어스 메일 디자인(`supabase/templates/`)이 함께 적용된다(무료 기본 메일에서는 Supabase가 거부함).
- **요금제:** 무료 요금제는 7일 동안 쓰지 않으면 일시정지되고 자동 백업·PITR이 없다. 베타 시작 때 Pro로 올리고 PITR을 켠다(`Reliability.md`).
- **사이트 주소:** 공개 사이트를 실제 서버 모드로 바꾸는 날, `config.toml`의 `site_url`·`additional_redirect_urls`를 실제 도메인으로 맞추고 `config push`.
- **본인인증·결제·알림톡:** 사업자등록 뒤 서버 8~10단계에서 연결한다. 지금 실제 서버 모드에서는 휴대폰 본인인증 칸을 보여 주지 않고, 만 19세 확인은 가입 동의 + 신청서 생년월일(서버에서 다시 계산)로 한다.

## 4. 보안 원칙(코드에 반영됨)

- 모든 표에 RLS. 회원은 자기 자료만 읽고, 쓰기는 서버 함수(RPC)로만 한다. 상대 프로필은 소개 사본으로만, 열람 기간 안에서만 준다.
- 운영진 함수는 역할 + 2단계 인증(aal2)을 서버에서 확인한다. 화면에서 메뉴를 숨기는 것은 보안이 아니다.
- 화면에 들어가는 키는 publishable 키뿐이다. secret·service_role 키는 코드·채팅에 두지 않는다(사진 정리 함수는 Supabase가 넣어 주는 환경 변수로만 쓴다).
- 감사 기록은 고치거나 지울 수 없고(보존 기간 정리만 예외), 문의 본문·이메일·편지 원문은 감사 기록에 넣지 않는다.
