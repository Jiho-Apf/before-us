import { usePageWidth, useScrollReveal } from "./scroll-reveal";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Clock, Lock, LockOpen, PenLine, Plus, RotateCcw } from "lucide-react";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./components/ui/accordion";
import { BEFORE_US } from "./config";
import { LIVE, rpc } from "./backend/client";
import { CUSTOM, LETTER_SETS, PLAN_COPY, SCENE_ACTIVITY_LABEL, SCENE_ACTIVITY_ROWS, SCENE_CUSTOM_MAX, SCENE_TOPIC_EXAMPLES, SCENE_TOPIC_MAX, isCustom, sceneLabel, stayFor } from "./backend/program";
import { cohortCode, cohortName, useRecruitingCohort } from "./cohort";
import { PLAN_NOTICE } from "./introduction-plan";
import { kstDay } from "./dates";
import DirectIntroduction from "./DirectIntroduction";
import { CompareTable, HeroBackdrop, Journey, LetterMoment, SceneMoment, NumberBand, PathToContact, PaymentSteps, Standards, Underline, useInView } from "./HomeVisuals";
import { HeroLetters } from "./HeroLetters";
import { DAY_PARTS, STORIES, STORY_NOTE, dayPart } from "./home-story";

const interaction = "transition-colors duration-200 motion-reduce:transition-none";
const lift = "transition-transform duration-200 ease-out motion-reduce:transition-none";
const money = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
// 베타 운영(결제 없이): 요금·자주 묻는 질문·기수 안내를 베타 기준으로 보여 준다.
const BETA = LIVE && BEFORE_US.beta.active;

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
// target을 주면 정오 대신 그 마감(예: 응답 마감 11:00)까지 센다.
export function NoonClock({ tone = "light", target }: { tone?: "light" | "plain"; target?: { at: string; label: string; note: string } }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  const noon = untilNoon(now);
  const left = target ? Math.max(0, Math.floor((Date.parse(target.at) - now.getTime()) / 1000)) : noon.left;
  const atNoon = !target && noon.atNoon;
  const pad = (value: number) => String(value).padStart(2, "0");
  const text = `${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`;
  const filled = Math.max(0, Math.round((1 - left / 86400) * 1000) / 10);
  const label = target ? target.label : atNoon ? "지금, 정오예요" : "다음 정오까지";
  const light = tone === "light";
  const muted = light ? "text-white/95" : "text-muted-foreground";
  return (
    <div className="w-full max-w-[17rem]">
      <p className={`text-xs ${muted}`}>{label}</p>
      <p className="mt-1.5 text-[2.5rem] font-extralight leading-none tracking-[-0.02em] tabular-nums" role="timer" aria-label={`${label} ${text}`}>{text}</p>
      <div aria-hidden="true" className={`mt-4 h-px ${light ? "bg-white/25" : "bg-border"}`}><div className={`h-px ${light ? "bg-white" : "bg-primary"}`} style={{ width: `${filled}%` }} /></div>
      <p className={`mt-3 text-xs leading-5 ${muted}`}>{target ? target.note : "소개는 준비된 날, 정오 12시에 도착해요."}</p>
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

function withUnderlines(text: string, phrases: readonly string[]) {
  const hits = phrases.filter(phrase => text.includes(phrase));
  if (!hits.length) return text;
  const pattern = new RegExp(`(${hits.map(phrase => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
  return text.split(pattern).map((part, index) => hits.includes(part) ? <Underline key={index}>{part}</Underline> : part);
}

// 첫 화면 세 가지 표시와 마감 배지(2026-10-27). 서비스의 핵심을 한눈에, 지금 신청할 이유는 버튼 바로 위에.
const HERO_POINTS = ["운영진이 고른 한 사람", "정오 12시 도착", "만나기 전 3일 교류"];
function HeroPoints() {
  return <ul className="mt-6 flex flex-wrap gap-2" aria-label="플라비의 소개 방식">{HERO_POINTS.map(point => <li key={point} className="flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-white/25 backdrop-blur-sm"><Check size={12} aria-hidden="true" />{point}</li>)}</ul>;
}
function HeroDeadline() {
  const cohort = useRecruitingCohort();
  return <p className={`mt-7 inline-flex min-h-7 items-center gap-2 rounded-full bg-[#F8E5A6] px-3.5 py-1.5 text-xs font-semibold text-[#2B2540] shadow-[0_10px_24px_-14px_rgba(40,20,90,0.7)] transition-opacity duration-300 ${cohort ? "opacity-100" : "opacity-0"}`} aria-hidden={!cohort}><span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />{cohort ? <>{BETA ? "베타 무료" : `${cohortName(cohort.number)} 모집 중`} · 신청 마감 {kstDay(cohort.applicationDeadline).replace(" (", "(")}</> : "\u00a0"}</p>;
}

function Hero() {
  const part = DAY_PARTS[dayPart(useMinuteNow())];
  return (
    <section className="bleed relative isolate overflow-clip bg-primary text-primary-foreground" aria-labelledby="home-title">
      <HeroBackdrop />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ backgroundImage: part.tint }} />
      <div className="relative grid gap-12 pt-14 pb-28 sm:pt-20 sm:pb-32 lg:grid-cols-[7fr_5fr] lg:items-center lg:gap-10 lg:pt-20 lg:pb-32">
        <div className="relative z-10">
          <p className="-mt-3 mb-9 inline-flex items-center rounded-full bg-white/12 px-3 py-1 text-xs font-semibold tracking-[0.04em] text-white/90 ring-1 ring-white/20 sm:-mt-4 sm:mb-10">편지로 시작하는 1:1 소개팅</p>
          <p className="mb-6 flex items-center gap-2.5 text-base font-semibold text-[#F8E5A6] sm:text-lg"><span aria-hidden="true" className="size-1.5 rounded-full bg-[#F8E5A6]" />넘기는 소개팅에 지쳤다면.</p>
          <h1 id="home-title" className="text-[clamp(2.5rem,5vw,4.25rem)] font-semibold leading-[1.22] tracking-[-0.02em]">끌리는 사람을,<br />천천히 알아갑니다.</h1>
          <p className="mt-7 max-w-lg text-sm leading-[1.95] text-white/95 dark:text-white sm:text-[15px]">몇 명을 보여 줄지보다, 누구를 보여 줄지를 오래 고민해요.<br />서로 끌림이 확인될 때만 두 분을 이어 드려요.</p>
          <HeroPoints />
          <HeroDeadline />
          <div className="mt-4 flex flex-wrap gap-3">
            <Button asChild className={`h-12 rounded-full bg-white px-6 text-primary hover:bg-white/90 ${interaction}`}><Link to="/apply">소개 신청하기 <ArrowUpRight size={17} /></Link></Button>
            <Button asChild variant="outline" className={`h-12 rounded-full border-white/35 bg-transparent px-5 text-white hover:bg-white/10 hover:text-white dark:bg-transparent ${interaction}`}><Link to="/two-starts">어떻게 알아가나요? <ArrowRight size={15} /></Link></Button>
          </div>
          <p className="mt-12 text-sm text-white/95">{part.phrase}</p>
          <div className="mt-5"><NoonClock /></div>
          <p className="mt-5 text-[11px] text-white/95 dark:text-white">{LIVE ? "베타 운영 중 · 지금은 결제 없이 진행해요." : "데모 둘러보기 · 실제 신청이나 결제는 진행되지 않아요."}</p>
        </div>
        <div className="relative z-10 lg:flex lg:items-center lg:justify-end"><HeroLetters /></div>
      </div>
      <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full fill-background sm:h-24" viewBox="0 0 1200 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 68 C300 -20 700 122 1200 28 L1200 100 L0 100 Z" /></svg>
    </section>
  );
}

function Philosophy() {
  return (
    <section className="grid gap-8 py-20 sm:py-24 lg:grid-cols-[7fr_5fr] lg:gap-16" aria-labelledby="philosophy-title">
      <div><SectionLabel number="01" ko="관점">OUR POINT OF VIEW</SectionLabel><h2 id="philosophy-title" className="text-ink max-w-xl text-3xl font-semibold leading-[1.5] sm:text-[38px]">마음을 서두르지 않고,<br />취향을 타협하지 않도록.</h2></div>
      <div className="lg:pt-16"><p className="text-[15px] leading-[2] text-muted-foreground">내가 좋아하는 사람인지, 나와 잘 맞는 사람인지. 조건표 한 장으로는 알 수 없어요. 그래서 <Underline>함께 알아가는 시간 속에서 천천히 확인해요.</Underline> 억지로 호감을 만들거나, 다음 만남을 서두를 필요는 없어요.</p></div>
    </section>
  );
}

// 02 소개의 두 원: 화면에 들어오면 천천히 다가가 살짝 겹친다(겹친 곳은 보라·파랑이 섞인 한 가지 색).
// 겹친 부분은 파란 원 안에 보라 원과 같은 자리의 원(pair-lens)을 두고 잘라 그린다.
function PairOrbs() {
  const { ref, shown } = useInView<HTMLDivElement>(0.6);
  return (
    <div ref={ref} className={`pair-orbs ${shown ? "is-on" : ""} relative isolate flex items-center justify-center py-7`} aria-hidden="true">
      <span className="pair-orb pair-orb-a size-20 rounded-full bg-primary sm:size-24" />
      <span className="pair-orb pair-orb-b relative size-20 overflow-hidden rounded-full bg-accent sm:size-24"><span className="pair-lens" /></span>
    </div>
  );
}

function Introduction() {
  return (
    <section id="how-it-works" className="bleed relative isolate overflow-clip bg-mist py-20 sm:py-24" aria-labelledby="introduction-title">
      <div className="grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-16">
        <div className="relative flex min-h-72 flex-col justify-between overflow-hidden bg-[#F5F2FD] p-8 ring-1 ring-primary/[0.06] sm:min-h-80 sm:p-10 dark:bg-lilac">
          <span className="text-[11px] font-semibold tracking-[0.13em] text-muted-foreground">ONE PAIR, AT A TIME</span>
          <PairOrbs />
          <div className="flex items-baseline justify-between"><span className="text-sm font-semibold">한 사람을 향한 집중</span><span className="text-5xl font-light text-primary">02</span></div>
        </div>
        <div className="flex flex-col justify-center"><SectionLabel number="02" ko="소개">THE INTRODUCTION</SectionLabel><h2 id="introduction-title" className="text-ink text-3xl font-semibold leading-[1.5] sm:text-[34px]">많이 보여드리기보다,<br />한 사람을 신중하게.</h2><p className="mt-6 text-[15px] leading-[2] text-muted-foreground">사진 너머의 취향, 관계를 대하는 태도, 쉬는 날의 모습까지. 운영진이 두 사람의 이야기를 나란히 놓고 오래 들여다본 뒤에야 한 쌍을 제안해요.</p><div className="mt-7 flex items-start gap-3 border-t border-border pt-5"><Clock size={17} className="mt-1 shrink-0 text-accent" /><p className="text-sm leading-7">준비된 날, 정오 12시.<br /><span className="text-muted-foreground">두 사람에게 같은 순간에 도착해요.</span></p></div></div>
      </div>
      <NumberBand />
      <Journey />
      <CompareTable />
    </section>
  );
}

function FounderLetter() {
  return (
    <section className="grid gap-10 py-20 sm:py-24 lg:grid-cols-[5fr_7fr] lg:gap-16" aria-labelledby="letter-title">
      <div>
        <SectionLabel number="03" ko="운영진의 편지">A LETTER FROM US</SectionLabel>
        <h2 id="letter-title" className="text-ink text-3xl font-semibold leading-[1.5] sm:text-[34px]">왜 한 번에,<br />한 사람일까요?</h2>
      </div>
      <article className={`relative border border-border bg-card p-7 shadow-[0_1px_0_var(--border)] sm:p-10 hover:-translate-y-1 ${lift}`}>
        <div className="mb-7 flex gap-1.5" aria-hidden="true"><span className="size-2 rounded-full bg-primary" /><span className="size-2 rounded-full bg-accent" /></div>
        <div className="space-y-5 text-[15px] leading-[2]">
          <p>안녕하세요, 플라비를 만든 사람이에요.</p>
          <p>누군가를 진심으로 알아가 본 적이 언제였는지 생각해 봤어요.<br />많이 볼수록, 한 사람에게 마음을 쓰기는 오히려 어려워지니까요.</p>
          <p>그래서 플라비는 <Underline>한 번에 한 사람만</Underline> 소개해요. 신청서를 한 장씩 읽고, 두 분이 좋아하는 것과 중요하게 여기는 것을 나란히 놓고 오래 고민해요. ‘이 두 사람’이라고 정하는 건 처음부터 끝까지 <Underline>언제나 사람</Underline>이에요.</p>
          <p>빠르지는 않을 거예요. 대신 소개가 도착한 날에는, 그 한 사람에게 온전히 마음을 써 보셨으면 해요.</p>
        </div>
        <p className="mt-9 text-sm font-semibold text-primary">끌리는 사람을, 천천히 알아갑니다.</p>
        <p className="mt-2 text-sm text-muted-foreground">플라비 드림</p>
      </article>
      <div className="lg:col-span-2"><DirectIntroduction /></div>
    </section>
  );
}

// 기수 안내 띠(V6-cohort-01). 모인 인원은 보여 주지 않고, 첫 소개 날짜와 신청 마감만 알려 준다.
function InitialOperation({ detailsTo = "#faq-cohort" }: { detailsTo?: string }) {
  const cohort = useRecruitingCohort();
  if (!cohort) return null;
  return (
    <section className="bleed relative isolate overflow-clip bg-[#F8E5A6] py-16 text-[#2B2540] sm:py-20 dark:bg-[#3B3424] dark:text-white" aria-labelledby="initial-title">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-[0.08] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
      <div className="grid gap-8 lg:grid-cols-[7fr_5fr] lg:gap-16"><div><p className="mb-6 flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.15em] text-[#7A5A10] dark:text-[#F3D98A]"><span aria-hidden="true" className="flex gap-1"><span className="size-1.5 rounded-full bg-primary" /><span className="size-1.5 rounded-full bg-accent" /></span>{cohortCode(cohort.number)} · TOGETHER AT NOON</p><h2 id="initial-title" className="text-3xl font-semibold leading-[1.5] sm:text-[34px]">{cohortName(cohort.number)} 첫 소개는,<br /><span className="text-primary dark:text-[#B9ABF2]">{kstDay(cohort.startsOn).replace(/ \(.\)$/, "")}</span> 정오에.</h2><p className="mt-6 inline-flex items-center gap-2.5 rounded-full bg-white/70 py-2 pl-3 pr-4 text-xs shadow-[0_10px_24px_-16px_rgba(120,90,20,0.6)] ring-1 ring-[#2B2540]/5 dark:bg-white/10"><span aria-hidden="true" className="size-1.5 rounded-full bg-primary" /><span className="text-[#2B2540]/65 dark:text-white/70">신청 마감</span><span className="font-semibold text-primary dark:text-[#B9ABF2]">{kstDay(cohort.applicationDeadline)}</span></p></div><div className="space-y-4 text-sm leading-[1.95]">{cohort.number === 0 ? <><p>정식으로 열기 전에, 베타 테스터와 먼저 시작해요. 같은 날 신청을 마친 분들이 시작하는 날 정오에 함께 첫 소개를 받아요.</p><p className="opacity-95"><strong className="font-semibold">베타는 무료예요</strong> · 소개도, 서로 선택한 뒤의 3일 교류도 결제 없이 진행해요. 써 보신 의견으로 플라비를 다듬어 갈게요.</p></> : BETA ? <><p>한 달 단위 기수제로 시작해요. 같은 기수의 분들이 시작하는 날 정오에 함께 첫 소개를 받아요. 첫 소개 날짜를 미리 알려 드려서 오래 기다리지 않아요.</p><p className="opacity-95"><strong className="font-semibold">베타라서 {cohortName(cohort.number)}도 무료예요</strong> · 소개도, 서로 선택한 뒤의 3일 교류도 결제 없이 진행해요. 유료 운영은 사업자등록을 마친 뒤 시작하고, 시작하기 전에 사이트와 메일로 미리 알려 드려요.</p></> : <><p>처음에는 한 달 단위 기수제로 시작해요. 같은 기수의 분들이 모이면, 시작하는 날 정오에 함께 첫 소개를 받아요. 첫 소개 날짜를 미리 알려 드려서 오래 기다리지 않아요.</p><p className="opacity-95"><strong className="font-semibold">한 번 더, 5번</strong> · 2026년 12월 31일까지 소개비를 낸 분이 5번의 소개 동안 교류를 시작하지 못했다면, 한 번 더 5번을 추가 비용 없이 소개해 드려요. 계정마다 한 번이에요.</p></>}<p className="border-t border-current/20 pt-4 text-xs"><Link to={detailsTo} className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline">{cohort.number === 0 || BETA ? "베타 운영 자세히" : "기수제와 ‘한 번 더, 5번’ 자세히"} <ArrowRight size={13} /></Link></p></div></div>
    </section>
  );
}

// A 체험: 실제 교류의 질문 묶음 하나(질문은 교류마다 달라서 ‘다른 질문 보기’로 다른 묶음도 볼 수 있다). 예시는 읽기만 하는 참고(편지에 넣지 않는다). 쓴 글은 저장하지 않는다.
function LetterTrial() {
  const [day, setDay] = useState(0);
  const [set, setSet] = useState(0);
  const days = LETTER_SETS[set].days;
  const prompt = days[day];
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [examples, setExamples] = useState(false);
  return (
    <div className="mt-8 border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs font-medium text-accent"><span>실제 교류의 질문 · {prompt.title}</span><span className="flex gap-1">{days.map((item, index) => <button key={index} type="button" aria-pressed={day === index} onClick={() => { setDay(index); setSent(false); setText(""); setExamples(false); }} className={`rounded-full border px-2.5 py-1 text-[11px] ${interaction} ${day === index ? "border-accent bg-accent text-white" : "border-border text-muted-foreground hover:border-accent/50"}`}>DAY 0{index + 1}</button>)}</span></div>
      <p className="mt-4 text-[15px] font-semibold leading-7" aria-live="polite">{prompt.question}</p>
      <p className="mt-1.5 text-[11px] text-muted-foreground">질문은 교류마다 달라져요. 지난 교류에서 받은 질문은 되도록 다시 나오지 않아요. <button type="button" onClick={() => { setSet(value => (value + 1) % LETTER_SETS.length); setSent(false); setText(""); setExamples(false); }} className={`rounded-full font-medium text-accent underline-offset-4 hover:underline ${interaction}`}>다른 질문 보기</button></p>
      {sent ? (
        <div className="mt-4 space-y-3" aria-live="polite">
          <div className="flex items-center gap-3 rounded-xl bg-accent/5 p-4 text-sm"><Lock size={16} className="shrink-0 text-accent" />한 통을 봉투에 넣었어요.</div>
          <p className="text-xs leading-6 text-muted-foreground">실제 교류에서는 두 분 모두 보낸 뒤 함께 열리고, 열린 편지에는 다음 날 09:00까지 답장을 한 번 보낼 수 있어요. 편지에는 사진 한 장을 함께 넣을 수도 있어요(함께 열린 뒤에만 보여요). 방금 쓴 글은 어디에도 저장되지 않았어요.</p>
          <Button variant="ghost" size="sm" onClick={() => { setSent(false); setText(""); }}><RotateCcw size={14} />다시 써 보기</Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div>
            <button type="button" aria-expanded={examples} onClick={() => setExamples(value => !value)} className={`inline-flex items-center gap-1 rounded-full text-xs text-muted-foreground hover:text-foreground ${interaction}`}>{examples ? "예시 닫기" : "예시 보기"}<ChevronDown size={13} className={`transition-transform duration-200 motion-reduce:transition-none ${examples ? "rotate-180" : ""}`} /></button>
            {examples && <ul aria-label="이 질문의 예시 답" className="mt-2 space-y-1.5 rounded-xl bg-accent/5 px-4 py-3 text-xs leading-6 text-foreground/75">{prompt.examples.map(example => <li key={example}>“{example}”</li>)}</ul>}
          </div>
          <Textarea aria-label="편지 쓰기 체험 · 저장되지 않음" maxLength={200} value={text} onChange={event => setText(event.target.value)} placeholder="질문에 답하듯 편하게 써 보세요." className="min-h-24 bg-background leading-7" />
          <div className="flex items-center justify-between gap-3"><span className="text-[11px] text-muted-foreground">{text.length}/200 · 실제 편지는 300~600자를 권해요 · 사진 한 장도 넣을 수 있어요(선택)</span><Button size="sm" disabled={!text.trim()} onClick={() => setSent(true)}>한 통 보내 보기</Button></div>
        </div>
      )}
    </div>
  );
}
// B 체험: 실제 교류와 같은 고를 거리·순서(장소 → 그곳에 맞는 머무는 방식·쉬어 갈 곳 → 나눌 이야기). 목록에 없으면 ‘직접 작성’으로 짧게 써도 된다. 고른 것은 저장하지 않는다.
function SceneTrial() {
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState<{ key: string; text: string } | null>(null);
  const stay = stayFor(picks.activity);
  const place = sceneLabel(picks.activity);
  const pairs = (items: readonly string[] = []) => items.map(item => [item, item] as const);
  const shown = (key: string) => key === "topic" ? `“${picks[key]}”` : sceneLabel(picks[key]);
  const steps = [
    { day: "DAY 01", title: PLAN_COPY.B.days[0], groups: [{ key: "activity", label: "", options: Object.entries(SCENE_ACTIVITY_LABEL) as (readonly [string, string])[], hint: "예: 보드게임 카페" }] },
    { day: "DAY 02", title: PLAN_COPY.B.days[1], groups: [{ key: "flow", label: `머무는 방식 · ${place}`, options: pairs(stay?.flows), hint: "예: 보드게임 하나 같이 하기" }, { key: "rest", label: "쉬어 갈 곳", options: pairs(stay?.rests), hint: "예: 창가 자리" }] },
    { day: "DAY 03", title: PLAN_COPY.B.days[2], groups: [{ key: "topic", label: "예시에서 고르거나 직접 적어요", options: pairs(SCENE_TOPIC_EXAMPLES), hint: "예: 요즘 가장 오래 머문 장소 이야기" }] },
  ];
  const step = steps.findIndex(item => item.groups.some(group => !picks[group.key]));
  const current = steps[step];
  const choose = (key: string, value: string) => { setWriting(null); setPicks(prev => ({ ...prev, [key]: value })); };
  const chip = (key: string, [value, text]: readonly [string, string]) => (
    <button key={value} type="button" aria-pressed={picks[key] === value} onClick={() => choose(key, value)} className={`rounded-full border px-3.5 py-2 text-sm ${interaction} ${picks[key] === value ? "border-accent bg-accent/5 text-accent" : "border-border bg-card hover:border-accent/60"}`}>{text}</button>
  );
  // 직접 작성: 칩을 누르면 짧은 칸이 열리고, ‘고르기’를 눌러야 다음으로 넘어간다(장소·머무는 방식·쉬어 갈 곳은 20자, 이야기는 40자 안).
  const own = (key: string) => <button key={`${key}-own`} type="button" aria-pressed={writing?.key === key} onClick={() => setWriting(value => value?.key === key ? value : { key, text: "" })} className={`inline-flex items-center gap-1.5 rounded-full border border-dashed px-3.5 py-2 text-sm ${interaction} ${writing?.key === key ? "border-accent bg-accent/5 text-accent" : "border-accent/40 bg-card text-foreground/80 hover:border-accent/60"}`}><PenLine size={13} aria-hidden="true" />직접 작성</button>;
  const ownField = (key: string, hint: string) => {
    if (writing?.key !== key) return null;
    const max = key === "topic" ? SCENE_TOPIC_MAX : SCENE_CUSTOM_MAX;
    const text = writing.text.trim();
    return <div className="flex flex-wrap items-center gap-2"><input autoFocus value={writing.text} maxLength={max} onChange={event => setWriting({ key, text: event.target.value })} onKeyDown={event => { if (event.key === "Enter" && text) choose(key, key === "topic" ? text : CUSTOM + text); }} placeholder={hint} aria-label="직접 작성 · 저장되지 않음" className="h-10 min-w-0 flex-1 rounded-full border border-accent/40 bg-background px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:max-w-xs md:text-sm" /><Button size="sm" variant="outline" disabled={!text} onClick={() => choose(key, key === "topic" ? text : CUSTOM + text)} className="h-10 rounded-full border-accent/40 px-4 text-xs">고르기</Button></div>;
  };
  return (
    <div className="mt-8 space-y-3">
      {current ? <>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs font-medium text-accent"><span>{current.day} · {current.title}</span><span className="text-muted-foreground">{step + 1} / 3</span></div>
        {current.groups.map(group => <div key={group.key} className="space-y-2">{group.label && <p className="text-[11px] text-muted-foreground">{group.label}</p>}
          {group.key === "activity"
            // 장소 일곱 곳은 늘 두 줄로: 전시 산책 서점 카페 / 공원·피크닉 시장 골목 작은 공연 · 직접 작성
            ? <div className="space-y-2">{SCENE_ACTIVITY_ROWS.map((row, index) => <div key={row[0]} className="flex flex-wrap gap-2">{row.map(key => chip("activity", [key, SCENE_ACTIVITY_LABEL[key]]))}{index === SCENE_ACTIVITY_ROWS.length - 1 && own("activity")}</div>)}</div>
            : <div className="flex flex-wrap gap-2">{group.options.map(option => chip(group.key, option))}{picks[group.key] && isCustom(picks[group.key]) && chip(group.key, [picks[group.key], sceneLabel(picks[group.key])])}{own(group.key)}</div>}
          {ownField(group.key, group.hint)}
        </div>)}
        {step > 0 && <div className="grid grid-cols-2 gap-3 pt-1" aria-live="polite">
          <div className="rounded-xl border border-accent bg-accent/5 p-3 text-xs leading-5"><span className="block text-xs text-accent">어제 나의 선택</span>{steps[step - 1].groups.map(group => shown(group.key)).join(" · ")}</div>
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-3 text-xs leading-5 text-muted-foreground"><Lock size={14} className="shrink-0" />상대도 고르면 함께 열려요</div>
        </div>}
        <p className="text-[11px] leading-5 text-muted-foreground">목록에 없으면 ‘직접 작성’으로 짧게 써도 돼요. 실제로는 둘째 날, 두 분이 첫날 고른 곳에 맞는 것 중에서 골라요. 날마다 나를 소개하는 짧은 질문에도 답하고, 함께 열린 상대의 선택에는 한마디를 남길 수 있어요.</p>
      </> : (
        <div className="space-y-3" aria-live="polite">
          <div className="rounded-xl border border-accent bg-accent/5 p-4 text-sm leading-6"><span className="block text-xs text-accent">내가 고른 첫 장면</span>{place} · {sceneLabel(picks.flow)} · {sceneLabel(picks.rest)}<span className="mt-1 block">“{picks.topic}”</span></div>
          <p className="text-xs leading-6 text-muted-foreground">실제 교류에서는 셋째 날 두 분의 답이 함께 열리면, 두 분이 고른 것 중에서 하나씩 골라 첫 장면을 맞추고, 그 장면에 대해 짧게 써서 함께 열어 봐요. 고른 것은 어디에도 저장되지 않았어요.</p>
          <Button variant="ghost" size="sm" onClick={() => { setPicks({}); setWriting(null); }}><RotateCcw size={14} />다시 골라 보기</Button>
        </div>
      )}
    </div>
  );
}

// 04 이야기: 세로로 이어지는 두 사람의 사흘(처음 배치 그대로). 강조는 담백하게 — 이야기 속 ‘…’ 구절은 보라색 글자로만, 그날의 질문은 조금 크게, 따옴표만 보라색으로.
// 두 사람의 글은 첫 화면 편지처럼 가운데 선 쪽 모서리만 덜 둥근 옅은 카드(다은은 보라, 준호는 파랑 기운), 편지가 오간 DAY 01~03에는 ‘함께 열림’ 자물쇠, 끝에서 두 원이 천천히 만난다.
function Quoted({ text }: { text: string }) {
  const parts = text.split(/(‘[^’]+’)/);
  return <>{parts.map((part, index) => part.startsWith("‘") ? <span key={index} className="font-medium text-primary">{part}</span> : part)}</>;
}
const STORY_EASE = "transition-[opacity,transform] duration-[600ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none";
// 편지 카드 색: 1번은 옅은 보라·파랑 기운, 2번(서정적인 이야기)은 그보다 더 옅게
const LETTER_TONE = {
  plain: { left: "bg-[color-mix(in_oklch,var(--primary)_4%,var(--card))]", right: "bg-[color-mix(in_oklch,var(--accent)_4%,var(--card))]", shadow: "shadow-[0_22px_44px_-34px_color-mix(in_oklch,var(--primary)_55%,transparent)]" },
  lyrical: { left: "bg-[color-mix(in_oklch,var(--primary)_1.5%,var(--card))]", right: "bg-[color-mix(in_oklch,var(--accent)_1.5%,var(--card))]", shadow: "shadow-[0_22px_44px_-36px_color-mix(in_oklch,var(--primary)_36%,transparent)]" },
} as const;
function StoryChapter({ label, prompt, left, right, leftClass, rightClass, nameLeft, nameRight, tone }: { label: string; prompt: string | null; left: string; right: string; leftClass: string; rightClass: string; nameLeft: ReactNode; nameRight: ReactNode; tone: keyof typeof LETTER_TONE }) {
  const question = prompt?.endsWith("?");
  const { ref, shown } = useInView<HTMLLIElement>(0.2);
  const step = (delay: number) => ({ className: `${STORY_EASE} ${shown ? "translate-y-0 opacity-100" : "translate-y-3.5 opacity-0"}`, style: { transitionDelay: `${delay}ms` } });
  const head = step(0), one = step(160), two = step(340);
  const opened = /^DAY 0[1-3]$/.test(label);
  const color = LETTER_TONE[tone];
  const letter = `rounded-[22px] border border-primary/[0.06] px-5 py-4 text-[15px] leading-[1.95] text-foreground/85 sm:px-6 sm:py-5 ${color.shadow}`;
  return (
    <li ref={ref} className="relative pb-14 last:pb-4 sm:pb-16">
      <div className={`relative z-10 mx-auto mb-8 max-w-md bg-mist px-4 text-center ${head.className}`} style={head.style}>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-card px-3 py-1 text-[10px] font-semibold tracking-[0.14em] text-accent">{opened && <LockOpen size={11} strokeWidth={2.2} className="text-primary" aria-label="두 편지가 함께 열린 날" />}{label}</span>
        {prompt && <p className="text-ink mt-3.5 text-[17px] font-medium leading-8">{question ? <><span aria-hidden="true" className="text-primary">“</span>{prompt}<span aria-hidden="true" className="text-primary">”</span></> : prompt}</p>}
      </div>
      <div className="grid gap-5 md:grid-cols-2 md:gap-16">
        <div className={`mr-6 md:mr-0 ${leftClass}`}><div className={`flex flex-1 flex-col ${one.className}`} style={one.style}>{nameLeft}<div className="flex flex-1 items-center"><p className={`w-full ${letter} ${color.left} rounded-tl-md md:rounded-tl-[22px] md:rounded-tr-md`}><Quoted text={left} /></p></div></div></div>
        <div className={`ml-6 md:ml-0 ${rightClass}`}><div className={`flex flex-1 flex-col ${two.className}`} style={two.style}>{nameRight}<div className="flex flex-1 items-center"><p className={`w-full ${letter} ${color.right} rounded-tr-md md:rounded-tr-[22px] md:rounded-tl-md`}><Quoted text={right} /></p></div></div></div>
      </div>
    </li>
  );
}

// 이야기 끝: 02 소개의 두 원을 작게 — 화면에 들어오면 천천히 다가가 살짝 겹친다(두 사람이 만난다).
function StoryOrbs() {
  const { ref, shown } = useInView<HTMLDivElement>(0.9);
  return (
    <div ref={ref} className={`pair-orbs pair-mini ${shown ? "is-on" : ""} mb-8 flex items-center justify-center`} aria-hidden="true">
      <span className="pair-orb pair-orb-a size-6 rounded-full bg-primary" />
      <span className="pair-orb pair-orb-b relative size-6 overflow-hidden rounded-full bg-accent"><span className="pair-lens" /></span>
    </div>
  );
}

function TwoVoices() {
  const [voice, setVoice] = useState<"both" | "left" | "right">("both");
  const [storyId, setStoryId] = useState<(typeof STORIES)[number]["id"]>("plain");
  const story = STORIES.find(item => item.id === storyId)!;
  const { chapters, ending, people } = story;
  const show = (side: "left" | "right") => voice === "both" || voice === side;
  const Name = ({ side }: { side: "left" | "right" }) => (
    <p className={`mb-2.5 flex items-center gap-2 px-1 text-xs font-semibold ${side === "left" ? "md:justify-end" : "justify-end md:justify-start"}`}>
      {side === "right" && <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />}
      {people[side]}
      {side === "left" && <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />}
    </p>
  );
  const voiceClass = (side: "left" | "right") => `${show(side) ? "flex flex-col" : "hidden md:flex md:flex-col md:opacity-25"} transition-opacity duration-200 motion-reduce:transition-none`;
  return (
    <section className="bleed bg-mist py-20 sm:py-24" aria-labelledby="story-title">
      <div className="mx-auto max-w-2xl text-center">
        <div className="flex justify-center"><SectionLabel number="04" ko="이야기">A STORY IN TWO VOICES</SectionLabel></div>
        <h2 id="story-title" className="text-ink text-[26px] font-semibold leading-[1.5] sm:text-[32px]">한 사람을 알아가는 데 필요한,<br />사흘이라는 시간.</h2>
        <p className="mx-auto mt-5 max-w-md text-sm leading-7 text-muted-foreground">정오에 도착한 한 사람과의 3일을, 두 사람의 시점으로 나란히 적었어요.</p>
        <div role="group" aria-label="이야기 고르기" className="mx-auto mt-8 flex w-fit items-end gap-3">
          {STORIES.map(item => {
            const active = storyId === item.id;
            return (
              <button key={item.id} type="button" aria-pressed={active} aria-label={`이야기 ${item.number} · ${item.people.left}과 ${item.people.right}`} title={`${item.people.left}과 ${item.people.right}`} onClick={() => { setStoryId(item.id); setVoice("both"); }} className="group flex min-h-9 min-w-9 flex-col items-center justify-end rounded-sm px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className={`text-base font-[500] leading-none tabular-nums transition-colors duration-300 motion-reduce:transition-none ${active ? "bg-gradient-to-br from-primary to-accent bg-clip-text text-transparent" : "text-muted-foreground group-hover:text-foreground"}`}>{item.number}</span>
                <span aria-hidden="true" className={`mt-2 h-px transition-all duration-300 motion-reduce:transition-none ${active ? "w-3.5 bg-gradient-to-r from-primary to-accent" : "w-0 bg-transparent"}`} />
              </button>
            );
          })}
        </div>
        <div role="group" aria-label="이야기 시점" className="mx-auto mt-4 flex w-fit rounded-full bg-lilac p-1 text-xs">
          {([["both", "함께 읽기"], ["left", `${people.left}의 시점`], ["right", `${people.right}의 시점`]] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={voice === id} onClick={() => setVoice(id)} className={`rounded-full px-4 py-2 ${interaction} ${voice === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">약 3분</p>
      </div>
      <ol key={storyId} className="relative mx-auto mt-16 max-w-4xl">
        <span aria-hidden="true" className="absolute top-2 bottom-2 left-1/2 hidden w-px -translate-x-1/2 bg-gradient-to-b from-primary/5 via-primary/40 to-primary/5 md:block" />
        {chapters.map(chapter => (
          <StoryChapter key={chapter.id} label={chapter.label} prompt={chapter.prompt} left={chapter.left} right={chapter.right} leftClass={voiceClass("left")} rightClass={voiceClass("right")} nameLeft={<Name side="left" />} nameRight={<Name side="right" />} tone={storyId} />
        ))}
      </ol>
      <div className="mx-auto mt-10 max-w-2xl text-center">
        <StoryOrbs />
        <p className="text-lg leading-[1.9]">{withUnderlines(ending, ["약속은 일요일 오전 열한 시", "두 사람은 다음 주 토요일 오후", "이야기는 여기까지예요."])}</p>
        <p className="mx-auto mt-6 max-w-md text-xs leading-6 text-muted-foreground">{STORY_NOTE}</p>
      </div>
    </section>
  );
}

// 두 가지 시작의 A·B 예시: 홈 05와 /two-starts에 같이 쓴다
function ExchangeExamples() {
  return (
    <>
        <div className="mt-20 grid items-center gap-14 border-t border-border pt-16 lg:grid-cols-[6fr_5fr] lg:gap-16"><div><p className="text-[11px] font-semibold tracking-[0.24em] text-accent">OPENED TOGETHER</p><h3 className="text-ink mt-4 text-[26px] font-semibold leading-[1.45] sm:text-[32px]">두 분 모두 보내야,<br /><span className="text-primary">같은 순간에 열려요.</span></h3><p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">먼저 쓴 사람도, 늦게 쓴 사람도 서두를 필요 없어요. 그날 23:59까지 두 분이 모두 보내면, 편지는 같은 순간에 함께 열려요.</p><ul className="mt-6 space-y-2.5 text-sm">{["하루 한 통 · 09:00~23:59", "열린 편지에는 답장 한 번", "연락처·링크는 자동으로 막혀요"].map(item => <li key={item} className="flex items-center gap-2.5"><span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check size={11} strokeWidth={3} /></span>{item}</li>)}</ul></div><LetterMoment /></div>
      <div className="mt-20 grid items-center gap-14 border-t border-border pt-16 lg:grid-cols-[5fr_6fr] lg:gap-16"><SceneMoment className="order-2 lg:order-1" /><div className="order-1 lg:order-2"><p className="text-[11px] font-semibold tracking-[0.24em] text-accent">CHOSEN TOGETHER</p><h3 className="text-ink mt-4 text-[26px] font-semibold leading-[1.45] sm:text-[32px]">하루에 하나씩 고르면,<br /><span className="text-accent">첫 만남이 그려져요.</span></h3><p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">어디서 만날지, 얼마나 머물지, 무슨 이야기를 나눌지. 사흘 동안 하루에 하나씩 함께 골라요. 두 분이 모두 고르면 함께 열리고, 셋째 날에는 고른 것들이 ‘두 사람의 첫 장면’으로 정리돼요.</p><ul className="mt-6 space-y-2.5 text-sm">{["DAY 01 · 만나고 싶은 곳과 그 이유", "DAY 02 · 그곳에서 머무는 방식과 쉬어 갈 곳", "DAY 03 · 나누고 싶은 이야기 하나"].map(item => <li key={item} className="flex items-center gap-2.5"><span className="flex size-5 items-center justify-center rounded-full bg-accent text-white"><Check size={11} strokeWidth={3} /></span>{item}</li>)}</ul></div></div>
    </>
  );
}

function Exchange({ compact = false }: { compact?: boolean }) {
  return (
    <section id="two-starts" className="py-20 sm:py-24" aria-labelledby="exchange-title">
      <SectionLabel number="05" ko="두 가지 시작">TWO WAYS TO BEGIN</SectionLabel>
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><h2 id="exchange-title" className="text-ink text-3xl font-semibold leading-[1.5] sm:text-[38px]">마주하기 전,<br />우리만의 3일.</h2><p className="max-w-sm text-sm leading-7 text-muted-foreground">얼굴을 마주하기 전에, 서로의 생각과 취향을 먼저 만나요. 두 사람이 함께 고른 방식으로.</p></div>
      <div className="mt-10 grid border border-border md:grid-cols-2">
        <article className="flex flex-col border-b border-border bg-mist p-7 sm:p-10 md:border-r md:border-b-0"><div className="mb-8 flex items-start justify-between"><span className="text-6xl font-light leading-none text-primary">A</span><span className="pt-2 text-[10px] tracking-[0.12em] text-muted-foreground">ONE LETTER A DAY</span></div><h3 className="text-2xl font-semibold">편지 나누기</h3><p className="mt-4 min-h-14 text-sm leading-7 text-muted-foreground">각자 하루 한 통의 편지.<br />서로의 생각과 일상을 천천히 나눠요.</p>{!compact && <LetterTrial />}</article>
        <article className="flex flex-col bg-background p-7 sm:p-10"><div className="mb-8 flex items-start justify-between"><span className="text-6xl font-light leading-none text-accent">B</span><span className="pt-2 text-[10px] tracking-[0.12em] text-muted-foreground">CHOOSE A SCENE TOGETHER</span></div><h3 className="text-2xl font-semibold">첫 장면 만들기</h3><p className="mt-4 min-h-14 text-sm leading-7 text-muted-foreground">하루에 하나씩 고르며 서로를 알아가요.<br />셋째 날, 둘이 고른 것으로 첫 장면을 맞춰요.</p>{!compact && <SceneTrial />}</article>
      </div>
      {compact ? (
        <>
        <ExchangeExamples />
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm"><Link to="/two-starts" className={`inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline ${interaction}`}>편지·장면 미리 해 보고, 자세히 알아보기 <ArrowRight size={14} /></Link></div>
        </>
      ) : (
        <>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-4 border-t border-border pt-6 text-center text-xs"><span className="font-semibold text-accent">DAY 01—03 <span className="ml-2 font-normal text-foreground">교류</span></span><ArrowRight size={14} className="text-muted-foreground" /><span className="font-semibold text-accent">DAY 04 <span className="ml-2 font-normal text-foreground">각자 만남 의사 확인</span></span><span className="text-muted-foreground">양쪽이 희망하면 시간·장소 조율</span></div>
        <ExchangeExamples />
        </>
      )}
      <Standards />
    </section>
  );
}

// 첫 화면과 각 섹션에서 옮겨 온 운영 규칙. 자세한 기준은 FAQ에 두고 여기선 핵심만.
const PROMISES = [
  "소개는 준비된 날 정오 12시에, 하루 최대 한 명이에요. 매일 새 소개를 보장하지는 않아요.",
  "상대가 기한 안에 답하지 않았거나 운영 사정·상대 사정으로 끝난 소개는 5번에 넣지 않아요.",
  "3일 교류는 서로 선택, 양쪽 결제, 같은 방식과 시작일 합의 뒤에 시작돼요. 만남을 강요하지 않아요.",
  "평생 무제한 소개나 연애 성공을 약속하지는 않아요. 대신 한 분 한 분을 오래 고민해서 소개해요.",
]
const BETA_PROMISES = [
  "소개는 준비된 날 정오 12시에, 하루 최대 한 명이에요. 매일 새 소개를 보장하지는 않아요.",
  "상대가 기한 안에 답하지 않아 끝나면, 거절이 아니라 답이 오지 않았다고 알려 드려요.",
  "3일 교류는 서로 선택하고 같은 방식·시작일을 함께 정한 뒤에 시작돼요. 만남을 강요하지 않아요.",
  "베타는 운영 사정에 따라 끝날 수 있어요. 정식 운영 전에는 사이트와 메일로 미리 알려 드려요.",
]
const BETA_FAQ = { id: "beta", title: "베타 기간에는 무엇이 다른가요?", text: `지금은 정식으로 열기 전 베타 기간이라 결제가 없어요. 소개도, 서로 선택한 뒤의 3일 교류도 무료로 진행하고, 교류는 두 분이 같은 방식과 시작일을 정하면 바로 시작해요. 아래의 요금·환불 안내는 정식 운영 기준이에요. 베타는 운영 사정에 따라 언제든 끝날 수 있고, 끝나거나 정식 운영으로 바뀌기 7일 전에 사이트와 메일로 알려 드려요. 그때 이어서 쓸지 직접 고를 수 있고, 자동으로 결제되는 일은 없어요. 써 보시며 불편한 점은 ‘문의하기 → 베타 의견’으로 남겨 주세요.` };
const BETA_COHORT_FAQ = { id: "cohort", title: "기수제는 어떻게 운영되나요?", text: "기수마다 신청을 받아, 시작하는 날 정오에 함께 첫 소개를 받아요. 신청 마감과 첫 소개 날짜는 첫 화면의 기수 안내에 있어요. 마감 뒤에 신청하면 다음 기수로 이어지고, 내 기수와 첫 소개 날짜는 오늘 화면에서 볼 수 있어요. 베타 기간에는 어느 기수에 배정되든 무료예요. 11월 12일 뒤에 신청해 1기(12월 31일 시작)로 이어진 분도 베타가 끝날 때까지 결제하지 않아요. 정식 운영 일정은 정해지면 미리 알려 드릴게요." };
const FAQ_BASE = [
  { id: "cohort", title: "기수제는 어떻게 운영되나요?", text: "처음에는 한 달 단위 기수제로 운영해요. 기수마다 신청을 받아, 시작하는 날 정오에 함께 첫 소개를 받아요. 1기는 2026년 12월 31일 정오에 시작하고 신청은 12월 27일까지 받아요. 이후 기수는 매달 마지막 날 시작하고, 신청은 시작 4일 전까지예요. 마감 뒤에 신청하면 다음 기수로 이어지고, 내 기수와 첫 소개 날짜는 오늘 화면에서 볼 수 있어요. 기수가 끝나도 남은 소개는 다음 기수 기간에 이어서 받아요. 회원이 많이 모이면 상시 운영으로 바꿀 수 있어요." },
  { id: "bonus", title: "‘한 번 더, 5번’은 무엇인가요?", text: `${PLAN_NOTICE.bonus} 기본 5번 동안 서로 선택이 없었거나, 서로 선택했지만 교류가 시작되지 않은 경우가 해당돼요. 한 번이라도 교류를 시작했다면 해당하지 않아요. 하루 최대 한 명이며, 매일 소개를 보장하지는 않아요.` },
  { id: "waiting", title: "후보를 기다리는 동안은 어떻게 되나요?", text: `신청·검토와 기수 시작 전 대기는 무료예요. 정식 운영에서는 신청이 승인된 뒤 소개비를 내요. 내 기수 첫날부터 소개받으려면 기수 시작 전날 18:00까지 내 주세요. 첫 상대 프로필을 열기 전에는 언제든 전액 환불해요. 준비된 날 정오에 하루 최대 한 명을 소개하며, 매일 새 소개를 보장하지 않아요. 활성 소개는 회원당 한 건이고, 서로 선택한 뒤에는 새 소개를 멈춰요.${BETA ? " 지금은 베타라 결제가 없어요." : ""}` },
  { id: "three-days", title: "3일 동안 꼭 무언가를 해야 하나요?", text: `3일은 서로 선택${BETA ? "" : "·양쪽 결제"}·같은 방식과 시작일 합의 뒤 교류를 시작한 기간이며, 소개 대기 기간은 별도예요. 그 안에 친밀함·연애를 완성하거나 만남을 강제하지 않아요. 4일째에 두 분이 각자 만남 의사를 선택하고, 양쪽 모두 희망할 때만 시간과 장소를 조율해요.` },
  { id: "not-started", title: "상호 선택 후 교류가 시작되지 못하면요?", text: BETA ? "서로 선택한 뒤 48시간 안에 두 분이 같은 방식(A·B)과 시작일을 정해야 교류가 열려요. 방식이 엇갈리면 화면의 ‘상대 방식으로 맞추기’로 바로 맞출 수 있고, 하루가 지나도 엇갈려 있으면 한 번 더 알려 드려요. 끝내 정하지 못하면 교류는 열리지 않고 이번 소개는 조용히 마무리돼요." : "상호 선택 후 기본 결제 기한은 24시간이에요. 한쪽만 결제하고 상대가 결제하지 않으면, 낸 사람의 교류비는 전액 환불되고 소개 권리도 돌아와요. 양쪽 결제 뒤 A/B·시작일 합의는 48시간이에요. 끝내 교류가 시작되지 않으면 교류비는 전액 환불되고 소개 권리는 그대로 남아요." },
  { id: "cancellation", title: "신청이나 교류를 취소할 수 있나요?", text: `정식 운영 기준으로, 첫 상대 프로필을 열기 전에는 소개비 전액을 돌려드려요. 프로필을 연 뒤에는 아직 받지 않은 소개 횟수만큼(1번에 2,000원) 돌려드려요. 교류비는 두 분이 모두 ‘알아가고 싶어요’를 고른 뒤 24시간 안에 각자 내고, 한 분만 내면 낸 교류비는 전액 돌려드리며 이 소개는 횟수에서 빼요. 교류가 시작된 뒤에는 아직 열리지 않은 날만큼 돌려드려요. 환불은 요청을 확인한 뒤 3영업일 안에 해요.${BETA ? " 지금은 베타라 결제가 없어요." : ""}` },
  { id: "no-answer", title: "상대가 답하지 않으면 어떻게 되나요?", text: `상대는 다음 날 오전 11시까지 답할 수 있어요. 그때까지 답이 없으면 소개는 자동으로 마무리되고, 먼저 답한 분에게는 ‘상대가 기한 안에 답하지 않았어요’라고 알림과 메일로 알려 드려요. 거절과 무응답을 구분해서 알려 드려요.${BETA ? "" : " 상대가 답하지 않은 소개는 5번에 넣지 않아요."} 두 번 이어서 답하지 않은 분은 새 소개를 잠시 쉬게 되고, 내 정보에서 다시 받을 수 있어요.` },
  { id: "refund", title: "환불과 보유기간, 재이용 기준은 무엇인가요?", text: `소개비는 첫 상대 프로필을 열기 전에 취소하면 10,000원 전액, 연 뒤에는 남은 소개 1번에 2,000원씩 돌려드려요. 교류비는 아직 열리지 않은 날만큼 환불하고, 날짜별 금액은 결제 전에 안내해요. 법정 청약철회 권리와 약관에 따른 더 유리한 권리를 제한하지 않아요. 정상 교류를 마친 뒤 새 소개를 원하면 새 회차 소개비 10,000원부터 다시 시작해요. 교류 중단·약속 취소·노쇼 기준은 이용약관에서, 자료 보유·삭제 기간은 개인정보처리방침에서 확인할 수 있어요.` },
  { id: "visibility", title: "어떤 정보가 상대에게 공개되나요?", text: "신청서 마지막 단계에서 상대에게 보일 항목을 직접 고르고, 고른 항목만 소개된 상대에게 보여요. 소개할 때마다 다시 묻지는 않으니, 보일 항목은 내 정보의 ‘보일 항목 고치기’에서 언제든 바꿔 주세요. 상대 프로필은 소개된 날 정오부터 다음 날 11:00 응답 마감까지 볼 수 있고, 서로 알아가기로 하면 교류와 약속이 끝날 때까지 이어져요. 끝난 소개의 프로필을 다시 보는 보관함은 없어요. 넷째 날 두 분 모두 만나고 싶다고 한 교류만, 마무리 뒤 30일 동안 주고받은 글을 다시 읽을 수 있어요." },
  { id: "name", title: "‘플라비’는 무슨 뜻인가요?", text: "플라비(Flavie)는 ‘금빛’을 뜻하는 라틴어 flavus에서 온 이름이에요. 소개가 도착하는 정오의 햇살처럼, 한 사람을 밝은 빛 아래에서 천천히 알아가자는 마음을 담았어요. 2026년 10월 30일에 ‘비포어스’에서 지금 이름으로 바꿨고, 서비스와 회원 정보는 그대로예요." },
  { id: "contact", title: "문의는 어디에서 할 수 있나요?", text: "페이지 맨 아래의 ‘문의하기’에서 남길 수 있어요. 회원이라면 회원 화면 맨 아래의 ‘문의·요청’에서 정정·삭제 같은 요청을, 상대와 관련된 일은 두 사람 화면의 ‘신고’로 남기면 더 빨리 확인할 수 있어요." },
];

// 처음 보는 분들이 가장 많이 헷갈린 것(베타 피드백): 사진은 언제 · 동시에 여러 명? · 비용 · 다른 서비스와의 차이
const FIRST_FAQ = [
  { id: "photos", title: "사진은 언제 보나요?", text: "정오에 소개가 도착하면 상대의 사진과, 상대가 공개하기로 고른 프로필을 함께 봐요. 그걸 보고 다음 날 오전 11시까지 ‘알아가고 싶어요’ 또는 ‘이번에는 넘길게요’를 골라요. 두 분 모두 알아가고 싶다고 하면 그때 3일 교류가 시작돼요." },
  { id: "one-at-a-time", title: "여러 명과 동시에 연락하나요?", text: "아니요. 한 번에 한 분만 소개해요. 소개에 답하는 동안에는 다음 소개가 오지 않고, 서로 선택해 3일 교류를 하는 동안에도 새 소개를 멈춰요. 이번 소개가 마무리되면 잘 맞는 분이 준비된 날 정오에 다음 분을 소개해요." },
  { id: "cost", title: "비용은 언제, 얼마인가요?", text: `${BETA ? "지금은 베타 기간이라 모두 무료예요. 정식 운영 기준으로는 " : ""}신청과 검토는 무료이고, 소개 이용료 ${money(BEFORE_US.pricing.introduction)}으로 최대 5번 소개받아요. 서로 선택해 3일 교류를 시작할 때만 1인 ${money(BEFORE_US.pricing.exchangePerPerson)}의 교류비가 들어요. 월정액이 아니고 자동 결제도 없어요.` },
  { id: "difference", title: "다른 소개 서비스와 무엇이 다른가요?", text: "넘기며 고르지 않아요. 운영진이 신청서를 직접 읽고 한 분을 골라 정오에 소개해요. 서로 선택해도 바로 연락처를 주고받지 않고, 3일 동안 편지나 ‘첫 장면’으로 먼저 알아가요. 만날지는 넷째 날 각자 정하고, 번호는 만나는 날에만 서로 보여요." },
];
const FAQ = BETA ? [BETA_FAQ, ...FIRST_FAQ, BETA_COHORT_FAQ, ...FAQ_BASE.filter(item => item.id !== "cohort" && item.id !== "bonus")] : [...FIRST_FAQ, ...FAQ_BASE];

function Pricing() {
  const promises = BETA ? BETA_PROMISES : PROMISES;
  const card = "rounded-2xl border border-border bg-card px-6 py-7 shadow-[0_22px_44px_-34px_color-mix(in_oklch,var(--primary)_55%,transparent)] sm:px-8";
  return (
    <section id="pricing" className="bleed relative isolate overflow-clip bg-[#F8F9FC] py-20 dark:bg-mist sm:py-24" aria-labelledby="pricing-title">
      <SectionLabel number="06" ko="이용 요금">CLEAR FROM THE BEGINNING</SectionLabel>
      <div className="grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-16">
        <div><h2 id="pricing-title" className="text-ink text-3xl font-semibold leading-[1.5] sm:text-[34px]">시작하기 전에,<br />분명하게 안내해요.</h2><p className="mt-5 text-[15px] leading-[1.9] text-foreground/75">{BETA ? <>지금은 베타 기간이라 결제가 없어요.<br />정식 운영으로 바뀌기 전에 사이트와 메일로 미리 알려 드려요.</> : <>돈이 드는 때는 딱 두 번이에요.<br />소개를 받기 전, 그리고 두 분이 서로 고른 뒤.</>}</p></div>
        <div className="space-y-4">
          <PaymentSteps />
          <div className={card}>
            <p className="text-ink text-base font-semibold">분명히 해 두고 싶은 것들</p>
            <ul className="mt-4 divide-y divide-border">{promises.map(item => <li key={item} className="flex gap-3.5 py-3.5 text-[15px] leading-[1.8] text-foreground/80 [text-wrap:balance] first:pt-1 last:pb-0"><span aria-hidden="true" className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Check size={11} strokeWidth={3} /></span>{item}</li>)}</ul>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-3"><Button asChild className={`h-12 rounded-full bg-[#F7D96B] px-6 text-[#2B2540] shadow-[0_14px_30px_-16px_rgba(180,140,20,0.7)] hover:bg-[#F2CF52] ${interaction}`}><Link to="/apply">소개 신청하기 <ArrowUpRight size={16} /></Link></Button><Button asChild variant="link" className={`h-12 px-0 text-foreground hover:text-primary ${interaction}`}><a href="#faq">자주 묻는 질문 보기 <ArrowRight size={14} /></a></Button></div>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const location = useLocation();
  const [open, setOpen] = useState("");
  useEffect(() => {
    const id = location.hash.startsWith("#faq-") ? location.hash.slice(5) : "";
    if (!id || !FAQ.some(item => item.id === id)) return;
    setOpen(id);
    const frame = requestAnimationFrame(() => document.getElementById(`faq-${id}`)?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [location.hash, location.key]);
  return (
    <section id="faq" className="grid gap-8 pt-20 pb-14 sm:pt-24 sm:pb-18 lg:grid-cols-[5fr_7fr] lg:gap-16" aria-labelledby="faq-title">
      <div><SectionLabel number="07" ko="자주 묻는 질문">BEFORE YOU BEGIN</SectionLabel><h2 id="faq-title" className="text-ink text-3xl font-semibold">시작 전, 궁금한 것들.</h2><p className="mt-5 text-sm leading-7 text-muted-foreground">신청하기 전에 많이 묻는 것들을 모았어요.<br />더 궁금한 건 <Link to="/contact" className="font-semibold text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary">문의하기</Link>로 남겨 주세요.</p></div>
      <Accordion type="single" collapsible value={open} onValueChange={setOpen} className="border-t border-border [&_[data-slot=accordion-content]]:motion-reduce:animate-none [&_svg]:motion-reduce:transition-none">
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
// 첫 마디 띠: 실제 서버 모드에서는 운영진이 확인한 회원의 첫 마디(12개 이상일 때만, 이름·사진 없이 문장만).
// 데모에서는 ‘예시 문장’이라고 밝힌 문장을 보여 준다(실제 회원의 말처럼 보이게 하지 않는다).
const EXAMPLE_GREETINGS = ["천천히 알아가고 싶어요. 반가워요!", "산책 좋아하시면 이야기가 잘 통할 것 같아요.", "오늘 하루는 어땠는지 먼저 묻고 싶어요.", "좋아하는 노래 하나씩 나눠 볼까요?", "말보다 잘 들어주는 사람이고 싶어요.", "주말 아침의 빵집을 좋아해요.", "서두르지 않아도 괜찮아요.", "작은 일에도 같이 웃고 싶어요.", "전시 보고 이야기 나누는 걸 좋아해요.", "요즘 아침 달리기를 시작했어요.", "커피보다 따뜻한 차를 좋아해요.", "편하게, 천천히 이야기 나눠요."];
function GreetingStream() {
  const [items, setItems] = useState<string[]>(LIVE ? [] : EXAMPLE_GREETINGS);
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (LIVE) void rpc<string[]>("public_greetings").then(({ data }) => setItems(data ?? [])); }, []);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setSeen(true); observer.disconnect(); } }, { threshold: 0.2 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [items.length]);
  if (items.length === 0) return null;
  const rows = [items.filter((_, index) => index % 2 === 0), items.filter((_, index) => index % 2 === 1)];
  return (
    <div ref={ref} className="mt-12" aria-label={LIVE ? "먼저 신청한 분들의 첫 마디" : "첫 마디 예시 문장"}>
      <p className="text-xs tracking-[0.15em] text-white/95">{LIVE ? "먼저 신청한 분들의 첫 마디" : "첫 마디 · 예시 문장"}</p>
      <div className="greet-mask mt-5 space-y-3 overflow-hidden">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="greet-track flex w-max gap-3" style={{ animationDuration: `${70 + rowIndex * 14}s`, animationDirection: rowIndex ? "reverse" : "normal" }}>
            {[...row, ...row].map((text, index) => <span key={`${text}-${index}`} aria-hidden={index >= row.length} data-in={seen} className="greet-chip whitespace-nowrap rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm text-white" style={{ transitionDelay: `${(index % row.length) * 70 + rowIndex * 120}ms` }}>“{text}”</span>)}
          </div>
        ))}
      </div>
      {!LIVE && <p className="mx-auto mt-4 max-w-md text-[11px] leading-5 text-white/90">예시 문장이에요. 실제 회원의 첫 마디가 모이면, 본인이 동의하고 운영진이 확인한 문장만 이 자리에 보여요.</p>}
    </div>
  );
}

function Together() {
  const reduced = useReducedMotion();
  const [ref, progress] = useSectionProgress<HTMLElement>();
  const near = reduced ? 1 : progress;
  const offset = Math.round(64 * (1 - near));
  return (
    <section ref={ref} className="bleed relative isolate overflow-clip bg-primary pt-14 pb-20 text-center text-primary-foreground sm:pt-18 sm:pb-24" aria-labelledby="together-title">
      <Texture />
      <div className="flex items-center justify-center py-6" aria-hidden="true">
        <span className="size-12 rounded-full bg-white sm:size-14" style={{ transform: `translateX(${-offset}px)` }} />
        <span className="-ml-2 size-12 rounded-full bg-accent mix-blend-screen sm:size-14" style={{ transform: `translateX(${offset}px)` }} />
      </div>
      <p className="mt-6 text-xs tracking-[0.15em] text-white/95">TWO DOTS, ONE SCENE</p>
      <h2 id="together-title" className="mt-4 text-3xl font-semibold leading-[1.5] sm:text-[38px]">이제, 한 사람을<br />만나볼 차례예요.</h2>
      <GreetingStream />
      <div className="mt-9 flex flex-col items-center gap-6">
        <Button asChild className={`h-12 rounded-full bg-white px-7 text-primary hover:bg-white/90 ${interaction}`}><Link to="/apply">소개 신청하기 <ArrowUpRight size={17} /></Link></Button>
        <NoonClock />
      </div>
      <div className="mx-auto mt-16 max-w-xl border-t border-white/20 pt-6 text-xs leading-6 text-white/95">
        <p className="text-sm text-white">다음 이야기는, 준비된 날 정오에 시작돼요.</p>
        <p className="mt-1">— 플라비 드림</p>
      </div>
    </section>
  );
}

export function PublicInformation({ section }: { section: "introduction" | "exchange" | "pricing" | "faq" }) {
  usePageWidth();
  const title = { introduction: "진행 방식", exchange: "두 가지 시작", pricing: "이용 요금", faq: "자주 묻는 질문" }[section];
  return <div className="break-keep [overflow-wrap:anywhere]"><h1 className="sr-only">{title}</h1>{section === "introduction" && <><Introduction /><FounderLetter /><InitialOperation detailsTo="/faq#faq-cohort" /></>}{section === "exchange" && <><PathToContact /><Exchange /></>}{section === "pricing" && <><Pricing /><Faq /></>}{section === "faq" && <Faq />}</div>;
}

// 휴대폰: 첫 화면을 지나면 아래에 작은 신청 버튼을 띄운다(맨 아래에 가까워지면 숨김).
function MobileApplyBar() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const update = () => setShow(window.scrollY > 560 && window.innerHeight + window.scrollY < document.documentElement.scrollHeight - 480);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <div aria-hidden={!show} className={`fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 sm:hidden ${show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"} transition-[transform,opacity] duration-300 motion-reduce:transition-none`}>
      <Button asChild tabIndex={show ? 0 : -1} className="h-12 w-full rounded-full shadow-[0_18px_36px_-14px_color-mix(in_oklch,var(--primary)_70%,transparent)]"><Link to="/apply">{BETA ? "베타 무료로 신청하기" : "소개 신청하기"} <ArrowUpRight size={16} /></Link></Button>
    </div>
  );
}

export default function PublicHome() {
  const root = useRef<HTMLDivElement>(null);
  useScrollReveal(root);
  usePageWidth();
  return <div ref={root} className="break-keep [overflow-wrap:anywhere]"><ScrollDots /><Hero /><Philosophy /><Introduction /><FounderLetter /><TwoVoices /><InitialOperation /><Exchange compact /><Pricing /><Faq /><Together /><MobileApplyBar /></div>;
}
