import { Check, Heart, LockOpen, MessageCircle } from "lucide-react";

// 첫 화면 오른쪽 시안(2026-10-23, 사용자가 고르기 전 비교용). 개발 화면에서 주소 끝에 ?hero=1~6 을 붙이면 바꿔 볼 수 있다.
// 참고: 토스·캄·타임레프트(사진 위에 거의 아무것도 얹지 않음), 아이폰 잠금 화면 알림, 힌지의 질문 카드,
// 리니어의 한 장짜리 진행 패널, 메시지 앱의 말풍선, 소개 앱의 프로필 카드.
const INK = "text-[#221D3A]";
const GLASS = "bg-white/80 ring-1 ring-white/70 backdrop-blur-xl shadow-[0_30px_60px_-30px_rgba(40,24,100,0.55)]";
const SOLID = "bg-white ring-1 ring-black/[0.04] shadow-[0_34px_64px_-32px_rgba(40,24,100,0.6)]";
const Dots = ({ size = "size-1.5" }: { size?: string }) => <span aria-hidden="true" className="flex gap-1"><span className={`${size} rounded-full bg-primary`} /><span className={`${size} rounded-full bg-accent`} /></span>;

// 1 · 사진만(토스·캄·타임레프트): 오른쪽은 사진에 맡기고, 아래에 한 줄 설명만
function PhotoOnly() {
  return (
    <div className="flex h-[300px] items-end justify-end sm:h-[360px] lg:h-[520px]">
      <p className={`flex items-center gap-2.5 rounded-full px-4 py-2.5 text-[12px] font-medium ${INK} ${GLASS}`}><Dots />DAY 01—03 · 편지 나누기 또는 첫 장면 만들기</p>
    </div>
  );
}

// 2 · 알림 쌓기(아이폰 잠금 화면): 사흘 동안 받게 될 알림이 하늘 위에 차곡차곡
const NOTES = [
  { when: "12:00", title: "오늘의 인연이 도착했어요", body: "운영진이 고른 한 분의 이야기가 열렸어요." },
  { when: "DAY 01 · 21:14", title: "두 통의 편지가 함께 열렸어요", body: "“당신의 하루에서 가장 좋아하는 순간은?”" },
  { when: "DAY 02 · 18:30", title: "같은 장면을 골랐어요", body: "조용한 동네를 함께 걷기" },
];
function NotificationStack() {
  return (
    <div className="relative mx-auto flex w-full max-w-[380px] flex-col gap-3 pb-6 lg:ml-auto lg:mr-0 lg:pb-0">
      {NOTES.map((note, index) => (
        <div key={note.title} className={`hero-float rounded-[22px] p-4 ${INK} ${GLASS} ${index === 1 ? "lg:-translate-x-8" : ""}`} style={{ animationDelay: `${-index * 2}s` }}>
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-[#EEEAFA]"><Dots /></span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center justify-between text-[10px] font-semibold tracking-[0.14em] text-[#221D3A]/50"><span>BEFORE US</span><span className="tracking-normal tabular-nums">{note.when}</span></p>
              <p className="mt-1 text-[14px] font-semibold">{note.title}</p>
              <p className="mt-0.5 truncate text-[12px] text-[#221D3A]/60">{note.body}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// 3 · 질문 카드(힌지): 흰 카드에 작은 질문, 큰 답. 꾸밈 없이 글로만
function PromptCards() {
  return (
    <div className="relative mx-auto h-[400px] w-full max-w-[420px] sm:h-[420px] lg:ml-auto lg:mr-0">
      <article className={`hero-float absolute right-0 top-0 w-[86%] rounded-[24px] p-6 ${INK} ${SOLID}`}>
        <p className="text-[12px] font-medium text-[#221D3A]/55">DAY 01 · 오늘의 질문</p>
        <p className="mt-1 text-[13px] font-semibold text-primary">당신의 하루에서 가장 좋아하는 순간은?</p>
        <p className="mt-4 text-[22px] font-semibold leading-[1.45] tracking-[-0.01em]">퇴근길 버스에서,<br />창밖이 주황빛으로 바뀌는 오 분.</p>
        <div className="mt-5 flex items-center justify-between"><span className="text-[11px] text-[#221D3A]/45">편지 나누기</span><span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary"><MessageCircle size={16} /></span></div>
      </article>
      <article className={`hero-float hero-float-late absolute bottom-0 left-0 w-[76%] rounded-[24px] p-5 ${INK} ${SOLID}`}>
        <p className="text-[12px] font-medium text-[#221D3A]/55">DAY 02 · 함께 고른 첫 장면</p>
        <p className="mt-3 text-[19px] font-semibold leading-[1.4]">조용한 동네를 함께 걷기</p>
        <div className="mt-4 flex items-center justify-between"><span className="text-[11px] text-[#221D3A]/45">첫 장면 만들기</span><span className="flex size-9 items-center justify-center rounded-full bg-primary text-white"><Heart size={15} fill="currentColor" /></span></div>
      </article>
    </div>
  );
}

// 4 · 진행 패널(리니어): 유리 한 장에 사흘의 흐름, 지금 단계만 밝게
const STEPS = [
  { at: "12:00", label: "정오의 소개", done: true },
  { at: "DAY 01", label: "편지 나누기", done: true },
  { at: "DAY 02", label: "첫 장면 만들기", now: true },
  { at: "DAY 03", label: "마지막 편지" },
  { at: "DAY 04", label: "만남 의사 확인" },
];
function JourneyPanel() {
  return (
    <div className="mx-auto w-full max-w-[380px] pb-6 lg:ml-auto lg:mr-0 lg:pb-0">
      <article className={`hero-float rounded-[26px] p-5 ${INK} ${GLASS}`}>
        <div className="flex items-center justify-between px-1"><p className="text-[13px] font-semibold">두 사람의 사흘</p><Dots /></div>
        <ol className="mt-4 space-y-1">
          {STEPS.map(step => (
            <li key={step.at} className={`flex items-center gap-3 rounded-2xl px-3 py-3 ${step.now ? "bg-white shadow-[0_10px_24px_-14px_rgba(40,24,100,0.5)]" : ""}`}>
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${step.done ? "bg-primary text-white" : step.now ? "ring-2 ring-primary" : "ring-1 ring-[#221D3A]/15"}`}>{step.done ? <Check size={12} strokeWidth={3} /> : step.now ? <span className="size-2 rounded-full bg-primary" /> : null}</span>
              <span className="w-14 text-[11px] font-semibold tracking-[0.06em] text-[#221D3A]/45 tabular-nums">{step.at}</span>
              <span className={`text-[14px] ${step.now ? "font-semibold text-primary" : step.done ? "font-medium" : "text-[#221D3A]/50"}`}>{step.label}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 px-1 text-[11px] text-[#221D3A]/50">두 분이 모두 보내야 다음 날로 넘어가요.</p>
      </article>
    </div>
  );
}

// 5 · 말풍선(메시지 앱, 대신 편지): 두 사람의 짧은 편지가 하늘에 나란히
function LetterBubbles() {
  return (
    <div className="mx-auto flex w-full max-w-[400px] flex-col gap-3 pb-6 lg:ml-auto lg:mr-0 lg:pb-0">
      <p className={`mx-auto flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] font-medium ${INK} ${GLASS}`}><LockOpen size={12} className="text-primary" />DAY 01 · 두 통이 함께 열렸어요</p>
      <div className="hero-float flex flex-col items-start gap-1.5">
        <span className="ml-3 flex items-center gap-1.5 text-[11px] font-semibold text-white/90 [text-shadow:0_1px_8px_rgba(40,24,100,0.5)]"><span className="size-1.5 rounded-full bg-white" />다은</span>
        <p className={`max-w-[86%] rounded-[22px] rounded-tl-md px-4 py-3 text-[14px] leading-[1.6] ${INK} ${GLASS}`}>말이 끊겨도 어색하지 않은 대화가 좋아요. 그런 대화는 오래 기억에 남더라고요.</p>
      </div>
      <div className="hero-float hero-float-late flex flex-col items-end gap-1.5">
        <span className="mr-3 flex items-center gap-1.5 text-[11px] font-semibold text-white/90 [text-shadow:0_1px_8px_rgba(40,24,100,0.5)]">준호<span className="size-1.5 rounded-full bg-white" /></span>
        <p className="max-w-[86%] rounded-[22px] rounded-tr-md bg-primary px-4 py-3 text-[14px] leading-[1.6] text-white shadow-[0_24px_48px_-24px_rgba(60,40,160,0.8)]">저도요. 그럼 우리 대화는 좀 느리겠네요.</p>
      </div>
    </div>
  );
}

// 6 · 프로필 카드(소개 앱): 사진은 흐리게 가려 두고 ‘정오에 함께 공개’, 첫 마디와 두 개의 선택
function ProfileCard() {
  return (
    <div className="mx-auto w-full max-w-[330px] pb-6 lg:ml-auto lg:mr-6 lg:pb-0">
      <article className={`hero-float overflow-hidden rounded-[28px] ${INK} ${SOLID}`}>
        <div className="relative h-[200px] overflow-hidden">
          <div aria-hidden="true" className="absolute inset-0 scale-125 bg-[radial-gradient(60%_70%_at_30%_30%,#F4C9D4,transparent),radial-gradient(60%_70%_at_75%_60%,#B9ABF2,transparent),linear-gradient(160deg,#EEE7FB,#DCD3F7)] blur-xl" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center"><span className="flex size-10 items-center justify-center rounded-full bg-white/70 backdrop-blur"><Dots /></span><p className="text-[13px] font-semibold text-[#221D3A]/80">사진은 정오에 함께 공개돼요</p></div>
          <span className="absolute left-4 top-4 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-semibold text-primary backdrop-blur">오늘의 인연 · 12:00</span>
        </div>
        <div className="p-5">
          <p className="text-[11px] font-medium text-[#221D3A]/50">첫 마디</p>
          <p className="mt-1.5 text-[15px] font-medium leading-[1.6]">“주말엔 동네 서점에서 한참 머물러요. 천천히 알아가고 싶어요.”</p>
          <div className="mt-4 grid grid-cols-[1fr_auto] gap-2 text-[12px]"><span className="rounded-full bg-primary py-2.5 text-center font-semibold text-white">알아가고 싶어요</span><span className="rounded-full bg-[#F1EFF7] px-4 py-2.5 text-[#221D3A]/60">넘길게요</span></div>
        </div>
      </article>
    </div>
  );
}

export const HERO_VARIANTS = [null, PhotoOnly, NotificationStack, PromptCards, JourneyPanel, LetterBubbles, ProfileCard] as const;
export function heroVariantFromUrl(): number {
  if (!import.meta.env.DEV || typeof window === "undefined") return 0;
  const n = Number(new URLSearchParams(window.location.search).get("hero"));
  return n >= 1 && n < HERO_VARIANTS.length ? n : 0;
}
