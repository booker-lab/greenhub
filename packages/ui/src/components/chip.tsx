'use client';

import type * as React from 'react';
import { useId } from 'react';

import { cn } from '../lib/utils';
import { CheckIcon } from './checkbox';

// ① 외형 유지: Mantine Chip(filled, sm). 숨은 input(checkbox·radio) + label 구조도 Mantine과 같다.
// 높이 28·모서리 1000rem·글자 15px·줄 높이 26·좌우 20, 안 고르면 gray-1 면·검정 글자,
// 고르면 색 면·흰 글자에 왼쪽 체크(12px + 간격 8px)가 붙고 좌우 10. 마우스를 올리면 gray-2, 고른 칩은 hoverColor. Mantine처럼 text-box-trim으로 글자 상자를 자른다.
function Chip({
  checked,
  onCheckedChange,
  type = 'checkbox',
  name,
  value,
  color = 'var(--color-primary)',
  hoverColor = color,
  className,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  type?: 'checkbox' | 'radio';
  name?: string;
  value?: string;
  color?: string;
  /** 고른 칩에 마우스를 올렸을 때 면 색(Mantine filled hover = 한 단계 진한 색) */
  hoverColor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div
      data-slot="chip"
      className={className}
      style={{ '--chip-bg': color, '--chip-hover': hoverColor } as React.CSSProperties}
    >
      <input
        id={id}
        type={type}
        name={name}
        value={value}
        checked={checked}
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
        className="peer m-0 h-0 w-0 p-0 opacity-0"
      />
      <label
        htmlFor={id}
        data-checked={checked || undefined}
        className="inline-flex h-7 cursor-pointer items-center rounded-[1000rem] border border-transparent bg-[#f1f3f5] px-5 text-[15px] leading-[26px] whitespace-nowrap text-black select-none [-webkit-tap-highlight-color:transparent] [text-box-edge:cap_alphabetic] [text-box-trim:trim-both] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary peer-focus-visible:outline-solid hover:bg-[#e9ecef] data-checked:bg-(--chip-bg) data-checked:px-2.5 data-checked:hover:bg-(--chip-hover) data-checked:text-white"
      >
        {checked && (
          <span className="flex h-3 w-5 max-w-5 items-center overflow-hidden">
            <CheckIcon className="block size-3 text-white" />
          </span>
        )}
        <span>{children}</span>
      </label>
    </div>
  );
}

export { Chip };
