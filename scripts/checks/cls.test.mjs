// 표준 CLS 단위 시험(R3-11 검수 반례). 실행: node scripts/checks/cls.test.mjs
import { sessionCls, totalShift } from "./cls.mjs"
const shift = (t, v, input = false) => ({ startTime: t, value: v, hadRecentInput: input })
const cases = [
  ["검수 반례: .08 + .07(0.5초 뒤), 6초 뒤 .08 → 전체 합 .23, 표준 .15", [shift(0, 0.08), shift(500, 0.07), shift(6500, 0.08)], 0.23, 0.15],
  ["간격 1초 이상이면 다른 창", [shift(0, 0.05), shift(1200, 0.05)], 0.10, 0.05],
  ["창 길이 5초를 넘으면 새 창", [shift(0, 0.02), shift(900, 0.02), shift(1800, 0.02), shift(2700, 0.02), shift(3600, 0.02), shift(4500, 0.02), shift(5400, 0.02)], 0.14, 0.12],
  ["입력 직후 이동은 빼요", [shift(0, 0.3, true), shift(100, 0.01)], 0.01, 0.01],
]
let fail = 0
for (const [label, entries, total, standard] of cases) {
  const t = Math.round(totalShift(entries) * 1000) / 1000, s = Math.round(sessionCls(entries) * 1000) / 1000
  const ok = Math.abs(t - total) < 1e-9 && Math.abs(s - standard) < 1e-9
  console.log(`${ok ? "✓" : "✗"} ${label} (합 ${t} · 표준 ${s})`)
  if (!ok) fail++
}
console.log(fail ? `실패 ${fail}개` : `CLS 단위 시험 통과: ${cases.length}개`)
process.exit(fail ? 1 : 0)
