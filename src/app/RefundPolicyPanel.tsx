import { kstDateTime } from "./dates"
import { Button } from "./components/ui/button";
import { useState } from "react";
import { REFUND_POLICY, refundDeadlines, refundQuote, waitingRefundAvailable, type RefundReason } from "./refund-policy";
import { continueWaiting, requestPaymentCancellation, type PaymentSession } from "./payment-model";

export function RefundPolicyPanel({ session, kind, now = new Date(), onChange }: {
  session: PaymentSession; kind: "introduction" | "exchange"; now?: Date;
  onChange?: (session: PaymentSession) => void;
}) {
  const ops = session.refundOperations, quote = refundQuote(session, kind, now), deadlines = refundDeadlines(session);
  const [message, setMessage] = useState("");
  const buttonClass = "h-auto min-h-10 max-w-full whitespace-normal text-left";
  const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;
  const time = (at: string) => kstDateTime(at);
  const request = (reason: RefundReason) => {
    const result = requestPaymentCancellation(session, kind, now, reason);
    setMessage(result.error || "가상 정책 산정·요청만 기록해요. 귀책 확인·실제 환불 처리는 별도예요.");
    if (!result.error) onChange?.(result.session);
  };
  return (
    <div className="space-y-4 rounded-xl bg-secondary p-5 text-xs leading-7">
      <div className="font-semibold">결제 전 환불·제공 개시 기준 · {ops?.policy.version || "기존 구매 정책 확인 필요"}</div>
      {!ops ? <p>이 거래에는 새 환불 정책의 구매 시점 기록이 없어요. 과거 거래에 자동 소급하지 않으며 기존 고지·법정 권리를 개별 확인해요.</p> : <>
        {kind === "introduction" ? <>
          <p>첫 소개가 실제 준비된 뒤에만 5,000원을 결제해요. 결제 후 ‘첫 소개 확인하기’로 첫 상대 프로필을 실제 열람하기 전 취소하면 전액 환불이에요. 클릭만이 아니라 공개 허용 프로필이 실제 표시된 시각이 제공 개시예요.</p>
          <p>제공 개시 후에는 이미 제공된 소개 서비스분으로 처리하되, 서비스 오류·필수조건 위반 소개 등 운영 측 귀책에는 전액 환불해요. 귀책 확인·처리와 환불 완료는 별도예요.</p>
          <p>활성 상태에서 연속 {ops.policy.waitingDays}일 유효한 새 소개가 없으면 계속 이용 또는 5,000원 전액 환불 종료를 본인이 선택해요. 일시정지는 연속 활성 대기로 계산하지 않으며 자동 종료하지 않아요.</p>
          <p>첫 프로필 제공 개시: {ops.introductionOpenedAt ? time(ops.introductionOpenedAt) : "실제 열람 기록 없음"}</p>
        </> : <>
          <p>교류비 24,000원은 DAY별 8,000원씩 3일의 가분적 서비스예요. DAY 시작은 해당 날짜 콘텐츠가 실제 이용 가능한 상태로 열린 시각이며, 계획한 날짜 도래·결제·합의만으로 제공 개시를 기록하지 않아요.</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {["DAY01 시작 전", "24,000원", "DAY01 후 · DAY02 전", "16,000원", "DAY02 후 · DAY03 전", "8,000원", "DAY03 시작 후", "미제공 DAY 환불 없음"].map((text, index) => <div key={index}>{text}</div>)}
          </div>
          <p>상호 선택 후 기본 결제 기한 {ops.policy.paymentHours}시간. 한쪽만 결제하고 상대가 미결제면 결제자의 24,000원 전액 환불과 소개 권리 복원 대상이에요.</p>
          <p>양쪽 결제 뒤 A/B·시작일 합의 기본 기한 {ops.policy.agreementHours}시간. 양쪽 동의 시 {ops.policy.extensionHours}시간 한 번 연장할 수 있어요. 끝내 실제 교류가 시작되지 않으면 전액 환불하고 소개 권리를 유지해요.</p>
          {deadlines.paymentAt && <p>기본 결제 기한: {time(deadlines.paymentAt)}</p>}
          {deadlines.agreementAt && <p>합의 기한: {time(deadlines.agreementAt)} · {ops.extension.used ? "양쪽 동의로 1회 연장됨" : "연장 미사용"}</p>}
          <div className="space-y-1">{ops.dayOpened.map((event, index) => <p key={index}>DAY0{index + 1} 제공 개시: {event ? time(event.at) : "실제 이용 가능 개시 기록 없음"}</p>)}</div>
        </>}
        {session[kind]?.confirmedAt && <p>현재 정책 계산액: {quote.amount === null ? "개별 확인 필요" : money(quote.amount)} · {quote.reason}</p>}
        {session[kind]?.refundRequest && <p className="font-semibold text-primary">환불 요청 · 처리 전: {session[kind]!.refundRequest!.amount === null ? "개별 확인 필요" : money(session[kind]!.refundRequest!.amount!)} · {session[kind]!.refundRequest!.reason} · 환불 완료 아님</p>}
        {onChange && session[kind]?.status === "confirmed" && <div className="flex flex-wrap gap-2">
          {kind === "introduction" && <>
            {!ops.introductionOpenedAt && <Button className={buttonClass} variant="outline" size="sm" onClick={() => request("cancel")}>첫 열람 전 · 전액 환불 취소 요청</Button>}
            <Button className={buttonClass} variant="outline" size="sm" onClick={() => request("operator-fault")}>운영 측 귀책 전액 환불 검토 요청</Button>
            {waitingRefundAvailable(session, now) && <>
              <Button className={buttonClass} variant="outline" size="sm" onClick={() => { const result = continueWaiting(session, now); if (!result.error) onChange(result.session); }}>30일 대기 · 계속 이용</Button>
              <Button className={buttonClass} variant="outline" size="sm" onClick={() => request("waiting-30")}>30일 대기 · 전액 환불 종료 요청</Button>
            </>}
          </>}
          {kind === "exchange" && <>
            {refundQuote(session, kind, now, "partner-unpaid").amount !== null && <Button className={buttonClass} variant="outline" size="sm" onClick={() => request("partner-unpaid")}>상대 미결제 · 전액 환불/권리 복원 요청</Button>}
            {refundQuote(session, kind, now, "agreement-timeout").amount !== null && <Button className={buttonClass} variant="outline" size="sm" onClick={() => request("agreement-timeout")}>합의 기한 초과 · 미시작 전액 환불 요청</Button>}
          </>}
        </div>}
      </>}
      <p className="text-muted-foreground">위 운영 기준은 법정 청약철회 권리와 실제 약관 검토에 따른 더 유리한 권리를 제한하지 않아요. 개별 귀책·제공 이력·결제 원장을 확인하며 요청·산정·검토·실제 환불 완료는 구분해요. 실제 PG 환불과 자동 예약 작업은 미연결이에요.</p>
      {message && <p role="status" className="text-primary">{message}</p>}
      <p className="text-muted-foreground">현재 신규 가상 적용 정책: {REFUND_POLICY.version}. 실제 약관의 법률 검토 완료를 의미하지 않아요. 교류 중단·노쇼·재이용은 V6-conduct-01 기준을 따라요.</p>
    </div>
  );
}
