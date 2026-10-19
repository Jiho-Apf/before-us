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
  A: { name: "A. 편지 나누기", description: "각자 하루 한 통씩, 3일 동안 나누는 이야기. 두 분이 모두 보내면 함께 열려요." },
  B: { name: "B. 첫 장면 만들기", description: "3일 동안 활동·분위기·대화 소재를 함께 고르며 만드는 첫 만남의 한 장면." },
} as const
export const LETTER_PROMPTS = [
  { title: "내 하루 한 장면", question: "최근의 나를 가장 잘 보여 주는 하루는 어떤 하루였나요?" },
  { title: "당신의 말이 궁금해졌어요", question: "어제 받은 편지에서 기억에 남은 말 하나에 답하고, 궁금한 것을 물어보세요." },
  { title: "만나면 이어가고 싶은 이야기", question: "직접 만나게 된다면 어떤 시간을 보내고 싶나요?" },
] as const
export const SCENE_PROMPTS = [
  { title: "어떤 분위기에서 시작할까요?", question: "처음 만나는 장면으로 끌리는 곳을 하나 고르고, 이유를 짧게 적어 주세요." },
  { title: "그 시간에 무엇을 더할까요?", question: "얼마나 머물지, 잠깐 쉬어 갈 곳은 어디가 좋을지 골라 주세요." },
  { title: "두 사람의 첫 장면", question: "만나서 함께 나누고 싶은 이야기 하나를 적어 주세요." },
] as const
export const SCENE_ACTIVITY_LABEL: Record<string, string> = { exhibition: "전시", walk: "산책", bookstore: "서점" }
export const END_REASON: Record<string, string> = {
  "agreement-expired": "합의 기한(48시간)이 지나 마무리됐어요.",
  "meeting-declined": "이번 교류는 여기서 마무리됐어요. 누가 어떤 답을 했는지는 알려 드리지 않아요.",
  "meeting-nonresponse": "만남 선택 기한이 지나 마무리됐어요.",
  "arrange-expired": "7일 안에 약속이 정해지지 않아 마무리됐어요.",
  completed: "만남까지 마친 교류예요. 불편한 일이 있었다면 문의·신고로 알려 주세요.",
  blocked: "차단으로 교류가 닫혔어요.",
  withdrawn: "한 분이 탈퇴해 교류가 닫혔어요.",
  "admin-cancel": "운영 사정으로 교류를 마무리했어요.",
}
