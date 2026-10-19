// 오류 알림. 화면에서 난 오류를 한 곳으로 모아 보낸다.
// VITE_ERROR_ENDPOINT(예: Sentry·Slack 웹훅을 받는 서버 함수 주소)가 설정되면 그곳으로 보내고, 없으면 콘솔에만 남긴다.
// 개인정보를 보내지 않는다: 주소의 쿼리·해시, 입력값, 이메일·전화번호 모양의 문자열은 지운다.
import { LIVE, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./backend/client"
// 실제 서버 모드: 따로 주소가 없으면 서버의 report_client_error 로 모은다(운영진 대시보드에서 확인).
const ENDPOINT = (import.meta.env.VITE_ERROR_ENDPOINT as string | undefined) || (LIVE ? `${SUPABASE_URL}/rest/v1/rpc/report_client_error` : undefined)
const TO_SERVER = LIVE && !import.meta.env.VITE_ERROR_ENDPOINT
const RELEASE = (import.meta.env.VITE_RELEASE as string | undefined) || "dev"
const sent = new Set<string>()

const scrub = (text: string) => text
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
  .replace(/\d{2,4}[-\s]?\d{3,4}[-\s]?\d{4}/g, "[phone]")
  .slice(0, 2000)

export function reportError(error: unknown, context: string) {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "알 수 없는 오류")
  const key = `${context}:${err.message}`
  if (sent.has(key)) return
  sent.add(key)
  const payload = {
    context,
    message: scrub(err.message),
    stack: scrub(err.stack || ""),
    path: window.location.pathname,
    release: RELEASE,
    at: new Date().toISOString(),
    userAgent: navigator.userAgent,
  }
  console.error("[before-us]", payload)
  if (!ENDPOINT) return
  try {
    if (TO_SERVER) { void fetch(ENDPOINT, { method: "POST", body: JSON.stringify({ p_payload: payload }), keepalive: true, headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY } }).catch(() => {}); return }
    const body = JSON.stringify(payload)
    if (!navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) void fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } })
  } catch { /* 알림 실패가 화면을 깨지 않도록 무시 */ }
}

// 화면 밖(이벤트 처리, 비동기)에서 난 오류도 잡는다.
export function installGlobalErrorReporting() {
  window.addEventListener("error", (event) => reportError(event.error ?? event.message, "window.error"))
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason, "unhandledrejection"))
}

// 배포 직후 예전 화면 조각을 못 불러오는 경우(새 버전으로 파일 이름이 바뀜)는 새로고침하면 해결된다.
export const isStaleChunkError = (error: unknown) => error instanceof Error && /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(error.message)
