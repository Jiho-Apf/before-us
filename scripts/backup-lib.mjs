// 플라비 백업 도구 공통 부분(GPT 3차 검수 R3-02·03·04).
//  - 설정: 환경 변수 > `%USERPROFILE%\.flavie\backup.json`(있으면) > 기본값. 키·비밀번호는 여기에 넣지 않는다.
//      root     : 백업 폴더(기본 `비포어스\백업`)
//      offsite  : 다른 장애 영역의 사본 폴더(예: 클라우드 동기화 폴더·외장 디스크). 없으면 사본을 만들지 않고 경고한다.
//      warnDir  : 실패 안내 파일을 둘 곳(기본 바탕 화면)
//  - 시험 모드: FLAVIE_BACKUP_FAKE_CLI(가짜 CLI)는 FLAVIE_BACKUP_ROOT(임시 폴더)와 함께만. 가짜 시각 FLAVIE_BACKUP_NOW 도 시험 모드에서만.
//  - 디스크에는 암호문(.enc)·암호문 임시 파일(.enc.part)·manifest·기록(.log)만 쓴다. 평문 바이트는 메모리에서만 다룬다.
import { execFile, execFileSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync, appendFileSync } from "node:fs"
import net from "node:net"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { decrypt, encrypt } from "./backup-crypto.mjs"

export const code = join(dirname(fileURLToPath(import.meta.url)), "..")
export const KEEP_DAYS = 30
export const BUCKETS = ["application-photos", "letter-photos"]
export const DELETIONS = "삭제 이력"
export const PROJECT = "mmrqcefipllmcqztksqm"

export function settings() {
  const fakeCli = process.env.FLAVIE_BACKUP_FAKE_CLI || null
  const testRoot = process.env.FLAVIE_BACKUP_ROOT || null
  if (fakeCli && !testRoot) { console.error("FLAVIE_BACKUP_FAKE_CLI는 FLAVIE_BACKUP_ROOT와 함께만 쓸 수 있어요."); process.exit(2) }
  if (process.env.FLAVIE_BACKUP_NOW && !testRoot) { console.error("FLAVIE_BACKUP_NOW(가짜 시각)는 시험(FLAVIE_BACKUP_ROOT)에서만 쓸 수 있어요."); process.exit(2) }
  const configFile = process.env.FLAVIE_BACKUP_CONFIG || (testRoot ? null : join(homedir(), ".flavie", "backup.json"))
  let file = {}
  if (configFile && existsSync(configFile)) {
    try { file = JSON.parse(readFileSync(configFile, "utf8").replace(/^\uFEFF/, "")) /* 메모장·PowerShell 5.1이 붙이는 BOM은 걸러 읽어요 */ } catch { console.error(`설정 파일을 읽지 못했어요: ${configFile}`); process.exit(2) }
  }
  const root = testRoot || file.root || join(code, "..", "백업")
  const offsite = process.env.FLAVIE_OFFSITE_DIR ?? file.offsite ?? null
  const warnDir = process.env.FLAVIE_BACKUP_WARN_DIR || file.warnDir || join(homedir(), "Desktop")
  const fixedNow = process.env.FLAVIE_BACKUP_NOW ? Date.parse(process.env.FLAVIE_BACKUP_NOW) : null
  return { root, offsite: offsite || null, warnDir, fakeCli, test: !!testRoot, now: () => new Date(fixedNow ?? Date.now()), report: process.env.FLAVIE_BACKUP_REPORT !== "0" }
}

// 폴더·파일 이름의 KST 시각: 2026-11-05_153012
export const stampOf = (date) => date.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", "_").replace(/:/g, "").slice(0, 17)
export function timeOfName(name) {
  const m = name.match(/(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})/)
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}+09:00`) : NaN
}
export const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path] }) : [])
export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")

// 암호문으로만 디스크에 쓴다: 임시 파일(.part)에 쓰고 디스크까지 내린 뒤(fsync) 다시 읽어 풀어 보고 같을 때만 최종 이름으로 바꾼다.
// 시험 모드에서만: stage(단계 이름) 알림 · 쓰기 실패 주입(디스크 가득 참 흉내)
let writes = 0
export function sealFile(key, plain, finalPath, { onStage = null } = {}) {
  const sealed = encrypt(key, plain)
  const part = `${finalPath}.part`
  mkdirSync(dirname(finalPath), { recursive: true })
  try {
    const fd = openSync(part, "w")
    try {
      writes++
      const failAt = Number(process.env.FLAVIE_BACKUP_TEST_ENOSPC || 0)
      if (process.env.FLAVIE_BACKUP_ROOT && failAt && writes === failAt) {
        writeSync(fd, sealed.subarray(0, Math.floor(sealed.length / 2)))
        throw Object.assign(new Error("ENOSPC: no space left on device, write (시험 주입)"), { code: "ENOSPC" })
      }
      writeSync(fd, sealed)
      fsyncSync(fd)
    } finally { closeSync(fd) }
    onStage?.("part-written", part)
    if (!decrypt(key, readFileSync(part)).equals(plain)) throw new Error("다시 읽은 암호문이 원래 내용과 달라요.")
    onStage?.("verified", part)
    renameSync(part, finalPath)
  } catch (error) {
    rmSync(part, { force: true })
    throw error
  }
  return { bytes: plain.length, sha256: sha256(plain) }
}
// 작은 글(manifest 등)도 임시 파일 → 이름 바꾸기
export function writeAtomic(path, text) {
  const part = `${path}.part`
  const fd = openSync(part, "w")
  try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(part, path)
}

// Supabase CLI(또는 시험용 가짜 CLI)
const quote = (value) => (/^[\w./:=\\-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`)
export function cliCommand(cfg, args) {
  return (cfg.fakeCli ? ["node", cfg.fakeCli, ...args] : ["npx", "--yes", "supabase@2.121.0", ...args]).map(quote).join(" ")
}
export function cliSync(cfg, args, { cwd = code, timeout = 600000 } = {}) {
  return execFileSync(cliCommand(cfg, args), { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, shell: true, stdio: ["ignore", "pipe", "pipe"], timeout })
}
// SQL은 파일로 넘긴다(작업 폴더 · 개인정보 없는 SQL만) · 결과(JSON)는 화면 출력으로 받아 메모리에만 둔다
export function query(cfg, sql) {
  const work = join(cfg.root, ".작업")
  mkdirSync(work, { recursive: true })
  const file = join(work, `q-${randomBytes(6).toString("hex")}.sql`)
  writeFileSync(file, sql)
  try {
    const out = cliSync(cfg, ["db", "query", "--linked", "--output-format", "json", "-f", file])
    return JSON.parse(out.slice(out.indexOf("{"))).rows
  } finally { rmSync(file, { force: true }) }
}

// 사진 한 장을 디스크를 거치지 않고 받는다: 이름 있는 파이프(\\.\pipe\…)를 열고 CLI가 그곳에 쓰게 한다(Supabase CLI 2.121.0으로 확인 · Windows).
export function pipeDownload(cfg, remote, { timeout = 120000 } = {}) {
  if (process.platform !== "win32") return Promise.reject(new Error("이 백업 도구는 Windows에서만 사진을 받아요(이름 있는 파이프)."))
  const name = String.raw`\\.\pipe\flavie-backup-` + randomBytes(16).toString("hex")
  return new Promise((resolve, reject) => {
    const chunks = []
    let connections = 0, ended = false, exited = null, finished = false
    const done = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); server.close(); child?.kill?.(); error ? reject(error) : resolve(value) }
    const check = () => { if (ended && exited !== null) exited === 0 ? (connections === 1 ? done(null, Buffer.concat(chunks)) : done(new Error(`파이프 연결이 ${connections}번이었어요.`))) : done(new Error(`CLI가 실패했어요(종료 코드 ${exited}).`)) }
    const server = net.createServer((socket) => {
      connections++
      if (connections > 1) { socket.destroy(); return } // 다른 프로그램이 끼어들면 받지 않는다
      socket.on("data", (chunk) => chunks.push(chunk))
      socket.on("end", () => { ended = true; check() })
      socket.on("error", (error) => done(error))
    })
    let child = null
    const timer = setTimeout(() => done(new Error("사진 받기가 시간 안에 끝나지 않았어요.")), timeout)
    server.on("error", (error) => done(error))
    server.listen(name, () => {
      child = execFile(cliCommand(cfg, ["storage", "cp", `ss://${remote}`, name, "--linked", "--experimental", "--workdir", code]), { cwd: code, shell: true, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error) => {
        exited = error ? (typeof error.code === "number" ? error.code : 1) : 0
        if (exited !== 0 || connections === 0) { ended = true }
        check()
      })
    })
  })
}

// 서버의 작업 기록(job_runs)에 결과 남기기(숫자만 · 실패해도 백업 자체는 계속) — 공개 상태(public_health)·운영진 화면에서 ‘백업 나이’로 보인다
export function reportRun(cfg, job, ok, detail = {}) {
  if (!cfg.report) return false
  const clean = Object.fromEntries(Object.entries(detail).filter(([, v]) => typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 120)))
  try {
    query(cfg, `select public.record_backup_run('${job}', ${ok ? "true" : "false"}, '${JSON.stringify(clean).replace(/'/g, "''")}'::jsonb) as done`)
    return true
  } catch (error) {
    log(cfg, { job, report: "failed", error: String(error?.message ?? error).split(/\r?\n/)[0].slice(0, 160) })
    return false
  }
}

export function log(cfg, entry) {
  try {
    mkdirSync(cfg.root, { recursive: true })
    appendFileSync(join(cfg.root, "백업 기록.log"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n")
  } catch { /* 기록 실패는 무시(경고 파일이 따로 있다) */ }
}
// 실패 안내 파일(바탕 화면) — 대표가 열어 볼 한국어 안내. 비밀 값·회원 정보는 쓰지 않는다.
export function warn(cfg, title, lines) {
  const file = join(cfg.warnDir, "플라비 백업 확인 필요.txt")
  try {
    mkdirSync(cfg.warnDir, { recursive: true })
    appendFileSync(file, [`[${cfg.now().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}] ${title}`, ...lines.map((l) => `  - ${l}`), ""].join("\r\n"))
  } catch { /* 안내 파일을 못 쓰면 화면에만 */ }
  console.error(`확인 필요: ${title}\n${lines.map((l) => `  - ${l}`).join("\n")}`)
  return file
}

// 만료 처리(백업 실행과 독립 · 같은 규칙을 로컬·삭제 이력·바깥 사본에 똑같이):
//  · 백업 폴더: manifest 의 expiresAt(없으면 폴더 이름 시각 + 30일)이 지나면 폴더째 삭제
//  · 삭제 이력 파일: 파일 이름 시각 + 30일
//  · 끝나지 못한 암호문 임시 파일(.part): 1시간 지나면 삭제(암호문이지만 쓸모가 없어서)
//  · 예전 버전이 남긴 평문(.enc·manifest·기록이 아닌 파일): 바로 암호화(키가 있을 때)
export function expireRoot(dir, { now, key = null, keyId = null, label, mustExist = true }) {
  const result = { label, dir, removed: [], kept: 0, parts: 0, sealed: 0, errors: [] }
  if (!existsSync(dir)) { if (mustExist) result.errors.push(`폴더를 찾을 수 없어요: ${dir}`); return result }
  const nowMs = now().getTime()
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    try {
      const st = statSync(path)
      if (name === ".작업") { for (const f of walk(path)) if (nowMs - statSync(f).mtimeMs > 3600000) rmSync(f, { force: true }); continue }
      if (st.isDirectory() && name === DELETIONS) {
        for (const file of readdirSync(path)) {
          const fp = join(path, file)
          const t = timeOfName(file)
          if (file.endsWith(".part") && nowMs - statSync(fp).mtimeMs > 3600000) { rmSync(fp, { force: true }); result.parts++; continue }
          if (Number.isFinite(t) && nowMs >= t + KEEP_DAYS * 86400000) { rmSync(fp, { force: true }); if (existsSync(fp)) throw new Error(`지워지지 않았어요: ${fp}`); result.removed.push(`${DELETIONS}/${file}`) } else result.kept++
        }
        continue
      }
      if (!st.isDirectory()) continue
      let manifest = null
      try { manifest = JSON.parse(readFileSync(join(path, "manifest.json"), "utf8")) } catch { /* 끝나지 않은 백업 · 예전 백업 */ }
      const born = Number.isFinite(timeOfName(name)) ? timeOfName(name) : st.mtimeMs
      const expires = manifest?.expiresAt ? Date.parse(manifest.expiresAt) : born + KEEP_DAYS * 86400000
      if (nowMs >= expires) {
        rmSync(path, { recursive: true, force: true })
        if (existsSync(path)) throw new Error(`지워지지 않았어요: ${path}`)
        result.removed.push(name)
        continue
      }
      result.kept++
      for (const file of walk(path)) {
        if (file.endsWith(".part")) { if (nowMs - statSync(file).mtimeMs > 3600000) { rmSync(file, { force: true }); result.parts++ } continue }
        if (file.endsWith(".enc") || file.endsWith("manifest.json") || file.endsWith(".log")) continue
        if (!key) { result.errors.push(`평문 파일이 남아 있어요(키가 없어 암호화하지 못함): ${file}`); continue }
        writeFileSync(`${file}.enc`, encrypt(key, readFileSync(file))); rmSync(file, { force: true }); result.sealed++
      }
      if (result.sealed && !manifest?.encryption && key) writeAtomic(join(path, "manifest.json"), JSON.stringify({ ...(manifest ?? {}), expiresAt: new Date(expires).toISOString(), encryption: { alg: "aes-256-gcm", keyId, sealedLater: true } }, null, 2))
    } catch (error) {
      result.errors.push(`${name}: ${String(error?.message ?? error).split(/\r?\n/)[0].slice(0, 200)}`)
    }
  }
  return result
}
