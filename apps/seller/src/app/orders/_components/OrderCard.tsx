'use client';

import { useRouter } from 'next/navigation';
import type { Order } from '@greenhub/shared';
import { Alert, Badge, Button, Group, Paper, Text } from '@mantine/core';
import { useOrderActions } from '@/hooks/useOrderActions';
import {
  ACCENT_BORDER,
  DELIVERY_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  formatRelativeTime,
} from '../_constants';

export function OrderCard({ order, storeId }: { order: Order; storeId: string | null }) {
  const router = useRouter();
  const {
    actionLoading,
    actionError,
    showPrepareForm,
    setShowPrepareForm,
    preparedAtInput,
    setPreparedAtInput,
    handlePrepare,
    handleCancel,
  } = useOrderActions(storeId, order.id);

  const canPrepare = order.status === 'ACCEPTED' || order.status === 'CONFIRMED';
  const canCancel =
    order.status === 'ACCEPTED' || order.status === 'CONFIRMED' || order.status === 'PREPARING';

  return (
    <Paper
      radius="md"
      shadow="xs"
      p="md"
      style={{ cursor: 'pointer', borderLeft: `4px solid ${ACCENT_BORDER[order.status]}` }}
      onClick={() => router.push(`/orders/${order.id}`)}
    >
      {/* 상단: 상태 뱃지 + 시간 */}
      <Group justify="space-between" mb="xs">
        <Badge color={STATUS_COLOR[order.status]} variant="light" radius="xl">
          {STATUS_LABEL[order.status]}
        </Badge>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          {formatRelativeTime(order.createdAt)}
        </Text>
      </Group>

      {/* 주문 정보 */}
      <Text
        style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}
        mb={4}
      >
        주문 #{order.id.slice(-6).toUpperCase()}
      </Text>
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mb={6}>
        {DELIVERY_LABEL[order.deliveryMethod]}
        {order.requestedDeliveryDate && ` · ${order.requestedDeliveryDate}`}
      </Text>
      <Text
        style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}
        mb="sm"
      >
        {order.totalAmount.toLocaleString()}원
      </Text>

      {/* 준비 시작 폼 */}
      {showPrepareForm && (
        <Paper
          p="md"
          radius="md"
          mb="sm"
          style={{ background: 'var(--color-status-info-bg)', border: '1px solid var(--color-border)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-status-info-text)',
              fontWeight: 'var(--fw-medium)',
            }}
            mb="xs"
          >
            드라이버 수거 예정 시간 (선택)
          </Text>
          <input
            type="datetime-local"
            value={preparedAtInput}
            onChange={(e) => setPreparedAtInput(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 14,
              marginBottom: 8,
              background: 'var(--color-bg)',
            }}
          />
          <Group gap="xs">
            <Button onClick={handlePrepare} disabled={actionLoading} flex={1} size="sm" radius="md" color="brand">
              확인
            </Button>
            <Button
              onClick={() => { setShowPrepareForm(false); setPreparedAtInput(''); }}
              flex={1}
              size="sm"
              radius="md"
              variant="default"
            >
              취소
            </Button>
          </Group>
        </Paper>
      )}

      {/* 액션 버튼 */}
      {!showPrepareForm && (canPrepare || canCancel) && (
        <Group gap="xs" onClick={(e) => e.stopPropagation()}>
          {canPrepare && (
            <Button
              onClick={() => setShowPrepareForm(true)}
              disabled={actionLoading}
              flex={1}
              size="sm"
              radius="md"
              color="brand"
            >
              준비 시작
            </Button>
          )}
          {canCancel && (
            <Button onClick={handleCancel} disabled={actionLoading} flex={1} size="sm" radius="md" variant="outline" color="red">
              강제 취소
            </Button>
          )}
        </Group>
      )}

      {order.status === 'RECRUITING' && (
        <Alert color="blue" variant="light" radius="md" mt="xs" py="xs" onClick={(e) => e.stopPropagation()}>
          <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}>
            공동구매 모집 중
          </Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }} mt={2}>
            모집 마감 후 인원 충족 시 자동 확정됩니다.
          </Text>
        </Alert>
      )}

      {actionError && (
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }} mt="xs">
          {actionError}
        </Text>
      )}

      {order.status === 'HUB_ARRIVED' && order.pickupCode && (
        <Paper
          mt="xs"
          p="sm"
          radius="md"
          style={{ background: 'var(--color-primary-surface)' }}
          ta="center"
          onClick={(e) => e.stopPropagation()}
        >
          <Text
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)', fontWeight: 'var(--fw-medium)' }}
            mb={4}
          >
            픽업 코드
          </Text>
          <Text
            style={{
              fontSize: 24,
              letterSpacing: '0.2em',
              fontFamily: 'monospace',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-primary-dark)',
            }}
          >
            {order.pickupCode}
          </Text>
        </Paper>
      )}
    </Paper>
  );
}
