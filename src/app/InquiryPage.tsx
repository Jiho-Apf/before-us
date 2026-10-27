import { kstDateTime } from "./dates"
import { useState } from "react"
import { Link } from "react-router"
import { ArrowRight, ChevronDown, Inbox, MailCheck, Search } from "lucide-react"
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
  type Inquiry,
  type InquiryType,
} from "./inquiry-model"
import { LIVE, rpc } from "./backend/client"

// 실제 서버 모드: 문의 접수·조회를 서버 함수로 한다(비회원도 가능, 접수 번호 + 이메일이 모두 맞아야 보인다).
type Found = Pick<Inquiry, "id" | "type" | "body" | "at" | "status" | "answer">
async function findLive(id: string, email: string) {
  const { data } = await rpc<Found | null>("find_inquiry", { p_id: id, p_email: email })
  return data
}
async function submitLive(input: { type: string; name: string; email: string; body: string; consent: boolean; website: string }) {
  const { data, error } = await rpc<{ id?: string; error?: string }>("submit_inquiry", { p_type: input.type, p_name: input.name, p_email: input.email, p_body: input.body, p_consent: input.consent, p_website: input.website })
  return { error: error || data?.error || null, id: data?.id || null }
}

const time = (at: string) => kstDateTime(at)
const chip = "min-h-10 rounded-full border px-4 py-2.5 text-[13px] transition-colors duration-200 motion-reduce:transition-none"

function InquiryLookup() {
  useInquiries()
  const [id, setId] = useState("")
  const [email, setEmail] = useState("")
  const [searched, setSearched] = useState(false)
  const [remote, setRemote] = useState<Found | null>(null)
  const found = searched ? LIVE ? remote : findInquiry(id, email) : null
  const search = async () => { if (LIVE) setRemote(await findLive(id, email)); setSearched(true) }
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border border-border bg-card">
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="flex w-full items-center justify-between gap-3 rounded-2xl px-6 py-4 text-left text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="flex items-center gap-2"><Search className="size-4 text-primary" />이미 남긴 문의 확인하기</span><ChevronDown size={16} className={`text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} /></button>
      {open && <div className="space-y-4 border-t border-border px-6 pb-6 pt-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Input aria-label="접수 번호" value={id} onChange={(event) => { setId(event.target.value); setSearched(false) }} placeholder="접수 번호 · Q-…" />
        <Input aria-label="문의할 때 적은 이메일" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setSearched(false) }} placeholder="문의할 때 적은 이메일" />
        <Button variant="outline" disabled={!id.trim() || !email.trim()} onClick={() => void search()} className="h-10 rounded-full px-5 hover:bg-muted hover:text-foreground">확인</Button>
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
      </div>}
    </div>
  )
}

export default function InquiryPage() {
  const [type, setType] = useState<InquiryType | "">(() => { const wanted = new URLSearchParams(window.location.search).get("type"); return (INQUIRY_TYPES as readonly string[]).includes(wanted ?? "") ? wanted as InquiryType : "" })
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [body, setBody] = useState("")
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState("")
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const [receipt, setReceipt] = useState<string | null>(null)
  return (
    <section className="grid gap-12 py-16 sm:py-20 lg:grid-cols-[5fr_7fr] lg:gap-16 break-keep">
      <div className="space-y-6">
        <div className="flex items-center gap-3"><span className="text-xs font-semibold text-accent">CONTACT</span><span aria-hidden="true" className="h-px w-8 bg-accent/40" /><span className="text-xs font-semibold">문의하기</span></div>
        <h1 className="text-3xl font-semibold leading-[1.5] sm:text-[38px]">궁금한 점을<br />남겨 주세요.</h1>
        <p className="text-[15px] leading-[1.9] text-muted-foreground">운영진이 순서대로 읽고, 남겨 주신 이메일로 답해요. 신청하지 않은 분도 괜찮아요.</p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-mist p-4"><dt className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">답변 시간</dt><dd className="mt-1.5 font-semibold leading-6">평일 10~18시<br /><span className="text-xs font-normal text-muted-foreground">보통 1영업일 안</span></dd></div>
          <div className="rounded-2xl bg-mist p-4"><dt className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">먼저 보면 좋아요</dt><dd className="mt-1.5 leading-6"><Link to="/faq" className="font-semibold text-primary underline-offset-4 hover:underline">자주 묻는 질문</Link><br /><span className="text-xs text-muted-foreground">요금·소개·환불</span></dd></div>
          <div className="rounded-2xl bg-mist p-4"><dt className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">회원이라면</dt><dd className="mt-1.5 leading-6"><Link to="/support" className="font-semibold text-primary underline-offset-4 hover:underline">문의·요청</Link><br /><span className="text-xs text-muted-foreground">정정·삭제·재검토 요청</span></dd></div>
          <div className="rounded-2xl bg-[#F8E5A6]/70 p-4 text-[#2B2540] dark:bg-[#3B3424] dark:text-white"><dt className="text-[11px] font-semibold tracking-[0.08em] text-[#7A5A10] dark:text-[#F3D98A]">위급하다면</dt><dd className="mt-1.5 font-semibold leading-6">112에 먼저<br /><span className="text-xs font-normal opacity-75">상대 신고는 두 사람 화면에서</span></dd></div>
        </dl>
        {!LIVE && <p className="rounded-xl bg-accent/5 p-4 text-xs leading-6 text-accent">데모 화면이에요. 문의는 이 브라우저에만 임시로 저장되고 실제 메일은 발송되지 않아요.</p>}
      </div>
      <div className="space-y-8">
        {receipt ? (
          <div className="space-y-4 rounded-2xl border border-primary/20 bg-primary/5 p-7" aria-live="polite">
            <MailCheck className="size-6 text-primary" />
            <h2 className="text-xl font-semibold">문의를 잘 받았어요.</h2>
            <p className="text-sm leading-7 text-muted-foreground">{LIVE ? "접수 번호와 이메일로 이 화면 아래에서 진행 상태와 답변을 확인할 수 있어요. 접수 번호를 메모해 두세요." : "접수 번호로 진행 상태와 답변을 확인할 수 있어요. 답변은 남겨 주신 이메일로도 보내 드려요."}</p>
            <p className="text-2xl font-semibold tracking-wide tabular-nums">{receipt}</p>
            <Button variant="outline" onClick={() => { setReceipt(null); setType(""); setBody(""); setConsent(false) }}>다른 문의 남기기</Button>
          </div>
        ) : (
          <form className="space-y-7 rounded-3xl border border-border bg-card p-6 sm:p-8" onSubmit={async (event) => { event.preventDefault(); if (sending) return; setSending(true); const result = LIVE ? await submitLive({ type, name, email, body, consent, website }) : submitInquiry({ type, name, email, body, consent, website }); setSending(false); setError(result.error || ""); if (result.id) setReceipt(result.id) }}>
            <fieldset className="space-y-3">
              <legend className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] text-primary">1</span>무엇이 궁금한가요?</legend>
              {/* 이용·소개·결제 관련(첫 줄)과 개인정보·안전·기타(둘째 줄)를 나눠 한눈에 고르기 쉽게 */}
              {[INQUIRY_TYPES.slice(0, 4), INQUIRY_TYPES.slice(4)].map((row, index) => (
                <div key={index} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  {row.map((item) => (
                    <button key={item} type="button" aria-pressed={type === item} onClick={() => setType(item)} className={`${chip} ${type === item ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/50"}`}>{item}</button>
                  ))}
                </div>
              ))}
              {type === "안전·신고" && <p className="text-xs leading-6 text-accent">진행 중인 상대와 관련된 일이라면 ‘두 사람’ 화면의 신고하기를 쓰면 해당 소개에 바로 연결돼요. 위급하면 112에 먼저 연락해 주세요.</p>}
            </fieldset>
            <p className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] text-primary">2</span>어디로 답해 드릴까요?</p>
            <div className="-mt-3 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Label className="flex-col items-stretch gap-2 text-sm">
                <span className="flex items-baseline gap-1.5">부를 이름 <span className="text-[11px] font-normal text-muted-foreground">선택</span></span>
                <Input value={name} maxLength={INQUIRY_POLICY.nameMax} onChange={(event) => setName(event.target.value)} placeholder="예: 서연" className="h-11" />
              </Label>
              <Label className="flex-col items-stretch gap-2 text-sm">
                <span>답변받을 이메일</span>
                <Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" className="h-11" />
              </Label>
            </div>
            <Label className="flex-col items-stretch gap-2 text-sm">
              <span className="flex items-center gap-2 font-semibold"><span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] text-primary">3</span>내용</span>
              <Textarea required value={body} maxLength={INQUIRY_POLICY.bodyMax} onChange={(event) => setBody(event.target.value)} className="min-h-40 text-base leading-7 md:text-sm" placeholder="궁금한 점을 편하게 적어 주세요. 주민등록번호·카드번호는 적지 말아 주세요." />
              <span className="text-right text-[11px] font-normal text-muted-foreground">{body.length}/{INQUIRY_POLICY.bodyMax}</span>
            </Label>
            <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(event) => setWebsite(event.target.value)} className="hidden" name="website" />
            <div className="space-y-3 rounded-2xl bg-mist p-5 text-xs leading-6">
              <p className="text-muted-foreground"><span className="font-semibold text-foreground">개인정보 수집·이용</span> · 이메일, 부를 이름(선택), 문의 내용을 문의 확인과 답변에만 쓰고, {INQUIRY_POLICY.retention} 동안 보관한 뒤 지워요. 동의하지 않으면 문의를 남길 수 없어요.</p>
              <Label className="flex items-start gap-3 text-xs">
                <Checkbox checked={consent} onCheckedChange={(value) => setConsent(value === true)} />
                위 내용을 확인했고, 문의 응대를 위한 개인정보 수집·이용에 동의해요.
              </Label>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-center"><Button type="submit" className="h-12 rounded-full px-8" disabled={sending || !type || !email.trim() || !body.trim() || !consent}>{sending ? "보내는 중…" : <>문의 남기기 <ArrowRight size={16} /></>}</Button></div>
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
