// 공개 홈 콘텐츠 · 지어낸 이야기와 오늘의 질문 목록.
// 이야기는 실제 회원의 기록이 아니며, 화면에서도 가상의 이야기임을 분명히 밝힌다.

export const STORY_PEOPLE = { left: "해윤", right: "서진" } as const

export const STORY: { id: string; label: string; prompt: string | null; left: string; right: string }[] = [
  {
    id: "noon",
    label: "정오",
    prompt: "소개가 도착한 날",
    left: "점심을 먹다 알림을 봤다. 운영진이 고른 한 사람. 사진보다 먼저 눈에 들어온 건 ‘쉬는 날엔 동네 서점을 한 바퀴 돌아요’라는 문장이었다. 바로 답하지 않았다. 저녁에 한 번 더 읽고, ‘알아가고 싶어요’를 눌렀다.",
    right: "회의가 길어져서 소개를 늦게 열었다. 한 줄 소개가 짧았는데, 오히려 그게 좋았다. 물어보고 싶은 게 생겼으니까. 다음 날 아침, 두 사람 모두 알아가고 싶어 한다는 안내가 와 있었다.",
  },
  {
    id: "day1",
    label: "DAY 01",
    prompt: "당신의 하루에서 가장 좋아하는 순간은?",
    left: "퇴근길 버스에서 창밖이 주황색으로 바뀌는 오 분이라고 썼다. 너무 사소한가 싶어 지웠다가, 그대로 보냈다.",
    right: "커피를 내리는 동안 아무 생각도 하지 않는 시간이라고 썼다. 해윤의 편지가 열리고 조금 웃었다. 우리 둘 다 ‘아무 일도 없는 시간’을 좋아하는 사람이었다.",
  },
  {
    id: "day2",
    label: "DAY 02",
    prompt: "요즘 나를 웃게 만든 작은 일은?",
    left: "회사 화분에 새 잎이 났다는 이야기를 길게 썼다. 서진의 답장에는 질문이 하나 있었다. ‘그 화분, 이름 있어요?’ 이름은 없었다. 그날 지어 줬다.",
    right: "편지가 길어지는 게 신기했다. 말로 했으면 금방 지나갔을 이야기들이, 하루를 기다려 도착하니까 한 문장씩 오래 남았다.",
  },
  {
    id: "day3",
    label: "DAY 03",
    prompt: "누군가와 꼭 같이 가 보고 싶은 곳은?",
    left: "비 오는 날의 작은 전시관이라고 썼다. 쓰고 나서 조금 떨렸다. 이건 거의 제안 같았으니까.",
    right: "나는 그냥 ‘해윤 씨가 말한 그 서점’이라고 썼다. 3일 동안 서로를 조금씩 외웠다는 걸, 그 문장을 쓰면서 알았다.",
  },
  {
    id: "day4",
    label: "DAY 04",
    prompt: "이 사람을, 직접 만나보고 싶나요?",
    left: "고민은 길지 않았다. 다만 상대의 답을 모른 채 누르는 버튼은 생각보다 무거웠다. ‘만나보고 싶어요.’",
    right: "마음을 정하고도 반나절을 기다렸다가 눌렀다. 서두르지 않는 게, 이 3일이 내게 남긴 습관 같았다.",
  },
]
export const STORY_ENDING = "두 사람은 다음 주 토요일 오후, 비 예보가 있는 날을 골랐다. 서점에서 시작해 전시관까지 걷기로 했다. 이야기는 여기까지예요. 그다음은 두 사람이 정할 일이니까요."
// 담백한 버전(기본으로 먼저 보여 줌). 같은 두 사람의 같은 3일을, 일상의 말투로 적었다.
// 서비스 규칙(정오 공개·다음 날 11:00 응답 마감·편지 23:59 마감·DAY04 09:00·연락처는 만나는 날 자정)과 맞춘다.
export const STORY_PLAIN: typeof STORY = [
  {
    id: "noon",
    label: "정오",
    prompt: "소개가 도착한 날",
    left: "점심시간에 알림이 왔다. 솔직히 사진부터 봤다. 그다음에 읽은 한 줄 소개에 ‘주말엔 동네 서점에 자주 가요’라고 적혀 있었다. 나도 그렇다. ‘알아가고 싶어요’를 눌러 두고 다시 일하러 들어갔다.",
    right: "야근하다 밤 열 시쯤 소개를 열었다. 사진은 자연스러웠고 소개글은 짧았다. 응답은 다음 날 오전 11시까지라 하룻밤 생각해 보고, 출근길 지하철에서 눌렀다. 점심쯤, 서로 알아가고 싶어 한다는 안내가 왔다.",
  },
  {
    id: "day1",
    label: "DAY 01",
    prompt: "당신의 하루에서 가장 좋아하는 순간은?",
    left: "첫 편지는 뭘 써야 할지 몰라서 삼십 분 넘게 붙잡고 있었다. 결국 퇴근길 버스에서 노을 보는 시간이 좋다고 썼다. 보내 놓고 ‘너무 평범한가’ 싶었다.",
    right: "아침에 커피 내리는 십 분이라고 썼다. 저녁에 편지가 열렸는데, 해윤 씨도 비슷한 걸 적어서 괜히 안심이 됐다. 답장엔 ‘저도 그 시간 좋아해요’ 한 줄만 썼다. 더 쓰면 어색할 것 같아서.",
  },
  {
    id: "day2",
    label: "DAY 02",
    prompt: "요즘 나를 웃게 만든 작은 일은?",
    left: "사무실 화분에 새 잎이 났다는 얘기를 썼다. 이게 재밌을까 싶었는데 서진 씨 답장에 ‘그 화분, 이름 있어요?’라는 질문이 있었다. 없다고 했다. 내일은 이름을 지었다고 말해 줘야겠다.",
    right: "회식 때문에 밤 열한 시가 넘어서야 편지를 썼다. 마감에 쫓겨 짧게 보내고, 답장에 미안하다고 한 줄 붙였다. 해윤 씨는 ‘바쁜 날은 짧아도 괜찮아요’라고 했다. 그 말이 고마웠다.",
  },
  {
    id: "day3",
    label: "DAY 03",
    prompt: "누군가와 꼭 같이 가 보고 싶은 곳은?",
    left: "비 오는 날 작은 전시관에 가 보고 싶다고 썼다. 데이트 신청처럼 보일까 봐 몇 번을 고쳐 쓰다가, 결국 그대로 보냈다.",
    right: "‘해윤 씨가 말한 그 서점이요’라고 썼다. 주고받은 건 편지 세 통이랑 답장 몇 줄인데, 생각보다 이 사람에 대해 아는 게 많아져 있었다.",
  },
  {
    id: "day4",
    label: "DAY 04",
    prompt: "이 사람을, 직접 만나보고 싶나요?",
    left: "아침 아홉 시에 질문이 열렸다. 상대 마음을 모르는 채로 누르는 거라 점심까지 미뤘다. 그래도 답은 처음부터 정해져 있었다. ‘만나보고 싶어요.’",
    right: "바로 누르면 너무 적극적으로 보일까 봐 오후에 눌렀다. 저녁에 두 사람 모두 만나고 싶어 한다는 안내가 왔고, 그제야 어깨에 들어간 힘이 풀렸다.",
  },
]
export const STORY_PLAIN_ENDING = "약속은 다음 주 토요일 오후 두 시, 두 사람 집 중간쯤 역 앞 카페로 정했다. 연락처는 만나는 날 자정에 열렸다. 이야기는 여기까지예요. 그다음은 두 사람이 정할 일이니까요."
export const STORY_NOTE = "모든 소개가 이렇게 흘러가지는 않아요. 4일째에 한 사람이라도 ‘여기까지’를 고르면, 이유를 묻지 않고 조용히 마무리돼요."

// 오늘의 질문: 날짜(Asia/Seoul)마다 같은 질문을 모두에게 보여 준다. 답은 저장하거나 다른 사람에게 보여 주지 않는다.
export const QUESTIONS = [
  "당신의 하루에서 가장 좋아하는 순간은?",
  "요즘 나를 웃게 만든 작은 일은?",
  "누군가와 꼭 같이 가 보고 싶은 곳은?",
  "편안하다고 느끼는 대화는 어떤 대화인가요?",
  "쉬는 날 아침, 가장 먼저 하는 일은?",
  "최근에 오래 기억에 남은 문장이 있나요?",
  "비 오는 날이면 생각나는 장소는?",
  "어릴 때 좋아했고, 지금도 좋아하는 것은?",
  "누군가에게 들었던 말 중 가장 다정했던 말은?",
  "혼자 있을 때 나는 주로 무엇을 하나요?",
  "요즘 자주 듣는 노래가 있다면?",
  "고마운데 아직 말하지 못한 사람이 있나요?",
  "나를 잘 아는 친구는 나를 어떻게 소개할까요?",
  "가장 좋아하는 계절의 냄새는?",
  "하루를 마무리하는 나만의 방법은?",
  "최근에 새로 알게 된 사실 하나는?",
  "누군가와 같이 먹고 싶은 음식은?",
  "올해 꼭 해 보고 싶은 작은 일은?",
  "좋아하는 동네의 좋아하는 골목은?",
  "마음이 복잡할 때 가는 곳이 있나요?",
  "사진첩에서 가장 자주 다시 보는 사진은?",
  "어떤 순간에 내가 나답다고 느끼나요?",
  "기다리는 시간을 어떻게 보내는 편인가요?",
  "처음 만나는 사람에게 꼭 묻고 싶은 것은?",
  "요즘 나에게 가장 큰 위로가 되는 것은?",
  "가 보지 않은 곳 중 가장 궁금한 곳은?",
  "내가 생각하는 좋은 하루의 조건은?",
  "최근에 누군가를 보고 배운 점이 있나요?",
  "오래 간직하고 있는 물건이 있나요?",
  "다음 주의 나에게 해 주고 싶은 말은?",
] as const
export const kstDayNumber = (now: Date) => Math.floor((now.getTime() + 9 * 3600000) / 86400000)
export const questionForDay = (day: number) => QUESTIONS[((day % QUESTIONS.length) + QUESTIONS.length) % QUESTIONS.length]
export const kstLabel = (day: number) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" }).format(new Date(day * 86400000))

// 시간대별 첫 화면 색과 문구. 보라·파랑 안에서만 움직이며 검정·금색으로 가지 않는다.
// 실제 회원 활동을 지어내지 않도록 문구는 시간의 분위기만 말한다.
export type DayPart = "morning" | "noon" | "afternoon" | "evening" | "night"
export function dayPart(now: Date): DayPart {
  const hour = new Date(now.getTime() + 9 * 3600000).getUTCHours()
  if (hour >= 6 && hour < 12) return "morning"
  if (hour === 12) return "noon"
  if (hour >= 13 && hour < 18) return "afternoon"
  if (hour >= 18 && hour < 22) return "evening"
  return "night"
}
export const DAY_PARTS: Record<DayPart, { phrase: string; tint: string }> = {
  morning: { phrase: "정오를 기다리는, 조용한 아침이에요.", tint: "linear-gradient(135deg, transparent 35%, color-mix(in oklch, var(--accent) 55%, transparent) 120%)" },
  noon: { phrase: "지금은, 준비된 소개가 도착하는 시간이에요.", tint: "radial-gradient(60% 70% at 78% 30%, color-mix(in oklch, white 22%, transparent), transparent 70%)" },
  afternoon: { phrase: "도착한 이야기를 천천히 다시 읽기 좋은 오후예요.", tint: "linear-gradient(160deg, transparent 50%, color-mix(in oklch, var(--accent) 25%, transparent) 130%)" },
  evening: { phrase: "하루 한 통, 편지를 쓰기 좋은 저녁이에요.", tint: "linear-gradient(180deg, transparent 10%, color-mix(in oklch, #2a1a8f 45%, transparent) 110%)" },
  night: { phrase: "답장을 서두르지 않아도 되는 밤이에요.", tint: "linear-gradient(180deg, color-mix(in oklch, #2a1a8f 30%, transparent), color-mix(in oklch, #23167a 55%, transparent))" },
}
