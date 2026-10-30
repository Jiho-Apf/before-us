import { useEffect, useState } from "react"
import { Link } from "react-router"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { Textarea } from "./components/ui/textarea"
import { MeetingChoice } from "./MeetingChoice"
import {
  SCENE_ACTIVITIES,
  FLOW_OPTIONS,
  REST_OPTIONS,
  activityLabel,
  emptySceneDraft,
  type SceneCommand,
  type SceneView,
} from "./scene-model"

function ActivityImage({ activity }: { activity: string }) {
  const [failed, setFailed] = useState(false)
  const item =
    SCENE_ACTIVITIES.find((item) => item.id === activity) || SCENE_ACTIVITIES[0]
  return (
    <div className="relative aspect-[4/3] overflow-hidden bg-primary/10">
      {failed ? (
        <div className="flex h-full items-center justify-center gap-4 text-primary">
          <span className="h-16 w-16 rounded-full bg-primary" />
          <span className="h-16 w-16 rounded-full border-2 border-primary" />
        </div>
      ) : (
        <img
          src={item.image}
          alt={`${item.label} 분위기 이미지 · 실제 장소 추천 아님`}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
      <span className="absolute bottom-0 left-0 bg-background/90 px-2 py-1 text-xs">
        {item.credit} · 이미지 예시
      </span>
    </div>
  )
}
type SceneFlowProps = {
  view: SceneView | null
  onCommand?: (command: SceneCommand, revision: number) => string | null
}
export function SceneFlow({ view, onCommand }: SceneFlowProps) {
  const [day, setDay] = useState(
    view && view.todayIndex >= 0 ? view.todayIndex : 0,
  )
  const [draft, setDraft] = useState(view?.ownDrafts[day] || emptySceneDraft())
  const [confirmed, setConfirmed] = useState(false)
  const [notice, setNotice] = useState("")
  const [actual, setActual] = useState({
    activity: "",
    region: "",
    duration: "",
    budget: "",
  })
  useEffect(() => setConfirmed(false), [view?.board?.version])
  if (!view)
    return (
      <section className="py-12">
        <h2 className="text-2xl">B 교류 시작을 기다리고 있어요.</h2>
        <p className="mt-4 text-sm text-muted-foreground">
          양쪽 결제·B 선택·시작일 동의와 실제 개시가 확인된 한 쌍만 이용할 수
          있어요. 가상 상대의 선택은 생성하지 않아요.
        </p>
      </section>
    )
  const send = (command: SceneCommand) => {
    const error = onCommand
      ? onCommand(command, view.revision)
      : "현재 읽기 전용이에요."
    setNotice(
      error || "가상 기록을 반영했어요. 실제 저장·발송은 하지 않아요.",
    )
    if (!error) setConfirmed(false)
  }
  const update = (key: keyof typeof draft, value: string) => {
    setDraft({ ...draft, [key]: value })
    setConfirmed(false)
  }
  const writable = view.days[day].writable && !!onCommand
  const slot = (["flow", "rest", "topic"] as const)[view.turnIndex]
  const select = (
    label: string,
    value: string,
    choices: string[],
    key: keyof typeof draft,
  ) => (
    <label className="block space-y-2 text-sm">
      <span>{label}</span>
      <select
        className="h-11 w-full rounded-xl border border-border bg-background px-3"
        value={value}
        onChange={(event) => update(key, event.target.value)}
        disabled={!writable}
      >
        <option value="">직접 선택해 주세요</option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    </label>
  )
  const reason = (
    <label className="block space-y-2 text-sm">
      짧은 이유 · 200자 이내
      <Textarea
        value={draft.reason}
        maxLength={200}
        disabled={!writable}
        onChange={(event) => update("reason", event.target.value)}
        placeholder="왜 이 선택에 마음이 가나요?"
      />
    </label>
  )
  const controls = (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="outline"
        disabled={!writable}
        onClick={() => send({ type: "save", day, draft })}
      >
        임시 저장
      </Button>
      <span className="self-center text-xs text-muted-foreground">
        미공유 초안은 작성자에게만 표시돼요.
      </span>
    </div>
  )
  return (
    <main className="space-y-8 py-8">
      <header className="grid overflow-hidden bg-primary text-primary-foreground md:grid-cols-[7fr_5fr]">
        <div className="p-7 md:p-10">
          <p className="text-xs tracking-widest">B / OUR FIRST SCENE</p>
          <h1 className="mt-6 text-3xl leading-relaxed md:text-4xl">
            일요일 오후 세 시간이 생긴다면,
            <br />
            우리는 어떤 시간을 함께 보내고 싶을까요?
          </h1>
          <p className="mt-6 text-sm leading-7">
            취향이 꼭 같을 필요는 없어요. 서로의 선택에서 이야기를 시작해요.
          </p>
          <p className="mt-5 text-xs leading-6 opacity-85">
            상상 속 상황이에요. 실제 약속·만남 의사·날짜·예약이 아니에요.
          </p>
        </div>
        <div className="flex flex-col justify-end bg-accent p-8">
          <span className="text-8xl font-light">03</span>
          <p className="mt-5 text-sm">활동 → 쉬는 시간 → 나누고 싶은 이야기</p>
          <p className="mt-3 text-xs">
            3일 동안, 두 사람의 선택으로 만드는 한 장면.
          </p>
        </div>
      </header>
      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="교류 날짜"
      >
        {view.days.map((item, index) => (
          <button
            key={item.date}
            role="tab"
            aria-selected={day === index}
            className={`rounded-xl border px-5 py-3 text-left transition-colors duration-200 motion-reduce:transition-none ${
              day === index
                ? "border-primary bg-primary/5 text-primary"
                : "border-border"
            }`}
            onClick={() => {
              setDay(index)
              setDraft(view.ownDrafts[index] || emptySceneDraft())
              setConfirmed(false)
            }}
          >
            <span className="block text-sm">
              DAY 0{index + 1}{" "}
              {item.future ? "· 잠금" : view.completed[index] ? "· 완료" : ""}
            </span>
            <span className="text-xs">{item.date} · 09:00–23:59</span>
          </button>
        ))}
      </div>
      <section className="space-y-6 border-t border-border pt-7">
        <div className="flex items-baseline gap-5">
          <span className="text-5xl font-light text-primary">0{day + 1}</span>
          <h2 className="text-2xl">{view.days[day].title}</h2>
        </div>
        {!writable && (
          <p className="rounded-xl bg-muted p-4 text-sm">
            {view.days[day].reason || "공유 기록을 읽을 수 있어요."}
          </p>
        )}
        {view.readAccess && day === 0 && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              {SCENE_ACTIVITIES.map((item) => (
                <button
                  key={item.id}
                  disabled={!writable}
                  aria-pressed={draft.activity === item.id}
                  className={`overflow-hidden border text-left transition-colors duration-200 motion-reduce:transition-none ${
                    draft.activity === item.id
                      ? "border-primary ring-2 ring-primary/20"
                      : "border-border"
                  }`}
                  onClick={() => update("activity", item.id)}
                >
                  <ActivityImage activity={item.id} />
                  <div className="bg-accent px-4 py-3 text-white">
                    <span className="text-lg">{item.label}</span>
                    <p className="mt-1 text-xs">{item.caption}</p>
                  </div>
                </button>
              ))}
            </div>
            {writable && (
              <div className="max-w-2xl space-y-4">
                {reason}
                {controls}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  이 선택과 이유를 상대에게 공유할게요.
                </label>
                <Button
                  disabled={
                    !confirmed || !draft.activity || !draft.reason.trim()
                  }
                  onClick={() =>
                    send({
                      type: "share-activity",
                      activity: draft.activity,
                      reason: draft.reason,
                    })
                  }
                >
                  선택 공유하기
                </Button>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {view.choices.map((choice, index) => (
                <div key={index} className="border border-border p-5">
                  <p className="text-xs text-accent">
                    {choice
                      ? choice.own
                        ? "내가 공유한 선택"
                        : "상대가 공유한 선택"
                      : "선택 공유 대기"}
                  </p>
                  {choice ? (
                    <>
                      <h3 className="mt-3 text-xl">
                        {activityLabel(choice.activity)}
                      </h3>
                      <p className="mt-3 whitespace-pre-wrap text-sm">
                        {choice.reason}
                      </p>
                    </>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      아직 공유되지 않았어요.
                    </p>
                  )}
                </div>
              ))}
            </div>
            {view.different && (
              <div className="bg-muted p-5 text-sm leading-7">
                <p>
                  다른 선택도 이야기의 시작이에요. 조합하거나 새로운 대안을
                  제안할 수 있어요.
                </p>
                <p className="text-muted-foreground">
                  대안 예시 · 선택/합의 아님: 전시를 보고 가까운 길을 잠깐
                  걸어볼까요?
                </p>
              </div>
            )}
          </>
        )}
        {view.readAccess && day === 1 && (
          <>
            <p className="text-sm leading-7">
              활동 흐름 → 쉬는 공간 → 대화 소재를 두 사람이 번갈아 제안해요.
              역할은 성별과 관계없어요. 공유된 선택에 짧은 의견을 더해 주세요.
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              {view.turns.map((turn, index) => (
                <article key={index} className="border border-border p-5">
                  <p className="text-xs text-accent">
                    0{index + 1} · {turn.own ? "내 제안" : "상대 제안"}
                  </p>
                  <h3 className="mt-3 text-lg">{turn.value}</h3>
                  <p className="mt-3 whitespace-pre-wrap text-sm">
                    {turn.reason}
                  </p>
                  <p className="mt-3 border-t border-border pt-3 text-sm">
                    공유한 선택에 대한 의견: {turn.opinion}
                  </p>
                </article>
              ))}
            </div>
            {writable &&
              view.turnIndex < 3 &&
              (view.myTurn ? (
                <div className="max-w-2xl space-y-4">
                  {slot === "topic" ? (
                    <label className="block text-sm">
                      나누고 싶은 이야기
                      <Input
                        value={draft.value}
                        maxLength={80}
                        onChange={(event) =>
                          update("value", event.target.value)
                        }
                      />
                    </label>
                  ) : (
                    select(
                      slot === "flow" ? "활동 흐름" : "쉬는 공간 유형",
                      draft.value,
                      slot === "flow" ? FLOW_OPTIONS : REST_OPTIONS,
                      "value",
                    )
                  )}
                  {reason}
                  <label className="block space-y-2 text-sm">
                    공유한 선택에 대한 의견
                    <Textarea
                      value={draft.opinion}
                      maxLength={200}
                      onChange={(event) =>
                        update("opinion", event.target.value)
                      }
                    />
                  </label>
                  {controls}
                  <Button
                    disabled={
                      !draft.value ||
                      !draft.reason.trim() ||
                      !draft.opinion.trim()
                    }
                    onClick={() =>
                      send({
                        type: "propose-turn",
                        slot,
                        value: draft.value,
                        reason: draft.reason,
                        opinion: draft.opinion,
                      })
                    }
                  >
                    이 제안과 의견 공유하기
                  </Button>
                </div>
              ) : (
                <p className="bg-muted p-5 text-sm">
                  상대의 제안 차례를 기다리고 있어요. 응답은 대신 작성하지
                  않아요.
                </p>
              ))}
          </>
        )}
        {view.readAccess && day === 2 && (
          <>
            <p className="text-sm">
              한 장으로 정리하고 같은 최신 버전을 각자 승인해요. 수정 제안은
              기존 승인을 해제해요.
            </p>
            {view.board && (
              <article className="grid border border-border md:grid-cols-2">
                <ActivityImage activity={view.board.values.activity} />
                <div className="p-6">
                  <p className="text-xs text-primary">
                    공동 보드 v{view.board.version} · 상상 속 장면
                  </p>
                  {[
                    `${activityLabel(view.board.values.activity)}${
                      view.board.values.activityMinutes
                        ? ` ${view.board.values.activityMinutes}분`
                        : ""
                    }`,
                    `${view.board.values.rest}${
                      view.board.values.restMinutes
                        ? ` ${view.board.values.restMinutes}분`
                        : ""
                    }`,
                    view.board.values.topic,
                  ].map((value, index) => (
                    <p
                      key={index}
                      className="mt-4 border-b border-border pb-3 text-lg"
                    >
                      <span className="mr-4 text-accent">0{index + 1}</span>
                      {value}
                    </p>
                  ))}
                  <p className="mt-4 whitespace-pre-wrap text-sm">
                    {view.board.reason}
                  </p>
                  <p className="mt-4 text-xs">
                    내 승인 {view.board.ownApproved ? "완료" : "대기"} · 상대
                    승인 {view.board.peerApproved ? "완료" : "대기"}
                  </p>
                  {writable && !view.board.ownApproved && (
                    <div className="mt-4 space-y-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(event) =>
                            setConfirmed(event.target.checked)
                          }
                        />
                        v{view.board.version} 장면을 확인했어요.
                      </label>
                      <Button
                        disabled={!confirmed}
                        onClick={() =>
                          send({
                            type: "approve-board",
                            version: view.board!.version,
                            confirmed,
                          })
                        }
                      >
                        이 버전 승인하기
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            )}
            {writable && (
              <details
                className="rounded-xl border border-border p-5"
                open={!view.board}
              >
                <summary className="cursor-pointer text-sm font-medium">
                  {view.board ? "수정 장면 제안하기" : "첫 장면 제안하기"}
                </summary>
                <div className="mt-5 max-w-2xl space-y-4">
                  <label className="block space-y-2 text-sm">
                    활동
                    <select
                      className="h-11 w-full rounded-xl border border-border bg-background px-3"
                      value={draft.activity}
                      onChange={(event) =>
                        update("activity", event.target.value)
                      }
                    >
                      <option value="">선택해 주세요</option>
                      {SCENE_ACTIVITIES.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                      <option value="exhibition-walk">전시 + 산책</option>
                    </select>
                  </label>
                  {select("쉬는 시간", draft.rest, REST_OPTIONS, "rest")}
                  <label className="block space-y-2 text-sm">
                    나누고 싶은 이야기
                    <Input
                      value={draft.topic}
                      maxLength={80}
                      onChange={(event) => update("topic", event.target.value)}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {(["activityMinutes", "restMinutes"] as const).map(
                      (key, index) => (
                        <label key={key} className="text-sm">
                          {index === 0 ? "활동" : "쉬는 시간"} 분량 · 선택
                          <Input
                            type="number"
                            min={1}
                            max={180}
                            value={draft[key]}
                            onChange={(event) =>
                              update(key, event.target.value)
                            }
                          />
                        </label>
                      ),
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    상상 속 3시간 이내. 실제 만남 길이는 새로 정해요.
                  </p>
                  {reason}
                  {controls}
                  <Button
                    onClick={() =>
                      send({
                        type: "propose-board",
                        values: {
                          activity: draft.activity,
                          rest: draft.rest,
                          topic: draft.topic,
                          activityMinutes: draft.activityMinutes
                            ? Number(draft.activityMinutes)
                            : null,
                          restMinutes: draft.restMinutes
                            ? Number(draft.restMinutes)
                            : null,
                        },
                        reason: draft.reason,
                      })
                    }
                  >
                    새 버전 공유하기
                  </Button>
                </div>
              </details>
            )}
            <div className="space-y-2">
              {view.versions.map((version) => (
                <details
                  key={version.version}
                  className="border border-border p-3"
                >
                  <summary className="cursor-pointer text-xs">
                    공유 기록 v{version.version} · {version.at} · 읽기 전용
                  </summary>
                  <p className="mt-3 text-sm">
                    {activityLabel(version.values.activity)} →{" "}
                    {version.values.rest} → {version.values.topic}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {version.reason}
                  </p>
                </details>
              ))}
            </div>
          </>
        )}
      </section>
      <section className="border-t border-border pt-6">
        <h2 className="text-xl">다음 장면은 두 사람이 선택해요.</h2>
        <p className="mt-3 text-sm leading-7">
          {view.complete
            ? "세 날의 선택과 같은 버전의 승인을 마쳤어요."
            : "정상 3일 완료를 기다리고 있어요."}{" "}
          만남 선택: {view.decisionAt} · Asia/Seoul
        </p>
        {view.delayed && (
          <p className="mt-3 text-sm text-destructive">
            미공유·미합의로 교류가 지연됐어요. 자동 완료하지 않아요. 문의 또는
            중단 요청을 선택할 수 있어요.
          </p>
        )}
        {view.meetingOpen && <MeetingChoice view={view} onSend={send} />}
      </section>
      {view.recommendation && (
        <section className="space-y-4 border border-accent/20 bg-accent/5 p-6">
          <h2 className="text-xl">실제 만남은 새로 조율해요.</h2>
          <p className="text-sm leading-7">
            두 분이 함께 고른 장면 v{view.recommendation.boardVersion}을 실제 약속을
            정할 때 참고할 수 있어요. 상상 속 일요일·세 시간은 실제 일정이 아니고,
            장소와 시간은 두 분이 직접 정해요. 플라비는 장소를 추천하거나 예약하지 않아요.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["activity", "region", "duration", "budget"] as const).map(
              (key, index) => (
                <label key={key} className="text-sm">
                  {
                    [
                      "실제 함께할 활동",
                      "넓은 지역",
                      "실제 만남 길이 (분)",
                      "1인 예산 (원)",
                    ][index]
                  }
                  <Input
                    type={index > 1 ? "number" : "text"}
                    value={actual[key]}
                    onChange={(event) => {
                      setActual({ ...actual, [key]: event.target.value })
                      setConfirmed(false)
                    }}
                  />
                </label>
              ),
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            상상 속 장면과 별도로 이 제안을 확인했어요.
          </label>
          <Button
            disabled={
              !confirmed || Object.values(actual).some((value) => !value.trim())
            }
            onClick={() =>
              send({
                type: "actual-proposal",
                ...actual,
                duration: Number(actual.duration),
                budget: Number(actual.budget),
                confirmed,
              })
            }
          >
            실제 조건 제안하기
          </Button>
          {[view.actualProposals?.own, view.actualProposals?.peer].map(
            (proposal, index) =>
              proposal && (
                <p key={index} className="text-sm">
                  {index === 0 ? "내" : "상대"} 실제 조건 제안:{" "}
                  {proposal.activity} · {proposal.region} · {proposal.duration}
                  분 · {proposal.budget.toLocaleString()}원 (공동 확정 아님)
                </p>
              ),
          )}
        </section>
      )}
      <footer className="space-y-4 border-t border-border pt-5">
        <div className="flex flex-wrap gap-3">
          {(["contact", "report", "interrupt", "block"] as const).map(
            (type, index) => (
              <Button
                key={type}
                variant="outline"
                disabled={!onCommand}
                onClick={() => {
                  if (
                    type === "contact" ||
                    window.confirm(
                      "가상 요청을 기록할까요? 중단·차단은 새 제출과 만남 선택을 멈춰요.",
                    )
                  )
                    send({ type })
                }}
              >
                {
                  ["운영자 문의", "신고 요청", "교류 중단 요청", "차단 요청"][
                    index
                  ]
                }
              </Button>
            ),
          )}
        </div>
        <p className="text-xs leading-6 text-muted-foreground">
          일정 재설정 정책은 검토 중이에요. 고지된 정책·양쪽 동의·운영 기록 없이
          일정을 변경하지 않아요.
        </p>
        <Button asChild variant="outline"><Link to="/support?demo=agreement">문의·신고 자세히 접수</Link></Button>
        <p role="status" className="text-sm text-primary">
          {notice}
        </p>
      </footer>
    </main>
  )
}
