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
      closedAt: string | null
    }
export type LiveNotification = { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }
export type MemberSnapshot = {
  application: { status: ApplicationStatus; decisionNote: string | null; submittedAt: string | null } | null
  introduction: LiveIntroduction
  notifications: LiveNotification[]
  notices: { notice_daily_waiting: boolean; notice_new_introduction: boolean; marketing_opt_in: boolean; notify_kakao: boolean; notify_sms: boolean; notify_email: boolean; email_all: boolean; status: "active" | "withdrawal_requested" | "suspended"; paused_at: string | null; suspended_reason: string | null } | null
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
      db.from("profiles").select("notice_daily_waiting, notice_new_introduction, marketing_opt_in, notify_kakao, notify_sms, notify_email, email_all, status, paused_at, suspended_reason").eq("id", auth.user.id).maybeSingle(),
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
export function useMemberSnapshot() {
  const user = useAuth()
  const [state, setState] = useState<{ data: MemberSnapshot | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const reload = async () => {
    const result = await loadMemberSnapshot()
    setState({ ...result, loading: false })
  }
  useEffect(() => { if (user) void reload(); else setState({ data: null, error: null, loading: false }) }, [user?.id])
  return { ...state, reload }
}

export const markNotificationsRead = () => rpc<null>("mark_notifications_read")
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

export async function loadMyRequests() {
  const db = await supabase()
  const { data } = await db.from("member_requests").select("id, kind, description, status, decision, created_at").order("created_at", { ascending: false }).limit(20)
  return (data ?? []) as { id: string; kind: string; description: string | null; status: string; decision: string | null; created_at: string }[]
}

// 첫 마디: 소개된 상대가 가장 먼저 보는 한마디. 홈 공개는 본인이 켜고 운영진이 확인한 뒤에만.
export type Greeting = { body: string; showOnHome: boolean; homeStatus: "none" | "pending" | "approved" | "rejected"; homeReason: string | null }
export async function loadGreeting(): Promise<Greeting | null> {
  const db = await supabase()
  const { data: auth } = await db.auth.getUser()
  if (!auth.user) return null
  const { data } = await db.from("greetings").select("body, show_on_home, home_status, home_reason").eq("member_id", auth.user.id).maybeSingle()
  return data ? { body: data.body, showOnHome: data.show_on_home, homeStatus: data.home_status, homeReason: data.home_reason } : null
}
export const saveGreeting = (body: string, showOnHome: boolean) => rpc<{ body: string; showOnHome: boolean; homeStatus: Greeting["homeStatus"] }>("save_greeting", { p_body: body, p_show_on_home: showOnHome })
export const deleteGreeting = () => rpc<null>("delete_greeting")
