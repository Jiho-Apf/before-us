import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronDown, Sparkles, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { rpc, supabase } from "./backend/client";
import { photoUrl } from "./backend/applications";
import { APPLICATION_FIELDS } from "./application-model";
import { PHOTO_SLOTS } from "./photo-model";
import { APPEARANCE_PREFIX, PREFERENCE_FIELDS, hasSpecificPreference, preferenceValueText, type PreferenceValue } from "./preference-model";
import { BEFORE_US } from "./config";
import { cohortName } from "./cohort";
import { kstDateTime, kstDay } from "./dates";
import { MATCH_SCORE_SHOWN, box, call, candidatesFor, draftNote, fitScore, localInsight, memberMatch, pairWarnings, revealOnNarrow, useBusy, useLoad, waitedDays, type Filtered, type Fit, type Insight, type MemberMatch, type PairHistory, type Preferences, type ReadyMember } from "./admin-match";

// 운영진 화면이 같이 쓰는 작은 조각(알림 줄·사진·기다린 날·확인 창)과 매칭 화면.

export function Notice({ text }: { text: string }) { return text ? <p role="status" className="rounded-lg bg-muted px-4 py-3 text-xs leading-6">{text}</p> : null; }

export function AdminPhoto({ path, className = "" }: { path: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let alive = true; void photoUrl(path).then(next => { if (alive) setUrl(next); }); return () => { alive = false; }; }, [path]);
  return <div className={`aspect-[4/5] overflow-hidden rounded-md border border-border bg-muted ${className}`}>{url && <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className="h-full w-full object-cover" /></a>}</div>;
}

// 기다린 날 표시: 4일 이상 노랑, 7일 이상 빨강. always면 그보다 짧아도 옅게 보여 준다(고객 문의 옆).
export function WaitBadge({ since, always = false }: { since?: string | null; always?: boolean }) {
  const days = waitedDays(since);
  const { waitingNoteAfterDays, reviewAfterDays } = BEFORE_US.noonGuidance;
  if (days === null || (!always && days < waitingNoteAfterDays)) return null;
  const long = days >= reviewAfterDays;
  return <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${long ? "bg-destructive/10 text-destructive" : days >= waitingNoteAfterDays ? "bg-[#F8E5A6] text-[#5A4310]" : "bg-secondary text-muted-foreground"}`}>기다린 지 {days}일{long ? " · 먼저 챙겨 주세요" : ""}</span>;
}

export const Pill = ({ tone = "muted", children }: { tone?: "muted" | "warn" | "danger" | "ok"; children: ReactNode }) =>
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone === "danger" ? "bg-destructive/10 text-destructive" : tone === "warn" ? "bg-[#F8E5A6] text-[#5A4310]" : tone === "ok" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{children}</span>;

// 확인 창: window.confirm 대신 이름과 사유를 함께 받는다. ask()는 확인하면 사유(없으면 "")를, 닫으면 null을 준다.
type Ask = { title: string; body?: ReactNode; confirm: string; danger?: boolean; reason?: { label: string; placeholder?: string; required?: boolean } };
export function useConfirm() {
  const [state, setState] = useState<(Ask & { resolve: (value: string | null) => void }) | null>(null);
  const ask = (options: Ask) => new Promise<string | null>(resolve => setState({ ...options, resolve }));
  const close = (value: string | null) => { state?.resolve(value); setState(null); };
  return { ask, dialog: state ? <ConfirmDialog key={state.title} {...state} onClose={close} /> : null };
}
function ConfirmDialog({ title, body, confirm, danger, reason, onClose }: Ask & { onClose: (value: string | null) => void }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>("textarea, button[data-confirm]")?.focus(); const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(null); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);
  const blocked = !!reason?.required && !value.trim();
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => onClose(null)}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`${box} w-full max-w-md space-y-4 p-5 text-sm shadow-lg`} onClick={event => event.stopPropagation()}>
      <h2 className="text-base font-semibold">{title}</h2>
      {body && <div className="space-y-2 text-xs leading-6 text-muted-foreground">{body}</div>}
      {reason && <label className="block text-xs">{reason.label}<Textarea value={value} maxLength={500} onChange={event => setValue(event.target.value)} placeholder={reason.placeholder} className="mt-1 min-h-20" /></label>}
      <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => onClose(null)}>닫기</Button><Button size="sm" data-confirm variant={danger ? "destructive" : "default"} disabled={blocked} onClick={() => onClose(value.trim())}>{confirm}</Button></div>
    </div>
  </div>;
}

// ─────────────────────────────────────────────
// 소개서(신청서) 보기: 운영진 열람은 admin_get_application이 하루 한 번 감사 기록을 남긴다.
export type ApplicationDetail = { memberId: string; status: string; profileVersion: number; submittedAt: string | null; decisionNote: string | null; draft: { values: Record<string, unknown>; sharing: Record<string, boolean>; preferences?: Preferences }; photos: { slot: string; path: string; review: string; reason: string | null; width: number; height: number }[] };
export const show = (value: unknown) => Array.isArray(value) ? value.join(" · ") : typeof value === "boolean" ? value ? "예" : "아니요" : String(value ?? "");
const filled = (value: unknown) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
const KEY_ITEMS: [string, string][] = [["self.purpose", "관계 목적"], ["self.height", "키"], ["self.body", "체형"], ["self.style", "스타일"], ["self.smoking", "흡연"], ["self.drinking", "음주"], ["self.schedule", "생활"], ["self.available", "편한 시간"], ["self.interests", "관심사"], ["self.work", "직업·분야"], ["self.mbti", "MBTI"]];
const STORY_ITEMS = ["self.bio", "self.introduction", "self.answer", "self.momentAnswer", "self.relationshipValues", "self.currentLikes", "self.daysOff", "self.traits"];
const HIDDEN_PREFS = new Set(["desired.ageMin", "desired.ageMax", `${APPEARANCE_PREFIX}heightMin`, `${APPEARANCE_PREFIX}heightMax`]);

// 회원이 적은 ‘바라는 상대’와 운영진에게 남긴 요청
export function PreferenceList({ values, preferences }: { values: Record<string, unknown>; preferences?: Preferences }) {
  const prefValues = values as Record<string, PreferenceValue>;
  const importance = preferences?.importance ?? {};
  const rows = PREFERENCE_FIELDS.filter(field => !HIDDEN_PREFS.has(field.id) && (importance[field.id] === "required" || hasSpecificPreference(field.id, prefValues) || (filled(values[field.id]) && values[field.id] !== "선호 없음")));
  return <div className="space-y-2">
    {rows.length ? <ul className="space-y-1.5 text-xs leading-5">{rows.map(field => <li key={field.id} className="flex flex-wrap items-baseline gap-1.5"><span className="text-muted-foreground">{field.label}</span><span>{preferenceValueText(field.id, prefValues)}</span>{importance[field.id] === "required" ? <Pill tone="danger">필수</Pill> : importance[field.id] === "preference" ? <Pill>선호</Pill> : null}{preferences?.confidential?.[field.id] ? <Pill>운영진만</Pill> : null}</li>)}</ul> : <p className="text-xs text-muted-foreground">따로 적은 선호가 없어요.</p>}
    {preferences?.request === "operator" && <p className="rounded-md bg-[#F8E5A6]/60 px-3 py-2 text-xs leading-5">운영진에게 남긴 요청 · {preferences.requestNote || "내용 없음"}</p>}
    {preferences?.request === "hold" && <p className="rounded-md bg-[#F8E5A6]/60 px-3 py-2 text-xs leading-5">추가 기준이 맞는 분이 생길 때까지 보류 요청 · {preferences.requestNote || "내용 없음"}</p>}
  </div>;
}

// full: 신청자 화면(사진은 따로 검토하므로 빼고, 휴대폰·진술·동의까지 모두). 매칭 화면은 사진과 매칭에 쓰는 항목만.
export function ProfileSheet({ detail, member, full = false }: { detail: ApplicationDetail; member?: ReadyMember; full?: boolean }) {
  const values = detail.draft.values ?? {};
  const age = values["self.age"] ?? member?.age;
  const rest = APPLICATION_FIELDS.filter(field => field.format !== "photo" && field.scope !== "private" && !field.id.startsWith("desired.") && (full || (!field.id.startsWith("consent.") && !["self.phone", "self.statement", "self.pledge", "self.notifyChannels"].includes(field.id))) && filled(values[field.id]));
  return <div className="space-y-5">
    {!full && <div className="grid grid-cols-4 gap-2">{PHOTO_SLOTS.map(slot => { const photo = detail.photos.find(item => item.slot === slot.id); return <div key={slot.id} className="space-y-1 text-[11px]">{photo ? <AdminPhoto path={photo.path} /> : <div className="flex aspect-[4/5] items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">{slot.required ? "필수 없음" : "없음"}</div>}<p className={photo?.review === "기준 확인" ? "text-muted-foreground" : "font-semibold text-accent"}>{slot.label}{photo ? ` · ${photo.review}` : ""}</p></div>; })}</div>}
    <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-xs leading-5">
      <dt className="text-muted-foreground">나이·지역</dt><dd>만 {show(age)}세 · {show(values["self.province"])} {show(values["self.area"])}</dd>
      <dt className="text-muted-foreground">성별</dt><dd>{show(values["self.gender"])} → {show(values["desired.gender"])}</dd>
      {KEY_ITEMS.filter(([id]) => filled(values[id])).map(([id, label]) => <div key={id} className="contents"><dt className="text-muted-foreground">{label}</dt><dd>{show(values[id])}{id === "self.height" ? "cm" : ""}</dd></div>)}
    </dl>
    {STORY_ITEMS.filter(id => filled(values[id])).map(id => <div key={id} className="text-xs leading-6"><p className="text-muted-foreground">{APPLICATION_FIELDS.find(field => field.id === id)?.label ?? id}</p><p className="whitespace-pre-wrap break-words">{show(values[id])}</p></div>)}
    <div><h4 className="mb-2 text-xs font-semibold">바라는 상대</h4><PreferenceList values={values} preferences={detail.draft.preferences} /></div>
    <details className="text-xs" open={full}><summary className="cursor-pointer font-semibold text-muted-foreground">소개서 전체 항목</summary><dl className="mt-2 divide-y divide-border">{rest.map(field => <div key={field.id} className="grid gap-1 py-1.5 sm:grid-cols-[140px_1fr]"><dt className="text-muted-foreground">{field.label}{field.scope === "partner" ? detail.draft.sharing?.[field.id] ? " · 상대 공개" : " · 비공개" : " · 운영 참고"}</dt><dd className="whitespace-pre-wrap break-words">{show(values[field.id])}</dd></div>)}</dl></details>
  </div>;
}

// ─────────────────────────────────────────────
// 매칭: 왼쪽 회원을 고르면 오른쪽에 잘 맞는 분이 점수 순으로 나오고, 고르면 두 소개서를 나란히 본다.
const nextNoonDate = () => { const now = new Date(); const kst = new Date(now.getTime() + 9 * 3600000); const date = kst.toISOString().slice(0, 10); return kst.getUTCHours() < 12 ? date : new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); };
const HISTORY: Record<string, string> = { suspended: "이용 정지", reported: "신고 대상", blocked: "차단 관계" };

function MemberFlags({ member, date }: { member: ReadyMember; date: string }) {
  const photos = member.photos_confirmed ?? 3;
  return <>
    <WaitBadge since={member.waiting_since} />
    {photos < 3 && <span className="ml-2"><Pill tone="danger">사진 확인 {photos}/3</Pill></span>}
    {member.cohort_starts_on && date < member.cohort_starts_on && <span className="ml-2"><Pill tone="warn">기수 시작 {kstDay(`${member.cohort_starts_on}T12:00:00+09:00`)}</Pill></span>}
    {member.released_at && <span className="ml-2"><Pill tone="warn">방금 마무리 · {kstDateTime(member.released_at)}</Pill></span>}
    {member.history?.length ? <span className="ml-2"><Pill tone="danger">이전 계정 이력 · {member.history.map(item => HISTORY[item] ?? item).join(", ")}</Pill></span> : null}
    {member.profile?.preferences?.request && member.profile.preferences.request !== "none" && <span className="ml-2"><Pill tone="warn">{member.profile.preferences.request === "hold" ? "보류 요청" : "운영진 요청"}</Pill></span>}
  </>;
}
const memberLine = (member: ReadyMember) => `${member.gender ?? "?"} → ${member.desired ?? "?"} · ${member.age ?? "?"}세 · ${member.province ?? ""} ${member.area ?? ""}`;
const scoreTone = (score: number) => score >= 70 ? "text-primary" : score >= 45 ? "text-foreground" : "text-destructive";

// 소개서는 MatchBoard가 불러와 넘긴다(회원에게 보일 궁합도 같은 소개서의 공개 항목으로 만든다).
type DetailState = { data: ApplicationDetail | null; error: string | null };
function Side({ member, side, date, detail, onClear }: { member: ReadyMember; side: "왼쪽" | "오른쪽"; date: string; detail: DetailState; onClear: () => void }) {
  return <section className={`${box} space-y-4 p-5`} aria-label={`${side} 소개서`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><p className="text-[11px] text-muted-foreground">{side} · {member.cohort != null ? `${cohortName(member.cohort)} · ` : ""}소개 {member.introductions}번{member.last_published_at ? ` · 최근 ${kstDay(member.last_published_at)}` : " · 첫 소개 전"}</p><h3 className="mt-1 text-lg font-semibold">{member.name ?? "이름 없음"}<MemberFlags member={member} date={date} /></h3><p className="text-xs text-muted-foreground">{memberLine(member)}</p></div>
      <div className="flex gap-1"><Link to={`/admin/applicants?member=${member.member_id}`} className="rounded-full border border-border px-3 py-1 text-[11px] hover:bg-secondary">신청서</Link><Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onClear}><X size={13} />바꾸기</Button></div>
    </div>
    {detail.error ? <Notice text={detail.error} /> : detail.data?.memberId === member.member_id ? <ProfileSheet detail={detail.data} member={member} /> : <p className="text-xs text-muted-foreground">소개서를 불러오고 있어요.</p>}
  </section>;
}

// 궁합 분석(참고용): 외부로 아무것도 보내지 않고, 이 화면에서 두 소개서를 나란히 읽어 정리한다(localInsight).
// 소개 이유 초안(note)은 두 분 모두 공개한 항목으로만 만든다(두 분에게 함께 보이는 글이라 비공개 답이 새지 않게).
function Compat({ left, right, fit, note, onUseNote }: { left: ReadyMember; right: ReadyMember; fit: Fit; note: string | null; onUseNote: (note: string) => void }) {
  const [ai, setAi] = useState<{ loading: boolean; data?: Insight; error?: string }>({ loading: false });
  const load = () => setAi({ loading: false, data: localInsight(left, right, fit) });
  const List = ({ items, tone }: { items: string[]; tone: "ok" | "warn" | "danger" }) => items.length ? <ul className="space-y-1 text-xs leading-5">{items.map(item => <li key={item} className="flex gap-2"><span aria-hidden="true" className={tone === "ok" ? "text-primary" : tone === "warn" ? "text-accent" : "text-destructive"}>{tone === "ok" ? "✓" : tone === "warn" ? "!" : "✕"}</span><span>{item}</span></li>)}</ul> : null;
  return <section className={`${box} grid gap-5 p-5 md:grid-cols-2`} aria-label="궁합">
    <div className="space-y-3">
      <div className="flex items-baseline gap-3"><h3 className="text-sm font-semibold">규칙 점수</h3><span className={`text-3xl font-light tabular-nums ${scoreTone(fit.score)}`}>{fit.score}</span><span className="text-[11px] text-muted-foreground">두 소개서의 답으로 계산 · 참고용</span></div>
      <List items={fit.violations} tone="danger" />
      <List items={fit.reasons} tone="ok" />
      <List items={[...fit.cautions, ...fit.unsure]} tone="warn" />
      {!fit.reasons.length && !fit.cautions.length && !fit.violations.length && <p className="text-xs text-muted-foreground">견줄 답이 많지 않아요. 소개서를 직접 읽어 주세요.</p>}
    </div>
    <div className="space-y-3 border-t border-border pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles size={14} className="text-accent" />궁합 분석 <span className="text-[11px] font-normal text-muted-foreground">참고용 · 운영진만 봐요</span></h3><Button size="sm" variant="outline" disabled={ai.loading} onClick={load}>{ai.loading ? "분석하고 있어요" : ai.data ? "다시 분석" : "궁합 분석 받기"}</Button></div>
      {ai.data && <div className="space-y-3">
        <div className="flex items-baseline gap-3"><span className={`text-3xl font-light tabular-nums ${scoreTone(ai.data.score)}`}>{Math.round(ai.data.score)}</span><p className="text-xs leading-6">{ai.data.summary}</p></div>
        <List items={ai.data.reasons ?? []} tone="ok" />
        <List items={ai.data.cautions ?? []} tone="warn" />
        <div className="rounded-md bg-muted p-3 text-xs leading-6"><p className="text-muted-foreground">소개 이유 초안 · 두 분 모두 공개한 항목으로</p>{note ? <><p className="mt-1">{note}</p><Button size="sm" variant="outline" className="mt-2 h-7 text-[11px]" onClick={() => onUseNote(note)}>소개 이유 초안으로 쓰기</Button></> : <p className="mt-1 text-muted-foreground">두 소개서를 불러오면 초안을 만들어요.</p>}</div>
        <p className="text-[11px] leading-5 text-muted-foreground">분석은 판단을 돕는 참고 자료예요. 회원에게 그대로 보내지 말고, 소개 이유는 직접 다듬어 주세요.</p>
      </div>}
      {!ai.data && !ai.error && !ai.loading && <p className="text-xs text-muted-foreground">두 소개서를 나란히 읽고 점수·이유·주의할 점·소개 이유 초안을 정리해요. 누를 때만 분석해요.</p>}
    </div>
  </section>;
}

// 자동 필터: 다시 소개하지 않는 분·조건이 맞지 않는 분을 까닭과 기록으로 접어 둔다(기본은 접힘). 서버도 같은 기준으로 예약을 막는다.
function AutoFilter({ filtered, otherGender }: { filtered: Filtered[]; otherGender: number }) {
  const total = filtered.length + otherGender;
  if (!total) return null;
  return <details className="group border-b border-border px-4 py-3 text-xs">
    <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold [&::-webkit-details-marker]:hidden"><Sparkles size={13} className="text-accent" />자동 필터 · 자동으로 거른 분 {total}명<ChevronDown size={13} className="ml-auto text-muted-foreground transition-transform group-open:rotate-180" /></summary>
    <p className="mt-2 text-[11px] leading-5 text-muted-foreground">소개 기록·차단·신고·아는 사람 피하기·성별·필수 조건을 보고 걸렀어요. 예약할 때 서버도 같은 기준으로 한 번 더 막아요.</p>
    <ul className="mt-1 divide-y divide-border">
      {filtered.map(({ member, reason }) => <li key={member.member_id} className="py-2"><p><span className="font-semibold">{member.name ?? "이름 없음"}</span><span className="ml-2 text-[11px] text-muted-foreground">{member.age ?? "?"}세 · {member.province ?? "-"}</span></p><p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{reason}</p></li>)}
      {otherGender > 0 && <li className="py-2 text-[11px] text-muted-foreground">찾는 성별이 아닌 분 {otherGender}명</li>}
    </ul>
  </details>;
}

// 회원에게 보일 궁합 미리 보기: 두 분 모두 공개한 항목으로만 만들고, 예약과 함께 보낸다(정오 공개부터 두 분의 ‘두 사람’ 화면에).
function MemberMatchPreview({ match, waiting, error, send, onSend }: { match: MemberMatch | null; waiting: boolean; error: string | null; send: boolean; onSend: (value: boolean) => void }) {
  return <div className="space-y-3 rounded-lg border border-lilac bg-mist p-4" aria-label="회원에게 보일 궁합">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold"><Sparkles size={13} className="text-accent" />회원에게 보일 궁합<span className="font-normal text-muted-foreground">· 정오 공개부터 두 분에게</span></h3>
      {match && <label className="flex cursor-pointer items-center gap-2 text-[11px]"><Checkbox checked={send} onCheckedChange={value => onSend(value === true)} />예약과 함께 보내기</label>}
    </div>
    {match ? <div className={`space-y-3 ${send ? "" : "opacity-50"}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">{match.score >= MATCH_SCORE_SHOWN ? <span className="text-2xl font-light tabular-nums text-primary">{match.score}</span> : <Pill tone="warn">숫자 없이 이유만 · {match.score}점</Pill>}<p className="text-xs font-semibold leading-6">{match.headline}</p></div>
      <div className="grid gap-3 sm:grid-cols-2">{([["왜 어울리는지", match.why], ["함께일 때 빛나는 점", match.together]] as const).map(([title, items]) => <div key={title}><p className="text-[11px] font-semibold text-accent">{title}</p><ul className="mt-1 space-y-1 text-xs leading-5">{items.map(item => <li key={item} className="flex gap-2"><span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-primary" /><span>{item}</span></li>)}</ul></div>)}</div>
    </div> : <p className="text-xs text-muted-foreground">{error ? "소개서를 불러오지 못해 궁합을 만들 수 없어요. 이대로 예약하면 궁합 없이 소개돼요." : waiting ? "두 소개서를 읽고 있어요." : "두 분을 고르면 만들어요."}</p>}
    <p className="text-[11px] leading-5 text-muted-foreground">두 분 모두 ‘상대 공개’로 둔 항목만 써요(비공개 답·바라는 상대·필수 조건·키·MBTI는 쓰지 않아요). 점수가 {MATCH_SCORE_SHOWN}점 아래면 회원에게는 숫자 없이 이유만 보여요.</p>
  </div>;
}

export function MatchBoard({ focus, onReserved }: { focus: string | null; onReserved: () => Promise<void> }) {
  const ready = useLoad(() => call<ReadyMember[]>("admin_ready_members"), []);
  const [leftId, setLeftId] = useState<string | null>(focus);
  const [rightId, setRightId] = useState<string | null>(null);
  const [date, setDate] = useState(nextNoonDate);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [gender, setGender] = useState<"" | "여성" | "남성">("");
  const [sendCompat, setSendCompat] = useState(true);
  const { busy, run } = useBusy();
  const members = ready.data ?? [];
  const left = members.find(member => member.member_id === leftId) ?? null;
  const right = members.find(member => member.member_id === rightId) ?? null;
  useEffect(() => { setLeftId(focus); setRightId(null); }, [focus]);
  // 두 소개서(운영진 열람 기록은 서버가 하루 한 번 남긴다)와 왼쪽 회원의 두 사람 소개 기록(자동 필터의 근거)
  const leftDetail = useLoad(() => leftId ? call<ApplicationDetail>("admin_get_application", { p_member: leftId }) : Promise.resolve(null), [leftId]);
  const rightDetail = useLoad(() => rightId ? call<ApplicationDetail>("admin_get_application", { p_member: rightId }) : Promise.resolve(null), [rightId]);
  const history = useLoad(async () => ({ member: leftId, rows: leftId ? await call<PairHistory[]>("admin_pair_history", { p_member: leftId }) : [] }), [leftId]);
  const historyReady = history.data?.member === leftId || (!!history.error && !history.loading);
  const pastMap = useMemo(() => new Map((history.data?.member === leftId ? history.data.rows : []).map(item => [item.other, item] as const)), [history.data, leftId]);
  // 이 회원의 소개 기록을 받기 전에는 후보를 보여 주지 않는다(거를 분이 잠깐 섞여 보이지 않게). 못 받으면 이전 소개·차단 목록으로만 거른다.
  const pool = useMemo(() => left && historyReady ? candidatesFor(left, members, date, pastMap) : null, [left, members, date, pastMap, historyReady]);
  const fit = useMemo(() => left && right ? fitScore(left, right) : null, [left, right]);
  const past = right ? pastMap.get(right.member_id) ?? null : null;
  const warnings = left && right && fit ? pairWarnings(left, right, date, fit, past) : [];
  const blocking = warnings.some(item => item.blocking);
  const leftDraft = leftDetail.data?.memberId === leftId ? leftDetail.data?.draft : undefined;
  const rightDraft = rightDetail.data?.memberId === rightId ? rightDetail.data?.draft : undefined;
  const compat = useMemo(() => leftDraft && rightDraft ? memberMatch(leftDraft, rightDraft) : null, [leftDraft, rightDraft]);
  const sharedNote = useMemo(() => leftDraft && rightDraft ? draftNote(leftDraft, rightDraft) : null, [leftDraft, rightDraft]);
  const pickLeft = (id: string) => { setLeftId(id); setRightId(null); setMessage(""); revealOnNarrow("match-right"); };
  const pickRight = (id: string) => { setRightId(id); setSendCompat(true); setMessage(""); revealOnNarrow("match-right"); };
  const swap = () => { setLeftId(rightId); setRightId(leftId); };
  const reserve = () => run("reserve", async () => {
    const match = sendCompat && compat ? compat : null;
    const { error } = await rpc("admin_reserve_introduction", { p_a: leftId, p_b: rightId, p_date: date, p_note: note, p_match: match });
    setMessage(error || `${left?.name} · ${right?.name} · ${kstDay(`${date}T12:00:00+09:00`)} 정오 공개로 예약했어요. ${match ? `회원에게 보일 궁합도 함께 보냈어요(${match.score >= MATCH_SCORE_SHOWN ? `${match.score}점` : "숫자 없이 이유만"} · ${match.headline})` : "궁합은 보내지 않았어요."}`);
    if (!error) { setLeftId(null); setRightId(null); setNote(""); setSendCompat(true); await ready.reload(); await onReserved(); }
  });
  const filtered = members.filter(member => (!gender || member.gender === gender) && (!search.trim() || (member.name ?? "").includes(search.trim())));
  const focusMissing = focus && ready.data && !members.some(member => member.member_id === focus);
  return <div className="space-y-5">
    {focusMissing && <Notice text="찾는 회원은 지금 소개 가능 목록에 없어요(쉬는 중이거나 소개·교류 중, 또는 승인 전)." />}
    {ready.error && <Notice text={ready.error} />}
    <div className="grid gap-5 lg:grid-cols-2">
      {left ? <Side member={left} side="왼쪽" date={date} detail={leftDetail} onClear={() => { setLeftId(null); setRightId(null); }} /> : <section className={`${box} overflow-hidden`} aria-label="소개할 회원 고르기">
        <div className="space-y-2 border-b border-border p-4"><h2 className="text-sm font-semibold">먼저 한 분을 골라 주세요</h2><div className="flex flex-wrap gap-2"><Input aria-label="이름으로 찾기" value={search} onChange={event => setSearch(event.target.value)} placeholder="이름" className="h-8 max-w-40 text-xs" />{(["", "여성", "남성"] as const).map(value => <Button key={value || "all"} size="sm" variant={gender === value ? "default" : "outline"} className="h-8 text-xs" onClick={() => setGender(value)}>{value || "모두"}</Button>)}</div><p className="text-[11px] text-muted-foreground">승인된 회원 중 진행 중인 소개가 없는 분이에요. 방금 마무리한 분, 오래 기다린 분이 위에 있어요.</p></div>
        <div className="max-h-[640px] divide-y divide-border overflow-y-auto">{filtered.length ? filtered.map(member => <button key={member.member_id} type="button" onClick={() => pickLeft(member.member_id)} className="block w-full px-4 py-3 text-left text-sm hover:bg-secondary"><span className="font-semibold">{member.name ?? "이름 없음"}</span><MemberFlags member={member} date={date} /><span className="mt-1 block text-xs text-muted-foreground">{memberLine(member)} · {member.purpose ?? "-"} · 소개 {member.introductions}번</span></button>) : <p className="p-5 text-sm text-muted-foreground">{ready.loading ? "불러오고 있어요." : "지금 소개할 수 있는 회원이 없어요."}</p>}</div>
      </section>}
      <div id="match-right" className="scroll-mt-24">
        {!left ? <p className={`${box} p-5 text-sm text-muted-foreground`}>왼쪽에서 한 분을 고르면, 자동 필터가 다시 소개하지 않는 분(서로 선택·넘김·답 없음·차단·신고)과 아는 사람 피하기·성별·필수 조건이 맞지 않는 분을 까닭과 함께 거르고, 나머지를 잘 맞는 순서로 보여 드려요.</p>
          : right ? <Side member={right} side="오른쪽" date={date} detail={rightDetail} onClear={() => setRightId(null)} />
          : <section className={`${box} overflow-hidden`} aria-label={`${left.name}님과 맞는 분`}>
            <div className="border-b border-border p-4"><h2 className="text-sm font-semibold">{left.name}님과 잘 맞는 분 · {pool?.candidates.length ?? 0}명</h2><p className="mt-1 text-[11px] leading-5 text-muted-foreground">규칙 점수 순이에요(예약할 수 없는 분은 아래로). 노랑 안내가 있는 분은 예전 소개가 있지만 다시 소개할 수 있는 분이에요.</p></div>
            {history.error && <p role="status" className="border-b border-border bg-[#F8E5A6]/40 px-4 py-2 text-[11px] leading-5">소개 기록을 불러오지 못했어요({history.error}). 이전 소개·차단 목록으로만 걸렀고, 예약할 때 서버가 한 번 더 확인해요.</p>}
            {pool && <AutoFilter filtered={pool.filtered} otherGender={pool.otherGender} />}
            <div className="max-h-[640px] divide-y divide-border overflow-y-auto">{pool?.candidates.length ? pool.candidates.map(({ member, fit: score, reservable, note: again }) => <button key={member.member_id} type="button" onClick={() => pickRight(member.member_id)} className={`flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-secondary ${reservable ? "" : "opacity-70"}`}>
              <span className={`w-10 shrink-0 text-right text-xl font-light tabular-nums ${scoreTone(score.score)}`}>{score.score}</span>
              <span className="min-w-0"><span className="font-semibold">{member.name ?? "이름 없음"}</span><MemberFlags member={member} date={date} />{!reservable && <span className="ml-2"><Pill tone="danger">지금 예약 불가</Pill></span>}<span className="mt-1 block text-xs text-muted-foreground">{memberLine(member)} · {member.purpose ?? "-"}</span><span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">{score.violations[0] ?? score.reasons[0] ?? ""}{score.cautions[0] ? ` · 주의: ${score.cautions[0]}` : ""}</span>{again && <span className="mt-1 block w-fit rounded-md bg-[#F8E5A6]/70 px-2 py-0.5 text-[11px] leading-5 text-[#5A4310]">{again}</span>}</span>
            </button>) : <p className="p-5 text-sm text-muted-foreground">{pool ? "조건에 맞는 분이 지금은 없어요." : "소개 기록을 확인하고 있어요."}</p>}</div>
          </section>}
      </div>
    </div>
    {left && right && fit && <>
      <div className="flex justify-center"><Button size="sm" variant="ghost" onClick={swap}>좌우 바꾸기(오른쪽 분 기준으로 후보 보기)</Button></div>
      <Compat key={`${left.member_id}-${right.member_id}`} left={left} right={right} fit={fit} note={sharedNote} onUseNote={value => setNote(value.slice(0, 300))} />
      <section className={`${box} space-y-4 p-5`} aria-label="정오 소개 예약">
        <h2 className="text-sm font-semibold">정오 소개 예약 · {left.name} · {right.name}</h2>
        {warnings.map(item => <p key={item.text} role={item.blocking ? "alert" : undefined} className={`text-xs leading-5 ${item.blocking ? "text-destructive" : "text-accent"}`}>{item.blocking ? "예약 불가 · " : "확인 · "}{item.text}</p>)}
        <div className="grid gap-4 md:grid-cols-[200px_1fr]">
          <label className="block text-xs">공개 날짜(그날 12:00)<Input type="date" value={date} min={nextNoonDate()} onChange={event => setDate(event.target.value)} className="mt-1" /></label>
          <label className="block text-xs">두 분에게 함께 보일 소개 이유<Textarea value={note} maxLength={300} onChange={event => setNote(event.target.value)} placeholder="예: 두 분 모두 천천히 알아가는 연애를 원하셨고, 주말 산책을 좋아하셨어요." className="mt-1 min-h-24" /></label>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">공개 동의한 항목만 상대에게 보여요. 외모 평가나 점수, 비공개 항목은 소개 이유에 쓰지 않아요. {note.trim().length}/300자 · 10자 이상</p>
        <MemberMatchPreview match={compat} waiting={leftDetail.loading || rightDetail.loading} error={leftDetail.error || rightDetail.error} send={sendCompat} onSend={setSendCompat} />
        <Button disabled={blocking || note.trim().length < 10 || busy === "reserve"} onClick={() => void reserve()}>{busy === "reserve" ? "예약하고 있어요" : "예약하기"}</Button>
      </section>
    </>}
    <Notice text={message} />
  </div>;
}
