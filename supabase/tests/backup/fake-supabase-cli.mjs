// 백업 시험용 가짜 Supabase CLI(실제 서버에 닿지 않는다). scripts/backup.mjs 가 FLAVIE_BACKUP_FAKE_CLI 로 이 파일을 부른다.
//  - db query: 표 목록 / 가짜 자료(가짜 회원 한 명)
//  - storage ls: 버킷마다 가짜 사진 두 장
//  - storage cp: 가짜 사진(평문 표시 문자열 포함)을 쓴다. FAKE_SLOW_CP=1 이면 두 번째 사진을 쓴 뒤 표시 파일을 남기고 오래 멈춘다(시험이 이때 강제 종료).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"

const args = process.argv.slice(2)
const out = (value) => process.stdout.write(`가짜 CLI\n${JSON.stringify(value)}`)
if (args[0] === "db" && args[1] === "query") {
  const sql = readFileSync(args[args.indexOf("-f") + 1], "utf8")
  if (sql.includes("information_schema.tables")) out({ rows: [{ table_name: "profiles" }, { table_name: "notifications" }] })
  else out({ rows: [{ data: { profiles: [{ id: "00000000-0000-4000-8000-00000000f001", email: "fake-member@example.test" }], notifications: [], "auth.users": [{ id: "00000000-0000-4000-8000-00000000f001", email: "fake-member@example.test" }] } }] })
} else if (args[0] === "storage" && args[1] === "ls") {
  const bucket = args.find((a) => a.startsWith("ss:///")).slice(6)
  out({ paths: [`/${bucket}/u1/a.jpg`, `/${bucket}/u1/b.jpg`] })
} else if (args[0] === "storage" && args[1] === "cp") {
  const local = args[3]
  mkdirSync(dirname(local), { recursive: true })
  writeFileSync(local, Buffer.from(`PLAINTEXT-PHOTO ${args[2]}`))
  const marker = process.env.FAKE_MARKER
  if (process.env.FAKE_SLOW_CP && marker && local.includes("b.jpg") && !existsSync(marker)) {
    writeFileSync(marker, join(process.cwd(), local))
    const until = Date.now() + 30000
    while (Date.now() < until) { /* 시험이 이 사이에 백업 과정을 강제로 끈다 */ }
  }
} else {
  process.stderr.write(`가짜 CLI: 모르는 명령 ${args.join(" ")}`)
  process.exit(1)
}
