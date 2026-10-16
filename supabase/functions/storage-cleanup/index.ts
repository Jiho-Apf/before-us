// 지운 사진 파일 정리(매일 04:00 KST, pg_cron이 부른다).
// 데이터베이스에서 지워진 사진(탈퇴·교체·삭제)의 파일을 Storage API로 지운다. 아직 열람 기간인 소개 사본에 쓰이는 사진은 남긴다.
// 받는 값이 없고 대기열에 있는 파일만 지우므로, 누가 불러도 다른 일을 할 수 없다.
import { createClient } from "npm:@supabase/supabase-js@2.49.4"

Deno.serve(async () => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  const { data, error } = await db.rpc("storage_cleanup_batch", { p_limit: 200 })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const byBucket = new Map<string, string[]>()
  for (const row of (data ?? []) as { bucket: string; path: string }[]) byBucket.set(row.bucket, [...(byBucket.get(row.bucket) ?? []), row.path])
  let removed = 0
  for (const [bucket, paths] of byBucket) {
    const { error: removeError } = await db.storage.from(bucket).remove(paths)
    if (removeError) return Response.json({ error: removeError.message, removed }, { status: 500 })
    await db.from("storage_cleanup").delete().eq("bucket", bucket).in("path", paths)
    removed += paths.length
  }
  return Response.json({ removed })
})
