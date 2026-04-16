'use client'

import { useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Container, Box, Title, Text, Paper, Group, Stack, Button, UnstyledButton, Divider } from '@mantine/core'
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

type StatusColorKey = { bg: string; text: string }
const STATUS_COLORS: Partial<Record<OrderStatus, StatusColorKey>> = {
  PENDING:    { bg: 'var(--mantine-color-gray-1)',   text: 'var(--mantine-color-gray-6)' },
  RECRUITING: { bg: 'var(--mantine-color-blue-0)',   text: 'var(--mantine-color-blue-7)' },
  CONFIRMED:  { bg: 'var(--mantine-color-blue-0)',   text: 'var(--mantine-color-blue-7)' },
  ACCEPTED:   { bg: 'var(--mantine-color-brand-0)',  text: 'var(--mantine-color-brand-7)' },
  PREPARING:  { bg: 'var(--mantine-color-brand-0)',  text: 'var(--mantine-color-brand-7)' },
  DELIVERING: { bg: 'var(--mantine-color-orange-0)', text: 'var(--mantine-color-orange-7)' },
  HUB_ARRIVED:{ bg: 'var(--mantine-color-orange-0)', text: 'var(--mantine-color-orange-7)' },
  PICKED_UP:  { bg: 'var(--mantine-color-brand-0)',  text: 'var(--mantine-color-brand-7)' },
  DELIVERED:  { bg: 'var(--mantine-color-brand-0)',  text: 'var(--mantine-color-brand-7)' },
  CANCELLED:  { bg: 'var(--mantine-color-red-0)',    text: 'var(--mantine-color-red-7)' },
  REVIEWED:   { bg: 'var(--mantine-color-gray-1)',   text: 'var(--mantine-color-gray-6)' },
}

const ACCENT_COLORS: Partial<Record<OrderStatus, string>> = {
  PENDING:    'var(--mantine-color-gray-4)',
  RECRUITING: 'var(--mantine-color-blue-5)',
  CONFIRMED:  'var(--mantine-color-blue-5)',
  ACCEPTED:   'var(--mantine-color-brand-5)',
  PREPARING:  'var(--mantine-color-brand-5)',
  DELIVERING: 'var(--mantine-color-orange-5)',
  HUB_ARRIVED:'var(--mantine-color-orange-5)',
  PICKED_UP:  'var(--mantine-color-brand-5)',
  DELIVERED:  'var(--mantine-color-brand-5)',
  CANCELLED:  'var(--mantine-color-red-5)',
  REVIEWED:   'var(--mantine-color-gray-4)',
}

function formatDate(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

function OrderCard({ order, onClick }: { order: Order; onClick: () => void }) {
  const colorScheme = STATUS_COLORS[order.status] ?? { bg: 'var(--mantine-color-gray-1)', text: 'var(--mantine-color-gray-6)' }
  const accentColor = ACCENT_COLORS[order.status] ?? 'var(--mantine-color-gray-4)'
  const label = STATUS_LABELS[order.status] ?? order.status

  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        background: '#fff',
        border: '1px solid var(--mantine-color-gray-2)',
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      <Group justify="space-between" mb={8}>
        <Box
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: colorScheme.text,
            background: colorScheme.bg,
            padding: '3px 10px',
            borderRadius: 20,
          }}
        >
          {label}
        </Box>
        <Text size="xs" c="gray.4">{formatDate(order.createdAt)}</Text>
      </Group>
      <Text size="sm" fw={600} c="dark" mb={4}>
        {order.saleType === 'group' ? '[공동구매] ' : ''}
        {order.deliveryMethod === 'hub' ? '거점 픽업' : order.deliveryMethod === 'parcel' ? '택배' : '직배송'}
      </Text>
      <Group justify="space-between">
        <Text size="xs" c="gray.5">수량 {order.quantity}개</Text>
        <Text size="sm" fw={700} c="dark">{order.totalAmount.toLocaleString('ko-KR')}원</Text>
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
      <Box
        mb="xl"
        p="lg"
        style={{
          background: 'var(--mantine-color-brand-0)',
          borderRadius: 'var(--mantine-radius-md)',
        }}
      >
        <Group justify="space-between" align="flex-start">
          <Box>
            <Title order={4} fw={700} c="dark" mb={4}>{session.user?.name ?? '사용자'}</Title>
            <Text size="sm" c="gray.6">{session.user?.email}</Text>
          </Box>
          <Button
            variant="default"
            size="xs"
            radius="sm"
            onClick={() => signOut({ callbackUrl: '/' })}
          >
            로그아웃
          </Button>
        </Group>
      </Box>

      {/* 주문 내역 */}
      <Box mb="xl">
        <Stack gap={4} mb="md">
          <Title order={5} fw={700} c="dark">주문 내역</Title>
          <Divider />
        </Stack>
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

      {/* 메뉴 */}
      <Box mb="xl">
        <Stack gap={4} mb="md">
          <Title order={5} fw={700} c="dark">내 정보</Title>
          <Divider />
        </Stack>
        <Stack gap="xs">
          <UnstyledButton
            onClick={() => router.push('/mypage/notifications')}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              background: '#fff',
              border: '1px solid var(--mantine-color-gray-2)',
              borderRadius: 10,
              padding: '14px 16px',
            }}
          >
            <Text size="sm" fw={500} c="dark">알림 내역</Text>
            <Text c="gray.4" size="md">›</Text>
          </UnstyledButton>
          <UnstyledButton
            onClick={() => router.push('/mypage/addresses')}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              background: '#fff',
              border: '1px solid var(--mantine-color-gray-2)',
              borderRadius: 10,
              padding: '14px 16px',
            }}
          >
            <Text size="sm" fw={500} c="dark">배송지 목록 · 추가 · 수정</Text>
            <Text c="gray.4" size="md">›</Text>
          </UnstyledButton>
        </Stack>
      </Box>

      {/* 앱 설치 */}
      <Box>
        <Stack gap={4} mb="md">
          <Title order={5} fw={700} c="dark">앱 설치</Title>
          <Divider />
        </Stack>
        <A2HSButton />
      </Box>
    </Container>
  )
}
