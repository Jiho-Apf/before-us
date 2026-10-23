import { useSyncExternalStore } from "react"
import { BEFORE_US } from "./config"
import { submitMemberRequest } from "./member-operations-model"
import { LANDING, LIVE, friendlyError, rpc, supabase } from "./backend/client"

// 계정(회원가입·로그인·비밀번호 재설정·탈퇴).
//  - 데모: 탭 메모리에서만 동작한다. 비밀번호는 원문 대신 SHA-256 해시만 남긴다.
//  - 실제 서버(LIVE): 같은 함수 이름과 반환 모양으로 Supabase Auth를 쓴다(비밀번호는 Supabase가 bcrypt로 처리).
//    가입 확인 메일 → /apply, 비밀번호 재설정 메일 → /reset-password?token=recovery 로 돌아온다.

export type AuthUser = { id: string; email: string; createdAt: string; status: "active" | "withdrawal-requested"; deletionDueAt: string | null }
type Stored = AuthUser & { passwordHash: string; failed: number; lockedUntil: number | null }
type ResetToken = { token: string; email: string; expiresAt: number; used: boolean }

const users = new Map<string, Stored>()
const resetTokens = new Map<string, ResetToken>()
const attempts = new Map<string, { failed: number; lockedUntil: number | null }>()
let session: AuthUser | null = null
let ready = !LIVE
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export const PASSWORD_RULE = "8자 이상, 영문과 숫자를 함께 써 주세요."
export const LEGAL_VERSION = LIVE && BEFORE_US.beta.active ? BEFORE_US.beta.legalVersion : "draft-2026-10-15"
const LOCK_AFTER = 5
const LOCK_MINUTES = 5
const RESET_MINUTES = 30
const WRONG = "이메일 또는 비밀번호가 맞지 않아요."
const LOCKED = `로그인 시도가 많아 ${LOCK_MINUTES}분 동안 잠겼어요. 잠시 뒤 다시 시도하거나 비밀번호를 다시 설정해 주세요.`
const WITHDRAWN = "탈퇴를 요청한 계정이에요. 다시 이용하려면 문의하기로 남겨 주세요."

const normalize = (email: string) => email.trim().toLowerCase()
const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
export const validPassword = (password: string) => password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password)
async function hash(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`before-us:${text}`))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}
const publicUser = (user: Stored): AuthUser => ({ id: user.id, email: user.email, createdAt: user.createdAt, status: user.status, deletionDueAt: user.deletionDueAt })
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("")

// 실제 서버: 로그인 상태가 바뀔 때마다 회원 상태(탈퇴 요청 여부)를 함께 읽는다.
if (LIVE) {
  void supabase().then(async (db) => {
    const apply = async (current: { user: { id: string; email?: string; created_at: string } } | null) => {
      if (!current) { session = null; ready = true; emit(); return }
      const { data } = await db.from("profiles").select("status, deletion_due_at").eq("id", current.user.id).maybeSingle()
      session = { id: current.user.id, email: current.user.email ?? "", createdAt: current.user.created_at, status: data?.status === "withdrawal_requested" ? "withdrawal-requested" : "active", deletionDueAt: data?.deletion_due_at ?? null }
      ready = true
      emit()
    }
    const { data } = await db.auth.getSession()
    readLinkReturn(!!data.session)
    await apply(data.session)
    // 콜백 안에서 바로 Supabase를 다시 부르면 멈출 수 있어 한 박자 뒤에 처리한다.
    db.auth.onAuthStateChange((_event, current) => { window.setTimeout(() => void apply(current), 0) })
  }).catch(() => { ready = true; emit() })
}

export async function signUp(input: { email: string; password: string; adult: boolean; terms: boolean; privacy: boolean }): Promise<{ error: string | null; confirm?: boolean }> {
  const email = normalize(input.email)
  if (!validEmail(email)) return { error: "이메일 주소를 확인해 주세요." }
  if (!validPassword(input.password)) return { error: `비밀번호는 ${PASSWORD_RULE}` }
  if (!input.adult) return { error: "만 19세 이상만 가입할 수 있어요." }
  if (!input.terms || !input.privacy) return { error: "이용약관과 개인정보 수집·이용에 동의해 주세요." }
  if (LIVE) {
    const db = await supabase()
    const { data, error } = await db.auth.signUp({ email, password: input.password, options: { emailRedirectTo: `${window.location.origin}/apply`, data: { adult: true, terms_version: LEGAL_VERSION, privacy_version: LEGAL_VERSION, marketing: false } } })
    if (error) return { error: /password/i.test(error.message) ? `비밀번호는 ${PASSWORD_RULE}` : /rate|too many/i.test(error.message) ? "잠시 뒤 다시 시도해 주세요." : friendlyError(error) }
    // 가입 여부를 알려 주지 않도록, 이미 가입된 이메일이어도 같은 안내(메일 확인)를 보여 준다.
    return { error: null, confirm: !data.session }
  }
  if (users.has(email)) return { error: "이미 가입된 이메일이에요. 로그인하거나 비밀번호를 다시 설정해 주세요." }
  const user: Stored = { id: `member-${randomToken().slice(0, 8)}`, email, createdAt: new Date().toISOString(), status: "active", deletionDueAt: null, passwordHash: await hash(input.password), failed: 0, lockedUntil: null }
  users.set(email, user)
  session = publicUser(user)
  emit()
  return { error: null }
}

export async function signIn(emailInput: string, password: string, now = Date.now()) {
  const email = normalize(emailInput)
  if (LIVE) {
    const tries = attempts.get(email) ?? { failed: 0, lockedUntil: null }
    if (tries.lockedUntil && now < tries.lockedUntil) return { error: LOCKED }
    const db = await supabase()
    const { data, error } = await db.auth.signInWithPassword({ email, password })
    if (error) {
      if (/not confirmed/i.test(error.message)) return { error: "메일 확인이 필요해요. 메일함(스팸함 포함)에서 가입 확인 링크를 눌러 주세요.", unconfirmed: true }
      if (/rate|too many/i.test(error.message)) return { error: LOCKED }
      if (!/invalid/i.test(error.message)) return { error: friendlyError(error) }
      tries.failed += 1
      if (tries.failed >= LOCK_AFTER) { tries.lockedUntil = now + LOCK_MINUTES * 60000; tries.failed = 0 }
      attempts.set(email, tries)
      return { error: WRONG }
    }
    attempts.delete(email)
    const { data: profile } = await db.from("profiles").select("status").eq("id", data.user.id).maybeSingle()
    if (profile?.status === "withdrawal_requested") { await db.auth.signOut(); return { error: WITHDRAWN } }
    return { error: null }
  }
  const user = users.get(email)
  // 가입 여부를 알려 주지 않도록, 없는 계정과 틀린 비밀번호는 같은 문구를 쓴다.
  if (!user) return { error: WRONG }
  if (user.lockedUntil && now < user.lockedUntil) return { error: LOCKED }
  if (user.passwordHash !== (await hash(password))) {
    user.failed += 1
    if (user.failed >= LOCK_AFTER) { user.lockedUntil = now + LOCK_MINUTES * 60000; user.failed = 0 }
    return { error: WRONG }
  }
  if (user.status === "withdrawal-requested") return { error: WITHDRAWN }
  user.failed = 0; user.lockedUntil = null
  session = publicUser(user)
  emit()
  return { error: null }
}

export function signOut() {
  session = null
  emit()
  if (LIVE) void supabase().then((db) => db.auth.signOut())
}

// 가입 여부와 관계없이 같은 안내를 보여 준다. 데모에서는 메일 대신 화면에 재설정 링크를 돌려준다(devLink).
export async function requestPasswordReset(emailInput: string, now = Date.now()): Promise<{ error: string | null; devLink: string | null }> {
  const email = normalize(emailInput)
  if (!validEmail(email)) return { error: "이메일 주소를 확인해 주세요.", devLink: null }
  if (LIVE) {
    const db = await supabase()
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password?token=recovery` })
    if (error && /rate|too many/i.test(error.message)) return { error: "잠시 뒤 다시 시도해 주세요.", devLink: null }
    return { error: null, devLink: null }
  }
  let devLink: string | null = null
  if (users.has(email)) {
    const token = randomToken()
    resetTokens.set(token, { token, email, expiresAt: now + RESET_MINUTES * 60000, used: false })
    devLink = `/reset-password?token=${token}`
  }
  return { error: null, devLink }
}

export async function resetPassword(token: string, password: string, now = Date.now()) {
  const expired = { error: "링크가 만료됐거나 이미 사용됐어요. 다시 요청해 주세요." }
  if (LIVE) {
    if (!validPassword(password)) return { error: `비밀번호는 ${PASSWORD_RULE}` }
    const db = await supabase()
    const { data } = await db.auth.getSession()
    if (!data.session) return expired
    const { error } = await db.auth.updateUser({ password })
    if (error) return { error: /different|same/i.test(error.message) ? "이전과 다른 비밀번호를 정해 주세요." : friendlyError(error) }
    // 다른 기기의 로그인도 함께 끊는다.
    await db.auth.signOut({ scope: "global" })
    return { error: null }
  }
  const record = resetTokens.get(token)
  if (!record || record.used || now > record.expiresAt) return expired
  if (!validPassword(password)) return { error: `비밀번호는 ${PASSWORD_RULE}` }
  const user = users.get(record.email)
  if (!user) return expired
  user.passwordHash = await hash(password); user.failed = 0; user.lockedUntil = null
  record.used = true
  // 다른 기기의 로그인도 끊는 것이 원칙이라, 데모에서도 세션을 비운다.
  session = null
  emit()
  return { error: null }
}

// 탈퇴: 비밀번호를 다시 확인한 뒤 탈퇴 요청을 기록하고 바로 로그아웃한다. 상대 노출·알림은 즉시 멈추고,
// 일반 자료는 개인정보 기준(activeDeleteDays) 안에 지운다.
export async function withdraw(password: string, now = new Date()): Promise<{ error: string | null; deletionDueAt?: string | null }> {
  if (!session) return { error: "로그인한 뒤 진행해 주세요." }
  if (LIVE) {
    const db = await supabase()
    const { error: wrong } = await db.auth.signInWithPassword({ email: session.email, password })
    if (wrong) return { error: "비밀번호가 맞지 않아요." }
    const { data, error } = await rpc<{ deletionDueAt: string }>("request_withdrawal")
    if (error || !data) return { error: error || "탈퇴 요청을 저장하지 못했어요. 다시 시도해 주세요." }
    signOut()
    return { error: null, deletionDueAt: data.deletionDueAt }
  }
  const user = users.get(session.email)
  if (!user || user.passwordHash !== (await hash(password))) return { error: "비밀번호가 맞지 않아요." }
  user.status = "withdrawal-requested"
  user.deletionDueAt = new Date(now.getTime() + BEFORE_US.privacy.activeDeleteDays * 86400000).toISOString()
  submitMemberRequest({ memberId: "current-member", surface: "account" }, "withdrawal", { confirmed: true, description: "계정 화면에서 탈퇴 요청" }, now)
  session = null
  emit()
  return { error: null, deletionDueAt: user.deletionDueAt }
}

// 메일 링크로 돌아왔는데 로그인되지 않은 경우의 안내(인스타그램·카카오톡 앱 안 브라우저로 가입한 뒤 다른 브라우저에서 링크를 연 경우 등)
let linkNotice: string | null = null
export const getLinkNotice = () => linkNotice
export const clearLinkNotice = () => { linkNotice = null; emit() }
function readLinkReturn(signedIn: boolean) {
  if (LANDING.path.startsWith("/reset-password")) return
  const query = new URLSearchParams(LANDING.search), hash = new URLSearchParams(LANDING.hash.replace(/^#/, ""))
  const failed = query.get("error_code") || hash.get("error_code") || query.get("error") || hash.get("error")
  if (signedIn || (!query.has("code") && !failed)) return
  const detail = `${failed ?? ""} ${query.get("error_description") ?? hash.get("error_description") ?? ""}`
  linkNotice = !failed
    ? "메일 확인이 끝났어요. 가입할 때와 다른 브라우저(인스타그램·카카오톡 앱 안 화면 등)에서 링크가 열려 자동으로 로그인되지 않았어요. 가입한 이메일과 비밀번호로 로그인해 주세요."
    : /expired|invalid/i.test(detail)
      ? "확인 링크가 만료됐거나 이미 쓰였어요. 먼저 로그인해 보시고, ‘메일 확인이 필요해요’가 나오면 확인 메일을 다시 받아 주세요."
      : "링크를 확인하지 못했어요. 로그인해 보시고, 안 되면 확인 메일을 다시 받아 주세요."
  try {
    const url = new URL(window.location.href)
    ;["code", "error", "error_code", "error_description"].forEach((key) => url.searchParams.delete(key))
    window.history.replaceState(window.history.state, "", url.pathname + url.search)
  } catch { /* 주소 정리는 못 해도 안내는 보여 준다 */ }
}

// 메일 링크(가입 확인·비밀번호 재설정) 확인: 링크 안의 값으로 바로 로그인한다. 어느 브라우저·앱에서 열어도 된다.
export async function confirmEmailLink(tokenHash: string, type: "email" | "recovery") {
  if (!LIVE) return { error: null }
  try {
    const db = await supabase()
    const { error } = await db.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) return { error: null }
    if (/expired|invalid|not found/i.test(error.message)) return { error: "링크가 만료됐거나 이미 쓰였어요. 로그인해 보시고, ‘메일 확인이 필요해요’가 나오면 확인 메일을 다시 받아 주세요." }
    return { error: friendlyError(error) }
  } catch (error) {
    return { error: friendlyError(error as Error) }
  }
}

// 자주 틀리는 메일 주소(gmai.com → gmail.com 같은 오타)를 찾아 고칠 주소를 알려 준다.
const DOMAIN_FIXES: Record<string, string> = {
  "gmai.com": "gmail.com", "gmial.com": "gmail.com", "gamil.com": "gmail.com", "gmal.com": "gmail.com", "gmaill.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmail.net": "gmail.com", "gnail.com": "gmail.com",
  "naver.co": "naver.com", "naver.con": "naver.com", "naver.cm": "naver.com", "naver.net": "naver.com", "nave.com": "naver.com", "navr.com": "naver.com", "naer.com": "naver.com", "nver.com": "naver.com",
  "daum.ner": "daum.net", "daum.nte": "daum.net", "daum.com": "daum.net", "duam.net": "daum.net", "hanmail.ent": "hanmail.net", "hanmail.nt": "hanmail.net", "hanmail.com": "hanmail.net", "hamail.net": "hanmail.net",
  "nate.con": "nate.com", "nate.co": "nate.com", "kakao.con": "kakao.com", "icloud.con": "icloud.com", "naver.c": "naver.com", "gmail.c": "gmail.com",
}
export function suggestEmail(value: string) {
  const email = normalize(value)
  const at = email.lastIndexOf("@")
  if (at < 1) return null
  const domain = email.slice(at + 1)
  const fixed = DOMAIN_FIXES[domain] ?? (domain.endsWith(".con") ? `${domain.slice(0, -4)}.com` : null)
  return fixed ? `${email.slice(0, at)}@${fixed}` : null
}

// 가입 확인 메일 다시 보내기(링크가 만료됐거나 메일을 못 찾을 때)
export async function resendConfirmation(emailInput: string) {
  const email = normalize(emailInput)
  if (!validEmail(email)) return { error: "이메일 주소를 확인해 주세요." }
  if (!LIVE) return { error: null }
  const db = await supabase()
  const { error } = await db.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${window.location.origin}/apply` } })
  if (error && /rate|too many|seconds/i.test(error.message)) return { error: "방금 보냈어요. 1분쯤 뒤에 다시 시도해 주세요." }
  return { error: error ? friendlyError(error) : null }
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
// 공개 화면 머리(App.tsx)가 무겁지 않게 나중에 불러와 로그인 상태만 구독할 때 쓴다.
export const subscribeAuth = subscribe
export const getAuthUser = () => session
export function useAuth() {
  return useSyncExternalStore(subscribe, () => session, () => session)
}
// 실제 서버에서 처음 로그인 상태를 읽기 전에는 ready가 false다(로그인 안내가 잠깐 깜빡이지 않도록).
export function useAuthReady() {
  return useSyncExternalStore(subscribe, () => ready, () => ready)
}
