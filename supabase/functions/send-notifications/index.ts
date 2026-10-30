// 메일 알림 보내기(5분마다, pg_cron이 부른다).
// 사이트 안 알림 가운데 ‘메일’을 고른 회원의 것만 메일로 보낸다. 보낸 알림은 emailed_at 을 남겨 두 번 보내지 않는다.
// 받는 값이 없고 대기 중인 알림만 보내므로, 누가 불러도 다른 일을 할 수 없다.
// 보내는 방법(대표가 Supabase 대시보드 → Edge Functions → Secrets 에 직접 넣는다. 채팅에 붙이지 않는다):
//   A) Resend(도메인이 있을 때 · 권장): RESEND_API_KEY, MAIL_FROM(예: 비포어스 <hello@도메인>)
//   B) 메일 계정 SMTP(도메인 없이 · 베타용): SMTP_HOST(예: smtp.gmail.com), SMTP_USER(메일 주소), SMTP_PASS(앱 비밀번호),
//      MAIL_FROM(예: 비포어스 <그 메일 주소>) · Supabase 함수는 465 포트(SSL)만 쓸 수 있다.
//   공통: SITE_URL(버튼이 열 사이트 주소, 없으면 공개 사이트)
// 아무것도 없으면 보내지 않고 건너뛴다(사이트 안 알림은 그대로 보인다). 이때 보낼 메일이 쌓여 있으면 작업 기록에 남겨 대시보드가 경고한다(한 시간에 한 번).
// 한 통이 실패하면 실패 횟수를 남기고 다음 차례(5분 뒤)에 다시 보낸다. 3번 실패한 메일은 더 보내지 않는다(record_email_failure · pending_email_notifications).
import { createClient } from "npm:@supabase/supabase-js@2.49.4"
import { buildMessage, parseAddress } from "./mime.ts"
import { Smtp } from "./smtp.ts"

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

function html(title: string, body: string | null, url: string) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title></head>
<body style="margin:0;padding:0;background:#F9F8FD;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;color:#24204A;word-break:keep-all;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9F8FD;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="padding:0 8px 24px;"><span style="display:inline-block;width:12px;height:12px;border-radius:6px;background:#614CC4;"></span><span style="display:inline-block;width:12px;height:12px;border-radius:6px;background:#3A54CA;margin-left:4px;"></span><span style="font-size:20px;font-weight:700;margin-left:10px;vertical-align:middle;">비포어스</span></td></tr>
<tr><td style="background:#FFFFFF;border:1px solid #EEEAFA;border-radius:20px;padding:36px 30px;">
<p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:2px;color:#3A54CA;">BEFORE US · 알림</p>
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.5;font-weight:700;">${escape(title)}</h1>
${body ? `<p style="margin:0 0 24px;font-size:15px;line-height:1.85;color:#4A4670;">${escape(body).split("\n").join("<br>")}</p>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#614CC4;"><a href="${escape(url)}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;">비포어스에서 확인하기 →</a></td></tr></table>
</td></tr>
<tr><td style="padding:22px 8px 0;font-size:12px;line-height:1.8;color:#7A76A0;"><p style="margin:0 0 6px;">메일로 받을 알림의 범위는 내 정보 → 알림 설정에서 고를 수 있어요. 밤 10시~아침 8시에는 보내지 않아요(모든 회원에게 보내는 운영 공지는 예외예요).</p><p style="margin:0 0 6px;">이 메일이 스팸함에 있었다면 beforeus.official.kr@gmail.com을 주소록에 추가해 주세요.</p><p style="margin:0;color:#A19DC0;">BEFORE US · 끌리는 사람을, 천천히 알아갑니다. · 19세 미만 이용 불가</p></td></tr>
</table></td></tr></table></body></html>`
}

// 보낸 결과를 예약 작업 기록에 남긴다(운영진 대시보드 · 실패하면 맨 위에 경고). 보낸 것도 실패도 없으면 남기지 않는다.
async function record(db: ReturnType<typeof createClient>, sent: number, failed: number, reason: string, gaveUp = 0) {
  if (!sent && !failed && !reason) return
  await db.from("job_runs").insert({ job: "email", finished_at: new Date().toISOString(), ok: !failed && !reason, detail: { sent, failed, ...(gaveUp ? { gaveUp } : {}), ...(reason ? { reason } : {}) } })
}
const NOT_CONFIGURED = "메일 발송 설정(MAIL_FROM과 Resend 키 또는 SMTP)이 아직 없어 메일을 보내지 못했어요."

type Mail = { id: string; source: string; to: string; subject: string; html: string; text: string }

Deno.serve(async () => {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("MAIL_FROM")
  // 앱 비밀번호는 띄어쓰기 없이 쓴다(Google 화면에는 4자리씩 띄어서 보여 준다).
  const smtp = { host: Deno.env.get("SMTP_HOST")?.trim(), user: Deno.env.get("SMTP_USER")?.trim(), pass: Deno.env.get("SMTP_PASS")?.replace(/\s/g, "") }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
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
  const { data, error } = await db.rpc("pending_email_notifications", { p_limit: 50 })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const mails: Mail[] = ((data ?? []) as { id: string; email: string; title: string; body: string | null; link: string | null; source: string }[]).map((item) => {
    const url = site + (item.link?.startsWith("/") ? item.link : "/today")
    return { id: item.id, source: item.source, to: item.email, subject: `[비포어스] ${item.title}`, html: html(item.title, item.body, url), text: `${item.title}\n\n${item.body ?? ""}\n\n${url}` }
  })
  if (!mails.length) return Response.json({ sent: 0, failed: 0 })
  let sent = 0, failed = 0, gaveUp = 0
  // 알림은 notifications, 문의 답변 등은 email_queue 에 보낸 시각을 남긴다.
  const done = async (mail: Mail) => { await db.from(mail.source === "queue" ? "email_queue" : "notifications").update({ emailed_at: new Date().toISOString() }).eq("id", mail.id); sent++ }
  // 한 통이 실패하면 실패 횟수를 남긴다(3번이면 더 보내지 않는다). 받는 주소는 기록에 넣지 않는다.
  const fail = async (mail: Mail, error: string) => {
    failed++
    const { data: attempts } = await db.rpc("record_email_failure", { p_source: mail.source, p_id: mail.id, p_error: error.replaceAll(mail.to, "(받는 주소)").slice(0, 300) })
    if (typeof attempts === "number" && attempts >= 3) gaveUp++
  }
  if (key) {
    for (const mail of mails) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `notification-${mail.id}` },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
      })
      if (response.ok) await done(mail); else await fail(mail, `Resend ${response.status} ${response.statusText}`)
    }
  } else {
    // 실패 원인을 남긴다(비밀번호는 담지 않는다).
    let reason = ""
    try {
      const client = await Smtp.open(smtp.host!, smtp.user!, smtp.pass!)
      // 보내는 주소는 로그인한 Gmail 주소로 고정한다(MAIL_FROM에서는 보낸 사람 이름만 쓴다).
      const sender = smtp.user!
      const fromHeader = `${parseAddress(from!).name || "비포어스"} <${sender}>`
      try {
        for (const mail of mails) {
          try { await client.send(sender, mail.to, buildMessage({ from: fromHeader, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, id: mail.id })); await done(mail) } catch (error) { const message = String((error as Error)?.message ?? error); await fail(mail, message); reason ||= message.replaceAll(mail.to, "(받는 주소)").slice(0, 300) }
        }
      } finally { await client.quit() }
    } catch (error) {
      // 연결·로그인 실패: 메일마다 실패 횟수를 올리지 않는다(설정 문제라 고치면 그대로 보내지게). 대시보드에 사유가 남는다.
      reason ||= String((error as Error)?.message ?? error).slice(0, 300)
    }
    if (reason) { await record(db, sent, failed, reason, gaveUp); return Response.json({ sent, failed, gaveUp, reason }) }
  }
  await record(db, sent, failed, "", gaveUp)
  return Response.json({ sent, failed, gaveUp })
})
