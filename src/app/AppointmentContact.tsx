import { kstDateTime } from "./dates"
import { useState } from "react"
import { Link } from "react-router"
import { Copy, ShieldCheck, Clock } from "lucide-react"
import { Button } from "./components/ui/button"
import { Switch } from "./components/ui/switch"
import { Checkbox } from "./components/ui/checkbox"
import { Label } from "./components/ui/label"
import type { AppointmentView, AppointmentCommand } from "./appointment-model"

type ContactProps = {
  view: AppointmentView
  onCommand: (command: AppointmentCommand, revision: number) => string | null
  recheckContact?: () => string | null
}
const format = (at: string) =>
  kstDateTime(at)
const eventLabels: Record<string, string> = {
  "contact-consented": "연락처 공유 동의",
  "contact-withdrawn": "동의 철회",
  "contact-scheduled": "공개 예약",
  "contact-cancelled": "공개 취소",
  "contact-released": "공개 완료",
}
export function ContactStatus({ view }: { view: AppointmentView }) {
  const contact = view.contact
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-5 text-sm">
      <p>{contact.finalAgreed ? "✓" : "○"} 약속 최종 합의</p>
      <p>
        {contact.ownConsent ? "✓" : "○"} 내 연락처 공유 동의{" "}
        {contact.ownConsent ? "완료" : "선택 전 또는 철회"}
      </p>
      <p>
        {contact.released
          ? "✓ 상대 연락처 공유 동의 완료"
          : "○ 상대의 선택을 기다리고 있어요"}
      </p>
      <p className="flex items-start gap-2">
        <Clock className="mt-0.5 size-4 shrink-0 text-primary" />
        {contact.blocked
          ? "공개 중지 · 안전 및 진행 상태 확인이 필요해요"
          : contact.released
            ? contact.displayEnded
              ? "연락처 표시 기간이 끝났어요."
              : `서로 연락처를 공유했어요. ${contact.displayUntil ? `${format(contact.displayUntil)}까지 표시` : ""}`
            : contact.releaseAt
              ? `${format(contact.releaseAt)} · 만나는 날 자정 00:00${
                  contact.scheduled ? " 공개 예정" : " · 양쪽 동의 후 공개 예약"
                }`
              : "최종 합의 뒤 공개 시각을 안내해요."}
      </p>
      {contact.scheduled &&
        Date.parse(view.now) >= Date.parse(contact.releaseAt!) && (
          <p className="text-xs text-muted-foreground">
            공개 시각이 도래했어요. 아직 가상 공개 작업이 실행되지 않았어요.
          </p>
        )}
    </div>
  )
}
export function AppointmentContact({ view, onCommand, recheckContact }: ContactProps) {
  const [allowed, setAllowed] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState("")
  const contact = view.contact
  const submit = (value: boolean) => {
    const error = onCommand(
      { type: "contact-consent", allowed: value, confirmed: true },
      view.revision,
    )
    setMessage(
      error ||
        (value
          ? "내 가상 동의를 기록했어요. 양쪽 동의와 공개 시각·진행 상태를 모두 확인한 뒤 공개돼요."
          : "공유 동의를 철회했어요. 미공개 자동 공개 예약이 취소돼요."),
    )
    if (!error) {
      setAllowed(false)
      setConfirmed(false)
    }
  }
  if (!view.final || !contact.finalAgreed)
    return (
      <section className="py-8">
        <h1 className="text-2xl">연락처 공유는 약속 최종 합의 뒤에 열려요.</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          동일한 최신 약속의 날짜·시간·장소를 두 사람이 확인한 뒤 선택할 수
          있어요.
        </p>
      </section>
    )
  return (
    <section className="max-w-3xl space-y-7 py-8">
      <div className="border-b border-border pb-7">
        <p className="text-xs tracking-widest text-primary">
          BEFORE WE MEET / CONTACT
        </p>
        <h1 className="mt-4 text-3xl leading-relaxed">
          만나는 날, 연락할 수 있도록
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
          약속 당일 서로를 찾거나 일정이 달라질 때 연락할 수 있도록, 원한다면
          전화번호를 공유할 수 있어요.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-5">
          <div className="space-y-3 bg-muted p-5">
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-primary" />
              현재 계정 전화번호
            </div>
            <p className="text-2xl tabular-nums">
              {contact.ownMasked || "확인된 번호 없음"}
            </p>
            <p className="text-xs leading-6 text-muted-foreground">
              가상 번호 · 가상 확인값이에요. 실제 전화번호 인증 완료를 의미하지
              않아요. 다른 번호 입력·수집은 제공하지 않아요.
            </p>
          </div>
          {contact.blocked ? (
            <p className="text-sm leading-7">
              약속 취소·중단·차단 또는 안전 검토 상태에서는 공개하지 않아요.
              운영자에게 진행 상태를 확인해 주세요.
            </p>
          ) : contact.released ? (
            <p className="text-sm leading-7">
              공개가 완료됐어요. 이미 상대가 확인·저장한 번호를 완전히 회수할 수
              있다고 약속하지 않아요.
            </p>
          ) : contact.ownConsent ? (
            <div className="space-y-4">
              <p className="text-sm">
                내 공유 동의를 기록했어요. 공개 전까지 철회할 수 있어요.
              </p>
              <Button
                variant="outline"
                disabled={!contact.canWithdraw}
                onClick={() => submit(false)}
              >
                공유 동의 철회하기
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <Label
                htmlFor="contact-sharing"
                className="flex items-start gap-3 text-sm leading-6"
              >
                <Switch
                  id="contact-sharing"
                  className="mt-1 shrink-0 motion-reduce:transition-none"
                  checked={allowed}
                  disabled={!contact.canConsent || !contact.ownVerifiedDemo}
                  onCheckedChange={(value) => {
                    setAllowed(value)
                    setConfirmed(false)
                  }}
                />
                만나는 날 내 전화번호를 상대에게 보여줘도 괜찮아요
              </Label>
              <Label className="flex items-start gap-3 text-xs leading-6">
                <Checkbox
                  checked={confirmed}
                  disabled={!allowed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                />
                약속 수락과 별개인 전화번호 공유 선택임을 확인했어요.
              </Label>
              <Button
                disabled={!allowed || !confirmed || !contact.canConsent}
                onClick={() => submit(true)}
              >
                내 연락처 공유에 동의하기
              </Button>
              <p className="text-xs leading-6 text-muted-foreground">
                선택하지 않아도 약속 합의는 유지돼요. 한쪽만 동의하면 누구의
                번호도 공개하지 않아요.
              </p>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <ContactStatus view={view} />
          {contact.released && contact.displayEnded && (
            <p className="border border-border p-5 text-sm leading-7">
              상대 전화번호는 만남 당일 00:00부터 다음 날 23:59까지만 표시해요. 표시
              기간이 끝나 더 이상 보여 주지 않아요. 이미 저장한 번호의 회수는
              보장하지 않아요.
            </p>
          )}
          {contact.released && contact.peerNumber && (
            <div className="space-y-4 border border-primary/20 bg-primary/5 p-5">
              <p className="text-sm text-primary">서로 연락처를 공유했어요.</p>
              <p className="text-xs text-muted-foreground">
                상대 전화번호 · 가상 번호
              </p>
              <p className="text-2xl tabular-nums">{contact.peerNumber}</p>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const number = recheckContact?.();
                    if (!number || number !== contact.peerNumber) {
                      setMessage("당사자 권한 또는 공개 조건이 변경되었어요. 현재 상태를 다시 확인해 주세요.");
                      return;
                    }
                    if (!navigator.clipboard) throw Error()
                    await navigator.clipboard.writeText(number)
                    setMessage("가상 번호를 복사했어요.")
                  } catch {
                    setMessage(
                      "이 기기에서는 복사를 지원하지 않아요. 표시된 가상 번호를 확인해 주세요.",
                    )
                  }
                }}
              >
                <Copy className="size-4" />
                복사하기
              </Button>
              <div className="border-t border-primary/15 pt-4 text-xs leading-6 text-muted-foreground">
                <p className="flex items-start gap-2"><ShieldCheck className="mt-1 size-3.5 shrink-0 text-primary" />처음 만날 때는 사람이 많은 공공장소에서, 일정은 가까운 사람에게 알려 두세요.</p>
                <p className="mt-1 pl-5">만남 뒤 연락을 원하지 않거나 불편한 연락을 받으면, 플라비에서 바로 차단·신고할 수 있어요. 상대에게 이유를 알리지 않아요.</p>
                <Link to="/support?demo=agreement" className="mt-2 inline-block pl-5 text-primary underline underline-offset-4">차단·신고하러 가기</Link>
              </div>
            </div>
          )}
        </div>
      </div>
      <p role="status" className="text-sm text-primary">
        {message}
      </p>
      <div className="border-t border-border pt-5">
        <h2 className="text-sm">내 연락처 공유 활동</h2>
        {contact.events.length ? (
          <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
            {contact.events.map((event, index) => (
              <li
                key={`${event.at}-${index}`}
                className="flex justify-between gap-4"
              >
                <span>{eventLabels[event.kind]}</span>
                <span>{format(event.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            아직 기록된 활동이 없어요.
          </p>
        )}
      </div>
      <div className="space-y-3 text-xs leading-6 text-muted-foreground">
        {contact.wasReleased && <p>이미 공개된 번호는 상대가 확인·저장했을 수 있어요. 이후 접근을 중지해도 완전히 회수할 수 있다고 약속하지 않아요.</p>}
        <p>
          만나는 날 자정 00:00, Asia/Seoul 기준이에요. 약속 변경 시 새 날짜로
          예약을 재검증하며, 취소·중단·차단·안전 검토 시 미공개 예약을
          취소해요. 상대의 동의 여부는 공개 전까지 안내하지 않아요.
        </p>
        <p>
          공개 알림 예시: [플라비] 오늘은 두 분이 만나기로 한 날이에요. 서로
          동의한 연락처가 공개되었어요. 홈페이지에서 확인해 주세요. / 버튼:
          연락처 확인하기
        </p>
        <p>
          카카오: 미연결 · 홈페이지 번호 공개와 실제 발송은 별도예요. 제공
          기간·법적 문서는 검토가 필요한 정책이에요.
        </p>
        <p>
          이번 만남 당사자의 개인 연락용 정보예요. 캡처·외부 공유를 삼가 주세요.
          웹에서는 OS 스크린샷이나 다른 기기 촬영을 완전히 차단할 수 없어요.
          번호 확인과 복사에도 최신 당사자 권한·동의·약속·안전 조건을 재검사해야 하며 실제 서버 검증은 미구현이에요.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to="/meeting?demo=agreement">약속 내용 확인</Link>
      </Button>
      <Button asChild variant="outline"><Link to="/support?demo=agreement">문의·신고·차단·중단</Link></Button>
    </section>
  )
}
