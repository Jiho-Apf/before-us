import { useEffect, useState } from "react";
import { Share, Smartphone, X } from "lucide-react";

// 홈 화면에 추가 안내: 휴대폰 브라우저에서만 보이고, 이미 홈 화면에서 연 경우에는 숨긴다.
// 아이폰은 홈 화면에 둔 사이트의 로그인을 오래 지켜 준다(사파리의 7일 정리에서 빠짐). 다만 저장 공간이 사파리와 따로라 처음 한 번은 다시 로그인한다. 안드로이드 크롬은 바로 추가 창을 띄울 수 있다.
// 카카오톡·인스타그램 같은 앱 안 브라우저에서는 추가할 수 없어, 다른 브라우저로 여는 방법을 먼저 알린다.
type Where = "ios" | "android" | "inapp";
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const DISMISS_KEY = "flavie:home-tip";
const interaction = "transition-colors duration-200 motion-reduce:transition-none";

function where(): Where | null {
  if (typeof window === "undefined") return null;
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return null;
  const ua = navigator.userAgent;
  if (/KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\(inapp|Barcelona|everytimeApp/i.test(ua)) return "inapp";
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return null;
}
const dismissed = () => { try { return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now() - 30 * 86400000; } catch { return false; } };

export function HomeScreenTip({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const [env] = useState(where);
  const [hidden, setHidden] = useState(() => !compact && dismissed());
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const keep = (event: Event) => { event.preventDefault(); setInstall(event as InstallPrompt); };
    window.addEventListener("beforeinstallprompt", keep);
    return () => window.removeEventListener("beforeinstallprompt", keep);
  }, []);
  if (!env || hidden) return null;
  const close = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* 저장 못 해도 이번에는 닫는다 */ } setHidden(true); };
  const text = env === "ios"
    ? <>Safari 아래쪽 <Share size={13} aria-label="공유" className="mx-0.5 inline -translate-y-px text-primary" /> 공유 버튼에서 ‘홈 화면에 추가’를 고르면, 앱처럼 바로 열리고 로그인도 오래 유지돼요. 처음 열 때 한 번만 다시 로그인해 주세요.</>
    : env === "android"
      ? install ? "홈 화면에 두면 앱처럼 바로 열려요." : "브라우저 메뉴(⋮)에서 ‘홈 화면에 추가’를 고르면 앱처럼 바로 열려요."
      : "지금은 앱 안 브라우저예요. 오른쪽 위 메뉴에서 ‘다른 브라우저로 열기’를 누른 뒤 홈 화면에 추가하면 앱처럼 바로 열려요.";
  return <div role="note" className={`flex items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 text-xs leading-6 ${className}`}>
    <Smartphone size={16} aria-hidden="true" className="mt-1 shrink-0 text-primary" />
    <p className="min-w-0 flex-1">{!compact && <span className="mr-1 font-semibold text-ink">플라비를 홈 화면에 두세요.</span>}{text}</p>
    {env === "android" && install && <button type="button" onClick={() => { void install.prompt(); void install.userChoice.then(() => setInstall(null)); }} className={`shrink-0 rounded-full border border-primary/30 px-3 py-1 text-[11px] font-semibold text-primary hover:bg-primary/5 ${interaction}`}>홈 화면에 추가</button>}
    {!compact && <button type="button" aria-label="안내 닫기" onClick={close} className={`-mr-1 shrink-0 rounded-full p-1 text-muted-foreground hover:bg-card hover:text-foreground ${interaction}`}><X size={14} /></button>}
  </div>;
}
