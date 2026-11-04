// 백업 풀기: `node scripts/backup-open.mjs <백업 폴더> <풀어 둘 폴더>`
// 암호화된 백업(.enc)을 풀어 둘 폴더에 원래 이름으로 꺼낸다. 복구가 끝나면 풀어 둔 폴더는 바로 지운다(평문이라서).
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { decrypt, loadKey } from "./backup-crypto.mjs"

const [from, to] = process.argv.slice(2)
if (!from || !to) { console.error("사용법: node scripts/backup-open.mjs <백업 폴더> <풀어 둘 폴더>"); process.exit(1) }
const { key, keyId } = loadKey()
const manifest = JSON.parse(readFileSync(join(from, "manifest.json"), "utf8"))
if (manifest.encryption?.keyId && manifest.encryption.keyId !== keyId) { console.error(`이 백업은 다른 키(${manifest.encryption.keyId})로 잠겨 있어요. 지금 키: ${keyId}`); process.exit(1) }
const walk = (dir) => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path] })
let opened = 0
for (const file of walk(from).filter((path) => path.endsWith(".enc"))) {
  const out = join(to, relative(from, file).replace(/\.enc$/, ""))
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, decrypt(key, readFileSync(file)))
  opened++
}
console.log(`${opened}개 파일을 풀었어요 · ${to}\n자료를 넣은 뒤 select public.apply_deletion_log(); 를 꼭 실행하고, 풀어 둔 폴더는 지워 주세요.`)
