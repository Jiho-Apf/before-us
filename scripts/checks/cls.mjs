// 표준 CLS(누적 레이아웃 이동) 계산: 세션 창 중 가장 큰 합.
// 세션 창 = 이동 사이 간격이 1초 미만이고 창 전체 길이가 5초 이하인 묶음. 입력 직후 이동(hadRecentInput)은 뺀다.
// (예전 측정은 모든 이동을 더해서 표준 값보다 클 수 있었다 — 3차 검수 R3-11)
export function sessionCls(entries) {
  let max = 0, current = 0, first = 0, last = 0
  for (const e of entries) {
    if (e.hadRecentInput) continue
    if (current && e.startTime - last < 1000 && e.startTime - first < 5000) { current += e.value; last = e.startTime }
    else { current = e.value; first = last = e.startTime }
    if (current > max) max = current
  }
  return max
}
export const totalShift = (entries) => entries.filter((e) => !e.hadRecentInput).reduce((s, e) => s + e.value, 0)
// 페이지 안에 넣을 같은 계산(문자열)
export const sessionClsSource = `(${sessionCls.toString()})`
