import { useSyncExternalStore } from "react"
import { BEFORE_US } from "./config"
import type { AccountFacts } from "./application-model"

// 휴대폰 본인·성인 인증 (가상). 실제 인증 업체는 연결되어 있지 않다.
// 인증 결과의 원본 값(이름·전화번호·생년월일)은 저장하지 않고, 만 나이·인증 시각·가상 중복 확인 키만 남긴다.
export const IDENTITY_SCENARIOS = {
  adult: "성인 확인 성공 (가상)",
  minor: "만 19세 미만 결과 (가상)",
  failed: "인증 실패·취소 (가상)",
  rejoin: "이전 이용 제한 계정과 같은 인증값 (가상)",
} as const
export type IdentityScenario = keyof typeof IDENTITY_SCENARIOS
export type IdentityRecord = {
  memberId: string
  status: "verified" | "minor" | "failed"
  verifiedAge: number | null
  verifiedAt: string | null
  attemptedAt: string
  duplicateKey: string | null
  rejoinFlag: boolean
  provider: "가상 휴대폰 본인인증"
}
// 이전에 이용 제한된 계정의 가상 중복 확인 키. 실서비스는 인증 업체의 연계정보로 서버에서 대조해야 한다.
const RESTRICTED_KEYS = new Set(["virtual-key-restricted-1"])
let records: Record<string, IdentityRecord> = {}
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const getIdentity = (memberId: string) => records[memberId] || null
export const useIdentity = (memberId: string) => useSyncExternalStore(subscribe, () => getIdentity(memberId), () => null)
export function verifyIdentityDemo(memberId: string, scenario: IdentityScenario, age: number, now = new Date()) {
  if (!memberId || !(scenario in IDENTITY_SCENARIOS) || !Number.isInteger(age) || age < 14 || age > 99) return "가상 인증 결과와 만 나이를 확인해 주세요."
  const minimum = BEFORE_US.operatingDraft.minimumAge
  const status: IdentityRecord["status"] = scenario === "failed" ? "failed" : scenario === "minor" || age < minimum ? "minor" : "verified"
  const duplicateKey = status === "failed" ? null : scenario === "rejoin" ? "virtual-key-restricted-1" : `virtual-key-${memberId}`
  records = { ...records, [memberId]: { memberId, status, verifiedAge: status === "verified" ? age : null, verifiedAt: status === "verified" ? now.toISOString() : null, attemptedAt: now.toISOString(), duplicateKey, rejoinFlag: !!duplicateKey && RESTRICTED_KEYS.has(duplicateKey), provider: "가상 휴대폰 본인인증" } }
  listeners.forEach((listener) => listener())
  return null
}
// 회원 화면 계정과 관리자 사본을 같은 인증 기록으로 연결한다.
export function aliasIdentity(fromId: string, toId: string) {
  const record = records[fromId]
  if (!record || fromId === toId) return
  records = { ...records, [toId]: { ...record, memberId: toId } }
  listeners.forEach((listener) => listener())
}
export function identityAccount(record: IdentityRecord | null): AccountFacts {
  return record?.status === "verified" && record.verifiedAge !== null && record.verifiedAt ? { verifiedAge: record.verifiedAge, verifiedAt: record.verifiedAt } : {}
}
export function identityGate(record: IdentityRecord | null) {
  if (!record) return "본인·성인 인증을 먼저 진행해 주세요."
  if (record.status === "failed") return "인증이 완료되지 않았어요. 다시 시도해 주세요."
  if (record.status === "minor") return `비포어스는 만 ${BEFORE_US.operatingDraft.minimumAge}세 이상만 이용할 수 있어요.`
  return null
}
