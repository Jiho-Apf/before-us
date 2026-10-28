import { rpc } from "./client"

// 실제 서버의 교류(서로 선택한 뒤): 합의 → 3일 교류 → 만남 선택 → 약속 → 연락처.
export type ProgramStatus = "choosing" | "scheduled" | "started" | "deciding" | "arranging" | "closed"
export type EntryKind = "letter" | "reply" | "scene" | "final"
export type EntryContent = { body: string | null; payload: Record<string, string> | null; at: string }
export type ProgramEntry = { day: number; kind: EntryKind; own: EntryContent | null; partner: EntryContent | null; partnerSent: boolean }
export type Slot = { date: string; start: string; end: string }
export type Proposal = { id: string; mine: boolean; slots: Slot[]; activity: string; region: string; place: string | null; note: string | null; status: "open" | "accepted"; selected: Slot | null; acceptedAt: string | null; createdAt: string }
export type Program = {
  id: string
  introductionId: string
  status: ProgramStatus
  endReason: string | null
  closedAt: string | null
  partnerName: string | null
  ownPlan: "A" | "B" | null
  partnerPlan: "A" | "B" | null
  startOn: string | null
  agreeBy: string
  ownConfirmed: boolean
  partnerConfirmed: boolean
  startedAt: string | null
  today: string
  day: number | null
  entries: ProgramEntry[]
  meetingOpensAt: string | null
  meetingBy: string | null
  ownMeeting: "positive" | "negative" | null
  arrangeBy: string | null
  meetingOn: string | null
  meetingTime: string | null
  proposals: Proposal[]
  ownContact: boolean
  contactReleaseAt: string | null
  contactUntil: string | null
  contactReleased: boolean
  partnerPhone: string | null
  // 마무리된 교류를 다시 읽을 수 있는 마지막 시각(넷째 날 두 분 모두 만나고 싶다고 했던 교류만)
  readableUntil?: string | null
  notice?: string
}

export const loadMyProgram = () => rpc<Program | null>("my_program")
export const choosePlan = (id: string, plan: "A" | "B") => rpc<Program>("choose_program_plan", { p_program: id, p_plan: plan })
export const proposeStart = (id: string, date: string) => rpc<Program>("propose_program_start", { p_program: id, p_date: date })
export const confirmProgram = (id: string) => rpc<Program>("confirm_program", { p_program: id })
export const submitEntry = (id: string, day: number, kind: EntryKind, body: string | null, payload?: Record<string, string>) =>
  rpc<Program>("submit_program_entry", { p_program: id, p_day: day, p_kind: kind, p_body: body, p_payload: payload ?? null })
export const chooseMeeting = (id: string, choice: "positive" | "negative") => rpc<Program>("choose_meeting", { p_program: id, p_choice: choice })
export const proposeAppointment = (id: string, slots: Slot[], activity: string, region: string, place: string, note: string) =>
  rpc<Program>("propose_appointment", { p_program: id, p_slots: slots, p_activity: activity, p_region: region, p_place: place || null, p_note: note || null })
export const acceptAppointment = (proposal: string, slot: number) => rpc<Program>("accept_appointment", { p_proposal: proposal, p_slot: slot })
export const setContactConsent = (id: string, allowed: boolean) => rpc<Program>("set_contact_consent", { p_program: id, p_allowed: allowed })
// B 마지막 맞추기: 두 분이 고른 것 중에서 장소·흐름·쉬어 갈 곳·이야기를 하나씩 고른다.
export type ScenePick = { activity: string; flow: string; rest: string; topic: string }
export const chooseFirstScene = (id: string, pick: ScenePick) => rpc<Program>("choose_first_scene", { p_program: id, p_pick: pick })

export const PLAN_COPY = {
  A: { name: "A. 편지 나누기", description: "각자 하루 한 통씩, 3일 동안 나누는 이야기. 두 분이 모두 보내면 함께 열리고, 열린 편지에는 다음 날 09:00까지 답장을 한 번 보낼 수 있어요.", days: ["내 하루 한 장면 들려주기", "받은 편지에 답하고 하나 묻기", "만나면 이어 갈 이야기 꺼내기"], example: "예: “요즘 퇴근하고 한강을 걷는 게 제일 좋은 시간이에요.”", fit: "글로 천천히 마음을 전하고 싶은 분께" },
  B: { name: "B. 첫 장면 만들기", description: "하루에 하나씩 장소·머무는 방식·나눌 이야기를 고르고, 짧은 질문에 답하며 서로를 알아가요. 셋째 날 답이 열리면 두 분이 고른 것 중에서 첫 장면을 함께 맞춰요.", days: ["끌리는 장소 고르기", "머무는 방식 정하기", "함께 나눌 이야기 정하기"], example: "예: 서점 · 천천히 머물기 · “요즘 읽는 책 이야기”", fit: "가볍게 고르며 취향을 맞춰 보고 싶은 분께" },
} as const
// 편지 쓰기 첫 문장 도움말(눌러서 이어 쓰기)
export const LETTER_PROMPTS = [
  { title: "내 하루 한 장면", question: "최근의 나를 가장 잘 보여 주는 하루는 어떤 하루였나요?", hints: ["요즘 제 하루는 보통 이렇게 흘러가요. ", "최근에 혼자 웃었던 순간이 있었는데요, ", "주말에 자주 가는 곳이 하나 있어요. "] },
  { title: "당신의 말이 궁금해졌어요", question: "어제 받은 편지에서 기억에 남은 말 하나에 답하고, 궁금한 것을 물어보세요.", hints: ["어제 편지에서 이 말이 오래 남았어요. ", "읽다가 저도 비슷한 기억이 떠올랐어요. ", "하나 더 궁금해진 게 있어요. "] },
  { title: "만나면 이어가고 싶은 이야기", question: "직접 만나게 된다면 어떤 시간을 보내고 싶나요?", hints: ["만나게 된다면 이런 곳을 함께 걸어 보고 싶어요. ", "3일 동안 편지를 주고받으며 느낀 건요, ", "직접 얼굴을 보고 꼭 듣고 싶은 이야기가 있어요. "] },
] as const
// 전날 편지가 함께 열리지 않았을 때의 질문·도움말(받은 편지가 있다고 가정하지 않는다)
const LETTER_PROMPTS_UNOPENED = [
  null,
  { title: "내 이야기 하나, 궁금한 것 하나", question: "어제는 편지가 함께 열리지 않았어요. 오늘은 내 이야기 하나와 상대에게 궁금한 것 하나를 담아 보세요.", hints: ["어제 못 전한 이야기부터 할게요. ", "요즘 제가 자주 하는 생각이 있어요. ", "하나 궁금한 게 있어요. "] },
  { title: "만나면 이어가고 싶은 이야기", question: "직접 만나게 된다면 어떤 시간을 보내고 싶나요?", hints: ["만나게 된다면 이런 곳을 함께 걸어 보고 싶어요. ", "편지로 다 못 한 이야기가 있어요. ", "직접 얼굴을 보고 꼭 듣고 싶은 이야기가 있어요. "] },
] as const
export const letterPrompt = (day: number, previousOpened: boolean) => (!previousOpened && LETTER_PROMPTS_UNOPENED[day - 1]) || LETTER_PROMPTS[day - 1]
// B 첫 장면: 날마다 구체적인 할 일 하나 + 나를 소개하는 짧은 질문 하나. 둘째·셋째 날에는 전날 함께 열린 상대의 선택에 한마디를 남긴다.
export const SCENE_PROMPTS = [
  { title: "끌리는 장소 고르기", question: "처음 만나는 장면으로 끌리는 곳을 하나 고르고, 이유를 한 줄로 적어 주세요.", about: "요즘 주말을 가장 나답게 보내는 방법은 뭐예요?", aboutHint: "예: 동네 빵집에서 아침 먹고 오래 걷기", reaction: "", reactionAlt: "", sees: "상대에게는 고른 곳 · 이유 · 내 답이 보여요. 두 분 모두 보내야 함께 열려요." },
  { title: "머무는 방식 정하기", question: "만나면 얼마나 머물지, 중간에 어디서 쉬어 갈지 골라 주세요.", about: "처음 만난 자리에서 내가 편해지는 방법이 있나요?", aboutHint: "예: 걸으면서 이야기하면 금방 편해져요", reaction: "어제 상대가 고른 곳과 이유에 한마디 남겨 주세요.", reactionAlt: "어제는 함께 열리지 않았어요. 상대가 어떤 곳을 좋아할 것 같은지 짐작해 한마디 남겨 보세요(선택).", sees: "상대에게는 머무는 방식 · 쉬어 갈 곳 · 한마디 · 내 답이 보여요." },
  { title: "함께 나눌 이야기 정하기", question: "만나서 꼭 나누고 싶은 이야기 하나를 적어 주세요.", about: "나를 잘 아는 친구가 나를 한 줄로 소개한다면?", aboutHint: "예: 느긋한데 좋아하는 건 끝까지 파는 사람", reaction: "어제 상대가 고른 머무는 방식에 한마디 남겨 주세요.", reactionAlt: "어제는 함께 열리지 않았어요. 상대에게 건네고 싶은 말을 한마디 남겨 보세요(선택).", sees: "상대에게는 나누고 싶은 이야기 · 한마디 · 내 답이 보여요. 함께 열리면 둘이 고른 것으로 첫 장면을 맞춰요." },
] as const
export const SCENE_TOPIC_EXAMPLES = ["요즘 읽는 책 이야기", "최근에 다녀온 곳", "어릴 때 좋아하던 것"] as const
export const SCENE_ACTIVITY_LABEL: Record<string, string> = { exhibition: "전시", walk: "산책", bookstore: "서점", cafe: "카페", park: "공원·피크닉", market: "시장 골목", performance: "작은 공연" }
export const SCENE_FLOWS = ["짧게 둘러보기", "천천히 머물기", "발길 닿는 대로"] as const
export const SCENE_RESTS = ["조용한 카페", "공공 야외 공간", "디저트·빵집", "강가·벤치"] as const
// 첫 장면의 분위기 → 약속 제안의 활동(약속을 제안할 때 미리 골라 둔다)
export const SCENE_TO_APPOINTMENT: Record<string, string> = { exhibition: "전시·미술관", walk: "산책·공원", bookstore: "서점·책방", cafe: "카페·디저트", park: "산책·공원", market: "식사·맛집", performance: "공연·문화" }
// 첫 장면 → 약속 제안 한마디(흐름·쉬어 갈 곳·이야기를 미리 적어 둔다)
export const sceneNote = (pick: Partial<ScenePick> | null | undefined) => pick ? [pick.flow, pick.rest && `쉬어 갈 곳 ${pick.rest}`, pick.topic && `“${pick.topic}” 이야기`].filter(Boolean).join(" · ").slice(0, 300) : ""

// 보내기 전 연락처 검사(서버 has_contact와 같은 기준). 날짜·시각·가격은 막지 않는다.
// 오래된 iOS Safari도 읽을 수 있게 앞을 되돌아보는 정규식 문법은 쓰지 않고, 앞 글자는 함수로 확인한다.
const DATE = /(?:19|20)[0-9]{2}\s?(?:[./-]|년)\s?(?:0?[1-9]|1[0-2])\s?(?:[./-]|월)\s?(?:0?[1-9]|[12][0-9]|3[01])(?![0-9])(?![./-][0-9])/g
const stripDates = (text: string) => text.replace(DATE, (match: string, offset: number) => {
  // 날짜 바로 앞에 숫자가 붙어 있으면(예: 010 2026-10-28) 날짜로 보지 않는다.
  const before = text.slice(Math.max(0, offset - 2), offset)
  return /[0-9./-]$/.test(before) || /[0-9][\s./-]$/.test(before) ? match : " "
})
const CONTACT = [
  /(?:^|[^0-9])(?:\+?82[\s.-]?)?0?1[016789][\s.-]?[0-9]{3,4}[\s.-]?[0-9]{4}|(?:[0-9][\s.-]?){10,11}|공일공|영일영/i,
  /[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z.]{2,}/i,
  /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|kr|me|io|ly|link|app|page)\b/i,
  /(?:카톡|카카오톡|텔레그램|오픈\s*채팅|오픈톡|라인)\s*(?:아이디|id|주소|링크|추가)|(?:인스타|instagram|insta)\s*(?:아이디|계정|id|팔로우|디엠|dm)|(?:아이디|id)\s*(?:는|은|:)\s*[a-z0-9_.]{3,}|(?:^|\s)@[a-z0-9_.]{3,}/i,
  /[0-9]{2,6}-[0-9]{2,6}-[0-9]{2,7}/,
]
export function contactProblem(...texts: (string | null | undefined)[]) {
  const text = stripDates(texts.filter(Boolean).join(" ").normalize("NFKC"))
  return CONTACT.some(pattern => pattern.test(text)) ? "연락처·SNS 아이디·링크·계좌번호가 들어 있는 것 같아요. 그 부분을 빼고 보내 주세요. 연락처는 두 분이 동의하면 만나는 날 비포어스에서 열려요." : null
}

export const END_REASON: Record<string, string> = {
  "agreement-expired": "교류 방식과 시작일을 기한(48시간) 안에 함께 정하지 못해 마무리됐어요.",
  "meeting-declined": "이번 교류는 여기서 마무리됐어요. 누가 어떤 답을 했는지는 알려 드리지 않아요.",
  "meeting-nonresponse": "만남 선택 기한이 지나 마무리됐어요.",
  "arrange-expired": "7일 안에 약속이 정해지지 않아 마무리됐어요.",
  completed: "만남까지 마친 교류예요. 불편한 일이 있었다면 두 사람 화면에서 신고해 주세요.",
  blocked: "상대의 사정으로 더 이어 가기 어려워졌어요.",
  withdrawn: "상대의 사정으로 더 이어 가기 어려워졌어요.",
  suspended: "상대의 사정으로 더 이어 가기 어려워졌어요.",
  "admin-cancel": "운영 사정으로 교류를 마무리했어요. 불편을 드려 죄송해요.",
}
