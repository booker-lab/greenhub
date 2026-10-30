'use client';

import { Button, ButtonLabel } from '@greenhub/ui/components/button';
import type { ReactNode } from 'react';

// ① 외형 유지(UI 교체 P2b): Mantine Paper(흰 바탕·모서리 16·그림자 xs·안쪽 16)·Text(p, 여백 0)·Group(간격 10) 값.
const PAPER = 'block rounded-[16px] bg-white p-4 shadow-mantine-xs';
const TEXT = 'm-0 p-0 text-base font-normal';

const LABEL_STYLE = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--color-text-disabled)',
} as const;

const SELECTED_STYLE = {
  backgroundColor: 'var(--color-primary)',
  borderColor: 'var(--color-primary)',
  color: 'white',
} as const;

/** Paper 카드 + 비활성색 라벨. ProductForm 스텝 본문 전반에서 재사용. */
export function FieldCard({
  label,
  labelGap = 'xs',
  children,
}: {
  label: string;
  labelGap?: 'xs' | 'sm';
  children: ReactNode;
}) {
  return (
    <div className={PAPER}>
      <p className={`${TEXT} ${labelGap === 'xs' ? 'mb-2.5' : 'mb-3'}`} style={LABEL_STYLE}>
        {label}
      </p>
      {children}
    </div>
  );
}

/** 단일 선택 버튼 행 (카테고리·배송 사이즈 등 동일 패턴). */
export function ChoiceRow({
  options,
  value,
  onChange,
}: {
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-row flex-wrap items-center justify-start gap-2.5">
      {options.map(({ value: v, label }) => (
        <Button
          key={v}
          onClick={() => onChange(v)}
          className="flex-1"
          variant={value === v ? 'default' : 'outline-gray'}
          style={value === v ? SELECTED_STYLE : {}}
        >
          <ButtonLabel>{label}</ButtonLabel>
        </Button>
      ))}
    </div>
  );
}
