import { DemoDock } from "./DemoDock"
import { useState } from "react"
import { Link } from "react-router"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { SceneFlow } from "./SceneFlow"
import { sceneView } from "./scene-model"
import {
  useAgreementDemo,
  loadStartedSceneDemo,
  switchLetterDemoAccount,
  setLetterDemoClock,
  performScene,
} from "./AgreementFlow"
export function SceneDemo() {
  const demo = useAgreementDemo()
  const [clock, setClock] = useState("2026-10-08T09:00")
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <DemoDock title="B 교류 · 두 가상 계정" defaultOpen={!demo.scene}>
        <p className="text-xs leading-6">
          빈 B 개시 예시는 가상 결제·양쪽 동의·개시 기록을 불러옵니다.
          활동·이유·상대 응답은 만들지 않습니다. 새로고침 시 사라집니다.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={loadStartedSceneDemo}>
            빈 B 개시 예시 불러오기
          </Button>
          <Button
            variant="outline"
            onClick={switchLetterDemoAccount}
            disabled={!demo.scene}
          >
            작성 계정 전환
          </Button>
          <Input
            aria-label="가상 시각"
            className="max-w-64"
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
        <p className="text-xs">
          현재 가상 계정 {demo.memberId || "없음"} · {demo.now}
        </p>
        <div className="flex flex-wrap gap-5 text-sm text-primary">
          {(["today", "us", "exchange"] as const).map((path) => (
            <Link key={path} to={`/${path}?demo=agreement`}>
              {{ today: "오늘", us: "두 사람", exchange: "교류" }[path]}
            </Link>
          ))}
          <Link to="/demo/agreement">A/B 합의 제어</Link>
        </div>
      </DemoDock>
      <SceneFlow
        key={`${demo.generation}-${demo.memberId}`}
        view={sceneView(
          demo.scene,
          demo.state,
          demo.memberId,
          new Date(demo.now),
        )}
        onCommand={performScene}
      />
    </main>
  )
}
