'use client';

import type * as React from 'react';
import { useId } from 'react';

import { cn } from '../lib/utils';
import { Field, FieldLabel } from './field';
import { type InputSize, inputClassName, inputSizeClassName } from './input';
import { SelectChevron } from './select';

// ① 외형 유지: Mantine NativeSelect. 입력칸(Input)과 같은 모양의 select에 오른쪽 위아래 화살표 칸(높이 - 2px)을 둔다.
// label을 주면 Mantine InputWrapper처럼 라벨(크기별 글자) → 칸 순서로 그린다.
const LABEL = { xs: 'text-xs', sm: '', md: 'text-base' } as const;
const CHEVRON = { xs: 'size-3.5', sm: 'size-[18px]', md: 'size-5' } as const;
const SECTION = { xs: 'w-7', sm: 'w-[34px]', md: 'w-10' } as const;
const PADDING = { xs: 'pe-7', sm: 'pe-[34px]', md: 'pe-10' } as const;

function NativeSelect({
  data,
  size = 'sm',
  label,
  id,
  className,
  ...props
}: Omit<React.ComponentProps<'select'>, 'size'> & {
  data: readonly { value: string; label: string; disabled?: boolean }[];
  size?: InputSize;
  label?: React.ReactNode;
}) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const control = (
    <div data-slot="native-select-root" className="relative">
      <select
        id={selectId}
        data-slot="native-select"
        className={cn(
          inputClassName,
          inputSizeClassName[size],
          'cursor-pointer',
          PADDING[size],
          className,
        )}
        {...props}
      >
        {data.map((item) => (
          <option key={item.value} value={item.value} disabled={item.disabled}>
            {item.label}
          </option>
        ))}
      </select>
      <div
        data-slot="input-section"
        className={cn(
          'pointer-events-none absolute top-px end-px bottom-px z-[1] flex items-center justify-center',
          SECTION[size],
        )}
      >
        <SelectChevron className={CHEVRON[size]} />
      </div>
    </div>
  );
  if (label == null) return control;
  return (
    <Field>
      <FieldLabel htmlFor={selectId} className={LABEL[size]}>
        {label}
      </FieldLabel>
      {control}
    </Field>
  );
}

export { NativeSelect };
