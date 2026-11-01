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
  /**
   * underline: ② 방향(design-direction.md §3.2·§5) — 선택은 검정 3px 밑줄 + 굵은 글자, 색을 칠하지 않는다.
   * 건수는 배지 대신 글자로 붙이고 0은 회색 "0"으로 쓴다(빨갛게 하지 않는다). 선택 상태는 aria-pressed로도 알린다.
   * 지정하지 않으면 지금 모양(브랜드 2px 밑줄 + 배지)을 그대로 쓴다.
   */
  variant?: 'default' | 'underline';
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
  variant = 'default',
}: Props<T>) {
  const underline = variant === 'underline';
  const containerStyle: CSSProperties = {
    backgroundColor: 'var(--frame)',
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
            const buttonStyle: CSSProperties = underline
              ? {
                  padding: '12px 16px',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: active ? 700 : 400,
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  borderBottom: `3px solid ${active ? 'var(--color-text)' : 'transparent'}`,
                  color: active ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  transition: 'color 0.15s, border-color 0.15s',
                  ...(layout === 'flex' ? { flex: 1 } : { flexShrink: 0 }),
                }
              : {
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
                {...(underline ? { 'aria-pressed': active } : {})}
                className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-inherit no-underline"
                style={buttonStyle}
              >
                {tab.label}
                {underline && typeof tab.count === 'number' && (
                  <span
                    className="tabular-nums"
                    style={{
                      marginLeft: 6,
                      // 0은 회색(--color-text-disabled는 틀 바탕 위 대비 2.3:1이라 쓰지 않는다), 나머지는 검정.
                      color: tab.count === 0 ? 'var(--color-text-secondary)' : 'var(--color-text)',
                    }}
                  >
                    {tab.count}
                  </span>
                )}
                {!underline && typeof tab.count === 'number' && tab.count > 0 && (
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
