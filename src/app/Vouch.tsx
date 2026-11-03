import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowUpRight, Check, Link2 } from "lucide-react";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Sheet } from "./editorial";
import { LIVE, rpc } from "./backend/client";
import { kstDay } from "./dates";
import { BEFORE_US } from "./config";

// 친구 추천사(5200): 회원이 만든 링크로 친구가 로그인 없이 ‘이 친구는 이런 사람이에요’ 한 줄과 관계만 남긴다.
// 친구의 이름·연락처는 받지 않는다. 회원 본인과 운영진만 읽고(소개할 분을 고를 때 참고), 소개된 상대에게는 보이지 않는다.
// 링크 화면은 회원이 누구인지 알려 주지 않는다(링크를 받은 친구는 이미 안다).
const interaction = "transition-colors duration-200 motion-reduce:transition-none";
const LEAF = "https://images.unsplash.com/photo-1530651796427-6edd0e06319e?auto=format&fit=crop&w=1200&q=70";
const RELATIONS = ["오랜 친구", "학교 친구", "직장 동료", "가족"] as const;
const BODY_MIN = 10, BODY_MAX = 150, RELATION_MAX = 20, VOUCH_MAX = 3;
const count = (text: string) => Array.from(text.trim()).length;
const stamp = () => { const now = new Date(Date.now() + 9 * 3600000); return `${now.getUTCMonth() + 1}월 ${now.getUTCDate()}일`; };

type LinkState = "loading" | "ok" | "expired" | "full" | "missing" | "error";
const CLOSED: Record<Exclude<LinkState, "loading" | "ok">, { title: string; body: string }> = {
  expired: { title: "링크 기한이 지났어요.", body: "추천사 링크는 14일 동안 열려 있어요. 친구에게 새 링크를 부탁해 주세요." },
  full: { title: "이미 충분히 받았어요.", body: "이 친구는 추천사를 모두 받았어요. 써 주려던 마음만 고맙게 받을게요." },
  missing: { title: "링크를 찾을 수 없어요.", body: "링크가 닫혔거나 주소가 조금 달라요. 친구에게 링크를 다시 받아 주세요." },
  error: { title: "링크를 확인하지 못했어요.", body: "잠시 뒤 다시 열어 주세요." },
};

export function VouchPage() {
  const { token = "" } = useParams();
  const [state, setState] = useState<LinkState>(LIVE ? "loading" : "ok");
  const [relation, setRelation] = useState<string>(RELATIONS[0]);
  const [custom, setCustom] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  useEffect(() => { document.title = `친구 추천사 · ${BEFORE_US.brand.name}`; }, []);
  useEffect(() => {
    if (!LIVE) return;
    void rpc<{ ok: boolean; reason: LinkState | null }>("vouch_info", { p_token: token }).then(result => setState(result.error || !result.data ? "error" : result.data.ok ? "ok" : result.data.reason ?? "missing"));
  }, [token]);
  const length = count(body);
  const relationText = relation.trim();
  const ready = length >= BODY_MIN && length <= BODY_MAX && relationText.length > 0 && count(relationText) <= RELATION_MAX;
  const send = async () => {
    if (!LIVE) { setError("실제 서비스에서 남길 수 있어요."); return; }
    setSending(true); setError("");
    const result = await rpc("vouch_write", { p_token: token, p_relation: relationText, p_body: body });
    setSending(false);
    if (result.error) { setError(result.error); return; }
    setSent(body.trim());
  };
  const closed = state !== "loading" && state !== "ok" ? CLOSED[state] : null;
  return <div className="break-keep [overflow-wrap:anywhere] pb-20">
    <div className="grid gap-12 pt-16 sm:pt-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-16">
      <header className="lg:sticky lg:top-10">
        <div className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2"><span aria-hidden="true" className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" /><span className="size-2 rounded-full bg-accent" /></span><span aria-hidden="true" className="h-px w-8 bg-accent/40" /><span className="text-xs font-semibold">친구 추천사</span><span className="text-[10px] tracking-[0.16em] text-muted-foreground">FROM A FRIEND</span></div>
        <h1 className="text-ink text-3xl font-semibold leading-[1.4] sm:text-[38px]">친구가 당신에게,<br />한 줄을 부탁했어요.</h1>
        <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">{BEFORE_US.brand.name}는 사람이 직접 읽고 한 번에 한 분만 소개하는 1:1 소개 서비스예요. 친구를 오래 봐 온 당신의 한 줄이, 친구에게 어울리는 사람을 고를 때 큰 도움이 돼요.</p>
        <ul className="mt-8 space-y-3 text-sm">
          {["친구와 플라비만 읽어요.", "소개받는 상대에게는 보이지 않아요.", "이름·연락처 없이, 관계와 한 줄만 받아요."].map(item => <li key={item} className="flex items-start gap-3"><span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Check size={12} strokeWidth={2.4} /></span>{item}</li>)}
        </ul>
      </header>
      <div className="relative isolate overflow-hidden rounded-3xl border border-border bg-[#FBFAF7] p-6 text-[#24212F] shadow-[0_30px_60px_-40px_rgba(30,20,80,0.55)] dark:bg-[#1E1C2A] dark:text-white sm:p-10">
        <img src={LEAF} alt="" aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-25 mix-blend-multiply dark:opacity-10 dark:mix-blend-soft-light" />
        <div className="flex items-start justify-between gap-4"><p className="text-[11px] font-semibold tracking-[0.12em] opacity-60">{sent ? "보낸 한 줄" : "한 줄 추천사"}</p><span aria-hidden="true" className="grid size-16 shrink-0 place-items-center rounded-full border-2 border-current text-center text-[10px] font-semibold leading-4 opacity-30">정오<br />{stamp()}</span></div>
        {state === "loading" ? <p role="status" className="mt-8 text-sm opacity-70">링크를 확인하고 있어요.</p>
          : closed ? <div className="mt-6"><h2 className="text-2xl font-semibold leading-[1.5]">{closed.title}</h2><p className="mt-3 text-sm leading-7 opacity-75">{closed.body}</p><Explore /></div>
          : sent ? <div className="mt-6" role="status">
            <blockquote className="letter-drop text-xl font-semibold leading-[1.7] sm:text-2xl">“{sent}”</blockquote>
            <p className="mt-3 text-xs opacity-60">{relationText}의 한 줄</p>
            <div className="mt-10 border-t border-black/10 pt-6 dark:border-white/15"><p className="text-base font-semibold">고마워요. 친구에게 잘 전할게요.</p><p className="mt-2 text-sm leading-7 opacity-75">친구가 받은 한 줄을 읽어 볼 수 있고, {BEFORE_US.brand.name}는 친구에게 어울리는 분을 고를 때 참고해요.</p><Explore /></div>
          </div>
          : <div className="mt-6 space-y-6">
            <fieldset><legend className="text-xs font-semibold">친구와 나는</legend>
              <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="친구와의 관계">
                {RELATIONS.map(item => <button key={item} type="button" role="radio" aria-checked={!custom && relation === item} onClick={() => { setCustom(false); setRelation(item); }} className={`rounded-full border px-3.5 py-2 text-xs ${interaction} ${!custom && relation === item ? "border-primary bg-card font-semibold text-primary" : "border-black/10 bg-white/70 hover:border-primary/40 dark:border-white/15 dark:bg-white/5"}`}>{item}</button>)}
                <button type="button" role="radio" aria-checked={custom} onClick={() => { setCustom(true); setRelation(""); }} className={`rounded-full border px-3.5 py-2 text-xs ${interaction} ${custom ? "border-primary bg-card font-semibold text-primary" : "border-black/10 bg-white/70 hover:border-primary/40 dark:border-white/15 dark:bg-white/5"}`}>직접 쓰기</button>
              </div>
              {custom && <input aria-label="관계 직접 쓰기" autoFocus value={relation} maxLength={RELATION_MAX} onChange={event => setRelation(event.target.value)} placeholder="예: 동네 러닝 메이트" className="mt-3 h-11 w-full rounded-xl border border-black/10 bg-white/80 px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15 dark:bg-white/5 md:text-sm" />}
            </fieldset>
            <div>
              <label htmlFor="vouch-body" className="text-xs font-semibold">이 친구는 이런 사람이에요</label>
              <Textarea id="vouch-body" value={body} maxLength={BODY_MAX} onChange={event => { setBody(event.target.value); setError(""); }} placeholder="예: 약속 장소에 늘 먼저 와서, 늦는 사람을 웃으며 기다려 주는 친구예요." className="mt-3 min-h-32 rounded-2xl border-black/10 bg-white/80 text-[15px] leading-7 dark:border-white/15 dark:bg-white/5" />
              <div className="mt-2 flex items-start justify-between gap-3 text-[11px] leading-5 opacity-60"><p>친구 이름과 연락처는 적지 않아 주세요.</p><span className="shrink-0 tabular-nums">{length} / {BODY_MAX}</span></div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-5 dark:border-white/15">
              <p className="text-[11px] leading-5 opacity-60">{BODY_MIN}~{BODY_MAX}자 · 보내면 고칠 수 없어요</p>
              <Button disabled={!ready || sending} onClick={() => void send()} className={`h-11 rounded-full px-6 ${interaction}`}>{sending ? "보내는 중…" : "한 줄 보내기"}</Button>
            </div>
            {error && <p role="alert" className="text-xs leading-6 text-destructive">{error}</p>}
          </div>}
        <div aria-hidden="true" className="mt-10 flex items-center justify-end gap-2"><span className="text-[10px] font-semibold tracking-[0.2em] opacity-60">FLAVIE</span><span className="flex"><span className="size-2.5 rounded-full bg-[#5B4FCF]" /><span className="-ml-1 size-2.5 rounded-full bg-[#3560C0]/85" /></span></div>
      </div>
    </div>
  </div>;
}

function Explore() {
  return <Button asChild variant="outline" className={`mt-6 h-10 rounded-full border-black/15 bg-white/70 px-4 text-xs dark:border-white/20 dark:bg-white/5 ${interaction}`}><Link to="/">{BEFORE_US.brand.name} 둘러보기 <ArrowUpRight size={14} /></Link></Button>;
}

// ── 내 정보: 추천사 링크 만들기·보내기와 받은 한 줄(최대 세 개)
type MyVouches = { link: { token: string; expiresAt: string; expired: boolean } | null; vouches: { id: string; relation: string; body: string; at: string }[]; max: number };
export function VouchCard() {
  const [data, setData] = useState<MyVouches | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const load = async () => { const result = await rpc<MyVouches>("my_vouches"); if (result.data) setData(result.data); else if (result.error) setMessage(result.error); };
  useEffect(() => { void load(); }, []);
  if (!data) return message ? <Sheet id="vouch" className="scroll-mt-24 p-6"><p role="status" className="text-xs text-muted-foreground">{message}</p></Sheet> : null;
  const full = data.vouches.length >= (data.max || VOUCH_MAX);
  const url = data.link && !data.link.expired ? `${window.location.origin}/vouch/${data.link.token}` : "";
  const make = async () => { setBusy(true); const result = await rpc<{ token: string; expiresAt: string }>("vouch_link"); setBusy(false); if (result.error) { setMessage(result.error); return; } setMessage("링크를 만들었어요. 친구에게 보내 주세요."); await load(); };
  const share = async () => {
    const touch = window.matchMedia?.("(pointer: coarse)").matches;
    if (touch && navigator.share) { try { await navigator.share({ title: `${BEFORE_US.brand.name} 친구 추천사`, text: "나에 대해 한 줄만 써 줄래? 나에게 어울리는 사람을 고를 때 참고한대.", url }); return; } catch { return; } }
    try { await navigator.clipboard.writeText(url); setMessage("링크를 복사했어요. 친구에게 보내 주세요."); } catch { setMessage(url); }
  };
  const close = async () => { const result = await rpc("vouch_close"); setMessage(result.error || "링크를 닫았어요. 이제 이 링크로는 남길 수 없어요."); await load(); };
  const remove = async (id: string) => { const result = await rpc("vouch_delete", { p_id: id }); setAsking(null); setMessage(result.error || "추천사를 지웠어요."); await load(); };
  return <Sheet id="vouch" className="scroll-mt-24 p-6 sm:p-8">
    <div className="flex flex-wrap items-start justify-between gap-3"><p className="text-xs font-semibold text-accent">친구 추천사</p><span className="rounded-full bg-mist px-2.5 py-1 text-[11px] leading-none text-muted-foreground tabular-nums">{data.vouches.length} / {data.max || VOUCH_MAX}</span></div>
    <h2 className="mt-3 text-xl font-semibold leading-[1.5]">친구가 써 주는, 나에 대한 한 줄.</h2>
    <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">링크를 보내면 친구가 ‘이 친구는 이런 사람이에요’ 한 줄을 남겨 줘요. 나와 운영진만 읽고, 소개할 분을 고를 때 참고해요. 소개받는 상대에게는 보이지 않아요.</p>
    {full ? <p className="mt-5 rounded-xl bg-mist p-4 text-xs leading-6 text-muted-foreground">세 개를 모두 받았어요. 하나를 지우면 다시 받을 수 있어요.</p>
      : url ? <div className="mt-5 rounded-2xl border border-lilac bg-mist p-4">
        <div className="flex flex-wrap items-center gap-3"><span className="min-w-0 flex-1 truncate rounded-xl bg-card px-3 py-2 text-xs text-muted-foreground" title={url}>{url}</span><Button onClick={() => void share()} className={`h-10 shrink-0 rounded-xl px-4 text-xs ${interaction}`}><Link2 size={14} />링크 보내기</Button></div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>{kstDay(data.link!.expiresAt)}까지 열려 있어요 · 친구 여러 명에게 보내도 돼요</span><button type="button" onClick={() => void close()} className={`text-[11px] hover:text-foreground ${interaction}`}>링크 닫기</button></div>
      </div>
      : <div className="mt-5 flex flex-wrap items-center gap-3">{data.link?.expired && <p className="text-xs text-muted-foreground">링크 기한이 지났어요.</p>}<Button disabled={busy} onClick={() => void make()} className={`h-11 rounded-xl px-5 ${interaction}`}>{busy ? "만드는 중…" : data.link?.expired ? "새 링크 만들기" : "링크 만들기"}</Button><span className="text-[11px] text-muted-foreground">14일 동안 열려 있어요</span></div>}
    {data.vouches.length > 0 && <ul className="mt-6 space-y-3">{data.vouches.map(item => <li key={item.id} className="rounded-2xl border border-border bg-card px-5 py-4">
      <blockquote className="text-[15px] leading-7">“{item.body}”</blockquote>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>{item.relation} · {kstDay(item.at)}</span>{asking === item.id ? <span className="inline-flex items-center gap-2"><span>지울까요?</span><button type="button" onClick={() => void remove(item.id)} className="text-[11px] font-semibold text-destructive">지우기</button><button type="button" onClick={() => setAsking(null)} className="text-[11px]">취소</button></span> : <button type="button" onClick={() => setAsking(item.id)} className={`text-[11px] hover:text-foreground ${interaction}`}>지우기</button>}</div>
    </li>)}</ul>}
    {message && <p role="status" className="mt-3 break-all text-xs text-primary">{message}</p>}
  </Sheet>;
}
