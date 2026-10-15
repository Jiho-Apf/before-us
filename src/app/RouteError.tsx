import { useEffect } from "react"
import { Link, isRouteErrorResponse, useRouteError } from "react-router"
import { isStaleChunkError, reportError } from "./error-report"

// 화면을 그리다 오류가 나면 흰 화면 대신 이 안내를 보여 주고, 오류 알림으로 보낸다.
export default function RouteError() {
  const error = useRouteError()
  const stale = isStaleChunkError(error)
  const missing = isRouteErrorResponse(error) && error.status === 404
  useEffect(() => { if (!missing) reportError(error, stale ? "route.stale-chunk" : "route") }, [error, missing, stale])
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center break-keep px-6 py-16 font-sans">
      <span aria-hidden="true" className="flex gap-1.5"><span className="size-2.5 rounded-full bg-primary" /><span className="size-2.5 rounded-full bg-accent" /></span>
      <h1 className="mt-6 text-2xl font-semibold leading-[1.5]">{missing ? "페이지를 찾을 수 없어요." : stale ? "새 버전이 준비됐어요." : "화면을 여는 중에 문제가 생겼어요."}</h1>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{missing ? "주소를 다시 확인해 주세요." : stale ? "새로고침하면 최신 화면으로 이어져요." : "잠시 뒤 다시 시도해 주세요. 같은 문제가 계속되면 문의하기로 알려 주세요. 문제 내용은 운영진에게 자동으로 전달돼요."}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        {!missing && <button type="button" onClick={() => window.location.reload()} className="h-11 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground">새로고침</button>}
        <Link to="/" className="inline-flex h-11 items-center rounded-xl border border-border px-5 text-sm">공개 홈으로</Link>
        <Link to="/contact" className="inline-flex h-11 items-center px-2 text-sm text-muted-foreground underline underline-offset-4">문의하기</Link>
      </div>
    </main>
  )
}
