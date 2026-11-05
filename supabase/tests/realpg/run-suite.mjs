// db.test.mjs 전체를 실제 PostgreSQL(새 임시 데이터베이스)에서 그대로 돌린다.
// 실행: FLAVIE_PG_MODULES=<node_modules> node supabase/tests/realpg/run-suite.mjs
import { startPostgres, asPglite } from "./env.mjs"
const server = await startPostgres()
const client = await server.connect()
const exit = process.exit
let code = 0
process.exit = (c) => { code = c ?? 0; throw new Error(`process.exit(${c})`) }
try {
  globalThis.__FLAVIE_DB__ = asPglite(client)
  const started = Date.now()
  await import("../db.test.mjs")
  console.log(`실제 PostgreSQL(${(await client.query("select version() v")).rows[0].v.split(",")[0]})에서 통과: ${globalThis.__FLAVIE_PASSED__}개 · ${Math.round((Date.now() - started) / 1000)}초`)
} catch (error) {
  code = code || 1
  console.error("실패:", error.message)
} finally {
  await client.end().catch(() => {})
  await server.stop()
  exit(code)
}
