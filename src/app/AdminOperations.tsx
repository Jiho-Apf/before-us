import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { ArrowRight, LockKeyhole, Search, ShieldAlert } from "lucide-react"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { Textarea } from "./components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select"
import { APPLICATION_FIELDS } from "./application-model"
import { BEFORE_US } from "./config"
import { seoulDate } from "./admin-model"
import {
  consoleMembers,
  inRange,
  periodRange,
  replaceConsoleData,
  useConsoleData,
} from "./admin-console-data"
import {
  INTRO_STAGES,
  MEMBER_STATES,
  addOperatorNote,
  applicantRows,
  exchangeDay,
  filteredApplicants,
  handleIntroduction,
  introductionRows,
  memberPayment,
  protectedSupply,
  requestExchangeContent,
  type IntroductionRecord,
} from "./admin-operations-model"

const time = (at: string | null) =>
  at
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(at))
    : "확인 기록 없음"
const profileLabel: Record<string, string> = {
  "not-reviewed": "미검토",
  pending: "재검토 대기",
  reviewed: "검토 완료",
}
const activityLabel: Record<string, string> = {
  idle: "활성 소개 없음",
  introduction: "활성 소개",
  mutual: "상호 선택",
  "exchange-payment": "교류비 결제 대기",
  agreement: "A/B 합의",
  exchange: "교류 중",
  pending: "검토 대기",
  "photo-revision": "사진 보완",
  waiting: "후보 대기",
  reviewed: "검토 완료",
  paused: "일시정지",
  blocked: "차단",
  "withdrawal-requested": "탈퇴 요청",
}
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly {
    id: string
    label: string
  }[]
  onChange: (value: string) => void
}) {
  return (
    <label className="grid gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <Select
        value={value || "all"}
        onValueChange={(next) => onChange(next === "all" ? "" : next)}
      >
        <SelectTrigger
          className="bg-background text-foreground"
          aria-label={label}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">전체</SelectItem>
          {value &&
            value !== "all" &&
            !options.some((option) => option.id === value) && (
              <SelectItem value={value}>{value}</SelectItem>
            )}
          {options
            .filter((option) => option.id !== "all")
            .map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </label>
  )
}
function Table({
  headers,
  children,
  empty,
}: {
  headers: string[]
  children: React.ReactNode
  empty: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full whitespace-nowrap text-left text-xs">
        <thead className="bg-secondary text-muted-foreground">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr>
              <td
                colSpan={headers.length}
                className="p-10 text-center text-muted-foreground"
              >
                해당 가상 기록이 없습니다.
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  )
}
export function AdminOperations({
  section,
}: {
  section: "applicants" | "members" | "introductions" | "exchange"
}) {
  const data = useConsoleData()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [message, setMessage] = useState("")
  const [cancelId, setCancelId] = useState<string | null>(null)
  const now = new Date()
  const today = seoulDate(now)
  const filter = params.get("filter") || "all"
  const update = (id: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value && value !== "all") next.set(id, value)
    else next.delete(id)
    setParams(next)
  }
  const rows = filteredApplicants(data, params, now)
  const title = {
    applicants: "신청자",
    members: "회원",
    introductions: "소개·매칭",
    exchange: "교류",
  }[section]
  const range =
    params.has("start") || params.has("end")
      ? periodRange("custom", now, {
          start: params.get("start") || "",
          end: params.get("end") || "",
        })
      : null
  const cases = introductionRows(data).filter((record) => {
    if (
      params.get("member") &&
      !record.memberIds.includes(params.get("member")!)
    )
      return false
    if (
      params.get("search") &&
      !record.id.includes(params.get("search")!) &&
      !record.memberIds.some((id) => id.includes(params.get("search")!))
    )
      return false
    if (filter === "noon")
      return (
        record.stage === "scheduled" &&
        data.admin.proposals.some(
          (proposal) =>
            proposal.id === record.id &&
            proposal.scheduledAt &&
            seoulDate(new Date(proposal.scheduledAt)) === today,
        )
      )
    if (filter === "published-today" || filter === "published")
      return inRange(record.publishedAt, { start: today, end: today }, now)
    if (filter === "overdue")
      return (
        record.stage === "response" &&
        !!record.responseDueAt &&
        new Date(record.responseDueAt) < now
      )
    if (filter === "mutual")
      return (
        (range ? true : ["mutual", "payment", "agreement", "starting"].includes(record.stage)) &&
        record.memberIds.every((id) => record.responses[id] === "positive") &&
        (!range ||
          record.memberIds.some((id) =>
            inRange(record.responseAt[id], range, now),
          ))
      )
    return filter === "all" || record.stage === filter
  })
  const exchanges = data.operations.exchanges.filter((record) => {
    if (
      params.get("member") &&
      !record.memberIds.includes(params.get("member")!)
    )
      return false
    if (
      params.get("search") &&
      !record.id.includes(params.get("search")!) &&
      !record.memberIds.some((id) => id.includes(params.get("search")!))
    )
      return false
    if (filter === "A" || filter === "B") return record.plan === filter
    if (filter === "delayed") return record.delayed
    if (filter === "stopped") return !!record.stoppedAt
    if (filter === "reported") return record.reportIds.length > 0
    if (filter === "active") {
      const day = exchangeDay(record, now)
      return day !== null && day <= 3 && !record.stoppedAt
    }
    if (filter === "completed")
      return data.events.some(
        (event) =>
          event.stage === "completed" &&
          event.memberIds.some((id) => record.memberIds.includes(id)) &&
          (!range || inRange(event.at, range, now)),
      )
    return true
  })
  const lookup = (id: string) =>
    applicantRows(data, now).find((row) => row.id === id)
  const nextAction = (record: IntroductionRecord, memberId: string) =>
    record.stage === "payment"
      ? memberPayment(data, memberId).startsWith("결제 기록 있음")
        ? "상대 교류비 결제 대기"
        : "본인 교류비 결제 대기"
      : record.stage === "agreement"
        ? "회원의 같은 방식·시작일 합의 대기"
        : record.stage === "response"
          ? record.responses[memberId] === "positive"
            ? "상대 실제 응답 대기"
            : record.responses[memberId] === "negative"
              ? "응답에 따른 종료 확인"
              : "본인 프로필 확인·선택 대기"
          : record.stage === "starting"
            ? "합의된 시작 시각·실제 시작 확인"
            : record.stage === "scheduled"
              ? "공개 직전 권리·동의·버전 재검증"
              : record.stage === "ended"
                ? "종료 사유·미시작 결제 문의 확인"
                : "기존 검토 상세에서 소개 준비 확인"
  const operate = (id: string, action: "cancel" | "support" | "correction") => {
    const result = handleIntroduction(data, id, action)
    if (result.data !== data) replaceConsoleData(result.data)
    setMessage(
      result.error ||
        "가상 운영 기록에만 반영했습니다. 응답·결제·거래 원본·소개 권리를 변경하지 않았습니다.",
    )
    setCancelId(null)
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs tracking-widest text-accent">
            OPERATIONS / {section.toUpperCase()}
          </p>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            가상 운영 자료 · 개인정보 권한/실제 DB 미연결 · 자기진술과 확인
            완료를 구분합니다.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/matching">
            기존 후보 검토 열기 <ArrowRight size={14} />
          </Link>
        </Button>
      </div>
      {message && (
        <p
          role="status"
          className="border-l-2 border-accent bg-card p-4 text-sm leading-6"
        >
          {message}
        </p>
      )}
      {section === "members" && (
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">현재 소개 가능한 운영 공급</h2>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            별도 운영용 집계입니다. 성별·연령·지역을 교차 세분하지 않으며 1~4명
            구간은 숨깁니다. 사용자 화면·알림에 자동 공개하지 않습니다.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            {protectedSupply(data, now).map((item) => (
              <div key={item.label} className="border-l border-border pl-3">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="mt-2 text-sm font-semibold tabular-nums">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
      {section === "applicants" || section === "members" ? (
        <>
          <section className="rounded-lg border border-border bg-card p-5">
            <div className="mb-5 flex flex-wrap gap-2">
              {(section === "members"
                ? MEMBER_STATES
                : [
                    { id: "all", label: "전체" },
                    { id: "pending", label: "검토 대기" },
                    { id: "photo-revision", label: "사진 보완" },
                    { id: "identity", label: "본인확인 대기" },
                    { id: "available", label: "소개 가능" },
                  ]
              ).map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant={filter === item.id ? "default" : "outline"}
                  aria-pressed={filter === item.id}
                  onClick={() => update("filter", item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
              <label className="grid gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Search size={12} />
                  활동용 이름·내부 ID
                </span>
                <Input
                  value={params.get("search") || ""}
                  onChange={(event) => update("search", event.target.value)}
                  placeholder="동의 범위 내 검색"
                />
              </label>
              <FilterSelect
                label="성별"
                value={params.get("gender") || ""}
                options={["여성", "남성", "직접 확인이 필요해요"].map(
                  (value) => ({ id: value, label: value }),
                )}
                onChange={(value) => update("gender", value)}
              />
              <label className="grid gap-2 text-xs text-muted-foreground">
                <span>최소 만 나이</span>
                <Input
                  type="number"
                  value={params.get("ageMin") || ""}
                  onChange={(event) => update("ageMin", event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-xs text-muted-foreground">
                <span>최대 만 나이</span>
                <Input
                  type="number"
                  value={params.get("ageMax") || ""}
                  onChange={(event) => update("ageMax", event.target.value)}
                />
              </label>
              <FilterSelect
                label="넓은 지역"
                value={params.get("region") || ""}
                options={(
                  APPLICATION_FIELDS.find(
                    (field) => field.id === "self.province",
                  )?.options || []
                ).map((value) => ({ id: value, label: value }))}
                onChange={(value) => update("region", value)}
              />
              <label className="grid gap-2 text-xs text-muted-foreground">
                <span>신청 시작일</span>
                <Input
                  type="date"
                  value={params.get("start") || ""}
                  onChange={(event) => {
                    const next = new URLSearchParams(params)
                    next.set("start", event.target.value)
                    next.set("dateFilter", "on")
                    setParams(next)
                  }}
                />
              </label>
              <label className="grid gap-2 text-xs text-muted-foreground">
                <span>신청 종료일</span>
                <Input
                  type="date"
                  value={params.get("end") || ""}
                  onChange={(event) => {
                    const next = new URLSearchParams(params)
                    next.set("end", event.target.value)
                    next.set("dateFilter", "on")
                    setParams(next)
                  }}
                />
              </label>
              <FilterSelect
                label="검토 상태"
                value={params.get("review") || ""}
                options={[
                  "pending",
                  "photo-revision",
                  "waiting",
                  "reviewed",
                ].map((value) => ({ id: value, label: activityLabel[value] }))}
                onChange={(value) => update("review", value)}
              />
              <FilterSelect
                label="사진"
                value={params.get("photo") || ""}
                options={[
                  "기준 확인",
                  "기준 확인 대기",
                  "등록 필요",
                  "재등록 요청",
                ].map((value) => ({ id: value, label: value }))}
                onChange={(value) => update("photo", value)}
              />
              <FilterSelect
                label="본인·성인 확인"
                value={params.get("identity") || ""}
                options={[
                  { id: "pending", label: "확인 전" },
                  { id: "confirmed", label: "확인값 있음" },
                ]}
                onChange={(value) => update("identity", value)}
              />
              <FilterSelect
                label="관계 목적"
                value={params.get("purpose") || ""}
                options={(
                  APPLICATION_FIELDS.find(
                    (field) => field.id === "self.purpose",
                  )?.options || []
                ).map((value) => ({ id: value, label: value }))}
                onChange={(value) => update("purpose", value)}
              />
              <Button
                size="sm"
                variant="ghost"
                className="self-end"
                onClick={() => setParams({})}
              >
                필터 초기화
              </Button>
            </div>
            {((params.get("ageMin") &&
              params.get("ageMax") &&
              Number(params.get("ageMin")) > Number(params.get("ageMax"))) ||
              (params.get("dateFilter") === "on" && !range)) && (
              <p role="alert" className="mt-4 text-xs text-destructive">
                최소≤최대와 유효한 신청일 범위를 확인해 주세요.
              </p>
            )}
          </section>
          <section className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex justify-between text-xs text-muted-foreground">
              <span>
                {rows.length}명 · 필터 {filter}
              </span>
              <span>행 선택 → 기존 검토 상세</span>
            </div>
            <Table
              empty={!rows.length}
              headers={
                section === "applicants"
                  ? [
                      "활동용 이름 / 내부 ID",
                      "성별",
                      "만 나이",
                      "넓은 지역",
                      "신청일",
                      "사진 상태",
                      "본인·성인",
                      "프로필",
                      "소개 준비",
                      "마지막 검토",
                    ]
                  : [
                      "활동용 이름 / 내부 ID",
                      "현재 상태",
                      "성별 / 만 나이",
                      "넓은 지역",
                      "최근 소개일",
                      "대기일",
                      "누적 소개",
                      "운영자 직접 검토",
                    ]
              }
            >
              {rows.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  aria-label={`${row.name} 검토 상세 열기`}
                  onClick={() =>
                    navigate(
                      `/admin/matching?member=${encodeURIComponent(row.id)}`,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter")
                      navigate(
                        `/admin/matching?member=${encodeURIComponent(row.id)}`,
                      )
                  }}
                  className="cursor-pointer border-b border-border outline-none hover:bg-secondary focus-visible:bg-secondary"
                >
                  <th scope="row" className="px-3 py-4 font-medium">
                    <Link
                      to={`/admin/matching?member=${encodeURIComponent(row.id)}`}
                      className="text-accent"
                    >
                      {row.name}
                      <span className="mt-1 block font-normal text-muted-foreground">
                        {row.id}
                      </span>
                    </Link>
                  </th>
                  {section === "applicants" ? (
                    <>
                      <td className="px-3 py-4">{row.gender}</td>
                      <td className="px-3 py-4">{row.age ?? "확인 전"}</td>
                      <td className="px-3 py-4">{row.region}</td>
                      <td className="px-3 py-4">{time(row.submittedAt)}</td>
                      <td className="px-3 py-4">{row.photoStatus}</td>
                      <td className="px-3 py-4">
                        {row.identityPending
                          ? "확인 전"
                          : row.age !== null &&
                              row.age >= BEFORE_US.operatingDraft.minimumAge
                            ? "가상 확인값 있음"
                            : "성인 기준 확인 필요"}
                      </td>
                      <td className="px-3 py-4">
                        {profileLabel[row.profileStatus]} · v
                        {row.profileVersion}
                      </td>
                      <td className="px-3 py-4">{row.preparation}</td>
                      <td className="px-3 py-4">{time(row.lastReviewedAt)}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-4">
                        {row.lifecycle !== "active"
                          ? activityLabel[row.lifecycle]
                          : row.activity !== "idle"
                            ? activityLabel[row.activity]
                            : activityLabel[row.status]}
                      </td>
                      <td className="px-3 py-4">
                        {row.gender} / {row.age ?? "확인 전"}
                      </td>
                      <td className="px-3 py-4">{row.region}</td>
                      <td className="px-3 py-4">
                        {time(row.recentIntroductionAt)}
                      </td>
                      <td className="px-3 py-4">
                        {row.waiting
                          ? row.waitingDays === null
                            ? "기준 확인 필요"
                            : `${row.waitingDays}일`
                          : "—"}
                      </td>
                      <td className="px-3 py-4">
                        {row.introductionCount === null
                          ? "기록 확인 필요"
                          : `${row.introductionCount}회`}
                      </td>
                      <td className="px-3 py-4">{time(row.lastReviewedAt)}</td>
                    </>
                  )}
                </tr>
              ))}
            </Table>
            <p className="mt-4 text-xs leading-6 text-muted-foreground">
              초기 신청의 첫 교류 실제 시작 전에는 소개 횟수 제한이 없습니다.
              누적 소개는 본인 이력이며 상대 프로필 재열람 목록이 아닙니다.
            </p>
          </section>
        </>
      ) : (
        <>
          <section className="rounded-lg border border-border bg-card p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <FilterSelect
                label="운영 상태"
                value={filter}
                options={
                  section === "introductions"
                    ? INTRO_STAGES
                    : [
                        { id: "active", label: "교류 중" },
                        { id: "A", label: "A 편지" },
                        { id: "B", label: "B 공동 선택" },
                        { id: "delayed", label: "지연" },
                        { id: "stopped", label: "중단" },
                        { id: "reported", label: "신고 연계" },
                        { id: "one-unpaid", label: "한쪽 미결제" },
                      ]
                }
                onChange={(value) => update("filter", value)}
              />
              <label className="grid gap-2 text-xs text-muted-foreground">
                <span>소개·교류 코드 / 회원 ID</span>
                <Input
                  value={params.get("search") || ""}
                  onChange={(event) => update("search", event.target.value)}
                />
              </label>
              <Button
                size="sm"
                variant="ghost"
                className="self-end"
                onClick={() => setParams({})}
              >
                필터 초기화
              </Button>
            </div>
          </section>
          {section === "introductions" ? (
            <section className="rounded-lg border border-border bg-card p-5">
              {filter === "selection-needed" && (
                <div className="mb-5 border-l-2 border-accent bg-secondary p-4">
                  <p className="mb-3 text-sm">
                    상대를 임의로 만들지 않습니다. 후보 대기 회원을 기존 검토
                    상세에서 확인해 주세요.
                  </p>
                  {consoleMembers(data, now)
                    .filter((member) => member.waiting)
                    .map((member) => (
                      <Button asChild variant="ghost" size="sm" key={member.id}>
                        <Link
                          to={`/admin/matching?member=${encodeURIComponent(member.id)}`}
                        >
                          {member.id} 검토 <ArrowRight size={12} />
                        </Link>
                      </Button>
                    ))}
                </div>
              )}
              <Table
                empty={!cases.length}
                headers={[
                  "소개 코드 / 상태",
                  "두 회원",
                  "제안 / 공개",
                  "응답 기한",
                  "공개 버전",
                  "각자 응답",
                  "실제 결제 기록",
                  "다음 행동",
                  "운영 처리",
                ]}
              >
                {cases.map((record) => (
                  <tr
                    key={record.id}
                    className="border-b border-border align-top"
                  >
                    <th scope="row" className="px-3 py-4 font-medium">
                      {record.id}
                      <span className="mt-2 block font-normal text-muted-foreground">
                        {
                          INTRO_STAGES.find(
                            (stage) => stage.id === record.stage,
                          )?.label
                        }
                      </span>
                    </th>
                    <td className="px-3 py-4">
                      {record.memberIds.map((id) => (
                        <Link
                          key={id}
                          to={`/admin/matching?member=${encodeURIComponent(id)}`}
                          className="mb-2 block text-accent"
                        >
                          {lookup(id)?.name || id}
                          <span className="block text-muted-foreground">
                            {id}
                          </span>
                        </Link>
                      ))}
                    </td>
                    <td className="px-3 py-4">
                      {time(record.proposedAt)}
                      <br />
                      공개: {time(record.publishedAt)}
                    </td>
                    <td className="px-3 py-4">{time(record.responseDueAt)}</td>
                    <td className="px-3 py-4">
                      {record.memberIds.map((id) => (
                        <p key={id}>
                          {id}:{" "}
                          {record.profileVersions[id]
                            ? `v${record.profileVersions[id]}`
                            : "확인 필요"}
                        </p>
                      ))}
                    </td>
                    <td className="px-3 py-4">
                      {record.memberIds.map((id) => (
                        <p key={id} className="mb-2">
                          {id}:{" "}
                          {record.responses[id] === "positive"
                            ? "긍정 응답"
                            : record.responses[id] === "negative"
                              ? "부정 응답"
                              : "응답 기록 없음"}
                          <br />
                          <span className="text-muted-foreground">
                            {time(record.responseAt[id] || null)}
                          </span>
                        </p>
                      ))}
                    </td>
                    <td className="px-3 py-4">
                      {record.memberIds.map((id) => (
                        <p key={id} className="mb-2">
                          {id}
                          <br />
                          {memberPayment(data, id)}
                        </p>
                      ))}
                    </td>
                    <td className="px-3 py-4">
                      {record.memberIds.map((id) => (
                        <p key={id} className="mb-2">
                          {id}: {nextAction(record, id)}
                        </p>
                      ))}
                      <br />
                      방식: {record.plan || "미합의"}
                      <br />
                      시작 예정: {time(record.plannedStartAt)}
                    </td>
                    <td className="px-3 py-4">
                      <div className="grid gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={record.stage === "ended"}
                          onClick={() => setCancelId(record.id)}
                        >
                          소개 취소
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => operate(record.id, "correction")}
                        >
                          오류 보완 요청
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => operate(record.id, "support")}
                        >
                          문의 처리
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
              {cancelId && (
                <div
                  role="alert"
                  className="mt-5 border border-border bg-secondary p-5"
                >
                  <p className="text-sm leading-6">
                    {cancelId} 소개를 취소하고 대기로 이동합니다. 응답·결제
                    원본·기존 권리는 보존하며 미시작 교류비는 별도 검토합니다.
                    이미 본 화면·캡처 회수를 보장하지 않습니다.
                  </p>
                  <div className="mt-4 flex gap-3">
                    <Button
                      variant="destructive"
                      className="text-destructive-foreground"
                      size="sm"
                      onClick={() => operate(cancelId, "cancel")}
                    >
                      취소 확인
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCancelId(null)}
                    >
                      돌아가기
                    </Button>
                  </div>
                </div>
              )}
              <p className="mt-4 text-xs leading-6 text-muted-foreground">
                선택·결제·A/B·편지·만남 의사는 운영자가 대신 입력하거나 완료할
                수 없습니다. 소개 준비·공개 예약·실제 공개는 서로 다른
                상태입니다.
              </p>
            </section>
          ) : (
            <section className="rounded-lg border border-border bg-card p-5">
              {filter === "one-unpaid" ? (
                <Table
                  empty={!rows.length}
                  headers={["회원", "실제 활동", "교류비", "다음 행동"]}
                >
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-border">
                      <td className="px-3 py-4">
                        <Link
                          to={`/admin/matching?member=${encodeURIComponent(row.id)}`}
                          className="text-accent"
                        >
                          {row.id}
                        </Link>
                      </td>
                      <td className="px-3 py-4">
                        {activityLabel[row.activity]}
                      </td>
                      <td className="px-3 py-4">
                        {memberPayment(data, row.id)}
                      </td>
                      <td className="px-3 py-4">
                        회원의 실제 결제 대기 · 교류 아직 미시작
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Table
                  empty={!exchanges.length}
                  headers={[
                    "교류 / 두 회원",
                    "방식",
                    "실제 DAY",
                    "양쪽 오늘 제출",
                    "지연 / 중단",
                    "신고 연계",
                    "제한된 본문 접근",
                  ]}
                >
                  {exchanges.map((record) => {
                    const day = exchangeDay(record, now)
                    return (
                      <tr
                        key={record.id}
                        className="border-b border-border align-top"
                      >
                        <th scope="row" className="px-3 py-4 font-medium">
                          {record.id}
                          {record.memberIds.map((id) => (
                            <Link
                              key={id}
                              to={`/admin/matching?member=${encodeURIComponent(id)}`}
                              className="mt-2 block font-normal text-accent"
                            >
                              {id}
                            </Link>
                          ))}
                        </th>
                        <td className="px-3 py-4">{record.plan || "미합의"}</td>
                        <td className="px-3 py-4">
                          {day === null
                            ? "실제 시작 전"
                            : record.stoppedAt
                              ? "중단 · DAY 갱신 안 함"
                              : day <= 3
                                ? `DAY ${String(day).padStart(2, "0")}`
                                : "교류 기간 경과 · 완료 응답 별도 확인"}
                          <br />
                          <span className="text-muted-foreground">
                            시작: {time(record.actualStartedAt)}
                          </span>
                        </td>
                        <td className="px-3 py-4">
                          {record.memberIds.map((id) => (
                            <p key={id} className="mb-2">
                              {id}:{" "}
                              {day !== null && day <= 3 && !record.stoppedAt
                                ? record.submissions[today]?.[id]
                                  ? `제출 기록 ${time(record.submissions[today][id])}`
                                  : "제출 기록 없음"
                                : "오늘 제출 해당 없음"}
                            </p>
                          ))}
                        </td>
                        <td className="px-3 py-4">
                          {record.delayed ? "지연 표시 있음" : "지연 표시 없음"}
                          <br />
                          {record.stoppedAt
                            ? `중단 ${time(record.stoppedAt)}`
                            : "중단 기록 없음"}
                        </td>
                        <td className="px-3 py-4">
                          {record.reportIds.length
                            ? record.reportIds.map((id) => (
                                <Link
                                  key={id}
                                  to={`/admin/safety?report=${encodeURIComponent(id)}`}
                                  className="mb-2 block text-accent"
                                >
                                  {id}{" "}
                                  <ShieldAlert size={12} className="inline" />
                                </Link>
                              ))
                            : "신고 연계 없음"}
                        </td>
                        <td className="px-3 py-4">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!record.reportIds.length}
                            onClick={() => {
                              const result = requestExchangeContent(
                                data,
                                record.id,
                              )
                              if (result.data !== data)
                                replaceConsoleData(result.data)
                              setMessage(result.error)
                            }}
                          >
                            <LockKeyhole size={13} />
                            신고 검토 열람 요청
                          </Button>
                          <p className="mt-2 text-xs text-muted-foreground">
                            별도 서버 권한·이유·시각 로그 필요
                            <br />
                            현재 본문/초안 제공 불가
                          </p>
                        </td>
                      </tr>
                    )
                  })}
                </Table>
              )}
              <p className="mt-4 text-xs leading-6 text-muted-foreground">
                DAY는 양쪽 결제·방식·시작일 합의와 실제 시작 기록이 있어야
                계산합니다. 편지 본문·초안은 이 목록 데이터에 포함하지 않으며
                운영자가 대필·제출 완료 처리하지 않습니다.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  )
}
export function AdminMemberHistory({ memberId }: { memberId: string }) {
  const data = useConsoleData()
  const row = consoleMembers(data).find((member) => member.id === memberId)
  const [note, setNote] = useState("")
  const [message, setMessage] = useState("")
  return (
    <section className="border border-border bg-card p-6">
      <h3 className="text-base font-semibold">과거 소개 요약 · 운영 메모</h3>
      <div className="my-4 grid gap-3 text-xs sm:grid-cols-2">
        <p>최근 소개일: {time(row?.recentIntroductionAt || null)}</p>
        <p>
          대기일:{" "}
          {row?.waitingDays === null || row?.waitingDays === undefined
            ? "기준 기록 확인 필요"
            : `${row.waitingDays}일`}
        </p>
        <p>누적 소개: {row?.introductionCount ?? "기록 확인 필요"}</p>
        <p>운영자 직접 검토: {time(row?.lastReviewedAt || null)}</p>
      </div>
      <p className="mb-5 text-xs leading-6 text-muted-foreground">
        본인 이력 요약입니다. 과거 상대의 전체 프로필 재열람 목록은 제공하지
        않습니다. 첫 교류 시작 전 소개 횟수 제한·추가 과금은 없습니다.
      </p>
      <label
        htmlFor={`operator-note-${memberId}`}
        className="mb-2 block text-xs font-medium"
      >
        운영자 전용 메모 · 최대 500자
      </label>
      <Textarea
        id={`operator-note-${memberId}`}
        maxLength={500}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="연락처·신분 자료·편지 본문을 복사하지 마세요."
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          회원·상대 프로필에는 포함되지 않습니다.
        </span>
        <Button
          size="sm"
          disabled={!note.trim()}
          onClick={() => {
            const result = addOperatorNote(data, memberId, note)
            if (!result.error) {
              replaceConsoleData(result.data)
              setNote("")
            }
            setMessage(result.error || "가상 운영 메모를 저장했습니다.")
          }}
        >
          메모 저장
        </Button>
      </div>
      {message && (
        <p role="status" className="mt-3 text-xs leading-6">
          {message}
        </p>
      )}
      <div className="mt-5 space-y-3">
        {data.operations.notes
          .filter((item) => item.memberId === memberId)
          .map((item) => (
            <article
              key={item.id}
              className="border-l-2 border-accent bg-secondary p-4"
            >
              <p className="whitespace-pre-wrap text-sm leading-6">
                {item.body}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                가상 Owner · {time(item.at)} · 프로필 v{item.profileVersion}
              </p>
            </article>
          ))}
      </div>
    </section>
  )
}
