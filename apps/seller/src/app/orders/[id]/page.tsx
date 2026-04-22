'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useFirebaseAuth } from '@/hooks/useFirebaseAuth'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { apiFetch } from '@/lib/api'
import type { Order, OrderStatus } from '@greenhub/shared'
import type { GroupProductConfig } from '@greenhub/shared'
import {
  ActionIcon, Badge, Box, Button, Container, Group,
  Loader, Modal, Paper, Stack, Text, Textarea, Title, UnstyledButton,
} from '@mantine/core'
import { Row, STATUS_LABEL_MAP, STATUS_COLOR_MAP, DELIVERY_LABEL_MAP } from './_components/OrderRow'

function toDate(v: unknown): Date {
  if (v && typeof v === 'object' && 'toDate' in v) return (v as { toDate(): Date }).toDate()
  return new Date(v as string)
}

function formatDeadlineCountdown(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now()
  if (diff <= 0) return '마감됨'
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  if (days > 0) return `마감까지 ${days}일`
  return `마감까지 ${hours}시간`
}

const READONLY_STATUSES: OrderStatus[] = [
  'DELIVERING', 'HUB_ARRIVED', 'PICKED_UP', 'DELIVERED', 'REVIEWED', 'CANCELLED',
]
const CANCELLABLE_STATUSES: OrderStatus[] = ['ACCEPTED', 'CONFIRMED', 'PREPARING']

export default function OrderDetailPage() {
  const params = useParams()
  const router = useRouter()
  const orderId = params.id as string
  const { data: session } = useSession()
  const { firebaseReady } = useFirebaseAuth()
  const storeId = session?.user.storeId ?? null
  const token = session?.user.accessToken ?? ''

  const [order, setOrder] = useState<Order | null>(null)
  const [groupConfig, setGroupConfig] = useState<GroupProductConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPrepareForm, setShowPrepareForm] = useState(false)
  const [preparedAtInput, setPreparedAtInput] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  useEffect(() => {
    if (!orderId || !firebaseReady) return
    const ref = doc(db, 'orders', orderId)
    const unsubscribe = onSnapshot(ref, (snap) => {
      if (snap.exists()) setOrder({ id: snap.id, ...snap.data() } as Order)
      setLoading(false)
    })
    return unsubscribe
  }, [orderId, firebaseReady])

  useEffect(() => {
    if (!order || order.saleType !== 'group') return
    const ref = doc(db, 'groupProductConfig', order.productId)
    getDoc(ref).then((snap) => {
      if (snap.exists()) {
        const data = snap.data()
        // Firestore Timestamp → ISO string 변환
        if (data.recruitDeadline?.toDate) data.recruitDeadline = data.recruitDeadline.toDate().toISOString()
        if (data.groupDeliveryDate?.toDate) data.groupDeliveryDate = data.groupDeliveryDate.toDate().toISOString()
        setGroupConfig(data as GroupProductConfig)
      }
    })
  }, [order?.productId, order?.saleType])

  useEffect(() => {
    if (!showPrepareForm || !order) return
    if (preparedAtInput) return
    const baseDate =
      order.saleType === 'normal'
        ? order.requestedDeliveryDate
        : groupConfig?.groupDeliveryDate?.slice(0, 10)
    if (baseDate) setPreparedAtInput(`${baseDate.slice(0, 10)}T09:00`)
  }, [showPrepareForm, order, groupConfig, preparedAtInput])

  async function handlePrepare() {
    if (!storeId || !order) return
    setActionLoading(true)
    setActionError(null)
    try {
      const body: Record<string, string> = { status: 'PREPARING' }
      if (preparedAtInput) body.preparedAt = new Date(preparedAtInput).toISOString()
      const res = await apiFetch(`/stores/${storeId}/orders/${order.id}/status`, token,
        { method: 'PATCH', body: JSON.stringify(body) })
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
      setShowPrepareForm(false)
      setPreparedAtInput('')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '오류가 발생했습니다')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleCancel() {
    if (!storeId || !order) return
    if (cancelReason.trim().length < 5) return
    setActionLoading(true)
    setActionError(null)
    try {
      const res = await apiFetch(`/stores/${storeId}/orders/${order.id}/status`, token,
        { method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED', reason: cancelReason.trim() }) })
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
      setShowCancelModal(false)
      setCancelReason('')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '오류가 발생했습니다')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <Box style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-gray-0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader size="sm" color="var(--green-primary)" />
      </Box>
    )
  }

  if (!order) {
    return (
      <Box style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-gray-0)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Text size="sm" c="dimmed">주문을 찾을 수 없습니다</Text>
        <UnstyledButton onClick={() => router.back()} style={{ color: 'var(--green-primary)', textDecoration: 'underline', fontSize: 14 }}>
          돌아가기
        </UnstyledButton>
      </Box>
    )
  }

  const isReadonly = READONLY_STATUSES.includes(order.status)
  const canPrepare = order.status === 'ACCEPTED' || order.status === 'CONFIRMED'
  const canCancel = CANCELLABLE_STATUSES.includes(order.status)
  const deliveryDate = order.saleType === 'normal'
    ? order.requestedDeliveryDate
    : groupConfig?.groupDeliveryDate?.slice(0, 10) ?? null

  return (
    <Box component="main" style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-gray-0)', paddingBottom: 96 }}>
      <Box component="header" style={{ backgroundColor: 'var(--mantine-color-white)', borderBottom: '1px solid var(--mantine-color-gray-1)', padding: '16px', position: 'sticky', top: 0, zIndex: 10 }}>
        <Container size="sm">
          <Group gap="sm">
            <ActionIcon variant="subtle" color="gray" onClick={() => router.back()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </ActionIcon>
            <Title order={3}>주문 상세</Title>
          </Group>
        </Container>
      </Box>

      <Container size="sm" px="md" py="md">
        <Stack gap="sm">
          <Paper radius="lg" shadow="xs" p="md">
            <Group justify="space-between" mb="sm">
              <Badge color={STATUS_COLOR_MAP[order.status]} variant="light" radius="xl" size="md">
                {STATUS_LABEL_MAP[order.status]}
              </Badge>
              <Text size="xs" c={order.status === 'RECRUITING' ? 'orange.6' : 'dimmed'} fw={order.status === 'RECRUITING' ? 600 : 400}>
                {order.status === 'RECRUITING' && groupConfig
                  ? formatDeadlineCountdown(groupConfig.recruitDeadline)
                  : toDate(order.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </Text>
            </Group>
            <Text fw={700}>주문 #{order.id.slice(-8).toUpperCase()}</Text>
            <Text size="xs" c="dimmed" mt={2}>{order.saleType === 'group' ? '공동구매' : '일반 판매'}</Text>
          </Paper>

          <Paper radius="lg" shadow="xs" p="md">
            <Text fw={600} size="sm" c="gray.7" mb="xs">상품 정보</Text>
            <Stack gap={6}>
              <Row label="상품 ID" value={order.productId} mono />
              <Row label="수량" value={`${order.quantity}개`} />
              <Row label="상품 금액" value={`₩${(order.totalAmount - order.deliveryFee).toLocaleString()}`} />
              <Row label="배송비" value={`₩${order.deliveryFee.toLocaleString()}`} />
              <Box style={{ borderTop: '1px solid var(--mantine-color-gray-1)', paddingTop: 8, marginTop: 4 }}>
                <Row label="결제 금액" value={`₩${order.totalAmount.toLocaleString()}`} bold />
              </Box>
            </Stack>
          </Paper>

          {order.saleType === 'group' && groupConfig && (
            <Paper radius="lg" shadow="xs" p="md">
              <Text fw={600} size="sm" c="gray.7" mb="xs">공동구매 현황</Text>
              <Stack gap={6}>
                <Row label="현재 수량" value={`${groupConfig.currentQuantity} / ${groupConfig.targetQuantity}개 (최소 ${groupConfig.minQuantity}개)`} />
                <Row label="모집 마감일" value={new Date(groupConfig.recruitDeadline).toLocaleDateString('ko-KR')} />
                <Row label="배송 예정일" value={new Date(groupConfig.groupDeliveryDate).toLocaleDateString('ko-KR')} />
              </Stack>
            </Paper>
          )}

          <Paper radius="lg" shadow="xs" p="md">
            <Text fw={600} size="sm" c="gray.7" mb="xs">배송 정보</Text>
            <Stack gap={6}>
              <Row label="배송 수단" value={DELIVERY_LABEL_MAP[order.deliveryMethod]} />
              {order.saleType === 'normal' && order.requestedDeliveryDate && (
                <Row label="희망 배송일" value={new Date(order.requestedDeliveryDate).toLocaleDateString('ko-KR')} highlight />
              )}
              {order.deliveryMethod !== 'hub' ? (
                <>
                  <Row label="주소" value={`${order.deliveryAddress.address} ${order.deliveryAddress.addressDetail}`} />
                  <Row label="우편번호" value={order.deliveryAddress.zipCode} />
                  <Row label="서울·경기" value={order.isMetropolitan ? '해당' : '해당 없음'} />
                </>
              ) : (
                order.pickupCode && (
                  <Paper mt="xs" p="sm" radius="md" style={{ backgroundColor: 'var(--green-bg)', textAlign: 'center' }}>
                    <Text size="xs" c="dimmed" mb={4}>픽업 코드</Text>
                    <Text fz={24} fw={700} style={{ letterSpacing: '0.2em', color: 'var(--green-primary)' }}>{order.pickupCode}</Text>
                  </Paper>
                )
              )}
              {order.preparedAt && (
                <Row label="수거 예정 시각" value={new Date(order.preparedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} highlight />
              )}
            </Stack>
          </Paper>

          {order.status === 'CANCELLED' && order.cancelReason && (
            <Paper radius="lg" p="md" style={{ backgroundColor: '#FEF2F2' }}>
              <Text fw={600} size="sm" c="red" mb="xs">취소 사유</Text>
              <Text size="sm" c="red.7">{order.cancelReason}</Text>
            </Paper>
          )}

          {actionError && <Text size="sm" c="red" ta="center">{actionError}</Text>}

          {showPrepareForm && (
            <Paper radius="lg" shadow="xs" p="md">
              <Text fw={600} size="sm" c="gray.7" mb="sm">드라이버 수거 예정 시각 설정</Text>
              {deliveryDate && (
                <Text size="xs" c="dimmed" mb="xs">
                  {order.saleType === 'normal' ? '소비자 희망 배송일' : '공동구매 배송 예정일'}:{' '}
                  <Text component="span" fw={500} c="gray.7">{new Date(deliveryDate).toLocaleDateString('ko-KR')}</Text>
                </Text>
              )}
              <input
                type="datetime-local"
                value={preparedAtInput}
                onChange={(e) => setPreparedAtInput(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--mantine-color-gray-3)', borderRadius: 12, fontSize: 14, marginBottom: 8 }}
              />
              <Text size="xs" c="dimmed" mb="sm">설정하지 않아도 준비 시작 처리는 가능합니다.</Text>
              <Group gap="xs">
                <Button onClick={handlePrepare} disabled={actionLoading} flex={1} size="md" radius="xl" fw={600} style={{ backgroundColor: 'var(--green-primary)' }}>
                  {actionLoading ? '처리 중...' : '준비 시작 확인'}
                </Button>
                <Button onClick={() => { setShowPrepareForm(false); setPreparedAtInput('') }} flex={1} size="md" radius="xl" variant="outline" color="gray">
                  취소
                </Button>
              </Group>
            </Paper>
          )}

          {!isReadonly && !showPrepareForm && (
            <Stack gap="xs">
              {canPrepare && (
                <Button onClick={() => setShowPrepareForm(true)} disabled={actionLoading} fullWidth size="lg" radius="xl" fw={600} style={{ backgroundColor: 'var(--green-primary)' }}>
                  준비 시작
                </Button>
              )}
              {canCancel && (
                <Button onClick={() => setShowCancelModal(true)} disabled={actionLoading} fullWidth size="lg" radius="xl" variant="outline" color="red">
                  강제 취소
                </Button>
              )}
            </Stack>
          )}

          {isReadonly && order.status !== 'CANCELLED' && (
            <Text ta="center" size="xs" c="dimmed" py="xs">
              발송 이후 단계입니다. 취소가 필요한 경우 소비자 반품 신청을 통해 처리됩니다.
            </Text>
          )}
        </Stack>
      </Container>

      <Modal
        opened={showCancelModal}
        onClose={() => { setShowCancelModal(false); setCancelReason(''); setActionError(null) }}
        title={<Text fw={700}>강제 취소</Text>}
        radius="lg"
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">취소 사유를 입력하세요. 소비자에게 알림톡으로 전달됩니다.</Text>
          <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="취소 사유 입력 (최소 5자)" rows={3} radius="md" />
          {cancelReason.length > 0 && cancelReason.trim().length < 5 && (
            <Text size="xs" c="red">최소 5자 이상 입력해주세요</Text>
          )}
          {actionError && <Text size="xs" c="red">{actionError}</Text>}
          <Group gap="xs">
            <Button onClick={handleCancel} disabled={actionLoading || cancelReason.trim().length < 5} flex={1} color="red" radius="xl" fw={600}>
              {actionLoading ? '처리 중...' : '취소 확정'}
            </Button>
            <Button onClick={() => { setShowCancelModal(false); setCancelReason(''); setActionError(null) }} flex={1} radius="xl" variant="outline" color="gray">
              닫기
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  )
}
