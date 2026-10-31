'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { useEffect, useRef, useState } from 'react';

import { popupPositionClassName, useDocumentAnchor } from '../lib/use-document-anchor';
import { cn } from '../lib/utils';
import { CloseIcon } from './close-button';
import { type InputSize, inputClassName, inputSizeClassName } from './input';
import { OptionCheck, SelectChevron, type SelectItem } from './select';

// ① 외형 유지: Mantine Select searchable. 닫힌 모양·목록은 Select(검색 없음)와 같고, 입력칸에 글자를 적어 거른다.
// Mantine 동작을 따른다.
// - 입력 글자가 고른 항목 이름과 같으면(막 열었을 때) 모든 항목을 보이고, 다르면 이름에 글자가 든 항목만 보인다(대소문자 무시).
// - 맞는 항목이 없으면 nothingFoundMessage를 gray-6 가운데 글자로 보인다.
// - 닫히면(초점을 잃으면) 입력 글자를 고른 항목 이름으로 되돌린다.
// - 고른 항목을 다시 누르면 고름을 푼다(allowDeselect). clearable이고 값이 있으면 지우기 버튼을 둔다.
// 목록 자리는 Select처럼 Mantine과 같은 문서 좌표로 준다(useDocumentAnchor).

const CHEVRON_SIZE = { xs: 'size-3.5', sm: 'size-[18px]', md: 'size-5' } as const;
const CLEAR_SIZE = { xs: 'size-[18px]', sm: 'size-[22px]', md: 'size-7' } as const;
const COMBINED_PADDING = { xs: 'pe-[7px]', sm: 'pe-2', md: 'pe-2.5' } as const;
const COMBINED_WIDTH = { xs: 'w-[41px]', sm: 'w-[50px]', md: 'w-15' } as const;
const COMBINED_INPUT_PADDING = { xs: 'pe-[41px]', sm: 'pe-[50px]', md: 'pe-15' } as const;
const SECTION_WIDTH = { xs: 'w-7', sm: 'w-[34px]', md: 'w-10' } as const;
const SECTION_INPUT_PADDING = { xs: 'pe-7', sm: 'pe-[34px]', md: 'pe-10' } as const;
// 항목 글자 줄 높이는 Mantine처럼 본문 1.55를 물려받는다.
const OPTION_CLASS = {
  xs: 'px-2 py-1 text-xs leading-[1.55]',
  sm: 'px-2.5 py-1.5 text-sm leading-[1.55]',
  md: 'px-3 py-2 text-base leading-[1.55]',
} as const;

function filterItems(items: readonly SelectItem[], search: string): SelectItem[] {
  const query = search.trim().toLowerCase();
  return items.filter((item) => item.label.toLowerCase().includes(query));
}

function SearchableSelect({
  data,
  value,
  onValueChange,
  placeholder,
  nothingFoundMessage,
  clearable = false,
  size = 'sm',
  className,
  maxDropdownHeight = 220,
  id,
  'aria-label': ariaLabel,
}: {
  data: readonly SelectItem[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  /** 맞는 항목이 없을 때 목록에 보일 글자. 없으면 목록을 닫는다. */
  nothingFoundMessage?: string;
  clearable?: boolean;
  size?: InputSize;
  /** 입력칸 클래스(모서리 등) */
  className?: string;
  maxDropdownHeight?: number;
  id?: string;
  'aria-label'?: string;
}) {
  const selected = value != null ? (data.find((item) => item.value === value) ?? null) : null;
  const selectedLabel = selected?.label ?? '';
  const [search, setSearch] = useState(selectedLabel);
  // 닫힐 때 되돌릴 이름. 고른 직후에는 부모가 새 값을 내려주기 전이라 따로 둔다.
  const latestLabelRef = useRef(selectedLabel);
  // Mantine은 방향키로 옮긴 항목만 주색으로 칠한다(마우스는 gray-0, 막 열었을 때 고른 항목은 칠하지 않음).
  const [keyboardHighlight, setKeyboardHighlight] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const anchor = useDocumentAnchor(rootRef);

  useEffect(() => {
    latestLabelRef.current = selectedLabel;
    setSearch(selectedLabel);
  }, [selectedLabel]);

  const filtered = search === selectedLabel ? data : filterItems(data, search);
  const showClear = clearable && value != null;

  const choose = (next: SelectItem | null) => {
    latestLabelRef.current = next?.label ?? '';
    setSearch(next?.label ?? '');
    onValueChange(next?.value ?? null);
  };

  return (
    <ComboboxPrimitive.Root<SelectItem>
      items={data}
      filteredItems={filtered}
      value={selected}
      onValueChange={(next) => {
        // Mantine allowDeselect: 고른 항목을 다시 누르면 고름을 푼다.
        if (next) choose(next.value === value ? null : next);
      }}
      inputValue={search}
      onInputValueChange={(next, details) => {
        // 항목을 고르거나 닫을 때 Base UI가 넣는 글자는 위 choose·onOpenChange가 맡는다.
        if (details.reason === 'input-change') setSearch(next);
      }}
      onOpenChange={(open) => {
        if (open) anchor.measure();
        else setSearch(latestLabelRef.current);
      }}
      onItemHighlighted={(item, details) =>
        setKeyboardHighlight(item !== undefined && details.reason === 'keyboard')
      }
      highlightItemOnHover={false}
      isItemEqualToValue={(item, current) => item.value === current.value}
      modal={false}
    >
      <div ref={rootRef} data-slot="select-root" className="relative">
        <ComboboxPrimitive.Input
          id={id}
          aria-label={ariaLabel}
          placeholder={placeholder}
          data-slot="select-input"
          className={cn(
            inputClassName,
            inputSizeClassName[size],
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
              onClick={() => choose(null)}
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
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          className={cn('z-50 outline-none', popupPositionClassName)}
          style={anchor.style}
          positionMethod="absolute"
          side="bottom"
          sideOffset={8}
          collisionAvoidance={{ side: 'none' }}
        >
          <ComboboxPrimitive.Popup
            data-slot="select-popup"
            className={cn(
              'w-(--anchor-width) rounded-lg border border-[#e9ecef] bg-white p-1 text-black outline-none',
              !nothingFoundMessage && filtered.length === 0 && 'hidden',
            )}
          >
            <ComboboxPrimitive.List
              className="overflow-y-auto empty:hidden"
              style={{ maxHeight: maxDropdownHeight }}
            >
              {(item: SelectItem) => (
                <ComboboxPrimitive.Item
                  key={item.value}
                  value={item}
                  data-slot="select-item"
                  className={cn(
                    'group/select-item flex cursor-pointer items-center gap-2 rounded-lg break-words outline-none hover:bg-[#f8f9fa]',
                    keyboardHighlight && 'data-highlighted:bg-primary! data-highlighted:text-white',
                    OPTION_CLASS[size],
                  )}
                >
                  <ComboboxPrimitive.ItemIndicator className="contents">
                    <OptionCheck />
                  </ComboboxPrimitive.ItemIndicator>
                  <span>{item.label}</span>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
            {/* Mantine 목록 상자는 오른쪽 안쪽 여백이 0이고(data-composed) 항목만 스크롤 칸 여백 4px을 둔다.
                맞는 항목 없음 글자는 그 여백 밖이라 오른쪽으로 4px 넓다. */}
            {nothingFoundMessage && (
              <ComboboxPrimitive.Empty
                data-slot="select-empty"
                className={cn('-me-1 text-center text-[#868e96] empty:hidden', OPTION_CLASS[size])}
              >
                {nothingFoundMessage}
              </ComboboxPrimitive.Empty>
            )}
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}

export { SearchableSelect };
