import { BEFORE_US } from "./config";
import type { PaymentSession } from "./payment-model";

export const REFUND_POLICY = {
  version: BEFORE_US.refund.version,
  introduction: BEFORE_US.pricing.introduction,
  exchange: BEFORE_US.pricing.exchangePerPerson,
  dayPrice: BEFORE_US.refund.exchangeDayPrice,
  paymentHours: BEFORE_US.refund.paymentHours,
  agreementHours: BEFORE_US.refund.agreementHours,
  extensionHours: BEFORE_US.refund.extensionHours,
  waitingDays: BEFORE_US.refund.activeWaitingDays,
} as const;
export const REFUND_NOTICE = "소개비: 첫 상대 프로필 실제 열람 전 취소 시 5,000원 전액, 제공 개시 후 운영 측 귀책 시 전액. 활성 상태에서 연속 30일 유효한 새 소개가 없으면 계속 이용 또는 전액 환불 종료를 선택. 교류비: 실제 DAY01 개시 전 24,000원, DAY01 후 DAY02 전 16,000원, DAY02 후 DAY03 전 8,000원, DAY03 후 미제공 DAY 환불 없음. 법정 청약철회 권리와 실제 약관 검토에 따른 더 유리한 권리를 제한하지 않습니다.";
export type RefundOperations = {
  policy: typeof REFUND_POLICY;
  introductionOpenedAt: string | null;
  introductionId: string | null;
  activeWaitingSince: string | null;
  lastValidIntroductionAt: string | null;
  waitingChoice: "continue" | "refund-exit" | null;
  dayOpened: ({ id: string; at: string } | null)[];
  bothPaidAt: string | null;
  agreementCompletedAt: string | null;
  extension: { requestedBy: string | null; consents: string[]; used: boolean };
};
export const emptyRefundOperations = (): RefundOperations => ({
  policy: { ...REFUND_POLICY }, introductionOpenedAt: null, introductionId: null,
  activeWaitingSince: null, lastValidIntroductionAt: null, waitingChoice: null,
  dayOpened: [null, null, null], bothPaidAt: null, agreementCompletedAt: null,
  extension: { requestedBy: null, consents: [], used: false },
});
const valid = (at: string | null | undefined, now: Date) =>
  !!at && Number.isFinite(Date.parse(at)) && Date.parse(at) <= now.getTime();
export function refundDeadlines(session: PaymentSession) {
  const ops = session.refundOperations;
  const after = (at: string | null | undefined, hours: number) =>
    at && Number.isFinite(Date.parse(at)) ? new Date(Date.parse(at) + hours * 3600000).toISOString() : null;
  return {
    paymentAt: ops ? after(session.program?.mutualConfirmedAt, ops.policy.paymentHours) : null,
    agreementAt: ops ? after(ops.bothPaidAt, ops.policy.agreementHours + (ops.extension.used ? ops.policy.extensionHours : 0)) : null,
  };
}
export function waitingRefundAvailable(session: PaymentSession, now: Date) {
  const ops = session.refundOperations;
  return !!ops && session.activity === "active" && !session.firstProgramStartedAt &&
    session.policy.refundPolicyVersion === ops.policy.version && session.introduction?.status === "confirmed" &&
    valid(session.introduction.confirmedAt, now) && !session.introduction.refundedAt &&
    valid(ops.activeWaitingSince, now) &&
    now.getTime() - Date.parse(ops.activeWaitingSince!) >= ops.policy.waitingDays * 86400000;
}
export type RefundReason = "cancel" | "operator-fault" | "waiting-30" | "partner-unpaid" | "agreement-timeout" | "never-started";
export function refundQuote(session: PaymentSession, kind: "introduction" | "exchange", now: Date, reason: RefundReason = "cancel") {
  const ops = session.refundOperations, receipt = session[kind];
  const pending = { amount: null as number | null, reason: "구매 시점 정책·승인·제공 기록 확인 필요", restoreIntroductionRights: false, policyVersion: ops?.policy.version || null };
  if (!ops || session.policy.refundPolicyVersion !== ops.policy.version || !receipt || receipt.amount !== ops.policy[kind] || !valid(receipt.confirmedAt, now) || receipt.refundedAt)
    return pending;
  const result = (amount: number | null, basis: string, restore = false) => ({
    amount: amount === null ? null : Math.min(receipt.amount, amount),
    reason: basis, restoreIntroductionRights: restore && !session.firstProgramStartedAt,
    policyVersion: ops.policy.version,
  });
  if (kind === "introduction") {
    if (reason === "operator-fault") return result(ops.policy.introduction, "서비스 오류·필수조건 위반 등 운영 측 귀책 확인 시 전액 · 귀책 확인 필요");
    if (reason === "waiting-30") return waitingRefundAvailable(session, now)
      ? result(ops.policy.introduction, "활성 연속 30일 유효한 새 소개 없음 · 본인 전액 환불 종료 선택")
      : result(null, "활성 연속 30일의 실제 대기 기록 확인 필요");
    return !ops.introductionOpenedAt
      ? result(ops.policy.introduction, "첫 상대 프로필 실제 열람 전 취소 · 전액")
      : result(null, "이미 제공된 소개 서비스분 · 운영 귀책 및 법정 청약철회/약관 권리 개별 확인");
  }
  if (session.exchange?.programId !== session.program?.id) return result(null, "결제와 교류 프로그램 연결 확인 필요");
  const deadlines = refundDeadlines(session);
  if (reason === "partner-unpaid") return !session.firstProgramStartedAt && session.program?.partnerPayment !== "confirmed" && deadlines.paymentAt && now.getTime() >= Date.parse(deadlines.paymentAt)
    ? result(ops.policy.exchange, "상호 선택 후 24시간 · 상대 미결제 · 전액/소개 권리 복원 대상", true)
    : result(null, "24시간 기한·상대 미결제 확인 필요");
  if (reason === "agreement-timeout") return deadlines.agreementAt && !ops.agreementCompletedAt && !session.firstProgramStartedAt && now.getTime() >= Date.parse(deadlines.agreementAt)
    ? result(ops.policy.exchange, "양쪽 결제 후 합의 기한 초과 · 미시작 전액/소개 권리 유지", true)
    : result(null, "양쪽 결제·합의 기한·연장·미시작 확인 필요");
  if (reason === "never-started" && session.firstProgramStartedAt) return result(null, "실제 개시 기록이 있어 미시작 전액 규칙을 적용하지 않습니다.");
  if (session.firstProgramStartedAt && !ops.dayOpened[0]) return result(null, "실제 개시와 DAY 제공 기록 불일치 · 운영 확인 필요");
  const count = ops.dayOpened.reduce((latest, item, index) => item && valid(item.at, now) ? index + 1 : latest, 0);
  return result(ops.policy.exchange - count * ops.policy.dayPrice, `마지막 실제 개시 ${count ? `DAY0${count}` : "DAY01 전"} · 미제공 DAY 기준 ${3 - count}일 × 8,000원`, count === 0);
}
export function recordDayAvailability(session: PaymentSession, day: number, id: string, at: string, available: boolean, now: Date) {
  const ops = session.refundOperations;
  if (!ops || !available || !id || !Number.isInteger(day) || day < 0 || day > 2 || !valid(at, now) ||
      !valid(session.firstProgramStartedAt, now) || Date.parse(at) < Date.parse(session.firstProgramStartedAt!) ||
      !session.program?.usable || session.program.withdrawn || session.activity !== "active" ||
      ops.dayOpened[day]) return session;
  const date = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  const expected = new Date(Date.parse(`${date(session.firstProgramStartedAt!)}T00:00:00Z`) + day * 86400000).toISOString().slice(0, 10);
  if (date(at) !== expected) return session;
  const next = structuredClone(session);
  next.refundOperations!.dayOpened[day] = { id, at };
  return next;
}
