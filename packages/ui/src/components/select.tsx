'use client';

import { Select as SelectPrimitive } from '@base-ui/react/select';
import type * as React from 'react';
import { useRef } from 'react';

import { cn } from '../lib/utils';
import { CloseIcon } from './close-button';
import { type InputSize, inputClassName, inputSizeClassName } from './input';

// ① 외형 유지: Mantine Select(검색 없음). 닫힌 모양은 입력칸(Input)과 같고, 오른쪽에 위아래 화살표(gray-6)가 있다.
// clearable이고 값이 있으면 Mantine처럼 지우기 버튼과 화살표를 나란히 둔다(간격 2px, 오른쪽 여백 크기별 8·10px).
// 목록은 Mantine Combobox 드롭다운: 흰 바탕·gray-2 테두리·모서리 16·안쪽 4px·입력칸 아래 8px,
// 묶음 이름은 글자 0.85배·gray-6·600 + 오른쪽 가는 선, 항목은 크기별 여백·글자. 고른 항목은 앞에 흐린 체크(0.4).
// 마우스를 올리면 gray-0, 방향키로 옮기면(focus-visible) Mantine data-combobox-selected처럼 주색 면·흰 글자다.
// 목록이 열려 있는 동안 닫힌 칸은 Mantine(초점이 입력칸에 남음)처럼 주색 테두리다.

export interface SelectItem {
  value: string;
  label: string;
}

export interface SelectGroup {
  group: string;
  items: SelectItem[];
}

const CHEVRON_SIZE = { xs: 'size-3.5', sm: 'size-[18px]', md: 'size-5' } as const;
const CLEAR_SIZE = { xs: 'size-[18px]', sm: 'size-[22px]', md: 'size-7' } as const;
const COMBINED_PADDING = { xs: 'pe-[7px]', sm: 'pe-2', md: 'pe-2.5' } as const;
const COMBINED_WIDTH = { xs: 'w-[41px]', sm: 'w-[50px]', md: 'w-15' } as const;
const COMBINED_INPUT_PADDING = { xs: 'pe-[41px]', sm: 'pe-[50px]', md: 'pe-15' } as const;
const SECTION_WIDTH = { xs: 'w-7', sm: 'w-[34px]', md: 'w-10' } as const;
const SECTION_INPUT_PADDING = { xs: 'pe-7', sm: 'pe-[34px]', md: 'pe-10' } as const;
const OPTION_CLASS = {
  xs: 'px-2 py-1 text-xs',
  sm: 'px-2.5 py-1.5 text-sm',
  md: 'px-3 py-2 text-base',
} as const;
const GROUP_LABEL_CLASS = {
  xs: 'px-2 py-1 text-[calc(13px*0.85)]',
  sm: 'px-2.5 py-1.5 text-[calc(15px*0.85)]',
  md: 'px-3 py-2 text-[calc(16px*0.85)]',
} as const;

/** Mantine ComboboxChevron(위아래 화살표) */
function SelectChevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-slot="select-chevron"
      className={cn('text-[#868e96]', className)}
    >
      <path
        d="M4.93179 5.43179C4.75605 5.60753 4.75605 5.89245 4.93179 6.06819C5.10753 6.24392 5.39245 6.24392 5.56819 6.06819L7.49999 4.13638L9.43179 6.06819C9.60753 6.24392 9.89245 6.24392 10.0682 6.06819C10.2439 5.89245 10.2439 5.60753 10.0682 5.43179L7.81819 3.18179C7.73379 3.0974 7.61933 3.04999 7.49999 3.04999C7.38064 3.04999 7.26618 3.0974 7.18179 3.18179L4.93179 5.43179ZM10.0682 9.56819C10.2439 9.39245 10.2439 9.10753 10.0682 8.93179C9.89245 8.75606 9.60753 8.75606 9.43179 8.93179L7.49999 10.8636L5.56819 8.93179C5.39245 8.75606 5.10753 8.75606 4.93179 8.93179C4.75605 9.10753 4.75605 9.39245 4.93179 9.56819L7.18179 11.8182C7.35753 11.9939 7.64245 11.9939 7.81819 11.8182L10.0682 9.56819Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Mantine CheckIcon(고른 항목 앞 체크) */
function OptionCheck() {
  return (
    <svg
      viewBox="0 0 10 7"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-[0.8em] w-[0.8em] min-w-[0.8em] opacity-40 group-focus-visible/select-item:opacity-100"
    >
      <path
        d="M4 4.586L1.707 2.293A1 1 0 1 0 .293 3.707l3 3a.997.997 0 0 0 1.414 0l5-5A1 1 0 1 0 8.293.293L4 4.586z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
}

function Select({
  data,
  value,
  onValueChange,
  placeholder,
  clearable = false,
  size = 'sm',
  className,
  itemClassName,
  inlinePopup = false,
  maxDropdownHeight = 250,
  id,
  'aria-label': ariaLabel,
  defaultOpen,
}: {
  /** 항목 또는 묶음(group) 목록 */
  data: readonly (SelectItem | SelectGroup)[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  clearable?: boolean;
  size?: InputSize;
  /** 닫힌 입력칸 클래스(모서리 등) */
  className?: string;
  /** 목록 항목 클래스(줄 높이 등) */
  itemClassName?: string;
  /**
   * 목록을 body가 아니라 닫힌 칸 상자 안에 절대 위치(칸 아래 8px)로 그린다. body에 그리면 Base UI가 위치를 정수 픽셀로
   * 반올림해, 칸이 소수점 위치에 있을 때 Mantine(반올림 없음)과 글자가 1px 어긋난다.
   */
  inlinePopup?: boolean;
  maxDropdownHeight?: number;
  id?: string;
  'aria-label'?: string;
  /** 처음부터 목록을 연다(대조 화면 촬영용) */
  defaultOpen?: boolean;
}) {
  const groups: SelectGroup[] = data.map((entry) =>
    'group' in entry ? entry : { group: '', items: [entry] },
  );
  const items = groups.flatMap((g) => g.items);
  const labels = Object.fromEntries(items.map((item) => [item.value, item.label]));
  const showClear = clearable && value != null;
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <SelectPrimitive.Root
      items={labels}
      value={value}
      onValueChange={(next) => onValueChange((next as string | null) ?? null)}
      modal={false}
      defaultOpen={defaultOpen}
    >
      <div ref={rootRef} data-slot="select-root" className="relative">
        {/* Mantine처럼 닫힌 칸을 읽기 전용 input으로 그린다. 글자 위치가 입력칸과 같아진다
            (button 안 span은 칸의 소수점 위치에 따라 1px 어긋났다). */}
        <SelectPrimitive.Trigger
          id={id}
          aria-label={ariaLabel}
          data-slot="select-trigger"
          nativeButton={false}
          render={
            <input
              readOnly
              value={value != null ? (labels[value] ?? '') : ''}
              placeholder={placeholder}
            />
          }
          className={cn(
            inputClassName,
            inputSizeClassName[size],
            'cursor-pointer caret-transparent data-popup-open:border-primary',
            showClear ? COMBINED_INPUT_PADDING[size] : SECTION_INPUT_PADDING[size],
            className,
          )}
        />
        <div
          data-slot="input-section"
          className={cn(
            'pointer-events-none absolute top-px end-px bottom-px z-[1] flex items-center justify-center',
            showClear
              ? cn(COMBINED_WIDTH[size], 'justify-end gap-0.5', COMBINED_PADDING[size])
              : SECTION_WIDTH[size],
          )}
        >
          {showClear && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="지우기"
              data-slot="select-clear"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onValueChange(null)}
              className={cn(
                'pointer-events-auto inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg bg-white text-[#495057] outline-none',
                CLEAR_SIZE[size],
              )}
            >
              <CloseIcon />
            </button>
          )}
          <SelectChevron className={CHEVRON_SIZE[size]} />
        </div>
      </div>
      <SelectPrimitive.Portal container={inlinePopup ? rootRef : undefined}>
        <SelectPrimitive.Positioner
          className={cn(
            'z-50 outline-none',
            // transform이 아니라 top·left로 두고 will-change: transform을 끈다(따로 합성된 층은 2배 화면에서
            // 글자를 1px 어긋나게 한다).
            inlinePopup && 'top-[calc(100%+8px)]! left-0! transform-none! will-change-auto!',
          )}
          positionMethod={inlinePopup ? 'absolute' : undefined}
          side="bottom"
          sideOffset={8}
          alignItemWithTrigger={false}
          collisionAvoidance={{ side: 'none' }}
        >
          <SelectPrimitive.Popup
            data-slot="select-popup"
            className="w-(--anchor-width) rounded-lg border border-[#e9ecef] bg-white p-1 text-black outline-none"
          >
            <SelectPrimitive.List
              className="overflow-y-auto"
              style={{ maxHeight: maxDropdownHeight }}
            >
              {groups.map((g, index) => {
                const options = g.items.map((item) => (
                  <SelectPrimitive.Item
                    key={item.value}
                    value={item.value}
                    data-slot="select-item"
                    className={cn(
                      'group/select-item flex cursor-pointer items-center gap-2 rounded-lg break-words outline-none hover:bg-[#f8f9fa] focus-visible:bg-primary focus-visible:text-white',
                      OPTION_CLASS[size],
                      itemClassName,
                    )}
                  >
                    <SelectPrimitive.ItemIndicator className="contents">
                      <OptionCheck />
                    </SelectPrimitive.ItemIndicator>
                    <SelectPrimitive.ItemText>{item.label}</SelectPrimitive.ItemText>
                  </SelectPrimitive.Item>
                ));
                if (!g.group) return options;
                return (
                  <SelectPrimitive.Group key={`${g.group}-${index}`}>
                    <SelectPrimitive.GroupLabel
                      data-slot="select-group-label"
                      className={cn(
                        'flex items-center font-semibold text-[#868e96] after:ms-2.5 after:h-px after:flex-1 after:bg-[#e9ecef] after:content-[""]',
                        GROUP_LABEL_CLASS[size],
                      )}
                    >
                      {g.group}
                    </SelectPrimitive.GroupLabel>
                    {options}
                  </SelectPrimitive.Group>
                );
              })}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export { OptionCheck, Select, SelectChevron };
