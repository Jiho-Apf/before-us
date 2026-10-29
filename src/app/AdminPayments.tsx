import { useState } from "react";
import { Link, useOutletContext } from "react-router";
import { Button } from "./components/ui/button";
import { box, useBusy, useLoad } from "./admin-match";
import { Notice, Pill, useConfirm } from "./AdminMatch";
import { kstDateTime } from "./dates";
import { PAYMENT_KIND_LABEL, PAYMENT_STATUS_LABEL, adminCancelPayment, adminListPayments, failReason, won, type AdminPayment, type PaymentMode, type PaymentStatus } from "./backend/payments";

// 운영진 결제 목록(/admin/payments · 대표·운영·정산 + 2단계 인증은 서버 함수가 다시 확인한다).
// 테스트 결제 취소는 대표·운영만: payments-cancel edge function이 권한 확인·감사 기록 뒤 토스페이먼츠에서 전액 취소한다.
type Role = "owner" | "operator" | "counselor" | "finance";
type Filter<T extends string> = T | "all";
const STATUS_TABS: [Filter<PaymentStatus>, string][] = [["all", "전체"], ["paid", "결제 완료"], ["failed", "결제 안 됨"], ["cancelled", "취소됨"], ["ready", "결제 전"]];
const MODE_TABS: [Filter<PaymentMode>, string][] = [["all", "모든 모드"], ["test", "테스트"], ["live", "실결제"]];
const STATUS_TONE: Record<PaymentStatus, "ok" | "danger" | "muted" | "warn"> = { paid: "ok", failed: "danger", cancelled: "muted", ready: "warn" };

function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (value: T) => void; label: string }) {
  return <div role="group" aria-label={label} className="flex flex-wrap gap-2">{options.map(([key, text]) => <Button key={key} size="sm" variant={value === key ? "default" : "outline"} aria-pressed={value === key} onClick={() => onChange(key)}>{text}</Button>)}</div>;
}

export function AdminPayments() {
  const role = useOutletContext<{ role: Role } | undefined>()?.role ?? "counselor";
  const canCancel = role === "owner" || role === "operator";
  const [status, setStatus] = useState<Filter<PaymentStatus>>("all");
  const [mode, setMode] = useState<Filter<PaymentMode>>("all");
  const list = useLoad(async () => {
    const { data, error } = await adminListPayments(status === "all" ? null : status, mode === "all" ? null : mode);
    if (error) throw new Error(error);
    return data ?? [];
  }, [status, mode]);
  const [message, setMessage] = useState("");
  const { busy, run } = useBusy();
  const { ask, dialog } = useConfirm();
  const cancel = (row: AdminPayment) => run(row.id, async () => {
    const reason = await ask({
      title: "테스트 결제를 취소할까요?",
      body: <><p className="font-semibold text-foreground">{row.name ?? row.email ?? "탈퇴한 회원"} · {PAYMENT_KIND_LABEL[row.kind]} {won(row.amount)}</p><p>토스페이먼츠 테스트 결제를 전액 취소해요. 실제로 돈이 오가지 않은 결제예요. 취소 이유는 감사 기록에 남고, 회원의 결제 내역에도 보여요.</p></>,
      confirm: "테스트 결제 취소", danger: true,
      reason: { label: "취소 이유(필수 · 200자 안)", placeholder: "예: 결제 흐름 점검을 마쳐 정리해요", required: true },
    });
    if (reason === null) return;
    const { error } = await adminCancelPayment(row.id, reason);
    setMessage(error || "테스트 결제를 취소했어요.");
    if (!error) await list.reload();
  });
  const rows = list.data ?? [];

  return <>
    <div className="mb-6"><h1 className="text-2xl font-semibold">결제</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">토스페이먼츠 결제 기록이에요. 사업자등록 전이라 지금은 테스트 결제만 있고, 실제로 돈이 오가지 않아요. 베타 흐름(소개·교류)은 결제와 무관해요. 최근 300건까지 보여요.</p></div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><Tabs label="결제 상태" value={status} options={STATUS_TABS} onChange={setStatus} /><Tabs label="결제 모드" value={mode} options={MODE_TABS} onChange={setMode} /></div>
    <div className="mb-4 space-y-2"><Notice text={list.error || ""} /><Notice text={message} /></div>
    <section className={`${box} overflow-x-auto`}>
      <table className="w-full min-w-[860px] text-left text-xs">
        <thead className="border-b border-border text-muted-foreground"><tr><th className="p-3">시각</th><th className="p-3">회원</th><th className="p-3">항목 · 금액</th><th className="p-3">상태</th><th className="p-3">모드</th><th className="p-3"><span className="sr-only">동작</span></th></tr></thead>
        <tbody className="divide-y divide-border">{rows.map(row => {
          const note = row.status === "failed" ? failReason(row.failureCode ?? "", row.failureMessage ?? "") : row.status === "cancelled" ? `취소 이유 · ${row.cancelReason ?? "-"}` : row.method ? `결제수단 · ${row.method}` : "";
          return <tr key={row.id} className="align-top">
            <td className="whitespace-nowrap p-3">{kstDateTime(row.createdAt)}{row.approvedAt && <span className="block text-muted-foreground">승인 {kstDateTime(row.approvedAt)}</span>}{row.cancelledAt && <span className="block text-muted-foreground">취소 {kstDateTime(row.cancelledAt)}</span>}</td>
            <td className="p-3">{row.email ? <Link to={`/admin/members?q=${encodeURIComponent(row.email)}`} className="font-semibold text-primary hover:underline">{row.name ?? "이름 없음"}</Link> : <span className="text-muted-foreground">탈퇴한 회원</span>}{row.email && <span className="block break-all text-muted-foreground">{row.email}</span>}</td>
            <td className="p-3"><span className="font-semibold">{PAYMENT_KIND_LABEL[row.kind]} · <span className="tabular-nums">{won(row.amount)}</span></span><span className="block break-all font-mono text-[11px] text-muted-foreground">{row.orderId}</span></td>
            <td className="p-3"><Pill tone={STATUS_TONE[row.status]}>{PAYMENT_STATUS_LABEL[row.status]}</Pill>{note && <span className="mt-1 block max-w-[16rem] leading-5 text-muted-foreground">{note}</span>}{row.failureCode && row.status === "failed" && <span className="block font-mono text-[11px] text-muted-foreground">{row.failureCode}</span>}</td>
            <td className="p-3">{row.mode === "test" ? <Pill tone="warn">테스트</Pill> : <Pill tone="danger">실결제</Pill>}</td>
            <td className="p-3 text-right">{canCancel && row.mode === "test" && row.status === "paid" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void cancel(row)}>{busy === row.id ? "취소하고 있어요" : "테스트 결제 취소"}</Button>}</td>
          </tr>;
        })}</tbody>
      </table>
      {list.loading && <p className="p-5 text-sm text-muted-foreground">불러오고 있어요.</p>}
      {!list.loading && !list.error && !rows.length && <p className="p-5 text-sm text-muted-foreground">해당하는 결제가 없어요.</p>}
    </section>
    {!canCancel && <p className="mt-4 text-xs text-muted-foreground">테스트 결제 취소는 대표·운영 역할만 할 수 있어요.</p>}
    {dialog}
  </>;
}
