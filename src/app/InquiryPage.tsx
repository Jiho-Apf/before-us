import { useState } from "react"
import { Link } from "react-router"
import { ArrowRight, Inbox, MailCheck, Search } from "lucide-react"
import { Button } from "./components/ui/button"
import { Checkbox } from "./components/ui/checkbox"
import { Input } from "./components/ui/input"
import { Label } from "./components/ui/label"
import { Textarea } from "./components/ui/textarea"
import {
  INQUIRY_POLICY,
  INQUIRY_STATUS,
  INQUIRY_TYPES,
  answerInquiry,
  findInquiry,
  markInquiryChecking,
  submitInquiry,
  useInquiries,
  type InquiryType,
} from "./inquiry-model"

const time = (at: string) => new Date(at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })
const chip = "rounded-full border px-4 py-2 text-xs transition-colors duration-200 motion-reduce:transition-none"

function InquiryLookup() {
  useInquiries()
  const [id, setId] = useState("")
  const [email, setEmail] = useState("")
  const [searched, setSearched] = useState(false)
  const found = searched ? findInquiry(id, email) : null
  return (
    <div className="space-y-4 border-t border-border pt-8">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Search className="size-4 text-primary" />남긴 문의 확인하기</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Input aria-label="접수 번호" value={id} onChange={(event) => { setId(event.target.value); setSearched(false) }} placeholder="접수 번호 · Q-…" />
        <Input aria-label="문의할 때 적은 이메일" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setSearched(false) }} placeholder="문의할 때 적은 이메일" />
        <Button variant="outline" disabled={!id.trim() || !email.trim()} onClick={() => setSearched(true)}>확인</Button>
      </div>
      {searched && !found && <p className="text-sm text-muted-foreground">일치하는 문의가 없어요. 접수 번호와 이메일을 다시 확인해 주세요.</p>}
      {found && (
        <div className="space-y-3 rounded-xl bg-muted p-5 text-sm leading-7" aria-live="polite">
          <p className="text-xs text-muted-foreground">{found.id} · {found.type} · {time(found.at)}</p>
          <p className="font-semibold text-primary">{INQUIRY_STATUS[found.status]}</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{found.body}</p>
          {found.answer && (
            <div className="border-l-2 border-primary pl-4">
              <p className="text-xs text-muted-foreground">운영진 답변 · {time(found.answer.at)}</p>
              <p className="whitespace-pre-wrap">{found.answer.body}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function InquiryPage() {
  const [type, setType] = useState<InquiryType | "">("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [body, setBody] = useState("")
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState("")
  const [error, setError] = useState("")
  const [receipt, setReceipt] = useState<string | null>(null)
  return (
    <section className="grid gap-12 py-12 sm:py-16 lg:grid-cols-[5fr_7fr] lg:gap-16 break-keep">
      <div className="space-y-6">
        <div className="flex items-center gap-3"><span className="text-xs font-semibold text-accent">CONTACT</span><span aria-hidden="true" className="h-px w-8 bg-accent/40" /><span className="text-xs font-semibold">문의하기</span></div>
        <h1 className="text-3xl font-semibold leading-[1.5] sm:text-[38px]">궁금한 점을<br />남겨 주세요.</h1>
        <p className="text-sm leading-7 text-muted-foreground">운영진이 순서대로 읽고, 남겨 주신 이메일로 답변드려요. 신청하지 않은 분도 문의할 수 있어요.</p>
        <ul className="space-y-3 text-sm leading-7">
          <li className="flex gap-3"><span aria-hidden="true" className="mt-3 size-1.5 shrink-0 rounded-full bg-primary" /><span>자주 묻는 질문은 <Link to="/pricing#faq" className="whitespace-nowrap text-primary underline underline-offset-4">이용 요금 · FAQ</Link>에서 먼저 확인할 수 있어요.</span></li>
          <li className="flex gap-3"><span aria-hidden="true" className="mt-3 size-1.5 shrink-0 rounded-full bg-primary" /><span>회원이라면 <Link to="/support" className="whitespace-nowrap text-primary underline underline-offset-4">문의·신고</Link> 화면에서 진행 중인 소개와 연결해 남기면 더 빨리 확인할 수 있어요.</span></li>
          <li className="flex gap-3"><span aria-hidden="true" className="mt-3 size-1.5 shrink-0 rounded-full bg-accent" /><span>위급한 상황이라면 이 양식보다 먼저 112에 연락해 주세요.</span></li>
        </ul>
        <p className="rounded-xl bg-accent/5 p-4 text-xs leading-6 text-accent">데모 화면이에요. 문의는 이 브라우저에만 임시로 저장되고 실제 메일은 발송되지 않아요.</p>
      </div>
      <div className="space-y-8">
        {receipt ? (
          <div className="space-y-4 rounded-2xl border border-primary/20 bg-primary/5 p-7" aria-live="polite">
            <MailCheck className="size-6 text-primary" />
            <h2 className="text-xl font-semibold">문의를 잘 받았어요.</h2>
            <p className="text-sm leading-7 text-muted-foreground">접수 번호로 진행 상태와 답변을 확인할 수 있어요. 답변은 남겨 주신 이메일로도 보내 드려요.</p>
            <p className="text-2xl font-semibold tracking-wide tabular-nums">{receipt}</p>
            <Button variant="outline" onClick={() => { setReceipt(null); setType(""); setBody(""); setConsent(false) }}>다른 문의 남기기</Button>
          </div>
        ) : (
          <form className="space-y-7" onSubmit={(event) => { event.preventDefault(); const result = submitInquiry({ type, name, email, body, consent, website }); setError(result.error || ""); if (result.id) setReceipt(result.id) }}>
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">문의 유형</legend>
              <div className="flex flex-wrap gap-2">
                {INQUIRY_TYPES.map((item) => (
                  <button key={item} type="button" aria-pressed={type === item} onClick={() => setType(item)} className={`${chip} ${type === item ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/50"}`}>{item}</button>
                ))}
              </div>
              {type === "안전·신고" && <p className="text-xs leading-6 text-accent">진행 중인 상대와 관련된 일이라면 내 정보의 신고 기능을 쓰면 해당 소개에 바로 연결돼요. 위급하면 112에 먼저 연락해 주세요.</p>}
            </fieldset>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Label className="flex-col items-stretch gap-2 text-sm">
                부를 이름 <span className="text-[11px] font-normal text-muted-foreground">선택</span>
                <Input value={name} maxLength={INQUIRY_POLICY.nameMax} onChange={(event) => setName(event.target.value)} placeholder="예: 서연" />
              </Label>
              <Label className="flex-col items-stretch gap-2 text-sm">
                답변받을 이메일
                <Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" />
              </Label>
            </div>
            <Label className="flex-col items-stretch gap-2 text-sm">
              문의 내용
              <Textarea required value={body} maxLength={INQUIRY_POLICY.bodyMax} onChange={(event) => setBody(event.target.value)} className="min-h-40 leading-7" placeholder="궁금한 점을 편하게 적어 주세요. 주민등록번호·카드번호는 적지 말아 주세요." />
              <span className="text-right text-[11px] font-normal text-muted-foreground">{body.length}/{INQUIRY_POLICY.bodyMax}</span>
            </Label>
            <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(event) => setWebsite(event.target.value)} className="hidden" name="website" />
            <div className="space-y-3 rounded-xl bg-muted p-5 text-xs leading-6">
              <p className="font-semibold">개인정보 수집·이용 안내</p>
              <p className="text-muted-foreground">수집 항목: 이메일, 부를 이름(선택), 문의 내용 · 목적: 문의 확인과 답변 · 보관: {INQUIRY_POLICY.retention}. 동의하지 않으면 문의를 남길 수 없어요.</p>
              <Label className="flex items-start gap-3 text-xs">
                <Checkbox checked={consent} onCheckedChange={(value) => setConsent(value === true)} />
                위 내용을 확인했고, 문의 응대를 위한 개인정보 수집·이용에 동의해요.
              </Label>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="h-12 rounded-full px-7" disabled={!type || !email.trim() || !body.trim() || !consent}>문의 남기기 <ArrowRight size={16} /></Button>
          </form>
        )}
        <InquiryLookup />
      </div>
    </section>
  )
}

export function AdminInquiries() {
  const inquiries = useInquiries()
  const [filter, setFilter] = useState<"open" | "all">("open")
  const [selected, setSelected] = useState("")
  const [answer, setAnswer] = useState("")
  const [message, setMessage] = useState("")
  const list = inquiries.filter((item) => filter === "all" || item.status !== "answered").slice().reverse()
  const item = inquiries.find((entry) => entry.id === selected)
  const open = inquiries.filter((entry) => entry.status !== "answered").length
  return (
    <section className="mt-7 space-y-4 border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg"><Inbox className="size-4 text-primary" />고객 문의함 · 답변 대기 {open}건</h2>
        <div className="flex gap-2">
          {(["open", "all"] as const).map((value) => <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)}>{value === "open" ? "답변 대기" : "전체"}</Button>)}
        </div>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">공개 문의 페이지(/contact)에서 들어온 문의예요. 답변은 남긴 이메일로 보내는 구조이며, 데모에서는 실제 발송하지 않아요. 감사 기록에는 접수 번호와 처리만 남기고 본문·이메일은 넣지 않아요.</p>
      {list.length ? (
        <div className="divide-y divide-border">
          {list.map((entry) => (
            <button key={entry.id} type="button" onClick={() => { setSelected(entry.id); setAnswer(entry.answer?.body || ""); setMessage("") }} className={`flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-sm ${entry.id === selected ? "text-primary" : ""}`}>
              <span>{entry.id} · {entry.type}{entry.name && ` · ${entry.name}`}</span>
              <span className="text-xs text-muted-foreground">{INQUIRY_STATUS[entry.status]} · {time(entry.at)}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{filter === "open" ? "답변을 기다리는 문의가 없어요." : "아직 들어온 문의가 없어요."}</p>
      )}
      {item && (
        <div className="space-y-3 rounded-xl bg-muted p-4 text-sm leading-7">
          <p className="text-xs text-muted-foreground">{item.id} · {item.type} · {item.email} · 동의 {time(item.consentAt)}</p>
          <p className="whitespace-pre-wrap">{item.body}</p>
          <Textarea aria-label="답변" value={answer} maxLength={1500} onChange={(event) => setAnswer(event.target.value)} className="min-h-28 bg-background" placeholder="회원에게 보낼 답변" />
          <div className="flex flex-wrap gap-2">
            {item.status === "received" && <Button size="sm" variant="outline" onClick={() => setMessage(markInquiryChecking(item.id) || "확인 중으로 바꿨어요.")}>확인 중으로</Button>}
            <Button size="sm" onClick={() => setMessage(answerInquiry(item.id, answer) || "답변을 기록했어요. 실제 메일 발송은 연동 후에 돼요.")}>{item.answer ? "답변 수정" : "답변 기록"}</Button>
          </div>
          <p role="status" className="text-xs text-primary">{message}</p>
        </div>
      )}
    </section>
  )
}
