// ① 외형 유지(ui-stack-migration-plan.md §7): Mantine 때 화면과 픽셀까지 같게 그리기 위한 기사 앱 값.
// 값은 Mantine 9.7 기본 팔레트와 packages/ui/src/theme.ts로 그린 화면의 계산된 스타일에서 읽었다.
// 화면 방향(design-direction.md D4) 적용은 ② 단계에서 이 값들을 토큰으로 바꾸면서 한다.

/** Mantine Text 기본: 16px·줄 높이 1.55·여백 0. 글자 크기는 화면마다 inline style로 덮는다. */
export const text = 'm-0 p-0 text-base/[1.55] font-normal';

/** Mantine Title order 4(18px·800·1.45). */
export const titleH4 = 'm-0 text-lg/[1.45] font-extrabold';

/** Mantine Card(radius xl, withBorder, p md). 글자색은 Mantine 본문색(#000)이다. */
export const card = 'relative gap-0 rounded-[32px] text-black';

/** Mantine Badge 크기(높이·좌우 여백·글자). md는 packages/ui Badge 기본값과 같다. */
export const badgeSize = {
  xs: 'h-4 px-1.5 text-[9px] leading-[14px]',
  sm: 'h-[18px] px-2 text-[10px] leading-4',
  md: '',
} as const;

/** Mantine Badge light(밝은 바탕 + 짙은 글자) 색 → packages/ui Badge variant. 노랑은 theme.ts의 경고 토큰이다. */
export const badgeLightVariant = {
  brand: 'light',
  red: 'destructive',
  yellow: 'warning',
  gray: 'secondary',
} as const;

export type BadgeColor = keyof typeof badgeLightVariant;

/** packages/ui Badge에 없는 Mantine dark 색(light: 회색 바탕 + 검정 글자, filled: 짙은 회색 바탕 + 흰 글자). */
export const badgeDark = {
  light: 'bg-[#b8b8b8] text-[#141414]',
  filled: 'bg-[#2e2e2e] text-white',
} as const;

/** Mantine Badge circle(xs): 정사각형, 좌우 여백 2px. */
export const badgeCircle = 'w-4 px-0.5';
