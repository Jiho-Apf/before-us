import { kstDateTime } from "./dates"
import { DemoDock } from "./DemoDock"
import { NoonClock } from "./PublicHome"
import { recruitingCohort } from "./cohort"
import { Sheet, TwoDots, Eyebrow, QuietNote } from "./editorial"
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PaymentFlow } from "./PaymentFlow";
import { CurrentNoonStatus, NoticePreferencesPanel } from "./NoonStatus";
import { MemberAgreement } from "./AgreementFlow";
import { paymentSessionForToday } from "./payment-model";
import { ArrowRight, ArrowUpRight, Bell, Check, ChevronRight, Info, MessageCircle, Pause, Users } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { BEFORE_US } from "./config";
import { APPLICATION_STEPS, useSavedApplication } from "./application-model";
import { useOwnMemberAccount } from "./member-operations-model";
import { EMPTY_TODAY, TODAY_STATES, canCoordinate, currentSnapshot, makeDemoSnapshot, programDay, seoulDate, type TodaySnapshot, type TodayStage } from "./today-state";

const interaction = "transition-colors duration-200 motion-reduce:transition-none";
const steps = ["신청", "검토·준비", "소개·선택", "함께 시작", "3일 교류", "만남 의사"];

function formatDate(value: string | null, time = false) {
  if (!value) return "확인된 기록 없음";
  if (time) return kstDateTime(value, "확인된 기록 없음");
  const date = new Date(value.length === 10 ? `${value}T12:00:00+09:00` : value);
  if (!Number.isFinite(date.getTime())) return "확인된 기록 없음";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: BEFORE_US.introduction.timezone, month: "long", day: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit", hour12: false } : { year: "numeric", weekday: "long" }) }).format(date);
}

function useTodayDate() {
  const [date, setDate] = useState(() => seoulDate());
  useEffect(() => { const timer = setInterval(() => setDate(seoulDate()), 60000); return () => clearInterval(timer); }, []);
  return date;
}

function PublicPartner({ snapshot }: { snapshot: TodaySnapshot }) {
  const fields = snapshot.profile?.visible ? snapshot.profile.fields.filter(field => field.allowed) : [];
  const hasPartner = fields.length > 0 && TODAY_STATES[snapshot.stage].step >= 2;
  const row = "flex items-start justify-between gap-3 border-b border-border py-3 last:border-b-0";
  return (
    <aside className="flex flex-col border-t-2 border-foreground pt-5" aria-label="현재 상대와 상태">
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{hasPartner ? "지금 알아가는 사람" : "현재 소개 상태"}</h2><Users size={15} className="text-muted-foreground" /></div>
      <div className="mt-6 flex items-center gap-4"><TwoDots apart faded={!hasPartner} /><p className="text-xs text-muted-foreground">{hasPartner ? "한 사람과 천천히" : "아직 비어 있는 자리"}</p></div>
      {hasPartner ? <><p className="mb-3 mt-7 text-[10px] font-semibold tracking-[0.16em] text-accent">공개가 허용된 정보</p><dl>{fields.map(field => <div key={field.label} className={row}><dt className="text-xs text-muted-foreground">{field.label}</dt><dd className="text-right text-sm font-semibold">{field.value}</dd></div>)}</dl></> : <><p className="mt-7 text-lg font-semibold leading-8">아직 소개된 상대가<br />없어요.</p><p className="mt-3 text-sm leading-7 text-muted-foreground">소개가 준비되면 공개가 허용된 정보만 이곳에 차례로 놓여요.</p></>}
      <dl className="mt-7 border-t border-border text-xs leading-6">
        <div className={row}><dt className="shrink-0 text-muted-foreground">현재 상태</dt><dd className="text-right font-medium">{TODAY_STATES[snapshot.stage].label}</dd></div>
        {snapshot.ownSelection && <div className={row}><dt className="text-muted-foreground">나의 선택</dt><dd className="text-right">{snapshot.ownSelection === "positive" ? "더 알아가고 싶어요" : "이번에는 여기까지"}</dd></div>}
        {snapshot.mutualSelected && <div className={row}><dt className="text-muted-foreground">상호 선택</dt><dd className="font-semibold text-accent">확인됨</dd></div>}
        {snapshot.mutualSelected && <div className={row}><dt className="text-muted-foreground">교류비</dt><dd className="text-right">나 {snapshot.payments.own ? "확인" : "미확인"} · 상대 {snapshot.payments.partner ? "확인" : "미확인"}</dd></div>}
        {snapshot.agreedPlan && <div className={row}><dt className="text-muted-foreground">합의한 방식</dt><dd className="text-right">{snapshot.agreedPlan === "A" ? "A · 편지 나누기" : "B · 첫 장면 만들기"}</dd></div>}
      </dl>
      <p className="mt-6 text-xs italic text-muted-foreground">한 번에 한 사람, 확인된 상태만.</p>
    </aside>
  );
}

function ActionContent({ snapshot, today, onFeedback }: { snapshot: TodaySnapshot; today: string; onFeedback: (message: string) => void }) {
  const [draft, setDraft] = useState("");
  const [choice, setChoice] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const stage = snapshot.stage;
  const demoConfirm = (message: string) => onFeedback(`${message} 실제 제출·결제·발송은 진행되지 않았어요.`);
  if (["draft", "revision"].includes(stage)) return <div className="space-y-4"><p className="text-xs text-accent">이어서 작성할 항목: {snapshot.resumeField || "확인된 작성 위치 없음"}</p>{snapshot.revisionRequest && <p className="text-sm leading-7">{snapshot.revisionRequest}</p>}<label htmlFor="application-draft" className="block text-sm font-semibold">{snapshot.resumeField || "신청 내용"}</label><Textarea id="application-draft" value={draft} onChange={event => setDraft(event.target.value)} placeholder="데모 작성 · 실제 개인 정보는 입력하지 마세요." className="min-h-32 rounded-xl border-border bg-card" /><Button disabled={!draft.trim()} onClick={() => demoConfirm("이 화면에서 예시 작성을 확인했어요.")} className={`rounded-xl ${interaction}`}>데모 작성 확인</Button></div>;
  if (stage === "introduced") return <div className="space-y-4"><p className="text-sm leading-7">이번 소개 화면에서 공개 허용 프로필과 실제 응답 기한을 확인한 뒤 최종 응답해요.</p><Button asChild className={`rounded-xl ${interaction}`}><Link to={snapshot.demo ? "/demo/introduction" : "/us"}>이번 소개 확인 <ArrowRight size={16} /></Link></Button><p className="text-xs text-muted-foreground">가상 소개는 별도 개발용 화면에서 양쪽 공개와 응답을 시연해요.</p></div>;
  if (["ready", "mutual", "partner_payment"].includes(stage)) return <PaymentFlow initial={paymentSessionForToday(snapshot)} kind={stage === "ready" ? "introduction" : "exchange"} />;
  if (stage === "agreement") return <div className="space-y-4"><p className="text-sm leading-7">초안 선택·선택 공유·양쪽 시작 동의를 별도로 확인해요. 상대의 선택은 임의로 생성하지 않아요.</p><Button asChild variant="outline"><Link to="/demo/agreement">A/B 합의 데모 확인 <ArrowRight size={16} /></Link></Button></div>;
  if (stage === "a_write") return <div className="space-y-4">{snapshot.question ? <><p className="text-xs font-semibold text-accent">오늘의 질문</p><p className="text-lg font-semibold leading-8">{snapshot.question}</p><label htmlFor="today-letter" className="block text-sm font-medium">나의 편지</label><Textarea id="today-letter" value={draft} onChange={event => setDraft(event.target.value)} placeholder="나의 이야기를 천천히 적어보세요. 실제 개인 정보는 입력하지 마세요." className="min-h-44 rounded-xl border-border bg-card p-4 leading-7" /><Button disabled={!draft.trim()} onClick={() => demoConfirm("예시 편지 작성을 확인했어요.")} className={`rounded-xl ${interaction}`}>데모 편지 작성 확인</Button></> : <p className="text-sm text-muted-foreground">공개된 오늘 질문이 아직 없어요.</p>}</div>;
  if (["b_choose", "b_wait"].includes(stage)) return <div className="space-y-4"><p className="text-xs font-semibold text-accent">오늘의 공동 보드</p>{stage === "b_choose" && snapshot.boardOptions.length > 0 ? <><div className="grid gap-3 sm:grid-cols-2">{snapshot.boardOptions.map(option => <Button key={option} variant="outline" aria-pressed={choice === option} onClick={() => setChoice(option)} className={`h-20 rounded-xl whitespace-normal hover:bg-muted hover:text-foreground ${choice === option ? "border-primary bg-primary/5 text-primary" : "border-border"} ${interaction}`}>{option}</Button>)}</div><Button disabled={!choice} onClick={() => demoConfirm(`나의 선택 예시: ${choice}. 상대 선택은 생성하지 않았어요.`)} className={`rounded-xl ${interaction}`}>데모 선택 확인</Button></> : <p className="text-sm leading-7 text-muted-foreground">공개된 공동 선택 결과가 아직 없어요. 상대의 미공개 선택은 표시하지 않아요.</p>}</div>;
  if (stage === "a_open") { const letters = snapshot.shared.filter(item => item.published && item.kind === "letter"); return <div className="space-y-5">{letters.length ? letters.map(letter => <article key={letter.id}><h3 className="text-base font-semibold">{letter.title}</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-8">{letter.content}</p></article>) : <p className="text-sm text-muted-foreground">확인된 공개 편지가 없어요.</p>}</div>; }
  if (stage === "day4") return <div className="space-y-4"><p className="text-sm leading-7">직접 만나보고 싶나요? 만남을 선택하지 않아도 돼요.</p><div className="grid gap-3 sm:grid-cols-2">{["만나보고 싶어요", "여기서 마무리할게요"].map(option => <Button key={option} variant="outline" aria-pressed={choice === option} onClick={() => setChoice(option)} className={`h-14 rounded-xl whitespace-normal hover:bg-muted hover:text-foreground ${choice === option ? "border-primary bg-primary/5 text-primary" : "border-border"} ${interaction}`}>{option}</Button>)}</div><Button disabled={!choice} onClick={() => demoConfirm(`만남 의사 예시: ${choice}. 상대의 의사는 변경하지 않았어요.`)} className={`rounded-xl ${interaction}`}>데모 의사 확인</Button></div>;
  if (stage === "meeting") return canCoordinate(snapshot) ? <div className="space-y-4"><p className="text-xs font-semibold text-accent">양쪽의 만남 희망이 확인되었어요.</p><label htmlFor="meeting-date" className="block text-sm">가능한 날짜</label><Input id="meeting-date" type="date" min={today} value={date} onChange={event => setDate(event.target.value)} className="h-12 rounded-xl border-border bg-card" /><label htmlFor="meeting-time" className="block text-sm">가능한 시간</label><Input id="meeting-time" type="time" value={time} onChange={event => setTime(event.target.value)} className="h-12 rounded-xl border-border bg-card" /><label htmlFor="meeting-place" className="block text-sm">희망 장소</label><Input id="meeting-place" value={draft} onChange={event => setDraft(event.target.value)} placeholder="장소 예시를 입력해 주세요." className="h-12 rounded-xl border-border bg-card" /><Button disabled={!date || date < today || !time || !draft.trim()} onClick={() => demoConfirm("시간·장소 조율 예시를 확인했어요. 예약은 진행되지 않았어요.")} className={`rounded-xl ${interaction}`}>데모 조율 확인</Button><p className="text-xs text-muted-foreground">캘린더와 약속 상세는 약속 메뉴에서 확인해요.</p></div> : <p className="text-sm text-muted-foreground">양쪽의 만남 희망이 확인되기 전에는 시간·장소를 조율하지 않아요.</p>;
  return <div className="space-y-3 text-sm leading-7"><p>{TODAY_STATES[stage].description}</p>{stage === "response" && <p>현재 확인된 결과: 상대 응답 대기.</p>}{stage === "a_wait" && <p>나의 제출: 확인됨 · 상대 편지 공개: 미확인.</p>}{["review", "waiting", "paused"].includes(stage) && <p className="text-muted-foreground">저장된 신청 상세는 현재 데모에 연결되어 있지 않아요. 실제 정보를 추정해 표시하지 않아요.</p>}<Link to="/pricing#faq" className="inline-flex items-center gap-2 text-primary underline underline-offset-4">현재 상태·미시작·문의 안내 <ArrowUpRight size={14} /></Link></div>;
}

export function TodayView({ snapshot = EMPTY_TODAY, dateOverride }: { snapshot?: TodaySnapshot; dateOverride?: string }) {
  const realDate = useTodayDate();
  const today = dateOverride || realDate;
  const day = programDay(snapshot, today);
  const effectiveSnapshot = currentSnapshot(snapshot, today);
  const meta = TODAY_STATES[effectiveSnapshot.stage];
  const [panel, setPanel] = useState<"action" | "pause" | "info" | "notifications" | "contact" | null>(null);
  const [feedback, setFeedback] = useState("");
  const shared = snapshot.shared.filter(item => item.published);
  const active = meta.step >= 4 && day !== null && !["ended", "declined"].includes(effectiveSnapshot.stage);
  const cohort = recruitingCohort();
  return (
    <section aria-labelledby="today-title">
      <header className="flex flex-wrap items-end justify-between gap-8 border-b border-border pb-8">
        <div className="min-w-0">
          <Eyebrow mark="오늘" label={meta.label} en="TODAY · FLAVIE" />
          <h1 id="today-title" className="mt-5 text-3xl font-semibold leading-[1.4] sm:text-[34px]">{meta.title}</h1>
          <p className="mt-3 text-xs text-muted-foreground"><time dateTime={today}>{formatDate(today)}</time> · 서울{snapshot.demo ? " · 데모" : ""}</p>
        </div>
        <NoonClock tone="plain" />
      </header>
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Sheet className="flex flex-col p-6 sm:p-10">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-accent">지금 할 일</p>
              <h2 className="mt-4 text-2xl font-semibold leading-[1.45] sm:text-[28px]">{meta.action}</h2>
            </div>
            {active && <div className="shrink-0 text-right"><span className="text-[10px] tracking-[0.2em] text-muted-foreground">DAY</span><span className="mt-1 block text-6xl font-extralight leading-none tabular-nums text-primary">{String(day).padStart(2, "0")}</span></div>}
          </div>
          <p className="mt-6 max-w-xl text-sm leading-7 text-muted-foreground">{meta.description}</p>{snapshot.resumeField && <p className="mt-4 text-xs font-medium text-accent">이어 쓸 위치 · {snapshot.resumeField}</p>}
            <div className="mt-7">{effectiveSnapshot.stage === "before" || effectiveSnapshot.resumePath ? <Button asChild className={`h-12 rounded-xl px-6 ${interaction}`}><Link to={effectiveSnapshot.resumePath || "/apply"}>{meta.action} <ArrowUpRight size={17} /></Link></Button> : <Button aria-expanded={panel === "action"} aria-controls="today-action" onClick={() => setPanel(value => value === "action" ? null : "action")} className={`h-12 rounded-xl px-6 ${interaction}`}>{meta.action} <ArrowRight size={16} /></Button>}</div>
            {panel === "action" && <div id="today-action" className="mt-7 border-t border-border pt-6"><ActionContent key={`${effectiveSnapshot.stage}-${today}`} snapshot={effectiveSnapshot} today={today} onFeedback={setFeedback} /></div>}
            {feedback && <p role="status" className="mt-5 rounded-xl bg-muted px-4 py-3 text-xs leading-6">{feedback}</p>}
          <div className="mt-auto pt-10"><QuietNote>{active ? "각자의 속도로, 오늘 할 일 하나부터." : "한 번에 한 사람, 서두르지 않는 시작."}</QuietNote></div>
        </Sheet>
        <PublicPartner snapshot={effectiveSnapshot} />
      </div>
      <CurrentNoonStatus snapshot={effectiveSnapshot} />
      <section className="mt-10 rounded-2xl border border-border bg-card p-6 shadow-[0_24px_48px_-40px_color-mix(in_oklch,var(--primary)_45%,transparent)] sm:p-8" aria-labelledby="progress-title"><div className="mb-6 flex items-end justify-between gap-3"><h2 id="progress-title" className="text-sm font-semibold">우리의 진행</h2><span className="text-xs text-muted-foreground">현재 단계 기준 · 성공 지표 아님</span></div><ol className="relative grid grid-cols-6"><span aria-hidden="true" className="absolute left-[8.33%] right-[8.33%] top-[7px] h-px bg-border" />{steps.map((step, index) => <li key={step} aria-current={index === meta.step ? "step" : undefined} className="relative flex flex-col items-center gap-3 text-center"><span aria-hidden="true" className={`relative z-10 grid size-4 place-items-center rounded-full ring-4 ring-background ${index === meta.step ? "bg-accent" : index < meta.step ? "bg-primary" : "border border-border bg-background"}`}>{index < meta.step && <span className="size-1.5 rounded-full bg-white" />}</span><span className={`text-xs leading-4 sm:text-xs ${index === meta.step ? "font-semibold text-accent" : index < meta.step ? "text-foreground" : "text-muted-foreground"}`}>{step}</span></li>)}</ol></section>
      <section className="mt-14" aria-labelledby="shared-title"><div className="mb-4 flex items-center justify-between"><h2 id="shared-title" className="text-sm font-semibold">지난 공유 내용</h2><span className="text-xs text-muted-foreground">서로에게 공개된 내용만</span></div>{shared.length ? <div className="divide-y divide-border border-y border-border">{shared.map(item => <article key={item.id} className="py-5"><div className="flex items-center justify-between gap-4"><h3 className="text-sm font-semibold">{item.title}</h3><time dateTime={item.publishedAt} className="text-xs text-muted-foreground">{formatDate(item.publishedAt)}</time></div><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{item.content}</p></article>)}</div> : <div className="border-y border-border py-8 text-center"><p className="text-sm text-muted-foreground">아직 함께 열린 이야기가 없어요.</p><p className="mt-2 text-[11px] text-muted-foreground">상대의 초안이나 열리지 않은 내용은 보여주지 않아요.</p></div>}</section>
      <section className="mt-10 rounded-2xl bg-mist p-6 sm:p-8" aria-labelledby="status-title"><h2 id="status-title" className="mb-5 text-sm font-semibold">지금 알아두면 좋은 것</h2><dl className="grid gap-5 text-xs sm:grid-cols-3"><div><dt className="mb-2 text-muted-foreground">최근 소개일</dt><dd>{formatDate(snapshot.lastIntroductionAt)}</dd></div><div><dt className="mb-2 text-muted-foreground">시스템 상태 갱신</dt><dd>{formatDate(snapshot.stateUpdatedAt, true)}</dd></div><div><dt className="mb-2 text-muted-foreground">운영자 마지막 검토</dt><dd>{formatDate(snapshot.operatorReviewedAt, true)}</dd></div></dl><p className="mt-5 text-xs leading-6 text-muted-foreground">지금은 기수제로 운영해요 · {cohort.number}기 첫 소개는 {kstDateTime(`${cohort.startsOn}T12:00:00+09:00`)}이에요. 시스템 갱신과 운영자 검토는 달라요. 하루 최대 한 명을 소개하며, 매일 새 소개를 보장하지 않아요.</p>
        <div className="mt-5 flex flex-wrap gap-2">{[{ id: "pause", label: "일시정지", icon: Pause }, { id: "info", label: "정보 확인", icon: Info }, { id: "notifications", label: "알림 설정", icon: Bell }, { id: "contact", label: "문의", icon: MessageCircle }].map(({ id, label, icon: Icon }) => <Button key={id} variant="outline" aria-expanded={panel === id} onClick={() => { setPanel(value => value === id ? null : id as typeof panel); setFeedback(""); }} className={`h-10 rounded-xl border-border text-xs hover:bg-muted hover:text-foreground ${interaction}`}><Icon size={14} />{label}</Button>)}</div>
        {panel && panel !== "action" && <div className="mt-4 rounded-xl border border-border bg-card p-5 text-sm leading-7" role="region" aria-label="상태 관리 안내">{panel === "pause" && <><p>현재 상태: {meta.label}</p><p className="mt-2 text-muted-foreground">이 데모에서는 일시정지 요청을 실제로 접수하거나 운영 상태를 변경하지 않아요.</p><Button variant="outline" onClick={() => setFeedback("일시정지 요청 예시를 확인했어요. 실제 상태는 변경되지 않았어요.")} className={`mt-4 rounded-xl hover:bg-muted hover:text-foreground ${interaction}`}>데모 요청 확인</Button></>}{panel === "info" && <p>현재 확인된 단계는 ‘{meta.label}’ 단계예요. 실제 신청 상세와 개인정보는 이 데모에 연결되어 있지 않아요.</p>}{panel === "notifications" && <NoticePreferencesPanel />}{panel === "contact" && <><p>실제 문의 접수·발송 기능은 아직 연결되지 않았어요.</p><Link to="/pricing#faq" className="mt-3 inline-flex items-center gap-2 text-primary underline underline-offset-4">후보 대기·미시작·취소·환불 안내 FAQ <ArrowUpRight size={14} /></Link></>}</div>}
      </section>
    </section>
  );
}

export function MeetingGate() {
  return <section className="py-8"><p className="mb-5 text-xs text-accent">약속 · 데모</p><h1 className="text-3xl font-semibold leading-relaxed">서로의 만남 의사가 확인된 뒤에.</h1><p className="mt-5 max-w-lg text-sm leading-7 text-muted-foreground">양쪽의 만남 희망이 확인되면 이곳에서 시간·장소와 약속 캘린더를 확인해요. 현재는 확인된 만남 동의나 약속이 없어요.</p><Button asChild className={`mt-7 rounded-xl ${interaction}`}><Link to="/today">오늘로 돌아가기 <ArrowRight size={15} /></Link></Button></section>;
}

import { ProfileCoaching, WaitingJourney } from "./MemberTrust";
export default function MemberToday() {
  const [params] = useSearchParams();
  const saved = useSavedApplication();
  const account=useOwnMemberAccount("current-member");
  if (params.get("demo") === "agreement") return <MemberAgreement context="today" />;
  const snapshot: TodaySnapshot = saved ? { ...EMPTY_TODAY, stage: "draft", resumeField: `${APPLICATION_STEPS[saved.step]} · ${saved.completedDemo ? "가상 작성 확인 완료" : "임시 저장된 지점"}`, resumePath: "/apply" } : EMPTY_TODAY;
  const effective=account?.payment.activity && account.payment.activity!=="active" ? {...snapshot,stage:"paused" as const,stateUpdatedAt:account.requests[account.requests.length-1]?.at || null,resumePath:"/profile"} : snapshot;
  return <><TodayView key={`${saved ? "saved-application" : "before-application"}-${effective.stage}`} snapshot={effective} />{saved && effective.stage !== "paused" && <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2"><WaitingJourney application={saved} /><ProfileCoaching application={saved} /></div>}</>;
}

export function TodayDemo() {
  const [params] = useSearchParams();
  const [stage, setStage] = useState<TodayStage>(params.get("stage") === "agreement" ? "agreement" : "before");
  const [today, setToday] = useState(() => seoulDate());
  const [startDate, setStartDate] = useState(() => seoulDate());
  return <div className="py-8"><DemoDock title="오늘 · 상태·날짜 미리보기" defaultOpen><p className="text-xs leading-6 text-muted-foreground">회원 ‘오늘’과 분리된 화면이에요. 실제 회원 상태, 날짜, 결제, 응답이나 운영 기록을 변경하지 않아요.</p><div className="mt-5 grid gap-4"><label className="text-xs font-medium">예시 상태<select value={stage} onChange={event => setStage(event.target.value as TodayStage)} className="mt-2 h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">{Object.entries(TODAY_STATES).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label><label className="text-xs font-medium">예시 오늘 날짜<Input type="date" value={today} onChange={event => { if(event.target.value) setToday(event.target.value); }} className="mt-2 h-11 rounded-xl border-border bg-card" /></label><label className="text-xs font-medium">예시 실제 시작일<Input type="date" value={startDate} onChange={event => { if(event.target.value) setStartDate(event.target.value); }} className="mt-2 h-11 rounded-xl border-border bg-card" /></label></div><Link to="/today" className="mt-4 inline-flex items-center gap-2 text-xs text-primary underline underline-offset-4">회원 오늘으로 돌아가기 <ChevronRight size={13} /></Link></DemoDock><TodayView key={`${stage}-${today}-${startDate}`} snapshot={makeDemoSnapshot(stage, today, startDate)} dateOverride={today} /></div>;
}
