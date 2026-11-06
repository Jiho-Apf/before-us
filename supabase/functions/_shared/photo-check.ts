// 상대에게 사진 주소를 주기 전 바이트 확인(GPT 3차 검수 R3-18).
// 화면은 사진을 캔버스로 다시 그려 JPG로 올리므로 위치 정보(EXIF GPS)가 없다. 화면을 거치지 않고 저장소 API로 바로 올린 파일은
// 서버가 내용을 다시 그리지 않으므로, 상대에게 보이기 전에 여기서 확인한다:
//  · 진짜 JPG인지(앞 3바이트 FF D8 FF · 끝까지 마커 구조가 맞는지)  · 크기 상한
//  · EXIF(APP1)에 위치 정보 묶음(GPS IFD, 태그 0x8825)이 있는지  · XMP(APP1)에 GPS 항목이 있는지
// 카메라 기종·촬영 시각 같은 다른 EXIF는 위치만큼 위험하지 않고, 일부 브라우저의 캔버스 JPG에도 들어갈 수 있어 막지 않는다.
export type PhotoCheck = { ok: true } | { ok: false; reason: string }

const MAX_BYTES = 10 * 1024 * 1024

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
  if (bytes.length < 4 || bytes.length > MAX_BYTES) return { ok: false, reason: "크기" }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return { ok: false, reason: "JPG가 아님" }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return { ok: false, reason: "JPG 구조가 깨짐" }
    const marker = bytes[at + 1]
    if (marker === 0xd9 || marker === 0xda) return { ok: true } // 이미지 끝 · 본문 시작(그 뒤는 압축 자료)
    if (marker === 0xff) { at++; continue }
    if (marker >= 0xd0 && marker <= 0xd7) { at += 2; continue }
    const size = view.getUint16(at + 2)
    if (size < 2 || at + 2 + size > bytes.length) return { ok: false, reason: "JPG 구조가 깨짐" }
    const body = at + 4, bodyLength = size - 2
    if (marker === 0xe1 && bodyLength >= 6) {
      const head = String.fromCharCode(...bytes.subarray(body, body + Math.min(bodyLength, 29)))
      if (head.startsWith("Exif\0\0") && hasGpsInTiff(view, body + 6, bodyLength - 6)) return { ok: false, reason: "위치 정보(EXIF GPS)" }
      if (head.startsWith("http://ns.adobe.com/xap/1.0/")) {
        const xmp = new TextDecoder().decode(bytes.subarray(body, body + bodyLength))
        if (/exif:GPS(Latitude|Longitude)|GPSLatitude|GPSLongitude/i.test(xmp)) return { ok: false, reason: "위치 정보(XMP GPS)" }
      }
    }
    at += 2 + size
  }
  return { ok: false, reason: "JPG 구조가 깨짐" }
}
