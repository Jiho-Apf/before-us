import { BEFORE_US } from "./config";
import { introductionView, publishDemoIntroduction, type IntroductionBook } from "./introduction-model";
import { TODAY_STATES, type TodayStage } from "./today-state";

export const STATUS_MESSAGES = {
  waiting: "[비포어스] 소개 진행 안내\n오늘 정오 기준, 새롭게 소개드릴 상대는 아직 준비되지 않았습니다.\n소개가 준비되면 안내드리겠습니다. 이용 중인 혜택 안에서는 추가 소개비가 발생하지 않습니다.",
  introduction: "[비포어스] 새로운 소개가 도착했어요. 홈페이지에서 소개 내용과 응답 기한을 확인해 주세요.",
  mutual: "[비포어스] 두 분 모두 알아가고 싶다고 선택했어요. 다음 진행 절차를 확인해 주세요.",
} as const;
export type NoticeType = keyof typeof STATUS_MESSAGES;
export type NoticePreferences = { newIntroduction: boolean; dailyWaiting: boolean };
export const EMPTY_NOTICE_PREFERENCES: NoticePreferences = { newIntroduction: false, dailyWaiting: false };
export type StatusStage = TodayStage | "withdrawn" | "cancelled";
export type NoonNotice = {
  key: string;
  memberId: string;
  introductionId: string | null;
  type: NoticeType;
  at: string;
  message: string;
  href: "/today" | "/us";
  website: "published-demo";
  inApp: "available-demo" | "not-selected";
  kakao: "approval-required" | "not-selected";
  attempts: { at: string; result: "failed-demo" | "delivered-demo"; reason: string }[];
};
export type NoonInput = {
  memberId: string;
  stage: StatusStage;
  operatorReviewedAt: string | null;
  waitingSince: string | null;
  lastIntroductionAt: string | null;
  preferences: NoticePreferences;
};
export type NoonState = {
  book: IntroductionBook;
  notices: NoonNotice[];
  runs: { memberId: string; date: string; at: string; status: string }[];
};
export const seoulDay = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: BEFORE_US.introduction.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const stoppedStages: StatusStage[] = ["a_write", "a_wait", "a_open", "b_choose", "b_wait", "day4", "meeting", "paused", "ended", "withdrawn", "cancelled"];

export function currentStatus(input: NoonInput) {
  if (input.stage === "withdrawn") return "탈퇴 상태 · 신규 소개 대기 안내 중지";
  if (input.stage === "cancelled") return "취소 상태 · 신규 소개 대기 안내 중지";
  if (input.stage === "review") return "운영자 확인 대기";
  return TODAY_STATES[input.stage].label;
}

export function waitingFollowUp(input: NoonInput, now: Date) {
  if (input.stage !== "waiting") return null;
  const anchor = input.lastIntroductionAt || input.waitingSince;
  if (!anchor || !Number.isFinite(Date.parse(anchor)) || Date.parse(anchor) > now.getTime()) return null;
  const days = Math.floor((Date.parse(`${seoulDay(now)}T00:00:00+09:00`) - Date.parse(`${seoulDay(new Date(anchor))}T00:00:00+09:00`)) / 86400000);
  const reviewCurrent = input.operatorReviewedAt && Number.isFinite(Date.parse(input.operatorReviewedAt)) && Date.parse(input.operatorReviewedAt) <= now.getTime() && Date.parse(input.operatorReviewedAt) >= Date.parse(anchor) + BEFORE_US.noonGuidance.reviewAfterDays * 86400000;
  return { days, needsReview: days >= BEFORE_US.noonGuidance.reviewAfterDays && !reviewCurrent, counseling: days >= BEFORE_US.noonGuidance.counselingAfterDays };
}

export function runNoonDemo(state: NoonState, inputs: NoonInput[], now: Date) {
  if (!Number.isFinite(now.getTime())) return { state, errors: ["유효한 실행 시각이 필요합니다."] };
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: BEFORE_US.introduction.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  if (time !== BEFORE_US.introduction.readyAt) return { state, errors: ["정오 12:00 Asia/Seoul 실행 구간이 아닙니다. 갱신하지 않았습니다."] };
  const date = seoulDay(now);
  const next = structuredClone(state);
  const errors: string[] = [];
  const blocked = new Set<string>();
  for (const record of next.book.records.filter(item => item.status === "reserved" && Date.parse(item.scheduledAt) <= now.getTime())) {
    const pairInputs = record.pair.map(id => inputs.find(input => input.memberId === id));
    if (pairInputs.some(input => !input || input.stage !== "ready" || next.runs.some(run => run.memberId === input.memberId && run.date === date))) {
      record.pair.forEach(id => blocked.add(id));
      errors.push("양쪽 현재 상태와 실행 이력 확인이 필요합니다. 공개하지 않았습니다.");
      continue;
    }
    const result = publishDemoIntroduction(next.book, record.id, next.book.revision, now);
    if (result.errors.length) { errors.push(...result.errors); record.pair.forEach(id => blocked.add(id)); }
    else next.book = result.book;
  }
  for (const input of inputs) {
    if (next.runs.some(run => run.memberId === input.memberId && run.date === date)) continue;
    let status = currentStatus(input);
    let type: NoticeType | null = null;
    const view = introductionView(next.book, input.memberId, now);
    const active = next.book.records.find(record => record.pair.includes(input.memberId) && record.status !== "closed" && record.status !== "reserved");
    if (stoppedStages.includes(input.stage)) status += " · 대기 알림 중지";
    else if (blocked.has(input.memberId)) status = "소개 공개 준비 확인 필요 · 공개 미실행";
    else if (view.mutual && active?.status === "mutual" && active.mutualAt && seoulDay(new Date(active.mutualAt)) === date && !["partner_payment", "agreement"].includes(input.stage)) { type = "mutual"; status = "상호 선택 · 다음 진행 확인"; }
    else if (active) {
      if (active.publishedAt && seoulDay(new Date(active.publishedAt)) === date && view.profile && input.stage === "ready") { type = "introduction"; status = "새 소개 공개"; }
      else status = ["payment", "agreement"].includes(active.status) ? "교류비 결제·방식 합의 상태 유지" : "기존 소개 응답 상태 유지";
    } else if (["waiting", "review"].includes(input.stage)) type = "waiting";
    next.runs.push({ memberId: input.memberId, date, at: now.toISOString(), status });
    if (!type) continue;
    const introductionId = type === "waiting" ? null : view.id;
    const key = JSON.stringify([input.memberId, date, type, introductionId]);
    if (next.notices.some(notice => notice.key === key)) continue;
    const selected = type === "waiting" ? input.preferences.dailyWaiting : input.preferences.newIntroduction;
    next.notices.push({ key, memberId: input.memberId, introductionId, type, at: now.toISOString(), message: STATUS_MESSAGES[type], href: type === "introduction" ? "/us" : "/today", website: "published-demo", inApp: selected ? "available-demo" : "not-selected", kakao: selected ? "approval-required" : "not-selected", attempts: [] });
  }
  return { state: next, errors };
}

export function recordVirtualDelivery(state: NoonState, key: string, result: "failed-demo" | "delivered-demo", now: Date) {
  const next = structuredClone(state);
  const notice = next.notices.find(item => item.key === key);
  if (!notice || notice.kakao === "not-selected" || !Number.isFinite(now.getTime()) || now.getTime() < Date.parse(notice.at) || notice.attempts.some(attempt => attempt.result === "delivered-demo")) return state;
  notice.attempts.push({ at: now.toISOString(), result, reason: "발송 결과 시뮬레이션 · 외부 발송 없음" });
  return next;
}

export function authorizedStatusLink(notice: NoonNotice, authenticatedMemberId: string | null, serverVerified: boolean) {
  return serverVerified && authenticatedMemberId === notice.memberId ? notice.href : null;
}
