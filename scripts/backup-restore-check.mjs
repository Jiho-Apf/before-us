// 복구 전 확인(GPT 4차 R4-04·R4-06): `npm run backup:restore-check -- <바깥 사본 폴더> [--lost-at <원본을 잃은 시각 ISO>] [--confirmed "<확인한 근거>"]`
// 원본 DB(와 이 컴퓨터)를 잃고 바깥 사본으로 되살리기 전에, 아무것도 풀어 쓰지 않고(메모리에서만) 두 가지를 판정한다.
//  1) 복구 지점: 바깥 사본에서 ‘정상 백업’ 가운데 가장 최근 것. 필수 파일·봉인된 목록·사진 지문까지 실제로 풀어 확인한다.
//     손상됐거나 부분 백업인 폴더는 건너뛰고 그 이유를 적는다. 정상 백업이 하나도 없으면 종료 코드 1.
//  2) 회원 접근을 열어도 되는가: 가장 최근 ‘삭제 이력’ 파일이 추출된 때(exportedAt)부터 원본을 잃은 때(--lost-at, 모르면 지금)까지는
//     누가 탈퇴·삭제됐는지 알 수 없는 ‘불명확한 기간’이다. 이 기간이 1분이라도 있으면 그 사이 지워진 회원의 자료가 되살아나 다시 보일 수 있다.
//       · 불명확한 기간 없음(삭제 이력이 원본을 멈춘 뒤에 추출됨 · 계획된 이전) → memberAccess: open · 종료 코드 0
//       · 있음 → memberAccess: closed · 종료 코드 4. 자료는 넣어도 되지만 회원 로그인·소개·메일(outbound_paused·예약 작업)을 열지 않는다.
//       · 그 기간의 탈퇴·삭제가 없었음을 다른 기록(운영 메일함의 탈퇴 안내, Supabase 쪽에 남은 기록 등)으로 확인했다면
//         --confirmed "근거"(10자 이상)를 붙여 다시 실행한다. 근거가 판정에 그대로 남는다.
// 판정은 JSON으로 화면에 낸다(개인정보 없음: 폴더·파일 이름과 시각·숫자뿐). 이 도구는 아무것도 바꾸지 않는다.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { decrypt, loadKey } from "./backup-crypto.mjs"
import { deletionExports, timeOfName, verifyBackup } from "./backup-lib.mjs"

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? "" : null }
const dir = args.find((a, i) => !a.startsWith("--") && !["--lost-at", "--confirmed"].includes(args[i - 1]))
const fail = (message) => { console.error(message); process.exit(1) }
if (!dir || !existsSync(dir)) fail("사용법: npm run backup:restore-check -- <바깥 사본 폴더> [--lost-at <ISO 시각>] [--confirmed \"<확인한 근거>\"]")
const lostArg = flag("--lost-at"), confirmed = flag("--confirmed")
const lostAt = lostArg === null ? Date.now() : Date.parse(lostArg)
if (!Number.isFinite(lostAt)) fail("--lost-at 은 2026-11-16T03:00:00Z 같은 시각이어야 해요.")
if (confirmed !== null && confirmed.trim().length < 10) fail("--confirmed 에는 무엇으로 확인했는지 10자 이상 적어 주세요.")
let key, keyId
try { ({ key, keyId } = loadKey()) } catch (error) { fail(String(error.message)) }

// 1) 복구 지점
const skipped = []
let point = null
for (const name of readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(n) && statSync(join(dir, n)).isDirectory()).sort().reverse()) {
  try {
    const v = verifyBackup(join(dir, name), key, keyId)
    point = { name, at: v.manifest.at ? Date.parse(v.manifest.at) : timeOfName(name), format: v.format, photos: v.legacy ? null : v.items.length, legacy: v.legacy }
    break
  } catch (error) { skipped.push({ name, why: String(error.message).split(/\r?\n/)[0].slice(0, 160) }) }
}
if (!point) { console.log(JSON.stringify({ restorePoint: null, skipped }, null, 2)); fail("정상 백업이 없어요(바깥 사본에서 복구 지점을 찾지 못했어요). 건너뛴 이유는 위 skipped 에 있어요.") }

// 2) 삭제 이력
let deletions = null
const badExports = []
for (const item of deletionExports(dir)) {
  try {
    const payload = JSON.parse(decrypt(key, readFileSync(item.path)).toString())
    if (payload.kind !== "flavie-deletions" || !Array.isArray(payload.rows) || !Number.isFinite(Date.parse(payload.exportedAt))) throw new Error("삭제 이력 형식이 아니에요.")
    deletions = { file: item.file, exportedAt: Date.parse(payload.exportedAt), rows: payload.rows.length }
    break
  } catch (error) { badExports.push({ file: item.file, why: String(error.message).split(/\r?\n/)[0].slice(0, 160) }) }
}
// 삭제 이력이 없으면 백업 시각부터가 모두 불명확하다(백업 안의 deletion_log 는 백업 그때까지뿐)
const knownUntil = deletions ? Math.max(deletions.exportedAt, 0) : point.at
const unclearMinutes = Math.ceil(Math.max(0, lostAt - knownUntil) / 60000) // 1초라도 있으면 1분으로 올려 센다(짧다고 0으로 보지 않는다)
const open = unclearMinutes === 0 || confirmed !== null
const iso = (ms) => new Date(ms).toISOString()
const verdict = {
  checkedAt: iso(Date.now()),
  backup: point.name, backupAt: iso(point.at), backupFormat: point.format, photos: point.photos,
  ...(point.legacy ? { note: "예전 형식 백업이에요(사진이 모두 들어 있는지 이 도구로는 알 수 없어요)." } : {}),
  deletions: deletions?.file ?? null, deletionsExportedAt: deletions ? iso(deletions.exportedAt) : null, deletionRows: deletions?.rows ?? null,
  lostAt: iso(lostAt), lostAtGiven: lostArg !== null,
  unclearFrom: iso(knownUntil), unclearTo: iso(Math.max(lostAt, knownUntil)), unclearMinutes,
  memberAccess: open ? "open" : "closed",
  ...(confirmed !== null ? { confirmed: confirmed.trim() } : {}),
  ...(skipped.length ? { skipped } : {}), ...(badExports.length ? { badExports } : {}),
  next: open
    ? ["자료를 넣고 → 이 삭제 이력으로 deletion_log 를 채우고 select public.apply_deletion_log(); → 사진 정리 한 번 → 지문 비교 → 그 뒤에 예약 작업·메일을 켜요."]
    : [
        `삭제 이력을 뽑은 뒤(${iso(knownUntil)})부터 원본을 잃을 때까지 ${unclearMinutes}분 동안 탈퇴·삭제된 회원이 있었는지 알 수 없어요.`,
        "자료를 넣고 삭제 이력을 적용하는 것까지는 해도 돼요. 하지만 회원 로그인·소개·메일은 열지 않아요(outbound_paused 유지 · 예약 작업 끔 · 화면은 점검 안내).",
        "그 기간의 탈퇴 요청·삭제가 없었는지 다른 기록으로 확인해요. 있었다면 그 회원을 먼저 지워요.",
        "확인이 끝나면 --confirmed \"근거\"를 붙여 다시 실행해요. 확인할 방법이 없으면 열지 않고 회원에게 재가입 안내를 해요.",
      ],
}
console.log(JSON.stringify(verdict, null, 2))
process.exit(open ? 0 : 4)
