import { getConsoleData, replaceConsoleData } from "./admin-console-data"

// 회원끼리 주고받는 글(편지·답장·첫 장면 이유) 안전 검사.
//  - 연락처·SNS 아이디·외부 링크·계좌번호: 보내기 전에 막는다. 연락처는 두 사람이 동의하면 만나는 날 플라비 안에서 열린다.
//  - 돈 이야기(송금·투자·코인·대출 등): 막지는 않되 운영진 신고함에 자동으로 표시한다(로맨스 스캠 대비).
// 운영진에게는 글 원문이 아니라 ‘무엇이 감지됐는지’만 남긴다. 운영진은 신고가 확인된 교류만 원문을 연다.

const PATTERNS: { kind: "phone" | "email" | "link" | "messenger" | "account"; re: RegExp }[] = [
  { kind: "phone", re: /(?:\+?82[\s.-]?)?0?1[016789][\s.-]?\d{3,4}[\s.-]?\d{4}|(?:\d[\s.-]?){10,11}|공일공|영일영/ },
  { kind: "email", re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
  { kind: "link", re: /https?:\/\/|www\.|\b[\w-]+\.(?:com|net|org|kr|co\.kr|me|io|ly|link|app|page)\b/i },
  { kind: "messenger", re: /(?:카톡|카카오톡|텔레그램|오픈\s*채팅|오픈톡|라인)\s*(?:아이디|id|주소|링크|추가|으로\s*(?:연락|얘기|대화)|주세요|할래요)|(?:인스타|instagram|insta)\s*(?:아이디|계정|id|팔로우|디엠|dm)|(?:아이디|id)\s*(?:는|은|:)\s*[A-Za-z0-9_.]{3,}|(?:^|\s)@[A-Za-z0-9_.]{3,}/i },
  { kind: "account", re: /(?:국민|신한|우리|하나|농협|기업|카카오뱅크|토스|케이뱅크|새마을|우체국|SC|씨티)\s*(?:은행)?\s*\d|\d{2,6}-\d{2,6}-\d{2,7}/ },
]
const MONEY = /송금|입금|이체|계좌|돈\s*(?:좀|을|빌려|보내)|빌려\s*(?:줄|주실|줘)|투자|코인|비트코인|리딩방|대출|상품권|기프티콘\s*(?:보내|사)|급하게\s*돈/

export const SAFETY_BLOCK_MESSAGE = "연락처·SNS 아이디·링크·계좌번호는 보낼 수 없어요. 연락처는 두 분이 동의하면 만나는 날 플라비에서 열려요."
export const SAFETY_COMPOSE_NOTE = "돈이나 외부 연락처를 요구받으면 바로 신고해 주세요. 운영진은 편지를 읽지 않고, 신고가 들어온 교류만 확인해요."

export function checkMessage(text: string) {
  const compact = text.normalize("NFKC")
  const leak = PATTERNS.find((pattern) => pattern.re.test(compact))?.kind ?? null
  return { leak, money: MONEY.test(compact) }
}

const flagged = new Set<string>()
function flag(memberId: string, where: string, type: string) {
  const key = `${memberId}:${where}:${type}`
  if (flagged.has(key)) return
  flagged.add(key)
  const data = getConsoleData()
  replaceConsoleData({
    ...data,
    reports: [
      ...data.reports,
      { id: `auto-${data.reports.length + 1}-${Date.now().toString(36)}`, memberId, reporterId: "자동 감지", targetId: memberId, type, description: `${where}에서 감지 · 원문은 신고 확인 뒤에만 열람`, priority: type.startsWith("금전") ? "긴급" : "일반", urgent: type.startsWith("금전"), status: "new", createdAt: new Date().toISOString() },
    ],
  })
}

// 명령(command) 안의 모든 글을 검사한다. 막아야 하면 안내 문구를, 괜찮으면 null을 돌려준다.
export function guardMemberText(command: unknown, memberId: string, where: string): string | null {
  const texts: string[] = []
  const collect = (value: unknown) => {
    if (typeof value === "string") texts.push(value)
    else if (value && typeof value === "object") Object.values(value).forEach(collect)
  }
  collect(command)
  const joined = texts.join("\n")
  if (!joined.trim()) return null
  const { leak, money } = checkMessage(joined)
  if (money) flag(memberId, where, "금전 관련 표현 감지")
  if (leak) { flag(memberId, where, "연락처·링크 전달 시도(차단됨)"); return SAFETY_BLOCK_MESSAGE }
  return null
}
