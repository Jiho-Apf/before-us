import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ArrowDown, ArrowUpRight, Clock, Download, HandHeart, Link2, Lock, Mail, MessageCircle, PenLine, RotateCcw } from "lucide-react";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { LIVE, rpc } from "./backend/client";
import { useAuth } from "./auth-service";
import { AliasSeal, PaperBackdrop, ReportButton, SLIP, SectionLabel, Wave, ago, interaction, kstClock, useMessage, useNoonCountdown } from "./community";
import { TOPICS, type WorryPost } from "./WorryLetters";

// 정오의 서랍(/drawer): 이름 없이 나누는 하루 한 질문(2026-11-03 다시 짬).
// 들어오자마자 ‘질문 하나 + 여러 사람이 이름 없이 남긴 쪽지’가 보이게 한다 — 설명 대신 구조로.
//   첫 화면: 지금 열려 있는 질문(정오에 열리고 다음 정오에 닫힌다)과 최근 쪽지 세 장이 햇빛 드는 벽에 붙어 있다.
//   01 오늘의 답: 쪽지 벽(쓰기 칸이 첫 장) · 지난 7일 · 댓글 · 고마워요(숫자는 쓴 분에게만)
//   02 고민 편지함 미리 보기(/mailbox) · 03 서랍 속 작은 것들(질문 카드·첫 장면·편지지, 이 기기에서만 만든다)
// 회원 화면과 겹치지 않게 한다 — 소개·편지·첫 마디·창가 질문처럼 운영진에게 가거나 소개에 쓰이는 것은 두지 않는다.
const LEAF = "https://images.unsplash.com/photo-1530651796427-6edd0e06319e?auto=format&fit=crop&w=1200&q=70";
const kstNow = () => new Date(Date.now() + 9 * 3600000);
const kstDate = (date = kstNow()) => date.toISOString().slice(0, 10);
const dayBefore = (iso: string, days = 1) => new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
const dateText = (iso: string) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;

// ── 하루 한 질문: 정오에 열린다. 누군가와 함께 있을 때 꺼내는 가벼운 것들로만 둔다(뒤에만 덧붙인다).
// 서버 drawer_question과 같은 목록·같은 순서다(1970-01-01부터 날 수 % 31). 둘을 함께 바꾼다.
const DAILY = [
  "오늘 하루 중 가장 조용했던 순간은 언제였나요?", "요즘 자꾸 손이 가는 음식이 있나요?", "어릴 적 살던 동네에서 가장 기억나는 길은요?", "최근에 산 것 중 가장 마음에 드는 물건은요?",
  "지금 창밖에는 무엇이 보이나요?", "요즘 나도 모르게 자주 쓰는 말이 있나요?", "비 오는 날에만 하고 싶어지는 일이 있나요?", "요즘 휴대폰에서 가장 자주 여는 것은 무엇인가요?",
  "올해 처음 해 본 일은 무엇인가요?", "오늘 누군가에게 고맙다고 말했나요?", "가장 오래 간직한 물건은 무엇인가요?", "요즘 가방 속에 늘 들고 다니는 것은요?",
  "최근에 미뤄 두었다가 결국 해낸 일이 있나요?", "좋아하는 계절의 냄새를 떠올린다면요?", "누군가 나를 한 문장으로 소개한다면, 어떻게 말해 주면 좋겠어요?", "요즘 아껴 두고 조금씩 보는 것이 있나요?",
  "걷다가 자주 멈춰 서게 되는 것은요?", "요즘 휴대폰 배경 화면은 무엇인가요?", "잠들기 전에 마지막으로 하는 일은요?", "다시 가 보고 싶은 여행지 한 곳은요?",
  "나만 아는 작은 맛집이 있나요?", "요즘 내 방에서 가장 좋아하는 자리는 어디예요?", "최근에 새로 알게 된 단어나 사실이 있나요?", "오늘의 기분을 날씨로 말한다면요?",
  "사진첩에서 가장 최근에 찍은 사진은 무엇인가요?", "어떤 소리를 들으면 마음이 편해지나요?", "내일 아침이 기다려지는 이유가 하나 있다면요?", "요즘 다시 보고 싶은 영화나 책이 있나요?",
  "친구들이 나에게 자주 묻는 것은 무엇인가요?", "계절이 바뀌는 걸 가장 먼저 느끼는 순간은요?", "오늘 정오에는 어디에 있었나요?",
];
const dailyIndex = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000) % DAILY.length;

// ── 02 나의 첫 장면: 다섯 문항으로 나에게 어울리는 첫 장면 하나를 찾는다(B 첫 장면 만들기처럼 직접 고르는 게 아니라 나를 비춰 보는 놀이).
type SceneId = "bookstore" | "walk" | "exhibition" | "market" | "park" | "performance";
const SCENES: Record<SceneId, { title: string; line: string; fit: string; bring: string }> = {
  bookstore: { title: "비 오는 오후의 서점", line: "각자 한 권씩 고르고, 창가 자리에서 고른 이유를 바꿔 읽는 장면.", fit: "말보다 고른 것에서 마음이 먼저 보이는 분", bring: "우산 하나" },
  walk: { title: "해 질 녘 강가 산책", line: "말이 끊겨도 어색하지 않게 나란히 걷다가, 노을 앞에서 잠깐 멈추는 장면.", fit: "걸을 때 이야기가 더 잘 나오는 분", bring: "편한 신발" },
  exhibition: { title: "골목 끝 작은 전시", line: "말없이 한 바퀴 돌고, 나와서 마음에 남은 한 점을 서로 이야기하는 장면.", fit: "천천히 보고 오래 생각하는 분", bring: "작은 수첩" },
  market: { title: "아침 시장의 따뜻한 국수", line: "김이 오르는 국수 한 그릇 앞에서, 이야기보다 웃음이 먼저 나오는 장면.", fit: "같이 먹으면 금방 편해지는 분", bring: "든든한 아침" },
  park: { title: "정오의 공원 벤치", line: "커피 두 잔과 나뭇잎 그림자 아래에서, 오늘 있었던 일을 천천히 나누는 장면.", fit: "밝은 낮의 여유를 좋아하는 분", bring: "따뜻한 커피 두 잔" },
  performance: { title: "작은 공연이 끝난 밤", line: "같은 노래를 듣고 나와서, 좋았던 한 소절을 서로 말해 보는 장면.", fit: "같은 걸 느끼는 순간을 아끼는 분", bring: "좋아하는 노래 한 곡" },
};
const SCENE_IDS = Object.keys(SCENES) as SceneId[];
const QUIZ: { q: string; options: [string, SceneId[]][] }[] = [
  { q: "약속 장소에 10분 일찍 도착했어요.", options: [["근처 가게를 천천히 구경해요", ["market", "bookstore"]], ["그 자리에서 주변을 둘러봐요", ["park", "walk"]], ["이어폰을 끼고 음악을 들어요", ["performance", "exhibition"]]] },
  { q: "처음 만난 사람과 가장 편한 건?", options: [["나란히 걸으면서 이야기하기", ["walk", "park"]], ["무언가를 함께 보고 나서 이야기하기", ["exhibition", "performance"]], ["맛있는 걸 같이 먹으면서 이야기하기", ["market", "park"]]] },
  { q: "쉬는 날 오후, 가장 끌리는 소리는?", options: [["책장 넘기는 소리", ["bookstore", "exhibition"]], ["바람에 나뭇잎 스치는 소리", ["park", "walk"]], ["사람들이 두런두런 이야기하는 소리", ["market", "performance"]]] },
  { q: "대화가 잠깐 끊기면?", options: [["웃으면서 다음 이야기를 찾아요", ["market", "performance"]], ["조용히 같이 있어도 괜찮아요", ["walk", "exhibition"]], ["눈앞에 보이는 걸 이야기해요", ["park", "bookstore"]]] },
  { q: "헤어질 때 가장 남기고 싶은 건?", options: [["같이 본 장면 하나", ["exhibition", "walk"]], ["서로 추천한 무언가", ["bookstore", "performance"]], ["다음에 또 먹고 싶은 맛", ["market", "park"]]] },
];
const sceneOf = (answers: number[]): SceneId => {
  const score = Object.fromEntries(SCENE_IDS.map(id => [id, 0])) as Record<SceneId, number>;
  answers.forEach((answer, index) => QUIZ[index].options[answer][1].forEach((id, rank) => { score[id] += rank ? 1 : 2; }));
  return SCENE_IDS.reduce((best, id) => score[id] > score[best] ? id : best, QUIZ[answers.length - 1].options[answers[answers.length - 1]][1][0]);
};

// ── 03 편지지 가게: 편지지를 고르고 짧은 편지를 써서 정오 소인이 찍힌 이미지로 간직한다(어디에도 보내지 않는다).
// 편지지: 정오의 잎 그림자(기본) · 버터 노랑 · 초록 그늘. 라벤더는 02 첫 장면 카드에만 쓴다. leaf = 잎 그림자 사진을 얹는 정도.
type Paper = "leaf" | "butter" | "sage" | "lavender";
const PAPERS: Record<Paper, { label: string; fill: string; ink: string; swatch: string; leaf: number }> = {
  leaf: { label: "정오의 잎 그림자", fill: "#FBFAF7", ink: "#24212F", swatch: "bg-[#FBFAF7]", leaf: 0.3 },
  butter: { label: "버터 노랑", fill: "#FCF6E4", ink: "#3D3216", swatch: "bg-[#FCF6E4]", leaf: 0.1 },
  sage: { label: "초록 그늘", fill: "#E8EEE3", ink: "#22301F", swatch: "bg-[#E8EEE3]", leaf: 0.22 },
  lavender: { label: "라벤더 안개", fill: "#EEEAF8", ink: "#2B2540", swatch: "bg-[#EEEAF8]", leaf: 0.14 },
};
const CHOICES: Paper[] = ["leaf", "butter", "sage"];
const PAPER_KEY = "flavie:drawer-paper";
const savedPaper = (): Paper => { try { const value = localStorage.getItem(PAPER_KEY) as Paper | null; return value && CHOICES.includes(value) ? value : "leaf"; } catch { return "leaf"; } };
const rememberPaper = (paper: Paper) => { try { localStorage.setItem(PAPER_KEY, paper); } catch { /* 저장할 수 없으면 이번에만 */ } };
function PaperPicker({ value, onChange, label = "편지지" }: { value: Paper; onChange: (paper: Paper) => void; label?: string }) {
  return <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>{CHOICES.map(id => <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => { onChange(id); rememberPaper(id); }} className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs ${interaction} ${value === id ? "border-primary font-semibold text-primary" : "border-border bg-card hover:border-primary/40"}`}><span aria-hidden="true" className={`size-4 rounded-full border border-black/10 ${PAPERS[id].swatch}`} />{PAPERS[id].label}</button>)}</div>;
}
const TO = ["친구에게", "오늘의 나에게", "1년 뒤의 나에게"] as const;
const LETTER_MAX = 200;

// ── 이미지: 이 기기에서 그려 저장한다(서버로 보내지 않는다). 사진을 못 불러오면 사진 없이 그린다.
const W = 1080, H = 1350;
const loadLeaf = () => new Promise<HTMLImageElement | null>(resolve => { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = LEAF; });
const font = (weight: number, size: number) => `${weight} ${size}px Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of Array.from(paragraph)) {
      if (ctx.measureText(line + char).width > width && line) { lines.push(line.trimEnd()); line = char.trimStart(); } else line += char;
    }
    lines.push(line);
  }
  return lines;
}
async function drawCard({ paper, eyebrow, title, body, footer }: { paper: Paper; eyebrow: string; title?: string; body: string; footer: string }) {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  await document.fonts?.ready;
  const tone = PAPERS[paper];
  ctx.fillStyle = tone.fill; ctx.fillRect(0, 0, W, H);
  { const leaf = await loadLeaf(); if (leaf) { ctx.globalAlpha = tone.leaf; ctx.globalCompositeOperation = "multiply"; const scale = Math.max(W / leaf.width, H / leaf.height); ctx.drawImage(leaf, (W - leaf.width * scale) / 2, (H - leaf.height * scale) / 2, leaf.width * scale, leaf.height * scale); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; } }
  ctx.fillStyle = tone.ink;
  ctx.font = font(600, 26); ctx.globalAlpha = 0.62; ctx.fillText(eyebrow, 96, 140); ctx.globalAlpha = 1;
  // 정오 소인
  ctx.save(); ctx.strokeStyle = tone.ink; ctx.globalAlpha = 0.35; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(W - 170, 150, 66, 0, Math.PI * 2); ctx.stroke();
  ctx.font = font(600, 22); ctx.textAlign = "center"; ctx.fillStyle = tone.ink; ctx.fillText("정오", W - 170, 142); ctx.fillText(dateText(kstDate()), W - 170, 174); ctx.restore();
  let y = 330;
  if (title) { ctx.font = font(700, 64); for (const line of wrap(ctx, title, W - 192)) { ctx.fillText(line, 96, y); y += 92; } y += 36; }
  ctx.font = font(title ? 400 : 500, title ? 40 : 46);
  for (const line of wrap(ctx, body, W - 192)) { ctx.fillText(line, 96, y); y += title ? 70 : 78; }
  ctx.font = font(500, 26); ctx.globalAlpha = 0.62; ctx.fillText(footer, 96, H - 120); ctx.globalAlpha = 1;
  // 두 점
  ctx.fillStyle = "#5B4FCF"; ctx.beginPath(); ctx.arc(W - 188, H - 130, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(53, 96, 192, 0.85)"; ctx.beginPath(); ctx.arc(W - 160, H - 130, 16, 0, Math.PI * 2); ctx.fill();
  ctx.font = font(700, 22); ctx.fillStyle = tone.ink; ctx.globalAlpha = 0.7; ctx.fillText("FLAVIE", W - 290, H - 122); ctx.globalAlpha = 1;
  return canvas;
}
// 휴대폰은 공유 창(사진에 저장·보내기), 그 밖에는 파일로 내려받는다.
async function keep(canvas: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) return "이미지를 만들지 못했어요.";
  const file = new File([blob], name, { type: "image/png" });
  const touch = window.matchMedia?.("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return ""; } catch { return ""; } }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "이미지를 저장했어요.";
}

// ── 서버(5000·5100): 그날의 질문과 이름 없이 남긴 답·댓글·고마워요. 보는 것은 누구나, 남기는 것은 로그인한 분만.
type DrawerAnswer = { id: string; alias: string; body: string; at: string; mine: boolean; comments: number; thanked?: boolean; thanks?: number | null };
type DrawerComment = { id: string; alias: string; body: string; at: string; mine: boolean; thanked?: boolean; thanks?: number | null };
type DrawerDay = { day: string; opened: boolean; open: boolean; question?: string; signedIn?: boolean; mine?: { id: string; body: string; hidden: boolean } | null; answers: DrawerAnswer[] };
type Loaded = DrawerDay | { error: string };
const ANSWER_MAX = 200, COMMENT_LIMIT = 200;
const RULES = "이름 대신 글마다 새 별명이 붙어요. 연락처·SNS는 남길 수 없고, 소개받은 분이나 특정한 사람 이야기는 쓰지 않아요. 서로 다른 세 분이 신고하면 바로 가려지고, 답과 댓글은 30일 뒤 지워져요.";
const isDay = (value: Loaded | undefined): value is DrawerDay => !!value && "answers" in value;

type Little = "card" | "scene" | "letter";
const LITTLE: { id: Little; no: string; label: string }[] = [{ id: "card", no: "01", label: "오늘의 질문 카드" }, { id: "scene", no: "02", label: "나의 첫 장면" }, { id: "letter", no: "03", label: "편지지 가게" }];

// 지금의 질문: 정오 전에는 어제 질문(오늘 정오까지 열려 있다), 정오부터는 오늘 질문.
function useNoonDay() {
  const [now, setNow] = useState(kstNow);
  useEffect(() => { const timer = window.setInterval(() => setNow(kstNow()), 30000); return () => window.clearInterval(timer); }, []);
  const today = kstDate(now);
  const beforeNoon = now.getUTCHours() < 12;
  return { today, beforeNoon, noonDay: beforeNoon ? dayBefore(today) : today };
}

export default function NoonDrawer() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useAuth();
  const { today, beforeNoon, noonDay } = useNoonDay();
  const [selected, setSelected] = useState(noonDay);
  useEffect(() => setSelected(noonDay), [noonDay]);
  const [days, setDays] = useState<Record<string, Loaded>>({});
  const load = useCallback(async (day: string) => {
    const result = await rpc<DrawerDay>("drawer_day", { p_day: day });
    setDays(current => ({ ...current, [day]: result.data ?? { error: result.error || "답을 불러오지 못했어요." } }));
  }, []);
  const put = useCallback((day: string, data: DrawerDay) => setDays(current => ({ ...current, [day]: data })), []);
  useEffect(() => { if (LIVE) void load(noonDay); }, [noonDay, !!session]);
  useEffect(() => { if (LIVE && selected !== noonDay) void load(selected); }, [selected, !!session]);
  // 서랍 속 작은 것들: #card · #scene · #letter(첫 장면 링크 ?scene= 포함). 예전 #question은 오늘의 답으로.
  const hash = location.hash.slice(1);
  const little: Little = LITTLE.some(item => item.id === hash) ? hash as Little : new URLSearchParams(location.search).get("scene") ? "scene" : "card";
  useEffect(() => {
    const target = ["card", "scene", "letter"].includes(hash) || new URLSearchParams(location.search).get("scene") ? "little" : ["answers", "question"].includes(hash) ? "answers" : "";
    if (!target) return;
    const timer = window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    return () => window.clearTimeout(timer);
  }, [hash]);
  const write = () => {
    document.getElementById("answers")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSelected(noonDay);
    window.setTimeout(() => (document.getElementById("drawer-compose") as HTMLTextAreaElement | null)?.focus({ preventScroll: true }), 600);
  };
  return <div className="break-keep [overflow-wrap:anywhere]">
    <DrawerHero day={noonDay} data={days[noonDay]} beforeNoon={beforeNoon} next={DAILY[dailyIndex(today)]} onWrite={write} />
    <AnswerWall noonDay={noonDay} today={today} selected={selected} onSelect={setSelected} data={days[selected]} signedIn={!!session} onReload={() => load(selected)} onSaved={data => put(selected, data)} />
    <MailboxTeaser />
    <section id="little" className="scroll-mt-20 py-20 sm:py-24" aria-labelledby="little-title">
      <SectionLabel number="03" ko="서랍 속 작은 것들">LITTLE THINGS</SectionLabel>
      <div className="flex flex-wrap items-end justify-between gap-6"><h2 id="little-title" className="text-ink text-3xl font-semibold leading-[1.45] sm:text-[34px]">혼자서도, 둘이서도<br />꺼내 보는 것들.</h2><p className="max-w-sm text-sm leading-7 text-muted-foreground">카드와 편지지, 첫 장면은 이 기기에서만 만들어요. 어디에도 보내지 않아요.</p></div>
      <div role="tablist" aria-label="서랍 속 작은 것들" className="mt-10 flex flex-wrap gap-2 border-b border-border pb-5">
        {LITTLE.map(item => <button key={item.id} type="button" role="tab" id={`little-tab-${item.id}`} aria-selected={little === item.id} aria-controls={`little-${item.id}`} onClick={() => navigate({ pathname: "/drawer", hash: item.id }, { replace: true })} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm ${interaction} ${little === item.id ? "border-primary bg-primary/5 font-semibold text-primary" : "border-border bg-card hover:border-primary/40"}`}><span className="text-[11px] tabular-nums text-accent">{item.no}</span>{item.label}</button>)}
      </div>
      <div role="tabpanel" id={`little-${little}`} aria-labelledby={`little-tab-${little}`} className="pt-10">
        {little === "card" && <QuestionCard />}
        {little === "scene" && <SceneDrawer />}
        {little === "letter" && <LetterDrawer />}
      </div>
    </section>
    <p className="mb-20 border-t border-border pt-6 text-xs leading-6 text-muted-foreground">소개와 편지, 첫 마디처럼 소개에 쓰이는 것은 회원 화면에 있어요. 서랍은 누구나 가볍게 들르는 곳이에요. 플라비의 3일 교류가 궁금하다면 <Link to="/two-starts" className="font-semibold text-primary underline-offset-4 hover:underline">두 가지 시작</Link>을 둘러보세요.</p>
  </div>;
}

// ── 첫 화면: 지금의 질문 + 최근 쪽지 세 장(진짜 답만 · 없으면 빈 쪽지 한 장)
function DrawerHero({ day, data, beforeNoon, next, onWrite }: { day: string; data?: Loaded; beforeNoon: boolean; next: string; onWrite: () => void }) {
  const clock = useNoonCountdown();
  const question = DAILY[dailyIndex(day)];
  const answers = isDay(data) ? data.answers : [];
  return <section className="bleed relative isolate overflow-clip" aria-labelledby="drawer-title">
    <PaperBackdrop />
    <div className="relative grid gap-12 pt-14 pb-28 sm:pt-20 sm:pb-32 lg:grid-cols-[7fr_5fr] lg:items-center lg:gap-10 lg:pb-36">
      <div className="relative z-10">
        <p className="-mt-3 mb-9 inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-1 text-xs font-semibold text-ink ring-1 ring-black/5 backdrop-blur-sm dark:bg-white/10 dark:ring-white/15 sm:-mt-4 sm:mb-10"><span aria-hidden="true" className="flex gap-1"><span className="size-1.5 rounded-full bg-primary" /><span className="size-1.5 rounded-full bg-accent" /></span>정오의 서랍 · 이름 없이 나누는 하루 한 질문</p>
        <p className="mb-5 flex items-center gap-2.5 text-sm font-semibold text-accent sm:text-base"><span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />{dateText(day)} 정오의 질문</p>
        <h1 id="drawer-title" className="text-ink max-w-2xl text-[clamp(2rem,4.4vw,3.5rem)] font-semibold leading-[1.3] tracking-[-0.02em]">{question}</h1>
        <ul className="mt-7 flex flex-wrap gap-2" aria-label="서랍의 약속">{["이름 대신 별명", "정오에 열리고 다음 정오에 닫혀요", "댓글 · 고마워요"].map(point => <li key={point} className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-medium text-ink ring-1 ring-black/5 backdrop-blur-sm dark:bg-white/10 dark:ring-white/15">{point}</li>)}</ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={onWrite} className={`h-12 rounded-full px-6 ${interaction}`}><PenLine size={16} />나도 한 줄 남기기</Button>
          <Button asChild variant="outline" className={`h-12 rounded-full border-ink/15 bg-white/60 px-5 backdrop-blur-sm hover:bg-white dark:bg-transparent ${interaction}`}><Link to="/mailbox">고민 편지함 <ArrowUpRight size={16} /></Link></Button>
        </div>
        <div className="mt-12 w-full max-w-[17rem]">
          <p className="text-xs text-muted-foreground">{beforeNoon ? "새 질문까지" : "다음 질문까지"}</p>
          <p className="text-ink mt-1.5 text-[2.5rem] font-extralight leading-none tracking-[-0.02em] tabular-nums" role="timer" aria-label={`다음 질문까지 ${clock.text}`}>{clock.text}</p>
          <div aria-hidden="true" className="mt-4 h-px bg-ink/10"><div className="h-px bg-primary" style={{ width: `${clock.filled}%` }} /></div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{beforeNoon ? "이 질문은 오늘 정오에 닫히고, 새 질문이 열려요." : "이 질문은 내일 정오까지 열려 있어요."}</p>
        </div>
      </div>
      <div className="relative z-10 lg:flex lg:items-center lg:justify-end">
        <div className="hero-float mx-auto flex w-full max-w-[420px] flex-col gap-3 lg:ml-auto lg:mr-0" aria-label="이 질문에 이름 없이 남긴 답">
          {beforeNoon && <p className={`letter-drop mx-auto flex max-w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] font-medium text-ink ${SLIP}`} style={{ animationDelay: "0.4s" }}><Lock size={12} className="shrink-0 text-primary" /><span className="shrink-0 font-semibold text-primary">다음 질문</span><span aria-hidden="true" className="truncate blur-[3px]">{next}</span><span className="sr-only">정오에 열려요</span></p>}
          {!LIVE ? <div className={`rounded-[22px] p-6 text-sm leading-7 text-ink ${SLIP}`}>다른 분들이 남긴 답은 실제 서비스에서 함께 볼 수 있어요.</div>
            : data === undefined ? <div className={`h-32 animate-pulse rounded-[22px] ${SLIP}`} />
            : answers.length ? answers.slice(0, 3).map((answer, index) => <figure key={answer.id} className={`letter-drop rounded-[22px] p-5 ${SLIP} ${["lg:-rotate-[1.2deg]", "lg:ml-12 lg:rotate-[0.8deg]", "lg:-ml-2 lg:-rotate-[0.4deg]"][index]}`} style={{ animationDelay: `${0.7 + index * 0.45}s` }}>
              <figcaption className="flex items-center gap-2 text-[11px] text-muted-foreground"><AliasSeal alias={answer.alias} size="sm" /><span className="font-semibold text-ink">{answer.alias}</span><span>{kstClock(answer.at)}</span></figcaption>
              <p className="text-ink mt-2.5 line-clamp-3 text-sm leading-7">{answer.body}</p>
            </figure>)
            : <button type="button" onClick={onWrite} className={`letter-drop group rounded-[22px] border border-dashed border-ink/20 p-6 text-left ${SLIP}`} style={{ animationDelay: "0.7s" }}><span className="block text-[11px] font-semibold text-muted-foreground">아직 비어 있는 첫 쪽지</span><span className="text-ink mt-3 block text-base font-semibold leading-7">이 질문의 첫 줄을 남겨 보세요.</span><span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">한 줄 쓰기 <ArrowDown size={13} className="transition-transform group-hover:translate-y-0.5" /></span></button>}
          {answers.length > 3 && <a href="#answers" onClick={event => { event.preventDefault(); document.getElementById("answers")?.scrollIntoView({ behavior: "smooth" }); }} className="text-ink mt-1 inline-flex items-center gap-1 self-end rounded-full bg-white/70 px-3.5 py-1.5 text-xs font-semibold ring-1 ring-black/5 backdrop-blur-sm hover:text-primary dark:bg-white/10">남긴 답 모두 읽기 <ArrowDown size={13} /></a>}
        </div>
      </div>
    </div>
    <Wave />
  </section>;
}

// ── 01 오늘의 답: 쪽지 벽. 첫 장은 쓰기 칸(로그인 전에는 로그인 안내), 나머지는 최근 것부터.
function AnswerWall({ noonDay, today, selected, onSelect, data, signedIn, onReload, onSaved }: { noonDay: string; today: string; selected: string; onSelect: (day: string) => void; data?: Loaded; signedIn: boolean; onReload: () => Promise<void>; onSaved: (data: DrawerDay) => void }) {
  // 볼 수 있는 날: 지금의 질문부터 지난 7일(서버는 오늘-6일까지)
  const choices = useMemo(() => Array.from({ length: 7 }, (_, index) => dayBefore(noonDay, index)).filter(day => day >= dayBefore(today, 6)), [noonDay, today]);
  return <section id="answers" className="scroll-mt-20 pt-16 pb-20 sm:pt-20 sm:pb-24" aria-labelledby="answers-title">
    <SectionLabel number="01" ko="오늘의 답">ANSWERS AT NOON</SectionLabel>
    <div className="flex flex-wrap items-end justify-between gap-6">
      <h2 id="answers-title" className="text-ink text-3xl font-semibold leading-[1.45] sm:text-[34px]">이름 없이,<br />한 줄씩.</h2>
      <div className="flex max-w-full gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label="질문 날짜">{choices.map(day => <button key={day} type="button" role="radio" aria-checked={selected === day} onClick={() => onSelect(day)} className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs tabular-nums ${interaction} ${selected === day ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"}`}>{day === noonDay ? "지금의 질문" : dateText(day)}</button>)}</div>
    </div>
    {selected !== noonDay && <p className="text-ink mt-8 border-l-2 border-accent/50 pl-4 text-lg font-semibold leading-8">{DAILY[dailyIndex(selected)]}<span className="ml-2 align-middle text-xs font-normal text-muted-foreground">{dateText(selected)}의 질문 · 읽기만 할 수 있어요</span></p>}
    <div className="mt-10">
      {!LIVE ? <p className="rounded-3xl border border-dashed border-border p-6 text-sm leading-7 text-muted-foreground">다른 분들이 남긴 답은 실제 서비스에서 함께 볼 수 있어요.</p>
        : data === undefined ? <p role="status" className="text-xs text-muted-foreground">답을 불러오고 있어요.</p>
        : !isDay(data) ? <p role="status" className="text-xs leading-6 text-muted-foreground">{data.error} <button type="button" onClick={() => void onReload()} className="text-xs font-semibold text-primary underline-offset-4 hover:underline">다시 불러오기</button></p>
        : <Wall key={selected} day={selected} data={data} signedIn={signedIn} onReload={onReload} onSaved={onSaved} />}
    </div>
    <p className="mt-8 max-w-3xl text-[11px] leading-5 text-muted-foreground">{RULES}</p>
  </section>;
}

function Wall({ day, data, signedIn, onReload, onSaved }: { day: string; data: DrawerDay; signedIn: boolean; onReload: () => Promise<void>; onSaved: (data: DrawerDay) => void }) {
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useMessage();
  const length = Array.from(body.trim()).length;
  const send = async () => { setBusy(true); const result = await rpc<DrawerDay>("drawer_answer", { p_day: day, p_body: body }); setBusy(false); if (result.error || !result.data) { setMessage(result.error || "남기지 못했어요."); return; } onSaved(result.data); setBody(""); setEditing(false); setMessage("이름 없이 남겼어요."); };
  const mine = data.mine;
  const composing = data.open && signedIn && !mine?.hidden && (!mine || editing);
  const slip = "mb-4 break-inside-avoid rounded-[22px]";
  return <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
    {data.open && !signedIn && <div className={`${slip} border border-dashed border-primary/30 bg-primary/[0.03] p-6`}><p className="text-[11px] font-semibold text-primary">나의 한 줄</p><p className="mt-3 text-sm leading-7">로그인하면 이 질문에 이름 없이 답할 수 있어요. 읽는 건 누구나 할 수 있어요.</p><Button asChild variant="outline" className="mt-4 h-10 rounded-full border-border bg-card px-4 text-xs"><Link to="/login">로그인하기</Link></Button></div>}
    {data.open && signedIn && mine?.hidden && <p className={`${slip} bg-muted p-5 text-xs leading-6 text-muted-foreground`}>남긴 답이 신고로 가려졌어요. 운영진이 확인하고 있어요.</p>}
    {composing && <div className={`${slip} border border-primary/25 bg-card p-5 shadow-[0_18px_40px_-32px_rgba(40,24,100,0.5)]`}>
      <label htmlFor="drawer-compose" className="text-[11px] font-semibold text-primary">{editing ? "나의 한 줄 고치기" : "나의 한 줄"}</label>
      <Textarea id="drawer-compose" value={body} maxLength={ANSWER_MAX} onChange={event => setBody(event.target.value)} placeholder="짧게 한두 줄이면 충분해요." className="mt-2 min-h-24 resize-none rounded-xl border-0 bg-mist px-3.5 text-[15px] leading-7 shadow-none focus-visible:ring-2" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] tabular-nums text-muted-foreground">{length} / {ANSWER_MAX}</span><span className="flex gap-2">{editing && <Button variant="ghost" onClick={() => { setEditing(false); setBody(""); }} className="h-9 rounded-full px-3 text-xs text-muted-foreground">그만 고치기</Button>}<Button disabled={busy || length < 2} onClick={() => void send()} className="h-9 rounded-full px-4 text-xs">{busy ? "남기는 중…" : "이름 없이 남기기"}</Button></span></div>
      {message && <p role="status" className="mt-2 text-xs text-primary">{message}</p>}
    </div>}
    {!composing && message && <p role="status" className={`${slip} px-1 text-xs text-primary`}>{message}</p>}
    {[...data.answers].sort((a, b) => Number(b.mine) - Number(a.mine)).map(answer => <AnswerSlip key={answer.id} answer={answer} signedIn={signedIn} canComment={day >= dayBefore(kstDate())} canEdit={answer.mine && data.open} onEdit={() => { setBody(answer.body); setEditing(true); window.setTimeout(() => document.getElementById("drawer-compose")?.focus(), 50); }} onChanged={onReload} />)}
    {!data.answers.length && <p className={`${slip} border border-dashed border-border p-6 text-xs leading-6 text-muted-foreground`}>아직 남긴 답이 없어요.{data.open ? " 첫 줄을 남겨 보세요." : ""}</p>}
  </div>;
}

function Thanks({ kind, id, thanked, signedIn, compact = false }: { kind: "answer" | "comment"; id: string; thanked?: boolean; signedIn: boolean; compact?: boolean }) {
  const [on, setOn] = useState(!!thanked);
  const [hint, setHint] = useState("");
  if (!signedIn) return <Link to="/login" title="로그인하면 고마워요를 남길 수 있어요" className={`inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ${interaction}`}><HandHeart size={13} aria-hidden="true" />{!compact && "고마워요"}{compact && <span className="sr-only">고마워요</span>}</Link>;
  const toggle = async () => { const next = !on; setOn(next); const result = await rpc<boolean>("drawer_thank", { p_kind: kind, p_id: id, p_on: next }); if (result.error) { setOn(!next); setHint(result.error); } };
  return <span className="inline-flex items-center gap-2"><button type="button" aria-pressed={on} onClick={() => void toggle()} className={`inline-flex items-center gap-1 text-xs ${interaction} ${on ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}><HandHeart size={13} aria-hidden="true" className={on ? "fill-primary/15" : ""} />{compact ? <span className="sr-only">고마워요</span> : "고마워요"}</button>{hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}</span>;
}
// 내 글에만 보이는 조용한 반응(숫자는 쓴 분에게만)
const thanksText = (count?: number | null) => !count ? "" : count === 1 ? "누군가 고마워했어요" : `${count}분이 고마워했어요`;

function AnswerSlip({ answer, signedIn, canComment, canEdit, onEdit, onChanged }: { answer: DrawerAnswer; signedIn: boolean; canComment: boolean; canEdit: boolean; onEdit: () => void; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<DrawerComment[] | null>(null);
  const [count, setCount] = useState(answer.comments);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useMessage();
  const loadComments = async () => { const result = await rpc<DrawerComment[]>("drawer_comments_of", { p_answer: answer.id }); if (result.error) { setMessage(result.error); return; } setComments(result.data ?? []); setCount(result.data?.length ?? 0); };
  const toggle = () => { setOpen(value => !value); if (!comments) void loadComments(); };
  const send = async () => { setBusy(true); const result = await rpc<DrawerComment[]>("drawer_comment", { p_answer: answer.id, p_body: body }); setBusy(false); if (result.error || !result.data) { setMessage(result.error || "남기지 못했어요."); return; } setComments(result.data); setCount(result.data.length); setBody(""); };
  const removeComment = async (id: string) => { const result = await rpc("drawer_delete_comment", { p_id: id }); if (result.error) { setMessage(result.error); return; } await loadComments(); };
  const removeAnswer = async () => { const result = await rpc("drawer_delete_answer", { p_id: answer.id }); if (result.error) { setMessage(result.error); return; } await onChanged(); };
  const report = (kind: "answer" | "comment", id: string) => async () => { const result = await rpc<string>("drawer_report", { p_kind: kind, p_id: id }); return result.error || result.data || "신고를 받았어요."; };
  return <article className={`mb-4 break-inside-avoid rounded-[22px] border p-5 shadow-[0_18px_40px_-34px_rgba(40,24,100,0.45)] ${answer.mine ? "border-primary/25 bg-primary/[0.035]" : "border-border bg-card"}`}>
    <header className="flex items-center gap-2.5"><AliasSeal alias={answer.alias} /><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold">{answer.alias}{answer.mine && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">내 글</span>}</p><p className="text-[11px] text-muted-foreground">{ago(answer.at)}</p></div></header>
    <p className="mt-3.5 whitespace-pre-wrap text-[15px] leading-7">{answer.body}</p>
    {answer.mine && !!answer.thanks && <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary/[0.07] px-2.5 py-1 text-[11px] font-semibold text-primary"><HandHeart size={12} aria-hidden="true" />{thanksText(answer.thanks)}</p>}
    <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/70 pt-3">
      <button type="button" aria-expanded={open} onClick={toggle} className={`inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ${interaction}`}><MessageCircle size={13} aria-hidden="true" />{count ? `댓글 ${count}` : "댓글"}</button>
      {!answer.mine && <Thanks kind="answer" id={answer.id} thanked={answer.thanked} signedIn={signedIn} />}
      <span className="ml-auto flex items-center gap-3">{answer.mine ? <>{canEdit && <button type="button" onClick={onEdit} className="text-[11px] font-semibold text-primary">고치기</button>}<button type="button" onClick={() => void removeAnswer()} className="text-[11px] text-muted-foreground hover:text-foreground">지우기</button></> : signedIn && <ReportButton onReport={report("answer", answer.id)} />}</span>
    </footer>
    {open && <div className="mt-3 space-y-3">
      {comments === null ? <p className="text-xs text-muted-foreground">댓글을 불러오고 있어요.</p> : comments.length ? <ul className="space-y-3">{comments.map(comment => <li key={comment.id} className="flex gap-2.5"><AliasSeal alias={comment.alias === "글쓴이" ? answer.alias : comment.alias} size="sm" /><div className="min-w-0 flex-1 text-sm leading-6"><p className="text-[11px]"><span className={`font-semibold ${comment.alias === "글쓴이" ? "text-primary" : "text-foreground/80"}`}>{comment.alias}</span><span className="ml-1.5 text-muted-foreground">{ago(comment.at)}</span></p><p className="whitespace-pre-wrap">{comment.body}</p><p className="mt-1 flex flex-wrap items-center gap-3">{comment.mine ? <>{!!comment.thanks && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary"><HandHeart size={11} aria-hidden="true" />{thanksText(comment.thanks)}</span>}<button type="button" onClick={() => void removeComment(comment.id)} className="text-[11px] text-muted-foreground hover:text-foreground">지우기</button></> : <><Thanks kind="comment" id={comment.id} thanked={comment.thanked} signedIn={signedIn} compact />{signedIn && <ReportButton onReport={report("comment", comment.id)} />}</>}</p></div></li>)}</ul> : <p className="text-xs text-muted-foreground">아직 댓글이 없어요.</p>}
      {canComment && (signedIn ? <div className="flex gap-2"><input aria-label="댓글 쓰기" value={body} maxLength={COMMENT_LIMIT} onChange={event => setBody(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && body.trim()) void send(); }} placeholder="따뜻한 한마디" className="h-10 min-w-0 flex-1 rounded-full border border-border bg-background px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm" /><Button disabled={busy || !body.trim()} onClick={() => void send()} className="h-10 shrink-0 rounded-full px-4 text-xs">남기기</Button></div>
        : <p className="text-xs text-muted-foreground"><Link to="/login" className="font-semibold text-primary underline-offset-4 hover:underline">로그인</Link>하면 이름 없이 댓글을 남길 수 있어요.</p>)}
      {message && <p role="status" className="text-xs text-primary">{message}</p>}
    </div>}
  </article>;
}

// ── 02 고민 편지함 미리 보기: 최근 고민 세 편(진짜 글만). 편지는 통 수만.
function MailboxTeaser() {
  const [posts, setPosts] = useState<WorryPost[] | null>(LIVE ? null : []);
  useEffect(() => { if (LIVE) void rpc<{ posts: WorryPost[] }>("worry_board", {}).then(result => setPosts(result.data?.posts.filter(post => post.open).slice(0, 3) ?? [])); }, []);
  const steps = [{ icon: PenLine, label: "고민은 글로" }, { icon: Mail, label: "답장은 편지로" }, { icon: Clock, label: "정오에 도착" }];
  return <section className="bleed bg-mist py-20 sm:py-24" aria-labelledby="mailbox-teaser-title">
    <div className="grid gap-12 lg:grid-cols-[5fr_7fr] lg:gap-16">
      <div>
        <SectionLabel number="02" ko="고민 편지함">LETTERS AT NOON</SectionLabel>
        <h2 id="mailbox-teaser-title" className="text-ink text-3xl font-semibold leading-[1.45] sm:text-[34px]">댓글 대신,<br />편지로 답해요.</h2>
        <ol className="mt-9 flex items-center gap-2" aria-label="고민 편지함의 흐름">{steps.map(({ icon: Icon, label }, index) => <li key={label} className="flex items-center gap-2"><span className="flex flex-col items-center gap-2 text-center"><span className="grid size-11 place-items-center rounded-full bg-card text-primary ring-1 ring-primary/10 shadow-[0_12px_28px_-20px_rgba(40,24,100,0.6)]"><Icon size={17} aria-hidden="true" /></span><span className="text-[11px] font-semibold">{label}</span></span>{index < steps.length - 1 && <span aria-hidden="true" className="mb-6 h-px w-6 bg-primary/25 sm:w-10" />}</li>)}</ol>
        <Button asChild className={`mt-10 h-12 rounded-full px-6 ${interaction}`}><Link to="/mailbox">고민 편지함 열기 <ArrowUpRight size={16} /></Link></Button>
      </div>
      <div className="grid content-start gap-3">
        {posts === null ? <div className="h-40 animate-pulse rounded-[22px] bg-card" />
          : posts.length ? posts.map(post => <Link key={post.id} to={`/mailbox#post-${post.id}`} className={`group block rounded-[22px] border border-border bg-card p-5 shadow-[0_18px_40px_-34px_rgba(40,24,100,0.45)] hover:border-primary/40 ${interaction}`}>
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="rounded-full bg-primary/[0.07] px-2 py-0.5 font-semibold text-primary">{TOPICS[post.topic]}</span><span className="font-semibold text-foreground/80">{post.alias}</span><span>{ago(post.at)}</span></p>
            <p className="mt-3 line-clamp-2 text-[15px] leading-7">{post.body}</p>
            <p className="mt-3 flex items-center justify-between text-xs"><span className="inline-flex items-center gap-1.5 text-muted-foreground"><Mail size={13} aria-hidden="true" />{post.letters ? `편지 ${post.letters}통` : "아직 편지가 없어요"}</span><span className="font-semibold text-primary opacity-80 group-hover:opacity-100">편지 쓰기 →</span></p>
          </Link>)
          : <div className="rounded-[22px] border border-dashed border-border bg-card/60 p-8 text-sm leading-7 text-muted-foreground">아직 올라온 고민이 없어요. 마음에 걸린 일이 있다면 이름 없이 남겨 보세요. 읽은 분들이 편지로 답해 줄 거예요.</div>}
      </div>
    </div>
  </section>;
}

function Lead({ title, children }: { title: string; children: ReactNode }) {
  return <div className="max-w-md"><h3 className="text-xl font-semibold leading-[1.5]">{title}</h3><p className="mt-3 text-sm leading-7 text-muted-foreground">{children}</p></div>;
}

// ── 03-01 오늘의 질문 카드: 오전에는 잎 그림자에 가려 있다가 정오에 선명해진다. 고른 편지지로 이미지 저장.
function QuestionCard() {
  const [now, setNow] = useState(kstNow);
  useEffect(() => { const timer = window.setInterval(() => setNow(kstNow()), 30000); return () => window.clearInterval(timer); }, []);
  const [yesterday, setYesterday] = useState(false);
  const [paper, setPaper] = useState<Paper>(savedPaper);
  const [message, setMessage] = useMessage();
  const today = kstDate(now);
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  // 정오까지 남은 정도: 9시 전에는 가장 짙고, 9시부터 12시까지 차츰 걷힌다.
  const shade = minutes >= 720 ? 0 : minutes <= 540 ? 1 : (720 - minutes) / 180;
  const day = yesterday ? dayBefore(today) : today;
  const question = DAILY[dailyIndex(day)];
  const hidden = !yesterday && shade > 0;
  const left = 720 - minutes;
  const tone = PAPERS[paper];
  const save = async () => setMessage(await keep(await drawCard({ paper, eyebrow: `오늘의 질문 · ${dateText(day)}`, title: question, body: "", footer: "누군가와 함께라면, 이 질문으로 시작해 보세요." }), `flavie-question-${day}.png`));
  return <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
    <div className="space-y-6"><Lead title="하루 한 장, 정오에 열리는 질문.">오전에는 잎 그림자에 가려 있다가, 정오가 되면 선명해져요. 누군가와 함께 있다면 오늘은 이 질문으로 이야기를 시작해 보세요.</Lead><div><p className="text-xs font-semibold">카드 색</p><div className="mt-2"><PaperPicker value={paper} onChange={setPaper} label="카드 색" /></div></div></div>
    <div>
      <figure className="relative isolate mx-auto aspect-[4/5] w-full max-w-md overflow-hidden rounded-3xl border border-border p-8 shadow-[0_30px_60px_-40px_rgba(30,20,80,0.55)] transition-colors duration-500 motion-reduce:transition-none sm:p-10" style={{ background: tone.fill, color: tone.ink }}>
        <img src={LEAF} alt="" aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full object-cover mix-blend-multiply transition-opacity duration-1000 motion-reduce:transition-none" style={{ opacity: Math.min(0.85, tone.leaf + 0.5 * (hidden ? shade : 0)) }} />
        <p className="text-[11px] font-semibold tracking-[0.12em] opacity-60">{yesterday ? "어제의 질문" : "오늘의 질문"} · {dateText(day)}</p>
        <p className="mt-10 text-2xl font-semibold leading-[1.6] transition-[filter] duration-1000 motion-reduce:transition-none sm:text-[28px]" style={{ filter: hidden ? `blur(${(2 + 6 * shade).toFixed(1)}px)` : "none" }} aria-hidden={hidden}>{question}</p>
        {hidden && <p className="sr-only">오늘의 질문은 정오에 열려요.</p>}
        <figcaption className="absolute inset-x-8 bottom-8 flex items-end justify-between gap-3 sm:inset-x-10 sm:bottom-10">
          <span className="text-xs leading-5 opacity-70">{hidden ? `정오에 선명해져요 · ${Math.floor(left / 60) ? `${Math.floor(left / 60)}시간 ` : ""}${left % 60}분 남았어요` : "누군가와 함께라면, 이 질문으로."}</span>
          <span aria-hidden="true" className="flex shrink-0 items-center"><span className="size-2.5 rounded-full bg-[#5B4FCF]" /><span className="-ml-1 size-2.5 rounded-full bg-[#3560C0]/85" /></span>
        </figcaption>
      </figure>
      <div className="mx-auto mt-5 flex max-w-md flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setYesterday(value => !value)} className={`text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline ${interaction}`}>{yesterday ? "오늘의 질문으로" : "어제의 질문 보기"}</button>
        <Button variant="outline" disabled={hidden} onClick={() => void save()} className="h-10 rounded-full border-border px-4 text-xs"><Download size={14} />카드 이미지로 저장</Button>
      </div>
      {message && <p role="status" className="mx-auto mt-2 max-w-md text-right text-xs text-primary">{message}</p>}
    </div>
  </div>;
}

function SceneDrawer() {
  const location = useLocation();
  const navigate = useNavigate();
  const shared = new URLSearchParams(location.search).get("scene") as SceneId | null;
  const [answers, setAnswers] = useState<number[]>([]);
  const [message, setMessage] = useMessage();
  const result: SceneId | null = answers.length === QUIZ.length ? sceneOf(answers) : shared && SCENES[shared] ? shared : null;
  const fromLink = !!shared && answers.length < QUIZ.length && result === shared;
  const step = answers.length;
  const restart = () => { setAnswers([]); if (shared) navigate({ pathname: "/drawer", hash: "scene" }, { replace: true }); };
  const link = result ? `${window.location.origin}/drawer?scene=${result}#scene` : "";
  const copy = async () => { try { await navigator.clipboard.writeText(link); setMessage("링크를 복사했어요. 받은 분도 로그인 없이 볼 수 있어요."); } catch { setMessage(link); } };
  const save = async () => { if (!result) return; const scene = SCENES[result]; setMessage(await keep(await drawCard({ paper: "lavender", eyebrow: "나의 첫 장면", title: scene.title, body: `${scene.line}\n\n${scene.fit}께 어울려요.\n챙겨 갈 것 · ${scene.bring}`, footer: "정오의 서랍에서" }), `flavie-scene-${result}.png`)); };
  return <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
    <Lead title="나에게 어울리는 첫 장면은?">다섯 가지 질문에 답하면, 나에게 어울리는 첫 장면 하나를 찾아 드려요. 정답은 없어요. 지금 마음에 가까운 쪽을 골라 주세요.</Lead>
    {result ? <div>
      <article className="relative isolate mx-auto flex aspect-[4/5] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-border bg-[#F4F1FA] p-8 text-[#24212F] shadow-[0_30px_60px_-40px_rgba(30,20,80,0.55)] dark:bg-[#232036] dark:text-white sm:p-10">
        <img src={LEAF} alt="" aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full object-cover object-[center_70%] opacity-20 mix-blend-multiply dark:opacity-15 dark:mix-blend-soft-light" />
        <p className="text-[11px] font-semibold tracking-[0.12em] opacity-60">{fromLink ? "받은 첫 장면" : "나의 첫 장면"}</p>
        <h3 className="letter-drop mt-6 text-[28px] font-semibold leading-[1.45] sm:text-[34px]">{SCENES[result].title}</h3>
        <p className="mt-4 text-[15px] leading-8">{SCENES[result].line}</p>
        <dl className="mt-auto grid gap-4 border-t border-black/10 pt-5 text-sm dark:border-white/15 sm:grid-cols-2"><div><dt className="text-[11px] font-semibold opacity-60">이런 분께 어울려요</dt><dd className="mt-1">{SCENES[result].fit}</dd></div><div><dt className="text-[11px] font-semibold opacity-60">챙겨 갈 것</dt><dd className="mt-1">{SCENES[result].bring}</dd></div></dl>
      </article>
      <div className="mx-auto mt-5 flex max-w-md flex-wrap items-center gap-2">
        {fromLink ? <Button onClick={restart} className="h-10 rounded-full px-5 text-xs">나의 첫 장면도 찾아보기</Button> : <>
          <Button variant="outline" onClick={() => void save()} className="h-10 rounded-full border-border px-4 text-xs"><Download size={14} />이미지로 저장</Button>
          <Button variant="outline" onClick={() => void copy()} className="h-10 rounded-full border-border px-4 text-xs"><Link2 size={14} />링크 보내기</Button>
          <Button variant="ghost" onClick={restart} className="h-10 rounded-full px-4 text-xs text-muted-foreground"><RotateCcw size={14} />다시 하기</Button>
        </>}
      </div>
      {message && <p role="status" className="mx-auto mt-2 max-w-md break-all text-xs text-primary">{message}</p>}
    </div> : <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3"><p className="text-[11px] font-semibold tracking-[0.12em] text-accent">{step + 1} / {QUIZ.length}</p><span aria-hidden="true" className="flex gap-1">{QUIZ.map((_, index) => <span key={index} className={`h-1 w-6 rounded-full ${index <= step ? "bg-primary" : "bg-border"}`} />)}</span></div>
      <p key={step} className="letter-drop mt-6 text-lg font-semibold leading-[1.6]">{QUIZ[step].q}</p>
      <div className="mt-5 grid gap-2">{QUIZ[step].options.map(([label], index) => <button key={label} type="button" onClick={() => setAnswers(current => [...current, index])} className={`rounded-2xl border border-border bg-card px-5 py-4 text-left text-sm hover:border-primary/50 hover:bg-primary/5 ${interaction}`}>{label}</button>)}</div>
      {step > 0 && <button type="button" onClick={() => setAnswers(current => current.slice(0, -1))} className={`mt-4 text-xs text-muted-foreground hover:text-foreground ${interaction}`}>이전 질문으로</button>}
    </div>}
  </div>;
}

function LetterDrawer() {
  const [paper, setPaper] = useState<Paper>(savedPaper);
  const [to, setTo] = useState<(typeof TO)[number]>("친구에게");
  const [body, setBody] = useState("");
  const [message, setMessage] = useMessage();
  const [busy, setBusy] = useState(false);
  const length = Array.from(body.trim()).length;
  const tone = PAPERS[paper];
  const stamp = useMemo(() => dateText(kstDate()), []);
  const save = async () => { setBusy(true); setMessage(await keep(await drawCard({ paper, eyebrow: to, body: body.trim(), footer: `${stamp} 정오의 서랍에서` }), `flavie-letter-${kstDate()}.png`)); setBusy(false); };
  return <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
    <div className="space-y-6">
      <Lead title="편지지 한 장, 짧은 편지 하나.">편지지를 고르고 짧게 써 보세요. 정오 소인이 찍힌 이미지로 간직할 수 있어요. 쓴 글은 어디에도 보내지 않아요.</Lead>
      <div><p className="text-xs font-semibold">편지지</p><div className="mt-2"><PaperPicker value={paper} onChange={setPaper} /></div></div>
      <div><p className="text-xs font-semibold">받는 사람</p><div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="받는 사람">{TO.map(item => <button key={item} type="button" role="radio" aria-checked={to === item} onClick={() => setTo(item)} className={`rounded-full border px-3.5 py-2 text-xs ${interaction} ${to === item ? "border-primary font-semibold text-primary" : "border-border bg-card hover:border-primary/40"}`}>{item}</button>)}</div></div>
      <div><Textarea aria-label="편지 쓰기" value={body} maxLength={LETTER_MAX} onChange={event => setBody(event.target.value)} placeholder="예: 요즘 네 덕분에 자주 웃어. 이번 주말엔 내가 커피 살게." className="min-h-28 rounded-xl bg-card text-[15px] leading-7" /><p className="mt-2 text-right text-[11px] tabular-nums text-muted-foreground">{length} / {LETTER_MAX}</p></div>
    </div>
    <div>
      <div className="relative isolate mx-auto aspect-[4/5] w-full max-w-md overflow-hidden rounded-3xl border border-border p-8 shadow-[0_30px_60px_-40px_rgba(30,20,80,0.55)] sm:p-10" style={{ background: tone.fill, color: tone.ink }}>
        <img src={LEAF} alt="" aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full object-cover mix-blend-multiply" style={{ opacity: tone.leaf }} />
        <div className="flex items-start justify-between gap-4"><p className="text-xs font-semibold opacity-60">{to}</p><span aria-hidden="true" className="grid size-16 shrink-0 place-items-center rounded-full border-2 border-current text-center text-[10px] font-semibold leading-4 opacity-35">정오<br />{stamp}</span></div>
        <p className="mt-8 whitespace-pre-wrap text-[15px] leading-8 sm:text-base">{body.trim() || <span className="opacity-40">여기에 편지가 보여요.</span>}</p>
        <div className="absolute inset-x-8 bottom-8 flex items-end justify-between sm:inset-x-10 sm:bottom-10"><span className="text-[11px] opacity-60">{stamp} 정오의 서랍에서</span><span aria-hidden="true" className="flex items-center gap-2"><span className="text-[10px] font-semibold tracking-[0.2em] opacity-70">FLAVIE</span><span className="flex"><span className="size-2.5 rounded-full bg-[#5B4FCF]" /><span className="-ml-1 size-2.5 rounded-full bg-[#3560C0]/85" /></span></span></div>
      </div>
      <div className="mx-auto mt-5 flex max-w-md justify-end"><Button disabled={length < 1 || busy} onClick={() => void save()} className="h-10 rounded-full px-5 text-xs"><Download size={14} />{busy ? "만드는 중…" : "이미지로 간직하기"}</Button></div>
      {message && <p role="status" className="mx-auto mt-2 max-w-md text-right text-xs text-primary">{message}</p>}
    </div>
  </div>;
}
