'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useOrders, TAB_STATUSES } from '@/hooks/useOrders'
import type { Order, OrderStatus } from '@greenhub/shared'
import {
  Badge,
  Box,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core'

type StatusTab = 'pending' | 'preparing' | 'delivering' | 'done' | 'cancelled'

const TABS: { key: StatusTab; label: string }[] = [
  { key: 'pending', label: '처리 필요' },
  { key: 'preparing', label: '준비 중' },
  { key: 'delivering', label: '배송 중' },
  { key: 'done', label: '완료' },
  { key: 'cancelled', label: '취소' },
]

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: '대기',
  RECRUITING: '모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '결제 완료',
  PREPARING: '준비 중',
  DELIVERING: '배송 중',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '취소',
  REVIEWED: '구매 확정',
}

const STATUS_COLOR: Record<OrderStatus, string> = {
  ACCEPTED: 'orange',
  CONFIRMED: 'orange',
  RECRUITING: 'orange',
  PREPARING: 'blue',
  DELIVERING: 'violet',
  HUB_ARRIVED: 'violet',
  CANCELLED: 'red',
  PENDING: 'gray',
  DELIVERED: 'green',
  PICKED_UP: 'green',
  REVIEWED: 'green',
}

const DELIVERY_LABEL: Record<string, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
}

function formatRelativeTime(iso: unknown): string {
  const date = iso && typeof iso === 'object' && 'toDate' in iso
    ? (iso as { toDate(): Date }).toDate()
    : new Date(iso as string)
  const diff = Date.now() - date.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  return `${Math.floor(hr / 24)}일 전`
}

export default function OrdersPage() {
  const { data: session } = useSession()
  const storeId = session?.user.storeId ?? null
  const { orders, loading, error, counts } = useOrders(storeId)
  const [activeTab, setActiveTab] = useState<StatusTab>('pending')

  const filteredOrders = orders.filter((o) =>
    TAB_STATUSES[activeTab].includes(o.status)
  )

  return (
    <Box component="main" style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-gray-0)' }}>
      {/* 헤더 */}
      <Box
        component="header"
        style={{
          backgroundColor: 'var(--mantine-color-white)',
          borderBottom: '1px solid var(--mantine-color-gray-1)',
          padding: '16px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Container size="sm">
          <Group justify="space-between">
            <Title order={3}>주문 관리</Title>
            <Group gap={6}>
              {loading ? (
                <Box style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#FACC15' }} />
              ) : error ? (
                <Box style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#F87171' }} />
              ) : (
                <Box style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#22C55E' }} />
              )}
              <Text size="xs" c="dimmed">
                {loading ? '연결 중' : error ? '연결 오류' : '실시간 연결'}
              </Text>
            </Group>
          </Group>
        </Container>
      </Box>

      {/* 상태 탭 */}
      <Box
        style={{
          backgroundColor: 'var(--mantine-color-white)',
          borderBottom: '1px solid var(--mantine-color-gray-1)',
          position: 'sticky',
          top: 57,
          zIndex: 10,
        }}
      >
        <Container size="sm">
          <Group gap={0} style={{ overflowX: 'auto', flexWrap: 'nowrap' }}>
            {TABS.map((tab) => (
              <UnstyledButton
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flexShrink: 0,
                  padding: '12px 16px',
                  fontSize: 14,
                  fontWeight: 500,
                  borderBottom: `2px solid ${activeTab === tab.key ? 'var(--green-primary)' : 'transparent'}`,
                  color: activeTab === tab.key ? 'var(--green-primary)' : 'var(--mantine-color-gray-6)',
                }}
              >
                {tab.label}
                {counts[tab.key] > 0 && (
                  <Badge
                    size="xs"
                    ml={6}
                    color={tab.key === 'pending' ? 'red' : 'gray'}
                  >
                    {counts[tab.key]}
                  </Badge>
                )}
              </UnstyledButton>
            ))}
          </Group>
        </Container>
      </Box>

      {/* 주문 목록 */}
      <Container size="sm" px="md" py="md">
        <Stack gap="sm">
          {loading && (
            <Group justify="center" py={80}>
              <Loader size="sm" color="var(--green-primary)" />
            </Group>
          )}

          {!loading && filteredOrders.length === 0 && (
            <Stack align="center" justify="center" py={80} c="dimmed">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <Text size="sm">현재 해당 주문이 없습니다</Text>
            </Stack>
          )}

          {filteredOrders.map((order) => (
            <OrderCard key={order.id} order={order} storeId={storeId} />
          ))}
        </Stack>
      </Container>
    </Box>
  )
}

function OrderCard({ order, storeId }: { order: Order; storeId: string | null }) {
  const router = useRouter()
  const { data: session } = useSession()
  const [actionLoading, setActionLoading] = useState(false)
  const [showPrepareForm, setShowPrepareForm] = useState(false)
  const [preparedAtInput, setPreparedAtInput] = useState('')

  async function handleStatusChange(status: OrderStatus, extra?: { cancelReason?: string; preparedAt?: string }) {
    setActionLoading(true)
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/stores/${storeId}/orders/${order.id}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.user.accessToken}`,
          },
          body: JSON.stringify({ status, ...extra }),
        }
      )
    } finally {
      setActionLoading(false)
    }
  }

  async function handlePrepare() {
    const extra = preparedAtInput
      ? { preparedAt: new Date(preparedAtInput).toISOString() }
      : undefined
    await handleStatusChange('PREPARING', extra)
    setShowPrepareForm(false)
    setPreparedAtInput('')
  }

  async function handleCancel() {
    const reason = prompt('취소 사유를 입력하세요 (필수)')
    if (!reason) return
    await handleStatusChange('CANCELLED', { cancelReason: reason })
  }

  const canPrepare = order.status === 'ACCEPTED' || order.status === 'CONFIRMED'
  const canCancel = order.status === 'ACCEPTED' || order.status === 'CONFIRMED' || order.status === 'PREPARING'

  return (
    <Paper
      radius="lg"
      shadow="xs"
      p="md"
      style={{ cursor: 'pointer' }}
      onClick={() => router.push(`/orders/${order.id}`)}
    >
      {/* 상단: 상태 뱃지 + 시간 */}
      <Group justify="space-between" mb="xs">
        <Badge color={STATUS_COLOR[order.status]} variant="light" radius="xl">
          {STATUS_LABEL[order.status]}
        </Badge>
        <Text size="xs" c="dimmed">{formatRelativeTime(order.createdAt)}</Text>
      </Group>

      {/* 주문 정보 */}
      <Text fw={600} size="sm" mb={4}>
        주문 #{order.id.slice(-6).toUpperCase()}
      </Text>
      <Text size="sm" c="dimmed" mb={4}>
        {DELIVERY_LABEL[order.deliveryMethod]}
        {order.requestedDeliveryDate && ` · ${order.requestedDeliveryDate}`}
      </Text>
      <Text fw={700} mb="sm">
        ₩{order.totalAmount.toLocaleString()}
      </Text>

      {/* 준비 시작 폼 */}
      {showPrepareForm && (
        <Paper
          p="sm"
          radius="md"
          mb="sm"
          style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Text size="xs" c="dimmed" mb="xs">드라이버 수거 예정 시간 (선택)</Text>
          <input
            type="datetime-local"
            value={preparedAtInput}
            onChange={(e) => setPreparedAtInput(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid var(--mantine-color-gray-3)',
              borderRadius: 8,
              fontSize: 14,
              marginBottom: 8,
            }}
          />
          <Group gap="xs">
            <Button
              onClick={handlePrepare}
              disabled={actionLoading}
              flex={1}
              size="sm"
              radius="xl"
              style={{ backgroundColor: 'var(--green-primary)' }}
            >
              확인
            </Button>
            <Button
              onClick={() => { setShowPrepareForm(false); setPreparedAtInput('') }}
              flex={1}
              size="sm"
              radius="xl"
              variant="outline"
              color="gray"
            >
              취소
            </Button>
          </Group>
        </Paper>
      )}

      {/* 액션 버튼 */}
      {!showPrepareForm && (canPrepare || canCancel) && (
        <Group gap="xs" onClick={(e) => e.stopPropagation()}>
          {canPrepare && (
            <Button
              onClick={() => setShowPrepareForm(true)}
              disabled={actionLoading}
              flex={1}
              size="sm"
              radius="xl"
              style={{ backgroundColor: 'var(--green-primary)' }}
            >
              준비 시작
            </Button>
          )}
          {canCancel && (
            <Button
              onClick={handleCancel}
              disabled={actionLoading}
              flex={1}
              size="sm"
              radius="xl"
              variant="outline"
              color="red"
            >
              강제 취소
            </Button>
          )}
        </Group>
      )}

      {order.status === 'HUB_ARRIVED' && order.pickupCode && (
        <Paper
          mt="xs"
          p="sm"
          radius="md"
          style={{ backgroundColor: 'var(--green-bg)', textAlign: 'center' }}
        >
          <Text size="xs" c="dimmed" mb={4}>픽업 코드</Text>
          <Text fz={24} fw={700} style={{ letterSpacing: '0.2em', color: 'var(--green-primary)' }}>
            {order.pickupCode}
          </Text>
        </Paper>
      )}
    </Paper>
  )
}
