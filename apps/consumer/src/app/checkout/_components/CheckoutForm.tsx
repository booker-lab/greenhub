'use client';

import { useEffect } from 'react';
import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { DeliveryAddress, DeliveryMethod } from '@greenhub/shared';
import type { CartItem } from '@/hooks/useCart';
import type { PaymentMethod } from '@/hooks/usePayment';

const NAVERPAY_ENABLED = !!process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY;

const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
};

const PAYMENT_OPTIONS: { method: PaymentMethod; label: string; icon: string }[] = [
  { method: 'kakaopay', label: '카카오페이', icon: '💛' },
  ...(NAVERPAY_ENABLED
    ? [{ method: 'naverpay' as PaymentMethod, label: '네이버페이', icon: '🟢' }]
    : []),
];

export interface CheckoutFormProps {
  items: CartItem[];
  totalAmount: number;
  address: DeliveryAddress;
  onAddressChange: (a: DeliveryAddress) => void;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (m: PaymentMethod) => void;
  isLoading: boolean;
  canPay: boolean;
  error: string | null;
  onPay: () => void;
  singleSummary?: {
    quantity: number;
    deliveryMethod: DeliveryMethod;
    requestedDeliveryDate?: string;
  };
}

function formatDeliveryDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

export default function CheckoutForm({
  items,
  totalAmount,
  address,
  onAddressChange,
  paymentMethod,
  onPaymentMethodChange,
  isLoading,
  canPay,
  error,
  onPay,
  singleSummary,
}: CheckoutFormProps) {
  useEffect(() => {
    if (!isLoading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isLoading]);

  function openAddressSearch() {
    new window.daum.Postcode({
      oncomplete(data) {
        onAddressChange({
          ...address,
          address: data.address,
          zipCode: data.zonecode,
          addressDetail: '',
        });
      },
    }).open();
  }

  const buttonLabel = isLoading
    ? '처리 중...'
    : paymentMethod === 'naverpay'
      ? '네이버페이로 결제하기'
      : '카카오페이로 결제하기';

  return (
    <Container size="sm" px="md" py="lg">
      <Title order={2} mb="lg">
        결제
      </Title>

      {/* 주문 요약 */}
      <Paper radius="md" p="md" mb="lg" style={{ background: 'var(--color-surface-muted)' }}>
        <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }} mb="xs">
          주문 정보
        </Text>
        <Stack gap={4}>
          {items.length > 0
            ? items.map((item) => (
                <Stack key={item.productId} gap={2}>
                  <Group justify="space-between">
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-secondary)',
                        flex: 1,
                      }}
                    >
                      {item.name} × {item.quantity}
                    </Text>
                    <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                      {(item.price * item.quantity).toLocaleString()}원
                    </Text>
                  </Group>
                  {item.requestedDeliveryDate && (
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      배송 희망일 {formatDeliveryDate(item.requestedDeliveryDate)}
                    </Text>
                  )}
                </Stack>
              ))
            : singleSummary && (
                <Group justify="space-between">
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    수량
                  </Text>
                  <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                    {singleSummary.quantity}개
                  </Text>
                </Group>
              )}
          {singleSummary && (
            <Group justify="space-between">
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                배송 방법
              </Text>
              <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                {DELIVERY_LABELS[singleSummary.deliveryMethod]}
              </Text>
            </Group>
          )}
          {singleSummary?.requestedDeliveryDate && (
            <Group justify="space-between">
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                배송 희망일
              </Text>
              <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                {formatDeliveryDate(singleSummary.requestedDeliveryDate)}
              </Text>
            </Group>
          )}
          {totalAmount > 0 && (
            <Group justify="space-between" mt={4}>
              <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}>
                결제 금액
              </Text>
              <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}>
                {totalAmount.toLocaleString()}원
              </Text>
            </Group>
          )}
        </Stack>
      </Paper>

      {/* 배송지 */}
      <Stack gap="sm" mb="lg">
        <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }}>
          배송지
        </Text>
        <Group gap="xs" align="flex-end">
          <TextInput
            style={{ flex: 1 }}
            placeholder="주소 검색 후 자동 입력 *"
            value={address.address}
            readOnly
            radius="md"
          />
          <Button variant="outline" color="gray" radius="md" onClick={openAddressSearch}>
            주소 검색
          </Button>
        </Group>
        <TextInput
          placeholder="상세 주소"
          value={address.addressDetail}
          onChange={(e) => onAddressChange({ ...address, addressDetail: e.target.value })}
          radius="md"
        />
        <TextInput
          placeholder="우편번호 (자동 입력)"
          value={address.zipCode}
          readOnly
          radius="md"
        />
      </Stack>

      {/* 결제 수단 */}
      <Stack gap="xs" mb="lg">
        <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }}>
          결제 수단
        </Text>
        {PAYMENT_OPTIONS.map(({ method, label, icon }) => {
          const isSelected = paymentMethod === method;
          return (
            <Paper
              key={method}
              p="sm"
              radius="md"
              onClick={() => onPaymentMethodChange(method)}
              style={{
                border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
              }}
            >
              <span>{icon}</span>
              <Text
                style={{
                  fontWeight: isSelected ? 'var(--fw-bold)' : 'var(--fw-medium)',
                  fontSize: 'var(--font-size-sm)',
                }}
              >
                {label}
              </Text>
            </Paper>
          );
        })}
      </Stack>

      {error && (
        <Alert color="red" variant="light" mb="sm">
          <Text style={{ fontSize: 'var(--font-size-sm)' }}>{error}</Text>
        </Alert>
      )}

      <Button
        fullWidth
        size="lg"
        color="brand"
        radius="md"
        disabled={!canPay}
        loading={isLoading}
        onClick={onPay}
      >
        {buttonLabel}
      </Button>
    </Container>
  );
}
