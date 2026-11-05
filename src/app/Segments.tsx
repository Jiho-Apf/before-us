import { Fragment } from "react";

// ‘베타 무료 · 신청 마감 11월 12일(목) · 첫 소개 11월 16일 정오’처럼 조각을 ‘ · ’로 이을 때,
// 줄은 조각 사이에서만 바뀌게 한다(조각 하나가 한 줄보다 길 때만 그 안에서 바뀐다). 가운뎃점은 앞 조각 끝에 붙여 줄 머리에 오지 않게.
export function Segments({ parts }: { parts: (string | null | false | undefined)[] }) {
  const list = parts.filter((part): part is string => !!part);
  return <>{list.map((part, index) => <Fragment key={index}>{index > 0 && " "}<span className="inline-block">{part}{index < list.length - 1 ? " ·" : ""}</span></Fragment>)}</>;
}
