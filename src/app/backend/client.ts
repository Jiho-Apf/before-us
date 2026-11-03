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
const sessionBackup = (method: "GET" | "POST" | "DELETE", body?: { refreshToken: string }) => window.fetch(SESSION_API, { method, credentials: "same-origin", headers: { "x-flavie-session": "1", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined })
const hasBackup = () => typeof document !== "undefined" && /(?:^|;\s*)flv_has=1(?:;|$)/.test(document.cookie)
async function keepSession(db: SupabaseClient) {
  try {
    const { data } = await db.auth.getSession()
    if (!data.session && hasBackup()) {
      const response = await sessionBackup("GET")
      const saved = response.ok && response.headers.get("content-type")?.includes("json") ? ((await response.json()) as { refreshToken?: string | null }).refreshToken : null
      if (saved) {
        const { error } = await db.auth.refreshSession({ refresh_token: saved })
        if (error) void sessionBackup("DELETE").catch(() => undefined)
      }
    }
  } catch {
    // 보관을 못 읽어도 화면은 그대로(로그인이 필요하면 로그인 화면으로)
  }
  let last = ""
  db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") { last = ""; void sessionBackup("DELETE").catch(() => undefined); return }
    if (session?.refresh_token && session.refresh_token !== last) { last = session.refresh_token; void sessionBackup("POST", { refreshToken: session.refresh_token }).catch(() => undefined) }
  })
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
