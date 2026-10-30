import { useSyncExternalStore } from "react"

// 첫 만남 안전 가이드와 만남 후 피드백. 피드백은 상대에게 전달하지 않고 운영진만 본다.
export const SAFETY_GUIDE = [
  { title: "사람이 많은 공공장소에서", body: "첫 만남은 카페·식당처럼 열린 공간에서, 가능하면 낮이나 이른 저녁에 만나요. 집·숙소·차 안은 피해 주세요." },
  { title: "각자 이동하기", body: "오고 가는 길은 각자 이동해요. 첫 만남에서 집이나 직장 위치를 알려 주지 않아도 괜찮아요." },
  { title: "가까운 사람에게 일정 공유", body: "만나는 장소와 시간을 믿을 수 있는 지인에게 미리 알려 두세요." },
  { title: "음주는 천천히", body: "술은 내가 편한 만큼만. 음료를 자리에 두고 오래 비우지 않는 것이 좋아요." },
  { title: "불편하면 언제든 일어나도 돼요", body: "설명 없이 자리를 떠나도 괜찮아요. 이후 진행은 내 정보에서 멈출 수 있어요." },
  { title: "돈·투자·개인 연락 요구는 신고", body: "금전 요청, 투자 권유, 외부 메신저 이동 요구는 바로 신고해 주세요." },
  { title: "위급할 때는 112", body: "위험을 느끼면 즉시 112에 신고하세요. 플라비 신고는 긴급 출동을 대신하지 않아요." },
] as const
export const FEEDBACK_OPENS_AFTER_MINUTES = 60
export type MeetingFeedback = {
  id: string
  memberId: string
  programId: string
  meetingAt: string
  at: string
  met: "met" | "not-met" | "partner-absent"
  again: "yes" | "no" | "unsure" | null
  safetyConcern: boolean
  note: string
}
let feedback: MeetingFeedback[] = []
let guideConfirmed: Record<string, string> = {}
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const notify = () => listeners.forEach((listener) => listener())
type Snapshot = { feedback: MeetingFeedback[]; guideConfirmed: Record<string, string> }
let snapshot: Snapshot = { feedback, guideConfirmed }
const refresh = () => { snapshot = { feedback, guideConfirmed }; notify() }
export const getAftercare = () => snapshot
export const useAftercare = () => useSyncExternalStore(subscribe, getAftercare, getAftercare)

export function confirmSafetyGuide(memberId: string, programId: string, now = new Date()) {
  const key = `${memberId}:${programId}`
  if (!guideConfirmed[key]) { guideConfirmed = { ...guideConfirmed, [key]: now.toISOString() }; refresh() }
}
export function feedbackOpen(meetingAt: string, now: Date) {
  return Number.isFinite(Date.parse(meetingAt)) && now.getTime() >= Date.parse(meetingAt) + FEEDBACK_OPENS_AFTER_MINUTES * 60000
}
export function submitMeetingFeedback(input: Omit<MeetingFeedback, "id" | "at">, now = new Date()) {
  if (!input.memberId || !input.programId) return "가상 계정과 약속을 확인해 주세요."
  if (!feedbackOpen(input.meetingAt, now)) return `약속 시작 ${FEEDBACK_OPENS_AFTER_MINUTES}분 뒤부터 남길 수 있어요.`
  if (input.met === "met" && !input.again) return "다시 만나고 싶은지 골라 주세요."
  if (input.note.length > 300 || /(?:https?:|@|\d[\d\s-]{6,})/i.test(input.note)) return "300자 이하로, 연락처·링크 없이 적어 주세요."
  if (feedback.some((item) => item.memberId === input.memberId && item.programId === input.programId)) return "이 약속의 피드백은 이미 남겼어요."
  feedback = [...feedback, { ...input, again: input.met === "met" ? input.again : null, note: input.note.trim(), id: `meeting-feedback-${feedback.length + 1}`, at: now.toISOString() }]
  refresh()
  return null
}
// 운영진용 쌍 요약. 회원 화면에는 상대의 응답을 보여 주지 않는다.
export function pairFeedbackSummary(programId: string) {
  const items = feedback.filter((item) => item.programId === programId)
  const both = items.length === 2
  return {
    count: items.length,
    bothMet: both && items.every((item) => item.met === "met"),
    bothAgain: both && items.every((item) => item.again === "yes"),
    safetyConcern: items.some((item) => item.safetyConcern),
    absentReported: items.some((item) => item.met === "partner-absent"),
  }
}
export function resetAftercareDemo() { feedback = []; guideConfirmed = {}; refresh() }
