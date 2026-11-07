import type { PayoutAccountStatus } from '../../hooks/usePayoutAccountStatus.state';

/**
 * 새 가게 시작 체크리스트 판정(상품 등록·판매 회차·정산 계좌).
 * 화면 프레임워크에 기대지 않는 순수 함수라 vitest로 바로 검증한다.
 *
 * 원칙:
 * - 완료는 조회에 성공해 확실할 때만 판정한다.
 * - 조회 중은 '확인 중', 조회 실패는 '확인하지 못함'으로 두고 '미완료'로 단정하지 않는다.
 * - 셋 다 완료면 체크리스트를 보이지 않는다.
 * - 모든 항목이 아직 조회 중이기만 하면 보이지 않는다(이미 준비를 마친 가게에 매번 깜빡이지 않게).
 *   미완료나 확인하지 못한 항목이 하나라도 있으면 보이고, 남은 조회 중 항목은 '확인 중'으로 보인다.
 */

/** 항목 하나의 조회 결과. ready면 완료 여부를 확실히 안다. */
export type StartChecklistRead =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; done: boolean };

export type StartChecklistItemStatus = 'done' | 'todo' | 'checking' | 'unknown';

export type StartChecklistItemKey = 'products' | 'rounds' | 'payout';

export interface StartChecklistItem {
  key: StartChecklistItemKey;
  label: string;
  href: string;
  status: StartChecklistItemStatus;
}

export interface StartChecklist {
  /** 체크리스트를 화면에 보일지. */
  visible: boolean;
  /** 셋 다 완료로 확인됐는지. 아니면 홈의 "오늘 할 일을 모두 마쳤어요"를 보이지 않는다. */
  allDone: boolean;
  items: StartChecklistItem[];
}

export const START_CHECKLIST_STATUS_LABEL: Record<StartChecklistItemStatus, string> = {
  done: '완료',
  todo: '아직 안 했어요',
  checking: '확인 중',
  unknown: '확인하지 못함',
};

const ITEMS: ReadonlyArray<Omit<StartChecklistItem, 'status'>> = [
  { key: 'products', label: '상품 등록', href: '/products/new' },
  { key: 'rounds', label: '판매 회차 만들기', href: '/sale-rounds/new' },
  { key: 'payout', label: '정산 계좌 등록', href: '/settings/payout-account' },
];

function toItemStatus(read: StartChecklistRead): StartChecklistItemStatus {
  if (read.status === 'loading') return 'checking';
  if (read.status === 'error') return 'unknown';
  return read.done ? 'done' : 'todo';
}

export function buildStartChecklist(
  reads: Record<StartChecklistItemKey, StartChecklistRead>,
): StartChecklist {
  const items = ITEMS.map((item) => ({ ...item, status: toItemStatus(reads[item.key]) }));
  const allDone = items.every((item) => item.status === 'done');
  const visible = items.some((item) => item.status === 'todo' || item.status === 'unknown');
  return { visible, allDone, items };
}

/** 가게 상품 조회 상태 → 체크리스트 조회 결과. 성공 snapshot을 받았고 오류·로딩이 없을 때만 확실하다. */
export function readStoreProductsForChecklist(input: {
  hasLoaded: boolean;
  loading: boolean;
  error: string | null;
  productCount: number;
}): StartChecklistRead {
  if (input.error) return { status: 'error' };
  if (!input.hasLoaded || input.loading) return { status: 'loading' };
  return { status: 'ready', done: input.productCount > 0 };
}

/** 판매 회차 목록 조회 상태 → 체크리스트 조회 결과. 다시 읽는 중이면 확인 중으로 본다. */
export function readSaleRoundsForChecklist(input: {
  loading: boolean;
  error: string | null;
  roundCount: number;
}): StartChecklistRead {
  if (input.error) return { status: 'error' };
  if (input.loading) return { status: 'loading' };
  return { status: 'ready', done: input.roundCount > 0 };
}

/** 정산 계좌 조회 상태 → 체크리스트 조회 결과. 조회 실패는 미등록으로 단정하지 않는다. */
export function readPayoutAccountForChecklist(status: PayoutAccountStatus): StartChecklistRead {
  if (status === 'loading') return { status: 'loading' };
  if (status === 'error') return { status: 'error' };
  return { status: 'ready', done: status === 'registered' };
}
