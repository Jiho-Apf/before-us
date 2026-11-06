// 삭제 이력 내보내기(GPT 3차 검수 R3-04): `npm run backup:deletions`
//  - 서버의 deletion_log(지운 계정 번호·지운 시각, 35일 보관)를 암호화해 `백업\삭제 이력\deletions_날짜_시각.json.enc`로 저장하고,
//    바깥 사본 폴더가 있으면 그곳에도 바로 복사한다(암호문만 · 지문 확인).
//  - 회원 이름·메일·글은 없다(무작위 계정 번호와 시각뿐). 그래도 암호화한다.
//  - 작업 스케줄러로 매일 돌린다(백업보다 자주). 원본 DB와 이 컴퓨터를 함께 잃어도, 바깥 사본의 최신 파일로 ‘백업 이후 탈퇴’를 다시 지운다.
//  - 오래된 백업 안의 deletion_log 는 ‘그 시점까지’의 기록이다. 복구할 때는 반드시 이 파일 가운데 가장 최근 것을 쓴다(파일 이름 시각).
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { join } from "node:path"
import { loadKey } from "./backup-crypto.mjs"
import { DELETIONS, PROJECT, log, query, reportRun, sealFile, settings, sha256, stampOf, warn } from "./backup-lib.mjs"

const cfg = settings()
const { key, keyId } = loadKey()
const now = cfg.now()
const name = `deletions_${stampOf(now)}.json.enc`
try {
  const rows = query(cfg, "select coalesce(jsonb_agg(jsonb_build_object('member_id', member_id, 'deleted_at', deleted_at) order by deleted_at), '[]'::jsonb) as rows from public.deletion_log")[0].rows
  const payload = Buffer.from(JSON.stringify({ kind: "flavie-deletions", project: PROJECT, exportedAt: now.toISOString(), keyId, rows }))
  const local = join(cfg.root, DELETIONS, name)
  sealFile(key, payload, local)
  let copied = false
  if (cfg.offsite) {
    const dir = join(cfg.offsite, DELETIONS)
    mkdirSync(dir, { recursive: true })
    const part = join(dir, `${name}.part`)
    copyFileSync(local, part)
    if (sha256(readFileSync(part)) !== sha256(readFileSync(local))) { rmSync(part, { force: true }); throw new Error("바깥 사본에 복사한 파일이 원본과 달라요.") }
    renameSync(part, join(dir, name))
    copied = true
  }
  log(cfg, { job: "backup-deletions", ok: true, file: name, rows: rows.length, offsite: copied })
  reportRun(cfg, "backup-deletions", true, { rows: rows.length, offsite: copied })
  console.log(`삭제 이력 ${rows.length}건 저장(암호화) · ${name}${copied ? " · 바깥 사본에도 복사" : " · 바깥 사본 폴더 없음"}`)
  if (!cfg.offsite) warn(cfg, "삭제 이력을 바깥 사본에 복사하지 못했어요(폴더 설정 없음)", ["재해 복구에는 바깥 사본의 최신 삭제 이력이 필요해요. 안내 문서의 offsite 설정을 확인해 주세요."])
} catch (error) {
  const message = String(error?.stderr || error?.message || error).split(/\r?\n/)[0].slice(0, 200)
  log(cfg, { job: "backup-deletions", ok: false, error: message })
  reportRun(cfg, "backup-deletions", false, { stage: "export" })
  warn(cfg, "삭제 이력을 내보내지 못했어요", [message, "인터넷·Supabase CLI 로그인을 확인하고 `npm run backup:deletions`를 다시 실행해 주세요."])
  process.exit(1)
}
