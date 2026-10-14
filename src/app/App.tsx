import { Suspense, lazy, useState, useEffect, type ComponentType } from "react";
import { motion, useReducedMotion } from "motion/react";
import { createBrowserRouter, RouterProvider, NavLink, Link, Outlet, useLocation } from "react-router";
import { Button } from "./components/ui/button";
import { BEFORE_US } from "./config";
import { Calendar, User, Home, ArrowRight, X, Sun, Moon, Users, MessageCircle, Menu, LogOut } from "lucide-react";
import PublicHome, { PublicInformation } from "./PublicHome";

// 공개 홈만 바로 불러오고, 회원·데모·관리자 화면은 그 화면을 열 때 따로 불러온다.
const later = <T, K extends keyof T>(load: () => Promise<T>, name: K) =>
  lazy(async () => ({ default: (await load())[name] as T[K] extends ComponentType<any> ? T[K] : never }));
const MemberToday = later(() => import("./MemberToday"), "default");
const TodayDemo = later(() => import("./MemberToday"), "TodayDemo");
const ApplicationForm = later(() => import("./ApplicationForm"), "default");
const MemberProfile = later(() => import("./MemberProfile"), "default");
const MemberSupport = later(() => import("./MemberProfile"), "MemberSupport");
const PhotoDemo = later(() => import("./PhotoStep"), "PhotoDemo");
const AdminDemo = later(() => import("./AdminDemo"), "default");
const AdminDashboard = later(() => import("./AdminConsole"), "AdminDashboard");
const AdminLayout = later(() => import("./AdminConsole"), "AdminLayout");
const AdminList = later(() => import("./AdminConsole"), "AdminList");
const AdminGovernance = later(() => import("./AdminGovernance"), "AdminGovernance");
const AdminOperations = later(() => import("./AdminOperations"), "AdminOperations");
const MemberPayments = later(() => import("./PaymentFlow"), "default");
const PaymentDemo = later(() => import("./PaymentFlow"), "PaymentDemo");
const MemberIntroduction = later(() => import("./IntroductionFlow"), "default");
const IntroductionDemo = later(() => import("./IntroductionFlow"), "IntroductionDemo");
const NoonDemo = later(() => import("./NoonStatus"), "NoonDemo");
const AgreementDemo = later(() => import("./AgreementFlow"), "AgreementDemo");
const MemberAgreement = later(() => import("./AgreementFlow"), "MemberAgreement");
const MemberMeeting = later(() => import("./AgreementFlow"), "MemberMeeting");
const LetterDemo = later(() => import("./LetterDemo"), "LetterDemo");
const SceneDemo = later(() => import("./SceneDemo"), "SceneDemo");
const MeetingDemo = later(() => import("./MeetingDemo"), "MeetingDemo");
const ConductDemo = later(() => import("./ConductPolicy"), "ConductDemo");
const PrivacyDemo = later(() => import("./PrivacyPanels"), "PrivacyDemo");
const InquiryPage = later(() => import("./InquiryPage"), "default");
const TermsPage = later(() => import("./LegalPages"), "TermsPage");
const PrivacyPage = later(() => import("./LegalPages"), "PrivacyPage");

function RouteFallback() {
  return <div role="status" aria-live="polite" className="flex flex-1 items-center justify-center py-24"><span className="sr-only">화면을 불러오는 중</span><span aria-hidden="true" className="flex gap-1.5"><span className="size-2 animate-pulse rounded-full bg-primary" /><span className="size-2 animate-pulse rounded-full bg-accent [animation-delay:150ms]" /></span></div>;
}


const PUBLIC_NAV = [
  { to: "/how-it-works", label: "진행 방식", number: "01" },
  { to: "/two-starts", label: "두 가지 시작", number: "02" },
  { to: "/pricing", label: "이용 요금", number: "03" },
  { to: "/faq", label: "자주 묻는 질문", number: "04" },
  { to: "/contact", label: "문의하기", number: "05" },
];

const MEMBER_NAV = [
  { to: "/today", label: "오늘", icon: Home },
  { to: "/us", label: "두 사람", icon: Users },
  { to: "/exchange", label: "교류", icon: MessageCircle },
  { to: "/meeting", label: "약속", icon: Calendar },
  { to: "/profile", label: "내 정보", icon: User },
];

const CONTROL_MOTION = "transition-colors duration-200 motion-reduce:transition-none";

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" aria-label={`${BEFORE_US.brand.name} 공개 홈`} className="flex w-fit shrink-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
      <span aria-hidden="true" className="flex gap-1.5">
        <span className="size-3 rounded-full bg-primary" />
        <span className="size-3 rounded-full bg-accent" />
      </span>
      <span className="flex flex-col gap-1">
        <span className={`${compact ? "text-xl" : "text-2xl"} whitespace-nowrap font-bold leading-none`}>{BEFORE_US.brand.name}</span>
        <span className="whitespace-nowrap text-[11px] font-semibold leading-none tracking-[0.18em] text-muted-foreground">{BEFORE_US.brand.english}</span>
      </span>
    </Link>
  );
}

function ShellThemeToggle({ isDark, toggle }: { isDark: boolean; toggle: () => void }) {
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"} className={`rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${CONTROL_MOTION}`}>
      {isDark ? <Sun size={17} /> : <Moon size={17} />}
    </Button>
  );
}

function PageTransition() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  // 다른 페이지로 옮기면 맨 위에서 시작한다. 해시(#faq-…)로 가는 경우는 그 화면이 직접 스크롤한다.
  useEffect(() => { if (!location.hash) window.scrollTo(0, 0); }, [location.pathname]);
  return <motion.div key={location.pathname} initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : 0.24 }} className="flex flex-1 flex-col"><Suspense fallback={<RouteFallback />}><Outlet /></Suspense></motion.div>;
}

function PublicShell({ isDark, toggle }: { isDark: boolean; toggle: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex min-h-24 max-w-7xl items-center justify-between gap-5 px-5 sm:px-8 lg:px-12">
          <Brand />
          <nav aria-label="공개 메뉴" className="hidden items-center gap-8 lg:flex">
            {PUBLIC_NAV.map(item => <NavLink key={item.to} to={item.to} className={({ isActive }) => `rounded-sm py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${CONTROL_MOTION} ${isActive ? "text-primary" : "text-foreground hover:text-primary"}`}>{item.label}</NavLink>)}
          </nav>
          <div className="flex items-center gap-2 sm:gap-4">
            <ShellThemeToggle isDark={isDark} toggle={toggle} />
            <Button asChild variant="ghost" className={`hidden hover:bg-muted hover:text-foreground sm:inline-flex ${CONTROL_MOTION}`}><Link to="/login">로그인</Link></Button>
            <Button asChild className={`h-11 rounded-full px-4 text-[13px] sm:px-5 sm:text-sm ${CONTROL_MOTION}`}><Link to="/apply">소개 신청하기 <ArrowRight size={15} className="hidden sm:block" /></Link></Button>
            <Button variant="ghost" size="icon" aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"} aria-expanded={menuOpen} aria-controls="public-mobile-menu" onClick={() => setMenuOpen(open => !open)} className={`lg:hidden hover:bg-muted hover:text-foreground ${CONTROL_MOTION}`}>
              {menuOpen ? <X /> : <Menu />}
            </Button>
          </div>
        </div>
        {menuOpen && <nav id="public-mobile-menu" aria-label="모바일 공개 메뉴" className="grid gap-1 border-t border-border px-5 py-4 lg:hidden">
          {PUBLIC_NAV.map(item => <Button key={item.to} asChild variant="ghost" className={`justify-start rounded-xl hover:bg-muted hover:text-primary ${CONTROL_MOTION}`}><NavLink to={item.to}>{item.label}</NavLink></Button>)}
          <Button asChild variant="ghost" className={`justify-start hover:bg-muted hover:text-primary ${CONTROL_MOTION}`}><Link to="/login">로그인</Link></Button>
        </nav>}
      </header>
      <main id="main-content" className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 sm:px-8 lg:px-12">
        <PageTransition />
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-7xl break-keep px-5 py-8 text-xs sm:px-8 lg:px-12">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
            <span className="font-semibold tracking-[0.12em]">{BEFORE_US.brand.english}</span>
            <span className="text-muted-foreground">{BEFORE_US.brand.message}</span>
            <nav aria-label="정책과 문의" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground">
              <Link to="/terms" className="underline-offset-4 hover:text-primary hover:underline">이용약관</Link>
              <Link to="/privacy" className="font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline">개인정보처리방침</Link>
              <Link to="/faq" className="underline-offset-4 hover:text-primary hover:underline">자주 묻는 질문</Link>
              <Link to="/contact" className="underline-offset-4 hover:text-primary hover:underline">문의하기</Link>
            </nav>
          </div>
          <div className="mt-6 space-y-1 border-t border-border pt-5 leading-6 text-muted-foreground"><p>상호 · 대표자 · 사업자등록번호 · 통신판매업 신고번호 · 준비 중</p><p>만 19세 이상 대상 일대일 소개</p></div>
        </div>
      </footer>
    </div>
  );
}

function MemberShell({ isDark, toggle }: { isDark: boolean; toggle: () => void }) {
  const location = useLocation();
  const current = MEMBER_NAV.find(item => item.to === location.pathname || (item.to === "/meeting" && location.pathname === "/meeting/contact"));
  const memberPath = (to: string) => new URLSearchParams(location.search).get("demo") === "agreement" && ["/today", "/us", "/exchange", "/meeting", "/profile", "/payments", "/support"].includes(to) ? `${to}?demo=agreement` : to;
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <aside className="sticky top-0 hidden h-dvh w-[200px] shrink-0 flex-col border-r border-border bg-card px-4 py-8 md:flex">
        <div className="px-2"><Brand compact /></div>
        <nav aria-label="회원 메뉴" className="mt-16 grid gap-2">
          {MEMBER_NAV.map(({ to, label, icon: Icon }) => <NavLink key={to} to={memberPath(to)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-4 py-3.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring ${CONTROL_MOTION} ${isActive ? "bg-primary/8 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon size={18} strokeWidth={1.6} />{label}</NavLink>)}
        </nav>
        <div className="mt-auto border-t border-border pt-5">
          <span className="block px-4 pb-3 text-xs text-muted-foreground">데모 둘러보기</span>
          <Button asChild variant="ghost" className={`w-full justify-start gap-3 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground ${CONTROL_MOTION}`}><Link to="/"><LogOut size={16} />공개 홈으로</Link></Button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pb-24 md:pb-0">
        <header className="border-b border-border">
          <div className="mx-auto flex h-20 max-w-[1120px] items-center justify-between px-5 sm:px-8 lg:px-10">
            <div className="md:hidden"><Brand compact /></div>
            <div className="hidden items-center gap-3 text-xs md:flex"><span className="text-muted-foreground">{BEFORE_US.brand.name}</span><span className="text-border">/</span><span>{current?.label}</span></div>
            <div className="flex items-center gap-3"><span className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">데모</span><ShellThemeToggle isDark={isDark} toggle={toggle} /></div>
          </div>
          <p className="border-t border-border bg-muted/40 px-5 py-2 text-center text-xs text-muted-foreground">데모 화면이에요. 실제 신청·결제·발송은 일어나지 않고, 새로고침하면 입력한 내용이 지워져요.</p>
        </header>
        <main id="main-content" className="mx-auto w-full max-w-[1120px] flex-1 px-5 py-10 sm:px-8 lg:px-10 lg:py-14"><PageTransition /></main>
      </div>
      <nav aria-label="모바일 회원 메뉴" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-card pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
        {MEMBER_NAV.map(({ to, label, icon: Icon }) => <NavLink key={to} to={memberPath(to)} className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-lg text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${CONTROL_MOTION} ${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}><Icon size={20} strokeWidth={1.6} />{label}</NavLink>)}
      </nav>
    </div>
  );
}

function ContentFrame({ title, publicHome = false }: { title: string; publicHome?: boolean }) {
  return (
    <section aria-label={title} className={`flex flex-1 flex-col ${publicHome ? "py-12 sm:py-16" : ""}`}>
      <div className="flex items-end justify-between gap-5 border-b border-border pb-7">
        <div><p className="mb-3 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">{BEFORE_US.brand.english}</p><h1 className="text-3xl font-semibold leading-snug sm:text-4xl">{title}</h1></div>
        <span aria-hidden="true" className="mb-1 flex gap-2"><span className="size-2 rounded-full bg-primary" /><span className="size-2 rounded-full bg-accent" /></span>
      </div>
      <div className="flex min-h-80 flex-1 items-center justify-center py-20 sm:min-h-96" aria-hidden="true">
        <div className="flex items-center gap-5 opacity-10"><span className="size-20 rounded-full border border-primary sm:size-28" /><span className="size-20 rounded-full border border-accent sm:size-28" /></div>
      </div>
    </section>
  );
}

function AccessFrame({ application = false }: { application?: boolean }) {
  return (
    <section className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-16 sm:py-24">
      <p className="mb-5 text-xs font-semibold tracking-[0.15em] text-accent">{BEFORE_US.brand.english}</p>
      <h1 className="text-3xl font-semibold">{application ? "소개 신청하기" : "로그인"}</h1>
      <div className="mt-8 rounded-2xl border border-border bg-muted p-7">
        <p className="text-base font-semibold">지금은 데모로 둘러볼 수 있어요.</p>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">실제 계정 생성, 소개 신청과 결제는 진행되지 않아요.</p>
        {!application && <p className="mt-3 text-xs leading-7 text-muted-foreground">계정 단계에는 사진이나 이상형 입력이 없어요. 소개 신청은 별도의 4단계로 진행해요.</p>}
        <Button asChild className={`mt-7 h-12 w-full rounded-xl ${CONTROL_MOTION}`}><Link to="/today">회원 공간 둘러보기 <ArrowRight size={16} /></Link></Button>
      </div>
      <Link to="/" className={`mt-6 w-fit rounded-sm text-sm text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring ${CONTROL_MOTION}`}>공개 홈으로 돌아가기</Link>
    </section>
  );
}

function MissingFrame() {
  return <section className="py-24"><h1 className="text-3xl font-semibold">페이지를 찾을 수 없어요.</h1><Button asChild className="mt-8 rounded-full"><Link to="/">공개 홈으로</Link></Button></section>;
}

function BeforeUsRoot() {
  const [isDark, setIsDark] = useState(false);
  const location = useLocation();
  const isMember = ["/payments","/support","/meeting/contact"].includes(location.pathname) || MEMBER_NAV.some(item => item.to === location.pathname);
  useEffect(() => {
    const label = [...PUBLIC_NAV, ...MEMBER_NAV, { to: "/login", label: "로그인" }, { to: "/apply", label: "소개 신청하기" }, { to: "/terms", label: "이용약관" }, { to: "/privacy", label: "개인정보처리방침" }].find(item => item.to === location.pathname)?.label;
    document.title = label ? `${label} · ${BEFORE_US.brand.name}` : `${BEFORE_US.brand.name} · ${BEFORE_US.brand.english}`;
  }, [location.pathname]);
  return (
    <div className={isDark ? "dark font-sans" : "font-sans"}>
      <a href="#main-content" className="fixed top-3 left-3 z-50 -translate-y-24 rounded-xl bg-primary px-5 py-3 text-sm text-primary-foreground focus:translate-y-0">본문으로 건너뛰기</a>
      {isMember ? <MemberShell isDark={isDark} toggle={() => setIsDark(value => !value)} /> : <PublicShell isDark={isDark} toggle={() => setIsDark(value => !value)} />}
    </div>
  );
}

const beforeUsRouter = createBrowserRouter([
  { path: "/admin", element: <Suspense fallback={<RouteFallback />}><AdminLayout /></Suspense>, children: [
    { index: true, element: <Suspense fallback={<RouteFallback />}><AdminDashboard /></Suspense> },
    ...(["applicants", "members", "introductions", "exchange"] as const).map(section => ({ path: section, element: <Suspense fallback={<RouteFallback />}><AdminOperations section={section} /></Suspense> })),
    { path: "meetings", element: <Suspense fallback={<RouteFallback />}><AdminList section="meetings" /></Suspense> },
    ...["payments", "safety", "reviews", "notifications", "audit", "settings", "analytics"].map(section => ({ path: section, element: <Suspense fallback={<RouteFallback />}><AdminGovernance key={section} section={section} /></Suspense> })),
    { path: "matching", element: <Suspense fallback={<RouteFallback />}><AdminDemo embedded /></Suspense> },
    { path: "*", element: <Suspense fallback={<RouteFallback />}><AdminList section="unknown" /></Suspense> },
  ] },
  { path: "/demo/admin", element: <Suspense fallback={<RouteFallback />}><AdminDemo /></Suspense> },
  { Component: BeforeUsRoot, children: [
    { index: true, element: <PublicHome /> },
    { path: "/how-it-works", element: <PublicInformation section="introduction" /> },
    { path: "/two-starts", element: <PublicInformation section="exchange" /> },
    { path: "/pricing", element: <PublicInformation section="pricing" /> },
    { path: "/faq", element: <PublicInformation section="faq" /> },
    { path: "/terms", element: <TermsPage /> },
    { path: "/privacy", element: <PrivacyPage /> },
    { path: "/contact", element: <InquiryPage /> },
    { path: "/today", element: <MemberToday /> },
    { path: "/payments", element: <MemberPayments /> },
    { path: "/us", element: <MemberIntroduction /> },
    { path: "/demo/introduction", element: <IntroductionDemo /> },
    { path: "/demo/noon", element: <NoonDemo /> },
    { path: "/demo/agreement", element: <AgreementDemo /> },
    { path: "/demo/letters", element: <LetterDemo /> },
    { path: "/demo/scene", element: <SceneDemo /> },
    { path: "/demo/meeting", element: <MeetingDemo /> },
    { path: "/demo/conduct", element: <ConductDemo /> },
    { path: "/demo/privacy", element: <PrivacyDemo /> },
    { path: "/exchange", element: <MemberAgreement /> },
    { path: "/demo/payments", element: <PaymentDemo /> },
    { path: "/meeting", element: <MemberMeeting /> },
    { path: "/meeting/contact", element: <MemberMeeting contactOnly /> },
    { path: "/profile", element: <MemberProfile /> },
    { path: "/support", element: <MemberSupport /> },
    ...MEMBER_NAV.filter(item => !["/today", "/meeting", "/us", "/exchange", "/profile"].includes(item.to)).map(item => ({ path: item.to, element: <ContentFrame title={item.label} /> })),
    { path: "/demo/today", element: <TodayDemo /> },
    { path: "/demo/photos", element: <PhotoDemo /> },
    { path: "/login", element: <AccessFrame /> },
    { path: "/apply", element: <ApplicationForm /> },
    { path: "*", element: <MissingFrame /> },
  ] },
]);

export default function App() {
  return <RouterProvider router={beforeUsRouter} />;
}
