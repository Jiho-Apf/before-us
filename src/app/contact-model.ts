import type { AppointmentState, Proposal } from "./appointment-model";
import { slotKey, slotStart } from "./appointment-details";

export const CONTACT_POLICY = { version: "V6-contact-01-draft", timezone: "Asia/Seoul", releaseTime: "00:00" } as const;
export type ContactSharing = { policy: typeof CONTACT_POLICY; safety: "clear" | "cancelled" | "stopped" | "blocked" | "review"; reservation: { key: string; at: string; status: "scheduled" | "cancelled" | "released"; releasedAt?: string } | null };
export function createContactSharing(): ContactSharing { return { policy: { ...CONTACT_POLICY }, safety: "clear", reservation: null }; }
// Proposal ID alone cannot prove consent to its latest version/date/time.
const consentMatches = (state: AppointmentState, id: string, proposal: Proposal | undefined, key: string) => !!proposal && state.contactConsents[id]?.allowed === true && state.contactConsents[id]?.agreementKey === key;
export function contactAgreement(proposal: Proposal | undefined, members: string[]) {
  if (!proposal?.details || !members.every(id => proposal.approvals[id] && Date.parse(proposal.approvals[id]) >= Date.parse(proposal.at) && proposal.selections?.[id] === proposal.selections?.[members[0]])) return null;
  const slot = proposal.details.slots.find(item => slotKey(item) === proposal.selections?.[members[0]]);
  if (!slot || !proposal.place.trim() || !proposal.details.place.label.trim()) return null;
  const at = `${slot.date}T00:00:00+09:00`;
  if (!Number.isFinite(Date.parse(at)) || !Number.isFinite(Date.parse(slotStart(slot)))) return null;
  return { key: `${proposal.id}:${proposal.version}:${slotKey(slot)}`, at };
}
function virtualPhone(state: AppointmentState, memberId: string) {
  const index = state.members.indexOf(memberId);
  return index === -1 ? null : { number: index === 0 ? "010-0000-0001" : "010-0000-0002", masked: index === 0 ? "010-00**-00*1" : "010-00**-00*2" };
}
export function reconcileContact(state: AppointmentState, final: Proposal | undefined, now: Date, active: boolean, release: boolean) {
  const sharing = state.contactSharing ||= createContactSharing();
  const agreement = contactAgreement(final, state.members);
  const eligible = active && sharing.safety === "clear" && !!agreement && state.members.every(id => consentMatches(state,id,final,agreement.key) && virtualPhone(state,id));
  const event = (kind: string) => state.events.push({ actor: "system-demo", at: now.toISOString(), kind, reason: "연락처 공개 조건 가상 검증 · 번호 원문 미기록" });
  if (sharing.reservation?.status === "scheduled" && (!eligible || sharing.reservation.key !== agreement?.key || sharing.reservation.at !== agreement?.at)) { sharing.reservation.status = "cancelled"; event("contact-cancelled"); }
  if (!eligible || !agreement || sharing.reservation?.status === "released" && sharing.reservation.key === agreement.key) return;
  if (sharing.reservation?.status !== "scheduled") { sharing.reservation = { key: agreement.key, at: agreement.at, status: "scheduled" }; event("contact-scheduled"); }
  if (release && now.getTime() >= Date.parse(agreement.at)) {
    sharing.reservation.status = "released"; sharing.reservation.releasedAt = now.toISOString(); event("contact-released");
    for (const recipient of state.members) state.notices.push({ id: `${state.programId}:contact-released:${agreement.key}:${recipient}`, recipient, kind: "contact-released", proposalId: final!.id, version: final!.version, at: now.toISOString(), kakao: "not-connected" });
  }
}
export function contactView(state: AppointmentState, final: Proposal | undefined, memberId: string, now: Date, active: boolean) {
  const agreement = contactAgreement(final,state.members), sharing = state.contactSharing || createContactSharing(), own = state.contactConsents[memberId], peer = state.members.find(id => id !== memberId)!;
  const currentConsent = !!agreement && !!consentMatches(state,memberId,final,agreement.key);
  const both = !!agreement && state.members.every(id => consentMatches(state,id,final,agreement.key));
  const party = state.members.length === 2 && new Set(state.members).size === 2 && state.members.includes(memberId);
  const safe = party && active && sharing.safety === "clear";
  const reservation = sharing.reservation;
  const released = safe && both && !!agreement && reservation?.key === agreement.key && reservation.at === agreement.at && reservation.status === "released" && !!reservation.releasedAt && now.getTime() >= Date.parse(agreement.at) && now.getTime() >= Date.parse(reservation.releasedAt);
  const scheduled = safe && both && reservation?.key === agreement?.key && reservation?.at === agreement?.at && reservation?.status === "scheduled";
  return { ownMasked: virtualPhone(state,memberId)?.masked || null, ownVerifiedDemo: !!virtualPhone(state,memberId), ownConsent: currentConsent, ownConsentAt: currentConsent ? own?.at || null : null, finalAgreed: !!agreement, releaseAt: agreement?.at || null, scheduled, released, wasReleased: reservation?.status === "released", blocked: !safe, canWithdraw: safe && !!agreement && currentConsent && reservation?.status !== "released", canConsent: safe && !!agreement && reservation?.status !== "released", peerConsent: released ? "동의 완료" : "상대의 선택을 기다리고 있어요", ...(released ? { peerNumber: virtualPhone(state,peer)!.number } : {}), events: state.events.filter(item => ["contact-consented","contact-withdrawn","contact-scheduled","contact-cancelled","contact-released"].includes(item.kind) && (item.actor === memberId || item.actor === "system-demo")).map(item => ({ kind: item.kind, at: item.at })), policyVersion: sharing.policy.version };
}
