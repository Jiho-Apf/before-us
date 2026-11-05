import { useEffect, useState, type ReactNode } from "react"
import { Check, ChevronDown, LockKeyhole, Pencil, RotateCw } from "lucide-react"
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
import { forgetPhotoUrl, photoResult } from "./backend/applications"
import { PHOTO_REVIEW_TEXT, PHOTO_SLOTS, photoError } from "./photo-model"
import {
  BASE_PUBLIC_FIELDS,
  OPTIONAL_PUBLIC_FIELDS,
  REVIEW_CONSENTS,
  REQUIRED_PUBLIC_PHOTOS,
  type PublicProfile,
} from "./review-state"

const interaction =
  "transition-colors duration-200 motion-reduce:transition-none"
// 동의마다 알려야 할 내용(개인정보 보호법 제15조 제2항·제17조 제2항): 받는 사람·목적·항목·기간·거부할 권리
// 기본 화면에서는 접어 두지만(검수 U05), 내용은 줄이지 않는다. 펼치면 그대로 모두 보인다.
const CONSENT_DETAILS: Record<string, [string, string][]> = {
  "consent.collection": [
    ["항목", "활동용 이름, 생년월일(만 나이 계산용 · 상대에게 보이지 않아요), 휴대폰 번호(운영진만 봐요), 주 활동 지역, 관계 목적, 한 줄 소개, 필수 사진 3장, 소개받을 상대 조건, 교제·혼인 여부 서약, 알림 받을 방법"],
    ["목적", "신청 검토, 소개할 상대 고르기, 소개·교류·만남 진행, 안내 연락, 부정 이용 방지"],
    ["보유 기간", "탈퇴 요청 뒤 7일 안에 지워요(백업은 최대 30일). 분쟁·안전을 위해 따로 남기는 기록은 개인정보처리방침 ‘3. 보유 기간’을 따라요."],
  ],
  "consent.matching": [
    ["항목", "추가 사진 1장, 키·체형·스타일, 흡연·음주, 생활 시간대, 관심사, 직업 분야, 성격·대화 성향, 질문 답변, 알게 된 경로"],
    ["목적", "잘 맞는 상대를 고르는 데 참고하고, ‘상대 공개’로 켠 항목은 소개된 상대에게 보여 주기 위해"],
    ["보유 기간", "필수 정보와 같아요."],
    ["거부할 때", "거부할 수 있어요. 다만 필수 항목이라, 거부하면 소개 신청을 마칠 수 없어요."],
  ],
  "consent.provision": [
    ["받는 사람", "운영진이 나에게 소개한 상대 회원(소개마다 1명)"],
    ["목적", "상대가 나를 알아보고 ‘알아가고 싶어요’를 고를 수 있게 하고, 서로 선택하면 3일 교류와 만남을 이어 가기 위해"],
    ["항목", "이 화면에서 ‘상대 공개’로 켠 항목과 운영진이 확인한 사진. 생년월일 원래 값·휴대폰 번호·이메일은 주지 않아요."],
    ["기간", "소개가 공개된 날 정오부터 다음 날 오전 11시 응답 마감까지. 서로 알아가기로 하면 교류와 약속이 끝날 때까지(최대 약속일 다음 날 23:59). 끝나거나 쉬기·차단·탈퇴가 생기면 바로 볼 수 없어요."],
    ["거부할 때", "거부할 수 있어요. 다만 소개 서비스의 핵심이라, 거부하면 소개를 받을 수 없어요."],
    ["멈추기", "내 정보에서 ‘쉬기’를 누르면 새 소개를 멈추고, 아직 공개되지 않은 예약 소개는 취소돼요. 이미 공개된 소개는 ‘이번엔 넘길게요’로, 진행 중인 교류는 두 사람 화면의 차단이나 문의·요청으로 끝낼 수 있어요."],
  ],
}
const DETAIL_TITLE: Record<string, string> = {
  "consent.collection": "항목·목적·보유 기간 보기",
  "consent.matching": "항목·목적·보유 기간·거부할 때 보기",
  "consent.provision": "받는 사람·목적·항목·기간·거부할 때 보기",
}

const text = (value: string | string[]) =>
  Array.isArray(value) ? value.join(" · ") : value

type PhotoView = { status: "loading" } | { status: "ok"; url: string } | { status: "error" }

// 내 사진(실제 서버): 미리보기에 실제 사진을 보여 준다. 주소는 한 번 만들어 몇 분 동안 다시 쓴다(매번 새로 만들지 않는다).
function useOwnPhotos(paths: Partial<Record<string, string>> | undefined) {
  const [views, setViews] = useState<Record<string, PhotoView>>({})
  const [attempt, setAttempt] = useState(0)
  const key = paths ? Object.entries(paths).map(([slot, path]) => `${slot}:${path}`).sort().join("|") : ""
  useEffect(() => {
    if (!paths) return
    let alive = true
    for (const [slot, path] of Object.entries(paths)) {
      if (!path) continue
      setViews((current) => current[slot]?.status === "ok" ? current : { ...current, [slot]: { status: "loading" } })
      void photoResult(path).then((result) => {
        if (!alive) return
        setViews((current) => ({ ...current, [slot]: result.status === "ok" ? { status: "ok", url: result.url } : { status: "error" } }))
      })
    }
    return () => { alive = false }
  }, [key, attempt])
  return {
    views,
    failed: (slot: string) => setViews((current) => ({ ...current, [slot]: { status: "error" } })),
    retry: () => { Object.values(paths ?? {}).forEach((path) => path && forgetPhotoUrl(path)); setViews({}); setAttempt((value) => value + 1) },
  }
}

export function PublicProfilePreview({ profile, photoPaths }: { profile: PublicProfile; photoPaths?: Partial<Record<string, string>> }) {
  const name = profile.items.find((item) => item.id === "self.name")
  const own = useOwnPhotos(photoPaths)
  // 비어 있는 선택 칸은 보이지 않는다. 필수 3장은 늘 자리를 두고, 일상 사진은 공개를 켜고 확인된 경우에만.
  const photos = [
    ...REQUIRED_PUBLIC_PHOTOS,
    ...profile.photos
      .filter((photo) => photo.slot === "photo.daily")
      .map((photo) => photo.slot),
  ]
  const anyError = photos.some((slot) => own.views[slot]?.status === "error")
  return (
    <aside
      aria-labelledby="public-preview-title"
      className="self-start overflow-hidden border border-border bg-background lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto"
    >
      <div className="bg-accent px-5 py-3 text-[11px] text-accent-foreground">
        {LIVE ? "PREVIEW · 상대에게 보일 모습" : "SPECIFIC INTRODUCTION · DEMO"}
      </div>
      <div className="grid grid-cols-3 gap-px bg-border">
        {photos.map((slotId) => {
          const checked = profile.photos.some((item) => item.slot === slotId)
          const view = own.views[slotId]
          const label = PHOTO_SLOTS.find((slot) => slot.id === slotId)?.label
          return (
            <figure
              key={slotId}
              className="relative flex aspect-[3/4] flex-col items-center justify-center gap-2 overflow-hidden bg-muted px-2 text-center"
            >
              {view?.status === "ok" ? (
                <img src={view.url} alt={`내 사진 · ${label}`} onError={() => own.failed(slotId)} className="absolute inset-0 size-full object-cover" />
              ) : (
                <span aria-hidden="true" className={`size-7 rounded-full border-2 ${checked ? "border-primary" : "border-border"} ${view?.status === "loading" ? "animate-pulse motion-reduce:animate-none" : ""}`} />
              )}
              <figcaption className={view?.status === "ok" ? "absolute inset-x-0 bottom-0 bg-background/85 px-1 py-1 text-[10px] leading-4" : "text-xs leading-5 text-muted-foreground"}>
                {label}
                {view?.status === "ok" ? (checked ? "" : " · 확인 뒤 공개") : <><br />{view?.status === "loading" ? "불러오는 중" : view?.status === "error" ? "잠시 못 불러왔어요" : checked ? LIVE ? "운영진이 확인한 사진" : "기준 확인된 가상 사진" : LIVE ? "운영진 확인 뒤 표시" : "제공할 사진 없음"}</>}
              </figcaption>
            </figure>
          )
        })}
      </div>
      {anyError && (
        <div role="status" className="flex items-center justify-between gap-3 border-b border-border px-5 py-2 text-xs">
          <span className="text-muted-foreground">사진을 잠시 불러오지 못했어요. 사진은 그대로 있어요.</span>
          <Button type="button" variant="ghost" size="sm" onClick={own.retry} className={`min-h-11 shrink-0 rounded-lg ${interaction}`}><RotateCw size={12} />다시 불러오기</Button>
        </div>
      )}
      <div className="p-5">
        <h3 id="public-preview-title" className="text-xl font-semibold">
          {name ? text(name.value) : "공개 이름 없음"}
        </h3>
        <dl className="mt-4 space-y-3">
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
        <p className="mt-5 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">
          {LIVE ? "공개를 켠 항목만 보여요. 소개가 열리면 그 한 분에게만 이렇게 보여요. 아직 아무에게도 보내지 않았어요." : "선택 정보는 공개를 켠 항목만 표시해요. 가상 프로필 예시이며 실제 회원에게 제공되지 않아요."}
        </p>
      </div>
    </aside>
  )
}

// 접고 펴는 묶음(공개 범위): 접혀 있어도 요약은 늘 보인다.
function Group({ id, title, summary, open, onToggle, warn, children }: { id: string; title: string; summary: ReactNode; open: boolean; onToggle: () => void; warn?: boolean; children: ReactNode }) {
  return (
    <div className="border-b border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className={`flex min-h-11 w-full items-start justify-between gap-3 py-3 text-left ${interaction}`}
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold">{title}</span>
          <span className={`mt-1 block text-xs leading-6 ${warn ? "text-destructive" : "text-muted-foreground"}`}>{summary}</span>
        </span>
        <ChevronDown aria-hidden="true" size={16} className={`mt-1 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div id={id} className="pb-3">{children}</div>}
    </div>
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
  photoPaths,
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
  photoPaths?: Partial<Record<string, string>>
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
  const label = (id: string) =>
    id === PUBLIC_AGE_FIELD.id
      ? "만 나이(생년월일은 비공개)"
      : APPLICATION_FIELDS.find((item) => item.id === id)?.label || id
  const answered = (id: string) =>
    id === PUBLIC_AGE_FIELD.id
      ? profile.items.some((item) => item.id === id) || !!draft.values["self.birthDate"] || verifiedAge !== null
      : answerState(draft.values[id]) === "answered"
  // 묶음 나누기: 기본 소개(꼭 공개) · 선택 정보(적은 것만, 켠 것만 공개) · 주지 않는 정보
  const baseIds = [...BASE_PUBLIC_FIELDS, ...REQUIRED_PUBLIC_PHOTOS] as string[]
  const optionalAnswered = OPTIONAL_PUBLIC_FIELDS.filter(answered)
  const optionalEmpty = OPTIONAL_PUBLIC_FIELDS.filter((id) => !answered(id))
  const dailyPhoto = draft.photos["photo.daily"]
  const optionalIds = [...optionalAnswered, ...(dailyPhoto?.file ? ["photo.daily"] : [])] as string[]
  const baseOff = baseIds.filter((id) => !draft.sharing[id]).length
  const optionalOn = optionalIds.filter((id) => draft.sharing[id]).map((id) => id === "photo.daily" ? "일상 사진" : label(id))
  const hasError = (ids: string[]) => ids.some((id) => errors[`sharing.${id}`])
  const [open, setOpen] = useState({ base: false, optional: false, hidden: false })
  // 확인이 필요한 칸이 접힌 묶음 안에 있으면 펼친다(오류 목록에서 눌러 바로 갈 수 있게).
  useEffect(() => {
    setOpen((current) => ({ ...current, base: current.base || hasError(baseIds), optional: current.optional || hasError(optionalIds) }))
  }, [errors])

  const shareRow = (id: string, required: boolean) => {
    const photoSlot = PHOTO_SLOTS.find((slot) => slot.id === id)
    const photo = photoSlot ? draft.photos[photoSlot.id] : null
    const name = photoSlot ? `${photoSlot.label} 사진` : label(id)
    const note = photoSlot
      ? photo?.file
        ? LIVE ? PHOTO_REVIEW_TEXT[photo.review] ?? photo.review : `${photo.review} · 가상 사진 초안 v${photo.revision}`
        : "아직 안 올렸어요"
      : required ? "기본 소개 · 꼭 공개" : "선택 공개 · 처음엔 꺼져 있어요"
    const error = errors[`sharing.${id}`]
    return (
      <div key={id} className="py-2">
        <div className="flex items-center justify-between gap-3">
          <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
            <Checkbox
              id={`sharing-${id.replace(/\./g, "-")}`}
              checked={draft.sharing[id] || false}
              onCheckedChange={(checked) => onSharing(id, checked === true)}
              disabled={!!photoSlot && !photoSlot.required && !photo?.file}
              aria-invalid={!!error}
              aria-label={`${name} 상대 공개`}
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold">{name}</span>
              <span className="block text-[11px] leading-5 text-muted-foreground">{note}</span>
            </span>
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`${name} 고치기`}
            onClick={() => onEdit(photoSlot ? 1 : 0, !photoSlot && APPLICATION_FIELDS.find((item) => item.id === id)?.group === "optional")}
            className={`size-11 shrink-0 rounded-lg p-0 ${interaction}`}
          >
            <Pencil size={13} />
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    )
  }
  const required = REVIEW_CONSENTS.filter((field) => field.required)
  const optional = REVIEW_CONSENTS.filter((field) => !field.required)
  const requiredDone = required.filter((field) => draft.values[field.id] === true).length
  const consentCard = (field: (typeof REVIEW_CONSENTS)[number]) => (
    <div key={field.id} className="rounded-xl border border-border p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox
          id={`apply-${field.id.replace(/\./g, "-")}`}
          checked={draft.values[field.id] === true}
          onCheckedChange={(checked) => onConsent(field.id, checked === true)}
          aria-invalid={!!errors[field.id]}
          aria-describedby={`${field.id}-purpose`}
          className="mt-1"
        />
        <span className="text-xs leading-6">
          <span className={`mr-1 font-semibold ${field.required ? "text-primary" : "text-muted-foreground"}`}>
            {field.required ? "[필수]" : "[선택]"}
          </span>
          {field.label.replace(/\s*\(선택\)$/, "")}
        </span>
      </label>
      <p id={`${field.id}-purpose`} className="ml-7 mt-2 text-xs leading-6 text-muted-foreground">
        {field.purpose}
      </p>
      {CONSENT_DETAILS[field.id] && (
        <details className="group ml-7 mt-2 text-xs">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 font-semibold text-foreground underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
            {DETAIL_TITLE[field.id] ?? "자세히 보기"}
            <ChevronDown aria-hidden="true" size={14} className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <dl className="mt-2 grid gap-x-4 gap-y-2 rounded-xl bg-muted/40 p-4 leading-6 text-muted-foreground sm:grid-cols-[72px_1fr] [&>div]:contents">
            {CONSENT_DETAILS[field.id].map(([title, body]) => (
              <div key={title}>
                <dt className="font-semibold text-foreground">{title}</dt>
                <dd>{body}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {errors[field.id] && (
        <p role="alert" className="ml-7 mt-2 text-xs text-destructive">
          {errors[field.id]}
        </p>
      )}
    </div>
  )

  return (
    <div className="space-y-7">
      {top}
      <header>
        <p className="text-[11px] font-semibold text-accent">
          FINAL CHECK · 마지막 확인
        </p>
        <h2 className="mt-3 text-2xl font-semibold leading-9">
          상대에게 보일 모습을 확인해 주세요.
        </h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          전체 공개가 아니라, 소개된 한 분에게만 보여요. 아직 아무에게도 보내지 않았어요.
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
      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* ① 실제로 보일 모습 */}
        <PublicProfilePreview profile={profile} photoPaths={photoPaths} />
        <div className="min-w-0 space-y-7">
          {/* ② 공개 범위: 묶어서 접어 둔다 */}
          <section aria-labelledby="review-scope-title">
            <h3 id="review-scope-title" className="text-sm font-semibold">
              공개 범위
            </h3>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">
              눌러서 펼치면 항목마다 켜고 끌 수 있어요.
            </p>
            <div className="mt-2 border-t border-border">
              <Group
                id="review-scope-base"
                title="기본 소개 · 꼭 공개"
                summary={baseOff ? `꺼진 항목 ${baseOff}개 · 소개하려면 켜 주세요` : "이름·만 나이·지역·관계 목적·한 줄 소개·필수 사진 3장 공개"}
                warn={baseOff > 0 || hasError(baseIds)}
                open={open.base}
                onToggle={() => setOpen((current) => ({ ...current, base: !current.base }))}
              >
                <p className="pt-1 text-[11px] text-muted-foreground">체크한 항목이 상대에게 보여요.</p>
                {BASE_PUBLIC_FIELDS.map((id) => shareRow(id, true))}
                {REQUIRED_PUBLIC_PHOTOS.map((id) => shareRow(id, true))}
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  사진은 운영진이 확인한 것만 보여요. 사진 확인은 외모·인성·안전 인증이 아니에요.
                </p>
              </Group>
              <Group
                id="review-scope-optional"
                title="선택 정보 · 켠 항목만 공개"
                summary={optionalIds.length === 0 ? "적은 선택 정보가 없어요 · 그대로 신청할 수 있어요" : optionalOn.length ? `공개: ${optionalOn.join(" · ")}` : `적은 항목 ${optionalIds.length}개 · 모두 비공개`}
                warn={hasError(optionalIds)}
                open={open.optional}
                onToggle={() => setOpen((current) => ({ ...current, optional: !current.optional }))}
              >
                {optionalIds.length > 0 && <p className="pt-1 text-[11px] text-muted-foreground">체크한 항목만 상대에게 보여요. 처음엔 모두 꺼져 있어요.</p>}
                {optionalIds.map((id) => shareRow(id, false))}
                {optionalEmpty.length > 0 && (
                  <p className="mt-2 text-xs leading-6 text-muted-foreground">
                    적지 않은 항목 {optionalEmpty.length}개는 공개할 내용이 없어서 보이지 않아요. 비워 둬도 신청할 수 있고, 적지 않은 걸 다르게 판단하지 않아요.{" "}
                    <button type="button" onClick={() => onEdit(0, true)} className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-4">더 적기</button>
                  </p>
                )}
              </Group>
              <Group
                id="review-scope-hidden"
                title="상대에게 주지 않는 정보"
                summary="정확한 생년월일·연락처·원하는 상대 조건·운영진 메모"
                open={open.hidden}
                onToggle={() => setOpen((current) => ({ ...current, hidden: !current.hidden }))}
              >
                <div className="flex items-start gap-2 rounded-xl bg-muted p-4">
                  <LockKeyhole size={14} className="mt-1 shrink-0 text-primary" />
                  <div className="space-y-2 text-xs leading-6 text-muted-foreground">
                    <p>정확한 생년월일, 계정·인증 연락처·확인 자료, 이상형·희망 나이·키·체형·인상·필수 조건, 운영자 메모·보완 이력·거절 사유는 소개 프로필에 포함되지 않아요.</p>
                    <p>선호 MBTI·선호 성향·연애 중요 기준·자유 이상형 설명도 운영자용 비공개예요. MBTI는 자기진술 참고 정보이며 성격 검증이나 궁합 점수가 아니에요.</p>
                    <p>본인 성별·체형·스타일 응답은 운영자 참고용이며, 이번 소개 프로필 제공 항목에는 포함하지 않아요.</p>
                    <button type="button" onClick={() => onEdit(2)} className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-4">비공개 선호 고치기</button>
                  </div>
                </div>
              </Group>
            </div>
          </section>
          {/* ③ 확인과 동의: 필수와 선택을 나눈다. 아무것도 미리 체크하지 않는다. */}
          <section aria-labelledby="review-consent-title">
            <h3 id="review-consent-title" className="text-sm font-semibold">
              확인과 동의
            </h3>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">
              필수 {requiredDone}/{required.length} · 목적마다 따로 확인해요. 미리 체크해 두지 않아요.
            </p>
            <div className="mt-3 space-y-3">{required.map(consentCard)}</div>
            <h4 className="mt-6 text-xs font-semibold">선택 · 체크하지 않아도 신청할 수 있어요</h4>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">동의하지 않아도 신청과 소개에 불이익이 없어요. 내 정보 → 알림 설정에서 언제든 바꿀 수 있어요.</p>
            <div className="mt-3 space-y-3">{optional.map(consentCard)}</div>
            <p className="mt-4 text-xs leading-6 text-muted-foreground">
              {LIVE ? <>필수 항목에 동의하지 않으면 소개 신청을 마칠 수 없어요. 동의를 거두려면 신청을 철회하거나 ‘문의·요청’에서 처리정지를 요청해 주세요. 자세한 내용은 <a href="/terms" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-primary">이용약관</a>과 <a href="/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-primary">개인정보처리방침</a>에 있어요.</> : "데모 화면이라 실제 개인정보를 받지 않고, 여기의 체크는 실제 동의로 기록하지 않아요. 선택 항목(광고성 정보 수신, 정오 상태 알림)은 체크하지 않아도 신청할 수 있어요."}
            </p>
          </section>
          {/* ④ 보내기: 아래 버튼으로 보낸다 */}
          <section aria-label="보내기 전 요약" className="rounded-xl border border-border p-4 text-xs leading-6">
            <p className="font-semibold">보내기 전 요약</p>
            <p className="mt-1 text-muted-foreground">
              필수 확인 {requiredDone}/{required.length} · 사진 {LIVE ? `운영진 확인 ${checkedPhotos}/3` : `기준 확인 ${checkedPhotos}/3`} · 본인 확인 {verifiedAge === null ? "직접 적은 내용(인증 아님)" : "기존 인증값 참고"}
            </p>
            <p className="mt-1 text-muted-foreground">
              아래 버튼을 누르면 운영진에게 전달돼요. 상대에게는 운영진이 고른 날 정오에, 그 한 분에게만 보여요.
            </p>
            {review.changeMessage && (
              <p role="status" className="mt-3 rounded-xl bg-muted p-3">
                {review.changeMessage}
              </p>
            )}
          </section>
        </div>
      </div>
      <details className="group border-y border-border py-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          신청 뒤에는 이렇게 진행돼요
          <ChevronDown aria-hidden="true" size={16} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <ol className="mt-3 grid gap-2 text-xs leading-6 sm:grid-cols-5">
          {[
            "신청 내용 검토",
            "사진·본인 확인",
            "운영진이 상대 고르기",
            "쉬기·취소 언제든",
            "준비된 날 정오 공개",
          ].map((item, index) => (
            <li key={item} className="border border-border p-3">
              <span className="font-semibold text-accent">0{index + 1}</span> {item}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs leading-6 text-muted-foreground">
          운영진이 상대를 고르면 준비된 날 정오에 공개해요. 공개 직전에 두 분의 상태를 다시 확인하고, 쉬기를 누르면 아직 공개되지 않은 예약 소개는 취소돼요. 신청 단계에서는 아직 누구에게도 보여 주지 않고, 매일 새 소개를 보장하지 않아요.
        </p>
        <dl className="mt-3 grid gap-2 text-xs leading-6 sm:grid-cols-3">
          {[
            ["신청", review.submission === "received" ? LIVE ? "접수 · 검토 대기" : "데모 접수 · 검토 대기" : review.submission === "held" ? LIVE ? "신청 보류" : "신청 보류 · 데모" : review.submission === "withdrawn" ? LIVE ? "신청 철회" : "신청 철회 · 데모" : "아직 접수 전"],
            ["핵심 프로필", review.profileReview === "reviewed" ? LIVE ? "검토 확인" : "가상 검토 확인" : "운영자 검토 전"],
            ["소개 제공", "준비 미완료 · 아직 전달 안 함"],
          ].map(([title, value]) => (
            <div key={title}>
              <dt className="text-muted-foreground">{title}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
      <section>
        <p className="text-xs leading-6 text-muted-foreground">
          필요한 공개에 동의하지 않으면 신청을 보류하거나 철회할 수 있어요. 사진·핵심 정보를 고치면 다시 확인해요.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {!LIVE && <Button
            type="button"
            variant="outline"
            onClick={() => setPendingAction("held")}
            className="min-h-11 rounded-xl text-xs"
          >
            신청 보류 · 데모
          </Button>}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setPendingAction("withdrawn")}
            className="min-h-11 rounded-xl text-xs"
          >
            {LIVE ? "신청 철회" : "신청 철회 · 데모"}
          </Button>
          {(review.submission === "held" ||
            review.submission === "withdrawn") && (
            <Button
              id="review-resume"
              type="button"
              onClick={onResume}
              className="min-h-11 rounded-xl text-xs"
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
                className="min-h-11 rounded-xl text-xs"
              >
                <Check size={12} />
                확인
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingAction(null)}
                className="min-h-11 rounded-xl text-xs"
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
