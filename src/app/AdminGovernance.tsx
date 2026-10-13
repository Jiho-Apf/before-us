import { MeetingPolicySettings } from "./MeetingPolicySettings"
import { useState, type ReactNode } from "react"
import { Link, useSearchParams } from "react-router"
import { ArrowUpRight, ShieldCheck, Clock3 } from "lucide-react"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { AdminMemberRequests } from "./MemberOperations"
import { AdminConductCases } from "./ConductPolicy"
import { AdminPrivacyQueue } from "./PrivacyPanels"
import { AdminMeetingFeedback } from "./MatchingAssist"
import { MessageCenter } from "./MessageCenter"
import { RELEASE_CHECKLIST } from "./MemberProfile"
import { syncMemberReportStatus } from "./member-operations-model"
import { Textarea } from "./components/ui/textarea"
import {
  useConsoleData,
  replaceConsoleData,
  inRange,
  periodRange,
  paymentTotals,
  type Period,
  type DateRange,
} from "./admin-console-data"
import {
  governanceAction,
  currentSettings,
  operatingAnalytics,
  publicFeedbackCandidate,
  REPORT_STATES,
  REPORT_TYPES,
  type GovernanceCommand,
} from "./admin-governance-model"
import { protectedSupply } from "./admin-operations-model"
import { BEFORE_US } from "./config"
import { NoonAdminGuide } from "./NoonStatus"

const money = (value: number) => `${value.toLocaleString("ko-KR")}원`
const time = (value: string | null | undefined) =>
  value && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour12: false,
      })
    : "기록 없음"
const titles: Record<string, string> = {
  payments: "결제",
  safety: "신고·안전",
  reviews: "후기·피드백",
  notifications: "알림",
  settings: "운영설정",
  audit: "감사로그",
  analytics: "운영 분석",
}
type PanelProps = {
  title: string
  children: ReactNode
}
function Panel({ title, children }: PanelProps) {
  return (
    <section className="rounded-xl border border-border bg-background p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[][]
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-2 text-xs text-muted-foreground">
      {label}
      <select
        className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}
type TableProps = {
  headings: string[]
  rows: ReactNode[][]
}
function Table({ headings, rows }: TableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full whitespace-nowrap text-left text-xs">
        <thead className="bg-secondary text-muted-foreground">
          <tr>
            {headings.map((label) => (
              <th key={label} className="px-4 py-3 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border">
              {row.map((cell, column) => (
                <td key={column} className="px-4 py-4 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="p-10 text-center text-sm text-muted-foreground">
          해당 기간·필터의 데이터가 없습니다.
        </p>
      )}
    </div>
  )
}
export function AdminGovernance({ section }: { section: string }) {
  const data = useConsoleData()
  const [params, setParams] = useSearchParams()
  const [period, setPeriod] = useState<Period>(
    params.has("start") || params.has("end") ? "custom" : "30",
  )
  const [custom, setCustom] = useState<DateRange>({
    start: params.get("start") || "",
    end: params.get("end") || "",
  })
  const [filter, setFilter] = useState(() => {
    const requested = params.get("filter") || "all"
    if (section === "payments")
      return ["paid", "introduction", "exchange", "refunded", "all"].includes(
        requested,
      )
        ? requested
        : requested === "refund-request"
          ? "refund"
          : "all"
    return REPORT_STATES.some((item) => item.id === requested)
      ? requested
      : "all"
  })
  const [visibleReport, setVisibleReport] = useState<string | null>(null)
  const [visibleFeedback, setVisibleFeedback] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [message, setMessage] = useState("")
  const [reportStatus, setReportStatus] = useState<string>(
    data.reports.find((report) => report.id === params.get("report"))?.status ||
      "reviewing",
  )
  const [templateBody, setTemplateBody] = useState(
    data.governance.templates[0]?.body || "",
  )
  const [proposal, setProposal] = useState({
    ...(data.governance.settingsProposal || currentSettings()),
    version: data.governance.settingsProposal?.version || "",
  })
  const [auditQuery, setAuditQuery] = useState("")
  const [auditActor, setAuditActor] = useState("all")
  const now = new Date()
  const range = periodRange(period, now, custom)
  const run = (command: GovernanceCommand) => {
    const result = governanceAction(data, command, new Date())
    if (result.error) {
      if (result.data !== data) replaceConsoleData(result.data)
      setMessage(result.error)
      return
    }
    replaceConsoleData(result.data)
    if(command.kind==="report")syncMemberReportStatus(command.id,command.status,new Date())
    if (command.kind === "report-description") setVisibleReport(command.id)
    if (command.kind === "feedback-read") setVisibleFeedback(command.id)
    setMessage(
      "가상 운영 기록에 반영했습니다. 실제 결제·발송·공개는 실행하지 않았습니다.",
    )
  }
  const selectedReport = data.reports.find(
    (report) => report.id === params.get("report"),
  )
  const stats = paymentTotals(data, range, now)
  const payments = data.payments
    .filter(
      (payment) =>
        inRange(payment.paidAt, range, now) ||
        inRange(payment.refundRequestedAt, range, now) ||
        inRange(payment.refundedAt, range, now),
    )
    .filter(
      (payment) =>
        filter === "all" ||
        (filter === "paid" && inRange(payment.paidAt, range, now)) ||
        (filter === "refund" &&
          inRange(payment.refundRequestedAt, range, now)) ||
        (filter === "refunded" && inRange(payment.refundedAt, range, now)) ||
        (filter === payment.kind && inRange(payment.paidAt, range, now)),
    )
  const reports = data.reports
    .filter(
      (report) =>
        params.get("filter") === "urgent" ||
        params.get("filter") === "new-report" ||
        params.get("filter") === "reviewing" ||
        inRange(report.createdAt, range, now),
    )
    .filter(
      (report) =>
        params.get("filter") !== "urgent" ||
        (report.urgent && report.status !== "closed"),
    )
    .filter(
      (report) =>
        params.get("filter") !== "new-report" ||
        (report.status !== "closed" &&
          (report.status === "new" || report.urgent)),
    )
    .filter((report) => filter === "all" || report.status === filter)
  const feedback = data.governance.feedback
    .filter((item) => inRange(item.at, range, now))
    .filter(
      (item) =>
        filter === "all" ||
        (filter === "improvement" && item.improvementRequested) ||
        (filter === "consented" && !!item.publicConsentAt) ||
        (filter === "private" && !item.publicConsentAt) ||
        (filter === "report" && !!item.reportId),
    )
  const analytics = operatingAnalytics(data, range, now)
  const reasonInput = (
    <label className="block space-y-2 text-xs text-muted-foreground">
      처리·접근 사유 (필수, 1~200자)
      <Textarea
        value={reason}
        maxLength={200}
        onChange={(event) => setReason(event.target.value)}
        placeholder="업무 목적만 작성해 주세요. 연락처·개인정보를 남기지 마세요."
      />
    </label>
  )
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs tracking-widest text-accent">
            BEFORE US / OPERATIONS
          </p>
          <h1 className="text-2xl font-semibold">{titles[section]}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Owner 1명 · 데모 데이터 · Asia/Seoul
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full bg-secondary px-3 py-2 text-xs">
          <ShieldCheck size={14} />
          실제 권한·DB·PG 미연결
        </span>
      </header>
      <div className="border-l-2 border-accent bg-secondary px-4 py-3 text-xs leading-6 text-muted-foreground">
        가상 자료만 다룹니다. 서버 관리자 인증·역할별 권한·결제·발송·로그
        불변성은 구현되지 않았습니다. URL이나 메뉴를 숨기는 것은 접근 보안이
        아닙니다.
      </div>
      {["safety","payments","settings"].includes(section) && <AdminMemberRequests />}
      {section === "safety" && <AdminConductCases />}
      {["safety","settings"].includes(section) && <AdminPrivacyQueue />}
      {section === "reviews" && <AdminMeetingFeedback />}
      {section === "settings" && <section className="space-y-4 border border-border bg-muted p-5"><h2 className="text-lg">실제 출시 전 확인·구현 필요</h2><ul className="list-disc space-y-2 pl-5 text-xs leading-6 text-muted-foreground">{RELEASE_CHECKLIST.map(item=><li key={item}>{item}</li>)}</ul><p className="text-xs leading-6">가상 자료 데모입니다. 실제 과금·발송·자동 공개·법률 검토 완료·보안 완료로 표시하지 않습니다. 사진·편지·자유 입력·이상형은 광고·외부 분석에 원문 전송하지 않습니다. 운영 시간·소개 간격·상호 선택·교류 결제·완료·중단·환불은 실제 이벤트·분모가 있는 값만 내부 집계하며 가짜 지표를 만들지 않습니다.</p></section>}
      {section !== "settings" && section !== "notifications" && (
        <div className="flex flex-wrap items-end gap-3">
          <Choice
            label="집계 기간"
            value={period}
            options={[
              ["today", "오늘"],
              ["7", "최근 7일"],
              ["30", "최근 30일"],
              ["custom", "직접 설정"],
            ]}
            onChange={(value) => setPeriod(value as Period)}
          />
          {period === "custom" && (
            <>
              <label className="text-xs">
                시작일
                <Input
                  type="date"
                  value={custom.start}
                  onChange={(event) =>
                    setCustom({ ...custom, start: event.target.value })
                  }
                />
              </label>
              <label className="text-xs">
                종료일
                <Input
                  type="date"
                  value={custom.end}
                  onChange={(event) =>
                    setCustom({ ...custom, end: event.target.value })
                  }
                />
              </label>
            </>
          )}
          <p className="pb-2 text-xs text-muted-foreground">
            {range
              ? `${range.start} ~ ${range.end} · 경계일 포함`
              : "유효한 시작일·종료일을 입력해 주세요."}
          </p>
        </div>
      )}
      {message && (
        <p
          role="status"
          className="rounded-lg border border-border p-3 text-sm"
        >
          {message}
        </p>
      )}
      {section === "payments" && (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-6">
            {[
              ["총 결제액", money(stats.gross)],
              [
                "소개비 5,000원",
                `${stats.introduction.length}건 · ${money(stats.introduction.reduce((sum, item) => sum + item.amount, 0))}`,
              ],
              [
                "교류비 24,000원",
                `${stats.exchange.length}건 · ${money(stats.exchange.reduce((sum, item) => sum + item.amount, 0))}`,
              ],
              ["환불 요청", `${stats.requests.length}건`],
              [
                "환불 완료",
                `${data.payments.filter((item) => inRange(item.refundedAt, range, now)).length}건 · ${money(stats.refund)}`,
              ],
              ["순수납액", money(stats.net)],
            ].map(([label, value]) => (
              <div key={label} className="bg-background p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-3 text-lg font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            결제는 결제일, 환불은 요청일·완료일로 집계합니다. 순수납액은 기간
            결제액 − 기간 환불액이며 순이익이 아닙니다. 세금·수수료 미연결, 실제
            PG 미연결. 카드번호·민감 결제수단 정보는 저장·표시하지 않습니다.
          </p>
          <Choice
            label="거래 유형"
            value={filter}
            options={[
              ["all", "전체"],
              ["paid", "기간 내 결제"],
              ["introduction", "소개비"],
              ["exchange", "교류비"],
              ["refund", "환불 요청"],
              ["refunded", "환불 완료"],
            ]}
            onChange={setFilter}
          />
          <Table
            headings={[
              "내부 결제ID",
              "회원",
              "항목",
              "금액",
              "결제 시각",
              "상태",
              "환불 상태",
              "검토",
            ]}
            rows={payments.map((payment) => [
              payment.id,
              payment.memberId,
              payment.kind === "introduction" ? "소개 이용료" : "교류비",
              money(payment.amount),
              time(payment.paidAt),
              "가상 결제 기록",
              payment.refundedAt
                ? `완료 ${money(payment.refundAmount)} · ${time(payment.refundedAt)}`
                : payment.refundRequestedAt
                  ? `요청 · ${time(payment.refundRequestedAt)} · 산정 ${payment.refundRequestedAmount === undefined || payment.refundRequestedAmount === null ? "개별 확인" : money(payment.refundRequestedAmount)} · ${payment.refundBasis || "구매 정책/제공 이력 확인 필요"} · ${payment.refundPolicyVersion || "과거 정책 확인"}`
                  : "없음",
              <Button
                key={payment.id}
                variant="outline"
                size="sm"
                onClick={() =>
                  run({ kind: "refund-review", id: payment.id, reason })
                }
              >
                검토 기록
              </Button>,
            ])}
          />
          {reasonInput}
          <p className="text-xs text-muted-foreground">
            신규 환불 운영 기준은 V6-refund-01이며 거래별 구매 시점 정책·실제 제공 이력을 확인합니다. 법정 권리·실제 약관 검토는 별도입니다. 검토 기록은 환불 실행·승인이나 기존 거래
            변경이 아닙니다.
          </p>
        </>
      )}
      {section === "safety" && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Choice
              label="처리 상태"
              value={filter}
              options={[
                ["all", "전체"],
                ...REPORT_STATES.map((item) => [item.id, item.label]),
              ]}
              onChange={setFilter}
            />
            {params.get("filter") === "urgent" && (
              <Button variant="outline" onClick={() => setParams({})}>
                긴급 필터 해제
              </Button>
            )}
          </div>
          <Table
            headings={[
              "신고",
              "신고자 → 대상",
              "소개·교류",
              "유형",
              "접수 시각",
              "첨부",
              "우선도",
              "담당자",
              "상태",
            ]}
            rows={reports.map((report) => [
              <Button
                key={report.id}
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => {
                  setParams({ report: report.id })
                  setReportStatus(report.status)
                  setNote(report.actionNote || "")
                  setReason("")
                  setVisibleReport(null)
                }}
              >
                {report.id}
              </Button>,
              `${report.reporterId || "기록 없음"} → ${report.targetId || report.memberId}`,
              `${report.introductionId || "—"} / ${report.exchangeId || "—"}`,
              report.type || "기록 없음",
              time(report.createdAt),
              report.hasAttachment ? "있음 · 원본 미연결" : "없음",
              report.priority || (report.urgent ? "긴급" : "일반"),
              report.assignee || "미배정",
              REPORT_STATES.find((item) => item.id === report.status)?.label,
            ])}
          />
          <p className="text-xs leading-6 text-muted-foreground">
            긴급·신규 처리할 일·검토 중 링크는 현재 상태 전체를 보여 주며 기간 밖 기록도 포함합니다.
            유형: {REPORT_TYPES.join(" / ")}. 신고 건수만으로 자동 차단하거나
            공개 평점·외모·인성 점수를 만들지 않습니다.
          </p>
          {selectedReport && (
            <Panel title={`${selectedReport.id} · 신고 검토`}>
              <div className="space-y-4">
                <p className="text-sm leading-6">
                  {visibleReport === selectedReport.id
                    ? selectedReport.description || "등록된 설명 없음"
                    : "설명은 업무 사유를 기록한 뒤 열람합니다."}
                </p>
                <Choice
                  label="처리 상태"
                  value={reportStatus}
                  options={REPORT_STATES.map((item) => [item.id, item.label])}
                  onChange={setReportStatus}
                />
                <label className="block space-y-2 text-xs">
                  조치 메모 · 최대 500자
                  <Textarea
                    maxLength={500}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="운영 절차만 기록하세요. 편지 본문이나 연락처를 복사하지 마세요."
                  />
                </label>
                {reasonInput}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      run({
                        kind: "report-description",
                        id: selectedReport.id,
                        reason,
                      })
                    }
                  >
                    신고 설명 열람·기록
                  </Button>
                  <Button
                    onClick={() =>
                      run({
                        kind: "report",
                        id: selectedReport.id,
                        status: reportStatus as typeof selectedReport.status,
                        note,
                        reason,
                      })
                    }
                  >
                    가상 검토 기록 저장
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      run({
                        kind: "report-read",
                        id: selectedReport.id,
                        reason,
                      })
                    }
                  >
                    관련 본문 접근 요청 기록
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  담당자는 가상 Owner입니다. 실제 본문·첨부 열람은 서버 별도
                  권한 검증 전 차단됩니다. 접근 요청은 사유·시각과 함께
                  감사로그에 남습니다.
                </p>
              </div>
            </Panel>
          )}
        </>
      )}
      {section === "reviews" && (
        <>
          <Choice
            label="피드백 필터"
            value={filter}
            options={[
              ["all", "전체"],
              ["improvement", "개선 요청"],
              ["consented", "공개 동의"],
              ["private", "비공개"],
              ["report", "신고 연계"],
            ]}
            onChange={setFilter}
          />
          <Table
            headings={[
              "작성자",
              "분류",
              "연결 프로그램",
              "작성일",
              "공개 동의",
              "운영자 확인",
              "공개 후보",
              "검토",
            ]}
            rows={feedback.map((item) => [
              item.authorId,
              item.category,
              item.programId || "없음",
              time(item.at),
              item.publicConsentAt
                ? `${time(item.publicConsentAt)} · 동의 v${item.consentVersion}`
                : "비공개",
              item.review === "confirmed"
                ? "확인"
                : item.review === "revision-review"
                  ? "수정·발췌 별도 검토"
                  : "미확인",
              publicFeedbackCandidate(item)
                ? "동의된 버전만 후보 · 게시 아님"
                : "대상 아님",
              <div key={item.id} className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    run({ kind: "feedback-read", id: item.id, reason })
                  }
                >
                  내용 열람·기록
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    run({
                      kind: "feedback",
                      id: item.id,
                      review: "confirmed",
                      reason,
                    })
                  }
                >
                  확인 기록
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    run({
                      kind: "feedback",
                      id: item.id,
                      review: "revision-review",
                      reason,
                    })
                  }
                >
                  수정·발췌 검토
                </Button>
              </div>,
            ])}
          />
          {reasonInput}
          {visibleFeedback &&
            data.governance.feedback.find(
              (item) => item.id === visibleFeedback,
            ) && (
              <Panel title="가상 피드백 · 사유 기록 후 열람">
                <p className="whitespace-pre-wrap text-sm leading-6">
                  {
                    data.governance.feedback.find(
                      (item) => item.id === visibleFeedback,
                    )?.body
                  }
                </p>
              </Panel>
            )}
          <p className="text-xs leading-6 text-muted-foreground">
            교류 후기 / 소개 만족도 / 운영 경험 / 일정·장소 기능 의견을
            구분합니다. 등록 기록이 없으면 데이터 없음으로 표시합니다. 비공개
            의견은 홈페이지에 자동 공개하지 않으며, 수정·발췌는 별도 검토와 해당
            내용에 대한 공개 동의가 필요합니다. 가짜 후기·만족도는 생성하지
            않습니다.
          </p>
        </>
      )}
      {section === "analytics" && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              [
                "평균 첫 소개 대기",
                analytics.firstWait,
                "일",
                "첫 공개일 기준 · 대기 중 제외",
              ],
              [
                "소개 간 평균 대기",
                analytics.intervals,
                "일",
                "두 번째 이후 공개일 기준",
              ],
              [
                "첫 상호 선택까지 소개수",
                analytics.untilMutual,
                "회",
                "첫 상호 선택일 기준 · 회원별",
              ],
            ].map(([label, metric, unit, detail]) => {
              const value = metric as typeof analytics.firstWait
              return (
                <Panel key={String(label)} title={String(label)}>
                  <p className="text-3xl font-semibold">
                    {value.value === null
                      ? "데이터 없음"
                      : `${value.value.toFixed(1)}${unit}`}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    표본 {value.samples} · {String(detail)}
                  </p>
                </Panel>
              )
            })}
          </div>
          <Panel title="단계별 전환 · 연결된 프로그램 기록">
            <Table
              headings={["구간", "분자 / 분모", "비율"]}
              rows={analytics.rates.map((item) => [
                item.label,
                `${item.numerator} / ${item.denominator}건`,
                item.denominator
                  ? `${((item.numerator / item.denominator) * 100).toFixed(1)}%`
                  : "데이터 없음",
              ])}
            />
            <p className="mt-4 text-xs leading-6 text-muted-foreground">
              각 분모는 선택 기간에 앞 단계에 진입한 소개 한 쌍 또는 교류
              프로그램입니다. 분자는 해당 건의 현재까지 확인된 다음 단계이며
              관찰 중인 건은 아직 미완료입니다. 3일 경과만으로 완료 처리하지
              않습니다. 프로그램 연결이 없는 교류비 {analytics.unlinkedPayments}
              건은 양쪽 결제 전환 집계에서 제외합니다.
            </p>
          </Panel>
          <Panel title="운영 공급 · 넓은 집계만">
            <div className="flex flex-wrap gap-3">
              {protectedSupply(data)
                .filter(
                  (group) =>
                    /^[0-9]+명$/.test(group.value) &&
                    parseInt(group.value) >= 5,
                )
                .map((group) => (
                  <span
                    key={group.label}
                    className="rounded-lg bg-secondary px-4 py-3 text-sm"
                  >
                    {group.label} · {group.value}
                  </span>
                ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              소개 가능 회원의 단일 성별·넓은 연령·지역 그룹 중 5명 이상만
              표시합니다. 소수 그룹·교차 세분은 표시하지 않습니다. 충분한 집계가
              없으면 데이터 없음입니다. 회원 화면으로 자동 공개되지 않습니다.
            </p>
          </Panel>
        </>
      )}
      {section === "notifications" && (
        <Panel title="회원 메시지 · 카카오 알림톡 / 문자">
          <div className="space-y-6">
            <MessageCenter state={data.admin} />
            <NoonAdminGuide />
          </div>
        </Panel>
      )}
      {section === "settings" && <MeetingPolicySettings />}
      {section === "settings" && (
        <div className="grid gap-5 lg:grid-cols-[7fr_5fr]">
          <Panel title="다음 정책 검토안 · 미적용">
            <div className="space-y-4">
              {[
                ["정책 버전", "version", "text"],
                ["정오 공개 시간 (Asia/Seoul)", "disclosureTime", "time"],
                [
                  "기본 응답 기한 (시간, 미확정이면 비움)",
                  "responseHours",
                  "number",
                ],
                ["장기 대기 검토 기준 (일)", "longWaitingDays", "number"],
                ["소개 이용료 (원)", "introductionPrice", "number"],
                ["교류비 (1인, 원)", "exchangePrice", "number"],
              ].map(([label, key, type]) => (
                <label key={key} className="block space-y-2 text-xs">
                  {label}
                  <Input
                    type={type}
                    min={type === "number" ? 1 : undefined}
                    value={proposal[(key as keyof typeof proposal)] ?? ""}
                    onChange={(event) =>
                      setProposal((previous) => ({
                        ...previous,
                        [key]:
                          type === "number"
                            ? event.target.value === "" &&
                              key === "responseHours"
                              ? null
                              : Number(event.target.value)
                            : event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
              {reasonInput}
              <Button
                onClick={() => run({ kind: "settings", proposal, reason })}
              >
                검토안 저장 · 기존 정책 미변경
              </Button>
            </div>
          </Panel>
          <div className="space-y-5">
            <Panel title="현재 적용 기준 · V6">
              <dl className="space-y-3 text-sm">
                <div>브랜드: 비포어스 / BEFORE US</div>
                <div>공개: {BEFORE_US.introduction.readyAt} · Asia/Seoul</div>
                <div>
                  소개 {money(BEFORE_US.pricing.introduction)} / 교류{" "}
                  {money(BEFORE_US.pricing.exchangePerPerson)}
                </div>
                <div>
                  첫 교류까지 1인{" "}
                  {money(BEFORE_US.pricing.firstExchangeTotalPerPerson)} ·
                  부가세 포함
                </div>
                <div>기본 응답 기한: 공개 다음 날 {BEFORE_US.introduction.responseDeadlineNextDayAt} · Asia/Seoul</div>
                <div>14일 초과 대기 검토: 운영 초안</div>
              </dl>
              <p className="mt-4 text-xs leading-6 text-muted-foreground">
                검토안은 적용·가격 변경·기존 회원 소급이 아닙니다. 회원별 정책
                버전·권리는 유지합니다. 환불 운영 기준은 거래별 구매 시점 버전으로 관리합니다. 실제 약관·보유기간·재이용 정책은 별도 검토가 필요합니다.
              </p>
            </Panel>
            <Panel title="역할 분리 준비">
              <p className="text-sm">Owner / Operator / Support / Finance</p>
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                현재 가상 Owner만 사용합니다. 추후 운영 검토, 문의·안전, 결제
                업무를 역할별로 분리하고 서버 권한·DB 정책으로 검증해야 합니다.
                실제 역할 기반 접근은 미구현입니다.
              </p>
            </Panel>
          </div>
        </div>
      )}
      {section === "audit" && (
        <>
          <div className="flex flex-wrap gap-3">
            <Choice
              label="관리자"
              value={auditActor}
              options={[
                ["all", "전체"],
                ...[...new Set(data.audits.map((item) => item.actor))].map(
                  (actor) => [actor, actor],
                ),
              ]}
              onChange={setAuditActor}
            />
            <label className="flex flex-col gap-2 text-xs text-muted-foreground">
              행위 필터
              <Input
                placeholder="검토·접근·취소·환불 등"
                value={auditQuery}
                onChange={(event) => setAuditQuery(event.target.value)}
              />
            </label>
          </div>
          <Table
            headings={[
              "시각",
              "관리자·역할",
              "행위",
              "대상",
              "사유",
              "실행 범위",
            ]}
            rows={data.audits
              .filter(
                (item) =>
                  inRange(item.at, range, now) &&
                  (auditActor === "all" || item.actor === auditActor) &&
                  item.action.includes(auditQuery),
              )
              .slice()
              .reverse()
              .map((item) => [
                time(item.at),
                `${item.actor} · ${item.role || "가상 Owner"}`,
                item.action,
                item.target,
                item.reason || "원본 기록에 사유 없음",
                item.result || "가상 기록 · 서버 로그 아님",
              ])}
          />
          <Panel title="가상 진입 이벤트 시연">
            <div className="space-y-3">
              {reasonInput}
              <Button
                variant="outline"
                onClick={() => run({ kind: "demo-login", reason })}
              >
                가상 진입 이벤트 기록 · 실제 로그인 아님
              </Button>
            </div>
          </Panel>
          <p className="text-xs leading-6 text-muted-foreground">
            신청 검토·프로필/신고/편지 열람·소개 취소·상태 수정·환불 처리 등
            실제 행위에는 관리자·시각·사유 기록이 필요합니다. 본문 접근 요청은
            실제 열람으로 표시하지 않습니다. 이 데모는 메모리 기록이며 재초기화
            시 사라집니다. 일반 회원 접근 차단, 서버 추가 전용 로그, 관리자 임의
            삭제 방지·변조 탐지는 실제 서버 구현이 필요합니다. 삭제 기능은
            제공하지 않습니다.
          </p>
        </>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <Clock3 size={14} />
          자동 갱신은 운영자의 실제 검토가 아닙니다.
        </span>
        <Link
          to={section === "analytics" ? "/admin" : "/admin/analytics"}
          className="flex items-center gap-1 text-accent"
        >
          {section === "analytics" ? "대시보드" : "운영 분석"}
          <ArrowUpRight size={14} />
        </Link>
      </footer>
    </div>
  )
}
