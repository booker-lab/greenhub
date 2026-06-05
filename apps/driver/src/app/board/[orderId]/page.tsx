'use client';

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
import { doc, onSnapshot } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { use, useEffect, useState } from 'react';
import { useFirebaseAuth } from '@/hooks/useFirebaseAuth';
import { apiFetch } from '@/lib/api';
import { db } from '@/lib/firebase';
import {
  DETAIL_METHOD_LABEL,
  type DriverOrderDetail,
  formatPreparedTime,
  getDeliveryAddress,
  getDetailCta,
  getProductSummary,
  getVisibleContacts,
  isDetailDelivering,
  isDetailPreparing,
  isHubOrder,
} from './_lib';

export default function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const { data: session } = useSession();
  const router = useRouter();
  const { firebaseReady } = useFirebaseAuth();
  const [order, setOrder] = useState<DriverOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!firebaseReady) return;

    const unsub = onSnapshot(doc(db, 'orders', orderId), (snap) => {
      if (snap.exists()) setOrder({ id: snap.id, ...snap.data() } as DriverOrderDetail);
    });
    return unsub;
  }, [orderId, firebaseReady]);

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
      if (status === 'DELIVERED' || status === 'HUB_ARRIVED') {
        router.replace('/board?tab=preparing');
      }
    } catch {
      notifications.show({ color: 'red', message: '오류가 발생했습니다. 다시 시도해주세요.' });
    } finally {
      setLoading(false);
    }
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
        <Loader color="brand" />
      </Box>
    );
  }

  const isDelivering = isDetailDelivering(order);
  const isPreparing = isDetailPreparing(order);
  const isHub = isHubOrder(order);
  const contacts = getVisibleContacts(order);
  const cta = getDetailCta(order);

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
            {DETAIL_METHOD_LABEL[order.deliveryMethod] ?? order.deliveryMethod}
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
              <InfoRow label="상품" value={getProductSummary(order)} />
              {isPreparing && (
                <InfoRow label="수거 예정" value={formatPreparedTime(order.preparedAt)} />
              )}
              {isHub ? (
                <>
                  <InfoRow label="거점명" value={order.hubName ?? '-'} />
                  <InfoRow label="거점 주소" value={order.hubAddress ?? '-'} />
                </>
              ) : (
                <InfoRow label="배송지" value={getDeliveryAddress(order)} />
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
              {contacts.map((contact) => (
                <ContactRow key={`${contact.label}-${contact.phone}`} {...contact} />
              ))}
            </Stack>
          </Card>
        </Stack>
      </Box>

      {/* 하단 CTA */}
      <Box style={{ position: 'sticky', bottom: 72, padding: '0 16px 16px' }}>
        {cta.kind === 'start-delivery' && (
          <Button
            fullWidth
            size="lg"
            radius="xl"
            color={cta.color}
            loading={loading}
            onClick={() => updateStatus(cta.status)}
          >
            {cta.label}
          </Button>
        )}
        {cta.kind === 'complete-direct' && (
          <Button
            fullWidth
            size="lg"
            radius="xl"
            color={cta.color}
            loading={loading}
            onClick={() => updateStatus(cta.status)}
          >
            {cta.label}
          </Button>
        )}
        {cta.kind === 'hub-photo' && (
          <Button
            fullWidth
            size="lg"
            radius="xl"
            color={cta.color}
            loading={loading}
            onClick={() => router.push(`/board/${orderId}/photo?storeId=${order.storeId}`)}
          >
            {cta.label}
          </Button>
        )}
      </Box>
    </Box>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between" align="flex-start">
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
        {label}
      </Text>
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
        전화
      </Anchor>
    </Group>
  );
}
