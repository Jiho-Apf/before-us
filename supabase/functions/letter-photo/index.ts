// 편지 사진 주소 만들기: 볼 수 있는 사진만, 5분짜리 주소로 서버가 직접 만든다(partner-photo 와 같은 길).
// (저장소 정책은 쓴 사람만 직접 볼 수 있게 두고, 상대·운영진은 이 함수로만 연다. 회원 화면이 주소를 길게 만들지 못하게.)
//  - 회원: 요청한 회원의 로그인 토큰으로 can_view_letter_photo 를 불러 확인한다(쓴 사람 · 그날 편지가 함께 열린 뒤의 상대).
//  - 운영진: 신고가 들어온 교류의 사진만. admin_can_view_letter_photo 가 역할·2단계 인증·신고 여부를 확인하고 감사 기록을 남긴다.
import { createClient } from "npm:@supabase/supabase-js@2.49.4"

const PUBLISHABLE_KEY = "sb_publishable_vJTN2b31pClzNM-uKNWPVQ_Aw4278cg"
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors })
// {교류 id}/{쓴 사람 id}/day{n}-{임의값}.jpg
const PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/day[1-3]-[A-Za-z0-9_-]{4,40}\.jpg$/

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  const authorization = req.headers.get("Authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return reply({ error: "로그인이 필요해요." }, 401)
  const { path, reason } = await req.json().catch(() => ({ path: null, reason: null }))
  if (typeof path !== "string" || !PATH.test(path)) return reply({ error: "사진을 찾을 수 없어요." }, 400)
  const url = Deno.env.get("SUPABASE_URL")!
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? PUBLISHABLE_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: allowed, error } = await asCaller.rpc("can_view_letter_photo", { p_name: path })
  let ok = !error && allowed === true
  if (!ok) {
    const { data: admin, error: adminError } = await asCaller.rpc("admin_can_view_letter_photo", { p_path: path, p_reason: typeof reason === "string" ? reason.slice(0, 200) : null })
    ok = !adminError && admin === true
  }
  if (!ok) return reply({ error: "지금은 볼 수 없는 사진이에요." }, 403)
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  const { data, error: signError } = await service.storage.from("letter-photos").createSignedUrl(path, 300)
  if (signError || !data?.signedUrl) return reply({ error: "사진을 불러오지 못했어요." }, 500)
  return reply({ url: data.signedUrl })
})
