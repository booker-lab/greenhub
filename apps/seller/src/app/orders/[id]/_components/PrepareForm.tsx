'use client';

import type { Order } from '@greenhub/shared';
import { Button, Group, Paper, Text } from '@mantine/core';
import { isRoundOrder } from '@/lib/round-purchase-list';
import { makePreparedAtOptions } from '../_lib';

interface PrepareFormProps {
  order: Order;
  deliveryDate: string | null;
  preparedAt: string | null;
  setPreparedAt: (v: string | null) => void;
  actionLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PrepareForm({
  order,
  deliveryDate,
  preparedAt,
  setPreparedAt,
  actionLoading,
  onConfirm,
  onCancel,
}: PrepareFormProps) {
  // 회차 주문은 기사가 배송일 새벽에 한꺼번에 가져가므로 수거 예정 시각을 고르지 않는다
  // (서버도 preparedAt을 요구하지 않는다). 확인만 받고 같은 준비 시작 요청을 보낸다.
  const roundOrder = isRoundOrder(order);

  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Text
        style={{
          fontWeight: 'var(--fw-medium)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-secondary)',
        }}
        mb="sm"
      >
        {roundOrder ? '회차 주문 준비 시작' : '드라이버 수거 예정 시각 설정'}
      </Text>
      {deliveryDate && (
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          mb="xs"
        >
          {roundOrder
            ? '배송일'
            : order.saleType === 'normal'
              ? '소비자 희망 배송일'
              : '공동구매 배송 예정일'}
          :{' '}
          <Text
            component="span"
            style={{ fontWeight: 'var(--fw-medium)', color: 'var(--color-text-secondary)' }}
          >
            {new Date(deliveryDate).toLocaleDateString('ko-KR')}
          </Text>
        </Text>
      )}
      {roundOrder ? (
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          mb="sm"
        >
          준비를 시작하면 손님께 알림톡이 가고, 기사 화면에 이 주문이 보여요.
        </Text>
      ) : (
        <>
          <Group gap="xs" mb="xs">
            {makePreparedAtOptions().map((opt) => (
              <Button
                key={opt.iso}
                size="xs"
                radius="xl"
                variant={preparedAt === opt.iso ? 'filled' : 'outline'}
                color={preparedAt === opt.iso ? 'brand' : 'gray'}
                onClick={() => setPreparedAt(preparedAt === opt.iso ? null : opt.iso)}
                style={{ flex: 1, fontWeight: 'var(--fw-medium)' }}
              >
                {opt.label}
              </Button>
            ))}
          </Group>
          <Text
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            mb="sm"
          >
            {preparedAt
              ? `선택됨: ${new Date(preparedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
              : '선택하지 않아도 준비 시작 처리는 가능합니다.'}
          </Text>
        </>
      )}
      <Group gap="xs">
        <Button
          onClick={onConfirm}
          disabled={actionLoading}
          flex={1}
          size="md"
          radius="xl"
          style={{
            backgroundColor: 'var(--color-primary)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          {actionLoading ? '처리 중...' : '준비 시작 확인'}
        </Button>
        <Button onClick={onCancel} flex={1} size="md" radius="xl" variant="outline" color="gray">
          취소
        </Button>
      </Group>
    </Paper>
  );
}
