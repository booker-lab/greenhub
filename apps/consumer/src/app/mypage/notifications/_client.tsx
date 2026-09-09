'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Box, Group, Text, Button, Stack, Alert } from '@mantine/core';
import { ChevronLeft } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import type { Notification, NotificationTemplateCode } from '@greenhub/shared';

const TEMPLATE_LABELS: Record<NotificationTemplateCode, string> = {
  ORDER_ACCEPTED: '결제 완료',
  ORDER_PREPARING: '상품 준비 중',
  ORDER_DELIVERING: '배송 시작',
  ORDER_DELIVERY_HELD: '배송 보류',
  ORDER_REDELIVERY_PAYMENT_REQUESTED: '재배송비 결제 요청',
  ORDER_REDELIVERY_SCHEDULED: '재배송 예정',
  ORDER_HUB_ARRIVED: '거점 도착',
  ORDER_DELIVERED: '배송 완료',
  ORDER_CANCELLED: '주문 취소',
  ROUND_ORDER_CONFIRMED: '회차 주문 확정',
  OPERATION_ISSUE_CREATED: '주문 처리 확인 필요',
  CUSTOMER_NOTICE_FAILED: '안내 전송 실패',
  GROUP_JOINED: '공동구매 참여',
  GROUP_DEADLINE_SOON: '공동구매 마감 임박',
  GROUP_CONFIRMED: '공동구매 확정',
  GROUP_CANCELLED_LACK: '공동구매 취소 (인원 미달)',
  GROUP_CANCELLED_SELF: '공동구매 취소',
  GROUP_PREPARING: '공동구매 준비 중',
  GROUP_DELIVERING: '공동구매 배송 시작',
  GROUP_DELIVERED: '공동구매 배송 완료',
};

const TEMPLATE_ICONS: Record<NotificationTemplateCode, string> = {
  ORDER_ACCEPTED: '✅',
  ORDER_PREPARING: '📦',
  ORDER_DELIVERING: '🚚',
  ORDER_DELIVERY_HELD: '⏸️',
  ORDER_REDELIVERY_PAYMENT_REQUESTED: '💳',
  ORDER_REDELIVERY_SCHEDULED: '📅',
  ORDER_HUB_ARRIVED: '📍',
  ORDER_DELIVERED: '🎉',
  ORDER_CANCELLED: '❌',
  ROUND_ORDER_CONFIRMED: '✅',
  OPERATION_ISSUE_CREATED: '⚠️',
  CUSTOMER_NOTICE_FAILED: '📵',
  GROUP_JOINED: '👥',
  GROUP_DEADLINE_SOON: '⏰',
  GROUP_CONFIRMED: '✅',
  GROUP_CANCELLED_LACK: '❌',
  GROUP_CANCELLED_SELF: '❌',
  GROUP_PREPARING: '📦',
  GROUP_DELIVERING: '🚚',
  GROUP_DELIVERED: '🎉',
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return '방금 전';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function extractProductName(n: Notification): string | null {
  try {
    const vars = JSON.parse(n.message) as Record<string, string>;
    return vars.productName ?? null;
  } catch {
    return null;
  }
}

function NotificationItem({
  notification,
  isRead,
  onRead,
  onOrderClick,
}: {
  notification: Notification;
  isRead: boolean;
  onRead: () => void;
  onOrderClick: () => void;
}) {
  const label = TEMPLATE_LABELS[notification.templateCode] ?? notification.templateCode;
  const icon = TEMPLATE_ICONS[notification.templateCode] ?? '🔔';
  const productName = extractProductName(notification);
  const date = formatDate(notification.sentAt ?? notification.createdAt);

  return (
    <Box
      onClick={() => {
        onRead();
        if (notification.orderId) onOrderClick();
      }}
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 16px',
        background: isRead ? 'var(--color-bg)' : 'var(--color-primary-surface)',
        borderBottom: '1px solid var(--color-border)',
        cursor: notification.orderId ? 'pointer' : 'default',
      }}
    >
      <Box
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'var(--color-primary-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>

      <Box style={{ flex: 1, minWidth: 0 }}>
        <Group justify="space-between" gap="xs" align="flex-start">
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: isRead ? 'var(--fw-medium)' : 'var(--fw-bold)',
              color: 'var(--color-text)',
            }}
          >
            {label}
          </Text>
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-disabled)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {date}
          </Text>
        </Group>
        {productName && (
          <Text
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            mt={3}
          >
            {productName}
          </Text>
        )}
        {notification.orderId && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)' }} mt={3}>
            주문 상세 보기 ›
          </Text>
        )}
      </Box>

      {!isRead && (
        <Box
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--color-primary)',
            flexShrink: 0,
            marginTop: 6,
          }}
        />
      )}
    </Box>
  );
}

export default function NotificationsClient() {
  const { status } = useSession();
  const router = useRouter();
  const { notifications, readIds, loading, error, refetch, markAllRead, markRead } =
    useNotifications();

  useEffect(() => {
    // authoritative successful load에서만 자동 읽음 처리한다.
    // stale list + failure 상태에서는 read receipt 의미를 바꾸지 않는다.
    if (!loading && !error && notifications.length > 0) {
      markAllRead();
    }
  }, [loading, error, notifications.length, markAllRead]);

  if (status === 'unauthenticated') {
    router.replace('/login');
    return null;
  }

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  return (
    <Box style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 80 }}>
      <Group
        px="md"
        pt="lg"
        pb="sm"
        gap="xs"
        style={{
          position: 'sticky',
          top: 0,
          background: 'var(--color-bg)',
          zIndex: 10,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <Button
          variant="transparent"
          style={{ color: 'var(--color-text)' }}
          pl={0}
          onClick={() => router.back()}
        >
          <ChevronLeft size={20} />
        </Button>
        <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-lg)', flex: 1 }}>
          알림 내역
        </Text>
        {unreadCount > 0 && (
          <Button
            variant="transparent"
            size="xs"
            style={{ color: 'var(--color-primary)' }}
            onClick={markAllRead}
          >
            모두 읽음
          </Button>
        )}
      </Group>

      {loading && notifications.length === 0 && (
        <Text
          ta="center"
          style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
          py={60}
        >
          불러오는 중...
        </Text>
      )}

      {!loading && error && notifications.length === 0 && (
        <Stack gap="xs" p="md">
          <Alert color="red" variant="light">
            <Text style={{ fontSize: 'var(--font-size-sm)' }}>{error}</Text>
          </Alert>
          <Button
            variant="default"
            size="xs"
            radius="sm"
            onClick={refetch}
            data-testid="notifications-retry"
          >
            다시 시도
          </Button>
        </Stack>
      )}

      {!loading && !error && notifications.length === 0 && (
        <Stack align="center" py={60} px="lg">
          <Text size="xl">🔔</Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            알림 내역이 없습니다.
          </Text>
        </Stack>
      )}

      {notifications.length > 0 && (
        <Box>
          {loading && (
            <Text
              ta="center"
              style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
              py="sm"
            >
              업데이트 중...
            </Text>
          )}
          {error && (
            <Box p="md">
              <Alert color="red" variant="light">
                <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                  최신 알림을 불러오지 못했습니다. 이전 목록을 표시합니다.
                </Text>
                <Text style={{ fontSize: 'var(--font-size-sm)' }} mt={4}>
                  {error}
                </Text>
              </Alert>
              <Button
                variant="default"
                size="xs"
                radius="sm"
                mt="xs"
                onClick={refetch}
                data-testid="notifications-retry"
              >
                다시 시도
              </Button>
            </Box>
          )}
          {notifications.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              isRead={readIds.has(n.id)}
              onRead={() => markRead(n.id)}
              onOrderClick={() => n.orderId && router.push(`/mypage/orders/${n.orderId}`)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
