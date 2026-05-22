'use client';

import { Badge, Box, Button, Paper, Text } from '@mantine/core';
// 정산 라벨/색 SSOT = @greenhub/shared (F-1/S4).
import { STATUS_COLOR, STATUS_LABEL } from '@greenhub/shared';
import type { AdminSettlement } from '@/hooks/useAdmin';
import { toDateStr } from '../_lib';

interface SettlementTableProps {
  settlements: AdminSettlement[];
  loading: boolean;
  processingId: string | null;
  onPay: (id: string) => void;
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
  onPay,
}: SettlementTableProps) {
  if (loading) {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  return (
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
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                스토어
              </Box>
              {/* N10: 정산일시 컬럼 추가(셀러 화면과 동형) */}
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
            {settlements.map((s) => (
              <Box component="tr" key={s.id} style={{ borderTop: '1px solid var(--color-border)' }}>
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
                  style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}
                >
                  {toDateStr(s.settledAt)}
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
                  style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--color-danger)' }}
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
                      onClick={() => onPay(s.id)}
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
  );
}
