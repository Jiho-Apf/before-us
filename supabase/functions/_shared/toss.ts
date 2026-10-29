// 토스페이먼츠에 맞춘 부분만 모은 곳. 다른 PG(예: 포트원)로 바꿀 때는 이 파일과 src/app/backend/payments.ts 만 바꾸고,
// payments 표·서버 함수(record_payment_result 등)와 화면은 그대로 둔다. (밑줄로 시작하는 폴더라 함수로 따로 배포되지 않는다.)
// 참고한 문서(2026-10-29 확인):
//  - 결제 승인 POST /v1/payments/confirm · 결제 취소 POST /v1/payments/{paymentKey}/cancel(cancelReason 최대 200자, cancelAmount 를 빼면 전액 취소)
//    https://docs.tosspayments.com/reference · https://docs.tosspayments.com/guides/v2/cancel-payment
//  - 인증: Authorization: Basic base64("{시크릿 키}:") — 콜론을 빠뜨리지 않는다 · 멱등키 헤더 Idempotency-Key(최대 300자, 15일 유효)
//    https://docs.tosspayments.com/reference/using-api/authorization
//  - 테스트 환경: 테스트 키로 승인돼도 실제 결제수단에서 돈이 나가지 않는다 https://docs.tosspayments.com/guides/v2/get-started/environment
//  - 키 종류: 결제위젯(주문서형) 연동 키는 test_gck/test_gsk(라이브는 live_gck/live_gsk) https://docs.tosspayments.com/reference/using-api/api-keys
const API = "https://api.tosspayments.com/v1/payments"

// 토스가 문서와 공식 예제(github.com/tosspayments/tosspayments-sample · express-javascript/server.js)에 공개한
// 결제위젯 ‘문서 테스트 시크릿 키’. 누구나 쓰는 공개 테스트 키라 비밀이 아니고, 이 키로는 실제 돈이 오가지 않는다. 라이브 키가 절대 아니다.
// 테스트 모드인데 TOSS_SECRET_KEY 비밀 값이 없을 때만 쓴다.
// 정식 운영(라이브) 키는 대표가 Supabase 대시보드 → Edge Functions → Secrets 에 TOSS_SECRET_KEY 로 직접 넣는다(채팅·코드에 붙이지 않는다).
// 화면의 클라이언트 키(VITE_TOSS_CLIENT_KEY)와 같은 상점의 짝이어야 승인된다.
const DOCS_TEST_SECRET_KEY = "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6"

// 주문의 모드(서버 payment_config 가 정한 값)에 맞는 시크릿 키. 모드와 키 종류가 어긋나면 null(승인하지 않는다).
export function secretKeyFor(mode: string): string | null {
  const key = Deno.env.get("TOSS_SECRET_KEY")?.trim()
  if (mode === "test") {
    if (!key) return DOCS_TEST_SECRET_KEY
    return key.startsWith("test_") ? key : null // 테스트 주문을 라이브 키로 승인하지 않는다
  }
  if (mode === "live") return key && key.startsWith("live_") ? key : null
  return null
}

export type TossPayment = Record<string, unknown> & {
  orderId?: string
  status?: string
  method?: string
  totalAmount?: number
  approvedAt?: string
  cancels?: { canceledAt?: string }[] | null
}
export type TossResult = { ok: true; payment: TossPayment } | { ok: false; status: number; code: string; message: string }

async function post(path: string, key: string, body: unknown, idempotencyKey: string): Promise<TossResult> {
  try {
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${key}:`)}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (response.ok) return { ok: true, payment: data as TossPayment }
    return { ok: false, status: response.status, code: String(data?.code ?? "UNKNOWN"), message: String(data?.message ?? "결제사 응답을 읽지 못했어요.") }
  } catch {
    return { ok: false, status: 502, code: "NETWORK", message: "결제사에 연결하지 못했어요." }
  }
}

// 같은 주문을 다시 승인·취소 요청해도 한 번만 처리되도록 주문 번호로 멱등키를 만든다.
export const confirmPayment = (key: string, paymentKey: string, orderId: string, amount: number) =>
  post("/confirm", key, { paymentKey, orderId, amount }, `confirm-${orderId}`)
export const cancelPayment = (key: string, paymentKey: string, orderId: string, reason: string) =>
  post(`/${encodeURIComponent(paymentKey)}/cancel`, key, { cancelReason: reason.slice(0, 200) }, `cancel-${orderId}`)

// 승인이 끝난 상태(가상계좌 입금 대기 같은 다른 상태는 아직 받지 않는다)
export const isDone = (payment: TossPayment) => payment.status === "DONE"

// 기록에 남길 값만 고른다. 카드 번호(가린 값 포함)·승인 번호·고객 정보는 남기지 않는다.
export function trimPayment(payment: TossPayment) {
  const card = payment.card as Record<string, unknown> | null | undefined
  const easyPay = payment.easyPay as Record<string, unknown> | null | undefined
  const receipt = payment.receipt as Record<string, unknown> | null | undefined
  return {
    status: payment.status ?? null,
    method: payment.method ?? null,
    totalAmount: payment.totalAmount ?? null,
    balanceAmount: payment.balanceAmount ?? null,
    currency: payment.currency ?? null,
    requestedAt: payment.requestedAt ?? null,
    approvedAt: payment.approvedAt ?? null,
    card: card ? { issuerCode: card.issuerCode ?? null, cardType: card.cardType ?? null, ownerType: card.ownerType ?? null } : null,
    easyPay: easyPay ? { provider: easyPay.provider ?? null } : null,
    receiptUrl: receipt?.url ?? null,
    cancels: Array.isArray(payment.cancels) ? payment.cancels.map((item) => {
      const cancel = item as Record<string, unknown>
      return { cancelAmount: cancel.cancelAmount ?? null, canceledAt: cancel.canceledAt ?? null, cancelStatus: cancel.cancelStatus ?? null }
    }) : null,
  }
}

export const lastCanceledAt = (payment: TossPayment) => (Array.isArray(payment.cancels) && payment.cancels.length ? payment.cancels[payment.cancels.length - 1]?.canceledAt ?? null : null)
