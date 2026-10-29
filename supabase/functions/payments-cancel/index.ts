// 테스트 결제 취소(운영진 결제 화면 · 대표·운영 + 2단계 인증). 운영진 화면이 { paymentId, reason } 을 운영진 로그인 토큰과 함께 보낸다.
//  1) 운영진 토큰으로 admin_begin_payment_cancel 을 불러 권한(역할 + aal2)·테스트 결제·결제 완료 상태를 확인하고 감사 기록을 남긴다.
//  2) 토스 결제 취소 API(_shared/toss.ts · POST /v1/payments/{paymentKey}/cancel · cancelAmount 없이 = 전액 취소)를 부른다.
//  3) 결과는 service_role 로 record_payment_result 에 남긴다. 결제사에서 이미 취소된 결제면 기록만 맞춘다.
import { createClient } from "npm:@supabase/supabase-js@2.49.4"
import { cancelPayment, lastCanceledAt, secretKeyFor, trimPayment } from "../_shared/toss.ts"

const PUBLISHABLE_KEY = "sb_publishable_vJTN2b31pClzNM-uKNWPVQ_Aw4278cg"
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors })
const korean = (message: string | undefined, fallback: string) => (message && /[가-힣]/.test(message) ? message.replace(/^.*?ERROR:\s*/, "") : fallback)

type Target = { orderId: string; paymentKey: string; amount: number; mode: string; reason: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return reply({ error: "잘못된 요청이에요." }, 405)
  const authorization = req.headers.get("Authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return reply({ error: "로그인이 필요해요." }, 401)
  const body = await req.json().catch(() => null)
  const paymentId = typeof body?.paymentId === "string" ? body.paymentId : ""
  const reason = typeof body?.reason === "string" ? body.reason.trim() : ""
  if (!/^[0-9a-f-]{36}$/.test(paymentId)) return reply({ error: "결제를 찾을 수 없어요." }, 400)
  if (!reason) return reply({ error: "취소하는 이유를 적어 주세요." }, 400)

  const url = Deno.env.get("SUPABASE_URL")!
  const asAdmin = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? PUBLISHABLE_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data, error } = await asAdmin.rpc("admin_begin_payment_cancel", { p_payment: paymentId, p_reason: reason })
  const target = data as Target | null
  if (error || !target) return reply({ error: korean(error?.message, "취소할 수 없는 결제예요.") }, 403)
  const key = secretKeyFor(target.mode)
  if (!key) return reply({ error: "결제 설정(TOSS_SECRET_KEY)이 모드와 맞지 않아 취소하지 못했어요." }, 503)

  const result = await cancelPayment(key, target.paymentKey, target.orderId, target.reason)
  if (!result.ok && result.code !== "ALREADY_CANCELED_PAYMENT") {
    return reply({ error: `결제사에서 취소하지 못했어요. ${korean(result.message, "")}`.trim(), code: result.code }, 502)
  }
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  const saved = await service.rpc("record_payment_result", {
    p_order_id: target.orderId, p_status: "cancelled", p_payment_key: target.paymentKey, p_message: target.reason,
    p_at: result.ok ? lastCanceledAt(result.payment) : null, p_raw: result.ok ? { cancel: trimPayment(result.payment) } : null,
  })
  if (saved.error) return reply({ error: "결제사에서는 취소됐지만 기록하지 못했어요. 한 번 더 눌러 주세요." }, 500)
  return reply({ ok: true, payment: saved.data })
})
