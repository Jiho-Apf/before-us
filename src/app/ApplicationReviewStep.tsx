import { useState, type ReactNode } from "react"
import { Check, LockKeyhole, Pencil, ShieldCheck } from "lucide-react"
import { Button } from "./components/ui/button"
import { Checkbox } from "./components/ui/checkbox"
import {
  APPLICATION_FIELDS,
  PUBLIC_AGE_FIELD,
  accountAge,
  answerState,
  type AccountFacts,
  type ApplicationDraft,
} from "./application-model"
import { publicApplicationProfile } from "./application-review"
import { LIVE } from "./backend/client"
import { PHOTO_SLOTS, photoError } from "./photo-model"
import {
  BASE_PUBLIC_FIELDS,
  OPTIONAL_PUBLIC_FIELDS,
  REVIEW_CONSENTS,
  REQUIRED_PUBLIC_PHOTOS,
  type PublicProfile,
} from "./review-state"

const interaction =
  "transition-colors duration-200 motion-reduce:transition-none"
const text = (value: string | string[]) =>
  Array.isArray(value) ? value.join(" · ") : value

export function PublicProfilePreview({ profile }: { profile: PublicProfile }) {
  const name = profile.items.find((item) => item.id === "self.name")
  const photos = [
    ...REQUIRED_PUBLIC_PHOTOS,
    ...profile.photos
      .filter((photo) => photo.slot === "photo.daily")
      .map((photo) => photo.slot),
  ]
  return (
    <aside
      aria-labelledby="public-preview-title"
      className="order-first self-start overflow-hidden border border-border bg-background lg:sticky lg:top-6 lg:order-none lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto"
    >
      <div className="bg-accent px-5 py-3 text-[11px] text-accent-foreground">
        {LIVE ? "PREVIEW · 상대에게 보일 모습" : "SPECIFIC INTRODUCTION · DEMO"}
      </div>
      <div className="border-b border-border p-5">
        <h3 id="public-preview-title" className="text-sm font-semibold">
          상대에게 보일 프로필
        </h3>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          특정 소개 상대에게만 · 아직 전달하지 않았어요
        </p>
      </div>
      <div className="grid grid-cols-3 gap-px bg-border">
        {photos.map((slotId) => {
          const photo = profile.photos.find((item) => item.slot === slotId)
          return (
            <div
              key={slotId}
              className="flex aspect-[3/4] flex-col items-center justify-center gap-3 bg-muted px-2 text-center"
            >
              <span
                className={`size-7 rounded-full border-2 ${
                  photo ? "border-primary" : "border-border"
                }`}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                {PHOTO_SLOTS.find((slot) => slot.id === slotId)?.label}
                <br />
                  {photo ? LIVE ? "운영진이 확인한 사진" : "기준 확인된 가상 사진" : LIVE ? "운영진 확인 뒤 표시" : "제공할 사진 없음"}
              </p>
            </div>
          )
        })}
      </div>
      <div className="p-5">
        <h4 className="text-xl font-semibold">
          {name ? text(name.value) : "공개 이름 없음"}
        </h4>
        <dl className="mt-5 space-y-4">
          {profile.items
            .filter((item) => item.id !== "self.name")
            .map((item) => (
              <div key={item.id}>
                <dt className="text-xs text-muted-foreground">
                  {item.label}
                </dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-xs leading-7">
                  {text(item.value)}
                </dd>
              </div>
            ))}
        </dl>
        <p className="mt-6 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">
          {LIVE ? "선택 정보는 공개를 켠 항목만 표시해요. 소개가 열리면 상대에게 이렇게 보여요." : "선택 정보는 공개를 켠 항목만 표시해요. 가상 프로필 예시이며 실제 회원에게 제공되지 않아요."}
        </p>
      </div>
    </aside>
  )
}

export default function ApplicationReviewStep({
  draft,
  today,
  account,
  errors,
  onSharing,
  onConsent,
  onEdit,
  onSuspend,
  onResume,
  top,
}: {
  top?: ReactNode
  draft: ApplicationDraft
  today: string
  account: AccountFacts
  errors: Record<string, string>
  onSharing: (id: string, checked: boolean) => void
  onConsent: (id: string, checked: boolean) => void
  onEdit: (step: number, optional?: boolean) => void
  onSuspend: (status: "held" | "withdrawn") => void
  onResume: () => void
}) {
  const [pendingAction, setPendingAction] =
    useState<"held" | "withdrawn" | null>(null)
  const profile = publicApplicationProfile(draft, today, account)
  const review = draft.review
  const verifiedAge = accountAge(account, today)
  const checkedPhotos = draft.photos
    ? REQUIRED_PUBLIC_PHOTOS.filter(
        (id) =>
          draft.photos[id].review === "기준 확인" &&
          !photoError(draft.photos, id),
      ).length
    : 0
  const rows = (ids: readonly string[], required: boolean) =>
    ids.map((id) => {
      const field = APPLICATION_FIELDS.find((item) => item.id === id)
      const label =
        id === PUBLIC_AGE_FIELD.id
          ? "만 나이만 · 생년월일 원값 비공개"
          : field?.label || id
      const available =
        id === PUBLIC_AGE_FIELD.id
          ? profile.items.some((item) => item.id === id) ||
            !!draft.values["self.birthDate"] ||
            verifiedAge !== null
          : answerState(draft.values[id]) === "answered"
      const error = errors[`sharing.${id}`]
      return (
        <div key={id} className="border-b border-border py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold">{label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {required
                  ? "기본 소개 · 필요한 공개"
                  : available
                    ? "선택 공개 · 기본 꺼짐"
                    : "미입력 · 제출 가능"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <label className="flex items-center gap-2 text-[11px]">
                <Checkbox
                  id={`sharing-${id.replace(/\./g, "-")}`}
                  checked={draft.sharing[id] || false}
                  onCheckedChange={(checked) => onSharing(id, checked === true)}
                  disabled={!required && !available}
                  aria-invalid={!!error}
                />
                상대 공개
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`${label} 수정`}
                onClick={() => onEdit(0, field?.group === "optional")}
                className={`h-8 rounded-lg px-2 ${interaction}`}
              >
                <Pencil size={12} />
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )
    })
  return (
    <div className="space-y-7">
      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,8fr)_minmax(260px,4fr)]">
        <div className="min-w-0 space-y-7">
          {top}
      <header>
        <p className="text-[11px] font-semibold text-accent">
          FINAL CHECK · 마지막 확인
        </p>
        <h2 className="mt-3 text-2xl font-semibold leading-9">
          상대에게 보일 내용을 확인해 주세요.
        </h2>
        <p className="mt-3 text-xs leading-7 text-muted-foreground">
          전체 회원에게 공개하는 게시물이 아니에요. 소개받는 특정 상대에게
          보여줄 범위를 확인해 주세요. 지금은 제공 준비이며, 아직 상대에게
          보내지 않아요.
        </p>
      </header>
      {draft.completedDemo && review.submission === "received" && (
        <section
          role="status"
          className="border-l-2 border-primary bg-primary/5 p-5"
        >
          <span className="text-xs font-semibold text-primary">
            가상 신청 접수 · 실제 접수 아님
          </span>
          <h3 className="mt-2 text-xl font-semibold">소개 신청을 받았어요.</h3>
          <p className="mt-3 text-sm leading-7">
            내용을 살펴보고, 소개 가능한 상대가 준비되면 안내드릴게요.
          </p>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            사진 확인·본인 확인·소개 준비 완료와는 다른 단계예요. 실제
            수집·결제·발송은 진행되지 않았어요.
          </p>
        </section>
      )}
          <section>
            <h3 className="text-sm font-semibold">01 · 기본 소개 프로필</h3>
            <div className="mt-3">{rows(BASE_PUBLIC_FIELDS, true)}</div>
            <div className="mt-3 space-y-3">
              {PHOTO_SLOTS.map((slot) => {
                const photo = draft.photos[slot.id]
                const error = errors[`sharing.${slot.id}`]
                return (
                  <div key={slot.id} className="border-b border-border py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold">
                          {slot.number}. {slot.label}{" "}
                          <span className="font-normal text-muted-foreground">
                            {slot.required ? "필수" : "선택"}
                          </span>
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {photo.file
                            ? LIVE ? `${photo.review === "대기" ? "검토 대기" : photo.review}` : `${photo.review} · 가상 사진 초안 v${photo.revision}`
                            : "미등록"}
                          {photo.review !== "기준 확인" &&
                            " · 제공용 데이터에 포함되지 않음"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <label className="flex items-center gap-2 text-[11px]">
                          <Checkbox
                            id={`sharing-${slot.id.replace(/\./g, "-")}`}
                            checked={draft.sharing[slot.id] || false}
                            disabled={!slot.required && !photo.file}
                            onCheckedChange={(checked) =>
                              onSharing(slot.id, checked === true)
                            }
                            aria-invalid={!!error}
                          />
                          상대 공개
                        </label>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`${slot.label} 수정`}
                          onClick={() => onEdit(1)}
                          className="h-8 rounded-lg px-2"
                        >
                          <Pencil size={12} />
                        </Button>
                      </div>
                    </div>
                    {error && (
                      <p role="alert" className="mt-2 text-xs text-destructive">
                        {error}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="mt-4 text-xs leading-7 text-muted-foreground">
              필수 3장을 등록하면 신청할 수 있지만, 소개 제공에는 사진 기준
              확인이 필요해요. 필수 사진 3장과 공개를 선택한 선택 사진 중
              검토된 사진만 제공하며, 사진 기준 확인은 외모·인성·안전 인증이
              아니에요.
            </p>
          </section>
          <section>
            <h3 className="text-sm font-semibold">02 · 내가 켠 추가 정보만</h3>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              MBTI·자기소개·나를 설명하는 태그·키·생활·관심사·직무 분야·직업명·질문 답변은 공개를 선택한 항목만. 직무 분야와 직업명은 각각 기본 비공개이며, 미입력을 무직으로 판단하지 않아요. 미작성
              선택 문항은 신청을 막지 않아요.
            </p>
            <div className="mt-3">{rows(OPTIONAL_PUBLIC_FIELDS, false)}</div>
          </section>
          <section className="rounded-xl bg-muted p-5">
            <div className="flex items-center gap-2">
              <LockKeyhole size={15} className="text-primary" />
              <h3 className="text-sm font-semibold">
                상대에게 제공하지 않는 정보
              </h3>
            </div>
            <p className="mt-3 text-xs leading-7 text-muted-foreground">
              정확한 생년월일, 계정·인증 연락처·확인 자료, 이상형·희망
              나이·키·체형·인상·필수 조건, 운영자 메모·보완 이력·거절 사유는
              소개 프로필에 포함되지 않아요.
            </p>
            <p className="mt-2 text-xs leading-7 text-muted-foreground">선호 MBTI·선호 성향·연애 중요 기준·자유 이상형 설명도 운영자용 비공개예요. MBTI는 자기진술 참고 정보이며 성격 검증이나 궁합 점수가 아니에요.</p>
            <p className="mt-2 text-xs leading-7 text-muted-foreground">본인 성별·체형·스타일 응답은 운영자 참고용이며, 이번 소개 프로필 제공 항목에는 포함하지 않아요.</p>
            <Button
              type="button"
              variant="link"
              onClick={() => onEdit(2)}
              className="mt-2 h-auto p-0 text-xs"
            >
              비공개 선호 수정하기
            </Button>
          </section>
          <section>
            <h3 className="text-sm font-semibold">
              03 · 목적별로 따로 확인해요
            </h3>
            <div className="mt-4 space-y-3">
              {REVIEW_CONSENTS.map((field) => (
                <div
                  key={field.id}
                  className="rounded-xl border border-border p-4"
                >
                  <label className="flex cursor-pointer items-start gap-3">
                    <Checkbox
                      id={`apply-${field.id.replace(/\./g, "-")}`}
                      checked={draft.values[field.id] === true}
                      onCheckedChange={(checked) =>
                        onConsent(field.id, checked === true)
                      }
                      aria-invalid={!!errors[field.id]}
                      className="mt-1"
                    />
                    <span className="text-xs leading-7">
                      <span className="font-semibold">
                        {field.required ? "필수" : "선택"}
                      </span>
                      <br />
                      {field.label}
                    </span>
                  </label>
                  <p className="ml-7 mt-2 text-xs leading-6 text-muted-foreground">
                    {field.purpose}
                  </p>
                  {field.id === "consent.provision" && (
                    <dl className="ml-7 mt-3 grid gap-x-4 gap-y-2 rounded-xl bg-muted/40 p-4 text-xs leading-6 text-muted-foreground sm:grid-cols-[64px_1fr] [&>div]:contents">
                      <div>
                        <dt className="font-semibold text-foreground">
                          항목·목적
                        </dt>
                        <dd>
                          오른쪽에서 확인한 사진·소개 정보로 일대일 소개를
                          준비해요.
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-foreground">범위</dt>
                        <dd>
                          구체적인 소개 제안의 특정 상대만. 전체 회원·연락처
                          공유·후기 게시·홍보 사진 사용은 포함하지 않아요.
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-foreground">기간</dt>
                        <dd>
                          소개된 날 정오부터 다음 날 11:00 응답 마감까지예요.
                          서로 알아가기로 하면 교류·약속이 끝날 때까지(최대 약속일
                          다음 날 23:59) 이어지고, 종료·중단·차단·탈퇴 시 바로
                          닫혀요. 끝난 소개를 다시 보는 보관함은 없어요.
                        </dd>
                      </div>
                    </dl>
                  )}
                  {errors[field.id] && (
                    <p role="alert" className="mt-2 text-xs text-destructive">
                      {errors[field.id]}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-7 text-muted-foreground">
              {LIVE ? <>필수 항목에 동의해야 신청할 수 있어요. 자세한 내용은 <a href="/terms" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-primary">이용약관</a>과 <a href="/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-primary">개인정보처리방침</a>에서 볼 수 있어요. 선택 마케팅과 소개 없는 날 알림은 체크하지 않아도 신청할 수 있어요.</> : "법적 문서·보유기간은 검토가 필요한 정책이에요. 법률 검토 완료나 실제 개인정보 처리 동의로 표시하지 않아요. 선택 마케팅과 정오 상태 알림은 체크하지 않아도 신청할 수 있어요."}
            </p>
          </section>
        </div>
        <PublicProfilePreview profile={profile} />
      </div>
      <details className="border-y border-border py-5">
        <summary className="cursor-pointer text-sm font-semibold">
          신청 뒤, 프로필 제공은 이렇게 준비해요
        </summary>
        <div className="mt-5 grid gap-3 sm:grid-cols-5">
          {[
            "신청 내용 검토",
            "사진·본인 확인",
            "특정 상대·범위 안내",
            "별도 제공 동의",
            "준비 후 정오 소개",
          ].map((label, index) => (
            <div key={label} className="border border-border p-4">
              <span className="text-xl font-semibold text-accent">
                0{index + 1}
              </span>
              <p className="mt-3 text-xs leading-6">{label}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs leading-7 text-muted-foreground">
          구체적인 소개 제안 전에 제공받는 상대, 공개 항목·버전과 제공 기간을
          확인해요. 이때는 프로필 제공 준비이지 최종 호감 선택이 아니에요.
          필요한 준비와 동의가 실제로 완료된 뒤에만 준비된 날 정오 12:00,
          Asia/Seoul에 소개를 공개해요.
        </p>
        <p className="mt-3 text-xs leading-7 text-muted-foreground">
          현재는 상대 미정 · 별도 제공 동의 전이며 실제 공개하지 않아요.
          매일 새 소개를 보장하지 않아요.
        </p>
      </details>
      <section className="rounded-xl border border-border p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={15} className="text-accent" />
          <h3 className="text-sm font-semibold">각 단계는 별도로 확인해요</h3>
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            ["계정", "로그인 상태와 별도 관리"],
            [
              "신청",
              review.submission === "received"
                ? LIVE ? "접수 · 검토 대기" : "데모 접수 · 검토 대기"
                : review.submission === "held"
                  ? LIVE ? "신청 보류" : "신청 보류 · 데모"
                  : review.submission === "withdrawn"
                    ? LIVE ? "신청 철회" : "신청 철회 · 데모"
                    : "아직 접수 전",
            ],
            ["필수 사진", LIVE ? `운영진 확인 ${checkedPhotos}/3` : `기준 확인 ${checkedPhotos}/3 · 가상 검토`],
            [
              "본인 확인",
              verifiedAge === null
                ? "확인 전 · 직접 적은 내용이에요(인증 아님)"
                : "기존 인증값 참고",
            ],
            [
              "핵심 프로필",
              review.profileReview === "reviewed"
                ? LIVE ? "검토 확인" : "가상 검토 확인"
                : "운영자 검토 전",
            ],
            ["소개 제공", "준비 미완료 · 아직 전달 안 함"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-2 text-xs leading-6">{value}</dd>
            </div>
          ))}
        </dl>
        {review.changeMessage && (
          <p
            role="status"
            className="mt-5 rounded-xl bg-muted p-4 text-xs leading-7"
          >
            {review.changeMessage}
          </p>
        )}
      </section>
      <section className="border-t border-border pt-5">
        <p className="text-xs leading-7 text-muted-foreground">
          필요한 공개에 동의하지 않으면 신청을 보류하거나 철회할 수 있어요.
          사진·핵심 정보 수정은 새 버전으로 재검토하며, 승인되지 않은 사진으로
          진행 중 제안을 덮어쓰지 않아요.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {!LIVE && <Button
            type="button"
            variant="outline"
            onClick={() => setPendingAction("held")}
            className="rounded-xl text-xs"
          >
            신청 보류 · 데모
          </Button>}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setPendingAction("withdrawn")}
            className="rounded-xl text-xs"
          >
            {LIVE ? "신청 철회" : "신청 철회 · 데모"}
          </Button>
          {(review.submission === "held" ||
            review.submission === "withdrawn") && (
            <Button
              id="review-resume"
              type="button"
              onClick={onResume}
              className="rounded-xl text-xs"
            >
              다시 작성하기
            </Button>
          )}
        </div>
        {pendingAction && (
          <div role="alert" className="mt-4 rounded-xl bg-muted p-4">
            <p className="text-xs leading-7">
              {LIVE ? "신청을 철회하면 소개 준비가 멈추고, 다시 신청하려면 문의하기로 요청해야 해요. 이미 본 화면이나 캡처까지 회수한다고 약속하지 않아요." : <>{pendingAction === "held" ? "신청을 보류" : "신청을 철회"}하는 의사를 데모에만 기록해요. 실제 운영 처리는 하지 않아요. 새 제안 중단·기존 접근 재검토 상태로 연결하며, 이미 본 화면이나 캡처까지 회수한다고 약속하지 않아요.</>}
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                onClick={() => {
                  onSuspend(pendingAction)
                  setPendingAction(null)
                }}
                className="rounded-xl text-xs"
              >
                <Check size={12} />
                확인
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingAction(null)}
                className="rounded-xl text-xs"
              >
                취소
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
