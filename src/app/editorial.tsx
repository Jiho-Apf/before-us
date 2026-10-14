import type { ReactNode } from "react"

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
  return <p className="flex items-center gap-3 border-t border-border pt-5 text-xs leading-6 text-muted-foreground"><TwoDots />{children}</p>
}
