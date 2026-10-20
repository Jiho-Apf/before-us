import { BEFORE_US } from "./config";

// 알림 받을 방법 안내(베타): 카카오톡·문자 알림은 아직 보내지 않으므로, 고르면 바로 알려 주고 메일로 이끈다.
export function ChannelNotice({ kakao, sms, email }: { kakao: boolean; sms: boolean; email: boolean }) {
  if (!BEFORE_US.beta.active || (!kakao && !sms)) return null;
  const missing = [kakao && "카카오톡", sms && "문자"].filter(Boolean).join("·");
  return (
    <p role="status" className={`mt-3 rounded-xl border px-4 py-3 text-xs leading-6 ${email ? "border-border bg-mist" : "border-primary/30 bg-primary/5"}`}>
      <span className="font-semibold">현재 베타 버전에서는 {missing} 알림을 지원하지 않고 있어요.</span>{" "}
      {email ? "지금은 사이트와 메일로 알려 드려요. 정식 운영부터 고르신 방법으로도 보내 드릴게요." : "지금은 사이트와 메일로만 알려 드려요. 소개 도착과 답 마감을 놓치지 않도록 ‘메일’도 함께 골라 주세요."}
    </p>
  );
}
