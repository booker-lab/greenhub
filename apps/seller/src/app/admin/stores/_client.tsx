'use client';

import { Box, Group, Switch, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import type { AdminStore } from '@/hooks/useAdmin';
import { useAdminStores } from '@/hooks/useAdmin';
import { StoresTable } from './_components/StoresTable';
import { filterVisible } from './_lib';

export default function AdminStoresClient() {
  const { stores, loading, setCommission, archiveStore, restoreStore } = useAdminStores();
  const [editId, setEditId] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

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

  if (loading) {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  const visible = filterVisible(stores, showArchived);

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
        <Switch
          size="sm"
          label="정리된 판매자 보기"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.currentTarget.checked)}
        />
      </Group>

      <StoresTable
        stores={visible}
        editId={editId}
        rateInput={rateInput}
        saving={saving}
        onRateInput={setRateInput}
        onStartEdit={handleStartEdit}
        onCancelEdit={handleCancelEdit}
        onSave={handleSave}
        onArchive={handleArchive}
        onRestore={handleRestore}
      />
    </Box>
  );
}
