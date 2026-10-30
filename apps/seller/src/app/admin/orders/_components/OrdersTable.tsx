'use client';

import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import type { AdminOrder } from '@/hooks/useAdmin';
import {
  cancellationBadge,
  formatOrderedAt,
  getAdminOrdersReadState,
  getStatusColor,
  isPostDeliveryRefundable,
  isRefundable,
  STATUS_LABEL,
  storeLabel,
} from '../_lib';

interface OrdersTableProps {
  orders: AdminOrder[];
  loading: boolean;
  /** useAdminOrders 조회 실패 메시지. null이면 마지막 조회가 실패하지 않았음. */
  error: string | null;
  /** 강제환불 처리 중인 주문 id 묶음 — 여러 건을 이어서 처리해도 각자 잠긴다. */
  processingIds: ReadonlySet<string>;
  /** 확인창을 띄울 대상 주문을 넘긴다(주문번호·금액 표시용). */
  onRefund: (order: AdminOrder) => void;
  /** 배송 완료 회차 주문의 배송 후 환불 확인창을 띄운다. 없으면 버튼을 숨긴다. */
  onPostDeliveryRefund?: (order: AdminOrder) => void;
  /** 조회 실패 시 재시도 — hook의 reload()에 연결된다. */
  onRetry: () => void;
}

// 요청사항은 표 폭을 넓히지 않도록 주문번호 아래 작은 글씨로 최대 3줄만 보여준다.
export function RequestNote({ note }: { note?: string | null }) {
  const text = note?.trim();
  if (!text) return null;
  return (
    <Text
      lineClamp={3}
      title={text}
      style={{
        fontSize: 'var(--font-size-xs)',
        color: 'var(--color-text-secondary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxWidth: 240,
      }}
    >
      요청: {text}
    </Text>
  );
}

const metaText = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-secondary)',
};

// 상태 배지 + 취소 진행 배지(환불 진행 중·실패) — 표·카드 공용.
export function StatusBadges({ order }: { order: AdminOrder }) {
  const cancel = cancellationBadge(order.cancellationStatus);
  return (
    <Group gap={4} wrap="wrap">
      <Badge color={getStatusColor(order.status)} variant="light" radius="xl">
        {STATUS_LABEL[order.status] ?? order.status}
      </Badge>
      {cancel && (
        <Badge color={cancel.color} variant="outline" radius="xl">
          {cancel.label}
        </Badge>
      )}
    </Group>
  );
}

// 고객 이름 · 상품 요약 — 표·카드 공용. 고객 전화·주소는 목록에 싣지 않는다.
export function BuyerAndProduct({ order }: { order: AdminOrder }) {
  return (
    <Text style={metaText}>
      {order.buyerName?.trim() || '—'} · {order.productSummary?.trim() || '—'}
    </Text>
  );
}

const thBase = {
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

export function OrdersTable({
  orders,
  loading,
  error,
  processingIds,
  onRefund,
  onPostDeliveryRefund,
  onRetry,
}: OrdersTableProps) {
  const readState = getAdminOrdersReadState({ loading, error, orders });

  if (readState === 'LOADING') {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  // 조회 실패는 성공-empty와 구조적으로 구분 — "주문이 없습니다."로 collapse 금지.
  if (readState === 'FETCH_ERROR') {
    return (
      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <Stack gap="sm" align="center" py={64} px="md">
          <Text style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
            주문 목록을 불러오지 못했습니다.
          </Text>
          <Text
            ta="center"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {error}
          </Text>
          <Button onClick={onRetry} size="sm" variant="outline" radius="md">
            다시 조회
          </Button>
        </Stack>
      </Paper>
    );
  }

  if (readState === 'EMPTY') {
    return (
      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <Text ta="center" py={64} style={{ color: 'var(--color-text-disabled)' }}>
          주문이 없습니다.
        </Text>
      </Paper>
    );
  }

  return (
    <>
      {/* 모바일(<sm): 카드 리스트 — 마지막 컬럼(금액·강제환불) 잘림 방지 */}
      <Stack gap="sm" hiddenFrom="sm" role="list" aria-label="주문 목록">
        {orders.map((order) => (
          <Paper
            role="listitem"
            key={order.id}
            radius="md"
            px="md"
            py="sm"
            shadow="xs"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <Group justify="space-between" mb="xs">
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-disabled)',
                }}
                ff="monospace"
              >
                {order.orderNumber ?? `${order.id.slice(0, 12)}…`}
              </Text>
              <StatusBadges order={order} />
            </Group>
            <Text style={metaText} mb={2}>
              {formatOrderedAt(order.createdAt)} · {storeLabel(order)}
            </Text>
            <BuyerAndProduct order={order} />
            <RequestNote note={order.requestNote} />
            <Group justify="space-between" align="center" mt="xs">
              <Text style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                ₩{order.totalAmount.toLocaleString()}
              </Text>
              {isRefundable(order) && (
                <Button
                  onClick={() => onRefund(order)}
                  disabled={processingIds.has(order.id)}
                  size="xs"
                  variant="outline"
                  color="red"
                  radius="md"
                >
                  {processingIds.has(order.id) ? '처리중…' : '강제환불'}
                </Button>
              )}
              {onPostDeliveryRefund && isPostDeliveryRefundable(order) && (
                <Button
                  onClick={() => onPostDeliveryRefund(order)}
                  disabled={processingIds.has(order.id)}
                  size="xs"
                  variant="outline"
                  color="red"
                  radius="md"
                >
                  {processingIds.has(order.id) ? '처리중…' : '배송 후 환불'}
                </Button>
              )}
            </Group>
          </Paper>
        ))}
      </Stack>

      {/* 데스크톱(≥sm): 기존 테이블 유지(시각 회귀 0) */}
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
                주문일시
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                주문번호
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                고객 · 상품
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                가게
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                상태
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'right' }}>
                금액
              </Box>
              <Box component="th" style={{ padding: '12px 16px' }} />
            </tr>
          </Box>
          <Box component="tbody">
            {orders.map((order) => (
              <Box
                component="tr"
                key={order.id}
                style={{ borderTop: '1px solid var(--color-border)' }}
              >
                <Box component="td" style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                  <Text style={metaText}>{formatOrderedAt(order.createdAt)}</Text>
                </Box>
                <Box component="td" style={{ padding: '12px 16px' }}>
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-disabled)',
                    }}
                    ff="monospace"
                  >
                    {order.orderNumber ?? `${order.id.slice(0, 12)}…`}
                  </Text>
                  <RequestNote note={order.requestNote} />
                </Box>
                <Box component="td" style={{ padding: '12px 16px' }}>
                  <BuyerAndProduct order={order} />
                </Box>
                <Box component="td" style={{ padding: '12px 16px' }}>
                  <Text style={metaText}>{storeLabel(order)}</Text>
                </Box>
                <Box component="td" style={{ padding: '12px 16px' }}>
                  <StatusBadges order={order} />
                </Box>
                <Box
                  component="td"
                  style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  ₩{order.totalAmount.toLocaleString()}
                </Box>
                <Box component="td" style={{ padding: '12px 16px', textAlign: 'right' }}>
                  {isRefundable(order) && (
                    <Button
                      onClick={() => onRefund(order)}
                      disabled={processingIds.has(order.id)}
                      size="xs"
                      variant="outline"
                      color="red"
                      radius="md"
                    >
                      {processingIds.has(order.id) ? '처리중…' : '강제환불'}
                    </Button>
                  )}
                  {onPostDeliveryRefund && isPostDeliveryRefundable(order) && (
                    <Button
                      onClick={() => onPostDeliveryRefund(order)}
                      disabled={processingIds.has(order.id)}
                      size="xs"
                      variant="outline"
                      color="red"
                      radius="md"
                    >
                      {processingIds.has(order.id) ? '처리중…' : '배송 후 환불'}
                    </Button>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Paper>
    </>
  );
}
