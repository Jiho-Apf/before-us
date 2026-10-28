// 운영진 매칭 참고: 두 회원의 신청서 항목을 읽고 궁합 점수·이유·주의할 점·소개 이유 초안을 돌려준다.
// 운영진(대표·운영 + 2단계 인증)만 쓸 수 있다 — 권한은 요청한 운영진의 로그인 토큰으로 admin_match_profiles 를 불러 확인한다.
// 이름·연락처·생년월일·사진은 넘기지 않는다. 결과는 운영진 참고용이며 회원에게 보이지 않는다.
// ANTHROPIC_API_KEY 비밀값이 없으면 { error: "not-configured" } 를 돌려준다(화면은 규칙 기반 점수만 보여 준다).
import { createClient } from "npm:@supabase/supabase-js@2.49.4"
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0"

const PUBLISHABLE_KEY = "sb_publishable_vJTN2b31pClzNM-uKNWPVQ_Aw4278cg"
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const SYSTEM = `당신은 한 번에 한 사람만 소개하는 1:1 소개팅 서비스의 운영진을 돕는 매칭 검토 보조예요.
두 회원(A, B)의 신청서 항목만 근거로, 서로 잘 맞을 가능성을 0~100점으로 평가하고 이유를 정리해요.
- 근거는 주어진 항목에서만 찾아요. 없는 정보를 지어내거나 외모·성격을 추측하지 않아요.
- 외모 평가, 학력·소득·직업의 우열, 출신에 대한 판단은 하지 않아요.
- preferences 안의 꼭 지킬 조건(required/must 성격의 값)과 어긋나면 점수를 크게 낮추고 cautions에 분명히 적어요.
- reasons와 cautions는 각각 2~4개, 한 줄씩, 짧은 한국어 해요체로 써요.
- summary는 운영진이 한눈에 볼 한 문장이에요.
- note는 두 회원에게 함께 보일 '소개 이유' 초안 1~2문장이에요. 두 사람의 shared 목록에 있는 항목만 쓰고, 점수·비교·조건 이야기는 넣지 않아요. 따뜻하고 담백한 해요체로 써요.`

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "summary", "reasons", "cautions", "note"],
  properties: {
    score: { type: "integer" },
    summary: { type: "string" },
    reasons: { type: "array", items: { type: "string" } },
    cautions: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  const authorization = req.headers.get("Authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return reply({ error: "로그인이 필요해요." }, 401)
  const { a, b } = await req.json().catch(() => ({ a: null, b: null }))
  if (typeof a !== "string" || typeof b !== "string" || !UUID.test(a) || !UUID.test(b) || a === b) return reply({ error: "두 회원을 골라 주세요." }, 400)
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")
  if (!apiKey) return reply({ error: "not-configured" })

  const asAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY") ?? PUBLISHABLE_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: profiles, error } = await asAdmin.rpc("admin_match_profiles", { p_a: a, p_b: b })
  if (error || !profiles) return reply({ error: error?.message ?? "두 분의 신청서를 불러오지 못했어요." }, 403)

  const client = new Anthropic({ apiKey })
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `두 회원의 신청서 항목이에요.\n\n${JSON.stringify(profiles)}` }],
    })
    if (response.stop_reason === "refusal") return reply({ error: "이 두 분은 분석하지 못했어요. 직접 살펴봐 주세요." })
    const text = response.content.find((block) => block.type === "text")
    if (!text || text.type !== "text") return reply({ error: "분석 결과를 읽지 못했어요." }, 502)
    const result = JSON.parse(text.text)
    return reply({ ...result, score: Math.max(0, Math.min(100, Math.round(Number(result.score) || 0))) })
  } catch (failure) {
    if (failure instanceof Anthropic.RateLimitError) return reply({ error: "지금 분석 요청이 많아요. 잠시 뒤 다시 눌러 주세요." }, 429)
    if (failure instanceof Anthropic.AuthenticationError) return reply({ error: "AI 연결 설정을 확인해 주세요." }, 500)
    if (failure instanceof Anthropic.APIError) return reply({ error: `분석에 실패했어요(${failure.status}).` }, 502)
    return reply({ error: "분석에 실패했어요." }, 500)
  }
})
