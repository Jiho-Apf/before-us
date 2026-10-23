import { LockOpen } from "lucide-react";

// 첫 화면 오른쪽: 노을 하늘 위에 다은과 준호가 사흘(DAY 01~03) 동안 주고받은 편지(2026-10-23 사용자가 시안 5번 ‘편지 말풍선’을 고름).
// 참고: 메시지 앱의 말풍선. 다만 채팅이 아니라 하루 한 통씩 ‘함께 열린’ 편지라, 날마다 그날의 질문을 위에 둔다.
// 내용은 04 이야기의 다은·준호 이야기(home-story)와 맞춘다. 대화 전체가 한 덩어리로 천천히 떠 있다.
const INK = "text-[#221D3A]";
const GLASS = "bg-white/80 ring-1 ring-white/70 backdrop-blur-xl shadow-[0_24px_50px_-28px_rgba(40,24,100,0.55)]";
const NAME = "flex items-center gap-1.5 text-[11px] font-semibold text-white/90 [text-shadow:0_1px_8px_rgba(40,24,100,0.5)]";

const DAYS = [
  {
    day: "DAY 01",
    question: "편안하다고 느끼는 대화는?",
    her: "말이 끊겨도 어색하지 않은 대화요. 그런 대화는 오래 기억에 남더라고요.",
    him: "상대가 끝까지 말하게 기다려 주는 대화요. 우리 대화는 좀 느리겠네요.",
  },
  {
    day: "DAY 02",
    question: "쉬는 날 아침, 가장 먼저 하는 일은?",
    her: "창문을 열고 이불을 개요. 별것 없죠?",
    him: "그게 제일 어려운데요. 저는 일어나면 동네 빵집부터 가요.",
  },
  {
    day: "DAY 03",
    question: "최근에 오래 기억에 남은 문장은?",
    her: "엄마가 보낸 ‘밥은 먹었니’요. 평범한데 오래 남았어요.",
    him: "다은 씨 첫 편지의 ‘말이 끊겨도 어색하지 않은’이요.",
  },
] as const;

function DayChip({ day, question }: { day: string; question: string }) {
  return <p className={`mx-auto flex max-w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] font-medium ${INK} ${GLASS}`}><LockOpen size={12} className="shrink-0 text-primary" /><span className="shrink-0 font-semibold text-primary">{day}</span><span className="truncate">“{question}”</span></p>;
}

export function HeroLetters() {
  return (
    <div className="hero-float mx-auto flex w-full max-w-[420px] flex-col gap-2 pb-6 lg:ml-auto lg:mr-0 lg:pb-0" aria-label="화면 예시: 다은과 준호가 사흘 동안 주고받은 편지">
      {DAYS.map((item, index) => (
        <div key={item.day} className={`flex flex-col gap-2 ${index ? "mt-2.5" : ""}`}>
          <DayChip day={item.day} question={item.question} />
          <div className="flex flex-col items-start gap-1.5">
            {index === 0 && <span className={`ml-3 ${NAME}`}><span className="size-1.5 rounded-full bg-white" />다은</span>}
            <p className={`max-w-[86%] rounded-[20px] rounded-tl-md px-4 py-2.5 text-[13.5px] leading-[1.6] ${INK} ${GLASS}`}>{item.her}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {index === 0 && <span className={`mr-3 ${NAME}`}>준호<span className="size-1.5 rounded-full bg-white" /></span>}
            <p className="max-w-[86%] rounded-[20px] rounded-tr-md bg-primary px-4 py-2.5 text-[13.5px] leading-[1.6] text-white shadow-[0_24px_48px_-24px_rgba(60,40,160,0.8)]">{item.him}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
