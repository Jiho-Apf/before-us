import { BEFORE_US } from "./config"

// V6-intro-plan-01 · 소개비 5,000원으로 받는 소개의 범위.
//  - 초기 혜택: 2026-12-31(KST)까지 소개비를 결제하면, 결제일부터 30일 동안 첫 교류가 시작되기 전까지 소개 횟수 제한 없음.
//    30일이 지나거나 첫 교류가 실제 시작되면 끝난다(먼저 오는 때). 끝날 때 진행 중인 소개·상호 선택은 그대로 이어간다.
//  - 기본 소개: 2027-01-01부터 결제하면 하루 최대 1명, 최대 5번. 소개가 없는 날은 횟수에서 빼지 않는다.
//    다섯 번째 소개를 받거나 첫 교류가 실제 시작되면 끝난다.
const PLAN = BEFORE_US.introductionPlans
const kstDate = (value: Date) => value.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
const addDays = (date: string, days: number) => kstDate(new Date(Date.parse(`${date}T12:00:00+09:00`) + days * 86400000))
const dotted = (date: string) => { const [y, m, d] = date.split("-").map(Number); return `${y === new Date().getFullYear() ? "" : `${y}년 `}${m}월 ${d}일` }

export type IntroductionPlan = {
  kind: "early" | "standard"
  label: string
  summary: string
  endsAt: string | null
  introductions: number | null
}

export function planFor(paidAt: Date): IntroductionPlan {
  const paid = kstDate(paidAt)
  if (paid <= PLAN.early.applyBy) {
    const end = addDays(paid, PLAN.early.validDays)
    return { kind: "early", label: PLAN.early.label, summary: `${dotted(end)}까지 · 첫 교류 시작 전까지 소개 횟수 제한 없음`, endsAt: `${end}T23:59:59+09:00`, introductions: null }
  }
  return { kind: "standard", label: PLAN.standard.label, summary: `하루 최대 1명 · 최대 ${PLAN.standard.introductions}번 소개`, endsAt: null, introductions: PLAN.standard.introductions }
}

// 소개비를 아직 내지 않았다면 지금 결제할 때 적용될 범위
export const planIfPaidNow = (now: Date) => planFor(now)

export function benefitIssue(paidAt: string | null | undefined, received: number, started: boolean, now: Date): string | null {
  if (!paidAt) return null
  if (started) return "첫 교류가 시작되어 이번 소개 혜택이 끝났어요."
  const plan = planFor(new Date(paidAt))
  if (plan.endsAt && now.getTime() > Date.parse(plan.endsAt)) return `초기 혜택 30일이 지났어요(${dotted(plan.endsAt.slice(0, 10))}까지). 이어서 받으려면 소개비를 다시 결제해요.`
  if (plan.introductions !== null && received >= plan.introductions) return `이번 소개비로 받을 수 있는 ${plan.introductions}번의 소개를 모두 받았어요.`
  return null
}

export const PLAN_NOTICE = {
  early: `${dotted(PLAN.early.applyBy)}까지 소개비를 결제한 분은, 결제일부터 ${PLAN.early.validDays}일 동안 첫 교류가 시작되기 전까지 소개 횟수 제한 없이 소개받아요. ${PLAN.early.validDays}일이 지나거나 첫 교류가 시작되면 먼저 오는 때에 끝나요.`,
  standard: `2027년 1월 1일부터는 소개비 ${BEFORE_US.pricing.introduction.toLocaleString("ko-KR")}원으로 하루 최대 1명, 최대 ${PLAN.standard.introductions}번 소개받아요. 소개가 없는 날은 횟수에서 빼지 않아요.`,
  carryOver: "혜택이 끝나는 순간 진행 중인 소개나 서로 선택한 교류는 그대로 이어가요.",
}
