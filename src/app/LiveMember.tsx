import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, ArrowUpRight, Bell, Contact, Flag, LockKeyhole, ShieldOff, UserX, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Textarea } from "./components/ui/textarea";
import { Eyebrow, Moment, PageHeader, QuietNote, Sheet, TwoDots } from "./editorial";
import { NoonClock } from "./PublicHome";
import { END_REASON } from "./backend/program";
import { AccountPanel } from "./AuthPages";
import { clearWithdrawnNotice, useAuth, useAuthReady, useWithdrawnNotice } from "./auth-service";
import { kstDateTime, kstDay } from "./dates";
import { APPLICATION_FIELDS } from "./application-model";
import { cohortCountdown, cohortName } from "./cohort";
import { BEFORE_US } from "./config";
import { PHOTO_SLOTS } from "./photo-model";
import { DECLINE_REASONS } from "./introduction-model";
import { REQUEST_LABELS } from "./member-operations-model";
import { SAFETY_COMPOSE_NOTE } from "./message-safety";
import { PHOTO_ORDER, loadMyApplication, partnerPhotoUrl, photoUrl, type PhotoRow, type ReplacementRow } from "./backend/applications";
import LivePhotoStep from "./LivePhotoStep";
import { publicApplicationProfile } from "./application-review";
import { addAvoidContacts, deleteAvoidContact, loadAvoidContacts, type AvoidContact, blockPartner, deleteGreeting, loadGreeting, loadMyRequests, saveGreeting, type Greeting, markNotificationsRead, NOTIFICATION_FIRST, editBlockReason, loadReflection, photoHoldAt, recordIntroductionView, saveReflection, deleteReflection, type Reflection, reportPartner, respondIntroduction, saveNoticeSettings, setNotifyChannels, setPaused, submitMemberRequest, useMemberSnapshot, type IntroMatch, type LiveIntroduction, type MemberSnapshot } from "./backend/member";

// 실제 서버 모드의 회원 화면(오늘 · 두 사람 · 내 정보 · 문의·요청). 데모 화면과 같은 편집 톤을 쓴다.
const interaction = "transition-colors duration-200 motion-reduce:transition-none";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

export function Waiting({ label = "불러오고 있어요." }: { label?: string }) {
  return <div role="status" aria-live="polite" className="flex flex-1 items-center justify-center py-24"><span className="sr-only">{label}</span><span aria-hidden="true" className="flex gap-1.5"><span className="size-2 animate-pulse rounded-full bg-primary" /><span className="size-2 animate-pulse rounded-full bg-accent [animation-delay:150ms]" /></span></div>;
}

// 로그인이 필요한 화면을 감싼다.
export function Member({ children }: { children: ReactNode }) {
  const user = useAuth();
  const ready = useAuthReady();
  const withdrawn = useWithdrawnNotice();
  if (!ready) return <Waiting />;
  if (!user && withdrawn) return <WithdrawnNoticeView deletionDueAt={withdrawn.deletionDueAt} />;
  if (!user) return <section><PageHeader mark="회원" label="로그인이 필요해요" en="MEMBERS ONLY" title="로그인한 뒤에 볼 수 있어요." lead="소개와 교류는 본인만 볼 수 있어요. 로그인하거나 새로 가입해 주세요." /><div className="mt-8 flex flex-wrap gap-2"><Button asChild className={`h-12 rounded-xl px-6 ${interaction}`}><Link to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>로그인 <ArrowRight size={16} /></Link></Button><Button asChild variant="outline" className={`h-12 rounded-xl ${interaction}`}><Link to="/signup">회원가입</Link></Button></div></section>;
  return <>{children}</>;
}

// 탈퇴를 요청한 계정은 로그인 상태로 두지 않는다(auth-service가 로그아웃한다). 대신 무엇이 멈췄고 언제 지워지는지, 취소하는 길을 알린다.
function WithdrawnNoticeView({ deletionDueAt }: { deletionDueAt: string | null }) {
  const due = deletionDueAt ? `${kstDay(deletionDueAt)}에` : `탈퇴 요청 뒤 ${BEFORE_US.privacy.activeDeleteDays}일 안에`;
  return <section><PageHeader mark="회원" label="탈퇴 요청 접수" en="SEE YOU AGAIN" title="탈퇴 요청을 받았어요." lead={`상대 노출과 알림은 바로 멈췄고, 진행 중이던 소개와 교류는 마무리됐어요. 계정과 신청서·사진 같은 자료는 ${due} 지워요. 그래서 이 계정은 로그아웃해 두었어요.`} aside={<TwoDots apart faded />} />
    <Sheet tone="soft" className="mt-8 max-w-xl p-6"><p className="text-xs font-semibold text-accent">마음이 바뀌었다면</p><p className="mt-3 text-sm leading-7 text-muted-foreground">삭제 예정일 전이라면 탈퇴 요청을 취소할 수 있어요. 문의하기에 가입한 이메일을 적어 남겨 주시면, 운영진이 확인한 뒤 취소하고 알려 드려요. 이미 끝난 소개와 교류는 다시 열리지 않아요.</p></Sheet>
    <div className="mt-8 flex flex-wrap gap-2"><Button asChild className={`h-12 rounded-xl px-6 ${interaction}`}><Link to="/contact?type=개인정보·탈퇴">문의하기 <ArrowRight size={16} /></Link></Button><Button asChild variant="outline" className={`h-12 rounded-xl ${interaction}`}><Link to="/" onClick={() => clearWithdrawnNotice()}>처음 화면으로</Link></Button></div>
  </section>;
}

// 소개·교류가 끝난 까닭을 회원에게 보여 줄 말로. 상대의 선택(거절)은 드러내지 않되, 무응답·운영 사정은 사실대로 알린다.
const BETA_ACTIVE = BEFORE_US.beta.active;
function endedCopy(intro: Exclude<LiveIntroduction, { status: "waiting" }>, program: MemberSnapshot["program"]): { title: string; body: string } {
  const notCounted = BETA_ACTIVE ? "" : " 이번 소개는 횟수에 넣지 않아요.";
  const reason = intro.endReason ?? "";
  if (reason === "blocked" && intro.endedByMe) return { title: "차단한 소개예요.", body: "다시는 서로 소개되지 않아요. 상대에게는 차단 사실을 알리지 않았어요." };
  if (program && program.introductionId === intro.id && program.status === "closed") {
    if (program.endReason === "completed") return { title: "만남까지 마친 교류예요.", body: "어떠셨는지 궁금해요. 새 소개는 잠시 쉬어 두었어요. 다시 받고 싶을 때 내 정보에서 ‘다시 받기’를 눌러 주세요. 불편한 일이 있었다면 두 사람 화면에서 신고해 주세요." };
    return { title: "이번 교류는 여기서 마무리됐어요.", body: `${END_REASON[program.endReason ?? ""] ?? "잘 맞는 분이 준비되면 다시 정오에 소개해 드릴게요."} 잘 맞는 분이 준비되면 다시 정오에 소개해 드릴게요.` };
  }
  if (reason === "nonresponse") return intro.ownResponse
    ? intro.ownResponse === "positive"
      ? { title: "상대가 기한 안에 답하지 않았어요.", body: `거절이 아니라 답이 오지 않아 이번 소개가 마무리됐어요.${notCounted} 잘 맞는 분이 준비되면 다시 정오에 소개해 드릴게요.` }
      : { title: "이번 소개는 여기서 마무리됐어요.", body: "잘 맞는 분이 준비되면 다시 정오에 소개해 드릴게요." }
    : { title: "답 기한이 지나 소개가 마무리됐어요.", body: "다음 소개부터는 다음 날 오전 11시 전에 답해 주세요. 두 번 이어서 답하지 않으면 새 소개를 잠시 쉬어요." };
  if (reason === "blocked" || reason === "withdrawn" || reason === "suspended") return { title: "이번 소개는 여기서 마무리됐어요.", body: `상대의 사정으로 더 이어 가기 어려워졌어요.${notCounted} 잘 맞는 분이 준비되면 다시 정오에 소개해 드릴게요.` };
  if (reason === "admin-cancel") return { title: "운영진이 이번 소개를 마무리했어요.", body: `운영 사정으로 여기서 마무리했어요. 불편을 드려 죄송해요.${notCounted} 잘 맞는 분이 준비되면 다시 정오에 소개해 드릴게요.` };
  return { title: "이번 소개는 여기서 마무리됐어요.", body: "누가 어떤 답을 했는지는 알려 드리지 않아요. 잘 맞는 분이 준비되면 정오에 다시 소개해 드릴게요." };
}
// 서로 선택한 뒤 이어지는 일(베타는 무료, 정식 운영은 각자 교류비)
const AFTER_YES = BETA_ACTIVE
  ? "두 분 모두 ‘알아가고 싶어요’를 고르면, 3일 교류 방식(A 편지·B 첫 장면)과 시작일을 48시간 안에 함께 정해요. 베타 기간에는 교류도 무료예요."
  : `두 분 모두 ‘알아가고 싶어요’를 고르면, 각자 교류비 ${BEFORE_US.pricing.exchangePerPerson.toLocaleString("ko-KR")}원을 24시간 안에 내고 3일 교류 방식과 시작일을 함께 정해요. 한 분만 내면 낸 금액은 모두 돌려드려요.`;

const slotLabel = (slot: string) => PHOTO_SLOTS.find(item => item.id === slot)?.label ?? "사진";

// 오늘 할 일을 한 문장으로 정한다.
const kstToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const noonOf = (date: string) => kstDay(`${date}T12:00:00+09:00`);
type TodayState = { label: string; title: string; action: string; to: string | null; body: string; clock?: { at: string; label: string; note: string }; extra?: { label: string; to: string } };
function todayState(data: MemberSnapshot): TodayState {
  const application = data.application, intro = data.introduction, cohort = data.cohort;
  if (data.notices?.status === "withdrawal_requested") return { label: "탈퇴 요청", title: "탈퇴 요청을 받았어요.", action: "문의하기", to: "/contact?type=개인정보·탈퇴", body: "상대 노출과 알림은 멈췄고, 계정과 자료는 삭제 예정일에 지워요. 그 전에 다시 이용하려면 문의하기로 남겨 주세요." };
  if (data.notices?.status === "suspended") return { label: "이용 정지", title: "지금은 소개를 받을 수 없어요.", action: "문의·요청 남기기", to: "/support", body: `운영진 안내 · ${(data.notices.suspended_reason || "운영 정책에 따라 이용이 잠시 멈췄어요").replace(/[.。\s]+$/, "")}. 다르게 생각되면 문의·요청에서 ‘결정 재검토 요청’을 남겨 주세요.` };
  const waitingForStart = !!cohort && kstToday() < cohort.startsOn && intro.status === "waiting";
  const program = data.program;
  if (program && program.status !== "closed") {
    if (program.status === "choosing") return { label: "함께 정하기", title: "어떻게 시작할지 함께 정해요.", action: "교류 방식 정하기", to: "/exchange", body: `A 편지·B 첫 장면 중 하나와 시작일을 ${kstDateTime(program.agreeBy)}까지 함께 정해 주세요.`, clock: { at: program.agreeBy, label: "교류 방식 마감까지", note: "두 분이 같은 방식과 시작일을 확인하면 시작돼요." } };
    if (program.status === "scheduled") return { label: "교류 시작 전", title: `${program.startOn ? kstDay(`${program.startOn}T09:00:00+09:00`) : ""} 09:00에 첫날이 열려요.`, action: "교류 화면 보기", to: "/exchange", body: "시작하면 알림으로 알려 드릴게요." };
    if (program.status === "started") { const sent = !!program.day && program.entries.some(entry => entry.day === program.day && entry.kind !== "reply" && !!entry.own); const beforeNine = new Date(Date.now() + 9 * 3600000).getUTCHours() < 9; if (!program.day) return { label: "넷째 날", title: "오늘 오전 9시에 만남 선택이 열려요.", action: "교류 화면으로", to: "/exchange", body: "셋째 날 받은 글에 남길 답은 오전 9시 전까지 쓸 수 있어요. 9시가 되면 만나고 싶은지 각자 골라요." }; return { label: program.day ? `교류 ${["첫", "둘", "셋"][program.day - 1] ?? ""}째 날` : "교류 중", title: beforeNine ? "오늘의 글은 오전 9시에 열려요." : sent ? "오늘의 글을 보냈어요." : program.ownPlan === "B" ? "오늘의 첫 장면 질문이 열렸어요." : "오늘의 편지를 쓸 시간이에요.", action: "교류 화면으로", to: "/exchange", body: sent ? "상대도 보내면 두 분의 글이 함께 열려요. 상대가 23:59까지 보내지 않으면 다음 날 함께 열리지 않아요." : "그날 글은 09:00~23:59에 쓰고, 두 분 모두 보내면 함께 열려요." }; }
    if (program.status === "deciding") return { label: "넷째 날", title: program.ownMeeting ? program.ownMeeting === "positive" ? "만나고 싶다고 답했어요." : "이번에는 여기까지라고 답했어요." : "만나고 싶은지 골라 주세요.", action: program.ownMeeting ? "교류 화면 보기" : "만남 선택하기", to: "/exchange", body: program.ownMeeting ? `${program.ownMeeting === "positive" ? `두 분 모두 만나고 싶으면 그 순간 약속 정하기가 열리고, 아니면 ${kstDateTime(program.meetingBy)}에 마무리 소식을 알려 드려요.` : `이번 교류는 ${kstDateTime(program.meetingBy)}에 마무리돼요.`} 상대가 이미 골랐는지는 알려 드리지 않아요.` : `${kstDateTime(program.meetingBy)}까지예요. 상대가 먼저 골랐는지는 서로 알 수 없어요.`, clock: program.meetingBy ? { at: program.meetingBy, label: "만남 선택 마감까지", note: "두 분 모두 만나고 싶다고 하면 약속을 정해요." } : undefined };
    return { label: "약속", title: program.meetingOn ? `${kstDay(`${program.meetingOn}T12:00:00+09:00`)}에 만나기로 했어요.` : "만날 약속을 함께 정해요.", action: "약속 화면으로", to: "/meeting", body: program.meetingOn ? "연락처는 두 분이 동의하면 만나는 날 00:00부터 열려요." : `${kstDateTime(program.arrangeBy)}까지 정해 주세요.` };
  }
  if (program && program.status === "closed" && program.closedAt && Date.now() - Date.parse(program.closedAt) < 86400000 && intro.status !== "waiting" && intro.id === program.introductionId) {
    const copy = endedCopy(intro, program);
    return { label: "교류 마무리", title: copy.title, action: program.endReason === "completed" ? "내 정보에서 다시 받기" : "다음 소개 기다리기", to: program.endReason === "completed" ? "/profile" : null, body: copy.body };
  }
  if (intro.status !== "waiting" && (intro.status === "published" || intro.status === "mutual" || intro.status === "expired" || intro.closedAt && Date.now() - Date.parse(intro.closedAt) < 86400000)) {
    if (intro.status === "mutual") return { label: "서로 선택", title: "두 분 모두 알아가고 싶다고 답했어요.", action: "교류 방식 정하기", to: "/exchange", body: "A 편지·B 첫 장면 중 하나와 시작일을 함께 정해요. 상대 프로필은 두 사람 화면에서 다시 볼 수 있어요." };
    const clock = { at: intro.dueAt, label: "응답 마감까지", note: "다음 날 오전 11시에 답이 마감돼요." };
    if (intro.status === "published" && !intro.ownResponse) return { label: "오늘의 인연", title: "오늘의 인연이 도착했어요.", action: "소개 확인하기", to: "/us", body: `${kstDateTime(intro.dueAt)}까지 답해 주세요. 내 답은 상대에게 알리지 않고, 두 분 모두 ‘알아가고 싶어요’일 때만 교류가 열려요.`, clock };
    if (intro.status === "published" && intro.ownResponse === "negative") return { label: "소개 마무리 예정", title: "이번에는 넘기겠다고 답했어요.", action: "두 사람 화면 보기", to: "/us", body: `이번 소개는 ${kstDateTime(intro.dueAt)}에 마무리돼요. 상대에게는 누가 어떤 답을 했는지 알리지 않아요.`, clock };
    if (intro.status === "published") return { label: "답을 보냈어요", title: "알아가고 싶다고 답했어요.", action: "두 사람 화면 보기", to: "/us", body: `두 분 모두 원하면 그 순간 교류가 열려요. 아니면 ${kstDateTime(intro.dueAt)}에 마무리 소식을 알림과 메일로 알려 드려요. 상대가 이미 답했는지는 알려 드리지 않아요.`, clock };
    if (intro.status === "expired") return { label: "소개 마무리", title: "응답 기한이 지났어요.", action: "다음 소개 기다리기", to: null, body: "곧 결과를 알림으로 알려 드릴게요. 잘 맞는 분이 준비되면 다시 정오에 소개해 드릴게요." };
    const copy = endedCopy(intro, program);
    return { label: "소개 마무리", title: copy.title, action: "다음 소개 기다리기", to: null, body: copy.body };
  }
  if (!application || application.status === "draft") return { label: "신청 전", title: "소개 신청을 마저 적어 주세요.", action: application ? "이어서 작성하기" : "소개 신청하기", to: "/apply", body: "나에 대해 · 사진 · 원하는 만남 · 공개 확인, 네 단계예요. 단계마다 저장돼요." };
  if (application.status === "needs_changes") return { label: "보완 요청", title: "신청서에 보완할 부분이 있어요.", action: "보완하기", to: "/apply", body: application.decisionNote || "운영진 안내를 확인해 주세요." };
  const photoRequest = data.photos?.requests[0];
  if (photoRequest && (application.status === "submitted" || application.status === "reviewing")) return { label: "사진 보완", title: "사진 한 장을 다시 올려 주세요.", action: "사진 다시 올리기", to: "/apply?edit=1&step=1", body: `${slotLabel(photoRequest.slot)} 사진 · ${photoRequest.reason || "운영진 안내를 확인해 주세요"}. 이 칸의 사진만 다시 올리면 돼요. 새 사진을 확인하기 전까지는 소개를 준비하지 않아요.` };
  if (application.status === "submitted" || application.status === "reviewing") return { label: "검토 중", title: "신청서를 확인하고 있어요.", action: "신청서 보기", to: "/apply", body: `운영진이 사진과 내용을 확인하고 있어요. 검토가 끝나면 이 화면에서 알려 드릴게요.${cohort && kstToday() < cohort.startsOn ? ` ${cohortName(cohort.number)} 첫 소개는 ${noonOf(cohort.startsOn)} 정오예요.` : ""}` };
  const holdAt = application.status === "approved" ? photoHoldAt(data.photos) : null;
  if (holdAt && Date.parse(holdAt) <= Date.now()) return { label: "잠시 멈춤", title: "사진을 바꾸면 새 소개를 다시 준비해요.", action: "사진 바꾸기", to: "/profile#photos", body: "운영진이 요청한 사진 교체가 7일 동안 이뤄지지 않아 새 소개를 잠시 멈췄어요. 새 사진을 올리면 바로 다시 준비해요. 신청과 지금 사진은 그대로예요." };
  if (application.status === "approved" && data.notices?.paused_at) return data.notices.paused_by === "operator"
    ? { label: "잠시 멈춤", title: "운영진이 새 소개를 잠시 멈췄어요.", action: "문의하기", to: "/contact", body: "확인할 일이 있어 새 소개 준비를 잠시 멈췄어요. 궁금한 점은 문의하기로 남겨 주세요." }
    : { label: "잠시 쉬는 중", title: "새 소개를 잠시 쉬고 있어요.", action: "내 정보에서 다시 받기", to: "/profile", body: data.notices.paused_by === "auto" ? "답하지 않은 소개가 이어졌거나 교류를 마쳐서 새 소개를 쉬고 있어요. 다시 받기를 누르면 다음 정오부터 다시 준비해요." : "쉬는 동안에는 새 소개를 준비하지 않아요. 다시 받기를 누르면 다음 정오부터 다시 준비해요." };
  if (application.status === "approved" && waitingForStart && cohort) return kstToday() === dayBefore(cohort.startsOn)
    ? { label: `${cohortName(cohort.number)} · 내일 시작`, title: "내일 정오부터 첫 소개가 시작돼요.", action: "내 정보 확인하기", to: "/profile", body: "잘 맞는 분이 준비되면 내일 정오에 이 화면과 두 사람 화면에서 알려 드릴게요. 준비가 더 걸리면 그것도 알려 드릴게요." }
    : { label: `${cohortName(cohort.number)} · 시작 전`, title: `${cohortName(cohort.number)} 첫 소개는 ${noonOf(cohort.startsOn)} 정오부터예요.`, action: "내 정보 확인하기", to: "/profile", body: `같은 기수의 분들과 함께 첫 소개를 받아요. 시작 전날 한 번 더 알려 드릴게요.${BEFORE_US.beta.active ? "" : " 시작 전에는 소개비를 언제든 전액 환불받을 수 있어요."}` };
  if (application.status === "approved") return waitedDays(data) >= BEFORE_US.noonGuidance.waitingNoteAfterDays
    ? { label: "소개 준비", title: "잘 맞는 분을 찾는 데 시간이 걸리고 있어요.", action: "다음 소개 기다리기", to: null, body: "서두르기보다 잘 맞는 분을 고르고 있어요. 준비되면 그날 정오에 이 화면과 메일로 알려 드릴게요. 기다림이 길게 느껴지면 편하게 말씀해 주세요.", extra: { label: "문의하기", to: "/contact?type=소개·교류" } }
    : { label: "소개 준비", title: "잘 맞는 분을 찾고 있어요.", action: "다음 소개 기다리기", to: null, body: "준비된 날 정오에 한 분을 소개해요. 매일 오지는 않아요. 도착하면 이 화면과 메일로 알려 드릴게요." };
  if (application.status === "held") return { label: "확인 보류", title: "신청서 확인이 조금 늦어지고 있어요.", action: "문의하기", to: "/contact", body: application.decisionNote ? `운영진 안내 · ${application.decisionNote}` : "운영진이 확인할 일이 있어 잠시 멈췄어요. 궁금한 점은 문의하기로 남겨 주세요." };
  if (application.status === "rejected") return { label: "소개 어려움", title: "이번에는 소개를 이어 가기 어려워요.", action: "문의하기", to: "/contact", body: application.decisionNote ? `운영진 안내 · ${application.decisionNote}` : "자세한 사유가 궁금하면 문의하기로 남겨 주세요. 다르게 생각되면 문의·요청에서 재검토를 요청할 수 있어요." };
  if (application.status === "withdrawn") return { label: "신청 철회", title: "신청을 철회했어요.", action: "문의하기", to: "/contact?type=신청·검토", body: "다시 신청하고 싶다면 문의하기로 알려 주세요. 운영진이 확인한 뒤 신청서를 다시 열어 드리고, 열리면 알림으로 알려 드려요." };
  return { label: "신청 상태", title: "신청 상태를 확인해 주세요.", action: "신청서 보기", to: "/apply", body: application.decisionNote || "궁금한 점은 문의하기로 남겨 주세요." };
}

export function LiveToday() {
  return <Member><LiveTodayView /></Member>;
}
function LiveTodayView() {
  const { data, error, loading, reload } = useMemberSnapshot();
  const [allNotes, setAllNotes] = useState(false);
  const unread = data?.notifications.filter(item => !item.read_at).length ?? 0;
  // 화면에 보여 준 알림만 3초 뒤 읽음으로 바꾼다(펼치지 않은 지난 알림은 그대로 둔다).
  const shownUnread = (data?.notifications ?? []).slice(0, allNotes ? undefined : NOTIFICATION_FIRST).filter(item => !item.read_at).map(item => item.id);
  useEffect(() => { if (shownUnread.length) { const timer = window.setTimeout(() => void markNotificationsRead(shownUnread), 3000); return () => window.clearTimeout(timer); } }, [shownUnread.join(",")]);
  if (loading) return <Waiting />;
  if (error || !data) return <section><p role="alert" className="text-sm text-destructive">{error || "불러오지 못했어요."}</p><Button variant="outline" className="mt-5 rounded-xl" onClick={() => void reload()}>다시 불러오기</Button></section>;
  const state = todayState(data);
  // 지금 열려 있는 소개의 궁합(넘기겠다고 답한 뒤에는 보여 주지 않는다)
  const intro = data.introduction;
  const todayMatch = (intro.status === "published" || intro.status === "mutual") && intro.ownResponse !== "negative" ? intro.match ?? null : null;
  return (
    <section aria-labelledby="today-title">
      <header className="flex flex-wrap items-end justify-between gap-8 border-b border-border pb-8">
        <div className="min-w-0">
          <Eyebrow mark="오늘" label={state.label} en="TODAY · FLAVIE" />
          <h1 id="today-title" className="mt-5 text-3xl font-semibold leading-[1.4] sm:text-[34px]">{state.title}</h1>
          <p className="mt-3 text-xs text-muted-foreground"><time dateTime={today()}>{kstDay(new Date())}</time> · 서울</p>
        </div>
        <NoonClock tone="plain" target={state.clock} />
      </header>
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Sheet className="flex flex-col p-6 sm:p-10">
          <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[#F8E5A6] px-3 py-1 text-xs font-semibold text-[#5A4310] dark:bg-[#3B3424] dark:text-[#F3D98A]"><span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />지금 할 일</p>
          <h2 className="mt-4 text-2xl font-semibold leading-[1.45] sm:text-[28px]">{state.action}</h2>
          <p className="mt-6 max-w-xl text-sm leading-7 text-muted-foreground">{state.body}</p>
          {(state.to || state.extra) && <div className="mt-7 flex flex-wrap items-center gap-3">{state.to && <Button asChild className={`h-12 rounded-xl px-6 ${interaction}`}><Link to={state.to}>{state.action} <ArrowUpRight size={17} /></Link></Button>}{state.extra && <Button asChild variant="outline" className={`h-12 rounded-xl border-border px-6 ${interaction}`}><Link to={state.extra.to}>{state.extra.label} <ArrowUpRight size={17} /></Link></Button>}</div>}
          {todayMatch && <MatchLink match={todayMatch} />}
          <div className="mt-auto pt-10"><QuietNote>한 번에 한 사람, 서두르지 않는 시작.</QuietNote></div>
        </Sheet>
        <aside aria-labelledby="notice-title" className="border-t border-border pt-6 lg:border-t-0 lg:pt-0">
          <h2 id="notice-title" className="flex items-center gap-2 text-sm font-semibold"><Bell size={15} className="text-accent" />알림{unread ? <span className="text-xs font-normal text-accent">새 알림 {unread}</span> : null}</h2>
          {data.notifications.length ? <><ul className="mt-4 divide-y divide-border border-y border-border">{data.notifications.slice(0, allNotes ? undefined : NOTIFICATION_FIRST).map(item => <li key={item.id} className="py-4"><p className={`text-sm ${item.read_at ? "" : "font-semibold"}`}>{item.link ? <Link to={item.link} className="hover:text-primary">{item.title}</Link> : item.title}</p>{item.body && <p className="mt-1 text-xs leading-6 text-muted-foreground">{item.body}</p>}<p className="mt-1 text-[11px] text-muted-foreground">{kstDateTime(item.created_at)}</p></li>)}</ul>{data.notifications.length > NOTIFICATION_FIRST && <Button variant="ghost" onClick={() => setAllNotes(value => !value)} aria-expanded={allNotes} className={`mt-2 h-9 rounded-full px-4 text-xs text-muted-foreground ${interaction}`}>{allNotes ? "접기" : `지난 알림 ${data.notifications.length - NOTIFICATION_FIRST}개 더 보기`}</Button>}</> : <p className="mt-4 border-y border-border py-6 text-xs leading-6 text-muted-foreground">아직 알림이 없어요. 소개가 준비되면 정오에 여기와 오늘 화면에서 알려 드려요.</p>}
        </aside>
      </div>
      {data.application?.status === "approved" && data.photos && <PhotoChangeNotice photos={data.photos} />}
      {reflectable(data) && <ReflectionCard key={data.program!.id} programId={data.program!.id} met={data.program!.endReason === "completed"} />}
      {data.application && data.application.status !== "draft" && data.introduction.status === "waiting" && <div className="mt-10"><FirstWordCard /></div>}
      <section className="mt-14 border-t border-border pt-8" aria-labelledby="status-title">
        <h2 id="status-title" className="mb-5 text-sm font-semibold">지금 알아두면 좋은 것</h2>
        <dl className="grid gap-5 text-xs sm:grid-cols-3"><div><dt className="mb-2 text-muted-foreground">신청 접수</dt><dd>{data.application?.submittedAt && data.application.status !== "draft" ? kstDay(data.application.submittedAt) : "아직 접수 전"}</dd></div><div><dt className="mb-2 text-muted-foreground">최근 소개</dt><dd>{data.introduction.status !== "waiting" && data.introduction.publishedAt ? kstDay(data.introduction.publishedAt) : "아직 없어요"}</dd></div><div><dt className="mb-2 text-muted-foreground">{data.cohort ? "내 기수" : "소개 방식"}</dt><dd>{data.cohort ? `${cohortName(data.cohort.number)} · ${noonOf(data.cohort.startsOn)} 정오 시작` : "준비된 날 정오 · 하루 최대 한 명"}</dd></div></dl>
        <div className="mt-6 flex flex-wrap gap-2"><Button asChild variant="outline" className={`h-10 rounded-xl border-border text-xs ${interaction}`}><Link to="/profile">알림 설정·내 정보</Link></Button><Button asChild variant="outline" className={`h-10 rounded-xl border-border text-xs ${interaction}`}><Link to="/support">정정·삭제 요청</Link></Button><Button asChild variant="outline" className={`h-10 rounded-xl border-border text-xs ${interaction}`}><Link to="/contact">문의하기</Link></Button></div>
      </section>
    </section>
  );
}

// 사진 교체 안내(승인된 회원): 운영진이 바꿔 달라고 한 사진 · 다시 올려 달라고 한 사진 · 확인을 기다리는 새 사진.
// 신청과 소개는 그대로 이어지고, 새 사진을 확인할 때까지 지금 사진이 그대로 보인다.
function PhotoChangeNotice({ photos }: { photos: NonNullable<MemberSnapshot["photos"]> }) {
  const retry = photos.replacements.find(item => item.review === "재등록 요청");
  const waiting = photos.replacements.filter(item => item.review === "대기");
  const change = photos.changes.find(item => !photos.replacements.some(swap => swap.slot === item.slot));
  const request = photos.requests[0];
  const holdAt = photoHoldAt(photos);
  if (holdAt && Date.parse(holdAt) <= Date.now() && !waiting.length) return null;
  const notice = retry ? { title: "바꿀 사진을 한 번 더 골라 주세요.", body: `${slotLabel(retry.slot)} 사진 · ${retry.reason || "운영진 안내를 확인해 주세요"}. 지금 사진은 그대로 보여요.`, action: true }
    : change ? { title: "사진 한 장을 바꿔 주세요.", body: `${slotLabel(change.slot)} 사진 · ${change.reason}. 새 사진을 올려 주시면 확인한 뒤 바꿔 드려요. 그동안 지금 사진이 그대로 보여요.${holdAt ? ` ${kstDateTime(holdAt)}까지 올리지 않으면 새 소개를 잠시 멈춰요(진행 중인 소개는 그대로예요).` : ""}`, action: true }
    : request ? { title: "사진 한 장을 다시 올려 주세요.", body: `${slotLabel(request.slot)} 사진 · ${request.reason || "운영진 안내를 확인해 주세요"}. 확인한 뒤 상대에게 보여요.`, action: true }
    : waiting.length ? { title: "새 사진을 확인하고 있어요.", body: "확인되면 지금 사진과 자연스럽게 바뀌어요. 그동안은 지금 사진이 그대로 보여요.", action: false }
    : null;
  if (!notice) return null;
  return <Sheet tone="soft" className="mt-10 flex flex-wrap items-center justify-between gap-5 p-6 sm:p-8">
    <div className="min-w-0 max-w-xl"><p className="text-xs font-semibold text-accent">사진 안내</p><h2 className="mt-3 text-lg font-semibold leading-[1.5]">{notice.title}</h2><p className="mt-2 text-sm leading-7 text-muted-foreground">{notice.body}</p></div>
    {notice.action && <Button asChild className={`h-11 shrink-0 rounded-xl px-5 ${interaction}`}><Link to="/profile#photos">사진 바꾸기 <ArrowUpRight size={15} /></Link></Button>}
  </Sheet>;
}

// 교류 뒤 한 줄: 교류를 시작해 마친 뒤 30일 동안, 새 소개가 열려 있지 않을 때 오늘 화면에 보여 준다.
const REFLECTION_DAYS = 30;
const reflectable = (data: MemberSnapshot) => !!data.program && data.program.status === "closed" && !!data.program.startedAt && !!data.program.closedAt
  && Date.now() - Date.parse(data.program.closedAt) < REFLECTION_DAYS * 86400000 && data.introduction.status !== "published" && data.introduction.status !== "mutual";
const REFLECTION_IDEAS = ["대화가 편안했어요.", "생활 리듬이 비슷한 분이면 좋겠어요.", "조금 더 가까이 사는 분이면 좋겠어요.", "답장 속도가 비슷한 분이 편할 것 같아요."];
function ReflectionCard({ programId, met }: { programId: string; met: boolean }) {
  const [saved, setSaved] = useState<Reflection | null | undefined>(undefined);
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => { void loadReflection(programId).then(item => { setSaved(item === undefined ? null : item); setBody(item?.body ?? ""); }); }, [programId]);
  if (saved === undefined) return null;
  const length = Array.from(body.trim()).length;
  const save = async () => { setSending(true); const { data, error } = await saveReflection(programId, body); setSending(false); if (error || !data) { setMessage(error || "저장하지 못했어요."); return; } setSaved({ programId, body: data.body, usedAt: data.usedAt }); setBody(data.body); setEditing(false); setMessage("남겨 주셨어요. 다음 분을 고를 때 참고할게요."); };
  const remove = async () => { const { error } = await deleteReflection(programId); if (error) { setMessage(error); return; } setSaved(null); setBody(""); setEditing(false); setMessage("한 줄을 지웠어요."); };
  const form = !saved || editing;
  return <Sheet className="mt-10 p-6 sm:p-8">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-accent">다음 소개를 위한 한 줄</p><h2 className="mt-3 text-xl font-semibold leading-[1.5]">{met ? "만나 보니 어땠나요?" : "이번 교류는 어땠나요?"}</h2></div>{saved && <span className={`rounded-full px-2.5 py-1 text-[11px] leading-none ${saved.usedAt ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{saved.usedAt ? "다음 소개에 반영했어요" : "운영진만 봐요"}</span>}</div>
    <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">운영진에게만 보이고, 상대에게는 보이지 않아요. 어떤 점이 편했는지, 다음엔 어떤 분이면 좋을지 남겨 주시면 다음 분을 고를 때 반영하고, 소개할 때 함께 알려 드려요.</p>
    {form ? <>
      <Textarea aria-label="다음 소개를 위한 한 줄" value={body} maxLength={200} onChange={event => { setBody(event.target.value); setMessage(""); }} placeholder="예: 대화가 편안했어요. 다음엔 조금 더 가까이 사는 분이면 좋겠어요." className="mt-5 min-h-20 rounded-xl bg-card text-[15px] leading-7" />
      <div className="mt-2 flex items-start justify-between gap-3 text-[11px] leading-5 text-muted-foreground"><p>5~200자 · 연락처·SNS 아이디·링크는 적을 수 없어요</p><span className="shrink-0 tabular-nums">{length} / 200</span></div>
      {!body.trim() && <div className="mt-3 flex flex-wrap gap-2">{REFLECTION_IDEAS.map(idea => <button key={idea} type="button" onClick={() => setBody(idea)} className={`rounded-full border border-border px-3 py-1.5 text-xs hover:border-primary/50 hover:text-primary ${interaction}`}>{idea}</button>)}</div>}
      <div className="mt-5 flex flex-wrap items-center gap-2"><Button disabled={length < 5 || sending || body.trim() === (saved?.body ?? "")} onClick={() => void save()} className={`h-11 rounded-xl px-5 ${interaction}`}>{sending ? "남기는 중…" : "한 줄 남기기"}</Button>{editing && <Button variant="ghost" onClick={() => { setEditing(false); setBody(saved?.body ?? ""); }} className={`h-11 rounded-xl text-xs text-muted-foreground ${interaction}`}>그만 고치기</Button>}</div>
    </> : <>
      <blockquote className="mt-5 border-l-2 border-primary pl-4 text-[15px] leading-7">{saved!.body}</blockquote>
      {!saved!.usedAt && <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setEditing(true); setMessage(""); }} className={`h-10 rounded-xl border-border text-xs ${interaction}`}>고치기</Button><Button variant="ghost" onClick={() => void remove()} className={`h-10 rounded-xl text-xs text-muted-foreground ${interaction}`}>지우기</Button></div>}
    </>}
    {message && <p role="status" className="mt-3 text-xs text-primary">{message}</p>}
  </Sheet>;
}

// 내 정보 · 내 사진(승인된 회원): 진행 중인 소개가 있어도 바꿀 수 있다. 새 사진은 운영진이 확인한 뒤 바뀐다.
function PhotosPanel({ photos }: { photos: MemberSnapshot["photos"] }) {
  const needed = !!photos && (photos.changes.length > 0 || photos.requests.length > 0 || photos.replacements.length > 0);
  const [open, setOpen] = useState(() => needed || (typeof window !== "undefined" && window.location.hash === "#photos"));
  const [rows, setRows] = useState<{ rows: PhotoRow[]; replacements: ReplacementRow[] } | "error" | null>(null);
  const load = async () => { const { data, error } = await loadMyApplication(); setRows(error || !data ? "error" : { rows: data.photoRows, replacements: data.replacements }); };
  useEffect(() => { void load(); }, []);
  // 알림의 ‘사진 바꾸기’(/profile#photos)나 이 화면의 사진 버튼으로 오면 펼쳐서 보여 준다.
  useEffect(() => {
    const reveal = () => { if (window.location.hash !== "#photos") return; setOpen(true); window.requestAnimationFrame(() => document.getElementById("photos")?.scrollIntoView({ block: "start" })); };
    reveal(); window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [rows !== null]);
  return <section id="photos" aria-labelledby="photos-panel-title" className="scroll-mt-24 rounded-3xl border border-border bg-card">
    <button type="button" aria-expanded={open} aria-controls="photos-panel" onClick={() => setOpen(value => !value)} className={`flex w-full flex-wrap items-center justify-between gap-3 p-6 text-left sm:px-8 ${interaction}`}>
      <span className="min-w-0"><span className="block text-xs font-semibold text-accent">내 사진</span><span id="photos-panel-title" className="mt-2 block text-lg font-semibold">{needed ? "확인할 사진 안내가 있어요." : "사진은 언제든 바꿀 수 있어요."}</span><span className="mt-1 block text-xs leading-6 text-muted-foreground">새 사진은 운영진이 확인한 뒤 바뀌고, 그동안 지금 사진이 그대로 보여요. 소개는 멈추지 않아요.</span></span>
      <span className="shrink-0 rounded-full border border-border px-4 py-2 text-xs">{open ? "접기" : "사진 보기·바꾸기"}</span>
    </button>
    {open && <div id="photos-panel" className="border-t border-border p-6 sm:p-8">{rows === null ? <p role="status" className="text-xs text-muted-foreground">사진을 불러오고 있어요.</p> : rows === "error" ? <p role="status" className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">사진을 불러오지 못했어요.<button type="button" onClick={() => { setRows(null); void load(); }} className="font-semibold text-primary underline-offset-4 hover:underline">다시 불러오기</button></p> : <LivePhotoStep rows={rows.rows} replacements={rows.replacements} approved editable onChanged={load} />}</div>}
  </section>;
}

// ─────────────────────────────────────────────
// 첫 마디: 기다리는 동안 적어 두는 짧은 인사. 소개된 분이 가장 먼저 보고, 원하면(운영진 확인 뒤) 홈에도 문장만 보여요.
const FIRST_WORD_IDEAS = ["천천히 알아가고 싶어요. 반가워요!", "산책 좋아하시면 이야기가 잘 통할 것 같아요.", "오늘 하루는 어땠는지 먼저 묻고 싶어요.", "좋아하는 노래 하나씩 나눠 볼까요?"];
const HOME_STATUS: Record<Greeting["homeStatus"], string> = { none: "", pending: "홈 공개 · 운영진 확인 중", approved: "홈 공개 중 · 이름·사진 없이 문장만", rejected: "홈에는 싣지 않았어요" };
export function FirstWordCard() {
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<Greeting | null>(null);
  const [body, setBody] = useState("");
  const [home, setHome] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  // undefined = 불러오지 못함(빈 칸으로 보여 저장한 문장을 덮어쓰지 않게 안내만 한다)
  useEffect(() => { void loadGreeting().then(greeting => { if (greeting === undefined) { setFailed(true); setLoaded(true); return; } setSaved(greeting); setBody(greeting?.body ?? ""); setHome(greeting?.showOnHome ?? false); setLoaded(true); }); }, []);
  const length = Array.from(body.trim()).length;
  const changed = body.trim() !== (saved?.body ?? "") || home !== (saved?.showOnHome ?? false);
  const save = async () => { const { data, error } = await saveGreeting(body, home); if (error || !data) { setMessage(error || "저장하지 못했어요."); return; } setSaved({ body: data.body, showOnHome: data.showOnHome, homeStatus: data.homeStatus, homeReason: null }); setBody(data.body); setMessage(data.homeStatus === "pending" ? "저장했어요. 홈 공개는 운영진이 확인한 뒤에 보여요." : "저장했어요."); };
  const remove = async () => { const { error } = await deleteGreeting(); if (error) { setMessage(error); return; } setSaved(null); setBody(""); setHome(false); setMessage("첫 마디를 지웠어요."); };
  if (!loaded) return null;
  if (failed) return <Sheet className="p-6 sm:p-8"><p className="text-xs font-semibold text-accent">첫 마디</p><p role="status" className="mt-3 text-sm leading-7 text-muted-foreground">첫 마디를 불러오지 못했어요. 잠시 뒤 이 화면을 다시 열어 주세요.</p></Sheet>;
  return <Sheet className="p-6 sm:p-8">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-accent">첫 마디</p><h2 className="mt-3 text-xl font-semibold leading-[1.5]">소개된 분이 가장 먼저 보게 될 한마디예요.</h2></div>{saved?.showOnHome && <span className={`rounded-full px-2.5 py-1 text-[11px] leading-none ${saved.homeStatus === "approved" ? "bg-primary/8 text-primary" : "bg-muted text-muted-foreground"}`}>{HOME_STATUS[saved.homeStatus]}</span>}</div>
    <div className="relative mt-5"><span aria-hidden="true" className="pointer-events-none absolute left-4 top-3 text-2xl leading-none text-primary/40">“</span><Textarea aria-label="첫 마디" value={body} maxLength={60} onChange={event => { setBody(event.target.value); setMessage(""); }} placeholder="천천히 알아가고 싶어요. 반가워요!" className="min-h-20 rounded-xl bg-card py-3 pl-10 pr-4 text-[15px] leading-7" /></div>
    <div className="mt-2 flex items-start justify-between gap-3 text-[11px] leading-5 text-muted-foreground"><p>5~60자 · 연락처·SNS 아이디·링크는 넣을 수 없어요</p><span className="shrink-0 tabular-nums">{length} / 60</span></div>
    {!body.trim() && <div className="mt-3 flex flex-wrap gap-2">{FIRST_WORD_IDEAS.map(idea => <button key={idea} type="button" onClick={() => setBody(idea)} className={`rounded-full border border-border px-3 py-1.5 text-xs hover:border-primary/50 hover:text-primary ${interaction}`}>{idea}</button>)}</div>}
    <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 text-sm leading-6"><Checkbox className="mt-1" checked={home} onCheckedChange={value => setHome(value === true)} /><span>홈에도 이 문장을 보여 줄게요. <span className="block text-xs text-muted-foreground">이름·사진 없이 문장만, 운영진이 확인한 뒤에 보여요. 언제든 끌 수 있어요.</span></span></label>
    {saved?.homeStatus === "rejected" && saved.homeReason && <p className="mt-3 rounded-xl bg-muted p-3 text-xs leading-6">운영진 안내 · {saved.homeReason}</p>}
    <div className="mt-5 flex flex-wrap items-center gap-2"><Button disabled={!changed || length < 5} onClick={() => void save()} className={`h-11 rounded-xl px-5 ${interaction}`}>첫 마디 저장</Button>{saved && <Button variant="ghost" onClick={() => void remove()} className={`h-11 rounded-xl text-xs text-muted-foreground ${interaction}`}>지우기</Button>}{message && <p role="status" className="text-xs text-primary">{message}</p>}</div>
  </Sheet>;
}

// ─────────────────────────────────────────────
// 아는 사람 피하기: 적어 둔 번호로 신청한 분과는 서로 소개하지 않는다(한쪽만 적어도). 상대에게는 알리지 않는다.
// 번호는 원래 번호를 두지 않고 비밀 값과 섞은 암호값으로 저장하고, 화면에는 뒤 네 자리만 보인다(메모는 받지 않는다).
type ContactPicker = { select: (properties: string[], options: { multiple: boolean }) => Promise<{ tel?: string[] }[]> };
function AvoidContactsCard() {
  const [list, setList] = useState<AvoidContact[] | null>(null);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const picker = typeof navigator !== "undefined" ? (navigator as Navigator & { contacts?: ContactPicker }).contacts : undefined;
  const refresh = async () => { const { data, error } = await loadAvoidContacts(); if (error) setMessage(error); setList(data ?? []); };
  useEffect(() => { void refresh(); }, []);
  const phones = text.split(/[\n,;]+/).map(item => item.trim()).filter(Boolean);
  const add = async () => {
    if (!phones.length || sending) return;
    setSending(true);
    const { data, error } = await addAvoidContacts(phones);
    setSending(false);
    if (error) { setMessage(error); return; }
    setMessage(data ? `${data}개를 더했어요. 이 번호로 신청한 분과는 소개하지 않아요.` : "이미 적어 둔 번호예요.");
    setText("");
    await refresh();
  };
  const remove = async (id: string) => { const { error } = await deleteAvoidContact(id); if (error) { setMessage(error); return; } setMessage("목록에서 지웠어요."); await refresh(); };
  const fromContacts = async () => {
    try {
      const picked = await picker!.select(["tel"], { multiple: true });
      const numbers = picked.flatMap(item => item.tel ?? []);
      if (numbers.length) setText(current => [current.trim(), ...numbers].filter(Boolean).join("\n"));
    } catch { /* 고르기를 취소했어요 */ }
  };
  return <Sheet className="p-6 sm:p-8">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-xs font-semibold text-accent"><UserX size={14} />아는 사람 피하기</p><h2 className="mt-3 text-xl font-semibold leading-[1.5]">마주치고 싶지 않은 사람이 있다면,<br />번호를 적어 두세요.</h2></div>{list && <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{list.length}개 적어 둠</span>}</div>
    <p className="mt-3 text-sm leading-7 text-muted-foreground">적어 둔 번호로 신청한 분과는 서로 소개하지 않아요. 한쪽만 적어도 막히고, 상대에게는 알리지 않아요. 원래 번호를 그대로 두지 않고 암호값으로 바꿔 두며, 화면에는 뒤 네 자리만 보여요. 번호 주인에게는 따로 알리지 않고, 소개를 막는 데에만 써요.</p>
    <Textarea aria-label="피하고 싶은 휴대폰 번호(한 줄에 하나)" value={text} onChange={event => setText(event.target.value)} rows={3} placeholder={"010-1234-5678\n한 줄에 하나씩, 여러 개도 괜찮아요"} className="mt-5 rounded-xl border-border bg-card text-sm leading-7" />
    <div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled={!phones.length || sending} onClick={() => void add()} className={`h-11 rounded-xl px-5 ${interaction}`}>{sending ? "저장하는 중…" : `${phones.length ? `${phones.length}개 ` : ""}피하기 목록에 넣기`}</Button>{picker && <Button type="button" variant="outline" onClick={() => void fromContacts()} className="h-11 rounded-xl border-border hover:bg-muted hover:text-foreground"><Contact size={15} />연락처에서 고르기</Button>}{message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}</div>
    {list && list.length > 0 && <ul className="mt-6 divide-y divide-border border-t border-border">{list.map(item => <li key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="tabular-nums">010-••••-{item.tail}</span><Button variant="ghost" size="sm" aria-label={`뒤 네 자리 ${item.tail} 번호 지우기`} onClick={() => void remove(item.id)} className="h-8 shrink-0 rounded-lg text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><X size={13} />지우기</Button></li>)}</ul>}
    <p className="mt-4 text-[11px] leading-5 text-muted-foreground">이미 진행 중인 소개에는 적용되지 않아요. 지금 소개된 분이 아는 사람이라면 ‘두 사람’ 화면에서 차단해 주세요.</p>
  </Sheet>;
}

// ─────────────────────────────────────────────
// 두 사람: 지금의 소개(열람 기간 안에서만 상대 프로필이 보인다)
const labelOf = (id: string) => id === "self.age" ? "만 나이" : APPLICATION_FIELDS.find(field => field.id === id)?.label ?? id;
const valueOf = (value: string | string[]) => Array.isArray(value) ? value.join(" · ") : value;

// 내 정보: 상대에게 보이는 내 소개. 신청서에서 ‘상대 공개’로 켠 항목과 운영진이 확인한 사진을, 상대가 정오에 보는 모양 그대로 미리 본다.
type MyPublic = { name: string | null; items: { id: string; value: string | string[] }[]; photos: PhotoRow[]; waitingPhotos: number; swapping: number };
function OwnPhoto({ path, label }: { path: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let alive = true; void photoUrl(path).then(next => { if (alive) setUrl(next); }); return () => { alive = false; }; }, [path]);
  return <figure className="aspect-[4/5] overflow-hidden rounded-2xl bg-lilac">{url ? <img src={url} alt={label} onError={() => setUrl(null)} className="h-full w-full object-cover" /> : <span className="sr-only">{label}</span>}</figure>;
}
function MyPublicProfileCard() {
  const [state, setState] = useState<MyPublic | "none" | "error" | null>(null);
  const [all, setAll] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadMyApplication().then(({ data, error }) => {
      if (!alive) return;
      if (error) { setState("error"); return; }
      if (!data || data.status === "draft" || data.status === "withdrawn") { setState("none"); return; }
      const profile = publicApplicationProfile(data.draft, today());
      const shared = data.photoRows.filter(row => data.draft.sharing[row.slot] !== false);
      const photos = shared.filter(row => row.review === "기준 확인").sort((a, b) => PHOTO_ORDER.indexOf(a.slot) - PHOTO_ORDER.indexOf(b.slot));
      const name = profile.items.find(item => item.id === "self.name");
      setState({ name: name ? valueOf(name.value) : null, items: profile.items.filter(item => item.id !== "self.name"), photos, waitingPhotos: shared.length - photos.length, swapping: data.replacements.filter(item => item.review === "대기").length });
    });
    return () => { alive = false; };
  }, [attempt]);
  if (state === null) return null;
  if (state === "error") return <Sheet tone="soft" className="p-6 sm:p-8"><p className="text-xs font-semibold text-accent">상대에게 보이는 내 소개</p><p role="status" className="mt-3 text-sm leading-7 text-muted-foreground">내 소개를 불러오지 못했어요. 잠시 뒤 다시 불러와 주세요.</p><Button variant="outline" onClick={() => { setState(null); setAttempt(value => value + 1); }} className="mt-4 h-10 rounded-full border-border px-4 text-xs">다시 불러오기</Button></Sheet>;
  if (state === "none") return <Sheet tone="soft" className="p-6 sm:p-8"><p className="text-xs font-semibold text-accent">상대에게 보이는 내 소개</p><p className="mt-3 text-sm leading-7 text-muted-foreground">신청서를 내면, 소개된 상대가 정오에 보게 될 내 모습을 이곳에서 미리 볼 수 있어요.</p><Button asChild className="mt-4 h-11 rounded-full px-5"><Link to="/apply">신청서 쓰기 <ArrowRight size={14} /></Link></Button></Sheet>;
  const items = all ? state.items : state.items.slice(0, 4);
  return (
    <section aria-labelledby="my-public-title" className="overflow-hidden rounded-3xl border border-lilac bg-card">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-lilac bg-mist px-6 py-5 sm:px-8">
        <div><p className="text-xs font-semibold text-accent">상대에게 보이는 내 소개</p><h2 id="my-public-title" className="mt-2 text-xl font-semibold">{state.name ? `${state.name} 님은 이렇게 소개돼요.` : "이렇게 소개돼요."}</h2></div>
        <Button asChild variant="outline" className="h-10 rounded-full border-border px-4 text-xs"><Link to="/apply?edit=1&step=3">보일 항목 고치기 <ArrowUpRight size={13} /></Link></Button>
      </div>
      <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
        <div className="flex flex-col justify-center">
          {state.photos.length ? <div className="grid grid-cols-3 gap-2">{state.photos.map(photo => <OwnPhoto key={photo.path} path={photo.path} label={PHOTO_SLOTS.find(slot => slot.id === photo.slot)?.label ?? "사진"} />)}</div> : <p className="rounded-2xl bg-mist p-5 text-xs leading-6 text-muted-foreground">운영진이 사진을 확인하면 여기에 보여요.</p>}
          {state.waitingPhotos > 0 && <p className="mt-3 text-[11px] leading-5 text-muted-foreground">확인 중인 사진 {state.waitingPhotos}장은 확인이 끝난 뒤에 보여요.</p>}
          {state.swapping > 0 && <p className="mt-3 text-[11px] leading-5 text-muted-foreground">바꿀 새 사진 {state.swapping}장을 확인하고 있어요. 확인되면 이곳의 사진도 바뀌어요.</p>}
        </div>
        <div>
          <dl className="divide-y divide-border border-y border-border">{items.map(item => <div key={item.id} className="grid gap-1 py-3.5 sm:grid-cols-[120px_1fr]"><dt className="text-xs text-muted-foreground">{labelOf(item.id)}</dt><dd className="whitespace-pre-wrap break-words text-sm leading-7">{valueOf(item.value)}</dd></div>)}</dl>
          {state.items.length > 4 && <Button variant="ghost" onClick={() => setAll(value => !value)} className="mt-2 h-10 rounded-full px-4 text-xs text-muted-foreground">{all ? "접기" : `${state.items.length - 4}개 더 보기`}</Button>}
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">생년월일 원래 값·휴대폰 번호·이메일은 상대에게 보이지 않아요. 고친 내용은 운영진이 다시 확인한 뒤 다음 소개부터 반영돼요.</p>
        </div>
      </div>
    </section>
  );
}

// 두 분의 궁합: 정오 공개부터 두 사람 화면에. 두 분이 상대에게 공개한 소개 내용만으로 정리한 글이에요.
// 점수는 서버가 65 이상일 때만 숫자로 보내고, 그 아래는 이유만 보여 준다. 예전 소개(궁합 없음)에는 이 칸이 없다.
const MATCH_CHIP = "rounded-full bg-[#F8E5A6] px-3 py-1 text-xs font-semibold text-[#5A4310] dark:bg-[#3B3424] dark:text-[#F3D98A]";
function MatchSheet({ match }: { match: IntroMatch }) {
  const groups = ([["왜 어울리는지", match.why], ["함께일 때 빛나는 점", match.together]] as const).filter(([, items]) => items.length);
  return (
    <section aria-labelledby="match-title" className="overflow-hidden rounded-3xl border border-lilac bg-card shadow-[0_24px_48px_-36px_color-mix(in_oklch,var(--primary)_40%,transparent)]">
      <div className="border-b border-lilac bg-mist px-6 py-6 sm:px-8">
        <p className={`inline-flex w-fit items-center gap-1.5 ${MATCH_CHIP}`}><span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />두 분의 궁합</p>
        <div className="mt-4 flex items-end gap-4">
          {match.score != null && <p className="shrink-0 text-5xl font-light leading-none tabular-nums text-primary"><span className="sr-only">궁합 </span>{match.score}</p>}
          <h2 id="match-title" className="min-w-0 text-lg font-semibold leading-[1.55] text-ink">{match.headline}</h2>
        </div>
      </div>
      <div className={`grid gap-7 p-6 sm:p-8 ${groups.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {groups.map(([title, items]) => <div key={title}><h3 className="text-xs font-semibold text-accent">{title}</h3><ul className="mt-3 space-y-3">{items.map(item => <li key={item} className="flex gap-3 text-sm leading-7"><span aria-hidden="true" className="mt-[11px] size-1.5 shrink-0 rounded-full bg-primary/60" /><span className="min-w-0 break-keep">{item}</span></li>)}</ul></div>)}
      </div>
      <p className="border-t border-border px-6 py-4 text-[11px] leading-5 text-muted-foreground sm:px-8">두 분이 상대에게 공개한 소개 내용만으로 정리했어요. 서로를 알아가는 데 작은 참고로 봐 주세요.</p>
    </section>
  );
}
// 오늘 화면의 작은 궁합 줄(두 사람 화면으로)
function MatchLink({ match }: { match: IntroMatch }) {
  return <Link to="/us" className={`mt-7 flex items-center gap-3 rounded-2xl border border-lilac bg-mist px-4 py-3 hover:border-primary/40 ${interaction}`}>
    <span className={`shrink-0 tabular-nums ${MATCH_CHIP}`}>두 분의 궁합{match.score != null ? ` ${match.score}` : ""}</span>
    <span className="line-clamp-2 min-w-0 flex-1 text-xs leading-6 text-ink">{match.headline}</span>
    <ArrowUpRight size={15} aria-hidden="true" className="shrink-0 text-muted-foreground" />
  </Link>;
}

function PartnerPhoto({ path, label }: { path: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let alive = true; setFailed(false); void partnerPhotoUrl(path).then(next => { if (!alive) return; if (next) setUrl(next); else setFailed(true); }); return () => { alive = false; }; }, [path, attempt]);
  return <figure className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-border bg-muted">{url && !failed ? <img src={url} alt={label} className="h-full w-full object-cover" draggable={false} onContextMenu={event => event.preventDefault()} onError={() => setFailed(true)} /> : <span className="sr-only">{label}</span>}{failed && <figcaption className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-[11px] leading-5 text-muted-foreground">사진을 불러오지 못했어요<button type="button" onClick={() => { setUrl(null); setAttempt(value => value + 1); }} className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-foreground">다시 보기</button>{attempt > 0 && <Link to="/contact?type=소개·교류" className="font-semibold text-primary underline-offset-4 hover:underline">계속 안 보이면 문의하기</Link>}</figcaption>}</figure>;
}

export function LiveIntroductionPage() {
  return <Member><LiveIntroductionView /></Member>;
}
function LiveIntroductionView() {
  const { data, error, loading, reload } = useMemberSnapshot();
  const [intro, setIntro] = useState<LiveIntroduction | null>(null);
  const [choice, setChoice] = useState<"positive" | "negative" | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [safety, setSafety] = useState<"report" | "block" | null>(null);
  const [reportText, setReportText] = useState("");
  const [sending, setSending] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [answerMessage, setAnswerMessage] = useState("");
  const [flash, setFlash] = useState("");
  useEffect(() => { if (data) setIntro(data.introduction); }, [data]);
  useEffect(() => { if (intro && intro.status !== "waiting" && intro.profile && !intro.opened) void recordIntroductionView(intro.id).then(() => setIntro(current => current && current.status !== "waiting" ? { ...current, opened: true } : current)); }, [intro?.status !== "waiting" && intro?.id]);
  // 끝난 소개도 신고할 수 있다(서버는 끝난 소개의 상대도 신고를 받는다).
  const sendClosedReport = async () => {
    if (sending || !intro || intro.status === "waiting") return;
    if (!reportText.trim()) { setMessage("어떤 일이 있었는지 한 줄이라도 적어 주세요."); return; }
    setSending(true);
    try {
      const result = await reportPartner(intro.id, "회원 신고", reportText, urgent);
      setMessage(result.error || "신고를 받았어요. 운영진이 가장 먼저 확인해요. 상대에게는 신고 사실을 알리지 않아요.");
      if (!result.error) { setSafety(null); setReportText(""); setUrgent(false); }
    } finally { setSending(false); }
  };
  if (loading || (!intro && !error)) return <Waiting />;
  if (error || !intro) return <section><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" className="mt-5 rounded-xl" onClick={() => void reload()}>다시 불러오기</Button></section>;
  if (intro.status === "waiting" || !intro.profile) {
    const ended = intro.status !== "waiting" ? endedCopy(intro, data?.program ?? null) : null;
    const application = data?.application?.status;
    const waitingLead = !application || application === "draft" ? "신청서를 내고 운영진 확인이 끝나면, 잘 맞는 분이 준비된 날 정오에 이곳에서 소개해 드릴게요." : application === "approved" ? "잘 맞는 분이 준비되면, 정오에 이곳에서 소개해 드릴게요." : "신청서 확인이 끝나고 잘 맞는 분이 준비되면, 정오에 이곳에서 소개해 드릴게요.";
    return (
      <section>
        <PageHeader mark="두 사람" label={intro.status === "waiting" ? "소개 전" : "소개 마무리"} en="TWO OF US" title={intro.status === "waiting" ? "아직 소개된 분이 없어요." : ended!.title} lead={intro.status === "waiting" ? waitingLead : `${ended!.body} 끝난 소개의 프로필은 다시 볼 수 없어요.`} aside={<TwoDots apart faded />} />
        {flash && <p role="status" className="mt-6 max-w-xl rounded-xl bg-muted p-4 text-sm leading-7">{flash}</p>}
        <div className="mt-8 flex flex-wrap gap-2"><Button asChild variant="outline" className={`h-11 rounded-full px-5 ${interaction}`}><Link to="/today">오늘로 돌아가기 <ArrowRight size={15} /></Link></Button>{intro.status === "waiting" && (!application || application === "draft") && <Button asChild className={`h-11 rounded-full px-5 ${interaction}`}><Link to="/apply">신청서 쓰기 <ArrowRight size={15} /></Link></Button>}</div>
        {intro.status !== "waiting" && <div className="mt-10 max-w-xl space-y-3 border-t border-border pt-5">
          <p className="text-xs leading-6 text-muted-foreground">끝난 소개나 만남에서 불편한 일이 있었다면 지금도 신고할 수 있어요. 상대에게는 신고 사실을 알리지 않아요.</p>
          <Button variant="ghost" onClick={() => setSafety(value => value === "report" ? null : "report")} aria-expanded={safety === "report"} className={`h-10 rounded-full px-4 text-xs text-muted-foreground hover:bg-muted hover:text-foreground ${interaction}`}><Flag size={13} />신고하기</Button>
          {safety === "report" && <div className="space-y-3 rounded-2xl border border-border p-4"><Textarea aria-label="신고 내용" value={reportText} maxLength={1000} onChange={event => setReportText(event.target.value)} placeholder="어떤 일이 있었는지 적어 주세요. 캡처 등 증빙은 지우지 말고 보관해 주세요." className="min-h-24 rounded-xl text-base md:text-sm" /><label className="flex items-center gap-2 text-xs"><Checkbox checked={urgent} onCheckedChange={value => setUrgent(value === true)} />지금 위험하거나 급한 일이에요</label><Button disabled={sending} onClick={() => void sendClosedReport()} className={`h-11 rounded-full px-5 ${interaction}`}>{sending ? "보내는 중…" : "신고 보내기"}</Button></div>}
          {message && <p role="status" className="rounded-xl bg-muted p-3 text-xs leading-6">{message}</p>}
        </div>}
      </section>
    );
  }
  const name = intro.profile.items.find(item => item.id === "self.name");
  const respond = async () => {
    if (!choice || sending) return;
    setSending(true);
    const result = await respondIntroduction(intro.id, choice, choice === "negative" ? reason : null);
    setSending(false);
    if (result.error || !result.data) { setAnswerMessage(result.error || "답을 저장하지 못했어요."); return; }
    setIntro(result.data); setAnswerMessage("");
  };
  // 신고·차단도 보내는 중에는 다시 보내지 않는다. 신고는 내용을 적어야 보낼 수 있다.
  const submitSafety = async () => {
    if (sending) return;
    if (safety === "report" && !reportText.trim()) { setMessage("어떤 일이 있었는지 한 줄이라도 적어 주세요."); return; }
    setSending(true);
    try {
      if (safety === "block") { const result = await blockPartner(intro.id); if (result.error) { setMessage(result.error); return; } setSafety(null); setFlash("차단했어요. 다시는 서로 소개되지 않고, 상대에게는 차단 사실을 알리지 않아요."); await reload(); return; }
      const result = await reportPartner(intro.id, "회원 신고", reportText, urgent);
      setMessage(result.error || "신고를 받았어요. 운영진이 가장 먼저 확인해요. 상대에게는 신고 사실을 알리지 않아요.");
      if (!result.error) { setSafety(null); setReportText(""); }
    } finally {
      setSending(false);
    }
  };
  // 방식과 시작일을 정한 뒤(교류 시작 전·중·만남 선택·약속)에는 정하기 안내 대신 교류 화면으로 보낸다.
  const programUnderway = !!data?.program && data.program.introductionId === intro.id && data.program.status !== "choosing" && data.program.status !== "closed";
  return (
    <section aria-labelledby="us-title">
      {intro.status === "mutual" && (programUnderway
        ? <div className="mb-10"><Moment eyebrow="WE BOTH SAID YES" title="두 분의 교류가 이어지고 있어요." action={<Button asChild className="h-11 rounded-xl px-6"><Link to="/exchange">교류 화면으로 <ArrowRight size={14} /></Link></Button>}>편지·첫 장면과 만남 선택은 교류 화면에서 이어 가요. 불편한 일이 있으면 이 화면 아래에서 신고하거나 차단할 수 있어요.</Moment></div>
        : <div className="mb-10"><Moment eyebrow="WE BOTH SAID YES" title="두 분 모두 알아가고 싶다고 답했어요." action={<Button asChild className="h-11 rounded-xl px-6"><Link to="/exchange">함께 시작하는 방법 정하기 <ArrowRight size={14} /></Link></Button>}>3일 교류 방식(A 편지 · B 첫 장면)과 시작일을 함께 정해요.</Moment></div>)}
      <PageHeader mark="두 사람" label={intro.status === "mutual" ? "서로 선택" : "오늘의 인연"} en="TWO OF US" titleId="us-title" title={name ? `${valueOf(name.value)} 님을 소개해요.` : "오늘의 인연을 소개해요."} lead={intro.status === "published" ? intro.ownResponse ? `${kstDateTime(intro.dueAt)}에 답이 마감돼요.` : `${kstDateTime(intro.dueAt)}까지 답해 주세요.` : undefined} aside={<TwoDots apart={intro.status !== "mutual"} />} />
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{intro.profile.photos.map(photo => <PartnerPhoto key={photo.path} path={photo.path} label={PHOTO_SLOTS.find(slot => slot.id === photo.slot)?.label ?? "사진"} />)}</div>
          {intro.profile.greeting && <figure className="border-l-2 border-primary pl-5"><blockquote className="text-lg font-semibold leading-[1.6]">“{intro.profile.greeting}”</blockquote><figcaption className="mt-2 text-xs text-muted-foreground">{name ? `${valueOf(name.value)} 님의 첫 마디` : "첫 마디"}</figcaption></figure>}
          {intro.note && <Sheet tone="soft" className="p-6"><p className="text-xs font-semibold text-accent">운영진이 두 분을 소개한 이유</p><p className="mt-3 text-sm leading-7">{intro.note}</p>{intro.reflected && <p className="mt-3 border-t border-border/70 pt-3 text-xs leading-6 text-muted-foreground">지난 교류 뒤 남겨 주신 한 줄을 참고해 골랐어요.</p>}</Sheet>}
          {intro.match && <MatchSheet match={intro.match} />}
          <dl className="divide-y divide-border border-y border-border">{intro.profile.items.filter(item => item.id !== "self.name").map(item => <div key={item.id} className="grid gap-1 py-4 sm:grid-cols-[140px_1fr]"><dt className="text-xs text-muted-foreground">{labelOf(item.id)}</dt><dd className="whitespace-pre-wrap break-words text-sm leading-7">{valueOf(item.value)}</dd></div>)}</dl>
          <p className="text-xs leading-6 text-muted-foreground">{intro.status === "mutual" ? "서로 선택했으니 프로필과 사진은 교류와 약속이 끝날 때까지 볼 수 있어요." : "프로필과 사진은 응답 기한까지만 볼 수 있어요."} 캡처하거나 다른 곳에 옮기지 말아 주세요.</p>
        </div>
        <div className="space-y-6">
          <Sheet className="p-6 sm:p-8">
            <p className="text-xs font-semibold text-accent">나의 답</p>
            {intro.ownResponse ? <><h2 className="mt-4 text-xl font-semibold">{intro.ownResponse === "positive" ? "알아가고 싶다고 답했어요." : "이번에는 넘기겠다고 답했어요."}</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">{intro.status === "mutual" ? "두 분 모두 알아가고 싶다고 답했어요." : intro.status === "published" ? intro.ownResponse === "positive" ? `두 분 모두 원하면 그 순간 교류가 열려요. 아니면 ${kstDateTime(intro.dueAt)}에 마무리 소식을 알림과 메일로 알려 드려요. 상대가 이미 답했는지는 알려 드리지 않고, 보낸 답은 바꿀 수 없어요.` : `이번 소개는 ${kstDateTime(intro.dueAt)}에 마무리돼요. 상대에게는 누가 어떤 답을 했는지 알리지 않아요.` : "이번 소개는 마무리됐어요."}</p></> : intro.status === "published" ? <>
              <h2 className="mt-4 text-xl font-semibold">이 분을 더 알아가고 싶나요?</h2>
              <div className="mt-5 grid gap-2">{([["positive", "알아가고 싶어요"], ["negative", "이번엔 넘길게요"]] as const).map(([value, label]) => <Button key={value} variant="outline" aria-pressed={choice === value} onClick={() => { setChoice(value); setReason(null); }} className={`h-12 justify-start rounded-xl ${choice === value ? "border-primary bg-primary/5 text-primary" : "border-border"} ${interaction}`}>{label}</Button>)}</div>
              {choice === "positive" && <p role="note" className="mt-4 flex items-start gap-2.5 rounded-xl bg-primary/5 p-3.5 text-xs leading-6 text-ink"><LockKeyhole size={14} aria-hidden="true" className="mt-1 shrink-0 text-primary" /><span>상대가 먼저 골랐는지는 서로 알 수 없어요. 두 분 모두 ‘알아가고 싶어요’일 때만 그 순간 교류가 열려요.</span></p>}
              {choice === "negative" && <div className="mt-5"><p className="text-xs leading-6 text-muted-foreground">이유를 골라 주시면 다음 소개에 참고해요(선택). 상대에게는 절대 보이지 않아요.</p><div className="mt-3 flex flex-wrap gap-2">{DECLINE_REASONS.map(item => <button key={item} type="button" aria-pressed={reason === item} onClick={() => setReason(value => value === item ? null : item)} className={`rounded-full border px-3 py-1.5 text-xs ${reason === item ? "border-primary bg-primary/5 text-primary" : "border-border"} ${interaction}`}>{item}</button>)}</div></div>}
              <Button disabled={!choice || sending} onClick={() => void respond()} className={`mt-6 h-12 w-full rounded-xl ${interaction}`}>답 보내기 <ArrowRight size={15} /></Button>
              {answerMessage && <p role="alert" className="mt-3 rounded-xl bg-destructive/5 p-3 text-xs leading-6 text-destructive">{answerMessage}</p>}
              <p className="mt-3 text-[11px] leading-5 text-muted-foreground">보낸 답은 바꿀 수 없어요. 내 답은 상대에게 알리지 않아요.</p>
              <div className="mt-5 rounded-2xl bg-mist p-4"><p className="text-xs font-semibold text-ink">두 분 모두 ‘알아가고 싶어요’라면</p><p className="mt-1.5 text-xs leading-6 text-muted-foreground">{AFTER_YES}</p></div>
            </> : <p className="mt-4 text-sm leading-7 text-muted-foreground">응답 기한이 지났어요.</p>}
          </Sheet>
          <div className="space-y-3 border-t border-border pt-5">
            <p className="text-xs leading-6 text-muted-foreground">{SAFETY_COMPOSE_NOTE}</p>
            <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setSafety(value => value === "report" ? null : "report")} aria-expanded={safety === "report"} className={`h-9 rounded-xl text-xs text-muted-foreground ${interaction}`}><Flag size={13} />신고하기</Button><Button variant="ghost" onClick={() => setSafety(value => value === "block" ? null : "block")} aria-expanded={safety === "block"} className={`h-9 rounded-xl text-xs text-muted-foreground ${interaction}`}><ShieldOff size={13} />차단하기</Button></div>
            {safety === "report" && <div className="space-y-3 rounded-xl border border-border p-4"><Textarea aria-label="신고 내용" value={reportText} maxLength={1000} onChange={event => setReportText(event.target.value)} placeholder="어떤 일이 있었는지 적어 주세요. 캡처 등 증빙은 지우지 말고 보관해 주세요." className="min-h-24 rounded-xl" /><label className="flex items-center gap-2 text-xs"><Checkbox checked={urgent} onCheckedChange={value => setUrgent(value === true)} />돈 요구·협박 등 급한 일이에요</label><Button size="sm" disabled={sending} onClick={() => void submitSafety()} className="rounded-xl">신고 보내기</Button><p className="text-[11px] text-muted-foreground">위급하면 112에 먼저 연락해 주세요.</p></div>}
            {safety === "block" && <div className="space-y-3 rounded-xl border border-border p-4"><p className="text-xs leading-6">차단하면 이 소개가 바로 끝나고, 다시는 서로 소개되지 않아요. 이유는 묻지 않아요.</p><Button size="sm" variant="outline" disabled={sending} onClick={() => void submitSafety()} className="rounded-xl border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive">차단하기</Button></div>}
            {message && <p role="status" className="rounded-xl bg-muted p-3 text-xs leading-6">{message}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────
// 내 정보: 신청서 · 알림 설정 · 계정
export function LiveProfilePage() {
  return <Member><LiveProfileView /></Member>;
}
// 기수가 시작된 뒤 ‘다음 소개’ 안내. 매일 소개를 약속하지 않으므로 ‘빠르면’으로 말한다.
function nextIntroText(data: MemberSnapshot) {
  const status = data.application?.status;
  if (status === "submitted" || status === "reviewing") return "확인이 끝나면 소개를 준비해요";
  if (status === "needs_changes") return "보완이 끝나면 소개를 준비해요";
  if (status !== "approved") return null;
  if (data.notices?.paused_at) return "다시 받으면 다음 정오부터";
  if (data.introduction.status === "published") return "지금 소개가 열려 있어요";
  if (data.introduction.status === "mutual") return "교류를 마치면 다음 소개를 준비해요";
  return waitedDays(data) >= BEFORE_US.noonGuidance.waitingNoteAfterDays ? "찾는 데 시간이 걸리고 있어요" : "다음 소개 · 준비되는 날 정오";
}
// 새 소개를 기다린 날: 마지막 소개·교류가 끝난 때, 쉬기를 풀고 다시 받은 때, 기수 시작, 신청 접수 중 가장 늦은 때부터 센다(쉰 기간은 세지 않는다).
function waitedDays(data: MemberSnapshot) {
  const marks = [data.introduction.status !== "waiting" ? data.introduction.closedAt : null, data.program?.closedAt ?? null, data.notices?.resumed_at ?? null, data.cohort ? `${data.cohort.startsOn}T12:00:00+09:00` : null, data.application?.submittedAt ?? null]
    .filter((value): value is string => !!value).map(value => Date.parse(value)).filter(Number.isFinite);
  return marks.length ? Math.floor((Date.now() - Math.max(...marks)) / 86400000) : 0;
}
function LiveProfileView() {
  const { data, error, loading, reload } = useMemberSnapshot();
  const [message, setMessage] = useState("");
  const [pauseMessage, setPauseMessage] = useState("");
  const [pausing, setPausing] = useState(false);
  if (loading) return <Waiting />;
  // 불러오지 못했을 때 기본값(모두 꺼짐)을 보여 주면, 그 상태로 알림 설정을 눌러 실제 설정을 덮어쓸 수 있다. 그래서 다시 불러오기만 보여 준다.
  if (error || !data) return <section><p role="alert" className="text-sm text-destructive">{error || "불러오지 못했어요."}</p><Button variant="outline" className="mt-5 rounded-xl" onClick={() => void reload()}>다시 불러오기</Button></section>;
  const notices = data?.notices;
  const toggle = async (key: "notice_daily_waiting" | "marketing_opt_in", value: boolean) => { const result = await saveNoticeSettings({ [key]: value }); setMessage(result.error || "저장했어요."); await reload(); };
  const channels = { kakao: !!notices?.notify_kakao, sms: !!notices?.notify_sms, email: !!notices?.notify_email };
  const channelText = [channels.kakao && "카카오톡", channels.sms && "문자", channels.email && "메일"].filter(Boolean).join(" · ");
  const setChannel = async (key: keyof typeof channels, value: boolean) => { const next = { ...channels, [key]: value }; const result = await setNotifyChannels(next.kakao, next.sms, next.email); setMessage(result.error || "알림 받을 방법을 바꿨어요."); await reload(); };
  const paused = !!notices?.paused_at;
  // 검토 중·승인·보류 상태에서 고치면 다시 확인을 받는데, 진행 중인 소개·교류가 있으면 끝난 뒤에만 보낼 수 있다. 들어가기 전에 먼저 알린다.
  const editBlocked = data.application && ["reviewing", "approved", "held"].includes(data.application.status) ? editBlockReason(data.introduction, data.program) : null;
  const togglePause = async () => { setPausing(true); const result = await setPaused(!paused); setPausing(false); setPauseMessage(result.error || (paused ? "다시 받기로 바꿨어요. 다음 정오부터 소개를 준비해요." : "새 소개를 잠시 쉬어요. 진행 중인 소개는 그대로 이어져요.")); await reload(); };
  return (
    <section className="space-y-10">
      <PageHeader mark="내 정보" label="계정과 신청" en="ABOUT ME" title="내 정보" lead="지금 어디쯤인지, 다음에 무엇을 하면 되는지 먼저 보여 드려요." />
      {/* 한눈에 보는 요약(데모 내 정보와 같은 모양) */}
      <div className="relative overflow-hidden rounded-3xl border border-lilac bg-mist p-3 sm:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_18%,transparent),transparent)]" />
        <div className="relative grid gap-2 sm:grid-cols-3 sm:gap-3">
          {[
            { label: "신청 상태", value: data?.application ? ({ draft: "작성 중", submitted: "접수 완료", reviewing: "검토 중", needs_changes: "보완 요청", approved: "소개 준비", held: "보류", withdrawn: "철회", rejected: "소개 어려움" } as Record<string, string>)[data.application.status] : "신청 전", sub: data?.application?.submittedAt && data.application.status !== "draft" ? `${kstDay(data.application.submittedAt)} 접수` : "신청은 무료예요" },
            { label: "내 기수", value: data?.cohort ? `${cohortName(data.cohort.number)} · ${cohortCountdown(data.cohort.startsOn)}` : "신청 뒤 정해져요", sub: data?.cohort ? cohortCountdown(data.cohort.startsOn) === "진행 중" ? nextIntroText(data) ?? `${noonOf(data.cohort.startsOn)} 정오 시작` : `${noonOf(data.cohort.startsOn)} 정오 첫 소개` : BEFORE_US.beta.active ? "베타 기수 · 날짜는 신청 뒤 알려 드려요" : "매달 마지막 날 정오 시작" },
            { label: "알림", value: paused ? "새 소개 쉬는 중" : notices?.notice_daily_waiting ? "소개 없는 날도 알림" : "새 소개만 알림", sub: BEFORE_US.beta.active ? "사이트 · 메일(베타 동안)" : channelText ? `사이트 · ${channelText}` : "사이트 안 알림" },
          ].map(item => <div key={item.label} className="flex items-center justify-between gap-3 rounded-2xl bg-card/90 px-4 py-3.5 shadow-[0_18px_36px_-30px_color-mix(in_oklch,var(--primary)_60%,transparent)] sm:block sm:p-5"><div className="min-w-0"><p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{item.label}</p><p className="mt-1 truncate text-xs text-muted-foreground sm:hidden">{item.sub}</p></div><p className="shrink-0 text-right text-base font-semibold text-ink sm:mt-2 sm:text-left sm:text-lg">{item.value}</p><p className="mt-1 hidden text-xs text-muted-foreground sm:block">{item.sub}</p></div>)}
        </div>
      </div>
      <MyPublicProfileCard />
      {data.application?.status === "approved" && <PhotosPanel photos={data.photos ?? null} />}
      <div className="grid gap-6 lg:grid-cols-2">
        <Sheet className="p-6"><p className="text-xs font-semibold text-accent">소개 신청서 고치기</p><p className="mt-3 text-sm leading-7 text-muted-foreground">{!data?.application || data.application.status === "draft" ? "쓰던 곳부터 이어서 쓸 수 있어요." : data.application.status === "submitted" ? "검토 전이라 바로 고칠 수 있어요." : ["rejected", "withdrawn"].includes(data.application.status) || editBlocked ? "" : "고친 내용을 ‘수정 내용 제출’로 보내면 운영진이 다시 확인해요. 그동안 새 소개 준비는 잠시 멈춰요."}</p>{data?.application && ["rejected", "withdrawn"].includes(data.application.status) ? <p className="mt-4 text-xs leading-6 text-muted-foreground">지금 상태에서는 신청서를 고칠 수 없어요. 문의하기로 남겨 주시면 확인해 드릴게요.</p> : editBlocked ? <><p role="status" className="mt-4 rounded-xl bg-mist p-4 text-xs leading-6">{editBlocked}</p>{data.application?.status === "approved" && <p className="mt-3 text-xs leading-6 text-muted-foreground">사진은 지금도 <a href="#photos" className="font-semibold text-primary underline-offset-4 hover:underline">내 사진</a>에서 바꿀 수 있어요.</p>}</> : <div className="mt-4 grid grid-cols-2 gap-2">{[["나에 대해", 0], ["사진", 1], ["원하는 만남", 2], ["공개·동의", 3]].map(([label, step]) => <Button key={label} asChild variant="outline" className={`h-auto justify-between rounded-xl border-border px-4 py-3 text-xs ${interaction}`}>{step === 1 && data.application?.status === "approved" ? <a href="#photos">{label} <ArrowUpRight size={13} /></a> : <Link to={`/apply?edit=1&step=${step}`}>{label} <ArrowUpRight size={13} /></Link>}</Button>)}</div>}</Sheet>
        <Sheet className="p-6"><p className="text-xs font-semibold text-accent">알림 설정</p><div className="mt-4 space-y-3 text-sm"><label className="flex items-start gap-3 leading-6"><Checkbox className="mt-1" checked={!!notices?.notice_daily_waiting} onCheckedChange={value => void toggle("notice_daily_waiting", value === true)} />소개가 없는 날에도 정오에 사이트에서 알려 주세요. <span className="text-muted-foreground">(선택)</span></label><label className="flex items-start gap-3 leading-6"><Checkbox className="mt-1" checked={!!notices?.marketing_opt_in} onCheckedChange={value => void toggle("marketing_opt_in", value === true)} />새 소식과 혜택 안내를 받을게요. <span className="text-muted-foreground">(선택 · 광고성 정보)</span></label></div><fieldset className="mt-5 border-t border-border pt-4"><legend className="sr-only">알림 받을 방법</legend><p className="text-xs font-semibold">알림 받을 방법{!BETA_ACTIVE && <span className="font-normal text-muted-foreground"> · 카카오톡·문자 중 1개 이상</span>}</p>{BETA_ACTIVE && <p className="mt-1.5 text-xs leading-6">지금은 메일과 사이트로 알려 드려요.</p>}<div className="mt-3 flex flex-wrap gap-2">{([["kakao", "카카오톡"], ["sms", "문자"], ["email", "메일"]] as const).filter(([key]) => !(BETA_ACTIVE && key === "email")).map(([key, label]) => <button key={key} type="button" aria-pressed={channels[key]} onClick={() => void setChannel(key, !channels[key])} className={`rounded-full border px-4 py-2 text-xs ${interaction} ${channels[key] ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"}`}>{label}{BETA_ACTIVE && <span className="ml-1.5 text-[10px] opacity-75">정식 운영부터</span>}</button>)}</div>{BETA_ACTIVE && <p className="mt-2 text-[11px] leading-5 text-muted-foreground">정식 운영부터 받을 방법이에요. 하나 이상 골라 두세요.</p>}</fieldset><fieldset className="mt-5 border-t border-border pt-4"><legend className="sr-only">메일로 받을 알림</legend><p className="text-xs font-semibold">메일로 받을 알림</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{([[false, "중요한 것만", "소개 도착·마감·약속처럼 할 일이 있을 때만"], [true, "모두 받기", "상대가 편지를 보냈을 때 같은 소식까지"]] as const).map(([all, label, sub]) => <button key={label} type="button" aria-pressed={!!notices?.email_all === all} onClick={() => void saveNoticeSettings({ email_all: all }).then(result => { setMessage(result.error || "메일 받을 범위를 바꿨어요."); return reload(); })} className={`rounded-xl border p-3 text-left ${interaction} ${!!notices?.email_all === all ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}><span className="block text-xs font-semibold">{label}{!all && " (기본)"}</span><span className="mt-1 block text-[11px] leading-5 text-muted-foreground">{sub}</span></button>)}</div></fieldset><p className="mt-4 text-[11px] leading-5 text-muted-foreground">모든 알림은 사이트에서 늘 보여 드려요. 메일은 가입한 주소로 보내고, 밤 10시~아침 8시에는 보내지 않고 아침에 보내요.</p>{message && <p role="status" className="mt-3 text-xs text-primary">{message}</p>}</Sheet>
      </div>
      {data?.application?.status === "approved" && notices?.status === "active" && <Sheet className="flex flex-wrap items-center justify-between gap-5 p-6"><div className="min-w-0 max-w-xl"><p className="text-xs font-semibold text-accent">새 소개 {paused ? "다시 받기" : "잠시 쉬기"}</p><p className="mt-3 text-sm leading-7 text-muted-foreground">{paused ? notices.paused_by === "operator" ? "운영진이 확인할 일이 있어 새 소개를 잠시 멈췄어요. 궁금한 점은 문의하기로 남겨 주세요." : `${kstDay(notices.paused_at!)}부터 쉬고 있어요. 다시 받기를 누르면 다음 정오부터 소개를 준비해요.` : "여행·바쁜 시기처럼 잠시 쉬고 싶을 때 눌러 주세요. 진행 중인 소개는 그대로 이어지고, 새 소개만 멈춰요."}</p>{pauseMessage && <p role="status" className="mt-2 text-xs text-primary">{pauseMessage}</p>}</div><Button variant={paused ? "default" : "outline"} disabled={pausing || notices.paused_by === "operator"} onClick={() => void togglePause()} className="h-11 shrink-0 rounded-xl border-border px-5">{paused ? "다시 받기" : "잠시 쉬기"}</Button></Sheet>}
      <FirstWordCard />
      <AvoidContactsCard />
      {data.perk === "unlimited" && <QuietNote>결제 없이 이용하는 계정이에요. 소개비와 교류비를 내지 않아도 돼요.</QuietNote>}
      {BEFORE_US.beta.active && <QuietNote>베타 테스터로 함께해 주셔서 고마워요. 불편했던 점이나 바라는 점이 있다면 <Link to="/contact?type=베타 의견" className="font-semibold text-primary underline-offset-4 hover:underline">베타 의견 남기기</Link>로 알려 주세요. 하나하나 읽고 반영할게요.</QuietNote>}
      <AccountPanel />
    </section>
  );
}

// ─────────────────────────────────────────────
// 문의·요청: 개인정보 권리(정정·삭제·처리정지)와 일시정지 같은 요청
// 일시정지·다시 받기는 내 정보에서 바로 바꾼다.
const REQUEST_KINDS = ["interrupt", "correction", "deletion", "restriction", "reconsider", "refund"] as const;
const REQUEST_STATUS: Record<string, string> = { requested: "접수", protection: "보호 조치", checking: "확인 중", decided: "처리 완료", reconsidering: "다시 확인 중" };
export function LiveSupportPage() {
  return <Member><LiveSupportView /></Member>;
}
function LiveSupportView() {
  const [kind, setKind] = useState<(typeof REQUEST_KINDS)[number] | null>(null);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  // undefined = 불러오는 중, null = 불러오지 못함
  const [list, setList] = useState<Awaited<ReturnType<typeof loadMyRequests>> | undefined>(undefined);
  const refresh = async () => setList(await loadMyRequests());
  useEffect(() => { void refresh(); }, []);
  const [sending, setSending] = useState(false);
  const submit = async () => { if (!kind || sending) return; setSending(true); const result = await submitMemberRequest(kind, text); setSending(false); setMessage(result.error || "요청을 받았어요. 처리 결과는 이 화면에서 볼 수 있어요."); if (!result.error) { setKind(null); setText(""); await refresh(); } };
  return (
    <section className="space-y-10">
      <PageHeader mark="요청" label="문의·요청" en="SUPPORT" title="필요한 요청을 남겨 주세요." lead="상대와 관련된 신고는 두 사람 화면에서 하면 그 소개에 바로 연결돼요. 위급하면 112에 먼저 연락해 주세요." />
      <Sheet className="p-6 sm:p-8">
        <p className="text-xs font-semibold text-accent">요청 종류</p>
        <div className="mt-4 flex flex-wrap gap-2">{REQUEST_KINDS.filter(item => !(item === "refund" && BEFORE_US.beta.active)).map(item => <button key={item} type="button" aria-pressed={kind === item} onClick={() => setKind(item)} className={`rounded-full border px-4 py-2 text-xs ${kind === item ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/50"} ${interaction}`}>{REQUEST_LABELS[item]}</button>)}</div>
        <Textarea aria-label="요청 내용" value={text} maxLength={1000} onChange={event => setText(event.target.value)} placeholder="필요한 내용을 적어 주세요. 주민등록번호·카드번호는 적지 말아 주세요." className="mt-5 min-h-28 rounded-xl" />
        <Button disabled={!kind || sending} onClick={() => void submit()} className={`mt-4 h-11 rounded-xl px-6 ${interaction}`}>{sending ? "보내는 중…" : "요청 보내기"}</Button>
        {message && <p role="status" className="mt-4 rounded-xl bg-muted p-3 text-xs leading-6">{message}</p>}
        <p className="mt-5 text-[11px] leading-5 text-muted-foreground">탈퇴는 내 정보 아래쪽 계정에서 할 수 있어요. 그 밖의 문의는 <Link to="/contact" className="underline underline-offset-4">문의하기</Link>로 남겨 주세요.</p>
      </Sheet>
      <section aria-labelledby="requests-title"><h2 id="requests-title" className="text-sm font-semibold">내가 남긴 요청</h2>{list === undefined ? <p role="status" className="mt-4 border-y border-border py-6 text-xs text-muted-foreground">요청 목록을 불러오고 있어요.</p> : list === null ? <p className="mt-4 flex flex-wrap items-center gap-3 border-y border-border py-6 text-xs text-muted-foreground">요청 목록을 불러오지 못했어요.<button type="button" onClick={() => { setList(undefined); void refresh(); }} className="font-semibold text-primary underline-offset-4 hover:underline">다시 불러오기</button></p> : list.length ? <ul className="mt-4 divide-y divide-border border-y border-border">{list.map(item => <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-4 text-sm"><span><span className="font-semibold">{REQUEST_LABELS[item.kind as keyof typeof REQUEST_LABELS] ?? item.kind}</span>{item.decision && <span className="mt-1 block text-xs leading-6 text-muted-foreground">운영진 답변 · {item.decision}</span>}</span><span className="text-xs text-muted-foreground">{REQUEST_STATUS[item.status] ?? item.status} · {kstDay(item.created_at)}</span></li>)}</ul> : <p className="mt-4 border-y border-border py-6 text-xs text-muted-foreground">아직 남긴 요청이 없어요.</p>}</section>
    </section>
  );
}

// 교류·약속·결제는 서버 5단계에서 연결한다. 그 전까지는 지금 단계를 안내한다.
export function LiveLaterPage({ title }: { title: string }) {
  const free = title === "결제" && BEFORE_US.beta.active;
  return <Member><section><PageHeader mark={title} label={free ? "베타 기간" : "서로 선택한 뒤에 열려요"} en="FLAVIE" title={free ? "베타 기간에는 결제가 없어요." : `${title} 화면은 두 분이 서로 선택한 뒤에 열려요.`} lead={free ? "소개도, 서로 선택한 뒤의 3일 교류도 무료예요. 베타가 끝나거나 정식 운영으로 바뀌기 7일 전에 사이트와 메일로 알려 드려요." : "소개를 받고 두 분 모두 알아가고 싶다고 답하면, 이곳에서 함께 시작하는 방법을 안내해 드려요."} aside={<TwoDots apart faded />} /><div className="mt-8 flex flex-wrap gap-2"><Button asChild className={`rounded-xl ${interaction}`}><Link to="/today">오늘로 돌아가기 <ArrowRight size={15} /></Link></Button><Button asChild variant="outline" className={`rounded-xl ${interaction}`}><Link to="/us">두 사람 화면</Link></Button></div></section></Member>;
}
