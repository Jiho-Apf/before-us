import { useEffect, useState, type ReactNode } from "react";

// 정오의 서랍 · 고민 편지함이 함께 쓰는 조각(2026-11-03).
// 첫 화면처럼 잎 그림자 사진을 깔되, 보라 대신 종이색으로 덮어 ‘햇빛 드는 벽에 붙은 쪽지’처럼 보이게 한다.
export const LEAF_PHOTO = (w: number) => `https://images.unsplash.com/photo-1530651796427-6edd0e06319e?auto=format&fit=crop&w=${w}&q=75`;
export const interaction = "transition-colors duration-200 motion-reduce:transition-none";
// 사진 위 쪽지(첫 화면 편지 말풍선과 같은 유리 질감)
export const SLIP = "bg-white/85 ring-1 ring-white/80 backdrop-blur-xl shadow-[0_24px_50px_-28px_rgba(40,24,100,0.45)] dark:bg-[#211E36]/85 dark:ring-white/10";

export function PaperBackdrop({ tint = "paper" }: { tint?: "paper" | "butter" }) {
  const fade = tint === "butter" ? "#FBF7EA" : "#F7F5EF";
  const night = "var(--background)";
  // 휴대폰: 사진이 아래쪽에 깔리고 위에서 종이색으로 덮는다 · 넓은 화면: 사진이 오른쪽 70%, 왼쪽에서 덮는다. 사진이 시작하는 곳은 덮개가 완전히 가린다.
  const down = (color: string) => `linear-gradient(to bottom, ${color} 0%, color-mix(in oklch, ${color} 55%, transparent) 22%, transparent 48%)`;
  const side = (color: string, strength: number) => `linear-gradient(90deg, ${color} 0%, ${color} 31%, color-mix(in oklch, ${color} ${strength}%, transparent) 44%, color-mix(in oklch, ${color} ${Math.round(strength / 2.7)}%, transparent) 62%, transparent 80%)`;
  return <>
    <div aria-hidden="true" className="absolute inset-0 -z-30 dark:!bg-background" style={{ background: fade }} />
    <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-20 h-[560px] sm:h-[620px] lg:inset-y-0 lg:left-[30%] lg:h-auto">
      <img src={LEAF_PHOTO(1600)} srcSet={`${LEAF_PHOTO(900)} 900w, ${LEAF_PHOTO(1600)} 1600w, ${LEAF_PHOTO(2400)} 2400w`} sizes="(min-width: 1024px) 70vw, 100vw" alt="" decoding="async" className="h-full w-full object-cover object-[50%_45%] opacity-70 mix-blend-multiply dark:opacity-25 dark:mix-blend-soft-light" />
    </div>
    <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-[560px] sm:h-[620px] lg:hidden dark:hidden" style={{ backgroundImage: down(fade) }} />
    <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 hidden h-[560px] sm:h-[620px] dark:block lg:dark:hidden" style={{ backgroundImage: down(night) }} />
    <div aria-hidden="true" className="absolute inset-0 -z-10 hidden lg:block lg:dark:hidden" style={{ backgroundImage: side(fade, 82) }} />
    <div aria-hidden="true" className="absolute inset-0 -z-10 hidden lg:dark:block" style={{ backgroundImage: side(night, 70) }} />
  </>;
}
export function Wave() {
  return <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-14 w-full fill-background sm:h-20" viewBox="0 0 1200 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 68 C300 -20 700 122 1200 28 L1200 100 L0 100 Z" /></svg>;
}

// 첫 화면과 같은 머리말: "01 ── 오늘의 답  TODAY'S ANSWERS"
export function SectionLabel({ number, ko, children }: { number: string; ko: string; children: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2"><span className="text-xs font-semibold tabular-nums text-accent">{number}</span><span aria-hidden="true" className="h-px w-8 bg-accent/40" /><span className="text-xs font-semibold">{ko}</span><span className="text-[10px] tracking-[0.16em] text-muted-foreground">{children}</span></div>;
}

// 별명 도장: 별명의 마지막 낱말 첫 글자 · 별명마다 정해진 은은한 색(사람이 여럿이라는 게 한눈에 보이게)
const SEALS = [
  "bg-[#EEEAF8] text-[#5B4FCF] dark:bg-[#5B4FCF]/25 dark:text-[#CFC8F5]",
  "bg-[#FBF0CF] text-[#7A5A12] dark:bg-[#F3D98A]/20 dark:text-[#F3D98A]",
  "bg-[#E3EBDD] text-[#3D5A35] dark:bg-[#9DBB8F]/20 dark:text-[#BFD8B2]",
  "bg-[#E3EAF8] text-[#3560C0] dark:bg-[#3560C0]/25 dark:text-[#B9CBF2]",
  "bg-[#F6E5E1] text-[#8E4B3F] dark:bg-[#E3A799]/20 dark:text-[#EBC1B6]",
];
const hash = (text: string) => Array.from(text).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
export function AliasSeal({ alias, size = "md" }: { alias: string; size?: "sm" | "md" }) {
  const word = alias.split(" ").pop() ?? alias;
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full font-semibold ${size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs"} ${SEALS[hash(alias) % SEALS.length]}`}>{word.slice(0, 1)}</span>;
}

export const kstClock = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
export const kstMonthDay = (iso: string) => { const date = new Date(new Date(iso).getTime() + 9 * 3600000); return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`; };
// "방금 · 12분 전 · 3시간 전 · 11월 2일"
export function ago(iso: string) {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}시간 전`;
  return kstMonthDay(iso);
}

export function useMessage() {
  const [message, setMessage] = useState("");
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(""), 3500); return () => window.clearTimeout(timer); }, [message]);
  return [message, setMessage] as const;
}

// 다음 정오까지(초 단위). 서랍의 새 질문, 편지 도착을 함께 센다.
export function useNoonCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const kst = new Date(now + 9 * 3600000);
  const noon = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 12) - 9 * 3600000;
  const left = Math.max(0, Math.floor(((now < noon ? noon : noon + 86400000) - now) / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return { left, text: `${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`, filled: Math.max(0, Math.round((1 - left / 86400) * 1000) / 10) };
}

// 신고: 한 번 더 묻고 보낸다.
export function ReportButton({ onReport }: { onReport: () => Promise<string> }) {
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState("");
  if (done) return <span className="text-[11px] text-muted-foreground">{done}</span>;
  if (!asking) return <button type="button" onClick={() => setAsking(true)} className={`text-[11px] text-muted-foreground hover:text-foreground ${interaction}`}>신고</button>;
  return <span className="inline-flex items-center gap-2 text-[11px]"><span className="text-muted-foreground">신고할까요?</span><button type="button" onClick={async () => setDone(await onReport())} className="text-[11px] font-semibold text-destructive">신고하기</button><button type="button" onClick={() => setAsking(false)} className="text-[11px] text-muted-foreground">취소</button></span>;
}

// 마음이 많이 힘든 글을 위한 안내(고민 편지함 쓰기 옆 · 편지함 아래)
export function CrisisNote({ className = "" }: { className?: string }) {
  return <p className={`text-[11px] leading-5 text-muted-foreground ${className}`}>혼자 견디기 어려운 마음이라면 지금 바로 이야기해 주세요. <span className="font-semibold text-foreground/80">자살예방상담전화 109</span> · <span className="font-semibold text-foreground/80">정신건강위기상담 1577-0199</span>에서 24시간 들어 줘요.</p>;
}
