import { BEFORE_US } from "./config";
import { canAgreeProgram, makePaymentFixture, type PaymentSession } from "./payment-model";

export const TODAY_STATES = {
  before: { label: "신청 전", title: "어떤 사람을 만나고 싶나요?", action: "소개 신청", description: "외적인 취향과 관계 기준, 나의 생활과 대화 성향을 알려주세요.", step: 0 },
  draft: { label: "작성 중", title: "내 이야기를 이어서 들려주세요.", action: "이어 쓰기", description: "작성하던 지점부터 이어서 확인합니다.", step: 0 },
  revision: { label: "보완 요청", title: "조금 더 알려주실 수 있나요?", action: "요청한 부분 이어 쓰기", description: "확인된 보완 요청이 있는 항목만 이어서 작성합니다.", step: 0 },
  review: { label: "검토 대기", title: "운영자 확인을 기다리고 있어요.", action: "신청 정보 확인", description: "현재는 운영자 검토 전입니다. 검토 기록과 시스템 상태 갱신 시각은 별도로 표시합니다.", step: 1 },
  waiting: { label: "후보 대기", title: "새로운 소개를 준비하고 있어요.", action: "내 정보 확인", description: "현재 조건과 참여 시점이 맞는 상대가 아직 확인되지 않았어요. 준비되면 안내드리겠습니다. 추가 소개비는 발생하지 않습니다.", step: 1 },
  ready: { label: "소개 준비 · 첫 결제 대기", title: "첫 소개를 시작할 준비가 되었어요.", action: "제공 내용 확인", description: "소개 제공 준비와 현재 참여 가능성을 확인한 뒤 소개 이용료를 안내합니다.", step: 1 },
  introduced: { label: "새 소개", title: "오늘, 한 사람을 소개해요", action: "프로필 확인", description: "공개가 허용된 정보를 살펴보고, 더 알아가고 싶은지 선택해 주세요.", step: 2 },
  response: { label: "선택 제출 · 응답 대기", title: "나의 선택을 전했어요.", action: "제출한 선택 확인", description: "상대의 응답을 기다리고 있습니다. 공개되지 않은 선택이나 호감을 추측하지 않습니다.", step: 2 },
  declined: { label: "이번 소개 종료", title: "이번 소개는 여기까지예요.", action: "종료 상태 확인", description: "상호 선택으로 이어지지 않았습니다. 첫 교류 전 소개 권리는 별도로 유지됩니다.", step: 2 },
  mutual: { label: "상호 선택", title: "서로, 더 알아가고 싶어요.", action: "교류비 안내 확인", description: "상호 선택이 확인되었습니다. 각자의 교류비 결제 후 같은 방식과 시작일을 합의합니다.", step: 3 },
  partner_payment: { label: "상대 결제 대기", title: "함께 시작할 준비를 기다려요.", action: "결제 상태 확인", description: "나의 교류비 결제는 확인되었고, 상대의 결제는 아직 확인되지 않았습니다.", step: 3 },
  agreement: { label: "방식 · 시작일 합의", title: "우리의 시작을 함께 골라요.", action: "방식과 시작일 선택", description: "A 편지 나누기 또는 B 첫 장면 만들기. 두 사람이 같은 방식과 시작일에 동의해야 교류가 시작됩니다.", step: 3 },
  a_write: { label: "A · 편지 나누기", title: "오늘의 이야기를 한 통에 담아요.", action: "오늘의 편지 작성", description: "각자 하루 한 통. 공개된 오늘 질문을 읽고 나의 이야기를 전해 주세요.", step: 4 },
  a_wait: { label: "A · 공개 대기", title: "오늘의 편지를 기다리고 있어요.", action: "편지 상태 확인", description: "오늘 나의 편지 제출이 확인되었습니다. 상대의 초안이나 미공개 편지는 표시하지 않습니다.", step: 4 },
  a_open: { label: "A · 편지 공개", title: "오늘, 서로의 이야기가 도착했어요.", action: "공개된 편지 읽기", description: "두 사람에게 공개된 편지만 읽을 수 있습니다.", step: 4 },
  b_choose: { label: "B · 첫 장면 만들기", title: "오늘의 장면을 함께 골라요.", action: "오늘의 선택", description: "공개된 선택지에서 나의 선택을 정하고, 공동 보드에서 확인합니다.", step: 4 },
  b_wait: { label: "B · 공동 선택 대기", title: "한 장면을 함께 만들고 있어요.", action: "공동 보드 확인", description: "나의 선택은 제출되었습니다. 공개가 허용된 공동 선택만 보드에 표시합니다.", step: 4 },
  day4: { label: "만남 의사 확인", title: "다음 장면, 함께 만나볼까요?", action: "만남 의사 선택", description: "만남은 각자의 선택입니다. 양쪽이 희망할 때만 시간과 장소를 조율합니다.", step: 5 },
  meeting: { label: "양쪽 만남 희망", title: "이제, 만날 장면을 정해요.", action: "시간·장소 조율", description: "양쪽의 만남 의사가 확인되었습니다. 서로 가능한 시간과 장소를 조율해 주세요.", step: 5 },
  paused: { label: "일시정지", title: "지금은 잠시 멈춰 있어요.", action: "현재 상태 확인", description: "확인된 일시정지 상태입니다. 문의를 통해 현재 상태를 확인할 수 있습니다.", step: 1 },
  ended: { label: "교류 종료", title: "우리의 교류가 마무리되었어요.", action: "종료 상태와 안내 확인", description: "구매 시점 환불 기준과 실제 DAY 제공 이력으로 확인합니다. 재이용 기준은 별도 검토 중이며 새로운 구매를 강제하지 않습니다.", step: 5 },
} as const;

export type TodayStage = keyof typeof TODAY_STATES;
export type SharedContent = { id: string; publishedAt: string; kind: "letter" | "board"; title: string; content: string; published: boolean };
export type TodaySnapshot = {
  paymentSession?: PaymentSession;
  programUsable?: boolean;
  stage: TodayStage;
  demo: boolean;
  lastIntroductionAt: string | null;
  stateUpdatedAt: string | null;
  operatorReviewedAt: string | null;
  resumeField: string | null;
  resumePath?: string;
  revisionRequest: string | null;
  profile: { visible: boolean; fields: { label: string; value: string; allowed: boolean }[] } | null;
  ownSelection: "positive" | "negative" | null;
  mutualSelected: boolean;
  payments: { own: boolean; partner: boolean };
  agreedPlan: "A" | "B" | null;
  agreedStartDate: string | null;
  programStartedAt: string | null;
  bothAgreed: boolean;
  question: string | null;
  boardOptions: string[];
  ownMeetingWish: boolean | null;
  partnerMeetingWish: boolean | null;
  shared: SharedContent[];
};

export const EMPTY_TODAY: TodaySnapshot = {
  stage: "before", demo: true, lastIntroductionAt: null, stateUpdatedAt: null, operatorReviewedAt: null,
  resumeField: null, revisionRequest: null, profile: null, ownSelection: null, mutualSelected: false,
  payments: { own: false, partner: false }, agreedPlan: null, agreedStartDate: null,
  programStartedAt: null, bothAgreed: false, question: null, boardOptions: [],
  ownMeetingWish: null, partnerMeetingWish: null, shared: [],
};

export function seoulDate(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BEFORE_US.introduction.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
}

export function programDay(snapshot: TodaySnapshot, today: string) {
  if (snapshot.programUsable === false || !snapshot.programStartedAt || !Number.isFinite(Date.parse(snapshot.programStartedAt)) || !snapshot.agreedStartDate || !snapshot.bothAgreed || !snapshot.mutualSelected || !snapshot.payments.own || !snapshot.payments.partner || !snapshot.agreedPlan || seoulDate(new Date(snapshot.programStartedAt)) < snapshot.agreedStartDate) return null;
  const elapsed = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${seoulDate(new Date(snapshot.programStartedAt))}T00:00:00Z`)) / 86400000);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed + 1 : null;
}

export function canCoordinate(snapshot: TodaySnapshot) {
  return snapshot.ownMeetingWish === true && snapshot.partnerMeetingWish === true;
}

export function currentSnapshot(snapshot: TodaySnapshot, today: string): TodaySnapshot {
  const needsAgreement = snapshot.stage === "agreement" || TODAY_STATES[snapshot.stage].step === 4 || ["day4", "meeting"].includes(snapshot.stage);
  if (needsAgreement && (!snapshot.mutualSelected || !snapshot.payments.own || !snapshot.payments.partner || snapshot.paymentSession && !canAgreeProgram(snapshot.paymentSession))) return { ...snapshot, stage: snapshot.mutualSelected ? snapshot.payments.own ? "partner_payment" : "mutual" : snapshot.ownSelection === "positive" ? "response" : "introduced", programStartedAt: null };
  const day = programDay(snapshot, today);
  const exchangeStage = TODAY_STATES[snapshot.stage].step === 4;
  if ((exchangeStage || snapshot.stage === "day4" || snapshot.stage === "meeting") && day === null) return { ...snapshot, stage: "agreement", programStartedAt: null };
  if (exchangeStage && day !== null && day >= 4) return { ...snapshot, stage: "day4" };
  if ((snapshot.stage === "day4" || snapshot.stage === "meeting") && day !== null && day < 4) return { ...snapshot, stage: "agreement" };
  if (snapshot.stage === "meeting" && !canCoordinate(snapshot)) return { ...snapshot, stage: "day4" };
  return snapshot;
}

export function makeDemoSnapshot(stage: TodayStage, today: string, startDate: string): TodaySnapshot {
  const step = TODAY_STATES[stage].step;
  const hasPartner = step >= 2 && !["declined", "ended"].includes(stage);
  const mutualSelected = step >= 3;
  const bothPaid = step >= 4 || stage === "agreement";
  const started = step >= 4;
  return {
    ...EMPTY_TODAY, stage,
    paymentSession: ["ready", "mutual", "partner_payment", "agreement"].includes(stage) ? makePaymentFixture(stage === "ready" ? "ready" : stage === "partner_payment" ? "own-paid" : stage === "agreement" ? "both-paid" : "mutual") : undefined,
    resumeField: ["draft", "revision"].includes(stage) ? "생활과 대화 성향" : null,
    revisionRequest: stage === "revision" ? "대화할 때 편한 방식에 대해 조금 더 알려주세요. (데모 요청)" : null,
    profile: hasPartner ? { visible: true, fields: [{ label: "표시 이름", value: "화면 예시 상대", allowed: true }, { label: "공개된 관심사", value: "산책 · 음악 (가상 데이터)", allowed: true }] } : null,
    ownSelection: ["response", "mutual", "partner_payment", "agreement"].includes(stage) || started ? "positive" : null,
    mutualSelected, payments: { own: bothPaid || stage === "partner_payment", partner: bothPaid },
    agreedPlan: started ? (stage.startsWith("b_") ? "B" : "A") : null,
    agreedStartDate: started ? startDate : null,
    programStartedAt: started ? `${startDate}T12:00:00+09:00` : null,
    bothAgreed: started,
    question: stage.startsWith("a_") ? "하루 중 가장 좋아하는 순간은 언제인가요? (질문 예시)" : null,
    boardOptions: stage.startsWith("b_") ? ["조용한 동네 산책", "좋아하는 음악 나누기"] : [],
    ownMeetingWish: stage === "meeting" ? true : null,
    partnerMeetingWish: stage === "meeting" ? true : null,
    shared: stage === "a_open" && today >= startDate ? [{ id: "demo-published-letter", publishedAt: `${today}T12:00:00+09:00`, kind: "letter", title: "공개된 편지 · 서비스 화면 예시", content: "하루를 마치고 좋아하는 음악을 듣는 시간이 가장 편안해요. (실제 회원의 편지가 아닌 데모 문구)", published: true }] : [],
  };
}
