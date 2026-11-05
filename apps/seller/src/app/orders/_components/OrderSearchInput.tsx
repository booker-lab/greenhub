'use client';

import { Input } from '@greenhub/ui/components/input';

interface Props {
  value: string;
  onChange: (next: string) => void;
  phoneSearching: boolean;
  phoneSearchError: boolean;
}

// ① 외형 유지(UI 교체 P4): Mantine Container size sm(최대 720px, 좌우 16px, py xs = 10px)·
// TextInput(sm, radius md = 8px)·Text(p, 여백 0, 줄 높이 1.55)와 같은 값.
const TEXT = 'm-0 p-0 text-base';
// Mantine Input은 검색 칸의 브라우저 기본 지우기·장식 버튼을 숨긴다(appearance: none).
const NO_SEARCH_BUTTONS =
  '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none';

/** 주문 목록 통합 검색 한 칸 — 손님 이름·전화·주문번호 */
export function OrderSearchInput({ value, onChange, phoneSearching, phoneSearchError }: Props) {
  return (
    // ② 디자인 방향(D3): 칩·검색 띠는 틀과 같은 --frame이고 띠 사이 선을 긋지 않는다.
    <div style={{ backgroundColor: 'var(--frame)' }}>
      <div className="mx-auto max-w-[720px] px-4 py-2.5">
        <Input
          type="search"
          aria-label="주문 검색"
          placeholder="이름·전화·주문번호 검색"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className={`rounded-[8px] ${NO_SEARCH_BUTTONS}`}
        />
        {phoneSearching && (
          <p
            aria-live="polite"
            className={`${TEXT} mt-1`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            전화번호로 찾는 중입니다…
          </p>
        )}
        {phoneSearchError && (
          <p
            className={`${TEXT} mt-1`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
          >
            전화번호로 찾지 못했습니다. 이름·주문번호가 맞는 주문만 보여 줍니다.
          </p>
        )}
      </div>
    </div>
  );
}
