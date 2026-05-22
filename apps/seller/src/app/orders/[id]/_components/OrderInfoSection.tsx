'use client';

import type { GroupProductConfig, Order } from '@greenhub/shared';
import { Badge, Box, Group, Paper, Stack, Text } from '@mantine/core';
import { DELIVERY_LABEL, STATUS_COLOR, STATUS_LABEL } from '../../_constants';
import { formatDeadlineCountdown, toDate } from '../_lib';
import { Row } from './OrderRow';

interface OrderInfoSectionProps {
  order: Order;
  productName: string | null;
  groupConfig: GroupProductConfig | null;
}

export function OrderInfoSection({ order, productName, groupConfig }: OrderInfoSectionProps) {
  return (
    <>
      <Paper radius="lg" shadow="xs" p="md">
        <Group justify="space-between" mb="sm">
          <Badge color={STATUS_COLOR[order.status]} variant="light" radius="xl" size="md">
            {STATUS_LABEL[order.status]}
          </Badge>
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              color:
                order.status === 'RECRUITING'
                  ? 'var(--color-status-warning-text)'
                  : 'var(--color-text-disabled)',
              fontWeight: order.status === 'RECRUITING' ? 'var(--fw-medium)' : undefined,
            }}
          >
            {order.status === 'RECRUITING' && groupConfig
              ? formatDeadlineCountdown(groupConfig.recruitDeadline)
              : toDate(order.createdAt).toLocaleString('ko-KR', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
          </Text>
        </Group>
        <Text style={{ fontWeight: 'var(--fw-bold)' }}>
          주문 #{order.id.slice(-8).toUpperCase()}
        </Text>
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          mt={2}
        >
          {order.saleType === 'group' ? '공동구매' : '일반 판매'}
        </Text>
      </Paper>

      <Paper radius="lg" shadow="xs" p="md">
        <Text
          style={{
            fontWeight: 'var(--fw-medium)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
          }}
          mb="xs"
        >
          상품 정보
        </Text>
        <Stack gap={6}>
          <Row label="상품명" value={productName ?? order.productId} />
          <Row label="수량" value={`${order.quantity}개`} />
          <Row
            label="상품 금액"
            value={`₩${(order.totalAmount - order.deliveryFee).toLocaleString()}`}
          />
          <Row label="배송비" value={`₩${order.deliveryFee.toLocaleString()}`} />
          <Box style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8, marginTop: 4 }}>
            <Row label="결제 금액" value={`₩${order.totalAmount.toLocaleString()}`} bold />
          </Box>
        </Stack>
      </Paper>

      {order.saleType === 'group' && groupConfig && (
        <Paper radius="lg" shadow="xs" p="md">
          <Text
            style={{
              fontWeight: 'var(--fw-medium)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
            }}
            mb="xs"
          >
            공동구매 현황
          </Text>
          <Stack gap={6}>
            <Row
              label="현재 수량"
              value={`${groupConfig.currentQuantity} / ${groupConfig.targetQuantity}개 (최소 ${groupConfig.minQuantity}개)`}
            />
            <Row
              label="모집 마감일"
              value={new Date(groupConfig.recruitDeadline).toLocaleDateString('ko-KR')}
            />
            <Row
              label="배송 예정일"
              value={new Date(groupConfig.groupDeliveryDate).toLocaleDateString('ko-KR')}
            />
          </Stack>
        </Paper>
      )}

      <Paper radius="lg" shadow="xs" p="md">
        <Text
          style={{
            fontWeight: 'var(--fw-medium)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
          }}
          mb="xs"
        >
          배송 정보
        </Text>
        <Stack gap={6}>
          <Row label="배송 수단" value={DELIVERY_LABEL[order.deliveryMethod]} />
          {order.saleType === 'normal' && order.requestedDeliveryDate && (
            <Row
              label="희망 배송일"
              value={new Date(order.requestedDeliveryDate).toLocaleDateString('ko-KR')}
              highlight
            />
          )}
          {order.deliveryMethod !== 'hub' ? (
            <>
              <Row
                label="주소"
                value={`${order.deliveryAddress.address} ${order.deliveryAddress.addressDetail}`}
              />
              <Row label="우편번호" value={order.deliveryAddress.zipCode} />
              <Row label="서울·경기" value={order.isMetropolitan ? '해당' : '해당 없음'} />
            </>
          ) : (
            order.pickupCode && (
              <Paper
                mt="xs"
                p="sm"
                radius="md"
                style={{ backgroundColor: 'var(--color-primary-surface)', textAlign: 'center' }}
              >
                <Text
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-disabled)',
                  }}
                  mb={4}
                >
                  픽업 코드
                </Text>
                <Text
                  style={{
                    fontSize: 'var(--font-size-2xl)',
                    letterSpacing: '0.2em',
                    fontWeight: 'var(--fw-bold)',
                    color: 'var(--color-primary)',
                  }}
                >
                  {order.pickupCode}
                </Text>
              </Paper>
            )
          )}
          {order.preparedAt && (
            <Row
              label="수거 예정 시각"
              value={new Date(order.preparedAt).toLocaleString('ko-KR', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
              highlight
            />
          )}
        </Stack>
      </Paper>

      {order.status === 'CANCELLED' && order.cancelReason && (
        <Paper radius="lg" p="md" style={{ backgroundColor: 'var(--color-danger-surface)' }}>
          <Text
            style={{
              fontWeight: 'var(--fw-medium)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-danger)',
            }}
            mb="xs"
          >
            취소 사유
          </Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
            {order.cancelReason}
          </Text>
        </Paper>
      )}
    </>
  );
}
