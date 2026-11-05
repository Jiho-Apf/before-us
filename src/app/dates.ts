// 회원 화면 날짜 표기 하나로 맞추기 (Asia/Seoul).
//  - kstDay: "10월 11일 (토)"
//  - kstDateTime: "10월 11일 (토) 12:00"
// 올해가 아닌 날짜는 앞에 연도를 붙인다: "2027년 1월 30일 (토)"
const parts = (value: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>

const valid = (value: string | Date | null | undefined) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

export function kstDay(value: string | Date | null | undefined, fallback = "확인된 날짜 없음") {
  const date = valid(value)
  if (!date) return fallback
  const p = parts(date)
  const year = p.year !== parts(new Date()).year ? `${p.year}년\u00a0` : ""
  // 날짜 안 공백은 줄 바꿈 없는 공백(\u00a0): ‘11월 / 16일’처럼 갈라지지 않게. 날짜와 시각 사이는 보통 공백이라 거기서는 줄이 바뀔 수 있다.
  return `${year}${p.month}월\u00a0${p.day}일\u00a0(${p.weekday})`
}

export function kstDateTime(value: string | Date | null | undefined, fallback = "확인된 시각 없음") {
  const date = valid(value)
  if (!date) return fallback
  const p = parts(date)
  return `${kstDay(date)} ${p.hour}:${p.minute}`
}
