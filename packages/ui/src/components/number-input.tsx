'use client';

import type * as React from 'react';
import { useRef } from 'react';

import { cn } from '../lib/utils';
import { Input, InputSection } from './input';

// ① 외형 유지: Mantine NumberInput(hideControls, 정수만, 음수 없음). 모양은 Input과 같고,
// 값은 천 단위 구분 기호를 넣어 보여 준다. 범위 밖 값은 Mantine(clampBehavior blur)처럼 칸을 떠날 때 맞춘다.
function format(value: number | '', separator: string | undefined) {
  if (value === '') return '';
  const digits = String(value);
  return separator ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator) : digits;
}

// withControls: Mantine NumberInput 기본(증감 버튼 있음, sm). 오른쪽 24px 칸에 위·아래 버튼(각 높이 17px, 최대 너비 14px × 1.7,
// 왼쪽 gray-4 테두리, 바깥 모서리 15px, 검정 14px 꺾쇠)을 쌓는다. 버튼은 Mantine처럼 초점을 받지 않고(tabIndex -1, aria-hidden)
// 누르면 입력칸에 초점을 주고 step만큼 바꾼다. 최댓값·최솟값에 닿으면 그쪽 버튼이 잠긴다(흐림 60%·gray-5).
// 입력칸이 잠기면 두 버튼도 잠긴다.
const CONTROL =
  'flex h-[17px] w-full flex-[0_0_50%] cursor-pointer appearance-none items-center justify-center border-0 border-s border-solid border-s-[#ced4da] bg-transparent p-0 text-black hover:bg-[#f8f9fa] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-[#adb5bd] disabled:opacity-60';

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ width: 14, height: 14, transform: up ? 'rotate(180deg)' : undefined }}
    >
      <path
        d="M3.13523 6.15803C3.3241 5.95657 3.64052 5.94637 3.84197 6.13523L7.5 9.56464L11.158 6.13523C11.3595 5.94637 11.6759 5.95657 11.8648 6.15803C12.0536 6.35949 12.0434 6.67591 11.842 6.86477L7.84197 10.6148C7.64964 10.7951 7.35036 10.7951 7.15803 10.6148L3.15803 6.86477C2.95657 6.67591 2.94637 6.35949 3.13523 6.15803Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
}

function NumberInput({
  value,
  onValueChange,
  thousandSeparator,
  min,
  max,
  onBlur,
  withControls = false,
  step = 1,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  value: number | '';
  onValueChange: (value: number | '') => void;
  thousandSeparator?: string;
  min?: number;
  max?: number;
  withControls?: boolean;
  step?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  if (withControls) {
    const { className, disabled, ref, ...rest } = props;
    const stepBy = (direction: 1 | -1) => {
      // Mantine: 빈 칸에서 누르면 min(없으면 0)부터 시작하고, 범위 안으로 맞춘다.
      const base = value === '' ? (min ?? 0) - (direction === 1 ? step : -step) : value;
      const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, base + direction * step));
      onValueChange(next);
    };
    return (
      <div data-slot="input-root" className="relative">
        <NumberInput
          {...rest}
          ref={(node: HTMLInputElement | null) => {
            inputRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          value={value}
          onValueChange={onValueChange}
          thousandSeparator={thousandSeparator}
          min={min}
          max={max}
          onBlur={onBlur}
          disabled={disabled}
          className={cn('pe-6', className)}
        />
        <InputSection side="right" className={cn('w-6', !disabled && 'pointer-events-auto')}>
          <div className="ms-auto flex h-[34px] w-full max-w-[calc(14px*1.7)] flex-col">
            {([1, -1] as const).map((direction) => (
              <button
                key={direction}
                type="button"
                tabIndex={-1}
                aria-hidden
                data-direction={direction === 1 ? 'up' : 'down'}
                disabled={
                  disabled ||
                  (value !== '' &&
                    (direction === 1
                      ? max !== undefined && value >= max
                      : min !== undefined && value <= min))
                }
                onMouseDown={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  event.preventDefault();
                  inputRef.current?.focus();
                  stepBy(direction);
                }}
                className={cn(CONTROL, direction === 1 ? 'rounded-se-[15px]' : 'rounded-ee-[15px]')}
              >
                <Chevron up={direction === 1} />
              </button>
            ))}
          </div>
        </InputSection>
      </div>
    );
  }
  return (
    <Input
      type="text"
      inputMode="numeric"
      value={format(value, thousandSeparator)}
      onChange={(event) => {
        const digits = event.currentTarget.value.replace(/[^0-9]/g, '');
        onValueChange(digits === '' ? '' : Number(digits));
      }}
      onBlur={(event) => {
        if (value !== '') {
          const clamped = Math.min(max ?? value, Math.max(min ?? value, value));
          if (clamped !== value) onValueChange(clamped);
        }
        onBlur?.(event);
      }}
      {...props}
    />
  );
}

export { NumberInput };
