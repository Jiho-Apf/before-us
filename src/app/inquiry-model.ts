import { useSyncExternalStore } from "react"
import { getConsoleData, replaceConsoleData } from "./admin-console-data"

// 공개 고객 문의 (V6-inquiry-01). 회원·비회원 모두 남길 수 있고, 답변은 남긴 이메일로 보낸다.
// 데모에서는 브라우저 메모리에만 저장하며 실제 메일 발송은 연결되어 있지 않다.
export const INQUIRY_POLICY = { version: "V6-inquiry-01", bodyMin: 10, bodyMax: 1000, nameMax: 20, retention: "답변을 마친 뒤 3년" } as const
export const INQUIRY_TYPES = ["서비스 이용 방법", "신청·검토", "소개·교류", "결제·환불", "개인정보·탈퇴", "안전·신고", "제휴·기타", "베타 의견"] as const
export type InquiryType = (typeof INQUIRY_TYPES)[number]
export const INQUIRY_STATUS = { received: "접수", checking: "확인 중", answered: "답변 완료" } as const
export type InquiryStatus = keyof typeof INQUIRY_STATUS
export type Inquiry = {
  id: string
  type: InquiryType
  name: string
  email: string
  body: string
  at: string
  status: InquiryStatus
  answer: { body: string; at: string } | null
  consentAt: string
  policyVersion: string
}

let inquiries: Inquiry[] = []
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const commit = (next: Inquiry[]) => { inquiries = next; listeners.forEach((listener) => listener()) }
export const getInquiries = () => inquiries
export const useInquiries = () => useSyncExternalStore(subscribe, getInquiries, getInquiries)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
// 주민등록번호·카드번호처럼 문의에 필요 없는 민감정보는 받지 않는다.
const SENSITIVE = /(\d{6}\s?-\s?[1-4]\d{6})|(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})/
const kstStamp = (now: Date) => new Date(now.getTime() + 9 * 3600000).toISOString().slice(2, 10).replace(/-/g, "")

export function submitInquiry(input: { type: string; name: string; email: string; body: string; consent: boolean; website?: string }, now = new Date()) {
  if (input.website) return { error: "요청을 처리할 수 없어요.", id: null }
  if (!(INQUIRY_TYPES as readonly string[]).includes(input.type)) return { error: "문의 유형을 골라 주세요.", id: null }
  const email = input.email.trim().toLowerCase(), body = input.body.trim(), name = input.name.trim()
  if (!EMAIL.test(email)) return { error: "답변받을 이메일 주소를 확인해 주세요.", id: null }
  if (name.length > INQUIRY_POLICY.nameMax) return { error: `부르실 이름은 ${INQUIRY_POLICY.nameMax}자 이하로 적어 주세요.`, id: null }
  if (body.length < INQUIRY_POLICY.bodyMin || body.length > INQUIRY_POLICY.bodyMax) return { error: `문의 내용은 ${INQUIRY_POLICY.bodyMin}~${INQUIRY_POLICY.bodyMax}자로 적어 주세요.`, id: null }
  if (SENSITIVE.test(body)) return { error: "주민등록번호나 카드번호는 적지 말아 주세요. 필요한 경우 운영진이 안전한 방법으로 따로 확인해요.", id: null }
  if (!input.consent) return { error: "문의 응대를 위한 개인정보 수집·이용에 동의해 주세요.", id: null }
  if (inquiries.some((item) => item.email === email && item.body === body && now.getTime() - Date.parse(item.at) < 10 * 60000)) return { error: "같은 문의가 방금 접수됐어요. 잠시 후 접수 번호로 진행 상태를 확인해 주세요.", id: null }
  const id = `Q-${kstStamp(now)}-${String(inquiries.length + 1).padStart(3, "0")}`
  commit([...inquiries, { id, type: input.type as InquiryType, name, email, body, at: now.toISOString(), status: "received", answer: null, consentAt: now.toISOString(), policyVersion: INQUIRY_POLICY.version }])
  return { error: null, id }
}
// 접수 번호와 이메일이 모두 맞을 때만 본인 문의를 보여 준다.
export function findInquiry(id: string, email: string) {
  return inquiries.find((item) => item.id === id.trim().toUpperCase() && item.email === email.trim().toLowerCase()) || null
}
function audit(action: string, target: string, now: Date) {
  const admin = structuredClone(getConsoleData())
  admin.audits.push({ id: `inquiry-${admin.audits.length + 1}`, actor: "가상 Owner", at: now.toISOString(), action: `${action} · ${INQUIRY_POLICY.version}`, target, reason: "고객 문의 처리 · 본문·이메일 미기록", role: "Owner", result: "demo-only" })
  admin.source = "virtual"; replaceConsoleData(admin)
}
export function markInquiryChecking(id: string, now = new Date()) {
  const item = inquiries.find((entry) => entry.id === id)
  if (!item || item.status !== "received") return "접수 상태의 문의만 확인 중으로 바꿀 수 있어요."
  commit(inquiries.map((entry) => entry.id === id ? { ...entry, status: "checking" } : entry)); audit("문의 확인 시작", id, now)
  return null
}
export function answerInquiry(id: string, body: string, now = new Date()) {
  const item = inquiries.find((entry) => entry.id === id)
  if (!item) return "문의를 찾을 수 없어요."
  if (body.trim().length < 5 || body.length > 1500) return "답변은 5~1500자로 적어 주세요."
  if (SENSITIVE.test(body)) return "답변에 주민등록번호·카드번호를 넣을 수 없어요."
  commit(inquiries.map((entry) => entry.id === id ? { ...entry, status: "answered", answer: { body: body.trim(), at: now.toISOString() } } : entry)); audit(item.answer ? "문의 답변 수정" : "문의 답변 기록", id, now)
  return null
}
