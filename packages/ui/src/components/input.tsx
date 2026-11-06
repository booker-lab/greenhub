import { Input as InputPrimitive } from '@base-ui/react/input';
import type * as React from 'react';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine TextInput(높이 36, radius 16, gray-4 테두리, 초점 시 주색 테두리).
// 글자는 Mantine 기본 검정, 자리표시 글자는 보조 글자색(--muted-foreground), 비활성 gray-2 면·gray-5 글자, 오류 red-6 테두리·글자(대조 화면에서 맞춤).
// 자리표시 글자는 켜진 입력칸의 안내 글자라 WCAG 대비 예외가 아니다. gray-5(흰 바탕 2.1:1) 대신 보조 글자(5.1:1)로 칠한다.
// 비활성 글자는 꺼진 컨트롤이라 대비 예외이고, 꺼진 것처럼 보여야 하므로 gray-5를 유지한다.
// Autocomplete 입력칸도 같은 모양이라 클래스를 함께 쓴다.
const inputClassName =
  'block h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-ui-ink transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus:border-brand aria-invalid:border-ui-red aria-invalid:text-ui-red disabled:cursor-not-allowed disabled:bg-ui-gray-2 disabled:text-ui-gray-5 disabled:opacity-60';

// Mantine Input 크기(높이·좌우 여백 = 높이 ÷ 3·글자). sm이 기본이다. 모서리는 className으로 준다
// (Mantine radius md = rounded-[8px], xl = rounded-xl).
const inputSizeClassName = {
  xs: 'h-7.5 px-2.5 text-xs',
  sm: '',
  md: 'h-10.5 px-3.5 text-base',
} as const;

type InputSize = keyof typeof inputSizeClassName;

// Mantine 입력칸 왼쪽·오른쪽 칸(₩·단위 글자·화살표): 테두리 안쪽 1px에서 시작하는 높이 - 2px 너비의 칸이고,
// 입력 글자는 그 너비만큼 들여 쓴다.
const sectionPaddingClassName = {
  left: { xs: 'ps-7', sm: 'ps-[34px]', md: 'ps-10' },
  right: { xs: 'pe-7', sm: 'pe-[34px]', md: 'pe-10' },
} as const;
const sectionWidthClassName = { xs: 'w-7', sm: 'w-[34px]', md: 'w-10' } as const;

function InputSection({
  side,
  size = 'sm',
  className,
  ...props
}: React.ComponentProps<'div'> & { side: 'left' | 'right'; size?: InputSize }) {
  return (
    <div
      data-slot="input-section"
      data-position={side}
      className={cn(
        'pointer-events-none absolute top-px bottom-px z-[1] flex items-center justify-center text-ui-gray-6',
        side === 'left' ? 'start-px rounded-s-lg' : 'end-px rounded-e-lg',
        sectionWidthClassName[size],
        className,
      )}
      {...props}
    />
  );
}

function Input({
  className,
  type,
  size = 'sm',
  leftSection,
  rightSection,
  rootClassName,
  rootStyle,
  ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & {
  size?: InputSize;
  leftSection?: React.ReactNode;
  rightSection?: React.ReactNode;
  /** 칸이 있을 때 입력칸과 칸을 감싸는 상자(Mantine Input 바깥 상자)의 클래스·스타일 */
  rootClassName?: string;
  rootStyle?: React.CSSProperties;
}) {
  const input = (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        inputClassName,
        inputSizeClassName[size],
        leftSection != null && sectionPaddingClassName.left[size],
        rightSection != null && sectionPaddingClassName.right[size],
        className,
      )}
      {...props}
    />
  );
  if (leftSection == null && rightSection == null) return input;
  return (
    <div data-slot="input-root" className={cn('relative', rootClassName)} style={rootStyle}>
      {leftSection != null && (
        <InputSection side="left" size={size}>
          {leftSection}
        </InputSection>
      )}
      {input}
      {rightSection != null && (
        <InputSection side="right" size={size}>
          {rightSection}
        </InputSection>
      )}
    </div>
  );
}

export { Input, InputSection, inputClassName, inputSizeClassName, type InputSize };
