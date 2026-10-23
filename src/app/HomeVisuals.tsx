import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowUpRight, BadgeAlert, CalendarHeart, CalendarX2, Check, Clock3, FileText, HeartHandshake, Link2Off, LockOpen, MessageCircleHeart, ShieldCheck, Siren, Smartphone, UserCheck } from "lucide-react";
import { Button } from "./components/ui/button";
import { BEFORE_US } from "./config";
import { LIVE } from "./backend/client";

// 홈의 시각 요소(2026-10-23 2차): 은색 틀의 휴대폰 화면 예시(일러스트 인물) · 큰 숫자 · 여정 · 비교 표 · 안심 기준(어두운 판) · 요금 단계.
// 참고: 토스(밝은 휴대폰 틀·살짝 기울임·긴 그림자), Linear(어두운 판·얇은 선 아이콘·은은한 빛), 요금표의 ‘떠오르는 추천 칸’.
// 움직임은 ‘움직임 줄이기’ 설정에서 멈춘다. 그림 속 인물·문장은 모두 가상의 화면 예시다.
const BETA = LIVE && BEFORE_US.beta.active;
const interaction = "transition-colors duration-200 motion-reduce:transition-none";
const money = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
const ApplyButton = ({ className = "" }: { className?: string }) => (
  <Button asChild className={`h-12 rounded-full px-7 ${interaction} ${className}`}><Link to="/apply">{BETA ? "베타 무료로 신청하기" : "소개 신청하기"} <ArrowUpRight size={16} /></Link></Button>
);

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

export function Glow({ className = "", tone = "primary" }: { className?: string; tone?: "primary" | "accent" }) {
  return <span aria-hidden="true" className={`pointer-events-none absolute -z-10 rounded-full blur-3xl ${tone === "primary" ? "bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_10%,transparent),transparent)]" : "bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--accent)_9%,transparent),transparent)]"} ${className}`} />;
}

// ── 일러스트 인물(사진 대신). 창가 빛이 드는 오후의 한 장면처럼, 표정은 눈웃음 정도로만.
function Portrait({ kind, className = "" }: { kind: "her" | "him"; className?: string }) {
  const her = kind === "her";
  const id = `portrait-${kind}`;
  return (
    <svg viewBox="0 0 200 240" className={className} role="img" aria-label="일러스트 인물(가상)">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={her ? "#F7E7E1" : "#E6ECF8"} /><stop offset="1" stopColor={her ? "#E7E1F7" : "#ECE6F7"} /></linearGradient>
        <linearGradient id={`${id}-top`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={her ? "#FBF7F1" : "#F4F2EC"} /><stop offset="1" stopColor={her ? "#EADFD2" : "#D9D6E4"} /></linearGradient>
      </defs>
      <rect width="200" height="240" fill={`url(#${id}-bg)`} />
      <rect x="118" y="18" width="62" height="96" rx="10" fill="#fff" opacity="0.45" />
      <rect x="126" y="26" width="46" height="80" rx="6" fill="#fff" opacity="0.35" />
      <circle cx="40" cy="44" r="22" fill="#fff" opacity="0.35" />
      {her ? <path d="M56 124 C52 72 74 44 100 44 C127 44 149 70 145 124 C143 162 154 190 140 206 L60 206 C46 190 58 162 56 124 Z" fill="#3E3046" /> : <path d="M66 104 C64 66 80 48 101 48 C124 48 138 66 136 102 C130 90 118 84 100 84 C84 84 72 92 66 104 Z" fill="#2F2B3D" />}
      <path d={her ? "M28 240 C32 200 66 184 100 184 C134 184 168 200 172 240 Z" : "M22 240 C28 198 62 180 100 180 C138 180 172 198 178 240 Z"} fill={`url(#${id}-top)`} />
      <rect x="88" y="146" width="24" height="42" rx="11" fill={her ? "#EFC7B3" : "#E5BBA4"} />
      <ellipse cx="100" cy="114" rx="30" ry="36" fill={her ? "#F6D5C3" : "#EDC6B0"} />
      {her ? <path d="M70 108 C71 76 89 64 104 65 C123 66 133 83 131 106 C121 93 106 86 89 92 C80 96 74 101 70 108 Z" fill="#3E3046" /> : <path d="M70 102 C70 74 86 60 102 60 C121 60 133 74 131 100 C122 90 110 86 98 88 C86 90 76 95 70 102 Z" fill="#2F2B3D" />}
      <path d="M85 116 q5 4 10 0 M105 116 q5 4 10 0" stroke="#7A5148" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <ellipse cx="83" cy="127" rx="6" ry="3.5" fill="#EE9F95" opacity="0.35" />
      <ellipse cx="117" cy="127" rx="6" ry="3.5" fill="#EE9F95" opacity="0.35" />
      <path d="M94 134 q6 4 12 0" stroke="#B9776C" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      {her && <circle cx="70" cy="124" r="2.4" fill="#F4E3B5" />}
    </svg>
  );
}

// 밝은 은색 휴대폰 틀(토스처럼 살짝 기울이고 길게 그림자)
function PhoneFrame({ children, label, tilt = "left", className = "" }: { children: ReactNode; label: string; tilt?: "left" | "right" | "none"; className?: string }) {
  const transform = tilt === "left" ? "[transform:perspective(1400px)_rotateY(-14deg)_rotateX(4deg)_rotateZ(2deg)]" : tilt === "right" ? "[transform:perspective(1400px)_rotateY(14deg)_rotateX(4deg)_rotateZ(-2deg)]" : "";
  return (
    <figure aria-label={label} className={`relative w-[252px] ${transform} ${className}`}>
      <div className="rounded-[2.75rem] bg-[linear-gradient(150deg,#FDFDFE,#E3E0EC_45%,#F4F3F8_70%,#CFCADB)] p-[7px] shadow-[40px_60px_90px_-40px_rgba(38,28,98,0.55),0_2px_0_rgba(255,255,255,0.9)_inset]">
        <div className="relative overflow-hidden rounded-[2.35rem] bg-card ring-1 ring-black/5">
          <span aria-hidden="true" className="absolute left-1/2 top-2.5 z-20 h-[18px] w-[76px] -translate-x-1/2 rounded-full bg-[#121019]" />
          {children}
        </div>
      </div>
    </figure>
  );
}

// ① 첫 화면: 정오에 도착한 소개(인물 그림이 크게)
export function NoonPhone({ className = "" }: { className?: string }) {
  return (
    <PhoneFrame label="화면 예시: 정오에 도착한 오늘의 인연(가상 인물)" className={className}>
      <div className="relative">
        <Portrait kind="her" className="block aspect-[5/6] w-full" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-5 pt-9 text-[10px] font-semibold text-[#2B2540]/70"><span>12:00</span><span className="tracking-[0.16em]">BEFORE US</span></div>
        <span className="absolute left-3 top-[3.7rem] rounded-full bg-white/75 px-2.5 py-1 text-[10px] font-semibold text-primary shadow-sm backdrop-blur">오늘의 인연 · 12:00</span>
        <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,rgba(30,22,52,0.62),transparent)] px-4 pb-3 pt-10 text-white"><p className="text-[17px] font-semibold leading-none">지윤, 29</p><p className="mt-1.5 text-[10px] text-white/85">마포구 · 디자인 · 산책을 좋아해요</p></div>
      </div>
      <div className="px-4 pb-5 pt-3.5">
        <p className="text-[11px] leading-5 text-muted-foreground">첫 마디</p>
        <p className="text-ink text-[12.5px] font-medium leading-5">“주말엔 동네 서점에서 한참 머물러요. 천천히 알아가고 싶어요.”</p>
        <div className="mt-3.5 grid grid-cols-[1fr_auto] gap-1.5"><span className="rounded-full bg-primary py-2.5 text-center text-[11px] font-semibold text-primary-foreground">알아가고 싶어요</span><span className="rounded-full bg-muted px-3.5 py-2.5 text-center text-[11px] text-muted-foreground">넘길게요</span></div>
        <p className="mt-2.5 text-center text-[10px] text-muted-foreground">내일 오전 11시까지 답해 주세요</p>
      </div>
    </PhoneFrame>
  );
}

// 첫 화면 휴대폰 옆에 뜨는 작은 안내(유리처럼)
export function FloatingNote({ icon, children, className = "" }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return <p className={`absolute z-20 flex items-center gap-2 rounded-2xl bg-white/85 px-3.5 py-2.5 text-[11px] font-semibold text-[#2B2540] shadow-[0_18px_40px_-18px_rgba(38,28,98,0.55)] backdrop-blur ${className}`}><span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</span>{children}</p>;
}

// ② 두 가지 시작: 두 사람이 모두 보내야 함께 열리는 편지
export function LetterPhone({ className = "" }: { className?: string }) {
  const { ref, shown } = useInView<HTMLDivElement>(0.35);
  return (
    <div ref={ref} className={className}>
      <PhoneFrame label="화면 예시: 두 사람의 편지가 함께 열린 순간(가상 인물)" tilt="right">
        <div className="bg-[linear-gradient(180deg,var(--mist),var(--card)_45%)] px-4 pb-5 pt-10">
          <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground"><span>DAY 02 · 09:42</span><LockOpen size={12} className="text-primary" /></div>
          <p className="text-ink mt-3 text-[15px] font-semibold leading-snug">두 분의 편지가<br />함께 열렸어요</p>
          <div className="mt-4 space-y-3">
            {[{ kind: "him" as const, name: "나", text: "어제 말한 빵집, 저도 가 보고 싶어요. 아침에 가면 줄이 없나요?" }, { kind: "her" as const, name: "지윤", text: "평일 아침이면 바로 들어가요. 소금빵이 제일 먼저 나와요." }].map((item, index) => (
              <div key={item.name} className={`flex items-end gap-2 transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none ${index === 1 ? "flex-row-reverse" : ""} ${shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`} style={{ transitionDelay: `${index * 320}ms` }}>
                <span className="size-8 shrink-0 overflow-hidden rounded-full ring-2 ring-white"><Portrait kind={item.kind} className="h-full w-full" /></span>
                <p className={`rounded-2xl px-3 py-2.5 text-[11px] leading-5 shadow-[0_10px_24px_-18px_rgba(38,28,98,0.6)] ${index === 1 ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-card text-foreground ring-1 ring-border"}`}>{item.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-[10px] text-muted-foreground">두 분 모두 보내면, 같은 순간에 열려요</p>
        </div>
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
          <dd className="order-1 text-[34px] font-semibold leading-none tracking-tight text-primary sm:text-[40px]">{item.big}</dd>
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
            <li key={step.n} className="relative grid grid-cols-[40px_1fr] items-center gap-x-4 pb-6 last:pb-0 sm:-mt-14 sm:grid-cols-[1fr_40px_1fr] sm:gap-x-8 sm:pb-0 sm:first:mt-0">
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
      <div className="mt-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-3"><ApplyButton /><Link to="/faq" className={`text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline ${interaction}`}>자주 묻는 질문 보기</Link></div>
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

// 안심 기준: 사이트에서 가장 어두운 판 하나로 확실히 대비(Linear처럼 얇은 선 아이콘 · 은은한 빛)
const STANDARDS = [
  { n: "01", icon: UserCheck, title: "운영진이 직접 확인", body: "사진과 신청서를 사람이 읽고 승인해요" },
  { n: "02", icon: ShieldCheck, title: "연락처·링크 자동 차단", body: "편지와 약속에서 번호·SNS·계좌는 막혀요" },
  { n: "03", icon: Smartphone, title: "번호는 만나는 날만", body: "두 분이 동의할 때, 그날과 다음 날만" },
  { n: "04", icon: Siren, title: "신고·차단 즉시", body: "누르는 순간 교류가 멈추고 운영진이 확인해요" },
];
const POINTS = [{ x: 12.5, y: 70 }, { x: 37.5, y: 34 }, { x: 62.5, y: 34 }, { x: 87.5, y: 70 }];
export function Standards() {
  const { ref, shown } = useInView<HTMLDivElement>(0.25);
  return (
    <div ref={ref} className="relative isolate mt-20 overflow-hidden rounded-[2rem] bg-[#15122A] px-6 py-14 text-white sm:px-12 sm:py-16">
      <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[-30%] -z-10 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(143,123,234,0.28),transparent)] blur-2xl" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07] [background-image:radial-gradient(rgba(255,255,255,0.9)_1px,transparent_1px)] [background-size:22px_22px]" />
      <div className="mx-auto max-w-xl text-center">
        <p className="text-[11px] font-semibold tracking-[0.28em] text-[#B9ABF2]">OUR STANDARDS</p>
        <h3 className="mt-4 text-[26px] font-semibold leading-[1.45] sm:text-[32px]">안심하고 알아가도록,<br />네 가지를 지켜요.</h3>
        <p className="mt-4 text-sm leading-7 text-white/60">소개부터 만나는 날까지, 비포어스가 대신 지키는 약속이에요.</p>
      </div>
      <div className="relative mx-auto mt-10 hidden h-24 max-w-4xl sm:block" aria-hidden="true">
        <svg viewBox="0 0 1000 120" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <defs><linearGradient id="standards-arc" x1="0" x2="1"><stop offset="0" stopColor="#8F7BEA" stopOpacity="0.15" /><stop offset="0.5" stopColor="#B9ABF2" stopOpacity="0.9" /><stop offset="1" stopColor="#7A9BF0" stopOpacity="0.15" /></linearGradient></defs>
          <path d="M 0 118 Q 500 -38 1000 118" fill="none" stroke="url(#standards-arc)" strokeWidth="6" opacity="0.25" vectorEffect="non-scaling-stroke" style={{ filter: "blur(4px)" }} strokeDasharray="1400" strokeDashoffset={shown ? 0 : 1400} />
          <path d="M 0 118 Q 500 -38 1000 118" fill="none" stroke="url(#standards-arc)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeDasharray="1400" strokeDashoffset={shown ? 0 : 1400} style={{ transition: "stroke-dashoffset 1.8s ease-out" }} />
        </svg>
        {POINTS.map((point, index) => <span key={index} className={`absolute flex size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#D9D0FF] shadow-[0_0_0_6px_rgba(185,171,242,0.16),0_0_22px_4px_rgba(185,171,242,0.55)] transition-opacity duration-500 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`} style={{ left: `${point.x}%`, top: `${point.y}%`, transitionDelay: `${500 + index * 260}ms` }} />)}
      </div>
      <ol className="relative mx-auto mt-8 grid max-w-4xl gap-3 sm:mt-4 sm:grid-cols-4">
        {STANDARDS.map((item, index) => {
          const Icon = item.icon;
          return (
            <li key={item.n} className={`rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none sm:text-center ${shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`} style={{ transitionDelay: `${700 + index * 180}ms` }}>
              <span className="flex size-10 items-center justify-center rounded-full border border-white/15 text-[#D9D0FF] sm:mx-auto"><Icon size={18} strokeWidth={1.4} /></span>
              <p className="mt-4 text-[10px] font-semibold tracking-[0.18em] text-white/45">STANDARD {item.n}</p>
              <p className="mt-1.5 text-[15px] font-semibold">{item.title}</p>
              <p className="mt-1.5 text-xs leading-5 text-white/55">{item.body}</p>
            </li>
          );
        })}
      </ol>
      <div className="relative mx-auto mt-10 max-w-4xl border-t border-white/10 pt-8">
        <div className="flex flex-col items-center justify-between gap-5 sm:flex-row">
          <p className="text-sm font-semibold">이런 행동은 바로 이용이 제한돼요</p>
          <div className="flex flex-wrap justify-center gap-2">{[{ icon: CalendarX2, label: "노쇼" }, { icon: BadgeAlert, label: "거짓 정보" }, { icon: Link2Off, label: "외부 연락 유도" }].map(({ icon: Icon, label }) => <span key={label} className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-xs text-white/85"><Icon size={14} strokeWidth={1.5} className="text-[#D9D0FF]" />{label}</span>)}</div>
        </div>
        <p className="mt-4 text-center text-[11px] text-white/45 sm:text-left">모든 제한에는 다시 검토를 요청할 수 있어요.</p>
      </div>
    </div>
  );
}

// 요금: 언제, 얼마인가요?(4단계 · 결제가 있는 두 단계만 짙게)
export function PriceSteps() {
  const steps = [
    { icon: FileText, when: "신청·검토", price: "무료", note: "가입·신청서·운영진 확인", paid: false },
    { icon: HeartHandshake, when: "소개 받기", price: money(BEFORE_US.pricing.introduction), note: "한 번 내면 최대 5번 소개", paid: true },
    { icon: MessageCircleHeart, when: "교류할 때만", price: money(BEFORE_US.pricing.exchangePerPerson), note: "1인 · 서로 선택한 뒤 3일", paid: true },
    { icon: CalendarHeart, when: "약속·만남", price: "무료", note: "비포어스에 내는 비용 없음", paid: false },
  ];
  return (
    <div className="mt-9 overflow-hidden rounded-3xl border border-border bg-card shadow-[0_30px_60px_-40px_color-mix(in_oklch,var(--primary)_55%,transparent)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6"><p className="text-ink text-[15px] font-semibold">언제, 얼마인가요?</p><span className="rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground">{BETA ? "지금은 베타 · 모두 무료" : "월정액 아님 · 자동 결제 없음"}</span></div>
      <ol className="relative grid sm:grid-cols-4">
        <span aria-hidden="true" className="absolute left-[12.5%] right-[12.5%] top-[46px] hidden border-t border-dashed border-primary/25 sm:block" />
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.when} className={`relative px-5 py-6 sm:px-4 sm:text-center ${index < steps.length - 1 ? "border-b border-border sm:border-b-0" : ""}`}>
              <div className="flex items-center gap-3 sm:flex-col sm:gap-0">
                <span className={`relative z-10 flex size-11 shrink-0 items-center justify-center rounded-full ${step.paid ? "bg-primary text-primary-foreground shadow-[0_10px_22px_-10px_var(--primary)]" : "bg-lilac text-primary"}`}><Icon size={19} strokeWidth={1.6} /></span>
                <div className="sm:mt-3"><p className="text-[10px] font-semibold tracking-[0.16em] text-accent">STEP 0{index + 1}</p><p className="mt-0.5 text-sm font-semibold">{step.when}</p></div>
              </div>
              <p className={`mt-4 whitespace-nowrap text-[24px] font-semibold leading-none tabular-nums lg:text-[26px] ${step.paid ? "text-ink" : "text-primary"}`}>{step.price}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{step.note}</p>
              {step.paid && BETA && <span className="mt-3 inline-block rounded-full bg-lilac px-2.5 py-1 text-[10px] font-semibold text-primary">베타 동안 무료</span>}
            </li>
          );
        })}
      </ol>
      <p className="flex items-start gap-2 border-t border-border bg-mist px-5 py-3.5 text-xs leading-6 text-muted-foreground sm:px-6"><Clock3 size={14} className="mt-1 shrink-0 text-primary" />{BETA ? "위 금액은 정식 운영 기준이에요. 베타 기간에는 소개도 교류도 무료이고, 바뀌기 7일 전에 메일로 알려 드려요. " : ""}월정액이 아니고 자동으로 결제되지 않아요. 소개비는 첫 상대 프로필을 열기 전에 취소하면 전액 돌려드려요.</p>
    </div>
  );
}

export { ApplyButton };
