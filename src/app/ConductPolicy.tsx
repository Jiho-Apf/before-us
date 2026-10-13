import { useMemo, useState } from "react"
import { Link } from "react-router"
import { Scale } from "lucide-react"
import { Button } from "./components/ui/button"
import { Checkbox } from "./components/ui/checkbox"
import { Input } from "./components/ui/input"
import { Label } from "./components/ui/label"
import { Textarea } from "./components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select"
import { makePaymentFixture, type PaymentSession } from "./payment-model"
import {
  CASE_STATUS,
  CONDUCT_NOTICE,
  CONDUCT_POLICY,
  EXCUSE_REASONS,
  INTERRUPTION_REASONS,
  classifyCancellation,
  decideConductCase,
  endAfterLateCancellation,
  interruptionOutcome,
  liftSanction,
  memberConductView,
  noShowReportGate,
  recordCancellation,
  recordInterruption,
  reportNoShow,
  requestConductReconsideration,
  requestNewRound,
  resetConductDemo,
  reuseQuote,
  useConductState,
  type ExcuseReason,
  type InterruptionReason,
} from "./conduct-policy"

const time = (at: string) =>
  new Date(at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })
const money = (value: number | null) =>
  value === null ? "개별 확인 필요" : `${value.toLocaleString("ko-KR")}원`
const KIND_LABELS = { interruption: "교류 중단", cancellation: "약속 취소", "no-show": "노쇼" } as const

export function ConductPolicyNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-3 rounded-xl bg-secondary p-5 text-xs leading-7">
      <div className="flex items-center gap-2 font-semibold">
        <Scale className="size-4 text-primary" />
        교류 중단·약속 취소·노쇼·재이용 기준 · {CONDUCT_POLICY.version}
      </div>
      <ul className="list-disc space-y-1 pl-5">
        {(compact ? CONDUCT_NOTICE.slice(0, 4) : CONDUCT_NOTICE).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        운영 기준이며 실제 약관의 법률 검토 완료를 뜻하지 않습니다. 법정
        청약철회 권리와 더 유리한 약관상 권리를 제한하지 않습니다. 기존 환불
        기준 V6-refund-01의 DAY별 산정을 그대로 사용합니다.
      </p>
    </div>
  )
}

export function MemberConductSummary({
  memberId,
  payment,
  now,
  programEnded = false,
  lastReviewAt = null,
}: {
  memberId: string
  payment: PaymentSession
  now: Date
  programEnded?: boolean
  lastReviewAt?: string | null
}) {
  const state = useConductState()
  const view = memberConductView(memberId, now, state)
  const quote = reuseQuote({ memberId, payment, programEnded, lastReviewAt, now }, state)
  const [reconsider, setReconsider] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [message, setMessage] = useState("")
  return (
    <div className="space-y-4">
      {view.suspension && (
        <p className="rounded-xl border border-destructive/40 p-4 text-sm">
          소개 이용 정지 · {time(view.suspension.endsAt)}까지
          {view.suspension.status === "reconsidering" && " · 재검토 요청 접수됨"}
          {view.suspension.escalationReview && " · 반복·고의성 추가 조치 운영 검토 중"}
        </p>
      )}
      {view.cases.length ? (
        view.cases.map((item) => (
          <div key={item.id} className="space-y-2 rounded-xl bg-muted p-4 text-xs leading-6">
            <div className="flex flex-wrap justify-between gap-2">
              <span>{KIND_LABELS[item.kind]}</span>
              <span className="text-primary">{CASE_STATUS[item.status]}</span>
            </div>
            <p className="text-sm">{item.notice}</p>
            <div className="flex flex-wrap gap-2">
              {item.canEndAfterLate && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setMessage(
                      endAfterLateCancellation(item.id, memberId, now) ||
                        "교류 종료를 기록했어요. 다음 소개비 5,000원 면제가 적용됩니다.",
                    )
                  }
                >
                  늦은 취소로 교류 종료
                </Button>
              )}
              {item.canReconsider && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setReconsider(item.id)
                    setNote("")
                  }}
                >
                  재검토 요청
                </Button>
              )}
            </div>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          교류 중단·약속 취소·노쇼 기록이 없습니다.
        </p>
      )}
      {reconsider && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <Textarea
            aria-label="재검토 요청 사유"
            maxLength={300}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="재검토가 필요한 이유 · 연락처·링크 제외"
          />
          <Button
            size="sm"
            onClick={() => {
              const error = requestConductReconsideration(reconsider, memberId, note, now)
              setMessage(error || "재검토 요청을 기록했어요. 운영자가 다시 확인합니다.")
              if (!error) setReconsider(null)
            }}
          >
            재검토 요청 기록
          </Button>
        </div>
      )}
      <div className="space-y-2 border-t border-border pt-4 text-sm">
        <p className="font-semibold">다음 소개 · 재이용</p>
        {view.waivers.map((waiver) => (
          <p key={waiver.id} className="text-xs">
            다음 소개비 {waiver.amount.toLocaleString("ko-KR")}원 면제 ·{" "}
            {{ pending: "운영 확인 대기", granted: "적용 가능", applied: "새 회차에 적용됨", voided: "확인되지 않음" }[waiver.status]}{" "}
            · {waiver.reason}
          </p>
        ))}
        {view.priority && <p className="text-xs text-primary">우선 재소개 대상이에요.</p>}
        <p className="text-xs leading-6">{quote.message}</p>
        {quote.status === "available" && (
          <>
            <p className="text-xs leading-6 text-muted-foreground">
              다시 쓰는 정보: {quote.reuse.join(" · ")}
              {quote.reverify.length
                ? ` · 마지막 검토 후 90일 이상이거나 기록이 없어 다시 확인: ${quote.reverify.join(" · ")}`
                : " · 마지막 검토 90일 이내"}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const result = requestNewRound({ memberId, payment, programEnded, lastReviewAt, now })
                setMessage(
                  result.error ||
                    "새 회차 소개 요청을 가상으로 기록했어요. 실제 결제·청구는 하지 않습니다.",
                )
              }}
            >
              새 회차 소개 요청
            </Button>
          </>
        )}
      </div>
      <p role="status" className="text-xs text-primary">
        {message}
      </p>
    </div>
  )
}

export function AdminConductCases({ now }: { now?: Date } = {}) {
  const state = useConductState()
  const [selected, setSelected] = useState("")
  const [note, setNote] = useState("")
  const [intentional, setIntentional] = useState(false)
  const [message, setMessage] = useState("")
  const item = state.cases.find((entry) => entry.id === selected)
  const decide = (decision: "confirmed" | "dismissed" | "excused") =>
    setMessage(
      decideConductCase(selected, decision, note, { intentional }, now) ||
        "가상 운영 확인을 기록했어요. 실제 환불·정지 실행은 서버 연동이 필요합니다.",
    )
  return (
    <section className="mt-7 space-y-4 border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Scale className="size-4 text-primary" />
        <h2 className="text-lg">교류 중단·약속 취소·노쇼 · {CONDUCT_POLICY.version}</h2>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        노쇼와 귀책 주장은 자동 판정하지 않습니다. 확인된 노쇼는 기본{" "}
        {CONDUCT_POLICY.noShowSuspensionDays}일 소개 이용 정지이며 반복·고의성은
        30일 이상 또는 이용 종료를 별도로 검토합니다. 모든 이용 제한은 기록과
        재검토 경로를 남깁니다.
      </p>
      {state.cases.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="py-3">사건</th>
                <th>당사자</th>
                <th>상태</th>
                <th>제한</th>
                <th>검토</th>
              </tr>
            </thead>
            <tbody>
              {state.cases.map((entry) => (
                <tr key={entry.id} className="border-b border-border align-top">
                  <td className="py-3">
                    {KIND_LABELS[entry.kind]}
                    {entry.interruption && ` · ${INTERRUPTION_REASONS[entry.interruption.reason]}`}
                    {entry.cancellation && ` · ${entry.cancellation.late ? "늦은 취소" : "일반 취소"} ${entry.cancellation.hoursBefore}시간 전`}
                    {entry.cancellation?.excuse && ` · ${EXCUSE_REASONS[entry.cancellation.excuse]} 주장`}
                  </td>
                  <td>
                    대상 {entry.actorId}
                    <br />
                    상대 {entry.partnerId}
                  </td>
                  <td>
                    {CASE_STATUS[entry.status]}
                    {entry.reconsideration && " · 재검토 요청"}
                  </td>
                  <td>
                    {entry.sanction
                      ? `${entry.sanction.days}일 정지 · ${entry.sanction.status === "lifted" ? "해제" : entry.sanction.status === "reconsidering" ? "재검토 중" : "적용"}${entry.sanction.escalationReview ? " · 추가 조치 검토" : ""}`
                      : "없음"}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSelected(entry.id)
                        setNote("")
                        setIntentional(false)
                        setMessage("")
                      }}
                    >
                      검토
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">기록된 사건이 없습니다.</p>
      )}
      {item && (
        <div className="grid gap-3 rounded-xl bg-muted p-4 text-xs">
          <p>
            {item.id} · 기준 {item.policyVersion} · 접수 {time(item.createdAt)}
          </p>
          {item.interruption && (
            <p>
              중단 요청자 미제공 DAY 산정 {money(item.interruption.actorRefund)} ·{" "}
              {item.interruption.actorRefundBasis}
              {item.interruption.introductionBenefitEnds && " · 실제 시작 후 중단: 초기 소개 혜택 종료"}
            </p>
          )}
          {item.reconsideration && <p>재검토 요청 {time(item.reconsideration.at)} · {item.reconsideration.note}</p>}
          {item.adminLog.map((log, index) => (
            <p key={index}>
              {time(log.at)} · {log.actor} · {log.action} · {log.note}
            </p>
          ))}
          <Textarea
            aria-label="운영 확인 내용"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="확인한 사실과 결정 · 개인정보·연락처 제외"
          />
          {item.kind === "no-show" && (
            <Label className="flex items-center gap-3">
              <Checkbox checked={intentional} onCheckedChange={(value) => setIntentional(value === true)} />
              고의성이 확인됨 (30일 이상·이용 종료는 별도 검토 대상으로만 표시)
            </Label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => decide("confirmed")}>
              사실 확인
            </Button>
            <Button size="sm" variant="outline" onClick={() => decide("dismissed")}>
              확인되지 않음
            </Button>
            {item.kind === "cancellation" && (
              <Button size="sm" variant="outline" onClick={() => decide("excused")}>
                불가피 사유 확인 · 불이익 없음
              </Button>
            )}
            {item.sanction && item.sanction.status !== "lifted" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setMessage(liftSanction(item.id, note, now) || "이용 제한 해제를 기록했어요.")
                }
              >
                이용 제한 해제
              </Button>
            )}
          </div>
          <p role="status" className="text-primary">
            {message}
          </p>
        </div>
      )}
    </section>
  )
}

const MEMBERS = ["demo-member-a", "demo-member-b"] as const
const NAMES: Record<string, string> = { "demo-member-a": "가", "demo-member-b": "나" }
const DAY_FIXTURES = [
  ["both-paid", "양쪽 결제 · DAY01 전"],
  ["started", "DAY01 실제 개시"],
  ["day02", "DAY02 실제 개시"],
  ["day03", "DAY03 실제 개시"],
] as const

export function ConductDemo() {
  const [clock, setClock] = useState("2026-10-20T15:00")
  const now = useMemo(() => new Date(`${clock}:00+09:00`), [clock])
  const [actor, setActor] = useState<string>(MEMBERS[0])
  const partner = MEMBERS.find((id) => id !== actor)!
  const [progress, setProgress] = useState<string>("started")
  const [reason, setReason] = useState<InterruptionReason>("self-change")
  const [meetingAt, setMeetingAt] = useState("2026-10-21T14:00")
  const [excuse, setExcuse] = useState<ExcuseReason | "none">("none")
  const [choice, setChoice] = useState<"reschedule" | "end">("reschedule")
  const [noContact, setNoContact] = useState(false)
  const [ended, setEnded] = useState(true)
  const [lastReview, setLastReview] = useState("2026-06-01T12:00")
  const [message, setMessage] = useState("")
  const meetingStartAt = `${meetingAt}:00+09:00`
  const session = useMemo(() => makePaymentFixture(progress, now), [progress, now])
  const outcome = interruptionOutcome(session, reason, now)
  const cancel = classifyCancellation(meetingStartAt, now.toISOString(), excuse === "none" ? null : excuse)
  const noShowBlocked = noShowReportGate(meetingStartAt, now, "virtual-appointment-1", partner)
  const reusePayment = useMemo(() => makePaymentFixture("started", new Date(now.getTime() - 5 * 86400000)), [now])
  return (
    <main className="mx-auto max-w-5xl space-y-8 px-5 py-8">
      <section className="space-y-4 border border-accent/20 bg-accent/5 p-5">
        <h1 className="text-lg text-accent">개발용 · 교류 중단·약속 취소·노쇼·재이용</h1>
        <p className="text-xs leading-6">
          가상 회원 가·나와 가상 시각으로 {CONDUCT_POLICY.version} 기준을 시연합니다.
          실제 결제·환불·정지·발송은 하지 않으며 새로고침하면 기록이 사라집니다.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="max-w-64"
            aria-label="가상 시각"
            type="datetime-local"
            value={clock}
            onChange={(event) => setClock(event.target.value)}
          />
          <Select value={actor} onValueChange={setActor}>
            <SelectTrigger className="w-40" aria-label="행동하는 회원">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMBERS.map((id) => (
                <SelectItem key={id} value={id}>
                  행동 회원 · {NAMES[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => { resetConductDemo(); setMessage("가상 기록을 비웠어요.") }}>
            기록 비우기
          </Button>
        </div>
      </section>
      <Tabs defaultValue="interruption">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="interruption">교류 중단</TabsTrigger>
          <TabsTrigger value="cancellation">약속 취소</TabsTrigger>
          <TabsTrigger value="no-show">노쇼</TabsTrigger>
          <TabsTrigger value="reuse">재이용</TabsTrigger>
        </TabsList>
        <TabsContent value="interruption" className="space-y-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={progress} onValueChange={setProgress}>
              <SelectTrigger aria-label="교류 진행 상태">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_FIXTURES.map(([id, label]) => (
                  <SelectItem key={id} value={id}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={reason} onValueChange={(value) => setReason(value as InterruptionReason)}>
              <SelectTrigger aria-label="중단 사유">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(INTERRUPTION_REASONS).map(([id, label]) => (
                  <SelectItem key={id} value={id}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 rounded-xl bg-muted p-4 text-sm leading-7">
            <p>{NAMES[actor]}의 미제공 DAY 환불 산정: {money(outcome.refundAmount)} · {outcome.refundBasis}</p>
            <p>초기 소개 혜택: {outcome.introductionBenefitEnds ? "실제 시작 후 중단이라 종료" : "아직 실제 시작 전이라 유지"}</p>
            {reason === "self-change" && <p>상대 {NAMES[partner]}: 중도 이탈 피해 · 미제공 DAY 환불과 다음 소개비 5,000원 면제</p>}
            {outcome.feeWaiver && <p>{NAMES[actor]}: {outcome.feeWaiver}</p>}
            {outcome.review && <p className="text-primary">{outcome.review}</p>}
          </div>
          <Button
            onClick={() => {
              const result = recordInterruption({ programId: `virtual-program-${progress}`, actorId: actor, partnerId: partner, reason, session, partnerSession: session }, now)
              setMessage(result.error || "교류 중단을 가상으로 기록했어요.")
            }}
          >
            {NAMES[actor]} · 교류 중단 기록
          </Button>
        </TabsContent>
        <TabsContent value="cancellation" className="space-y-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Label className="space-y-2 text-xs">
              약속 시작 시각
              <Input type="datetime-local" value={meetingAt} onChange={(event) => setMeetingAt(event.target.value)} />
            </Label>
            <Label className="space-y-2 text-xs">
              불가피 사유 · 선택
              <Select value={excuse} onValueChange={(value) => setExcuse(value as ExcuseReason | "none")}>
                <SelectTrigger aria-label="불가피 사유">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">해당 없음</SelectItem>
                  {Object.entries(EXCUSE_REASONS).map(([id, label]) => (
                    <SelectItem key={id} value={id}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            <Label className="space-y-2 text-xs">
              24시간 이전 취소 후
              <Select value={choice} onValueChange={(value) => setChoice(value as "reschedule" | "end")}>
                <SelectTrigger aria-label="취소 후 선택">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reschedule">재조율</SelectItem>
                  <SelectItem value="end">종료</SelectItem>
                </SelectContent>
              </Select>
            </Label>
          </div>
          <p className="rounded-xl bg-muted p-4 text-sm">
            {cancel.error ? cancel.error : `${Math.round(cancel.hoursBefore * 10) / 10}시간 전 취소 · ${cancel.label}`}
          </p>
          <Button
            disabled={!!cancel.error}
            onClick={() => {
              const result = recordCancellation({ programId: "virtual-program-meeting", appointmentId: "virtual-appointment-1", cancellerId: actor, partnerId: partner, meetingStartAt, excuse: excuse === "none" ? null : excuse, choice }, now)
              setMessage(result.error || "약속 취소를 가상으로 기록했어요.")
            }}
          >
            {NAMES[actor]} · 약속 취소
          </Button>
        </TabsContent>
        <TabsContent value="no-show" className="space-y-4 pt-4">
          <p className="text-sm leading-7">
            {NAMES[actor]}가 {NAMES[partner]}의 불참을 신고합니다. 약속 시작 시각은 약속 취소 탭과 같은 값을 씁니다.
          </p>
          <Label className="flex items-center gap-3 text-sm">
            <Checkbox checked={noContact} onCheckedChange={(value) => setNoContact(value === true)} />
            사전 취소나 연락 없이 불참했어요.
          </Label>
          {noShowBlocked && <p className="text-sm text-muted-foreground">{noShowBlocked}</p>}
          <Button
            disabled={!!noShowBlocked}
            onClick={() => {
              const result = reportNoShow({ programId: "virtual-program-meeting", appointmentId: "virtual-appointment-1", reporterId: actor, accusedId: partner, meetingStartAt, noContactConfirmed: noContact }, now)
              setMessage(result.error || "노쇼 신고를 접수했어요. 운영자가 사실을 확인합니다.")
            }}
          >
            {NAMES[actor]} · 노쇼 신고
          </Button>
        </TabsContent>
        <TabsContent value="reuse" className="space-y-4 pt-4">
          <Label className="flex items-center gap-3 text-sm">
            <Checkbox checked={ended} onCheckedChange={(value) => setEnded(value === true)} />
            이전 교류가 정상 종료됨
          </Label>
          <Label className="block max-w-xs space-y-2 text-xs">
            마지막 프로필 검토 시각
            <Input type="datetime-local" value={lastReview} onChange={(event) => setLastReview(event.target.value)} />
          </Label>
          <p className="text-xs text-muted-foreground">
            재이용은 아래 회원별 보기에서 확인합니다. 첫 교류가 실제로 시작된 가상 결제 기록을 사용합니다.
          </p>
        </TabsContent>
      </Tabs>
      <p role="status" className="text-sm text-primary">
        {message}
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        {MEMBERS.map((id) => (
          <section key={id} className="space-y-3 rounded-xl border border-border p-5">
            <h2 className="text-lg">{NAMES[id]}에게 보이는 화면</h2>
            <MemberConductSummary
              memberId={id}
              payment={reusePayment}
              now={now}
              programEnded={ended}
              lastReviewAt={lastReview ? `${lastReview}:00+09:00` : null}
            />
          </section>
        ))}
      </div>
      <AdminConductCases now={now} />
      <ConductPolicyNotice />
      <Button asChild variant="ghost" size="sm">
        <Link to="/admin/safety">관리자 신고·안전 화면</Link>
      </Button>
    </main>
  )
}
