import { DemoDock } from "./DemoDock"
import { useState } from "react"
import { Link } from "react-router"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { MeetingAftercare } from "./MemberTrust"
import {
  Day04Panel,
  useAgreementDemo,
  setLetterDemoClock,
  switchLetterDemoAccount,
  performAppointment,
  setContactSafetyDemo,
} from "./AgreementFlow"
export function MeetingDemo() {
  const demo = useAgreementDemo()
  const [reminderHours, setReminderHours] = useState("")
  const [reminderMessage, setReminderMessage] = useState("")
  const [clock, setClock] = useState("2026-10-11T09:00")
  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <DemoDock title="DAY04 · 약속 조율">
        <p className="text-xs leading-6">
          기존 A/B 가상 교류에서 정상 3일을 완료한 기록을 사용해요. 완료·상대
          응답·제안자를 자동 생성하지 않아요. 제어는 회원 화면과 분리되어
          있으며 새로고침하면 기록이 사라져요.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={!demo.state}
            onClick={switchLetterDemoAccount}
          >
            작성 계정 전환
          </Button>
          <Input
            className="max-w-64"
            aria-label="가상 시각"
            type="datetime-local"
            value={clock}
            onChange={(event) => setClock(event.target.value)}
          />
          <Button
            variant="outline"
            onClick={() => setLetterDemoClock(`${clock}:00+09:00`)}
          >
            가상 시각 적용
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            aria-label="마감 임박 기준 시간"
            type="number"
            min={1}
            value={reminderHours}
            onChange={(event) => setReminderHours(event.target.value)}
            placeholder="마감 임박 기준 시간 · 직접 입력"
            className="max-w-72"
          />
          <Button
            variant="outline"
            disabled={!demo.appointment || !reminderHours}
            onClick={() =>
              setReminderMessage(
                performAppointment(
                  {
                    type: "reminder-check",
                    windowHours: Number(reminderHours),
                  },
                  demo.appointment!.revision,
                ) ||
                  "가상 시계 기준 점검만 실행했어요. 해당 건이 없으면 알림을 만들지 않아요. 실제 발송은 없어요.",
              )
            }
          >
            마감 임박 가상 점검
          </Button>
          <p role="status" className="text-xs">
            {reminderMessage}
          </p>
        </div>
        <p className="text-xs">
          가상 계정 {demo.memberId || "없음"} · {demo.now}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={!demo.appointment} onClick={() => setReminderMessage(performAppointment({ type: "contact-check" },demo.appointment!.revision) || "가상 공개 조건을 점검했어요. 충족한 예약만 공개하며 실제 예약 작업·발송은 없어요.")}>연락처 자정 공개 가상 점검</Button>
          {(["clear","cancelled","stopped","blocked","review"] as const).map((value,index) => <Button key={value} size="sm" variant="outline" disabled={!demo.appointment} onClick={() => setReminderMessage(setContactSafetyDemo(value) || "가상 안전 상태를 적용했어요. 공유 동의는 대신 입력하지 않아요.")}>{["안전 상태 정상","약속 취소","중단","차단","안전 검토"][index]}</Button>)}
        </div>
        <div className="flex flex-wrap gap-5 text-sm text-primary">
          <Link to="/demo/letters">A 교류 제어</Link>
          <Link to="/demo/scene">B 교류 제어</Link>
          <Link to="/today?demo=agreement">오늘</Link>
          <Link to="/meeting?demo=agreement">약속</Link>
        </div>
      </DemoDock>
      <Day04Panel key={`${demo.generation}-${demo.memberId}`} />
      <section className="mt-10 space-y-3 border border-accent/20 bg-accent/5 p-5">
        <h2 className="text-lg text-accent">만남 전후 화면 미리보기 · 가상</h2>
        <p className="text-xs leading-6">
          실제 약속이 합의되면 약속 화면 아래에 같은 안전 가이드와 피드백이 나와요. 여기서는 만남 시각을 2026-10-24 14:00으로 두고,
          위 가상 시각 입력값 기준으로 보여 줘요. (15:00 이후로 바꾸면 피드백이 열려요.)
        </p>
        <MeetingAftercare memberId="preview-member-a" partnerId="preview-member-b" programId="virtual-meeting-preview" meetingAt="2026-10-24T14:00:00+09:00" now={new Date(`${clock}:00+09:00`)} />
      </section>
    </main>
  )
}
