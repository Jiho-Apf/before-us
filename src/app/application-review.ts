import { BEFORE_US } from "./config"
import {
  APPLICATION_FIELDS,
  PUBLIC_AGE_FIELD,
  accountAge,
  partnerPreview,
  validateApplication,
  type AccountFacts,
  type ApplicationDraft,
} from "./application-model"
import { PHOTO_SLOTS, clonePhotos, photoError } from "./photo-model"
import { clonePreferences } from "./preference-model"
import {
  BASE_PUBLIC_FIELDS,
  REQUIRED_PUBLIC_PHOTOS,
  clonePublicProfile,
  cloneReview,
  type Preparation,
  type PublicProfile,
} from "./review-state"

export function publicApplicationProfile(
  draft: ApplicationDraft,
  today: string,
  account: AccountFacts = {},
): PublicProfile {
  return {
    demo: true,
    version: draft.review?.profileVersion || 1,
    items: partnerPreview(draft, today, account)
      .filter(
        (item) => typeof item.value === "string" || Array.isArray(item.value),
      )
      .map((item) => ({
        id: item.id,
        label: item.label,
        value: Array.isArray(item.value) ? [...item.value] : String(item.value),
      })),
    photos: PHOTO_SLOTS.flatMap((slot) => {
      const photo = draft.photos[slot.id]
      return draft.sharing[slot.id] &&
        photo?.file &&
        photo.review === "기준 확인" &&
        !photoError(draft.photos, slot.id)
        ? [
            {
              slot: slot.id,
              label: slot.label,
              assetId: photo.file.id,
              version: photo.revision,
            },
          ]
        : []
    }),
  }
}
export function operatorApplicationOriginal(
  draft: ApplicationDraft,
  account: AccountFacts = {},
) {
  if (
    draft.values["consent.collection"] !== true ||
    draft.values["consent.matching"] !== true
  )
    return null
  return {
    demo: true,
    profileVersion: draft.review.profileVersion,
    values: Object.fromEntries(
      Object.entries(draft.values).map(([id, value]) => [
        id,
        Array.isArray(value) ? [...value] : value,
      ]),
    ),
    photos: clonePhotos(draft.photos),
    preferences: clonePreferences(draft.preferences),
    accountFacts: { ...account },
  }
}
export function receiveDemoApplication(
  draft: ApplicationDraft,
  today: string,
  account: AccountFacts = {},
  now = new Date().toISOString(),
) {
  const errors = validateApplication(draft, today, account)
  if (Object.keys(errors).length) return { draft, errors }
  const review = cloneReview(draft.review)
  review.submission = "received"
  review.receivedAt ||= now
  review.profileReview = "pending"
  review.newProposalsPaused = true
  return { draft: { ...draft, completedDemo: true, review }, errors }
}
export function suspendDemoApplication(
  draft: ApplicationDraft,
  status: "held" | "withdrawn",
) {
  const review = cloneReview(draft.review)
  review.submission = status
  review.newProposalsPaused = true
  review.existingAccessReviewRequired = true
  review.changeMessage =
    "새 제안을 중단하고 이미 제공된 프로필의 접근 범위를 재검토해요. 이미 본 화면·캡처까지 회수한다고 약속하지 않아요."
  if (review.preparation)
    review.preparation = {
      ...review.preparation,
      blocked: true,
      readyAt: null,
      consent: null,
      reconfirmRequired: true,
    }
  return {
    ...draft,
    review,
    completedDemo: false,
    values: {
      ...draft.values,
      "consent.provision": false,
      "consent.review": false,
    },
  }
}
export function applicationErrorLocation(id: string) {
  if (id === "preference.hold") return { step: 2, label: "신청 보류 의사", elementId: "preference-panel" };
  if (id === "desired.appearance.note") return { step: 2, label: "자유 설명", elementId: "appearance-note" };
  if (id.startsWith("sharing.")) {
    const fieldId = id.slice("sharing.".length)
    return {
      step: 3,
      label:
        APPLICATION_FIELDS.find((field) => field.id === fieldId)?.label ||
        (fieldId === PUBLIC_AGE_FIELD.id ? "만 나이 공개" : fieldId),
      elementId: `sharing-${fieldId.replace(/\./g, "-")}`,
    }
  }
  if (id === "submission.resume")
    return { step: 3, label: "신청 보류·철회 상태", elementId: "review-resume" }
  const field = APPLICATION_FIELDS.find((item) => item.id === id)
  return {
    step: field?.step ?? 3,
    label: field?.label || id,
    elementId:
      field?.format === "photo"
        ? `${id}-title`
        : `apply-${id.replace(/\./g, "-")}`,
  }
}
export function demoPreparationEligibility(
  draft: ApplicationDraft,
  today: string,
  account: AccountFacts = {},
) {
  const reasons: string[] = []
  if (Object.keys(validateApplication(draft, today, account)).length)
    reasons.push("필수 정보·공개·동의 확인 필요")
  if (draft.review.submission !== "received")
    reasons.push("신청 접수 전 또는 보류·철회 상태")
  if (draft.review.profileReview !== "reviewed")
    reasons.push("핵심 프로필 운영자 검토 필요")
  const age = accountAge(account, today)
  if (age === null || age < BEFORE_US.operatingDraft.minimumAge)
    reasons.push("본인 확인 전")
  if (
    REQUIRED_PUBLIC_PHOTOS.some(
      (id) =>
        draft.photos[id].review !== "기준 확인" || photoError(draft.photos, id),
    )
  )
    reasons.push("필수 사진 기준 확인 필요")
  if (BEFORE_US.unresolvedPolicies.provisionPeriod === null)
    reasons.push("상대 프로필 제공 기간 정책 검토 필요")
  return reasons
}
export function beginDemoPreparation(
  draft: ApplicationDraft,
  recipient: {
    id: string
    label: string
    proposalId: string
  },
  today: string,
  account: AccountFacts = {},
) {
  const reasons = demoPreparationEligibility(draft, today, account)
  if (!recipient.id || !recipient.label || !recipient.proposalId)
    reasons.push("구체적인 소개 상대 확인 필요")
  if (reasons.length) return { preparation: null, reasons }
  const preparation: Preparation = {
    demo: true,
    recipientId: recipient.id,
    recipientLabel: recipient.label,
    proposalId: recipient.proposalId,
    profileVersion: draft.review.profileVersion,
    profile: publicApplicationProfile(draft, today, account),
    period: BEFORE_US.unresolvedPolicies.provisionPeriod,
    consent: null,
    readyAt: null,
    disclosedAt: null,
    blocked: false,
    reconfirmRequired: false,
  }
  return { preparation, reasons }
}
export function publicPreparationResponse(
  draft: ApplicationDraft,
  now: string,
) {
  const preparation = draft.review.preparation
  if (
    !preparation ||
    preparation.blocked ||
    preparation.reconfirmRequired ||
    !preparation.period ||
    !preparation.readyAt ||
    preparation.profileVersion !== draft.review.profileVersion ||
    preparation.profile.version !== preparation.profileVersion ||
    preparation.consent?.recipientId !== preparation.recipientId ||
    preparation.consent?.profileVersion !== preparation.profileVersion ||
    draft.review.newProposalsPaused ||
    draft.review.submission !== "received" ||
    draft.review.profileReview !== "reviewed" ||
    draft.values["consent.collection"] !== true ||
    draft.values["consent.matching"] !== true ||
    draft.values["consent.provision"] !== true ||
    draft.values["consent.review"] !== true ||
    BEFORE_US.unresolvedPolicies.provisionPeriod === null
  )
    return null
  const instant = new Date(now)
  if (
    !Number.isFinite(instant.getTime()) ||
    !Number.isFinite(Date.parse(preparation.readyAt)) ||
    instant.getTime() < Date.parse(preparation.readyAt)
  )
    return null
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: BEFORE_US.introduction.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant)
  if (time !== BEFORE_US.introduction.readyAt) return null
  if (
    [...BASE_PUBLIC_FIELDS].some((id) => !draft.sharing[id]) ||
    REQUIRED_PUBLIC_PHOTOS.some(
      (id) =>
        !draft.sharing[id] ||
        draft.photos[id].review !== "기준 확인" ||
        photoError(draft.photos, id),
    )
  )
    return null
  return {
    recipientId: preparation.recipientId,
    proposalId: preparation.proposalId,
    profile: clonePublicProfile(preparation.profile),
  }
}
