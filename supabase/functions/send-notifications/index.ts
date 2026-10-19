// 메일 알림 보내기(5분마다, pg_cron이 부른다).
// 사이트 안 알림 가운데 ‘메일’을 고른 회원의 것만 Resend로 보낸다. 보낸 알림은 emailed_at 을 남겨 두 번 보내지 않는다.
// 받는 값이 없고 대기 중인 알림만 보내므로, 누가 불러도 다른 일을 할 수 없다.
// 필요한 비밀 값(대표가 Supabase 대시보드 → Edge Functions → Secrets 에 직접 넣는다):
//   RESEND_API_KEY  Resend에서 만든 키
//   MAIL_FROM       보내는 주소(예: 비포어스 <hello@도메인>) · Resend에서 확인한 도메인이어야 한다
//   SITE_URL        버튼이 열 사이트 주소(없으면 베타 주소)
// 키가 없으면 아무것도 보내지 않고 건너뛴다(사이트 안 알림은 그대로 보인다).
import { createClient } from "npm:@supabase/supabase-js@2.49.4"

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
${body ? `<p style="margin:0 0 24px;font-size:15px;line-height:1.85;color:#4A4670;">${escape(body)}</p>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#614CC4;"><a href="${escape(url)}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;">비포어스에서 확인하기 →</a></td></tr></table>
</td></tr>
<tr><td style="padding:22px 8px 0;font-size:12px;line-height:1.8;color:#7A76A0;"><p style="margin:0 0 6px;">메일 알림은 내 정보 → 알림 설정에서 끌 수 있어요.</p><p style="margin:0;color:#A19DC0;">BEFORE US · 끌리는 사람을, 천천히 알아갑니다. · 19세 미만 이용 불가</p></td></tr>
</table></td></tr></table></body></html>`
}

Deno.serve(async () => {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("MAIL_FROM")
  if (!key || !from) return Response.json({ skipped: "RESEND_API_KEY·MAIL_FROM 이 아직 없어요." })
  const site = (Deno.env.get("SITE_URL") ?? "https://before-us-3jr4-git-beta-ji-ho-jung-s-projects.vercel.app").replace(/\/$/, "")
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })
  const { data, error } = await db.rpc("pending_email_notifications", { p_limit: 50 })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  let sent = 0, failed = 0
  for (const item of (data ?? []) as { id: string; email: string; title: string; body: string | null; link: string | null }[]) {
    const url = site + (item.link?.startsWith("/") ? item.link : "/today")
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `notification-${item.id}` },
      body: JSON.stringify({ from, to: [item.email], subject: `[비포어스] ${item.title}`, html: html(item.title, item.body, url), text: `${item.title}\n\n${item.body ?? ""}\n\n${url}` }),
    })
    if (!response.ok) { failed++; continue }
    await db.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", item.id)
    sent++
  }
  return Response.json({ sent, failed })
})
