// 플라비 백업: 실제 서버의 자료(모든 public 표 + 계정 기본 정보 + 스키마 지문)와 사진 파일(신청 사진·편지 사진)을 이 컴퓨터에 암호문으로만 받는다.
//  - 실행: 코드 폴더에서 `npm run backup`(= node scripts/backup.mjs). Supabase CLI 로그인이 되어 있어야 한다.
//  - 저장 위치: 코드 폴더 밖 `비포어스\백업\날짜_시각\`(설정: scripts/backup-lib.mjs).
//  - 평문이 디스크에 닿지 않는다(GPT 3차 검수 R3-02):
//      · 자료: CLI가 화면 출력으로 돌려준 JSON을 메모리에서 바로 암호화한다.
//      · 사진: CLI가 파일 대신 이름 있는 파이프(\\.\pipe\…)에 쓰게 해서, 바이트를 메모리로 받아 바로 암호화한다(Supabase CLI 2.121.0으로 확인).
//      · 암호문은 `.enc.part`에 쓰고 디스크까지 내린 뒤(fsync) 다시 읽어 풀어 보고 같을 때만 `.enc`로 이름을 바꾼다.
//      · 사진 파일 이름(회원 번호가 든 경로)은 폴더에 드러나지 않게 번호(files/000001.enc)로 저장하고, 경로 목록은 암호화한 index.json.enc 에 둔다.
//      → 강제 종료·전원 차단·디스크 가득 참이어도 디스크에는 암호문(완성 또는 .part)만 남는다. 다음 실행을 기다릴 필요가 없다.
//  - 만료(최대 30일)는 백업과 따로 `npm run backup:expire`(작업 스케줄러로 매일)가 처리한다. 이 백업도 시작할 때 한 번 같은 정리를 한다.
//  - 끝나면 서버 작업 기록에 ‘backup’ 결과(숫자만)를 남긴다 → 공개 상태(public_health)에서 백업 나이가 보인다.
//  - 복구: `npm run backup:open -- <백업 폴더> <풀어 둘 폴더>` 또는 재해 복구 절차(문서) → 자료를 넣은 뒤 최신 삭제 이력 적용(apply_deletion_log).
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { KEY_FILE, loadKey } from "./backup-crypto.mjs"
import { BUCKETS, KEEP_DAYS, PROJECT, expireRoot, log, pipeDownload, query, reportRun, sealFile, settings, stampOf, warn, writeAtomic, cliSync, code } from "./backup-lib.mjs"

const cfg = settings()
const now = cfg.now()
const stamp = stampOf(now)
const { key, keyId, created } = loadKey({ create: true })
if (created) console.log(`새 백업 키를 만들었어요 · ${KEY_FILE}\n  이 키를 비밀번호 관리자에도 꼭 보관해 주세요. 키가 없으면 백업을 풀 수 없어요.`)

// 시험 모드에서만: 단계마다 멈춰(강제 종료 시험) · 표시 파일을 남긴다
const pauseAt = cfg.test ? process.env.FLAVIE_BACKUP_TEST_PAUSE : null
const marker = cfg.test ? process.env.FLAVIE_BACKUP_TEST_MARKER : null
let pauseCount = 0
function stage(name, detail) {
  if (!pauseAt || name !== pauseAt) return
  if (++pauseCount < Number(process.env.FLAVIE_BACKUP_TEST_PAUSE_NTH || 1)) return
  if (marker) writeAtomic(marker, JSON.stringify({ stage: name, detail }))
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000) // 시험이 여기서 강제로 끈다
}

// 0) 만료 정리(로컬) — 바깥 사본은 backup:offsite·backup:expire 가 맡는다
mkdirSync(cfg.root, { recursive: true })
const expired = expireRoot(cfg.root, { now: cfg.now, key, keyId, label: "로컬" })
for (const name of expired.removed) console.log(`만료된 백업 삭제 · ${name}`)
if (expired.errors.length) warn(cfg, "만료된 백업을 지우지 못했어요", expired.errors)

const target = join(cfg.root, stamp)
if (existsSync(target)) { console.error(`같은 이름의 백업 폴더가 이미 있어요: ${target}`); process.exit(1) }
mkdirSync(target, { recursive: true })
console.log(`백업 시작 · ${target}`)
const fail = (title, error) => {
  const message = String(error?.stderr || error?.message || error).split(/\r?\n/)[0].slice(0, 200)
  log(cfg, { job: "backup", ok: false, folder: stamp, error: message })
  warn(cfg, title, [message, `폴더 ${stamp} 에는 암호문만 남아 있어요(manifest가 없으면 끝나지 않은 백업이에요). 다시 실행해 주세요.`])
  reportRun(cfg, "backup", false, { stage: title.slice(0, 60) })
  process.exit(1)
}

try {
  // 1) 자료: public 표 전부 + 계정 기본 정보(비밀번호는 원문이 아닌 해시) · 화면 출력으로 받아 메모리에서 바로 암호화
  const tables = query(cfg, "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1").map((row) => row.table_name)
  const parts = tables.map((name) => `'${name}', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public."${name}" t)`)
  parts.push(`'auth.users', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (select id, email, encrypted_password, email_confirmed_at, created_at, updated_at, last_sign_in_at, raw_user_meta_data, banned_until, deleted_at from auth.users) t)`)
  const data = query(cfg, `select jsonb_build_object(${parts.join(", ")}) as data`)[0].data
  const counts = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, rows.length]))
  sealFile(key, Buffer.from(JSON.stringify(data)), join(target, "data.json.enc"), { onStage: stage })
  console.log(`자료 ${tables.length + 1}개 표 저장(암호화)`)

  // 2) 스키마 지문(개인정보 없음): 적용된 마이그레이션 · 함수 권한 · 표 RLS · 저장소 버킷 설정 → 복구 뒤 같은지 맞춰 본다
  const schema = query(cfg, `select jsonb_build_object(
    'migrations', (select coalesce(jsonb_agg(version order by version), '[]'::jsonb) from supabase_migrations.schema_migrations),
    'functions', (select coalesce(jsonb_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || p.prosecdef || '|' || coalesce(array_to_string(p.proacl, ','), '') order by 1), '[]'::jsonb)
                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
    'rls', (select coalesce(jsonb_agg(c.relname || '|' || c.relrowsecurity order by 1), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'),
    'buckets', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public, 'limit', file_size_limit, 'mime', allowed_mime_types) order by id), '[]'::jsonb) from storage.buckets)
  ) as schema`)[0].schema
  sealFile(key, Buffer.from(JSON.stringify(schema)), join(target, "schema.json.enc"), { onStage: stage })

  // 3) 사진: 버킷마다 목록 → 한 장씩 파이프로 받아 메모리에서 암호화. 신청 사진은 DB에 적힌 지문(sha256)과 맞춰 본다.
  const known = new Map((data.application_photos ?? []).concat(data.photo_replacements ?? []).map((row) => [row.path, row.sha256]))
  const index = []
  const photos = {}
  let seq = 0
  for (const bucket of BUCKETS) {
    const result = { saved: 0, failed: 0, mismatched: 0 }
    try {
      const listed = JSON.parse(cliSync(cfg, ["storage", "ls", "-r", `ss:///${bucket}`, "--linked", "--experimental", "--output-format", "json", "--workdir", code]).replace(/^[^{]*/, "")).paths ?? []
      for (const remote of listed.filter((path) => /\.(jpe?g|png|webp)$/i.test(path))) {
        const path = remote.replace(new RegExp(`^/${bucket}/`), "")
        let bytes
        try { bytes = await pipeDownload(cfg, remote) } catch (error) { result.failed++; log(cfg, { job: "backup", photo: "failed", bucket, error: String(error?.message ?? error).slice(0, 160) }); continue }
        stage("downloaded", { bucket })
        const file = `files/${String(++seq).padStart(6, "0")}.enc`
        const sealed = sealFile(key, bytes, join(target, file), { onStage: stage })
        bytes.fill(0)
        if (bucket === "application-photos" && known.has(path) && known.get(path) !== sealed.sha256) result.mismatched++
        index.push({ bucket, path, file, bytes: sealed.bytes, sha256: sealed.sha256 })
        result.saved++
      }
    } catch (error) {
      if (error?.code === "ENOSPC") throw error
      result.error = String(error?.stderr || error?.message || error).split(/\r?\n/)[0].slice(0, 200)
    }
    photos[bucket] = result
    console.log(`${bucket} 저장 ${result.saved}장${result.failed ? ` · 실패 ${result.failed}장` : ""}${result.mismatched ? ` · 지문 다름 ${result.mismatched}장` : ""}${result.error ? ` · ${result.error}` : ""}`)
  }
  sealFile(key, Buffer.from(JSON.stringify(index)), join(target, "index.json.enc"), { onStage: stage })

  // 4) manifest(숫자·시각만 · 마지막에 써서 ‘끝난 백업’ 표시)
  writeAtomic(join(target, "manifest.json"), JSON.stringify({
    format: 2, at: now.toISOString(), expiresAt: new Date(now.getTime() + KEEP_DAYS * 86400000).toISOString(), project: PROJECT,
    counts, photos, files: index.length, schemaMigrations: schema.migrations?.length ?? 0, lastMigration: schema.migrations?.at?.(-1) ?? null,
    encryption: { alg: "aes-256-gcm", keyId },
    restore: "재해 복구 절차(문서) · 자료를 넣은 뒤 최신 ‘삭제 이력’ 파일로 deletion_log 를 채우고 select public.apply_deletion_log(); · 복구 환경은 outbound_paused 를 먼저 켠다",
  }, null, 2))
  const totalFailed = Object.values(photos).reduce((n, r) => n + r.failed + r.mismatched + (r.error ? 1 : 0), 0)
  log(cfg, { job: "backup", ok: totalFailed === 0, folder: stamp, tables: tables.length + 1, files: index.length, failed: totalFailed })
  reportRun(cfg, "backup", totalFailed === 0, { tables: tables.length + 1, files: index.length, failed: totalFailed })
  if (totalFailed) warn(cfg, "백업은 끝났지만 일부 사진을 받지 못했어요", [`폴더 ${stamp} · 실패 ${totalFailed}건 · 다시 실행해 주세요.`])
  console.log("백업 끝", counts)
  if (!existsSync(KEY_FILE) && !process.env.FLAVIE_BACKUP_KEY) console.log("키 파일을 찾을 수 없어요. 키를 따로 보관했는지 확인해 주세요.")
  if (!cfg.offsite) console.log("바깥 사본 폴더(offsite)가 설정되지 않았어요. `npm run backup:offsite` 안내를 확인해 주세요.")
} catch (error) {
  // 디스크 가득 참 등: 쓰던 암호문 임시 파일은 sealFile 이 이미 지웠다. 평문은 처음부터 디스크에 없다.
  for (const name of existsSync(target) ? readdirSync(target) : []) if (name.endsWith(".part")) rmSync(join(target, name), { force: true })
  fail(error?.code === "ENOSPC" ? "디스크 공간이 부족해 백업을 멈췄어요" : "백업 중 오류로 멈췄어요", error)
}
