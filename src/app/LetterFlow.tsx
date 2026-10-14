import { MeetingChoice } from "./MeetingChoice"
import { useEffect, useState } from "react"
import { Link } from "react-router"
import {
  ArrowRight,
  Check,
  Clock3,
  Shield,
  BookOpen,
  LockKeyhole,
} from "lucide-react"
import { Button } from "./components/ui/button"
import { Textarea } from "./components/ui/textarea"
import { Checkbox } from "./components/ui/checkbox"
import { LETTER_REPLY, type LetterCommand, type LetterView } from "./letter-model"

const formatTime = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "확인된 시각 없음"

type LetterFlowProps = {
  view: LetterView | null
  nowLabel: string
  onCommand?: (command: LetterCommand, revision: number) => string | null
}
function ReplyBox({ onSend }: { onSend: (body: string, confirmed: boolean) => void }) {
  const [body, setBody] = useState("")
  const [ok, setOk] = useState(false)
  return (
    <div className="mt-6 space-y-3 rounded-xl border border-border p-4">
      <p className="text-xs font-semibold">이 편지에 답장하기 · 한 번만</p>
      <Textarea
        aria-label="상대 편지에 답장"
        value={body}
        maxLength={LETTER_REPLY.maxLength}
        onChange={(event) => { setBody(event.target.value); setOk(false) }}
        placeholder="편지를 읽고 떠오른 마음을 짧게 전해 보세요."
        className="min-h-28 bg-background leading-7"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{body.length}/{LETTER_REPLY.maxLength}</span>
        <span>오늘 23:59까지 · 두 분 모두 답장하면 함께 열려요</span>
      </div>
      <label className="flex items-start gap-3 text-xs leading-6">
        <Checkbox checked={ok} onCheckedChange={(value) => setOk(value === true)} />
        답장은 한 번만 보낼 수 있고, 보낸 뒤에는 고칠 수 없어요. 답장에 다시 답장할 수는 없고, 23:59까지 답장하지 않으면 이 편지에는 답장을 남길 수 없어요.
      </label>
      <Button size="sm" disabled={!body.trim() || !ok} onClick={() => onSend(body, ok)}>
        답장 보내기
      </Button>
    </div>
  )
}

export function LetterFlow({ view, nowLabel, onCommand }: LetterFlowProps) {
  const [selected, setSelected] = useState(() =>
    view?.todayIndex !== undefined && view.todayIndex >= 0
      ? view.todayIndex
      : 0,
  )
  const row = view?.rows[selected]
  const [draft, setDraft] = useState(row?.draft || "")
  const [preview, setPreview] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [safety, setSafety] = useState<"interrupt" | "block" | null>(null)
  const [message, setMessage] = useState("")
  useEffect(() => {
    setDraft(row?.draft || "")
    setPreview(false)
    setConfirmed(false)
    setSafety(null)
  }, [row?.index, row?.date, view?.programId])
  const send = (command: LetterCommand) => {
    if (!view || !onCommand) {
      setMessage(
        "실제 서비스 접수는 연결되지 않았습니다. 진행 상태와 문의 안내를 확인해 주세요.",
      )
      return
    }
    const error = onCommand(command, view.revision)
    setMessage(
      error ||
        (command.type === "save"
          ? "가상 초안을 임시 저장했어요. 작성자만 확인할 수 있습니다."
          : command.type === "submit"
            ? "오늘의 편지를 보냈어요. 양쪽 제출이 확인되면 함께 공개합니다. 실제 발송·저장은 연결되지 않았습니다."
            : command.type === "reply"
              ? "답장을 보냈어요. 두 분 모두 답장하면 함께 열려요."
            : command.type === "meeting-choice"
              ? "만남 의사를 전달했어요. 상대의 응답을 임의로 만들지 않습니다."
              : command.type === "block"
                ? "가상 차단 요청을 기록했습니다. 신규 교류를 멈추고 기존 글 접근은 재검토합니다. 이미 본 화면·캡처까지 회수하지는 못합니다."
                : command.type === "interrupt"
                  ? "가상 중단 요청을 기록했습니다. 정상 완료·자동 환불로 처리하지 않습니다."
                  : command.type === "report"
                    ? "가상 신고 요청을 기록했습니다. 실제 안전 담당자 접수·검토는 연결되지 않았습니다."
                    : "가상 문의 요청을 기록했습니다. 실제 상담 접수는 연결되지 않았습니다."),
    )
    if (!error && command.type === "submit") {
      setConfirmed(false)
      setPreview(false)
    }
  }
  return (
    <section className="py-8" aria-labelledby="letter-flow-title">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-accent">
          <BookOpen size={16} />A / THREE LETTERS
        </p>
        <span className="text-xs text-muted-foreground">
          가상 편지 · {formatTime(nowLabel)} · Asia/Seoul
        </span>
      </div>
      <h1 id="letter-flow-title" className="text-3xl font-semibold">
        편지 나누기
      </h1>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">
        각자 하루 한 통, 3일 동안 각자 세 통. 한 쌍이 나누는 여섯 통의
        이야기입니다.
      </p>
      {!view ? (
        <div className="mt-7 border border-border bg-muted p-6">
          <p className="text-sm font-semibold">
            확인된 A 교류가 아직 시작되지 않았어요.
          </p>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            양쪽 결제·A 선택·시작일 동의와 실제 개시 기록이 있는 한 쌍만
            이용합니다. 예시 편지나 상대 응답을 자동 생성하지 않습니다.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link to="/demo/agreement">
              A/B 합의 데모 확인 <ArrowRight size={15} />
            </Link>
          </Button>
        </div>
      ) : (
        <>
          {view.status !== "active" && (
            <div className="mt-5 border border-border bg-muted p-5 text-sm leading-7">
              <p className="font-semibold">
                {view.status === "blocked"
                  ? "차단 요청 · 기존 글 접근 재검토"
                  : "교류 중단 요청 · 신규 제출 중지"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                새 제출과 만남 선택은 중지합니다. 과거 글 접근·보존과 신고·문의
                처리는 별도 정책과 권한으로 관리합니다.
              </p>
            </div>
          )}
          <div
            className="mt-6 grid grid-cols-3 gap-3"
            role="group"
            aria-label="일자별 편지"
          >
            {view.rows.map((day) => (
              <Button
                key={`${day.index}-${day.date}`}
                variant="outline"
                aria-pressed={selected === day.index}
                onClick={() => {
                  setSelected(day.index)
                  setMessage("")
                }}
                className={`h-auto flex-col items-start rounded-xl p-4 ${
                  selected === day.index
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border"
                } transition-colors duration-200 motion-reduce:transition-none`}
              >
                <span className="text-xs font-semibold">
                  DAY 0{day.index + 1}
                </span>
                <time className="mt-1 text-xs font-normal" dateTime={day.date}>
                  {day.date}
                </time>
                <span className="mt-2 text-xs font-normal">
                  {day.status === "access-review"
                    ? "접근 재검토"
                    : day.status === "published"
                      ? "함께 공개"
                      : day.status === "own-submitted"
                        ? "내 제출 확인"
                        : day.status === "future"
                          ? "아직 잠겨 있어요"
                          : day.status === "delayed"
                            ? "교류 지연"
                            : "제출 전"}
                </span>
              </Button>
            ))}
          </div>
          {row && (
            <article className="mt-6 border border-border bg-card">
              <header className="flex items-center gap-5 bg-primary px-6 py-6 text-primary-foreground sm:px-8">
                <span
                  className="text-6xl font-light leading-none"
                  aria-hidden="true"
                >
                  0{selected + 1}
                </span>
                <div>
                  <p className="text-xs text-white/85 dark:text-white">
                    DAY 0{selected + 1} · {row.date}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold sm:text-2xl">
                    {row.title}
                  </h2>
                </div>
              </header>
              <div className="mx-auto max-w-2xl px-5 py-8 sm:px-8">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 size={14} />
                  오늘의 작성 시간 · 09:00~23:59, Asia/Seoul
                </p>
                {row.question ? (
                  <p className="mt-6 text-lg font-medium leading-8">
                    {row.question}
                  </p>
                ) : (
                  <p className="mt-6 text-sm leading-7">
                    {view.readAccess
                      ? "어제 실제로 공개된 편지가 없어 답장을 요청하지 않습니다. 교류 지연 상태와 문의 경로를 확인해 주세요."
                      : "현재 글 접근 권한을 재검토하고 있어요. 문의 경로를 확인해 주세요."}
                  </p>
                )}
                {row.exchange ? (
                  <div className="mt-7 space-y-8">
                    <div className="border-b border-border pb-5">
                      <p className="text-xs font-semibold text-accent">
                        같은 날 양쪽 제출 · 함께 공개
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        공개 시각 {formatTime(row.publishedAt!)} · 가상 기록
                      </p>
                    </div>
                    <section aria-label="상대가 보낸 편지">
                      <h3 className="text-sm font-semibold text-primary">
                        상대의 편지
                      </h3>
                      <p className="mt-4 whitespace-pre-wrap break-words text-base leading-8">
                        {row.exchange.peer}
                      </p>
                      {row.exchange.ownReply ? (
                        <div className="mt-6 border-l-2 border-primary/40 pl-4">
                          <p className="text-xs text-muted-foreground">
                            내 답장 · {formatTime(row.exchange.ownReply.at)} ·{" "}
                            {row.exchange.replyStatus === "open"
                              ? "함께 열렸어요"
                              : row.exchange.replyStatus === "closed-peer-missing"
                                ? "상대가 답장을 남기지 않아 열리지 않았어요"
                                : "상대도 답장하면 함께 열려요"}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-7">
                            {row.exchange.ownReply.body}
                          </p>
                        </div>
                      ) : row.exchange.canReply ? (
                        <ReplyBox
                          key={`${row.index}-${view.revision}`}
                          onSend={(body, ok) => send({ type: "reply", day: row.index, body, confirmed: ok })}
                        />
                      ) : row.exchange.replyStatus === "closed-own-missing" ? (
                        <p className="mt-6 rounded-xl bg-muted p-4 text-xs leading-6 text-muted-foreground">
                          답장 시간(23:59)이 지나 이 편지에는 더 이상 답장할 수 없어요. 상대의 답장은 두 분 모두 답장했을 때만 열려요.
                        </p>
                      ) : null}
                    </section>
                    <section
                      className="border-t border-border pt-6"
                      aria-label="내가 보낸 편지"
                    >
                      <h3 className="text-sm font-semibold">내 편지</h3>
                      <p className="mt-4 whitespace-pre-wrap break-words text-base leading-8">
                        {row.exchange.own}
                      </p>
                      {row.exchange.peerReply ? (
                        <div className="mt-6 rounded-xl bg-primary/5 p-4">
                          <p className="text-xs font-semibold text-primary">
                            상대의 답장 · 두 분의 답장이 함께 열렸어요
                          </p>
                          <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-7">
                            {row.exchange.peerReply.body}
                          </p>
                          <p className="mt-3 text-[11px] text-muted-foreground">
                            답장에는 다시 답장할 수 없어요. 이어지는 이야기는 다음 편지에 담아 주세요.
                          </p>
                        </div>
                      ) : null}
                    </section>
                  </div>
                ) : row.ownSubmittedAt ? (
                  <div className="mt-7">
                    <p className="flex items-start gap-2 text-sm font-semibold">
                      <Check size={17} className="mt-1 shrink-0 text-primary" />
                      {view.status === "active"
                        ? "내 편지를 보냈어요. 상대의 편지를 기다리고 있어요."
                        : "내 제출 기록이 있습니다. 현재 신규 교류는 중단된 상태입니다."}
                    </p>
                    <p className="mt-3 text-xs leading-6 text-muted-foreground">
                      상대 본문은 아직 제공하지 않습니다. 상대가 입력 중인지도
                      표시하지 않습니다. 전송한 편지는 수정·중복 제출할 수
                      없어요.
                    </p>
                    <details className="mt-6 border-t border-border pt-5">
                      <summary className="cursor-pointer text-xs font-medium">
                        내가 보낸 편지 확인 · 나만 열람
                      </summary>
                      <p className="mt-4 whitespace-pre-wrap break-words text-base leading-8">
                        {row.ownSentBody}
                      </p>
                    </details>
                  </div>
                ) : row.writable ? (
                  <div className="mt-7 space-y-4">
                    <p className="text-sm leading-7">
                      잘 쓴 편지보다, 지금의 나를 담은 이야기를 보내 주세요.
                    </p>
                    <label
                      htmlFor="letter-draft"
                      className="block text-sm font-medium"
                    >
                      오늘의 이야기
                    </label>
                    <Textarea
                      id="letter-draft"
                      value={draft}
                      onChange={(event) => {
                        setDraft(event.target.value)
                        setConfirmed(false)
                        setPreview(false)
                      }}
                      placeholder="가상 내용으로만 시연해 주세요. 실제 연락처·민감정보는 적지 마세요."
                      className="min-h-64 rounded-xl bg-card p-4 text-base leading-8"
                    />
                    <p className="text-xs leading-6 text-muted-foreground">
                      {draft.length}자 · 300~600자는 권장입니다. 최소 분량이나
                      평가 기준이 아니며 짧은 편지도 보낼 수 있어요.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        variant="outline"
                        onClick={() =>
                          send({ type: "save", day: selected, body: draft })
                        }
                      >
                        임시 저장
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!draft.trim()}
                        aria-expanded={preview}
                        onClick={() => setPreview((value) => !value)}
                      >
                        미리보기
                      </Button>
                    </div>
                    {preview && (
                      <section
                        className="border-y border-border py-5"
                        aria-label="나만 보는 편지 미리보기"
                      >
                        <p className="text-xs font-semibold text-accent">
                          나만 보는 미리보기 · 아직 보내지 않았어요
                        </p>
                        <p className="mt-4 whitespace-pre-wrap break-words text-base leading-8">
                          {draft}
                        </p>
                      </section>
                    )}
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 text-xs leading-6">
                      <Checkbox
                        checked={confirmed}
                        onCheckedChange={(value) =>
                          setConfirmed(value === true)
                        }
                        id="letter-send-confirm"
                      />
                      <span>
                        내용을 확인했어요. 보내면 수정할 수 없으며, 같은 날
                        양쪽이 제출한 뒤 함께 공개됩니다.
                      </span>
                    </label>
                    <Button
                      className="h-12 w-full rounded-xl"
                      disabled={!confirmed || !draft.trim() || !onCommand}
                      onClick={() =>
                        send({
                          type: "submit",
                          day: selected,
                          body: draft,
                          confirmed,
                        })
                      }
                    >
                      오늘의 편지 보내기 <ArrowRight size={16} />
                    </Button>
                    <p className="text-xs leading-6 text-muted-foreground">
                      초안은 작성자만 확인합니다. 현재 브라우저 메모리의 가상
                      자료이며 실제 저장·두 계정 동기화는 연결되지 않았습니다.
                    </p>
                  </div>
                ) : (
                  <div className="mt-7 rounded-xl bg-muted p-5">
                    <p className="flex items-start gap-2 text-sm font-medium">
                      <LockKeyhole size={16} className="mt-1 shrink-0" />
                      {row.lockedReason}
                    </p>
                    <p className="mt-3 text-xs leading-6 text-muted-foreground">
                      한 날에 다른 날짜 편지를 몰아 보내지 않습니다. 미제출은
                      지연·문의·중단으로 구분하며 정상 완료로 처리하지 않습니다.
                    </p>
                  </div>
                )}
              </div>
            </article>
          )}
          {view.delayed && (
            <div className="mt-5 border border-border bg-muted p-5 text-sm leading-7">
              <p className="font-semibold">
                아직 실제 교환이 완료되지 않은 날이 있어요.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                교류 지연 상태입니다. 문의 또는 중단을 요청할 수 있습니다. 일정
                재설정은 고지한 정책·양쪽 동의·운영 기록이 필요하며 현재 정책은
                미확정입니다.
              </p>
            </div>
          )}
          <div className="mt-6 border border-border bg-card p-6">
            <p className="text-sm font-semibold">
              {view.status !== "active"
                ? "교류 중단·접근 재검토 상태에서는 만남 선택을 열지 않습니다."
                : view.meetingOpen
                  ? "세 통의 이야기를 나눴어요. 다음 장면은 두 사람이 선택합니다."
                  : view.complete
                    ? "세 날의 편지를 함께 나눴어요. 4일째 오전 09:00에 만남 선택을 확인해 주세요."
                    : "세 날의 실제 교환이 완료된 뒤, 다음 장면을 선택해요."}
            </p>
            <p className="mt-3 text-xs leading-6 text-muted-foreground">
              만남 선택 기준 · 정상 3일 교환 완료 + {view.decisionAt} ·
              Asia/Seoul. 실제 만남이나 연애를 보장하거나 만남을 강요하지
              않습니다.
            </p>
            {view.meetingOpen && <MeetingChoice view={view} onSend={send} />}
          </div>
        </>
      )}
      <section
        className="mt-6 border-t border-border pt-5"
        aria-label="신고·차단·중단·문의"
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => send({ type: "report" })}>
            <Shield size={15} />
            신고
          </Button>
          <Button variant="outline" onClick={() => setSafety("block")}>
            차단 요청
          </Button>
          <Button variant="outline" onClick={() => setSafety("interrupt")}>
            교류 중단 요청
          </Button>
          <Button variant="outline" onClick={() => send({ type: "contact" })}>
            문의
          </Button>
          <Button asChild variant="outline"><Link to="/support?demo=agreement">문의·신고 자세히 접수</Link></Button>
          <Button variant="outline" disabled>
            일정 재설정 · 정책 확인 필요
          </Button>
        </div>
        {safety && (
          <div className="mt-4 rounded-xl border border-border p-4 text-xs leading-6">
            <p>
              {safety === "block"
                ? "차단 요청 시 신규 교류를 멈추고 기존 글 접근을 재검토합니다."
                : "교류 중단 요청 시 신규 제출은 멈춥니다. 과거 공개 글 접근·보존은 별도 정책과 권한으로 관리합니다."}{" "}
              자동 환불이나 정상 완료로 처리하지 않습니다.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  send({ type: safety })
                  setSafety(null)
                }}
              >
                가상 요청 확인
              </Button>
              <Button variant="outline" onClick={() => setSafety(null)}>
                돌아가기
              </Button>
            </div>
          </div>
        )}
        <p className="mt-4 text-xs leading-6 text-muted-foreground">
          운영자·AI가 상대의 편지를 대신 쓰지 않습니다. 신고 검토 등 고지된
          사유로 운영자 열람이 필요할 수 있으며 실제 권한·접근 로그·보존 정책은
          별도 구현과 검토가 필요합니다. 이미 본 화면이나 캡처까지 회수하지는
          못합니다.
        </p>
        <Link
          to="/#faq"
          className="mt-3 inline-flex text-xs text-primary underline underline-offset-4"
        >
          미시작·중단·취소·환불 문의 안내
        </Link>
      </section>
      {message && (
        <p
          role="status"
          className="mt-5 rounded-xl bg-muted p-4 text-sm leading-7"
        >
          {message}
        </p>
      )}
    </section>
  )
}
