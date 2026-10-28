import { useEffect, useRef, useState } from "react";
import { friendlyError, rpc } from "./backend/client";
import { APPLICATION_FIELDS } from "./application-model";
import { HEIGHT_CRITERION, PREFERENCE_FIELDS, compareRequiredPreference, type PreferenceValue } from "./preference-model";

// 운영진 화면이 같이 쓰는 도우미와 매칭 화면의 규칙 점수. 화면(JSX)은 AdminMatch.tsx에 둔다.
export const box = "rounded-lg border border-border bg-card";

export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const reload = async () => { try { setState({ data: await load(), error: null, loading: false }); } catch (error) { setState({ data: null, error: friendlyError(error as Error), loading: false }); } };
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

export type Fit = { score: number; reasons: string[]; cautions: string[]; violations: string[]; unsure: string[] };

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
    if (result === "불충족") { fit.violations.push(`${X}님의 필수 조건 ‘${prefLabel(id)}’에 ${Y}님이 맞지 않아요.`); add(-40); }
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
  const fit: Fit = { score: 0, reasons: [], cautions: [], violations: [], unsure: [] };
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

// 두 사람 사이의 예약 경고. blocking이 하나라도 있으면 예약 버튼을 막는다(서버도 같은 것을 막는다).
export type Warning = { text: string; blocking: boolean };
export function pairWarnings(a: ReadyMember, b: ReadyMember, date: string, fit?: Fit): Warning[] {
  const has = (owner: ReadyMember, key: "blocked" | "previous" | "avoided" | "held", other: ReadyMember) => (owner[key] ?? []).includes(other.member_id);
  const both = (key: "blocked" | "previous" | "avoided" | "held") => has(a, key, b) || has(b, key, a);
  const out: Warning[] = [];
  const push = (when: unknown, value: string, blocking = true) => { if (when) out.push({ text: value, blocking }); };
  push(!genderFit(a, b), [a, b].some(member => member.gender !== "여성" && member.gender !== "남성") ? "성별을 직접 확인해야 하는 분이 있어요. 신청서에서 먼저 확인해 주세요." : "서로 원하는 상대 성별이 맞지 않아요.");
  push(both("blocked"), "차단 관계예요.");
  push(both("avoided"), "아는 사람 피하기 관계예요.");
  push(both("held"), "예전 계정에서 차단 관계였던 두 사람으로 보여요.");
  push(both("previous"), "이미 소개한 적 있어요.");
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

// 왼쪽 회원에게 맞는 오른쪽 후보: 서로 원하는 성별이고 차단·이전 소개·피하기·예전 차단 관계가 아닌 분을 점수 순으로.
export type Candidate = { member: ReadyMember; fit: Fit; reservable: boolean };
export function candidatesFor(left: ReadyMember, members: ReadyMember[], date: string) {
  const excluded = { gender: 0, blocked: 0, previous: 0, avoided: 0, held: 0 };
  const result: Candidate[] = [];
  for (const other of members) {
    if (other.member_id === left.member_id) continue;
    const has = (key: "blocked" | "previous" | "avoided" | "held") => (left[key] ?? []).includes(other.member_id) || (other[key] ?? []).includes(left.member_id);
    if (!genderFit(left, other)) { excluded.gender++; continue; }
    const reason = (["blocked", "avoided", "held", "previous"] as const).find(has);
    if (reason) { excluded[reason]++; continue; }
    const fit = fitScore(left, other);
    result.push({ member: other, fit, reservable: !pairWarnings(left, other, date, fit).some(item => item.blocking) });
  }
  result.sort((x, y) => Number(y.reservable) - Number(x.reservable) || y.fit.score - x.fit.score || (waitedDays(y.member.waiting_since) ?? -1) - (waitedDays(x.member.waiting_since) ?? -1));
  return { candidates: result, excluded };
}
