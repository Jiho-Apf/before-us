import { Link } from "react-router"
import { BEFORE_US } from "./config"
import { PageHeader } from "./editorial"

// 이용약관·개인정보처리방침 자리. 법률 검토(사용자 결정으로 보류) 전이라 확정 문서가 아니라는 점을 분명히 하고,
// 지금 서비스가 따르는 핵심 기준만 요약한다. 숫자는 config.ts 값을 그대로 쓴다.
const P = BEFORE_US.privacy

const PRIVACY_POINTS = [
  { title: "필요한 만큼만 받아요", body: "소개에 꼭 필요한 정보만 받고, 본인 인증 결과의 원본(이름·전화번호·생년월일)은 저장하지 않아요." },
  { title: "상대에게는 고른 항목만", body: "신청서 마지막 단계에서 직접 고른 항목만, 특정 상대에게 제공하기 전에 한 번 더 동의를 받아 보여 드려요." },
  { title: "끝난 소개는 다시 열리지 않아요", body: `상대 프로필은 소개·교류 기간에만 볼 수 있고, 제공된 사본은 종료 ${BEFORE_US.provision.snapshotDeleteDaysAfterEnd}일 뒤 지워요. 편지는 교류가 끝나고 ${P.letterDaysAfterExchangeEnd}일, 약속 상세는 만난 날부터 ${P.appointmentDetailDaysAfterMeeting}일 뒤 지워요.` },
  { title: "탈퇴하면 바로 멈추고 지워요", body: `탈퇴를 요청하면 상대 노출과 알림을 즉시 멈추고, 일반 자료는 ${P.activeDeleteDays}일 안에, 백업은 최대 ${P.backupMaxDays}일 안에 지워요. 법으로 보관해야 하는 거래·분쟁·광고 기록과 안전 신고에 필요한 자료만, 정해진 기간 동안 일반 자료와 분리해 보관해요.` },
]
const TERMS_POINTS = [
  { title: "한 번에 한 사람", body: "준비된 날 정오에 하루 최대 한 명을 소개해요. 매일 소개나 연애 성공을 약속하지 않아요." },
  { title: "요금과 환불", body: `소개비는 ${BEFORE_US.pricing.introduction.toLocaleString("ko-KR")}원이고, 첫 상대 프로필을 열람하기 전 취소하면 전액 돌려드려요. 교류비는 서로 선택한 뒤 결제 전에 안내하고, 아직 열리지 않은 날만큼 환불해요.` },
  { title: "서로를 존중하는 약속", body: "기혼·사실혼·교제 중인 사실이 확인되거나, 노쇼·괴롭힘 등 상대를 해치는 행동이 확인되면 이용이 제한될 수 있어요. 모든 제한에는 다시 검토를 요청할 길이 있어요." },
  { title: "언제든 멈출 수 있어요", body: "소개 일시정지, 교류 중단, 신고·차단, 탈퇴를 내 정보에서 직접 할 수 있어요." },
]

function LegalPage({ kind }: { kind: "terms" | "privacy" }) {
  const privacy = kind === "privacy"
  const points = privacy ? PRIVACY_POINTS : TERMS_POINTS
  return (
    <section className="mx-auto w-full max-w-3xl break-keep py-12 sm:py-16">
      <PageHeader mark={privacy ? "개인정보" : "약관"} label={privacy ? "개인정보처리방침" : "이용약관"} en={privacy ? "PRIVACY" : "TERMS"} title={privacy ? "개인정보처리방침" : "이용약관"} lead="정식 문서는 서비스를 열기 전, 법률 검토를 마친 뒤 이곳에 게시해요. 그전까지 비포어스가 지키는 기준을 먼저 적어 둘게요." />
      <ol className="mt-10 divide-y divide-border border-y border-border">
        {points.map((item, index) => (
          <li key={item.title} className="flex gap-5 py-6">
            <span className="text-xs font-semibold tabular-nums text-accent">0{index + 1}</span>
            <div>
              <p className="font-semibold">{item.title}</p>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">{item.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-8 text-sm leading-7 text-muted-foreground">궁금한 점은 <Link to="/contact" className="text-foreground underline underline-offset-4 hover:text-primary">문의하기</Link>로 남겨 주세요.</p>
    </section>
  )
}

export const TermsPage = () => <LegalPage kind="terms" />
export const PrivacyPage = () => <LegalPage kind="privacy" />
