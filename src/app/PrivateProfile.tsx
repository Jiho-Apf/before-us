import { useEffect, useRef, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "./components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { acknowledgeViewing, recordProfileView, useViewingSession } from "./viewing-session";

export function PrivateProfile({
  memberId, introductionId, profileVersion, children, onViewed,
}: { memberId: string; introductionId: string; profileVersion: number; children: ReactNode; onViewed?: () => void }) {
  const session = useViewingSession(memberId);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const record = () => {
      const rect = content.current?.getBoundingClientRect();
      if (session?.acknowledged && document.visibilityState === "visible" && rect && rect.bottom > 0 && rect.top < window.innerHeight) {
        recordProfileView(memberId, introductionId, profileVersion);
        onViewed?.();
      }
    };
    record();
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(record);
    if (content.current) observer?.observe(content.current);
    document.addEventListener("visibilitychange", record);
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", record); };
  }, [session, memberId, introductionId, profileVersion, onViewed]);
  if (!session?.acknowledged) return (
    <Alert className="rounded-xl p-6">
      <ShieldCheck className="text-primary" />
      <AlertTitle>이번 소개를 위한 개인 열람</AlertTitle>
      <AlertDescription className="mt-3 space-y-4 leading-7">
        <p>상대의 사진과 소개는 이번 소개를 위해 공유된 정보예요. 캡처·저장·외부 공유를 삼가 주세요.</p>
        <p className="text-xs">웹에서는 브라우저·운영체제의 스크린샷이나 다른 기기로 촬영하는 행위까지 기술적으로 막을 수 없어요.</p>
        <Button disabled={!session} onClick={() => acknowledgeViewing(memberId)} className="rounded-xl">
          확인 후 계속 보기
        </Button>
        <p className="text-xs">가상 열람 안내 · 이 탭에서 회원별로 한 번 확인하며 새로고침하면 초기화돼요.</p>
      </AlertDescription>
    </Alert>
  );
  return <div ref={content} className="min-w-0">{children}</div>;
}

export function PrivatePhoto({ memberId, children, className = "" }: {
  memberId: string; children: ReactNode; className?: string;
}) {
  const session = useViewingSession(memberId);
  const [position, setPosition] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      clearInterval(timer);
      if (!reduced.matches) timer = setInterval(() => setPosition(value => (value + 1) % 3), 30000);
    };
    update();
    reduced.addEventListener("change", update);
    return () => { clearInterval(timer); reduced.removeEventListener("change", update); };
  }, []);
  const positions = ["bottom-3 left-3", "top-3 right-3", "bottom-3 right-3"];
  return (
    <div
      draggable={false}
      onDragStart={event => event.preventDefault()}
      onContextMenu={event => event.preventDefault()}
      className={`private-photo relative select-none overflow-hidden ${className}`}
    >
      {children}
      <div aria-hidden="true" className={`pointer-events-none absolute max-w-full rounded-md bg-background/65 px-2 py-1 text-xs font-medium text-foreground/70 ${positions[position]}`}>
        FLAVIE · 개인 열람용 · {session?.code || "DEMO"}
      </div>
    </div>
  );
}
