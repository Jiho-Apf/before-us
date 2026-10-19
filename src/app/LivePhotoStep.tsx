import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "./components/ui/button";
import { NoteList } from "./editorial";
import { Checkbox } from "./components/ui/checkbox";
import { BEFORE_US } from "./config";
import { PHOTO_SLOTS, type PhotoSlotId } from "./photo-model";
import { Composition } from "./PhotoStep";
import { photoUrl, removePhoto, uploadPhoto, type PhotoRow } from "./backend/applications";

// 실제 서버 모드의 사진 단계. 카드 구성은 데모 사진 단계(PhotoStep)와 같고, 실제 파일을 올린다.
// 올리기 전에 두 가지 본인 확인을 먼저 받는다. 올린 사진은 비공개 저장소에 두고, 5분짜리 주소로만 보여 준다.
const interaction = "transition-colors duration-200 motion-reduce:transition-none";

function Thumbnail({ path, number }: { path: string | null; number: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let alive = true; setUrl(null); if (path) void photoUrl(path).then(next => { if (alive) setUrl(next); }); return () => { alive = false; }; }, [path]);
  if (path && url) return <img src={url} alt="" className="h-full w-full object-cover" />;
  return <Composition number={number} crop />;
}

export default function LivePhotoStep({ rows, editable, onChanged, errors = {} }: { rows: PhotoRow[]; editable: boolean; onChanged: () => Promise<void>; errors?: Record<string, string> }) {
  const [confirm, setConfirm] = useState<Record<string, { recent: boolean; rights: boolean }>>({});
  const [busy, setBusy] = useState<PhotoSlotId | null>(null);
  const [failure, setFailure] = useState<Record<string, string>>({});
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const bySlot = Object.fromEntries(rows.map(row => [row.slot, row])) as Partial<Record<PhotoSlotId, PhotoRow>>;
  const required = PHOTO_SLOTS.filter(slot => slot.required && bySlot[slot.id] && bySlot[slot.id]!.review !== "재등록 요청").length;
  const pick = async (slot: PhotoSlotId, file: File | undefined) => {
    if (!file) return;
    setBusy(slot); setFailure(current => ({ ...current, [slot]: "" }));
    const { error } = await uploadPhoto(slot, file, bySlot[slot]?.path ?? null);
    if (error) setFailure(current => ({ ...current, [slot]: error }));
    else { await onChanged(); setConfirm(current => ({ ...current, [slot]: { recent: false, rights: false } })); }
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
    <NoteList className="mt-5" items={[{ title: "필수 3장 + 선택 1장", body: <>최근 {BEFORE_US.operatingDraft.photos.recentMonths}개월 안에 찍은 서로 다른 사진을 올려 주세요.</> }, { title: "파일 형식", body: <>JPG·PNG·WebP, 한 장에 10MB 이하. 짧은 변 {BEFORE_US.photoFiles.recommendedShortSide}px 이상을 권해요. HEIC는 아직 받을 수 없어요.</> }, { title: "위치정보는 지워요", body: <span className="font-medium text-accent">올리기 전에 이 기기에서 다시 저장해 촬영 위치 같은 정보를 지워요.</span> }, { title: "볼 수 있는 사람", body: "운영진과, 소개가 열린 동안의 상대만 볼 수 있어요." }]} />
    <div className="mt-7 grid gap-5 lg:grid-cols-2">{PHOTO_SLOTS.map(slot => { const row = bySlot[slot.id]; const state = confirm[slot.id] || { recent: false, rights: false }; const ready = state.recent && state.rights; const loading = busy === slot.id; return <article key={slot.id} className="flex flex-col border border-border bg-card" aria-labelledby={`${slot.id}-title`}>
      <div className="flex items-center justify-between gap-3 border-b border-border p-5"><div className="flex items-center gap-3"><span className="text-3xl font-light text-primary">0{slot.number}</span><div><h4 id={`${slot.id}-title`} className="text-sm font-semibold">{slot.label}</h4><p className="mt-1 text-xs text-muted-foreground">{slot.required ? "필수" : "선택 · 없어도 신청 가능"}{slot.number === 1 ? " · 대표 사진" : ""}</p></div></div><span className="text-xs font-medium text-accent">{row ? row.review === "대기" ? "검토 대기" : row.review : "미등록"}</span></div>
      <div className="p-5"><div className="relative mx-auto aspect-[4/5] max-w-52 overflow-hidden border border-border"><Thumbnail path={row?.path ?? null} number={slot.number} />{!row && <span className="absolute inset-x-0 bottom-0 bg-card/90 px-3 py-2 text-center text-xs text-muted-foreground">이런 구도면 좋아요</span>}</div><p className="mt-4 min-h-12 text-xs leading-6 text-muted-foreground">{slot.description}</p>
        {row && <p className="mt-3 text-xs text-muted-foreground">{row.width} × {row.height}px · {(row.bytes / (1024 * 1024)).toFixed(1)}MB{Math.min(row.width, row.height) < BEFORE_US.photoFiles.recommendedShortSide ? " · 조금 작은 사진이에요" : ""}</p>}
        {row?.review === "재등록 요청" && <p className="mt-4 rounded-xl bg-muted p-3 text-xs leading-6">보완 사유: {row.reason || "운영진 안내 확인"} · 이 사진만 다시 올려 주세요.</p>}
        {editable && <div className="mt-5 space-y-3 border-t border-border pt-4"><label className="flex cursor-pointer items-start gap-2.5 text-xs leading-6"><Checkbox className="mt-1" checked={state.recent} onCheckedChange={checked => setConfirm(current => ({ ...current, [slot.id]: { ...state, recent: checked === true } }))} /><span>최근 {BEFORE_US.operatingDraft.photos.recentMonths}개월 안에 찍은 지금의 내 모습이고, 다른 칸과 다른 사진이에요.</span></label><label className="flex cursor-pointer items-start gap-2.5 text-xs leading-6"><Checkbox className="mt-1" checked={state.rights} onCheckedChange={checked => setConfirm(current => ({ ...current, [slot.id]: { ...state, rights: checked === true } }))} /><span>내가 올릴 권리가 있는 사진이에요.</span></label>
          <input ref={element => { inputs.current[slot.id] = element; }} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void pick(slot.id, file); }} />
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!ready || loading} onClick={() => inputs.current[slot.id]?.click()} className={`h-10 rounded-xl border-border text-xs hover:bg-muted hover:text-foreground ${interaction}`}>{loading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}{row ? "사진 바꾸기" : "사진 올리기"}</Button>{row && <Button variant="ghost" disabled={loading} aria-label={`${slot.label} 사진 삭제`} onClick={() => void remove(slot.id)} className={`h-10 rounded-xl text-xs text-muted-foreground hover:bg-muted hover:text-foreground ${interaction}`}><Trash2 size={13} />삭제</Button>}</div>
          {!ready && <p className="text-[11px] text-muted-foreground">두 가지를 확인하면 사진을 고를 수 있어요.</p>}
        </div>}
        {failure[slot.id] && <p role="alert" className="mt-4 flex items-start gap-2 text-xs leading-6 text-destructive"><AlertCircle size={14} className="mt-1 shrink-0" />{failure[slot.id]}</p>}
        {errors[slot.id] && <p role="alert" className="mt-4 text-xs leading-6 text-destructive">{errors[slot.id]}</p>}
      </div>
    </article>; })}</div>
    <NoteList className="mt-7" title="사진을 고르기 전에" items={[{ title: "피해 주세요", body: "AI로 만든 인물·다른 사람의 사진·과한 보정·단체 사진·알아볼 수 있는 다른 사람·주소나 연락처가 담긴 사진" }, { title: "사진 확인의 의미", body: "외모나 인성을 평가하거나 안전을 인증하는 일이 아니에요. 필수 3장으로 신청할 수 있고, 운영진이 확인한 뒤 소개가 준비돼요." }]} />
  </section>;
}
