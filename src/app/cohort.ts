import { useEffect, useState } from "react"
import { BEFORE_US } from "./config"
import { LIVE, rpc } from "./backend/client"

// 기수제(V6-cohort-01): 매달 마지막 날 정오에 시작하고, 신청은 시작 4일 전까지 받는다.
// 공개 화면에는 기수 번호와 날짜만 보여 준다(모인 인원은 관리자만 본다).
// 실제 서버 모드에서는 운영진이 바꾼 날짜가 있으면 서버 값을 쓴다.
export type CohortInfo = { number: number; startsOn: string; applicationDeadline: string; opensOn: string | null }
const C = BEFORE_US.cohorts
// 베타 기수는 번호 0으로 두고 화면에는 ‘베타’로 보여 준다.
export const cohortName = (number: number) => number === 0 ? "베타" : `${number}기`
export const cohortCode = (number: number) => number === 0 ? "BETA" : `COHORT ${String(number).padStart(2, "0")}`
const pad = (n: number) => String(n).padStart(2, "0")
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const kstToday = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })

export function cohortByNumber(number: number): CohortInfo {
  if (number === C.first.number) return { number, startsOn: C.first.startsOn, applicationDeadline: C.first.applicationDeadline, opensOn: C.first.opensOn }
  const [y, m] = C.first.startsOn.split("-").map(Number)
  const index = m - 1 + (number - C.first.number)
  const year = y + Math.floor(index / 12), month = (index % 12) + 1
  const startsOn = `${year}-${pad(month)}-${pad(lastDay(year, month))}`
  return { number, startsOn, applicationDeadline: shift(startsOn, -C.deadlineDaysBefore), opensOn: null }
}

// 지금 신청하면 들어가는 기수
export function recruitingCohort(now = new Date()): CohortInfo {
  const today = kstToday(now)
  let number = C.first.number
  while (today > cohortByNumber(number).applicationDeadline) number += 1
  return cohortByNumber(number)
}

// 실제 서버 모드에서는 서버 값이 올 때까지 null(설정 파일의 1기 날짜가 잠깐 보였다가 바뀌는 깜빡임을 막는다).
export function useRecruitingCohort(): CohortInfo | null {
  const [cohort, setCohort] = useState<CohortInfo | null>(() => LIVE ? null : recruitingCohort())
  useEffect(() => {
    if (!LIVE) return
    void rpc<{ number: number; startsOn: string; applicationDeadline: string } | null>("public_cohort").then(({ data }) => {
      if (data) setCohort({ number: data.number, startsOn: data.startsOn, applicationDeadline: data.applicationDeadline, opensOn: null })
    })
  }, [])
  return cohort
}
