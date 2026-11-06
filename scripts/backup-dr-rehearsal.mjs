// 재해 복구 리허설(GPT 3차 검수 R3-04): `npm run backup:dr-rehearsal` — 가짜 자료 · 내 컴퓨터 안 Postgres(PGlite) · 임시 폴더만.
// ‘원본 DB와 이 컴퓨터를 함께 잃었다’고 가정하고, 바깥 사본의 암호문 + 최신 삭제 이력 + 키(비밀번호 관리자)만으로 새 환경에 되살린다.
//  1. 원본(가짜): 회원 A·B·X, 신청서·사진(두 버킷)·알림. 실제 백업 도구(scripts/backup.mjs)를 가짜 CLI로 돌린다(SQL은 이 원본 DB에서 실제 실행).
//  2. 백업 뒤 X 탈퇴 → 삭제 이력 내보내기(backup-deletions) → 바깥 사본(backup-offsite).
//  3. 재해: 원본 DB를 닫고 이 컴퓨터의 백업 폴더를 지운다. 남는 것은 바깥 사본 폴더와 키뿐.
//  4. 새 환경: 저장소의 마이그레이션(GitHub)으로 스키마 → 복구 환경 스위치(메일 내보내기 멈춤) → 인증 관계(auth.users) → 표 → 두 버킷 파일(메모리에서 바로)
//     → 최신 삭제 이력 적용(apply_deletion_log) → 사진 정리 → 스키마 지문(마이그레이션·함수 권한·RLS·버킷) 비교.
//  5. 확인: X와 X의 사진이 되살아나지 않음 · A·B 자료와 사진 바이트 일치 · 백업 안의 오래된 삭제 이력만 쓰면 X가 되살아남(대조) · 메일·예약 작업 차단.
//  실제 Supabase 새 프로젝트로의 복구는 같은 순서를 대표용 안내(문서)의 명령으로 한다. 이 리허설은 실제 서버·실제 Storage API에 닿지 않는다.
import { PGlite } from "@electric-sql/pglite"
import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"

const KEY = randomBytes(32).toString("hex") // 리허설 전용 키(실제 키는 쓰지 않는다)
process.env.FLAVIE_BACKUP_KEY = KEY
const { decrypt, loadKey } = await import("./backup-crypto.mjs")
const { key } = loadKey()
const code = join(dirname(fileURLToPath(import.meta.url)), "..")
const sha = (b) => createHash("sha256").update(b).digest("hex")
let passed = 0
const ok = (label, value) => { assert.ok(value, label); passed++; console.log("✓", label) }
const setup = readFileSync(join(code, "supabase/tests/db.test.mjs"), "utf8").match(/await db\.exec\(`([\s\S]*?)`\)/)[1]
const migrationFiles = readdirSync(join(code, "supabase/migrations")).sort().filter((f) => !f.includes("schedules"))
async function fresh() {
  const db = new PGlite()
  await db.exec(setup)
  // 실제 Supabase auth.users 의 칸(백업이 읽는 것) 흉내
  await db.exec("alter table auth.users add column encrypted_password text, add column updated_at timestamptz, add column last_sign_in_at timestamptz, add column banned_until timestamptz, add column deleted_at timestamptz")
  for (const file of migrationFiles) await db.exec(readFileSync(join(code, "supabase/migrations", file), "utf8"))
  // Supabase가 적용 이력을 남기는 표 흉내(스키마 지문 비교용)
  await db.exec("create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key)")
  for (const file of migrationFiles) await db.query("insert into supabase_migrations.schema_migrations values ($1)", [file.slice(0, 14)])
  return db
}
const work = mkdtempSync(join(tmpdir(), "flavie-dr-"))
const local = join(work, "이 컴퓨터 백업"), offsite = join(work, "바깥 사본(클라우드 폴더)")
try {
  // ── 1. 원본(가짜)
  const live = await fresh()
  const storage = new Map() // `${bucket}/${path}` → 바이트(원본 Storage 흉내 · 메모리)
  const meta = { adult: true, terms_version: "dr", privacy_version: "dr" }
  const user = async (email) => (await live.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, meta])).rows[0].id
  const [A, B, X] = [await user("a@dr.test"), await user("b@dr.test"), await user("x@dr.test")]
  for (const [m, name] of [[A, "가윤"], [B, "나준"], [X, "다온"]]) {
    await live.query("insert into public.applications (member_id, draft, status) values ($1, $2, 'submitted')", [m, { values: { "self.name": name, "self.bio": `${name}의 가짜 소개예요.` } }])
    for (const slot of ["photo.face", "photo.upper"]) {
      const path = `${m}/${slot}-dr.jpg`, bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2048)])
      storage.set(`application-photos/${path}`, bytes)
      await live.query("insert into storage.objects (bucket_id, name, owner) values ('application-photos', $1, $2)", [path, m])
      await live.query("insert into public.application_photos (member_id, slot, path, mime, bytes, width, height, sha256, recent_confirmed, rights_confirmed) values ($1, $2, $3, 'image/jpeg', $4, 800, 1000, $5, true, true)", [m, slot, path, bytes.length, sha(bytes)])
    }
  }
  const prog = "11111111-1111-4111-8111-111111111111"
  for (const m of [A, X]) { const p = `${prog}/${m}/day1-dr000001.jpg`, b = randomBytes(1500); storage.set(`letter-photos/${p}`, b); await live.query("insert into storage.objects (bucket_id, name, owner) values ('letter-photos', $1, $2)", [p, m]) }
  await live.query("insert into public.notifications (member_id, kind, title, body, link, dedupe_key) values ($1, 'test', '가짜 알림', '복구 리허설', '/today', 'dr:a')", [A])
  // 가짜 CLI가 이 원본 DB·저장소를 쓰게 하는 작은 주소(이 프로세스 안)
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", async () => {
      const body = Buffer.concat(chunks).toString()
      try {
        if (req.url === "/sql") { const r = await live.query(body); res.end(JSON.stringify({ rows: r.rows })); return }
        if (req.url === "/storage/list") { res.end(JSON.stringify({ paths: [...storage.keys()].filter((k) => k.startsWith(`${body}/`)).map((k) => `/${k}`) })); return }
        if (req.url === "/storage/object") { const b = storage.get(body.replace(/^\//, "")); if (!b) { res.statusCode = 404; res.end("없음"); return } res.end(b); return }
        res.statusCode = 404; res.end()
      } catch (error) { res.statusCode = 500; res.end(String(error.message)) }
    })
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const env = { ...process.env, FLAVIE_BACKUP_KEY: KEY, FLAVIE_BACKUP_ROOT: local, FLAVIE_OFFSITE_DIR: offsite, FLAVIE_BACKUP_FAKE_CLI: join(code, "supabase/tests/backup/fake-supabase-cli.mjs"), FAKE_SQL_URL: `http://127.0.0.1:${server.address().port}`, FLAVIE_BACKUP_WARN_DIR: join(work, "안내"), FLAVIE_BACKUP_REPORT: "0" }
  const run = async (script) => {
    // 원본 DB가 이 프로세스 안에 있어, 자식이 끝날 때까지 이벤트를 돌리며 기다린다(spawnSync는 쓸 수 없음)
    const { spawn } = await import("node:child_process")
    return new Promise((resolve) => { const c = spawn(process.execPath, [join(code, "scripts", script)], { env, cwd: code, stdio: ["ignore", "pipe", "pipe"] }); let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d)); c.on("exit", (status) => resolve({ status, out })) })
  }
  const b1 = await run("backup.mjs")
  if (b1.status !== 0) console.log(b1.out.slice(-1500))
  ok("1. 원본 백업(실제 백업 도구 · 가짜 CLI · 원본 DB에서 SQL 실행)", b1.status === 0 && /백업 끝/.test(b1.out))

  // ── 2. 백업 뒤 X 탈퇴 → 삭제 이력 내보내기 → 바깥 사본
  await live.query("update public.profiles set status = 'withdrawal_requested', deletion_due_at = now() - interval '1 minute' where id = $1", [X])
  await live.query("select public.run_withdrawal_deletion()")
  ok("2. 백업 뒤 X 계정이 지워지고 삭제 이력이 남는다", (await live.query("select count(*)::int n from public.deletion_log where member_id = $1", [X])).rows[0].n === 1)
  await new Promise((r) => setTimeout(r, 1100)) // 삭제 이력 파일 이름(초 단위)이 백업 폴더와 다르게
  ok("2. 삭제 이력 내보내기(암호화 · 바깥 사본에도)", (await run("backup-deletions.mjs")).status === 0)
  ok("2. 바깥 사본 복사(지문 확인)", (await run("backup-offsite.mjs")).status === 0)
  server.close()

  // ── 3. 재해: 원본 DB·이 컴퓨터를 잃음
  await live.close()
  rmSync(local, { recursive: true, force: true })
  storage.clear()
  ok("3. 남은 것은 바깥 사본 폴더뿐(평문 0개)", !existsSync(local) && existsSync(offsite) && walkPlain(offsite).length === 0)

  // ── 4. 새 환경에 복구
  const target = await fresh()
  const newStorage = new Map()
  const folder = readdirSync(offsite).filter((n) => /^\d{4}-/.test(n) && existsSync(join(offsite, n, "manifest.json"))).sort().at(-1)
  const manifest = JSON.parse(readFileSync(join(offsite, folder, "manifest.json"), "utf8"))
  assert.equal(manifest.encryption.keyId, loadKey().keyId)
  const open = (rel) => decrypt(key, readFileSync(join(offsite, folder, rel)))
  const data = JSON.parse(open("data.json.enc").toString()), schema = JSON.parse(open("schema.json.enc").toString()), index = JSON.parse(open("index.json.enc").toString())
  // 4-1 스키마: 백업 때 적용돼 있던 마이그레이션이 새 환경에 모두 있는지(새 환경은 저장소의 마이그레이션으로 만든다)
  const restoredVersions = (await target.query("select version from supabase_migrations.schema_migrations")).rows.map((r) => r.version)
  ok("4-1. 스키마: 백업 때의 마이그레이션이 새 환경에 모두 적용돼 있다", schema.migrations.every((v) => restoredVersions.includes(v)))
  // 4-2 복구 환경 스위치(메일 내보내기 멈춤) — 자료를 넣은 뒤에도 켜져 있어야 하므로 마지막에 다시 확인
  await target.exec("set session_replication_role = replica")
  await target.query("insert into auth.users select * from jsonb_populate_recordset(null::auth.users, $1)", [JSON.stringify(data["auth.users"])])
  for (const [name, rows] of Object.entries(data)) {
    if (name === "auth.users" || !rows.length) continue
    const cols = (await target.query("select string_agg(quote_ident(column_name), ', ' order by ordinal_position) c from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'", [name])).rows[0].c
    await target.query(`delete from public."${name}"`)
    await target.query(`insert into public."${name}" (${cols}) overriding system value select ${cols} from jsonb_populate_recordset(null::public."${name}", $1)`, [JSON.stringify(rows)])
  }
  await target.exec("set session_replication_role = origin")
  await target.query("insert into public.private_values (name, value) values ('outbound_paused', 'true') on conflict (name) do update set value = 'true'")
  ok("4-2. 인증 관계: 계정·프로필·신청서가 같은 번호로 이어진다", (await target.query("select count(*)::int n from public.profiles p join auth.users u on u.id = p.id join public.applications a on a.member_id = p.id where p.id = any($1)", [[A, B]])).rows[0].n === 2)
  // 4-3 두 버킷: 파일을 메모리에서 바로 새 저장소로(실제로는 CLI가 이름 있는 파이프에서 읽어 올림 · Supabase CLI 2.121.0으로 확인)
  for (const item of index) {
    const bytes = open(item.file)
    assert.equal(sha(bytes), item.sha256)
    newStorage.set(`${item.bucket}/${item.path}`, bytes)
    await target.query("insert into storage.objects (bucket_id, name) values ($1, $2) on conflict do nothing", [item.bucket, item.path])
  }
  ok("4-3. 두 버킷 파일이 모두 돌아온다(신청 사진·편지 사진 · 지문 일치)", index.some((i) => i.bucket === "application-photos") && index.some((i) => i.bucket === "letter-photos") && newStorage.size === index.length)
  // 대조: 백업 안의 deletion_log 는 백업 ‘그때까지’의 기록이라 X가 없다 → 그것만 적용하면 X가 되살아난다
  ok("대조: 백업 안의 오래된 삭제 기록에는 X가 없다(이것만 쓰면 X가 되살아남)", !(data.deletion_log ?? []).some((r) => r.member_id === X) && (await target.query("select count(*)::int n from auth.users where id = $1", [X])).rows[0].n === 1)
  // 4-4 최신 삭제 이력(바깥 사본의 가장 최근 파일) 적용
  const exports = readdirSync(join(offsite, "삭제 이력")).filter((f) => f.endsWith(".enc")).sort()
  const latest = JSON.parse(decrypt(key, readFileSync(join(offsite, "삭제 이력", exports.at(-1)))).toString())
  ok("4-4. 최신 삭제 이력 파일은 백업보다 나중이고 X가 들어 있다", Date.parse(latest.exportedAt) > Date.parse(manifest.at) && latest.rows.some((r) => r.member_id === X))
  await target.query("insert into public.deletion_log (member_id, deleted_at) select member_id, deleted_at from jsonb_populate_recordset(null::public.deletion_log, $1) on conflict (member_id) do nothing", [JSON.stringify(latest.rows)])
  const removed = (await target.query("select public.apply_deletion_log() n")).rows[0].n
  // 사진 정리 함수 흉내: 대기열에서 쓰이지 않는 파일을 선점 → 지움 → 정리(실제로는 storage-cleanup 함수를 한 번 부른다)
  const gone = []
  for (const bucket of ["application-photos", "letter-photos"]) {
    await target.exec("set role service_role")
    const listed = (await target.query("select path from public.storage_cleanup_batch(5000) where bucket = $1", [bucket])).rows.map((r) => r.path)
    const claim = (await target.query("select public.storage_cleanup_claim($1, $2) v", [bucket, listed])).rows[0].v
    await target.exec("reset role")
    for (const p of claim.paths) { newStorage.delete(`${bucket}/${p}`); gone.push([bucket, p]) }
    await target.query("delete from storage.objects where bucket_id = $1 and name = any($2)", [bucket, claim.paths]) // Storage API 삭제 흉내
    await target.exec("set role service_role")
    await target.query("select public.storage_cleanup_finish($1, $2, $3)", [bucket, claim.paths, claim.claim])
    await target.exec("reset role")
  }
  // ── 5. 확인
  ok("5. 최신 삭제 이력을 적용하면 X 계정이 다시 지워진다", removed === 1 && (await target.query("select count(*)::int n from auth.users where id = $1", [X])).rows[0].n === 0)
  ok("5. X의 프로필·신청서·사진 행이 되살아나지 않는다", (await target.query("select (select count(*) from public.profiles where id = $1) + (select count(*) from public.applications where member_id = $1) + (select count(*) from public.application_photos where member_id = $1) n", [X])).rows[0].n === 0)
  ok("5. X의 사진 파일(두 버킷)이 새 저장소에 남지 않는다", ![...newStorage.keys()].some((k) => k.includes(X)))
  const photos = (await target.query("select path, sha256 from public.application_photos where member_id = any($1)", [[A, B]])).rows
  ok("5. A·B의 신청 사진 행과 파일 바이트가 일치한다", photos.length === 4 && photos.every((p) => newStorage.has(`application-photos/${p.path}`) && sha(newStorage.get(`application-photos/${p.path}`)) === p.sha256))
  ok("5. A의 편지 사진·알림도 그대로다", newStorage.has(`letter-photos/${prog}/${A}/day1-dr000001.jpg`) && (await target.query("select count(*)::int n from public.notifications where member_id = $1", [A])).rows[0].n === 1)
  // 권한·RLS·버킷 지문 비교(백업 때와 같은가)
  const now = (await target.query(`select jsonb_build_object(
    'functions', (select coalesce(jsonb_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || p.prosecdef || '|' || coalesce(array_to_string(p.proacl, ','), '') order by 1), '[]'::jsonb) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
    'rls', (select coalesce(jsonb_agg(c.relname || '|' || c.relrowsecurity order by 1), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'),
    'buckets', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public, 'limit', file_size_limit, 'mime', allowed_mime_types) order by id), '[]'::jsonb) from storage.buckets)) v`)).rows[0].v
  ok("5. 함수 권한(실행 권한·서버 권한 여부) 지문이 백업 때와 같다", JSON.stringify(now.functions) === JSON.stringify(schema.functions))
  ok("5. 표 RLS 지문과 두 버킷 설정(비공개·크기·형식)이 백업 때와 같다", JSON.stringify(now.rls) === JSON.stringify(schema.rls) && JSON.stringify(now.buckets) === JSON.stringify(schema.buckets))
  // 메일·예약 작업 차단
  await target.query("select public.notify($1, 'new-introduction', '오늘의 인연이 도착했어요', '복구 환경', '/us', 'dr:mail')", [A])
  await target.exec("set role service_role")
  const claimed = (await target.query("select count(*)::int n from public.claim_email_notifications(500)")).rows[0].n
  await target.exec("reset role")
  ok("5. 복구 환경에서는 메일을 하나도 잡지 않는다(outbound_paused)", claimed === 0)
  ok("5. 복구 환경에는 예약 작업(pg_cron)이 없다(일정 마이그레이션을 올리지 않음 · 실제 Supabase에서는 안내 문서의 unschedule 단계)", (await target.query("select to_regclass('cron.job') r")).rows[0].r === null)
  ok("5. 이 리허설 동안 디스크에 평문이 생기지 않았다(바깥 사본·작업 폴더 검사)", walkPlain(work).length === 0)
  await target.close()
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`재해 복구 리허설 통과: ${passed}개 — 바깥 사본 암호문 + 최신 삭제 이력 + 키만으로 복구 · 탈퇴자와 그 사진은 되살아나지 않음`)

function walkPlain(dir) {
  const walk = (d) => { try { return readdirSync(d).flatMap((n) => { const p = join(d, n); try { return statSync(p).isDirectory() ? walk(p) : [p] } catch { return [] } }) } catch { return [] } }
  return walk(dir).filter((f) => { try { const b = readFileSync(f); return (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || b.includes("@dr.test") || b.includes("가짜 소개") } catch { return false } })
}
