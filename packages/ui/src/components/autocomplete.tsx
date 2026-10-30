'use client';

import { Autocomplete as AutocompletePrimitive } from '@base-ui/react/autocomplete';
import type * as React from 'react';

import { cn } from '../lib/utils';
import { inputClassName } from './input';

// ① 외형 유지: Mantine Autocomplete. 입력칸은 Input과 같고, 목록은 Mantine Combobox 드롭다운
// (흰 바탕, gray-2 테두리, 모서리 16, 안쪽 4px, 입력칸 아래 8px, 항목 6px·10px·15px, 고른 항목 주색).
// 문자열 목록만 받는다. 입력값이 곧 값이다(목록 밖 글자도 입력할 수 있다).
function Autocomplete({
  items,
  value,
  onValueChange,
  className,
  ...inputProps
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & {
  items: readonly string[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <AutocompletePrimitive.Root
      items={items}
      value={value}
      onValueChange={(next) => onValueChange(next)}
    >
      <AutocompletePrimitive.Input
        data-slot="input"
        className={cn(inputClassName, className)}
        {...inputProps}
      />
      <AutocompletePrimitive.Portal>
        <AutocompletePrimitive.Positioner className="z-50 outline-none" sideOffset={8}>
          <AutocompletePrimitive.Popup
            data-slot="autocomplete-popup"
            className="max-h-[min(var(--available-height,20rem),20rem)] w-[var(--anchor-width,100%)] overflow-y-auto rounded-lg border border-[#e9ecef] bg-white p-1 text-black empty:hidden"
          >
            <AutocompletePrimitive.List>
              {(item: string) => (
                <AutocompletePrimitive.Item
                  key={item}
                  value={item}
                  data-slot="autocomplete-item"
                  className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm break-words outline-none data-highlighted:bg-[#f8f9fa]"
                >
                  {item}
                </AutocompletePrimitive.Item>
              )}
            </AutocompletePrimitive.List>
          </AutocompletePrimitive.Popup>
        </AutocompletePrimitive.Positioner>
      </AutocompletePrimitive.Portal>
    </AutocompletePrimitive.Root>
  );
}

export { Autocomplete };
