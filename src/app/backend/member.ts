import { useEffect, useState } from "react"
import { useAuth } from "../auth-service"
import { friendlyError, rpc, supabase } from "./client"
import type { ApplicationStatus } from "./applications"
import type { Program } from "./program"

// 실제 서버의 회원 화면 자료: 신청 상태 · 지금의 소개 · 알림 · 회원 요청.
export type LiveProfile = { version: number; items: { id: string; value: string | string[] }[]; photos: { slot: string; path: string }[]; greeting?: string | null }
export type LiveIntroduction =
  | { status: "waiting" }
  | {
      id: string
      status: "published" | "mutual" | "closed" | "expired"
      publishedAt: string | null
      dueAt: string
      viewUntil: string
      note: string | null
      profile: LiveProfile | null
      ownResponse: "positive" | "negative" | null
      ownResponseAt: string | null
      opened: boolean
      mutual: boolean
      endReason: string | null
      endedByMe?: boolean
      counted?: boolean | null
      closedAt: string | null
    }
export type LiveNotification = { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }
export type MemberSnapshot = {
  application: { status: ApplicationStatus; decisionNote: string | null; submittedAt: string | null } | null
  introduction: LiveIntroduction
  notifications: LiveNotification[]
  notices: { notice_daily_waiting: boolean; notice_new_introduction: boolean; marketing_opt_in: boolean; notify_kakao: boolean; notify_sms: boolean; notify_email: boolean; email_all: boolean; status: "active" | "withdrawal_requested" | "suspended"; paused_at: string | null; paused_by?: "member" | "operator" | "auto" | null; suspended_reason: string | null } | null
  cohort: { number: number; startsOn: string; applicationDeadline: string } | null
  program: Program | null
}

export async function loadMemberSnapshot(): Promise<{ data: MemberSnapshot | null; error: string | null }> {
  try {
    const db = await supabase()
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return { data: null, error: "로그인이 필요해요." }
    const [application, introduction, notifications, profile, cohort, program] = await Promise.all([
      db.from("applications").select("status, decision_note, submitted_at").eq("member_id", auth.user.id).maybeSingle(),
      db.rpc("my_introduction"),
      db.from("notifications").select("id, kind, title, body, link, created_at, read_at").order("created_at", { ascending: false }).limit(10),
      db.from("profiles").select("notice_daily_waiting, notice_new_introduction, marketing_opt_in, notify_kakao, notify_sms, notify_email, email_all, status, paused_at, paused_by, suspended_reason").eq("id", auth.user.id).maybeSingle(),
      db.rpc("my_cohort"),
      db.rpc("my_program"),
    ])
    const failed = application.error || introduction.error || notifications.error || profile.error
    if (failed) return { data: null, error: friendlyError(failed) }
    return {
      data: {
        application: application.data ? { status: application.data.status, decisionNote: application.data.decision_note, submittedAt: application.data.submitted_at } : null,
        introduction: (introduction.data ?? { status: "waiting" }) as LiveIntroduction,
        notifications: (notifications.data ?? []) as LiveNotification[],
        notices: profile.data ?? null,
        cohort: (cohort.data as MemberSnapshot["cohort"]) ?? null,
        program: program.error ? null : ((program.data as Program | null) ?? null),
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: friendlyError(error as Error) }
  }
}

// 로그인한 회원의 화면 자료를 불러오고, 다시 불러오는 함수를 함께 준다.
// 다음 상태 변경 시각까지 남은 시간(서버 작업이 10분 주기라 1분 여유를 둔다)
function untilNextBoundary(now = Date.now()) {
  const kst = new Date(now + 9 * 3600000)
  const base = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600000
  const marks = [[9, 11], [11, 11], [12, 1], [12, 6]].map(([h, m]) => base + (h * 60 + m) * 60000)
  const next = marks.find(at => at > now + 1000) ?? marks[0] + 86400000
  return Math.min(next - now, 6 * 3600000)
}

export function useMemberSnapshot() {
  const user = useAuth()
  const [state, setState] = useState<{ data: MemberSnapshot | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const reload = async () => {
    const result = await loadMemberSnapshot()
    setState({ ...result, loading: false })
  }
  useEffect(() => { if (user) void reload(); else setState({ data: null, error: null, loading: false }) }, [user?.id])
  // 창을 다시 볼 때와, 상태가 바뀌는 시각(09:00 교류·만남 마감, 11:00 응답 마감, 12:00·12:05 정오 소개)에 저절로 다시 불러온다.
  useEffect(() => {
    if (!user) return
    const onVisible = () => { if (document.visibilityState === "visible") void reload() }
    document.addEventListener("visibilitychange", onVisible)
    let timer = 0
    const schedule = () => { timer = window.setTimeout(() => { if (document.visibilityState === "visible") void reload(); schedule() }, untilNextBoundary()) }
    schedule()
    return () => { document.removeEventListener("visibilitychange", onVisible); window.clearTimeout(timer) }
  }, [user?.id])
  return { ...state, reload }
}

export const markNotificationsRead = () => rpc<null>("mark_notifications_read")

// 읽지 않은 알림 수(회원 메뉴 '오늘'의 점 표시). 화면을 옮길 때마다 다시 센다. key가 null이면 세지 않는다(데모).
export function useUnreadCount(key: string | null) {
  const user = useAuth()
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!user || key === null) { setCount(0); return }
    let alive = true
    void (async () => {
      try {
        const db = await supabase()
        const { count: n } = await db.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null)
        if (alive) setCount(n ?? 0)
      } catch { /* 표시만 생략 */ }
    })()
    return () => { alive = false }
  }, [user?.id, key])
  return count
}
export const recordIntroductionView = (id: string) => rpc<null>("record_introduction_view", { p_id: id })
export const respondIntroduction = (id: string, choice: "positive" | "negative", reason?: string | null) =>
  rpc<LiveIntroduction>("respond_introduction", { p_id: id, p_choice: choice, p_reason: reason ?? null })
export const blockPartner = (introduction: string) => rpc<null>("block_partner", { p_introduction: introduction })
export const reportPartner = (introduction: string, type: string, description: string, urgent: boolean) =>
  rpc<string>("report_partner", { p_introduction: introduction, p_type: type, p_description: description, p_urgent: urgent })
export const submitMemberRequest = (kind: string, description: string) => rpc<string>("submit_member_request", { p_kind: kind, p_description: description })

// 새 소개 잠시 쉬기 · 다시 받기(진행 중인 소개는 그대로)
export const setPaused = (paused: boolean) => rpc<{ paused: boolean }>("set_paused", { p_paused: paused })
// 알림 받을 방법: 카카오톡·문자 중 1개 이상, 메일은 선택
export const setNotifyChannels = (kakao: boolean, sms: boolean, email: boolean) => rpc<null>("set_notify_channels", { p_kakao: kakao, p_sms: sms, p_email: email })

export async function saveNoticeSettings(values: Partial<Pick<NonNullable<MemberSnapshot["notices"]>, "notice_daily_waiting" | "notice_new_introduction" | "marketing_opt_in" | "email_all">>) {
  try {
    const db = await supabase()
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return { error: "로그인이 필요해요." }
    const { error } = await db.from("profiles").update(values).eq("id", auth.user.id)
    return { error: error ? friendlyError(error) : null }
  } catch (error) {
    return { error: friendlyError(error as Error) }
  }
}

// 연결이 끊겨도 화면이 멈추지 않도록 실패하면 빈 목록을 돌려준다.
export async function loadMyRequests() {
  try {
    const db = await supabase()
    const { data, error } = await db.from("member_requests").select("id, kind, description, status, decision, created_at").order("created_at", { ascending: false }).limit(20)
    if (error) return null
    return (data ?? []) as { id: string; kind: string; description: string | null; status: string; decision: string | null; created_at: string }[]
  } catch {
    return null
  }
}

// 첫 마디: 소개된 상대가 가장 먼저 보는 한마디. 홈 공개는 본인이 켜고 운영진이 확인한 뒤에만.
export type Greeting = { body: string; showOnHome: boolean; homeStatus: "none" | "pending" | "approved" | "rejected"; homeReason: string | null }
export async function loadGreeting(): Promise<Greeting | null> {
  try {
    const db = await supabase()
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return null
    const { data } = await db.from("greetings").select("body, show_on_home, home_status, home_reason").eq("member_id", auth.user.id).maybeSingle()
    return data ? { body: data.body, showOnHome: data.show_on_home, homeStatus: data.home_status, homeReason: data.home_reason } : null
  } catch {
    return null
  }
}
export const saveGreeting = (body: string, showOnHome: boolean) => rpc<{ body: string; showOnHome: boolean; homeStatus: Greeting["homeStatus"] }>("save_greeting", { p_body: body, p_show_on_home: showOnHome })
export const deleteGreeting = () => rpc<null>("delete_greeting")

// 아는 사람 피하기: 적은 번호로 신청한 분과는 서로 소개하지 않는다. 번호는 서버에서 해시로만 저장하고, 뒤 네 자리와 메모만 돌려받는다.
export type AvoidContact = { id: string; tail: string; memo: string | null; created_at: string }
export const loadAvoidContacts = () => rpc<AvoidContact[]>("my_avoid_contacts")
export const addAvoidContacts = (phones: string[]) => rpc<number>("add_avoid_contacts", { p_phones: phones })
export const deleteAvoidContact = (id: string) => rpc<null>("delete_avoid_contact", { p_id: id })
