import { BEFORE_US } from "./config"
import { inRange, type ConsoleData, type DateRange } from "./admin-console-data"
import { introductionRows } from "./admin-operations-model"

export const REPORT_TYPES = ["부적절한 메시지", "사진·허위 정보 의심", "연락처 악용", "괴롭힘", "노쇼", "약속 취소", "실제 만남 관련 문제", "기타"] as const
export const REPORT_STATES = [{ id: "new", label: "신규" }, { id: "reviewing", label: "검토 중" }, { id: "checking", label: "추가 확인" }, { id: "action", label: "조치" }, { id: "closed", label: "종료" }] as const
export type Feedback = {
  id: string
  authorId: string
  programId: string | null
  category: "교류 후기" | "소개 만족도" | "운영 경험" | "일정·장소 기능 의견"
  at: string
  body: string
  improvementRequested: boolean
  publicConsentAt: string | null
  consentVersion: number | null
  version: number
  reportId: string | null
  review: "pending" | "confirmed" | "revision-review"
}
export type NotificationTemplate = {
  id: string
  name: string
  body: string
  version: number
  approval: "not-connected"
  delivery: "not-connected"
}
export type SettingsProposal = {
  version: string
  disclosureTime: string
  responseHours: number | null
  longWaitingDays: number
  introductionPrice: number
  exchangePrice: number
}
export type GovernanceData = {
  feedback: Feedback[]
  templates: NotificationTemplate[]
  settingsProposal: SettingsProposal | null
}
export function currentSettings(): SettingsProposal {
  const minutes = (time: string) => Number(time.split(":")[0]) * 60 + Number(time.split(":")[1])
  return { version: BEFORE_US.policyVersion, disclosureTime: BEFORE_US.introduction.readyAt, responseHours: (1440 + minutes(BEFORE_US.introduction.responseDeadlineNextDayAt) - minutes(BEFORE_US.introduction.readyAt)) / 60, longWaitingDays: 14, introductionPrice: BEFORE_US.pricing.introduction, exchangePrice: BEFORE_US.pricing.exchangePerPerson }
}
function audited(data: ConsoleData, action: string, target: string, reason: string, now: Date) {
  return { ...data, audits: [...data.audits, { id: `governance-${data.audits.length + 1}`, at: now.toISOString(), actor: "가상 Owner", action, target, reason: reason.trim(), role: "Owner", result: "demo-only" }] }
}
export function governanceAction(data: ConsoleData, command:
  | { kind: "report"; id: string; status: typeof REPORT_STATES[number]["id"]; note: string; reason: string }
  | { kind: "report-read"; id: string; reason: string }
  | { kind: "report-description"; id: string; reason: string }
  | { kind: "feedback-read"; id: string; reason: string }
  | { kind: "refund-review"; id: string; reason: string }
  | { kind: "feedback"; id: string; review: Feedback["review"]; reason: string }
  | { kind: "template"; id: string; body: string; reason: string }
  | { kind: "settings"; proposal: SettingsProposal; reason: string }
  | { kind: "demo-login"; reason: string }, now = new Date()): {
    data: ConsoleData
    error: string | null
  } {
  if (!command.reason.trim() || command.reason.length > 200) return { data, error: "행위 사유를 1~200자로 기록해 주세요." }
  if (/(?:https?:|@|\d[\d\s-]{6,}|주민등록번호|신분증)/i.test(command.reason)) return { data, error: "사유에는 개인정보·신분 자료·본문을 복사하지 마세요." }
  const next = structuredClone(data)
  if (command.kind === "report-description" || command.kind === "feedback-read") {
    const exists = command.kind === "report-description" ? next.reports.some(item => item.id === command.id) : next.governance.feedback.some(item => item.id === command.id)
    if (!exists) return { data, error: "열람 대상이 없습니다." }
    return { error: null, data: audited(next, command.kind === "report-description" ? "가상 신고 설명 열람" : "가상 피드백 내용 열람", command.id, command.reason, now) }
  }
  if (command.kind === "report" || command.kind === "report-read") {
    const report = next.reports.find(item => item.id === command.id)
    if (!report) return { data, error: "신고를 찾을 수 없습니다." }
    if (command.kind === "report-read") return { error: "본문 열람 차단: 실제 별도 서버 권한이 없습니다. 열람 요청 사유·시각만 기록합니다.", data: audited(next, "신고 관련 본문 열람 요청 · 차단", command.id, command.reason, now) }
    if (!REPORT_STATES.some(state => state.id === command.status) || command.note.length > 500) return { data, error: "신고 상태와 최대 500자 조치 메모를 확인해 주세요." }
    report.status = command.status
    report.assignee = "가상 Owner"
    report.actionNote = command.note.trim()
    return { error: null, data: audited(next, "신고 상태·조치 메모 수정 · 자동 회원 차단 없음", command.id, command.reason, now) }
  }
  if (command.kind === "refund-review") {
    if (!next.payments.some(payment => payment.id === command.id)) return { data, error: "거래를 찾을 수 없습니다." }
    return { error: null, data: audited(next, "환불 검토 접수 · 실제 환불 미실행", command.id, command.reason, now) }
  }
  if (command.kind === "feedback") {
    const feedback = next.governance.feedback.find(item => item.id === command.id)
    if (!feedback) return { data, error: "의견 기록이 없습니다. 가짜 후기를 생성하지 않습니다." }
    if (!["pending", "confirmed", "revision-review"].includes(command.review)) return { data, error: "확인 상태를 검토해 주세요." }
    feedback.review = command.review
    return { error: null, data: audited(next, "피드백 운영 확인 상태 수정 · 공개 실행 없음", command.id, command.reason, now) }
  }
  if (command.kind === "template") {
    const template = next.governance.templates.find(item => item.id === command.id)
    if (!template || !command.body.trim() || command.body.length > 500) return { data, error: "초안은 1~500자로 입력해 주세요." }
    template.body = command.body.trim()
    template.version += 1
    return { error: null, data: audited(next, "알림 템플릿 초안 수정 · 승인/발송 미연결", command.id, command.reason, now) }
  }
  if (command.kind === "settings") {
    const proposal = command.proposal
    if (!proposal.version.trim() || proposal.version === BEFORE_US.policyVersion || proposal.version.length > 30 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(proposal.disclosureTime) || ![proposal.longWaitingDays, proposal.introductionPrice, proposal.exchangePrice].every(value => Number.isSafeInteger(value) && value > 0) || proposal.responseHours !== null && (!Number.isSafeInteger(proposal.responseHours) || proposal.responseHours <= 0)) return { data, error: "현재 버전과 다른 검토안 버전·시간·양의 정수 설정을 확인해 주세요. 응답 기한은 미확정으로 둘 수 있습니다." }
    next.governance.settingsProposal = { ...proposal }
    return { error: null, data: audited(next, "미적용 운영 설정 검토안 저장 · 기존 회원/정책 소급 없음", proposal.version, command.reason, now) }
  }
  return { error: null, data: audited(next, "가상 관리자 진입 이벤트 · 실제 로그인 아님", "demo-session", command.reason, now) }
}
export function publicFeedbackCandidate(feedback: Feedback) {
  return !!feedback.publicConsentAt && feedback.consentVersion === feedback.version && feedback.review === "confirmed" && !feedback.reportId
}
export type GovernanceCommand = Parameters<typeof governanceAction>[1]
export function operatingAnalytics(data: ConsoleData, range: DateRange | null, now = new Date()) {
  const valid = (at: string | null | undefined) => !!at && Number.isFinite(new Date(at).getTime()) && new Date(at) <= now
  const after = (later: string, earlier: string) => new Date(later).getTime() >= new Date(earlier).getTime()
  const latestResponse = (record: ReturnType<typeof introductionRows>[number]) => record.memberIds.map(id => new Date(record.responseAt[id]!).toISOString()).sort().slice(-1)[0]
  const introductions = introductionRows(data)
  const published = new Map<string, string[]>()
  for (const event of data.events.filter(item => item.stage === "introduction" && valid(item.at))) for (const id of event.memberIds) published.set(id, [...published.get(id) || [], event.at])
  for (const record of introductions.filter(item => valid(item.publishedAt))) for (const id of record.memberIds) published.set(id, [...published.get(id) || [], record.publishedAt!])
  const firstWait: number[] = [], intervals: number[] = [], untilMutual: number[] = []
  for (const member of data.admin.members) {
    const times = [...new Set((published.get(member.id) || []).map(at => new Date(at).toISOString()))].sort()
    const received = member.draft.review.receivedAt
    const first = times.find(at => valid(received) && after(at, received!))
    if (first && inRange(first, range, now)) firstWait.push((new Date(first).getTime() - new Date(received!).getTime()) / 86400000)
    for (let index = 1; index < times.length; index++) if (inRange(times[index], range, now)) intervals.push((new Date(times[index]).getTime() - new Date(times[index - 1]).getTime()) / 86400000)
    const mutual = introductions.filter(record => record.memberIds.includes(member.id) && valid(record.publishedAt) && record.memberIds.every(id => record.responses[id] === "positive" && valid(record.responseAt[id]) && after(record.responseAt[id]!, record.publishedAt!))).map(latestResponse).sort()[0]
    if (mutual && inRange(mutual, range, now)) {
      const count = times.filter(at => after(mutual, at) && valid(received) && after(at, received!)).length
      if (count) untilMutual.push(count)
    }
  }
  const bothPositive = (record: typeof introductions[number]) => record.memberIds.every(id => record.responses[id] === "positive" && valid(record.responseAt[id]) && valid(record.publishedAt) && after(record.responseAt[id]!, record.publishedAt!))
  const introductionCohort = introductions.filter(record => inRange(record.publishedAt, range, now))
  const mutualCohort = introductions.filter(record => bothPositive(record) && inRange(latestResponse(record), range, now))
  const startCohort = data.operations.exchanges.filter(record => inRange(record.actualStartedAt, range, now))
  const completeCohort = data.operations.exchanges.filter(record => valid(record.actualStartedAt) && inRange(record.completedAt || null, range, now) && after(record.completedAt!, record.actualStartedAt!))
  const rates = [
    { label: "소개 → 상호 선택", denominator: introductionCohort.length, numerator: introductionCohort.filter(bothPositive).length },
    { label: "상호 선택 → 양쪽 교류비 결제", denominator: mutualCohort.length, numerator: mutualCohort.filter(record => record.memberIds.every(id => data.payments.some(payment => payment.memberId === id && payment.kind === "exchange" && payment.programId === record.id && payment.refundAmount < payment.amount && valid(payment.paidAt) && after(payment.paidAt, latestResponse(record))))).length },
    { label: "교류 시작 → 3일 완료", denominator: startCohort.length, numerator: startCohort.filter(record => valid(record.completedAt) && after(record.completedAt!, record.actualStartedAt!)).length },
    { label: "3일 완료 → 양쪽 만남 희망", denominator: completeCohort.length, numerator: completeCohort.filter(record => valid(record.bothMeetingWishAt) && after(record.bothMeetingWishAt!, record.completedAt!)).length },
  ]
  const mean = (values: number[]) => ({ samples: values.length, value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null })
  return { firstWait: mean(firstWait), intervals: mean(intervals), untilMutual: mean(untilMutual), rates, unlinkedPayments: data.payments.filter(payment => payment.kind === "exchange" && !payment.programId && inRange(payment.paidAt, range, now)).length }
}
