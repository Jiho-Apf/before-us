import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "./components/ui/button";
import { kstDay } from "./dates";
import { LIVE, rpc } from "./backend/client";
import { recruitingCohort, type CohortInfo } from "./cohort";

// 소개 신청을 마친 직후의 화면.
//  - 뒤에는 라벤더·푸른빛이 천천히 번지고, 내용은 위에서부터 한 줄씩 내려앉는다.
//  - 두 점이 가운데로 모인 뒤 잔잔한 물결이 한 번 퍼진다.
//  - 기수 카드는 그라데이션 테두리와 깊은 그림자, 한 번 지나가는 빛으로 ‘오늘의 약속’처럼 보이게.
//  - ‘동작 줄이기’ 설정이면 움직임 없이 바로 보인다(theme.css).
const STEPS = [
  { title: "운영진 확인", body: "사진과 이야기를 한 장씩 읽어요. 보완할 점이 있으면 오늘 화면에서 알려 드려요." },
  { title: "시작 전날 알림", body: "내 기수가 시작하기 하루 전, 내일 정오에 첫 소개가 온다고 알려 드려요." },
  { title: "정오의 첫 소개", body: "하루 최대 한 명. 두 분 모두 알아가고 싶다고 하면 3일이 시작돼요." },
];

export default function ApplicationComplete({ name }: { name?: string }) {
  const [cohort, setCohort] = useState<CohortInfo>(() => recruitingCohort());
  useEffect(() => {
    window.scrollTo(0, 0);
    if (!LIVE) return;
    void rpc<{ number: number; startsOn: string; applicationDeadline: string } | null>("my_cohort").then(({ data }) => { if (data) setCohort({ ...data, opensOn: null }); });
  }, []);
  const days = Math.max(0, Math.round((Date.parse(`${cohort.startsOn}T12:00:00+09:00`) - Date.now()) / 86400000));
  const delay = (index: number) => ({ animationDelay: `${index * 130}ms` });
  return (
    <section aria-labelledby="complete-title" className="relative isolate mx-auto flex w-full max-w-3xl flex-col items-center py-12 text-center break-keep sm:py-16">
      {/* 뒤에서 천천히 번지는 빛 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-[-30%] top-[-10%] -z-10 h-[620px]">
        <span className="complete-glow absolute left-[18%] top-[6%] size-[420px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_22%,transparent),transparent)]" />
        <span className="complete-glow complete-glow-late absolute right-[16%] top-[22%] size-[380px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--accent)_18%,transparent),transparent)]" />
      </div>

      <div className="drop-in" style={delay(0)} aria-hidden="true">
        <span className="relative flex h-10 w-44 items-center justify-center">
          <span className="complete-ripple absolute size-10 rounded-full border border-primary/40" />
          <span className="dot-meet-left absolute size-4 rounded-full bg-primary shadow-[0_0_18px_color-mix(in_oklch,var(--primary)_60%,transparent)]" />
          <span className="dot-meet-right absolute size-4 rounded-full bg-accent shadow-[0_0_18px_color-mix(in_oklch,var(--accent)_60%,transparent)]" />
        </span>
      </div>
      <p className="drop-in mt-9 text-xs font-semibold tracking-[0.24em] text-accent" style={delay(1)}>APPLICATION RECEIVED</p>
      <h1 id="complete-title" className="drop-in mt-5 text-3xl font-semibold leading-[1.4] text-ink sm:text-[42px]" style={delay(2)}>{name ? <>{name} 님의 신청을<br />잘 받았어요.</> : <>소개 신청을<br />잘 받았어요.</>}</h1>
      <p className="drop-in mt-5 max-w-md text-sm leading-7 text-muted-foreground" style={delay(3)}>운영진이 사진과 이야기를 한 장씩 읽고, 잘 맞는 분을 천천히 준비해 둘게요.</p>

      {/* 기수 카드: 그라데이션 테두리 + 깊은 그림자 + 한 번 지나가는 빛 */}
      <div className="drop-in mt-11 w-full max-w-sm" style={delay(4)}>
        <div className="complete-card rounded-[22px] bg-[linear-gradient(140deg,color-mix(in_oklch,var(--primary)_70%,transparent),color-mix(in_oklch,var(--accent)_45%,transparent)_45%,color-mix(in_oklch,var(--primary)_12%,transparent))] p-px shadow-[0_44px_80px_-28px_color-mix(in_oklch,var(--primary)_62%,transparent),0_18px_36px_-18px_color-mix(in_oklch,var(--accent)_40%,transparent)]">
          <div className="relative overflow-hidden rounded-[21px] bg-[linear-gradient(180deg,var(--card),color-mix(in_oklch,var(--lilac)_55%,var(--card)))] px-7 py-7">
            <span aria-hidden="true" className="complete-shine pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-[linear-gradient(100deg,transparent,rgba(255,255,255,0.65),transparent)]" />
            <div className="relative flex items-center justify-between">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-accent">{cohort.number}기 · COHORT {String(cohort.number).padStart(2, "0")}</p>
              <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold leading-none text-primary-foreground tabular-nums">D-{days}</span>
            </div>
            <p className="relative mt-4 text-[26px] font-semibold text-ink">{kstDay(cohort.startsOn)} 정오</p>
            <p className="relative mt-2 text-xs leading-6 text-muted-foreground">첫 소개가 도착하는 날이에요. 전날 한 번 더 알려 드릴게요.</p>
          </div>
        </div>
      </div>

      <div className="drop-in mt-11" style={delay(5)}>
        <Button asChild className="group h-12 rounded-full px-8 text-[15px] shadow-[0_16px_32px_-16px_color-mix(in_oklch,var(--primary)_80%,transparent)] transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none"><Link to="/profile">마이페이지로 가기 <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" /></Link></Button>
      </div>

      {/* 다음 세 단계: 선이 왼쪽에서 오른쪽으로 그어지며 이어진다 */}
      <div className="drop-in relative mt-16 w-full pt-9" style={delay(6)}>
        <span aria-hidden="true" className="complete-line absolute left-0 right-0 top-0 h-px origin-left bg-[linear-gradient(90deg,var(--primary),var(--accent),transparent)]" />
        <ol className="grid gap-7 text-left sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="drop-in" style={delay(7 + index)}>
              <span className="text-3xl font-extralight tabular-nums text-primary">0{index + 1}</span>
              <p className="mt-2 text-sm font-semibold">{step.title}</p>
              <p className="mt-1.5 text-xs leading-6 text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
      <p className="drop-in mt-10 max-w-md rounded-full bg-mist px-5 py-2.5 text-xs leading-6 text-muted-foreground" style={delay(10)}>기다리는 동안 마이페이지에서 ‘첫 마디’를 적어 두면, 소개된 분이 가장 먼저 보게 돼요.</p>
      {!LIVE && <p className="drop-in mt-3 text-[11px] text-muted-foreground" style={delay(11)}>데모 화면이라 실제 접수·발송은 일어나지 않았어요.</p>}
    </section>
  );
}
