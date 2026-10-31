'use client';

import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
// 정산 라벨/색 SSOT = @greenhub/shared (F-1/S4).
import { STATUS_COLOR, STATUS_LABEL } from '@greenhub/shared';
import type { AdminSettlement } from '@/hooks/useAdmin';
import { canPay, HOLD_REASON_LABEL, orderLabel, storeLabel, toDateStr, toKRW } from '../_lib';

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
const tdBase = { padding: '12px 16px' };
const muted = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' };

/** 상태 배지 + 회수 필요·지급 보류 배지 — 테이블·카드 공용. */
function StatusBadges({ s }: { s: AdminSettlement }) {
  return (
    <Group gap={4} wrap="wrap">
      <Badge color={STATUS_COLOR[s.status] ?? 'gray'} variant="light" radius="xl">
        {STATUS_LABEL[s.status] ?? s.status}
      </Badge>
      {s.recoveryRequired && (
        <Badge color="red" variant="filled" radius="xl">
          회수 필요 {toKRW(s.recoveryAmount ?? s.netAmount)}
        </Badge>
      )}
      {s.holdReason && (
        <Badge color="orange" variant="light" radius="xl">
          {HOLD_REASON_LABEL[s.holdReason] ?? s.holdReason}
        </Badge>
      )}
    </Group>
  );
}

/** 지급처리 버튼 — 확정(confirmed)만. 보류 사유가 있거나 정산 계좌가 없으면 서버가 거절하므로 누르지 못하게 둔다. */
function PayButton({
  s,
  processingId,
  onPay,
}: {
  s: AdminSettlement;
  processingId: string | null;
  onPay: (id: string) => void;
}) {
  if (s.status !== 'confirmed') return null;
  return (
    <Button
      onClick={() => onPay(s.id)}
      disabled={processingId === s.id || !canPay(s)}
      size="xs"
      variant="outline"
      radius="md"
    >
      {processingId === s.id ? '처리중…' : s.payoutAccount ? '지급처리' : '계좌 미등록'}
    </Button>
  );
}

export function SettlementTable({
  settlements,
  loading,
  processingId,
  onPay,
}: SettlementTableProps) {
  if (loading && settlements.length === 0) {
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
      {/* 모바일(<sm): 카드 리스트 — 마지막 컬럼(상태·지급처리) 잘림 방지 */}
      <Stack gap="sm" hiddenFrom="sm">
        {settlements.map((s) => (
          <Paper
            key={s.id}
            radius="md"
            px="md"
            py="sm"
            shadow="xs"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <Group justify="space-between" mb="xs" align="flex-start" wrap="nowrap">
              <Box>
                <Text style={{ fontWeight: 500 }}>{storeLabel(s)}</Text>
                <Text style={{ ...muted, color: 'var(--color-text-disabled)' }} ff="monospace">
                  {orderLabel(s)}
                </Text>
              </Box>
              <StatusBadges s={s} />
            </Group>
            <Text style={muted} mb={4}>
              {toDateStr(s.settledAt)}
            </Text>
            <Group justify="space-between" gap="xs">
              <Text style={muted}>거래 {toKRW(s.totalAmount)}</Text>
              <Text style={muted}>수수료 {toKRW(s.platformFee)}</Text>
            </Group>
            <Group justify="space-between" align="center" mt="xs">
              <Text style={{ fontWeight: 500, color: 'var(--color-primary-dark)' }}>
                지급액 {toKRW(s.netAmount)}
              </Text>
              <PayButton s={s} processingId={processingId} onPay={onPay} />
            </Group>
          </Paper>
        ))}
      </Stack>

      {/* 데스크톱(≥sm): 테이블 */}
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
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                가게
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                주문번호
              </Box>
              {/* N10: 정산일시 컬럼(셀러 화면과 동형) */}
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
              <Box component="th" style={tdBase} />
            </tr>
          </Box>
          <Box component="tbody">
            {settlements.map((s) => (
              <Box component="tr" key={s.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <Box component="td" style={tdBase}>
                  {storeLabel(s)}
                </Box>
                <Box component="td" style={{ ...tdBase, color: 'var(--color-text-secondary)' }}>
                  <Text ff="monospace" style={{ fontSize: 'var(--font-size-sm)' }}>
                    {orderLabel(s)}
                  </Text>
                </Box>
                <Box component="td" style={{ ...tdBase, color: 'var(--color-text-secondary)' }}>
                  {toDateStr(s.settledAt)}
                </Box>
                <Box
                  component="td"
                  style={{ ...tdBase, textAlign: 'right', color: 'var(--color-text-secondary)' }}
                >
                  {toKRW(s.totalAmount)}
                </Box>
                <Box
                  component="td"
                  style={{ ...tdBase, textAlign: 'right', color: 'var(--color-text-secondary)' }}
                >
                  {toKRW(s.platformFee)}
                </Box>
                <Box
                  component="td"
                  style={{
                    ...tdBase,
                    textAlign: 'right',
                    fontWeight: 500,
                    color: 'var(--color-primary-dark)',
                  }}
                >
                  {toKRW(s.netAmount)}
                </Box>
                <Box component="td" style={tdBase}>
                  <StatusBadges s={s} />
                </Box>
                <Box component="td" style={{ ...tdBase, textAlign: 'right' }}>
                  <PayButton s={s} processingId={processingId} onPay={onPay} />
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Paper>
    </>
  );
}
