import { kstDateTime } from "./dates"
import { MeetingChoice } from "./MeetingChoice"
import { useEffect, useState } from "react"
import { Link } from "react-router"
import { ArrowRight, ChevronDown, Eye, LifeBuoy, LockKeyhole, PenLine } from "lucide-react"
import { Button } from "./components/ui/button"
import { Textarea } from "./components/ui/textarea"
import { Checkbox } from "./components/ui/checkbox"
import { LETTER_REPLY, type LetterCommand, type LetterView } from "./letter-model"

const formatTime = (value: string) => Number.isFinite(Date.parse(value)) ? kstDateTime(value) : "확인된 시각 없음"
const clock = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }) : ""
const longDate = (date: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" }).format(new Date(`${date}T00:00:00Z`))
const shortDate = (date: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", month: "long", day: "numeric" }).format(new Date(`${date}T00:00:00Z`))
// 남은 시간: 오늘 23:59까지
function remaining(nowLabel: string, date: string) {
  const left = Date.parse(`${date}T00:00:00+09:00`) + 86400000 - Date.parse(nowLabel)
  if (!Number.isFinite(left) || left <= 0) return null
  const hours = Math.floor(left / 3600000), minutes = Math.floor((left % 3600000) / 60000)
  return hours ? `${hours}시간 ${minutes}분` : `${minutes}분`
}
const RECOMMENDED = { min: 300, max: 600 }
// 은은한 줄. 글자 줄 간격(2rem)과 맞춘다.
const RULED = { backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent calc(2rem - 1px), color-mix(in oklch, var(--border) 70%, transparent) calc(2rem - 1px), color-mix(in oklch, var(--border) 70%, transparent) 2rem)", backgroundPosition: "0 0" } as const

type LetterFlowProps = {
  view: LetterView | null
  nowLabel: string
  onCommand?: (command: LetterCommand, revision: number) => string | null
}
type Row = LetterView["rows"][number]
const STATE: Record<Row["status"], { label: string; tone: "open" | "sealed" | "write" | "locked" | "late" }> = {
  published: { label: "함께 열림", tone: "open" },
  "own-submitted": { label: "봉해 두었어요", tone: "sealed" },
  "not-submitted": { label: "오늘 쓸 차례", tone: "write" },
  future: { label: "잠겨 있어요", tone: "locked" },
  delayed: { label: "교환 지연", tone: "late" },
  "access-review": { label: "접근 재검토", tone: "locked" },
}

function DayMark({ tone, active }: { tone: (typeof STATE)[Row["status"]]["tone"]; active: boolean }) {
  const base = "relative z-10 grid size-4 place-items-center rounded-full ring-4 ring-background"
  if (tone === "open") return <span className={`${base} bg-primary`} aria-hidden="true"><span className="size-1.5 rounded-full bg-white" /></span>
  if (tone === "sealed") return <span className={`${base} border-2 border-primary bg-background`} aria-hidden="true" />
  if (tone === "write") return <span className={`${base} ${active ? "bg-accent" : "border-2 border-accent bg-background"}`} aria-hidden="true" />
  if (tone === "late") return <span className={`${base} border-2 border-destructive bg-background`} aria-hidden="true" />
  return <span className={`${base} border border-dashed border-muted-foreground/50 bg-background`} aria-hidden="true" />
}

function Sheet({ children, tone = "plain", className = "" }: { children: React.ReactNode; tone?: "plain" | "soft"; className?: string }) {
  return <div className={`relative border border-border ${tone === "soft" ? "bg-muted/40" : "bg-card"} shadow-[0_1px_0_var(--border),0_24px_48px_-32px_color-mix(in_oklch,var(--primary)_35%,transparent)] ${className}`}>{children}</div>
}
function TwoDots({ apart = false }: { apart?: boolean }) {
  return (
    <span aria-hidden="true" className={`flex items-center ${apart ? "gap-6" : "gap-1.5"}`}>
      <span className="size-2.5 rounded-full bg-primary" />
      <span className="size-2.5 rounded-full bg-accent" />
    </span>
  )
}
function LetterBody({ text, size = "lg" }: { text: string; size?: "lg" | "md" }) {
  return <p className={`whitespace-pre-wrap break-words ${size === "lg" ? "text-[17px] leading-[2.05]" : "text-[15px] leading-[1.95]"} text-foreground/90`}>{text}</p>
}

function ReplyBox({ onSend }: { onSend: (body: string, confirmed: boolean) => void }) {
  const [body, setBody] = useState("")
  const [ok, setOk] = useState(false)
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">이 편지에 답장하기</p>
        <span className="text-[11px] text-muted-foreground">한 번만 · 오늘 23:59까지</span>
      </div>
      <Textarea
        aria-label="상대 편지에 답장"
        value={body}
        maxLength={LETTER_REPLY.maxLength}
        onChange={(event) => { setBody(event.target.value); setOk(false) }}
        placeholder="편지를 읽고 떠오른 마음을 짧게 전해 보세요."
        style={RULED}
        className="min-h-32 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-[15px] leading-[2rem] shadow-none focus-visible:ring-0 md:text-[15px] dark:bg-transparent"
      />
      <p className="text-right text-[11px] tabular-nums text-muted-foreground">{body.length}/{LETTER_REPLY.maxLength}</p>
      <label className="flex items-start gap-3 text-xs leading-6 text-muted-foreground">
        <Checkbox checked={ok} onCheckedChange={(value) => setOk(value === true)} className="mt-1" />
        답장은 한 번만 보낼 수 있고 고칠 수 없어요. 두 분 모두 답장해야 함께 열리고, 답장에 다시 답장할 수는 없어요. 23:59까지 답장하지 않으면 이 편지에는 답장을 남길 수 없어요.
      </label>
      <Button className="rounded-full px-6" disabled={!body.trim() || !ok} onClick={() => onSend(body, ok)}>
        답장 봉하기 <ArrowRight size={15} />
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
  const [ownOpen, setOwnOpen] = useState(false)
  useEffect(() => {
    setDraft(row?.draft || "")
    setPreview(false)
    setConfirmed(false)
    setSafety(null)
    setOwnOpen(false)
  }, [row?.index, row?.date, view?.programId])
  const send = (command: LetterCommand) => {
    if (!view || !onCommand) {
      setMessage(
        "실제 서비스 접수는 연결되지 않았어요. 진행 상태와 문의 안내를 확인해 주세요.",
      )
      return
    }
    const error = onCommand(command, view.revision)
    setMessage(
      error ||
        (command.type === "save"
          ? "임시로 저장했어요. 나만 볼 수 있어요."
          : command.type === "submit"
            ? "오늘의 편지를 봉했어요. 상대의 편지도 도착하면 함께 열려요."
            : command.type === "reply"
              ? "답장을 보냈어요. 두 분 모두 답장하면 함께 열려요."
            : command.type === "meeting-choice"
              ? "만남 의사를 전달했어요. 상대의 응답을 임의로 만들지 않아요."
              : command.type === "block"
                ? "가상 차단 요청을 기록했어요. 신규 교류를 멈추고 기존 글 접근은 재검토해요. 이미 본 화면·캡처까지 회수하지는 못해요."
                : command.type === "interrupt"
                  ? "가상 중단 요청을 기록했어요. 정상 완료·자동 환불로 처리하지 않아요."
                  : command.type === "report"
                    ? "가상 신고 요청을 기록했어요. 실제 안전 담당자 접수·검토는 연결되지 않았어요."
                    : "가상 문의 요청을 기록했어요. 실제 상담 접수는 연결되지 않았어요."),
    )
    if (!error && command.type === "submit") {
      setConfirmed(false)
      setPreview(false)
    }
  }
  const length = draft.trim().length
  const meter = Math.min(100, Math.round((length / RECOMMENDED.max) * 100))
  const left = row ? remaining(nowLabel, row.date) : null
  const opened = view ? view.rows.filter((day) => day.status === "published").length : 0
  return (
    <section className="mx-auto max-w-3xl py-8" aria-labelledby="letter-flow-title">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 text-xs">
            <span className="font-semibold text-accent">A</span>
            <span aria-hidden="true" className="h-px w-8 bg-accent/40" />
            <span className="font-semibold">편지 나누기</span>
            <span className="tracking-[0.16em] text-muted-foreground">THREE LETTERS</span>
          </div>
          <h1 id="letter-flow-title" className="mt-5 text-3xl font-semibold leading-[1.4] sm:text-[34px]">
            하루 한 통,<br />천천히 건네는 이야기.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">
            사흘 동안 각자 한 통씩. 두 사람이 모두 보내야 함께 열려요.
          </p>
        </div>
        {view && (
          <div className="text-right text-xs leading-6 text-muted-foreground">
            <p className="text-2xl font-light tabular-nums text-foreground">{opened}<span className="text-sm text-muted-foreground"> / 3</span></p>
            <p>함께 연 편지</p>
          </div>
        )}
      </header>
      {!view ? (
        <Sheet className="mt-10 px-6 py-10 text-center sm:px-10">
          <div className="flex justify-center"><TwoDots apart /></div>
          <p className="mt-6 text-lg font-semibold">아직 편지를 나눌 상대가 없어요.</p>
          <p className="mx-auto mt-3 max-w-sm text-xs leading-6 text-muted-foreground">
            서로를 선택하고, 두 분 모두 결제하고, A 방식과 시작일에 함께 동의하면 첫 편지가 열려요. 예시 편지나 상대 응답을 만들어 보여 주지 않아요.
          </p>
          <Button asChild className="mt-6 rounded-full" variant="outline">
            <Link to="/demo/agreement">
              A/B 합의 데모 확인 <ArrowRight size={15} />
            </Link>
          </Button>
        </Sheet>
      ) : (
        <>
          {view.status !== "active" && (
            <div className="mt-8 border-l-2 border-destructive bg-muted px-5 py-4 text-sm leading-7">
              <p className="font-semibold">
                {view.status === "blocked" ? "차단 요청 · 기존 글 접근 재검토" : "교류 중단 요청 · 새 편지 중지"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                새 편지와 만남 선택은 멈췄어요. 이미 나눈 글의 접근·보존과 신고·문의는 별도로 관리해요.
              </p>
            </div>
          )}

          <nav aria-label="일자별 편지" className="relative mt-10">
            <span aria-hidden="true" className="absolute top-2 right-[16.66%] left-[16.66%] h-px bg-border" />
            <ol className="grid grid-cols-3">
              {view.rows.map((day) => {
                const state = STATE[day.status]
                const active = selected === day.index
                return (
                  <li key={`${day.index}-${day.date}`} className="flex justify-center">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => { setSelected(day.index); setMessage("") }}
                      className="group flex flex-col items-center gap-3 rounded-lg px-2 pb-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <DayMark tone={state.tone} active={active} />
                      <span className={`font-mono text-[11px] tracking-[0.14em] ${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}>DAY 0{day.index + 1}</span>
                      <span className={`flex flex-col text-xs leading-5 ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                        <time dateTime={day.date}>{shortDate(day.date)}</time>
                        <span className="font-normal">{state.label}</span>
                      </span>
                      <span aria-hidden="true" className={`h-0.5 w-8 rounded-full transition-colors duration-200 motion-reduce:transition-none ${active ? "bg-primary" : "bg-transparent"}`} />
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>

          {row && (
            <article className="mt-8" aria-label={`DAY 0${row.index + 1} 편지`}>
              <Sheet className="overflow-hidden">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-6 pt-8 pb-6 sm:px-10">
                  <div className="flex items-end gap-5">
                    <span aria-hidden="true" className="text-6xl font-extralight leading-none tracking-tight text-primary">0{row.index + 1}</span>
                    <div>
                      <p className="text-xs text-muted-foreground">{longDate(row.date)}</p>
                      <h2 className="mt-1 text-xl font-semibold sm:text-2xl">{row.title}</h2>
                    </div>
                  </div>
                  <TwoDots />
                </header>

                <div className="px-6 py-8 sm:px-10 sm:py-10">
                  {row.question ? (
                    <blockquote className="border-l-2 border-accent pl-5">
                      <p className="text-[11px] tracking-[0.14em] text-accent">오늘의 질문</p>
                      <p className="mt-2 text-lg font-medium leading-8 sm:text-xl sm:leading-9">{row.question}</p>
                    </blockquote>
                  ) : (
                    <p className="text-sm leading-7 text-muted-foreground">
                      {view.readAccess
                        ? "어제 함께 열린 편지가 없어 이어 쓰는 질문을 열지 않았어요. 교류 지연 상태와 문의 경로를 확인해 주세요."
                        : "현재 글 접근 권한을 재검토하고 있어요. 문의 경로를 확인해 주세요."}
                    </p>
                  )}

                  {row.exchange ? (
                    <div className="mt-10 space-y-10">
                      <section aria-label="상대가 보낸 편지">
                        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold text-primary">From. 상대</p>
                          <p className="text-[11px] text-muted-foreground">{clock(row.publishedAt!)}에 함께 열렸어요</p>
                        </div>
                        <LetterBody text={row.exchange.peer} />
                      </section>

                      <section aria-label="답장" className="border-t border-dashed border-border pt-8">
                        {row.exchange.ownReply ? (
                          <div>
                            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                              <p className="text-sm font-semibold">Re. 내 답장</p>
                              <span className={`rounded-full px-2.5 py-1 text-[11px] ${row.exchange.replyStatus === "open" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                                {row.exchange.replyStatus === "open"
                                  ? "함께 열렸어요"
                                  : row.exchange.replyStatus === "closed-peer-missing"
                                    ? "상대가 답장을 남기지 않아 열리지 않았어요"
                                    : "상대도 답장하면 함께 열려요"}
                              </span>
                            </div>
                            <LetterBody text={row.exchange.ownReply.body} size="md" />
                          </div>
                        ) : row.exchange.canReply ? (
                          <ReplyBox
                            key={`${row.index}-${view.revision}`}
                            onSend={(body, ok) => send({ type: "reply", day: row.index, body, confirmed: ok })}
                          />
                        ) : row.exchange.replyStatus === "closed-own-missing" ? (
                          <p className="text-xs leading-6 text-muted-foreground">
                            답장 시간(23:59)이 지나 이 편지에는 더 이상 답장할 수 없어요. 상대의 답장은 두 분 모두 답장했을 때만 열려요.
                          </p>
                        ) : null}
                      </section>

                      {row.exchange.peerReply && (
                        <section aria-label="상대의 답장" className="bg-primary/5 px-5 py-6 sm:px-7">
                          <p className="text-sm font-semibold text-primary">Re. 내 편지에 온 답장</p>
                          <div className="mt-4"><LetterBody text={row.exchange.peerReply.body} size="md" /></div>
                          <p className="mt-4 text-[11px] text-muted-foreground">답장에는 다시 답장할 수 없어요. 이어지는 이야기는 다음 편지에 담아 주세요.</p>
                        </section>
                      )}

                      <section aria-label="내가 보낸 편지" className="border-t border-border pt-6">
                        <button type="button" aria-expanded={ownOpen} onClick={() => setOwnOpen((value) => !value)} className="flex w-full items-center justify-between text-left text-sm font-semibold">
                          내가 보낸 편지 다시 읽기
                          <ChevronDown size={16} className={`transition-transform duration-200 motion-reduce:transition-none ${ownOpen ? "rotate-180" : ""}`} />
                        </button>
                        {ownOpen && <div className="mt-5"><LetterBody text={row.exchange.own} size="md" /></div>}
                      </section>
                    </div>
                  ) : row.ownSubmittedAt ? (
                    <div className="mt-10 text-center">
                      <div className="flex justify-center"><TwoDots apart /></div>
                      <p className="mt-6 text-lg font-semibold">
                        {view.status === "active" ? "편지를 봉해 두었어요." : "보낸 편지가 있어요. 지금은 새 교류가 멈춘 상태예요."}
                      </p>
                      <p className="mx-auto mt-2 max-w-sm text-sm leading-7 text-muted-foreground">
                        상대의 편지도 도착하면 두 통이 함께 열려요. 상대가 쓰고 있는지는 보여 주지 않아요.
                      </p>
                      <p className="mt-2 text-[11px] text-muted-foreground">{clock(row.ownSubmittedAt)}에 보냄 · 보낸 편지는 고칠 수 없어요</p>
                      <details className="mx-auto mt-8 max-w-xl border-t border-border pt-5 text-left">
                        <summary className="cursor-pointer text-sm font-semibold">내가 쓴 편지 다시 읽기</summary>
                        <div className="mt-5"><LetterBody text={row.ownSentBody || ""} size="md" /></div>
                      </details>
                    </div>
                  ) : row.writable ? (
                    <div className="mt-10">
                      {preview ? (
                        <section aria-label="나만 보는 편지 미리보기">
                          <div className="mb-6 flex items-center justify-between">
                            <p className="text-sm font-semibold text-accent">미리보기 · 아직 보내지 않았어요</p>
                            <Button variant="ghost" size="sm" onClick={() => setPreview(false)}><PenLine size={14} />다시 쓰기</Button>
                          </div>
                          <p className="mb-4 text-sm font-semibold text-primary">To. 오늘의 상대에게</p>
                          <LetterBody text={draft} />
                          <p className="mt-8 text-right text-sm text-muted-foreground">From. 나</p>
                        </section>
                      ) : (
                        <>
                          <p className="mb-2 text-sm font-semibold text-primary">To. 오늘의 상대에게</p>
                          <Textarea
                            id="letter-draft"
                            aria-label="오늘의 편지"
                            value={draft}
                            onChange={(event) => {
                              setDraft(event.target.value)
                              setConfirmed(false)
                            }}
                            placeholder="잘 쓴 편지보다, 지금의 나를 담은 이야기를 들려주세요."
                            style={RULED}
                            className="min-h-80 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-[17px] leading-[2rem] shadow-none focus-visible:ring-0 md:text-[17px] dark:bg-transparent"
                          />
                          <p className="mt-2 text-right text-sm text-muted-foreground">From. 나</p>
                        </>
                      )}

                      <div className="mt-8 space-y-2" aria-label="편지 분량">
                        <div className="relative h-1 overflow-hidden rounded-full bg-muted">
                          <span aria-hidden="true" className="absolute inset-y-0 bg-primary/15" style={{ left: `${(RECOMMENDED.min / RECOMMENDED.max) * 100}%`, right: 0 }} />
                          <span className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${meter}%` }} />
                        </div>
                        <div className="flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
                          <span className="tabular-nums">{length}자 · 300~600자를 권해요 (짧아도 보낼 수 있어요)</span>
                          {left && <span>오늘 23:59까지 · {left} 남음</span>}
                        </div>
                      </div>

                      <div className="mt-8 flex flex-wrap gap-2">
                        <Button variant="outline" className="rounded-full" onClick={() => send({ type: "save", day: selected, body: draft })}>임시 저장</Button>
                        {!preview && <Button variant="outline" className="rounded-full" disabled={!draft.trim()} aria-expanded={preview} onClick={() => setPreview(true)}><Eye size={15} />미리보기</Button>}
                      </div>
                      <label className="mt-6 flex cursor-pointer items-start gap-3 text-xs leading-6 text-muted-foreground">
                        <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} id="letter-send-confirm" className="mt-1" />
                        <span>다 읽어 보았어요. 보내면 고칠 수 없고, 두 사람이 모두 보내야 함께 열려요.</span>
                      </label>
                      <Button
                        className="mt-5 h-12 w-full rounded-full text-[15px]"
                        disabled={!confirmed || !draft.trim() || !onCommand}
                        onClick={() => send({ type: "submit", day: selected, body: draft, confirmed })}
                      >
                        오늘의 편지 봉하기 <ArrowRight size={16} />
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-10 py-6 text-center">
                      <LockKeyhole size={20} className="mx-auto text-muted-foreground" />
                      <p className="mx-auto mt-4 max-w-sm text-sm leading-7">{row.status === "future" ? "아직 열리지 않은 편지예요." : row.lockedReason}</p>
                      <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                        {row.status === "future" ? `${longDate(row.date)} 09:00에 열려요. 다른 날짜의 편지를 미리 쓰거나 몰아 보내지 않아요.` : "보내지 않은 날은 지연으로 남고, 정상 완료로 바꾸지 않아요."}
                      </p>
                    </div>
                  )}
                </div>
              </Sheet>
            </article>
          )}

          {view.delayed && (
            <p className="mt-6 border-l-2 border-accent bg-muted px-5 py-4 text-xs leading-6 text-muted-foreground">
              아직 함께 열리지 않은 날이 있어요. 교류 지연 상태이며, 아래 ‘도움이 필요할 때’에서 문의하거나 중단을 요청할 수 있어요.
            </p>
          )}

          <section className="mt-10 border-t border-border pt-8" aria-label="다음 장면">
            <p className="text-xs tracking-[0.14em] text-accent">DAY 04</p>
            <p className="mt-2 text-lg font-semibold">
              {view.status !== "active"
                ? "교류 중단·접근 재검토 중에는 만남 선택을 열지 않아요."
                : view.meetingOpen
                  ? "세 통의 이야기를 나눴어요. 다음 장면은 두 분이 정해요."
                  : view.complete
                    ? "세 날의 편지를 모두 나눴어요."
                    : "세 날의 편지를 나눈 뒤, 다음 장면을 선택해요."}
            </p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              {formatTime(view.decisionAt)}부터 각자 만남 의사를 선택해요. 만남이나 연애를 약속하거나 강요하지 않아요.
            </p>
            {view.meetingOpen && <div className="mt-6"><MeetingChoice view={view} onSend={send} /></div>}
          </section>
        </>
      )}

      {message && (
        <p role="status" className="mt-8 rounded-xl bg-primary/5 px-5 py-4 text-sm leading-7 text-primary">
          {message}
        </p>
      )}

      <details className="group mt-10 border-t border-border pt-6" aria-label="신고·차단·중단·문의">
        <summary className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <LifeBuoy size={15} />도움이 필요할 때
          <ChevronDown size={14} className="transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => send({ type: "report" })}>신고</Button>
          <Button variant="outline" size="sm" onClick={() => setSafety("block")}>차단 요청</Button>
          <Button variant="outline" size="sm" onClick={() => setSafety("interrupt")}>교류 중단 요청</Button>
          <Button variant="outline" size="sm" onClick={() => send({ type: "contact" })}>문의</Button>
          <Button asChild variant="outline" size="sm"><Link to="/support?demo=agreement">문의·신고 자세히 접수</Link></Button>
        </div>
        {safety && (
          <div className="mt-4 rounded-xl border border-border p-4 text-xs leading-6">
            <p>
              {safety === "block"
                ? "차단 요청 시 새 교류를 멈추고 기존 글 접근을 재검토해요."
                : "교류 중단 요청 시 새 편지는 멈춰요. 이미 나눈 글의 접근·보존은 별도로 관리해요."}{" "}
              자동 환불이나 정상 완료로 처리하지 않아요.
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { send({ type: safety }); setSafety(null) }}>요청 확인</Button>
              <Button variant="ghost" size="sm" onClick={() => setSafety(null)}>돌아가기</Button>
            </div>
          </div>
        )}
        <p className="mt-4 text-xs leading-6 text-muted-foreground">
          운영진·AI가 편지를 대신 쓰지 않아요. 신고 검토처럼 알려 드린 사유가 있을 때만 운영진이 열람할 수 있어요. 이미 본 화면이나 캡처까지 회수하지는 못해요.{" "}
          <Link to="/pricing#faq" className="text-primary underline underline-offset-4">미시작·중단·환불 안내</Link>
        </p>
      </details>
    </section>
  )
}
