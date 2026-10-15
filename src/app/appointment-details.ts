export const APPOINTMENT_ACTIVITIES = ["카페·디저트", "식사·맛집", "전시·미술관", "산책·공원", "서점·책방", "공연·문화", "공방·체험", "가벼운 액티비티", "직접 정할게요"];
export const EXAMPLE_SPACES = [{ id: "space-a", label: "공간 A · 예시" }, { id: "space-b", label: "공간 B · 예시" }];
export const VERIFIED_SPACES: { id: string; label: string }[] = [];
export const QUICK_TIMES = [{ label: "오전", start: "09:00", end: "11:00" }, { label: "점심", start: "12:00", end: "14:00" }, { label: "오후", start: "14:00", end: "17:00" }, { label: "저녁", start: "18:00", end: "21:00" }];
export type CandidateTime = { date: string; start: string; end: string };
export type AppointmentDetails = {
  slots: CandidateTime[];
  activity: string;
  customActivity: string;
  regions: string[];
  budget: number | null;
  environment: "" | "indoor" | "outdoor" | "either";
  duration: number | null;
  place: { kind: "example" | "direct" | "verified"; id: string; label: string };
  basis: "direct" | "common";
};
export type Availability = { slots: CandidateTime[]; activities: string[]; regions: string[] };
export const emptyAppointmentDetails = (): AppointmentDetails => ({ slots: [{ date: "", start: "", end: "" }], activity: "", customActivity: "", regions: [], budget: null, environment: "", duration: null, place: { kind: "example", id: "", label: "" }, basis: "direct" });
export const emptyAvailability = (): Availability => ({ slots: [{ date: "", start: "", end: "" }], activities: [], regions: [] });
const record = (value: unknown): value is Record<string,unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown, maximum: number, length: number): value is string[] => Array.isArray(value) && value.length <= maximum && value.every(item => typeof item === "string" && item.length <= length);
const slotShape = (value: unknown, maximum: number): value is CandidateTime[] => Array.isArray(value) && value.length > 0 && value.length <= maximum && value.every(slot => record(slot) && typeof slot.date === "string" && slot.date.length <= 10 && typeof slot.start === "string" && slot.start.length <= 5 && typeof slot.end === "string" && slot.end.length <= 5);
export function detailsShape(value: unknown): value is AppointmentDetails {
  return record(value) && slotShape(value.slots,3) && typeof value.activity === "string" && value.activity.length <= 40 && typeof value.customActivity === "string" && value.customActivity.length <= 80 && strings(value.regions,3,40) && (value.budget === null || typeof value.budget === "number" && Number.isFinite(value.budget)) && (value.duration === null || typeof value.duration === "number" && Number.isFinite(value.duration)) && typeof value.environment === "string" && ["","indoor","outdoor","either"].includes(value.environment) && record(value.place) && typeof value.place.id === "string" && value.place.id.length <= 80 && typeof value.place.label === "string" && value.place.label.length <= 160 && ["example","direct","verified"].includes(String(value.place.kind)) && ["direct","common"].includes(String(value.basis));
}
export function availabilityShape(value: unknown): value is Availability {
  return record(value) && slotShape(value.slots,5) && strings(value.activities,3,40) && strings(value.regions,3,40);
}
export const copyAvailability = (value: Availability): Availability => ({ slots: value.slots.map(slot => ({ date: slot.date,start: slot.start,end:slot.end })), activities: [...value.activities], regions: value.regions.map(region => region.trim()) });
export const copyDetails = (value: AppointmentDetails): AppointmentDetails => ({ slots: value.slots.map(slot => ({ date:slot.date,start:slot.start,end:slot.end })), activity:value.activity,customActivity:value.customActivity,regions:value.regions.map(region => region.trim()),budget:value.budget,environment:value.environment,duration:value.duration,place:{kind:value.place.kind,id:value.place.id,label:value.place.label},basis:value.basis });
export const slotKey = (slot: CandidateTime) => `${slot.date}|${slot.start}|${slot.end}`;
export const slotStart = (slot: CandidateTime) => `${slot.date}T${slot.start}:00+09:00`;
const minutes = (time: string) => Number(time.slice(0,2)) * 60 + Number(time.slice(3));
const asTime = (value: number) => `${Math.floor(value / 60).toString().padStart(2,"0")}:${(value % 60).toString().padStart(2,"0")}`;
const validTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00+09:00`)) && new Date(Date.parse(`${date}T00:00:00+09:00`) + 9 * 3600000).toISOString().slice(0,10) === date;
const regionText = (value: string) => typeof value === "string" && !!value.trim() && value.length <= 40 && !/\d{1,3}\.\d{3,}\s*[,/]\s*-?\d{1,3}\.\d{3,}|\d+\s*(?:동\s*\d+\s*호|번지)|(?:집|직장)\s*주소/.test(value);
const unique = (values: string[]) => new Set(values.map(value => value.trim())).size === values.length;
export function slotsError(slots: CandidateTime[], maximum: number, now: Date) {
  if (!Array.isArray(slots) || !slots.length || slots.length > maximum || !unique(slots.map(slot => slot.date))) return `서로 다른 날짜를 1~${maximum}개 입력해 주세요.`;
  if (slots.some(slot => !validDate(slot.date) || !validTime(slot.start) || !validTime(slot.end) || minutes(slot.start) >= minutes(slot.end) || Date.parse(slotStart(slot)) <= now.getTime())) return "과거 날짜·이미 지난 시작시간은 제안할 수 없어요. 날짜와 시작~종료 순서를 확인해 주세요.";
  return null;
}
export function availabilityError(value: Availability, now: Date) {
  if (!availabilityShape(value)) return "가능 조건의 형식과 날짜·활동·지역 선택 개수를 확인해 주세요.";
  return slotsError(value.slots,5,now) || (!value.activities.length || value.activities.length > 3 || !unique(value.activities) || !value.activities.every(activity => APPOINTMENT_ACTIVITIES.includes(activity)) ? "활동을 1~3개 선택해 주세요." : null) || (!value.regions.length || value.regions.length > 3 || !unique(value.regions) || !value.regions.every(regionText) ? "넓은 지역·역을 1~3개 입력해 주세요. 주소·GPS는 입력하지 않아요." : null);
}
export function intersectAvailability(left: Availability | null, right: Availability | null, now?: Date) {
  if (!left || !right) return { slots: [] as CandidateTime[], activities: [] as string[], regions: [] as string[], ready: false };
  const slots: CandidateTime[] = [];
  for (const a of left.slots) for (const b of right.slots) if (a.date === b.date && validTime(a.start) && validTime(a.end) && validTime(b.start) && validTime(b.end)) {
    const start = Math.max(minutes(a.start),minutes(b.start)), end = Math.min(minutes(a.end),minutes(b.end));
    if (start < end && (!now || Date.parse(`${a.date}T${asTime(start)}:00+09:00`) > now.getTime())) slots.push({ date: a.date, start: asTime(start), end: asTime(end) });
  }
  const activities = left.activities.filter(activity => right.activities.includes(activity));
  const regions = left.regions.filter(region => right.regions.some(other => other.trim() === region.trim()));
  return { slots, activities, regions, ready: !!slots.length && !!activities.length && !!regions.length };
}
export function detailsError(details: AppointmentDetails, now: Date) {
  if (!detailsShape(details)) return "약속안 필드 형식과 후보 개수를 확인해 주세요.";
  const slots = slotsError(details.slots,3,now); if (slots) return slots;
  if (!APPOINTMENT_ACTIVITIES.includes(details.activity) || (details.activity === "직접 정할게요" && (!details.customActivity.trim() || details.customActivity.length > 80))) return "활동을 선택하고 직접 정할 경우 짧게 설명해 주세요.";
  if (!details.regions.length || details.regions.length > 3 || !unique(details.regions) || !details.regions.every(regionText)) return "넓은 지역·역을 1~3개 입력해 주세요. 집·직장 주소·GPS는 입력하지 않아요.";
  if (!Number.isSafeInteger(details.budget) || details.budget! < 0 || !Number.isSafeInteger(details.duration) || details.duration! < 1 || !["indoor","outdoor","either"].includes(details.environment)) return "1인 예상비용·예상 만남 길이·실내/야외를 확인해 주세요.";
  if (details.slots.some(slot => minutes(slot.end) - minutes(slot.start) < details.duration!)) return "예상 만남 길이가 후보 시간구간보다 길어요.";
  if (details.place.kind === "example" && !EXAMPLE_SPACES.some(space => space.id === details.place.id && space.label === details.place.label)) return "공간 A/B는 예시예요. 예시 후보를 직접 선택해 주세요.";
  if (details.place.kind === "verified" && !VERIFIED_SPACES.some(space => space.id === details.place.id && space.label === details.place.label)) return "현재 확인된 장소 데이터가 없어요. 예시 또는 직접 장소 제안을 사용해 주세요.";
  if (details.place.kind === "direct" && (!details.place.label.trim() || details.place.label.length > 160)) return "직접 제안할 장소 이름을 입력해 주세요.";
  if (!["example","verified","direct"].includes(details.place.kind) || !["direct","common"].includes(details.basis)) return "장소 유형·제안 기준을 확인해 주세요.";
  return null;
}
export function matchesCommon(details: AppointmentDetails, common: ReturnType<typeof intersectAvailability>) {
  return common.ready && details.slots.every(slot => common.slots.some(shared => slot.date === shared.date && minutes(slot.start) >= minutes(shared.start) && minutes(slot.end) <= minutes(shared.end))) && common.activities.includes(details.activity) && details.regions.every(region => common.regions.includes(region));
}
export function draftSafe(value: unknown) {
  try { const encoded = JSON.stringify(value); return typeof encoded === "string" && encoded.length <= 8000; } catch { return false; }
}
export function changedDetailFields(before: AppointmentDetails | null | undefined, after: AppointmentDetails | null | undefined) {
  if (!before || !after) return [];
  const changes: string[] = [];
  if (JSON.stringify(before.slots.map(slot => slot.date)) !== JSON.stringify(after.slots.map(slot => slot.date))) changes.push("날짜");
  if (JSON.stringify(before.slots.map(slot => [slot.start,slot.end])) !== JSON.stringify(after.slots.map(slot => [slot.start,slot.end]))) changes.push("시간");
  if (before.activity !== after.activity || before.customActivity !== after.customActivity) changes.push("활동");
  if (JSON.stringify(before.regions) !== JSON.stringify(after.regions)) changes.push("지역");
  if (before.budget !== after.budget) changes.push("1인 예상비용");
  if (before.environment !== after.environment) changes.push("실내·야외");
  if (before.duration !== after.duration) changes.push("예상 만남 길이");
  if (JSON.stringify(before.place) !== JSON.stringify(after.place)) changes.push("장소");
  return changes;
}
