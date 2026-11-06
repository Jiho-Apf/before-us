// 화면 안 글자의 실제 줄 위치를 읽어 어색한 줄 바꿈을 찾는다(페이지 안에서 실행).
// 결과: [{ kind, text, where, lines }]
//  - mid-word: 단어 중간에서 줄이 바뀜(한글·영문·숫자 사이, 띄어쓰기 없음)
//  - orphan: 두 줄 이상인데 마지막 줄이 1~2글자(문장 부호 제외)
//  - unit: 숫자와 단위(원·일·시·분·명·번·장·개·자·년·월·주·회·건·세·%)가 갈라짐
//  - control: 버튼·칩·배지·메뉴처럼 한 줄이어야 할 것이 두 줄
(() => {
  const out = []
  const vis = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || e.getAttribute("aria-hidden") === "true" || e.classList.contains("sr-only")) return false } return true }
  const blockOf = (node) => { for (let e = node.parentElement; e; e = e.parentElement) { const d = getComputedStyle(e).display; if (d !== "inline" && d !== "contents") return e } return document.body }
  const path = (el) => { const parts = []; for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) parts.unshift(e.tagName.toLowerCase() + (e.id ? "#" + e.id : "")); return parts.join(">") }
  const groups = new Map()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 1) { if (n.tagName === "BR" && vis(n.parentElement)) { const b = blockOf(n); if (!groups.has(b)) groups.set(b, []); groups.get(b).push(n) } continue }
    if (!n.nodeValue.trim()) continue
    const p = n.parentElement; if (!p || ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "OPTION", "TITLE"].includes(p.tagName)) continue
    if (!vis(p)) continue
    const b = blockOf(n); if (!groups.has(b)) groups.set(b, []); groups.get(b).push(n)
  }
  const range = document.createRange()
  for (const [block, nodes] of groups) {
    const chars = []
    for (const n of nodes) {
      if (n.nodeType === 1) { chars.push({ c: " ", r: null, br: true }); continue }
      const t = n.nodeValue
      for (let i = 0; i < t.length; i++) {
        range.setStart(n, i); range.setEnd(n, i + 1)
        const r = range.getClientRects()[0]
        chars.push({ c: t[i], r: r && r.width + r.height > 0 ? r : null })
      }
    }
    const lines = [[]]
    let last = null
    for (const ch of chars) {
      if (!ch.r) { lines[lines.length - 1].push(ch.c); continue }
      if (last && ch.r.top > last.top + last.height * 0.6 && ch.r.left < last.left + 1) lines.push([])
      lines[lines.length - 1].push(ch.c); last = ch.r
    }
    const text = lines.map((l) => l.join("").replace(/\s+/g, " ").trim()).filter(Boolean)
    if (text.length < 2) continue
    const st = getComputedStyle(block)
    const tag = block.tagName.toLowerCase()
    const accordion = block.hasAttribute("aria-expanded") && block.closest("h2,h3,h4")
    const isControl = !accordion && tag === "button" || tag === "summary" || block.getAttribute("role") === "button" || (tag === "a" && /rounded-full|rounded-xl/.test(block.className)) || (/rounded-full/.test(block.className) && (tag === "span" || tag === "p" || tag === "a")) || block.closest("nav") && tag === "a"
    const where = path(block)
    const sample = text.join(" ⏎ ").slice(0, 160)
    if (isControl) out.push({ kind: "control", where, text: sample, lines: text.length })
    for (let i = 0; i < text.length - 1; i++) {
      const a = text[i], b = text[i + 1]
      const endA = a.slice(-1), startB = b[0]
      // 같은 글자 흐름에서 띄어쓰기 없이 바뀐 경우만(원문에서 a 끝과 b 시작 사이 공백 여부 확인)
      const joined = lines[i].join("") + lines[i + 1].join("")
      const raw = lines[i].join("")
      const spaceAtBreak = /\s$/.test(raw) || /^\s/.test(lines[i + 1].join(""))
      if (!spaceAtBreak && /[가-힣A-Za-z0-9]/.test(endA) && /[가-힣A-Za-z0-9]/.test(startB)) out.push({ kind: "mid-word", where, text: `${a.slice(-12)} ⏎ ${b.slice(0, 12)}`, lines: text.length })
      if (/\d$/.test(a) && /^(원|일|시|분|명|번|장|개|자|년|월|주|회|건|세|%|만|천|시간|일째|px|KB|MB)/.test(b)) out.push({ kind: "unit", where, text: `${a.slice(-12)} ⏎ ${b.slice(0, 12)}`, lines: text.length })
    }
    // 의존 명사가 줄 머리에 홀로 떨어짐(‘알아가는 / 데’, ‘할 / 수 있어요’): 제목·큰 글자·짧은 글에서만 본다
    const big = /^h[1-4]$/.test(tag) || parseFloat(st.fontSize) >= 18 || text.length <= 3
    if (big) for (let i = 1; i < text.length; i++) if (/^(데|수|것|줄|적|뿐|때|만큼|중)(\s|[,.!?·]|$)/.test(text[i])) out.push({ kind: "bound", where, text: `${text[i - 1].slice(-12)} ⏎ ${text[i].slice(0, 12)}`, lines: text.length })
    const tail = text[text.length - 1].replace(/[\s.,!?·…)\]'"’”~:;-]/g, "")
    if (tail.length > 0 && tail.length <= 2 && !isControl && joinedLength(text) > 8) out.push({ kind: "orphan", where, text: `${text[text.length - 2].slice(-14)} ⏎ ${text[text.length - 1]}`, lines: text.length })
  }
  function joinedLength(t) { return t.join("").length }
  // 가로 넘침: 문서가 화면보다 넓거나, 글자 칸이 부모 밖으로 삐져나감(장식·고정 요소 제외)
  const over = document.documentElement.scrollWidth - window.innerWidth
  if (over > 1) {
    const beyond = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed" }
    // 가장 깊은 넘침 요소(자식 중에는 넘치는 것이 없는 것) = 칸을 밀어내는 원인
    const wide = [...document.querySelectorAll("body *")].filter((el) => beyond(el) && ![...el.children].some(beyond)).slice(0, 6).map((el) => path(el) + "." + String(el.className).split(" ").slice(0, 4).join(".") + ` r=${Math.round(el.getBoundingClientRect().right)}`)
    const m = document.querySelector("main#admin-content")
    const info = m ? `main r=${Math.round(m.getBoundingClientRect().right)} parent=${getComputedStyle(m.parentElement).display}/${getComputedStyle(m.parentElement).gridTemplateColumns} kids=` + [...m.children].map((c) => `${c.tagName}.${String(c.className).split(" ").slice(0, 3).join(".")} r=${Math.round(c.getBoundingClientRect().right)} sw=${c.scrollWidth}`).join(" | ") : ""
    out.push({ kind: "overflow", where: "document", text: `문서 가로 넘침 ${over}px · ${wide.join(" ; ")} · ${info}`, lines: 0 })
  }
  for (const el of document.querySelectorAll("main *, header *, footer *")) {
    if (el.children.length || !el.textContent.trim()) continue
    const st2 = getComputedStyle(el); if (st2.position === "fixed" || st2.position === "absolute" || !vis(el)) continue
    if (el.scrollWidth > el.clientWidth + 2 && st2.overflowX === "visible" && st2.textOverflow !== "ellipsis" && el.clientWidth > 0) out.push({ kind: "overflow", where: path(el), text: el.textContent.trim().slice(0, 40), lines: 0 })
  }
  // 요소 묶음 줄 넘김: flex-wrap 칸에서 (1) 마지막 줄에 하나만 떨어지거나 (2) 입력칸과 단추처럼 종류가 섞인 칸에서 같은 종류가 갈라짐
  const kindOf = (el) => { const t = el.tagName; if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA" || el.querySelector?.("input:not([type=checkbox]):not([type=radio]),select,textarea")) return "field"; if (t === "BUTTON" || t === "A" || el.getAttribute("role") === "button" || el.querySelector?.("button,a")) return "control"; return "text" }
  const label = (el) => (el.innerText || el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.value || el.tagName).trim().replace(/\s+/g, " ").slice(0, 18)
  for (const box of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(box)
    if (!/flex/.test(cs.display) || cs.flexWrap !== "wrap" || cs.flexDirection.startsWith("column") || !vis(box)) continue
    const items = [...box.children].filter((c) => { const s2 = getComputedStyle(c); const r = c.getBoundingClientRect(); return s2.position !== "absolute" && s2.position !== "fixed" && s2.display !== "none" && r.width > 0 && r.height > 0 })
    if (items.length < 2) continue
    const rows = []
    // 같은 줄: 세로 범위가 작은 쪽 높이의 절반 넘게 겹치면(높이가 다른 글자·입력칸·1px 선도 같은 줄로 본다)
    for (const it of items) { const r = it.getBoundingClientRect(); const row = rows.find((w) => Math.min(w.bottom, r.bottom) - Math.max(w.top, r.top) > Math.min(w.bottom - w.top, r.height) / 2 - 0.5); if (row) { row.items.push(it); row.top = Math.min(row.top, r.top); row.bottom = Math.max(row.bottom, r.bottom) } else rows.push({ top: r.top, bottom: r.bottom, items: [it] }) }
    if (rows.length < 2) continue
    rows.sort((x, y) => x.top - y.top)
    const kinds = new Set(items.map(kindOf))
    const desc = rows.map((r) => r.items.map(label).join(" | ")).join(" ⏎ ")
    const last = rows[rows.length - 1], prev = rows[rows.length - 2]
    if (last.items.length === 1 && prev.items.length >= 2 && items.length <= 8) out.push({ kind: "wrap-orphan", where: path(box), text: desc.slice(0, 170), lines: rows.length })
    // 양 끝 정렬 줄(왼쪽 글 · 오른쪽 표시)에서 오른쪽 것이 아래 줄로 떨어짐
    else if (cs.justifyContent === "space-between" && rows.length >= 2 && last.items.length === 1 && last.items[0].getBoundingClientRect().width < box.getBoundingClientRect().width * 0.5) out.push({ kind: "wrap-between", where: path(box), text: desc.slice(0, 170), lines: rows.length })
    else if (kinds.size > 1) {
      // 같은 종류가 두 줄에 걸쳐 갈라졌는지
      const split = [...kinds].some((k) => rows.filter((r) => r.items.some((it) => kindOf(it) === k)).length > 1)
      if (split) out.push({ kind: "wrap-mixed", where: path(box), text: desc.slice(0, 170), lines: rows.length })
    }
  }
  return out
})()
