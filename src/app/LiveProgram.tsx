import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, LockOpen } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Eyebrow, Moment, NoteList, PageHeader, QuietNote, Sheet } from "./editorial";
import { Member, Waiting } from "./LiveMember";
import { kstDateTime, kstDay } from "./dates";
import { SAFETY_COMPOSE_NOTE } from "./message-safety";
import { APPOINTMENT_ACTIVITIES, QUICK_TIMES } from "./appointment-details";
import { END_REASON, LETTER_PROMPTS, PLAN_COPY, SCENE_ACTIVITY_LABEL, SCENE_FLOWS, SCENE_PROMPTS, SCENE_RESTS, SCENE_TO_APPOINTMENT, acceptAppointment, chooseMeeting, choosePlan, confirmProgram, loadMyProgram, proposeAppointment, proposeStart, setContactConsent, submitEntry, type Program, type ProgramEntry, type Slot } from "./backend/program";

// 실제 서버 모드의 교류(/exchange)와 약속·연락처(/meeting). 데모 화면과 같은 편집 톤을 쓴다.
const interaction = "transition-colors duration-200 motion-reduce:transition-none";
const choice = (active: boolean) => `rounded-2xl border p-5 text-left ${interaction} ${active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const dayLabel = (date: string) => kstDay(`${date}T12:00:00+09:00`);
const DAY_NAME = ["첫째 날", "둘째 날", "셋째 날", "넷째 날"];
// 한국 시간 기준 지금 몇 시인지·오늘 자정까지 남은 시간
const kstHour = () => new Date(Date.now() + 9 * 3600000).getUTCHours();
const untilMidnight = () => { const kst = new Date(Date.now() + 9 * 3600000); const left = 86400000 - ((kst.getUTCHours() * 60 + kst.getUTCMinutes()) * 60000); return `${Math.floor(left / 3600000)}시간 ${Math.floor((left % 3600000) / 60000)}분`; };

function useProgram() {
  const [state, setState] = useState<{ data: Program | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const reload = async () => { const result = await loadMyProgram(); setState({ data: result.data, error: result.error, loading: false }); };
  useEffect(() => { void reload(); }, []);
  // 서버 함수는 고친 뒤의 교류를 그대로 돌려준다. 실패하면 안내만 바꾼다.
  // 보내는 중에 다시 누르면 무시한다(두 번 눌러도 한 번만 보내지게). 성공 여부도 함께 돌려준다.
  const sending = useRef(false);
  const run = async (action: () => Promise<{ data: Program | null; error: string | null }>, done = ""): Promise<{ text: string; ok: boolean } | null> => {
    if (sending.current) return null;
    sending.current = true;
    try {
      const result = await action();
      if (result.error) return { text: result.error, ok: false };
      if (result.data) setState({ data: result.data, error: null, loading: false });
      return { text: result.data?.notice || done, ok: true };
    } finally {
      sending.current = false;
    }
  };
  return { ...state, reload, run };
}

function Notice({ text }: { text: string }) {
  return text ? <p role="status" aria-live="polite" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-7">{text}</p> : null;
}

function NotYet({ title }: { title: string }) {
  return <section className="space-y-8"><PageHeader mark={title} label="서로 선택한 뒤에 열려요" en="BEFORE US" title={`${title} 화면은 두 분이 서로 선택한 뒤에 열려요.`} lead="소개를 받고 두 분 모두 알아가고 싶다고 답하면, 이곳에서 함께 시작하는 방법을 정해요." /><Button asChild variant="outline" className="h-11 rounded-xl border-border"><Link to="/today">오늘 화면으로 <ArrowRight size={14} /></Link></Button></section>;
}

function Closed({ program }: { program: Program }) {
  const done = program.endReason === "completed";
  return <Moment eyebrow={done ? "THANK YOU" : "SEE YOU AGAIN"} title={done ? "만남까지 마친 교류예요." : "이번 교류는 여기서 마무리됐어요."} action={<div className="flex flex-wrap gap-2"><Button asChild className="h-11 rounded-full px-6"><Link to="/today">오늘 화면으로</Link></Button><Button asChild variant="outline" className="h-11 rounded-full border-border px-5 hover:bg-muted hover:text-foreground"><Link to="/us">불편한 일 신고하기</Link></Button></div>}>{END_REASON[program.endReason ?? ""] ?? "다음 소개가 준비되면 정오에 알려 드릴게요."}</Moment>;
}

// ─────────────────────────────────────────────
// 교류: 합의 → 3일 → 만남 선택
export function LiveExchangePage() {
  return <Member><ExchangeView /></Member>;
}
function ExchangeView() {
  const { data, error, loading, reload, run } = useProgram();
  const [message, setMessage] = useState("");
  if (loading) return <Waiting />;
  if (error) return <section><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" className="mt-5 rounded-xl" onClick={() => void reload()}>다시 불러오기</Button></section>;
  if (!data) return <NotYet title="교류" />;
  const act = async (action: () => Promise<{ data: Program | null; error: string | null }>, done = "") => { const result = await run(action, done); if (result) setMessage(result.text); return !!result?.ok; };
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
      <PageHeader mark="교류" label={header.label} en="THREE DAYS, BEFORE US" titleId="exchange-title" title={header.title} lead={data.partnerName ? `${data.partnerName} 님과의 교류예요. 신고·차단은 두 사람 화면에서 언제든 할 수 있어요.` : undefined} aside={<Button asChild variant="outline" className="h-10 rounded-xl border-border text-xs"><Link to="/us">두 사람 화면</Link></Button>} />
      <Notice text={message} />
      {data.status === "choosing" && <Agreement program={data} act={act} />}
      {data.status === "scheduled" && <Moment eyebrow="SEE YOU AT 09:00" title={<>{data.startOn && dayLabel(data.startOn)} 09:00,<br />첫날이 열려요.</>}>{data.ownPlan && PLAN_COPY[data.ownPlan].name} · 3일 동안 이어지고, 넷째 날 09:00에 만남을 정해요. 시작하면 알림으로 알려 드릴게요.</Moment>}
      {data.status === "deciding" && <MeetingDecision program={data} act={act} />}
      {data.status === "arranging" && <Moment eyebrow="WE BOTH SAID YES" title="두 분 모두 만나고 싶다고 했어요." action={<Button asChild className="h-11 rounded-full px-6"><Link to="/meeting">약속 정하러 가기 <ArrowRight size={14} /></Link></Button>}>{data.arrangeBy && `${kstDateTime(data.arrangeBy)}까지 약속을 함께 정해 주세요.`}</Moment>}
      {data.ownPlan === "B" && (data.status === "deciding" || data.status === "arranging" || data.day === 3) && <FirstScene program={data} />}
      {(data.status === "started" || data.status === "deciding" || data.status === "arranging") && <Days program={data} act={act} />}
      {data.status === "closed" && <Closed program={data} />}
      <QuietNote>{SAFETY_COMPOSE_NOTE}</QuietNote>
    </section>
  );
}

type Act = (action: () => Promise<{ data: Program | null; error: string | null }>, done?: string) => Promise<boolean>;

function Agreement({ program, act }: { program: Program; act: Act }) {
  const [date, setDate] = useState(program.startOn ?? "");
  useEffect(() => setDate(program.startOn ?? ""), [program.startOn]);
  const same = !!program.ownPlan && program.ownPlan === program.partnerPlan;
  const min = shift(program.today, 1), max = shift(program.today, 14);
  return <>
    <Sheet className="p-6 sm:p-8">
      <Eyebrow mark="01" label="방식 고르기" en="CHOOSE TOGETHER" />
      <p className="mt-3 text-sm leading-7 text-muted-foreground">두 분이 같은 방식을 고르면 시작일을 확인해요. {kstDateTime(program.agreeBy)}까지 정하지 않으면 이번 소개는 마무리돼요.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{(["A", "B"] as const).map(plan => <button key={plan} type="button" aria-pressed={program.ownPlan === plan} onClick={() => void act(() => choosePlan(program.id, plan), "골랐어요.")} className={choice(program.ownPlan === plan)}>
        <span className="flex items-center justify-between gap-2"><span className="font-semibold">{PLAN_COPY[plan].name}</span>{program.ownPlan === plan && <Check size={16} className="text-primary" />}</span>
        <span className="mt-2 block text-xs leading-6 text-muted-foreground">{PLAN_COPY[plan].description}</span>
        <span className="mt-3 block text-[11px] font-semibold text-primary">{PLAN_COPY[plan].fit}</span>
        <ol className="mt-3 space-y-1.5 border-t border-border pt-3">{PLAN_COPY[plan].days.map((title, index) => <li key={title} className="flex gap-2 text-xs leading-5 text-foreground/80"><span className="w-12 shrink-0 text-muted-foreground">{DAY_NAME[index]}</span>{title}</li>)}</ol>
        {program.partnerPlan === plan && <span className="mt-3 inline-block rounded-full bg-[#F8E5A6] px-2.5 py-1 text-[11px] font-semibold text-[#5A4310]">{program.ownPlan ? "상대도 이 방식을 골랐어요" : "상대가 고른 방식이에요"}</span>}
      </button>)}</div>
      {!program.partnerPlan && <p className="mt-4 text-xs text-muted-foreground">상대는 아직 고르지 않았어요.</p>}
      {program.ownPlan && program.partnerPlan && !same && <p className="mt-4 text-xs text-muted-foreground">두 분의 선택이 달라요. 한 분이 바꾸면 바로 시작일 확인으로 넘어가요.</p>}
    </Sheet>
    {same && <Sheet className="p-6 sm:p-8">
      <Eyebrow mark="02" label="시작일 확인" en="DAY 01" />
      <p className="mt-3 text-sm leading-7 text-muted-foreground">기본은 내일 09:00 시작이에요. 다른 날이 좋으면 14일 안에서 제안할 수 있어요. 날짜가 바뀌면 두 분 모두 다시 확인해요.</p>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-xs font-semibold">시작일<Input type="date" min={min} max={max} value={date} onChange={event => setDate(event.target.value)} className="h-11 w-48 rounded-xl border-border bg-card" /></label>
        {date && date !== program.startOn && <Button variant="outline" onClick={() => void act(() => proposeStart(program.id, date), "새 시작일을 제안했어요.")} className="h-11 rounded-xl border-border">이 날로 제안하기</Button>}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-mist p-5">
        <p className="text-sm leading-7"><span className="font-semibold">{program.startOn && dayLabel(program.startOn)} 09:00 시작</span><br /><span className="text-xs text-muted-foreground">나 {program.ownConfirmed ? "확인 완료" : "확인 전"} · 상대 {program.partnerConfirmed ? "확인 완료" : "확인 전"}</span></p>
        <Button disabled={program.ownConfirmed} onClick={() => void act(() => confirmProgram(program.id), "확인했어요.")} className="h-11 rounded-xl px-6">{program.ownConfirmed ? "확인했어요" : "이 일정으로 시작하기"}</Button>
      </div>
    </Sheet>}
    <NoteList items={[{ title: "베타 기간", body: "지금은 교류비 없이 진행해요. 정식 운영부터 각자 교류비를 결제한 뒤 시작해요." }, { title: "시작한 뒤에는", body: "방식은 바꿀 수 없어요. 3일 동안 하루 한 번씩 쓰고, 넷째 날 09:00에 만남을 정해요." }]} />
  </>;
}

function Days({ program, act }: { program: Program; act: Act }) {
  if (!program.startOn) return null;
  const plan = program.ownPlan ?? "A";
  return <div className="space-y-6">{[1, 2, 3].map(day => {
    const date = shift(program.startOn!, day - 1);
    const prompt = (plan === "A" ? LETTER_PROMPTS : SCENE_PROMPTS)[day - 1];
    const main = program.entries.find(entry => entry.day === day && entry.kind === (plan === "A" ? "letter" : "scene"));
    const reply = program.entries.find(entry => entry.day === day && entry.kind === "reply");
    const isToday = program.status === "started" && program.day === day;
    const early = isToday && kstHour() < 9;
    const today = isToday && !early;
    const future = program.status === "started" && (date > program.today || early);
    const opened = !!main?.own && !!main?.partner;
    const hints = plan === "A" ? LETTER_PROMPTS[day - 1].hints : [];
    return <Sheet key={day} className={`p-6 sm:p-8 ${today ? "border-primary/40" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><Eyebrow mark={`0${day}`} label={prompt.title} en={DAY_NAME[day - 1]} /><span className="text-xs text-muted-foreground">{dayLabel(date)} 09:00~23:59</span></div>
      {future ? <p className="mt-4 text-sm text-muted-foreground">{dayLabel(date)} 오전 9시에 열려요. 그때 알림으로 알려 드릴게요.</p> : <>
        <p className="mt-4 text-sm font-semibold leading-7">{prompt.question}</p>
        {opened && <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#F8E5A6] px-3.5 py-1.5 text-xs font-semibold text-[#5A4310] letter-drop"><LockOpen size={13} />두 분의 글이 모두 도착해 함께 열렸어요</p>}
        <EntryPair entry={main} plan={plan} past={!today} />
        {today && !main?.own && (plan === "A" ? <LetterComposer draftKey={`${program.id}:${day}:letter`} hints={hints} onSend={body => act(() => submitEntry(program.id, day, "letter", body), "보냈어요. 상대도 보내면 함께 열려요.")} /> : <SceneComposer day={day} onSend={(body, payload) => act(() => submitEntry(program.id, day, "scene", body, payload), "보냈어요. 상대도 보내면 함께 열려요.")} />)}
        {today && !main?.own && <p className="mt-3 text-[11px] text-muted-foreground">오늘 23:59까지 {untilMidnight()} 남았어요. 두 분 모두 보내야 함께 열려요.</p>}
        {plan === "A" && main?.partner && <div className="mt-6 border-t border-border pt-5">
          <p className="text-xs font-semibold text-accent">답장 · 하루 한 번</p>
          <EntryPair entry={reply} plan="A" reply past={!today} />
          {!today && !reply && <p className="mt-3 text-xs text-muted-foreground">이날은 답장을 나누지 않았어요.</p>}
          {today && !reply?.own && <LetterComposer reply draftKey={`${program.id}:${day}:reply`} onSend={body => act(() => submitEntry(program.id, day, "reply", body), "답장을 보냈어요. 상대도 보내면 함께 열려요.")} />}
        </div>}
        {!today && !main?.own && <p className="mt-4 text-xs text-muted-foreground">이날은 글을 보내지 않았어요.</p>}
      </>}
    </Sheet>;
  })}</div>;
}

function sceneText(payload: Record<string, string> | null) {
  if (!payload) return "";
  return [payload.activity && SCENE_ACTIVITY_LABEL[payload.activity], payload.flow, payload.rest, payload.topic].filter(Boolean).join(" · ");
}
function EntryPair({ entry, plan, reply = false, past = false }: { entry?: ProgramEntry; plan: "A" | "B"; reply?: boolean; past?: boolean }) {
  if (!entry) return null;
  const card = (who: string, content: ProgramEntry["own"], tone: string) => content && <article className={`rounded-2xl p-5 ${tone}`}><p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{who} · {kstDateTime(content.at)}</p>{plan === "B" && <p className="mt-2 text-sm font-semibold">{sceneText(content.payload)}</p>}{content.body && <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{content.body}</p>}</article>;
  return <div className="mt-5 grid gap-3 lg:grid-cols-2">
    {card(reply ? "내 답장" : "내가 보낸 글", entry.own, "bg-mist")}
    {entry.partner ? card(reply ? "상대의 답장" : "상대의 글", entry.partner, "border border-lilac bg-card") : entry.own && <p className="rounded-2xl border border-dashed border-border p-5 text-xs leading-6 text-muted-foreground">{entry.partnerSent ? "상대도 보냈어요. 곧 함께 열려요." : past ? "상대가 이날 글을 보내지 않아 열리지 않았어요." : "상대가 보내면 함께 열려요. 오늘 23:59까지 기다려요."}</p>}
  </div>;
}

// 쓰다 만 편지는 이 기기에 저장해 두고, 보내면 지운다(새로고침해도 사라지지 않게).
const DRAFT_PREFIX = "before-us:letter-draft:";
const readDraft = (key: string) => { try { return localStorage.getItem(DRAFT_PREFIX + key) ?? ""; } catch { return ""; } };
const writeDraft = (key: string, value: string) => { try { if (value.trim()) localStorage.setItem(DRAFT_PREFIX + key, value); else localStorage.removeItem(DRAFT_PREFIX + key); } catch { /* 저장 공간이 막혀 있으면 이 화면에서만 유지 */ } };
function LetterComposer({ onSend, reply = false, draftKey, hints = [] }: { onSend: (body: string) => Promise<unknown>; reply?: boolean; draftKey: string; hints?: readonly string[] }) {
  const [body, setBody] = useState(() => readDraft(draftKey));
  const [sending, setSending] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => writeDraft(draftKey, body), 400); return () => window.clearTimeout(timer); }, [body, draftKey]);
  const length = Array.from(body.trim()).length, min = reply ? 1 : 20, max = reply ? 600 : 1000;
  const sweet = !reply && length >= 300 && length <= 600;
  return <div className="mt-5 space-y-3">
    {!reply && hints.length > 0 && !body && <div className="flex flex-wrap gap-2" aria-label="첫 문장 도움말">{hints.map(hint => <button key={hint} type="button" onClick={() => setBody(hint)} className={`rounded-full border border-border bg-card px-3.5 py-2 text-xs text-foreground/80 hover:border-primary/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${interaction}`}>{hint.trim()}…</button>)}</div>}
    <Textarea aria-label={reply ? "열린 편지에 답장 쓰기" : "오늘의 편지 쓰기"} value={body} onChange={event => setBody(event.target.value)} maxLength={max} rows={reply ? 3 : 7} placeholder={reply ? "열린 편지에 한 번 답해요." : "위의 첫 문장을 눌러 시작해도 좋아요. 보낸 뒤에는 고칠 수 없어요."} className="rounded-xl border-border bg-card text-base leading-7 md:text-sm" />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{length} / {max}자{!reply && (length < 20 ? " · 20자부터 보낼 수 있어요" : sweet ? " · 읽기 좋은 길이예요" : length < 300 ? " · 300~600자를 권해요" : "")}{body && " · 이 기기에 저장 중"}</span>
      <Button disabled={sending || length < min} onClick={async () => { setSending(true); await onSend(body); writeDraft(draftKey, ""); setSending(false); }} className="h-11 rounded-full px-6">{sending ? "보내는 중…" : reply ? "답장 보내기" : "편지 보내기"}</Button>
    </div>
  </div>;
}

function SceneComposer({ day, onSend }: { day: number; onSend: (body: string | null, payload: Record<string, string>) => Promise<unknown> }) {
  const [payload, setPayload] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const pick = (key: string, value: string) => setPayload(current => ({ ...current, [key]: value }));
  const chips = (key: string, options: [string, string][]) => <div className="flex flex-wrap gap-2">{options.map(([value, label]) => <button key={value} type="button" aria-pressed={payload[key] === value} onClick={() => pick(key, value)} className={`rounded-full border px-4 py-2 text-sm ${interaction} ${payload[key] === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"}`}>{label}</button>)}</div>;
  const ready = day === 1 ? !!payload.activity && !!body.trim() : day === 2 ? !!payload.flow && !!payload.rest : !!payload.topic?.trim();
  return <div className="mt-5 space-y-4">
    {day === 1 && <>{chips("activity", Object.entries(SCENE_ACTIVITY_LABEL) as [string, string][])}<Textarea value={body} maxLength={300} onChange={event => setBody(event.target.value)} rows={3} placeholder="이 분위기가 끌리는 이유를 짧게 적어 주세요." className="rounded-xl border-border bg-card text-sm" /></>}
    {day === 2 && <><p className="text-xs font-semibold">머무는 흐름</p>{chips("flow", SCENE_FLOWS.map(item => [item, item] as [string, string]))}<p className="text-xs font-semibold">쉬어 갈 곳</p>{chips("rest", SCENE_RESTS.map(item => [item, item] as [string, string]))}<Textarea value={body} maxLength={300} onChange={event => setBody(event.target.value)} rows={2} placeholder="어제 상대의 선택에 대한 생각(선택)" className="rounded-xl border-border bg-card text-sm" /></>}
    {day === 3 && <><Input value={payload.topic ?? ""} maxLength={80} onChange={event => pick("topic", event.target.value)} placeholder="예: 요즘 가장 오래 머문 장소 이야기" className="h-11 rounded-xl border-border bg-card" /><Textarea value={body} maxLength={300} onChange={event => setBody(event.target.value)} rows={2} placeholder="만나면 이렇게 보내고 싶어요(선택)" className="rounded-xl border-border bg-card text-sm" /></>}
    <div className="flex justify-end"><Button disabled={!ready || sending} onClick={async () => { setSending(true); await onSend(body.trim() || null, payload); setSending(false); }} className="h-11 rounded-full px-6">{sending ? "보내는 중…" : "보내기"}</Button></div>
  </div>;
}

function MeetingDecision({ program, act }: { program: Program; act: Act }) {
  const [confirm, setConfirm] = useState<"positive" | "negative" | null>(null);
  return <Sheet className="p-6 sm:p-8">
    <Eyebrow mark="04" label="만남 선택" en="넷째 날" />
    {program.ownMeeting ? <p className="mt-4 text-sm leading-7">{program.ownMeeting === "positive" ? "만나고 싶다고 답했어요." : "이번에는 여기까지라고 답했어요."} 두 분이 모두 답하면 결과만 알려 드려요. 상대의 답은 알려 드리지 않아요.</p> : <>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">{program.meetingBy && `${kstDateTime(program.meetingBy)}까지`} 골라 주세요. 두 분 모두 ‘만나고 싶어요’일 때만 약속을 정해요. 답은 바꿀 수 없어요.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{([["positive", "만나고 싶어요", "약속 날짜·장소를 함께 정해요."], ["negative", "이번에는 여기까지", "상대에게 내 답은 알리지 않아요."]] as const).map(([value, title, sub]) => <button key={value} type="button" aria-pressed={confirm === value} onClick={() => setConfirm(value)} className={choice(confirm === value)}><span className="font-semibold">{title}</span><span className="mt-1 block text-xs text-muted-foreground">{sub}</span></button>)}</div>
      {confirm && <div className="mt-5 flex justify-end"><Button onClick={() => void act(() => chooseMeeting(program.id, confirm), "답을 남겼어요.")} className="h-11 rounded-xl px-6">이 답으로 보내기</Button></div>}
    </>}
  </Sheet>;
}

// ─────────────────────────────────────────────
// 약속 · 연락처
export function LiveMeetingPage() {
  return <Member><MeetingView /></Member>;
}
function MeetingView() {
  const { data, error, loading, reload, run } = useProgram();
  const [message, setMessage] = useState("");
  if (loading) return <Waiting />;
  if (error) return <section><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" className="mt-5 rounded-xl" onClick={() => void reload()}>다시 불러오기</Button></section>;
  if (!data || !["arranging", "closed"].includes(data.status) || (data.status === "closed" && !data.meetingOn)) {
    return <section className="space-y-8"><PageHeader mark="약속" label="DAY 04 이후" en="THE NEXT SCENE" title={<>함께 나눈 이야기,<br />그다음 장면으로.</>} lead="3일 교류가 끝나고 넷째 날, 두 분 모두 만나고 싶다고 답하면 이곳에서 약속을 정해요." />{data ? <Button asChild variant="outline" className="h-11 rounded-xl border-border"><Link to="/exchange">교류 화면으로 <ArrowRight size={14} /></Link></Button> : <Button asChild variant="outline" className="h-11 rounded-xl border-border"><Link to="/today">오늘로 돌아가기 <ArrowRight size={14} /></Link></Button>}</section>;
  }
  if (data.status === "closed") return <section className="space-y-8"><PageHeader mark="약속" label="마무리" en="THE NEXT SCENE" title="이번 약속은 마무리됐어요." /><Closed program={data} /></section>;
  const act = async (action: () => Promise<{ data: Program | null; error: string | null }>, done = "") => { const result = await run(action, done); if (result) setMessage(result.text); return !!result?.ok; };
  const accepted = data.proposals.find(item => item.status === "accepted");
  const open = data.proposals.find(item => item.status === "open");
  return (
    <section className="space-y-8" aria-labelledby="meeting-title">
      <PageHeader mark="약속" label={accepted ? "약속 확정" : "약속 정하기"} en="THE NEXT SCENE" titleId="meeting-title" title={accepted ? <>{data.meetingOn && dayLabel(data.meetingOn)} {data.meetingTime?.split("~")[0]},<br />만나기로 했어요.</> : "만날 시간과 장소를 함께 정해요."} lead={accepted ? undefined : data.arrangeBy ? `${kstDateTime(data.arrangeBy)}까지 정하지 않으면 교류는 마무리돼요.` : undefined} />
      <Notice text={message} />
      {accepted && accepted.selected && <Sheet className="p-6 sm:p-8"><Eyebrow mark="✓" label="정해진 약속" en="IT'S A DATE" /><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">{[["날짜·시간", `${dayLabel(accepted.selected.date)} ${accepted.selected.start}~${accepted.selected.end}`], ["활동", accepted.activity], ["지역", accepted.region], ["장소", accepted.place || "만나서 정해요"]].map(([label, value]) => <div key={label}><dt className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}</dl>{accepted.note && <p className="mt-4 rounded-xl bg-mist p-4 text-sm leading-7">{accepted.note}</p>}</Sheet>}
      {open && !open.mine && <Sheet className="p-6 sm:p-8"><Eyebrow label="상대의 약속 제안" en="PROPOSAL" /><p className="mt-3 text-sm leading-7">{open.activity} · {open.region}{open.place ? ` · ${open.place}` : ""}</p>{open.note && <p className="mt-2 text-sm leading-7 text-muted-foreground">{open.note}</p>}<p className="mt-5 text-xs font-semibold">좋은 시간 하나를 골라 주세요</p><div className="mt-3 flex flex-wrap gap-2">{open.slots.map((slot, index) => <Button key={index} variant="outline" onClick={() => void act(() => acceptAppointment(open.id, index), "약속이 정해졌어요.")} className="h-auto rounded-xl border-border px-4 py-3 text-sm">{dayLabel(slot.date)} {slot.start}~{slot.end}</Button>)}</div><p className="mt-4 text-xs text-muted-foreground">맞는 시간이 없으면 아래에서 다른 시간을 제안해 주세요.</p></Sheet>}
      {open && open.mine && <QuietNote>보낸 제안: {open.slots.map(slot => `${dayLabel(slot.date)} ${slot.start}`).join(", ")} · 상대가 시간을 고르면 약속이 정해져요.</QuietNote>}
      <ProposalForm program={data} act={act} again={!!(open || accepted)} />
      {accepted && <Contact program={data} act={act} />}
      <NoteList items={[{ title: "처음 만남은", body: "사람이 많은 공개된 장소에서, 돌아가는 길을 각자 정해 두고 만나요." }, { title: "불편한 일이 생기면", body: "두 사람 화면에서 바로 신고·차단할 수 있어요. 만남이 어려워지면 문의로 알려 주세요." }]} />
    </section>
  );
}

// 첫 장면(B)에서 두 분이 고른 분위기를 약속 활동으로 미리 골라 둔다(같으면 그것, 다르면 내가 고른 것).
function sceneActivity(program: Program) {
  const first = program.entries.find(entry => entry.day === 1 && entry.kind === "scene");
  const mine = first?.own?.payload?.activity, theirs = first?.partner?.payload?.activity;
  const key = mine && theirs && mine === theirs ? mine : mine ?? theirs;
  return key ? SCENE_TO_APPOINTMENT[key] ?? "" : "";
}

// B 첫 장면: 사흘 동안 두 분이 고른 것을 한 장면으로 모아 보여 준다(약속을 정할 때 그대로 이어진다).
function FirstScene({ program }: { program: Program }) {
  const pick = (day: number, key: string) => { const entry = program.entries.find(item => item.day === day && item.kind === "scene"); return [entry?.own?.payload?.[key], entry?.partner?.payload?.[key]].filter(Boolean) as string[]; };
  const activities = pick(1, "activity").map(key => SCENE_ACTIVITY_LABEL[key] ?? key), flows = pick(2, "flow"), rests = pick(2, "rest"), topics = pick(3, "topic");
  if (!activities.length && !flows.length && !topics.length) return null;
  const join = (items: string[]) => [...new Set(items)].join(" + ");
  const same = (items: string[]) => items.length === 2 && items[0] === items[1];
  return <Sheet tone="soft" className="p-6 sm:p-8">
    <Eyebrow label="두 사람의 첫 장면" en="OUR FIRST SCENE" />
    <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
      {[["분위기", activities, "둘 다 같은 곳을 골랐어요"], ["흐름", flows, "흐름도 같아요"], ["쉬어 갈 곳", rests, "쉬어 갈 곳도 같아요"]].map(([label, items, match]) => (items as string[]).length ? <div key={label as string}><dt className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{label as string}</dt><dd className="mt-1 font-semibold">{join(items as string[])}{same(items as string[]) && <span className="ml-2 rounded-full bg-[#F8E5A6] px-2 py-0.5 text-[11px] font-semibold text-[#5A4310]">{match as string}</span>}</dd></div> : null)}
      {topics.length > 0 && <div className="sm:col-span-2"><dt className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">나누고 싶은 이야기</dt><dd className="mt-1 space-y-1">{topics.map(topic => <p key={topic} className="font-semibold">“{topic}”</p>)}</dd></div>}
    </dl>
    <p className="mt-5 text-xs leading-6 text-muted-foreground">두 분 모두 만나고 싶다고 하면, 이 장면을 그대로 약속 제안에 담아 갈 수 있어요.</p>
  </Sheet>;
}

function ProposalForm({ program, act, again }: { program: Program; act: Act; again: boolean }) {
  const [openForm, setOpenForm] = useState(!again);
  const [slots, setSlots] = useState<Slot[]>([{ date: "", start: "14:00", end: "17:00" }]);
  const [activity, setActivity] = useState(() => sceneActivity(program));
  const [region, setRegion] = useState("");
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const min = shift(program.today, 1), max = shift(program.today, 21);
  if (!openForm) return program.meetingOn && program.meetingOn <= program.today ? null : <div><Button variant="outline" onClick={() => setOpenForm(true)} className="h-11 rounded-full border-border px-5 hover:bg-muted hover:text-foreground">다른 시간 제안하기</Button></div>;
  const setSlot = (index: number, patch: Partial<Slot>) => setSlots(current => current.map((slot, i) => i === index ? { ...slot, ...patch } : slot));
  const ready = slots.every(slot => slot.date && slot.start < slot.end) && activity && region.trim();
  const field = (label: string, control: ReactNode) => <label className="grid gap-1.5 text-xs font-semibold">{label}{control}</label>;
  return <Sheet className="p-6 sm:p-8">
    <Eyebrow label={again ? "다른 시간 제안" : "약속 제안"} en="PROPOSE" />
    <p className="mt-3 text-sm leading-7 text-muted-foreground">후보 시간은 최대 3개, 내일부터 3주 안에서 골라요. 상대가 하나를 고르면 약속이 정해져요.</p>
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
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{program.contactReleaseAt && Date.parse(program.contactReleaseAt) <= Date.now() ? "번호는 열리지 않았어요. 두 분 중 한 분이 아직 동의하지 않았어요. 정한 시간과 장소에서 만나고, 문제가 생기면 두 사람 화면에서 신고해 주세요." : `두 분이 각자 동의하면 ${program.contactReleaseAt ? kstDateTime(program.contactReleaseAt) : "만나는 날 00:00"}부터 다음 날 23:59까지만 서로의 휴대폰 번호가 보여요. 상대의 선택은 열리기 전까지 알려 드리지 않아요.`}</p>
      <div className="mt-5 flex flex-wrap items-center gap-3"><Button variant={program.ownContact ? "outline" : "default"} onClick={() => void act(() => setContactConsent(program.id, !program.ownContact), program.ownContact ? "동의를 거뒀어요." : "동의했어요. 만나는 날 00:00에 열려요.")} className="h-11 rounded-xl border-border px-6">{program.ownContact ? "동의 거두기" : "번호 공개에 동의하기"}</Button>{program.ownContact && <span className="text-xs text-primary">동의했어요</span>}</div>
    </>}
  </Sheet>;
}
