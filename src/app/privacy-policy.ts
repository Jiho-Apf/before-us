import { useSyncExternalStore } from "react";
import { BEFORE_US } from "./config";
import { refundQuote } from "./refund-policy";
import type { PaymentSession } from "./payment-model";

// V6-privacy-01-draft: 개인정보 보유·삭제·탈퇴 정책 UI와 가상 데이터 상태.
// 법률 검토 완료가 아니며, 삭제·백업 파기는 예정 시각만 계산하고 실제로 실행하지 않는다.
export const PRIVACY_POLICY = BEFORE_US.privacy;
const DAY = 86400000;
const parsed = (at: string | null | undefined) => !!at && Number.isFinite(Date.parse(at));
const plusDays = (at: string, days: number) => new Date(Date.parse(at) + days * DAY).toISOString();
const plusMonths = (at: string, months: number) => { const date = new Date(at); date.setUTCMonth(date.getUTCMonth() + months); return date.toISOString(); };
const kstDay = (at: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));

export type RetentionBasis = "service" | "internal" | "legal";
export const RETENTION_ITEMS: { id: string; data: string; period: string; basis: RetentionBasis }[] = [
  { id: "account", data: "계정·프로필·비공개 선호", period: "서비스 이용 중 · 탈퇴 후 활성 시스템 7일 이내 삭제", basis: "service" },
  { id: "photos", data: "사진", period: "이용 중 · 사진 삭제·탈퇴 후 활성 저장소 7일 이내 삭제", basis: "service" },
  { id: "letters", data: "A/B 편지·공동 장면", period: "교류 종료 후 30일 뒤 자동 삭제", basis: "service" },
  { id: "appointment", data: "약속 날짜·시간·장소 상세", period: "약속일 후 90일", basis: "service" },
  { id: "profile-view", data: "소개받은 상대 프로필 열람", period: "정오 공개~다음 날 11:00 응답 마감 · 상호 선택 시 교류·약속 종료까지 · 종료 즉시 닫힘", basis: "service" },
  { id: "profile-snapshot", data: "제공된 프로필 사본(버전 기록)", period: "소개·교류 종료 후 30일 뒤 삭제 · 분쟁 증거만 분리 보존", basis: "service" },
  { id: "phone", data: "상대 전화번호 화면", period: "만남 당일 00:00부터 다음 날 23:59까지만 표시", basis: "service" },
  { id: "audit", data: "관리자·접근 감사 로그", period: "1년", basis: "internal" },
  { id: "backup", data: "일반 백업", period: "순환 보관 최대 30일", basis: "internal" },
  { id: "contract", data: "계약·청약철회·결제·서비스 공급 기록", period: "5년", basis: "legal" },
  { id: "complaint", data: "소비자 불만·분쟁 처리 기록", period: "3년", basis: "legal" },
  { id: "advertising", data: "표시·광고 기록", period: "6개월", basis: "legal" },
  { id: "safety", data: "안전 신고 증거 · 필요한 자료만", period: "사건 종결 후 기본 3년", basis: "legal" },
  { id: "litigation", data: "수사·소송 등 법적 절차 자료", period: "절차 진행 중 필요한 자료만 별도 보존 · 종료 후 파기 검토", basis: "legal" },
];
export const LEGAL_SEPARATION = "법적 보존자료는 일반 프로필과 분리해 보관하며 재매칭·광고 목적으로 사용하지 않습니다.";

// 가상 회원의 자료 현황. 기록이 없는 항목은 추정하지 않는다.
export type DataInventory = {
  memberId: string;
  photoCount: number;
  exchangeActive: boolean;
  exchangeEndedAt: string | null;
  meetingDate: string | null;
  payments: { id: string; at: string }[];
  complaints: { id: string; closedAt: string | null }[];
  safetyReports: { id: string; closedAt: string | null }[];
  advertisingAt: string | null;
  litigationHold: boolean;
};
export type LegalHold = { category: "contract" | "complaint" | "advertising" | "safety" | "litigation"; label: string; until: string | null; reason: string };

export function legalHolds(inventory: DataInventory, evidence: EvidenceHold[] = []): LegalHold[] {
  const legal = PRIVACY_POLICY.legal;
  const holds: LegalHold[] = inventory.payments.filter(item => parsed(item.at)).map(item => ({ category: "contract", label: `결제·서비스 공급 기록 ${item.id}`, until: plusMonths(item.at, legal.contractYears * 12), reason: "계약·청약철회·결제·서비스 공급 법정 기록 5년" }));
  for (const item of inventory.complaints) holds.push({ category: "complaint", label: `불만·분쟁 처리 기록 ${item.id}`, until: parsed(item.closedAt) ? plusMonths(item.closedAt!, legal.complaintYears * 12) : null, reason: parsed(item.closedAt) ? "소비자 불만·분쟁 처리 기록 3년" : "처리 중 · 종결 후 3년" });
  for (const hold of evidence.filter(item => item.memberIds.includes(inventory.memberId))) holds.push({ category: "safety", label: `안전 신고 증거 ${hold.reportId} · ${hold.items.join(", ")}`, until: hold.until, reason: hold.until ? "사건 종결 후 기본 3년" : "사건 진행 중 · 종결 후 3년" });
  if (parsed(inventory.advertisingAt)) holds.push({ category: "advertising", label: "표시·광고 기록", until: plusMonths(inventory.advertisingAt!, legal.advertisingMonths), reason: "표시·광고 기록 6개월" });
  if (inventory.litigationHold) holds.push({ category: "litigation", label: "법적 절차 관련 자료", until: null, reason: "필요한 자료만 별도 보존 · 절차 종료 후 파기 검토" });
  return holds;
}

// 연락처 표시 창: 만남 당일 00:00 ~ 다음 날 23:59 (Asia/Seoul)
export function contactDisplayWindow(meetingDate: string) {
  const from = `${meetingDate}T00:00:00+09:00`;
  return parsed(from) ? { from, until: new Date(Date.parse(from) + 2 * DAY - 1000).toISOString() } : null;
}

export type ScheduleRow = { id: string; data: string; basis: RetentionBasis; state: string; until: string | null };
export function retentionSchedule(inventory: DataInventory, now: Date, withdrawal: WithdrawalRecord | null = null): ScheduleRow[] {
  const row = (id: string, state: string, until: string | null): ScheduleRow => { const item = RETENTION_ITEMS.find(entry => entry.id === id)!; return { id, data: item.data, basis: item.basis, state, until }; };
  const due = (until: string | null) => until && now.getTime() >= Date.parse(until) ? " · 기한 도래(가상 데모라 실제 삭제는 실행하지 않음)" : "";
  const active = withdrawal?.activeDeleteBy || null;
  const rows: ScheduleRow[] = [
    row("account", active ? `탈퇴 요청 · 활성 시스템 삭제 예정${due(active)}` : "이용 중 보유", active),
    row("photos", inventory.photoCount ? active ? `사진 ${inventory.photoCount}장 · 삭제 예정${due(active)}` : `사진 ${inventory.photoCount}장 · 이용 중` : "등록된 사진 없음", inventory.photoCount ? active : null),
  ];
  const letterBy = inventory.exchangeEndedAt && parsed(inventory.exchangeEndedAt) ? plusDays(inventory.exchangeEndedAt, PRIVACY_POLICY.letterDaysAfterExchangeEnd) : null;
  const letterUntil = active && (!letterBy || Date.parse(active) < Date.parse(letterBy)) ? active : letterBy;
  rows.push(row("letters", inventory.exchangeActive && !active ? "교류 진행 중 · 종료 후 30일 뒤 삭제" : letterUntil ? `삭제 예정${due(letterUntil)}` : "교류 기록 없음", inventory.exchangeActive && !active ? null : letterUntil));
  const meetingBy = inventory.meetingDate ? plusDays(`${inventory.meetingDate}T00:00:00+09:00`, PRIVACY_POLICY.appointmentDetailDaysAfterMeeting) : null;
  const appointmentUntil = active && meetingBy && Date.parse(active) < Date.parse(meetingBy) ? active : meetingBy;
  rows.push(row("appointment", appointmentUntil ? `상세 삭제 예정${due(appointmentUntil)}` : "약속 기록 없음", appointmentUntil));
  const window = inventory.meetingDate ? contactDisplayWindow(inventory.meetingDate) : null;
  rows.push(row("phone", !window ? "공개된 연락처 없음" : withdrawal ? "탈퇴 요청으로 표시하지 않음" : now.getTime() < Date.parse(window.from) ? `만남 당일부터 표시 · ${kstDay(window.from)} 00:00` : now.getTime() <= Date.parse(window.until) ? "표시 중" : "표시 종료", window && !withdrawal ? window.until : null));
  rows.push(row("audit", "기록일로부터 1년 순차 삭제", null));
  rows.push(row("backup", withdrawal ? `탈퇴 반영 백업 순차 삭제 예정${due(withdrawal.backupDeleteBy)}` : "최대 30일 순환", withdrawal?.backupDeleteBy || null));
  return rows;
}

// ── 탈퇴 ──
export type WithdrawalInput = { memberId: string; payment: PaymentSession; introductionActive: boolean; exchangeStatus: string | null; appointmentActive: boolean; contactScheduled: boolean; inventory: DataInventory; now: Date };
export function withdrawalPreview(input: WithdrawalInput, evidence: EvidenceHold[] = snapshot.evidence) {
  const { payment, now } = input;
  const ends: string[] = [];
  const refunds: { kind: "introduction" | "exchange"; label: string; amount: number | null; basis: string }[] = [];
  if (input.introductionActive) ends.push("진행 중인 소개 · 상대에게 종료로만 안내");
  if (input.exchangeStatus === "started") ends.push("진행 중인 A/B 교류 · 본인 요청 중단으로 처리");
  else if (["choosing", "scheduled"].includes(input.exchangeStatus || "")) ends.push("시작 전 교류 준비 · 미시작 종료");
  if (input.appointmentActive) ends.push("만남 약속 · 상대에게 취소로만 안내");
  if (input.contactScheduled) ends.push("미공개 연락처 공개 예약 · 즉시 취소");
  for (const kind of ["introduction", "exchange"] as const) {
    const receipt = payment[kind];
    if (!receipt || !["confirmed", "requested"].includes(receipt.status) || receipt.refundedAt) continue;
    const quote = refundQuote(payment, kind, now, "cancel");
    refunds.push({ kind, label: kind === "introduction" ? "소개 이용료" : "교류비", amount: quote.amount, basis: quote.reason });
  }
  return {
    ends, refunds,
    immediate: ["상대에게 내 프로필·사진 노출 중지", "신규 소개·새 접근 중지", "미공개 연락처 예약 취소", "서비스 처리 안내 외 알림·마케팅 중지"],
    activeDeleteBy: plusDays(now.toISOString(), PRIVACY_POLICY.activeDeleteDays),
    backupDeleteBy: plusDays(now.toISOString(), PRIVACY_POLICY.backupMaxDays),
    legal: legalHolds(input.inventory, evidence),
  };
}
export type WithdrawalRecord = ReturnType<typeof withdrawalPreview> & { id: string; memberId: string; requestId: string | null; requestedAt: string; policyVersion: string; immediateAppliedAt: string; execution: "not-executed-demo" };
export type DataRequestKind = "correction" | "deletion" | "restriction";
export const DATA_REQUEST_LABELS: Record<DataRequestKind, string> = { correction: "정정", deletion: "삭제", restriction: "처리정지" };
export const DATA_SCOPES = ["프로필", "사진", "비공개 선호", "편지·공동 장면", "약속 상세", "결제·환불 기록", "신고·분쟁 기록", "마케팅·광고 기록"] as const;
export type DataRequest = { requestId: string; memberId: string; kind: DataRequestKind; scope: string[]; at: string; exceptions: LegalHold[]; result: { status: "processed" | "partial" | "declined"; note: string; at: string } | null };
export const DATA_RESULT_LABELS = { processed: "처리 결과 기록 · 실제 삭제·변경은 서버 연동 필요", partial: "일부 처리 · 법정 보존 항목 제외", declined: "처리 불가 · 사유 안내" } as const;
export const EVIDENCE_ITEMS = ["신고 설명", "관련 약속 기록", "관련 편지 일부", "관련 사진 1장", "연락처 악용 정황 기록"] as const;
export type EvidenceHold = { id: string; reportId: string; memberIds: string[]; items: string[]; preservedAt: string; closedAt: string | null; until: string | null; note: string };
type PrivacyState = { revision: number; withdrawals: WithdrawalRecord[]; dataRequests: DataRequest[]; evidence: EvidenceHold[] };

let snapshot: PrivacyState = { revision: 0, withdrawals: [], dataRequests: [], evidence: [] };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getPrivacyState = () => snapshot;
export const usePrivacyState = () => useSyncExternalStore(subscribe, getPrivacyState, getPrivacyState);
const commit = (state: PrivacyState) => { state.revision += 1; snapshot = state; listeners.forEach(listener => listener()); };
export function resetPrivacyDemo() { commit({ revision: snapshot.revision, withdrawals: [], dataRequests: [], evidence: [] }); }

// 탈퇴는 불필요하게 막지 않는다. 확인만 받고, 진행 중인 건은 종료·환불 요청 상태로 함께 만든다.
export function recordWithdrawal(input: WithdrawalInput, requestId: string | null) {
  if (!input.memberId || !Number.isFinite(input.now.getTime())) return { error: "가상 계정과 시각을 확인해 주세요.", record: null };
  const existing = snapshot.withdrawals.find(item => item.memberId === input.memberId);
  if (existing) return { error: null, record: existing };
  const preview = withdrawalPreview(input);
  const next = structuredClone(snapshot);
  const record: WithdrawalRecord = { ...preview, id: `withdrawal-${next.revision + 1}-${input.memberId}`, memberId: input.memberId, requestId, requestedAt: input.now.toISOString(), policyVersion: PRIVACY_POLICY.version, immediateAppliedAt: input.now.toISOString(), execution: "not-executed-demo" };
  next.withdrawals.push(record); commit(next);
  return { error: null, record };
}
export function dataRequestExceptions(kind: DataRequestKind, scope: string[], inventory: DataInventory, evidence: EvidenceHold[] = snapshot.evidence) {
  if (kind === "correction") return [];
  const holds = legalHolds(inventory, evidence);
  return holds.filter(hold =>
    hold.category === "contract" && scope.includes("결제·환불 기록") ||
    ["complaint", "safety", "litigation"].includes(hold.category) && (scope.includes("신고·분쟁 기록") || hold.category === "safety" && scope.some(item => ["사진", "편지·공동 장면", "약속 상세"].includes(item))) ||
    hold.category === "advertising" && scope.includes("마케팅·광고 기록"));
}
export function recordDataRequest(input: { requestId: string; memberId: string; kind: DataRequestKind; scope: string[]; inventory: DataInventory; now: Date }) {
  const scope = input.scope.filter(item => (DATA_SCOPES as readonly string[]).includes(item));
  if (!input.requestId || !scope.length || !DATA_REQUEST_LABELS[input.kind]) return "요청 종류와 대상 자료를 선택해 주세요.";
  if (snapshot.dataRequests.some(item => item.requestId === input.requestId)) return null;
  const next = structuredClone(snapshot);
  next.dataRequests.push({ requestId: input.requestId, memberId: input.memberId, kind: input.kind, scope, at: input.now.toISOString(), exceptions: dataRequestExceptions(input.kind, scope, input.inventory), result: null });
  commit(next); return null;
}
export function recordDataRequestResult(requestId: string, status: "processed" | "partial" | "declined", note: string, now = new Date()) {
  if (!note.trim() || note.length > 200 || /(?:https?:|@|\d[\d\s-]{6,})/i.test(note)) return "1~200자 개인정보 없는 처리 결과를 기록해 주세요.";
  const next = structuredClone(snapshot), item = next.dataRequests.find(entry => entry.requestId === requestId);
  if (!item) return "요청을 찾을 수 없어요.";
  if (status === "processed" && item.exceptions.length) return "법정 보존 항목이 있는 요청은 일부 처리로 기록하고 사유와 보존기간을 안내해 주세요.";
  item.result = { status, note: note.trim(), at: now.toISOString() };
  commit(next); return null;
}
// 신고 때문에 사진·편지 전체를 오래 보관하지 않는다. 분쟁에 필요한 항목만 최대 3개 분리 보존한다.
export function preserveEvidence(input: { reportId: string; memberIds: string[]; items: string[]; note: string }, now = new Date()) {
  const items = input.items.filter(item => (EVIDENCE_ITEMS as readonly string[]).includes(item));
  if (!input.reportId || !input.memberIds.length || !items.length || items.length !== input.items.length || items.length > 3) return "신고와 분쟁에 필요한 항목만 1~3개 선택해 주세요. 사진·편지 전체 보관은 하지 않습니다.";
  if (!input.note.trim() || /(?:https?:|@|\d[\d\s-]{6,})/i.test(input.note)) return "보존 사유를 개인정보 없이 적어 주세요.";
  const next = structuredClone(snapshot);
  if (next.evidence.some(item => item.reportId === input.reportId && !item.closedAt)) return "이 신고에는 이미 진행 중인 증거 보존 기록이 있어요.";
  next.evidence.push({ id: `evidence-${next.revision + 1}`, reportId: input.reportId, memberIds: [...input.memberIds], items, preservedAt: now.toISOString(), closedAt: null, until: null, note: input.note.trim() });
  commit(next); return null;
}
export function closeEvidence(id: string, now = new Date()) {
  const next = structuredClone(snapshot), item = next.evidence.find(entry => entry.id === id);
  if (!item || item.closedAt) return "진행 중인 증거 보존 기록을 확인해 주세요.";
  item.closedAt = now.toISOString(); item.until = plusMonths(item.closedAt, PRIVACY_POLICY.legal.safetyEvidenceYearsAfterClose * 12);
  commit(next); return null;
}
