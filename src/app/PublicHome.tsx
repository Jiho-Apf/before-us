import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, ArrowUpRight, Check, Clock, Lock, Plus, RotateCcw } from "lucide-react";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./components/ui/accordion";
import { BEFORE_US } from "./config";
import DirectIntroduction from "./DirectIntroduction";
import { REFUND_NOTICE } from "./refund-policy";
import { DAY_PARTS, STORY, STORY_ENDING, STORY_NOTE, STORY_PEOPLE, dayPart, kstDayNumber, kstLabel, questionForDay } from "./home-story";

const interaction = "transition-colors duration-200 motion-reduce:transition-none";
const lift = "transition-transform duration-200 ease-out motion-reduce:transition-none";
const money = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}
// 페이지를 얼마나 내려왔는지 0~1. 두 점이 가까워지는 정도에만 쓴다.
function useScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(frame); };
  }, []);
  return progress;
}

// 아주 옅은 종이결. 보라색 면 위에서만 쓴다.
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
function Texture() {
  return <>
    <div aria-hidden="true" className="pointer-events-none absolute -top-40 -right-32 -z-10 size-[34rem] rounded-full bg-white/10 blur-3xl" />
    <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-24 -z-10 size-[28rem] rounded-full bg-accent/40 blur-3xl" />
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-[0.09] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
  </>;
}

function SectionLabel({ number, ko, children }: { number: string; ko?: string; children: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-xs font-semibold tabular-nums text-accent">{number}</span>
      <span aria-hidden="true" className="h-px w-8 bg-accent/40" />
      {ko && <span className="text-xs font-semibold">{ko}</span>}
      <span className="text-[10px] tracking-[0.16em] text-muted-foreground">{children}</span>
    </div>
  );
}
// 1분마다 다시 읽는 현재 시각. 시간대 색과 문구에만 쓴다.
function useMinuteNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(timer); }, []);
  return now;
}

// 다음 정오(Asia/Seoul)까지 남은 시간. 소개가 매일 있다고 약속하지 않도록 ‘다음 정오’로만 말한다.
function untilNoon(now: Date) {
  const kst = new Date(now.getTime() + 9 * 3600000);
  const noon = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 12) - 9 * 3600000;
  const target = now.getTime() < noon ? noon : noon + 86400000;
  const left = Math.max(0, Math.floor((target - now.getTime()) / 1000));
  return { left, atNoon: now.getTime() >= noon && now.getTime() < noon + 60000 };
}
function NoonClock({ tone = "light" }: { tone?: "light" | "plain" }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  const { left, atNoon } = untilNoon(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  const text = `${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`;
  const filled = Math.round((1 - left / 86400) * 1000) / 10;
  const light = tone === "light";
  const muted = light ? "text-white/75" : "text-muted-foreground";
  return (
    <div className="w-full max-w-[17rem]">
      <p className={`text-xs ${muted}`}>{atNoon ? "지금, 정오예요" : "다음 정오까지"}</p>
      <p className="mt-1.5 text-[2.5rem] font-extralight leading-none tracking-[-0.02em] tabular-nums" role="timer" aria-label={`다음 정오까지 ${text}`}>{text}</p>
      <div aria-hidden="true" className={`mt-4 h-px ${light ? "bg-white/25" : "bg-border"}`}><div className={`h-px ${light ? "bg-white" : "bg-primary"}`} style={{ width: `${filled}%` }} /></div>
      <p className={`mt-3 text-xs leading-5 ${muted}`}>소개는 준비된 날, 정오 12시에 도착해요.</p>
    </div>
  );
}

// 로고의 두 점. 스크롤을 내릴수록 천천히 다가가 마지막 신청 영역에서 맞닿는다.
function ScrollDots() {
  const reduced = useReducedMotion();
  const progress = useScrollProgress();
  const gap = reduced ? 10 : Math.round(72 * (1 - Math.min(1, progress / 0.97)));
  // 첫 화면(보라색 면)을 지난 뒤부터 보이고, 마지막 장면에서는 큰 두 점에 자리를 내준다.
  const visible = progress > 0.08 && progress < 0.93;
  return (
    <div aria-hidden="true" className={`pointer-events-none fixed top-1/2 right-4 z-30 hidden -translate-y-1/2 flex-col items-center transition-opacity duration-300 motion-reduce:transition-none xl:flex ${visible ? "opacity-100" : "opacity-0"}`}>
      <span className="size-3 rounded-full bg-primary shadow-[0_0_0_4px_var(--background)]" />
      <span className="w-px bg-border" style={{ height: gap }} />
      <span className="size-3 rounded-full bg-accent shadow-[0_0_0_4px_var(--background)]" />
    </div>
  );
}

function ServiceCollage() {
  return (
    <div className="relative mx-auto w-full max-w-lg pb-8 lg:pb-0" aria-label="서비스 화면 예시: 편지 나누기와 첫 장면 만들기">
      <div className="mb-6 flex items-center justify-between text-xs text-white/85 dark:text-white"><span className="border border-white/30 px-3 py-1.5">서비스 화면 예시</span><span className="tracking-[0.15em]">DAY 01—03</span></div>
      <div className="group/collage relative min-h-[510px] sm:min-h-[555px]">
        <div className={`absolute top-0 left-0 w-[78%] -rotate-3 border border-white/40 bg-white text-[#151515] shadow-xl hover:-translate-y-1.5 hover:-rotate-2 ${lift}`}>
          <div className="flex items-center justify-between border-b border-black/10 px-6 py-4 text-[10px] font-semibold tracking-[0.15em]"><span>A · 편지 나누기</span><span>DAY 01</span></div>
          <div className="px-6 pt-7 pb-12 sm:px-8"><div className="mb-6 flex gap-1.5" aria-hidden="true"><span className="size-2 rounded-full bg-primary" /><span className="size-2 rounded-full bg-accent" /></div><p className="text-xl font-semibold leading-relaxed">당신의 하루에서<br />가장 좋아하는 순간은?</p><p className="mt-5 text-xs leading-6 text-black/55">서로에게 하루 한 통.<br />한 번에 조금씩, 나의 이야기를 전합니다.</p><div className="mt-8 h-px bg-black/10" /><div className="mt-3 h-px w-4/5 bg-black/10" /></div>
          <div className="bg-accent px-6 py-3 text-[11px] text-white">하루 한 통의 편지, 각자의 속도로.</div>
        </div>
        <div className={`absolute top-44 right-0 w-[65%] rotate-3 border border-white/40 bg-white text-[#151515] shadow-xl hover:-translate-y-1.5 hover:rotate-2 ${lift}`}>
          <div className="flex items-center justify-between border-b border-black/10 px-5 py-4 text-[10px] font-semibold tracking-[0.1em]"><span>B · 첫 장면 만들기</span><span>DAY 02</span></div>
          <div className="px-5 py-6"><p className="text-[15px] font-semibold leading-6">함께 고르는<br />우리의 첫 장면.</p><div className="mt-5 space-y-2"><div className="flex items-center justify-between rounded-xl border border-accent bg-accent/5 px-3 py-3 text-[11px]"><span>조용한 동네를 함께 걷기</span><Check size={13} className="text-accent" /></div><div className="rounded-xl border border-black/10 px-3 py-3 text-[11px] text-black/55">좋아하는 음악을 함께 듣기</div></div></div>
          <div className="bg-accent px-5 py-3 text-[11px] text-white">두 사람이 함께 선택합니다.</div>
        </div>
        <span className="absolute bottom-6 left-0 w-[30%] text-[10px] leading-5 tracking-[0.12em] text-white/85 dark:text-white">TWO PEOPLE.<br />THEIR OWN PACE.</span>
      </div>
      <p className="mt-3 text-[10px] leading-5 text-white/85 dark:text-white">실제 회원의 편지나 프로필이 아닌 서비스 화면 예시입니다.</p>
    </div>
  );
}

function Hero() {
  const part = DAY_PARTS[dayPart(useMinuteNow())];
  return (
    <section className="relative isolate -mx-5 overflow-clip bg-primary text-primary-foreground sm:-mx-8 lg:-mx-12" aria-labelledby="home-title">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-20" style={{ backgroundImage: part.tint }} />
      <Texture />
      <div className="grid gap-12 px-5 pt-14 pb-28 sm:px-8 sm:pt-20 sm:pb-32 lg:grid-cols-[7fr_5fr] lg:items-center lg:gap-10 lg:px-12 lg:pt-20 lg:pb-32">
        <div className="relative z-10">
          <p className="mb-7 flex items-center gap-2.5 text-sm font-medium"><span aria-hidden="true" className="size-1.5 rounded-full bg-white" />운영진이 직접 고르는 일대일 소개</p>
          <h1 id="home-title" className="text-[clamp(2.5rem,5vw,4.25rem)] font-semibold leading-[1.22] tracking-[-0.02em]">끌리는 사람을,<br />천천히 알아갑니다.</h1>
          <p className="mt-7 max-w-lg text-sm leading-[1.95] text-white/85 dark:text-white sm:text-[15px]">하루에 한 사람만. 운영진이 당신의 이야기를 끝까지 읽고 고른 한 분을, 준비된 날 정오에 소개해요. 서로의 끌림이 확인되면, 두 사람만의 3일이 시작됩니다.</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button asChild className={`h-12 rounded-full bg-white px-6 text-primary hover:bg-white/90 ${interaction}`}><Link to="/apply">소개 신청하기 <ArrowUpRight size={17} /></Link></Button>
            <Button asChild variant="outline" className={`h-12 rounded-full border-white/35 bg-transparent px-5 text-white hover:bg-white/10 hover:text-white dark:bg-transparent ${interaction}`}><Link to="/two-starts">어떻게 알아가나요? <ArrowRight size={15} /></Link></Button>
          </div>
          <p className="mt-12 text-sm text-white/90">{part.phrase}</p>
          <div className="mt-5"><NoonClock /></div>
          <p className="mt-5 text-[11px] text-white/85 dark:text-white">데모 둘러보기 · 실제 신청이나 결제는 진행되지 않습니다.</p>
        </div>
        <ServiceCollage />
      </div>
      <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full fill-background sm:h-24" viewBox="0 0 1200 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 68 C300 -20 700 122 1200 28 L1200 100 L0 100 Z" /></svg>
    </section>
  );
}

function Philosophy() {
  return (
    <section className="grid gap-8 py-20 sm:py-24 lg:grid-cols-[7fr_5fr] lg:gap-16" aria-labelledby="philosophy-title">
      <div><SectionLabel number="01" ko="관점">OUR POINT OF VIEW</SectionLabel><h2 id="philosophy-title" className="max-w-xl text-3xl font-semibold leading-[1.5] sm:text-[38px]">마음을 서두르지 않고,<br />취향을 타협하지 않도록.</h2></div>
      <div className="lg:pt-16"><p className="text-[15px] leading-[2] text-muted-foreground">내가 좋아하는 사람인지, 나와 잘 맞는 사람인지. 조건표 한 장으로는 알 수 없어요. 그래서 함께 알아가는 시간 속에서 천천히 확인합니다. 억지로 호감을 만들거나, 다음 만남을 서두를 필요는 없어요.</p></div>
    </section>
  );
}

function Introduction() {
  return (
    <section id="how-it-works" className="border-t border-border py-16 sm:py-20" aria-labelledby="introduction-title">
      <div className="grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-16">
        <div className="relative flex min-h-72 flex-col justify-between overflow-hidden bg-muted p-8 sm:min-h-80 sm:p-10">
          <span className="text-[11px] font-semibold tracking-[0.13em] text-muted-foreground">ONE PAIR, AT A TIME</span>
          <div className="group/pair flex items-center justify-center gap-5 py-7" aria-hidden="true"><span className={`size-20 rounded-full bg-primary sm:size-24 group-hover/pair:translate-x-2 ${lift}`} /><span className={`size-20 rounded-full bg-accent sm:size-24 group-hover/pair:-translate-x-2 ${lift}`} /></div>
          <div className="flex items-baseline justify-between"><span className="text-sm font-semibold">한 사람을 향한 집중</span><span className="text-5xl font-light text-primary">02</span></div>
        </div>
        <div className="flex flex-col justify-center"><SectionLabel number="02" ko="소개">THE INTRODUCTION</SectionLabel><h2 id="introduction-title" className="text-3xl font-semibold leading-[1.5] sm:text-[34px]">많이 보여드리기보다,<br />한 사람을 신중하게.</h2><p className="mt-6 text-[15px] leading-[2] text-muted-foreground">사진 너머의 취향, 관계를 대하는 태도, 쉬는 날의 모습까지. 운영진이 두 사람의 이야기를 나란히 놓고 오래 들여다본 뒤에야 한 쌍을 제안해요.</p><div className="mt-7 flex items-start gap-3 border-t border-border pt-5"><Clock size={17} className="mt-1 shrink-0 text-accent" /><p className="text-sm leading-7">준비된 날, 정오 12시.<br /><span className="text-muted-foreground">두 사람에게 같은 순간에 도착해요.</span></p></div></div>
      </div>
    </section>
  );
}

function FounderLetter() {
  return (
    <section className="grid gap-10 border-t border-border py-16 sm:py-20 lg:grid-cols-[5fr_7fr] lg:gap-16" aria-labelledby="letter-title">
      <div>
        <SectionLabel number="03" ko="운영진의 편지">A LETTER FROM US</SectionLabel>
        <h2 id="letter-title" className="text-3xl font-semibold leading-[1.5] sm:text-[34px]">왜 하루에,<br />한 사람일까요?</h2>
      </div>
      <article className={`relative border border-border bg-card p-7 shadow-[0_1px_0_var(--border)] sm:p-10 hover:-translate-y-1 ${lift}`}>
        <div className="mb-7 flex gap-1.5" aria-hidden="true"><span className="size-2 rounded-full bg-primary" /><span className="size-2 rounded-full bg-accent" /></div>
        <div className="space-y-5 text-[15px] leading-[2]">
          <p>안녕하세요, 비포어스를 만든 사람입니다.</p>
          <p>끝없이 넘기는 프로필 속에서, 누군가를 정말 알아가 본 적이 언제였는지 생각해 봤어요. 많이 볼수록, 한 사람에게 마음을 쓰기는 오히려 어려워지니까요.</p>
          <p>그래서 비포어스는 하루에 한 사람만 소개해요. 신청서를 한 장씩 읽고, 두 분이 좋아하는 것과 중요하게 여기는 것을 나란히 놓고 오래 고민합니다. 도구의 도움을 받더라도, 마지막에 ‘이 두 사람’이라고 정하는 건 언제나 사람이에요.</p>
          <p>빠르지는 않을 거예요. 대신 소개가 도착한 날에는, 그 한 사람에게 온전히 마음을 써 보셨으면 해요.</p>
        </div>
        <p className="mt-9 text-sm font-semibold text-primary">끌리는 사람을, 천천히 알아갑니다.</p>
        <p className="mt-2 text-sm text-muted-foreground">비포어스 드림</p>
      </article>
      <div className="lg:col-span-2"><DirectIntroduction /></div>
    </section>
  );
}

function InitialOperation() {
  return (
    <section className="relative isolate -mx-5 overflow-clip bg-accent px-5 py-14 text-accent-foreground sm:-mx-8 sm:px-8 sm:py-16 lg:-mx-12 lg:px-12" aria-labelledby="initial-title">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-[0.08] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
      <div className="grid gap-8 lg:grid-cols-[7fr_5fr] lg:gap-16"><div><p className="mb-6 text-[11px] font-semibold tracking-[0.15em] opacity-85 dark:opacity-100">FOR OUR FIRST MEMBERS</p><h2 id="initial-title" className="text-3xl font-semibold leading-[1.5] sm:text-[34px]">첫 교류가 시작될 때까지,<br />추가 소개비 없이.</h2></div><div className="space-y-4 text-sm leading-[1.95]"><p>기다림도 알아가는 과정의 일부라고 생각해요. 첫 교류를 시작하기 전까지는 몇 번을 소개받아도 소개비가 다시 들지 않아요.</p><p className="opacity-85">소개가 없는 날에도 내 상태는 홈페이지에서 언제든 확인할 수 있고, 정오 상태 알림은 원하는 분만 받아요.</p><p className="border-t border-current/20 pt-4 text-xs opacity-85 dark:opacity-100">데모에서는 실제 소개와 상태 알림이 발송되지 않습니다.</p></div></div>
    </section>
  );
}

const SCENES = ["조용한 동네를 함께 걷기", "좋아하는 음악을 함께 듣기", "작은 전시를 천천히 둘러보기"];
// 지난 2주의 질문을 넘겨 볼 수 있는 달력. 내일 질문은 잠겨 있고, 다른 사람의 답은 보여 주지 않는다.
function QuestionCalendar({ today, selected, onSelect }: { today: number; selected: number; onSelect: (day: number) => void }) {
  const days = Array.from({ length: 15 }, (_, index) => today - 13 + index);
  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="mb-3 text-[10px] tracking-[0.12em] text-muted-foreground">지난 질문 · 하루에 하나씩 열려요</p>
      <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8">
        {days.map(day => {
          const future = day > today;
          const label = kstLabel(day);
          return (
            <button key={day} type="button" disabled={future} aria-pressed={selected === day} aria-label={future ? `${label} · 내일 열려요` : `${label} 질문 보기`} onClick={() => onSelect(day)}
              className={`flex h-12 flex-col items-center justify-center rounded-lg border text-[11px] ${interaction} ${selected === day ? "border-accent bg-accent text-white" : future ? "border-dashed border-border text-muted-foreground" : day === today ? "border-accent/60 text-accent hover:bg-accent/5" : "border-border hover:border-accent/50"}`}>
              {future ? <Lock size={12} /> : <span className="font-mono text-sm tabular-nums">{new Date(day * 86400000).getUTCDate()}</span>}
              <span className="text-[9px] opacity-80">{future ? "내일" : day === today ? "오늘" : label.split(" ").pop()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
function LetterTrial() {
  const today = kstDayNumber(new Date());
  const [day, setDay] = useState(today);
  const question = questionForDay(day);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [calendar, setCalendar] = useState(false);
  return (
    <div className="mt-8 border border-border bg-card p-5">
      <div className="flex justify-between text-[10px] font-medium text-accent"><span>{day === today ? "오늘의 질문" : `${kstLabel(day)}의 질문`} · 체험</span><span>저장되지 않아요</span></div>
      <p className="mt-4 text-[15px] font-semibold leading-7" aria-live="polite">{question}</p>
      {sent ? (
        <div className="mt-4 space-y-3" aria-live="polite">
          <div className="flex items-center gap-3 rounded-xl bg-accent/5 p-4 text-sm"><Lock size={16} className="shrink-0 text-accent" />한 통을 봉투에 넣었어요.</div>
          <p className="text-xs leading-6 text-muted-foreground">실제 교류에서는 두 사람 모두 보낸 뒤, 함께 열려요. 방금 쓴 글은 어디에도 저장되지 않았어요.</p>
          <Button variant="ghost" size="sm" onClick={() => { setSent(false); setText(""); }}><RotateCcw size={14} />다시 써 보기</Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <Textarea aria-label="오늘의 질문 답장 체험 · 저장되지 않음" maxLength={200} value={text} onChange={event => setText(event.target.value)} placeholder="한두 문장이면 충분해요." className="min-h-24 bg-background leading-7" />
          <div className="flex items-center justify-between"><span className="text-[11px] text-muted-foreground">{text.length}/200</span><Button size="sm" disabled={!text.trim()} onClick={() => setSent(true)}>한 통 보내 보기</Button></div>
        </div>
      )}
      <Button variant="link" size="sm" className="mt-2 h-auto px-0 text-xs text-muted-foreground hover:text-accent" aria-expanded={calendar} onClick={() => setCalendar(open => !open)}>{calendar ? "지난 질문 접기" : "지난 질문 넘겨 보기"}</Button>
      {calendar && <QuestionCalendar today={today} selected={day} onSelect={next => { setDay(next); setSent(false); setText(""); }} />}
    </div>
  );
}
function SceneTrial() {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="mt-8 space-y-3">
      <div className="flex justify-between text-[10px] font-medium text-accent"><span>일요일 오후, 어디서 시작할까요? · 체험</span><span>저장되지 않아요</span></div>
      {SCENES.map(scene => (
        <button key={scene} type="button" aria-pressed={picked === scene} onClick={() => setPicked(scene)} className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm ${interaction} ${picked === scene ? "border-accent bg-accent/5 text-accent" : "border-border bg-card hover:border-accent/60"}`}>
          {scene}{picked === scene && <Check size={15} />}
        </button>
      ))}
      {picked && (
        <div className="grid grid-cols-2 gap-3 pt-1" aria-live="polite">
          <div className="rounded-xl border border-accent bg-accent/5 p-3 text-xs leading-5"><span className="block text-[10px] text-accent">나의 선택</span>{picked}</div>
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-3 text-xs leading-5 text-muted-foreground"><Lock size={14} className="shrink-0" />상대도 고르면 함께 열려요</div>
        </div>
      )}
    </div>
  );
}

function TwoVoices() {
  const [voice, setVoice] = useState<"both" | "left" | "right">("both");
  const show = (side: "left" | "right") => voice === "both" || voice === side;
  const Name = ({ side }: { side: "left" | "right" }) => (
    <p className={`mb-3 flex items-center gap-2 text-xs font-semibold ${side === "left" ? "md:justify-end" : ""}`}>
      {side === "right" && <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />}
      {STORY_PEOPLE[side]}
      {side === "left" && <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />}
    </p>
  );
  const voiceClass = (side: "left" | "right") => `${show(side) ? "" : "hidden md:block md:opacity-25"} transition-opacity duration-200 motion-reduce:transition-none`;
  return (
    <section className="border-t border-border py-16 sm:py-24" aria-labelledby="story-title">
      <div className="mx-auto max-w-2xl text-center">
        <div className="flex justify-center"><SectionLabel number="04" ko="이야기">A STORY IN TWO VOICES</SectionLabel></div>
        <h2 id="story-title" className="text-3xl font-semibold leading-[1.5] sm:text-[38px]">두 사람의 3일은,<br />이렇게 흘러가요.</h2>
        <p className="mx-auto mt-5 max-w-md text-sm leading-7 text-muted-foreground">정오에 도착한 한 사람과의 3일을, 두 사람의 시점으로 나란히 적었어요.</p>
        <div role="group" aria-label="이야기 시점" className="mx-auto mt-8 flex w-fit rounded-full bg-muted p-1 text-xs">
          {([["both", "함께 읽기"], ["left", `${STORY_PEOPLE.left}의 시점`], ["right", `${STORY_PEOPLE.right}의 시점`]] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={voice === id} onClick={() => setVoice(id)} className={`rounded-full px-4 py-2 ${interaction} ${voice === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">약 3분</p>
      </div>
      <ol className="relative mx-auto mt-16 max-w-4xl">
        <span aria-hidden="true" className="absolute top-2 bottom-2 left-1/2 hidden w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-border to-transparent md:block" />
        {STORY.map(chapter => (
          <li key={chapter.id} className="relative pb-16 last:pb-4">
            <div className="relative z-10 mx-auto mb-8 max-w-sm bg-background px-4 text-center">
              <span className="inline-block rounded-full border border-accent/30 px-3 py-1 text-[10px] font-semibold tracking-[0.14em] text-accent">{chapter.label}</span>
              {chapter.prompt && <p className="mt-3 text-base font-medium leading-7">{chapter.prompt.endsWith("?") ? `“${chapter.prompt}”` : chapter.prompt}</p>}
            </div>
            <div className="grid gap-8 md:grid-cols-2 md:gap-16">
              <div className={`md:pr-6 md:text-right ${voiceClass("left")}`}>
                <Name side="left" />
                <p className="text-[15px] leading-[2] text-foreground/85">{chapter.left}</p>
              </div>
              <div className={`md:pl-6 ${voiceClass("right")}`}>
                <Name side="right" />
                <p className="text-[15px] leading-[2] text-foreground/85">{chapter.right}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mx-auto mt-10 max-w-2xl text-center">
        <div aria-hidden="true" className="mb-8 flex justify-center gap-1.5"><span className="size-2 rounded-full bg-primary" /><span className="size-2 rounded-full bg-accent" /></div>
        <p className="text-lg leading-[1.9]">{STORY_ENDING}</p>
        <p className="mx-auto mt-6 max-w-md text-xs leading-6 text-muted-foreground">{STORY_NOTE}</p>
      </div>
    </section>
  );
}

function Exchange() {
  return (
    <section id="two-starts" className="py-20 sm:py-24" aria-labelledby="exchange-title">
      <SectionLabel number="05" ko="두 가지 시작">TWO WAYS TO BEGIN</SectionLabel>
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><h2 id="exchange-title" className="text-3xl font-semibold leading-[1.5] sm:text-[38px]">마주하기 전,<br />우리만의 3일.</h2><p className="max-w-sm text-sm leading-7 text-muted-foreground">얼굴을 마주하기 전에, 서로의 생각과 취향을 먼저 만나요. 두 사람이 함께 고른 방식으로.</p></div>
      <div className="mt-10 grid border border-border md:grid-cols-2">
        <article className="flex flex-col border-b border-border bg-muted p-7 sm:p-10 md:border-r md:border-b-0"><div className="mb-8 flex items-start justify-between"><span className="text-6xl font-light leading-none text-primary">A</span><span className="pt-2 text-[10px] tracking-[0.12em] text-muted-foreground">ONE LETTER A DAY</span></div><h3 className="text-2xl font-semibold">편지 나누기</h3><p className="mt-4 min-h-14 text-sm leading-7 text-muted-foreground">각자 하루 한 통의 편지.<br />서로의 생각과 일상을 천천히 나눕니다.</p><LetterTrial /></article>
        <article className="flex flex-col bg-background p-7 sm:p-10"><div className="mb-8 flex items-start justify-between"><span className="text-6xl font-light leading-none text-accent">B</span><span className="pt-2 text-[10px] tracking-[0.12em] text-muted-foreground">CHOOSE A SCENE TOGETHER</span></div><h3 className="text-2xl font-semibold">첫 장면 만들기</h3><p className="mt-4 min-h-14 text-sm leading-7 text-muted-foreground">함께 고르며 서로를 알아가요.<br />같은 장면을 고른 순간, 대화가 시작됩니다.</p><SceneTrial /></article>
      </div>
      <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4 border-t border-border pt-6 text-xs"><span className="font-semibold text-accent">DAY 01—03 <span className="ml-2 font-normal text-foreground">교류</span></span><ArrowRight size={14} className="text-muted-foreground" /><span className="font-semibold text-accent">DAY 04 <span className="ml-2 font-normal text-foreground">각자 만남 의사 확인</span></span><span className="text-muted-foreground">양쪽이 희망하면 시간·장소 조율</span></div>
    </section>
  );
}

// 첫 화면과 각 섹션에서 옮겨 온 운영 규칙. 지우지 않고 한곳에 모은다.
const PROMISES = [
  "소개는 준비된 날 정오 12시에 하루 최대 한 명이에요. 매일 새 소개를 보장하지는 않아요.",
  "후보와 참여 시점이 맞기까지 기다림이 생길 수 있어요. 신청·검토·첫 소개 준비 전 대기는 무료예요.",
  "3일 교류는 상호 선택, 양쪽 결제, 같은 방식과 시작일 합의 뒤에 시작돼요. 소개를 기다린 기간과는 별개예요.",
  "3일 안에 친밀함이나 연애를 완성하라고, 만나라고 강요하지 않아요. 4일째에 각자 만남 의사를 선택해요.",
  "이번 첫 교류 전에는 소개 횟수 추가 과금·자동 갱신이 없어요.",
  "평생 무제한 소개, 매일 소개, 연애 성공, 약속 예약을 보장하지는 않아요.",
];
const FAQ = [
  { id: "waiting", title: "후보를 기다리는 동안은 어떻게 되나요?", text: "신청·검토·첫 소개 준비 전 대기는 무료입니다. 첫 소개를 제공할 준비와 현재 참여 가능성을 확인한 뒤 소개 이용료를 안내합니다. 준비된 날 정오 12시에 하루 최대 한 명을 소개하며, 매일 새 소개를 보장하지 않습니다. 활성 소개는 회원당 한 건이고, 상호 선택 뒤에는 새 소개를 멈춥니다." },
  { id: "three-days", title: "3일 동안 꼭 무언가를 해야 하나요?", text: "3일은 상호 선택·양쪽 결제·같은 방식과 시작일 합의 뒤 교류를 시작한 기간이며, 소개 대기 기간은 별도입니다. 그 안에 친밀함·연애를 완성하거나 만남을 강제하지 않습니다. 4일째에 두 분이 각자 만남 의사를 선택하고, 양쪽 모두 희망할 때만 시간과 장소를 조율합니다." },
  { id: "not-started", title: "상호 선택 후 교류가 시작되지 못하면요?", text: "상호 선택 후 기본 결제 기한은 24시간입니다. 한쪽만 결제하고 상대가 미결제면 결제자의 교류비 24,000원 전액 환불과 소개 권리 복원 대상입니다. 양쪽 결제 뒤 A/B·시작일 합의는 기본 48시간, 양쪽 동의 시 24시간 한 번 연장할 수 있습니다. 끝내 실제 교류가 시작되지 않으면 교류비 전액 환불과 소개 권리 유지입니다. 기한 도래·요청 클릭이 실제 환불 완료를 뜻하지 않으며 현재 실제 PG는 미연결입니다." },
  { id: "cancellation", title: "신청이나 교류를 취소할 수 있나요?", text: "결제 후 첫 상대 프로필을 실제로 열람하기 전 취소는 소개비 전액 환불입니다. 교류비는 해당 날짜 콘텐츠가 실제 이용 가능하게 열린 DAY별로 미제공분을 산정합니다. 취소·환불 요청과 검토·실제 환불 완료를 구분하며 실제 PG와 접수·발송은 미연결인 가상 자료 데모입니다." },
  { id: "refund", title: "환불과 보유기간, 재이용 기준은 무엇인가요?", text: `${REFUND_NOTICE} 정상 교류를 마친 뒤 새 소개를 원하면 새 회차 소개비 5,000원, 새 상대와 상호 선택 시 교류비 24,000원입니다. 교류 중단·약속 취소·노쇼 기준과 자료 보유·삭제 기간은 내 정보에서 확인할 수 있으며, 실제 약관의 법률 검토 완료를 의미하지 않습니다. 현재는 가상 정책 산정·요청 데모이고 실제 환불은 하지 않습니다.` },
  { id: "visibility", title: "어떤 정보가 상대에게 공개되나요?", text: "신청서 마지막 단계에서 상대에게 보일 항목을 직접 고르고, 특정 상대에게 제공하기 전에 한 번 더 동의를 받아요. 상대 프로필은 소개된 날 정오부터 다음 날 11:00 응답 마감까지 볼 수 있고, 서로 알아가기로 하면 교류와 약속이 끝날 때까지 이어져요. 끝난 소개를 다시 보는 보관함은 없어요. 화면에 등장하는 편지와 공동 선택은 서비스 화면 예시이며, 이 데모에서는 실제 개인정보를 수집하지 않습니다." },
  { id: "contact", title: "문의는 어디에서 할 수 있나요?", text: "페이지 맨 아래의 ‘문의하기’에서 남길 수 있어요. 회원이라면 내 정보의 ‘문의·신고’에서 진행 중인 소개와 연결해 남기면 더 빨리 확인할 수 있어요. 데모에서는 실제로 메일이 발송되지 않아요." },
];

function Pricing() {
  return (
    <section id="pricing" className="-mx-5 bg-muted px-5 py-16 sm:-mx-8 sm:px-8 sm:py-20 lg:-mx-12 lg:px-12" aria-labelledby="pricing-title">
      <SectionLabel number="06" ko="이용 요금">CLEAR FROM THE BEGINNING</SectionLabel>
      <div className="grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-16"><div><h2 id="pricing-title" className="text-3xl font-semibold leading-[1.5] sm:text-[34px]">시작하기 전에,<br />분명하게 안내합니다.</h2><p className="mt-5 text-sm leading-7 text-muted-foreground">신청·검토·첫 소개 준비 전 대기는 무료.<br />첫 소개 준비와 현재 참여 가능성 확인 후 안내합니다.</p></div><div>
        <div className="flex flex-wrap items-center gap-5 border-b border-border pb-7"><div><p className="mb-3 text-xs text-muted-foreground">소개 이용료</p><span className="text-3xl font-semibold">{money(BEFORE_US.pricing.introduction)}</span></div><Plus size={18} className="text-muted-foreground" /><div><p className="mb-3 text-xs text-muted-foreground">상호 선택 후 교류비 · 각자</p><span className="text-3xl font-semibold">{money(BEFORE_US.pricing.exchangePerPerson)}</span></div></div>
        <div className="flex flex-wrap items-end justify-between gap-4 pt-6"><p className="text-sm">첫 교류까지 1인 총액 <span className="mt-2 block text-xs text-muted-foreground">부가세 포함 · 현장 비용 별도</span></p><strong className="text-4xl font-semibold text-primary sm:text-5xl">{money(BEFORE_US.pricing.firstExchangeTotalPerPerson)}</strong></div>
        <div className="mt-8 border-t border-border pt-6"><p className="mb-4 text-sm font-semibold">분명히 해 두고 싶은 것들</p><ul className="space-y-3">{PROMISES.map(item => <li key={item} className="flex gap-3 text-sm leading-7"><span aria-hidden="true" className="mt-3 size-1.5 shrink-0 rounded-full bg-primary" />{item}</li>)}</ul></div>
        <div className="mt-7 flex flex-wrap items-center gap-3"><Button asChild className={`h-12 rounded-full px-6 ${interaction}`}><Link to="/apply">소개 신청하기 <ArrowUpRight size={16} /></Link></Button><Button asChild variant="link" className={`h-12 px-0 text-foreground hover:text-primary ${interaction}`}><a href="#faq">대기·미시작·취소·환불·공개 범위·문의 FAQ <ArrowRight size={14} /></a></Button></div><p className="mt-3 text-[11px] text-muted-foreground">데모에서는 실제 신청이나 결제가 진행되지 않습니다.</p>
      </div></div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="grid gap-8 py-16 sm:py-20 lg:grid-cols-[5fr_7fr] lg:gap-16" aria-labelledby="faq-title">
      <div><SectionLabel number="07" ko="자주 묻는 질문">BEFORE YOU BEGIN</SectionLabel><h2 id="faq-title" className="text-3xl font-semibold">시작 전, 궁금한 것들.</h2><p className="mt-5 text-sm leading-7 text-muted-foreground">확정된 운영 기준과<br />아직 정해지지 않은 정책을 구분해 안내합니다.</p></div>
      <Accordion type="single" collapsible className="border-t border-border [&_[data-slot=accordion-content]]:motion-reduce:animate-none [&_svg]:motion-reduce:transition-none">
        {FAQ.map(item => <AccordionItem key={item.id} value={item.id} id={`faq-${item.id}`}><AccordionTrigger className={`py-6 text-[15px] hover:no-underline hover:text-primary ${interaction}`}>{item.title}</AccordionTrigger><AccordionContent className="pb-6 text-sm leading-7 text-muted-foreground">{item.text}</AccordionContent></AccordionItem>)}
      </Accordion>
    </section>
  );
}

// 마지막 장면: 스크롤 내내 다가오던 두 점이 여기서 맞닿는다.
// 섹션이 화면 아래에서 들어올 때 0, 화면 가운데쯤 올라왔을 때 1.
function useSectionProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [value, setValue] = useState(0);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const element = ref.current;
      if (!element) return;
      const top = element.getBoundingClientRect().top, height = window.innerHeight;
      setValue(Math.min(1, Math.max(0, (height - top) / (height * 0.55))));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(frame); };
  }, []);
  return [ref, value] as const;
}
function Together() {
  const reduced = useReducedMotion();
  const [ref, progress] = useSectionProgress<HTMLElement>();
  const near = reduced ? 1 : progress;
  const offset = Math.round(64 * (1 - near));
  return (
    <section ref={ref} className="relative isolate -mx-5 overflow-clip bg-primary px-5 py-20 text-center text-primary-foreground sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12" aria-labelledby="together-title">
      <Texture />
      <div className="flex items-center justify-center py-6" aria-hidden="true">
        <span className="size-12 rounded-full bg-white sm:size-14" style={{ transform: `translateX(${-offset}px)` }} />
        <span className="-ml-2 size-12 rounded-full bg-accent mix-blend-screen sm:size-14" style={{ transform: `translateX(${offset}px)` }} />
      </div>
      <p className="mt-6 text-xs tracking-[0.15em] text-white/80">TWO DOTS, ONE SCENE</p>
      <h2 id="together-title" className="mt-4 text-3xl font-semibold leading-[1.5] sm:text-[38px]">이제, 한 사람을<br />만나볼 차례예요.</h2>
      <div className="mt-9 flex flex-col items-center gap-6">
        <Button asChild className={`h-12 rounded-full bg-white px-7 text-primary hover:bg-white/90 ${interaction}`}><Link to="/apply">소개 신청하기 <ArrowUpRight size={17} /></Link></Button>
        <NoonClock />
      </div>
      <div className="mx-auto mt-16 max-w-xl border-t border-white/20 pt-6 text-xs leading-6 text-white/75">
        <p className="text-sm text-white">다음 이야기는, 준비된 날 정오에 시작돼요.</p>
        <p className="mt-1">— 비포어스 드림</p>
      </div>
    </section>
  );
}

export function PublicInformation({ section }: { section: "introduction" | "exchange" | "pricing" }) {
  const title = { introduction: "진행 방식", exchange: "두 가지 시작", pricing: "이용 요금" }[section];
  return <div className="break-keep [overflow-wrap:anywhere]"><h1 className="sr-only">{title}</h1>{section === "introduction" && <><Introduction /><FounderLetter /><InitialOperation /></>}{section === "exchange" && <><TwoVoices /><Exchange /></>}{section === "pricing" && <><Pricing /><Faq /></>}</div>;
}

export default function PublicHome() {
  return <div className="break-keep [overflow-wrap:anywhere]"><ScrollDots /><Hero /><Philosophy /><Introduction /><FounderLetter /><TwoVoices /><InitialOperation /><Exchange /><Pricing /><Faq /><Together /></div>;
}
