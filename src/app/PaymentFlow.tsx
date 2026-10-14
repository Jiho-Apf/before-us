import { PLAN_NOTICE, planFor, planIfPaidNow } from "./introduction-plan"
import { DemoDock } from "./DemoDock"
import { useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useOwnMemberAccount, saveMemberPayment } from "./member-operations-model"
import { useMemberServiceContext, saveCurrentMemberPayment } from "./AgreementFlow"
import { ArrowRight, LockKeyhole, CircleCheck, Info } from "lucide-react"
import { Button } from "./components/ui/button"
import { Checkbox } from "./components/ui/checkbox"
import { Label } from "./components/ui/label"
import { RefundPolicyPanel } from "./RefundPolicyPanel"
import {
  canAgreeProgram,
  emptyPaymentSession,
  hasMutualSelection,
  introductionRights,
  makePaymentFixture,
  paymentGate,
  readyForIntroduction,
  requestDemoPayment,
  requestPaymentCancellation,
  validOwnPayment,
  PAYMENT_SCENARIOS,
  RECEIPT_LABELS,
  type PaymentSession,
  type OwnReceipt,
} from "./payment-model"

const amount = (value: number) => `${value.toLocaleString("ko-KR")}원`
function OwnPaymentRecord({ receipt }: { receipt: OwnReceipt | null }) {
  if (!receipt)
    return (
      <p className="text-sm text-muted-foreground">
        아직 결제 기록이 없습니다.
      </p>
    )
  return (
    <dl className="space-y-2 text-xs leading-6">
      <div className="flex flex-wrap justify-between gap-2">
        <dt className="text-muted-foreground">내 결제 상태</dt>
        <dd className="font-semibold">{RECEIPT_LABELS[receipt.status]}</dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">내 결제 금액</dt>
        <dd>{amount(receipt.amount)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">내부 기록ID · 가상</dt>
        <dd className="break-all">{receipt.id}</dd>
      </div>
      {receipt.confirmedAt && (
        <div>
          <dt className="text-muted-foreground">가상 승인 기록 시각</dt>
          <dd>
            {new Date(receipt.confirmedAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}
          </dd>
        </div>
      )}
      {receipt.refundedAt && (
        <div>
          <dt className="text-muted-foreground">가상 환불 기록 시각</dt>
          <dd>
            {new Date(receipt.refundedAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}
          </dd>
        </div>
      )}
    </dl>
  )
}
export function PaymentFlow({
  initial,
  kind,
  onSessionChange,
  nowOverride,
}: {
  initial: PaymentSession
  kind: "introduction" | "exchange"
  onSessionChange?: (session: PaymentSession) => void
  nowOverride?: Date
}) {
  const [session, setSession] = useState(initial)
  const [acknowledged, setAcknowledged] = useState(false)
  const [message, setMessage] = useState("")
  const now = nowOverride || new Date()
  const blocked = paymentGate(session, kind, now)
  const receipt = session[kind]
  const rights = introductionRights(session, now)
  const apply = (result: ReturnType<typeof requestDemoPayment>) => {
    if (result.error) {
      setMessage(result.error)
      return
    }
    setSession(result.session)
    onSessionChange?.(result.session)
    setMessage(
      result.session[kind]?.status === "cancellation-requested"
        ? "가상 취소 요청만 기록했습니다. 실제 취소·환불·권리 소멸은 처리하지 않았습니다."
        : "가상 요청만 기록했습니다. 실제 승인·청구는 없으며 승인 완료로 표시하지 않습니다.",
    )
  }
  const mutual = hasMutualSelection(session, now)
  const introPlan = session.introduction?.confirmedAt ? planFor(new Date(session.introduction.confirmedAt)) : planIfPaidNow(now)
  const introductionReady =
    readyForIntroduction(session, now) ||
    validOwnPayment(session.introduction, now)
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold tracking-widest text-accent">
          {kind === "introduction" ? "01 / INTRODUCTION" : "02 / EXCHANGE"}
        </p>
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          가상 자료 · {session.policy.version}
        </span>
      </div>
      <div>
        <h2 className="text-2xl font-semibold leading-relaxed">
          {kind === "introduction"
            ? introductionReady ? "소개 이용료" : "첫 소개 준비 대기"
            : mutual
              ? "상호 선택 후 교류비"
              : "상호 선택을 기다리고 있어요"}
        </h2>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          {kind === "introduction"
            ? "준비된 한 사람을 소개하기 전에, 제공 범위를 확인해 주세요."
            : "서로 알아가기로 선택한 뒤, 각자의 교류비를 확인합니다."}
        </p>
      </div>
      {kind === "introduction" ? (
        <div className="border-y-2 border-foreground py-7">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">{introductionReady ? "소개 이용료 · 1인" : "지금 내는 비용"}</p>
          <p className="mt-3 text-4xl font-extralight leading-none tabular-nums sm:text-5xl">
            {introductionReady ? amount(session.policy.introduction) : "0원"}
          </p>
          {!introductionReady && <p className="mt-3 text-sm font-semibold text-accent">지금은 무료 대기</p>}
          <p className="mt-3 text-sm font-medium leading-7">
            {introPlan.label} · {introPlan.summary}
          </p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            신청·검토·첫 소개 준비 전 대기는 무료입니다. 실제 준비와 현재 참여
            가능 상태를 확인한 뒤 안내합니다.
          </p>
        </div>
      ) : mutual ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <dl className="space-y-4 bg-background p-5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">이미 낸 소개비</dt>
              <dd>
                {validOwnPayment(session.introduction, now)
                  ? amount(session.introduction!.amount)
                  : "기납 기록 확인 필요"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>이번 교류비 · 1인</dt>
              <dd className="font-semibold">
                {amount(session.policy.exchange)}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border pt-4">
              <dt>첫 교류까지 총액 · 1인</dt>
              <dd className="text-xl font-semibold text-primary">
                {amount(session.policy.introduction + session.policy.exchange)}
              </dd>
            </div>
          </dl>
          <p className="bg-secondary px-5 py-3 text-xs text-muted-foreground">
            각자 1인 · 부가세 포함 · A/B 동일 가격 · 현장 비용 별도
          </p>
        </div>
      ) : null}
      {blocked && (
        <p className="flex items-start gap-2 rounded-lg border border-border p-4 text-sm leading-7">
          <LockKeyhole size={16} className="mt-1 shrink-0 text-accent" />
          {blocked}
        </p>
      )}
      {kind === "exchange" && mutual && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-4">
            <OwnPaymentRecord receipt={session.exchange} />
          </div>
          <div className="rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground">상대 결제 상태</p>
            <p className="mt-3 text-sm font-semibold">
              {session.program?.partnerPayment === "confirmed"
                ? "가상 완료 상태 확인"
                : "미확인 · 대기"}
            </p>
            <p className="mt-3 text-xs leading-6 text-muted-foreground">
              상대의 카드·결제ID·거래 상세는 제공하지 않습니다.
            </p>
          </div>
        </div>
      )}
      {kind === "introduction" && receipt && (
        <OwnPaymentRecord receipt={receipt} />
      )}
      <div className="space-y-3 text-sm leading-7">
        <h3 className="font-semibold">결제 전 꼭 확인해 주세요</h3>
        <ul className="divide-y divide-border border-y border-border text-muted-foreground [&>li]:py-3">
          <li>
            준비된 날 정오 12시, Asia/Seoul에 하루 최대 한 명을 소개합니다. 매일
            새 소개를 보장하지 않습니다.
          </li>
          <li>
            {PLAN_NOTICE.early} {PLAN_NOTICE.standard} {PLAN_NOTICE.carryOver} 평생 재소개나 모든 데이트·프로그램 제공이 아닙니다.
          </li>
          <li>
            상호 선택 뒤 새 소개는 잠시 멈춥니다. 상호 선택·결제·A/B 합의만으로
            소개 이용 권리가 종료되지는 않습니다.
          </li>
          <li>
            상대 미결제·철회 또는 방식·시작일 미합의로 시작하지 못하면 소개
            권리를 유지하고, 기납 교류비의 반환·재개는 별도 정책으로 처리합니다.
          </li>
          <li>
            상대 변경 시 이전 교류비를 동의 없이 이전하거나 같은 금액을 중복
            청구하지 않습니다.
          </li>
        </ul>
      </div>
      <RefundPolicyPanel session={session} kind={kind} now={now} onChange={value => { setSession(value); onSessionChange?.(value); setMessage("정책에 따른 가상 요청·선택만 기록했습니다. 실제 환불 완료·PG 처리는 하지 않았습니다."); }} />
      <Label
        htmlFor={`payment-notice-${kind}`}
        className="items-start leading-6"
      >
        <Checkbox
          id={`payment-notice-${kind}`}
          className="mt-1 shrink-0"
          checked={acknowledged}
          onCheckedChange={(value) => setAcknowledged(value === true)}
        />
        <span>
          제공 범위·매일 미보장·대기·미시작·취소·환불 안내와 현재 데모 상태를
          확인했어요.
        </span>
      </Label>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={
            !acknowledged || !!blocked || receipt?.status === "requested"
          }
          onClick={() => apply(requestDemoPayment(session, kind, acknowledged, now))}
          className="h-12 rounded-xl transition-colors duration-200 motion-reduce:transition-none"
        >
          {receipt?.status === "failed"
            ? "가상 재시도 요청 · 승인 아님"
            : "가상 요청 흐름 확인 · 승인 아님"}
          <ArrowRight size={16} />
        </Button>
        <Button disabled variant="outline" className="h-12 rounded-xl">
          실제 결제 · PG 미연결
        </Button>
        {receipt && ["confirmed", "requested"].includes(receipt.status) && (
          <Button
            variant="outline"
            className="h-12 rounded-xl"
            onClick={() => apply(requestPaymentCancellation(session, kind, now))}
          >
            가상 취소 문의 요청
          </Button>
        )}
      </div>
      {message && (
        <p
          role="status"
          className="rounded-xl border border-border p-4 text-sm leading-7"
        >
          {message}
        </p>
      )}
      {kind === "exchange" && (
        <div className="border-t border-border pt-5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CircleCheck size={16} className="text-accent" />
            {canAgreeProgram(session, now)
              ? "양쪽 가상 결제 기록 확인 · 합의 준비 가능"
              : "양쪽 결제 확인 전 · A/B 합의 잠금"}
          </p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            결제 확인 후 기존 A/B 선택 화면에서 두 사람이 같은 방식·시작 시각에
            동의합니다. 합의한 시각에 프로그램이 실제 개시되고 이용 가능함이
            확인돼야 이번 소개 혜택이 종료됩니다. 스케줄러 오류·미제출·운영
            미이행·중단은 정상 완료 보장이 아닙니다.
          </p>
          {canAgreeProgram(session, now) && !session.firstProgramStartedAt && (
            <Button asChild variant="outline" className="mt-4 rounded-xl">
              <Link to="/demo/agreement">
                A/B 공유·일정 합의 데모 <ArrowRight size={15} />
              </Link>
            </Button>
          )}
        </div>
      )}
      <p className="rounded-lg bg-secondary p-4 text-xs leading-6">
        소개 이용 권리:{" "}
        {rights === "first-program-started"
          ? "첫 교류 실제 개시 기록 · 이번 혜택 종료 (가상)"
          : rights === "valid"
            ? "유지 · 첫 교류 미시작 (가상)"
            : "기납 승인 기록 확인 전"}{" "}
        · 회원별 적용 정책 {session.policy.version}
      </p>
      <p className="flex gap-2 text-xs leading-6 text-muted-foreground">
        <Info size={14} className="mt-1 shrink-0" />
        모든 금액·기록은 데모입니다. 실제 PG·자동 결제·추가 과금·승인·환불은
        연결하지 않습니다. 가상 요청·취소는 화면 메모리에만 남으며 새로고침 시
        지워집니다.
      </p>
    </div>
  )
}
export default function MemberPayments() {
  const [params]=useSearchParams(),service=useMemberServiceContext(params.get("demo")==="agreement"),account=useOwnMemberAccount(service.memberId);
  const sourcePayment=service.payment || account?.payment || emptyPaymentSession();
  const payment=account && account.payment.activity!=="active" ? {...sourcePayment,activity:account.payment.activity} : sourcePayment;
  return (
    <section className="mx-auto max-w-3xl py-8">
      <h1 className="sr-only">결제 안내</h1>
      <PaymentFlow key={`${service.memberId}-${payment.applicationId}-${payment.activity}`} initial={payment} kind={params.get("kind")==="exchange" ? "exchange" : "introduction"} onSessionChange={value=>{if(service.connected)saveCurrentMemberPayment(value);saveMemberPayment(service.memberId,value,service.now);}} />
      <Button asChild variant="ghost" className="mt-6">
        <Link to="/today">오늘로 돌아가기</Link>
      </Button>
    </section>
  )
}
export function PaymentDemo() {
  const [scenario, setScenario] = useState("ready")
  const [linked,setLinked]=useState(false)
  return (
    <section className="mx-auto max-w-3xl space-y-8 py-8">
      <h1 className="sr-only">개발용 결제 상태 미리보기</h1>
      <DemoDock title="결제 상태 미리보기" defaultOpen>
        <p className="text-xs leading-6 text-muted-foreground">
          상태 선택은 가상 사례를 불러올 뿐 실제 결제·회원·관리자 원장을
          변경하지 않습니다. 완료 상태는 가상 기록 예시이며 버튼으로 실제
          승인·환불하지 않습니다.
        </p>
        <label className="mt-4 block text-xs">
          가상 상태
          <select
            className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
            value={scenario}
            onChange={(event) => setScenario(event.target.value)}
          >
            {PAYMENT_SCENARIOS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" onClick={()=>{saveMemberPayment("current-member",makePaymentFixture(scenario));setLinked(true);}}>선택한 가상 결제 기록을 내 정보에 연결</Button>
        {linked && <p className="text-xs text-primary">가상 기록만 연결했습니다. 실제 거래·PG·개인정보는 생성하지 않았습니다.</p>}
      </DemoDock>
      <PaymentFlow
        key={scenario}
        initial={makePaymentFixture(scenario)}
        kind={
          ["ready", "waiting", "intro-unopened", "intro-opened", "waiting30"].includes(scenario) ? "introduction" : "exchange"
        }
      />
      <Link
        to="/today"
        className="inline-flex text-sm text-primary underline underline-offset-4"
      >
        회원 오늘으로 돌아가기
      </Link>
    </section>
  )
}
