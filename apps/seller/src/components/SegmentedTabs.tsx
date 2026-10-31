'use client';

import { Badge } from '@greenhub/ui/components/badge';
import type { CSSProperties } from 'react';

export type SegmentedTabItem<T extends string = string> = {
  key: T;
  label: string;
  count?: number;
  badgeColor?: 'red' | 'gray';
};

type Props<T extends string> = {
  tabs: ReadonlyArray<SegmentedTabItem<T>>;
  value: T;
  onChange: (key: T) => void;
  sticky?: boolean;
  topOffset?: string;
  layout?: 'flex' | 'scroll';
  /** 탭 묶음의 이름. 주면 묶음이 이 이름의 group으로 읽힌다. */
  ariaLabel?: string;
};

// ① 외형 유지(UI 교체 P4): Mantine Container sm(720px·좌우 16px)·Group(gap 0)·UnstyledButton·Badge xs와 같은 값.
// Badge xs = 높이 16·좌우 6·9px·줄 높이 14, filled gray-6·red-6 면에 흰 글자.
const BADGE_XS = 'h-4 px-1.5 text-[9px] leading-[14px] text-white ml-1.5';
const BADGE_COLOR = { gray: 'bg-[#868e96]', red: 'bg-[#fa5252]' } as const;

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  sticky = false,
  topOffset = 'var(--header-height)',
  layout = 'flex',
  ariaLabel,
}: Props<T>) {
  const containerStyle: CSSProperties = {
    backgroundColor: 'var(--color-bg)',
    borderBottom: '1px solid var(--color-border)',
    ...(sticky ? { position: 'sticky', top: topOffset, zIndex: 10 } : {}),
  };

  // 이름을 주면 묶음이 그 이름의 group으로 읽힌다(E2E가 역할 이름으로 찾는다). fieldset은 기본 최소 폭이 가로 스크롤 탭을 바꿔 div에 역할을 준다.
  const groupA11y = ariaLabel ? { role: 'group' as const, 'aria-label': ariaLabel } : {};

  const groupStyle: CSSProperties =
    layout === 'scroll' ? { overflowX: 'auto', flexWrap: 'nowrap', scrollbarWidth: 'none' } : {};

  return (
    <div style={containerStyle}>
      <div className="mx-auto max-w-[720px] px-4">
        <div
          className="flex flex-row flex-wrap items-center justify-start gap-0"
          style={groupStyle}
          {...groupA11y}
        >
          {tabs.map((tab) => {
            const active = tab.key === value;
            const buttonStyle: CSSProperties = {
              padding: '12px 16px',
              fontSize: 'var(--font-size-sm)',
              fontWeight: active ? 700 : 'var(--fw-medium)',
              textAlign: 'center',
              borderBottom: `2px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
              color: active ? 'var(--color-primary-dark)' : 'var(--color-text-secondary)',
              transition: 'all 0.15s',
              ...(layout === 'flex' ? { flex: 1 } : { flexShrink: 0 }),
            };

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => onChange(tab.key)}
                className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-inherit no-underline"
                style={buttonStyle}
              >
                {tab.label}
                {typeof tab.count === 'number' && tab.count > 0 && (
                  <Badge className={`${BADGE_XS} ${BADGE_COLOR[tab.badgeColor ?? 'gray']}`}>
                    {tab.count}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
