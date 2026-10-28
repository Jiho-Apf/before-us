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
// 마무리 뒤 다시 읽을 수 있는 지난 교류(넷째 날 두 분 모두 만나고 싶다고 했고, 마무리 후 30일 안·차단 없음). 새 교류가 시작돼도 남는다.
export type ReadableProgram = { id: string; introductionId: string; status: "closed"; endReason: string | null; closedAt: string; partnerName: string | null; ownPlan: "A" | "B" | null; partnerPlan: "A" | "B" | null; startOn: string | null; meetingOn: string | null; today: string; readableUntil: string; entries: ProgramEntry[] }
export const loadReadablePrograms = () => rpc<ReadableProgram[]>("my_readable_programs")
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
  A: { name: "A. 편지 나누기", description: "각자 하루 한 통씩, 3일 동안 나누는 이야기. 두 분이 모두 보내면 함께 열리고, 열린 편지에는 다음 날 09:00까지 답장을 한 번 보낼 수 있어요.", days: ["쉬는 날의 나 들려주기", "요즘 마음을 쓰는 것 나누기", "만나면 함께 보낼 시간 그려 보기"], example: "예: “쉬는 날엔 동네 도서관 창가 자리에서 해 질 때까지 책을 읽어요.”", fit: "글로 천천히 마음을 전하고 싶은 분께" },
  B: { name: "B. 첫 장면 만들기", description: "하루에 하나씩 장소·머무는 방식·나눌 이야기를 고르고, 짧은 질문에 답하며 서로를 알아가요. 셋째 날 답이 열리면 두 분이 고른 것 중에서 첫 장면을 함께 맞춰요.", days: ["끌리는 장소 고르기", "그곳에서 머무는 방식 정하기", "함께 나눌 이야기 정하기"], example: "예: 서점 · 각자 한 권씩 골라 보기 · “요즘 읽는 책 이야기”", fit: "가볍게 고르며 취향을 맞춰 보고 싶은 분께" },
} as const
// 편지 질문: 상대가 ‘이 사람은 어떤 사람인지’ 알아볼 수 있게 묻는다. 예시는 읽기만 하는 참고(눌러도 편지에 들어가지 않는다).
export const LETTER_PROMPTS = [
  { title: "나의 쉬는 날", question: "쉬는 날, 보통 어떤 시간을 보내나요?", examples: ["쉬는 날엔 늦잠을 자고, 오후에 동네 도서관에 가요. 창가 자리에서 책을 읽다 보면 해가 져 있어요.", "토요일 아침마다 친구들과 배드민턴을 쳐요. 끝나고 다 같이 먹는 국밥이 사실 더 기다려져요.", "집에서 요리를 자주 해요. 지난 주말엔 처음으로 된장찌개를 끓였는데 생각보다 맛있었어요."] },
  { title: "요즘 마음을 쓰는 것", question: "요즘 가장 마음을 쓰고 있는 건 무엇인가요? 왜 소중한지도 들려주세요.", examples: ["요즘은 가족과 저녁을 함께 먹는 시간을 아껴요. 바빠도 일주일에 한 번은 꼭 지키려고 해요.", "일을 잘하는 것보다 오래 즐겁게 하는 게 더 중요해졌어요. 그래서 퇴근 뒤 시간을 지키려고 해요.", "작은 약속이라도 지키는 사람이고 싶어요. 친구와 정한 산책 약속도 미루지 않으려고 해요."] },
  { title: "함께 보내고 싶은 시간", question: "만나게 된다면, 함께 어떤 시간을 보내고 싶나요?", examples: ["조용한 전시를 천천히 보고, 근처 카페에서 본 것 이야기를 나누고 싶어요.", "날이 좋으면 강가를 같이 걷고 싶어요. 걸으면서 이야기하면 저는 금방 편해지거든요.", "맛있는 밥 한 끼를 천천히 먹으면서, 편지로 다 못 한 이야기를 듣고 싶어요."] },
] as const
// 전날 편지가 함께 열리지 않았을 때의 질문(상대가 전날 이야기를 아직 모르니 함께 담아 달라고 한다)
const LETTER_PROMPTS_UNOPENED = [
  null,
  { title: "쉬는 날의 나, 요즘의 나", question: "어제는 편지가 함께 열리지 않았어요. 오늘은 쉬는 날을 어떻게 보내는지와, 요즘 마음을 쓰고 있는 것을 함께 들려주세요.", examples: ["쉬는 날엔 동네를 오래 걸어요. 요즘은 그 시간에 한 주를 정리하는 게 저한테 가장 소중해요.", "주말엔 집에서 영화를 보며 쉬어요. 요즘은 건강을 챙기려고 아침마다 스트레칭을 하고 있어요."] },
  { title: "함께 보내고 싶은 시간", question: "어제는 편지가 함께 열리지 않았어요. 요즘 마음을 쓰는 것 하나와, 만나면 함께 보내고 싶은 시간을 들려주세요.", examples: ["요즘은 몸을 챙기는 데 마음을 써요. 만나면 가볍게 걷고 따뜻한 차 한잔하고 싶어요.", "요즘 일에 마음을 많이 쓰고 있어요. 만나면 조용한 곳에서 편하게 이야기 나누고 싶어요."] },
] as const
export const letterPrompt = (day: number, previousOpened: boolean) => (!previousOpened && LETTER_PROMPTS_UNOPENED[day - 1]) || LETTER_PROMPTS[day - 1]
// B 첫 장면: 날마다 구체적인 할 일 하나 + 나를 소개하는 짧은 질문 하나(꼭 답해요). 둘째·셋째 날에는 전날 함께 열린 상대의 선택에 한마디를 남긴다.
// 첫째·둘째 날 고른 이유는 한 줄(60자 안)로, 적지 않아도 된다.
export const SCENE_PROMPTS = [
  { title: "끌리는 장소 고르기", question: "처음 만나는 장면으로 끌리는 곳을 하나 골라 주세요. 고른 이유는 한 줄로 적어도 좋아요.", about: "요즘 주말을 가장 나답게 보내는 방법은 뭐예요?", aboutHint: "예: 동네 빵집에서 아침 먹고 오래 걷기", reasonHint: "예: 책 고르는 걸 옆에서 구경하는 게 좋아서요", reaction: "", reactionAlt: "", sees: "상대에게는 고른 곳 · 내 답(이유를 적었다면 이유도)이 보여요. 두 분 모두 보내야 함께 열려요." },
  { title: "그곳에서 머무는 방식 정하기", question: "어제 고른 곳에서 어떻게 머물지, 중간에 어디서 쉬어 갈지 골라 주세요.", about: "처음 만난 자리에서 내가 편해지는 방법이 있나요?", aboutHint: "예: 걸으면서 이야기하면 금방 편해져요", reasonHint: "예: 처음엔 오래 앉아 있는 것보다 걷는 게 편해서요", reaction: "어제 상대가 고른 곳과 이유에 한마디 남겨 주세요.", reactionAlt: "어제는 함께 열리지 않았어요. 상대가 어떤 곳을 좋아할 것 같은지 짐작해 한마디 남겨 보세요(선택).", sees: "상대에게는 머무는 방식 · 쉬어 갈 곳 · 한마디 · 내 답(이유를 적었다면 이유도)이 보여요." },
  { title: "함께 나눌 이야기 정하기", question: "만나서 꼭 나누고 싶은 이야기 하나를 적어 주세요.", about: "나를 잘 아는 친구가 나를 한 줄로 소개한다면?", aboutHint: "예: 느긋한데 좋아하는 건 끝까지 파는 사람", reasonHint: "", reaction: "어제 상대가 고른 머무는 방식에 한마디 남겨 주세요.", reactionAlt: "어제는 함께 열리지 않았어요. 상대에게 건네고 싶은 말을 한마디 남겨 보세요(선택).", sees: "상대에게는 나누고 싶은 이야기 · 한마디 · 내 답이 보여요. 함께 열리면 둘이 고른 것으로 첫 장면을 맞춰요." },
] as const
export const SCENE_REASON_MAX = 60
export const SCENE_TOPIC_EXAMPLES = ["요즘 읽는 책 이야기", "최근에 다녀온 곳", "어릴 때 좋아하던 것"] as const
export const SCENE_ACTIVITY_LABEL: Record<string, string> = { exhibition: "전시", walk: "산책", bookstore: "서점", cafe: "카페", park: "공원·피크닉", market: "시장 골목", performance: "작은 공연" }
// 장소 일곱 곳은 늘 두 줄로: 전시 산책 서점 카페 / 공원·피크닉 시장 골목 작은 공연
export const SCENE_ACTIVITY_ROWS: readonly (readonly string[])[] = [["exhibition", "walk", "bookstore", "cafe"], ["park", "market", "performance"]]
// 둘째 날: 첫날 고른 곳에 맞는 머무는 방식 3가지 · 쉬어 갈 곳 3~4가지(서버 scene_stay_options와 같은 목록)
export const SCENE_STAY: Record<string, { flows: readonly string[]; rests: readonly string[] }> = {
  exhibition: { flows: ["한 전시만 천천히 보기", "마음에 든 작품 앞에서 오래 머물기", "가볍게 보고 나와 걷기"], rests: ["미술관 안 카페", "근처 조용한 카페", "전시장 앞 벤치", "디저트 가게"] },
  walk: { flows: ["가볍게 한 바퀴 걷기", "천천히 오래 걷기", "걷다가 끌리는 곳에 들르기"], rests: ["강가 벤치", "공원 쉼터", "길가 작은 카페", "동네 빵집"] },
  bookstore: { flows: ["각자 한 권씩 골라 보기", "좋아하는 책 서로 소개하기", "짧게 둘러보고 나오기"], rests: ["서점 안 카페", "근처 조용한 카페", "책 읽기 좋은 벤치", "디저트·빵집"] },
  cafe: { flows: ["한 곳에서 오래 이야기하기", "두 곳을 옮겨 가며 머물기", "커피 들고 근처 걷기"], rests: ["근처 공원 벤치", "디저트 가게", "조용한 산책길"] },
  park: { flows: ["돗자리 펴고 오래 머물기", "가볍게 걷다가 쉬기", "간단히 먹고 산책하기"], rests: ["나무 그늘 아래", "물가 벤치", "공원 앞 카페", "잔디밭 한쪽"] },
  market: { flows: ["조금씩 맛보며 걷기", "구경하며 천천히 돌기", "한 곳에 앉아 먹으며 이야기하기"], rests: ["골목 작은 카페", "시장 안 분식집", "근처 공원 벤치", "디저트·빵집"] },
  performance: { flows: ["공연 보고 짧게 이야기하기", "공연 전에 가볍게 먹기", "공연 뒤 천천히 걷기"], rests: ["공연장 근처 카페", "조용한 식당", "근처 공원 벤치"] },
}
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
