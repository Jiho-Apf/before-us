// 메일 함수의 SMTP 보내기(supabase/functions/send-notifications/smtp.ts) 시험 — 가짜 메일 서버로(실제 메일은 보내지 않는다).
// 실행: node supabase/tests/edge/smtp.test.mjs (Node 22.6+ · .ts 파일의 타입을 지우고 읽는다)
//  1) 연결이 한 번에 몇 바이트씩만 받아도(write 일부만 처리) 메일 원문이 깨지지 않고 끝까지 간다
//  2) 본문을 다 보낸 뒤 서버가 답 없이 끊기면 ‘불확실(UncertainDelivery)’ — 다시 보내지 않아야 하는 경우
//  3) 본문 뒤 서버가 거절(550)하면 확실한 실패(불확실 아님) · 연결은 그대로
//  4) 받는 사람 단계에서 연결이 끊기면 확실한 실패이고 연결이 끊긴 것으로 표시(남은 메일은 다음 차례로)
import assert from "node:assert/strict"

const encoder = new TextEncoder(), decoder = new TextDecoder()
let passed = 0
const SOFT = !!process.env.SMTP_IMPL
let failedCount = 0
const ok = (label, value) => { if (SOFT && !value) { failedCount++; console.log("✗", label); return } assert.ok(value, label); passed++; console.log("✓", label) }

// 가짜 메일 서버: 명령 한 줄마다 정해진 답을 준다. afterData: 'ok' | 'reject' | 'drop' · dropAt: 이 명령에서 끊기
function fakeServer({ afterData = "ok", dropAt = null, chunk = 1 << 20 } = {}) {
  const state = { mode: "command", inbox: "", data: "", replies: ["220 fake ready\r\n"], closed: false, waiters: [], received: [] }
  const push = (text) => { state.replies.push(text); state.waiters.splice(0).forEach((w) => w()) }
  const close = () => { state.closed = true; state.waiters.splice(0).forEach((w) => w()) }
  const onLine = (line) => {
    state.received.push(line)
    if (dropAt && line.startsWith(dropAt)) return close()
    if (line.startsWith("EHLO")) push("250-fake\r\n250 AUTH LOGIN\r\n")
    else if (line === "AUTH LOGIN") push("334 VXNlcm5hbWU6\r\n")
    else if (state.received.length === 3) push("334 UGFzc3dvcmQ6\r\n")
    else if (state.received.length === 4) push("235 ok\r\n")
    else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO") || line === "RSET") push("250 ok\r\n")
    else if (line === "DATA") { state.mode = "data"; push("354 go\r\n") }
    else if (line === "QUIT") { push("221 bye\r\n"); close() }
  }
  const conn = {
    async write(bytes) {
      if (state.closed) throw new Error("broken pipe")
      const part = bytes.subarray(0, Math.min(chunk, bytes.length)) // 일부만 받는다
      const text = decoder.decode(part, { stream: true })
      if (state.mode === "data") {
        state.data += text
        const end = state.data.indexOf("\r\n.\r\n")
        if (end >= 0) {
          state.message = state.data.slice(0, end)
          state.mode = "command"; state.data = ""
          if (afterData === "ok") push("250 2.0.0 queued\r\n")
          else if (afterData === "reject") push("550 5.1.1 no such user\r\n")
          else close()
        }
      } else {
        state.inbox += text
        let at
        while ((at = state.inbox.indexOf("\r\n")) >= 0) { const line = state.inbox.slice(0, at); state.inbox = state.inbox.slice(at + 2); onLine(line) }
      }
      return part.length
    },
    async read(buffer) {
      for (;;) {
        if (state.replies.length) { const bytes = encoder.encode(state.replies.shift()); buffer.set(bytes); return bytes.length }
        if (state.closed) return null
        await new Promise((resolve) => state.waiters.push(resolve))
      }
    },
    close() { state.closed = true },
  }
  return { conn, state }
}

// SMTP_IMPL: 고치기 전 파일로 같은 시험을 돌려 결함을 재현할 때(대조군)
const impl = process.env.SMTP_IMPL ? (await import("node:url")).pathToFileURL(process.env.SMTP_IMPL).href : "../../functions/send-notifications/smtp.ts"
const { Smtp, UncertainDelivery = class Never extends Error {} } = await import(impl)
const { buildMessage } = await import("../../functions/send-notifications/mime.ts")
const message = buildMessage({ from: "플라비 <sender@example.test>", to: "member@example.test", subject: "[플라비] 오늘의 인연이 도착했어요", text: "확인해 주세요.\n".repeat(40), html: "<p>확인해 주세요.</p>".repeat(40), id: "00000000-0000-4000-8000-000000000001" })
let lastServer = null
const open = async (options) => {
  const server = fakeServer(options)
  lastServer = server
  globalThis.Deno = { connectTls: async () => server.conn }
  const client = await Promise.race([Smtp.open("smtp.example.test", "sender@example.test", "app-password"), new Promise((resolve) => setTimeout(() => resolve(null), 2000))])
  if (!client) return { client: null, server }
  // 예전 코드(SMTP_IMPL로 바꿔 끼움)에는 broken 표시가 없다
  if (!("broken" in client)) client.broken = undefined
  return { client, server }
}
// 멈춤(답을 기다리며 끝나지 않음)도 실패로 본다
const outcome = (promise) => Promise.race([promise.then(() => "보냄", (error) => error), new Promise((resolve) => setTimeout(() => resolve(new Error("멈춤(2초 안에 끝나지 않음)")), 2000))])

{
  const { client, server } = await open({ chunk: 7 })
  const result = client ? await outcome(client.send("sender@example.test", "member@example.test", message)) : new Error("로그인 단계에서 멈춤")
  ok("1) 7바이트씩만 받는 연결에서도 보낸다", result === "보냄")
  ok("1) 메일 원문이 한 글자도 빠지지 않고 도착한다", server.state.message === message.replace(/\r\n\./g, "\r\n.."))
  if (client) await client.quit()
}
{
  const { client } = await open({ afterData: "drop" })
  const result = await outcome(client.send("sender@example.test", "member@example.test", message))
  ok("2) 본문을 보낸 뒤 답 없이 끊기면 ‘불확실’(다시 보내지 않음)", result instanceof UncertainDelivery)
  ok("2) 연결이 끊긴 것으로 표시된다(남은 메일은 보내지 않고 다음 차례로)", client.broken === true)
  await client.quit()
}
{
  const { client } = await open({ afterData: "reject" })
  const result = await outcome(client.send("sender@example.test", "member@example.test", message))
  ok("3) 서버가 거절하면 확실한 실패(불확실 아님)", result instanceof Error && !(result instanceof UncertainDelivery) && /550/.test(result.message))
  ok("3) 거절은 연결을 끊지 않는다(다음 메일은 계속)", client.broken === false)
  await outcome(client.send("sender@example.test", "member2@example.test", message))
  ok("3) 거절 뒤 RSET으로 정리하고 다음 메일을 이어서 보낸다", lastServer.state.received.filter((l) => l === "RSET").length >= 1 && lastServer.state.received.filter((l) => l.startsWith("MAIL FROM")).length === 2)
  await client.quit()
}
{
  const { client } = await open({ dropAt: "RCPT TO" })
  const result = await outcome(client.send("sender@example.test", "member@example.test", message))
  ok("4) 받는 사람 단계에서 끊기면 확실한 실패(불확실 아님)", result instanceof Error && !(result instanceof UncertainDelivery))
  ok("4) 연결이 끊긴 것으로 표시된다", client.broken === true)
  await client.quit()
}
console.log(SOFT ? `대조군(예전 코드): 통과 ${passed}개 · 실패 ${failedCount}개` : `SMTP 보내기 시험 통과: ${passed}개`)
process.exit(0)
