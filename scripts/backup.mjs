// 플라비 수동 백업: 실제 서버의 자료(모든 public 표 + 계정 기본 정보)와 사진 파일(신청 사진·편지 사진)을 이 컴퓨터에 내려받는다.
//  - 실행: 코드 폴더에서 `pnpm backup` (또는 `node scripts/backup.mjs`). Supabase CLI 로그인이 되어 있어야 한다.
//  - 저장 위치: 코드 폴더 밖 `비포어스\백업\날짜_시각\` (저장소에 올라가지 않는다).
//  - 모든 파일은 내려받는 즉시 암호화한다(scripts/backup-crypto.mjs · 키는 백업 폴더와 따로). 평문은 디스크에 남기지 않는다.
//  - 처리방침(백업 최대 30일): 백업마다 만든 시각·만료 시각을 manifest에 적고, 실행하자마자(이번 백업이 실패하더라도)
//    만료된 백업부터 지운다. 예전에 평문으로 남은 백업이 있으면 이때 함께 암호화한다.
//  - 복구: `node scripts/backup-open.mjs <백업 폴더> <풀어 둘 폴더>`로 푼 뒤, 자료를 넣고 반드시
//    `select public.apply_deletion_log();`를 실행한다(백업 뒤 탈퇴·삭제된 계정이 되살아나지 않게).
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { encrypt, KEY_FILE, loadKey } from "./backup-crypto.mjs"

const code = join(dirname(fileURLToPath(import.meta.url)), "..")
const root = join(code, "..", "백업")
const CLI = ["--yes", "supabase@2.121.0"]
const KEEP_DAYS = 30
const BUCKETS = ["application-photos", "letter-photos"]
const now = new Date()
const stamp = now.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", "_").replace(/:/g, "").slice(0, 15)
const { key, keyId, created } = loadKey({ create: true })
if (created) console.log(`새 백업 키를 만들었어요 · ${KEY_FILE}\n  이 키를 비밀번호 관리자에도 꼭 보관해 주세요. 키가 없으면 백업을 풀 수 없어요.`)

// 0) 만료된 백업 먼저 지우기 · 남은 평문 백업 암호화
const folderTime = (name) => { const m = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}+09:00`) : NaN }
function walk(dir) { return readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path] }) }
function seal(file) { writeFileSync(`${file}.enc`, encrypt(key, readFileSync(file))); rmSync(file, { force: true }) }
mkdirSync(root, { recursive: true })
for (const name of readdirSync(root)) {
  const folder = join(root, name)
  if (!statSync(folder).isDirectory()) continue
  let manifest = null
  try { manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) } catch { /* 예전 백업 */ }
  const expires = manifest?.expiresAt ? Date.parse(manifest.expiresAt) : (Number.isFinite(folderTime(name)) ? folderTime(name) : statSync(folder).mtimeMs) + KEEP_DAYS * 86400000
  if (Date.now() >= expires) { rmSync(folder, { recursive: true, force: true }); console.log(`만료된 백업 삭제 · ${name}`); continue }
  if (!manifest?.encryption) {
    const plain = walk(folder).filter((file) => !file.endsWith(".enc") && !file.endsWith("manifest.json"))
    plain.forEach(seal)
    writeFileSync(join(folder, "manifest.json"), JSON.stringify({ ...(manifest ?? {}), expiresAt: new Date(expires).toISOString(), encryption: { alg: "aes-256-gcm", keyId, sealedLater: true } }, null, 2))
    if (plain.length) console.log(`예전 백업 암호화 · ${name} (${plain.length}개 파일)`)
  }
}

const target = join(root, stamp)
mkdirSync(target, { recursive: true })

// Windows에서는 npx가 .cmd라 셸로 실행한다. 공백·한글이 있는 경로는 따옴표로 감싸고, SQL은 파일로 넘긴다.
const quote = (value) => (/^[\w./:=-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`)
function cli(args) {
  return execFileSync(["npx", ...CLI, ...args].map(quote).join(" "), { cwd: code, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, shell: true, stdio: ["ignore", "pipe", "pipe"] })
}
let step = 0
function query(sql) {
  const file = join(target, `query-${++step}.sql`)
  writeFileSync(file, sql)
  try {
    const out = cli(["db", "query", "--linked", "--output-format", "json", "-f", file])
    return JSON.parse(out.slice(out.indexOf("{"))).rows
  } finally {
    rmSync(file, { force: true })
  }
}

console.log(`백업 시작 · ${target}`)

// 1) 자료: public 표 전부 + 계정 기본 정보(비밀번호는 원문이 아닌 암호화된 값). 받자마자 암호화해 저장한다.
const tables = query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1").map((row) => row.table_name)
const parts = tables.map((name) => `'${name}', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public."${name}" t)`)
parts.push(`'auth.users', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (select id, email, encrypted_password, email_confirmed_at, created_at, updated_at, last_sign_in_at, raw_user_meta_data, banned_until, deleted_at from auth.users) t)`)
const data = query(`select jsonb_build_object(${parts.join(", ")}) as data`)[0].data
const counts = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, rows.length]))
writeFileSync(join(target, "data.json.enc"), encrypt(key, Buffer.from(JSON.stringify(data))))
console.log(`자료 ${tables.length + 1}개 표 저장(암호화)`)

// 2) 사진 파일: 버킷마다 목록을 받아 한 장씩 내려받고 바로 암호화한다(한꺼번에 복사하는 명령은 중간에 멈추는 경우가 있어서).
//    로컬 경로는 상대 경로로 넘긴다(C:\ 로 시작하는 경로는 원격 주소로 오해한다).
function cliIn(cwd, args) {
  return execFileSync(["npx", ...CLI, ...args, "--workdir", code].map(quote).join(" "), { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true, stdio: ["ignore", "pipe", "pipe"], timeout: 120000 })
}
const photos = {}
for (const bucket of BUCKETS) {
  const result = { saved: 0, failed: 0 }
  try {
    const listed = JSON.parse(cliIn(target, ["storage", "ls", "-r", `ss:///${bucket}`, "--linked", "--experimental", "--output-format", "json"]).replace(/^[^{]*/, "")).paths ?? []
    const files = listed.filter((path) => /\.(jpe?g|png|webp)$/i.test(path))
    for (const remote of files) {
      const local = [bucket, ...remote.replace(new RegExp(`^/${bucket}/`), "").split("/")].join("/")
      mkdirSync(join(target, dirname(local)), { recursive: true })
      try { cliIn(target, ["storage", "cp", `ss://${remote}`, `./${local}`, "--linked", "--experimental"]); seal(join(target, local)); result.saved++ } catch { rmSync(join(target, local), { force: true }); result.failed++ }
    }
  } catch (error) {
    result.error = String(error.stderr || error.message).split(/\r?\n/)[0].slice(0, 200)
  }
  photos[bucket] = result
  console.log(`${bucket} 저장 ${result.saved}장${result.failed ? ` · 실패 ${result.failed}장` : ""}${result.error ? ` · ${result.error}` : ""}`)
}

// 평문이 남지 않았는지 마지막으로 확인한다.
const leftover = walk(target).filter((file) => !file.endsWith(".enc"))
if (leftover.length) { leftover.forEach(seal); console.log(`남은 평문 ${leftover.length}개를 암호화했어요: ${leftover.map((file) => relative(target, file)).join(", ")}`) }

writeFileSync(join(target, "manifest.json"), JSON.stringify({
  at: now.toISOString(), expiresAt: new Date(now.getTime() + KEEP_DAYS * 86400000).toISOString(), project: "mmrqcefipllmcqztksqm",
  counts, photos, encryption: { alg: "aes-256-gcm", keyId }, restore: "node scripts/backup-open.mjs → 자료 넣기 → select public.apply_deletion_log();",
}, null, 2))
console.log("백업 끝", counts)
if (!existsSync(KEY_FILE) && !process.env.FLAVIE_BACKUP_KEY) console.log("키 파일을 찾을 수 없어요. 키를 따로 보관했는지 확인해 주세요.")
