import { Fragment, useEffect, useState } from "react";
import PreferencesStep from "./PreferencesStep";
import { EXPRESSION_ORDER } from "./personality-fields";
import ApplicationReviewStep from "./ApplicationReviewStep";
import { applicationErrorLocation, receiveDemoApplication, suspendDemoApplication } from "./application-review";
import { REVIEW_CONSENTS, changedReview, cloneReview } from "./review-state";
import { clonePreferences, type PreferenceSettings } from "./preference-model";
import { Link, useSearchParams } from "react-router";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Save, ShieldCheck, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Checkbox } from "./components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { APPLICATION_FIELDS, APPLICATION_STEPS, accountAge, ageOn, answerState, clearApplication, emptyApplication, fieldError, partnerPreview, requiredProgress, saveApplication, useSavedApplication, validateApplication, type AccountFacts, type AnswerValue, type ApplicationDraft } from "./application-model";
import { BEFORE_US } from "./config";
import { seoulDate } from "./today-state";
import PhotoStep from "./PhotoStep";
import { identityAccount, identityGate, useIdentity } from "./identity-model";
import { admitApplication } from "./gender-balance";
import { getConsoleData } from "./admin-console-data";
import { IdentityPanel } from "./MemberTrust";
import { MOCK_PHOTO_FILES, PHOTO_SLOTS, registerMockPhoto, clonePhotos, emptyPhotos, type ApplicationPhotos, type PhotoSlotId } from "./photo-model";
import { LIVE } from "./backend/client";
import { useAuth, useAuthReady } from "./auth-service";
import { EDITABLE, loadMyApplication, saveMyDraft, submitMyApplication, withdrawMyApplication, type ApplicationStatus, type PhotoRow } from "./backend/applications";
import LivePhotoStep from "./LivePhotoStep";

// 실제 서버 모드에서 신청서가 검토 단계에 들어가면 고칠 수 없으므로, 지금 상태만 보여 준다.
const LIVE_STATUS: Partial<Record<ApplicationStatus, { title: string; body: string }>> = {
  submitted: { title: "신청을 받았어요.", body: "운영진이 사진과 내용을 확인하고 있어요. 검토가 끝나면 오늘 화면에서 알려 드릴게요." },
  reviewing: { title: "신청서를 검토하고 있어요.", body: "검토가 끝나면 오늘 화면에서 알려 드릴게요. 고칠 내용이 있으면 문의하기로 남겨 주세요." },
  approved: { title: "소개 준비가 끝났어요.", body: "잘 맞는 분이 준비되면 정오에 오늘 화면에서 소개해 드릴게요." },
  held: { title: "신청이 잠시 보류됐어요.", body: "운영진 안내를 확인해 주세요. 궁금한 점은 문의하기로 남겨 주세요." },
  rejected: { title: "이번에는 소개를 준비하기 어려워요.", body: "운영진 안내를 확인해 주세요. 궁금한 점은 문의하기로 남겨 주세요." },
  withdrawn: { title: "신청을 철회했어요.", body: "다시 신청하고 싶으면 문의하기로 남겨 주세요." },
};

const interaction = "transition-colors duration-200 motion-reduce:transition-none";
type Field = typeof APPLICATION_FIELDS[number];

// 생년월일은 연·월·일을 따로 골라요(달력에서 연도를 넘기지 않아도 되게). 만 19세가 되는 해부터 보여 줘요.
function BirthDatePicker({ id, value, onChange, invalid, describedBy }: { id: string; value: string; onChange: (value: string) => void; invalid: boolean; describedBy: string }) {
  const [initialYear = "", initialMonth = "", initialDay = ""] = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-") : [];
  const [parts, setParts] = useState({ year: initialYear, month: initialMonth, day: initialDay });
  // 바깥에서 값이 바뀌면(예시 채우기·저장본 불러오기) 고른 칸도 맞춘다.
  useEffect(() => { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { const [year, month, day] = value.split("-"); setParts({ year, month, day }); } }, [value]);
  const thisYear = Number(seoulDate().slice(0, 4));
  const years = Array.from({ length: 62 }, (_, index) => String(thisYear - BEFORE_US.operatingDraft.minimumAge - index));
  const lastDay = parts.year && parts.month ? new Date(Number(parts.year), Number(parts.month), 0).getDate() : 31;
  const pick = (key: "year" | "month" | "day", next: string) => {
    const updated = { ...parts, [key]: next };
    const limit = updated.year && updated.month ? new Date(Number(updated.year), Number(updated.month), 0).getDate() : 31;
    if (updated.day && Number(updated.day) > limit) updated.day = "";
    setParts(updated);
    onChange(updated.year && updated.month && updated.day ? `${updated.year}-${updated.month}-${updated.day}` : "");
  };
  const box = "h-12 rounded-xl border-border bg-card px-4 text-sm";
  const column = (key: "year" | "month" | "day", label: string, options: string[], unit: string) => <Select value={parts[key]} onValueChange={next => pick(key, next)}><SelectTrigger id={key === "year" ? id : undefined} aria-label={label} aria-invalid={invalid} aria-describedby={describedBy} className={box}><SelectValue placeholder={label} /></SelectTrigger><SelectContent className="max-h-72">{options.map(option => <SelectItem key={option} value={option}>{Number(option)}{unit}</SelectItem>)}</SelectContent></Select>;
  return <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-2">
    {column("year", "연도", years, "년")}
    {column("month", "월", Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")), "월")}
    {column("day", "일", Array.from({ length: lastDay }, (_, index) => String(index + 1).padStart(2, "0")), "일")}
  </div>;
}

// 입력칸 아래 안내: 목적과 꼭 알아야 할 점만 한 줄로, 글자 수·선택 수는 오른쪽에 따로.
const SCOPE_LABEL = { private: "비공개", operator: "운영진만", partner: "상대 공개" } as const;
function fieldNotes(field: Field, text: string, today: string, existingAge: number | null) {
  const notes: string[] = [field.purpose];
  if (field.id === "self.name") notes.push("연락처·SNS·아이디는 넣지 않아요");
  if (field.id === "self.birthDate" && existingAge === null) notes.push(LIVE ? `지금 입력값으로 만 ${ageOn(text, today) ?? "—"}세 · 만 ${BEFORE_US.operatingDraft.minimumAge}세 이상만 신청할 수 있어요` : `자기 입력 계산 만 ${ageOn(text, today) ?? "—"}세 · 실제 생년월일·신분증은 받지 않아요`);
  if (field.id === "self.gender") notes.push("사진으로 성별이나 지향을 추론하지 않아요");
  if (field.id === "desired.gender") notes.push("기본은 이성 소개예요. 운영 범위와 다르면 따로 확인해요");
  if (field.format === "multi") notes.push("다시 누르면 해제돼요");
  if (field.scope === "partner" && field.group !== "optional") notes.push("공개 범위는 마지막 단계에서 확인해요");
  return notes;
}
function fieldCounter(field: Field, value: AnswerValue | undefined) {
  if (field.format === "multi" && field.limit) return `${Array.isArray(value) ? value.length : 0} / ${field.limit}`;
  if (field.format === "text" && field.max && field.max >= 100) { const length = typeof value === "string" ? Array.from(value.trim()).length : 0; return field.min ? `${length}자 · ${field.min}~${field.max}자` : `${length} / ${field.max}`; }
  return null;
}

// 긴 글 칸의 ‘예시 보기’: 빈 칸 앞에서 막히지 않도록 비포어스 말투의 예문을 보여 준다(빈 칸일 때만 가져다 쓸 수 있다).
const EXAMPLES: Record<string, string[]> = {
  "self.bio": ["주말엔 동네 책방과 카페를 천천히 걷는 걸 좋아해요. 말이 잘 통하는 사람과 오래 이야기하고 싶어요.", "평일엔 일에 집중하고, 쉬는 날엔 산책하며 머리를 비워요. 서로의 속도를 존중하는 사이를 바라요."],
  "self.introduction": ["일할 때는 꼼꼼한 편이라 마무리까지 챙기는 걸 좋아해요. 쉬는 날에는 늦잠을 자고, 오후에 동네를 걷다가 처음 보는 카페에 들어가 보는 게 작은 즐거움이에요. 사람을 대할 때는 먼저 잘 들으려고 하고, 친해지면 장난도 많이 치는 편이에요. 요즘은 아침에 짧게 달리기를 시작했는데, 생각보다 하루가 가벼워져서 오래 해 보려고 해요."],
  "self.answer": ["말을 고르지 않아도 되는 사람과 있을 때 편안해요. 조용히 있어도 어색하지 않고, 사소한 이야기에도 웃어 주는 사람이요. 서로의 하루를 궁금해하고, 바쁜 날에는 그 바쁨을 이해해 주는 사이라면 오래 편할 것 같아요."],
  "self.momentAnswer": ["퇴근길에 들른 빵집에서 마지막 남은 소금빵을 샀던 날이 떠올라요. 별일 아니었는데 하루가 괜찮게 끝난 느낌이었어요. 이런 작은 일을 같이 기뻐해 줄 수 있는 사람이면 좋겠어요."],
};

// 단계가 넘어갈수록 두 점이 가까워진다(마지막 단계에서 거의 만난다).
function StepDots({ step }: { step: number }) {
  const gap = [36, 24, 12, 3][step] ?? 36;
  return <span aria-hidden="true" className="flex items-center"><span className="size-2.5 rounded-full bg-primary" /><span className="block transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: gap }} /><span className="size-2.5 rounded-full bg-accent" /></span>;
}

// 한 단계 안의 묶음 머리: 다 채운 묶음은 한 줄 요약으로 접는다.
function GroupHeader({ id, title, lead, summary, done, total, open, onToggle, required = true }: { id: string; title: string; lead: string; summary: string; done: number; total: number; open: boolean; onToggle: () => void; required?: boolean }) {
  const complete = total > 0 && done >= total;
  return <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className={`flex w-full items-start justify-between gap-4 rounded-xl py-1 text-left hover:text-primary ${interaction}`}>
    <span className="min-w-0"><span className="flex items-center gap-2 text-base font-semibold">{complete && <Check size={16} className="shrink-0 text-primary" />}{title}<span className="text-xs font-normal text-muted-foreground">{required ? "필수" : "선택"}</span></span><span className="mt-2 block text-xs leading-6 text-muted-foreground">{open || !complete ? lead : summary}</span></span>
    <span className="flex shrink-0 items-center gap-2 pt-0.5"><span className={`rounded-full px-2.5 py-1 text-[11px] leading-none tabular-nums ${complete ? "bg-primary/8 text-primary" : "bg-muted text-muted-foreground"}`}>{complete ? (open ? "완료" : "완료 · 고치기") : `${done} / ${total}`}</span><ChevronDown size={18} className={`${open ? "rotate-180" : ""} transition-transform duration-200 motion-reduce:transition-none`} /></span>
  </button>;
}

// 넓은 화면에서 ‘나에 대해’를 쓰는 동안 옆에 보이는 미리보기. 공개를 켠 항목만, 쓰는 대로 바뀐다.
function LivePreview({ draft, today, account }: { draft: ApplicationDraft; today: string; account: AccountFacts }) {
  const items = partnerPreview(draft, today, account);
  const name = items.find(item => item.id === "self.name");
  const lineOf = (id: string) => { const item = items.find(entry => entry.id === id); return item ? (Array.isArray(item.value) ? item.value.join(" · ") : String(item.value)) : ""; };
  const meta = [lineOf("self.age"), [lineOf("self.province"), lineOf("self.area")].filter(Boolean).join(" "), lineOf("self.purpose")].filter(Boolean);
  const rest = items.filter(item => !["self.name", "self.age", "self.province", "self.area", "self.purpose", "self.bio"].includes(item.id));
  return <aside aria-label="상대에게 보일 모습 미리보기" className="sticky top-6 hidden lg:block">
    <div className="border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3"><p className="text-[10px] font-semibold tracking-[0.18em] text-accent">PREVIEW</p><span aria-hidden="true" className="flex gap-1"><span className="size-1.5 rounded-full bg-primary" /><span className="size-1.5 rounded-full bg-accent" /></span></div>
      <div className="space-y-4 p-5">
        <p className="text-xs text-muted-foreground">상대에게 이렇게 보여요</p>
        <p className="text-2xl font-semibold">{name ? String(name.value) : <span className="text-muted-foreground/60">이름</span>}</p>
        {meta.length > 0 && <p className="text-xs leading-6 text-muted-foreground">{meta.join(" · ")}</p>}
        {lineOf("self.bio") ? <p className="border-l-2 border-primary/40 pl-3 text-sm leading-7">{lineOf("self.bio")}</p> : <p className="text-xs leading-6 text-muted-foreground/70">한 줄 소개를 쓰면 여기에 보여요.</p>}
        {rest.length > 0 && <dl className="space-y-2 border-t border-border pt-4 text-xs">{rest.slice(0, 8).map(item => <div key={item.id} className="flex gap-3"><dt className="w-16 shrink-0 text-muted-foreground">{item.label.split(" · ")[0]}</dt><dd className="min-w-0 break-words">{Array.isArray(item.value) ? item.value.join(" · ") : String(item.value)}</dd></div>)}</dl>}
      </div>
    </div>
    <p className="mt-3 px-1 text-[11px] leading-5 text-muted-foreground">공개를 켠 항목만 보여요. 사진은 다음 단계에서 올려요.</p>
  </aside>;
}

function FieldInput({ field, value, onChange, error, sharing, onSharing, account, today, onLeave }: { field: Field; value: AnswerValue | undefined; onChange: (value: AnswerValue) => void; error?: string; sharing: boolean; onSharing: (value: boolean) => void; account: AccountFacts; today: string; onLeave?: () => void }) {
  const controlId = `apply-${field.id.replace(/\./g, "-")}`;
  const [examplesOpen, setExamplesOpen] = useState(false);
  const examples = EXAMPLES[field.id];
  const existingAge = accountAge(account, today);
  const text = typeof value === "string" ? value : "";
  const answered = answerState(value) === "answered";
  return <div onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onLeave?.(); }} className={`${["self.bio", "self.statement", "self.pledge", "self.question", "self.answer"].includes(field.id) || field.section === "expression" && field.format === "text" ? "md:col-span-2" : ""}`}>
    <div className="mb-3 flex items-start justify-between gap-3"><label htmlFor={controlId} className="text-sm font-semibold leading-6">{field.label}</label><span className="flex shrink-0 items-center gap-1.5 pt-0.5">{field.group === "optional" && field.scope === "partner" ? <label className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] leading-none ${sharing && answered ? "border-primary/30 text-primary" : "border-border text-muted-foreground"} ${answered ? "" : "cursor-not-allowed opacity-60"}`}><Checkbox checked={sharing && answered} disabled={!answered} onCheckedChange={checked => onSharing(checked === true)} className="size-3.5" />상대 공개</label> : <span className="rounded-full border border-border px-2.5 py-1 text-[11px] leading-none text-muted-foreground">{SCOPE_LABEL[field.scope]}</span>}<span className={`rounded-full px-2.5 py-1 text-[11px] leading-none ${field.required ? "bg-primary/8 text-primary" : "bg-muted text-muted-foreground"}`}>{field.required ? "필수" : "선택"}</span></span></div>
    {field.id === "self.birthDate" && existingAge !== null ? <div className="rounded-xl border border-border bg-muted p-4"><p className="text-sm font-semibold">기존 인증값 사용 · 만 {existingAge}세</p><p className="mt-2 text-xs leading-6 text-muted-foreground">생년월일을 다시 입력받지 않아요. 인증 기록은 연결된 기존 값만 사용해요.</p></div> : field.format === "boolean" ? <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4"><Checkbox id={controlId} checked={value === true} onCheckedChange={checked => onChange(checked === true)} className="mt-1" /><span className="text-xs leading-6 text-muted-foreground">본인이 확인하는 진술이에요. ‘미혼 인증’이나 검증 완료로 표시하지 않아요.</span></label> : field.format === "single" && (field.options?.length || 0) > 5 ? <Select value={text} onValueChange={onChange}><SelectTrigger id={controlId} aria-invalid={!!error} aria-describedby={`${controlId}-help`} className="h-12 rounded-xl border-border bg-card"><SelectValue placeholder="직접 선택해 주세요" /></SelectTrigger><SelectContent>{field.options?.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select> : field.format === "single" || field.format === "multi" ? <div id={controlId} role="group" aria-label={field.label} aria-describedby={`${controlId}-help`} className="flex flex-wrap gap-2">{field.options?.map(option => { const selected = field.format === "multi" ? Array.isArray(value) && value.includes(option) : value === option; const full = field.format === "multi" && Array.isArray(value) && value.length >= (field.limit || Infinity); return <Button key={option} type="button" variant="outline" aria-pressed={selected} disabled={!selected && full} onClick={() => onChange(field.format === "multi" ? selected ? (value as string[]).filter(item => item !== option) : [...(Array.isArray(value) ? value : []), option] : selected && !field.required ? "" : option)} className={`min-h-11 rounded-xl border-border px-4 text-xs whitespace-normal hover:bg-muted hover:text-foreground ${selected ? "border-primary bg-primary/5 text-primary" : "bg-card"} ${interaction}`}>{selected && <Check size={13} />}{option}</Button>; })}</div> : field.id === "self.birthDate" ? <BirthDatePicker id={controlId} value={text} onChange={onChange} invalid={!!error} describedBy={`${controlId}-help`} /> : field.format === "text" && (field.max || 0) >= 150 ? <Textarea id={controlId} value={text} onChange={event => onChange(event.target.value)} maxLength={field.max} aria-invalid={!!error} aria-describedby={`${controlId}-help`} placeholder={field.placeholder} className="min-h-28 rounded-xl border-border bg-card p-4 leading-7" /> : <Input id={controlId} type={field.format === "date" ? "date" : field.format === "number" ? "number" : "text"} value={text} onChange={event => onChange(event.target.value)} maxLength={field.max} max={field.format === "date" ? today : undefined} step={field.format === "number" ? 1 : undefined} aria-invalid={!!error} aria-describedby={`${controlId}-help`} placeholder={field.placeholder} autoComplete="off" className="h-12 rounded-xl border-border bg-card" />}
    <div id={`${controlId}-help`} className="mt-2.5 flex items-start justify-between gap-4 text-[11px] leading-5 text-muted-foreground"><p className="min-w-0">{fieldNotes(field, text, today, existingAge).join(" · ")}{examples && <> · <button type="button" aria-expanded={examplesOpen} onClick={() => setExamplesOpen(open => !open)} className="text-primary underline-offset-4 hover:underline">{examplesOpen ? "예시 닫기" : "예시 보기"}</button></>}</p>{fieldCounter(field, value) && <span className="shrink-0 tabular-nums">{fieldCounter(field, value)}</span>}</div>
    {examplesOpen && examples && <div className="mt-3 space-y-2 rounded-xl bg-muted/50 p-4">{examples.map(example => <div key={example} className="flex items-start justify-between gap-3"><p className="text-xs leading-6">{example}</p><Button type="button" size="sm" variant="ghost" disabled={!!text.trim()} onClick={() => { onChange(example); setExamplesOpen(false); }} className="h-7 shrink-0 rounded-lg px-2 text-[11px] text-primary">{text.trim() ? "쓰던 글 있음" : "가져다 쓰기"}</Button></div>)}<p className="text-[11px] text-muted-foreground">예시는 시작을 돕기 위한 거예요. 내 이야기로 고쳐 써 주세요.</p></div>}
    {error && <p role="alert" className="mt-2 text-xs leading-6 text-destructive">{error}</p>}
    {field.id === "self.mbti" && answered && <Button type="button" variant="ghost" onClick={() => onChange("")} className="mt-2 h-8 rounded-lg px-2 text-xs text-muted-foreground">MBTI 선택 해제</Button>}
  </div>;
}

export default function ApplicationForm({ account: accountProp, initialDraft }: { account?: AccountFacts; initialDraft?: ApplicationDraft }) {
  const [params]=useSearchParams();
  const user = useAuth();
  const authReady = useAuthReady();
  const [server, setServer] = useState<{ status: ApplicationStatus; decisionNote: string | null; photoRows: PhotoRow[] } | null>(null);
  const [loadError, setLoadError] = useState("");
  const identity = useIdentity("current-member");
  const account = accountProp ?? identityAccount(identity);
  const saved = useSavedApplication();
  const [draft, setDraft] = useState<ApplicationDraft>(() => { const source = initialDraft || saved; return source ? { ...source, review: cloneReview(source.review), preferences: clonePreferences(source.preferences), photos: clonePhotos(source.photos || emptyPhotos()), values: { ...source.values }, sharing: { ...source.sharing } } : emptyApplication(); });
  const [optionalOpen, setOptionalOpen] = useState(true);
  const [coreOpen, setCoreOpen] = useState(true);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setTick(value => value + 1), 30000); return () => window.clearInterval(timer); }, []);
  const [momentOpen, setMomentOpen] = useState(false);
  const [expressionOpen, setExpressionOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(()=>{const requested=params.get("step");if(requested!==null && /^[0-3]$/.test(requested))setDraft(current=>({...current,step:Number(requested),visited:[...new Set([...current.visited,Number(requested)])]}));},[params]);
  useEffect(() => { if (Object.keys(errors).some(id => APPLICATION_FIELDS.find(field => field.id === id)?.section === "expression")) setExpressionOpen(true); }, [errors]);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  useEffect(() => { if (!focusTarget) return; const frame = requestAnimationFrame(() => { const element = document.getElementById(focusTarget); if (element) { if (!element.matches("input,button,textarea,select,[tabindex]")) element.tabIndex = -1; element.focus({ preventScroll: true }); setFocusTarget(null); } }); return () => cancelAnimationFrame(frame); }, [draft.step, focusTarget]);
  const [notice, setNotice] = useState(saved && !LIVE ? "임시 저장된 데모 작성 지점으로 이어서 시작해요." : "");
  const editable = !LIVE || !server || EDITABLE.includes(server.status);
  // 실제 서버: 로그인한 회원의 신청서와 사진을 불러온다.
  const reload = async (keepDraft = false) => { const result = await loadMyApplication(); if (result.error || !result.data) { setLoadError(result.error || "신청서를 불러오지 못했어요."); return; } const data = result.data; setServer({ status: data.status, decisionNote: data.decisionNote, photoRows: data.photoRows }); const requested = params.get("step"); const step = requested !== null && /^[0-3]$/.test(requested) ? Number(requested) : null; setDraft(current => keepDraft ? { ...current, photos: data.draft.photos, review: data.draft.review } : step === null ? data.draft : { ...data.draft, step, visited: [...new Set([...data.draft.visited, step])] }); };
  useEffect(() => { if (LIVE && user) void reload(); }, [user?.id]);
  const refreshPhotos = async () => { await reload(true); setDraft(current => ({ ...current, values: { ...current.values, "consent.review": false, "consent.provision": false } })); };
  const saveRemote = async (target: ApplicationDraft) => { if (!LIVE || !editable) { setSavedAt(Date.now()); return true; } const result = await saveMyDraft(target); if (result.error) { setNotice(result.error); return false; } setSavedAt(Date.now()); return true; };
  const savedLabel = savedAt === null ? "" : `${LIVE ? "저장됨" : "이 탭에 저장됨"} · ${Date.now() - savedAt < 60000 ? "방금" : `${Math.floor((Date.now() - savedAt) / 60000)}분 전`}`;
  const today = seoulDate();
  const progress = requiredProgress(draft, today, account);
  const updateValue = (id: string, value: AnswerValue) => { setDraft(current => ({ ...current, completedDemo: false, review: changedReview(current.review, id.startsWith("desired.") ? "preference" : id.startsWith("consent.") ? "consent" : "core", id.startsWith("consent.") && REVIEW_CONSENTS.some(field => field.id === id && field.required) && value !== true), values: { ...current.values, [id]: value, ...(id.startsWith("self.") ? { "consent.review": false, "consent.provision": false } : {}) } })); setErrors(current => { const next = { ...current }; delete next[id]; return next; }); setNotice(""); };
  const updateSharing = (id: string, value: boolean) => { setDraft(current => ({ ...current, completedDemo: false, review: changedReview(current.review, "visibility", !value), sharing: { ...current.sharing, [id]: value }, values: { ...current.values, "consent.review": false, "consent.provision": false } })); setErrors(current => { const next = { ...current }; delete next["sharing." + id]; return next; }); };
  const updatePreferences = (values: Record<string, AnswerValue>, preferences: PreferenceSettings) => { setDraft(current => ({ ...current, review: changedReview(current.review, "preference"), values: { ...values }, preferences: clonePreferences(preferences), completedDemo: false })); setErrors(current => Object.fromEntries(Object.entries(current).filter(([id]) => !id.startsWith("desired.")))); setNotice(""); };
  const updatePhotos = (photos: ApplicationPhotos) => { setDraft(current => ({ ...current, review: changedReview(current.review, "photo", Object.keys(photos).some(id => !!current.photos[id as PhotoSlotId].file && !photos[id as PhotoSlotId].file)), photos, completedDemo: false, values: { ...current.values, "consent.review": false, "consent.provision": false } })); setErrors(current => Object.fromEntries(Object.entries(current).filter(([id]) => !id.startsWith("photo.")))); setNotice(""); };
  const move = (step: number, preserveErrors = false) => { const next = { ...draft, step, visited: [...new Set([...draft.visited, step])] }; setDraft(next); saveApplication(next); void saveRemote(next); if (!preserveErrors) setErrors({}); setNotice(""); };
  const submitLive = async () => { setNotice("신청서를 보내고 있어요."); if (!(await saveRemote(draft))) return; const result = await submitMyApplication(); if (result.error) { setNotice(result.error); return; } await reload(); setNotice(""); };
  const next = () => { const checked = validateApplication(draft, today, account, draft.step === 3 ? undefined : draft.step); setErrors(checked); if (Object.keys(checked).length) { if (Object.keys(checked).some(id => APPLICATION_FIELDS.some(field => field.id === id && field.group === "optional" && field.section !== "expression"))) setOptionalOpen(true); setNotice("입력한 항목의 안내를 확인해 주세요. 미작성 선택 항목은 완료율에 포함하지 않아요."); return; } if (draft.step < 3) move(draft.step + 1); else if (LIVE) void submitLive(); else { const blocked = accountProp ? null : identityGate(identity); if (blocked) { setNotice(blocked); return; } const result = receiveDemoApplication(draft, today, account); setDraft(result.draft); saveApplication(result.draft); const admission = result.draft.review.submission === "received" ? admitApplication(getConsoleData().admin, "current-application", { gender: result.draft.values["self.gender"], account, province: result.draft.values["self.province"] }, today) : null; setNotice(admission?.waitlist ? "신청을 받았어요. 지금은 신청이 많아 순서대로 검토하고 있어요. 신청 내용은 그대로 보관되고, 검토가 시작되면 오늘 화면에서 알려 드려요." : "가상 자료의 신청 접수 상태만 기록했어요. 사진 확인·소개 준비는 별도이며 실제 접수·수집·발송은 진행되지 않았어요."); } };
  const coreFields = APPLICATION_FIELDS.filter(field => field.step === 0 && field.group === "core" && field.required);
  const optionalFields = APPLICATION_FIELDS.filter(field => field.step === 0 && field.group === "optional" && field.section !== "expression" && field.required);
  const doneOf = (fields: readonly Field[]) => fields.filter(field => !fieldError(field, draft.values[field.id], today, account, draft.photos)).length;
  const coreDone = doneOf(coreFields), optionalDone = doneOf(optionalFields);
  const valueText = (id: string) => { const value = draft.values[id]; return Array.isArray(value) ? value.join(" · ") : typeof value === "string" ? value : ""; };
  const coreSummary = [valueText("self.name"), ageOn(String(draft.values["self.birthDate"] || ""), today) !== null ? `만 ${ageOn(String(draft.values["self.birthDate"]), today)}세` : "", [valueText("self.province"), valueText("self.area")].filter(Boolean).join(" "), valueText("self.purpose")].filter(Boolean).join(" · ");
  // 저장본을 불러왔을 때 이미 다 채운 묶음은 접어 둔다(처음 한 번).
  const [folded, setFolded] = useState(false);
  useEffect(() => { if (folded || (LIVE && !server)) return; setFolded(true); if (coreDone === coreFields.length) setCoreOpen(false); if (optionalDone === optionalFields.length) setOptionalOpen(false); }, [server, folded]);
  const leaveField = (field: Field) => { const value = draft.values[field.id]; if (answerState(value) === "unanswered") return; const error = fieldError(field, value, today, account, draft.photos); setErrors(current => { const next = { ...current }; if (error) next[field.id] = error; else delete next[field.id]; return next; }); };
  const remaining = progress.total - progress.complete;
  const QUESTIONS = [
    { question: "어떤 사람과 있을 때 편안한가요?", answer: "self.answer" },
    { question: "최근 나를 기분 좋게 만든 작은 일은 무엇인가요?", answer: "self.momentAnswer" },
  ] as const;
  const questionOn = (answer: string) => answer === "self.answer" ? draft.values["self.question"] === QUESTIONS[0].question : momentOpen || answerState(draft.values["self.momentAnswer"]) === "answered";
  const toggleQuestion = (answer: string) => {
    const on = questionOn(answer);
    if (answer === "self.answer") { updateValue("self.question", on ? "" : QUESTIONS[0].question); if (on) updateValue("self.answer", ""); }
    else { setMomentOpen(!on); if (on) updateValue("self.momentAnswer", ""); }
  };
  const questionIntro = <div key="question-intro" className="md:col-span-2"><div className="mb-3 flex items-start justify-between gap-3"><p className="text-sm font-semibold leading-6">질문형 소개</p><span className="shrink-0 pt-1 text-xs text-muted-foreground">선택</span></div><p className="mb-4 text-xs leading-6 text-muted-foreground">답하고 싶은 질문을 눌러 주세요. 고른 질문에만 답 칸이 열려요. 둘 다 골라도, 하나도 고르지 않아도 괜찮아요.</p><div className="grid gap-2 sm:grid-cols-2">{QUESTIONS.map(item => { const on = questionOn(item.answer); return <Button key={item.answer} type="button" variant="outline" aria-pressed={on} onClick={() => toggleQuestion(item.answer)} className={`h-auto min-h-12 justify-start whitespace-normal rounded-xl px-4 py-3 text-left text-sm ${on ? "border-primary bg-primary/5 text-primary" : "border-border bg-card"} ${interaction}`}>{on ? <Check size={14} className="shrink-0" /> : <span aria-hidden="true" className="size-3.5 shrink-0 rounded-full border border-border" />}{item.question}</Button>; })}</div>{QUESTIONS.filter(item => questionOn(item.answer)).map(item => { const field = APPLICATION_FIELDS.find(entry => entry.id === item.answer)!; return <div key={item.answer} className="mt-6"><FieldInput field={{ ...field, label: item.question }} value={draft.values[field.id]} onChange={value => updateValue(field.id, value)} error={errors[field.id]} sharing={draft.sharing[field.id] || false} onSharing={value => updateSharing(field.id, value)} account={account} today={today} /></div>; })}</div>;
  const renderField = (field: Field): React.ReactNode => field.id === "self.question" ? questionIntro : field.id === "self.answer" || field.id === "self.momentAnswer" ? null : <Fragment key={field.id}><FieldInput field={field} value={draft.values[field.id]} onChange={value => updateValue(field.id, value)} error={errors[field.id]} sharing={draft.sharing[field.id] || false} onSharing={value => updateSharing(field.id, value)} account={account} today={today} onLeave={() => leaveField(field)} />{field.id === "self.bio" && <details open={expressionOpen} onToggle={event => setExpressionOpen(event.currentTarget.open)} className="rounded-2xl border border-border bg-muted/30 p-5 md:col-span-2"><summary className="cursor-pointer text-sm font-semibold">나는 어떤 사람인가요? <span className="ml-2 text-xs font-normal text-muted-foreground">선택</span></summary><p className="mt-3 text-xs leading-7 text-muted-foreground">한 줄 소개로 다 담지 못한 나의 모습을 알려 주세요. 모두 선택이며, 상대 공개는 기본 꺼짐이에요. {LIVE ? "" : "가상 정보만 입력하고 "}연락처·SNS·민감정보는 적지 마세요.</p><div className="mt-6 grid gap-x-6 gap-y-7 md:grid-cols-2">{APPLICATION_FIELDS.filter(item => item.section === "expression").sort((first, second) => { return EXPRESSION_ORDER.indexOf(first.id) - EXPRESSION_ORDER.indexOf(second.id); }).map(renderField)}</div><p className="mt-5 text-xs leading-7 text-muted-foreground">MBTI와 태그는 직접 알려준 참고 정보예요. 사진·MBTI로 성격을 추론하거나 궁합을 점수화하지 않아요.</p></details>}</Fragment>;
  // 데모: 지금 단계에 맞는 가상 예시를 채운다. 사진 단계는 가상 파일 자리만 등록하고(실제 사진 없음) 본인 확인 두 가지를 체크한다. 운영자 검토는 '대기'로 둔다.
  const fillPhotoExample = () => { let photos = clonePhotos(draft.photos); PHOTO_SLOTS.forEach((slot, index) => { const file = MOCK_PHOTO_FILES[index]; if (!photos[slot.id].file) photos = registerMockPhoto(photos, slot.id, file); photos = { ...photos, [slot.id]: { ...photos[slot.id], recentSelfConfirmed: true, rightsSelfConfirmed: true } }; }); updatePhotos(photos); setNotice("가상 사진 자리를 채웠어요. 실제 사진이 아니며, 운영자 검토는 ‘대기’ 상태예요. 다음 단계로 넘어갈 수 있어요."); };
  const fillExample = () => { if (draft.step === 1) { fillPhotoExample(); return; } const values: Record<string, AnswerValue> = { "self.name": "예시온", "self.birthDate": "1999-03-15", "self.gender": "여성", "desired.gender": "남성", "self.province": "서울", "self.area": "가상구", "self.purpose": "천천히 알아가며 연애", "self.bio": "조용한 산책과 음악을 좋아하는 가상 인물이에요. 서로의 이야기를 천천히 듣고 싶어요.", "self.statement": true, "self.pledge": true, "self.height": "168", "self.body": "보통", "self.style": ["캐주얼"], "self.smoking": "안 함", "self.drinking": "월 1~2회", "self.schedule": "주간", "self.available": "주말 낮", "self.interests": ["산책", "음악"], "self.source": "지인 소개", "self.work": "기획·사무" }; setDraft(current => ({ ...current, review: changedReview(current.review, "core"), values: { ...current.values, ...values, ...Object.fromEntries(REVIEW_CONSENTS.map(field => [field.id, false])), "consent.matching": false, "consent.review": false, ...(accountAge(account, today) !== null ? { "self.birthDate": "" } : {}) }, sharing: emptyApplication().sharing, completedDemo: false })); setErrors({}); setNotice("가상 예시를 채웠어요. 실제 회원 정보나 인증 결과가 아니에요. 공개·동의는 직접 확인해 주세요."); };
  if (LIVE && (!authReady || (user && !server && !loadError))) return <section className="mx-auto w-full max-w-4xl py-24" aria-busy="true"><p role="status" className="text-sm text-muted-foreground">신청서를 불러오고 있어요.</p></section>;
  if (LIVE && !user) return <section className="mx-auto w-full max-w-4xl py-16 sm:py-20" aria-labelledby="application-title"><p className="mb-3 text-xs font-semibold tracking-[0.13em] text-accent">YOUR INTRODUCTION</p><h1 id="application-title" className="text-3xl font-semibold">나를 알고, 나답게 시작하기.</h1><p className="mt-4 text-sm leading-7 text-muted-foreground">{/[?&](code|error)=/.test(window.location.search) ? "메일 확인이 끝났어요. 가입한 기기와 다른 곳에서 링크를 열었다면, 로그인하면 이어서 작성할 수 있어요." : "소개 신청은 로그인한 뒤 작성할 수 있어요. 작성한 내용은 단계마다 저장돼 다른 기기에서도 이어 쓸 수 있어요."}</p><div className="mt-8 flex flex-wrap gap-2"><Button asChild className="h-12 rounded-xl px-5"><Link to="/signup">회원가입 <ArrowRight size={15} /></Link></Button><Button asChild variant="outline" className="h-12 rounded-xl border-border"><Link to="/login">로그인</Link></Button></div></section>;
  if (LIVE && loadError && !server) return <section className="mx-auto w-full max-w-4xl py-16 sm:py-20"><p role="alert" className="text-sm text-destructive">{loadError}</p><Button variant="outline" className="mt-5 rounded-xl" onClick={() => { setLoadError(""); void reload(); }}>다시 불러오기</Button></section>;
  if (LIVE && server && !editable) { const status = LIVE_STATUS[server.status]; return <section className="mx-auto w-full max-w-4xl py-16 sm:py-20" aria-labelledby="application-title"><p className="mb-3 text-xs font-semibold tracking-[0.13em] text-accent">YOUR INTRODUCTION</p><h1 id="application-title" className="text-3xl font-semibold">{status?.title}</h1><p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">{status?.body}</p>{server.decisionNote && <p className="mt-6 max-w-xl rounded-xl bg-muted p-4 text-sm leading-7">운영진 안내 · {server.decisionNote}</p>}<div className="mt-8 flex flex-wrap gap-2"><Button asChild className="h-12 rounded-xl px-5"><Link to="/today">오늘로 <ArrowRight size={15} /></Link></Button><Button asChild variant="outline" className="h-12 rounded-xl border-border"><Link to="/contact">문의하기</Link></Button></div></section>; }
  return <section className={`mx-auto w-full ${draft.step === 3 || draft.step === 0 ? "max-w-[1120px]" : "max-w-4xl"} py-16 sm:py-20`} aria-labelledby="application-title">
    <div className="mb-8 flex flex-wrap items-start justify-between gap-5"><div><p className="mb-3 text-xs font-semibold tracking-[0.13em] text-accent">{LIVE ? "YOUR INTRODUCTION" : "YOUR INTRODUCTION · DEMO"}</p><h1 id="application-title" className="text-3xl font-semibold">나를 알고, 나답게 시작하기.</h1><p className="mt-4 text-sm leading-7 text-muted-foreground">계정과 소개 신청은 별도예요. 계정 생성에 사진이나 이상형을 필수로 두지 않아요.</p></div>{!LIVE && <Button variant="outline" onClick={fillExample} className={`rounded-xl border-border hover:bg-muted hover:text-foreground ${interaction}`}>가상 예시 채우기</Button>}</div>
    {LIVE && server?.status === "needs_changes" && server.decisionNote && <div role="status" className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-7"><span className="font-semibold">운영진 보완 안내</span> · {server.decisionNote}</div>}
    <div className="mb-8 flex items-start gap-3 rounded-xl border border-accent/20 bg-accent/5 p-4"><ShieldCheck size={18} className="mt-1 shrink-0 text-accent" /><p className="text-xs leading-6 text-muted-foreground">{LIVE ? "작성한 내용은 단계를 넘길 때마다 저장돼요. 연락처·SNS·직장명·주민등록번호 같은 정보는 적지 말아 주세요. 생년월일은 만 나이 계산에만 쓰고 상대에게 보여 주지 않아요." : "가상 정보로만 시연해 주세요. 실제 민감정보·생년월일·사진·신분증을 수집하지 않아요. 임시 저장은 이 탭의 화면 메모리에만 유지되며 새로고침·탭 종료 시 사라져요."}</p></div>
    <nav aria-label="소개 신청 단계" className="grid grid-cols-4 gap-2 border-b border-border pb-6">{APPLICATION_STEPS.map((label, index) => <Button key={label} variant="ghost" disabled={!draft.visited.includes(index)} onClick={() => move(index)} aria-current={draft.step === index ? "step" : undefined} className={`h-auto flex-col items-start gap-2 rounded-xl px-3 py-3 text-left hover:bg-muted hover:text-foreground ${draft.step === index ? "bg-primary/5 text-primary" : "text-muted-foreground"} ${interaction}`}><span className="text-[10px] tracking-[0.1em]">STEP 0{index + 1}</span><span className="text-xs whitespace-normal sm:text-sm">{label}</span></Button>)}</nav>
    <div className="my-6 flex flex-wrap items-center justify-between gap-3 text-xs"><span className="flex items-center gap-3"><StepDots step={draft.step} /><span className="text-muted-foreground">{remaining > 0 ? <>남은 필수 질문 <strong className="font-semibold text-foreground tabular-nums">{remaining}개</strong> · 약 {Math.max(1, Math.ceil(remaining / 2))}분</> : <span className="font-semibold text-primary">필수 질문을 모두 채웠어요</span>}</span></span><span role="status" aria-live="polite" className="shrink-0 text-muted-foreground">{savedLabel}</span></div>
    <div className={draft.step === 0 ? "grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px]" : ""}><div className="min-w-0 border border-border bg-card"><div className="flex items-end justify-between gap-4 border-b border-border p-6 sm:px-8"><div><p className="mb-3 text-[10px] font-semibold tracking-[0.2em] text-accent">STEP 0{draft.step + 1} / 04</p><h2 className="text-2xl font-semibold sm:text-[28px]">{APPLICATION_STEPS[draft.step]}</h2></div><span aria-hidden="true" className="text-6xl font-extralight leading-none tabular-nums text-primary">0{draft.step + 1}</span></div>
      <div className="p-6 sm:p-8">
        {draft.step === 0 && <><div className="mb-7"><GroupHeader id="core-details" title="먼저, 꼭 필요한 이야기." lead="본인이 확인한 정보만 입력해요. 운영 초안과 자기 진술은 인증 완료가 아니에요." summary={coreSummary} done={coreDone} total={coreFields.length} open={coreOpen} onToggle={() => setCoreOpen(value => !value)} /></div>{coreOpen && <div id="core-details" className="grid gap-x-7 gap-y-8 md:grid-cols-2">{APPLICATION_FIELDS.filter(field => field.step === 0 && field.group === "core").map(renderField)}</div>}<div className="mt-9 border-t border-border pt-6"><GroupHeader id="optional-details" title="조금 더 알려 주세요" lead="잘 맞는 분을 찾는 데 꼭 필요한 정보예요. 답하고 싶지 않은 항목은 ‘답하지 않음’을 골라도 돼요. 상대 공개는 기본 꺼짐이에요." summary={`${optionalDone}개 모두 답했어요 · 상대 공개는 항목마다 따로 정해요`} done={optionalDone} total={optionalFields.length} open={optionalOpen} onToggle={() => setOptionalOpen(value => !value)} />{optionalOpen && <div id="optional-details" className="mt-7 grid gap-x-7 gap-y-8 md:grid-cols-2"><p className="text-xs leading-7 text-muted-foreground md:col-span-2">운영자의 매칭 목적 참고는 마지막 단계의 별도 동의로 확인해요. 상대 공개는 각 항목에서 따로 선택해요. 직장명·학벌·소득·재산·건강·정치·상세 연애 이력은 입력하지 않아요.</p>{APPLICATION_FIELDS.filter(field => field.step === 0 && field.group === "optional" && field.section !== "expression").map(renderField)}</div>}</div></>}
        {draft.step === 1 && (LIVE ? <LivePhotoStep rows={server?.photoRows ?? []} editable={editable} onChanged={refreshPhotos} errors={errors} /> : <PhotoStep photos={draft.photos} onChange={updatePhotos} errors={errors} />)}
        {draft.step === 2 && <PreferencesStep draft={draft} onChange={updatePreferences} errors={errors} />}
        {draft.step === 3 && !accountProp && !LIVE && <div className="mb-8"><IdentityPanel /></div>}
        {draft.step === 3 && <ApplicationReviewStep draft={draft} today={today} account={account} errors={errors} onSharing={updateSharing} onConsent={(id, value) => updateValue(id, value)} onEdit={(step, optional) => { move(step); if(step === 0) setOptionalOpen(!!optional); }} onSuspend={status => { if (LIVE && status === "withdrawn") { void withdrawMyApplication().then(result => result.error ? setNotice(result.error) : reload()); return; } const suspended = suspendDemoApplication(draft, status); setDraft(suspended); saveApplication(suspended); setErrors({}); setNotice("신청 " + (status === "held" ? "보류" : "철회") + " 의사를 데모에만 기록했어요."); }} onResume={() => { const resumed = { ...draft, completedDemo: false, review: { ...cloneReview(draft.review), submission: "draft" as const } }; setDraft(resumed); saveApplication(resumed); setErrors({}); setNotice("다시 작성할 수 있어요. 필요한 공개·동의는 직접 확인해 주세요."); }} />}
        {notice && <p role="status" className="mt-7 rounded-xl bg-muted p-4 text-xs leading-7">{notice}</p>}
        {Object.keys(errors).length > 0 && <div role="alert" className="mt-5 rounded-xl border border-destructive/20 p-4"><p className="text-xs font-semibold text-destructive">확인이 필요한 항목</p><ul className="mt-2 space-y-2">{Object.keys(errors).map(id => { const field = APPLICATION_FIELDS.find(item => item.id === id); const location = applicationErrorLocation(id); return <li key={id}><Button variant="link" onClick={() => { move(location.step, true); setFocusTarget(location.elementId); if(field?.section === "expression") setExpressionOpen(true); else if(field?.group === "optional") setOptionalOpen(true); }} className="h-auto justify-start p-0 text-xs text-destructive">{location.label}: {errors[id]}</Button></li>; })}</ul></div>}
      </div><div className="bg-accent px-6 py-3 text-[11px] text-accent-foreground sm:px-8">내가 알려준 정보와, 내가 원하는 상대 조건은 별도로.</div></div>{draft.step === 0 && <LivePreview draft={draft} today={today} account={account} />}</div>
    <div className="sticky bottom-0 z-20 -mx-5 mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 px-5 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none"><Button variant="ghost" disabled={draft.step === 0} onClick={() => move(draft.step - 1)} className={`rounded-xl hover:bg-muted hover:text-foreground ${interaction}`}><ArrowLeft size={15} />이전</Button><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { saveApplication(draft); if (LIVE) void saveRemote(draft).then(ok => ok && setNotice("저장했어요. 다른 기기에서도 이어 쓸 수 있어요.")); else { setSavedAt(Date.now()); setNotice("데모 임시 저장 완료. 다른 화면에서 돌아와도 이어 쓸 수 있어요. 새로고침하면 삭제돼요."); } }} className={`h-12 rounded-xl border-border hover:bg-muted hover:text-foreground ${interaction}`}><Save size={15} />임시 저장</Button><Button onClick={next} className={`h-12 rounded-xl px-5 ${interaction}`}>{draft.step === 3 ? LIVE ? "소개 신청하기" : "소개 신청 확인 · 데모" : "다음"}<ArrowRight size={15} /></Button></div></div>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><Link to="/today" onClick={() => { saveApplication(draft); void saveRemote(draft); }} className="rounded-sm underline underline-offset-4">오늘로 돌아가기 · 작성 내용 임시 저장</Link>{!LIVE && <Button variant="ghost" onClick={() => { clearApplication(); setDraft(emptyApplication()); setErrors({}); setOptionalOpen(false); setNotice("이 탭의 데모 작성 내용을 지웠어요."); }} className={`h-8 text-xs text-muted-foreground hover:bg-muted hover:text-foreground ${interaction}`}><X size={12} />데모 작성 지우기</Button>}</div>
  </section>;
}
