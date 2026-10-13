import { BEFORE_US } from "./config"
import {
  accountAge,
  emptyApplication,
  validateApplication,
  type AccountFacts,
  type ApplicationDraft,
} from "./application-model"
import { publicApplicationProfile } from "./application-review"
import {
  COMPARABLE,
  PREFERENCE_FIELDS,
  compareRequiredPreference,
  preferenceValueText,
  requiredConditions,
} from "./preference-model"
import {
  MOCK_PHOTO_FILES,
  PHOTO_SLOTS,
  photoError,
  registerMockPhoto,
  type PhotoSlotId,
  type PhotoReview,
  type PHOTO_REVIEW_REASONS,
} from "./photo-model"
import { isWaitlisted } from "./gender-balance"
import { getIdentity } from "./identity-model"
import {
  REVIEW_CONSENTS,
  changedReview,
  clonePublicProfile,
  type PublicProfile,
} from "./review-state"

export type AdminMember = {
  id: string
  lifecycle?: "active" | "paused" | "blocked" | "withdrawal-requested"
  draft: ApplicationDraft
  account: AccountFacts
  participation: {
    available: boolean
    confirmedAt: string | null
  }
  rights: "none" | "valid" | "first-program-started"
  exchangePayment: "none" | "paid-not-started" | "started"
  unstartedPaymentReviewRequired: boolean
  activity: "idle" | "introduction" | "mutual" | "exchange-payment" | "agreement" | "exchange"
  blockedIds: string[]
  previousIds: string[]
  lastReviewedAt: string | null
  reviewedVersion: string | null
  operatorId: string | null
  disposition: "pending" | "photo-revision" | "waiting" | "reviewed"
  policyVersion: string
}
export type ComparisonRow = {
  id: string
  label: string
  expected: string
  actual: string
  status: "충족" | "미충족" | "확인 필요" | "조건 없음"
}
type VersionRecord = {
  profile: number
  preference: number
  consent: string
  policy: string
  photos: string
}
export type DemoProposal = {
  id: string
  version: number
  members: [string, string]
  versions: Record<string, VersionRecord>
  profiles: Record<string, PublicProfile>
  reason: string
  status: "prepared" | "scheduled" | "waiting"
  preparedAt: string
  scheduledAt: string | null
}
export type AdminState = {
  revision: number
  members: AdminMember[]
  proposals: DemoProposal[]
  stateUpdatedAt: string | null
}
export const emptyAdmin = (): AdminState => ({
  revision: 0,
  members: [],
  proposals: [],
  stateUpdatedAt: null,
})
export const seoulDate = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: BEFORE_US.introduction.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
const display = (value: unknown) =>
  Array.isArray(value)
    ? value.join(" · ")
    : value === undefined || value === ""
      ? "미입력"
      : String(value)
export function memberVersions(member: AdminMember): VersionRecord {
  return {
    profile: member.draft.review.profileVersion,
    preference: member.draft.review.preferenceVersion,
    consent: JSON.stringify(
      REVIEW_CONSENTS.map((field) => member.draft.values[field.id] === true),
    ),
    policy: member.policyVersion,
    photos: JSON.stringify(
      PHOTO_SLOTS.map((slot) => [
        slot.id,
        member.draft.photos[slot.id].revision,
        member.draft.photos[slot.id].review,
        member.draft.photos[slot.id].file?.id,
      ]),
    ),
  }
}
const versionKey = (member: AdminMember) =>
  JSON.stringify(memberVersions(member))
export function applicationMember(draft: ApplicationDraft): AdminMember {
  return {
    id: "current-application",
    draft,
    account: {},
    participation: { available: false, confirmedAt: null },
    rights: "none",
    exchangePayment: "none",
    unstartedPaymentReviewRequired: false,
    activity: "idle",
    blockedIds: [],
    previousIds: [],
    lastReviewedAt: null,
    reviewedVersion: null,
    operatorId: null,
    disposition: "pending",
    policyVersion: BEFORE_US.policyVersion,
  }
}
export function compareMembers(
  owner: AdminMember,
  counterpart: AdminMember,
  today: string,
): ComparisonRow[] {
  const actual: Record<string, string | string[] | number | undefined> = {
    ...Object.fromEntries(Object.entries(counterpart.draft.values).filter(([, value]) => typeof value !== "boolean")) as Record<string, string | string[]>,
    "self.age": accountAge(counterpart.account, today) ?? undefined,
  }
  const actualKeys: Record<string, string> = {
    "desired.ageMode": "self.age",
    "desired.regions": "self.province",
    "desired.purpose": "self.purpose",
    "desired.smoking": "self.smoking",
    "desired.appearance.heightMode": "self.height",
  }
  return COMPARABLE.map((id) => {
    const required = owner.draft.preferences.importance[id] === "required"
    const result = required
      ? compareRequiredPreference(id, owner.draft.values, actual)
      : null
    return {
      id,
      label: PREFERENCE_FIELDS.find((field) => field.id === id)?.label || id,
      expected: String(preferenceValueText(id, owner.draft.values)),
      actual: display(actual[actualKeys[id]]),
      status: !required
        ? "조건 없음"
        : result === "불충족"
          ? "미충족"
          : result!,
    }
  })
}
export function reviewIssues(member: AdminMember, today: string) {
  const issues: string[] = []
  if (
    Object.keys(validateApplication(member.draft, today, member.account)).length
  )
    issues.push("필수 정보·사진 등록·공개·동의 보완 필요")
  if (member.draft.review.submission !== "received")
    issues.push("신청 접수 상태 확인 필요")
  const age = accountAge(member.account, today)
  if (
    age === null ||
    age === undefined ||
    age < BEFORE_US.operatingDraft.minimumAge
  )
    issues.push("본인·성인 확인 필요 (자기진술과 별도)")
  if (
    PHOTO_SLOTS.some(
      (slot) =>
        slot.required &&
        (member.draft.photos[slot.id].review !== "기준 확인" ||
          photoError(member.draft.photos, slot.id)),
    )
  )
    issues.push("필수 사진 기준 확인 또는 해당 사진 보완 필요")
  if (member.draft.values["self.statement"] !== true)
    issues.push("현재 관계·성실한 참여 자기진술 필요")
  return issues
}
export function pairIssues(
  state: AdminState,
  left: AdminMember,
  right: AdminMember,
  today: string,
  ownProposalId?: string,
) {
  const issues: string[] = []
  if (left.id === right.id) issues.push("같은 신청자 배정 불가")
  for (const member of [left, right]) {
    issues.push(
      ...reviewIssues(member, today).map((issue) => `${member.id}: ${issue}`),
    )
    if (
      member.reviewedVersion !== versionKey(member) ||
      member.draft.review.profileReview !== "reviewed"
    )
      issues.push(`${member.id}: 최신 버전 직접 검토 필요`)
    if (!member.participation.available || !member.participation.confirmedAt)
      issues.push(`${member.id}: 현재 참여 가능 확인 필요`)
    if (member.activity !== "idle")
      issues.push(
        `${member.id}: 활성 소개·상호 선택·결제·방식 합의·교류 진행 중`,
      )
    if (member.lifecycle && member.lifecycle !== "active") issues.push(`${member.id}: 일시정지·차단·탈퇴 요청 상태로 새 소개 불가`)
    if (isWaitlisted(member.id)) issues.push(`${member.id}: 성비 순차 검토 대기 중 · 대기열에서 검토 시작 필요`)
    if (getIdentity(member.id)?.rejoinFlag) issues.push(`${member.id}: 이전 이용 제한 계정과 같은 인증값 · 재가입 확인 필요`)
    if (member.rights === "first-program-started")
      issues.push(`${member.id}: 첫 교류 시작 후 재이용 정책 별도 확인 필요`)
    if (member.policyVersion !== BEFORE_US.policyVersion)
      issues.push(`${member.id}: 초기 V6 적용 확인 필요`)
    if (
      state.proposals.some(
        (proposal) =>
          proposal.id !== ownProposalId &&
          proposal.status !== "waiting" &&
          proposal.members.includes(member.id),
      )
    )
      issues.push(`${member.id}: 다른 후보 준비·예약 중`)
  }
  if (left.blockedIds.includes(right.id) || right.blockedIds.includes(left.id))
    issues.push("차단 관계: 배정 불가")
  if (
    left.previousIds.includes(right.id) ||
    right.previousIds.includes(left.id) ||
    state.proposals.some(
      (proposal) =>
        proposal.id !== ownProposalId &&
        proposal.members.includes(left.id) &&
        proposal.members.includes(right.id),
    )
  )
    issues.push("동일 상대 반복 배정 불가")
  for (const [owner, other] of [
    [left, right],
    [right, left],
  ]) {
    const gender = other.draft.values["self.gender"]
    if (
      !["여성", "남성"].includes(String(gender)) ||
      owner.draft.values["desired.gender"] !== gender ||
      owner.draft.values["self.gender"] === gender
    )
      issues.push(`${owner.id}: 상호 소개 대상 확인 필요 (사진 추론 없음)`)
    for (const row of compareMembers(owner, other, today))
      if (row.status === "미충족" || row.status === "확인 필요")
        issues.push(`${owner.id}: ${row.label} ${row.status}`)
    if (
      requiredConditions(owner.draft.preferences).some(
        (id) => !COMPARABLE.includes(id),
      )
    )
      issues.push(`${owner.id}: 비교 불가능한 필수 조건은 운영자 확인 필요`)
  }
  return [...new Set(issues)]
}
export function publicReason(
  left: AdminMember,
  right: AdminMember,
  today: string,
) {
  const leftProfile = publicApplicationProfile(left.draft, today, left.account)
  const rightProfile = publicApplicationProfile(
    right.draft,
    today,
    right.account,
  )
  const leftPurpose = leftProfile.items.find(
    (item) => item.id === "self.purpose",
  )?.value
  const rightPurpose = rightProfile.items.find(
    (item) => item.id === "self.purpose",
  )?.value
  return typeof leftPurpose === "string" && leftPurpose === rightPurpose
    ? `두 분이 공개한 관계 목적은 ‘${leftPurpose}’입니다. 서로 알아가며 직접 확인해 주세요.`
    : "두 분이 공개에 동의한 소개 프로필을 확인하고, 더 알아가고 싶은지 직접 선택해 주세요."
}
type AdminCommand = {
  kind: "review"
  memberId: string
} | {
  kind: "photo-review"
  memberId: string
  slot: PhotoSlotId
  review: PhotoReview
  reason: typeof PHOTO_REVIEW_REASONS[number] | null
} | {
  kind: "waiting"
  memberId: string
} | {
  kind: "prepare"
  leftId: string
  rightId: string
  considered: boolean
} | {
  kind: "schedule"
  proposalId: string
  scheduledAt: string
} | {
  kind: "release-to-waiting"
  proposalId: string
}
export function reservationIssues(
  state: AdminState,
  proposal: DemoProposal,
  today: string,
) {
  const members = proposal.members.map((id) =>
    state.members.find((member) => member.id === id),
  )
  if (!members[0] || !members[1]) return ["신청자 정보 확인 필요"]
  const issues = pairIssues(state, members[0], members[1], today, proposal.id)
  if (proposal.status !== "prepared") issues.push("소개 준비 상태가 아닙니다")
  for (const member of [members[0], members[1]]) {
    if (member.rights !== "valid")
      issues.push(
        `${member.id}: 유효한 소개 이용 권리 필요 · 준비 후 5,000원 안내`,
      )
    if (JSON.stringify(proposal.versions[member.id]) !== versionKey(member))
      issues.push(`${member.id}: 준비 후 변경된 버전 재검토 필요`)
    const preparation = member.draft.review.preparation
    const otherId = proposal.members.find((id) => id !== member.id)
    if (
      !preparation ||
      preparation.blocked ||
      preparation.reconfirmRequired ||
      preparation.proposalId !== proposal.id ||
      preparation.recipientId !== otherId ||
      preparation.profileVersion !== member.draft.review.profileVersion ||
      !preparation.consent ||
      preparation.consent.recipientId !== otherId ||
      preparation.consent.profileVersion !==
        member.draft.review.profileVersion ||
      !preparation.period
    )
      issues.push(
        `${member.id}: 특정 상대·공개 항목·기간에 대한 본인 제공 동의 필요`,
      )
  }
  for (const member of [members[0], members[1]]) {
    const preparation = member.draft.review.preparation
    if (preparation && JSON.stringify(clonePublicProfile(preparation.profile)) !== JSON.stringify(proposal.profiles[member.id])) issues.push(`${member.id}: 동의한 제공 프로필과 준비 스냅샷 불일치`)
  }
  if (BEFORE_US.unresolvedPolicies.provisionPeriod === null)
    issues.push("상대 프로필 제공 기간 정책 미확정: 실제 공개 예약 차단")
  return [...new Set(issues)]
}
export function adminTransition(
  state: AdminState,
  expectedRevision: number,
  command: AdminCommand,
  now = new Date(),
): {
  state: AdminState
  errors: string[]
} {
  const fail = (...errors: string[]) => ({ state, errors })
  if (state.revision !== expectedRevision)
    return fail("화면 버전이 변경되었습니다. 최신 상태에서 다시 검토해 주세요.")
  const today = seoulDate(now)
  const at = now.toISOString()
  const next = structuredClone(state)
  if (
    command.kind === "review" ||
    command.kind === "waiting" ||
    command.kind === "photo-review"
  ) {
    const member = next.members.find((item) => item.id === command.memberId)
    if (!member) return fail("신청자를 찾을 수 없습니다")
    if (command.kind === "photo-review") {
      if (
        member.draft.values["consent.collection"] !== true ||
        member.draft.values["consent.matching"] !== true
      )
        return fail("운영자 검토 동의가 필요합니다")
      const record = member.draft.photos[command.slot]
      if (!record.file) return fail("등록된 사진이 없습니다")
      if (command.review === "재등록 요청" && !command.reason)
        return fail("문제 사진의 보완 사유를 선택해 주세요")
      if (
        command.review === "기준 확인" &&
        photoError(member.draft.photos, command.slot) &&
        record.review !== "재등록 요청"
      )
        return fail("등록 오류·사진 자기확인을 먼저 확인해 주세요")
      if (command.review === "기준 확인" && record.review === "재등록 요청")
        return fail("회원이 문제 사진을 다시 등록한 뒤 재검토해 주세요")
      member.draft.photos[command.slot] = {
        ...record,
        review: command.review,
        reason: command.review === "재등록 요청" ? command.reason : null,
      }
      member.draft.review = changedReview(member.draft.review, "photo")
      member.lastReviewedAt = at
      member.operatorId = "demo-operator"
      member.reviewedVersion = null
      member.disposition =
        command.review === "재등록 요청" ? "photo-revision" : "pending"
    } else if (command.kind === "review") {
      member.lastReviewedAt = at
      member.operatorId = "demo-operator"
      const issues = reviewIssues(member, today)
      const photoNeedsRevision = PHOTO_SLOTS.some(
        (slot) =>
          slot.required &&
          (photoError(member.draft.photos, slot.id) ||
            member.draft.photos[slot.id].review === "재등록 요청"),
      )
      member.disposition = issues.length
        ? photoNeedsRevision
          ? "photo-revision"
          : "pending"
        : "reviewed"
      member.draft.review.profileReview = issues.length ? "pending" : "reviewed"
      member.draft.review.newProposalsPaused = issues.length > 0
      member.reviewedVersion = issues.length ? null : versionKey(member)
    } else {
      if (reviewIssues(member, today).length)
        return fail("신청·사진·본인 확인 보완과 후보 부족 대기를 구분해 주세요")
      if (
        member.activity !== "idle" ||
        next.proposals.some(
          (proposal) =>
            proposal.status !== "waiting" &&
            proposal.members.includes(member.id),
        )
      )
        return fail("진행 중인 소개·후보 준비는 별도 중단 절차가 필요합니다")
      member.disposition = "waiting"
    }
  } else if (command.kind === "prepare") {
    const left = next.members.find((member) => member.id === command.leftId)
    const right = next.members.find((member) => member.id === command.rightId)
    if (!left || !right) return fail("양쪽 신청자를 선택해 주세요")
    const issues = pairIssues(next, left, right, today)
    if (!command.considered)
      issues.push(
        "운영자가 양쪽 취향·생활·대화·현재 참여 가능성을 함께 검토해 주세요",
      )
    if (issues.length) return fail(...issues)
    next.proposals.push({
      id: `demo-proposal-${next.revision + 1}`,
      version: 1,
      members: [left.id, right.id],
      versions: {
        [left.id]: memberVersions(left),
        [right.id]: memberVersions(right),
      },
      profiles: {
        [left.id]: clonePublicProfile(
          publicApplicationProfile(left.draft, today, left.account),
        ),
        [right.id]: clonePublicProfile(
          publicApplicationProfile(right.draft, today, right.account),
        ),
      },
      reason: publicReason(left, right, today),
      status: "prepared",
      preparedAt: at,
      scheduledAt: null,
    })
  } else {
    const proposal = next.proposals.find(
      (item) => item.id === command.proposalId,
    )
    if (!proposal) return fail("제안을 찾을 수 없습니다")
    if (command.kind === "release-to-waiting") {
      proposal.status = "waiting"
      proposal.scheduledAt = null
      for (const member of next.members.filter((item) =>
        proposal.members.includes(item.id),
      )) {
        member.disposition = "waiting"
        if (member.exchangePayment === "paid-not-started") member.unstartedPaymentReviewRequired = true
      }
    } else {
      const issues = reservationIssues(next, proposal, today)
      const date = new Date(command.scheduledAt)
      if (
        !Number.isFinite(date.getTime()) ||
        date <= now ||
        new Intl.DateTimeFormat("en-GB", {
          timeZone: BEFORE_US.introduction.timezone,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).format(date) !== "12:00:00" ||
        date.getUTCMilliseconds() !== 0
      )
        issues.push("앞으로 준비된 날 정오 12:00 Asia/Seoul만 예약 가능")
      if (
        Number.isFinite(date.getTime()) &&
        next.proposals.some(
          (item) =>
            item.id !== proposal.id &&
            item.scheduledAt &&
            seoulDate(new Date(item.scheduledAt)) === seoulDate(date) &&
            item.members.some((id) => proposal.members.includes(id)),
        )
      )
        issues.push("회원당 하루 최대 한 명: 같은 날 중복 예약 불가")
      if (issues.length) return fail(...issues)
      proposal.status = "scheduled"
      proposal.scheduledAt = date.toISOString()
    }
  }
  next.revision += 1
  next.stateUpdatedAt = at
  return { state: next, errors: [] }
}
export function loadAdminFixtures(now = new Date()): AdminState {
  const members = ["가상 신청자 A", "가상 신청자 B", "가상 신청자 C"].map(
    (name, index): AdminMember => {
      const draft = emptyApplication()
      draft.values = {
        "self.name": name.replace(" 신청자", ""),
        "self.gender": index === 0 ? "여성" : "남성",
        "desired.gender": index === 0 ? "남성" : "여성",
        "self.province": "서울",
        "self.area": "가상구",
        "self.purpose": "진지한 연애",
        "self.bio":
          "이것은 실제 회원이 아닌 관리자 기능 설명을 위한 가상 소개입니다.",
        "self.statement": true,
        "self.pledge": true,
        "self.smoking": index === 2 ? "자주" : "안 함",
        "self.work": "디자인·콘텐츠",
        "self.workTitle": "가상 콘텐츠 기획자",
        "desired.regions": ["서울"],
        "desired.meetingRegions": ["서울", "경기"],
        "desired.travelTime": "60분",
        "desired.smoking": "비흡연 선호",
      }
      for (const consent of REVIEW_CONSENTS.filter((field) => field.required))
        draft.values[consent.id] = true
      draft.preferences.importance["desired.smoking"] = "required"
      draft.preferences.importance["desired.regions"] = "required"
      for (const [slotIndex, slot] of PHOTO_SLOTS.entries())
        if (slot.required) {
          draft.photos = registerMockPhoto(draft.photos, slot.id, {
            ...MOCK_PHOTO_FILES[slotIndex],
            id: `demo-${index}-${slotIndex}`,
          })
          draft.photos[slot.id] = {
            ...draft.photos[slot.id],
            recentSelfConfirmed: true,
            rightsSelfConfirmed: true,
            review: "기준 확인",
          }
        }
      draft.review.submission = "received"
      draft.review.receivedAt = now.toISOString()
      return {
        ...applicationMember(draft),
        id: `demo-${index + 1}`,
        account: { verifiedAge: 28 + index, verifiedAt: now.toISOString() },
        participation: { available: true, confirmedAt: now.toISOString() },
        rights: index === 1 ? "valid" : "none",
      }
    },
  )
  return {
    revision: 1,
    members,
    proposals: [],
    stateUpdatedAt: now.toISOString(),
  }
}
