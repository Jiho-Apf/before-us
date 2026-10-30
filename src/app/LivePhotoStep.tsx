import { useEffect, useRef, useState } from "react";
import { AlertCircle, Crop, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "./components/ui/button";
import { NoteList } from "./editorial";
import { Checkbox } from "./components/ui/checkbox";
import { BEFORE_US } from "./config";
import { PHOTO_REVIEW_TEXT, PHOTO_SLOTS, type PhotoSlotId } from "./photo-model";
import { kstDateTime } from "./dates";
import { Composition } from "./PhotoStep";
import { cancelReplacement, decodePhoto, photoUrl, removePhoto, uploadPhoto, uploadPreparedPhoto, type PhotoRow, type PreparedPhoto, type ReplacementRow } from "./backend/applications";
import PhotoAdjuster from "./PhotoAdjuster";

// 실제 서버 모드의 사진 단계. 카드 구성은 데모 사진 단계(PhotoStep)와 같고, 실제 파일을 올린다.
// 올리기 전에 두 가지 본인 확인을 먼저 받는다. 올린 사진은 비공개 저장소에 두고, 5분짜리 주소로만 보여 준다.
// 사진을 고르면 위치·크기 조절 창(4:5)이 열리고, 이미 올린 사진도 ‘위치 조절’로 다시 맞출 수 있다.
// 이미 소개를 받고 있는(승인된) 회원이 확인된 사진을 바꾸면 새 사진은 ‘교체 대기’로 올라가고, 운영진이 확인할 때까지 지금 사진이 그대로 보인다.
const interaction = "transition-colors duration-200 motion-reduce:transition-none";

function Thumbnail({ path, number }: { path: string | null; number: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let alive = true; setUrl(null); if (path) void photoUrl(path).then(next => { if (alive) setUrl(next); }); return () => { alive = false; }; }, [path]);
  if (path && url) return <img src={url} alt="" className="h-full w-full object-cover" />;
  return <Composition number={number} crop />;
}

export default function LivePhotoStep({ rows, replacements = [], approved = false, editable, onChanged, errors = {} }: { rows: PhotoRow[]; replacements?: ReplacementRow[]; approved?: boolean; editable: boolean; onChanged: () => Promise<void>; errors?: Record<string, string> }) {
  const [confirm, setConfirm] = useState<Record<string, { recent: boolean; rights: boolean }>>({});
  const [busy, setBusy] = useState<PhotoSlotId | null>(null);
  const [failure, setFailure] = useState<Record<string, string>>({});
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [adjust, setAdjust] = useState<{ slot: PhotoSlotId; bitmap: ImageBitmap; file: File | null; previous: string | null } | null>(null);
  const bySlot = Object.fromEntries(rows.map(row => [row.slot, row])) as Partial<Record<PhotoSlotId, PhotoRow>>;
  const required = PHOTO_SLOTS.filter(slot => slot.required && bySlot[slot.id] && bySlot[slot.id]!.review !== "재등록 요청").length;
  const swapOf = (slot: PhotoSlotId) => replacements.find(item => item.slot === slot);
  // 확인된 사진을 바꾸는 중인지(승인된 회원). 이때 새로 올리면 지금 사진 대신 이전 교체 사진만 지운다.
  const replacing = (slot: PhotoSlotId) => approved && bySlot[slot]?.review === "기준 확인";
  const previousOf = (slot: PhotoSlotId) => replacing(slot) ? swapOf(slot)?.path ?? null : bySlot[slot]?.path ?? null;
  // 고른 사진을 읽어 조절 창을 연다(아직 올리지 않음)
  const pick = async (slot: PhotoSlotId, file: File | undefined) => {
    if (!file) return;
    setBusy(slot); setFailure(current => ({ ...current, [slot]: "" }));
    const decoded = await decodePhoto(file);
    setBusy(null);
    if ("error" in decoded) { setFailure(current => ({ ...current, [slot]: decoded.error })); return; }
    setAdjust({ slot, bitmap: decoded.bitmap, file, previous: previousOf(slot) });
  };
  // 이미 올린 사진을 다시 맞추기
  const reframe = async (slot: PhotoSlotId) => {
    const row = bySlot[slot]; if (!row) return;
    setBusy(slot); setFailure(current => ({ ...current, [slot]: "" }));
    try {
      const url = await photoUrl(row.path);
      if (!url) throw new Error("no url");
      const decoded = await decodePhoto(await (await fetch(url)).blob());
      if ("error" in decoded) throw new Error(decoded.error);
      setAdjust({ slot, bitmap: decoded.bitmap, file: null, previous: previousOf(slot) });
    } catch { setFailure(current => ({ ...current, [slot]: "사진을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요." })); }
    setBusy(null);
  };
  const closeAdjust = () => { adjust?.bitmap.close(); setAdjust(null); };
  const finish = async (slot: PhotoSlotId, result: { error: string | null }) => {
    if (result.error) { setFailure(current => ({ ...current, [slot]: result.error! })); return; }
    await onChanged(); setConfirm(current => ({ ...current, [slot]: { recent: false, rights: false } }));
  };
  const uploadAdjusted = async (prepared: PreparedPhoto) => {
    if (!adjust) return;
    const { slot, previous } = adjust;
    const result = await uploadPreparedPhoto(slot, prepared, previous);
    closeAdjust();
    await finish(slot, result);
  };
  const uploadOriginal = async () => {
    if (!adjust?.file) return;
    const { slot, file, previous } = adjust;
    closeAdjust();
    setBusy(slot);
    await finish(slot, await uploadPhoto(slot, file, previous));
    setBusy(null);
  };
  const cancel = async (slot: PhotoSlotId) => {
    const swap = swapOf(slot); if (!swap) return;
    setBusy(slot);
    const { error } = await cancelReplacement(slot, swap.path);
    if (error) setFailure(current => ({ ...current, [slot]: error })); else await onChanged();
    setBusy(null);
  };
  const remove = async (slot: PhotoSlotId) => {
    const row = bySlot[slot]; if (!row) return;
    setBusy(slot);
    const { error } = await removePhoto(slot, row.path);
    if (error) setFailure(current => ({ ...current, [slot]: error })); else await onChanged();
    setBusy(null);
  };
  return <section aria-labelledby="photos-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="photos-title" className="text-2xl font-semibold">현재의 나를 보여 주세요.</h3><p className="mt-4 text-sm leading-7">특별히 촬영한 사진일 필요는 없어요. 최근의 모습을 솔직하게 보여 주세요.</p></div><span className="rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground">필수 {required}/3 · 총 {rows.length}/4</span></div>
    <NoteList className="mt-5" items={[{ title: "필수 3장 + 선택 1장", body: <>최근 {BEFORE_US.operatingDraft.photos.recentMonths}개월 안에 찍은 서로 다른 사진을 올려 주세요.</> }, { title: "파일 형식", body: <>JPG·PNG·WebP·HEIC(아이폰 사진은 JPG로 자동으로 바꿔요), 한 장에 10MB 이하. 짧은 변 {BEFORE_US.photoFiles.recommendedShortSide}px 이상을 권해요.</> }, { title: "위치정보는 지워요", body: <span className="font-medium text-accent">올리기 전에 이 기기에서 다시 저장해 촬영 위치 같은 정보를 지워요.</span> }, { title: "볼 수 있는 사람", body: "운영진과, 소개가 열린 동안의 상대만 볼 수 있어요." }]} />
    {approved && <p role="note" className="mt-5 rounded-xl bg-mist p-4 text-xs leading-6">이미 소개를 받고 있어서 사진을 바꿔도 소개가 멈추지 않아요. 새 사진은 운영진이 확인한 뒤 바뀌고, 그동안은 지금 사진이 그대로 보여요.</p>}
    <div className="mt-7 grid gap-5 lg:grid-cols-2">{PHOTO_SLOTS.map(slot => { const row = bySlot[slot.id]; const state = confirm[slot.id] || { recent: false, rights: false }; const ready = state.recent && state.rights; const loading = busy === slot.id; const swap = swapOf(slot.id); const live = replacing(slot.id); const status = !row ? "미등록" : live && swap ? swap.review === "대기" ? "새 사진 확인 중" : "새 사진 다시 골라 주세요" : live && row.change_reason ? "바꿔 주세요" : PHOTO_REVIEW_TEXT[row.review] ?? row.review; return <article key={slot.id} className="flex flex-col border border-border bg-card" aria-labelledby={`${slot.id}-title`}>
      <div className="flex items-center justify-between gap-3 border-b border-border p-5"><div className="flex items-center gap-3"><span className="text-3xl font-light text-primary">0{slot.number}</span><div><h4 id={`${slot.id}-title`} className="text-sm font-semibold">{slot.label}</h4><p className="mt-1 text-xs text-muted-foreground">{slot.required ? "필수" : "선택 · 없어도 신청 가능"}{slot.number === 1 ? " · 대표 사진" : ""}</p></div></div><span className="text-xs font-medium text-accent">{status}</span></div>
      <div className="p-5"><div className="relative mx-auto aspect-[4/5] max-w-52 overflow-hidden border border-border"><Thumbnail path={row?.path ?? null} number={slot.number} />{!row && <span className="absolute inset-x-0 bottom-0 bg-card/90 px-3 py-2 text-center text-xs text-muted-foreground">이런 구도면 좋아요</span>}</div><p className="mt-4 min-h-12 text-xs leading-6 text-muted-foreground">{slot.description}</p>{slot.number === 1 && <p className="mt-1 text-[11px] leading-5 text-accent">얼굴이 잘 보이지 않으면 운영진이 다른 사진을 요청할 수 있어요.</p>}
        {row && <p className="mt-3 text-xs text-muted-foreground">{row.width} × {row.height}px · {(row.bytes / (1024 * 1024)).toFixed(1)}MB{Math.min(row.width, row.height) < BEFORE_US.photoFiles.recommendedShortSide ? " · 조금 작은 사진이에요" : ""}</p>}
        {row?.review === "재등록 요청" && <p className="mt-4 rounded-xl bg-muted p-3 text-xs leading-6">보완 사유: {row.reason || "운영진 안내 확인"} · 이 사진만 다시 올려 주세요.{approved ? "" : " 새 사진을 확인하기 전까지는 소개를 준비하지 않아요."}</p>}
        {live && row?.change_reason && swap?.review !== "대기" && <p className="mt-4 rounded-xl bg-[#F8E5A6]/55 p-3 text-xs leading-6 text-[#5A4310] dark:bg-[#3B3424] dark:text-[#F3D98A]">운영진 요청 · {row.change_reason}. 새 사진을 올려 주시면 확인한 뒤 바꿔 드려요. 그동안 지금 사진이 그대로 보여요.{row.change_requested_at ? ` ${kstDateTime(new Date(Date.parse(row.change_requested_at) + 7 * 86400000).toISOString())}까지 올리지 않으면 새 소개를 잠시 멈춰요.` : ""}</p>}
        {live && swap && <div className="mt-4 flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3"><div className="aspect-[4/5] w-14 shrink-0 overflow-hidden rounded-md border border-border"><Thumbnail path={swap.path} number={slot.number} /></div><div className="min-w-0 flex-1 text-xs leading-6"><p className="font-semibold text-primary">{swap.review === "대기" ? "바꿀 새 사진 · 확인 중" : "바꿀 새 사진 · 다시 골라 주세요"}</p><p className="text-muted-foreground">{swap.review === "대기" ? "확인되면 지금 사진과 바뀌어요." : `운영진 안내 · ${swap.reason || "다른 사진으로 다시 올려 주세요"}. 지금 사진은 그대로 보여요.`}</p></div>{editable && <Button variant="ghost" disabled={loading} onClick={() => void cancel(slot.id)} className={`h-9 shrink-0 rounded-xl px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground ${interaction}`}>취소</Button>}</div>}
        {editable && <div className="mt-5 space-y-3 border-t border-border pt-4"><label className="flex cursor-pointer items-start gap-2.5 text-xs leading-6"><Checkbox className="mt-1" checked={state.recent} onCheckedChange={checked => setConfirm(current => ({ ...current, [slot.id]: { ...state, recent: checked === true } }))} /><span>최근 {BEFORE_US.operatingDraft.photos.recentMonths}개월 안에 찍은 지금의 내 모습이고, 다른 칸과 다른 사진이에요.</span></label><label className="flex cursor-pointer items-start gap-2.5 text-xs leading-6"><Checkbox className="mt-1" checked={state.rights} onCheckedChange={checked => setConfirm(current => ({ ...current, [slot.id]: { ...state, rights: checked === true } }))} /><span>내가 올릴 권리가 있는 사진이에요.</span></label>
          <input ref={element => { inputs.current[slot.id] = element; }} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void pick(slot.id, file); }} />
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!ready || loading} onClick={() => inputs.current[slot.id]?.click()} className={`h-10 rounded-xl border-border text-xs hover:bg-muted hover:text-foreground ${interaction}`}>{loading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}{live ? swap ? "다른 사진으로" : "새 사진으로 바꾸기" : row ? "사진 바꾸기" : "사진 올리기"}</Button>{row && <Button variant="outline" disabled={loading} onClick={() => void reframe(slot.id)} className={`h-10 rounded-xl border-border text-xs hover:bg-muted hover:text-foreground ${interaction}`}><Crop size={13} />위치 조절</Button>}{row && !(approved && slot.required) && <Button variant="ghost" disabled={loading} aria-label={`${slot.label} 사진 삭제`} onClick={() => void remove(slot.id)} className={`h-10 rounded-xl text-xs text-muted-foreground hover:bg-muted hover:text-foreground ${interaction}`}><Trash2 size={13} />삭제</Button>}</div>
          {!ready && <p className="text-[11px] text-muted-foreground">두 가지를 확인하면 사진을 고를 수 있어요.</p>}
        </div>}
        {failure[slot.id] && <p role="alert" className="mt-4 flex items-start gap-2 text-xs leading-6 text-destructive"><AlertCircle size={14} className="mt-1 shrink-0" />{failure[slot.id]}</p>}
        {errors[slot.id] && <p role="alert" className="mt-4 text-xs leading-6 text-destructive">{errors[slot.id]}</p>}
      </div>
    </article>; })}</div>
    {adjust && <PhotoAdjuster bitmap={adjust.bitmap} title={PHOTO_SLOTS.find(item => item.id === adjust.slot)?.label ?? "사진"} onCancel={closeAdjust} onOriginal={adjust.file ? () => void uploadOriginal() : undefined} onDone={uploadAdjusted} />}
    <NoteList className="mt-7" title="사진을 고르기 전에" items={[{ title: "피해 주세요", body: "AI로 만든 인물·다른 사람의 사진·과한 보정·단체 사진·알아볼 수 있는 다른 사람·주소나 연락처가 담긴 사진" }, { title: "사진 확인의 의미", body: "외모나 인성을 평가하거나 안전을 인증하는 일이 아니에요. 필수 3장으로 신청할 수 있고, 운영진이 확인한 뒤 소개가 준비돼요." }, { title: "다른 사진을 요청할 때", body: approved ? "운영진이 사진 교체를 요청하면 사이트 알림과 메일로 알려 드려요. 신청은 취소되지 않고, 새 사진을 확인할 때까지 지금 사진이 그대로 보여요. 요청을 받고 7일 안에 새 사진을 올리지 않으면 새 소개만 잠시 멈추고, 올리면 바로 다시 준비해요." : "대표 사진에 얼굴이 잘 보이지 않는 등 기준에 맞지 않으면 그 사진만 다시 요청해요. 새 사진을 확인하기 전까지는 소개를 준비하지 않아요." }]} />
  </section>;
}
