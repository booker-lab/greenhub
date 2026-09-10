'use client';

import { Box, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AdminStore } from '@/hooks/useAdmin';
import { classifyAdminCommandError, describeAdminCommandOutcome, useAdminStores } from '@/hooks/useAdmin';
import { StoresFilters } from './_components/StoresFilters';
import { StoresTable } from './_components/StoresTable';
import {
  DEFAULT_SORT,
  DEFAULT_STATUS_FILTER,
  filterStores,
  getAdminStoresReadState,
  getEmptyKind,
  parseRate,
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
    const parsed = parseRate(rateInput);
    if (!parsed.ok) {
      notifications.show({
        color: 'orange',
        title: '입력 값을 확인하세요',
        message: '0~1 사이의 수수료율을 입력해야 합니다 (예: 0.05 = 5%).',
      });
      return;
    }
    setSaving(true);
    const outcome = await setCommission(storeId, parsed.rate);
    setSaving(false);
    if (outcome.kind === 'confirmed' && outcome.reconciled) {
      setEditId(null);
      setRateInput('');
      return;
    }
    if (outcome.kind === 'confirmed') {
      // COMMAND CONFIRMED + RECONCILIATION FAILED — 실패로 되돌리지 않고 중복 실행을 유도하지 않는다.
      setEditId(null);
      setRateInput('');
      const presentation = describeAdminCommandOutcome(outcome, '수수료율 변경');
      notifications.show({ color: 'yellow', title: presentation.title, message: presentation.message });
      return;
    }
    // rejected: 서버 reason 보존 + 편집 유지(수정 가능). unknown: 재확인 우선 + 편집 유지.
    const presentation = describeAdminCommandOutcome(outcome, '수수료율 변경');
    notifications.show({
      color: outcome.kind === 'rejected' ? 'red' : 'orange',
      title: presentation.title,
      message: presentation.message,
    });
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
      const reconciliation = await archiveStore(store.id);
      if (!reconciliation.reconciled) {
        // COMMAND CONFIRMED + RECONCILIATION FAILED — 실패로 표현하지 않고 중복 실행을 유도하지 않는다.
        notifications.show({
          color: 'yellow',
          title: '정리 처리는 완료됐으나 목록 확인 실패',
          message: `${reconciliation.readError ?? '목록 조회 실패'} 다시 조회해 최신 상태를 확인해 주세요. 같은 작업을 중복 실행하지 마세요.`,
        });
      }
    } catch (e) {
      const classified = classifyAdminCommandError(e);
      if (classified.kind === 'unknown') {
        const presentation = describeAdminCommandOutcome(classified, '정리');
        notifications.show({ color: 'orange', title: presentation.title, message: presentation.message });
        return;
      }
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
      const reconciliation = await restoreStore(store.id);
      if (!reconciliation.reconciled) {
        notifications.show({
          color: 'yellow',
          title: '복구 처리는 완료됐으나 목록 확인 실패',
          message: `${reconciliation.readError ?? '목록 조회 실패'} 다시 조회해 최신 상태를 확인해 주세요. 같은 작업을 중복 실행하지 마세요.`,
        });
      }
    } catch (e) {
      const classified = classifyAdminCommandError(e);
      if (classified.kind === 'unknown') {
        const presentation = describeAdminCommandOutcome(classified, '복구');
        notifications.show({ color: 'orange', title: presentation.title, message: presentation.message });
        return;
      }
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
  // 조회 실패는 정상 빈 결과로 collapse하지 않는다.
  // useAdminList는 실패 시 이전 stores를 보존하므로 stale 유무와 무관하게 error를 우선한다.
  // filter/query state는 초기화하지 않고 Filters는 항상 유지된다.
  const readState = getAdminStoresReadState({ loading, error, stores, visible });
  const isFetchError = readState === 'FETCH_ERROR';

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>
          판매자 목록{' '}
          {error === null && (
            <Text
              component="span"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              ({visible.length})
            </Text>
          )}
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

      {isFetchError ? (
        <Paper
          radius="lg"
          shadow="xs"
          style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          <Stack gap="sm" align="center" py={64} px="md">
            <Text style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
              판매자 목록을 불러오지 못했습니다.
            </Text>
            <Text
              ta="center"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {error}
            </Text>
            <Button onClick={reload} size="sm" variant="outline" radius="md">
              다시 조회
            </Button>
          </Stack>
        </Paper>
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
          onResetFilters={resetFilters}
          onSortChange={(sort) => updateView({ sort })}
        />
      )}
    </Box>
  );
}
