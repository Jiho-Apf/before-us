import { useEffect, useState, type ReactNode } from "react"
import { ArrowRight, LockKeyhole } from "lucide-react"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { Textarea } from "./components/ui/textarea"
import AppearancePreferences, {
  AppearanceSummary,
} from "./AppearancePreferences"
import { BEFORE_US } from "./config"
import { LIVE } from "./backend/client"
import { RELATIONSHIP_FIELDS, RELATIONSHIP_PREFIX } from "./personality-fields"
import type { ApplicationDraft, AnswerValue } from "./application-model"
import {
  COMPARABLE,
  APPEARANCE_PREFIX,
  PREFERENCE_FIELDS,
  clonePreferences,
  emptyPreferences,
  hasSpecificPreference,
  preferenceValueText,
  requiredConditions,
  type PreferenceSettings,
} from "./preference-model"

const motion = "transition-colors duration-200 motion-reduce:transition-none"
const tabs = ["기본 조건", "외적인 취향", "함께할 방식"]
const basic = [
  "regions",
  "meetingRegions",
  "travel",
  "travelTime",
  "purpose",
  "smoking",
  "drinking",
  "schedule",
]
const ways = ["contact", "conversation", "interests"]

export function PreferenceSummary({ draft }: { draft: ApplicationDraft }) {
  const settings = draft.preferences || emptyPreferences()
  const selected = requiredConditions(settings)
  return (
    <aside className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">꼭 지켜 주세요</h3>
        <span className="text-xs text-primary">
          {selected.length} /{" "}
          {BEFORE_US.operatingDraft.additionalRequiredConditionsMaximum}개 ·
          운영 초안
        </span>
      </div>
      {selected.length ? (
        <dl className="mt-4 space-y-3">
          {selected.map((id) => (
            <div
              key={id}
              className="flex flex-wrap justify-between gap-2 text-xs"
            >
              <dt className="font-semibold">
                {PREFERENCE_FIELDS.find((field) => field.id === id)?.label}
              </dt>
              <dd>
                {preferenceValueText(id, draft.values)} · 필수 · 상대 비공개
                {settings.confidential[id] ? " · 비공개 응답" : ""}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          추가 필수 조건을 지정하지 않았어요. 입력한 기준의 기본 중요도는
          ‘선호’예요.
        </p>
      )}
      <p className="mt-4 text-xs leading-6">
        필수 조건이 많으면 소개까지 시간이 더 필요할 수 있어요. 운영자가 임의로
        바꾸지는 않아요.
      </p>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">
        성인·상호 소개 대상·활동 상태 등 공통 조건은 이 개수에서 제외해요.
        상대 정보가 없으면 충족이 아닌 ‘확인 필요’로 봐요. 후보가 없으면
        대기하거나, 본인이 선택해 기준 재검토를 요청할 수 있어요.
      </p>
      {settings.request !== "none" && (
        <p className="mt-3 text-xs text-primary">
          {settings.request === "hold"
            ? "신청 보류 의사"
            : "운영자 추가 기준 요청"}{" "}
          {LIVE ? " · 신청서와 함께 운영진이 확인해요" : " · 데모 임시 기록만 · 발송되지 않음"}
          {settings.requestNote ? ` / ${settings.requestNote}` : ""}
        </p>
      )}
      <div className="mt-5">
        <AppearanceSummary draft={draft} />
      </div>
    </aside>
  )
}

export default function PreferencesStep({
  draft,
  onChange,
  errors,
}: {
  draft: ApplicationDraft
  onChange: (
    values: Record<string, AnswerValue>,
    settings: PreferenceSettings,
  ) => void
  errors: Record<string, string>
}) {
  const [tab, setTab] = useState(() =>
    Object.keys(errors).some(
      (id) =>
        id.startsWith(APPEARANCE_PREFIX) || id.startsWith(RELATIONSHIP_PREFIX),
    )
      ? 1
      : Object.keys(errors).some((id) =>
            ways.some((name) => id === `desired.${name}`),
          )
        ? 2
        : 0,
  )
  const [notice, setNotice] = useState("")
  const [requestOpen, setRequestOpen] = useState(false)
  const [relationshipOpen, setRelationshipOpen] = useState(true)
  useEffect(() => {
    if (Object.keys(errors).some((id) => id.startsWith(RELATIONSHIP_PREFIX)))
      setRelationshipOpen(true)
    if (
      Object.keys(errors).some(
        (id) =>
          id.startsWith(APPEARANCE_PREFIX) ||
          id.startsWith(RELATIONSHIP_PREFIX),
      )
    )
      setTab(1)
    else if (
      Object.keys(errors).some((id) =>
        ways.some((name) => id === `desired.${name}`),
      )
    )
      setTab(2)
  }, [errors])
  const settings = draft.preferences || emptyPreferences()
  const change = (id: string, value: AnswerValue) => {
    const values = { ...draft.values, [id]: value }
    const next = clonePreferences(settings)
    if (id === "desired.ageMode" && value !== "범위 지정") {
      values["desired.ageMin"] = ""
      values["desired.ageMax"] = ""
    }
    if (COMPARABLE.includes(id) && !hasSpecificPreference(id, values))
      next.importance[id] = "preference"
    onChange(values, next)
    setNotice("")
  }
  const importance = (id: string) => {
    const next = clonePreferences(settings)
    if (next.importance[id] === "required") next.importance[id] = "preference"
    else if (!hasSpecificPreference(id, draft.values)) {
      setNotice(
        "구체적인 기준을 먼저 입력해 주세요. 선호 없음은 필수 조건으로 지정하지 않아요.",
      )
      return
    } else if (
      requiredConditions(next).length >=
      BEFORE_US.operatingDraft.additionalRequiredConditionsMaximum
    ) {
      setNotice(
        "추가 필수 조건은 운영 초안 기준 최대 3개예요. 지금 기준은 그대로 두고, 추가 요청 또는 신청 보류를 선택할 수 있어요.",
      )
      setRequestOpen(true)
      return
    } else next.importance[id] = "required"
    onChange(draft.values, next)
    setNotice("")
  }
  const chips = (
    id: string,
    options: readonly string[],
    multiple = false,
    limit?: number,
  ) => {
    const value = draft.values[id]
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = multiple ? selected.includes(option) : value === option
          const neutral =
            id === `${RELATIONSHIP_PREFIX}mbti` ? "상관없어요" : "선호 없음"
          return (
            <Button
              key={option}
              type="button"
              variant="outline"
              aria-pressed={active}
              disabled={
                multiple &&
                !active &&
                option !== neutral &&
                selected.filter((item) => item !== neutral).length >=
                  (limit || Infinity)
              }
              onClick={() => {
                if (!multiple) {
                  change(id, active ? "" : option)
                  return
                }
                change(
                  id,
                  active
                    ? selected.filter((item) => item !== option)
                    : option === neutral
                      ? [option]
                      : [
                          ...selected.filter((item) => item !== neutral),
                          option,
                        ],
                )
              }}
              className={`h-auto min-h-10 whitespace-normal rounded-xl px-3 py-2 text-xs ${motion} ${
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
  const frame = (
    id: string,
    label: string,
    content: ReactNode,
    helper?: string,
  ) => (
    <section
      key={id}
      id={`apply-${id.replace(/\./g, "-")}`}
      tabIndex={-1}
      className="rounded-2xl border border-border bg-background p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{label}</h3>
        {COMPARABLE.includes(id) && (
          <Button
            type="button"
            variant="ghost"
            aria-pressed={settings.importance[id] === "required"}
            onClick={() => importance(id)}
            className={`h-8 rounded-lg px-2 text-[11px] ${motion} ${
              settings.importance[id] === "required"
                ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {settings.importance[id] === "required"
              ? "꼭 지켜 주세요 · 해제"
              : "선호 · 중요도 변경"}
          </Button>
        )}
      </div>
      {content}
      {helper && (
        <p className="mt-3 text-xs leading-6 text-muted-foreground">
          {helper}
        </p>
      )}
      {errors[id] && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {errors[id]}
        </p>
      )}
      <label className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={!!settings.confidential[id]}
          onChange={(event) =>
            onChange(draft.values, {
              ...settings,
              confidential: {
                ...settings.confidential,
                [id]: event.target.checked,
              },
            })
          }
          className="size-4 accent-primary"
        />
        비공개 응답으로 표시
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        {!draft.values[id] ||
        (Array.isArray(draft.values[id]) &&
          !(draft.values[id] as string[]).length)
          ? "미입력"
          : draft.values[id] === "선호 없음" ||
              (Array.isArray(draft.values[id]) &&
                (draft.values[id] as string[]).some(
                  (value) => value === "선호 없음" || value === "상관없어요",
                ))
            ? "선호 없음"
            : settings.confidential[id]
              ? "답변 있음 · 비공개 응답"
              : "답변 있음 · 운영자 참고"}{" "}
        · 상대에게는 공개하지 않아요
      </p>
    </section>
  )
  const field = (name: string) => {
    const definition = PREFERENCE_FIELDS.find(
      (item) => item.id === `desired.${name}`,
    )!
    return frame(
      definition.id,
      definition.label,
      definition.format === "text" ? (
        <Textarea
          id={`input-${definition.id.replace(/\./g, "-")}`}
          aria-label={definition.label}
          aria-invalid={!!errors[definition.id]}
          value={String(draft.values[definition.id] || "")}
          maxLength={200}
          onChange={(event) => change(definition.id, event.target.value)}
          placeholder={
            RELATIONSHIP_FIELDS.find((item) => item.id === definition.id)
              ?.placeholder
          }
          className="mt-3 min-h-28 rounded-xl text-sm leading-7"
        />
      ) : (
        chips(
          definition.id,
          name === "travelTime"
            ? [...new Set(["30분 이내", "60분", "90분", "상관없음", ...(draft.values[definition.id] ? [String(draft.values[definition.id])] : [])])]
            : definition.options!,
          definition.format === "multi",
          definition.limit,
        )
      ),
      definition.format === "multi"
        ? `${
            definition.limit ? `최대 ${definition.limit}개 · ` : "복수 선택 · "
          }${
            Array.isArray(draft.values[definition.id])
              ? (draft.values[definition.id] as string[]).length
              : 0
          }개 선택. 다시 누르면 해제해요.${
            name === "regions"
              ? " 상대의 주 활동 지역을 시·도 단위로 선택해요. 내 활동 지역·실제 만남 지역과 별도이며, 필수 지정 시 양쪽 방향으로 확인해요."
              : name === "meetingRegions"
                ? " 실제 만남이 가능한 시·도예요. 상대 선호 지역과 별도로 저장하며 약속 확정은 아니에요."
              : ""
          }`
        : definition.format === "text"
          ? `200자 이내 · 현재 ${Array.from(String(draft.values[definition.id] || "")).length}자. 연락처·SNS·민감정보는 적지 마세요.`
          : "선택 항목 · 다시 누르면 해제해요.",
    )
  }
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          많은 조건보다, 정말 중요한 기준부터 알려 주세요.
        </h2>
        <p className="mt-3 flex items-center gap-2 text-xs leading-6 text-muted-foreground">
          <LockKeyhole size={14} className="shrink-0" />
          나의 자기진술과 별도로 저장해요. 모든 선호는 상대 비공개이며, 동의한
          매칭 목적의 운영자 참고용이에요.
        </p>
      </div>
      <div
        role="tablist"
        aria-label="원하는 만남"
        className="flex gap-1 border-b border-border"
      >
        {tabs.map((label, index) => (
          <button
            key={label}
            id={`preference-tab-${index}`}
            role="tab"
            aria-selected={tab === index}
            aria-controls="preference-panel"
            tabIndex={tab === index ? 0 : -1}
            onClick={() => setTab(index)}
            onKeyDown={(event) => {
              const target =
                event.key === "ArrowRight"
                  ? (index + 1) % 3
                  : event.key === "ArrowLeft"
                    ? (index + 2) % 3
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 2
                        : null
              if (target !== null) {
                event.preventDefault()
                setTab(target)
                document.getElementById(`preference-tab-${target}`)?.focus()
              }
            }}
            className={`min-h-11 border-b-2 px-3 text-xs sm:px-5 ${motion} ${
              tab === index
                ? "border-primary font-semibold text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="preference-panel"
        role="tabpanel"
        aria-labelledby={`preference-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {frame(
              "desired.gender",
              "소개받을 상대",
              chips("desired.gender", [
                "여성",
                "남성",
                "선호 없음",
                "직접 확인이 필요해요",
              ]),
              "이전 단계와 연결돼요. 여기서 수정해도 나의 성별 정보는 바뀌지 않아요.",
            )}
            {frame(
              "desired.ageMode",
              "희망 만 나이",
              <>
                {chips("desired.ageMode", ["범위 지정", "선호 없음"])}
                {draft.values["desired.ageMode"] === "범위 지정" && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {["ageMin", "ageMax"].map((name, index) => (
                      <label
                        key={name}
                        className="text-xs text-muted-foreground"
                      >
                        {index === 0 ? "최소" : "최대"} 만 나이
                        <Input
                          id={`apply-desired-${name}`}
                          type="number"
                          min={BEFORE_US.operatingDraft.minimumAge}
                          step={1}
                          value={String(draft.values[`desired.${name}`] || "")}
                          onChange={(event) =>
                            change(`desired.${name}`, event.target.value)
                          }
                          aria-invalid={!!errors[`desired.${name}`]}
                          className="mt-2 h-11 rounded-xl"
                        />
                        {errors[`desired.${name}`] && (
                          <span
                            role="alert"
                            className="mt-2 block text-destructive"
                          >
                            {errors[`desired.${name}`]}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </>,
              `운영 초안: 만 ${BEFORE_US.operatingDraft.minimumAge}세 이상. 최소·최대 나이를 포함해 비교해요.`,
            )}
            {basic.map(field)}
          </div>
        )}
        {tab === 1 && (
          <div className="space-y-8">
            <AppearancePreferences
              draft={draft}
              onChange={onChange}
              onImportance={importance}
              errors={errors}
            />
            <details
              open={relationshipOpen}
              onToggle={(event) =>
                setRelationshipOpen(event.currentTarget.open)
              }
              className="border-t border-border pt-6"
            >
              <summary className="cursor-pointer text-sm font-semibold">
                성향·관계 취향{" "}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  모두 선택 · 상대 비공개
                </span>
              </summary>
              <h2 className="mt-5 text-xl font-semibold">
                어떤 사람에게 마음이 가나요?
              </h2>
              <p className="mt-3 text-xs leading-7 text-muted-foreground">
                외적인 취향과 함께, 편안하게 알아갈 수 있는 모습을 알려 주세요.
                미입력이어도 신청할 수 있어요.
              </p>
              <p className="mt-3 rounded-xl bg-muted p-4 text-xs leading-7 text-muted-foreground">
                선호 MBTI는 ‘상관없어요’를 먼저 생각해 보세요. 자동으로 선택하지
                않으며 특정 유형을 복수 선택할 수도 있어요. MBTI는 참고 정보일
                뿐 필수 조건이나 궁합 점수가 아니에요.
              </p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {RELATIONSHIP_FIELDS.map((item) =>
                  field(item.id.replace("desired.", "")),
                )}
              </div>
              <p className="mt-4 text-xs leading-7 text-muted-foreground">
                운영자는 외적 취향·기본 조건·생활·대화 성향과 이 정보를 함께
                참고해요. MBTI 조합·태그 개수·질문 답변을 자동 점수화해 상대를
                확정하거나, 사진·MBTI에서 성격을 추론하지 않아요.
              </p>
            </details>
          </div>
        )}
        {tab === 2 && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">{ways.map(field)}</div>
            <div className="border-t border-border pt-5">
              <p className="text-sm font-semibold">
                두 가지 시작, 지금은 알아보기만.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {[
                  [
                    "A",
                    "편지 나누기",
                    "각자 하루 한 통, 질문과 편지로 서로의 생각을 알아갑니다.",
                  ],
                  [
                    "B",
                    "첫 장면 만들기",
                    "공동 선택으로 두 사람의 첫 장면을 함께 만들어요.",
                  ],
                ].map(([letter, title, text]) => (
                  <article key={letter} className="border border-border p-5">
                    <span className="text-3xl font-semibold text-primary">
                      {letter}
                    </span>
                    <h3 className="mt-3 text-sm font-semibold">{title}</h3>
                    <p className="mt-2 text-xs leading-7 text-muted-foreground">
                      {text}
                    </p>
                  </article>
                ))}
              </div>
              <p className="mt-4 text-xs leading-7">
                상호 선택과 양쪽 결제 뒤, 두 사람이 같은 방식과 시작일을
                결정해요. 지금 선택하거나 확정하지 않아요.
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                대화 느낌·주관적인 인상은 자동 탈락 조건이 아니에요.
              </p>
            </div>
          </div>
        )}
      </div>
      <PreferenceSummary draft={draft} />
      {notice && (
        <p role="status" className="rounded-xl bg-muted p-4 text-xs leading-7">
          {notice}
        </p>
      )}
      <button
        type="button"
        onClick={() => setRequestOpen(!requestOpen)}
        aria-expanded={requestOpen}
        className="flex items-center gap-2 rounded-sm text-xs text-primary underline underline-offset-4"
      >
        더 중요한 기준이 있나요? 추가 요청·신청 보류
        <ArrowRight size={13} />
      </button>
      {requestOpen && (
        <section className="space-y-4 rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold">
            내 기준을 그대로 두고, 요청하기
          </h3>
          <p className="text-xs leading-7 text-muted-foreground">
            {LIVE ? "조건을 자동으로 완화하지 않아요. 적어 준 기준은 신청서와 함께 운영진이 확인해요. 연락처나 다른 사람의 정보는 적지 말아 주세요." : "조건을 자동으로 완화하지 않아요. 가상 기준만 적어 주세요. 아래 선택은 데모 초안에만 기록되고 실제 요청이나 신청 보류 처리는 하지 않아요."}
          </p>
          <Textarea
            aria-label={LIVE ? "운영자에게 요청할 추가 기준" : "운영자에게 요청할 추가 기준 · 가상 정보"}
            maxLength={300}
            value={settings.requestNote}
            onChange={(event) =>
              onChange(draft.values, {
                ...settings,
                requestNote: event.target.value,
              })
            }
            className="rounded-xl"
            placeholder="추가로 중요한 기준을 300자 이내로 적어 주세요."
          />
          <div className="flex flex-wrap gap-2">
            {([
              ["operator", "추가 기준 요청"],
              ["hold", "신청 보류"],
              ["none", "의사 해제"],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                variant="outline"
                aria-pressed={settings.request === value}
                onClick={() =>
                  onChange(draft.values, { ...settings, request: value })
                }
                className={`rounded-xl text-xs ${
                  settings.request === value
                    ? "border-primary text-primary"
                    : ""
                }`}
              >
                {LIVE ? label : `${label} · 데모`}
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
