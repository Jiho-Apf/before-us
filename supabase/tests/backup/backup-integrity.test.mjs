// 백업 완전성 시험(GPT 4차 재검수 R4-03·R4-04·R4-05·R4-06) — 가짜 자료 · 가짜 CLI · 임시 폴더 · 임시 키만 쓴다.
// 실제 서버·실제 백업 폴더(비포어스\백업)·실제 키(%USERPROFILE%\.flavie\backup.key)는 건드리지 않는다.
// 실행: node supabase/tests/backup/backup-integrity.test.mjs (Windows · 이름 있는 파이프)
//  A) R4-03: 사진 일부·전부 실패 · 목록 조회 실패 · 지문 불일치 → ‘부분 백업’(종료 코드 3 · 안내 · 서버 기록 실패) · 정상 복구 지점으로 올리지 않음
//  B) R4-04: 풀기(backup-open)는 필수 파일·봉인된 목록(개수·지문)을 평문을 쓰기 전에 확인 · 하나라도 어긋나면 종료 코드 1 · 평문 0개
//  C) R4-05: 지우기 시작은 만든 지 29일(약속은 30일) → 매일 실행이면 30일 안 · 컴퓨터가 꺼져 늦으면 ‘늦게 지움’을 기록·안내 · .part 자격/실제 시각
//  D) R4-06: 복구 전 확인(backup-restore-check): 삭제 이력이 원본을 잃은 때보다 오래됐으면 ‘회원 접근을 열지 않음’
// 모든 항목을 끝까지 돌린 뒤 실패가 하나라도 있으면 종료 코드 1(고치기 전 재현 기록을 남기려고 중간에 멈추지 않는다).
import { execFileSync, spawnSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const code = join(here, "..", "..", "..")
let passed = 0, failed = 0
const ok = (label, value) => { if (value) { passed++; console.log("✓", label) } else { failed++; console.log("✗", label) } }
const soft = (fn) => { try { return fn() } catch (error) { return { thrown: String(error?.message ?? error).split("\n")[0] } } }
const walk = (dir) => { try { return readdirSync(dir).flatMap((name) => { const path = join(dir, name); try { return statSync(path).isDirectory() ? walk(path) : [path] } catch { return [] } }) } catch { return [] } }
const K1 = randomBytes(32).toString("hex"), K2 = randomBytes(32).toString("hex")
process.env.FLAVIE_BACKUP_KEY = K1
const { encrypt, decrypt, loadKey } = await import("../../../scripts/backup-crypto.mjs")
const key1 = Buffer.from(K1, "hex")
const sha = (b) => createHash("sha256").update(b).digest("hex")
const work = mkdtempSync(join(tmpdir(), "flavie-backup-integrity-"))
const realKeyFile = join(process.env.USERPROFILE ?? "", ".flavie", "backup.key")
const realKeyBefore = existsSync(realKeyFile) ? statSync(realKeyFile).mtimeMs : null
const plaintextIn = (dir) => walk(dir).filter((f) => { try { const b = readFileSync(f); return b.includes("PLAINTEXT-PHOTO") || b.includes("fake-member@example.test") || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) } catch { return false } })
const env = (root, extra = {}) => ({ ...process.env, FLAVIE_BACKUP_KEY: K1, FLAVIE_BACKUP_ROOT: root, FLAVIE_BACKUP_FAKE_CLI: join(here, "fake-supabase-cli.mjs"), FLAVIE_BACKUP_WARN_DIR: `${root}-warn`, FAKE_REPORT_LOG: `${root}-report.log`, FLAVIE_OFFSITE_DIR: "", ...extra })
const run = (script, root, extra = {}, args = []) => spawnSync(process.execPath, [join(code, "scripts", script), ...args], { env: env(root, extra), encoding: "utf8", cwd: code })
const read = (file) => { try { return readFileSync(file, "utf8") } catch { return "" } }
const manifestOf = (root, name) => { try { return JSON.parse(readFileSync(join(root, name, "manifest.json"), "utf8")) } catch { return null } }
const folders = (root) => { try { return readdirSync(root).filter((n) => /^\d{4}-/.test(n)).sort() } catch { return [] } }
const open = (from, to, { keyHex = K1, args = [] } = {}) => { const r = spawnSync(process.execPath, [join(code, "scripts", "backup-open.mjs"), from, to, ...args], { env: { ...process.env, FLAVIE_BACKUP_KEY: keyHex }, encoding: "utf8" }); return { status: r.status, out: r.stdout + r.stderr, files: walk(to).length } }
const T0 = "2026-11-02T03:00:00Z", T1 = "2026-11-03T03:00:00Z" // 12:00 KST
const NAME0 = "2026-11-02_120000", NAME1 = "2026-11-03_120000"
const logOf = (root) => read(join(root, "백업 기록.log")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))

try {
  // ── A) R4-03 부분 백업
  const cases = [
    ["사진 한 장만 실패", { FAKE_CP_FAIL_MATCH: "letter-photos/u1/b.jpg" }],
    ["사진 전부 실패(E04)", { FAKE_CP_MODE: "fail" }],
    ["버킷 목록 조회 실패", { FAKE_LS_FAIL: "letter-photos" }],
    ["신청 사진 지문 불일치", { FAKE_KNOWN: "1", FAKE_CP_CORRUPT_MATCH: "application-photos/u1/a.jpg" }],
  ]
  let n = 0
  for (const [label, extra] of cases) {
    const root = join(work, `a${++n}`)
    const r = run("backup.mjs", root, { FLAVIE_BACKUP_NOW: T0, ...extra })
    const m = manifestOf(root, NAME0)
    ok(`A) ${label} → 종료 코드가 0이 아니다(3 = 부분 백업)`, r.status === 3)
    ok(`A) ${label} → manifest에 status: partial`, m?.status === "partial")
    ok(`A) ${label} → 바탕 화면 안내 파일 · 서버 기록(실패)`, /부분 백업/.test(read(join(`${root}-warn`, "플라비 백업 확인 필요.txt"))) && /record_backup_run\('backup', false/.test(read(`${root}-report.log`)))
    ok(`A) ${label} → ‘백업 끝’이라고 하지 않고, 디스크에 평문 없음`, !/^백업 끝/m.test(r.stdout) && plaintextIn(root).length === 0)
    const off = join(work, `a${n}-off`)
    const o = run("backup-offsite.mjs", root, { FLAVIE_BACKUP_NOW: T0, FLAVIE_OFFSITE_DIR: off })
    ok(`A) ${label} → 바깥 사본으로 올리지 않고(복구 지점 아님) 종료 코드도 0이 아니다`, o.status !== 0 && !existsSync(join(off, NAME0, "manifest.json")) && !/^바깥 사본 끝/m.test(o.stdout))
    const out = join(work, `a${n}-open`)
    const p = open(join(root, NAME0), out)
    ok(`A) ${label} → 풀기(backup-open)는 부분 백업을 거절(평문 0개)`, p.status !== 0 && p.files === 0)
  }
  {
    // 지문 불일치 대조: 같은 조건에서 바이트가 맞으면 정상
    const root = join(work, "a-known-good")
    const r = run("backup.mjs", root, { FLAVIE_BACKUP_NOW: T0, FAKE_KNOWN: "1" })
    ok("A) 대조: 지문이 맞으면 정상 백업(종료 코드 0 · status: complete)", r.status === 0 && manifestOf(root, NAME0)?.status === "complete")
  }
  // 정상 백업 뒤 실패한 재실행: 직전 정상 백업을 덮거나 지우지 않고, 바깥 사본은 정상 것만
  const good = join(work, "good"), goodOff = join(work, "good-off")
  {
    const r0 = run("backup.mjs", good, { FLAVIE_BACKUP_NOW: T0 })
    const m0 = manifestOf(good, NAME0)
    ok("A) 정상 백업: 종료 코드 0 · status: complete · ‘백업 끝’", r0.status === 0 && m0?.status === "complete" && /^백업 끝/m.test(r0.stdout))
    const before = walk(join(good, NAME0)).map((f) => [f, sha(readFileSync(f))])
    const r1 = run("backup.mjs", good, { FLAVIE_BACKUP_NOW: T1, FAKE_CP_MODE: "fail" })
    ok("A) 그 뒤 실패한 재실행(부분 백업)은 새 폴더에만 남는다", r1.status === 3 && folders(good).join() === [NAME0, NAME1].join() && manifestOf(good, NAME1)?.status === "partial")
    ok("A) 직전 정상 백업은 한 바이트도 바뀌지 않았다", before.length > 0 && before.every(([f, h]) => existsSync(f) && sha(readFileSync(f)) === h) && walk(join(good, NAME0)).length === before.length)
    const o = run("backup-offsite.mjs", good, { FLAVIE_BACKUP_NOW: T1, FLAVIE_OFFSITE_DIR: goodOff })
    ok("A) 바깥 사본: 정상 백업만 옮기고 부분 백업은 옮기지 않는다", existsSync(join(goodOff, NAME0, "manifest.json")) && !existsSync(join(goodOff, NAME1)))
    ok("A) 가장 최근 백업이 부분 백업이면 바깥 사본도 종료 코드 3 · 안내", o.status === 3 && /부분 백업/.test(read(join(`${good}-warn`, "플라비 백업 확인 필요.txt"))))
    const o2 = run("backup-offsite.mjs", good, { FLAVIE_BACKUP_NOW: T1, FLAVIE_OFFSITE_DIR: goodOff }, ["--include-partial"])
    ok("A) 일부러 고르면(--include-partial) 부분 백업도 옮기되 status: partial 표시가 그대로다", manifestOf(goodOff, NAME1)?.status === "partial" && o2.status === 3)
    const allow = open(join(good, NAME1), join(work, "good-open-partial"), { args: ["--allow-partial"] })
    ok("A) 부분 백업은 일부러 고를 때만(--allow-partial) 풀리고, 부분이라고 알려 준다", allow.status === 0 && /부분 백업/.test(allow.out) && existsSync(join(work, "good-open-partial", "data.json")))
    rmSync(join(work, "good-open-partial"), { recursive: true, force: true })
  }

  // ── B) R4-04 풀기 전 완전성 확인
  const src = join(good, NAME0)
  const variant = (label, change, opts = {}) => {
    const dir = join(work, `b-${label}`), out = join(work, `b-${label}-out`)
    cpSync(src, dir, { recursive: true })
    change(dir)
    const r = open(dir, out, opts)
    return { ...r, dir }
  }
  const editManifest = (dir, fn) => { const f = join(dir, "manifest.json"); const m = JSON.parse(readFileSync(f, "utf8")); fn(m); writeFileSync(f, JSON.stringify(m)) }
  const firstPhoto = readdirSync(join(src, "files")).sort()[0]
  const bad = (label, r) => ok(`B) ${label} → 종료 코드 0이 아니고 평문 0개`, r.status !== 0 && r.status !== null && r.files === 0)
  ok("B) 대조: 손대지 않은 정상 백업은 그대로 풀린다(자료·스키마·사진 4장)", (() => { const r = variant("ok", () => {}); return r.status === 0 && r.files === 6 })())
  rmSync(join(work, "b-ok-out"), { recursive: true, force: true })
  bad("data.json.enc만 삭제", variant("no-data", (d) => rmSync(join(d, "data.json.enc"))))
  bad("schema.json.enc만 삭제", variant("no-schema", (d) => rmSync(join(d, "schema.json.enc"))))
  bad("index.json.enc만 삭제(예전 형식으로 넘어가지 않음)", variant("no-index", (d) => rmSync(join(d, "index.json.enc"))))
  bad("사진 파일 하나 누락", variant("no-photo", (d) => rmSync(join(d, "files", firstPhoto))))
  bad("사진 파일 잘림", variant("cut-photo", (d) => truncateSync(join(d, "files", firstPhoto), 100)))
  bad("자료 파일 잘림", variant("cut-data", (d) => truncateSync(join(d, "data.json.enc"), 40)))
  bad("다른 키", variant("other-key", () => {}, { keyHex: K2 }))
  bad("다른 키(manifest의 키 번호를 지워도)", variant("other-key2", (d) => editManifest(d, (m) => { delete m.encryption }), { keyHex: K2 }))
  bad("manifest의 파일 수가 목록과 다름", variant("count", (d) => editManifest(d, (m) => { m.files = 3 })))
  bad("목록에 없는 사진 파일이 끼어 있음", variant("extra", (d) => writeFileSync(join(d, "files", "000099.enc"), encrypt(key1, Buffer.from("x")))))
  bad("자료 파일을 다른 백업의 것으로 바꿈(같은 키 · 봉인된 지문과 다름)", variant("swap-data", (d) => writeFileSync(join(d, "data.json.enc"), encrypt(key1, Buffer.from("{}")))))
  bad("형식 표시를 지워 예전 형식인 척(목록 파일이 있는데 형식 값 없음)", variant("no-format", (d) => editManifest(d, (m) => { delete m.format })))
  {
    // 부분 백업의 manifest만 complete로 고쳐도(봉인된 목록과 어긋남) 거절
    const dir = join(work, "b-forged"), out = join(work, "b-forged-out")
    cpSync(join(good, NAME1), dir, { recursive: true })
    editManifest(dir, (m) => { m.status = "complete"; for (const b of Object.values(m.photos)) { b.failed = 0; delete b.error } })
    bad("부분 백업의 manifest만 ‘complete’로 고침", open(dir, out))
  }
  {
    // E03 그대로: 형식 2 manifest + 정상 암호화된 빈 목록만(자료·스키마 없음)
    const dir = join(work, "b-e03"), out = join(work, "b-e03-out")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ format: 2, files: 0, encryption: { alg: "aes-256-gcm", keyId: loadKey().keyId } }))
    writeFileSync(join(dir, "index.json.enc"), encrypt(key1, Buffer.from("[]")))
    const r = open(dir, out)
    ok("B) E03: 형식 2인데 자료·스키마가 없는 백업 → ‘0개 파일을 풀었어요’가 아니라 종료 코드 1", r.status === 1 && r.files === 0 && !/0개 파일을 풀었어요/.test(r.out))
  }
  {
    // 형식 2(11-06 판이 만든 백업)의 정상본은 계속 풀린다 · 형식 2에서 사진 실패 기록이 있으면 부분으로 본다
    const dir = join(work, "b-v2"), out = join(work, "b-v2-out"), photo = Buffer.from("PLAINTEXT-PHOTO v2")
    mkdirSync(join(dir, "files"), { recursive: true })
    writeFileSync(join(dir, "data.json.enc"), encrypt(key1, Buffer.from(JSON.stringify({ profiles: [] }))))
    writeFileSync(join(dir, "schema.json.enc"), encrypt(key1, Buffer.from("{}")))
    writeFileSync(join(dir, "files", "000001.enc"), encrypt(key1, photo))
    writeFileSync(join(dir, "index.json.enc"), encrypt(key1, Buffer.from(JSON.stringify([{ bucket: "application-photos", path: "u1/a.jpg", file: "files/000001.enc", bytes: photo.length, sha256: sha(photo) }]))))
    const m = { format: 2, files: 1, photos: { "application-photos": { saved: 1, failed: 0, mismatched: 0 }, "letter-photos": { saved: 0, failed: 0, mismatched: 0 } }, encryption: { alg: "aes-256-gcm", keyId: loadKey().keyId } }
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(m))
    const r = open(dir, out)
    ok("B) 형식 2 정상본은 그대로 풀린다(호환)", r.status === 0 && readFileSync(join(out, "application-photos", "u1", "a.jpg")).equals(photo))
    rmSync(out, { recursive: true, force: true })
    m.photos["letter-photos"].failed = 2
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(m))
    bad("형식 2에서 사진 실패 기록이 있는 백업(옛 판이 ‘끝남’으로 남긴 것)", open(dir, out))
  }
  ok("B) 이 구간에서 풀어 둔 폴더에 평문이 남지 않았다", ["no-data", "no-schema", "no-index", "no-photo", "cut-photo", "cut-data", "other-key", "count", "extra", "swap-data", "no-format"].every((l) => walk(join(work, `b-${l}-out`)).length === 0))

  // ── C) R4-05 만료 시각과 실행 주기
  {
    const BORN = "2026-10-20T03:00:00Z" // 10/20 12:00 KST 생성(검수 예시)
    const day9 = (d) => `2026-11-${String(d).padStart(2, "0")}T00:00:00Z` // 그날 09:00 KST(매일 실행 시각)
    const root = join(work, "c1"), off = join(work, "c1-off")
    const b = run("backup.mjs", root, { FLAVIE_BACKUP_NOW: BORN, FLAVIE_OFFSITE_DIR: off })
    const m = manifestOf(root, "2026-10-20_120000")
    ok("C) manifest: 지우기 시작(expiresAt)은 만든 지 29일, 약속한 기한(mustBeGoneBy)은 30일", b.status === 0 && Date.parse(m?.expiresAt) - Date.parse(m?.at) === 29 * 86400000 && Date.parse(m?.mustBeGoneBy) - Date.parse(m?.at) === 30 * 86400000)
    run("backup-offsite.mjs", root, { FLAVIE_BACKUP_NOW: BORN, FLAVIE_OFFSITE_DIR: off })
    const fresh = (now) => run("backup-deletions.mjs", root, { FLAVIE_BACKUP_NOW: new Date(Date.parse(now) - 600000).toISOString(), FLAVIE_OFFSITE_DIR: off }) // 삭제 이력은 매일 갱신되고 있다고 둔다
    fresh(day9(18))
    const d18 = run("backup-expire.mjs", root, { FLAVIE_BACKUP_NOW: day9(18), FLAVIE_OFFSITE_DIR: off })
    ok("C) 11/18 09:00(28일 21시간): 아직 지우지 않는다", d18.status === 0 && folders(root).length === 1 && folders(off).length === 1)
    fresh(day9(19))
    const d19 = run("backup-expire.mjs", root, { FLAVIE_BACKUP_NOW: day9(19), FLAVIE_OFFSITE_DIR: off })
    ok("C) 11/19 09:00(29일 21시간 · 약속 기한 11/19 12:00 전): 매일 실행만으로 로컬·바깥 사본을 기한 안에 지운다", d19.status === 0 && folders(root).length === 0 && folders(off).length === 0)
    ok("C) 기한 안에 지웠으므로 ‘늦게 지움’ 기록이 없다", !logOf(root).some((l) => l.job === "backup-expire" && (l.late ?? 0) > 0))
  }
  {
    // 컴퓨터가 이틀 꺼져 있었음: 11/19·11/20 차례를 놓치고 11/21 09:00에 처음 실행
    const BORN = "2026-10-20T03:00:00Z", root = join(work, "c2"), off = join(work, "c2-off")
    run("backup.mjs", root, { FLAVIE_BACKUP_NOW: BORN, FLAVIE_OFFSITE_DIR: off })
    run("backup-offsite.mjs", root, { FLAVIE_BACKUP_NOW: BORN, FLAVIE_OFFSITE_DIR: off })
    const r = run("backup-expire.mjs", root, { FLAVIE_BACKUP_NOW: "2026-11-21T00:00:00Z", FLAVIE_OFFSITE_DIR: off })
    const last = logOf(root).filter((l) => l.job === "backup-expire").at(-1)
    ok("C) 컴퓨터가 이틀 꺼져 있었으면: 켜진 뒤 첫 실행에서 바로 지운다", folders(root).length === 0 && folders(off).length === 0)
    ok("C) 약속한 30일을 넘겨 지운 사실을 기록에 남긴다(몇 개 · 얼마나 늦었는지)", last?.late === 2 && last?.lateHoursMax >= 44 && last?.lateHoursMax <= 46)
    ok("C) 늦게 지운 사실을 바탕 화면 안내 파일과 서버 기록에도 남긴다", /30일을 넘겨/.test(read(join(`${root}-warn`, "플라비 백업 확인 필요.txt"))) && /"late":2/.test(read(`${root}-report.log`)))
    ok("C) 늦게 지웠으면 종료 코드도 0이 아니다(스케줄러에서 보이게)", r.status !== 0)
  }
  {
    // .part: ‘지울 수 있게 된 시각’과 ‘실제로 지운 시각’을 따로 기록
    const root = join(work, "c3"), off = join(work, "c3-off"), folder = join(root, "2026-11-02_120000")
    mkdirSync(folder, { recursive: true }); mkdirSync(off, { recursive: true })
    const part = join(folder, "data.json.enc.part")
    writeFileSync(part, encrypt(key1, Buffer.from("x")))
    const wrote = new Date("2026-11-02T03:00:00Z"); utimesSync(part, wrote, wrote)
    const early = run("backup-expire.mjs", root, { FLAVIE_BACKUP_NOW: "2026-11-02T03:30:00Z", FLAVIE_OFFSITE_DIR: off })
    ok("C) .part는 1시간이 되기 전에는 지우지 않는다", existsSync(part) && early.status === 0)
    run("backup-expire.mjs", root, { FLAVIE_BACKUP_NOW: "2026-11-03T00:00:00Z", FLAVIE_OFFSITE_DIR: off })
    const entry = logOf(root).filter((l) => l.job === "backup-expire").at(-1)?.partFiles?.[0]
    ok("C) .part를 지울 때 자격 시각(쓴 지 1시간)과 실제 삭제 시각(다음 실행)을 따로 남긴다", !existsSync(part) && entry?.eligibleAt === "2026-11-02T04:00:00.000Z" && entry?.removedAt === "2026-11-03T00:00:00.000Z")
  }
  {
    // 삭제 이력이 하루 넘게 갱신되지 않으면 만료 정리가 알려 준다(복구 때 필요한 ‘최신’이 낡지 않게)
    const root = join(work, "c4"), off = join(work, "c4-off")
    run("backup.mjs", root, { FLAVIE_BACKUP_NOW: T0, FLAVIE_OFFSITE_DIR: off })
    run("backup-deletions.mjs", root, { FLAVIE_BACKUP_NOW: T0, FLAVIE_OFFSITE_DIR: off })
    run("backup-offsite.mjs", root, { FLAVIE_BACKUP_NOW: T0, FLAVIE_OFFSITE_DIR: off })
    const soon = run("backup-expire.mjs", root, { FLAVIE_BACKUP_NOW: "2026-11-03T02:00:00Z", FLAVIE_OFFSITE_DIR: off })
    const stale = run("backup-expire.mjs", root, { FLAVIE_BACKUP_NOW: "2026-11-04T03:00:00Z", FLAVIE_OFFSITE_DIR: off })
    ok("C) 삭제 이력이 23시간 전 것이면 괜찮다", soon.status === 0)
    ok("C) 삭제 이력이 48시간 동안 갱신되지 않으면 종료 코드 1 · 안내", stale.status === 1 && /삭제 이력/.test(read(join(`${root}-warn`, "플라비 백업 확인 필요.txt"))))
  }

  // ── D) R4-06 복구 전 확인: 삭제 이력의 신선도
  {
    const root = join(work, "d1"), off = join(work, "d1-off")
    run("backup.mjs", root, { FLAVIE_BACKUP_NOW: T0, FLAVIE_OFFSITE_DIR: off })
    run("backup-deletions.mjs", root, { FLAVIE_BACKUP_NOW: "2026-11-03T00:10:00Z", FLAVIE_OFFSITE_DIR: off }) // 11/3 09:10 KST 추출
    run("backup-offsite.mjs", root, { FLAVIE_BACKUP_NOW: "2026-11-03T00:10:00Z", FLAVIE_OFFSITE_DIR: off })
    const check = (args, extra = {}) => { const r = spawnSync(process.execPath, [join(code, "scripts", "backup-restore-check.mjs"), off, ...args], { env: { ...process.env, FLAVIE_BACKUP_KEY: K1, ...extra }, encoding: "utf8" }); let v = null; try { v = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"), r.stdout.lastIndexOf("}") + 1)) } catch { /* 판정이 없으면 null */ } return { status: r.status, v, out: r.stdout + r.stderr } }
    const hold = check(["--lost-at", "2026-11-03T08:00:00Z"]) // 추출 뒤 7시간 50분 지나 원본을 잃음
    ok("D) 삭제 이력 추출 뒤에 원본을 잃었으면: 회원 접근을 열지 않는다(종료 코드 4 · memberAccess: closed)", hold.status === 4 && hold.v?.memberAccess === "closed" && hold.v?.unclearMinutes === 470)
    ok("D) 판정에 어느 백업·어느 삭제 이력을 썼는지와 불명확한 기간이 적혀 있다", hold.v?.backup === NAME0 && /^deletions_2026-11-03_091000/.test(hold.v?.deletions ?? "") && hold.v?.unclearFrom === "2026-11-03T00:10:00.000Z" && hold.v?.unclearTo === "2026-11-03T08:00:00.000Z")
    const short = check(["--lost-at", "2026-11-03T00:10:20Z"])
    ok("D) 불명확한 기간이 20초뿐이어도 0분으로 내리지 않고 닫아 둔다(1분으로 올려 셈)", short.status === 4 && short.v?.unclearMinutes === 1)
    const unknown = check([])
    ok("D) 원본을 잃은 때를 모르면(--lost-at 없음) 지금까지를 불명확 기간으로 보고 닫아 둔다", unknown.status === 4 && unknown.v?.memberAccess === "closed")
    const planned = check(["--lost-at", "2026-11-03T00:05:00Z"])
    ok("D) 삭제 이력이 원본을 멈춘 뒤에 추출된 것이면(계획된 이전): 열어도 된다(종료 코드 0)", planned.status === 0 && planned.v?.memberAccess === "open" && planned.v?.unclearMinutes === 0)
    const forced = check(["--lost-at", "2026-11-03T08:00:00Z", "--confirmed", "운영 메일함에서 그 기간 탈퇴 요청이 없음을 확인"])
    ok("D) 그 기간을 다른 기록으로 확인했다고 이유를 적어야만 열림으로 바뀌고, 이유가 판정에 남는다", forced.status === 0 && forced.v?.memberAccess === "open" && /운영 메일함/.test(forced.v?.confirmed ?? "") && check(["--lost-at", "2026-11-03T08:00:00Z", "--confirmed", "짧음"]).status !== 0)
    ok("D) 다른 키로는 판정하지 않는다(종료 코드 1)", check(["--lost-at", "2026-11-03T08:00:00Z"], { FLAVIE_BACKUP_KEY: K2 }).status === 1)
    // 삭제 이력이 하나도 없는 바깥 사본
    const off2 = join(work, "d2-off"); cpSync(off, off2, { recursive: true }); rmSync(join(off2, "삭제 이력"), { recursive: true, force: true })
    const none = spawnSync(process.execPath, [join(code, "scripts", "backup-restore-check.mjs"), off2, "--lost-at", "2026-11-03T08:00:00Z"], { env: { ...process.env, FLAVIE_BACKUP_KEY: K1 }, encoding: "utf8" })
    ok("D) 삭제 이력 파일이 하나도 없으면 닫아 둔다(백업 시각부터 불명확)", none.status === 4 && /"memberAccess": ?"closed"/.test(none.stdout))
    // 정상 백업이 없고 부분 백업뿐인 바깥 사본
    const off3 = join(work, "d3-off"); mkdirSync(off3, { recursive: true }); cpSync(join(good, NAME1), join(off3, NAME1), { recursive: true })
    const partialOnly = spawnSync(process.execPath, [join(code, "scripts", "backup-restore-check.mjs"), off3], { env: { ...process.env, FLAVIE_BACKUP_KEY: K1 }, encoding: "utf8" })
    ok("D) 부분 백업뿐이면 ‘복구 지점 없음’(종료 코드 1)", partialOnly.status === 1 && /정상 백업이 없어요/.test(partialOnly.stdout + partialOnly.stderr))
    // 가장 최근 폴더가 손상(자료 파일 없음)이면 그 앞의 정상 백업을 고른다
    const off4 = join(work, "d4-off"); cpSync(off, off4, { recursive: true }); cpSync(join(off, NAME0), join(off4, NAME1), { recursive: true }); rmSync(join(off4, NAME1, "data.json.enc"))
    const skip = spawnSync(process.execPath, [join(code, "scripts", "backup-restore-check.mjs"), off4, "--lost-at", "2026-11-03T00:05:00Z"], { env: { ...process.env, FLAVIE_BACKUP_KEY: K1 }, encoding: "utf8" })
    ok("D) 가장 최근 폴더가 손상됐으면 건너뛰고 그 앞의 정상 백업을 복구 지점으로 고른다(건너뛴 이유 표시)", skip.status === 0 && new RegExp(`"backup": ?"${NAME0}"`).test(skip.stdout) && /"skipped"/.test(skip.stdout))
  }
  ok("실제 키 파일은 건드리지 않았다(있으면 수정 시각 그대로)", realKeyBefore === (existsSync(realKeyFile) ? statSync(realKeyFile).mtimeMs : null))
} catch (error) {
  failed++
  console.log("✗ 시험이 중간에 멈췄어요:", String(error?.stack ?? error).split("\n").slice(0, 3).join(" | "))
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(failed ? `백업 완전성 시험: 통과 ${passed}개 · 실패 ${failed}개` : `백업 완전성 시험 통과: ${passed}개`)
process.exit(failed ? 1 : 0)
