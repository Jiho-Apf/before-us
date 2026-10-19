import { BEFORE_US } from "./config"

// V6-intro-plan-02 · 소개비 10,000원으로 받는 소개의 범위(기수제).
//  - 기본 소개: 하루 최대 1명, 최대 5번. 소개가 없는 날은 횟수에서 빼지 않는다. 첫 소개는 내 기수의 시작일 정오부터.
//  - 한 번 더, 5번: 2026-12-31(KST)까지 소개비를 낸 계정에 한 번. 기본 5번 동안 교류를 시작하지 못했으면
//    추가 비용 없이 5번을 더 소개한다. 2027-12-31까지 쓸 수 있고, 다음 기수로 자동으로 이어진다.
//  - 첫 교류가 실제 시작되면 이번 소개비의 소개는 끝난다(진행 중인 교류는 그대로).
const PLAN = BEFORE_US.introductionPlans
const kstDate = (value: Date) => value.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
const dotted = (date: string) => { const [y, m, d] = date.split("-").map(Number); return `${y}년 ${m}월 ${d}일` }

export type IntroductionPlan = {
  kind: "standard"
  label: string
  summary: string
  endsAt: null
  introductions: number
  bonus: { eligible: boolean; introductions: number; usableUntil: string }
}

export const bonusEligible = (paidAt: Date) => kstDate(paidAt) <= PLAN.bonus.paidBy

export function planFor(paidAt: Date): IntroductionPlan {
  const eligible = bonusEligible(paidAt)
  return {
    kind: "standard",
    label: PLAN.standard.label,
    summary: `하루 최대 1명 · 최대 ${PLAN.standard.introductions}번 소개${eligible ? ` · ‘${PLAN.bonus.label}’ 대상` : ""}`,
    endsAt: null,
    introductions: PLAN.standard.introductions,
    bonus: { eligible, introductions: PLAN.bonus.introductions, usableUntil: PLAN.bonus.usableUntil },
  }
}

// 소개비를 아직 내지 않았다면 지금 결제할 때 적용될 범위
export const planIfPaidNow = (now: Date) => planFor(now)

// 받을 수 있는 소개 수: 기본 5번 + (대상이고 기한 안이면) 한 번 더 5번
export function introductionLimit(paidAt: string, now: Date) {
  const plan = planFor(new Date(paidAt))
  return plan.introductions + (plan.bonus.eligible && kstDate(now) <= plan.bonus.usableUntil ? plan.bonus.introductions : 0)
}

export function benefitIssue(paidAt: string | null | undefined, received: number, started: boolean, now: Date): string | null {
  if (!paidAt) return null
  if (started) return "첫 교류가 시작되어 이번 소개비의 소개가 끝났어요."
  const limit = introductionLimit(paidAt, now)
  if (received >= limit) return `이번 소개비로 받을 수 있는 ${limit}번의 소개를 모두 받았어요.`
  return null
}

export const PLAN_NOTICE = {
  standard: `소개비 ${BEFORE_US.pricing.introduction.toLocaleString("ko-KR")}원으로 하루 최대 1명, 최대 ${PLAN.standard.introductions}번 소개받아요. 첫 소개는 내 기수가 시작하는 날 정오부터이고, 소개가 없는 날은 횟수에서 빼지 않아요.`,
  bonus: `${dotted(PLAN.bonus.paidBy)}까지 소개비를 낸 분이 ${PLAN.standard.introductions}번의 소개 동안 교류를 시작하지 못했다면, 한 번 더 ${PLAN.bonus.introductions}번을 추가 비용 없이 소개해 드려요. 계정마다 한 번이고, ${dotted(PLAN.bonus.usableUntil)}까지 쓸 수 있으며 다음 기수로 자동으로 이어져요.`,
  carryOver: "첫 교류가 시작되면 이번 소개비의 소개는 끝나요. 진행 중인 소개나 서로 선택한 교류는 그대로 이어가요.",
}
