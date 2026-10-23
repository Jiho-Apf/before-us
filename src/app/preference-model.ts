import { BEFORE_US } from "./config"
import { RELATIONSHIP_FIELDS } from "./personality-fields"

export type PreferenceValue = string | string[] | boolean
export type PreferenceSettings = {
  importance: Record<string, "preference" | "required">
  confidential: Record<string, boolean>
  request: "none" | "operator" | "hold"
  requestNote: string
}
export const emptyPreferences = (): PreferenceSettings => ({
  importance: {},
  confidential: {},
  request: "none",
  requestNote: "",
})
export const clonePreferences = (
  source?: PreferenceSettings,
): PreferenceSettings => ({
  ...emptyPreferences(),
  ...source,
  importance: { ...source?.importance },
  confidential: { ...source?.confidential },
})
const definition = (
  id: string,
  label: string,
  format: "single" | "multi" | "number" | "text",
  options?: readonly string[],
  limit?: number,
) => ({
  id: `desired.${id}`,
  label,
  format,
  options,
  limit,
  step: 2,
  group: "optional" as const,
  purpose: "상대에게 바라는 선호 · 운영자 참고 · 상대 비공개",
  required: false,
  scope: "operator" as const,
})
export const REGIONS = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "제주",
]
export const APPEARANCE_PREFIX = "desired.appearance."
export const EYES_WOMEN = ["부드럽고 둥근", "길고 또렷한", "맑고 큰", "고양이상", "강아지상", "웃을 때 편안한"] as const
export const EYES_MEN = ["선하고 순한", "날렵하고 또렷한", "깊고 진한", "웃을 때 접히는", "차분하고 단정한", "담백한 무쌍"] as const
export const HEIGHT_CRITERION = `${APPEARANCE_PREFIX}heightMode`
export const APPEARANCE_FIELDS = [
  definition("appearance.mode", "외적인 취향 작성 상태", "single", [
    "작성",
    "선호 없음",
    "나중에 작성",
  ]),
  definition(
    "appearance.impression",
    "전체 인상",
    "multi",
    [
      "부드러운",
      "또렷한",
      "단정한",
      "따뜻한",
      "차분한",
      "밝은",
      "귀여운",
      "시크한",
      "성숙한",
      "지적인",
      "세련된",
      "건강한",
      "듬직한",
      "자연스러운",
    ],
    3,
  ),
  definition(
    "appearance.style",
    "스타일",
    "multi",
    ["미니멀", "캐주얼", "깔끔한", "클래식", "댄디", "스트릿", "스포티", "아웃도어", "빈티지", "개성 있는"],
    3,
  ),
  definition(
    "appearance.body",
    "체형",
    "multi",
    ["마른 편", "보통", "탄탄한 편", "체격 있는 편"],
    2,
  ),
  definition("appearance.heightMode", "희망 키", "single", [
    "범위 지정",
    "선호 없음",
  ]),
  {
    ...definition("appearance.heightMin", "최소 키 · cm", "number"),
    rule: "positive-cm" as const,
  },
  {
    ...definition("appearance.heightMax", "최대 키 · cm", "number"),
    rule: "positive-cm" as const,
  },
  definition("appearance.hair", "헤어", "single", [
    "짧고 단정한",
    "자연스러운 중간 길이",
    "긴 머리",
    "웨이브·펌",
    "묶은 머리",
    "길이보다 전체 스타일",
  ]),
  // 눈매: 여성·남성의 눈매를 나눠 보여 준다(같은 칸 안에서 살짝 떨어진 두 묶음). 둘 다 골라도 된다.
  definition("appearance.eyes", "눈매 느낌", "multi", [...EYES_WOMEN, ...EYES_MEN, "선호 없음"], 2),
  definition("appearance.smile", "웃는 모습", "single", [
    "환하게 크게 웃는",
    "잔잔하게 미소 짓는",
    "장난스럽게 웃는",
    "상관없어요",
  ]),
  definition("appearance.voice", "목소리·말투", "single", [
    "차분하고 낮은",
    "밝고 경쾌한",
    "부드럽고 다정한",
    "상관없어요",
  ]),
  {
    ...definition("appearance.note", "자유 설명", "text"),
    max: 200,
    rule: "no-contact" as const,
  },
]
export const PREFERENCE_FIELDS = [
  definition("ageMode", "희망 만 나이", "single", ["범위 지정", "선호 없음"]),
  definition("ageMin", "최소 만 나이", "number"),
  definition("ageMax", "최대 만 나이", "number"),
  definition("regions", "소개받고 싶은 상대의 주 활동 지역", "multi", [...REGIONS, "선호 없음"]),
  definition("meetingRegions", "실제 만남 가능한 지역", "multi", REGIONS),
  definition("travel", "이동 가능 여부", "single", [
    "이동 가능",
    "생활권 안에서",
    "상황에 따라",
  ]),
  definition("travelTime", "이동 가능 시간", "single", [
    "30분 이내",
    "60분",
    "90분",
    "상관없음",
    // Preserve previously saved answers without silently changing their meaning.
    "1시간 이내",
    "1시간 이상도 가능",
    "상황에 따라",
  ]),
  definition("purpose", "관계 목적", "single", [
    "진지한 연애",
    "천천히 알아가며 연애",
    "선호 없음",
  ]),
  definition("smoking", "흡연", "single", [
    "비흡연 선호",
    "가끔은 괜찮음",
    "선호 없음",
  ]),
  definition("drinking", "음주", "single", [
    "술자리 없이도 편한 사람",
    "가끔 함께",
    "빈도 무관",
  ]),
  definition("schedule", "생활·일정", "multi", [
    "평일 저녁",
    "주말 낮",
    "주말 저녁",
    "조율 가능",
  ]),
  definition("contact", "연락", "single", [
    "짧게 자주",
    "일정한 시간에",
    "여유 있을 때",
    "선호 없음",
  ]),
  definition(
    "conversation",
    "대화 성향",
    "multi",
    [
      "함께 질문",
      "차분히 듣기",
      "가벼운 유머",
      "깊은 이야기",
      "천천히 친해지기",
    ],
    3,
  ),
  definition(
    "interests",
    "관심사",
    "multi",
    [
      "음악",
      "영화",
      "공연",
      "산책",
      "여행",
      "운동",
      "책",
      "요리",
      "전시",
      "게임",
    ],
    5,
  ),
  ...APPEARANCE_FIELDS,
  ...RELATIONSHIP_FIELDS,
]
export const COMPARABLE = [
  "desired.ageMode",
  "desired.regions",
  "desired.purpose",
  "desired.smoking",
  HEIGHT_CRITERION,
]
export const requiredConditions = (settings: PreferenceSettings) =>
  Object.keys(settings.importance).filter(
    (id) => settings.importance[id] === "required",
  )
export function preferenceValueText(
  id: string,
  values: Record<string, PreferenceValue>,
) {
  if (id === "desired.ageMode" && values[id] === "범위 지정")
    return `만 ${values["desired.ageMin"] || "?"}~${values["desired.ageMax"] || "?"}세 (경계 포함)`
  if (id === HEIGHT_CRITERION && values[id] === "범위 지정")
    return `${values[`${APPEARANCE_PREFIX}heightMin`] || "?"}~${values[`${APPEARANCE_PREFIX}heightMax`] || "?"}cm (경계 포함)`
  const value = values[id]
  if (id === HEIGHT_CRITERION)
    return (
      value === "범위 지정" &&
      validHeight(values[`${APPEARANCE_PREFIX}heightMin`]) &&
      validHeight(values[`${APPEARANCE_PREFIX}heightMax`]) &&
      Number(values[`${APPEARANCE_PREFIX}heightMin`]) <=
        Number(values[`${APPEARANCE_PREFIX}heightMax`]) &&
      !["선호 없음", "나중에 작성"].includes(
        String(values[`${APPEARANCE_PREFIX}mode`]),
      )
    )
  return Array.isArray(value) ? value.join(" · ") : String(value || "미입력")
}
export function hasSpecificPreference(
  id: string,
  values: Record<string, PreferenceValue>,
) {
  const value = values[id]
  if (id === "desired.ageMode")
    return (
      value === "범위 지정" &&
      /^\d+$/.test(String(values["desired.ageMin"])) &&
      /^\d+$/.test(String(values["desired.ageMax"])) &&
      Number(values["desired.ageMin"]) >= BEFORE_US.operatingDraft.minimumAge &&
      Number(values["desired.ageMax"]) >= Number(values["desired.ageMin"])
    )
  return Array.isArray(value)
    ? value.length > 0 && !value.includes("선호 없음")
    : !!value && value !== "선호 없음"
}
export function validatePreferences(
  values: Record<string, PreferenceValue>,
  settings: PreferenceSettings,
) {
  const errors: Record<string, string> = {}
  const heightRange = values[HEIGHT_CRITERION] === "범위 지정"
  for (const id of [
    `${APPEARANCE_PREFIX}heightMin`,
    `${APPEARANCE_PREFIX}heightMax`,
  ]) {
    if (heightRange && !validHeight(values[id]))
      errors[id] = "키는 0보다 큰 정수로 입력해 주세요. 단위는 cm예요."
    if (!heightRange && values[id])
      errors[HEIGHT_CRITERION] =
        "키 범위와 선호 없음을 동시에 저장할 수 없어요."
  }
  if (
    heightRange &&
    Number(values[`${APPEARANCE_PREFIX}heightMin`]) >
      Number(values[`${APPEARANCE_PREFIX}heightMax`])
  )
    errors[`${APPEARANCE_PREFIX}heightMax`] =
      "최대 키는 최소 키 이상이어야 해요."
  if (
    ["선호 없음", "나중에 작성"].includes(
      String(values[`${APPEARANCE_PREFIX}mode`]),
    ) &&
    hasAppearanceAnswers(values)
  )
    errors[`${APPEARANCE_PREFIX}mode`] =
      "외적인 취향의 상세 답변과 선호 없음·나중에 작성은 함께 저장할 수 없어요."
  // ‘어떤 인상과 스타일에 눈길이 가나요?’는 필수: 인상·스타일을 하나 이상 고르거나 ‘선호 없음’
  const appearanceMode = values[`${APPEARANCE_PREFIX}mode`]
  if (appearanceMode !== "선호 없음") {
    for (const name of ["impression", "style"]) {
      const picked = values[`${APPEARANCE_PREFIX}${name}`]
      if (!Array.isArray(picked) || picked.length === 0)
        errors[`${APPEARANCE_PREFIX}${name}`] = name === "impression" ? "눈길이 가는 인상을 하나 이상 골라 주세요. 정해 둔 게 없다면 ‘선호 없음’을 눌러 주세요." : "눈길이 가는 스타일을 하나 이상 골라 주세요."
    }
  }
  const hasRange = values["desired.ageMode"] === "범위 지정"
  for (const id of ["desired.ageMin", "desired.ageMax"]) {
    const value = values[id]
    if (
      hasRange &&
      (!value ||
        !/^\d+$/.test(String(value)) ||
        Number(value) < BEFORE_US.operatingDraft.minimumAge ||
        Number(value) > BEFORE_US.ageBand.maxAge)
    )
      errors[id] =
        `만 ${BEFORE_US.operatingDraft.minimumAge}~${BEFORE_US.ageBand.maxAge}세 사이의 정수를 입력해 주세요.`
    if (!hasRange && value)
      errors["desired.ageMode"] =
        "나이 범위와 선호 없음을 동시에 저장할 수 없어요."
  }
  if (
    hasRange &&
    Number(values["desired.ageMin"]) > Number(values["desired.ageMax"])
  )
    errors["desired.ageMax"] = "최대 나이는 최소 나이 이상이어야 해요."
  const regions = values["desired.regions"]
  if (
    Array.isArray(regions) &&
    regions.includes("선호 없음") &&
    regions.length > 1
  )
    errors["desired.regions"] =
      "선호 없음과 상대 선호 지역은 함께 선택할 수 없어요."
  for (const id of requiredConditions(settings))
    if (!COMPARABLE.includes(id) || !hasSpecificPreference(id, values))
      errors[id] = "필수 조건은 비교 가능한 구체적인 값을 확인해 주세요."
  if (
    requiredConditions(settings).length >
    BEFORE_US.operatingDraft.additionalRequiredConditionsMaximum
  )
    errors["desired.ageMode"] =
      "추가 필수 조건은 운영 초안 기준 최대 3개예요. 추가 기준은 운영자에게 요청하거나 신청을 보류해 주세요."
  if (settings.requestNote.length > 300)
    errors["desired.ageMode"] = "추가 기준 요청은 300자 이내로 적어 주세요."
  return errors
}
export function compareRequiredPreference(
  id: string,
  values: Record<string, PreferenceValue>,
  counterpart: Record<string, PreferenceValue | number | undefined>,
): "충족" | "불충족" | "확인 필요" {
  if (
    !COMPARABLE.includes(id) ||
    !hasSpecificPreference(id, values) ||
    Object.keys(validatePreferences(values, emptyPreferences())).length
  )
    return "확인 필요"
  const actual =
    counterpart[
      id === "desired.ageMode"
        ? "self.age"
        : id === HEIGHT_CRITERION
          ? "self.height"
          : id === "desired.regions"
            ? "self.province"
            : id.replace("desired.", "self.")
    ]
  if (
    actual === undefined ||
    actual === "" ||
    actual === "답하지 않음" ||
    actual === "미선택"
  )
    return "확인 필요"
  if (id === "desired.ageMode")
    return typeof actual === "number" && Number.isFinite(actual)
      ? actual >= Number(values["desired.ageMin"]) &&
        actual <= Number(values["desired.ageMax"])
        ? "충족"
        : "불충족"
      : "확인 필요"
  if (id === HEIGHT_CRITERION)
    return validHeight(actual)
      ? Number(actual) >= Number(values[`${APPEARANCE_PREFIX}heightMin`]) &&
        Number(actual) <= Number(values[`${APPEARANCE_PREFIX}heightMax`])
        ? "충족"
        : "불충족"
      : "확인 필요"
  if (typeof actual !== "string") return "확인 필요"
  if (id === "desired.regions")
    return !REGIONS.includes(actual)
      ? "확인 필요"
      : (values[id] as string[]).includes(actual)
        ? "충족"
        : "불충족"
  if (id === "desired.smoking")
    return !["안 함", "가끔", "자주"].includes(actual)
      ? "확인 필요"
      : (
            values[id] === "비흡연 선호"
              ? actual === "안 함"
              : actual === "안 함" || actual === "가끔"
          )
        ? "충족"
        : "불충족"
  return ["진지한 연애", "천천히 알아가며 연애", "아직 정리 중"].includes(
    actual,
  )
    ? actual === values[id]
      ? "충족"
      : "불충족"
    : "확인 필요"
}

function validHeight(value: PreferenceValue | number | undefined) {
  return (
    ((typeof value === "string" && /^\d+$/.test(value)) ||
      typeof value === "number") &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) > 0
  )
}
export function hasAppearanceAnswers(values: Record<string, PreferenceValue>) {
  return APPEARANCE_FIELDS.some(
    (field) =>
      field.id !== `${APPEARANCE_PREFIX}mode` &&
      (Array.isArray(values[field.id])
        ? (values[field.id] as string[]).length > 0
        : !!values[field.id]),
  )
}
export function setAppearanceMode(
  values: Record<string, PreferenceValue>,
  settings: PreferenceSettings,
  mode: string,
) {
  const nextValues: Record<string, PreferenceValue> = {
    ...values,
    [`${APPEARANCE_PREFIX}mode`]: mode,
  }
  const nextSettings = clonePreferences(settings)
  if (mode !== "작성") {
    for (const field of APPEARANCE_FIELDS)
      if (field.id !== `${APPEARANCE_PREFIX}mode`) {
        delete nextValues[field.id]
        delete nextSettings.confidential[field.id]
        delete nextSettings.importance[field.id]
      }
  }
  return { values: nextValues, settings: nextSettings }
}
export function appearanceSummary(values: Record<string, PreferenceValue>) {
  const mode = values[`${APPEARANCE_PREFIX}mode`]
  if (mode === "선호 없음" || mode === "나중에 작성") return [String(mode)]
  const summary: string[] = []
  for (const field of APPEARANCE_FIELDS) {
    if (
      [
        `${APPEARANCE_PREFIX}mode`,
        `${APPEARANCE_PREFIX}heightMin`,
        `${APPEARANCE_PREFIX}heightMax`,
      ].includes(field.id)
    )
      continue
    const value = values[field.id]
    if (!value || (Array.isArray(value) && !value.length)) continue
    if (
      field.id === HEIGHT_CRITERION &&
      value === "범위 지정" &&
      !hasSpecificPreference(HEIGHT_CRITERION, values)
    )
      continue
    summary.push(`${field.label}: ${preferenceValueText(field.id, values)}`)
  }
  return summary
}
