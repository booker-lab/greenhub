'use client';

import { STATUS_COLOR, STATUS_LABEL } from '@greenhub/shared';
import { Badge, Box, Button, Checkbox, Group, Paper, Stack, Text } from '@mantine/core';
import type { AdminSettlement } from '@/hooks/useAdmin';
import { toDateStr } from '../_lib';

interface SettlementTableProps {
  settlements: AdminSettlement[];
  loading: boolean;
  processingId: string | null;
  selectedIds: string[];
  selectableIds: string[];
  bulkProcessing: boolean;
  onPay: (id: string) => void;
  onToggleSelected: (id: string, checked: boolean) => void;
  onToggleAllSelected: (checked: boolean) => void;
}

const thBase = {
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

export function SettlementTable({
  settlements,
  loading,
  processingId,
  selectedIds,
  selectableIds,
  bulkProcessing,
  onPay,
  onToggleSelected,
  onToggleAllSelected,
}: SettlementTableProps) {
  const selectableCount = selectableIds.length;
  const selectedCount = selectedIds.length;
  const allSelected = selectableCount > 0 && selectedCount === selectableCount;
  const someSelected = selectedCount > 0 && selectedCount < selectableCount;

  if (loading) {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  if (settlements.length === 0) {
    return (
      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <Text ta="center" py={64} style={{ color: 'var(--color-text-disabled)' }}>
          정산 내역이 없습니다.
        </Text>
      </Paper>
    );
  }

  return (
    <>
      <Stack gap="sm" hiddenFrom="sm">
        {settlements.map((settlement) => {
          const selectable = settlement.status === 'confirmed';
          const checked = selectedIds.includes(settlement.id);

          return (
            <Paper
              key={settlement.id}
              radius="md"
              px="md"
              py="sm"
              shadow="xs"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <Group justify="space-between" align="flex-start" mb="xs" gap="xs">
                <Group gap="xs" align="flex-start">
                  <Checkbox
                    aria-label={`${settlement.storeId.slice(0, 8)} 정산 선택`}
                    checked={checked}
                    disabled={!selectable || bulkProcessing}
                    onChange={(event) =>
                      onToggleSelected(settlement.id, event.currentTarget.checked)
                    }
                  />
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-disabled)',
                    }}
                    ff="monospace"
                  >
                    {settlement.storeId.slice(0, 8)}...
                  </Text>
                </Group>
                <Badge
                  color={STATUS_COLOR[settlement.status] ?? 'gray'}
                  variant="light"
                  radius="xl"
                >
                  {STATUS_LABEL[settlement.status] ?? settlement.status}
                </Badge>
              </Group>
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                mb={4}
              >
                {toDateStr(settlement.settledAt)}
              </Text>
              <Group justify="space-between" gap="xs">
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  거래 {settlement.totalAmount.toLocaleString()}원
                </Text>
                <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
                  수수료 {settlement.platformFee.toLocaleString()}원
                </Text>
              </Group>
              <Group justify="space-between" align="center" mt="xs">
                <Text style={{ fontWeight: 500, color: 'var(--color-primary)' }}>
                  지급액 {settlement.netAmount.toLocaleString()}원
                </Text>
                {settlement.status === 'confirmed' && (
                  <Button
                    onClick={() => onPay(settlement.id)}
                    disabled={processingId === settlement.id || bulkProcessing}
                    size="xs"
                    variant="outline"
                    color="blue"
                    radius="md"
                  >
                    {processingId === settlement.id ? '처리중...' : '지급처리'}
                  </Button>
                )}
              </Group>
            </Paper>
          );
        })}
      </Stack>

      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        visibleFrom="sm"
      >
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
              <Box component="th" style={{ padding: '12px 16px', width: 52 }}>
                <Checkbox
                  aria-label="지급 가능한 정산 전체 선택"
                  checked={allSelected}
                  indeterminate={someSelected}
                  disabled={selectableCount === 0 || bulkProcessing}
                  onChange={(event) => onToggleAllSelected(event.currentTarget.checked)}
                />
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                스토어
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                정산일시
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'right' }}>
                거래금액
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'right' }}>
                수수료
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'right' }}>
                지급액
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                상태
              </Box>
              <Box component="th" style={{ padding: '12px 16px' }} />
            </tr>
          </Box>
          <Box component="tbody">
            {settlements.map((settlement) => {
              const selectable = settlement.status === 'confirmed';
              const checked = selectedIds.includes(settlement.id);

              return (
                <Box
                  component="tr"
                  key={settlement.id}
                  style={{ borderTop: '1px solid var(--color-border)' }}
                >
                  <Box component="td" style={{ padding: '12px 16px' }}>
                    <Checkbox
                      aria-label={`${settlement.storeId.slice(0, 8)} 정산 선택`}
                      checked={checked}
                      disabled={!selectable || bulkProcessing}
                      onChange={(event) =>
                        onToggleSelected(settlement.id, event.currentTarget.checked)
                      }
                    />
                  </Box>
                  <Box component="td" style={{ padding: '12px 16px' }}>
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-disabled)',
                      }}
                      ff="monospace"
                    >
                      {settlement.storeId.slice(0, 8)}...
                    </Text>
                  </Box>
                  <Box
                    component="td"
                    style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}
                  >
                    {toDateStr(settlement.settledAt)}
                  </Box>
                  <Box
                    component="td"
                    style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {settlement.totalAmount.toLocaleString()}원
                  </Box>
                  <Box
                    component="td"
                    style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      color: 'var(--color-danger)',
                    }}
                  >
                    {settlement.platformFee.toLocaleString()}원
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
                    {settlement.netAmount.toLocaleString()}원
                  </Box>
                  <Box component="td" style={{ padding: '12px 16px' }}>
                    <Badge
                      color={STATUS_COLOR[settlement.status] ?? 'gray'}
                      variant="light"
                      radius="xl"
                    >
                      {STATUS_LABEL[settlement.status] ?? settlement.status}
                    </Badge>
                  </Box>
                  <Box component="td" style={{ padding: '12px 16px', textAlign: 'right' }}>
                    {settlement.status === 'confirmed' && (
                      <Button
                        onClick={() => onPay(settlement.id)}
                        disabled={processingId === settlement.id || bulkProcessing}
                        size="xs"
                        variant="outline"
                        color="blue"
                        radius="md"
                      >
                        {processingId === settlement.id ? '처리중...' : '지급처리'}
                      </Button>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      </Paper>
    </>
  );
}
