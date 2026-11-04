// 백업 암호화(GPT 검수 O2): AES-256-GCM. 키는 백업 폴더와 따로 둔다.
//  - 키 위치: 환경 변수 FLAVIE_BACKUP_KEY(64자리 16진수) 또는 내 사용자 폴더의 `.flavie\backup.key`(코드·백업 폴더 밖).
//  - 처음 실행하면 키 파일을 만들고 알려 준다. 같은 키를 비밀번호 관리자에도 보관해 둔다(키가 없으면 백업을 풀 수 없다).
//  - 파일 형식: "FLV1" 4바이트 · IV 12바이트 · 인증 태그 16바이트 · 암호문
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const MAGIC = Buffer.from("FLV1")
export const KEY_FILE = join(homedir(), ".flavie", "backup.key")

export function loadKey({ create = false } = {}) {
  const fromEnv = process.env.FLAVIE_BACKUP_KEY?.trim()
  let hex = fromEnv
  let created = false
  if (!hex && existsSync(KEY_FILE)) hex = readFileSync(KEY_FILE, "utf8").trim()
  if (!hex && create) {
    hex = randomBytes(32).toString("hex")
    mkdirSync(dirname(KEY_FILE), { recursive: true })
    writeFileSync(KEY_FILE, hex + "\n", { mode: 0o600 })
    created = true
  }
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`백업 키가 없어요. ${KEY_FILE} 파일이나 FLAVIE_BACKUP_KEY를 확인해 주세요.`)
  const key = Buffer.from(hex, "hex")
  return { key, keyId: createHash("sha256").update(key).digest("hex").slice(0, 8), created }
}

export function encrypt(key, plain) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body])
}

export function decrypt(key, sealed) {
  if (!sealed.subarray(0, 4).equals(MAGIC)) throw new Error("플라비 백업 파일이 아니에요.")
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(4, 16))
  decipher.setAuthTag(sealed.subarray(16, 32))
  return Buffer.concat([decipher.update(sealed.subarray(32)), decipher.final()])
}
