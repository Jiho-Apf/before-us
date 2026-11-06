// 백업 풀기: `npm run backup:open -- <백업 폴더> <풀어 둘 폴더>`
// 암호화된 백업(.enc)을 풀어 둘 폴더에 원래 이름으로 꺼낸다. 복구가 끝나면 풀어 둔 폴더는 바로 지운다(평문이라서).
//  - 형식 2(2026-11-06~): files/000001.enc + index.json.enc(원래 버킷·경로·지문) → <풀어 둘 폴더>/<버킷>/<경로>
//  - 예전 형식: 경로 그대로의 .enc
//  - 끝나지 않은 암호문 임시 파일(.part)은 건너뛴다. 하나라도 풀리지 않으면(키·변조·잘림) 아무것도 꺼내지 않는다.
//  - 재해 복구에서는 평문을 디스크에 꺼내지 않고 scripts/backup-dr-rehearsal.mjs 처럼 메모리에서 바로 넣는 방법을 먼저 쓴다.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join, relative } from "node:path"
import { decrypt, loadKey } from "./backup-crypto.mjs"

const [from, to] = process.argv.slice(2)
if (!from || !to) { console.error("사용법: npm run backup:open -- <백업 폴더> <풀어 둘 폴더>"); process.exit(1) }
const { key, keyId } = loadKey()
const manifest = JSON.parse(readFileSync(join(from, "manifest.json"), "utf8"))
if (manifest.encryption?.keyId && manifest.encryption.keyId !== keyId) { console.error(`이 백업은 다른 키(${manifest.encryption.keyId})로 잠겨 있어요. 지금 키: ${keyId}`); process.exit(1) }
const walk = (dir) => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path] })
const files = walk(from).filter((path) => path.endsWith(".enc"))
// 먼저 모두 풀리는지 확인한 뒤에 꺼낸다(중간에 손상된 파일이 있으면 평문을 하나도 남기지 않는다).
const opened = new Map()
for (const file of files) {
  try { opened.set(file, decrypt(key, readFileSync(file))) } catch (error) { console.error(`${relative(from, file)}: ${error.message} 아무 파일도 풀지 않았어요.`); process.exit(1) }
}
const outputs = []
const indexFile = join(from, "index.json.enc")
if (existsSync(indexFile)) {
  const index = JSON.parse(opened.get(indexFile).toString())
  for (const item of index) {
    const bytes = opened.get(join(from, item.file))
    if (!bytes) { console.error(`목록에 있는 사진 파일이 없어요: ${item.file} · 아무 파일도 풀지 않았어요.`); process.exit(1) }
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) { console.error(`사진 지문이 달라요: ${item.file} · 아무 파일도 풀지 않았어요.`); process.exit(1) }
    outputs.push([join(to, item.bucket, ...item.path.split("/")), bytes])
  }
  for (const name of ["data.json.enc", "schema.json.enc"]) if (opened.has(join(from, name))) outputs.push([join(to, name.replace(/\.enc$/, "")), opened.get(join(from, name))])
} else {
  for (const [file, bytes] of opened) outputs.push([join(to, relative(from, file).replace(/\.enc$/, "")), bytes])
}
for (const [out, bytes] of outputs) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, bytes) }
console.log(`${outputs.length}개 파일을 풀었어요 · ${to}\n자료를 넣은 뒤 최신 삭제 이력으로 select public.apply_deletion_log(); 를 꼭 실행하고, 풀어 둔 폴더는 지워 주세요.`)
