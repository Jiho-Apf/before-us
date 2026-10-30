// 플라비 수동 백업: 실제 서버의 자료(모든 public 표 + 계정 기본 정보)와 사진 파일을 이 컴퓨터에 내려받는다.
//  - 실행: 코드 폴더에서 `pnpm backup` (또는 `node scripts/backup.mjs`). Supabase CLI 로그인이 되어 있어야 한다.
//  - 저장 위치: 코드 폴더 밖 `비포어스\백업\날짜_시각\` (저장소에 올라가지 않는다).
//  - 개인정보가 들어 있다: 이 컴퓨터에만 두고, 메신저·클라우드로 옮기지 않는다.
//  - 처리방침(백업 최대 30일)에 맞춰 30일이 지난 백업 폴더는 실행할 때 지운다.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const code = join(dirname(fileURLToPath(import.meta.url)), "..")
const root = join(code, "..", "백업")
const CLI = ["--yes", "supabase@2.121.0"]
const KEEP_DAYS = 30
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", "_").replace(/:/g, "").slice(0, 15)
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

// 1) 자료: public 표 전부 + 계정 기본 정보(비밀번호는 원문이 아닌 암호화된 값)
const tables = query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1").map((row) => row.table_name)
const parts = tables.map((name) => `'${name}', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public."${name}" t)`)
parts.push(`'auth.users', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (select id, email, encrypted_password, email_confirmed_at, created_at, updated_at, last_sign_in_at, raw_user_meta_data, banned_until, deleted_at from auth.users) t)`)
const data = query(`select jsonb_build_object(${parts.join(", ")}) as data`)[0].data
const counts = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, rows.length]))
writeFileSync(join(target, "data.json"), JSON.stringify(data))
console.log(`자료 ${tables.length + 1}개 표 저장`)

// 2) 사진 파일: 목록을 받아 한 장씩 내려받는다(한꺼번에 복사하는 명령은 중간에 멈추는 경우가 있어서).
//    로컬 경로는 상대 경로로 넘긴다(C:\ 로 시작하는 경로는 원격 주소로 오해한다).
let photos = { saved: 0, failed: 0 }
function cliIn(cwd, args) {
  return execFileSync(["npx", ...CLI, ...args, "--workdir", code].map(quote).join(" "), { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true, stdio: ["ignore", "pipe", "pipe"], timeout: 120000 })
}
try {
  const listed = JSON.parse(cliIn(target, ["storage", "ls", "-r", "ss:///application-photos", "--linked", "--experimental", "--output-format", "json"]).replace(/^[^{]*/, "")).paths ?? []
  const files = listed.filter((path) => /\.(jpe?g|png|webp)$/i.test(path))
  for (const remote of files) {
    const local = ["photos", ...remote.replace(/^\/application-photos\//, "").split("/")].join("/")
    mkdirSync(join(target, dirname(local)), { recursive: true })
    try { cliIn(target, ["storage", "cp", `ss://${remote}`, `./${local}`, "--linked", "--experimental"]); photos.saved++ } catch { photos.failed++ }
  }
} catch (error) {
  photos = { ...photos, error: String(error.stderr || error.message).split(/\r?\n/)[0].slice(0, 200) }
}
console.log(`사진 파일 저장 ${photos.saved}장${photos.failed ? ` · 실패 ${photos.failed}장` : ""}`)

writeFileSync(join(target, "manifest.json"), JSON.stringify({ at: new Date().toISOString(), project: "mmrqcefipllmcqztksqm", counts, photos }, null, 2))

// 3) 30일 지난 백업 지우기
for (const name of readdirSync(root)) {
  const folder = join(root, name)
  if (folder !== target && existsSync(folder) && statSync(folder).isDirectory() && Date.now() - statSync(folder).mtimeMs > KEEP_DAYS * 86400000) {
    rmSync(folder, { recursive: true, force: true })
    console.log(`30일 지난 백업 삭제 · ${name}`)
  }
}
console.log("백업 끝", counts)
