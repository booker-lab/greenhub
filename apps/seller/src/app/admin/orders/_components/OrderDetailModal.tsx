'use client';

import { Badge, Box, Divider, Modal, Stack, Text } from '@mantine/core';
import type { AdminOrder } from '@/hooks/useAdmin';
import { getStatusColor, STATUS_LABEL } from '../_lib';

interface OrderDetailModalProps {
  order: AdminOrder | null;
  onClose: () => void;
}

function formatDate(value: unknown) {
  if (!value) return '-';
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR');
  }
  if (typeof value === 'object' && value !== null && '_seconds' in value) {
    const seconds = Number((value as { _seconds?: unknown })._seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toLocaleString('ko-KR');
  }
  return '-';
}

function deliveryLabel(method: string) {
  if (method === 'parcel') return '택배';
  if (method === 'direct') return '직접배송';
  if (method === 'hub') return '거점배송';
  return method;
}

function saleTypeLabel(saleType?: string) {
  if (saleType === 'group') return '공동구매';
  if (saleType === 'normal') return '일반';
  return saleType ?? '-';
}

function trackingText(order: AdminOrder) {
  if (!order.courierCompany?.trim() || !order.trackingNumber?.trim()) return '-';
  return `${order.courierCompany} / ${order.trackingNumber}`;
}

function addressText(order: AdminOrder) {
  if (order.address?.trim()) return order.address;
  const address = order.deliveryAddress?.address?.trim();
  const detail = order.deliveryAddress?.addressDetail?.trim();
  const zipCode = order.deliveryAddress?.zipCode?.trim();
  const combined = [address, detail].filter(Boolean).join(' ');
  if (!combined && !zipCode) return '-';
  return zipCode ? `${combined} (${zipCode})` : combined;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(96px, 0.35fr) minmax(0, 1fr)',
        gap: 8,
        alignItems: 'start',
      }}
    >
      <Box>
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      </Box>
      <Box>
        <Text size="sm" style={{ wordBreak: 'break-word' }}>
          {value || '-'}
        </Text>
      </Box>
    </Box>
  );
}

export function OrderDetailModal({ order, onClose }: OrderDetailModalProps) {
  return (
    <Modal
      opened={Boolean(order)}
      onClose={onClose}
      title="주문 상세"
      centered
      size="lg"
      radius="md"
    >
      {order && (
        <Stack gap="sm">
          <DetailRow label="주문번호" value={order.orderNumber ?? order.id} />
          <DetailRow
            label="상태"
            value={
              <Badge color={getStatusColor(order.status)} variant="light" radius="xl">
                {STATUS_LABEL[order.status] ?? order.status}
              </Badge>
            }
          />
          <Divider />
          <DetailRow label="상품" value={order.productName ?? order.productId ?? '-'} />
          <DetailRow label="수량" value={order.quantity ? `${order.quantity}개` : '-'} />
          <DetailRow label="판매 방식" value={saleTypeLabel(order.saleType)} />
          <DetailRow label="금액" value={`₩${order.totalAmount.toLocaleString()}`} />
          <Divider />
          <DetailRow label="구매자" value={order.buyerName ?? order.userId} />
          <DetailRow label="연락처" value={order.buyerPhone ?? '-'} />
          <DetailRow label="배송 방식" value={deliveryLabel(order.deliveryMethod)} />
          <DetailRow label="배송지" value={addressText(order)} />
          <DetailRow label="희망 배송일" value={formatDate(order.requestedDeliveryDate)} />
          <DetailRow label="준비 예정" value={formatDate(order.preparedAt)} />
          <DetailRow label="송장" value={trackingText(order)} />
          {order.cancelReason && <DetailRow label="취소 사유" value={order.cancelReason} />}
          <Divider />
          <DetailRow label="스토어 ID" value={order.storeId} />
          <DetailRow label="사용자 ID" value={order.userId} />
          <DetailRow label="생성일" value={formatDate(order.createdAt)} />
          <DetailRow label="수정일" value={formatDate(order.updatedAt)} />
        </Stack>
      )}
    </Modal>
  );
}
