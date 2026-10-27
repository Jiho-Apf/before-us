// 운영진이 직접 고른다는 약속. 편지 아래에서 부드러운 버터 노란 면에 아주 옅은 종이결을 얹어 조용히 강조한다.
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
import { Underline } from "./HomeVisuals";

export default function DirectIntroduction() {
  return (
    <div className="relative isolate overflow-hidden rounded-2xl bg-[#F8E5A6] p-7 text-[#2B2540] ring-1 ring-inset ring-[#2B2540]/5 sm:p-9 dark:bg-[#3B3424] dark:text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-[0.12] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
      <div className="grid gap-5 sm:grid-cols-[2fr_3fr] sm:gap-10">
        <div>
          <div className="flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.2em] text-[#7A5A10] dark:text-[#F3D98A]">
            <span aria-hidden="true" className="flex gap-1"><span className="size-1.5 rounded-full bg-primary" /><span className="size-1.5 rounded-full bg-accent" /></span>
            운영진이 직접 고르는 소개
          </div>
          <div className="mt-4 text-xl font-semibold leading-relaxed sm:text-2xl">
            자동 점수로<br className="hidden sm:block" /> 사람을 붙이지 않아요.
          </div>
        </div>
        <div>
          <p className="text-sm leading-7 text-[#2B2540]/85 dark:text-white/85">
            <Underline>운영진이 신청서와 사진, 외적인 취향, 관계 기준, 생활·대화 성향</Underline>을 직접 살펴 최종 한 사람을 제안해요.
          </p>
          <p className="mt-3 border-t border-[#2B2540]/10 pt-3 text-xs leading-6 text-[#2B2540]/65 dark:border-white/15 dark:text-white/65">
            신청이 많을 때는 직접 입력하신 답변이 서로 겹치는 지점부터 살펴봐요.
            사진이나 외모로 판단하지 않으며, 누구를 소개할지는 운영진이 직접 정해요.
          </p>
        </div>
      </div>
    </div>
  );
}
