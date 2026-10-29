import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ArrowRight, FlaskConical } from "lucide-react";
import { Button } from "./components/ui/button";
import { PageHeader, QuietNote, Sheet, TwoDots } from "./editorial";
import { Member, Waiting } from "./LiveMember";
import { BEFORE_US } from "./config";
import { kstDateTime } from "./dates";
import { PAYMENT_KIND_LABEL, PAYMENT_MODE, PAYMENT_STATUS_LABEL, confirmPayment, createPaymentOrder, failReason, loadMyPayments, loadPaymentChoices, markPaymentFailed, mountCheckout, readFailReturn, readSuccessReturn, won, type Checkout, type Payment, type PaymentChoices, type PaymentKind, type PaymentOrder } from "./backend/payments";

// 실제 서버 모드의 결제 화면(/payments · /payments/success · /payments/fail).
// 지금은 테스트 결제만 한다. 베타 동안 결제는 필요 없고, 여기서 결제해도 신청·소개·교류에는 아무 영향이 없다(서버의 다른 흐름은 결제 기록을 읽지 않는다).
const interaction = "transition-colors duration-200 motion-reduce:transition-none";
const BETA = BEFORE_US.beta.active;
const TEST = PAYMENT_MODE === "test";

function TestBanner() {
  return (
    <div role="note" className="flex items-start gap-3 rounded-2xl border border-[#EBCB6B] bg-[#FFF6D8] px-5 py-4 text-[#4A3A0C] dark:border-[#7A6526] dark:bg-[#3B3424] dark:text-[#F8E5A6]">
      <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[#F8E5A6] text-[#5A4310] dark:bg-[#5A4A1C] dark:text-[#F8E5A6]"><FlaskConical size={16} strokeWidth={1.8} /></span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-6">테스트 결제예요. 실제로 돈이 나가지 않아요.</p>
        <p className="mt-1 text-xs leading-6 opacity-80">결제창에서 끝까지 진행해도 승인만 흉내 내고, 카드나 계좌에서 돈이 빠져나가지 않아요.{BETA ? " 베타 동안에는 결제가 필요 없고, 이 시험은 소개·교류에 아무 영향이 없어요." : ""}</p>
      </div>
    </div>
  );
}

function StatusTag({ payment }: { payment: Payment }) {
  const tone = payment.status === "paid" ? "bg-primary/10 text-primary" : payment.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>{PAYMENT_STATUS_LABEL[payment.status]}</span>;
}
const TestTag = () => <span className="rounded-full bg-[#F8E5A6] px-2 py-0.5 text-[10px] font-semibold text-[#5A4310] dark:bg-[#5A4A1C] dark:text-[#F8E5A6]">테스트</span>;

// ─────────────────────────────────────────────
// 결제 화면
export function LivePaymentsPage() {
  return <Member><PaymentsView /></Member>;
}

function PaymentsView() {
  // undefined = 불러오는 중, null = 불러오지 못함
  const [choices, setChoices] = useState<PaymentChoices | null | undefined>(undefined);
  const [history, setHistory] = useState<Payment[] | null | undefined>(undefined);
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [starting, setStarting] = useState<PaymentKind | null>(null);
  const [notice, setNotice] = useState("");
  const refresh = async () => { const [nextChoices, nextHistory] = await Promise.all([loadPaymentChoices(), loadMyPayments()]); setChoices(nextChoices); setHistory(nextHistory); };
  useEffect(() => { void refresh(); }, []);
  const start = async (kind: PaymentKind, programId?: string) => {
    if (starting) return;
    setStarting(kind); setNotice("");
    const { data, error } = await createPaymentOrder(kind, programId);
    setStarting(null);
    if (error || !data) { setNotice(error ?? "결제를 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요."); return; }
    setOrder(data);
  };
  if (choices === undefined) return <Waiting />;
  const paid = (kind: PaymentKind, programId?: string) => !!history?.some(item => item.kind === kind && item.status === "paid" && (kind === "introduction" || item.programId === programId));
  const program = choices?.program ?? null;
  const action = (kind: PaymentKind, allowed: boolean, blockedText: string, programId?: string) => {
    if (paid(kind, programId)) return <p className="text-xs leading-6 text-muted-foreground"><span className="font-semibold text-primary">{TEST ? "테스트 결제를 마쳤어요." : "결제를 마쳤어요."}</span> 아래 결제 내역에서 볼 수 있어요.</p>;
    return <>
      <Button disabled={!allowed || !!starting || !!order} onClick={() => void start(kind, programId)} className={`h-12 w-full rounded-full px-6 sm:w-auto ${interaction}`}>{starting === kind ? "준비하고 있어요…" : TEST ? "테스트로 결제해 보기" : "결제하기"}</Button>
      {!allowed && <p className="mt-3 text-xs leading-6 text-muted-foreground">{blockedText}</p>}
    </>;
  };

  return (
    <section className="space-y-10">
      <PageHeader mark="결제" label={BETA ? "베타 기간" : "결제"} en="PAYMENTS" title={BETA ? "베타 기간에는 결제가 없어요." : "소개비와 교류비"}
        lead={BETA ? "소개도, 서로 선택한 뒤의 3일 교류도 무료예요. 이 화면은 정식 운영을 준비하며 결제 과정을 미리 시험해 보는 곳이에요." : "소개비는 신청서가 승인된 뒤에, 교류비는 두 분이 서로 선택한 뒤 3일 교류를 시작하기 전에 내요. 금액은 서버에서 정해져요."}
        aside={<TwoDots apart faded />} />
      {TEST && <TestBanner />}

      {order ? <CheckoutSheet order={order} onClose={() => { setOrder(null); void refresh(); }} /> : (
        <div className="grid gap-5 md:grid-cols-2">
          <PriceSheet label="소개비" amount={BEFORE_US.pricing.introduction} body="정식 운영에서는 신청서가 승인된 뒤 한 번 내고, 최대 5번 소개받아요. 월정액이나 자동 결제는 없어요.">
            {choices === null ? <LoadError onRetry={() => void refresh()} /> : action("introduction", choices.approved, "신청서가 승인된 뒤에 시험해 볼 수 있어요.")}
          </PriceSheet>
          {program && <PriceSheet label="교류비" amount={BEFORE_US.pricing.exchangePerPerson} unit="한 분당" body={`두 분이 서로 ‘알아가고 싶어요’를 고른 뒤, 3일 교류를 시작하기 전에 각자 내요.${program.partnerName ? ` 지금 ${program.partnerName} 님과 시작을 준비하고 있어서 보여요.` : ""}`}>
            {action("exchange", true, "", program.id)}
          </PriceSheet>}
        </div>
      )}
      {notice && <p role="alert" className="rounded-xl bg-muted p-4 text-xs leading-6">{notice}</p>}

      <section aria-labelledby="payment-history-title">
        <h2 id="payment-history-title" className="text-sm font-semibold">결제 내역</h2>
        {history === undefined ? <p role="status" className="mt-4 border-y border-border py-6 text-xs text-muted-foreground">결제 내역을 불러오고 있어요.</p>
          : history === null ? <p className="mt-4 flex flex-wrap items-center gap-3 border-y border-border py-6 text-xs text-muted-foreground">결제 내역을 불러오지 못했어요.<button type="button" onClick={() => { setHistory(undefined); void refresh(); }} className="font-semibold text-primary underline-offset-4 hover:underline">다시 불러오기</button></p>
          : history.length ? <ul className="mt-4 divide-y divide-border border-y border-border">{history.map(item => <HistoryRow key={item.id} payment={item} />)}</ul>
          : <p className="mt-4 border-y border-border py-6 text-xs text-muted-foreground">아직 결제 내역이 없어요.</p>}
      </section>

      <QuietNote>결제창은 토스페이먼츠가 열고, 카드 번호 같은 결제 정보는 비포어스에 저장되지 않아요. 결제가 궁금하면 <Link to="/contact" className="font-semibold text-primary underline-offset-4 hover:underline">문의하기</Link>로 알려 주세요.</QuietNote>
    </section>
  );
}

function PriceSheet({ label, amount, unit, body, children }: { label: string; amount: number; unit?: string; body: string; children: ReactNode }) {
  return (
    <Sheet className="flex flex-col p-6 sm:p-8">
      <p className="text-xs font-semibold text-accent">{label}</p>
      <p className="mt-5 text-[34px] font-semibold leading-none tabular-nums">{amount.toLocaleString("ko-KR")}<span className="ml-1 text-base font-medium text-muted-foreground">원{unit ? ` · ${unit}` : ""}</span></p>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">{body}</p>
      <div className="mt-auto pt-6">{children}</div>
    </Sheet>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">결제할 수 있는지 확인하지 못했어요.<button type="button" onClick={onRetry} className="font-semibold text-primary underline-offset-4 hover:underline">다시 불러오기</button></p>;
}

function HistoryRow({ payment }: { payment: Payment }) {
  const detail = payment.status === "paid" ? (payment.method ? `결제수단 · ${payment.method}` : "")
    : payment.status === "failed" ? failReason(payment.failureCode ?? "", payment.failureMessage ?? "")
    : payment.status === "cancelled" ? `취소 이유 · ${payment.cancelReason ?? "운영진 처리"}` : "";
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-4 text-sm">
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{PAYMENT_KIND_LABEL[payment.kind]} · {won(payment.amount)}</span>{payment.mode === "test" && <TestTag />}</span>
        {detail && <span className="mt-1 block text-xs leading-6 text-muted-foreground">{detail}</span>}
      </span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground"><StatusTag payment={payment} />{kstDateTime(payment.cancelledAt ?? payment.approvedAt ?? payment.createdAt)}</span>
    </li>
  );
}

// 결제수단·약관 칸은 결제사 화면(흰 바탕)이라 어두운 모드에서도 흰 판 위에 둔다.
// 한 화면에 결제 UI를 두 번 그릴 수 없어서, 그리기는 한 번에 하나씩(개발 모드에서 화면이 두 번 열렸다 닫혀도 겹치지 않게) 한다.
let mountQueue: Promise<void> = Promise.resolve();
function CheckoutSheet({ order, onClose }: { order: PaymentOrder; onClose: () => void }) {
  const [ready, setReady] = useState(false);
  const [agreed, setAgreed] = useState(true);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const checkout = useRef<Checkout | null>(null);
  useEffect(() => {
    let alive = true;
    setReady(false); setError("");
    const task = mountQueue.then(async () => {
      if (!alive) return;
      try {
        const mounted = await mountCheckout(order, { methods: "#payment-methods", agreement: "#payment-agreement" }, setAgreed);
        if (!alive) { mounted.destroy(); return; }
        checkout.current = mounted; setReady(true);
      } catch (failure) {
        if (alive) setError((failure as Error).message || "결제수단을 불러오지 못했어요.");
      }
    });
    mountQueue = task;
    return () => { alive = false; checkout.current?.destroy(); checkout.current = null; };
  }, [order.orderId]);
  const pay = async () => {
    if (!checkout.current || paying) return;
    setPaying(true); setError("");
    const message = await checkout.current.pay();
    setPaying(false);
    if (message) setError(message);
  };
  return (
    <Sheet className="p-5 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-accent">{PAYMENT_KIND_LABEL[order.kind]}{order.mode === "test" && <TestTag />}</p>
          <p className="mt-3 text-[30px] font-semibold leading-none tabular-nums">{won(order.amount)}</p>
          <p className="mt-2 text-xs text-muted-foreground">{order.orderName}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose} className={`rounded-full ${interaction}`}>닫기</Button>
      </div>
      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-white">
        {!ready && !error && <p role="status" className="px-5 py-10 text-center text-xs text-[#6B6790]">결제수단을 불러오고 있어요.</p>}
        <div id="payment-methods" />
        <div id="payment-agreement" />
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-destructive/5 p-3 text-xs leading-6 text-destructive">{error}</p>}
      <Button disabled={!ready || !agreed || paying} onClick={() => void pay()} className={`mt-6 h-12 w-full rounded-full px-8 sm:w-auto ${interaction}`}>{paying ? "결제창으로 넘어가는 중…" : `${won(order.amount)} ${order.mode === "test" ? "테스트 결제하기" : "결제하기"}`}</Button>
      {!agreed && <p className="mt-3 text-xs leading-6 text-muted-foreground">필수 약관에 동의하면 결제할 수 있어요.</p>}
      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">결제를 마치면 이 화면으로 돌아와 결과를 확인해요. 결제창을 닫으면 아무것도 결제되지 않아요.</p>
    </Sheet>
  );
}

// ─────────────────────────────────────────────
// 결제창에서 돌아온 화면: 성공(서버 승인) · 실패
export function LivePaymentSuccessPage() {
  return <Member><SuccessView /></Member>;
}
// 같은 주문을 두 번 승인 요청하지 않게(개발 모드에서 화면이 두 번 열려도 한 번만 보낸다). 서버도 한 번만 승인한다.
const confirming = new Map<string, ReturnType<typeof confirmPayment>>();
function SuccessView() {
  const location = useLocation();
  const params = useMemo(() => readSuccessReturn(location.search), [location.search]);
  const [result, setResult] = useState<{ payment: Payment | null; error: string | null } | null>(null);
  const run = (again = false) => {
    if (!params) return;
    if (again) confirming.delete(params.orderId);
    const task = confirming.get(params.orderId) ?? confirmPayment(params);
    confirming.set(params.orderId, task);
    setResult(null);
    void task.then(next => { if (next.error) confirming.delete(params.orderId); setResult({ payment: next.data, error: next.error }); });
  };
  useEffect(() => { run(); }, [params?.orderId]);
  const back = <div className="flex flex-wrap gap-2"><Button asChild className={`h-12 rounded-full px-6 ${interaction}`}><Link to="/payments">결제 화면으로 <ArrowRight size={15} /></Link></Button><Button asChild variant="outline" className={`h-12 rounded-full ${interaction}`}><Link to="/today">오늘로 돌아가기</Link></Button></div>;

  if (!params) return <section className="space-y-8"><PageHeader mark="결제" label="결제 확인" en="PAYMENTS" title="확인할 결제 정보가 없어요." lead="결제창에서 돌아온 주소가 아니에요. 결제 화면에서 다시 시작해 주세요." aside={<TwoDots apart faded />} />{back}</section>;
  if (!result) return <section className="space-y-8"><PageHeader mark="결제" label="결제 확인" en="PAYMENTS" title="결제를 확인하고 있어요." lead="창을 닫지 말고 잠시만 기다려 주세요." aside={<TwoDots apart faded />} /><Waiting label="결제를 확인하고 있어요." /></section>;
  if (result.error || !result.payment) return (
    <section className="space-y-8">
      <PageHeader mark="결제" label="결제 확인" en="PAYMENTS" title="결제를 마치지 못했어요." lead={result.error ?? "결제를 확인하지 못했어요."} aside={<TwoDots apart faded />} />
      {TEST && <TestBanner />}
      <div className="flex flex-wrap gap-2"><Button onClick={() => run(true)} className={`h-12 rounded-full px-6 ${interaction}`}>다시 확인하기</Button><Button asChild variant="outline" className={`h-12 rounded-full ${interaction}`}><Link to="/payments">결제 화면으로</Link></Button></div>
    </section>
  );
  const payment = result.payment;
  const test = payment.mode === "test";
  return (
    <section className="space-y-8">
      <PageHeader mark="결제" label="결제 완료" en="PAYMENTS" title={test ? "테스트 결제가 끝났어요." : "결제가 끝났어요."} lead={test ? `실제로 돈이 나가지 않았어요.${BETA ? " 베타 동안의 소개와 교류에는 아무 변화가 없어요." : ""}` : "결제 내역은 결제 화면에서 언제든 볼 수 있어요."} aside={<TwoDots apart />} />
      <Sheet className="max-w-xl p-6 sm:p-8">
        <dl className="grid grid-cols-[6rem_1fr] gap-y-3 text-sm">
          <dt className="text-muted-foreground">항목</dt><dd className="flex flex-wrap items-center gap-2 font-semibold">{PAYMENT_KIND_LABEL[payment.kind]}{test && <TestTag />}</dd>
          <dt className="text-muted-foreground">금액</dt><dd className="font-semibold tabular-nums">{won(payment.amount)}</dd>
          {payment.method && <><dt className="text-muted-foreground">결제수단</dt><dd>{payment.method}</dd></>}
          <dt className="text-muted-foreground">승인 시각</dt><dd>{kstDateTime(payment.approvedAt)}</dd>
          <dt className="text-muted-foreground">주문 번호</dt><dd className="break-all font-mono text-xs leading-6 text-muted-foreground">{payment.orderId}</dd>
        </dl>
      </Sheet>
      {back}
    </section>
  );
}

export function LivePaymentFailPage() {
  return <Member><FailView /></Member>;
}
function FailView() {
  const location = useLocation();
  const { code, message, orderId } = useMemo(() => readFailReturn(location.search), [location.search]);
  // 결제 전 주문을 ‘결제 안 됨’으로 남긴다(돈이 나가지 않은 주문만 바뀐다).
  useEffect(() => { if (orderId) void markPaymentFailed(orderId, code, message); }, [orderId]);
  const stopped = code === "PAY_PROCESS_CANCELED" || code === "USER_CANCEL";
  return (
    <section className="space-y-8">
      <PageHeader mark="결제" label="결제 안 됨" en="PAYMENTS" title={stopped ? "결제를 멈췄어요." : "결제가 되지 않았어요."} lead={`${failReason(code, message)} 승인되지 않아서 돈은 나가지 않았어요.`} aside={<TwoDots apart faded />} />
      {TEST && <TestBanner />}
      <div className="flex flex-wrap gap-2"><Button asChild className={`h-12 rounded-full px-6 ${interaction}`}><Link to="/payments">다시 시도하기 <ArrowRight size={15} /></Link></Button><Button asChild variant="outline" className={`h-12 rounded-full ${interaction}`}><Link to="/today">오늘로 돌아가기</Link></Button></div>
      {code && <p className="text-[11px] text-muted-foreground">문의할 때 알려 주시면 빨라요 · 오류 코드 {code}</p>}
    </section>
  );
}
