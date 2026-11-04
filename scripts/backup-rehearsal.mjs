// 백업 복구 리허설(가짜 자료 · 내 컴퓨터 안 Postgres): `node scripts/backup-rehearsal.mjs`
// 실제 서버에는 닿지 않는다. 운영 백업과 같은 형식(표 전부 + 계정 기본 정보 → 암호화)으로 만들고, 빈 DB에 복구해 확인한다.
//  1. 가짜 회원 셋(한 명은 탈퇴 예정)과 신청서·알림을 만든 뒤 백업 1을 뜬다.
//  2. 탈퇴 회원을 보존 정리로 지운다(삭제 기록이 남는다) → 백업 2를 뜬다.
//  3. 새 DB에 백업 1을 복구하고, 백업 2의 삭제 기록을 옮긴 뒤 apply_deletion_log()를 실행한다.
//  4. 탈퇴한 회원은 되살아나지 않고, 나머지 자료와 사진은 그대로인지 본다.
import { PGlite } from "@electric-sql/pglite"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomBytes } from "node:crypto"
import assert from "node:assert/strict"

process.env.FLAVIE_BACKUP_KEY = randomBytes(32).toString("hex") // 리허설 전용 키(실제 키는 쓰지 않는다)
const { decrypt, encrypt, loadKey } = await import("./backup-crypto.mjs")
const { key } = loadKey()
const code = join(dirname(fileURLToPath(import.meta.url)), "..")
const setup = readFileSync(join(code, "supabase/tests/db.test.mjs"), "utf8").match(/await db\.exec\(`([\s\S]*?)`\)/)[1]
async function fresh() {
  const db = new PGlite()
  await db.exec(setup)
  for (const file of readdirSync(join(code, "supabase/migrations")).sort()) if (!file.includes("schedules")) await db.exec(readFileSync(join(code, "supabase/migrations", file), "utf8"))
  return db
}
async function dump(db) {
  const tables = (await db.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")).rows.map((row) => row.table_name)
  const data = {}
  for (const name of tables) data[name] = (await db.query(`select coalesce(jsonb_agg(t), '[]'::jsonb) v from public."${name}" t`)).rows[0].v
  data["auth.users"] = (await db.query("select coalesce(jsonb_agg(t), '[]'::jsonb) v from (select id, email, raw_user_meta_data, created_at, email_confirmed_at from auth.users) t")).rows[0].v
  return data
}
async function restore(db, data) {
  await db.exec("set session_replication_role = replica")
  const users = data["auth.users"]
  await db.query("insert into auth.users select * from jsonb_populate_recordset(null::auth.users, $1)", [JSON.stringify(users)])
  for (const [name, rows] of Object.entries(data)) {
    if (name === "auth.users" || !rows.length) continue
    const cols = (await db.query("select string_agg(quote_ident(column_name), ', ' order by ordinal_position) c from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'", [name])).rows[0].c
    await db.query(`delete from public."${name}"`)
    await db.query(`insert into public."${name}" (${cols}) overriding system value select ${cols} from jsonb_populate_recordset(null::public."${name}", $1)`, [JSON.stringify(rows)])
  }
  await db.exec("set session_replication_role = origin")
}
const seal = (data) => encrypt(key, Buffer.from(JSON.stringify(data)))
const open = (sealed) => JSON.parse(decrypt(key, sealed).toString())

const live = await fresh()
const meta = { adult: true, terms_version: "rehearsal", privacy_version: "rehearsal" }
const user = async (email) => (await live.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, meta])).rows[0].id
const [A, B, X] = [await user("a@rehearsal.test"), await user("b@rehearsal.test"), await user("x@rehearsal.test")]
await live.query("insert into public.notifications (member_id, kind, title, body, link, dedupe_key) values ($1, 'test', '가짜 알림', '복구 리허설', '/today', 'rehearsal:a')", [A])

const folder = mkdtempSync(join(tmpdir(), "flavie-rehearsal-"))
writeFileSync(join(folder, "backup1.enc"), seal(await dump(live)))
const photo = randomBytes(2048)
writeFileSync(join(folder, "photo.jpg.enc"), encrypt(key, photo))
assert.ok(!readFileSync(join(folder, "backup1.enc")).toString("latin1").includes("rehearsal.test"), "백업 파일에 평문이 남았어요")

// 탈퇴 회원 정리(보존 정리가 삭제 기록을 남긴다) → 백업 2
await live.query("update public.profiles set status = 'withdrawal_requested', deletion_due_at = now() - interval '1 minute' where id = $1", [X])
await live.query("select public.run_retention()")
const logged = (await live.query("select count(*)::int n from public.deletion_log where member_id = $1", [X])).rows[0].n
assert.equal(logged, 1, "삭제 기록이 남지 않았어요")
writeFileSync(join(folder, "backup2.enc"), seal(await dump(live)))

// 새 DB에 백업 1 복구 → 백업 2의 삭제 기록 적용
const restored = await fresh()
const first = open(readFileSync(join(folder, "backup1.enc")))
await restore(restored, first)
assert.equal((await restored.query("select count(*)::int n from auth.users where id = $1", [X])).rows[0].n, 1, "백업 1에는 탈퇴 회원이 있어야 해요")
const second = open(readFileSync(join(folder, "backup2.enc")))
await restored.query("insert into public.deletion_log select * from jsonb_populate_recordset(null::public.deletion_log, $1) on conflict do nothing", [JSON.stringify(second.deletion_log)])
const removed = (await restored.query("select public.apply_deletion_log() n")).rows[0].n
assert.equal(removed, 1, "삭제 기록을 적용하지 못했어요")
assert.equal((await restored.query("select count(*)::int n from auth.users where id = $1", [X])).rows[0].n, 0, "탈퇴 회원이 되살아났어요")
assert.equal((await restored.query("select count(*)::int n from auth.users where id = any($1)", [[A, B]])).rows[0].n, 2, "남아야 할 회원이 사라졌어요")
assert.equal((await restored.query("select count(*)::int n from public.notifications where member_id = $1", [A])).rows[0].n, 1, "알림이 복구되지 않았어요")
assert.ok(decrypt(key, readFileSync(join(folder, "photo.jpg.enc"))).equals(photo), "사진 파일이 그대로 풀리지 않았어요")
rmSync(folder, { recursive: true, force: true })
console.log("복구 리허설 통과: 암호화 → 복구 → 삭제 기록 적용 → 탈퇴 회원 되살아나지 않음 · 사진 그대로")
