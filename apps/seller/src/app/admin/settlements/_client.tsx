'use client';

import { ActionIcon, Alert, Box, Button, Group, Paper, Text, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { RotateCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useAdminSettlements } from '@/hooks/useAdmin';
import { SettlementFilters } from './_components/SettlementFilters';
import { SettlementTable } from './_components/SettlementTable';
import { SummaryCards } from './_components/SummaryCards';
import type { SettlementFilterKey } from './_constants';
import { sumPayable } from './_lib';

export default function AdminSettlementsClient() {
  const [storeFilter, setStoreFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<SettlementFilterKey>('all');
  const { settlements, loading, error, reload, markAsPaid, bulkMarkAsPaid } = useAdminSettlements({
    storeId: storeFilter || undefined,
    from: fromFilter || undefined,
    to: toFilter || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
  });
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [payTargetId, setPayTargetId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkPayOpen, setBulkPayOpen] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const payableSettlements = useMemo(
    () => settlements.filter((settlement) => settlement.status === 'confirmed'),
    [settlements],
  );
  const selectableIds = useMemo(
    () => payableSettlements.map((settlement) => settlement.id),
    [payableSettlements],
  );
  const selectedSettlements = useMemo(
    () => payableSettlements.filter((settlement) => selectedIds.includes(settlement.id)),
    [payableSettlements, selectedIds],
  );
  const selectedTotalNet = selectedSettlements.reduce(
    (sum, settlement) => sum + settlement.netAmount,
    0,
  );
  const selectedAmountText = `${selectedTotalNet.toLocaleString('ko-KR')}원`;

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => selectableIds.includes(id)));
  }, [selectableIds]);

  const runPay = async () => {
    if (!payTargetId) return;
    setProcessingId(payTargetId);
    try {
      const ok = await markAsPaid(payTargetId);
      setPayTargetId(null);
      if (!ok) {
        notifications.show({
          color: 'red',
          title: '지급 처리 실패',
          message: '정산 지급 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        });
      }
    } finally {
      setProcessingId(null);
    }
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((selectedId) => selectedId !== id),
    );
  };

  const toggleAllSelected = (checked: boolean) => {
    setSelectedIds(checked ? selectableIds : []);
  };

  const clearSelected = () => setSelectedIds([]);

  const runBulkPay = async () => {
    if (selectedIds.length === 0) return;
    setBulkProcessing(true);
    try {
      const result = await bulkMarkAsPaid(selectedIds);
      if (!result) {
        notifications.show({
          color: 'red',
          title: '일괄 지급 처리 실패',
          message: '정산 일괄 지급 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        });
        return;
      }

      setBulkPayOpen(false);
      setSelectedIds((current) =>
        current.filter((id) => result.failed.some((item) => item.id === id)),
      );

      if (result.failed.length === 0) {
        notifications.show({
          color: 'green',
          title: '일괄 지급 처리 완료',
          message: `${result.ok.length}건의 정산을 지급 완료로 변경했습니다.`,
        });
        return;
      }

      notifications.show({
        color: result.ok.length > 0 ? 'yellow' : 'red',
        title: result.ok.length > 0 ? '일괄 지급 부분 완료' : '일괄 지급 처리 실패',
        message: `성공 ${result.ok.length}건, 실패 ${result.failed.length}건: ${result.failed
          .slice(0, 3)
          .map((item) => item.reason)
          .join(' / ')}`,
      });
    } finally {
      setBulkProcessing(false);
    }
  };

  const { totalFee, totalNet } = sumPayable(settlements);

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>
          정산 목록{' '}
          <Text
            component="span"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            ({settlements.length})
          </Text>
        </Title>
        <Tooltip label="새로고침">
          <ActionIcon
            aria-label="정산 목록 새로고침"
            color="gray"
            loading={loading}
            onClick={reload}
            radius="md"
            variant="subtle"
          >
            <RotateCw size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <SettlementFilters
        storeFilter={storeFilter}
        fromFilter={fromFilter}
        toFilter={toFilter}
        statusFilter={statusFilter}
        onStoreChange={setStoreFilter}
        onFromChange={setFromFilter}
        onToChange={setToFilter}
        onStatusChange={setStatusFilter}
      />

      {error && (
        <Alert color="red" mb="md" radius="md" title="정산 목록을 불러오지 못했습니다">
          {error}
        </Alert>
      )}

      {settlements.length > 0 && <SummaryCards totalFee={totalFee} totalNet={totalNet} />}

      {selectedIds.length > 0 && (
        <Paper
          radius="md"
          px="md"
          py="sm"
          mb="md"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <Group justify="space-between" gap="sm">
            <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              선택 {selectedIds.length}건 · 지급 합계 {selectedAmountText}
            </Text>
            <Group gap="xs">
              <Button size="xs" variant="subtle" color="gray" onClick={clearSelected}>
                선택 해제
              </Button>
              <Button
                size="xs"
                color="blue"
                loading={bulkProcessing}
                disabled={bulkProcessing}
                onClick={() => setBulkPayOpen(true)}
              >
                일괄 지급
              </Button>
            </Group>
          </Group>
        </Paper>
      )}

      <SettlementTable
        settlements={settlements}
        loading={loading}
        processingId={processingId}
        selectedIds={selectedIds}
        selectableIds={selectableIds}
        bulkProcessing={bulkProcessing}
        onPay={setPayTargetId}
        onToggleSelected={toggleSelected}
        onToggleAllSelected={toggleAllSelected}
      />

      <ConfirmModal
        opened={payTargetId !== null}
        title="정산 지급 처리"
        message="이 정산을 지급 완료 처리하시겠습니까?"
        confirmLabel="지급 완료"
        confirmColor="blue"
        loading={processingId !== null}
        onConfirm={runPay}
        onClose={() => {
          if (processingId === null) setPayTargetId(null);
        }}
      />

      <ConfirmModal
        opened={bulkPayOpen}
        title="정산 일괄 지급 처리"
        message={`선택한 ${selectedIds.length}건을 지급 완료 처리할까요? 지급 합계는 ${selectedAmountText}입니다.`}
        confirmLabel="일괄 지급"
        confirmColor="blue"
        loading={bulkProcessing}
        onConfirm={runBulkPay}
        onClose={() => {
          if (!bulkProcessing) setBulkPayOpen(false);
        }}
      />
    </Box>
  );
}
