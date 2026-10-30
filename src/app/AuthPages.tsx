import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { ArrowRight, LoaderCircle } from "lucide-react"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { Label } from "./components/ui/label"
import { Checkbox } from "./components/ui/checkbox"
import { BEFORE_US } from "./config"
import { kstDay } from "./dates"
import { EXISTING_EMAIL_NOTE, PASSWORD_RULE, confirmEmailLink, requestPasswordReset, resetPassword, signIn, signOut, signUp, suggestEmail, useAuth, withdraw, resendConfirmation } from "./auth-service"

// 누르는 동안 돌아가는 표시(두 번 누르지 않게)
const Busy = ({ text }: { text: string }) => <><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{text}</>
import { LIVE } from "./backend/client"

// 계정 화면: 로그인 · 회원가입 · 비밀번호 재설정. 계정에는 사진이나 이상형을 받지 않는다(소개 신청은 따로 4단계).
const motion = "transition-colors duration-200 motion-reduce:transition-none"

function Frame({ title, lead, children, foot }: { title: string; lead?: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center break-keep py-16 sm:py-24">
      <p className="mb-5 text-xs font-semibold tracking-[0.15em] text-accent">{BEFORE_US.brand.english}</p>
      <h1 className="text-3xl font-semibold">{title}</h1>
      {lead && <p className="mt-3 text-sm leading-7 text-muted-foreground">{lead}</p>}
      <div className="mt-8 rounded-2xl border border-border bg-card p-6 sm:p-7">{children}</div>
      {foot && <div className="mt-6 space-y-2 text-sm text-muted-foreground">{foot}</div>}
      {!LIVE && <p className="mt-6 text-xs leading-6 text-muted-foreground">데모 화면이에요. 계정은 이 탭에만 잠시 저장되고, 새로고침하면 사라져요.</p>}
    </section>
  )
}
function Field({ id, label, type = "text", value, onChange, autoComplete, hint }: { id: string; label: string; type?: string; value: string; onChange: (value: string) => void; autoComplete?: string; hint?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} className="h-11 rounded-xl" />
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
const ErrorText = ({ text }: { text: string }) => (text ? <p role="alert" className="text-sm text-destructive">{text}</p> : null)

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [resent, setResent] = useState("")
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true)
    const result = await signIn(email, password)
    setBusy(false)
    if (result.error) { setUnconfirmed("unconfirmed" in result && !!result.unconfirmed); return setError(result.error) }
    // 알림 메일 링크 등으로 들어왔다면 원래 가려던 회원 화면으로 돌려보낸다(사이트 안 경로만).
    const next = new URLSearchParams(window.location.search).get("next") ?? ""
    navigate(/^\/(today|us|exchange|meeting|profile|support|apply|payments)(\?[\w=&%-]*)?$/.test(next) ? next : "/today")
  }
  const resend = async () => { const result = await resendConfirmation(email); setResent(result.error || "확인 메일을 다시 보냈어요. 이 브라우저에서 링크를 열면 바로 이어져요.") }
  return (
    <Frame title="로그인" foot={<><p>처음이신가요? <Link to="/signup" className="text-foreground underline underline-offset-4 hover:text-primary">회원가입</Link></p><p><Link to="/reset-password" className="underline underline-offset-4 hover:text-primary">비밀번호를 잊으셨나요?</Link></p></>}>
      <form className="space-y-5" onSubmit={submit} noValidate>
        <Field id="login-email" label="이메일" type="email" autoComplete="email" value={email} onChange={(value) => { setEmail(value); setError("") }} />
        <Field id="login-password" label="비밀번호" type="password" autoComplete="current-password" value={password} onChange={(value) => { setPassword(value); setError("") }} />
        <ErrorText text={error} />
        {unconfirmed && <div className="rounded-xl bg-mist p-4 text-xs leading-6"><Button type="button" variant="outline" onClick={() => void resend()} className="h-10 rounded-xl border-border">확인 메일 다시 받기</Button>{resent && <p role="status" className="mt-2 text-primary">{resent}</p>}</div>}
        <Button type="submit" disabled={busy} aria-busy={busy} className={`h-12 w-full rounded-xl ${motion}`}>{busy ? <Busy text="로그인하는 중이에요…" /> : <>로그인 <ArrowRight size={16} /></>}</Button>
      </form>
      {!LIVE && <Link to="/today" className="mt-5 block text-center text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline">로그인 없이 회원 공간 둘러보기</Link>}
    </Frame>
  )
}

export function SignupPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [again, setAgain] = useState("")
  const [adult, setAdult] = useState(false)
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [typoChecked, setTypoChecked] = useState("")
  const [resent, setResent] = useState("")
  const suggestion = suggestEmail(email)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password !== again) return setError("비밀번호가 서로 달라요.")
    if (suggestion && typoChecked !== email) return setError(`메일 주소를 한 번 더 확인해 주세요. ${suggestion} 아닌가요?`)
    setBusy(true)
    const result = await signUp({ email, password, adult, terms, privacy })
    setBusy(false)
    if (result.error) return setError(result.error)
    if (result.confirm) return setSent(true)
    navigate("/apply")
  }
  const check = (id: string, checked: boolean, set: (value: boolean) => void, label: ReactNode) => (
    <label htmlFor={id} className="flex items-start gap-3 text-sm leading-6"><Checkbox id={id} className="mt-1" checked={checked} onCheckedChange={(value) => { set(value === true); setError("") }} />{label}</label>
  )
  const resend = async () => { const result = await resendConfirmation(email); setResent(result.error || "확인 메일을 다시 보냈어요. 1~2분 안에 도착해요.") }
  if (sent) return (
    <Frame title="메일을 확인해 주세요" foot={<p><Link to="/login" className="underline underline-offset-4 hover:text-primary">로그인으로 가기</Link></p>}>
      <div className="space-y-4 text-sm leading-7">
        <p><span className="font-semibold">{email.trim().toLowerCase()}</span>(으)로 가입 확인 메일을 보냈어요. 메일의 버튼을 누르면 가입이 끝나고 바로 소개 신청으로 이어져요. 어느 휴대폰·앱에서 열어도 괜찮아요.</p>
        <div className="rounded-xl bg-mist p-4 text-xs leading-6">
          <p className="font-semibold">메일이 오지 않나요?</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-muted-foreground">
            <li>스팸함·프로모션함을 확인해 주세요. 보내는 주소는 {BEFORE_US.operator.email} 이에요.</li>
            <li>주소를 잘못 적었다면 아래 ‘다른 주소로 다시 가입’을 눌러 주세요.</li>
            <li>그래도 없으면 확인 메일을 다시 받아 주세요.</li>
          </ol>
          <div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => void resend()} className="h-9 rounded-lg border-border text-xs">확인 메일 다시 받기</Button><Button type="button" variant="ghost" onClick={() => { setSent(false); setResent(""); setTypoChecked("") }} className="h-9 rounded-lg text-xs">다른 주소로 다시 가입</Button></div>
          {resent && <p role="status" className="mt-2 text-primary">{resent}</p>}
        </div>
        <p className="text-xs leading-6 text-muted-foreground">{EXISTING_EMAIL_NOTE.replace(/문의하기로 남겨 주세요\.$/, "")}<Link to="/contact?type=개인정보·탈퇴" className="underline underline-offset-4 hover:text-primary">문의하기</Link>로 남겨 주세요.</p>
      </div>
    </Frame>
  )
  return (
    <Frame title="회원가입" lead={`계정에는 이메일과 비밀번호만 받아요. 사진과 이야기는 가입 뒤 소개 신청에서 천천히 적어요.`} foot={<p>이미 계정이 있나요? <Link to="/login" className="text-foreground underline underline-offset-4 hover:text-primary">로그인</Link></p>}>
      <form className="space-y-5" onSubmit={submit} noValidate>
        <div>
          <Field id="signup-email" label="이메일" type="email" autoComplete="email" value={email} onChange={(value) => { setEmail(value); setError("") }} />
          {suggestion && typoChecked !== email && <div role="status" className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs leading-6"><p>혹시 <span className="font-semibold">{suggestion}</span> 아닌가요? 주소가 틀리면 가입 확인 메일을 받을 수 없어요.</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" size="sm" onClick={() => { setEmail(suggestion); setError("") }} className="h-8 rounded-lg text-xs">{suggestion}(으)로 고치기</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setTypoChecked(email); setError("") }} className="h-8 rounded-lg text-xs">적은 그대로 쓸게요</Button></div></div>}
        </div>
        <Field id="signup-password" label="비밀번호" type="password" autoComplete="new-password" value={password} onChange={(value) => { setPassword(value); setError("") }} hint={PASSWORD_RULE} />
        <Field id="signup-again" label="비밀번호 확인" type="password" autoComplete="new-password" value={again} onChange={(value) => { setAgain(value); setError("") }} />
        <div className="space-y-3 border-t border-border pt-5">
          {check("signup-adult", adult, setAdult, <span>만 19세 이상이에요. <span className="text-muted-foreground">{LIVE ? "(필수 · 소개 신청서의 생년월일로 다시 확인해요. 베타는 1992~2007년생 가운데 만 19세 이상)" : "(필수 · 소개 신청 때 휴대폰 본인 인증으로 다시 확인해요)"}</span></span>)}
          {check("signup-terms", terms, setTerms, <span><Link to="/terms" className="underline underline-offset-4">이용약관</Link>에 동의해요. <span className="text-muted-foreground">(필수)</span></span>)}
          {check("signup-privacy", privacy, setPrivacy, <span><Link to="/privacy" className="underline underline-offset-4">개인정보 수집·이용</Link>에 동의해요. <span className="text-muted-foreground">(필수) · 이메일과 비밀번호(알아볼 수 없게 바꿔 저장)를 회원 확인·로그인·서비스 안내에 쓰고, 탈퇴 요청 뒤 7일 안에 지워요(백업 최대 30일). 거부하면 가입할 수 없어요.</span></span>)}
        </div>
        <ErrorText text={error} />
        <Button type="submit" disabled={busy} aria-busy={busy} className={`h-12 w-full rounded-xl ${motion}`}>{busy ? <Busy text="가입하는 중이에요… 잠시만요" /> : <>가입하고 소개 신청으로 <ArrowRight size={16} /></>}</Button>
      </form>
    </Frame>
  )
}

// 메일 링크 확인(/auth/confirm?token_hash=…&type=email|recovery&next=…): 확인되면 바로 로그인해 다음 화면으로 보낸다.
export function AuthConfirmPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState("")
  useEffect(() => {
    const tokenHash = params.get("token_hash") ?? ""
    const type = params.get("type") === "recovery" ? "recovery" : "email"
    const wanted = params.get("next") ?? ""
    const next = type === "recovery" ? "/reset-password?token=recovery" : /^\/[a-z-]*$/.test(wanted) ? wanted : "/apply"
    if (!tokenHash) { setError("링크가 올바르지 않아요. 메일의 버튼을 다시 눌러 주세요."); return }
    void confirmEmailLink(tokenHash, type).then((result) => { if (result.error) setError(result.error); else navigate(next, { replace: true }) })
  }, [])
  return (
    <Frame title={error ? "링크를 확인하지 못했어요" : "확인하고 있어요"} foot={<p><Link to="/login" className="underline underline-offset-4 hover:text-primary">로그인으로 가기</Link></p>}>
      {error ? <div className="space-y-4 text-sm leading-7"><p>{error}</p><Button asChild className={`h-12 w-full rounded-xl ${motion}`}><Link to="/login">로그인하기 <ArrowRight size={16} /></Link></Button></div>
        : <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />메일 확인이 끝나면 바로 이어져요.</p>}
    </Frame>
  )
}

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get("token")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [again, setAgain] = useState("")
  const [error, setError] = useState("")
  const [sent, setSent] = useState<{ devLink: string | null } | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  if (token) {
    const submit = async (event: FormEvent) => {
      event.preventDefault()
      if (busy) return
      if (password !== again) return setError("비밀번호가 서로 달라요.")
      setBusy(true)
      const result = await resetPassword(token, password).finally(() => setBusy(false))
      if (result.error) return setError(result.error)
      setDone(true)
    }
    return (
      <Frame title="새 비밀번호 정하기">
        {done ? (
          <div className="space-y-4"><p className="text-sm leading-7">비밀번호를 바꿨어요. 다른 기기의 로그인도 함께 끊었어요.</p><Button asChild className={`h-12 w-full rounded-xl ${motion}`}><Link to="/login">로그인하기 <ArrowRight size={16} /></Link></Button></div>
        ) : (
          <form className="space-y-5" onSubmit={submit} noValidate>
            <Field id="reset-password" label="새 비밀번호" type="password" autoComplete="new-password" value={password} onChange={(value) => { setPassword(value); setError("") }} hint={PASSWORD_RULE} />
            <Field id="reset-again" label="새 비밀번호 확인" type="password" autoComplete="new-password" value={again} onChange={(value) => { setAgain(value); setError("") }} />
            <ErrorText text={error} />
            <Button type="submit" disabled={busy} aria-busy={busy} className={`h-12 w-full rounded-xl ${motion}`}>{busy ? <Busy text="바꾸는 중이에요…" /> : "비밀번호 바꾸기"}</Button>
          </form>
        )}
      </Frame>
    )
  }
  const request = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    const result = await requestPasswordReset(email).finally(() => setBusy(false))
    if (result.error) return setError(result.error)
    setSent({ devLink: result.devLink })
  }
  return (
    <Frame title="비밀번호 다시 설정하기" lead={`가입한 이메일을 적어 주시면, ${LIVE ? "1시간" : "30분"} 동안 쓸 수 있는 재설정 링크를 보내 드려요.`} foot={<p><Link to="/login" className="underline underline-offset-4 hover:text-primary">로그인으로 돌아가기</Link></p>}>
      {sent ? (
        <div className="space-y-4 text-sm leading-7">
          <p>입력하신 이메일이 가입되어 있다면, 재설정 링크를 보냈어요. 메일이 오지 않으면 스팸함을 확인해 주세요.</p>
          {sent.devLink && <p className="rounded-xl bg-muted p-4 text-xs leading-6">데모라 메일을 보내지 않아요. 대신 <Link to={sent.devLink} className="text-primary underline underline-offset-4">여기에서 재설정 링크를 열 수 있어요</Link>.</p>}
        </div>
      ) : (
        <form className="space-y-5" onSubmit={request} noValidate>
          <Field id="reset-email" label="이메일" type="email" autoComplete="email" value={email} onChange={(value) => { setEmail(value); setError("") }} />
          <ErrorText text={error} />
          <Button type="submit" disabled={busy} aria-busy={busy} className={`h-12 w-full rounded-xl ${motion}`}>{busy ? <Busy text="보내는 중이에요…" /> : "재설정 링크 받기"}</Button>
        </form>
      )}
    </Frame>
  )
}

// 내 정보 아래쪽 ‘계정’: 로그인 상태, 로그아웃, 탈퇴(비밀번호 재확인).
export function AccountPanel() {
  const user = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  if (result) return <section className="border-t border-border pt-6 text-sm leading-7" aria-label="계정"><p className="font-semibold">탈퇴 요청을 받았어요.</p><p className="mt-1 text-muted-foreground">상대 노출과 알림은 바로 멈췄고, 일반 자료는 {result}까지 지워요. 그 전에 마음이 바뀌면 문의하기로 남겨 주세요. 그동안 고마웠어요.</p><Button className="mt-4 h-11 rounded-full px-6" onClick={() => { signOut(); navigate("/") }}>확인했어요 · 로그아웃</Button></section>
  if (!user) return (
    <section className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-sm" aria-label="계정">
      <p className="text-muted-foreground">로그인하지 않고 둘러보는 중이에요.</p>
      <div className="flex gap-2"><Button asChild variant="outline" className="rounded-xl"><Link to="/login">로그인</Link></Button><Button asChild className="rounded-xl"><Link to="/signup">회원가입</Link></Button></div>
    </section>
  )
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!agree) return setError("안내를 확인했다고 체크해 주세요.")
    if (sending) return
    setSending(true)
    const outcome = await withdraw(password)
    setSending(false)
    if (outcome.error) return setError(outcome.error)
    setResult(outcome.deletionDueAt ? kstDay(outcome.deletionDueAt) : "7일 안")
  }
  return (
    <section className="space-y-4 border-t border-border pt-6 text-sm" aria-label="계정">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p><span className="text-muted-foreground">로그인 계정</span> <span className="ml-2 font-medium">{user.email}</span></p>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => { signOut(); navigate("/") }}>로그아웃</Button>
          <Button variant="ghost" className="rounded-xl text-muted-foreground" aria-expanded={open} onClick={() => setOpen((value) => !value)}>회원 탈퇴</Button>
        </div>
      </div>
      {open && (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border p-5" noValidate>
          <p className="leading-7">탈퇴하면 상대 노출과 알림이 바로 멈추고, 진행 중인 소개·교류는 종료돼요. 일반 자료는 {BEFORE_US.privacy.activeDeleteDays}일 안에, 백업은 최대 {BEFORE_US.privacy.backupMaxDays}일 안에 지워요.{LIVE && BEFORE_US.beta.active ? "" : " 결제 환불은 환불 기준에 따라 따로 안내해요."}</p>
          <Field id="withdraw-password" label="비밀번호 다시 입력" type="password" autoComplete="current-password" value={password} onChange={(value) => { setPassword(value); setError("") }} />
          <label htmlFor="withdraw-agree" className="flex items-start gap-3 leading-6"><Checkbox id="withdraw-agree" className="mt-1" checked={agree} onCheckedChange={(value) => { setAgree(value === true); setError("") }} />위 내용을 확인했어요.</label>
          <ErrorText text={error} />
          <Button type="submit" variant="outline" disabled={sending} className="rounded-xl border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive">{sending ? "보내는 중…" : "탈퇴 요청하기"}</Button>
        </form>
      )}
    </section>
  )
}
