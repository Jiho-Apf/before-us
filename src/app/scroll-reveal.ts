import { useEffect, type RefObject } from "react"

// 공개 홈 스크롤 등장 효과. 각 섹션의 바로 아래 요소들이 처음 화면에 들어올 때 한 번만,
// 살짝 아래에서 제자리로 올라오며 서서히 보인다(0.6초, 요소마다 0.09초씩 늦게).
//  - 첫 화면(첫 번째 섹션)은 제외한다.
//  - 이용 요금·FAQ처럼 꼭 읽어야 하는 섹션은 움직임을 더 작게 한다.
//  - ‘동작 줄이기’ 설정이면 아무것도 하지 않는다. 숨김은 스크립트가 직접 걸기 때문에 실패해도 내용이 숨은 채 남지 않는다.
//  - 끝나면 인라인 스타일을 지워 기존 hover 이동 효과와 겹치지 않게 한다.
const QUIET_SECTIONS = new Set(["pricing", "faq"])
const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)"

export function useScrollReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = root.current
    if (!container || typeof IntersectionObserver === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const sections = Array.from(container.querySelectorAll<HTMLElement>(":scope > section")).slice(1)
    const targets: HTMLElement[] = []
    for (const section of sections) {
      const quiet = QUIET_SECTIONS.has(section.id)
      Array.from(section.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement && child.getAttribute("aria-hidden") !== "true")
        .forEach((child, index) => {
          child.dataset.reveal = ""
          child.style.opacity = "0"
          child.style.transform = `translateY(${quiet ? 6 : 14}px)`
          child.style.transition = `opacity 600ms ${EASE} ${Math.min(index, 4) * 90}ms, transform 600ms ${EASE} ${Math.min(index, 4) * 90}ms`
          child.style.willChange = "opacity, transform"
          targets.push(child)
        })
    }
    const clear = (element: HTMLElement) => {
      element.style.removeProperty("opacity")
      element.style.removeProperty("transform")
      element.style.removeProperty("transition")
      element.style.removeProperty("will-change")
      delete element.dataset.reveal
    }
    const timers: number[] = []
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const element = entry.target as HTMLElement
        observer.unobserve(element)
        element.style.opacity = "1"
        element.style.transform = "translateY(0)"
        timers.push(window.setTimeout(() => clear(element), 1100))
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 })
    targets.forEach((element) => observer.observe(element))
    return () => {
      observer.disconnect()
      timers.forEach((timer) => window.clearTimeout(timer))
      targets.forEach(clear)
    }
  }, [root])
}

// 스크롤바를 뺀 실제 페이지 폭. 홈의 색 면(.bleed)이 양쪽 끝에 정확히 맞도록 쓴다.
export function usePageWidth() {
  useEffect(() => {
    const root = document.documentElement
    const update = () => root.style.setProperty("--page-width", `${root.clientWidth}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])
}
