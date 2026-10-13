import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"
import {
  ArrowUpRight,
  Pencil,
  Bell,
  ShieldCheck,
  Pause,
  FileClock,
  MessageSquare,
  CreditCard,
} from "lucide-react"
import { Button } from "./components/ui/button"
import { Checkbox } from "./components/ui/checkbox"
import { Label } from "./components/ui/label"
import { Textarea } from "./components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select"
import { BEFORE_US } from "./config"
import { useSavedApplication, saveApplication } from "./application-model"
import { suspendDemoApplication } from "./application-review"
import { REVIEW_CONSENTS } from "./review-state"
import { NoticePreferencesPanel } from "./NoonStatus"
import {
  MemberContactSummary,
  useMemberServiceContext,
  protectCurrentExchange,
  submitCurrentMemberFeedback,
  requestCurrentMemberRefund,
  setContactSafetyDemo,
} from "./AgreementFlow"
import { MemberRequestForm, MemberSafetyTools } from "./MemberOperations"
import {
  useOwnMemberAccount,
  useOwnMemberFeedback,
  recordApplicationPolicy,
  setMemberMarketing,
  saveMemberPayment,
  REQUEST_LABELS,
  REQUEST_STATUSES,
  type MemberRequestKind,
} from "./member-operations-model"
import {
  emptyPaymentSession,
  introductionRights,
  RECEIPT_LABELS,
} from "./payment-model"
import type { Feedback } from "./admin-governance-model"
import { RefundPolicyPanel } from "./RefundPolicyPanel"
import { ConductPolicyNotice, MemberConductSummary } from "./ConductPolicy"
import { recordInterruption } from "./conduct-policy"
import { DataRightsPanel, MyDataSchedule, RetentionPolicyTable, WithdrawalPanel } from "./PrivacyPanels"
import type { DataInventory } from "./privacy-policy"
import { IdentityPanel, ProfileCoaching, WaitingJourney } from "./MemberTrust"

const format = (at: string | null) =>
  at
    ? new Date(at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "기록 없음"
export const RELEASE_CHECKLIST = [
  "서버 인증·당사자별 권한·정오 예약·서버 시간·배정 잠금",
  "PG 승인·환불·중복 청구 방지·일별 중복 제출 방지",
  "양쪽 동의·정책·프로필·약속 버전·발송 중복 방지·실제 결과",
  "비공개 사진 저장·실형식·디코딩 검사·재인코딩·회전 정상화·GPS 제거",
  "초안·비공개 응답 최소 제공·철회·삭제·차단 후 접근 재검토",
  "만료 링크·캐시·접근 기록 · 보유기간 초안(V6-privacy-01)의 법률 검토와 실제 삭제·백업 파기 작업",
  "사업자·법적 문서·카카오·보안 연동 · 취소·노쇼·재이용 운영 기준(V6-conduct-01)의 약관 반영·법률 검토",
  "실제 휴대폰 본인인증 업체 연동·연계정보 중복 대조 · 결혼중개업법 해당 여부 법률 확인",
] as const

function ExperienceFeedback({
  service,
}: {
  service: ReturnType<typeof useMemberServiceContext>
}) {
  const own = useOwnMemberFeedback(service.memberId, service.programId)
  const [body, setBody] = useState("")
  const [category, setCategory] = useState<Feedback["category"]>("교류 후기")
  const [operator, setOperator] = useState(false)
  const [publicConsent, setPublicConsent] = useState(false)
  const [editing, setEditing] = useState<{
    id: string
    version: number
  } | null>(
    null,
  )
  const [message, setMessage] = useState("")
  if (!service.complete)
    return (
      <section className="space-y-3 border-t border-border pt-6">
        <h2 className="text-xl">경험을 나눠 주세요</h2>
        <p className="text-sm leading-7 text-muted-foreground">
          후기·피드백 준비 중입니다. 실제 교류가 완료된 뒤 선택적으로 남길 수
          있어요. 아직 공개된 사례나 성사율을 만들어 표시하지 않습니다.
        </p>
      </section>
    )
  return (
    <section className="space-y-5 border-t border-border pt-6">
      <h2 className="text-xl">경험을 나눠 주세요 · 선택</h2>
      <p className="text-sm leading-7 text-muted-foreground">
        운영팀에게 전하는 의견과 홈페이지 공개 동의는 별개예요. 다른 참가자의
        외모·인성 평가나 별점을 받지 않습니다.
      </p>
      <Select
        value={category}
        onValueChange={(value) => setCategory(value as Feedback["category"])}
      >
        <SelectTrigger aria-label="경험 피드백 유형">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {["교류 후기", "소개 만족도", "운영 경험", "일정·장소 기능 의견"].map(
            (type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
      <Textarea
        value={body}
        maxLength={500}
        onChange={(event) => {
          setBody(event.target.value)
          setPublicConsent(false)
        }}
        aria-label="가상 경험 피드백"
        placeholder="실제로 완료한 가상 교류 경험만 적어 주세요. 실명·연락처·상대 편지 원문 제외"
        className="min-h-28 bg-background leading-7"
      />
      <Label className="flex items-center gap-3 text-sm">
        <Checkbox
          checked={operator}
          onCheckedChange={(value) => setOperator(value === true)}
        />
        운영팀에게 의견을 전달할게요.
      </Label>
      <Label className="flex items-center gap-3 text-sm">
        <Checkbox
          checked={publicConsent}
          onCheckedChange={(value) => setPublicConsent(value === true)}
        />
        이 버전의 의견을 공개 검토 후보로 제공해도 괜찮아요. (선택)
      </Label>
      <Button
        disabled={!operator || !body.trim()}
        onClick={() => {
          const error = submitCurrentMemberFeedback({
            body,
            category,
            operatorConsent: operator,
            publicConsent,
            ...(editing || {}),
          })
          setMessage(
            error ||
              "가상 경험 피드백을 기록했어요. 홈페이지 게시·발송은 하지 않습니다.",
          )
          if (!error) {
            setBody("")
            setOperator(false)
            setPublicConsent(false)
            setEditing(null)
          }
        }}
      >
        {editing ? "수정본 검토 요청" : "가상 의견 전달"}
      </Button>
      <p role="status" className="text-sm text-primary">
        {message}
      </p>
      {own.map((item) => (
        <div
          key={item.id}
          className="space-y-2 rounded-xl bg-muted p-4 text-xs"
        >
          <p>
            {item.category} · v{item.version} ·{" "}
            {item.publicConsentAt && item.consentVersion === item.version
              ? "공개 검토 후보 · 아직 게시되지 않음"
              : "운영팀 전용 · 비공개"}
          </p>
          <p>
            운영 확인:{" "}
            {item.review === "pending"
              ? "대기"
              : item.review === "revision-review"
                ? "수정·발췌 재검토"
                : "확인 기록"}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing({ id: item.id, version: item.version })
              setBody(item.body)
              setCategory(item.category)
              setOperator(false)
              setPublicConsent(false)
            }}
          >
            내 의견 수정
          </Button>
        </div>
      ))}
      <p className="text-xs leading-6 text-muted-foreground">
        내용 수정·발췌는 별도 검토가 필요하며 공개를 다시 확인합니다. 공개
        동의만으로 자동 게시하지 않습니다.
      </p>
    </section>
  )
}

export default function MemberProfile() {
  const [params] = useSearchParams(),
    service = useMemberServiceContext(params.get("demo") === "agreement"),
    saved = useSavedApplication()
  const application = service.connected ? null : saved
  const account = useOwnMemberAccount(service.memberId)
  const payment = service.payment || account?.payment || emptyPaymentSession()
  const rights = introductionRights(payment, service.now)
  const [kind, setKind] = useState<MemberRequestKind | null>(null)
  const [receiptKind, setReceiptKind] = useState<"introduction" | "exchange">(
    "introduction",
  )
  const [parentId, setParentId] = useState<string | undefined>()
  const context = {
    memberId: service.memberId,
    targetId: service.targetId,
    programId: service.programId,
    surface: "내 정보",
  }
  useEffect(() => {
    if (service.payment)
      saveMemberPayment(service.memberId, service.payment, service.now)
  }, [service.memberId, service.payment])
  useEffect(() => {
    if (application?.savedAt)
      recordApplicationPolicy("current-member", {
        sourceAt: application.savedAt,
        version: BEFORE_US.policyVersion,
        profileVersion: application.review.profileVersion,
        preferenceVersion: application.review.preferenceVersion,
        consents: REVIEW_CONSENTS.filter(
          (item) => application.values[item.id] === true,
        ).map((item) => item.label),
      })
  }, [application?.savedAt])
  const afterRequest = () => {
    if (service.connected && kind === "refund")
      requestCurrentMemberRefund(receiptKind)
    if (service.connected && kind === "revoke") setContactSafetyDemo("review")
    if (application && kind === "revoke")
      saveApplication(suspendDemoApplication(application, "held"))
  }
  // 탈퇴 요청 즉시: 상대 노출·신규 접근·미공개 연락처 예약을 멈추고, 진행 중 교류는 본인 요청 중단으로 기록한다.
  const afterWithdrawal = () => {
    if (service.connected) {
      setContactSafetyDemo("review")
      for (const type of ["introduction", "exchange"] as const)
        if (payment[type] && ["confirmed", "requested"].includes(payment[type]!.status))
          requestCurrentMemberRefund(type)
      if (service.exchangeStatus === "started" && !service.complete) {
        protectCurrentExchange("interrupt")
        if (service.programId && service.targetId)
          recordInterruption({ programId: service.programId, actorId: service.memberId, partnerId: service.targetId, reason: "self-change", session: payment }, service.now)
      }
    }
    if (application) saveApplication(suspendDemoApplication(application, "withdrawn"))
  }
  const inventory: DataInventory = {
    memberId: service.memberId,
    photoCount: application ? Object.values(application.photos).filter((photo) => photo.file).length : 0,
    exchangeActive: service.exchangeStatus === "started" && !service.complete,
    exchangeEndedAt: null,
    meetingDate: null,
    payments: [payment.introduction, payment.exchange]
      .filter((receipt) => receipt?.confirmedAt)
      .map((receipt) => ({ id: receipt!.id, at: receipt!.confirmedAt! })),
    complaints: (account?.requests || [])
      .filter((item) => ["refund", "reconsider"].includes(item.kind))
      .map((item) => ({ id: item.id, closedAt: item.status === "decided" ? item.transitions.at(-1)?.at || null : null })),
    safetyReports: [],
    advertisingAt: null,
    litigationHold: false,
  }
  const request = (value: MemberRequestKind) => {
    setKind(value)
    setParentId(undefined)
  }
  return (
    <section className="space-y-9 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-7">
        <div>
          <p className="text-xs tracking-widest text-primary">MY / BEFORE US</p>
          <h1 className="mt-3 text-3xl">내 정보</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            내가 알려 준 정보와, 지금의 참여 상태를 살펴보세요.
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground">
          가상 자료 데모 · 실제 수집·발송 없음
        </span>
      </header>
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-5 rounded-xl bg-primary p-6 text-primary-foreground lg:col-span-2">
          <p className="text-xs tracking-widest">
            MY INTRODUCTION / {payment.policy.version}
          </p>
          <h2 className="max-w-xl text-2xl leading-relaxed">
            첫 교류 시작 전,
            <br />
            소개 횟수 제한 없음
          </h2>
          <p className="max-w-xl text-sm leading-7 opacity-90 dark:opacity-100">
            이번 신청에서 첫 A/B가 실제 시작되기 전까지의 초기 혜택입니다. 하루
            최대 한 명, 매일 새 소개는 보장하지 않아요. 평생 재소개·실제
            만남·연애 보장은 아닙니다.
          </p>
          <div className="border-t border-primary-foreground/20 pt-4 text-sm">
            {rights === "valid"
              ? "소개 이용 권리 유지 · 첫 교류 실제 시작 전"
              : rights === "first-program-started" || service.startedAt
                ? "첫 교류 실제 시작 기록 · 이번 소개 혜택 종료, 재이용 정책 확인 필요"
                : payment.introduction ? `소개 결제 ${RECEIPT_LABELS[payment.introduction.status]} · 권리·후속 처리는 별도 확인` : "소개 결제 기록 없음 · 신청·검토·소개 준비 대기는 무료"}
          </div>
          <p className="text-xs leading-6 opacity-90 dark:opacity-100">
            소개 정지·마케팅 해제·정오 대기 알림 해제로 이 권리가 소멸하지
            않습니다. 숨은 만료·추가 소개권 구매는 없습니다.
          </p>
        </section>
        <section className="space-y-4 rounded-xl border border-border bg-background p-6">
          <div className="flex items-center gap-2 text-sm">
            <Pause className="size-4 text-primary" />
            일시정지
          </div>
          <p className="text-xl">
            {account?.payment.activity === "paused"
              ? "새 소개 일시정지"
              : account?.payment.activity === "withdrawal-requested"
                ? "탈퇴 요청 접수"
                : "새 소개 받는 중"}
          </p>
          <p className="text-xs leading-6 text-muted-foreground">
            일시정지는 신규 소개만 멈춰요. 소개 이용 권리·결제·진행 중인 교류는
            그대로 보존하며, 재개는 현재 참여 가능 상태를 확인한 뒤 처리합니다.
            탈퇴와는 다르며 자료를 삭제하지 않아요.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={account?.payment.activity === "withdrawal-requested"}
              onClick={() => request("pause")}
            >
              소개 일시정지
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!account || account.payment.activity !== "paused"}
              onClick={() => request("resume")}
            >
              재개 요청
            </Button>
          </div>
        </section>
      </div>
      {!service.connected && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <WaitingJourney application={application} />
          <div className="space-y-6">
            <IdentityPanel />
            <ProfileCoaching application={application} />
          </div>
        </div>
      )}
      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <Pencil className="size-4 text-primary" />
          <h2 className="text-xl">소개 정보 수정</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { title: "프로필", step: 0, caption: "나에 대한 정보·자기진술" },
            { title: "사진", step: 1, caption: "문제 사진만 수정·재검토" },
            { title: "비공개 선호", step: 2, caption: "다음 소개에 반영" },
            {
              title: "공개 범위·동의",
              step: 3,
              caption: "상대 제공 항목을 따로 확인",
            },
          ].map((item) => (
            <Button
              key={item.step}
              asChild
              variant="outline"
              className="h-auto justify-between whitespace-normal p-5"
            >
              <Link to={`/apply?step=${item.step}`}>
                <span className="text-left">
                  <span className="block text-sm">{item.title}</span>
                  <span className="mt-2 block text-xs font-normal text-muted-foreground">
                    {item.caption}
                  </span>
                </span>
                <ArrowUpRight className="size-4 shrink-0" />
              </Link>
            </Button>
          ))}
        </div>
        <p className="text-xs leading-6 text-muted-foreground">
          기존 STEP 01~04로 이동해 수정합니다. 핵심 프로필·사진은 새 버전으로
          재검토하며 승인 사진을 조용히 교체하지 않습니다. 비공개 선호 변경은
          현재 교류를 자동 종료하지 않습니다.
          {service.connected
            ? " 이 편집기는 별도의 가상 신청 원본이며 교류 데모 계정 정보로 자동 가져오지 않습니다."
            : application
              ? ` 현재 저장 원본: 프로필 v${application.review.profileVersion} · 선호 v${application.review.preferenceVersion} · 신청 ${application.review.submission}`
              : " 아직 저장된 신청 원본이 없습니다."}
        </p>
      </section>
      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-5 rounded-xl border border-border p-5">
          <h2 className="flex items-center gap-2 text-xl">
            <Bell className="size-4 text-primary" />
            알림 선택
          </h2>
          <NoticePreferencesPanel memberId={service.memberId} />
          <Label className="flex items-start gap-3 text-sm leading-6">
            <Checkbox
              checked={account?.marketing || false}
              onCheckedChange={(value) =>
                setMemberMarketing(service.memberId, value === true)
              }
            />
            마케팅 안내에 동의해요. (선택·가상)
          </Label>
          <p className="text-xs leading-6 text-muted-foreground">
            서비스 상태 안내와 별도이며 자동 체크하지 않습니다. 해제해도 소개
            권리는 유지돼요.
          </p>
        </section>
        <section className="space-y-5 rounded-xl border border-border p-5">
          <h2 className="flex items-center gap-2 text-xl">
            <CreditCard className="size-4 text-primary" />
            결제·환불 요청
          </h2>
          {(["introduction", "exchange"] as const).map((type) => (
            <div
              key={type}
              className="space-y-2 border-b border-border pb-4 text-sm"
            >
              <p>
                {type === "introduction" ? "소개 이용료" : "교류비"} ·{" "}
                {payment[type]
                  ? `${payment[type]!.amount.toLocaleString("ko-KR")}원 · ${RECEIPT_LABELS[payment[type]!.status]}`
                  : "기록 없음"}
              </p>
              <p className="text-xs text-muted-foreground">
                {format(payment[type]?.confirmedAt || null)}
              </p>
              {payment[type] && <RefundPolicyPanel session={payment} kind={type} now={service.now} />}
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !account?.payment[type] ||
                  !["confirmed", "requested"].includes(
                    account.payment[type]!.status,
                  )
                }
                onClick={() => {
                  setReceiptKind(type)
                  request("refund")
                }}
              >
                이 거래 환불·취소 요청
              </Button>
            </div>
          ))}
          <Button asChild variant="outline">
            <Link
              to={service.connected ? "/payments?demo=agreement" : "/payments"}
            >
              기존 결제 안내 확인
            </Link>
          </Button>
          <p className="text-xs leading-6 text-muted-foreground">
            실제 PG 미연결입니다. 구매 시점 환불 기준·제공 개시 이력을 확인하고 요청·검토·완료를 구분합니다. 법정 청약철회 권리는 제한하지 않습니다. 탈퇴·정지는 자동 전액 환불 또는 권리
            소멸이 아닙니다.
          </p>
        </section>
      </div>
      {kind &&
        !["revoke", "withdrawal", "deletion", "correction", "restriction", "reconsider"].includes(kind) && (
          <section className="rounded-xl border border-primary/20 bg-muted p-5">
            <MemberRequestForm
              key={`${service.memberId}-${kind}-${parentId || receiptKind}`}
              context={context}
              kind={kind}
              now={service.now}
              receiptKind={kind === "refund" ? receiptKind : undefined}
              parentId={parentId}
              onApplied={afterRequest}
            />
          </section>
        )}
      <section className="space-y-4 border-t border-border pt-6">
        <h2 className="flex items-center gap-2 text-xl">
          <FileClock className="size-4 text-primary" />
          소개 이력
        </h2>
        {account?.history.length ? (
          account.history.map((item) => (
            <div
              key={item.id}
              className="grid gap-2 rounded-xl bg-muted p-4 text-xs sm:grid-cols-3"
            >
              <span>공개: {format(item.publishedAt)}</span>
              <span>내 응답: {format(item.ownResponseAt)}</span>
              <span>종료 상태: {item.endReason || "진행 중"}</span>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            확인된 소개 이력이 없습니다. 가상 교류 기록으로 소개 횟수를 추정하지
            않습니다.
          </p>
        )}
        <p className="text-xs leading-6 text-muted-foreground">
          본인의 이력 요약만 표시하며 종료된 상대 사진·프로필을 무제한 다시 보는
          보관함이 아닙니다.
        </p>
      </section>
      <section className="space-y-4 border-t border-border pt-6">
        <h2 className="flex items-center gap-2 text-xl">
          <ShieldCheck className="size-4 text-primary" />내 적용 정책·동의 기록
        </h2>
        <p className="text-sm">
          적용 정책 {payment.policy.version} · 구매 시점 제공 범위는 이후 신규
          판매 정책과 분리합니다.
        </p>
        {account?.policies.length ? (
          account.policies.map((item) => (
            <details
              key={item.key}
              className="rounded-xl border border-border p-4 text-xs"
            >
              <summary className="cursor-pointer">
                    {item.source === "purchase" ? "구매" : item.source === "disclosure" ? "결제 안내 확인 · 승인 아님" : "신청"} 스냅샷 ·{" "}
                {item.version} · 원본 저장/가상 승인 {format(item.sourceAt)}
              </summary>
              <p className="mt-3 leading-6">{item.scope}</p>
              {item.amount !== undefined && (
                <p className="mt-2">
                  {item.source === "disclosure" ? "확인한 안내 가격 · 승인 아님" : "구매 기록"} {item.amount.toLocaleString("ko-KR")}원 ·{" "}
                  {item.vatIncluded ? "부가세 포함" : "부가세 기준 확인 필요"} ·
                  환불 정책 {item.refundPolicy || "고지·확인 필요"}
                </p>
              )}
              <p className="mt-2 leading-6">
                기록된 동의:{" "}
                {item.consents.length
                  ? item.consents.join(" / ")
                  : "별도 동의 원본 연결 필요 · 동의를 추정하지 않음"}
              </p>
              <p className="mt-2 text-muted-foreground">
                시스템 스냅샷 기록: {format(item.at)} · 운영자 실제 검토 시각
                아님
              </p>
            </details>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            구매·신청 동의 원본 기록이 아직 연결되지 않았어요. 열람만으로 동의
            완료를 만들지 않습니다.
          </p>
        )}
        <p className="text-xs leading-6 text-muted-foreground">
          중단·탈퇴·취소·미시작·시작 후 중단·재이용·자료 보유는 고지한 정책으로
          처리합니다. 환불 운영 기준은 구매 시점 버전으로 관리하며 실제 약관 검토는 별도입니다. 교류 중단·약속 취소·노쇼·재이용은 V6-conduct-01 운영 기준을 따르며
          영구 보관·무조건 환불 불가·숨은 기간 소멸을 지정하지 않습니다.
        </p>
      </section>
      <section className="space-y-4 border-t border-border pt-6">
        <h2 className="text-xl">교류·약속 기록과 다음 소개</h2>
        <MemberConductSummary
          memberId={service.memberId}
          payment={payment}
          now={service.now}
          programEnded={service.complete}
          lastReviewAt={null}
        />
        <ConductPolicyNotice compact />
      </section>
      <MemberContactSummary />
      <MemberSafetyTools
        key={`safety-${service.memberId}`}
        context={context}
        now={service.now}
        onProtect={service.connected ? protectCurrentExchange : undefined}
      />
      <section className="space-y-4 border-t border-border pt-6">
        <h2 className="text-xl">공개 철회</h2>
        <Button variant="outline" onClick={() => request("revoke")}>
          {REQUEST_LABELS.revoke}
        </Button>
        <p className="text-xs leading-6 text-muted-foreground">
          새 소개를 중지하고 기존 접근 범위를 재검토합니다. 이미 본
          화면·저장·캡처의 회수는 보장하지 않습니다.
        </p>
      </section>
      {kind === "revoke" && (
        <section className="rounded-xl border border-primary/20 bg-muted p-5">
          <MemberRequestForm
            key={`${service.memberId}-${kind}`}
            context={context}
            kind={kind}
            now={service.now}
            onApplied={afterRequest}
          />
        </section>
      )}
      <section className="space-y-4 border-t border-border pt-6">
        <h2 className="text-xl">내 정보 정정·삭제·처리정지</h2>
        <DataRightsPanel key={`rights-${service.memberId}`} context={context} inventory={inventory} now={service.now} />
      </section>
      <section className="space-y-4 border-t border-border pt-6">
        <h2 className="text-xl">자료 보유 기간</h2>
        <MyDataSchedule inventory={inventory} now={service.now} />
        <details className="rounded-xl border border-border p-4">
          <summary className="cursor-pointer text-sm">자료별 보유·삭제 기준 보기</summary>
          <div className="mt-4">
            <RetentionPolicyTable />
          </div>
        </details>
      </section>
      <section className="space-y-4 rounded-xl border border-destructive/30 p-5">
        <h2 className="text-xl">회원 탈퇴</h2>
        <p className="text-xs leading-6 text-muted-foreground">
          일시정지와 달리 계정을 정리합니다. 진행 중인 소개·교류·약속이 있어도
          탈퇴할 수 있으며, 종료되는 내용과 환불·취소 상태를 먼저 보여 드려요.
        </p>
        <WithdrawalPanel
          key={`withdrawal-${service.memberId}`}
          input={{
            memberId: service.memberId,
            payment,
            introductionActive: !!payment.introduction && rights === "valid" && !!payment.program && !payment.program.withdrawn,
            exchangeStatus: service.exchangeStatus,
            appointmentActive: service.appointmentActive,
            contactScheduled: service.contactScheduled,
            inventory,
            now: service.now,
          }}
          context={context}
          onApplied={afterWithdrawal}
        />
      </section>
      <section className="space-y-4 border-t border-border pt-6">
        <h2 className="flex items-center gap-2 text-xl">
          <MessageSquare className="size-4 text-primary" />내 요청 진행
        </h2>
        {account?.requests.length ? (
          account.requests.map((item) => (
            <div
              key={item.id}
              className="space-y-3 rounded-xl bg-muted p-4 text-sm"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <span>{REQUEST_LABELS[item.kind]}</span>
                <span className="text-xs text-primary">
                  {REQUEST_STATUSES[item.status]}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                접수 {format(item.at)} · 적용 정책 {item.policyVersion}
              </p>
              {item.transitions.map((event, index) => (
                <p key={index} className="text-xs leading-6">
                  {REQUEST_STATUSES[event.status]} · {format(event.at)} ·{" "}
                  {event.note}
                </p>
              ))}
              {item.status === "decided" && (
                <>
                  <p className="text-sm">
                    결정 기록:{" "}
                    {item.decision ||
                      "구체적인 회원 안내는 운영자 확인이 필요합니다."}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setKind("reconsider")
                      setParentId(item.id)
                    }}
                  >
                    이 결정 재검토 요청
                  </Button>
                </>
              )}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            아직 접수된 요청이 없습니다.
          </p>
        )}
      </section>
      {kind === "reconsider" && (
        <section className="rounded-xl border border-primary/20 bg-muted p-5">
          <MemberRequestForm
            key={parentId}
            context={context}
            kind={kind}
            parentId={parentId}
            now={service.now}
          />
        </section>
      )}
      <ExperienceFeedback key={`feedback-${service.memberId}`} service={service} />
      <div className="border-l-2 border-accent bg-muted p-5 text-xs leading-7 text-muted-foreground">
        가상 자료·메모리 데모입니다. 사진·편지·자유 입력·이상형을 광고나 외부
        분석으로 전송하지 않습니다. 실제 과금·발송·자동 공개를 하지 않습니다.
        공개 URL·숨긴 DOM을 보안 완료라고 주장하지 않습니다.
      </div>
    </section>
  )
}

export function MemberSupport() {
  const [params] = useSearchParams(),
    service = useMemberServiceContext(params.get("demo") === "agreement")
  return (
    <section className="max-w-3xl space-y-6">
      <p className="text-xs tracking-widest text-primary">
        SUPPORT / BEFORE US
      </p>
      <h1 className="text-3xl">문의·신고·진행 보호</h1>
      <p className="text-sm leading-7 text-muted-foreground">
        운영 문의와 보호 요청을 따로 확인합니다. 실제 긴급 접수·서버 권한·발송은
        연결되지 않은 가상 자료 데모입니다.
      </p>
      <MemberSafetyTools
        key={service.memberId}
        context={{
          memberId: service.memberId,
          targetId: service.targetId,
          programId: service.programId,
          surface: "문의·신고",
        }}
        now={service.now}
        onProtect={service.connected ? protectCurrentExchange : undefined}
      />
      <Button asChild variant="outline">
        <Link to={service.connected ? "/profile?demo=agreement" : "/profile"}>
          내 요청 진행 확인
        </Link>
      </Button>
    </section>
  )
}
