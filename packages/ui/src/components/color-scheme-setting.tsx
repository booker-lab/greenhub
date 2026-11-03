'use client';

import {
  applyColorSchemePreference,
  COLOR_SCHEME_STORAGE_KEY,
  type ColorSchemePreference,
  parseColorSchemePreference,
  readColorSchemePreference,
  writeColorSchemePreference,
} from '@greenhub/shared';
import type * as React from 'react';
import { useId, useSyncExternalStore } from 'react';

import { cn } from '../lib/utils';

// 화면 모드 직접 선택(다크 모드 D5-b, design-direction.md §9.3). 판매자 설정·기사 내 정보 화면 안 한 줄이고
// (소비자 앱은 다크 모드를 쓰지 않는다, 2026-11-03 사용자 결정), 감싸는 줄(면·여백·선)은 앱이 정한다.
// 선택 표시는 초록 면 없이 검정 2px 테두리·굵은 글자다(결제 수단 선택과 같은 규칙, §3.2).
// 접근성: role="radiogroup"(aria-labelledby로 "화면 모드"), 항목은 같은 name을 나눠 가진 진짜
// input type="radio"라 Tab은 그룹에 한 번 들어가고 화살표 키로 고른 항목을 옮긴다(RadioGroup과 같다).
// 첫 페인트 전 적용은 루트 layout의 인라인 스크립트(@greenhub/shared COLOR_SCHEME_SCRIPT)가 하고, 이 줄은
// 고른 값을 저장하고 `<html data-theme>`을 바로 바꾼다. 저장소를 못 써도(사파리 개인 모드 등) 이번 화면에는 적용한다.

const OPTIONS: { value: ColorSchemePreference; label: string }[] = [
  { value: 'system', label: '시스템' },
  { value: 'light', label: '밝게' },
  { value: 'dark', label: '어둡게' },
];

const listeners = new Set<() => void>();
// 저장하지 못한 선택도 이 화면에서는 유지하려고 마지막 선택을 메모리에 둔다(처음 읽을 때 저장값으로 채운다).
let current: ColorSchemePreference | null = null;

function getSnapshot(): ColorSchemePreference {
  if (current === null) current = readColorSchemePreference();
  return current;
}

function getServerSnapshot(): ColorSchemePreference {
  return 'system';
}

function setPreference(preference: ColorSchemePreference) {
  current = preference;
  writeColorSchemePreference(preference);
  applyColorSchemePreference(preference);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // 다른 탭에서 바꾸면 이 탭도 따라간다.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== COLOR_SCHEME_STORAGE_KEY && event.key !== null) return;
    current = parseColorSchemePreference(event.newValue);
    applyColorSchemePreference(current);
    for (const each of listeners) each();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function ColorSchemeSetting({
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'>) {
  const preference = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const labelId = useId();
  const name = useId();
  return (
    <div
      data-slot="color-scheme-setting"
      className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}
      {...props}
    >
      <p
        id={labelId}
        className="m-0 p-0 text-(length:--font-size-sm) leading-[1.55] font-medium text-(--color-text)"
      >
        화면 모드
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex gap-1.5">
        {OPTIONS.map((option) => {
          const checked = preference === option.value;
          return (
            <label
              key={option.value}
              data-checked={checked || undefined}
              className="relative inline-flex min-h-(--touch-target) min-w-16 cursor-pointer items-center justify-center rounded-(--radius-full) border-2 border-solid border-(--color-border) px-3 text-(length:--font-size-sm) leading-none font-medium text-(--color-text-secondary) select-none [-webkit-tap-highlight-color:transparent] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--ring) has-focus-visible:outline-solid data-checked:border-(--color-text) data-checked:font-bold data-checked:text-(--color-text)"
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => setPreference(option.value)}
                className="absolute m-0 size-px appearance-none overflow-hidden p-0 opacity-0"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export { ColorSchemeSetting };
