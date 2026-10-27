import { EXPRESSION_PUBLIC_IDS } from "./personality-fields"
import { copy } from "./live-copy"

export const BASE_PUBLIC_FIELDS = [
  "self.name",
  "self.age",
  "self.province",
  "self.area",
  "self.purpose",
  "self.bio",
] as const
export const OPTIONAL_PUBLIC_FIELDS = [
  ...EXPRESSION_PUBLIC_IDS,
  "self.height",
  "self.smoking",
  "self.drinking",
  "self.schedule",
  "self.available",
  "self.interests",
  "self.work",
  "self.question",
  "self.answer",
] as const
export const REQUIRED_PUBLIC_PHOTOS = [
  "photo.face",
  "photo.upper",
  "photo.style",
] as const
export const PUBLIC_FIELD_IDS: readonly string[] = [
  ...BASE_PUBLIC_FIELDS,
  ...OPTIONAL_PUBLIC_FIELDS,
]
const consent = (
  id: string,
  label: string,
  purpose: string,
  required: boolean,
) => ({
  id: `consent.${id}`,
  label: copy(label),
  purpose: copy(purpose),
  required,
  step: 3,
  group: "consent" as const,
  format: "boolean" as const,
  scope: "private" as const,
})
export const REVIEW_CONSENTS = [
  consent(
    "collection",
    "소개에 꼭 필요한 정보는 동의 없이 처리한다는 안내를 확인했어요. (데모)",
    "소개 신청과 소개 진행(회원과의 약속 이행)에 꼭 필요한 정보는 개인정보 보호법 제15조 제1항 제4호에 따라 따로 동의를 받지 않고 처리해요 · 실제 수집 없음",
    true,
  ),
  consent(
    "matching",
    "추가 정보를 받아 소개할 상대 고르기에 쓰는 데 동의해요. (데모)",
    "개인정보 수집·이용 동의(개인정보 보호법 제15조 제1항 제1호) · 실제 수집 없음",
    true,
  ),
  consent(
    "provision",
    "소개된 상대 회원에게 내 프로필을 보여 주는 데 동의해요. (데모)",
    "개인정보 제3자 제공 동의(개인정보 보호법 제17조) · 신청 때 한 번 받고, 특정 상대에게 공개하기 직전에 다시 묻지 않아요",
    true,
  ),
  consent(
    "review",
    "상대 공개 항목과 비공개 항목을 확인했어요. (데모)",
    "공개 범위 최종 확인",
    true,
  ),
  consent(
    "marketing",
    "광고성 정보를 이메일로 받는 데 동의해요. (선택·데모)",
    "비포어스의 새 기능, 행사, 할인 같은 광고성 정보를 이메일로 받고, 이를 위해 이메일 주소를 쓰는 데 동의해요 · 동의하지 않아도 서비스 이용에 불이익이 없어요 · 내 정보 → 알림 설정에서 언제든 끊을 수 있고, 동의 여부는 2년마다 다시 확인해 드려요 · 실제 발송 없음",
    false,
  ),
  consent(
    "noon",
    "매일 정오 상태 알림을 받을게요. (선택·데모)",
    "새 소개 없는 날을 포함한 현재 상태 안내 · 실제 발송 없음",
    false,
  ),
]
export type PublicProfile = {
  demo: true
  version: number
  items: {
    id: string
    label: string
    value: string | string[]
  }[]
  photos: {
    slot: string
    label: string
    assetId: string
    version: number
  }[]
}
export type Preparation = {
  demo: true
  recipientId: string
  recipientLabel: string
  proposalId: string
  profileVersion: number
  profile: PublicProfile
  period: string | null
  consent: {
    recipientId: string
    profileVersion: number
    at: string
  } | null
  readyAt: string | null
  disclosedAt: string | null
  blocked: boolean
  reconfirmRequired: boolean
}
export type ReviewState = {
  profileVersion: number
  preferenceVersion: number
  submission: "draft" | "received" | "held" | "withdrawn"
  receivedAt: string | null
  profileReview: "not-reviewed" | "pending" | "reviewed"
  newProposalsPaused: boolean
  existingAccessReviewRequired: boolean
  changeMessage: string | null
  preparation: Preparation | null
}
export const emptyReview = (): ReviewState => ({
  profileVersion: 1,
  preferenceVersion: 1,
  submission: "draft",
  receivedAt: null,
  profileReview: "not-reviewed",
  newProposalsPaused: false,
  existingAccessReviewRequired: false,
  changeMessage: null,
  preparation: null,
})
export function clonePublicProfile(profile: PublicProfile): PublicProfile {
  return {
    demo: true,
    version: profile.version,
    items: profile.items
      .filter((item) => PUBLIC_FIELD_IDS.includes(item.id))
      .map((item) => ({
        id: item.id,
        label: item.label,
        value: Array.isArray(item.value) ? [...item.value] : item.value,
      })),
    photos: profile.photos.filter(photo => [...REQUIRED_PUBLIC_PHOTOS, "photo.daily"].includes(photo.slot)).map((photo) => ({
      slot: photo.slot,
      label: photo.label,
      assetId: photo.assetId,
      version: photo.version,
    })),
  }
}
export function cloneReview(review?: ReviewState): ReviewState {
  const source = review || emptyReview()
  return {
    ...source,
    preparation: source.preparation
      ? {
          ...source.preparation,
          profile: clonePublicProfile(source.preparation.profile),
          consent: source.preparation.consent
            ? { ...source.preparation.consent }
            : null,
        }
      : null,
  }
}
export function changedReview(
  source: ReviewState | undefined,
  kind: "core" | "photo" | "visibility" | "preference" | "consent",
  revoke = false,
): ReviewState {
  const review = cloneReview(source)
  if (kind === "preference")
    return {
      ...review,
      preferenceVersion: review.preferenceVersion + 1,
      changeMessage:
        "비공개 선호 변경은 다음 소개에 반영해요. 현재 교류를 자동 종료하지 않아요.",
    }
  if (kind === "consent" && !revoke) return review
  review.profileVersion += 1
  review.profileReview =
    review.submission === "draft" ? "not-reviewed" : "pending"
  review.newProposalsPaused = true
  review.existingAccessReviewRequired ||= revoke
  review.changeMessage = revoke
    ? "사진 삭제·공개 또는 필수 동의 철회: 새 제안을 멈추고 기존 접근 범위를 재검토해요. 이미 본 화면이나 캡처까지 회수할 수 있다고 약속하지 않아요."
    : "사진·핵심 프로필 변경: 새 버전으로 재검토해요. 진행 중 제안은 기존 승인 버전을 유지하며, 상대 재확인·진행 보류가 필요한지 검토해요."
  if (review.preparation)
    review.preparation = {
      ...review.preparation,
      blocked: true,
      reconfirmRequired: true,
      readyAt: null,
      consent: null,
    }
  return review
}
