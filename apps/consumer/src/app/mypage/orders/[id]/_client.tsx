'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Container, Box, Text, Title, Button, Paper, Stack } from '@mantine/core'
import { useOrderStatus } from '@/hooks/useOrderStatus'
import type { Order, OrderStatus } from '@greenhub/shared'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

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

function getTimelineSteps(order: Order): OrderStatus[] {
  if (order.saleType === 'group') {
    return ['RECRUITING', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'DELIVERED']
  }
  if (order.deliveryMethod === 'hub') {
    return ['ACCEPTED', 'PREPARING', 'DELIVERING', 'HUB_ARRIVED', 'PICKED_UP']
  }
  return ['ACCEPTED', 'PREPARING', 'DELIVERING', 'DELIVERED']
}

function getCurrentStepIndex(steps: OrderStatus[], status: OrderStatus): number {
  if (status === 'REVIEWED') return steps.length
  return steps.indexOf(status)
}

function TimelineStep({
  label,
  state,
  isLast,
}: {
  label: string
  state: 'done' | 'current' | 'pending'
  isLast: boolean
}) {
  const circleColor =
    state === 'done' ? 'var(--green-primary)' : state === 'current' ? 'var(--green-primary)' : '#e0e0e0'
  const textColor =
    state === 'done' ? 'var(--green-primary)' : state === 'current' ? '#111' : '#aaa'

  return (
    <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <Box style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <Box
          style={{
            width: 22, height: 22, borderRadius: '50%', background: circleColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: state === 'current' ? '3px solid var(--green-primary)' : 'none',
            boxSizing: 'border-box',
          }}
        >
          {state === 'done' && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
          {state === 'current' && (
            <Box style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />
          )}
        </Box>
        {!isLast && (
          <Box
            style={{
              width: 2, height: 32,
              background: state === 'done' ? 'var(--green-primary)' : '#e0e0e0',
              marginTop: 2,
            }}
          />
        )}
      </Box>
      <Box style={{ paddingTop: 2, paddingBottom: isLast ? 0 : 32 }}>
        <Text size="sm" style={{ color: textColor, fontWeight: state === 'current' ? 700 : 400 }}>
          {label}
        </Text>
      </Box>
    </Box>
  )
}

function PickupCodeCard({ code, address }: { code: string; address: string }) {
  return (
    <Paper
      radius="md"
      p="md"
      mb="md"
      ta="center"
      style={{ border: '2px solid var(--green-primary)', background: '#f0faf4' }}
    >
      <Text size="sm" fw={600} c="brand.6" mb="xs">픽업 코드</Text>
      <Text style={{ fontSize: 32, fontWeight: 800, letterSpacing: 6, color: '#111' }}>{code}</Text>
      <Text size="xs" c="gray.6" mt="xs">수령 장소: {address}</Text>
      <Text size="xs" c="gray.5" mt={4}>코드를 제시하고 수령하세요</Text>
    </Paper>
  )
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: orderId } = use(params)
  const router = useRouter()
  const { data: session } = useSession()
  const { order, loading, error } = useOrderStatus(orderId, session?.user?.accessToken)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  async function handleConfirm() {
    if (!session?.user?.accessToken || !order) return
    setConfirming(true)
    try {
      const res = await fetch(`${API_URL}/stores/${order.storeId}/orders/${orderId}/review`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.user.accessToken}`,
        },
      })
      if (res.ok) setConfirmed(true)
    } finally {
      setConfirming(false)
    }
  }

  if (loading) {
    return <Box py={60} ta="center"><Text c="gray.4">로딩 중...</Text></Box>
  }

  if (error || !order) {
    return (
      <Container size="sm" px="md" py="lg">
        <Button variant="transparent" c="gray.5" onClick={() => router.push('/mypage')} pl={0} mb="md">← 뒤로</Button>
        <Text ta="center" c="red.7" py={40} size="sm">주문 정보를 불러올 수 없습니다.</Text>
      </Container>
    )
  }

  const steps = getTimelineSteps(order)
  const isCancelled = order.status === 'CANCELLED'
  const isReviewable =
    !confirmed &&
    order.status !== 'REVIEWED' &&
    (order.status === 'DELIVERED' || order.status === 'PICKED_UP')
  const currentIdx = getCurrentStepIndex(steps, order.status)
  const showPickupCode =
    order.pickupCode &&
    (order.status === 'HUB_ARRIVED' || order.status === 'PICKED_UP' || order.status === 'REVIEWED')

  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      {/* 헤더 */}
      <Button variant="transparent" c="gray.5" onClick={() => router.push('/mypage')} pl={0} mb="sm">← 뒤로</Button>
      <Title order={3} mb={4}>주문 상세</Title>
      <Text size="xs" c="gray.4" mb="lg">주문번호: {orderId}</Text>

      {/* 주문 정보 요약 */}
      <Paper bg="gray.0" radius="md" p="md" mb="lg">
        <Stack gap={4}>
          <Text size="sm" c="gray.5">
            <Text span fw={600} c="dark">배송 방식</Text>:{' '}
            {order.deliveryMethod === 'hub' ? '거점 픽업' : order.deliveryMethod === 'parcel' ? '택배' : '직배송'}
            {order.saleType === 'group' && ' (공동구매)'}
          </Text>
          {order.deliveryAddress?.address && (
            <Text size="sm" c="gray.5">
              <Text span fw={600} c="dark">배송지</Text>: {order.deliveryAddress.address}{' '}
              {order.deliveryAddress.addressDetail}
            </Text>
          )}
          {order.requestedDeliveryDate && (
            <Text size="sm" c="gray.5">
              <Text span fw={600} c="dark">배송 희망일</Text>: {order.requestedDeliveryDate}
            </Text>
          )}
          <Text size="sm" c="gray.5">
            <Text span fw={600} c="dark">결제 금액</Text>: {order.totalAmount.toLocaleString('ko-KR')}원
          </Text>
        </Stack>
      </Paper>

      {/* 공동구매 모집 중 안내 */}
      {order.status === 'RECRUITING' && (
        <Paper radius="md" p="md" mb="lg" style={{ background: '#EBF5FB', border: '1px solid #AED6F1' }}>
          <Text fw={700} c="blue.8" mb={4}>공동구매 모집 중</Text>
          <Text size="sm" c="gray.7" style={{ lineHeight: 1.6 }}>
            모집 마감일까지 참여 인원이 충족되면 주문이 확정됩니다.
            확정 이후에는 취소·환불이 불가합니다.
          </Text>
          <Text size="xs" c="gray.5" mt="xs">
            모집 마감 후 인원 미달 시 자동으로 취소되고 전액 환불됩니다.
          </Text>
        </Paper>
      )}

      {/* 취소 상태 */}
      {isCancelled && (
        <Paper radius="md" p="md" mb="lg" ta="center" style={{ background: '#fff3f3', border: '1px solid #ffcdd2' }}>
          <Text size="xl" mb="xs">❌</Text>
          <Text fw={700} c="red.7" mb={4}>주문이 취소되었습니다</Text>
          {order.cancelReason && <Text size="sm" c="gray.5">사유: {order.cancelReason}</Text>}
        </Paper>
      )}

      {/* 픽업 코드 */}
      {showPickupCode && (
        <PickupCodeCard code={order.pickupCode!} address={order.deliveryAddress?.address ?? ''} />
      )}

      {/* 구매 확정 버튼 */}
      {(isReviewable || confirmed) && (
        <Button
          fullWidth
          radius="md"
          size="md"
          mb="lg"
          disabled={confirming || confirmed}
          loading={confirming}
          variant={confirmed ? 'outline' : 'filled'}
          color="brand"
          onClick={handleConfirm}
        >
          {confirmed ? '✓ 구매 확정 완료' : '구매 확정'}
        </Button>
      )}

      {/* 상태 타임라인 */}
      {!isCancelled && (
        <Box>
          <Text fw={700} size="sm" mb="md">배송 현황</Text>
          <Box pl={4}>
            {steps.map((stepStatus, idx) => {
              const state = idx < currentIdx ? 'done' : idx === currentIdx ? 'current' : 'pending'
              const label =
                stepStatus === 'DELIVERED' && order.status === 'REVIEWED'
                  ? '배송 완료 · 구매 확정'
                  : (STATUS_LABELS[stepStatus] ?? stepStatus)
              return (
                <TimelineStep
                  key={stepStatus}
                  label={label}
                  state={state}
                  isLast={idx === steps.length - 1}
                />
              )
            })}
          </Box>
        </Box>
      )}
    </Container>
  )
}
