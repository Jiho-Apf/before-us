import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, ArrowUpRight, Bell, Flag, ShieldOff } from "lucide-react";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Textarea } from "./components/ui/textarea";
import { Eyebrow, Moment, PageHeader, QuietNote, Sheet, TwoDots } from "./editorial";
import { NoonClock } from "./PublicHome";
import { AccountPanel } from "./AuthPages";
import { useAuth, useAuthReady } from "./auth-service";
import { kstDateTime, kstDay } from "./dates";
import { APPLICATION_FIELDS } from "./application-model";
import { PHOTO_SLOTS } from "./photo-model";
import { DECLINE_REASONS } from "./introduction-model";
import { REQUEST_LABELS } from "./member-operations-model";
import { SAFETY_COMPOSE_NOTE } from "./message-safety";
import { photoUrl } from "./backend/applications";
import { blockPartner, deleteGreeting, loadGreeting, loadMyRequests, saveGreeting, type Greeting, markNotificationsRead, recordIntroductionView, reportPartner, respondIntroduction, saveNoticeSettings, setNotifyChannels, setPaused, submitMemberRequest, useMemberSnapshot, type LiveIntroduction, type MemberSnapshot } from "./backend/member";

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
  if (!ready) return <Waiting />;
  if (!user) return <section><PageHeader mark="회원" label="로그인이 필요해요" en="MEMBERS ONLY" title="로그인한 뒤에 볼 수 있어요." lead="소개와 교류는 본인만 볼 수 있어요. 로그인하거나 새로 가입해 주세요." /><div className="mt-8 flex flex-wrap gap-2"><Button asChild className={`h-12 rounded-xl px-6 ${interaction}`}><Link to="/login">로그인 <ArrowRight size={16} /></Link></Button><Button asChild variant="outline" className={`h-12 rounded-xl ${interaction}`}><Link to="/signup">회원가입</Link></Button></div></section>;
  return <>{children}</>;
}

// 오늘 할 일을 한 문장으로 정한다.
const kstToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const noonOf = (date: string) => kstDay(`${date}T12:00:00+09:00`);
function todayState(data: MemberSnapshot) {
  const application = data.application, intro = data.introduction, cohort = data.cohort;
  if (data.notices?.status === "suspended") return { label: "이용 정지", title: "지금은 소개를 받을 수 없어요.", action: "문의·요청 남기기", to: "/support", body: `운영진 안내 · ${(data.notices.suspended_reason || "운영 정책에 따라 이용이 잠시 멈췄어요").replace(/[.。\s]+$/, "")}. 다르게 생각되면 문의·요청에서 ‘결정 재검토 요청’을 남겨 주세요.` };
  const waitingForStart = !!cohort && kstToday() < cohort.startsOn && intro.status === "waiting";
  const program = data.program;
  if (program && program.status !== "closed") {
    if (program.status === "choosing") return { label: "함께 정하기", title: "어떻게 시작할지 함께 정해요.", action: "교류 방식 정하기", to: "/exchange", body: `A 편지·B 첫 장면 중 하나와 시작일을 ${kstDateTime(program.agreeBy)}까지 함께 정해 주세요.` };
    if (program.status === "scheduled") return { label: "교류 시작 전", title: `${program.startOn ? kstDay(`${program.startOn}T09:00:00+09:00`) : ""} 09:00에 첫날이 열려요.`, action: "교류 화면 보기", to: "/exchange", body: "시작하면 알림으로 알려 드릴게요." };
    if (program.status === "started") return { label: program.day ? `교류 DAY 0${program.day}` : "교류 중", title: program.ownPlan === "B" ? "오늘의 첫 장면 질문이 열렸어요." : "오늘의 편지를 쓸 시간이에요.", action: "교류 화면으로", to: "/exchange", body: "그날 글은 09:00~23:59에 쓰고, 두 분 모두 보내면 함께 열려요." };
    if (program.status === "deciding") return { label: "DAY 04", title: program.ownMeeting ? "상대의 답을 기다리고 있어요." : "만나고 싶은지 골라 주세요.", action: "만남 선택하기", to: "/exchange", body: `${kstDateTime(program.meetingBy)}까지예요. 상대의 답은 알려 드리지 않아요.` };
    return { label: "약속", title: program.meetingOn ? `${kstDay(`${program.meetingOn}T12:00:00+09:00`)}에 만나기로 했어요.` : "만날 약속을 함께 정해요.", action: "약속 화면으로", to: "/meeting", body: program.meetingOn ? "연락처는 두 분이 동의하면 만나는 날 00:00부터 열려요." : `${kstDateTime(program.arrangeBy)}까지 정해 주세요.` };
  }
  if (intro.status !== "waiting" && (intro.status === "published" || intro.status === "mutual" || intro.status === "expired" || intro.closedAt && Date.now() - Date.parse(intro.closedAt) < 86400000)) {
    if (intro.status === "mutual") return { label: "서로 선택", title: "두 분 모두 알아가고 싶다고 답했어요.", action: "교류 방식 정하기", to: "/exchange", body: "A 편지·B 첫 장면 중 하나와 시작일을 함께 정해요. 상대 프로필은 두 사람 화면에서 다시 볼 수 있어요." };
    if (intro.status === "published" && !intro.ownResponse) return { label: "오늘의 인연", title: "오늘의 인연이 도착했어요.", action: "소개 확인하기", to: "/us", body: `${kstDateTime(intro.dueAt)}까지 답해 주세요. 상대에게는 내 답이 바로 전해지지 않고, 두 분 모두 답한 뒤에 결과만 알려 드려요.` };
    if (intro.status === "published") return { label: "답을 기다리는 중", title: "상대의 답을 기다리고 있어요.", action: "두 사람 화면 보기", to: "/us", body: `${kstDateTime(intro.dueAt)}까지 기다려요. 결과는 이 화면과 알림으로 알려 드릴게요.` };
    return { label: "소개 마무리", title: "이번 소개는 여기서 마무리됐어요.", action: "다음 소개 기다리기", to: null, body: "누가 어떤 답을 했는지는 알려 드리지 않아요. 잘 맞는 분이 준비되면 정오에 다시 소개해 드릴게요." };
  }
  if (!application || application.status === "draft") return { label: "신청 전", title: "소개 신청을 마저 적어 주세요.", action: application ? "이어서 작성하기" : "소개 신청하기", to: "/apply", body: "나에 대해 · 사진 · 원하는 만남 · 공개 확인, 네 단계예요. 단계마다 저장돼요." };
  if (application.status === "needs_changes") return { label: "보완 요청", title: "신청서에 보완할 부분이 있어요.", action: "보완하기", to: "/apply", body: application.decisionNote || "운영진 안내를 확인해 주세요." };
  if (application.status === "submitted" || application.status === "reviewing") return { label: "검토 중", title: "신청서를 확인하고 있어요.", action: "신청서 보기", to: "/apply", body: `운영진이 사진과 내용을 확인하고 있어요. 검토가 끝나면 이 화면에서 알려 드릴게요.${cohort ? ` ${cohort.number}기 첫 소개는 ${noonOf(cohort.startsOn)} 정오예요.` : ""}` };
  if (application.status === "approved" && data.notices?.paused_at) return { label: "잠시 쉬는 중", title: "새 소개를 잠시 쉬고 있어요.", action: "내 정보에서 다시 받기", to: "/profile", body: "쉬는 동안에는 새 소개를 준비하지 않아요. 다시 받기를 누르면 다음 정오부터 다시 준비해요." };
  if (application.status === "approved" && waitingForStart && cohort) return kstToday() === dayBefore(cohort.startsOn)
    ? { label: `${cohort.number}기 · 내일 시작`, title: "내일 정오에 첫 소개가 도착해요.", action: "내 정보 확인하기", to: "/profile", body: "잘 맞는 분을 준비해 두었어요. 내일 정오에 이 화면과 두 사람 화면에서 확인해 주세요." }
    : { label: `${cohort.number}기 · 시작 전`, title: `${cohort.number}기 첫 소개는 ${noonOf(cohort.startsOn)} 정오에 도착해요.`, action: "내 정보 확인하기", to: "/profile", body: "같은 기수의 분들과 함께 첫 소개를 받아요. 시작 전날 한 번 더 알려 드릴게요. 시작 전에는 소개비를 언제든 전액 환불받을 수 있어요." };
  if (application.status === "approved") return { label: "소개 준비", title: "잘 맞는 분을 찾고 있어요.", action: "다음 정오 기다리기", to: null, body: "준비된 날 정오에 하루 최대 한 명을 소개해요. 매일 새 소개를 약속하지는 않아요." };
  return { label: "신청 상태", title: "신청 상태를 확인해 주세요.", action: "신청서 보기", to: "/apply", body: application.decisionNote || "궁금한 점은 문의하기로 남겨 주세요." };
}

export function LiveToday() {
  return <Member><LiveTodayView /></Member>;
}
function LiveTodayView() {
  const { data, error, loading, reload } = useMemberSnapshot();
  const unread = data?.notifications.filter(item => !item.read_at).length ?? 0;
  useEffect(() => { if (unread) { const timer = window.setTimeout(() => void markNotificationsRead(), 3000); return () => window.clearTimeout(timer); } }, [unread]);
  if (loading) return <Waiting />;
  if (error || !data) return <section><p role="alert" className="text-sm text-destructive">{error || "불러오지 못했어요."}</p><Button variant="outline" className="mt-5 rounded-xl" onClick={() => void reload()}>다시 불러오기</Button></section>;
  const state = todayState(data);
  return (
    <section aria-labelledby="today-title">
      <header className="flex flex-wrap items-end justify-between gap-8 border-b border-border pb-8">
        <div className="min-w-0">
          <Eyebrow mark="오늘" label={state.label} en="TODAY, BEFORE US" />
          <h1 id="today-title" className="mt-5 text-3xl font-semibold leading-[1.4] sm:text-[34px]">{state.title}</h1>
          <p className="mt-3 text-xs text-muted-foreground"><time dateTime={today()}>{kstDay(new Date())}</time> · 서울</p>
        </div>
        <NoonClock tone="plain" />
      </header>
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Sheet className="flex flex-col p-6 sm:p-10">
          <p className="text-xs font-semibold text-accent">지금 할 일</p>
          <h2 className="mt-4 text-2xl font-semibold leading-[1.45] sm:text-[28px]">{state.action}</h2>
          <p className="mt-6 max-w-xl text-sm leading-7 text-muted-foreground">{state.body}</p>
          {state.to && <div className="mt-7"><Button asChild className={`h-12 rounded-xl px-6 ${interaction}`}><Link to={state.to}>{state.action} <ArrowUpRight size={17} /></Link></Button></div>}
          <div className="mt-auto pt-10"><QuietNote>한 번에 한 사람, 서두르지 않는 시작.</QuietNote></div>
        </Sheet>
        <aside aria-labelledby="notice-title" className="border-t border-border pt-6 lg:border-t-0 lg:pt-0">
          <h2 id="notice-title" className="flex items-center gap-2 text-sm font-semibold"><Bell size={15} className="text-accent" />알림{unread ? <span className="text-xs font-normal text-accent">새 알림 {unread}</span> : null}</h2>
          {data.notifications.length ? <ul className="mt-4 divide-y divide-border border-y border-border">{data.notifications.map(item => <li key={item.id} className="py-4"><p className={`text-sm ${item.read_at ? "" : "font-semibold"}`}>{item.link ? <Link to={item.link} className="hover:text-primary">{item.title}</Link> : item.title}</p>{item.body && <p className="mt-1 text-xs leading-6 text-muted-foreground">{item.body}</p>}<p className="mt-1 text-[11px] text-muted-foreground">{kstDateTime(item.created_at)}</p></li>)}</ul> : <p className="mt-4 border-y border-border py-6 text-xs leading-6 text-muted-foreground">아직 알림이 없어요. 소개가 준비되면 정오에 여기와 오늘 화면에서 알려 드려요.</p>}
        </aside>
      </div>
      {data.application && data.application.status !== "draft" && data.introduction.status === "waiting" && <div className="mt-10"><FirstWordCard /></div>}
      <section className="mt-14 border-t border-border pt-8" aria-labelledby="status-title">
        <h2 id="status-title" className="mb-5 text-sm font-semibold">지금 알아두면 좋은 것</h2>
        <dl className="grid gap-5 text-xs sm:grid-cols-3"><div><dt className="mb-2 text-muted-foreground">신청 접수</dt><dd>{data.application?.submittedAt ? kstDay(data.application.submittedAt) : "아직 접수 전"}</dd></div><div><dt className="mb-2 text-muted-foreground">최근 소개</dt><dd>{data.introduction.status !== "waiting" && data.introduction.publishedAt ? kstDay(data.introduction.publishedAt) : "아직 없어요"}</dd></div><div><dt className="mb-2 text-muted-foreground">{data.cohort ? "내 기수" : "소개 방식"}</dt><dd>{data.cohort ? `${data.cohort.number}기 · ${noonOf(data.cohort.startsOn)} 정오 시작` : "준비된 날 정오 · 하루 최대 한 명"}</dd></div></dl>
        <div className="mt-6 flex flex-wrap gap-2"><Button asChild variant="outline" className={`h-10 rounded-xl border-border text-xs ${interaction}`}><Link to="/profile">알림 설정·내 정보</Link></Button><Button asChild variant="outline" className={`h-10 rounded-xl border-border text-xs ${interaction}`}><Link to="/support">일시정지·정정 요청</Link></Button><Button asChild variant="outline" className={`h-10 rounded-xl border-border text-xs ${interaction}`}><Link to="/contact">문의하기</Link></Button></div>
      </section>
    </section>
  );
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
  useEffect(() => { void loadGreeting().then(greeting => { setSaved(greeting); setBody(greeting?.body ?? ""); setHome(greeting?.showOnHome ?? false); setLoaded(true); }); }, []);
  const length = Array.from(body.trim()).length;
  const changed = body.trim() !== (saved?.body ?? "") || home !== (saved?.showOnHome ?? false);
  const save = async () => { const { data, error } = await saveGreeting(body, home); if (error || !data) { setMessage(error || "저장하지 못했어요."); return; } setSaved({ body: data.body, showOnHome: data.showOnHome, homeStatus: data.homeStatus, homeReason: null }); setBody(data.body); setMessage(data.homeStatus === "pending" ? "저장했어요. 홈 공개는 운영진이 확인한 뒤에 보여요." : "저장했어요."); };
  const remove = async () => { const { error } = await deleteGreeting(); if (error) { setMessage(error); return; } setSaved(null); setBody(""); setHome(false); setMessage("첫 마디를 지웠어요."); };
  if (!loaded) return null;
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
// 두 사람: 지금의 소개(열람 기간 안에서만 상대 프로필이 보인다)
const labelOf = (id: string) => id === "self.age" ? "만 나이" : APPLICATION_FIELDS.find(field => field.id === id)?.label ?? id;
const valueOf = (value: string | string[]) => Array.isArray(value) ? value.join(" · ") : value;

function PartnerPhoto({ path, label }: { path: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let alive = true; void photoUrl(path).then(next => { if (alive) setUrl(next); }); return () => { alive = false; }; }, [path]);
  return <figure className="aspect-[4/5] overflow-hidden border border-border bg-muted">{url ? <img src={url} alt={label} className="h-full w-full object-cover" draggable={false} onContextMenu={event => event.preventDefault()} /> : <span className="sr-only">{label} 불러오는 중</span>}</figure>;
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
  const [urgent, setUrgent] = useState(false);
  useEffect(() => { if (data) setIntro(data.introduction); }, [data]);
  useEffect(() => { if (intro && intro.status !== "waiting" && intro.profile && !intro.opened) void recordIntroductionView(intro.id).then(() => setIntro(current => current && current.status !== "waiting" ? { ...current, opened: true } : current)); }, [intro?.status !== "waiting" && intro?.id]);
  if (loading || (!intro && !error)) return <Waiting />;
  if (error || !intro) return <section><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" className="mt-5 rounded-xl" onClick={() => void reload()}>다시 불러오기</Button></section>;
  if (intro.status === "waiting" || !intro.profile) return (
    <section>
      <PageHeader mark="두 사람" label={intro.status === "waiting" ? "소개 전" : "소개 마무리"} en="TWO OF US" title={intro.status === "waiting" ? "아직 소개된 분이 없어요." : "이번 소개는 여기서 마무리됐어요."} lead={intro.status === "waiting" ? "신청서 확인이 끝나고 잘 맞는 분이 준비되면, 정오에 이곳에서 소개해 드릴게요." : "끝난 소개의 프로필은 다시 볼 수 없어요. 누가 어떤 답을 했는지도 알려 드리지 않아요."} aside={<TwoDots apart faded />} />
      <div className="mt-8"><Button asChild variant="outline" className={`rounded-xl ${interaction}`}><Link to="/today">오늘로 돌아가기 <ArrowRight size={15} /></Link></Button></div>
    </section>
  );
  const name = intro.profile.items.find(item => item.id === "self.name");
  const respond = async () => {
    if (!choice) return;
    const result = await respondIntroduction(intro.id, choice, choice === "negative" ? reason : null);
    if (result.error || !result.data) { setMessage(result.error || "답을 저장하지 못했어요."); return; }
    setIntro(result.data); setMessage("");
  };
  const submitSafety = async () => {
    if (safety === "block") { const result = await blockPartner(intro.id); if (result.error) { setMessage(result.error); return; } setSafety(null); await reload(); return; }
    const result = await reportPartner(intro.id, "회원 신고", reportText, urgent);
    setMessage(result.error || "신고를 받았어요. 운영진이 가장 먼저 확인해요. 상대에게는 신고 사실을 알리지 않아요.");
    if (!result.error) { setSafety(null); setReportText(""); }
  };
  return (
    <section aria-labelledby="us-title">
      {intro.status === "mutual" && <div className="mb-10"><Moment eyebrow="WE BOTH SAID YES" title="두 분 모두 알아가고 싶다고 답했어요." action={<Button asChild className="h-11 rounded-xl px-6"><Link to="/exchange">함께 시작하는 방법 정하기 <ArrowRight size={14} /></Link></Button>}>3일 교류 방식(A 편지 · B 첫 장면)과 시작일을 함께 정해요.</Moment></div>}
      <PageHeader mark="두 사람" label={intro.status === "mutual" ? "서로 선택" : "오늘의 인연"} en="TWO OF US" titleId="us-title" title={name ? `${valueOf(name.value)} 님을 소개해요.` : "오늘의 인연을 소개해요."} lead={intro.status === "published" ? `${kstDateTime(intro.dueAt)}까지 답해 주세요.` : undefined} aside={<TwoDots apart={intro.status !== "mutual"} />} />
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{intro.profile.photos.map(photo => <PartnerPhoto key={photo.path} path={photo.path} label={PHOTO_SLOTS.find(slot => slot.id === photo.slot)?.label ?? "사진"} />)}</div>
          {intro.profile.greeting && <figure className="border-l-2 border-primary pl-5"><blockquote className="text-lg font-semibold leading-[1.6]">“{intro.profile.greeting}”</blockquote><figcaption className="mt-2 text-xs text-muted-foreground">{name ? `${valueOf(name.value)} 님의 첫 마디` : "첫 마디"}</figcaption></figure>}
          {intro.note && <Sheet tone="soft" className="p-6"><p className="text-xs font-semibold text-accent">운영진이 두 분을 소개한 이유</p><p className="mt-3 text-sm leading-7">{intro.note}</p></Sheet>}
          <dl className="divide-y divide-border border-y border-border">{intro.profile.items.filter(item => item.id !== "self.name").map(item => <div key={item.id} className="grid gap-1 py-4 sm:grid-cols-[140px_1fr]"><dt className="text-xs text-muted-foreground">{labelOf(item.id)}</dt><dd className="whitespace-pre-wrap break-words text-sm leading-7">{valueOf(item.value)}</dd></div>)}</dl>
          <p className="text-xs leading-6 text-muted-foreground">프로필과 사진은 응답 기한까지만 볼 수 있어요. 캡처하거나 다른 곳에 옮기지 말아 주세요.</p>
        </div>
        <div className="space-y-6">
          <Sheet className="p-6 sm:p-8">
            <p className="text-xs font-semibold text-accent">나의 답</p>
            {intro.ownResponse ? <><h2 className="mt-4 text-xl font-semibold">{intro.ownResponse === "positive" ? "알아가고 싶다고 답했어요." : "이번에는 넘기겠다고 답했어요."}</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">{intro.status === "mutual" ? "두 분 모두 알아가고 싶다고 답했어요." : intro.status === "published" ? "상대의 답을 기다리고 있어요. 답은 바꿀 수 없어요." : "이번 소개는 마무리됐어요."}</p></> : intro.status === "published" ? <>
              <h2 className="mt-4 text-xl font-semibold">이 분을 더 알아가고 싶나요?</h2>
              <div className="mt-5 grid gap-2">{([["positive", "알아가고 싶어요"], ["negative", "이번엔 넘길게요"]] as const).map(([value, label]) => <Button key={value} variant="outline" aria-pressed={choice === value} onClick={() => { setChoice(value); setReason(null); }} className={`h-12 justify-start rounded-xl ${choice === value ? "border-primary bg-primary/5 text-primary" : "border-border"} ${interaction}`}>{label}</Button>)}</div>
              {choice === "negative" && <div className="mt-5"><p className="text-xs leading-6 text-muted-foreground">이유를 골라 주시면 다음 소개에 참고해요(선택). 상대에게는 절대 보이지 않아요.</p><div className="mt-3 flex flex-wrap gap-2">{DECLINE_REASONS.map(item => <button key={item} type="button" aria-pressed={reason === item} onClick={() => setReason(value => value === item ? null : item)} className={`rounded-full border px-3 py-1.5 text-xs ${reason === item ? "border-primary bg-primary/5 text-primary" : "border-border"} ${interaction}`}>{item}</button>)}</div></div>}
              <Button disabled={!choice} onClick={() => void respond()} className={`mt-6 h-12 w-full rounded-xl ${interaction}`}>답 보내기 <ArrowRight size={15} /></Button>
              <p className="mt-3 text-[11px] leading-5 text-muted-foreground">보낸 답은 바꿀 수 없어요. 두 분 모두 답한 뒤에 결과만 알려 드려요.</p>
            </> : <p className="mt-4 text-sm leading-7 text-muted-foreground">응답 기한이 지났어요.</p>}
          </Sheet>
          <div className="space-y-3 border-t border-border pt-5">
            <p className="text-xs leading-6 text-muted-foreground">{SAFETY_COMPOSE_NOTE}</p>
            <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setSafety(value => value === "report" ? null : "report")} aria-expanded={safety === "report"} className={`h-9 rounded-xl text-xs text-muted-foreground ${interaction}`}><Flag size={13} />신고하기</Button><Button variant="ghost" onClick={() => setSafety(value => value === "block" ? null : "block")} aria-expanded={safety === "block"} className={`h-9 rounded-xl text-xs text-muted-foreground ${interaction}`}><ShieldOff size={13} />차단하기</Button></div>
            {safety === "report" && <div className="space-y-3 rounded-xl border border-border p-4"><Textarea aria-label="신고 내용" value={reportText} maxLength={1000} onChange={event => setReportText(event.target.value)} placeholder="어떤 일이 있었는지 적어 주세요. 캡처 등 증빙은 지우지 말고 보관해 주세요." className="min-h-24 rounded-xl" /><label className="flex items-center gap-2 text-xs"><Checkbox checked={urgent} onCheckedChange={value => setUrgent(value === true)} />돈 요구·협박 등 급한 일이에요</label><Button size="sm" onClick={() => void submitSafety()} className="rounded-xl">신고 보내기</Button><p className="text-[11px] text-muted-foreground">위급하면 112에 먼저 연락해 주세요.</p></div>}
            {safety === "block" && <div className="space-y-3 rounded-xl border border-border p-4"><p className="text-xs leading-6">차단하면 이 소개가 바로 끝나고, 다시는 서로 소개되지 않아요. 이유는 묻지 않아요.</p><Button size="sm" variant="outline" onClick={() => void submitSafety()} className="rounded-xl border-destructive/40 text-destructive">차단하기</Button></div>}
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
function LiveProfileView() {
  const { data, loading, reload } = useMemberSnapshot();
  const [message, setMessage] = useState("");
  const [pauseMessage, setPauseMessage] = useState("");
  const [pausing, setPausing] = useState(false);
  if (loading) return <Waiting />;
  const notices = data?.notices;
  const toggle = async (key: "notice_daily_waiting" | "marketing_opt_in", value: boolean) => { const result = await saveNoticeSettings({ [key]: value }); setMessage(result.error || "저장했어요."); await reload(); };
  const channels = { kakao: !!notices?.notify_kakao, sms: !!notices?.notify_sms, email: !!notices?.notify_email };
  const channelText = [channels.kakao && "카카오톡", channels.sms && "문자", channels.email && "메일"].filter(Boolean).join(" · ");
  const setChannel = async (key: keyof typeof channels, value: boolean) => { const next = { ...channels, [key]: value }; const result = await setNotifyChannels(next.kakao, next.sms, next.email); setMessage(result.error || "알림 받을 방법을 바꿨어요."); await reload(); };
  const paused = !!notices?.paused_at;
  const togglePause = async () => { setPausing(true); const result = await setPaused(!paused); setPausing(false); setPauseMessage(result.error || (paused ? "다시 받기로 바꿨어요. 다음 정오부터 소개를 준비해요." : "새 소개를 잠시 쉬어요. 진행 중인 소개는 그대로 이어져요.")); await reload(); };
  return (
    <section className="space-y-10">
      <PageHeader mark="내 정보" label="계정과 신청" en="ABOUT ME" title="내 정보" lead="지금 어디쯤인지, 다음에 무엇을 하면 되는지 먼저 보여 드려요." />
      {/* 한눈에 보는 요약(데모 내 정보와 같은 모양) */}
      <div className="relative overflow-hidden rounded-3xl border border-lilac bg-mist p-6 sm:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_18%,transparent),transparent)]" />
        <div className="relative grid gap-3 sm:grid-cols-3">
          {[
            { label: "신청 상태", value: data?.application ? ({ draft: "작성 중", submitted: "접수 완료", reviewing: "검토 중", needs_changes: "보완 요청", approved: "소개 준비", held: "보류", withdrawn: "철회", rejected: "소개 어려움" } as Record<string, string>)[data.application.status] : "신청 전", sub: data?.application?.submittedAt ? `${kstDay(data.application.submittedAt)} 접수` : "신청은 무료예요" },
            { label: "내 기수", value: data?.cohort ? `${data.cohort.number}기 · D-${Math.max(0, Math.round((Date.parse(`${data.cohort.startsOn}T12:00:00+09:00`) - Date.now()) / 86400000))}` : "신청 뒤 정해져요", sub: data?.cohort ? `${noonOf(data.cohort.startsOn)} 정오 첫 소개` : "매달 마지막 날 정오 시작" },
            { label: "알림", value: paused ? "새 소개 쉬는 중" : notices?.notice_daily_waiting ? "소개 없는 날도 알림" : "새 소개만 알림", sub: channelText ? `사이트 · ${channelText}` : "사이트 안 알림" },
          ].map(item => <div key={item.label} className="rounded-2xl bg-card/90 p-5 shadow-[0_18px_36px_-30px_color-mix(in_oklch,var(--primary)_60%,transparent)]"><p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{item.label}</p><p className="mt-2 text-lg font-semibold text-ink">{item.value}</p><p className="mt-1 text-xs text-muted-foreground">{item.sub}</p></div>)}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Sheet className="p-6"><p className="text-xs font-semibold text-accent">소개 신청서 고치기</p><p className="mt-3 text-sm leading-7 text-muted-foreground">{!data?.application || data.application.status === "draft" ? "쓰던 곳부터 이어서 쓸 수 있어요." : data.application.status === "submitted" ? "검토 전이라 바로 고칠 수 있어요." : "고치면 운영진이 다시 확인해요. 그동안 새 소개 준비는 잠시 멈춰요."}</p><div className="mt-4 grid grid-cols-2 gap-2">{[["나에 대해", 0], ["사진", 1], ["원하는 만남", 2], ["공개·동의", 3]].map(([label, step]) => <Button key={label} asChild variant="outline" className={`h-auto justify-between rounded-xl border-border px-4 py-3 text-xs ${interaction}`}><Link to={`/apply?edit=1&step=${step}`}>{label} <ArrowUpRight size={13} /></Link></Button>)}</div></Sheet>
        <Sheet className="p-6"><p className="text-xs font-semibold text-accent">알림 설정</p><div className="mt-4 space-y-3 text-sm"><label className="flex items-start gap-3 leading-6"><Checkbox className="mt-1" checked={!!notices?.notice_daily_waiting} onCheckedChange={value => void toggle("notice_daily_waiting", value === true)} />소개가 없는 날에도 정오에 알려 주세요. <span className="text-muted-foreground">(선택)</span></label><label className="flex items-start gap-3 leading-6"><Checkbox className="mt-1" checked={!!notices?.marketing_opt_in} onCheckedChange={value => void toggle("marketing_opt_in", value === true)} />새 소식과 혜택 안내를 받을게요. <span className="text-muted-foreground">(선택 · 광고성 정보)</span></label></div><fieldset className="mt-5 border-t border-border pt-4"><legend className="sr-only">알림 받을 방법</legend><p className="text-xs font-semibold">알림 받을 방법 <span className="font-normal text-muted-foreground">· 카카오톡·문자 중 1개 이상</span></p><div className="mt-3 flex flex-wrap gap-2">{([["kakao", "카카오톡"], ["sms", "문자"], ["email", "메일"]] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={channels[key]} onClick={() => void setChannel(key, !channels[key])} className={`rounded-full border px-4 py-2 text-xs ${interaction} ${channels[key] ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"}`}>{label}</button>)}</div></fieldset><p className="mt-4 text-[11px] leading-5 text-muted-foreground">새 소개 알림은 사이트 안에서 늘 보여 드리고, 메일을 고르면 가입한 주소로도 보내 드려요. 카카오톡·문자는 정식 운영부터 보내요.</p>{message && <p role="status" className="mt-3 text-xs text-primary">{message}</p>}</Sheet>
      </div>
      {data?.application?.status === "approved" && notices?.status === "active" && <Sheet className="flex flex-wrap items-center justify-between gap-5 p-6"><div className="min-w-0 max-w-xl"><p className="text-xs font-semibold text-accent">새 소개 {paused ? "다시 받기" : "잠시 쉬기"}</p><p className="mt-3 text-sm leading-7 text-muted-foreground">{paused ? `${kstDay(notices.paused_at!)}부터 쉬고 있어요. 다시 받기를 누르면 다음 정오부터 소개를 준비해요.` : "여행·바쁜 시기처럼 잠시 쉬고 싶을 때 눌러 주세요. 진행 중인 소개는 그대로 이어지고, 새 소개만 멈춰요."}</p>{pauseMessage && <p role="status" className="mt-2 text-xs text-primary">{pauseMessage}</p>}</div><Button variant={paused ? "default" : "outline"} disabled={pausing} onClick={() => void togglePause()} className="h-11 shrink-0 rounded-xl border-border px-5">{paused ? "다시 받기" : "잠시 쉬기"}</Button></Sheet>}
      <FirstWordCard />
      <AccountPanel />
    </section>
  );
}

// ─────────────────────────────────────────────
// 문의·요청: 개인정보 권리(정정·삭제·처리정지)와 일시정지 같은 요청
// 일시정지·다시 받기는 내 정보에서 바로 바꾼다.
const REQUEST_KINDS = ["correction", "deletion", "restriction", "reconsider", "refund"] as const;
const REQUEST_STATUS: Record<string, string> = { requested: "접수", protection: "보호 조치", checking: "확인 중", decided: "처리 완료", reconsidering: "다시 확인 중" };
export function LiveSupportPage() {
  return <Member><LiveSupportView /></Member>;
}
function LiveSupportView() {
  const [kind, setKind] = useState<(typeof REQUEST_KINDS)[number] | null>(null);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [list, setList] = useState<Awaited<ReturnType<typeof loadMyRequests>>>([]);
  const refresh = async () => setList(await loadMyRequests());
  useEffect(() => { void refresh(); }, []);
  const submit = async () => { if (!kind) return; const result = await submitMemberRequest(kind, text); setMessage(result.error || "요청을 받았어요. 처리 결과는 이 화면에서 볼 수 있어요."); if (!result.error) { setKind(null); setText(""); await refresh(); } };
  return (
    <section className="space-y-10">
      <PageHeader mark="요청" label="문의·요청" en="SUPPORT" title="필요한 요청을 남겨 주세요." lead="상대와 관련된 신고는 두 사람 화면에서 하면 그 소개에 바로 연결돼요. 위급하면 112에 먼저 연락해 주세요." />
      <Sheet className="p-6 sm:p-8">
        <p className="text-xs font-semibold text-accent">요청 종류</p>
        <div className="mt-4 flex flex-wrap gap-2">{REQUEST_KINDS.map(item => <button key={item} type="button" aria-pressed={kind === item} onClick={() => setKind(item)} className={`rounded-full border px-4 py-2 text-xs ${kind === item ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/50"} ${interaction}`}>{REQUEST_LABELS[item]}</button>)}</div>
        <Textarea aria-label="요청 내용" value={text} maxLength={1000} onChange={event => setText(event.target.value)} placeholder="필요한 내용을 적어 주세요. 주민등록번호·카드번호는 적지 말아 주세요." className="mt-5 min-h-28 rounded-xl" />
        <Button disabled={!kind} onClick={() => void submit()} className={`mt-4 h-11 rounded-xl px-6 ${interaction}`}>요청 보내기</Button>
        {message && <p role="status" className="mt-4 rounded-xl bg-muted p-3 text-xs leading-6">{message}</p>}
        <p className="mt-5 text-[11px] leading-5 text-muted-foreground">탈퇴는 내 정보 아래쪽 계정에서 할 수 있어요. 그 밖의 문의는 <Link to="/contact" className="underline underline-offset-4">문의하기</Link>로 남겨 주세요.</p>
      </Sheet>
      <section aria-labelledby="requests-title"><h2 id="requests-title" className="text-sm font-semibold">내가 남긴 요청</h2>{list.length ? <ul className="mt-4 divide-y divide-border border-y border-border">{list.map(item => <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-4 text-sm"><span><span className="font-semibold">{REQUEST_LABELS[item.kind as keyof typeof REQUEST_LABELS] ?? item.kind}</span>{item.decision && <span className="mt-1 block text-xs leading-6 text-muted-foreground">운영진 답변 · {item.decision}</span>}</span><span className="text-xs text-muted-foreground">{REQUEST_STATUS[item.status] ?? item.status} · {kstDay(item.created_at)}</span></li>)}</ul> : <p className="mt-4 border-y border-border py-6 text-xs text-muted-foreground">아직 남긴 요청이 없어요.</p>}</section>
    </section>
  );
}

// 교류·약속·결제는 서버 5단계에서 연결한다. 그 전까지는 지금 단계를 안내한다.
export function LiveLaterPage({ title }: { title: string }) {
  return <Member><section><PageHeader mark={title} label="서로 선택한 뒤에 열려요" en="BEFORE US" title={`${title} 화면은 두 분이 서로 선택한 뒤에 열려요.`} lead="소개를 받고 두 분 모두 알아가고 싶다고 답하면, 이곳에서 함께 시작하는 방법을 안내해 드려요." aside={<TwoDots apart faded />} /><div className="mt-8 flex flex-wrap gap-2"><Button asChild className={`rounded-xl ${interaction}`}><Link to="/today">오늘로 돌아가기 <ArrowRight size={15} /></Link></Button><Button asChild variant="outline" className={`rounded-xl ${interaction}`}><Link to="/us">두 사람 화면</Link></Button></div></section></Member>;
}
