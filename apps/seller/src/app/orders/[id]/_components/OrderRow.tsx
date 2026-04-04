'use client'

import { Box, Group, Text } from '@mantine/core'

export function Row({
  label,
  value,
  bold,
  highlight,
  mono,
}: {
  label: string
  value: string
  bold?: boolean
  highlight?: boolean
  mono?: boolean
}) {
  return (
    <Group justify="space-between" align="flex-start" gap="xs">
      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>{label}</Text>
      <Text
        size="sm"
        ta="right"
        style={{ wordBreak: 'break-all' }}
        fw={bold ? 700 : mono ? 400 : undefined}
        c={bold ? 'gray.9' : highlight ? 'var(--green-primary)' : mono ? 'gray.6' : 'gray.7'}
        ff={mono ? 'monospace' : undefined}
      >
        {value}
      </Text>
    </Group>
  )
}

export const STATUS_LABEL_MAP: Record<string, string> = {
  PENDING: '대기',
  RECRUITING: '모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '결제 완료',
  PREPARING: '준비 중',
  DELIVERING: '배송 중',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '취소',
  REVIEWED: '구매 확정',
}

export const STATUS_COLOR_MAP: Record<string, string> = {
  ACCEPTED: 'orange',
  CONFIRMED: 'orange',
  RECRUITING: 'orange',
  PREPARING: 'blue',
  DELIVERING: 'violet',
  HUB_ARRIVED: 'violet',
  CANCELLED: 'red',
  PENDING: 'gray',
  DELIVERED: 'green',
  PICKED_UP: 'green',
  REVIEWED: 'green',
}

export const DELIVERY_LABEL_MAP: Record<string, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
}
