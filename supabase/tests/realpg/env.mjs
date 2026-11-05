// 실제 PostgreSQL(내 컴퓨터 임시 폴더) 시험 환경: PGlite로는 만들 수 없는 ‘서로 다른 연결 여러 개’가 필요한 시험(동시 소개 배정·사진 삭제 경합 등)용.
// 운영 서버와는 연결하지 않는다. 가짜 자료만 쓴다.
//  - 준비(한 번): 아무 폴더에서 `npm i embedded-postgres@17.5.0-beta.15 pg@8.13.1` 후
//    FLAVIE_PG_MODULES=<그 폴더>\node_modules 를 환경 변수로 준다(저장소에 PostgreSQL 실행 파일을 넣지 않으려고).
//  - startPostgres()는 임시 폴더에 새 데이터베이스를 띄우고, stop()은 끄고 그 폴더를 지운다.
//  - prepareDatabase(client)는 db.test.mjs와 같은 Supabase 흉내(역할·auth/storage 스키마) + 마이그레이션 전부(예약 작업 파일 제외)를 올린다.
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
export const migrationsDir = join(here, "..", "..", "migrations")
const modules = process.env.FLAVIE_PG_MODULES
if (!modules) { console.error("FLAVIE_PG_MODULES(embedded-postgres·pg가 설치된 node_modules 경로)를 지정해 주세요."); process.exit(2) }
const require = createRequire(join(modules, "x.js"))
const pg = require("pg")
// PGlite와 같은 값으로 읽는다(bigint → 숫자, date → UTC 자정 Date).
pg.types.setTypeParser(20, (v) => { const n = Number(v); return Number.isSafeInteger(n) ? n : BigInt(v) })
pg.types.setTypeParser(1082, (v) => new Date(v))
export const { Client } = pg

export async function startPostgres() {
  const { default: EmbeddedPostgres } = await import(pathToFileURL(require.resolve("embedded-postgres")).href)
  const dir = mkdtempSync(join(tmpdir(), "flavie-pg-"))
  const port = 55000 + Math.floor(Math.random() * 4000)
  const server = new EmbeddedPostgres({ databaseDir: join(dir, "data"), user: "postgres", password: "postgres", port, persistent: false, onLog: () => {}, onError: () => {} })
  await server.initialise()
  await server.start()
  await server.createDatabase("flavie")
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/flavie`
  const admin = new Client({ connectionString: url })
  await admin.connect()
  await admin.query("alter database flavie set timezone to 'GMT'")
  await admin.end()
  return {
    url,
    connect: async () => { const c = new Client({ connectionString: url }); await c.connect(); return c },
    stop: async () => { try { await server.stop() } finally { rmSync(dir, { recursive: true, force: true }) } },
  }
}

// db.test.mjs의 Supabase 흉내 + 마이그레이션 전부
export function setupSql() {
  return readFileSync(join(here, "..", "db.test.mjs"), "utf8").match(/await db\.exec\(`([\s\S]*?)`\)/)[1]
}
// until: 이 이름부터의 마이그레이션은 빼고 올린다(고치기 전 상태 재현 · 대조군용)
export async function prepareDatabase(client, { until } = {}) {
  await client.query(setupSql())
  for (const file of readdirSync(migrationsDir).sort()) {
    if (file.includes("schedules")) continue
    if (until && file >= until) continue
    try { await client.query(readFileSync(join(migrationsDir, file), "utf8")) }
    catch (error) { throw new Error(`마이그레이션 실패: ${file}\n${error.message}`) }
  }
}

// PGlite처럼 쓰는 얇은 껍데기(db.test.mjs를 실제 PostgreSQL에서 그대로 돌릴 때)
export function asPglite(client) {
  return {
    query: (sql, params = []) => client.query(sql, params),
    exec: (sql) => client.query(sql),
  }
}

// 같은 사용자로 SQL 실행(요청 하나 = 트랜잭션 하나, Supabase PostgREST와 같게)
export async function asUser(client, who, aal = "aal1") {
  await client.query("reset role")
  if (who === "postgres") { await client.query("select set_config('request.jwt.claims', '', false)"); return }
  await client.query("select set_config('request.jwt.claims', $1, false)", [who === "anon" ? JSON.stringify({ role: "anon" }) : JSON.stringify({ sub: who, role: "authenticated", aal })])
  await client.query(`set role ${who === "anon" ? "anon" : "authenticated"}`)
}
