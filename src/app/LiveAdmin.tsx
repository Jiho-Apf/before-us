import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useOutletContext } from "react-router";
import { Bell, Bug, CalendarRange, CreditCard, HeartHandshake, ClipboardList, FileClock, LayoutDashboard, ListChecks, LogOut, Settings2, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { signIn, signOut, useAuth, useAuthReady } from "./auth-service";
import { friendlyError, rpc, supabase } from "./backend/client";
import { adminLetterPhotoUrl } from "./backend/letterPhotos";
import { PHOTO_REVIEW_REASONS, PHOTO_SLOTS } from "./photo-model";
import { INQUIRY_STATUS } from "./inquiry-model";
import { REQUEST_LABELS } from "./member-operations-model";
import { kstDateTime, kstDay } from "./dates";
import { cohortName } from "./cohort";
import { BEFORE_US } from "./config";
import { MATCH_SCORE_SHOWN, box, call, revealOnNarrow, useBusy, useLoad, waitedDays, type ReadyMember } from "./admin-match";
import { AdminPhoto, MatchBoard, Notice, Pill, ProfileSheet, WaitBadge, show, useConfirm, type ApplicationDetail } from "./AdminMatch";

// 실제 서버 모드의 운영진 화면. 데모 운영 콘솔과 같은 틀을 쓰고, 모든 자료는 서버 권한(RLS·역할·2단계 인증)을 거쳐 온다.
// 화면에서 메뉴를 숨기는 것은 보안이 아니다. 권한은 서버 함수와 표 정책이 막는다(숨김은 쓸 수 없는 화면을 덜 보이게 할 뿐).
type Role = "owner" | "operator" | "counselor" | "finance";
const ROLE_LABEL: Record<Role, string> = { owner: "대표", operator: "운영", counselor: "상담", finance: "정산" };
const STAFF: Role[] = ["owner", "operator", "counselor"];
const NAV: { path: string; label: string; icon: typeof LayoutDashboard; roles: Role[] }[] = [
  { path: "/admin", label: "대시보드", icon: LayoutDashboard, roles: ["owner", "operator", "counselor", "finance"] },
  { path: "/admin/cohorts", label: "기수", icon: CalendarRange, roles: STAFF },
  { path: "/admin/applicants", label: "신청자", icon: ClipboardList, roles: STAFF },
  { path: "/admin/members", label: "회원", icon: Users, roles: STAFF },
  { path: "/admin/introductions", label: "소개·매칭", icon: ListChecks, roles: STAFF },
  { path: "/admin/programs", label: "교류·약속", icon: HeartHandshake, roles: STAFF },
  { path: "/admin/safety", label: "신고·문의", icon: ShieldAlert, roles: ["owner", "operator", "counselor", "finance"] },
  { path: "/admin/payments", label: "결제", icon: CreditCard, roles: ["owner", "operator", "finance"] },
  { path: "/admin/audit", label: "감사로그", icon: FileClock, roles: ["owner"] },
  { path: "/admin/settings", label: "운영진", icon: Settings2, roles: ["owner"] },
];
// 지금 로그인한 운영진의 역할(바깥 틀이 Outlet으로 넘긴다). 운영(대표·운영)만 바꾸는 버튼을 보여 준다.
const useRole = () => useOutletContext<{ role: Role } | undefined>()?.role ?? "counselor";
const canOperate = (role: Role) => role === "owner" || role === "operator";
const STATUS_LABEL: Record<string, string> = { draft: "작성 중", submitted: "접수", reviewing: "검토 중", needs_changes: "보완 요청", approved: "승인", held: "보류", withdrawn: "철회", rejected: "소개 어려움" };
const INTRO_LABEL: Record<string, string> = { reserved: "정오 예약", published: "공개", mutual: "서로 선택", closed: "종료", cancelled: "취소" };
const PROGRAM_LABEL: Record<string, string> = { choosing: "방식·시작일 합의", scheduled: "시작 전", started: "3일 교류", deciding: "만남 선택", arranging: "약속", closed: "마무리" };
const PROGRAM_END: Record<string, string> = { "agreement-expired": "합의 기한 지남", "meeting-declined": "만남 안 함", "meeting-nonresponse": "만남 선택 없음", "arrange-expired": "약속 기한 지남", completed: "만남 완료", blocked: "차단", withdrawn: "탈퇴", "admin-cancel": "운영 종료" };
const END_LABEL: Record<string, string> = { rejected: "한쪽 거절", nonresponse: "미응답", withdrawn: "탈퇴", blocked: "차단", "admin-cancel": "운영 취소", "missed-window": "정오 놓침", suspended: "이용 정지", precheck: "공개 직전 확인(쉬기·정지)" };
// 소개가 끝난 까닭: 교류에서 끝난 소개는 ‘program-…’으로 온다.
const endLabel = (reason: string) => reason.startsWith("program-") ? `교류 ${PROGRAM_END[reason.slice(8)] ?? reason.slice(8)}` : END_LABEL[reason] ?? reason;
const MEMBER_STATE: Record<string, string> = { active: "이용 중", withdrawal_requested: "탈퇴 요청", suspended: "이용 정지" };
const PAUSED_BY: Record<string, string> = { member: "회원이 쉬는 중", auto: "자동 쉬기(연속 무응답)", operator: "운영진이 멈춤" };

function Title({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return <div className="mb-6"><h1 className="text-2xl font-semibold">{children}</h1>{lead && <p className="mt-2 text-sm leading-6 text-muted-foreground">{lead}</p>}</div>;
}
function Gate({ title, children }: { title: string; children: ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-secondary p-6 text-foreground"><section className="w-full max-w-md rounded-xl border border-border bg-card p-6 sm:p-8"><p className="text-xs font-semibold tracking-widest text-primary">BEFORE US · OPERATIONS</p><h1 className="mt-4 text-2xl font-semibold">{title}</h1><div className="mt-6 space-y-4 text-sm">{children}</div></section></main>;
}
// 상태 고르는 작은 탭(숫자를 함께 보여 줄 수 있다)
function Tabs<T extends string>({ value, options, onChange }: { value: T; options: [T, string, number?][]; onChange: (value: T) => void }) {
  return <div className="mb-4 flex flex-wrap gap-2">{options.map(([key, label, count]) => <Button key={key} size="sm" variant={value === key ? "default" : "outline"} onClick={() => onChange(key)}>{label}{count !== undefined ? <span className="ml-1 tabular-nums opacity-70">{count}</span> : null}</Button>)}</div>;
}
// 회원 요약 한 줄(신고·요청·문의에서 같이 쓴다)
type Brief = { id: string; email: string; status: string; pausedBy: string | null; name: string | null; application: string | null; cohort: number | null; intro: string | null; program: string | null } | null;
function MemberBrief({ label, member }: { label: string; member: Brief }) {
  if (!member) return <p className="text-xs text-muted-foreground">{label} · 알 수 없음(탈퇴했거나 자동 감지)</p>;
  return <p className="flex flex-wrap items-center gap-1.5 text-xs"><span className="text-muted-foreground">{label}</span><Link to={`/admin/members?q=${encodeURIComponent(member.email)}`} className="font-semibold text-primary hover:underline">{member.name ?? "이름 없음"}</Link><span className="text-muted-foreground">{member.email}</span><Pill tone={member.status === "active" ? "muted" : "danger"}>{MEMBER_STATE[member.status] ?? member.status}</Pill>{member.pausedBy && <Pill tone="warn">{PAUSED_BY[member.pausedBy] ?? "쉬는 중"}</Pill>}<Pill>{member.application ? STATUS_LABEL[member.application] ?? member.application : "신청 전"}{member.cohort != null ? ` · ${cohortName(member.cohort)}` : ""}</Pill>{member.intro && <Pill tone="ok">소개 {INTRO_LABEL[member.intro] ?? member.intro}</Pill>}{member.program && <Pill tone="ok">교류 {PROGRAM_LABEL[member.program] ?? member.program}</Pill>}</p>;
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
  const nav = NAV.filter(item => item.roles.includes(role));
  const active = NAV.find(item => item.path === location.pathname) || NAV[0];
  return (
    <div className={`${dark ? "dark " : ""}min-h-screen bg-secondary font-sans text-foreground`}>
      <a href="#admin-content" className="fixed left-3 top-3 z-50 -translate-y-24 rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground focus:translate-y-0">관리자 본문으로</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-card lg:flex">
        <div className="border-b border-border px-6 py-6"><Link to="/admin" className="text-xl font-bold">비포어스<span className="ml-2 inline-flex gap-1 align-middle"><span className="h-2 w-2 rounded-full bg-primary" /><span className="h-2 w-2 rounded-full bg-accent" /></span></Link><p className="mt-1 text-xs tracking-widest text-muted-foreground">BEFORE US · OPERATIONS</p></div>
        <nav aria-label="관리자 메뉴" className="grid flex-1 content-start gap-1 overflow-y-auto p-3">{nav.map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} end={path === "/admin"} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 motion-reduce:transition-none ${isActive ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}><Icon size={17} strokeWidth={1.7} />{label}</NavLink>)}</nav>
        <div className="border-t border-border p-5"><div className="mb-2 flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={15} className="text-primary" />{ROLE_LABEL[role]} · 2단계 인증</div><p className="break-all text-xs leading-5 text-muted-foreground">{user?.email}</p></div>
      </aside>
      <div className="lg:pl-56">
        <header className="sticky top-0 z-20 border-b border-border bg-card">
          <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-5 py-3 lg:px-8">
            <div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">ADMIN</span><span className="text-border">/</span><span className="font-semibold">{active.label}</span></div>
            <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" onClick={() => setDark(value => !value)}>{dark ? "라이트" : "다크"}</Button><Button size="sm" variant="outline" onClick={signOut}><LogOut size={14} />로그아웃</Button></div>
          </div>
          <nav aria-label="관리자 메뉴" className="flex gap-1 overflow-x-auto px-5 pb-3 lg:hidden">{nav.map(({ path, label }) => <NavLink key={path} to={path} end={path === "/admin"} className={({ isActive }) => `shrink-0 rounded-lg px-3 py-2 text-xs ${isActive ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`}>{label}</NavLink>)}</nav>
        </header>
        <main id="admin-content" className="mx-auto max-w-7xl px-5 py-7 lg:px-8"><Outlet context={{ role }} /></main>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 대시보드: 오늘 처리할 일. 역할마다 볼 수 있는 자료가 달라서, 못 불러온 칸은 빼고 나머지를 보여 준다.
const JOB_LABEL: Record<string, string> = { noon: "정오 공개", deadlines: "응답 마감", retention: "보존 기간 정리", email: "메일 발송", reminders: "마감 전 알림", programs: "교류 진행", "program-retention": "교류 글 정리", "cohort-eve": "기수 전날 알림", "storage-cleanup": "사진 파일 정리" };
const JOB_KEYS: Record<string, string> = { sent: "보냄", failed: "실패", reason: "사유", closed: "마감", published: "공개", cancelled: "취소", entries: "교류 글", proposals: "약속 제안", orphanPhotos: "남은 사진", letterPhotos: "편지 사진", error: "오류", deleted: "삭제", reminded: "알림", gaveUp: "3번 실패해 멈춤", removed: "지운 파일", notified: "알림", members: "탈퇴 회원", snapshots: "프로필 사본", inquiries: "문의", audits: "감사 기록", notifications: "읽은 알림", testPayments: "테스트 결제" };
const jobDetail = (detail: Record<string, unknown> | null) => Object.entries(detail ?? {}).map(([key, value]) => `${JOB_KEYS[key] ?? key} ${typeof value === "object" ? JSON.stringify(value) : String(value)}`.slice(0, 120)).join(" · ") || "처리할 것 없음";
const maybe = <T,>(task: Promise<T>) => task.then(value => value, () => null);

export function LiveAdminHome() {
  const { data, error } = useLoad(async () => {
    const day = new Date(Date.now() - 86400000).toISOString();
    const [applications, ready, intros, reports, inquiries, requests, jobs, mail, errors, failedJobs] = await Promise.all([
      maybe(call<{ status: string; source: string | null; cohort: number | null }[]>("admin_list_applications")),
      maybe(call<ReadyMember[]>("admin_ready_members")),
      maybe(call<{ status: string; reveal_at: string }[]>("admin_list_introductions")),
      maybe(call<{ status: string; urgent: boolean }[]>("admin_list_reports").then(rows => rows.filter(row => row.status !== "closed"))),
      maybe(call<{ status: string }[]>("admin_list_inquiries").then(rows => rows.filter(row => row.status !== "answered"))),
      maybe(call<{ status: string }[]>("admin_list_requests").then(rows => rows.filter(row => row.status !== "decided"))),
      maybe(table<{ job: string; started_at: string; ok: boolean | null; detail: Record<string, unknown> | null }>("job_runs", query => query.select("job, started_at, ok, detail").order("started_at", { ascending: false }).limit(8))),
      maybe(table<{ started_at: string; ok: boolean | null; detail: { sent?: number; failed?: number; gaveUp?: number; reason?: string } | null }>("job_runs", query => query.select("started_at, ok, detail").eq("job", "email").gt("started_at", day).order("started_at", { ascending: false }).limit(1))),
      maybe(table<{ id: number; at: string; context: string | null; message: string | null; path: string | null }>("client_errors", query => query.select("id, at, context, message, path").gt("at", new Date(Date.now() - 7 * 86400000).toISOString()).order("id", { ascending: false }).limit(20))),
      // 정오 공개·응답 마감·교류·알림 작업이 실패하면 맨 위에 알린다(최근 24시간).
      maybe(table<{ job: string; started_at: string; detail: { error?: string } | null }>("job_runs", query => query.select("job, started_at, detail").eq("ok", false).neq("job", "email").gt("started_at", day).order("started_at", { ascending: false }).limit(5))),
    ]);
    return { applications, ready, intros, reports, inquiries, requests, jobs: jobs ?? [], mail: mail?.[0] ?? null, errors: errors ?? [], failedJobs: failedJobs ?? [] };
  });
  if (error) return <Notice text={error} />;
  if (!data) return <p className="text-sm text-muted-foreground">불러오고 있어요.</p>;
  const { waitingNoteAfterDays } = BEFORE_US.noonGuidance;
  const tiles = ([
    ["검토할 신청서", data.applications?.filter(item => item.status === "submitted" || item.status === "reviewing").length, "/admin/applicants?status=open"],
    ["소개 가능한 회원", data.ready?.length, "/admin/introductions"],
    [`오래 기다리는 회원 · ${waitingNoteAfterDays}일 이상`, data.ready?.filter(member => (waitedDays(member.waiting_since) ?? 0) >= waitingNoteAfterDays).length, "/admin/introductions"],
    ["정오 예약", data.intros?.filter(item => item.status === "reserved").length, "/admin/introductions?status=reserved"],
    ["응답 기다리는 소개", data.intros?.filter(item => item.status === "published").length, "/admin/introductions?status=published"],
    ["처리할 신고", data.reports?.length, "/admin/safety?tab=reports"],
    ["답변 대기 문의", data.inquiries?.length, "/admin/safety?tab=inquiries"],
    ["회원 요청", data.requests?.length, "/admin/safety?tab=requests"],
  ] as [string, number | undefined, string][]).filter(([, count]) => count !== undefined) as [string, number, string][];
  const urgent = data.reports?.filter(item => item.urgent).length ?? 0;
  // 유입 경로: 제출한 신청서 기준(작성 중·철회 제외)
  const submitted = (data.applications ?? []).filter(item => !["draft", "withdrawn"].includes(item.status));
  const sources = Object.entries(submitted.reduce<Record<string, number>>((all, item) => ({ ...all, [item.source || "응답 없음"]: (all[item.source || "응답 없음"] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  return <>
    <Title lead="실제 회원 자료예요. 열람과 처리는 모두 감사 기록에 남아요.">오늘 처리할 일</Title>
    {data.failedJobs.length > 0 && <p role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive"><span className="font-semibold">예약 작업이 실패했어요</span> · {data.failedJobs.map(job => `${JOB_LABEL[job.job] ?? job.job} ${kstDateTime(job.started_at)}`).join(" · ")}<br /><span className="text-xs">정오 공개가 실패했다면 Supabase SQL 편집기에서 <code>select public.run_noon();</code>을 한 번 실행해 주세요. {data.failedJobs[0].detail?.error ? `오류: ${String(data.failedJobs[0].detail.error).slice(0, 120)}` : ""}</span></p>}
    {data.mail?.ok === false && <p role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive"><span className="font-semibold">메일 발송이 실패하고 있어요</span> · {kstDateTime(data.mail.started_at)} · 실패 {data.mail.detail?.failed ?? 0}통{data.mail.detail?.gaveUp ? ` · 3번 실패해 더 보내지 않는 메일 ${data.mail.detail.gaveUp}통` : ""}{data.mail.detail?.reason ? ` · ${data.mail.detail.reason.slice(0, 120)}` : ""}<br /><span className="text-xs">Supabase → Edge Functions → Secrets의 MAIL_FROM·SMTP_USER(메일 주소)·SMTP_PASS(앱 비밀번호)를 확인해 주세요. 사이트 안 알림은 그대로 보여요.</span></p>}
    {urgent > 0 && <Link to="/admin/safety?tab=reports" role="alert" className="mb-5 block rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive">긴급 신고 {urgent}건 · 먼저 확인해 주세요 →</Link>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{tiles.map(([label, count, to]) => <Link key={label} to={to} className={`${box} p-5 transition-colors hover:border-primary/40`}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-light tabular-nums text-primary">{count}</p></Link>)}</div>
    <section className={`${box} mt-6 p-5`}><h2 className="flex items-center gap-2 text-sm font-semibold"><Bell size={15} className="text-accent" />예약 작업 기록</h2>{data.jobs.length ? <ul className="mt-3 divide-y divide-border text-xs">{data.jobs.map((job, index) => <li key={index} className="flex flex-wrap justify-between gap-2 py-2"><span><span className="font-semibold">{JOB_LABEL[job.job] ?? job.job}</span> · {job.ok === false ? <span className="font-semibold text-destructive">실패</span> : "완료"} · <span className="text-muted-foreground">{jobDetail(job.detail)}</span></span><span className="text-muted-foreground">{kstDateTime(job.started_at)}</span></li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">아직 실행 기록이 없어요. 정오 작업은 매일 12:00에 돌아요.</p>}</section>
    {data.applications && <section className={`${box} mt-6 p-5`}><h2 className="text-sm font-semibold">유입 경로 · 제출한 신청서 {submitted.length}건</h2>{sources.length ? <ul className="mt-3 grid gap-2 text-xs sm:grid-cols-2">{sources.map(([label, count]) => <li key={label} className="flex items-center gap-3"><span className="w-28 shrink-0 text-muted-foreground">{label}</span><span className="h-2 rounded-full bg-primary/70" style={{ width: `${Math.max(6, Math.round(count / submitted.length * 100))}%` }} /><span className="tabular-nums">{count}</span></li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">아직 제출한 신청서가 없어요. 홍보 링크 끝에 ?from=instagram · ?from=threads 를 붙이면 경로가 자동으로 채워져요.</p>}</section>}
    <section className={`${box} mt-6 p-5`}><h2 className="flex items-center gap-2 text-sm font-semibold"><Bug size={15} className="text-accent" />화면 오류 · 최근 7일 {data.errors.length ? `${data.errors.length}건` : ""}</h2>{data.errors.length ? <ul className="mt-3 divide-y divide-border text-xs">{data.errors.map(item => <li key={item.id} className="py-2 leading-5"><span className="text-muted-foreground">{kstDateTime(item.at)} · {item.path ?? "-"} · {item.context ?? "-"}</span><br />{item.message}</li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">회원 화면에서 난 오류가 없어요. 오류가 나면 이메일·전화번호를 지운 채로 여기에 모여요.</p>}</section>
  </>;
}
async function table<T>(name: string, build: (query: any) => any) { const db = await supabase(); const { data, error } = await build(db.from(name)); if (error) throw new Error(friendlyError(error)); return (data ?? []) as T[]; }

// ─────────────────────────────────────────────
// 기수: 모집 현황(운영진만) · 날짜와 인원 조정 · 성별 마감 · 다음 기수 만들기
type GenderStats = { total: number; approved: number; reviewing: number; needsChanges: number; held: number };
type Cohort = { number: number; startsOn: string; applicationDeadline: string; minPerGender: number; maxPerGender: number; closedGenders: string[]; note: string | null; counts: Record<string, GenderStats>; ages: Record<string, number>; regions: Record<string, number> };
const GENDERS = ["여성", "남성"] as const;
const todayKst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

function GenderBar({ label, stats, min, max, closed, disabled, onToggle }: { label: string; stats?: GenderStats; min: number; max: number; closed: boolean; disabled: boolean; onToggle: () => void }) {
  const total = stats?.total ?? 0, approved = stats?.approved ?? 0;
  const width = (value: number) => `${Math.min(100, (value / max) * 100)}%`;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><span className="font-semibold">{label} <span className="ml-1 text-2xl font-light tabular-nums text-primary">{total}</span><span className="text-xs text-muted-foreground"> / {max}명</span></span><span className="text-xs text-muted-foreground">승인 {approved} · 검토 {stats?.reviewing ?? 0} · 보완 {stats?.needsChanges ?? 0}{stats?.held ? ` · 보류 ${stats.held}` : ""} · 최소 {min}명{total >= min ? " 충족" : `까지 ${min - total}명 남음`}</span></div>
    <div className="relative h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="absolute inset-y-0 left-0 rounded-full bg-primary/25" style={{ width: width(total) }} /><span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: width(approved) }} /><span className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: width(min) }} /></div>
    <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={closed} disabled={disabled} onChange={onToggle} />{label} 신청 마감(이후 신청은 다음 기수로)</label>
  </div>;
}

function CohortCard({ cohort, editable, onSaved }: { cohort: Cohort; editable: boolean; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ startsOn: cohort.startsOn, deadline: cohort.applicationDeadline, min: cohort.minPerGender, max: cohort.maxPerGender, note: cohort.note ?? "" });
  const [closed, setClosed] = useState<string[]>(cohort.closedGenders);
  useEffect(() => { setClosed(cohort.closedGenders); }, [cohort.closedGenders.join(",")]);
  const [message, setMessage] = useState("");
  const { busy, run } = useBusy();
  const today = todayKst();
  const phase = today > cohort.startsOn ? "진행 중" : today > cohort.applicationDeadline ? "마감 · 첫날 짝 준비" : "모집 중";
  const send = async (values: { startsOn: string; deadline: string; min: number; max: number; note: string }, nextClosed: string[]) => (await rpc("admin_update_cohort", { p_number: cohort.number, p_starts_on: values.startsOn, p_deadline: values.deadline, p_min: Number(values.min), p_max: Number(values.max), p_closed: nextClosed, p_note: values.note })).error;
  const save = () => run("save", async () => { const error = await send(form, closed); setMessage(error || "저장했어요. 공개 화면의 날짜도 함께 바뀌어요."); if (!error) await onSaved(); });
  // 성별 마감은 그 칸만 바꾼다: 날짜·인원은 저장된 값 그대로 보낸다(고치다 만 입력이 같이 저장되지 않게).
  const toggle = (gender: string) => run(`close-${gender}`, async () => {
    const next = closed.includes(gender) ? closed.filter(item => item !== gender) : [...closed, gender];
    setClosed(next);
    const error = await send({ startsOn: cohort.startsOn, deadline: cohort.applicationDeadline, min: cohort.minPerGender, max: cohort.maxPerGender, note: cohort.note ?? "" }, next);
    if (error) setClosed(closed);
    setMessage(error || `${gender} 신청을 ${next.includes(gender) ? "마감했어요" : "다시 열었어요"}.`);
    if (!error) await onSaved();
  });
  const chips = (record: Record<string, number>) => Object.entries(record).sort((a, b) => b[1] - a[1]).map(([key, value]) => <span key={key} className="rounded-full bg-muted px-2.5 py-1 text-[11px]">{key} {value}</span>);
  return <section className={`${box} space-y-5 p-5`} aria-label={`${cohortName(cohort.number)}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{phase}</p><h2 className="mt-1 text-xl font-semibold">{cohortName(cohort.number)} · {kstDay(cohort.startsOn)} 정오 시작</h2><p className="mt-1 text-xs text-muted-foreground">신청 마감 {kstDay(cohort.applicationDeadline)}{cohort.note ? ` · ${cohort.note}` : ""}</p></div><Link to={`/admin/applicants?cohort=${cohort.number}&status=all`} className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-secondary">이 기수 신청자 보기 →</Link></div>
    <div className="grid gap-5 md:grid-cols-2">{GENDERS.map(gender => <GenderBar key={gender} label={gender} stats={cohort.counts[gender]} min={cohort.minPerGender} max={cohort.maxPerGender} closed={closed.includes(gender)} disabled={!editable || !!busy} onToggle={() => void toggle(gender)} />)}</div>
    {cohort.counts["직접 확인이 필요해요"] && <p className="text-xs text-accent">성별 직접 확인이 필요한 신청 {cohort.counts["직접 확인이 필요해요"].total}건</p>}
    {(Object.keys(cohort.ages).length > 0 || Object.keys(cohort.regions).length > 0) && <div className="space-y-2 text-xs"><div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-muted-foreground">나이대</span>{chips(cohort.ages)}</div><div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-muted-foreground">지역</span>{chips(cohort.regions)}</div></div>}
    {editable && <details className="border-t border-border pt-4"><summary className="cursor-pointer text-xs font-semibold">날짜·인원 바꾸기</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-xs">시작일(정오)<Input type="date" value={form.startsOn} onChange={event => setForm({ ...form, startsOn: event.target.value })} className="mt-1" /></label>
      <label className="text-xs">신청 마감<Input type="date" value={form.deadline} onChange={event => setForm({ ...form, deadline: event.target.value })} className="mt-1" /></label>
      <label className="text-xs">최소(성별)<Input type="number" min={0} value={form.min} onChange={event => setForm({ ...form, min: Number(event.target.value) })} className="mt-1" /></label>
      <label className="text-xs">최대(성별)<Input type="number" min={1} value={form.max} onChange={event => setForm({ ...form, max: Number(event.target.value) })} className="mt-1" /></label>
      <label className="text-xs">메모(운영진만)<Input value={form.note} maxLength={80} onChange={event => setForm({ ...form, note: event.target.value })} className="mt-1" /></label>
    </div><Button size="sm" className="mt-3" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? "저장하고 있어요" : "저장"}</Button></details>}
    <Notice text={message} />
  </section>;
}

export function LiveCohorts() {
  const role = useRole();
  const list = useLoad(() => call<Cohort[]>("admin_cohort_overview"), []);
  const [message, setMessage] = useState("");
  const { busy, run } = useBusy();
  const { ask, dialog } = useConfirm();
  const last = list.data?.[list.data.length - 1];
  const addNext = () => run("next", async () => {
    if (await ask({ title: "다음 기수를 만들까요?", body: <p>{last ? `${cohortName(last.number)} 다음 기수를` : "새 기수를"} 매달 마지막 날 규칙으로 만들어요. 만든 뒤 날짜·인원은 카드에서 바꿀 수 있어요.</p>, confirm: "만들기" }) === null) return;
    const { data, error } = await rpc<number>("admin_create_next_cohort");
    setMessage(error || `${data}기를 만들었어요(매달 마지막 날 규칙).`);
    await list.reload();
  });
  return <>
    <Title lead="모인 인원은 이 화면에서만 보여요. 공개 화면에는 기수 번호와 첫 소개 날짜만 나가요. 성별 최대 인원이 차거나 마감하면, 이후 신청은 다음 기수로 들어가요.">기수</Title>
    {list.error && <Notice text={list.error} />}
    {list.loading && !list.data && <p className="text-sm text-muted-foreground">불러오고 있어요.</p>}
    <div className="space-y-5">{(list.data ?? []).map(cohort => <CohortCard key={cohort.number} cohort={cohort} editable={canOperate(role)} onSaved={list.reload} />)}</div>
    {canOperate(role) && <div className="mt-5 flex flex-wrap items-center gap-3"><Button variant="outline" disabled={!!busy} onClick={() => void addNext()}>{busy ? "만들고 있어요" : "다음 기수 만들기"}</Button><Notice text={message} /></div>}
    {dialog}
  </>;
}

// ─────────────────────────────────────────────
// 신청자: 상태 탭(숫자) · 기수·성별·이름으로 거르기 → 열람(감사 기록) → 사진 확인 → 결정
type ApplicationRow = { member_id: string; status: string; submitted_at: string | null; name: string | null; gender: string | null; desired: string | null; province: string | null; area: string | null; age: number | null; source: string | null; photo_count: number; photo_requests: number; cohort: number | null };
type ApplicantTab = "open" | "needs_changes" | "held" | "approved" | "rejected" | "withdrawn" | "all";
const APPLICANT_TABS: [ApplicantTab, string][] = [["open", "검토할 신청서"], ["needs_changes", "보완 요청"], ["held", "보류"], ["approved", "승인"], ["rejected", "소개 어려움"], ["withdrawn", "철회"], ["all", "전체"]];
const inTab = (tab: ApplicantTab, status: string) => tab === "all" || (tab === "open" ? ["submitted", "reviewing"].includes(status) : status === tab);

export function LiveApplicants() {
  const role = useRole();
  const search = new URLSearchParams(useLocation().search);
  const deepMember = search.get("member");
  const [tab, setTab] = useState<ApplicantTab>(() => (APPLICANT_TABS.some(([key]) => key === search.get("status")) ? search.get("status") as ApplicantTab : deepMember ? "all" : "open"));
  const [cohort, setCohort] = useState(search.get("cohort") ?? "");
  const [gender, setGender] = useState("");
  const [query, setQuery] = useState("");
  const list = useLoad(() => call<ApplicationRow[]>("admin_list_applications"), []);
  const cohorts = useLoad(() => call<Cohort[]>("admin_cohort_overview").catch(() => [] as Cohort[]), []);
  const [selected, setSelected] = useState<string | null>(deepMember);
  const all = list.data ?? [];
  const base = all.filter(row => (!cohort || String(row.cohort ?? "") === cohort) && (!gender || row.gender === gender) && (!query.trim() || (row.name ?? "").includes(query.trim())));
  const rows = base.filter(row => inTab(tab, row.status));
  const pick = (id: string) => { setSelected(id); revealOnNarrow("applicant-detail"); };
  return <>
    <Title lead="생년월일 원값은 보이지 않고 만 나이만 보여요. 신청서를 열면 회원별로 하루 한 번 열람 기록이 남아요.">신청자</Title>
    <Tabs value={tab} onChange={setTab} options={APPLICANT_TABS.map(([key, label]) => [key, label, base.filter(row => inTab(key, row.status)).length])} />
    <div className="mb-4 flex flex-wrap gap-2 text-xs">
      <select aria-label="기수" value={cohort} onChange={event => setCohort(event.target.value)} className="h-8 rounded-md border border-border bg-card px-2">{[["", "모든 기수"], ...Array.from(new Set(all.map(row => row.cohort).filter((value): value is number => value != null))).sort((a, b) => a - b).map(value => [String(value), cohortName(value)])].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="성별" value={gender} onChange={event => setGender(event.target.value)} className="h-8 rounded-md border border-border bg-card px-2"><option value="">모든 성별</option><option>여성</option><option>남성</option><option>직접 확인이 필요해요</option></select>
      <Input aria-label="이름으로 찾기" value={query} onChange={event => setQuery(event.target.value)} placeholder="이름" className="h-8 max-w-40 text-xs" />
    </div>
    {list.error && <Notice text={list.error} />}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className={`${box} divide-y divide-border self-start`}>{rows.length ? rows.map(row => <button key={row.member_id} type="button" onClick={() => pick(row.member_id)} className={`block w-full px-4 py-3 text-left text-sm ${selected === row.member_id ? "bg-primary/5" : "hover:bg-secondary"}`}><span className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{row.name || "이름 미입력"} <span className="font-normal text-muted-foreground">· {row.gender} → {row.desired} · {row.age ?? "?"}세 · {row.province} {row.area}</span></span><span className="text-xs text-primary">{STATUS_LABEL[row.status]}</span></span><span className="mt-1 block text-xs text-muted-foreground">{row.cohort != null ? `${cohortName(row.cohort)} · ` : ""}사진 {row.photo_count}/4{row.photo_requests ? ` · 재등록 요청 ${row.photo_requests}` : ""} · 접수 {row.submitted_at ? kstDateTime(row.submitted_at) : "—"}{row.source ? ` · 유입 ${row.source}` : ""}</span></button>) : <p className="p-5 text-sm text-muted-foreground">{list.loading ? "불러오고 있어요." : "해당하는 신청서가 없어요."}</p>}</div>
      <div id="applicant-detail" className="scroll-mt-24">{selected ? <ApplicantDetail key={selected} memberId={selected} row={all.find(row => row.member_id === selected)} cohorts={cohorts.data ?? []} canDecide={canOperate(role)} onChanged={list.reload} /> : <p className={`${box} p-5 text-sm text-muted-foreground`}>왼쪽에서 신청서를 골라 주세요.</p>}</div>
    </div>
  </>;
}

// 지금 상태에서 할 수 있는 결정만 보여 준다(같은 결정은 서버도 막는다).
const NEXT: Record<string, { status: string; label: string; tone?: "primary" | "ghost"; confirm?: string; note?: boolean }[]> = {
  submitted: [{ status: "reviewing", label: "검토 시작" }, { status: "approved", label: "승인", tone: "primary" }, { status: "needs_changes", label: "보완 요청", note: true }, { status: "held", label: "보류", note: true }, { status: "rejected", label: "소개 어려움", tone: "ghost", note: true, confirm: "rejected" }],
  reviewing: [{ status: "approved", label: "승인", tone: "primary" }, { status: "needs_changes", label: "보완 요청", note: true }, { status: "held", label: "보류", note: true }, { status: "rejected", label: "소개 어려움", tone: "ghost", note: true, confirm: "rejected" }],
  needs_changes: [{ status: "reviewing", label: "다시 검토" }, { status: "held", label: "보류", note: true }, { status: "rejected", label: "소개 어려움", tone: "ghost", note: true, confirm: "rejected" }],
  held: [{ status: "reviewing", label: "다시 검토" }, { status: "approved", label: "승인", tone: "primary" }, { status: "needs_changes", label: "보완 요청", note: true }, { status: "rejected", label: "소개 어려움", tone: "ghost", note: true, confirm: "rejected" }],
  approved: [{ status: "held", label: "승인 취소(보류로)", note: true, confirm: "unapprove" }, { status: "rejected", label: "소개 어려움", tone: "ghost", note: true, confirm: "rejected" }],
  rejected: [{ status: "reviewing", label: "다시 검토" }],
};

function ApplicantDetail({ memberId, row, cohorts, canDecide, onChanged }: { memberId: string; row?: ApplicationRow; cohorts: Cohort[]; canDecide: boolean; onChanged: () => Promise<void> }) {
  const detail = useLoad(() => call<ApplicationDetail>("admin_get_application", { p_member: memberId }), [memberId]);
  const [note, setNote] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [moveTo, setMoveTo] = useState("");
  const [message, setMessage] = useState("");
  const { busy, run } = useBusy();
  const { ask, dialog } = useConfirm();
  if (detail.error) return <Notice text={detail.error} />;
  if (!detail.data) return <p className={`${box} p-5 text-sm text-muted-foreground`}>불러오고 있어요.</p>;
  const data = detail.data;
  const values = data.draft.values ?? {};
  const name = show(values["self.name"]) || "이름 미입력";
  const act = (key: string, task: () => Promise<unknown>, done: string) => run(key, async () => { try { await task(); setMessage(done); await detail.reload(); await onChanged(); } catch (error) { setMessage((error as Error).message); } });
  const decide = async (action: (typeof NEXT)[string][number]) => {
    if (action.confirm && await ask(action.confirm === "unapprove"
      ? { title: `${name}님 승인을 취소할까요?`, body: <><p>보류로 바뀌고, 적은 안내와 함께 회원에게 알림이 가요.</p><p>이미 예약·진행 중인 소개는 그대로예요. 필요하면 소개·매칭에서 따로 취소해 주세요.</p></>, confirm: "승인 취소", danger: true }
      : { title: `${name}님을 ‘소개 어려움’으로 기록할까요?`, body: <p>회원에게 결과 알림이 가고, 적은 안내가 오늘 화면에 보여요. 평가하는 말이 없는지 한 번 더 봐 주세요.</p>, confirm: "소개 어려움으로", danger: true }) === null) return;
    await act(`decide-${action.status}`, () => call("admin_decide_application", { p_member: memberId, p_status: action.status, p_note: note.trim() || null }), `${action.label}(으)로 기록했어요.`);
  };
  const move = () => run("move", async () => {
    if (!moveTo || await ask({ title: `${name}님을 ${cohortName(Number(moveTo))}로 옮길까요?`, body: <p>기수 시작일 전에는 소개를 예약할 수 없어요. 회원에게 따로 알림은 가지 않아요.</p>, confirm: "옮기기" }) === null) return;
    const { error } = await rpc("admin_move_member_cohort", { p_member: memberId, p_number: Number(moveTo) });
    setMessage(error || `${cohortName(Number(moveTo))}로 옮겼어요.`); if (!error) { setMoveTo(""); await onChanged(); }
  });
  const actions = NEXT[data.status] ?? [];
  // 철회한 신청서 다시 열기: 회원이 문의로 다시 신청하고 싶다고 알려 온 경우에만.
  const reopen = () => run("reopen", async () => {
    const reason = await ask({ title: `${name}님 신청서를 다시 열까요?`, confirm: "다시 열기", body: <><p>작성 중으로 바뀌어 회원이 이어서 고치고 다시 제출할 수 있어요. 회원에게 알림이 가요.</p><p>회원이 다시 신청하고 싶다고 직접 알려 온 경우에만 열어 주세요.</p></>, reason: { label: "다시 여는 이유(감사 기록에 남아요)", required: true, placeholder: "예: 문의로 다시 신청하고 싶다고 했어요." } });
    if (reason === null) return;
    const { error } = await rpc("admin_reopen_application", { p_member: memberId, p_reason: reason });
    setMessage(error || "신청서를 다시 열었어요. 회원에게 알렸어요.");
    if (!error) { await detail.reload(); await onChanged(); }
  });
  return <section className={`${box} space-y-6 p-5`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">프로필 버전 {data.profileVersion} · 접수 {data.submittedAt ? kstDateTime(data.submittedAt) : "—"}{row?.cohort != null ? ` · ${cohortName(row.cohort)}` : ""}</p><h2 className="mt-1 text-xl font-semibold">{name} · 만 {show(values["self.age"])}세</h2></div><div className="flex flex-wrap items-center gap-2">{data.status === "approved" && <Link to={`/admin/introductions?member=${memberId}`} className="rounded-full bg-primary/8 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/12">소개·매칭에서 보기 →</Link>}<span className="rounded-full border border-primary/30 px-3 py-1 text-xs text-primary">{STATUS_LABEL[data.status]}</span></div></div>
    {data.decisionNote && <p className="rounded-lg bg-muted p-3 text-xs leading-6">회원에게 보낸 안내 · {data.decisionNote}</p>}
    <div><h3 className="text-sm font-semibold">사진</h3><div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">{PHOTO_SLOTS.map(slot => { const photo = data.photos.find(item => item.slot === slot.id); return <div key={slot.id} className="space-y-2 text-xs"><p className="font-semibold">{slot.number}. {slot.label}</p>{photo ? <><AdminPhoto path={photo.path} /><p className="text-muted-foreground">{photo.width}×{photo.height} · {photo.review}{photo.reason ? ` · ${photo.reason}` : ""}</p>{canDecide && <div className="flex flex-wrap gap-1"><Button size="sm" variant={photo.review === "기준 확인" ? "default" : "outline"} disabled={!!busy || photo.review === "기준 확인"} className="h-7 px-2 text-[11px]" onClick={() => void act(`photo-${slot.id}`, () => call("admin_review_photo", { p_member: memberId, p_slot: slot.id, p_review: "기준 확인" }), `${slot.label} 기준 확인`)}>기준 확인</Button><select aria-label={`${slot.label} 재등록 사유`} value={reasons[slot.id] ?? ""} onChange={event => setReasons(current => ({ ...current, [slot.id]: event.target.value }))} className="h-7 rounded-md border border-border bg-card px-1 text-[11px]"><option value="">재등록 사유</option>{PHOTO_REVIEW_REASONS.map(reason => <option key={reason}>{reason}</option>)}</select><Button size="sm" variant="outline" disabled={!reasons[slot.id] || !!busy} className="h-7 px-2 text-[11px]" onClick={() => void act(`photo-${slot.id}`, () => call("admin_review_photo", { p_member: memberId, p_slot: slot.id, p_review: "재등록 요청", p_reason: reasons[slot.id] }), `${slot.label} 재등록 요청`)}>재등록 요청</Button></div>}</> : <p className="text-muted-foreground">{slot.required ? "미등록 · 필수" : "미등록"}</p>}</div>; })}</div></div>
    <div><h3 className="text-sm font-semibold">신청 내용</h3><div className="mt-3"><ProfileSheet detail={data} full /></div></div>
    {canDecide && cohorts.length > 0 && <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5 text-xs"><span className="font-semibold">기수 옮기기</span><select aria-label="옮길 기수" value={moveTo} onChange={event => setMoveTo(event.target.value)} className="h-8 rounded-md border border-border bg-card px-2"><option value="">기수 고르기</option>{cohorts.filter(item => item.number !== row?.cohort).map(item => <option key={item.number} value={item.number}>{cohortName(item.number)} · {kstDay(item.startsOn)} 시작</option>)}</select><Button size="sm" variant="outline" className="h-8" disabled={!moveTo || !!busy} onClick={() => void move()}>옮기기</Button></div>}
    {canDecide && <div className="space-y-3 border-t border-border pt-5"><h3 className="text-sm font-semibold">결정</h3>{actions.length ? <><Textarea aria-label="회원에게 보낼 안내" value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="보완·보류·소개 어려움·승인 취소일 때 회원에게 보일 안내를 적어 주세요. 평가하는 말은 쓰지 않아요." className="min-h-20" /><div className="flex flex-wrap gap-2">{actions.map(action => <Button key={action.status} size="sm" variant={action.tone === "primary" ? "default" : action.tone === "ghost" ? "ghost" : "outline"} disabled={!!busy || (action.note && !note.trim())} title={action.note && !note.trim() ? "회원에게 보낼 안내를 먼저 적어 주세요" : undefined} onClick={() => void decide(action)}>{busy === `decide-${action.status}` ? "기록하고 있어요" : action.label}</Button>)}</div>{actions.some(action => action.note) && !note.trim() && <p className="text-[11px] text-muted-foreground">보완 요청·보류·소개 어려움은 안내를 적어야 눌러져요.</p>}</> : data.status === "withdrawn" ? <div className="flex flex-wrap items-center gap-3"><p className="text-xs text-muted-foreground">회원이 철회한 신청서예요.</p><Button size="sm" variant="outline" disabled={!!busy} onClick={() => void reopen()}>{busy === "reopen" ? "여는 중이에요" : "신청서 다시 열기…"}</Button></div> : <p className="text-xs text-muted-foreground">회원이 다시 제출하면 결정할 수 있어요.</p>}</div>}
    <Notice text={message} />
    {dialog}
  </section>;
}

// ─────────────────────────────────────────────
// 소개·매칭: 왼쪽 회원 → 오른쪽 후보(점수 순) → 두 소개서 · 궁합 · 정오 예약. 아래는 소개 기록.
// match: 예약 때 함께 보낸 ‘회원에게 보일 궁합’(운영진은 65점 아래 점수도 본다 · 회원에게는 숫자 없이)
type StoredMatch = { score: number | null; headline: string; why: string[]; together: string[] };
type IntroRow = { id: string; status: string; reveal_at: string; respond_by: string; member_a: string | null; member_b: string | null; name_a: string | null; name_b: string | null; response_a: string | null; response_b: string | null; opened_a: boolean; opened_b: boolean; end_reason: string | null; note: string; mutual?: boolean; match?: StoredMatch | null };
// 소개 기록의 ‘회원에게 보인 궁합’: 접어 두고 펼치면 이유까지
function StoredMatchNote({ match }: { match: StoredMatch }) {
  const shown = match.score != null && match.score >= MATCH_SCORE_SHOWN;
  return <details className="mt-1.5 text-[11px] leading-5">
    <summary className="cursor-pointer text-primary">궁합 {match.score ?? "-"}{shown ? "" : " · 회원에게는 숫자 없이"}</summary>
    <p className="mt-1 font-semibold">{match.headline}</p>
    <ul className="mt-1 space-y-0.5 text-muted-foreground">{[...match.why, ...match.together].map(item => <li key={item}>· {item}</li>)}</ul>
  </details>;
}
const ANSWER: Record<string, string> = { positive: "알아가고 싶어요", negative: "넘길게요" };
type IntroTab = "all" | "reserved" | "published" | "mutual" | "closed" | "cancelled";

export function LiveIntroductions() {
  const role = useRole();
  const search = new URLSearchParams(useLocation().search);
  const focus = search.get("member");
  const focusIntro = search.get("intro");
  const intros = useLoad(() => call<IntroRow[]>("admin_list_introductions"), []);
  const [tab, setTab] = useState<IntroTab>(() => (["reserved", "published", "mutual", "closed", "cancelled"].includes(search.get("status") ?? "") ? search.get("status") as IntroTab : "all"));
  const [message, setMessage] = useState("");
  const { busy, run } = useBusy();
  const { ask, dialog } = useConfirm();
  useEffect(() => { if (focusIntro && intros.data) document.getElementById(`intro-${focusIntro}`)?.scrollIntoView({ block: "center" }); }, [focusIntro, intros.data]);
  const rows = (intros.data ?? []).filter(item => tab === "all" || item.status === tab);
  const cancel = (item: IntroRow) => run(`cancel-${item.id}`, async () => {
    const shown = item.status !== "reserved";
    const reason = await ask({ title: `${item.name_a ?? "회원"} · ${item.name_b ?? "회원"} 소개를 취소할까요?`, danger: true, confirm: "소개 취소",
      body: <>{shown ? <p className="font-semibold text-destructive">이미 두 분에게 공개된 소개예요{item.status === "mutual" ? "(서로 선택 · 교류 준비 중)" : ""}. 취소하면 두 분 모두에게 마무리 알림이 가요.</p> : <p>아직 공개 전({kstDateTime(item.reveal_at)})이라 두 분에게는 보이지 않아요.</p>}<p>{item.status === "mutual" || item.mutual ? "서로 선택한 두 분이라, 취소해도 다시 소개하지 않아요." : item.response_a === "negative" || item.response_b === "negative" ? "한 분이 이미 넘겼으니, 취소해도 다시 소개하지 않아요." : "운영 취소는 같은 두 분을 다시 소개하는 것을 막지 않아요(매칭 화면에 노랑 안내로 표시돼요)."}</p></>,
      reason: { label: "취소 사유(감사 기록에 남아요)", required: true } });
    if (reason === null) return;
    const { error } = await rpc("admin_cancel_introduction", { p_id: item.id, p_reason: reason });
    setMessage(error || "소개를 취소했어요."); await intros.reload();
  });
  return <>
    <Title lead="왼쪽에서 한 분을 고르면 오른쪽에 잘 맞는 분이 점수 순으로 나와요. 예약한 소개는 그날 12:00에 두 사람에게 동시에 공개되고, 다음 날 11:00에 응답이 마감돼요.">소개·매칭</Title>
    {canOperate(role) ? <MatchBoard focus={focus} onReserved={intros.reload} /> : <Notice text="소개 예약은 대표·운영 역할만 할 수 있어요. 아래 소개 기록은 볼 수 있어요." />}
    <h2 className="mb-3 mt-8 text-sm font-semibold">소개 기록</h2>
    <Tabs value={tab} onChange={setTab} options={([["all", "전체"], ["reserved", "정오 예약"], ["published", "공개"], ["mutual", "서로 선택"], ["closed", "종료"], ["cancelled", "취소"]] as [IntroTab, string][]).map(([key, label]) => [key, label, key === "all" ? intros.data?.length ?? 0 : (intros.data ?? []).filter(item => item.status === key).length])} />
    <Notice text={message || intros.error || ""} />
    <section className={`${box} mt-3 overflow-x-auto`} aria-label="소개 기록"><table className="w-full min-w-[880px] text-left text-xs"><thead className="border-b border-border text-muted-foreground"><tr><th className="p-3">공개</th><th className="p-3">두 사람</th><th className="p-3">상태</th><th className="p-3">응답 · 마감</th><th className="p-3">소개 이유 · 궁합</th><th className="p-3" /></tr></thead><tbody className="divide-y divide-border">{rows.map(item => <tr key={item.id} id={`intro-${item.id}`} className={focusIntro === item.id ? "bg-primary/5" : ""}><td className="whitespace-nowrap p-3">{kstDateTime(item.reveal_at)}</td><td className="p-3">{[item.name_a, item.name_b].map((name, index) => <Link key={index} to={`/admin/members?q=${encodeURIComponent(name ?? "")}`} className="mr-1 hover:underline">{name ?? "탈퇴 회원"}{index === 0 ? " ·" : ""}</Link>)}</td><td className="p-3">{INTRO_LABEL[item.status]}{item.end_reason ? ` · ${endLabel(item.end_reason)}` : ""}</td><td className="p-3 leading-5">{[[item.name_a, item.opened_a, item.response_a], [item.name_b, item.opened_b, item.response_b]].map(([name, opened, answer]) => `${name ?? "회원"}: ${answer ? ANSWER[answer as string] : opened ? "열람" : "미열람"}`).join(" / ")}{item.status === "published" && <span className={`block ${Date.parse(item.respond_by) < Date.now() ? "text-destructive" : "text-muted-foreground"}`}>마감 {kstDateTime(item.respond_by)}</span>}</td><td className="max-w-[260px] p-3"><p className="line-clamp-2 leading-5 text-muted-foreground" title={item.note}>{item.note}</p>{item.match && <StoredMatchNote match={item.match} />}</td><td className="p-3 text-right">{canOperate(role) && ["reserved", "published", "mutual"].includes(item.status) && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void cancel(item)}>취소</Button>}</td></tr>)}</tbody></table>{!rows.length && <p className="p-5 text-sm text-muted-foreground">{intros.loading ? "불러오고 있어요." : "해당하는 소개 기록이 없어요."}</p>}</section>
    {dialog}
  </>;
}

// ─────────────────────────────────────────────
// 신고·문의: 신고(자동 감지 포함) · 고객 문의 · 회원 요청 · 첫 마디
type Report = { id: string; source: string; type: string; description: string | null; urgent: boolean; status: string; createdAt: string; resolution: string | null; handledAt: string | null; reporter: Brief; target: Brief; introductionId: string | null; introductionStatus: string | null; introductionRevealAt: string | null; programId: string | null; programStatus: string | null };
type InquiryRow = { id: string; userId: string | null; type: string; name: string; email: string; body: string; status: keyof typeof INQUIRY_STATUS; answerBody: string | null; answeredAt: string | null; createdAt: string; member: Brief };
type RequestRow = { id: string; kind: keyof typeof REQUEST_LABELS; description: string | null; status: string; decision: string | null; urgent: boolean; createdAt: string; decidedAt: string | null; member: Brief };
const REPORT_STATUS: Record<string, string> = { new: "새 신고", reviewing: "검토 중", checking: "사실 확인", action: "조치", closed: "종결" };
// 신고된 교류 열람(admin_report_exchange): 읽기 전용. 사진은 letter-photo 함수가 5분짜리 주소로 열고, 열 때마다 감사 기록이 남는다.
type ReportExchange = { reportId: string; programId: string; status: string; plan: string | null; startOn: string | null; memberA: string | null; memberB: string | null; nameA: string | null; nameB: string | null; entries: { day: number; kind: string; author: string; body: string | null; payload: Record<string, unknown> | null; at: string }[]; photos: string[]; reason: string };
const ENTRY_KIND: Record<string, string> = { letter: "편지", reply: "답장", scene: "첫 장면 답", final: "첫 장면 선택", piece: "첫 장면 이야기", comment: "한마디", "piece-comment": "이야기에 남긴 한마디" };
const PAYLOAD_LABEL: Record<string, string> = { activity: "분위기", place: "곳", flow: "머무는 방식", rest: "쉬어 갈 곳", topic: "나누고 싶은 이야기", reaction: "한마디", about: "나를 소개하는 답" };
const payloadText = (payload: Record<string, unknown> | null) => Object.entries(payload ?? {}).filter(([key]) => key !== "photo").map(([key, value]) => `${PAYLOAD_LABEL[key] ?? key}: ${String(value).replace(/^custom:/, "직접 씀 · ")}`).join(" · ");
function ReportLetterPhoto({ path, reason }: { path: string; reason: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  return <div className="w-28 space-y-1 text-[11px]">{url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="편지 사진" draggable={false} className="aspect-[4/5] w-full rounded-md border border-border object-cover" /></a> : <Button size="sm" variant="outline" className="h-7 w-full text-[11px]" disabled={url === null} onClick={() => void adminLetterPhotoUrl(path, reason).then(next => setUrl(next))}>{url === null ? "열 수 없어요" : "사진 열기(기록)"}</Button>}</div>;
}
function ReportExchangeView({ data, onClose }: { data: ReportExchange; onClose: () => void }) {
  const who = (author: string) => author === data.memberA ? data.nameA ?? "A" : author === data.memberB ? data.nameB ?? "B" : "탈퇴 회원";
  return <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
    <p className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">교류 내용 · {data.plan === "B" ? "첫 장면 만들기" : "편지 나누기"} · {PROGRAM_LABEL[data.status] ?? data.status}{data.startOn ? ` · 시작 ${kstDay(`${data.startOn}T09:00:00+09:00`)}` : ""}</span><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>닫기</Button></p>
    <p className="text-muted-foreground">열람 이유 · {data.reason} · 감사 기록에 남았어요. 확인에 필요한 범위만 보고, 옮겨 적거나 저장하지 마세요.</p>
    {data.entries.length ? <ol className="divide-y divide-border">{data.entries.map((entry, index) => <li key={index} className="space-y-1 py-2"><p className="font-semibold">DAY0{entry.day} · {ENTRY_KIND[entry.kind] ?? entry.kind} · {who(entry.author)}<span className="ml-2 font-normal text-muted-foreground">{kstDateTime(entry.at)}</span></p>{entry.body && <p className="whitespace-pre-wrap leading-6">{entry.body}</p>}{payloadText(entry.payload) && <p className="leading-6 text-muted-foreground">{payloadText(entry.payload)}</p>}{typeof entry.payload?.photo === "string" && <ReportLetterPhoto path={entry.payload.photo} reason={data.reason} />}</li>)}</ol> : <p className="text-muted-foreground">남아 있는 교류 글이 없어요.</p>}
  </div>;
}
const REQUEST_STATUS: Record<string, string> = { requested: "접수", protection: "보호 조치", checking: "확인 중", decided: "처리 완료", reconsidering: "재검토" };
type SafetyTab = "reports" | "inquiries" | "requests" | "greetings";

export function LiveSafety() {
  const role = useRole();
  const asked = new URLSearchParams(useLocation().search).get("tab") as SafetyTab | null;
  const tabs = (role === "finance" ? [["requests", "회원 요청"]] : [["reports", "신고"], ["inquiries", "고객 문의"], ["requests", "회원 요청"], ["greetings", "첫 마디 · 홈"]]) as [SafetyTab, string][];
  const [tab, setTab] = useState<SafetyTab>(() => tabs.some(([key]) => key === asked) ? asked! : tabs[0][0]);
  return <>
    <Title lead="안전 신고를 가장 먼저 봐요. 문의 본문과 이메일은 감사 기록에 남기지 않아요. 문의 답변을 기록하면 문의한 분의 이메일로 답변이 가고, 접수 번호로도 확인할 수 있어요.">신고·문의</Title>
    <Tabs value={tab} onChange={setTab} options={tabs} />
    {tab === "reports" ? <ReportsPanel role={role} /> : tab === "inquiries" ? <InquiriesPanel /> : tab === "requests" ? <RequestsPanel /> : <GreetingsPanel role={role} />}
  </>;
}
// 홈 공개를 신청한 첫 마디: 문장만 보고 확인한다(홈에는 이름·사진 없이, 확인된 문장이 12개 이상일 때만 나간다).
type GreetingRow = { memberId: string; body: string; homeStatus: string; reason: string | null; updatedAt: string; name: string | null; cohort: number | null };
function GreetingsPanel({ role }: { role: Role }) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const list = useLoad(() => call<GreetingRow[]>("admin_list_greetings", { p_status: status }), [status]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const { busy, run } = useBusy();
  const review = (member: string, next: "approved" | "rejected") => run(member, async () => { const { error } = await rpc("admin_review_greeting", { p_member: member, p_status: next, p_reason: reasons[member] || null }); setMessage(error || (next === "approved" ? "홈 공개를 확인했어요." : "홈에 싣지 않기로 했어요. 회원에게 이유가 보여요.")); await list.reload(); });
  return <div className="space-y-3">
    <p className="text-xs leading-6 text-muted-foreground">연락처·링크는 저장 단계에서 이미 걸러져요. 특정인을 알아볼 수 있는 내용, 외모·조건 평가, 광고성 문구는 싣지 않아요. 확인된 문장이 12개 이상일 때부터 홈에 보여요.</p>
    <Tabs value={status} onChange={setStatus} options={[["pending", "확인 대기"], ["approved", "공개 중"], ["rejected", "싣지 않음"]]} />
    <Notice text={message || list.error || ""} />
    {(list.data ?? []).map(row => <article key={row.memberId} className={`${box} p-4 text-sm`}><p className="text-base font-semibold leading-7">“{row.body}”</p><p className="mt-1 text-xs text-muted-foreground">{row.name ?? "이름 없음"}{row.cohort != null ? ` · ${cohortName(row.cohort)}` : ""} · {kstDateTime(row.updatedAt)}{row.reason ? ` · ${row.reason}` : ""}</p>{status === "pending" && canOperate(role) && <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" disabled={!!busy} onClick={() => void review(row.memberId, "approved")}>홈 공개 확인</Button><Input aria-label="싣지 않는 이유" value={reasons[row.memberId] ?? ""} onChange={event => setReasons(current => ({ ...current, [row.memberId]: event.target.value }))} placeholder="싣지 않는 이유(회원에게 보여요)" className="h-8 max-w-xs text-xs" /><Button size="sm" variant="outline" disabled={!reasons[row.memberId]?.trim() || !!busy} onClick={() => void review(row.memberId, "rejected")}>싣지 않기</Button></div>}</article>)}
    {!list.loading && !list.data?.length && <p className="text-sm text-muted-foreground">해당하는 첫 마디가 없어요.</p>}
  </div>;
}

function ReportsPanel({ role }: { role: Role }) {
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open");
  const list = useLoad(() => call<Report[]>("admin_list_reports"), []);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [exchanges, setExchanges] = useState<Record<string, ReportExchange>>({});
  const { busy, run } = useBusy();
  const { ask, dialog } = useConfirm();
  const rows = (list.data ?? []).filter(report => filter === "all" || (filter === "closed" ? report.status === "closed" : report.status !== "closed"));
  // 신고된 교류 열람: 이유를 받아 서버가 감사 기록을 남긴 뒤 글을 돌려준다(읽기 전용).
  const openExchange = (report: Report) => run(`${report.id}-exchange`, async () => {
    const reason = await ask({ title: "신고된 교류 내용을 열람할까요?", confirm: "열람",
      body: <><p>신고 확인에 필요한 범위에서만 열람해요. 열람 이유와 시각이 감사 기록에 남아요.</p><p>편지 사진은 하나씩 열 때마다 따로 기록돼요.</p></>,
      reason: { label: "열람 이유(감사 기록에 남아요)", required: true, placeholder: "예: 신고된 편지 내용의 사실 확인" } });
    if (reason === null) return;
    const { data, error } = await rpc<Omit<ReportExchange, "reason">>("admin_report_exchange", { p_report: report.id, p_reason: reason });
    if (error || !data) { setMessage(error || "교류 내용을 불러오지 못했어요."); return; }
    setExchanges(current => ({ ...current, [report.id]: { ...data, reason } }));
  });
  const update = (report: Report, status: string) => run(`${report.id}-${status}`, async () => {
    if (status === "closed" && await ask({ title: "신고를 종결할까요?", body: <p>종결한 신고는 다시 바꿀 수 없어요. 처리 메모가 함께 남아요.</p>, confirm: "종결" }) === null) return;
    const { error } = await rpc("admin_update_report", { p_id: report.id, p_status: status, p_resolution: notes[report.id]?.trim() || null });
    setMessage(error || "기록했어요."); if (!error) setNotes(current => ({ ...current, [report.id]: "" }));
    await list.reload();
  });
  // 신고 대상을 바로 이용 정지로: 정지(진행 중인 소개 종료·본인 알림) 뒤 신고를 ‘조치’로 기록한다.
  const suspend = (report: Report) => run(`${report.id}-suspend`, async () => {
    const target = report.target!;
    const reason = await ask({ title: `${target.name ?? target.email}님을 이용 정지할까요?`, danger: true, confirm: "이용 정지",
      body: <><p>진행 중인 소개·교류는 바로 끝나고, 회원에게 정지 안내가 가요. 회원은 문의·요청에서 재검토를 요청할 수 있어요.</p><p>이 신고는 ‘조치’로 기록돼요.</p></>,
      reason: { label: "정지 사유(회원에게 보여요)", required: true, placeholder: "예: 연락처를 반복해서 요구했어요." } });
    if (reason === null) return;
    const { error } = await rpc("admin_set_member_state", { p_member: target.id, p_state: "suspend", p_reason: reason });
    if (error) { setMessage(error); return; }
    const recorded = await rpc("admin_update_report", { p_id: report.id, p_status: "action", p_resolution: notes[report.id]?.trim() || `이용 정지 · ${reason}` });
    setMessage(recorded.error ? `정지는 했지만 신고 기록에 실패했어요 · ${recorded.error}` : "이용 정지하고 신고를 ‘조치’로 기록했어요.");
    await list.reload();
  });
  return <div className="space-y-3">
    <Tabs value={filter} onChange={setFilter} options={[["open", "처리 중", (list.data ?? []).filter(item => item.status !== "closed").length], ["closed", "종결", (list.data ?? []).filter(item => item.status === "closed").length], ["all", "전체"]]} />
    <Notice text={message || list.error || ""} />
    {rows.map(report => { const memo = notes[report.id] ?? ""; const canClose = !!memo.trim() || !!report.resolution?.trim(); return <article key={report.id} className={`${box} space-y-2 p-4 text-sm ${report.urgent ? "border-destructive/40" : ""}`}>
      <p className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{report.urgent && <span className="mr-2 text-destructive">긴급</span>}{report.type}<span className="ml-2 text-xs font-normal text-muted-foreground">{report.source === "auto" ? "자동 감지" : "회원 신고"}</span></span><span className="text-xs text-muted-foreground">{REPORT_STATUS[report.status]} · {kstDateTime(report.createdAt)}{report.handledAt ? ` · 처리 ${kstDateTime(report.handledAt)}` : ""}</span></p>
      {report.source !== "auto" && <MemberBrief label="신고한 분" member={report.reporter} />}
      <MemberBrief label="대상" member={report.target} />
      {(report.introductionId || report.programId) && <p className="flex flex-wrap gap-3 text-xs">{report.introductionId && <Link to={`/admin/introductions?intro=${report.introductionId}`} className="text-primary hover:underline">이어진 소개 · {INTRO_LABEL[report.introductionStatus ?? ""] ?? report.introductionStatus}{report.introductionRevealAt ? ` · ${kstDay(report.introductionRevealAt)}` : ""} →</Link>}{report.programId && <Link to={`/admin/programs?id=${report.programId}`} className="text-primary hover:underline">이어진 교류 · {PROGRAM_LABEL[report.programStatus ?? ""] ?? report.programStatus} →</Link>}</p>}
      {report.description && <p className="whitespace-pre-wrap text-xs leading-6">{report.description}</p>}
      {report.resolution && <p className="text-xs text-muted-foreground">처리 메모 · {report.resolution}</p>}
      {report.programId && !exchanges[report.id] && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!!busy} onClick={() => void openExchange(report)}>교류 내용 열람</Button>}
      {exchanges[report.id] && <ReportExchangeView data={exchanges[report.id]} onClose={() => setExchanges(current => { const next = { ...current }; delete next[report.id]; return next; })} />}
      {report.status !== "closed" && <div className="flex flex-wrap items-center gap-2 pt-1"><Input aria-label="처리 메모" value={memo} onChange={event => setNotes(current => ({ ...current, [report.id]: event.target.value }))} placeholder={report.resolution ? "메모 더하기(비우면 이전 메모 유지)" : "처리 메모(종결할 때 필요)"} className="h-8 max-w-xs text-xs" />{["reviewing", "checking", "action", "closed"].map(status => <Button key={status} size="sm" variant="outline" className="h-8 text-xs" disabled={!!busy || (status === report.status && !memo.trim()) || (status === "closed" && !canClose)} title={status === "closed" && !canClose ? "처리 메모를 먼저 적어 주세요" : undefined} onClick={() => void update(report, status)}>{REPORT_STATUS[status]}</Button>)}{canOperate(role) && report.target?.status === "active" && <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" disabled={!!busy} onClick={() => void suspend(report)}>이용 정지로</Button>}</div>}
    </article>; })}
    {!list.loading && !rows.length && <p className="text-sm text-muted-foreground">해당하는 신고가 없어요.</p>}
    {dialog}
  </div>;
}

function InquiriesPanel() {
  const [filter, setFilter] = useState<"open" | keyof typeof INQUIRY_STATUS | "all">("open");
  const list = useLoad(() => call<InquiryRow[]>("admin_list_inquiries"), []);
  // 소개를 기다리는 회원이 남긴 문의라면 기다린 날을 옆에 보여 준다(회원 화면에는 숫자를 보여 주지 않는다)
  const ready = useLoad(() => call<ReadyMember[]>("admin_ready_members").catch(() => [] as ReadyMember[]), []);
  const waitingOf = (userId: string | null) => userId ? ready.data?.find(member => member.member_id === userId)?.waiting_since ?? null : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [message, setMessage] = useState("");
  const { busy, run } = useBusy();
  const all = list.data ?? [];
  const rows = all.filter(entry => filter === "all" || (filter === "open" ? entry.status !== "answered" : entry.status === filter));
  const item = all.find(entry => entry.id === selected);
  const save = (withAnswer: boolean) => run(withAnswer ? "answer" : "check", async () => { const { error } = await rpc("admin_inquiry_status", { p_id: selected, p_answer: withAnswer ? answer : null }); setMessage(error || (withAnswer ? "답변을 기록했어요. 문의한 분의 이메일로 답변이 가요." : "확인 중으로 바꿨어요.")); await list.reload(); });
  const count = (key: string) => all.filter(entry => key === "open" ? entry.status !== "answered" : entry.status === key).length;
  return <>
    <Tabs value={filter} onChange={setFilter} options={[["open", "답변 전", count("open")], ["received", INQUIRY_STATUS.received, count("received")], ["checking", INQUIRY_STATUS.checking, count("checking")], ["answered", INQUIRY_STATUS.answered, count("answered")], ["all", "전체", all.length]]} />
    <div className="grid gap-4 lg:grid-cols-2"><div className={`${box} divide-y divide-border self-start`}>{rows.map(entry => <button key={entry.id} type="button" onClick={() => { setSelected(entry.id); setAnswer(entry.answerBody || ""); setMessage(""); revealOnNarrow("inquiry-detail"); }} className={`flex w-full flex-wrap justify-between gap-2 px-4 py-3 text-left text-sm ${entry.id === selected ? "bg-primary/5" : "hover:bg-secondary"}`}><span>{entry.id} · {entry.type}{entry.member?.name ? ` · ${entry.member.name}` : entry.name ? ` · ${entry.name}` : ""}<WaitBadge since={waitingOf(entry.userId)} always /></span><span className="text-xs text-muted-foreground">{INQUIRY_STATUS[entry.status]} · {kstDateTime(entry.createdAt)}</span></button>)}{!list.loading && !rows.length && <p className="p-5 text-sm text-muted-foreground">{list.error || "해당하는 문의가 없어요."}</p>}</div>
    <div id="inquiry-detail" className="scroll-mt-24">{item ? <div className={`${box} space-y-3 p-4 text-sm`}><p className="text-xs text-muted-foreground">{item.id} · {item.email}{item.name ? ` · 부르실 이름 ${item.name}` : ""}</p>
      {item.userId ? <><MemberBrief label="회원" member={item.member} />{ready.data?.some(member => member.member_id === item.userId) ? <Link to={`/admin/introductions?member=${item.userId}`} className="inline-flex items-center gap-1.5 rounded-full bg-primary/8 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/12">이 회원 소개·매칭에서 보기 →</Link> : <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">지금은 소개 가능 목록에 없는 회원이에요(쉬는 중이거나 소개·교류 중).<Link to={`/admin/members?q=${encodeURIComponent(item.member?.email ?? item.email)}`} className="font-semibold text-primary hover:underline">회원 화면에서 보기 →</Link></p>}</> : <p className="text-xs text-muted-foreground">로그인하지 않고 남긴 문의예요.</p>}
      <p className="whitespace-pre-wrap leading-7">{item.body}</p>
      {item.answeredAt && <p className="text-xs text-muted-foreground">답변 {kstDateTime(item.answeredAt)}</p>}
      <Textarea aria-label="답변" value={answer} maxLength={1500} onChange={event => setAnswer(event.target.value)} className="min-h-28" placeholder="회원에게 보일 답변(이메일로도 가요)" />
      <div className="flex gap-2">{item.status === "received" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void save(false)}>확인 중으로</Button>}<Button size="sm" disabled={!!busy || answer.trim().length < 5 || answer.trim() === (item.answerBody ?? "").trim()} onClick={() => void save(true)}>{busy === "answer" ? "보내고 있어요" : item.answerBody ? "답변 수정해 다시 보내기" : "답변 기록·메일 보내기"}</Button></div><Notice text={message} /></div> : <p className={`${box} p-5 text-sm text-muted-foreground`}>문의를 골라 주세요.</p>}</div></div>
  </>;
}

function RequestsPanel() {
  const [filter, setFilter] = useState<"open" | "decided" | "all">("open");
  const list = useLoad(() => call<RequestRow[]>("admin_list_requests"), []);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const { busy, run } = useBusy();
  const rows = (list.data ?? []).filter(request => filter === "all" || (filter === "decided" ? request.status === "decided" : request.status !== "decided"));
  const decide = (request: RequestRow, status: string) => run(`${request.id}-${status}`, async () => { const { error } = await rpc("admin_decide_request", { p_id: request.id, p_status: status, p_decision: decisions[request.id]?.trim() || null }); setMessage(error || "기록했어요."); if (!error) setDecisions(current => ({ ...current, [request.id]: "" })); await list.reload(); });
  return <div className="space-y-3">
    <Tabs value={filter} onChange={setFilter} options={[["open", "처리 중", (list.data ?? []).filter(item => item.status !== "decided").length], ["decided", "처리 완료", (list.data ?? []).filter(item => item.status === "decided").length], ["all", "전체"]]} />
    <Notice text={message || list.error || ""} />
    {rows.map(request => { const text = decisions[request.id] ?? ""; const hasAnswer = !!text.trim() || !!request.decision?.trim(); return <article key={request.id} className={`${box} space-y-2 p-4 text-sm ${request.urgent ? "border-destructive/40" : ""}`}>
      <p className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{request.urgent && <span className="mr-2 text-destructive">긴급</span>}{REQUEST_LABELS[request.kind] ?? request.kind}</span><span className="text-xs text-muted-foreground">{REQUEST_STATUS[request.status]} · {kstDateTime(request.createdAt)}{request.decidedAt ? ` · 처리 ${kstDateTime(request.decidedAt)}` : ""}</span></p>
      <MemberBrief label="요청한 회원" member={request.member} />
      {request.description && <p className="whitespace-pre-wrap text-xs leading-6">{request.description}</p>}
      {request.decision && <p className="text-xs text-muted-foreground">회원에게 보인 답변 · {request.decision}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1"><Input aria-label="회원에게 보일 답변" value={text} onChange={event => setDecisions(current => ({ ...current, [request.id]: event.target.value }))} placeholder={request.decision ? "새 답변(비우면 이전 답변 유지)" : "회원에게 보일 답변(처리 완료에 필요)"} className="h-8 max-w-sm text-xs" />{(request.status === "decided" ? ["reconsidering"] : ["checking", "protection", "decided", "reconsidering"]).map(status => <Button key={status} size="sm" variant="outline" className="h-8 text-xs" disabled={!!busy || (status === request.status && !text.trim()) || (status === "decided" && !hasAnswer)} title={status === "decided" && !hasAnswer ? "회원에게 보일 답변을 먼저 적어 주세요" : undefined} onClick={() => void decide(request, status)}>{REQUEST_STATUS[status]}</Button>)}</div>
    </article>; })}
    {!list.loading && !rows.length && <p className="text-sm text-muted-foreground">해당하는 회원 요청이 없어요.</p>}
  </div>;
}

// ─────────────────────────────────────────────
// 교류·약속: 진행 단계만 본다(글 원문은 보지 않는다) · 운영 종료
type ProgramRow = { id: string; introductionId: string; status: string; endReason: string | null; createdAt: string; closedAt: string | null; memberA: string | null; memberB: string | null; emailA: string | null; emailB: string | null; nameA: string | null; nameB: string | null; planA: string | null; planB: string | null; startOn: string | null; agreeBy: string; confirmed: number; entriesA: number; entriesB: number; extrasA?: number; extrasB?: number; meetingAnswers: number; meetingBy: string | null; arrangeBy: string | null; meetingOn: string | null; meetingTime: string | null; contacts: number };
const PLAN_LABEL: Record<string, string> = { A: "A 편지 나누기", B: "B 첫 장면 만들기" };
const plan = (value: string | null) => value ? PLAN_LABEL[value] ?? value : "미선택";
// 기한을 넘긴 단계(예약 작업이 아직 닫지 않았을 때 눈에 띄게)
const overdue = (row: ProgramRow) => { const past = (at: string | null) => !!at && Date.parse(at) < Date.now(); return (row.status === "choosing" && past(row.agreeBy)) || (row.status === "deciding" && past(row.meetingBy)) || (row.status === "arranging" && !row.meetingOn && past(row.arrangeBy)); };

export function LivePrograms() {
  const role = useRole();
  const focus = new URLSearchParams(useLocation().search).get("id");
  const list = useLoad(() => call<ProgramRow[]>("admin_list_programs"), []);
  const [message, setMessage] = useState("");
  const { busy, run } = useBusy();
  const { ask, dialog } = useConfirm();
  useEffect(() => { if (focus && list.data) document.getElementById(`program-${focus}`)?.scrollIntoView({ block: "center" }); }, [focus, list.data]);
  const close = (row: ProgramRow) => run(row.id, async () => {
    const reason = await ask({ title: `${row.nameA ?? "회원"} · ${row.nameB ?? "회원"} 교류를 마무리할까요?`, danger: true, confirm: "교류 마무리", body: <p>두 분에게 마무리 안내가 가고, 소개도 함께 끝나요. 되돌릴 수 없어요.</p>, reason: { label: "마무리 사유(감사 기록에만 남아요)", required: true } });
    if (reason === null) return;
    const { error } = await rpc("admin_close_program", { p_id: row.id, p_reason: reason });
    setMessage(error || "마무리했어요. 감사 기록에 남았어요.");
    await list.reload();
  });
  const person = (name: string | null, email: string | null) => email ? <Link to={`/admin/members?q=${encodeURIComponent(email)}`} className="hover:underline">{name ?? "회원"}</Link> : <span>{name ?? "탈퇴 회원"}</span>;
  return <>
    <Title lead="서로 선택한 두 분의 진행 단계예요. 편지·첫 장면 원문은 보지 않고, 신고가 확인된 경우에만 따로 확인해요. 기한을 넘긴 단계는 빨갛게 보여요.">교류·약속</Title>
    <Notice text={message || list.error || ""} />
    <div className="mt-3 space-y-3">{(list.data ?? []).map(row => { const late = overdue(row); return <article key={row.id} id={`program-${row.id}`} className={`${box} p-4 text-sm ${late ? "border-destructive/40" : ""} ${focus === row.id ? "ring-2 ring-primary/30" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><p className="font-semibold">{person(row.nameA, row.emailA)} · {person(row.nameB, row.emailB)}</p><span className="flex flex-wrap gap-1.5">{late && <Pill tone="danger">기한 지남</Pill>}<span className={`rounded-full px-2.5 py-1 text-[11px] ${row.status === "closed" ? "bg-muted" : "bg-lilac"}`}>{PROGRAM_LABEL[row.status] ?? row.status}{row.endReason ? ` · ${PROGRAM_END[row.endReason] ?? row.endReason}` : ""}</span></span></div>
      <p className={`mt-2 text-xs leading-6 ${late ? "text-destructive" : "text-muted-foreground"}`}>
        {row.status === "choosing" ? `방식 ${plan(row.planA)} / ${plan(row.planB)} · 확인 ${row.confirmed}/2 · 기한 ${kstDateTime(row.agreeBy)}` : `방식 ${plan(row.planA)} · 시작 ${row.startOn ? kstDay(`${row.startOn}T09:00:00+09:00`) : "-"} · 보낸 글 ${row.entriesA}/${row.entriesB}${(row.extrasA ?? 0) + (row.extrasB ?? 0) > 0 ? ` · 답장·한마디 ${row.extrasA ?? 0}/${row.extrasB ?? 0}` : ""}`}
        {row.status === "deciding" && ` · 만남 답 ${row.meetingAnswers}/2 · 기한 ${kstDateTime(row.meetingBy)}`}
        {row.status === "arranging" && (row.meetingOn ? ` · 약속 ${kstDay(`${row.meetingOn}T12:00:00+09:00`)} ${row.meetingTime ?? ""} · 연락처 동의 ${row.contacts}/2` : ` · 약속 기한 ${kstDateTime(row.arrangeBy)}`)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs"><Link to={`/admin/introductions?intro=${row.introductionId}`} className="text-primary hover:underline">소개 기록 보기 →</Link>{canOperate(role) && row.status !== "closed" && <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={!!busy} onClick={() => void close(row)}>교류 마무리</Button>}</div>
    </article>; })}{list.data && !list.data.length && <p className="text-sm text-muted-foreground">진행 중인 교류가 없어요.</p>}</div>
    {dialog}
  </>;
}

// ─────────────────────────────────────────────
// 회원: 찾기 · 상태(쉬기·이용 정지) · 연락처(운영진만) · 무제한 회원(대표만 정함 · 결제 없이 · 소개 횟수에 넣지 않음)
type MemberRow = { id: string; email: string; status: "active" | "withdrawal_requested" | "suspended"; perk?: "unlimited" | null; withdrawalRequestedAt?: string | null; deletionDueAt?: string | null; pausedAt: string | null; pausedBy: "member" | "auto" | "operator" | null; resumedAt: string | null; suspendedReason: string | null; createdAt: string; name: string | null; phone: string | null; gender: string | null; age: number | null; area: string | null; application: string | null; cohort: number | null; channels: { kakao: boolean; sms: boolean; email: boolean }; introductions: number; reports: number };
export function LiveMembers() {
  const role = useRole();
  const initial = new URLSearchParams(useLocation().search).get("q") ?? "";
  const [query, setQuery] = useState(initial);
  const [search, setSearch] = useState(initial);
  useEffect(() => { setQuery(initial); setSearch(initial); }, [initial]);
  const list = useLoad(() => call<MemberRow[]>("admin_list_members", { p_query: search || null }), [search]);
  const [message, setMessage] = useState("");
  const { busy, run } = useBusy();
  const { ask, dialog } = useConfirm();
  const who = (member: MemberRow) => member.name ?? member.email;
  const change = (member: MemberRow, state: "pause" | "resume" | "resume_override" | "suspend" | "unsuspend") => run(`${member.id}-${state}`, async () => {
    const reason = state === "suspend" ? await ask({ title: `${who(member)}님을 이용 정지할까요?`, danger: true, confirm: "이용 정지", body: <p>진행 중인 소개·교류는 바로 끝나고, 회원에게 정지 안내가 가요.</p>, reason: { label: "정지 사유(회원에게 보여요)", required: true } })
      : state === "resume_override" ? await ask({ title: `${who(member)}님이 직접 건 쉬기를 풀까요?`, danger: true, confirm: "회원 쉬기 풀기", body: <><p>회원이 스스로 새 소개를 쉬기로 한 상태예요. 풀면 다음 정오 소개 후보에 다시 들어가고, 회원에게 알림이 가요.</p><p>회원이 다시 받겠다고 직접 알려 온 경우에만 풀어 주세요.</p></>, reason: { label: "푸는 이유(감사 기록에 남아요)", required: true, placeholder: "예: 문의로 다시 받고 싶다고 했어요." } })
      : state === "pause" ? await ask({ title: `${who(member)}님 새 소개를 운영진이 멈출까요?`, confirm: "멈추기", body: <p>진행 중인 소개는 그대로예요. 회원에게 알림이 가고, 회원은 스스로 풀 수 없어요.</p>, reason: { label: "멈추는 이유(감사 기록에만 남아요)" } })
      : state === "unsuspend" ? await ask({ title: `${who(member)}님 이용 정지를 풀까요?`, confirm: "정지 풀기", body: <p>회원에게 다시 이용할 수 있다는 알림이 가요.</p> })
      : "";
    if (reason === null) return;
    const { error } = await rpc("admin_set_member_state", { p_member: member.id, p_state: state, p_reason: reason || null });
    setMessage(error || "바꿨어요. 감사 기록에 남았어요.");
    await list.reload();
  });
  // 무제한 회원(대표만): 결제 없이 이용하고 소개 횟수에 넣지 않아요. 차단·신고·재소개 금지·정지·자동 쉬기는 그대로예요. 회원·상대에게 알리지 않아요.
  const setPerk = (member: MemberRow, on: boolean) => run(`${member.id}-perk`, async () => {
    const reason = on
      ? await ask({ title: `${who(member)}님을 무제한 회원으로 바꿀까요?`, confirm: "무제한 회원으로", body: <><p>결제 없이 이용하고, 소개 횟수에 넣지 않아요. 운영진 권한은 생기지 않는 보통 회원이에요.</p><p>차단·신고·재소개 금지·이용 정지와 무응답·교류 뒤 자동 쉬기는 그대로예요. 회원과 상대에게 알림은 가지 않아요.</p></>, reason: { label: "바꾸는 이유(감사 기록에 남아요)", required: true, placeholder: "예: 대표 본인 회원 계정이에요." } })
      : await ask({ title: `${who(member)}님 무제한 회원을 풀까요?`, danger: true, confirm: "무제한 풀기", body: <p>다음 결제부터 보통 회원과 같아져요. 지난 소개 기록은 그대로예요. 회원에게 알림은 가지 않아요.</p>, reason: { label: "푸는 이유(감사 기록에 남아요)", required: true } });
    if (reason === null) return;
    const { error } = await rpc("admin_set_member_perk", { p_member: member.id, p_perk: on ? "unlimited" : null, p_reason: reason });
    setMessage(error || (on ? "무제한 회원으로 바꿨어요. 감사 기록에 남았어요." : "무제한 회원을 풀었어요. 감사 기록에 남았어요."));
    await list.reload();
  });
  // 탈퇴 요청 취소(삭제 예정 시각 전) · 철회한 신청서 다시 열기: 둘 다 회원이 문의로 직접 요청한 경우에만.
  const restore = (member: MemberRow, kind: "withdrawal" | "reopen") => run(`${member.id}-${kind}`, async () => {
    const reason = kind === "withdrawal"
      ? await ask({ title: `${who(member)}님 탈퇴 요청을 취소할까요?`, confirm: "탈퇴 요청 취소", body: <><p>이용 중으로 돌아가고 삭제 예약({member.deletionDueAt ? kstDateTime(member.deletionDueAt) : "-"})이 지워져요. 회원에게 알림이 가요.</p><p>탈퇴 요청 때 끝난 소개와 교류는 다시 열리지 않아요. 회원이 문의로 직접 요청한 경우에만 취소해 주세요.</p></>, reason: { label: "취소하는 이유(감사 기록에 남아요)", required: true, placeholder: "예: 문의로 탈퇴를 취소하고 싶다고 했어요." } })
      : await ask({ title: `${who(member)}님 신청서를 다시 열까요?`, confirm: "다시 열기", body: <p>작성 중으로 바뀌어 회원이 이어서 고치고 다시 제출할 수 있어요. 회원에게 알림이 가요.</p>, reason: { label: "다시 여는 이유(감사 기록에 남아요)", required: true, placeholder: "예: 문의로 다시 신청하고 싶다고 했어요." } });
    if (reason === null) return;
    const { error } = await rpc(kind === "withdrawal" ? "admin_cancel_withdrawal" : "admin_reopen_application", { p_member: member.id, p_reason: reason });
    setMessage(error || (kind === "withdrawal" ? "탈퇴 요청을 취소했어요. 회원에게 알렸어요." : "신청서를 다시 열었어요. 회원에게 알렸어요."));
    await list.reload();
  });
  const submit = (event: FormEvent) => { event.preventDefault(); setSearch(query.trim()); };
  return <>
    <Title lead="이름·이메일·휴대폰 번호로 찾아요. 휴대폰 번호는 운영진만 보고, 연락이 꼭 필요할 때만 써 주세요.">회원</Title>
    <form onSubmit={submit} className="mb-5 flex flex-wrap gap-2"><Input aria-label="회원 찾기" value={query} onChange={event => setQuery(event.target.value)} placeholder="이름 · 이메일 · 번호 일부" className="max-w-xs" /><Button type="submit">찾기</Button>{search && <Button type="button" variant="ghost" onClick={() => { setQuery(""); setSearch(""); }}>모두 보기</Button>}</form>
    <Notice text={message || list.error || ""} />
    {list.loading && !list.data && <p className="text-sm text-muted-foreground">불러오고 있어요.</p>}
    <div className="mt-3 space-y-3">{(list.data ?? []).map(member => <article key={member.id} className={`${box} p-4 text-sm`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="font-semibold">{member.name ?? "이름 없음"} <span className="font-normal text-muted-foreground">· {[member.gender, member.age !== null ? `만 ${member.age}세` : null, member.area].filter(Boolean).join(" · ")}</span></p><p className="mt-1 text-xs text-muted-foreground">{member.email} · {member.phone ?? "번호 없음"} · 가입 {kstDay(member.createdAt)}</p></div>
        <p className="flex flex-wrap gap-1.5 text-[11px]"><span className={`rounded-full px-2.5 py-1 ${member.status === "suspended" ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>{MEMBER_STATE[member.status]}{member.status === "withdrawal_requested" && member.deletionDueAt ? ` · ${kstDateTime(member.deletionDueAt)} 삭제 예정` : ""}</span>{member.perk === "unlimited" && <span className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary" title="결제 없이 이용 · 소개 횟수에 넣지 않음(대표가 정함)">무제한 회원</span>}{member.pausedAt && <span className="rounded-full bg-lilac px-2.5 py-1">{PAUSED_BY[member.pausedBy ?? "member"]} · {kstDay(member.pausedAt)}</span>}<span className="rounded-full bg-muted px-2.5 py-1">{member.application ? STATUS_LABEL[member.application] ?? member.application : "신청 전"}{member.cohort != null ? ` · ${cohortName(member.cohort)}` : ""}</span></p>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">알림 {[member.channels.kakao && "카카오톡", member.channels.sms && "문자", member.channels.email && "메일"].filter(Boolean).join("·") || "미선택"} · 소개 {member.introductions}회 · 받은 신고 {member.reports}건{member.resumedAt ? ` · 다시 받기 ${kstDay(member.resumedAt)}` : ""}{member.suspendedReason ? ` · 정지 사유: ${member.suspendedReason}` : ""}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {member.application && member.application !== "draft" && <Link to={`/admin/applicants?member=${member.id}`} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-secondary">신청서</Link>}
        {member.application === "approved" && member.status === "active" && !member.pausedAt && <Link to={`/admin/introductions?member=${member.id}`} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-secondary">소개·매칭에서 보기</Link>}
        {canOperate(role) && member.status === "active" && (member.pausedAt
          ? member.pausedBy === "member" ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void change(member, "resume_override")}>회원 쉬기 풀기…</Button> : <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void change(member, "resume")}>다시 받기로</Button>
          : <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void change(member, "pause")}>운영진 쉬기</Button>)}
        {canOperate(role) && member.status === "active" && <Button size="sm" variant="ghost" className="text-destructive" disabled={!!busy} onClick={() => void change(member, "suspend")}>이용 정지…</Button>}
        {canOperate(role) && member.status === "suspended" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void change(member, "unsuspend")}>정지 풀기</Button>}
        {canOperate(role) && member.status === "withdrawal_requested" && (!member.deletionDueAt || Date.parse(member.deletionDueAt) > Date.now()) && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void restore(member, "withdrawal")}>탈퇴 요청 취소…</Button>}
        {canOperate(role) && member.status === "active" && member.application === "withdrawn" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void restore(member, "reopen")}>신청서 다시 열기…</Button>}
        {role === "owner" && (member.perk === "unlimited"
          ? <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void setPerk(member, false)}>무제한 풀기…</Button>
          : member.status !== "withdrawal_requested" && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void setPerk(member, true)}>무제한 회원으로…</Button>)}
      </div>
    </article>)}{list.data && !list.data.length && <p className="text-sm text-muted-foreground">찾는 회원이 없어요.</p>}</div>
    {dialog}
  </>;
}

// ─────────────────────────────────────────────
// 감사로그(대표만) · 운영진 역할
type AuditRow = { id: number; at: string; actorRole: string; actorEmail: string | null; action: string; target: string | null; targetName: string | null; reason: string | null };
export function LiveAudit() {
  const [form, setForm] = useState({ from: "", to: "", action: "" });
  const [filter, setFilter] = useState(form);
  const list = useLoad(() => call<AuditRow[]>("admin_list_audit", { p_from: filter.from || null, p_to: filter.to || null, p_action: filter.action.trim() || null }), [filter.from, filter.to, filter.action]);
  const submit = (event: FormEvent) => { event.preventDefault(); setFilter(form); };
  return <>
    <Title lead="고치거나 지울 수 없는 기록이에요. 대표만 볼 수 있고, 365일이 지나면 정리돼요. 최근 300건까지 보여요.">감사로그</Title>
    <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-2 text-xs"><label>시작일<Input type="date" value={form.from} onChange={event => setForm({ ...form, from: event.target.value })} className="mt-1 h-8" /></label><label>종료일<Input type="date" value={form.to} onChange={event => setForm({ ...form, to: event.target.value })} className="mt-1 h-8" /></label><label>기록 이름<Input value={form.action} onChange={event => setForm({ ...form, action: event.target.value })} placeholder="예: 소개 취소 · 열람 · 정지" className="mt-1 h-8 w-48" /></label><Button type="submit" size="sm">거르기</Button>{(filter.from || filter.to || filter.action) && <Button type="button" size="sm" variant="ghost" onClick={() => { const empty = { from: "", to: "", action: "" }; setForm(empty); setFilter(empty); }}>모두 보기</Button>}</form>
    <Notice text={list.error || ""} />
    <section className={`${box} overflow-x-auto`}><table className="w-full min-w-[760px] text-left text-xs"><thead className="border-b border-border text-muted-foreground"><tr><th className="p-3">시각</th><th className="p-3">한 사람</th><th className="p-3">기록</th><th className="p-3">대상</th></tr></thead><tbody className="divide-y divide-border">{(list.data ?? []).map(entry => <tr key={entry.id}><td className="whitespace-nowrap p-3">{kstDateTime(entry.at)}</td><td className="p-3">{entry.actorEmail ?? (entry.actorRole === "system" ? "예약 작업" : entry.actorRole === "member" ? "회원 본인" : "-")}<span className="block text-muted-foreground">{ROLE_LABEL[entry.actorRole as Role] ?? (entry.actorRole === "member" ? "회원" : entry.actorRole === "system" ? "시스템" : entry.actorRole)}</span></td><td className="p-3">{entry.action}{entry.reason ? <span className="block text-muted-foreground">{entry.reason}</span> : null}</td><td className="p-3">{entry.targetName ?? <span className="font-mono text-[11px] text-muted-foreground">{entry.target?.slice(0, 13) ?? "-"}</span>}</td></tr>)}</tbody></table>{!list.loading && !list.data?.length && <p className="p-5 text-sm text-muted-foreground">{list.error ? "" : "해당하는 기록이 없어요."}</p>}{list.loading && <p className="p-5 text-sm text-muted-foreground">불러오고 있어요.</p>}</section>
  </>;
}
// 전체 공지(대표만): 모든 회원에게 사이트 알림 + 메일. 베타 종료·정식 전환은 7일 전에 보낸다.
function Broadcast() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const { busy, run } = useBusy();
  const { ask, dialog } = useConfirm();
  const send = () => run("send", async () => {
    if (await ask({ title: "모든 회원에게 보낼까요?", body: <><p className="font-semibold text-foreground">{title}</p><p>사이트 알림과 메일로 가고, 보낸 뒤에는 되돌릴 수 없어요.</p></>, confirm: "보내기", danger: true }) === null) return;
    const { data, error } = await rpc<number>("admin_broadcast", { p_title: title, p_body: body });
    setMessage(error || `${data ?? 0}명에게 보냈어요. 메일은 몇 분에 걸쳐 나가요(5분마다 50통).`);
    if (!error) { setTitle(""); setBody(""); }
  });
  return <section className={`${box} mt-8 space-y-3 p-5`}>
    <h2 className="text-sm font-semibold">전체 공지 · 사이트 알림 + 메일</h2>
    <p className="text-xs leading-6 text-muted-foreground">대표만 보낼 수 있어요. 가입 확인을 마친 이용 중인 회원에게 가고, ‘메일 알림’을 고르지 않은 회원에게도 메일로 가요. 베타를 끝내거나 정식 운영으로 바꿀 때는 적어도 7일 전에 보내 주세요(약관 부칙).</p>
    <Input aria-label="공지 제목" value={title} maxLength={60} onChange={event => setTitle(event.target.value)} placeholder="제목(5~60자) · 예: 비포어스 정식 운영 안내" />
    <Textarea aria-label="공지 내용" value={body} maxLength={1000} onChange={event => setBody(event.target.value)} rows={5} placeholder="내용(10~1000자) · 바뀌는 날짜, 무엇이 바뀌는지, 원하지 않으면 탈퇴할 수 있다는 안내" />
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{body.trim().length} / 1000자</span><Button disabled={!!busy || title.trim().length < 5 || body.trim().length < 10} onClick={() => void send()}>{busy ? "보내고 있어요" : "모든 회원에게 보내기"}</Button></div>
    <Notice text={message} />
    {dialog}
  </section>;
}

export function LiveSettings() {
  const user = useAuth();
  const list = useLoad(() => table<{ user_id: string; role: Role; granted_at: string }>("admin_roles", query => query.select("user_id, role, granted_at")), []);
  const emails = useLoad(async () => { const ids = (list.data ?? []).map(row => row.user_id); return ids.length ? table<{ id: string; email: string }>("profiles", query => query.select("id, email").in("id", ids)) : []; }, [list.data]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [message, setMessage] = useState("");
  const { busy, run } = useBusy();
  const { ask, dialog } = useConfirm();
  const grant = (target: string, next: Role | null) => run(target, async () => {
    const confirmed = next === null
      ? await ask({ title: `${target}의 운영진 역할을 거둘까요?`, body: <p>바로 운영진 화면에 들어올 수 없게 돼요.</p>, confirm: "거두기", danger: true })
      : await ask({ title: `${target}에게 ‘${ROLE_LABEL[next]}’ 역할을 줄까요?`, danger: next === "owner", confirm: "역할 주기", body: next === "owner" ? <p className="font-semibold text-destructive">대표는 모든 권한(역할 주기·감사로그·전체 공지)을 가져요. 정말 필요한 사람에게만 주세요.</p> : <p>이미 역할이 있으면 이 역할로 바뀌어요. 처음 들어올 때 인증 앱을 연결해야 해요.</p> });
    if (confirmed === null) return;
    const { error } = await rpc("grant_admin_role", { p_email: target, p_role: next });
    setMessage(error || (next ? "역할을 줬어요. 그 사람도 처음 들어올 때 인증 앱을 연결해야 해요." : "역할을 거뒀어요."));
    if (!error && next) setEmail("");
    await list.reload();
  });
  return <>
    <Title lead="역할은 대표만 주고 거둘 수 있어요. 먼저 그 이메일로 회원가입을 해야 해요.">운영진</Title>
    <section className={`${box} space-y-3 p-5`}><div className="flex flex-wrap gap-2"><Input type="email" aria-label="운영진 이메일" value={email} onChange={event => setEmail(event.target.value)} placeholder="이메일" className="max-w-xs" /><select aria-label="역할" value={role} onChange={event => setRole(event.target.value as Role)} className="h-9 rounded-md border border-border bg-card px-2 text-sm">{(Object.keys(ROLE_LABEL) as Role[]).map(key => <option key={key} value={key}>{ROLE_LABEL[key]}</option>)}</select><Button onClick={() => void grant(email.trim(), role)} disabled={!email.trim() || !!busy}>역할 주기</Button></div><Notice text={message} /></section>
    <section className={`${box} mt-5 divide-y divide-border`}>{(list.data ?? []).map(row => { const mail = emails.data?.find(item => item.id === row.user_id)?.email; return <div key={row.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"><span>{mail ?? row.user_id.slice(0, 8)} · {ROLE_LABEL[row.role]}{row.user_id === user?.id ? " · 나" : ""}</span><span className="flex items-center gap-2 text-xs text-muted-foreground">{kstDay(row.granted_at)}{mail && row.role !== "owner" && row.user_id !== user?.id && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void grant(mail, null)}>거두기</Button>}</span></div>; })}</section>
    <Broadcast />
    {dialog}
  </>;
}
