'use client';

import type { RedeliveryPaymentActionability } from '@greenhub/shared';
import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { use, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import {
  getRedeliveryPaymentPresentation,
  isDeliveryStartAllowed,
} from '../_lib/redelivery-payment';
import {
  type DeliveryHold,
  DeliveryHoldModal,
  HOLD_REASON_LABEL,
} from './_components/DeliveryHoldModal';

type Order = {
  id?: string;
  schemaVersion?: number;
  roundId?: string | null;
  storeId: string;
  status: string;
  deliveryMethod: string;
  buyerName?: string;
  address?: string;
  deliveryAddress?: { address?: string };
  hubName?: string;
  hubAddress?: string;
  productName?: string;
  quantity?: number;
  preparedAt?: string | null;
  updatedAt?: string | null;
  sellerPhone?: string;
  buyerPhone?: string;
  deliveryHold?: DeliveryHold | null;
  redeliveryPayment?: RedeliveryPaymentActionability;
};

const METHOD_LABEL: Record<string, string> = {
  direct: '직배송',
  hub: '거점 픽업',
  parcel: '택배',
};

export default function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const { data: session } = useSession();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [holdOpened, setHoldOpened] = useState(false);
  const [readLoading, setReadLoading] = useState(true);

  useEffect(() => {
    const token = session?.user.accessToken;
    if (!token) {
      setReadLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setReadLoading(true);

    apiFetch(`/driver/orders/${encodeURIComponent(orderId)}`, token, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`driver order request failed: ${response.status}`);
        return (await response.json()) as Order;
      })
      .then((payload) => {
        if (active) setOrder(payload);
      })
      .catch((cause: unknown) => {
        if (active && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setOrder(null);
        }
      })
      .finally(() => {
        if (active) setReadLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [orderId, session?.user.accessToken]);

  async function updateStatus(status: string) {
    if (!order || !session) return;
    setLoading(true);
    try {
      const res = await apiFetch(
        `/stores/${order.storeId}/orders/${orderId}/status`,
        session.user.accessToken,
        { method: 'PATCH', body: JSON.stringify({ status }) },
      );
      if (!res.ok) throw new Error('상태 전환 실패');
      const result = (await res.json()) as { orderId?: unknown; status?: unknown };
      if (result.orderId !== orderId || result.status !== status) {
        throw new Error('상태 전환 응답 불일치');
      }
      if (status === 'DELIVERED' || status === 'HUB_ARRIVED') {
        router.replace('/board?tab=preparing');
      }
    } catch {
      notifications.show({ color: 'red', message: '오류가 발생했습니다. 다시 시도해주세요.' });
    } finally {
      setLoading(false);
    }
  }

  if (readLoading) {
    return (
      <Box
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Loader color="brand" />
      </Box>
    );
  }

  if (!order) {
    return (
      <Box
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: 'var(--color-text-disabled)' }}>주문을 찾을 수 없습니다</Text>
      </Box>
    );
  }

  const isDelivering = order.status === 'DELIVERING';
  const isPreparing = order.status === 'PREPARING';
  const isHeld = order.status === 'DELIVERY_HELD';
  const isHub = order.deliveryMethod === 'hub';
  const isRoundDirect =
    order.schemaVersion === 2 && Boolean(order.roundId) && order.deliveryMethod === 'direct';
  const paymentPresentation = getRedeliveryPaymentPresentation(order.redeliveryPayment);
  const deliveryStartAllowed = isDeliveryStartAllowed(order.redeliveryPayment);
  const preparedAtStr = order.preparedAt
    ? new Date(order.preparedAt).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '시간 미정';

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      {/* 헤더 */}
      <Box
        component="header"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backgroundColor: 'var(--color-bg)',
          borderBottom: 'var(--border)',
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <UnstyledButton
          onClick={() => router.back()}
          style={{ color: 'var(--color-text-secondary)', padding: 4 }}
          aria-label="뒤로가기"
        >
          <svg
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </UnstyledButton>
        <Group gap="xs">
          <Badge color="green" variant="light" size="sm">
            {METHOD_LABEL[order.deliveryMethod] ?? order.deliveryMethod}
          </Badge>
          {isDelivering && (
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-primary)',
              }}
            >
              배송 중
            </Text>
          )}
          {isHeld && (
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-danger)',
              }}
            >
              배송 보류
            </Text>
          )}
        </Group>
      </Box>

      {/* 본문 */}
      <Box component="main" style={{ flex: 1, padding: '24px 16px' }}>
        <Stack gap="md">
          {/* 주문 정보 */}
          <Card radius="xl" withBorder p="md">
            <Stack gap="sm">
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-bold)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                주문 정보
              </Text>
              <InfoRow
                label="상품"
                value={`${order.productName ?? '-'}${order.quantity ? ` × ${order.quantity}` : ''}`}
              />
              {isPreparing && <InfoRow label="수거 예정" value={preparedAtStr} />}
              {isHub ? (
                <>
                  <InfoRow label="거점명" value={order.hubName ?? '-'} />
                  <InfoRow label="거점 주소" value={order.hubAddress ?? '-'} />
                </>
              ) : (
                <InfoRow
                  label="배송지"
                  value={order.address ?? order.deliveryAddress?.address ?? '-'}
                />
              )}
              {isPreparing && <InfoRow label="소비자" value={order.buyerName ?? '-'} />}
            </Stack>
          </Card>

          {/* 연락처 */}
          <Card radius="xl" withBorder p="md">
            <Stack gap="sm">
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-bold)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                연락처
              </Text>
              {isPreparing && order.sellerPhone && (
                <ContactRow label="판매자" phone={order.sellerPhone} />
              )}
              {isDelivering && !isHub && order.buyerPhone && (
                <ContactRow label="소비자" phone={order.buyerPhone} />
              )}
              {isDelivering && isHub && order.sellerPhone && (
                <ContactRow label="판매자" phone={order.sellerPhone} />
              )}
            </Stack>
          </Card>

          {isHeld && order.deliveryHold && <DeliveryHoldCard hold={order.deliveryHold} />}

          {paymentPresentation && (
            <Card radius="xl" withBorder p="md">
              <Stack gap="xs">
                <Group justify="space-between" align="center">
                  <Text style={{ fontWeight: 'var(--fw-bold)' }}>재배송비 결제</Text>
                  <Badge color={paymentPresentation.color} variant="light">
                    {paymentPresentation.label}
                  </Badge>
                </Group>
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  {paymentPresentation.description}
                </Text>
              </Stack>
            </Card>
          )}
        </Stack>
      </Box>

      {/* 하단 CTA */}
      <Box style={{ position: 'sticky', bottom: 72, padding: '0 16px 16px' }}>
        {isHeld &&
          isRoundDirect &&
          (deliveryStartAllowed ? (
            <Button
              fullWidth
              size="lg"
              radius="xl"
              color="brand"
              loading={loading}
              onClick={() => updateStatus('DELIVERING')}
            >
              배송 재개
            </Button>
          ) : (
            <Button fullWidth size="lg" radius="xl" color="gray" disabled>
              {paymentPresentation?.label ?? '배송 재개 불가'}
            </Button>
          ))}
        {(isPreparing || isDelivering) && isRoundDirect && (
          <Stack gap="xs">
            {isPreparing &&
              (deliveryStartAllowed ? (
                <Button
                  fullWidth
                  size="lg"
                  radius="xl"
                  color="brand"
                  loading={loading}
                  onClick={() => updateStatus('DELIVERING')}
                >
                  수거 완료 / 배송 시작
                </Button>
              ) : (
                <Button fullWidth size="lg" radius="xl" color="gray" disabled>
                  {paymentPresentation?.label ?? '배송 시작 불가'}
                </Button>
              ))}
            {isDelivering && (
              <Button
                fullWidth
                size="lg"
                radius="xl"
                color="brand"
                loading={loading}
                onClick={() =>
                  router.push(`/board/${orderId}/photo/round-direct?storeId=${order.storeId}`)
                }
              >
                배송 완료 사진 촬영
              </Button>
            )}
            <Button
              fullWidth
              size="lg"
              radius="xl"
              color="red"
              variant="outline"
              disabled={loading}
              onClick={() => setHoldOpened(true)}
            >
              배송 보류
            </Button>
          </Stack>
        )}
        {isPreparing &&
          !isRoundDirect &&
          (deliveryStartAllowed ? (
            <Button
              fullWidth
              size="lg"
              radius="xl"
              color="brand"
              loading={loading}
              onClick={() => updateStatus('DELIVERING')}
            >
              수거 완료 / 배송 시작
            </Button>
          ) : (
            <Button fullWidth size="lg" radius="xl" color="gray" disabled>
              {paymentPresentation?.label ?? '배송 시작 불가'}
            </Button>
          ))}
        {isDelivering && !isHub && !isRoundDirect && (
          <Button
            fullWidth
            size="lg"
            radius="xl"
            color="brand"
            loading={loading}
            onClick={() => updateStatus('DELIVERED')}
          >
            배송 완료
          </Button>
        )}
        {isDelivering && isHub && (
          <Button
            fullWidth
            size="lg"
            radius="xl"
            color="blue"
            loading={loading}
            onClick={() => router.push(`/board/${orderId}/photo?storeId=${order.storeId}`)}
          >
            거점 도착
          </Button>
        )}
      </Box>

      {isRoundDirect && (
        <DeliveryHoldModal
          opened={holdOpened}
          loading={loading}
          orderId={orderId}
          storeId={order.storeId}
          onClose={() => setHoldOpened(false)}
          onLoading={setLoading}
        />
      )}
    </Box>
  );
}

function DeliveryHoldCard({ hold }: { hold: DeliveryHold }) {
  const fee =
    typeof hold.redeliveryFee === 'number' && hold.redeliveryFee > 0
      ? `${hold.redeliveryFee.toLocaleString('ko-KR')}원`
      : '없음';
  return (
    <Card radius="xl" withBorder p="md">
      <Stack gap="sm">
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-danger)',
          }}
        >
          배송 보류
        </Text>
        <InfoRow label="보류 유형" value={HOLD_REASON_LABEL[hold.reasonCode]} />
        <InfoRow label="보류 사유" value={hold.reasonMessage} />
        <InfoRow label="책임" value={hold.customerResponsible ? '고객 책임' : '판매자 책임'} />
        <InfoRow label="재배송비" value={fee} />
        {hold.nextContactAt && (
          <InfoRow label="다음 연락" value={formatSchedule(hold.nextContactAt)} />
        )}
        {hold.nextDeliveryAt && (
          <InfoRow label="새 배송 예정" value={formatSchedule(hold.nextDeliveryAt)} />
        )}
      </Stack>
    </Card>
  );
}

function formatSchedule(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between" align="flex-start">
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
        {label}
      </Text>{' '}
      <Text
        style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)', maxWidth: '60%' }}
        ta="right"
      >
        {value}
      </Text>
    </Group>
  );
}

function ContactRow({ label, phone }: { label: string; phone: string }) {
  return (
    <Group justify="space-between" align="center">
      <Stack gap={2}>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          {label}
        </Text>
        <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}>
          {phone}
        </Text>
      </Stack>
      <Anchor
        component="a"
        href={`tel:${phone}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          backgroundColor: 'var(--color-primary-surface)',
          color: 'var(--color-primary-dark)',
          fontWeight: 'var(--fw-bold)',
          fontSize: 'var(--font-size-sm)',
          padding: '8px 16px',
          borderRadius: 12,
          textDecoration: 'none',
        }}
      >
        <svg
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
          />
        </svg>
        {label}에게 전화
      </Anchor>
    </Group>
  );
}
