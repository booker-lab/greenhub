'use client';

import {
  applyThemePreference,
  readThemePreference,
  THEME_PREFERENCES,
  type ThemePreference,
} from '@greenhub/shared';
import { useEffect, useId, useState } from 'react';

import { cn } from '../lib/utils';

// 화면 색 구성 직접 전환(다크 모드 D5-b, design-direction.md §9.3). 각 앱 설정 화면(소비자 MY·판매자 설정·
// 기사 내 정보) 안 한 줄이다. 시스템(기기 설정 따름)·밝게·어둡게 셋 중 하나를 고르면 바로 적용하고 localStorage에
// 남긴다. 다음 방문의 첫 화면은 루트 layout <head>의 인라인 스크립트(THEME_INIT_SCRIPT)가 칠하기 전에 적용한다.
// 접근성: 같은 name의 진짜 input type="radio"라 Tab은 한 번, 화살표 키로 고른다. 그룹 이름은 왼쪽 글자다.

const LABELS: Record<ThemePreference, string> = {
  system: '시스템',
  light: '밝게',
  dark: '어둡게',
};

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function ThemePreferenceControl({
  label = '화면 모드',
  className,
}: {
  label?: string;
  className?: string;
}) {
  const id = useId();
  // 서버 렌더링과 첫 hydration은 '시스템'으로 그리고, 저장값은 hydration 뒤에 읽는다(글자 불일치 경고를 피한다).
  // 화면 색은 이 값과 상관없이 <head> 스크립트가 이미 적용했다.
  const [value, setValue] = useState<ThemePreference>('system');
  useEffect(() => {
    setValue(readThemePreference(browserStorage()));
  }, []);

  const choose = (next: ThemePreference) => {
    setValue(next);
    applyThemePreference(next, document.documentElement, browserStorage());
  };

  return (
    <div
      role="radiogroup"
      aria-labelledby={`${id}-label`}
      data-slot="theme-preference"
      className={cn('flex flex-row flex-wrap items-center justify-between gap-3', className)}
    >
      <span
        id={`${id}-label`}
        className="text-foreground"
        style={{ fontSize: 'var(--font-size-sm)' }}
      >
        {label}
      </span>
      <div className="inline-flex flex-row rounded-[10px] bg-muted p-0.5">
        {THEME_PREFERENCES.map((preference) => {
          const selected = value === preference;
          return (
            <label
              key={preference}
              className={cn(
                'relative inline-flex min-h-[var(--touch-target)] min-w-14 cursor-pointer items-center justify-center rounded-[8px] px-3 select-none [-webkit-tap-highlight-color:transparent] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid',
                selected
                  ? 'bg-background font-semibold text-foreground shadow-[0_0_0_1px_var(--rule)]'
                  : 'text-muted-foreground',
              )}
              style={{ fontSize: 'var(--font-size-sm)' }}
            >
              <input
                type="radio"
                name={`${id}-theme`}
                value={preference}
                checked={selected}
                onChange={() => choose(preference)}
                className="sr-only"
              />
              {LABELS[preference]}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export { ThemePreferenceControl };
