import { useSyncExternalStore } from "react";
import { BEFORE_US } from "./config";
import { getConsoleData, replaceConsoleData } from "./admin-console-data";
import { refundQuote } from "./refund-policy";
import type { PaymentSession } from "./payment-model";

// V6-conduct-01: 교류 중단·약속 취소·노쇼·재이용 운영 기준.
// 기존 A/B·약속·연락처 공개 로직은 바꾸지 않고, 그 위에 사건 기록·산정·제재·면제를 가상 메모리로 관리한다.
export const CONDUCT_POLICY = BEFORE_US.conduct;
const HOUR = 3600000, DAY = 86400000;
const validAt = (at: string | null | undefined, now: Date) => !!at && Number.isFinite(Date.parse(at)) && Date.parse(at) <= now.getTime();
const parsed = (at: string | null | undefined) => !!at && Number.isFinite(Date.parse(at));
const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;

export const INTERRUPTION_REASONS = {
  "self-change": "본인 단순 변심",
  "partner-nonresponse": "상대 미응답",
  "partner-dropout": "상대 중도 이탈",
  "operator-issue": "운영 문제",
  safety: "안전·신고 사유",
} as const;
export type InterruptionReason = keyof typeof INTERRUPTION_REASONS;
export const EXCUSE_REASONS = { emergency: "응급", illness: "질병", accident: "사고", safety: "안전" } as const;
export type ExcuseReason = keyof typeof EXCUSE_REASONS;
export const CASE_STATUS = {
  recorded: "기록됨",
  checking: "운영 사실 확인 중",
  confirmed: "운영 확인",
  dismissed: "확인되지 않음",
  excused: "불가피 사유 확인 · 불이익 없음",
  reconsidering: "재검토 요청",
} as const;
export type CaseStatus = keyof typeof CASE_STATUS;
export type Waiver = { id: string; memberId: string; caseId: string; amount: number; reason: string; status: "pending" | "granted" | "applied" | "voided"; at: string };
export type Sanction = { memberId: string; days: number; startsAt: string; endsAt: string; escalationReview: boolean; status: "active" | "reconsidering" | "lifted" };
export type ConductCase = {
  id: string;
  kind: "interruption" | "cancellation" | "no-show";
  programId: string;
  appointmentId: string | null;
  actorId: string;
  partnerId: string;
  victimId: string | null;
  createdAt: string;
  policyVersion: string;
  status: CaseStatus;
  interruption?: { reason: InterruptionReason; started: boolean; actorRefund: number | null; actorRefundBasis: string; victimRefund: number | null; introductionBenefitEnds: boolean };
  cancellation?: { meetingStartAt: string; cancelledAt: string; hoursBefore: number; late: boolean; excuse: ExcuseReason | null; choice: "reschedule" | "end" | null; victimEndedAt: string | null };
  noShow?: { meetingStartAt: string; reportedAt: string; noticeBefore: false; intentional: boolean; repeat: boolean };
  sanction: Sanction | null;
  priorityReintroduction: boolean;
  adminLog: { at: string; actor: string; action: string; note: string }[];
  reconsideration: { at: string; memberId: string; note: string } | null;
};
export type NewRound = { id: string; memberId: string; at: string; introductionFee: number; exchangeFee: number; waiverId: string | null; reverify: string[]; policyVersion: string; status: "requested" };
type ConductState = { revision: number; cases: ConductCase[]; waivers: Waiver[]; rounds: NewRound[] };

let snapshot: ConductState = { revision: 0, cases: [], waivers: [], rounds: [] };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getConductState = () => snapshot;
export const useConductState = () => useSyncExternalStore(subscribe, getConductState, getConductState);
const commit = (state: ConductState) => { state.revision += 1; snapshot = state; listeners.forEach(listener => listener()); };
export function resetConductDemo() { commit({ revision: snapshot.revision, cases: [], waivers: [], rounds: [] }); }
// 감사 로그에는 사건 ID·조치만 남기고 사유 원문·연락처는 넣지 않는다.
function audit(action: string, target: string, now: Date) {
  const admin = structuredClone(getConsoleData());
  admin.audits.push({ id: `conduct-${admin.audits.length + 1}`, actor: "가상 Owner", at: now.toISOString(), action: `${action} · ${CONDUCT_POLICY.version}`, target, reason: "교류·약속 운영 기준 가상 처리", role: "Owner", result: "demo-only" });
  admin.source = "virtual"; replaceConsoleData(admin);
}
const newCase = (state: ConductState, input: Omit<ConductCase, "id" | "createdAt" | "policyVersion" | "sanction" | "priorityReintroduction" | "adminLog" | "reconsideration">, now: Date): ConductCase => ({
  ...input, id: `conduct-${state.revision + 1}-${state.cases.length + 1}`, createdAt: now.toISOString(), policyVersion: CONDUCT_POLICY.version,
  sanction: null, priorityReintroduction: false, adminLog: [], reconsideration: null,
});
function addWaiver(state: ConductState, memberId: string, item: ConductCase, reason: string, status: Waiver["status"], now: Date) {
  if (state.waivers.some(waiver => waiver.caseId === item.id && waiver.memberId === memberId && waiver.status !== "voided")) return;
  state.waivers.push({ id: `waiver-${item.id}-${memberId}`, memberId, caseId: item.id, amount: CONDUCT_POLICY.nextIntroductionFee, reason, status, at: now.toISOString() });
}

// ── 교류 중단 ──
// 미제공 DAY 산정은 V6-refund-01의 실제 DAY 개시 기록을 그대로 사용한다.
export function interruptionOutcome(session: PaymentSession, reason: InterruptionReason, now: Date) {
  const started = validAt(session.firstProgramStartedAt, now);
  const quote = refundQuote(session, "exchange", now, "cancel");
  const victimClaim = reason !== "self-change" && reason !== "safety";
  return {
    reason, started,
    refundAmount: quote.amount,
    refundBasis: quote.reason,
    introductionBenefitEnds: started,
    feeWaiver: victimClaim ? "운영 확인 후 다음 소개 이용료 5,000원 면제" : null,
    review: reason === "self-change" ? null : reason === "safety" ? "안전·신고 사유는 단순 변심으로 자동 판정하지 않고 운영자가 확인합니다." : "상대 귀책·운영 문제는 운영자가 사실을 확인한 뒤 면제를 적용합니다.",
  };
}
export function recordInterruption(input: { programId: string; actorId: string; partnerId: string; reason: InterruptionReason; session: PaymentSession; partnerSession?: PaymentSession | null }, now = new Date()) {
  if (!input.programId || !input.actorId || !input.partnerId || input.actorId === input.partnerId || !Object.prototype.hasOwnProperty.call(INTERRUPTION_REASONS, input.reason) || !Number.isFinite(now.getTime())) return { error: "당사자·교류·중단 사유·가상 시각을 확인해 주세요.", id: null };
  if (snapshot.cases.some(item => item.kind === "interruption" && item.programId === input.programId && item.status !== "dismissed")) return { error: "이 교류에는 이미 중단 기록이 있습니다. 중복 기록하지 않습니다.", id: null };
  const outcome = interruptionOutcome(input.session, input.reason, now);
  const partnerQuote = input.partnerSession ? refundQuote(input.partnerSession, "exchange", now, "cancel").amount : null;
  const next = structuredClone(snapshot);
  // 본인 단순 변심: 중단한 사람이 행위자, 상대가 중도 이탈 피해자.
  // 상대 귀책·운영 문제 주장: 기록한 본인이 피해자, 상대(또는 운영)는 확인 대상.
  const selfChange = input.reason === "self-change";
  const item = newCase(next, {
    kind: "interruption", programId: input.programId, appointmentId: null,
    actorId: selfChange || input.reason === "safety" || input.reason === "operator-issue" ? input.actorId : input.partnerId,
    partnerId: selfChange || input.reason === "safety" || input.reason === "operator-issue" ? input.partnerId : input.actorId,
    victimId: selfChange ? input.partnerId : input.reason === "safety" ? null : input.actorId,
    status: selfChange ? "recorded" : "checking",
    interruption: { reason: input.reason, started: outcome.started, actorRefund: outcome.refundAmount, actorRefundBasis: outcome.refundBasis, victimRefund: partnerQuote, introductionBenefitEnds: outcome.introductionBenefitEnds },
  }, now);
  next.cases.push(item);
  // 본인이 직접 남긴 단순 변심 기록은 상대의 중도 이탈 피해가 명확하므로 면제를 바로 부여한다.
  if (selfChange) addWaiver(next, input.partnerId, item, "상대 중도 이탈로 정상 진행 불가", "granted", now);
  else if (input.reason !== "safety") addWaiver(next, input.actorId, item, `${INTERRUPTION_REASONS[input.reason]}로 정상 진행 불가 · 운영 확인 대기`, "pending", now);
  commit(next);
  return { error: null, id: item.id };
}

// ── 약속 취소 ──
export function classifyCancellation(meetingStartAt: string, cancelledAt: string, excuse: ExcuseReason | null = null) {
  if (!parsed(meetingStartAt) || !parsed(cancelledAt)) return { error: "약속 시작 시각과 취소 시각을 확인해 주세요." } as const;
  const hoursBefore = (Date.parse(meetingStartAt) - Date.parse(cancelledAt)) / HOUR;
  if (hoursBefore <= 0) return { error: "약속 시작 이후에는 취소로 기록하지 않습니다. 불참은 시작 30분 뒤 노쇼 신고로 확인합니다." } as const;
  const late = hoursBefore < CONDUCT_POLICY.lateCancelHours;
  return {
    error: null, hoursBefore, late,
    label: !late ? "일반 취소 · 재조율 또는 종료 선택" : excuse ? "늦은 취소 · 불가피 사유 운영 확인 대기" : "늦은 취소로 기록",
    options: late ? [] as const : ["reschedule", "end"] as const,
  } as const;
}
export function recordCancellation(input: { programId: string; appointmentId: string; cancellerId: string; partnerId: string; meetingStartAt: string; excuse?: ExcuseReason | null; choice?: "reschedule" | "end" | null }, now = new Date()) {
  const excuse = input.excuse && Object.prototype.hasOwnProperty.call(EXCUSE_REASONS, input.excuse) ? input.excuse : null;
  const result = classifyCancellation(input.meetingStartAt, now.toISOString(), excuse);
  if (result.error) return { error: result.error, id: null };
  if (!input.programId || !input.appointmentId || !input.cancellerId || !input.partnerId || input.cancellerId === input.partnerId) return { error: "당사자·약속을 확인해 주세요.", id: null };
  if (!result.late && !["reschedule", "end"].includes(input.choice || "")) return { error: "24시간 이전 취소는 재조율 또는 종료를 선택해 주세요.", id: null };
  if (snapshot.cases.some(item => item.appointmentId === input.appointmentId && item.kind === "cancellation" && item.status !== "dismissed")) return { error: "이 약속에는 이미 취소 기록이 있습니다.", id: null };
  const next = structuredClone(snapshot);
  const item = newCase(next, {
    kind: "cancellation", programId: input.programId, appointmentId: input.appointmentId,
    actorId: input.cancellerId, partnerId: input.partnerId, victimId: result.late ? input.partnerId : null,
    status: result.late && excuse ? "checking" : "recorded",
    cancellation: { meetingStartAt: input.meetingStartAt, cancelledAt: now.toISOString(), hoursBefore: Math.round(result.hoursBefore * 10) / 10, late: result.late, excuse, choice: result.late ? null : input.choice!, victimEndedAt: null },
  }, now);
  next.cases.push(item); commit(next);
  return { error: null, id: item.id };
}
// 늦은 취소 피해자가 교류를 종료하면 다음 소개비 면제. 취소자의 불가피 사유 확인과 무관하게 피해자 혜택은 유지한다.
export function endAfterLateCancellation(caseId: string, memberId: string, now = new Date()) {
  const next = structuredClone(snapshot), item = next.cases.find(entry => entry.id === caseId);
  if (!item?.cancellation?.late || item.victimId !== memberId || item.cancellation.victimEndedAt || item.status === "dismissed") return "늦은 취소의 상대 당사자만 종료를 선택할 수 있어요.";
  item.cancellation.victimEndedAt = now.toISOString();
  addWaiver(next, memberId, item, "상대의 늦은 취소 후 교류 종료", "granted", now);
  commit(next); return null;
}

// ── 노쇼 ──
export function noShowReportGate(meetingStartAt: string, now: Date, appointmentId: string, accusedId: string) {
  if (!parsed(meetingStartAt) || !Number.isFinite(now.getTime())) return "약속 시작 시각을 확인해 주세요.";
  if (now.getTime() < Date.parse(meetingStartAt) + CONDUCT_POLICY.noShowGraceMinutes * 60000) return `약속 시작 ${CONDUCT_POLICY.noShowGraceMinutes}분이 지난 뒤에 신고할 수 있어요.`;
  if (snapshot.cases.some(item => item.kind === "cancellation" && item.appointmentId === appointmentId && item.actorId === accusedId)) return "상대의 사전 취소 기록이 있는 약속은 노쇼가 아니라 취소 기준으로 처리합니다.";
  return null;
}
export function reportNoShow(input: { programId: string; appointmentId: string; reporterId: string; accusedId: string; meetingStartAt: string; noContactConfirmed: boolean }, now = new Date()) {
  const blocked = noShowReportGate(input.meetingStartAt, now, input.appointmentId, input.accusedId);
  if (blocked) return { error: blocked, id: null };
  if (!input.noContactConfirmed) return { error: "사전 취소나 연락 없이 불참했는지 확인해 주세요.", id: null };
  if (!input.reporterId || !input.accusedId || input.reporterId === input.accusedId) return { error: "당사자를 확인해 주세요.", id: null };
  if (snapshot.cases.some(item => item.kind === "no-show" && item.appointmentId === input.appointmentId && item.actorId === input.accusedId && item.status !== "dismissed")) return { error: "이미 접수된 노쇼 신고가 있습니다.", id: null };
  const next = structuredClone(snapshot);
  const item = newCase(next, {
    kind: "no-show", programId: input.programId, appointmentId: input.appointmentId,
    actorId: input.accusedId, partnerId: input.reporterId, victimId: input.reporterId, status: "checking",
    noShow: { meetingStartAt: input.meetingStartAt, reportedAt: now.toISOString(), noticeBefore: false, intentional: false, repeat: false },
  }, now);
  next.cases.push(item); commit(next);
  return { error: null, id: item.id };
}

// ── 운영자 확인 ──
export function decideConductCase(caseId: string, decision: "confirmed" | "dismissed" | "excused", note: string, options: { intentional?: boolean } = {}, now = new Date()) {
  if (!note.trim() || note.length > 200 || /(?:https?:|@|\d[\d\s-]{6,})/i.test(note) || !Number.isFinite(now.getTime())) return "1~200자 개인정보 없는 확인 내용을 기록해 주세요.";
  const next = structuredClone(snapshot), item = next.cases.find(entry => entry.id === caseId);
  if (!item || !["checking", "recorded", "reconsidering"].includes(item.status)) return "확인할 수 있는 사건 상태가 아닙니다.";
  if (decision === "excused" && item.kind !== "cancellation") return "불가피 사유 확인은 약속 취소에만 적용합니다.";
  if (item.kind === "interruption" && item.interruption!.reason === "self-change" && decision !== "dismissed") return "단순 변심 중단은 본인 기록으로 이미 반영되었습니다.";
  item.status = decision;
  item.adminLog.push({ at: now.toISOString(), actor: "가상 Owner", action: CASE_STATUS[decision], note: note.trim() });
  const pending = next.waivers.filter(waiver => waiver.caseId === item.id && waiver.status === "pending");
  if (decision === "dismissed") {
    pending.forEach(waiver => { waiver.status = "voided"; });
    if (item.sanction) item.sanction.status = "lifted";
  }
  if (decision === "confirmed") {
    pending.forEach(waiver => { waiver.status = "granted"; });
    if (item.kind === "interruption" && item.interruption!.reason === "safety" && item.partnerId) {
      // 안전 사유 중단이 확인되면 중단을 요청한 사람이 보호 대상이다.
      item.victimId = item.actorId;
      addWaiver(next, item.actorId, item, "안전·신고 사유 중단 확인", "granted", now);
    }
    if (item.kind === "no-show") {
      const repeat = next.cases.some(entry => entry.id !== item.id && entry.kind === "no-show" && entry.actorId === item.actorId && entry.status === "confirmed");
      item.noShow!.repeat = repeat; item.noShow!.intentional = options.intentional === true;
      item.sanction = { memberId: item.actorId, days: CONDUCT_POLICY.noShowSuspensionDays, startsAt: now.toISOString(), endsAt: new Date(now.getTime() + CONDUCT_POLICY.noShowSuspensionDays * DAY).toISOString(), escalationReview: repeat || options.intentional === true, status: "active" };
      item.priorityReintroduction = true;
      addWaiver(next, item.victimId!, item, "확인된 노쇼 피해", "granted", now);
    }
  }
  if (decision === "excused" && item.cancellation) item.adminLog.push({ at: now.toISOString(), actor: "가상 Owner", action: "늦은 취소 불이익 미적용", note: "불가피 사유 확인" });
  commit(next); audit(`교류·약속 사건 ${CASE_STATUS[decision]}`, item.id, now);
  return null;
}
// 판단 대상자(subject)는 불리한 기록에, 주장자(claimant)는 주장이 인정되지 않았을 때 한 번 재검토를 요청할 수 있다.
function caseRoles(item: ConductCase) {
  const reason = item.interruption?.reason;
  if (reason === "self-change") return { subject: null, claimant: null };
  if (reason === "operator-issue") return { subject: null, claimant: item.actorId };
  if (reason === "safety") return { subject: item.partnerId, claimant: item.actorId };
  return { subject: item.actorId, claimant: item.partnerId };
}
const canReconsider = (item: ConductCase, memberId: string) => {
  const roles = caseRoles(item);
  return !item.reconsideration && (roles.subject === memberId && ["confirmed", "recorded"].includes(item.status) || roles.claimant === memberId && item.status === "dismissed");
};
export function requestConductReconsideration(caseId: string, memberId: string, note: string, now = new Date()) {
  if (!note.trim() || note.length > 300 || /(?:https?:|@|\d[\d\s-]{6,})/i.test(note)) return "1~300자 개인정보 없는 재검토 사유를 적어 주세요.";
  const next = structuredClone(snapshot), item = next.cases.find(entry => entry.id === caseId);
  if (!item || !canReconsider(item, memberId)) return "본인 당사자 사건의 결정 기록에만 한 번 재검토를 요청할 수 있어요.";
  item.status = "reconsidering"; item.reconsideration = { at: now.toISOString(), memberId, note: note.trim() };
  if (item.sanction?.status === "active" && item.sanction.memberId === memberId) item.sanction.status = "reconsidering";
  commit(next); audit("교류·약속 사건 재검토 요청 접수", item.id, now);
  return null;
}
export function liftSanction(caseId: string, note: string, now = new Date()) {
  const next = structuredClone(snapshot), item = next.cases.find(entry => entry.id === caseId);
  if (!item?.sanction || item.sanction.status === "lifted" || !note.trim()) return "해제할 이용 제한과 사유를 확인해 주세요.";
  item.sanction.status = "lifted"; item.adminLog.push({ at: now.toISOString(), actor: "가상 Owner", action: "이용 제한 해제", note: note.trim() });
  commit(next); audit("이용 제한 해제", item.id, now);
  return null;
}

// ── 회원별 보기 ──
export function activeSuspension(memberId: string, now: Date, state = snapshot) {
  return state.cases.map(item => item.sanction).find(sanction => sanction?.memberId === memberId && sanction.status !== "lifted" && Date.parse(sanction.startsAt) <= now.getTime() && now.getTime() < Date.parse(sanction.endsAt)) || null;
}
// 상대에게는 취소·노쇼·제재 사유를 자세히 공개하지 않는다. 본인 사건은 본인에게만 상세히 보인다.
export function conductNoticeFor(item: ConductCase, memberId: string) {
  const own = item.actorId === memberId;
  if (![item.actorId, item.partnerId].includes(memberId)) return null;
  if (item.kind === "cancellation") return own
    ? `내 약속 취소 · ${item.cancellation!.late ? "늦은 취소(24시간 이내) 기록" : "일반 취소"}${item.cancellation!.excuse ? ` · ${EXCUSE_REASONS[item.cancellation!.excuse]} 사유 ${item.status === "excused" ? "확인 · 불이익 없음" : "운영 확인 중"}` : ""}`
    : "상대가 약속을 취소했어요. 다음 진행을 선택할 수 있어요.";
  if (item.kind === "no-show") return own
    ? `노쇼 신고 · ${CASE_STATUS[item.status]}${item.sanction && item.sanction.status !== "lifted" ? ` · 소개 이용 정지 ${item.sanction.days}일(${new Date(item.sanction.endsAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}까지)${item.sanction.escalationReview ? " · 추가 조치 운영 검토" : ""}` : ""}`
    : `노쇼 신고 · ${item.status === "confirmed" ? "운영 확인 완료" : CASE_STATUS[item.status]}`;
  const reason = item.interruption!.reason;
  if (reason === "self-change") return own ? "내가 교류를 중단했어요 · 단순 변심" : "교류가 종료되었어요.";
  return memberId === item.victimId || (reason === "safety" && own) ? `교류 중단 · ${INTERRUPTION_REASONS[reason]} · ${CASE_STATUS[item.status]}` : "교류가 종료되었어요. 운영 확인이 진행 중일 수 있어요.";
}
export function memberConductView(memberId: string, now: Date, state = snapshot) {
  return {
    cases: state.cases.filter(item => [item.actorId, item.partnerId].includes(memberId)).map(item => ({ id: item.id, kind: item.kind, status: item.status, notice: conductNoticeFor(item, memberId)!, canReconsider: canReconsider(item, memberId), canEndAfterLate: !!item.cancellation?.late && item.victimId === memberId && !item.cancellation.victimEndedAt })),
    waivers: state.waivers.filter(waiver => waiver.memberId === memberId),
    suspension: activeSuspension(memberId, now, state),
    priority: state.cases.some(item => item.priorityReintroduction && item.victimId === memberId),
  };
}

// ── 재이용 ──
export function reuseQuote(input: { memberId: string; payment: PaymentSession; programEnded: boolean; lastReviewAt: string | null; now: Date }, state = snapshot) {
  const { memberId, payment, now } = input;
  if (!validAt(payment.firstProgramStartedAt, now)) return { status: "initial" as const, message: "첫 교류가 실제 시작되기 전에는 기존 소개 혜택이 유지돼 새 회차 소개비가 없습니다." };
  if (!input.programEnded) return { status: "in-progress" as const, message: "진행 중인 교류가 끝난 뒤 새 회차 소개를 신청할 수 있어요." };
  const suspension = activeSuspension(memberId, now, state);
  if (suspension) return { status: "suspended" as const, message: `소개 이용 정지 중입니다 · ${new Date(suspension.endsAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })}까지. 재검토를 요청할 수 있어요.` };
  const waiver = state.waivers.find(item => item.memberId === memberId && item.status === "granted") || null;
  const pendingWaiver = state.waivers.some(item => item.memberId === memberId && item.status === "pending");
  // 마지막 검토 기록이 없으면 90일 이내라고 추정하지 않고 다시 확인한다.
  const stale = !parsed(input.lastReviewAt) || now.getTime() - Date.parse(input.lastReviewAt!) >= CONDUCT_POLICY.reverifyAfterDays * DAY;
  return {
    status: "available" as const,
    introductionFee: waiver ? 0 : CONDUCT_POLICY.nextIntroductionFee,
    exchangeFee: CONDUCT_POLICY.exchangeFee,
    waiver, pendingWaiver,
    reuse: ["기존 프로필", "사진", "취향"],
    reverify: stale ? [...CONDUCT_POLICY.reverifyFields] : [],
    message: `새 회차 소개비 ${waiver ? `0원(${money(CONDUCT_POLICY.nextIntroductionFee)} 면제)` : money(CONDUCT_POLICY.nextIntroductionFee)} · 새 상대와 상호 선택 시 교류비 ${money(CONDUCT_POLICY.exchangeFee)}`,
  };
}
export function requestNewRound(input: Parameters<typeof reuseQuote>[0]) {
  const quote = reuseQuote(input);
  if (quote.status !== "available") return { error: quote.message, id: null };
  if (snapshot.rounds.some(item => item.memberId === input.memberId && item.status === "requested")) return { error: "이미 접수된 새 회차 요청이 있습니다. 중복 청구하지 않습니다.", id: null };
  const next = structuredClone(snapshot);
  const id = `round-${next.revision + 1}-${input.memberId}`;
  next.rounds.push({ id, memberId: input.memberId, at: input.now.toISOString(), introductionFee: quote.introductionFee, exchangeFee: quote.exchangeFee, waiverId: quote.waiver?.id || null, reverify: quote.reverify, policyVersion: CONDUCT_POLICY.version, status: "requested" });
  const waiver = quote.waiver && next.waivers.find(item => item.id === quote.waiver!.id);
  if (waiver) waiver.status = "applied";
  commit(next);
  return { error: null, id };
}

export const CONDUCT_NOTICE = [
  "본인 단순 변심으로 교류를 중단하면 아직 시작하지 않은 DAY 금액만 환불합니다. 교류가 실제 시작된 뒤라면 이번 소개비로 받던 소개 혜택(초기 30일 혜택 또는 기본 5번)은 종료됩니다.",
  "상대의 미응답·중도 이탈이나 운영 문제로 정상 진행이 어려우면 미제공 DAY 금액을 환불하고 다음 소개 이용료 5,000원을 면제합니다. 안전·신고 사유 중단은 단순 변심으로 자동 판정하지 않습니다.",
  "약속 24시간 이전 취소는 일반 취소로 재조율 또는 종료를 선택합니다. 24시간 이내 취소는 늦은 취소로 기록하며, 피해를 본 상대가 교류를 종료하면 다음 소개비 5,000원을 면제합니다. 응급·질병·사고·안전 사유는 운영자 확인 후 불이익을 적용하지 않습니다.",
  "약속 시작 30분이 지났고 사전 취소나 연락 없이 불참했다면 노쇼로 신고할 수 있어요. 자동 판정하지 않고 운영자가 사실을 확인하며, 확인된 노쇼는 기본 14일 소개 이용 정지입니다. 반복·고의성이 확인되면 30일 이상 또는 이용 종료를 운영자가 검토합니다.",
  "노쇼 피해자는 다음 소개비 5,000원 면제와 우선 재소개 대상입니다. 노쇼만을 이유로 이미 정상 제공된 3일 교류비 전체를 자동 환불하지는 않습니다.",
  "정상 교류가 끝난 뒤 새 소개를 원하면 새 회차 소개비 5,000원, 새 상대와 상호 선택 시 교류비 24,000원입니다. 기존 프로필·사진·취향은 다시 쓸 수 있고, 마지막 검토 후 90일이 지났다면 사진·지역·직업·관계상태·선호를 다시 확인합니다.",
  "취소·노쇼·제재 사유를 상대에게 자세히 공개하지 않습니다. 모든 이용 제한은 운영 기록을 남기며 재검토를 요청할 수 있습니다.",
] as const;
