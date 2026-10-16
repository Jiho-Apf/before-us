import { useEffect, useState, type ReactNode } from "react"
import { LIVE } from "./backend/client"
import { ChevronDown, LockKeyhole } from "lucide-react"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { Textarea } from "./components/ui/textarea"
import type { ApplicationDraft, AnswerValue } from "./application-model"
import {
  APPEARANCE_FIELDS,
  APPEARANCE_PREFIX,
  HEIGHT_CRITERION,
  appearanceSummary,
  clonePreferences,
  emptyPreferences,
  hasAppearanceAnswers,
  setAppearanceMode,
  type PreferenceSettings,
} from "./preference-model"

const interaction =
  "transition-colors duration-200 motion-reduce:transition-none"
const basicNames = ["impression", "style", "body"]
const detailNames = ["hair", "eyes", "glasses", "beard"]

export function AppearanceSummary({ draft }: { draft: ApplicationDraft }) {
  const selected = appearanceSummary(draft.values)
  if (!selected.length) return null
  return (
    <section className="border-t border-border pt-5">
      <div className="flex items-center gap-2">
        <LockKeyhole size={13} className="text-primary" />
        <h3 className="text-xs font-semibold">
          내가 알려준 외적인 취향 · 상대 비공개
        </h3>
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-7">
        {selected.join(" / ")}
      </p>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">
        실제로 선택한 내용만 묶었어요. 미입력 항목은 추측하지 않아요.
      </p>
    </section>
  )
}

export default function AppearancePreferences({
  draft,
  onChange,
  onImportance,
  errors,
}: {
  draft: ApplicationDraft
  onChange: (
    values: Record<string, AnswerValue>,
    settings: PreferenceSettings,
  ) => void
  onImportance: (id: string) => void
  errors: Record<string, string>
}) {
  const [basicOpen, setBasicOpen] = useState(true)
  const [detailOpen, setDetailOpen] = useState(false)
  const [pendingMode, setPendingMode] = useState<string | null>(null)
  const settings = draft.preferences || emptyPreferences()
  const mode = draft.values[`${APPEARANCE_PREFIX}mode`]
  const editable = mode !== "선호 없음" && mode !== "나중에 작성"
  useEffect(() => {
    if (
      Object.keys(errors).some((id) =>
        [...basicNames, "heightMode", "heightMin", "heightMax"].some(
          (name) => id === `${APPEARANCE_PREFIX}${name}`,
        ),
      )
    )
      setBasicOpen(true)
    if (
      Object.keys(errors).some((id) =>
        [...detailNames, "note"].some(
          (name) => id === `${APPEARANCE_PREFIX}${name}`,
        ),
      )
    )
      setDetailOpen(true)
  }, [errors])
  const change = (id: string, value: AnswerValue) => {
    const values = {
      ...draft.values,
      [`${APPEARANCE_PREFIX}mode`]: "작성",
      [id]: value,
    }
    const next = clonePreferences(settings)
    if (id === HEIGHT_CRITERION && value !== "범위 지정") {
      delete values[`${APPEARANCE_PREFIX}heightMin`]
      delete values[`${APPEARANCE_PREFIX}heightMax`]
      delete next.importance[HEIGHT_CRITERION]
    }
    onChange(values, next)
  }
  const commitMode = (nextMode: string) => {
    const result = setAppearanceMode(draft.values, settings, nextMode)
    onChange(result.values, result.settings)
    setPendingMode(null)
  }
  const choices = (name: string) => {
    const field = APPEARANCE_FIELDS.find(
      (item) => item.id === `${APPEARANCE_PREFIX}${name}`,
    )!
    const value = draft.values[field.id]
    const selected = Array.isArray(value) ? value : []
    const multi = field.format === "multi"
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {field.options!.map((option) => {
          const active = multi ? selected.includes(option) : value === option
          return (
            <Button
              key={option}
              type="button"
              variant="outline"
              aria-pressed={active}
              disabled={
                multi && !active && selected.length >= (field.limit || Infinity)
              }
              onClick={() =>
                change(
                  field.id,
                  multi
                    ? active
                      ? selected.filter((item) => item !== option)
                      : [...selected, option]
                    : active
                      ? ""
                      : option,
                )
              }
              className={`h-auto min-h-10 whitespace-normal rounded-xl px-3 py-2 text-xs ${interaction} ${
                active
                  ? "border-primary bg-primary/10 text-primary hover:bg-primary/15"
                  : "border-border hover:bg-muted hover:text-foreground"
              }`}
            >
              {option}
            </Button>
          )
        })}
      </div>
    )
  }
  const fieldFrame = (name: string, content?: ReactNode) => {
    const field = APPEARANCE_FIELDS.find(
      (item) => item.id === `${APPEARANCE_PREFIX}${name}`,
    )!
    const value = draft.values[field.id]
    return (
      <section
        key={field.id}
        id={`apply-${field.id.replace(/\./g, "-")}`}
        tabIndex={-1}
        className="rounded-2xl border border-border bg-background p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{field.label}</h3>
          {field.id === HEIGHT_CRITERION ? (
            <Button
              type="button"
              variant="ghost"
              aria-pressed={
                settings.importance[HEIGHT_CRITERION] === "required"
              }
              onClick={() => onImportance(HEIGHT_CRITERION)}
              className={`h-8 rounded-lg px-2 text-[11px] ${interaction} ${
                settings.importance[HEIGHT_CRITERION] === "required"
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {settings.importance[HEIGHT_CRITERION] === "required"
                ? "꼭 지켜 주세요 · 해제"
                : "선호 · 중요도 변경"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              선택 · 취향 참고
            </span>
          )}
        </div>
        {content || choices(name)}
        {field.format === "multi" && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            최대 {field.limit}개 · {Array.isArray(value) ? value.length : 0}개
            선택. 다시 누르면 해제해요.
          </p>
        )}
        {field.format === "single" && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            다시 누르면 해제해요. 미입력도 괜찮아요.
          </p>
        )}
        {errors[field.id] && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {errors[field.id]}
          </p>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <LockKeyhole size={11} />
          상대 비공개 · 동의한 매칭 목적의 운영자 참고
        </p>
      </section>
    )
  }
  const disclosure = (
    title: string,
    subtitle: string,
    open: boolean,
    toggle: () => void,
    id: string,
  ) => (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={id}
      onClick={toggle}
      className={`flex min-h-16 w-full items-center justify-between gap-4 border-b border-border py-4 text-left ${interaction} hover:text-primary`}
    >
      <span>
        <span className="text-sm font-semibold">{title}</span>
        <span className="ml-3 text-[11px] text-muted-foreground">
          {subtitle}
        </span>
      </span>
      <ChevronDown size={17} className={open ? "rotate-180" : ""} />
    </button>
  )
  return (
    <div className="space-y-6">
      <div className="border-l-2 border-primary pl-5">
        <p className="text-[11px] font-semibold text-primary">
          취향을 이해하는 단서 · 모두 선택
        </p>
        <h2 className="mt-3 text-xl font-semibold leading-8">
          어떤 인상과 스타일에 눈길이 가나요?
        </h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          정답을 고르는 것이 아니라, 운영자가 취향을 이해하도록 알려 주세요.
          실제로 끌리는지는 소개 사진을 보고 직접 결정해요.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {["작성", "선호 없음", "나중에 작성"].map((value) => (
          <Button
            key={value}
            type="button"
            variant="outline"
            aria-pressed={mode === value}
            onClick={() =>
              value !== "작성" && hasAppearanceAnswers(draft.values)
                ? setPendingMode(value)
                : commitMode(value)
            }
            className={`rounded-xl text-xs ${interaction} ${
              mode === value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border"
            }`}
          >
            {value === "작성" ? "취향 작성하기" : value}
          </Button>
        ))}
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        필수 항목이 아니에요. 미입력·선호 없음·나중에 작성은 따로 기록하며,
        작성하지 않아도 신청할 수 있어요.{LIVE ? "" : " 가상 선호로만 시연해 주세요."}
      </p>
      {errors[`${APPEARANCE_PREFIX}mode`] && (
        <p role="alert" className="text-xs text-destructive">
          {errors[`${APPEARANCE_PREFIX}mode`]}
        </p>
      )}
      {pendingMode && (
        <div
          role="alert"
          className="rounded-xl border border-primary/20 bg-primary/5 p-5"
        >
          <p className="text-xs leading-7">
            ‘{pendingMode}’으로 바꾸면 외적인 취향의 기존 답변과 키 필수 조건을
            지워요. 기본 조건과 함께할 방식은 그대로 유지해요.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => commitMode(pendingMode)}
              className="rounded-xl text-xs"
            >
              답변 지우고 변경
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingMode(null)}
              className="rounded-xl text-xs"
            >
              기존 답변 유지
            </Button>
          </div>
        </div>
      )}
      {editable ? (
        <>
          <div>
            {disclosure(
              "기본 취향",
              "인상 · 스타일 · 체형 · 키",
              basicOpen,
              () => setBasicOpen(!basicOpen),
              "appearance-basic",
            )}
            <div
              id="appearance-basic"
              hidden={!basicOpen}
              className="mt-5 grid gap-4 sm:grid-cols-2"
            >
              {basicNames.map((name) => fieldFrame(name))}
              {fieldFrame(
                "heightMode",
                <>
                  {choices("heightMode")}
                  {draft.values[HEIGHT_CRITERION] === "범위 지정" && (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      {["heightMin", "heightMax"].map((name, index) => (
                        <label
                          key={name}
                          className="text-xs text-muted-foreground"
                        >
                          {index === 0 ? "최소" : "최대"} 키 · cm
                          <Input
                            id={`apply-${APPEARANCE_PREFIX.replace(/\./g, "-")}${name}`}
                            type="number"
                            min={1}
                            step={1}
                            value={String(
                              draft.values[`${APPEARANCE_PREFIX}${name}`] || "",
                            )}
                            onChange={(event) =>
                              change(
                                `${APPEARANCE_PREFIX}${name}`,
                                event.target.value,
                              )
                            }
                            aria-invalid={
                              !!errors[`${APPEARANCE_PREFIX}${name}`]
                            }
                            aria-describedby={
                              errors[`${APPEARANCE_PREFIX}${name}`]
                                ? `error-${name}`
                                : undefined
                            }
                            className="mt-2 h-11 rounded-xl"
                          />
                          {errors[`${APPEARANCE_PREFIX}${name}`] && (
                            <span
                              id={`error-${name}`}
                              role="alert"
                              className="mt-2 block text-destructive"
                            >
                              {errors[`${APPEARANCE_PREFIX}${name}`]}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-xs leading-6 text-muted-foreground">
                    키는 cm 단위의 양의 정수로 입력해요. 최소·최대를 포함해
                    비교해요. 키만 필수 조건으로 설정할 수 있고, 기본 조건과
                    합쳐 최대 3개예요.
                  </p>
                </>,
              )}
            </div>
          </div>
          <div>
            {disclosure(
              "상세 취향",
              "모두 선택 · 천천히 알려 주세요",
              detailOpen,
              () => setDetailOpen(!detailOpen),
              "appearance-detail",
            )}
            <div
              id="appearance-detail"
              hidden={!detailOpen}
              className="mt-5 space-y-4"
            >
              <p className="text-xs leading-6 text-muted-foreground">
                성별과 관계없이 원하는 항목에만 답해 주세요.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {detailNames.map((name) => fieldFrame(name))}
              </div>
              {fieldFrame(
                "note",
                <>
                  <label htmlFor="appearance-note" className="sr-only">
                    외적인 취향 자유 설명 · 200자 이내
                  </label>
                  <Textarea
                    id="appearance-note"
                    maxLength={200}
                    rows={4}
                    value={String(
                      draft.values[`${APPEARANCE_PREFIX}note`] || "",
                    )}
                    onChange={(event) =>
                      change(`${APPEARANCE_PREFIX}note`, event.target.value)
                    }
                    aria-invalid={!!errors[`${APPEARANCE_PREFIX}note`]}
                    className="mt-3 rounded-xl text-sm leading-7"
                    placeholder="단정한 옷차림과 편안한 표정이 좋아요. 안경과 머리 길이는 크게 상관없어요."
                  />
                  <div className="mt-3 flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      외모 비하나 타인의 이름·연락처 등 개인정보는 적지 마세요.
                    </span>
                    <span>
                      {
                        Array.from(
                          String(
                            draft.values[`${APPEARANCE_PREFIX}note`] || "",
                          ),
                        ).length
                      }{" "}
                      / 200자
                    </span>
                  </div>
                </>,
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl bg-muted p-5 text-xs leading-7">
          {mode === "선호 없음"
            ? "외적인 취향은 선호 없음으로 기록했어요."
            : "외적인 취향은 나중에 작성하기로 기록했어요."}{" "}
          ‘취향 작성하기’로 다시 입력할 수 있어요.
        </div>
      )}
      <div className="border-t border-border pt-5 text-xs leading-7 text-muted-foreground">
        <p>
          태그는 나의 비공개 취향 설명이에요. 운영자는 사진과 양쪽 선호,
          관계·생활 기준을 함께 참고해요. 주관적인 인상을 필수 통과·탈락
          점수로 바꾸거나 자동 합산 점수만으로 상대를 확정하지 않아요.
        </p>
        <p className="mt-2">
          태그를 많이 선택한다고 더 정확하거나 우선 소개되는 것은 아니에요.
          ‘끌리는 사람’은 특정 외모 등급을 의미하지 않아요.
        </p>
      </div>
    </div>
  )
}
