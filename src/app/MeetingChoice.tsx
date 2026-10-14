import { kstDateTime } from "./dates"
import { Link } from "react-router"
import { useState } from "react"
import { ArrowRight, Clock3 } from "lucide-react"
import { Button } from "./components/ui/button"
import { Checkbox } from "./components/ui/checkbox"
import { Moment } from "./editorial"
export type MeetingChoiceCommand = {
  type: "meeting-choice"
  choice: "positive" | "negative"
  confirmed: boolean
}
type MeetingChoiceProps = {
  view: {
    ownMeetingChoice: "positive" | "negative" | null
    mutualMeetingWish: boolean
    meetingDeadline: string
    canRespond: boolean
    meetingResponseStatus: string
  }
  onSend: (command: MeetingChoiceCommand) => void
}
export function MeetingChoice({ view, onSend }: MeetingChoiceProps) {
  const [choice, setChoice] = useState<"positive" | "negative" | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const deadline = kstDateTime(view.meetingDeadline)
  const response = view.meetingResponseStatus
  const status =
    response === "choosing"
      ? "만남 의사 선택"
      : response === "waiting"
        ? "상대 응답 대기"
        : response === "mutual"
          ? "약속 방식 선택"
          : response === "closed"
            ? "교류 마무리"
            : response === "unanswered"
              ? "응답 기한 경과 · 미응답 확인 필요"
              : "진행 보류"
  return (
    <section className="mt-5 space-y-6 border border-border bg-background p-6 sm:p-8">
      <header className="space-y-4">
        <p className="text-xs font-semibold tracking-widest text-accent">
          DAY 04 / THE NEXT SCENE
        </p>
        <h2 className="max-w-xl text-3xl font-semibold leading-relaxed">
          이 사람을,
          <br className="hidden sm:block" /> 직접 만나보고 싶나요?
        </h2>
        <p className="max-w-xl text-sm leading-7 text-muted-foreground">
          함께 나눈 이야기를 떠올려 보세요. 마음이 향한다면 다음 장면으로,
          아니라면 여기서 마무리해도 괜찮아요.
        </p>
      </header>
      <div className="space-y-2 rounded-xl bg-muted p-4 text-xs leading-6">
        <p className="font-medium text-primary">{status}</p>
        <p className="flex items-center gap-2">
          <Clock3 size={14} />
          응답 마감: {deadline} · Asia/Seoul
        </p>
        <p>모두 응답하기 전 서로의 선택은 비공개예요.</p>
      </div>
      {view.mutualMeetingWish ? (
        <Moment
          eyebrow="DAY 04 · BOTH SAID YES"
          title={<>두 분 모두,<br />만나보고 싶다고 했어요.</>}
          action={<Button asChild><Link to="/meeting?demo=agreement">약속 방식 함께 정하기 <ArrowRight size={16} /></Link></Button>}
        >
          사흘 동안 나눈 이야기가 여기까지 왔어요. 이제 두 분이 편한 날과 장소를 천천히 맞춰 봐요.
        </Moment>
      ) : view.ownMeetingChoice || !view.canRespond ? (
        <div className="space-y-4 text-sm leading-7">
          <p>
            내 만남 의사:{" "}
            {view.ownMeetingChoice === "positive"
              ? "만나보고 싶어요"
              : view.ownMeetingChoice === "negative"
                ? "이번에는 여기까지 할게요."
                : "미응답"}
          </p>
          <p>
            {view.mutualMeetingWish
              ? "양쪽 만남 희망이 확인됐어요. 다음 단계에서 약속 방식을 함께 정해요."
              : response === "closed"
                ? "두 분의 응답이 모두 확인되어 이번 교류를 마무리해요. 거절 사유는 전달하지 않아요."
                : response === "unanswered"
                  ? "응답 기한이 지났어요. 미응답을 YES나 NO로 처리하지 않아요. 운영자에게 문의해 주세요."
                  : response === "locked"
                    ? "진행 상태를 확인해 주세요. 새 응답은 보류해요."
                    : "선택을 전달했어요. 상대의 응답을 기다리고 있어요."}
          </p>
          {view.mutualMeetingWish && (
            <Button asChild>
              <Link to="/meeting?demo=agreement">
                약속 방식 정하기 <ArrowRight size={16} />
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {(["positive", "negative"] as const).map((value) => (
              <Button
                key={value}
                variant="outline"
                aria-pressed={choice === value}
                className={`h-auto min-h-20 whitespace-normal rounded-xl px-5 py-5 ${
                  choice === value
                    ? "border-primary bg-primary/5 text-primary"
                    : ""
                }`}
                onClick={() => {
                  setChoice(value)
                  setConfirmed(false)
                }}
              >
                {value === "positive"
                  ? "만나보고 싶어요"
                  : "이번에는 여기까지 할게요."}
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            내 선택을 확인했어요. 여기서 마무리해도 괜찮아요.
          </label>
          <Button
            disabled={!choice || !confirmed}
            onClick={() =>
              choice && onSend({ type: "meeting-choice", choice, confirmed })
            }
          >
            만남 의사 전달하기 <ArrowRight size={16} />
          </Button>
        </div>
      )}
    </section>
  )
}
