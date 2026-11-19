'use client';

import { Input } from '@greenhub/ui/components/input';
import { SearchableSelect } from '@greenhub/ui/components/searchable-select';

interface SettlementFiltersProps {
  storeFilter: string;
  storeOptions: { value: string; label: string }[];
  storesLoading: boolean;
  fromFilter: string;
  toFilter: string;
  onStoreChange: (v: string) => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}

// 날짜칸은 공용 Input(높이 36·border-input·모서리 8·다크 토큰)으로 가게 칸과 맞춘다.
// 두 칸은 "정산일 [시작] ~ [종료]" 한 덩어리로 묶어 시작·종료를 눈으로 구분한다(칸 이름은 aria-label이 맡는다).
// 휴대폰(≤640)은 가게 한 줄, 정산일 한 줄로 펼친다(종료일이 혼자 다음 줄로 내려가지 않게).
const dateInputClass =
  'w-[150px] rounded-[8px] tabular-nums max-[640px]:w-auto max-[640px]:flex-1 max-[640px]:px-2';

export function SettlementFilters({
  storeFilter,
  storeOptions,
  storesLoading,
  fromFilter,
  toFilter,
  onStoreChange,
  onFromChange,
  onToChange,
}: SettlementFiltersProps) {
  return (
    <div className="mb-4 flex flex-row flex-wrap items-center justify-start gap-3">
      {/* 가게는 이름으로 고른다(관리자 판매자 목록). 비우면 전체 가게. */}
      <div className="min-w-0 flex-1 basis-[220px] max-[640px]:basis-full">
        <SearchableSelect
          placeholder={storesLoading ? '가게 불러오는 중…' : '전체 가게'}
          aria-label="가게"
          data={storeOptions}
          value={storeFilter || null}
          onValueChange={(value) => onStoreChange(value ?? '')}
          clearable
          nothingFoundMessage="일치하는 가게가 없습니다"
          className="rounded-[8px]"
        />
      </div>
      <div className="flex min-w-0 items-center gap-2 max-[640px]:basis-full">
        <span
          aria-hidden="true"
          className="text-[13px] font-bold whitespace-nowrap text-[var(--color-text-secondary)]"
        >
          정산일
        </span>
        <Input
          type="date"
          aria-label="시작일"
          value={fromFilter}
          onChange={(e) => onFromChange(e.target.value)}
          className={dateInputClass}
        />
        <span aria-hidden="true" className="text-[var(--color-text-secondary)]">
          ~
        </span>
        <Input
          type="date"
          aria-label="종료일"
          value={toFilter}
          onChange={(e) => onToChange(e.target.value)}
          className={dateInputClass}
        />
      </div>
    </div>
  );
}
