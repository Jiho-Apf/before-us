import { useEffect, useState } from "react";
import { TwoDots } from "./editorial";
import { rpc } from "./backend/client";
import { kstDay } from "./dates";
import { BEFORE_US } from "./config";

// 이번 주 노트(5200): 운영진이 일주일에 한 번쯤 남기는 짧은 글. 14일 안에 쓴 가장 최근 것 하나만, 회원 오늘 화면에 조용히 보인다.
// 사람이 직접 읽고 고른다는 걸 느끼게 하는 자리라 숫자·현황은 쓰지 않는다. 없으면 아무것도 그리지 않는다.
export function WeeklyNote() {
  const [note, setNote] = useState<{ body: string; at: string } | null>(null);
  useEffect(() => { void rpc<{ body: string; at: string } | null>("current_note").then(result => setNote(result.data ?? null)); }, []);
  if (!note) return null;
  return <figure aria-label={`이번 주, ${BEFORE_US.brand.name}에서`} className="mt-10 grid gap-3 rounded-3xl border border-lilac bg-mist px-6 py-6 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-8 sm:px-8 sm:py-7">
    <figcaption className="flex items-center gap-2.5 self-start text-xs font-semibold text-accent sm:pt-1.5"><TwoDots />이번 주, {BEFORE_US.brand.name}에서</figcaption>
    <div className="min-w-0"><blockquote className="whitespace-pre-wrap text-[15px] leading-8 text-ink sm:text-base">{note.body}</blockquote><p className="mt-2 text-[11px] text-muted-foreground">{kstDay(note.at)}</p></div>
  </figure>;
}
