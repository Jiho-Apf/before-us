import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { ArrowDown, ArrowLeft, ArrowUpRight, Mail, MailOpen, PenLine } from "lucide-react";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { LIVE, rpc } from "./backend/client";
import { useAuth } from "./auth-service";
import { AliasSeal, CrisisNote, PaperBackdrop, ReportButton, SLIP, SectionLabel, Wave, ago, interaction, kstMonthDay, useMessage, useNoonCountdown } from "./community";

// 고민 편지함(/mailbox · 서버 5100): 고민은 이름 없이 글로 올리고(누구나 읽기), 답은 댓글이 아니라 편지로만 받는다.
// 글마다 편지가 몇 통 왔는지만 보이고, 편지는 고민을 쓴 분만 읽는다. 편지는 쓴 다음 정오에 도착한다.
// 받은 편지에는 횟수 제한 없이 답장을 주고받고, 주고받는 곳은 내 정보 > 고민 편지함(MailboxCard)이다.
export type Topic = "love" | "people" | "work" | "mind";
export const TOPICS: Record<Topic, string> = { love: "연애", people: "관계", work: "일·공부", mind: "마음" };
const TOPIC_IDS = Object.keys(TOPICS) as Topic[];
export type WorryPost = { id: string; alias: string; topic: Topic; body: string; at: string; closesAt: string; open: boolean; mine: boolean; letters: number; sent: boolean };
type Board = { signedIn: boolean; canPost: boolean; posts: WorryPost[] };
type Letter = { id: string; mine: boolean; body: string; at: string; deliverAt: string; delivered: boolean; read: boolean };
type Thread = { id: string; role: "author" | "writer"; closed: boolean; closedBy: "author" | "writer" | "report" | "operator" | null; partner: string; post: { id: string; topic: Topic; body: string | null; at: string; hidden: boolean }; letters: Letter[] };
type ThreadRow = { id: string; partner?: string; topic?: Topic; post?: string; closed: boolean; unread: number; lastAt: string | null; last: string | null; waiting?: number };
type Mailbox = { posts: { id: string; topic: Topic; body: string; at: string; open: boolean; hidden: boolean; threads: ThreadRow[] }[]; sent: ThreadRow[] };
const POST_MAX = 600, LETTER_MAX = 1000;
const RULES = "이름 대신 글마다 별명이 붙어요. 연락처·SNS·이름처럼 누구인지 알 수 있는 내용, 소개받은 분이나 특정한 사람 이야기는 쓰지 않아요. 고민 글은 서로 다른 세 분이 신고하면 바로 가려지고, 30일 뒤 지워져요.";
const arrives = () => new Date(Date.now() + 9 * 3600000).getUTCHours() < 12 ? "오늘 정오" : "내일 정오";
const count = (text: string) => Array.from(text.trim()).length;

export default function WorryBoard() {
  const session = useAuth();
  const location = useLocation();
  const [topic, setTopic] = useState<Topic | "all">("all");
  const [board, setBoard] = useState<Board | { error: string } | null>(LIVE ? null : { signedIn: false, canPost: false, posts: [] });
  const load = async () => { const result = await rpc<Board>("worry_board", { p_topic: topic === "all" ? null : topic }); setBoard(result.data ?? { error: result.error || "고민을 불러오지 못했어요." }); };
  useEffect(() => { if (LIVE) void load(); }, [topic, !!session]);
  // 서랍에서 고른 고민(#post-…)으로 바로 간다.
  useEffect(() => { if (board && "posts" in board && location.hash.startsWith("#post-")) window.setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "center" }), 150); }, [!!board && "posts" in board]);
  const ready = board && "posts" in board ? board : null;
  const compose = () => { document.getElementById("board")?.scrollIntoView({ behavior: "smooth", block: "start" }); window.setTimeout(() => (document.getElementById("worry-compose") as HTMLTextAreaElement | null)?.focus({ preventScroll: true }), 600); };
  return <div className="break-keep [overflow-wrap:anywhere]">
    <MailboxHero posts={ready?.posts ?? null} onWrite={compose} />
    <section id="board" className="scroll-mt-20 pt-16 pb-20 sm:pt-20 sm:pb-24" aria-labelledby="board-title">
      <SectionLabel number="01" ko="고민">WORRIES</SectionLabel>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h2 id="board-title" className="text-ink text-3xl font-semibold leading-[1.45] sm:text-[34px]">마음에 걸린 일을,<br />이름 없이.</h2>
        <div className="flex max-w-full gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label="주제">{(["all", ...TOPIC_IDS] as const).map(id => <button key={id} type="button" role="radio" aria-checked={topic === id} onClick={() => setTopic(id)} className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs ${interaction} ${topic === id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"}`}>{id === "all" ? "전체" : TOPICS[id]}</button>)}</div>
      </div>
      <div className="mt-10">
        {!LIVE ? <p className="rounded-3xl border border-dashed border-border p-6 text-sm leading-7 text-muted-foreground">고민과 편지는 실제 서비스에서 주고받을 수 있어요.</p>
          : !board ? <p role="status" className="text-xs text-muted-foreground">고민을 불러오고 있어요.</p>
          : "error" in board ? <p role="status" className="text-xs leading-6 text-muted-foreground">{board.error} <button type="button" onClick={() => void load()} className="text-xs font-semibold text-primary underline-offset-4 hover:underline">다시 불러오기</button></p>
          : <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
            <Composer board={board} onPosted={load} />
            {board.posts.map(post => <PostCard key={post.id} post={post} signedIn={board.signedIn} onChanged={load} />)}
            {!board.posts.length && <p className="mb-4 break-inside-avoid rounded-[22px] border border-dashed border-border p-6 text-xs leading-6 text-muted-foreground">{topic === "all" ? "아직 올라온 고민이 없어요. 첫 고민을 남겨 보세요." : `${TOPICS[topic]} 고민은 아직 없어요.`}</p>}
          </div>}
      </div>
      <p className="mt-8 max-w-3xl text-[11px] leading-5 text-muted-foreground">{RULES}</p>
      <CrisisNote className="mt-2 max-w-3xl" />
    </section>
    <p className="mb-20 border-t border-border pt-6 text-xs leading-6 text-muted-foreground">하루 한 질문에 가볍게 답하고 싶다면 <Link to="/drawer" className="font-semibold text-primary underline-offset-4 hover:underline">정오의 서랍</Link>에 들러 보세요. 받은 편지와 답장은 <Link to="/profile#mailbox" className="font-semibold text-primary underline-offset-4 hover:underline">내 정보 &gt; 고민 편지함</Link>에 모여요.</p>
  </div>;
}

// 첫 화면: 버터 노랑 종이 위 잎 그림자 · 오른쪽에는 편지를 기다리는 고민 봉투(진짜 글만 · 없으면 빈 봉투 하나)
function MailboxHero({ posts, onWrite }: { posts: WorryPost[] | null; onWrite: () => void }) {
  const clock = useNoonCountdown();
  const open = (posts ?? []).filter(post => post.open).slice(0, 3);
  return <section className="bleed relative isolate overflow-clip" aria-labelledby="mailbox-title">
    <PaperBackdrop tint="butter" />
    <div className="relative grid gap-12 pt-14 pb-28 sm:pt-20 sm:pb-32 lg:grid-cols-[7fr_5fr] lg:items-center lg:gap-10 lg:pb-36">
      <div className="relative z-10">
        <p className="-mt-3 mb-9 inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-1 text-xs font-semibold text-ink ring-1 ring-black/5 backdrop-blur-sm dark:bg-white/10 dark:ring-white/15 sm:-mt-4 sm:mb-10"><Mail size={13} aria-hidden="true" className="text-primary" />고민 편지함 · 정오에 답장이 와요</p>
        <h1 id="mailbox-title" className="text-ink text-[clamp(2.4rem,5vw,4rem)] font-semibold leading-[1.22] tracking-[-0.02em]">고민은 글로,<br />답장은 편지로.</h1>
        <ul className="mt-7 flex flex-wrap gap-2" aria-label="고민 편지함의 약속">{["이름 없이", "댓글 대신 편지만", "편지는 다음 정오에 도착", "고민을 쓴 분만 읽어요"].map(point => <li key={point} className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-medium text-ink ring-1 ring-black/5 backdrop-blur-sm dark:bg-white/10 dark:ring-white/15">{point}</li>)}</ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={onWrite} className={`h-12 rounded-full px-6 ${interaction}`}><PenLine size={16} />고민 남기기</Button>
          <Button asChild variant="outline" className={`h-12 rounded-full border-ink/15 bg-white/60 px-5 backdrop-blur-sm hover:bg-white dark:bg-transparent ${interaction}`}><Link to="/drawer">정오의 서랍 <ArrowUpRight size={16} /></Link></Button>
        </div>
        <div className="mt-12 w-full max-w-[17rem]">
          <p className="text-xs text-muted-foreground">다음 배달까지</p>
          <p className="text-ink mt-1.5 text-[2.5rem] font-extralight leading-none tracking-[-0.02em] tabular-nums" role="timer" aria-label={`다음 배달까지 ${clock.text}`}>{clock.text}</p>
          <div aria-hidden="true" className="mt-4 h-px bg-ink/10"><div className="h-px bg-primary" style={{ width: `${clock.filled}%` }} /></div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">지금 쓴 편지는 {arrives()}에 도착해요.</p>
        </div>
      </div>
      <div className="relative z-10 lg:flex lg:items-center lg:justify-end">
        <div className="hero-float mx-auto flex w-full max-w-[420px] flex-col gap-3 lg:ml-auto lg:mr-0" aria-label="편지를 기다리는 고민">
          {!LIVE ? <div className={`rounded-[22px] p-6 text-sm leading-7 text-ink ${SLIP}`}>고민과 편지는 실제 서비스에서 주고받을 수 있어요.</div>
            : posts === null ? <div className={`h-36 animate-pulse rounded-[22px] ${SLIP}`} />
            : open.length ? open.map((post, index) => <a key={post.id} href={`#post-${post.id}`} onClick={event => { event.preventDefault(); document.getElementById(`post-${post.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className={`letter-drop relative block rounded-[22px] p-5 pr-20 ${SLIP} ${["lg:rotate-[0.9deg]", "lg:-ml-10 lg:-rotate-[1deg]", "lg:ml-6 lg:rotate-[0.3deg]"][index]}`} style={{ animationDelay: `${0.7 + index * 0.45}s` }}>
              <Postmark at={post.at} />
              <p className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="font-semibold text-primary">{TOPICS[post.topic]}</span><span>{post.alias}</span></p>
              <p className="text-ink mt-2 line-clamp-2 text-sm leading-7">{post.body}</p>
              <p className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink/70"><Mail size={12} aria-hidden="true" />{post.letters ? `편지 ${post.letters}통` : "첫 편지를 기다려요"}</p>
            </a>)
            : <button type="button" onClick={onWrite} className={`letter-drop relative rounded-[22px] border border-dashed border-ink/20 p-6 pr-20 text-left ${SLIP}`} style={{ animationDelay: "0.7s" }}><Postmark /><span className="block text-[11px] font-semibold text-muted-foreground">비어 있는 봉투</span><span className="text-ink mt-3 block text-base font-semibold leading-7">마음에 걸린 일을 이름 없이 남겨 보세요.</span><span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">고민 쓰기 <ArrowDown size={13} /></span></button>}
        </div>
      </div>
    </div>
    <Wave />
  </section>;
}
// 정오 소인(편지지 가게와 같은 모양)
function Postmark({ at }: { at?: string }) {
  return <span aria-hidden="true" className="absolute right-4 top-4 grid size-14 place-items-center rounded-full border-2 border-ink/25 text-center text-[9px] font-semibold leading-[1.35] text-ink/45">정오<br />{at ? kstMonthDay(at).replace("월 ", ".").replace("일", "") : "12:00"}</span>;
}

function Composer({ board, onPosted }: { board: Board; onPosted: () => Promise<void> }) {
  const [topic, setTopic] = useState<Topic | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useMessage();
  const slip = "mb-4 break-inside-avoid rounded-[22px]";
  if (!board.signedIn) return <div className={`${slip} border border-dashed border-primary/30 bg-primary/[0.03] p-6`}><p className="text-[11px] font-semibold text-primary">나의 고민</p><p className="mt-3 text-sm leading-7">로그인하면 고민을 이름 없이 남기고, 다른 분의 고민에 편지를 보낼 수 있어요. 읽는 건 누구나 할 수 있어요.</p><Button asChild variant="outline" className="mt-4 h-10 rounded-full border-border bg-card px-4 text-xs"><Link to="/login">로그인하기</Link></Button></div>;
  if (!board.canPost) return <p className={`${slip} bg-muted p-5 text-xs leading-6 text-muted-foreground`}>지금 계정 상태에서는 고민을 남길 수 없어요.</p>;
  const length = count(body);
  const send = async () => { if (!topic) { setMessage("주제를 골라 주세요."); return; } setBusy(true); const result = await rpc<string>("worry_post", { p_topic: topic, p_body: body }); setBusy(false); if (result.error) { setMessage(result.error); return; } setBody(""); setTopic(null); setMessage("이름 없이 올렸어요. 편지는 내 정보 > 고민 편지함에서 읽어요."); await onPosted(); };
  return <div className={`${slip} border border-primary/25 bg-card p-5 shadow-[0_18px_40px_-32px_rgba(40,24,100,0.5)]`}>
    <p className="text-[11px] font-semibold text-primary">나의 고민</p>
    <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="고민 주제">{TOPIC_IDS.map(id => <button key={id} type="button" role="radio" aria-checked={topic === id} onClick={() => setTopic(id)} className={`rounded-full border px-3 py-1 text-xs ${interaction} ${topic === id ? "border-primary font-semibold text-primary" : "border-border hover:border-primary/40"}`}>{TOPICS[id]}</button>)}</div>
    <Textarea id="worry-compose" aria-label="고민 쓰기" value={body} maxLength={POST_MAX} onChange={event => setBody(event.target.value)} placeholder="요즘 마음에 걸린 일을 편하게 적어 주세요. 누구인지 알 수 있는 내용은 빼 주세요." className="mt-3 min-h-32 resize-none rounded-xl border-0 bg-mist px-3.5 text-[15px] leading-7 shadow-none focus-visible:ring-2" />
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] tabular-nums text-muted-foreground">{length} / {POST_MAX}</span><Button disabled={busy || length < 10} onClick={() => void send()} className="h-9 rounded-full px-4 text-xs">{busy ? "올리는 중…" : "이름 없이 올리기"}</Button></div>
    <p className="mt-3 text-[11px] leading-5 text-muted-foreground">누구나 읽을 수 있고, 답은 편지로만 와요. 7일 동안 편지를 받아요.</p>
    <CrisisNote className="mt-1.5" />
    {message && <p role="status" className="mt-2 text-xs text-primary">{message}</p>}
  </div>;
}

function PostCard({ post, signedIn, onChanged }: { post: WorryPost; signedIn: boolean; onChanged: () => Promise<void> }) {
  const [writing, setWriting] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(post.sent);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState("");
  const daysLeft = Math.max(1, Math.ceil((Date.parse(post.closesAt) - Date.now()) / 86400000));
  const send = async () => { setBusy(true); const result = await rpc("worry_send_letter", { p_post: post.id, p_body: body }); setBusy(false); if (result.error) { setMessage(result.error); return; } setSent(true); setWriting(false); setBody(""); setMessage(`편지를 보냈어요. ${arrives()}에 도착해요.`); await onChanged(); };
  const remove = async () => { const result = await rpc("worry_delete_post", { p_id: post.id }); if (result.error) { setMessage(result.error); return; } await onChanged(); };
  return <article id={`post-${post.id}`} className={`mb-4 break-inside-avoid scroll-mt-24 rounded-[22px] border p-5 shadow-[0_18px_40px_-34px_rgba(40,24,100,0.45)] ${post.mine ? "border-primary/25 bg-primary/[0.035]" : "border-border bg-card"}`}>
    <header className="flex items-center gap-2.5"><AliasSeal alias={post.alias} /><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold">{post.alias}{post.mine && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">내 고민</span>}</p><p className="text-[11px] text-muted-foreground">{ago(post.at)}</p></div><span className="shrink-0 rounded-full bg-mist px-2.5 py-1 text-[11px] font-semibold text-primary">{TOPICS[post.topic]}</span></header>
    <p className="mt-3.5 whitespace-pre-wrap text-[15px] leading-7">{post.body}</p>
    <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-3">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground/75"><Mail size={13} aria-hidden="true" className="text-primary" />{post.letters ? `편지 ${post.letters}통` : "아직 편지가 없어요"}</span>
      <span className="text-[11px] text-muted-foreground">{post.open ? `${daysLeft}일 더 편지를 받아요` : "편지를 받는 기간이 끝났어요"}</span>
      <span className="ml-auto flex items-center gap-3">{post.mine ? removing ? <span className="inline-flex items-center gap-2 text-[11px]"><span className="text-muted-foreground">받은 편지도 함께 사라져요.</span><button type="button" onClick={() => void remove()} className="text-[11px] font-semibold text-destructive">지우기</button><button type="button" onClick={() => setRemoving(false)} className="text-[11px] text-muted-foreground">취소</button></span> : <><Link to="/profile#mailbox" className="text-[11px] font-semibold text-primary">받은 편지 읽기</Link><button type="button" onClick={() => setRemoving(true)} className="text-[11px] text-muted-foreground hover:text-foreground">지우기</button></> : signedIn && <ReportButton onReport={async () => { const result = await rpc<string>("worry_report", { p_kind: "post", p_id: post.id }); return result.error || result.data || "신고를 받았어요."; }} />}</span>
    </footer>
    {!post.mine && post.open && (sent ? <p className="mt-3 rounded-xl bg-mist px-4 py-3 text-xs leading-6">편지를 보냈어요. 이어지는 편지는 <Link to="/profile#mailbox" className="font-semibold text-primary underline-offset-4 hover:underline">내 정보 &gt; 고민 편지함</Link>에서 주고받아요.</p>
      : !signedIn ? <p className="mt-3 text-xs text-muted-foreground"><Link to="/login" className="font-semibold text-primary underline-offset-4 hover:underline">로그인</Link>하면 이 고민에 편지를 보낼 수 있어요.</p>
      : writing ? <div className="mt-3 rounded-2xl border border-[#E9E2CC] bg-[#FDFBF4] p-4 dark:border-white/10 dark:bg-[#1F1D2E]">
        <label htmlFor={`letter-${post.id}`} className="text-[11px] font-semibold text-[#6B5A2E] dark:text-[#E9D9A6]">{post.alias} 님께 보내는 편지</label>
        <Textarea id={`letter-${post.id}`} value={body} maxLength={LETTER_MAX} onChange={event => setBody(event.target.value)} placeholder="천천히, 내 이야기처럼 적어 주세요." className="mt-2 min-h-32 resize-none border-0 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_27px,rgba(120,100,40,0.14)_27px,rgba(120,100,40,0.14)_28px)] bg-transparent px-0 text-[15px] leading-7 shadow-none focus-visible:ring-0" />
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">고민을 쓴 분만 읽어요 · {arrives()}에 도착해요</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] tabular-nums text-muted-foreground">{count(body)} / {LETTER_MAX}</span><span className="flex gap-2"><Button variant="ghost" onClick={() => setWriting(false)} className="h-9 rounded-full px-3 text-xs text-muted-foreground">그만 쓰기</Button><Button disabled={busy || count(body) < 5} onClick={() => void send()} className="h-9 rounded-full px-4 text-xs"><Mail size={13} />{busy ? "보내는 중…" : "편지 보내기"}</Button></span></div>
      </div>
      : <Button variant="outline" onClick={() => setWriting(true)} className="mt-3 h-10 w-full rounded-full border-border text-xs"><PenLine size={13} />이 고민에 편지 쓰기</Button>)}
    {message && <p role="status" className="mt-2 text-xs text-primary">{message}</p>}
  </article>;
}

// ── 내 정보 > 고민 편지함: 내 고민에 온 편지 · 내가 보낸 편지. 한 묶음을 열면 편지가 차례로 보이고 답장을 이어 쓴다.
export function MailboxCard() {
  const location = useLocation();
  const [box, setBox] = useState<Mailbox | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"posts" | "sent">("posts");
  const [thread, setThread] = useState<string | null>(null);
  const load = async () => { const result = await rpc<Mailbox>("worry_mailbox"); if (result.error || !result.data || !Array.isArray(result.data.posts)) { setError(result.error || "편지함을 불러오지 못했어요."); return; } setError(""); setBox(result.data); };
  useEffect(() => { if (LIVE) void load(); }, []);
  useEffect(() => { if (box && location.hash === "#mailbox") window.setTimeout(() => document.getElementById("mailbox")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150); }, [!!box]);
  if (!LIVE) return null;
  const unread = (rows: ThreadRow[]) => rows.reduce((sum, row) => sum + row.unread, 0);
  const postsUnread = box ? unread(box.posts.flatMap(post => post.threads)) : 0;
  const sentUnread = box ? unread(box.sent) : 0;
  const empty = box && !box.posts.length && !box.sent.length;
  return <section id="mailbox" aria-labelledby="mailbox-card-title" className="scroll-mt-24 rounded-3xl border border-border bg-card p-6 shadow-[0_1px_0_var(--border),0_24px_48px_-32px_color-mix(in_oklch,var(--primary)_35%,transparent)] sm:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold text-accent">고민 편지함</p><h2 id="mailbox-card-title" className="mt-2 text-lg font-semibold">주고받은 편지{postsUnread + sentUnread > 0 && <span className="ml-2 align-middle text-xs font-semibold text-primary">새 편지 {postsUnread + sentUnread}</span>}</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">편지는 쓴 다음 정오에 도착하고, 답장은 몇 번이든 이어 쓸 수 있어요. 이름은 서로 보이지 않아요.</p></div><Button asChild variant="outline" className="h-9 rounded-full border-border px-4 text-xs"><Link to="/mailbox">고민 편지함 <ArrowUpRight size={13} /></Link></Button></div>
    {error ? <p role="status" className="mt-5 text-xs text-muted-foreground">{error} <button type="button" onClick={() => void load()} className="text-xs font-semibold text-primary">다시 불러오기</button></p>
      : !box ? <p role="status" className="mt-5 text-xs text-muted-foreground">편지함을 불러오고 있어요.</p>
      : thread ? <ThreadView id={thread} onBack={() => { setThread(null); void load(); }} />
      : empty ? <p className="mt-6 rounded-2xl border border-dashed border-border p-6 text-sm leading-7 text-muted-foreground">아직 주고받은 편지가 없어요. <Link to="/mailbox" className="font-semibold text-primary underline-offset-4 hover:underline">고민 편지함</Link>에서 고민을 남기거나, 다른 분의 고민에 편지를 보내 보세요.</p>
      : <>
        <div role="tablist" aria-label="편지함" className="mt-6 flex gap-2 border-b border-border pb-4">{([["posts", "내 고민에 온 편지", postsUnread], ["sent", "내가 보낸 편지", sentUnread]] as const).map(([id, label, n]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs ${interaction} ${tab === id ? "border-primary bg-primary/5 font-semibold text-primary" : "border-border hover:border-primary/40"}`}>{label}{n > 0 && <span className="grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">{n}</span>}</button>)}</div>
        {tab === "posts" ? (box.posts.length ? <ul className="mt-5 space-y-5">{box.posts.map(post => <li key={post.id}>
          <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span className="rounded-full bg-mist px-2 py-0.5 font-semibold text-primary">{TOPICS[post.topic]}</span>{kstMonthDay(post.at)} · {post.hidden ? "가려진 고민" : post.open ? "편지를 받는 중" : "편지 받기 마감"}</p>
          <p className="mt-2 line-clamp-2 text-sm leading-6">{post.body}</p>
          {post.threads.length ? <ul className="mt-3 divide-y divide-border rounded-2xl border border-border">{post.threads.map(row => <ThreadRowItem key={row.id} row={row} title={row.partner ?? ""} onOpen={() => setThread(row.id)} />)}</ul> : <p className="mt-3 text-xs text-muted-foreground">아직 도착한 편지가 없어요.</p>}
        </li>)}</ul> : <p className="mt-5 text-xs text-muted-foreground">아직 남긴 고민이 없어요.</p>)
          : (box.sent.length ? <ul className="mt-5 divide-y divide-border rounded-2xl border border-border">{box.sent.map(row => <ThreadRowItem key={row.id} row={row} title={`${TOPICS[row.topic!]} · ${row.post}`} onOpen={() => setThread(row.id)} />)}</ul> : <p className="mt-5 text-xs text-muted-foreground">아직 보낸 편지가 없어요.</p>)}
      </>}
  </section>;
}

function ThreadRowItem({ row, title, onOpen }: { row: ThreadRow; title: string; onOpen: () => void }) {
  return <li><button type="button" onClick={onOpen} className={`flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/50 ${interaction}`}>
    {row.partner ? <AliasSeal alias={row.partner} size="sm" /> : <MailOpen size={16} aria-hidden="true" className="shrink-0 text-primary" />}
    <span className="min-w-0 flex-1"><span className={`block truncate text-sm ${row.unread ? "font-semibold" : ""}`}>{title}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{row.last ?? (row.waiting ? `편지 ${row.waiting}통이 정오에 도착해요` : "")}</span></span>
    <span className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-muted-foreground">{row.lastAt && ago(row.lastAt)}{row.unread > 0 ? <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">새 편지 {row.unread}</span> : row.closed ? <span>멈춤</span> : null}</span>
  </button></li>;
}

function ThreadView({ id, onBack }: { id: string; onBack: () => void }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [message, setMessage] = useMessage();
  const load = async () => { const result = await rpc<Thread>("worry_thread", { p_thread: id }); if (result.error || !result.data) { setError(result.error || "편지를 불러오지 못했어요."); return; } setThread(result.data); };
  useEffect(() => { void load(); }, [id]);
  if (error) return <div className="mt-5"><button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft size={13} />편지함</button><p className="mt-3 text-xs text-muted-foreground">{error}</p></div>;
  if (!thread) return <p role="status" className="mt-5 text-xs text-muted-foreground">편지를 불러오고 있어요.</p>;
  const reply = async () => { setBusy(true); const result = await rpc<Thread>("worry_reply", { p_thread: id, p_body: body }); setBusy(false); if (result.error || !result.data) { setMessage(result.error || "보내지 못했어요."); return; } setThread(result.data); setBody(""); setMessage(`답장을 보냈어요. ${arrives()}에 도착해요.`); };
  const cancel = async (letter: string) => { const result = await rpc("worry_cancel_letter", { p_id: letter }); if (result.error) { setMessage(result.error); return; } if (thread.letters.length === 1) { onBack(); return; } await load(); };
  const close = async () => { const result = await rpc("worry_close_thread", { p_thread: id }); if (result.error) { setMessage(result.error); return; } setClosing(false); await load(); };
  const stopped = thread.closedBy === "report" ? "신고한 편지가 있어 주고받기를 멈췄어요. 운영진이 확인할게요." : thread.closedBy === "operator" ? "운영진이 확인한 뒤 주고받기를 멈췄어요." : "더는 주고받지 않기로 한 편지예요. 지금까지의 편지는 그대로 읽을 수 있어요.";
  const partner = thread.role === "author" ? thread.partner : "고민을 쓴 분";
  return <div className="mt-5">
    <button type="button" onClick={onBack} className={`inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ${interaction}`}><ArrowLeft size={13} />편지함</button>
    <div className="mt-4 rounded-2xl bg-mist p-4"><p className="text-[11px] font-semibold text-primary">{thread.role === "author" ? "내 고민" : "편지를 보낸 고민"} · {TOPICS[thread.post.topic]}</p><p className="mt-1.5 line-clamp-3 text-sm leading-6">{thread.post.body ?? "가려진 고민이에요."}</p></div>
    <ol className="mt-5 space-y-3">{thread.letters.map(letter => <li key={letter.id} className={`rounded-2xl border p-4 sm:p-5 ${letter.mine ? "ml-6 border-primary/20 bg-primary/[0.04] sm:ml-14" : "mr-6 border-[#E9E2CC] bg-[#FDFBF4] dark:border-white/10 dark:bg-[#1F1D2E] sm:mr-14"}`}>
      <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">{!letter.mine && <AliasSeal alias={partner} size="sm" />}<span className="font-semibold text-foreground/80">{letter.mine ? "내가 보낸 편지" : partner}</span><span>{letter.delivered ? `${kstMonthDay(letter.deliverAt)} 정오에 도착` : `${kstMonthDay(letter.deliverAt)} 정오에 도착해요`}</span></p>
      <p className="mt-2.5 whitespace-pre-wrap text-[15px] leading-7">{letter.body}</p>
      {(letter.mine && !letter.delivered) || !letter.mine ? <p className="mt-2 flex gap-3">{letter.mine ? <button type="button" onClick={() => void cancel(letter.id)} className="text-[11px] text-muted-foreground hover:text-foreground">도착 전에 거두기</button> : <ReportButton onReport={async () => { const result = await rpc<string>("worry_report", { p_kind: "letter", p_id: letter.id }); await load(); return result.error || result.data || "신고를 받았어요."; }} />}</p> : null}
    </li>)}</ol>
    {thread.closed || thread.post.hidden ? <p className="mt-5 rounded-2xl bg-muted p-4 text-xs leading-6 text-muted-foreground">{thread.post.hidden && !thread.closed ? "가려진 고민이라 편지를 이어 갈 수 없어요." : stopped}</p> : <div className="mt-5 rounded-2xl border border-border p-4">
      <label htmlFor={`reply-${id}`} className="text-[11px] font-semibold text-primary">{partner}{thread.role === "author" ? " 님께 답장" : "께 답장"}</label>
      <Textarea id={`reply-${id}`} value={body} maxLength={LETTER_MAX} onChange={event => setBody(event.target.value)} placeholder="천천히 이어 써 주세요." className="mt-2 min-h-28 resize-none rounded-xl border-0 bg-mist px-3.5 text-[15px] leading-7 shadow-none focus-visible:ring-2" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground">{arrives()}에 도착해요 · {count(body)} / {LETTER_MAX}</span><Button disabled={busy || count(body) < 5} onClick={() => void reply()} className="h-9 rounded-full px-4 text-xs"><Mail size={13} />{busy ? "보내는 중…" : "답장 보내기"}</Button></div>
      <p className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">{closing ? <span className="inline-flex flex-wrap items-center gap-2"><span>더는 편지를 주고받지 않을까요? 상대에게는 이유가 보이지 않아요.</span><button type="button" onClick={() => void close()} className="text-[11px] font-semibold text-destructive">그만 주고받기</button><button type="button" onClick={() => setClosing(false)} className="text-[11px]">취소</button></span> : <button type="button" onClick={() => setClosing(true)} className="text-[11px] hover:text-foreground">그만 주고받기</button>}</p>
    </div>}
    {message && <p role="status" className="mt-2 text-xs text-primary">{message}</p>}
    <CrisisNote className="mt-4" />
  </div>;
}
