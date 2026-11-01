'use client';

import { Button, ButtonLabel } from '@greenhub/ui/components/button';
import type { ReactNode } from 'react';

// ① 외형 유지(UI 교체 P2b): Mantine Paper(흰 바탕·모서리 16·안쪽 16; 그림자는 ② D2로 걷음)·Text(p, 여백 0)·Group(간격 10) 값.
const PAPER = 'block rounded-[16px] bg-white p-4';
const TEXT = 'm-0 p-0 text-base font-normal';

const LABEL_STYLE = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--color-text-disabled)',
} as const;

// ② 디자인 방향(§3.2): 선택 표시는 초록 면 대신 흰 바탕 + 검정 1px 테두리 + 굵은 검정 글자(주문 선택 칩과 같은 규칙).
const SELECTED_STYLE = {
  backgroundColor: 'var(--color-bg)',
  borderColor: 'var(--color-text)',
  color: 'var(--color-text)',
  fontWeight: 'var(--fw-bold)',
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
          variant="outline-gray"
          style={value === v ? SELECTED_STYLE : {}}
        >
          <ButtonLabel>{label}</ButtonLabel>
        </Button>
      ))}
    </div>
  );
}
