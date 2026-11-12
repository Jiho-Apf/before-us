// 상대 사진 주소 만들기: 열람 기간 안의 상대 사진만, 5분짜리 주소로 서버가 직접 만든다.
// (회원 화면이 사진 주소를 직접 만들면 유효 기간을 마음대로 길게 정할 수 있어서, 저장소 정책에서 상대 열람을 빼고 이 함수로만 연다.)
// 열람 권한은 요청한 회원의 로그인 토큰으로 can_view_partner_photo 를 불러 확인한다.
// 주소를 주기 전에 파일 바이트를 확인한다(R3-18 · _shared/photo-check.ts): 진짜 JPG인지 · 위치 정보(EXIF·XMP GPS)가 없는지.
// 구조 검사(틀·크기·끝 표시)에 더해, 등록 때 적힌 지문(sha256)·가로세로와 지금 파일이 같은지도 본다(R4-08). 화소 디코딩은 하지 않는다.
// 화면을 거치지 않고 올린 파일이 걸리면 주소를 주지 않고 운영진 작업 기록(photo-check)에 남긴다.
import { createClient } from "npm:@supabase/supabase-js@2.49.4"
import { checkJpeg, sameAsRegistered, type PhotoCheck } from "../_shared/photo-check.ts"

const PUBLISHABLE_KEY = "sb_publishable_vJTN2b31pClzNM-uKNWPVQ_Aw4278cg"
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors })

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  const authorization = req.headers.get("Authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return reply({ error: "로그인이 필요해요." }, 401)
  const { path } = await req.json().catch(() => ({ path: null }))
  if (typeof path !== "string" || !/^[0-9a-f-]{36}\/[\w.-]{1,80}$/.test(path)) return reply({ error: "사진을 찾을 수 없어요." }, 400)
  const url = Deno.env.get("SUPABASE_URL")!
  const asMember = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? PUBLISHABLE_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: allowed, error } = await asMember.rpc("can_view_partner_photo", { p_path: path })
  if (error || allowed !== true) return reply({ error: "지금은 볼 수 없는 사진이에요." }, 403)
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  const { data: file, error: readError } = await service.storage.from("application-photos").download(path)
  if (readError || !file) return reply({ error: "사진을 불러오지 못했어요." }, 500)
  const bytes = new Uint8Array(await file.arrayBuffer())
  let checked: PhotoCheck = checkJpeg(bytes)
  // 등록 때 값(운영진이 눈으로 확인한 파일의 지문·크기)과 지금 파일이 같은지(R4-08). 사진을 교체해 등록 줄이 이미 바뀐 옛 경로는
  // 대조할 값이 없으므로 구조 검사까지만 한다(소개 사본이 쓰는 동안 파일은 보존된다).
  if (checked.ok) {
    const { data: rows, error: rowError } = await service.from("application_photos").select("sha256, width, height").eq("path", path)
    if (rowError) return reply({ error: "사진을 불러오지 못했어요." }, 500)
    const registered = rows?.[0]
    if (registered) checked = await sameAsRegistered(bytes, checked, registered)
  }
  if (!checked.ok) {
    await service.rpc("flag_photo_content", { p_bucket: "application-photos", p_path: path, p_reason: checked.reason })
    return reply({ error: "지금은 볼 수 없는 사진이에요. 운영진이 확인하고 있어요." }, 403)
  }
  const { data, error: signError } = await service.storage.from("application-photos").createSignedUrl(path, 300)
  if (signError || !data?.signedUrl) return reply({ error: "사진을 불러오지 못했어요." }, 500)
  return reply({ url: data.signedUrl })
})
