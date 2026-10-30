// 지운 사진 파일 정리(매일 04:00 KST, pg_cron이 부른다).
// 데이터베이스에서 지워진 사진(탈퇴·교체·삭제·보존 기간이 지난 편지 사진)의 파일을 Storage API로 지운다. 아직 열람 기간인 소개 사본에 쓰이는 사진은 남긴다.
// 받는 값이 없고 대기열에 있는 파일만 지우므로, 누가 불러도 다른 일을 할 수 없다.
// 돌 때마다 결과를 작업 기록(job_runs · storage-cleanup)에 남긴다(실패하면 운영진 대시보드 맨 위에 경고).
import { createClient } from "npm:@supabase/supabase-js@2.49.4"

Deno.serve(async () => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  const started = new Date().toISOString()
  const record = (ok: boolean, detail: Record<string, unknown>) =>
    db.from("job_runs").insert({ job: "storage-cleanup", started_at: started, finished_at: new Date().toISOString(), ok, detail }).then(() => undefined, () => undefined)
  const { data, error } = await db.rpc("storage_cleanup_batch", { p_limit: 200 })
  if (error) { await record(false, { error: error.message.slice(0, 300) }); return Response.json({ error: error.message }, { status: 500 }) }
  const byBucket = new Map<string, string[]>()
  for (const row of (data ?? []) as { bucket: string; path: string }[]) byBucket.set(row.bucket, [...(byBucket.get(row.bucket) ?? []), row.path])
  let removed = 0
  for (const [bucket, paths] of byBucket) {
    const { error: removeError } = await db.storage.from(bucket).remove(paths)
    if (removeError) { await record(false, { removed, error: removeError.message.slice(0, 300) }); return Response.json({ error: removeError.message, removed }, { status: 500 }) }
    await db.from("storage_cleanup").delete().eq("bucket", bucket).in("path", paths)
    removed += paths.length
  }
  await record(true, { removed })
  return Response.json({ removed })
})
