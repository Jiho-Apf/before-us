// 바깥 사본 만들기(GPT 3차 검수 R3-04): `npm run backup:offsite`
//  - 끝난 백업 폴더(manifest 있음)와 삭제 이력 파일을 바깥 사본 폴더(offsite)로 복사한다. 암호문(.enc)·manifest 만 옮긴다(평문·임시 파일은 옮기지 않음).
//  - 복사는 .part 로 쓴 뒤 지문(sha256)을 맞춰 보고 이름을 바꾼다. 이미 같은 지문이면 건너뛴다.
//  - 키는 옮기지 않는다(키는 비밀번호 관리자에 따로). 바깥 사본에도 같은 30일 만료를 적용한다(이 명령 끝에 한 번 · 매일 backup:expire).
//  - offsite 는 이 컴퓨터가 고장 나도 남는 곳이어야 한다: 클라우드 동기화 폴더(구글 드라이브·OneDrive 등) 또는 따로 보관하는 외장 디스크.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { loadKey } from "./backup-crypto.mjs"
import { DELETIONS, expireRoot, log, reportRun, settings, sha256, walk, warn } from "./backup-lib.mjs"

const cfg = settings()
if (!cfg.offsite) {
  warn(cfg, "바깥 사본 폴더(offsite)가 설정되지 않았어요", ["`%USERPROFILE%\\.flavie\\backup.json`에 \"offsite\" 경로를 적어 주세요(안내 문서)."])
  process.exit(1)
}
let key = null, keyId = null
try { ({ key, keyId } = loadKey()) } catch { /* 지문 확인만 한다 */ }
let copied = 0, skipped = 0
const errors = []
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
  for (const name of readdirSync(cfg.root)) {
    const folder = join(cfg.root, name)
    if (!statSync(folder).isDirectory() || name.startsWith(".")) continue
    if (name === DELETIONS) { for (const file of readdirSync(folder)) if (file.endsWith(".enc")) copy(join(folder, file), join(cfg.offsite, DELETIONS, file)); continue }
    if (!existsSync(join(folder, "manifest.json"))) continue // 끝나지 않은 백업은 옮기지 않는다
    // 암호문 먼저, manifest 는 마지막(바깥 사본에서도 manifest 가 있으면 ‘끝난 백업’)
    for (const file of walk(folder)) if (file.endsWith(".enc")) copy(file, join(cfg.offsite, name, relative(folder, file)))
    copy(join(folder, "manifest.json"), join(cfg.offsite, name, "manifest.json"))
  }
} catch (error) {
  errors.push(String(error?.message ?? error).split(/\r?\n/)[0].slice(0, 200))
}
const expired = expireRoot(cfg.offsite, { now: cfg.now, key, keyId, label: "바깥 사본" })
errors.push(...expired.errors)
log(cfg, { job: "backup-offsite", ok: errors.length === 0, copied, skipped, removed: expired.removed.length })
if (errors.length) {
  warn(cfg, "바깥 사본을 만들지 못했어요", [...errors.slice(0, 10), "폴더가 연결돼 있는지(외장 디스크·클라우드 앱) 확인하고 다시 실행해 주세요."])
  reportRun(cfg, "backup-expire", false, { stage: "offsite" })
  process.exit(1)
}
console.log(`바깥 사본 끝 · 새로 복사 ${copied} · 이미 있음 ${skipped} · 만료 삭제 ${expired.removed.length}`)
