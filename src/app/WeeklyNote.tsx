import { useEffect, useState } from "react";
import { TwoDots } from "./editorial";
import { rpc } from "./backend/client";
import { kstDay } from "./dates";
import { BEFORE_US } from "./config";

// 플라비에서 온 소식(오늘 화면): 사람이 직접 쓴 것만 보인다. 없으면 아무것도 그리지 않는다.
//   이번 주 노트(5200): 운영진이 일주일에 한 번쯤 남기는 짧은 글. 14일 안에 쓴 가장 최근 것 하나.
//   신청서를 읽고(GPT 검수 F1): 승인할 때 운영진이 신청서에서 실제로 살펴본 부분을 한 문장으로 남긴 것. 자동 문장은 없다.
// 숫자·현황은 쓰지 않고, ‘운영진’이라고 밝히지 않는다(플라비의 목소리로).
type Note = { body: string; at: string };
function NoteFigure({ label, note }: { label: string; note: Note }) {
  return <figure aria-label={label} className="grid gap-3 rounded-3xl border border-lilac bg-mist px-6 py-6 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-8 sm:px-8 sm:py-7">
    <figcaption className="flex items-center gap-2.5 self-start text-xs font-semibold text-accent sm:pt-1.5"><TwoDots />{label}</figcaption>
    <div className="min-w-0"><blockquote className="whitespace-pre-wrap text-[15px] leading-8 text-ink sm:text-base">{note.body}</blockquote><p className="mt-2 text-[11px] text-muted-foreground">{kstDay(note.at)}</p></div>
  </figure>;
}

export function FlavieNews() {
  const [weekly, setWeekly] = useState<Note | null>(null);
  const [reading, setReading] = useState<Note | null>(null);
  useEffect(() => {
    void rpc<Note | null>("current_note").then(result => setWeekly(result.data ?? null));
    void rpc<Note | null>("my_reading_note").then(result => setReading(result.data ?? null));
  }, []);
  if (!weekly && !reading) return null;
  return <section aria-labelledby="news-title" className="mt-10">
    <h2 id="news-title" className="mb-4 text-sm font-semibold">{BEFORE_US.brand.name}에서 온 소식</h2>
    <div className="space-y-3">
      {reading && <NoteFigure label="신청서를 읽고" note={reading} />}
      {weekly && <NoteFigure label={`이번 주, ${BEFORE_US.brand.name}에서`} note={weekly} />}
    </div>
  </section>;
}

// 예전 이름(다른 화면에서 쓰던 것)
export const WeeklyNote = FlavieNews;
