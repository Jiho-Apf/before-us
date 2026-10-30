import { kstDateTime } from "./dates"
import { useState } from "react"
import { Link } from "react-router"
import { BadgeCheck, CheckCircle2, Circle, CircleDot, CircleAlert, Lightbulb, ShieldCheck, HeartHandshake } from "lucide-react"
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
import { BEFORE_US } from "./config"
import type { ApplicationDraft } from "./application-model"
import { IDENTITY_SCENARIOS, useIdentity, verifyIdentityDemo, type IdentityScenario } from "./identity-model"
import { useWaitlist } from "./gender-balance"
import { profileCoaching, waitingJourney, type JourneyStep } from "./member-guidance"
import {
  FEEDBACK_OPENS_AFTER_MINUTES,
  SAFETY_GUIDE,
  confirmSafetyGuide,
  feedbackOpen,
  submitMeetingFeedback,
  useAftercare,
  type MeetingFeedback,
} from "./meeting-aftercare"
import { submitMemberRequest } from "./member-operations-model"

const time = (at: string | null) =>
  at ? kstDateTime(at) : null

export function IdentityPanel({ memberId = "current-member" }: { memberId?: string }) {
  const identity = useIdentity(memberId)
  const [scenario, setScenario] = useState<IdentityScenario>("adult")
  const [age, setAge] = useState("29")
  const [message, setMessage] = useState("")
  return (
    <section className="space-y-4 rounded-xl border border-border p-5">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <BadgeCheck className="size-4 text-primary" />
        본인·성인 인증
      </h3>
      {identity?.status === "verified" ? (
        <p className="text-sm leading-7">
          인증 완료 · 만 {identity.verifiedAge}세 · {time(identity.verifiedAt)}
          <span className="block text-xs text-muted-foreground">
            이름·전화번호·생년월일 원본은 저장하지 않고 만 나이와 인증 시각만 남겨요.
            {identity.rejoinFlag && " 이전 이용 제한 기록과 같은 인증값이라 운영진이 확인해요."}
          </span>
        </p>
      ) : (
        <>
          <p className="text-xs leading-6 text-muted-foreground">
            플라비는 만 {BEFORE_US.operatingDraft.minimumAge}세 이상 성인만 이용할 수 있어요. 휴대폰 본인인증으로 확인하며,
            같은 사람이 여러 계정을 만들거나 이용이 제한된 분이 다시 가입하는 것을 막는 데도 쓰여요.
          </p>
          <p className="rounded-lg bg-accent/5 p-3 text-xs leading-6 text-accent">
            개발용 가상 인증이에요. 실제 인증 업체는 연결되어 있지 않아요. 결과를 골라 시연해 주세요.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
            <Select value={scenario} onValueChange={(value) => setScenario(value as IdentityScenario)}>
              <SelectTrigger aria-label="가상 인증 결과"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(IDENTITY_SCENARIOS).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input aria-label="가상 만 나이" type="number" min={14} max={99} value={age} onChange={(event) => setAge(event.target.value)} />
          </div>
          <Button onClick={() => setMessage(verifyIdentityDemo(memberId, scenario, Number(age)) || "")}>
            휴대폰 본인인증 (가상)
          </Button>
          {identity?.status === "minor" && <p className="text-sm text-destructive">만 {BEFORE_US.operatingDraft.minimumAge}세 이상만 신청할 수 있어요.</p>}
          {identity?.status === "failed" && <p className="text-sm text-destructive">인증이 완료되지 않았어요. 다시 시도해 주세요.</p>}
          <p role="status" className="text-xs text-primary">{message}</p>
        </>
      )}
    </section>
  )
}

const ICON = { done: CheckCircle2, current: CircleDot, upcoming: Circle, blocked: CircleAlert } as const
export function WaitingJourney({ application, memberId = "current-member", waitlistId = "current-application" }: { application: ApplicationDraft | null; memberId?: string; waitlistId?: string }) {
  const identity = useIdentity(memberId)
  const waitlist = useWaitlist().find((item) => item.memberId === waitlistId && item.status === "waiting") || null
  const steps = waitingJourney(application, identity, waitlist)
  return (
    <section className="space-y-4 rounded-xl border border-border bg-background p-5">
      <h2 className="text-lg">지금 어디쯤인가요?</h2>
      <ol className="space-y-3">
        {steps.map((step: JourneyStep) => {
          const Icon = ICON[step.status]
          return (
            <li key={step.id} className="flex gap-3">
              <Icon className={`mt-1 size-4 shrink-0 ${step.status === "done" ? "text-primary" : step.status === "current" ? "text-accent" : step.status === "blocked" ? "text-destructive" : "text-muted-foreground"}`} />
              <div>
                <p className={`text-sm ${step.status === "upcoming" ? "text-muted-foreground" : ""}`}>{step.title}</p>
                <p className="text-xs leading-6 text-muted-foreground">
                  {step.detail}
                  {time(step.at) && ` · ${time(step.at)}`}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
      <p className="text-xs leading-6 text-muted-foreground">
        실제 기록이 있는 단계만 완료로 표시해요. 예상 날짜나 남은 인원은 만들어 보여 주지 않아요.
      </p>
    </section>
  )
}

export function ProfileCoaching({ application }: { application: ApplicationDraft | null }) {
  const coaching = profileCoaching(application)
  if (!application) return null
  return (
    <section className="space-y-4 rounded-xl border border-border p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg">
          <Lightbulb className="size-4 text-primary" />
          운영진이 나를 더 잘 알 수 있도록
        </h2>
        <span className="text-xs text-muted-foreground">참고 항목 {coaching.filled}/{coaching.total}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full bg-primary" style={{ width: `${Math.round((coaching.filled / coaching.total) * 100)}%` }} />
      </div>
      {coaching.bioTip && <p className="text-sm leading-7">{coaching.bioTip}</p>}
      {coaching.tips.length ? (
        <ul className="space-y-2">
          {coaching.tips.slice(0, 4).map((tip) => (
            <li key={tip.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3">
              <span className="text-xs leading-6">
                <span className="block text-sm">{tip.title}</span>
                {tip.why}
              </span>
              <Button asChild size="sm" variant="outline"><Link to={`/apply?step=${tip.step}`}>채우기</Link></Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">운영진이 참고하는 항목을 모두 채웠어요.</p>
      )}
      <p className="text-xs leading-6 text-muted-foreground">
        모두 선택 항목이에요. 비워 두어도 신청은 그대로 진행되고, 채울수록 운영진이 어울리는 이유를 찾기 쉬워져요. 상대 공개 여부는 따로 정해요.
      </p>
    </section>
  )
}

export function MeetingAftercare({ memberId, partnerId, programId, meetingAt, now }: { memberId: string; partnerId: string | null; programId: string; meetingAt: string; now: Date }) {
  const aftercare = useAftercare()
  const key = `${memberId}:${programId}`
  const own = aftercare.feedback.find((item) => item.memberId === memberId && item.programId === programId)
  const open = feedbackOpen(meetingAt, now)
  const [met, setMet] = useState<MeetingFeedback["met"]>("met")
  const [again, setAgain] = useState<MeetingFeedback["again"]>(null)
  const [concern, setConcern] = useState(false)
  const [note, setNote] = useState("")
  const [message, setMessage] = useState("")
  const kstDate = (value: Date) => value.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
  const meetingDay = Number.isFinite(Date.parse(meetingAt)) && kstDate(now) === kstDate(new Date(meetingAt)) && !open
  return (
    <section className="mt-8 space-y-6 border-t border-border pt-6">
      {meetingDay && (
        <div role="note" className="rounded-xl border border-primary/25 bg-primary/5 p-5 text-sm leading-7">
          <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-primary" />오늘은 만나는 날이에요</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>사람이 많은 공공장소에서, 가능하면 낮이나 이른 저녁에 만나요.</li>
            <li>만나는 장소와 시간을 가까운 사람에게 알려 두세요.</li>
            <li>불편하면 언제든 자리를 떠나도 괜찮아요. 위급하면 112에 먼저 연락해 주세요.</li>
          </ul>
          <Link to="/support?demo=agreement" className="mt-2 inline-block text-xs text-primary underline underline-offset-4">문제가 생기면 바로 신고·진행 멈추기</Link>
        </div>
      )}
      <details open={!open} className="rounded-xl border border-border p-5">
        <summary className="flex cursor-pointer items-center gap-2 text-lg">
          <ShieldCheck className="size-4 text-primary" />
          첫 만남 안전 가이드
        </summary>
        <ul className="mt-4 space-y-3">
          {SAFETY_GUIDE.map((item) => (
            <li key={item.title} className="text-sm leading-7">
              <span className="font-semibold">{item.title}</span>
              <span className="block text-xs leading-6 text-muted-foreground">{item.body}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {aftercare.guideConfirmed[key] ? (
            <span className="text-xs text-primary">가이드 확인 · {time(aftercare.guideConfirmed[key])}</span>
          ) : (
            <Button size="sm" variant="outline" onClick={() => confirmSafetyGuide(memberId, programId, now)}>가이드를 읽었어요</Button>
          )}
          <Button asChild size="sm" variant="ghost"><Link to="/support?demo=agreement">신고·진행 멈추기</Link></Button>
        </div>
      </details>
      <div className="space-y-4 rounded-xl border border-border p-5">
        <h2 className="flex items-center gap-2 text-lg">
          <HeartHandshake className="size-4 text-primary" />
          만남은 어땠나요?
        </h2>
        {own ? (
          <p className="text-sm leading-7">
            남겨 주셔서 고마워요 · {time(own.at)}
            <span className="block text-xs text-muted-foreground">상대에게는 전달되지 않고 운영진만 다음 소개를 위해 참고해요.</span>
          </p>
        ) : !open ? (
          <p className="text-sm text-muted-foreground">약속 시작 {FEEDBACK_OPENS_AFTER_MINUTES}분 뒤부터 남길 수 있어요.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 border-b border-border pb-4">
              <Button size="sm" variant={!concern ? "default" : "outline"} onClick={() => { setConcern(false); setMet("met") }}>잘 마쳤어요</Button>
              <Button size="sm" variant={concern ? "default" : "outline"} onClick={() => setConcern(true)}>문제가 있었어요</Button>
              {concern && <Link to="/support?demo=agreement" className="self-center text-xs text-primary underline underline-offset-4">지금 바로 신고하기</Link>}
            </div>
            <div className="flex flex-wrap gap-2">
              {([["met", "만났어요"], ["not-met", "만나지 못했어요"], ["partner-absent", "상대가 오지 않았어요"]] as const).map(([value, label]) => (
                <Button key={value} size="sm" variant={met === value ? "default" : "outline"} onClick={() => setMet(value)}>{label}</Button>
              ))}
            </div>
            {met === "met" && (
              <div className="flex flex-wrap gap-2">
                {([["yes", "다시 만나고 싶어요"], ["unsure", "아직 모르겠어요"], ["no", "여기까지가 좋아요"]] as const).map(([value, label]) => (
                  <Button key={value} size="sm" variant={again === value ? "default" : "outline"} onClick={() => setAgain(value)}>{label}</Button>
                ))}
              </div>
            )}
            {met === "partner-absent" && (
              <p className="text-xs leading-6">
                사전 취소나 연락이 없었다면 노쇼로 신고할 수 있어요. 운영진이 사실을 확인해요.{" "}
                <Link className="text-primary underline" to="/support?demo=agreement">노쇼 신고하기</Link>
              </p>
            )}
            <Label className="flex items-start gap-3 text-xs leading-6">
              <Checkbox checked={concern} onCheckedChange={(value) => setConcern(value === true)} />
              만남 중 불편하거나 위험했던 일이 있었어요. 운영진에게 안전 확인을 요청할게요.
            </Label>
            <Textarea aria-label="운영진에게 남길 말" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder="운영진에게만 전해져요 · 선택 · 연락처 제외" />
            <Button
              onClick={() => {
                const error = submitMeetingFeedback({ memberId, programId, meetingAt, met, again, safetyConcern: concern, note }, now)
                if (error) return setMessage(error)
                if (concern) submitMemberRequest({ memberId, targetId: partnerId, programId, surface: "만남 후 피드백" }, "report", { confirmed: true, reportType: "실제 만남 관련 문제", description: "만남 후 피드백에서 안전 확인 요청" }, now)
                setMessage(concern ? "남겨 주셔서 고마워요. 안전 확인 요청도 함께 접수했어요." : "남겨 주셔서 고마워요.")
              }}
            >
              운영진에게 남기기
            </Button>
          </>
        )}
        <p role="status" className="text-xs text-primary">{message}</p>
      </div>
    </section>
  )
}
