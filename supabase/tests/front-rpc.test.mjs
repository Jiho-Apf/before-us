// 화면 코드가 부르는 서버 함수가 지금 DB에 그 이름·인자로 있는지(GPT 3차 검수 R3-13 · 롤백 호환표용).
// 실행: node supabase/tests/front-rpc.test.mjs            → 지금 작업 폴더의 화면(src/app) × 지금 마이그레이션
//       node supabase/tests/front-rpc.test.mjs --rev 45962df → 그 커밋의 화면(git show) × 지금 마이그레이션 = ‘현재 DB + 직전 프런트’
// 화면이 rpc("함수", { p_인자: … }) · .rpc("함수", { … }) 로 부르는 곳을 모아, 함수가 있고 · 넘기는 인자 이름이 모두 있고 · 기본값 없는 인자를 모두 넘기는지 본다.
// 반환 모양·오류 문장까지 맞는지는 이 시험의 범위가 아니다(화면 시험의 몫).
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { freshDb } from "./edge/harness.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "..", "..")
const rev = process.argv.includes("--rev") ? process.argv[process.argv.indexOf("--rev") + 1] : null
const files = rev
  ? execFileSync("git", ["ls-tree", "-r", "--name-only", rev, "src/app"], { cwd: repo, encoding: "utf8" }).split("\n").filter((f) => /\.(ts|tsx)$/.test(f))
  : (function walk(dir) { return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [relative(repo, p).replace(/\\/g, "/")] : [] }) })(join(repo, "src", "app"))
const source = (f) => (rev ? execFileSync("git", ["show", `${rev}:${f}`], { cwd: repo, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }) : readFileSync(join(repo, f), "utf8"))
const calls = new Map()
for (const f of files) {
  const text = source(f)
  for (const m of text.matchAll(/\brpc(?:<[^()]*?>)?\(\s*"([a-z_0-9]+)"\s*(?:,\s*\{([^}]*)\})?/g)) {
    const keys = [...(m[2] ?? "").matchAll(/\b(p_[a-z_0-9]+)\s*:/g)].map((x) => x[1]).concat([...(m[2] ?? "").matchAll(/(?:^|[,{]\s*)(p_[a-z_0-9]+)\s*(?=[,}]|$)/g)].map((x) => x[1]))
    const spread = /\.\.\./.test(m[2] ?? "") ? [...(m[2] ?? "").matchAll(/\b(p_[a-z_0-9]+)\b/g)].map((x) => x[1]) : []
    const key = `${m[1]}(${[...new Set([...keys, ...spread])].sort().join(",")})`
    if (!calls.has(key)) calls.set(key, { fn: m[1], keys: [...new Set([...keys, ...spread])], at: `${f}` })
  }
}
const db = await freshDb({ until: process.env.UNTIL }) // UNTIL: 이 이름부터의 마이그레이션은 빼고(예전 DB로 대조)
const problems = []
for (const { fn, keys, at } of calls.values()) {
  const procs = (await db.query("select proargnames, pronargs, pronargdefaults from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).rows
  if (!procs.length) { problems.push(`${fn}: 함수가 없어요 (${at})`); continue }
  const fits = procs.some((p) => { const names = (p.proargnames ?? []).slice(0, p.pronargs); const required = names.slice(0, p.pronargs - p.pronargdefaults); return keys.every((k) => names.includes(k)) && required.every((r) => keys.includes(r)) })
  if (!fits) problems.push(`${fn}(${keys.join(", ")}): 인자 이름이 맞는 함수가 없어요 (${at}) · 있는 것: ${procs.map((p) => (p.proargnames ?? []).join(", ")).join(" | ")}`)
}
console.log(`${rev ? `커밋 ${rev}의 화면` : "지금 작업 폴더의 화면"} × 지금 마이그레이션: 서버 함수 호출 ${calls.size}가지`)
for (const p of problems) console.log("✗", p)
assert.deepEqual(problems, [], "화면이 부르는 서버 함수와 DB가 맞지 않아요")
console.log(`화면-서버 함수 호환 시험 통과: ${calls.size}개`)
