// 공개 화면 점검 실행기(로그인 없음). 줄 바꿈·묶음 줄 넘김·가로 넘침(layout-scan.js)과 누름 영역(target-size.js)을 여러 폭에서 잰다.
//   node scripts/checks/public-scan.mjs --base=http://localhost:8444 --out=결과.json [--paths=/,/start] [--widths=320,390] [--mode=normal|safari|zoom]
//   --mode=safari : text-wrap: pretty가 없는 아이폰 Safari(26 전)를 흉내 내요(balance는 17.5부터 있어 그대로 둬요).
//   --mode=zoom   : 3차 검수 R3-10. ‘실제 브라우저 확대’가 아니라 두 가지 에뮬레이션을 따로 기록해요.
//                   ① 640px 폭 재배치(1280 화면을 200% 확대했을 때와 같은 CSS 폭, DPR 2) ② 글자 200%(뿌리 글자 크기 2배, 390·1280 폭)
//                   실제 기기 확대·시스템 큰 글씨·키보드가 열린 상태는 이 도구로 확인하지 못해요.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { args, launch, sleep } from "./lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const layout = readFileSync(join(here, "layout-scan.js"), "utf8")
const target = readFileSync(join(here, "target-size.js"), "utf8")
const opt = args({ base: "http://localhost:8444", out: "public-scan.json", mode: "normal" })
const PATHS = (opt.paths || "/,/start,/two-starts,/how-it-works,/pricing,/faq,/contact,/login,/signup,/reset-password,/terms,/privacy").split(",")
const PROFILES = opt.mode === "zoom"
  ? [{ name: "640px 폭 재배치(1280의 200% 확대와 같은 CSS 폭)", width: 640, dpr: 2 }, { name: "글자 200%(390 폭)", width: 390, dpr: 2, text: 2 }, { name: "글자 200%(1280 폭)", width: 1280, dpr: 1, text: 2 }]
  : (opt.widths || "320,360,390,430,768,1024,1366").split(",").map((w) => ({ name: `${w}px`, width: Number(w), dpr: 1 }))
const browser = await launch({ chrome: opt.chrome })
const rows = []
for (const path of PATHS) for (const profile of PROFILES) {
  const page = await browser.newPage()
  await page.setViewport({ width: profile.width, height: 900, deviceScaleFactor: profile.dpr, isMobile: profile.width < 768, hasTouch: profile.width < 768 })
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem("flavie:home-tip-dismissed", "1") } catch {} })
  await page.goto(new URL(path, opt.base).href, { waitUntil: "networkidle0", timeout: 90000 })
  if (profile.text) await page.addStyleTag({ content: `html { font-size: ${profile.text * 100}% !important; }` })
  if (opt.mode === "safari") await page.evaluate(() => { document.querySelectorAll("*").forEach((el) => { if (getComputedStyle(el).textWrapStyle === "pretty") el.style.textWrapStyle = "auto" }) })
  await page.evaluate(async () => { await document.fonts.ready; for (let y = 0; y < document.body.scrollHeight; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)) } window.scrollTo(0, 0) })
  await sleep(1000)
  const found = [...await page.evaluate(layout), ...await page.evaluate(target)]
  // 확대 모드: 세로로는 모든 내용에 닿는지(문서 높이), 고정 요소가 화면의 몇 %를 덮는지도 남긴다
  if (opt.mode === "zoom") found.push(await page.evaluate(() => {
    const fixed = [...document.querySelectorAll("body *")].filter((el) => { const s = getComputedStyle(el); return (s.position === "fixed" || s.position === "sticky") && el.getBoundingClientRect().height > 0 })
    const cover = fixed.reduce((sum, el) => { const r = el.getBoundingClientRect(); return sum + Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) }, 0)
    return { kind: "zoom-info", text: `가로 넘침 ${document.documentElement.scrollWidth - innerWidth}px · 고정 요소가 덮는 세로 ${Math.round(cover / innerHeight * 100)}%`, where: "document", lines: 0 }
  }))
  for (const f of found) rows.push({ path, profile: profile.name, width: profile.width, ...f })
  await page.close()
}
await browser.close()
writeFileSync(opt.out, JSON.stringify({ base: opt.base, mode: opt.mode, at: new Date().toISOString(), rows }, null, 1))
const count = {}; for (const r of rows) count[r.kind] = (count[r.kind] || 0) + 1
console.log(`점검 끝 · ${opt.mode} · ${PATHS.length}화면 × ${PROFILES.length}조건 ·`, JSON.stringify(count))
