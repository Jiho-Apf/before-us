import { getMeetingPolicy, meetingResponseView, type MeetingPolicy } from "./meeting-policy";
import { agreementGate, agreementView, shiftDay, type AgreementState } from "./agreement-model";
import { canOpenMeeting, exchangeDay, meetingDecisionAt, startedExchangeGate } from "./exchange-common";

export const SCENE_ACTIVITIES = [
  { id: "exhibition", label: "전시", caption: "한 장면 앞에서, 잠깐 멈추기", image: "https://images.unsplash.com/photo-1560245144-0082694a8da9?auto=format&fit=crop&w=1080&q=80", credit: "lan deng / Unsplash" },
  { id: "walk", label: "산책", caption: "나란히 걸으며, 편한 속도로", image: "https://images.unsplash.com/photo-1624818145490-b385d0593e5d?auto=format&fit=crop&w=1080&q=80", credit: "Megan Lee / Unsplash" },
  { id: "bookstore", label: "서점", caption: "서로의 눈길이 머무는 책", image: "https://images.unsplash.com/photo-1607957333562-c760eee665ef?auto=format&fit=crop&w=1080&q=80", credit: "Veronika Martinelli / Unsplash" },
] as const;
export const FLOW_OPTIONS = ["짧게 둘러보기", "천천히 머물기"];
export const REST_OPTIONS = ["조용한 카페", "공공 야외 공간"];
export const SCENE_TITLES = ["어떤 분위기에서 시작할까요?", "그 시간에 무엇을 더할까요?", "두 사람의 첫 장면"];
export type SceneDraft = { activity: string; reason: string; value: string; opinion: string; rest: string; topic: string; activityMinutes: string; restMinutes: string };
export const emptySceneDraft = (): SceneDraft => ({ activity: "", reason: "", value: "", opinion: "", rest: "", topic: "", activityMinutes: "", restMinutes: "" });
type DayChoice = { activity: string; reason: string; at: string };
type Turn = { slot: "flow" | "rest" | "topic"; value: string; reason: string; opinion: string; author: string; at: string };
export type BoardValues = { activity: string; rest: string; topic: string; activityMinutes: number | null; restMinutes: number | null };
type BoardVersion = { version: number; values: BoardValues; reason: string; author: string; at: string; approvals: Record<string, string> };
type MeetingDetails = { activity: string; region: string; duration: number; budget: number; at: string };
export type SceneBook = {
  programId: string;
  revision: number;
  scheduleVersion: number;
  dates: [string, string, string];
  drafts: Record<string, Record<number, SceneDraft>>;
  choices: Record<string, DayChoice>;
  turns: Turn[];
  boards: BoardVersion[];
  status: "active" | "interrupted" | "blocked";
  access: Record<string, boolean>;
  meetingChoices: Record<string, "positive" | "negative">;
  meetingPolicy: MeetingPolicy;
  actualProposals: Record<string, MeetingDetails>;
  events: { kind: string; actor: string; at: string; revision: number; day: number | null }[];
};
const textValid = (text: string, maximum: number) => typeof text === "string" && !!text.replace(/[\s\u200B-\u200D\uFEFF]/g, "") && text.length <= maximum;
export const activityLabel = (id: string) => SCENE_ACTIVITIES.find(activity => activity.id === id)?.label || (id === "exhibition-walk" ? "전시 + 산책" : "선택 확인 필요");
const activityValid = (id: string, combination = false) => SCENE_ACTIVITIES.some(activity => activity.id === id) || (combination && id === "exhibition-walk");
const validAt = (value: string, now: Date) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now.getTime();
const inDay = (value: string, date: string) => Number.isFinite(Date.parse(value)) && exchangeDay(new Date(value)) === date && Date.parse(value) >= Date.parse(`${date}T09:00:00+09:00`);
function validBook(book: SceneBook, agreement: AgreementState) {
  return book.programId === agreement.sessions[0].program?.id && book.dates.length === 3 && book.dates.every((date, index) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T09:00:00+09:00`)) && exchangeDay(new Date(`${date}T09:00:00+09:00`)) === date && (index === 0 || date > book.dates[index - 1])) && (book.scheduleVersion === 1 ? book.dates.every((date, index) => date === shiftDay(exchangeDay(new Date(agreement.startAt!)), index)) : book.scheduleVersion > 1 && book.events.some(event => event.kind.startsWith("schedule-reset:")));
}
function completedDays(book: SceneBook, agreement: AgreementState, now: Date) {
  const first = agreement.members.every(id => book.choices[id] && activityValid(book.choices[id].activity) && textValid(book.choices[id].reason, 200) && validAt(book.choices[id].at, now) && inDay(book.choices[id].at, book.dates[0]));
  const second = first && book.turns.length === 3 && book.turns.every((turn, index) => turn.slot === ["flow", "rest", "topic"][index] && turn.author === agreement.members[index % 2] && (turn.slot === "flow" ? FLOW_OPTIONS.includes(turn.value) : turn.slot === "rest" ? REST_OPTIONS.includes(turn.value) : textValid(turn.value, 80)) && (index === 0 || Date.parse(turn.at) >= Date.parse(book.turns[index - 1].at)) && textValid(turn.reason, 200) && textValid(turn.opinion, 200) && validAt(turn.at, now) && inDay(turn.at, book.dates[1]));
  const board = book.boards[book.boards.length - 1];
  const third = second && !!board && valuesValid(board.values) && textValid(board.reason, 200) && validAt(board.at, now) && inDay(board.at, book.dates[2]) && agreement.members.every(id => board.approvals[id] && validAt(board.approvals[id], now) && inDay(board.approvals[id], book.dates[2]) && Date.parse(board.approvals[id]) >= Date.parse(board.at));
  return [first, second, third];
}
export function createSceneBook(agreement: AgreementState, now: Date): SceneBook | null {
  if (startedExchangeGate(agreement, agreement.members[0], "B", now) || agreementGate(agreement, now)) return null;
  const dates = agreementView(agreement, agreement.members[0], now)!.dates;
  return { programId: agreement.sessions[0].program!.id, revision: 0, scheduleVersion: 1, dates: [dates[0], dates[1], dates[2]], drafts: {}, choices: {}, turns: [], boards: [], status: "active", access: Object.fromEntries(agreement.members.map(id => [id, true])), meetingChoices: {}, meetingPolicy: { ...getMeetingPolicy() }, actualProposals: {}, events: [] };
}
function dayGate(book: SceneBook, agreement: AgreementState, day: number, now: Date) {
  if (agreementGate(agreement, now) || agreement.status !== "started" || book.status !== "active") return "교류가 중단되었거나 참여 상태 확인이 필요합니다.";
  if (!Number.isInteger(day) || day < 0 || day > 2 || exchangeDay(now) !== book.dates[day] || now.getTime() < Date.parse(`${book.dates[day]}T09:00:00+09:00`)) return "해당 DAY의 09:00~23:59, Asia/Seoul에만 공유할 수 있습니다. 미래 날짜·과거 수정은 잠겨 있어요.";
  if (day > 0 && !completedDays(book, agreement, now)[day - 1]) return "앞선 날의 실제 공유·합의가 아직 완료되지 않았어요. 대기·지연 상태를 확인하거나 문의해 주세요.";
  return null;
}
export type SceneCommand =
  | { type: "save"; day: number; draft: SceneDraft }
  | { type: "share-activity"; activity: string; reason: string }
  | { type: "propose-turn"; slot: "flow" | "rest" | "topic"; value: string; reason: string; opinion: string }
  | { type: "propose-board"; values: BoardValues; reason: string }
  | { type: "approve-board"; version: number; confirmed: boolean }
  | { type: "meeting-choice"; choice: "positive" | "negative"; confirmed: boolean }
  | { type: "actual-proposal"; activity: string; region: string; duration: number; budget: number; confirmed: boolean }
  | { type: "interrupt" | "block" | "report" | "contact" };
function valuesValid(values: BoardValues) {
  const minutes = [values.activityMinutes, values.restMinutes];
  return activityValid(values.activity, true) && REST_OPTIONS.includes(values.rest) && textValid(values.topic, 80) && minutes.every(value => value === null || (Number.isInteger(value) && value >= 1 && value <= 180)) && minutes.reduce<number>((total, value) => total + (value || 0), 0) <= 180;
}
export function sceneAction(book: SceneBook, agreement: AgreementState, memberId: string, command: SceneCommand, expectedRevision: number, now: Date) {
  const reject = (error: string) => ({ book, error });
  if (startedExchangeGate(agreement, memberId, "B", now) || !validBook(book, agreement) || expectedRevision !== book.revision || (!book.access[memberId] && !["report", "contact"].includes(command.type))) return reject("당사자 권한·B 프로그램·최신 버전을 확인해 주세요.");
  const next = structuredClone(book);
  let day: number | null = null;
  if (["save", "share-activity", "propose-turn", "propose-board", "approve-board"].includes(command.type)) {
    day = command.type === "save" ? command.day : command.type === "share-activity" ? 0 : command.type === "propose-turn" ? 1 : 2;
    const gate = dayGate(book, agreement, day, now); if (gate) return reject(gate);
  }
  if (command.type === "save") {
    if (Object.values(command.draft).some(value => typeof value !== "string" || value.length > 200)) return reject("초안은 짧은 선택·이유로 작성해 주세요.");
    next.drafts[memberId] = { ...next.drafts[memberId], [command.day]: structuredClone(command.draft) };
  } else if (command.type === "share-activity") {
    if (!activityValid(command.activity) || !textValid(command.reason, 200)) return reject("활동과 짧은 이유를 직접 선택해 주세요.");
    next.choices[memberId] = { activity: command.activity, reason: command.reason.trim(), at: now.toISOString() };
    if (next.drafts[memberId]) delete next.drafts[memberId][0];
  } else if (command.type === "propose-turn") {
    const index = book.turns.length;
    if (index >= 3 || command.slot !== ["flow", "rest", "topic"][index] || memberId !== agreement.members[index % 2]) return reject("현재 제안 차례와 항목을 확인해 주세요. 상대의 차례를 대신 작성하지 않습니다.");
    if (!(command.slot === "flow" ? FLOW_OPTIONS.includes(command.value) : command.slot === "rest" ? REST_OPTIONS.includes(command.value) : textValid(command.value, 80)) || !textValid(command.reason, 200) || !textValid(command.opinion, 200)) return reject("제안과 짧은 이유, 공유한 내용에 대한 의견을 작성해 주세요.");
    next.turns.push({ slot: command.slot, value: command.value.trim(), reason: command.reason.trim(), opinion: command.opinion.trim(), author: memberId, at: now.toISOString() });
    if (next.drafts[memberId]) delete next.drafts[memberId][1];
  } else if (command.type === "propose-board") {
    if (!valuesValid(command.values) || !textValid(command.reason, 200)) return reject("활동·쉬는 시간·대화 소재와 제안 이유를 확인해 주세요. 상상 속 시간은 3시간 이내이며 분량은 선택입니다.");
    const previous = book.boards[book.boards.length - 1];
    if (previous && JSON.stringify(previous.values) === JSON.stringify(command.values)) return reject("현재 버전과 다른 수정 내용을 제안해 주세요. 같은 장면은 별도로 승인할 수 있습니다.");
    next.boards.push({ version: (previous?.version || 0) + 1, values: structuredClone(command.values), reason: command.reason.trim(), author: memberId, at: now.toISOString(), approvals: {} });
    if (next.drafts[memberId]) delete next.drafts[memberId][2];
  } else if (command.type === "approve-board") {
    const board = next.boards[next.boards.length - 1];
    if (!board || board.version !== command.version || !command.confirmed || board.approvals[memberId]) return reject("같은 최신 버전을 직접 확인해야 합니다. 과거 버전·중복 승인은 처리하지 않습니다.");
    board.approvals[memberId] = now.toISOString();
  } else if (command.type === "meeting-choice") {
    if (!sceneView(book, agreement, memberId, now)?.canRespond || !command.confirmed || !["positive", "negative"].includes(command.choice) || book.meetingChoices[memberId]) return reject("정상 3일 완료·DAY04 오픈·본인 확인과 응답 기한을 확인해 주세요. 마감 후 미응답은 자동 선택하지 않으며 문의가 필요합니다. 선택은 중복 제출하지 않습니다.");
    next.meetingChoices[memberId] = command.choice;
  } else if (command.type === "actual-proposal") {
    const view = sceneView(book, agreement, memberId, now);
    if (!view?.meetingOpen || !view.mutualMeetingWish || !command.confirmed || !textValid(command.activity, 120) || !textValid(command.region, 40) || !Number.isInteger(command.duration) || command.duration < 1 || command.duration > 600 || !Number.isInteger(command.budget) || command.budget < 0 || command.budget > 1000000) return reject("양쪽 실제 만남 희망 확인 뒤 실제 활동·넓은 지역·길이·예산을 새로 확인해 주세요.");
    next.actualProposals[memberId] = { activity: command.activity.trim(), region: command.region.trim(), duration: command.duration, budget: command.budget, at: now.toISOString() };
  } else if (command.type === "interrupt") next.status = "interrupted";
  else if (command.type === "block") { next.status = "blocked"; next.access = Object.fromEntries(agreement.members.map(id => [id, false])); }
  else if (!["report", "contact"].includes(command.type)) return reject("지원하지 않는 요청입니다.");
  next.revision += 1; next.events.push({ kind: command.type, actor: memberId, at: now.toISOString(), revision: next.revision, day });
  return { book: next, error: null };
}
export function sceneView(book: SceneBook | null, agreement: AgreementState | null, memberId: string, now: Date) {
  if (!book || !agreement || startedExchangeGate(agreement, memberId, "B", now) || !validBook(book, agreement)) return null;
  const peer = agreement.members.find(id => id !== memberId)!;
  const permitted = !!book.access[memberId];
  const completed = completedDays(book, agreement, now);
  const status = agreement.status === "interrupted" && book.status === "active" ? "interrupted" : book.status;
  const current = book.boards[book.boards.length - 1];
  const visibleBoard = permitted && current && validAt(current.at, now) ? { version: current.version, values: structuredClone(current.values), reason: current.reason, ownProposal: current.author === memberId, ownApproved: !!current.approvals[memberId] && validAt(current.approvals[memberId], now), peerApproved: !!current.approvals[peer] && validAt(current.approvals[peer], now) } : null;
  const decisionAt = meetingDecisionAt(book.dates[2]);
  const meetingOpen = canOpenMeeting(completed.every(Boolean), permitted, status === "active" && agreement.status === "started" && !agreementGate(agreement, now), decisionAt, now);
  const meeting = meetingResponseView(book.meetingChoices, book.events, agreement.members, memberId, decisionAt, book.meetingPolicy, now, meetingOpen);
  const mutualMeetingWish = meeting.mutualMeetingWish;
  const choices = permitted ? agreement.members.map(id => book.choices[id] && validAt(book.choices[id].at, now) ? { ...book.choices[id], own: id === memberId } : null) : [null, null];
  return {
    revision: book.revision, programId: book.programId, status, readAccess: permitted,
    dates: [...book.dates], completed, todayIndex: book.dates.indexOf(exchangeDay(now)),
    ownDrafts: permitted ? structuredClone(book.drafts[memberId] || {}) : {},
    days: book.dates.map((date, index) => ({ date, title: SCENE_TITLES[index], writable: permitted && !dayGate(book, agreement, index, now), reason: permitted ? dayGate(book, agreement, index, now) : "접근 권한 재검토 중", future: date > exchangeDay(now), delayed: date < exchangeDay(now) && !completed[index] })),
    choices, different: !!choices[0] && !!choices[1] && choices[0].activity !== choices[1].activity,
    turns: permitted ? book.turns.filter(turn => validAt(turn.at, now)).map(turn => ({ slot: turn.slot, value: turn.value, reason: turn.reason, opinion: turn.opinion, own: turn.author === memberId })) : [],
    turnIndex: book.turns.length, myTurn: permitted && book.turns.length < 3 && agreement.members[book.turns.length % 2] === memberId,
    board: visibleBoard, versions: permitted ? book.boards.filter(board => validAt(board.at, now)).map(board => ({ version: board.version, own: board.author === memberId, at: board.at, values: structuredClone(board.values), reason: board.reason })) : [],
    complete: completed.every(Boolean), delayed: status !== "blocked" && book.dates.some((date, index) => date < exchangeDay(now) && !completed[index]),
    decisionAt, meetingOpen, ...meeting,
    recommendation: mutualMeetingWish && visibleBoard ? { kind: "imagined-reference-only", boardVersion: visibleBoard.version, values: structuredClone(visibleBoard.values), actualDate: null, reservation: null } : null,
    actualProposals: mutualMeetingWish ? { own: book.actualProposals[memberId] || null, peer: book.actualProposals[peer] || null } : null,
  };
}
export type SceneView = NonNullable<ReturnType<typeof sceneView>>;
