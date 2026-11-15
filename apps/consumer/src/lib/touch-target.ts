// 소비자 화면의 눌리는 영역 최소 크기(design-standard.md §4 "터치 영역 최소 44", 2026-11-13 사용자 결정).
// 공용 부품(@greenhub/ui Button 36·30·42px, Input 36px)의 기본 크기는 그대로 두고, 소비자 화면에서만 className으로 44px를 준다.
// Tailwind 11 단계(2.75rem)는 44px로 var(--touch-target)과 같은 값이다(touch-target.test.mjs가 두 값을 맞춰 본다).

/** 44px. --touch-target과 같은 값. 처리 중 버튼의 도는 원 크기(높이 ÷ 1.8) 계산에 쓴다. */
export const TOUCH_TARGET_PX = 44;

/** 입력칸·직접 그린 버튼의 높이 44px. */
export const TOUCH_HEIGHT = 'h-11';

/** 아이콘만 있는 버튼 44×44px. */
export const TOUCH_ICON = 'size-11';

type TouchButtonSize =
  | 'default'
  | 'xs'
  | 'sm'
  | 'md'
  | 'lg'
  | 'compact-xs'
  | 'compact-sm'
  | 'icon'
  | 'icon-xs'
  | 'icon-sm'
  | 'icon-lg';

// 공용 Button 크기마다 덧씌우는 클래스. 높이·최소 폭 44px이고, 13px 글자 크기(xs·sm·compact-xs)는 15px(text-sm)로 올린다.
// 굵기는 건드리지 않는다. text-sm이 줄 높이를 함께 바꾸지 않도록 공용 버튼의 leading-none을 다시 준다.
// lg(50px)는 이미 44px보다 크다.
const TOUCH_BUTTON_SIZE: Record<TouchButtonSize, string> = {
  default: 'h-11 min-w-11',
  xs: 'h-11 min-w-11 text-sm leading-none',
  sm: 'h-11 min-w-11 text-sm leading-none',
  md: 'h-11 min-w-11',
  lg: '',
  'compact-xs': 'h-11 min-w-11 text-sm leading-none',
  'compact-sm': 'h-11 min-w-11',
  icon: 'size-11',
  'icon-xs': 'size-11',
  'icon-sm': 'size-11',
  'icon-lg': 'size-11',
};

/** 공용 Button·ButtonLink·LoadingButton의 size에 맞는 44px 클래스. */
export function touchButtonClassName(size: string | null | undefined): string {
  return TOUCH_BUTTON_SIZE[(size ?? 'default') as TouchButtonSize] ?? '';
}

/** 44px로 키운 버튼이면 그 높이(px), 원래 더 큰 크기(lg)면 undefined. */
export function touchButtonHeight(size: string | null | undefined): number | undefined {
  return touchButtonClassName(size) ? TOUCH_TARGET_PX : undefined;
}

// 체크박스(@greenhub/ui Checkbox)는 보이는 네모(20px)를 키우지 않고, 라벨까지 포함한 눌리는 줄을 44px로 만든다.
// 라벨 위아래에 12px 누름 영역을 더하고(20 + 12 + 12 = 44), 네모는 첫 줄에 맞춰 12px 내린 뒤, 줄 전체를 위아래로 12px 당겨
// 화면 배치는 그대로 둔다. 네모 둘레 12px(네모 기준 44×44px)도 눌린다.
export const TOUCH_CHECKBOX =
  "-my-3 [&_label]:py-3 [&>div:first-child]:mt-3 [&_input]:before:absolute [&_input]:before:-inset-3 [&_input]:before:content-['']";
