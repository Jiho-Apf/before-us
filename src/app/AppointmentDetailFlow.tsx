import { kstDateTime } from "./dates"
import { useState } from "react"
import { Link } from "react-router"
import { ArrowRight, Plus, X, CalendarDays, MapPin, Eye } from "lucide-react"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { Textarea } from "./components/ui/textarea"
import { Label } from "./components/ui/label"
import { Checkbox } from "./components/ui/checkbox"
import { ContactStatus } from "./AppointmentContact"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select"
import {
  APPOINTMENT_ACTIVITIES,
  EXAMPLE_SPACES,
  VERIFIED_SPACES,
  QUICK_TIMES,
  emptyAppointmentDetails,
  emptyAvailability,
  detailsError,
  slotKey,
  type AppointmentDetails,
  type Availability,
  type CandidateTime,
} from "./appointment-details"
import {
  type AppointmentView,
  type AppointmentCommand,
} from "./appointment-model"

const stamp = (value: string) =>
  kstDateTime(value)
type SelectFieldProps = {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  disabled?: boolean
}
function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
}: SelectFieldProps) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue placeholder="직접 선택해 주세요" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option.includes("|")
                ? `${option.split("|")[0]} · ${option.split("|")[1]}–${option.split("|")[2]}`
                : option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
type DateSlotsProps = {
  value: CandidateTime[]
  maximum: number
  now: string
  onChange: (value: CandidateTime[]) => void
  datesEnabled?: boolean
  timesEnabled?: boolean
}
function DateSlots({
  value,
  maximum,
  now,
  onChange,
  datesEnabled = true,
  timesEnabled = true,
}: DateSlotsProps) {
  const today = new Date(Date.parse(now) + 9 * 3600000)
    .toISOString()
    .slice(0, 10)
  const change = (index: number, field: keyof CandidateTime, text: string) =>
    onChange(
      value.map((slot, position) =>
        index === position ? { ...slot, [field]: text } : slot,
      ),
    )
  return (
    <div className="space-y-4">
      {value.map((slot, index) => (
        <div
          key={index}
          className="space-y-3 rounded-xl border border-border p-4"
        >
          <div className="flex items-center justify-between">
            <Label>후보 0{index + 1} · Asia/Seoul</Label>
            {value.length > 1 && datesEnabled && timesEnabled && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`후보 ${index + 1} 삭제`}
                onClick={() =>
                  onChange(value.filter((_, position) => position !== index))
                }
              >
                <X size={15} />
              </Button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              aria-label={`후보 ${index + 1} 날짜`}
              type="date"
              min={today}
              value={slot.date}
              disabled={!datesEnabled}
              onChange={(event) => change(index, "date", event.target.value)}
            />
            <Input
              aria-label={`후보 ${index + 1} 시작시간`}
              type="time"
              value={slot.start}
              disabled={!timesEnabled}
              onChange={(event) => change(index, "start", event.target.value)}
            />
            <Input
              aria-label={`후보 ${index + 1} 종료시간`}
              type="time"
              value={slot.end}
              disabled={!timesEnabled}
              onChange={(event) => change(index, "end", event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK_TIMES.map((time) => (
              <Button
                key={time.label}
                variant="outline"
                size="sm"
                disabled={!timesEnabled}
                onClick={() =>
                  onChange(
                    value.map((item, position) =>
                      position === index
                        ? { ...item, start: time.start, end: time.end }
                        : item,
                    ),
                  )
                }
              >
                {time.label} {time.start}–{time.end}
              </Button>
            ))}
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={value.length >= maximum || !datesEnabled || !timesEnabled}
        onClick={() => onChange([...value, { date: "", start: "", end: "" }])}
      >
        <Plus size={15} />
        날짜 후보 추가 · {value.length}/{maximum}
      </Button>
      <p className="text-xs leading-6 text-muted-foreground">
        서로 다른 날짜를 선택해 주세요. 과거 날짜·이미 지난 시작시간은 공유할 수
        없어요.
      </p>
    </div>
  )
}
type RegionsProps = {
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}
function Regions({ value, onChange, disabled }: RegionsProps) {
  const [text, setText] = useState("")
  const add = (region: string) => {
    if (region.trim() && value.length < 3 && !value.includes(region.trim())) {
      onChange([...value, region.trim()])
      setText("")
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {[
          "서울 동부",
          "서울 서부",
          "경기 남부",
          "부산 중심",
          "강남역",
          "홍대입구역",
        ].map((region) => (
          <Button
            key={region}
            size="sm"
            variant="outline"
            disabled={disabled || value.length >= 3 || value.includes(region)}
            onClick={() => add(region)}
          >
            {region}
          </Button>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="넓은 지역 또는 역 직접 입력"
          value={text}
          disabled={disabled}
          maxLength={40}
          onChange={(event) => setText(event.target.value)}
          placeholder="넓은 지역·역 직접 입력"
        />
        <Button
          variant="outline"
          disabled={disabled || !text.trim() || value.length >= 3}
          onClick={() => add(text)}
        >
          추가
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {value.map((region) => (
          <Button
            key={region}
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => onChange(value.filter((item) => item !== region))}
          >
            {region}
            <X size={13} />
            <span className="sr-only">해제</span>
          </Button>
        ))}
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        최대 3개 · 선택한 지역을 눌러 해제해요. 집·직장 주소·GPS는 입력하지
        않아요.
      </p>
    </div>
  )
}
function DetailsSummary({ value }: { value: AppointmentDetails }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-accent">
        <CalendarDays size={15} />
        후보 날짜 · 정확한 시작–종료
      </div>
      {value.slots.map((slot, index) => (
        <p key={index} className="text-sm">
          {slot.date || "날짜 미입력"} · {slot.start || "시작 미입력"}–
          {slot.end || "종료 미입력"} · Asia/Seoul
        </p>
      ))}
      <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">활동</p>
          <p className="mt-1 text-sm">
            {value.activity === "직접 정할게요"
              ? value.customActivity || "미입력"
              : value.activity || "미선택"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">넓은 지역·역</p>
          <p className="mt-1 text-sm">
            {value.regions.join(" / ") || "미입력"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">
            예상 만남 길이 · 1인 예상비용
          </p>
          <p className="mt-1 text-sm">
            {value.duration === null ? "미입력" : `${value.duration}분`} ·{" "}
            {value.budget === null
              ? "미입력"
              : `${value.budget.toLocaleString()}원`}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">실내·야외</p>
          <p className="mt-1 text-sm">
            {
              {
                indoor: "실내",
                outdoor: "야외",
                either: "상관없어요",
                "": "미선택",
              }[value.environment]
            }
          </p>
        </div>
      </div>
      <div className="border-t border-border pt-4">
        <p className="flex items-center gap-2 text-sm">
          <MapPin size={15} />
          {value.place.label || "장소 미선택"}
        </p>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          {value.place.kind === "example"
            ? "예시 공간이에요. 실제 주소·영업시간·예약 데이터가 아니에요."
            : value.place.kind === "direct"
              ? "회원이 직접 제안한 장소예요. 운영시간·예약 가능 여부는 확인되지 않았어요."
              : "확인된 후보의 제공 범위만 참고해요. 예약 완료는 아니에요."}
        </p>
      </div>
    </div>
  )
}
type DetailFlowProps = {
  view: AppointmentView
  onCommand: (command: AppointmentCommand, revision: number) => string | null
}
type Editing = {
  id: string
  version: number
  intent: "edit" | "new"
}
const editFields = ["날짜", "시간", "활동", "지역", "예산·환경·길이", "장소"]
export function AppointmentDetailFlow({ view, onCommand }: DetailFlowProps) {
  const [draft, setDraft] = useState<AppointmentDetails>(
    () => view.ownDraft?.details || emptyAppointmentDetails(),
  )
  const [editing, setEditing] = useState<Editing | null>(() =>
    view.ownDraft?.proposalId
      ? {
          id: view.ownDraft.proposalId,
          version: view.ownDraft.version || 1,
          intent: "edit",
        }
      : null,
  )
  const [fields, setFields] = useState<string[]>(editing ? [] : editFields)
  const [editor, setEditor] = useState(
    !!view.ownDraft || (view.canPropose && view.resolution !== "joint"),
  )
  const [note, setNote] = useState(view.ownDraft?.note || "")
  const [preview, setPreview] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [newConfirmed, setNewConfirmed] = useState(false)
  const [message, setMessage] = useState("")
  const [availability, setAvailability] = useState<Availability>(
    () =>
      view.ownAvailabilityDraft || view.ownAvailability || emptyAvailability(),
  )
  const [availabilityConfirmed, setAvailabilityConfirmed] = useState(false)
  const [selection, setSelection] = useState<Record<string, string>>({})
  const [approval, setApproval] = useState<string | null>(null)
  const update = (next: AppointmentDetails) => {
    setDraft(next)
    setPreview(false)
    setConfirmed(false)
  }
  const send = (command: AppointmentCommand) => {
    const error = onCommand(command, view.revision)
    setMessage(
      error ||
        "가상 기록에 반영했어요. 실제 저장·예약·카카오 발송은 하지 않아요.",
    )
    if (!error) {
      setConfirmed(false)
      setApproval(null)
      if (command.type === "propose") {
        setEditor(false)
        setEditing(null)
        setPreview(false)
      }
    }
    return error
  }
  const beginEdit = (
    proposal: AppointmentView["proposals"][number],
    intent: "edit" | "new",
  ) => {
    setEditing({ id: proposal.id, version: proposal.version, intent })
    setFields(intent === "edit" ? [] : editFields)
    setDraft(
      intent === "new"
        ? emptyAppointmentDetails()
        : proposal.details
          ? structuredClone(proposal.details)
          : emptyAppointmentDetails(),
    )
    setNote(intent === "new" ? "" : proposal.note)
    setPreview(false)
    setConfirmed(false)
    setNewConfirmed(false)
    setEditor(true)
  }
  if (!view.coordinationReady) return null
  const disabled = !view.active || !!view.final
  const valid = !detailsError(draft, new Date(view.now))
  const enabled = (field: string) => !disabled && fields.includes(field)
  const changingAvailability = (value: Availability) => {
    setAvailability(value)
    setAvailabilityConfirmed(false)
  }
  const canDirectStart =
    view.canPropose &&
    view.resolution === "joint" &&
    !!view.ownAvailability &&
    !!view.peerAvailability
  const noticeNames = {
    new: "새 제안",
    revision: "수정안",
    accept: "수락",
    "due-soon": "응답 마감 임박",
    final: "최종 합의",
    availability: "가능 조건 공유",
    "change-request": "수정 요청",
    "contact-changed": "연락처 공유 설정이 변경되었어요",
    "contact-released": "연락처 공개 완료 · 홈페이지에서 확인해 주세요",
  }
  return (
    <div className="space-y-7">
      <section className="flex flex-wrap justify-between gap-3 border-l-4 border-accent bg-accent/5 p-5">
        <div>
          <p className="text-xs text-accent">현재 제안자</p>
          <p className="mt-2 text-lg">{view.proposer}</p>
        </div>
        <div className="text-sm leading-7">
          {view.deadline
            ? `응답·진행 기한 ${stamp(view.deadline)} · Asia/Seoul`
            : "현재 단계 기한 없음"}
          <p className="text-xs text-muted-foreground">
            공유·홈페이지 확인·카카오 발송은 서로 다른 상태예요.
          </p>
        </div>
      </section>
      {view.resolution === "joint" && (
        <section className="space-y-5 border border-border p-6">
          <h2 className="text-xl">가능한 시간을, 같이 골라요.</h2>
          <p className="text-sm leading-7 text-muted-foreground">
            각자 날짜 최대 5개·시간구간·활동 최대 3개·지역 최대 3개를 공유해요.
            공개 전 초안은 작성자만 볼 수 있어요.
          </p>
          {!disabled && (
            <details open={!view.ownAvailability}>
              <summary className="cursor-pointer text-sm font-medium">
                내 가능 조건 {view.ownAvailability ? "수정하기" : "작성하기"}
              </summary>
              <div className="mt-5 space-y-5">
                <DateSlots
                  value={availability.slots}
                  maximum={5}
                  now={view.now}
                  onChange={(slots) =>
                    changingAvailability({ ...availability, slots })
                  }
                />
                <div>
                  <Label>활동 · {availability.activities.length}/3</Label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {APPOINTMENT_ACTIVITIES.map((activity) => (
                      <Button
                        key={activity}
                        variant={
                          availability.activities.includes(activity)
                            ? "secondary"
                            : "outline"
                        }
                        size="sm"
                        aria-pressed={availability.activities.includes(
                          activity,
                        )}
                        disabled={
                          !availability.activities.includes(activity) &&
                          availability.activities.length >= 3
                        }
                        onClick={() =>
                          changingAvailability({
                            ...availability,
                            activities: availability.activities.includes(
                              activity,
                            )
                              ? availability.activities.filter(
                                  (value) => value !== activity,
                                )
                              : [...availability.activities, activity],
                          })
                        }
                      >
                        {activity}
                      </Button>
                    ))}
                  </div>
                </div>
                <Regions
                  value={availability.regions}
                  onChange={(regions) =>
                    changingAvailability({ ...availability, regions })
                  }
                />
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    onClick={() =>
                      send({ type: "save-availability", value: availability })
                    }
                  >
                    가능 조건 임시 저장
                  </Button>
                  <Label className="flex items-center gap-3">
                    <Checkbox
                      checked={availabilityConfirmed}
                      onCheckedChange={(value) =>
                        setAvailabilityConfirmed(value === true)
                      }
                    />
                    이 가능 조건을 공유할게요.
                  </Label>
                  <Button
                    disabled={!availabilityConfirmed}
                    onClick={() => {
                      if (
                        !send({
                          type: "share-availability",
                          value: availability,
                          confirmed: availabilityConfirmed,
                        })
                      )
                        setAvailabilityConfirmed(false)
                    }}
                  >
                    가능 조건 공유하기
                  </Button>
                </div>
              </div>
            </details>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {[view.ownAvailability, view.peerAvailability].map(
              (shared, index) => (
                <article key={index} className="rounded-xl bg-muted p-5">
                  <p className="text-xs text-accent">
                    {index === 0 ? "내가 공유한 내용" : "상대가 공유한 내용"}
                  </p>
                  {shared ? (
                    <div className="mt-3 space-y-2 text-sm">
                      {shared.slots.map((slot) => (
                        <p key={slotKey(slot)}>
                          {slot.date} · {slot.start}–{slot.end}
                        </p>
                      ))}
                      <p>{shared.activities.join(" / ")}</p>
                      <p>{shared.regions.join(" / ")}</p>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      아직 공유되지 않았어요.
                    </p>
                  )}
                </article>
              ),
            )}
          </div>
          {view.ownAvailability && view.peerAvailability && (
            <div className="space-y-3 border-t border-border pt-5">
              <h3 className="text-lg">실제 공통 조건</h3>
              {view.common.slots.length ? (
                view.common.slots.map((slot) => (
                  <p key={slotKey(slot)} className="text-sm">
                    {slot.date} · 공통 {slot.start}–{slot.end}
                  </p>
                ))
              ) : (
                <p className="text-sm">겹치는 시간구간이 없어요.</p>
              )}
              <p className="text-sm">
                활동: {view.common.activities.join(" / ") || "겹침 없음"}
              </p>
              <p className="text-sm">
                지역: {view.common.regions.join(" / ") || "겹침 없음"}
              </p>
              {!view.common.ready && (
                <p className="text-sm leading-7 text-muted-foreground">
                  날짜·시간·활동·지역의 공통 조건이 아직 없어요. 조건을
                  수정하거나 직접 새 제안으로 돌아갈 수 있어요. 자동으로
                  조건을 완화하지 않아요.
                </p>
              )}
              {canDirectStart && (
                <div className="flex flex-wrap gap-3">
                  <Button
                    disabled={!view.common.ready}
                    onClick={() => {
                      update({
                        ...emptyAppointmentDetails(),
                        slots: view.common.slots.slice(0, 3),
                        activity: view.common.activities[0],
                        regions: view.common.regions.slice(0, 3),
                        basis: "common",
                      })
                      setFields(editFields)
                      setEditing(null)
                      setEditor(true)
                      setNewConfirmed(false)
                    }}
                  >
                    공통 조건으로 초안 만들기
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      update(emptyAppointmentDetails())
                      setFields(editFields)
                      setEditing(null)
                      setEditor(true)
                      setNewConfirmed(false)
                    }}
                  >
                    직접 새 제안 만들기
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      {view.proposals.length > 0 && (
        <section className="space-y-5">
          <h2 className="text-xl">최신 제안과 응답</h2>
          <div className="grid gap-5 lg:grid-cols-2">
            {view.proposals.map((proposal) => (
              <article
                key={`${proposal.id}-${proposal.version}`}
                className="space-y-5 border border-border bg-background p-6"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-xs text-accent">
                    {proposal.ownAuthor
                      ? "내가 공유한 제안"
                      : "상대가 공유한 제안"}{" "}
                    · v{proposal.version}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Eye size={13} />
                    {proposal.peerSeenAt
                      ? `상대가 확인했어요 · ${stamp(proposal.peerSeenAt)}`
                      : "상대 홈페이지 확인 대기"}
                  </span>
                </div>
                {!!proposal.changedFields.length && (
                  <p className="text-xs text-primary">
                    이번 버전에서 변경: {proposal.changedFields.join(" · ")}
                  </p>
                )}
                {proposal.details ? (
                  <DetailsSummary value={proposal.details} />
                ) : (
                  <div className="text-sm leading-7">
                    기존 제안 기록: {stamp(proposal.when)} · {proposal.place}
                  </div>
                )}
                <p className="whitespace-pre-wrap text-sm leading-7">
                  {proposal.note}
                </p>
                <p className="text-xs">
                  응답 기한: {stamp(proposal.responseDeadline)} · Asia/Seoul
                </p>
                <p className="text-xs">
                  내 승인 {proposal.ownApproved ? "완료" : "대기"} · 상대 승인{" "}
                  {proposal.peerApproved ? "완료" : "대기"}
                </p>
                {proposal.changeRequested && (
                  <p className="rounded-xl bg-muted p-3 text-sm">
                    최신 제안의 수정 요청이 공유됐어요.
                  </p>
                )}
                {proposal.staleCommon && (
                  <p className="text-sm text-destructive">
                    가능 조건이 변경됐어요. 공통 조건을 다시 확인해 새 버전으로
                    공유해 주세요.
                  </p>
                )}
                {proposal.ownSelectedSlot &&
                  proposal.peerSelectedSlot &&
                  proposal.ownSelectedSlot !== proposal.peerSelectedSlot && (
                    <p className="text-sm text-primary">
                      선택한 날짜가 달라요. 같은 후보 날짜와 최신 버전을
                      확인해야 합의돼요.
                    </p>
                  )}
                {view.canApprove && !proposal.staleCommon && (
                  <div className="space-y-4 border-t border-border pt-4">
                    {proposal.details && (
                      <SelectField
                        label="수락할 후보 날짜·시간"
                        value={
                          selection[proposal.id] ||
                          proposal.ownSelectedSlot ||
                          ""
                        }
                        options={proposal.details.slots.map(slotKey)}
                        onChange={(value) => {
                          setSelection({ ...selection, [proposal.id]: value })
                          setApproval(null)
                        }}
                      />
                    )}
                    <Label className="flex items-center gap-3 text-xs">
                      <Checkbox
                        checked={
                          approval === `${proposal.id}:${proposal.version}`
                        }
                        onCheckedChange={(value) =>
                          setApproval(
                            value === true
                              ? `${proposal.id}:${proposal.version}`
                              : null,
                          )
                        }
                      />
                      이 후보와 v{proposal.version}의 모든 내용을 확인했어요.
                    </Label>
                    <Button
                      disabled={
                        approval !== `${proposal.id}:${proposal.version}` ||
                        (!!proposal.details &&
                          !(selection[proposal.id] || proposal.ownSelectedSlot))
                      }
                      onClick={() =>
                        send({
                          type: "approve",
                          proposalId: proposal.id,
                          version: proposal.version,
                          confirmed: true,
                          selectedSlot:
                            selection[proposal.id] ||
                            proposal.ownSelectedSlot ||
                            undefined,
                        })
                      }
                    >
                      이대로 좋아요
                    </Button>
                  </div>
                )}
                {view.canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        send({
                          type: "request-change",
                          proposalId: proposal.id,
                          version: proposal.version,
                          confirmed: true,
                        })
                        beginEdit(proposal, "edit")
                      }}
                    >
                      조금 바꾸고 싶어요
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => beginEdit(proposal, "new")}
                    >
                      새로운 제안을 할게요
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {editor && !disabled && (
        <section className="space-y-6 rounded-xl border border-border p-6">
          <div>
            <p className="text-xs text-accent">PRIVATE DRAFT / 작성자 전용</p>
            <h2 className="mt-3 text-xl">
              {editing
                ? `v${editing.version}에서 ${
                    editing.intent === "edit"
                      ? "필요한 항목만 수정해요."
                      : "새로운 제안을 작성해요."
                  }`
                : "우리의 약속안을 만들어요."}
            </h2>
          </div>
          {editing?.intent === "edit" && (
            <div className="flex flex-wrap gap-4">
              {editFields.map((field) => (
                <Label key={field} className="flex items-center gap-2">
                  <Checkbox
                    checked={fields.includes(field)}
                    onCheckedChange={(checked) =>
                      setFields(
                        checked
                          ? [...fields, field]
                          : fields.filter((value) => value !== field),
                      )
                    }
                  />
                  {field}
                </Label>
              ))}
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-[7fr_5fr]">
            <div className="space-y-6">
              <section className="space-y-3">
                <h3 className="text-lg">01 / 날짜·시간</h3>
                <DateSlots
                  value={draft.slots}
                  maximum={3}
                  now={view.now}
                  datesEnabled={enabled("날짜")}
                  timesEnabled={enabled("시간")}
                  onChange={(slots) => update({ ...draft, slots })}
                />
              </section>
              <section className="space-y-4">
                <h3 className="text-lg">02 / 활동과 넓은 지역</h3>
                <SelectField
                  label="함께할 활동"
                  value={draft.activity}
                  options={
                    draft.basis === "common"
                      ? view.common.activities
                      : APPOINTMENT_ACTIVITIES
                  }
                  disabled={!enabled("활동")}
                  onChange={(activity) => update({ ...draft, activity })}
                />
                {draft.activity === "직접 정할게요" && (
                  <Input
                    aria-label="직접 정할 활동"
                    maxLength={80}
                    value={draft.customActivity}
                    disabled={!enabled("활동")}
                    onChange={(event) =>
                      update({ ...draft, customActivity: event.target.value })
                    }
                  />
                )}
                <Regions
                  value={draft.regions}
                  disabled={!enabled("지역")}
                  onChange={(regions) => update({ ...draft, regions })}
                />
              </section>
              <section className="space-y-4">
                <h3 className="text-lg">03 / 예산·환경·만남 길이</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="appointment-budget">
                      1인 예상비용 (원)
                    </Label>
                    <Input
                      id="appointment-budget"
                      type="number"
                      min={0}
                      value={draft.budget ?? ""}
                      disabled={!enabled("예산·환경·길이")}
                      onChange={(event) =>
                        update({
                          ...draft,
                          budget:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="appointment-duration">
                      예상 만남 길이 (분)
                    </Label>
                    <Input
                      id="appointment-duration"
                      type="number"
                      min={1}
                      value={draft.duration ?? ""}
                      disabled={!enabled("예산·환경·길이")}
                      onChange={(event) =>
                        update({
                          ...draft,
                          duration:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <SelectField
                  label="실내·야외"
                  value={
                    {
                      indoor: "실내",
                      outdoor: "야외",
                      either: "상관없어요",
                      "": "",
                    }[draft.environment]
                  }
                  disabled={!enabled("예산·환경·길이")}
                  options={["실내", "야외", "상관없어요"]}
                  onChange={(value) =>
                    update({
                      ...draft,
                      environment:
                        value === "실내"
                          ? "indoor"
                          : value === "야외"
                            ? "outdoor"
                            : "either",
                    })
                  }
                />
              </section>
              <section className="space-y-4">
                <h3 className="text-lg">04 / 장소</h3>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={!enabled("장소")}
                    aria-pressed={draft.place.kind === "example"}
                    onClick={() =>
                      update({
                        ...draft,
                        place: { kind: "example", id: "", label: "" },
                      })
                    }
                  >
                    예시 후보에서 선택
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!enabled("장소")}
                    aria-pressed={draft.place.kind === "direct"}
                    onClick={() =>
                      update({
                        ...draft,
                        place: { kind: "direct", id: "", label: "" },
                      })
                    }
                  >
                    직접 장소 제안
                  </Button>
                  <Button variant="outline" disabled={!VERIFIED_SPACES.length}>
                    확인된 후보 · 데이터 없음
                  </Button>
                </div>
                {draft.place.kind === "example" ? (
                  <SelectField
                    label="예시 공간"
                    value={draft.place.label}
                    options={EXAMPLE_SPACES.map((space) => space.label)}
                    disabled={!enabled("장소")}
                    onChange={(label) =>
                      update({
                        ...draft,
                        place: {
                          kind: "example",
                          label,
                          id: EXAMPLE_SPACES.find(
                            (space) => space.label === label,
                          )!.id,
                        },
                      })
                    }
                  />
                ) : (
                  <Input
                    aria-label="직접 제안할 장소 이름"
                    value={draft.place.label}
                    maxLength={160}
                    disabled={!enabled("장소")}
                    onChange={(event) =>
                      update({
                        ...draft,
                        place: { ...draft.place, label: event.target.value },
                      })
                    }
                  />
                )}
                <p className="text-xs leading-6 text-muted-foreground">
                  공간 A/B는 예시예요. 가짜 주소·영업시간·예약 가능 여부를
                  만들지 않아요. 직접 제안은 장소 이름만 적고 개인정보를 넣지
                  마세요.
                </p>
              </section>
              <div className="space-y-2">
                <Label htmlFor="appointment-note">
                  짧은 이유 · 선택, 200자 이내
                </Label>
                <Textarea
                  id="appointment-note"
                  value={note}
                  maxLength={200}
                  onChange={(event) => {
                    setNote(event.target.value)
                    setPreview(false)
                    setConfirmed(false)
                  }}
                />
              </div>
            </div>
            <aside className="h-fit space-y-5 border border-border bg-muted/40 p-5 lg:sticky lg:top-6">
              <h3 className="text-lg">제안 미리보기</h3>
              <p className="text-xs leading-6 text-muted-foreground">
                현재는 나에게만 보여요. ‘제안 보내기’를 눌러야 상대에게
                공유돼요.
              </p>
              {preview ? (
                <>
                  <DetailsSummary value={draft} />
                  <p className="whitespace-pre-wrap text-sm">{note}</p>
                  {!valid && (
                    <p className="text-xs text-destructive">
                      {detailsError(draft, new Date(view.now))}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  작성한 날짜·정확한 시작시간·지역·활동·장소·예상시간·1인 비용을
                  확인해 주세요.
                </p>
              )}
              <Button
                variant="outline"
                onClick={() =>
                  send({
                    type: "save-draft",
                    details: draft,
                    proposalId: editing?.id,
                    version: editing?.version,
                    note,
                  })
                }
              >
                초안 임시 저장
              </Button>
              <Button variant="outline" onClick={() => setPreview(true)}>
                미리보기 확인
              </Button>
              {view.resolution === "joint" && draft.basis === "direct" && (
                <Label className="flex items-start gap-3 text-xs leading-6">
                  <Checkbox
                    checked={newConfirmed}
                    onCheckedChange={(value) => setNewConfirmed(value === true)}
                  />
                  공통 조건 밖의 새 제안으로 공유할게요. 양쪽이 다시 확인해야
                  해요.
                </Label>
              )}
              <Label className="flex items-start gap-3 text-xs leading-6">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                />
                현재 미리보기의 모든 내용을 상대에게 제안할게요. 발송은 양쪽
                승인이 아니에요.
              </Label>
              <Button
                className="w-full"
                disabled={
                  !preview ||
                  !valid ||
                  !confirmed ||
                  (view.resolution === "joint" &&
                    draft.basis === "direct" &&
                    !newConfirmed)
                }
                onClick={() =>
                  send({
                    type: "propose",
                    when: "",
                    place: "",
                    note,
                    details: draft,
                    confirmed,
                    proposalId: editing?.id,
                    version: editing?.version,
                    intent: editing?.intent,
                    confirmedNewProposal: newConfirmed,
                  })
                }
              >
                제안 보내기 <ArrowRight size={15} />
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditor(false)
                  setEditing(null)
                  setPreview(false)
                  setConfirmed(false)
                }}
              >
                편집 닫기
              </Button>
            </aside>
          </div>
        </section>
      )}
      {view.ownDraft && !editor && !disabled && (
        <Button
          variant="outline"
          onClick={() => {
            setDraft(structuredClone(view.ownDraft!.details))
            setNote(view.ownDraft!.note || "")
            setEditing(
              view.ownDraft!.proposalId
                ? {
                    id: view.ownDraft!.proposalId,
                    version: view.ownDraft!.version || 1,
                    intent: "edit",
                  }
                : null,
            )
            setFields(editFields)
            setPreview(false)
            setConfirmed(false)
            setEditor(true)
          }}
        >
          저장한 초안 이어 쓰기
        </Button>
      )}
      {view.canPropose && view.resolution !== "joint" && !editor && (
        <Button
          onClick={() => {
            setEditor(true)
            setEditing(null)
            setFields(editFields)
            update(emptyAppointmentDetails())
          }}
        >
          내 약속안 작성하기
        </Button>
      )}
      {!!view.history.length && (
        <section className="space-y-3">
          <h2 className="text-xl">공유·수정 이력</h2>
          {view.history.map((item) => (
            <details
              key={`${item.id}-${item.version}`}
              className="border border-border p-4"
            >
              <summary className="cursor-pointer text-sm">
                v{item.version} · {item.ownAuthor ? "내 제안" : "상대 제안"} ·{" "}
                {stamp(item.at)} · 읽기 전용
              </summary>
              <div className="mt-4">
                {item.details ? (
                  <DetailsSummary value={item.details} />
                ) : (
                  <p className="text-sm">
                    {stamp(item.when)} · {item.place}
                  </p>
                )}
                <p className="mt-3 whitespace-pre-wrap text-sm">{item.note}</p>
              </div>
            </details>
          ))}
        </section>
      )}
      <section className="space-y-4 border-t border-border pt-5">
        <h2 className="text-lg">약속 알림</h2>
        {view.notices.length ? (
          view.notices.map((notice) => (
            <div
              key={notice.id}
              className="flex flex-wrap justify-between gap-3 rounded-xl bg-muted p-4 text-xs"
            >
              <span>
                {noticeNames[notice.kind]}
                {notice.version ? ` · v${notice.version}` : ""} ·{" "}
                {stamp(notice.at)}
              </span>
              <span>
                카카오 발송: 미연결 · 홈페이지 확인은 제안별 별도 기록
              </span>
              {notice.kind === "contact-released" && <Link className="text-primary underline" to="/meeting/contact?demo=agreement">연락처 확인하기</Link>}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            내게 생성된 가상 약속 알림이 없어요.
          </p>
        )}
        <p className="text-xs leading-6 text-muted-foreground">
          마감 임박 안내는 분리된 개발 제어에서 설정한 기준과 실제 가상 시계로
          점검해요. 자동 실행·카카오 승인·발송 완료를 표시하지 않아요.
        </p>
      </section>
      {view.final && (
        <section className="space-y-5 border-l-4 border-primary bg-primary/5 p-6">
          <p className="text-xs text-primary">
            두 사람이 같은 최신 버전·같은 후보를 확인했어요.
          </p>
          <h2 className="text-2xl">만남 일정 합의 완료</h2>
          {view.final.details ? (
            <DetailsSummary value={view.final.details} />
          ) : (
            <p className="text-sm">
              {stamp(view.final.when)} · {view.final.place}
            </p>
          )}
          <p className="text-xs leading-6 text-muted-foreground">
            예약 완료가 아니에요. 다음 단계는 연락처 공개에 대한 별도 동의이며
            전화번호는 자동 공개하지 않아요.
          </p>
          <Button asChild disabled={!view.active}>
            <Link to="/meeting/contact?demo=agreement">
              연락처 공개 동의 확인 <ArrowRight size={15} />
            </Link>
          </Button>
          <ContactStatus view={view} />
        </section>
      )}
      <p role="status" className="text-sm text-primary">
        {message}
      </p>
    </div>
  )
}
