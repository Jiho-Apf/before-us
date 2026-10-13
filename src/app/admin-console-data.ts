import { useSyncExternalStore, type Dispatch, type SetStateAction } from "react"
import { BEFORE_US } from "./config"
import { STATUS_MESSAGES, waitingFollowUp, EMPTY_NOTICE_PREFERENCES } from "./noon-status-model"
import { accountAge } from "./application-model"
import type { GovernanceData } from "./admin-governance-model"
import type {
  OperationsData,
  IntroductionRecord,
  IntroductionStage,
} from "./admin-operations-model"
import {
  adminTransition,
  emptyAdmin,
  loadAdminFixtures,
  reviewIssues,
  seoulDate,
  type AdminMember,
  type AdminState,
} from "./admin-model"

export const ADMIN_ACCESS = {
  mode: "demo",
  role: "owner",
  serverAuthorized: false,
  roles: ["owner", "operator", "support", "finance"],
} as const
export type Period = "today" | "7" | "30" | "custom"
export type DateRange = {
  start: string
  end: string
}
export const FUNNEL = [
  { id: "application", label: "소개 신청" },
  { id: "review", label: "검토 완료" },
  { id: "introduction", label: "첫 소개" },
  { id: "mutual", label: "상호 선택" },
  { id: "both-paid", label: "양쪽 교류비 결제" },
  { id: "exchange", label: "교류 시작" },
  { id: "completed", label: "3일 완료" },
  { id: "meeting", label: "양쪽 만남 희망" },
] as const
type FunnelStage = typeof FUNNEL[number]["id"]
type StageEvent = {
  id: string
  memberIds: string[]
  stage: FunnelStage
  at: string
}
type MemberOperational = {
  waitingSince: string | null
  recentIntroductionAt: string | null
  introductionCount: number | null
  responseDueAt: string | null
}
export type DemoPayment = {
  programId?: string | null
  id: string
  memberId: string
  kind: "introduction" | "exchange"
  amount: number
  paidAt: string
  refundRequestedAt: string | null
  refundedAt: string | null
  refundAmount: number
  refundRequestedAmount?: number | null
  refundBasis?: string
  refundPolicyVersion?: string | null
}
export type DemoReport = {
  id: string
  memberId: string
  status: "new" | "reviewing" | "checking" | "action" | "closed"
  reporterId?: string
  targetId?: string
  introductionId?: string | null
  exchangeId?: string | null
  type?: string
  description?: string
  hasAttachment?: boolean
  priority?: string
  assignee?: string | null
  actionNote?: string
  urgent: boolean
  createdAt: string
}
export type AuditEntry = {
  reason?: string
  role?: string
  result?: string
  id: string
  at: string
  actor: string
  action: string
  target: string
}
export type ConsoleData = {
  governance: GovernanceData
  operations: OperationsData
  admin: AdminState
  operational: Record<string, MemberOperational>
  events: StageEvent[]
  payments: DemoPayment[]
  reports: DemoReport[]
  audits: AuditEntry[]
  source: "empty" | "virtual"
}
export const emptyConsole = (): ConsoleData => ({
  governance: { feedback: [], settingsProposal: null, templates: [
    { id: "noon-state", name: "정오 대기 상태 · 가상 초안", body: STATUS_MESSAGES.waiting, version: 1, approval: "not-connected", delivery: "not-connected" },
    { id: "new-introduction", name: "새 소개 · 가상 초안", body: STATUS_MESSAGES.introduction, version: 1, approval: "not-connected", delivery: "not-connected" },
    { id: "mutual-selection", name: "상호 선택 · 가상 초안", body: STATUS_MESSAGES.mutual, version: 1, approval: "not-connected", delivery: "not-connected" },
  ] },
  operations: { introductions: [], exchanges: [], notes: [] },
  admin: emptyAdmin(),
  operational: {},
  events: [],
  payments: [],
  reports: [],
  audits: [],
  source: "empty",
})
let snapshot = emptyConsole()
const subscribers = new Set<() => void>()
export function getConsoleData() {
  return snapshot
}
const subscribe = (notify: () => void) => {
  subscribers.add(notify)
  return () => {
    subscribers.delete(notify)
  }
}
export function replaceConsoleData(next: ConsoleData) {
  snapshot = next
  subscribers.forEach((notify) => notify())
}
export function recordCandidateView(memberId: string, purpose: "신청 검토" | "양쪽 조건 비교", now = new Date()) {
  const member = snapshot.admin.members.find(item => item.id === memberId)
  if (!member || member.draft.values["consent.collection"] !== true ||
      member.draft.values["consent.matching"] !== true || !Number.isFinite(now.getTime())) return false
  const { profileVersion, preferenceVersion } = member.draft.review
  const action = `가상 후보 원본 열람 · ${purpose} · 프로필 v${profileVersion} / 선호 v${preferenceVersion}`
  if (snapshot.audits.some(item => item.target === memberId && item.action === action)) return true
  replaceConsoleData({
    ...snapshot,
    audits: [...snapshot.audits, {
      id: `candidate-view-${snapshot.audits.length + 1}`, actor: "가상 Owner",
      at: now.toISOString(), target: memberId, action, reason: purpose,
      role: "Owner", result: "demo-only",
    }],
  })
  return true
}
export const subscribeConsoleData = subscribe;
export function useConsoleData() {
  return useSyncExternalStore(subscribe, getConsoleData, getConsoleData)
}
export const setSharedAdmin: Dispatch<SetStateAction<AdminState>> = (
  update,
) => {
  const previous = snapshot.admin
  const next = typeof update === "function" ? update(previous) : update
  if (next === previous) return
  const at = next.stateUpdatedAt || new Date().toISOString()
  const newEvents: StageEvent[] = []
  const operational = { ...snapshot.operational }
  for (const member of next.members) {
    const old = previous.members.find((item) => item.id === member.id)
    if (member.disposition === "waiting" && old?.disposition !== "waiting")
      operational[member.id] = {
        recentIntroductionAt:
          operational[member.id]?.recentIntroductionAt ?? null,
        introductionCount: operational[member.id]?.introductionCount ?? null,
        responseDueAt: operational[member.id]?.responseDueAt ?? null,
        waitingSince: at,
      }
    if (
      member.lastReviewedAt &&
      member.lastReviewedAt !== old?.lastReviewedAt &&
      member.draft.review.profileReview === "reviewed"
    )
      newEvents.push({
        id: `review-${member.id}-${member.lastReviewedAt}`,
        memberIds: [member.id],
        stage: "review",
        at: member.lastReviewedAt,
      })
  }
  replaceConsoleData({
    ...snapshot,
    source: "virtual",
    admin: next,
    operational,
    events: [...snapshot.events, ...newEvents],
    audits: [
      ...snapshot.audits,
      {
        id: `audit-${snapshot.audits.length + 1}`,
        at,
        actor: "가상 Owner",
        action: "가상 검토 상태 변경",
        target: `revision ${next.revision}`,
      },
    ],
  })
}
export function useSharedAdmin(): [AdminState, Dispatch<SetStateAction<AdminState>>] {
  const data = useConsoleData()
  return [data.admin, setSharedAdmin]
}
export function loadReviewFixtures() {
  const data = emptyConsole()
  data.source = "virtual"
  data.admin = loadAdminFixtures()
  data.audits = [
    {
      id: "review-fixtures",
      at: new Date().toISOString(),
      actor: "가상 Owner",
      action: "가상 후보 검토 사례로 자료 초기화",
      target: "데모 자료만",
    },
  ]
  replaceConsoleData(data)
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(new Date(`${value}T00:00:00+09:00`).getTime()) &&
    seoulDate(new Date(`${value}T00:00:00+09:00`)) === value
  )
}
export function periodRange(
  period: Period,
  now = new Date(),
  custom?: DateRange,
): DateRange | null {
  if (period === "custom")
    return custom &&
      validDate(custom.start) &&
      validDate(custom.end) &&
      custom.start <= custom.end
      ? custom
      : null
  const end = seoulDate(now)
  const days = period === "today" ? 0 : Number(period) - 1
  return {
    start: new Date(new Date(`${end}T00:00:00Z`).getTime() - days * 86400000)
      .toISOString()
      .slice(0, 10),
    end,
  }
}
export function inRange(at: string | null, range: DateRange | null, now: Date) {
  if (!at || !range) return false
  const date = new Date(at)
  return (
    Number.isFinite(date.getTime()) &&
    date <= now &&
    seoulDate(date) >= range.start &&
    seoulDate(date) <= range.end
  )
}
export function waitingDays(since: string | null, now: Date): number | null {
  if (
    !since ||
    !Number.isFinite(new Date(since).getTime()) ||
    new Date(since) > now
  )
    return null
  return Math.floor(
    (new Date(`${seoulDate(now)}T00:00:00Z`).getTime() -
      new Date(`${seoulDate(new Date(since))}T00:00:00Z`).getTime()) /
      86400000,
  )
}
export function waitingBucket(days: number | null) {
  return days === null
    ? "unknown"
    : days <= 3
      ? "0-3"
      : days <= 7
        ? "4-7"
        : days <= 14
          ? "8-14"
          : "over14"
}
export type MemberSummary = {
  id: string
  submittedAt: string | null
  status: string
  gender: string
  available: boolean
  waiting: boolean
  waitingDays: number | null
  recentIntroductionAt: string | null
  introductionCount: number | null
  lastReviewedAt: string | null
  activity: AdminMember["activity"]
  photoReview: boolean
  identityPending: boolean
  overdue: boolean
  oneUnpaid: boolean
}
export function consoleMembers(
  data: ConsoleData,
  now = new Date(),
): MemberSummary[] {
  const today = seoulDate(now)
  return data.admin.members.map((member) => {
    const operational = data.operational[member.id]
    const otherSidePaid = data.events.some(
      (event) =>
        event.stage === "mutual" &&
        event.memberIds.includes(member.id) &&
        event.memberIds.some(
          (id) =>
            id !== member.id &&
            data.admin.members.find((other) => other.id === id)
              ?.exchangePayment === "paid-not-started",
        ),
    )
    return {
      id: member.id,
      submittedAt: member.draft.review.receivedAt,
      status: member.disposition,
      gender: String(member.draft.values["self.gender"] || "확인 필요"),
      available:
        (!member.lifecycle || member.lifecycle === "active") &&
        member.disposition === "reviewed" &&
        member.draft.review.profileReview === "reviewed" &&
        !member.draft.review.newProposalsPaused &&
        reviewIssues(member, today).length === 0 &&
        member.participation.available &&
        !!member.participation.confirmedAt &&
        member.rights === "valid" &&
        member.activity === "idle" &&
        !data.admin.proposals.some(
          (proposal) =>
            proposal.status !== "waiting" &&
            proposal.members.includes(member.id),
        ),
      waiting:
        (!member.lifecycle || member.lifecycle === "active") &&
        member.disposition === "waiting" &&
        member.activity === "idle",
      waitingDays: waitingDays(operational?.waitingSince || null, now),
      recentIntroductionAt: operational?.recentIntroductionAt || null,
      introductionCount: operational?.introductionCount ?? null,
      lastReviewedAt: member.lastReviewedAt,
      activity: member.activity,
      photoReview: Object.values(member.draft.photos).some(
        (photo) => photo.file && photo.review !== "기준 확인",
      ),
      identityPending: accountAge(member.account, today) === null,
      overdue:
        member.activity === "introduction" &&
        !!operational?.responseDueAt &&
        new Date(operational.responseDueAt) < now,
      oneUnpaid:
        member.activity === "exchange-payment" &&
        member.exchangePayment === "none" &&
        otherSidePaid,
    }
  })
}
export function funnelCounts(
  data: ConsoleData,
  range: DateRange | null,
  now = new Date(),
) {
  return FUNNEL.map((stage) => {
    const ids = new Set(
      data.events
        .filter(
          (event) => event.stage === stage.id && inRange(event.at, range, now),
        )
        .flatMap((event) => event.memberIds),
    )
    if (stage.id === "application")
      for (const member of consoleMembers(data, now))
        if (inRange(member.submittedAt, range, now)) ids.add(member.id)
    return { ...stage, count: ids.size }
  })
}
export function paymentTotals(
  data: ConsoleData,
  range: DateRange | null,
  now = new Date(),
) {
  const paid = data.payments.filter((payment) =>
    inRange(payment.paidAt, range, now),
  )
  const refunded = data.payments.filter((payment) =>
    inRange(payment.refundedAt, range, now),
  )
  const gross = paid.reduce((sum, payment) => sum + payment.amount, 0)
  const refund = refunded.reduce(
    (sum, payment) => sum + payment.refundAmount,
    0,
  )
  return {
    gross,
    introduction: paid.filter((payment) => payment.kind === "introduction"),
    exchange: paid.filter((payment) => payment.kind === "exchange"),
    requests: data.payments.filter((payment) =>
      inRange(payment.refundRequestedAt, range, now),
    ),
    refund,
    net: gross - refund,
  }
}
export const TODO_ITEMS = [
  { id: "waiting7", label: "7일 이상 · 실제 담당 검토 필요", path: "members" },
  { id: "waiting14", label: "14일 이상 소개 대기", path: "members" },
  { id: "new-report", label: "신규·긴급 신고", path: "safety" },
  { id: "photo-review", label: "사진 재검토", path: "applicants" },
  { id: "identity", label: "본인확인 대기", path: "applicants" },
  { id: "noon", label: "오늘 12시 공개 예정 검토", path: "introductions" },
  { id: "overdue", label: "응답 기한 초과", path: "introductions" },
  { id: "one-unpaid", label: "한쪽 교류비 미결제", path: "exchange" },
] as const
export function todoRecords(data: ConsoleData, id: string, now = new Date()) {
  const members = consoleMembers(data, now)
  if (id === "new-report")
    return data.reports.filter(
      (report) =>
        report.status !== "closed" &&
        (report.status === "new" || report.urgent),
    )
  if (id === "noon")
    return data.admin.proposals.filter(
      (proposal) =>
        proposal.status === "scheduled" &&
        proposal.scheduledAt &&
        seoulDate(new Date(proposal.scheduledAt)) === seoulDate(now),
    )
  return members.filter((member) =>
    id === "waiting7"
      ? member.waiting && !!waitingFollowUp({ memberId: member.id, stage: "waiting", operatorReviewedAt: member.lastReviewedAt, waitingSince: data.operational[member.id]?.waitingSince || null, lastIntroductionAt: member.recentIntroductionAt, preferences: EMPTY_NOTICE_PREFERENCES }, now)?.needsReview
      : id === "waiting14"
      ? member.waiting && !!waitingFollowUp({ memberId: member.id, stage: "waiting", operatorReviewedAt: member.lastReviewedAt, waitingSince: data.operational[member.id]?.waitingSince || null, lastIntroductionAt: member.recentIntroductionAt, preferences: EMPTY_NOTICE_PREFERENCES }, now)?.counseling
      : id === "photo-review"
        ? member.photoReview
        : id === "identity"
          ? member.identityPending
          : id === "overdue"
            ? member.overdue
            : id === "one-unpaid"
              ? member.oneUnpaid
              : false,
  )
}
export function loadConsoleFixtures(now = new Date()): ConsoleData {
  const data = emptyConsole()
  data.source = "virtual"
  const ago = (days: number) =>
    new Date(now.getTime() - days * 86400000).toISOString()
  const noonAgo = (days: number) => {
    let date = new Date(`${seoulDate(new Date(ago(days)))}T12:00:00+09:00`)
    if (date > now) date = new Date(date.getTime() - 86400000)
    return date.toISOString()
  }
  for (let index = 0; index < 12; index++) {
    const creationDays = index < 4 ? [6, 9, 15, 22][index] : index === 4 ? 0 : 4
    let fixture = loadAdminFixtures(new Date(ago(creationDays)))
    const base = fixture.members[index % 2]
    fixture.members = [base]
    fixture = adminTransition(
      fixture,
      fixture.revision,
      { kind: "review", memberId: base.id },
      new Date(ago(index === 4 ? 0 : Math.min(3, creationDays))),
    ).state
    const member = fixture.members[0]
    member.id = `virtual-${String(index + 1).padStart(2, "0")}`
    member.rights = "valid"
    if (index < 4) {
      member.disposition = "waiting"
      member.draft.review.receivedAt = ago([6, 9, 15, 22][index])
      member.rights = index === 2 ? "none" : "valid"
    }
    if (index === 4) {
      member.rights = "none"
      member.disposition = "pending"
      member.draft.review.profileReview = "pending"
      member.account = {}
      member.lastReviewedAt = null
      member.operatorId = null
    }
    if (index === 5) {
      member.disposition = "photo-revision"
      member.draft.photos["photo.face"].review = "재등록 요청"
      member.draft.photos["photo.face"].reason = "흐림"
      member.draft.review.profileReview = "pending"
    }
    if (index === 6 || index === 7) member.activity = "introduction"
    if (index === 8 || index === 9) {
      member.activity = "exchange-payment"
      member.exchangePayment = index === 8 ? "paid-not-started" : "none"
    }
    if (index >= 10) {
      member.activity = "exchange"
      member.exchangePayment = "started"
      member.rights = "first-program-started"
    }
    data.admin.members.push(member)
    data.operational[member.id] = {
      waitingSince: index < 4 ? ago([2, 5, 11, 18][index]) : null,
      recentIntroductionAt:
        index < 4
          ? noonAgo([3, 6, 12, 19][index])
          : index >= 6
            ? noonAgo(2)
            : null,
      introductionCount: index < 4 ? 1 : index >= 6 ? 1 : 0,
      responseDueAt: index === 6 ? ago(1) : null,
    }
    if (index < 4)
      data.events.push({
        id: `virtual-first-waiting-${index}`,
        memberIds: [member.id],
        stage: "introduction",
        at: noonAgo([3, 6, 12, 19][index]),
      })
    if (member.lastReviewedAt)
      data.events.push({
        id: `virtual-review-${index}`,
        memberIds: [member.id],
        stage: "review",
        at: member.lastReviewedAt,
      })
    if (index >= 6)
      data.events.push({
        id: `virtual-first-${index}`,
        memberIds: [member.id],
        stage: "introduction",
        at: noonAgo(2),
      })
    if (index !== 4)
      data.payments.push({
        id: `virtual-pay-${index}`,
        memberId: member.id,
        kind: "introduction",
        amount: BEFORE_US.pricing.introduction,
        paidAt: ago(index < 4 ? [4, 7, 13, 20][index] : 3),
        refundRequestedAt: index === 3 ? ago(0) : null,
        refundedAt: index === 2 ? ago(0) : null,
        refundAmount: index === 2 ? BEFORE_US.pricing.introduction : 0,
      })
    if (index === 8 || index >= 10)
      data.payments.push({
        id: `virtual-exchange-${index}`,
        memberId: member.id,
        kind: "exchange",
        programId: index === 8 ? "virtual-intro-2" : "virtual-intro-3",
        amount: BEFORE_US.pricing.exchangePerPerson,
        paidAt: ago(1),
        refundRequestedAt: null,
        refundedAt: null,
        refundAmount: 0,
      })
  }
  data.events.push({
    id: "virtual-mutual-1",
    memberIds: ["virtual-09", "virtual-10"],
    stage: "mutual",
    at: ago(1),
  })
  for (const stage of ["mutual", "both-paid", "exchange"] as const)
    data.events.push({
      id: `virtual-${stage}-2`,
      memberIds: ["virtual-11", "virtual-12"],
      stage,
      at: ago(1),
    })
  data.reports = [
    {
      id: "virtual-report-1",
      memberId: "virtual-07",
      status: "new",
      urgent: true,
      createdAt: ago(0),
    },
    {
      id: "virtual-report-2",
      memberId: "virtual-08",
      status: "reviewing",
      urgent: false,
      createdAt: ago(1),
    },
    {
      id: "virtual-report-3",
      memberId: "virtual-11",
      status: "reviewing",
      urgent: false,
      createdAt: ago(0),
    },
  ]
  data.admin.stateUpdatedAt = now.toISOString()
  data.reports = data.reports.map((report, index) => ({ ...report, reporterId: index === 2 ? "virtual-12" : index === 1 ? "virtual-07" : "virtual-08", targetId: report.memberId, introductionId: index === 2 ? "virtual-intro-3" : "virtual-intro-1", exchangeId: index === 2 ? "virtual-exchange-1" : null, type: index === 0 ? "부적절한 메시지" : "기타", description: "가상 신고 절차 시연 자료입니다. 실제 신고 내용이나 편지 본문은 포함하지 않습니다.", hasAttachment: false, priority: report.urgent ? "긴급" : "일반", assignee: null, actionNote: "" }))
  data.admin.revision = 1
  data.audits = [
    {
      id: "virtual-audit-1",
      at: now.toISOString(),
      actor: "가상 Owner",
      action: "명시적으로 가상 집계 자료 불러오기",
      target: "데모 자료 12건 · 실제 DB/PG 아님",
    },
  ]
  data.operations = seedOperations(data, now)
  return data
}
function seedOperations(data: ConsoleData, now: Date): OperationsData {
  const ago = (days: number) =>
    new Date(now.getTime() - days * 86400000).toISOString()
  const pair = (
    id: string,
    memberIds: [string, string],
    stage: IntroductionStage,
  ): IntroductionRecord => ({
    id,
    memberIds,
    stage,
    proposedAt: ago(3),
    publishedAt: data.operational[memberIds[0]]?.recentIntroductionAt || null,
    responseDueAt: stage === "response" ? ago(1) : null,
    profileVersions: Object.fromEntries(
      memberIds.map((memberId) => [
        memberId,
        data.admin.members.find((member) => member.id === memberId)?.draft
          .review.profileVersion || null,
      ]),
    ),
    responses: Object.fromEntries(
      memberIds.map((memberId) => [
        memberId,
        stage === "response" ? null : "positive",
      ]),
    ),
    responseAt: Object.fromEntries(
      memberIds.map((memberId) => [
        memberId,
        stage === "response" ? null : ago(1),
      ]),
    ),
    plannedStartAt: null,
    plan: null,
    endedAt: null,
  })
  const introductions = [
    pair("virtual-intro-1", ["virtual-07", "virtual-08"], "response"),
    pair("virtual-intro-2", ["virtual-09", "virtual-10"], "payment"),
    pair("virtual-intro-3", ["virtual-11", "virtual-12"], "starting"),
  ]
  introductions[2].stage = "ended"
  introductions[2].endedAt = ago(1)
  introductions[2].plan = "A"
  introductions[2].plannedStartAt = ago(1)
  const date = seoulDate(new Date(ago(1)))
  return {
    introductions,
    notes: [],
    exchanges: [
      {
        id: "virtual-exchange-1",
        introductionId: "virtual-intro-3",
        memberIds: ["virtual-11", "virtual-12"],
        plan: "A",
        startDate: date,
        actualStartedAt: ago(1),
        bothAgreed: true,
        bothPaid: true,
        submissions: {
          [date]: { "virtual-11": ago(1), "virtual-12": ago(1) },
          [seoulDate(now)]: {
            "virtual-11": now.toISOString(),
            "virtual-12": null,
          },
        },
        delayed: false,
        stoppedAt: null,
        reportIds: ["virtual-report-3"],
      },
    ],
  }
}
