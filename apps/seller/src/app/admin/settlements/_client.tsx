'use client';

import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useAdminSettlements } from '@/hooks/useAdmin';

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  confirmed: '확정',
  paid: '지급완료',
  cancelled: '취소',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'gray',
  confirmed: 'blue',
  paid: 'green',
  cancelled: 'red',
};

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

  const totalNet = settlements.reduce((sum, s) => sum + s.netAmount, 0);
  const totalFee = settlements.reduce((sum, s) => sum + s.platformFee, 0);

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

      {/* 필터 */}
      <Group gap="sm" mb="md" style={{ flexWrap: 'wrap' }}>
        <TextInput
          placeholder="스토어 ID 필터"
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          style={{ flex: 1, minWidth: 140 }}
          radius="md"
          size="sm"
        />
        <input
          type="date"
          value={fromFilter}
          onChange={(e) => setFromFilter(e.target.value)}
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 'var(--font-size-sm)',
          }}
        />
        <input
          type="date"
          value={toFilter}
          onChange={(e) => setToFilter(e.target.value)}
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 'var(--font-size-sm)',
          }}
        />
      </Group>

      {/* 요약 카드 */}
      {settlements.length > 0 && (
        <SimpleGrid cols={2} mb="md">
          <Paper radius="lg" style={{ border: '1px solid var(--color-border)' }} p="md">
            <Text
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              mb={4}
            >
              플랫폼 수수료 합계
            </Text>
            <Text style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--fw-bold)' }}>
              ₩{totalFee.toLocaleString()}
            </Text>
          </Paper>
          <Paper radius="lg" style={{ border: '1px solid var(--color-border)' }} p="md">
            <Text
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              mb={4}
            >
              판매자 지급 합계
            </Text>
            <Text
              style={{
                fontSize: 'var(--font-size-lg)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-primary)',
              }}
            >
              ₩{totalNet.toLocaleString()}
            </Text>
          </Paper>
        </SimpleGrid>
      )}

      {loading ? (
        <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
          불러오는 중...
        </Text>
      ) : (
        <Paper
          radius="lg"
          shadow="xs"
          style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          {settlements.length === 0 ? (
            <Text ta="center" py={64} style={{ color: 'var(--color-text-disabled)' }}>
              정산 내역이 없습니다.
            </Text>
          ) : (
            <Box
              component="table"
              style={{ width: '100%', fontSize: 'var(--font-size-sm)', borderCollapse: 'collapse' }}
            >
              <Box
                component="thead"
                style={{
                  backgroundColor: 'var(--color-surface-muted)',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <tr>
                  <Box
                    component="th"
                    style={{
                      textAlign: 'left',
                      padding: '12px 16px',
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    스토어
                  </Box>
                  <Box
                    component="th"
                    style={{
                      textAlign: 'right',
                      padding: '12px 16px',
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    거래금액
                  </Box>
                  <Box
                    component="th"
                    style={{
                      textAlign: 'right',
                      padding: '12px 16px',
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    수수료
                  </Box>
                  <Box
                    component="th"
                    style={{
                      textAlign: 'right',
                      padding: '12px 16px',
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    지급액
                  </Box>
                  <Box
                    component="th"
                    style={{
                      textAlign: 'left',
                      padding: '12px 16px',
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    상태
                  </Box>
                  <Box component="th" style={{ padding: '12px 16px' }} />
                </tr>
              </Box>
              <Box component="tbody">
                {settlements.map((s) => (
                  <Box
                    component="tr"
                    key={s.id}
                    style={{ borderTop: '1px solid var(--color-border)' }}
                  >
                    <Box component="td" style={{ padding: '12px 16px' }}>
                      <Text
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text-disabled)',
                        }}
                        ff="monospace"
                      >
                        {s.storeId.slice(0, 8)}…
                      </Text>
                    </Box>
                    <Box
                      component="td"
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      ₩{s.totalAmount.toLocaleString()}
                    </Box>
                    <Box
                      component="td"
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        color: 'var(--color-danger)',
                      }}
                    >
                      ₩{s.platformFee.toLocaleString()}
                    </Box>
                    <Box
                      component="td"
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        fontWeight: 500,
                        color: 'var(--color-primary)',
                      }}
                    >
                      ₩{s.netAmount.toLocaleString()}
                    </Box>
                    <Box component="td" style={{ padding: '12px 16px' }}>
                      <Badge color={STATUS_COLOR[s.status] ?? 'gray'} variant="light" radius="xl">
                        {STATUS_LABEL[s.status] ?? s.status}
                      </Badge>
                    </Box>
                    <Box component="td" style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {s.status === 'confirmed' && (
                        <Button
                          onClick={() => setPayTargetId(s.id)}
                          disabled={processingId === s.id}
                          size="xs"
                          variant="outline"
                          color="blue"
                          radius="md"
                        >
                          {processingId === s.id ? '처리중…' : '지급처리'}
                        </Button>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Paper>
      )}

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
