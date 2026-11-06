// 누름 영역 점검(페이지 안에서 실행하는 식). 3차 검수 R3-09 정정.
// - 내부 목표 44×44: 가로·세로 중 **한 축이라도** 44px보다 작으면 잡는다(예전에는 두 축 모두 작을 때만 잡아 100×20을 놓쳤다).
// - 이름표(label)로 함께 눌리는 체크 상자·라디오·스위치는 이름표까지 합친 실제 누름 영역으로 본다.
// - 문장 안 링크는 WCAG 2.5.8의 인라인 예외 대상이라 inline:true로 따로 표시한다(내부 목표 미달로는 남긴다).
// - wcag24: WCAG 2.2 AA 일반 최소 24px보다 작은지(간격 예외는 계산하지 않음 → 사람이 확인).
// - 범위: 머리·메뉴·본문·꼬리말·열린 대화 상자 모두.
(() => {
  const vis = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const s = getComputedStyle(e)
      if (s.display === "none" || s.visibility === "hidden" || e.getAttribute("aria-hidden") === "true" || e.hasAttribute("inert")) return false
    }
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const union = (a, b) => { const left = Math.min(a.left, b.left), top = Math.min(a.top, b.top), right = Math.max(a.right, b.right), bottom = Math.max(a.bottom, b.bottom); return { left, top, right, bottom, width: right - left, height: bottom - top } }
  const region = (el) => el.closest("[role=dialog],dialog") ? "dialog" : el.closest("header") ? "header" : el.closest("nav") ? "nav" : el.closest("footer") ? "footer" : el.closest("main") ? "main" : "other"
  const name = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.value || el.getAttribute("title") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 30)
  const sel = "a[href], button, [role=button], [role=tab], [role=checkbox], [role=switch], [role=radio], input:not([type=hidden]), select, textarea, summary"
  const seen = new Set()
  const out = []
  for (const el of document.querySelectorAll(sel)) {
    if (seen.has(el) || !vis(el)) continue
    seen.add(el)
    let r = el.getBoundingClientRect(), via = ""
    if (el.matches("input[type=checkbox], input[type=radio], [role=checkbox], [role=switch], [role=radio]")) {
      const label = el.closest("label") || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))
      if (label && vis(label)) { r = union(r, label.getBoundingClientRect()); via = "label" }
    }
    // 보이지 않는 덧칸(::before·::after, position:absolute)으로 넓힌 누름 영역도 실제 영역으로 친다(.hit-44)
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(el, pseudo)
      if (ps.content === "none" || ps.position !== "absolute" || ps.pointerEvents === "none") continue
      const px = (v) => (v.endsWith("px") ? parseFloat(v) : 0)
      const base = el.getBoundingClientRect()
      const box = { left: base.left + px(ps.left), top: base.top + px(ps.top), right: base.right - px(ps.right), bottom: base.bottom - px(ps.bottom) }
      if (box.right > box.left && box.bottom > box.top) { r = union(r, { ...box, width: box.right - box.left, height: box.bottom - box.top }); via = via || pseudo.slice(2) }
    }
    const w = Math.round(r.width * 10) / 10, h = Math.round(r.height * 10) / 10
    if (w >= 44 && h >= 44) continue
    const parent = el.parentElement
    const inline = el.tagName === "A" && getComputedStyle(el).display === "inline" && !!parent && parent.textContent.trim().length > el.textContent.trim().length + 4
    out.push({ kind: "target", tag: el.tagName.toLowerCase(), name: name(el), w, h, via, inline, wcag24: Math.min(w, h) < 24, region: region(el) })
  }
  return out
})()
