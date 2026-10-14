import { benefitIssue } from "./introduction-plan"
import { BEFORE_US } from "./config"
import { reservationIssues, type AdminState } from "./admin-model"
import { clonePublicProfile, type PublicProfile } from "./review-state"
import { emptyPaymentSession, validOwnPayment, type OwnReceipt, type PaymentSession } from "./payment-model"
import { emptyRefundOperations, refundQuote, type RefundOperations } from "./refund-policy"

type Choice = "positive" | "negative"
type EndReason = "rejected" | "nonresponse" | "withdrawn" | "access-failure" | "admin-cancel" | "partner-unpaid" | "agreement-timeout"
export type IntroductionMember = {
  id: string
  applicationId: string
  policyVersion: string
  paymentPolicy: PaymentSession["policy"]
  profile: PublicProfile
  ready: boolean
  participationConfirmed: boolean
  scopeConfirmed: boolean
  available: boolean
  activity: "idle" | "exchange" | "paused"
  rights: "valid" | "none" | "first-program-started"
  receipt: OwnReceipt | null
  exchangeReceipt: OwnReceipt | null
  blockedIds: string[]
  previousIds: string[]
  lastPublishedAt: string | null
  nextEligibleAt: string | null
  missedResponses: number
  refundOperations?: RefundOperations
}
export type IntroductionRecord = {
  id: string
  revision: number
  pair: [string, string]
  versions: Record<string, number>
  policyVersions: Record<string, string>
  profiles: Record<string, PublicProfile>
  reason: string
  status: "reserved" | "published" | "mutual" | "payment" | "agreement" | "closed"
  scheduledAt: string
  publishedAt: string | null
  publishedFor: Record<string, string>
  responseDueAt: string
  responses: Record<string, { choice: Choice, at: string } | null>
  mutualAt: string | null
  closedAt: string | null
  endReason: EndReason | null
}
export type IntroductionBook = {
  revision: number
  members: IntroductionMember[]
  records: IntroductionRecord[]
  events: { introductionId: string, memberId: string | null, kind: string, at: string, revision: number }[]
}
export const emptyIntroductionBook = (): IntroductionBook => ({ revision: 0, members: [], records: [], events: [] })
const dateAt = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: BEFORE_US.introduction.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
export function nextNoon(now: Date) {
  const day = dateAt(now)
  const todayNoon = `${day}T${BEFORE_US.introduction.readyAt}:00+09:00`
  if (now < new Date(todayNoon)) return todayNoon
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
  return `${next}T${BEFORE_US.introduction.readyAt}:00+09:00`
}
export function responseDeadline(publication: string, time = BEFORE_US.introduction.responseDeadlineNextDayAt as string) {
  if (!Number.isFinite(Date.parse(publication)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const day = dateAt(new Date(publication))
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
  return `${next}T${time}:00+09:00`
}
export function validateAdminIntroductionPreparation(state: AdminState, proposalId: string, now = new Date()) {
  const proposal = state.proposals.find(item => item.id === proposalId)
  return proposal ? reservationIssues(state, proposal, dateAt(now)) : ["기존 후보 검토·소개 준비 건이 필요해요."]
}
function event(book: IntroductionBook, record: IntroductionRecord, kind: string, now: Date, memberId: string | null = null) {
  book.revision += 1
  record.revision += 1
  book.events.push({ introductionId: record.id, memberId, kind, at: now.toISOString(), revision: record.revision })
}
export function publicationIssues(book: IntroductionBook, record: IntroductionRecord, now: Date) {
  const issues: string[] = []
  if (book.records.filter(item => item.id === record.id).length !== 1) issues.push("중복 소개 ID를 확인해 주세요.")
  if (record.pair.some(id => book.members.filter(member => member.id === id).length !== 1)) issues.push("양쪽 고유 회원을 확인해 주세요.")
  if (record.pair[0] === record.pair[1]) issues.push("한 쌍의 서로 다른 회원이 필요해요.")
  const publication = new Date(record.scheduledAt)
  if (!Number.isFinite(publication.getTime()) || !Number.isFinite(now.getTime())) return ["유효한 공개·현재 시각을 확인해 주세요."]
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: BEFORE_US.introduction.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
  if (!Number.isFinite(publication.getTime()) || parts.format(publication) !== `${BEFORE_US.introduction.readyAt}:00` || record.status !== "reserved") issues.push("정오 공개 예약 상태를 확인해 주세요.")
  if (!Number.isFinite(Date.parse(record.responseDueAt)) || Date.parse(record.responseDueAt) <= publication.getTime()) issues.push("공개 뒤의 실제 응답 기한이 필요해요.")
  for (const id of record.pair) {
    const member = book.members.find(item => item.id === id)
    const other = record.pair.find(item => item !== id)!
    if (!member) { issues.push(`${id}: 회원 확인 필요`); continue }
    if (!member.ready || !member.participationConfirmed || !member.scopeConfirmed || !member.available || member.activity !== "idle" || member.rights !== "valid") issues.push(`${id}: 양쪽 공개 준비·참여·이용 권리 확인 필요`)
    const benefit = benefitIssue(member.receipt?.confirmedAt, member.previousIds.length, member.rights === "first-program-started", publication)
    if (benefit) issues.push(`${id}: ${benefit}`)
    if (member.profile.version !== record.versions[id] || member.policyVersion !== record.policyVersions[id] || member.paymentPolicy.version !== member.policyVersion) issues.push(`${id}: 준비 후 버전 재확인 필요`)
    if (member.blockedIds.includes(other) || member.previousIds.includes(other)) issues.push(`${id}: 차단·동일 상대 재제안 금지`)
    if (book.records.some(item => item.id !== record.id && item.pair.includes(id) && item.status !== "closed")) issues.push(`${id}: 다른 활성 소개·결제·합의와 동시 진행 불가`)
    if (book.records.some(item => item.id !== record.id && item.pair.includes(id) && item.pair.includes(other))) issues.push("동일 상대 이력이 있어요.")
    if (member.lastPublishedAt && (!Number.isFinite(Date.parse(member.lastPublishedAt)) || dateAt(new Date(member.lastPublishedAt)) === dateAt(publication))) issues.push(`${id}: 같은 날 추가 공개 또는 이력 확인 필요`)
    if (member.nextEligibleAt && publication.getTime() < Date.parse(member.nextEligibleAt)) issues.push(`${id}: 다음 후보가 준비된 정오까지 대기`)
    const profile = record.profiles[id]
    const slots = profile?.photos.map(photo => photo.slot) || []
    if (!profile || slots.length < 3 || slots.length > 4 || new Set(slots).size !== slots.length || !["photo.face", "photo.upper", "photo.style"].every(slot => slots.includes(slot)) || JSON.stringify(clonePublicProfile(member.profile)) !== JSON.stringify(clonePublicProfile(profile))) issues.push(`${id}: 동의한 사진·프로필 스냅샷 확인 필요`)
  }
  if (now < publication) issues.push("정오 공개 시각 전이에요.")
  if (Number.isFinite(now.getTime()) && parts.format(now).slice(0, 5) !== BEFORE_US.introduction.readyAt) issues.push("정오 공개 시각을 벗어났어요. 다른 시각에 일방 공개하지 않아요.")
  if (now >= new Date(record.responseDueAt)) issues.push("응답 기한이 지난 건은 공개하지 않아요.")
  if (Number.isFinite(publication.getTime()) && dateAt(now) !== dateAt(publication)) issues.push("서로 다른 날의 지연 일방 공개는 하지 않아요. 새 공개 준비가 필요해요.")
  return [...new Set(issues)]
}
export function publishDemoIntroduction(book: IntroductionBook, id: string, expectedRevision: number, now: Date) {
  const record = book.records.find(item => item.id === id)
  if (expectedRevision !== book.revision || !record) return { book, errors: ["상태 버전 또는 소개 건을 다시 확인해 주세요."] }
  const errors = publicationIssues(book, record, now)
  if (errors.length) return { book, errors }
  const next = structuredClone(book)
  const target = next.records.find(item => item.id === id)!
  target.status = "published"
  target.publishedAt = now.toISOString()
  target.publishedFor = Object.fromEntries(target.pair.map(memberId => [memberId, target.publishedAt!]))
  for (const memberId of target.pair) {
    const member = next.members.find(member => member.id === memberId)!;
    member.lastPublishedAt = target.publishedAt;
    if (member.refundOperations) {
      member.refundOperations.lastValidIntroductionAt = target.publishedAt;
      member.refundOperations.activeWaitingSince = target.publishedAt;
    }
  }
  event(next, target, "양쪽 동시 공개 · 가상", now)
  return { book: next, errors: [] }
}
export function recordIntroductionViewed(book: IntroductionBook, memberId: string, introductionId: string, revision: number, now: Date) {
  const view = introductionView(book, memberId, now), member = book.members.find(item => item.id === memberId);
  if (book.revision !== revision || view.id !== introductionId || !view.profile || !member?.refundOperations || !member.receipt?.confirmedAt ||
      !Number.isFinite(now.getTime()) || Date.parse(member.receipt.confirmedAt) > now.getTime()) return { book, errors: ["당사자·공개 허용 프로필·기납 승인·현재 버전을 확인해 주세요."] };
  if (member.refundOperations.introductionOpenedAt) return { book, errors: [] };
  const next = structuredClone(book), own = next.members.find(item => item.id === memberId)!;
  own.refundOperations!.introductionOpenedAt = now.toISOString();
  own.refundOperations!.introductionId = introductionId;
  event(next, next.records.find(item => item.id === introductionId)!, "첫 상대 프로필 실제 표시 · 소개 제공 개시 (가상)", now, memberId);
  return { book: next, errors: [] };
}
function close(book: IntroductionBook, record: IntroductionRecord, reason: EndReason, now: Date) {
  record.status = "closed"
  record.endReason = reason
  record.closedAt = now.toISOString()
  for (const id of record.pair) {
    const member = book.members.find(item => item.id === id)!
    member.nextEligibleAt = nextNoon(now)
    if (!member.previousIds.includes(record.pair.find(other => other !== id)!)) member.previousIds.push(record.pair.find(other => other !== id)!)
  }
  event(book, record, `종료:${reason}`, now)
}
export function respondToIntroduction(book: IntroductionBook, id: string, memberId: string, choice: Choice, confirmed: boolean, expectedRevision: number, now: Date) {
  const record = book.records.find(item => item.id === id)
  const member = book.members.find(item => item.id === memberId);
  if (member?.refundOperations && !member.refundOperations.introductionOpenedAt)
    return { book, errors: ["첫 상대 프로필을 실제로 확인한 뒤 최종 응답해 주세요."] };
  if (book.revision !== expectedRevision || !record || !record.pair.includes(memberId) || !["positive", "negative"].includes(choice)) return { book, errors: ["소개·회원·응답 버전을 확인해 주세요."] }
  if (!confirmed || record.status !== "published" || !record.publishedAt || now < new Date(record.publishedAt) || now >= new Date(record.responseDueAt) || record.responses[memberId] || !introductionView(book, memberId, now).profile) return { book, errors: ["공개된 소개의 기한 내 최초 응답을 확인한 뒤 제출해 주세요. 제출한 응답은 덮어쓰지 않아요."] }
  const next = structuredClone(book)
  const target = next.records.find(item => item.id === id)!
  target.responses[memberId] = { choice, at: now.toISOString() }
  event(next, target, "본인 최종 응답", now, memberId)
  if (target.pair.every(member => target.responses[member])) {
    if (target.pair.every(member => target.responses[member]!.choice === "positive")) { target.status = "mutual"; target.mutualAt = now.toISOString(); event(next, target, "상호 선택", now) }
    else close(next, target, "rejected", now)
  }
  return { book: next, errors: [] }
}
export function endDemoIntroduction(book: IntroductionBook, id: string, reason: EndReason, expectedRevision: number, now: Date) {
  const record = book.records.find(item => item.id === id)
  if (book.revision !== expectedRevision || !record || record.status === "closed" || !["nonresponse", "withdrawn", "access-failure", "admin-cancel"].includes(reason) || reason === "nonresponse" && (record.status !== "published" || now < new Date(record.responseDueAt))) return { book, errors: ["실제 종료 사유·기한·버전을 확인해 주세요."] }
  const next = structuredClone(book)
  const target = next.records.find(item => item.id === id)!
  if (reason === "nonresponse") for (const memberId of target.pair.filter(member => !target.responses[member])) {
    const member = next.members.find(item => item.id === memberId)!
    member.missedResponses += 1
    if (member.missedResponses > 1) { member.activity = "paused"; member.available = false; event(next, target, "반복 미응답 · 참여 확인 일시정지", now, memberId) }
  }
  close(next, target, reason, now)
  return { book: next, errors: [] }
}
export function protectDemoIntroduction(book: IntroductionBook, id: string, memberId: string, kind: "block" | "interrupt", revision: number, now: Date) {
  const record=book.records.find(item=>item.id===id);
  if (!record?.pair.includes(memberId) || !["block","interrupt"].includes(kind) || !Number.isFinite(now.getTime())) return { book, errors: ["당사자·현재 소개·보호 요청을 확인해 주세요."] };
  const result=endDemoIntroduction(book,id,"withdrawn",revision,now);
  if(result.errors.length)return result;
  const member=result.book.members.find(item=>item.id===memberId)!;
  member.activity="paused";member.available=false;
  if (member.refundOperations) member.refundOperations.activeWaitingSince = null;
  if(kind==="block")for(const id of record.pair){const participant=result.book.members.find(item=>item.id===id)!;const peer=record.pair.find(item=>item!==id)!;if(!participant.blockedIds.includes(peer))participant.blockedIds.push(peer);}
  event(result.book,result.book.records.find(item=>item.id===record.id)!,kind==="block" ? "본인 차단 · 신규 소개 전달 중지" : "본인 중단 · 신규 소개 전달 중지",now,memberId);
  return result;
}
export function resumeDemoParticipation(book: IntroductionBook, memberId: string, checked: boolean, now: Date) {
  const member = book.members.find(item => item.id === memberId)
  const record = [...book.records].reverse().find(item => item.pair.includes(memberId))
  if (!checked || !member || member.activity !== "paused" || !record || record.status !== "closed") return { book, errors: ["기존 소개 종료와 현재 참여 가능 재확인이 필요해요."] }
  const next = structuredClone(book)
  const target = next.members.find(item => item.id === memberId)!
  target.activity = "idle"; target.available = true; target.participationConfirmed = true
  event(next, next.records.find(item => item.id === record.id)!, "참여 재확인 · 재개", now, memberId)
  return { book: next, errors: [] }
}
export function introductionView(book: IntroductionBook, memberId: string, now: Date) {
  const member = book.members.find(item => item.id === memberId)
  const record = [...book.records].reverse().find(item => item.pair.includes(memberId))
  const active = !!record && record.status !== "reserved" && record.status !== "closed" && !!record.publishedAt && record.pair.every(id => record.publishedFor[id] === record.publishedAt) && Date.parse(record.publishedAt) <= now.getTime()
  const readable = active && (record.status !== "published" || now < new Date(record.responseDueAt)) && record.pair.every(id => { const participant = book.members.find(item => item.id === id); return !!participant?.scopeConfirmed && participant.ready && participant.available && participant.rights === "valid" && participant.profile.version === record.versions[id] && (!participant.refundOperations || participant.receipt?.status === "confirmed") })
  const other = record?.pair.find(id => id !== memberId)
  return {
    status: record?.status || "waiting",
    id: record?.id || null,
    profile: readable && other ? clonePublicProfile(record.profiles[other]) : null,
    reason: readable ? record!.reason : null,
    dueAt: active ? record!.responseDueAt : null,
    ownResponse: active ? record!.responses[memberId]?.choice || null : null,
    mutual: active && ["mutual", "payment", "agreement"].includes(record!.status) && !!record!.mutualAt && Date.parse(record!.mutualAt) <= now.getTime() && record!.pair.every(id => record!.responses[id]?.choice === "positive"),
    expired: active && record!.status === "published" && now >= new Date(record!.responseDueAt),
    endReason: record?.endReason || null,
    rights: member?.rights || "none",
    paused: member?.activity === "paused",
    history: book.records.filter(item => item.pair.includes(memberId) && item.publishedFor[memberId]).map(item => ({ id: item.id, publishedAt: item.publishedFor[memberId] || null, ownResponseAt: item.responses[memberId]?.at || null, closedAt: item.closedAt, reason: item.endReason, version: item.revision, policyVersion: item.policyVersions[memberId], profileVersion: item.versions[memberId], events: book.events.filter(entry => entry.introductionId === item.id && (entry.memberId === null || entry.memberId === memberId)).map(entry => ({ kind: entry.kind, at: entry.at, revision: entry.revision })) })),
  }
}
export function paymentForOwnIntroduction(book: IntroductionBook, memberId: string): PaymentSession | null {
  const member = book.members.find(item => item.id === memberId);
  if (!member) return null;
  const session = emptyPaymentSession(member.applicationId);
  session.policy = structuredClone(member.paymentPolicy);
  session.refundOperations = member.refundOperations ? structuredClone(member.refundOperations) : undefined;
  session.introduction = member.receipt ? structuredClone(member.receipt) : null;
  session.preparation = { candidateReady: member.ready, participationConfirmed: member.participationConfirmed, scopeConfirmed: member.scopeConfirmed, checkedAt: member.receipt?.confirmedAt || null };
  session.activity = member.activity === "paused" ? "paused" : "active";
  return session;
}
export function recordIntroductionPaymentRequest(book: IntroductionBook, memberId: string, session: PaymentSession, revision: number, now: Date) {
  const member = book.members.find(item => item.id === memberId);
  if (!member || revision !== book.revision || session.applicationId !== member.applicationId || JSON.stringify(session.policy) !== JSON.stringify(member.paymentPolicy) ||
      session.introduction?.id !== member.receipt?.id || !["confirmed","cancellation-requested"].includes(session.introduction?.status || "") ||
      session.introduction?.confirmedAt !== member.receipt?.confirmedAt || session.introduction?.amount !== member.receipt?.amount || session.introduction?.refundedAt ||
      member.receipt?.status !== "confirmed" && session.introduction?.status === "confirmed" ||
      session.refundOperations?.introductionOpenedAt !== member.refundOperations?.introductionOpenedAt ||
      JSON.stringify(session.refundOperations?.policy) !== JSON.stringify(member.refundOperations?.policy))
    return { book, errors: ["본인의 기납 승인·정책·요청 버전을 확인해 주세요. 환불 완료는 생성하지 않아요."] };
  const next = structuredClone(book), own = next.members.find(item => item.id === memberId)!;
  own.receipt = structuredClone(session.introduction);
  own.refundOperations = session.refundOperations ? structuredClone(session.refundOperations) : undefined;
  if (own.receipt?.status === "cancellation-requested") { own.available = false; own.activity = "paused"; }
  const record = [...next.records].reverse().find(item => item.pair.includes(memberId));
  if (record) event(next, record, "소개비 환불 요청/대기 선택 · 완료 아님", now, memberId);
  return { book: next, errors: [] };
}
export function paymentForMutualIntroduction(book: IntroductionBook, memberId: string, now: Date): PaymentSession | null {
  const view = introductionView(book, memberId, now)
  if (!view.mutual) return null
  const member = book.members.find(item => item.id === memberId)!
  if (member.rights !== "valid" || member.activity === "exchange") return null
  const record = book.records.find(item => item.id === view.id)!
  const session = paymentForOwnIntroduction(book, memberId)!
  session.exchange = member.exchangeReceipt ? structuredClone(member.exchangeReceipt) : null
  session.preparation = { candidateReady: member.ready, participationConfirmed: member.participationConfirmed, scopeConfirmed: member.scopeConfirmed, checkedAt: record.publishedAt }
  session.program = { id: record.id, ownSelection: "positive", mutualConfirmedAt: record.mutualAt, partnerPayment: "unconfirmed", withdrawn: false, ownPlan: null, partnerPlan: null, ownStartAt: null, partnerStartAt: null, usable: false, actualStartedAt: null, startEventId: null }
  const peer = book.members.find(item => record.pair.includes(item.id) && item.id !== memberId);
  if (peer?.exchangeReceipt?.status === "confirmed" && peer.exchangeReceipt.programId === record.id && validOwnPayment(peer.exchangeReceipt, now)) {
    session.program.partnerPayment = "confirmed";
    if (session.exchange?.status === "confirmed" && session.exchange.programId === record.id && validOwnPayment(session.exchange, now) && session.refundOperations && !session.refundOperations.bothPaidAt)
      session.refundOperations.bothPaidAt = new Date(Math.max(Date.parse(session.exchange.confirmedAt!), Date.parse(peer.exchangeReceipt.confirmedAt!))).toISOString();
  }
  return session
}
export function recordDemoExchangeRequest(book: IntroductionBook, memberId: string, session: PaymentSession, expectedRevision: number, now: Date) {
  const view = introductionView(book, memberId, now)
  const member = book.members.find(item => item.id === memberId)
  const receipt = session.exchange
  if (member && (session.refundOperations?.introductionOpenedAt !== member.refundOperations?.introductionOpenedAt ||
      JSON.stringify(session.refundOperations?.policy) !== JSON.stringify(member.refundOperations?.policy)))
    return { book, errors: ["구매 시점 환불 정책·첫 소개 제공 개시 원본은 덮어쓰지 않아요."] };
  const peer = book.members.find(item => item.id !== memberId && book.records.find(record => record.id === view.id)?.pair.includes(item.id));
  if (member?.rights !== "valid" || member.activity === "exchange" || peer?.rights === "first-program-started" || peer?.activity === "exchange" ||
      receipt?.refundRequest?.requestedReason === "partner-unpaid" && peer?.exchangeReceipt?.status === "confirmed" && peer.exchangeReceipt.programId === view.id && validOwnPayment(peer.exchangeReceipt, now))
    return { book, errors: ["미시작·현재 소개 권리·상대의 실제 미결제 기록을 확인해 주세요."] };
  if (book.revision !== expectedRevision || !view.mutual || !member || !receipt || receipt.programId !== view.id || receipt.kind !== "exchange" || !["requested", "cancellation-requested"].includes(receipt.status) || session.applicationId !== member.applicationId || JSON.stringify(session.policy) !== JSON.stringify(member.paymentPolicy) || receipt.amount !== member.paymentPolicy.exchange) return { book, errors: ["본인의 현재 소개에 연결된 가상 요청·정책·버전을 확인해 주세요. 승인·환불은 생성하지 않아요."] }
  const next = structuredClone(book)
  next.members.find(item => item.id === memberId)!.exchangeReceipt = structuredClone(receipt)
  next.members.find(item => item.id === memberId)!.refundOperations = session.refundOperations ? structuredClone(session.refundOperations) : undefined
  const reason = receipt.refundRequest?.requestedReason;
  if (receipt.status === "cancellation-requested" && (reason === "partner-unpaid" || reason === "agreement-timeout") &&
      refundQuote(session, "exchange", now, reason).amount === session.policy.exchange) {
    close(next, next.records.find(item => item.id === view.id)!, reason, now);
  }
  event(next, next.records.find(item => item.id === view.id)!, "본인 교류비 가상 요청 상태 · 승인 아님", now, memberId)
  return { book: next, errors: [] }
}
export function makeIntroductionFixture(now: Date): IntroductionBook {
  const at = `${dateAt(now)}T12:00:00+09:00`
  const book = emptyIntroductionBook()
  book.members = ["virtual-left", "virtual-right"].map((id, index) => ({ id, applicationId: `virtual-application-${index}`, policyVersion: BEFORE_US.policyVersion, paymentPolicy: emptyPaymentSession().policy, profile: { demo: true, version: 1, items: [{ id: "self.name", label: "활동용 이름", value: `소개 화면 예시 ${index ? "나" : "가"}` }, { id: "self.age", label: "만 나이", value: "28세 · 가상" }, { id: "self.area", label: "넓은 생활권", value: "서울 · 가상" }, { id: "self.purpose", label: "관계 목적", value: "천천히 알아가며 연애" }, { id: "self.bio", label: "한 줄 소개", value: "산책과 음악을 좋아해요. 일상의 작은 이야기를 천천히 나누고 싶어요. (가상 예시)" }], photos: ["photo.face", "photo.upper", "photo.style"].map((slot, photoIndex) => ({ slot, label: ["대표 얼굴", "자연스러운 상반신", "전체 스타일"][photoIndex], assetId: `virtual-layout-${photoIndex}`, version: 1 })) }, ready: true, participationConfirmed: true, scopeConfirmed: true, available: true, activity: "idle", rights: "valid", receipt: { id: `virtual-intro-fee-${id}`, key: `virtual-intro-fee-${id}`, kind: "introduction", programId: null, amount: BEFORE_US.pricing.introduction, attempts: 1, status: "confirmed", confirmedAt: new Date(Date.parse(at) - 3600000).toISOString(), cancelRequestedAt: null, refundedAt: null }, exchangeReceipt: null, blockedIds: [], previousIds: [], lastPublishedAt: null, nextEligibleAt: null, missedResponses: 0 }))
  const record: IntroductionRecord = { id: "virtual-pair-1", revision: 1, pair: ["virtual-left", "virtual-right"], versions: { "virtual-left": 1, "virtual-right": 1 }, policyVersions: { "virtual-left": "V6", "virtual-right": "V6" }, profiles: Object.fromEntries(book.members.map(member => [member.id, clonePublicProfile(member.profile)])), reason: "두 분이 공개한 관계 목적은 ‘천천히 알아가며 연애’예요. 서로 알아가며 직접 확인해 주세요.", status: "reserved", scheduledAt: at, publishedAt: null, publishedFor: {}, responseDueAt: responseDeadline(at)!, responses: { "virtual-left": null, "virtual-right": null }, mutualAt: null, closedAt: null, endReason: null }
  book.records = [record]
  book.members.forEach(member => { member.refundOperations = emptyRefundOperations(); member.refundOperations.activeWaitingSince = member.receipt!.confirmedAt; });
  return book
}
