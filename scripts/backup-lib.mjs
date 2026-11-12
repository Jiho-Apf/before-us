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
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { decrypt, encrypt } from "./backup-crypto.mjs"

export const code = join(dirname(fileURLToPath(import.meta.url)), "..")
export const KEEP_DAYS = 30 // 약속한 기한: 만든 지 30일 안에 없앤다(처리방침의 ‘최대 30일’)
export const CLEAN_AFTER_DAYS = 29 // 지우기 시작: 만든 지 29일. 만료 정리가 매일 돌면 늦어도 29일+24시간 = 30일 안에 지워진다(GPT 4차 R4-05)
export const PART_AFTER_MS = 3600000 // 끝나지 못한 암호문 임시 파일(.part)을 지울 수 있게 되는 때: 쓴 지 1시간
export const DELETIONS_STALE_HOURS = 26 // 삭제 이력이 이보다 오래 갱신되지 않으면 알린다(매일 내보내기 + 여유 2시간)
const DAY = 86400000
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

// 만료 처리(백업 실행과 독립 · 같은 규칙을 로컬·삭제 이력·바깥 사본에 똑같이 · GPT 3차 R3-03 · 4차 R4-05):
//  · 백업 폴더·삭제 이력 파일: 만든 때(이름의 시각) + 29일이 지나면 지운다. 약속한 기한은 + 30일이다.
//    매일 한 번 돌면 기한 안에 지워진다. 컴퓨터가 꺼져 있어 기한을 넘겨 지웠으면 late 에 남긴다(숨기지 않는다).
//  · 끝나지 못한 암호문 임시 파일(.part): 쓴 지 1시간이 지나면 ‘지울 수 있음’. 실제로 지우는 때는 그다음 실행이다 → 두 시각을 따로 남긴다.
//  · 예전 버전이 남긴 평문(.enc·manifest·기록이 아닌 파일): 바로 암호화(키가 있을 때)
export function expireRoot(dir, { now, key = null, keyId = null, label, mustExist = true }) {
  const result = { label, dir, removed: [], kept: 0, parts: 0, sealed: 0, errors: [], late: [], partFiles: [] }
  if (!existsSync(dir)) { if (mustExist) result.errors.push(`폴더를 찾을 수 없어요: ${dir}`); return result }
  const nowMs = now().getTime()
  const iso = (ms) => new Date(ms).toISOString()
  const dropPart = (file) => {
    const eligible = statSync(file).mtimeMs + PART_AFTER_MS
    if (nowMs < eligible) return
    rmSync(file, { force: true })
    if (existsSync(file)) throw new Error(`지워지지 않았어요: ${file}`)
    result.parts++
    result.partFiles.push({ file: relative(dir, file).replace(/\\/g, "/"), eligibleAt: iso(eligible), removedAt: iso(nowMs) })
  }
  // 만든 때 born 기준으로 지울 때가 됐으면 지우고 true. 기한(30일)을 넘겨 지웠거나 지우지 못했으면 그 사실을 남긴다.
  const dropExpired = (path, name, born, hint = Infinity) => {
    const eligible = Math.min(born + CLEAN_AFTER_DAYS * DAY, Number.isFinite(hint) ? hint : Infinity)
    if (nowMs < eligible) return false
    const deadline = born + KEEP_DAYS * DAY
    const lateHours = nowMs > deadline ? Math.round(((nowMs - deadline) / 3600000) * 10) / 10 : 0
    rmSync(path, { recursive: true, force: true })
    if (existsSync(path)) throw new Error(`지워지지 않았어요${lateHours ? `(약속한 30일을 ${lateHours}시간 넘김)` : ""}: ${path}`)
    result.removed.push(name)
    if (lateHours) result.late.push({ name, lateHours })
    return true
  }
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    try {
      const st = statSync(path)
      if (name === ".작업") { for (const f of walk(path)) if (nowMs - statSync(f).mtimeMs > 3600000) rmSync(f, { force: true }); continue }
      if (st.isDirectory() && name === DELETIONS) {
        for (const file of readdirSync(path)) {
          const fp = join(path, file)
          try {
            if (file.endsWith(".part")) { dropPart(fp); continue }
            const t = timeOfName(file)
            if (!Number.isFinite(t) || !dropExpired(fp, `${DELETIONS}/${file}`, t)) result.kept++
          } catch (error) { result.errors.push(`${DELETIONS}/${file}: ${String(error?.message ?? error).split(/\r?\n/)[0].slice(0, 200)}`) }
        }
        continue
      }
      if (!st.isDirectory()) continue
      let manifest = null
      try { manifest = JSON.parse(readFileSync(join(path, "manifest.json"), "utf8")) } catch { /* 끝나지 않은 백업 · 예전 백업 */ }
      const born = Number.isFinite(timeOfName(name)) ? timeOfName(name) : st.mtimeMs
      if (dropExpired(path, name, born, manifest?.expiresAt ? Date.parse(manifest.expiresAt) : Infinity)) continue
      result.kept++
      for (const file of walk(path)) {
        if (file.endsWith(".part")) { dropPart(file); continue }
        if (file.endsWith(".enc") || file.endsWith("manifest.json") || file.endsWith(".log")) continue
        if (!key) { result.errors.push(`평문 파일이 남아 있어요(키가 없어 암호화하지 못함): ${file}`); continue }
        writeFileSync(`${file}.enc`, encrypt(key, readFileSync(file))); rmSync(file, { force: true }); result.sealed++
      }
      if (result.sealed && !manifest?.encryption && key) writeAtomic(join(path, "manifest.json"), JSON.stringify({ ...(manifest ?? {}), expiresAt: new Date(born + CLEAN_AFTER_DAYS * DAY).toISOString(), mustBeGoneBy: new Date(born + KEEP_DAYS * DAY).toISOString(), encryption: { alg: "aes-256-gcm", keyId, sealedLater: true } }, null, 2))
    } catch (error) {
      result.errors.push(`${name}: ${String(error?.message ?? error).split(/\r?\n/)[0].slice(0, 200)}`)
    }
  }
  return result
}

// ── 백업의 상태(GPT 4차 R4-03·R4-04)
//  complete  : 자료·스키마·목록이 있고, 목록에 오른 사진을 모두 받았고, 지문이 맞는다 → ‘정상 복구 지점’
//  partial   : 자료·스키마는 있지만 사진을 일부(또는 전부) 받지 못했거나 지문이 달랐다 → 지우지는 않지만 복구 지점으로 쓰지 않는다
//  unfinished: manifest 가 없다(도중에 멈춘 백업)
//  invalid   : manifest 는 있는데 필수 파일이 없거나 개수가 맞지 않는다(손상)
//  legacy    : 2026-11-05 이전 형식(형식 값 없음 · 경로 그대로의 .enc)
const REQUIRED = ["data.json.enc", "schema.json.enc", "index.json.enc"]
const photosFailed = (photos) => Object.values(photos ?? {}).some((r) => (r?.failed ?? 0) > 0 || (r?.mismatched ?? 0) > 0 || !!r?.error)
const statusOf = (manifest) => (manifest.status === "partial" || manifest.status === "failed" || photosFailed(manifest.photos) ? "partial" : manifest.status === "complete" || manifest.format === 2 ? "complete" : "partial")
// 키 없이 빠르게 보는 판정(바깥 사본·만료 안내용). 실제로 풀리는지는 verifyBackup 이 확인한다.
export function backupState(folder) {
  if (!existsSync(join(folder, "manifest.json"))) return { state: "unfinished", manifest: null, problems: [] }
  let manifest
  try { manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) } catch { return { state: "invalid", manifest: null, problems: ["manifest.json을 읽을 수 없어요"] } }
  const hasIndex = existsSync(join(folder, "index.json.enc")), hasFiles = existsSync(join(folder, "files"))
  if (manifest.format === undefined) return hasIndex || hasFiles ? { state: "invalid", manifest, problems: ["형식 값이 없는데 새 형식의 파일이 있어요"] } : { state: "legacy", manifest, problems: [] }
  if (!(manifest.format >= 2)) return { state: "invalid", manifest, problems: [`모르는 형식이에요: ${manifest.format}`] }
  const problems = REQUIRED.filter((name) => !existsSync(join(folder, name))).map((name) => `필수 파일이 없어요: ${name}`)
  const count = hasFiles ? readdirSync(join(folder, "files")).filter((f) => f.endsWith(".enc")).length : 0
  if (count !== manifest.files) problems.push(`사진 파일 수가 달라요(manifest ${manifest.files} · 폴더 ${count})`)
  if (problems.length) return { state: "invalid", manifest, problems }
  return { state: statusOf(manifest), manifest, problems: [] }
}
// 풀기·복구 전에 하는 완전한 확인: 평문을 디스크에 쓰기 전에, 메모리에서만 한다. 어긋나면 한국어 이유로 던진다.
//  · 형식 2·3: 자료·스키마·목록 필수 → 전부 풀리는지 → (형식 3) 암호문 안에 봉인된 목록의 자료·스키마 지문·상태·시각이 manifest·파일과 같은지
//    → 목록의 사진이 모두 있고 지문이 같은지 → 목록에 없는 사진 파일이 끼어 있지 않은지 → 부분 백업이면 allowPartial 일 때만
//  · 예전 형식: 형식 값이 없고 새 형식 파일도 없을 때만. data.json.enc 는 꼭 있어야 한다.
export function verifyBackup(folder, key, keyId, { allowPartial = false } = {}) {
  if (!existsSync(join(folder, "manifest.json"))) throw new Error("manifest.json이 없어요(끝나지 않은 백업이에요).")
  let manifest
  try { manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) } catch { throw new Error("manifest.json을 읽을 수 없어요.") }
  if (manifest.encryption?.keyId && manifest.encryption.keyId !== keyId) throw new Error(`이 백업은 다른 키(${manifest.encryption.keyId})로 잠겨 있어요. 지금 키: ${keyId}`)
  const encFiles = walk(folder).filter((f) => f.endsWith(".enc"))
  const rel = (f) => relative(folder, f).replace(/\\/g, "/")
  const newShape = existsSync(join(folder, "index.json.enc")) || existsSync(join(folder, "files"))
  if (manifest.format === undefined && newShape) throw new Error("manifest에 형식 값이 없는데 새 형식의 파일이 있어요(manifest가 바뀌었을 수 있어요).")
  if (manifest.format !== undefined && !(manifest.format === 2 || manifest.format === 3)) throw new Error(`모르는 백업 형식이에요: ${manifest.format}`)
  if (manifest.format === undefined) {
    if (!existsSync(join(folder, "data.json.enc"))) throw new Error("필수 파일이 없어요: data.json.enc")
    const files = new Map()
    for (const f of encFiles) { try { files.set(rel(f), decrypt(key, readFileSync(f))) } catch (error) { throw new Error(`${rel(f)}: ${error.message}`) } }
    return { legacy: true, format: 1, status: "legacy", manifest, files }
  }
  for (const name of REQUIRED) if (!existsSync(join(folder, name))) throw new Error(`필수 파일이 없어요: ${name}`)
  const opened = new Map()
  for (const f of encFiles) { try { opened.set(rel(f), decrypt(key, readFileSync(f))) } catch (error) { throw new Error(`${rel(f)}: ${error.message}`) } }
  const data = opened.get("data.json.enc"), schema = opened.get("schema.json.enc")
  let sealed
  try { sealed = JSON.parse(opened.get("index.json.enc").toString()) } catch { throw new Error("목록(index.json.enc)의 내용을 읽을 수 없어요.") }
  let list, status
  if (manifest.format === 3) {
    if (Array.isArray(sealed) || sealed?.format !== 3 || !Array.isArray(sealed.files)) throw new Error("manifest는 형식 3인데 목록은 그 형식이 아니에요.")
    if (sealed.at !== manifest.at) throw new Error("manifest와 목록의 백업 시각이 달라요(다른 백업의 파일이 섞였어요).")
    for (const [name, bytes] of [["data.json.enc", data], ["schema.json.enc", schema]]) {
      const want = sealed.required?.[name]
      if (!want || want.sha256 !== sha256(bytes) || want.bytes !== bytes.length) throw new Error(`${name}의 지문이 목록에 봉인된 값과 달라요.`)
    }
    if (sealed.status !== manifest.status) throw new Error(`manifest의 상태(${manifest.status})와 목록에 봉인된 상태(${sealed.status})가 달라요.`)
    if (sealed.status === "complete" && ((sealed.missing?.length ?? 0) > 0 || photosFailed(sealed.photos))) throw new Error("목록 안의 상태와 받지 못한 사진 기록이 서로 맞지 않아요.")
    list = sealed.files
    status = sealed.status === "complete" && !photosFailed(manifest.photos) ? "complete" : "partial"
  } else {
    if (!Array.isArray(sealed)) throw new Error("manifest는 형식 2인데 목록은 그 형식이 아니에요.")
    list = sealed
    status = statusOf(manifest)
  }
  try { JSON.parse(data.toString()); JSON.parse(schema.toString()) } catch { throw new Error("자료 또는 스키마 파일의 내용을 읽을 수 없어요.") }
  if (manifest.files !== list.length) throw new Error(`manifest의 사진 수(${manifest.files})와 목록의 사진 수(${list.length})가 달라요.`)
  const items = []
  const listed = new Set()
  for (const item of list) {
    const bytes = opened.get(item.file)
    if (!bytes) throw new Error(`목록에 있는 사진 파일이 없어요: ${item.file}`)
    if (sha256(bytes) !== item.sha256) throw new Error(`사진 지문이 달라요: ${item.file}`)
    if (listed.has(item.file)) throw new Error(`목록에 같은 파일이 두 번 있어요: ${item.file}`)
    listed.add(item.file)
    items.push({ bucket: item.bucket, path: item.path, file: item.file, sha256: item.sha256, bytes })
  }
  for (const name of opened.keys()) if (!REQUIRED.includes(name) && !listed.has(name)) throw new Error(`목록에 없는 파일이 끼어 있어요: ${name}`)
  if (status !== "complete" && !allowPartial) throw new Error("부분 백업이에요(사진을 다 받지 못했거나 지문이 달랐어요). 정상 복구 지점으로 쓸 수 없어요. 일부러 열려면 --allow-partial 을 붙여 주세요.")
  return { legacy: false, format: manifest.format, status, manifest, data, schema, items, sealed: manifest.format === 3 ? sealed : null }
}
// 삭제 이력 파일(가장 최근 것부터). 이름의 시각으로 정렬한다.
export function deletionExports(dir) {
  const folder = join(dir, DELETIONS)
  if (!existsSync(folder)) return []
  return readdirSync(folder).filter((f) => /^deletions_.*\.json\.enc$/.test(f) && Number.isFinite(timeOfName(f))).sort((a, b) => timeOfName(b) - timeOfName(a)).map((file) => ({ file, path: join(folder, file), at: timeOfName(file) }))
}
