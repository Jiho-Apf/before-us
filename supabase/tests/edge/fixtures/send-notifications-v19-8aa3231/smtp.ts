// 아주 작은 SMTP 보내기(465 포트 · TLS · AUTH LOGIN). Supabase 함수는 465 포트만 밖으로 열려 있다.
import { base64 } from "./mime.ts"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// 본문을 다 보낸 뒤 메일 서버의 답을 받지 못함: 서버가 이미 받았을 수 있다(다시 보내면 두 통이 갈 수 있음 → ‘불확실’로 남긴다).
export class UncertainDelivery extends Error {}

export class Smtp {
  private buffer = ""
  private conn: Deno.TlsConn
  // 연결이 끊겼는지(끊긴 뒤의 메일은 보내지 않고 다음 차례로 넘긴다)
  broken = false
  private constructor(conn: Deno.TlsConn) { this.conn = conn }

  static async open(hostname: string, username: string, password: string) {
    const client = new Smtp(await Deno.connectTls({ hostname, port: 465 }))
    try {
      await client.expect(220)
      await client.command("EHLO before-us", 250)
      await client.command("AUTH LOGIN", 334)
      await client.command(base64(username), 334)
      await client.command(base64(password), 235)
      return client
    } catch (error) {
      client.close()
      throw error
    }
  }

  // 응답 한 덩어리(여러 줄이면 마지막 줄이 "250 ..." 모양)를 읽는다.
  private async read() {
    for (;;) {
      const lines = this.buffer.split("\r\n")
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
          this.buffer = lines.slice(i + 1).join("\r\n")
          return lines.slice(0, i + 1).join("\n")
        }
      }
      const chunk = new Uint8Array(4096)
      let size: number | null
      try { size = await this.conn.read(chunk) } catch (error) { this.broken = true; throw error }
      if (size === null) { this.broken = true; throw new Error("메일 서버 연결이 끊겼어요.") }
      this.buffer += decoder.decode(chunk.subarray(0, size), { stream: true })
    }
  }

  private async expect(...codes: number[]) {
    const reply = await this.read()
    const last = reply.split("\n").pop() ?? ""
    if (!codes.some((code) => last.startsWith(String(code)))) throw new Error(reply.replace(/\s+/g, " ").slice(0, 300))
    return reply
  }

  // write는 한 번에 다 보내지 않을 수 있어(Deno 설명서) 끝까지 나눠 보낸다.
  private async writeAll(text: string) {
    const bytes = encoder.encode(text)
    try {
      for (let offset = 0; offset < bytes.length;) offset += await this.conn.write(bytes.subarray(offset))
    } catch (error) { this.broken = true; throw error }
  }

  private async command(line: string, ...codes: number[]) {
    await this.writeAll(`${line}\r\n`)
    return this.expect(...codes)
  }

  async send(from: string, to: string, message: string) {
    try {
      await this.command(`MAIL FROM:<${from}>`, 250)
      await this.command(`RCPT TO:<${to}>`, 250, 251)
      await this.command("DATA", 354)
      // 본문은 Base64라 줄 첫 글자가 "."인 경우가 없지만, 규칙대로 점을 한 번 더 붙인다.
      const body = message.replace(/\r\n\./g, "\r\n..")
      await this.writeAll(`${body}\r\n.\r\n`)
      // 여기부터는 서버가 메일을 받았을 수 있다: 답을 못 받으면 ‘불확실’, 거절 답(4xx·5xx)이면 확실한 실패.
      let reply: string
      try { reply = await this.read() } catch (error) {
        throw new UncertainDelivery(`본문을 보낸 뒤 메일 서버의 답을 받지 못했어요: ${String((error as Error)?.message ?? error).slice(0, 200)}`)
      }
      const last = reply.split("\n").pop() ?? ""
      if (!last.startsWith("250")) throw new Error(reply.replace(/\s+/g, " ").slice(0, 300))
    } catch (error) {
      if (!this.broken) await this.command("RSET", 250).catch(() => {})
      throw error
    }
  }

  async quit() {
    await this.command("QUIT", 221).catch(() => {})
    this.close()
  }

  close() {
    try { this.conn.close() } catch { /* 이미 닫힘 */ }
  }
}
