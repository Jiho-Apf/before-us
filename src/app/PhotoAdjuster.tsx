import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Loader2, Minus, Plus, RotateCw, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { encodePhoto, type PreparedPhoto } from "./backend/applications";

// 사진 위치·크기 조절(2026-10-27). 소개 화면의 사진 틀과 같은 4:5로 잘라 올린다.
// 끌어서 위치를 옮기고, 막대로 크기를 키우고, 90°씩 돌릴 수 있다. 사진이 틀 밖으로 비어 보이지 않도록 늘 틀을 가득 채운다.
// 키보드: 화살표로 옮기고, +/− 로 크기를 바꾼다. 원본 그대로 올리기도 고를 수 있다.
const RATIO = 5 / 4; // 세로 ÷ 가로
const MAX_ZOOM = 3;
const OUT_MAX_W = 1280;

type View = { zoom: number; x: number; y: number; turn: 0 | 1 | 2 | 3 };

function measure(bitmap: ImageBitmap, view: View) {
  const sideways = view.turn % 2 === 1;
  const w = sideways ? bitmap.height : bitmap.width; // 돌린 뒤의 가로·세로
  const h = sideways ? bitmap.width : bitmap.height;
  const cover = Math.max(1 / w, RATIO / h); // 틀 가로를 1로 볼 때, 사진 1px의 크기(틀을 가득 채우는 최소값)
  const scale = cover * view.zoom;
  return { w, h, scale, spanX: w * scale, spanY: (h * scale) / RATIO }; // span: 사진이 틀의 몇 배인지(가로·세로)
}
function clampView(bitmap: ImageBitmap, view: View): View {
  const { spanX, spanY } = measure(bitmap, view);
  const limitX = Math.max(0, (spanX - 1) / 2), limitY = Math.max(0, (spanY - 1) / 2);
  return { ...view, x: Math.min(limitX, Math.max(-limitX, view.x)), y: Math.min(limitY, Math.max(-limitY, view.y)) };
}
// 틀 가로를 width 픽셀로 그린다(미리보기와 저장이 같은 함수를 쓴다)
function draw(canvas: HTMLCanvasElement, bitmap: ImageBitmap, view: View, width: number) {
  const height = Math.round(width * RATIO);
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return false;
  const { scale } = measure(bitmap, view);
  context.fillStyle = "#fff"; context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  context.save();
  context.translate(width / 2 + view.x * width, height / 2 + view.y * height);
  context.rotate((view.turn * Math.PI) / 2);
  const s = scale * width;
  context.drawImage(bitmap, (-bitmap.width * s) / 2, (-bitmap.height * s) / 2, bitmap.width * s, bitmap.height * s);
  context.restore();
  return true;
}

export default function PhotoAdjuster({ bitmap, title, onCancel, onOriginal, onDone }: {
  bitmap: ImageBitmap;
  title: string;
  onCancel: () => void;
  onOriginal?: () => void;
  onDone: (prepared: PreparedPhoto) => Promise<void>;
}) {
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0, turn: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const set = (next: Partial<View>) => setView(current => clampView(bitmap, { ...current, ...next }));

  useEffect(() => {
    const canvas = preview.current, box = stage.current;
    if (!canvas || !box) return;
    const width = Math.round(box.clientWidth * Math.min(2, window.devicePixelRatio || 1));
    draw(canvas, bitmap, view, width);
  }, [bitmap, view]);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && !saving) onCancel(); };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [onCancel, saving]);

  const down = (event: PointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current, box = stage.current;
    if (!start || start.id !== event.pointerId || !box) return;
    const dx = (event.clientX - start.x) / box.clientWidth, dy = (event.clientY - start.y) / box.clientHeight;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setView(current => clampView(bitmap, { ...current, x: current.x + dx, y: current.y + dy }));
  };
  const up = () => { drag.current = null; };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = 0.02;
    const moves: Record<string, Partial<View>> = { ArrowLeft: { x: view.x - step }, ArrowRight: { x: view.x + step }, ArrowUp: { y: view.y - step }, ArrowDown: { y: view.y + step }, "+": { zoom: Math.min(MAX_ZOOM, view.zoom + 0.1) }, "=": { zoom: Math.min(MAX_ZOOM, view.zoom + 0.1) }, "-": { zoom: Math.max(1, view.zoom - 0.1) } };
    if (moves[event.key]) { event.preventDefault(); set(moves[event.key]); }
  };
  const save = async () => {
    setSaving(true); setError("");
    const { w, scale } = measure(bitmap, view);
    // 틀 가로가 원본 몇 픽셀에 해당하는지 계산해, 원본보다 크게 늘리지 않는다
    const sourceWidth = 1 / scale;
    const width = Math.max(320, Math.min(OUT_MAX_W, Math.round(Math.min(sourceWidth, w))));
    const canvas = document.createElement("canvas");
    if (!draw(canvas, bitmap, view, width)) { setSaving(false); setError("이 브라우저에서는 사진을 처리할 수 없어요."); return; }
    const prepared = await encodePhoto(canvas);
    if ("error" in prepared) { setSaving(false); setError(prepared.error); return; }
    await onDone(prepared);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(24,18,52,0.55)] p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="adjust-title">
      <div className="max-h-[100dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_40px_80px_-30px_rgba(24,18,52,0.6)] sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs font-semibold text-accent">{title}</p><h2 id="adjust-title" className="mt-1.5 text-lg font-semibold">사진 위치와 크기를 맞춰 주세요</h2></div>
          <Button variant="ghost" size="icon" aria-label="닫기" disabled={saving} onClick={onCancel} className="size-9 shrink-0 rounded-full hover:bg-muted hover:text-foreground"><X size={18} /></Button>
        </div>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">끌어서 위치를 옮기고, 아래 막대로 크기를 조절해요. 소개 화면에는 이 틀 그대로 보여요.</p>
        <div
          ref={stage}
          tabIndex={0}
          role="application"
          aria-label="사진 위치 조절 영역. 화살표로 옮기고, 더하기·빼기로 크기를 바꿔요."
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
          className="relative mx-auto mt-4 aspect-[4/5] w-full max-w-[300px] cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-muted outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        >
          <canvas ref={preview} className="h-full w-full" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgba(255,255,255,0.35)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.35)_1px,transparent_1px)] [background-position:33.33%_0,0_33.33%] [background-size:33.34%_100%,100%_33.34%]" />
        </div>
        <div className="mx-auto mt-5 flex max-w-[300px] items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="작게" disabled={view.zoom <= 1} onClick={() => set({ zoom: Math.max(1, view.zoom - 0.2) })} className="size-8 shrink-0 rounded-full hover:bg-muted hover:text-foreground"><Minus size={15} /></Button>
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={view.zoom} aria-label="사진 크기" onChange={event => set({ zoom: Number(event.target.value) })} className="h-1.5 flex-1 cursor-pointer accent-[var(--primary)]" />
          <Button variant="ghost" size="icon" aria-label="크게" disabled={view.zoom >= MAX_ZOOM} onClick={() => set({ zoom: Math.min(MAX_ZOOM, view.zoom + 0.2) })} className="size-8 shrink-0 rounded-full hover:bg-muted hover:text-foreground"><Plus size={15} /></Button>
          <Button variant="outline" size="icon" aria-label="오른쪽으로 90° 돌리기" onClick={() => set({ turn: ((view.turn + 1) % 4) as View["turn"], x: 0, y: 0 })} className="size-9 shrink-0 rounded-full border-border hover:bg-muted hover:text-foreground"><RotateCw size={15} /></Button>
        </div>
        {error && <p role="alert" className="mt-3 text-center text-xs text-destructive">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {onOriginal ? <Button variant="ghost" disabled={saving} onClick={onOriginal} className="h-11 rounded-full text-xs text-muted-foreground hover:bg-muted hover:text-foreground">자르지 않고 원본 그대로 올리기</Button> : <span />}
          <Button disabled={saving} onClick={() => void save()} className="h-12 rounded-full px-7">{saving ? <><Loader2 size={15} className="animate-spin" />올리는 중…</> : "이대로 올리기"}</Button>
        </div>
      </div>
    </div>
  );
}
