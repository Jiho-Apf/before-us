import { useSyncExternalStore } from "react"
import { BEFORE_US } from "./config"
import { submitMemberRequest } from "./member-operations-model"

// 계정(회원가입·로그인·비밀번호 재설정·탈퇴).
// 지금은 탭 메모리에서만 동작하는 데모 구현이다. 서버(Supabase Auth)를 붙일 때 이 파일의 함수 이름과 반환 모양을
// 그대로 두고 내부만 바꾼다(signUp → auth.signUp, signIn → auth.signInWithPassword, requestPasswordReset →
// auth.resetPasswordForEmail, resetPassword → auth.updateUser, withdraw → 서버 함수로 탈퇴 요청 + 세션 종료).
// 비밀번호는 데모에서도 원문을 저장하지 않고 SHA-256 해시만 남긴다(실서버에서는 Supabase가 bcrypt로 처리).

export type AuthUser = { id: string; email: string; createdAt: string; status: "active" | "withdrawal-requested"; deletionDueAt: string | null }
type Stored = AuthUser & { passwordHash: string; failed: number; lockedUntil: number | null }
type ResetToken = { token: string; email: string; expiresAt: number; used: boolean }

const users = new Map<string, Stored>()
const resetTokens = new Map<string, ResetToken>()
let session: AuthUser | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export const PASSWORD_RULE = "8자 이상, 영문과 숫자를 함께 써 주세요."
const LOCK_AFTER = 5
const LOCK_MINUTES = 5
const RESET_MINUTES = 30

const normalize = (email: string) => email.trim().toLowerCase()
const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
export const validPassword = (password: string) => password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password)
async function hash(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`before-us:${text}`))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}
const publicUser = (user: Stored): AuthUser => ({ id: user.id, email: user.email, createdAt: user.createdAt, status: user.status, deletionDueAt: user.deletionDueAt })
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("")

export async function signUp(input: { email: string; password: string; adult: boolean; terms: boolean; privacy: boolean }) {
  const email = normalize(input.email)
  if (!validEmail(email)) return { error: "이메일 주소를 확인해 주세요." }
  if (!validPassword(input.password)) return { error: `비밀번호는 ${PASSWORD_RULE}` }
  if (!input.adult) return { error: "만 19세 이상만 가입할 수 있어요." }
  if (!input.terms || !input.privacy) return { error: "이용약관과 개인정보 수집·이용에 동의해 주세요." }
  if (users.has(email)) return { error: "이미 가입된 이메일이에요. 로그인하거나 비밀번호를 다시 설정해 주세요." }
  const user: Stored = { id: `member-${randomToken().slice(0, 8)}`, email, createdAt: new Date().toISOString(), status: "active", deletionDueAt: null, passwordHash: await hash(input.password), failed: 0, lockedUntil: null }
  users.set(email, user)
  session = publicUser(user)
  emit()
  return { error: null }
}

export async function signIn(emailInput: string, password: string, now = Date.now()) {
  const email = normalize(emailInput)
  const user = users.get(email)
  // 가입 여부를 알려 주지 않도록, 없는 계정과 틀린 비밀번호는 같은 문구를 쓴다.
  const wrong = { error: "이메일 또는 비밀번호가 맞지 않아요." }
  if (!user) return wrong
  if (user.lockedUntil && now < user.lockedUntil) return { error: `로그인 시도가 많아 ${LOCK_MINUTES}분 동안 잠겼어요. 잠시 뒤 다시 시도하거나 비밀번호를 다시 설정해 주세요.` }
  if (user.passwordHash !== (await hash(password))) {
    user.failed += 1
    if (user.failed >= LOCK_AFTER) { user.lockedUntil = now + LOCK_MINUTES * 60000; user.failed = 0 }
    return wrong
  }
  if (user.status === "withdrawal-requested") return { error: "탈퇴를 요청한 계정이에요. 다시 이용하려면 문의하기로 남겨 주세요." }
  user.failed = 0; user.lockedUntil = null
  session = publicUser(user)
  emit()
  return { error: null }
}

export function signOut() { session = null; emit() }

// 가입 여부와 관계없이 같은 안내를 보여 준다. 데모에서는 메일 대신 화면에 재설정 링크를 돌려준다(devLink).
export function requestPasswordReset(emailInput: string, now = Date.now()) {
  const email = normalize(emailInput)
  if (!validEmail(email)) return { error: "이메일 주소를 확인해 주세요.", devLink: null }
  let devLink: string | null = null
  if (users.has(email)) {
    const token = randomToken()
    resetTokens.set(token, { token, email, expiresAt: now + RESET_MINUTES * 60000, used: false })
    devLink = `/reset-password?token=${token}`
  }
  return { error: null, devLink }
}

export async function resetPassword(token: string, password: string, now = Date.now()) {
  const record = resetTokens.get(token)
  if (!record || record.used || now > record.expiresAt) return { error: "링크가 만료됐거나 이미 사용됐어요. 다시 요청해 주세요." }
  if (!validPassword(password)) return { error: `비밀번호는 ${PASSWORD_RULE}` }
  const user = users.get(record.email)
  if (!user) return { error: "링크가 만료됐거나 이미 사용됐어요. 다시 요청해 주세요." }
  user.passwordHash = await hash(password); user.failed = 0; user.lockedUntil = null
  record.used = true
  // 다른 기기의 로그인도 끊는 것이 원칙이라, 데모에서도 세션을 비운다.
  session = null
  emit()
  return { error: null }
}

// 탈퇴: 비밀번호를 다시 확인한 뒤 탈퇴 요청을 기록하고 바로 로그아웃한다. 상대 노출·알림은 즉시 멈추고,
// 일반 자료는 개인정보 기준(activeDeleteDays) 안에 지운다. 운영 기록 쪽 처리는 기존 ‘회원 탈퇴’ 요청 흐름을 그대로 쓴다.
export async function withdraw(password: string, now = new Date()) {
  if (!session) return { error: "로그인한 뒤 진행해 주세요." }
  const user = users.get(session.email)
  if (!user || user.passwordHash !== (await hash(password))) return { error: "비밀번호가 맞지 않아요." }
  user.status = "withdrawal-requested"
  user.deletionDueAt = new Date(now.getTime() + BEFORE_US.privacy.activeDeleteDays * 86400000).toISOString()
  submitMemberRequest({ memberId: "current-member", surface: "account" }, "withdrawal", { confirmed: true, description: "계정 화면에서 탈퇴 요청" }, now)
  session = null
  emit()
  return { error: null, deletionDueAt: user.deletionDueAt }
}

export function useAuth() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => session, () => session)
}
