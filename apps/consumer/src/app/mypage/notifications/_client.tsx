'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Box, Group, Text, Button, Stack, Alert } from '@mantine/core'
import { useNotifications } from '@/hooks/useNotifications'
import type { Notification, NotificationTemplateCode } from '@greenhub/shared'

const TEMPLATE_LABELS: Record<NotificationTemplateCode, string> = {
  ORDER_ACCEPTED: '결제 완료',
  ORDER_PREPARING: '상품 준비 중',
  ORDER_DELIVERING: '배송 시작',
  ORDER_HUB_ARRIVED: '거점 도착',
  ORDER_DELIVERED: '배송 완료',
  ORDER_CANCELLED: '주문 취소',
  GROUP_JOINED: '공동구매 참여',
  GROUP_DEADLINE_SOON: '공동구매 마감 임박',
  GROUP_CONFIRMED: '공동구매 확정',
  GROUP_CANCELLED_LACK: '공동구매 취소 (인원 미달)',
  GROUP_CANCELLED_SELF: '공동구매 취소',
  GROUP_PREPARING: '공동구매 준비 중',
  GROUP_DELIVERING: '공동구매 배송 시작',
  GROUP_DELIVERED: '공동구매 배송 완료',
}

const TEMPLATE_ICONS: Record<NotificationTemplateCode, string> = {
  ORDER_ACCEPTED: '✅',
  ORDER_PREPARING: '📦',
  ORDER_DELIVERING: '🚚',
  ORDER_HUB_ARRIVED: '📍',
  ORDER_DELIVERED: '🎉',
  ORDER_CANCELLED: '❌',
  GROUP_JOINED: '👥',
  GROUP_DEADLINE_SOON: '⏰',
  GROUP_CONFIRMED: '✅',
  GROUP_CANCELLED_LACK: '❌',
  GROUP_CANCELLED_SELF: '❌',
  GROUP_PREPARING: '📦',
  GROUP_DELIVERING: '🚚',
  GROUP_DELIVERED: '🎉',
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60_000) return '방금 전'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

function extractProductName(n: Notification): string | null {
  try {
    const vars = JSON.parse(n.message) as Record<string, string>
    return vars['productName'] ?? null
  } catch {
    return null
  }
}

function NotificationItem({
  notification,
  isRead,
  onRead,
  onOrderClick,
}: {
  notification: Notification
  isRead: boolean
  onRead: () => void
  onOrderClick: () => void
}) {
  const label = TEMPLATE_LABELS[notification.templateCode] ?? notification.templateCode
  const icon = TEMPLATE_ICONS[notification.templateCode] ?? '🔔'
  const productName = extractProductName(notification)
  const date = formatDate(notification.sentAt ?? notification.createdAt)

  return (
    <Box
      onClick={() => { onRead(); if (notification.orderId) onOrderClick() }}
      style={{
        display: 'flex', gap: 12, padding: '14px 16px',
        background: isRead ? '#fff' : '#F0F7F4',
        borderBottom: '1px solid #f0f0f0',
        cursor: notification.orderId ? 'pointer' : 'default',
      }}
    >
      {/* 아이콘 */}
      <Box
        style={{
          width: 36, height: 36, borderRadius: '50%', background: '#e8f5e9',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, flexShrink: 0,
        }}
      >
        {icon}
      </Box>

      {/* 내용 */}
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Group justify="space-between" gap="xs" align="flex-start">
          <Text size="xs" fw={isRead ? 500 : 700} c="dark">{label}</Text>
          <Text size="xs" c="gray.4" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{date}</Text>
        </Group>
        {productName && <Text size="xs" c="gray.5" mt={3}>{productName}</Text>}
        {notification.orderId && <Text size="xs" c="brand.6" mt={3}>주문 상세 보기 ›</Text>}
      </Box>

      {/* 안읽음 점 */}
      {!isRead && (
        <Box
          style={{
            width: 7, height: 7, borderRadius: '50%',
            background: 'var(--green-primary)', flexShrink: 0, marginTop: 6,
          }}
        />
      )}
    </Box>
  )
}

export default function NotificationsClient() {
  const { status } = useSession()
  const router = useRouter()
  const { notifications, readIds, loading, error, markAllRead, markRead } = useNotifications()

  useEffect(() => {
    if (!loading && notifications.length > 0) {
      markAllRead()
    }
  }, [loading, notifications.length, markAllRead])

  if (status === 'unauthenticated') {
    router.replace('/login')
    return null
  }

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length

  return (
    <Box style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 80 }}>
      {/* 헤더 */}
      <Group
        px="md"
        pt="lg"
        pb="sm"
        gap="xs"
        style={{
          position: 'sticky', top: 0, background: '#fff', zIndex: 10,
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <Button variant="transparent" c="dark" pl={0} onClick={() => router.back()} style={{ fontSize: 20 }}>←</Button>
        <Text fw={700} size="lg" style={{ flex: 1 }}>알림 내역</Text>
        {unreadCount > 0 && (
          <Button variant="transparent" size="xs" c="brand.6" onClick={markAllRead}>모두 읽음</Button>
        )}
      </Group>

      {/* 오류 */}
      {error && (
        <Alert color="red" variant="light" m="md">
          <Text size="sm">{error}</Text>
        </Alert>
      )}

      {/* 로딩 */}
      {loading && <Text ta="center" c="gray.4" py={60} size="sm">불러오는 중...</Text>}

      {/* 빈 상태 */}
      {!loading && !error && notifications.length === 0 && (
        <Stack align="center" py={60} px="lg">
          <Text size="xl">🔔</Text>
          <Text size="sm" c="gray.4">알림 내역이 없습니다.</Text>
        </Stack>
      )}

      {/* 목록 */}
      {!loading && notifications.length > 0 && (
        <Box>
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
  )
}
