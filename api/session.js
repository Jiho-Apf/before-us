// 로그인 유지 보조(Vercel 서버 함수 · /api/session)
// 아이폰 사파리는 7일 넘게 열지 않은 사이트의 브라우저 저장값을 지워, 그 안에 있던 로그인이 풀린다.
// 그래서 새로 고침 토큰을 우리 사이트가 직접 주는 쿠키(HttpOnly)에도 보관했다가, 저장값이 비었을 때 로그인을 이어 준다.
//  - flv_rt: 새로 고침 토큰(HttpOnly · /api/session 에서만 보냄)
//  - flv_has: 보관한 것이 있다는 표시(값 없음 · 화면이 이 표시가 있을 때만 물어본다)
// 같은 사이트에서 부른 요청만 받는다(다른 사이트가 내 로그인을 심거나 꺼내 가지 못하게).
const TOKEN = "flv_rt"
const MARK = "flv_has"
const MAX_AGE = 60 * 60 * 24 * 60 // 60일
const HEADER = "x-flavie-session"

const sameSite = (req) => {
  const site = req.headers["sec-fetch-site"]
  if (site && site !== "same-origin") return false
  const origin = req.headers.origin
  if (!origin) return true
  try { return new URL(origin).host === req.headers.host } catch { return false }
}
const readToken = (req) => {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === TOKEN) return decodeURIComponent(rest.join("=")) || null
  }
  return null
}
const cookies = (token, age) => [
  `${TOKEN}=${token}; Path=/api/session; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`,
  `${MARK}=${age ? "1" : ""}; Path=/; Max-Age=${age}; Secure; SameSite=Strict`,
]
const readBody = (req) => {
  if (req.body && typeof req.body === "object") return req.body
  try { return JSON.parse(String(req.body || "{}")) } catch { return {} }
}

// 정식 운영 전 과제(검수 C3): 지금은 보관한 새로 고침 토큰을 같은 사이트 화면에 그대로 돌려준다(GET).
// HttpOnly라 다른 사이트는 못 읽지만, 같은 사이트의 악성 스크립트까지 막는 경계는 아니다 → 서버가 갱신·회전을 맡는 구조로 바꿀 것.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store")
  // 지우기는 언제든 두 쿠키를 모두 지운다(로그아웃이 어떤 이유로도 막히지 않게 · 지우는 것만으로는 아무것도 꺼낼 수 없다).
  if (req.method === "DELETE") { res.setHeader("Set-Cookie", cookies("", 0)); res.status(204).end(); return }
  if (req.headers[HEADER] !== "1" || !sameSite(req)) { res.status(403).json({ error: "forbidden" }); return }
  if (req.method === "GET") { res.status(200).json({ refreshToken: readToken(req) }); return }
  if (req.method === "POST") {
    const token = readBody(req).refreshToken
    if (typeof token !== "string" || token.length < 8 || token.length > 512 || !/^[A-Za-z0-9._-]+$/.test(token)) { res.status(400).json({ error: "bad token" }); return }
    res.setHeader("Set-Cookie", cookies(encodeURIComponent(token), MAX_AGE))
    res.status(204).end()
    return
  }
  res.setHeader("Allow", "GET, POST, DELETE")
  res.status(405).json({ error: "method" })
}
