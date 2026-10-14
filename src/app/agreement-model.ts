import { BEFORE_US } from "./config";
import { canAgreeProgram, introductionRights, makePaymentFixture, recordActualDemoStart, type PaymentSession } from "./payment-model";
import { refundDeadlines } from "./refund-policy";

export type Plan = "A" | "B";
export type AgreementState = {
  revision: number;
  members: [string, string];
  sessions: [PaymentSession, PaymentSession];
  drafts: Record<string, Plan | null>;
  shared: Record<string, Plan | null>;
  confirmed: Record<string, string | null>;
  startAt: string | null;
  dateMode: "default" | "proposed";
  status: "choosing" | "scheduled" | "started" | "withdrawn" | "interrupted";
  startedAt: string | null;
  events: { type: string; memberId: string | null; at: string; revision: number }[];
};
const day = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: BEFORE_US.agreement.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export function shiftDay(value: string, amount: number) {
  return new Date(Date.parse(`${value}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
}
export function defaultStart(now: Date) {
  return `${shiftDay(day(now), 1)}T${BEFORE_US.agreement.defaultStartTime}:00+09:00`;
}
export function agreementGate(state: AgreementState | null, now: Date) {
  if (!state || !Number.isFinite(now.getTime())) return "확인된 양쪽 결제·상호 선택 기록이 없어요.";
  if (state.members[0] === state.members[1] || state.sessions[0].applicationId === state.sessions[1].applicationId || !state.sessions[0].program?.id || state.sessions[0].program.id !== state.sessions[1].program?.id) return "같은 소개 건의 서로 다른 두 계정 확인이 필요해요.";
  if (!state.members.every((id, index) => state.sessions[index].applicationId === id) || state.sessions[0].exchange?.id === state.sessions[1].exchange?.id || state.sessions[0].introduction?.id === state.sessions[1].introduction?.id) return "양쪽 계정별 독립된 결제 기록 확인이 필요해요.";
  if (!state.startedAt && state.sessions.some(session => session.firstProgramStartedAt)) return "이미 실제 시작한 소개 회차를 새 합의로 재사용할 수 없어요.";
  if (!state.startedAt && state.sessions.some(session => {
    const deadline = refundDeadlines(session).agreementAt;
    return deadline && !session.refundOperations?.agreementCompletedAt && now.getTime() >= Date.parse(deadline);
  })) return "A/B·시작일 합의 기한이 지났어요. 미시작 교류비 전액 환불 요청과 소개 권리 유지 기준을 확인해 주세요.";
  if (!state.sessions.every(session => canAgreeProgram(session, now) && session.exchange?.amount === BEFORE_US.pricing.exchangePerPerson && session.exchange.programId === session.program?.id)) return "양쪽 상호 선택과 각자 교류비 29,000원 결제 완료 확인이 필요해요.";
  return null;
}
export function makeAgreementFixture(now: Date): AgreementState {
  const first = makePaymentFixture("both-paid", now);
  const second = makePaymentFixture("both-paid", now);
  first.applicationId = "virtual-agreement-left";
  second.applicationId = "virtual-agreement-right";
  for (const [index, session] of [first, second].entries()) {
    session.introduction!.id = `virtual-intro-receipt-${index}`;
    session.exchange!.id = `virtual-exchange-receipt-${index}`;
  }
  return { revision: 0, members: [first.applicationId, second.applicationId], sessions: [first, second], drafts: {}, shared: {}, confirmed: {}, startAt: null, dateMode: "default", status: "choosing", startedAt: null, events: [] };
}
export type AgreementCommand =
  | { type: "draft"; plan: Plan }
  | { type: "share" }
  | { type: "date"; date: string }
  | { type: "confirm" }
  | { type: "request-confirmation" }
  | { type: "withdraw" }
  | { type: "interrupt" };
export type ExtensionCommand = { type: "extension-request" | "extension-consent" };
const resetConfirmations = (state: AgreementState) => { state.confirmed = {}; state.status = "choosing"; state.sessions.forEach(session => { if (session.refundOperations) session.refundOperations.agreementCompletedAt = null; }); };
const matched = (state: AgreementState) => !!state.shared[state.members[0]] && state.shared[state.members[0]] === state.shared[state.members[1]];
function log(state: AgreementState, type: string, memberId: string | null, now: Date) {
  state.revision += 1;
  state.events.push({ type, memberId, at: now.toISOString(), revision: state.revision });
}
export function agreementAction(state: AgreementState, memberId: string, command: AgreementCommand | ExtensionCommand, expectedRevision: number, now: Date) {
  const reject = (error: string) => ({ state, error });
  if (!Number.isFinite(now.getTime()) || state.revision !== expectedRevision || !state.members.includes(memberId)) return reject("계정 권한·최신 버전·유효한 시각을 다시 확인해 주세요.");
  if (command.type === "interrupt" && state.status === "started") {
    const next = structuredClone(state); next.status = "interrupted"; log(next, "교류 중단 요청 · 데모", memberId, now); return { state: next, error: null };
  }
  const gate = agreementGate(state, now);
  if (gate) return reject(gate);
  if (["started", "interrupted", "withdrawn"].includes(state.status)) return reject("시작 이후 방식 변경 또는 종료 상태 변경은 할 수 없어요. 중단·문의로 연결해 주세요.");
  const next = structuredClone(state);
  if (command.type === "extension-request" || command.type === "extension-consent") {
    const ops = next.sessions[0].refundOperations;
    if (!ops || !next.sessions[1].refundOperations || ops.extension.used || next.status !== "choosing")
      return reject("합의 전·현재 정책·미사용 1회 연장만 요청할 수 있어요.");
    if (command.type === "extension-request") {
      if (ops.extension.requestedBy) return reject("이미 연장 요청이 있어요. 상대가 직접 동의해야 해요.");
      ops.extension.requestedBy = memberId; ops.extension.consents = [memberId];
    } else {
      if (!ops.extension.requestedBy || ops.extension.consents.includes(memberId)) return reject("현재 연장 요청에 상대가 직접 동의해 주세요.");
      ops.extension.consents.push(memberId);
      ops.extension.used = next.members.every(id => ops.extension.consents.includes(id));
    }
    next.sessions[1].refundOperations!.extension = structuredClone(ops.extension);
  } else if (command.type === "draft") {
    if (!["A", "B"].includes(command.plan)) return reject("A 또는 B만 선택할 수 있어요.");
    next.drafts[memberId] = command.plan;
  } else if (command.type === "share") {
    const plan = next.drafts[memberId];
    if (!plan) return reject("내 초안을 먼저 선택해 주세요.");
    if (next.shared[memberId] !== plan) {
      next.shared[memberId] = plan; resetConfirmations(next);
      next.startAt = matched(next) ? defaultStart(now) : null; next.dateMode = "default";
    }
  } else if (command.type === "date") {
    if (!matched(next)) return reject("양쪽이 같은 방식을 공유한 뒤 일정을 제안할 수 있어요.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(command.date) || !Number.isFinite(Date.parse(`${command.date}T09:00:00+09:00`)) || day(new Date(`${command.date}T09:00:00+09:00`)) !== command.date || command.date < shiftDay(day(now), 1)) return reject("다음 날 이후의 유효한 날짜를 골라 주세요.");
    const startAt = `${command.date}T${BEFORE_US.agreement.defaultStartTime}:00+09:00`;
    if (startAt !== next.startAt) { next.startAt = startAt; next.dateMode = "proposed"; resetConfirmations(next); }
  } else if (command.type === "confirm") {
    if (!matched(next) || !next.startAt) return reject("같은 방식 공유와 시작 일정이 먼저 필요해요.");
    if (Date.parse(next.startAt) <= now.getTime() || (next.dateMode === "default" && next.startAt !== defaultStart(now))) {
      next.startAt = defaultStart(now); resetConfirmations(next); log(next, "새 날짜 제안 · 양쪽 재확인 필요", memberId, now);
      return { state: next, error: "시작 날짜를 새로 제안했어요. 두 사람 모두 다시 확인해 주세요." };
    }
    next.confirmed[memberId] = now.toISOString();
    if (next.members.every(id => next.confirmed[id])) {
      next.status = "scheduled";
      next.sessions.forEach(session => { if (session.refundOperations) session.refundOperations.agreementCompletedAt = now.toISOString(); });
    }
  } else if (command.type === "withdraw") {
    next.status = "withdrawn"; next.confirmed = {};
  } else if (command.type === "request-confirmation") {
    if (!next.shared[memberId]) return reject("선택을 공유한 뒤 확인을 요청할 수 있어요.");
  } else return reject("지원하지 않는 변경이에요.");
  log(next, command.type, memberId, now);
  return { state: next, error: null };
}
export function refreshAgreementDate(state: AgreementState, now: Date) {
  if (!Number.isFinite(now.getTime()) || !state.startAt || Date.parse(state.startAt) > now.getTime() || ["started", "interrupted", "withdrawn"].includes(state.status)) return state;
  const next = structuredClone(state); next.startAt = defaultStart(now); next.dateMode = "default"; resetConfirmations(next); log(next, "지난 제안일 갱신 · 양쪽 재확인 필요", null, now); return next;
}
export function startAgreementDemo(state: AgreementState, now: Date, usable: boolean) {
  const gate = agreementGate(state, now);
  if (gate || state.status !== "scheduled" || !matched(state) || !state.startAt || !state.members.every(id => state.confirmed[id] && Number.isFinite(Date.parse(state.confirmed[id]!)) && Date.parse(state.confirmed[id]!) <= now.getTime()) || now.getTime() < Date.parse(state.startAt) || day(now) !== day(new Date(state.startAt)) || !usable) return { state, error: gate || "양쪽 동의·합의 시각·실제 이용 가능한 개시 이벤트가 필요해요. 아직 시작하지 않았어요." };
  const next = structuredClone(state);
  const results = next.sessions.map((session, index) => {
    session.program!.ownPlan = next.shared[next.members[index]];
    session.program!.partnerPlan = next.shared[next.members[1 - index]];
    session.program!.ownStartAt = next.startAt;
    session.program!.partnerStartAt = next.startAt;
    session.program!.usable = usable;
    return recordActualDemoStart(session, { id: `virtual-start-${next.revision}`, startedAt: now.toISOString(), usable }, now);
  });
  if (results.some(result => result.error)) return { state, error: "실제 개시 검증을 통과하지 못했어요. 소개 권리는 유지돼요." };
  next.sessions = [results[0].session, results[1].session]; next.startedAt = now.toISOString(); next.status = "started";
  log(next, "양쪽 실제 개시 이벤트 · 가상", null, now); return { state: next, error: null };
}
export function agreementView(state: AgreementState | null, memberId: string, now: Date) {
  const gate = agreementGate(state, now);
  if (!state || gate || !state.members.includes(memberId)) return null;
  const peer = state.members.find(id => id !== memberId)!;
  const dates = state.startAt ? [0, 1, 2, 3].map(offset => shiftDay(day(new Date(state.startAt!)), offset)) : [];
  const actualDay = state.startedAt ? Math.floor((Date.parse(`${day(now)}T00:00:00+09:00`) - Date.parse(`${day(new Date(state.startedAt))}T00:00:00+09:00`)) / 86400000) + 1 : null;
  const ownSession = state.sessions[state.members.indexOf(memberId)], extension = ownSession.refundOperations?.extension;
  return { revision: state.revision, ownDraft: state.drafts[memberId] || null, ownShared: state.shared[memberId] || null, peerShared: state.shared[peer] || null, ownConfirmed: !!state.confirmed[memberId], peerConfirmed: !!state.confirmed[peer], matched: matched(state), startAt: state.startAt, dates, status: state.status, startedAt: state.startedAt, day: actualDay, staleDate: !!state.startAt && !state.startedAt && Date.parse(state.startAt) <= now.getTime(), rights: introductionRights(ownSession, now), newIntroductionsPaused: true, agreementDeadline: refundDeadlines(ownSession).agreementAt, extensionRequested: !!extension?.requestedBy, ownExtensionConsent: !!extension?.consents.includes(memberId), extensionUsed: !!extension?.used, canExtend: !!extension && !extension.used && state.status === "choosing" };
}
