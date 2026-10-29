// 결제 승인. 결제 성공 화면(/payments/success)이 { paymentKey, orderId, amount } 를 회원 로그인 토큰과 함께 보낸다.
//  1) 회원 토큰으로 my_payment_order 를 불러 내 주문인지, 받은 금액이 서버에 저장된 주문 금액과 같은지, 중복·자격을 확인한다.
//     여기서 멈추면 승인 API를 부르지 않으므로 돈이 나가지 않는다(토스는 승인하지 않은 결제를 청구하지 않고, 10분 뒤 세션이 끝난다).
//  2) 토스 결제 승인 API(_shared/toss.ts · POST https://api.tosspayments.com/v1/payments/confirm)를 부른다.
//  3) 결과는 service_role 로 record_payment_result 에 남긴다. 이미 결제된 주문이면 토스를 다시 부르지 않고 그대로 성공을 돌려준다.
// 비밀 값: TOSS_SECRET_KEY(없고 테스트 모드면 토스 문서 테스트 키를 쓴다 · _shared/toss.ts 설명). 키는 어디에도 기록하지 않는다.
import { createClient } from "npm:@supabase/supabase-js@2.49.4"
import { cancelPayment, confirmPayment, isDone, secretKeyFor, trimPayment } from "../_shared/toss.ts"

const PUBLISHABLE_KEY = "sb_publishable_vJTN2b31pClzNM-uKNWPVQ_Aw4278cg"
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors })
// 서버 함수가 보낸 한국어 안내는 그대로, 그 밖의 오류는 정해 둔 문장으로
const korean = (message: string | undefined, fallback: string) => (message && /[가-힣]/.test(message) ? message.replace(/^.*?ERROR:\s*/, "") : fallback)

type Order = { orderId: string; amount: number; status: string; mode: string; paymentKey: string | null; duplicate: boolean; eligible: boolean }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return reply({ error: "잘못된 요청이에요." }, 405)
  const authorization = req.headers.get("Authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return reply({ error: "로그인이 필요해요." }, 401)
  const body = await req.json().catch(() => null)
  const paymentKey = typeof body?.paymentKey === "string" ? body.paymentKey.trim() : ""
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : ""
  const amount = Number(body?.amount)
  if (!paymentKey || paymentKey.length > 200 || !/^[A-Za-z0-9_=-]{6,64}$/.test(orderId) || !Number.isInteger(amount) || amount <= 0) {
    return reply({ error: "결제 정보가 올바르지 않아요." }, 400)
  }

  const url = Deno.env.get("SUPABASE_URL")!
  const asMember = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? PUBLISHABLE_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data, error } = await asMember.rpc("my_payment_order", { p_order_id: orderId })
  const order = data as Order | null
  if (error || !order) return reply({ error: korean(error?.message, "주문을 찾을 수 없어요.") }, 404)

  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  const record = (args: Record<string, unknown>) => service.rpc("record_payment_result", { p_order_id: orderId, ...args })

  // 이미 끝난 주문: 같은 결제면 성공 그대로(새로 고침·다시 확인), 다르면 멈춘다.
  if (order.status === "paid") return order.paymentKey === paymentKey ? reply({ ok: true, payment: order }) : reply({ error: "이미 다른 결제로 끝난 주문이에요." }, 409)
  if (order.status === "cancelled") return reply({ error: "취소된 주문이에요." }, 409)
  if (order.amount !== amount) {
    await record({ p_status: "failed", p_code: "AMOUNT_MISMATCH", p_message: "결제 금액이 주문 금액과 달라 승인하지 않았어요." })
    return reply({ error: "결제 금액이 주문 금액과 달라 승인하지 않았어요. 돈은 나가지 않았어요." }, 400)
  }
  if (order.duplicate) return reply({ error: "이미 결제한 항목이에요. 이번 결제는 승인하지 않아서 돈이 나가지 않았어요." }, 409)
  if (!order.eligible) return reply({ error: "지금은 이 결제를 진행할 수 없어요(신청 상태나 교류 단계가 바뀌었어요). 승인하지 않아서 돈이 나가지 않았어요." }, 409)
  const key = secretKeyFor(order.mode)
  if (!key) return reply({ error: "결제 설정이 아직 끝나지 않았어요. 운영진에게 알려 주세요. 돈은 나가지 않았어요." }, 503)

  const result = await confirmPayment(key, paymentKey, orderId, amount)
  if (!result.ok) {
    await record({ p_status: "failed", p_payment_key: paymentKey, p_code: result.code, p_message: result.message })
    return reply({ error: korean(result.message, "결제를 승인하지 못했어요."), code: result.code }, result.status >= 500 ? 502 : 400)
  }
  const payment = result.payment
  // 승인 응답이 주문과 다르거나 아직 끝나지 않은 결제(예: 가상계좌 입금 대기)는 바로 취소하고 실패로 남긴다.
  if (!isDone(payment) || payment.orderId !== orderId || Number(payment.totalAmount) !== order.amount) {
    await cancelPayment(key, paymentKey, orderId, "주문과 맞지 않거나 받지 않는 결제수단이라 자동 취소")
    await record({ p_status: "failed", p_payment_key: paymentKey, p_code: `NOT_ACCEPTED_${String(payment.status ?? "UNKNOWN")}`, p_message: "카드·간편결제만 받아요. 이번 결제는 바로 취소했어요.", p_raw: { confirm: trimPayment(payment) } })
    return reply({ error: "카드나 간편결제로 다시 시도해 주세요. 이번 결제는 바로 취소했어요." }, 409)
  }
  const saved = await record({ p_status: "paid", p_payment_key: paymentKey, p_method: payment.method ?? null, p_at: payment.approvedAt ?? null, p_raw: { confirm: trimPayment(payment) } })
  if (saved.error) {
    if (/중복 결제/.test(saved.error.message)) {
      // 두 창에서 거의 같은 때 결제한 경우: 나중 결제는 바로 취소한다.
      const cancelled = await cancelPayment(key, paymentKey, orderId, "중복 결제 자동 취소")
      if (cancelled.ok) await record({ p_status: "cancelled", p_payment_key: paymentKey, p_message: "중복 결제 자동 취소", p_raw: { cancel: trimPayment(cancelled.payment) } })
      return reply({ error: "이미 결제한 항목이라 이번 결제는 바로 취소했어요." }, 409)
    }
    // 승인은 됐는데 기록을 못 한 경우: 같은 요청을 다시 보내면 멱등키 덕분에 같은 승인 결과로 다시 기록된다.
    return reply({ error: "결제는 승인됐지만 기록하지 못했어요. 잠시 뒤 ‘다시 확인하기’를 눌러 주세요." }, 500)
  }
  return reply({ ok: true, payment: saved.data })
})
