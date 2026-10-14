import { detailsShape, availabilityShape, copyDetails, copyAvailability, changedDetailFields, detailsError, availabilityError, draftSafe, intersectAvailability, matchesCommon, slotKey, slotStart, type AppointmentDetails, type Availability } from "./appointment-details";
import { afterHours, type MeetingPolicy } from "./meeting-policy";
import { contactAgreement, contactView, createContactSharing, reconcileContact, type ContactSharing } from "./contact-model";
export type AppointmentMethod = "mine" | "partner" | "together";
export const APPOINTMENT_METHODS = { mine: "내가 먼저 제안할게요", partner: "상대가 먼저 제안해도 좋아요", together: "같이 골라볼래요" };
export type Proposal = { id: string; owner: string; author: string; version: number; when: string; place: string; note: string; at: string; approvals: Record<string, string>; details?: AppointmentDetails; selections?: Record<string,string>; availabilityVersions?: Record<string,number>; intent?: "edit" | "new" };
export type AppointmentState = {
  programId: string;
  members: [string, string];
  policy: MeetingPolicy;
  mutualYesAt: string;
  revision: number;
  methods: Record<string, { value: AppointmentMethod; at: string }>;
  jointConsents: Record<string, string>;
  proposals: Proposal[];
  drafts: Record<string, { details: AppointmentDetails; proposalId?: string; version?: number; note?: string }>;
  availabilityDrafts: Record<string, Availability>;
  availability: Record<string, { value: Availability; version: number; at: string }>;
  history: Proposal[];
  changeRequests: Record<string, { actor: string; version: number; at: string }>;
  receipts: Record<string, Record<string, { version: number; at: string }>>;
  notices: { id: string; recipient: string; kind: "new" | "revision" | "accept" | "due-soon" | "final" | "availability" | "change-request" | "contact-changed" | "contact-released"; proposalId: string | null; version: number | null; at: string; kakao: "not-connected" }[];
  contactConsents: Record<string, { allowed: boolean; at: string; agreementKey?: string; agreementId?: string }>;
  contactSharing?: ContactSharing;
  events: { actor: string; at: string; kind: string; reason: string }[];
};
export type AppointmentCommand =
  | { type: "method"; value: AppointmentMethod; confirmed: boolean }
  | { type: "joint-confirm"; confirmed: boolean }
  | { type: "propose"; when: string; place: string; note: string; confirmed: boolean; proposalId?: string; version?: number; details?: AppointmentDetails; confirmedNewProposal?: boolean; intent?: "edit" | "new" }
  | { type: "approve"; proposalId: string; version: number; confirmed: boolean; selectedSlot?: string }
  | { type: "save-draft"; details: AppointmentDetails; proposalId?: string; version?: number; note?: string }
  | { type: "save-availability"; value: Availability }
  | { type: "share-availability"; value: Availability; confirmed: boolean }
  | { type: "request-change"; proposalId: string; version: number; confirmed: boolean }
  | { type: "page-open" }
  | { type: "reminder-check"; windowHours: number }
  | { type: "contact-consent"; allowed: boolean; confirmed: boolean }
  | { type: "contact-check" }
  | { type: "contact" };
export function createAppointment(programId: string, members: string[], mutualYesAt: string, policy: MeetingPolicy): AppointmentState | null {
  if (!programId || members.length !== 2 || members[0] === members[1] || !Number.isFinite(Date.parse(mutualYesAt))) return null;
  return { programId, members: [members[0], members[1]], policy: { ...policy }, mutualYesAt, revision: 0, methods: {}, jointConsents: {}, proposals: [], drafts: {}, availabilityDrafts: {}, availability: {}, history: [], changeRequests: {}, receipts: {}, notices: [], contactConsents: {}, contactSharing: createContactSharing(), events: [] };
}
function resolution(state: AppointmentState) {
  const [a, b] = state.members, av = state.methods[a]?.value, bv = state.methods[b]?.value;
  if (!av || !bv) return { kind: "pending", proposers: [] as string[], readyAt: null as string | null };
  const at = new Date(Math.max(Date.parse(state.methods[a].at), Date.parse(state.methods[b].at))).toISOString();
  if (av === "mine" && bv === "partner") return { kind: "single", proposers: [a], readyAt: at };
  if (av === "partner" && bv === "mine") return { kind: "single", proposers: [b], readyAt: at };
  if (av === "mine" && bv === "mine") return { kind: "parallel", proposers: [...state.members], readyAt: at };
  if (av === "together" && bv === "together") return { kind: "joint", proposers: [...state.members], readyAt: at };
  if (state.members.every(id => state.jointConsents[id])) return { kind: "joint", proposers: [...state.members], readyAt: new Date(Math.max(...state.members.map(id => Date.parse(state.jointConsents[id])))).toISOString() };
  return { kind: "confirm-joint", proposers: [] as string[], readyAt: null as string | null };
}
const commonCurrent = (proposal: Proposal, state: AppointmentState) => proposal.details?.basis !== "common" || state.members.every(id => proposal.availabilityVersions?.[id] === state.availability[id]?.version);
const approved = (state: AppointmentState) => state.proposals.find(proposal => commonCurrent(proposal,state) && state.members.every(id => proposal.approvals[id] && Date.parse(proposal.approvals[id]) >= Date.parse(proposal.at)) && (!proposal.details || state.members.every(id => !!proposal.selections?.[id] && proposal.selections[id] === proposal.selections[state.members[0]])));
function notice(state: AppointmentState, recipient: string, kind: AppointmentState["notices"][number]["kind"], now: Date, proposal?: Proposal) {
  const id = [state.programId,recipient,kind,proposal?.id || "conditions",proposal?.version || state.revision + 1].join(":");
  if (!state.notices.some(item => item.id === id)) state.notices.push({ id, recipient, kind, proposalId: proposal?.id || null, version: proposal?.version || null, at: now.toISOString(), kakao: "not-connected" });
}
export function appointmentAction(state: AppointmentState, memberId: string, command: AppointmentCommand, revision: number, now: Date, active: boolean) {
  const reject = (error: string) => ({ state, error });
  if ((!active && !["contact","contact-check"].includes(command.type)) || !state.members.includes(memberId) || !Number.isFinite(now.getTime()) || now.getTime() < Date.parse(state.mutualYesAt) || state.events.some(event => Date.parse(event.at) > now.getTime()) || revision !== state.revision) return reject("당사자 권한·진행 상태·최신 버전을 확인해 주세요.");
  if (approved(state) && !["contact","page-open","contact-consent","contact-check","reminder-check"].includes(command.type)) return reject("최종 합의된 약속은 임의로 변경하지 않아요. 문의해 주세요.");
  const next = structuredClone(state), mode = resolution(state);
  if (command.type === "method") {
    if (!command.confirmed || !Object.keys(APPOINTMENT_METHODS).includes(command.value) || state.methods[memberId]) return reject("본인의 약속 방식을 확인해 제출해 주세요. 상대 대신 선택하거나 중복 제출하지 않아요.");
    next.methods[memberId] = { value: command.value, at: now.toISOString() };
  } else if (command.type === "joint-confirm") {
    if (mode.kind !== "confirm-joint" || !command.confirmed || state.jointConsents[memberId]) return reject("자동 제안자 지정 대신 같이 고르기에 각자 확인이 필요해요.");
    next.jointConsents[memberId] = now.toISOString();
  } else if (command.type === "save-draft") {
    if (!mode.readyAt || !draftSafe(command.details) || !detailsShape(command.details) || (command.note !== undefined && (typeof command.note !== "string" || command.note.length > 200))) return reject("약속 방식 확정과 초안 크기를 확인해 주세요.");
    next.drafts[memberId] = { details: copyDetails(command.details), proposalId: command.proposalId, version: command.version, note: command.note };
  } else if (command.type === "save-availability" || command.type === "share-availability") {
    if (mode.kind !== "joint" || !draftSafe(command.value) || !availabilityShape(command.value)) return reject("같이 고르기가 확정된 두 사람만 조건을 작성할 수 있어요.");
    if (command.type === "save-availability") next.availabilityDrafts[memberId] = copyAvailability(command.value);
    else {
      const error = availabilityError(command.value,now); if (error || !command.confirmed) return reject(error || "가능 조건 공유를 확인해 주세요.");
      next.availability[memberId] = { value: copyAvailability(command.value), version: (state.availability[memberId]?.version || 0) + 1, at: now.toISOString() };
      delete next.availabilityDrafts[memberId];
      next.proposals.filter(proposal => proposal.details?.basis === "common").forEach(proposal => { proposal.approvals = {}; proposal.selections = {}; });
      notice(next,state.members.find(id => id !== memberId)!,"availability",now);
    }
  } else if (command.type === "request-change") {
    const proposal = next.proposals.find(item => item.id === command.proposalId);
    if (!proposal || proposal.version !== command.version || !command.confirmed || !mode.readyAt) return reject("수정 요청할 최신 제안을 확인해 주세요.");
    next.changeRequests[proposal.id] = { actor: memberId, version: proposal.version, at: now.toISOString() };
    delete proposal.approvals[memberId]; if (proposal.selections) delete proposal.selections[memberId];
    notice(next,state.members.find(id => id !== memberId)!,"change-request",now,proposal);
  } else if (command.type === "page-open") {
    if (!mode.readyAt) return reject("약속 방식이 확정된 뒤 약속 페이지를 확인할 수 있어요.");
    const unread = next.proposals.filter(proposal => next.receipts[memberId]?.[proposal.id]?.version !== proposal.version);
    if (!unread.length) return { state, error: null };
    next.receipts[memberId] = { ...next.receipts[memberId] };
    for (const proposal of unread) next.receipts[memberId][proposal.id] = { version: proposal.version, at: now.toISOString() };
  } else if (command.type === "reminder-check") {
    if (!Number.isInteger(command.windowHours) || command.windowHours < 1 || command.windowHours > state.policy.replyHours) return reject("마감 임박 기준 시간을 직접 설정해 주세요. 기본값은 임의 적용하지 않아요.");
    const size = next.notices.length;
    if (!approved(state)) for (const proposal of next.proposals) {
      const remaining = Date.parse(afterHours(proposal.at,state.policy.replyHours)) - now.getTime();
      if (remaining > 0 && remaining <= command.windowHours * 3600000) for (const id of state.members) if (!proposal.approvals[id]) notice(next,id,"due-soon",now,proposal);
    }
    if (next.notices.length === size) return { state, error: null };
  } else if (command.type === "contact-consent") {
    const agreement = contactAgreement(approved(state),state.members);
    if (!agreement || !command.confirmed || typeof command.allowed !== "boolean" || state.contactSharing?.safety && state.contactSharing.safety !== "clear" || state.contactSharing?.reservation?.status === "released") return reject("최신 약속 최종 합의·안전 상태·공개 전 본인의 별도 동의를 확인해 주세요.");
    if (!command.allowed && !state.contactConsents[memberId]?.allowed || state.contactConsents[memberId]?.allowed === command.allowed && state.contactConsents[memberId]?.agreementKey === agreement.key) return { state, error: null };
    next.contactConsents[memberId] = { allowed: command.allowed, at: now.toISOString(), agreementKey: agreement.key, agreementId: approved(state)!.id };
    next.events.push({ actor: memberId, at: now.toISOString(), kind: command.allowed ? "contact-consented" : "contact-withdrawn", reason: "본인의 연락처 공유 설정 · 번호 원문 미기록" });
    if (!command.allowed) notice(next,state.members.find(id => id !== memberId)!,"contact-changed",now);
    reconcileContact(next,approved(next),now,active,false);
  } else if (command.type === "contact-check") {
    reconcileContact(next,approved(next),now,active,true);
    if (JSON.stringify(next) === JSON.stringify(state)) return { state, error: null };
  } else if (command.type === "propose") {
    if (!command.details) return reject("새 약속안은 날짜·시간·활동·지역·예산·예상 길이·장소의 상세 항목을 확인한 뒤 보내 주세요. 기존 기록은 변조하지 않아요.");
    const current = command.proposalId ? state.proposals.find(proposal => proposal.id === command.proposalId) : null;
    if (!mode.readyAt || (!current && !mode.proposers.includes(memberId)) || (current && current.version !== command.version) || (command.proposalId && !current)) return reject("제안 차례와 수정할 최신 버전을 확인해 주세요.");
    if (!current && (mode.kind === "parallel" ? state.proposals.some(proposal => proposal.owner === memberId) : state.proposals.length > 0)) return reject("새 약속안을 중복 생성하지 말고 기존 안에 수정 제안을 해 주세요.");
    if (command.details) {
      const error = detailsError(command.details,now); if (error) return reject(error);
      const common = intersectAvailability(state.availability[state.members[0]]?.value || null,state.availability[state.members[1]]?.value || null,now);
      if (command.details.basis === "common" && (mode.kind !== "joint" || !matchesCommon(command.details,common))) return reject("양쪽이 실제 공유한 공통 날짜·시간·활동·지역 안에서 제안해 주세요.");
      if (mode.kind === "joint" && command.details.basis === "direct" && (!state.members.every(id => state.availability[id]) || !command.confirmedNewProposal)) return reject("같이 고르기에서는 양쪽 조건을 공유한 뒤 직접 새 제안으로 돌아갈지 확인해 주세요.");
    }
    const proposedWhen = command.details ? slotStart(command.details.slots[0]) : command.when;
    const proposedPlace = command.details ? command.details.place.label : command.place;
    if (!command.confirmed || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/.test(proposedWhen) || !Number.isFinite(Date.parse(proposedWhen)) || new Date(Date.parse(proposedWhen) + 9 * 3600000).toISOString().slice(0,19) !== proposedWhen.slice(0,19) || Date.parse(proposedWhen) <= now.getTime() || !proposedPlace.trim() || proposedPlace.length > 160 || command.note.length > 200) return reject("미래의 실제 일시·장소와 제안 내용을 직접 확인해 주세요. 장소 운영·예약은 확인된 것으로 표시하지 않아요.");
    if (current && current.when === proposedWhen && current.place === proposedPlace.trim() && current.note === command.note.trim() && JSON.stringify(current.details) === JSON.stringify(command.details)) return reject("수정할 내용을 입력해 주세요.");
    if (current) next.history.push(structuredClone(current));
    next.proposals.forEach(proposal => { proposal.approvals = {}; proposal.selections = {}; });
    const proposal = { id: current?.id || `proposal-${memberId}`, owner: current?.owner || memberId, author: memberId, version: (current?.version || 0) + 1, when: proposedWhen, place: proposedPlace.trim(), note: command.note.trim(), at: now.toISOString(), approvals: {}, details: command.details ? copyDetails(command.details) : undefined, selections: {}, availabilityVersions: command.details?.basis === "common" ? Object.fromEntries(state.members.map(id => [id,state.availability[id].version])) : undefined, intent: command.intent };
    if (current) next.proposals[next.proposals.findIndex(item => item.id === current.id)] = proposal;
    else next.proposals.push(proposal);
    delete next.drafts[memberId]; delete next.changeRequests[proposal.id];
    notice(next,state.members.find(id => id !== memberId)!,current ? "revision" : "new",now,proposal);
  } else if (command.type === "approve") {
    const proposal = next.proposals.find(item => item.id === command.proposalId);
    if (!proposal || proposal.version !== command.version || !command.confirmed || (!proposal.details && proposal.approvals[memberId]) || !commonCurrent(proposal,state) || Date.parse(proposal.details ? slotStart(proposal.details.slots.find(slot => slotKey(slot) === command.selectedSlot) || { date:"",start:"",end:"" }) : proposal.when) <= now.getTime() || (mode.kind === "parallel" && state.proposals.length < 2)) return reject("같은 최신 약속안을 확인해 주세요. 두 분이 먼저 제안하기를 골랐다면 각자 한 안을 작성한 뒤 비교해요.");
    if (proposal.details && proposal.approvals[memberId] && proposal.selections?.[memberId] === command.selectedSlot) return reject("이미 이 후보와 최신 버전을 확인했어요.");
    if (proposal.details && (!command.selectedSlot || !proposal.details.slots.some(slot => slotKey(slot) === command.selectedSlot && Date.parse(slotStart(slot)) > now.getTime()))) return reject("최신 제안의 후보 날짜·정확한 시작시간을 직접 골라 확인해 주세요.");
    next.proposals.forEach(item => { delete item.approvals[memberId]; if (item.selections) delete item.selections[memberId]; });
    proposal.approvals[memberId] = now.toISOString();
    if (proposal.details) proposal.selections = { ...proposal.selections, [memberId]: command.selectedSlot! };
    notice(next,state.members.find(id => id !== memberId)!,"accept",now,proposal);
    if (approved(next)) for (const id of state.members) notice(next,id,"final",now,proposal);
  } else if (command.type !== "contact") return reject("운영자는 회원 의사나 약속 방식을 대신 입력할 수 없어요.");
  next.revision += 1; next.events.push({ actor: command.type === "contact-check" ? "system-demo" : memberId, at: now.toISOString(), kind: command.type, reason: command.type === "contact-check" ? "명시적 가상 공개 점검 · 실제 서버 예약 미연결" : command.type === "contact" ? "조율 문의" : "본인 선택 확인 · 실제 인증 아님" });
  return { state: next, error: null };
}
export function appointmentView(state: AppointmentState | null, memberId: string, now: Date, active: boolean) {
  if (!state || !state.members.includes(memberId) || now.getTime() < Date.parse(state.mutualYesAt) || !Number.isFinite(now.getTime()) || state.events.some(event => Date.parse(event.at) > now.getTime())) return null;
  const peer = state.members.find(id => id !== memberId)!, mode = resolution(state), final = approved(state);
  const methodsDone = state.members.every(id => state.methods[id]);
  const ownProposal = state.proposals.some(proposal => proposal.owner === memberId);
  const allProposed = mode.kind !== "parallel" || state.proposals.length === 2;
  const last = [...state.proposals].sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0];
  const needsOwnReply = allProposed && state.proposals.some(proposal => !proposal.approvals[memberId]);
  const status = !active ? "진행 보류" : final ? "최종 합의" : mode.kind === "pending" ? state.methods[memberId] ? "상대 응답 대기" : "약속 방식 선택" : mode.kind === "confirm-joint" ? "약속 방식 선택" : !state.proposals.length || !allProposed ? mode.proposers.includes(memberId) && !ownProposal ? "내 제안 작성" : "상대 제안 대기" : needsOwnReply ? "수정안 응답" : "상대 응답 대기";
  const deadline = !mode.readyAt ? afterHours(state.mutualYesAt, state.policy.methodHours) : !state.proposals.length || !allProposed ? afterHours(mode.readyAt, state.policy.proposalHours) : last ? afterHours(last.at, state.policy.replyHours) : null;
  const common = intersectAvailability(state.availability[memberId]?.value || null,state.availability[peer]?.value || null,now);
  const finalSlot = final?.details?.slots.find(slot => slotKey(slot) === final.selections?.[memberId]);
  return { revision: state.revision, status, coordinationReady: !!mode.readyAt, proposer: mode.proposers.includes(memberId) ? mode.kind === "joint" ? "함께" : mode.kind === "parallel" ? "각자 한 안" : "나" : mode.proposers.includes(peer) ? "상대" : "미확정", now: now.toISOString(), ownDraft: structuredClone(state.drafts[memberId] || null), ownAvailabilityDraft: structuredClone(state.availabilityDrafts[memberId] || null), ownAvailability: structuredClone(state.availability[memberId]?.value || null), peerAvailability: structuredClone(state.availability[peer]?.value || null), common, contact: contactView(state,final,memberId,now,active), contactConsent: state.contactConsents[memberId]?.allowed ?? null, bothContactConsented: contactView(state,final,memberId,now,active).released, notices: state.notices.filter(item => item.recipient === memberId).map(item => ({ ...item })), history: state.history.map(proposal => ({ id: proposal.id, version: proposal.version, details: structuredClone(proposal.details || null), when: proposal.when, place: proposal.place, note: proposal.note, ownAuthor: proposal.author === memberId, at: proposal.at })), policyVersion: state.policy.policyVersion, ownMethod: state.methods[memberId]?.value || null, peerMethod: methodsDone ? state.methods[peer].value : null, resolution: mode.kind, ownJointConfirmed: !!state.jointConsents[memberId], peerJointConfirmed: methodsDone && !!state.jointConsents[peer], canPropose: active && !final && !!mode.readyAt && mode.proposers.includes(memberId) && !ownProposal && (mode.kind === "parallel" || !state.proposals.length), canEdit: active && !final && !!mode.readyAt, canApprove: active && !final && allProposed, deadline, overdue: !!deadline && now.getTime() >= Date.parse(deadline), targetAt: afterHours(state.mutualYesAt, state.policy.coordinationTargetHours), targetExceeded: now.getTime() >= Date.parse(afterHours(state.mutualYesAt, state.policy.coordinationTargetHours)), active, proposals: state.proposals.map(proposal => ({ id: proposal.id, version: proposal.version, when: proposal.when, place: proposal.place, note: proposal.note, own: proposal.owner === memberId, ownAuthor: proposal.author === memberId, changedFields: changedDetailFields(state.history.find(old => old.id === proposal.id && old.version === proposal.version - 1)?.details,proposal.details), details: structuredClone(proposal.details || null), ownSelectedSlot: proposal.selections?.[memberId] || null, peerSelectedSlot: proposal.selections?.[peer] || null, staleCommon: !commonCurrent(proposal,state), changeRequested: state.changeRequests[proposal.id]?.version === proposal.version, peerSeenAt: state.receipts[peer]?.[proposal.id]?.version === proposal.version ? state.receipts[peer][proposal.id].at : null, ownApproved: !!proposal.approvals[memberId], peerApproved: !!proposal.approvals[peer], responseDeadline: afterHours(proposal.at, state.policy.replyHours) })), final: final ? { when: finalSlot ? slotStart(finalSlot) : final.when, place: final.place, note: final.note, version: final.version, details: final.details ? { ...structuredClone(final.details), slots: finalSlot ? [{ ...finalSlot }] : final.details.slots } : null } : null };
}
export type AppointmentView = NonNullable<ReturnType<typeof appointmentView>>;
export function refreshContactReservation(state: AppointmentState, now: Date, active: boolean) {
  if (!Number.isFinite(now.getTime()) || state.events.some(item => Date.parse(item.at) > now.getTime())) return state;
  const next = structuredClone(state);
  reconcileContact(next,approved(next),now,active,false);
  if (JSON.stringify(next) === JSON.stringify(state)) return state;
  next.revision += 1;
  return next;
}
export function appointmentSafetyDemo(state: AppointmentState, safety: ContactSharing["safety"], revision: number, now: Date, active: boolean) {
  if (revision !== state.revision || !["clear","cancelled","stopped","blocked","review"].includes(safety) || !Number.isFinite(now.getTime()) || now.getTime() < Date.parse(state.mutualYesAt) || state.events.some(item => Date.parse(item.at) > now.getTime())) return { state, error: "안전 상태·최신 버전·가상 시각을 확인해 주세요." };
  const next = structuredClone(state);
  next.contactSharing ||= createContactSharing();
  next.contactSharing.safety = safety;
  reconcileContact(next,approved(next),now,active,false);
  next.events.push({ actor: "system-demo", at: now.toISOString(), kind: "contact-safety", reason: `가상 안전 상태: ${safety} · 당사자 동의 대행 아님` });
  next.revision += 1;
  return { state: next, error: null };
}
