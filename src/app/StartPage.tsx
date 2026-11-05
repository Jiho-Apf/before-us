import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, ArrowUpRight, LockOpen } from "lucide-react";
import { Button } from "./components/ui/button";
import { BEFORE_US } from "./config";
import { LIVE } from "./backend/client";
import { useMemberSnapshot, type MemberSnapshot } from "./backend/member";
import { cohortName, useRecruitingCohort } from "./cohort";
import { kstDay } from "./dates";
import { Segments } from "./Segments";

// 짧은 시작 화면(/start · 2026-11-05 GPT 최종 검수 §5): 인스타그램·Threads 링크로 처음 들어온 분이 휴대폰 3~4화면 안에
// ① 무엇인지 ② 어떻게 하는지 ③ 어떤 느낌인지(가상 예시) ④ 참여 판단(대상·준비물·일정·비용·안전)을 보고 바로 신청을 시작한다.
// 기존 가입·신청·결제를 그대로 쓰고, 긴 홈은 ‘자세히 보기’ 자원으로 둔다. 일정·요금은 공통 설정(서버 기수 · BEFORE_US.pricing)에서 읽는다.
// 로그인한 분은 서버의 내 상태를 읽어 지금 필요한 다음 행동 하나로 안내한다(주소의 값은 믿지 않는다 · 베타에는 결제로 보내지 않는다).
const BETA = LIVE && BEFORE_US.beta.active;
const P = BEFORE_US.pricing;
const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const day = (iso: string) => kstDay(`${iso}T12:00:00+09:00`).replace(/\s\(.\)$/, "");
const dayWithWeekday = (iso: string) => kstDay(`${iso}T12:00:00+09:00`).replace(/\s\(/, "(");
const interaction = "transition-colors duration-200 motion-reduce:transition-none";

function useSignedIn() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let unsubscribe = () => {};
    let alive = true;
    void import("./auth-service").then(auth => { if (!alive) return; const update = () => setSignedIn(!!auth.getAuthUser()); update(); unsubscribe = auth.subscribeAuth(update); });
    return () => { alive = false; unsubscribe(); };
  }, []);
  return signedIn;
}

// 로그인한 분의 다음 행동 하나(서버 상태 기준). 정식 운영에서도 결제 여부는 결제 화면이 서버에서 다시 확인한다.
type Next = { label: string; to: string; note: string };
function nextFor(data: MemberSnapshot): Next {
  const app = data.application?.status;
  const intro = data.introduction;
  const program = data.program;
  if (program && program.status !== "closed") {
    if (program.status === "arranging" || program.meetingOn) return { label: "약속 화면으로", to: "/meeting", note: "정해진 약속과 연락처 동의를 확인할 수 있어요." };
    return { label: "오늘의 교류로", to: "/exchange", note: "오늘 읽거나 쓸 것이 있는지 바로 보여 드려요." };
  }
  if (intro.status === "published" || intro.status === "mutual") return { label: "도착한 소개 보기", to: "/us", note: "응답 기한 안에 알아가고 싶은지 답해 주세요." };
  if (!app || app === "draft") return { label: app ? "신청 이어서 쓰기" : "신청 시작하기", to: "/apply", note: app ? "쓰던 곳부터 이어서 쓸 수 있어요." : "최근 사진 3장과 간단한 소개를 준비해 주세요." };
  if (app === "needs_changes") return { label: "보완할 내용 확인하기", to: "/apply", note: "운영진이 남긴 안내를 확인하고 고쳐 주세요." };
  if (app === "approved") return BETA || data.perk === "unlimited"
    ? { label: "오늘 화면 보기", to: "/today", note: "소개가 준비되면 정오에 오늘 화면과 메일로 알려 드려요." }
    : { label: "이용 확인하기", to: "/payments", note: "승인된 분만 소개비를 결제할 수 있어요. 결제 화면에서 다시 확인해요." };
  if (app === "rejected" || app === "withdrawn") return { label: "내 정보 보기", to: "/profile", note: "궁금한 점은 문의하기로 남겨 주세요." };
  return { label: "신청 상태 보기", to: "/today", note: "운영진이 신청서를 읽고 있어요. 검토가 끝나면 알려 드려요." };
}
function MemberNext() {
  const { data, loading } = useMemberSnapshot();
  if (loading) return <p role="status" className="mt-8 text-sm text-muted-foreground">내 상태를 확인하고 있어요.</p>;
  if (!data) return <PrimaryCta />;
  const next = nextFor(data);
  return <div className="mt-8"><Button asChild className={`h-13 w-full rounded-full px-6 text-base sm:w-auto ${interaction}`}><Link to={next.to}>{next.label} <ArrowRight size={17} /></Link></Button><p className="mt-3 text-sm leading-6 text-muted-foreground">{next.note}</p></div>;
}
function PrimaryCta() {
  return <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
    <Button asChild className={`h-13 w-full rounded-full px-7 text-base sm:w-auto ${interaction}`}><Link to="/apply">{BETA ? "무료 베타 신청하기" : "소개 신청하기"} <ArrowRight size={17} /></Link></Button>
    <Link to="/two-starts" className={`text-sm font-semibold text-primary underline-offset-4 hover:underline ${interaction}`}>진행 방식 자세히 보기</Link>
  </div>;
}

export default function StartPage() {
  const cohort = useRecruitingCohort();
  const signedIn = useSignedIn();
  const schedule = cohort ? [BETA ? `${cohortName(cohort.number)} 무료` : `${cohortName(cohort.number)} 모집 중`, `신청 ${dayWithWeekday(cohort.applicationDeadline)}까지`, `첫 소개 ${day(cohort.startsOn)} 정오`] : null;
  return <div className="break-keep [overflow-wrap:anywhere] pb-16">
    {/* ① 무엇인지 */}
    <section aria-labelledby="start-title" className="pt-10 sm:pt-16">
      <p className="text-xs font-semibold tracking-[0.04em] text-accent">플라비 · 편지로 시작하는 1:1 소개</p>
      <h1 id="start-title" className="text-ink mt-4 text-[30px] font-semibold leading-[1.3] sm:text-[40px]">한 사람을 만나기 전,<br />사흘 먼저 알아가요.</h1>
      <p className="mt-5 max-w-xl text-base leading-[1.65] text-foreground/85">운영진이 신청서를 읽고, 취향과 성향을 살펴 한 사람을 소개해요. 서로 마음이 있으면 만나기 전 사흘을 함께 보내요.</p>
      <p aria-hidden={!schedule} className={`mt-5 inline-flex min-h-8 max-w-full items-center gap-2 rounded-full bg-[#F8E5A6] px-3.5 py-1.5 text-[13px] font-semibold text-[#2B2540] transition-opacity duration-300 ${schedule ? "opacity-100" : "opacity-0"}`}><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" /><span>{schedule ? <Segments parts={schedule} /> : "\u00a0"}</span></p>
      {LIVE && signedIn ? <MemberNext /> : <PrimaryCta />}
    </section>

    {/* ② 어떻게 하는지 */}
    <section aria-labelledby="start-how" className="mt-14">
      <h2 id="start-how" className="text-ink text-xl font-semibold">이렇게 진행돼요</h2>
      <ol className="mt-5 space-y-3">
        {[
          ["사람이 한 사람을 골라요", "소개가 준비된 날 정오, 두 분께 함께 도착해요. 매일 새 소개를 보장하지는 않아요."],
          ["서로 선택하면 사흘", "하루 한 통 편지, 또는 함께 만드는 첫 장면으로 만나기 전에 알아가요."],
          ["넷째 날, 만날지 정해요", "둘 다 원하면 약속을 정해요. 연락처는 두 분이 동의하면 만나는 날과 다음\u00a0날만 보여요."],
        ].map(([title, body], index) => <li key={title} className="flex gap-4 rounded-2xl border border-border bg-card p-5">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{index + 1}</span>
          <div><p className="text-base font-semibold">{title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p></div>
        </li>)}
      </ol>
    </section>

    {/* ③ 어떤 느낌인지(가상 예시) */}
    <section aria-labelledby="start-feel" className="mt-14">
      <h2 id="start-feel" className="text-ink text-xl font-semibold">사흘 동안 이런 이야기를 나눠요</h2>
      <p className="mt-2 text-[13px] text-muted-foreground">서비스 흐름을 보여 주는 가상 예시예요. 실제 회원의 글이 아니에요.</p>
      <figure className="mt-5 overflow-hidden rounded-3xl border border-lilac bg-mist p-5 sm:p-7">
        <figcaption className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-ink ring-1 ring-lilac"><LockOpen size={13} aria-hidden="true" className="text-primary" /><span className="font-semibold text-primary">첫째 날</span>“편안하다고 느끼는 대화는?”</figcaption>
        <div className="mt-4 space-y-2.5">
          <p className="max-w-[88%] rounded-2xl rounded-tl-md bg-card px-4 py-3 text-[15px] leading-7 shadow-[0_12px_30px_-24px_rgba(40,24,100,0.5)]">말이 끊겨도 어색하지 않은 대화요. 그런 대화는 오래 기억에 남더라고요.</p>
          <p className="ml-auto max-w-[88%] rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-[15px] leading-7 text-primary-foreground">상대가 끝까지 말하게 기다려 주는 대화요. 우리 대화는 좀 느리겠네요.</p>
        </div>
        <p className="mt-4 text-[13px] leading-6 text-muted-foreground">두 분이 모두 보내야 같은 순간에 열려요.</p>
      </figure>
    </section>

    {/* ④ 참여 판단 */}
    <section aria-labelledby="start-check" className="mt-14">
      <h2 id="start-check" className="text-ink text-xl font-semibold">신청 전에 확인해 주세요</h2>
      <dl className="mt-5 divide-y divide-border rounded-3xl border border-border bg-card">
        {([
          ["대상", `${BEFORE_US.ageBand.label}, 만 19세 이상이고 천천히 알아가는 만남을 바라는 분`],
          ["준비할 것", "최근 사진 3장과 간단한 소개. 신청서는 나눠 써도 저장돼요."],
          ["일정", schedule ? <Segments parts={schedule} /> : "기수 일정은 신청서에서 확인할 수 있어요."],
          ["비용", BETA ? `지금은 무료 베타예요. 정식 운영부터 소개비 ${won(P.introduction)}, 서로 선택해 교류를 시작할 때 ${won(P.exchangePerPerson)}을 더 내요(첫 교류까지 1인 ${won(P.firstExchangeTotalPerPerson)}). 무료 베타 참여가 유료로 자동 전환되지는 않아요.` : `소개비 ${won(P.introduction)}, 서로 선택해 교류를 시작할 때 ${won(P.exchangePerPerson)}(첫 교류까지 1인 ${won(P.firstExchangeTotalPerPerson)}). 소개비는 운영진 승인 뒤에 내요.`],
          ["안전", "사진은 운영진이 기준을 확인해요(신원·미혼을 보증하는 절차는 아니에요). 차단하면 교류가 바로 멈추고, 신고는 평일 10~18시에 확인해요. 위험할 때는 112에 먼저 연락해 주세요."],
        ] as [string, ReactNode][]).map(([term, desc]) => <div key={term} className="grid gap-1 px-5 py-4 sm:grid-cols-[96px_1fr] sm:gap-4"><dt className="text-sm font-semibold">{term}</dt><dd className="text-sm leading-6 text-foreground/85">{desc}</dd></div>)}
      </dl>
      <nav aria-label="자세히 보기" className="mt-5 grid grid-cols-2 gap-x-5 text-sm sm:flex sm:flex-wrap sm:gap-y-2">
        {[["진행 방식", "/two-starts"], ["이용 요금·환불", "/pricing"], ["자주 묻는 질문", "/faq"], ["개인정보처리방침", "/privacy"]].map(([label, to]) => <Link key={to} to={to} className={`inline-flex min-h-11 items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline ${interaction}`}>{label} <ArrowUpRight size={14} aria-hidden="true" /></Link>)}
      </nav>
      {LIVE && signedIn ? <MemberNext /> : <PrimaryCta />}
    </section>
  </div>;
}
