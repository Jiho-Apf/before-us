// 화면 점검 도구 공용 도우미(재현용). 특정 PC 경로에 묶이지 않게 인자·환경 변수로 받는다.
//   --base=http://localhost:8444   점검할 주소(기본: 로컬 개발 서버)
//   --out=경로                      결과 JSON 경로
//   --chrome=경로 / CHROME_PATH      Chrome 실행 파일(기본: Windows·macOS·Linux 흔한 위치에서 찾음)
//   PUPPETEER_CORE=경로              puppeteer-core 위치(기본: 저장소에서 require). 설치: npm i --no-save puppeteer-core@23.11.1
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

export function args(defaults = {}) {
  const out = { ...defaults }
  for (const raw of process.argv.slice(2)) {
    const m = raw.match(/^--([^=]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
    else if (raw.startsWith("--")) out[raw.slice(2)] = true
    else (out._ ??= []).push(raw)
  }
  return out
}

export function chromePath(given) {
  const list = [given, process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean)
  const found = list.find((p) => existsSync(p))
  if (!found) throw new Error("Chrome을 찾지 못했어요. --chrome=경로 또는 CHROME_PATH를 지정해 주세요.")
  return found
}

export function loadPuppeteer() {
  const where = process.env.PUPPETEER_CORE
  const req = createRequire(where ? join(where, "x.js") : import.meta.url)
  try { return req("puppeteer-core") } catch {
    throw new Error("puppeteer-core가 없어요. 저장소에서 `npm i --no-save puppeteer-core@23.11.1`을 하거나 PUPPETEER_CORE=설치폴더 를 지정해 주세요.")
  }
}

export async function launch(opt = {}) {
  const puppeteer = loadPuppeteer()
  return puppeteer.launch({ executablePath: chromePath(opt.chrome), headless: "new", args: ["--hide-scrollbars"] })
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
