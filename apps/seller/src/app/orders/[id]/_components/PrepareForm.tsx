'use client';

import { Button, Group, Paper, Text } from '@mantine/core';
import type { Order } from '@greenhub/shared';
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
        드라이버 수거 예정 시각 설정
      </Text>
      {deliveryDate && (
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          mb="xs"
        >
          {order.saleType === 'normal' ? '소비자 희망 배송일' : '공동구매 배송 예정일'}:{' '}
          <Text
            component="span"
            style={{ fontWeight: 'var(--fw-medium)', color: 'var(--color-text-secondary)' }}
          >
            {new Date(deliveryDate).toLocaleDateString('ko-KR')}
          </Text>
        </Text>
      )}
      <Group gap="xs" mb="xs">
        {makePreparedAtOptions().map((opt) => (
          <Button
            key={opt.iso}
            size="xs"
            radius="xl"
            variant={preparedAt === opt.iso ? 'filled' : 'outline'}
            color={preparedAt === opt.iso ? 'green' : 'gray'}
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
