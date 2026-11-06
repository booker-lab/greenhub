'use client';

import { Button } from '@greenhub/ui/components/button';
import { Input, InputSection } from '@greenhub/ui/components/input';
import { StatusDot } from '@greenhub/ui/components/status-dot';
import type { AdminStore } from '@/hooks/useAdmin';
import {
  ADMIN_SUB,
  ADMIN_TD,
  ADMIN_TH,
  AdminListNotice,
  AdminMissing,
  AdminRowMenu,
  type AdminRowMenuItem,
  formatAdminDate,
} from '../../_components/adminList';
import {
  formatRate,
  formatStoreContact,
  STATUS_LABEL,
  STATUS_TONE,
  type StoreEmptyKind,
  type StoreSort,
  type StoreSortKey,
} from '../_lib';

// ② 방향(design-direction.md §5 어드민 "판매자", §8 D7): 줄무늬·머리 띠·그림자 없는 표.
// 열: 상호(굵게, 아래 회색 대표 · 연락처) → 상태(점 + 글자) → 수수료율("5% 기본") → 등록일 → ⋮.
// 회차 주문·지급 대기 열은 판매자별 데이터가 없어 두지 않는다(2026-11-01 "데이터가 없는 칸은 뺀다").
// 태블릿(1100px 이하)은 등록일을 상호 아래 보조 줄로 옮기고, 휴대폰(640px 이하)은 다른 목록과 같은 세 줄 행이다.
// 폭 기준 클래스는 Tailwind가 소스 글자로 찾으므로 조합하지 않고 그대로 쓴다.

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
  /** 그 가게의 정산 화면으로 간다(⋮ "정산 보기"). */
  onOpenSettlements: (store: AdminStore) => void;
  onResetFilters: () => void;
  onSortChange: (sort: StoreSort) => void;
}

const RATE_MAX = 100;
const RATE_STEP = 0.5;

/** 숫자·소수점 둘째 자리까지, 100 넘는 값은 받지 않는다. */
function acceptRateInput(raw: string): string | null {
  if (!/^\d*(\.\d{0,2})?$/.test(raw)) return null;
  if (raw !== '' && raw !== '.' && Number(raw) > RATE_MAX) return null;
  return raw;
}

/** 방향키 위·아래로 0.5씩 바꾼다. */
function stepRate(current: string, direction: 1 | -1): string {
  const base = Number(current);
  const next = (Number.isFinite(base) ? base : 0) + direction * RATE_STEP;
  return String(Math.min(RATE_MAX, Math.max(0, Math.round(next * 100) / 100)));
}

function storeName(store: AdminStore): string {
  return store.name?.trim() || '이름 없는 가게';
}

interface SortHeaderProps {
  label: string;
  sortKey: StoreSortKey;
  sort: StoreSort;
  onSortChange: (sort: StoreSort) => void;
}

// 머리글 정렬 — 13px 회색 글자 그대로, 정렬 중인 열만 화살표를 검정으로.
function SortHeader({ label, sortKey, sort, onSortChange }: SortHeaderProps) {
  const active = sort.key === sortKey;
  const direction = active && sort.direction === 'asc' ? 'desc' : 'asc';
  const indicator = active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕';
  return (
    <button
      type="button"
      onClick={() => onSortChange({ key: sortKey, direction })}
      aria-label={`${label} ${direction === 'asc' ? '오름차순' : '내림차순'} 정렬`}
      className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[13px] leading-[18px] text-inherit"
    >
      <span>{label}</span>
      <span className={active ? 'text-foreground' : undefined}>{indicator}</span>
    </button>
  );
}

// 대표자 · 연락처 — 연락처는 전화 걸기 링크. 낱말 덩어리마다 줄바꿈 금지.
function StoreContact({ store }: { store: AdminStore }) {
  const ceo = store.ceoName?.trim();
  const phone = store.phone?.trim();
  if (!ceo && !phone) return <>{formatStoreContact(store)}</>;
  return (
    <>
      {ceo && <span className="whitespace-nowrap">{ceo}</span>}
      {ceo && phone && ' · '}
      {phone && (
        <a href={`tel:${phone}`} className="whitespace-nowrap text-inherit tabular-nums">
          {phone}
        </a>
      )}
    </>
  );
}

function StoreRate({ store }: { store: AdminStore }) {
  const { percent, isDefault } = formatRate(store.commissionRate);
  return (
    <span className="whitespace-nowrap tabular-nums">
      {percent}
      {isDefault && <span className="text-[var(--color-text-secondary)]"> 기본</span>}
    </span>
  );
}

function StoreJoined({ store }: { store: AdminStore }) {
  const date = formatAdminDate(store.createdAt);
  return date ? <span className="whitespace-nowrap tabular-nums">{date}</span> : <AdminMissing />;
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
  onOpenSettlements,
  onResetFilters,
  onSortChange,
}: StoresTableProps) {
  if (loading) return <AdminListNotice>불러오는 중...</AdminListNotice>;
  if (emptyKind !== 'has-data') {
    return (
      <AdminListNotice>
        {emptyKind === 'no-match' ? '조건에 맞는 판매자가 없습니다.' : '등록된 판매자가 없습니다.'}
        {emptyKind === 'no-match' && (
          <Button size="xs" variant="secondary" onClick={onResetFilters}>
            필터 초기화
          </Button>
        )}
      </AdminListNotice>
    );
  }

  // 수수료율 칸 — ⋮ "수수료 바꾸기…"를 고른 행만 입력칸으로 바뀐다(표·휴대폰 행 공용).
  const renderRate = (store: AdminStore) =>
    editId === store.id ? (
      <span className="flex flex-wrap items-center gap-2">
        {/* % 단위 입력(예: 5 = 5%). 저장할 때 0~1 값으로 바꾼다(_lib parseRate). */}
        <span className="relative w-[104px]">
          <Input
            inputMode="decimal"
            value={rateInput}
            // 메뉴에서 고른 뒤 바로 입력하도록 초점을 옮긴다.
            autoFocus
            onChange={(event) => {
              const accepted = acceptRateInput(event.currentTarget.value);
              if (accepted !== null) onRateInput(accepted);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSave(store.id);
                return;
              }
              if (event.key === 'Escape') {
                onCancelEdit();
                return;
              }
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              onRateInput(stepRate(rateInput, event.key === 'ArrowUp' ? 1 : -1));
            }}
            placeholder="5"
            aria-label={`${storeName(store)} 수수료율(%)`}
            size="xs"
            className="rounded-[4px] pe-[17px]"
          />
          <InputSection side="right" size="xs" className="w-[17px] rounded-e-[4px]">
            %
          </InputSection>
        </span>
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
      </span>
    ) : (
      <StoreRate store={store} />
    );

  const menuItems = (store: AdminStore): AdminRowMenuItem[] =>
    editId === store.id
      ? []
      : [
          { key: 'commission', label: '수수료 바꾸기…', onSelect: () => onStartEdit(store) },
          store.status === 'archived'
            ? { key: 'restore', label: '복구하기…', onSelect: () => onRestore(store) }
            : { key: 'archive', label: '정리하기…', onSelect: () => onArchive(store) },
          { key: 'settlements', label: '정산 보기', onSelect: () => onOpenSettlements(store) },
        ];
  const menuOf = (store: AdminStore) => (
    <AdminRowMenu label={`판매자 ${storeName(store)}`} items={menuItems(store)} />
  );
  const statusOf = (store: AdminStore, size: 13 | 15) => (
    <StatusDot tone={STATUS_TONE[store.status] ?? 'default'} size={size}>
      {STATUS_LABEL[store.status] ?? store.status}
    </StatusDot>
  );

  return (
    <>
      {/* 휴대폰(640px 이하): 세 줄 행 — 1줄 상호·수수료율, 2줄 대표·연락처와 오른쪽 상태, 3줄 등록일, 옆에 ⋮ 한 자리. */}
      <ul className="m-0 list-none p-0 min-[641px]:hidden" aria-label="판매자 목록">
        {stores.map((store) => (
          <li
            key={store.id}
            className="flex items-center gap-2 border-b border-rule py-2.5 [word-break:keep-all]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="m-0 min-w-0 text-[15px] leading-[22px] font-bold">
                  {storeName(store)}
                </p>
                <div className="text-[15px] leading-[22px]">{renderRate(store)}</div>
              </div>
              <div className="flex items-start justify-between gap-2">
                <p className={`${ADMIN_SUB} min-w-0`}>
                  <StoreContact store={store} />
                </p>
                {statusOf(store, 13)}
              </div>
              <p className={ADMIN_SUB}>
                등록 <StoreJoined store={store} />
              </p>
            </div>
            <div className="flex w-11 shrink-0 justify-center">{menuOf(store)}</div>
          </li>
        ))}
      </ul>

      {/* 태블릿·데스크톱(641px 이상): 표. 1100px 이하는 등록일을 상호 아래 보조 줄로 옮긴다. */}
      <table className="w-full border-collapse max-[640px]:hidden">
        <thead>
          <tr>
            <th className={ADMIN_TH}>
              <SortHeader label="상호" sortKey="name" sort={sort} onSortChange={onSortChange} />
            </th>
            <th className={ADMIN_TH}>
              <SortHeader label="상태" sortKey="status" sort={sort} onSortChange={onSortChange} />
            </th>
            <th className={ADMIN_TH}>
              <SortHeader label="수수료율" sortKey="rate" sort={sort} onSortChange={onSortChange} />
            </th>
            <th className={`${ADMIN_TH} max-[1100px]:hidden`}>등록일</th>
            <th className={`${ADMIN_TH} w-[60px]`}>
              <span className="sr-only">동작</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {stores.map((store) => (
            <tr key={store.id}>
              <td className={`${ADMIN_TD} w-[44%] [word-break:keep-all]`}>
                <p className="m-0 font-bold">{storeName(store)}</p>
                <p className={ADMIN_SUB}>
                  <StoreContact store={store} />
                </p>
                <p className={`${ADMIN_SUB} min-[1101px]:hidden`}>
                  등록 <StoreJoined store={store} />
                </p>
              </td>
              <td className={ADMIN_TD}>{statusOf(store, 15)}</td>
              <td className={ADMIN_TD}>{renderRate(store)}</td>
              <td className={`${ADMIN_TD} max-[1100px]:hidden`}>
                <StoreJoined store={store} />
              </td>
              <td className={`${ADMIN_TD} py-1 text-right align-middle`}>
                <span className="flex justify-end">{menuOf(store)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
