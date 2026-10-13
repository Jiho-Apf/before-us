import { Link } from "react-router"
import { useState } from "react"
import { ArrowRight, Clock3 } from "lucide-react"
import { Button } from "./components/ui/button"
import { Checkbox } from "./components/ui/checkbox"
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
  const deadline = new Date(view.meetingDeadline).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
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
        <p>모두 응답하기 전 서로의 선택은 비공개입니다.</p>
      </div>
      {view.ownMeetingChoice || !view.canRespond ? (
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
                ? "두 분의 응답이 모두 확인되어 이번 교류를 마무리합니다. 거절 사유는 전달하지 않습니다."
                : response === "unanswered"
                  ? "응답 기한이 지났어요. 미응답을 YES나 NO로 처리하지 않습니다. 운영자에게 문의해 주세요."
                  : response === "locked"
                    ? "진행 상태를 확인해 주세요. 새 응답은 보류합니다."
                    : "선택을 전달했어요. 상대의 응답을 기다리고 있습니다."}
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
            내 선택을 확인했어요. 여기서 마무리해도 괜찮습니다.
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
      <p className="border-t border-border pt-4 text-xs leading-6 text-muted-foreground">
        가상 응답 상태입니다. 실제 저장·계정 동기화·약속 예약은 연결되지
        않았습니다.
      </p>
    </section>
  )
}
