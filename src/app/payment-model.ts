import { BEFORE_US } from "./config"
import type { TodaySnapshot } from "./today-state"
import { emptyRefundOperations, REFUND_NOTICE, recordDayAvailability, refundDeadlines, refundQuote, waitingRefundAvailable, type RefundOperations, type RefundReason } from "./refund-policy"

export type ReceiptStatus = "requested" | "confirmed" | "failed" | "cancellation-requested" | "refund-review" | "refunded"
export type OwnReceipt = {
  disclosure?: { at: string; policyVersion: string; scope: string; vatIncluded: boolean; refundPolicy: string | null; demo: true }
  id: string
  key: string
  kind: "introduction" | "exchange"
  programId: string | null
  amount: number
  attempts: number
  status: ReceiptStatus
  confirmedAt: string | null
  cancelRequestedAt: string | null
  refundedAt: string | null
  refundAmount?: number
  refundRequest?: ReturnType<typeof refundQuote> & { at: string; requestedReason: RefundReason }
}
export type PaymentSession = {
  demo: true
  applicationId: string
  policy: {
    version: string
    introduction: number
    exchange: number
    vatIncluded: boolean
    refund: string | null
    refundPolicyVersion?: string
  }
  activity: "active" | "paused" | "withdrawal-requested"
  preparation: {
    candidateReady: boolean
    participationConfirmed: boolean
    scopeConfirmed: boolean
    checkedAt: string | null
  }
  introduction: OwnReceipt | null
  exchange: OwnReceipt | null
  program: {
    id: string
    ownSelection: "positive" | "negative" | null
    mutualConfirmedAt: string | null
    partnerPayment: "unconfirmed" | "confirmed"
    withdrawn: boolean
    ownPlan: "A" | "B" | null
    partnerPlan: "A" | "B" | null
    ownStartAt: string | null
    partnerStartAt: string | null
    usable: boolean
    actualStartedAt: string | null
    startEventId: string | null
    endReason?: "partner-unpaid" | "agreement-timeout" | "never-started"
  } | null
  firstProgramStartedAt: string | null
  refundOperations?: RefundOperations
}
export const RECEIPT_LABELS: Record<ReceiptStatus, string> = {
  requested: "가상 요청 대기 · 승인 아님",
  confirmed: "가상 승인 기록",
  failed: "가상 실패 기록",
  "cancellation-requested": "취소 요청 · 처리 전",
  "refund-review": "환불 검토 중 · 완료 아님",
  refunded: "가상 환불 완료 기록",
}
export function emptyPaymentSession(
  applicationId = "demo-application",
): PaymentSession {
  return {
    demo: true,
    applicationId,
    policy: {
      version: BEFORE_US.policyVersion,
      introduction: BEFORE_US.pricing.introduction,
      exchange: BEFORE_US.pricing.exchangePerPerson,
      vatIncluded: BEFORE_US.pricing.vatIncluded,
      refund: REFUND_NOTICE,
      refundPolicyVersion: BEFORE_US.refund.version,
    },
    activity: "active",
    preparation: {
      candidateReady: false,
      participationConfirmed: false,
      scopeConfirmed: false,
      checkedAt: null,
    },
    introduction: null,
    exchange: null,
    program: null,
    firstProgramStartedAt: null,
    refundOperations: emptyRefundOperations(),
  }
}
const validAt = (at: string | null, now: Date) =>
  !!at && Number.isFinite(Date.parse(at)) && Date.parse(at) <= now.getTime()
export function hasMutualSelection(session: PaymentSession, now = new Date()) {
  return (
    !!session.program &&
    session.program.ownSelection === "positive" &&
    validAt(session.program.mutualConfirmedAt, now)
  )
}
export function readyForIntroduction(
  session: PaymentSession,
  now = new Date(),
) {
  const preparation = session.preparation
  return (
    preparation.candidateReady &&
    preparation.participationConfirmed &&
    preparation.scopeConfirmed &&
    validAt(preparation.checkedAt, now)
  )
}
export function validOwnPayment(receipt: OwnReceipt | null, now = new Date()) {
  return (
    !!receipt &&
    ["confirmed", "cancellation-requested", "refund-review"].includes(
      receipt.status,
    ) &&
    validAt(receipt.confirmedAt, now) &&
    !receipt.refundedAt
  )
}
export function introductionRights(session: PaymentSession, now = new Date()) {
  if (validAt(session.firstProgramStartedAt, now))
    return "first-program-started"
  return validOwnPayment(session.introduction, now) ? "valid" : "none"
}
export function paymentGate(
  session: PaymentSession,
  kind: "introduction" | "exchange",
  now = new Date(),
) {
  if (session.activity !== "active")
    return "현재 활동 상태에서는 새 결제 요청을 받지 않습니다. 기존 권리·환불 여부는 별도 검토합니다."
  if (introductionRights(session, now) === "first-program-started")
    return "이번 신청의 첫 교류가 실제 시작되어 소개 혜택이 종료됐습니다. 정상 종료 뒤 새 회차 소개비 5,000원으로 다시 이용할 수 있어요(V6-conduct-01)."
  if (kind === "introduction") {
    if (!readyForIntroduction(session, now))
      return "소개 제공 준비·현재 참여 가능·프로필 제공 범위 확인 후 안내합니다. 지금은 무료 대기입니다."
    if (validOwnPayment(session.introduction, now))
      return "이미 낸 소개비가 있습니다. 첫 교류 전 추가 소개비는 없습니다."
    if (session.introduction?.status === "confirmed")
      return "기존 소개비 승인 기록을 확인해야 합니다. 다시 청구하지 않습니다."
    if (
      session.introduction &&
      ["cancellation-requested", "refund-review"].includes(
        session.introduction.status,
      )
    )
      return "기존 취소·환불 문의를 먼저 확인합니다. 새 청구나 자동 권리 소멸은 하지 않습니다."
    if (session.introduction?.status === "refunded")
      return "기존 환불 기록을 확인해야 합니다. 재이용은 내 정보의 새 회차 안내에서 확인해 주세요."
  } else {
    const program = session.program
    if (!program || !hasMutualSelection(session, now))
      return "양쪽의 상호 선택이 확인된 후에만 교류비를 안내합니다. 나의 좋아요나 상대 미응답만으로는 열리지 않습니다."
    const deadline = refundDeadlines(session).paymentAt
    if (deadline && now.getTime() >= Date.parse(deadline) && !validOwnPayment(session.exchange, now))
      return "상호 선택 후 기본 결제 기한 24시간이 지났습니다. 운영 확인·미결제 상대 처리와 환불 요청을 확인해 주세요."
    if (program.withdrawn)
      return "상대 철회로 시작 준비가 보류됐습니다. 소개 권리는 유지하고 교류비 미시작 처리는 별도 검토합니다."
    if (introductionRights(session, now) !== "valid")
      return "유효한 소개 이용 권리와 기납 소개비 확인이 필요합니다."
    if (session.introduction?.status !== "confirmed")
      return "소개비 취소·환불 요청을 먼저 검토해야 합니다. 권리를 자동 소멸시키지는 않습니다."
    if (session.exchange && session.exchange.programId !== program.id)
      return "이전 교류비는 다른 상대에게 자동 이전하거나 다시 청구하지 않습니다. 미시작 처리와 별도 동의가 필요합니다."
    if (
      session.exchange &&
      [
        "confirmed",
        "cancellation-requested",
        "refund-review",
        "refunded",
      ].includes(session.exchange.status)
    )
      return "이미 있는 교류비 기록을 확인합니다. 중복 청구하지 않습니다."
  }
  return null
}
export function canAgreeProgram(session: PaymentSession, now = new Date()) {
  const program = session.program
  const deadline = refundDeadlines(session).agreementAt
  const completedAt = session.refundOperations?.agreementCompletedAt
  const completedInTime = validAt(completedAt || null, now) && (!deadline || Date.parse(completedAt!) < Date.parse(deadline))
  return (
    !!program &&
    session.activity === "active" &&
    !program.withdrawn &&
    program.ownSelection === "positive" &&
    validAt(program.mutualConfirmedAt, now) &&
    session.introduction?.status === "confirmed" &&
    validOwnPayment(session.introduction, now) &&
    session.exchange?.status === "confirmed" &&
    validOwnPayment(session.exchange, now) &&
    session.exchange.programId === program.id &&
    program.partnerPayment === "confirmed"
    && (!deadline || completedInTime || validAt(session.firstProgramStartedAt, now) || now.getTime() < Date.parse(deadline))
  )
}
export function requestDemoPayment(
  session: PaymentSession,
  kind: "introduction" | "exchange",
  acknowledged: boolean,
  now = new Date(),
) {
  if (!acknowledged)
    return {
      session,
      error: "제공 범위·미보장·대기·미시작·취소·환불 안내를 확인해 주세요.",
    }
  const blocked = paymentGate(session, kind, now)
  if (blocked) return { session, error: blocked }
  const previous = session[kind]
  if (previous?.status === "requested")
    return {
      session,
      error: "같은 요청이 대기 중입니다. 중복 요청·청구하지 않습니다.",
    }
  const next = structuredClone(session)
  const programId = kind === "exchange" ? session.program!.id : null
  const key = `${session.applicationId}:${session.policy.version}:${kind}:${programId || "first-introduction"}`
  next[kind] = {
    id: previous?.id || `demo-${key}`,
    key,
    kind,
    programId,
    amount:
      kind === "introduction"
        ? session.policy.introduction
        : session.policy.exchange,
    attempts: (previous?.attempts || 0) + 1,
    status: "requested",
    disclosure: { at: now.toISOString(), policyVersion: session.policy.version, scope: kind === "introduction" ? "이번 신청의 첫 A/B 실제 시작 전 소개 횟수 제한 없음 · 하루 최대 한 명 · 매일 미보장 · 대기·미시작·취소·환불 안내 확인" : "상호 선택한 한 쌍의 A/B 3일 교류 · 1인 교류비 · 현장 비용 별도 · 미시작·취소·환불 안내 확인", vatIncluded: session.policy.vatIncluded, refundPolicy: session.policy.refund, demo: true },
    confirmedAt: null,
    cancelRequestedAt: null,
    refundedAt: null,
  }
  return { session: next, error: null }
}
export function requestPaymentCancellation(
  session: PaymentSession,
  kind: "introduction" | "exchange",
  now = new Date(),
  reason: RefundReason = "cancel",
) {
  const receipt = session[kind]
  if (!receipt || !["confirmed", "requested"].includes(receipt.status))
    return {
      session,
      error:
        "새 취소 요청을 받을 수 있는 결제 기록이 없습니다. 기존 문의 상태를 확인해 주세요.",
    }
  const next = structuredClone(session)
  const quote = refundQuote(session, kind, now, reason)
  if (reason !== "cancel" && quote.amount === null)
    return { session, error: quote.reason }
  next[kind]!.status = "cancellation-requested"
  next[kind]!.cancelRequestedAt = now.toISOString()
  next[kind]!.refundRequest = { ...quote, at: now.toISOString(), requestedReason: reason }
  if (kind === "exchange" && quote.restoreIntroductionRights && next.program &&
      ["partner-unpaid", "agreement-timeout", "never-started"].includes(reason)) {
    next.program.withdrawn = true
    next.program.endReason = reason as "partner-unpaid" | "agreement-timeout" | "never-started"
  }
  if (reason === "waiting-30" && next[kind]!.refundRequest!.amount !== null) {
    next.activity = "paused"
    next.refundOperations!.waitingChoice = "refund-exit"
  }
  return { session: next, error: null }
}
export function continueWaiting(session: PaymentSession, now: Date) {
  if (!waitingRefundAvailable(session, now)) return { session, error: "활성 연속 30일 대기·현재 권리 기록을 확인해 주세요." }
  const next = structuredClone(session)
  next.refundOperations!.waitingChoice = "continue"
  next.refundOperations!.activeWaitingSince = now.toISOString()
  return { session: next, error: null }
}
export type DemoStartEvent = {
  id: string
  startedAt: string
  usable: boolean
}
export function recordActualDemoStart(
  session: PaymentSession,
  event: DemoStartEvent,
  now = new Date(),
) {
  const program = session.program
  if (session.firstProgramStartedAt)
    return {
      session,
      error: "첫 실제 시작 기록은 이미 존재하며 다시 소멸·갱신하지 않습니다.",
    }
  if (
    !event.id ||
    !event.usable ||
    !program?.usable ||
    !canAgreeProgram(session, now) ||
    !program.ownPlan ||
    program.ownPlan !== program.partnerPlan ||
    !program.ownStartAt ||
    program.ownStartAt !== program.partnerStartAt ||
    !validAt(program.ownStartAt, now) ||
    !validAt(event.startedAt, now) ||
    Date.parse(event.startedAt) < Date.parse(program.ownStartAt) ||
    Date.parse(event.startedAt) < Date.parse(session.introduction!.confirmedAt!) ||
    Date.parse(event.startedAt) < Date.parse(session.exchange!.confirmedAt!) ||
    Date.parse(event.startedAt) < Date.parse(program.mutualConfirmedAt!)
  )
    return {
      session,
      error:
        "양쪽 결제·동일 방식/시작 시각 동의·실제 이용 가능·실제 개시 확인이 모두 필요합니다.",
    }
  const next = structuredClone(session)
  next.program!.actualStartedAt = event.startedAt
  next.program!.startEventId = event.id
  next.firstProgramStartedAt = event.startedAt
  if (next.refundOperations) next.refundOperations.dayOpened[0] = { id: event.id, at: event.startedAt }
  return { session: next, error: null }
}
export const PAYMENT_SCENARIOS = [
  ["intro-unopened", "소개비 승인 · 첫 프로필 열람 전"],
  ["intro-opened", "소개 제공 개시 · 운영 귀책 검토"],
  ["waiting30", "활성 30일 새 소개 없음 · 선택"],
  ["day02", "DAY02 실제 콘텐츠 개시 · 8,000원"],
  ["day03", "DAY03 실제 콘텐츠 개시 · 미제공분 없음"],
  ["payment-expired", "24시간 상대 미결제 · 전액/권리 복원 대상"],
  ["agreement-expired", "48시간 합의 미완료 · 전액"],
  ["waiting", "무료 준비 대기"],
  ["ready", "소개 준비 확인"],
  ["one-choice", "나만 좋아요 · 결제 잠금"],
  ["mutual", "상호 선택 · 교류비 안내"],
  ["own-paid", "나만 결제"],
  ["both-paid", "양쪽 결제 완료"],
  ["failed", "교류비 실패"],
  ["cancel", "취소 요청"],
  ["refund-review", "환불 검토"],
  ["refunded", "환불 완료 기록"],
  ["withdrawn", "상대 철회 · 미시작"],
  ["changed", "상대 변경 · 이전 금지"],
  ["scheduler-error", "개시 오류 · 권리 유지"],
  ["started", "실제 개시 기록 예시"],
] as const
export function makePaymentFixture(
  scenario: string,
  now = new Date(),
): PaymentSession {
  const session = emptyPaymentSession("virtual-payment-application")
  if (scenario === "day02" || scenario === "day03") {
    const day = scenario === "day02" ? 1 : 2;
    const source = makePaymentFixture("started", new Date(now.getTime() - day * 86400000));
    return recordDayAvailability(source, day, `virtual-day-${day + 1}-opened`, now.toISOString(), true, now);
  }
  if (
    scenario === "waiting" ||
    !PAYMENT_SCENARIOS.some(([id]) => id === scenario)
  )
    return session
  const age = scenario === "waiting30" ? 31 * 86400000 : scenario === "payment-expired" ? 25 * 3600000 : scenario === "agreement-expired" ? 49 * 3600000 : 60000;
  const at = new Date(now.getTime() - age).toISOString()
  session.preparation = {
    candidateReady: true,
    participationConfirmed: true,
    scopeConfirmed: true,
    checkedAt: at,
  }
  if (scenario === "ready") return session
  const receipt = (kind: "introduction" | "exchange"): OwnReceipt => ({
    id: `virtual-${kind}-record`,
    key: `virtual-${kind}`,
    kind,
    programId: kind === "exchange" ? "virtual-program-1" : null,
    amount:
      kind === "introduction"
        ? session.policy.introduction
        : session.policy.exchange,
    attempts: 1,
    status: "confirmed",
    confirmedAt: at,
    cancelRequestedAt: null,
    refundedAt: null,
  })
  session.introduction = receipt("introduction")
  session.refundOperations!.activeWaitingSince = at
  if (scenario !== "intro-unopened") session.refundOperations!.introductionOpenedAt = at
  if (["intro-unopened", "intro-opened", "waiting30"].includes(scenario)) return session
  session.program = {
    id: "virtual-program-1",
    ownSelection: "positive",
    mutualConfirmedAt: scenario === "one-choice" ? null : at,
    partnerPayment: "unconfirmed",
    withdrawn: scenario === "withdrawn",
    ownPlan: null,
    partnerPlan: null,
    ownStartAt: null,
    partnerStartAt: null,
    usable: false,
    actualStartedAt: null,
    startEventId: null,
  }
  if (["one-choice", "mutual"].includes(scenario)) return session
  session.exchange = receipt("exchange")
  if (scenario === "failed") {
    session.exchange.status = "failed"
    session.exchange.confirmedAt = null
  }
  if (scenario === "cancel") {
    session.exchange.status = "cancellation-requested"
    session.exchange.cancelRequestedAt = at
  }
  if (scenario === "refund-review") {
    session.exchange.status = "refund-review"
    session.exchange.cancelRequestedAt = at
  }
  if (scenario === "refunded") {
    session.exchange.status = "refunded"
    session.exchange.refundAmount = session.policy.exchange
    session.exchange.refundedAt = at
  }
  if (scenario === "changed") session.program.id = "virtual-program-2"
  if (["both-paid", "scheduler-error", "started", "agreement-expired"].includes(scenario))
    session.program.partnerPayment = "confirmed"
  if (session.program.partnerPayment === "confirmed") session.refundOperations!.bothPaidAt = at
  if (["scheduler-error", "started"].includes(scenario)) {
    session.program.ownPlan = "A"
    session.program.partnerPlan = "A"
    session.program.ownStartAt = at
    session.program.partnerStartAt = at
    session.program.usable = scenario === "started"
    session.refundOperations!.agreementCompletedAt = at
    if (scenario === "started")
      return recordActualDemoStart(
        session,
        { id: "virtual-start-event", startedAt: at, usable: true },
        now,
      ).session
  }
  return session
}
export function paymentSessionForToday(snapshot: TodaySnapshot) {
  if (snapshot.paymentSession) return snapshot.paymentSession
  return emptyPaymentSession()
}
