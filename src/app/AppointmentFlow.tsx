import { kstDateTime } from "./dates"
import { AppointmentDetailFlow } from "./AppointmentDetailFlow"
import { useState } from "react"
import { Link } from "react-router"
import { Clock3, ArrowRight } from "lucide-react"
import { Button } from "./components/ui/button"
import { Checkbox } from "./components/ui/checkbox"
import {
  APPOINTMENT_METHODS,
  type AppointmentCommand,
  type AppointmentMethod,
  type AppointmentView,
} from "./appointment-model"

const format = (value: string) =>
  kstDateTime(value)
type AppointmentFlowProps = {
  view: AppointmentView
  onCommand: (command: AppointmentCommand, revision: number) => string | null
}
export function AppointmentFlow({ view, onCommand }: AppointmentFlowProps) {
  const [method, setMethod] = useState<AppointmentMethod | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState("")
  const send = (command: AppointmentCommand) => {
    const result = onCommand(command, view.revision)
    setError(
      result || "가상 기록을 반영했어요. 실제 예약·발송은 하지 않아요.",
    )
    if (!result) {
      setConfirmed(false)
    }
  }
  return (
    <section className="space-y-7 py-7">
      <header className="grid bg-primary text-primary-foreground md:grid-cols-[8fr_4fr]">
        <div className="p-7 sm:p-9">
          <p className="text-xs tracking-widest">
            NEXT SCENE / OUR APPOINTMENT
          </p>
          <h1 className="mt-5 text-3xl leading-relaxed">
            우리 약속, 어떻게 정할까요?
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-7">
            둘 다 만나보고 싶다고 선택했어요. 누가 먼저 제안할지부터, 실제
            일시와 장소까지 함께 정해요.
          </p>
        </div>
        <div className="flex flex-col justify-between border-l border-white/20 p-7">
          <span className="text-6xl font-light">04</span>
          <p className="mt-5 text-sm">{view.status}</p>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-5 text-sm">
        <Clock3 className="text-accent" size={17} />
        <span>현재 상태: {view.status}</span>
        {view.deadline && (
          <span className="text-muted-foreground">
            이번 단계 기한: {format(view.deadline)} · Asia/Seoul
          </span>
        )}
      </div>
      {(view.overdue || view.targetExceeded) && !view.final && (
        <div className="rounded-xl border border-accent/20 bg-accent/5 p-5 text-sm leading-7">
          {view.overdue
            ? "이번 단계 안내 기한이 지났어요. 진행 상태와 참여 가능성을 확인해 주세요. "
            : ""}
          {view.targetExceeded ? "전체 조율 목표 시각을 지났어요. " : ""}
          미응답을 동의로 처리하거나 약속을 자동 취소하지 않아요. 필요하면
          운영자에게 문의해 주세요.
        </div>
      )}
      {!view.active && (
        <p className="rounded-xl bg-muted p-5 text-sm">
          교류가 중단되었거나 접근 재검토 중이에요. 새로운 약속 선택·제출은
          보류해요.
        </p>
      )}
      {!view.ownMethod && view.active && (
        <div className="space-y-5">
          <h2 className="text-xl">편한 제안 방식을 골라 주세요.</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {(Object.entries(
              APPOINTMENT_METHODS,
            ) as [AppointmentMethod, string][]).map(([value, label], index) => (
              <Button
                key={value}
                variant="outline"
                aria-pressed={method === value}
                className={`h-auto min-h-28 justify-start whitespace-normal rounded-xl px-5 py-6 text-left ${
                  method === value
                    ? "border-primary bg-primary/5 text-primary"
                    : ""
                }`}
                onClick={() => {
                  setMethod(value)
                  setConfirmed(false)
                }}
              >
                <span className="mr-3 text-2xl font-light text-accent">
                  0{index + 1}
                </span>
                {label}
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            내 선택을 확인했어요. 상대 대신 선택하지 않아요.
          </label>
          <Button
            disabled={!method || !confirmed}
            onClick={() =>
              method && send({ type: "method", value: method, confirmed })
            }
          >
            약속 방식 전달하기 <ArrowRight size={16} />
          </Button>
        </div>
      )}
      {view.ownMethod && (
        <div className="rounded-xl bg-muted p-5 text-sm leading-7">
          <p>내 선택: {APPOINTMENT_METHODS[view.ownMethod]}</p>
          <p>
            {view.peerMethod
              ? `상대 선택: ${APPOINTMENT_METHODS[view.peerMethod]}`
              : "상대의 약속 방식 응답을 기다리고 있어요."}
          </p>
        </div>
      )}
      {view.resolution === "confirm-joint" && (
        <div className="space-y-4 border border-border p-6">
          <h2 className="text-xl">같이 골라볼까요?</h2>
          <p className="text-sm leading-7">
            자동으로 제안자를 지정하지 않을게요. 두 사람이 같이 고르기에
            동의하면 함께 약속안을 만들 수 있어요. 서로 다른 방식의 조합도
            임의로 확정하지 않아요.
          </p>
          <p className="text-xs">
            내 확인 {view.ownJointConfirmed ? "완료" : "대기"} · 상대 확인{" "}
            {view.peerJointConfirmed ? "완료" : "대기"}
          </p>
          {view.active && !view.ownJointConfirmed && (
            <>
              <label className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                />
                같이 고르기로 진행할게요.
              </label>
              <Button
                disabled={!confirmed}
                onClick={() => send({ type: "joint-confirm", confirmed })}
              >
                같이 고르기 확인
              </Button>
            </>
          )}
        </div>
      )}
      {view.resolution === "parallel" && (
        <p className="text-sm leading-7">
          두 분 모두 먼저 제안하기를 선택했어요. 각자 약속안 한 개를 만들고
          나란히 비교해요. 같은 안을 두 사람이 확인해야 최종 합의가 돼요.
        </p>
      )}
      {view.resolution === "joint" && (
        <p className="text-sm leading-7">
          같이 고르기로 확인했어요. 한 사람이 초안을 공유하고, 상대가 수정안을
          제안하거나 같은 버전을 확인할 수 있어요.
        </p>
      )}
      <AppointmentDetailFlow view={view} onCommand={onCommand} />
      <footer className="space-y-4 border-t border-border pt-5">
        <p className="text-xs leading-6 text-muted-foreground">
          전체 조율 목표: {format(view.targetAt)} · Asia/Seoul. 목표 시각은 자동
          취소 기준이 아니에요. 적용 정책 {view.policyVersion} · 운영 초안.
        </p>
        <Button variant="outline" onClick={() => send({ type: "contact" })}>
          운영자 문의
        </Button>
        <Button asChild variant="outline"><Link to="/support?demo=agreement">문의·신고·차단·중단</Link></Button>
        <p role="status" className="text-sm text-primary">
          {error}
        </p>
      </footer>
    </section>
  )
}
