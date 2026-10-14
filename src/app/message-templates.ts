import { useSyncExternalStore } from "react"

// 회원 알림 메시지 템플릿 (V6-message-01).
// 카카오 알림톡(정보성) 우선, 실패하면 문자로 대체한다. 실제 발송·카카오 심사는 연결되어 있지 않다.
// 상대의 이름·사진·연락처·편지 내용은 메시지에 넣지 않고, 홈페이지 링크로만 안내한다.
export const MESSAGE_POLICY = { version: "V6-message-01", noonAt: "12:00", kakaoMaxChars: 1000, smsMaxBytes: 90, lmsMaxBytes: 2000 } as const

export const MESSAGE_VARIABLES = {
  "#{이름}": { label: "받는 회원의 활동용 이름", sample: "서연" },
  "#{링크}": { label: "로그인 후 확인하는 고정 경로 · 개인정보 없음", sample: "beforeus.kr/today" },
  "#{응답기한}": { label: "응답 마감 시각", sample: "10월 21일(화) 오전 11:00" },
  "#{결제기한}": { label: "교류비 결제 마감 시각", sample: "10월 21일(화) 오후 12:00" },
  "#{시작일}": { label: "교류 시작일", sample: "10월 23일(목)" },
  "#{약속일시}": { label: "합의된 약속 날짜·시간 (장소 제외)", sample: "10월 26일(일) 오후 2:00" },
} as const
type Variable = keyof typeof MESSAGE_VARIABLES

export type TemplateStatus = "draft" | "ready" | "submitted" | "approved" | "rejected"
export const STATUS_LABELS: Record<TemplateStatus, string> = {
  draft: "초안",
  ready: "검수 요청 준비 완료",
  submitted: "카카오 심사 중 (수동 기록)",
  approved: "카카오 승인 (수동 기록)",
  rejected: "반려 (수동 기록)",
}
export type MessageTemplate = {
  id: string
  group: "소개" | "교류" | "약속·만남" | "신청·계정"
  name: string
  trigger: string
  timing: string
  audience: string
  optIn: boolean
  body: string
  smsBody: string
  version: number
  status: TemplateStatus
  statusNote: string | null
  updatedAt: string | null
  history: { version: number; body: string; smsBody: string; at: string; reason: string }[]
}
const T = (id: string, group: MessageTemplate["group"], name: string, trigger: string, timing: string, audience: string, optIn: boolean, body: string, smsBody: string): MessageTemplate =>
  ({ id, group, name, trigger, timing, audience, optIn, body, smsBody, version: 1, status: "draft", statusNote: null, updatedAt: null, history: [] })

export const DEFAULT_TEMPLATES: MessageTemplate[] = [
  T("noon-introduction", "소개", "오늘의 인연", "운영진이 최종 선택한 소개가 공개될 때", "준비된 날 12:00", "소개가 공개되는 두 회원", false,
    "[비포어스] #{이름}님, 오늘의 인연을 소개해 드려요.\n\n운영진이 #{이름}님의 이야기를 천천히 읽고, 한 분을 골랐어요.\n상대의 소개는 비포어스 안에서만 확인할 수 있어요.\n\n· 응답 기한: #{응답기한}\n· 확인하기: #{링크}\n\n서두르지 않으셔도 괜찮아요. 끌리는지, 천천히 살펴봐 주세요.",
    "[비포어스] #{이름}님, 오늘의 인연이 도착했어요. #{링크}"),
  T("noon-none", "소개", "오늘은 소개가 없을 때", "그날 정오에 준비된 소개가 없을 때", "12:00", "‘대기 중 안내 받기’를 켠 회원만", true,
    "[비포어스] #{이름}님, 오늘은 소개해 드릴 분을 아직 찾지 못했어요.\n\n서두르기보다, #{이름}님과 정말 어울릴 한 분을 찾고 싶어 조금 더 살펴보고 있어요.\n기다리시는 동안 추가 비용은 없고, 소개 권리도 그대로예요.\n\n준비되는 날 정오에 가장 먼저 알려 드릴게요.",
    "[비포어스] #{이름}님, 오늘은 소개가 없어요. 어울릴 분을 신중히 찾고 있어요."),
  T("waiting-long", "소개", "기다림이 길어질 때", "새 소개 없이 14일이 지났을 때 (1회)", "12:00", "활동 중인 대기 회원", false,
    "[비포어스] #{이름}님, 기다림이 길어지고 있어 먼저 연락드려요.\n\n아직 꼭 맞는 분을 찾지 못해 죄송한 마음이에요. 계속 기다리셔도 괜찮고, 원하시면 조건을 함께 다시 살펴보거나 잠시 쉬었다 다시 시작하실 수도 있어요.\n\n· 내 정보: #{링크}",
    "[비포어스] #{이름}님, 기다림이 길어져 먼저 연락드려요. #{링크}"),
  T("mutual", "소개", "서로 알아가고 싶다고 답했을 때", "두 분 모두 ‘알아가고 싶어요’를 선택했을 때", "확인 즉시", "상호 선택한 두 회원", false,
    "[비포어스] #{이름}님, 두 분 모두 서로를 더 알아가고 싶다고 답했어요.\n\n이제 두 분이 함께할 3일을 준비할 차례예요.\n· 교류비 결제 기한: #{결제기한}\n· 확인하기: #{링크}",
    "[비포어스] 두 분 모두 알아가고 싶다고 답했어요. #{링크}"),
  T("introduction-ended", "소개", "이번 소개가 마무리됐을 때", "상호 선택으로 이어지지 않았을 때", "응답 마감 후", "해당 회원", false,
    "[비포어스] #{이름}님, 이번 소개는 여기서 마무리되었어요.\n\n두 분의 시간이 맞지 않았을 뿐이에요. 다음 소개도 운영진이 천천히, 신중하게 준비할게요.\n추가 비용은 없어요.",
    "[비포어스] #{이름}님, 이번 소개는 마무리되었어요. 다음 소개를 신중히 준비할게요."),
  T("exchange-start", "교류", "3일 교류가 시작될 때", "두 분이 합의한 시작일 아침", "시작일 09:00", "교류를 시작하는 두 회원", false,
    "[비포어스] #{이름}님, 오늘부터 두 분의 3일이 시작돼요.\n\n첫 이야기는 여기에서 열려요: #{링크}\n오늘 하루, 편한 시간에 천천히 들러 주세요.",
    "[비포어스] 오늘부터 두 분의 3일이 시작돼요. #{링크}"),
  T("letter-reply-reminder", "교류", "답장을 아직 쓰지 않았을 때", "그날 편지가 함께 열렸고 18:00까지 답장하지 않았을 때 (하루 1회)", "18:00", "아직 답장하지 않은 회원", false,
    "[비포어스] #{이름}님, 오늘 받은 편지에 아직 답장하지 않았어요.\n\n답장은 오늘 23:59까지 쓸 수 있고, 두 분 모두 답장을 보내야 함께 열려요. 23:59가 지나면 이 편지에는 답장을 남길 수 없어요.\n· 답장 쓰기: #{링크}",
    "[비포어스] 오늘 편지 답장은 23:59까지예요. #{링크}"),
  T("letter-reply", "교류", "답장이 함께 열렸을 때", "두 분 모두 답장을 보냈을 때", "두 번째 답장 즉시", "교류 중인 두 회원", false,
    "[비포어스] #{이름}님, 두 분의 답장이 함께 열렸어요.\n\n지금 읽어 볼 수 있어요.\n· 읽기: #{링크}",
    "[비포어스] 두 분의 답장이 함께 열렸어요. #{링크}"),
  T("day4", "교류", "만남 의사를 물을 때", "3일 교류를 마친 다음 날", "DAY04 09:00", "교류를 마친 두 회원", false,
    "[비포어스] #{이름}님, 3일의 교류가 끝났어요.\n\n이 사람을, 직접 만나보고 싶나요?\n각자의 선택은 두 분 모두 답하기 전까지 서로에게 보이지 않아요.\n\n· 응답 기한: #{응답기한}\n· 답하기: #{링크}",
    "[비포어스] 3일의 교류가 끝났어요. 만남 의사를 알려 주세요. #{링크}"),
  T("meeting-confirmed", "약속·만남", "약속이 정해졌을 때", "두 분이 같은 약속안을 확인했을 때", "확인 즉시", "약속을 합의한 두 회원", false,
    "[비포어스] #{이름}님, 두 분의 약속이 정해졌어요.\n\n· 일시: #{약속일시}\n· 장소와 첫 만남 안전 가이드: #{링크}\n\n연락처는 두 분 모두 동의한 경우에만, 만나는 날 00:00부터 다음 날까지 홈페이지에서 보여 드려요.",
    "[비포어스] 약속이 정해졌어요. #{약속일시} 자세히: #{링크}"),
  T("meeting-day", "약속·만남", "만나는 날 아침", "약속 당일", "약속일 09:00", "약속이 있는 두 회원", false,
    "[비포어스] #{이름}님, 오늘은 두 분이 만나는 날이에요.\n\n사람이 많은 곳에서, 편한 마음으로 만나세요. 불편한 순간이 있으면 언제든 자리에서 일어나도 괜찮아요.\n· 오늘의 약속과 연락처: #{링크}",
    "[비포어스] 오늘은 만나는 날이에요. 약속 확인: #{링크}"),
  T("after-meeting", "약속·만남", "만남 후 이야기 요청", "약속 시작 3시간 뒤", "약속 후", "만난 두 회원", false,
    "[비포어스] #{이름}님, 오늘 만남은 어떠셨나요?\n\n운영진에게만 전해지는 짧은 이야기를 남겨 주세요. 상대에게는 보이지 않아요.\n· 남기기: #{링크}",
    "[비포어스] 만남은 어떠셨나요? 운영진에게만 전해져요. #{링크}"),
  T("waitlist", "신청·계정", "순차 검토 대기 안내", "신청이 많아 순차 검토로 접수됐을 때", "접수 즉시", "해당 신청자", false,
    "[비포어스] #{이름}님, 신청해 주셔서 고마워요.\n\n지금은 신청이 많아 운영진이 순서대로 읽고 있어요. 신청 내용은 그대로 보관되고, 검토가 시작되면 바로 알려 드릴게요.\n· 진행 상태: #{링크}",
    "[비포어스] 신청 고마워요. 순서대로 검토 중이에요. #{링크}"),
  T("review-done", "신청·계정", "신청서 검토를 마쳤을 때", "운영진이 신청서를 직접 검토했을 때", "검토 즉시", "해당 신청자", false,
    "[비포어스] #{이름}님, 운영진이 신청서를 모두 읽었어요.\n\n이제 #{이름}님과 어울릴 분을 찾기 시작할게요. 소개가 준비되는 날 정오에 알려 드려요.\n· 진행 상태: #{링크}",
    "[비포어스] 신청서 검토를 마쳤어요. 소개 준비되면 정오에 알려 드려요."),
  T("photo-revision", "신청·계정", "사진 보완이 필요할 때", "사진 기준 확인에서 보완 요청이 있을 때", "요청 즉시", "해당 신청자", false,
    "[비포어스] #{이름}님, 사진 한 장만 다시 부탁드려요.\n\n어떤 사진인지와 이유는 홈페이지에서 확인할 수 있어요. 나머지 신청 내용은 그대로예요.\n· 확인하기: #{링크}",
    "[비포어스] 사진 한 장 보완이 필요해요. #{링크}"),
  T("withdrawal", "신청·계정", "탈퇴 요청 접수", "회원이 탈퇴를 요청했을 때", "요청 즉시", "해당 회원", false,
    "[비포어스] #{이름}님, 탈퇴 요청을 받았어요.\n\n그동안 비포어스와 함께해 주셔서 고마워요. 자료 삭제 일정과 환불 진행 상태는 아래에서 확인할 수 있어요.\n· 확인하기: #{링크}",
    "[비포어스] 탈퇴 요청을 받았어요. 진행 상태: #{링크}"),
]

// 정보성 알림톡에는 광고 문구를 넣을 수 없다. 개인정보와 외부 링크도 막는다.
const AD_WORDS = ["할인", "이벤트", "쿠폰", "특가", "프로모션", "무료 체험", "선착순", "적립", "혜택 받", "지금 가입", "광고"]
const eucKrBytes = (text: string) => [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 2 : 1), 0)
export const fillSample = (text: string) => text.replace(/#\{[^}]+\}/g, (token) => (MESSAGE_VARIABLES as Record<string, { sample: string }>)[token]?.sample ?? token)
export function lintTemplate(template: Pick<MessageTemplate, "body" | "smsBody">) {
  const errors: string[] = [], warnings: string[] = []
  for (const [field, text] of [["알림톡", template.body], ["문자", template.smsBody]] as const) {
    const unknown = [...new Set(text.match(/#\{[^}]*\}/g) || [])].filter((token) => !(token in MESSAGE_VARIABLES))
    if (unknown.length) errors.push(`${field}: 쓸 수 없는 변수 ${unknown.join(", ")}`)
    const ads = AD_WORDS.filter((word) => text.includes(word))
    if (ads.length) errors.push(`${field}: 정보성 알림에는 광고 문구를 넣을 수 없어요 (${ads.join(", ")})`)
    if (/(?:https?:\/\/|www\.)/i.test(text)) errors.push(`${field}: 링크는 #{링크} 변수로만 넣어 주세요`)
    if (/\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4}/.test(text) || /@/.test(text)) errors.push(`${field}: 전화번호·이메일을 넣을 수 없어요`)
    if (!text.trim().startsWith("[비포어스]")) warnings.push(`${field}: [비포어스]로 시작하면 누가 보냈는지 바로 알 수 있어요`)
  }
  if (!template.body.trim()) errors.push("알림톡 본문을 입력해 주세요")
  if (template.body.length > MESSAGE_POLICY.kakaoMaxChars) errors.push(`알림톡은 ${MESSAGE_POLICY.kakaoMaxChars}자 이하`)
  const bytes = eucKrBytes(fillSample(template.smsBody))
  if (!template.smsBody.trim()) warnings.push("문자 대체 문구가 없으면 알림톡 실패 시 보내지 않아요")
  else if (bytes > MESSAGE_POLICY.lmsMaxBytes) errors.push(`문자는 ${MESSAGE_POLICY.lmsMaxBytes}바이트 이하`)
  else if (bytes > MESSAGE_POLICY.smsMaxBytes) warnings.push(`문자 ${bytes}바이트 · 90바이트를 넘어 장문(LMS)으로 발송돼 비용이 올라가요`)
  return { errors, warnings, smsBytes: bytes, smsKind: bytes > MESSAGE_POLICY.smsMaxBytes ? "LMS" : "SMS" }
}

let templates: MessageTemplate[] = structuredClone(DEFAULT_TEMPLATES)
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const commit = (next: MessageTemplate[]) => { templates = next; listeners.forEach((listener) => listener()) }
export const getTemplates = () => templates
export const useTemplates = () => useSyncExternalStore(subscribe, getTemplates, getTemplates)
export function resetTemplates() { commit(structuredClone(DEFAULT_TEMPLATES)) }

// 저장할 때마다 새 버전. 이미 심사·승인된 문구를 바꾸면 초안으로 돌아가 다시 심사를 받아야 한다.
export function saveTemplate(id: string, body: string, smsBody: string, reason: string, now = new Date()) {
  const current = templates.find((item) => item.id === id)
  if (!current) return "템플릿을 찾을 수 없어요."
  if (!reason.trim()) return "수정 이유를 남겨 주세요."
  if (body === current.body && smsBody === current.smsBody) return "바뀐 내용이 없어요."
  const lint = lintTemplate({ body, smsBody })
  if (lint.errors.length) return lint.errors[0]
  commit(templates.map((item) => item.id !== id ? item : {
    ...item, body, smsBody, version: item.version + 1, status: "draft", statusNote: item.status === "approved" ? "승인된 문구를 수정했어요 · 새 템플릿으로 다시 심사 필요" : null, updatedAt: now.toISOString(),
    history: [...item.history, { version: item.version, body: item.body, smsBody: item.smsBody, at: now.toISOString(), reason: reason.trim() }],
  }))
  return null
}
export function restoreVersion(id: string, version: number, now = new Date()) {
  const current = templates.find((item) => item.id === id), old = current?.history.find((item) => item.version === version)
  if (!current || !old) return "되돌릴 버전을 찾을 수 없어요."
  return saveTemplate(id, old.body, old.smsBody, `v${version}으로 되돌림`, now)
}
const NEXT: Partial<Record<TemplateStatus, TemplateStatus[]>> = { draft: ["ready"], ready: ["draft", "submitted"], submitted: ["approved", "rejected"], rejected: ["draft"], approved: [] }
export function setTemplateStatus(id: string, status: TemplateStatus, note: string, now = new Date()) {
  const current = templates.find((item) => item.id === id)
  if (!current) return "템플릿을 찾을 수 없어요."
  if (!NEXT[current.status]?.includes(status)) return `${STATUS_LABELS[current.status]}에서 ${STATUS_LABELS[status]}(으)로 바꿀 수 없어요.`
  if (status === "ready" && lintTemplate(current).errors.length) return "검사 오류를 먼저 고쳐 주세요."
  if (status === "rejected" && !note.trim()) return "반려 사유를 적어 주세요."
  commit(templates.map((item) => item.id === id ? { ...item, status, statusNote: note.trim() || null, updatedAt: now.toISOString() } : item))
  return null
}
