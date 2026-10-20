// 메일 원문 만들기(표준 MIME). 한글 제목·보낸 사람 이름은 UTF-8 Base64로 감싸고, 본문(텍스트·HTML)도 Base64로 보낸다.
// 외부 라이브러리 없이 만든다(이전 라이브러리는 한글 제목과 머리 정보를 깨뜨렸다).
const encoder = new TextEncoder()

export function base64(text: string) {
  const bytes = encoder.encode(text)
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

// 한 줄 76자 이하로 나눈다.
const wrap = (value: string) => value.match(/.{1,76}/g)?.join("\r\n") ?? ""

// 머리 정보용 인코딩 단어(=?UTF-8?B?...?=). 글자가 잘리지 않게 39바이트 단위로 나눈다.
export function encodedWord(text: string) {
  if (/^[\x20-\x7e]*$/.test(text)) return text
  const parts: string[] = []
  let current = ""
  for (const char of text) {
    if (encoder.encode(current + char).length > 39) { parts.push(current); current = char } else current += char
  }
  if (current) parts.push(current)
  return parts.map((part) => `=?UTF-8?B?${base64(part)}?=`).join("\r\n ")
}

// "비포어스 <hello@example.com>" → { name, address }
export function parseAddress(value: string) {
  const match = value.match(/^\s*(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/)
  if (match) return { name: match[1].replace(/^"|"$/g, ""), address: match[2] }
  return { name: "", address: value.trim() }
}

export function buildMessage(input: { from: string; to: string; subject: string; text: string; html: string; id: string; date?: Date }) {
  const from = parseAddress(input.from)
  const boundary = `before-us-${input.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`
  const domain = from.address.split("@")[1] ?? "before-us"
  const headers = [
    `From: ${from.name ? `${encodedWord(from.name)} ` : ""}<${from.address}>`,
    `To: <${input.to}>`,
    `Subject: ${encodedWord(input.subject)}`,
    `Date: ${(input.date ?? new Date()).toUTCString()}`,
    `Message-ID: <${input.id}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
  const part = (type: string, body: string) => [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", wrap(base64(body))].join("\r\n")
  return [...headers, "", part("text/plain", input.text), part("text/html", input.html), `--${boundary}--`, ""].join("\r\n")
}
