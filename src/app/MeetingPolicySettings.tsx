import { useState, useSyncExternalStore } from "react"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import {
  getMeetingPolicy,
  saveMeetingPolicy,
  subscribeMeetingPolicy,
  type MeetingPolicy,
} from "./meeting-policy"
export function MeetingPolicySettings() {
  const current = useSyncExternalStore(
    subscribeMeetingPolicy,
    getMeetingPolicy,
    getMeetingPolicy,
  )
  const [draft, setDraft] = useState<MeetingPolicy>({ ...current })
  const [message, setMessage] = useState("")
  const fields = [
    ["decisionHours", "DAY04 만남 의사"],
    ["methodHours", "약속 방식 선택"],
    ["proposalHours", "1차 제안 작성"],
    ["replyHours", "제안·수정안 응답"],
    ["coordinationTargetHours", "전체 조율 목표 · 자동 취소 아님"],
  ] as const
  return (
    <section className="space-y-4 rounded-xl border border-border bg-background p-6">
      <h2 className="text-lg font-semibold">DAY04 · 약속 기한 설정</h2>
      <p className="text-xs leading-6 text-muted-foreground">
        Owner 1명 가상 설정이에요. 새 가상 교류에만 적용하며 기존 교류의 정책
        스냅샷과 기한은 바꾸지 않아요. 서버 관리자 권한·저장·감사로그는 별도
        구현이 필요해요.
      </p>
      <label className="block space-y-2 text-xs">
        새 정책 버전
        <Input
          value={draft.policyVersion}
          onChange={(event) =>
            setDraft({ ...draft, policyVersion: event.target.value })
          }
        />
      </label>
      {fields.map(([key, label]) => (
        <label key={key} className="block space-y-2 text-xs">
          {label} (시간)
          <Input
            type="number"
            min={1}
            max={720}
            value={draft[key]}
            onChange={(event) =>
              setDraft({ ...draft, [key]: Number(event.target.value) })
            }
          />
        </label>
      ))}
      <Button
        onClick={() => {
          const error = saveMeetingPolicy(draft)
          setMessage(
            error ||
              "새 가상 교류의 기본값을 변경했어요. 기존 건은 변경하지 않았어요.",
          )
        }}
      >
        새 가상 교류에 적용
      </Button>
      <p role="status" className="text-xs text-primary">
        {message}
      </p>
      <p className="text-xs">
        현재 기본값 {current.policyVersion} ·{" "}
        {fields.map(([key]) => `${current[key]}시간`).join(" / ")}
      </p>
    </section>
  )
}
