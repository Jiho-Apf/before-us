import { BEFORE_US } from "../config"
import { friendlyError, rpc, supabase } from "./client"

// 결제(테스트 모드부터). PG(토스페이먼츠)에 맞춘 부분은 이 파일과 edge function(payments-confirm · payments-cancel · _shared/toss.ts)에만 둔다.
// 화면(LivePayments · AdminPayments)은 아래 함수와 모양만 쓴다 → 다른 PG(예: 포트원)로 바꿀 때 화면과 서버 표·함수는 그대로 둔다.
// 금액은 서버(create_payment_order · payment_config)가 정한다. 화면은 받은 금액을 결제창에 넘기기만 한다.

export type PaymentKind = "introduction" | "exchange"
export type PaymentStatus = "ready" | "paid" | "failed" | "cancelled"
export type PaymentMode = "test" | "live"
// create_payment_order 가 돌려주는 주문
export type PaymentOrder = { orderId: string; amount: number; orderName: string; customerKey: string; kind: PaymentKind; programId: string | null; mode: PaymentMode; provider: string }
// 결제 한 건(서버 payment_json · 승인 함수 응답 · 운영진 목록이 같은 모양)
export type Payment = {
  id: string
  orderId: string
  kind: PaymentKind
  programId: string | null
  amount: number
  orderName: string
  status: PaymentStatus
  provider: string
  mode: PaymentMode
  method: string | null
  approvedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  failureCode: string | null
  failureMessage: string | null
  createdAt: string
}
export type AdminPayment = Payment & { memberId: string | null; email: string | null; name: string | null }

export const PAYMENT_MODE: PaymentMode = BEFORE_US.payments.mode
export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = { introduction: "소개비", exchange: "교류비" }
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = { ready: "결제 전", paid: "결제 완료", failed: "결제 안 됨", cancelled: "취소됨" }
export const won = (amount: number) => `${amount.toLocaleString("ko-KR")}원`

// ── 서버 자료
export const createPaymentOrder = (kind: PaymentKind, programId?: string | null) => rpc<PaymentOrder>("create_payment_order", { p_kind: kind, p_program: programId ?? null })
export const markPaymentFailed = (orderId: string, code: string, message: string) => rpc<null>("mark_payment_failed", { p_order_id: orderId, p_code: code, p_message: message })

const FIELDS = "id, order_id, kind, program_id, amount, order_name, status, provider, mode, method, approved_at, cancelled_at, cancel_reason, failure_code, failure_message, created_at"
type Row = { id: string; order_id: string; kind: PaymentKind; program_id: string | null; amount: number; order_name: string; status: PaymentStatus; provider: string; mode: PaymentMode; method: string | null; approved_at: string | null; cancelled_at: string | null; cancel_reason: string | null; failure_code: string | null; failure_message: string | null; created_at: string }
const fromRow = (row: Row): Payment => ({ id: row.id, orderId: row.order_id, kind: row.kind, programId: row.program_id, amount: row.amount, orderName: row.order_name, status: row.status, provider: row.provider, mode: row.mode, method: row.method, approvedAt: row.approved_at, cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason, failureCode: row.failure_code, failureMessage: row.failure_message, createdAt: row.created_at })

// 내 결제 내역(결제창을 열었다 닫기만 한 ‘결제 전’ 주문은 뺀다). 못 불러오면 null.
export async function loadMyPayments(): Promise<Payment[] | null> {
  try {
    const db = await supabase()
    const { data, error } = await db.from("payments").select(FIELDS).neq("status", "ready").order("created_at", { ascending: false }).limit(50)
    if (error) return null
    return ((data ?? []) as Row[]).map(fromRow)
  } catch {
    return null
  }
}

// 결제 화면에 보여 줄 항목: 소개비(신청서 승인 뒤) · 교류비(시작 전 교류가 있을 때). 결제는 베타 흐름에 아무 영향이 없다.
export type PaymentChoices = { approved: boolean; program: { id: string; status: "choosing" | "scheduled"; partnerName: string | null } | null }
export async function loadPaymentChoices(): Promise<PaymentChoices | null> {
  try {
    const db = await supabase()
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return null
    const [application, program] = await Promise.all([
      db.from("applications").select("status").eq("member_id", auth.user.id).maybeSingle(),
      db.rpc("my_program"),
    ])
    if (application.error) return null
    const current = (program.error ? null : program.data) as { id: string; status: string; partnerName?: string | null } | null
    return {
      approved: application.data?.status === "approved",
      program: current && (current.status === "choosing" || current.status === "scheduled") ? { id: current.id, status: current.status, partnerName: current.partnerName ?? null } : null,
    }
  } catch {
    return null
  }
}

// edge function 오류 응답({ error })의 한국어 안내를 꺼낸다.
async function functionError(error: unknown, fallback: string) {
  const context = (error as { context?: Response } | null)?.context
  const body = context && typeof context.json === "function" ? await context.json().catch(() => null) : null
  return typeof body?.error === "string" && body.error ? body.error : friendlyError(error as Error, fallback)
}

// 결제 승인(성공 화면에서 한 번). 같은 주문을 다시 보내도 서버가 한 번만 승인한다.
export async function confirmPayment(params: { paymentKey: string; orderId: string; amount: number }): Promise<{ data: Payment | null; error: string | null }> {
  try {
    const db = await supabase()
    const { data, error } = await db.functions.invoke<{ ok?: boolean; payment?: Payment; error?: string }>("payments-confirm", { body: params })
    if (error) return { data: null, error: await functionError(error, "결제를 확인하지 못했어요. 잠시 뒤 다시 확인해 주세요.") }
    if (!data?.ok || !data.payment) return { data: null, error: data?.error ?? "결제를 확인하지 못했어요." }
    return { data: data.payment, error: null }
  } catch (error) {
    return { data: null, error: friendlyError(error as Error) }
  }
}

// ── 운영진
export const adminListPayments = (status: PaymentStatus | null, mode: PaymentMode | null) => rpc<AdminPayment[]>("admin_list_payments", { p_status: status, p_mode: mode })
export async function adminCancelPayment(paymentId: string, reason: string): Promise<{ data: Payment | null; error: string | null }> {
  try {
    const db = await supabase()
    const { data, error } = await db.functions.invoke<{ ok?: boolean; payment?: Payment; error?: string }>("payments-cancel", { body: { paymentId, reason } })
    if (error) return { data: null, error: await functionError(error, "취소하지 못했어요. 잠시 뒤 다시 시도해 주세요.") }
    if (!data?.ok || !data.payment) return { data: null, error: data?.error ?? "취소하지 못했어요." }
    return { data: data.payment, error: null }
  } catch (error) {
    return { data: null, error: friendlyError(error as Error) }
  }
}

// ─────────────────────────────────────────────
// 토스페이먼츠 결제위젯(주문서형) v2 — 결제 화면에서 결제창을 열 때만 SDK를 불러온다.
// 참고(2026-10-29 확인): https://docs.tosspayments.com/sdk/v2/js/payment-widget · https://docs.tosspayments.com/guides/v2/payment-widget/integration
//  TossPayments(clientKey).widgets({ customerKey }) → setAmount({ currency: "KRW", value }) → renderPaymentMethods · renderAgreement
//  → requestPayment({ orderId, orderName, successUrl, failUrl }) · 성공 주소에 paymentKey·orderId·amount(·paymentType), 실패 주소에 code·message·orderId 가 붙는다.
//  한 화면에 결제 UI를 두 번 그릴 수 없어서 닫을 때 destroy() 한다.
const SDK_URL = "https://js.tosspayments.com/v2/standard"
type Destroyable = { destroy?: () => unknown }
type TossWidgets = {
  setAmount(amount: { currency: "KRW"; value: number }): Promise<void>
  renderPaymentMethods(options: { selector: string; variantKey?: string }): Promise<Destroyable>
  renderAgreement(options: { selector: string; variantKey?: string }): Promise<Destroyable & { on?: (event: "agreementStatusChange", callback: (status: { agreedRequiredTerms: boolean }) => void) => void }>
  requestPayment(request: { orderId: string; orderName: string; successUrl: string; failUrl: string }): Promise<unknown>
}
type TossFactory = (clientKey: string) => { widgets(options: { customerKey: string }): TossWidgets }
declare global { interface Window { TossPayments?: TossFactory } }

let sdk: Promise<TossFactory> | null = null
function loadSdk() {
  if (window.TossPayments) return Promise.resolve(window.TossPayments)
  return (sdk ??= new Promise<TossFactory>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = SDK_URL
    script.async = true
    script.onload = () => (window.TossPayments ? resolve(window.TossPayments) : reject(new Error("load")))
    script.onerror = () => { sdk = null; script.remove(); reject(new Error("load")) }
    document.head.appendChild(script)
  }))
}

export type Checkout = { pay: () => Promise<string | null>; destroy: () => void }
// 결제수단·약관을 targets 안에 그린다. pay()는 결제창으로 넘어가며, 넘어가지 못하면 안내 문장을 돌려준다.
export async function mountCheckout(order: PaymentOrder, targets: { methods: string; agreement: string }, onAgreement?: (agreed: boolean) => void): Promise<Checkout> {
  const clientKey = BEFORE_US.payments.clientKey
  // 테스트 주문에 라이브 키(또는 그 반대)를 쓰지 않는다.
  if (!clientKey.startsWith(order.mode === "test" ? "test_" : "live_")) throw new Error("결제 설정(클라이언트 키)이 결제 모드와 맞지 않아요. 운영진에게 알려 주세요.")
  let factory: TossFactory
  try { factory = await loadSdk() } catch { throw new Error("결제창을 불러오지 못했어요. 광고 차단 기능을 끄거나 잠시 뒤 다시 시도해 주세요.") }
  const widgets = factory(clientKey).widgets({ customerKey: order.customerKey })
  const parts: Destroyable[] = []
  try {
    await widgets.setAmount({ currency: "KRW", value: order.amount })
    const [methods, agreement] = await Promise.all([
      widgets.renderPaymentMethods({ selector: targets.methods, variantKey: "DEFAULT" }),
      widgets.renderAgreement({ selector: targets.agreement, variantKey: "AGREEMENT" }),
    ])
    parts.push(methods, agreement)
    agreement.on?.("agreementStatusChange", status => onAgreement?.(!!status.agreedRequiredTerms))
  } catch {
    parts.forEach(part => { try { void part.destroy?.() } catch { /* 이미 지워짐 */ } })
    throw new Error("결제수단을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.")
  }
  const origin = window.location.origin
  return {
    pay: async () => {
      try {
        await widgets.requestPayment({ orderId: order.orderId, orderName: order.orderName, successUrl: `${origin}/payments/success`, failUrl: `${origin}/payments/fail` })
        return null
      } catch (error) {
        const code = (error as { code?: string })?.code
        if (code === "USER_CANCEL" || code === "PAY_PROCESS_CANCELED") return "결제창을 닫았어요. 다시 시도하려면 결제하기를 눌러 주세요."
        const message = (error as { message?: string })?.message
        return message && /[가-힣]/.test(message) ? message : "결제창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요."
      }
    },
    destroy: () => { parts.forEach(part => { try { void part.destroy?.() } catch { /* 이미 지워짐 */ } }) },
  }
}

// 결제창에서 돌아온 주소 읽기(토스가 붙이는 이름)
export function readSuccessReturn(search: string) {
  const params = new URLSearchParams(search)
  const paymentKey = params.get("paymentKey") ?? ""
  const orderId = params.get("orderId") ?? ""
  const amount = Number(params.get("amount"))
  return paymentKey && orderId && Number.isInteger(amount) && amount > 0 ? { paymentKey, orderId, amount } : null
}
export function readFailReturn(search: string) {
  const params = new URLSearchParams(search)
  return { code: params.get("code") ?? "", message: params.get("message") ?? "", orderId: params.get("orderId") }
}
// 결제가 안 됐을 때 회원에게 보여 줄 문장(토스 오류 코드 → 쉬운 말). 모르는 코드는 결제사 안내를 그대로 쓴다.
export function failReason(code: string, message: string) {
  if (code === "PAY_PROCESS_CANCELED" || code === "USER_CANCEL") return "결제를 중간에 멈췄어요."
  if (code === "PAY_PROCESS_ABORTED") return "결제가 진행되지 않았어요."
  if (code === "REJECT_CARD_COMPANY") return "카드사에서 결제를 받지 않았어요. 다른 카드로 시도해 주세요."
  return message && /[가-힣]/.test(message) ? message : "결제가 끝나지 않았어요."
}
