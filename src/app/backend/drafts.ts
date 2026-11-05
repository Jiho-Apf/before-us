// 쓰다 만 편지·첫 장면 답(보내기 전 초안): 이 기기에 회원별로 잠시 둔다(검수 C10).
//  - 키: flavie:draft:v2:{회원 id}:{교류 id}:{날}:{종류}. 같은 교류의 두 분이 같은 브라우저를 써도 섞이지 않는다.
//  - 값: { ownerId, body, savedAt, expiresAt }. 읽을 때 주인과 기한을 확인하고, 맞지 않으면 지운다.
//  - 기한: 마지막으로 쓴 때부터 14일(교류 3일 + 만남까지 여유, 마무리 뒤 30일 안). 로그아웃·탈퇴·교류 마무리 때도 지운다.
//  - 예전 키(before-us:letter-draft:…)는 어느 계정의 글인지 알 수 없어 되살리지 않고 지운다.
const PREFIX = "flavie:draft:v2:"
const LEGACY = "before-us:letter-draft:"
const KEEP_MS = 14 * 86400000
type DraftRecord = { ownerId: string; body: string; savedAt: number; expiresAt: number }

let owner: string | null = null
export const setDraftOwner = (id: string | null) => { owner = id }

const storage = () => { try { return typeof window === "undefined" ? null : window.localStorage } catch { return null } }
const keys = (store: Storage) => Array.from({ length: store.length }, (_, index) => store.key(index)).filter((key): key is string => !!key)

function purgeLegacy() {
  const store = storage()
  if (!store) return
  try { keys(store).filter(key => key.startsWith(LEGACY)).forEach(key => store.removeItem(key)) } catch { /* 저장 공간을 못 쓰면 그대로 */ }
}
purgeLegacy()

// 화면에서 쓰는 키(교류 id:날:종류)를 저장 키로 바꾼다. 로그인한 회원이 없으면 저장하지 않는다.
const storeKey = (key: string) => owner ? `${PREFIX}${owner}:${key}` : null

export function readDraft(key: string, now = Date.now()): string {
  const store = storage(), full = storeKey(key)
  if (!store || !full) return ""
  try {
    const raw = store.getItem(full)
    if (!raw) return ""
    const record = JSON.parse(raw) as Partial<DraftRecord>
    if (record.ownerId !== owner || typeof record.body !== "string" || typeof record.expiresAt !== "number" || record.expiresAt <= now) { store.removeItem(full); return "" }
    return record.body
  } catch {
    try { store.removeItem(full) } catch { /* 무시 */ }
    return ""
  }
}

// 저장에 실패하면 false(저장 공간이 막힌 기기). 화면은 그대로 쓰되 ‘이 기기에 저장됨’이라고 하지 않는다.
export function writeDraft(key: string, value: string, now = Date.now()): boolean {
  const store = storage(), full = storeKey(key)
  if (!store || !full) return false
  try {
    if (!value.trim()) { store.removeItem(full); return true }
    const record: DraftRecord = { ownerId: owner!, body: value, savedAt: now, expiresAt: now + KEEP_MS }
    store.setItem(full, JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

export function clearDraft(key: string) {
  const store = storage(), full = storeKey(key)
  if (!store || !full) return
  try { store.removeItem(full) } catch { /* 무시 */ }
}

// 지우기: 회원 하나(로그아웃·탈퇴) · 교류 하나(마무리) · 기한 지난 것
// 회원 하나를 지울 때는 제출 전 고친 신청서(before-us:pending-edit:{회원 id})도 함께 지운다(같은 기기를 다른 사람이 쓸 수 있어서).
export function clearDrafts(filter: { ownerId?: string | null; programId?: string } = {}) {
  const store = storage()
  if (!store) return
  try {
    for (const key of keys(store)) {
      if (!key.startsWith(PREFIX)) continue
      const [ownerId, programId] = key.slice(PREFIX.length).split(":")
      if (filter.ownerId && ownerId !== filter.ownerId) continue
      if (filter.programId && programId !== filter.programId) continue
      store.removeItem(key)
    }
    if (filter.ownerId && !filter.programId) store.removeItem(`before-us:pending-edit:${filter.ownerId}`)
  } catch { /* 무시 */ }
}
export function clearExpiredDrafts(now = Date.now()) {
  const store = storage()
  if (!store) return
  try {
    for (const key of keys(store)) {
      if (!key.startsWith(PREFIX)) continue
      try { const record = JSON.parse(store.getItem(key) ?? "null") as Partial<DraftRecord> | null; if (!record || typeof record.expiresAt !== "number" || record.expiresAt <= now) store.removeItem(key) } catch { store.removeItem(key) }
    }
  } catch { /* 무시 */ }
}
clearExpiredDrafts()
