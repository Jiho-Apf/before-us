// 처음 들어온 경로를 이 기기에만 저장해, 신청서의 ‘알게 된 경로’ 칸을 미리 채운다(서버로 따로 보내지 않는다).
//  - 홍보 링크에 ?from=instagram · ?from=threads 처럼 붙이면 그 경로로 기록된다(utm_source·ref도 읽는다).
//  - 링크 꼬리표가 없으면 들어온 페이지 주소(인스타그램·스레드 앱 안 브라우저)를 본다.
//  - 처음 한 번만 기록하고, 이후 방문으로 덮어쓰지 않는다.
const KEY = "before-us:source"
const MAP: Record<string, string> = {
  instagram: "인스타그램", insta: "인스타그램", ig: "인스타그램",
  threads: "스레드", thread: "스레드", th: "스레드",
  search: "검색", naver: "검색", google: "검색",
  blog: "블로그·커뮤니티", community: "블로그·커뮤니티",
  friend: "지인 소개", invite: "지인 소개",
  event: "제휴·오프라인 행사",
}

export function captureSource() {
  try {
    if (localStorage.getItem(KEY)) return
    const params = new URLSearchParams(window.location.search)
    const tag = (params.get("from") || params.get("utm_source") || params.get("ref") || "").trim().toLowerCase()
    const referrer = document.referrer
    const source = MAP[tag] ?? (/instagram\.com/i.test(referrer) ? "인스타그램" : /threads\.(net|com)/i.test(referrer) ? "스레드" : null)
    if (source) localStorage.setItem(KEY, source)
  } catch { /* 저장소를 쓸 수 없는 브라우저에서는 기록하지 않는다 */ }
}

export function storedSource() {
  try { return localStorage.getItem(KEY) } catch { return null }
}
