'use client';

import { Box, Group, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AdminStore } from '@/hooks/useAdmin';
import { useAdminStores } from '@/hooks/useAdmin';
import { StoresFilters } from './_components/StoresFilters';
import { StoresTable } from './_components/StoresTable';
import {
  DEFAULT_SORT,
  DEFAULT_STATUS_FILTER,
  filterStores,
  getEmptyKind,
  parseSort,
  parseStatusFilter,
  type StoreSort,
  type StoreStatusFilter,
  sortStores,
} from './_lib';

interface StoreViewState {
  keyword: string;
  status: StoreStatusFilter;
  sort: StoreSort;
}

export default function AdminStoresClient() {
  const { stores, loading, reload, setCommission, archiveStore, restoreStore } = useAdminStores();
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

  useEffect(() => {
    setView({
      keyword: searchParams.get('keyword') ?? '',
      status: parseStatusFilter(searchParams.get('status')),
      sort: parseSort(searchParams.get('sort'), searchParams.get('dir')),
    });
  }, [searchParams]);

  const updateView = (patch: Partial<StoreViewState>) => {
    const next = { ...view, ...patch };
    const params = new URLSearchParams(searchParams.toString());
    if (next.keyword.trim()) params.set('keyword', next.keyword);
    else params.delete('keyword');
    if (next.status === DEFAULT_STATUS_FILTER) params.delete('status');
    else params.set('status', next.status);
    if (next.sort.key === DEFAULT_SORT.key) params.delete('sort');
    else params.set('sort', next.sort.key);
    if (next.sort.direction === DEFAULT_SORT.direction) params.delete('dir');
    else params.set('dir', next.sort.direction);

    setView(next);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const resetFilters = () => {
    updateView({ keyword: '', status: DEFAULT_STATUS_FILTER });
  };

  const handleSave = async (storeId: string) => {
    const rate = parseFloat(rateInput);
    if (Number.isNaN(rate) || rate < 0 || rate > 1) {
      notifications.show({
        color: 'orange',
        title: '입력 값을 확인하세요',
        message: '0~1 사이의 수수료율을 입력해야 합니다 (예: 0.05 = 5%).',
      });
      return;
    }
    setSaving(true);
    const ok = await setCommission(storeId, rate);
    setSaving(false);
    if (ok) {
      setEditId(null);
      setRateInput('');
    }
  };

  const handleStartEdit = (store: AdminStore) => {
    setEditId(store.id);
    setRateInput(String(store.commissionRate ?? ''));
  };

  const handleCancelEdit = () => {
    setEditId(null);
    setRateInput('');
  };

  const handleArchive = async (store: AdminStore) => {
    const label = store.name || '(미설정)';
    if (!window.confirm(`${label} 판매자를 정리할까요? 주문·정산 기록은 보존됩니다.`)) return;
    try {
      await archiveStore(store.id);
    } catch (e) {
      // 기록 가드(400) 등 차단 사유를 서버 메시지 그대로 안내
      notifications.show({
        color: 'red',
        title: '정리할 수 없습니다',
        message: e instanceof Error ? e.message : '판매자 정리 중 오류가 발생했습니다.',
      });
    }
  };

  const handleRestore = async (store: AdminStore) => {
    try {
      await restoreStore(store.id);
    } catch (e) {
      notifications.show({
        color: 'red',
        title: '복구할 수 없습니다',
        message: e instanceof Error ? e.message : '판매자 복구 중 오류가 발생했습니다.',
      });
    }
  };

  const filtered = filterStores(stores, { keyword: view.keyword, status: view.status });
  const visible = sortStores(filtered, view.sort);
  const emptyKind = getEmptyKind(stores, visible);

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>
          판매자 목록{' '}
          <Text
            component="span"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            ({visible.length})
          </Text>
        </Title>
      </Group>

      <StoresFilters
        keyword={view.keyword}
        status={view.status}
        sort={view.sort}
        loading={loading}
        onKeywordChange={(keyword) => updateView({ keyword })}
        onStatusChange={(status) => updateView({ status })}
        onSortChange={(sort) => updateView({ sort })}
        onReload={reload}
      />

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
        onResetFilters={resetFilters}
        onSortChange={(sort) => updateView({ sort })}
      />
    </Box>
  );
}
