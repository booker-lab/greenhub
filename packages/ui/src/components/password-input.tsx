'use client';

import type * as React from 'react';
import { useState } from 'react';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine PasswordInput(size md, radius xl). Mantine처럼 테두리 상자(div) 안에 입력칸을 꽉 채워
// 겹치고(inset 0, 줄 높이 1.55), 오른쪽 40px 칸 가운데에 눈 모양 버튼(ActionIcon subtle gray 28px·그림 22px)을 둔다.
// 기사 앱 PasswordField(P3)와 같은 값이다. 버튼은 Mantine(visibilityToggleFocusable false)과 달리 Tab으로 가서
// Enter·Space로도 바꿀 수 있다(기사 앱 #755와 같은 방식). 마우스로 누를 때는 mousedown 기본 동작만 막아 입력칸의
// 초점과 커서 위치를 지키고, 바꾸기는 click(키보드 Enter·Space도 click이 된다) 하나에서만 한다.
// Chromium은 click 시점에 password→text로 바꾸면 입력칸 커서를 맨 앞으로 옮긴다(mousedown 시점에는 유지).
// 커서는 type이 바뀐 뒤 비동기로(selectionchange) 옮겨지므로, 바꾸기 전 선택 범위를 읽어 두고 다음 프레임에
// 입력칸에 초점이 그대로 있으면 되돌린다. 키보드로 누를 때는 초점이 버튼에 있어 건드리지 않는다.
// size="sm": 소비자 앱 Mantine PasswordInput 기본(size sm, theme 기본 radius 16). 높이 36·좌우 12px·15px 글자,
// 오른쪽 34px 칸, 눈 모양 버튼 26px(그림 칸 24px·그림 20px). 소비자 로그인 화면에서 계산값을 맞췄다.
// sm은 접근성 트리도 소비자 Mantine과 같게 그림(svg)을 숨기지 않는다(md는 지금처럼 aria-hidden).
const passwordSizeClassName = {
  md: {
    box: 'h-[42px] min-h-[42px] rounded-[32px] ps-[14px] pe-10 text-base leading-[40px]',
    input: 'ps-[14px] pe-10',
    section: 'w-10 rounded-r-[32px]',
    button: 'size-[28px] min-h-[28px] min-w-[28px] rounded-[32px]',
    iconBox: 'size-[26px]',
    icon: 'size-[22px]',
  },
  sm: {
    box: 'h-9 min-h-9 rounded-[16px] ps-3 pe-[34px] text-[15px] leading-[34px]',
    input: 'py-px ps-3 pe-[34px]',
    section: 'w-[34px] rounded-r-[16px]',
    button: 'size-[26px] min-h-[26px] min-w-[26px] rounded-[16px]',
    iconBox: 'size-6',
    icon: 'size-5',
  },
} as const;

function PasswordInput({
  className,
  size = 'md',
  ...props
}: Omit<React.ComponentProps<'input'>, 'size' | 'type'> & { size?: 'sm' | 'md' }) {
  const [reveal, setReveal] = useState(false);
  const sized = passwordSizeClassName[size];
  return (
    <div data-slot="password-input" className="relative">
      <div
        className={cn(
          'relative cursor-text overflow-hidden border border-solid border-input bg-background text-ui-ink transition-[border-color] duration-100 ease-[ease] focus-within:border-brand',
          sized.box,
        )}
      >
        <input
          type={reveal ? 'text' : 'password'}
          className={cn(
            'absolute inset-0 h-full w-full cursor-text border-0 [font-family:inherit] bg-transparent text-inherit leading-[1.55] outline-0 placeholder:text-ui-gray-5 placeholder:opacity-100',
            sized.input,
            className,
          )}
          {...props}
        />
      </div>
      <div
        className={cn(
          'absolute top-px right-px bottom-px z-[1] flex items-center justify-center text-ui-gray-6',
          sized.section,
        )}
      >
        <button
          type="button"
          aria-label="비밀번호 보기"
          aria-pressed={reveal}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            const input = event.currentTarget
              ?.closest('[data-slot="password-input"]')
              ?.querySelector('input');
            const start = input?.selectionStart ?? null;
            const end = input?.selectionEnd ?? null;
            setReveal((value) => !value);
            if (!input || start === null || end === null) return;
            requestAnimationFrame(() => {
              if (input === document.activeElement) input.setSelectionRange(start, end);
            });
          }}
          className={cn(
            'relative flex cursor-pointer appearance-none items-center justify-center overflow-hidden border border-solid border-transparent bg-transparent p-0 leading-none text-ui-gray-9 outline-none hover:bg-ui-gray-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid',
            sized.button,
          )}
        >
          <span className={cn('flex items-center justify-center', sized.iconBox)}>
            <PasswordToggleIcon reveal={reveal} className={sized.icon} hidden={size === 'md'} />
          </span>
        </button>
      </div>
    </div>
  );
}

// Mantine PasswordToggleIcon과 같은 그림.
function PasswordToggleIcon({
  reveal,
  className,
  hidden,
}: {
  reveal: boolean;
  className: string;
  hidden: boolean;
}) {
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: '16',
  } as const;
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: 버튼 이름(aria-label)이 있는 장식 그림이다. sm은 Mantine과 같은 접근성 트리를 위해 숨기지 않는다.
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      className={className}
      aria-hidden={hidden ? 'true' : undefined}
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
