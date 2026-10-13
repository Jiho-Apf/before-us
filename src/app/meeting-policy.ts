import { BEFORE_US } from "./config";
export type MeetingPolicy = { policyVersion: string; decisionHours: number; methodHours: number; proposalHours: number; replyHours: number; coordinationTargetHours: number };
let settings: MeetingPolicy = { ...BEFORE_US.meeting };
const listeners = new Set<() => void>();
export const getMeetingPolicy = () => settings;
export const subscribeMeetingPolicy = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function saveMeetingPolicy(next: MeetingPolicy) {
  if (!next.policyVersion.trim() || next.policyVersion === settings.policyVersion || ![next.decisionHours, next.methodHours, next.proposalHours, next.replyHours, next.coordinationTargetHours].every(value => Number.isInteger(value) && value >= 1 && value <= 720)) return "새 정책 버전과 1~720시간의 정수 기한을 입력해 주세요.";
  settings = { policyVersion: next.policyVersion.trim(), decisionHours: next.decisionHours, methodHours: next.methodHours, proposalHours: next.proposalHours, replyHours: next.replyHours, coordinationTargetHours: next.coordinationTargetHours };
  listeners.forEach(listener => listener()); return null;
}
export const afterHours = (at: string, hours: number) => new Date(Date.parse(at) + hours * 3600000).toISOString();
export function meetingResponseView(choices: Record<string, "positive" | "negative">, events: { actor: string; at: string; type?: string; kind?: string }[], members: string[], memberId: string, decisionAt: string, policy: MeetingPolicy, now: Date, allowed: boolean) {
  const at = (id: string) => events.find(event => (event.type || event.kind) === "meeting-choice" && event.actor === id && Date.parse(event.at) >= Date.parse(decisionAt) && Date.parse(event.at) < Date.parse(afterHours(decisionAt, policy.decisionHours)) && Date.parse(event.at) <= now.getTime())?.at;
  const deadline = afterHours(decisionAt, policy.decisionHours);
  const ownChoice = allowed && at(memberId) ? choices[memberId] || null : null;
  const all = allowed && members.every(id => at(id) && ["positive", "negative"].includes(choices[id]));
  const mutual = all && members.every(id => choices[id] === "positive");
  return { ownMeetingChoice: ownChoice, mutualMeetingWish: mutual, mutualYesAt: mutual ? new Date(Math.max(...members.map(id => Date.parse(at(id)!)))).toISOString() : null, meetingDeadline: deadline, canRespond: allowed && now.getTime() >= Date.parse(decisionAt) && now.getTime() < Date.parse(deadline) && !ownChoice, meetingResponseStatus: !allowed ? "locked" : all ? mutual ? "mutual" : "closed" : now.getTime() >= Date.parse(deadline) ? "unanswered" : ownChoice ? "waiting" : "choosing" };
}
