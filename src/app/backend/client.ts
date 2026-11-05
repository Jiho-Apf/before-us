import type { SupabaseClient } from "@supabase/supabase-js"

// 실제 서버(Supabase) 연결.
//  - 주소와 publishable 키는 원래 웹 화면에 들어가는 공개용 값이다. 비밀 키(secret·service_role)는 절대 여기에 두지 않는다.
//  - 빌드할 때 VITE_BACKEND=supabase 일 때만 실제 서버를 쓴다. 지정하지 않으면 지금처럼 데모로 동작한다.
//  - 데모 화면이 무거워지지 않도록 Supabase 라이브러리는 실제 서버 모드에서 처음 쓸 때 불러온다.
export const SUPABASE_URL = "https://mmrqcefipllmcqztksqm.supabase.co"
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_vJTN2b31pClzNM-uKNWPVQ_Aw4278cg"
export const PHOTO_BUCKET = "application-photos"

export const LIVE = import.meta.env.VITE_BACKEND === "supabase"
// 처음 열린 주소(메일 링크로 돌아왔는지 확인용). Supabase가 주소를 정리하기 전에 남겨 둔다.
export const LANDING = typeof window === "undefined" ? { path: "", search: "", hash: "" } : { path: window.location.pathname, search: window.location.search, hash: window.location.hash }

// 로그인 유지: 아이폰 사파리는 7일 넘게 열지 않은 사이트의 저장값을 지워 로그인이 풀릴 수 있다.
// 새로 고침 토큰을 우리 사이트 쿠키(/api/session · HttpOnly)에도 보관해 두고, 저장값이 비었으면 그걸로 로그인을 이어 준다.
// 보관한 게 있다는 표시(flv_has)가 있을 때만 물어보고, 실패하면 지금처럼 로그인 화면으로 간다(개발 서버에는 /api가 없다).
const SESSION_API = "/api/session"
const sessionBackup = (method: "GET" | "POST" | "DELETE", body?: { refreshToken: string }) => {
  // 응답이 오지 않는 요청이 뒤 요청(로그아웃의 지우기)을 막지 않게 8초에서 끊는다.
  const abort = new AbortController()
  const timer = window.setTimeout(() => abort.abort(), 8000)
  return window.fetch(SESSION_API, { method, credentials: "same-origin", signal: abort.signal, headers: { "x-flavie-session": "1", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).finally(() => window.clearTimeout(timer))
}
const hasBackup = () => typeof document !== "undefined" && /(?:^|;\s*)flv_has=1(?:;|$)/.test(document.cookie)
// 로그아웃 의도(검수 T03): 로그아웃을 누르면 이 기기에 표시를 남기고 다른 탭에도 알린다. 표시가 있는 동안에는
// 어떤 탭·늦게 도착한 응답도 로그인을 되살리거나 보관 쿠키를 다시 저장하지 못한다. 직접 로그인(비밀번호·메일 링크)할 때만 지운다.
// 서버 쿠키 지우기가 실패(오프라인)하면 ‘지우기 남음’을 기록해 두고, 연결이 돌아오거나 다음에 열 때 다시 지운다.
const LOGOUT_KEY = "flavie:logged-out"
const COOKIE_PENDING_KEY = "flavie:session-cookie-pending"
const local = {
  get: (key: string) => { try { return window.localStorage.getItem(key) } catch { return null } },
  set: (key: string, value: string) => { try { window.localStorage.setItem(key, value) } catch { /* 저장 공간이 막히면 이번 탭에서만 */ } },
  remove: (key: string) => { try { window.localStorage.removeItem(key) } catch { /* 무시 */ } },
}
let logoutMemory = false // localStorage를 못 쓰는 브라우저에서도 이 탭에서는 지킨다
export const loggedOut = () => logoutMemory || (typeof window !== "undefined" && !!local.get(LOGOUT_KEY))
const authChannel = typeof window !== "undefined" && "BroadcastChannel" in window ? new BroadcastChannel("flavie-auth") : null
const remoteLogoutListeners = new Set<() => void>()
export const onRemoteLogout = (listener: () => void) => { remoteLogoutListeners.add(listener); return () => { remoteLogoutListeners.delete(listener) } }
function markLoggedOut() {
  logoutMemory = true
  local.set(LOGOUT_KEY, String(Date.now()))
  try { authChannel?.postMessage("logout") } catch { /* 다른 탭은 storage 알림으로도 안다 */ }
}
// 직접 로그인에 성공했을 때만 부른다(되살리기·자동 갱신은 해당 없음).
export function clearLoggedOut() { logoutMemory = false; local.remove(LOGOUT_KEY) }
const dropMarker = () => { try { document.cookie = "flv_has=; Path=/; Max-Age=0; Secure; SameSite=Strict" } catch { /* 무시 */ } }
// 이 탭의 로그인을 지운다(다른 탭에서 로그아웃했을 때·되살아난 세션을 치울 때).
async function dropLocalSession(db: SupabaseClient | null) {
  backupGeneration += 1
  if (db) {
    const auth = db.auth as unknown as { _removeSession?: () => Promise<void>; stopAutoRefresh?: () => Promise<void> }
    try { await auth.stopAutoRefresh?.() } catch { /* 계속 */ }
    try { await auth._removeSession?.() } catch { /* 아래에서 저장값을 직접 지운다 */ }
  }
  try { Object.keys(window.localStorage).filter(key => /^sb-.*-auth-token/.test(key)).forEach(key => window.localStorage.removeItem(key)) } catch { /* 무시 */ }
  dropMarker()
}
async function handleRemoteLogout() {
  logoutMemory = true
  await dropLocalSession(client ? await client.catch(() => null) : null)
  // 이 탭에서 보내고 있던 보관(POST)이 다른 탭의 지우기보다 늦게 서버에 닿으면 쿠키가 다시 생긴다. 그 뒤에 한 번 더 지운다.
  if (postsInFlight > 0) void deleteCookie()
  remoteLogoutListeners.forEach(listener => listener())
}
if (typeof window !== "undefined") {
  if (authChannel) authChannel.onmessage = (event) => { if (event.data === "logout") void handleRemoteLogout() }
  window.addEventListener("storage", (event) => { if (event.key === LOGOUT_KEY && event.newValue) void handleRemoteLogout() })
  window.addEventListener("online", () => { if (local.get(COOKIE_PENDING_KEY)) void retryCookieDelete() })
}
// 보관(POST)과 지우기(DELETE)는 한 줄로 세워 차례대로만 보낸다(검수 C3). 로그아웃하면 세대가 바뀌어,
// 그 전에 줄 선 보관 요청은 보내지 않는다. 이미 보내고 있던 보관은 끝난 뒤에 지우기가 나가 쿠키를 지운다.
let backupChain: Promise<unknown> = Promise.resolve()
let backupGeneration = 0
let postsInFlight = 0
const queueBackup = (task: () => Promise<unknown>) => { const next = backupChain.then(task, task); backupChain = next.catch(() => undefined); return next }
function saveSessionBackup(refreshToken: string) {
  if (loggedOut()) return
  const generation = backupGeneration
  void queueBackup(async () => {
    if (generation !== backupGeneration || loggedOut()) return
    postsInFlight += 1
    try { await sessionBackup("POST", { refreshToken }) } finally { postsInFlight -= 1 }
  }).catch(() => undefined)
}
// 서버 쿠키 지우기(DELETE). 성공하면 ‘지우기 남음’ 표시를 지우고 true. 실패하면 표시를 남겨 다음에 다시 지운다.
async function deleteCookie(): Promise<boolean> {
  try {
    const response = await queueBackup(() => sessionBackup("DELETE")) as Response
    if (response.ok || response.status === 404) { local.remove(COOKIE_PENDING_KEY); return true }
  } catch { /* 오프라인 · 시간 초과 */ }
  local.set(COOKIE_PENDING_KEY, "1")
  return false
}
function retryCookieDelete() { dropMarker(); return deleteCookie() }
// 로그아웃·탈퇴: 앞서 줄 선 보관은 버리고, 쿠키를 지운다. 서버 쿠키를 실제로 지웠는지(true/false)를 그대로 돌려준다.
// 실패해도 보관 표시(flv_has)는 화면에서 지우고, 로그아웃 의도 표시가 있어 이 기기에서 로그인이 되살아나지는 않는다.
export async function clearSessionBackup(): Promise<boolean> {
  backupGeneration += 1
  if (typeof window === "undefined") return true
  dropMarker()
  const ok = await deleteCookie()
  dropMarker()
  return ok
}
async function keepSession(db: SupabaseClient) {
  try {
    const { data } = await db.auth.getSession()
    // 메일 링크(가입 확인·비밀번호 재설정)로 돌아와 로그인한 것은 직접 로그인이라 로그아웃 표시를 지운다.
    if (loggedOut() && data.session && /[?&#](code|token_hash|access_token)=/.test(LANDING.search + LANDING.hash)) clearLoggedOut()
    if (loggedOut()) {
      // 로그아웃한 기기: 다른 탭이나 늦게 끝난 갱신이 남긴 세션은 치우고, 보관은 묻지 않는다. 남은 서버 쿠키는 다시 지운다.
      if (data.session) await dropLocalSession(db)
      dropMarker()
      if (local.get(COOKIE_PENDING_KEY) || hasBackup()) void retryCookieDelete()
    } else if (!data.session && hasBackup()) {
      const generation = backupGeneration
      const response = await sessionBackup("GET")
      const saved = response.ok && response.headers.get("content-type")?.includes("json") ? ((await response.json()) as { refreshToken?: string | null }).refreshToken : null
      // 읽는 사이에 로그아웃했다면 되살리지 않는다.
      if (saved && generation === backupGeneration && !loggedOut()) {
        const { error } = await db.auth.refreshSession({ refresh_token: saved })
        if (error) void clearSessionBackup()
      }
    }
  } catch {
    // 보관을 못 읽어도 화면은 그대로(로그인이 필요하면 로그인 화면으로)
  }
  let last = ""
  db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") { last = ""; void clearSessionBackup(); return }
    // 로그아웃한 뒤 이 탭에서 늦게 끝난 자동 갱신이 세션을 다시 쓰면 바로 치운다.
    if (session && loggedOut()) { window.setTimeout(() => void dropLocalSession(db), 0); return }
    if (session?.refresh_token && session.refresh_token !== last) { last = session.refresh_token; saveSessionBackup(session.refresh_token) }
  })
}

// 이 기기의 로그인을 끝낸다(검수 C3). 서버에 로그아웃을 알리고, 서버가 답하지 않아도 이 기기의 저장 세션·자동 갱신·보관 쿠키는 반드시 지운다.
//  - serverOk: 서버가 로그아웃을 받았는지(다른 기기까지 끊는 global일 때 의미가 있다) · localOk: 이 기기의 저장 세션이 정말 지워졌는지
//  - cookieOk: 로그인 유지 쿠키(서버)를 실제로 지웠는지. 못 지웠어도 로그아웃 표시가 있어 이 기기에서 되살아나지 않고, 연결되면 다시 지운다.
export async function endSession(scope: "global" | "local" = "global"): Promise<{ serverOk: boolean; localOk: boolean; cookieOk: boolean }> {
  markLoggedOut()
  backupGeneration += 1
  let serverOk = true
  try {
    const db = await supabase()
    try { const { error } = await db.auth.signOut({ scope }); if (error) serverOk = false } catch { serverOk = false }
    if (!serverOk) {
      // 서버가 답하지 않으면 SDK는 저장 세션을 남겨 둔다. 직접 지운다.
      const auth = db.auth as unknown as { _removeSession?: () => Promise<void>; stopAutoRefresh?: () => Promise<void> }
      try { await auth.stopAutoRefresh?.() } catch { /* 계속 */ }
      try { await auth._removeSession?.() } catch { /* 아래에서 저장값을 직접 지운다 */ }
    }
    try { Object.keys(window.localStorage).filter(key => /^sb-.*-auth-token/.test(key)).forEach(key => window.localStorage.removeItem(key)) } catch { /* 무시 */ }
    const cookieOk = await clearSessionBackup()
    const { data } = await db.auth.getSession()
    return { serverOk, localOk: !data.session, cookieOk }
  } catch {
    await dropLocalSession(null)
    const cookieOk = await clearSessionBackup()
    return { serverOk: false, localOk: true, cookieOk }
  }
}

let client: Promise<SupabaseClient> | null = null
export function supabase() {
  if (!LIVE) throw new Error("데모 모드에서는 실제 서버를 쓰지 않아요.")
  return (client ??= import("@supabase/supabase-js").then(async ({ createClient }) => {
    const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }, global: { fetch: (...args: Parameters<typeof fetch>) => window.fetch(...args) } })
    await keepSession(db)
    return db
  }))
}

// 서버 오류를 회원이 읽을 수 있는 문장으로 바꾼다. 서버 함수가 보낸 한국어 안내는 그대로 쓴다.
export function friendlyError(error: { message?: string } | null | undefined, fallback = "잠시 문제가 생겼어요. 조금 뒤 다시 시도해 주세요.") {
  const message = error?.message || ""
  if (/[가-힣]/.test(message)) return message.replace(/^.*?ERROR:\s*/, "")
  if (/Failed to fetch|NetworkError|network/i.test(message)) return "인터넷 연결을 확인한 뒤 다시 시도해 주세요."
  if (/JWT|session|not authenticated/i.test(message)) return "로그인이 끝났어요. 다시 로그인해 주세요."
  return fallback
}

// RPC 호출: 실패하면 { error } 를, 성공하면 { data } 를 돌려준다.
export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  try {
    const db = await supabase()
    const { data, error } = await db.rpc(name, args)
    if (error) return { data: null, error: friendlyError(error) }
    return { data: data as T, error: null }
  } catch (error) {
    return { data: null, error: friendlyError(error as Error) }
  }
}
