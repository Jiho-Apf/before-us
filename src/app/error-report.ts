// 오류 알림. 화면에서 난 오류를 한 곳으로 모아 보낸다.
// VITE_ERROR_ENDPOINT(예: Sentry·Slack 웹훅을 받는 서버 함수 주소)가 설정되면 그곳으로 보내고, 없으면 콘솔에만 남긴다.
// 개인정보를 보내지 않는다(검수 R3-18): 보내기 전에 걸러서, 허용한 칸만 남긴다.
//  - 남기는 것: 사건 코드(event) · 화면 경로 틀(route, 예: /vouch/:id) · 오류 번호(ref, 회원이 문의할 때 말하는 번호와 같다) · 배포판 · 시각 · 기기 종류(휴대폰/컴퓨터)
//  - 오류 문장·호출 위치는 영문·숫자 기호만 남기고, 그 안의 메일 주소·전화번호·토큰·서명 주소·긴 식별값·쿼리는 지운다.
//  - 한글 문장(회원이 쓴 글일 수 있다)·주소의 쿼리·해시·입력값은 보내지 않는다.
import { LIVE, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, errorRef, onFailure, type Failure } from "./backend/client"
// 실제 서버 모드: 따로 주소가 없으면 서버의 report_client_error 로 모은다(운영진 대시보드에서 확인).
const ENDPOINT = (import.meta.env.VITE_ERROR_ENDPOINT as string | undefined) || (LIVE ? `${SUPABASE_URL}/rest/v1/rpc/report_client_error` : undefined)
const TO_SERVER = LIVE && !import.meta.env.VITE_ERROR_ENDPOINT
const RELEASE = (import.meta.env.VITE_RELEASE as string | undefined) || "dev"
const sent = new Set<string>()

// 주소: 출처·경로만 남기고 경로 안 식별값은 :id로(쿼리·해시는 버린다).
export function routeTemplate(pathname: string) {
  return "/" + pathname.split("/").filter(Boolean).map(part => /^[a-z][a-z-]{0,23}$/.test(part) ? part : ":id").join("/")
}
// 문장·호출 위치 속 주소: 출처 + 경로 틀. 화면 코드 파일 이름(.js·.ts·.tsx 등)만 남긴다(사진·서명 주소의 파일 이름은 남기지 않는다).
const urlTemplate = (match: string) => { try { const url = new URL(match); const parts = url.pathname.split("/").filter(Boolean); return `${url.origin}/${parts.map((part, index) => /^[a-z][a-z-]{0,23}$/.test(part) || (index === parts.length - 1 && /^[\w-]{1,60}\.(?:m?js|tsx?|jsx|css)$/.test(part)) ? part : ":id").join("/")}` } catch { return "[url]" } }
// 문장 거르기: 한글은 통째로 빼고, 민감해 보이는 모양을 지운 뒤, 영문 기호만 남긴다.
export function scrub(text: string, max = 300) {
  return text
    .replace(/https?:\/\/[^\s)'"<>]+/g, urlTemplate)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/eyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?/g, "[token]")
    .replace(/\b(?:sb|sk|pk|rk)_[\w-]{8,}/gi, "[token]")
    .replace(/\b(token|apikey|key|code|signature|sig|access_token|refresh_token|token_hash)=[^\s&]+/gi, "$1=[x]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\b[0-9a-f]{16,}\b/gi, "[hex]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[long]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "[number]")
    .replace(/[^\x20-\x7E]+/g, "…")
    .replace(/(?:…\s*){2,}/g, "… ")
    .slice(0, max)
}
// 호출 위치: 함수 이름과 파일 경로·줄만(쿼리 ?t=·?v= 같은 값은 버린다), 위에서 8줄까지.
export function scrubStack(stack: string) {
  return stack.split("\n").slice(0, 9).map(line => scrub(line.replace(/\?[^\s:)]*(?=:\d)/g, ""), 160)).join("\n").slice(0, 1600)
}
const device = () => /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent) ? "mobile" : "desktop"
type Payload = { context: string; ref: string; message: string; stack: string; path: string; release: string; at: string; userAgent: string }
function send(payload: Payload) {
  console.error("[flavie]", payload)
  if (!ENDPOINT) return
  try {
    if (TO_SERVER) { void fetch(ENDPOINT, { method: "POST", body: JSON.stringify({ p_payload: payload }), keepalive: true, headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY } }).catch(() => {}); return }
    const body = JSON.stringify(payload)
    if (!navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) void fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {})
  } catch { /* 알림 실패가 화면을 깨지 않도록 무시 */ }
}
// 보낼 내용 만들기(시험에서도 쓴다): 허용한 칸만, 거른 값으로.
export function buildPayload(event: string, ref: string, message: string, stack = ""): Payload {
  const safeEvent = scrub(event, 60).replace(/[^\w.:-]/g, "") || "event"
  // 서버는 ref 칸을 따로 두지 않아 사건 코드 뒤에 붙인다(context = event#ref).
  return { context: `${safeEvent}#${ref}`, ref, message: scrub(message), stack: scrubStack(stack), path: routeTemplate(window.location.pathname), release: RELEASE, at: new Date().toISOString(), userAgent: device() }
}

export function reportError(error: unknown, context: string): string {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "unknown error")
  const ref = errorRef("unknown")
  const key = `${context}:${scrub(err.message, 120)}`
  if (sent.has(key)) return ref
  sent.add(key)
  send(buildPayload(context, ref, `${err.name}: ${err.message}`, err.stack || ""))
  return ref
}
// 서버 요청 실패(오류 번호가 붙은 것): 회원이 본 번호로 찾을 수 있게 번호마다 보내되,
// 같은 종류·같은 화면은 이 탭에서 10번까지만(20초마다 다시 묻는 화면이 기록을 쌓지 않게 · 서버도 10분 200건으로 막는다).
const failureCounts = new Map<string, number>()
function reportFailure(event: string, failure: Failure) {
  if (!failure.ref) return
  const key = `${event}:${failure.kind}:${failure.status ?? ""}:${routeTemplate(window.location.pathname)}`
  const count = failureCounts.get(key) ?? 0
  if (count >= 10) return
  failureCounts.set(key, count + 1)
  send(buildPayload(event, failure.ref, `${failure.kind}${failure.status ? ` ${failure.status}` : ""}`))
}

// 화면 밖(이벤트 처리, 비동기)에서 난 오류도 잡는다.
export function installGlobalErrorReporting() {
  onFailure(reportFailure)
  window.addEventListener("error", (event) => reportError(event.error ?? event.message, "window.error"))
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason, "unhandledrejection"))
}

// 배포 직후 예전 화면 조각을 못 불러오는 경우(새 버전으로 파일 이름이 바뀜)는 새로고침하면 해결된다.
export const isStaleChunkError = (error: unknown) => error instanceof Error && /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(error.message)
