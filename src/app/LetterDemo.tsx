import { Link } from "react-router"
import { useState } from "react"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { Label } from "./components/ui/label"
import { LetterFlow } from "./LetterFlow"
import { letterView } from "./letter-model"
import {
  loadStartedLetterDemo,
  performLetter,
  setLetterDemoClock,
  switchLetterDemoAccount,
  runLetterNoticeDemo,
  useAgreementDemo,
} from "./AgreementFlow"

export function LetterDemo() {
  const [reminderMessage, setReminderMessage] = useState("")
  const demo = useAgreementDemo()
  const [clock, setClock] = useState("2026-10-08T09:00")
  const view = letterView(
    demo.letters,
    demo.state,
    demo.memberId,
    new Date(demo.now),
  )
  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl px-5 py-8">
      <section
        className="border border-accent/20 bg-accent/5 p-5"
        aria-label="개발용 편지 제어"
      >
        <p className="text-sm font-semibold text-accent">
          개발용 A 편지 · 두 가상 계정의 메모리 데모
        </p>
        <p className="mt-2 text-xs leading-6">
          실제 결제·회원·서버 시간·두 계정 동기화·영구 저장은 없습니다. 가상
          개시 기록만 불러오며 편지·답장은 생성하지 않습니다. 각 계정으로 직접
          작성하고 전송해야 합니다.
        </p>
        <p className="mt-3 text-xs">
          가상 시계: {demo.now} · 현재 계정{" "}
          {demo.memberId === demo.state?.members[1] ? "예시 나" : "예시 가"}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadStartedLetterDemo}>
            빈 A 교류 개시 예시 불러오기
          </Button>
          <Button
            variant="outline"
            disabled={!demo.state}
            onClick={switchLetterDemoAccount}
          >
            가상 계정 전환
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setLetterDemoClock(
                new Date(Date.parse(demo.now) + 86400000).toISOString(),
              )
            }
          >
            가상 시계 하루 이동
          </Button>
          <Button
            variant="outline"
            disabled={!demo.state}
            onClick={() => setReminderMessage(runLetterNoticeDemo())}
          >
            지금 시각 알림 점검
          </Button>
        </div>
        {reminderMessage && <p role="status" className="mt-3 text-xs text-primary">{reminderMessage}</p>}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Label className="block w-full min-w-0 text-xs sm:w-auto">
            가상 시각 입력 · Asia/Seoul
            <Input
              type="datetime-local"
              className="mt-2 bg-card"
              value={clock}
              onChange={(event) => setClock(event.target.value)}
            />
          </Label>
          <Button
            variant="outline"
            disabled={!Number.isFinite(Date.parse(`${clock}:00+09:00`))}
            onClick={() => setLetterDemoClock(`${clock}:00+09:00`)}
          >
            가상 시각 적용
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-xs">
          {[
            ["today", "오늘"],
            ["us", "두 사람"],
            ["exchange", "교류"],
          ].map(([path, label]) => (
            <Link
              key={path}
              to={`/${path}?demo=agreement`}
              className="text-primary underline underline-offset-4"
            >
              {label}에서 같은 가상 상태 확인
            </Link>
          ))}
          <Link
            to="/demo/agreement"
            className="text-primary underline underline-offset-4"
          >
            기존 A/B 합의 제어
          </Link>
        </div>
      </section>
      <LetterFlow
        key={`${demo.generation}-${demo.memberId}-${view?.programId || "empty"}`}
        view={view}
        nowLabel={demo.now}
        onCommand={performLetter}
      />
    </main>
  )
}
