import { useEffect, useState } from "react"
import { Sparkles, Scale, AlertTriangle } from "lucide-react"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import type { AdminState } from "./admin-model"
import {
  RECOMMENDATION_POLICY,
  loadMatchingFixtures,
  recommendCandidates,
  recordRecommendationShown,
  useRecommendationLogs,
} from "./match-recommendation"
import {
  BALANCE_POLICY,
  balanceReport,
  countLabel,
  isWaitlisted,
  ratioLabel,
  releaseForecast,
  releaseFromWaitlist,
  useWaitlist,
  waitlistMember,
  type BalanceLevel,
} from "./gender-balance"
import { pairFeedbackSummary, useAftercare } from "./meeting-aftercare"

const time = (at: string | null) =>
  at ? new Date(at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "기록 없음"

export function MatchRecommendations({
  state,
  targetId,
  today,
  onCompare,
  onLoadFixtures,
}: {
  state: AdminState
  targetId: string
  today: string
  onCompare: (candidateId: string) => void
  onLoadFixtures?: (next: AdminState) => void
}) {
  useWaitlist()
  const logs = useRecommendationLogs()
  const result = recommendCandidates(state, targetId, today, isWaitlisted)
  const shownKey = result.recommended.map((item) => item.candidateId).join(",")
  useEffect(() => {
    if (shownKey) recordRecommendationShown(targetId, shownKey.split(","))
  }, [targetId, shownKey])
  const [showExcluded, setShowExcluded] = useState(false)
  const history = logs.filter((item) => item.targetId === targetId && item.chosenId)
  return (
    <section className="space-y-4 border border-primary/30 bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Sparkles className="size-5 text-primary" />
          추천 후보 · 운영진 최종 선택
        </h2>
        <span className="text-xs text-muted-foreground">{RECOMMENDATION_POLICY.version} · 규칙 기반 보조</span>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        필수 조건·차단·진행 상태로 먼저 거른 뒤, 두 사람이 직접 입력한 답변이 겹치는 지점을 근거와 함께 보여 줘요.
        {" "}추천에 쓰지 않는 정보: {RECOMMENDATION_POLICY.excludedSignals.join("·")}. 순서는 참고용이며, 추천에 없는 분도 아래에서 직접 비교할 수 있어요.
      </p>
      {onLoadFixtures && !state.members.some((member) => member.id.startsWith("match-")) && (
        <Button size="sm" variant="outline" onClick={() => onLoadFixtures(loadMatchingFixtures(state))}>
          추천 시연용 가상 신청자 8명 불러오기
        </Button>
      )}
      {result.recommended.length ? (
        <ol className="space-y-3">
          {result.recommended.map((item, index) => (
            <li key={item.candidateId} className="space-y-3 rounded-xl bg-muted p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {index + 1}. {item.candidateName}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{item.candidateId}</span>
                  {item.mutual && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">양쪽 모두 바라는 점 있음</span>}
                </p>
                <Button size="sm" onClick={() => onCompare(item.candidateId)}>이 후보와 조건 비교</Button>
              </div>
              <ul className="space-y-2">
                {item.reasons.slice(0, 4).map((reason, reasonIndex) => (
                  <li key={`${reason.title}-${reasonIndex}`} className="text-xs leading-6">
                    <span className="font-semibold">{reason.title}</span>
                    {reason.evidence.map((evidence) => (
                      <span key={evidence.field} className="block text-muted-foreground">
                        근거 · {evidence.field}: “{evidence.left}” ↔ “{evidence.right}”
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
              {item.cautions.length > 0 && (
                <div className="border-t border-border pt-2 text-xs leading-6">
                  {item.cautions.map((caution, cautionIndex) => (
                    <p key={`${caution.text}-${cautionIndex}`} className={caution.kind === "check" ? "text-destructive" : "text-muted-foreground"}>
                      {caution.kind === "difference" ? "차이 · " : caution.kind === "missing" ? "정보 없음 · " : "확인 · "}
                      {caution.text}
                    </p>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          추천할 근거가 있는 후보가 없어요. 조건을 자동으로 완화하지 않습니다. 직접 비교하거나 소개 대기로 두세요.
        </p>
      )}
      <Button size="sm" variant="ghost" onClick={() => setShowExcluded((value) => !value)}>
        제외된 신청자 {result.excluded.length}명 {showExcluded ? "접기" : "사유 보기"}
      </Button>
      {showExcluded && (
        <ul className="space-y-1 text-xs leading-6 text-muted-foreground">
          {result.excluded.map((item) => (
            <li key={item.candidateId}>
              {item.candidateName} · {item.reasons.join(" / ")}
            </li>
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <div className="border-t border-border pt-3 text-xs leading-6">
          {history.map((item) => (
            <p key={item.id}>
              {time(item.chosenAt)} · 최종 선택 {item.chosenId} · {item.chosenFromList ? "추천 목록에서 선택" : "추천 밖에서 직접 선택"}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}

const LEVEL: Record<BalanceLevel, { label: string; className: string }> = {
  ok: { label: "기준 이내", className: "text-primary" },
  warn: { label: "경보 · 60% 초과", className: "text-accent" },
  waitlist: { label: "대기열 작동 · 70% 이상", className: "text-destructive" },
  "sample-small": { label: "표본 적음 · 판단 보류", className: "text-muted-foreground" },
}

export function GenderBalancePanel({ state, today, onChange }: { state: AdminState; today: string; onChange?: () => void }) {
  const waitlist = useWaitlist()
  const report = balanceReport(state, today)
  const [note, setNote] = useState("")
  const [message, setMessage] = useState("")
  const waiting = waitlist.filter((item) => item.status === "waiting").sort((a, b) => a.at.localeCompare(b.at))
  const Row = ({ label, balance }: { label: string; balance: ReturnType<typeof balanceReport>["overall"] }) => (
    <div className="grid grid-cols-1 gap-1 border-b border-border py-2 text-xs sm:grid-cols-4">
      <span>{label}</span>
      <span>
        여 {countLabel(balance.counts.여성)} · 남 {countLabel(balance.counts.남성)}
      </span>
      <span>{balance.total >= BALANCE_POLICY.smallCountHidden ? ratioLabel(balance) : "—"}</span>
      <span className={LEVEL[balance.level].className}>{LEVEL[balance.level].label}</span>
    </div>
  )
  return (
    <section className="space-y-4 border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg">
          <Scale className="size-4 text-primary" />
          성비 · {BALANCE_POLICY.version}
        </h2>
        <span className={`text-sm ${LEVEL[report.overall.level].className}`}>
          전체 {ratioLabel(report.overall)} · {LEVEL[report.overall.level].label}
        </span>
      </div>
      {report.overall.level === "warn" || report.overall.level === "waitlist" ? (
        <p className="flex items-start gap-2 rounded-xl border border-accent/40 p-3 text-xs leading-6">
          <AlertTriangle className="mt-1 size-4 shrink-0 text-accent" />
          {report.overall.majority} 신청이 {Math.round(report.overall.share * 100)}%예요.{" "}
          {report.overall.level === "waitlist"
            ? `새 ${report.overall.majority} 신청은 순차 검토 대기로 받아요. 부족한 쪽 모집 채널을 늘려 주세요.`
            : "70%가 되면 대기열이 작동해요. 부족한 쪽 모집을 늘려 주세요."}
        </p>
      ) : null}
      <p className="text-xs leading-6 text-muted-foreground">
        접수된 활동 신청자 기준(대기열 제외)입니다. 60% 초과 경보, 70% 이상이면 많은 쪽 성별의 새 신청을 거절하지 않고 순차 검토 대기로 둡니다.
        같은 지역·연령대 묶음도 {BALANCE_POLICY.minimumSample}명 이상이면 따로 판단해요. 1~4명은 정확한 숫자를 보여 주지 않아요.
      </p>
      <div>
        <Row label="전체" balance={report.overall} />
        {report.byAge.map((item) => <Row key={item.label} label={`연령 · ${item.label}`} balance={item} />)}
        {report.byRegion.map((item) => <Row key={item.label} label={`지역 · ${item.label}`} balance={item} />)}
        {report.bySegment.map((item) => <Row key={item.label} label={item.label} balance={item} />)}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm">순차 검토 대기열 · 오래 기다린 순서</h3>
        {waiting.length ? (
          waiting.map((item) => {
            const forecast = releaseForecast(state, item.memberId, today)
            return (
              <div key={item.memberId} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>
                  {item.memberId} · {item.gender} · {time(item.at)} · {item.reason}
                  {forecast && ` · 검토 시작 시 ${ratioLabel(forecast.after)}${forecast.withinLimit ? "" : " (70% 초과)"}`}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const error = releaseFromWaitlist(state, item.memberId, note, today)
                    setMessage(error || "검토를 시작했어요. 이제 일반 검토·추천 대상에 포함돼요.")
                    if (!error) { setNote(""); onChange?.() }
                  }}
                >
                  검토 시작
                </Button>
              </div>
            )
          })
        ) : (
          <p className="text-xs text-muted-foreground">대기 중인 신청이 없어요.</p>
        )}
        {waiting.length > 0 && (
          <Input aria-label="기준 초과 검토 사유" value={note} onChange={(event) => setNote(event.target.value)} placeholder="70%를 넘겨도 검토를 시작할 때만 사유 입력" />
        )}
        {onChange && report.overall.level !== "sample-small" && report.overall.majority && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const latest = [...state.members].reverse().find((member) => member.draft.values["self.gender"] === report.overall.majority && !isWaitlisted(member.id))
              setMessage(latest ? waitlistMember(latest, "운영자 수동 대기 · 성비 조정") || `${latest.id}를 대기열로 옮겼어요.` : "옮길 신청이 없어요.")
              onChange()
            }}
          >
            가장 최근 {report.overall.majority} 신청을 대기열로 (시연)
          </Button>
        )}
      </div>
      <p role="status" className="text-xs text-primary">{message}</p>
    </section>
  )
}

// 만남 후 피드백 · 운영진 전용. 상대에게 전달하지 않으며 다음 소개와 추천 검증에 참고한다.
export function AdminMeetingFeedback() {
  const { feedback } = useAftercare()
  const programs = [...new Set(feedback.map((item) => item.programId))]
  return (
    <section className="mt-7 space-y-4 border border-border bg-card p-5">
      <h2 className="text-lg">만남 후 피드백 · 운영진 전용</h2>
      <p className="text-xs leading-6 text-muted-foreground">
        각자 남긴 응답은 상대에게 보이지 않아요. 안전 확인 요청은 신고·안전 목록에도 함께 접수돼요. 실제 기록이 없으면 비워 둡니다.
      </p>
      {programs.length ? (
        programs.map((programId) => {
          const summary = pairFeedbackSummary(programId)
          return (
            <div key={programId} className="space-y-1 rounded-xl bg-muted p-4 text-xs leading-6">
              <p className="text-sm">
                {programId} · 응답 {summary.count}/2
                {summary.bothAgain && " · 양쪽 다시 만남 희망"}
                {summary.safetyConcern && <span className="ml-2 text-destructive">안전 확인 요청</span>}
                {summary.absentReported && <span className="ml-2 text-accent">불참 응답 · 노쇼 확인</span>}
              </p>
              {feedback.filter((item) => item.programId === programId).map((item) => (
                <p key={item.id}>
                  {item.memberId} · {item.met === "met" ? "만남" : item.met === "not-met" ? "만나지 못함" : "상대 불참"}
                  {item.again && ` · 다시 만남 ${item.again === "yes" ? "희망" : item.again === "no" ? "원하지 않음" : "미정"}`}
                  {item.note && ` · ${item.note}`}
                </p>
              ))}
            </div>
          )
        })
      ) : (
        <p className="text-sm text-muted-foreground">아직 남겨진 만남 후 피드백이 없어요.</p>
      )}
    </section>
  )
}
