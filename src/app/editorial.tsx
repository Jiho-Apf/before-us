import { useEffect, useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"

// 편지 화면에서 시작한 조용한 편집 톤을 회원 화면 전체에 맞추기 위한 공통 조각.
// 진한 색 면 대신 얇은 선·여백·큰 숫자로 무게를 준다.

export function Sheet({ children, tone = "plain", className = "" }: { children: ReactNode; tone?: "plain" | "soft"; className?: string }) {
  return <div className={`relative border border-border ${tone === "soft" ? "bg-muted/40" : "bg-card"} shadow-[0_1px_0_var(--border),0_24px_48px_-32px_color-mix(in_oklch,var(--primary)_35%,transparent)] ${className}`}>{children}</div>
}

export function TwoDots({ apart = false, faded = false }: { apart?: boolean; faded?: boolean }) {
  return (
    <span aria-hidden="true" className={`flex items-center ${apart ? "gap-6" : "gap-1.5"}`}>
      <span className="size-2.5 rounded-full bg-primary" />
      <span className={`size-2.5 rounded-full ${faded ? "border border-dashed border-muted-foreground/60" : "bg-accent"}`} />
    </span>
  )
}

// 작은 머리말: "A ── 편지 나누기  THREE LETTERS"
export function Eyebrow({ mark, label, en }: { mark?: string; label: string; en?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {mark && <span className="font-semibold text-accent">{mark}</span>}
      <span aria-hidden="true" className="h-px w-8 bg-accent/40" />
      <span className="font-semibold">{label}</span>
      {en && <span className="tracking-[0.16em] text-muted-foreground">{en}</span>}
    </div>
  )
}

export function PageHeader({ mark, label, en, title, titleId, lead, aside }: { mark?: string; label: string; en?: string; title: ReactNode; titleId?: string; lead?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-8">
      <div className="min-w-0 max-w-2xl">
        <Eyebrow mark={mark} label={label} en={en} />
        <h1 id={titleId} className="mt-5 text-3xl font-semibold leading-[1.4] sm:text-[34px]">{title}</h1>
        {lead && <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">{lead}</p>}
      </div>
      {aside}
    </header>
  )
}

// 세로 흐름(1 → 2 → 3)을 선으로 잇는 단계 목록
export function Timeline({ items, current }: { items: { title: string; body: ReactNode; meta?: string }[]; current?: number }) {
  return (
    <ol className="relative">
      <span aria-hidden="true" className="absolute bottom-3 left-[7px] top-3 w-px bg-border" />
      {items.map((item, index) => {
        const done = current !== undefined && index < current
        const now = current === index
        return (
          <li key={item.title} aria-current={now ? "step" : undefined} className="relative flex gap-5 pb-8 last:pb-0">
            <span aria-hidden="true" className={`relative z-10 mt-1 grid size-4 shrink-0 place-items-center rounded-full ring-4 ring-background ${now ? "bg-accent" : done ? "bg-primary" : "border border-border bg-background"}`}>{done && <span className="size-1.5 rounded-full bg-white" />}</span>
            <div className="min-w-0">
              {item.meta && <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">{item.meta}</p>}
              <p className={`text-base font-semibold ${now ? "text-accent" : ""}`}>{item.title}</p>
              <div className="mt-1.5 text-sm leading-7 text-muted-foreground">{item.body}</div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function QuietNote({ children }: { children: ReactNode }) {
  // 글 안에 연결 글자(Link)가 섞여도 한 문장으로 이어지도록 글은 한 덩어리로 감싼다(그러지 않으면 글과 연결 글자가 따로 된 칸으로 쪼개짐).
  return <p className="flex items-start gap-3 border-t border-border pt-5 text-xs leading-6 text-muted-foreground"><span className="mt-[9px] shrink-0"><TwoDots /></span><span className="min-w-0">{children}</span></p>
}

// 기억에 남을 장면(서로 선택했을 때, 두 사람 모두 만나고 싶다고 했을 때).
// 떨어져 있던 두 점이 천천히 가까워진다. ‘동작 줄이기’ 설정이면 처음부터 가까이 둔다.
export function Moment({ eyebrow, title, children, action }: { eyebrow: string; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setNear(true); return }
    const timer = window.setTimeout(() => setNear(true), 250)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <section role="status" className="relative overflow-hidden border border-border bg-card px-6 py-14 text-center sm:px-10 sm:py-20">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent)]" />
      <div aria-hidden="true" className="relative mx-auto flex h-6 w-40 items-center justify-center">
        <span className="absolute size-4 rounded-full bg-primary transition-transform duration-[1400ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none" style={{ transform: `translateX(${near ? -9 : -64}px)` }} />
        <span className="absolute size-4 rounded-full bg-accent transition-transform duration-[1400ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none" style={{ transform: `translateX(${near ? 9 : 64}px)` }} />
      </div>
      <p className="relative mt-8 text-xs font-semibold tracking-[0.2em] text-accent">{eyebrow}</p>
      <h2 className="relative mx-auto mt-4 max-w-lg text-2xl font-semibold leading-[1.5] sm:text-[30px]">{title}</h2>
      {children && <div className="relative mx-auto mt-4 max-w-md text-sm leading-7 text-muted-foreground">{children}</div>}
      {action && <div className="relative mt-8 flex justify-center">{action}</div>}
    </section>
  )
}

// 안내가 여러 줄일 때: 문단을 늘어놓지 않고 ‘짧은 제목 + 한두 줄 설명’ 목록으로 묶는다(넓은 화면에서는 두 칸).
export function NoteList({ title, items, className = "" }: { title?: string; items: { title: string; body: ReactNode }[]; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-muted/30 p-5 sm:p-6 ${className}`}>
      {title && <p className="mb-4 text-xs font-semibold text-accent">{title}</p>}
      <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.title} className="flex gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary/60" />
            <div className="min-w-0"><p className="text-xs font-semibold leading-5">{item.title}</p><p className="mt-1 text-xs leading-6 text-muted-foreground">{item.body}</p></div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// 마이페이지 같은 정보가 많은 화면에서: 묶음 제목(큰 숫자 + 이름)과 접어 두는 칸.
export function GroupTitle({ number, title, en, lead }: { number: string; title: string; en?: string; lead?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-end gap-4">
        <span aria-hidden="true" className="text-[44px] font-extralight leading-none tabular-nums text-primary">{number}</span>
        <div className="pb-1"><h2 className="text-xl font-semibold leading-tight text-ink">{title}</h2>{lead && <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{lead}</p>}</div>
      </div>
      {en && <span className="pb-1 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">{en}</span>}
    </div>
  )
}

export function Fold({ id, icon, title, summary, children, defaultOpen = false, tone = "plain" }: { id?: string; icon?: ReactNode; title: string; summary?: ReactNode; children: ReactNode; defaultOpen?: boolean; tone?: "plain" | "danger" }) {
  return (
    <details id={id} open={defaultOpen} className={`group scroll-mt-24 rounded-2xl border bg-card transition-shadow duration-300 open:shadow-[0_24px_48px_-36px_color-mix(in_oklch,var(--primary)_45%,transparent)] motion-reduce:transition-none ${tone === "danger" ? "border-destructive/25" : "border-border"}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-start gap-3">
          {icon && <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-lilac text-primary"}`}>{icon}</span>}
          <span className="min-w-0"><span className="block text-[15px] font-semibold">{title}</span>{summary && <span className="mt-1 block text-xs leading-5 text-muted-foreground">{summary}</span>}</span>
        </span>
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"><ChevronDown size={15} /></span>
      </summary>
      {/* 안에 넣은 기존 구역의 윗선·여백·같은 제목은 접는 칸 머리가 대신한다. */}
      <div className="space-y-5 border-t border-border px-5 pb-6 pt-5 sm:px-6 [&>section:first-child]:mt-0 [&>section:first-child]:border-t-0 [&>section:first-child]:pt-0 [&>section:first-child>h2:first-child]:hidden">{children}</div>
    </details>
  )
}
