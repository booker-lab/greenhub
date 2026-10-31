'use client';

import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
import { Input } from '@greenhub/ui/components/input';
import type { AdminStore } from '@/hooks/useAdmin';
import {
  formatRate,
  formatStoreContact,
  STATUS_COLOR,
  STATUS_LABEL,
  type StoreEmptyKind,
  type StoreSort,
  type StoreSortKey,
} from '../_lib';

// ① 외형 유지(UI 교체 P2b): Mantine Text(p, 16px·줄 높이 1.55·여백 0)·Paper·Group·Stack과 같은 값.
// 카드·표 전환은 Mantine hiddenFrom·visibleFrom="sm"(48em)과 같은 경계다.
const TEXT = 'm-0 p-0 text-base font-normal';
const PAPER = 'block rounded-[16px] bg-white shadow-mantine-xs';
const HIDDEN_FROM_SM = 'min-[48em]:hidden!';
const VISIBLE_FROM_SM = 'max-[47.99375em]:hidden!';
const GROUP = 'flex flex-row flex-wrap items-center';
// Mantine Badge light: brand ↔ light, yellow ↔ warning, gray ↔ secondary.
const STATUS_BADGE_VARIANT = { brand: 'light', yellow: 'warning', gray: 'secondary' } as const;

function StatusBadge({ status }: { status: AdminStore['status'] }) {
  const color = (STATUS_COLOR[status] ?? 'gray') as keyof typeof STATUS_BADGE_VARIANT;
  return (
    <Badge variant={STATUS_BADGE_VARIANT[color] ?? 'secondary'} className="rounded-[32px]">
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

interface StoresTableProps {
  stores: AdminStore[];
  loading: boolean;
  emptyKind: StoreEmptyKind;
  sort: StoreSort;
  editId: string | null;
  rateInput: string;
  saving: boolean;
  onRateInput: (v: string) => void;
  onStartEdit: (store: AdminStore) => void;
  onCancelEdit: () => void;
  onSave: (storeId: string) => void;
  onArchive: (store: AdminStore) => void;
  onRestore: (store: AdminStore) => void;
  onResetFilters: () => void;
  onSortChange: (sort: StoreSort) => void;
}

const thBase = {
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

const RATE_MAX = 100;
const RATE_STEP = 0.5;

/** Mantine NumberInput(decimalScale 2, clampBehavior strict)처럼 숫자·소수점 둘째 자리까지, 100 넘는 값은 받지 않는다. */
function acceptRateInput(raw: string): string | null {
  if (!/^\d*(\.\d{0,2})?$/.test(raw)) return null;
  if (raw !== '' && raw !== '.' && Number(raw) > RATE_MAX) return null;
  return raw;
}

/** 방향키 위·아래로 0.5씩 바꾼다(Mantine NumberInput step). */
function stepRate(current: string, direction: 1 | -1): string {
  const base = Number(current);
  const next = (Number.isFinite(base) ? base : 0) + direction * RATE_STEP;
  return String(Math.min(RATE_MAX, Math.max(0, Math.round(next * 100) / 100)));
}

interface SortHeaderProps {
  label: string;
  sortKey: StoreSortKey;
  sort: StoreSort;
  onSortChange: (sort: StoreSort) => void;
}

function SortHeader({ label, sortKey, sort, onSortChange }: SortHeaderProps) {
  const active = sort.key === sortKey;
  const direction = active && sort.direction === 'asc' ? 'desc' : 'asc';
  const indicator = active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕';

  return (
    <button
      type="button"
      onClick={() => onSortChange({ key: sortKey, direction })}
      aria-label={`${label} ${direction === 'asc' ? '오름차순' : '내림차순'} 정렬`}
      className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]"
    >
      <div className="flex flex-row flex-nowrap items-center justify-start gap-1">
        <span>{label}</span>
        <span style={{ color: 'var(--color-text-disabled)' }}>{indicator}</span>
      </div>
    </button>
  );
}

// 대표자·연락처 — 테이블·카드 공용. 연락처는 전화 걸기 링크로 둔다.
function StoreContact({ store }: { store: AdminStore }) {
  const phone = store.phone?.trim();
  return (
    <p
      className={TEXT}
      style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
    >
      {phone ? (
        <>
          {store.ceoName?.trim() ? `${store.ceoName.trim()} · ` : ''}
          <a href={`tel:${phone}`} style={{ color: 'inherit' }}>
            {phone}
          </a>
        </>
      ) : (
        formatStoreContact(store)
      )}
    </p>
  );
}

function StoreIdText({ store }: { store: AdminStore }) {
  return (
    <p
      className={`${TEXT} font-mono`}
      style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
    >
      {store.id.slice(0, 8)}…
    </p>
  );
}

export function StoresTable({
  stores,
  loading,
  emptyKind,
  sort,
  editId,
  rateInput,
  saving,
  onRateInput,
  onStartEdit,
  onCancelEdit,
  onSave,
  onArchive,
  onRestore,
  onResetFilters,
  onSortChange,
}: StoresTableProps) {
  if (loading || emptyKind !== 'has-data') {
    return (
      <div
        className={PAPER}
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <div className="flex flex-col items-center gap-3 py-16">
          <p className={`${TEXT} text-center`} style={{ color: 'var(--color-text-disabled)' }}>
            {loading
              ? '불러오는 중...'
              : emptyKind === 'no-match'
                ? '조건에 맞는 판매자가 없습니다.'
                : '등록된 판매자가 없습니다.'}
          </p>
          {!loading && emptyKind === 'no-match' && (
            <Button size="xs" variant="secondary" onClick={onResetFilters}>
              필터 초기화
            </Button>
          )}
        </div>
      </div>
    );
  }

  // 수수료율 표시/편집 — 테이블·카드 공용(중복 제거)
  const renderRate = (store: AdminStore) =>
    editId === store.id ? (
      <div className={`${GROUP} justify-start gap-2.5`}>
        {/* % 단위 입력(예: 5 = 5%). 저장할 때 0~1 값으로 바꾼다(_lib parseRate). */}
        <Input
          inputMode="decimal"
          value={rateInput}
          onChange={(event) => {
            const accepted = acceptRateInput(event.currentTarget.value);
            if (accepted !== null) onRateInput(accepted);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            onRateInput(stepRate(rateInput, event.key === 'ArrowUp' ? 1 : -1));
          }}
          placeholder="5"
          rightSection="%"
          aria-label="수수료율(%)"
          size="xs"
          className="rounded-[4px]"
          rootClassName="w-[104px]"
        />
        <Button
          onClick={() => onSave(store.id)}
          disabled={saving}
          size="xs"
          className="rounded-[8px]"
        >
          저장
        </Button>
        <Button onClick={onCancelEdit} size="xs" variant="ghost" className="rounded-[8px]">
          취소
        </Button>
      </div>
    ) : (
      <p className={TEXT} style={{ color: 'var(--color-text-secondary)' }}>
        {formatRate(store.commissionRate)}
      </p>
    );

  // 수수료 설정 진입 버튼 — 테이블·카드 공용
  const renderSetButton = (store: AdminStore) =>
    editId !== store.id && (
      <Button onClick={() => onStartEdit(store)} size="xs" variant="subtle">
        수수료 설정
      </Button>
    );

  // 치우기/복구 버튼 — 테이블·카드 공용
  const renderArchiveButton = (store: AdminStore) =>
    editId !== store.id &&
    (store.status === 'archived' ? (
      <Button onClick={() => onRestore(store)} size="xs" variant="subtle">
        복구
      </Button>
    ) : (
      <Button onClick={() => onArchive(store)} size="xs" variant="subtle-destructive">
        치우기
      </Button>
    ));

  return (
    <>
      {/* 모바일(<sm): 카드 리스트 — 수수료율·설정 버튼 잘림 방지 */}
      {/* biome-ignore lint/a11y/useSemanticElements: Mantine Stack(div) 그대로의 목록 역할. ul로 바꾸면 기본 여백·글머리표가 생긴다. */}
      <div className={`flex flex-col gap-3 ${HIDDEN_FROM_SM}`} role="list" aria-label="가게 목록">
        {stores.map((store) => (
          // biome-ignore lint/a11y/useSemanticElements: 위 목록(div)의 항목. Mantine Paper(div) 그대로다.
          <div
            role="listitem"
            key={store.id}
            className="block rounded-[8px] bg-white px-4 py-3 shadow-mantine-xs"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <div className="mb-2.5 flex flex-row flex-wrap items-start justify-between gap-4">
              <div>
                <p className={TEXT} style={{ fontWeight: 'var(--fw-medium)' }}>
                  {store.name || '(미설정)'}
                </p>
                <StoreContact store={store} />
                <StoreIdText store={store} />
              </div>
              <StatusBadge status={store.status} />
            </div>
            <div className={`${GROUP} mt-2.5 justify-between gap-4`}>
              {renderRate(store)}
              <div className={`${GROUP} justify-start gap-2.5`}>
                {renderSetButton(store)}
                {renderArchiveButton(store)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 데스크톱(≥sm): 기존 테이블 유지(시각 회귀 0) */}
      <div
        className={`${PAPER} ${VISIBLE_FROM_SM}`}
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <table
          style={{ width: '100%', fontSize: 'var(--font-size-sm)', borderCollapse: 'collapse' }}
        >
          <thead
            style={{
              backgroundColor: 'var(--color-surface-muted)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <tr>
              <th style={{ ...thBase, textAlign: 'left' }}>
                <SortHeader label="상호" sortKey="name" sort={sort} onSortChange={onSortChange} />
              </th>
              <th style={{ ...thBase, textAlign: 'left' }}>대표자·연락처</th>
              <th style={{ ...thBase, textAlign: 'left' }}>
                <SortHeader label="상태" sortKey="status" sort={sort} onSortChange={onSortChange} />
              </th>
              <th style={{ ...thBase, textAlign: 'left' }}>
                <SortHeader
                  label="수수료율"
                  sortKey="rate"
                  sort={sort}
                  onSortChange={onSortChange}
                />
              </th>
              <th style={{ padding: '12px 16px' }} />
            </tr>
          </thead>
          <tbody style={{ borderTop: 'none' }}>
            {stores.map((store) => (
              <tr key={store.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <p className={TEXT} style={{ fontWeight: 'var(--fw-medium)' }}>
                    {store.name || '(미설정)'}
                  </p>
                  <StoreIdText store={store} />
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <StoreContact store={store} />
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <StatusBadge status={store.status} />
                </td>
                <td style={{ padding: '12px 16px' }}>{renderRate(store)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <div className={`${GROUP} justify-end gap-2.5`}>
                    {renderSetButton(store)}
                    {renderArchiveButton(store)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
