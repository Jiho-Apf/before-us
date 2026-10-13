import { useState } from "react"
import { Link } from "react-router"
import { ShieldAlert, ArrowUpRight, LifeBuoy } from "lucide-react"
import { Button } from "./components/ui/button"
import { Checkbox } from "./components/ui/checkbox"
import { Label } from "./components/ui/label"
import { Textarea } from "./components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select"
import { REPORT_TYPES } from "./admin-governance-model"
import {
  REQUEST_LABELS,
  REQUEST_STATUSES,
  submitMemberRequest,
  decideMemberRequest,
  useMemberOperations,
  type MemberRequestKind,
  type RequestStatus,
  type RequestContext,
} from "./member-operations-model"

export function MemberRequestForm({
  context,
  kind = "inquiry",
  now,
  onApplied,
  receiptKind,
  parentId,
}: {
  context: RequestContext
  kind?: MemberRequestKind
  now?: Date
  onApplied?: () => void
  receiptKind?: "introduction" | "exchange"
  parentId?: string
}) {
  const [body, setBody] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [urgent, setUrgent] = useState(false)
  const [reportType, setReportType] = useState("기타")
  const [message, setMessage] = useState("")
  return (
    <div className="space-y-4">
      <h3 className="text-lg">{REQUEST_LABELS[kind]}</h3>
      {kind === "report" && (
        <>
          <Select value={reportType} onValueChange={setReportType}>
            <SelectTrigger aria-label="신고 유형">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label className="flex items-center gap-3">
            <Checkbox
              checked={urgent}
              onCheckedChange={(value) => setUrgent(value === true)}
            />
            긴급 보호 검토가 필요해요
          </Label>
          <p className="text-xs leading-6 text-muted-foreground">
            현실의 긴급 위험에는 지역 긴급 신고·지원 기관을 이용해 주세요. 이
            데모는 긴급 접수·실제 보호 조치를 제공하지 않습니다.
          </p>
          <p className="text-xs leading-6 text-muted-foreground">
            노쇼·약속 취소·연락처 악용은 별도 유형으로 기록합니다. 접수만으로 약속 취소 완료·자동 차단·환불을 확정하지 않습니다. 노쇼는 약속 시작 30분 뒤부터 신고할 수 있고 운영자가 사실을 확인합니다(V6-conduct-01). 상대에게 신고 사유를 자세히 공개하지 않습니다.
          </p>
        </>
      )}
      <Label className="block space-y-2 text-sm">
        가상 상황 설명 · 선택
        <Textarea
          aria-label="가상 요청 설명"
          maxLength={500}
          value={body}
          onChange={(event) => {
            setBody(event.target.value)
            setConfirmed(false)
          }}
          placeholder="가상 사례만 작성해 주세요. 연락처·사진·신분 자료·상대 편지 원문은 넣지 않습니다."
          className="min-h-28 bg-background leading-7"
        />
      </Label>
      <p className="text-xs text-muted-foreground">
        {body.length}/500 · 실제 첨부·발송·개인정보 수집 없음
      </p>
      <Label className="flex items-start gap-3 text-xs leading-6">
        <Checkbox
          checked={confirmed}
          onCheckedChange={(value) => setConfirmed(value === true)}
        />
        가상 요청 접수임을 확인했어요. 결정·환불·삭제·재개 완료가 아니며, 미확정
        정책은 운영자 확인이 필요해요.
      </Label>
      <Button
        disabled={!confirmed}
        onClick={() => {
          const result = submitMemberRequest(
            context,
            kind,
            {
              description: body,
              confirmed,
              urgent,
              reportType,
              receiptKind,
              parentId,
            },
            now,
          )
          setMessage(
            result.error ||
              "가상 요청을 기록했어요. 운영 확인·결정과 실제 실행은 별도입니다.",
          )
          if (!result.error) {
            setConfirmed(false)
            setBody("")
            onApplied?.()
          }
        }}
      >
        요청 기록하기
      </Button>
      <p role="status" className="text-sm text-primary">
        {message}
      </p>
    </div>
  )
}

export function MemberSafetyTools({
  context,
  now,
  onProtect,
}: {
  context: RequestContext
  now?: Date
  onProtect?: (kind: "block" | "interrupt") => string | null
}) {
  const [mode, setMode] = useState<MemberRequestKind | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [message, setMessage] = useState("")
  return (
    <section
      aria-label="문의·신고·진행 보호"
      className="mt-8 space-y-5 border-t border-border pt-6"
    >
      <div className="flex items-center gap-2 text-sm">
        <ShieldAlert className="size-4 text-accent" />
        필요한 순간, 진행을 멈출 수 있어요.
      </div>
      <div className="flex flex-wrap gap-2">
        {(["inquiry", "report", "block", "interrupt"] as const).map((kind) => (
          <Button
            key={kind}
            variant="outline"
            size="sm"
            onClick={() => {
              setMode(kind)
              setConfirm(false)
              setMessage("")
            }}
          >
            {REQUEST_LABELS[kind]}
          </Button>
        ))}
      </div>
      {mode && !["block", "interrupt"].includes(mode) && (
        <MemberRequestForm key={mode} context={context} kind={mode} now={now} />
      )}
      {mode && ["block", "interrupt"].includes(mode) && (
        <div className="space-y-4 rounded-xl bg-muted p-5">
          <p className="text-sm leading-7">
            새 전달과 진행을 멈춥니다. 과거 기록 열람·증거 보존·삭제는 고지할
            정책과 별도 권한으로 검토합니다. 이미 본 내용까지 회수하지 않습니다.
          </p>
          <Label className="flex items-center gap-3 text-xs">
            <Checkbox
              checked={confirm}
              onCheckedChange={(value) => setConfirm(value === true)}
            />
            내가 진행 보호를 요청하는 것을 확인했어요.
          </Label>
          <Button
            disabled={!confirm || !onProtect}
            onClick={() => {
              const error = onProtect?.(mode as "block" | "interrupt")
              if (error) {
                setMessage(error)
                return
              }
              const result = submitMemberRequest(
                context,
                mode,
                { confirmed: true },
                now,
              )
              setMessage(
                result.error ||
                  "가상 새 전달·진행을 중지했어요. 소개 권리·환불·기록 보유는 별도 처리합니다.",
              )
              setConfirm(false)
            }}
          >
            확인하고 진행 멈추기
          </Button>
          {!onProtect && (
            <p className="text-xs text-muted-foreground">
              현재 연결된 상대·교류가 없어 직접 중지할 진행이 없습니다.
              문의·신고는 접수할 수 있어요.
            </p>
          )}
        </div>
      )}
      <p role="status" className="text-xs text-primary">
        {message}
      </p>
      <p className="text-xs leading-6 text-muted-foreground">
        신고 건수로 자동 차단·공개 낙인·외모나 인성 점수를 만들지 않습니다. 보호
        확인 → 사실 확인 → 결정 기록 → 재검토 요청을 구분합니다.
      </p>
    </section>
  )
}

export function AdminMemberRequests() {
  const state = useMemberOperations(),
    requests = Object.values(state.accounts).flatMap(
      (account) => account.requests,
    )
  const [selected, setSelected] = useState("")
  const [status, setStatus] = useState<RequestStatus>("checking")
  const [note, setNote] = useState("")
  const [message, setMessage] = useState("")
  return (
    <section className="mt-7 space-y-4 border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <LifeBuoy className="size-4 text-primary" />
        <h2 className="text-lg">회원 요청 · 운영 예외</h2>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        가상 Owner 전용 · 실제 관리자 권한 미구현. 보호 확인·사실
        확인·결정·재검토 기록만 추가하며 환불·삭제·재개나 당사자 결정을 대행하지
        않습니다.
      </p>
      {requests.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="py-3">회원 · 요청</th>
                <th>상태</th>
                <th>접수 시각</th>
                <th>검토</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((item) => (
                <tr key={item.id} className="border-b border-border">
                  <td className="py-3">
                    {item.memberId} · {REQUEST_LABELS[item.kind]}
                    {item.urgent && (
                      <span className="ml-2 text-destructive">긴급</span>
                    )}
                  </td>
                  <td>{REQUEST_STATUSES[item.status]}</td>
                  <td>
                    {new Date(item.at).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelected(item.id)
                        setNote("")
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
        <p className="text-sm text-muted-foreground">
          접수된 회원 요청이 없습니다.
        </p>
      )}
      {selected && (
        <div className="grid gap-3 rounded-xl bg-muted p-4">
          <p className="text-xs">
            선택된 내부 요청 ID · {selected} · 원문은 이 목록에 노출하지
            않습니다.
          </p>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as RequestStatus)}
          >
            <SelectTrigger aria-label="요청 검토 상태">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(REQUEST_STATUSES)
                .filter(([id]) => id !== "requested")
                .map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Textarea
            aria-label="회원에게 전달할 운영 결정"
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
            placeholder="회원에게 전달할 확인·결정과 후속 경로 · 개인정보·편지 원문 제외"
          />
          <Button
            onClick={() =>
              setMessage(
                decideMemberRequest(selected, status, note) ||
                  "가상 검토 기록을 저장했습니다. 실제 실행·완료는 하지 않았습니다.",
              )
            }
          >
            검토 기록 저장
          </Button>
          <p role="status" className="text-xs text-primary">
            {message}
          </p>
        </div>
      )}
      <Button asChild variant="ghost" size="sm">
        <Link to="/admin/safety">
          기존 신고·안전 상세 <ArrowUpRight className="size-3" />
        </Link>
      </Button>
      <div className="flex flex-wrap gap-4 text-xs text-primary">
        <Link to="/admin/members?filter=waiting7" className="underline">
          7일 이상 · 실제 담당 검토 필요
        </Link>
        <Link to="/admin/members?filter=waiting14" className="underline">
          14일 이상 · 대기·정지·취소 상담
        </Link>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        실제 대기 기록만 기존 관리 목록으로 연결합니다. 자동 시스템 점검으로
        운영자 마지막 검토 시각을 만들거나 조건 완화·탈퇴를 강요하지 않습니다.
      </p>
    </section>
  )
}
