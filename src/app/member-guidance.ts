import type { ApplicationDraft } from "./application-model"
import type { IdentityRecord } from "./identity-model"
import type { WaitlistEntry } from "./gender-balance"

// 투명한 대기 상태: 실제 기록이 있는 단계만 완료로 표시하고, 예상 날짜·남은 인원은 만들지 않는다.
export type JourneyStep = { id: string; title: string; status: "done" | "current" | "upcoming" | "blocked"; detail: string; at: string | null }
export function waitingJourney(application: ApplicationDraft | null, identity: IdentityRecord | null, waitlist: WaitlistEntry | null): JourneyStep[] {
  const received = application?.review.submission === "received"
  const verified = identity?.status === "verified"
  const reviewed = application?.review.profileReview === "reviewed"
  const revision = application ? Object.values(application.photos).some((photo) => photo.review === "재등록 요청") : false
  const prepared = !!application?.review.preparation
  const steps: JourneyStep[] = [
    { id: "apply", title: "신청서 작성", status: received ? "done" : "current", detail: received ? "신청을 받았어요." : application ? "작성 중이에요. 이어서 쓸 수 있어요." : "아직 신청 전이에요.", at: application?.review.receivedAt || null },
    { id: "identity", title: "본인·성인 인증", status: verified ? "done" : identity?.status === "minor" ? "blocked" : received || application ? "current" : "upcoming", detail: verified ? "인증을 마쳤어요." : identity?.status === "minor" ? "만 19세 이상만 이용할 수 있어요." : "신청 전 휴대폰 본인인증이 필요해요.", at: identity?.verifiedAt || null },
  ]
  if (waitlist) steps.push({ id: "waitlist", title: "순차 검토 대기", status: "current", detail: "지금은 신청이 많아 순서대로 검토하고 있어요. 신청 내용은 그대로 보관돼요.", at: waitlist.at })
  steps.push(
    { id: "review", title: "운영진 신청서 검토", status: reviewed ? "done" : revision ? "blocked" : received && verified && !waitlist ? "current" : "upcoming", detail: reviewed ? "운영진이 신청서를 읽었어요." : revision ? "사진 보완 요청이 있어요. 해당 사진만 다시 올려 주세요." : received && verified && !waitlist ? "운영진이 신청서와 사진을 직접 읽고 있어요." : "신청과 인증이 끝나면 운영진이 신청서와 사진을 직접 읽어요.", at: null },
    { id: "search", title: "어울리는 상대 찾기", status: prepared ? "done" : reviewed ? "current" : "upcoming", detail: prepared ? "소개할 상대가 준비됐어요." : reviewed ? "조건이 맞는 분 중에서 운영진이 한 사람을 고르고 있어요. 매일 새 소개를 약속하지는 않아요." : "검토가 끝나면 조건이 맞는 분 중에서 운영진이 한 사람을 골라요.", at: null },
    { id: "noon", title: "정오 소개", status: prepared ? "current" : "upcoming", detail: "준비된 날 정오 12:00에 두 사람에게 동시에 소개해요.", at: null },
  )
  return steps
}

// 프로필 완성 코칭: 운영진이 어울리는 이유를 찾을 때 참고하는 선택 항목만 안내한다. 비워도 신청은 진행된다.
export type CoachingTip = { id: string; title: string; why: string; step: number }
const TIPS: (CoachingTip & { filled: (values: ApplicationDraft["values"]) => boolean })[] = [
  { id: "traits", title: "나를 설명하는 모습", why: "상대가 바라는 모습과 겹치는지 운영진이 볼 수 있어요.", step: 0, filled: (v) => Array.isArray(v["self.traits"]) && v["self.traits"].length > 0 },
  { id: "values", title: "알아갈 때 중요하게 보는 것", why: "관계에서 같은 것을 중요하게 보는 분을 찾는 데 가장 도움이 돼요.", step: 0, filled: (v) => Array.isArray(v["self.relationshipValues"]) && v["self.relationshipValues"].length > 0 },
  { id: "daysOff", title: "쉬는 날의 모습", why: "주말을 비슷하게 보내는 분과는 첫 대화가 쉬워요.", step: 0, filled: (v) => Array.isArray(v["self.daysOff"]) && v["self.daysOff"].length > 0 },
  { id: "interests", title: "관심사", why: "함께 이야기할 거리를 찾는 근거가 돼요.", step: 0, filled: (v) => Array.isArray(v["self.interests"]) && v["self.interests"].length > 0 },
  { id: "available", title: "편한 시간", why: "실제로 만날 수 있는 시간대가 맞는지 확인해요.", step: 0, filled: (v) => typeof v["self.available"] === "string" && !!v["self.available"] },
  { id: "schedule", title: "생활 시간대", why: "생활 리듬이 크게 다르면 운영진이 미리 살펴봐요.", step: 0, filled: (v) => typeof v["self.schedule"] === "string" && !!v["self.schedule"] },
  { id: "moment", title: "질문형 소개", why: "선택지로 담기 어려운 나의 분위기가 전해져요.", step: 0, filled: (v) => typeof v["self.answer"] === "string" && v["self.answer"].length >= 50 || typeof v["self.momentAnswer"] === "string" && v["self.momentAnswer"].length >= 100 },
  { id: "wishValues", title: "연애에서 중요하게 보는 것", why: "상대에게 바라는 기준을 알면 운영진이 더 정확히 고를 수 있어요. 상대에게는 공개되지 않아요.", step: 2, filled: (v) => Array.isArray(v["desired.relationship.values"]) && v["desired.relationship.values"].length > 0 },
  { id: "wishTraits", title: "선호하는 사람의 모습", why: "운영진만 참고하는 비공개 정보예요.", step: 2, filled: (v) => Array.isArray(v["desired.relationship.traits"]) && v["desired.relationship.traits"].length > 0 },
  { id: "meetingRegions", title: "실제 만남 가능한 지역", why: "만나기 어려운 거리의 소개를 줄여요.", step: 2, filled: (v) => Array.isArray(v["desired.meetingRegions"]) && v["desired.meetingRegions"].length > 0 },
]
export function profileCoaching(draft: ApplicationDraft | null) {
  if (!draft) return { filled: 0, total: TIPS.length, tips: [] as CoachingTip[], bioTip: null as string | null }
  const missing = TIPS.filter((tip) => !tip.filled(draft.values)).map(({ filled: _filled, ...tip }) => tip)
  const bio = typeof draft.values["self.bio"] === "string" ? draft.values["self.bio"] : ""
  return {
    filled: TIPS.length - missing.length,
    total: TIPS.length,
    tips: missing,
    bioTip: bio && bio.length < 40 ? "한 줄 소개에 요즘의 구체적인 장면을 하나 넣어 보세요. 예: ‘퇴근 후 한강을 걷는 게 요즘 낙이에요.’" : null,
  }
}
