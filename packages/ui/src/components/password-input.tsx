'use client';

import type * as React from 'react';
import { useState } from 'react';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine PasswordInput(size md, radius xl). Mantine처럼 테두리 상자(div) 안에 입력칸을 꽉 채워
// 겹치고(inset 0, 줄 높이 1.55), 오른쪽 40px 칸 가운데에 눈 모양 버튼(ActionIcon subtle gray 28px·그림 22px)을 둔다.
// 버튼은 Tab으로 가지 않는다(Mantine visibilityToggleFocusable false). 기사 앱 PasswordField(P3)와 같은 값이다.
function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'size' | 'type'>) {
  const [reveal, setReveal] = useState(false);
  return (
    <div data-slot="password-input" className="relative">
      <div className="relative h-[42px] min-h-[42px] cursor-text overflow-hidden rounded-[32px] border border-solid border-[#ced4da] bg-white ps-[14px] pe-10 text-base leading-[40px] text-black transition-[border-color] duration-100 ease-[ease] focus-within:border-primary">
        <input
          type={reveal ? 'text' : 'password'}
          className={cn(
            'absolute inset-0 h-full w-full cursor-text border-0 [font-family:inherit] bg-transparent ps-[14px] pe-10 text-inherit leading-[1.55] outline-0 placeholder:text-[#adb5bd] placeholder:opacity-100',
            className,
          )}
          {...props}
        />
      </div>
      <div className="absolute top-px right-px bottom-px z-[1] flex w-10 items-center justify-center rounded-r-[32px] text-[#868e96]">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Toggle password visibility"
          aria-pressed={reveal}
          onMouseDown={(event) => {
            event.preventDefault();
            setReveal((value) => !value);
          }}
          className="relative flex size-[28px] min-h-[28px] min-w-[28px] cursor-pointer appearance-none items-center justify-center overflow-hidden rounded-[32px] border border-solid border-transparent bg-transparent p-0 leading-none text-[#212529] hover:bg-[#f1f3f5]"
        >
          <span className="flex size-[26px] items-center justify-center">
            <PasswordToggleIcon reveal={reveal} />
          </span>
        </button>
      </div>
    </div>
  );
}

// Mantine PasswordToggleIcon과 같은 그림.
function PasswordToggleIcon({ reveal }: { reveal: boolean }) {
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: '16',
  } as const;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      className="size-[22px]"
      aria-hidden="true"
    >
      <path fill="none" d="M0 0h256v256H0z" />
      {reveal ? (
        <>
          <path
            {...stroke}
            d="M48 40l160 176M154.91 157.6a40 40 0 01-53.82-59.2M135.53 88.71a40 40 0 0132.3 35.53"
          />
          <path
            {...stroke}
            d="M208.61 169.1C230.41 149.58 240 128 240 128s-32-72-112-72a126 126 0 00-20.68 1.68M74 68.6C33.23 89.24 16 128 16 128s32 72 112 72a118.05 118.05 0 0054-12.6"
          />
        </>
      ) : (
        <>
          <path
            {...stroke}
            d="M128 56c-80 0-112 72-112 72s32 72 112 72 112-72 112-72-32-72-112-72z"
          />
          <circle {...stroke} cx="128" cy="128" r="40" />
        </>
      )}
    </svg>
  );
}

export { PasswordInput };
