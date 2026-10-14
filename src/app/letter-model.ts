import { getMeetingPolicy, meetingResponseView, type MeetingPolicy } from "./meeting-policy";
import { BEFORE_US } from "./config";
import { agreementGate, agreementView, shiftDay, type AgreementState } from "./agreement-model";
import { canOpenMeeting, meetingDecisionAt, startedExchangeGate } from "./exchange-common";

export const LETTER_DAYS = [
  { title: "내 하루 한 장면", question: "최근의 나를 가장 잘 보여 주는 하루는 어떤 하루였나요?" },
  { title: "당신의 말이 궁금해졌어요", question: "어제 받은 편지에서 기억에 남은 말 하나에 답하고, 궁금한 것을 물어보세요." },
  { title: "만나면 이어가고 싶은 이야기", question: "직접 만나게 된다면 어떤 시간을 보내고 싶나요?" },
] as const;
type Submission = { body: string; at: string };
// replies: 그날 함께 열린 상대 편지에 보내는 답장. 키는 답장을 쓴 사람.
type LetterDay = { date: string; drafts: Record<string, string>; submissions: Record<string, Submission>; publishedAt: string | null; replies?: Record<string, Submission> };
// 답장: 그날 함께 열린 상대 편지에 각자 한 번. 편지처럼 두 사람 모두 보내야 함께 열린다.
// 답장에 대한 답장은 없다. 당일 23:59까지 쓸 수 있고, 18:00까지 쓰지 않은 사람에게 알림을 한 번 보낸다.
export const LETTER_REPLY = { maxLength: 600, reminderAt: "18:00" } as const;
export type LetterBook = {
  programId: string;
  revision: number;
  scheduleVersion: number;
  days: [LetterDay, LetterDay, LetterDay];
  status: "active" | "interrupted" | "blocked";
  access: Record<string, boolean>;
  meetingChoices: Record<string, "positive" | "negative">;
  meetingPolicy: MeetingPolicy;
  events: { type: string; actor: string; at: string; revision: number; day: number | null }[];
};
const seoulDay = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: BEFORE_US.letters.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const baseGate = (agreement: AgreementState | null, memberId: string, now: Date) => startedExchangeGate(agreement, memberId, "A", now);
export function createLetterBook(agreement: AgreementState, now: Date): LetterBook | null {
  if (baseGate(agreement, agreement.members[0], now) || agreementGate(agreement, now)) return null;
  const dates = agreementView(agreement, agreement.members[0], now)!.dates;
  const make = (date: string): LetterDay => ({ date, drafts: {}, submissions: {}, publishedAt: null });
  return { programId: agreement.sessions[0].program!.id, revision: 0, scheduleVersion: 1, days: [make(dates[0]), make(dates[1]), make(dates[2])], status: "active", access: Object.fromEntries(agreement.members.map(id => [id, true])), meetingChoices: {}, meetingPolicy: { ...getMeetingPolicy() }, events: [] };
}
export type LetterCommand =
  | { type: "save"; day: number; body: string }
  | { type: "submit"; day: number; body: string; confirmed: boolean }
  | { type: "reply"; day: number; body: string; confirmed: boolean }
  | { type: "meeting-choice"; choice: "positive" | "negative"; confirmed: boolean }
  | { type: "report" | "contact" | "interrupt" | "block" };
const published = (row: LetterDay, members: string[], now: Date) => !!row.publishedAt && Number.isFinite(Date.parse(row.publishedAt)) && Date.parse(row.publishedAt) <= now.getTime() && members.every(id => row.submissions[id] && !!row.submissions[id].body.trim() && Number.isFinite(Date.parse(row.submissions[id].at)) && Date.parse(row.submissions[id].at) >= Date.parse(`${row.date}T09:00:00+09:00`) && Date.parse(row.submissions[id].at) < Date.parse(`${shiftDay(row.date, 1)}T00:00:00+09:00`) && Date.parse(row.submissions[id].at) <= Date.parse(row.publishedAt!));
function validBook(book: LetterBook, agreement: AgreementState) {
  return book.days.length === 3 && Number.isInteger(book.scheduleVersion) && book.scheduleVersion >= 1 && book.days.every((row, index) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(Date.parse(`${row.date}T09:00:00+09:00`)) && seoulDay(new Date(`${row.date}T09:00:00+09:00`)) === row.date && (index === 0 || row.date > book.days[index - 1].date) && (book.scheduleVersion !== 1 || row.date === shiftDay(seoulDay(new Date(agreement.startAt!)), index))) && (book.scheduleVersion === 1 || book.events.some(event => event.type.startsWith("schedule-reset:")));
}
function rowGate(book: LetterBook, agreement: AgreementState, memberId: string, index: number, now: Date) {
  if (agreementGate(agreement, now) || agreement.status !== "started" || book.status !== "active") return "교류가 중단되었거나 새 편지 이용 확인이 필요합니다. 문의해 주세요.";
  const row = book.days[index];
  if (!row) return "유효한 DAY를 확인해 주세요.";
  if (row.submissions[memberId]) return "이미 보낸 편지는 수정하거나 같은 날 다시 보낼 수 없습니다.";
  const opens = Date.parse(`${row.date}T${BEFORE_US.letters.opensAt}:00+09:00`);
  const closes = Date.parse(`${shiftDay(row.date, 1)}T00:00:00+09:00`);
  if (now.getTime() < opens || now.getTime() >= closes || seoulDay(now) !== row.date) return "오늘의 작성 시간은 09:00~23:59, Asia/Seoul입니다. 다른 날짜 편지는 보낼 수 없습니다.";
  if (index === 1 && !published(book.days[0], agreement.members, now)) return "어제 실제로 공개된 편지가 없습니다. 없는 편지에 답장을 요청하지 않습니다. 교류 지연 상담이 필요합니다.";
  return null;
}
const replyClosesAt = (row: LetterDay) => `${shiftDay(row.date, 1)}T00:00:00+09:00`;
const replyReminderAt = (row: LetterDay) => `${row.date}T${LETTER_REPLY.reminderAt}:00+09:00`;
// 두 사람의 답장이 모두 마감 전에 도착했을 때만 함께 연다.
const repliesOpen = (row: LetterDay, members: string[], now: Date) =>
  members.every(id => { const reply = row.replies?.[id]; return !!reply && Number.isFinite(Date.parse(reply.at)) && Date.parse(reply.at) < Date.parse(replyClosesAt(row)) && Date.parse(reply.at) <= now.getTime(); });
function replyGate(book: LetterBook, agreement: AgreementState, memberId: string, index: number, now: Date) {
  if (agreementGate(agreement, now) || agreement.status !== "started" || book.status !== "active" || !book.access[memberId]) return "교류가 중단되었거나 이용 확인이 필요합니다. 문의해 주세요.";
  const row = book.days[index];
  if (!row) return "유효한 DAY를 확인해 주세요.";
  if (!published(row, agreement.members, now)) return "그날의 편지가 두 사람 모두에게 열린 뒤에 답장할 수 있어요.";
  if (row.replies?.[memberId]) return "답장은 하루에 한 번만 보낼 수 있어요.";
  if (now.getTime() >= Date.parse(replyClosesAt(row))) return "답장 시간이 지났어요. 답장은 편지를 받은 날 23:59까지 쓸 수 있어요.";
  return null;
}
export function letterAction(book: LetterBook, agreement: AgreementState, memberId: string, command: LetterCommand, expectedRevision: number, now: Date) {
  const reject = (error: string) => ({ book, error });
  if (baseGate(agreement, memberId, now) || !validBook(book, agreement) || book.programId !== agreement.sessions[0].program?.id || expectedRevision !== book.revision || (!book.access[memberId] && !["report", "contact"].includes(command.type))) return reject("당사자 권한·프로그램·최신 버전을 확인해 주세요.");
  const next = structuredClone(book);
  const index = "day" in command ? command.day : null;
  if (command.type === "save" || command.type === "submit") {
    if (!Number.isInteger(command.day) || command.day < 0 || command.day > 2 || typeof command.body !== "string") return reject("유효한 편지 작성 정보를 확인해 주세요.");
    const gate = rowGate(book, agreement, memberId, command.day, now);
    if (gate) return reject(gate);
    const row = next.days[command.day];
    if (command.type === "save") row.drafts[memberId] = command.body;
    else {
      if (!command.confirmed || !command.body.replace(/[\s\u200B-\u200D\uFEFF]/g, "").length) return reject("빈 편지는 보낼 수 없습니다. 내용을 확인하고 전송에 동의해 주세요.");
      row.submissions[memberId] = { body: command.body.trim(), at: now.toISOString() };
      delete row.drafts[memberId];
      if (agreement.members.every(id => row.submissions[id]) && !row.publishedAt) row.publishedAt = now.toISOString();
    }
  } else if (command.type === "reply") {
    if (!Number.isInteger(command.day) || command.day < 0 || command.day > 2 || typeof command.body !== "string") return reject("유효한 답장 정보를 확인해 주세요.");
    const gate = replyGate(book, agreement, memberId, command.day, now);
    if (gate) return reject(gate);
    const body = command.body.trim();
    if (!command.confirmed || !body.replace(/[\s\u200B-\u200D\uFEFF]/g, "").length) return reject("빈 답장은 보낼 수 없어요. 내용을 확인하고 전송에 동의해 주세요.");
    if (body.length > LETTER_REPLY.maxLength) return reject(`답장은 ${LETTER_REPLY.maxLength}자 이하로 써 주세요.`);
    const row = next.days[command.day];
    row.replies = { ...(row.replies || {}), [memberId]: { body, at: now.toISOString() } };
  } else if (command.type === "meeting-choice") {
    if (!letterView(book, agreement, memberId, now)?.canRespond || agreementGate(agreement, now) || !command.confirmed || !["positive", "negative"].includes(command.choice) || book.meetingChoices[memberId]) return reject("정상 3일 교환·DAY04 오픈·본인 확인과 응답 기한을 확인해 주세요. 마감 후 미응답은 자동 선택하지 않으며 문의가 필요합니다. 이미 제출한 선택은 중복 제출하지 않습니다.");
    next.meetingChoices[memberId] = command.choice;
  } else if (command.type === "interrupt") next.status = "interrupted";
  else if (command.type === "block") { next.status = "blocked"; next.access = Object.fromEntries(agreement.members.map(id => [id, false])); }
  else if (!["report", "contact"].includes(command.type)) return reject("지원하지 않는 요청입니다.");
  next.revision += 1;
  next.events.push({ type: command.type, actor: memberId, at: now.toISOString(), revision: next.revision, day: index });
  return { book: next, error: null };
}
export function letterView(book: LetterBook | null, agreement: AgreementState | null, memberId: string, now: Date) {
  if (!book || !agreement || baseGate(agreement, memberId, now) || !validBook(book, agreement) || book.programId !== agreement.sessions[0].program?.id) return null;
  const peer = agreement.members.find(id => id !== memberId)!;
  const permitted = !!book.access[memberId];
  const status = book.status === "active" && agreement.status === "interrupted" ? "interrupted" : book.status;
  const rows = book.days.map((row, index) => {
    const released = permitted && published(row, agreement.members, now);
    const own = permitted ? row.submissions[memberId] : null;
    const open = !rowGate(book, agreement, memberId, index, now) && permitted;
    const past = row.date < seoulDay(now);
    return {
      index, date: row.date, title: LETTER_DAYS[index].title,
      question: !permitted || (index === 1 && !published(book.days[0], agreement.members, now)) ? null : LETTER_DAYS[index].question,
      draft: permitted ? row.drafts[memberId] || "" : "",
      ownSubmittedAt: own?.at || null,
      ownSentBody: own?.body || null,
      writable: open,
      lockedReason: permitted ? rowGate(book, agreement, memberId, index, now) : "접근 권한 재검토 중 · 본문을 제공하지 않습니다.",
      status: !permitted ? "access-review" : released ? "published" : own ? "own-submitted" : past ? "delayed" : row.date > seoulDay(now) ? "future" : "not-submitted",
      publishedAt: released ? row.publishedAt : null,
      exchange: released ? {
        own: row.submissions[memberId].body,
        peer: row.submissions[peer].body,
        // 내 답장은 나에게 늘 보이고, 상대 답장은 두 사람 모두 답장했을 때만 내려 준다.
        ownReply: row.replies?.[memberId] || null,
        peerReply: repliesOpen(row, agreement.members, now) ? row.replies![peer] : null,
        canReply: !replyGate(book, agreement, memberId, index, now),
        replyClosesAt: replyClosesAt(row),
        replyStatus: repliesOpen(row, agreement.members, now) ? "open" as const
          : now.getTime() >= Date.parse(replyClosesAt(row)) ? (row.replies?.[memberId] ? "closed-peer-missing" as const : "closed-own-missing" as const)
          : row.replies?.[memberId] ? "waiting-peer" as const : "writable" as const,
      } : null,
    };
  });
  const complete = book.days.every(row => published(row, agreement.members, now));
  const decisionAt = meetingDecisionAt(book.days[2].date);
  const meeting = meetingResponseView(book.meetingChoices, book.events, agreement.members, memberId, decisionAt, book.meetingPolicy, now, canOpenMeeting(complete, permitted, status === "active" && !agreementGate(agreement, now), decisionAt, now));
  return { revision: book.revision, programId: book.programId, scheduleVersion: book.scheduleVersion, rows, status, readAccess: permitted, delayed: book.status !== "blocked" && book.days.some(row => row.date < seoulDay(now) && !published(row, agreement.members, now)), complete, decisionAt, meetingOpen: canOpenMeeting(complete, permitted, book.status === "active" && agreement.status === "started" && !agreementGate(agreement, now), decisionAt, now), ...meeting, todayIndex: book.days.findIndex(row => row.date === seoulDay(now)) };
}
export type LetterView = NonNullable<ReturnType<typeof letterView>>;

// 편지 알림 (실제 알림톡은 미연결, 회원·날짜·종류별 한 번만 기록).
// 제때 편지·답장을 한 사람에게는 보내지 않는다.
//  - letter-reminder: 15:00까지 그날 편지를 보내지 않은 사람
//  - reply-reminder: 편지가 18:00 전에 열렸으면 18:00, 18:00~21:00에 열렸으면 21:00. 21:00 이후에 열렸으면 보내지 않는다.
//  - reply-opened: 두 답장이 함께 열렸을 때, 먼저 답장하고 기다리던 사람에게만
export const LETTER_NOTICE_TIMES = { letter: "15:00", reply: "18:00", lateReply: "21:00" } as const
export type LetterNotice = { kind: "letter-reminder" | "reply-reminder" | "reply-opened"; day: number; memberId: string }
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+09:00`)
export function dueLetterNotices(book: LetterBook, agreement: AgreementState, now: Date): LetterNotice[] {
  if (book.status !== "active" || agreement.status !== "started") return []
  const sent = (kind: string, id: string, day: number) => book.events.some(event => event.type === `notice:${kind}` && event.actor === id && event.day === day)
  const t = now.getTime()
  const out: LetterNotice[] = []
  book.days.forEach((row, index) => {
    const end = Date.parse(replyClosesAt(row))
    if (t >= at(row.date, LETTER_NOTICE_TIMES.letter) && t < end && !published(row, agreement.members, now))
      for (const id of agreement.members) if (book.access[id] && !row.submissions[id] && !sent("letter-reminder", id, index)) out.push({ kind: "letter-reminder", day: index, memberId: id })
    if (published(row, agreement.members, now)) {
      const openedAt = Date.parse(row.publishedAt!)
      const remindAt = openedAt < at(row.date, LETTER_NOTICE_TIMES.reply) ? at(row.date, LETTER_NOTICE_TIMES.reply) : openedAt < at(row.date, LETTER_NOTICE_TIMES.lateReply) ? at(row.date, LETTER_NOTICE_TIMES.lateReply) : null
      if (remindAt !== null && t >= remindAt && t < end)
        for (const id of agreement.members) if (book.access[id] && !row.replies?.[id] && !sent("reply-reminder", id, index)) out.push({ kind: "reply-reminder", day: index, memberId: id })
      if (repliesOpen(row, agreement.members, now)) {
        const first = [...agreement.members].sort((a, b) => Date.parse(row.replies![a].at) - Date.parse(row.replies![b].at))[0]
        if (!sent("reply-opened", first, index)) out.push({ kind: "reply-opened", day: index, memberId: first })
      }
    }
  })
  return out
}
export function recordLetterNotices(book: LetterBook, agreement: AgreementState, now: Date) {
  const notices = dueLetterNotices(book, agreement, now)
  if (!notices.length) return { book, sent: notices }
  const next = structuredClone(book)
  for (const notice of notices) {
    next.revision += 1
    next.events.push({ type: `notice:${notice.kind}`, actor: notice.memberId, at: now.toISOString(), revision: next.revision, day: notice.day })
  }
  return { book: next, sent: notices }
}
