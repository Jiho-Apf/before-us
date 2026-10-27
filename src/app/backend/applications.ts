import { emptyApplication, normalizeLegacyValues, type ApplicationDraft } from "../application-model"
import { emptyPhoto, emptyPhotos, PHOTO_SLOTS, type ApplicationPhotos, type PhotoReview, type PhotoSlotId } from "../photo-model"
import { BEFORE_US } from "../config"
import { storedSource } from "../acquisition"
import { PHOTO_BUCKET, friendlyError, rpc, supabase } from "./client"

// 실제 서버의 소개 신청서·사진.
export type ApplicationStatus = "draft" | "submitted" | "reviewing" | "needs_changes" | "approved" | "held" | "withdrawn" | "rejected"
export const EDITABLE: ApplicationStatus[] = ["draft", "needs_changes"]
// 제출한 뒤에도 ‘고치기’로 열 수 있는 상태(검토 중·승인·보류는 고치면 다시 확인 받는다)
export const EDIT_ALLOWED: ApplicationStatus[] = ["draft", "needs_changes", "submitted", "reviewing", "approved", "held"]
export type PhotoRow = { slot: PhotoSlotId; path: string; mime: string; bytes: number; width: number; height: number; sha256: string; review: PhotoReview; reason: string | null; created_at: string }
export type MyApplication = { draft: ApplicationDraft; status: ApplicationStatus; decisionNote: string | null; submittedAt: string | null; photoRows: PhotoRow[] }

// 서버 사진 기록을 신청서 화면의 사진 모양으로 바꾼다(검사 함수를 그대로 쓰기 위해).
export function photosFromRows(rows: PhotoRow[]): ApplicationPhotos {
  const photos = emptyPhotos()
  for (const row of rows) {
    photos[row.slot] = {
      ...emptyPhoto(),
      file: { id: row.sha256, name: `${row.slot}.jpg`, mime: "image/jpeg", bytes: row.bytes, width: row.width, height: row.height },
      status: "ready", review: row.review, reason: (row.reason as never) ?? null,
      recentSelfConfirmed: true, rightsSelfConfirmed: true, revision: 1,
    }
  }
  return photos
}

const SUBMISSION: Record<ApplicationStatus, ApplicationDraft["review"]["submission"]> = { draft: "draft", needs_changes: "draft", submitted: "received", reviewing: "received", approved: "received", rejected: "received", held: "held", withdrawn: "withdrawn" }

export async function loadMyApplication(): Promise<{ data: MyApplication | null; error: string | null }> {
  try {
    const db = await supabase()
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return { data: null, error: "로그인이 필요해요." }
    const [{ data: row, error }, { data: rows, error: photoError }] = await Promise.all([
      db.from("applications").select("draft, status, decision_note, submitted_at").eq("member_id", auth.user.id).maybeSingle(),
      db.from("application_photos").select("slot, path, mime, bytes, width, height, sha256, review, reason, created_at").eq("member_id", auth.user.id),
    ])
    if (error || photoError) return { data: null, error: friendlyError(error || photoError) }
    const base = emptyApplication()
    const saved = (row?.draft ?? {}) as Partial<ApplicationDraft>
    const status = (row?.status ?? "draft") as ApplicationStatus
    const photoRows = (rows ?? []) as PhotoRow[]
    // 홍보 링크로 들어왔다면 ‘알게 된 경로’를 미리 채운다(회원이 바꿀 수 있다).
    const values = normalizeLegacyValues({ ...base.values, ...(saved.values ?? {}) })
    const source = storedSource()
    if (!values["self.source"] && source) values["self.source"] = source
    const draft: ApplicationDraft = {
      ...base,
      values,
      sharing: { ...base.sharing, ...(saved.sharing ?? {}) },
      preferences: saved.preferences ?? base.preferences,
      step: typeof saved.step === "number" ? saved.step : 0,
      visited: Array.isArray(saved.visited) ? saved.visited : [0],
      photos: photosFromRows(photoRows),
      review: { ...base.review, submission: SUBMISSION[status], receivedAt: row?.submitted_at ?? null },
      savedAt: null,
      completedDemo: false,
    }
    return { data: { draft, status, decisionNote: row?.decision_note ?? null, submittedAt: row?.submitted_at ?? null, photoRows }, error: null }
  } catch (error) {
    return { data: null, error: friendlyError(error as Error) }
  }
}

export function saveMyDraft(draft: ApplicationDraft) {
  const { values, sharing, preferences, step, visited } = draft
  return rpc<{ savedAt: string }>("save_application_draft", { p_draft: { values, sharing, preferences, step, visited } })
}
export const submitMyApplication = () => rpc<{ status: string; submittedAt: string; edited?: boolean }>("submit_application")
export const withdrawMyApplication = () => rpc<null>("withdraw_application")

// ─────────────────────────────────────────────
// 사진: 브라우저에서 다시 그려 저장한다. 이때 촬영 위치(GPS) 같은 메타데이터가 모두 빠진다.
const MAX_SIDE = 2048
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("")

// 사진 읽기: 형식·크기를 확인하고(올린 파일일 때), 아이폰 HEIC는 JPG로 바꾼 뒤 방향을 바로잡아 그림으로 읽는다.
export async function decodePhoto(file: Blob): Promise<{ bitmap: ImageBitmap } | { error: string }> {
  const named = file instanceof File ? file : null
  const type = file.type.toLowerCase()
  const heic = /heic|heif/.test(type) || (!!named && /\.(heic|heif)$/i.test(named.name))
  if (named) {
    if (!heic && !["image/jpeg", "image/png", "image/webp"].includes(type)) return { error: "JPG·PNG·WebP·HEIC 사진만 올릴 수 있어요." }
    if (file.size > BEFORE_US.photoFiles.maximumBytes) return { error: "한 장에 10MB 이하인 사진을 골라 주세요." }
  }
  let source: Blob = file
  if (heic) {
    // 아이폰 HEIC 사진: 사파리는 바로 읽고, 다른 브라우저는 변환 도구를 그때 불러와 JPG로 바꾼다.
    const direct = await createImageBitmap(file).then(bitmap => { bitmap.close(); return true }, () => false)
    if (!direct) {
      try {
        const { default: heic2any } = await import("heic2any")
        const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 })
        source = Array.isArray(converted) ? converted[0] : converted
      } catch { return { error: "HEIC 사진을 바꾸지 못했어요. 휴대폰 설정에서 JPG로 바꾸거나 캡처해서 올려 주세요." } }
    }
  }
  try { return { bitmap: await createImageBitmap(source, { imageOrientation: "from-image" }) } } catch { return { error: "사진을 읽지 못했어요. 다른 사진으로 다시 시도해 주세요." } }
}

// 사진 저장 형식: 다시 그린 캔버스를 JPG로 바꾸고 지문(sha256)을 붙인다. 이때 촬영 위치 같은 정보는 남지 않는다.
export async function encodePhoto(canvas: HTMLCanvasElement): Promise<{ blob: Blob; width: number; height: number; sha256: string } | { error: string }> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9))
  if (!blob) return { error: "사진을 저장 형식으로 바꾸지 못했어요." }
  const sha256 = hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))
  return { blob, width: canvas.width, height: canvas.height, sha256 }
}
export type PreparedPhoto = { blob: Blob; width: number; height: number; sha256: string }

// 자르지 않고 올릴 때: 긴 변을 2048px 안으로 줄여 그대로 다시 그린다.
export async function preparePhoto(file: File): Promise<PreparedPhoto | { error: string }> {
  const decoded = await decodePhoto(file)
  if ("error" in decoded) return decoded
  const { bitmap } = decoded
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale)
  const canvas = document.createElement("canvas")
  canvas.width = width; canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) return { error: "이 브라우저에서는 사진을 처리할 수 없어요." }
  context.fillStyle = "#fff"; context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return encodePhoto(canvas)
}

export async function uploadPhoto(slot: PhotoSlotId, file: File, previousPath: string | null): Promise<{ error: string | null }> {
  const prepared = await preparePhoto(file)
  if ("error" in prepared) return { error: prepared.error }
  return uploadPreparedPhoto(slot, prepared, previousPath)
}

// 위치·크기를 조절해 다시 그린 사진을 올린다(새 사진을 먼저 등록한 뒤 이전 사진을 지운다).
export async function uploadPreparedPhoto(slot: PhotoSlotId, prepared: PreparedPhoto, previousPath: string | null): Promise<{ error: string | null }> {
  try {
    const db = await supabase()
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return { error: "로그인이 필요해요." }
    const path = `${auth.user.id}/${slot}-${crypto.randomUUID().slice(0, 8)}.jpg`
    const { error: uploadError } = await db.storage.from(PHOTO_BUCKET).upload(path, prepared.blob, { contentType: "image/jpeg", upsert: false })
    if (uploadError) return { error: friendlyError(uploadError, "사진을 올리지 못했어요. 다시 시도해 주세요.") }
    const { error } = await rpc("register_photo", { p_slot: slot, p_path: path, p_mime: "image/jpeg", p_bytes: prepared.blob.size, p_width: prepared.width, p_height: prepared.height, p_sha256: prepared.sha256, p_recent: true, p_rights: true })
    if (error) { await db.storage.from(PHOTO_BUCKET).remove([path]); return { error } }
    if (previousPath) await db.storage.from(PHOTO_BUCKET).remove([previousPath])
    return { error: null }
  } catch (error) {
    return { error: friendlyError(error as Error) }
  }
}

export async function removePhoto(slot: PhotoSlotId, path: string) {
  const { error } = await rpc("delete_photo", { p_slot: slot })
  if (error) return { error }
  const db = await supabase()
  await db.storage.from(PHOTO_BUCKET).remove([path])
  return { error: null }
}

// 사진 주소는 5분 동안만 쓸 수 있게 만든다(외부로 퍼져도 곧 열리지 않는다).
const urlCache = new Map<string, { url: string; until: number }>()
export async function photoUrl(path: string) {
  const cached = urlCache.get(path)
  if (cached && cached.until > Date.now()) return cached.url
  const db = await supabase()
  const { data } = await db.storage.from(PHOTO_BUCKET).createSignedUrl(path, 300)
  if (!data?.signedUrl) return null
  urlCache.set(path, { url: data.signedUrl, until: Date.now() + 240000 })
  return data.signedUrl
}

// 상대 사진: 서버 함수가 열람 기간인지 확인한 뒤 5분짜리 주소를 만들어 준다.
export async function partnerPhotoUrl(path: string) {
  const cached = urlCache.get(path)
  if (cached && cached.until > Date.now()) return cached.url
  try {
    const db = await supabase()
    const { data, error } = await db.functions.invoke<{ url?: string }>("partner-photo", { body: { path } })
    if (error || !data?.url) return null
    urlCache.set(path, { url: data.url, until: Date.now() + 240000 })
    return data.url
  } catch {
    return null
  }
}

export const PHOTO_ORDER = PHOTO_SLOTS.map((slot) => slot.id)
