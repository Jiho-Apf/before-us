// 메일 알림 보내기(5분마다, pg_cron이 부른다).
// 사이트 안 알림 가운데 ‘메일’을 고른 회원의 것만 메일로 보낸다(GPT 1차 검수 C7, 2026-11-04):
//  - 예약 작업만 부를 수 있다: 머리글 x-cron-token 을 서버의 열쇠(cron_token_ok)와 맞춰 보고, 다르면 401.
//  - 보낼 메일은 claim_email_notifications 로 ‘선점’한다(잠금 건너뛰기 + 10분 기한). 두 작업이 겹쳐도 같은 메일을 두 번 잡지 않는다.
//  - 결과는 record_email_result 로 남기고 오류를 확인한다. 보냈는데 기록하지 못하면 ‘불확실(unknown)’로 남겨 다시 보내지 않는다.
// 보내는 방법(대표가 Supabase 대시보드 → Edge Functions → Secrets 에 직접 넣는다. 채팅에 붙이지 않는다):
//   A) Resend(도메인이 있을 때 · 권장): RESEND_API_KEY, MAIL_FROM(예: 플라비 <hello@도메인>)
//   B) 메일 계정 SMTP(도메인 없이 · 베타용): SMTP_HOST(예: smtp.gmail.com), SMTP_USER(메일 주소), SMTP_PASS(앱 비밀번호),
//      MAIL_FROM(예: 플라비 <그 메일 주소>) · Supabase 함수는 465 포트(SSL)만 쓸 수 있다.
// 보낸 사람 이름은 MAIL_FROM 에 무엇이 적혀 있든 BRAND(서비스 이름)로 보낸다. 이름을 바꿀 때 비밀 값을 고치지 않아도 되게.
//   공통: SITE_URL(버튼이 열 사이트 주소, 없으면 공개 사이트)
// 아무것도 없으면 보내지 않고 건너뛴다(사이트 안 알림은 그대로 보인다). 이때 보낼 메일이 쌓여 있으면 작업 기록에 남겨 대시보드가 경고한다(한 시간에 한 번).
// 한 통이 실패하면 사유를 남기고 다음 차례(5분 뒤)에 다시 보낸다. 3번 시도한 메일은 더 보내지 않는다(claim_email_notifications · record_email_result).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.4"
import { buildMessage, parseAddress } from "./mime.ts"
import { Smtp, UncertainDelivery } from "./smtp.ts"

// 서비스 이름(화면 src/app/config.ts 의 brand 와 같이 바꾼다)
const BRAND = { name: "플라비", english: "FLAVIE", message: "끌리는 사람을, 천천히 알아갑니다." }

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

function html(title: string, body: string | null, url: string) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title></head>
<body style="margin:0;padding:0;background:#F9F8FD;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;color:#24204A;word-break:keep-all;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9F8FD;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="padding:0 8px 24px;"><span style="display:inline-block;width:12px;height:12px;border-radius:6px;background:#614CC4;"></span><span style="display:inline-block;width:12px;height:12px;border-radius:6px;background:#3A54CA;margin-left:4px;"></span><span style="font-size:20px;font-weight:700;margin-left:10px;vertical-align:middle;">${BRAND.name}</span></td></tr>
<tr><td style="background:#FFFFFF;border:1px solid #EEEAFA;border-radius:20px;padding:36px 30px;">
<p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:2px;color:#3A54CA;">${BRAND.english} · 알림</p>
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.5;font-weight:700;">${escape(title)}</h1>
${body ? `<p style="margin:0 0 24px;font-size:15px;line-height:1.85;color:#4A4670;">${escape(body).split("\n").join("<br>")}</p>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#614CC4;"><a href="${escape(url)}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;">${BRAND.name}에서 확인하기 →</a></td></tr></table>
</td></tr>
<tr><td style="padding:22px 8px 0;font-size:12px;line-height:1.8;color:#7A76A0;"><p style="margin:0 0 6px;">메일로 받을 알림의 범위는 내 정보 → 알림 설정에서 고를 수 있어요. 밤 10시~아침 8시에는 보내지 않아요(모든 회원에게 보내는 운영 공지는 예외예요).</p><p style="margin:0 0 6px;">이 메일이 스팸함에 있었다면 beforeus.official.kr@gmail.com을 주소록에 추가해 주세요.</p><p style="margin:0;color:#A19DC0;">${BRAND.english} · ${BRAND.message} · 19세 미만 이용 불가</p></td></tr>
</table></td></tr></table></body></html>`
}

// 보낸 결과를 예약 작업 기록에 남긴다(운영진 대시보드 · 실패하면 맨 위에 경고). 보낸 것도 실패도 없으면 남기지 않는다.
// deno-lint-ignore no-explicit-any
async function record(db: SupabaseClient<any, "public", any>, sent: number, failed: number, reason: string, gaveUp = 0, unknown = 0) {
  if (!sent && !failed && !reason && !unknown) return
  const { error } = await db.from("job_runs").insert({ job: "email", finished_at: new Date().toISOString(), ok: !failed && !reason && !unknown, detail: { sent, failed, ...(gaveUp ? { gaveUp } : {}), ...(unknown ? { unknown } : {}), ...(reason ? { reason } : {}) } })
  if (error) console.error("job_runs 기록 실패", error.message)
}
const NOT_CONFIGURED = "메일 발송 설정(MAIL_FROM과 Resend 키 또는 SMTP)이 아직 없어 메일을 보내지 못했어요."

type Mail = { id: string; source: string; to: string; subject: string; html: string; text: string }
type Result = "sent" | "failed" | "unknown" | "released"

Deno.serve(async (request) => {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("MAIL_FROM")
  // 앱 비밀번호는 띄어쓰기 없이 쓴다(Google 화면에는 4자리씩 띄어서 보여 준다).
  const smtp = { host: Deno.env.get("SMTP_HOST")?.trim(), user: Deno.env.get("SMTP_USER")?.trim(), pass: Deno.env.get("SMTP_PASS")?.replace(/\s/g, "") }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  const { data: allowed, error: tokenError } = await db.rpc("cron_token_ok", { p_token: request.headers.get("x-cron-token") ?? "" })
  if (tokenError || allowed !== true) return Response.json({ error: "예약 작업만 부를 수 있어요." }, { status: 401 })
  if (!from || (!key && !(smtp.host && smtp.user && smtp.pass))) {
    // 보낼 메일이 있는데 설정이 없으면 대시보드가 알 수 있게 남긴다(같은 경고는 한 시간에 한 번만).
    const { data: waiting } = await db.rpc("pending_email_notifications", { p_limit: 1 })
    if ((waiting ?? []).length) {
      const since = new Date(Date.now() - 3600000).toISOString()
      const { count } = await db.from("job_runs").select("id", { count: "exact", head: true }).eq("job", "email").eq("ok", false).gt("started_at", since)
      if (!count) await record(db, 0, 0, NOT_CONFIGURED)
    }
    return Response.json({ skipped: NOT_CONFIGURED })
  }
  const site = (Deno.env.get("SITE_URL") ?? "https://before-us-3jr4.vercel.app").replace(/\/$/, "")
  const { data, error } = await db.rpc("claim_email_notifications", { p_limit: 50 })
  if (error) { await record(db, 0, 0, `보낼 메일을 가져오지 못했어요: ${error.message.slice(0, 200)}`); return Response.json({ error: error.message }, { status: 500 }) }
  const mails: Mail[] = ((data ?? []) as { id: string; email: string; title: string; body: string | null; link: string | null; source: string }[]).map((item) => {
    const url = site + (item.link?.startsWith("/") ? item.link : "/today")
    return { id: item.id, source: item.source, to: item.email, subject: `[${BRAND.name}] ${item.title}`, html: html(item.title, item.body, url), text: `${item.title}\n\n${item.body ?? ""}\n\n${url}` }
  })
  if (!mails.length) return Response.json({ sent: 0, failed: 0 })
  let sent = 0, failed = 0, gaveUp = 0, unknown = 0
  // 결과 기록은 실패하면 한 번 더 시도한다. 그래도 안 되면 false(선점 기한이 지나기 전에는 다시 잡히지 않는다).
  const mark = async (mail: Mail, status: Result, error: string | null = null) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data: attempts, error: writeError } = await db.rpc("record_email_result", { p_source: mail.source, p_id: mail.id, p_status: status, p_error: error })
      if (!writeError) return { ok: true, attempts: typeof attempts === "number" ? attempts : 0 }
      console.error("메일 결과 기록 실패", status, writeError.message)
    }
    return { ok: false, attempts: 0 }
  }
  // 보냈다: 기록하지 못하면 ‘불확실’로 남겨 다시 보내지 않게 한다(그것도 안 되면 작업 기록에 남는다).
  const done = async (mail: Mail) => {
    if ((await mark(mail, "sent")).ok) { sent++; return }
    unknown++
    await mark(mail, "unknown", "보냈지만 보낸 기록을 남기지 못했어요")
  }
  // 한 통이 실패하면 사유를 남긴다(선점할 때 시도 횟수를 올리므로 3번이면 더 보내지 않는다). 받는 주소는 기록에 넣지 않는다.
  const fail = async (mail: Mail, error: string) => {
    failed++
    const result = await mark(mail, "failed", error.replaceAll(mail.to, "(받는 주소)").slice(0, 300))
    if (result.ok && result.attempts >= 3) gaveUp++
  }
  if (key) {
    for (const mail of mails) {
      // 네트워크 오류로 답을 못 받아도 함수가 멈추지 않게 실패로 남긴다. 같은 Idempotency-Key 로 다시 보내므로 Resend가 두 번 보내지 않는다(24시간).
      let response: Response
      try {
        response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `notification-${mail.id}` },
          body: JSON.stringify({ from: `${BRAND.name} <${parseAddress(from!).address}>`, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
        })
      } catch (error) { await fail(mail, `Resend 연결 실패: ${String((error as Error)?.message ?? error)}`); continue }
      if (response.ok) await done(mail); else await fail(mail, `Resend ${response.status} ${response.statusText}`)
    }
  } else {
    // 실패 원인을 남긴다(비밀번호는 담지 않는다).
    let reason = ""
    const handled = new Set<string>()
    try {
      const client = await Smtp.open(smtp.host!, smtp.user!, smtp.pass!)
      // 보내는 주소는 로그인한 Gmail 주소로 고정한다(MAIL_FROM에서는 보낸 사람 이름만 쓴다).
      const sender = smtp.user!
      const fromHeader = `${BRAND.name} <${sender}>`
      try {
        for (const mail of mails) {
          // 연결이 끊겼으면 남은 메일은 보내지 않는다(아래에서 선점을 풀어 다음 차례에 보낸다).
          if (client.broken) break
          try { await client.send(sender, mail.to, buildMessage({ from: fromHeader, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, id: mail.id })); handled.add(mail.id); await done(mail) } catch (error) {
            const message = String((error as Error)?.message ?? error).replaceAll(mail.to, "(받는 주소)").slice(0, 300)
            reason ||= message
            if (error instanceof UncertainDelivery) {
              // 본문을 다 보낸 뒤 답을 못 받음: 이미 갔을 수 있어 다시 보내지 않는다.
              handled.add(mail.id); unknown++; await mark(mail, "unknown", message)
            } else if (!client.broken) {
              // 메일 서버가 거절함(주소 오류 등): 이 메일의 실패로 센다(3번까지 다시).
              handled.add(mail.id); await fail(mail, message)
            }
            // 본문을 다 보내기 전에 연결이 끊김: 메일 탓이 아니므로 아래에서 선점을 푼다.
          }
        }
      } finally { await client.quit() }
    } catch (error) {
      // 연결·로그인 실패
      reason ||= String((error as Error)?.message ?? error).slice(0, 300)
    }
    // 보내지 못한 메일(연결·로그인 실패 · 중간에 끊김)은 메일 탓이 아니므로 선점을 풀고 시도 횟수를 되돌린다(설정을 고치면 그대로 보내지게). 대시보드에 사유가 남는다.
    for (const mail of mails) if (!handled.has(mail.id)) await mark(mail, "released")
    if (reason) { await record(db, sent, failed, reason, gaveUp, unknown); return Response.json({ sent, failed, gaveUp, unknown, reason }) }
  }
  await record(db, sent, failed, "", gaveUp, unknown)
  return Response.json({ sent, failed, gaveUp, unknown })
})
