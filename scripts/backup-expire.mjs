// 백업 만료 정리(백업 실행과 독립 · GPT 3차 검수 R3-03): `npm run backup:expire`
//  - 작업 스케줄러로 매일(그리고 컴퓨터를 켤 때 놓친 차례를 바로) 돌린다. 등록 방법은 대표용 안내 문서에 있다.
//  - 같은 규칙(만든 지 30일)을 로컬 백업 · ‘삭제 이력’ · 바깥 사본(offsite) 모두에 적용한다.
//  - 끝나지 않은 암호문 임시 파일(.part)은 1시간 지나면 지우고, 예전 버전이 남긴 평문이 있으면 바로 암호화한다.
//  - 결과는 `백업 기록.log`에 남기고, 서버 작업 기록(backup-expire)에도 숫자만 남긴다(공개 상태에서 ‘마지막 정리’ 나이가 보임).
//  - 실패(폴더를 지우지 못함 · 바깥 사본 폴더가 연결되지 않음 등)하면 종료 코드 1 + 바탕 화면 `플라비 백업 확인 필요.txt` + 서버 기록(실패).
//  - 한계: 컴퓨터가 꺼져 있는 동안에는 지울 수 없다(켜진 뒤 바로 지운다). 클라우드 휴지통·버전 기록은 그 서비스의 보관 규칙을 따른다(안내 문서).
import { loadKey } from "./backup-crypto.mjs"
import { expireRoot, log, reportRun, settings, warn } from "./backup-lib.mjs"

const cfg = settings()
let key = null, keyId = null
try { ({ key, keyId } = loadKey()) } catch { /* 키가 없어도 만료 삭제는 한다(평문 암호화만 못 함) */ }
const results = [expireRoot(cfg.root, { now: cfg.now, key, keyId, label: "로컬", mustExist: false })]
if (cfg.offsite) results.push(expireRoot(cfg.offsite, { now: cfg.now, key, keyId, label: "바깥 사본" }))
const errors = results.flatMap((r) => r.errors.map((e) => `${r.label}: ${e}`))
if (!cfg.offsite) errors.push("바깥 사본 폴더(offsite)가 설정되지 않았어요(재해 복구용 사본이 없어요).")
const removed = results.reduce((n, r) => n + r.removed.length, 0)
for (const r of results) for (const name of r.removed) console.log(`만료 삭제 · ${r.label} · ${name}`)
const summary = { removed, kept: results.reduce((n, r) => n + r.kept, 0), parts: results.reduce((n, r) => n + r.parts, 0), sealed: results.reduce((n, r) => n + r.sealed, 0), offsite: !!cfg.offsite, errors: errors.length }
log(cfg, { job: "backup-expire", ok: errors.length === 0, ...summary, at: cfg.now().toISOString(), details: errors.slice(0, 10) })
reportRun(cfg, "backup-expire", errors.length === 0, summary)
if (errors.length) {
  warn(cfg, "백업 만료 정리를 끝내지 못했어요(30일 지난 백업이 남아 있을 수 있어요)", [...errors.slice(0, 10), "바깥 디스크·클라우드 폴더가 연결됐는지 확인하고 `npm run backup:expire`를 다시 실행해 주세요."])
  process.exit(1)
}
console.log(`백업 만료 정리 끝 · 지움 ${removed} · 남김 ${summary.kept}`)
