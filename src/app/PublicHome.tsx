import { Link } from "react-router";
import { ArrowRight, ArrowUpRight, Check, Clock, Plus } from "lucide-react";
import { Button } from "./components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./components/ui/accordion";
import { BEFORE_US } from "./config";
import DirectIntroduction from "./DirectIntroduction";
import { REFUND_NOTICE } from "./refund-policy";

const interaction = "transition-colors duration-200 motion-reduce:transition-none";
const money = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;

function SectionLabel({ number, children }: { number: string; children: React.ReactNode }) {
  return <div className="mb-8 flex items-center gap-4 text-xs font-semibold"><span className="text-accent">{number}</span><span className="tracking-[0.14em] text-muted-foreground">{children}</span></div>;
}

function ServiceCollage() {
  return (
    <div className="relative mx-auto w-full max-w-lg pb-8 lg:pb-0" aria-label="서비스 화면 예시: 편지 나누기와 첫 장면 만들기">
      <div className="mb-6 flex items-center justify-between text-xs text-white/85 dark:text-white"><span className="border border-white/30 px-3 py-1.5">서비스 화면 예시</span><span className="tracking-[0.15em]">DAY 01—03</span></div>
      <div className="relative min-h-[430px] sm:min-h-[450px]">
        <div className="absolute top-0 left-0 w-[78%] -rotate-3 border border-white/40 bg-white text-[#151515] shadow-xl">
          <div className="flex items-center justify-between border-b border-black/10 px-6 py-4 text-[10px] font-semibold tracking-[0.15em]"><span>A · 편지 나누기</span><span>DAY 01</span></div>
          <div className="px-6 pt-7 pb-12 sm:px-8"><div className="mb-6 flex gap-1.5" aria-hidden="true"><span className="size-2 rounded-full bg-primary" /><span className="size-2 rounded-full bg-accent" /></div><p className="text-xl font-semibold leading-relaxed">당신의 하루에서<br />가장 좋아하는 순간은?</p><p className="mt-5 text-xs leading-6 text-black/55">서로에게 하루 한 통.<br />한 번에 조금씩, 나의 이야기를 전합니다.</p><div className="mt-8 h-px bg-black/10" /><div className="mt-3 h-px w-4/5 bg-black/10" /></div>
          <div className="bg-accent px-6 py-3 text-[11px] text-white">하루 한 통의 편지, 각자의 속도로.</div>
        </div>
        <div className="absolute top-44 right-0 w-[65%] rotate-3 border border-white/40 bg-white text-[#151515] shadow-xl">
          <div className="flex items-center justify-between border-b border-black/10 px-5 py-4 text-[10px] font-semibold tracking-[0.1em]"><span>B · 첫 장면 만들기</span><span>DAY 02</span></div>
          <div className="px-5 py-6"><p className="text-[15px] font-semibold leading-6">함께 고르는<br />우리의 첫 장면.</p><div className="mt-5 space-y-2"><div className="flex items-center justify-between rounded-xl border border-accent bg-accent/5 px-3 py-3 text-[11px]"><span>조용한 동네를 함께 걷기</span><Check size={13} className="text-accent" /></div><div className="rounded-xl border border-black/10 px-3 py-3 text-[11px] text-black/55">좋아하는 음악을 함께 듣기</div></div></div>
          <div className="bg-accent px-5 py-3 text-[11px] text-white">두 사람이 함께 선택합니다.</div>
        </div>
        <span className="absolute bottom-3 left-0 text-[10px] tracking-[0.12em] text-white/85 dark:text-white">TWO PEOPLE. THEIR OWN PACE.</span>
      </div>
      <p className="mt-3 text-[10px] leading-5 text-white/85 dark:text-white">실제 회원의 편지나 프로필이 아닌 서비스 화면 예시입니다.</p>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative isolate -mx-5 overflow-hidden bg-primary text-primary-foreground sm:-mx-8 lg:-mx-12" aria-labelledby="home-title">
      <div className="grid gap-12 px-5 pt-14 pb-28 sm:px-8 sm:pt-20 sm:pb-32 lg:grid-cols-[7fr_5fr] lg:items-center lg:gap-10 lg:px-12 lg:pt-20 lg:pb-32">
        <div className="relative z-10">
          <p className="mb-7 flex items-center gap-2.5 text-sm font-medium"><span aria-hidden="true" className="size-1.5 rounded-full bg-white" />취향을 고려하는 일대일 소개</p>
          <h1 id="home-title" className="text-[clamp(2.5rem,5vw,4.25rem)] font-semibold leading-[1.22] tracking-[-0.02em]">끌리는 사람을,<br />천천히 알아갑니다.</h1>
          <p className="mt-7 max-w-lg text-sm leading-[1.95] text-white/85 dark:text-white sm:text-[15px]">그저 괜찮다는 이유로 서두르기보다, 내가 좋아하고 더 알아가고 싶은 한 사람에게 집중합니다. 운영자가 취향과 성향을 함께 살펴 상대를 제안하고, 서로의 끌림이 확인되면 두 사람이 고른 방식으로 이야기를 시작합니다.</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button asChild className={`h-12 rounded-full bg-white px-6 text-primary hover:bg-white/90 ${interaction}`}><Link to="/apply">소개 신청하기 <ArrowUpRight size={17} /></Link></Button>
            <Button asChild variant="outline" className={`h-12 rounded-full border-white/35 bg-transparent px-5 text-white hover:bg-white/10 hover:text-white dark:bg-transparent ${interaction}`}><Link to="/two-starts">어떻게 알아가나요? <ArrowRight size={15} /></Link></Button>
          </div>
          <p className="mt-5 text-xs leading-6 text-white/85 dark:text-white">소개 이용료 {money(BEFORE_US.pricing.introduction)} · 상호 선택 후 교류비 {money(BEFORE_US.pricing.exchangePerPerson)}</p>
          <p className="mt-3 text-[11px] text-white/85 dark:text-white">데모 둘러보기 · 실제 신청이나 결제는 진행되지 않습니다.</p>
        </div>
        <ServiceCollage />
      </div>
      <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full fill-background sm:h-24" viewBox="0 0 1200 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 68 C300 -20 700 122 1200 28 L1200 100 L0 100 Z" /></svg>
    </section>
  );
}

function Philosophy() {
  return (
    <section className="grid gap-8 py-20 sm:py-24 lg:grid-cols-[7fr_5fr] lg:gap-16" aria-labelledby="philosophy-title">
      <div><SectionLabel number="01">OUR POINT OF VIEW</SectionLabel><h2 id="philosophy-title" className="max-w-xl text-3xl font-semibold leading-[1.5] sm:text-[38px]">마음을 서두르지 않고,<br />취향을 타협하지 않도록.</h2></div>
      <div className="lg:pt-16"><p className="text-[15px] leading-[2] text-muted-foreground">내가 좋아하는 사람인지, 나와 잘 맞는 사람인지. 조건표만으로 단정하지 않고, 함께 알아가는 시간 속에서 확인합니다. 억지로 호감을 만들거나, 다음 만남을 서두를 필요는 없습니다.</p></div>
    </section>
  );
}

function Introduction() {
  return (
    <section id="how-it-works" className="border-t border-border py-16 sm:py-20" aria-labelledby="introduction-title">
      <div className="grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-16">
        <div className="relative flex min-h-72 flex-col justify-between overflow-hidden bg-muted p-8 sm:min-h-80 sm:p-10">
          <span className="text-[11px] font-semibold tracking-[0.13em] text-muted-foreground">ONE PAIR, AT A TIME</span>
          <div className="flex items-center justify-center gap-5 py-7" aria-hidden="true"><span className="size-20 rounded-full bg-primary sm:size-24" /><span className="size-20 rounded-full bg-accent sm:size-24" /></div>
          <div className="flex items-baseline justify-between"><span className="text-sm font-semibold">한 사람을 향한 집중</span><span className="text-5xl font-light text-primary">02</span></div>
        </div>
        <div className="flex flex-col justify-center"><SectionLabel number="02">THE INTRODUCTION</SectionLabel><h2 id="introduction-title" className="text-3xl font-semibold leading-[1.5] sm:text-[34px]">많이 보여드리기보다,<br />한 사람을 신중하게.</h2><p className="mt-6 text-[15px] leading-[2] text-muted-foreground">운영자가 양쪽의 외적인 취향·관계 기준·생활과 대화 성향을 참고해 한 쌍을 제안한다.</p><div className="mt-7 flex items-start gap-3 border-t border-border pt-5"><Clock size={17} className="mt-1 shrink-0 text-accent" /><p className="text-sm leading-7">준비된 날 정오 12시에 하루 최대 한 명.<br /><span className="text-muted-foreground">매일 새 소개를 보장하지 않는다.</span></p></div></div>
      </div>
      <div className="mt-8"><DirectIntroduction /></div>
    </section>
  );
}

function InitialOperation() {
  return (
    <section className="-mx-5 bg-accent px-5 py-14 text-accent-foreground sm:-mx-8 sm:px-8 sm:py-16 lg:-mx-12 lg:px-12" aria-labelledby="initial-title">
      <div className="grid gap-8 lg:grid-cols-[7fr_5fr] lg:gap-16"><div><p className="mb-6 text-[11px] font-semibold tracking-[0.15em] opacity-85 dark:opacity-100">FOR OUR FIRST MEMBERS</p><h2 id="initial-title" className="text-3xl font-semibold leading-[1.5] sm:text-[34px]">첫 교류가 시작될 때까지,<br />추가 소개비 없이.</h2></div><div className="space-y-4 text-sm leading-[1.95]"><p>초기 회원은 이번 신청에서 첫 A/B 교류를 시작하기 전까지 소개 횟수 제한이 없다.</p><p className="opacity-85">후보와 참여 시점이 맞기까지 기다림이 생길 수 있다.</p><p className="opacity-85">새 소개 없는 날도 홈페이지에서 현재 상태를 확인하고, 매일 정오 상태 알림은 선택할 수 있다.</p><p className="border-t border-current/20 pt-4 text-xs opacity-85 dark:opacity-100">데모에서는 실제 소개와 상태 알림이 발송되지 않습니다.</p></div></div>
    </section>
  );
}

function Exchange() {
  return (
    <section id="two-starts" className="py-20 sm:py-24" aria-labelledby="exchange-title">
      <SectionLabel number="03">TWO WAYS TO BEGIN</SectionLabel>
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><h2 id="exchange-title" className="text-3xl font-semibold leading-[1.5] sm:text-[38px]">마주하기 전,<br />우리만의 3일.</h2><p className="max-w-sm text-sm leading-7 text-muted-foreground">상호 선택·양쪽 결제·같은 방식과 시작일 합의 후 3일 교류, 4일째 만남 선택.</p></div>
      <div className="mt-10 grid border border-border md:grid-cols-2">
        <article className="flex flex-col border-b border-border bg-muted p-7 sm:p-10 md:border-r md:border-b-0"><div className="mb-8 flex items-start justify-between"><span className="text-6xl font-light leading-none text-primary">A</span><span className="pt-2 text-[10px] tracking-[0.12em] text-muted-foreground">ONE LETTER A DAY</span></div><h3 className="text-2xl font-semibold">편지 나누기</h3><p className="mt-4 min-h-14 text-sm leading-7 text-muted-foreground">각자 하루 한 통의 편지.<br />서로의 생각과 일상을 천천히 나눕니다.</p><div aria-hidden="true" className="mt-8 border border-border bg-card p-5"><div className="flex justify-between text-[10px] font-medium text-accent"><span>DAY 01</span><span>서로에게 한 통</span></div><div className="mt-5 space-y-3"><div className="h-px w-full bg-border" /><div className="h-px w-5/6 bg-border" /><div className="h-px w-2/3 bg-border" /></div></div></article>
        <article className="flex flex-col bg-background p-7 sm:p-10"><div className="mb-8 flex items-start justify-between"><span className="text-6xl font-light leading-none text-accent">B</span><span className="pt-2 text-[10px] tracking-[0.12em] text-muted-foreground">CHOOSE A SCENE TOGETHER</span></div><h3 className="text-2xl font-semibold">첫 장면 만들기</h3><p className="mt-4 min-h-14 text-sm leading-7 text-muted-foreground">공동 선택으로 첫 장면 만들기.<br />같이 고르는 과정에서 서로를 알아갑니다.</p><div aria-hidden="true" className="mt-8 grid grid-cols-2 gap-3"><div className="flex min-h-24 items-center justify-center rounded-xl border border-accent bg-accent/5"><span className="size-8 rounded-full border border-accent" /></div><div className="flex min-h-24 items-center justify-center rounded-xl border border-border bg-muted"><span className="size-8 rounded-full border border-primary" /></div></div></article>
      </div>
      <div className="mt-7 flex flex-col justify-between gap-3 text-xs leading-6 text-muted-foreground lg:flex-row"><p>3일은 교류를 시작한 뒤의 기간이며, 소개 대기 기간은 별도입니다.</p><p>그 안에 친밀함·연애를 완성하거나 만남을 강제하지 않는다.</p></div>
      <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4 border-t border-border pt-6 text-xs"><span className="font-semibold text-accent">DAY 01—03 <span className="ml-2 font-normal text-foreground">교류</span></span><ArrowRight size={14} className="text-muted-foreground" /><span className="font-semibold text-accent">DAY 04 <span className="ml-2 font-normal text-foreground">각자 만남 의사 확인</span></span><span className="text-muted-foreground">양쪽이 희망하면 시간·장소 조율</span></div>
    </section>
  );
}

const FAQ = [
  { id: "waiting", title: "후보를 기다리는 동안은 어떻게 되나요?", text: "신청·검토·첫 소개 준비 전 대기는 무료입니다. 첫 소개를 제공할 준비와 현재 참여 가능성을 확인한 뒤 소개 이용료를 안내합니다. 준비된 날 정오 12시에 하루 최대 한 명을 소개하며, 매일 새 소개를 보장하지 않습니다. 활성 소개는 회원당 한 건이고, 상호 선택 뒤에는 새 소개를 멈춥니다." },
  { id: "not-started", title: "상호 선택 후 교류가 시작되지 못하면요?", text: "상호 선택 후 기본 결제 기한은 24시간입니다. 한쪽만 결제하고 상대가 미결제면 결제자의 교류비 24,000원 전액 환불과 소개 권리 복원 대상입니다. 양쪽 결제 뒤 A/B·시작일 합의는 기본 48시간, 양쪽 동의 시 24시간 한 번 연장할 수 있습니다. 끝내 실제 교류가 시작되지 않으면 교류비 전액 환불과 소개 권리 유지입니다. 기한 도래·요청 클릭이 실제 환불 완료를 뜻하지 않으며 현재 실제 PG는 미연결입니다." },
  { id: "cancellation", title: "신청이나 교류를 취소할 수 있나요?", text: "결제 후 첫 상대 프로필을 실제로 열람하기 전 취소는 소개비 전액 환불입니다. 교류비는 해당 날짜 콘텐츠가 실제 이용 가능하게 열린 DAY별로 미제공분을 산정합니다. 취소·환불 요청과 검토·실제 환불 완료를 구분하며 실제 PG와 접수·발송은 미연결인 가상 자료 데모입니다." },
  { id: "refund", title: "환불과 보유기간, 재이용 기준은 무엇인가요?", text: `${REFUND_NOTICE} 보유기간·재이용 기준은 별도 검토 중이며 실제 약관의 법률 검토 완료를 의미하지 않습니다. 현재는 가상 정책 산정·요청 데모이고 실제 환불은 하지 않습니다.` },
  { id: "visibility", title: "어떤 정보가 상대에게 공개되나요?", text: "공개 정보의 구체적인 범위와 동의 절차는 아직 확정되지 않았습니다. 화면에 등장하는 편지와 공동 선택은 서비스 화면 예시이며, 실제 회원 정보가 아닙니다. 이 데모에서는 실제 개인정보를 수집하지 않습니다." },
  { id: "contact", title: "문의는 어디에서 할 수 있나요?", text: "현재 데모에는 실제 문의 접수·발송 기능이나 문의 채널이 연결되어 있지 않습니다. 문의 내용이나 연락처를 입력받지 않습니다." },
];

function Pricing() {
  return (
    <section id="pricing" className="-mx-5 bg-muted px-5 py-16 sm:-mx-8 sm:px-8 sm:py-20 lg:-mx-12 lg:px-12" aria-labelledby="pricing-title">
      <SectionLabel number="04">CLEAR FROM THE BEGINNING</SectionLabel>
      <div className="grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-16"><div><h2 id="pricing-title" className="text-3xl font-semibold leading-[1.5] sm:text-[34px]">시작하기 전에,<br />분명하게 안내합니다.</h2><p className="mt-5 text-sm leading-7 text-muted-foreground">신청·검토·첫 소개 준비 전 대기는 무료.<br />첫 소개 준비와 현재 참여 가능성 확인 후 안내합니다.</p></div><div>
        <div className="flex flex-wrap items-center gap-5 border-b border-border pb-7"><div><p className="mb-3 text-xs text-muted-foreground">소개 이용료</p><span className="text-3xl font-semibold">{money(BEFORE_US.pricing.introduction)}</span></div><Plus size={18} className="text-muted-foreground" /><div><p className="mb-3 text-xs text-muted-foreground">상호 선택 후 교류비 · 각자</p><span className="text-3xl font-semibold">{money(BEFORE_US.pricing.exchangePerPerson)}</span></div></div>
        <div className="flex flex-wrap items-end justify-between gap-4 pt-6"><p className="text-sm">첫 교류까지 1인 총액 <span className="mt-2 block text-xs text-muted-foreground">부가세 포함 · 현장 비용 별도</span></p><strong className="text-4xl font-semibold text-primary sm:text-5xl">{money(BEFORE_US.pricing.firstExchangeTotalPerPerson)}</strong></div>
        <p className="mt-7 text-sm leading-7">이번 첫 교류 전 소개 횟수 추가 과금·자동 갱신 없음.</p><p className="mt-2 text-xs leading-6 text-muted-foreground">평생 무제한·매일 소개·연애 성공·예약 보장 아님.</p>
        <div className="mt-7 flex flex-wrap items-center gap-3"><Button asChild className={`h-12 rounded-full px-6 ${interaction}`}><Link to="/apply">소개 신청하기 <ArrowUpRight size={16} /></Link></Button><Button asChild variant="link" className={`h-12 px-0 text-foreground hover:text-primary ${interaction}`}><a href="#faq">대기·미시작·취소·환불·공개 범위·문의 FAQ <ArrowRight size={14} /></a></Button></div><p className="mt-3 text-[11px] text-muted-foreground">데모에서는 실제 신청이나 결제가 진행되지 않습니다.</p>
      </div></div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="grid gap-8 py-16 sm:py-20 lg:grid-cols-[5fr_7fr] lg:gap-16" aria-labelledby="faq-title">
      <div><p className="mb-5 text-xs font-semibold tracking-[0.15em] text-accent">BEFORE YOU BEGIN</p><h2 id="faq-title" className="text-3xl font-semibold">시작 전, 궁금한 것들.</h2><p className="mt-5 text-sm leading-7 text-muted-foreground">확정된 운영 기준과<br />아직 정해지지 않은 정책을 구분해 안내합니다.</p></div>
      <Accordion type="single" collapsible className="border-t border-border [&_[data-slot=accordion-content]]:motion-reduce:animate-none [&_svg]:motion-reduce:transition-none">
        {FAQ.map(item => <AccordionItem key={item.id} value={item.id} id={`faq-${item.id}`}><AccordionTrigger className={`py-6 text-[15px] hover:no-underline hover:text-primary ${interaction}`}>{item.title}</AccordionTrigger><AccordionContent className="pb-6 text-sm leading-7 text-muted-foreground">{item.text}</AccordionContent></AccordionItem>)}
      </Accordion>
    </section>
  );
}

export function PublicInformation({ section }: { section: "introduction" | "exchange" | "pricing" }) {
  return <div className="break-keep [overflow-wrap:anywhere]">{section === "introduction" && <><Introduction /><InitialOperation /></>}{section === "exchange" && <Exchange />}{section === "pricing" && <><Pricing /><Faq /></>}</div>;
}

export default function PublicHome() {
  return <div className="break-keep [overflow-wrap:anywhere]"><Hero /><Philosophy /><Introduction /><InitialOperation /><Exchange /><Pricing /><Faq /></div>;
}
