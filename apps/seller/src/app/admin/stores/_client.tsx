'use client';

import { ButtonLink } from '@greenhub/ui/components/button';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { notify } from '@/components/AppToaster';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import type { AdminStore } from '@/hooks/useAdmin';
import {
  classifyAdminCommandError,
  describeAdminCommandOutcome,
  useAdminStores,
} from '@/hooks/useAdmin';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { AdminListError, AdminPageHeader } from '../_components/adminList';
import { StoresFilters } from './_components/StoresFilters';
import { StoresTable } from './_components/StoresTable';
import {
  countStoresByFilter,
  DEFAULT_COMMISSION_PERCENT,
  DEFAULT_SORT,
  DEFAULT_STATUS_FILTER,
  describeArchiveConfirm,
  describeArchiveRecordsPrompt,
  describeCommissionSaved,
  describeRestoreConfirm,
  filterStores,
  getAdminStoresReadState,
  getEmptyKind,
  parseRate,
  parseSort,
  parseStatusFilter,
  rateToInput,
  STATUS_FILTER_OPTIONS,
  type StoreSort,
  type StoreStatusFilter,
  sortStores,
} from './_lib';

interface StoreViewState {
  keyword: string;
  status: StoreStatusFilter;
  sort: StoreSort;
}

/** 검색어 입력을 URL에 반영하기까지 기다리는 시간. 글자마다 주소를 바꾸지 않는다. */
const KEYWORD_URL_DEBOUNCE_MS = 300;

export default function AdminStoresClient() {
  const { stores, loading, error, reload, setCommission, archiveStore, restoreStore } =
    useAdminStores();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<StoreViewState>(() => ({
    keyword: searchParams.get('keyword') ?? '',
    status: parseStatusFilter(searchParams.get('status')),
    sort: parseSort(searchParams.get('sort'), searchParams.get('dir')),
  }));
  const [editId, setEditId] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState('');
  const [saving, setSaving] = useState(false);

  // 이 화면이 마지막으로 쓴 쿼리. 그 쿼리가 searchParams로 되돌아올 때는 입력 중인 화면 상태를
  // 덮지 않는다. 다른 쿼리(뒤로·앞으로 가기 등)가 오면 기록을 지우고 URL 기준으로 맞춘다.
  const writtenQueryRef = useRef<string | null>(null);

  useEffect(() => {
    if (searchParams.toString() === writtenQueryRef.current) return;
    writtenQueryRef.current = null;
    setView({
      keyword: searchParams.get('keyword') ?? '',
      status: parseStatusFilter(searchParams.get('status')),
      sort: parseSort(searchParams.get('sort'), searchParams.get('dir')),
    });
  }, [searchParams]);

  const writeViewToUrl = (next: StoreViewState, mode: 'push' | 'replace') => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.keyword.trim()) params.set('keyword', next.keyword);
    else params.delete('keyword');
    if (next.status === DEFAULT_STATUS_FILTER) params.delete('status');
    else params.set('status', next.status);
    if (next.sort.key === DEFAULT_SORT.key) params.delete('sort');
    else params.set('sort', next.sort.key);
    if (next.sort.direction === DEFAULT_SORT.direction) params.delete('dir');
    else params.set('dir', next.sort.direction);

    const query = params.toString();
    if (query === searchParams.toString()) return;
    writtenQueryRef.current = query;
    const href = query ? `${pathname}?${query}` : pathname;
    if (mode === 'replace') router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  };

  // 검색어는 입력이 멈춘 뒤 한 번만, 브라우저 기록을 쌓지 않도록 replace로 URL에 반영한다.
  const writeKeywordToUrl = useDebouncedCallback(
    (next: StoreViewState) => writeViewToUrl(next, 'replace'),
    KEYWORD_URL_DEBOUNCE_MS,
  );

  const updateView = (patch: Partial<StoreViewState>, options?: { debounceUrl?: boolean }) => {
    const next = { ...view, ...patch };
    setView(next);
    if (options?.debounceUrl) {
      writeKeywordToUrl(next);
      return;
    }
    // 상태·정렬 변경은 대기 중인 검색어 반영을 흡수해 바로 쓴다(next에 최신 검색어 포함).
    writeKeywordToUrl.cancel();
    writeViewToUrl(next, 'push');
  };

  const resetFilters = () => {
    updateView({ keyword: '', status: DEFAULT_STATUS_FILTER });
  };

  const handleSave = async (storeId: string) => {
    const parsed = parseRate(rateInput);
    if (!parsed.ok) {
      notify({
        color: 'yellow',
        title: '입력 값을 확인하세요',
        message: '0~100 사이의 수수료율(%)을 입력해야 합니다 (예: 5 = 5%).',
      });
      return;
    }
    setSaving(true);
    const outcome = await setCommission(storeId, parsed.rate);
    setSaving(false);
    if (outcome.kind === 'confirmed' && outcome.reconciled) {
      setEditId(null);
      setRateInput('');
      const storeName = stores.find((s) => s.id === storeId)?.name ?? '';
      notify({
        color: 'brand',
        title: '수수료율 저장',
        message: describeCommissionSaved(storeName, parsed.rate),
      });
      return;
    }
    if (outcome.kind === 'confirmed') {
      // COMMAND CONFIRMED + RECONCILIATION FAILED — 실패로 되돌리지 않고 중복 실행을 유도하지 않는다.
      setEditId(null);
      setRateInput('');
      const presentation = describeAdminCommandOutcome(outcome, '수수료율 변경');
      notify({
        color: 'yellow',
        title: presentation.title,
        message: presentation.message,
      });
      return;
    }
    // rejected: 서버 reason 보존 + 편집 유지(수정 가능). unknown: 재확인 우선 + 편집 유지.
    const presentation = describeAdminCommandOutcome(outcome, '수수료율 변경');
    notify({
      color: outcome.kind === 'rejected' ? 'red' : 'yellow',
      title: presentation.title,
      message: presentation.message,
    });
  };

  const handleStartEdit = (store: AdminStore) => {
    setEditId(store.id);
    setRateInput(rateToInput(store.commissionRate));
  };

  const handleCancelEdit = () => {
    setEditId(null);
    setRateInput('');
  };

  const handleArchive = async (store: AdminStore) => {
    if (!window.confirm(describeArchiveConfirm(store))) return;
    try {
      const reconciliation = await archiveStore(store.id).catch((e: unknown) => {
        // 주문·정산 기록이 있는 판매자(412) — 가게 ID 앞 8자리를 받아 한 번 더 보낸다.
        const classified = classifyAdminCommandError(e);
        if (classified.kind !== 'rejected' || classified.status !== 412) throw e;
        const typed = window.prompt(describeArchiveRecordsPrompt(store));
        return typed === null ? null : archiveStore(store.id, typed);
      });
      if (reconciliation === null) return;
      if (!reconciliation.reconciled) {
        // COMMAND CONFIRMED + RECONCILIATION FAILED — 실패로 표현하지 않고 중복 실행을 유도하지 않는다.
        notify({
          color: 'yellow',
          title: '정리는 완료됐으나 목록 확인 실패',
          message: `${reconciliation.readError ?? '목록 조회 실패'} 다시 조회해 최신 상태를 확인해 주세요. 같은 작업을 중복 실행하지 마세요.`,
        });
        return;
      }
      notify({
        color: 'brand',
        title: '판매자를 정리했습니다',
        message: `${store.name || '이름 없는 가게'} — 손님 화면에서 숨고 새 주문을 받지 않습니다.`,
      });
    } catch (e) {
      const classified = classifyAdminCommandError(e);
      if (classified.kind === 'unknown') {
        const presentation = describeAdminCommandOutcome(classified, '정리하기');
        notify({
          color: 'yellow',
          title: presentation.title,
          message: presentation.message,
        });
        return;
      }
      // 기록 가드(400) 등 차단 사유를 서버 메시지 그대로 안내
      notify({
        color: 'red',
        title: '정리할 수 없습니다',
        message: e instanceof Error ? e.message : '판매자를 정리하는 중 오류가 발생했습니다.',
      });
    }
  };

  const handleRestore = async (store: AdminStore) => {
    if (!window.confirm(describeRestoreConfirm(store))) return;
    try {
      const reconciliation = await restoreStore(store.id);
      if (!reconciliation.reconciled) {
        notify({
          color: 'yellow',
          title: '복구 처리는 완료됐으나 목록 확인 실패',
          message: `${reconciliation.readError ?? '목록 조회 실패'} 다시 조회해 최신 상태를 확인해 주세요. 같은 작업을 중복 실행하지 마세요.`,
        });
        return;
      }
      notify({
        color: 'brand',
        title: '판매자를 복구했습니다',
        message: `${store.name || '이름 없는 가게'} — 손님 화면에 다시 보이고 주문을 받습니다.`,
      });
    } catch (e) {
      const classified = classifyAdminCommandError(e);
      if (classified.kind === 'unknown') {
        const presentation = describeAdminCommandOutcome(classified, '복구');
        notify({
          color: 'yellow',
          title: presentation.title,
          message: presentation.message,
        });
        return;
      }
      notify({
        color: 'red',
        title: '복구할 수 없습니다',
        message: e instanceof Error ? e.message : '판매자 복구 중 오류가 발생했습니다.',
      });
    }
  };

  const filtered = filterStores(stores, { keyword: view.keyword, status: view.status });
  const visible = sortStores(filtered, view.sort);
  const emptyKind = getEmptyKind(stores, visible);
  // 조회 실패는 정상 빈 결과로 collapse하지 않는다.
  // useAdminList는 실패 시 이전 stores를 보존하므로 stale 유무와 무관하게 error를 우선한다.
  // filter/query state는 초기화하지 않고 Filters는 항상 유지된다.
  const readState = getAdminStoresReadState({ loading, error, stores, visible });
  const isFetchError = readState === 'FETCH_ERROR';

  const counts = countStoresByFilter(stores, view.keyword);
  const statusTabs = STATUS_FILTER_OPTIONS.map((option) => ({
    key: option.value,
    label: option.label,
    count: !loading && error === null ? counts[option.value] : undefined,
  }));

  return (
    <div>
      {/* ② 방향(design-direction.md §5 어드민 "판매자", §8 D7): 명사 하나의 h1, 지금 기준 한 줄, 주요 버튼은 초대 링크 만들기. */}
      {/* 가게별 수수료율은 정산을 만들 때 그 가게 요율로 계산한다(결정 ②, BACKLOG STORE-COMMISSION-RATE-UNUSED).
          이미 만든 정산은 다시 계산하지 않는다. */}
      <AdminPageHeader
        title="판매자"
        subline={`수수료율은 다음에 만들어지는 정산부터 적용됩니다. 설정하지 않은 가게는 기본 ${DEFAULT_COMMISSION_PERCENT}%로 정산하며, 이미 만든 정산은 바뀌지 않습니다.`}
        action={
          <ButtonLink render={<Link href="/admin/invite" />} className="rounded-[8px]">
            초대 링크 만들기
          </ButtonLink>
        }
      />

      <StoresFilters
        keyword={view.keyword}
        sort={view.sort}
        loading={loading}
        onKeywordChange={(keyword) => updateView({ keyword }, { debounceUrl: true })}
        onSortChange={(sort) => updateView({ sort })}
        onReload={reload}
      />

      <div className="mb-2">
        <SegmentedTabs<StoreStatusFilter>
          tabs={statusTabs}
          value={view.status}
          onChange={(status) => updateView({ status })}
          layout="scroll"
          variant="underline"
          surface="paper"
          ariaLabel="판매자 상태"
        />
      </div>

      {isFetchError ? (
        <AdminListError title="판매자 목록을 불러오지 못했습니다." error={error} onRetry={reload} />
      ) : (
        <StoresTable
          stores={visible}
          loading={loading}
          emptyKind={emptyKind}
          sort={view.sort}
          editId={editId}
          rateInput={rateInput}
          saving={saving}
          onRateInput={setRateInput}
          onStartEdit={handleStartEdit}
          onCancelEdit={handleCancelEdit}
          onSave={handleSave}
          onArchive={handleArchive}
          onRestore={handleRestore}
          onOpenSettlements={(store) =>
            router.push(`/admin/settlements?store=${encodeURIComponent(store.id)}`)
          }
          onResetFilters={resetFilters}
          onSortChange={(sort) => updateView({ sort })}
        />
      )}
    </div>
  );
}
