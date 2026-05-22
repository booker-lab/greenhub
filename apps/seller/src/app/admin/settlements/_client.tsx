'use client';

import { Box, Group, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useAdminSettlements } from '@/hooks/useAdmin';
import { SettlementFilters } from './_components/SettlementFilters';
import { SettlementTable } from './_components/SettlementTable';
import { SummaryCards } from './_components/SummaryCards';
import { sumPayable } from './_lib';

export default function AdminSettlementsClient() {
  const [storeFilter, setStoreFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const { settlements, loading, markAsPaid } = useAdminSettlements({
    storeId: storeFilter || undefined,
    from: fromFilter || undefined,
    to: toFilter || undefined,
  });
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [payTargetId, setPayTargetId] = useState<string | null>(null);

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

  // N11: 합계는 confirmed + paid 한정(실제 지급 대상). pending·cancelled 제외.
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
      </Group>

      <SettlementFilters
        storeFilter={storeFilter}
        fromFilter={fromFilter}
        toFilter={toFilter}
        onStoreChange={setStoreFilter}
        onFromChange={setFromFilter}
        onToChange={setToFilter}
      />

      {settlements.length > 0 && <SummaryCards totalFee={totalFee} totalNet={totalNet} />}

      <SettlementTable
        settlements={settlements}
        loading={loading}
        processingId={processingId}
        onPay={setPayTargetId}
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
    </Box>
  );
}
