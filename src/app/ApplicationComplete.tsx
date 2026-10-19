import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "./components/ui/button";
import { kstDay } from "./dates";
import { LIVE, rpc } from "./backend/client";
import { recruitingCohort, type CohortInfo } from "./cohort";

// 소개 신청을 마친 직후의 화면. 위에서부터 한 줄씩 내려앉고, 가운데 ‘마이페이지로 가기’ 하나만 크게 둔다.
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
  const delay = (index: number) => ({ animationDelay: `${index * 130}ms` });
  return (
    <section aria-labelledby="complete-title" className="mx-auto flex w-full max-w-3xl flex-col items-center py-12 text-center break-keep sm:py-16">
      <div className="drop-in" style={delay(0)} aria-hidden="true">
        <span className="relative flex h-6 w-40 items-center justify-center">
          <span className="dot-meet-left absolute size-4 rounded-full bg-primary" />
          <span className="dot-meet-right absolute size-4 rounded-full bg-accent" />
        </span>
      </div>
      <p className="drop-in mt-10 text-xs font-semibold tracking-[0.2em] text-accent" style={delay(1)}>APPLICATION RECEIVED</p>
      <h1 id="complete-title" className="drop-in mt-5 text-3xl font-semibold leading-[1.4] sm:text-[40px]" style={delay(2)}>{name ? <>{name} 님의 신청을<br />잘 받았어요.</> : <>소개 신청을<br />잘 받았어요.</>}</h1>
      <p className="drop-in mt-5 max-w-md text-sm leading-7 text-muted-foreground" style={delay(3)}>운영진이 사진과 이야기를 한 장씩 읽고, 잘 맞는 분을 천천히 준비해 둘게요.</p>
      <div className="drop-in mt-10 w-full max-w-sm border border-border bg-card px-6 py-6 shadow-[0_24px_48px_-32px_color-mix(in_oklch,var(--primary)_35%,transparent)]" style={delay(4)}>
        <p className="text-[11px] font-semibold tracking-[0.18em] text-accent">{cohort.number}기 · COHORT {String(cohort.number).padStart(2, "0")}</p>
        <p className="mt-3 text-2xl font-semibold">{kstDay(cohort.startsOn)} 정오</p>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">첫 소개가 도착하는 날이에요. 전날 한 번 더 알려 드릴게요.</p>
      </div>
      <div className="drop-in mt-10" style={delay(5)}>
        <Button asChild className="h-12 rounded-full px-8 text-[15px]"><Link to="/profile">마이페이지로 가기 <ArrowRight size={16} /></Link></Button>
      </div>
      <ol className="drop-in mt-14 grid w-full gap-6 border-t border-border pt-8 text-left sm:grid-cols-3" style={delay(6)}>
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="text-3xl font-extralight tabular-nums text-primary">0{index + 1}</span>
            <p className="mt-2 text-sm font-semibold">{step.title}</p>
            <p className="mt-1.5 text-xs leading-6 text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="drop-in mt-10 max-w-md text-xs leading-6 text-muted-foreground" style={delay(7)}>기다리는 동안 마이페이지에서 ‘첫 마디’를 적어 두면, 소개된 분이 가장 먼저 보게 돼요.{LIVE ? "" : " · 데모 화면이라 실제 접수·발송은 일어나지 않았어요."}</p>
    </section>
  );
}
