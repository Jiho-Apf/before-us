import { BEFORE_US } from "./config";
import { type AgreementState, type Plan, shiftDay } from "./agreement-model";
import { validOwnPayment } from "./payment-model";

export const exchangeDay = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: BEFORE_US.agreement.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export const meetingDecisionAt = (lastDay: string) => `${shiftDay(lastDay, 1)}T${BEFORE_US.meeting.decisionOpensAt}:00+09:00`;
export function canOpenMeeting(complete: boolean, permitted: boolean, active: boolean, decisionAt: string, now: Date) {
  return complete && permitted && active && Number.isFinite(Date.parse(decisionAt)) && now.getTime() >= Date.parse(decisionAt);
}
export function startedExchangeGate(agreement: AgreementState | null, memberId: string, plan: Plan, now: Date) {
  if (!agreement || !Number.isFinite(now.getTime()) || !agreement.members.includes(memberId) || !agreement.startedAt || !Number.isFinite(Date.parse(agreement.startedAt)) || Date.parse(agreement.startedAt) > now.getTime() || !["started", "interrupted"].includes(agreement.status)) return `양쪽 결제·${plan} 선택·시작일 동의와 실제 개시 확인이 필요합니다.`;
  if (!agreement.members.every((id, index) => agreement.shared[id] === plan && agreement.confirmed[id] && Number.isFinite(Date.parse(agreement.confirmed[id]!)) && Date.parse(agreement.confirmed[id]!) <= Date.parse(agreement.startedAt!) && agreement.sessions[index].program?.ownPlan === plan && agreement.sessions[index].program?.partnerPlan === plan && agreement.sessions[index].program?.actualStartedAt === agreement.startedAt && !!agreement.sessions[index].program?.startEventId && agreement.sessions[index].program?.usable && agreement.sessions[index].program?.ownStartAt === agreement.startAt && agreement.sessions[index].program?.partnerStartAt === agreement.startAt && agreement.sessions[index].firstProgramStartedAt === agreement.startedAt)) return `동의한 ${plan} 프로그램의 유효한 양쪽 개시 기록이 필요합니다.`;
  if (!agreement.startAt || !Number.isFinite(Date.parse(agreement.startAt)) || !agreement.sessions[0].program?.id || agreement.sessions[0].program.id !== agreement.sessions[1].program?.id) return "같은 프로그램의 합의 일정 확인이 필요합니다.";
  if (!agreement.sessions.every(session => validOwnPayment(session.introduction, new Date(agreement.startedAt!)) && validOwnPayment(session.exchange, new Date(agreement.startedAt!)) && session.exchange?.amount === BEFORE_US.pricing.exchangePerPerson && session.exchange.programId === session.program?.id)) return "양쪽의 유효한 교류비 결제 기록이 필요합니다.";
  return null;
}
