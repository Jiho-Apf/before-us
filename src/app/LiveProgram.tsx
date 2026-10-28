import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, ChevronDown, LockOpen } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Eyebrow, Moment, NoteList, PageHeader, QuietNote, Sheet } from "./editorial";
import { Member, Waiting } from "./LiveMember";
import { kstDateTime, kstDay } from "./dates";
import { SAFETY_COMPOSE_NOTE } from "./message-safety";
import { APPOINTMENT_ACTIVITIES, QUICK_TIMES } from "./appointment-details";
import { END_REASON, PLAN_COPY, SCENE_ACTIVITY_LABEL, SCENE_ACTIVITY_ROWS, SCENE_PROMPTS, SCENE_REASON_MAX, SCENE_STAY, SCENE_TO_APPOINTMENT, SCENE_TOPIC_EXAMPLES, acceptAppointment, chooseFirstScene, chooseMeeting, choosePlan, confirmProgram, contactProblem, letterPrompt, loadMyProgram, loadReadablePrograms, proposeAppointment, proposeStart, sceneNote, setContactConsent, submitEntry, type EntryContent, type Program, type ProgramEntry, type ReadableProgram, type ScenePick, type Slot } from "./backend/program";

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

function Closed({ program, reread = false }: { program: Program; reread?: boolean }) {
  const done = program.endReason === "completed";
  return <Moment eyebrow={done ? "THANK YOU" : "SEE YOU AGAIN"} title={done ? "만남까지 마친 교류예요." : "이번 교류는 여기서 마무리됐어요."} action={<div className="flex flex-wrap gap-2"><Button asChild className="h-11 rounded-full px-6"><Link to="/today">오늘 화면으로</Link></Button>{reread && program.entries.length > 0 && <Button asChild variant="outline" className="h-11 rounded-full border-border px-5 hover:bg-muted hover:text-foreground"><Link to="/exchange">주고받은 글 다시 읽기</Link></Button>}<Button asChild variant="outline" className="h-11 rounded-full border-border px-5 hover:bg-muted hover:text-foreground"><Link to="/us">불편한 일 신고하기</Link></Button></div>}>{END_REASON[program.endReason ?? ""] ?? "다음 소개가 준비되면 정오에 알려 드릴게요."}</Moment>;
}

// ─────────────────────────────────────────────
// 교류: 합의 → 3일 → 만남 선택
export function LiveExchangePage() {
  return <Member><ExchangeView /></Member>;
}
function ExchangeView() {
  const { data, error, loading, reload, run } = useProgram();
  const [message, setMessage] = useState("");
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
      <PageHeader mark="교류" label={header.label} en="THREE DAYS, BEFORE US" titleId="exchange-title" title={header.title} lead={data.partnerName ? `${data.partnerName} 님과의 교류예요. 신고·차단은 두 사람 화면에서 언제든 할 수 있어요.` : undefined} aside={<Button asChild variant="outline" className="h-10 rounded-xl border-border text-xs"><Link to="/us">두 사람 화면</Link></Button>} />
      <Notice text={message} />
      {data.status === "choosing" && <Agreement program={data} act={act} />}
      {data.status === "scheduled" && <Moment eyebrow="SEE YOU AT 09:00" title={<>{data.startOn && dayLabel(data.startOn)} 09:00,<br />첫날이 열려요.</>}>{data.ownPlan && PLAN_COPY[data.ownPlan].name} · 3일 동안 이어지고, 넷째 날 09:00에 만남을 정해요. 시작하면 알림으로 알려 드릴게요.</Moment>}
      {data.status === "deciding" && <MeetingDecision program={data} act={act} />}
      {data.status === "arranging" && <Moment eyebrow="WE BOTH SAID YES" title="두 분 모두 만나고 싶다고 했어요." action={<Button asChild className="h-11 rounded-full px-6"><Link to="/meeting">약속 정하러 가기 <ArrowRight size={14} /></Link></Button>}>{data.arrangeBy && `${kstDateTime(data.arrangeBy)}까지 약속을 함께 정해 주세요.`}</Moment>}
      {data.status === "closed" && <Closed program={data} />}
      {reread && <QuietNote>두 분이 주고받은 글이에요. {data.readableUntil ? `${kstDateTime(data.readableUntil)}까지` : "보관 기간 동안"} 다시 읽을 수 있고, 그 뒤에는 이 화면에서 사라져요.</QuietNote>}
      {data.ownPlan === "B" && (data.status === "deciding" || data.status === "arranging" || reread || (data.status === "started" && !!data.startOn && data.today >= shift(data.startOn, 2))) && <FirstScene program={data} act={act} />}
      {(data.status === "started" || data.status === "deciding" || data.status === "arranging" || reread) && <Days program={data} act={act} />}
      <PastExchanges items={past.filter(item => item.id !== data.id)} />
      <QuietNote>{SAFETY_COMPOSE_NOTE}</QuietNote>
    </section>
  );
}

type Act = (action: () => Promise<{ data: Program | null; error: string | null }>, done?: string) => Promise<boolean>;

function Agreement({ program, act }: { program: Program; act: Act }) {
  const [date, setDate] = useState(program.startOn ?? "");
  useEffect(() => setDate(program.startOn ?? ""), [program.startOn]);
  const same = !!program.ownPlan && program.ownPlan === program.partnerPlan;
  const differ = !!program.ownPlan && !!program.partnerPlan && !same;
  const min = shift(program.today, 1), max = shift(program.today, 14);
  return <>
    <Sheet className="p-6 sm:p-8">
      <Eyebrow mark="01" label="방식 고르기" en="CHOOSE TOGETHER" />
      <p className="mt-3 text-sm leading-7 text-muted-foreground">두 분이 같은 방식을 고르면 시작일을 확인해요. 날마다 무엇을 하는지 보고 골라 주세요.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{(["A", "B"] as const).map(plan => <button key={plan} type="button" aria-pressed={program.ownPlan === plan} onClick={() => void act(() => choosePlan(program.id, plan), "골랐어요.")} className={choice(program.ownPlan === plan)}>
        <span className="flex items-center justify-between gap-2"><span className="font-semibold">{PLAN_COPY[plan].name}</span>{program.ownPlan === plan && <Check size={16} className="text-primary" />}</span>
        <span className="mt-2 block text-xs leading-6 text-muted-foreground">{PLAN_COPY[plan].description}</span>
        <span className="mt-3 block text-[11px] font-semibold text-primary">{PLAN_COPY[plan].fit}</span>
        <ol className="mt-3 space-y-1.5 border-t border-border pt-3">{PLAN_COPY[plan].days.map((title, index) => <li key={title} className="flex gap-2 text-xs leading-5 text-foreground/80"><span className="w-12 shrink-0 text-muted-foreground">{DAY_NAME[index]}</span>{title}</li>)}</ol>
        <span className="mt-3 block rounded-xl bg-mist px-3 py-2 text-xs leading-5 text-foreground/80">{PLAN_COPY[plan].example}</span>
        {program.partnerPlan === plan && <span className="mt-3 inline-block rounded-full bg-[#F8E5A6] px-2.5 py-1 text-[11px] font-semibold text-[#5A4310]">{program.ownPlan ? "상대도 이 방식을 골랐어요" : "상대가 고른 방식이에요"}</span>}
      </button>)}</div>
      {!program.partnerPlan && <p className="mt-4 text-xs text-muted-foreground">상대는 아직 고르지 않았어요.</p>}
      {differ && <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-mist p-5">
        <p className="text-sm leading-7"><span className="font-semibold">두 분의 선택이 달라요.</span><br /><span className="text-xs text-muted-foreground">나 {planName(program.ownPlan!)} · 상대 {planName(program.partnerPlan!)} · 한 분이 맞추면 바로 시작일 확인으로 넘어가요.</span></p>
        <Button onClick={() => void act(() => choosePlan(program.id, program.partnerPlan!), "상대 방식으로 맞췄어요.")} className="h-11 rounded-full px-6">상대 방식으로 맞추기</Button>
      </div>}
      <p className="mt-5 border-t border-border pt-4 text-xs leading-6 text-muted-foreground"><span className="font-semibold text-foreground">{kstDateTime(program.agreeBy)}까지</span> 두 분이 같은 방식과 시작일을 모두 확인해야 교류가 시작돼요. 그때까지 정해지지 않으면 교류는 열리지 않고 이번 소개는 마무리돼요. 그 뒤에는 다음 소개를 기다리게 돼요.</p>
    </Sheet>
    {same && <Sheet className="p-6 sm:p-8">
      <Eyebrow mark="02" label="시작일 확인" en="DAY 01" />
      <p className="mt-3 text-sm leading-7 text-muted-foreground">기본은 내일 09:00 시작이에요. 다른 날이 좋으면 14일 안에서 제안할 수 있어요. 제안한 사람은 그 날짜로 확인한 것으로 보고, 상대의 확인만 다시 받아요.</p>
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

// B: 함께 열린 날 두 분의 선택이 겹치면 작게 알려 준다.
function sameMoment(day: number, entry: ProgramEntry) {
  const own = entry.own?.payload ?? {}, theirs = entry.partner?.payload ?? {};
  if (day === 1 && own.activity && own.activity === theirs.activity) return `같은 곳을 골랐어요 · ${SCENE_ACTIVITY_LABEL[own.activity] ?? own.activity}`;
  if (day === 2 && own.flow && own.flow === theirs.flow) return `머무는 방식이 같아요 · ${own.flow}`;
  if (day === 2 && own.rest && own.rest === theirs.rest) return `쉬어 갈 곳이 같아요 · ${own.rest}`;
  return "";
}

function Days({ program, act }: { program: Program; act: Act }) {
  if (!program.startOn) return null;
  const plan = program.ownPlan ?? "A";
  const find = (day: number, kind: string = plan === "A" ? "letter" : "scene") => program.entries.find(entry => entry.day === day && entry.kind === kind);
  const isOpen = (entry?: ProgramEntry) => !!entry?.own && !!entry?.partner;
  return <div className="space-y-6">{[1, 2, 3].map(day => {
    const date = shift(program.startOn!, day - 1);
    const previous = day > 1 ? find(day - 1) : undefined;
    const previousOpened = day === 1 || isOpen(previous);
    const letter = letterPrompt(day, previousOpened), scene = SCENE_PROMPTS[day - 1];
    const main = find(day), reply = find(day, "reply");
    const isToday = program.status === "started" && program.day === day;
    const early = isToday && kstHour() < 9;
    const today = isToday && !early;
    const future = program.status === "started" && (date > program.today || early);
    const opened = isOpen(main);
    // 답장은 편지가 함께 열린 뒤 다음 날 09:00까지(셋째 날 답장은 넷째 날 09:00까지)
    const replyUntil = `${dayLabel(shift(date, 1))} 09:00`;
    const replyOpen = plan === "A" && program.status === "started" && opened && Date.now() < kstAt(shift(date, 1), "09:00");
    const match = plan === "B" && opened && main ? sameMoment(day, main) : "";
    return <Sheet key={day} className={`p-6 sm:p-8 ${today || (replyOpen && !reply?.own) ? "border-primary/40" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><Eyebrow mark={`0${day}`} label={plan === "A" ? letter.title : scene.title} en={DAY_NAME[day - 1]} /><span className="text-xs text-muted-foreground">{dayLabel(date)} 09:00~23:59</span></div>
      {future ? <p className="mt-4 text-sm text-muted-foreground">{dayLabel(date)} 오전 9시에 열려요. 그때 알림으로 알려 드릴게요.</p> : <>
        <p className="mt-4 text-sm font-semibold leading-7">{plan === "A" ? letter.question : scene.question}</p>
        {opened && <p className={`mt-4 inline-flex items-center gap-2 letter-drop ${butter}`}><LockOpen size={13} />{match || "두 분의 글이 모두 도착해 함께 열렸어요"}</p>}
        <EntryPair entry={main} plan={plan} day={day} past={!today} />
        {today && !main?.own && main?.partnerSent && <p className={`mt-4 inline-flex items-center gap-2 ${butter}`}><Check size={13} />상대는 이미 보냈어요. 내 글을 보내면 바로 함께 열려요.</p>}
        {today && !main?.own && (plan === "A"
          ? <LetterComposer draftKey={`${program.id}:${day}:letter`} examples={letter.examples} onSend={body => act(() => submitEntry(program.id, day, "letter", body), main?.partnerSent ? "보냈어요. 두 분의 편지가 함께 열렸어요." : "보냈어요. 상대도 보내면 함께 열려요.")} />
          : <SceneComposer draftKey={`${program.id}:${day}:scene`} day={day} previous={previousOpened ? previous : undefined} first={find(1)} onSend={(body, payload) => act(() => submitEntry(program.id, day, "scene", body, payload), main?.partnerSent ? "보냈어요. 두 분의 답이 함께 열렸어요." : "보냈어요. 상대도 보내면 함께 열려요.")} />)}
        {today && !main?.own && <p className="mt-3 text-[11px] text-muted-foreground">오늘 23:59까지 {untilMidnight()} 남았어요. 두 분 모두 보내야 함께 열려요.</p>}
        {plan === "A" && opened && <div className="mt-6 border-t border-border pt-5">
          <p className="text-xs font-semibold text-accent">답장 · 한 번 · {replyUntil}까지</p>
          <EntryPair entry={reply} plan="A" reply until={replyUntil} past={!replyOpen} />
          {replyOpen && !reply?.own && (reply?.partnerSent
            ? <p className={`mt-4 inline-flex items-center gap-2 ${butter}`}><Check size={13} />상대는 답장을 보냈어요. 내 답장도 보내면 함께 열려요.</p>
            : <p className="mt-3 text-xs leading-6 text-muted-foreground">열린 편지에 답장을 한 번 보낼 수 있어요. 두 분 모두 보내면 답장도 함께 열려요.</p>)}
          {replyOpen && !reply?.own && <LetterComposer reply draftKey={`${program.id}:${day}:reply`} onSend={body => act(() => submitEntry(program.id, day, "reply", body), reply?.partnerSent ? "답장을 보냈어요. 두 분의 답장이 함께 열렸어요." : "답장을 보냈어요. 상대도 보내면 함께 열려요.")} />}
          {!replyOpen && !reply?.own && <p className="mt-3 text-xs text-muted-foreground">{reply?.partnerSent ? "두 분이 모두 답장을 보내지 않아 답장은 열리지 않았어요." : "이날은 답장을 나누지 않았어요."}</p>}
        </div>}
        {!today && !main?.own && <p className="mt-4 text-xs text-muted-foreground">이날은 글을 보내지 않았어요.</p>}
      </>}
    </Sheet>;
  })}</div>;
}

function sceneText(payload: Record<string, string> | null) {
  if (!payload) return "";
  return [payload.activity && SCENE_ACTIVITY_LABEL[payload.activity], payload.flow, payload.rest, payload.topic && `“${payload.topic}”`].filter(Boolean).join(" · ");
}
// 글 한 장: B는 고른 것·이유·전날 선택에 남긴 한마디·나를 소개하는 답을 함께 보여 준다(상대에게도 똑같이 보인다).
function EntryCard({ who, content, plan, day, tone }: { who: string; content: EntryContent; plan: "A" | "B"; day: number; tone: string }) {
  const payload = content.payload ?? {};
  return <article className={`rounded-2xl p-5 ${tone}`}>
    <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{who}{content.at && ` · ${kstDateTime(content.at)}`}</p>
    {plan === "B" && payload.place && <p className="mt-2 text-[11px] text-muted-foreground">떠올린 곳 · {SCENE_ACTIVITY_LABEL[payload.place] ?? payload.place}</p>}
    {plan === "B" && sceneText(payload) && <p className={`${payload.place ? "mt-1" : "mt-2"} text-sm font-semibold`}>{sceneText(payload)}</p>}
    {content.body && (plan === "B" ? <p className="mt-2 text-sm leading-7"><span className="text-xs text-muted-foreground">고른 이유 · </span>{content.body}</p> : <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{content.body}</p>)}
    {plan === "B" && payload.reaction && <p className="mt-2 text-sm leading-7"><span className="text-xs text-muted-foreground">어제 선택에 · </span>{payload.reaction}</p>}
    {plan === "B" && payload.about && <p className="mt-3 border-t border-border/70 pt-3 text-sm leading-7"><span className="block text-[11px] font-semibold text-muted-foreground">{SCENE_PROMPTS[day - 1].about}</span>{payload.about}</p>}
  </article>;
}
function EntryPair({ entry, plan, day = 1, reply = false, past = false, until = "오늘 23:59" }: { entry?: ProgramEntry; plan: "A" | "B"; day?: number; reply?: boolean; past?: boolean; until?: string }) {
  if (!entry || (!entry.own && !entry.partner)) return null;
  return <div className="mt-5 grid gap-3 lg:grid-cols-2">
    {entry.own && <EntryCard who={reply ? "내 답장" : "내가 보낸 글"} content={entry.own} plan={plan} day={day} tone="bg-mist" />}
    {entry.partner ? <EntryCard who={reply ? "상대의 답장" : "상대의 글"} content={entry.partner} plan={plan} day={day} tone="border border-lilac bg-card" /> : entry.own && <p className="rounded-2xl border border-dashed border-border p-5 text-xs leading-6 text-muted-foreground">{entry.partnerSent ? "상대도 보냈어요. 곧 함께 열려요." : past ? (reply ? "상대가 답장을 보내지 않아 열리지 않았어요." : "상대가 이날 글을 보내지 않아 열리지 않았어요.") : `상대가 보내면 함께 열려요. ${until}까지 기다려요.`}</p>}
  </div>;
}

// 쓰다 만 편지·첫 장면 답은 이 기기에 저장해 두고, 보내기에 성공했을 때만 지운다(새로고침하거나 보내기가 실패해도 사라지지 않게).
const DRAFT_PREFIX = "before-us:letter-draft:";
const readDraft = (key: string) => { try { return localStorage.getItem(DRAFT_PREFIX + key) ?? ""; } catch { return ""; } };
const writeDraft = (key: string, value: string) => { try { if (value.trim()) localStorage.setItem(DRAFT_PREFIX + key, value); else localStorage.removeItem(DRAFT_PREFIX + key); } catch { /* 저장 공간이 막혀 있으면 이 화면에서만 유지 */ } };
// 예시 보기: 그날 질문에 맞는 예시 답 몇 개를 읽기만 하게 보여 준다(편지에 넣거나 복사하는 버튼은 두지 않는다).
export function LetterExamples({ examples, className = "" }: { examples: readonly string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!examples.length) return null;
  return <div className={className}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className={`inline-flex items-center gap-1 rounded-full text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${interaction}`}>{open ? "예시 닫기" : "예시 보기"}<ChevronDown size={13} className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} /></button>
    {open && <ul aria-label="이 질문의 예시 답" className="mt-2 space-y-1.5 rounded-xl bg-mist px-4 py-3 text-xs leading-6 text-foreground/75">{examples.map(example => <li key={example}>“{example}”</li>)}</ul>}
  </div>;
}
function LetterComposer({ onSend, reply = false, draftKey, examples = [] }: { onSend: (body: string) => Promise<boolean>; reply?: boolean; draftKey: string; examples?: readonly string[] }) {
  const [body, setBody] = useState(() => readDraft(draftKey));
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => writeDraft(draftKey, body), 400); return () => window.clearTimeout(timer); }, [body, draftKey]);
  const length = Array.from(body.trim()).length, min = reply ? 1 : 20, max = reply ? 600 : 1000;
  const sweet = !reply && length >= 300 && length <= 600;
  const send = async () => {
    // 서버와 같은 기준으로 먼저 살펴, 보내기 실패 대신 무엇을 빼면 되는지 알려 준다.
    const problem = contactProblem(body);
    if (problem) { setWarning(problem); return; }
    setSending(true);
    if (await onSend(body)) writeDraft(draftKey, "");
    setSending(false);
  };
  return <div className="mt-5 space-y-3">
    {!reply && <LetterExamples examples={examples} />}
    <Textarea aria-label={reply ? "열린 편지에 답장 쓰기" : "오늘의 편지 쓰기"} value={body} onChange={event => { setBody(event.target.value); setWarning(""); }} maxLength={max} rows={reply ? 3 : 7} placeholder={reply ? "열린 편지에 한 번 답해요." : "나를 소개하듯 편하게 적어 주세요. 보낸 뒤에는 고칠 수 없어요."} className="rounded-xl border-border bg-card text-base leading-7 md:text-sm" />
    {warning && <p role="alert" className="text-xs leading-6 text-destructive">{warning}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{length} / {max}자{!reply && (length < 20 ? " · 20자부터 보낼 수 있어요" : sweet ? " · 읽기 좋은 길이예요" : length < 300 ? " · 300~600자를 권해요" : "")}{body && " · 이 기기에 저장 중"}</span>
      <Button disabled={sending || length < min} onClick={() => void send()} className="h-11 rounded-full px-6">{sending ? "보내는 중…" : reply ? "답장 보내기" : "편지 보내기"}</Button>
    </div>
  </div>;
}

// 고르는 칩. 장소 일곱 곳이 모두 나올 때는 늘 두 줄(전시 산책 서점 카페 / 공원·피크닉 시장 골목 작은 공연)로 나눈다.
function Chips({ options, value, onPick, label }: { options: [string, string][]; value?: string; onPick: (value: string) => void; label: string }) {
  const chip = ([key, text]: [string, string]) => <button key={key} type="button" aria-pressed={value === key} onClick={() => onPick(key)} className={`rounded-full border px-4 py-2 text-sm ${interaction} ${value === key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"}`}>{text}</button>;
  const allPlaces = options.length === ACTIVITY_OPTIONS.length && ACTIVITY_OPTIONS.every(([key]) => options.some(([option]) => option === key));
  if (allPlaces) return <div className="space-y-2" role="group" aria-label={label}>{SCENE_ACTIVITY_ROWS.map(row => <div key={row[0]} className="flex flex-wrap gap-2">{row.map(key => chip(options.find(([option]) => option === key)!))}</div>)}</div>;
  return <div className="flex flex-wrap gap-2" role="group" aria-label={label}>{options.map(chip)}</div>;
}
const ACTIVITY_OPTIONS = Object.entries(SCENE_ACTIVITY_LABEL) as [string, string][];
const pairs = (items: readonly string[]) => items.map(item => [item, item] as [string, string]);
// 그날 쓰는 칸(서버도 이 칸만 저장한다)
const SCENE_KEYS = [["activity", "about"], ["place", "flow", "rest", "reaction", "about"], ["topic", "reaction", "about"]];

function SceneComposer({ day, draftKey, previous, first, onSend }: { day: number; draftKey: string; previous?: ProgramEntry; first?: ProgramEntry; onSend: (body: string | null, payload: Record<string, string>) => Promise<boolean> }) {
  // 쓰던 답은 편지처럼 이 기기에 저장해 둔다.
  const [draft, setDraft] = useState<{ payload: Record<string, string>; body: string }>(() => { try { const saved = JSON.parse(readDraft(draftKey) || "null"); return saved && typeof saved === "object" ? { payload: saved.payload ?? {}, body: saved.body ?? "" } : { payload: {}, body: "" }; } catch { return { payload: {}, body: "" }; } });
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState("");
  const { payload, body } = draft;
  useEffect(() => { const timer = window.setTimeout(() => writeDraft(draftKey, body.trim() || Object.values(payload).some(value => value.trim()) ? JSON.stringify(draft) : ""), 400); return () => window.clearTimeout(timer); }, [draft, draftKey]);
  const pick = (key: string, value: string) => { setWarning(""); setDraft(current => ({ ...current, payload: { ...current.payload, [key]: value } })); };
  const prompt = SCENE_PROMPTS[day - 1];
  const opened = !!previous?.own && !!previous?.partner;
  // 둘째 날 기준이 되는 곳(서버와 같은 기준): 첫날 답이 함께 열렸으면 두 분이 고른 곳, 아니면 내가 고른 곳, 그것도 없으면 일곱 곳 중에서 하나를 먼저 고른다.
  const ownFirst = first?.own?.payload?.activity, partnerFirst = first?.own && first?.partner ? first.partner.payload?.activity : undefined;
  const places = [...new Set([ownFirst, partnerFirst].filter((key): key is string => !!key && !!SCENE_STAY[key]))];
  const choosePlace = !places.length;
  const stayPlaces = choosePlace ? (payload.place && SCENE_STAY[payload.place] ? [payload.place] : []) : places;
  // 머무는 방식·쉬어 갈 곳은 한 곳을 기준으로 고른다(다른 곳의 칩을 누르면 그곳으로 바꾸고 다른 칸은 비운다).
  const pickStay = (place: string, key: "flow" | "rest", value: string) => { setWarning(""); setDraft(current => ({ ...current, payload: current.payload.place === place ? { ...current.payload, [key]: value } : { ...current.payload, place, flow: "", rest: "", [key]: value } })); };
  const clean: Record<string, string> = Object.fromEntries(SCENE_KEYS[day - 1].map(key => [key, (payload[key] ?? "").trim()]).filter(([, value]) => value));
  const reason = day < 3 ? body.trim() : "";
  const placeOk = !!clean.place && (choosePlace ? !!SCENE_STAY[clean.place] : places.includes(clean.place)) && SCENE_STAY[clean.place].flows.includes(clean.flow) && SCENE_STAY[clean.place].rests.includes(clean.rest);
  const ready = !!clean.about && Array.from(reason).length <= SCENE_REASON_MAX && (day === 1 ? !!clean.activity : day === 2 ? placeOk && (!opened || !!clean.reaction) : !!clean.topic && (!opened || !!clean.reaction));
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
    {day === 1 && <Chips label="끌리는 장소" options={ACTIVITY_OPTIONS} value={payload.activity} onPick={value => pick("activity", value)} />}
    {day === 2 && choosePlace && <div className="space-y-2"><p className="text-xs font-semibold">어느 곳을 떠올리며 고를까요?</p><Chips label="떠올릴 곳" options={ACTIVITY_OPTIONS} value={payload.place} onPick={value => setDraft(current => ({ ...current, payload: { ...current.payload, place: value, flow: current.payload.place === value ? current.payload.flow : "", rest: current.payload.place === value ? current.payload.rest : "" } }))} /></div>}
    {day === 2 && stayPlaces.map(place => <div key={place} className={`space-y-3 rounded-2xl border p-4 ${interaction} ${payload.place === place ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      {(stayPlaces.length > 1 || !choosePlace) && <p className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#F8E5A6] px-2.5 py-1 text-[11px] font-semibold text-[#5A4310]">{SCENE_ACTIVITY_LABEL[place]}</span><span className="text-[11px] text-muted-foreground">{place === ownFirst && place === partnerFirst ? "두 분이 고른 곳" : place === ownFirst ? "내가 고른 곳" : "상대가 고른 곳"}</span></p>}
      <p className="text-xs font-semibold">머무는 방식</p><Chips label={`${SCENE_ACTIVITY_LABEL[place]} · 머무는 방식`} options={pairs(SCENE_STAY[place].flows)} value={payload.place === place ? payload.flow : undefined} onPick={value => pickStay(place, "flow", value)} />
      <p className="text-xs font-semibold">쉬어 갈 곳</p><Chips label={`${SCENE_ACTIVITY_LABEL[place]} · 쉬어 갈 곳`} options={pairs(SCENE_STAY[place].rests)} value={payload.place === place ? payload.rest : undefined} onPick={value => pickStay(place, "rest", value)} />
    </div>)}
    {day === 2 && stayPlaces.length > 1 && <p className="text-[11px] leading-5 text-muted-foreground">두 곳 중 한 곳을 정해, 그곳에서 머무는 방식과 쉬어 갈 곳을 골라 주세요.</p>}
    {day < 3 && field("고른 이유 한 줄(선택)", <Input value={body} maxLength={SCENE_REASON_MAX} onChange={event => { setWarning(""); setDraft(current => ({ ...current, body: event.target.value })); }} placeholder={prompt.reasonHint} className="h-11 rounded-xl border-border bg-card font-normal" />)}
    {day === 3 && <>{field("나누고 싶은 이야기", <Input value={payload.topic ?? ""} maxLength={80} onChange={event => pick("topic", event.target.value)} placeholder="예: 요즘 가장 오래 머문 장소 이야기" className="h-11 rounded-xl border-border bg-card font-normal" />)}{!payload.topic && <div className="flex flex-wrap gap-2" aria-label="이야기 예시">{SCENE_TOPIC_EXAMPLES.map(example => <button key={example} type="button" onClick={() => pick("topic", example)} className={`rounded-full border border-border bg-card px-3.5 py-2 text-xs text-foreground/80 hover:border-primary/40 hover:text-foreground ${interaction}`}>{example}</button>)}</div>}</>}
    {day > 1 && theirs && <div className="rounded-2xl bg-mist p-4"><p className="text-[11px] font-semibold text-muted-foreground">어제 상대가 고른 것</p><p className="mt-1 text-sm font-semibold">{sceneText(theirs.payload)}</p>{theirs.body && <p className="mt-1 text-xs leading-6 text-muted-foreground">고른 이유 · “{theirs.body}”</p>}</div>}
    {day > 1 && field(opened ? prompt.reaction : prompt.reactionAlt, <Input value={payload.reaction ?? ""} maxLength={150} onChange={event => pick("reaction", event.target.value)} placeholder={opened ? (day === 2 ? "예: 서점이라니, 요즘 읽는 책이 궁금해졌어요" : "예: 천천히 머무는 거 저도 좋아요") : "예: 조용한 곳을 좋아하실 것 같아요"} className="h-11 rounded-xl border-border bg-card font-normal" />)}
    {field(prompt.about, <Input value={payload.about ?? ""} maxLength={100} onChange={event => pick("about", event.target.value)} placeholder={prompt.aboutHint} className="h-11 rounded-xl border-border bg-card font-normal" />)}
    {ready && <div><p className="mb-2 text-[11px] font-semibold text-muted-foreground">상대에게는 이렇게 보여요</p><EntryCard who="내 답" content={{ body: reason || null, payload: clean, at: "" }} plan="B" day={day} tone="bg-mist" /></div>}
    <p className="text-[11px] leading-5 text-muted-foreground">{prompt.sees} 보낸 뒤에는 고칠 수 없어요.</p>
    {warning && <p role="alert" className="text-xs leading-6 text-destructive">{warning}</p>}
    <div className="flex justify-end"><Button disabled={!ready || sending} onClick={() => void send()} className="h-11 rounded-full px-6">{sending ? "보내는 중…" : "보내기"}</Button></div>
  </div>;
}

function MeetingDecision({ program, act }: { program: Program; act: Act }) {
  const [confirm, setConfirm] = useState<"positive" | "negative" | null>(null);
  // 사흘 동안 함께 열린 글이 하나도 없었는지
  const nothingOpened = !program.entries.some(entry => (entry.kind === "letter" || entry.kind === "scene") && !!entry.own && !!entry.partner);
  return <Sheet className="p-6 sm:p-8">
    <Eyebrow mark="04" label="만남 선택" en="넷째 날" />
    {program.ownMeeting ? <p className="mt-4 text-sm leading-7">{program.ownMeeting === "positive" ? "만나고 싶다고 답했어요." : "이번에는 여기까지라고 답했어요."} 두 분이 모두 답하면 결과만 알려 드려요. 상대의 답은 알려 드리지 않아요.</p> : <>
      {nothingOpened && <p className="mt-4 rounded-2xl bg-mist p-4 text-sm leading-7">사흘 동안 함께 열린 글은 없었어요. 바쁜 날이 겹쳤을 수도 있어요. 그래도 한 번 만나 보고 싶은 마음이 있다면, 그 마음대로 골라 주세요.</p>}
      <p className="mt-4 text-sm leading-7 text-muted-foreground">{program.meetingBy && `${kstDateTime(program.meetingBy)}까지`} 골라 주세요. 두 분 모두 ‘만나고 싶어요’일 때만 약속을 정해요. 답은 바꿀 수 없어요.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{([["positive", "만나고 싶어요", "약속 날짜·장소를 함께 정해요."], ["negative", "이번에는 여기까지", "상대에게 내 답은 알리지 않아요."]] as const).map(([value, title, sub]) => <button key={value} type="button" aria-pressed={confirm === value} onClick={() => setConfirm(value)} className={choice(confirm === value)}><span className="font-semibold">{title}</span><span className="mt-1 block text-xs text-muted-foreground">{sub}</span></button>)}</div>
      {confirm && <div className="mt-5 flex justify-end"><Button onClick={() => void act(() => chooseMeeting(program.id, confirm), "답을 남겼어요.")} className="h-11 rounded-xl px-6">이 답으로 보내기</Button></div>}
    </>}
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
    </div>}
  </>;
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
  if (data.status === "closed") return <section className="space-y-8"><PageHeader mark="약속" label="마무리" en="THE NEXT SCENE" title="이번 약속은 마무리됐어요." /><Closed program={data} reread /></section>;
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
const sceneValue = (key: string, value?: string) => value ? key === "activity" ? SCENE_ACTIVITY_LABEL[value] ?? value : value : "";

// B 첫 장면: 사흘 동안 고른 것을 모아 보여 주고, 셋째 날 답이 함께 열리면 두 분이 고른 것 중에서 하나씩 골라 맞춘다.
function FirstScene({ program, act }: { program: Program; act: Act }) {
  const scene = (day: number) => program.entries.find(entry => entry.day === day && entry.kind === "scene");
  // 그날 답이 함께 열렸으면 두 분이 고른 것, 열리지 않았으면 처음 목록에서 고른다(서버와 같은 기준).
  const both = (day: number, key: string) => { const entry = scene(day); return entry?.own && entry.partner ? [...new Set([entry.own.payload?.[key], entry.partner.payload?.[key]].filter(Boolean) as string[])] : null; };
  const final = program.entries.find(entry => entry.kind === "final");
  const own = final?.own?.payload as ScenePick | undefined, theirs = final?.partner?.payload as ScenePick | undefined;
  const [pick, setPick] = useState<Partial<ScenePick>>(() => own ?? {});
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (own) setPick(own); }, [final?.own?.at]);
  const activities = both(1, "activity") ?? Object.keys(SCENE_ACTIVITY_LABEL);
  const activity = pick.activity && activities.includes(pick.activity) ? pick.activity : activities.length === 1 ? activities[0] : undefined;
  // 둘째 날 답이 함께 열리지 않았으면 맞추려는 장소에 맞는 목록에서 고른다(서버와 같은 기준).
  const stay = activity ? SCENE_STAY[activity] : undefined;
  const options: Record<keyof ScenePick, string[]> = { activity: activities, flow: both(2, "flow") ?? [...(stay?.flows ?? [])], rest: both(2, "rest") ?? [...(stay?.rests ?? [])], topic: both(3, "topic") ?? [] };
  const agreed = !!own && !!theirs && SCENE_FIELDS.every(([key]) => own[key] === theirs[key]);
  const canPick = ["started", "deciding", "arranging"].includes(program.status) && !program.meetingOn && options.topic.length > 0 && !agreed;
  const value = (key: keyof ScenePick) => pick[key] && options[key].includes(pick[key]!) ? pick[key] : options[key].length === 1 ? options[key][0] : undefined;
  const complete = SCENE_FIELDS.every(([key]) => !!value(key));
  const submit = async (next: ScenePick) => { if (await act(() => chooseFirstScene(program.id, next), "골랐어요.")) setEditing(false); };
  const table = (rows: Partial<ScenePick> | undefined) => <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">{SCENE_FIELDS.map(([key, label]) => rows?.[key] ? <div key={key}><dt className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold">{key === "topic" ? `“${rows[key]}”` : sceneValue(key, rows[key])}</dd></div> : null)}</dl>;

  // 셋째 날 답이 열리기 전: 지금까지 함께 열린 것과 내가 고른 것을 모아 보여 준다.
  if (!options.topic.length) {
    const picked = (day: number, key: string) => { const entry = scene(day); return [...new Set([entry?.own?.payload?.[key], entry?.partner?.payload?.[key]].filter(Boolean) as string[])]; };
    const rows = [["장소", picked(1, "activity").map(key => SCENE_ACTIVITY_LABEL[key] ?? key)], ["머무는 방식", picked(2, "flow")], ["쉬어 갈 곳", picked(2, "rest")], ["나눌 이야기", picked(3, "topic").map(topic => `“${topic}”`)]] as const;
    if (!rows.some(([, items]) => items.length)) return null;
    return <Sheet tone="soft" className="p-6 sm:p-8">
      <Eyebrow label="지금까지 고른 것" en="OUR FIRST SCENE" />
      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">{rows.map(([label, items]) => items.length ? <div key={label}><dt className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold">{items.join(" · ")}</dd></div> : null)}</dl>
      <p className="mt-5 text-xs leading-6 text-muted-foreground">{program.status === "started" ? "상대의 선택은 그날 두 분이 모두 보내야 보여요. 셋째 날 답이 함께 열리면, 두 분이 고른 것 중에서 하나씩 골라 첫 장면을 맞춰요." : "셋째 날 답이 함께 열리지 않아 첫 장면을 맞추지는 않았어요. 두 분이 고른 것은 그대로 남아 있어요."}</p>
    </Sheet>;
  }

  return <Sheet tone="soft" className="p-6 sm:p-8">
    <Eyebrow label={agreed ? "함께 맞춘 첫 장면" : "첫 장면 맞추기"} en="OUR FIRST SCENE" />
    {agreed ? <>
      <p className={`mt-4 inline-flex items-center gap-2 letter-drop ${butter}`}><Check size={13} />두 분이 같은 장면을 골랐어요 · 확정</p>
      {table(own)}
      <p className="mt-5 text-xs leading-6 text-muted-foreground">{program.status === "closed" ? "두 분이 함께 맞춘 장면이에요." : "두 분 모두 만나고 싶다고 하면, 약속 제안에 이 장면이 미리 채워져요. 날짜·지역은 그때 함께 정해요."}</p>
    </> : canPick && (!own || editing) ? <>
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
  </Sheet>;
}

function ProposalForm({ program, act, again }: { program: Program; act: Act; again: boolean }) {
  const [openForm, setOpenForm] = useState(!again);
  const [slots, setSlots] = useState<Slot[]>([{ date: "", start: "14:00", end: "17:00" }]);
  // B는 첫 장면의 장소를 활동으로, 흐름·쉬어 갈 곳·이야기를 한마디로 미리 채워 둔다(고칠 수 있다).
  const [activity, setActivity] = useState(() => { const key = program.ownPlan === "B" ? scenePick(program).activity : undefined; return key ? SCENE_TO_APPOINTMENT[key] ?? "" : ""; });
  const [region, setRegion] = useState("");
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
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{program.contactReleaseAt && Date.parse(program.contactReleaseAt) <= Date.now() ? "번호는 열리지 않았어요. 두 분 중 한 분이 아직 동의하지 않았어요. 정한 시간과 장소에서 만나고, 문제가 생기면 두 사람 화면에서 신고해 주세요." : `두 분이 각자 동의하면 ${program.contactReleaseAt ? kstDateTime(program.contactReleaseAt) : "만나는 날 00:00"}부터 다음 날 23:59까지만 서로의 휴대폰 번호가 보여요. 상대의 선택은 열리기 전까지 알려 드리지 않아요.`}</p>
      <div className="mt-5 flex flex-wrap items-center gap-3"><Button variant={program.ownContact ? "outline" : "default"} onClick={() => void act(() => setContactConsent(program.id, !program.ownContact), program.ownContact ? "동의를 거뒀어요." : "동의했어요. 만나는 날 00:00에 열려요.")} className="h-11 rounded-xl border-border px-6">{program.ownContact ? "동의 거두기" : "번호 공개에 동의하기"}</Button>{program.ownContact && <span className="text-xs text-primary">동의했어요</span>}</div>
    </>}
  </Sheet>;
}
