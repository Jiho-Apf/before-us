// 결제 도우미(supabase/functions/_shared/toss.ts) 시험 — 가짜 Deno.env·fetch로(실제 결제사는 부르지 않는다).
// 실행: node supabase/tests/edge/toss.test.mjs
//  · 베타(테스트 주문)는 라이브 키로 승인하지 않는다 → 실제 돈이 나갈 수 없다
//  · 라이브 주문은 라이브 키만 · 모르는 모드는 승인하지 않는다
//  · 승인·취소 요청은 주문 번호로 만든 멱등키를 보낸다(같은 주문을 다시 보내도 한 번만 처리)
//  · 기록에 남기는 값에 카드 번호·승인 번호·고객 정보가 없다
import assert from "node:assert/strict"

let passed = 0
const ok = (label, value) => { assert.ok(value, label); passed++; console.log("✓", label) }
const env = {}
globalThis.Deno = { env: { get: (name) => env[name] } }
const { secretKeyFor, confirmPayment, cancelPayment, trimPayment } = await import("../../functions/_shared/toss.ts")

delete env.TOSS_SECRET_KEY
ok("테스트 주문 + 키 없음 → 토스 문서 공개 테스트 키", secretKeyFor("test")?.startsWith("test_"))
env.TOSS_SECRET_KEY = "live_sk_FAKEFAKEFAKE"
ok("테스트 주문(베타) + 라이브 키 → 승인하지 않음(실제 돈이 나갈 수 없음)", secretKeyFor("test") === null)
ok("라이브 주문 + 라이브 키 → 그 키", secretKeyFor("live") === "live_sk_FAKEFAKEFAKE")
env.TOSS_SECRET_KEY = "test_sk_FAKEFAKEFAKE"
ok("라이브 주문 + 테스트 키 → 승인하지 않음", secretKeyFor("live") === null)
ok("테스트 주문 + 테스트 키 → 그 키", secretKeyFor("test") === "test_sk_FAKEFAKEFAKE")
ok("모르는 모드 → 승인하지 않음", secretKeyFor("beta") === null && secretKeyFor("") === null)

const calls = []
globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ status: "DONE", orderId: "BUI-x", totalAmount: 10000 }), { status: 200 }) }
await confirmPayment("test_sk_FAKE", "pk_1", "BUI-abc123", 10000)
await confirmPayment("test_sk_FAKE", "pk_1", "BUI-abc123", 10000)
ok("승인 요청은 주문 번호로 만든 같은 멱등키를 보낸다(두 번 보내도 결제사는 한 번만 승인)", calls.length === 2 && calls.every((c) => c.init.headers["Idempotency-Key"] === "confirm-BUI-abc123"))
ok("인증은 ‘키:’를 Base64로(콜론 포함)", calls[0].init.headers.Authorization === `Basic ${btoa("test_sk_FAKE:")}`)
ok("승인 요청에는 서버 주문 금액이 그대로 간다", JSON.parse(calls[0].init.body).amount === 10000)
await cancelPayment("test_sk_FAKE", "pk/1", "BUI-abc123", "중복 결제 자동 취소".repeat(30))
const cancel = calls.at(-1)
ok("취소 요청도 멱등키(cancel-주문 번호) · 결제 키는 주소에 맞게 감싼다 · 사유는 200자까지", cancel.init.headers["Idempotency-Key"] === "cancel-BUI-abc123" && cancel.url.endsWith("/pk%2F1/cancel") && JSON.parse(cancel.init.body).cancelReason.length === 200)
globalThis.fetch = async () => { throw new Error("network down") }
const down = await confirmPayment("test_sk_FAKE", "pk_1", "BUI-abc123", 10000)
ok("결제사에 닿지 못하면 NETWORK(화면은 같은 주문으로 다시 확인 → 멱등키로 같은 결과)", down.ok === false && down.code === "NETWORK")

const trimmed = JSON.stringify(trimPayment({ status: "DONE", method: "카드", totalAmount: 10000, card: { number: "12345678****000*", approveNo: "00000000", issuerCode: "61", cardType: "신용", ownerType: "개인" }, customerName: "홍길동", customerEmail: "a@example.test", customerMobilePhone: "01012345678", secret: "ps_xxx", receipt: { url: "https://example.test/r" } }))
ok("기록에 카드 번호·승인 번호·고객 이름·메일·전화·secret이 남지 않는다", !/12345678|approveNo|00000000|홍길동|a@example|0101234|ps_xxx/.test(trimmed))
console.log(`결제 도우미 시험 통과: ${passed}개`)
