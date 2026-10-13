import { useState, useEffect } from "react"
import { Link, useSearchParams } from "react-router"
import { MemberAgreement } from "./AgreementFlow"
import { ArrowRight, Clock3, LockKeyhole, Users, Image } from "lucide-react"
import { Button } from "./components/ui/button"
import { Checkbox } from "./components/ui/checkbox"
import { Label } from "./components/ui/label"
import { PaymentFlow } from "./PaymentFlow"
import { MemberSafetyTools } from "./MemberOperations"
import { saveMemberIntroductionHistory, saveMemberPayment } from "./member-operations-model"
import { RefundPolicyPanel } from "./RefundPolicyPanel"
import { PrivatePhoto, PrivateProfile } from "./PrivateProfile"
import {
  emptyIntroductionBook,
  protectDemoIntroduction,
  endDemoIntroduction,
  introductionView,
  makeIntroductionFixture,
  paymentForMutualIntroduction,
  recordDemoExchangeRequest,
  publishDemoIntroduction,
  respondToIntroduction,
  resumeDemoParticipation,
  recordIntroductionViewed,
  paymentForOwnIntroduction,
  recordIntroductionPaymentRequest,
  type IntroductionBook,
} from "./introduction-model"

const formatTime = (at: string | null) =>
  at
    ? new Date(at).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour12: false,
      })
    : "기록 없음"
const endLabels: Record<string, string> = {
  rejected: "상호 선택으로 이어지지 않음",
  nonresponse: "응답 기한 내 미응답",
  withdrawn: "참여 철회",
  "access-failure": "소개 접근 실패",
  "admin-cancel": "관리자 취소",
  "partner-unpaid": "상대 미결제 기한 종료 · 환불 요청/소개 권리 복원 · 지급 완료 아님",
  "agreement-timeout": "합의 기한 종료 · 환불 요청/소개 권리 유지 · 지급 완료 아님",
}
type ViewProps = {
  book: IntroductionBook
  memberId: string
  now: Date
  onChange?: (book: IntroductionBook) => void
}
export function IntroductionView({ book, memberId, now, onChange }: ViewProps) {
  const view = introductionView(book, memberId, now)
  useEffect(()=>{saveMemberIntroductionHistory(memberId,view.history.map(item=>({id:item.id,publishedAt:item.publishedAt,ownResponseAt:item.ownResponseAt,endReason:item.reason})));},[book,memberId]);
  const [choice, setChoice] = useState<"positive" | "negative" | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState("")
  const [opened, setOpened] = useState<string | null>(null)
  const own = book.members.find(member => member.id === memberId)
  const needsFirstOpen = !!own?.refundOperations && !own.refundOperations.introductionOpenedAt && opened !== `${memberId}:${view.id}`
  const payment = paymentForMutualIntroduction(book, memberId, now)
  const title = view.mutual
    ? "서로, 더 알아가고 싶어요."
    : view.status === "closed"
      ? "이번 소개가 종료됐어요."
      : view.profile
        ? "오늘, 한 사람을 소개해요."
        : "새로운 소개를 준비하고 있어요."
  const submit = () => {
    if (!view.id || !choice) return
    const result = respondToIntroduction(
      book,
      view.id,
      memberId,
      choice,
      confirmed,
      book.revision,
      now,
    )
    if (result.errors.length) {
      setMessage(result.errors.join(" "))
      return
    }
    onChange?.(result.book)
    setChoice(null)
    setConfirmed(false)
    setMessage(
      "가상 최종 응답만 기록했습니다. 실제 응답·발송은 진행하지 않았습니다.",
    )
  }
  return (
    <section className="space-y-7 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-3 text-xs font-semibold tracking-widest text-accent">
            THIS INTRODUCTION / BEFORE US
          </p>
          <h1 className="text-3xl font-semibold leading-relaxed">{title}</h1>
        </div>
        <span className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground">
          가상 상태 · 실서버 공개 미연결
        </span>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4 text-xs">
        <span>이번 소개 · {view.id || "아직 공개된 건 없음"}</span>
        {view.dueAt && (
          <span className="flex items-center gap-2 text-accent">
            <Clock3 size={14} />
            응답 마감 {formatTime(view.dueAt)} · Asia/Seoul
          </span>
        )}
      </div>
      {own?.receipt && <RefundPolicyPanel session={paymentForOwnIntroduction(book, memberId)!} kind="introduction" now={now} onChange={onChange ? session => {
        const result = recordIntroductionPaymentRequest(book, memberId, session, book.revision, now);
        if (result.errors.length) setMessage(result.errors.join(" "));
        else { onChange(result.book); saveMemberPayment(memberId, session, now); }
      } : undefined} />}
      {view.profile && needsFirstOpen ? <div className="space-y-4 rounded-xl border border-border p-6">
        <p className="text-sm leading-7">첫 상대 프로필이 실제 표시된 시점부터 소개 서비스 제공이 시작됩니다. 열람 전 취소는 소개비 5,000원 전액 환불 대상이며 요청과 실제 환불 완료는 구분합니다.</p>
        <Button onClick={() => setOpened(`${memberId}:${view.id}`)}>첫 소개 확인하기</Button>
      </div> : view.profile ? (
        <PrivateProfile key={`${memberId}-${view.id}`} memberId={memberId} introductionId={view.id!} profileVersion={view.profile.version} onViewed={() => {
          if (!own?.refundOperations || own.refundOperations.introductionOpenedAt || !onChange) return;
          const result = recordIntroductionViewed(book, memberId, view.id!, book.revision, now);
          if (!result.errors.length && result.book !== book) { onChange(result.book); saveMemberPayment(memberId, paymentForOwnIntroduction(result.book, memberId)!, now); }
        }}>
        <div className="grid gap-7 lg:grid-cols-[7fr_5fr]">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {view.profile.photos.map((photo, index) => (
                <figure
                  key={photo.slot}
                  className={index === 0 ? "col-span-2" : ""}
                >
                  <PrivatePhoto memberId={memberId}
                    className={`flex flex-col items-center justify-center gap-5 border border-border bg-secondary ${
                      index === 0 ? "aspect-video" : "aspect-square"
                    }`}
                  >
                    <div className="flex items-center gap-3 text-primary">
                      <span className="size-5 rounded-full bg-primary" />
                      <span className="size-5 rounded-full bg-accent" />
                    </div>
                    <Image
                      size={index === 0 ? 44 : 30}
                      className="text-primary/30"
                    />
                    <span className="text-xs text-muted-foreground">
                      {photo.label} · 구도 예시
                    </span>
                  </PrivatePhoto>
                  <figcaption className="flex justify-between gap-2 bg-accent px-3 py-2 text-xs text-accent-foreground">
                    <span>{photo.label}</span>
                    <span>공개 v{photo.version}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="text-xs leading-6 text-muted-foreground">
              서비스 화면 예시입니다. 실존 인물·가짜 회원 사진을 만들지
              않았으며, 승인·공개 동의된 3~4장 자리만 그래픽으로 표시합니다.
            </p>
            <p className="text-xs leading-6 text-muted-foreground">
              워터마크와 드래그·우클릭·길게 누르기 저장 억제는 보조 수단입니다. 캡처나 유출을 완전히 막거나 보안 구현 완료를 의미하지 않습니다. 표시 코드는 탭 메모리의 가상 코드이며 서버 연동 전입니다.
            </p>
          </div>
          <div className="space-y-5">
            <div className="border-t-2 border-primary pt-5">
              <p className="mb-4 text-xs text-muted-foreground">
                공개 허용 소개 · 프로필 v{view.profile.version}
              </p>
              {view.profile.items.map((item) => (
                <div key={item.id} className="mb-4">
                  <p className="mb-1 text-xs text-muted-foreground">
                    {item.label}
                  </p>
                  <p
                    className={
                      item.id === "self.name"
                        ? "text-2xl font-semibold"
                        : "text-sm leading-7"
                    }
                  >
                    {Array.isArray(item.value)
                      ? item.value.join(" · ")
                      : item.value}
                  </p>
                </div>
              ))}
            </div>
            <div className="border-l-2 border-accent bg-secondary p-4">
              <p className="mb-2 text-xs font-semibold text-accent">
                운영자의 제안 이유 · 가상 예시
              </p>
              <p className="text-sm leading-7">{view.reason}</p>
            </div>
            <p className="text-xs leading-6 text-muted-foreground">
              ‘천천히 알아가기’는 교류 속도를 존중한다는 뜻입니다. 응답 기한을
              숨겨서 연장하지 않으며 초 단위 카운트다운은 없습니다.
            </p>
          </div>
        </div>
        </PrivateProfile>
      ) : (
        <div className="flex items-start gap-4 border border-border bg-secondary p-6">
          <LockKeyhole className="mt-1 shrink-0 text-accent" size={22} />
          <div>
            <p className="text-sm font-semibold">
              {view.expired
                ? "응답 기한이 지났어요. 종료 상태를 확인하고 있습니다."
                : view.status === "closed"
                  ? endLabels[view.endReason || ""] || "종료 상태 확인"
                  : view.status === "reserved"
                    ? "양쪽 공개 준비가 확인된 한 쌍을 정오에 동시에 공개합니다."
                    : "현재 조건과 참여 시점이 맞는 상대를 준비하고 있어요."}
            </p>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              공개 전·기한 후·종료된 상대의 사진은 이 화면에 포함하지 않습니다.
              새 후보가 없으면 추가금 없이 기다립니다. 매일 새 후보를 생성하거나
              소개를 보장하지 않습니다.
            </p>
          </div>
        </div>
      )}
      {view.status === "published" &&
        !view.expired &&
        view.profile &&
        (!own?.refundOperations || !!own.refundOperations.introductionOpenedAt) &&
        !view.ownResponse && (
          <div className="space-y-5 border-t border-border pt-6">
            <h2 className="text-lg font-semibold">
              더 알아가고 싶은 마음이 있나요?
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ["positive", "알아가고 싶어요"],
                ["negative", "다음 소개를 기다릴게요"],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  variant="outline"
                  aria-pressed={choice === value}
                  className={`min-h-14 rounded-xl whitespace-normal transition-colors duration-200 motion-reduce:transition-none ${
                    choice === value
                      ? "border-primary bg-primary/5 text-primary"
                      : ""
                  }`}
                  onClick={() => {
                    setChoice(value)
                    setConfirmed(false)
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            {choice && (
              <div className="rounded-xl border border-border p-5">
                <p className="mb-4 text-sm font-semibold">
                  {choice === "positive"
                    ? "‘알아가고 싶어요’로 최종 응답할까요?"
                    : "‘다음 소개를 기다릴게요’로 최종 응답할까요?"}
                </p>
                <Label
                  htmlFor="introduction-response-confirm"
                  className="items-start leading-6"
                >
                  <Checkbox
                    id="introduction-response-confirm"
                    className="mt-1"
                    checked={confirmed}
                    onCheckedChange={(value) => setConfirmed(value === true)}
                  />
                  <span>
                    이번 소개의 최종 응답임을 확인했어요. 모두 응답하기 전에는
                    한쪽 호감을 상대에게 공개하지 않습니다.
                  </span>
                </Label>
                <Button
                  className="mt-5 h-12 rounded-xl"
                  disabled={!confirmed || !onChange}
                  onClick={submit}
                >
                  가상 최종 응답 제출 <ArrowRight size={16} />
                </Button>
              </div>
            )}
          </div>
        )}
      {view.ownResponse && !view.mutual && (
        <div className="border-l-2 border-primary bg-secondary p-5">
          <p className="text-sm font-semibold">
            {view.ownResponse === "positive"
              ? "선택을 전달했어요. 상대의 응답을 기다리고 있습니다."
              : "다음 소개를 기다리는 선택을 전달했어요."}
          </p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            상대의 미공개 응답·거절 이유·평가는 전달하지 않습니다. 다음 소개를
            선택해도 같은 날 다른 사람을 즉시 보여 주지 않습니다.
          </p>
        </div>
      )}
      {message && (
        <p
          role="status"
          className="rounded-xl border border-border p-4 text-sm leading-7"
        >
          {message}
        </p>
      )}
      {view.mutual && payment && (
        <div className="rounded-xl border border-border bg-background p-6">
          <PaymentFlow key={view.id} initial={payment} kind="exchange" nowOverride={now} onSessionChange={session => { const result = recordDemoExchangeRequest(book, memberId, session, book.revision, now); if (result.errors.length) setMessage(result.errors.join(" ")); else onChange?.(result.book) }} />
        </div>
      )}
      <div className="grid gap-4 text-sm sm:grid-cols-2">
        <div className="rounded-xl border border-border p-5">
          <p className="mb-3 flex items-center gap-2 font-semibold">
            <Users size={16} />
            현재 참여 상태
          </p>
          <p>
            {view.paused
              ? "참여 가능 재확인 · 일시정지"
              : "확인된 소개 상태만 표시"}
          </p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            반복 미응답은 참여 상태를 확인하고 소개를 잠시 중지합니다. 정지는
            소개 이용 권리 종료와 다릅니다.
          </p>
        </div>
        <div className="rounded-xl border border-border p-5">
          <p className="mb-3 font-semibold">소개 이용 권리</p>
          <p>
            {view.rights === "valid"
              ? "첫 교류 미시작 · 유지 (가상)"
              : view.rights === "first-program-started"
                ? "첫 실제 교류 개시 · 이번 혜택 종료"
                : "권리 확인 전"}
          </p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            거절·미응답으로 횟수를 소진하거나 추가 결제를 요구하지 않습니다.
            상호 선택·결제·방식 합의 중에는 새 소개를 하지 않습니다.
          </p>
        </div>
      </div>
      <section className="border-t border-border pt-6">
        <h2 className="mb-4 text-lg font-semibold">내 소개 이력 · 요약만</h2>
        {view.history.length ? (
          view.history.map((item) => (
            <article
              key={item.id}
              className="mb-3 rounded-xl border border-border p-5 text-xs leading-6"
            >
              <p className="mb-3 font-semibold">
                {item.id} · 소개 v{item.version} · 프로필 v{item.profileVersion}{" "}
                · {item.policyVersion}
              </p>
              <dl className="grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">공개</dt>
                  <dd>{formatTime(item.publishedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">내 응답</dt>
                  <dd>{formatTime(item.ownResponseAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">종료</dt>
                  <dd>{formatTime(item.closedAt)}</dd>
                </div>
              </dl>
              {item.reason && <p className="mt-3">{endLabels[item.reason]}</p>}
              {item.events
                .filter(
                  (entry) =>
                    entry.kind.includes("일시정지") ||
                    entry.kind.includes("재개"),
                )
                .map((entry) => (
                  <p key={`${entry.revision}-${entry.kind}`} className="mt-2">
                    {entry.kind} · {formatTime(entry.at)} · v{entry.revision}
                  </p>
                ))}
            </article>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            확인된 소개 이력이 없습니다.
          </p>
        )}
        <p className="mt-4 text-xs leading-6 text-muted-foreground">
          이력은 본인 기록 요약이며 종료된 상대의 사진 보관함이 아닙니다. 프로필
          접근은 동의·정책·현재 권한을 별도로 확인해야 합니다. 실제 서버
          권한·원자적 동시 공개·동기화는 미구현입니다.
        </p>
      </section>
      <Link
        to="/today"
        className="inline-flex items-center gap-2 text-sm text-primary"
      >
        오늘로 돌아가기 <ArrowRight size={15} />
      </Link>
      <MemberSafetyTools key={memberId} context={{memberId,targetId:book.records.find(item=>item.id===view.id)?.pair.find(id=>id!==memberId) || null,introductionId:view.id,surface:"소개 프로필"}} now={now} onProtect={onChange && view.id && view.status!=="closed" ? kind=>{const result=protectDemoIntroduction(book,view.id!,memberId,kind,book.revision,now);if(result.errors.length)return result.errors.join(" ");onChange(result.book);return null;} : undefined} />
    </section>
  )
}
export default function MemberIntroduction() {
  const [params] = useSearchParams()
  if (params.get("demo") === "agreement") return <MemberAgreement context="us" />
  return (
    <IntroductionView
      book={emptyIntroductionBook()}
      memberId="current-member"
      now={new Date()}
    />
  )
}
export function IntroductionDemo() {
  const [now, setNow] = useState(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
    return new Date(`${parts}T12:00:10+09:00`)
  })
  const [book, setBook] = useState(() => makeIntroductionFixture(now))
  const [memberId, setMemberId] = useState("virtual-left")
  const [message, setMessage] = useState("")
  const id = book.records[0].id
  const apply = (result: ReturnType<typeof publishDemoIntroduction>) => {
    if (result.errors.length) setMessage(result.errors.join(" "))
    else {
      setBook(result.book)
      setMessage(
        "가상 상태에만 반영했습니다. 실제 공개·발송·회원 응답은 변경하지 않았습니다.",
      )
    }
  }
  const expire = (repeated: boolean) => {
    const deadline = new Date(book.records[0].responseDueAt)
    const source = structuredClone(book)
    if (repeated)
      source.members.forEach((member) => {
        if (!source.records[0].responses[member.id]) member.missedResponses = 1
      })
    setNow(deadline)
    apply(
      endDemoIntroduction(source, id, "nonresponse", source.revision, deadline),
    )
  }
  return (
    <div className="py-6">
      <div className="space-y-4 rounded-xl border border-accent/30 bg-accent/5 p-5">
        <p className="text-sm font-semibold text-accent">
          개발용 한 쌍 소개 시연 · 가상 운영/회원 전환
        </p>
        <p className="text-xs leading-6 text-muted-foreground">
          가상 기준 시각 {formatTime(now.toISOString())} · 실제 서버 스케줄·동시
          공개·운영자 권한·발송은 연결하지 않았습니다. 양쪽 회원 전환과 종료
          제어는 이 개발 화면에만 있습니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              apply(publishDemoIntroduction(book, id, book.revision, now))
            }
          >
            정오 양쪽 공개 시연
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setMemberId(
                memberId === "virtual-left" ? "virtual-right" : "virtual-left",
              )
              setMessage("")
            }}
          >
            가상 회원 전환 · {memberId === "virtual-left" ? "가" : "나"}
          </Button>
          <Button variant="outline" onClick={() => expire(false)}>
            기한 도달 시연
          </Button>
          <Button variant="outline" onClick={() => expire(true)}>
            이전 미응답 1회 가상 사례
          </Button>
          {(["withdrawn", "access-failure", "admin-cancel"] as const).map(
            (reason) => (
              <Button
                key={reason}
                variant="outline"
                onClick={() =>
                  apply(
                    endDemoIntroduction(book, id, reason, book.revision, now),
                  )
                }
              >
                {endLabels[reason]} 시연
              </Button>
            ),
          )}
          <Button
            variant="outline"
            onClick={() =>
              apply(resumeDemoParticipation(book, memberId, true, now))
            }
          >
            참여 확인·재개 시연
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const resetTime = new Date(
                `${now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })}T12:00:10+09:00`,
              )
              setNow(resetTime)
              setBook(makeIntroductionFixture(resetTime))
              setMemberId("virtual-left")
              setMessage("")
            }}
          >
            가상 사례 초기화
          </Button>
        </div>
        {message && (
          <p role="status" className="text-xs leading-6">
            {message}
          </p>
        )}
        <Link
          to="/admin/matching"
          className="inline-flex text-xs text-accent underline underline-offset-4"
        >
          기존 운영자 후보 검토 · 실제 준비 검사 재사용
        </Link>
      </div>
      <IntroductionView
        key={`${id}-${memberId}-${book.records[0].status}`}
        book={book}
        memberId={memberId}
        now={now}
        onChange={setBook}
      />
    </div>
  )
}
