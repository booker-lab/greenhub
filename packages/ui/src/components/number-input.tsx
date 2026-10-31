'use client';

import type * as React from 'react';

import { Input } from './input';

// ① 외형 유지: Mantine NumberInput(hideControls, 정수만, 음수 없음). 모양은 Input과 같고,
// 값은 천 단위 구분 기호를 넣어 보여 준다. 범위 밖 값은 Mantine(clampBehavior blur)처럼 칸을 떠날 때 맞춘다.
function format(value: number | '', separator: string | undefined) {
  if (value === '') return '';
  const digits = String(value);
  return separator ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator) : digits;
}

function NumberInput({
  value,
  onValueChange,
  thousandSeparator,
  min,
  max,
  onBlur,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  value: number | '';
  onValueChange: (value: number | '') => void;
  thousandSeparator?: string;
  min?: number;
  max?: number;
}) {
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
