// 누름 영역 점검의 단위 시험(R3-09 반례). 실행: node scripts/checks/target-size.test.mjs [--chrome=경로]
// 100×20·20×100·43×43은 잡혀야 하고 44×44는 통과해야 한다. 이름표로 함께 눌리는 16px 체크 상자(이름표 높이 44)는 통과,
// 문장 안 링크는 inline 예외로 표시, 머리·대화 상자 안 단추도 범위에 들어가야 한다.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { args, launch } from "./lib.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const scan = readFileSync(join(here, "target-size.js"), "utf8")
const opt = args()
const html = `<!doctype html><html><body style="margin:0;font:14px sans-serif">
<header><button id="h" style="width:30px;height:30px;padding:0;border:0">메</button></header>
<main>
<button id="b1" style="width:100px;height:20px;padding:0;border:0">가로긴</button>
<button id="b2" style="width:20px;height:100px;padding:0;border:0">세</button>
<button id="b3" style="width:43px;height:43px;padding:0;border:0">43</button>
<button id="b4" style="width:44px;height:44px;padding:0;border:0">44</button>
<label style="display:flex;align-items:center;gap:8px;height:44px;width:200px"><input id="c1" type="checkbox" style="width:16px;height:16px;margin:0">이름표로 눌려요</label>
<input id="c2" type="checkbox" style="width:16px;height:16px;margin:0"> <span>이름표 없는 체크 상자</span>
<style>.hit{position:relative}.hit::after{content:"";position:absolute;top:-9px;bottom:-9px;left:0;right:0}</style><button id="h1" class="hit" style="width:60px;height:26px;padding:0;border:0">덧칸</button>
<p>문장 안에 <a id="l1" href="#x">짧은 링크</a>가 있어요. 문장 안 링크는 인라인 예외예요.</p>
</main>
<div role="dialog" aria-modal="true"><button id="d1" style="width:40px;height:40px;padding:0;border:0">×</button></div>
</body></html>`
const browser = await launch({ chrome: opt.chrome })
const page = await browser.newPage()
await page.setViewport({ width: 800, height: 900 })
await page.setContent(html)
const found = await page.evaluate(scan)
await browser.close()
const by = (label) => found.find((f) => f.name.startsWith(label))
const checks = [
  ["100×20은 잡혀요", !!by("가로긴")],
  ["20×100은 잡혀요", !!by("세")],
  ["43×43은 잡혀요", !!by("43")],
  ["44×44는 통과해요", !by("44")],
  ["이름표 높이 44인 16px 체크 상자는 통과해요(실제 누름 영역)", !found.some((f) => f.tag === "input" && f.via === "label")],
  ["이름표 없는 16px 체크 상자는 잡히고 24px 미만으로 표시돼요", found.some((f) => f.tag === "input" && !f.via && f.wcag24)],
  ["문장 안 링크는 인라인 예외로 표시돼요", by("짧은 링크")?.inline === true],
  ["보이지 않는 덧칸으로 44px까지 넓힌 26px 단추는 통과해요", !by("덧칸")],
  ["머리 안 단추도 범위에 들어가요", by("메")?.region === "header"],
  ["대화 상자 안 단추도 범위에 들어가요", by("×")?.region === "dialog"],
]
// 대조군: 예전 조건(가로 AND 세로가 모두 44보다 작을 때만)으로는 100×20·20×100을 놓친다
const old = found.filter((f) => f.w < 44 && f.h < 44)
checks.push(["대조군: 예전 AND 조건은 100×20·20×100을 놓쳐요", !old.some((f) => f.name.startsWith("가로긴")) && !old.some((f) => f.name.startsWith("세"))])
let fail = 0
for (const [label, ok] of checks) { console.log(`${ok ? "✓" : "✗"} ${label}`); if (!ok) fail++ }
console.log(fail ? `실패 ${fail}개` : `누름 영역 점검 단위 시험 통과: ${checks.length}개`)
process.exit(fail ? 1 : 0)
