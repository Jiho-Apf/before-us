import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { Bell, Bug, CalendarRange, HeartHandshake, ClipboardList, FileClock, LayoutDashboard, ListChecks, LogOut, Settings2, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { signIn, signOut, useAuth, useAuthReady } from "./auth-service";
import { friendlyError, rpc, supabase } from "./backend/client";
import { photoUrl } from "./backend/applications";
import { APPLICATION_FIELDS } from "./application-model";
import { PHOTO_REVIEW_REASONS, PHOTO_SLOTS } from "./photo-model";
import { INQUIRY_STATUS } from "./inquiry-model";
import { REQUEST_LABELS } from "./member-operations-model";
import { kstDateTime, kstDay } from "./dates";
import { cohortName } from "./cohort";

// 실제 서버 모드의 운영진 화면. 데모 운영 콘솔과 같은 틀을 쓰고, 모든 자료는 서버 권한(RLS·역할·2단계 인증)을 거쳐 온다.
// 화면에서 메뉴를 숨기는 것은 보안이 아니다. 권한은 서버 함수와 표 정책이 막는다.
type Role = "owner" | "operator" | "counselor" | "finance";
const ROLE_LABEL: Record<Role, string> = { owner: "대표", operator: "운영", counselor: "상담", finance: "정산" };
const NAV = [
  { path: "/admin", label: "대시보드", icon: LayoutDashboard },
  { path: "/admin/cohorts", label: "기수", icon: CalendarRange },
  { path: "/admin/applicants", label: "신청자", icon: ClipboardList },
  { path: "/admin/members", label: "회원", icon: Users },
  { path: "/admin/introductions", label: "소개·매칭", icon: ListChecks },
  { path: "/admin/programs", label: "교류·약속", icon: HeartHandshake },
  { path: "/admin/safety", label: "신고·문의", icon: ShieldAlert },
  { path: "/admin/audit", label: "감사로그", icon: FileClock },
  { path: "/admin/settings", label: "운영진", icon: Settings2 },
] as const;
const box = "rounded-lg border border-border bg-card";
const STATUS_LABEL: Record<string, string> = { draft: "작성 중", submitted: "접수", reviewing: "검토 중", needs_changes: "보완 요청", approved: "승인", held: "보류", withdrawn: "철회", rejected: "소개 어려움" };
const INTRO_LABEL: Record<string, string> = { reserved: "정오 예약", published: "공개", mutual: "서로 선택", closed: "종료", cancelled: "취소" };
const END_LABEL: Record<string, string> = { rejected: "한쪽 거절", nonresponse: "미응답", withdrawn: "탈퇴", blocked: "차단", "admin-cancel": "운영 취소", "missed-window": "정오 놓침" };

function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const reload = async () => { try { setState({ data: await load(), error: null, loading: false }); } catch (error) { setState({ data: null, error: friendlyError(error as Error), loading: false }); } };
  useEffect(() => { void reload(); }, deps);
  return { ...state, reload };
}
async function call<T>(name: string, args?: Record<string, unknown>) { const { data, error } = await rpc<T>(name, args); if (error) throw new Error(error); return data as T; }
async function table<T>(name: string, build: (query: any) => any) { const db = await supabase(); const { data, error } = await build(db.from(name)); if (error) throw new Error(friendlyError(error)); return (data ?? []) as T[]; }

function Title({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return <div className="mb-6"><h1 className="text-2xl font-semibold">{children}</h1>{lead && <p className="mt-2 text-sm leading-6 text-muted-foreground">{lead}</p>}</div>;
}
function Notice({ text }: { text: string }) { return text ? <p role="status" className="rounded-lg bg-muted px-4 py-3 text-xs leading-6">{text}</p> : null; }
function Gate({ title, children }: { title: string; children: ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-secondary p-6 text-foreground"><section className="w-full max-w-md rounded-xl border border-border bg-card p-6 sm:p-8"><p className="text-xs font-semibold tracking-widest text-primary">BEFORE US · OPERATIONS</p><h1 className="mt-4 text-2xl font-semibold">{title}</h1><div className="mt-6 space-y-4 text-sm">{children}</div></section></main>;
}

// ─────────────────────────────────────────────
// 입장: 로그인 → 운영진 역할 확인 → 2단계 인증(인증 앱 6자리)
export function LiveAdminLayout() {
  const user = useAuth();
  const ready = useAuthReady();
  const [role, setRole] = useState<Role | null | undefined>(undefined);
  const [aal, setAal] = useState<string | null>(null);
  const check = async () => {
    const db = await supabase();
    const { data } = await db.from("admin_roles").select("role").eq("user_id", user!.id).maybeSingle();
    setRole((data?.role as Role) ?? null);
    const level = await db.auth.mfa.getAuthenticatorAssuranceLevel();
    setAal(level.data?.currentLevel ?? null);
  };
  useEffect(() => { if (user) void check(); else { setRole(undefined); setAal(null); } }, [user?.id]);
  if (!ready) return <Gate title="확인하고 있어요.">{null}</Gate>;
  if (!user) return <AdminLogin />;
  if (role === undefined) return <Gate title="권한을 확인하고 있어요.">{null}</Gate>;
  if (role === null) return <Gate title="운영진 권한이 없는 계정이에요."><p className="leading-7 text-muted-foreground">대표가 운영진 화면에서 역할을 줘야 들어올 수 있어요.</p><Button variant="outline" onClick={signOut}>로그아웃</Button></Gate>;
  if (aal !== "aal2") return <SecondFactor onDone={check} />;
  return <AdminShell role={role} />;
}

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); const result = await signIn(email, password); setError(result.error || ""); };
  return <Gate title="운영진 로그인"><form onSubmit={submit} className="space-y-4" noValidate><Input type="email" aria-label="이메일" autoComplete="email" placeholder="이메일" value={email} onChange={event => setEmail(event.target.value)} /><Input type="password" aria-label="비밀번호" autoComplete="current-password" placeholder="비밀번호" value={password} onChange={event => setPassword(event.target.value)} />{error && <p role="alert" className="text-destructive">{error}</p>}<Button type="submit" className="w-full">로그인</Button></form><p className="text-xs leading-6 text-muted-foreground">로그인한 뒤 인증 앱(Google Authenticator 등)의 6자리 번호로 한 번 더 확인해요.</p><Link to="/" className="text-xs underline underline-offset-4">서비스 화면으로</Link></Gate>;
}

function SecondFactor({ onDone }: { onDone: () => Promise<void> }) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { void (async () => {
    const db = await supabase();
    const { data } = await db.auth.mfa.listFactors();
    const verified = data?.totp?.find(factor => factor.status === "verified");
    if (verified) { setFactorId(verified.id); return; }
    // 등록하다 만 인증 수단은 지우고 새로 만든다.
    for (const factor of data?.all ?? []) if (factor.status !== "verified") await db.auth.mfa.unenroll({ factorId: factor.id });
    const { data: enrolled, error } = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: `before-us-${Date.now().toString(36)}` });
    if (error || !enrolled) { setError(friendlyError(error, "인증 앱 등록을 시작하지 못했어요.")); return; }
    setFactorId(enrolled.id); setQr(enrolled.totp.qr_code); setSecret(enrolled.totp.secret);
  })(); }, []);
  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!factorId) return;
    const db = await supabase();
    const { error } = await db.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) { setError("번호가 맞지 않아요. 인증 앱의 지금 번호를 다시 넣어 주세요."); return; }
    await onDone();
  };
  return <Gate title={qr ? "인증 앱을 연결해 주세요." : "2단계 인증"}>
    {qr && <><p className="leading-7 text-muted-foreground">휴대폰의 인증 앱으로 아래 QR 코드를 찍어 주세요. 처음 한 번만 하면 돼요.</p><img src={qr} alt="인증 앱 등록 QR 코드" className="mx-auto size-44 rounded-lg border border-border bg-white p-2" />{secret && <p className="break-all text-center text-[11px] text-muted-foreground">직접 입력 키 · {secret}</p>}</>}
    <form onSubmit={verify} className="space-y-3"><Input inputMode="numeric" autoComplete="one-time-code" aria-label="인증 앱 6자리 번호" placeholder="6자리 번호" maxLength={6} value={code} onChange={event => { setCode(event.target.value.replace(/\D/g, "")); setError(""); }} />{error && <p role="alert" className="text-destructive">{error}</p>}<Button type="submit" disabled={code.length !== 6} className="w-full">확인</Button></form>
    <Button variant="ghost" size="sm" onClick={signOut}>다른 계정으로 로그인</Button>
  </Gate>;
}

function AdminShell({ role }: { role: Role }) {
  const location = useLocation();
  const user = useAuth();
  const [dark, setDark] = useState(false);
  const active = NAV.find(item => item.path === location.pathname) || NAV[0];
  return (
    <div className={`${dark ? "dark " : ""}min-h-screen bg-secondary font-sans text-foreground`}>
      <a href="#admin-content" className="fixed left-3 top-3 z-50 -translate-y-24 rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground focus:translate-y-0">관리자 본문으로</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-card lg:flex">
        <div className="border-b border-border px-6 py-6"><Link to="/admin" className="text-xl font-bold">비포어스<span className="ml-2 inline-flex gap-1 align-middle"><span className="h-2 w-2 rounded-full bg-primary" /><span className="h-2 w-2 rounded-full bg-accent" /></span></Link><p className="mt-1 text-xs tracking-widest text-muted-foreground">BEFORE US · OPERATIONS</p></div>
        <nav aria-label="관리자 메뉴" className="grid flex-1 content-start gap-1 overflow-y-auto p-3">{NAV.map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} end={path === "/admin"} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 motion-reduce:transition-none ${isActive ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}><Icon size={17} strokeWidth={1.7} />{label}</NavLink>)}</nav>
        <div className="border-t border-border p-5"><div className="mb-2 flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={15} className="text-primary" />{ROLE_LABEL[role]} · 2단계 인증</div><p className="break-all text-xs leading-5 text-muted-foreground">{user?.email}</p></div>
      </aside>
      <div className="lg:pl-56">
        <header className="sticky top-0 z-20 border-b border-border bg-card">
          <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-5 py-3 lg:px-8">
            <div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">ADMIN</span><span className="text-border">/</span><span className="font-semibold">{active.label}</span></div>
            <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" onClick={() => setDark(value => !value)}>{dark ? "라이트" : "다크"}</Button><Button size="sm" variant="outline" onClick={signOut}><LogOut size={14} />로그아웃</Button></div>
          </div>
          <nav aria-label="관리자 메뉴" className="flex gap-1 overflow-x-auto px-5 pb-3 lg:hidden">{NAV.map(({ path, label }) => <NavLink key={path} to={path} end={path === "/admin"} className={({ isActive }) => `shrink-0 rounded-lg px-3 py-2 text-xs ${isActive ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`}>{label}</NavLink>)}</nav>
        </header>
        <main id="admin-content" className="mx-auto max-w-7xl px-5 py-7 lg:px-8"><Outlet context={{ role }} /></main>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 대시보드: 오늘 처리할 일
export function LiveAdminHome() {
  const { data, error } = useLoad(async () => {
    const [applications, ready, intros, reports, inquiries, requests, jobs, mail, errors, failedJobs] = await Promise.all([
      call<{ status: string; source: string | null; cohort: number | null }[]>("admin_list_applications"),
      call<unknown[]>("admin_ready_members").catch(() => []),
      call<{ status: string; reveal_at: string }[]>("admin_list_introductions"),
      table<{ status: string; urgent: boolean }>("reports", query => query.select("status, urgent").neq("status", "closed")),
      table<{ status: string }>("inquiries", query => query.select("status").neq("status", "answered")),
      table<{ status: string }>("member_requests", query => query.select("status").neq("status", "decided")),
      table<{ job: string; started_at: string; ok: boolean | null; detail: Record<string, unknown> | null }>("job_runs", query => query.select("job, started_at, ok, detail").order("started_at", { ascending: false }).limit(6)),
      table<{ started_at: string; ok: boolean | null; detail: { sent?: number; failed?: number; reason?: string } | null }>("job_runs", query => query.select("started_at, ok, detail").eq("job", "email").gt("started_at", new Date(Date.now() - 86400000).toISOString()).order("started_at", { ascending: false }).limit(1)),
      table<{ id: number; at: string; context: string | null; message: string | null; path: string | null }>("client_errors", query => query.select("id, at, context, message, path").gt("at", new Date(Date.now() - 7 * 86400000).toISOString()).order("id", { ascending: false }).limit(20)).catch(() => []),
      // 정오 공개·응답 마감·교류·알림 작업이 실패하면 맨 위에 알린다(최근 24시간).
      table<{ job: string; started_at: string; detail: { error?: string } | null }>("job_runs", query => query.select("job, started_at, detail").eq("ok", false).neq("job", "email").gt("started_at", new Date(Date.now() - 86400000).toISOString()).order("started_at", { ascending: false }).limit(5)).catch(() => []),
    ]);
    return { applications, ready, intros, reports, inquiries, requests, jobs, mail: mail[0] ?? null, errors, failedJobs };
  });
  if (error) return <Notice text={error} />;
  if (!data) return <p className="text-sm text-muted-foreground">불러오고 있어요.</p>;
  const waiting = data.applications.filter(item => item.status === "submitted" || item.status === "reviewing").length;
  const tiles: [string, number, string][] = [
    ["검토할 신청서", waiting, "/admin/applicants"],
    ["소개 가능한 회원", data.ready.length, "/admin/introductions"],
    ["정오 예약", data.intros.filter(item => item.status === "reserved").length, "/admin/introductions"],
    ["응답 기다리는 소개", data.intros.filter(item => item.status === "published").length, "/admin/introductions"],
    ["처리할 신고", data.reports.length, "/admin/safety"],
    ["답변 대기 문의", data.inquiries.length, "/admin/safety"],
    ["회원 요청", data.requests.length, "/admin/safety"],
  ];
  const urgent = data.reports.filter(item => item.urgent).length;
  // 유입 경로: 제출한 신청서 기준(작성 중·철회 제외)
  const submitted = data.applications.filter(item => !["draft", "withdrawn"].includes(item.status));
  const sources = Object.entries(submitted.reduce<Record<string, number>>((all, item) => ({ ...all, [item.source || "응답 없음"]: (all[item.source || "응답 없음"] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  return <>
    <Title lead="실제 회원 자료예요. 열람과 처리는 모두 감사 기록에 남아요.">오늘 처리할 일</Title>
    {data.failedJobs.length > 0 && <p role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive"><span className="font-semibold">예약 작업이 실패했어요</span> · {data.failedJobs.map(job => `${({ noon: "정오 공개", deadlines: "응답 마감", programs: "교류 진행", reminders: "알림" } as Record<string, string>)[job.job] ?? job.job} ${kstDateTime(job.started_at)}`).join(" · ")}<br /><span className="text-xs">정오 공개가 실패했다면 Supabase SQL 편집기에서 <code>select public.run_noon();</code>을 한 번 실행해 주세요. {data.failedJobs[0].detail?.error ? `오류: ${String(data.failedJobs[0].detail.error).slice(0, 120)}` : ""}</span></p>}
    {data.mail?.ok === false && <p role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive"><span className="font-semibold">메일 발송이 실패하고 있어요</span> · {kstDateTime(data.mail.started_at)} · 실패 {data.mail.detail?.failed ?? 0}통{data.mail.detail?.reason ? ` · ${data.mail.detail.reason.slice(0, 120)}` : ""}<br /><span className="text-xs">Supabase → Edge Functions → Secrets의 SMTP_USER(메일 주소)·SMTP_PASS(앱 비밀번호)를 확인해 주세요.</span></p>}
    {urgent > 0 && <p role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive">긴급 신고 {urgent}건 · 먼저 확인해 주세요.</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{tiles.map(([label, count, to]) => <Link key={label} to={to} className={`${box} p-5 transition-colors hover:border-primary/40`}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-light tabular-nums text-primary">{count}</p></Link>)}</div>
    <section className={`${box} mt-6 p-5`}><h2 className="flex items-center gap-2 text-sm font-semibold"><Bell size={15} className="text-accent" />예약 작업 기록</h2>{data.jobs.length ? <ul className="mt-3 divide-y divide-border text-xs">{data.jobs.map((job, index) => <li key={index} className="flex flex-wrap justify-between gap-2 py-2"><span>{({ noon: "정오 공개", deadlines: "응답 마감", retention: "보존 기간 정리", email: "메일 발송", reminders: "마감 전 알림", programs: "교류 진행", "program-retention": "교류 글 정리" } as Record<string, string>)[job.job] ?? job.job} · {job.ok === false ? <span className="font-semibold text-destructive">실패</span> : "완료"}</span><span className="text-muted-foreground">{kstDateTime(job.started_at)} · {JSON.stringify(job.detail ?? {})}</span></li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">아직 실행 기록이 없어요. 정오 작업은 매일 12:00에 돌아요.</p>}</section>
    <section className={`${box} mt-6 p-5`}><h2 className="text-sm font-semibold">유입 경로 · 제출한 신청서 {submitted.length}건</h2>{sources.length ? <ul className="mt-3 grid gap-2 text-xs sm:grid-cols-2">{sources.map(([label, count]) => <li key={label} className="flex items-center gap-3"><span className="w-28 shrink-0 text-muted-foreground">{label}</span><span className="h-2 rounded-full bg-primary/70" style={{ width: `${Math.max(6, Math.round(count / submitted.length * 100))}%` }} /><span className="tabular-nums">{count}</span></li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">아직 제출한 신청서가 없어요. 홍보 링크 끝에 ?from=instagram · ?from=threads 를 붙이면 경로가 자동으로 채워져요.</p>}</section>
    <section className={`${box} mt-6 p-5`}><h2 className="flex items-center gap-2 text-sm font-semibold"><Bug size={15} className="text-accent" />화면 오류 · 최근 7일 {data.errors.length ? `${data.errors.length}건` : ""}</h2>{data.errors.length ? <ul className="mt-3 divide-y divide-border text-xs">{data.errors.map(item => <li key={item.id} className="py-2 leading-5"><span className="text-muted-foreground">{kstDateTime(item.at)} · {item.path ?? "-"} · {item.context ?? "-"}</span><br />{item.message}</li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">회원 화면에서 난 오류가 없어요. 오류가 나면 이메일·전화번호를 지운 채로 여기에 모여요.</p>}</section>
  </>;
}

// ─────────────────────────────────────────────
// 기수: 모집 현황(운영진만) · 날짜와 인원 조정 · 성별 마감 · 다음 기수 만들기
type GenderStats = { total: number; approved: number; reviewing: number; needsChanges: number; held: number };
type Cohort = { number: number; startsOn: string; applicationDeadline: string; minPerGender: number; maxPerGender: number; closedGenders: string[]; note: string | null; counts: Record<string, GenderStats>; ages: Record<string, number>; regions: Record<string, number> };
const GENDERS = ["여성", "남성"] as const;
const todayKst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

function GenderBar({ label, stats, min, max, closed, onToggle }: { label: string; stats?: GenderStats; min: number; max: number; closed: boolean; onToggle: () => void }) {
  const total = stats?.total ?? 0, approved = stats?.approved ?? 0;
  const width = (value: number) => `${Math.min(100, (value / max) * 100)}%`;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><span className="font-semibold">{label} <span className="ml-1 text-2xl font-light tabular-nums text-primary">{total}</span><span className="text-xs text-muted-foreground"> / {max}명</span></span><span className="text-xs text-muted-foreground">승인 {approved} · 검토 {stats?.reviewing ?? 0} · 보완 {stats?.needsChanges ?? 0}{stats?.held ? ` · 보류 ${stats.held}` : ""} · 최소 {min}명{total >= min ? " 충족" : `까지 ${min - total}명 남음`}</span></div>
    <div className="relative h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="absolute inset-y-0 left-0 rounded-full bg-primary/25" style={{ width: width(total) }} /><span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: width(approved) }} /><span className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: width(min) }} /></div>
    <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={closed} onChange={onToggle} />{label} 신청 마감(이후 신청은 다음 기수로)</label>
  </div>;
}

function CohortCard({ cohort, onSaved }: { cohort: Cohort; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ startsOn: cohort.startsOn, deadline: cohort.applicationDeadline, min: cohort.minPerGender, max: cohort.maxPerGender, note: cohort.note ?? "" });
  const [closed, setClosed] = useState<string[]>(cohort.closedGenders);
  const [message, setMessage] = useState("");
  const today = todayKst();
  const phase = today > cohort.startsOn ? "진행 중" : today > cohort.applicationDeadline ? "마감 · 첫날 짝 준비" : "모집 중";
  const save = async (nextClosed = closed) => { const { error } = await rpc("admin_update_cohort", { p_number: cohort.number, p_starts_on: form.startsOn, p_deadline: form.deadline, p_min: Number(form.min), p_max: Number(form.max), p_closed: nextClosed, p_note: form.note }); setMessage(error || "저장했어요. 공개 화면의 날짜도 함께 바뀌어요."); if (!error) await onSaved(); };
  const toggle = (gender: string) => { const next = closed.includes(gender) ? closed.filter(item => item !== gender) : [...closed, gender]; setClosed(next); void save(next); };
  const chips = (record: Record<string, number>) => Object.entries(record).sort((a, b) => b[1] - a[1]).map(([key, value]) => <span key={key} className="rounded-full bg-muted px-2.5 py-1 text-[11px]">{key} {value}</span>);
  return <section className={`${box} space-y-5 p-5`} aria-label={`${cohortName(cohort.number)}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{phase}</p><h2 className="mt-1 text-xl font-semibold">{cohortName(cohort.number)} · {kstDay(cohort.startsOn)} 정오 시작</h2><p className="mt-1 text-xs text-muted-foreground">신청 마감 {kstDay(cohort.applicationDeadline)}{cohort.note ? ` · ${cohort.note}` : ""}</p></div></div>
    <div className="grid gap-5 md:grid-cols-2">{GENDERS.map(gender => <GenderBar key={gender} label={gender} stats={cohort.counts[gender]} min={cohort.minPerGender} max={cohort.maxPerGender} closed={closed.includes(gender)} onToggle={() => toggle(gender)} />)}</div>
    {cohort.counts["직접 확인이 필요해요"] && <p className="text-xs text-accent">성별 직접 확인이 필요한 신청 {cohort.counts["직접 확인이 필요해요"].total}건</p>}
    {(Object.keys(cohort.ages).length > 0 || Object.keys(cohort.regions).length > 0) && <div className="space-y-2 text-xs"><div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-muted-foreground">나이대</span>{chips(cohort.ages)}</div><div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-muted-foreground">지역</span>{chips(cohort.regions)}</div></div>}
    <details className="border-t border-border pt-4"><summary className="cursor-pointer text-xs font-semibold">날짜·인원 바꾸기</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-xs">시작일(정오)<Input type="date" value={form.startsOn} onChange={event => setForm({ ...form, startsOn: event.target.value })} className="mt-1" /></label>
      <label className="text-xs">신청 마감<Input type="date" value={form.deadline} onChange={event => setForm({ ...form, deadline: event.target.value })} className="mt-1" /></label>
      <label className="text-xs">최소(성별)<Input type="number" min={0} value={form.min} onChange={event => setForm({ ...form, min: Number(event.target.value) })} className="mt-1" /></label>
      <label className="text-xs">최대(성별)<Input type="number" min={1} value={form.max} onChange={event => setForm({ ...form, max: Number(event.target.value) })} className="mt-1" /></label>
      <label className="text-xs">메모(운영진만)<Input value={form.note} maxLength={80} onChange={event => setForm({ ...form, note: event.target.value })} className="mt-1" /></label>
    </div><Button size="sm" className="mt-3" onClick={() => void save()}>저장</Button></details>
    <Notice text={message} />
  </section>;
}

export function LiveCohorts() {
  const list = useLoad(() => call<Cohort[]>("admin_cohort_overview"), []);
  const [message, setMessage] = useState("");
  const addNext = async () => { const { data, error } = await rpc<number>("admin_create_next_cohort"); setMessage(error || `${data}기를 만들었어요(매달 마지막 날 규칙).`); await list.reload(); };
  return <>
    <Title lead="모인 인원은 이 화면에서만 보여요. 공개 화면에는 기수 번호와 첫 소개 날짜만 나가요. 성별 최대 인원이 차거나 마감하면, 이후 신청은 다음 기수로 들어가요.">기수</Title>
    {list.error && <Notice text={list.error} />}
    <div className="space-y-5">{(list.data ?? []).map(cohort => <CohortCard key={`${cohort.number}-${cohort.startsOn}-${cohort.maxPerGender}`} cohort={cohort} onSaved={list.reload} />)}</div>
    <div className="mt-5 flex flex-wrap items-center gap-3"><Button variant="outline" onClick={() => void addNext()}>다음 기수 만들기</Button><Notice text={message} /></div>
  </>;
}

// ─────────────────────────────────────────────
// 신청자: 목록 → 열람(감사 기록) → 사진 확인 → 결정
type ApplicationRow = { member_id: string; status: string; submitted_at: string | null; name: string | null; gender: string | null; desired: string | null; province: string | null; area: string | null; age: number | null; source: string | null; photo_count: number; photo_requests: number; cohort: number | null };
type ApplicationDetail = { memberId: string; status: string; profileVersion: number; submittedAt: string | null; decisionNote: string | null; draft: { values: Record<string, unknown>; sharing: Record<string, boolean>; preferences?: unknown }; photos: { slot: string; path: string; review: string; reason: string | null; width: number; height: number }[] };
const show = (value: unknown) => Array.isArray(value) ? value.join(" · ") : typeof value === "boolean" ? value ? "예" : "아니요" : String(value ?? "");

export function LiveApplicants() {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const list = useLoad(() => call<ApplicationRow[]>("admin_list_applications"), []);
  const [selected, setSelected] = useState<string | null>(null);
  const rows = (list.data ?? []).filter(row => filter === "all" || ["submitted", "reviewing"].includes(row.status));
  return <>
    <Title lead="생년월일 원값은 보이지 않고 만 나이만 보여요. 신청서를 열면 회원별로 하루 한 번 열람 기록이 남아요.">신청자</Title>
    <div className="mb-4 flex gap-2">{(["open", "all"] as const).map(value => <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)}>{value === "open" ? "검토할 신청서" : "전체"}</Button>)}</div>
    {list.error && <Notice text={list.error} />}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className={`${box} divide-y divide-border`}>{rows.length ? rows.map(row => <button key={row.member_id} type="button" onClick={() => setSelected(row.member_id)} className={`block w-full px-4 py-3 text-left text-sm ${selected === row.member_id ? "bg-primary/5" : "hover:bg-secondary"}`}><span className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{row.name || "이름 미입력"} <span className="font-normal text-muted-foreground">· {row.gender} · {row.age ?? "?"}세 · {row.province} {row.area}</span></span><span className="text-xs text-primary">{STATUS_LABEL[row.status]}</span></span><span className="mt-1 block text-xs text-muted-foreground">{row.cohort != null ? `${cohortName(row.cohort)} · ` : ""}사진 {row.photo_count}/4{row.photo_requests ? ` · 재등록 요청 ${row.photo_requests}` : ""} · 접수 {row.submitted_at ? kstDateTime(row.submitted_at) : "—"}{row.source ? ` · 유입 ${row.source}` : ""}</span></button>) : <p className="p-5 text-sm text-muted-foreground">{list.loading ? "불러오고 있어요." : "해당하는 신청서가 없어요."}</p>}</div>
      {selected ? <ApplicantDetail key={selected} memberId={selected} onChanged={list.reload} /> : <p className={`${box} p-5 text-sm text-muted-foreground`}>왼쪽에서 신청서를 골라 주세요.</p>}
    </div>
  </>;
}

function AdminPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let alive = true; void photoUrl(path).then(next => { if (alive) setUrl(next); }); return () => { alive = false; }; }, [path]);
  return <div className="aspect-[4/5] overflow-hidden rounded-md border border-border bg-muted">{url && <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className="h-full w-full object-cover" /></a>}</div>;
}

function ApplicantDetail({ memberId, onChanged }: { memberId: string; onChanged: () => Promise<void> }) {
  const detail = useLoad(() => call<ApplicationDetail>("admin_get_application", { p_member: memberId }), [memberId]);
  const [note, setNote] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  if (detail.error) return <Notice text={detail.error} />;
  if (!detail.data) return <p className={`${box} p-5 text-sm text-muted-foreground`}>불러오고 있어요.</p>;
  const data = detail.data;
  const values = data.draft.values ?? {};
  const fields = APPLICATION_FIELDS.filter(field => field.format !== "photo" && field.scope !== "private" && values[field.id] !== undefined && values[field.id] !== "" && !(Array.isArray(values[field.id]) && (values[field.id] as unknown[]).length === 0));
  const act = async (task: () => Promise<unknown>, done: string) => { try { await task(); setMessage(done); await detail.reload(); await onChanged(); } catch (error) { setMessage((error as Error).message); } };
  const decide = (status: string, label: string) => act(() => call("admin_decide_application", { p_member: memberId, p_status: status, p_note: note || null }), `${label}(으)로 기록했어요.`);
  return <section className={`${box} space-y-6 p-5`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">프로필 버전 {data.profileVersion} · 접수 {data.submittedAt ? kstDateTime(data.submittedAt) : "—"}</p><h2 className="mt-1 text-xl font-semibold">{show(values["self.name"]) || "이름 미입력"} · 만 {show(values["self.age"])}세</h2></div><span className="rounded-full border border-primary/30 px-3 py-1 text-xs text-primary">{STATUS_LABEL[data.status]}</span></div>
    {data.decisionNote && <p className="rounded-lg bg-muted p-3 text-xs leading-6">회원에게 보낸 안내 · {data.decisionNote}</p>}
    <div><h3 className="text-sm font-semibold">사진</h3><div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">{PHOTO_SLOTS.map(slot => { const photo = data.photos.find(item => item.slot === slot.id); return <div key={slot.id} className="space-y-2 text-xs"><p className="font-semibold">{slot.number}. {slot.label}</p>{photo ? <><AdminPhoto path={photo.path} /><p className="text-muted-foreground">{photo.width}×{photo.height} · {photo.review}{photo.reason ? ` · ${photo.reason}` : ""}</p><div className="flex flex-wrap gap-1"><Button size="sm" variant={photo.review === "기준 확인" ? "default" : "outline"} className="h-7 px-2 text-[11px]" onClick={() => void act(() => call("admin_review_photo", { p_member: memberId, p_slot: slot.id, p_review: "기준 확인" }), `${slot.label} 기준 확인`)}>기준 확인</Button><select aria-label={`${slot.label} 재등록 사유`} value={reasons[slot.id] ?? ""} onChange={event => setReasons(current => ({ ...current, [slot.id]: event.target.value }))} className="h-7 rounded-md border border-border bg-card px-1 text-[11px]"><option value="">재등록 사유</option>{PHOTO_REVIEW_REASONS.map(reason => <option key={reason}>{reason}</option>)}</select><Button size="sm" variant="outline" disabled={!reasons[slot.id]} className="h-7 px-2 text-[11px]" onClick={() => void act(() => call("admin_review_photo", { p_member: memberId, p_slot: slot.id, p_review: "재등록 요청", p_reason: reasons[slot.id] }), `${slot.label} 재등록 요청`)}>재등록 요청</Button></div></> : <p className="text-muted-foreground">{slot.required ? "미등록 · 필수" : "미등록"}</p>}</div>; })}</div></div>
    <div><h3 className="text-sm font-semibold">신청 내용</h3><dl className="mt-3 divide-y divide-border text-sm">{fields.map(field => <div key={field.id} className="grid gap-1 py-2 sm:grid-cols-[180px_1fr]"><dt className="text-xs text-muted-foreground">{field.label}{field.scope === "partner" ? data.draft.sharing?.[field.id] ? " · 상대 공개" : " · 비공개" : " · 운영 참고"}</dt><dd className="whitespace-pre-wrap break-words text-xs leading-6">{show(values[field.id])}</dd></div>)}</dl></div>
    <div className="space-y-3 border-t border-border pt-5"><h3 className="text-sm font-semibold">결정</h3><Textarea aria-label="회원에게 보낼 안내" value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="보완·보류·소개 어려움일 때 회원에게 보일 안내를 적어 주세요. 평가하는 말은 쓰지 않아요." className="min-h-20" /><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void decide("reviewing", "검토 시작")}>검토 시작</Button><Button size="sm" onClick={() => void decide("approved", "승인")}>승인</Button><Button size="sm" variant="outline" onClick={() => void decide("needs_changes", "보완 요청")}>보완 요청</Button><Button size="sm" variant="outline" onClick={() => void decide("held", "보류")}>보류</Button><Button size="sm" variant="ghost" onClick={() => void decide("rejected", "소개 어려움")}>소개 어려움</Button></div><Notice text={message} /></div>
  </section>;
}

// ─────────────────────────────────────────────
// 소개·매칭: 소개할 수 있는 회원 중 두 사람을 골라 정오 공개를 예약한다.
type ReadyMember = { member_id: string; name: string | null; gender: string | null; desired: string | null; age: number | null; province: string | null; area: string | null; purpose: string | null; last_published_at: string | null; introductions: number; blocked: string[]; previous: string[]; avoided?: string[]; released_at?: string | null; history?: string[] };
const HISTORY: Record<string, string> = { suspended: "이용 정지", reported: "신고 대상", blocked: "차단 관계" };
type IntroRow = { id: string; status: string; reveal_at: string; respond_by: string; name_a: string | null; name_b: string | null; response_a: string | null; response_b: string | null; opened_a: boolean; opened_b: boolean; end_reason: string | null; note: string };
const nextNoonDate = () => { const now = new Date(); const kst = new Date(now.getTime() + 9 * 3600000); const date = kst.toISOString().slice(0, 10); return kst.getUTCHours() < 12 ? date : new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); };
const ANSWER: Record<string, string> = { positive: "알아가고 싶어요", negative: "넘길게요" };

export function LiveIntroductions() {
  const ready = useLoad(() => call<ReadyMember[]>("admin_ready_members"), []);
  const intros = useLoad(() => call<IntroRow[]>("admin_list_introductions"), []);
  const [pair, setPair] = useState<string[]>([]);
  const [date, setDate] = useState(nextNoonDate);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const members = ready.data ?? [];
  const chosen = pair.map(id => members.find(member => member.member_id === id)).filter(Boolean) as ReadyMember[];
  const toggle = (id: string) => setPair(current => current.includes(id) ? current.filter(item => item !== id) : current.length < 2 ? [...current, id] : [current[1], id]);
  const warnings = chosen.length === 2 ? [
    chosen[0].blocked.includes(chosen[1].member_id) && "차단 관계예요.",
    (chosen[0].avoided ?? []).includes(chosen[1].member_id) && "아는 사람 피하기 관계예요. 예약할 수 없어요.",
    chosen[0].previous.includes(chosen[1].member_id) && "이미 소개한 적 있어요.",
    !([chosen[1].gender, "선호 없음"].includes(chosen[0].desired) && [chosen[0].gender, "선호 없음"].includes(chosen[1].desired)) && "서로 원하는 상대 성별이 맞지 않아요.",
  ].filter(Boolean) as string[] : [];
  const reserve = async () => { const { error } = await rpc("admin_reserve_introduction", { p_a: pair[0], p_b: pair[1], p_date: date, p_note: note }); setMessage(error || `${kstDay(`${date}T12:00:00+09:00`)} 정오 공개로 예약했어요.`); if (!error) { setPair([]); setNote(""); await ready.reload(); await intros.reload(); } };
  const cancel = async (id: string) => { const reason = window.prompt("취소 사유를 적어 주세요(감사 기록에 남아요)."); if (!reason) return; const { error } = await rpc("admin_cancel_introduction", { p_id: id, p_reason: reason }); setMessage(error || "소개를 취소했어요."); await intros.reload(); await ready.reload(); };
  return <>
    <Title lead="승인된 회원 중 진행 중인 소개가 없는 분만 보여요. 예약한 소개는 그날 12:00에 두 사람에게 동시에 공개되고, 다음 날 11:00에 응답이 마감돼요.">소개·매칭</Title>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <section className={`${box} divide-y divide-border`} aria-label="소개 가능한 회원">{members.length ? members.map(member => <button key={member.member_id} type="button" aria-pressed={pair.includes(member.member_id)} onClick={() => toggle(member.member_id)} className={`block w-full px-4 py-3 text-left text-sm ${pair.includes(member.member_id) ? "bg-primary/10" : "hover:bg-secondary"}`}><span className="font-semibold">{member.name}</span>{member.released_at && <span className="ml-2 rounded-full bg-[#F8E5A6] px-2 py-0.5 text-[11px] font-semibold text-[#5A4310]">방금 마무리 · {kstDateTime(member.released_at)}</span>}{member.history?.length ? <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">이전 계정 이력 · {member.history.map(item => HISTORY[item] ?? item).join(", ")}</span> : null} <span className="text-muted-foreground">· {member.gender} → {member.desired} · {member.age}세 · {member.province} {member.area}</span><span className="mt-1 block text-xs text-muted-foreground">{member.purpose} · 소개 {member.introductions}번{member.last_published_at ? ` · 최근 ${kstDay(member.last_published_at)}` : " · 첫 소개 전"}{member.avoided?.length ? ` · 아는 사람 피하기 ${member.avoided.length}명` : ""}{pair.length === 1 && pair[0] !== member.member_id && member.avoided?.includes(pair[0]) ? " · 지금 고른 분과 서로 피하는 사이" : ""}</span></button>) : <p className="p-5 text-sm text-muted-foreground">{ready.loading ? "불러오고 있어요." : ready.error || "지금 소개할 수 있는 회원이 없어요."}</p>}</section>
      <section className={`${box} space-y-4 p-5`} aria-label="정오 소개 예약">
        <h2 className="text-sm font-semibold">정오 소개 예약</h2>
        <p className="text-sm">{chosen.length ? chosen.map(member => member.name).join(" · ") : "왼쪽에서 두 사람을 골라 주세요."}</p>
        {warnings.map(text => <p key={text} role="alert" className="text-xs text-destructive">{text}</p>)}
        <label className="block text-xs">공개 날짜(그날 12:00)<Input type="date" value={date} min={nextNoonDate()} onChange={event => setDate(event.target.value)} className="mt-1" /></label>
        <label className="block text-xs">두 분에게 함께 보일 소개 이유<Textarea value={note} maxLength={300} onChange={event => setNote(event.target.value)} placeholder="예: 두 분 모두 천천히 알아가는 연애를 원하셨고, 주말 산책을 좋아하셨어요." className="mt-1 min-h-24" /></label>
        <p className="text-[11px] leading-5 text-muted-foreground">공개 동의한 항목만 상대에게 보여요. 외모 평가나 점수, 비공개 항목은 소개 이유에 쓰지 않아요.</p>
        <Button disabled={pair.length !== 2 || note.trim().length < 10} onClick={() => void reserve()}>예약하기</Button>
        <Notice text={message} />
      </section>
    </div>
    <section className={`${box} mt-6 overflow-x-auto`} aria-label="소개 기록"><table className="w-full min-w-[720px] text-left text-xs"><thead className="border-b border-border text-muted-foreground"><tr><th className="p-3">공개</th><th className="p-3">두 사람</th><th className="p-3">상태</th><th className="p-3">응답</th><th className="p-3" /></tr></thead><tbody className="divide-y divide-border">{(intros.data ?? []).map(item => <tr key={item.id}><td className="p-3">{kstDateTime(item.reveal_at)}</td><td className="p-3">{item.name_a} · {item.name_b}</td><td className="p-3">{INTRO_LABEL[item.status]}{item.end_reason ? ` · ${END_LABEL[item.end_reason] ?? item.end_reason}` : ""}</td><td className="p-3">{[[item.name_a, item.opened_a, item.response_a], [item.name_b, item.opened_b, item.response_b]].map(([name, opened, answer]) => `${name}: ${answer ? ANSWER[answer as string] : opened ? "열람" : "미열람"}`).join(" / ")}</td><td className="p-3 text-right">{["reserved", "published", "mutual"].includes(item.status) && <Button size="sm" variant="ghost" onClick={() => void cancel(item.id)}>취소</Button>}</td></tr>)}</tbody></table>{!intros.data?.length && <p className="p-5 text-sm text-muted-foreground">아직 소개 기록이 없어요.</p>}</section>
  </>;
}

// ─────────────────────────────────────────────
// 신고·문의: 신고(자동 감지 포함) · 고객 문의 · 회원 요청
type Report = { id: string; source: string; type: string; description: string | null; urgent: boolean; status: string; created_at: string; resolution: string | null };
type InquiryRow = { id: string; type: string; name: string; email: string; body: string; status: keyof typeof INQUIRY_STATUS; answer_body: string | null; created_at: string };
type RequestRow = { id: string; kind: keyof typeof REQUEST_LABELS; description: string | null; status: string; decision: string | null; urgent: boolean; created_at: string };
const REPORT_STATUS: Record<string, string> = { new: "새 신고", reviewing: "검토 중", checking: "사실 확인", action: "조치", closed: "종결" };
const REQUEST_STATUS: Record<string, string> = { requested: "접수", protection: "보호 조치", checking: "확인 중", decided: "처리 완료", reconsidering: "재검토" };

export function LiveSafety() {
  const [tab, setTab] = useState<"reports" | "inquiries" | "requests" | "greetings">("reports");
  return <>
    <Title lead="안전 신고를 가장 먼저 봐요. 문의 본문과 이메일은 감사 기록에 남기지 않아요. 답변은 회원이 접수 번호로 확인해요(메일 발송은 연결 전).">신고·문의</Title>
    <div className="mb-5 flex gap-2">{([["reports", "신고"], ["inquiries", "고객 문의"], ["requests", "회원 요청"], ["greetings", "첫 마디 · 홈"]] as const).map(([value, label]) => <Button key={value} size="sm" variant={tab === value ? "default" : "outline"} onClick={() => setTab(value)}>{label}</Button>)}</div>
    {tab === "reports" ? <ReportsPanel /> : tab === "inquiries" ? <InquiriesPanel /> : tab === "requests" ? <RequestsPanel /> : <GreetingsPanel />}
  </>;
}
// 홈 공개를 신청한 첫 마디: 문장만 보고 확인한다(홈에는 이름·사진 없이, 확인된 문장이 12개 이상일 때만 나간다).
type GreetingRow = { memberId: string; body: string; homeStatus: string; reason: string | null; updatedAt: string; name: string | null; cohort: number | null };
function GreetingsPanel() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const list = useLoad(() => call<GreetingRow[]>("admin_list_greetings", { p_status: status }), [status]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const review = async (member: string, next: "approved" | "rejected") => { const { error } = await rpc("admin_review_greeting", { p_member: member, p_status: next, p_reason: reasons[member] || null }); setMessage(error || (next === "approved" ? "홈 공개를 확인했어요." : "홈에 싣지 않기로 했어요. 회원에게 이유가 보여요.")); await list.reload(); };
  return <div className="space-y-3">
    <p className="text-xs leading-6 text-muted-foreground">연락처·링크는 저장 단계에서 이미 걸러져요. 특정인을 알아볼 수 있는 내용, 외모·조건 평가, 광고성 문구는 싣지 않아요. 확인된 문장이 12개 이상일 때부터 홈에 보여요.</p>
    <div className="flex gap-2">{([["pending", "확인 대기"], ["approved", "공개 중"], ["rejected", "싣지 않음"]] as const).map(([value, label]) => <Button key={value} size="sm" variant={status === value ? "default" : "outline"} onClick={() => setStatus(value)}>{label}</Button>)}</div>
    <Notice text={message || list.error || ""} />
    {(list.data ?? []).map(row => <article key={row.memberId} className={`${box} p-4 text-sm`}><p className="text-base font-semibold leading-7">“{row.body}”</p><p className="mt-1 text-xs text-muted-foreground">{row.name ?? "이름 없음"}{row.cohort != null ? ` · ${cohortName(row.cohort)}` : ""} · {kstDateTime(row.updatedAt)}{row.reason ? ` · ${row.reason}` : ""}</p>{status === "pending" && <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" onClick={() => void review(row.memberId, "approved")}>홈 공개 확인</Button><Input aria-label="싣지 않는 이유" value={reasons[row.memberId] ?? ""} onChange={event => setReasons(current => ({ ...current, [row.memberId]: event.target.value }))} placeholder="싣지 않는 이유(회원에게 보여요)" className="h-8 max-w-xs text-xs" /><Button size="sm" variant="outline" disabled={!reasons[row.memberId]?.trim()} onClick={() => void review(row.memberId, "rejected")}>싣지 않기</Button></div>}</article>)}
    {!list.loading && !list.data?.length && <p className="text-sm text-muted-foreground">해당하는 첫 마디가 없어요.</p>}
  </div>;
}

function ReportsPanel() {
  const list = useLoad(() => table<Report>("reports", query => query.select("id, source, type, description, urgent, status, created_at, resolution").order("urgent", { ascending: false }).order("created_at", { ascending: false }).limit(100)), []);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const update = async (id: string, status: string) => { const { error } = await rpc("admin_update_report", { p_id: id, p_status: status, p_resolution: notes[id] || null }); setMessage(error || "기록했어요."); await list.reload(); };
  return <div className="space-y-3"><Notice text={message || list.error || ""} />{(list.data ?? []).map(report => <article key={report.id} className={`${box} p-4 text-sm ${report.urgent ? "border-destructive/40" : ""}`}><p className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{report.urgent && <span className="mr-2 text-destructive">긴급</span>}{report.type}<span className="ml-2 text-xs font-normal text-muted-foreground">{report.source === "auto" ? "자동 감지" : "회원 신고"}</span></span><span className="text-xs text-muted-foreground">{REPORT_STATUS[report.status]} · {kstDateTime(report.created_at)}</span></p>{report.description && <p className="mt-2 whitespace-pre-wrap text-xs leading-6">{report.description}</p>}{report.resolution && <p className="mt-2 text-xs text-muted-foreground">처리 메모 · {report.resolution}</p>}{report.status !== "closed" && <div className="mt-3 flex flex-wrap items-center gap-2"><Input aria-label="처리 메모" value={notes[report.id] ?? ""} onChange={event => setNotes(current => ({ ...current, [report.id]: event.target.value }))} placeholder="처리 메모(선택)" className="h-8 max-w-xs text-xs" />{["reviewing", "checking", "action", "closed"].map(status => <Button key={status} size="sm" variant="outline" className="h-8 text-xs" onClick={() => void update(report.id, status)}>{REPORT_STATUS[status]}</Button>)}</div>}</article>)}{!list.loading && !list.data?.length && <p className="text-sm text-muted-foreground">신고가 없어요.</p>}</div>;
}
function InquiriesPanel() {
  const list = useLoad(() => table<InquiryRow>("inquiries", query => query.select("id, type, name, email, body, status, answer_body, created_at").order("created_at", { ascending: false }).limit(100)), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [message, setMessage] = useState("");
  const item = list.data?.find(entry => entry.id === selected);
  const save = async (withAnswer: boolean) => { const { error } = await rpc("admin_inquiry_status", { p_id: selected, p_answer: withAnswer ? answer : null }); setMessage(error || (withAnswer ? "답변을 기록했어요. 회원은 접수 번호와 이메일로 확인해요." : "확인 중으로 바꿨어요.")); await list.reload(); };
  return <div className="grid gap-4 lg:grid-cols-2"><div className={`${box} divide-y divide-border`}>{(list.data ?? []).map(entry => <button key={entry.id} type="button" onClick={() => { setSelected(entry.id); setAnswer(entry.answer_body || ""); setMessage(""); }} className={`flex w-full flex-wrap justify-between gap-2 px-4 py-3 text-left text-sm ${entry.id === selected ? "bg-primary/5" : "hover:bg-secondary"}`}><span>{entry.id} · {entry.type}{entry.name && ` · ${entry.name}`}</span><span className="text-xs text-muted-foreground">{INQUIRY_STATUS[entry.status]} · {kstDateTime(entry.created_at)}</span></button>)}{!list.loading && !list.data?.length && <p className="p-5 text-sm text-muted-foreground">문의가 없어요.</p>}</div>{item ? <div className={`${box} space-y-3 p-4 text-sm`}><p className="text-xs text-muted-foreground">{item.id} · {item.email}</p><p className="whitespace-pre-wrap leading-7">{item.body}</p><Textarea aria-label="답변" value={answer} maxLength={1500} onChange={event => setAnswer(event.target.value)} className="min-h-28" placeholder="회원에게 보일 답변" /><div className="flex gap-2">{item.status === "received" && <Button size="sm" variant="outline" onClick={() => void save(false)}>확인 중으로</Button>}<Button size="sm" onClick={() => void save(true)}>{item.answer_body ? "답변 수정" : "답변 기록"}</Button></div><Notice text={message} /></div> : <p className={`${box} p-5 text-sm text-muted-foreground`}>문의를 골라 주세요.</p>}</div>;
}
function RequestsPanel() {
  const list = useLoad(() => table<RequestRow>("member_requests", query => query.select("id, kind, description, status, decision, urgent, created_at").order("created_at", { ascending: false }).limit(100)), []);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const decide = async (id: string, status: string) => { const { error } = await rpc("admin_decide_request", { p_id: id, p_status: status, p_decision: decisions[id] || null }); setMessage(error || "기록했어요."); await list.reload(); };
  return <div className="space-y-3"><Notice text={message || list.error || ""} />{(list.data ?? []).map(request => <article key={request.id} className={`${box} p-4 text-sm`}><p className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{REQUEST_LABELS[request.kind] ?? request.kind}</span><span className="text-xs text-muted-foreground">{REQUEST_STATUS[request.status]} · {kstDateTime(request.created_at)}</span></p>{request.description && <p className="mt-2 whitespace-pre-wrap text-xs leading-6">{request.description}</p>}{request.decision && <p className="mt-2 text-xs text-muted-foreground">회원에게 보인 답변 · {request.decision}</p>}{request.status !== "decided" && <div className="mt-3 flex flex-wrap items-center gap-2"><Input aria-label="회원에게 보일 답변" value={decisions[request.id] ?? ""} onChange={event => setDecisions(current => ({ ...current, [request.id]: event.target.value }))} placeholder="회원에게 보일 답변" className="h-8 max-w-sm text-xs" />{["checking", "protection", "decided"].map(status => <Button key={status} size="sm" variant="outline" className="h-8 text-xs" onClick={() => void decide(request.id, status)}>{REQUEST_STATUS[status]}</Button>)}</div>}</article>)}{!list.loading && !list.data?.length && <p className="text-sm text-muted-foreground">회원 요청이 없어요.</p>}</div>;
}

// ─────────────────────────────────────────────
// 교류·약속: 진행 단계만 본다(글 원문은 보지 않는다) · 운영 종료
type ProgramRow = { id: string; status: string; endReason: string | null; createdAt: string; closedAt: string | null; nameA: string | null; nameB: string | null; planA: string | null; planB: string | null; startOn: string | null; agreeBy: string; confirmed: number; entriesA: number; entriesB: number; meetingAnswers: number; meetingBy: string | null; arrangeBy: string | null; meetingOn: string | null; meetingTime: string | null; contacts: number };
const PROGRAM_LABEL: Record<string, string> = { choosing: "방식·시작일 합의", scheduled: "시작 전", started: "3일 교류", deciding: "만남 선택", arranging: "약속", closed: "마무리" };
const PROGRAM_END: Record<string, string> = { "agreement-expired": "합의 기한 지남", "meeting-declined": "만남 안 함", "meeting-nonresponse": "만남 선택 없음", "arrange-expired": "약속 기한 지남", completed: "만남 완료", blocked: "차단", withdrawn: "탈퇴", "admin-cancel": "운영 종료" };
export function LivePrograms() {
  const list = useLoad(() => call<ProgramRow[]>("admin_list_programs"), []);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const close = async (row: ProgramRow) => {
    if (!window.confirm(`${row.nameA ?? "회원"} · ${row.nameB ?? "회원"} 교류를 마무리할까요? 두 분에게 마무리 안내가 가요.`)) return;
    const { error } = await rpc("admin_close_program", { p_id: row.id, p_reason: reasons[row.id] || null });
    setMessage(error || "마무리했어요. 감사 기록에 남았어요.");
    await list.reload();
  };
  return <>
    <Title lead="서로 선택한 두 분의 진행 단계예요. 편지·첫 장면 원문은 보지 않고, 신고가 확인된 경우에만 따로 확인해요.">교류·약속</Title>
    <Notice text={message || list.error || ""} />
    <div className="mt-3 space-y-3">{(list.data ?? []).map(row => <article key={row.id} className={`${box} p-4 text-sm`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><p className="font-semibold">{row.nameA ?? "회원"} · {row.nameB ?? "회원"}</p><span className={`rounded-full px-2.5 py-1 text-[11px] ${row.status === "closed" ? "bg-muted" : "bg-lilac"}`}>{PROGRAM_LABEL[row.status] ?? row.status}{row.endReason ? ` · ${PROGRAM_END[row.endReason] ?? row.endReason}` : ""}</span></div>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">
        {row.status === "choosing" ? `방식 ${row.planA ?? "-"} / ${row.planB ?? "-"} · 확인 ${row.confirmed}/2 · 기한 ${kstDateTime(row.agreeBy)}` : `방식 ${row.planA ?? "-"} · 시작 ${row.startOn ? kstDay(`${row.startOn}T09:00:00+09:00`) : "-"} · 보낸 글 ${row.entriesA}/${row.entriesB}`}
        {row.status === "deciding" && ` · 만남 답 ${row.meetingAnswers}/2 · 기한 ${kstDateTime(row.meetingBy)}`}
        {row.status === "arranging" && (row.meetingOn ? ` · 약속 ${kstDay(`${row.meetingOn}T12:00:00+09:00`)} ${row.meetingTime ?? ""} · 연락처 동의 ${row.contacts}/2` : ` · 약속 기한 ${kstDateTime(row.arrangeBy)}`)}
      </p>
      {row.status !== "closed" && <div className="mt-3 flex flex-wrap items-center gap-2"><Input aria-label="마무리 사유" value={reasons[row.id] ?? ""} onChange={event => setReasons(current => ({ ...current, [row.id]: event.target.value }))} placeholder="마무리 사유(감사 기록에만 남아요)" className="h-8 max-w-xs text-xs" /><Button size="sm" variant="ghost" className="text-destructive" disabled={!(reasons[row.id] ?? "").trim()} onClick={() => void close(row)}>교류 마무리</Button></div>}
    </article>)}{list.data && !list.data.length && <p className="text-sm text-muted-foreground">진행 중인 교류가 없어요.</p>}</div>
  </>;
}

// ─────────────────────────────────────────────
// 회원: 찾기 · 상태(일시정지·이용 정지) · 연락처(운영진만)
type MemberRow = { id: string; email: string; status: "active" | "withdrawal_requested" | "suspended"; pausedAt: string | null; suspendedReason: string | null; createdAt: string; name: string | null; phone: string | null; gender: string | null; age: number | null; area: string | null; application: string | null; cohort: number | null; channels: { kakao: boolean; sms: boolean; email: boolean }; introductions: number; reports: number };
const MEMBER_STATE: Record<MemberRow["status"], string> = { active: "이용 중", withdrawal_requested: "탈퇴 요청", suspended: "이용 정지" };
export function LiveMembers() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const list = useLoad(() => call<MemberRow[]>("admin_list_members", { p_query: search || null }), [search]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const change = async (member: MemberRow, state: "pause" | "resume" | "suspend" | "unsuspend") => {
    if (state === "suspend" && !window.confirm(`${member.name ?? member.email} 님을 이용 정지할까요? 진행 중인 소개는 바로 끝나요.`)) return;
    const { error } = await rpc("admin_set_member_state", { p_member: member.id, p_state: state, p_reason: reasons[member.id] || null });
    setMessage(error || "바꿨어요. 감사 기록에 남았어요.");
    await list.reload();
  };
  const submit = (event: FormEvent) => { event.preventDefault(); setSearch(query.trim()); };
  return <>
    <Title lead="이름·이메일·휴대폰 번호로 찾아요. 휴대폰 번호는 운영진만 보고, 연락이 꼭 필요할 때만 써 주세요.">회원</Title>
    <form onSubmit={submit} className="mb-5 flex flex-wrap gap-2"><Input aria-label="회원 찾기" value={query} onChange={event => setQuery(event.target.value)} placeholder="이름 · 이메일 · 번호 일부" className="max-w-xs" /><Button type="submit">찾기</Button>{search && <Button type="button" variant="ghost" onClick={() => { setQuery(""); setSearch(""); }}>모두 보기</Button>}</form>
    <Notice text={message || list.error || ""} />
    <div className="mt-3 space-y-3">{(list.data ?? []).map(member => <article key={member.id} className={`${box} p-4 text-sm`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="font-semibold">{member.name ?? "이름 없음"} <span className="font-normal text-muted-foreground">· {[member.gender, member.age !== null ? `만 ${member.age}세` : null, member.area].filter(Boolean).join(" · ")}</span></p><p className="mt-1 text-xs text-muted-foreground">{member.email} · {member.phone ?? "번호 없음"} · 가입 {kstDay(member.createdAt)}</p></div>
        <p className="flex flex-wrap gap-1.5 text-[11px]"><span className={`rounded-full px-2.5 py-1 ${member.status === "suspended" ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>{MEMBER_STATE[member.status]}</span>{member.pausedAt && <span className="rounded-full bg-lilac px-2.5 py-1">쉬는 중</span>}<span className="rounded-full bg-muted px-2.5 py-1">{member.application ? STATUS_LABEL[member.application] ?? member.application : "신청 전"}{member.cohort != null ? ` · ${cohortName(member.cohort)}` : ""}</span></p>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">알림 {[member.channels.kakao && "카카오톡", member.channels.sms && "문자", member.channels.email && "메일"].filter(Boolean).join("·") || "미선택"} · 소개 {member.introductions}회 · 받은 신고 {member.reports}건{member.suspendedReason ? ` · 정지 사유: ${member.suspendedReason}` : ""}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {member.status === "active" && (member.pausedAt ? <Button size="sm" variant="outline" onClick={() => void change(member, "resume")}>다시 받기로</Button> : <Button size="sm" variant="outline" onClick={() => void change(member, "pause")}>일시정지</Button>)}
        {member.status === "active" && <><Input aria-label="이용 정지 사유" value={reasons[member.id] ?? ""} onChange={event => setReasons(current => ({ ...current, [member.id]: event.target.value }))} placeholder="정지 사유(회원에게 보여요)" className="h-8 max-w-xs text-xs" /><Button size="sm" variant="ghost" className="text-destructive" disabled={!(reasons[member.id] ?? "").trim()} onClick={() => void change(member, "suspend")}>이용 정지</Button></>}
        {member.status === "suspended" && <Button size="sm" variant="outline" onClick={() => void change(member, "unsuspend")}>정지 풀기</Button>}
      </div>
    </article>)}{list.data && !list.data.length && <p className="text-sm text-muted-foreground">찾는 회원이 없어요.</p>}</div>
  </>;
}

// ─────────────────────────────────────────────
// 감사로그(대표만) · 운영진 역할
export function LiveAudit() {
  const list = useLoad(() => table<{ id: number; at: string; actor_role: string; action: string; target: string | null; reason: string | null }>("audit_log", query => query.select("id, at, actor_role, action, target, reason").order("id", { ascending: false }).limit(200)), []);
  return <>
    <Title lead="고치거나 지울 수 없는 기록이에요. 대표만 볼 수 있고, 365일이 지나면 정리돼요.">감사로그</Title>
    <section className={`${box} overflow-x-auto`}><table className="w-full min-w-[640px] text-left text-xs"><thead className="border-b border-border text-muted-foreground"><tr><th className="p-3">시각</th><th className="p-3">역할</th><th className="p-3">기록</th><th className="p-3">대상</th></tr></thead><tbody className="divide-y divide-border">{(list.data ?? []).map(entry => <tr key={entry.id}><td className="p-3">{kstDateTime(entry.at)}</td><td className="p-3">{ROLE_LABEL[entry.actor_role as Role] ?? entry.actor_role}</td><td className="p-3">{entry.action}{entry.reason ? ` · ${entry.reason}` : ""}</td><td className="p-3 font-mono text-[11px] text-muted-foreground">{entry.target?.slice(0, 13)}</td></tr>)}</tbody></table>{!list.loading && !list.data?.length && <p className="p-5 text-sm text-muted-foreground">볼 수 있는 기록이 없어요. 대표 역할만 볼 수 있어요.</p>}</section>
  </>;
}
// 전체 공지(대표만): 모든 회원에게 사이트 알림 + 메일. 베타 종료·정식 전환은 7일 전에 보낸다.
function Broadcast() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!window.confirm(`모든 회원에게 사이트 알림과 메일로 보낼까요?\n\n${title}`)) return;
    setBusy(true);
    const { data, error } = await rpc<number>("admin_broadcast", { p_title: title, p_body: body });
    setBusy(false);
    setMessage(error || `${data ?? 0}명에게 보냈어요. 메일은 몇 분에 걸쳐 나가요(5분마다 50통).`);
    if (!error) { setTitle(""); setBody(""); }
  };
  return <section className={`${box} mt-8 space-y-3 p-5`}>
    <h2 className="text-sm font-semibold">전체 공지 · 사이트 알림 + 메일</h2>
    <p className="text-xs leading-6 text-muted-foreground">대표만 보낼 수 있어요. ‘메일 알림’을 고르지 않은 회원에게도 메일로 가요. 베타를 끝내거나 정식 운영으로 바꿀 때는 적어도 7일 전에 보내 주세요(약관 부칙).</p>
    <Input aria-label="공지 제목" value={title} maxLength={60} onChange={event => setTitle(event.target.value)} placeholder="제목(5~60자) · 예: 비포어스 정식 운영 안내" />
    <Textarea aria-label="공지 내용" value={body} maxLength={1000} onChange={event => setBody(event.target.value)} rows={5} placeholder="내용(10~1000자) · 바뀌는 날짜, 무엇이 바뀌는지, 원하지 않으면 탈퇴할 수 있다는 안내" />
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{body.trim().length} / 1000자</span><Button disabled={busy || title.trim().length < 5 || body.trim().length < 10} onClick={() => void send()}>모든 회원에게 보내기</Button></div>
    <Notice text={message} />
  </section>;
}

export function LiveSettings() {
  const list = useLoad(() => table<{ user_id: string; role: Role; granted_at: string }>("admin_roles", query => query.select("user_id, role, granted_at")), []);
  const emails = useLoad(async () => { const ids = (list.data ?? []).map(row => row.user_id); return ids.length ? table<{ id: string; email: string }>("profiles", query => query.select("id, email").in("id", ids)) : []; }, [list.data]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [message, setMessage] = useState("");
  const grant = async (target: string, next: Role | null) => { const { error } = await rpc("grant_admin_role", { p_email: target, p_role: next }); setMessage(error || (next ? "역할을 줬어요. 그 사람도 처음 들어올 때 인증 앱을 연결해야 해요." : "역할을 거뒀어요.")); await list.reload(); };
  return <>
    <Title lead="역할은 대표만 주고 거둘 수 있어요. 먼저 그 이메일로 회원가입을 해야 해요.">운영진</Title>
    <section className={`${box} space-y-3 p-5`}><div className="flex flex-wrap gap-2"><Input type="email" aria-label="운영진 이메일" value={email} onChange={event => setEmail(event.target.value)} placeholder="이메일" className="max-w-xs" /><select aria-label="역할" value={role} onChange={event => setRole(event.target.value as Role)} className="h-9 rounded-md border border-border bg-card px-2 text-sm">{(Object.keys(ROLE_LABEL) as Role[]).map(key => <option key={key} value={key}>{ROLE_LABEL[key]}</option>)}</select><Button onClick={() => void grant(email, role)} disabled={!email.trim()}>역할 주기</Button></div><Notice text={message} /></section>
    <section className={`${box} mt-5 divide-y divide-border`}>{(list.data ?? []).map(row => { const mail = emails.data?.find(item => item.id === row.user_id)?.email; return <div key={row.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"><span>{mail ?? row.user_id.slice(0, 8)} · {ROLE_LABEL[row.role]}</span><span className="flex items-center gap-2 text-xs text-muted-foreground">{kstDay(row.granted_at)}{mail && row.role !== "owner" && <Button size="sm" variant="ghost" onClick={() => void grant(mail, null)}>거두기</Button>}</span></div>; })}</section>
    <Broadcast />
  </>;
}
