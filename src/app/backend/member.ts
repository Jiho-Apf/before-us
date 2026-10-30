import { useEffect, useState } from "react"
import { useAuth } from "../auth-service"
import { friendlyError, rpc, supabase } from "./client"
import type { ApplicationStatus } from "./applications"
import type { Program } from "./program"

// 실제 서버의 회원 화면 자료: 신청 상태 · 지금의 소개 · 알림 · 회원 요청.
export type LiveProfile = { version: number; items: { id: string; value: string | string[] }[]; photos: { slot: string; path: string }[]; greeting?: string | null }
// 두 분의 궁합: 예약 때 운영진 화면이 두 분 모두 공개한 항목으로 만든 글. 정오 공개부터 열람 기간에만 오고,
// 점수는 65 이상일 때만 숫자로 온다(그 아래는 null · 이유만). 예전 소개에는 없다(null).
export type IntroMatch = { score: number | null; headline: string; why: string[]; together: string[] }
export type LiveIntroduction =
  | { status: "waiting" }
  | {
      id: string
      status: "published" | "mutual" | "closed" | "expired"
      publishedAt: string | null
      dueAt: string
      viewUntil: string
      note: string | null
      match?: IntroMatch | null
      profile: LiveProfile | null
      ownResponse: "positive" | "negative" | null
      ownResponseAt: string | null
      opened: boolean
      mutual: boolean
      endReason: string | null
      endedByMe?: boolean
      counted?: boolean | null
      closedAt: string | null
      // 교류 뒤 내가 남긴 한 줄을 운영진이 반영해 고른 소개인지
      reflected?: boolean
    }
export type LiveNotification = { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }
export type MemberSnapshot = {
  application: { status: ApplicationStatus; decisionNote: string | null; submittedAt: string | null } | null
  introduction: LiveIntroduction
  notifications: LiveNotification[]
  notices: { notice_daily_waiting: boolean; notice_new_introduction: boolean; marketing_opt_in: boolean; notify_kakao: boolean; notify_sms: boolean; notify_email: boolean; email_all: boolean; status: "active" | "withdrawal_requested" | "suspended"; paused_at: string | null; resumed_at?: string | null; paused_by?: "member" | "operator" | "auto" | null; suspended_reason: string | null } | null
  cohort: { number: number; startsOn: string; applicationDeadline: string } | null
  program: Program | null
  // 회원 혜택(대표가 정함). 'unlimited' = 결제 없이 이용하는 계정. 본인 내 정보에만 조용히 보여 주고, 상대에게는 보이지 않는다.
  perk?: "unlimited" | null
  // 사진 안내: 다시 올려 달라고 한 사진(승인 전) · 운영진의 교체 요청(승인 뒤) · 확인을 기다리는 교체 사진. 못 읽으면 null.
  photos?: MemberPhotoState | null
}
export type MemberPhotoState = {
  requests: { slot: string; reason: string | null }[]
  changes: { slot: string; reason: string; requestedAt: string | null }[]
  replacements: { slot: string; review: "대기" | "재등록 요청"; reason: string | null }[]
}

// 오늘 화면은 처음에 10개를 보여 주고 ‘지난 알림 더 보기’로 30개까지 펼친다. 읽음은 화면에 보여 준 것만 바꾼다.
export const NOTIFICATION_LOAD = 30
export const NOTIFICATION_FIRST = 10

// 신청서를 고칠 수 없는 때(회원이 이미 볼 수 있는 진행 중 소개·교류가 있을 때)의 안내. 없으면 null.
// 서버(prepare_application_edit)도 같은 기준으로 막는다. 회원이 모르는 정오 예약은 여기서 말하지 않는다.
export const EDIT_BLOCKED = "지금 진행 중인 소개나 교류가 있어요. 고친 내용은 이번 소개·교류가 끝난 뒤에 보낼 수 있어요. 그동안 지금 신청서 그대로 이어져요."
export function editBlockReason(introduction: LiveIntroduction, program: Program | null) {
  const live = introduction.status === "published" || introduction.status === "mutual"
  return live || (program && program.status !== "closed") ? EDIT_BLOCKED : null
}
export async function loadEditBlock(): Promise<string | null> {
  try {
    const db = await supabase()
    const [introduction, program] = await Promise.all([db.rpc("my_introduction"), db.rpc("my_program")])
    return editBlockReason((introduction.data ?? { status: "waiting" }) as LiveIntroduction, program.error ? null : ((program.data as Program | null) ?? null))
  } catch {
    return null // 확인하지 못하면 막지 않는다(제출할 때 서버가 다시 확인한다).
  }
}

// 내 정보의 알림 설정(신청서를 다시 고칠 때 신청서 칸을 이 값으로 맞춘다).
export async function loadNoticeSettings() {
  try {
    const db = await supabase()
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return null
    const { data } = await db.from("profiles").select("notice_daily_waiting, marketing_opt_in, notify_kakao, notify_sms, notify_email").eq("id", auth.user.id).maybeSingle()
    return (data ?? null) as { notice_daily_waiting: boolean; marketing_opt_in: boolean; notify_kakao: boolean; notify_sms: boolean; notify_email: boolean } | null
  } catch {
    return null
  }
}

export async function loadMemberSnapshot(): Promise<{ data: MemberSnapshot | null; error: string | null }> {
  try {
    const db = await supabase()
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return { data: null, error: "로그인이 필요해요." }
    const [application, introduction, notifications, profile, cohort, program, perk, photoRows, swaps] = await Promise.all([
      db.from("applications").select("status, decision_note, submitted_at").eq("member_id", auth.user.id).maybeSingle(),
      db.rpc("my_introduction"),
      db.from("notifications").select("id, kind, title, body, link, created_at, read_at").order("created_at", { ascending: false }).limit(NOTIFICATION_LOAD),
      db.from("profiles").select("notice_daily_waiting, notice_new_introduction, marketing_opt_in, notify_kakao, notify_sms, notify_email, email_all, status, paused_at, resumed_at, paused_by, suspended_reason").eq("id", auth.user.id).maybeSingle(),
      db.rpc("my_cohort"),
      db.rpc("my_program"),
      // 혜택 칸은 따로 읽는다(못 읽어도 화면은 그대로 · 보통 회원으로 본다).
      db.from("profiles").select("perk").eq("id", auth.user.id).maybeSingle(),
      // 사진 안내도 못 읽으면 빼고 보여 준다.
      db.from("application_photos").select("slot, review, reason, change_reason, change_requested_at").eq("member_id", auth.user.id),
      db.from("photo_replacements").select("slot, review, reason").eq("member_id", auth.user.id),
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
        perk: !perk.error && (perk.data as { perk?: string | null } | null)?.perk === "unlimited" ? "unlimited" : null,
        photos: photoRows.error || swaps.error ? null : photoState((photoRows.data ?? []) as PhotoStateRow[], (swaps.data ?? []) as MemberPhotoState["replacements"]),
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: friendlyError(error as Error) }
  }
}

const SLOT_ORDER = ["photo.face", "photo.upper", "photo.style", "photo.daily"]
const bySlot = <T extends { slot: string }>(list: T[]) => [...list].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
type PhotoStateRow = { slot: string; review: string; reason: string | null; change_reason: string | null; change_requested_at: string | null }
function photoState(rows: PhotoStateRow[], replacements: MemberPhotoState["replacements"]): MemberPhotoState {
  return {
    requests: bySlot(rows.filter(row => row.review === "재등록 요청").map(row => ({ slot: row.slot, reason: row.reason }))),
    changes: bySlot(rows.filter(row => row.change_reason).map(row => ({ slot: row.slot, reason: row.change_reason!, requestedAt: row.change_requested_at }))),
    replacements: bySlot(replacements),
  }
}

// 사진 교체 기한: 운영진이 교체를 요청하고 7일 안에 새 사진을 올리지 않으면 새 소개를 잠시 멈춘다(서버 photo_hold_at과 같은 기준).
// 확인을 기다리는 새 사진이 있는 칸은 세지 않는다. 남은 요청이 없으면 null.
export const PHOTO_HOLD_DAYS = 7
export function photoHoldAt(photos: MemberPhotoState | null | undefined): string | null {
  if (!photos) return null
  const times = photos.changes
    .filter(change => change.requestedAt && !photos.replacements.some(swap => swap.slot === change.slot && swap.review === "대기"))
    .map(change => Date.parse(change.requestedAt!) + PHOTO_HOLD_DAYS * 86400000)
  return times.length ? new Date(Math.min(...times)).toISOString() : null
}

// 교류 뒤 한 줄: 운영진에게만 보이고, 다음 소개를 고를 때 참고한다. 반영한 뒤에는 고칠 수 없다.
export type Reflection = { programId: string; body: string; usedAt: string | null }
export async function loadReflection(programId: string): Promise<Reflection | null | undefined> {
  try {
    const db = await supabase()
    const { data, error } = await db.from("reflections").select("program_id, body, used_at").eq("program_id", programId).maybeSingle()
    if (error) return undefined
    return data ? { programId: data.program_id, body: data.body, usedAt: data.used_at } : null
  } catch {
    return undefined // 불러오지 못함
  }
}
export const saveReflection = (programId: string, body: string) => rpc<{ programId: string; body: string; usedAt: string | null }>("save_reflection", { p_program: programId, p_body: body })
export const deleteReflection = (programId: string) => rpc<null>("delete_reflection", { p_program: programId })

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

// 화면에 보여 준 알림만 읽음으로 바꾼다(보여 주지 않은 지난 알림은 그대로).
export const markNotificationsRead = (ids: string[]) => rpc<number>("mark_shown_notifications_read", { p_ids: ids })

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
// null = 아직 쓴 첫 마디가 없음, undefined = 불러오지 못함
export async function loadGreeting(): Promise<Greeting | null | undefined> {
  try {
    const db = await supabase()
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return null
    const { data, error } = await db.from("greetings").select("body, show_on_home, home_status, home_reason").eq("member_id", auth.user.id).maybeSingle()
    if (error) return undefined
    return data ? { body: data.body, showOnHome: data.show_on_home, homeStatus: data.home_status, homeReason: data.home_reason } : null
  } catch {
    return undefined
  }
}
export const saveGreeting = (body: string, showOnHome: boolean) => rpc<{ body: string; showOnHome: boolean; homeStatus: Greeting["homeStatus"] }>("save_greeting", { p_body: body, p_show_on_home: showOnHome })
export const deleteGreeting = () => rpc<null>("delete_greeting")

// 아는 사람 피하기: 적은 번호로 신청한 분과는 서로 소개하지 않는다. 번호는 서버에서 해시로만 저장하고, 뒤 네 자리와 메모만 돌려받는다.
export type AvoidContact = { id: string; tail: string; memo: string | null; created_at: string }
export const loadAvoidContacts = () => rpc<AvoidContact[]>("my_avoid_contacts")
export const addAvoidContacts = (phones: string[]) => rpc<number>("add_avoid_contacts", { p_phones: phones })
export const deleteAvoidContact = (id: string) => rpc<null>("delete_avoid_contact", { p_id: id })
