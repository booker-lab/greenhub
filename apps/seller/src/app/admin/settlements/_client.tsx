'use client';

import { Box, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { type AdminSettlement, useAdminSettlements } from '@/hooks/useAdmin';
import { describeAdminCommandOutcome } from '@/hooks/useAdmin';
import { SettlementFilters } from './_components/SettlementFilters';
import { SettlementTable } from './_components/SettlementTable';
import { SummaryCards } from './_components/SummaryCards';
import {
  describePayConfirm,
  describeRecoveryConfirm,
  sumPayable,
  sumRecoveryPending,
  toKRW,
} from './_lib';

/** 스토어 ID 입력이 멈춘 뒤 조회하기까지 기다리는 시간. 글자마다 재조회하지 않는다. */
const STORE_FILTER_DEBOUNCE_MS = 300;

export default function AdminSettlementsClient() {
  const [storeFilter, setStoreFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  // 입력창은 storeFilter를 바로 보여 주고, 조회는 입력이 멈춘 뒤의 값으로만 한다.
  const [debouncedStoreFilter] = useDebouncedValue(storeFilter, STORE_FILTER_DEBOUNCE_MS);
  const settlementsQuery = useAdminSettlements({
    storeId: debouncedStoreFilter || undefined,
    from: fromFilter || undefined,
    to: toFilter || undefined,
  });
  const { settlements, loading, error, reload, markAsPaid, completeRecovery } = settlementsQuery;
  const [processingId, setProcessingId] = useState<string | null>(null);
  // 확인창이 대상(가게·주문·지급액)을 보이도록 id가 아닌 정산 문서를 잡아 둔다.
  const [payTarget, setPayTarget] = useState<AdminSettlement | null>(null);
  const [recoveryTarget, setRecoveryTarget] = useState<AdminSettlement | null>(null);

  const openPay = (settlementId: string) =>
    setPayTarget(settlements.find((s) => s.id === settlementId) ?? null);

  const runPay = async () => {
    if (!payTarget) return;
    setProcessingId(payTarget.id);
    try {
      const outcome = await markAsPaid(payTarget.id);
      setPayTarget(null);
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

  const openRecovery = (settlementId: string) =>
    setRecoveryTarget(settlements.find((s) => s.id === settlementId) ?? null);

  const runRecovery = async () => {
    if (!recoveryTarget) return;
    setProcessingId(recoveryTarget.id);
    try {
      const outcome = await completeRecovery(recoveryTarget.id);
      setRecoveryTarget(null);
      if (outcome.kind === 'confirmed' && outcome.reconciled) return;
      const presentation = describeAdminCommandOutcome(outcome, '회수 완료');
      notifications.show({
        color: outcome.kind === 'rejected' ? 'red' : 'yellow',
        title: presentation.title,
        message: presentation.message,
      });
    } finally {
      setProcessingId(null);
    }
  };

  const recoveryPending = sumRecoveryPending(settlements);

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
          {recoveryPending.count > 0 && (
            <Text mb="md" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
              판매자에게서 돌려받을 돈 {recoveryPending.count}건 · {toKRW(recoveryPending.amount)} —
              계좌로 받은 뒤 &quot;회수 완료&quot;를 눌러 주세요.
            </Text>
          )}

          <SettlementTable
            settlements={settlements}
            loading={loading}
            processingId={processingId}
            onPay={openPay}
            onCompleteRecovery={openRecovery}
          />
        </>
      )}

      <ConfirmModal
        opened={payTarget !== null}
        title="정산 지급 처리"
        message={payTarget ? describePayConfirm(payTarget) : ''}
        confirmLabel="지급 완료"
        confirmColor="brand"
        loading={processingId !== null}
        onConfirm={runPay}
        onClose={() => {
          if (processingId === null) setPayTarget(null);
        }}
      />

      <ConfirmModal
        opened={recoveryTarget !== null}
        title="정산 회수 완료"
        message={recoveryTarget ? describeRecoveryConfirm(recoveryTarget) : ''}
        confirmLabel="회수 완료"
        confirmColor="red"
        loading={processingId !== null}
        onConfirm={runRecovery}
        onClose={() => {
          if (processingId === null) setRecoveryTarget(null);
        }}
      />
    </Box>
  );
}
