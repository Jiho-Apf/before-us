import { useSyncExternalStore } from "react"
import { BEFORE_US } from "./config"
import { accountAge, emptyApplication } from "./application-model"
import { compareMembers, applicationMember, type AdminMember, type AdminState } from "./admin-model"
import { REVIEW_CONSENTS } from "./review-state"
import { MOCK_PHOTO_FILES, PHOTO_SLOTS, registerMockPhoto } from "./photo-model"

// 후보 추천 1단계 · 규칙 기반 보조 도구.
// 필수 조건·차단·활동 상태로 먼저 거른 뒤, 양쪽이 직접 입력한 답변이 겹치는 지점을 근거와 함께 보여 준다.
// 사진·외모 취향·MBTI·체형·스타일은 사용하지 않는다. 점수는 정렬에만 쓰고 화면에 숫자로 보여 주지 않는다.
export const RECOMMENDATION_POLICY = {
  version: "V6-match-assist-01",
  maximumCandidates: 5,
  excludedSignals: ["사진", "외적인 취향", "MBTI", "체형·스타일", "직업"],
} as const

type Values = AdminMember["draft"]["values"]
const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : typeof value === "string" && value ? [value] : [])
const text = (value: unknown) => (Array.isArray(value) ? value.join(" · ") : typeof value === "string" && value ? value : "")
const name = (member: AdminMember) => text(member.draft.values["self.name"]) || member.id
// 서로 다른 선택지 표현을 같은 뜻으로 묶는다. (상대에게 바라는 것 ↔ 내가 중요하게 보는 것)
const SAME_MEANING: Record<string, string> = { "생활 패턴": "생활 리듬", "취미 공유": "취향 공유" }
const normalize = (value: string) => SAME_MEANING[value] || value
const overlap = (left: unknown, right: unknown) => {
  const rightSet = new Set(list(right).map(normalize))
  return list(left).filter((item) => rightSet.has(normalize(item)))
}

export type Evidence = { field: string; left: string; right: string }
export type Reason = { kind: "shared" | "wish"; title: string; evidence: Evidence[]; weight: number }
export type Caution = { kind: "missing" | "difference" | "check"; text: string }

// owner가 바라는 것 ↔ other의 답변
function wishReasons(owner: AdminMember, other: AdminMember): Reason[] {
  const want = owner.draft.values, has = other.draft.values, reasons: Reason[] = []
  const who = `${name(owner)}님이 바라는`
  const traits = overlap(want["desired.relationship.traits"], has["self.traits"])
  if (traits.length) reasons.push({ kind: "wish", title: `${who} 모습과 ${name(other)}님이 고른 자기 모습이 겹쳐요`, weight: 2 * traits.length, evidence: [{ field: "선호하는 사람의 모습 ↔ 나를 설명하는 모습", left: text(want["desired.relationship.traits"]), right: text(has["self.traits"]) }] })
  const values = overlap(want["desired.relationship.values"], has["self.relationshipValues"])
  if (values.length) reasons.push({ kind: "wish", title: `${name(owner)}님이 연애에서 중요하게 보는 기준을 ${name(other)}님도 중요하게 봐요 (${values.join(", ")})`, weight: 3 * values.length, evidence: [{ field: "연애에서 중요하게 보는 것 ↔ 알아갈 때 중요하게 보는 것", left: text(want["desired.relationship.values"]), right: text(has["self.relationshipValues"]) }] })
  const interests = overlap(want["desired.interests"], has["self.interests"])
  if (interests.length) reasons.push({ kind: "wish", title: `${who} 관심사를 ${name(other)}님도 좋아해요 (${interests.join(", ")})`, weight: interests.length, evidence: [{ field: "원하는 관심사 ↔ 관심사", left: text(want["desired.interests"]), right: text(has["self.interests"]) }] })
  const schedule = list(want["desired.schedule"])
  if (typeof has["self.available"] === "string" && schedule.includes(has["self.available"])) reasons.push({ kind: "wish", title: `${name(owner)}님이 원하는 시간대에 ${name(other)}님도 편해요`, weight: 2, evidence: [{ field: "원하는 생활·일정 ↔ 편한 시간", left: schedule.join(" · "), right: has["self.available"] }] })
  const drinking = want["desired.drinking"], drink = has["self.drinking"]
  const drinkFit = drinking === "술자리 없이도 편한 사람" ? ["안 함", "월 1~2회"] : drinking === "가끔 함께" ? ["월 1~2회", "상황에 따라"] : []
  if (typeof drink === "string" && drinkFit.includes(drink)) reasons.push({ kind: "wish", title: `${name(owner)}님의 음주 선호와 맞아요`, weight: 1, evidence: [{ field: "음주 선호 ↔ 음주", left: String(drinking), right: drink }] })
  if (typeof has["self.province"] === "string" && list(want["desired.meetingRegions"]).includes(has["self.province"])) reasons.push({ kind: "wish", title: `${name(other)}님의 활동 지역이 실제 만남 가능 지역 안이에요`, weight: 2, evidence: [{ field: "실제 만남 가능 지역 ↔ 주 활동 지역", left: text(want["desired.meetingRegions"]), right: `${has["self.province"]} ${text(has["self.area"])}`.trim() }] })
  return reasons
}
function sharedReasons(left: AdminMember, right: AdminMember): Reason[] {
  const a = left.draft.values, b = right.draft.values, reasons: Reason[] = []
  const pair = (field: string, key: string, title: (items: string[]) => string, weight: number) => {
    const items = overlap(a[key], b[key])
    if (items.length) reasons.push({ kind: "shared", title: title(items), weight: weight * items.length, evidence: [{ field, left: text(a[key]), right: text(b[key]) }] })
  }
  if (typeof a["self.purpose"] === "string" && a["self.purpose"] === b["self.purpose"]) reasons.push({ kind: "shared", title: `관계 목적이 같아요 (${a["self.purpose"]})`, weight: 4, evidence: [{ field: "관계 목적", left: a["self.purpose"], right: String(b["self.purpose"]) }] })
  pair("쉬는 날의 모습", "self.daysOff", (items) => `쉬는 날을 비슷하게 보내요 (${items.join(", ")})`, 2)
  pair("관심사", "self.interests", (items) => `함께 이야기할 관심사가 있어요 (${items.join(", ")})`, 1)
  pair("알아갈 때 중요하게 보는 것", "self.relationshipValues", (items) => `사람을 알아갈 때 같은 것을 중요하게 봐요 (${items.join(", ")})`, 2)
  if (typeof a["self.schedule"] === "string" && a["self.schedule"] === b["self.schedule"] && a["self.schedule"] !== "답하지 않음") reasons.push({ kind: "shared", title: "생활 리듬이 같아요", weight: 2, evidence: [{ field: "생활", left: a["self.schedule"], right: String(b["self.schedule"]) }] })
  return reasons
}
const outsideMeetingRegion = (owner: AdminMember, other: AdminMember) => {
  const regions = list(owner.draft.values["desired.meetingRegions"])
  return regions.length > 0 && typeof other.draft.values["self.province"] === "string" && !regions.includes(other.draft.values["self.province"])
}
function cautions(target: AdminMember, other: AdminMember, today: string): Caution[] {
  const a = target.draft.values, b = other.draft.values, out: Caution[] = []
  const missing = ([["self.drinking", "음주"], ["self.schedule", "생활"], ["self.available", "편한 시간"], ["self.daysOff", "쉬는 날"], ["self.relationshipValues", "중요하게 보는 것"]] as const)
    .filter(([key]) => !list(b[key]).length).map(([, label]) => label)
  if (missing.length) out.push({ kind: "missing", text: `${name(other)}님 미입력: ${missing.join(", ")} · 추측하지 않음` })
  if (typeof a["self.schedule"] === "string" && typeof b["self.schedule"] === "string" && a["self.schedule"] !== b["self.schedule"] && ![a["self.schedule"], b["self.schedule"]].includes("답하지 않음"))
    out.push({ kind: "difference", text: `생활 시간대가 달라요 (${a["self.schedule"]} / ${b["self.schedule"]})` })
  for (const [owner, counter] of [[target, other], [other, target]] as const)
    for (const row of compareMembers(owner, counter, today)) if (row.status === "확인 필요") out.push({ kind: "check", text: `${name(owner)}님 필수 조건 · ${row.label} 확인 필요` })
  for (const [owner, counter] of [[target, other], [other, target]] as const)
    if (outsideMeetingRegion(owner, counter)) out.push({ kind: "difference", text: `${name(counter)}님 활동 지역(${counter.draft.values["self.province"]})이 ${name(owner)}님의 실제 만남 가능 지역 밖이에요` })
  const ages = [accountAge(target.account, today), accountAge(other.account, today)]
  if (ages.some((age) => age === null || age === undefined)) out.push({ kind: "check", text: "본인·성인 인증값 확인 필요" })
  return out
}

// 추천에서 아예 빼는 사유. 운영자가 이유를 볼 수 있게 남긴다.
export function exclusionReasons(state: AdminState, target: AdminMember, other: AdminMember, today: string, waitlisted: (id: string) => boolean = () => false) {
  const out: string[] = []
  if (target.id === other.id) return ["같은 신청자"]
  if (other.lifecycle && other.lifecycle !== "active") out.push("일시정지·차단·탈퇴 요청")
  if (other.activity !== "idle") out.push("다른 소개·교류 진행 중")
  if (waitlisted(other.id)) out.push("성비 순차 검토 대기")
  if (other.draft.review.submission !== "received") out.push("신청 접수 전")
  if (target.blockedIds.includes(other.id) || other.blockedIds.includes(target.id)) out.push("차단 관계")
  if (target.previousIds.includes(other.id) || other.previousIds.includes(target.id)) out.push("이전에 소개된 상대")
  if (state.proposals.some((proposal) => proposal.status !== "waiting" && proposal.members.includes(other.id))) out.push("다른 후보 준비·예약 중")
  for (const [owner, counter] of [[target, other], [other, target]] as const) {
    const gender = counter.draft.values["self.gender"]
    if (!["여성", "남성"].includes(String(gender)) || owner.draft.values["desired.gender"] !== gender || owner.draft.values["self.gender"] === gender) { out.push("상호 소개 대상 아님"); break }
  }
  for (const [owner, counter] of [[target, other], [other, target]] as const)
    for (const row of compareMembers(owner, counter, today)) if (row.status === "미충족") out.push(`${name(owner)}님 필수 조건 미충족 · ${row.label}`)
  return [...new Set(out)]
}

export type Recommendation = { candidateId: string; candidateName: string; reasons: Omit<Reason, "weight">[]; cautions: Caution[]; mutual: boolean }
export function recommendCandidates(state: AdminState, targetId: string, today: string, waitlisted: (id: string) => boolean = () => false) {
  const target = state.members.find((member) => member.id === targetId)
  if (!target) return { recommended: [] as Recommendation[], excluded: [] as { candidateId: string; candidateName: string; reasons: string[] }[], considered: 0 }
  const others = state.members.filter((member) => member.id !== target.id)
  const excluded: { candidateId: string; candidateName: string; reasons: string[] }[] = []
  const scored: (Recommendation & { weight: number; outside: boolean })[] = []
  for (const other of others) {
    const blocked = exclusionReasons(state, target, other, today, waitlisted)
    if (blocked.length) { excluded.push({ candidateId: other.id, candidateName: name(other), reasons: blocked }); continue }
    const fromTarget = wishReasons(target, other), fromOther = wishReasons(other, target), shared = sharedReasons(target, other)
    const reasons = [...shared, ...fromTarget, ...fromOther].sort((x, y) => y.weight - x.weight)
    // 한쪽만 원하는 경우보다 양쪽 모두 바라는 점이 있는 쌍을 우선한다.
    const mutual = fromTarget.length > 0 && fromOther.length > 0
    // 가중치는 정렬에만 쓰고 화면으로 넘기는 근거에서는 뺀다.
    scored.push({ candidateId: other.id, candidateName: name(other), reasons: reasons.map(({ weight: _weight, ...reason }) => reason), cautions: cautions(target, other, today), mutual, weight: reasons.reduce((sum, item) => sum + item.weight, 0) + (mutual ? 3 : 0) , outside: outsideMeetingRegion(target, other) || outsideMeetingRegion(other, target) })
  }
  const recommended = scored
    .filter((item) => item.reasons.length > 0)
    // 실제로 만날 수 있는 지역의 후보를 먼저, 그 안에서 근거가 많은 순서로 보여 준다.
    .sort((x, y) => Number(x.outside) - Number(y.outside) || y.weight - x.weight || x.candidateId.localeCompare(y.candidateId))
    .slice(0, RECOMMENDATION_POLICY.maximumCandidates)
    .map(({ weight: _weight, outside: _outside, ...item }) => item)
  for (const item of scored.filter((entry) => entry.reasons.length === 0))
    excluded.push({ candidateId: item.candidateId, candidateName: item.candidateName, reasons: ["겹치는 답변 근거 없음 · 직접 비교는 가능"] })
  return { recommended, excluded, considered: others.length }
}

// 추천 표시와 운영자 최종 선택을 함께 기록한다. 추천 밖 선택도 정상 경로다.
export type RecommendationLog = { id: string; targetId: string; shownIds: string[]; shownAt: string; chosenId: string | null; chosenAt: string | null; chosenFromList: boolean | null; policyVersion: string }
let logs: RecommendationLog[] = []
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const commit = (next: RecommendationLog[]) => { logs = next; listeners.forEach((listener) => listener()) }
export const getRecommendationLogs = () => logs
export const useRecommendationLogs = () => useSyncExternalStore(subscribe, getRecommendationLogs, getRecommendationLogs)
export function recordRecommendationShown(targetId: string, shownIds: string[], now = new Date()) {
  const key = shownIds.join(",")
  const open = logs.find((item) => item.targetId === targetId && !item.chosenId)
  if (open && open.shownIds.join(",") === key) return open.id
  const id = `recommendation-${logs.length + 1}`
  commit([...logs.filter((item) => item !== open), { id, targetId, shownIds: [...shownIds], shownAt: now.toISOString(), chosenId: null, chosenAt: null, chosenFromList: null, policyVersion: RECOMMENDATION_POLICY.version }])
  return id
}
export function recordOperatorChoice(targetId: string, chosenId: string, now = new Date()) {
  const open = logs.find((item) => item.targetId === targetId && !item.chosenId)
  const entry: RecommendationLog = open
    ? { ...open, chosenId, chosenAt: now.toISOString(), chosenFromList: open.shownIds.includes(chosenId) }
    : { id: `recommendation-${logs.length + 1}`, targetId, shownIds: [], shownAt: now.toISOString(), chosenId, chosenAt: now.toISOString(), chosenFromList: false, policyVersion: RECOMMENDATION_POLICY.version }
  commit([...logs.filter((item) => item !== open), entry])
}

// 추천 시연용 가상 신청자. 실제 회원이 아니며, 사진은 도형 예시 파일만 사용한다.
const PEOPLE: [string, "여성" | "남성", number, string, Record<string, string | string[]>][] = [
  ["가상 서연", "여성", 29, "서울", { "self.traits": ["차분한", "잘 들어주는", "호기심이 많은"], "self.relationshipValues": ["대화", "신뢰", "서로의 시간 존중"], "self.daysOff": ["전시·공연", "산책·여행"], "self.interests": ["전시", "책", "산책"], "self.schedule": "주간", "self.available": "주말 낮", "self.drinking": "월 1~2회", "desired.relationship.traits": ["대화를 잘 이어가는", "차분한", "배려가 자연스러운"], "desired.relationship.values": ["대화", "신뢰", "생활 패턴"], "desired.interests": ["전시", "책", "산책"], "desired.schedule": ["주말 낮", "평일 저녁"], "desired.drinking": "술자리 없이도 편한 사람", "desired.meetingRegions": ["서울", "경기"] }],
  ["가상 하린", "여성", 31, "경기", { "self.traits": ["활동적인", "표현이 솔직한", "즉흥적인"], "self.relationshipValues": ["유머", "표현", "취향 공유"], "self.daysOff": ["운동", "새로운 것 경험하기"], "self.interests": ["운동", "여행", "음식"], "self.schedule": "주간", "self.available": "주말 저녁", "self.drinking": "상황에 따라", "desired.relationship.traits": ["활동적인", "유머가 있는", "잘 웃는"], "desired.relationship.values": ["표현", "취미 공유"], "desired.interests": ["운동", "여행"], "desired.schedule": ["주말 저녁"], "desired.drinking": "가끔 함께", "desired.meetingRegions": ["경기", "서울"] }],
  ["가상 지우", "여성", 27, "서울", { "self.traits": ["낯을 조금 가리는", "친해지면 말이 많은", "계획적인"], "self.relationshipValues": ["배려", "생활 리듬", "신뢰"], "self.daysOff": ["집에서 쉬기", "카페·맛집"], "self.interests": ["영화", "음식", "음악"], "self.schedule": "야간", "self.available": "평일 저녁", "desired.relationship.traits": ["안정적인", "배려가 자연스러운"], "desired.relationship.values": ["생활 패턴", "신뢰", "연락 방식"], "desired.interests": ["영화", "음악"], "desired.schedule": ["평일 저녁"], "desired.meetingRegions": ["서울"] }],
  ["가상 도윤", "남성", 30, "서울", { "self.traits": ["차분한", "잘 들어주는", "계획적인"], "self.relationshipValues": ["대화", "신뢰", "배려"], "self.daysOff": ["전시·공연", "카페·맛집"], "self.interests": ["전시", "책", "음악"], "self.schedule": "주간", "self.available": "주말 낮", "self.drinking": "월 1~2회", "desired.relationship.traits": ["차분한", "호기심이 많은"], "desired.relationship.values": ["대화", "신뢰"], "desired.interests": ["전시", "책"], "desired.schedule": ["주말 낮"], "desired.drinking": "빈도 무관", "desired.meetingRegions": ["서울"] }],
  ["가상 민재", "남성", 32, "경기", { "self.traits": ["활동적인", "표현이 솔직한", "호기심이 많은"], "self.relationshipValues": ["유머", "표현", "취향 공유"], "self.daysOff": ["운동", "산책·여행"], "self.interests": ["운동", "여행", "자연"], "self.schedule": "주간", "self.available": "주말 저녁", "self.drinking": "상황에 따라", "desired.relationship.traits": ["활동적인", "표현이 솔직한"], "desired.relationship.values": ["표현", "취미 공유"], "desired.interests": ["여행", "운동"], "desired.schedule": ["주말 저녁", "주말 낮"], "desired.drinking": "가끔 함께", "desired.meetingRegions": ["경기", "서울"] }],
  ["가상 시우", "남성", 28, "서울", { "self.traits": ["낯을 조금 가리는", "혼자만의 시간도 중요한"], "self.relationshipValues": ["서로의 시간 존중", "생활 리듬"], "self.daysOff": ["집에서 쉬기", "카페·맛집"], "self.interests": ["게임", "영화", "음식"], "self.schedule": "야간", "self.available": "평일 저녁", "desired.relationship.traits": ["차분한", "자기 일이 있는"], "desired.relationship.values": ["서로의 시간 존중", "생활 패턴"], "desired.interests": ["영화", "게임"], "desired.schedule": ["평일 저녁"], "desired.meetingRegions": ["서울"] }],
  ["가상 준호", "남성", 34, "부산", { "self.traits": ["차분한", "계획적인"], "self.relationshipValues": ["신뢰", "대화"], "self.daysOff": ["산책·여행"], "self.interests": ["책", "자연"], "self.schedule": "주간", "self.available": "주말 낮", "desired.relationship.traits": ["차분한"], "desired.relationship.values": ["신뢰"], "desired.meetingRegions": ["부산"] }],
  ["가상 태오", "남성", 29, "서울", { "self.traits": ["즉흥적인", "활동적인"], "self.interests": ["게임", "운동"], "self.smoking": "자주", "desired.meetingRegions": ["서울"] }],
]
export function loadMatchingFixtures(state: AdminState, now = new Date()): AdminState {
  const existing = new Set(state.members.map((member) => member.id))
  const members = PEOPLE.map(([fullName, gender, age, province, extra], index): AdminMember => {
    const draft = emptyApplication()
    draft.values = {
      "self.name": fullName.replace("가상 ", ""), "self.gender": gender, "desired.gender": gender === "여성" ? "남성" : "여성",
      "self.province": province, "self.area": "가상구", "self.purpose": index % 4 === 1 ? "천천히 알아가며 연애" : "진지한 연애",
      "self.bio": "실제 회원이 아닌 후보 추천 시연용 가상 소개입니다. 천천히 알아가고 싶어요.", "self.statement": true, "self.pledge": true,
      "self.smoking": "안 함", "desired.regions": ["선호 없음"], "desired.smoking": "비흡연 선호", ...extra,
    }
    for (const consent of REVIEW_CONSENTS.filter((field) => field.required)) draft.values[consent.id] = true
    draft.preferences.importance["desired.smoking"] = "required"
    for (const [slotIndex, slot] of PHOTO_SLOTS.entries())
      if (slot.required) {
        draft.photos = registerMockPhoto(draft.photos, slot.id, { ...MOCK_PHOTO_FILES[slotIndex], id: `match-${index}-${slotIndex}` })
        draft.photos[slot.id] = { ...draft.photos[slot.id], recentSelfConfirmed: true, rightsSelfConfirmed: true, review: "기준 확인" }
      }
    draft.review.submission = "received"
    draft.review.receivedAt = now.toISOString()
    return { ...applicationMember(draft), id: `match-${index + 1}`, account: { verifiedAge: age, verifiedAt: now.toISOString() }, participation: { available: true, confirmedAt: now.toISOString() }, rights: "valid", policyVersion: BEFORE_US.policyVersion }
  }).filter((member) => !existing.has(member.id))
  return { ...state, revision: state.revision + 1, members: [...state.members, ...members], stateUpdatedAt: now.toISOString() }
}
