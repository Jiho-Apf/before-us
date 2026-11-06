import { useRef, useState } from "react"
import { Link } from "react-router"
import { RotateCw } from "lucide-react"
import { Button } from "./components/ui/button"
import type { Failure } from "./backend/client"

// 불러오기 실패 안내(검수 R3-25): 화면을 ‘없음’으로 바꾸지 않고, 무엇을 못 했는지·확인한 이유·다시 불러오기·문의용 오류 번호를 보여 준다.
// 쓰는 곳: 교류·약속(LiveProgram) · 신청서(ApplicationForm). 다른 화면도 { error, failure } 를 그대로 넘기면 된다.
//  - 다시 불러오는 동안 단추를 막아 같은 요청이 겹치지 않게 한다.
//  - 로그인이 끝난 것(401)을 확인했을 때만 ‘다시 로그인하기’를 보여 준다.
export const splitRef = (message: string) => {
  const match = message.match(/\s*오류 번호 ([A-Z]\d{0,3}-[A-Z0-9]{4})\s*$/)
  return match ? { text: message.slice(0, match.index).trim(), ref: match[1] } : { text: message, ref: null as string | null }
}
export function LoadFailure({ error, failure, onRetry, className = "" }: { error: string; failure?: Failure | null; onRetry: () => unknown | Promise<unknown>; className?: string }) {
  const [busy, setBusy] = useState(false)
  // 빠르게 여러 번 눌러도 한 번만(상태가 그려지기 전의 두 번째 누름까지 막는다).
  const running = useRef(false)
  const { text, ref } = splitRef(error)
  const retry = async () => { if (running.current) return; running.current = true; setBusy(true); try { await onRetry() } finally { running.current = false; setBusy(false) } }
  return <section className={`min-h-[40vh] ${className}`} aria-live="polite">
    <p role="alert" className="max-w-xl text-sm leading-7 text-destructive">{text}</p>
    {ref && <p className="mt-1 text-xs leading-6 text-muted-foreground">문의할 때 오류 번호 <span className="font-semibold tabular-nums text-foreground">{ref}</span>를 알려 주세요. 회원 정보는 들어 있지 않아요.</p>}
    <div className="mt-5 flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={() => void retry()} className="h-11 whitespace-nowrap rounded-xl border-border"><RotateCw size={14} className={busy ? "animate-spin motion-reduce:animate-none" : ""} />{busy ? "불러오는 중…" : "다시 불러오기"}</Button>
      {failure?.kind === "auth" && <Button asChild className="h-11 rounded-xl"><Link to="/login">다시 로그인하기</Link></Button>}
    </div>
  </section>
}
