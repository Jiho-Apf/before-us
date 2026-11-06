// 기수 경계 확인(검수 D13 · R3-05·R3-28): 지금 저장소의 기수 값 그대로, 경계 시각에 신청하면 어느 기수로 배정되고
// 공개 화면이 어느 기수를 안내하는지 실제 SQL(PGlite · 마이그레이션 전체)로 찍어 둔다. 날짜를 바꾸지 않는다(날짜는 대표 결정).
// 실행: node scripts/checks/cohort-boundaries.mjs [--out=결과.json]
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { args } from "./lib.mjs"

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const opt = args({})
const { PGlite } = await import(pathToFileURL(join(PROJECT, "node_modules/@electric-sql/pglite/dist/index.js")).href)
const db = new PGlite()
const tests = readFileSync(join(PROJECT, "supabase/tests/db.test.mjs"), "utf8")
await db.exec(tests.match(/await db\.exec\(`([\s\S]*?)`\)/)[1])
for (const f of readdirSync(join(PROJECT, "supabase/migrations")).sort()) if (!f.includes("schedules")) await db.exec(readFileSync(join(PROJECT, "supabase/migrations", f), "utf8"))

const one = async (text, params = []) => (await db.query(text, params)).rows[0]
// 시험 전용 바꿔 끼우기: kst_today()는 실제 시각(now())만 보므로, 이 확인에서만 app_now()(가짜 시각)를 보게 한다.
// 배정 규칙(assign_cohort·public_cohort)은 kst_today()만 쓰니 규칙 자체는 그대로 시험된다. 운영 DB와 저장소의 함수는 바꾸지 않는다.
await db.exec("create or replace function public.kst_today() returns date language sql stable set search_path = '' as $$ select (public.app_now() at time zone 'Asia/Seoul')::date $$")
const cohorts = async () => (await db.query("select number, starts_on::text s, application_deadline::text d from public.cohorts order by number")).rows
const before = await cohorts()
const POINTS = [
  ["2026-11-12", "23:59", "베타 신청 마감 직전"],
  ["2026-11-13", "00:00", "베타 신청 마감 직후"],
  ["2026-11-30", "23:59", "11월 마지막 날"],
  ["2026-12-01", "00:00", "12월 첫날"],
  ["2026-12-10", "12:00", "12월 10일"],
  ["2026-12-27", "23:59", "1기 신청 마감 직전"],
  ["2026-12-28", "00:00", "1기 신청 마감 직후"],
  ["2026-12-31", "12:00", "1기 첫 소개(정오)"],
  ["2027-01-01", "00:00", "새해 첫날"],
]
const rows = []
for (const [date, time, label] of POINTS) {
  await db.query("select set_config('app.now', (public.kst_at($1::date, $2::time))::text, false)", [date, time])
  const today = (await one("select public.kst_today()::text t")).t
  const assigned = (await one("select public.assign_cohort('여성') n")).n
  const pub = (await one("select public.public_cohort() c")).c
  rows.push({ at: `${date} ${time} KST`, label, kstToday: today, assignedCohort: assigned, publicCohort: pub })
  console.log(`${label.padEnd(14)} ${date} ${time} → 배정 기수 ${assigned} · 공개 안내 ${pub ? `${pub.number}기(마감 ${pub.applicationDeadline}, 시작 ${pub.startsOn})` : "없음"}`)
}
const after = await cohorts()
const created = after.filter((c) => !before.some((b) => b.number === c.number))
console.log("\n처음 기수 표:", JSON.stringify(before))
console.log("확인 중 자동으로 만든 기수:", JSON.stringify(created))
if (opt.out) writeFileSync(opt.out, JSON.stringify({ ranAt: new Date().toISOString(), note: "현재 저장소 값 그대로 · 날짜는 바꾸지 않음 · 이 확인에서만 kst_today()가 가짜 시각을 보게 바꿔 끼움", before, created, rows }, null, 1))
