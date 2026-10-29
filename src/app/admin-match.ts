import { useEffect, useRef, useState } from "react";
import { friendlyError, rpc } from "./backend/client";
import { APPLICATION_FIELDS } from "./application-model";
import { HEIGHT_CRITERION, PREFERENCE_FIELDS, compareRequiredPreference, type PreferenceValue } from "./preference-model";
import { kstDay } from "./dates";

// 운영진 화면이 같이 쓰는 도우미와 매칭 화면의 규칙 점수. 화면(JSX)은 AdminMatch.tsx에 둔다.
export const box = "rounded-lg border border-border bg-card";

// 늦게 온 예전 응답이 새 응답을 덮지 않게, 마지막으로 부른 것만 반영한다(회원을 빠르게 바꿔 고를 때).
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const turn = useRef(0);
  const reload = async () => { const mine = ++turn.current; try { const data = await load(); if (mine === turn.current) setState({ data, error: null, loading: false }); } catch (error) { if (mine === turn.current) setState({ data: null, error: friendlyError(error as Error), loading: false }); } };
  useEffect(() => { setState(current => ({ ...current, loading: true })); void reload(); }, deps);
  return { ...state, reload };
}
export async function call<T>(name: string, args?: Record<string, unknown>) { const { data, error } = await rpc<T>(name, args); if (error) throw new Error(error); return data as T; }

// 버튼 두 번 누름 막기: 한 번에 한 작업만. ref로 같은 틱의 두 번째 클릭도 막는다.
export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);
  const run = async (key: string, task: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(key);
    try { await task(); } finally { lock.current = false; setBusy(null); }
  };
  return { busy, run };
}

// 좁은 화면(목록과 상세가 위아래로 쌓일 때)에서 고른 뒤 상세를 화면 안으로 끌어온다.
export function revealOnNarrow(id: string) {
  if (typeof window === "undefined" || !window.matchMedia("(max-width: 1023px)").matches) return;
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

// 새 소개를 기다린 날(기다리기 시작한 때가 아직 오지 않았으면 null = 기수 시작 전)
export const waitedDays = (since?: string | null) => { if (!since) return null; const days = Math.floor((Date.now() - Date.parse(since)) / 86400000); return days < 0 ? null : days; };

export type Preferences = { importance?: Record<string, string>; confidential?: Record<string, boolean>; request?: string; requestNote?: string };
export type MatchProfile = { values: Record<string, unknown>; preferences: Preferences };
export type ReadyMember = {
  member_id: string; name: string | null; gender: string | null; desired: string | null; age: number | null; province: string | null; area: string | null; purpose: string | null;
  last_published_at: string | null; introductions: number; blocked: string[]; previous: string[]; avoided?: string[]; released_at?: string | null; history?: string[]; waiting_since?: string | null;
  held?: string[]; photos_confirmed?: number; cohort?: number | null; cohort_starts_on?: string | null; profile?: MatchProfile;
};

const list = (value: unknown) => Array.isArray(value) ? value.map(String) : value === undefined || value === null || value === "" ? [] : [String(value)];
const text = (value: unknown) => typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
const nameOf = (member: ReadyMember) => member.name || "이름 없음";
export const prefLabel = (id: string) => PREFERENCE_FIELDS.find(field => field.id === id)?.label ?? APPLICATION_FIELDS.find(field => field.id === id)?.label ?? id;
const CAPITAL = ["서울", "경기", "인천"];

// 두 사람이 서로 원하는 상대 성별인지(성별 ‘직접 확인’ 상태면 맞지 않는 것으로 본다)
export function genderFit(a: Pick<ReadyMember, "gender" | "desired">, b: Pick<ReadyMember, "gender" | "desired">) {
  const known = (gender: string | null) => gender === "여성" || gender === "남성";
  return known(a.gender) && known(b.gender) && (a.desired === b.gender || a.desired === "선호 없음") && (b.desired === a.gender || b.desired === "선호 없음");
}

export type Fit = { score: number; reasons: string[]; cautions: string[]; violations: string[]; unsure: string[]; failed: string[] };

// 한쪽(x)이 바라는 것과 다른 쪽(y)의 실제 답을 견준다.
function wish(x: ReadyMember, y: ReadyMember, add: (points: number) => void, fit: Fit) {
  const values = (x.profile?.values ?? {}) as Record<string, PreferenceValue>;
  const own = y.profile?.values ?? {};
  const facts: Record<string, PreferenceValue | number | undefined> = { ...(own as Record<string, PreferenceValue>), "self.age": y.age ?? undefined, "self.province": y.province ?? undefined };
  const importance = x.profile?.preferences?.importance ?? {};
  const required = Object.keys(importance).filter(id => importance[id] === "required");
  const X = nameOf(x), Y = nameOf(y);
  // 필수 조건: 맞지 않으면 예약하지 않는다(크게 깎고 막는다).
  for (const id of required) {
    const result = compareRequiredPreference(id, values, facts);
    if (result === "불충족") { fit.violations.push(`${X}님의 필수 조건 ‘${prefLabel(id)}’에 ${Y}님이 맞지 않아요.`); fit.failed.push(`${X}님 ‘${prefLabel(id)}’`); add(-40); }
    else if (result === "확인 필요") fit.unsure.push(`${X}님의 필수 조건 ‘${prefLabel(id)}’은 직접 확인이 필요해요.`);
    else { fit.reasons.push(`${X}님의 필수 조건 ‘${prefLabel(id)}’을 충족해요.`); add(4); }
  }
  const soft = (id: string) => !required.includes(id);
  // 나이
  const min = Number(values["desired.ageMin"]), max = Number(values["desired.ageMax"]);
  if (soft("desired.ageMode") && values["desired.ageMode"] === "범위 지정" && Number.isFinite(min) && Number.isFinite(max) && min > 0 && y.age != null) {
    if (y.age >= min && y.age <= max) { fit.reasons.push(`${Y}님 나이가 ${X}님 희망 범위(만 ${min}~${max}세) 안이에요.`); add(6); }
    else { const gap = y.age < min ? min - y.age : y.age - max; fit.cautions.push(`${Y}님 나이가 ${X}님 희망 범위(만 ${min}~${max}세)에서 ${gap}살 벗어나요.`); add(-Math.min(15, gap * 4)); }
  }
  // 지역
  const regions = list(values["desired.regions"]).filter(item => item !== "선호 없음");
  if (soft("desired.regions") && regions.length && y.province) {
    if (regions.includes(y.province)) { fit.reasons.push(`${Y}님 지역(${y.province})이 ${X}님이 바라는 지역이에요.`); add(5); }
    else { fit.cautions.push(`${X}님은 ${regions.join("·")} 지역을 바랐어요(${Y}님 ${y.province}).`); add(-8); }
  }
  // 관계 목적
  const purpose = text(values["desired.purpose"]);
  if (soft("desired.purpose") && purpose && purpose !== "선호 없음" && y.purpose) {
    if (purpose === y.purpose) add(4);
    else { fit.cautions.push(`${X}님은 ‘${purpose}’를 바랐어요(${Y}님 ‘${y.purpose}’).`); add(-6); }
  }
  // 흡연·음주
  const smoking = text(values["desired.smoking"]), ySmoke = text(own["self.smoking"]);
  if (soft("desired.smoking") && smoking === "비흡연 선호" && ["가끔", "자주"].includes(ySmoke)) { fit.cautions.push(`${X}님은 비흡연을 바랐어요(${Y}님 흡연 ${ySmoke}).`); add(-8); }
  else if (soft("desired.smoking") && smoking === "가끔은 괜찮음" && ySmoke === "자주") { fit.cautions.push(`${X}님은 가끔 흡연까지 괜찮다고 했어요(${Y}님 자주).`); add(-5); }
  const drinking = text(values["desired.drinking"]), yDrink = text(own["self.drinking"]);
  if (drinking === "술자리 없이도 편한 사람" && yDrink === "주 1회 이상") { fit.cautions.push(`${X}님은 술자리 없이도 편한 사람을 바랐어요(${Y}님 음주 주 1회 이상).`); add(-4); }
  // 만날 수 있는 시간
  const schedule = list(values["desired.schedule"]), available = text(own["self.available"]);
  if (schedule.length && available && !schedule.includes("조율 가능") && available !== "일정에 따라") {
    if (schedule.includes(available)) add(3);
    else { fit.cautions.push(`${X}님이 바라는 시간(${schedule.join("·")})과 ${Y}님 편한 시간(${available})이 달라요.`); add(-3); }
  }
  // 상대에게 바라는 관심사
  const wanted = list(values["desired.interests"]).filter(item => list(own["self.interests"]).includes(item));
  if (wanted.length) { fit.reasons.push(`${X}님이 바란 관심사를 ${Y}님도 좋아해요(${wanted.join("·")}).`); add(Math.min(6, wanted.length * 2)); }
  // 키(필수가 아닐 때만 가볍게)
  if (soft(HEIGHT_CRITERION) && values[HEIGHT_CRITERION] === "범위 지정") {
    const result = compareRequiredPreference(HEIGHT_CRITERION, values, facts);
    if (result === "불충족") { fit.cautions.push(`${Y}님 키가 ${X}님이 적은 범위 밖이에요.`); add(-4); }
  }
}

// 규칙 기반 궁합 점수(0~100)와 짧은 이유·주의. 필수 조건이 맞지 않으면 25점 아래로 묶는다.
export function fitScore(a: ReadyMember, b: ReadyMember): Fit {
  const fit: Fit = { score: 0, reasons: [], cautions: [], violations: [], unsure: [], failed: [] };
  let points = 55;
  const add = (value: number) => { points += value; };
  wish(a, b, add, fit);
  wish(b, a, add, fit);
  const va = a.profile?.values ?? {}, vb = b.profile?.values ?? {};
  // 생활권
  if (a.province && b.province) {
    if (a.province === b.province) { fit.reasons.push(`같은 지역에서 지내요(${a.province}).`); add(5); }
    else if (CAPITAL.includes(a.province) && CAPITAL.includes(b.province)) { fit.reasons.push(`둘 다 수도권이에요(${a.province}·${b.province}).`); add(3); }
    else {
      const near = [text(va["desired.travel"]), text(vb["desired.travel"])].includes("생활권 안에서");
      fit.cautions.push(`지역이 달라요(${a.province}·${b.province}). 만남 장소를 미리 생각해 주세요.`); add(near ? -8 : -5);
    }
  }
  // 관계 목적
  if (a.purpose && b.purpose) {
    if (a.purpose === b.purpose) { fit.reasons.push(`관계 목적이 같아요(${a.purpose}).`); add(5); }
    else if ([a.purpose, b.purpose].includes("진지한 연애") && [a.purpose, b.purpose].includes("아직 정리 중")) { fit.cautions.push("한 분은 진지한 연애, 한 분은 아직 정리 중이에요."); add(-5); }
  }
  // 함께 좋아하는 것
  const shared = list(va["self.interests"]).filter(item => list(vb["self.interests"]).includes(item));
  if (shared.length) { fit.reasons.push(`관심사가 겹쳐요(${shared.join("·")}).`); add(Math.min(12, shared.length * 3)); }
  const availableA = text(va["self.available"]), availableB = text(vb["self.available"]);
  if (availableA && availableA === availableB && availableA !== "일정에 따라") { fit.reasons.push(`편한 시간이 같아요(${availableA}).`); add(3); }
  const lifeA = text(va["self.schedule"]), lifeB = text(vb["self.schedule"]);
  if (lifeA && lifeB && lifeA !== lifeB && [lifeA, lifeB].some(item => item !== "주간" && item !== "답하지 않음")) fit.cautions.push(`생활 시간대가 달라요(${lifeA}·${lifeB}).`);
  // 나이 차(나이 범위를 적지 않았을 때만 가볍게)
  if (a.age != null && b.age != null && Math.abs(a.age - b.age) >= 8 && ![va["desired.ageMode"], vb["desired.ageMode"]].includes("범위 지정")) { fit.cautions.push(`나이 차이가 ${Math.abs(a.age - b.age)}살이에요.`); add(-3); }
  const score = Math.max(0, Math.min(100, Math.round(points)));
  return { ...fit, score: fit.violations.length ? Math.min(score, 25) : score };
}

// 궁합 분석(외부로 보내지 않고 이 화면에서 바로): 규칙 점수에 생활 습관·시간·소개 글의 결을 더해 한 줄 요약, 이유, 주의할 점, 소개 이유 초안을 만든다.
// 운영진 참고용 — 전문 분석이 아니라 두 소개서를 나란히 읽은 메모에 가깝다.
export type Insight = { score: number; summary: string; reasons: string[]; cautions: string[]; note: string };
// 받침에 맞는 조사(이/가, 과/와, 을/를)
const josa = (word: string, withFinal: string, without: string) => { const code = word.charCodeAt(word.length - 1) - 0xac00; return word + (code >= 0 && code <= 11171 && code % 28 ? withFinal : without); };
export function localInsight(a: ReadyMember, b: ReadyMember, fit: Fit): Insight {
  const va = a.profile?.values ?? {}, vb = b.profile?.values ?? {};
  const reasons: string[] = [], cautions: string[] = [];
  let score = fit.score;
  const same = (key: string, label: string, weight: number) => {
    const x = text(va[key]), y = text(vb[key]);
    if (!x || !y || x === "답하지 않음" || y === "답하지 않음") return;
    if (x === y) { reasons.push(`${josa(label, "이", "가")} 같아요(${x}).`); score += weight; } else { cautions.push(`${josa(label, "이", "가")} 달라요(${x} · ${y}).`); score -= Math.ceil(weight / 2); }
  };
  same("self.smoking", "흡연 습관", 4);
  same("self.drinking", "음주 습관", 3);
  same("self.schedule", "생활 시간대", 3);
  const interests = list(va["self.interests"]).filter(item => list(vb["self.interests"]).includes(item));
  if (interests.length) reasons.push(`함께 이야기할 거리가 있어요(${interests.join("·")}).`);
  else if (list(va["self.interests"]).length && list(vb["self.interests"]).length) cautions.push("겹치는 관심사가 없어요. 소개 글에서 이야깃거리를 찾아 주세요.");
  // 소개 글의 결: 길이가 비슷하면 편지 교류의 속도도 비슷할 가능성이 높다
  const bioA = text(va["self.bio"]).trim(), bioB = text(vb["self.bio"]).trim();
  if (bioA && bioB) {
    const ratio = Math.min(bioA.length, bioB.length) / Math.max(bioA.length, bioB.length);
    if (ratio >= 0.5) { reasons.push("소개 글의 길이와 결이 비슷해요. 편지 교류의 속도도 맞을 가능성이 높아요."); score += 2; }
    else cautions.push("한 분은 소개 글이 길고 한 분은 짧아요. 편지 길이 차이가 클 수 있어요.");
  }
  if (a.purpose && b.purpose && a.purpose !== b.purpose) cautions.push(`관계 목적이 조금 달라요(${a.purpose} · ${b.purpose}).`);
  score = fit.violations.length ? Math.min(score, 25) : Math.max(0, Math.min(100, score));
  const band = fit.violations.length ? "꼭 지킬 조건이 맞지 않아 소개를 권하지 않아요." : score >= 75 ? "생활과 관심사가 잘 맞는 편이라, 편하게 이야기를 시작할 수 있을 것 같아요." : score >= 60 ? "무난하게 잘 맞는 편이에요. 다른 부분은 교류에서 알아가면 돼요." : score >= 45 ? "맞는 점과 다른 점이 섞여 있어요. 주의할 점을 먼저 살펴 주세요." : "다른 점이 많아요. 다른 후보와도 견줘 보세요.";
  const together = interests.length ? `두 분 모두 ${interests.length > 1 ? `${josa(interests[0], "과", "와")} ${josa(interests[1], "을", "를")}` : josa(interests[0], "을", "를")} 좋아하셔서` : a.purpose && a.purpose === b.purpose ? `두 분 모두 ${josa(a.purpose, "을", "를")} 바라셔서` : "두 분의 이야기에서 닮은 결이 보여서";
  const time = text(va["self.available"]) && text(va["self.available"]) === text(vb["self.available"]) ? ` ${text(va["self.available"])}에 편하게 만날 수 있는 두 분이에요.` : "";
  return { score, summary: band, reasons: [...new Set([...fit.reasons.slice(0, 2), ...reasons])].slice(0, 4), cautions: [...new Set([...fit.violations, ...cautions, ...fit.cautions])].slice(0, 4), note: `${together} 소개해요.${time}` };
}

// ─────────────────────────────────────────────
// 두 사람 소개 기록(admin_pair_history): 왼쪽 회원과 소개·차단·신고로 얽힌 분마다 대표 소개 한 건과 다시 소개할 수 있는지.
// reason이 있으면 서버도 예약을 막는다. exception은 다시 소개할 수 있지만 운영진이 알아 둘 예외(운영 취소·정오 놓침·공개 직전 확인·공개 전 취소·아무도 열지 않은 무응답).
export type PairHistory = {
  other: string; name: string | null; count: number; blockedRelation: boolean; reported: boolean;
  introductionId: string | null; revealAt: string | null; status: string | null; endReason: string | null; mutual: boolean; declined: boolean;
  programStatus: string | null; programEnd: string | null; reason: string | null; exception: string | null;
};
const shortDay = (iso: string) => kstDay(iso).replace(/\s*\([^)]*\)$/, "");
const ENDED: Record<string, string> = { withdrawn: "탈퇴로 마무리", suspended: "이용 정지로 마무리", blocked: "차단으로 마무리" };
// 자동 필터에 보일 한 줄: "10월 20일 소개 · 서로 선택 후 교류 마무리 — 다시 소개하지 않아요"
export function historyText(h: PairHistory) {
  const when = h.revealAt ? `${shortDay(h.revealAt)} 소개 · ` : "";
  const stop = " — 다시 소개하지 않아요";
  switch (h.reason) {
    case "blocked": return `차단 관계${stop}`;
    case "reported": return `${when}신고 기록이 있어요${stop}`;
    case "mutual": return `${when}${h.programEnd === "completed" ? "서로 선택 후 만남까지 마무리" : h.status === "closed" || h.programStatus === "closed" ? "서로 선택 후 교류 마무리" : "서로 선택"}${stop}`;
    case "declined": return `${when}한 분이 넘김${stop}`;
    case "nonresponse": return `${when}열어 본 분이 답하지 않아 마감${stop}`;
    case "active": return `${when}지금 진행 중인 소개예요`;
    case "ended": return `${when}${ENDED[h.endReason ?? ""] ?? "공개 뒤 마무리"}${stop}`;
  }
  return exceptionNote(h) ?? `${when}소개 기록이 있어요`;
}
// 다시 소개할 수 있는 예외의 노랑 안내(막는 까닭이 있거나 예외가 없으면 null)
export function exceptionNote(h: PairHistory | null | undefined) {
  if (!h || h.reason || !h.exception) return null;
  const when = h.revealAt ? `${shortDay(h.revealAt)} 소개 · ` : "";
  if (["admin-cancel", "missed-window", "precheck"].includes(h.exception)) return `${when}예전 소개가 운영 사정으로 취소돼 다시 소개할 수 있어요`;
  if (h.exception === "unopened") return `${when}예전 소개는 한 분이 열어 보지 않은 채 마감돼 다시 소개할 수 있어요`;
  return `${when}예전 소개가 공개 전에 취소돼 다시 소개할 수 있어요`;
}

// 두 사람 사이의 예약 경고. blocking이 하나라도 있으면 예약 버튼을 막는다(서버도 같은 것을 막는다).
// past는 a(왼쪽) 기준 b와의 소개 기록(admin_pair_history 한 줄).
export type Warning = { text: string; blocking: boolean };
export function pairWarnings(a: ReadyMember, b: ReadyMember, date: string, fit?: Fit, past?: PairHistory | null): Warning[] {
  const has = (owner: ReadyMember, key: "blocked" | "previous" | "avoided" | "held", other: ReadyMember) => (owner[key] ?? []).includes(other.member_id);
  const both = (key: "blocked" | "previous" | "avoided" | "held") => has(a, key, b) || has(b, key, a);
  const out: Warning[] = [];
  const push = (when: unknown, value: string, blocking = true) => { if (when) out.push({ text: value, blocking }); };
  push(!genderFit(a, b), [a, b].some(member => member.gender !== "여성" && member.gender !== "남성") ? "성별을 직접 확인해야 하는 분이 있어요. 신청서에서 먼저 확인해 주세요." : "서로 원하는 상대 성별이 맞지 않아요.");
  push(both("blocked") || past?.reason === "blocked", "차단 관계예요.");
  push(both("avoided"), "아는 사람 피하기 관계예요.");
  push(both("held"), "예전 계정에서 차단 관계였던 두 사람으로 보여요.");
  if (past?.reason && past.reason !== "blocked") push(true, historyText(past));
  else push(!past?.reason && both("previous"), "이미 소개한 적 있어요.");
  const note = exceptionNote(past);
  push(note, note ?? "", false);
  for (const member of [a, b]) {
    push((member.photos_confirmed ?? 3) < 3, `${nameOf(member)}님 필수 사진 세 장의 기준 확인이 끝나지 않았어요(${member.photos_confirmed ?? 0}/3).`);
    push(member.cohort_starts_on && date < member.cohort_starts_on, `${nameOf(member)}님 기수 시작일(${member.cohort_starts_on}) 전 날짜예요.`);
    push(member.history?.length, `${nameOf(member)}님은 이전 계정 이력이 있어요. 신고·정지 기록을 먼저 확인해 주세요.`, false);
    const request = member.profile?.preferences;
    push(request?.request === "hold", `${nameOf(member)}님은 추가 기준이 맞는 분이 생길 때까지 보류를 요청했어요${request?.requestNote ? ` · ${request.requestNote}` : ""}.`, false);
    push(request?.request === "operator", `${nameOf(member)}님이 운영진에게 남긴 요청이 있어요${request?.requestNote ? ` · ${request.requestNote}` : ""}.`, false);
  }
  for (const violation of fit?.violations ?? []) out.push({ text: violation, blocking: true });
  return out;
}

// 왼쪽 회원에게 맞는 오른쪽 후보(자동 필터): 다시 소개하지 않는 분·필수 조건이 맞지 않는 분은 까닭과 함께 filtered로 빼고, 나머지를 점수 순으로.
// 찾는 성별이 아예 다른 분은 숫자만 센다(otherGender). 다시 소개할 수 있는 예외는 후보에 남기고 노랑 안내(note)를 붙인다.
export type Candidate = { member: ReadyMember; fit: Fit; reservable: boolean; note: string | null };
export type Filtered = { member: ReadyMember; reason: string };
export function candidatesFor(left: ReadyMember, members: ReadyMember[], date: string, history?: Map<string, PairHistory>) {
  const filtered: Filtered[] = [];
  const result: Candidate[] = [];
  let otherGender = 0;
  for (const other of members) {
    if (other.member_id === left.member_id) continue;
    const past = history?.get(other.member_id) ?? null;
    const has = (key: "blocked" | "previous" | "avoided" | "held") => (left[key] ?? []).includes(other.member_id) || (other[key] ?? []).includes(left.member_id);
    if (!genderFit(left, other)) {
      const unsure = [left, other].some(member => member.gender !== "여성" && member.gender !== "남성");
      if (!unsure && left.desired !== "선호 없음" && left.desired !== other.gender) { otherGender++; continue; }
      const wants = other.desired === "여성" || other.desired === "남성" ? `${nameOf(other)}님은 ${josa(other.desired, "을", "를")} 원해요` : `${nameOf(other)}님이 원하는 상대 성별을 신청서에서 확인해 주세요`;
      filtered.push({ member: other, reason: unsure ? "성별 직접 확인 필요 — 신청서에서 성별을 먼저 확인해 주세요" : `원하는 성별이 아님 — ${wants}` });
      continue;
    }
    if (has("blocked") || past?.reason === "blocked") { filtered.push({ member: other, reason: "차단 관계 — 다시 소개하지 않아요" }); continue; }
    if (has("avoided")) { filtered.push({ member: other, reason: "아는 사람 피하기 — 서로 소개하지 않아요" }); continue; }
    if (has("held")) { filtered.push({ member: other, reason: "예전 계정 차단 — 예전 계정에서 차단 관계였던 분으로 보여요" }); continue; }
    if (past?.reason) { filtered.push({ member: other, reason: historyText(past) }); continue; }
    if (has("previous")) { filtered.push({ member: other, reason: "이미 소개한 적 있어요 — 다시 소개하지 않아요" }); continue; }
    const fit = fitScore(left, other);
    if (fit.violations.length) { filtered.push({ member: other, reason: `필수 조건 불충족(${fit.failed.join(" · ")})` }); continue; }
    result.push({ member: other, fit, reservable: !pairWarnings(left, other, date, fit, past).some(item => item.blocking), note: exceptionNote(past) });
  }
  result.sort((x, y) => Number(y.reservable) - Number(x.reservable) || y.fit.score - x.fit.score || (waitedDays(y.member.waiting_since) ?? -1) - (waitedDays(x.member.waiting_since) ?? -1));
  return { candidates: result, filtered, otherGender };
}

// ─────────────────────────────────────────────
// 회원에게 보일 궁합(정오 공개 때부터 두 사람 화면에): 두 분 모두 ‘상대 공개’로 둔 항목만 쓴다.
// 비공개 답·바라는 상대(desired.*)·필수 조건·운영진 메모·키·MBTI는 읽지 않는다. 점수도 같은 공개 항목만으로 계산한다(fitScore·localInsight 재사용).
// 말투: 담백하고 깔끔한 해요체, 과장 없이 구체적으로, 점수 말고는 숫자를 쓰지 않는다. 이름 대신 ‘두 분’(두 분이 같은 글을 본다).
export type MemberMatch = { score: number; headline: string; why: string[]; together: string[] };
export type SharedDraft = { values?: Record<string, unknown>; sharing?: Record<string, boolean> };
export const MATCH_SCORE_SHOWN = 65; // 이 점수 아래는 회원에게 숫자 없이 이유만(서버 member_match도 같은 기준)
const PUBLIC_IDS = ["self.age", "self.province", "self.purpose", "self.bio", "self.traits", "self.daysOff", "self.relationshipValues", "self.smoking", "self.drinking", "self.schedule", "self.available", "self.interests", "self.work"];
const NO_ANSWER = new Set(["답하지 않음", "미선택", "기타", "잘 모르겠어요", "중요하지 않아요"]);
// 상대에게 실제로 보이는 값만(서버 public_profile과 같은 기준: 나이는 끄지 않았으면, 나머지는 켠 것만)
export function sharedValues(draft: SharedDraft) {
  const out: Record<string, unknown> = {};
  for (const id of PUBLIC_IDS) {
    const value = draft.values?.[id];
    const open = id === "self.age" ? draft.sharing?.[id] !== false : draft.sharing?.[id] === true;
    if (!open || value === undefined || value === null || value === "" || value === false) continue;
    if (Array.isArray(value)) { const kept = value.map(String).filter(item => !NO_ANSWER.has(item)); if (kept.length) out[id] = kept; }
    else if (!NO_ANSWER.has(String(value))) out[id] = value;
  }
  return out;
}
const asMember = (values: Record<string, unknown>): ReadyMember => ({
  member_id: "", name: null, gender: null, desired: null, age: typeof values["self.age"] === "number" ? values["self.age"] : null, province: text(values["self.province"]) || null, area: null,
  purpose: text(values["self.purpose"]) || null, last_published_at: null, introductions: 0, blocked: [], previous: [], profile: { values, preferences: {} },
});
// 따옴표로 묶은 말과 조사: ‘산책’과 ‘카페’를 / ‘산책’, ‘카페’, ‘음악’을
const particle = (word: string, withFinal: string, without: string) => { const code = word.charCodeAt(word.length - 1) - 0xac00; return code >= 0 && code <= 11171 && code % 28 ? withFinal : without; };
const quoteList = (items: string[], withFinal: string, without: string) => {
  const last = items[items.length - 1];
  const head = items.length === 2 ? `‘${items[0]}’${particle(items[0], "과", "와")} ` : items.slice(0, -1).map(item => `‘${item}’, `).join("");
  return `${head}‘${last}’${particle(last, withFinal, without)}`;
};
const PURPOSE_SAME: Record<string, string> = {
  "진지한 연애": "두 분 모두 진지한 연애를 바라요. 관계를 대하는 마음의 무게가 비슷해요.",
  "천천히 알아가며 연애": "두 분 모두 천천히 알아가는 연애를 바라요. 서두르지 않는 속도가 잘 맞아요.",
  "아직 정리 중": "두 분 모두 마음을 천천히 정리해 가는 중이에요. 부담 없이 알아가기 좋아요.",
};
const SCHEDULE_SAME: Record<string, string> = {
  "주간": "두 분 모두 낮 시간을 중심으로 생활해서, 하루의 리듬이 잘 맞아요.",
  "야간": "두 분 모두 밤 시간을 중심으로 생활해서, 하루의 리듬이 잘 맞아요.",
  "교대·불규칙": "두 분 모두 일정이 고정되지 않은 생활이라, 서로의 바쁜 날을 잘 이해할 수 있어요.",
};
const INTEREST_SCENE: Record<string, string> = {
  "산책": "함께 걷다 보면 대화가 자연스럽게 길어질 거예요.",
  "카페": "조용한 카페에서 오래 이야기 나누는 시간이 잘 어울려요.",
  "음악": "좋아하는 노래를 하나씩 나누며 서로의 취향을 알아가는 재미가 있을 거예요.",
  "영화": "같은 영화를 보고 감상을 나누는 시간이 즐거울 거예요.",
  "책": "읽은 책 이야기를 나누며 생각의 결을 알아갈 수 있어요.",
  "여행": "가 보고 싶은 곳 이야기만으로도 대화가 넉넉해질 거예요.",
  "운동": "함께 몸을 움직이는 시간이 서로에게 활기를 더해 줄 거예요.",
  "음식": "맛있는 곳을 함께 찾아가는 즐거움이 있을 거예요.",
  "요리": "좋아하는 음식 이야기로 편하게 마음을 열 수 있어요.",
  "전시": "전시를 보고 느낀 점을 나누는 시간이 잘 어울려요.",
  "공연": "공연을 함께 보고 여운을 나누기 좋은 사이가 될 거예요.",
  "사진": "같은 장면을 서로 다르게 담아 보는 재미가 있을 거예요.",
  "드라이브": "함께 떠나는 가벼운 드라이브가 편안한 대화의 시간이 될 거예요.",
  "반려동물": "반려동물 이야기로 마음이 금방 가까워질 거예요.",
  "게임": "함께 즐기는 놀이가 처음의 어색함을 덜어 줄 거예요.",
  "자연": "자연 속에서 보내는 느긋한 시간이 잘 어울려요.",
  "만들기·공예": "손으로 무언가를 함께 만드는 시간을 즐길 수 있어요.",
  "언어 공부": "배우는 것을 좋아하는 마음이 서로에게 좋은 자극이 될 거예요.",
};
const VALUE_SCENE: Record<string, string> = {
  "대화": "천천히 주고받는 글 속에서 서로를 깊이 알아갈 수 있을 거예요.",
  "유머": "함께 웃는 순간이 자주 찾아와, 처음의 긴장이 금방 풀릴 거예요.",
  "배려": "서로를 세심하게 챙기는 마음이 편안함으로 이어질 거예요.",
  "다정함": "다정한 말 한마디를 아끼지 않는 사이가 될 수 있어요.",
  "표현": "마음을 숨기지 않고 표현해서, 서로를 오해할 일이 적을 거예요.",
  "솔직함": "솔직하게 마음을 나눌 수 있어, 관계가 단단해질 거예요.",
  "신뢰": "조급하지 않게 믿음을 쌓아 가는 관계가 될 수 있어요.",
  "안정감": "서로에게 기대어 쉴 수 있는 편안한 관계가 될 수 있어요.",
  "생활 리듬": "비슷한 하루의 리듬 덕분에 함께하는 시간이 자연스러울 거예요.",
  "취향 공유": "좋아하는 것을 나누는 즐거움이 두 분을 가깝게 해 줄 거예요.",
  "서로의 시간 존중": "각자의 시간을 지켜 주면서도 가까워질 수 있는 사이예요.",
};
// 서로 다른 모습이 어우러지는 조합(한 분은 앞, 한 분은 뒤의 모습)
const TRAIT_PAIRS: [string[], string[], string][] = [
  [["잘 들어주는"], ["친해지면 말이 많은", "표현이 솔직한", "유머가 있는", "웃음이 많은"], "한 분은 잘 들어 주고 한 분은 이야기를 즐겁게 풀어내서, 대화가 편안하게 흘러갈 거예요."],
  [["계획적인"], ["즉흥적인"], "한 분의 계획과 한 분의 즉흥이 만나, 함께하는 시간이 든든하면서도 새로울 거예요."],
  [["차분한", "느긋한"], ["활동적인", "호기심이 많은"], "차분함과 활기가 만나, 서로에게 좋은 균형이 되어 줄 거예요."],
  [["낯을 조금 가리는"], ["다정한", "배려가 자연스러운", "잘 들어주는"], "천천히 마음을 여는 분과 다정하게 기다려 주는 분이라, 처음이 부담스럽지 않을 거예요."],
  [["섬세한"], ["다정한", "배려가 자연스러운", "책임감 있는"], "섬세한 마음을 알아보고 챙겨 주는 사이가 될 수 있어요."],
];
const FALLBACK_WHY = "운영진이 두 분의 소개서를 나란히 읽고, 이야기의 결이 잘 맞을 거라 생각했어요.";
const FALLBACK_TOGETHER = "서로 알아가고 싶다면, 사흘 동안 글을 주고받으며 서두르지 않고 서로의 속도를 알아갈 수 있어요.";

export function memberMatch(a: SharedDraft, b: SharedDraft): MemberMatch {
  const x = sharedValues(a), y = sharedValues(b);
  const pa = asMember(x), pb = asMember(y);
  const base = localInsight(pa, pb, fitScore(pa, pb)).score;
  const one = (id: string) => [text(x[id]), text(y[id])];
  const common = (id: string) => list(x[id]).filter(item => list(y[id]).includes(item));
  const why: [number, string][] = [], together: [number, string][] = []; // [무게, 문장]
  const kinds = new Set<string>();
  let bonus = 0;
  // 관계를 바라보는 속도
  const [purposeA, purposeB] = one("self.purpose");
  if (purposeA && purposeA === purposeB && PURPOSE_SAME[purposeA]) { why.push([10, PURPOSE_SAME[purposeA]]); kinds.add("purpose"); }
  else if (purposeA && purposeB && purposeA !== "아직 정리 중" && purposeB !== "아직 정리 중") { why.push([7, "두 분 모두 가볍지 않게, 차근차근 알아가는 관계를 바라요."]); kinds.add("purpose"); }
  // 좋아하는 것과 그것이 만드는 장면
  const interests = common("self.interests");
  if (interests.length) {
    why.push([8 + interests.length, `${quoteList(interests.slice(0, 3), "을", "를")} 두 분 모두 좋아해요. 첫 대화의 소재가 자연스럽게 생겨요.`]); kinds.add("interests");
    const scene = interests.map(item => INTEREST_SCENE[item]).find(Boolean);
    if (scene) together.push([8, scene]);
  }
  // 사람을 알아갈 때 소중히 여기는 것
  const values = common("self.relationshipValues");
  if (values.length) {
    why.push([8 + values.length, `사람을 알아갈 때 두 분 모두 ${quoteList(values.slice(0, 2), "을", "를")} 소중히 여겨요. 마음을 여는 방식이 닮았어요.`]); kinds.add("values");
    bonus += Math.min(6, values.length * 3);
    const scene = values.map(item => VALUE_SCENE[item]).find(Boolean);
    if (scene) together.push([9, scene]);
  }
  // 쉬는 날의 모습
  const daysOff = common("self.daysOff");
  if (daysOff.length) { why.push([6 + daysOff.length, `쉬는 날 ${quoteList(daysOff.slice(0, 2), "을", "를")} 즐기는 모습이 닮았어요.`]); bonus += Math.min(4, daysOff.length * 2); }
  // 나를 설명하는 모습: 서로 다른 모습이 어우러지는 조합, 같은 모습
  const traitsA = list(x["self.traits"]), traitsB = list(y["self.traits"]);
  const fits = (first: string[], second: string[]) => first.some(item => traitsA.includes(item)) && second.some(item => traitsB.includes(item));
  const complement = TRAIT_PAIRS.find(([first, second]) => fits(first, second) || fits(second, first));
  if (complement) { together.push([10, complement[2]]); kinds.add("complement"); bonus += 3; }
  const sameTraits = traitsA.filter(item => traitsB.includes(item));
  if (sameTraits.includes("혼자만의 시간도 중요한")) together.push([7, "두 분 모두 혼자만의 시간도 소중히 여겨서, 서로에게 편안한 거리를 지켜 줄 수 있어요."]);
  const plainSame = sameTraits.filter(item => item !== "혼자만의 시간도 중요한");
  if (plainSame.length) { why.push([7, `두 분 모두 자신을 ${plainSame.slice(0, 2).map(item => `‘${item}’`).join(", ")} 사람이라고 소개했어요. 대화의 온도가 비슷할 거예요.`]); bonus += 2; }
  // 생활 습관(두 분 모두 공개했을 때만)
  const [smokeA, smokeB] = one("self.smoking");
  if (smokeA === "안 함" && smokeB === "안 함") why.push([5, "두 분 모두 담배를 피우지 않아, 생활 습관이 잘 맞아요."]);
  const [drinkA, drinkB] = one("self.drinking");
  if (drinkA && drinkA === drinkB) {
    if (drinkA === "안 함") together.push([5, "두 분 모두 술 없이도 편한 만남을 좋아해서, 카페나 산책처럼 차분한 시간이 잘 어울려요."]);
    else why.push([4, "술자리를 대하는 생각이 비슷해서, 만남의 분위기를 맞추기 쉬워요."]);
  }
  const [lifeA, lifeB] = one("self.schedule");
  if (lifeA && lifeA === lifeB && SCHEDULE_SAME[lifeA]) why.push([5, SCHEDULE_SAME[lifeA]]);
  const [timeA, timeB] = one("self.available");
  if (timeA && timeA === timeB && timeA !== "일정에 따라") together.push([6, `두 분 모두 ${josa(timeA, "이", "가")} 편해서, 만날 날을 정하기 수월해요.`]);
  // 생활권
  const [placeA, placeB] = one("self.province");
  if (placeA && placeA === placeB) together.push([6, `두 분 모두 ${placeA}에서 지내, 오가는 길이 가볍고 만날 곳을 정하기도 편해요.`]);
  else if (placeA && placeB && CAPITAL.includes(placeA) && CAPITAL.includes(placeB)) together.push([4, "두 분 모두 수도권에서 지내, 오가기 편한 거리예요."]);
  // 하는 일
  const [workA, workB] = one("self.work");
  if (workA && workB) together.push(workA === workB
    ? [4, workA === "학생·취업 준비" ? "비슷한 시기를 지나고 있어, 서로의 고민을 잘 이해할 수 있어요." : "하는 일의 분야가 같아, 서로의 하루를 깊이 이해할 수 있어요."]
    : [3, "서로 다른 분야에서 일하고 있어, 나눌 수 있는 이야기의 폭이 넓어요."]);
  // 소개 글의 결
  const bioA = text(x["self.bio"]).trim(), bioB = text(y["self.bio"]).trim();
  if (bioA && bioB && Math.min(bioA.length, bioB.length) / Math.max(bioA.length, bioB.length) >= 0.5) why.push([3, "소개 글에 담긴 말의 길이와 결이 닮아, 글을 주고받는 호흡도 잘 맞을 거예요."]);
  // 고르기: 무거운 것부터 ‘왜 어울리는지’ 2개 + ‘함께일 때 빛나는 점’ 2개(모자라면 다른 쪽에서 3개까지), 그래도 모자라면 드러내는 것 없는 기본 문장
  const top = (items: [number, string][], n: number) => [...new Set([...items].sort((p, q) => q[0] - p[0]).map(([, line]) => line))].slice(0, n);
  let togetherOut = top(together, 2);
  const whyOut = top(why, togetherOut.length < 2 ? 3 : 2);
  if (whyOut.length < 2) togetherOut = top(together, 3);
  if (!whyOut.length) whyOut.push(FALLBACK_WHY);
  if (!togetherOut.length) togetherOut = [FALLBACK_TOGETHER];
  if (whyOut.length + togetherOut.length < 3) { if (!whyOut.includes(FALLBACK_WHY)) whyOut.push(FALLBACK_WHY); else togetherOut.push(FALLBACK_TOGETHER); }
  const score = Math.max(0, Math.min(94, Math.round(base + bonus))); // 과장하지 않게 위를 조금 남겨 둔다
  const headline = kinds.has("purpose") && kinds.has("interests") && score >= 80 ? "생활의 결도, 관계를 바라보는 속도도 닮은 두 분이에요."
    : kinds.has("purpose") && kinds.has("complement") ? "같은 곳을 바라보면서도, 서로 다른 결이 잘 어우러지는 두 분이에요."
    : kinds.has("purpose") ? "관계를 바라보는 속도가 닮은 두 분이에요."
    : interests.length >= 2 ? "좋아하는 것이 닮아, 이야기가 자연스럽게 이어질 두 분이에요."
    : kinds.has("values") ? "관계에서 소중히 여기는 것이 닮은 두 분이에요."
    : kinds.has("complement") ? "서로의 다른 점이 편안하게 어우러지는 두 분이에요."
    : "천천히 알아갈수록 편안해질 두 분이에요.";
  return { score, headline, why: whyOut, together: togetherOut };
}

// 소개 이유 초안(두 분에게 함께 보이는 글): 두 분 모두 공개한 항목만으로 만든다(비공개 관심사·시간이 새지 않게).
const NOTE_PURPOSE: Record<string, string> = { "진지한 연애": "진지한 연애를 바라셔서", "천천히 알아가며 연애": "천천히 알아가는 연애를 바라셔서" };
export function draftNote(a: SharedDraft, b: SharedDraft) {
  const x = sharedValues(a), y = sharedValues(b);
  const interests = list(x["self.interests"]).filter(item => list(y["self.interests"]).includes(item));
  const purpose = text(x["self.purpose"]) && text(x["self.purpose"]) === text(y["self.purpose"]) ? NOTE_PURPOSE[text(x["self.purpose"])] : undefined;
  const together = interests.length ? `두 분 모두 ${interests.length > 1 ? `${josa(interests[0], "과", "와")} ${josa(interests[1], "을", "를")}` : josa(interests[0], "을", "를")} 좋아하셔서` : purpose ? `두 분 모두 ${purpose}` : "두 분의 이야기에서 닮은 결이 보여서";
  const time = text(x["self.available"]) && text(x["self.available"]) === text(y["self.available"]) && text(x["self.available"]) !== "일정에 따라" ? ` ${text(x["self.available"])}에 편하게 만날 수 있는 두 분이에요.` : "";
  return `${together} 소개해요.${time}`;
}
