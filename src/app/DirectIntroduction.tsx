// 운영진이 직접 고른다는 약속. 편지 아래에서 짙은 남보라 판으로 조용히 강조한다.
export default function DirectIntroduction() {
  return (
    <div className="relative isolate overflow-hidden rounded-2xl bg-[#231E42] p-7 text-white sm:p-9 dark:bg-lilac">
      <span aria-hidden="true" className="pointer-events-none absolute -right-24 -top-32 -z-10 size-80 rounded-full bg-[radial-gradient(closest-side,rgba(143,123,234,0.32),transparent)]" />
      <div className="grid gap-5 sm:grid-cols-[2fr_3fr] sm:gap-10">
        <div>
          <div className="flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.2em] text-[#C9BEF7]">
            <span aria-hidden="true" className="flex gap-1"><span className="size-1.5 rounded-full bg-[#B9ABF2]" /><span className="size-1.5 rounded-full bg-[#8FA4F5]" /></span>
            운영진이 직접 고르는 소개
          </div>
          <div className="mt-4 text-xl font-semibold leading-relaxed sm:text-2xl">
            자동 점수로<br className="hidden sm:block" /> 사람을 붙이지 않아요.
          </div>
        </div>
        <div>
          <p className="text-sm leading-7 text-white/75">
            운영진이 신청서와 사진, 외적인 취향, 관계 기준,
            생활·대화 성향을 직접 살펴 최종 한 사람을 제안해요.
          </p>
          <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-6 text-white/50">
            신청이 많을 때는 직접 입력하신 답변이 서로 겹치는 지점을 정리해 주는
            보조 도구로 후보를 좁힐 수 있어요. 사진이나 외모로 판단하지 않으며,
            누구를 소개할지는 운영진이 직접 정해요.
          </p>
        </div>
      </div>
    </div>
  );
}
