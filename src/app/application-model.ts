import { useSyncExternalStore } from "react";
import { BEFORE_US } from "./config";
import { EXPRESSION_FIELDS, validateRelationshipPreferences } from "./personality-fields";
import { BASE_PUBLIC_FIELDS, PUBLIC_FIELD_IDS, REQUIRED_PUBLIC_PHOTOS, REVIEW_CONSENTS, cloneReview, emptyReview, type ReviewState } from "./review-state";
import { PREFERENCE_FIELDS, clonePreferences, emptyPreferences, validatePreferences, type PreferenceSettings } from "./preference-model";
import { PHOTO_SLOTS, clonePhotos, emptyPhotos, photoError, type ApplicationPhotos, type PhotoSlotId } from "./photo-model";

export const APPLICATION_STEPS = ["나에 대해", "사진", "원하는 만남", "공개·동의 확인"] as const;
export type AnswerValue = string | string[] | boolean;
export type AccountFacts = { verifiedBirthDate?: string; verifiedAge?: number; verifiedAt?: string };
export const PUBLIC_AGE_FIELD = { id: "self.age", label: "만 나이", format: "derived-number", purpose: "기존 인증값 또는 자기 입력값에서 계산 · 생년월일 원값은 공개하지 않음", required: false, scope: "partner", rule: "calculated-age-only" } as const;
type FieldDefinition = {
  id: string; label: string; step: number; group: "core" | "optional" | "consent";
  format: "text" | "date" | "number" | "single" | "multi" | "boolean" | "photo";
  purpose: string; required: boolean; scope: "private" | "operator" | "partner";
  options?: readonly string[]; min?: number; max?: number; limit?: number;
  placeholder?: string; rule?: "no-contact" | "adult-draft" | "broad-area" | "positive-cm" | "three-required-unique-files-and-self-confirmation" | "optional-file-and-self-confirmation";
  alsoOn?: number;
  section?: "expression" | "relationship";
};
export const APPLICATION_FIELDS: readonly FieldDefinition[] = [
  { id: "self.name", label: "활동용 이름", step: 0, group: "core", format: "text", purpose: "소개에서 사용할 이름", required: true, scope: "partner", min: 2, max: 12, rule: "no-contact", placeholder: "가상 활동용 이름" },
  { id: "self.birthDate", label: "생년월일 · 가상 정보만", step: 0, group: "core", format: "date", purpose: "만 나이 계산 · 원값은 상대 비공개", required: true, scope: "private", rule: "adult-draft" },
  { id: "self.gender", label: "본인 성별", step: 0, group: "core", format: "single", purpose: "본인이 직접 확인한 소개 정보", required: true, scope: "operator", options: ["여성", "남성", "직접 확인이 필요해요"] },
  { id: "desired.gender", label: "소개받을 상대", step: 0, alsoOn: 2, group: "core", format: "single", purpose: "본인이 확인한 상대 조건 · 나의 성별과 별도 저장", required: true, scope: "operator", options: ["여성", "남성", "선호 없음", "직접 확인이 필요해요"] },
  { id: "self.province", label: "주 활동 지역 · 시·도", step: 0, group: "core", format: "single", purpose: "내 주 활동 지역 · 상대 선호/만남 가능 지역과 별도", required: true, scope: "partner", options: ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"] },
  { id: "self.area", label: "주 활동 지역 · 시·군·구", step: 0, group: "core", format: "text", purpose: "시·군·구 수준만 · 집·직장 주소·GPS 수집 안 함", required: true, scope: "partner", min: 2, max: 40, rule: "broad-area", placeholder: "가상구 · 가상 시·군·구만 입력해 주세요" },
  { id: "self.purpose", label: "관계 목적", step: 0, group: "core", format: "single", purpose: "나의 관계 기준 참고", required: true, scope: "partner", options: ["진지한 연애", "천천히 알아가며 연애", "아직 정리 중"] },
  { id: "self.bio", label: "한 줄 소개", step: 0, group: "core", format: "text", purpose: "나를 소개하는 짧은 글", required: true, scope: "partner", min: 20, max: 150, placeholder: "가상 인물에 대한 소개를 20~150자로 적어주세요." },
  { id: "self.statement", label: "현재 다른 사람과 교제·혼인 관계가 없고 성실히 참여할 의사가 있어요.", step: 0, group: "core", format: "boolean", purpose: "본인 진술 · 인증 아님", required: true, scope: "operator" },
  { id: "self.pledge", label: "기혼·사실혼이거나 다른 사람과 교제 중인 사실이 확인되면 이용이 종료되고, 상대 보호에 필요한 조치가 이뤄질 수 있음을 이해했어요.", step: 0, group: "core", format: "boolean", purpose: "허위 진술 시 조치 고지 확인 · 미혼 인증 아님", required: true, scope: "operator" },
  { id: "self.height", label: "키", step: 0, group: "optional", format: "number", purpose: "본인이 입력한 키 · cm", required: false, scope: "partner", rule: "positive-cm", placeholder: "cm 직접 입력" },
  { id: "self.body", label: "체형", step: 0, group: "optional", format: "single", purpose: "본인이 선택한 표현", required: false, scope: "operator", options: ["마른 편", "보통", "탄탄한 편", "체격 있는 편", "미선택"] },
  { id: "self.style", label: "스타일", step: 0, group: "optional", format: "multi", purpose: "나의 평소 스타일 참고", required: false, scope: "operator", limit: 3, options: ["단정한", "캐주얼", "미니멀", "스포티", "개성 있는"] },
  { id: "self.smoking", label: "흡연", step: 0, group: "optional", format: "single", purpose: "나의 생활 성향 참고", required: false, scope: "partner", options: ["안 함", "가끔", "자주", "답하지 않음"] },
  { id: "self.drinking", label: "음주", step: 0, group: "optional", format: "single", purpose: "나의 생활 성향 참고", required: false, scope: "partner", options: ["안 함", "월 1~2회", "주 1회 이상", "상황에 따라", "답하지 않음"] },
  { id: "self.schedule", label: "생활", step: 0, group: "optional", format: "single", purpose: "생활 시간대 참고", required: false, scope: "partner", options: ["주간", "야간", "교대·불규칙", "답하지 않음"] },
  { id: "self.available", label: "편한 시간", step: 0, group: "optional", format: "single", purpose: "참여 가능한 시간대 참고", required: false, scope: "partner", options: ["평일 저녁", "주말 낮", "주말 저녁", "일정에 따라"] },
  { id: "self.interests", label: "관심사", step: 0, group: "optional", format: "multi", purpose: "넓은 관심 분야 참고", required: false, scope: "partner", limit: 5, options: ["음악", "산책", "영화", "책", "여행", "운동", "음식", "전시", "게임", "자연"] },
  { id: "self.work", label: "직업/직무 · 넓은 분야", step: 0, group: "optional", format: "single", purpose: "동의한 매칭 참고 범위에서만 운영자 확인 · 회사명·직장 주소·소득 수집 안 함 · 미입력은 무직으로 판단하지 않음", required: false, scope: "partner", options: ["기획·사무", "개발·기술", "디자인·콘텐츠", "교육·연구", "서비스·영업", "현장·생산", "기타", "답하지 않음"] },
  { id: "self.workTitle", label: "직업/직무 · 직업명", step: 0, group: "optional", format: "text", purpose: "가상 직업명만 · 회사명·직장 주소·소득은 입력하지 마세요. 비공개여도 동의한 매칭 참고 범위에서만 운영자가 확인하며, 미입력은 무직으로 판단하지 않아요.", required: false, scope: "partner", max: 40, rule: "no-contact", placeholder: "가상 직무 예: 콘텐츠 기획자 · 선택" },
  { id: "self.question", label: "질문형 소개 01", step: 0, section: "expression", group: "optional", format: "single", purpose: "기존 대화 질문을 그대로 사용해요 · 선택하지 않아도 신청 가능", required: false, scope: "partner", options: ["어떤 사람과 있을 때 편안한가요?"] },
  { id: "self.answer", label: "어떤 사람과 있을 때 편안한가요? · 답변", step: 0, section: "expression", group: "optional", format: "text", purpose: "기존 대화 답변 재사용 · 연락처·SNS·민감정보는 적지 마세요", required: false, scope: "partner", min: 100, max: 300, placeholder: "가상 답변을 100~300자로 적어주세요." },
  ...EXPRESSION_FIELDS,
  ...PHOTO_SLOTS.map(slot => ({ ...slot, step: 1, group: slot.required ? "core" as const : "optional" as const })),
  ...PREFERENCE_FIELDS,
  ...REVIEW_CONSENTS,
];

export type ApplicationDraft = { values: Record<string, AnswerValue>; photos: ApplicationPhotos; sharing: Record<string, boolean>; preferences: PreferenceSettings; review: ReviewState; step: number; visited: number[]; savedAt: string | null; completedDemo: boolean };
export const emptyApplication = (): ApplicationDraft => ({ values: {}, review: emptyReview(), preferences: emptyPreferences(), photos: emptyPhotos(), sharing: { ...Object.fromEntries(APPLICATION_FIELDS.filter(field => field.scope === "partner").map(field => [field.id, field.group !== "optional"])), [PUBLIC_AGE_FIELD.id]: true }, step: 0, visited: [0], savedAt: null, completedDemo: false });
export function answerState(value: AnswerValue | undefined) {
  if (value === undefined || value === "" || value === false || Array.isArray(value) && value.length === 0) return "unanswered";
  if (value === "선호 없음" || Array.isArray(value) && value.some(item => item === "선호 없음" || item === "상관없어요")) return "no-preference";
  if (value === "답하지 않음" || value === "미선택") return "declined";
  return "answered";
}
export function ageOn(birthDate: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const parsed = new Date(`${birthDate}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate || birthDate > today) return null;
  const [year, month, day] = birthDate.split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
  return currentYear - year - (currentMonth < month || currentMonth === month && currentDay < day ? 1 : 0);
}
export function accountAge(account: AccountFacts, today: string) {
  if (!account.verifiedAt) return null;
  return account.verifiedBirthDate ? ageOn(account.verifiedBirthDate, today) : Number.isInteger(account.verifiedAge) && account.verifiedAge! >= 0 ? account.verifiedAge! : null;
}
export function fieldError(field: FieldDefinition, value: AnswerValue | undefined, today: string, account: AccountFacts = {}, photos: ApplicationPhotos = emptyPhotos()) {
  if (field.format === "photo") return photoError(photos, field.id as PhotoSlotId);
  if (field.id === "self.birthDate" && accountAge(account, today) !== null) return accountAge(account, today)! < BEFORE_US.operatingDraft.minimumAge ? "운영 초안의 만 19세 이상 기준을 충족하지 않아요." : null;
  const state = answerState(value);
  if (state === "unanswered") return field.required ? "필수 항목을 확인해 주세요." : null;
  if (field.format === "boolean") return value === true ? null : "직접 확인해 주세요.";
  if (field.format === "multi") {
    if (!Array.isArray(value) || new Set(value).size !== value.length || value.some(option => !field.options?.includes(option))) return "선택지를 확인해 주세요.";
    return value.length > (field.limit || Infinity) ? `최대 ${field.limit}개까지 선택할 수 있어요.` : null;
  }
  if (typeof value !== "string") return "입력 형식을 확인해 주세요.";
  if (field.options && !field.options.includes(value)) return "선택지를 확인해 주세요.";
  const length = Array.from(value.trim()).length;
  if (field.min && length < field.min || field.max && length > field.max) return `${field.min || 0}~${field.max}자로 입력해 주세요.`;
  if (field.rule === "no-contact" && /(?:@|https?:|www\.|\d[\d\s-]{6,}|카톡|카카오톡|인스타|instagram|sns|연락처|전화번호|아이디)/i.test(value)) return field.id === "desired.appearance.note" ? "타인의 연락처·SNS·아이디 등 개인정보는 설명에 넣지 마세요." : "연락처·SNS·아이디는 이름에 넣을 수 없어요.";
  if (field.rule === "broad-area" && /(?:\d+\s*(?:번지|호|층)|(?:로|길)\s*\d|(?:집|직장)\s*주소|\d{1,3}\.\d+\s*[,/]\s*\d{1,3}\.\d+)/.test(value)) return "주소·GPS 대신 넓은 생활권만 입력해 주세요.";
  if (field.id === "self.area" && !/^[가-힣]+(?:시|군|구)(?:\s+[가-힣]+구)?$/.test(value.trim())) return "주 활동 지역은 시·군·구 수준으로 입력해 주세요. 기존 생활권 답변은 보존되며 보완이 필요해요.";
  if (field.rule === "positive-cm" && (!/^\d+$/.test(value) || Number(value) <= 0)) return "키는 양의 정수로 직접 입력해 주세요. 단위는 cm예요.";
  if (field.rule === "adult-draft") {
    const age = ageOn(value, today);
    if (age === null) return "유효한 가상 생년월일을 입력해 주세요.";
    if (age < BEFORE_US.operatingDraft.minimumAge) return "만 19세 이상은 운영 초안 기준이에요. 현재 입력값은 기준 미충족이에요.";
  }
  return null;
}
export function validateApplication(draft: ApplicationDraft, today: string, account: AccountFacts = {}, step?: number) {
  const errors: Record<string, string> = {};
  for (const field of APPLICATION_FIELDS.filter(field => step === undefined || field.step === step || field.alsoOn === step)) {
    const error = fieldError(field, draft.values[field.id], today, account, draft.photos);
    if (error) errors[field.id] = error;
  }
  if (step === undefined || step === 0) {
    const hasQuestion = answerState(draft.values["self.question"]) === "answered";
    const hasAnswer = answerState(draft.values["self.answer"]) === "answered";
    if (hasQuestion !== hasAnswer) errors[hasQuestion ? "self.answer" : "self.question"] = "선택한 질문과 100~300자 답변을 함께 확인해 주세요.";
  }
  if (step === undefined || step === 2) Object.assign(errors, validatePreferences(draft.values, draft.preferences || emptyPreferences()));
  if (step === undefined || step === 2) Object.assign(errors, validateRelationshipPreferences(draft.values));
  if (step === undefined || step === 3) {
    for (const id of [...BASE_PUBLIC_FIELDS, ...REQUIRED_PUBLIC_PHOTOS]) if (!draft.sharing[id]) errors[`sharing.${id}`] = "기본 소개 프로필에 필요한 공개예요. 동의하지 않으면 신청을 보류하거나 철회할 수 있어요.";
    if (draft.review?.submission === "held" || draft.review?.submission === "withdrawn") errors["submission.resume"] = "보류·철회 상태예요. 다시 작성하기를 선택한 뒤 확인해 주세요.";
    if (draft.preferences.request === "hold") errors["preference.hold"] = "신청 보류 의사가 기록되어 있어요. 원하는 만남 단계에서 보류 의사를 해제하거나 신청을 보류해 주세요.";
  }
  return errors;
}
export function requiredProgress(draft: ApplicationDraft, today: string, account: AccountFacts = {}) {
  const required = APPLICATION_FIELDS.filter(field => field.required);
  return { total: required.length, complete: required.filter(field => !fieldError(field, draft.values[field.id], today, account, draft.photos)).length };
}
export function partnerPreview(draft: ApplicationDraft, today: string, account: AccountFacts = {}) {
  const items = APPLICATION_FIELDS.filter(field => PUBLIC_FIELD_IDS.includes(field.id) && draft.sharing[field.id] && answerState(draft.values[field.id]) === "answered" && !fieldError(field, draft.values[field.id], today, account)).map(field => ({ id: field.id, label: field.label, value: Array.isArray(draft.values[field.id]) ? [...draft.values[field.id] as string[]] : draft.values[field.id] }));
  const age = accountAge(account, today) ?? ageOn(String(draft.values["self.birthDate"] || ""), today);
  if (age !== null && age >= BEFORE_US.operatingDraft.minimumAge && draft.sharing[PUBLIC_AGE_FIELD.id]) items.splice(1, 0, { id: PUBLIC_AGE_FIELD.id, label: accountAge(account, today) !== null ? "만 나이 · 기존 인증값" : "만 나이 · 인증 확인 전", value: `${age}세` });
  return items;
}
export function operatorPreview(draft: ApplicationDraft, today: string, account: AccountFacts = {}) {
  if (draft.values["consent.collection"] !== true || draft.values["consent.matching"] !== true) return {};
  const values: Record<string, AnswerValue | number> = Object.fromEntries(APPLICATION_FIELDS.filter(field => field.scope !== "private" && answerState(draft.values[field.id]) !== "unanswered" && !fieldError(field, draft.values[field.id], today, account)).map(field => [field.id, draft.values[field.id]]));
  const age = accountAge(account, today) ?? ageOn(String(draft.values["self.birthDate"] || ""), today);
  if (age !== null) values[PUBLIC_AGE_FIELD.id] = age;
  for (const slot of PHOTO_SLOTS) { const photo = draft.photos[slot.id]; if (photo?.file && !photoError(draft.photos, slot.id)) values[slot.id] = `${photo.file.name} · 검토 ${photo.review} (가상)`; }
  return values;
}

let savedApplication: ApplicationDraft | null = null;
const listeners = new Set<() => void>();
export function getSavedApplication() { return savedApplication; }
export function saveApplication(draft: ApplicationDraft) { savedApplication = { ...draft, review: cloneReview(draft.review), preferences: clonePreferences(draft.preferences), photos: clonePhotos(draft.photos), values: Object.fromEntries(Object.entries(draft.values).map(([id, value]) => [id, Array.isArray(value) ? [...value] : value])), sharing: { ...draft.sharing }, visited: [...draft.visited], savedAt: new Date().toISOString() }; listeners.forEach(listener => listener()); }
export function clearApplication() { savedApplication = null; listeners.forEach(listener => listener()); }
function subscribeApplication(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useSavedApplication() { return useSyncExternalStore(subscribeApplication, getSavedApplication, () => null); }
