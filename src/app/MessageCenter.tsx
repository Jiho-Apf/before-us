import { useState } from "react"
import { MessageCircle, Smartphone, History, Send } from "lucide-react"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { Textarea } from "./components/ui/textarea"
import type { AdminState } from "./admin-model"
import {
  MESSAGE_POLICY,
  MESSAGE_VARIABLES,
  STATUS_LABELS,
  fillSample,
  lintTemplate,
  restoreVersion,
  saveTemplate,
  setTemplateStatus,
  useTemplates,
  type MessageTemplate,
  type TemplateStatus,
} from "./message-templates"

const time = (at: string | null) =>
  at ? new Date(at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "—"
const STATUS_STYLE: Record<TemplateStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  ready: "bg-primary/10 text-primary",
  submitted: "bg-accent/10 text-accent",
  approved: "bg-primary text-primary-foreground",
  rejected: "bg-destructive/10 text-destructive",
}

function NoonPlan({ state }: { state: AdminState }) {
  const introduced = new Set(state.proposals.filter((item) => item.status === "scheduled").flatMap((item) => item.members))
  const waiting = state.members.filter((member) => member.draft.review.submission === "received" && (!member.lifecycle || member.lifecycle === "active") && member.activity === "idle" && !introduced.has(member.id))
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-xl bg-primary/5 p-4">
        <p className="text-xs text-muted-foreground">12:00 · 오늘의 인연</p>
        <p className="mt-1 text-2xl font-semibold">{introduced.size}명</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">운영진이 최종 선택해 공개 예약된 소개의 두 회원</p>
      </div>
      <div className="rounded-xl bg-muted p-4">
        <p className="text-xs text-muted-foreground">12:00 · 오늘은 소개가 없을 때</p>
        <p className="mt-1 text-2xl font-semibold">최대 {waiting.length}명</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">대기 회원 중 ‘대기 중 안내 받기’를 켠 분에게만</p>
      </div>
      <div className="rounded-xl bg-muted p-4">
        <p className="text-xs text-muted-foreground">발송 경로</p>
        <p className="mt-1 text-sm leading-6">카카오 알림톡 → 실패하면 문자로 대체</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">현재 미연결 · 실제 발송 없음</p>
      </div>
    </div>
  )
}

function KakaoPreview({ body }: { body: string }) {
  return (
    <div className="rounded-2xl bg-[#B2C7DA] p-4 dark:bg-[#2a3440]">
      <p className="mb-2 text-[11px] text-[#1f2a37] dark:text-white/80">비포어스 · 알림톡</p>
      <div className="max-w-sm overflow-hidden rounded-xl bg-white text-[#191919] shadow-sm">
        <div className="bg-[#FEE500] px-4 py-2 text-xs font-semibold">알림톡 도착</div>
        <p className="whitespace-pre-wrap px-4 py-3 text-[13px] leading-6">{fillSample(body)}</p>
        <div className="border-t border-black/10 px-4 py-2 text-center text-xs">비포어스에서 확인하기</div>
      </div>
    </div>
  )
}

function Editor({ template }: { template: MessageTemplate }) {
  const [body, setBody] = useState(template.body)
  const [sms, setSms] = useState(template.smsBody)
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [target, setTarget] = useState<"body" | "sms">("body")
  const [message, setMessage] = useState("")
  const lint = lintTemplate({ body, smsBody: sms })
  const dirty = body !== template.body || sms !== template.smsBody
  const insert = (token: string) => (target === "body" ? setBody((value) => value + token) : setSms((value) => value + token))
  const status = (next: TemplateStatus) => setMessage(setTemplateStatus(template.id, next, note) || `${STATUS_LABELS[next]}(으)로 기록했어요.`)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{template.name}</h3>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            언제: {template.trigger} · {template.timing}
            <br />
            누구에게: {template.audience}
            {template.optIn && " · 수신 선택 회원만"}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs ${STATUS_STYLE[template.status]}`}>
          v{template.version} · {STATUS_LABELS[template.status]}
        </span>
      </div>
      {template.statusNote && <p className="text-xs text-accent">{template.statusNote}</p>}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block space-y-2 text-xs">
            <span className="flex items-center gap-2"><MessageCircle className="size-3" />알림톡 본문 · {body.length}/{MESSAGE_POLICY.kakaoMaxChars}자</span>
            <Textarea value={body} onFocus={() => setTarget("body")} onChange={(event) => setBody(event.target.value)} className="min-h-56 bg-background leading-6" />
          </label>
          <label className="block space-y-2 text-xs">
            <span className="flex items-center gap-2"><Smartphone className="size-3" />알림톡 실패 시 문자 · {lint.smsBytes}바이트 · {lint.smsKind}</span>
            <Textarea value={sms} onFocus={() => setTarget("sms")} onChange={(event) => setSms(event.target.value)} className="min-h-20 bg-background leading-6" />
          </label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(MESSAGE_VARIABLES).map(([token, info]) => (
              <button key={token} type="button" title={info.label} onClick={() => insert(token)} className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary">
                {token}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-5 text-muted-foreground">
            변수는 {target === "body" ? "알림톡" : "문자"} 끝에 추가돼요. 상대의 이름·사진·연락처·편지 내용은 넣을 수 없고, 홈페이지 링크로만 안내해요.
          </p>
        </div>
        <div className="space-y-3">
          <KakaoPreview body={body} />
          <div className="rounded-xl border border-border p-3">
            <p className="mb-1 text-[11px] text-muted-foreground">문자 미리보기</p>
            <p className="whitespace-pre-wrap text-xs leading-6">{fillSample(sms) || "문자 대체 없음"}</p>
          </div>
          {[...lint.errors.map((text) => ["오류", text] as const), ...lint.warnings.map((text) => ["안내", text] as const)].map(([kind, text]) => (
            <p key={text} className={`text-xs leading-5 ${kind === "오류" ? "text-destructive" : "text-muted-foreground"}`}>{kind} · {text}</p>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="수정 이유" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="수정 이유 · 예: 대기 안내 어조를 부드럽게" />
        <Button disabled={!dirty || lint.errors.length > 0} onClick={() => { const error = saveTemplate(template.id, body, sms, reason); setMessage(error || "새 버전으로 저장했어요."); if (!error) setReason("") }}>
          새 버전 저장
        </Button>
        {dirty && <Button variant="ghost" onClick={() => { setBody(template.body); setSms(template.smsBody) }}>되돌리기</Button>}
      </div>
      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          카카오 심사 단계 · 실제 심사는 발송 대행사 화면에서 진행하고, 결과를 여기에 기록해요. 승인된 문구를 고치면 다시 심사를 받아야 해요.
        </p>
        <Input aria-label="심사 메모" value={note} onChange={(event) => setNote(event.target.value)} placeholder="심사 메모 · 반려 사유는 필수" />
        <div className="flex flex-wrap gap-2">
          {template.status === "draft" && <Button size="sm" variant="outline" onClick={() => status("ready")}>검수 요청 준비 완료</Button>}
          {template.status === "ready" && <><Button size="sm" variant="outline" onClick={() => status("submitted")}>심사 요청함</Button><Button size="sm" variant="ghost" onClick={() => status("draft")}>초안으로</Button></>}
          {template.status === "submitted" && <><Button size="sm" variant="outline" onClick={() => status("approved")}>승인됨</Button><Button size="sm" variant="outline" onClick={() => status("rejected")}>반려됨</Button></>}
          {template.status === "rejected" && <Button size="sm" variant="outline" onClick={() => status("draft")}>고쳐서 다시 준비</Button>}
          <Button size="sm" variant="ghost" disabled><Send className="size-3" />테스트 발송 · 연동 후</Button>
        </div>
      </div>
      {template.history.length > 0 && (
        <details className="rounded-xl border border-border p-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm"><History className="size-4" />이전 버전 {template.history.length}개</summary>
          <div className="mt-3 space-y-3">
            {[...template.history].reverse().map((item) => (
              <div key={item.version} className="space-y-1 text-xs leading-5">
                <p className="text-muted-foreground">v{item.version} · {time(item.at)}까지 · 바꾼 이유: {item.reason}</p>
                <p className="whitespace-pre-wrap rounded-lg bg-muted p-2">{item.body}</p>
                <Button size="sm" variant="ghost" onClick={() => setMessage(restoreVersion(template.id, item.version) || `v${item.version} 내용으로 새 버전을 만들었어요.`)}>이 버전으로 되돌리기</Button>
              </div>
            ))}
          </div>
        </details>
      )}
      <p role="status" className="text-xs text-primary">{message}</p>
    </div>
  )
}

export function MessageCenter({ state }: { state: AdminState }) {
  const templates = useTemplates()
  const [selectedId, setSelectedId] = useState(templates[0].id)
  const selected = templates.find((item) => item.id === selectedId) || templates[0]
  const groups = [...new Set(templates.map((item) => item.group))]
  return (
    <div className="space-y-6">
      <NoonPlan state={state} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="메시지 템플릿" className="space-y-4">
          {groups.map((group) => (
            <div key={group} className="space-y-1">
              <p className="text-[11px] tracking-widest text-muted-foreground">{group}</p>
              {templates.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${item.id === selected.id ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                >
                  <span>{item.name}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${STATUS_STYLE[item.status]}`}>{STATUS_LABELS[item.status].split(" ")[0]}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0 rounded-xl border border-border p-5">
          <Editor key={`${selected.id}-${selected.version}`} template={selected} />
        </div>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        {MESSAGE_POLICY.version} · 실제 카카오 채널·발송 대행사·문자 발신번호는 연결되어 있지 않아요. 메시지에는 광고·개인정보를 넣지 않고, 정보성 알림만 보냅니다. 같은 회원에게 같은 날 같은 종류는 한 번만 보냅니다.
      </p>
    </div>
  )
}
