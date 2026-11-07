import type { SaleRound } from '@greenhub/shared';

/** 회차 선택에서 "전체 회차"(회차 필터 없음)를 뜻하는 값. */
export const ALL_ROUNDS_VALUE = '';

export interface RoundFilterOption {
  value: string;
  label: string;
}

type RoundForFilter = Pick<SaleRound, 'id' | 'name' | 'schedule' | 'createdAt'>;

function compareRecentFirst(a: RoundForFilter, b: RoundForFilter): number {
  const byOpen = Date.parse(b.schedule.orderOpenAt) - Date.parse(a.schedule.orderOpenAt);
  if (byOpen !== 0 && !Number.isNaN(byOpen)) return byOpen;
  return Date.parse(b.createdAt) - Date.parse(a.createdAt) || 0;
}

/**
 * 주문 화면 회차 선택 항목. "전체 회차"를 맨 앞에 두고 주문 시작이 늦은(최근) 회차부터 보인다.
 * 딥링크로 들어온 회차가 목록에 없으면(아직 못 받았거나 다른 목록) "선택한 회차"로 남겨 선택이 풀려 보이지 않게 한다.
 */
export function buildRoundFilterOptions(
  rounds: readonly RoundForFilter[],
  selectedRoundId: string | null,
): RoundFilterOption[] {
  const sorted = [...rounds].sort(compareRecentFirst);
  const options: RoundFilterOption[] = [{ value: ALL_ROUNDS_VALUE, label: '전체 회차' }];
  if (selectedRoundId && !sorted.some((round) => round.id === selectedRoundId)) {
    options.push({ value: selectedRoundId, label: '선택한 회차' });
  }
  for (const round of sorted) options.push({ value: round.id, label: round.name });
  return options;
}

/** 선택 값을 회차 필터로 바꾼다. "전체 회차"는 필터 없음(null)이다. */
export function readRoundFilterSelection(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === ALL_ROUNDS_VALUE ? null : trimmed;
}
