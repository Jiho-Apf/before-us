import { emptyApplication, type ApplicationDraft } from "../application-model"
import { emptyPhoto, emptyPhotos, PHOTO_SLOTS, type ApplicationPhotos, type PhotoReview, type PhotoSlotId } from "../photo-model"
import { BEFORE_US } from "../config"
import { PHOTO_BUCKET, friendlyError, rpc, supabase } from "./client"

// 실제 서버의 소개 신청서·사진.
export type ApplicationStatus = "draft" | "submitted" | "reviewing" | "needs_changes" | "approved" | "held" | "withdrawn" | "rejected"
export const EDITABLE: ApplicationStatus[] = ["draft", "needs_changes"]
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
    const draft: ApplicationDraft = {
      ...base,
      values: { ...base.values, ...(saved.values ?? {}) },
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
export const submitMyApplication = () => rpc<{ status: string; submittedAt: string }>("submit_application")
export const withdrawMyApplication = () => rpc<null>("withdraw_application")

// ─────────────────────────────────────────────
// 사진: 브라우저에서 다시 그려 저장한다. 이때 촬영 위치(GPS) 같은 메타데이터가 모두 빠진다.
const MAX_SIDE = 2048
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("")

export async function preparePhoto(file: File): Promise<{ blob: Blob; width: number; height: number; sha256: string } | { error: string }> {
  const type = file.type.toLowerCase()
  if (/heic|heif/.test(type) || /\.(heic|heif)$/i.test(file.name)) return { error: "HEIC 사진은 아직 받을 수 없어요. 휴대폰 설정에서 JPG로 바꾸거나 캡처해서 올려 주세요." }
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return { error: "JPG·PNG·WebP 사진만 올릴 수 있어요." }
  if (file.size > BEFORE_US.photoFiles.maximumBytes) return { error: "한 장에 10MB 이하인 사진을 골라 주세요." }
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }) } catch { return { error: "사진을 읽지 못했어요. 다른 사진으로 다시 시도해 주세요." } }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale)
  const canvas = document.createElement("canvas")
  canvas.width = width; canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) return { error: "이 브라우저에서는 사진을 처리할 수 없어요." }
  context.fillStyle = "#fff"; context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9))
  if (!blob) return { error: "사진을 저장 형식으로 바꾸지 못했어요." }
  const sha256 = hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))
  return { blob, width, height, sha256 }
}

export async function uploadPhoto(slot: PhotoSlotId, file: File, previousPath: string | null): Promise<{ error: string | null }> {
  const prepared = await preparePhoto(file)
  if ("error" in prepared) return { error: prepared.error }
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

export const PHOTO_ORDER = PHOTO_SLOTS.map((slot) => slot.id)
