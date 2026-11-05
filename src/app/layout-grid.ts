// 휴대폰에서 같은 종류의 단추·칩을 칸으로 나눌 때, 마지막 줄에 하나만 떨어지지 않는 칸 수.
// 넓은 화면(sm 이상)은 그대로 한 줄로 흘려 놓는다. Tailwind가 찾을 수 있게 칸 이름은 글자 그대로 둔다.
const COLS = ["grid-cols-1", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-2", "grid-cols-3", "grid-cols-3"] as const;
export const evenCols = (count: number) => COLS[Math.max(0, Math.min(count, COLS.length - 1))];
