'use client';

import {
  type DeliveryAddress,
  type DeliveryMethod,
  ORDER_REQUEST_NOTE_MAX_LENGTH,
} from '@greenhub/shared';
import {
  Alert,
  Button,
  Checkbox,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { type CartItem, isRoundCartItem } from '@/hooks/useCart';
import type { PaymentMethod } from '@/hooks/usePayment';

const NAVERPAY_ENABLED = !!process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY;

const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
};

const PAYMENT_OPTIONS: { method: PaymentMethod; label: string; dot: string }[] = [
  { method: 'kakaopay', label: '카카오페이', dot: '#FEE500' },
  ...(NAVERPAY_ENABLED
    ? [{ method: 'naverpay' as PaymentMethod, label: '네이버페이', dot: '#03C75A' }]
    : []),
];

export interface CheckoutFormProps {
  items: CartItem[];
  /** 화면에 보일 결제 금액. null이면 서버 금액을 확인하는 중으로 표시하고, 0이면 줄을 숨긴다. */
  totalAmount: number | null;
  address: DeliveryAddress;
  onAddressChange: (a: DeliveryAddress) => void;
  deliveryPhone: string;
  onDeliveryPhoneChange: (phone: string) => void;
  /** 회차 주문에서만 넘긴다. 없으면 요청사항 칸을 그리지 않는다. */
  requestNote?: string;
  onRequestNoteChange?: (note: string) => void;
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

export function isIcheonDeliveryAddress(value: string): boolean {
  return /^(?:(?:경기도|경기)\s+)?이천시(?:\s|$)/.test(value.trim());
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
  deliveryPhone,
  onDeliveryPhoneChange,
  requestNote,
  onRequestNoteChange,
  paymentMethod,
  onPaymentMethodChange,
  isLoading,
  canPay,
  error,
  onPay,
  singleSummary,
}: CheckoutFormProps) {
  const [roundDetailsConfirmed, setRoundDetailsConfirmed] = useState(false);
  const isRoundCheckout = items.length > 0 && items.every(isRoundCartItem);
  const isIcheonAddress = isIcheonDeliveryAddress(address.address);
  const confirmationKey = isRoundCheckout
    ? items
        .map(
          (item) =>
            `${item.roundId}:${item.roundItemId}:${item.productId}:${item.price}:${item.quantity}`,
        )
        .join('|')
    : '';
  const effectiveCanPay =
    canPay && (!isRoundCheckout || (isIcheonAddress && roundDetailsConfirmed));

  useEffect(() => {
    if (confirmationKey) setRoundDetailsConfirmed(false);
  }, [confirmationKey]);

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
      <Title
        order={1}
        mb="lg"
        style={{ fontSize: 22, fontWeight: 'var(--fw-extrabold)', letterSpacing: '-0.01em' }}
      >
        결제
      </Title>

      {/* 주문 요약: 회색 바탕 위 회색 글자는 대비가 약해 흰 카드·본문 색 글자로 둔다 */}
      <Paper
        p="md"
        mb="xl"
        withBorder
        style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius)' }}
      >
        <Text
          style={{ fontWeight: 'var(--fw-extrabold)', fontSize: 'var(--font-size-md)' }}
          mb="xs"
        >
          주문 정보
        </Text>
        {items.length > 0 && (
          <Text size="sm" c="var(--color-text-secondary)" mb="xs">
            총 {items.reduce((sum, item) => sum + item.quantity, 0)}개 상품
          </Text>
        )}
        <Stack gap={4}>
          {items.length > 0
            ? items.map((item) => (
                <Stack key={item.productId} gap={2}>
                  <Group justify="space-between">
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 'var(--fw-medium)',
                        color: 'var(--color-text)',
                        flex: 1,
                      }}
                    >
                      {item.name} × {item.quantity}
                    </Text>
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 'var(--fw-bold)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
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
          {(totalAmount === null || totalAmount > 0) && (
            <Group
              justify="space-between"
              align="baseline"
              mt={8}
              pt={10}
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}>
                결제 금액
              </Text>
              {totalAmount === null ? (
                <Text
                  aria-live="polite"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  금액 확인 중...
                </Text>
              ) : (
                <Text
                  style={{
                    fontSize: 22,
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 'var(--fw-extrabold)',
                  }}
                >
                  {totalAmount.toLocaleString()}원
                </Text>
              )}
            </Group>
          )}
        </Stack>
      </Paper>

      {/* 배송지 */}
      <Stack gap="sm" mb="xl">
        <Text style={{ fontWeight: 'var(--fw-extrabold)', fontSize: 'var(--font-size-md)' }}>
          배송지
        </Text>
        <Group gap="xs" align="flex-end">
          <TextInput
            style={{ flex: 1 }}
            label={isRoundCheckout ? '이천시 배송 가능 주소' : undefined}
            placeholder="주소 검색 후 자동 입력 *"
            value={address.address}
            readOnly
            error={
              isRoundCheckout && address.address && !isIcheonAddress
                ? '경기도 이천시 주소만 주문할 수 있습니다.'
                : undefined
            }
          />
          <Button variant="outline" color="gray" radius="xl" onClick={openAddressSearch}>
            주소 검색
          </Button>
        </Group>
        <TextInput
          placeholder="상세 주소"
          value={address.addressDetail}
          onChange={(e) => onAddressChange({ ...address, addressDetail: e.target.value })}
        />
        <TextInput placeholder="우편번호 (자동 입력)" value={address.zipCode} readOnly />
        <TextInput
          label={isRoundCheckout ? '배송 연락처 (필수)' : '연락처'}
          description={
            isRoundCheckout
              ? '주문·결제·배송 안내를 위한 정보성 연락에 사용하며 마케팅 동의와 별개입니다.'
              : undefined
          }
          placeholder="010-1234-5678"
          type="tel"
          value={deliveryPhone}
          onChange={(e) => onDeliveryPhoneChange(e.target.value)}
          autoComplete="tel"
          required
        />
        {isRoundCheckout && onRequestNoteChange && (
          <Textarea
            label="요청사항 (선택)"
            description={`받는 분 성함·연락처, 선물 문구, 배송 요청을 적어 주세요. (${
              requestNote?.length ?? 0
            }/${ORDER_REQUEST_NOTE_MAX_LENGTH})`}
            placeholder="예) 받는 분 김그린 010-0000-0000 / 문구: 개업을 축하합니다"
            value={requestNote ?? ''}
            onChange={(e) => onRequestNoteChange(e.target.value)}
            maxLength={ORDER_REQUEST_NOTE_MAX_LENGTH}
            autosize
            minRows={2}
            maxRows={6}
          />
        )}
      </Stack>

      {isRoundCheckout && (
        <Stack gap="md" mb="xl">
          <Paper p="md" style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}>
            <Text fw="var(--fw-extrabold)" size="sm" mb="xs">
              필수 고지
            </Text>
            <Stack gap="xs">
              <Text size="sm" fw="var(--fw-bold)" c="var(--color-primary-dark)">
                경기도 이천시 직접배송만 제공하며 화요일 오전 9시까지 문 앞 배송합니다.
              </Text>
              <Text size="sm" c="var(--color-text-secondary)">
                안전한 배송이 어려운 기상 상황에는 배송이 연기될 수 있으며, 판매자 책임으로 재배송비
                없이 새 배송 일정을 안내합니다.
              </Text>
              <Text size="sm" c="var(--color-text-secondary)">
                주문 마감 후 경매 매입·배송 준비가 시작되었거나 고객의 취급·시간 경과로 상품 가치가
                현저히 감소한 경우 단순 변심 청약철회가 제한될 수 있습니다. 표시·광고 또는 계약
                내용과 다르게 이행된 경우는 제외됩니다.
              </Text>
            </Stack>
          </Paper>

          <Paper
            p="md"
            style={{ background: 'var(--color-deadline-surface)', borderRadius: 'var(--radius)' }}
          >
            <Text size="sm" fw="var(--fw-extrabold)" c="var(--color-deadline-text)" mb={4}>
              결제 직전 확인
            </Text>
            <Text size="sm" c="var(--color-text-secondary)" mb="sm">
              상품 정보가 변경되면 상품·수량·회차 가격과 총 결제 금액을 다시 확인해야 합니다.
            </Text>
            <Checkbox
              label="상품·가격·회차 변경 내용을 확인했습니다."
              checked={roundDetailsConfirmed}
              onChange={(event) => setRoundDetailsConfirmed(event.currentTarget.checked)}
            />
          </Paper>
        </Stack>
      )}

      {/* 결제 수단 */}
      <Stack gap="xs" mb="xl">
        <Text style={{ fontWeight: 'var(--fw-extrabold)', fontSize: 'var(--font-size-md)' }}>
          결제 수단
        </Text>
        {PAYMENT_OPTIONS.map(({ method, label, dot }) => {
          const isSelected = paymentMethod === method;
          return (
            <Paper
              key={method}
              p="md"
              onClick={() => onPaymentMethodChange(method)}
              style={{
                border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius)',
                background: isSelected ? 'var(--color-primary-surface)' : 'var(--color-bg)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
              }}
            >
              <span
                aria-hidden
                style={{
                  background: dot,
                  borderRadius: 'var(--radius-full)',
                  display: 'inline-block',
                  height: 14,
                  width: 14,
                }}
              />
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
        radius="xl"
        disabled={!effectiveCanPay}
        loading={isLoading}
        onClick={() => {
          if (effectiveCanPay) onPay();
        }}
      >
        {buttonLabel}
      </Button>
    </Container>
  );
}
