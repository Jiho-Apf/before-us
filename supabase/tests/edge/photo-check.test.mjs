// 상대 사진 주소를 주기 전 바이트 확인(GPT 3차 검수 R3-18) + 닫힌 뒤 주소 재발급 거절(R3-20). 가짜 바이트만 쓴다.
// 실행: node supabase/tests/edge/photo-check.test.mjs
//  1) _shared/photo-check.ts: 진짜 JPG · EXIF(II/MM)의 GPS 묶음 · XMP GPS · PNG·글자 파일·잘린 파일·10MB 초과
//  2) partner-photo 함수 원본(harness): 깨끗한 사진은 5분 주소 · 위치 정보가 든 사진은 403 + 운영진 기록 · 권한 없는 회원 403
//     · 차단으로 소개가 닫힌 뒤 · 상대가 탈퇴를 요청한 뒤에는 주소를 다시 받을 수 없다(R3-20)
//  3) letter-photo 함수 원본: 회원이 여는 편지 사진도 같은 확인
import assert from "node:assert/strict"
import { join } from "node:path"
import { startEdge, repo } from "./harness.mjs"
import { serial } from "./fake-supabase.mjs"

let passed = 0
const ok = (label, value) => { assert.ok(value, label); passed++; console.log("✓", label) }
const { checkJpeg } = await import("../../functions/_shared/photo-check.ts")

// 진짜 JPG: 크롬 캔버스(toBlob, 0.9)가 만든 64×80 그림(fixtures/photos · 가짜 그림). 그 사이에 조각을 끼워 반례를 만든다.
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
const REAL = Buffer.from(readFileSync(join(repo, "supabase/tests/edge/fixtures/photos/canvas-64x80.jpg.b64"), "utf8").trim(), "base64")
const seg = (marker, body) => { const b = Buffer.from(body); const len = Buffer.alloc(2); len.writeUInt16BE(b.length + 2); return Buffer.concat([Buffer.from([0xff, marker]), len, b]) }
const jfif = Buffer.alloc(0)
// 시작 표시(FFD8) 바로 뒤에 조각을 끼운 진짜 JPG
const jpeg = (...parts) => new Uint8Array(Buffer.concat([REAL.subarray(0, 2), ...parts, REAL.subarray(2)]))
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex")
function exif(little, tags) {
  const head = Buffer.from(little ? "II" : "MM", "latin1")
  const w16 = (v) => { const b = Buffer.alloc(2); little ? b.writeUInt16LE(v) : b.writeUInt16BE(v); return b }
  const w32 = (v) => { const b = Buffer.alloc(4); little ? b.writeUInt32LE(v) : b.writeUInt32BE(v); return b }
  const entries = tags.map((tag) => Buffer.concat([w16(tag), w16(4), w32(1), w32(26)]))
  const tiff = Buffer.concat([head, w16(42), w32(8), w16(tags.length), ...entries, w32(0)])
  return seg(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]))
}
const clean = jpeg(jfif)
const withGps = jpeg(jfif, exif(true, [0x0112, 0x8825]))
const first = checkJpeg(clean)
ok("1) 크롬 캔버스가 만든 진짜 JPG는 통과하고 가로·세로(64×80)를 읽는다", first.ok && first.width === 64 && first.height === 80)
// R4-08 반례: 틀만 있고 그림이 없는 파일
const six = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])
ok("1) (R4-08) 시작+본문 표시 6바이트는 거절", !checkJpeg(six).ok)
const fakeScan = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")), Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0]), Buffer.from("가짜 압축 자료"), Buffer.from([0xff, 0xd9])])
ok("1) (R4-08) 표·크기 정보 없이 마커와 가짜 압축 글자만 있는 파일(예전 시험의 ‘깨끗한 JPG’)은 거절", !checkJpeg(new Uint8Array(fakeScan)).ok)
ok("1) (R4-08) 본문 도중에 잘린 파일은 거절", !checkJpeg(clean.subarray(0, clean.length - 200)).ok)
ok("1) (R4-08) 끝 표시(FFD9)가 없는 파일은 거절", !checkJpeg(clean.subarray(0, clean.length - 2)).ok)
ok("1) (R4-08) 끝 표시 뒤에 자료가 붙은 파일은 거절", !checkJpeg(new Uint8Array(Buffer.concat([REAL, Buffer.from("뒤에 붙인 자료")]))).ok)
const sofAt = REAL.indexOf(Buffer.from([0xff, 0xc0]))
const huge = Buffer.from(REAL); huge.writeUInt16BE(5000, sofAt + 5); huge.writeUInt16BE(5000, sofAt + 7)
ok("1) (R4-08) 적힌 크기가 4096px을 넘으면 거절", sofAt > 0 && !checkJpeg(new Uint8Array(huge)).ok && /크기/.test(checkJpeg(new Uint8Array(huge)).reason))
const big = Buffer.from(REAL); big.writeUInt16BE(4000, sofAt + 5); big.writeUInt16BE(3000, sofAt + 7)
ok("1) (R4-08) 적힌 크기에 비해 압축 자료가 터무니없이 적으면 거절(크기만 부풀린 파일)", !checkJpeg(new Uint8Array(big)).ok)
const noTables = Buffer.concat([REAL.subarray(0, 2), REAL.subarray(sofAt)])
ok("1) (R4-08) 양자화 표가 없는 파일은 거절", !checkJpeg(new Uint8Array(noTables)).ok)
const { sameAsRegistered, sha256Hex } = await import("../../functions/_shared/photo-check.ts")
ok("1) (R4-08) 지문 계산이 Node의 sha256과 같다", (await sha256Hex(clean)) === sha(clean))
ok("1) (R4-08) 등록 값과 지문·크기가 같으면 통과", (await sameAsRegistered(clean, first, { sha256: sha(clean), width: 64, height: 80 })).ok)
ok("1) (R4-08) 등록 뒤 바뀐 파일(지문 다름)은 거절", !(await sameAsRegistered(clean, first, { sha256: "0".repeat(64), width: 64, height: 80 })).ok)
ok("1) (R4-08) 등록한 가로·세로와 다르면 거절", !(await sameAsRegistered(clean, first, { sha256: sha(clean), width: 1280, height: 1600 })).ok)
ok("1) 방향·기종만 있는 EXIF(II)는 통과(위치 정보 아님)", checkJpeg(jpeg(jfif, exif(true, [0x0112, 0x010f]))).ok)
ok("1) EXIF(II)에 위치 정보 묶음(0x8825)이 있으면 거절", !checkJpeg(withGps).ok && /GPS/.test(checkJpeg(withGps).reason))
ok("1) EXIF(MM · 큰 끝 순서)의 위치 정보도 거절", !checkJpeg(jpeg(jfif, exif(false, [0x8825]))).ok)
ok("1) XMP에 GPS 위도가 있으면 거절", !checkJpeg(jpeg(jfif, seg(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:Description exif:GPSLatitude=\"37,33.5N\"/></x:xmpmeta>", "latin1")))).ok)
ok("1) PNG는 거절(JPG가 아님)", !checkJpeg(new Uint8Array(Buffer.from("\x89PNG\r\n\x1a\n0000", "latin1"))).ok)
ok("1) 이름만 jpg인 글자 파일은 거절", !checkJpeg(new Uint8Array(Buffer.from("PLAINTEXT-PHOTO 가짜"))).ok)
ok("1) 구조가 잘린 JPG는 거절", !checkJpeg(clean.subarray(0, 12)).ok)
ok("1) 10MB를 넘으면 거절", !checkJpeg(new Uint8Array(10 * 1024 * 1024 + 1)).ok)

// 2) partner-photo
const edge = await startEdge()
const q = edge.q
let seq = 0
const signup = async () => (await q("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [`pc-${++seq}@example.test`, { adult: true, terms_version: "t", privacy_version: "t" }]))[0].id
const asMember = (id, sql, params = []) => serial(async () => {
  await edge.db.query("begin")
  try {
    await edge.db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated", aal: "aal1" })])
    await edge.db.query("set local role authenticated")
    const rows = (await edge.db.query(sql, params)).rows
    await edge.db.query("commit"); return rows
  } catch (error) { await edge.db.query("rollback"); throw error }
})
const A = await signup(), B = await signup(), C = await signup()
const good = `${A}/photo.face-good.jpg`, gps = `${A}/photo.upper-gps.jpg`
for (const [path, bytes] of [[good, clean], [gps, withGps]]) {
  await q("insert into storage.objects (bucket_id, name, owner) values ('application-photos', $1, $2)", [path, A])
  edge.state.bytes.set(`application-photos/${path}`, bytes)
}
const intro = (await q("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at) values ($1, $2, '두 분 모두 산책을 좋아하셨어요.', 'published', now() - interval '1 hour', now() + interval '20 hours', now() + interval '20 hours', $3, '{}', now() - interval '1 hour') returning id",
  [A, B, JSON.stringify({ version: 1, items: [], photos: [{ slot: "photo.face", path: good }, { slot: "photo.upper", path: gps }] })]))[0].id
const partner = await edge.load(join(repo, "supabase/functions/partner-photo/index.ts"))
const ask = async (who, path) => { const res = await partner(new Request("http://edge.test/partner-photo", { method: "POST", headers: { Authorization: `Bearer ${who}`, "Content-Type": "application/json" }, body: JSON.stringify({ path }) })); return { status: res.status, body: await res.json() } }
const r1 = await ask(B, good)
ok("2) 소개 상대는 깨끗한 사진의 5분 주소를 받는다", r1.status === 200 && /ttl=300/.test(r1.body.url))
const r2 = await ask(B, gps)
const flagged = (await q("select detail from public.job_runs where job = 'photo-check' order by id desc limit 1"))[0]
ok("2) 위치 정보가 든 사진은 주소를 주지 않고(403) 운영진 기록(photo-check)에 남는다", r2.status === 403 && !r2.body.url && flagged?.detail.path === gps && /GPS/.test(flagged.detail.error))
ok("2) 소개 상대가 아닌 회원은 403", (await ask(C, good)).status === 403)
// R4-08: 등록 줄이 있으면 지문·크기 대조
const reg = (member, slot, path, bytes, w = 64, h = 80) => q("insert into public.application_photos (member_id, slot, path, mime, bytes, width, height, sha256, recent_confirmed, rights_confirmed) values ($1, $2, $3, 'image/jpeg', $4, $5, $6, $7, true, true)", [member, slot, path, bytes.length, w, h, sha(bytes)])
await reg(A, "photo.face", good, clean)
ok("2) (R4-08) 등록한 지문·크기와 같은 파일은 주소를 받는다", (await ask(B, good)).status === 200)
const swapped = jpeg(seg(0xfe, Buffer.from("등록 뒤 바꿔치기한 파일")))
edge.state.bytes.set(`application-photos/${good}`, swapped)
const r3 = await ask(B, good)
const flagged2 = (await q("select detail from public.job_runs where job = 'photo-check' order by id desc limit 1"))[0]
ok("2) (R4-08) 등록 뒤 저장소 파일이 바뀌면(구조는 정상이어도) 주소를 주지 않고 운영진 기록에 남는다", r3.status === 403 && !r3.body.url && flagged2?.detail.path === good && /바뀐 파일/.test(flagged2.detail.error))
edge.state.bytes.set(`application-photos/${good}`, six)
ok("2) (R4-08) 6바이트 가짜 파일은 주소를 받지 못한다", (await ask(B, good)).status === 403)
edge.state.bytes.set(`application-photos/${good}`, clean)
ok("2) (R4-08) 원래 파일로 돌아오면 다시 주소를 받는다(사용자가 교체·복구 가능)", (await ask(B, good)).status === 200)
ok("2) 로그인 없이 부르면 401", (await partner(new Request("http://edge.test/partner-photo", { method: "POST", body: JSON.stringify({ path: good }) }))).status === 401)
// R3-20: 차단으로 닫힌 뒤 · 탈퇴 요청 뒤에는 주소 재발급 거절
await asMember(B, "select public.block_member($1)", [A])
ok("2) (R3-20) 차단으로 소개가 닫히면 같은 사진 주소를 다시 받을 수 없다", (await ask(B, good)).status === 403)
const D = await signup()
const good2 = `${D}/photo.face-good.jpg`
await q("insert into storage.objects (bucket_id, name, owner) values ('application-photos', $1, $2)", [good2, D])
edge.state.bytes.set(`application-photos/${good2}`, clean)
await q("insert into public.introductions (member_a, member_b, note, status, reveal_at, respond_by, view_until, snapshot_a, snapshot_b, published_at) values ($1, $2, '두 분 모두 음악을 좋아하셨어요.', 'published', now() - interval '1 hour', now() + interval '20 hours', now() + interval '20 hours', $3, '{}', now() - interval '1 hour')", [D, C, JSON.stringify({ version: 1, items: [], photos: [{ slot: "photo.face", path: good2 }] })])
ok("2) (R3-20) 탈퇴 요청 전에는 상대가 주소를 받는다", (await ask(C, good2)).status === 200)
await asMember(D, "select public.request_withdrawal(array[]::text[], null)")
ok("2) (R3-20) 상대가 탈퇴를 요청하면 바로 주소를 다시 받을 수 없다", (await ask(C, good2)).status === 403)

// 3) letter-photo: 회원이 여는 편지 사진도 확인(쓴 사람이 직접 보는 경우로 시험 · 상대 열람 조건은 db.test에서 확인)
const letter = await edge.load(join(repo, "supabase/functions/letter-photo/index.ts"))
const prog = "11111111-1111-4111-8111-111111111111"
const lp = `${prog}/${C}/day1-abcd1234.jpg`, lpGps = `${prog}/${C}/day1-gps12345.jpg`
for (const [path, bytes] of [[lp, clean], [lpGps, withGps]]) {
  await q("insert into storage.objects (bucket_id, name, owner) values ('letter-photos', $1, $2)", [path, C])
  edge.state.bytes.set(`letter-photos/${path}`, bytes)
}
// 시험 전용: 이 회원이 볼 수 있다고 답하게 can_view_letter_photo 를 잠시 바꿔 끼운다(권한 조건이 아니라 바이트 확인만 보려고)
const original = (await q("select pg_get_functiondef('public.can_view_letter_photo(text)'::regprocedure) d"))[0].d
await q("create or replace function public.can_view_letter_photo(p_name text) returns boolean language sql stable security definer set search_path = '' as $$ select auth.uid() is not null $$")
const askLetter = async (path) => { const res = await letter(new Request("http://edge.test/letter-photo", { method: "POST", headers: { Authorization: `Bearer ${C}` }, body: JSON.stringify({ path }) })); return res.status }
ok("3) 편지 사진: 깨끗한 사진은 주소를 받는다", (await askLetter(lp)) === 200)
ok("3) 편지 사진: 위치 정보가 든 사진은 403", (await askLetter(lpGps)) === 403)
await q(original)
console.log(`사진 바이트 확인 시험 통과: ${passed}개`)
process.exit(0)
