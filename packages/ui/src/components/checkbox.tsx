'use client';

import type * as React from 'react';
import { useId } from 'react';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine Checkbox(filled). 상자는 크기 xs 16·sm 20, 모서리는 Checkbox 기본 radius sm(4px),
// gray-4 테두리·흰 바탕, 고르면 색 면·흰 체크(상자 폭 60%, 가운데). 라벨은 상자 오른쪽 12px,
// 글자 xs 13·sm 15, 줄 높이 xs 16·sm 20. 색은 CSS 색 값으로 준다(기본 주색).
// 구조도 Mantine과 같다: 모양을 지운 checkbox input이 상자이고, 체크는 그 옆 svg를 겹쳐 보였다 숨긴다.
const BOX = { xs: 'size-4', sm: 'size-5' } as const;
const LABEL = { xs: 'text-xs leading-4', sm: 'text-sm leading-5' } as const;

/** Mantine CheckIcon */
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 10 7"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
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

function Checkbox({
  checked,
  onCheckedChange,
  label,
  size = 'sm',
  color = 'var(--color-primary)',
  className,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: React.ReactNode;
  size?: keyof typeof BOX;
  color?: string;
  className?: string;
  id?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div
      data-slot="checkbox-field"
      className={cn('flex', className)}
      style={{ '--checkbox-color': color } as React.CSSProperties}
    >
      <div className={cn('relative order-1', BOX[size])}>
        <input
          type="checkbox"
          id={inputId}
          checked={checked}
          onChange={(event) => onCheckedChange(event.currentTarget.checked)}
          data-slot="checkbox"
          className={cn(
            'peer m-0 block cursor-pointer appearance-none rounded-[4px] border border-[#ced4da] bg-white p-0 transition-[border-color,background-color] duration-100 outline-none [-webkit-tap-highlight-color:transparent] checked:border-(--checkbox-color) checked:bg-(--checkbox-color) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--checkbox-color) focus-visible:outline-solid',
            BOX[size],
          )}
        />
        <CheckIcon className="pointer-events-none absolute inset-0 m-auto w-[60%] translate-y-[5px] scale-50 text-white opacity-0 transition-[translate,scale,opacity] duration-100 peer-checked:translate-none peer-checked:scale-100 peer-checked:opacity-100" />
      </div>
      {label != null && (
        <div className={cn('order-2 inline-flex cursor-pointer flex-col', LABEL[size])}>
          <label htmlFor={inputId} className="cursor-pointer ps-3 text-inherit">
            {label}
          </label>
        </div>
      )}
    </div>
  );
}

export { CheckIcon, Checkbox };
