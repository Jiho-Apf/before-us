import { rpc } from "./client"

// 실제 서버의 교류(서로 선택한 뒤): 합의 → 3일 교류 → 만남 선택 → 약속 → 연락처.
export type ProgramStatus = "choosing" | "scheduled" | "started" | "deciding" | "arranging" | "closed"
export type EntryKind = "letter" | "reply" | "scene"
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

export const PLAN_COPY = {
  A: { name: "A. 편지 나누기", description: "각자 하루 한 통씩, 3일 동안 나누는 이야기. 두 분이 모두 보내면 함께 열리고, 열린 편지에 하루 한 번 답장해요.", days: ["내 하루 한 장면", "당신의 말이 궁금해졌어요", "만나면 이어가고 싶은 이야기"], fit: "글로 천천히 마음을 전하고 싶은 분께" },
  B: { name: "B. 첫 장면 만들기", description: "3일 동안 분위기·흐름·대화 소재를 하나씩 고르며, 처음 만나는 날의 한 장면을 함께 만들어요.", days: ["어떤 분위기에서 시작할까요?", "그 시간에 무엇을 더할까요?", "두 사람의 첫 장면"], fit: "가볍게 고르며 취향을 맞춰 보고 싶은 분께" },
} as const
// 편지 쓰기 첫 문장 도움말(눌러서 이어 쓰기)
export const LETTER_PROMPTS = [
  { title: "내 하루 한 장면", question: "최근의 나를 가장 잘 보여 주는 하루는 어떤 하루였나요?", hints: ["요즘 제 하루는 보통 이렇게 흘러가요. ", "최근에 혼자 웃었던 순간이 있었는데요, ", "주말에 자주 가는 곳이 하나 있어요. "] },
  { title: "당신의 말이 궁금해졌어요", question: "어제 받은 편지에서 기억에 남은 말 하나에 답하고, 궁금한 것을 물어보세요.", hints: ["어제 편지에서 이 말이 오래 남았어요. ", "읽다가 저도 비슷한 기억이 떠올랐어요. ", "하나 더 궁금해진 게 있어요. "] },
  { title: "만나면 이어가고 싶은 이야기", question: "직접 만나게 된다면 어떤 시간을 보내고 싶나요?", hints: ["만나게 된다면 이런 곳을 함께 걸어 보고 싶어요. ", "3일 동안 편지를 주고받으며 느낀 건요, ", "직접 얼굴을 보고 꼭 듣고 싶은 이야기가 있어요. "] },
] as const
export const SCENE_PROMPTS = [
  { title: "어떤 분위기에서 시작할까요?", question: "처음 만나는 장면으로 끌리는 곳을 하나 고르고, 이유를 짧게 적어 주세요." },
  { title: "그 시간에 무엇을 더할까요?", question: "얼마나 머물지, 잠깐 쉬어 갈 곳은 어디가 좋을지 골라 주세요." },
  { title: "두 사람의 첫 장면", question: "만나서 함께 나누고 싶은 이야기 하나를 적어 주세요." },
] as const
export const SCENE_ACTIVITY_LABEL: Record<string, string> = { exhibition: "전시", walk: "산책", bookstore: "서점", cafe: "카페", park: "공원·피크닉", market: "시장 골목", performance: "작은 공연" }
export const SCENE_FLOWS = ["짧게 둘러보기", "천천히 머물기", "발길 닿는 대로"] as const
export const SCENE_RESTS = ["조용한 카페", "공공 야외 공간", "디저트·빵집", "강가·벤치"] as const
// 첫 장면의 분위기 → 약속 제안의 활동(약속을 제안할 때 미리 골라 둔다)
export const SCENE_TO_APPOINTMENT: Record<string, string> = { exhibition: "전시·미술관", walk: "산책·공원", bookstore: "서점·책방", cafe: "카페·디저트", park: "산책·공원", market: "식사·맛집", performance: "공연·문화" }
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
