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

/** Mantine Badge 색. light는 Mantine light 변형(밝은 바탕 + 짙은 글자), filled는 채운 바탕 + 흰 글자다. */
export const badgeTone = {
  'brand-light': 'bg-[#d2f2df] text-[#005c32]',
  'red-light': 'bg-[#ffe3e3] text-[#c92a2a]',
  // theme.ts가 노랑 light를 경고 토큰으로 바꾼다.
  'yellow-light': 'bg-status-warning text-status-warning-foreground',
  'gray-light': 'bg-[#f1f3f5] text-[#212529]',
  'dark-light': 'bg-[#b8b8b8] text-[#141414]',
  'brand-filled': 'bg-primary text-white',
  'dark-filled': 'bg-[#2e2e2e] text-white',
} as const;

export type BadgeColor = 'brand' | 'red' | 'yellow' | 'gray' | 'dark';

/** Mantine Badge circle(xs): 정사각형, 좌우 여백 2px. */
export const badgeCircle = 'w-4 px-0.5';
