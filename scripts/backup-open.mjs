// 백업 풀기: `npm run backup:open -- <백업 폴더> <풀어 둘 폴더> [--allow-partial]`
// 암호화된 백업(.enc)을 풀어 둘 폴더에 원래 이름으로 꺼낸다. 복구가 끝나면 풀어 둔 폴더는 바로 지운다(평문이라서).
//  - 꺼내기 전에 메모리에서 먼저 완전한지 확인한다(GPT 4차 R4-04 · scripts/backup-lib.mjs verifyBackup):
//      · 형식 2·3: 자료(data)·스키마(schema)·목록(index) 세 파일이 모두 있어야 한다. 하나라도 없으면 ‘0개를 풀었어요’가 아니라 실패다.
//      · 형식 3: 암호문 안에 봉인된 자료·스키마 지문, 사진 목록·개수·지문, 상태가 manifest·실제 파일과 같아야 한다.
//      · 목록(index)이 없다고 예전 형식으로 넘어가지 않는다. 예전 형식인지는 manifest 의 형식 값으로만 판단한다.
//      · 부분 백업(사진을 다 받지 못한 백업)은 풀지 않는다. 일부러 살릴 때만 --allow-partial.
//      · 하나라도 어긋나면(다른 키·잘림·누락·불일치) 종료 코드 1, 평문은 한 바이트도 쓰지 않는다.
//  - 형식 2·3: files/000001.enc + index.json.enc(원래 버킷·경로·지문) → <풀어 둘 폴더>/<버킷>/<경로>
//  - 예전 형식(2026-11-05 이전): 경로 그대로의 .enc
//  - 재해 복구에서는 먼저 `npm run backup:restore-check`로 복구 지점과 삭제 이력을 확인하고,
//    평문을 디스크에 꺼내지 않고 scripts/backup-dr-rehearsal.mjs 처럼 메모리에서 바로 넣는 방법을 먼저 쓴다.
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { loadKey } from "./backup-crypto.mjs"
import { verifyBackup } from "./backup-lib.mjs"

const args = process.argv.slice(2)
const allowPartial = args.includes("--allow-partial")
const [from, to] = args.filter((a) => !a.startsWith("--"))
if (!from || !to) { console.error("사용법: npm run backup:open -- <백업 폴더> <풀어 둘 폴더> [--allow-partial]"); process.exit(1) }
let checked
try {
  const { key, keyId } = loadKey()
  checked = verifyBackup(from, key, keyId, { allowPartial })
} catch (error) {
  console.error(`${String(error?.message ?? error).split(/\r?\n/)[0]}\n아무 파일도 풀지 않았어요.`)
  process.exit(1)
}
const outputs = []
if (checked.legacy) {
  for (const [name, bytes] of checked.files) outputs.push([join(to, ...name.replace(/\.enc$/, "").split("/")), bytes])
} else {
  for (const item of checked.items) outputs.push([join(to, item.bucket, ...item.path.split("/")), item.bytes])
  outputs.push([join(to, "data.json"), checked.data], [join(to, "schema.json"), checked.schema])
}
for (const [out, bytes] of outputs) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, bytes) }
if (checked.status === "partial") console.log("주의: 부분 백업을 일부러 풀었어요. 사진이 빠져 있어요. 정상 복구 지점이 아니에요.")
console.log(`${outputs.length}개 파일을 풀었어요 · ${to}\n자료를 넣은 뒤 최신 삭제 이력으로 select public.apply_deletion_log(); 를 꼭 실행하고, 풀어 둔 폴더는 지워 주세요.`)
