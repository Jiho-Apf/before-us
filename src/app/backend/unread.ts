import { useEffect, useState } from "react"
import { supabase } from "./client"

// 읽지 않은 알림 수(회원 메뉴 '오늘'의 점 표시). 화면을 옮길 때마다 다시 센다. key가 null이면 세지 않는다(데모).
// 공개 첫 화면에 회원 모듈(계정·회원 자료)이 같이 실리지 않도록 따로 둔다(GPT 검수 C14). 로그인 여부는 부르는 쪽이 넘긴다.
export function useUnreadCount(key: string | null, signedIn: boolean) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!signedIn || key === null) { setCount(0); return }
    let alive = true
    void (async () => {
      try {
        const db = await supabase()
        const { count: n } = await db.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null)
        if (alive) setCount(n ?? 0)
      } catch { /* 표시만 생략 */ }
    })()
    return () => { alive = false }
  }, [signedIn, key])
  return count
}
