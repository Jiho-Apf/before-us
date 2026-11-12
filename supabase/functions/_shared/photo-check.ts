// 상대에게 사진 주소를 주기 전 바이트 확인(GPT 3차 검수 R3-18 · 4차 검수 R4-08).
// 화면은 사진을 캔버스로 다시 그려 JPG로 올리므로 위치 정보(EXIF GPS)가 없다. 화면을 거치지 않고 저장소 API로 바로 올린 파일은
// 서버가 내용을 다시 그리지 않으므로, 상대에게 보이기 전에 여기서 확인한다.
//
// 이 검사가 보장하는 것(구조 검사):
//  · JPG 파일 틀이 처음부터 끝까지 맞다: 시작(SOI) → 표(DQT·DHT) → 크기 정보(SOF, 기본·점진 방식만) → 본문(SOS + 압축 자료) → 끝(EOI), 끝 뒤에 남는 바이트 없음
//  · 적힌 가로·세로가 1~4096px, 1,200만 화소 이하이고 색 성분이 1개 또는 3개다
//  · 압축 자료가 적힌 크기에 비해 터무니없이 적지 않다(잘린 파일 · 틀만 있는 파일을 거른다)
//  · EXIF(APP1)에 위치 정보 묶음(GPS IFD, 태그 0x8825)이 없고, XMP(APP1)에 GPS 항목이 없다
// 보장하지 않는 것: 모든 화소가 실제로 풀리는지(디코딩)는 확인하지 않는다. 화소까지의 확인은
//  ① 화면이 캔버스로 다시 그린 파일만 등록하고 ② 운영진이 사진을 눈으로 보고 ‘기준 확인’을 누르며
//  ③ partner-photo 함수가 ‘지금 파일의 지문(sha256)·크기’가 등록 때 값과 같은지 본다(sameAsRegistered) — 이 셋으로 묶는다.
// 카메라 기종·촬영 시각 같은 다른 EXIF는 위치만큼 위험하지 않고, 일부 브라우저의 캔버스 JPG에도 들어갈 수 있어 막지 않는다.
export type PhotoCheck = { ok: true; width: number; height: number } | { ok: false; reason: string }

const MAX_BYTES = 10 * 1024 * 1024
const MAX_SIDE = 4096
const MAX_PIXELS = 12_000_000
const bad = (reason: string): PhotoCheck => ({ ok: false, reason })

function hasGpsInTiff(view: DataView, start: number, length: number): boolean {
  if (length < 8) return false
  const order = view.getUint16(start)
  const little = order === 0x4949 // "II"
  if (!little && order !== 0x4d4d) return false // "MM"
  const u16 = (at: number) => view.getUint16(start + at, little)
  const u32 = (at: number) => view.getUint32(start + at, little)
  if (u16(2) !== 42) return false
  const ifd0 = u32(4)
  if (ifd0 + 2 > length) return false
  const count = u16(ifd0)
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12
    if (entry + 12 > length) break
    if (u16(entry) === 0x8825) return true // GPSInfo 묶음 위치
  }
  return false
}

export function checkJpeg(bytes: Uint8Array): PhotoCheck {
  if (bytes.length < 4 || bytes.length > MAX_BYTES) return bad("크기")
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return bad("JPG가 아님")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 2
  let width = 0, height = 0, components = 0
  let tables = { quant: false, huffman: false }
  let scans = 0, entropy = 0
  while (at + 2 <= bytes.length) {
    if (bytes[at] !== 0xff) return bad("JPG 구조가 깨짐")
    const marker = bytes[at + 1]
    if (marker === 0xff) { at++; continue } // 채움 바이트
    if (marker === 0xd9) { // 이미지 끝
      if (!scans) return bad("본문(압축 자료)이 없음")
      if (at + 2 !== bytes.length) return bad("끝 표시 뒤에 남는 자료가 있음")
      const blocks = Math.ceil(width / 16) * Math.ceil(height / 16)
      if (entropy < Math.max(2, Math.ceil(blocks / 8))) return bad("압축 자료가 크기에 비해 너무 적음")
      return { ok: true, width, height }
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0x00) return bad("JPG 구조가 깨짐")
    if (at + 4 > bytes.length) return bad("JPG가 끝까지 오지 않음(잘림)")
    const size = view.getUint16(at + 2)
    if (size < 2 || at + 2 + size > bytes.length) return bad("JPG가 끝까지 오지 않음(잘림)")
    const body = at + 4, bodyLength = size - 2
    if (marker === 0xe1 && bodyLength >= 6) {
      const head = String.fromCharCode(...bytes.subarray(body, body + Math.min(bodyLength, 29)))
      if (head.startsWith("Exif\0\0") && hasGpsInTiff(view, body + 6, bodyLength - 6)) return bad("위치 정보(EXIF GPS)")
      if (head.startsWith("http://ns.adobe.com/xap/1.0/")) {
        const xmp = new TextDecoder().decode(bytes.subarray(body, body + bodyLength))
        if (/exif:GPS(Latitude|Longitude)|GPSLatitude|GPSLongitude/i.test(xmp)) return bad("위치 정보(XMP GPS)")
      }
    }
    if (marker === 0xdb) tables.quant = true
    if (marker === 0xc4) tables.huffman = true
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) { // 크기 정보(SOF)
      if (marker > 0xc2) return bad("지원하지 않는 JPG 방식")
      if (width) return bad("크기 정보가 두 번 나옴")
      if (bodyLength < 6) return bad("JPG 구조가 깨짐")
      const precision = bytes[body]
      height = view.getUint16(body + 1); width = view.getUint16(body + 3); components = bytes[body + 5]
      if (precision !== 8 || (components !== 1 && components !== 3) || bodyLength !== 6 + components * 3) return bad("지원하지 않는 JPG 방식")
      if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) return bad("가로·세로 크기")
    }
    at += 2 + size
    if (marker === 0xda) { // 본문 시작: 머리 뒤로 압축 자료가 이어진다
      if (!width || !tables.quant || !tables.huffman) return bad("크기 정보나 표 없이 본문이 시작됨")
      const inScan = bytes[body]
      if (inScan < 1 || inScan > components || bodyLength !== 4 + inScan * 2) return bad("JPG 구조가 깨짐")
      scans++
      // 압축 자료: FF00(채움) · FFD0~D7(다시 시작 표시)은 자료의 일부, 그 밖의 FFxx 는 다음 마커
      while (at < bytes.length) {
        if (bytes[at] !== 0xff) { at++; entropy++; continue }
        if (at + 1 >= bytes.length) return bad("JPG가 끝까지 오지 않음(잘림)")
        const next = bytes[at + 1]
        if (next === 0x00) { at += 2; entropy++; continue }
        if (next >= 0xd0 && next <= 0xd7) { at += 2; continue }
        if (next === 0xff) { at++; continue }
        break
      }
    }
  }
  return bad("JPG가 끝까지 오지 않음(잘림)")
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("")
}

// 등록 때 적힌 값(운영진이 눈으로 확인한 그 파일)과 지금 저장소의 파일이 같은지: 지문과 가로·세로를 함께 본다.
export type Registered = { sha256: string; width: number; height: number }
export async function sameAsRegistered(bytes: Uint8Array, checked: { width: number; height: number }, registered: Registered): Promise<PhotoCheck> {
  if (registered.width !== checked.width || registered.height !== checked.height) return bad("등록한 크기와 다른 파일")
  if ((await sha256Hex(bytes)) !== registered.sha256) return bad("등록한 뒤 바뀐 파일")
  return { ok: true, width: checked.width, height: checked.height }
}
