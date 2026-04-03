'use client'

import { useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Container, Box, Title, Text, Paper, Group, Stack, Button, UnstyledButton } from '@mantine/core'
import { useOrders } from '@/hooks/useOrders'
import A2HSButton from '@/components/A2HSButton'
import type { Order, OrderStatus } from '@greenhub/shared'

const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: '결제 확인 중',
  RECRUITING: '모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '결제 완료',
  PREPARING: '상품 준비 중',
  DELIVERING: '배송 중',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '주문 취소',
  REVIEWED: '구매 확정',
}

const STATUS_COLORS: Partial<Record<OrderStatus, string>> = {
  PENDING: '#999',
  RECRUITING: '#1565C0',
  CONFIRMED: '#1565C0',
  ACCEPTED: '#2D6A4F',
  PREPARING: '#2D6A4F',
  DELIVERING: '#E65100',
  HUB_ARRIVED: '#E65100',
  PICKED_UP: '#2D6A4F',
  DELIVERED: '#2D6A4F',
  CANCELLED: '#C62828',
  REVIEWED: '#555',
}

function formatDate(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

function OrderCard({ order, onClick }: { order: Order; onClick: () => void }) {
  const color = STATUS_COLORS[order.status] ?? '#555'
  const label = STATUS_LABELS[order.status] ?? order.status

  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        background: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      <Group justify="space-between" mb={8}>
        <Box
          style={{
            fontSize: 12,
            fontWeight: 600,
            color,
            background: color + '18',
            padding: '2px 8px',
            borderRadius: 12,
          }}
        >
          {label}
        </Box>
        <Text size="xs" c="gray.4">{formatDate(order.createdAt)}</Text>
      </Group>
      <Text size="sm" c="dark" mb={4}>
        {order.saleType === 'group' ? '[공동구매] ' : ''}
        {order.deliveryMethod === 'hub' ? '거점 픽업' : order.deliveryMethod === 'parcel' ? '택배' : '직배송'}
      </Text>
      <Group justify="space-between">
        <Text size="sm" c="gray.5">수량 {order.quantity}개</Text>
        <Text size="sm" fw={700}>{order.totalAmount.toLocaleString('ko-KR')}원</Text>
      </Group>
    </UnstyledButton>
  )
}

export default function MyPageClient() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { orders, loading, error } = useOrders()

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login')
    }
  }, [status, router])

  if (status === 'loading') {
    return <Box py={60} ta="center"><Text c="gray.4">로딩 중...</Text></Box>
  }

  if (!session) return null

  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      {/* 프로필 */}
      <Box mb="lg">
        <Title order={2} mb="sm">마이페이지</Title>
        <Paper bg="gray.0" radius="md" p="md">
          <Group justify="space-between">
            <Box>
              <Text fw={600} size="md">{session.user?.name ?? '사용자'}</Text>
              <Text size="sm" c="gray.5" mt={2}>{session.user?.email}</Text>
            </Box>
            <Button
              variant="outline"
              color="gray"
              size="xs"
              radius="sm"
              onClick={() => signOut({ callbackUrl: '/' })}
            >
              로그아웃
            </Button>
          </Group>
        </Paper>
      </Box>

      {/* 주문 내역 */}
      <Box mb="lg">
        <Text fw={700} size="md" mb="sm">주문 내역</Text>
        {loading && <Text ta="center" c="gray.4" py="lg" size="sm">불러오는 중...</Text>}
        {!loading && error && <Text c="red.7" size="sm" py="xs">주문 내역을 불러올 수 없습니다.</Text>}
        {!loading && !error && orders.length === 0 && (
          <Text ta="center" c="gray.4" py="xl" size="sm">주문 내역이 없습니다.</Text>
        )}
        {!loading && orders.length > 0 && (
          <Stack gap="sm">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onClick={() => router.push(`/mypage/orders/${order.id}`)}
              />
            ))}
          </Stack>
        )}
      </Box>

      {/* 알림 내역 */}
      <Box mb="lg">
        <Text fw={700} size="md" mb="sm">알림</Text>
        <UnstyledButton
          onClick={() => router.push('/mypage/notifications')}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', background: '#fff', border: '1px solid #e0e0e0',
            borderRadius: 10, padding: '14px 16px',
          }}
        >
          <Text size="sm" c="dark">알림 내역</Text>
          <Text c="gray.4" size="lg">›</Text>
        </UnstyledButton>
      </Box>

      {/* 배송지 관리 */}
      <Box mb="lg">
        <Text fw={700} size="md" mb="sm">배송지 관리</Text>
        <UnstyledButton
          onClick={() => router.push('/mypage/addresses')}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', background: '#fff', border: '1px solid #e0e0e0',
            borderRadius: 10, padding: '14px 16px',
          }}
        >
          <Text size="sm" c="dark">배송지 목록 · 추가 · 수정</Text>
          <Text c="gray.4" size="lg">›</Text>
        </UnstyledButton>
      </Box>

      {/* 앱 설치 */}
      <Box>
        <Text fw={700} size="md" mb="sm">앱 설치</Text>
        <A2HSButton />
      </Box>
    </Container>
  )
}
