export const BEFORE_US = {
  brand: { name: "플라비", english: "FLAVIE", message: "끌리는 사람을, 천천히 알아갑니다." },
  policyVersion: "V6",
  mode: "demo",
  operatingDraft: { minimumAge: 19, additionalRequiredConditionsMaximum: 3, defaultIntroductionProduct: "opposite-sex", photos: { recentMonths: 3, differentPhotos: true } },
  photoFiles: { allowedExtensions: ["jpg", "jpeg", "png", "webp"], maximumBytes: 10 * 1024 * 1024, recommendedShortSide: 800, heicConversionAvailable: false },
  capabilities: { collection: false, payments: false, sending: false, autoDeploy: false },
  pricing: { currency: "KRW", introduction: 10000, exchangePerPerson: 29000, firstExchangeTotalPerPerson: 39000, vatIncluded: true, recurring: false, extraIntroductionFeeBeforeFirstStart: 0 },
  introduction: { timezone: "Asia/Seoul", readyAt: "12:00", responseDeadlineNextDayAt: "11:00", dailyMaximum: 1, activeMaximum: 1, guaranteedDaily: false, stopNewOnMutualSelection: true, countLimitBeforeFirstStart: null, rightsEndAt: "actual-program-start" },
  introductionPlans: { version: "V6-intro-plan-02", standard: { label: "기본 소개", introductions: 5, dailyMaximum: 1, endsOnFirstStart: true }, bonus: { label: "한 번 더, 5번", introductions: 5, paidBy: "2026-12-31", usableUntil: "2027-12-31", oncePerAccount: true } },
  // 기수제(V6-cohort-01): 매달 마지막 날 정오에 시작, 신청 마감은 시작 4일 전. 인원은 관리자만 본다. 실제 서버 모드에서는 서버의 기수 표가 기준이다.
  cohorts: { version: "V6-cohort-01", cadence: "monthly-last-day", deadlineDaysBefore: 4, minimumPerGender: 10, maximumPerGender: 50, first: { number: 1, opensOn: "2026-12-11", startsOn: "2026-12-31", applicationDeadline: "2026-12-27" } },
  exchange: { plans: ["A", "B"], durationDays: 3, meetingDecisionDay: 4, requiresBothPayments: true, requiresSharedPlanAndStartDate: true },
  unstartedExchange: { preserveIntroductionRights: true, manageExchangePaymentSeparately: true },
  refund: { version: "V6-refund-01", introductionBeforeView: 10000, exchangeDayPrice: 10000, paymentHours: 24, agreementHours: 48, extensionHours: 24, extensionMaximum: 1, activeWaitingDays: 30 },
  unresolvedPolicies: { refund: "V6-refund-01 운영 기준 확정 · 실제 약관/법정 권리 검토 필요", retention: "V6-privacy-01 보유 초안 · 법률 검토 전", reuse: "V6-conduct-01 운영 기준 · 실제 약관 검토 필요", provisionPeriod: "V6-provision-01 · 소개 공개(정오)부터 다음 날 11:00 응답 마감까지 · 상호 선택 시 교류·약속이 끝날 때까지(최대 약속일 다음 날 23:59) · 종료·중단·차단·탈퇴 즉시 열람 종료" },
  privacy: { version: "V6-privacy-01-draft", activeDeleteDays: 7, backupMaxDays: 30, letterDaysAfterExchangeEnd: 30, appointmentDetailDaysAfterMeeting: 90, auditLogDays: 365, legal: { contractYears: 5, complaintYears: 3, advertisingMonths: 6, safetyEvidenceYearsAfterClose: 3 } },
  provision: { version: "V6-provision-01", introductionView: "until-response-deadline", mutualView: "until-program-end", maxAfterMeetingDay: "next-day-23:59", snapshotDeleteDaysAfterEnd: 30, reopenArchive: false },
  operations: { version: "V6-ops-01", reviewersOnDuty: 1, newReviewsPerReviewerPerDay: 20, pairsPerReviewerPerDay: 10, activeMembersPerGender: 40, betaPerGender: 10 },
  conduct: { version: "V6-conduct-01", lateCancelHours: 24, noShowGraceMinutes: 30, noShowSuspensionDays: 14, repeatReviewMinimumDays: 30, nextIntroductionFee: 10000, exchangeFee: 29000, reverifyAfterDays: 90, reverifyFields: ["사진", "지역", "직업", "관계상태", "선호"] },
  noonGuidance: { waitingNoteAfterDays: 4, reviewAfterDays: 7, counselingAfterDays: 14, criteriaStatus: "operating-draft", kakaoApproved: false, sendingConnected: false },
  agreement: { defaultStartTime: "09:00", timezone: "Asia/Seoul", defaultStart: "day-after-both-confirmed", status: "operating-draft" },
  letters: { opensAt: "09:00", closesAt: "23:59", timezone: "Asia/Seoul", recommendedMinimum: 300, recommendedMaximum: 600, scheduleResetPolicy: null },
  // 베타 운영(결제 없이). 베타는 언제든 끝날 수 있고, 끝내거나 정식 운영으로 바꾸기 7일 전에 사이트·메일로 알린다(운영진 ‘운영진’ 메뉴의 전체 공지).
  // 정식 운영으로 바꿀 때 active 를 false 로 바꾼다.
  // 베타 나이 범위(출생 연도 · 한국 나이 20~35세). 서버의 birth_year_range() 와 같이 바꾼다.
  ageBand: { minBirthYear: 1992, maxBirthYear: 2007, label: "1992~2007년생", korean: "한국 나이 20~35세", maxAge: 35 },
  beta: { active: true, startsOn: "2026-10-20", legalUpdatedOn: "2026-10-30", legalVersion: "beta-2026-10-30" },
  // 결제(PG): 토스페이먼츠 결제위젯(주문서형). 사업자등록 전이라 테스트 모드만 쓴다(승인돼도 실제로 돈이 나가지 않는다).
  // 클라이언트 키는 원래 브라우저에 들어가는 공개 값이다. 기본값은 토스가 문서·공식 예제에 공개한 결제위젯 문서 테스트 키이고,
  // 빌드할 때 VITE_TOSS_CLIENT_KEY 로 바꿀 수 있다. 시크릿 키는 절대 여기 두지 않는다(Supabase 비밀 값 TOSS_SECRET_KEY).
  // mode 와 금액(pricing.introduction · pricing.exchangePerPerson)은 서버의 public.payment_config() 와 같이 바꾼다(마이그레이션 3800).
  payments: { provider: "toss", mode: "test" as "test" | "live", clientKey: (import.meta.env.VITE_TOSS_CLIENT_KEY as string | undefined) || "test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm" },
  // 운영자(개인정보 보호책임자) 정보와 공식 SNS. 비어 있으면 화면에 ‘문의하기’로 대신 안내한다.
  operator: { name: "정지호", email: "beforeus.official.kr@gmail.com" },
  // 2026-10-30 이름을 바꾸며 새 아이디로(인스타그램에서 비어 있음을 확인). 대표가 이 아이디로 계정을 만들어야 링크가 열린다.
  social: { instagram: "flavie.official.kr", threads: "flavie.official.kr" },
  meeting: { policyVersion: "V6-DAY04-draft-1", timezone: "Asia/Seoul", decisionOpensAt: "09:00", decisionHours: 24, methodHours: 24, proposalHours: 48, replyHours: 24, coordinationTargetHours: 72, status: "operating-draft" },
} as const;
