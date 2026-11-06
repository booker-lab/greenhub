'use client';

import type { SaleType } from '@greenhub/shared';

interface Props {
  value: SaleType;
  onChange: (next: SaleType) => void;
}

const OPTIONS: { key: SaleType; label: string }[] = [
  { key: 'normal', label: '일반 주문' },
  { key: 'group', label: '공동구매' },
];

// ① 외형 유지(UI 교체 P4): Mantine Container size sm(최대 720px, 좌우 16px, py xs = 10px)·Group(gap 0)·
// UnstyledButton과 같은 값.
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';

export function SaleTypeToggle({ value, onChange }: Props) {
  return (
    // ② 디자인 방향(D3): 칩·검색 띠는 틀과 같은 --frame이고 띠 사이 선을 긋지 않는다.
    <div style={{ backgroundColor: 'var(--frame)' }}>
      <div className="mx-auto max-w-[720px] px-4 py-2.5">
        <div className="flex flex-row flex-wrap items-center justify-start gap-0">
          {OPTIONS.map((opt) => {
            const active = value === opt.key;
            return (
              <button
                type="button"
                key={opt.key}
                data-testid={`sale-type-toggle-${opt.key}`}
                onClick={() => onChange(opt.key)}
                className={UNSTYLED_BUTTON}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  textAlign: 'center',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: active ? 700 : 400,
                  // 선택 표시는 판매자 탭 규칙과 같은 검정 3px 밑줄·굵게(design-direction §5).
                  borderBottom: `3px solid ${active ? 'var(--color-text)' : 'transparent'}`,
                  color: active ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  transition: 'all 0.15s',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
