import { useState } from "react";
import { Link } from "react-router";
import { Bell, Clock3, ArrowUpRight } from "lucide-react";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { BEFORE_US } from "./config";
import { emptyIntroductionBook, makeIntroductionFixture } from "./introduction-model";
import { TODAY_STATES, type TodaySnapshot } from "./today-state";
import { currentStatus, EMPTY_NOTICE_PREFERENCES, recordVirtualDelivery, runNoonDemo, STATUS_MESSAGES, waitingFollowUp, type NoonInput, type NoonState, type NoticePreferences, type StatusStage } from "./noon-status-model";

import { useOwnMemberAccount, setMemberNotices } from "./member-operations-model";

type PreferencesProps = {
  memberId?: string;
  value?: NoticePreferences;
  onChange?: (value: NoticePreferences) => void;
};
export function NoticePreferencesPanel({ value, onChange, memberId = "current-member" }: PreferencesProps) {
  const account=useOwnMemberAccount(memberId);
  const saved = account?.notices || EMPTY_NOTICE_PREFERENCES;
  const preferences = value || saved;
  const set = onChange || ((next: NoticePreferences) => setMemberNotices(memberId,next));
  return <div className="space-y-4">
    <div className="flex items-center gap-2 font-semibold"><Bell size={16} />서비스 상태 안내</div>
    <p className="text-xs leading-6 text-muted-foreground">추천은 ‘새 소개가 준비됐을 때만 받기’예요. 직접 선택하기 전에는 동의하지 않은 상태예요.</p>
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4"><Checkbox checked={preferences.newIntroduction} onCheckedChange={checked => set({ ...preferences, newIntroduction: checked === true })} /><span className="text-sm">새 소개가 준비됐을 때만 받기<span className="ml-2 text-xs text-primary">추천</span><span className="mt-1 block text-xs text-muted-foreground">새 소개 및 상호 선택 진행 안내</span></span></label>
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4"><Checkbox checked={preferences.dailyWaiting} onCheckedChange={checked => set({ ...preferences, dailyWaiting: checked === true })} /><span className="text-sm">새 소개가 없어도 매일 정오에 상태 안내 받기<span className="mt-1 block text-xs text-muted-foreground">별도 선택 · 기존 응답·결제·합의 단계에서는 해당 상태를 유지해요.</span></span></label>
    <p className="text-xs leading-6 text-muted-foreground">일일 대기 안내를 꺼도 소개 이용 권리는 유지돼요. 홈페이지에서 현재 상태를 확인할 수 있어요. 마케팅 동의와는 별개예요.</p>
    <div className="rounded-xl bg-muted p-4 text-xs leading-6">데모 설정 · 현재 브라우저 메모리에서만 유지돼요. 실제 알림 동의 저장·카카오 발송은 연결되지 않았어요. 카카오 로그인은 사업자 알림 발송 승인과 달라요. 미승인 상태에서는 홈페이지 안내만 유지해요.</div>
  </div>;
}

type CurrentStatusProps = { snapshot: TodaySnapshot };
export function CurrentNoonStatus({ snapshot }: CurrentStatusProps) {
  const input: NoonInput = { memberId: "current-member", stage: snapshot.stage, operatorReviewedAt: snapshot.operatorReviewedAt, lastIntroductionAt: snapshot.lastIntroductionAt, waitingSince: null, preferences: EMPTY_NOTICE_PREFERENCES };
  const followUp = waitingFollowUp(input, new Date());
  return <section className="mt-6 rounded-2xl border border-lilac bg-mist p-5 sm:p-6" aria-label="정오 진행 안내">
    <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={16} className="text-primary" />정오 진행 안내</div><span className="text-xs text-muted-foreground">12:00 · Asia/Seoul</span></div>
    <p className="mt-4 text-sm font-medium">현재 상태 · {currentStatus(input)}</p>
    <p className="mt-2 text-xs leading-6 text-muted-foreground">새 소개가 없어도 이곳에서 현재 진행 상태를 확인할 수 있어요. 매일 새 소개는 보장되지 않으며 이용 중인 혜택 안에서는 추가 소개비가 발생하지 않아요.</p>
    <p className="mt-3 text-xs text-muted-foreground">정오 자동 작업: 미연결 · 실행 완료 기록 없음</p>
    {followUp?.needsReview && <p className="mt-3 text-xs leading-6">새 소개 없는 7일 경과 · 담당자 실제 검토가 필요해요. 검토 완료 기록은 아직 확인되지 않았어요.</p>}
    {followUp?.counseling && <p className="mt-3 text-xs leading-6">14일 대기 안내 · 대기 지속·일시정지·취소 상담을 선택할 수 있어요. 권리 만료나 환불 신청 제한이 아니에요.</p>}
    {snapshot.stage === "waiting" && <div className="mt-4 flex flex-wrap gap-3">
      <Button asChild variant="outline" size="sm"><Link to="/profile">소개 일시정지·내 요청 확인</Link></Button>
      <Button asChild variant="outline" size="sm"><Link to="/support">대기 지속·취소 상담</Link></Button>
    </div>}
    <p className="mt-3 text-xs leading-6 text-muted-foreground">장기 대기 기준은 운영 초안이에요. 시스템 상태 갱신과 운영자의 실제 검토 기록은 별도로 확인해요.</p>
  </section>;
}

export function NoonAdminGuide() {
  return <div className="space-y-4 border-t border-border pt-5">
    <p className="text-sm font-semibold">공개·앱 내 안내·사업자 발송은 별도 상태예요.</p>
    <div className="grid gap-3 sm:grid-cols-3">{["홈페이지: 현재 상태 확인", "앱 내 알림: 실제 연동 없음", "카카오: 승인·발송 미연결"].map(label => <div key={label} className="bg-muted p-4 text-xs leading-6">{label}</div>)}</div>
    <p className="text-xs leading-6 text-muted-foreground">채널·발송업체·업종·템플릿·반복 안내 허용 여부 확인 전에는 발송하지 않아요. 회원의 선택은 발송 승인과 달라요. 메시지와 URL에는 사진·실명·취향·연락처를 넣지 않아요. 링크 접근 시 서버 로그인·당사자 권한 재검사가 필요해요.</p>
    <p className="text-xs leading-6">운영 초안 · 새 소개 없는 {BEFORE_US.noonGuidance.reviewAfterDays}일에 실제 담당 검토, {BEFORE_US.noonGuidance.counselingAfterDays}일에 대기 지속·일시정지·취소 상담 안내. 자동 작업은 실제 검토 이력을 만들지 않아요. 권리 만료·환불 신청 제한이 아니에요.</p>
    <Button asChild variant="outline"><Link to="/demo/noon">정오 상태 분기 데모 <ArrowUpRight size={15} /></Link></Button>
  </div>;
}

const demoNow = new Date("2026-10-07T12:00:10+09:00");
const choices: StatusStage[] = ["waiting", "review", "ready", "response", "partner_payment", "agreement", "a_write", "paused", "withdrawn", "cancelled"];
export function NoonDemo() {
  const [stage, setStage] = useState<StatusStage>("waiting");
  const [preferences, setPreferences] = useState({ ...EMPTY_NOTICE_PREFERENCES });
  const [state, setState] = useState<NoonState>({ book: emptyIntroductionBook(), notices: [], runs: [] });
  const [errors, setErrors] = useState<string[]>([]);
  const input: NoonInput = { memberId: "virtual-left", stage, preferences, operatorReviewedAt: null, waitingSince: "2026-09-23T12:00:00+09:00", lastIntroductionAt: null };
  const followUp = waitingFollowUp(input, demoNow);
  const run = () => {
    const inputs = [input, { ...input, memberId: "virtual-right" }];
    const result = runNoonDemo(state, inputs, demoNow);
    setState(result.state); setErrors(result.errors);
  };
  const changeStage = (value: string) => {
    const next = value as StatusStage;
    setStage(next); setState({ book: next === "ready" ? makeIntroductionFixture(demoNow) : emptyIntroductionBook(), notices: [], runs: [] }); setErrors([]);
  };
  const notice = state.notices.find(item => item.memberId === input.memberId);
  const lastRun = state.runs.find(item => item.memberId === input.memberId);
  return <main className="mx-auto max-w-5xl px-5 py-10">
    <p className="text-xs font-semibold tracking-widest text-accent">NOON STATUS / DEMO ONLY</p>
    <h1 className="mt-3 text-3xl font-semibold">정오, 지금의 상태를 안내해요.</h1>
    <p className="mt-4 text-sm leading-7 text-muted-foreground">개발용 가상 시계: 2026년 10월 7일 12:00:10 · Asia/Seoul. 자동 실행·실제 회원·서버 공개·카카오 발송은 없어요.</p>
    <div className="mt-7 flex flex-wrap items-center gap-3"><Select value={stage} onValueChange={changeStage}><SelectTrigger className="w-64" aria-label="가상 진행 상태"><SelectValue /></SelectTrigger><SelectContent>{choices.map(value => <SelectItem key={value} value={value}>{value in TODAY_STATES ? TODAY_STATES[value as TodaySnapshot["stage"]].label : value === "withdrawn" ? "탈퇴" : "취소"}</SelectItem>)}</SelectContent></Select><Button onClick={run}>가상 정오 처리 실행</Button><span className="text-xs text-muted-foreground">같은 조건 재실행은 중복 안내를 만들지 않아요.</span></div>
    <div className="mt-6 grid gap-5 lg:grid-cols-2"><section className="border border-border bg-card p-6"><NoticePreferencesPanel value={preferences} onChange={setPreferences} /></section><section className="border border-border bg-card p-6" aria-live="polite">
      <p className="text-xs font-semibold text-accent">현재 홈페이지 상태</p><p className="mt-3 text-lg font-semibold">{lastRun?.status || currentStatus(input)}</p>
      <dl className="mt-5 space-y-3 text-xs"><div><dt className="text-muted-foreground">정오 처리 시각 · 가상</dt><dd className="mt-1">{lastRun?.at || "미실행 · 갱신 완료 기록 없음"}</dd></div><div><dt className="text-muted-foreground">운영자의 실제 마지막 검토</dt><dd className="mt-1">확인된 기록 없음</dd></div></dl>
      {followUp && <div className="mt-5 bg-muted p-4 text-xs leading-6">새 소개 없는 {followUp.days}일 · {followUp.needsReview ? "실제 담당 검토 필요" : "검토 기준 미도달"}{followUp.counseling && <p>대기 지속·일시정지·취소 상담 안내 대상. 권리 만료가 아니에요.</p>}</div>}
      {errors.map((error, index) => <p key={index} className="mt-3 text-xs text-destructive">{error}</p>)}
      {notice && <div className="mt-5 border-t border-border pt-5"><p className="whitespace-pre-line text-sm leading-7">{notice.message}</p><Button className="mt-4" variant="outline" onClick={() => setErrors(["실제 로그인·당사자 권한 검사 미연결: 알림 링크 접근은 허용하지 않았어요. 회원 ID를 URL에 넣지 않아요."])}>진행 상태 확인</Button><dl className="mt-4 space-y-2 text-xs"><div>홈페이지 공개: 가상 상태 게시</div><div>앱 내 안내: {notice.inApp === "available-demo" ? "가상 알림 생성" : "미선택"}</div><div>카카오: {notice.kakao === "approval-required" ? "승인 확인 필요 · 발송 없음" : "미선택 · 발송 없음"}</div><div>결과 기록: {notice.attempts.length ? notice.attempts.map(attempt => `${attempt.result === "failed-demo" ? "가상 실패" : "가상 성공"} (${attempt.at})`).join(" → ") : "발송 시도 없음"}</div></dl><div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" disabled={notice.kakao === "not-selected" || notice.attempts.some(attempt => attempt.result === "delivered-demo")} onClick={() => setState(recordVirtualDelivery(state, notice.key, "failed-demo", demoNow))}>가상 실패 기록</Button><Button variant="outline" disabled={!notice.attempts.some(attempt => attempt.result === "failed-demo") || notice.attempts.some(attempt => attempt.result === "delivered-demo")} onClick={() => setState(recordVirtualDelivery(state, notice.key, "delivered-demo", demoNow))}>가상 재시도 결과</Button></div><p className="mt-3 text-xs text-muted-foreground">결과 시뮬레이션만 기록해요. 미승인 템플릿을 실제 발송하거나 재시도하지 않아요.</p></div>}
      <p className="mt-5 text-xs text-muted-foreground">가상 회원별 처리 {state.runs.length}건 · 가상 홈페이지 안내 {state.notices.length}건</p>
    </section></div>
    <section className="mt-6 border border-border bg-card p-6"><NoonAdminGuide /><details className="mt-5 text-xs"><summary className="cursor-pointer">승인 문구 초안 3종 확인</summary>{Object.entries(STATUS_MESSAGES).map(([key, message]) => <p key={key} className="mt-4 whitespace-pre-line leading-6">{message}</p>)}</details></section>
  </main>;
}
