import { BEFORE_US } from "./config";

// 알림 받을 방법 안내(베타): 카카오톡·문자 알림은 아직 보내지 않는다. 고르면 바로 알려 주고, 꼭 필요한 알림은 메일로 간다고 안내한다.
export function ChannelNotice({ kakao, sms }: { kakao: boolean; sms: boolean; email?: boolean }) {
  if (!BEFORE_US.beta.active || (!kakao && !sms)) return null;
  const missing = [kakao && "카카오톡", sms && "문자"].filter(Boolean).join("·");
  return (
    <p role="status" className="mt-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-xs leading-6">
      <span className="font-semibold">현재 베타 버전에서는 {missing} 알림을 지원하지 않고 있어요.</span>{" "}
      대신 소개 도착·마감처럼 꼭 필요한 알림은 가입한 메일로 보내 드려요. 정식 운영부터는 고르신 방법으로 보내 드릴게요.
    </p>
  );
}
