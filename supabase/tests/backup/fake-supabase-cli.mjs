// 백업 시험용 가짜 Supabase CLI(실제 서버에 닿지 않는다). scripts/backup*.mjs 가 FLAVIE_BACKUP_FAKE_CLI 로 이 파일을 부른다.
//  - db query: 표 목록 / 가짜 자료(가짜 회원 한 명) / 스키마 지문 / 삭제 이력 / 백업 결과 기록
//      FAKE_SQL_URL 이 있으면 SQL을 그 주소(시험 프로세스 안의 PGlite)로 보내 실제로 실행한 결과를 돌려준다(재해 복구 리허설).
//  - storage ls: 버킷마다 가짜 사진 두 장(또는 FAKE_SQL_URL 의 /storage/list)
//  - storage cp ss://… <대상>: 대상이 이름 있는 파이프(\\.\pipe\…)면 진짜 CLI처럼 그 파이프에 바이트를 쓴다(디스크 파일 아님).
//      FAKE_CP_MODE=mid   : 절반만 쓰고 멈춤(받는 도중 강제 종료 시험)
//      FAKE_CP_MODE=after : 다 쓰고 파이프를 닫은 뒤 끝나지 않고 멈춤(받은 직후 강제 종료 시험)
//      FAKE_CP_MODE=fail  : 오류로 끝남(종료 코드 1)
//      FAKE_MARKER        : 멈출 때 남기는 표시 파일
//  - FAKE_REPORT_LOG: record_backup_run 호출을 이 파일에 한 줄씩 남긴다(서버 기록 흉내)
import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import net from "node:net"

const args = process.argv.slice(2)
const out = (value) => process.stdout.write(`가짜 CLI\n${JSON.stringify(value)}`)
const hang = () => { const until = Date.now() + 60000; while (Date.now() < until) { /* 시험이 이 사이에 강제로 끈다 */ } }
const url = process.env.FAKE_SQL_URL
async function remote(path, body) {
  const res = await fetch(url + path, { method: "POST", body })
  if (!res.ok) { process.stderr.write(await res.text()); process.exit(1) }
  return res
}
const photoBytes = (name) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`PLAINTEXT-PHOTO ${name} `), Buffer.alloc(4096, 0x41)])

if (args[0] === "db" && args[1] === "query") {
  const sql = readFileSync(args[args.indexOf("-f") + 1], "utf8")
  if (url) { out(await (await remote("/sql", sql)).json()) }
  else if (sql.includes("record_backup_run")) {
    if (process.env.FAKE_REPORT_LOG) appendFileSync(process.env.FAKE_REPORT_LOG, sql.replace(/\s+/g, " ") + "\n")
    if (process.env.FAKE_REPORT_FAIL) { process.stderr.write("가짜 CLI: 서버에 연결하지 못했어요"); process.exit(1) }
    out({ rows: [{ done: null }] })
  }
  else if (sql.includes("information_schema.tables")) out({ rows: [{ table_name: "profiles" }, { table_name: "notifications" }, { table_name: "application_photos" }] })
  else if (sql.includes("supabase_migrations")) out({ rows: [{ schema: { migrations: ["20261106006500"], functions: [], rls: [], buckets: [] } }] })
  else if (sql.includes("deletion_log")) out({ rows: [{ rows: [{ member_id: "00000000-0000-4000-8000-00000000f0de", deleted_at: "2026-11-01T00:00:00Z" }] }] })
  else out({ rows: [{ data: { profiles: [{ id: "00000000-0000-4000-8000-00000000f001", email: "fake-member@example.test" }], notifications: [], application_photos: [], "auth.users": [{ id: "00000000-0000-4000-8000-00000000f001", email: "fake-member@example.test" }] } }] })
} else if (args[0] === "storage" && args[1] === "ls") {
  const bucket = args.find((a) => a.startsWith("ss:///")).slice(6)
  if (url) out(await (await remote("/storage/list", bucket)).json())
  else out({ paths: [`/${bucket}/u1/a.jpg`, `/${bucket}/u1/b.jpg`] })
} else if (args[0] === "storage" && args[1] === "cp") {
  const source = args[2].replace(/^ss:\/\//, ""), target = args[3]
  const bytes = url ? Buffer.from(await (await remote("/storage/object", source)).arrayBuffer()) : photoBytes(source)
  const mode = process.env.FAKE_CP_MODE
  if (mode === "fail") { process.stderr.write("가짜 CLI: 내려받기 실패"); process.exit(1) }
  const marker = process.env.FAKE_MARKER
  const markOnce = (stage) => { if (marker && !existsSync(marker)) writeFileSync(marker, JSON.stringify({ stage, source })) }
  if (!target.startsWith("\\\\.\\pipe\\")) { process.stderr.write("가짜 CLI: 이 시험의 백업은 파이프로만 받아요"); process.exit(1) }
  await new Promise((resolve, reject) => {
    const socket = net.connect(target, () => {
      if (mode === "mid" && source.endsWith("b.jpg")) { socket.write(bytes.subarray(0, bytes.length >> 1), () => { markOnce("mid"); hang() }); return }
      socket.end(bytes, () => resolve())
    })
    socket.on("error", reject)
  })
  if (mode === "after" && source.endsWith("b.jpg")) { markOnce("after"); hang() }
} else {
  process.stderr.write(`가짜 CLI: 모르는 명령 ${args.join(" ")}`)
  process.exit(1)
}
