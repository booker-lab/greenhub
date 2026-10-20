'use client';

import { Box, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useAdminSettlements } from '@/hooks/useAdmin';
import { describeAdminCommandOutcome } from '@/hooks/useAdmin';
import { SettlementFilters } from './_components/SettlementFilters';
import { SettlementTable } from './_components/SettlementTable';
import { SummaryCards } from './_components/SummaryCards';
import { sumPayable } from './_lib';

/** 스토어 ID 입력이 멈춘 뒤 조회하기까지 기다리는 시간. 글자마다 재조회하지 않는다. */
const STORE_FILTER_DEBOUNCE_MS = 300;

export default function AdminSettlementsClient() {
  const [storeFilter, setStoreFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  // 입력창은 storeFilter를 바로 보여 주고, 조회는 입력이 멈춘 뒤의 값으로만 한다.
  const [debouncedStoreFilter] = useDebouncedValue(storeFilter, STORE_FILTER_DEBOUNCE_MS);
  const { settlements, loading, error, reload, markAsPaid } = useAdminSettlements({
    storeId: debouncedStoreFilter || undefined,
    from: fromFilter || undefined,
    to: toFilter || undefined,
  });
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [payTargetId, setPayTargetId] = useState<string | null>(null);

  const runPay = async () => {
    if (!payTargetId) return;
    setProcessingId(payTargetId);
    try {
      const outcome = await markAsPaid(payTargetId);
      setPayTargetId(null);
      if (outcome.kind === 'confirmed' && outcome.reconciled) return;
      // stale은 완료+재조회 copy를 사용한다. rejected는 서버 reason 보존, unknown은 재확인 우선.
      const presentation = describeAdminCommandOutcome(outcome, '지급');
      notifications.show({
        color: outcome.kind === 'rejected' ? 'red' : 'yellow',
        title: presentation.title,
        message: presentation.message,
      });
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
          {!loading && error === null && (
            <Text
              component="span"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              ({settlements.length})
            </Text>
          )}
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

      {error !== null && !loading ? (
        <Paper
          radius="lg"
          shadow="xs"
          style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          <Stack gap="sm" align="center" py={64} px="md">
            <Text style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
              정산 목록을 불러오지 못했습니다.
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
        <>
          {settlements.length > 0 && <SummaryCards totalFee={totalFee} totalNet={totalNet} />}

          <SettlementTable
            settlements={settlements}
            loading={loading}
            processingId={processingId}
            onPay={setPayTargetId}
          />
        </>
      )}

      <ConfirmModal
        opened={payTargetId !== null}
        title="정산 지급 처리"
        message="이 정산을 지급 완료 처리하시겠습니까?"
        confirmLabel="지급 완료"
        confirmColor="brand"
        loading={processingId !== null}
        onConfirm={runPay}
        onClose={() => {
          if (processingId === null) setPayTargetId(null);
        }}
      />
    </Box>
  );
}
