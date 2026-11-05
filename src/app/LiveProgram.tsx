import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { ArrowRight, BookOpen, CalendarPlus, Check, ChevronDown, Highlighter, ImagePlus, Loader2, LockOpen, PenLine, Printer, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Eyebrow, Moment, NoteList, PageHeader, QuietNote, Sheet } from "./editorial";
import { Member, Waiting } from "./LiveMember";
import { kstDateTime, kstDay } from "./dates";
import { SAFETY_COMPOSE_NOTE } from "./message-safety";
import { APPOINTMENT_ACTIVITIES, QUICK_TIMES } from "./appointment-details";
import { COMMENT_MAX, CUSTOM, END_REASON, PIECE_MAX, PIECE_MIN, PLAN_COPY, SCENE_ACTIVITY_LABEL, SCENE_ACTIVITY_ROWS, SCENE_CUSTOM_MAX, SCENE_PROMPTS, SCENE_REASON_MAX, SCENE_STAY, SCENE_TOPIC_EXAMPLES, SCENE_TOPIC_MAX, AVAIL_BANDS, ASK_IDEAS, ASK_MAX, ASK_MIN, POSTCARD_MAX, POSTCARD_MIN, acceptAppointment, setBookConsent, setBookmark, setDay3Question, availLabel, bookSlot, chooseFirstScene, quickStart, setAvailability, chooseMeeting, choosePlan, confirmProgram, contactProblem, customOk, isCustom, leaveComment, letterPrompt, loadMyProgram, loadReadablePrograms, proposeAppointment, proposeStart, sceneAppointment, sceneLabel, sceneNote, setContactConsent, stayFor, submitEntry, tidyChoice, writeScenePiece, type EntryContent, type Program, type ProgramEntry, type ReadableProgram, type ScenePick, type Slot } from "./backend/program";
import { forgetLetterPhoto, letterPhotoResult, removeLetterPhoto, uploadLetterPhoto } from "./backend/letterPhotos";
import { clearDrafts, readDraft, writeDraft } from "./backend/drafts";
import { Segments } from "./Segments";

// 실제 서버 모드의 교류(/exchange)와 약속·연락처(/meeting). 데모 화면과 같은 편집 톤을 쓴다.
const interaction = "transition-colors duration-200 motion-reduce:transition-none";
const choice = (active: boolean) => `rounded-2xl border p-5 text-left ${interaction} ${active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`;
const butter = "rounded-full bg-[#F8E5A6] px-3.5 py-1.5 text-xs font-semibold text-[#5A4310]";
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const dayLabel = (date: string) => kstDay(`${date}T12:00:00+09:00`);
const kstAt = (date: string, time: string) => Date.parse(`${date}T${time}:00+09:00`);
const DAY_NAME = ["첫째 날", "둘째 날", "셋째 날", "넷째 날"];
const planName = (plan: "A" | "B") => PLAN_COPY[plan].name.replace(". ", " ");
// 한국 시간 기준 지금 몇 시인지·오늘 자정까지 남은 시간
const kstHour = () => new Date(Date.now() + 9 * 3600000).getUTCHours();
const untilMidnight = () => { const kst = new Date(Date.now() + 9 * 3600000); const left = 86400000 - ((kst.getUTCHours() * 60 + kst.getUTCMinutes()) * 60000); return `${Math.floor(left / 3600000)}시간 ${Math.floor((left % 3600000) / 60000)}분`; };

// 다음 00:00:30 또는 09:00:30(한국 시간)까지 남은 시간
function untilProgramBoundary(now = Date.now()) {
  const kst = new Date(now + 9 * 3600000);
  const base = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600000;
  const marks = [30, 9 * 3600 + 30].map(seconds => base + seconds * 1000);
  const next = marks.find(at => at > now + 1000) ?? marks[0] + 86400000;
  return next - now;
}
// 상대의 움직임을 짧게 알려 준다(내용은 보여 주지 않고 무엇이 바뀌었는지만).
function arrivalNote(before: Program, after: Program): string {
  if (before.id !== after.id) return "";
  if (before.status !== after.status) return "교류 상태가 바뀌었어요. 화면을 새로 맞췄어요.";
  for (const entry of after.entries) {
    const old = before.entries.find(item => item.day === entry.day && item.kind === entry.kind);
    if (entry.partner && !old?.partner) return entry.kind === "reply" ? "상대의 답장이 도착해 함께 열렸어요." : "상대의 글이 도착해 함께 열렸어요.";
    if (entry.partnerSent && !old?.partnerSent) return "상대가 오늘의 글을 보냈어요. 내 글을 보내면 함께 열려요.";
  }
  if ((after.meetingRev ?? 0) !== (before.meetingRev ?? 0)) return "약속이 바뀌었어요. 새 날짜와 장소를 확인해 주세요.";
  if (after.proposals.length !== before.proposals.length || after.proposals.some(item => before.proposals.find(old => old.id === item.id)?.status !== item.status)) return "약속 제안이 새로 도착했어요.";
  if (!!after.bookOpen !== !!before.bookOpen) return after.bookOpen ? "두 분 모두 동의해서 한 권이 열렸어요." : "한 권 동의가 거둬져 닫혔어요.";
  // 시작 방식(검수 T05·U07): 상대가 고르거나 바꾸거나 확인을 거두면 그대로 알린다. 저절로 맞추지 않는다.
  if (before.partnerPlan && after.partnerPlan && before.partnerPlan !== after.partnerPlan) return `상대가 방식을 ${planName(after.partnerPlan)}로 바꿨어요. 어느 쪽으로 할지 다시 확인해 주세요.`;
  if (!before.partnerPlan && after.partnerPlan) return after.ownPlan && after.ownPlan !== after.partnerPlan ? `상대는 ${planName(after.partnerPlan)}를 골랐어요. 두 분의 선택이 달라요.` : `상대가 ${planName(after.partnerPlan)}를 골랐어요.`;
  if (before.startOn !== after.startOn && after.startOn) return `시작일이 ${dayLabel(after.startOn)}로 바뀌었어요. 바뀐 날짜만 다시 확인해 주세요.`;
  if (before.partnerConfirmed && !after.partnerConfirmed) return "상대의 시작 확인이 풀렸어요. 바뀐 내용을 다시 확인해 주세요.";
  if (!before.partnerConfirmed && after.partnerConfirmed) return "상대가 시작 일정을 확인했어요.";
  if (!!after.partnerReady !== !!before.partnerReady) return after.partnerReady ? "상대가 ‘이대로 시작’을 눌렀어요." : "상대가 ‘이대로 시작’을 거뒀어요.";
  return "";
}
// 서버가 ‘바뀌었어요’로 거부하면(약속·시작일이 그 사이 바뀜) 바로 새로 불러온다.
const CHANGED = /바뀌었어요|새로 고친 뒤/;
const LIVE_REFRESH_MS = 20000;
const MAX_REFRESH_MS = 160000;
const LOAD_TIMEOUT_MS = 30000;
// 다음 조용한 새로 고침까지: 실패가 이어지면 두 배씩(최대 160초) 늘리고, 여러 화면이 한꺼번에 묻지 않게 ±20% 흔든다.
const nextRefresh = (failures: number) => Math.min(LIVE_REFRESH_MS * 2 ** failures, MAX_REFRESH_MS) * (0.8 + Math.random() * 0.4);
type Loaded = { data: Program | null; error: string | null };
const SLOW_LOAD = "교류를 불러오는 데 시간이 오래 걸려요. 잠시 뒤 다시 시도해 주세요.";
const loadWithin = (ms: number): Promise<Loaded> => { let timer = 0; return Promise.race([loadMyProgram(), new Promise<Loaded>(resolve => { timer = window.setTimeout(() => resolve({ data: null, error: SLOW_LOAD }), ms); })]).finally(() => window.clearTimeout(timer)); };
function useProgram() {
  const [state, setState] = useState<{ data: Program | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [arrival, setArrival] = useState("");
  // 늦게 끝난 이전 요청이 새 결과를 덮지 않게 차례 번호를 붙인다(검수 C8).
  const sequence = useRef(0);
  const latest = useRef<Program | null>(null);
  const latestKey = useRef<string | null>(null);
  const pending = useRef(0);
  const failures = useRef(0);
  const apply = (data: Program | null, error: string | null, quiet = false) => {
    const before = latest.current;
    if (quiet && error) return; // 조용한 새로 고침이 실패하면 지금 화면을 그대로 둔다
    // 바뀐 것이 없으면 다시 그리지 않는다(검수 T05): 쓰던 글·커서·포커스·스크롤·사진 주소가 그대로 남는다.
    const key = JSON.stringify(data);
    if (quiet && key === latestKey.current) return;
    if (quiet && before && data) { const note = arrivalNote(before, data); if (note) setArrival(note); }
    latest.current = data;
    latestKey.current = key;
    setState({ data, error, loading: false });
  };
  // 조용한 새로 고침은 앞 요청이 끝나기 전에는 겹쳐 보내지 않는다(25초 넘게 걸리는 응답이 쌓이지 않게). 30초가 지나면 실패로 본다.
  // 늦게 끝난 이전 요청은 차례 번호로 버린다(검수 C8).
  const reload = async (quiet = false): Promise<"ok" | "error" | "skipped"> => {
    if (quiet && pending.current > 0) return "skipped";
    const mine = ++sequence.current;
    pending.current += 1;
    let result: Loaded;
    try { result = await loadWithin(LOAD_TIMEOUT_MS); } finally { pending.current -= 1; }
    if (mine !== sequence.current) return "skipped";
    apply(result.data, result.error, quiet);
    return result.error ? "error" : "ok";
  };
  useEffect(() => { void reload(); }, []);
  // 시각이 바뀌는 때(00:00 그날 글 마감 · 09:00 새 날·만남 선택 열림), 1분 넘게 다른 창에 있다가 돌아왔을 때,
  // 그리고 화면이 보이는 동안 20초마다 조용히 다시 불러온다(상대가 보낸 글·동의·약속 변경이 먼저 기다리던 화면에도 도착하게).
  // 쓰던 글은 입력 칸과 임시 저장에 그대로 남는다.
  // 화면이 숨어 있거나 오프라인이면 묻지 않고 쉰다. 다시 보이면(20초 넘게 숨어 있었으면) · 연결이 돌아오면 바로 한 번 묻는다.
  useEffect(() => {
    let hiddenAt = 0, timer = 0, poll = 0, stopped = false;
    const tick = async () => {
      if (document.visibilityState === "visible" && navigator.onLine !== false && !sending.current) {
        const outcome = await reload(true);
        if (outcome === "error") failures.current += 1; else if (outcome === "ok") failures.current = 0;
      }
      if (!stopped) poll = window.setTimeout(() => void tick(), nextRefresh(failures.current));
    };
    poll = window.setTimeout(() => void tick(), nextRefresh(0));
    const onVisible = () => { if (document.visibilityState === "hidden") hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > LIVE_REFRESH_MS) { hiddenAt = 0; void reload(true); } };
    const onOnline = () => { failures.current = 0; void reload(true); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    const schedule = () => { timer = window.setTimeout(() => { void reload(true); schedule(); }, untilProgramBoundary()); };
    schedule();
    return () => { stopped = true; document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", onOnline); window.clearTimeout(timer); window.clearTimeout(poll); };
  }, []);
  // 서버 함수는 고친 뒤의 교류를 그대로 돌려준다. 실패하면 안내만 바꾼다.
  // 보내는 중에 다시 누르면 무시한다(두 번 눌러도 한 번만 보내지게). 성공 여부도 함께 돌려준다.
  const sending = useRef(false);
  const run = async (action: () => Promise<{ data: Program | null; error: string | null }>, done = ""): Promise<{ text: string; ok: boolean } | null> => {
    if (sending.current) return null;
    sending.current = true;
    try {
      const result = await action();
      if (result.error) { if (CHANGED.test(result.error)) await reload(); return { text: result.error, ok: false }; }
      if (result.data) { sequence.current += 1; apply(result.data, null); failures.current = 0; }
      setArrival("");
      return { text: result.data?.notice || done, ok: true };
    } finally {
      sending.current = false;
    }
  };
  return { ...state, reload, run, arrival };
}

function Notice({ text }: { text: string }) {
  return text ? <p role="status" aria-live="polite" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-7">{text}</p> : null;
}

function NotYet({ title }: { title: string }) {
  return <section className="space-y-8"><PageHeader mark={title} label="서로 선택한 뒤에 열려요" en="FLAVIE" title={`${title} 화면은 두 분이 서로 선택한 뒤에 열려요.`} lead="소개를 받고 두 분 모두 알아가고 싶다고 답하면, 이곳에서 함께 시작하는 방법을 정해요." /><Button asChild variant="outline" className="h-11 rounded-xl border-border"><Link to="/today">오늘 화면으로 <ArrowRight size={14} /></Link></Button></section>;
}

// 차단·탈퇴·이용 정지로 끝난 교류: 이 화면은 누가 끝냈는지 모르므로(차단한 본인도 볼 수 있다) 어느 쪽에도 맞는 말로 안내한다.
const PARTY_ENDED = ["blocked", "withdrawn", "suspended"];
function Closed({ program, reread = false }: { program: Program; reread?: boolean }) {
  const done = program.endReason === "completed";
  return <Moment eyebrow={done ? "THANK YOU" : "SEE YOU AGAIN"} title={done ? "약속한 날이 지나, 이번 교류를 마무리했어요." : "이번 교류는 여기서 마무리됐어요."} action={<div className="flex flex-wrap gap-2"><Button asChild className="h-11 rounded-full px-6"><Link to="/today">오늘 화면으로</Link></Button>{reread && program.entries.length > 0 && <Button asChild variant="outline" className="h-11 rounded-full border-border px-5 hover:bg-muted hover:text-foreground"><Link to="/exchange">주고받은 글 다시 읽기</Link></Button>}<Button asChild variant="outline" className="h-11 rounded-full border-border px-5 hover:bg-muted hover:text-foreground"><Link to="/us">불편한 일 신고하기</Link></Button></div>}>{PARTY_ENDED.includes(program.endReason ?? "") ? "더 이어 가기 어려운 사정이 생겨 교류를 마무리했어요. 다음 소개가 준비되면 정오에 알려 드릴게요." : done ? "불편한 일이 있었다면 두 사람 화면에서 신고해 주세요. 다음 소개가 준비되면 정오에 알려 드릴게요." : END_REASON[program.endReason ?? ""] ?? "다음 소개가 준비되면 정오에 알려 드릴게요."}</Moment>;
}

// ─────────────────────────────────────────────
// 교류: 합의 → 3일 → 만남 선택
export function LiveExchangePage() {
  return <Member><ExchangeView /></Member>;
}
function ExchangeView() {
  const { data, error, loading, reload, run, arrival } = useProgram();
  const [message, setMessage] = useState("");
  // 마무리된 교류의 쓰다 만 글은 이 기기에서 지운다(검수 C10).
  useEffect(() => { if (data?.status === "closed") clearDrafts({ programId: data.id }); }, [data?.id, data?.status]);
  // 지난 교류: 새 교류가 시작돼도, 다시 읽을 수 있는 마무리된 교류는 따로 불러 둔다(실패하면 조용히 숨긴다).
  const [past, setPast] = useState<ReadableProgram[]>([]);
  useEffect(() => { void loadReadablePrograms().then(result => setPast(result.data ?? [])); }, []);
  if (loading) return <Waiting />;
  if (error) return <section><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" className="mt-5 rounded-xl" onClick={() => void reload()}>다시 불러오기</Button></section>;
  if (!data) return <NotYet title="교류" />;
  const act = async (action: () => Promise<{ data: Program | null; error: string | null }>, done = "") => { const result = await run(action, done); if (result) setMessage(result.text); return !!result?.ok; };
  // 마무리된 교류라도 넷째 날 두 분 모두 만나고 싶다고 했다면 보관 기간 동안 주고받은 글을 다시 읽을 수 있다(서버가 그때만 글을 준다).
  const reread = data.status === "closed" && data.entries.length > 0;
  const header = {
    choosing: { label: "함께 정하기", title: "어떻게 시작할지 함께 정해요." },
    scheduled: { label: "시작 전", title: `${data.startOn ? dayLabel(data.startOn) : ""} 09:00에 첫날이 열려요.` },
    started: { label: data.day ? DAY_NAME[data.day - 1] : "교류 중", title: data.ownPlan === "B" ? "두 사람의 첫 장면을 만들어요." : "하루 한 통, 천천히 나누는 편지." },
    deciding: { label: "넷째 날", title: "만나고 싶은지 골라 주세요." },
    arranging: { label: "약속 정하기", title: "두 분 모두 만나고 싶다고 했어요." },
    closed: { label: "마무리", title: "이번 교류는 마무리됐어요." },
  }[data.status];
  return (
    <section className="space-y-8" aria-labelledby="exchange-title">
      <PageHeader mark="교류" label={header.label} en="THREE DAYS · FLAVIE" titleId="exchange-title" title={header.title} lead={data.partnerName ? `${data.partnerName} 님과의 교류예요. 신고·차단은 두 사람 화면에서 언제든 할\u00a0수 있어요.` : undefined} aside={<Button asChild variant="outline" className="h-10 rounded-xl border-border text-xs"><Link to="/us">두 사람 화면</Link></Button>} />
      <Notice text={message} />
      {arrival && arrival !== message && <p role="status" aria-live="polite" className={`inline-flex items-center gap-2 letter-drop ${butter}`}><LockOpen size={13} />{arrival}</p>}
      {(data.status === "choosing" || data.status === "scheduled") && <PreludeLetters program={data} />}
      {data.status === "choosing" && data.startMissedAt && <p role="status" className="rounded-xl border border-[#EBD9A0] bg-[#FFFBEF] px-4 py-3 text-sm leading-7 dark:border-[#5A4C2A] dark:bg-[#26221A]">저희 쪽 문제로 정해 둔 날 교류가 열리지 못했어요. 죄송해요. 아래에서 새 시작일을 다시 확인해 주세요. 지금까지 나눈 것은 그대로예요.</p>}
      {data.status === "choosing" && <Agreement program={data} act={act} />}
      {data.status === "scheduled" && <Moment eyebrow="SEE YOU AT 09:00" title={<>{data.startOn && dayLabel(data.startOn)} 09:00,<br />첫날이 열려요.</>}>{data.ownPlan && PLAN_COPY[data.ownPlan].name} · 두 분 모두 확인했어요. 시작하면 알림으로 알려 드릴게요.</Moment>}
      {data.status === "scheduled" && data.ownPlan && data.startOn && <Sheet className="p-6 sm:p-8"><Eyebrow label="사흘 일정" en="SCHEDULE" /><div className="mt-4"><ScheduleList plan={data.ownPlan} startOn={data.startOn} /></div></Sheet>}
      {data.status === "started" && <TodayAction program={data} />}
      {(data.status === "started" || data.status === "deciding") && <OurDays program={data} />}
      {data.status === "deciding" && <MeetingDecision program={data} act={act} />}
      {data.status === "arranging" && <Moment eyebrow="WE BOTH SAID YES" title="두 분 모두 만나고 싶다고 했어요." action={<Button asChild className="h-11 rounded-full px-6"><Link to="/meeting">약속 정하러 가기 <ArrowRight size={14} /></Link></Button>}>{data.arrangeBy && `${kstDateTime(data.arrangeBy)}까지 약속을 함께 정해 주세요.`}</Moment>}
      {data.status === "closed" && <Closed program={data} />}
      {reread && <QuietNote>두 분이 주고받은 글이에요. {data.readableUntil ? `${kstDateTime(data.readableUntil)}까지` : "보관 기간 동안"} 다시 읽을 수 있고, 그 뒤에는 이 화면에서 사라져요.</QuietNote>}
      {data.ownPlan === "B" && (data.status === "started" || data.status === "deciding" || data.status === "arranging" || reread) && <FirstScene program={data} act={act} />}
      {(data.status === "started" || data.status === "deciding" || data.status === "arranging" || reread) && <Days program={data} act={act} />}
      {data.status !== "choosing" && data.status !== "scheduled" && <PreludeLetters program={data} />}
      {(data.status === "arranging" || reread) && <BookCard key={data.id} program={data} />}
      <PastExchanges items={past.filter(item => item.id !== data.id)} />
      <QuietNote>{SAFETY_COMPOSE_NOTE}</QuietNote>
    </section>
  );
}

type Act = (action: () => Promise<{ data: Program | null; error: string | null }>, done?: string) => Promise<boolean>;

// 사흘 일정 한 줄씩(방식을 고르면 보인다) · 넷째 날 만남 정하기까지
function ScheduleList({ plan, startOn }: { plan: "A" | "B"; startOn: string }) {
  return <ol className="space-y-1">{PLAN_COPY[plan].days.slice(0, 3).map((title, index) => <li key={title} className="flex gap-3 text-xs leading-6"><span className="w-24 shrink-0 text-muted-foreground">{DAY_NAME[index]} · {monthDay(shift(startOn, index))}</span><span className="text-foreground/85">{title}</span></li>)}<li className="flex gap-3 text-xs leading-6"><span className="w-24 shrink-0 text-muted-foreground">{DAY_NAME[3]} · {monthDay(shift(startOn, 3))}</span><span className="text-foreground/85">09:00 만나고 싶은지 고르기</span></li></ol>;
}
// 방식과 시작일을 한 장에서(검수 U07): 고른 방식 · 시작일 · 사흘 일정 · 내 확인 · 상대 확인. 규칙은 ‘진행 방식 다시 보기’에 접어 둔다.
// 내가 고른 방식만 미리 표시하고, 상대 방식이나 A를 대신 골라 두지 않는다. 두 분이 달라도 저절로 정하지 않는다.
// 시작일만 바뀌면 시작일만 다시 확인하면 된다(방식은 그대로).
function Agreement({ program, act }: { program: Program; act: Act }) {
  const [date, setDate] = useState(program.startOn ?? "");
  useEffect(() => setDate(program.startOn ?? ""), [program.startOn]);
  const same = !!program.ownPlan && program.ownPlan === program.partnerPlan;
  const differ = !!program.ownPlan && !!program.partnerPlan && !same;
  const min = shift(program.today, 1), max = shift(program.today, 14);
  const [pick, setPick] = useState<"A" | "B" | null>(program.ownPlan ?? null);
  useEffect(() => setPick(program.ownPlan ?? null), [program.ownPlan]);
  const [dateOpen, setDateOpen] = useState(false);
  const start = same && program.startOn ? program.startOn : shift(program.today, 1);
  const partnerProposed = same && !!program.startOn && program.partnerConfirmed && !program.ownConfirmed && !program.partnerReady;
  const confirmMode = same && pick === program.ownPlan && !!program.startOn && !program.ownConfirmed;
  const waiting = !!pick && ((program.ownReady === pick && !program.partnerReady) || (program.ownConfirmed && program.ownPlan === pick));
  const mine = program.ownConfirmed && same ? "시작일 확인 완료" : program.ownReady ? `${planName(program.ownReady)}로 ‘이대로 시작’을 눌렀어요` : program.ownPlan ? `${planName(program.ownPlan)}를 골랐어요 · 확인 전` : "아직 고르지 않았어요";
  const theirs = program.partnerConfirmed && same ? "시작일 확인 완료" : program.partnerReady && program.partnerPlan ? `${planName(program.partnerPlan)}로 ‘이대로 시작’을 눌렀어요` : program.partnerPlan ? `${planName(program.partnerPlan)}를 골랐어요 · 확인 전` : "아직 고르지 않았어요";
  const row = "grid gap-2 border-t border-border py-4 sm:grid-cols-[88px_1fr]";
  return <Sheet className="p-6 sm:p-8">
    <Eyebrow label="시작 방식과 날짜" en="START TOGETHER" />
    <p className="mt-3 text-sm leading-7 text-muted-foreground">방식을 고르고 아래 버튼을 누르면 돼요. 두 분이 같은 방식으로 확인하면 바로 일정이 정해져요.</p>
    <div className="mt-5">
      <div className={row}>
        <p className="text-xs font-semibold">방식</p>
        <div>
          <div role="radiogroup" aria-label="교류 방식" className="grid gap-2 sm:grid-cols-2">{(["A", "B"] as const).map(plan => <button key={plan} type="button" role="radio" aria-checked={pick === plan} onClick={() => setPick(plan)} className={`min-h-11 rounded-2xl border px-4 py-3 text-left ${interaction} ${pick === plan ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}>
            <span className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">{PLAN_COPY[plan].name}<span className="flex gap-1">{program.ownPlan === plan && <span className="whitespace-nowrap rounded-full bg-mist px-2 py-0.5 text-[10px] font-semibold ring-1 ring-border">내가 고른 방식</span>}{program.partnerPlan === plan && <span className="whitespace-nowrap rounded-full bg-[#F8E5A6] px-2 py-0.5 text-[10px] font-semibold text-[#5A4310]">상대가 고른 방식</span>}</span></span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{PLAN_COPY[plan].fit}</span>
          </button>)}</div>
          {differ && <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-mist p-4">
            <p className="text-xs leading-6"><span className="font-semibold">두 분의 선택이 달라요.</span> 나 {planName(program.ownPlan!)} · 상대 {planName(program.partnerPlan!)}<br /><span className="text-muted-foreground">저절로 정하지 않아요. 한 분이 맞추면 시작일 확인으로 넘어가요.</span></p>
            <Button variant="outline" onClick={() => void act(() => choosePlan(program.id, program.partnerPlan!), "상대 방식으로 맞췄어요.")} className="h-11 rounded-full border-border px-5">상대 방식으로 맞추기</Button>
          </div>}
        </div>
      </div>
      <div className={row}>
        <p className="text-xs font-semibold">시작일</p>
        <div className="text-sm leading-7">
          <span className="font-semibold">{dayLabel(start)} 09:00</span>{partnerProposed && <span className={`ml-2 ${butter}`}>상대가 제안한 날 · 이 날만 다시 확인해 주세요</span>}
          {!same && <span className="block text-xs text-muted-foreground">기본 시작일이에요. 두 분 방식이 같아지면 다른 날도 제안할 수 있어요.</span>}
          {same && !dateOpen && <button type="button" onClick={() => setDateOpen(true)} className={`block min-h-11 text-xs font-semibold text-primary underline-offset-4 hover:underline ${interaction}`}>다른 날 제안하기</button>}
          {same && dateOpen && <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5 text-xs font-semibold">시작일<Input type="date" min={min} max={max} value={date} onChange={event => setDate(event.target.value)} className="h-11 w-48 rounded-xl border-border bg-card" /></label>
            {date && date !== program.startOn && <Button variant="outline" onClick={() => void act(() => proposeStart(program.id, date), "새 시작일을 제안했어요. 상대가 이 날짜만 다시 확인하면 돼요.")} className="h-11 rounded-xl border-border">이 날로 제안하기</Button>}
            <span className="w-full text-[11px] leading-5 text-muted-foreground">14일 안에서 고를 수 있어요. 제안한 사람은 그 날짜로 확인한 것으로 보고, 상대는 날짜만 다시 확인해요.</span>
          </div>}
        </div>
      </div>
      <div className={row}>
        <p className="text-xs font-semibold">사흘 일정</p>
        {pick ? <ScheduleList plan={pick} startOn={start} /> : <p className="text-xs leading-6 text-muted-foreground">방식을 고르면 날마다 무엇을 하는지 보여요.</p>}
      </div>
      <div className={row}>
        <p className="text-xs font-semibold">확인</p>
        <ul className="space-y-1 text-xs leading-6"><li className="flex gap-2"><span className="w-8 shrink-0 text-muted-foreground">나</span><span className={program.ownConfirmed || program.ownReady ? "font-semibold text-primary" : ""}>{mine}</span></li><li className="flex gap-2"><span className="w-8 shrink-0 text-muted-foreground">상대</span><span className={program.partnerConfirmed || program.partnerReady ? "font-semibold text-primary" : ""}>{theirs}</span></li></ul>
      </div>
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-mist p-5">
      <p className="text-sm leading-7"><span className="font-semibold">{pick ? `${planName(pick)} · ${dayLabel(start)} 09:00 시작` : "방식을 먼저 골라 주세요"}</span>{pick && <><br /><span className="text-xs text-muted-foreground">{confirmMode ? partnerProposed ? "상대가 이 날로 확인했어요. 나도 확인하면 바로 정해져요." : "나도 확인하면 상대 확인을 기다려요." : program.partnerReady && program.partnerPlan === pick ? "상대는 이대로 시작을 눌러 두었어요. 나도 누르면 바로 정해져요." : waiting ? same && program.ownConfirmed ? "확인했어요. 상대가 확인하면 바로 정해져요." : "눌렀어요. 상대가 같은 방식으로 확인하면 그때 바로 정해져요." : program.partnerPlan && program.partnerPlan !== pick ? "상대와 방식이 달라요. 눌러도 상대가 맞추기 전까지는 정해지지 않아요." : "상대도 같은 방식으로 확인하면 이 일정으로 시작해요."}</span></>}</p>
      <Button disabled={!pick || (waiting && !confirmMode)} onClick={() => { if (!pick) return; void act(() => confirmMode ? confirmProgram(program.id, program.startOn) : quickStart(program.id, pick), confirmMode ? "확인했어요." : ""); }} className="h-11 rounded-xl px-6">{!pick ? "방식을 골라 주세요" : confirmMode ? "이 일정으로 시작하기" : waiting ? "눌렀어요" : "이대로 시작"}</Button>
    </div>
    <p className="mt-4 text-xs leading-6 text-muted-foreground"><span className="font-semibold text-foreground">{kstDateTime(program.agreeBy)}까지</span> 정해지지 않으면 교류는 열리지 않고 이번 소개는 마무리돼요.</p>
    <details className="group mt-3 border-t border-border pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold [&::-webkit-details-marker]:hidden">진행 방식 다시 보기<ChevronDown aria-hidden="true" size={14} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{(["A", "B"] as const).map(plan => <div key={plan} className="rounded-2xl border border-border p-4">
        <p className="text-sm font-semibold">{PLAN_COPY[plan].name}</p>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">{PLAN_COPY[plan].description}</p>
        <p className="mt-2 rounded-xl bg-mist px-3 py-2 text-xs leading-5 text-foreground/80">{PLAN_COPY[plan].example}</p>
      </div>)}</div>
      <div className="mt-3"><NoteList items={[{ title: "베타 기간", body: "지금은 교류비 없이 진행해요. 정식 운영부터 각자 교류비를 결제한 뒤 시작해요." }, { title: "시작한 뒤에는", body: "방식은 바꿀 수 없어요. 3일 동안 하루 한 번씩 쓰고, 넷째 날 09:00에 만남을 정해요." }, { title: "정하지 못하면", body: `${kstDateTime(program.agreeBy)}까지 두 분이 같은 방식과 시작일을 확인하지 않으면 교류는 열리지 않고 이번 소개는 마무리돼요. 그 뒤에는 다음 소개를 기다리게 돼요.` }]} /></div>
    </details>
  </Sheet>;
}

// B: 함께 열린 날 두 분의 선택이 겹치면 작게 알려 준다.
function sameMoment(day: number, entry: ProgramEntry) {
  const own = entry.own?.payload ?? {}, theirs = entry.partner?.payload ?? {};
  if (day === 1 && own.activity && own.activity === theirs.activity) return `같은 곳을 골랐어요 · ${sceneLabel(own.activity)}`;
  if (day === 2 && own.flow && own.flow === theirs.flow) return `머무는 방식이 같아요 · ${sceneLabel(own.flow)}`;
  if (day === 2 && own.rest && own.rest === theirs.rest) return `쉬어 갈 곳이 같아요 · ${sceneLabel(own.rest)}`;
  if (day === 2 && own.place && own.place === theirs.place) return `같은 곳을 떠올렸어요 · ${sceneLabel(own.place)}`;
  if (day === 3 && own.topic && own.topic === theirs.topic) return `나누고 싶은 이야기가 같아요 · “${own.topic}”`;
  return "";
}

// 함께 열린 글을 이 기기에서 처음 보는지(처음이면 ‘새로 열렸어요’로 조용히 알려 준다). 마무리된 교류는 늘 그대로 보여 준다.
const SEEN_PREFIX = "before-us:opened:";
function useFreshOpen(program: Program) {
  const seen = useRef<Set<string> | null>(null);
  if (!seen.current) { try { seen.current = new Set(JSON.parse(localStorage.getItem(SEEN_PREFIX + program.id) ?? "[]") as string[]); } catch { seen.current = new Set(); } }
  const opened = program.entries.filter(entry => !!entry.own && !!entry.partner && ["letter", "reply", "scene", "piece"].includes(entry.kind)).map(entry => `${entry.day}:${entry.kind}`);
  const key = opened.join(",");
  useEffect(() => { if (program.status === "closed") return; try { localStorage.setItem(SEEN_PREFIX + program.id, JSON.stringify([...new Set([...seen.current!, ...opened])])); } catch { /* 저장할 수 없으면 이 화면에서만 */ } }, [program.id, key]);
  return (day: number, kind: string) => program.status !== "closed" && opened.includes(`${day}:${kind}`) && !seen.current!.has(`${day}:${kind}`);
}

// 고른 것 한 줄: 직접 쓴 것에는 작은 연필 표시를 붙인다.
const sceneParts = (payload: Record<string, string> | null | undefined) => !payload ? [] : [payload.activity, payload.flow, payload.rest, payload.topic && `“${payload.topic}”`].filter((value): value is string => !!value);
const sceneSummary = (payload: Record<string, string> | null | undefined) => sceneParts(payload).map(sceneLabel).join(" · ");
const sceneKey = (pick: { activity?: string; flow?: string; rest?: string; topic?: string }) => [pick.activity, pick.flow, pick.rest, pick.topic].join("|");
function SceneLine({ payload, className = "" }: { payload: Record<string, string> | null | undefined; className?: string }) {
  const parts = sceneParts(payload);
  if (!parts.length) return null;
  return <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${className}`}>{parts.map((value, index) => <span key={`${index}:${value}`} className="inline-flex items-center gap-1">{index > 0 && <span aria-hidden="true" className="font-normal text-muted-foreground">·</span>}{isCustom(value) && <><PenLine size={12} aria-hidden="true" className="text-accent" /><span className="sr-only">직접 쓴 </span></>}{sceneLabel(value)}</span>)}</p>;
}

// 날짜 도장·지금 할 일에서 그날 글 카드로 옮겨 간다(카드에는 scroll-mt-28 = 112px 여백).
const goToDay = (day: number) => { const card = document.getElementById(`day-${day}`); if (!card) return; card.dispatchEvent(new CustomEvent("flavie:open-day")); card.scrollIntoView({ behavior: "smooth", block: "start" }); };
// 우리의 사흘: 그날 글이 함께 열리면 도장이 하나씩 채워진다. B는 고른 것이 ‘우리의 첫 장면’으로 모인다.
// 넷째 날(만남 선택)에는 사흘을 돌아보는 카드가 된다(A: 상대가 들려준 사흘 · B: 함께 맞춘 장면).
const firstLine = (text: string, max = 48) => {
  const line = text.trim().split("\n")[0].trim();
  const sentence = (line.match(/^.*?[.!?](\s|$)/)?.[0] ?? line).trim();
  const chars = Array.from(sentence);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : sentence;
};
const monthDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const STAMP = {
  open: { ring: "bg-primary text-primary-foreground", label: "함께 열림", text: "font-semibold text-primary" },
  sent: { ring: "border-2 border-primary bg-card text-primary", label: "보냈어요", text: "text-primary" },
  today: { ring: "border-2 border-accent bg-card text-accent", label: "오늘", text: "font-semibold text-accent" },
  future: { ring: "border border-dashed border-border bg-card text-muted-foreground", label: "", text: "text-muted-foreground" },
  missed: { ring: "border border-border bg-muted text-muted-foreground", label: "열리지 않음", text: "text-muted-foreground" },
} as const;
function OurDays({ program }: { program: Program }) {
  const fresh = useFreshOpen(program);
  if (!program.startOn) return null;
  const plan = program.ownPlan ?? "A";
  const kind = plan === "A" ? "letter" : "scene";
  const recap = program.status === "deciding";
  const entry = (day: number, which: string = kind) => program.entries.find(item => item.day === day && item.kind === which);
  const isOpen = (item?: ProgramEntry) => !!item?.own && !!item?.partner;
  const hour = kstHour();
  const stamps = [1, 2, 3].map(day => {
    const item = entry(day), date = shift(program.startOn!, day - 1);
    const isToday = program.status === "started" && date === program.today && hour >= 9;
    const future = program.status === "started" && (date > program.today || (date === program.today && hour < 9));
    const state: keyof typeof STAMP = isOpen(item) ? "open" : isToday ? (item?.own ? "sent" : "today") : future ? "future" : "missed";
    return { day, date, state };
  });
  const opened = stamps.filter(stamp => stamp.state === "open").length;
  const meetDate = shift(program.startOn, 3);
  const replies = [1, 2, 3].filter(day => isOpen(entry(day, "reply"))).length;
  const photos = [1, 2, 3].reduce((sum, day) => { const item = entry(day, "letter"); return isOpen(item) ? sum + (item?.own?.payload?.photo ? 1 : 0) + (item?.partner?.payload?.photo ? 1 : 0) : sum; }, 0);
  const final = program.entries.find(item => item.kind === "final");
  const agreed = !!final?.own?.payload && !!final.partner?.payload && sceneKey(final.own.payload) === sceneKey(final.partner.payload);
  const strong = (text: string) => <b className="font-semibold text-foreground">{text}</b>;
  return <Sheet className="p-6 sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><Eyebrow label={recap ? "두 사람의 사흘" : "우리의 사흘"} en={recap ? "LOOKING BACK" : "OUR THREE DAYS"} /><DotsTrack step={opened} /></div>
    {recap && <p className="mt-3 text-sm leading-7 text-muted-foreground">만남을 고르기 전에, 사흘 동안 나눈 것을 한눈에 돌아봐요.</p>}
    <ol className="relative mt-6 grid grid-cols-4" aria-label="사흘 동안 함께 열린 날과 만남 선택">
      <span aria-hidden="true" className="absolute left-[12.5%] right-[12.5%] top-5 h-px bg-border" />
      {stamps.map(({ day, date, state }) => <li key={day} className="relative flex flex-col items-center text-center">
        <button type="button" onClick={() => goToDay(day)} aria-label={`DAY 0${day} ${STAMP[state].label || monthDay(date)} · 그날 글로 이동`} className={`flex min-h-11 min-w-11 flex-col items-center gap-1.5 rounded-xl px-1 pb-1 outline-none focus-visible:ring-2 focus-visible:ring-ring ${interaction} hover:bg-muted/60`}>
          <span aria-hidden="true" className={`grid size-10 place-items-center rounded-full text-xs font-semibold ring-4 ring-card ${STAMP[state].ring} ${state === "open" && fresh(day, kind) ? "letter-drop" : ""}`}>{state === "open" ? <LockOpen size={15} /> : state === "sent" ? <Check size={15} /> : `0${day}`}</span>
          <span aria-hidden="true" className="mt-0.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">DAY 0{day}</span>
          <span aria-hidden="true" className={`text-[11px] leading-4 ${STAMP[state].text}`}>{STAMP[state].label || monthDay(date)}</span>
        </button>
      </li>)}
      <li className="relative flex flex-col items-center gap-1.5 text-center">
        <span aria-hidden="true" className={`grid size-10 place-items-center rounded-full text-xs font-semibold ring-4 ring-card ${recap ? "border-2 border-accent bg-card text-accent" : "border border-dashed border-border bg-card text-muted-foreground"}`}>04</span>
        <span className="mt-0.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">DAY 04</span>
        <span className={`text-[11px] leading-4 ${recap ? "font-semibold text-accent" : "text-muted-foreground"}`}>{recap ? "만남 선택" : <>{monthDay(meetDate)}<br />만남 선택</>}</span>
      </li>
    </ol>
    {plan === "A" && <p className="mt-6 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">{opened ? <>함께 연 편지 {strong(`${opened}통`)}{replies > 0 && <> · 주고받은 답장 {strong(`${replies}번`)}</>}{photos > 0 && <> · 나눈 사진 {strong(`${photos}장`)}</>}</> : program.status === "started" ? "두 분 모두 보내면 그날의 도장이 채워지고, 두 점이 한 걸음 가까워져요." : "사흘 동안 함께 열린 편지는 없었어요."}</p>}
    {plan === "A" && recap && opened > 0 && <div className="mt-4"><p className="text-xs font-semibold">상대가 들려준 사흘</p><ul className="mt-3 space-y-2.5">{[1, 2, 3].map(day => { const item = entry(day); if (!isOpen(item) || !item?.partner?.body) return null; return <li key={day} className="flex gap-3 text-sm leading-6"><span className="w-14 shrink-0 pt-0.5 text-[11px] font-semibold text-accent">DAY 0{day}</span><span className="min-w-0 text-foreground/85"><span className="block text-[11px] text-muted-foreground">{day === 3 && program.ownAsk ? `내가 낸 질문 · “${program.ownAsk}”` : letterPrompt(day, day === 1 || isOpen(entry(day - 1)), program.letterSet).title}</span>“{firstLine(item.partner.body)}”{item.partner.payload?.photo && <span className="ml-1.5 whitespace-nowrap text-[11px] text-muted-foreground">· 사진 한 장</span>}</span></li>; })}</ul></div>}
    {plan === "B" && (isOpen(entry(3))
      ? <p className="mt-6 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">{agreed ? <>{strong("함께 맞춘 첫 장면")} · {sceneSummary(final!.own!.payload)}{isOpen(program.entries.find(item => item.kind === "piece")) && " · 첫 장면 이야기도 함께 열렸어요"}</> : "사흘 동안 고른 것이 모두 모였어요. 아래에서 두 분이 고른 것 중에서 첫 장면을 함께 맞춰요."}</p>
      : <div className="mt-6 border-t border-border pt-5">
        <p className="text-xs font-semibold">우리의 첫 장면 <span className="font-normal text-muted-foreground">· 날마다 하나씩 채워져요</span></p>
        <SceneBoard program={program} />
        {recap && <p className="mt-4 text-xs leading-6 text-muted-foreground">셋째 날 답이 함께 열리지 않아 첫 장면을 맞추지는 않았어요. 두 분이 고른 것은 그대로 남아 있어요.</p>}
      </div>)}
  </Sheet>;
}

// 오늘 할 일 하나(검수 U08): 쓰기 · 기다리기 · 읽기 중 하나와 한 줄 상태. 답장·한마디·질문 같은 선택 항목은 여기서 요구하지 않는다.
function TodayAction({ program }: { program: Program }) {
  if (!program.startOn || !program.day) return null;
  const plan = program.ownPlan ?? "A";
  const day = program.day;
  const entry = program.entries.find(item => item.day === day && item.kind === (plan === "A" ? "letter" : "scene"));
  const early = kstHour() < 9;
  const opened = !!entry?.own && !!entry?.partner;
  const state = early ? "early" : opened ? "read" : entry?.own ? "wait" : "write";
  const what = plan === "A" ? "편지" : "답";
  const previous = program.entries.find(item => item.day === day - 1 && item.kind === (plan === "A" ? "letter" : "scene"));
  const topic = plan === "B" ? SCENE_PROMPTS[day - 1].title : day === 3 && program.partnerAsk ? `${program.partnerName ?? "상대"} 님이 낸 질문` : letterPrompt(day, day === 1 || (!!previous?.own && !!previous?.partner), program.letterSet).title;
  const copy = {
    early: { title: topic, line: `DAY 0${day}은 오늘 09:00에 열려요. 열리면 알림으로 알려 드릴게요.`, button: "" },
    write: { title: topic, line: `오늘 23:59까지 · ${untilMidnight()} 남았어요 · ${entry?.partnerSent ? "상대는 이미 보냈어요. 보내면 바로 함께 열려요." : "두 분 모두 보내면 함께 열려요."}`, button: plan === "A" ? "오늘 편지 쓰기" : "오늘의 답 고르기" },
    wait: { title: "오늘 할 일은 끝났어요", line: `오늘의 ${what}을 보냈어요. 상대가 보내면 함께 열려요.`, button: "보낸 글 보기" },
    read: { title: topic, line: plan === "A" ? "두 분의 편지가 함께 열렸어요. 답장은 선택이에요." : "두 분의 답이 함께 열렸어요. 한마디는 선택이에요.", button: "함께 열린 글 읽기" },
  }[state];
  return <Sheet className={`p-5 sm:p-6 ${state === "write" || state === "read" ? "border-primary/40" : ""}`}>
    <p className="text-[11px] font-semibold tracking-[0.12em] text-accent">오늘 할 일 · DAY 0{day}</p>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h2 className="text-lg font-semibold leading-7">{copy.title}</h2><p role="status" className="mt-1 text-xs leading-6 text-muted-foreground">{copy.line}</p></div>
      {copy.button && <Button variant={state === "wait" ? "outline" : "default"} onClick={() => goToDay(day)} className={`h-11 rounded-full px-6 ${state === "wait" ? "border-border" : ""}`}>{copy.button} <ArrowRight size={14} /></Button>}
    </div>
  </Sheet>;
}

// 우리의 첫 장면(B): 장소 → 머무는 방식 → 쉬어 갈 곳 → 나눌 이야기가 날마다 채워진다. 두 분이 같은 것을 고르면 노란 칩 하나로 모인다.
const BOARD = [["activity", 1, "장소"], ["flow", 2, "머무는 방식"], ["rest", 2, "쉬어 갈 곳"], ["topic", 3, "나눌 이야기"]] as const;
function SceneBoard({ program }: { program: Program }) {
  return <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">{BOARD.map(([key, day, label]) => {
    const entry = program.entries.find(item => item.day === day && item.kind === "scene");
    const mine = entry?.own?.payload?.[key], theirs = entry?.partner?.payload?.[key];
    const date = program.startOn ? shift(program.startOn, day - 1) : "";
    const values: [string, string][] = mine && theirs && mine === theirs ? [[mine, "둘 다"]] : [...(mine ? [[mine, "나"]] : []), ...(theirs ? [[theirs, "상대"]] : [])] as [string, string][];
    const waiting = !!entry?.partnerSent && !entry?.partner;
    return <div key={key}><dt className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{label}<span className="ml-1.5 font-normal">DAY 0{day}</span></dt>
      <dd className="mt-1.5 flex flex-wrap gap-1.5">
        {values.map(([value, who]) => <span key={who} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${who === "둘 다" ? "bg-[#F8E5A6] font-semibold text-[#5A4310]" : who === "나" ? "bg-mist ring-1 ring-border" : "bg-card ring-1 ring-lilac"}`}>{isCustom(value) && <PenLine size={11} aria-hidden="true" />}{key === "topic" ? `“${value}”` : sceneLabel(value)}<span className="text-[10px] font-normal opacity-60">{who}</span></span>)}
        {waiting && mine && <span className="rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground">상대도 골랐어요 · 함께 열리면 보여요</span>}
        {!values.length && <span className="rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground">{program.status === "started" && date >= program.today ? `DAY 0${day}에 채워져요` : "고르지 않았어요"}</span>}
      </dd></div>;
  })}</dl>;
}

function Days({ program, act }: { program: Program; act: Act }) {
  const fresh = useFreshOpen(program);
  if (!program.startOn) return null;
  const plan = program.ownPlan ?? "A";
  const find = (day: number, kind: string = plan === "A" ? "letter" : "scene") => program.entries.find(entry => entry.day === day && entry.kind === kind);
  const isOpen = (entry?: ProgramEntry) => !!entry?.own && !!entry?.partner;
  const live = ["started", "deciding", "arranging"].includes(program.status);
  const partner = program.partnerName ?? "상대";
  // 한 줄 엽서는 사흘 중 한 번(서버와 같은 기준) · 밑줄은 사흘 동안 함께 열린 상대 글에 한 문장
  const postcardUsed = program.entries.some(entry => entry.kind === "letter" && entry.own?.payload?.postcard === "1");
  const mark: MarkControl = { current: program.ownMark ?? null, editable: program.status === "started", partner, onPick: text => act(() => setBookmark(program.id, text), text ? `밑줄을 그었어요. 넷째 날 아침 ${partner} 님에게 보여요.` : "밑줄을 지웠어요.") };
  return <div className="space-y-6">{[1, 2, 3].map(day => {
    const date = shift(program.startOn!, day - 1);
    const previous = day > 1 ? find(day - 1) : undefined;
    const previousOpened = day === 1 || isOpen(previous);
    // 셋째 날: 상대가 낸 질문이 있으면 그 질문에 답한다(셋째 날 09:00부터 보인다).
    const asked = plan === "A" && day === 3 ? program.partnerAsk ?? null : null;
    const letter = asked ? { title: `${partner} 님이 낸 질문`, question: asked, examples: [] as readonly string[] } : letterPrompt(day, previousOpened, program.letterSet), scene = SCENE_PROMPTS[day - 1];
    const askOpen = plan === "A" && day === 2 && program.status === "started" && Date.now() >= kstAt(date, "09:00") && Date.now() < kstAt(shift(date, 1), "09:00");
    const main = find(day), reply = find(day, "reply");
    const isToday = program.status === "started" && program.day === day;
    const early = isToday && kstHour() < 9;
    const today = isToday && !early;
    const future = program.status === "started" && (date > program.today || early);
    const opened = isOpen(main);
    const isFresh = opened && fresh(day, plan === "A" ? "letter" : "scene");
    // 답장(A)·한마디(B)는 그날 글이 함께 열린 뒤 다음 날 09:00까지(셋째 날은 넷째 날 09:00까지)
    const replyUntil = `${dayLabel(shift(date, 1))} 09:00`;
    const beforeNextNine = Date.now() < kstAt(shift(date, 1), "09:00");
    const replyOpen = plan === "A" && program.status === "started" && opened && beforeNextNine;
    const match = plan === "B" && opened && main ? sameMoment(day, main) : "";
    // 지난 날(할 일이 남지 않은 날)은 두 문장 미리 보기로 접고, 오늘은 펼친다(검수 F3).
    const commentOpen = plan === "B" && opened && live && beforeNextNine;
    const foldable = !today && !future && (!!main?.own || !!main?.partner) && !(replyOpen && !reply?.own) && !commentOpen;
    const previewSource = main?.partner ?? main?.own;
    const preview = plan === "A" ? twoSentences(previewSource?.body ?? "") : sceneSummary(previewSource?.payload) || twoSentences(previewSource?.body ?? "");
    return <DayCard key={day} day={day} foldable={foldable} highlight={today && !main?.own} title={plan === "A" ? letter.title : scene.title} date={dayLabel(date)} preview={preview}>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><Eyebrow mark={`0${day}`} label={plan === "A" ? letter.title : scene.title} en={DAY_NAME[day - 1]} /><span className="text-xs text-muted-foreground">{dayLabel(date)} 09:00~23:59</span></div>
      {future ? <p className="mt-4 text-sm text-muted-foreground">{dayLabel(date)} 오전 9시에 열려요. 그때 알림으로 알려 드릴게요.</p> : <>
        <p className="mt-4 text-sm font-semibold leading-7">{plan === "A" ? letter.question : scene.question}</p>
        {plan === "A" && day === 3 && program.ownAsk && <p className="mt-1.5 text-xs leading-6 text-muted-foreground">{partner} 님에게는 내가 낸 질문이 갔어요 · “{program.ownAsk}”</p>}
        {opened && <p className={`mt-4 inline-flex items-center gap-2 ${isFresh ? "letter-drop" : ""} ${butter}`}><LockOpen size={13} className="shrink-0" /><span>{isFresh ? <Segments parts={["새로 열렸어요", match || "두 분의 글이 모두 도착했어요"]} /> : match || "두 분의 글이 모두 도착해 함께 열렸어요"}</span></p>}
        {today && !!main?.own && !opened && <p className={`mt-4 inline-flex items-center gap-2 letter-drop ${butter}`}><Check size={13} />오늘 할 일 끝 · {plan === "A" ? "오늘의 편지를 보냈어요" : "오늘의 답을 보냈어요"}</p>}
        <EntryPair entry={main} plan={plan} day={day} past={!today} mark={mark} />
        {today && !main?.own && main?.partnerSent && <p className={`mt-4 inline-flex items-center gap-2 ${butter}`}><Check size={13} />상대는 이미 보냈어요. 내 글을 보내면 바로 함께 열려요.</p>}
        {today && !main?.own && (plan === "A"
          ? <LetterComposer draftKey={`${program.id}:${day}:letter`} examples={letter.examples} photo={{ programId: program.id, day }} postcard={!postcardUsed} onSend={(body, photo, postcard) => act(() => submitEntry(program.id, day, "letter", body, postcard ? { postcard: "1" } : photo ? { photo } : undefined), postcard ? (main?.partnerSent ? "엽서를 보냈어요. 두 분의 글이 함께 열렸어요." : "엽서를 보냈어요. 상대도 보내면 함께 열려요.") : main?.partnerSent ? "보냈어요. 두 분의 편지가 함께 열렸어요." : "보냈어요. 상대도 보내면 함께 열려요.")} />
          : <SceneComposer draftKey={`${program.id}:${day}:scene`} day={day} previous={previousOpened ? previous : undefined} first={find(1)} comment={day > 1 ? find(day - 1, "comment")?.own : undefined} onSend={(body, payload) => act(() => submitEntry(program.id, day, "scene", body, payload), main?.partnerSent ? "보냈어요. 두 분의 답이 함께 열렸어요." : "보냈어요. 상대도 보내면 함께 열려요.")} />)}
        {today && !main?.own && <p className="mt-3 text-[11px] text-muted-foreground">오늘 23:59까지 {untilMidnight()} 남았어요. 두 분 모두 보내야 함께 열려요.</p>}
        {plan === "A" && opened && <div className="mt-6 border-t border-border pt-5">
          <p className="text-xs font-semibold text-accent">답장 · 선택 · 한 번 · {replyUntil}까지</p>
          <EntryPair entry={reply} plan="A" reply until={replyUntil} past={!replyOpen} mark={mark} />
          {replyOpen && !reply?.own && (reply?.partnerSent
            ? <p className={`mt-4 inline-flex items-center gap-2 ${butter}`}><Check size={13} />상대는 답장을 보냈어요. 내 답장도 보내면 함께 열려요.</p>
            : <p className="mt-3 text-xs leading-6 text-muted-foreground">보내지 않아도 괜찮아요. 열린 편지에 답장을 한 번 보낼 수 있고, 두 분 모두 보내면 답장도 함께 열려요.</p>)}
          {replyOpen && !reply?.own && <LetterComposer reply draftKey={`${program.id}:${day}:reply`} onSend={body => act(() => submitEntry(program.id, day, "reply", body), reply?.partnerSent ? "답장을 보냈어요. 두 분의 답장이 함께 열렸어요." : "답장을 보냈어요. 상대도 보내면 함께 열려요.")} />}
          {!replyOpen && !reply?.own && <p className="mt-3 text-xs text-muted-foreground">{reply?.partnerSent ? "두 분이 모두 답장을 보내지 않아 답장은 열리지 않았어요." : "이날은 답장을 나누지 않았어요."}</p>}
        </div>}
        {plan === "B" && opened && <Comments program={program} act={act} on="scene" day={day} until={replyUntil} open={live && beforeNextNine} />}
        {plan === "A" && day === 2 && (askOpen || program.ownAsk) && <AskBox program={program} act={act} open={askOpen} />}
        {!today && !main?.own && <p className="mt-4 text-xs text-muted-foreground">{main?.partnerSent ? "상대는 보냈지만 내가 보내지 않아, 이날 글은 열리지 않았어요." : "이날은 글을 보내지 않았어요."}</p>}
      </>}
    </DayCard>;
  })}</div>;
}

// 두 문장 미리 보기(접힌 지난 날)
const twoSentences = (text: string) => { const parts = (text.trim().match(/[^.!?。\n]+[.!?。…~]*/g) ?? []).map(part => part.trim()).filter(Boolean); const joined = parts.slice(0, 2).join(" "); const chars = Array.from(joined); return chars.length > 120 ? `${chars.slice(0, 120).join("")}…` : joined; };
function DayCard({ day, foldable, highlight, title, date, preview, children }: { day: number; foldable: boolean; highlight: boolean; title: string; date: string; preview: string; children: ReactNode }) {
  const [unfolded, setUnfolded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // 날짜 도장을 누르면 접힌 날도 펼친다.
  useEffect(() => { const card = ref.current; if (!card) return; const open = () => setUnfolded(true); card.addEventListener("flavie:open-day", open); return () => card.removeEventListener("flavie:open-day", open); }, []);
  const folded = foldable && !unfolded;
  return <div ref={ref} id={`day-${day}`} className="scroll-mt-28">
    <Sheet className={`p-6 sm:p-8 ${highlight ? "border-primary/40" : ""}`}>
      {folded ? <>
        <div className="flex flex-wrap items-baseline justify-between gap-2"><Eyebrow mark={`0${day}`} label={title} en={DAY_NAME[day - 1]} /><span className="text-xs text-muted-foreground">{date}</span></div>
        {preview && <p className="mt-4 line-clamp-2 text-sm leading-7 text-foreground/80">{preview}</p>}
        <button type="button" aria-expanded={false} onClick={() => setUnfolded(true)} className={`mt-3 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline ${interaction}`}>다시 읽기 <ChevronDown size={13} /></button>
      </> : <>
        {children}
        {foldable && <button type="button" aria-expanded={true} onClick={() => setUnfolded(false)} className={`mt-5 inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-foreground ${interaction}`}>접기 <ChevronDown size={13} className="rotate-180" /></button>}
      </>}
    </Sheet>
  </div>;
}

// 글 한 장: A는 편지(사진이 있으면 폴라로이드 틀로), B는 고른 것·이유·전날 선택에 남긴 한마디·나를 소개하는 답을 함께 보여 준다(상대에게도 똑같이 보인다).
// 밑줄(책갈피): 상대 글의 문장 하나. 사흘 동안 긋고 바꿀 수 있고, 넷째 날 아침 상대에게 보인다.
type MarkControl = { current: string | null; editable: boolean; partner: string; onPick: (text: string | null) => Promise<boolean> };
// 한 줄 엽서: 버터 노랑 종이 위에 한 줄
const POSTCARD_TONE = { own: "bg-[#FFF6DA] dark:bg-[#2D2819]", partner: "border border-[#EBD9A0] bg-[#FFFBEF] dark:border-[#5A4C2A] dark:bg-[#26221A]" };
function EntryCard({ who, content, plan, day, tone, own = false, mark }: { who: string; content: EntryContent; plan: "A" | "B"; day: number; tone: string; own?: boolean; mark?: MarkControl }) {
  const payload = content.payload ?? {};
  const [picking, setPicking] = useState(false);
  const postcard = plan === "A" && payload.postcard === "1";
  // 밑줄을 그을 수 있는 글: A 편지·답장 본문, B 고른 이유·나를 소개하는 답
  const markable = !own && !!mark && (!!content.body || (plan === "B" && !!payload.about));
  const inThis = !!mark?.current && (!!content.body?.includes(mark.current) || (plan === "B" && !!payload.about?.includes(mark.current)));
  const pick = async (text: string) => { if (mark && await mark.onPick(text)) setPicking(false); };
  const text = (value: string, className: string) => markable ? <MarkableText text={value} mark={mark!.current} picking={picking} onPick={text => void pick(text)} className={className} /> : <p className={className}>{value}</p>;
  return <article className={`rounded-2xl p-5 ${postcard ? POSTCARD_TONE[own ? "own" : "partner"] : tone}`}>
    <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{who}{postcard && " · 한 줄 엽서"}{content.at && ` · ${kstDateTime(content.at)}`}</p>
    {plan === "B" && payload.place && <p className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">떠올린 곳 ·{isCustom(payload.place) && <PenLine size={11} aria-hidden="true" />}{sceneLabel(payload.place)}</p>}
    {plan === "B" && <SceneLine payload={payload} className={`${payload.place ? "mt-1" : "mt-2"} text-sm font-semibold`} />}
    {content.body && (plan === "B" ? <div className="mt-2 flex gap-1 text-sm leading-7"><span className="shrink-0 text-xs leading-7 text-muted-foreground">고른 이유 · </span>{text(content.body, "min-w-0")}</div> : text(content.body, postcard ? "mt-2 whitespace-pre-wrap text-base font-semibold leading-8" : "mt-2 whitespace-pre-wrap text-sm leading-7"))}
    {plan === "A" && payload.photo && <LetterPhoto path={payload.photo} caption={`DAY 0${day}`} className="mt-5" />}
    {plan === "B" && payload.reaction && <p className="mt-2 text-sm leading-7"><span className="text-xs text-muted-foreground">어제 선택에 · </span>{payload.reaction}</p>}
    {plan === "B" && payload.about && <div className="mt-3 border-t border-border/70 pt-3 text-sm leading-7"><span className="block text-[11px] font-semibold text-muted-foreground">{SCENE_PROMPTS[day - 1].about}</span>{text(payload.about, "")}</div>}
    {markable && mark!.editable && <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-3 text-[11px] leading-5 text-muted-foreground">
      {picking ? <><span>마음에 남은 문장 하나를 눌러 주세요. 넷째 날 아침 {mark!.partner} 님에게 보여요.</span><button type="button" onClick={() => setPicking(false)} className="text-[11px] font-semibold text-primary">그만</button></>
        : <button type="button" onClick={() => setPicking(true)} className={`inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline ${interaction}`}><Highlighter size={12} aria-hidden="true" />{inThis ? "밑줄 바꾸기" : mark!.current ? "이 글로 밑줄 옮기기" : "밑줄 긋기"}</button>}
      {inThis && !picking && <><span>밑줄 그은 문장 · 넷째 날 아침 {mark!.partner} 님에게 보여요</span><button type="button" onClick={() => void mark!.onPick(null)} className="text-[11px] hover:text-foreground">지우기</button></>}
    </div>}
  </article>;
}
// 문장마다 누를 수 있게 나눈 글(밑줄 고르기). 고르지 않을 때는 밑줄 그은 문장만 표시한다.
const SENTENCE = /[^.!?。\n]+[.!?。…~]*["'”’)]*\s*|\n+/g;
function MarkableText({ text, mark, picking, onPick, className }: { text: string; mark: string | null; picking: boolean; onPick: (text: string) => void; className: string }) {
  if (picking) {
    const parts = text.match(SENTENCE) ?? [text];
    return <p className={`whitespace-pre-wrap ${className}`}>{parts.map((part, index) => !part.trim() ? <span key={index}>{part}</span> : <span key={index} role="button" tabIndex={0} onClick={() => onPick(part.trim())} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPick(part.trim()); } }} className={`cursor-pointer rounded-sm ${interaction} ${part.trim() === mark ? "soft-underline is-on" : "hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none"}`}>{part}</span>)}</p>;
  }
  const at = mark ? text.indexOf(mark) : -1;
  if (!mark || at < 0) return <p className={className}>{text}</p>;
  return <p className={className}>{text.slice(0, at)}<span className="soft-underline is-on">{mark}</span>{text.slice(at + mark.length)}</p>;
}
function EntryPair({ entry, plan, day = 1, reply = false, past = false, until = "오늘 23:59", mark }: { entry?: ProgramEntry; plan: "A" | "B"; day?: number; reply?: boolean; past?: boolean; until?: string; mark?: MarkControl }) {
  if (!entry || (!entry.own && !entry.partner)) return null;
  return <div className="mt-5 grid gap-3 lg:grid-cols-2">
    {entry.own && <EntryCard who={reply ? "내 답장" : "내가 보낸 글"} content={entry.own} plan={plan} day={day} tone="bg-mist" own />}
    {entry.partner ? <EntryCard who={reply ? "상대의 답장" : "상대의 글"} content={entry.partner} plan={plan} day={day} tone="border border-lilac bg-card" mark={mark} /> : entry.own && <p className="rounded-2xl border border-dashed border-border p-5 text-xs leading-6 text-muted-foreground">{entry.partnerSent ? "상대도 보냈어요. 곧 함께 열려요." : past ? (reply ? "상대가 답장을 보내지 않아 열리지 않았어요." : "상대가 이날 글을 보내지 않아 열리지 않았어요.") : `상대가 보내면 함께 열려요. ${until}까지 기다려요.`}</p>}
  </div>;
}

// 편지 사진: 조용한 폴라로이드 틀(살짝 기울어 있다가 손이 가면 바로 선다). 누르면 크게 본다. 주소는 5분짜리로만 만든다.
function LetterPhoto({ path, caption, className = "" }: { path: string; caption: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  // 잠깐의 실패(temporary)는 다시 불러오기를, 볼 수 없거나 지워진 사진(gone)은 조용한 안내를 보여 준다(검수 C12).
  const [failed, setFailed] = useState<"" | "temporary" | "gone">("");
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => { let alive = true; setUrl(null); setFailed(""); void letterPhotoResult(path).then(result => { if (!alive) return; if (result.status === "ok") setUrl(result.url); else setFailed(result.status === "temporary-error" ? "temporary" : "gone"); }); return () => { alive = false; }; }, [path, attempt]);
  return <>
    <button type="button" disabled={!url} onClick={() => setOpen(true)} aria-label={`${caption} 사진 크게 보기`} className={`block w-40 -rotate-[1.5deg] bg-[#FFFEFA] p-2 pb-1.5 shadow-[0_18px_36px_-22px_rgba(30,20,80,0.6)] ring-1 ring-black/5 transition-transform duration-300 hover:rotate-0 focus-visible:rotate-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default motion-reduce:transition-none sm:w-44 ${className}`}>
      <span className="block aspect-[4/5] overflow-hidden bg-lilac">{url ? <img src={url} alt="" draggable={false} onContextMenu={event => event.preventDefault()} onError={() => { setUrl(null); setFailed("temporary"); }} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center px-3 text-center text-[11px] leading-5 text-[#1F1B33]/55">{failed === "gone" ? "지금은 사진을 볼 수 없어요" : failed ? "사진을 불러오지 못했어요" : "사진을 불러오는 중…"}</span>}</span>
      <span className="mt-1.5 block text-center text-[10px] font-semibold tracking-[0.12em] text-[#1F1B33]/55">{caption}</span>
    </button>
    {failed === "temporary" && <button type="button" onClick={() => { forgetLetterPhoto(path); setAttempt(value => value + 1); }} className={`mt-2 inline-flex min-h-11 items-center text-[11px] font-semibold text-primary underline-offset-4 hover:underline ${interaction}`}>다시 불러오기</button>}
    {open && url && <Lightbox url={url} caption={caption} onClose={() => setOpen(false)} />}
  </>;
}
function Lightbox({ url, caption, onClose }: { url: string; caption: string; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") close.current(); if (event.key === "Tab") { event.preventDefault(); closeButton.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; before?.focus?.(); };
  }, []);
  return <div role="dialog" aria-modal="true" aria-label={`${caption} 사진`} onClick={() => close.current()} className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(24,18,52,0.82)] p-4 backdrop-blur-sm">
    <figure onClick={event => event.stopPropagation()} className="max-w-3xl">
      <img src={url} alt={`${caption} 편지에 담긴 사진`} draggable={false} onContextMenu={event => event.preventDefault()} className="max-h-[80dvh] w-auto max-w-full bg-[#FFFEFA] object-contain p-2 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)]" />
      <figcaption className="mt-3 text-center text-xs tracking-[0.12em] text-white/80">{caption}</figcaption>
    </figure>
    <button ref={closeButton} type="button" aria-label="닫기" onClick={() => close.current()} className={`absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${interaction}`}><X size={18} /></button>
  </div>;
}

// 쓰다 만 편지·첫 장면 답은 이 기기에 회원별로 저장해 두고(backend/drafts · 14일 기한), 보내기에 성공했을 때만 지운다.
// 예시 보기: 그날 질문에 맞는 예시 답 몇 개를 읽기만 하게 보여 준다(편지에 넣거나 복사하는 버튼은 두지 않는다).
export function LetterExamples({ examples, className = "" }: { examples: readonly string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!examples.length) return null;
  return <div className={className}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className={`inline-flex min-h-11 items-center gap-1 rounded-full text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${interaction}`}>{open ? "예시 닫기" : "예시 보기"}<ChevronDown size={13} className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} /></button>
    {open && <ul aria-label="이 질문의 예시 답" className="mt-2 space-y-1.5 rounded-xl bg-mist px-4 py-3 text-xs leading-6 text-foreground/75">{examples.map(example => <li key={example}>“{example}”</li>)}</ul>}
  </div>;
}
function LetterComposer({ onSend, reply = false, draftKey, examples = [], photo, postcard = false }: { onSend: (body: string, photo: string | null, postcard?: boolean) => Promise<boolean>; reply?: boolean; draftKey: string; examples?: readonly string[]; photo?: { programId: string; day: number }; postcard?: boolean }) {
  const [body, setBody] = useState(() => readDraft(draftKey));
  // 한 줄 엽서(사흘 중 한 번): 편지 대신 5~80자 한 줄. 쓰던 편지는 그대로 남는다.
  const [card, setCard] = useState(false);
  const [line, setLine] = useState(() => readDraft(`${draftKey}:card`));
  useEffect(() => { const timer = window.setTimeout(() => writeDraft(`${draftKey}:card`, line), 400); return () => window.clearTimeout(timer); }, [line, draftKey]);
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState("");
  // 사진 한 장(선택): 고르면 바로 올려 두고 이 기기에 경로를 기억한다. 보내기 전에는 바꾸거나 뺄 수 있다.
  const photoKey = `${draftKey}:photo`;
  const [photoPath, setPhotoPath] = useState(() => photo ? readDraft(photoKey) : "");
  const [preview, setPreview] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { const timer = window.setTimeout(() => writeDraft(draftKey, body), 400); return () => window.clearTimeout(timer); }, [body, draftKey]);
  // 새로고침 전에 올려 둔 사진을 다시 보여 준다. 정말 지워진 사진만 빼고, 잠깐 못 불러온 것은 경로를 그대로 두고 다시 불러오기를 보여 준다(검수 C12).
  const [photoRetry, setPhotoRetry] = useState(0);
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
  useEffect(() => { if (!photoPath || preview) return; let alive = true; setPhotoLoadFailed(false); void letterPhotoResult(photoPath).then(result => { if (!alive) return; if (result.status === "ok") setPreview(result.url); else if (result.status === "deleted") { setPhotoPath(""); writeDraft(photoKey, ""); } else setPhotoLoadFailed(true); }); return () => { alive = false; }; }, [photoPath, photoRetry]);
  useEffect(() => () => { if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);
  const lastFile = useRef<File | null>(null);
  const pickPhoto = async (file?: File) => {
    if (!file || !photo) return;
    lastFile.current = file;
    setPhotoBusy(true); setPhotoError("");
    const result = await uploadLetterPhoto(photo.programId, photo.day, file);
    setPhotoBusy(false);
    if ("error" in result) { setPhotoError(navigator.onLine === false ? "인터넷 연결이 끊겨 사진을 올리지 못했어요. 연결되면 ‘다시 올리기’를 눌러 주세요. 쓰던 편지와 넣어 둔 사진은 그대로예요." : result.error); return; }
    lastFile.current = null;
    if (photoPath) void removeLetterPhoto(photoPath);
    setPhotoPath(result.path); writeDraft(photoKey, result.path); setPreview(URL.createObjectURL(result.blob));
  };
  const dropPhoto = () => { if (photoPath) void removeLetterPhoto(photoPath); setPhotoPath(""); setPreview(null); setPhotoError(""); writeDraft(photoKey, ""); };
  const length = Array.from(body.trim()).length, min = reply ? 1 : 20, max = reply ? 600 : 1000;
  const sweet = !reply && length >= 300 && length <= 600;
  const send = async () => {
    // 서버와 같은 기준으로 먼저 살펴, 보내기 실패 대신 무엇을 빼면 되는지 알려 준다.
    const problem = contactProblem(body);
    if (problem) { setWarning(problem); return; }
    if (navigator.onLine === false) { setWarning("인터넷 연결이 끊겨 있어요. 쓴 편지는 이 기기에 저장돼 있어요. 연결되면 다시 보내 주세요."); return; }
    setSending(true);
    if (await onSend(body, photo && photoPath ? photoPath : null)) { writeDraft(draftKey, ""); writeDraft(photoKey, ""); }
    setSending(false);
  };
  const lineLength = Array.from(line.trim()).length;
  const sendCard = async () => {
    const problem = contactProblem(line);
    if (problem) { setWarning(problem); return; }
    setSending(true);
    if (await onSend(line, null, true)) { writeDraft(`${draftKey}:card`, ""); setLine(""); }
    setSending(false);
  };
  if (card) return <div className="mt-5 space-y-3">
    <div className={`rounded-2xl p-5 ${POSTCARD_TONE.partner}`}>
      <p className="text-xs font-semibold text-[#5A4310] dark:text-[#F3D98A]">한 줄 엽서 · 사흘 중 한 번</p>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">바쁜 날에는 편지 대신 한 줄만 보내요. 엽서도 두 분 모두 보내면 편지처럼 함께 열려요.</p>
      <Input autoFocus aria-label="한 줄 엽서 쓰기" value={line} maxLength={POSTCARD_MAX} onChange={event => { setLine(event.target.value); setWarning(""); }} placeholder="예: 오늘은 바빴지만, 어제 편지 덕분에 웃었어요." className="mt-4 h-12 rounded-full border-[#EBD9A0] bg-card px-5 text-base font-normal md:text-sm dark:border-[#5A4C2A]" />
    </div>
    {warning && <p role="alert" className="text-xs leading-6 text-destructive">{warning}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{lineLength} / {POSTCARD_MAX}자{lineLength < POSTCARD_MIN ? ` · ${POSTCARD_MIN}자부터 보낼 수 있어요` : ""}</span>
      <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={sending} onClick={() => { setCard(false); setWarning(""); }} className="h-11 rounded-full px-4 text-xs text-muted-foreground">편지로 돌아가기</Button><Button disabled={sending || lineLength < POSTCARD_MIN} onClick={() => void sendCard()} className="h-11 rounded-full px-6">{sending ? "보내는 중…" : "엽서 보내기"}</Button></div>
    </div>
  </div>;
  return <div className="mt-5 space-y-3">
    {!reply && <LetterExamples examples={examples} />}
    <Textarea aria-label={reply ? "열린 편지에 답장 쓰기" : "오늘의 편지 쓰기"} value={body} onChange={event => { setBody(event.target.value); setWarning(""); }} maxLength={max} rows={reply ? 3 : 7} placeholder={reply ? "선택이에요. 짧게 한 줄도 괜찮아요." : "나를 소개하듯 편하게 적어 주세요. 보낸 뒤에는 고칠\u00a0수 없어요."} className="rounded-xl border-border bg-card text-base leading-7 md:text-sm" />
    {photo && <div className="rounded-2xl border border-dashed border-primary/30 bg-mist p-4">
      {preview ? <div className="flex flex-wrap items-end gap-4">
        <span className="block w-28 shrink-0 -rotate-[1.5deg] bg-[#FFFEFA] p-1.5 pb-4 shadow-[0_14px_28px_-18px_rgba(30,20,80,0.6)] ring-1 ring-black/5"><img src={preview} alt="편지에 넣을 사진" onError={() => { if (preview.startsWith("blob:")) return; setPreview(null); setPhotoLoadFailed(true); }} className="aspect-[4/5] w-full object-cover" /></span>
        <span className="min-w-0 flex-1 space-y-2"><span className="block text-xs font-semibold">사진 한 장을 함께 보내요</span><span className="block text-[11px] leading-5 text-muted-foreground">보내기 전에는 바꾸거나 뺄 수 있어요.</span><span className="flex flex-wrap gap-2"><Button variant="outline" disabled={photoBusy || sending} onClick={() => picker.current?.click()} className="h-9 rounded-full border-border px-4 text-xs">{photoBusy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}바꾸기</Button><Button variant="ghost" disabled={photoBusy || sending} onClick={dropPhoto} className="h-9 rounded-full px-3 text-xs text-muted-foreground"><X size={13} />빼기</Button></span></span>
      </div> : photoPath ? <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-xs leading-6"><span className="font-semibold">넣어 둔 사진이 있어요</span><br /><span className="text-muted-foreground">{photoLoadFailed ? "사진을 불러오지 못했어요. 사진은 그대로 함께 보내져요." : "사진을 불러오는 중…"}</span></p>
        <span className="flex flex-wrap gap-2">{photoLoadFailed && <Button variant="outline" onClick={() => { forgetLetterPhoto(photoPath); setPhotoRetry(value => value + 1); }} className="h-11 rounded-full border-border px-4 text-xs">다시 불러오기</Button>}<Button variant="ghost" disabled={sending} onClick={dropPhoto} className="h-9 rounded-full px-3 text-xs text-muted-foreground">사진 빼기</Button></span>
      </div> : <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-6"><span className="font-semibold">사진 한 장 · 선택</span><br /><span className="text-muted-foreground">편지와 어울리는 풍경·물건·요즘 좋아하는 장면이면 좋아요.</span></p>
        <Button variant="outline" disabled={photoBusy || sending} onClick={() => picker.current?.click()} className="h-10 rounded-full border-border px-4 text-xs">{photoBusy ? <><Loader2 size={13} className="animate-spin" />올리는 중…</> : <><ImagePlus size={13} />사진 넣기</>}</Button>
      </div>}
      <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void pickPhoto(file); }} />
      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">다른 사람의 얼굴, 연락처·QR·주소가 보이는 사진은 피해 주세요. 촬영 위치 같은 정보는 이 기기에서 지우고 올려요. 사진은 두 분의 편지가 함께 열린 뒤에만 상대에게 보여요.</p>
      {photoError && <p role="alert" className="mt-2 text-xs leading-6 text-destructive">{photoError}</p>}
      {photoError && lastFile.current && <Button variant="outline" disabled={photoBusy || sending} onClick={() => void pickPhoto(lastFile.current ?? undefined)} className="mt-2 h-11 rounded-full border-border px-4 text-xs">다시 올리기</Button>}
    </div>}
    {warning && <p role="alert" className="text-xs leading-6 text-destructive">{warning}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{length} / {reply ? `최대 ${max}` : max}자{!reply && (length < 20 ? " · 20자부터 보낼 수 있어요" : sweet ? " · 읽기 좋은 길이예요" : length < 300 ? " · 300~600자를 권해요" : "")}{body && " · 이 기기에 저장 중"}</span>
      <Button disabled={sending || photoBusy || length < min} onClick={() => void send()} className="h-11 rounded-full px-6">{sending ? "보내는 중…" : reply ? "답장 보내기" : "편지 보내기"}</Button>
    </div>
    {postcard && !reply && <button type="button" onClick={() => { setCard(true); setWarning(""); }} className={`inline-flex min-h-11 items-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline ${interaction}`}>오늘은 여유가 없나요? 한 줄 엽서로 보내기</button>}
  </div>;
}

// 고르는 칩. 장소 일곱 곳이 모두 나올 때는 늘 두 줄(전시 산책 서점 카페 / 공원·피크닉 시장 골목 작은 공연 · 직접 작성)로 나눈다.
// custom(입력 칸 예시)을 주면 끝에 ‘직접 작성’ 칩이 붙고, 고르면 짧은 입력 칸이 열린다(값은 'custom:' + 쓴 글).
const chipClass = (active: boolean) => `inline-flex items-center gap-1 rounded-full border px-4 py-2 text-sm ${interaction} ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"}`;
const customChipClass = (active: boolean) => `inline-flex items-center gap-1.5 rounded-full border border-dashed px-4 py-2 text-sm ${interaction} ${active ? "border-primary bg-primary text-primary-foreground" : "border-primary/40 bg-card text-foreground/80 hover:border-primary"}`;
function CustomField({ value, onChange, label, placeholder, max = SCENE_CUSTOM_MAX, focus = false }: { value: string; onChange: (text: string) => void; label: string; placeholder: string; max?: number; focus?: boolean }) {
  return <div className="flex items-center gap-2"><Input autoFocus={focus} value={value} maxLength={max} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={`${label} · 직접 작성`} className="h-10 max-w-xs flex-1 rounded-full border-primary/40 bg-card px-4 font-normal" /><span className="shrink-0 text-[11px] text-muted-foreground">{Array.from(value.trim()).length}/{max}</span></div>;
}
function Chips({ options, value, onPick, label, custom }: { options: [string, string][]; value?: string; onPick: (value: string) => void; label: string; custom?: string }) {
  const [touched, setTouched] = useState(false);
  const writing = !!custom && isCustom(value);
  // 휴대폰: 짧은 칩은 두 칸, 긴 칩은 한 줄에 하나씩. ‘직접 작성’은 칸이 맞으면 마지막 칸, 아니면 마지막 줄 전체(칩 하나만 떨어지지 않게). 넓은 화면은 지금처럼 흘려 놓는다.
  const short = options.every(([, text]) => Array.from(text).length <= 9);
  const align = short ? " justify-center" : " justify-start text-left";
  const ownSpan = short && options.length % 2 === 0 ? " col-span-2" : "";
  const flow = short ? "grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" : "grid gap-2 sm:flex sm:flex-wrap";
  const chip = ([key, text]: [string, string]) => <button key={key} type="button" aria-pressed={value === key} onClick={() => onPick(key)} className={chipClass(value === key) + align}>{isCustom(key) && <PenLine size={12} aria-hidden="true" />}{text}</button>;
  const own = custom ? <button key="custom" type="button" aria-pressed={writing} onClick={() => { setTouched(true); if (!writing) onPick(CUSTOM); }} className={customChipClass(writing) + " justify-center" + ownSpan}><PenLine size={13} aria-hidden="true" />직접 작성</button> : null;
  const field = writing ? <CustomField value={value!.slice(CUSTOM.length)} onChange={text => onPick(CUSTOM + text)} label={label} placeholder={custom!} focus={touched} /> : null;
  const allPlaces = options.length === ACTIVITY_OPTIONS.length && ACTIVITY_OPTIONS.every(([key]) => options.some(([option]) => option === key));
  if (allPlaces) return <div className="space-y-2" role="group" aria-label={label}><div className="grid grid-cols-2 gap-2 sm:block sm:space-y-2">{SCENE_ACTIVITY_ROWS.map((row, index) => <div key={row[0]} className="contents sm:flex sm:flex-wrap sm:gap-2">{row.map(key => chip(options.find(([option]) => option === key)!))}{index === SCENE_ACTIVITY_ROWS.length - 1 && own}</div>)}</div>{field}</div>;
  return <div className="space-y-2" role="group" aria-label={label}><div className={flow}>{options.map(chip)}{own}</div>{field}</div>;
}
const ACTIVITY_OPTIONS = Object.entries(SCENE_ACTIVITY_LABEL) as [string, string][];
const pairs = (items: readonly string[]) => items.map(item => [item, item] as [string, string]);
// 그날 쓰는 칸(서버도 이 칸만 저장한다). 고르는 칸은 직접 쓴 말을 정리해서 보낸다.
const SCENE_KEYS = [["activity", "about"], ["place", "flow", "rest", "reaction", "about"], ["topic", "reaction", "about"]];
const CHOICE_KEYS = ["activity", "place", "flow", "rest"];
// 고른 곳에 맞는 선택인지(직접 쓴 것은 20자 안이면 어디서나)
const stayOk = (place: string, key: "flows" | "rests", value?: string) => !!value && (isCustom(value) ? customOk(value) : !!stayFor(place)?.[key].includes(value));
// 직접 쓴 곳끼리는 글만 고쳐도 고른 머무는 방식·쉬어 갈 곳을 그대로 둔다.
const sameBase = (a?: string, b?: string) => a === b || (isCustom(a) && isCustom(b));

function SceneComposer({ day, draftKey, previous, first, comment, onSend }: { day: number; draftKey: string; previous?: ProgramEntry; first?: ProgramEntry; comment?: EntryContent | null; onSend: (body: string | null, payload: Record<string, string>) => Promise<boolean> }) {
  // 쓰던 답은 편지처럼 이 기기에 저장해 둔다.
  const [draft, setDraft] = useState<{ payload: Record<string, string>; body: string }>(() => { try { const saved = JSON.parse(readDraft(draftKey) || "null"); return saved && typeof saved === "object" ? { payload: saved.payload ?? {}, body: saved.body ?? "" } : { payload: {}, body: "" }; } catch { return { payload: {}, body: "" }; } });
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState("");
  const { payload, body } = draft;
  // 셋째 날 이야기: 예시 칩을 고르거나 ‘직접 작성’으로 쓴다.
  const [ownTopic, setOwnTopic] = useState(() => !!payload.topic && !(SCENE_TOPIC_EXAMPLES as readonly string[]).includes(payload.topic));
  const [topicTouched, setTopicTouched] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => writeDraft(draftKey, body.trim() || Object.values(payload).some(value => value.trim()) ? JSON.stringify(draft) : ""), 400); return () => window.clearTimeout(timer); }, [draft, draftKey]);
  const pick = (key: string, value: string) => { setWarning(""); setDraft(current => ({ ...current, payload: { ...current.payload, [key]: value } })); };
  const prompt = SCENE_PROMPTS[day - 1];
  const opened = !!previous?.own && !!previous?.partner;
  // 둘째 날 기준이 되는 곳(서버와 같은 기준): 첫날 답이 함께 열렸으면 두 분이 고른 곳, 아니면 내가 고른 곳, 그것도 없으면 일곱 곳(또는 직접 쓴 곳) 중에서 하나를 먼저 고른다.
  const ownFirst = first?.own?.payload?.activity, partnerFirst = first?.own && first?.partner ? first.partner.payload?.activity : undefined;
  const places = [...new Set([ownFirst, partnerFirst].filter((key): key is string => !!key && !!stayFor(key)))];
  const choosePlace = !places.length;
  const stayPlaces = choosePlace ? (payload.place && stayFor(tidyChoice(payload.place)) ? [payload.place] : []) : places;
  // 머무는 방식·쉬어 갈 곳은 한 곳을 기준으로 고른다(다른 곳의 칩을 누르면 그곳으로 바꾸고 다른 칸은 비운다).
  const pickStay = (place: string, key: "flow" | "rest", value: string) => { setWarning(""); setDraft(current => ({ ...current, payload: current.payload.place === place ? { ...current.payload, [key]: value } : { ...current.payload, place, flow: "", rest: "", [key]: value } })); };
  // 전날 답에 한마디를 남겼다면 오늘은 한마디를 다시 묻지 않는다(서버와 같은 기준).
  const clean: Record<string, string> = Object.fromEntries(SCENE_KEYS[day - 1].filter(key => !(key === "reaction" && comment)).map(key => [key, CHOICE_KEYS.includes(key) ? tidyChoice(payload[key]) : (payload[key] ?? "").trim()]).filter(([, value]) => value));
  const reason = day < 3 ? body.trim() : "";
  const activityOk = !!clean.activity && (!!SCENE_STAY[clean.activity] || customOk(clean.activity));
  const placeOk = !!clean.place && (choosePlace ? (!!SCENE_STAY[clean.place] || customOk(clean.place)) : places.includes(clean.place)) && stayOk(clean.place, "flows", clean.flow) && stayOk(clean.place, "rests", clean.rest);
  const needReaction = opened && !comment;
  const ready = !!clean.about && Array.from(reason).length <= SCENE_REASON_MAX && (day === 1 ? activityOk : day === 2 ? placeOk && (!needReaction || !!clean.reaction) : !!clean.topic && Array.from(clean.topic).length <= SCENE_TOPIC_MAX && (!needReaction || !!clean.reaction));
  const send = async () => {
    const problem = contactProblem(reason, ...Object.values(clean));
    if (problem) { setWarning(problem); return; }
    setSending(true);
    if (await onSend(reason || null, clean)) writeDraft(draftKey, "");
    setSending(false);
  };
  const field = (label: string, control: ReactNode) => <label className="grid gap-1.5 text-xs font-semibold">{label}{control}</label>;
  const theirs = previous?.partner;
  return <div className="mt-5 space-y-4">
    {day === 1 && <Chips label="끌리는 장소" options={ACTIVITY_OPTIONS} value={payload.activity} onPick={value => pick("activity", value)} custom="예: 보드게임 카페" />}
    {day === 2 && choosePlace && <div className="space-y-2"><p className="text-xs font-semibold">어느 곳을 떠올리며 고를까요?</p><Chips label="떠올릴 곳" options={ACTIVITY_OPTIONS} value={payload.place} custom="예: 보드게임 카페" onPick={value => { setWarning(""); setDraft(current => ({ ...current, payload: { ...current.payload, place: value, ...(sameBase(current.payload.place, value) ? {} : { flow: "", rest: "" }) } })); }} /></div>}
    {day === 2 && stayPlaces.map(place => { const stay = stayFor(tidyChoice(place))!; const name = sceneLabel(tidyChoice(place)); return <div key={isCustom(place) ? "custom" : place} className={`space-y-3 rounded-2xl border p-4 ${interaction} ${payload.place === place ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      {(stayPlaces.length > 1 || !choosePlace) && <p className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1 rounded-full bg-[#F8E5A6] px-2.5 py-1 text-[11px] font-semibold text-[#5A4310]">{isCustom(place) && <PenLine size={11} aria-hidden="true" />}{name}</span><span className="text-[11px] text-muted-foreground">{place === ownFirst && place === partnerFirst ? "두 분이 고른 곳" : place === ownFirst ? "내가 고른 곳" : "상대가 고른 곳"}</span></p>}
      {isCustom(place) && <p className="text-[11px] leading-5 text-muted-foreground">직접 쓴 곳이라 어디서나 어울리는 것 중에서 골라요. 마음에 드는 게 없으면 직접 써도 돼요.</p>}
      <p className="text-xs font-semibold">머무는 방식</p><Chips label={`${name} · 머무는 방식`} options={pairs(stay.flows)} value={payload.place === place ? payload.flow : undefined} onPick={value => pickStay(place, "flow", value)} custom="예: 보드게임 하나 같이 하기" />
      <p className="text-xs font-semibold">쉬어 갈 곳</p><Chips label={`${name} · 쉬어 갈 곳`} options={pairs(stay.rests)} value={payload.place === place ? payload.rest : undefined} onPick={value => pickStay(place, "rest", value)} custom="예: 창가 자리" />
    </div>; })}
    {day === 2 && stayPlaces.length > 1 && <p className="text-[11px] leading-5 text-muted-foreground">두 곳 중 한 곳을 정해, 그곳에서 머무는 방식과 쉬어 갈 곳을 골라 주세요.</p>}
    {day < 3 && field("고른 이유 한 줄(선택)", <Input value={body} maxLength={SCENE_REASON_MAX} onChange={event => { setWarning(""); setDraft(current => ({ ...current, body: event.target.value })); }} placeholder={prompt.reasonHint} className="h-11 rounded-xl border-border bg-card font-normal" />)}
    {day === 3 && <div className="space-y-2"><p className="text-xs font-semibold">나누고 싶은 이야기</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="나누고 싶은 이야기">{SCENE_TOPIC_EXAMPLES.map(example => <button key={example} type="button" aria-pressed={!ownTopic && payload.topic === example} onClick={() => { setOwnTopic(false); pick("topic", example); }} className={chipClass(!ownTopic && payload.topic === example)}>{example}</button>)}<button type="button" aria-pressed={ownTopic} onClick={() => { setTopicTouched(true); if (!ownTopic) { setOwnTopic(true); pick("topic", ""); } }} className={customChipClass(ownTopic)}><PenLine size={13} aria-hidden="true" />직접 작성</button></div>
      {ownTopic && <CustomField value={payload.topic ?? ""} onChange={text => pick("topic", text)} label="나누고 싶은 이야기" placeholder="예: 요즘 가장 오래 머문 장소 이야기" max={SCENE_TOPIC_MAX} focus={topicTouched} />}
    </div>}
    {day > 1 && theirs && <div className="rounded-2xl bg-mist p-4"><p className="text-[11px] font-semibold text-muted-foreground">어제 상대가 고른 것</p><SceneLine payload={theirs.payload} className="mt-1 text-sm font-semibold" />{theirs.body && <p className="mt-1 text-xs leading-6 text-muted-foreground">고른 이유 · “{theirs.body}”</p>}{comment && <p className="mt-2 border-t border-border/70 pt-2 text-xs leading-6"><span className="text-muted-foreground">어제 남긴 한마디 · </span>“{comment.body}”</p>}</div>}
    {day > 1 && !comment && field(opened ? prompt.reaction : prompt.reactionAlt, <Input value={payload.reaction ?? ""} maxLength={150} onChange={event => pick("reaction", event.target.value)} placeholder={opened ? (day === 2 ? "예: 서점이라니, 요즘 읽는 책이 궁금해졌어요" : "예: 천천히 머무는 거 저도 좋아요") : "예: 조용한 곳을 좋아하실 것 같아요"} className="h-11 rounded-xl border-border bg-card font-normal" />)}
    {field(prompt.about, <Input value={payload.about ?? ""} maxLength={100} onChange={event => pick("about", event.target.value)} placeholder={prompt.aboutHint} className="h-11 rounded-xl border-border bg-card font-normal" />)}
    {ready && <div><p className="mb-2 text-[11px] font-semibold text-muted-foreground">상대에게는 이렇게 보여요</p><EntryCard who="내 답" content={{ body: reason || null, payload: clean, at: "" }} plan="B" day={day} tone="bg-mist" /></div>}
    <p className="text-[11px] leading-5 text-muted-foreground">{prompt.sees} 보낸 뒤에는 고칠&nbsp;수 없어요.</p>
    {warning && <p role="alert" className="text-xs leading-6 text-destructive">{warning}</p>}
    <div className="flex justify-end"><Button disabled={!ready || sending} onClick={() => void send()} className="h-11 rounded-full px-6">{sending ? "보내는 중…" : "보내기"}</Button></div>
  </div>;
}

// B 한마디: 함께 열린 글에 한 번, 짧게. 이미 함께 열린 글에 건네는 말이라 남기는 즉시 상대에게 보인다.
function Comments({ program, act, on, day, until, open }: { program: Program; act: Act; on: "scene" | "piece"; day: number; until: string; open: boolean }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState("");
  const entry = program.entries.find(item => item.kind === (on === "scene" ? "comment" : "piece-comment") && item.day === day);
  const own = entry?.own, theirs = entry?.partner;
  if (!open && !own && !theirs) return null;
  const send = async () => {
    const problem = contactProblem(body);
    if (problem) { setWarning(problem); return; }
    setSending(true);
    if (await act(() => leaveComment(program.id, on, on === "scene" ? day : null, body), "남겼어요.")) setBody("");
    setSending(false);
  };
  const bubble = (who: string, content: EntryContent, mine: boolean) => <div className={`w-fit max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${mine ? "ml-auto rounded-br-md bg-mist" : "rounded-bl-md border border-lilac bg-card"}`}><p className="text-[11px] font-semibold text-muted-foreground">{who}{content.at && ` · ${kstDateTime(content.at)}`}</p><p className="mt-1 whitespace-pre-wrap">{content.body}</p></div>;
  return <div className="mt-5 border-t border-border pt-4">
    <p className="text-xs font-semibold text-accent">한마디 · 한 번 · {until}까지</p>
    {(theirs || own) && <div className="mt-3 space-y-2">{theirs && bubble("상대의 한마디", theirs, false)}{own && bubble("내 한마디", own, true)}</div>}
    {open && !own && <div className="mt-3 space-y-2">
      <p className="text-xs leading-6 text-muted-foreground">{theirs ? "나도 한마디 남겨 볼까요? 남기면 바로 상대에게 보여요." : on === "piece" ? "상대가 그린 장면에 짧게 한마디 남겨요. 남기면 바로 상대에게 보여요." : day < 3 ? "상대의 선택에 짧게 한마디 남겨요. 남기면 바로 상대에게 보이고, 다음 날 답에서는 한마디를 다시 묻지 않아요." : "상대의 선택에 짧게 한마디 남겨요. 남기면 바로 상대에게 보여요."}</p>
      <div className="flex gap-2"><Input aria-label={on === "piece" ? "첫 장면 이야기에 한마디" : `DAY 0${day} 답에 한마디`} value={body} maxLength={COMMENT_MAX} onChange={event => { setBody(event.target.value); setWarning(""); }} placeholder={on === "piece" ? "예: 그 장면, 상상만 해도 편해져요" : "예: 그곳 저도 꼭 가 보고 싶었어요"} className="h-11 min-w-0 flex-1 rounded-full border-border bg-card px-4 font-normal" /><Button disabled={sending || !body.trim()} onClick={() => void send()} className="h-11 shrink-0 rounded-full px-5">{sending ? "남기는 중…" : "남기기"}</Button></div>
      {warning && <p role="alert" className="text-xs leading-6 text-destructive">{warning}</p>}
    </div>}
  </div>;
}

// 가능한 때 고르기: 내일부터 10일 · 낮(12~15시)·오후(15~18시)·저녁(18~21시). 두 분 모두 만나고 싶을 때 겹치는 시간만 보여 줘요.
function AvailabilityPicker({ program, value, onChange, region, onRegion }: { program: Program; value: string[]; onChange: (update: (current: string[]) => string[]) => void; region: string; onRegion: (next: string) => void }) {
  const days = Array.from({ length: 10 }, (_, index) => shift(program.today, index + 1));
  const toggle = (slot: string) => onChange(current => current.includes(slot) ? current.filter(item => item !== slot) : [...current, slot]);
  return <div className="space-y-4">
    <div>
      <p className="text-xs font-semibold">만날 수 있는 때 <span className="font-normal text-muted-foreground">(선택 · 여러 개)</span></p>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">두 분 모두 만나고 싶다면, 겹치는 시간만 보여 드려요. 한 번 누르면 약속이 정해져요. 상대가 고른 다른 시간은 보이지 않아요.</p>
      <ul className="mt-3 divide-y divide-border rounded-2xl border border-border">{days.map(date => <li key={date} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-2.5"><span className="shrink-0 text-xs sm:w-28">{dayLabel(date)}</span><span className="flex gap-1.5">{AVAIL_BANDS.map(band => { const slot = `${date}|${band.id}`; const on = value.includes(slot); return <button key={band.id} type="button" aria-pressed={on} aria-label={`${dayLabel(date)} ${band.label} ${band.start}~${band.end}`} onClick={() => toggle(slot)} className={`h-9 rounded-full border px-3 text-[11px] ${interaction} ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"}`}>{band.label}</button>; })}</span></li>)}</ul>
      <p className="mt-2 text-[11px] text-muted-foreground">낮 12~15시 · 오후 15~18시 · 저녁 18~21시{value.length ? ` · ${value.length}개 골랐어요` : ""}</p>
    </div>
    <label className="grid gap-1.5 text-xs font-semibold">만나기 편한 지역·역 <span className="sr-only">(선택)</span><Input value={region} maxLength={40} onChange={event => onRegion(event.target.value)} placeholder="예: 합정역 근처 (선택)" className="h-11 rounded-xl border-border bg-card font-normal" /></label>
  </div>;
}

function MeetingDecision({ program, act }: { program: Program; act: Act }) {
  const [confirm, setConfirm] = useState<"positive" | "negative" | null>(null);
  const [avail, setAvail] = useState<string[]>(program.ownAvailability ?? []);
  const [region, setRegion] = useState(program.ownRegion ?? "");
  const [editing, setEditing] = useState(false);
  // 사흘 동안 함께 열린 글이 하나도 없었는지
  const nothingOpened = !program.entries.some(entry => (entry.kind === "letter" || entry.kind === "scene") && !!entry.own && !!entry.partner);
  return <Sheet className="p-6 sm:p-8">
    <Eyebrow mark="04" label="만남 선택" en="넷째 날" />
    {program.partnerMark && <BookmarkReveal text={program.partnerMark} partner={program.partnerName ?? "상대"} />}
    {program.ownMeeting ? <p className="mt-4 text-sm leading-7">{program.ownMeeting === "positive" ? "만나고 싶다고 답했어요." : "이번에는 여기까지라고 답했어요."} {program.ownMeeting === "positive" ? `두 분 모두 만나고 싶으면 그 순간 약속 정하기가 열려요. 아니면 ${program.meetingBy ? kstDateTime(program.meetingBy) : "만남 선택 마감"}에 마무리 소식을 알려 드려요.` : `이번 교류는 ${program.meetingBy ? kstDateTime(program.meetingBy) : "만남 선택 마감"}에 마무리돼요.`} 상대가 이미 골랐는지는 알려 드리지 않아요.</p> : <>
      {nothingOpened && <p className="mt-4 rounded-2xl bg-mist p-4 text-sm leading-7">사흘 동안 함께 열린 글은 없었어요. 바쁜 날이 겹쳤을 수도 있어요. 그래도 한 번 만나 보고 싶은 마음이 있다면, 그 마음대로 골라 주세요.</p>}
      <p className="mt-4 text-sm leading-7 text-muted-foreground">{program.meetingBy && `${kstDateTime(program.meetingBy)}까지`} 골라 주세요. 상대가 먼저 골랐는지는 서로 알 수 없고, 두 분 모두 ‘만나고 싶어요’일 때만 약속을 정해요. 답은 바꿀 수 없어요.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{([["positive", "만나고 싶어요", "약속 날짜·장소를 함께 정해요."], ["negative", "이번에는 여기까지", "상대에게 내 답은 알리지 않아요."]] as const).map(([value, title, sub]) => <button key={value} type="button" aria-pressed={confirm === value} onClick={() => setConfirm(value)} className={choice(confirm === value)}><span className="font-semibold">{title}</span><span className="mt-1 block text-xs text-muted-foreground">{sub}</span></button>)}</div>
      {confirm === "positive" && <div className="mt-5 rounded-2xl bg-mist p-4 sm:p-5"><AvailabilityPicker program={program} value={avail} onChange={setAvail} region={region} onRegion={setRegion} /></div>}
      {confirm && <div className="mt-5 flex justify-end"><Button onClick={() => void act(() => chooseMeeting(program.id, confirm, avail, region), "답을 남겼어요.")} className="h-11 rounded-xl px-6">이 답으로 보내기</Button></div>}
    </>}
    {program.ownMeeting === "positive" && <div className="mt-5 border-t border-border pt-4">
      {editing ? <><AvailabilityPicker program={program} value={avail} onChange={setAvail} region={region} onRegion={setRegion} /><div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => { setEditing(false); setAvail(program.ownAvailability ?? []); setRegion(program.ownRegion ?? ""); }} className="h-10">닫기</Button><Button onClick={async () => { if (await act(() => setAvailability(program.id, avail, region), "가능한 때를 고쳤어요.")) setEditing(false); }} className="h-10 rounded-xl px-5">저장하기</Button></div></>
        : <p className="flex flex-wrap items-center justify-between gap-3 text-xs leading-6 text-muted-foreground"><span>만날 수 있는 때 {program.ownAvailability?.length ? `${program.ownAvailability.length}개` : "아직 고르지 않았어요"}{program.ownRegion ? ` · ${program.ownRegion}` : ""}</span><button type="button" onClick={() => setEditing(true)} className="font-semibold text-primary underline-offset-4 hover:underline">{program.ownAvailability?.length ? "고치기" : "골라 두기"}</button></p>}
    </div>}
  </Sheet>;
}

// 지난 교류 다시 읽기: 넷째 날 두 분 모두 만나고 싶다고 했던 교류는 새 교류가 시작돼도 마무리 후 30일 동안 다시 읽을 수 있다.
const pastProgram = (item: ReadableProgram): Program => ({ ...item, agreeBy: item.closedAt, ownConfirmed: true, partnerConfirmed: true, startedAt: null, day: null, meetingOpensAt: null, meetingBy: null, ownMeeting: "positive", arrangeBy: null, meetingTime: null, proposals: [], ownContact: false, contactReleaseAt: null, contactUntil: null, contactReleased: false, partnerPhone: null });
const readOnly: Act = async () => false;
function PastExchanges({ items }: { items: ReadableProgram[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!items.length) return null;
  const opened = items.find(item => item.id === openId);
  return <>
    <Sheet tone="soft" className="p-6 sm:p-8">
      <Eyebrow label="지난 교류 다시 읽기" en="LOOK BACK" />
      <p className="mt-3 text-xs leading-6 text-muted-foreground">넷째 날 두 분 모두 만나고 싶다고 했던 교류는, 마무리된 뒤 30일 동안 주고받은 글을 다시 읽을 수 있어요.</p>
      <ul className="mt-5 space-y-2">{items.map(item => <li key={item.id}><button type="button" aria-expanded={openId === item.id} onClick={() => setOpenId(current => current === item.id ? null : item.id)} className={`flex w-full items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 text-left ${interaction} ${openId === item.id ? "border-primary/40" : "border-border hover:border-primary/40"}`}>
        <span className="min-w-0"><span className="block text-sm font-semibold">{item.partnerName ?? "상대"} 님과의 교류{item.ownPlan && <span className="font-normal text-muted-foreground"> · {planName(item.ownPlan)}</span>}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{item.startOn && `${dayLabel(item.startOn)} 시작 · `}{kstDateTime(item.readableUntil)}까지 읽을 수 있어요</span></span>
        <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${openId === item.id ? "rotate-180" : ""}`} />
      </button></li>)}</ul>
    </Sheet>
    {opened && <div className="space-y-6" aria-label={`${opened.partnerName ?? "상대"} 님과 주고받은 글`}>
      {opened.ownPlan === "B" && <FirstScene key={`scene:${opened.id}`} program={pastProgram(opened)} act={readOnly} />}
      <Days key={`days:${opened.id}`} program={pastProgram(opened)} act={readOnly} />
      <PreludeLetters program={pastProgram(opened)} />
      <BookCard key={`book:${opened.id}`} program={pastProgram(opened)} />
    </div>}
  </>;
}

// 두 점: 두 분 모두 쓴 날마다 한 걸음씩 가까워진다(로고의 두 점). 넷째 날 두 분 모두 만나고 싶으면 약속 화면에서 겹친다.
function DotsTrack({ step }: { step: number }) {
  const [shown, setShown] = useState(Math.max(0, step - 1));
  useEffect(() => { const timer = window.setTimeout(() => setShown(step), 300); return () => window.clearTimeout(timer); }, [step]);
  const offset = [28, 20, 13, 7][Math.min(shown, 3)];
  return <span role="img" aria-label={step ? `함께 연 날 ${step}일 · 두 점이 ${step}걸음 가까워졌어요` : "두 점이 아직 떨어져 있어요"} className="relative inline-flex h-4 w-20 items-center justify-center">
    {[-offset, offset].map((x, index) => <span key={index} className={`absolute size-2.5 rounded-full ${index ? "bg-accent" : "bg-primary"} transition-transform duration-[1400ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none`} style={{ transform: `translateX(${x}px)` }} />)}
  </span>;
}

// 셋째 날 질문(A · 선택): 둘째 날 09:00~셋째 날 09:00에 상대에게 물을 질문을 낸다. 내지 않으면 원래 질문 그대로.
function AskBox({ program, act, open }: { program: Program; act: Act; open: boolean }) {
  const partner = program.partnerName ?? "상대";
  const own = program.ownAsk ?? null;
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState(own ?? "");
  if (!open) return own ? <p className="mt-6 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">셋째 날 {partner} 님에게 낸 질문 · “{own}”</p> : null;
  const length = Array.from(text.trim()).length;
  const save = async (value: string) => { if (await act(() => setDay3Question(program.id, value), value.trim() ? `내일 09:00, ${partner} 님의 셋째 날 질문이 이 질문으로 바뀌어요.` : "셋째 날은 원래 질문으로 이어져요.")) setWriting(false); };
  const ideaClass = (active: boolean) => `rounded-full border px-3 py-1.5 text-xs ${interaction} ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"}`;
  return <div className="mt-6 border-t border-border pt-5">
    <p className="text-xs font-semibold text-accent">셋째 날 질문 · 선택 · {program.startOn && dayLabel(shift(program.startOn, 2))} 09:00 전까지</p>
    {own && !writing ? <>
      <p className="mt-3 text-sm leading-7">내일 아침, {partner} 님은 이 질문에 답해요.</p>
      <p className="mt-2 rounded-2xl bg-mist px-4 py-3 text-sm font-semibold leading-7">“{own}”</p>
      <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setText(own); setWriting(true); }} className="h-10 rounded-full border-border px-4 text-xs">고치기</Button><Button variant="ghost" onClick={() => void save("")} className="h-10 rounded-full px-4 text-xs text-muted-foreground">원래 질문으로</Button></div>
    </> : !writing ? <>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">셋째 날 질문을 {partner} 님에게 직접 낼 수 있어요. 내면 {partner} 님의 셋째 날 질문이 내가 낸 질문으로 바뀌고, 내지 않으면 원래 질문 그대로예요.</p>
      <Button variant="outline" onClick={() => setWriting(true)} className="mt-3 h-10 rounded-full border-border px-4 text-xs"><PenLine size={13} />질문 직접 내기</Button>
    </> : <>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="질문 고르기">{ASK_IDEAS.map(idea => <button key={idea} type="button" aria-pressed={text === idea} onClick={() => setText(idea)} className={ideaClass(text === idea)}>{idea}</button>)}</div>
      <div className="mt-3 flex gap-2"><Input aria-label="셋째 날 질문 직접 쓰기" value={text} maxLength={ASK_MAX} onChange={event => setText(event.target.value)} placeholder="직접 써도 돼요" className="h-11 min-w-0 flex-1 rounded-full border-border bg-card px-4 font-normal" /><Button disabled={length < ASK_MIN} onClick={() => void save(text)} className="h-11 shrink-0 rounded-full px-5">질문 내기</Button></div>
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{length} / {ASK_MAX}자 · 지난 연애·수입·외모·집안·종교·정치는 묻지 않아요. 내일 09:00 전까지 고치거나 뺄 수 있어요.</p>
      <button type="button" onClick={() => { setWriting(false); setText(own ?? ""); }} className="mt-1 text-xs text-muted-foreground hover:text-foreground">닫기</button>
    </>}
  </div>;
}

// 넷째 날 아침의 책갈피: 상대가 사흘 동안 읽으며 밑줄 그은 내 문장(만남을 고르기 전에 먼저 보인다).
function BookmarkReveal({ text, partner }: { text: string; partner: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setOn(true), 350); return () => window.clearTimeout(timer); }, []);
  return <div className="mt-5 rounded-2xl border border-lilac bg-card p-5">
    <p className="flex items-center gap-2 text-xs font-semibold text-accent"><Highlighter size={13} aria-hidden="true" />넷째 날 아침의 책갈피</p>
    <p className="mt-1 text-xs leading-6 text-muted-foreground">{partner} 님이 사흘 동안 읽으며 밑줄 그은 내 문장이에요.</p>
    <p className="mt-3 text-[15px] leading-8"><span className={`soft-underline ${on ? "is-on" : ""}`}>{text}</span></p>
  </div>;
}

// 아직 모르는 당신에게: 소개 전에 써 둔 편지. 두 분이 서로를 고른 순간 전해졌다.
function PreludeLetters({ program }: { program: Program }) {
  const [showOwn, setShowOwn] = useState(false);
  const prelude = program.prelude;
  if (!prelude?.partner && !prelude?.own) return null;
  const partner = program.partnerName ?? "상대";
  return <Sheet className="p-6 sm:p-8">
    <Eyebrow label="아직 모르는 당신에게" en="BEFORE WE MET" />
    {prelude.partner ? <>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{partner} 님이 누구를 만날지 모를 때 써 둔 편지예요. 두 분이 서로를 고른 순간 전해졌어요.</p>
      <article className="mt-5 rounded-2xl border border-lilac bg-card p-5"><p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{partner} 님이 써 둔 편지</p><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{prelude.partner}</p></article>
    </> : <p className="mt-3 text-sm leading-7 text-muted-foreground">소개 전에 써 둔 내 편지가 {partner} 님께 전해졌어요.</p>}
    {prelude.own && (showOwn ? <article className="mt-3 rounded-2xl bg-mist p-5"><p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">내가 써 둔 편지</p><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{prelude.own}</p></article>
      : <button type="button" onClick={() => setShowOwn(true)} className={`mt-4 text-xs font-semibold text-primary underline-offset-4 hover:underline ${interaction}`}>내가 써 둔 편지 보기</button>)}
  </Sheet>;
}

// 우리의 사흘, 한 권: 넷째 날 두 분 모두 만나고 싶다고 한 교류에서, 두 분 모두 동의하면 펼칠 수 있다(인쇄·PDF 저장).
function BookCard({ program }: { program: Program }) {
  const [state, setState] = useState({ ownBook: !!program.ownBook, bookOpen: !!program.bookOpen });
  // 서버 값이 바뀌면(상대의 동의·철회) 따라간다(검수 C8). 한 권이 닫히면 펼친 창도 닫는다.
  useEffect(() => setState({ ownBook: !!program.ownBook, bookOpen: !!program.bookOpen }), [program.ownBook, program.bookOpen]);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!state.bookOpen) setOpen(false); }, [state.bookOpen]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const toggle = async (on: boolean) => {
    setBusy(true);
    const result = await setBookConsent(program.id, on);
    setBusy(false);
    if (result.error || !result.data) { setMessage(result.error || "저장하지 못했어요."); return; }
    setState(result.data);
    setMessage(result.data.bookOpen ? "두 분 모두 동의해서 한 권이 열렸어요." : on ? "동의했어요. 상대도 동의하면 열려요." : "동의를 거두었어요.");
  };
  return <Sheet tone="soft" className="p-6 sm:p-8">
    <Eyebrow label="우리의 사흘, 한 권" en="KEEPSAKE" />
    <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">두 분 모두 동의하면 사흘 동안 나눈 글을 표지 있는 한 권으로 펼쳐 볼 수 있어요. 인쇄하거나 PDF로 저장할 수 있어요. 두 분이 동의한 사흘의 글만 담기고, 사진·연락처·상대 프로필은 넣지 않아요(상대 프로필과 사진은 저장하지 않아요). 교류가 마무리되고 30일이 지나면 다시 읽기와 함께 닫히니, 남기고 싶다면 그 전에 저장해 주세요.</p>
    <div className="mt-5 flex flex-wrap items-center gap-2">
      {state.bookOpen ? <Button onClick={() => setOpen(true)} className="h-11 rounded-full px-6"><BookOpen size={15} />한 권 펼치기</Button>
        : state.ownBook ? <span className={butter}>동의했어요 · 상대도 동의하면 열려요</span>
        : <Button disabled={busy} onClick={() => void toggle(true)} className="h-11 rounded-full px-6">한 권으로 남기기에 동의</Button>}
      {state.ownBook && <Button variant="ghost" disabled={busy} onClick={() => void toggle(false)} className="h-10 rounded-full px-4 text-xs text-muted-foreground">동의 거두기</Button>}
    </div>
    {message && <p role="status" className="mt-3 text-xs text-primary">{message}</p>}
    {open && <BookView program={program} onClose={() => setOpen(false)} />}
  </Sheet>;
}

function BookView({ program, onClose }: { program: Program; onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  const dialog = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLParagraphElement>(null);
  // 열리면 제목으로 초점을 옮기고, Tab은 창 안에서만 돌며, 닫히면 ‘한 권 펼치기’ 버튼으로 돌아간다(검수 D4).
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    document.body.classList.add("printing-book");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    title.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { close.current(); return; }
      if (event.key !== "Tab" || !dialog.current) return;
      const items = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const inside = dialog.current.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !inside)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.classList.remove("printing-book"); document.body.style.overflow = overflow; window.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, []);
  const me = program.ownName ?? "나", you = program.partnerName ?? "상대";
  const plan = program.ownPlan ?? "A";
  const find = (day: number, kind: string) => program.entries.find(entry => entry.day === day && entry.kind === kind);
  const isOpen = (entry?: ProgramEntry) => !!entry?.own && !!entry?.partner;
  const page = "book-page px-8 py-14 sm:px-14";
  const quiet = "text-[#6B6480]";
  const heading = (en: string, title: string) => <header><p className={`text-[10px] font-semibold tracking-[0.3em] ${quiet}`}>{en}</p><h2 className="mt-3 text-xl font-semibold leading-[1.5]">{title}</h2></header>;
  const block = (who: string, content: EntryContent | null | undefined, extra = "") => content && (content.body || content.payload) ? <div className="mt-7"><p className={`text-[11px] font-semibold tracking-[0.12em] ${quiet}`}>{who}{content.payload?.postcard === "1" ? " · 한 줄 엽서" : ""}{extra}</p>
    {plan === "B" && content.payload && sceneSummary(content.payload) && <p className="mt-2 text-sm font-semibold leading-7">{sceneSummary(content.payload)}</p>}
    {content.body && <p className="mt-2 whitespace-pre-wrap text-[15px] leading-8">{content.body}</p>}
    {plan === "B" && content.payload?.about && <p className="mt-2 text-[15px] leading-8">{content.payload.about}</p>}
  </div> : null;
  const final = program.entries.find(entry => entry.kind === "final");
  const piece = program.entries.find(entry => entry.kind === "piece");
  return createPortal(<div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="book-title" className="book-print-root fixed inset-0 z-[70] overflow-y-auto bg-[#F1EEF7] text-[#1F1B33]">
    <div className="book-toolbar sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-black/5 bg-[#F1EEF7]/90 px-4 py-3 backdrop-blur sm:px-8">
      <p ref={title} id="book-title" tabIndex={-1} className="text-xs font-semibold outline-none">우리의 사흘, 한 권</p>
      <div className="flex gap-2"><Button onClick={() => window.print()} className="h-10 rounded-full px-4 text-xs"><Printer size={14} />인쇄·PDF로 저장</Button><Button variant="outline" onClick={() => close.current()} className="h-10 rounded-full border-black/10 bg-white px-4 text-xs text-[#1F1B33] hover:bg-white/80 hover:text-[#1F1B33]"><X size={14} />닫기</Button></div>
    </div>
    <article className="book-paper mx-auto my-8 max-w-2xl bg-[#FFFEFA] shadow-[0_30px_60px_-40px_rgba(30,20,80,0.45)]">
      <section className={`${page} flex min-h-[78vh] flex-col items-center justify-center text-center`}>
        <span aria-hidden="true" className="relative flex h-10 w-20 items-center justify-center"><span className="absolute size-8 -translate-x-2.5 rounded-full bg-primary/85" /><span className="absolute size-8 translate-x-2.5 rounded-full bg-accent/70" /></span>
        <p className={`mt-10 text-[10px] font-semibold tracking-[0.3em] ${quiet}`}>OUR THREE DAYS</p>
        <h1 className="mt-4 text-3xl font-semibold">우리의 사흘</h1>
        <p className="mt-4 text-base">{me} · {you}</p>
        {program.startOn && <p className={`mt-2 text-xs ${quiet}`}>{dayLabel(program.startOn)} – {dayLabel(shift(program.startOn, 2))}</p>}
        {program.echo && <div className="mt-10 space-y-2 text-sm leading-7"><p>“{program.echo.partner}”</p><p>“{program.echo.own}”</p><p className={`text-[11px] ${quiet}`}>닮은 두 문장</p></div>}
        <p className={`mt-16 text-[10px] font-semibold tracking-[0.3em] ${quiet}`}>FLAVIE</p>
      </section>
      {(program.prelude?.own || program.prelude?.partner) && <section className={page}>{heading("BEFORE WE MET", "아직 모르는 당신에게")}{block(`${you} · 소개 전에 써 둔 편지`, program.prelude?.partner ? { body: program.prelude.partner, payload: null, at: "" } : null)}{block(`${me} · 소개 전에 써 둔 편지`, program.prelude?.own ? { body: program.prelude.own, payload: null, at: "" } : null)}</section>}
      {[1, 2, 3].map(day => {
        const kind = plan === "A" ? "letter" : "scene";
        const main = find(day, kind), reply = find(day, "reply");
        const prompt = plan === "A" ? letterPrompt(day, day === 1 || isOpen(find(day - 1, kind)), program.letterSet) : SCENE_PROMPTS[day - 1];
        return <section key={day} className={page}>
          {heading(`DAY 0${day}`, prompt.title)}
          <p className={`mt-3 text-sm leading-7 ${quiet}`}>{prompt.question}</p>
          {plan === "A" && day === 3 && (program.ownAsk || program.partnerAsk) && <ul className={`mt-3 space-y-1 text-xs leading-6 ${quiet}`}>{program.partnerAsk && <li>{you}의 질문 · “{program.partnerAsk}”</li>}{program.ownAsk && <li>{me}의 질문 · “{program.ownAsk}”</li>}</ul>}
          {isOpen(main) ? <>{block(me, main!.own)}{block(you, main!.partner)}</> : <p className={`mt-7 text-sm ${quiet}`}>이날은 두 분의 글이 함께 열리지 않았어요.</p>}
          {plan === "A" && isOpen(reply) && <>{block(me, reply!.own, " · 답장")}{block(you, reply!.partner, " · 답장")}</>}
        </section>;
      })}
      {plan === "B" && (final?.own?.payload || isOpen(piece)) && <section className={page}>{heading("FIRST SCENE", "함께 맞춘 첫 장면")}{final?.own?.payload && <p className="mt-5 text-[15px] font-semibold leading-8">{sceneSummary(final.own.payload)}</p>}{isOpen(piece) && <>{block(me, piece!.own)}{block(you, piece!.partner)}</>}</section>}
      {(program.ownMark || program.partnerMark) && <section className={page}>{heading("BOOKMARKS", "서로 밑줄 그은 문장")}
        {program.ownMark && <div className="mt-7"><p className={`text-[11px] font-semibold tracking-[0.12em] ${quiet}`}>{me}의 책갈피 · {you}의 글에서</p><p className="mt-2 text-[15px] leading-8"><span className="soft-underline is-on">{program.ownMark}</span></p></div>}
        {program.partnerMark && <div className="mt-7"><p className={`text-[11px] font-semibold tracking-[0.12em] ${quiet}`}>{you}의 책갈피 · {me}의 글에서</p><p className="mt-2 text-[15px] leading-8"><span className="soft-underline is-on">{program.partnerMark}</span></p></div>}
      </section>}
      <section className={`${page} text-center`}>
        <span aria-hidden="true" className="relative mx-auto flex h-6 w-12 items-center justify-center"><span className="absolute size-4 -translate-x-1 rounded-full bg-primary/85" /><span className="absolute size-4 translate-x-1 rounded-full bg-accent/70" /></span>
        <p className="mt-6 text-base font-semibold leading-8">넷째 날, 두 분 모두 만나고 싶다고 했어요.</p>
        {program.meetingOn && <p className={`mt-2 text-sm ${quiet}`}>{dayLabel(program.meetingOn)}에 만나기로 했어요.</p>}
        <p className={`mt-10 text-[11px] leading-5 ${quiet}`}>두 분이 모두 동의해서 만든 한 권이에요. 사진과 연락처는 넣지 않았어요.</p>
      </section>
    </article>
  </div>, document.body);
}

// ─────────────────────────────────────────────
// 약속 · 연락처
// 연락처가 보이는 때(서버 규칙 그대로 · 대표 결정 2026-11-04): 모든 안내를 이 문구로 맞춘다(약관·처리방침·자주 묻는 질문과 같게).
const CONTACT_WINDOW = "만나는 날 0시부터 다음 날 밤 11시 59분까지";
export function LiveMeetingPage() {
  return <Member><MeetingView /></Member>;
}
function MeetingView() {
  const { data, error, loading, reload, run, arrival } = useProgram();
  const [message, setMessage] = useState("");
  if (loading) return <Waiting />;
  if (error) return <section><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" className="mt-5 rounded-xl" onClick={() => void reload()}>다시 불러오기</Button></section>;
  if (!data || !["arranging", "closed"].includes(data.status) || (data.status === "closed" && !data.meetingOn)) {
    return <section className="space-y-8"><PageHeader mark="약속" label="DAY 04 이후" en="THE NEXT SCENE" title={<>함께 나눈 이야기,<br />그다음 장면으로.</>} lead="3일 교류가 끝나고 넷째 날, 두 분 모두 만나고 싶다고 답하면 이곳에서 약속을 정해요." />{data ? <Button asChild variant="outline" className="h-11 rounded-xl border-border"><Link to="/exchange">교류 화면으로 <ArrowRight size={14} /></Link></Button> : <Button asChild variant="outline" className="h-11 rounded-xl border-border"><Link to="/today">오늘로 돌아가기 <ArrowRight size={14} /></Link></Button>}</section>;
  }
  if (data.status === "closed") return <section className="space-y-8"><PageHeader mark="약속" label="마무리" en="THE NEXT SCENE" title="이번 약속은 마무리됐어요." /><Closed program={data} reread /></section>;
  const act = async (action: () => Promise<{ data: Program | null; error: string | null }>, done = "") => { const result = await run(action, done); if (result) setMessage(result.text); return !!result?.ok; };
  const accepted = data.proposals.find(item => item.status === "accepted");
  const open = data.proposals.find(item => item.status === "open");
  return (
    <section className="space-y-8" aria-labelledby="meeting-title">
      <PageHeader mark="약속" label={accepted ? "약속 확정" : "약속 정하기"} en="THE NEXT SCENE" titleId="meeting-title" title={accepted ? <>{data.meetingOn && dayLabel(data.meetingOn)} {data.meetingTime?.split("~")[0]},<br />만나기로 했어요.</> : "만날 시간과 장소를 함께 정해요."} lead={accepted ? undefined : data.arrangeBy ? `${kstDateTime(data.arrangeBy)}까지 정하지 않으면 교류는 마무리돼요.` : undefined} />
      <Notice text={message} />
      {arrival && arrival !== message && <p role="status" aria-live="polite" className={`inline-flex items-center gap-2 letter-drop ${butter}`}><LockOpen size={13} />{arrival}</p>}
      {!accepted && <OverlapPicker program={data} act={act} />}
      {accepted && accepted.selected && <CalendarLinks proposal={accepted} />}
      {accepted && accepted.selected && <Sheet className="p-6 sm:p-8"><Eyebrow mark="✓" label="정해진 약속" en="IT'S A DATE" /><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">{[["날짜·시간", `${dayLabel(accepted.selected.date)} ${accepted.selected.start}~${accepted.selected.end}`], ["활동", accepted.activity], ["지역", accepted.region], ["장소", accepted.place || ""]].map(([label, value]) => <div key={label}><dt className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{label}</dt><dd className={`mt-1 ${value ? "font-semibold" : "text-muted-foreground"}`}>{value || "만날 지점은 아직 정하지 않았어요"}</dd></div>)}</dl>{!accepted.place && accepted.selected.date <= shift(data.today, 1) && <p className="mt-4 rounded-xl border border-dashed border-primary/30 p-4 text-xs leading-6">만나기 전날인데 만날 지점이 아직 정해지지 않았어요. <a href="#proposal" className="font-semibold text-primary underline-offset-4 hover:underline">아래에서 장소를 넣어 다시 제안</a>해 주세요.</p>}{accepted.note && <p className="mt-4 rounded-xl bg-mist p-4 text-sm leading-7">{accepted.note}</p>}{(data.partnerMark || data.ownMark) && <div className="mt-5 border-t border-border pt-4"><p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">만나서 이어갈 이야기</p><p className="mt-1.5 text-sm leading-7"><span className="soft-underline is-on">{data.partnerMark || data.ownMark}</span></p><p className="mt-1 text-[11px] text-muted-foreground">{data.partnerMark ? `${data.partnerName ?? "상대"} 님이 사흘 동안 밑줄 그은 내 문장이에요.` : `내가 ${data.partnerName ?? "상대"} 님 글에서 밑줄 그은 문장이에요.`}</p></div>}</Sheet>}
      {open && !open.mine && <Sheet className="p-6 sm:p-8"><Eyebrow label="상대의 약속 제안" en="PROPOSAL" /><p className="mt-3 text-sm leading-7">{open.activity} · {open.region}{open.place ? ` · ${open.place}` : ""}</p>{open.note && <p className="mt-2 text-sm leading-7 text-muted-foreground">{open.note}</p>}<p className="mt-5 text-xs font-semibold">좋은 시간 하나를 골라 주세요</p><div className="mt-3 flex flex-wrap gap-2">{open.slots.map((slot, index) => <Button key={index} variant="outline" onClick={() => void act(() => acceptAppointment(open.id, index), "약속이 정해졌어요.")} className="h-auto rounded-xl border-border px-4 py-3 text-sm">{dayLabel(slot.date)} {slot.start}~{slot.end}</Button>)}</div><p className="mt-4 text-xs text-muted-foreground">맞는 시간이 없으면 아래에서 다른 시간을 제안해 주세요.</p></Sheet>}
      {open && open.mine && <QuietNote>보낸 제안: {open.slots.map(slot => `${dayLabel(slot.date)} ${slot.start}`).join(", ")} · 상대가 시간을 고르면 약속이 정해져요.</QuietNote>}
      <div id="proposal" className="scroll-mt-28"><ProposalForm program={data} act={act} again={!!(open || accepted || data.overlap?.length)} /></div>
      {accepted && <Contact program={data} act={act} />}
      <NoteList items={[{ title: "처음 만남은", body: "사람이 많은 공개된 장소에서, 돌아가는 길을 각자 정해 두고 만나요." }, { title: "불편한 일이 생기면", body: "두 사람 화면에서 바로 신고·차단할\u00a0수 있어요. 만남이 어려워지면 문의로 알려 주세요." }]} />
    </section>
  );
}

// 두 분 모두 되는 시간: 넷째 날 각자 고른 때 중 겹치는 것만. 하나를 누르면(무엇을·어디서만 확인) 그 자리에서 약속이 정해져요.
function OverlapPicker({ program, act }: { program: Program; act: Act }) {
  const overlap = program.overlap ?? [];
  const [slot, setSlot] = useState<string | null>(null);
  const [activity, setActivity] = useState(() => program.ownPlan === "B" ? sceneAppointment(scenePick(program).activity) || "카페·디저트" : "카페·디저트");
  const [region, setRegion] = useState(program.ownRegion || program.partnerRegion || "");
  const [place, setPlace] = useState("");
  const [picking, setPicking] = useState(false);
  const [avail, setAvail] = useState<string[]>(program.ownAvailability ?? []);
  const [myRegion, setMyRegion] = useState(program.ownRegion ?? "");
  if (!overlap.length) {
    if (!program.ownAvailability?.length) return <Sheet className="p-6 sm:p-8" tone="soft"><Eyebrow label="두 분 모두 되는 시간" en="WHEN WE'RE BOTH FREE" />
      <p className="mt-3 text-sm leading-7 text-muted-foreground">만날 수 있는 때를 골라 두면, 상대가 고른 때와 겹치는 시간만 보여 드려요. 한 번 누르면 약속이 정해져요.</p>
      {picking ? <div className="mt-5"><AvailabilityPicker program={program} value={avail} onChange={setAvail} region={myRegion} onRegion={setMyRegion} /><div className="mt-4 flex justify-end"><Button disabled={!avail.length} onClick={async () => { if (await act(() => setAvailability(program.id, avail, myRegion), "골라 두었어요.")) setPicking(false); }} className="h-11 rounded-xl px-6">골라 두기</Button></div></div>
        : <Button variant="outline" onClick={() => setPicking(true)} className="mt-4 h-11 rounded-full border-border px-5">만날 수 있는 때 고르기</Button>}
    </Sheet>;
    return program.partnerAvailabilitySet ? <QuietNote>두 분이 고른 때 중 겹치는 시간이 없어요. 아래에서 다른 시간을 직접 제안해 주세요.</QuietNote> : <QuietNote>상대가 만날 수 있는 때를 아직 고르지 않았어요. 고르면 겹치는 시간을 바로 보여 드려요. 먼저 제안해도 좋아요.</QuietNote>;
  }
  return <Sheet className="p-6 sm:p-8">
    <Eyebrow label="두 분 모두 되는 시간" en="WHEN WE'RE BOTH FREE" />
    <p className="mt-3 text-sm leading-7 text-muted-foreground">하나를 고르고 무엇을 할지만 확인하면 바로 약속이 정해져요.{program.partnerRegion ? ` 상대가 편하다고 한 곳 · ${program.partnerRegion}` : ""}</p>
    <div className="mt-5 flex flex-wrap gap-2">{overlap.map(item => <button key={item} type="button" aria-pressed={slot === item} onClick={() => setSlot(item)} className={`rounded-full border px-4 py-2 text-xs ${interaction} ${slot === item ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"}`}>{availLabel(item, dayLabel)}</button>)}</div>
    {slot && <div className="mt-5 grid gap-4 sm:grid-cols-3">
      <label className="grid gap-1.5 text-xs font-semibold">무엇을<select value={activity} onChange={event => setActivity(event.target.value)} className="h-11 rounded-xl border border-primary/15 bg-card px-3 text-sm font-normal max-md:text-base">{APPOINTMENT_ACTIVITIES.map(item => <option key={item}>{item}</option>)}</select></label>
      <label className="grid gap-1.5 text-xs font-semibold">지역·역<Input value={region} maxLength={40} onChange={event => setRegion(event.target.value)} placeholder="예: 합정역 근처" className="h-11 rounded-xl border-border bg-card font-normal" /></label>
      <label className="grid gap-1.5 text-xs font-semibold">장소(선택)<Input value={place} maxLength={80} onChange={event => setPlace(event.target.value)} placeholder="공개된 장소 이름" className="h-11 rounded-xl border-border bg-card font-normal" /></label>
    </div>}
    {slot && <div className="mt-6 flex justify-end"><Button disabled={!activity || !region.trim()} onClick={() => void act(() => bookSlot(program.id, slot, activity, region, place), "약속이 정해졌어요.")} className="h-11 rounded-xl px-6">이 시간으로 정하기</Button></div>}
  </Sheet>;
}

// 캘린더에 넣기: 일정 파일(.ics, 장소 포함 · 이 기기에서만 만들어요)과 구글 캘린더(날짜·시간만). 상대 이름은 넣지 않아요.
function CalendarLinks({ proposal }: { proposal: { id: string; selected: Slot | null; activity: string; region: string; place: string | null } }) {
  if (!proposal.selected) return null;
  const { date, start, end } = proposal.selected;
  const utc = (time: string) => new Date(kstAt(date, time)).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const title = "플라비 첫 만남";
  const details = `플라비에서 정한 첫 만남이에요. 연락처는 두 분이 동의하면 ${CONTACT_WINDOW} 플라비에서 볼 수 있어요.`;
  const location = [proposal.region, proposal.place].filter(Boolean).join(" · ");
  const esc = (text: string) => text.replace(/[\\,;]/g, match => `\\${match}`).replace(/\n/g, "\\n");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FLAVIE//KO", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${proposal.id}@flavie`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`, `DTSTART:${utc(start)}`, `DTEND:${utc(end)}`, `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(`${proposal.activity} · ${details}`)}`, ...(location ? [`LOCATION:${esc(location)}`] : []), "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const download = () => { const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "flavie-first-meeting.ics"; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${utc(start)}/${utc(end)}&details=${encodeURIComponent(details)}`;
  return <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={download} className="h-10 rounded-full border-border px-4 text-xs"><CalendarPlus size={14} />캘린더에 넣기</Button><Button asChild variant="ghost" className="h-10 rounded-full px-4 text-xs text-muted-foreground"><a href={google} target="_blank" rel="noreferrer">구글 캘린더로</a></Button><span className="basis-full text-[11px] text-muted-foreground">상대 이름은 넣지 않아요.</span></div>;
}

// B 첫 장면 → 약속 제안: 두 분이 맞춘 장면(아직이면 내가 고른 장면, 그것도 없으면 사흘 동안 고른 것)을 미리 채운다.
const SCENE_FIELDS = [["activity", "장소"], ["flow", "머무는 방식"], ["rest", "쉬어 갈 곳"], ["topic", "나눌 이야기"]] as const;
function scenePick(program: Program): Partial<ScenePick> {
  const chosen = program.entries.find(entry => entry.kind === "final")?.own?.payload;
  if (chosen) return chosen as Partial<ScenePick>;
  const mine = (day: number) => program.entries.find(entry => entry.day === day && entry.kind === "scene")?.own?.payload ?? {};
  const first = program.entries.find(entry => entry.day === 1 && entry.kind === "scene");
  const theirs = first?.partner?.payload?.activity;
  return { activity: theirs && theirs === mine(1).activity ? theirs : mine(1).activity ?? theirs, flow: mine(2).flow, rest: mine(2).rest, topic: mine(3).topic };
}
const sceneValue = (key: string, value?: string) => key === "topic" ? value ?? "" : sceneLabel(value);

// B 첫 장면: 셋째 날 답이 함께 열리면 두 분이 고른 것(직접 쓴 것 포함) 중에서 하나씩 골라 맞추고, 고른 장면에 대해 짧게 써서 나눈다.
// 셋째 날 답이 열리기 전에는 위 ‘우리의 사흘’ 카드가 고른 것을 모아 보여 준다(약속 정하기·마무리 뒤에는 이 카드가 대신 모아 보여 준다).
function FirstScene({ program, act }: { program: Program; act: Act }) {
  const scene = (day: number) => program.entries.find(entry => entry.day === day && entry.kind === "scene");
  // 그날 답이 함께 열렸으면 두 분이 고른 것, 열리지 않았으면 처음 목록에서 고른다(서버와 같은 기준).
  const both = (day: number, key: string) => { const entry = scene(day); return entry?.own && entry.partner ? [...new Set([entry.own.payload?.[key], entry.partner.payload?.[key]].filter(Boolean) as string[])] : null; };
  const final = program.entries.find(entry => entry.kind === "final");
  const own = final?.own?.payload as ScenePick | undefined, theirs = final?.partner?.payload as ScenePick | undefined;
  const [pick, setPick] = useState<Partial<ScenePick>>(() => own ?? {});
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (own) setPick(own); }, [final?.own?.at]);
  const ownDay = (day: number) => scene(day)?.own?.payload ?? {};
  // 직접 쓴 것은 그날 답이 열리지 않았어도 고를 수 있다: 내가 쓴 것 · 상대가 첫 장면에 고른 것(서버와 같은 기준)
  const written = (...values: (string | undefined)[]) => values.filter((value): value is string => isCustom(value));
  const activities = both(1, "activity") ?? [...new Set([...Object.keys(SCENE_ACTIVITY_LABEL), ...written(ownDay(1).activity, theirs?.activity)])];
  const activity = pick.activity && activities.includes(pick.activity) ? pick.activity : activities.length === 1 ? activities[0] : undefined;
  // 둘째 날 답이 함께 열리지 않았으면 맞추려는 장소에 맞는 목록에서 고른다(직접 쓴 장소는 공통 목록).
  const stay = stayFor(activity);
  const options: Record<keyof ScenePick, string[]> = {
    activity: activities,
    flow: both(2, "flow") ?? (stay ? [...new Set([...stay.flows, ...written(ownDay(2).flow, theirs?.flow)])] : []),
    rest: both(2, "rest") ?? (stay ? [...new Set([...stay.rests, ...written(ownDay(2).rest, theirs?.rest)])] : []),
    topic: both(3, "topic") ?? [],
  };
  const agreed = !!own && !!theirs && SCENE_FIELDS.every(([key]) => own[key] === theirs[key]);
  const canPick = ["started", "deciding", "arranging"].includes(program.status) && !program.meetingOn && options.topic.length > 0 && !agreed;
  const value = (key: keyof ScenePick) => pick[key] && options[key].includes(pick[key]!) ? pick[key] : options[key].length === 1 ? options[key][0] : undefined;
  const complete = SCENE_FIELDS.every(([key]) => !!value(key));
  const submit = async (next: ScenePick) => { if (await act(() => chooseFirstScene(program.id, next), "골랐어요.")) setEditing(false); };
  const table = (rows: Partial<ScenePick> | undefined) => <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">{SCENE_FIELDS.map(([key, label]) => rows?.[key] ? <div key={key}><dt className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{label}</dt><dd className="mt-1 inline-flex items-center gap-1 font-semibold">{isCustom(rows[key]) && <PenLine size={12} aria-hidden="true" className="text-accent" />}{key === "topic" ? `“${rows[key]}”` : sceneValue(key, rows[key])}</dd></div> : null)}</dl>;
  // 내가 고른 첫 장면에 대해: 만남 선택 마감(다섯째 날 09:00)까지(서버와 같은 기준)
  const pieceUntil = program.startOn ? `${dayLabel(shift(program.startOn, 4))} 09:00` : "";
  const pieceOpen = !!program.startOn && ["started", "deciding", "arranging"].includes(program.status) && Date.now() < kstAt(shift(program.startOn, 4), "09:00");
  const picking = canPick && (!own || editing);

  // 셋째 날 답이 열리기 전: 진행 중·넷째 날에는 ‘우리의 사흘’ 카드가 보여 주고, 그 뒤에는 지금까지 고른 것을 여기서 모아 보여 준다.
  if (!options.topic.length) {
    if (program.status === "started" || program.status === "deciding" || !program.entries.some(entry => entry.kind === "scene" && (entry.own || entry.partner))) return null;
    return <Sheet tone="soft" className="p-6 sm:p-8">
      <Eyebrow label="지금까지 고른 것" en="OUR FIRST SCENE" />
      <SceneBoard program={program} />
      <p className="mt-5 text-xs leading-6 text-muted-foreground">셋째 날 답이 함께 열리지 않아 첫 장면을 맞추지는 않았어요. 두 분이 고른 것은 그대로 남아 있어요.</p>
    </Sheet>;
  }

  return <Sheet tone="soft" className="p-6 sm:p-8">
    <Eyebrow label={agreed ? "함께 맞춘 첫 장면" : "첫 장면 맞추기"} en="OUR FIRST SCENE" />
    {agreed ? <>
      <p className={`mt-4 inline-flex items-center gap-2 letter-drop ${butter}`}><Check size={13} />두 분이 같은 장면을 골랐어요 · 확정</p>
      {table(own)}
      <p className="mt-5 text-xs leading-6 text-muted-foreground">{program.status === "closed" ? "두 분이 함께 맞춘 장면이에요." : "두 분 모두 만나고 싶다고 하면, 약속 제안에 이 장면이 미리 채워져요. 날짜·지역은 그때 함께 정해요."}</p>
    </> : picking ? <>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">두 분이 고른 것 중에서 하나씩 골라 주세요. 두 분의 선택이 같으면 첫 장면이 정해져요. 상대의 선택은 나도 고른 뒤에 보여요.</p>
      <div className="mt-5 space-y-4">{SCENE_FIELDS.map(([key, label]) => <div key={key} className="space-y-2"><p className="text-xs font-semibold">{label}{!both(key === "activity" ? 1 : key === "topic" ? 3 : 2, key) && <span className="ml-2 font-normal text-muted-foreground">{key === "activity" ? "그날은 함께 열리지 않아 처음 목록에서 골라요" : options[key].length ? "그날은 함께 열리지 않아 고른 장소에 맞는 것 중에서 골라요" : "장소를 먼저 고르면 보여요"}</span>}</p><Chips label={label} options={options[key].map(item => [item, key === "topic" ? `“${item}”` : sceneValue(key, item)] as [string, string])} value={value(key)} onPick={next => setPick(current => ({ ...current, [key]: next }))} /></div>)}</div>
      <div className="mt-6 flex justify-end gap-2">{editing && <Button variant="ghost" onClick={() => { setEditing(false); setPick(own ?? {}); }} className="h-11">닫기</Button>}<Button disabled={!complete} onClick={() => void submit({ activity: value("activity")!, flow: value("flow")!, rest: value("rest")!, topic: value("topic")! })} className="h-11 rounded-full px-6">이 장면으로 고르기</Button></div>
    </> : own && theirs ? <>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">두 분의 선택에 다른 부분이 있어요. 다른 줄만 맞추면 첫 장면이 정해져요.</p>
      <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-card text-sm">{SCENE_FIELDS.map(([key, label]) => <div key={key} className={`grid grid-cols-[5.5rem_1fr_1fr] gap-3 border-b border-border px-4 py-3 last:border-b-0 ${own[key] === theirs[key] ? "" : "bg-[#F8E5A6]/40"}`}><span className="text-[11px] font-semibold text-muted-foreground">{label}</span><span><span className="block text-[11px] text-muted-foreground">나</span>{sceneValue(key, own[key])}</span><span><span className="block text-[11px] text-muted-foreground">상대</span>{sceneValue(key, theirs[key])}</span></div>)}</div>
      {canPick && <div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setEditing(true)} className="h-11 rounded-full border-border px-5 hover:bg-muted hover:text-foreground">다시 고르기</Button><Button onClick={() => void submit(theirs)} className="h-11 rounded-full px-6">상대 선택으로 맞추기</Button></div>}
    </> : own ? <>
      {table(own)}
      <p className="mt-5 text-xs leading-6 text-muted-foreground">내가 고른 장면이에요. 상대도 고르면 두 분의 선택이 함께 보여요.</p>
      {canPick && <div className="mt-4 flex justify-end"><Button variant="outline" onClick={() => setEditing(true)} className="h-11 rounded-full border-border px-5 hover:bg-muted hover:text-foreground">다시 고르기</Button></div>}
    </> : <p className="mt-3 text-sm leading-7 text-muted-foreground">이번에는 첫 장면을 함께 맞추지 않았어요.</p>}
    {own && !picking && <ScenePiece program={program} act={act} open={pieceOpen} until={pieceUntil} agreed={agreed ? own : undefined} />}
  </Sheet>;
}

// 내가 고른 첫 장면에 대해: 왜 이 장면인지, 그곳에서 어떤 기분이고 싶은지 짧게. 두 분 모두 쓰면 함께 열리고, 열린 이야기에는 한마디를 남긴다.
function ScenePiece({ program, act, open, until, agreed }: { program: Program; act: Act; open: boolean; until: string; agreed?: ScenePick }) {
  const fresh = useFreshOpen(program);
  const piece = program.entries.find(entry => entry.kind === "piece");
  const own = piece?.own, theirs = piece?.partner;
  const opened = !!own && !!theirs;
  if (!open && !own && !theirs) return program.status === "closed" ? null : <p className="mt-6 border-t border-border pt-5 text-xs leading-6 text-muted-foreground">첫 장면 이야기는 나누지 않았어요.</p>;
  return <div className="mt-6 border-t border-border pt-5">
    <p className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-xs font-semibold text-accent">내가 고른 첫 장면에 대해</span>{open && !opened && <span className="text-[11px] text-muted-foreground">{until}까지 · 두 분 모두 쓰면 함께 열려요</span>}</p>
    {opened && <p className={`mt-4 inline-flex items-center gap-2 ${fresh(3, "piece") ? "letter-drop" : ""} ${butter}`}><LockOpen size={13} />두 분의 첫 장면 이야기가 함께 열렸어요</p>}
    {(own || theirs) && <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {own && <PieceCard who="내가 그린 장면" content={own} tone="bg-card ring-1 ring-border" agreed={agreed} />}
      {theirs ? <PieceCard who="상대가 그린 장면" content={theirs} tone="border border-lilac bg-card" agreed={agreed} /> : own && <p className="rounded-2xl border border-dashed border-border p-5 text-xs leading-6 text-muted-foreground">{piece?.partnerSent ? "상대도 썼어요. 곧 함께 열려요." : open ? `상대가 쓰면 함께 열려요. ${until}까지 기다려요.` : "상대가 쓰지 않아 열리지 않았어요."}</p>}
    </div>}
    {!own && open && <>
      {piece?.partnerSent && <p className={`mt-4 inline-flex items-center gap-2 ${butter}`}><Check size={13} />상대는 이미 썼어요. 내 이야기를 보내면 바로 함께 열려요.</p>}
      <PieceComposer draftKey={`${program.id}:piece`} onSend={body => act(() => writeScenePiece(program.id, body), "보냈어요.")} />
    </>}
    {opened && <Comments program={program} act={act} on="piece" day={3} until={until} open={open} />}
  </div>;
}
// 이야기 한 장. 쓸 때 떠올린 장면이 지금 맞춘 장면과 다르면 작게 함께 보여 준다.
function PieceCard({ who, content, tone, agreed }: { who: string; content: EntryContent; tone: string; agreed?: ScenePick }) {
  const snapshot = content.payload;
  const differs = !!snapshot && (!agreed || sceneKey(snapshot) !== sceneKey(agreed));
  return <article className={`rounded-2xl p-5 ${tone}`}>
    <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{who}{content.at && ` · ${kstDateTime(content.at)}`}</p>
    {differs && <SceneLine payload={snapshot} className="mt-2 text-[11px] text-muted-foreground" />}
    <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{content.body}</p>
  </article>;
}
function PieceComposer({ draftKey, onSend }: { draftKey: string; onSend: (body: string) => Promise<boolean> }) {
  const [body, setBody] = useState(() => readDraft(draftKey));
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => writeDraft(draftKey, body), 400); return () => window.clearTimeout(timer); }, [body, draftKey]);
  const length = Array.from(body.trim()).length;
  const send = async () => {
    const problem = contactProblem(body);
    if (problem) { setWarning(problem); return; }
    setSending(true);
    if (await onSend(body)) writeDraft(draftKey, "");
    setSending(false);
  };
  return <div className="mt-4 space-y-3">
    <p className="text-sm leading-7 text-muted-foreground">왜 이 장면을 골랐는지, 그곳에서 어떤 기분이고 싶은지 짧게 써 주세요. 상대도 쓰면 두 분의 이야기가 함께 열려요.</p>
    <Textarea aria-label="내가 고른 첫 장면에 대해 쓰기" value={body} onChange={event => { setBody(event.target.value); setWarning(""); }} maxLength={PIECE_MAX} rows={4} placeholder="예: 창가 자리에서 보드게임 하나를 천천히 해 보고 싶어요. 처음 만나는 자리라도 같이 웃을 일이 하나쯤 있으면 금방 편해질 것 같아요." className="rounded-xl border-border bg-card text-base leading-7 md:text-sm" />
    {warning && <p role="alert" className="text-xs leading-6 text-destructive">{warning}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{length} / {PIECE_MAX}자{length < PIECE_MIN ? ` · ${PIECE_MIN}자부터 보낼 수 있어요` : ""}{body && " · 이 기기에 저장 중"}</span>
      <Button disabled={sending || length < PIECE_MIN} onClick={() => void send()} className="h-11 rounded-full px-6">{sending ? "보내는 중…" : "보내기"}</Button>
    </div>
  </div>;
}

function ProposalForm({ program, act, again }: { program: Program; act: Act; again: boolean }) {
  const [openForm, setOpenForm] = useState(!again);
  const [slots, setSlots] = useState<Slot[]>([{ date: "", start: "14:00", end: "17:00" }]);
  // B는 첫 장면의 장소를 활동으로, 흐름·쉬어 갈 곳·이야기를 한마디로 미리 채워 둔다(고칠 수 있다).
  const [activity, setActivity] = useState(() => program.ownPlan === "B" ? sceneAppointment(scenePick(program).activity) : "");
  const [region, setRegion] = useState(program.ownRegion ?? "");
  const [place, setPlace] = useState("");
  const [note, setNote] = useState(() => program.ownPlan === "B" ? sceneNote(scenePick(program)) : "");
  const min = shift(program.today, 1), max = shift(program.today, 21);
  if (!openForm) return program.meetingOn && program.meetingOn <= program.today ? null : <div><Button variant="outline" onClick={() => setOpenForm(true)} className="h-11 rounded-full border-border px-5 hover:bg-muted hover:text-foreground">다른 시간 제안하기</Button></div>;
  const setSlot = (index: number, patch: Partial<Slot>) => setSlots(current => current.map((slot, i) => i === index ? { ...slot, ...patch } : slot));
  const ready = slots.every(slot => slot.date && slot.start < slot.end) && activity && region.trim();
  const field = (label: string, control: ReactNode) => <label className="grid gap-1.5 text-xs font-semibold">{label}{control}</label>;
  return <Sheet className="p-6 sm:p-8">
    <Eyebrow label={again ? "다른 시간 제안" : "약속 제안"} en="PROPOSE" />
    <p className="mt-3 text-sm leading-7 text-muted-foreground">후보 시간은 최대 3개, 내일부터 3주 안에서 골라요. 상대가 하나를 고르면 약속이 정해져요.{program.ownPlan === "B" && note && " 첫 장면에서 고른 것을 미리 채워 두었어요."}</p>
    <div className="mt-5 space-y-3">{slots.map((slot, index) => <div key={index} className="flex flex-wrap items-end gap-2">
      {field(`후보 ${index + 1} · 날짜`, <Input type="date" min={min} max={max} value={slot.date} onChange={event => setSlot(index, { date: event.target.value })} className="h-11 w-44 rounded-xl border-border bg-card" />)}
      <div className="flex flex-wrap gap-1.5">{QUICK_TIMES.map(time => <button key={time.label} type="button" aria-pressed={slot.start === time.start && slot.end === time.end} onClick={() => setSlot(index, { start: time.start, end: time.end })} className={`h-11 rounded-xl border px-3 text-xs ${interaction} ${slot.start === time.start && slot.end === time.end ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>{time.label} {time.start}</button>)}</div>
      {slots.length > 1 && <Button variant="ghost" onClick={() => setSlots(current => current.filter((_, i) => i !== index))} className="h-11 text-xs">빼기</Button>}
    </div>)}{slots.length < 3 && <Button variant="ghost" onClick={() => setSlots(current => [...current, { date: "", start: "14:00", end: "17:00" }])} className="h-9 px-2 text-xs">+ 후보 시간 더하기</Button>}</div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      {field("활동", <select value={activity} onChange={event => setActivity(event.target.value)} className="h-11 rounded-xl border border-primary/15 bg-card px-3 text-sm font-normal max-md:text-base"><option value="">골라 주세요</option>{APPOINTMENT_ACTIVITIES.map(item => <option key={item}>{item}</option>)}</select>)}
      {field("지역·역", <Input value={region} maxLength={40} onChange={event => setRegion(event.target.value)} placeholder="예: 합정역 근처" className="h-11 rounded-xl border-border bg-card font-normal" />)}
      {field("장소(선택)", <Input value={place} maxLength={80} onChange={event => setPlace(event.target.value)} placeholder="공개된 장소 이름" className="h-11 rounded-xl border-border bg-card font-normal" />)}
      {field("한마디(선택)", <Input value={note} maxLength={300} onChange={event => setNote(event.target.value)} placeholder="예: 천천히 걸으면서 이야기해요" className="h-11 rounded-xl border-border bg-card font-normal" />)}
    </div>
    <div className="mt-6 flex justify-end gap-2">{again && <Button variant="ghost" onClick={() => setOpenForm(false)} className="h-11">닫기</Button>}<Button disabled={!ready} onClick={async () => { if (await act(() => proposeAppointment(program.id, slots, activity, region, place, note), "제안을 보냈어요.")) setOpenForm(false); }} className="h-11 rounded-xl px-6">제안 보내기</Button></div>
  </Sheet>;
}

function Contact({ program, act }: { program: Program; act: Act }) {
  return <Sheet className="p-6 sm:p-8" tone="soft">
    <Eyebrow label="만나는 날 연락처" en="CONTACT" />
    {program.contactReleased && program.partnerPhone ? <div className="mt-5"><p className="text-xs text-muted-foreground">{program.partnerName ?? "상대"} 님의 번호 · {kstDateTime(program.contactUntil)}까지 보여요</p><a href={`tel:${program.partnerPhone}`} className="mt-2 block text-3xl font-semibold tracking-wide text-ink">{program.partnerPhone}</a><p className="mt-3 text-xs leading-6 text-muted-foreground">기간이 지나면 이 화면에서 사라져요. 필요하면 직접 저장해 주세요.</p></div> : <>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{program.contactReleaseAt && Date.parse(program.contactReleaseAt) <= Date.now() ? "번호는 열리지 않았어요. 두 분 중 한 분이 아직 동의하지 않았어요. 정한 시간과 장소에서 만나고, 문제가 생기면 두 사람 화면에서 신고해 주세요." : `두 분이 각자 동의하면 ${CONTACT_WINDOW}만 서로의 휴대폰 번호가 보여요${program.contactReleaseAt ? `(${kstDateTime(program.contactReleaseAt)}부터)` : ""}. 지금 보이는 약속에 동의하는 거라, 약속이 바뀌면 다시 동의해 주세요. 상대의 선택은 열리기 전까지 알려 드리지 않아요.`}</p>
      <div className="mt-5 flex flex-wrap items-center gap-3"><Button variant={program.ownContact ? "outline" : "default"} onClick={() => void act(() => setContactConsent(program.id, !program.ownContact, program.meetingRev ?? null), program.ownContact ? "동의를 거뒀어요." : "동의했어요. 만나는 날 0시에 열려요.")} className="h-11 rounded-xl border-border px-6">{program.ownContact ? "동의 거두기" : "번호 공개에 동의하기"}</Button>{program.ownContact && <span className="text-xs text-primary">동의했어요</span>}</div>
    </>}
  </Sheet>;
}
