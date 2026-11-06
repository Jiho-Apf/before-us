# 화면·성능 점검 도구 (재현용)

3차 검수 R3-12 대응이에요. 예전에는 scratchpad의 특정 Windows 경로에 묶여 있었어요. 지금은 이 폴더에서, 인자와 환경 변수로 경로를 받아요.

**넣지 않은 것:** 운영 DB, 실제 회원 자료, `.env`, 열쇠

**판정 범위:** 아래 결과는 모두 ‘로컬 실험실 / mock / PGlite’ 근거예요.
- 실제 아이폰
- 실제 방문자 성능(필드)
- 운영 서버

이 세 가지는 따로 확인해야 해요.

## 준비
- **Node 24**(이 정리 때 24.18.0), 저장소의 `pnpm-lock.yaml`
- **의존성:** `npx --yes pnpm@10 install --frozen-lockfile`(또는 npm)
- **puppeteer-core:** 의존성에 넣지 않았어요. `npm i --no-save puppeteer-core@23.11.1`, 또는 설치된 폴더를 `PUPPETEER_CORE=폴더`로 알려 줘요.
- **Chrome:** 흔한 위치에서 자동으로 찾아요. 못 찾으면 `--chrome=경로` 또는 `CHROME_PATH`를 지정해요.
- **live 모드 개발 서버(공개·회원 화면):** `.claude/launch.json`의 `before-us-live`(8444)를 써요. 직접 켤 때는 `VITE_BACKEND=supabase npx vite --config vite.figma.config.ts --mode live --port 8444`예요.

## 명령

| 무엇 | 명령 | 결과 |
|---|---|---|
| 누름 영역 검사 단위 시험(R3-09) | `node scripts/checks/target-size.test.mjs` | 반례 100×20·20×100·43×43(잡힘)과 44×44(통과), 이름표로 눌리는 체크 상자, 인라인 링크 예외, 머리·대화 상자, 대조군(예전 AND 조건) — 10개 |
| 표준 CLS 단위 시험(R3-11) | `node scripts/checks/cls.test.mjs` | 검수 반례(.08 + .07, 6초 뒤 .08 → 합 .23, 표준 .15) 포함 4개 |
| 공개 화면 점검 | `node scripts/checks/public-scan.mjs --base=http://localhost:8444 --out=public.json` | 12화면 × 7가지 폭. 낱말 중간 끊김, 한두 글자 남김, 숫자·단위, 묶음 줄 넘김, 가로 넘침, 누름 영역 |
| 아이폰 Safari 26 이전 흉내 | 위 명령 + `--mode=safari` | text-wrap: pretty만 끄고 다시 재요 |
| 확대 에뮬레이션(R3-10) | 위 명령 + `--mode=zoom` | ① 640px 폭 재배치(1280 화면의 200% 확대와 같은 CSS 폭) ② 글자 200%(390·1280) |
| 회원·운영진(실제 서버 함수) 캡처 | `node scripts/checks/real-ui.mjs --out=캡처폴더 ["2 회원 화면/16"]` | 가짜 회원으로 신청 → 소개 → A/B 사흘 → 약속 → 만남 뒤 → 운영진 업무까지 실제 마이그레이션 위에서 진행하며 캡처 |
| 회원·운영진 점검 | `node scripts/checks/real-ui.mjs --scan=member.json [--safari]` | 같은 경로를 320·390·768·1366에서 layout-scan과 target-size로 점검 |
| 실험실 성능(R3-11) | `VITE_BACKEND=supabase npx vite build --config vite.figma.config.ts --mode live --outDir dist-live` 다음 `node scripts/checks/perf-lab.mjs --dist=dist-live --out=perf.json --runs=7` | 압축(br/gzip) 서버에서 실제 전송 바이트, 표준 CLS(세션 창 최댓값)와 합, LCP·FCP. 7번 반복한 가운데 값·25/75백분위·최소·최대 |

## 주의
- **확대 에뮬레이션:** 실제 브라우저 확대·시스템 큰 글씨·키보드가 열린 상태를 대신하지 못해요. 결과에도 ‘에뮬레이션’으로 적어요.
- **성능 측정의 한계**
  - 글꼴(jsDelivr)은 시간 정보 머리글이 없어 전송 크기가 0으로 나와요. 결과의 `fontsWithoutSize`로 따로 표시해요.
  - 실험실 값은 실제 방문의 75백분위(LCP 2.5초 목표 등)와 바로 비교하지 않아요.
- **서버 시험(별도)**
  - PGlite: `node supabase/tests/db.test.mjs`
  - 실제 PostgreSQL: `supabase/tests/realpg/`(설명은 `env.mjs`)
  - mock 화면 시험(fx-*)은 3차 묶음의 `시험 증거\화면\`에 사용법과 함께 있어요.
