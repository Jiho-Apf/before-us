// 실험실 성능 측정(3차 검수 R3-11 정정판). 실제 방문자 측정(필드)이 아니에요.
//   1) 빌드: VITE_BACKEND=supabase npx vite build --config vite.figma.config.ts --mode live --outDir <dist>
//   2) 측정: node scripts/checks/perf-lab.mjs --dist=<dist> --out=결과.json [--runs=7] [--paths=/,/start]
// 바뀐 점(예전 측정과 다른 점)
//   - 측정용 서버가 배포처럼 압축해 보내요(Accept-Encoding에 따라 br 또는 gzip, Content-Encoding 머리글). 숫자는 브라우저가 실제로 받은 바이트(transferSize)예요.
//   - CLS는 표준 계산(세션 창 중 최댓값, cls.mjs)이고, 비교용으로 모든 이동의 합도 함께 남겨요.
//   - 같은 빌드·같은 조건을 여러 번(기본 7번) 재서 가운데 값·25/75백분위·최소·최대를 남겨요. 가운데 값 하나로 좋아졌다/나빠졌다고 단정하지 않아요.
// 조건: CPU 4배 느리게 · 지연 150ms · 내려받기 1.6Mbps · 올리기 750kbps · 캐시 끔 · 화면 390×844(DPR 2)·1440×900
// 기수 정보는 운영 서버의 공개 함수를 일반 방문자처럼 읽어요(로그인 없음). 글꼴은 jsDelivr에서 받아요.
import { createServer } from "node:http"
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs"
import { join, extname } from "node:path"
import { gzipSync, brotliCompressSync, constants } from "node:zlib"
import { args, launch } from "./lib.mjs"
import { sessionClsSource } from "./cls.mjs"

const opt = args({ runs: "7", port: "8461", out: "perf-lab.json" })
if (!opt.dist || !existsSync(join(opt.dist, "index.html"))) { console.error("--dist=빌드 폴더(index.html이 있는 곳)를 지정해 주세요."); process.exit(2) }
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" }
const TEXT = /\.(html|js|css|svg|json|webmanifest)$/
const cache = new Map()
const server = createServer((req, res) => {
  let file = join(opt.dist, decodeURIComponent(new URL(req.url, "http://x").pathname))
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(opt.dist, "index.html")
  const body = readFileSync(file), type = TYPES[extname(file)] || "application/octet-stream"
  const accept = String(req.headers["accept-encoding"] || "")
  const enc = TEXT.test(file) ? (accept.includes("br") ? "br" : accept.includes("gzip") ? "gzip" : null) : null
  const key = `${file}|${enc}`
  if (!cache.has(key)) cache.set(key, enc === "br" ? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }) : enc === "gzip" ? gzipSync(body, { level: 9 }) : body)
  res.writeHead(200, { "content-type": type, ...(enc ? { "content-encoding": enc, vary: "Accept-Encoding" } : {}) })
  res.end(cache.get(key))
}).listen(Number(opt.port))

const PATHS = (opt.paths || "/,/start").split(",")
const VIEWS = [{ name: "모바일 390", width: 390, height: 844, dpr: 2, mobile: true }, { name: "데스크톱 1440", width: 1440, height: 900, dpr: 1, mobile: false }]
const browser = await launch({ chrome: opt.chrome })
const results = []
const q = (list, p) => { const s = [...list].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return Math.round((s[lo] + (s[hi] - s[lo]) * (i - lo)) * 1000) / 1000 }
for (const path of PATHS) for (const view of VIEWS) {
  const runs = []
  for (let i = 0; i < Number(opt.runs); i++) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: view.width, height: view.height, deviceScaleFactor: view.dpr, isMobile: view.mobile, hasTouch: view.mobile })
    const cdp = await page.createCDPSession()
    await cdp.send("Network.enable")
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 })
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
    await page.evaluateOnNewDocument(`window.__shifts=[];window.__lcp=0;new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lcp=e.startTime}).observe({type:"largest-contentful-paint",buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())window.__shifts.push({startTime:e.startTime,value:e.value,hadRecentInput:e.hadRecentInput})}).observe({type:"layout-shift",buffered:true});`)
    await page.goto(`http://localhost:${opt.port}${path}`, { waitUntil: "networkidle0", timeout: 120000 })
    await new Promise((r) => setTimeout(r, 1500))
    const m = await page.evaluate(`(() => { const cls = ${sessionClsSource}; const res = performance.getEntriesByType("resource"); const nav = performance.getEntriesByType("navigation")[0]; const kb = (f) => Math.round(res.filter(f).reduce((s, e) => s + (e.transferSize || 0), 0) / 102.4) / 10;
      return { lcp: Math.round(window.__lcp), fcp: Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0), clsStandard: Math.round(cls(window.__shifts) * 10000) / 10000, clsSum: Math.round(window.__shifts.filter(s => !s.hadRecentInput).reduce((a, s) => a + s.value, 0) * 10000) / 10000,
        htmlKB: Math.round((nav?.transferSize || 0) / 102.4) / 10, jsKB: kb(e => /\\.js(\\?|$)/.test(e.name)), cssKB: kb(e => /\\.css(\\?|$)/.test(e.name)), fontKB: kb(e => /woff2?/.test(e.name)), fontsWithoutSize: res.filter(e => /woff2?/.test(e.name) && !e.transferSize).length,
        encoding: res.filter(e => /\\.js$/.test(e.name)).map(e => e.encodedBodySize < e.decodedBodySize ? "압축" : "무압축")[0] || "" } })()`)
    runs.push(m)
    await context.close()
  }
  const stat = (k) => ({ p50: q(runs.map((r) => r[k]), 0.5), p25: q(runs.map((r) => r[k]), 0.25), p75: q(runs.map((r) => r[k]), 0.75), min: Math.min(...runs.map((r) => r[k])), max: Math.max(...runs.map((r) => r[k])) })
  const summary = { path, view: view.name, runs, lcp: stat("lcp"), fcp: stat("fcp"), clsStandard: stat("clsStandard"), clsSum: stat("clsSum"), jsKB: stat("jsKB"), cssKB: stat("cssKB"), fontKB: stat("fontKB"), htmlKB: stat("htmlKB") }
  results.push(summary)
  console.log(path, view.name, `LCP ${summary.lcp.p50}ms(${summary.lcp.p25}~${summary.lcp.p75}) · CLS 표준 ${summary.clsStandard.p50} · JS ${summary.jsKB.p50}KB 전송 · 글꼴 ${summary.fontKB.p50}KB · ${runs[0].encoding}`)
}
await browser.close(); server.close()
writeFileSync(opt.out, JSON.stringify({ kind: "실험실 측정(lab) — 실제 방문자 측정 아님", at: new Date().toISOString(), dist: opt.dist, conditions: "CPU 4x · 지연 150ms · 1.6Mbps/750kbps · 캐시 끔 · br/gzip 압축 서버", runsPerCase: Number(opt.runs), results }, null, 2))
