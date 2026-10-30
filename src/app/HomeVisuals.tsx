import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowUpRight, BadgeAlert, CalendarX2, Check, Link2Off, LockOpen, PenLine, ShieldCheck, Siren, Smartphone, UserCheck } from "lucide-react";
import { Button } from "./components/ui/button";
import { BEFORE_US } from "./config";
import { LIVE } from "./backend/client";

// 홈의 시각 요소(2026-10-23 3차): 사진 콜라주(첫 화면) · 큰 숫자 · 여정 · 비교 표 · 함께 열리는 편지(사진) · 안심 기준(밝은 곡선) · 이용 흐름.
// 참고: 로멜로(잡지 화보처럼 겹친 사진·종이 질감), 토스(한 화면에 한 메시지·긴 그림자), Linear(얇은 선 아이콘).
// 사진은 Unsplash 라이선스(상업적 이용 가능)로 얼굴이 드러나지 않는 장면만 쓴다. 움직임은 ‘움직임 줄이기’ 설정에서 멈춘다.
const BETA = LIVE && BEFORE_US.beta.active;
const interaction = "transition-colors duration-200 motion-reduce:transition-none";
const money = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
const ApplyButton = ({ className = "" }: { className?: string }) => (
  <Button asChild className={`h-12 rounded-full bg-[#F7D96B] px-7 text-[#2B2540] shadow-[0_14px_30px_-16px_rgba(180,140,20,0.7)] hover:bg-[#F2CF52] ${interaction} ${className}`}><Link to="/apply">{BETA ? "베타 무료로 신청하기" : "소개 신청하기"} <ArrowUpRight size={16} /></Link></Button>
);

// 강조 밑줄: 문장 속 몇 군데만. 화면에 들어오면 얇은 보라 선이 왼쪽부터 천천히 그어진다(움직임 줄이기에서는 처음부터 그어져 있음).
export function Underline({ children }: { children: ReactNode }) {
  const { ref, shown } = useInView<HTMLSpanElement>(0.8);
  return <span ref={ref} className={`soft-underline ${shown ? "is-on" : ""}`}>{children}</span>;
}

export function useInView<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) { setShown(true); return; }
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setShown(true); observer.disconnect(); } }, { threshold });
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);
  return { ref, shown };
}

export function Glow({ className = "", tone = "primary" }: { className?: string; tone?: "primary" | "accent" }) {
  return <span aria-hidden="true" className={`pointer-events-none absolute -z-10 rounded-full blur-3xl ${tone === "primary" ? "bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_10%,transparent),transparent)]" : "bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--accent)_9%,transparent),transparent)]"} ${className}`} />;
}

// ── 사진(Unsplash 라이선스 · 상업적 이용 가능). 얼굴이 드러나지 않는 뒷모습·사물만 쓴다.
const PHOTOS = {
  envelope: { id: "1567794947803-59c1ec40ab6c", alt: "흰 꽃 옆에 놓인 봉투" },
} as const;
function Photo({ name, width, eager = false, className = "" }: { name: keyof typeof PHOTOS; width: number; eager?: boolean; className?: string }) {
  const { id, alt } = PHOTOS[name];
  const src = (w: number) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=75`;
  return <img src={src(width)} srcSet={`${src(width)} 1x, ${src(width * 2)} 2x`} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" className={`h-full w-full object-cover ${className}`} />;
}
const Dots = ({ className = "size-1.5" }: { className?: string }) => <span aria-hidden="true" className="flex gap-1"><span className={`${className} rounded-full bg-primary`} /><span className={`${className} rounded-full bg-accent`} /></span>;

// ① 첫 화면 사진: ‘정오의 빛’ — 흰 벽에 비친 나뭇잎 그림자(Unsplash 1530651796427, 2026-10-27 사용자 선택).
// 이전 사진(들판, public/images/hero-meadow-*)은 되돌릴 때를 위해 남겨 둔다.
// 데스크톱은 오른쪽 넓게 깔고 보라색이 왼쪽에서 스며든다. 모바일은 아래쪽(카드 뒤)에 깔고 위에서 보라색이 내려와 녹아든다.
export function HeroBackdrop() {
  const src = (w: number) => `https://images.unsplash.com/photo-1530651796427-6edd0e06319e?auto=format&fit=crop&w=${w}&q=80`;
  return (
    <>
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-30 h-[680px] sm:h-[760px] lg:inset-y-0 lg:left-[22%] lg:h-auto">
        <img src={src(1600)} srcSet={`${src(900)} 900w, ${src(1600)} 1600w, ${src(2400)} 2400w`} sizes="(min-width: 1024px) 78vw, 100vw" alt="" {...{ fetchpriority: "high" }} decoding="async" className="h-full w-full object-cover object-[50%_50%] lg:object-[40%_55%]" />
      </div>
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-20 h-[680px] sm:h-[760px] lg:hidden" style={{ backgroundImage: "linear-gradient(to bottom, var(--primary) 0%, color-mix(in oklch, var(--primary) 70%, transparent) 12%, color-mix(in oklch, var(--primary) 18%, transparent) 30%, transparent 44%)" }} />
      <div aria-hidden="true" className="absolute inset-0 -z-20 hidden lg:block" style={{ backgroundImage: "linear-gradient(90deg, var(--primary) 0%, var(--primary) 22%, color-mix(in oklch, var(--primary) 78%, transparent) 36%, color-mix(in oklch, var(--primary) 25%, transparent) 54%, transparent 68%)" }} />
    </>
  );
}

// ② 두 가지 시작: 편지지 사진 위에 두 사람의 편지가 겹쳐지고, 같은 순간에 열린다
const RULED = "bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_25px,rgba(97,76,196,0.14)_25px,rgba(97,76,196,0.14)_26px)]";
export function LetterMoment({ className = "" }: { className?: string }) {
  const letters = [
    { who: "나", time: "21:14 보냄", text: "쉬는 날엔 동네 빵집에서 아침을 먹고 오래 걸어요. 그 시간이 제일 저다워요.", place: "left-[5%] top-[9%] -rotate-3" },
    { who: "상대", time: "22:40 보냄", text: "저는 도서관 창가 자리에서 책을 읽어요. 해가 질 때쯤 집에 와요.", place: "right-[5%] top-[41%] rotate-2" },
  ];
  return (
    <figure className={`relative mx-auto aspect-[5/6] w-full max-w-[440px] ${className}`} aria-label="화면 예시: 두 사람의 편지가 같은 순간에 열려요">
      <div className="absolute inset-0 overflow-hidden rounded-[2rem] shadow-[0_40px_80px_-50px_color-mix(in_oklch,var(--primary)_70%,transparent)]">
        <Photo name="envelope" width={520} className="scale-105 brightness-[0.93] saturate-[0.75]" />
        <span aria-hidden="true" className="absolute inset-0 bg-[rgba(160,130,100,0.12)]" />
      </div>
      {letters.map(letter => (
        <div key={letter.who} className={`absolute w-[70%] ${letter.place}`}>
          <div className="bg-[#FFFEFA] px-5 pb-4 pt-4 text-[#1F1B33] shadow-[0_26px_50px_-24px_rgba(30,20,80,0.65)]">
            <p className="flex items-center justify-between text-[10px] font-semibold tracking-[0.12em] text-[#1F1B33]/55"><span className="flex items-center gap-2"><Dots className="size-1" />DAY 01 · {letter.who}</span><span className="tracking-normal">{letter.time}</span></p>
            <p className={`mt-2 text-[12.5px] leading-[26px] ${RULED}`}>{letter.text}</p>
          </div>
        </div>
      ))}
      <p className="absolute bottom-[4%] left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-white px-4 py-2.5 text-[12px] font-semibold text-[#2B2540] shadow-[0_18px_40px_-18px_rgba(30,20,80,0.6)]">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground"><LockOpen size={12} /></span>두 통 모두 도착 · 함께 열렸어요
      </p>
    </figure>
  );
}

// ③ 두 가지 시작 B: 첫날 두 사람이 각자 고른 곳과 이유가 함께 열리고, 셋째 날 둘이 고른 것 중에서 하나씩 골라 ‘첫 장면’을 맞춘다
// 목록에 없는 것은 ‘직접 작성’으로 쓸 수 있다(쉬어 갈 곳의 작은 연필 표시)
export function SceneMoment({ className = "" }: { className?: string }) {
  const picks = [
    { who: "나", time: "20:31 고름", place: "서점", why: "책 고르는 걸 옆에서 구경하는 게 좋아서요.", tilt: "-rotate-2" },
    { who: "상대", time: "22:05 고름", place: "서점", why: "조용히 같이 걸을 수 있을 것 같아서요.", tilt: "ml-auto -mt-2 rotate-2" },
  ];
  const scene = [["장소", "서점", false], ["머무는 방식", "각자 한 권씩 골라 보기", false], ["쉬어 갈 곳", "골목 끝 작은 빵집", true]] as const;
  return (
    <figure className={`relative mx-auto w-full max-w-[440px] rounded-[2rem] bg-[linear-gradient(160deg,color-mix(in_oklch,var(--accent)_12%,var(--card)),color-mix(in_oklch,var(--primary)_7%,var(--card)))] p-5 shadow-[0_40px_80px_-50px_color-mix(in_oklch,var(--accent)_70%,transparent)] sm:p-7 ${className}`} aria-label="화면 예시: 두 사람이 고른 장면이 함께 열리고, 셋째 날 둘이 고른 것으로 첫 장면을 맞춰요">
      {picks.map(pick => (
        <div key={pick.who} className={`w-[80%] bg-[#FFFEFA] px-5 py-4 text-[#1F1B33] shadow-[0_26px_50px_-28px_rgba(30,40,110,0.6)] ${pick.tilt}`}>
          <p className="flex items-center justify-between text-[10px] font-semibold tracking-[0.12em] text-[#1F1B33]/55"><span className="flex items-center gap-2"><Dots className="size-1" />DAY 01 · {pick.who}</span><span className="tracking-normal">{pick.time}</span></p>
          <p className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px] leading-6"><span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold text-accent">{pick.place}</span>{pick.why}</p>
        </div>
      ))}
      <p className="mx-auto mt-5 flex w-fit items-center gap-2 whitespace-nowrap rounded-full bg-white px-4 py-2.5 text-[12px] font-semibold text-[#2B2540] shadow-[0_18px_40px_-18px_rgba(30,20,80,0.6)]">
        <span className="flex size-6 items-center justify-center rounded-full bg-accent text-white"><LockOpen size={12} /></span>두 분 모두 골라 · 함께 열렸어요
      </p>
      <div className="mt-5 rounded-2xl bg-card/90 px-5 py-4 shadow-[0_18px_40px_-30px_rgba(30,20,80,0.5)]">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-accent">DAY 03 · 함께 맞춘 첫 장면</p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">{scene.map(([label, value, own]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 font-semibold text-foreground">{own && <><PenLine size={10} aria-hidden="true" className="mr-1 inline-block align-[-1px] text-accent" /><span className="sr-only">직접 쓴 </span></>}{value}</dd></div>)}</dl>
        <p className="mt-3 border-t border-border pt-3 text-[12px] leading-5 text-foreground">“요즘 읽고 있는 책 이야기”</p>
      </div>
    </figure>
  );
}

// 큰 숫자 띠: 상자 없이, 얇은 선으로만 나눈다
const NUMBERS = [
  { big: "1명", label: "한 번에 한 사람", note: "여러 명과 동시에 연락하지 않아요" },
  { big: "12:00", label: "같은 순간에 도착", note: "두 분에게 정오에 함께" },
  { big: "3일", label: "얼굴 보기 전 대화", note: "편지 또는 ‘첫 장면’으로" },
  { big: "D-day", label: "번호는 만나는 날에만", note: "두 분이 모두 동의할 때" },
];
export function NumberBand() {
  return (
    <dl className="relative mt-16 grid grid-cols-2 gap-y-10 border-t border-border pt-10 lg:grid-cols-4">
      {NUMBERS.map((item, index) => (
        <div key={item.big} className={`flex flex-col border-l border-border pl-5 sm:pl-7 ${index === 0 ? "border-l-0 pl-0 sm:pl-0" : index === 2 ? "border-l-0 pl-0 sm:pl-0 lg:border-l lg:pl-7" : ""}`}>
          <dt className="order-2 mt-3 text-sm font-semibold">{item.label}</dt>
          <dd className="order-1 text-[20px] font-semibold leading-none tracking-tight text-primary sm:text-[22px]">{item.big}</dd>
          <dd className="order-3 mt-1.5 text-xs leading-5 text-muted-foreground">{item.note}</dd>
        </div>
      ))}
    </dl>
  );
}

// 한눈에 보는 흐름(THE JOURNEY): 카드 색은 거의 보이지 않을 만큼만, 03만 숨 쉬듯
const FLOW = [
  { n: "01", meta: "무료 · 약 15분", title: "소개 신청", body: "가입하고 신청서와 사진 3장을 적어요. 단계마다 저장돼서 나눠 써도 돼요." },
  { n: "02", meta: "사람이 직접", title: "운영진 확인", body: "사진과 신청서를 운영진이 하나하나 읽고, 잘 맞을 분을 찾아요." },
  { n: "03", meta: "12:00", title: "정오에 한 분 소개", body: "상대의 사진과 프로필이 함께 도착해요. 다음 날 오전 11시까지 답해요.", key: true },
  { n: "04", meta: "두 분 모두일 때만", title: "서로 선택", body: "한 분이라도 넘기면 조용히 마무리돼요. 누가 넘겼는지는 알리지 않아요." },
  { n: "05", meta: "DAY 01—03", title: "3일 교류", body: "편지 또는 ‘첫 장면’ 중 함께 고른 방식으로. 두 분이 모두 보내야 함께 열려요." },
  { n: "06", meta: "DAY 04", title: "만남 선택", body: "만나고 싶은지 각자 골라요. 상대의 답은 알려 주지 않아요." },
  { n: "07", meta: "만나는 날", title: "약속 · 연락처", body: "날짜와 장소를 함께 정하고, 번호는 만나는 날에만 서로 보여요." },
] as const;
function JourneyCard({ step, index, align, shown }: { step: (typeof FLOW)[number]; index: number; align: "left" | "right"; shown: boolean }) {
  return (
    <div className={`relative rounded-2xl border border-border/70 bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_3%,var(--card)),var(--card)_60%)] p-5 transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none sm:p-6 ${"key" in step ? "journey-glow" : "shadow-[0_22px_44px_-34px_color-mix(in_oklch,var(--primary)_55%,transparent)]"} ${align === "right" ? "sm:text-right" : ""} ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`} style={{ transitionDelay: `${index * 110}ms` }}>
      <p className={`flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-primary ${align === "right" ? "sm:justify-end" : ""}`}>STEP {step.n}<span className="rounded-full bg-primary/8 px-2.5 py-0.5 text-[11px] font-medium tracking-normal text-primary">{step.meta}</span></p>
      <p className="text-ink mt-2.5 text-lg font-semibold leading-snug">{step.title}</p>
      <p className="mt-2 text-sm leading-[1.85] text-muted-foreground">{step.body}</p>
    </div>
  );
}
export function Journey() {
  const { ref, shown } = useInView<HTMLOListElement>(0.08);
  return (
    <div className="relative mt-20 border-t border-border pt-16 sm:mt-24 sm:pt-20">
      <div className="mx-auto max-w-xl text-center">
        <p className="text-[11px] font-semibold tracking-[0.24em] text-accent">THE JOURNEY</p>
        <h3 className="text-ink mt-4 text-[26px] font-semibold leading-[1.45] sm:text-[32px]">신청부터 만남까지,<br /><span className="text-primary">한눈에 볼게요.</span></h3>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">한 번에 한 분만 소개해요. 서로 선택해 교류하는 동안에는 새 소개를 멈추고,<br className="hidden sm:block" /> 마무리되면 다음 분을 소개해요.</p>
      </div>
      <ol ref={ref} className="relative mx-auto mt-14 max-w-3xl">
        <span aria-hidden="true" className={`absolute bottom-6 left-[19px] top-6 w-px origin-top bg-[color-mix(in_oklch,var(--primary)_28%,transparent)] transition-transform duration-[1800ms] ease-out motion-reduce:transition-none sm:left-1/2 sm:-translate-x-1/2 ${shown ? "scale-y-100" : "scale-y-0"}`} />
        {FLOW.map((step, index) => {
          const left = index % 2 === 0;
          return (
            <li key={step.n} className="relative grid grid-cols-[40px_1fr] items-center gap-x-4 pb-7 last:pb-0 sm:-mt-9 sm:grid-cols-[1fr_40px_1fr] sm:gap-x-8 sm:pb-0 sm:first:mt-0">
              <div className="hidden sm:block">{left && <JourneyCard step={step} index={index} align="right" shown={shown} />}</div>
              <span className="relative z-10 mx-auto flex size-10 items-center justify-center">
                <span className={`relative flex items-center justify-center rounded-full font-semibold tabular-nums ${"key" in step ? "journey-breathe size-10 text-xs" : "size-8 bg-card text-[11px] text-primary ring-1 ring-primary/20"}`}>{step.n}</span>
              </span>
              <div className="sm:hidden"><JourneyCard step={step} index={index} align="left" shown={shown} /></div>
              <div className="hidden sm:block">{!left && <JourneyCard step={step} index={index} align="left" shown={shown} />}</div>
            </li>
          );
        })}
      </ol>
      <div className="mb-4 mt-[4.5rem] flex flex-wrap items-center justify-center gap-x-6 gap-y-3"><ApplyButton /><Link to="/faq" className={`text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline ${interaction}`}>자주 묻는 질문 보기</Link></div>
    </div>
  );
}

// 비교해 보세요: 플라비 칸만 카드처럼 떠오른다(요금표의 추천 칸 방식)
const COMPARE = [
  { row: "누가 고르나요", app: "내가 넘기며 직접", agency: "매니저가 조건 위주로", us: "운영진이 신청서를 읽고 한 분" },
  { row: "동시에 몇 명과", app: "여러 명과 동시에", agency: "일정에 따라 여러 번", us: "한 번에 한 분" },
  { row: "첫 대화", app: "바로 채팅", agency: "바로 만남 약속", us: "3일 동안 편지·첫 장면" },
  { row: "연락처는 언제", app: "대화하며 직접 교환", agency: "매니저가 전달", us: "둘 다 원하면 만나는 날에만" },
  { row: "비용", app: "월 구독·유료 아이템", agency: "가입비 수십만~수백만 원", us: BETA ? "지금은 베타라 무료" : "소개 1만 원 · 교류 2.9만 원" },
];
export function CompareTable() {
  const { ref, shown } = useInView<HTMLDivElement>(0.25);
  const cell = "flex items-center justify-center border-b border-border px-2 py-4 text-center text-[11px] leading-5 text-muted-foreground sm:px-4 sm:py-5 sm:text-[13px]";
  return (
    <div className="relative mt-20 sm:mt-24">
      <div className="mx-auto max-w-xl text-center">
        <p className="text-[11px] font-semibold tracking-[0.24em] text-accent">WHY FLAVIE</p>
        <h3 className="text-ink mt-4 text-[26px] font-semibold leading-[1.45] sm:text-[32px]">비교해 보세요</h3>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">앱은 너무 가볍고, 결혼정보회사는 너무 무거웠다면.</p>
      </div>
      <div ref={ref} className="relative mx-auto mt-14 max-w-4xl [--label:84px] sm:[--label:150px]">
        <div aria-hidden="true" className={`absolute -bottom-5 -top-5 left-[calc(var(--label)+(100%-var(--label))*2/3)] w-[calc((100%-var(--label))/3)] rounded-[1.75rem] bg-card ring-1 ring-primary/15 shadow-[0_34px_70px_-34px_color-mix(in_oklch,var(--primary)_55%,transparent)] transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`} />
        <div className="relative grid grid-cols-[var(--label)_repeat(3,1fr)]">
          <span className="border-b border-border" />
          <span className="flex items-center justify-center border-b border-border px-2 pb-4 text-[11px] font-semibold text-muted-foreground sm:text-xs">소개팅 앱</span>
          <span className="flex items-center justify-center border-b border-border px-2 pb-4 text-[11px] font-semibold text-muted-foreground sm:text-xs">결혼정보회사</span>
          <span className="flex flex-col items-center justify-center gap-1.5 border-b border-primary/15 px-2 pb-4"><span aria-hidden="true" className="flex gap-1"><span className="size-2 rounded-full bg-primary" /><span className="size-2 rounded-full bg-accent" /></span><span className="text-xs font-semibold text-primary sm:text-sm">플라비</span></span>
          {COMPARE.map((item, index) => {
            const last = index === COMPARE.length - 1;
            return [
              <span key={`${item.row}-r`} className={`flex items-center py-4 pr-2 text-[11px] font-semibold sm:py-5 sm:text-[13px] ${last ? "" : "border-b border-border"}`}>{item.row}</span>,
              <span key={`${item.row}-a`} className={`${cell} ${last ? "border-b-0" : ""}`}>{item.app}</span>,
              <span key={`${item.row}-b`} className={`${cell} ${last ? "border-b-0" : ""}`}>{item.agency}</span>,
              <span key={`${item.row}-c`} className={`flex flex-col items-center justify-center gap-1.5 px-2 py-4 text-center text-[11px] font-semibold leading-5 text-ink sm:flex-row sm:gap-2 sm:px-4 sm:py-5 sm:text-[13px] ${last ? "" : "border-b border-primary/10"}`}><span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check size={11} strokeWidth={3} /></span>{item.us}</span>,
            ];
          })}
        </div>
      </div>
    </div>
  );
}

// 안심 기준: 밝은 바탕에 옅은 언덕 같은 곡선, 그 위에 네 개의 아이콘이 놓인다(이전의 ‘곡선 + 아래 네 항목’ 배치를 다듬은 것)
const STANDARDS = [
  { n: "01", icon: UserCheck, title: "운영진이 직접 확인", body: "사진과 신청서를 사람이 읽고 승인해요" },
  { n: "02", icon: ShieldCheck, title: "연락처·링크 자동 차단", body: "편지와 약속에서 번호·SNS·계좌는 막혀요" },
  { n: "03", icon: Smartphone, title: "번호는 만나는 날만", body: "두 분이 동의할 때, 그날과 다음 날만" },
  { n: "04", icon: Siren, title: "신고·차단 즉시", body: "차단은 즉시 끝나고, 신고는 먼저 확인해요" },
];
// 곡선(viewBox 1000×120): M0 110 Q500 -30 1000 110 → x=12.5%에서 y≈79, x=37.5%에서 y≈44. 아이콘(48px) 중심을 그 높이에 맞춘다.
export function Standards() {
  const { ref, shown } = useInView<HTMLDivElement>(0.25);
  return (
    <div ref={ref} className="relative mt-20 border-t border-border pt-16 sm:pt-20">
      <div className="mx-auto max-w-xl text-center">
        <p className="text-[11px] font-semibold tracking-[0.24em] text-accent">OUR STANDARDS</p>
        <h3 className="text-ink mt-4 text-[26px] font-semibold leading-[1.45] sm:text-[32px]">안심하고 알아가도록,<br /><span className="text-primary">네 가지를 지켜요.</span></h3>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">소개부터 만나는 날까지, 플라비가 대신 지키는 약속이에요.</p>
      </div>
      <div className="relative mx-auto mt-12 max-w-4xl">
        <svg aria-hidden="true" viewBox="0 0 1000 120" preserveAspectRatio="none" className="absolute inset-x-0 top-0 hidden h-[120px] w-full overflow-visible sm:block">
          <defs>
            <linearGradient id="standards-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--primary)" stopOpacity="0.09" /><stop offset="1" stopColor="var(--primary)" stopOpacity="0" /></linearGradient>
            <linearGradient id="standards-line" x1="0" x2="1"><stop offset="0" stopColor="var(--primary)" stopOpacity="0.1" /><stop offset="0.5" stopColor="var(--primary)" stopOpacity="0.55" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0.1" /></linearGradient>
          </defs>
          <path d="M0 110 Q500 -30 1000 110 L1000 200 L0 200 Z" fill="url(#standards-hill)" className={`transition-opacity duration-1000 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`} />
          <path d="M0 110 Q500 -30 1000 110" fill="none" stroke="url(#standards-line)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" pathLength={1} strokeDasharray="1" strokeDashoffset={shown ? 0 : 1} style={{ transition: "stroke-dashoffset 1.8s ease-out" }} />
        </svg>
        <ol className="relative grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-4 sm:gap-x-6">
          {STANDARDS.map((item, index) => {
            const Icon = item.icon;
            const outer = index === 0 || index === STANDARDS.length - 1;
            return (
              <li key={item.n} className={`text-center transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none ${outer ? "sm:pt-[55px]" : "sm:pt-[20px]"} ${shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`} style={{ transitionDelay: `${500 + index * 200}ms` }}>
                <span className="relative mx-auto flex size-12 items-center justify-center rounded-full bg-card text-primary shadow-[0_14px_30px_-14px_color-mix(in_oklch,var(--primary)_60%,transparent)] ring-1 ring-primary/15">
                  <span aria-hidden="true" className="absolute -inset-1.5 rounded-full bg-primary/[0.06]" />
                  <Icon size={19} strokeWidth={1.5} className="relative" />
                </span>
                <p className="mt-5 text-[10px] font-semibold tracking-[0.18em] text-accent">STANDARD {item.n}</p>
                <p className="text-ink mt-1.5 text-[15px] font-semibold">{item.title}</p>
                <p className="mx-auto mt-1.5 max-w-[13rem] text-xs leading-5 text-muted-foreground">{item.body}</p>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="mx-auto mt-14 flex max-w-4xl flex-col items-center justify-between gap-4 rounded-2xl border border-border bg-mist px-6 py-5 sm:flex-row">
        <div className="text-center sm:text-left"><p className="text-sm font-semibold">이런 행동은 바로 이용이 제한돼요</p><p className="mt-1 text-[11px] text-muted-foreground">모든 제한에는 다시 검토를 요청할 수 있어요.</p></div>
        <div className="flex flex-wrap justify-center gap-2">{[{ icon: CalendarX2, label: "노쇼" }, { icon: BadgeAlert, label: "거짓 정보" }, { icon: Link2Off, label: "외부 연락 유도" }].map(({ icon: Icon, label }) => <span key={label} className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs"><Icon size={14} strokeWidth={1.6} className="text-primary" />{label}</span>)}</div>
      </div>
    </div>
  );
}

// 이용 흐름: 요금은 위 문단에 두고, 이 상자는 ‘언제 무엇을 하는지’만 조용히 보여 준다
// 두 가지 시작 화면: 신청부터 연락까지 큰 흐름을 네 묶음으로 한눈에. 핵심인 3일은 버터 노랑으로 짚는다.
const PATH = [
  { phase: "소개까지", tone: "plain", steps: [
    { title: "소개 신청", when: "언제든", note: "네 단계 신청서를 쓰면 운영진이 한 장씩 읽어요." },
    { title: "정오의 소개", when: "준비된 날 12:00", note: "두 분에게 같은 순간, 한 분이 도착해요." },
  ] },
  { phase: "서로 고르기", tone: "plain", steps: [
    { title: "알아가고 싶어요", when: "다음 날 11:00까지", note: "두 분 모두 고를 때만 이어져요. 누가 먼저 골랐는지는 몰라요." },
    { title: "방식과 시작일", when: "48시간 안", note: "A 편지 나누기 또는 B 첫 장면 만들기, 같은 방식을 함께 골라요." },
  ] },
  { phase: "3일 교류", tone: "core", steps: [
    { title: "첫째~셋째 날", when: "매일 09:00~23:59", note: "하루 한 번씩 쓰고, 두 분 모두 보내면 함께 열려요." },
  ] },
  { phase: "만남까지", tone: "plain", steps: [
    { title: "만남 선택", when: "넷째 날 09:00부터", note: "두 분 모두 ‘만나고 싶어요’일 때만 약속을 정해요." },
    { title: "약속과 연락처", when: "만나는 날 00:00", note: "두 분이 동의하면 그날부터 서로의 번호가 보여요." },
  ] },
] as const;
export function PathToContact() {
  return (
    <section className="py-16 sm:py-20" aria-labelledby="path-title">
      <p className="text-[11px] font-semibold tracking-[0.2em] text-accent">FROM APPLY TO HELLO</p>
      <h2 id="path-title" className="text-ink mt-4 text-3xl font-semibold leading-[1.5] sm:text-[34px]">신청부터 연락까지,<br />이렇게 이어져요.</h2>
      <p className="mt-4 max-w-xl text-[15px] leading-[1.9] text-foreground/75">빠르게 넘기지 않는 대신, 단계마다 두 분의 마음이 같을 때만 다음으로 넘어가요.</p>
      <ol className="mt-10 grid gap-4 lg:grid-cols-4 lg:gap-3">
        {PATH.map((group, index) => (
          <li key={group.phase} className={`relative flex flex-col rounded-3xl p-6 ${group.tone === "core" ? "bg-[#F8E5A6] text-[#2B2540] dark:bg-[#3B3424] dark:text-white" : "bg-mist ring-1 ring-primary/[0.06]"}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={`text-[11px] font-semibold tracking-[0.14em] ${group.tone === "core" ? "text-[#7A5A10] dark:text-[#F3D98A]" : "text-accent"}`}>{group.phase}</span>
              <span className={`text-3xl font-light tabular-nums ${group.tone === "core" ? "text-[#7A5A10]/70 dark:text-[#F3D98A]/70" : "text-primary/40"}`}>0{index + 1}</span>
            </div>
            <ul className="mt-5 flex flex-1 flex-col gap-5">
              {group.steps.map(step => (
                <li key={step.title} className="border-t border-current/10 pt-4 first:border-0 first:pt-0">
                  <p className="text-[15px] font-semibold">{step.title}</p>
                  <p className={`mt-1.5 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${group.tone === "core" ? "bg-white/70 text-[#5A4310] dark:bg-white/10 dark:text-white" : "bg-card text-primary"}`}>{step.when}</p>
                  <p className={`mt-2 text-[13px] leading-6 ${group.tone === "core" ? "text-[#2B2540]/80 dark:text-white/80" : "text-foreground/70"}`}>{step.note}</p>
                </li>
              ))}
            </ul>
            {index < PATH.length - 1 && <span aria-hidden="true" className="absolute -right-2.5 top-1/2 z-10 hidden size-5 -translate-y-1/2 items-center justify-center rounded-full bg-card text-primary shadow-sm ring-1 ring-primary/10 lg:flex">›</span>}
          </li>
        ))}
      </ol>
      <p className="mt-5 text-xs leading-6 text-muted-foreground">어느 단계에서든 한 분이 원하지 않으면 거기서 조용히 마무리돼요. 누가 어떤 답을 했는지는 알려 드리지 않아요.</p>
    </section>
  );
}

// 이용 요금: 신청부터 만남까지 네 단계에 금액을 붙여 '언제, 얼마를 내는지' 한눈에 보여 준다.
// 베타에서는 정식 운영 금액을 흐리게 두고 '베타 무료'를 붙인다.
const PAY_STEPS = [
  { step: "신청·검토", note: "신청서를 쓰면 운영진이 직접 읽고 확인해요.", price: 0, label: "" },
  { step: "정오의 소개 · 최대 5번", note: "승인되면 기수 시작 전날 18:00까지 내요. 첫 상대 프로필을 열기 전에는 언제든 전액 돌려드려요.", price: BEFORE_US.pricing.introduction, label: "소개비" },
  { step: "서로 ‘알아가고 싶어요’ → 3일 교류", note: "두 분 모두 고른 뒤에만, 각자 24시간 안에 내요. 한 분만 내면 낸 금액은 모두 돌려드려요.", price: BEFORE_US.pricing.exchangePerPerson, label: "교류비" },
  { step: "만남 선택 · 약속", note: "넷째 날 각자 정하고, 만나는 날 번호가 보여요.", price: 0, label: "" },
];
const won = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
export function PaymentSteps() {
  return (
    <div className="rounded-2xl border border-border bg-card px-6 py-7 shadow-[0_22px_44px_-34px_color-mix(in_oklch,var(--primary)_55%,transparent)] sm:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-ink text-base font-semibold">언제, 얼마를 내나요?</p><p className="text-xs text-foreground/60">1인 기준 · 부가세 포함</p></div>
      <ol className="mt-5 divide-y divide-border">
        {PAY_STEPS.map((item, index) => (
          <li key={item.step} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 py-4 first:pt-1 last:pb-0 sm:grid-cols-[1.75rem_minmax(0,1fr)_auto] sm:items-center sm:gap-x-4">
            <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-primary/8 text-[11px] font-semibold text-primary tabular-nums">{index + 1}</span>
            <div><p className="text-ink text-[15px] font-semibold">{item.step}</p><p className="mt-1 text-[13px] leading-6 text-foreground/70">{item.note}</p></div>
            <div className="col-start-2 mt-2.5 sm:col-start-3 sm:mt-0 sm:text-right">
              {item.price === 0 ? <span className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground/70">무료</span>
                : BETA ? <span className="inline-flex flex-col items-start gap-1 sm:items-end"><span className="rounded-full bg-[#F8E5A6] px-3 py-1 text-xs font-semibold text-[#5A4310]">베타 무료</span><span className="text-[11px] text-foreground/50">정식 {item.label} {won(item.price)}</span></span>
                : <span className="inline-flex rounded-full bg-primary/8 px-3 py-1 text-xs font-semibold text-primary tabular-nums">{item.label} {won(item.price)}</span>}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-xl bg-mist px-4 py-3.5 text-[13px]">
        <span className="font-semibold text-ink">{BETA ? "지금은 베타라 모든 단계가 무료예요" : `첫 만남까지 1인 최대 ${won(BEFORE_US.pricing.firstExchangeTotalPerPerson)}`}</span>
        <span className="text-foreground/65">월정액·자동 결제 없음</span>
      </div>
    </div>
  );
}

const PLAN_FLOW = [
  { when: "신청·검토", note: "신청서를 적으면 운영진이 직접 확인해요" },
  { when: "정오의 소개", note: "준비된 날 12시에 한 분이 도착해요" },
  { when: "3일 교류", note: "두 분 모두 원할 때만 시작해요" },
  { when: "약속·만남", note: "넷째 날 각자 정하고, 만나는 날 번호가 보여요" },
];
export function PlanFlow() {
  return (
    <div className="rounded-2xl border border-border bg-card px-6 py-7 sm:px-8">
      <p className="text-ink text-base font-semibold">어떤 순서로 진행되나요?</p>
      <ol className="relative mt-6 grid gap-5 sm:grid-cols-4 sm:gap-4">
        <span aria-hidden="true" className="absolute bottom-2 left-[7px] top-2 w-px bg-primary/15 sm:bottom-auto sm:left-[7px] sm:right-0 sm:top-[7px] sm:h-px sm:w-auto" />
        {PLAN_FLOW.map((step, index) => (
          <li key={step.when} className="relative pl-6 sm:pl-0 sm:pt-6">
            <span aria-hidden="true" className={`absolute left-[7px] top-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full sm:top-[7px] ${index === 0 ? "journey-breathe size-3.5 ring-1 ring-primary/30" : "size-[7px] bg-card ring-[1.5px] ring-primary/35"}`} />
            <p className="text-[10px] font-semibold tracking-[0.16em] text-accent tabular-nums">0{index + 1}</p>
            <p className="text-ink mt-1.5 text-[15px] font-semibold">{step.when}</p>
            <p className="mt-1.5 text-[13px] leading-6 text-foreground/70">{step.note}</p>
          </li>
        ))}
      </ol>
      {!BETA && <p className="mt-6 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">월정액이 아니고 자동으로 결제되지 않아요. 소개비는 첫 상대 프로필을 열기 전에 취소하면 전액 돌려드려요.</p>}
    </div>
  );
}

export { ApplyButton };
