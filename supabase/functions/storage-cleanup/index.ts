// 지운 사진 파일 정리(매시간 :45, pg_cron이 부른다 · 2026-11-05부터. 탈퇴 계정의 파일이 ‘7일 안에’ 지워지게).
// 데이터베이스에서 지워진 사진(탈퇴·교체·삭제·보존 기간이 지난 편지 사진)의 파일을 Storage API로 지운다.
// 아직 쓰이는 파일(신청 사진 · 심사 중인 교체 사진 · 열람 중인 소개 사본 · 보낸 편지 사진)은 남긴다(GPT 1차 검수 C2, 2026-11-04):
//  - 목록(storage_cleanup_batch)이 쓰이는 파일을 빼고 주고, 지우기 직전 storage_cleanup_recheck 로 한 번 더 확인한다.
//  - storage_cleanup_claim 은 돌려준 경로를 ‘지우는 중’으로 선점하고 선점 표(claim)를 준다(T02 2026-11-05 · 표는 R3-20 2026-11-06).
//    그동안 그 경로를 새로 쓰려는 곳은 거절된다. 지운 뒤 storage_cleanup_finish 로, 지우지 못하면 storage_cleanup_unclaim 으로
//    ‘내 표가 맞는 줄만’ 정리한다. 늦게 끝난 예전 작업이 새 작업의 선점을 풀거나 지우지 못한다(6600).
//  - 되돌리기: 이 함수(v9)는 6600이 먼저 적용돼 있어야 한다. 6600 뒤에 v8로 되돌려도 된다(v8은 표 없는 선점만 쓴다).
//  - 예약 작업만 부를 수 있다: 머리글 x-cron-token 을 서버의 열쇠(cron_token_ok)와 맞춰 보고, 다르면 401.
// 차례마다 작업 기록(job_runs · storage-cleanup)을 한 줄 남긴다(실패하면 운영진 대시보드 맨 위에 경고).
// 할 일이 없던 차례도 0건 줄(zero)로 남긴다(R3-06·G05 · record_job_run · 6800): ‘0건으로 잘 돎’과 ‘아예 안 돎’을 구분하려고.
// 0건 줄은 2일 지나면 지워져 쌓이지 않는다. 늦음은 run_job_watchdog·public_health 가 마지막 실행 시각으로 판단한다.
import { createClient } from "npm:@supabase/supabase-js@2.49.4"

Deno.serve(async (request) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  const { data: allowed, error: tokenError } = await db.rpc("cron_token_ok", { p_token: request.headers.get("x-cron-token") ?? "" })
  if (tokenError || allowed !== true) return Response.json({ error: "예약 작업만 부를 수 있어요." }, { status: 401 })
  const started = new Date().toISOString()
  const record = async (ok: boolean, detail: Record<string, unknown>, zero = false) => {
    const { error } = await db.rpc("record_job_run", { p_job: "storage-cleanup", p_ok: ok, p_detail: { ...detail, startedAt: started }, p_zero: zero })
    if (!error || zero) return
    // 6800 이전 DB(되돌린 경우): 예전처럼 표에 바로 남긴다
    const { error: insertError } = await db.from("job_runs").insert({ job: "storage-cleanup", started_at: started, finished_at: new Date().toISOString(), ok, detail })
    if (insertError) console.error("job_runs 기록 실패", insertError.message)
  }
  const { data, error } = await db.rpc("storage_cleanup_batch", { p_limit: 200 })
  if (error) { await record(false, { error: error.message.slice(0, 300) }); return Response.json({ error: error.message }, { status: 500 }) }
  const byBucket = new Map<string, string[]>()
  for (const row of (data ?? []) as { bucket: string; path: string }[]) byBucket.set(row.bucket, [...(byBucket.get(row.bucket) ?? []), row.path])
  let removed = 0, kept = 0, lost = 0
  for (const [bucket, listed] of byBucket) {
    // 지우기 직전 한 번 더: 그사이 다시 쓰이게 된 파일(교체 승인 등)은 빼고, 목록에서도 내린다.
    const { data: claimed, error: claimError } = await db.rpc("storage_cleanup_claim", { p_bucket: bucket, p_paths: listed })
    if (claimError) { await record(false, { removed, error: claimError.message.slice(0, 300) }); return Response.json({ error: claimError.message, removed }, { status: 500 }) }
    const claim = (claimed as { claim?: string } | null)?.claim ?? null
    const paths = ((claimed as { paths?: string[] } | null)?.paths ?? []) as string[]
    kept += listed.length - paths.length
    if (!paths.length || !claim) continue
    const { error: removeError } = await db.storage.from(bucket).remove(paths)
    if (removeError) {
      // 지우지 못했으니 내 선점을 푼다(풀지 못해도 30분 뒤에는 다시 고를 수 있다).
      const { error: releaseError } = await db.rpc("storage_cleanup_unclaim", { p_bucket: bucket, p_paths: paths, p_claim: claim })
      await record(false, { removed, error: removeError.message.slice(0, 300), ...(releaseError ? { releaseError: releaseError.message.slice(0, 200) } : {}) })
      return Response.json({ error: removeError.message, removed }, { status: 500 })
    }
    const { data: finished, error: doneError } = await db.rpc("storage_cleanup_finish", { p_bucket: bucket, p_paths: paths, p_claim: claim })
    if (doneError) { await record(false, { removed: removed + paths.length, error: `목록 정리 실패: ${doneError.message.slice(0, 260)}` }); return Response.json({ error: doneError.message }, { status: 500 }) }
    // 내 표로 정리한 줄이 모자라면 그사이 다른 작업이 선점을 넘겨받은 것(그 작업이 마저 정리한다) · 기록에만 남긴다.
    if (typeof finished === "number" && finished < paths.length) lost += paths.length - finished
    removed += paths.length
  }
  await record(true, { removed, ...(kept ? { kept } : {}), ...(lost ? { claimLost: lost } : {}) }, !removed && !kept && !lost)
  return Response.json({ removed, kept, ...(lost ? { claimLost: lost } : {}) })
})
