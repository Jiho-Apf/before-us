import { benefitIssue, introductionLimit, planFor } from "./introduction-plan"
import { accountAge } from "./application-model"
import { operatorApplicationOriginal } from "./application-review"
import { PHOTO_SLOTS } from "./photo-model"
import { adminTransition, seoulDate } from "./admin-model"
import {
  consoleMembers,
  inRange,
  periodRange,
  todoRecords,
  waitingBucket,
  type ConsoleData,
} from "./admin-console-data"
import { EMPTY_TODAY, programDay } from "./today-state"

export type IntroductionStage = "selection-needed" | "preparation" | "scheduled" | "published" | "response" | "mutual" | "payment" | "agreement" | "starting" | "ended"
export type IntroductionRecord = {
  id: string
  memberIds: [string, string]
  stage: IntroductionStage
  proposedAt: string | null
  publishedAt: string | null
  responseDueAt: string | null
  profileVersions: Record<string, number | null>
  responses: Record<string, "positive" | "negative" | null>
  responseAt: Record<string, string | null>
  plannedStartAt: string | null
  plan: "A" | "B" | null
  endedAt: string | null
}
export type ExchangeRecord = {
  completedAt?: string | null
  bothMeetingWishAt?: string | null
  id: string
  introductionId: string
  memberIds: [string, string]
  plan: "A" | "B" | null
  startDate: string | null
  actualStartedAt: string | null
  bothAgreed: boolean
  bothPaid: boolean
  submissions: Record<string, Record<string, string | null>>
  delayed: boolean
  stoppedAt: string | null
  reportIds: string[]
}
export type OperatorNote = {
  id: string
  memberId: string
  body: string
  at: string
  profileVersion: number
}
export type OperationsData = {
  introductions: IntroductionRecord[]
  exchanges: ExchangeRecord[]
  notes: OperatorNote[]
}
export const emptyOperations = (): OperationsData => ({
  introductions: [],
  exchanges: [],
  notes: [],
})
export const INTRO_STAGES = [
  { id: "selection-needed", label: "후보 선정 필요" },
  { id: "preparation", label: "소개 준비·첫 결제" },
  { id: "scheduled", label: "공개 예약" },
  { id: "published", label: "오늘 소개" },
  { id: "response", label: "응답 대기" },
  { id: "mutual", label: "상호 선택" },
  { id: "payment", label: "교류비 결제 대기" },
  { id: "agreement", label: "A/B 합의" },
  { id: "starting", label: "시작 예정" },
  { id: "ended", label: "종료" },
] as const
export const MEMBER_STATES = [
  { id: "all", label: "전체" },
  { id: "available", label: "소개 가능" },
  { id: "waiting", label: "후보 대기" },
  { id: "response", label: "활성 소개" },
  { id: "payment", label: "결제 대기" },
  { id: "active", label: "교류 중" },
  { id: "paused", label: "일시정지" },
  { id: "blocked", label: "차단" },
  { id: "withdrawal-requested", label: "탈퇴 요청" },
] as const
// 소개비 혜택 구분 (V6-intro-plan-02). 환불되지 않은 가장 최근 소개비 결제를 기준으로 본다.
export type BenefitKey = "standard" | "bonus" | "standard-ended" | "started" | "none"
export const BENEFIT_LABELS: Record<BenefitKey, string> = {
  standard: "기본 소개 중",
  bonus: "한 번 더, 5번 진행 중",
  "standard-ended": "소개 소진",
  started: "첫 교류 시작 · 혜택 종료",
  none: "소개비 미결제",
}
export function introductionBenefit(data: ConsoleData, memberId: string, now = new Date()) {
  const payment = data.payments
    .filter((item) => item.memberId === memberId && item.kind === "introduction" && item.refundAmount < item.amount)
    .sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt))[0]
  if (!payment) return { key: "none" as BenefitKey, label: BENEFIT_LABELS.none, detail: "결제 후 혜택이 정해져요", paidAt: null, endsAt: null }
  const plan = planFor(new Date(payment.paidAt))
  const started = data.admin.members.find((member) => member.id === memberId)?.rights === "first-program-started"
  const received = data.events.filter((event) => event.stage === "introduction" && event.memberIds.includes(memberId) && Date.parse(event.at) >= Date.parse(payment.paidAt)).length
  const ended = benefitIssue(payment.paidAt, received, started, now)
  const limit = introductionLimit(payment.paidAt, now)
  const key: BenefitKey = started ? "started" : ended ? "standard-ended" : received >= plan.introductions ? "bonus" : "standard"
  const detail = key === "bonus" ? `${received - plan.introductions}/${plan.bonus.introductions}번 받음 · 추가 비용 없음`
    : key === "standard" ? `${received}/${plan.introductions}번 받음${plan.bonus.eligible ? " · 한 번 더 대상" : ""}`
    : key === "standard-ended" ? `${limit}번 모두 받음 · 재결제 필요`
    : "이번 소개비 혜택 끝"
  return { key, label: BENEFIT_LABELS[key], detail, paidAt: payment.paidAt, endsAt: plan.endsAt }
}
export function applicantRows(data: ConsoleData, now = new Date()) {
  const summary = consoleMembers(data, now)
  return data.admin.members.map((member) => {
    const allowed = !!operatorApplicationOriginal(member.draft, member.account)
    const record = summary.find((item) => item.id === member.id)!
    const photoStates = Object.values(member.draft.photos)
      .filter((photo) => photo.file)
      .map((photo) => photo.review)
    return {
      ...record,
      benefit: introductionBenefit(data, member.id, now),
      name: allowed
        ? String(member.draft.values["self.name"] || "미입력")
        : "검토 동의 전",
      age: allowed ? accountAge(member.account, seoulDate(now)) : null,
      region: allowed
        ? String(member.draft.values["self.province"] || "확인 필요")
        : "비공개",
      purpose: allowed
        ? String(member.draft.values["self.purpose"] || "미입력")
        : "비공개",
      gender: allowed ? record.gender : "비공개",
      photoStatus: !allowed
        ? "검토 동의 전"
        : photoStates.includes("재등록 요청")
          ? "재등록 요청"
          : PHOTO_SLOTS.some(
                (slot) => slot.required && !member.draft.photos[slot.id].file,
              )
            ? "등록 필요"
            : photoStates.includes("대기")
              ? "기준 확인 대기"
              : "기준 확인",
      profileStatus: member.draft.review.profileReview,
      profileVersion: member.draft.review.profileVersion,
      preparation: data.admin.proposals.some(
        (proposal) =>
          proposal.status !== "waiting" && proposal.members.includes(member.id),
      )
        ? "준비·예약 중"
        : member.rights === "none"
          ? "미결제 · 준비 전"
          : "미준비",
      lifecycle: member.lifecycle || "active",
    }
  })
}
export function filteredApplicants(
  data: ConsoleData,
  params: URLSearchParams,
  now = new Date(),
) {
  const filter = params.get("filter") || "all"
  const today = seoulDate(now)
  const range =
    params.has("start") || params.has("end")
      ? periodRange("custom", now, {
          start: params.get("start") || "",
          end: params.get("end") || "",
        })
      : null
  return applicantRows(data, now).filter((row) => {
    const search = (params.get("search") || "").replace(/\s/g, "").toLowerCase()
    if (
      search &&
      !row.id.replace(/\s/g, "").toLowerCase().includes(search) &&
      !(
        row.name !== "검토 동의 전" &&
        row.name.replace(/\s/g, "").toLowerCase().includes(search)
      )
    )
      return false
    if (params.get("member") && row.id !== params.get("member")) return false
    if (params.get("gender") && row.gender !== params.get("gender"))
      return false
    if (params.get("region") && row.region !== params.get("region"))
      return false
    if (params.get("purpose") && row.purpose !== params.get("purpose"))
      return false
    for (const key of ["ageMin", "ageMax"] as const)
      if (
        params.get(key) &&
        (!/^\d+$/.test(params.get(key)!) ||
          row.age === null ||
          (key === "ageMin"
            ? row.age < Number(params.get(key))
            : row.age > Number(params.get(key))))
      )
        return false
    if (
      params.get("ageMin") &&
      params.get("ageMax") &&
      Number(params.get("ageMin")) > Number(params.get("ageMax"))
    )
      return false
    if (
      (filter === "period" || params.get("dateFilter") === "on") &&
      !inRange(row.submittedAt, range, now)
    )
      return false
    if (
      filter === "today" &&
      !inRange(row.submittedAt, { start: today, end: today }, now)
    )
      return false
    if (params.get("review") && row.status !== params.get("review"))
      return false
    if (params.get("photo") && row.photoStatus !== params.get("photo"))
      return false
    if (params.get("benefit") && row.benefit.key !== params.get("benefit"))
      return false
    if (params.get("identity") === "pending" && !row.identityPending)
      return false
    if (params.get("identity") === "confirmed" && row.identityPending)
      return false
    if (
      [
        "waiting14",
        "waiting7",
        "photo-review",
        "identity",
        "overdue",
        "one-unpaid",
      ].includes(filter)
    )
      return todoRecords(data, filter, now).some((item) => item.id === row.id)
    if (filter.startsWith("wait-"))
      return row.waiting && waitingBucket(row.waitingDays) === filter.slice(5)
    if (
      filter === "available" ||
      filter === "available-male" ||
      filter === "available-female"
    )
      return (
        row.available &&
        (filter === "available" ||
          row.gender === (filter === "available-male" ? "남성" : "여성"))
      )
    if (filter === "waiting") return row.waiting
    if (filter === "pending" || filter === "photo-revision")
      return row.status === filter
    if (["paused", "blocked", "withdrawal-requested"].includes(filter))
      return row.lifecycle === filter
    if (filter === "response") return row.activity === "introduction"
    if (filter === "payment")
      return (
        row.activity === "exchange-payment" ||
        (row.preparation === "준비·예약 중" &&
          data.admin.members.find((member) => member.id === row.id)?.rights ===
            "none")
      )
    if (filter === "active") return row.activity === "exchange"
    return true
  })
}
export function protectedSupply(data: ConsoleData, now = new Date()) {
  const available = applicantRows(data, now).filter((row) => row.available)
  const display = (count: number) =>
    count === 0 ? "0명" : count < 5 ? "5명 미만 · 비공개" : `${count}명`
  const ageBands = [
    { label: "19~29세", min: 19, max: 29 },
    { label: "30~39세", min: 30, max: 39 },
    { label: "40~49세", min: 40, max: 49 },
    { label: "50세 이상", min: 50, max: Infinity },
  ]
  const regions = [
    { label: "수도권", values: ["서울", "경기", "인천"] },
    { label: "중부권", values: ["강원", "대전", "세종", "충북", "충남"] },
    { label: "영남권", values: ["부산", "대구", "울산", "경북", "경남"] },
    { label: "호남·제주권", values: ["광주", "전북", "전남", "제주"] },
  ]
  return [
    ...["남성", "여성"].map((gender) => ({
      label: `현재 소개 가능 ${gender}`,
      value: display(available.filter((row) => row.gender === gender).length),
    })),
    ...ageBands.map((band) => ({
      label: band.label,
      value: display(
        available.filter(
          (row) =>
            row.age !== null && row.age >= band.min && row.age <= band.max,
        ).length,
      ),
    })),
    ...regions.map((region) => ({
      label: region.label,
      value: display(
        available.filter((row) => region.values.includes(row.region)).length,
      ),
    })),
  ]
}
export function introductionRows(data: ConsoleData): IntroductionRecord[] {
  const recorded = data.operations.introductions
  return [
    ...recorded,
    ...data.admin.proposals
      .filter(
        (proposal) => !recorded.some((record) => record.id === proposal.id),
      )
      .map((proposal) => ({
        id: proposal.id,
        memberIds: proposal.members,
        stage:
          proposal.status === "waiting"
            ? "ended" as const
            : proposal.status === "scheduled"
              ? "scheduled" as const
              : "preparation" as const,
        proposedAt: proposal.preparedAt,
        publishedAt: null,
        responseDueAt: null,
        profileVersions: Object.fromEntries(
          proposal.members.map((id) => [id, proposal.versions[id].profile]),
        ),
        responses: {},
        responseAt: {},
        plannedStartAt: null,
        plan: null,
        endedAt: null,
      })),
  ]
}
export function exchangeDay(record: ExchangeRecord, now = new Date()) {
  if (!record.actualStartedAt || new Date(record.actualStartedAt) > now)
    return null
  return programDay(
    {
      ...EMPTY_TODAY,
      programStartedAt: record.actualStartedAt,
      agreedStartDate: record.startDate,
      bothAgreed: record.bothAgreed,
      mutualSelected: true,
      payments: { own: record.bothPaid, partner: record.bothPaid },
      agreedPlan: record.plan,
    },
    seoulDate(now),
  )
}
export function memberPayment(data: ConsoleData, memberId: string) {
  const paid = data.payments.filter(
    (payment) =>
      payment.memberId === memberId &&
      payment.kind === "exchange" &&
      payment.refundAmount < payment.amount,
  )
  return paid.length ? `결제 기록 있음 · ${paid.length}건` : "결제 기록 없음"
}
export function addOperatorNote(
  data: ConsoleData,
  memberId: string,
  body: string,
  now = new Date(),
) {
  const member = data.admin.members.find((item) => item.id === memberId)
  if (!member || !operatorApplicationOriginal(member.draft, member.account))
    return {
      data,
      error: "운영자 검토 동의 확인 전에는 메모를 작성할 수 없습니다.",
    }
  if (!body.trim() || Array.from(body.trim()).length > 500)
    return { data, error: "운영 메모는 1~500자로 작성해 주세요." }
  if (/(?:https?:|@|\d[\d\s-]{6,}|신분증|주민등록번호)/i.test(body))
    return { data, error: "연락처·SNS·신분 자료는 운영 메모에 넣지 마세요." }
  const at = now.toISOString()
  const note: OperatorNote = {
    id: `note-${data.operations.notes.length + 1}`,
    memberId,
    body: body.trim(),
    at,
    profileVersion: member.draft.review.profileVersion,
  }
  return {
    error: null,
    data: {
      ...data,
      operations: {
        ...data.operations,
        notes: [...data.operations.notes, note],
      },
      audits: [
        ...data.audits,
        {
          id: `audit-note-${data.audits.length + 1}`,
          at,
          actor: "가상 Owner",
          action: "운영 메모 추가 · 본문은 감사로그에서 제외",
          target: memberId,
        },
      ],
    },
  }
}
export function handleIntroduction(
  data: ConsoleData,
  id: string,
  action: "cancel" | "support" | "correction",
  now = new Date(),
) {
  const record = introductionRows(data).find((item) => item.id === id)
  if (!record) return { data, error: "소개 기록을 찾을 수 없습니다." }
  if (
    action === "cancel" &&
    (record.stage === "ended" ||
      data.operations.exchanges.some(
        (exchange) =>
          exchange.introductionId === id &&
          exchange.actualStartedAt &&
          !exchange.stoppedAt,
      ))
  )
    return {
      data,
      error:
        "종료·활성 교류는 소개 취소로 덮어쓸 수 없습니다. 별도 안전·문의 절차가 필요합니다.",
    }
  let next = structuredClone(data)
  if (action === "cancel") {
    const proposal = data.admin.proposals.find((item) => item.id === id)
    if (proposal) {
      const result = adminTransition(
        next.admin,
        next.admin.revision,
        { kind: "release-to-waiting", proposalId: id },
        now,
      )
      if (result.errors.length)
        return { data, error: result.errors.join(" · ") }
      next.admin = result.state
    }
    next.operations.introductions = introductionRows(next).map((item) =>
      item.id === id
        ? { ...record, stage: "ended", endedAt: now.toISOString() }
        : item,
    )
    for (const member of next.admin.members.filter((item) =>
      record.memberIds.includes(item.id),
    )) {
      member.activity = "idle"
      if (record.publishedAt)
        member.previousIds = [
          ...new Set([
            ...member.previousIds,
            ...record.memberIds.filter((id) => id !== member.id),
          ]),
        ]
      member.disposition = "waiting"
      if (member.exchangePayment === "paid-not-started")
        member.unstartedPaymentReviewRequired = true
      next.operational[member.id] = {
        recentIntroductionAt:
          next.operational[member.id]?.recentIntroductionAt || null,
        introductionCount:
          next.operational[member.id]?.introductionCount ?? null,
        responseDueAt: null,
        waitingSince: now.toISOString(),
      }
    }
    next.admin.revision += 1
    next.admin.stateUpdatedAt = now.toISOString()
  }
  next.audits.push({
    id: `audit-intro-${next.audits.length + 1}`,
    at: now.toISOString(),
    actor: "가상 Owner",
    action:
      action === "cancel"
        ? "소개 취소 · 권리/거래/응답 보존"
        : action === "support"
          ? "문의 처리 검토 접수"
          : "오류 보완 검토 접수",
    target: id,
  })
  return { data: next, error: null }
}
export function requestExchangeContent(
  data: ConsoleData,
  id: string,
  now = new Date(),
) {
  const exchange = data.operations.exchanges.find((item) => item.id === id)
  if (
    !exchange ||
    !exchange.reportIds.some((reportId) =>
      data.reports.some(
        (report) =>
          report.id === reportId &&
          exchange.memberIds.includes(report.memberId),
      ),
    )
  )
    return {
      data,
      error: "연결된 신고가 없습니다. 편지·초안은 열람할 수 없습니다.",
    }
  return {
    error:
      "열람 차단: 실제 서버 별도 권한·고지된 목적 확인이 미연결입니다. 본문을 제공하지 않습니다.",
    data: {
      ...data,
      audits: [
        ...data.audits,
        {
          id: `audit-access-${data.audits.length + 1}`,
          at: now.toISOString(),
          actor: "가상 Owner",
          action: "신고 검토 목적 본문 열람 요청 · 서버 권한 미연결로 차단",
          target: id,
        },
      ],
    },
  }
}
