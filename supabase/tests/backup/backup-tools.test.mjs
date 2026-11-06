// 백업 도구 시험(GPT 2차 검수 T08 · 3차 검수 R3-02·R3-03·R3-04) — 가짜 자료 · 가짜 CLI · 임시 폴더만 쓴다.
// 실제 서버·실제 백업 폴더(비포어스\백업)·실제 키(%USERPROFILE%\.flavie\backup.key)·실제 설정 파일은 건드리지 않는다.
// 실행: node supabase/tests/backup/backup-tools.test.mjs (Windows · 이름 있는 파이프)
//  1) 암호화: 파일마다 새 IV · 틀린 키 · 바뀐 바이트(본문·태그·IV) · 잘린 파일 · 다른 형식은 모두 거절
//  2) 풀기(backup-open): 다른 키면 멈춤 · 손상된 파일이 하나라도 있으면 아무것도 풀지 않음 · 정상이면 원본 그대로(형식 2 · 예전 형식)
//  3) 백업(가짜 CLI): 두 버킷 · 디스크에는 암호문·manifest·기록만 · 경로(회원 번호)는 폴더 이름에 드러나지 않음 · 서버 기록
//  4) 강제 종료(받는 도중 · 받은 직후 · 암호문 쓰기 직후 · 확인 직후) · 디스크 가득 참(주입) · 디스크 오류(실제 EISDIR)
//     → ‘다음 실행 전’ 디스크 어디에도 가짜 평문·원본 이미지 바이트가 없다
//  5) 만료(백업과 독립): 가짜 시각으로 40일 동안 새 백업 없이 → 로컬·삭제 이력·바깥 사본 모두 정책대로 지움 · 실패하면 경고·종료 코드·서버 기록
//  6) 삭제 이력 내보내기 · 바깥 사본(지문 확인) · 예전 버전이 남긴 평문은 만료 정리 때 바로 암호화
import assert from "node:assert/strict"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const code = join(here, "..", "..", "..")
let passed = 0
const ok = (label, value) => { assert.ok(value, label); passed++; console.log("✓", label) }
const throws = (fn) => { try { fn(); return null } catch (error) { return error } }
const walk = (dir) => { try { return readdirSync(dir).flatMap((name) => { const path = join(dir, name); try { return statSync(path).isDirectory() ? walk(path) : [path] } catch { return [] } }) } catch { return [] } }
const K1 = randomBytes(32).toString("hex"), K2 = randomBytes(32).toString("hex")
process.env.FLAVIE_BACKUP_KEY = K1
const { encrypt, decrypt, loadKey } = await import("../../../scripts/backup-crypto.mjs")
const key1 = Buffer.from(K1, "hex"), key2 = Buffer.from(K2, "hex")
const work = mkdtempSync(join(tmpdir(), "flavie-backup-test-"))
const realKeyBefore = existsSync(join(process.env.USERPROFILE ?? "", ".flavie", "backup.key")) ? statSync(join(process.env.USERPROFILE, ".flavie", "backup.key")).mtimeMs : null
// 평문 검사: 가짜 사진 표시 문자열 · 가짜 회원 메일 · JPG 시작 바이트(FF D8 FF)
const plaintextIn = (dir) => walk(dir).filter((f) => { try { const b = readFileSync(f); return b.includes("PLAINTEXT-PHOTO") || b.includes("fake-member@example.test") || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) } catch { return false } })
const strayIn = (dir) => walk(dir).filter((f) => !/\.(enc|enc\.part|log)$/.test(f) && !f.endsWith("manifest.json") && !f.endsWith("플라비 백업 확인 필요.txt"))
try {
  // 1) 암호화
  const plain = Buffer.from(JSON.stringify({ email: "fake-member@example.test", note: "가짜 자료" }))
  const a = encrypt(key1, plain), b = encrypt(key1, plain)
  ok("1) 같은 내용도 파일마다 새 IV(12바이트)를 쓴다", !a.subarray(4, 16).equals(b.subarray(4, 16)) && !a.equals(b))
  ok("1) 암호문에 평문이 보이지 않는다", !a.toString("latin1").includes("fake-member"))
  ok("1) 같은 키로는 그대로 풀린다", decrypt(key1, a).equals(plain))
  ok("1) 틀린 키는 거절", /풀 수 없어요/.test(throws(() => decrypt(key2, a))?.message ?? ""))
  for (const [label, index] of [["본문", 40], ["인증 태그", 20], ["IV", 8]]) {
    const bad = Buffer.from(a); bad[index] ^= 1
    ok(`1) ${label} 한 바이트만 바뀌어도 거절`, !!throws(() => decrypt(key1, bad)))
  }
  for (const length of [0, 4, 16, 20, 31]) ok(`1) ${length}바이트로 잘린 파일은 거절(짧은 인증 태그를 받지 않음)`, /잘린|아니거나/.test(throws(() => decrypt(key1, a.subarray(0, length)))?.message ?? ""))
  ok("1) 본문이 잘린 파일은 거절", !!throws(() => decrypt(key1, a.subarray(0, a.length - 3))))
  ok("1) 다른 형식(머리 FLV1 아님)은 거절", !!throws(() => decrypt(key1, Buffer.concat([Buffer.from("XXXX"), a.subarray(4)]))))
  ok("1) 키 번호(keyId)는 키에서 나온 8자리", loadKey().keyId.length === 8)

  // 2) 풀기(예전 형식)
  const sealedDir = join(work, "sealed"), photoBytes = randomBytes(4096)
  mkdirSync(join(sealedDir, "application-photos", "u1"), { recursive: true })
  writeFileSync(join(sealedDir, "data.json.enc"), encrypt(key1, plain))
  writeFileSync(join(sealedDir, "application-photos", "u1", "a.jpg.enc"), encrypt(key1, photoBytes))
  writeFileSync(join(sealedDir, "manifest.json"), JSON.stringify({ encryption: { alg: "aes-256-gcm", keyId: loadKey().keyId } }))
  const open = (from, to, keyHex) => { try { execFileSync(process.execPath, [join(code, "scripts", "backup-open.mjs"), from, to], { env: { ...process.env, FLAVIE_BACKUP_KEY: keyHex }, stdio: "pipe" }); return 0 } catch (error) { return error.status ?? 1 } }
  const wrongKeyOut = join(work, "open-wrong-key")
  ok("2) 다른 키로는 풀지 않고 멈춘다(종료 코드 1)", open(sealedDir, wrongKeyOut, K2) === 1 && !existsSync(wrongKeyOut))
  const tampered = readFileSync(join(sealedDir, "application-photos", "u1", "a.jpg.enc")); tampered[50] ^= 1
  writeFileSync(join(sealedDir, "application-photos", "u1", "a.jpg.enc"), tampered)
  const tamperedOut = join(work, "open-tampered")
  ok("2) 손상된 파일이 하나라도 있으면 아무 파일도 풀지 않는다(평문 0개)", open(sealedDir, tamperedOut, K1) === 1 && (!existsSync(tamperedOut) || walk(tamperedOut).length === 0))
  writeFileSync(join(sealedDir, "application-photos", "u1", "a.jpg.enc"), encrypt(key1, photoBytes))
  const goodOut = join(work, "open-good")
  ok("2) 정상이면 원본 그대로 풀린다(예전 형식)", open(sealedDir, goodOut, K1) === 0 && readFileSync(join(goodOut, "data.json")).equals(plain) && readFileSync(join(goodOut, "application-photos", "u1", "a.jpg")).equals(photoBytes))

  // 3) 백업(가짜 CLI · 임시 백업 폴더 · 형식 2)
  const T0 = "2026-11-02T03:00:00Z" // 2026-11-02 12:00 KST
  const env = (root, extra = {}) => ({ ...process.env, FLAVIE_BACKUP_KEY: K1, FLAVIE_BACKUP_ROOT: root, FLAVIE_BACKUP_FAKE_CLI: join(here, "fake-supabase-cli.mjs"), FLAVIE_BACKUP_WARN_DIR: join(root, "..", `${root.split(/[\\/]/).pop()}-warn`), FAKE_REPORT_LOG: join(root, "..", `${root.split(/[\\/]/).pop()}-report.log`), FLAVIE_OFFSITE_DIR: "", ...extra })
  const run = (script, root, extra = {}) => spawnSync(process.execPath, [join(code, "scripts", script)], { env: env(root, extra), encoding: "utf8", cwd: code })
  const root = join(work, "backups")
  const r3 = run("backup.mjs", root, { FLAVIE_BACKUP_NOW: T0 })
  const folders = readdirSync(root).filter((n) => /^\d{4}-/.test(n))
  const manifest = JSON.parse(readFileSync(join(root, folders[0], "manifest.json"), "utf8"))
  ok("3) 가짜 CLI로 백업이 끝난다(폴더 이름은 날짜_시분초 KST)", r3.status === 0 && /백업 끝/.test(r3.stdout) && folders.length === 1 && folders[0] === "2026-11-02_120000")
  ok("3) manifest에 두 버킷이 모두 있고 각각 2장 · 만료 30일 · 키 번호 · 형식 2", manifest.photos["application-photos"].saved === 2 && manifest.photos["letter-photos"].saved === 2 && Date.parse(manifest.expiresAt) - Date.parse(manifest.at) === 30 * 86400000 && manifest.encryption.keyId === loadKey().keyId && manifest.format === 2)
  ok("3) 디스크에는 암호문·manifest·기록만 있다(평문 0개)", strayIn(root).length === 0 && plaintextIn(root).length === 0)
  ok("3) 폴더·파일 이름에 사진 경로(회원 번호 폴더)가 드러나지 않는다", walk(join(root, folders[0])).every((f) => !/u1|a\.jpg|b\.jpg/.test(f)))
  ok("3) manifest에는 숫자·시각만(회원 메일·경로 없음)", !/fake-member|u1\//.test(JSON.stringify(manifest)))
  const out3 = join(work, "open-v2")
  ok("3) 형식 2도 backup-open으로 원래 버킷·경로로 풀린다(지문 확인)", open(join(root, folders[0]), out3, K1) === 0 && readFileSync(join(out3, "application-photos", "u1", "a.jpg")).includes("PLAINTEXT-PHOTO") && existsSync(join(out3, "letter-photos", "u1", "b.jpg")) && existsSync(join(out3, "data.json")))
  rmSync(out3, { recursive: true, force: true })
  ok("3) 끝나면 서버 작업 기록(backup · 숫자만)을 남긴다", /record_backup_run\('backup', true/.test(readFileSync(join(work, "backups-report.log"), "utf8")))
  ok("3) 가짜 CLI는 임시 백업 폴더 없이 쓸 수 없다(진짜 백업 폴더 보호)", spawnSync(process.execPath, [join(code, "scripts", "backup.mjs")], { env: { ...env(root), FLAVIE_BACKUP_ROOT: "" }, encoding: "utf8" }).status === 2)
  ok("3) 가짜 시각은 시험 폴더 없이 쓸 수 없다", spawnSync(process.execPath, [join(code, "scripts", "backup-expire.mjs")], { env: { ...process.env, FLAVIE_BACKUP_KEY: K1, FLAVIE_BACKUP_NOW: T0, FLAVIE_BACKUP_ROOT: "" }, encoding: "utf8" }).status === 2)

  // 4) 강제 종료 · 디스크 가득 참 · 디스크 오류 → 다음 실행 전 평문 없음
  const kill = async (label, extra, until) => {
    const kroot = join(work, `kill-${label}`)
    const marker = join(work, `kill-${label}.marker`)
    const child = spawn(process.execPath, [join(code, "scripts", "backup.mjs")], { env: env(kroot, { FAKE_MARKER: marker, FLAVIE_BACKUP_TEST_MARKER: marker, ...extra }), stdio: "ignore", cwd: code })
    const t0 = Date.now()
    while (!existsSync(marker) && Date.now() - t0 < 60000 && child.exitCode === null) await new Promise((r) => setTimeout(r, 20))
    const running = child.exitCode === null
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }) } catch { child.kill("SIGKILL") }
    await new Promise((r) => setTimeout(r, 500))
    return { kroot, running, stage: existsSync(marker) ? JSON.parse(readFileSync(marker, "utf8")) : null }
  }
  for (const [label, extra, what] of [
    ["mid", { FAKE_CP_MODE: "mid" }, "사진을 받는 도중(가짜 CLI가 절반만 보냄)"],
    ["after", { FAKE_CP_MODE: "after" }, "사진을 다 받은 직후(CLI가 끝나기 전)"],
    ["part", { FLAVIE_BACKUP_TEST_PAUSE: "part-written", FLAVIE_BACKUP_TEST_PAUSE_NTH: "4" }, "암호문 임시 파일을 쓴 직후(확인 전)"],
    ["verified", { FLAVIE_BACKUP_TEST_PAUSE: "verified", FLAVIE_BACKUP_TEST_PAUSE_NTH: "4" }, "암호문 확인 직후(이름 바꾸기 전)"],
  ]) {
    const k = await kill(label, extra)
    ok(`4) ${what}에 강제 종료했다`, k.running && !!k.stage)
    ok(`4) ${what} 강제 종료 → 다음 실행 전 디스크에 평문·원본 이미지 바이트가 없다`, plaintextIn(k.kroot).length === 0 && strayIn(k.kroot).length === 0)
    ok(`4) ${what} 강제 종료 → 끝나지 않은 폴더에는 manifest가 없다`, readdirSync(k.kroot).filter((n) => /^\d{4}-/.test(n)).every((n) => !existsSync(join(k.kroot, n, "manifest.json"))))
    if (label === "part" || label === "verified") ok(`4) ${what}: 남은 것은 암호문 임시 파일(.enc.part)뿐이고 같은 키로만 풀린다`, walk(k.kroot).some((f) => f.endsWith(".enc.part")) && walk(k.kroot).filter((f) => f.endsWith(".enc.part")).every((f) => { try { decrypt(key1, readFileSync(f)); return true } catch { return false } }))
    // 1시간 넘게 지난 임시 파일은 다음 만료 정리가 지운다(평문이 아니므로 급하지 않음)
    mkdirSync(join(work, `kill-${label}-off`), { recursive: true })
    const later = run("backup-expire.mjs", k.kroot, { FLAVIE_BACKUP_NOW: new Date(Date.now() + 2 * 3600000).toISOString(), FLAVIE_OFFSITE_DIR: join(work, `kill-${label}-off`) })
    ok(`4) ${what}: 만료 정리가 남은 임시 파일을 지운다`, later.status === 0 && !walk(k.kroot).some((f) => f.endsWith(".part")))
  }
  // 디스크 가득 참(쓰기 실패 주입): 멈추고 평문·임시 파일 없음 · 안내 · 서버 기록(실패)
  {
    const froot = join(work, "enospc")
    const r = run("backup.mjs", froot, { FLAVIE_BACKUP_TEST_ENOSPC: "3", FLAVIE_BACKUP_NOW: T0 })
    ok("4) 디스크 가득 참(쓰기 실패 주입) → 종료 코드 1 · 평문·임시 파일 없음", r.status === 1 && plaintextIn(froot).length === 0 && !walk(froot).some((f) => f.endsWith(".part")) && strayIn(froot).length === 0)
    ok("4) 디스크 가득 참 → 바탕 화면 안내 파일 · 서버 기록(실패)", /디스크 공간이 부족/.test(readFileSync(join(work, "enospc-warn", "플라비 백업 확인 필요.txt"), "utf8")) && /record_backup_run\('backup', false/.test(readFileSync(join(work, "enospc-report.log"), "utf8")))
  }
  // 실제 디스크 오류(작업 폴더 자리에 같은 이름의 파일이 있어 쓸 수 없음 · 실제 파일 시스템 오류)
  {
    const eroot = join(work, "fserror")
    mkdirSync(eroot, { recursive: true })
    writeFileSync(join(eroot, ".작업"), "폴더가 아니라 파일")
    const r = run("backup.mjs", eroot, { FLAVIE_BACKUP_NOW: T0 })
    ok("4) 실제 파일 시스템 오류 → 종료 코드 1 · 평문 없음 · 끝나지 않은 폴더(manifest 없음) · 안내 파일", r.status === 1 && plaintextIn(eroot).length === 0 && !existsSync(join(eroot, "2026-11-02_120000", "manifest.json")) && /백업 중 오류로 멈췄어요/.test(readFileSync(join(work, "fserror-warn", "플라비 백업 확인 필요.txt"), "utf8")))
  }
  // CLI가 실패한 사진(받지 못함): 실패로 세고 평문 없음
  {
    const croot = join(work, "cpfail")
    const r = run("backup.mjs", croot, { FAKE_CP_MODE: "fail", FLAVIE_BACKUP_NOW: T0 })
    const m = JSON.parse(readFileSync(join(croot, "2026-11-02_120000", "manifest.json"), "utf8"))
    ok("4) CLI가 사진을 내려받지 못하면 실패로 세고(4장) 평문 없음", r.status === 0 && m.photos["application-photos"].failed === 2 && m.photos["letter-photos"].failed === 2 && plaintextIn(croot).length === 0)
  }

  // 5) 만료 — 백업과 독립 · 로컬·삭제 이력·바깥 사본 같은 규칙 · 가짜 시각 40일
  {
    const xroot = join(work, "expire"), off = join(work, "expire-offsite")
    const at = (days) => new Date(Date.parse(T0) + days * 86400000).toISOString()
    ok("5) (준비) T0 백업", run("backup.mjs", xroot, { FLAVIE_BACKUP_NOW: T0, FLAVIE_OFFSITE_DIR: off }).status === 0)
    ok("5) (준비) T0 삭제 이력 내보내기 → 로컬·바깥 사본 모두", run("backup-deletions.mjs", xroot, { FLAVIE_BACKUP_NOW: T0, FLAVIE_OFFSITE_DIR: off }).status === 0 && readdirSync(join(off, "삭제 이력")).length === 1)
    ok("5) (준비) 바깥 사본 복사(지문 확인)", run("backup-offsite.mjs", xroot, { FLAVIE_BACKUP_NOW: T0, FLAVIE_OFFSITE_DIR: off }).status === 0 && existsSync(join(off, "2026-11-02_120000", "manifest.json")))
    ok("5) 바깥 사본에도 평문·임시 파일 없음", plaintextIn(off).length === 0 && strayIn(off).length === 0)
    const count = () => [readdirSync(xroot).filter((n) => /^\d{4}-/.test(n)).length, readdirSync(join(xroot, "삭제 이력")).length, readdirSync(off).filter((n) => /^\d{4}-/.test(n)).length, readdirSync(join(off, "삭제 이력")).length]
    const day29 = run("backup-expire.mjs", xroot, { FLAVIE_BACKUP_NOW: at(29.9), FLAVIE_OFFSITE_DIR: off })
    ok("5) 29.9일째: 새 백업이 없어도 아직 아무것도 지우지 않는다", day29.status === 0 && JSON.stringify(count()) === "[1,1,1,1]")
    const day40 = run("backup-expire.mjs", xroot, { FLAVIE_BACKUP_NOW: at(40), FLAVIE_OFFSITE_DIR: off })
    ok("5) 40일째(그동안 새 백업 없음): 만료 정리만으로 로컬 백업·삭제 이력·바깥 사본·바깥 삭제 이력이 모두 지워진다", day40.status === 0 && JSON.stringify(count()) === "[0,0,0,0]")
    const logLines = readFileSync(join(xroot, "백업 기록.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.job === "backup-expire")
    ok("5) 만료 실행마다 기록(백업 기록.log)과 서버 기록(backup-expire)이 남는다", logLines.at(-1).removed === 4 && logLines.at(-1).ok === true && (readFileSync(join(work, "expire-report.log"), "utf8").match(/record_backup_run\('backup-expire', true/g) ?? []).length >= 2)
    // 서버 기록이 실패해도(인터넷 끊김) 만료는 끝까지 하고, 기록에 남긴다
    const offline = run("backup-expire.mjs", xroot, { FLAVIE_BACKUP_NOW: at(41), FLAVIE_OFFSITE_DIR: off, FAKE_REPORT_FAIL: "1" })
    ok("5) 서버 기록이 실패해도 만료 정리는 끝까지 한다(로컬 기록에 report: failed)", offline.status === 0 && /"report":"failed"/.test(readFileSync(join(xroot, "백업 기록.log"), "utf8")))
  }
  // 만료 실패 ① 바깥 사본 폴더가 연결되지 않음(외장 디스크 빠짐) → 종료 코드 1 · 안내 · 서버 기록(실패)
  {
    const froot = join(work, "expire-fail")
    run("backup.mjs", froot, { FLAVIE_BACKUP_NOW: T0 })
    writeFileSync(join(work, "not-a-folder.txt"), "x")
    const r = run("backup-expire.mjs", froot, { FLAVIE_BACKUP_NOW: new Date(Date.parse(T0) + 40 * 86400000).toISOString(), FLAVIE_OFFSITE_DIR: join(work, "not-a-folder.txt", "offsite") })
    ok("5) 바깥 사본 폴더를 찾을 수 없으면 종료 코드 1(로컬 만료는 그대로 처리)", r.status === 1 && readdirSync(froot).filter((n) => /^\d{4}-/.test(n)).length === 0)
    ok("5) 실패 안내 파일(바탕 화면)과 서버 기록(실패)이 남는다", /백업 만료 정리를 끝내지 못했어요/.test(readFileSync(join(work, "expire-fail-warn", "플라비 백업 확인 필요.txt"), "utf8")) && /record_backup_run\('backup-expire', false/.test(readFileSync(join(work, "expire-fail-report.log"), "utf8")))
  }
  // 만료 실패 ② 실제로 지울 수 없는 폴더(권한 거부 · icacls 시험 폴더에만) → 종료 코드 1 · 안내
  {
    const aroot = join(work, "expire-acl"), aoff = join(work, "expire-acl-off")
    run("backup.mjs", aroot, { FLAVIE_BACKUP_NOW: T0 })
    mkdirSync(aoff, { recursive: true })
    const folder = join(aroot, "2026-11-02_120000")
    const who = process.env.USERNAME
    let denied = false
    try { execFileSync("icacls", [folder, "/deny", `${who}:(OI)(CI)(DE,DC)`], { stdio: "ignore" }); denied = true } catch { /* icacls를 쓸 수 없으면 이 시험은 건너뜀 */ }
    if (denied) {
      const r = run("backup-expire.mjs", aroot, { FLAVIE_BACKUP_NOW: new Date(Date.parse(T0) + 40 * 86400000).toISOString(), FLAVIE_OFFSITE_DIR: aoff })
      execFileSync("icacls", [folder, "/remove:d", who], { stdio: "ignore" })
      ok("5) 지울 수 없는 백업(권한 거부)이 있으면 종료 코드 1 · 안내 파일 · 그 폴더 이름이 기록에 남는다", r.status === 1 && /2026-11-02_120000/.test(readFileSync(join(work, "expire-acl-warn", "플라비 백업 확인 필요.txt"), "utf8")))
    } else console.log("  (icacls를 쓸 수 없어 권한 거부 시험은 건너뜀)")
  }

  // 6) 예전 버전이 남긴 평문(이번 변경 전 강제 종료 흔적) → 만료 정리가 바로 암호화
  {
    const lroot = join(work, "legacy"), lf = join(lroot, "2026-11-01_120000", "application-photos", "u1")
    mkdirSync(lf, { recursive: true })
    writeFileSync(join(lf, "b.jpg"), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("PLAINTEXT-PHOTO 예전")]))
    mkdirSync(join(work, "legacy-off"), { recursive: true })
    const r = run("backup-expire.mjs", lroot, { FLAVIE_BACKUP_NOW: "2026-11-03T03:00:00Z", FLAVIE_OFFSITE_DIR: join(work, "legacy-off") })
    ok("6) 예전 버전이 남긴 평문은 만료 정리 때 암호화된다(평문 0개 · 같은 키로 풀림)", plaintextIn(lroot).length === 0 && decrypt(key1, readFileSync(join(lf, "b.jpg.enc"))).includes("PLAINTEXT-PHOTO"))
  }
  const realKeyAfter = existsSync(join(process.env.USERPROFILE ?? "", ".flavie", "backup.key")) ? statSync(join(process.env.USERPROFILE, ".flavie", "backup.key")).mtimeMs : null
  ok("실제 키 파일은 건드리지 않았다(있으면 수정 시각 그대로)", realKeyBefore === realKeyAfter)
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`백업 도구 시험 통과: ${passed}개`)
