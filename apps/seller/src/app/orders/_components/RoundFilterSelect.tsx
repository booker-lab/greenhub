'use client';

import type { SaleRound } from '@greenhub/shared';
import { NativeSelect } from '@greenhub/ui/components/native-select';
import { useMemo } from 'react';
import {
  ALL_ROUNDS_VALUE,
  buildRoundFilterOptions,
  readRoundFilterSelection,
} from './round-filter-options';

interface Props {
  rounds: readonly SaleRound[];
  value: string | null;
  onChange: (roundId: string | null) => void;
}

// ① 외형 유지: 칩 띠(검색·날짜·보조 필터)와 같은 --frame 띠·Container size sm(최대 720px, 좌우 16px, py 10px).
export function RoundFilterSelect({ rounds, value, onChange }: Props) {
  const options = useMemo(() => buildRoundFilterOptions(rounds, value), [rounds, value]);
  return (
    <div style={{ backgroundColor: 'var(--frame)' }}>
      <div className="mx-auto max-w-[720px] px-4 py-2.5">
        <NativeSelect
          aria-label="회차 선택"
          data={options}
          value={value ?? ALL_ROUNDS_VALUE}
          onChange={(event) => onChange(readRoundFilterSelection(event.currentTarget.value))}
        />
      </div>
    </div>
  );
}
