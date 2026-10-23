import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowUpRight, BadgeAlert, CalendarX2, Check, Link2Off, LockOpen } from "lucide-react";
import { Button } from "./components/ui/button";
import { BEFORE_US } from "./config";
import { LIVE } from "./backend/client";

// 첫 화면을 더 매력적으로(2026-10-23): 실제로 겪을 화면(휴대폰 틀) · 큰 숫자 · 비교 표 · 여정 · 요금 · 안심 기준.
// 사람은 사진 대신 일러스트·이니셜로 그린다(가상 인물, 화면 예시). 움직임은 ‘움직임 줄이기’ 설정에서 멈춘다.
const BETA = LIVE && BEFORE_US.beta.active;
const interaction = "transition-colors duration-200 motion-reduce:transition-none";
const money = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
const gradientText = "bg-[linear-gradient(120deg,var(--primary),var(--accent))] bg-clip-text text-transparent";
const ApplyButton = ({ className = "" }: { className?: string }) => (
  <Button asChild className={`h-12 rounded-full px-7 ${interaction} ${className}`}><Link to="/apply">{BETA ? "베타 무료로 신청하기" : "소개 신청하기"} <ArrowUpRight size={16} /></Link></Button>
);

// 화면에 들어오면 한 번 나타나게(움직임 줄이기 설정이면 바로 보인다)
function useInView<T extends HTMLElement>(threshold = 0.2) {
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

// 옅게 번지는 빛(카드 뒤)
export function Glow({ className = "", tone = "primary" }: { className?: string; tone?: "primary" | "accent" }) {
  return <span aria-hidden="true" className={`pointer-events-none absolute -z-10 rounded-full blur-3xl ${tone === "primary" ? "bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_22%,transparent),transparent)]" : "bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--accent)_20%,transparent),transparent)]"} ${className}`} />;
}

// 일러스트 얼굴(사진 대신): 이니셜 + 그라데이션 원
function Avatar({ initial, tone = "primary", size = "size-14" }: { initial: string; tone?: "primary" | "accent"; size?: string }) {
  return (
    <span aria-hidden="true" className={`relative flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-full text-lg font-semibold text-white ${tone === "primary" ? "bg-[linear-gradient(140deg,#8F7BEA,#614CC4_55%,#3A54CA)]" : "bg-[linear-gradient(140deg,#7A9BF0,#3A54CA_60%,#614CC4)]"}`}>
      <span className="absolute -bottom-3 -right-2 size-9 rounded-full bg-white/20" />
      <span className="absolute -left-2 -top-3 size-7 rounded-full bg-white/15" />
      <span className="relative">{initial}</span>
    </span>
  );
}

function PhoneFrame({ children, label, className = "" }: { children: ReactNode; label: string; className?: string }) {
  return (
    <figure aria-label={label} className={`relative w-[248px] rounded-[2.4rem] border-[9px] border-[#1d1a36] bg-card shadow-[0_40px_70px_-30px_rgba(29,26,54,0.55)] ${className}`}>
      <span aria-hidden="true" className="absolute left-1/2 top-2 h-4 w-20 -translate-x-1/2 rounded-full bg-[#1d1a36]" />
      <div className="overflow-hidden rounded-[1.8rem] bg-[linear-gradient(180deg,var(--mist),var(--card)_40%)] px-4 pb-5 pt-8 text-foreground">{children}</div>
    </figure>
  );
}

// ① 첫 화면: 정오에 도착하는 소개 카드
export function NoonPhone({ className = "" }: { className?: string }) {
  return (
    <PhoneFrame label="화면 예시: 정오에 도착한 오늘의 인연" className={className}>
      <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground"><span>12:00</span><span className="tracking-[0.14em]">BEFORE US</span></div>
      <p className="mt-4 text-[10px] font-semibold tracking-[0.16em] text-accent">TODAY · 12:00</p>
      <p className="text-ink mt-1.5 text-[15px] font-semibold leading-snug">오늘의 인연이 도착했어요</p>
      <div className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-[0_14px_30px_-22px_color-mix(in_oklch,var(--primary)_70%,transparent)]">
        <div className="flex items-center gap-3"><Avatar initial="지" /><div><p className="text-sm font-semibold">지윤 · 29</p><p className="text-[11px] text-muted-foreground">마포구 · 디자인</p></div></div>
        <p className="mt-3 rounded-xl bg-mist px-3 py-2 text-[11px] leading-5">“주말엔 동네 서점에서 한참 머물러요.”</p>
        <div className="mt-3 flex flex-wrap gap-1">{["산책", "전시", "음악"].map(tag => <span key={tag} className="rounded-full bg-primary/8 px-2 py-0.5 text-[10px] text-primary">{tag}</span>)}</div>
        <div className="mt-4 grid gap-1.5"><span className="rounded-xl bg-primary py-2 text-center text-[11px] font-semibold text-primary-foreground">알아가고 싶어요</span><span className="rounded-xl border border-border py-2 text-center text-[11px] text-muted-foreground">이번에는 넘길게요</span></div>
      </div>
      <p className="mt-3 text-center text-[10px] text-muted-foreground">내일 오전 11시까지 답해 주세요</p>
    </PhoneFrame>
  );
}

// ② 두 가지 시작: 두 사람이 모두 보내야 함께 열리는 편지
export function LetterPhone({ className = "" }: { className?: string }) {
  const { ref, shown } = useInView<HTMLDivElement>(0.35);
  return (
    <div ref={ref} className={className}>
      <PhoneFrame label="화면 예시: 두 사람의 편지가 함께 열린 순간">
        <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground"><span>09:42</span><span className="tracking-[0.14em]">DAY 02</span></div>
        <p className="mt-4 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-accent"><LockOpen size={11} />함께 열렸어요</p>
        <p className="text-ink mt-1.5 text-[15px] font-semibold leading-snug">당신의 말이 궁금해졌어요</p>
        <div className="mt-4 space-y-2.5">
          {[["나", "primary", "어제 말한 빵집, 저도 꼭 가 보고 싶어요. 아침에 가면 줄이 없나요?"], ["지", "accent", "평일 아침이면 바로 들어가요. 소금빵이 제일 먼저 나와요."]].map(([who, tone, text], index) => (
            <div key={who} className={`flex items-start gap-2 transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none ${index === 1 ? "flex-row-reverse text-right" : ""} ${shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`} style={{ transitionDelay: `${index * 260}ms` }}>
              <Avatar initial={who} tone={tone as "primary" | "accent"} size="size-8" />
              <p className={`rounded-2xl px-3 py-2 text-[11px] leading-5 ${index === 1 ? "bg-[linear-gradient(140deg,color-mix(in_oklch,var(--accent)_12%,var(--card)),var(--card))]" : "bg-[linear-gradient(140deg,color-mix(in_oklch,var(--primary)_12%,var(--card)),var(--card))]"} border border-border`}>{text}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[10px] text-muted-foreground">두 분 모두 보내면, 같은 순간에 열려요</p>
      </PhoneFrame>
    </div>
  );
}

// 큰 숫자 띠
const NUMBERS = [
  { big: "1명", label: "한 번에 한 사람", note: "여러 명과 동시에 연락하지 않아요" },
  { big: "12:00", label: "같은 순간에 도착", note: "두 분에게 정오에 함께" },
  { big: "3일", label: "얼굴 보기 전 대화", note: "편지 또는 ‘첫 장면’으로" },
  { big: "D-day", label: "번호는 만나는 날에만", note: "두 분이 모두 동의할 때" },
];
export function NumberBand() {
  return (
    <dl className="relative mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border bg-border lg:grid-cols-4">
      {NUMBERS.map(item => (
        <div key={item.big} className="relative flex flex-col bg-card p-6 sm:p-7">
          <dt className="order-2 mt-3 text-sm font-semibold">{item.label}</dt>
          <dd className={`order-1 text-[34px] font-semibold leading-none tracking-tight sm:text-[40px] ${gradientText}`}>{item.big}</dd>
          <dd className="order-3 mt-1.5 text-xs leading-5 text-muted-foreground">{item.note}</dd>
        </div>
      ))}
    </dl>
  );
}

// 한눈에 보는 흐름(THE JOURNEY)
const FLOW = [
  { n: "01", meta: "무료 · 약 15분", title: "소개 신청", body: "가입하고 신청서와 사진 3장을 적어요. 단계마다 저장돼서 나눠 써도 돼요." },
  { n: "02", meta: "사람이 직접", title: "운영진 확인", body: "사진과 신청서를 운영진이 하나하나 읽고, 잘 맞을 분을 찾아요." },
  { n: "03", meta: "12:00", title: "정오에 한 분 소개", body: "상대의 사진과 프로필이 함께 도착해요. 다음 날 오전 11시까지 답해요.", key: "breathe" },
  { n: "04", meta: "두 분 모두일 때만", title: "서로 선택", body: "한 분이라도 넘기면 조용히 마무리돼요. 누가 넘겼는지는 알리지 않아요." },
  { n: "05", meta: "DAY 01—03", title: "3일 교류", body: "편지 또는 ‘첫 장면’ 중 함께 고른 방식으로. 두 분이 모두 보내야 함께 열려요.", key: "soft" },
  { n: "06", meta: "DAY 04", title: "만남 선택", body: "만나고 싶은지 각자 골라요. 상대의 답은 알려 주지 않아요." },
  { n: "07", meta: "만나는 날", title: "약속 · 연락처", body: "날짜와 장소를 함께 정하고, 번호는 만나는 날에만 서로 보여요.", key: "soft" },
] as const;
function JourneyCard({ step, index, align, shown }: { step: (typeof FLOW)[number]; index: number; align: "left" | "right"; shown: boolean }) {
  const warm = index < 4;
  const strong = "key" in step;
  return (
    <div className={`relative rounded-2xl border p-5 transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none sm:p-6 ${strong ? "border-primary/25 shadow-[0_22px_44px_-30px_color-mix(in_oklch,var(--primary)_70%,transparent)]" : "border-border/70"} ${warm ? "bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_9%,var(--card)),var(--card)_58%)]" : "bg-[linear-gradient(135deg,color-mix(in_oklch,var(--accent)_9%,var(--card)),var(--card)_58%)]"} ${align === "right" ? "sm:text-right" : ""} ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`} style={{ transitionDelay: `${index * 110}ms` }}>
      <p className={`flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.14em] ${warm ? "text-primary" : "text-accent"} ${align === "right" ? "sm:justify-end" : ""}`}>STEP {step.n}<span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-normal ${warm ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"}`}>{step.meta}</span></p>
      <p className="text-ink mt-2.5 text-lg font-semibold leading-snug">{step.title}</p>
      <p className="mt-2 text-sm leading-[1.85] text-muted-foreground">{step.body}</p>
    </div>
  );
}
export function Journey() {
  const { ref, shown } = useInView<HTMLOListElement>(0.08);
  return (
    <div className="relative mt-20 border-t border-border pt-16 sm:mt-24 sm:pt-20">
      <Glow className="left-[-12%] top-24 size-[420px]" />
      <Glow tone="accent" className="bottom-10 right-[-10%] size-[460px]" />
      <div className="mx-auto max-w-xl text-center">
        <p className="text-[11px] font-semibold tracking-[0.24em] text-accent">THE JOURNEY</p>
        <h3 className="text-ink mt-4 text-[26px] font-semibold leading-[1.45] sm:text-[32px]">신청부터 만남까지,<br /><span className={gradientText}>한눈에 볼게요.</span></h3>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">한 번에 한 분만 소개해요. 서로 선택해 교류하는 동안에는 새 소개를 멈추고, 마무리되면 다음 분을 소개해요.</p>
      </div>
      <ol ref={ref} className="relative mx-auto mt-14 max-w-3xl">
        <span aria-hidden="true" className={`absolute bottom-6 left-[19px] top-6 w-px origin-top bg-[linear-gradient(to_bottom,color-mix(in_oklch,var(--primary)_55%,transparent),color-mix(in_oklch,var(--accent)_45%,transparent))] transition-transform duration-[1800ms] ease-out motion-reduce:transition-none sm:left-1/2 sm:-translate-x-1/2 ${shown ? "scale-y-100" : "scale-y-0"}`} />
        {FLOW.map((step, index) => {
          const left = index % 2 === 0;
          const kind = "key" in step ? step.key : null;
          return (
            <li key={step.n} className="relative grid grid-cols-[40px_1fr] items-center gap-x-4 pb-6 last:pb-0 sm:-mt-14 sm:grid-cols-[1fr_40px_1fr] sm:gap-x-8 sm:pb-0 sm:first:mt-0">
              <div className="hidden sm:block">{left && <JourneyCard step={step} index={index} align="right" shown={shown} />}</div>
              <span className="relative z-10 mx-auto flex size-10 items-center justify-center">
                {kind === "breathe" && <span aria-hidden="true" className="journey-ring absolute inset-0 rounded-full bg-primary/30" />}
                <span className={`relative flex items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${kind === "breathe" ? "journey-breathe size-10 text-xs" : kind === "soft" ? "size-9 bg-accent text-white shadow-[0_8px_20px_-10px_var(--accent)]" : "size-8 bg-card text-primary ring-1 ring-primary/25"}`}>{step.n}</span>
              </span>
              <div className="sm:hidden"><JourneyCard step={step} index={index} align="left" shown={shown} /></div>
              <div className="hidden sm:block">{!left && <JourneyCard step={step} index={index} align="left" shown={shown} />}</div>
            </li>
          );
        })}
      </ol>
      <div className="mt-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-3"><ApplyButton /><Link to="/faq" className={`text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline ${interaction}`}>자주 묻는 질문 보기</Link></div>
    </div>
  );
}

// 비교해 보세요(다른 서비스 이름은 쓰지 않고, 일반적인 방식만 비교)
const COMPARE = [
  { row: "누가 고르나요", app: "내가 넘기며 직접", agency: "매니저가 조건 위주로", us: "운영진이 신청서를 읽고 한 분" },
  { row: "동시에 몇 명과", app: "여러 명과 동시에", agency: "일정에 따라 여러 번", us: "한 번에 한 분" },
  { row: "첫 대화", app: "바로 채팅", agency: "바로 만남 약속", us: "3일 동안 편지·첫 장면" },
  { row: "연락처는 언제", app: "대화하며 직접 교환", agency: "매니저가 전달", us: "둘 다 원하면 만나는 날에만" },
  { row: "비용", app: "월 구독·유료 아이템", agency: "가입비 수십만~수백만 원", us: BETA ? "지금은 베타라 무료" : "소개 1만 원 · 교류 2.9만 원" },
];
export function CompareTable() {
  return (
    <div className="relative mt-20 sm:mt-24">
      <div className="mx-auto max-w-xl text-center">
        <p className="text-[11px] font-semibold tracking-[0.24em] text-accent">WHY BEFORE US</p>
        <h3 className="text-ink mt-4 text-[26px] font-semibold leading-[1.45] sm:text-[32px]">비교해 보세요</h3>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">앱은 너무 가볍고, 결혼정보회사는 너무 무거웠다면.</p>
      </div>
      <div className="mx-auto mt-10 max-w-4xl overflow-hidden rounded-3xl border border-border bg-card">
        <div className="grid grid-cols-[86px_repeat(3,1fr)] text-[11px] font-semibold sm:grid-cols-[150px_repeat(3,1fr)] sm:text-xs">
          <span className="border-b border-border p-3 sm:p-4" />
          <span className="border-b border-border p-3 text-center text-muted-foreground sm:p-4">소개팅 앱</span>
          <span className="border-b border-border p-3 text-center text-muted-foreground sm:p-4">결혼정보회사</span>
          <span className="border-b border-primary/20 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--primary)_14%,var(--card)),color-mix(in_oklch,var(--primary)_7%,var(--card)))] p-3 text-center text-primary sm:p-4">비포어스</span>
          {COMPARE.map((item, index) => {
            const last = index === COMPARE.length - 1;
            const line = last ? "" : "border-b border-border";
            return [
              <span key={`${item.row}-r`} className={`${line} flex items-center p-3 text-[11px] font-semibold sm:p-4 sm:text-xs`}>{item.row}</span>,
              <span key={`${item.row}-a`} className={`${line} flex items-center justify-center p-3 text-center text-[11px] font-normal leading-5 text-muted-foreground sm:p-4 sm:text-[13px]`}>{item.app}</span>,
              <span key={`${item.row}-b`} className={`${line} flex items-center justify-center p-3 text-center text-[11px] font-normal leading-5 text-muted-foreground sm:p-4 sm:text-[13px]`}>{item.agency}</span>,
              <span key={`${item.row}-c`} className={`${last ? "" : "border-b border-primary/10"} flex items-center justify-center gap-1.5 bg-[color-mix(in_oklch,var(--primary)_7%,var(--card))] p-3 text-center text-[11px] font-semibold leading-5 text-ink sm:p-4 sm:text-[13px]`}><Check size={13} className="hidden shrink-0 text-primary sm:block" />{item.us}</span>,
            ];
          })}
        </div>
      </div>
      <p className="mx-auto mt-3 max-w-4xl text-center text-[11px] text-muted-foreground">일반적인 이용 방식을 비교한 것으로, 서비스마다 다를 수 있어요.</p>
    </div>
  );
}

// 요금: 비용이 드는 순간은, 딱 두 번.
export function PriceTwice() {
  const cards = [
    { step: "01", when: "소개를 받을 때", price: money(BEFORE_US.pricing.introduction), unit: "", points: ["한 번 내면 최대 5번 소개", "첫 프로필을 열기 전 취소하면 전액 환불"], tone: "primary" as const },
    { step: "02", when: "두 분이 교류를 시작할 때만", price: money(BEFORE_US.pricing.exchangePerPerson), unit: "1인", points: ["두 분 모두 원할 때만 3일 교류", "열리지 않은 날은 돌려드려요"], tone: "accent" as const },
  ];
  return (
    <div className="relative mt-10">
      <p className="text-[11px] font-semibold tracking-[0.2em] text-accent">HOW MUCH, WHEN</p>
      <h3 className="text-ink mt-3 text-2xl font-semibold leading-[1.45] sm:text-[28px]">비용이 드는 순간은,<br /><span className={gradientText}>딱 두 번.</span></h3>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {cards.map(card => (
          <div key={card.step} className="relative isolate overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-[0_30px_60px_-44px_color-mix(in_oklch,var(--primary)_80%,transparent)] sm:p-7">
            <Glow tone={card.tone} className="-right-16 -top-16 size-56" />
            {BETA && <span className="absolute right-[-46px] top-[18px] w-44 rotate-45 bg-[linear-gradient(90deg,var(--primary),var(--accent))] py-1.5 text-center text-[10px] font-semibold tracking-[0.08em] text-white shadow-md">베타 무료</span>}
            <p className={`text-[11px] font-semibold tracking-[0.16em] ${card.tone === "primary" ? "text-primary" : "text-accent"}`}>{card.step} · {card.when}</p>
            <p className={`mt-5 whitespace-nowrap text-[34px] font-semibold leading-none tracking-tight tabular-nums ${gradientText}`}>{card.price}{card.unit && <span className="ml-1.5 align-middle text-sm font-medium text-muted-foreground [-webkit-text-fill-color:currentColor]">/ {card.unit}</span>}</p>
            <ul className="mt-5 space-y-2 border-t border-border pt-4">{card.points.map(point => <li key={point} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Check size={13} className={`mt-0.5 shrink-0 ${card.tone === "primary" ? "text-primary" : "text-accent"}`} />{point}</li>)}</ul>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">{["신청 무료", "검토 무료", "기다리는 동안 무료", "만남 무료", "월정액 없음", "자동 결제 없음"].map(chip => <span key={chip} className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground"><Check size={11} className="mr-1 inline text-primary" />{chip}</span>)}</div>
      {BETA && <p className="mt-4 text-xs leading-6 text-muted-foreground">위 금액은 정식 운영 기준이에요. 지금은 베타라 모두 무료이고, 바뀌기 7일 전에 메일로 알려 드려요.</p>}
    </div>
  );
}

// 안심 기준(OUR STANDARDS) + 매너 규칙
const STANDARDS = [
  { n: "01", title: "운영진이 직접 확인", body: "사진과 신청서를 사람이 읽고 승인해요" },
  { n: "02", title: "연락처·링크 자동 차단", body: "편지와 약속에서 번호·SNS·계좌는 막혀요" },
  { n: "03", title: "번호는 만나는 날만", body: "두 분이 동의할 때, 그날과 다음 날만" },
  { n: "04", title: "신고·차단 즉시", body: "누르는 순간 교류가 멈추고 운영진이 확인해요" },
];
const POINTS = [{ x: 12.5, y: 64 }, { x: 37.5, y: 33 }, { x: 62.5, y: 33 }, { x: 87.5, y: 64 }];
export function Standards() {
  const { ref, shown } = useInView<HTMLDivElement>(0.25);
  return (
    <div ref={ref} className="relative">
      <p className="text-[11px] font-semibold tracking-[0.24em] text-accent">OUR STANDARDS</p>
      <h3 className="text-ink mt-3 text-2xl font-semibold leading-[1.45] sm:text-[28px]">안심하고 알아가도록,<br /><span className={gradientText}>네 가지를 지켜요.</span></h3>
      <div className="relative mt-8 hidden h-28 sm:block" aria-hidden="true">
        <svg viewBox="0 0 1000 120" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible"><path d="M 0 110 Q 500 -40 1000 110" fill="none" stroke="url(#standards-line)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeDasharray="1400" strokeDashoffset={shown ? 0 : 1400} style={{ transition: "stroke-dashoffset 1.8s ease-out" }} /><defs><linearGradient id="standards-line" x1="0" x2="1"><stop offset="0" stopColor="var(--primary)" stopOpacity="0.55" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0.55" /></linearGradient></defs></svg>
        {POINTS.map((point, index) => <span key={index} className={`absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-card text-[11px] font-semibold text-primary ring-1 ring-primary/30 shadow-[0_8px_18px_-10px_var(--primary)] transition-opacity duration-500 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`} style={{ left: `${point.x}%`, top: `${point.y}%`, transitionDelay: `${400 + index * 250}ms` }}>{STANDARDS[index].n}</span>)}
      </div>
      <ol className="mt-6 grid gap-4 sm:mt-2 sm:grid-cols-4 sm:gap-3">
        {STANDARDS.map(item => <li key={item.n} className="flex gap-3 sm:block sm:text-center"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-[11px] font-semibold text-primary ring-1 ring-primary/30 sm:hidden">{item.n}</span><div><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.body}</p></div></li>)}
      </ol>
      <div className="mt-8 rounded-3xl border border-border bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_6%,var(--card)),var(--card)_55%,color-mix(in_oklch,var(--accent)_6%,var(--card)))] p-6">
        <div className="grid grid-cols-3 gap-3 text-center">
          {[[CalendarX2, "노쇼"], [BadgeAlert, "거짓 정보"], [Link2Off, "외부 연락 유도"]].map(([Icon, label]) => {
            const Glyph = Icon as typeof CalendarX2;
            return <div key={label as string}><span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[linear-gradient(140deg,color-mix(in_oklch,var(--primary)_16%,var(--card)),color-mix(in_oklch,var(--accent)_12%,var(--card)))] text-primary"><Glyph size={20} strokeWidth={1.6} /></span><p className="mt-2.5 text-xs font-semibold">{label as string}</p></div>;
          })}
        </div>
        <p className="mt-5 text-center text-xs leading-6 text-muted-foreground">확인되면 이용이 제한돼요. 모든 제한에는 다시 검토를 요청할 수 있어요.</p>
      </div>
    </div>
  );
}

export { ApplyButton };
