import { kstDateTime, kstDay } from "./dates"
import { useMemo, useState } from "react"
import { Archive, DoorOpen, FileLock2 } from "lucide-react"
import { Button } from "./components/ui/button"
import { Checkbox } from "./components/ui/checkbox"
import { Input } from "./components/ui/input"
import { Label } from "./components/ui/label"
import { Textarea } from "./components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select"
import { makePaymentFixture } from "./payment-model"
import { useConsoleData } from "./admin-console-data"
import {
  REQUEST_STATUSES,
  decideMemberRequest,
  submitMemberRequest,
  useOwnMemberAccount,
  type RequestContext,
} from "./member-operations-model"
import {
  DATA_REQUEST_LABELS,
  DATA_RESULT_LABELS,
  DATA_SCOPES,
  EVIDENCE_ITEMS,
  LEGAL_SEPARATION,
  PRIVACY_POLICY,
  RETENTION_ITEMS,
  closeEvidence,
  contactDisplayWindow,
  dataRequestExceptions,
  preserveEvidence,
  recordDataRequest,
  recordDataRequestResult,
  recordWithdrawal,
  resetPrivacyDemo,
  retentionSchedule,
  usePrivacyState,
  withdrawalPreview,
  type DataInventory,
  type DataRequestKind,
  type LegalHold,
  type WithdrawalInput,
} from "./privacy-policy"

const time = (at: string | null) =>
  at ? kstDateTime(at) : "기한 없음"
const date = (at: string | null) =>
  at ? kstDay(at) : "종결 후 산정"
const money = (value: number | null) =>
  value === null ? "개별 확인 필요" : `${value.toLocaleString("ko-KR")}원`
const BASIS = { service: "서비스 이용", internal: "운영·보안", legal: "법정 보존" } as const
const DRAFT_NOTICE = `${PRIVACY_POLICY.version} · 보유기간 정책 초안이며 실제 법률 검토 완료를 뜻하지 않아요. 가상 자료로 시연하며 실제 삭제·백업 파기를 실행했다고 표시하지 않아요.`

function LegalHoldList({ holds }: { holds: LegalHold[] }) {
  if (!holds.length) return <p className="text-xs text-muted-foreground">별도 보존할 법정 기록이 확인되지 않았어요.</p>
  return (
    <ul className="space-y-1 text-xs leading-6">
      {holds.map((hold) => (
        <li key={hold.label}>
          {hold.label} · {hold.reason} · {hold.until ? `${date(hold.until)}까지` : "종결 후 기간 산정"}
        </li>
      ))}
    </ul>
  )
}

export function RetentionPolicyTable() {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2">자료</th>
              <th>보유·삭제</th>
              <th>구분</th>
            </tr>
          </thead>
          <tbody>
            {RETENTION_ITEMS.map((item) => (
              <tr key={item.id} className="border-b border-border align-top">
                <td className="py-2 pr-3">{item.data}</td>
                <td className="pr-3">{item.period}</td>
                <td>{BASIS[item.basis]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-6">{LEGAL_SEPARATION}</p>
      <p className="text-xs leading-6 text-muted-foreground">{DRAFT_NOTICE}</p>
    </div>
  )
}

export function MyDataSchedule({ inventory, now }: { inventory: DataInventory; now: Date }) {
  const state = usePrivacyState()
  const withdrawal = state.withdrawals.find((item) => item.memberId === inventory.memberId) || null
  const rows = retentionSchedule(inventory, now, withdrawal)
  const holds = withdrawal?.legal || []
  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-1 gap-1 rounded-xl bg-muted p-3 text-xs sm:grid-cols-3">
            <span>{row.data}</span>
            <span>{row.state}</span>
            <span className="text-muted-foreground">{row.until ? time(row.until) : "—"}</span>
          </div>
        ))}
      </div>
      {withdrawal && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <p className="text-xs font-semibold">별도 보존 · 일반 자료와 분리</p>
          <LegalHoldList holds={holds} />
        </div>
      )}
    </div>
  )
}

export function WithdrawalPanel({
  input,
  context,
  onApplied,
}: {
  input: WithdrawalInput
  context: RequestContext
  onApplied?: () => void
}) {
  const state = usePrivacyState()
  const record = state.withdrawals.find((item) => item.memberId === input.memberId)
  const preview = withdrawalPreview(input, state.evidence)
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState("")
  if (record)
    return (
      <div className="space-y-3 text-sm leading-7">
        <p className="text-primary">탈퇴 요청 접수 · {time(record.requestedAt)}</p>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-6">
          {record.immediate.map((line) => (
            <li key={line}>{line} · 요청 즉시 적용(가상)</li>
          ))}
          <li>프로필·사진·편지 등 일반 자료 · 활성 시스템 삭제 예정 {time(record.activeDeleteBy)}</li>
          <li>백업 · 순차 삭제 예정 {time(record.backupDeleteBy)}</li>
        </ul>
        {record.refunds.map((refund) => (
          <p key={refund.kind} className="text-xs">
            {refund.label} 환불·취소 요청 생성 · {money(refund.amount)} · {refund.basis} · 환불 완료 아님
          </p>
        ))}
        <LegalHoldList holds={record.legal} />
        <p className="text-xs text-muted-foreground">
          가상 데모예요. 삭제 예정 시각만 기록했으며 실제 삭제·백업 파기는 실행하지 않았어요.
        </p>
      </div>
    )
  return (
    <div className="space-y-4 text-sm leading-7">
      {preview.ends.length ? (
        <div className="space-y-1">
          <p className="font-semibold">탈퇴하면 함께 종료돼요</p>
          <ul className="list-disc pl-5 text-xs leading-6">
            {preview.ends.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs">진행 중인 소개·교류·약속이 없어요.</p>
      )}
      {preview.refunds.length > 0 && (
        <div className="space-y-1">
          <p className="font-semibold">함께 만들어지는 환불·취소 요청</p>
          {preview.refunds.map((refund) => (
            <p key={refund.kind} className="text-xs">
              {refund.label} · {money(refund.amount)} · {refund.basis}
            </p>
          ))}
        </div>
      )}
      <div className="space-y-1">
        <p className="font-semibold">요청 즉시</p>
        <ul className="list-disc pl-5 text-xs leading-6">
          {preview.immediate.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-xs">
          일반 자료는 {PRIVACY_POLICY.activeDeleteDays}일 이내 활성 시스템에서, 백업은 최대{" "}
          {PRIVACY_POLICY.backupMaxDays}일 이내 순차 삭제해요.
        </p>
      </div>
      <div className="space-y-1">
        <p className="font-semibold">삭제하지 않고 따로 보관하는 법정 기록</p>
        <LegalHoldList holds={preview.legal} />
      </div>
      <Label className="flex items-start gap-3 text-xs leading-6">
        <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
        종료되는 내용과 삭제·보존 일정을 확인했어요. 탈퇴를 요청해요.
      </Label>
      <Button
        variant="destructive"
        disabled={!confirmed}
        onClick={() => {
          const result = submitMemberRequest(context, "withdrawal", { confirmed: true }, input.now)
          if (result.error) return setMessage(result.error)
          recordWithdrawal(input, result.id)
          setMessage("탈퇴 요청을 기록했어요. 노출·접근·연락처 예약·알림을 멈췄어요(가상).")
          onApplied?.()
        }}
      >
        회원 탈퇴 요청
      </Button>
      <p role="status" className="text-xs text-primary">
        {message}
      </p>
    </div>
  )
}

export function DataRightsPanel({
  context,
  inventory,
  now,
}: {
  context: RequestContext
  inventory: DataInventory
  now: Date
}) {
  const state = usePrivacyState()
  const account = useOwnMemberAccount(context.memberId)
  const [kind, setKind] = useState<DataRequestKind>("correction")
  const [scope, setScope] = useState<string[]>([])
  const [body, setBody] = useState("")
  const [message, setMessage] = useState("")
  const exceptions = dataRequestExceptions(kind, scope, inventory, state.evidence)
  const own = state.dataRequests.filter((item) => item.memberId === context.memberId)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(DATA_REQUEST_LABELS) as DataRequestKind[]).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={kind === value ? "default" : "outline"}
            onClick={() => setKind(value)}
          >
            {DATA_REQUEST_LABELS[value]} 요청
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {DATA_SCOPES.map((item) => (
          <Label key={item} className="flex items-center gap-3 text-xs">
            <Checkbox
              checked={scope.includes(item)}
              onCheckedChange={(value) =>
                setScope((current) => (value === true ? [...current, item] : current.filter((entry) => entry !== item)))
              }
            />
            {item}
          </Label>
        ))}
      </div>
      <Textarea
        aria-label="요청 내용"
        maxLength={500}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={kind === "correction" ? "바로잡을 내용 · 연락처·신분 자료 제외" : "요청 이유 · 선택"}
        className="min-h-20 bg-background"
      />
      {exceptions.length > 0 && (
        <div className="space-y-1 rounded-xl border border-border p-3">
          <p className="text-xs font-semibold">처리할 수 없는 법정 보존 정보 · 사유와 기간</p>
          <LegalHoldList holds={exceptions} />
        </div>
      )}
      {kind === "correction" && scope.includes("결제·환불 기록") && (
        <p className="text-xs text-muted-foreground">결제 기록 원본은 바꾸지 않고 정정 사실을 별도로 기록해요.</p>
      )}
      <Button
        size="sm"
        disabled={!scope.length}
        onClick={() => {
          const result = submitMemberRequest(context, kind, { description: body, confirmed: true }, now)
          if (result.error) return setMessage(result.error)
          setMessage(
            recordDataRequest({ requestId: result.id!, memberId: context.memberId, kind, scope, inventory, now }) ||
              "요청을 기록했어요. 처리 결과는 운영자가 기록하면 여기에서 확인할 수 있어요.",
          )
          setScope([])
          setBody("")
        }}
      >
        {DATA_REQUEST_LABELS[kind]} 요청 기록
      </Button>
      <p role="status" className="text-xs text-primary">
        {message}
      </p>
      {own.map((item) => {
        const request = account?.requests.find((entry) => entry.id === item.requestId)
        return (
          <div key={item.requestId} className="space-y-1 rounded-xl bg-muted p-3 text-xs leading-6">
            <p>
              {DATA_REQUEST_LABELS[item.kind]} 요청 · {item.scope.join(", ")} · {time(item.at)}
            </p>
            <p>
              처리 결과:{" "}
              {item.result
                ? `${DATA_RESULT_LABELS[item.result.status]} · ${item.result.note} · ${time(item.result.at)}`
                : request
                  ? REQUEST_STATUSES[request.status]
                  : "접수"}
            </p>
            {item.exceptions.length > 0 && <LegalHoldList holds={item.exceptions} />}
          </div>
        )
      })}
    </div>
  )
}

export function AdminPrivacyQueue({ now }: { now?: Date } = {}) {
  const state = usePrivacyState()
  const consoleData = useConsoleData()
  const [selected, setSelected] = useState("")
  const [status, setStatus] = useState<"processed" | "partial" | "declined">("partial")
  const [note, setNote] = useState("")
  const [reportId, setReportId] = useState("")
  const [items, setItems] = useState<string[]>([])
  const [reason, setReason] = useState("")
  const [message, setMessage] = useState("")
  const request = state.dataRequests.find((item) => item.requestId === selected)
  return (
    <section className="mt-7 space-y-5 border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <FileLock2 className="size-4 text-primary" />
        <h2 className="text-lg">개인정보 요청·탈퇴·증거 보존 · {PRIVACY_POLICY.version}</h2>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">{DRAFT_NOTICE}</p>
      <div className="space-y-2">
        <h3 className="text-sm">탈퇴 요청</h3>
        {state.withdrawals.length ? (
          state.withdrawals.map((item) => (
            <p key={item.id} className="text-xs leading-6">
              {item.memberId} · 접수 {time(item.requestedAt)} · 활성 삭제 예정 {time(item.activeDeleteBy)} · 백업{" "}
              {time(item.backupDeleteBy)} · 법정 보존 {item.legal.length}건 분리 · 실제 삭제 미실행
            </p>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">탈퇴 요청이 없어요.</p>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm">정정·삭제·처리정지 요청</h3>
        {state.dataRequests.length ? (
          state.dataRequests.map((item) => (
            <div key={item.requestId} className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span>
                {item.memberId} · {DATA_REQUEST_LABELS[item.kind]} · {item.scope.join(", ")} · 법정 예외{" "}
                {item.exceptions.length}건 · {item.result ? DATA_RESULT_LABELS[item.result.status] : "결과 미기록"}
              </span>
              <Button size="sm" variant="ghost" onClick={() => { setSelected(item.requestId); setNote(""); setStatus(item.exceptions.length ? "partial" : "processed") }}>
                결과 기록
              </Button>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">접수된 요청이 없어요.</p>
        )}
        {request && (
          <div className="grid gap-3 rounded-xl bg-muted p-4 text-xs">
            {request.exceptions.length > 0 && <LegalHoldList holds={request.exceptions} />}
            <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
              <SelectTrigger aria-label="처리 결과">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DATA_RESULT_LABELS).map(([id, label]) => (
                  <SelectItem key={id} value={id}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea aria-label="처리 결과 안내" maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} placeholder="회원에게 안내할 처리 결과 · 개인정보 제외" />
            <Button
              size="sm"
              onClick={() => {
                const error = recordDataRequestResult(request.requestId, status, note, now)
                if (!error) decideMemberRequest(request.requestId, "decided", note, now)
                setMessage(error || "처리 결과를 기록했어요. 실제 삭제·변경은 서버 연동이 필요해요.")
              }}
            >
              처리 결과 저장
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm">
          <Archive className="size-4" />
          신고 증거 분리 보존 · 필요한 자료만
        </h3>
        <p className="text-xs leading-6 text-muted-foreground">
          신고를 이유로 사진·편지 전체를 오래 보관하지 않아요. 분쟁에 필요한 항목만 최대 3개 고르며, 사건 종결 후 기본 3년 보존해요.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select value={reportId} onValueChange={setReportId}>
            <SelectTrigger aria-label="신고 선택">
              <SelectValue placeholder="신고 선택" />
            </SelectTrigger>
            <SelectContent>
              {consoleData.reports.map((report) => (
                <SelectItem key={report.id} value={report.id}>
                  {report.id} · {report.type || "기타"}
                </SelectItem>
              ))}
              <SelectItem value="virtual-report-1">virtual-report-1 · 가상 예시</SelectItem>
            </SelectContent>
          </Select>
          <Input aria-label="보존 사유" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="보존 사유 · 개인정보 제외" />
        </div>
        <div className="flex flex-wrap gap-3">
          {EVIDENCE_ITEMS.map((item) => (
            <Label key={item} className="flex items-center gap-2 text-xs">
              <Checkbox checked={items.includes(item)} onCheckedChange={(value) => setItems((current) => (value === true ? [...current, item] : current.filter((entry) => entry !== item)))} />
              {item}
            </Label>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const report = consoleData.reports.find((entry) => entry.id === reportId)
            const members = report ? [report.reporterId, report.targetId || report.memberId].filter(Boolean) as string[] : ["demo-member-a", "demo-member-b"]
            const error = preserveEvidence({ reportId, memberIds: members, items, note: reason }, now)
            setMessage(error || "필요한 자료만 증거로 분리했어요. 나머지는 일반 보유기간을 따라요.")
            if (!error) { setItems([]); setReason("") }
          }}
        >
          증거로 분리 보존
        </Button>
        {state.evidence.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>
              {item.reportId} · {item.items.join(", ")} · {item.closedAt ? `종결 · ${date(item.until)}까지 보존` : "사건 진행 중"}
            </span>
            {!item.closedAt && (
              <Button size="sm" variant="ghost" onClick={() => setMessage(closeEvidence(item.id, now) || "사건 종결을 기록했어요. 3년 뒤 파기 검토 대상이에요.")}>
                사건 종결
              </Button>
            )}
          </div>
        ))}
      </div>
      <p role="status" className="text-xs text-primary">
        {message}
      </p>
    </section>
  )
}

const DEMO_MEMBER = "demo-privacy-member"
export function PrivacyDemo() {
  const [clock, setClock] = useState("2026-10-20T15:00")
  const now = useMemo(() => new Date(`${clock}:00+09:00`), [clock])
  const [exchange, setExchange] = useState<"started" | "none">("started")
  const [appointment, setAppointment] = useState(true)
  const [contact, setContact] = useState(true)
  const [meetingDate, setMeetingDate] = useState("2026-10-24")
  const [reported, setReported] = useState(false)
  const payment = useMemo(() => makePaymentFixture(exchange === "started" ? "started" : "intro-unopened", new Date(now.getTime() - 86400000)), [exchange, now])
  const inventory: DataInventory = {
    memberId: DEMO_MEMBER,
    photoCount: 3,
    exchangeActive: exchange === "started",
    exchangeEndedAt: exchange === "started" ? null : "2026-09-10T21:00:00+09:00",
    meetingDate: appointment ? meetingDate : null,
    payments: [payment.introduction, payment.exchange].filter(Boolean).map((receipt) => ({ id: receipt!.id, at: receipt!.confirmedAt! })),
    complaints: reported ? [{ id: "virtual-complaint-1", closedAt: null }] : [],
    safetyReports: [],
    advertisingAt: null,
    litigationHold: false,
  }
  const input: WithdrawalInput = { memberId: DEMO_MEMBER, payment, introductionActive: false, exchangeStatus: exchange === "started" ? "started" : null, appointmentActive: appointment, contactScheduled: appointment && contact, inventory, now }
  const context = { memberId: DEMO_MEMBER, targetId: "demo-privacy-partner", programId: "virtual-program-1", surface: "개인정보 데모" }
  const window = contactDisplayWindow(meetingDate)
  return (
    <main className="mx-auto max-w-5xl space-y-8 px-5 py-8">
      <section className="space-y-4 border border-accent/20 bg-accent/5 p-5">
        <h1 className="text-lg text-accent">개발용 · 개인정보 보유·삭제·탈퇴</h1>
        <p className="text-xs leading-6">{DRAFT_NOTICE}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Label className="flex-col items-stretch gap-2 text-xs">
            가상 시각
            <Input type="datetime-local" value={clock} onChange={(event) => setClock(event.target.value)} />
          </Label>
          <Label className="flex-col items-stretch gap-2 text-xs">
            약속일
            <Input type="date" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} />
          </Label>
          <Label className="flex-col items-stretch gap-2 text-xs">
            교류 상태
            <Select value={exchange} onValueChange={(value) => setExchange(value as "started" | "none")}>
              <SelectTrigger aria-label="교류 상태">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="started">A/B 교류 진행 중 · DAY01 개시</SelectItem>
                <SelectItem value="none">진행 중 교류 없음 · 9월 종료</SelectItem>
              </SelectContent>
            </Select>
          </Label>
        </div>
        <div className="flex flex-wrap gap-5">
          <Label className="flex items-center gap-2 text-xs"><Checkbox checked={appointment} onCheckedChange={(value) => setAppointment(value === true)} />약속 있음</Label>
          <Label className="flex items-center gap-2 text-xs"><Checkbox checked={contact} onCheckedChange={(value) => setContact(value === true)} />미공개 연락처 예약 있음</Label>
          <Label className="flex items-center gap-2 text-xs"><Checkbox checked={reported} onCheckedChange={(value) => setReported(value === true)} />처리 중인 분쟁 기록 있음</Label>
          <Button size="sm" variant="outline" onClick={resetPrivacyDemo}>기록 비우기</Button>
        </div>
        {window && (
          <p className="text-xs">
            연락처 표시 창 · {time(window.from)} ~ {time(window.until)} ·{" "}
            {now.getTime() < Date.parse(window.from) ? "표시 전" : now.getTime() <= Date.parse(window.until) ? "지금 표시 가능" : "표시 종료"}
          </p>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl">보유 기준</h2>
        <RetentionPolicyTable />
      </section>
      <section className="space-y-3">
        <h2 className="text-xl">이 가상 회원의 자료 일정</h2>
        <MyDataSchedule inventory={inventory} now={now} />
      </section>
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-xl"><DoorOpen className="size-5 text-primary" />회원 탈퇴</h2>
        <WithdrawalPanel input={input} context={context} />
      </section>
      <section className="space-y-3">
        <h2 className="text-xl">정정·삭제·처리정지</h2>
        <DataRightsPanel context={context} inventory={inventory} now={now} />
      </section>
      <AdminPrivacyQueue now={now} />
    </main>
  )
}
