import { decodePhoto, encodePhoto } from "./applications"
import { friendlyError, supabase } from "./client"

// A 편지 사진 한 장(선택). 신청서 사진과 같은 길: HEIC는 JPG로 바꾸고, 이 기기에서 다시 그려 촬영 위치 같은 정보를 지운 뒤 올린다.
// 비공개 저장소 letter-photos · 경로 {교류 id}/{내 id}/day{n}-{임의값}.jpg.
// 상대는 그날 편지가 함께 열린 뒤에만 볼 수 있다(저장소 정책 can_view_letter_photo). 주소는 5분짜리로만 만든다.
export const LETTER_PHOTO_BUCKET = "letter-photos"
const MAX_SIDE = 1600

// 고른 사진을 편지에 맞게 다시 그린다(자르지 않고 긴 변만 1600px 안으로).
export async function prepareLetterPhoto(file: File): Promise<{ blob: Blob; width: number; height: number } | { error: string }> {
  const decoded = await decodePhoto(file)
  if ("error" in decoded) return decoded
  const { bitmap } = decoded
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale)
  const canvas = document.createElement("canvas")
  canvas.width = width; canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) { bitmap.close(); return { error: "이 브라우저에서는 사진을 처리할 수 없어요." } }
  context.fillStyle = "#fff"; context.fillRect(0, 0, width, height)
  context.imageSmoothingQuality = "high"
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const encoded = await encodePhoto(canvas)
  return "error" in encoded ? encoded : { blob: encoded.blob, width: encoded.width, height: encoded.height }
}

export async function uploadLetterPhoto(programId: string, day: number, file: File): Promise<{ path: string; blob: Blob } | { error: string }> {
  const prepared = await prepareLetterPhoto(file)
  if ("error" in prepared) return prepared
  try {
    const db = await supabase()
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return { error: "로그인이 필요해요." }
    const path = `${programId}/${auth.user.id}/day${day}-${crypto.randomUUID().slice(0, 8)}.jpg`
    const { error } = await db.storage.from(LETTER_PHOTO_BUCKET).upload(path, prepared.blob, { contentType: "image/jpeg", upsert: false })
    if (error) return { error: friendlyError(error, "사진을 올리지 못했어요. 하루에 12장까지 올릴 수 있어요. 잠시 뒤 다시 시도해 주세요.") }
    return { path, blob: prepared.blob }
  } catch (error) {
    return { error: friendlyError(error as Error) }
  }
}

// 보내기 전에 뺀 사진은 바로 지운다(실패해도 보내지 않은 사진은 이틀 뒤 정리된다).
export async function removeLetterPhoto(path: string) {
  try { const db = await supabase(); await db.storage.from(LETTER_PHOTO_BUCKET).remove([path]) } catch { /* 정리 작업이 지운다 */ }
}

const urlCache = new Map<string, { url: string; until: number }>()
export async function letterPhotoUrl(path: string) {
  const cached = urlCache.get(path)
  if (cached && cached.until > Date.now()) return cached.url
  try {
    const db = await supabase()
    const { data } = await db.storage.from(LETTER_PHOTO_BUCKET).createSignedUrl(path, 300)
    if (!data?.signedUrl) return null
    urlCache.set(path, { url: data.signedUrl, until: Date.now() + 240000 })
    return data.signedUrl
  } catch {
    return null
  }
}
