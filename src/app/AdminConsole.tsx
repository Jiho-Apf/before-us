import { useState } from "react"
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router"
import {
  ArrowRight,
  CalendarDays,
  CircleHelp,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessageSquare,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Users,
  Bell,
  FileClock,
  SlidersHorizontal,
} from "lucide-react"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select"
import { BEFORE_US } from "./config"
import { seoulDate } from "./admin-model"
import { GenderBalancePanel, OperationsCapacityPanel } from "./MatchingAssist"
import {
  ADMIN_ACCESS,
  TODO_ITEMS,
  consoleMembers,
  emptyConsole,
  funnelCounts,
  loadConsoleFixtures,
  paymentTotals,
  periodRange,
  replaceConsoleData,
  todoRecords,
  useConsoleData,
  waitingBucket,
  inRange,
  type DateRange,
  type MemberSummary,
  type Period,
} from "./admin-console-data"

export const ADMIN_NAV = [
  { path: "/admin", label: "대시보드", icon: LayoutDashboard },
  { path: "/admin/applicants", label: "신청자", icon: ClipboardList },
  { path: "/admin/members", label: "회원", icon: Users },
  { path: "/admin/introductions", label: "소개·매칭", icon: ListChecks },
  { path: "/admin/exchange", label: "교류", icon: MessageSquare },
  { path: "/admin/meetings", label: "약속", icon: CalendarDays },
  { path: "/admin/payments", label: "결제", icon: CreditCard },
  { path: "/admin/safety", label: "신고·안전", icon: ShieldAlert },
  { path: "/admin/reviews", label: "후기", icon: CircleHelp },
  { path: "/admin/notifications", label: "알림", icon: Bell },
  { path: "/admin/settings", label: "운영설정", icon: Settings2 },
  { path: "/admin/audit", label: "감사로그", icon: FileClock },
] as const
const dateTime = (at: string | null) =>
  at
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(at))
    : "기록 없음"
const number = (value: number) => value.toLocaleString("ko-KR")
const money = (value: number) => `${number(value)}원`
const statusLabel: Record<string, string> = {
  pending: "검토 대기",
  "photo-revision": "보완 요청",
  waiting: "소개 대기",
  reviewed: "검토 완료",
  idle: "활성 활동 없음",
  introduction: "응답 대기",
  mutual: "상호 선택",
  "exchange-payment": "교류비 결제 대기",
  agreement: "방식·시작일 합의",
  exchange: "교류 중",
  new: "신규",
  reviewing: "검토 중",
  closed: "종료",
  prepared: "준비 · 미공개",
  scheduled: "공개 예약",
}
function SectionTitle({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}
export function AdminLayout() {
  const [demoEntered, setDemoEntered] = useState(false)
  if (String(BEFORE_US.mode) !== "demo" || String(ADMIN_ACCESS.mode) !== "demo")
    return (
      <main className="p-8">
        <h1 className="text-xl font-semibold">관리자 권한 확인이 필요합니다.</h1>
        <p className="mt-3 text-sm">
          실제 서버 관리자 인증이 연결되어 있지 않아 접근을 제공하지 않습니다.
        </p>
      </main>
    )
  if (!demoEntered)
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary p-6 text-foreground">
        <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6 sm:p-8" aria-labelledby="admin-demo-title">
          <p className="text-xs font-semibold tracking-widest text-primary">BEFORE US · OWNER DEMO</p>
          <h1 id="admin-demo-title" className="mt-4 text-2xl font-semibold">별도의 가상 관리자 화면입니다.</h1>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            일반 회원 화면과 분리된 운영 시연입니다. 실제 개인정보·결제 데이터는 연결되어 있지 않습니다.
            이 진입 확인은 서버 인증이나 접근 권한 검증이 아닙니다. 실제 출시에는 관리자 화면·API·데이터 모두에 서버 권한 검사가 필요합니다.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => setDemoEntered(true)}>가상 Owner 데모 열기</Button>
            <Button asChild variant="outline"><Link to="/today">회원 화면으로 돌아가기</Link></Button>
          </div>
        </section>
      </main>
    )
  return <AdminConsoleLayout />
}
function AdminConsoleLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [dark, setDark] = useState(false)
  const data = useConsoleData()
  const matching = location.pathname === "/admin/matching"
  const active =
    ADMIN_NAV.find((item) => item.path === (matching ? "/admin/introductions" : location.pathname)) || ADMIN_NAV[0]
  if (String(BEFORE_US.mode) !== "demo" || String(ADMIN_ACCESS.mode) !== "demo")
    return (
      <main className="p-8">
        <h1 className="text-xl font-semibold">
          관리자 권한 확인이 필요합니다.
        </h1>
        <p className="mt-3 text-sm">
          이 프런트엔드에는 실제 서버 관리자 인증이 연결되어 있지 않아 접근을
          제공하지 않습니다.
        </p>
      </main>
    )
  return (
    <div
      className={`${
        dark ? "dark " : ""
      }min-h-screen bg-secondary font-sans text-foreground`}
    >
      <a
        href="#admin-content"
        className="fixed left-3 top-3 z-50 -translate-y-24 rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground focus:translate-y-0"
      >
        관리자 본문으로
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-card lg:flex">
        <div className="border-b border-border px-6 py-6">
          <Link to="/admin" className="text-xl font-bold">
            비포어스
            <span className="ml-2 inline-flex gap-1 align-middle">
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span className="h-2 w-2 rounded-full bg-accent" />
            </span>
          </Link>
          <p className="mt-1 text-xs tracking-widest text-muted-foreground">
            BEFORE US · OPERATIONS
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <p className="px-3 py-3 text-xs text-muted-foreground">관리자 콘솔</p>
          <nav aria-label="관리자 메뉴" className="grid gap-1">
            {ADMIN_NAV.map(({ path, label, icon: Icon }, index) => (
              <NavLink
                key={path}
                to={path}
                end={path === "/admin"}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 motion-reduce:transition-none ${
                    index === 10 ? "mt-4" : ""
                  } ${
                    isActive || (matching && path === "/admin/introductions")
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`
                }
              >
                <Icon size={17} strokeWidth={1.7} />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="border-t border-border p-5">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold">
            <ShieldCheck size={15} className="text-primary" />
            Owner · 가상 세션
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            서버 관리자 권한 미연결
            <br />
            메뉴 숨김은 보안이 아닙니다.
          </p>
        </div>
      </aside>
      <div className="lg:pl-56">
        <header className="sticky top-0 z-20 border-b border-border bg-card">
          <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-5 py-3 lg:px-8">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">ADMIN</span>
              <span className="text-border">/</span>
              <span className="font-semibold">{active.label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
                가상 관리자 · PG/DB 미연결
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDark((value) => !value)}
              >
                {dark ? "라이트" : "다크"}
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/">
                  <LogOut size={14} />
                  서비스 화면
                </Link>
              </Button>
            </div>
          </div>
          <div className="px-5 pb-3 lg:hidden">
            <Select value={active.path} onValueChange={navigate}>
              <SelectTrigger aria-label="관리자 메뉴 이동">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADMIN_NAV.map((item) => (
                  <SelectItem value={item.path} key={item.path}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>
        <main
          id="admin-content"
          className="mx-auto max-w-7xl px-5 py-7 lg:px-8"
        >
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs leading-5 text-muted-foreground">
              <span className="mr-2 font-semibold text-foreground">
                DEMO DATA ONLY
              </span>
              {data.source === "empty"
                ? "집계 자료 없음 · 모든 지표는 0에서 시작합니다."
                : "가상 기록 집계 · 실제 회원·실매출·실제 공개 이력이 아닙니다."}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => replaceConsoleData(loadConsoleFixtures())}
              >
                가상 자료 불러오기
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={data.source === "empty"}
                onClick={() => replaceConsoleData(emptyConsole())}
              >
                데모 초기화
              </Button>
            </div>
          </div>
          <Outlet />
        </main>
        <footer className="mx-auto max-w-7xl px-5 pb-6 text-xs leading-5 text-muted-foreground lg:px-8">
          Owner 한 명의 메모리 데모입니다. 실제 출시에는 모든 관리자
          페이지·API·내보내기에서 서버 인증과 역할 권한 검사가 필요합니다. URL
          비공개·클라이언트 가드는 보안 경계가 아닙니다.
        </footer>
      </div>
    </div>
  )
}
export function AdminDashboard() {
  const data = useConsoleData()
  const now = new Date()
  const today = seoulDate(now)
  const [period, setPeriod] = useState<Period>("7")
  const [custom, setCustom] = useState<DateRange>({ start: today, end: today })
  const range = periodRange(period, now, custom)
  const members = consoleMembers(data, now)
  const funnel = funnelCounts(data, range, now)
  const totals = paymentTotals(data, range, now)
  const countStage = (id: string) =>
    funnel.find((stage) => stage.id === id)?.count || 0
  const current = (test: (member: MemberSummary) => boolean) =>
    members.filter(test).length
  const query = (filter: string) =>
    `?filter=${encodeURIComponent(filter)}${
      range
        ? `&start=${range.start}&end=${range.end}`
        : `&start=${custom.start}&end=${custom.end}`
    }`
  const metrics = [
    {
      label: "전체 소개 신청",
      value: countStage("application"),
      path: "applicants",
      filter: "period",
      scope: "선택 기간 접수",
    },
    {
      label: "오늘 신규",
      value: members.filter((member) =>
        inRange(member.submittedAt, { start: today, end: today }, now),
      ).length,
      path: "applicants",
      filter: "today",
      scope: "서울 기준 오늘",
    },
    {
      label: "검토 대기",
      value: current((member) => member.status === "pending"),
      path: "applicants",
      filter: "pending",
      scope: "현재 상태",
    },
    {
      label: "보완 요청",
      value: current((member) => member.status === "photo-revision"),
      path: "applicants",
      filter: "photo-revision",
      scope: "현재 상태",
    },
    {
      label: "소개 가능 회원",
      value: current((member) => member.available),
      path: "members",
      filter: "available",
      scope: "현재 권리·참여·검토 확인",
    },
    {
      label: "소개 대기 회원",
      value: current((member) => member.waiting),
      path: "members",
      filter: "waiting",
      scope: "현재 상태",
    },
    {
      label: "현재 소개 가능 남성",
      value: current((member) => member.available && member.gender === "남성"),
      path: "members",
      filter: "available-male",
      scope: "본인 입력·확인값",
    },
    {
      label: "현재 소개 가능 여성",
      value: current((member) => member.available && member.gender === "여성"),
      path: "members",
      filter: "available-female",
      scope: "본인 입력·확인값",
    },
    {
      label: "오늘 공개 소개",
      value: new Set(
        data.events
          .filter(
            (event) =>
              event.stage === "introduction" &&
              inRange(event.at, { start: today, end: today }, now),
          )
          .flatMap((event) => event.memberIds),
      ).size,
      path: "introductions",
      filter: "published-today",
      scope: "공개 이벤트 · 예약 제외",
    },
    {
      label: "응답 대기",
      value: current((member) => member.activity === "introduction"),
      path: "introductions",
      filter: "response",
      scope: "현재 상태",
    },
    {
      label: "상호 선택",
      value: countStage("mutual"),
      path: "introductions",
      filter: "mutual",
      scope: "선택 기간 이벤트",
    },
    {
      label: "교류 중",
      value: current((member) => member.activity === "exchange"),
      path: "exchange",
      filter: "active",
      scope: "현재 상태",
    },
    {
      label: "3일 완료",
      value: countStage("completed"),
      path: "exchange",
      filter: "completed",
      scope: "선택 기간 이벤트",
    },
    {
      label: "양쪽 만남 희망",
      value: countStage("meeting"),
      path: "meetings",
      filter: "meeting",
      scope: "양쪽 응답 이벤트",
    },
    {
      label: "신규 신고",
      value: data.reports.filter(
        (report) =>
          report.status === "new" && inRange(report.createdAt, range, now),
      ).length,
      path: "safety",
      filter: "new",
      scope: "선택 기간 접수",
    },
    {
      label: "검토 중 신고",
      value: data.reports.filter((report) => report.status === "reviewing")
        .length,
      path: "safety",
      filter: "reviewing",
      scope: "현재 상태",
    },
  ]
  const buckets = [
    { id: "0-3", label: "0~3일" },
    { id: "4-7", label: "4~7일" },
    { id: "8-14", label: "8~14일" },
    { id: "over14", label: "14일 초과" },
  ].map((bucket) => ({
    ...bucket,
    count: members.filter(
      (member) =>
        member.waiting && waitingBucket(member.waitingDays) === bucket.id,
    ).length,
  }))
  const waiting = members.filter((member) => member.waiting)
  const maxWaiting = Math.max(1, ...buckets.map((bucket) => bucket.count))
  const maxFunnel = Math.max(1, ...funnel.map((stage) => stage.count))
  return (
    <div className="space-y-6">
      {data.reports.some(report => report.urgent && report.status !== "closed") && <Link to="/admin/safety?filter=urgent" className="block rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">긴급 신고 {data.reports.filter(report => report.urgent && report.status !== "closed").length}건 · 신고·안전에서 우선 확인 →</Link>}
      <Link to="/admin/analytics" className="inline-flex text-xs text-accent">기간별 운영 분석 · 표본과 분모 확인 →</Link>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-2 text-xs tracking-widest text-accent">
            OPERATIONS OVERVIEW
          </p>
          <h1 className="text-2xl font-semibold">대시보드</h1>
          <p className="mt-2 text-xs text-muted-foreground">
            {today} · Asia/Seoul · 개인 지표는 회원 수, 결제는 원장 건수
          </p>
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="집계 기간"
        >
          {[
            { id: "today", label: "오늘" },
            { id: "7", label: "최근 7일" },
            { id: "30", label: "최근 30일" },
            { id: "custom", label: "직접 설정" },
          ].map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={period === item.id ? "default" : "outline"}
              aria-pressed={period === item.id}
              onClick={() => setPeriod(item.id as Period)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
      {period === "custom" && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
          <label className="text-xs" htmlFor="range-start">
            시작일
          </label>
          <Input
            id="range-start"
            type="date"
            value={custom.start}
            onChange={(event) =>
              setCustom((value) => ({ ...value, start: event.target.value }))
            }
            className="w-40"
          />
          <label className="text-xs" htmlFor="range-end">
            종료일
          </label>
          <Input
            id="range-end"
            type="date"
            value={custom.end}
            onChange={(event) =>
              setCustom((value) => ({ ...value, end: event.target.value }))
            }
            className="w-40"
          />
          {!range && (
            <p role="alert" className="text-xs text-destructive">
              유효한 날짜와 시작일 ≤ 종료일을 확인해 주세요.
            </p>
          )}
        </div>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        {range
          ? `${range.start} ~ ${range.end} · 날짜 경계 포함`
          : "기간 미확정"}{" "}
        / 접수·공개·완료·결제는 기간 내 기록, 대기·활성은 현재 전체 상태입니다.
        자동 갱신은 직접 검토가 아닙니다.
      </p>
      <section aria-label="핵심 지표" className="space-y-4">
        {["신청·검토", "소개할 수 있는 회원", "소개 진행", "교류 이후·안전"].map((group, groupIndex) => (
          <div key={group}>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">{group}</p>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
              {metrics.slice(groupIndex * 4, groupIndex * 4 + 4).map((metric) => {
                const urgent = ["검토 대기", "보완 요청", "응답 대기", "신규 신고", "검토 중 신고"].includes(metric.label) && Number(metric.value) > 0
                const empty = Number(metric.value) === 0
                return (
                  <Link
                    key={metric.label}
                    to={`/admin/${metric.path}${query(metric.filter)}`}
                    className="group bg-card p-4 transition-colors duration-200 hover:bg-secondary motion-reduce:transition-none"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {urgent && <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />}
                        {metric.label}
                        {urgent && <span className="sr-only">· 확인 필요</span>}
                      </span>
                      <ArrowRight size={12} className="text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </div>
                    <p className={`my-2 text-3xl font-semibold tabular-nums ${empty ? "text-muted-foreground/50" : urgent ? "text-accent" : ""}`}>
                      {number(metric.value)}
                    </p>
                    <span className="text-xs text-muted-foreground">{metric.scope}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </section>
      <OperationsCapacityPanel state={data.admin} today={today} />
      <GenderBalancePanel state={data.admin} today={today} onChange={() => {}} />
      <section className="rounded-lg border border-border bg-card p-5">
        <SectionTitle
          title="결제 원장 요약"
          description="가상 원장 집계 · 실제 PG 데이터 / 실매출 아님 · 부가세 포함"
        >
          <Button asChild size="sm" variant="ghost">
            <Link to={`/admin/payments${query("all")}`}>
              원장 보기 <ArrowRight size={14} />
            </Link>
          </Button>
        </SectionTitle>
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-6">
          {[
            { label: "총 결제액", value: money(totals.gross), filter: "paid" },
            {
              label: "소개비 5,000원 결제",
              value: `${totals.introduction.length}건`,
              sub: money(
                totals.introduction.reduce(
                  (sum, payment) => sum + payment.amount,
                  0,
                ),
              ),
              filter: "introduction",
            },
            {
              label: "교류비 24,000원 결제",
              value: `${totals.exchange.length}건`,
              sub: money(
                totals.exchange.reduce(
                  (sum, payment) => sum + payment.amount,
                  0,
                ),
              ),
              filter: "exchange",
            },
            {
              label: "환불 요청",
              value: `${totals.requests.length}건`,
              filter: "refund-request",
            },
            {
              label: "환불액",
              value: money(totals.refund),
              filter: "refunded",
            },
            { label: "순수납액", value: money(totals.net), filter: "all" },
          ].map((item) => (
            <Link
              key={item.label}
              to={`/admin/payments${query(item.filter)}`}
              className="border-l-2 border-border pl-4 hover:border-accent"
            >
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="mt-2 text-lg font-semibold tabular-nums">
                {item.value}
              </p>
              {item.sub && (
                <p className="mt-1 text-xs text-muted-foreground">{item.sub}</p>
              )}
            </Link>
          ))}
        </div>
        <p className="mt-5 text-xs text-muted-foreground">
          순수납액 = 기간 내 수납 − 기간 내 환불. 과거 결제의 환불도 환불
          처리일로 집계하며, 미확정 환불 정책을 확정한 예시가 아닙니다.
        </p>
      </section>
      <div className="grid gap-6 xl:grid-cols-5">
        <section className="rounded-lg border border-border bg-card p-5 xl:col-span-3">
          <SectionTitle
            title="오늘 처리할 일"
            description="현재 미처리 기록 · 클릭하면 해당 필터 목록으로 이동"
          />
          <div className="divide-y divide-border">
            {TODO_ITEMS.map((item) => (
              <Link
                key={item.id}
                to={`/admin/${item.path}?filter=${item.id}`}
                className="flex items-center justify-between gap-4 py-3 text-sm hover:text-primary"
              >
                <span className="flex items-center gap-3">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      item.id === "new-report" ? "bg-destructive" : "bg-accent"
                    }`}
                  />
                  {item.label}
                </span>
                <span className="flex items-center gap-4">
                  <span className="min-w-6 text-right font-semibold tabular-nums">
                    {todoRecords(data, item.id, now).length}
                  </span>
                  <ArrowRight size={14} className="text-muted-foreground" />
                </span>
              </Link>
            ))}
          </div>
        </section>
        <section className="rounded-lg border border-border bg-card p-5 xl:col-span-2">
          <SectionTitle
            title="소개 대기 분포"
            description="대기 시작일부터 서울 날짜 기준 · 현재 회원"
          />
          <div className="space-y-5">
            {buckets.map((bucket) => (
              <Link
                key={bucket.id}
                to={`/admin/members?filter=wait-${bucket.id}`}
                className="block"
              >
                <div className="mb-2 flex justify-between text-xs">
                  <span>{bucket.label}</span>
                  <span className="font-semibold tabular-nums">
                    {bucket.count}명
                  </span>
                </div>
                <svg
                  viewBox="0 0 100 3"
                  aria-hidden="true"
                  className="h-2 w-full"
                >
                  <rect
                    width="100"
                    height="3"
                    rx="1"
                    className="fill-secondary"
                  />
                  <rect
                    width={(bucket.count / maxWaiting) * 100}
                    height="3"
                    rx="1"
                    className="fill-accent"
                  />
                </svg>
              </Link>
            ))}
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            기준일 확인 필요{" "}
            {waiting.filter((member) => member.waitingDays === null).length}명 ·
            14일은 8~14일 구간입니다.
          </p>
        </section>
      </div>
      <section className="rounded-lg border border-border bg-card p-5">
        <SectionTitle
          title="소개 대기 회원"
          description="본인 이력만 집계 · 과거 상대 프로필 재열람 목록이 아닙니다"
        >
          <Button asChild size="sm" variant="ghost">
            <Link to="/admin/members?filter=waiting">
              전체 목록 <ArrowRight size={14} />
            </Link>
          </Button>
        </SectionTitle>
        <MemberTable
          members={waiting
            .slice()
            .sort(
              (left, right) =>
                (right.waitingDays ?? -1) - (left.waitingDays ?? -1),
            )
            .slice(0, 5)}
        />
      </section>
      <section className="rounded-lg border border-border bg-card p-5">
        <SectionTitle
          title="기간별 진행 퍼널"
          description="단계별 발생 이벤트의 중복 없는 회원 수 · 동일 신청 코호트의 전환율이 아닙니다"
        />
        <div className="grid gap-4 sm:grid-cols-4 xl:grid-cols-8">
          {funnel.map((stage, index) => (
            <div key={stage.id} className="border-l border-border pl-3">
              <p className="mb-3 text-xs text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </p>
              <p className="min-h-8 text-xs">{stage.label}</p>
              <p className="mb-4 mt-2 text-2xl font-semibold tabular-nums">
                {stage.count}
              </p>
              <svg
                viewBox="0 0 100 4"
                className="h-2 w-full"
                aria-hidden="true"
              >
                <rect height="4" width="100" className="fill-secondary" />
                <rect
                  height="4"
                  width={(stage.count / maxFunnel) * 100}
                  className="fill-primary"
                />
              </svg>
            </div>
          ))}
        </div>
        <p className="mt-5 text-xs text-muted-foreground">
          표본이 없으면 0입니다. 성공률·궁합 점수·예상 대기일을 생성하지
          않습니다.
        </p>
      </section>
    </div>
  )
}
function MemberTable({ members }: { members: MemberSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full whitespace-nowrap text-left text-xs">
        <caption className="sr-only">가상 회원 운영 요약</caption>
        <thead className="bg-secondary text-muted-foreground">
          <tr>
            {[
              "회원 코드",
              "현재 상태",
              "대기 일수",
              "최근 소개일",
              "누적 소개",
              "운영자 직접 검토",
            ].map((label) => (
              <th key={label} className="px-3 py-3 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id} className="border-b border-border">
              <th scope="row" className="px-3 py-4 font-medium">
                <Link
                  to={`/admin/introductions?member=${encodeURIComponent(member.id)}`}
                  className="text-accent hover:underline"
                >
                  {member.id}
                </Link>
              </th>
              <td className="px-3 py-4">
                {statusLabel[member.status]}
                {member.activity !== "idle"
                  ? ` · ${statusLabel[member.activity]}`
                  : ""}
              </td>
              <td className="px-3 py-4 tabular-nums">
                {member.waiting
                  ? member.waitingDays === null
                    ? "확인 필요"
                    : `${member.waitingDays}일`
                  : "—"}
              </td>
              <td className="px-3 py-4">
                {dateTime(member.recentIntroductionAt)}
              </td>
              <td className="px-3 py-4 tabular-nums">
                {member.introductionCount === null
                  ? "확인 필요"
                  : `${member.introductionCount}회`}
              </td>
              <td className="px-3 py-4">{dateTime(member.lastReviewedAt)}</td>
            </tr>
          ))}
          {members.length === 0 && (
            <tr>
              <td colSpan={6} className="p-8 text-center text-muted-foreground">
                해당 기록이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
function RecordTable({
  headers,
  rows,
}: {
  headers: string[]
  rows: string[][]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full whitespace-nowrap text-left text-xs">
        <thead className="bg-secondary text-muted-foreground">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className="border-b border-border">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-4">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={headers.length}
                className="p-8 text-center text-muted-foreground"
              >
                데이터 없음 · 기록을 임의로 생성하지 않습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
export function AdminList({ section }: { section: string }) {
  const data = useConsoleData()
  const [params, setParams] = useSearchParams()
  const now = new Date()
  const today = seoulDate(now)
  const filter = params.get("filter") || "all"
  const [search, setSearch] = useState("")
  const title =
    ADMIN_NAV.find((item) => item.path === `/admin/${section}`)?.label ||
    "관리 목록"
  const range =
    params.has("start") || params.has("end")
      ? periodRange("custom", now, {
          start: params.get("start") || "",
          end: params.get("end") || "",
        })
      : { start: "1970-01-01", end: today }
  const members = consoleMembers(data, now)
  const todo = TODO_ITEMS.find((item) => item.id === filter)
  const stageIds =
    filter === "published-today"
      ? "introduction"
      : filter === "mutual"
        ? "mutual"
        : filter === "completed"
          ? "completed"
          : filter === "meeting"
            ? "meeting"
            : null
  const eventIds = stageIds
    ? new Set(
        data.events
          .filter(
            (event) =>
              event.stage === stageIds &&
              inRange(
                event.at,
                filter === "published-today"
                  ? { start: today, end: today }
                  : range,
                now,
              ),
          )
          .flatMap((event) => event.memberIds),
      )
    : null
  const filteredMembers = members.filter((member) => {
    if (params.get("member") && member.id !== params.get("member")) return false
    if (search && !member.id.toLowerCase().includes(search.toLowerCase()))
      return false
    if (todo && !["noon", "new-report"].includes(filter))
      return todoRecords(data, filter, now).some(
        (record) => record.id === member.id,
      )
    if (eventIds) return eventIds.has(member.id)
    if (filter.startsWith("wait-"))
      return (
        member.waiting && waitingBucket(member.waitingDays) === filter.slice(5)
      )
    if (filter === "waiting") return member.waiting
    if (filter === "available") return member.available
    if (filter === "available-male" || filter === "available-female")
      return (
        member.available &&
        member.gender === (filter === "available-male" ? "남성" : "여성")
      )
    if (filter === "pending" || filter === "photo-revision")
      return member.status === filter
    if (filter === "response") return member.activity === "introduction"
    if (filter === "active") return member.activity === "exchange"
    if (filter === "today")
      return inRange(member.submittedAt, { start: today, end: today }, now)
    if (filter === "period") return inRange(member.submittedAt, range, now)
    if (section === "exchange")
      return ["exchange", "exchange-payment", "agreement", "mutual"].includes(
        member.activity,
      )
    if (section === "meetings")
      return data.events.some(
        (event) =>
          event.stage === "meeting" &&
          event.memberIds.includes(member.id) &&
          inRange(event.at, range, now),
      )
    return true
  })
  const filterOptions =
    section === "payments"
      ? [
          { id: "introduction", label: "소개비" },
          { id: "exchange", label: "교류비" },
          { id: "refund-request", label: "환불 요청" },
          { id: "refunded", label: "환불 처리" },
        ]
      : section === "safety"
        ? [
            { id: "new", label: "신규 신고" },
            { id: "reviewing", label: "검토 중" },
            { id: "new-report", label: "신규·긴급" },
          ]
        : [
            { id: "pending", label: "검토 대기" },
            { id: "waiting", label: "소개 대기" },
            { id: "available", label: "소개 가능" },
          ]
  const filterLabel =
    todo?.label ||
    ({
      all: "전체",
      period: "기간 내 접수",
      today: "오늘 신규",
      "photo-revision": "보완 요청",
      "available-male": "소개 가능 남성",
      "available-female": "소개 가능 여성",
      "published-today": "오늘 공개",
      response: "응답 대기",
      mutual: "상호 선택",
      active: "교류 중",
      completed: "3일 완료",
      meeting: "양쪽 만남 희망",
      "wait-0-3": "0~3일 대기",
      "wait-4-7": "4~7일 대기",
      "wait-8-14": "8~14일 대기",
      "wait-over14": "14일 초과 대기",
      paid: "결제 완료",
    } as Record<string, string>)[filter] ||
    filterOptions.find((item) => item.id === filter)?.label ||
    filter
  const paymentRows = data.payments
    .filter(
      (payment) =>
        (filter === "refunded"
          ? inRange(payment.refundedAt, range, now)
          : filter === "refund-request"
            ? inRange(payment.refundRequestedAt, range, now)
            : filter === "all"
              ? inRange(payment.paidAt, range, now) ||
                inRange(payment.refundedAt, range, now) ||
                inRange(payment.refundRequestedAt, range, now)
              : inRange(payment.paidAt, range, now)) &&
        (filter === "introduction" || filter === "exchange"
          ? payment.kind === filter
          : true) &&
        (!search ||
          payment.id.includes(search) ||
          payment.memberId.includes(search)),
    )
    .map((payment) => [
      payment.id,
      payment.memberId,
      payment.kind === "introduction" ? "소개비" : "교류비",
      money(payment.amount),
      dateTime(payment.paidAt),
      payment.refundRequestedAt ? "요청 있음" : "—",
      money(payment.refundAmount),
      dateTime(payment.refundedAt),
    ])
  const reports = data.reports.filter(
    (report) =>
      (!params.get("report") || report.id === params.get("report")) &&
      (filter === "new-report"
        ? report.status !== "closed" &&
          (report.status === "new" || report.urgent)
        : filter === "new"
          ? report.status === "new" && inRange(report.createdAt, range, now)
          : filter === "reviewing"
            ? report.status === "reviewing"
            : true) &&
      (!search ||
        report.id.includes(search) ||
        report.memberId.includes(search)),
  )
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs tracking-widest text-accent">
            OPERATIONS / RECORDS
          </p>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-2 text-xs text-muted-foreground">
            민감한 본문 없이 운영 상태만 표시합니다. 가상 자료에서 실제 해당
            건을 필터합니다.
          </p>
        </div>
        {section === "introductions" && (
          <Button asChild size="sm">
            <Link
              to={
                params.get("member")
                  ? `/admin/matching?member=${encodeURIComponent(params.get("member")!)}`
                  : "/admin/matching"
              }
            >
              신청 검토·후보 준비 <ArrowRight size={14} />
            </Link>
          </Button>
        )}
      </div>
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <SlidersHorizontal size={16} className="text-muted-foreground" />
          <Select
            value={filter}
            onValueChange={(value) => {
              const next = new URLSearchParams(params)
              next.set("filter", value)
              setParams(next)
            }}
          >
            <SelectTrigger aria-label="관리 목록 필터" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              {!filterOptions.some((item) => item.id === filter) &&
                filter !== "all" && (
                  <SelectItem value={filter}>{filterLabel}</SelectItem>
                )}
              {filterOptions.map((item) => (
                <SelectItem value={item.id} key={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="가상 회원 코드 또는 기록 코드 검색"
            placeholder="회원·기록 코드 검색"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-60"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setParams({})
              setSearch("")
            }}
          >
            필터 초기화
          </Button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          적용 필터: {filterLabel}
          {params.has("start")
            ? ` · ${params.get("start")} ~ ${params.get("end")}`
            : " · 현재 상태"}
        </p>
        {section === "payments" ? (
          <RecordTable
            headers={[
              "가상 거래",
              "회원",
              "구분",
              "결제액",
              "결제일",
              "환불 요청",
              "환불액",
              "환불일",
            ]}
            rows={paymentRows}
          />
        ) : section === "safety" ? (
          <RecordTable
            headers={["신고 코드", "회원 코드", "상태", "긴급 여부", "접수일"]}
            rows={reports.map((report) => [
              report.id,
              report.memberId,
              statusLabel[report.status],
              report.urgent ? "긴급" : "일반",
              dateTime(report.createdAt),
            ])}
          />
        ) : section === "audit" ? (
          <RecordTable
            headers={["시각", "가상 역할", "행위", "대상"]}
            rows={data.audits
              .filter(
                (entry) =>
                  !search ||
                  entry.action.includes(search) ||
                  entry.target.includes(search),
              )
              .map((entry) => [
                dateTime(entry.at),
                entry.actor,
                entry.action,
                entry.target,
              ])}
          />
        ) : section === "reviews" || section === "notifications" ? (
          <>
            <RecordTable headers={["기록 코드", "상태", "일시"]} rows={[]} />
            <p className="mt-4 text-xs leading-6 text-muted-foreground">
              {section === "reviews"
                ? "후기 자료 없음 · 회원 후기·홍보 사진 사용 동의를 대신 생성하지 않습니다."
                : "발송 기능 미연결 · 정오 알림 동의와 발송 이력은 실제 구현 전까지 생성하지 않습니다."}
            </p>
          </>
        ) : section === "introductions" && filter === "noon" ? (
          <RecordTable
            headers={["가상 제안", "회원 코드", "상태", "서울 공개 예정"]}
            rows={data.admin.proposals
              .filter((proposal) =>
                todoRecords(data, "noon", now).some(
                  (record) => record.id === proposal.id,
                ),
              )
              .map((proposal) => [
                proposal.id,
                proposal.members.join(" / "),
                statusLabel[proposal.status],
                dateTime(proposal.scheduledAt),
              ])}
          />
        ) : (
          <MemberTable members={filteredMembers} />
        )}
        {section === "introductions" && filter === "all" && (
          <div className="mt-6">
            <SectionTitle
              title="소개 준비·예약 기록"
              description="준비는 공개 이력이 아닙니다."
            />
            <RecordTable
              headers={["가상 제안", "회원 코드", "상태", "공개 예정"]}
              rows={data.admin.proposals
                .filter(
                  (proposal) =>
                    (!params.get("member") ||
                      proposal.members.includes(params.get("member")!)) &&
                    (!search ||
                      proposal.id.includes(search) ||
                      proposal.members.some((id) => id.includes(search))),
                )
                .map((proposal) => [
                  proposal.id,
                  proposal.members.join(" / "),
                  statusLabel[proposal.status],
                  dateTime(proposal.scheduledAt),
                ])}
            />
          </div>
        )}
      </section>
      {section === "payments" && (
        <p className="text-xs text-muted-foreground">
          가상 결제 원장입니다. 실제 PG 조회·결제·환불 실행은 연결되지 않았으며
          과거 거래를 새 정책으로 재작성하지 않습니다.
        </p>
      )}
    </div>
  )
}
export function AdminSettings() {
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs tracking-widest text-accent">
          POLICY / ACCESS
        </p>
        <h1 className="text-2xl font-semibold">운영설정</h1>
      </div>
      <section className="rounded-lg border border-border bg-card p-5">
        <SectionTitle
          title="적용 정책 · 읽기 전용"
          description="가격·시간·정책은 기존 V6 설정을 참조합니다."
        />
        <RecordTable
          headers={["항목", "현재 값", "구분"]}
          rows={[
            [
              "브랜드 / 정책",
              `${BEFORE_US.brand.name} · ${BEFORE_US.policyVersion}`,
              "적용 설정",
            ],
            [
              "소개 / 교류",
              `${money(BEFORE_US.pricing.introduction)} / 각자 ${money(BEFORE_US.pricing.exchangePerPerson)}`,
              "첫 교류 총 29,000원 · 부가세 포함",
            ],
            [
              "소개 시각",
              `${BEFORE_US.introduction.readyAt} · ${BEFORE_US.introduction.timezone}`,
              "준비된 날 최대 하루 한 명",
            ],
            [
              "소개 권리",
              "첫 A/B 프로그램 실제 시작 전까지",
              "횟수 추가 과금·자동 갱신 없음",
            ],
            [
              "성인 / 추가 필수 조건",
              `만 ${BEFORE_US.operatingDraft.minimumAge}세 / 최대 ${BEFORE_US.operatingDraft.additionalRequiredConditionsMaximum}개`,
              "운영 초안",
            ],
            [
              "환불 / 제공·보유 기간 / 재이용",
              "V6-refund-01 / V6-provision-01·V6-privacy-01 초안 / V6-conduct-01",
              "운영 기준 · 실제 약관 법률 검토 필요",
            ],
          ]}
        />
      </section>
      <section className="rounded-lg border border-border bg-card p-5">
        <SectionTitle
          title="Owner 및 향후 역할 분리"
          description="현재는 가상 Owner 한 명만 시연하며 아래 역할은 설계상의 경계입니다. 실제 권한을 부여하지 않습니다."
        />
        <RecordTable
          headers={["역할", "분리할 권한"]}
          rows={[
            ["Owner", "운영 설정·권한 관리"],
            ["Operator", "신청·필수 조건 검토·후보 준비"],
            ["Finance", "결제 원장·환불 검토"],
            ["Support", "문의·신고·안전·동의한 알림 운영"],
          ]}
        />
        <p className="mt-5 text-sm leading-7 text-muted-foreground">
          실제 출시 전 서버 세션·역할별 최소 권한·모든 API 접근 제어·개인정보
          접근 감사·원자적 배정 잠금이 필요합니다. 편지 본문·신분 자료·이상형
          자유입력은 대시보드 DTO와 감사 로그에서 제외합니다.
        </p>
      </section>
    </div>
  )
}
