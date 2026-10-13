import { useMemo, useSyncExternalStore } from "react";
import { emptyPaymentSession, requestPaymentCancellation, introductionRights, type PaymentSession } from "./payment-model";
import { getConsoleData, replaceConsoleData, subscribeConsoleData } from "./admin-console-data";
import { REPORT_TYPES, type Feedback } from "./admin-governance-model";
import { EMPTY_NOTICE_PREFERENCES, type NoticePreferences } from "./noon-status-model";

export const REQUEST_LABELS = { pause: "소개 일시정지", resume: "소개 재개 요청", refund: "결제·환불 요청", inquiry: "운영 문의", report: "신고·보호 요청", block: "차단", interrupt: "교류·약속 중단", revoke: "공개 철회", withdrawal: "탈퇴 요청", deletion: "자료 삭제 요청", reconsider: "결정 재검토 요청" } as const;
export type MemberRequestKind = keyof typeof REQUEST_LABELS;
export type RequestStatus = "requested" | "protection" | "checking" | "decided" | "reconsidering";
export const REQUEST_STATUSES: Record<RequestStatus,string> = { requested: "요청 접수 · 가상", protection: "보호 조치 확인", checking: "사실·정책 확인 중", decided: "운영 결정 기록", reconsidering: "재검토 요청" };
export type RequestContext = { memberId: string; targetId?: string | null; programId?: string | null; introductionId?: string | null; surface: string };
export type MemberRequest = RequestContext & { id: string; kind: MemberRequestKind; at: string; status: RequestStatus; description: string; urgent: boolean; reportType?: string; decision: string | null; policyVersion: string; receiptId?: string; parentId?: string; transitions: { at: string; actor: string; status: RequestStatus; note: string }[] };
export type PolicyRecord = { key: string; at: string; sourceAt: string | null; version: string; source: "account" | "purchase" | "application" | "disclosure"; scope: string; consents: string[]; profileVersion?: number; preferenceVersion?: number; amount?: number; vatIncluded?: boolean; refundPolicy?: string | null };
type MemberAccount = { payment: PaymentSession; marketing: boolean; notices: NoticePreferences; requests: MemberRequest[]; policies: PolicyRecord[]; history: { id: string; publishedAt: string | null; ownResponseAt: string | null; endReason: string | null }[] };
type MembersState = { revision: number; accounts: Record<string,MemberAccount> };
let snapshot: MembersState = { revision: 0, accounts: {} };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getMemberOperations = () => snapshot;
export const useMemberOperations = () => useSyncExternalStore(subscribe,getMemberOperations,getMemberOperations);
export const useOwnMemberAccount = (id: string) => useSyncExternalStore(subscribe,() => snapshot.accounts[id] || null,() => null);
export function useOwnMemberFeedback(memberId: string, programId: string | null) {
  const get=useMemo(()=>{let source: ReturnType<typeof getConsoleData> | null=null, result: Feedback[]=[];return ()=>{const next=getConsoleData();if(next!==source){source=next;result=next.governance.feedback.filter(item=>item.authorId===memberId && item.programId===programId).map(item=>({...item}));}return result;};},[memberId,programId]);
  return useSyncExternalStore(subscribeConsoleData,get,get);
}
const freshAccount = (): MemberAccount => ({ payment: emptyPaymentSession(), marketing: false, notices: {...EMPTY_NOTICE_PREFERENCES}, requests: [], policies: [], history: [] });
const accountIn = (state: MembersState, id: string) => state.accounts[id] ||= freshAccount();
const commit = (state: MembersState) => { state.revision += 1; snapshot = state; listeners.forEach(listener => listener()); };
export function ownMemberAccount(state: MembersState, id: string) { return state.accounts[id] || null; }
export function saveMemberPayment(memberId: string, payment: PaymentSession, now = new Date()) {
  if (!memberId || !payment.demo || !Number.isFinite(now.getTime())) return;
  const next = structuredClone(snapshot), account = accountIn(next,memberId);
  if (account.payment.applicationId===payment.applicationId && account.policies.some(item=>["purchase","disclosure"].includes(item.source)) && JSON.stringify(account.payment.policy)!==JSON.stringify(payment.policy)) return;
  const activity=account.payment.activity;
  account.payment = structuredClone(payment);
  if (activity !== "active" && payment.activity === "active") account.payment.activity=activity;
  const admin=structuredClone(getConsoleData());
  let ledgerChanged=false;
  for(const receipt of [payment.introduction,payment.exchange])if(receipt?.confirmedAt){
    let transaction=admin.payments.find(item=>item.id===receipt.id && item.memberId===memberId);
    if(!transaction){transaction={id:receipt.id,memberId,programId:receipt.programId,kind:receipt.kind,amount:receipt.amount,paidAt:receipt.confirmedAt,refundRequestedAt:receipt.cancelRequestedAt,refundedAt:receipt.refundedAt,refundAmount:receipt.refundedAt ? receipt.refundAmount ?? receipt.amount : 0};admin.payments.push(transaction);ledgerChanged=true;}
    if(receipt.cancelRequestedAt && !transaction.refundRequestedAt){transaction.refundRequestedAt=receipt.cancelRequestedAt;ledgerChanged=true;}
    if(receipt.refundRequest && transaction.refundBasis !== receipt.refundRequest.reason){transaction.refundRequestedAmount=receipt.refundRequest.amount;transaction.refundBasis=receipt.refundRequest.reason;transaction.refundPolicyVersion=receipt.refundRequest.policyVersion;ledgerChanged=true;}
    if(receipt.refundedAt && !transaction.refundedAt){transaction.refundedAt=receipt.refundedAt;transaction.refundAmount=receipt.refundAmount ?? receipt.amount;ledgerChanged=true;}
  }
  if(ledgerChanged){admin.source="virtual";replaceConsoleData(admin);}
  for(const receipt of [payment.introduction,payment.exchange])if(receipt?.disclosure){const disclosure=receipt.disclosure,key=`disclosure:${receipt.id}:${disclosure.at}`;if(!account.policies.some(item=>item.key===key))account.policies.push({key,at:now.toISOString(),sourceAt:disclosure.at,version:disclosure.policyVersion,source:"disclosure",scope:disclosure.scope,consents:["결제 전 제공 범위·미보장·대기·미시작·취소·환불 가상 안내 확인"],amount:receipt.amount,vatIncluded:disclosure.vatIncluded,refundPolicy:disclosure.refundPolicy});}
  for (const receipt of [payment.introduction,payment.exchange]) if (receipt?.confirmedAt && !account.policies.some(item => item.key === receipt.id)) account.policies.push({ key: receipt.id, at: now.toISOString(), sourceAt: receipt.confirmedAt, version: payment.policy.version, source: "purchase", amount: receipt.amount, vatIncluded: payment.policy.vatIncluded, refundPolicy: payment.policy.refund, scope: receipt.kind === "introduction" ? "이번 신청의 첫 A/B 실제 시작 전 소개 횟수 제한 없음 · 하루 최대 한 명 · 매일 미보장" : "상호 선택한 한 쌍의 A/B 3일 교류 · 1인 교류비 · 현장 비용 별도", consents: [] });
  commit(next);
}
export function recordApplicationPolicy(memberId: string, input: Omit<PolicyRecord,"key" | "at" | "source" | "scope">, now = new Date()) {
  if (!memberId || !input.sourceAt || !Number.isFinite(Date.parse(input.sourceAt)) || !Number.isFinite(now.getTime())) return;
  const key = `application:${input.profileVersion}:${input.preferenceVersion}:${input.sourceAt}`;
  if (snapshot.accounts[memberId]?.policies.some(item => item.key === key)) return;
  const next = structuredClone(snapshot), account = accountIn(next,memberId);
  account.policies.push({ ...input, consents: [...input.consents], key, at: now.toISOString(), source: "application", scope: "실제 저장된 가상 신청 동의·버전 스냅샷 · 검증 완료 아님" });
  commit(next);
}
export function setMemberMarketing(memberId: string, allowed: boolean) { const next = structuredClone(snapshot); accountIn(next,memberId).marketing = allowed; commit(next); }
export function setMemberNotices(memberId: string, value: NoticePreferences) { const next=structuredClone(snapshot);accountIn(next,memberId).notices={newIntroduction:value.newIntroduction===true,dailyWaiting:value.dailyWaiting===true};commit(next); }
export function saveMemberIntroductionHistory(memberId: string, history: MemberAccount["history"]) { const next = structuredClone(snapshot); accountIn(next,memberId).history = history.map(item => ({ id: item.id, publishedAt: item.publishedAt, ownResponseAt: item.ownResponseAt, endReason: item.endReason })); commit(next); }
export function submitMemberRequest(context: RequestContext, kind: MemberRequestKind, input: { description?: string; confirmed: boolean; urgent?: boolean; reportType?: string; receiptKind?: "introduction" | "exchange"; parentId?: string }, now = new Date()) {
  if (!context.memberId || !Object.prototype.hasOwnProperty.call(REQUEST_LABELS,kind) || !input.confirmed || !Number.isFinite(now.getTime()) || (input.description || "").length > 500 || /(?:https?:|@|\d[\d\s-]{6,}|주민등록번호|신분증)/i.test(input.description || "")) return { error: "본인 요청·확인·가상 시각·500자 이하 가상 설명을 확인해 주세요. 연락처·링크·신분 자료는 입력하지 않습니다.", id: null };
  if (kind === "report" && input.reportType && !REPORT_TYPES.includes(input.reportType as typeof REPORT_TYPES[number])) return { error: "신고 유형을 확인해 주세요.", id: null };
  const next = structuredClone(snapshot), account = accountIn(next,context.memberId);
  const duplicate = account.requests.find(item => item.kind === kind && item.programId === context.programId && item.introductionId === context.introductionId && item.parentId === input.parentId && item.receiptId === (input.receiptKind ? account.payment[input.receiptKind]?.id : undefined) && item.description === (input.description || "").trim() && item.urgent === (input.urgent===true) && item.reportType === input.reportType && item.status !== "decided");
  if (duplicate) return { error: null, id: duplicate.id };
  if (kind === "resume" && account.payment.activity === "active") return { error: "현재는 소개 일시정지 상태가 아닙니다. 재개 요청을 중복 생성하지 않습니다.", id: null };
  if (kind === "refund") { const result = requestPaymentCancellation(account.payment,input.receiptKind || "introduction",now); if (result.error) return { error: result.error, id: null }; account.payment = result.session; }
  if (["pause","revoke"].includes(kind)) account.payment.activity = "paused";
  if (["withdrawal","deletion"].includes(kind)) account.payment.activity = "withdrawal-requested";
  if (["pause","revoke","withdrawal","deletion"].includes(kind) && account.payment.refundOperations)
    account.payment.refundOperations.activeWaitingSince = null;
  if (kind === "reconsider" && !account.requests.some(item => item.id === input.parentId && item.status === "decided")) return { error: "본인의 운영 결정 기록이 있어야 재검토를 요청할 수 있어요.", id: null };
  const id = `member-request-${next.revision + 1}-${account.requests.length + 1}`;
  const request: MemberRequest = { ...context, id, kind, at: now.toISOString(), status: kind === "reconsider" ? "reconsidering" : "requested", description: (input.description || "").trim(), urgent: input.urgent === true, reportType: input.reportType, policyVersion: account.payment.policy.version, receiptId: input.receiptKind ? account.payment[input.receiptKind]?.id : undefined, parentId: input.parentId, decision: null, transitions: [] };
  account.requests.push(request); commit(next);
  if(kind==="refund"){const admin=structuredClone(getConsoleData());const transaction=admin.payments.find(item=>item.id===request.receiptId && item.memberId===context.memberId);if(transaction){const quote=account.payment[input.receiptKind || "introduction"]?.refundRequest;transaction.refundRequestedAt ||= request.at;if(quote){transaction.refundRequestedAmount=quote.amount;transaction.refundBasis=quote.reason;transaction.refundPolicyVersion=quote.policyVersion;}replaceConsoleData(admin);}}
  if (kind === "report") { const admin = structuredClone(getConsoleData()); admin.source = "virtual"; admin.reports.push({ id, memberId: context.targetId || context.memberId, reporterId: context.memberId, targetId: context.targetId || undefined, introductionId: context.introductionId || null, exchangeId: context.programId || null, type: input.reportType || "기타", description: request.description, hasAttachment: false, urgent: request.urgent, priority: request.urgent ? "긴급" : "일반", status: "new", createdAt: request.at }); replaceConsoleData(admin); }
  return { error: null, id };
}
export function decideMemberRequest(id: string, status: RequestStatus, note: string, now = new Date()) {
  if (!Object.prototype.hasOwnProperty.call(REQUEST_STATUSES,status) || !note.trim() || note.length > 200 || !Number.isFinite(now.getTime()) || /(?:https?:|@|\d[\d\s-]{6,})/i.test(note)) return "상태와 1~200자 개인정보 없는 결정·확인 내용을 기록해 주세요.";
  const next = structuredClone(snapshot), request = Object.values(next.accounts).flatMap(item => item.requests).find(item => item.id === id);
  if (!request || Date.parse(request.at) > now.getTime()) return "현재 접수 건과 시각을 확인해 주세요.";
  request.status = status; request.transitions.push({ status, at: now.toISOString(), actor: "가상 Owner", note: note.trim() });
  if (status === "decided") request.decision = note.trim();
  commit(next);
  const admin = structuredClone(getConsoleData());
  const report=admin.reports.find(item=>item.id===id);
  if(report)report.status=status==="protection" ? "action" : status==="decided" ? "closed" : "checking";
  admin.audits.push({ id: `member-operation-${next.revision}`, actor: "가상 Owner", at: now.toISOString(), action: `요청 검토 · ${REQUEST_LABELS[request.kind]} · 실제 환불/삭제/결정 대행 없음`, target: id, reason: "가상 운영 검토 기록", role: "Owner", result: "demo-only" }); replaceConsoleData(admin);
  return null;
}
export function syncMemberReportStatus(id: string, status: "new" | "reviewing" | "checking" | "action" | "closed", now=new Date()) {
  const next=structuredClone(snapshot), request=Object.values(next.accounts).flatMap(item=>item.requests).find(item=>item.id===id && item.kind==="report");
  if(!request || !Number.isFinite(now.getTime()) || Date.parse(request.at)>now.getTime())return;
  request.status=status==="closed" ? "decided" : status==="action" ? "protection" : status==="new" ? "requested" : "checking";
  request.transitions.push({status:request.status,at:now.toISOString(),actor:"가상 Owner",note:"기존 신고 운영 상태 변경 · 상세 결정 안내는 별도 확인"});commit(next);
}
export function saveMemberFeedback(context: RequestContext, complete: boolean, input: { body: string; category: Feedback["category"]; operatorConsent: boolean; publicConsent: boolean; id?: string; version?: number }, now = new Date()) {
  if (!complete || !context.programId || !context.memberId || !input.operatorConsent || !input.body.trim() || input.body.length > 500 || !["교류 후기","소개 만족도","운영 경험","일정·장소 기능 의견"].includes(input.category) || !Number.isFinite(now.getTime())) return "실제 가상 교류 완료·500자 이하 경험·운영팀 전달 동의를 확인해 주세요.";
  const admin = structuredClone(getConsoleData()), old = input.id ? admin.governance.feedback.find(item => item.id === input.id) : null;
  if (input.id && (!old || old.authorId !== context.memberId || old.programId !== context.programId || old.version !== input.version)) return "본인 피드백·최신 버전을 확인해 주세요.";
  const version = (old?.version || 0) + 1;
  const record: Feedback = { id: old?.id || `member-feedback-${admin.governance.feedback.length + 1}`, authorId: context.memberId, programId: context.programId, category: input.category, at: now.toISOString(), body: input.body.trim(), improvementRequested: false, publicConsentAt: input.publicConsent ? now.toISOString() : null, consentVersion: input.publicConsent ? version : null, version, reportId: null, review: old ? "revision-review" : "pending" };
  if (old) admin.governance.feedback[admin.governance.feedback.indexOf(old)] = record; else admin.governance.feedback.push(record);
  admin.source = "virtual"; replaceConsoleData(admin); return null;
}
export const memberRights = (state: MembersState, memberId: string, now = new Date()) => introductionRights(state.accounts[memberId]?.payment || emptyPaymentSession(),now);
