// 지운 사진 파일 정리(매일 04:00 KST, pg_cron이 부른다).
// 데이터베이스에서 지워진 사진(탈퇴·교체·삭제·보존 기간이 지난 편지 사진)의 파일을 Storage API로 지운다.
// 아직 쓰이는 파일(신청 사진 · 심사 중인 교체 사진 · 열람 중인 소개 사본 · 보낸 편지 사진)은 남긴다(GPT 1차 검수 C2, 2026-11-04):
//  - 목록(storage_cleanup_batch)이 쓰이는 파일을 빼고 주고, 지우기 직전 storage_cleanup_recheck 로 한 번 더 확인한다.
//  - 예약 작업만 부를 수 있다: 머리글 x-cron-token 을 서버의 열쇠(cron_token_ok)와 맞춰 보고, 다르면 401.
// 돌 때마다 결과를 작업 기록(job_runs · storage-cleanup)에 남긴다(실패하면 운영진 대시보드 맨 위에 경고).
import { createClient } from "npm:@supabase/supabase-js@2.49.4"

Deno.serve(async (request) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  const { data: allowed, error: tokenError } = await db.rpc("cron_token_ok", { p_token: request.headers.get("x-cron-token") ?? "" })
  if (tokenError || allowed !== true) return Response.json({ error: "예약 작업만 부를 수 있어요." }, { status: 401 })
  const started = new Date().toISOString()
  const record = async (ok: boolean, detail: Record<string, unknown>) => {
    const { error } = await db.from("job_runs").insert({ job: "storage-cleanup", started_at: started, finished_at: new Date().toISOString(), ok, detail })
    if (error) console.error("job_runs 기록 실패", error.message)
  }
  const { data, error } = await db.rpc("storage_cleanup_batch", { p_limit: 200 })
  if (error) { await record(false, { error: error.message.slice(0, 300) }); return Response.json({ error: error.message }, { status: 500 }) }
  const byBucket = new Map<string, string[]>()
  for (const row of (data ?? []) as { bucket: string; path: string }[]) byBucket.set(row.bucket, [...(byBucket.get(row.bucket) ?? []), row.path])
  let removed = 0, kept = 0
  for (const [bucket, listed] of byBucket) {
    // 지우기 직전 한 번 더: 그사이 다시 쓰이게 된 파일(교체 승인 등)은 빼고, 목록에서도 내린다.
    const { data: safe, error: recheckError } = await db.rpc("storage_cleanup_recheck", { p_bucket: bucket, p_paths: listed })
    if (recheckError) { await record(false, { removed, error: recheckError.message.slice(0, 300) }); return Response.json({ error: recheckError.message, removed }, { status: 500 }) }
    const paths = (safe ?? []) as string[]
    kept += listed.length - paths.length
    if (!paths.length) continue
    const { error: removeError } = await db.storage.from(bucket).remove(paths)
    if (removeError) { await record(false, { removed, error: removeError.message.slice(0, 300) }); return Response.json({ error: removeError.message, removed }, { status: 500 }) }
    const { error: deleteError } = await db.from("storage_cleanup").delete().eq("bucket", bucket).in("path", paths)
    if (deleteError) { await record(false, { removed: removed + paths.length, error: `목록 정리 실패: ${deleteError.message.slice(0, 260)}` }); return Response.json({ error: deleteError.message }, { status: 500 }) }
    removed += paths.length
  }
  await record(true, { removed, ...(kept ? { kept } : {}) })
  return Response.json({ removed, kept })
})
