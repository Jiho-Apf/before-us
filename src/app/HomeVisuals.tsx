import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowUpRight, BadgeAlert, CalendarX2, Check, Link2Off, LockOpen, ShieldCheck, Siren, Smartphone, UserCheck } from "lucide-react";
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
  envelope: { id: "1614711961675-c589a467042f", alt: "대리석 위에 놓인 크림색 봉투들" },
} as const;
function Photo({ name, width, eager = false, className = "" }: { name: keyof typeof PHOTOS; width: number; eager?: boolean; className?: string }) {
  const { id, alt } = PHOTOS[name];
  const src = (w: number) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=75`;
  return <img src={src(width)} srcSet={`${src(width)} 1x, ${src(width * 2)} 2x`} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" className={`h-full w-full object-cover ${className}`} />;
}
const Dots = ({ className = "size-1.5" }: { className?: string }) => <span aria-hidden="true" className="flex gap-1"><span className={`${className} rounded-full bg-primary`} /><span className={`${className} rounded-full bg-accent`} /></span>;

// ① 첫 화면 사진: 공원 벤치에 나란히 앉은 두 사람의 뒷모습(Unsplash 1653556380866). 데스크톱은 화면 전체에 깔고 보라색이 왼쪽에서 스며들며, 모바일은 위쪽에 깔고 아래로 보라색에 녹아든다.
const HERO_PHOTO = "1653556380866-72862449a0b8";
export function HeroBackdrop() {
  const src = (w: number) => `https://images.unsplash.com/photo-${HERO_PHOTO}?auto=format&fit=crop&w=${w}&q=75`;
  return (
    <>
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-30 h-[460px] sm:h-[520px] lg:inset-y-0 lg:left-[22%] lg:h-auto">
        <img src={src(1600)} srcSet={`${src(900)} 900w, ${src(1600)} 1600w, ${src(2400)} 2400w`} sizes="(min-width: 1024px) 78vw, 100vw" alt="" fetchPriority="high" decoding="async" className="h-full w-full object-cover object-[55%_55%]" />
      </div>
      <div aria-hidden="true" className="absolute inset-0 -z-20 lg:hidden" style={{ backgroundImage: "linear-gradient(to bottom, color-mix(in oklch, var(--primary) 10%, transparent) 0px, transparent 90px, color-mix(in oklch, var(--primary) 55%, transparent) 230px, color-mix(in oklch, var(--primary) 90%, transparent) 340px, var(--primary) 450px)" }} />
      <div aria-hidden="true" className="absolute inset-0 -z-20 hidden lg:block" style={{ backgroundImage: "linear-gradient(90deg, var(--primary) 0%, var(--primary) 22%, color-mix(in oklch, var(--primary) 78%, transparent) 36%, color-mix(in oklch, var(--primary) 25%, transparent) 54%, transparent 68%)" }} />
    </>
  );
}

// 사진 위에 떠 있는 정오 알림(유리처럼 비친다)
export function HeroNote({ className = "" }: { className?: string }) {
  return (
    <div className={`hero-float max-w-full rounded-2xl bg-white/90 p-3.5 text-[#2B2540] shadow-[0_24px_50px_-24px_rgba(18,10,58,0.75)] ring-1 ring-white/60 backdrop-blur-md ${className}`} aria-label="화면 예시: 정오에 도착한 소개 알림">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#EEEAFA]"><Dots /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center justify-between gap-2 text-[10px] font-semibold tracking-[0.16em] text-[#2B2540]/55"><span>BEFORE US</span><span className="tracking-normal tabular-nums">12:00</span></p>
          <p className="mt-0.5 truncate text-[13.5px] font-semibold">오늘의 인연이 도착했어요</p>
        </div>
      </div>
    </div>
  );
}

// ② 두 가지 시작: 편지지 사진 위에 두 사람의 편지가 겹쳐지고, 같은 순간에 열린다
const RULED = "bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_25px,rgba(97,76,196,0.14)_25px,rgba(97,76,196,0.14)_26px)]";
export function LetterMoment({ className = "" }: { className?: string }) {
  const { ref, shown } = useInView<HTMLElement>(0.35);
  const letters = [
    { who: "나", time: "21:14 보냄", text: "어제 말한 빵집, 저도 가 보고 싶어요. 아침에 가면 줄이 없나요?", place: "left-[5%] top-[9%] -rotate-3", from: "-translate-x-6" },
    { who: "상대", time: "22:40 보냄", text: "평일 아침이면 바로 들어가요. 소금빵이 제일 먼저 나와요.", place: "right-[5%] top-[41%] rotate-2", from: "translate-x-6" },
  ];
  return (
    <figure ref={ref} className={`relative mx-auto aspect-[5/6] w-full max-w-[440px] ${className}`} aria-label="화면 예시: 두 사람의 편지가 같은 순간에 열려요">
      <div className="absolute inset-0 overflow-hidden rounded-[2rem] shadow-[0_40px_80px_-50px_color-mix(in_oklch,var(--primary)_70%,transparent)]">
        <Photo name="envelope" width={520} className="scale-105 brightness-[0.93] saturate-[0.75]" />
        <span aria-hidden="true" className="absolute inset-0 bg-[rgba(160,130,100,0.12)]" />
      </div>
      {letters.map((letter, index) => (
        <div key={letter.who} className={`absolute w-[70%] ${letter.place}`}>
          <div className={`bg-[#FFFEFA] px-5 pb-4 pt-4 text-[#1F1B33] shadow-[0_26px_50px_-24px_rgba(30,20,80,0.65)] transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none ${shown ? "translate-x-0 opacity-100" : `${letter.from} opacity-0`}`} style={{ transitionDelay: `${index * 260}ms` }}>
            <p className="flex items-center justify-between text-[10px] font-semibold tracking-[0.12em] text-[#1F1B33]/55"><span className="flex items-center gap-2"><Dots className="size-1" />DAY 02 · {letter.who}</span><span className="tracking-normal">{letter.time}</span></p>
            <p className={`mt-2 text-[12.5px] leading-[26px] ${RULED}`}>{letter.text}</p>
          </div>
        </div>
      ))}
      <p className={`absolute bottom-[4%] left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-white/95 px-4 py-2.5 text-[12px] font-semibold text-[#2B2540] shadow-[0_18px_40px_-18px_rgba(30,20,80,0.6)] backdrop-blur transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none ${shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`} style={{ transitionDelay: "700ms" }}>
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground"><LockOpen size={12} /></span>두 통 모두 도착 · 함께 열렸어요
      </p>
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
    <div className={`relative rounded-2xl border border-border/70 bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_3%,var(--card)),var(--card)_60%)] p-5 transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none sm:p-6 ${"key" in step ? "shadow-[0_22px_44px_-34px_color-mix(in_oklch,var(--primary)_55%,transparent)]" : ""} ${align === "right" ? "sm:text-right" : ""} ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`} style={{ transitionDelay: `${index * 110}ms` }}>
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
        <p className="mt-4 text-sm leading-7 text-muted-foreground">한 번에 한 분만 소개해요. 서로 선택해 교류하는 동안에는 새 소개를 멈추고, 마무리되면 다음 분을 소개해요.</p>
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

// 비교해 보세요: 비포어스 칸만 카드처럼 떠오른다(요금표의 추천 칸 방식)
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
        <p className="text-[11px] font-semibold tracking-[0.24em] text-accent">WHY BEFORE US</p>
        <h3 className="text-ink mt-4 text-[26px] font-semibold leading-[1.45] sm:text-[32px]">비교해 보세요</h3>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">앱은 너무 가볍고, 결혼정보회사는 너무 무거웠다면.</p>
      </div>
      <div ref={ref} className="relative mx-auto mt-14 max-w-4xl [--label:84px] sm:[--label:150px]">
        <div aria-hidden="true" className={`absolute -bottom-5 -top-5 left-[calc(var(--label)+(100%-var(--label))*2/3)] w-[calc((100%-var(--label))/3)] rounded-[1.75rem] bg-card ring-1 ring-primary/15 shadow-[0_34px_70px_-34px_color-mix(in_oklch,var(--primary)_55%,transparent)] transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`} />
        <div className="relative grid grid-cols-[var(--label)_repeat(3,1fr)]">
          <span className="border-b border-border" />
          <span className="flex items-center justify-center border-b border-border px-2 pb-4 text-[11px] font-semibold text-muted-foreground sm:text-xs">소개팅 앱</span>
          <span className="flex items-center justify-center border-b border-border px-2 pb-4 text-[11px] font-semibold text-muted-foreground sm:text-xs">결혼정보회사</span>
          <span className="flex flex-col items-center justify-center gap-1.5 border-b border-primary/15 px-2 pb-4"><span aria-hidden="true" className="flex gap-1"><span className="size-2 rounded-full bg-primary" /><span className="size-2 rounded-full bg-accent" /></span><span className="text-xs font-semibold text-primary sm:text-sm">비포어스</span></span>
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
      <p className="mx-auto mt-9 max-w-4xl text-center text-[11px] text-muted-foreground">일반적인 이용 방식을 비교한 것으로, 서비스마다 다를 수 있어요.</p>
    </div>
  );
}

// 안심 기준: 밝은 바탕에 옅은 언덕 같은 곡선, 그 위에 네 개의 아이콘이 놓인다(이전의 ‘곡선 + 아래 네 항목’ 배치를 다듬은 것)
const STANDARDS = [
  { n: "01", icon: UserCheck, title: "운영진이 직접 확인", body: "사진과 신청서를 사람이 읽고 승인해요" },
  { n: "02", icon: ShieldCheck, title: "연락처·링크 자동 차단", body: "편지와 약속에서 번호·SNS·계좌는 막혀요" },
  { n: "03", icon: Smartphone, title: "번호는 만나는 날만", body: "두 분이 동의할 때, 그날과 다음 날만" },
  { n: "04", icon: Siren, title: "신고·차단 즉시", body: "누르는 순간 교류가 멈추고 운영진이 확인해요" },
];
// 곡선(viewBox 1000×120): M0 110 Q500 -30 1000 110 → x=12.5%에서 y≈79, x=37.5%에서 y≈44. 아이콘(48px) 중심을 그 높이에 맞춘다.
export function Standards() {
  const { ref, shown } = useInView<HTMLDivElement>(0.25);
  return (
    <div ref={ref} className="relative mt-20 border-t border-border pt-16 sm:pt-20">
      <div className="mx-auto max-w-xl text-center">
        <p className="text-[11px] font-semibold tracking-[0.24em] text-accent">OUR STANDARDS</p>
        <h3 className="text-ink mt-4 text-[26px] font-semibold leading-[1.45] sm:text-[32px]">안심하고 알아가도록,<br /><span className="text-primary">네 가지를 지켜요.</span></h3>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">소개부터 만나는 날까지, 비포어스가 대신 지키는 약속이에요.</p>
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
