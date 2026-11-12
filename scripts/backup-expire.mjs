// 백업 만료 정리(백업 실행과 독립 · GPT 3차 검수 R3-03 · 4차 R4-05): `npm run backup:expire`
//  - 작업 스케줄러로 매일(그리고 컴퓨터를 켤 때 놓친 차례를 바로) 돌린다. 등록 방법은 대표용 안내 문서에 있다.
//  - 같은 규칙을 로컬 백업 · ‘삭제 이력’ · 바깥 사본(offsite) 모두에 적용한다:
//      약속한 기한은 만든 지 30일. 지우기는 만든 지 29일부터 시작한다 → 매일 한 번 돌면 늦어도 29일 + 24시간 = 30일 안에 지워진다.
//  - 컴퓨터가 꺼져 있던 동안에는 지울 수 없다. 켜진 뒤 첫 실행에서 바로 지우고, 30일을 넘겨 지운 것이 있으면
//    숨기지 않고 기록(백업 기록.log · 서버 기록)과 바탕 화면 안내에 ‘몇 개를 몇 시간 늦게 지웠는지’ 남기고 종료 코드 1로 끝낸다.
//  - 끝나지 않은 암호문 임시 파일(.part)은 쓴 지 1시간이 지나면 ‘지울 수 있음’이고, 실제로는 그다음 실행 때 지운다. 두 시각을 기록에 따로 남긴다.
//  - 예전 버전이 남긴 평문이 있으면 바로 암호화한다.
//  - 삭제 이력(backup:deletions)이 26시간 넘게 갱신되지 않았으면 알린다(재해 복구에는 ‘최신’ 삭제 이력이 필요해서).
//  - 결과는 `백업 기록.log`에 남기고, 서버 작업 기록(backup-expire)에도 숫자만 남긴다(공개 상태에서 ‘마지막 정리’ 나이가 보임).
//  - 실패(폴더를 지우지 못함 · 바깥 사본 폴더가 연결되지 않음 · 늦게 지움 · 삭제 이력이 낡음)하면 종료 코드 1 + 바탕 화면 `플라비 백업 확인 필요.txt` + 서버 기록(실패).
//  - 한계: 클라우드 휴지통·버전 기록은 그 서비스의 보관 규칙을 따른다(안내 문서에서 대표가 고르는 조건).
import { loadKey } from "./backup-crypto.mjs"
import { DELETIONS_STALE_HOURS, backupState, deletionExports, expireRoot, log, reportRun, settings, warn } from "./backup-lib.mjs"
import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const cfg = settings()
let key = null, keyId = null
try { ({ key, keyId } = loadKey()) } catch { /* 키가 없어도 만료 삭제는 한다(평문 암호화만 못 함) */ }
const results = [expireRoot(cfg.root, { now: cfg.now, key, keyId, label: "로컬", mustExist: false })]
if (cfg.offsite) results.push(expireRoot(cfg.offsite, { now: cfg.now, key, keyId, label: "바깥 사본" }))
const errors = results.flatMap((r) => r.errors.map((e) => `${r.label}: ${e}`))
if (!cfg.offsite) errors.push("바깥 사본 폴더(offsite)가 설정되지 않았어요(재해 복구용 사본이 없어요).")
const removed = results.reduce((n, r) => n + r.removed.length, 0)
for (const r of results) for (const name of r.removed) console.log(`만료 삭제 · ${r.label} · ${name}`)
const late = results.flatMap((r) => r.late.map((l) => ({ where: r.label, ...l })))
const lateHoursMax = late.reduce((m, l) => Math.max(m, l.lateHours), 0)
const partFiles = results.flatMap((r) => r.partFiles.map((p) => ({ where: r.label, ...p })))
// 삭제 이력의 신선도: 지킬 백업이 남아 있는데 가장 최근 삭제 이력이 26시간보다 오래됐으면 알린다
const nowMs = cfg.now().getTime()
const hasBackup = (dir) => existsSync(dir) && readdirSync(dir).some((n) => { try { return statSync(join(dir, n)).isDirectory() && ["complete", "partial", "legacy"].includes(backupState(join(dir, n)).state) } catch { return false } })
let deletionsAgeHours = null
if (hasBackup(cfg.root) || (cfg.offsite && hasBackup(cfg.offsite))) {
  const latest = [...deletionExports(cfg.root), ...(cfg.offsite ? deletionExports(cfg.offsite) : [])].sort((a, b) => b.at - a.at)[0]
  deletionsAgeHours = latest ? Math.round(((nowMs - latest.at) / 3600000) * 10) / 10 : null
  if (!latest) errors.push("삭제 이력을 아직 한 번도 내보내지 않았어요(`npm run backup:deletions` · 재해 복구에 꼭 필요해요).")
  if (latest && deletionsAgeHours > DELETIONS_STALE_HOURS) errors.push(`삭제 이력이 ${deletionsAgeHours}시간 동안 갱신되지 않았어요(매일 \`npm run backup:deletions\`가 돌아야 해요).`)
}
const summary = { removed, kept: results.reduce((n, r) => n + r.kept, 0), parts: results.reduce((n, r) => n + r.parts, 0), sealed: results.reduce((n, r) => n + r.sealed, 0), offsite: !!cfg.offsite, errors: errors.length, late: late.length, lateHoursMax }
if (deletionsAgeHours !== null) summary.deletionsAgeHours = deletionsAgeHours
const good = errors.length === 0 && late.length === 0
log(cfg, { job: "backup-expire", ok: good, ...summary, at: cfg.now().toISOString(), details: errors.slice(0, 10), lateItems: late.slice(0, 20), partFiles: partFiles.slice(0, 50) })
reportRun(cfg, "backup-expire", good, summary)
if (late.length) warn(cfg, "약속한 30일을 넘겨 지운 백업이 있어요(지금은 모두 지웠어요)", [...late.slice(0, 10).map((l) => `${l.where} · ${l.name} · ${l.lateHours}시간 늦게 지움`), "컴퓨터가 꺼져 있었거나 만료 정리가 며칠 돌지 않았어요. 작업 스케줄러의 ‘플라비 백업 만료 정리’가 매일 도는지 확인해 주세요.", "이 기록은 지우지 말고 개발 쪽에 알려 주세요(처리방침의 ‘최대 30일’과 관련돼요)."])
if (errors.length) warn(cfg, "백업 만료 정리를 끝내지 못했어요(30일 지난 백업이 남아 있을 수 있어요)", [...errors.slice(0, 10), "바깥 디스크·클라우드 폴더가 연결됐는지 확인하고 `npm run backup:expire`를 다시 실행해 주세요."])
if (!good) process.exit(1)
console.log(`백업 만료 정리 끝 · 지움 ${removed} · 남김 ${summary.kept}`)
