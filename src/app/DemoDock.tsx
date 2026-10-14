import { useEffect, useId, useState, type ReactNode } from "react"
import { SlidersHorizontal, X } from "lucide-react"

// 개발용 데모 조작판. 화면 위를 차지하지 않도록 오른쪽 아래 버튼 안에 접어 둔다.
// 닫아도 내용은 마운트된 채로 유지해 입력값·안내 문구가 사라지지 않는다.
export function DemoDock({ title, note, defaultOpen = false, children }: { title: string; note?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])
  return (
    <>
      <p className="mb-6 flex items-center gap-2 text-[11px] tracking-wide text-muted-foreground">
        <span className="size-1.5 rounded-full bg-accent" aria-hidden />
        가상 데모 화면 · 상태는 오른쪽 아래 ‘데모 조작’에서 바꿀 수 있어요.
      </p>
      <div
        id={id}
        role="region"
        aria-label={title}
        hidden={!open}
        className="fixed inset-x-3 bottom-20 z-40 max-h-[70vh] overflow-y-auto rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[420px]"
      >
        <div className="mb-3 flex items-start justify-between gap-3 border-b border-border pb-3">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-accent">DEMO CONTROL</p>
            <p className="mt-1 text-sm font-semibold">{title}</p>
            {note && <p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p>}
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="데모 조작 닫기" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4 text-xs [&_input]:max-w-none">{children}</div>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-border bg-foreground px-4 py-2.5 text-xs font-medium text-background shadow-lg transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SlidersHorizontal size={14} /> 데모 조작
      </button>
    </>
  )
}
