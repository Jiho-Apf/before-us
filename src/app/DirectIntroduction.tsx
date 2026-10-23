// 운영진이 직접 고른다는 약속. 편지 아래에서 옅은 라일락 면으로 자연스럽게 강조한다.
export default function DirectIntroduction() {
  return (
    <div className="rounded-2xl bg-lilac p-7 sm:p-9">
      <div className="grid gap-5 sm:grid-cols-[2fr_3fr] sm:gap-10">
        <div>
          <div className="flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.2em] text-primary">
            <span aria-hidden="true" className="flex gap-1"><span className="size-1.5 rounded-full bg-primary" /><span className="size-1.5 rounded-full bg-accent" /></span>
            운영진이 직접 고르는 소개
          </div>
          <div className="text-ink mt-4 text-xl font-semibold leading-relaxed sm:text-2xl">
            자동 점수로<br className="hidden sm:block" /> 사람을 붙이지 않아요.
          </div>
        </div>
        <div>
          <p className="text-sm leading-7 text-foreground/80">
            운영진이 신청서와 사진, 외적인 취향, 관계 기준,
            생활·대화 성향을 직접 살펴 최종 한 사람을 제안해요.
          </p>
          <p className="mt-3 border-t border-primary/10 pt-3 text-xs leading-6 text-muted-foreground">
            신청이 많을 때는 직접 입력하신 답변이 서로 겹치는 지점을 정리해 주는
            보조 도구로 후보를 좁힐 수 있어요. 사진이나 외모로 판단하지 않으며,
            누구를 소개할지는 운영진이 직접 정해요.
          </p>
        </div>
      </div>
    </div>
  );
}
