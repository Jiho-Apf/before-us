// 백업 도구 시험(GPT 2차 검수 T08) — 가짜 자료 · 가짜 CLI · 임시 폴더만 쓴다. 실제 서버·실제 백업 폴더·실제 키는 건드리지 않는다.
// 실행: node supabase/tests/backup/backup-tools.test.mjs
//  1) 암호화: 파일마다 새 IV · 틀린 키 · 바뀐 바이트(본문·태그·IV) · 잘린 파일 · 다른 형식은 모두 거절
//  2) 풀기(backup-open): 다른 키면 멈춤 · 손상된 파일이 하나라도 있으면 아무것도 풀지 않음 · 정상이면 원본 그대로
//  3) 백업(backup.mjs, 가짜 CLI): 두 버킷(신청 사진·편지 사진)이 manifest에 · 디스크에 평문이 남지 않음
//  4) 사진을 받은 직후(암호화 전) 강제 종료 → 평문이 남는 순간이 있음을 확인 → 다음 실행이 그 평문을 암호화
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
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
const walk = (dir) => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path] })
const K1 = randomBytes(32).toString("hex"), K2 = randomBytes(32).toString("hex")
process.env.FLAVIE_BACKUP_KEY = K1
const { encrypt, decrypt, loadKey } = await import("../../../scripts/backup-crypto.mjs")
const key1 = Buffer.from(K1, "hex"), key2 = Buffer.from(K2, "hex")
const work = mkdtempSync(join(tmpdir(), "flavie-backup-test-"))
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

  // 2) 풀기
  const sealedDir = join(work, "sealed"), photoBytes = randomBytes(4096)
  mkdirSync(join(sealedDir, "application-photos", "u1"), { recursive: true })
  writeFileSync(join(sealedDir, "data.json.enc"), encrypt(key1, plain))
  writeFileSync(join(sealedDir, "application-photos", "u1", "a.jpg.enc"), encrypt(key1, photoBytes))
  writeFileSync(join(sealedDir, "manifest.json"), JSON.stringify({ encryption: { alg: "aes-256-gcm", keyId: loadKey().keyId } }))
  const open = (to, keyHex) => { try { execFileSync(process.execPath, [join(code, "scripts", "backup-open.mjs"), sealedDir, to], { env: { ...process.env, FLAVIE_BACKUP_KEY: keyHex }, stdio: "pipe" }); return 0 } catch (error) { return error.status ?? 1 } }
  const wrongKeyOut = join(work, "open-wrong-key")
  ok("2) 다른 키로는 풀지 않고 멈춘다(종료 코드 1)", open(wrongKeyOut, K2) === 1 && !existsSync(wrongKeyOut))
  const tampered = readFileSync(join(sealedDir, "application-photos", "u1", "a.jpg.enc")); tampered[50] ^= 1
  writeFileSync(join(sealedDir, "application-photos", "u1", "a.jpg.enc"), tampered)
  const tamperedOut = join(work, "open-tampered")
  ok("2) 손상된 파일이 하나라도 있으면 아무 파일도 풀지 않는다(평문 0개)", open(tamperedOut, K1) === 1 && (!existsSync(tamperedOut) || walk(tamperedOut).length === 0))
  writeFileSync(join(sealedDir, "application-photos", "u1", "a.jpg.enc"), encrypt(key1, photoBytes))
  const goodOut = join(work, "open-good")
  ok("2) 정상이면 원본 그대로 풀린다", open(goodOut, K1) === 0 && readFileSync(join(goodOut, "data.json")).equals(plain) && readFileSync(join(goodOut, "application-photos", "u1", "a.jpg")).equals(photoBytes))

  // 3) 백업(가짜 CLI · 임시 백업 폴더)
  const root = join(work, "backups")
  const env = { ...process.env, FLAVIE_BACKUP_KEY: K1, FLAVIE_BACKUP_ROOT: root, FLAVIE_BACKUP_FAKE_CLI: join(here, "fake-supabase-cli.mjs") }
  const runBackup = (extra = {}) => execFileSync(process.execPath, [join(code, "scripts", "backup.mjs")], { env: { ...env, ...extra }, encoding: "utf8", stdio: "pipe", cwd: code })
  const output = runBackup()
  const folders = readdirSync(root)
  const manifest = JSON.parse(readFileSync(join(root, folders[0], "manifest.json"), "utf8"))
  ok("3) 가짜 CLI로 백업이 끝난다", /백업 끝/.test(output) && folders.length === 1)
  ok("3) 백업 폴더 이름은 날짜_시분초(KST)", /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(folders[0]))
  ok("3) manifest에 두 버킷(신청 사진·편지 사진)이 모두 있고 각각 2장", manifest.photos["application-photos"].saved === 2 && manifest.photos["letter-photos"].saved === 2)
  ok("3) manifest에 만료(30일)·키 번호·복구 순서(apply_deletion_log)가 있다", Date.parse(manifest.expiresAt) - Date.parse(manifest.at) === 30 * 86400000 && manifest.encryption.keyId === loadKey().keyId && /apply_deletion_log/.test(manifest.restore))
  const files = walk(join(root, folders[0]))
  ok("3) 디스크에는 .enc와 manifest만 있다(평문 0개)", files.every((f) => f.endsWith(".enc") || f.endsWith("manifest.json")))
  ok("3) 어떤 파일에도 평문 표시·가짜 회원 메일이 없다", files.every((f) => !/PLAINTEXT-PHOTO|fake-member@example\.test/.test(readFileSync(f, "latin1"))))
  const noRoot = (() => { try { execFileSync(process.execPath, [join(code, "scripts", "backup.mjs")], { env: { ...env, FLAVIE_BACKUP_ROOT: "" }, stdio: "pipe" }); return 0 } catch (error) { return error.status } })()
  ok("3) 가짜 CLI는 임시 백업 폴더 없이 쓸 수 없다(진짜 백업 폴더 보호)", noRoot === 2)

  // 4) 사진을 받은 직후(암호화 전) 강제 종료 → 다음 실행이 평문을 암호화
  rmSync(root, { recursive: true, force: true })
  const marker = join(work, "marker.txt")
  const child = spawn(process.execPath, [join(code, "scripts", "backup.mjs")], { env: { ...env, FAKE_SLOW_CP: "1", FAKE_MARKER: marker }, stdio: "ignore", cwd: code })
  const started = Date.now()
  while (!existsSync(marker) && Date.now() - started < 60000) await new Promise((r) => setTimeout(r, 100))
  const plainPath = readFileSync(marker, "utf8").trim()
  // 강제 종료(전원 차단·작업 끝내기와 같다: 종료 처리기가 돌지 않는다)
  try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }) } catch { child.kill("SIGKILL") }
  await new Promise((r) => setTimeout(r, 500))
  const crashed = readdirSync(root)
  ok("4) 강제 종료 직후에는 받은 사진의 평문이 디스크에 남아 있다(위험 확인)", existsSync(plainPath) && readFileSync(plainPath, "latin1").includes("PLAINTEXT-PHOTO"))
  ok("4) 끝나지 않은 백업 폴더에는 manifest가 없다", crashed.length === 1 && !existsSync(join(root, crashed[0], "manifest.json")))
  await new Promise((r) => setTimeout(r, 1100)) // 다음 백업 폴더 이름(초 단위)이 겹치지 않게
  runBackup()
  const leftovers = walk(root).filter((f) => !f.endsWith(".enc") && !f.endsWith("manifest.json"))
  ok("4) 다음 백업이 남은 평문을 모두 암호화한다(평문 0개)", leftovers.length === 0 && !existsSync(plainPath) && existsSync(`${plainPath}.enc`))
  ok("4) 암호화된 남은 사진은 같은 키로 풀린다", readFileSync(join(dirname(plainPath), "b.jpg.enc")).length > 32 && decrypt(key1, readFileSync(`${plainPath}.enc`)).toString().startsWith("PLAINTEXT-PHOTO"))
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`백업 도구 시험 통과: ${passed}개`)
