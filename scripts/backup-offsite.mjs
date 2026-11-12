// 바깥 사본 만들기(GPT 3차 검수 R3-04 · 4차 R4-03): `npm run backup:offsite [-- --include-partial]`
//  - ‘정상 백업’(manifest 의 status 가 complete · 필수 파일과 사진 수가 맞음)과 삭제 이력 파일만 바깥 사본 폴더(offsite)로 복사한다.
//    암호문(.enc)·manifest 만 옮긴다(평문·임시 파일은 옮기지 않음).
//  - 부분 백업(사진을 다 받지 못함)·끝나지 않은 백업·손상된 백업은 옮기지 않는다 → 바깥 사본에 있는 것은 복구 지점뿐이다.
//    부분 백업을 일부러 옮기려면 --include-partial(그래도 manifest 에 partial 로 남고, 복구 도구는 복구 지점으로 쓰지 않는다).
//  - 종료 코드: 0 = 가장 최근 백업이 정상이고 모두 복사됨 · 3 = 가장 최근 백업이 부분·손상(정상 백업을 다시 떠야 함) · 1 = 복사 실패·설정 없음·정상 백업이 하나도 없음
//  - 복사는 .part 로 쓴 뒤 지문(sha256)을 맞춰 보고 이름을 바꾼다. 이미 같은 지문이면 건너뛴다.
//  - 키는 옮기지 않는다(키는 비밀번호 관리자에 따로). 바깥 사본에도 같은 만료 규칙을 적용한다(이 명령 끝에 한 번 · 매일 backup:expire).
//  - offsite 는 이 컴퓨터가 고장 나도 남는 곳이어야 한다: 클라우드 동기화 폴더(구글 드라이브·OneDrive 등) 또는 따로 보관하는 외장 디스크.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { loadKey } from "./backup-crypto.mjs"
import { DELETIONS, backupState, expireRoot, log, reportRun, settings, sha256, walk, warn } from "./backup-lib.mjs"

const cfg = settings()
const includePartial = process.argv.includes("--include-partial")
if (!cfg.offsite) {
  warn(cfg, "바깥 사본 폴더(offsite)가 설정되지 않았어요", ["`%USERPROFILE%\\.flavie\\backup.json`에 \"offsite\" 경로를 적어 주세요(안내 문서)."])
  process.exit(1)
}
let key = null, keyId = null
try { ({ key, keyId } = loadKey()) } catch { /* 지문 확인만 한다 */ }
let copied = 0, skipped = 0
const errors = []
const seen = [] // [{ name, state }] 이름 순(= 시각 순)
const copy = (from, to) => {
  if (existsSync(to) && statSync(to).size === statSync(from).size && sha256(readFileSync(to)) === sha256(readFileSync(from))) { skipped++; return }
  mkdirSync(join(to, ".."), { recursive: true })
  const part = `${to}.part`
  copyFileSync(from, part)
  if (sha256(readFileSync(part)) !== sha256(readFileSync(from))) { rmSync(part, { force: true }); throw new Error(`복사한 파일이 원본과 달라요: ${relative(cfg.root, from)}`) }
  renameSync(part, to)
  copied++
}
try {
  mkdirSync(cfg.offsite, { recursive: true })
  for (const name of readdirSync(cfg.root).sort()) {
    const folder = join(cfg.root, name)
    if (!statSync(folder).isDirectory() || name.startsWith(".")) continue
    if (name === DELETIONS) { for (const file of readdirSync(folder)) if (file.endsWith(".enc")) copy(join(folder, file), join(cfg.offsite, DELETIONS, file)); continue }
    const { state, problems } = backupState(folder)
    seen.push({ name, state })
    if (state === "unfinished") continue // 끝나지 않은 백업은 옮기지 않는다
    if (state === "invalid") { errors.push(`${name}: 손상된 백업이라 옮기지 않았어요 · ${problems.join(" · ")}`); continue }
    if (state === "partial" && !includePartial) continue // 부분 백업은 복구 지점이 아니다
    // 암호문 먼저, manifest 는 마지막(바깥 사본에서도 manifest 가 있어야 ‘끝난 백업’)
    for (const file of walk(folder)) if (file.endsWith(".enc")) copy(file, join(cfg.offsite, name, relative(folder, file)))
    copy(join(folder, "manifest.json"), join(cfg.offsite, name, "manifest.json"))
  }
} catch (error) {
  errors.push(String(error?.message ?? error).split(/\r?\n/)[0].slice(0, 200))
}
const expired = expireRoot(cfg.offsite, { now: cfg.now, key, keyId, label: "바깥 사본" })
errors.push(...expired.errors)
const usable = seen.filter((b) => b.state === "complete" || b.state === "legacy")
const newest = seen.filter((b) => b.state !== "unfinished").at(-1) ?? seen.at(-1) ?? null
const partial = seen.filter((b) => b.state === "partial").length
if (!usable.length) errors.push("정상 백업이 하나도 없어요(바깥 사본에 복구 지점이 없어요). `npm run backup`을 먼저 끝내 주세요.")
log(cfg, { job: "backup-offsite", ok: errors.length === 0 && newest?.state !== "partial", copied, skipped, removed: expired.removed.length, complete: usable.length, partial, newest: newest?.state ?? null })
if (errors.length) {
  warn(cfg, "바깥 사본을 만들지 못했어요", [...errors.slice(0, 10), "폴더가 연결돼 있는지(외장 디스크·클라우드 앱) 확인하고 다시 실행해 주세요."])
  reportRun(cfg, "backup-expire", false, { stage: "offsite" })
  process.exit(1)
}
if (newest && newest.state !== "complete" && newest.state !== "legacy") {
  warn(cfg, "가장 최근 백업이 부분 백업이에요 · 바깥 사본의 복구 지점은 그 전 것이에요", [`가장 최근: ${newest.name}(${newest.state === "partial" ? "부분 백업" : "끝나지 않음"}) · 바깥 사본의 가장 최근 복구 지점: ${usable.at(-1).name}`, "`npm run backup`을 다시 실행해 정상 백업을 만든 뒤 `npm run backup:offsite`를 다시 실행해 주세요."])
  reportRun(cfg, "backup-expire", false, { stage: "offsite-partial" })
  console.log(`바깥 사본: 정상 백업 ${usable.length}개만 옮겼어요 · 부분 백업 ${partial}개는 ${includePartial ? "표시를 붙여 옮겼어요" : "옮기지 않았어요"} · 가장 최근 백업이 정상이 아니에요(종료 코드 3)`)
  process.exit(3)
}
console.log(`바깥 사본 끝 · 정상 백업 ${usable.length}개 · 새로 복사 ${copied} · 이미 있음 ${skipped} · 만료 삭제 ${expired.removed.length}${partial ? ` · 부분 백업 ${partial}개는 옮기지 않음` : ""}`)
