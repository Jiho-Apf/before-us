import { BEFORE_US } from "./config";

export const PHOTO_SLOTS = [
  { id: "photo.face", number: 1, label: "대표 얼굴", required: true, description: "혼자, 정면 또는 가까운 구도, 얼굴이 또렷함. 마스크·선글라스·과한 보정 없음.", composition: "얼굴이 또렷한 가까운 구도", purpose: "대표 사진 · 얼굴 확인", format: "photo", scope: "partner", rule: "three-required-unique-files-and-self-confirmation" },
  { id: "photo.upper", number: 2, label: "자연스러운 상반신", required: true, description: "일상의 표정·분위기. 1번 단순 확대·복제 불가.", composition: "표정과 분위기가 보이는 상반신", purpose: "일상의 표정과 분위기 참고", format: "photo", scope: "partner", rule: "three-required-unique-files-and-self-confirmation" },
  { id: "photo.style", number: 3, label: "전체 스타일", required: true, description: "평소 옷차림으로 전신 또는 전체 체형·스타일을 볼 수 있음. 노출·속옷·치수 인증 요구 금지.", composition: "평소 옷차림과 전체 스타일", purpose: "평소 옷차림과 스타일 참고 · 몸 측정 없음", format: "photo", scope: "partner", rule: "three-required-unique-files-and-self-confirmation" },
  { id: "photo.daily", number: 4, label: "취향·일상", required: false, description: "본인이 나온 취미·활동 사진. 없어도 신청 가능.", composition: "본인이 나온 취미·활동 구도", purpose: "취향과 일상 참고 · 미등록 가능", format: "photo", scope: "partner", rule: "optional-file-and-self-confirmation" },
] as const;
export type PhotoSlotId = typeof PHOTO_SLOTS[number]["id"];
export const PHOTO_REVIEW_REASONS = ["얼굴 확인 어려움", "동일 사진", "흐림", "타인 등장", "현재 모습 재등록 필요"] as const;
export type PhotoReview = "대기" | "기준 확인" | "재등록 요청";
export type MockPhotoFile = { id: string; name: string; mime: string; bytes: number; width: number; height: number };
export const MOCK_PHOTO_FILES: readonly MockPhotoFile[] = [
  { id: "mock-face", name: "가상_얼굴.jpg", mime: "image/jpeg", bytes: 1200000, width: 1200, height: 1600 },
  { id: "mock-upper", name: "가상_상반신.png", mime: "image/png", bytes: 2100000, width: 1600, height: 1200 },
  { id: "mock-style", name: "가상_스타일.webp", mime: "image/webp", bytes: 1800000, width: 1200, height: 1800 },
  { id: "mock-daily", name: "가상_일상.jpeg", mime: "image/jpeg", bytes: 1600000, width: 1200, height: 1200 },
  { id: "mock-small", name: "가상_작은사진.jpg", mime: "image/jpeg", bytes: 220000, width: 600, height: 700 },
  { id: "mock-large", name: "가상_용량초과.png", mime: "image/png", bytes: 12 * 1024 * 1024, width: 2000, height: 2000 },
  { id: "mock-heic", name: "가상_변환필요.heic", mime: "image/heic", bytes: 1500000, width: 1200, height: 1600 },
];
export type PhotoRecord = {
  file: MockPhotoFile | null; attempt: MockPhotoFile | null; status: "empty" | "ready" | "failed";
  error: string | null; review: PhotoReview; reason: typeof PHOTO_REVIEW_REASONS[number] | null;
  recentSelfConfirmed: boolean; rightsSelfConfirmed: boolean; revision: number;
  activeProposalPhoto: { file: MockPhotoFile; revision: number } | null;
};
export type ApplicationPhotos = Record<PhotoSlotId, PhotoRecord>;
export const emptyPhoto = (): PhotoRecord => ({ file: null, attempt: null, status: "empty", error: null, review: "대기", reason: null, recentSelfConfirmed: false, rightsSelfConfirmed: false, revision: 0, activeProposalPhoto: null });
export const emptyPhotos = (): ApplicationPhotos => Object.fromEntries(PHOTO_SLOTS.map(slot => [slot.id, emptyPhoto()])) as ApplicationPhotos;

export function mockFileError(file: MockPhotoFile) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "heic" || file.mime === "image/heic") return "HEIC 변환 기능이 연결되어 있지 않습니다. JPG·PNG·WebP로 변환한 뒤 등록해 주세요. (가상 파일 검사)";
  const expected = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  if (!extension || !BEFORE_US.photoFiles.allowedExtensions.some(allowed => allowed === extension) || !(extension in expected) || expected[extension as keyof typeof expected] !== file.mime) return "JPG/JPEG·PNG·WebP 형식만 사용합니다. (가상 파일 정보 검사)";
  if (!Number.isInteger(file.bytes) || file.bytes <= 0 || file.bytes > BEFORE_US.photoFiles.maximumBytes) return "장당 10MB 이하 파일을 선택해 주세요. (가상 파일 용량 검사)";
  if (!Number.isInteger(file.width) || !Number.isInteger(file.height) || file.width <= 0 || file.height <= 0) return "가상 파일의 이미지 크기 정보가 유효하지 않습니다.";
  return null;
}
export function registerMockPhoto(photos: ApplicationPhotos, id: PhotoSlotId, file: MockPhotoFile, simulateFailure = false): ApplicationPhotos {
  const old = photos[id];
  const duplicate = PHOTO_SLOTS.some(slot => slot.id !== id && photos[slot.id].file?.id === file.id);
  const error = mockFileError(file) || (duplicate ? "동일 가상 파일이 다른 슬롯에 있습니다. 서로 다른 사진을 선택해 주세요." : null) || (simulateFailure ? "가상 등록 실패입니다. 재시도로 다시 확인할 수 있습니다." : null);
  const record: PhotoRecord = error ? { ...old, attempt: file, status: "failed", error } : { ...emptyPhoto(), file: { ...file }, attempt: null, status: "ready", revision: old.revision + 1, activeProposalPhoto: old.activeProposalPhoto };
  return { ...photos, [id]: record };
}
export function retryMockPhoto(photos: ApplicationPhotos, id: PhotoSlotId) {
  const file = photos[id].attempt;
  return file ? registerMockPhoto(photos, id, file) : photos;
}
export function deletePhoto(photos: ApplicationPhotos, id: PhotoSlotId): ApplicationPhotos {
  return { ...photos, [id]: { ...emptyPhoto(), revision: photos[id].revision + 1, activeProposalPhoto: photos[id].activeProposalPhoto } };
}
export function photoError(photos: ApplicationPhotos, id: PhotoSlotId) {
  const slot = PHOTO_SLOTS.find(slot => slot.id === id)!;
  const record = photos[id];
  if (!record || record.status === "empty") return slot.required ? `${slot.number}번 ${slot.label} 사진이 필요합니다. (가상 등록)` : null;
  if (record.status === "failed") return record.error || "등록 실패 상태를 확인해 주세요.";
  if (!record.file) return "가상 파일을 선택해 주세요.";
  const fileError = mockFileError(record.file);
  if (fileError) return fileError;
  if (PHOTO_SLOTS.some(other => other.id !== id && photos[other.id].file?.id === record.file?.id)) return "서로 다른 사진을 선택해 주세요.";
  if (!record.recentSelfConfirmed || !record.rightsSelfConfirmed) return "최근 촬영·현재 모습과 사진 제공 권리를 본인이 확인해 주세요.";
  if (record.review === "재등록 요청") return `이 사진만 재등록해 주세요: ${record.reason || "보완 사유 확인 필요"}`;
  return null;
}
export function clonePhotos(photos: ApplicationPhotos): ApplicationPhotos {
  return Object.fromEntries(PHOTO_SLOTS.map(slot => { const record = photos[slot.id] || emptyPhoto(); return [slot.id, { ...record, file: record.file ? { ...record.file } : null, attempt: record.attempt ? { ...record.attempt } : null, activeProposalPhoto: record.activeProposalPhoto ? { file: { ...record.activeProposalPhoto.file }, revision: record.activeProposalPhoto.revision } : null }]; })) as ApplicationPhotos;
}
export function activeProposalPhotos(photos: ApplicationPhotos) {
  return PHOTO_SLOTS.flatMap(slot => photos[slot.id].activeProposalPhoto ? [{ slot: slot.id, ...photos[slot.id].activeProposalPhoto! }] : []);
}
