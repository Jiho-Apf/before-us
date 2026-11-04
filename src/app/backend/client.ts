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
// 보관(POST)과 지우기(DELETE)는 한 줄로 세워 차례대로만 보낸다(검수 C3). 로그아웃하면 세대가 바뀌어,
// 그 전에 줄 선 보관 요청은 보내지 않는다. 이미 보내고 있던 보관은 끝난 뒤에 지우기가 나가 쿠키를 지운다.
let backupChain: Promise<unknown> = Promise.resolve()
let backupGeneration = 0
const queueBackup = (task: () => Promise<unknown>) => { const next = backupChain.then(task, task); backupChain = next.catch(() => undefined); return next }
function saveSessionBackup(refreshToken: string) {
  const generation = backupGeneration
  void queueBackup(async () => { if (generation !== backupGeneration) return; await sessionBackup("POST", { refreshToken }) }).catch(() => undefined)
}
// 로그아웃·탈퇴: 앞서 줄 선 보관은 버리고, 쿠키를 반드시 지운다. 실패하면 false.
export async function clearSessionBackup(): Promise<boolean> {
  backupGeneration += 1
  if (typeof window === "undefined") return true
  // 보관 표시(flv_has)는 화면에서도 지울 수 있다. 서버 쿠키 지우기가 실패해도 다음 방문에 보관을 묻지 않게 된다.
  const dropMarker = () => { try { document.cookie = "flv_has=; Path=/; Max-Age=0; Secure; SameSite=Strict" } catch { /* 무시 */ } }
  dropMarker()
  try { const response = await queueBackup(() => sessionBackup("DELETE")) as Response; dropMarker(); return response.ok || response.status === 404 || !hasBackup() } catch { dropMarker(); return !hasBackup() }
}
async function keepSession(db: SupabaseClient) {
  try {
    const { data } = await db.auth.getSession()
    if (!data.session && hasBackup()) {
      const generation = backupGeneration
      const response = await sessionBackup("GET")
      const saved = response.ok && response.headers.get("content-type")?.includes("json") ? ((await response.json()) as { refreshToken?: string | null }).refreshToken : null
      // 읽는 사이에 로그아웃했다면 되살리지 않는다.
      if (saved && generation === backupGeneration) {
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
    if (session?.refresh_token && session.refresh_token !== last) { last = session.refresh_token; saveSessionBackup(session.refresh_token) }
  })
}

// 이 기기의 로그인을 끝낸다(검수 C3). 서버에 로그아웃을 알리고, 서버가 답하지 않아도 이 기기의 저장 세션·자동 갱신·보관 쿠키는 반드시 지운다.
//  - serverOk: 서버가 로그아웃을 받았는지(다른 기기까지 끊는 global일 때 의미가 있다) · localOk: 이 기기에서 정말 지워졌는지
export async function endSession(scope: "global" | "local" = "global"): Promise<{ serverOk: boolean; localOk: boolean }> {
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
    const cookieCleared = await clearSessionBackup()
    const { data } = await db.auth.getSession()
    return { serverOk, localOk: !data.session && cookieCleared }
  } catch {
    const cookieCleared = await clearSessionBackup()
    return { serverOk: false, localOk: cookieCleared }
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
