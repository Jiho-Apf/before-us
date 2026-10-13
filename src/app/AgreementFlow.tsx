import { useEffect, useState, useSyncExternalStore } from "react"
import { Link, useSearchParams, useLocation } from "react-router"
import {
  ArrowRight,
  Check,
  Clock3,
  MessageCircle,
  BookOpen,
  MapPin,
  Coffee,
  ArrowUpRight,
} from "lucide-react"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { Checkbox } from "./components/ui/checkbox"
import { SceneFlow } from "./SceneFlow"
import { createSceneBook, sceneAction, sceneView, type SceneBook, type SceneCommand } from "./scene-model"
import { AppointmentContact, ContactStatus } from "./AppointmentContact"
import { AppointmentFlow } from "./AppointmentFlow"
import { MeetingChoice } from "./MeetingChoice"
import { createAppointment, appointmentAction, appointmentView, appointmentSafetyDemo, refreshContactReservation, type AppointmentState, type AppointmentCommand } from "./appointment-model"
import type { ContactSharing } from "./contact-model"
import { recordDayAvailability } from "./refund-policy"
import { RefundPolicyPanel } from "./RefundPolicyPanel"
import { saveMemberFeedback, saveMemberPayment, submitMemberRequest, type RequestContext } from "./member-operations-model"
import type { Feedback } from "./admin-governance-model"
import { requestPaymentCancellation, type PaymentSession } from "./payment-model"
import { LetterFlow } from "./LetterFlow"
import {
  createLetterBook,
  letterAction,
  letterView,
  type LetterBook,
  type LetterCommand,
} from "./letter-model"
import {
  agreementAction,
  agreementGate,
  agreementView,
  defaultStart,
  makeAgreementFixture,
  refreshAgreementDate,
  startAgreementDemo,
  type AgreementCommand,
  type ExtensionCommand,
  type AgreementState,
  type Plan,
} from "./agreement-model"

const plans = {
  A: {
    name: "A. 편지 나누기",
    description: "각자 하루 한 통씩, 홈페이지에서 3일 동안 나누는 이야기.",
  },
  B: {
    name: "B. 첫 장면 만들기",
    description: "3일간 활동·분위기·대화 소재를 함께 고르며 만드는 한 장면.",
  },
}
const motion = "transition-colors duration-200 motion-reduce:transition-none"
const format = (value: string) =>
  new Date(value).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
type DemoStore = {
  generation: number
  state: AgreementState | null
  letters: LetterBook | null
  scene: SceneBook | null
  appointment: AppointmentState | null
  memberId: string
  now: string
}
let store: DemoStore = {
  generation: 0,
  state: null,
  letters: null,
      scene: null,
      appointment: null,
  memberId: "",
  now: "2026-10-07T12:00:00+09:00",
}
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function updateStore(next: DemoStore) {
  if (next.state && next.state.sessions.every(session => session.exchange?.status === "confirmed" && session.exchange.confirmedAt && Number.isFinite(Date.parse(session.exchange.confirmedAt)) && Date.parse(session.exchange.confirmedAt) <= Date.parse(next.now) && session.exchange.programId === session.program?.id)) {
    const state = structuredClone(next.state);
    const bothPaidAt = new Date(Math.max(...state.sessions.map(session => Date.parse(session.exchange!.confirmedAt!)))).toISOString();
    state.sessions.forEach(session => { if (session.refundOperations && !session.refundOperations.bothPaidAt) session.refundOperations.bothPaidAt = bothPaidAt; });
    next = { ...next, state };
  }
  if (!next.letters && next.state?.status === "started")
    next = {
      ...next,
      letters: createLetterBook(next.state, new Date(next.now)),
    }
  if (!next.scene && next.state?.status === "started") next = { ...next, scene: createSceneBook(next.state, new Date(next.now)) }
  if (next.state?.status === "started") {
    const state = structuredClone(next.state), now = new Date(next.now);
    state.members.forEach((memberId, index) => {
      const source = next.scene ? sceneView(next.scene, state, memberId, now) : letterView(next.letters, state, memberId, now);
      const day = source?.todayIndex ?? -1;
      const available = source?.readAccess && source.status === "active" && day >= 0 &&
        ("rows" in source ? !!(source.rows[day]?.writable || source.rows[day]?.ownSubmittedAt || source.rows[day]?.exchange) : !!(source.days[day]?.writable || source.completed[day]));
      if (available) state.sessions[index] = recordDayAvailability(state.sessions[index], day, `virtual-available:${source!.programId}:${day}`, next.now, true, now);
    });
    next = { ...next, state };
  }
  const exchange = exchangeSnapshot(next)
  if (!next.appointment && next.state && exchange?.mutualMeetingWish && exchange.mutualYesAt) {
    const policy = next.scene?.meetingPolicy || next.letters?.meetingPolicy
    if (policy) next = { ...next, appointment: createAppointment(exchange.programId, next.state.members, exchange.mutualYesAt, policy) }
  }
  if (next.appointment) next = { ...next, appointment: refreshContactReservation(next.appointment,new Date(next.now),!!exchange?.meetingOpen && exchange.mutualMeetingWish) }
  store = next
  listeners.forEach((listener) => listener())
}
export const useAgreementDemo = () =>
  useSyncExternalStore(
    subscribe,
    () => store,
    () => store,
  )

export function performLetter(command: LetterCommand, revision: number) {
  if (!store.state || !store.letters) return "확인된 A 교류가 없습니다."
  const result = letterAction(
    store.letters,
    store.state,
    store.memberId,
    command,
    revision,
    new Date(store.now),
  )
  const agreement =
    !result.error &&
    ["interrupt", "block"].includes(command.type) &&
    store.state.status === "started"
      ? agreementAction(
          store.state,
          store.memberId,
          { type: "interrupt" },
          store.state.revision,
          new Date(store.now),
        ).state
      : store.state
  if (!result.error && ["report","contact","interrupt","block"].includes(command.type)) recordExchangeRequest(command.type as "report" | "contact" | "interrupt" | "block")
  updateStore({ ...store, state: agreement, letters: result.book })
  return result.error
}
export function switchLetterDemoAccount() {
  if (store.state)
    updateStore({
      ...store,
      memberId: store.state.members.find((id) => id !== store.memberId)!,
    })
}
export function setLetterDemoClock(value: string) {
  if (Number.isFinite(Date.parse(value))) updateStore({ ...store, now: value })
}
export const loadStartedLetterDemo = () => loadStartedExchangeDemo("A")
export const loadStartedSceneDemo = () => loadStartedExchangeDemo("B")
function loadStartedExchangeDemo(plan: Plan) {
  const now = new Date("2026-10-07T12:00:00+09:00")
  let state = makeAgreementFixture(now)
  for (const memberId of state.members) {
    state = agreementAction(
      state,
      memberId,
      { type: "draft", plan },
      state.revision,
      now,
    ).state
    state = agreementAction(
      state,
      memberId,
      { type: "share" },
      state.revision,
      now,
    ).state
  }
  for (const memberId of state.members)
    state = agreementAction(
      state,
      memberId,
      { type: "confirm" },
      state.revision,
      now,
    ).state
  const start = new Date(state.startAt!)
  const result = startAgreementDemo(state, start, true)
  if (!result.error)
    updateStore({
      generation: store.generation + 1,
      state: result.state,
      letters: null,
      scene: null,
      appointment: null,
      memberId: state.members[0],
      now: start.toISOString(),
    })
}

type FlowProps = {
  state: AgreementState | null
  memberId: string
  now: Date
  onCommand?: (command: AgreementCommand | ExtensionCommand, revision: number) => string | null
  onRefresh?: () => void
}
export function AgreementFlow({
  state,
  memberId,
  now,
  onCommand,
  onRefresh,
}: FlowProps) {
  const view = agreementView(state, memberId, now)
  const [message, setMessage] = useState("")
  const [date, setDate] = useState(view?.startAt?.slice(0, 10) || "")
  useEffect(() => {
    setDate(view?.startAt?.slice(0, 10) || "")
  }, [view?.startAt])
  const run = (command: AgreementCommand | ExtensionCommand) => {
    if (!view || !onCommand) return
    const error = onCommand(command, view.revision)
    setMessage(
      error ||
        (command.type === "share"
          ? "선택을 공유했어요. 초안과 공유한 선택은 따로 관리합니다."
          : command.type === "confirm"
            ? "이 방식과 일정에 대한 내 확인을 기록했어요."
            : command.type === "request-confirmation"
              ? "확인 요청을 가상 이력에 남겼어요. 실제 알림은 발송하지 않았습니다."
              : command.type === "withdraw"
                ? "시작 전 철회 요청을 기록했어요. 소개 재개·기납 교류비 처리는 정책 확인과 상담이 필요합니다."
                : command.type === "interrupt"
                  ? "중단 요청을 기록했어요. 자동 환불·정상 완료로 처리하지 않습니다."
                  : command.type === "date"
                    ? "일정을 새로 제안했어요. 두 사람 모두 다시 확인해 주세요."
                    : "초안만 바뀌었어요. 공유하기 전에는 상대에게 전달되지 않습니다."),
    )
  }
  const terminal =
    !!view && ["started", "interrupted", "withdrawn"].includes(view.status)
  return (
    <section aria-labelledby="agreement-title" className="py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-xs font-semibold tracking-widest text-accent">
          OUR FIRST THREE DAYS
        </p>
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          서버 시간·두 계정 동기화 미연결 · 데모
        </span>
      </div>
      <h1
        id="agreement-title"
        className="text-3xl font-semibold leading-relaxed"
      >
        우리, 어떤 방식으로 시작할까요?
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
        마음을 서두르지 않고 알아갈 수 있도록, 두 사람이 편한 방식을 함께
        골라요.
      </p>
      {state?.members.includes(memberId) && <div className="mt-6">
        <RefundPolicyPanel session={state.sessions[state.members.indexOf(memberId)]} kind="exchange" now={now} onChange={value => { const error = saveCurrentMemberPayment(value); setMessage(error || "환불 계산·요청만 기록했습니다. 실제 환불 완료가 아닙니다."); }} />
        {view?.canExtend && <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-xs">양쪽 동의 시 합의 기한 24시간을 한 번 연장합니다. 내 선택만으로 연장하지 않습니다.</p>
          {!view.extensionRequested ? <Button variant="outline" disabled={!onCommand} onClick={() => run({ type: "extension-request" })}>합의 기한 24시간 연장 요청</Button>
            : !view.ownExtensionConsent ? <Button variant="outline" disabled={!onCommand} onClick={() => run({ type: "extension-consent" })}>24시간 1회 연장에 동의</Button>
            : <p className="text-xs text-primary">내 연장 동의 기록 · 상대의 별도 동의 대기</p>}
        </div>}
      </div>}
      {!view ? (
        <div className="mt-7 border border-border bg-muted p-6">
          <p className="text-sm font-semibold">
            {agreementGate(state, now) || "당사자 확인이 필요합니다."}
          </p>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            상호 선택과 양쪽 교류비 결제 완료 전에는 A/B를 공유하거나 시작할 수
            없습니다. 한쪽 선택·결제만으로 상대의 응답을 만들지 않습니다.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/demo/agreement">
              분리된 가상 합의 데모 보기 <ArrowUpRight size={15} />
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-7 flex flex-wrap gap-3 border-y border-border py-4 text-xs">
            <span className="flex items-center gap-2">
              <Check size={14} className="text-primary" />
              양쪽 상호 선택 확인
            </span>
            <span className="flex items-center gap-2">
              <Check size={14} className="text-primary" />
              각자 교류비 24,000원 완료 · 가상 승인 기록
            </span>
            <span className="text-muted-foreground">
              A/B 동일 가격 · 추가 과금 없음
            </span>
          </div>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {(["A", "B"] as Plan[]).map((plan) => (
              <article
                key={plan}
                className={`flex flex-col border bg-card ${
                  view.ownDraft === plan ? "border-primary" : "border-border"
                }`}
              >
                <div
                  className="flex h-72 shrink-0 flex-col justify-between bg-muted p-6"
                  aria-hidden="true"
                >
                  {plan === "A" ? (
                    <>
                      <div className="flex items-center justify-between">
                        <BookOpen size={22} className="text-primary" />
                        <span className="text-xs text-muted-foreground">
                          DAY 01 — 03
                        </span>
                      </div>
                      <div className="my-4 border-l-2 border-primary pl-5">
                        <p className="text-lg leading-8">
                          오늘의 작은 이야기,
                          <br />
                          당신에게 한 통.
                        </p>
                        <div className="mt-5 h-px w-3/4 bg-border" />
                        <div className="mt-3 h-px w-1/2 bg-border" />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        질문 하나 · 각자의 문장
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          ACTIVITY / MOOD / TALK
                        </span>
                        <MessageCircle size={22} className="text-accent" />
                      </div>
                      <div className="my-4 grid grid-cols-3 gap-3">
                        <div className="flex aspect-square max-h-36 items-center justify-center bg-accent/10">
                          <MapPin size={30} className="text-accent" />
                        </div>
                        <div className="flex aspect-square max-h-36 items-center justify-center bg-primary/10">
                          <Coffee size={30} className="text-primary" />
                        </div>
                        <div className="flex aspect-square max-h-36 items-center justify-center border border-accent/20">
                          <span className="text-3xl font-light text-accent">
                            ··
                          </span>
                        </div>
                      </div>
                      <p className="bg-accent px-4 py-2 text-xs text-accent-foreground">
                        우리의 활동 · 분위기 · 대화 소재
                      </p>
                    </>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <h2 className="text-xl font-semibold">{plans[plan].name}</h2>
                  <p className="mt-3 min-h-14 text-sm leading-7 text-muted-foreground">
                    {plans[plan].description}
                  </p>
                  <Button
                    variant="outline"
                    disabled={!onCommand || terminal}
                    aria-pressed={view.ownDraft === plan}
                    onClick={() => run({ type: "draft", plan })}
                    className={`mt-5 h-12 w-full rounded-xl ${motion} ${
                      view.ownDraft === plan
                        ? "border-primary text-primary"
                        : ""
                    }`}
                  >
                    {view.ownDraft === plan && <Check size={16} />}
                    {view.ownDraft === plan
                      ? "내 초안 선택됨"
                      : "이 방식으로 초안 선택"}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Button
              disabled={
                !onCommand ||
                !view.ownDraft ||
                view.ownDraft === view.ownShared ||
                terminal
              }
              onClick={() => run({ type: "share" })}
              className={`h-12 rounded-xl px-7 ${motion}`}
            >
              선택 공유하기 <ArrowRight size={16} />
            </Button>
            <p className="text-xs leading-6 text-muted-foreground">
              초안은 나만 확인합니다. 공유한 뒤에만 상대에게 전달합니다.
            </p>
          </div>
          <div className="mt-6 grid gap-5 lg:grid-cols-[8fr_4fr]">
            <section
              className="border border-border bg-card p-6"
              aria-label="공유와 시작 일정"
            >
              <h2 className="text-base font-semibold">함께 확인하는 시작</h2>
              <p className="mt-4 text-sm leading-7">
                {view.peerShared
                  ? `상대방은 ${plans[view.peerShared].name}를 선택하셨어요!`
                  : "상대방의 선택을 기다리고 있어요."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                내가 공유한 선택:{" "}
                {view.ownShared
                  ? plans[view.ownShared].name
                  : "아직 공유하지 않았어요."}
              </p>
              {view.ownShared && view.peerShared && !view.matched && (
                <div className="mt-5 bg-muted p-4">
                  <p className="text-sm leading-7">
                    아직 선택이 달라요. 두 사람이 같은 방식을 고르면 시작할 수
                    있어요.
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    내 선택 변경은 위 카드에서 초안을 고른 뒤 다시 공유해
                    주세요. 선착순·다수결·운영자 배정은 하지 않습니다.
                  </p>
                </div>
              )}
              {view.matched && view.startAt && (
                <div className="mt-5 space-y-4 border-t border-border pt-5">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Clock3 size={16} className="text-primary" />
                    {format(view.startAt)} · Asia/Seoul 시작{" "}
                    {terminal ? "기록" : "제안"}
                  </p>
                  <p className="text-xs leading-6 text-muted-foreground">
                    기본안은 양쪽 확인이 완료된 다음 날 오전 09:00입니다.
                    방식이나 일정 변경 시 양쪽 확인을 해제하고 다시 합의합니다.
                  </p>
                  <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {view.dates.map((date, index) => (
                      <li key={date} className="bg-muted p-3">
                        <p className="text-xs font-semibold text-accent">
                          {index === 3 ? "만남 의사" : `DAY 0${index + 1}`}
                        </p>
                        <time className="mt-2 block text-xs" dateTime={date}>
                          {date}
                        </time>
                      </li>
                    ))}
                  </ol>
                  {!terminal && (
                    <>
                      <label
                        htmlFor="agreement-date"
                        className="block text-xs font-medium"
                      >
                        다른 시작 날짜 제안 · 오전 09:00
                        <Input
                          id="agreement-date"
                          className="mt-2 h-11 rounded-xl"
                          type="date"
                          min={defaultStart(now).slice(0, 10)}
                          value={date}
                          onChange={(event) => setDate(event.target.value)}
                        />
                      </label>
                      <Button
                        variant="outline"
                        disabled={
                          !onCommand ||
                          !date ||
                          date === view.startAt.slice(0, 10)
                        }
                        onClick={() => run({ type: "date", date })}
                      >
                        일정 변경 공유 · 양쪽 재확인
                      </Button>
                      {view.staleDate ? (
                        <div className="bg-muted p-4 text-xs leading-6">
                          <p>
                            제안일이 지났습니다. 새 날짜로 두 사람이 다시
                            확인해야 해요.
                          </p>
                          <Button
                            variant="outline"
                            className="mt-3"
                            onClick={onRefresh}
                            disabled={!onRefresh}
                          >
                            새 날짜 확인하기
                          </Button>
                        </div>
                      ) : (
                        <Button
                          className="h-12 w-full rounded-xl"
                          disabled={
                            !onCommand ||
                            view.ownConfirmed ||
                            !!(
                              view.ownDraft && view.ownDraft !== view.ownShared
                            )
                          }
                          onClick={() => run({ type: "confirm" })}
                        >
                          {view.ownConfirmed
                            ? "내 시작 동의 확인됨"
                            : "이 방식과 일정으로 시작하기"}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                {!terminal && (
                  <Button
                    variant="outline"
                    disabled={!onCommand || !view.ownShared}
                    onClick={() => run({ type: "request-confirmation" })}
                  >
                    확인 요청
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() =>
                    setMessage(
                      "운영자 문의 경로는 데모입니다. 미시작·중단·교류비 처리 정책 확인이 필요하며 실제 접수는 연결되지 않았습니다.",
                    )
                  }
                >
                  운영자 문의
                </Button>
                {!terminal && (
                  <Button
                    variant="outline"
                    disabled={!onCommand}
                    onClick={() => run({ type: "withdraw" })}
                  >
                    시작 전 철회 요청
                  </Button>
                )}
                {view.status === "started" && (
                  <Button
                    variant="outline"
                    disabled={!onCommand}
                    onClick={() => run({ type: "interrupt" })}
                  >
                    교류 중단 요청
                  </Button>
                )}
              </div>
            </section>
            <aside className="border border-border bg-muted p-6">
              <p className="text-xs font-semibold text-accent">현재 진행</p>
              <h2 className="mt-4 text-lg font-semibold">
                {view.status === "started"
                  ? view.day && view.day <= 3
                    ? `DAY ${String(view.day).padStart(2, "0")} · 실제 개시 가상 기록`
                    : "3일 교류 이후 · 만남 의사 확인"
                  : view.status === "scheduled"
                    ? "양쪽 확인 완료 · 시작 예정"
                    : view.status === "withdrawn"
                      ? "시작 전 철회 · 처리 확인 필요"
                      : view.status === "interrupted"
                        ? "교류 중단 · 문의 확인 필요"
                        : "방식·일정 합의 중"}
              </h2>
              <dl className="mt-5 space-y-4 text-xs">
                <div>
                  <dt className="text-muted-foreground">방식 공유</dt>
                  <dd className="mt-1">
                    나 {view.ownShared ? "공유" : "미공유"} · 상대{" "}
                    {view.peerShared ? "공유" : "미공유"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">시작 동의</dt>
                  <dd className="mt-1">
                    나 {view.ownConfirmed ? "확인" : "미확인"} · 상대{" "}
                    {view.peerConfirmed ? "확인" : "미확인"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">실제 개시</dt>
                  <dd className="mt-1">
                    {view.startedAt
                      ? format(view.startedAt)
                      : "기록 없음 · 아직 시작하지 않았어요."}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    첫 교류 전 소개 이용 권리
                  </dt>
                  <dd className="mt-1">
                    {view.rights === "first-program-started"
                      ? "실제 개시로 이번 회차 혜택 종료"
                      : "유지 · 시작 전 기간은 소진하지 않아요."}
                  </dd>
                </div>
              </dl>
              <p className="mt-6 border-t border-border pt-4 text-xs leading-6">
                새 소개는 중지된 상태입니다. 시작 전 미합의·철회는 소개 재개와
                교류비 미시작 처리를 별도로 검토하며 자동 환불·재구매로 처리하지
                않습니다.
              </p>
            </aside>
          </div>
          <p className="mt-5 text-sm leading-7">
            3일 안에 마음을 증명할 필요는 없어요. 서로를 더 알아가는 첫
            시간입니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-4 text-xs">
            <Link
              to="/#faq"
              className="text-primary underline underline-offset-4"
            >
              미시작·취소·환불 안내 확인
            </Link>
            {view.status === "withdrawn" && (
              <Link
                to="/demo/payments"
                className="text-primary underline underline-offset-4"
              >
                교류비 처리 흐름 예시 · 별도 데모
              </Link>
            )}
          </div>
        </>
      )}
      {message && (
        <p
          role="status"
          className="mt-5 rounded-xl bg-muted p-4 text-sm leading-7"
        >
          {message}
        </p>
      )}
    </section>
  )
}

function perform(command: AgreementCommand | ExtensionCommand, revision: number) {
  if (!store.state) return "연결된 가상 소개 건이 없습니다."
  const result = agreementAction(
    store.state,
    store.memberId,
    command,
    revision,
    new Date(store.now),
  )
  updateStore({ ...store, state: result.state })
  return result.error
}
export function MemberAgreement({
  context = "exchange",
}: {
  context?: "today" | "us" | "exchange"
}) {
  const [params] = useSearchParams()
  const demo = useAgreementDemo()
  const enabled = params.get("demo") === "agreement"
  const exchange = enabled ? exchangeSnapshot(demo) : null
  return (
    <div>
      {enabled && (
        <div className="mt-6 border border-accent/20 bg-accent/5 p-4 text-xs leading-6">
          <p className="font-semibold text-accent">
            가상 한 쌍의 공유 상태 ·{" "}
            {context === "today"
              ? "오늘"
              : context === "us"
                ? "두 사람"
                : "교류"}
          </p>
          <p>가상 시계 {demo.now} · 서버 동기화·실제 계정·결제·발송 미연결</p>
          <div className="mt-2 flex flex-wrap gap-4">
            {[
              ["/today", "오늘"],
              ["/us", "두 사람"],
              ["/exchange", "교류"],
              ["/meeting", "약속"],
              ["/demo/agreement", "분리된 개발용 제어"],
            ].map(([path, label]) => (
              <Link
                key={path}
                to={
                  path === "/demo/agreement" ? path : `${path}?demo=agreement`
                }
                className="text-primary underline underline-offset-4"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      )}
      {enabled && context === "today" && (exchange?.meetingOpen || demo.appointment) ? (
        <Day04Panel key={`${demo.generation}-${demo.memberId}`} />
      ) : enabled && demo.scene ? (
        <SceneFlow key={`${demo.generation}-${demo.memberId}`} view={sceneView(demo.scene, demo.state, demo.memberId, new Date(demo.now))} onCommand={performScene} />
      ) : enabled && demo.letters ? (
        <LetterFlow
          key={`${demo.generation}-${demo.memberId}`}
          view={letterView(
            demo.letters,
            demo.state,
            demo.memberId,
            new Date(demo.now),
          )}
          nowLabel={demo.now}
          onCommand={performLetter}
        />
      ) : (
        <AgreementFlow
          state={enabled ? demo.state : null}
          memberId={enabled ? demo.memberId : ""}
          now={enabled ? new Date(demo.now) : new Date()}
          onCommand={enabled ? perform : undefined}
          onRefresh={
            enabled
              ? () =>
                  demo.state &&
                  updateStore({
                    ...demo,
                    state: refreshAgreementDate(demo.state, new Date(demo.now)),
                  })
              : undefined
          }
        />
      )}
    </div>
  )
}

export function AgreementDemo() {
  const demo = useAgreementDemo()
  const [usable, setUsable] = useState(false)
  const [error, setError] = useState("")
  const now = new Date(demo.now)
  const load = () => {
    const state = makeAgreementFixture(now)
    updateStore({
      ...demo,
      generation: demo.generation + 1,
      state,
      letters: null,
      scene: null,
      appointment: null,
      memberId: state.members[0],
    })
    setError("")
  }
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <div className="border border-accent/20 bg-accent/5 p-5">
        <p className="text-sm font-semibold text-accent">
          개발용 A/B 합의 · 가상 두 계정 데모
        </p>
        <p className="mt-2 text-xs leading-6">
          실제 결제 승인·서버 시간·두 계정 동기화는 없습니다. 제어 버튼은 회원
          화면과 분리됩니다. 상대 선택은 아래에서 계정을 직접 전환해 공유한
          경우에만 생깁니다.
        </p>
        <p className="mt-3 text-xs">
          가상 시계: {demo.now} · 현재 계정{" "}
          {demo.memberId === demo.state?.members[1] ? "예시 나" : "예시 가"}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={load}>
            양쪽 가상 승인 기록 불러오기
          </Button>
          <Button
            variant="outline"
            disabled={!demo.state}
            onClick={() =>
              demo.state &&
              updateStore({
                ...demo,
                memberId: demo.state.members.find(
                  (id) => id !== demo.memberId,
                )!,
              })
            }
          >
            가상 계정 전환
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              updateStore({
                ...demo,
                now: new Date(now.getTime() + 86400000).toISOString(),
              })
            }
          >
            가상 시계 하루 이동
          </Button>
          <Button
            variant="outline"
            disabled={!demo.state?.startAt}
            onClick={() =>
              demo.state?.startAt &&
              updateStore({ ...demo, now: demo.state.startAt })
            }
          >
            합의 시작 시각으로 이동
          </Button>
          <Button
            variant="outline"
            disabled={!demo.state}
            onClick={() =>
              demo.state &&
              updateStore({
                ...demo,
                state: refreshAgreementDate(demo.state, now),
              })
            }
          >
            지난 제안일 갱신 시연
          </Button>
        </div>
        <label className="mt-4 flex items-center gap-3 text-xs">
          <Checkbox
            checked={usable}
            onCheckedChange={(value) => setUsable(value === true)}
          />
          가상 프로그램 실제 이용 가능 이벤트 · 오류 시에는 선택하지 않음
        </label>
        <Button
          className="mt-3"
          disabled={!demo.state}
          onClick={() => {
            if (!demo.state) return
            const result = startAgreementDemo(demo.state, now, usable)
            updateStore({ ...demo, state: result.state })
            setError(
              result.error ||
                "가상 개시 이벤트를 양쪽에 기록했습니다. 실제 서버 프로그램은 시작하지 않았습니다.",
            )
          }}
        >
          가상 개시 이벤트 시연
        </Button>
        {error && (
          <p role="status" className="mt-3 text-xs leading-6">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-4 text-xs">
          {[
            ["today", "오늘"],
            ["us", "두 사람"],
            ["exchange", "교류"],
          ].map(([path, label]) => (
            <Link
              key={path}
              to={`/${path}?demo=agreement`}
              className="text-primary underline underline-offset-4"
            >
              {label}에서 같은 가상 상태 확인
            </Link>
          ))}
        </div>
      </div>
      <AgreementFlow
        key={demo.memberId}
        state={demo.state}
        memberId={demo.memberId}
        now={now}
        onCommand={perform}
        onRefresh={() =>
          demo.state &&
          updateStore({ ...demo, state: refreshAgreementDate(demo.state, now) })
        }
      />
    </main>
  )
}

export function performScene(command: SceneCommand, revision: number) {
  if (!store.scene || !store.state) return "확인된 B 교류가 없습니다."
  const result = sceneAction(store.scene, store.state, store.memberId, command, revision, new Date(store.now))
  const state = !result.error && ["interrupt", "block"].includes(command.type) && store.state.status === "started" ? agreementAction(store.state, store.memberId, { type: "interrupt" }, store.state.revision, new Date(store.now)).state : store.state
  if (!result.error && ["report","contact","interrupt","block"].includes(command.type)) recordExchangeRequest(command.type as "report" | "contact" | "interrupt" | "block")
  updateStore({ ...store, state, scene: result.book })
  return result.error
}

function exchangeSnapshot(snapshot: DemoStore) {
  const now = new Date(snapshot.now)
  return snapshot.scene ? sceneView(snapshot.scene, snapshot.state, snapshot.memberId, now) : letterView(snapshot.letters, snapshot.state, snapshot.memberId, now)
}
function exchangeRequestContext(): RequestContext {
  return { memberId: store.memberId, targetId: store.state?.members.find(id=>id!==store.memberId) || null, programId: exchangeSnapshot(store)?.programId || null, surface: "교류·약속" };
}
function recordExchangeRequest(kind: "report" | "contact" | "interrupt" | "block") {
  const own=store.state?.sessions[store.state.members.indexOf(store.memberId)];
  if(own)saveMemberPayment(store.memberId,own,new Date(store.now));
  submitMemberRequest(exchangeRequestContext(),kind === "contact" ? "inquiry" : kind,{confirmed:true},new Date(store.now));
}
export function useMemberServiceContext(enabled: boolean) {
  const demo=useAgreementDemo(), source=exchangeSnapshot(demo);
  const connected=enabled && !!demo.state && demo.state.members.includes(demo.memberId);
  return { connected, memberId: connected ? demo.memberId : "current-member", targetId: connected ? demo.state!.members.find(id=>id!==demo.memberId) || null : null, programId: connected ? source?.programId || null : null, complete: connected && !!source?.readAccess && !!source.complete, startedAt: connected ? demo.state!.startedAt : null, now: connected ? new Date(demo.now) : new Date(), payment: connected ? demo.state!.sessions[demo.state!.members.indexOf(demo.memberId)] : null, exchangeStatus: connected ? demo.state!.status : null, appointmentActive: connected && !!demo.appointment, contactScheduled: connected && demo.appointment?.contactSharing?.reservation?.status === "scheduled" };
}
export function protectCurrentExchange(kind: "block" | "interrupt") {
  if (store.scene) return performScene({type:kind},store.scene.revision);
  if (store.letters) return performLetter({type:kind},store.letters.revision);
  return "연결된 실제 가상 교류가 없습니다. 문의·신고를 통해 진행 확인을 요청해 주세요.";
}
export function saveCurrentMemberPayment(payment: PaymentSession) {
  if(!store.state) return "가상 계정이 없습니다.";
  const index=store.state.members.indexOf(store.memberId), own=store.state.sessions[index];
  if(!own || own.applicationId!==payment.applicationId || JSON.stringify(own.policy)!==JSON.stringify(payment.policy)) return "당사자 결제·적용 정책을 확인해 주세요.";
  const state=structuredClone(store.state);state.sessions[index]=structuredClone(payment);updateStore({...store,state});return null;
}
export function requestCurrentMemberRefund(kind: "introduction" | "exchange") {
  if(!store.state)return "가상 계정이 없습니다.";
  const own=store.state.sessions[store.state.members.indexOf(store.memberId)];
  if(!own)return "당사자 결제를 확인해 주세요.";
  const result=requestPaymentCancellation(own,kind,new Date(store.now));
  return result.error || saveCurrentMemberPayment(result.session);
}
export function submitCurrentMemberFeedback(input: { body: string; category: Feedback["category"]; operatorConsent: boolean; publicConsent: boolean; id?: string; version?: number }) {
  const source=exchangeSnapshot(store);
  return saveMemberFeedback(exchangeRequestContext(),!!source?.readAccess && source.complete,input,new Date(store.now));
}
export function performAppointment(command: AppointmentCommand, revision: number) {
  const source = exchangeSnapshot(store)
  if (!store.appointment || store.appointment.programId !== source?.programId) return "당사자의 약속 준비 상태를 확인해 주세요."
  const result = appointmentAction(store.appointment, store.memberId, command, revision, new Date(store.now), !!source.meetingOpen && source.mutualMeetingWish)
  if (!result.error && result.state !== store.appointment) updateStore({ ...store, appointment: result.state })
  if (!result.error && command.type === "contact") recordExchangeRequest("contact")
  return result.error
}
export function setContactSafetyDemo(safety: ContactSharing["safety"]) {
  if (!store.appointment) return "가상 약속이 없습니다.";
  const source = exchangeSnapshot(store);
  const result = appointmentSafetyDemo(store.appointment,safety,store.appointment.revision,new Date(store.now),!!source?.meetingOpen && source.mutualMeetingWish);
  if (!result.error) updateStore({ ...store, appointment: result.state });
  return result.error;
}
export function MemberContactSummary() {
  const [params] = useSearchParams(), demo = useAgreementDemo();
  const source = exchangeSnapshot(demo);
  const view = params.get("demo") === "agreement" && source?.readAccess ? appointmentView(demo.appointment,demo.memberId,new Date(demo.now),source.meetingOpen && source.mutualMeetingWish) : null;
  return <section className="mt-8 space-y-4 border-t border-border pt-7"><h2 className="text-xl">만남 전 연락처 공유</h2>{view?.final ? <><ContactStatus view={view} /><Button asChild variant="outline"><Link to="/meeting/contact?demo=agreement">공유 선택·공개 연락처 확인</Link></Button><p className="text-xs text-muted-foreground">가상 번호 데모 · 실제 번호·서버 인증 미연결</p></> : <p className="text-sm text-muted-foreground">최종 합의된 약속이 있으면 동의 상태와 공개 시각을 확인할 수 있어요.</p>}</section>;
}
export function Day04Panel({ contactOnly = false }: { contactOnly?: boolean }) {
  const demo = useAgreementDemo(), source = exchangeSnapshot(demo)
  const location = useLocation()
  useEffect(() => {
    const opened = () => { if (location.pathname === "/meeting" && document.visibilityState === "visible" && source?.readAccess && source.mutualMeetingWish && demo.appointment && appointmentView(demo.appointment,demo.memberId,new Date(demo.now),true)?.coordinationReady) performAppointment({ type: "page-open" },demo.appointment.revision) }
    opened(); document.addEventListener("visibilitychange",opened)
    return () => document.removeEventListener("visibilitychange",opened)
  },[location.pathname,demo.memberId,demo.now,demo.appointment?.revision,source?.readAccess,source?.mutualMeetingWish])
  if (!source?.readAccess || !source.complete || new Date(demo.now).getTime() < Date.parse(source.decisionAt)) return <section className="py-8"><h1 className="text-3xl">DAY 04 만남 선택을 기다리고 있어요.</h1><p className="mt-5 text-sm leading-7 text-muted-foreground">정상 3일 교류 완료와 4일째 09:00 이후 당사자에게 열립니다. 아직 확인된 만남 의사나 약속은 없습니다.</p></section>
  const appointment = appointmentView(demo.appointment, demo.memberId, new Date(demo.now), source.meetingOpen && source.mutualMeetingWish)
  if (contactOnly) return appointment ? <AppointmentContact key={`${demo.generation}-${demo.memberId}`} view={appointment} onCommand={performAppointment} recheckContact={() => {
    if (store.memberId !== demo.memberId || store.generation !== demo.generation || store.appointment?.revision !== appointment.revision) return null;
    const current = exchangeSnapshot(store);
    if (!current?.readAccess || !current.complete || !current.meetingOpen || !current.mutualMeetingWish) return null;
    const checked = appointmentView(store.appointment, store.memberId, new Date(store.now), true);
    return checked?.contact.released && !checked.contact.blocked ? checked.contact.peerNumber || null : null;
  }} /> : <p className="py-8 text-sm">최종 합의와 당사자 권한 확인 전에는 연락처 공개 동의를 진행하지 않습니다.</p>
  if (appointment) return <AppointmentFlow key={`${demo.generation}-${demo.memberId}`} view={appointment} onCommand={performAppointment} />
  return <section className="space-y-5 py-8"><p className="text-xs text-accent">DAY 04 · 가상 만남 의사 선택</p><MeetingChoice view={source} onSend={command => { const error = demo.scene ? performScene(command, source.revision) : performLetter(command, source.revision); if (error) window.alert(error) }} /><p className="text-xs text-muted-foreground">미응답은 YES나 NO가 아닙니다. 시간·두 계정 동기화·실제 발송은 미연결인 데모입니다.</p><Button asChild variant="outline"><Link to="/exchange?demo=agreement">지난 교류 확인</Link></Button><Button variant="outline" onClick={() => { const error = demo.scene ? performScene({ type: "contact" }, source.revision) : performLetter({ type: "contact" }, source.revision); window.alert(error || "가상 문의 요청을 기록했습니다. 실제 접수는 미연결입니다.") }}>운영자 문의</Button></section>
}
export function MemberMeeting({ contactOnly = false }: { contactOnly?: boolean }) {
  const [params] = useSearchParams()
  const demo = useAgreementDemo()
  if (params.get("demo") !== "agreement") return <section className="py-8"><p className="text-xs text-accent">약속</p><h1 className="mt-5 text-3xl">함께 나눈 이야기, 그다음 장면으로.</h1><p className="mt-5 max-w-xl text-sm leading-7 text-muted-foreground">3일 교류 정상 완료 뒤 DAY 04에 만남 의사를 선택합니다. 양쪽 모두 만나기를 선택하면 약속 방식을 정할 수 있어요. 현재 확인된 교류·만남 의사·약속은 없습니다.</p></section>
  return <div><p className="text-xs text-accent">가상 두 계정 데모 · 서버 동기화·시간 검증 미연결</p><Link to="/demo/meeting" className="mt-3 inline-block text-xs text-primary underline">분리된 개발용 제어</Link><Day04Panel key={`${demo.generation}-${demo.memberId}`} contactOnly={contactOnly} /></div>
}
