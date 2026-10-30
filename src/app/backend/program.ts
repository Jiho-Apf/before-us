import { rpc } from "./client"

// 실제 서버의 교류(서로 선택한 뒤): 합의 → 3일 교류 → 만남 선택 → 약속 → 연락처.
export type ProgramStatus = "choosing" | "scheduled" | "started" | "deciding" | "arranging" | "closed"
// piece: B 내가 고른 첫 장면에 대해(두 분 모두 쓰면 함께 열림) · comment / piece-comment: B 한마디(쓰는 즉시 상대에게 보임)
export type EntryKind = "letter" | "reply" | "scene" | "final" | "piece" | "comment" | "piece-comment"
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
  // A 편지 질문 묶음 번호(LETTER_SETS). 서버가 A 일정이 정해질 때 정한다. 없으면(지난 교류·정하기 전) 처음 묶음.
  letterSet?: number | null
  notice?: string
}

export const loadMyProgram = () => rpc<Program | null>("my_program")
// 마무리 뒤 다시 읽을 수 있는 지난 교류(넷째 날 두 분 모두 만나고 싶다고 했고, 마무리 후 30일 안·차단 없음). 새 교류가 시작돼도 남는다.
export type ReadableProgram = { id: string; introductionId: string; status: "closed"; endReason: string | null; closedAt: string; partnerName: string | null; ownPlan: "A" | "B" | null; partnerPlan: "A" | "B" | null; startOn: string | null; meetingOn: string | null; today: string; readableUntil: string; letterSet?: number | null; entries: ProgramEntry[] }
export const loadReadablePrograms = () => rpc<ReadableProgram[]>("my_readable_programs")
export const choosePlan = (id: string, plan: "A" | "B") => rpc<Program>("choose_program_plan", { p_program: id, p_plan: plan })
export const proposeStart = (id: string, date: string) => rpc<Program>("propose_program_start", { p_program: id, p_date: date })
export const confirmProgram = (id: string) => rpc<Program>("confirm_program", { p_program: id })
export const submitEntry = (id: string, day: number, kind: EntryKind, body: string | null, payload?: Record<string, string>) =>
  rpc<Program>("submit_program_entry", { p_program: id, p_day: day, p_kind: kind, p_body: body, p_payload: payload ?? null })
// B 내가 고른 첫 장면에 대해(10~300자, 만남 선택 마감까지) · 한마디(100자 안, 그날 답은 다음 날 09:00까지 · 첫 장면 이야기는 만남 선택 마감까지)
export const writeScenePiece = (id: string, body: string) => rpc<Program>("write_scene_piece", { p_program: id, p_body: body })
export const leaveComment = (id: string, on: "scene" | "piece", day: number | null, body: string) => rpc<Program>("leave_scene_comment", { p_program: id, p_on: on, p_day: day, p_body: body })
export const PIECE_MIN = 10, PIECE_MAX = 300, COMMENT_MAX = 100
export const chooseMeeting = (id: string, choice: "positive" | "negative") => rpc<Program>("choose_meeting", { p_program: id, p_choice: choice })
export const proposeAppointment = (id: string, slots: Slot[], activity: string, region: string, place: string, note: string) =>
  rpc<Program>("propose_appointment", { p_program: id, p_slots: slots, p_activity: activity, p_region: region, p_place: place || null, p_note: note || null })
export const acceptAppointment = (proposal: string, slot: number) => rpc<Program>("accept_appointment", { p_proposal: proposal, p_slot: slot })
export const setContactConsent = (id: string, allowed: boolean) => rpc<Program>("set_contact_consent", { p_program: id, p_allowed: allowed })
// B 마지막 맞추기: 두 분이 고른 것 중에서 장소·흐름·쉬어 갈 곳·이야기를 하나씩 고른다.
export type ScenePick = { activity: string; flow: string; rest: string; topic: string }
export const chooseFirstScene = (id: string, pick: ScenePick) => rpc<Program>("choose_first_scene", { p_program: id, p_pick: pick })

export const PLAN_COPY = {
  A: { name: "A. 편지 나누기", description: "각자 하루 한 통씩, 3일 동안 그날의 질문에 답하며 나누는 이야기(질문은 교류마다 달라져요). 사진 한 장을 함께 넣을 수도 있어요. 두 분이 모두 보내면 함께 열리고, 열린 편지에는 다음 날 09:00까지 답장을 한 번 보낼 수 있어요.", days: ["나의 일상 들려주기", "요즘의 마음 나누기", "함께 보낼 시간 그려 보기"], example: "예: “쉬는 날엔 동네 도서관 창가 자리에서 해 질 때까지 책을 읽어요.”", fit: "글로 천천히 마음을 전하고 싶은 분께" },
  B: { name: "B. 첫 장면 만들기", description: "하루에 하나씩 장소·머무는 방식·나눌 이야기를 고르고(목록에 없으면 직접 써도 돼요), 짧은 질문에 답하며 서로를 알아가요. 열린 답에는 한마디를 남기고, 셋째 날 답이 열리면 첫 장면을 함께 맞춘 뒤 그 장면에 대해 짧게 나눠요.", days: ["끌리는 장소 고르기", "그곳에서 머무는 방식 정하기", "함께 나눌 이야기 정하기"], example: "예: 서점 · 각자 한 권씩 골라 보기 · “요즘 읽는 책 이야기”", fit: "가볍게 고르며 취향을 맞춰 보고 싶은 분께" },
} as const
// 편지 질문: 상대가 ‘이 사람은 어떤 사람인지’ 알아볼 수 있게, 이야기 하나로 쉽게 답할 수 있는 것을 묻는다.
// DAY 01 일상·나를 보여 주는 것 · DAY 02 가치·마음·관계 방식 · DAY 03 함께할 시간·만남 기대. 지난 연애·수입·외모·집안·종교·정치는 묻지 않는다.
// 예시는 읽기만 하는 참고(눌러도 편지에 들어가지 않는다). unopened: 전날 편지가 함께 열리지 않았을 때의 둘째·셋째 날 질문(상대가 전날 이야기를 아직 모르니 함께 담아 달라고 한다).
// 묶음 번호는 서버 programs.letter_set(0부터)과 같다. 뒤에만 덧붙이고 순서를 바꾸거나 빼지 않는다(지난 교류를 다시 읽을 때 그때 질문이 보이게).
// 묶음을 늘리면 서버 letter_set_count()도 같은 수로 바꾼다(새 마이그레이션에서).
export type LetterPrompt = { title: string; question: string; examples: readonly string[] }
export type LetterSet = { days: readonly [LetterPrompt, LetterPrompt, LetterPrompt]; unopened: readonly [LetterPrompt, LetterPrompt] }
export const LETTER_SETS: readonly LetterSet[] = [
  // 0 · 쉬는 날 · 마음을 쓰는 것 · 함께 보내고 싶은 시간(처음부터 쓰던 묶음, 3900 전에 시작한 교류는 모두 이 묶음)
  { days: [
    { title: "나의 쉬는 날", question: "쉬는 날, 보통 어떤 시간을 보내나요? 지난 쉬는 날 이야기로 들려줘도 좋아요.", examples: ["쉬는 날엔 늦잠을 자고, 오후에 동네 도서관에 가요. 창가 자리에서 책을 읽다 보면 해가 져 있어요.", "토요일 아침마다 친구들과 배드민턴을 쳐요. 끝나고 다 같이 먹는 국밥이 사실 더 기다려져요.", "집에서 요리를 자주 해요. 지난 주말엔 처음으로 된장찌개를 끓였는데 생각보다 맛있었어요."] },
    { title: "요즘 마음을 쓰는 것", question: "요즘 가장 마음을 쓰고 있는 건 무엇인가요? 왜 소중한지도 들려주세요.", examples: ["요즘은 아침 산책 30분을 아껴요. 그 시간에 하루를 미리 정리해 두면 덜 조급해지더라고요.", "일을 잘하는 것보다 오래 즐겁게 하는 게 더 중요해졌어요. 그래서 퇴근 뒤 시간을 지키려고 해요.", "작은 약속이라도 지키는 사람이고 싶어요. 친구와 정한 산책 약속도 미루지 않으려고 해요."] },
    { title: "함께 보내고 싶은 시간", question: "만나게 된다면, 함께 어떤 시간을 보내고 싶나요?", examples: ["조용한 전시를 천천히 보고, 근처 카페에서 본 것 이야기를 나누고 싶어요.", "날이 좋으면 강가를 같이 걷고 싶어요. 걸으면서 이야기하면 저는 금방 편해지거든요.", "맛있는 밥 한 끼를 천천히 먹으면서, 편지로 다 못 한 이야기를 듣고 싶어요."] },
  ], unopened: [
    { title: "쉬는 날의 나, 요즘의 나", question: "어제는 편지가 함께 열리지 않았어요. 오늘은 쉬는 날을 어떻게 보내는지와, 요즘 마음을 쓰고 있는 것을 함께 들려주세요.", examples: ["쉬는 날엔 동네를 오래 걸어요. 요즘은 그 시간에 한 주를 정리하는 게 저한테 가장 소중해요.", "주말엔 집에서 영화를 보며 쉬어요. 요즘은 건강을 챙기려고 아침마다 스트레칭을 하고 있어요."] },
    { title: "함께 보내고 싶은 시간", question: "어제는 편지가 함께 열리지 않았어요. 요즘 마음을 쓰는 것 하나와, 만나면 함께 보내고 싶은 시간을 들려주세요.", examples: ["요즘은 몸을 챙기는 데 마음을 써요. 만나면 가볍게 걷고 따뜻한 차 한잔하고 싶어요.", "요즘 일에 마음을 많이 쓰고 있어요. 만나면 조용한 곳에서 편하게 이야기 나누고 싶어요."] },
  ] },
  // 1 · 시간 가는 줄 모르는 일 · 고마웠던 순간 · 같이 해 보고 싶은 일
  { days: [
    { title: "시간 가는 줄 모르는 일", question: "요즘 시간 가는 줄 모르고 하게 되는 일이 있나요? 언제, 어디서 하는지도 들려주세요.", examples: ["요즘은 퍼즐에 빠졌어요. 천 조각짜리를 거실 탁자에 펼쳐 두고 퇴근 뒤에 조금씩 맞추다 보면 금방 자정이에요.", "주말 아침마다 동네 수영장에 가요. 아직 접영은 서툴지만, 물속에 있으면 머릿속이 조용해져서 좋아요.", "베란다에서 식물을 키워요. 아침에 새 잎이 하나 올라와 있으면 출근길까지 기분이 좋아요."] },
    { title: "최근에 고마웠던 순간", question: "최근에 누군가에게 고마웠던 순간이 있나요? 어떤 일이었는지, 왜 마음에 남았는지 들려주세요.", examples: ["비 오는 날 우산이 없었는데, 동료가 말없이 우산을 같이 써 줬어요. 티 내지 않고 챙겨 주는 마음이 오래 남더라고요.", "바빠서 한동안 연락을 못 했는데, 친구가 먼저 ‘밥은 먹었어?’ 하고 물어봐 줬어요. 저도 그런 사람이 되고 싶다고 생각했어요.", "단골 빵집 사장님이 제가 좋아하는 빵을 하나 남겨 두셨더라고요. 작은 기억이 사람을 이렇게 기쁘게 하는구나 싶었어요."] },
    { title: "같이 해 보고 싶은 일", question: "만나게 된다면, 같이 해 보고 싶은 작은 일 하나가 있나요? 왜 그게 떠올랐는지도 들려주세요.", examples: ["제가 자주 가는 동네 분식집에 같이 가 보고 싶어요. 좋아하는 걸 같이 먹으면 금방 편해지는 것 같아서요.", "서점에서 서로에게 책 한 권씩 골라 주기를 해 보고 싶어요. 고르는 책을 보면 그 사람이 조금 보일 것 같아요.", "날이 좋으면 강가에서 자전거를 같이 타고 싶어요. 나란히 달리다 보면 말이 없어도 어색하지 않을 것 같아요."] },
  ], unopened: [
    { title: "빠져 있는 일, 고마웠던 순간", question: "어제는 편지가 함께 열리지 않았어요. 오늘은 요즘 시간 가는 줄 모르고 하는 일과, 최근에 고마웠던 순간을 함께 들려주세요.", examples: ["요즘은 퇴근하고 뜨개질을 해요. 얼마 전 친구가 제가 떠 준 목도리를 매일 하고 다닌다고 해서 정말 고마웠어요.", "주말마다 가까운 산에 올라요. 지난번엔 처음 본 분이 물을 나눠 주셔서, 그날 하루가 더 따뜻하게 기억나요."] },
    { title: "고마웠던 순간, 같이 해 보고 싶은 일", question: "어제는 편지가 함께 열리지 않았어요. 최근에 고마웠던 순간 하나와, 만나면 같이 해 보고 싶은 작은 일을 들려주세요.", examples: ["얼마 전 동료가 제 실수를 조용히 같이 고쳐 줘서 고마웠어요. 만나면 커피 한 잔 앞에 두고 천천히 이야기하고 싶어요.", "친구가 이사를 도와준 주말이 오래 기억나요. 만나면 제가 좋아하는 산책길을 같이 걸어 보고 싶어요."] },
  ] },
  // 2 · 마음이 편해지는 곳 · 좋은 사람이라고 느낄 때 · 편안한 첫 만남
  { days: [
    { title: "마음이 편해지는 곳", question: "마음이 편해지는 장소가 있나요? 그곳에서 주로 무엇을 하는지 들려주세요.", examples: ["집 근처 작은 공원 벤치요. 퇴근길에 잠깐 앉아 음악 한 곡 듣고 들어가면 하루가 정리돼요.", "자주 가는 카페의 창가 자리가 있어요. 사장님이 틀어 두는 재즈를 들으면서 일기를 써요.", "바다를 좋아해서 가끔 혼자 기차를 타고 가요. 아무것도 안 하고 파도만 보다 와도 충분해요."] },
    { title: "좋은 사람이라고 느낄 때", question: "사람을 만나며 ‘이 사람 참 좋다’고 느끼는 순간은 언제예요? 기억나는 장면이 있다면 함께 들려주세요.", examples: ["식당에서 고맙다는 말을 꼭 하는 사람을 보면 좋더라고요. 작은 예의에서 그 사람이 많이 보이는 것 같아요.", "제 이야기를 기억했다가 나중에 다시 물어봐 주는 사람이요. 지난달 시험 본 걸 기억해 준 친구가 그랬어요.", "늦을 것 같으면 미리 알려 주는 사람이요. 별것 아닌 것 같아도 상대를 생각하는 마음이라서, 저도 지키려고 해요."] },
    { title: "편안한 첫 만남", question: "처음 만나는 날, 어떤 분위기면 편할 것 같아요? 좋아하는 시간대나 장소도 좋아요.", examples: ["점심 무렵이 좋아요. 밝을 때 만나서 밥 먹고, 이야기가 더 하고 싶으면 근처를 조금 걷고 싶어요.", "너무 시끄럽지 않은 카페면 좋겠어요. 처음엔 말이 적은 편인데, 조용한 곳에서는 금방 편해져요.", "같이 무언가를 보거나 걸으면서 이야기하는 게 편해요. 마주 앉아만 있으면 조금 긴장하는 편이라서요."] },
  ], unopened: [
    { title: "편해지는 곳, 좋은 사람", question: "어제는 편지가 함께 열리지 않았어요. 오늘은 마음이 편해지는 장소와, ‘이 사람 참 좋다’고 느끼는 순간을 함께 들려주세요.", examples: ["동네 도서관이 제일 편한 곳이에요. 사람은 작은 약속을 잘 지키는 분을 보면 참 좋다고 느껴요.", "강가를 걷는 시간이 제일 편해요. 제 말을 끝까지 들어 주는 사람을 만나면 마음이 금방 열려요."] },
    { title: "좋은 사람, 편안한 첫 만남", question: "어제는 편지가 함께 열리지 않았어요. ‘이 사람 참 좋다’고 느끼는 순간과, 처음 만나는 날 편할 것 같은 분위기를 들려주세요.", examples: ["고마운 걸 바로 말하는 사람이 좋아요. 처음 만나는 날은 밝은 오후에 조용한 카페면 편할 것 같아요.", "남의 이야기를 쉽게 하지 않는 사람이 좋아요. 처음엔 같이 걸으면서 이야기하는 게 편해요."] },
  ] },
  // 3 · 하루 중 기다려지는 때 · 요즘 잘하고 싶은 것 · 같이 가 보고 싶은 곳
  { days: [
    { title: "하루 중 기다려지는 때", question: "요즘 하루 중에 가장 기다려지는 순간은 언제예요? 그 시간을 어떻게 보내는지도 들려주세요.", examples: ["퇴근길 지하철에서 좋아하는 라디오를 듣는 20분이요. 사연을 듣다 보면 혼자 웃을 때도 있어요.", "아침에 커피를 내리는 시간이요. 요즘은 원두를 바꿔 가며 맛을 비교해 보는 재미에 빠졌어요.", "저녁 먹고 강아지와 동네를 한 바퀴 도는 시간이요. 강아지가 신나 하는 걸 보면 저도 같이 신나요."] },
    { title: "요즘 잘하고 싶은 것", question: "요즘 새로 해 보고 있거나, 더 잘하고 싶은 게 있나요? 왜 시작했는지도 들려주세요.", examples: ["주말마다 요리를 한 가지씩 배워서 만들어 봐요. 사 먹는 것보다 내 손으로 나를 챙기는 게 좋아졌어요.", "달리기를 시작했어요. 처음엔 1km도 힘들었는데 지금은 5km를 쉬지 않고 뛰어요. 조금씩 늘어나는 게 좋아요.", "일본어를 배우고 있어요. 좋아하는 소설을 원문으로 읽어 보고 싶어서 시작했는데, 생각보다 오래 하고 있어요."] },
    { title: "같이 가 보고 싶은 곳", question: "만나게 된다면, 같이 가 보고 싶은 곳이 있나요? 그곳이 떠오른 이유도 들려주세요.", examples: ["제가 좋아하는 작은 사진 전시관이 있어요. 조용히 보고 나와서 어떤 사진이 좋았는지 이야기해 보고 싶어요.", "고궁을 천천히 걷고 싶어요. 오래된 길을 걷다 보면 이야기도 천천히 나오는 것 같아서요.", "시장 골목을 같이 걸으면서 이것저것 맛보고 싶어요. 뭘 맛있어하는지 보면 서로 금방 알게 될 것 같아요."] },
  ], unopened: [
    { title: "기다려지는 순간, 잘하고 싶은 것", question: "어제는 편지가 함께 열리지 않았어요. 오늘은 하루 중 가장 기다려지는 순간과, 요즘 더 잘하고 싶은 것을 함께 들려주세요.", examples: ["자기 전에 책 몇 장 읽는 시간이 제일 기다려져요. 요즘은 꾸준히 운동하는 사람이 되고 싶어서 아침 스트레칭을 해요.", "점심 먹고 회사 근처를 걷는 10분이 좋아요. 요즘은 사진을 잘 찍고 싶어서 그 길에서 연습해요."] },
    { title: "잘하고 싶은 것, 가 보고 싶은 곳", question: "어제는 편지가 함께 열리지 않았어요. 요즘 더 잘하고 싶은 것 하나와, 만나면 같이 가 보고 싶은 곳을 들려주세요.", examples: ["요즘 그림을 다시 그리고 있어요. 만나면 작은 미술관에 같이 가서 천천히 보고 싶어요.", "요즘 요리를 배우고 있어요. 만나면 제가 아끼는 동네 밥집에 같이 가 보고 싶어요."] },
  ] },
  // 4 · 요즘 추천하고 싶은 것 · 다시 힘을 내는 방법 · 만나서 먼저 나누고 싶은 이야기
  { days: [
    { title: "요즘 추천하고 싶은 것", question: "요즘 누군가에게 추천하고 싶은 게 있나요? 음식, 노래, 책, 장소 무엇이든 좋아요. 왜 좋은지도 들려주세요.", examples: ["요즘 빠진 노래가 있어요. 출근길에 들으면 괜히 걸음이 가벼워져서, 친구들한테도 자꾸 들려주고 있어요.", "동네에 생긴 작은 국숫집이요. 국물이 담백해서 혼자 먹으러 가도 마음이 편해요.", "최근에 읽은 에세이 한 권이요. 마음이 바쁠 때 한 꼭지씩 읽으면 숨이 좀 고르게 쉬어져요."] },
    { title: "다시 힘을 내는 방법", question: "지치거나 마음이 복잡한 날, 나는 어떻게 다시 힘을 내나요? 최근에 그랬던 날 이야기도 좋아요.", examples: ["일단 푹 자요. 다음 날 아침 좋아하는 빵집에서 따뜻한 빵을 사 오면 다시 시작할 힘이 생겨요.", "친한 친구에게 전화해서 별일 아닌 이야기를 해요. 지난주에도 한참 수다를 떨고 나니 한결 가벼워졌어요.", "땀이 날 때까지 걸어요. 생각이 정리될 때까지 걷다 보면, 대부분은 생각보다 괜찮은 일이더라고요."] },
    { title: "만나서 먼저 나누고 싶은 이야기", question: "처음 만나면 어떤 이야기를 먼저 나눠 보고 싶어요? 편지를 읽으며 더 궁금해진 것도 좋아요.", examples: ["편지에 썼던 노래 이야기를 더 듣고 싶어요. 어떤 순간에 처음 듣게 됐는지 궁금해요.", "서로 요즘 가장 재미있게 본 걸 이야기해 보고 싶어요. 좋아하는 걸 말할 때 표정이 제일 잘 보이니까요.", "편지로는 짧게만 쓴 여행 이야기를 마저 하고 싶어요. 그때 찍은 사진도 보여 드리고 싶고요."] },
  ], unopened: [
    { title: "추천하고 싶은 것, 힘을 내는 방법", question: "어제는 편지가 함께 열리지 않았어요. 오늘은 요즘 추천하고 싶은 것과, 지친 날 다시 힘을 내는 나만의 방법을 함께 들려주세요.", examples: ["동네 뒷산 산책로를 추천하고 싶어요. 지친 날에도 그 길을 한 바퀴 돌고 나면 다시 힘이 나요.", "따뜻한 보리차를 추천해요. 마음이 복잡한 날엔 보리차 한 잔 들고 좋아하는 영화를 봐요."] },
    { title: "힘을 내는 방법, 먼저 나누고 싶은 이야기", question: "어제는 편지가 함께 열리지 않았어요. 지친 날 다시 힘을 내는 방법과, 처음 만나면 먼저 나누고 싶은 이야기를 들려주세요.", examples: ["지친 날엔 좋아하는 음악을 틀고 방 청소를 해요. 만나면 서로 요즘 즐겨 듣는 노래 이야기를 하고 싶어요.", "저는 혼자 오래 걸으면 힘이 나요. 만나면 각자 좋아하는 산책길 이야기를 나눠 보고 싶어요."] },
  ] },
  // 5 · 요즘 나를 웃게 한 일 · 가까운 사이에서 지키는 것 · 같이 먹고 싶은 한 끼
  { days: [
    { title: "요즘 나를 웃게 한 일", question: "최근에 나를 웃게 한 일이 있나요? 아주 작은 일이어도 좋아요.", examples: ["엘리베이터에서 만난 꼬마가 제 가방의 인형을 보고 ‘나도 있어!’ 하면서 자기 걸 보여 줬어요. 하루 종일 생각났어요.", "처음 만든 김치볶음밥이 너무 짜서 물을 세 컵이나 마셨어요. 혼자 먹다가 웃음이 터졌어요.", "친구들이랑 보드게임을 했는데, 제일 진지하던 친구가 규칙을 처음부터 잘못 알고 있었어요. 다 같이 한참 웃었어요."] },
    { title: "가까운 사이에서 지키는 것", question: "가까운 사람과 지낼 때, 내가 꼭 지키려고 하는 게 있나요? 작은 습관이어도 좋아요.", examples: ["고마운 일은 그날 바로 말하려고 해요. 미루면 쑥스러워져서 결국 못 하게 되더라고요.", "서운한 일이 있으면 쌓아 두지 않아요. 마음이 조금 가라앉은 뒤에 차분히 이야기하려고 해요.", "중요한 날은 꼭 기억해요. 큰 선물보다 잊지 않고 먼저 연락하는 게 더 중요하다고 생각해요."] },
    { title: "같이 먹고 싶은 한 끼", question: "만나게 된다면, 같이 먹어 보고 싶은 음식이 있나요? 그 음식에 얽힌 이야기도 들려주세요.", examples: ["따끈한 칼국수를 제일 좋아해요. 비 오는 날 혼자 먹다가 ‘이건 누구랑 같이 먹어야 하는데’ 했던 적이 있어요.", "브런치를 좋아해요. 주말 늦은 아침에 천천히 먹으면서 이야기하면 시간이 금방 갈 것 같아요.", "맛있는 국밥집을 하나 알아요. 소박하지만, 제가 정말 좋아하는 걸 같이 먹어 보고 싶어요."] },
  ], unopened: [
    { title: "웃게 한 일, 지키는 것", question: "어제는 편지가 함께 열리지 않았어요. 오늘은 최근에 나를 웃게 한 일과, 가까운 사람과 지낼 때 꼭 지키려는 것을 함께 들려주세요.", examples: ["얼마 전 친구가 그려 준 제 얼굴 그림을 보고 한참 웃었어요. 가까운 사람에게는 고마운 걸 바로 말하려고 해요.", "출근길에 비둘기랑 서로 길을 비켜 주다 웃음이 났어요. 저는 약속 시간을 꼭 지키려고 해요."] },
    { title: "지키는 것, 같이 먹고 싶은 한 끼", question: "어제는 편지가 함께 열리지 않았어요. 가까운 사람과 지낼 때 꼭 지키려는 것 하나와, 만나면 같이 먹어 보고 싶은 음식을 들려주세요.", examples: ["서운한 일은 쌓아 두지 않고 말하려고 해요. 만나면 따뜻한 수제비를 같이 먹고 싶어요.", "연락이 늦어질 땐 미리 말해 두려고 해요. 만나면 제가 좋아하는 동네 파스타집에 같이 가 보고 싶어요."] },
  ] },
]
// 서버가 정한 묶음 번호 → 질문 묶음(번호가 없던 지난 교류·모르는 번호는 처음 묶음)
export const letterSet = (index?: number | null): LetterSet => LETTER_SETS[index ?? 0] ?? LETTER_SETS[0]
export const letterPrompt = (day: number, previousOpened: boolean, set?: number | null): LetterPrompt => { const pick = letterSet(set); return (!previousOpened && day > 1 && pick.unopened[day - 2]) || pick.days[day - 1] }
// B 첫 장면: 날마다 구체적인 할 일 하나 + 나를 소개하는 짧은 질문 하나(꼭 답해요). 둘째·셋째 날에는 전날 함께 열린 상대의 선택에 한마디를 남긴다.
// 첫째·둘째 날 고른 이유는 한 줄(60자 안)로, 적지 않아도 된다.
export const SCENE_PROMPTS = [
  { title: "끌리는 장소 고르기", question: "처음 만나는 장면으로 끌리는 곳을 하나 골라 주세요. 고른 이유는 한 줄로 적어도 좋아요.", about: "요즘 주말을 가장 나답게 보내는 방법은 뭐예요?", aboutHint: "예: 동네 빵집에서 아침 먹고 오래 걷기", reasonHint: "예: 책 고르는 걸 옆에서 구경하는 게 좋아서요", reaction: "", reactionAlt: "", sees: "상대에게는 고른 곳 · 내 답(이유를 적었다면 이유도)이 보여요. 두 분 모두 보내야 함께 열려요." },
  { title: "그곳에서 머무는 방식 정하기", question: "어제 고른 곳에서 어떻게 머물지, 중간에 어디서 쉬어 갈지 골라 주세요.", about: "처음 만난 자리에서 내가 편해지는 방법이 있나요?", aboutHint: "예: 걸으면서 이야기하면 금방 편해져요", reasonHint: "예: 처음엔 오래 앉아 있는 것보다 걷는 게 편해서요", reaction: "어제 상대가 고른 곳과 이유에 한마디 남겨 주세요.", reactionAlt: "어제는 함께 열리지 않았어요. 상대가 어떤 곳을 좋아할 것 같은지 짐작해 한마디 남겨 보세요(선택).", sees: "상대에게는 머무는 방식 · 쉬어 갈 곳 · 한마디 · 내 답(이유를 적었다면 이유도)이 보여요." },
  { title: "함께 나눌 이야기 정하기", question: "만나서 꼭 나누고 싶은 이야기 하나를 적어 주세요.", about: "나를 잘 아는 친구가 나를 한 줄로 소개한다면?", aboutHint: "예: 느긋한데 좋아하는 건 끝까지 파는 사람", reasonHint: "", reaction: "어제 상대가 고른 머무는 방식에 한마디 남겨 주세요.", reactionAlt: "어제는 함께 열리지 않았어요. 상대에게 건네고 싶은 말을 한마디 남겨 보세요(선택).", sees: "상대에게는 나누고 싶은 이야기 · 한마디 · 내 답이 보여요. 함께 열리면 둘이 고른 것으로 첫 장면을 맞춰요." },
] as const
export const SCENE_REASON_MAX = 60
export const SCENE_TOPIC_EXAMPLES = ["요즘 읽는 책 이야기", "최근에 다녀온 곳", "어릴 때 좋아하던 것"] as const
export const SCENE_TOPIC_MAX = 40
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
// 직접 작성: 목록 말고 직접 쓴 짧은 말(20자 안). 서버에는 'custom:' + 글로 저장한다(서버 scene_custom_ok와 같은 기준).
export const CUSTOM = "custom:"
export const SCENE_CUSTOM_MAX = 20
export const isCustom = (value?: string | null): boolean => !!value && value.startsWith(CUSTOM)
export const customText = (value: string) => value.slice(CUSTOM.length).trim()
export const customOk = (value?: string | null) => !!value && isCustom(value) && !!customText(value) && Array.from(customText(value)).length <= SCENE_CUSTOM_MAX
// 보낼 때: 직접 쓴 말은 앞뒤 빈칸을 정리하고, 비어 있으면 뺀다.
export const tidyChoice = (value?: string | null) => !value ? "" : isCustom(value) ? (customText(value) ? CUSTOM + customText(value) : "") : value.trim()
// 화면에 보이는 이름(장소 키 → 이름, 직접 쓴 말 → 그 글)
export const sceneLabel = (value?: string | null) => !value ? "" : isCustom(value) ? customText(value) : SCENE_ACTIVITY_LABEL[value] ?? value
// 직접 쓴 장소의 둘째 날 공통 목록(서버 scene_stay_options의 공통 목록과 같다)
export const SCENE_STAY_GENERIC = { flows: ["짧게 둘러보기", "천천히 머물기", "발길 닿는 대로"], rests: ["조용한 카페", "공공 야외 공간", "디저트·빵집", "강가·벤치"] } as const
export const stayFor = (place?: string | null): { flows: readonly string[]; rests: readonly string[] } | undefined => !place ? undefined : SCENE_STAY[place] ?? (customOk(place) ? SCENE_STAY_GENERIC : undefined)
// 첫 장면의 분위기 → 약속 제안의 활동(약속을 제안할 때 미리 골라 둔다). 직접 쓴 장소는 ‘직접 정할게요’로 두고 한마디에 장소를 적는다.
export const SCENE_TO_APPOINTMENT: Record<string, string> = { exhibition: "전시·미술관", walk: "산책·공원", bookstore: "서점·책방", cafe: "카페·디저트", park: "산책·공원", market: "식사·맛집", performance: "공연·문화" }
export const sceneAppointment = (activity?: string | null) => !activity ? "" : isCustom(activity) ? "직접 정할게요" : SCENE_TO_APPOINTMENT[activity] ?? ""
// 첫 장면 → 약속 제안 한마디(직접 쓴 장소·흐름·쉬어 갈 곳·이야기를 미리 적어 둔다)
export const sceneNote = (pick: Partial<ScenePick> | null | undefined) => pick ? [pick.activity && isCustom(pick.activity) && `장소 ${customText(pick.activity)}`, pick.flow && sceneLabel(pick.flow), pick.rest && `쉬어 갈 곳 ${sceneLabel(pick.rest)}`, pick.topic && `“${pick.topic}” 이야기`].filter(Boolean).join(" · ").slice(0, 300) : ""

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
  // 직접 쓴 말의 표시('custom:')는 빼고 살핀다(서버와 같은 기준).
  const text = stripDates(texts.filter(Boolean).join(" ").split(CUSTOM).join(" ").normalize("NFKC"))
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
