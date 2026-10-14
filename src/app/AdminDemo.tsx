import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { loadReviewFixtures, recordCandidateView, useSharedAdmin } from "./admin-console-data"
import DirectIntroduction from "./DirectIntroduction"
import { MatchRecommendations } from "./MatchingAssist"
import { recordOperatorChoice } from "./match-recommendation"
import { aliasIdentity, getIdentity, identityAccount } from "./identity-model"
import { AdminMemberHistory } from "./AdminOperations"
import {
  ArrowLeft,
  ArrowRight,
  LockKeyhole,
  ShieldCheck,
  Users,
} from "lucide-react"
import { Button } from "./components/ui/button"
import { Checkbox } from "./components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select"
import {
  APPLICATION_FIELDS,
  accountAge,
  useSavedApplication,
} from "./application-model"
import {
  operatorApplicationOriginal,
  publicApplicationProfile,
} from "./application-review"
import { PublicProfilePreview } from "./ApplicationReviewStep"
import { BEFORE_US } from "./config"
import { PHOTO_SLOTS, PHOTO_REVIEW_REASONS } from "./photo-model"
import { REVIEW_CONSENTS } from "./review-state"
import {
  adminTransition,
  applicationMember,
  compareMembers,
  pairIssues,
  reservationIssues,
  reviewIssues,
  seoulDate,
  type AdminMember,
  type ComparisonRow,
} from "./admin-model"

const timestamp = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "기록 없음"
const valueText = (value: unknown) =>
  Array.isArray(value)
    ? value.join(" · ")
    : typeof value === "boolean"
      ? value
        ? "본인 응답 있음"
        : "미동의"
      : String(value ?? "미입력")
const statusText = {
  pending: "검토·보완 대기",
  "photo-revision": "문제 사진 재등록",
  waiting: "적합 후보 대기",
  reviewed: "현재 버전 검토 완료",
}
function Fact({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-border py-4">
      <dt className="text-xs text-muted-foreground">{title}</dt>
      <dd className="mt-2 text-sm leading-6">{children}</dd>
    </div>
  )
}
function Comparison({ title, rows }: {
  title: string
  rows: ComparisonRow[]
}) {
  return (
    <section className="min-w-0 border border-border bg-card p-5">
      <h3 className="mb-5 text-base font-semibold">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">
            필수 조건과 상대 실제 응답의 비교
          </caption>
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              {["조건", "필수 기준", "상대 정보", "판단"].map((label) => (
                <th key={label} className="px-2 py-3 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border">
                <th scope="row" className="px-2 py-4 font-medium">
                  {row.label}
                </th>
                <td className="px-2 py-4">
                  {row.status === "조건 없음" ? "추가 필수 아님" : row.expected}
                </td>
                <td className="px-2 py-4">{row.actual}</td>
                <td
                  className={`whitespace-nowrap px-2 py-4 font-semibold ${
                    row.status === "미충족"
                      ? "text-destructive"
                      : row.status === "충족"
                        ? "text-accent"
                        : "text-muted-foreground"
                  }`}
                >
                  {row.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
export default function AdminDemo({ embedded = false }: { embedded?: boolean }) {
  const saved = useSavedApplication()
  const [params] = useSearchParams()
  const [state, setState] = useSharedAdmin()
  const [selectedId, setSelectedId] = useState(params.get("member") || "")
  const [counterpartId, setCounterpartId] = useState("")
  const [tab, setTab] = useState("review")
  const [considered, setConsidered] = useState(false)
  const [message, setMessage] = useState<string[]>([])
  const [reason, setReason] =
    useState<typeof PHOTO_REVIEW_REASONS[number]>("흐림")
  const today = seoulDate(new Date())
  const Body = embedded ? "section" : "main"
  const selected = state.members.find((member) => member.id === selectedId)
  const counterpart = state.members.find(
    (member) => member.id === counterpartId,
  )
  const original = selected
    ? operatorApplicationOriginal(selected.draft, selected.account)
    : null
  useEffect(() => {
    const record = () => {
      if (document.visibilityState !== "visible") return
      if (selectedId) recordCandidateView(selectedId, tab === "compare" ? "양쪽 조건 비교" : "신청 검토")
      if (tab === "compare" && counterpartId) recordCandidateView(counterpartId, "양쪽 조건 비교")
    }
    record()
    document.addEventListener("visibilitychange", record)
    return () => document.removeEventListener("visibilitychange", record)
  }, [selectedId, counterpartId, tab, state.revision])
  const blockers =
    selected && counterpart
      ? pairIssues(state, selected, counterpart, today)
      : ["양쪽 신청자를 선택해 주세요"]
  const run = (command: Parameters<typeof adminTransition>[2]) => {
    const result = adminTransition(state, state.revision, command)
    setState(result.state)
    setConsidered(false)
    setMessage(
      result.errors.length
        ? result.errors
        : [
            "가상 관리자 상태에만 반영했습니다. 실제 배정·결제·발송은 수행하지 않았습니다.",
          ],
    )
  }
  const importCurrent = () => {
    if (!saved) return
    const member = { ...applicationMember(structuredClone(saved)), account: identityAccount(getIdentity("current-member")) }
    aliasIdentity("current-member", member.id)
    setState((previous) => ({
      ...previous,
      revision: previous.revision + 1,
      members: [
        ...previous.members.filter((item) => item.id !== member.id),
        member,
      ],
      stateUpdatedAt: new Date().toISOString(),
    }))
    setSelectedId(member.id)
    setConsidered(false)
    setMessage([
      "현재 브라우저의 가상 신청 사본을 가져왔습니다. 인증·결제·참여 확인값을 만들지 않았습니다. 수정 시 다시 가져오세요.",
    ])
  }
  const selectMember = (id: string) => {
    setSelectedId(id)
    setConsidered(false)
    setMessage([])
  }
  function memberFacts(member: AdminMember) {
    const age = accountAge(member.account, today)
    return (
      <dl className="grid gap-x-8 sm:grid-cols-2">
        <Fact title="본인·성인 확인">
          {age === null
            ? "확인 전 · 자기진술은 인증이 아닙니다"
            : `가상 확인값 만 ${age}세 · ${timestamp(member.account.verifiedAt || null)}`}
          <br />
          성인 기준 만 {BEFORE_US.operatingDraft.minimumAge}세 이상 · 운영 초안
        </Fact>
        <Fact title="현재 관계·참여 자기진술">
          {member.draft.values["self.statement"] === true
            ? "현재 교제·혼인 관계 없음과 성실한 참여를 본인이 진술"
            : "응답 확인 필요"}
          <br />
          미혼·인성·안전 인증 아님
        </Fact>
        <Fact title="최근 참여 가능 확인">
          {member.participation.available
            ? "가상 자료에서 참여 가능 응답 있음"
            : "확인 필요"}
          <br />
          {timestamp(member.participation.confirmedAt)} · 자동 갱신 아님
        </Fact>
        <Fact title="직접 검토 / 시스템 상태 갱신">
          마지막 검토: {timestamp(member.lastReviewedAt)}
          <br />
          상태 갱신: {timestamp(state.stateUpdatedAt)}
          <br />
          자동 상태 갱신은 검토 이력을 만들지 않습니다.
        </Fact>
        <Fact title="적용 정책·소개 이용 권리">
          {member.policyVersion} ·{" "}
          {member.rights === "valid"
            ? "유효 권리 있음 (가상 과거 결제값)"
            : member.rights === "none"
              ? "미결제 · 준비 전 결제 안내 없음"
              : "첫 교류 실제 시작 · 재이용 정책 확인 필요"}
          <br />
          {BEFORE_US.pricing.introduction.toLocaleString()}원 / 교류 각자{" "}
          {BEFORE_US.pricing.exchangePerPerson.toLocaleString()}원
        </Fact>
        <Fact title="활성 소개·교류 / 차단·과거 상대">
          활동:{" "}
          {member.activity === "idle" ? "활성 활동 없음" : member.activity}
          <br />
          {state.proposals.some(proposal => proposal.status !== "waiting" && proposal.members.includes(member.id)) ? "후보 준비·예약 한 건 있음 · 다른 배정 차단" : "후보 준비·예약 없음"}
          <br />
          차단 {member.blockedIds.length}건 · 과거 상대{" "}
          {member.previousIds.length}건<br />
          호감·편지·A/B·만남 의사는 운영자가 대신 입력할 수 없습니다.
        </Fact>
        <Fact title="교류비 · 미시작 처리 (소개 권리와 별도)">
          {member.exchangePayment === "none" ? "교류비 결제 기록 없음" : member.exchangePayment === "paid-not-started" ? "교류비 결제됨 · 프로그램 미시작" : "프로그램 실제 시작"}
          <br />
          {member.unstartedPaymentReviewRequired ? "미시작 결제 처리 검토 필요 · 기존 거래 기록 보존" : "미시작 처리 요청 없음"}
        </Fact>
        <Fact title="프로필·선호·동의 버전">
          프로필 v{member.draft.review.profileVersion} · 선호 v
          {member.draft.review.preferenceVersion}
          <br />
          동의·사진·정책 버전은 제안 준비 시 함께 기록합니다.
        </Fact>
        <Fact title="검토 상태">
          {statusText[member.disposition]}
          <br />
          사진 품질 · 별도 외적 큐레이션 · 후보 부족은 다른 판단입니다. 외적
          등급·궁합 점수는 없습니다.
        </Fact>
      </dl>
    )
  }
  return (
    <div className={embedded ? "bg-background font-sans text-foreground" : "min-h-screen bg-background font-sans text-foreground"}>
      {!embedded && <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <Link to="/today" className="flex items-center gap-2 text-sm">
            <ArrowLeft size={16} />
            회원 데모로
          </Link>
          <span className="text-xs text-muted-foreground">
            BEFORE US / OPERATIONS · V6
          </span>
          <span className="rounded-full bg-secondary px-3 py-2 text-xs font-semibold text-primary">
            가상 관리자 데모
          </span>
        </div>
      </header>}
      <Body className={embedded ? "p-5" : "mx-auto max-w-6xl px-6 py-8 lg:py-12"}>
        <div className="mb-8 grid gap-6 lg:grid-cols-3">
          <div className="bg-primary p-7 text-primary-foreground lg:col-span-2">
            <p className="mb-5 text-xs tracking-widest">
              REVIEW BEFORE INTRODUCTION
            </p>
            <h1 className="text-3xl font-semibold leading-snug">
              한 쌍을 제안하기 전,
              <br />
              양쪽의 기준부터 확인합니다.
            </h1>
            <p className="mt-5 text-sm leading-7 text-primary-foreground/80">
              신청 접수는 유료 전환이 아닙니다. 직접 검토 → 소개 준비 → 필요한
              결제 안내 → 별도 제공 동의 → 정오 공개를 구분합니다.
            </p>
          </div>
          <aside className="border border-border bg-card p-6">
            <LockKeyhole className="mb-4 text-accent" size={24} />
            <h2 className="text-sm font-semibold">실제 운영 연결 전</h2>
            <p className="mt-3 text-xs leading-6 text-muted-foreground">
              이 경로는 권한이 보호된 실제 관리자 서비스가 아닙니다. 실제
              데이터는 연결하지 않습니다. 동시 운영자의 중복 배정 방지를 위한
              서버 잠금·원자적 검증·권한 검사가 필요합니다.
            </p>
          </aside>
        </div>
        <div className="mb-8"><DirectIntroduction /></div>
        <section
          aria-label="데모 자료"
          className="mb-8 flex flex-wrap items-center gap-3 border-b border-border pb-6"
        >
          <Button variant="outline" disabled={!saved} onClick={importCurrent}>
            현재 가상 신청 사본 가져오기
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              loadReviewFixtures()
              setSelectedId("demo-1")
              setCounterpartId("demo-2")
              setConsidered(false)
              setMessage([
                "실제 사람이 아닌 A/B/C 가상 검토 사례를 불러왔습니다. 이전 관리자 데모 상태만 초기화했습니다.",
              ])
            }}
          >
            가상 검토 사례 불러오기
          </Button>
          <p className="text-xs text-muted-foreground">
            원본 신청·회원 데이터는 변경하지 않습니다.
          </p>
        </section>
        {message.length > 0 && (
          <div
            role="status"
            className="mb-6 border-l-2 border-accent bg-secondary p-4 text-sm leading-7"
          >
            {message.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        )}
        <div className="grid items-start gap-6 lg:grid-cols-4">
          <aside className="border border-border bg-card lg:sticky lg:top-6">
            <div className="flex items-center gap-2 border-b border-border p-5 text-sm font-semibold">
              <Users size={17} />
              신청 검토 목록
            </div>
            {state.members.length === 0 ? (
              <p className="p-5 text-xs leading-6 text-muted-foreground">
                자동으로 만든 회원은 없습니다. 가상 신청이나 검토 사례를 직접
                불러오세요.
              </p>
            ) : (
              state.members.map((member) => (
                <Button
                  key={member.id}
                  variant="ghost"
                  onClick={() => selectMember(member.id)}
                  aria-pressed={selectedId === member.id}
                  className={`h-auto w-full justify-start rounded-none border-b border-border px-5 py-4 text-left ${
                    selectedId === member.id ? "bg-secondary text-primary" : ""
                  }`}
                >
                  <span>
                    <span className="block text-sm">
                      {member.id === "current-application"
                        ? "현재 가상 신청"
                        : `가상 사례 ${member.id.slice(-1)}`}
                    </span>
                    <span className="mt-2 block text-xs font-normal text-muted-foreground">
                      {statusText[member.disposition]}
                    </span>
                  </span>
                </Button>
              ))
            )}
          </aside>
          <div className="min-w-0 lg:col-span-3">
            <nav
              aria-label="관리자 검토 영역"
              className="mb-6 flex gap-2 border-b border-border pb-3"
            >
              {[
                { id: "review", label: "01 신청 검토" },
                { id: "compare", label: "02 양쪽 조건" },
                { id: "prepare", label: "03 소개 준비" },
              ].map((item) => (
                <Button
                  key={item.id}
                  variant={tab === item.id ? "default" : "ghost"}
                  aria-pressed={tab === item.id}
                  onClick={() => setTab(item.id)}
                  className="text-xs"
                >
                  {item.label}
                </Button>
              ))}
            </nav>
            {!selected ? (
              <div className="border border-border p-10 text-center text-sm text-muted-foreground">
                검토할 가상 신청을 선택해 주세요.
              </div>
            ) : tab === "review" ? (
              <div className="space-y-6">
                <section className="border border-border bg-card p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold">
                      신청과 확인은 따로 봅니다.
                    </h2>
                    <span className="text-xs text-accent">
                      PRIVATE · OPERATOR ONLY
                    </span>
                  </div>
                  {original ? memberFacts(selected) : <p className="mt-4 text-sm leading-6 text-muted-foreground">수집·운영자 검토 동의 전에는 원본 정보를 열람하지 않습니다.</p>}
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Button
                      onClick={() =>
                        run({ kind: "review", memberId: selected.id })
                      }
                    >
                      <ShieldCheck size={16} />
                      직접 검토 기록
                    </Button>
                    <Button
                      variant="outline"
                      disabled={reviewIssues(selected, today).length > 0}
                      onClick={() =>
                        run({ kind: "waiting", memberId: selected.id })
                      }
                    >
                      적합 후보 없어 대기로
                    </Button>
                  </div>
                  <p className="mt-3 text-xs leading-6 text-muted-foreground">
                    검토 버튼은 실제 확인값을 만들거나 모든 신청자를 결제
                    대상으로 바꾸지 않습니다.
                  </p>
                </section>
                {!original ? (
                  <div className="border border-border p-6 text-sm">
                    수집·운영자 검토 동의가 없어 비공개 원본을 읽지 않습니다.
                  </div>
                ) : (
                  <>
                    <section className="border border-border bg-card p-6">
                      <h3 className="mb-4 text-base font-semibold">
                        사진 기준 · 문제 슬롯만 보완
                      </h3>
                      <Select
                        value={reason}
                        onValueChange={(value) =>
                          setReason(value as typeof reason)
                        }
                      >
                        <SelectTrigger
                          aria-label="사진 보완 사유"
                          className="mb-4"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PHOTO_REVIEW_REASONS.map((item) => (
                            <SelectItem value={item} key={item}>
                              {item}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {PHOTO_SLOTS.map((slot) => {
                          const photo = selected.draft.photos[slot.id]
                          return (
                            <article
                              key={slot.id}
                              className="border border-border p-4"
                            >
                              <div className="mb-4 flex h-20 items-center justify-center bg-secondary text-xs text-muted-foreground">
                                {photo.file
                                  ? "가상 구도 자료 · 인물 사진 없음"
                                  : "미등록"}
                              </div>
                              <p className="text-sm font-semibold">
                                {slot.number}. {slot.label}{" "}
                                {slot.required ? "· 필수" : "· 선택"}
                              </p>
                              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                                {photo.review}
                                {photo.reason ? ` · ${photo.reason}` : ""}
                                <br />
                                최근 촬영은{" "}
                                {photo.recentSelfConfirmed
                                  ? "본인 자기확인"
                                  : "자기확인 전"}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    !photo.file ||
                                    photo.review === "재등록 요청"
                                  }
                                  onClick={() =>
                                    run({
                                      kind: "photo-review",
                                      memberId: selected.id,
                                      slot: slot.id,
                                      review: "기준 확인",
                                      reason: null,
                                    })
                                  }
                                >
                                  기준 확인
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!photo.file}
                                  onClick={() =>
                                    run({
                                      kind: "photo-review",
                                      memberId: selected.id,
                                      slot: slot.id,
                                      review: "재등록 요청",
                                      reason,
                                    })
                                  }
                                >
                                  이 사진 보완
                                </Button>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                      <p className="mt-4 text-xs leading-6 text-muted-foreground">
                        사진 기준 확인은 외모·인성·안전 인증이 아닙니다. 별도
                        외적 큐레이션 기준은 현재 설정되지 않았으며, 도입 시
                        사전 고지와 별도 절차가 필요합니다.
                      </p>
                    </section>
                    <details className="border border-border bg-card p-6">
                      <summary className="cursor-pointer text-sm font-semibold">
                        지역·직업 / 자기표현·생활 / 비공개 선호·필수 조건
                      </summary>
                      <div className="mt-4 rounded-xl bg-muted p-4 text-xs leading-7">
                        <p>내 주 활동 지역, 상대 선호 지역, 실제 만남 가능 지역과 이동시간은 별도 응답입니다. 지역 필수 조건은 아래에서 양쪽 방향으로 확인합니다.</p>
                        <p>직무 분야·직업명은 매칭 참고 동의 범위에서만 확인하며 기본 필수 필터가 아닙니다. 미입력은 무직이 아닌 정보 없음입니다. 상대에게는 본인이 공개를 켠 항목만 제공합니다.</p>
                      </div>
                      <dl className="mt-4">
                        {APPLICATION_FIELDS.filter(
                          (field) =>
                            (field.id.startsWith("self.") ||
                              field.id.startsWith("desired.")) &&
                            original.values[field.id] !== undefined &&
                            field.id !== "self.birthDate",
                        ).map((field) => (
                          <Fact
                            key={field.id}
                            title={`${field.label}${
                              field.id.startsWith("desired.")
                                ? " · 운영자 전용"
                                : " · 자기진술"
                            }`}
                          >
                            {valueText(original.values[field.id])}
                            {selected.draft.preferences.importance[field.id] ===
                            "required"
                              ? " · 꼭 지켜 주세요"
                              : ""}
                          </Fact>
                        ))}
                      </dl>
                      <p className="mt-4 text-xs leading-6 text-muted-foreground">
                        MBTI·사진·태그로 성격을 추론하거나 자동 궁합 점수로
                        확정하지 않습니다. 조건 변경은 본인이 수정·확인해야
                        합니다.
                      </p>
                    </details>
                    <AdminMemberHistory key={selected.id} memberId={selected.id} />
                    <details className="border border-border bg-card p-6">
                      <summary className="cursor-pointer text-sm font-semibold">
                        공개 동의 기록 · 제공용 응답 미리보기
                      </summary>
                      <dl className="my-5">
                        {REVIEW_CONSENTS.map((consent) => (
                          <Fact key={consent.id} title={consent.label}>
                            {selected.draft.values[consent.id] === true
                              ? "가상 본인 동의값 있음"
                              : "동의 없음"}
                          </Fact>
                        ))}
                      </dl>
                      <PublicProfilePreview
                        profile={publicApplicationProfile(
                          selected.draft,
                          today,
                          selected.account,
                        )}
                      />
                    </details>
                  </>
                )}
              </div>
            ) : tab === "compare" ? (
              <div className="space-y-6">
                <MatchRecommendations
                  state={state}
                  targetId={selected.id}
                  today={today}
                  onCompare={(id) => {
                    setCounterpartId(id)
                    setConsidered(false)
                  }}
                  onLoadFixtures={(next) => setState(next)}
                />
                <section className="border border-border bg-card p-6">
                  <h2 className="mb-4 text-xl font-semibold">
                    양쪽의 필수 조건을 대조합니다.
                  </h2>
                  <Select
                    value={counterpartId}
                    onValueChange={(value) => {
                      setCounterpartId(value)
                      setConsidered(false)
                    }}
                  >
                    <SelectTrigger aria-label="비교할 가상 후보">
                      <SelectValue placeholder="비교할 가상 후보 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {state.members
                        .filter((member) => member.id !== selected.id)
                        .map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.id === "current-application"
                              ? "현재 가상 신청"
                              : `가상 사례 ${member.id.slice(-1)}`}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-4 text-xs leading-6 text-muted-foreground">
                    숫자는 직접 입력·확인값으로 비교합니다. 정보가 없으면 충족이
                    아니라 확인 필요입니다. 주관적인 인상·대화·MBTI는 자동 탈락
                    조건이 아닙니다.
                  </p>
                </section>
                {counterpart && (
                  <>
                    <Comparison
                      title="신청자의 필수 기준 → 후보 실제 정보"
                      rows={compareMembers(selected, counterpart, today)}
                    />
                    <Comparison
                      title="후보의 필수 기준 → 신청자 실제 정보"
                      rows={compareMembers(counterpart, selected, today)}
                    />
                    <section className="border-l-2 border-accent bg-secondary p-5">
                      <h3 className="text-sm font-semibold">
                        배정 전 차단 검사
                      </h3>
                      {blockers.length ? (
                        blockers.map((issue) => (
                          <p key={issue} className="mt-2 text-xs leading-6">
                            {issue}
                          </p>
                        ))
                      ) : (
                        <p className="mt-2 text-sm">
                          객관적 차단 사유 없음 · 운영자의 최종 검토가
                          필요합니다.
                        </p>
                      )}
                    </section>
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="pair-considered"
                        checked={considered}
                        onCheckedChange={(value) =>
                          setConsidered(value === true)
                        }
                      />
                      <label
                        htmlFor="pair-considered"
                        className="text-sm leading-6"
                      >
                        양쪽 외적 취향·관계 기준·생활·대화 성향과 현재 참여
                        가능성을 함께 검토했습니다. 점수로 자동 확정하지
                        않았습니다.
                      </label>
                    </div>
                    <Button
                      disabled={blockers.length > 0 || !considered}
                      onClick={() => {
                        recordOperatorChoice(selected.id, counterpart.id)
                        run({
                          kind: "prepare",
                          leftId: selected.id,
                          rightId: counterpart.id,
                          considered,
                        })
                        setTab("prepare")
                      }}
                    >
                      한 쌍 소개 준비 <ArrowRight size={16} />
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <section className="space-y-6">
                <div className="border border-border bg-card p-6">
                  <h2 className="text-xl font-semibold">
                    준비와 공개 사이에도 확인이 필요합니다.
                  </h2>
                  <p className="mt-4 text-sm leading-7 text-muted-foreground">
                    소개 준비만으로 상대에게 프로필을 보내지 않습니다. 첫 교류가
                    실제 시작되기 전 혜택은 결제 시점에 따라 달라요(2026. 12. 31.까지 결제분은 30일 동안 횟수 제한 없음, 이후는 최대 5번),
                    상호 선택·결제만으로 권리가 끝나지 않습니다.
                  </p>
                </div>
                {state.proposals
                  .filter((proposal) => proposal.members.includes(selected.id))
                  .map((proposal) => (
                    <article
                      key={proposal.id}
                      className="border border-border bg-card p-6"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <h3 className="text-base font-semibold">
                          {proposal.id} · v{proposal.version}
                        </h3>
                        <span className="text-xs text-accent">
                          {proposal.status === "waiting"
                            ? "대기 · 기존 권리 유지"
                            : "소개 준비 · 미공개"}
                        </span>
                      </div>
                      <p className="mt-4 border-l-2 border-accent pl-4 text-sm leading-7">
                        제안 이유: {proposal.reason}
                      </p>
                      <p className="mt-3 text-xs text-muted-foreground">
                        공개 허용 관계 목적만 사용 · 비공개 선호 인용 없음
                      </p>
                      <dl className="my-4">
                        {proposal.members.map((id) => (
                          <Fact key={id} title={id}>
                            {state.members.find((member) => member.id === id)
                              ?.rights === "valid"
                              ? "유효 소개 권리 있음 · 추가 결제 안내 없음"
                              : "소개 제공 준비 후 첫 이용료 5,000원 안내 대상 (가상 안내만)"}
                            <br />
                            프로필 v{proposal.versions[id].profile} · 선호 v
                            {proposal.versions[id].preference} ·{" "}
                            {proposal.versions[id].policy}
                            <br />
                            공개 동의·사진 버전 스냅샷 보존
                          </Fact>
                        ))}
                      </dl>
                      <h4 className="text-sm font-semibold">
                        정오 공개 예약 게이트
                      </h4>
                      {reservationIssues(state, proposal, today).map(
                        (issue) => (
                          <p
                            key={issue}
                            className="mt-2 text-xs leading-6 text-muted-foreground"
                          >
                            {issue}
                          </p>
                        ),
                      )}
                      <div className="mt-5 flex flex-wrap gap-3">
                        <Button disabled>정오 공개 예약 · 확인 미완료</Button>
                        <Button
                          variant="outline"
                          disabled={proposal.status === "waiting"}
                          onClick={() =>
                            run({
                              kind: "release-to-waiting",
                              proposalId: proposal.id,
                            })
                          }
                        >
                          후보 사정 변경 · 권리 유지하고 대기
                        </Button>
                      </div>
                      <p className="mt-4 text-xs leading-6 text-muted-foreground">
                        예약 전에 상대용 프로필을 회원 화면에 노출하지 않습니다.
                        교류비 미시작 처리는 소개 권리와 별도로 관리하며
                        환불은 구매 시점 운영 기준·실제 제공 기록·법정 권리로 검토하며 실제 PG 처리는 미연결입니다.
                      </p>
                    </article>
                  ))}
                {!state.proposals.some((proposal) =>
                  proposal.members.includes(selected.id),
                ) && (
                  <div className="border border-border p-8 text-sm text-muted-foreground">
                    준비된 소개가 없습니다. 양쪽 조건을 검토한 뒤 한 쌍을 준비해
                    주세요.
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
        <footer className="mt-12 border-t border-border pt-5 text-xs leading-6 text-muted-foreground">
          가상 자료 · 메모리 시뮬레이션만 사용합니다. 새로고침하면 관리자 상태가
          초기화됩니다. 실제 관리자 권한·서버 잠금·결제·발송·법률 검토는
          완료되지 않았습니다.
        </footer>
      </Body>
    </div>
  )
}
