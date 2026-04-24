'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Container, Stack, Title, Text, Button } from '@mantine/core'
import { useOrderStatus } from '@/hooks/useOrderStatus'
import type { OrderStatus } from '@greenhub/shared'

const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: '결제 확인 중...',
  RECRUITING: '공동구매 모집 중',
  ACCEPTED: '주문 접수 완료',
  PREPARING: '상품 준비 중',
  DELIVERING: '배송 중',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '주문 취소',
  REVIEWED: '리뷰 완료',
}

const SUCCESS_STATUSES: OrderStatus[] = ['ACCEPTED', 'RECRUITING']

function OrderSuccessContent() {
  const params = useSearchParams()
  const router = useRouter()
  const { data: session } = useSession()
  const orderId = params.get('orderId')

  const { order, loading, error } = useOrderStatus(orderId, session?.user?.accessToken)

  useEffect(() => {
    if (order?.status === 'CANCELLED') {
      const timer = setTimeout(() => router.replace('/'), 4000)
      return () => clearTimeout(timer)
    }
  }, [order?.status, router])

  if (!orderId) {
    router.replace('/')
    return null
  }

  const isPending = !loading && order?.status === 'PENDING'
  const isSuccess = !loading && order && SUCCESS_STATUSES.includes(order.status)
  const isCancelled = !loading && order?.status === 'CANCELLED'

  return (
    <Container size="sm" px="md" py={60}>
      <Stack align="center" gap="xs">
        {/* 초기 로딩 또는 PENDING */}
        {(loading || isPending) && (
          <>
            <Text size="xl" style={{ fontSize: 56 }}>⏳</Text>
            <Title order={2}>결제 확인 중...</Title>
            <Text style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }} ta="center">
              잠시만 기다려주세요. 결제 완료 후 자동으로 업데이트됩니다.
            </Text>
          </>
        )}

        {/* 성공 */}
        {isSuccess && (
          <>
            <Text style={{ fontSize: 56 }}>✅</Text>
            <Title order={2}>주문이 완료되었습니다</Title>
            <Text style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-primary)' }}>{STATUS_LABELS[order.status]}</Text>
            {order.status === 'RECRUITING' && (
              <Text style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}>공동구매 목표 달성 시 주문이 확정됩니다.</Text>
            )}
            <Text style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }} mt="xs">주문번호: {orderId}</Text>
            <Button color="brand" radius="md" size="md" mt="lg" onClick={() => router.push('/mypage')}>
              주문 내역 보기
            </Button>
            <Button variant="transparent" style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }} onClick={() => router.push('/')}>
              홈으로
            </Button>
          </>
        )}

        {/* 취소 */}
        {isCancelled && (
          <>
            <Text style={{ fontSize: 56 }}>❌</Text>
            <Title order={2}>결제가 취소되었습니다</Title>
            <Text style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }} ta="center">
              {order.cancelReason ?? '결제 처리 중 오류가 발생했습니다.'}
            </Text>
            <Text style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}>잠시 후 홈 화면으로 이동합니다.</Text>
          </>
        )}

        {/* Firestore 오류 */}
        {!loading && error && (
          <>
            <Text style={{ fontSize: 56 }}>⚠️</Text>
            <Title order={2}>주문 정보를 불러올 수 없습니다</Title>
            <Text style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}>{error}</Text>
            <Button color="brand" radius="md" mt="md" onClick={() => router.push('/')}>
              홈으로
            </Button>
          </>
        )}
      </Stack>
    </Container>
  )
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={<Container size="sm" px="md" py={60}><Text ta="center">로딩 중...</Text></Container>}>
      <OrderSuccessContent />
    </Suspense>
  )
}
