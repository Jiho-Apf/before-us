import { useSyncExternalStore } from "react"
import { accountAge, type AccountFacts } from "./application-model"
import type { AdminMember, AdminState } from "./admin-model"

// 성비 운영 기준. 60%를 넘으면 경보, 70% 이상이면 많은 쪽 성별의 신규 신청을 ‘순차 검토 대기’로 둔다.
// 대기는 거절이 아니다. 신청은 받아 두고, 비율이 회복되면 오래 기다린 순서대로 검토를 시작한다.
export const BALANCE_POLICY = { version: "V6-balance-01", warnShare: 0.6, waitlistShare: 0.7, minimumSample: 10, smallCountHidden: 5 } as const
export type Gender = "여성" | "남성"
export type BalanceLevel = "ok" | "warn" | "waitlist" | "sample-small"
const GENDERS: Gender[] = ["여성", "남성"]

export function ageBand(age: number | null | undefined) {
  if (age === null || age === undefined) return "나이 확인 전"
  if (age < 25) return "19~24세"
  if (age < 30) return "25~29세"
  if (age < 35) return "30~34세"
  if (age < 40) return "35~39세"
  return "40세 이상"
}
type PoolMember = { id: string; gender: Gender; band: string; province: string }
export function poolOf(state: AdminState, today: string, waitlisted: (id: string) => boolean = isWaitlisted): PoolMember[] {
  return state.members
    .filter((member) => member.draft.review.submission === "received" && (!member.lifecycle || member.lifecycle === "active") && !waitlisted(member.id))
    .filter((member) => GENDERS.includes(member.draft.values["self.gender"] as Gender))
    .map((member) => ({ id: member.id, gender: member.draft.values["self.gender"] as Gender, band: ageBand(accountAge(member.account, today)), province: String(member.draft.values["self.province"] || "지역 미입력") }))
}
export function balanceOf(pool: { gender: Gender }[]) {
  const counts = { 여성: pool.filter((item) => item.gender === "여성").length, 남성: pool.filter((item) => item.gender === "남성").length }
  const total = counts.여성 + counts.남성
  const majority: Gender | null = counts.여성 === counts.남성 ? null : counts.여성 > counts.남성 ? "여성" : "남성"
  const share = total && majority ? counts[majority] / total : 0.5
  const level: BalanceLevel = total < BALANCE_POLICY.minimumSample ? "sample-small" : share >= BALANCE_POLICY.waitlistShare ? "waitlist" : share > BALANCE_POLICY.warnShare ? "warn" : "ok"
  return { counts, total, majority, share, level }
}
// 관리자 화면에서도 1~4명 단위는 정확한 숫자를 보여 주지 않는다.
export const countLabel = (count: number) => (count > 0 && count < BALANCE_POLICY.smallCountHidden ? "1~4명" : `${count}명`)
export const ratioLabel = (balance: ReturnType<typeof balanceOf>) => {
  if (!balance.total) return "자료 없음"
  const female = Math.round((balance.counts.여성 / balance.total) * 100)
  return `여 ${female}% : 남 ${100 - female}%`
}
export function balanceReport(state: AdminState, today: string) {
  const pool = poolOf(state, today)
  const group = (key: (item: PoolMember) => string) => {
    const keys = [...new Set(pool.map(key))].sort()
    return keys.map((label) => ({ label, ...balanceOf(pool.filter((item) => key(item) === label)) }))
  }
  return {
    overall: balanceOf(pool),
    byAge: group((item) => item.band),
    byRegion: group((item) => item.province),
    bySegment: group((item) => `${item.province} · ${item.band}`).filter((item) => item.total >= BALANCE_POLICY.minimumSample),
  }
}

// 신규 신청 판단: 전체 또는 같은 지역·연령대 묶음(표본 10명 이상)에서 신청자 성별이 70% 이상이면 대기.
export function admissionDecision(state: AdminState, applicant: { gender: unknown; account: AccountFacts; province: unknown }, today: string) {
  if (!GENDERS.includes(applicant.gender as Gender)) return { waitlist: false, reason: "성별 직접 확인 필요 · 성비 판단 제외" }
  const gender = applicant.gender as Gender
  const pool = poolOf(state, today)
  const overall = balanceOf(pool)
  if (overall.level === "waitlist" && overall.majority === gender) return { waitlist: true, reason: `전체 성비 ${ratioLabel(overall)} · 순차 검토` }
  const segment = balanceOf(pool.filter((item) => item.province === String(applicant.province) && item.band === ageBand(accountAge(applicant.account, today))))
  if (segment.level === "waitlist" && segment.majority === gender) return { waitlist: true, reason: `같은 지역·연령대 성비 ${ratioLabel(segment)} · 순차 검토` }
  return { waitlist: false, reason: "성비 기준 이내" }
}

export type WaitlistEntry = { memberId: string; gender: Gender; at: string; reason: string; status: "waiting" | "released"; releasedAt: string | null; releaseNote: string | null }
let entries: WaitlistEntry[] = []
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const commit = (next: WaitlistEntry[]) => { entries = next; listeners.forEach((listener) => listener()) }
export const getWaitlist = () => entries
export const useWaitlist = () => useSyncExternalStore(subscribe, getWaitlist, getWaitlist)
export const waitlistEntry = (memberId: string) => entries.find((item) => item.memberId === memberId && item.status === "waiting") || null
export function isWaitlisted(memberId: string) { return !!waitlistEntry(memberId) }
export function resetWaitlistDemo() { commit([]) }

export function admitApplication(state: AdminState, memberId: string, applicant: { gender: unknown; account: AccountFacts; province: unknown }, today: string, now = new Date()) {
  const decision = admissionDecision(state, applicant, today)
  if (!decision.waitlist) { if (waitlistEntry(memberId)) return decision; commit(entries.filter((item) => item.memberId !== memberId)); return decision }
  if (!waitlistEntry(memberId)) commit([...entries.filter((item) => item.memberId !== memberId), { memberId, gender: applicant.gender as Gender, at: now.toISOString(), reason: decision.reason, status: "waiting", releasedAt: null, releaseNote: null }])
  return decision
}
export function waitlistMember(member: AdminMember, reason: string, now = new Date()) {
  const gender = member.draft.values["self.gender"]
  if (!GENDERS.includes(gender as Gender) || waitlistEntry(member.id)) return "성별 확인 또는 기존 대기 상태를 확인해 주세요."
  commit([...entries.filter((item) => item.memberId !== member.id), { memberId: member.id, gender: gender as Gender, at: now.toISOString(), reason, status: "waiting", releasedAt: null, releaseNote: null }])
  return null
}
// 검토 시작 후 같은 성별 비율이 70% 미만으로 유지되는지 미리 계산한다. 운영자가 사유를 남기면 기준을 넘어도 시작할 수 있다.
export function releaseForecast(state: AdminState, memberId: string, today: string) {
  const entry = waitlistEntry(memberId)
  if (!entry) return null
  const pool = poolOf(state, today)
  const after = balanceOf([...pool, { id: memberId, gender: entry.gender, band: "", province: "" }])
  return { after, withinLimit: !(after.level === "waitlist" && after.majority === entry.gender) }
}
export function releaseFromWaitlist(state: AdminState, memberId: string, note: string, today: string, now = new Date()) {
  const forecast = releaseForecast(state, memberId, today)
  if (!forecast) return "대기 중인 신청이 아니에요."
  if (!forecast.withinLimit && !note.trim()) return "검토를 시작하면 성비가 70%를 넘어요. 그래도 시작하려면 사유를 남겨 주세요."
  commit(entries.map((item) => item.memberId === memberId && item.status === "waiting" ? { ...item, status: "released", releasedAt: now.toISOString(), releaseNote: note.trim() || "성비 기준 이내 · 순서대로 검토 시작" } : item))
  return null
}
// 오래 기다린 순서. 같은 성별 안에서만 순서를 지킨다.
export const waitlistOrder = (gender: Gender) => entries.filter((item) => item.status === "waiting" && item.gender === gender).sort((a, b) => a.at.localeCompare(b.at))
