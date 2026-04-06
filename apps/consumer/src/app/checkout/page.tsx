'use client'

export const dynamic = 'force-dynamic'

import { Suspense, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Container, Title, Text, Paper, Stack, TextInput, Group, Button, Alert } from '@mantine/core'
import { usePayment, type PaymentMethod } from '@/hooks/usePayment'
import type { CreateOrderRequest, DeliveryAddress, DeliveryMethod, SaleType } from '@greenhub/shared'

const STORE_ID = 'dear-orchid'
const NAVERPAY_ENABLED = !!process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY

function CheckoutContent() {
  const { data: session } = useSession()
  const params = useSearchParams()
  const router = useRouter()

  const productId = params.get('productId') ?? ''
  const quantity = Number(params.get('quantity') ?? 1)
  const saleType = (params.get('saleType') ?? 'normal') as SaleType
  const deliveryMethod = (params.get('deliveryMethod') ?? 'direct') as DeliveryMethod
  const totalAmount = Number(params.get('totalAmount') ?? 0)

  const [address, setAddress] = useState<DeliveryAddress>({
    address: '',
    addressDetail: '',
    zipCode: '',
  })
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('kakaopay')

  const orderRequest: CreateOrderRequest = {
    productId,
    quantity,
    saleType,
    deliveryMethod,
    deliveryAddress: address,
  }

  const { state, orderId, error, requestPayment } = usePayment({
    storeId: STORE_ID,
    orderRequest,
    accessToken: session?.user?.accessToken ?? '',
    paymentMethod,
  })

  if (state === 'done' && orderId) {
    router.replace(`/order/success?orderId=${orderId}`)
    return null
  }

  const isLoading = state === 'creating' || state === 'paying'
  const canPay = !isLoading && !!address.address && !!address.zipCode && !!session

  const deliveryLabels: Record<DeliveryMethod, string> = {
    direct: '꽃차 직배송',
    hub: '거점 픽업',
    parcel: '택배',
  }

  const paymentOptions: { method: PaymentMethod; label: string; icon: string }[] = [
    { method: 'kakaopay', label: '카카오페이', icon: '💛' },
    ...(NAVERPAY_ENABLED ? [{ method: 'naverpay' as PaymentMethod, label: '네이버페이', icon: '🟢' }] : []),
  ]

  const buttonLabel =
    state === 'creating'
      ? '주문 생성 중...'
      : state === 'paying'
        ? '결제 진행 중...'
        : paymentMethod === 'naverpay'
          ? '네이버페이로 결제하기'
          : '카카오페이로 결제하기'

  return (
    <Container size="sm" px="md" py="lg">
      <Title order={2} mb="lg">결제</Title>

      {/* 주문 요약 */}
      <Paper bg="gray.0" radius="md" p="md" mb="lg">
        <Text fw={600} size="sm" mb="xs">주문 정보</Text>
        <Stack gap={4}>
          <Group justify="space-between">
            <Text size="sm" c="gray.5">수량</Text>
            <Text size="sm">{quantity}개</Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="gray.5">배송 방법</Text>
            <Text size="sm">{deliveryLabels[deliveryMethod]}</Text>
          </Group>
          {totalAmount > 0 && (
            <Group justify="space-between">
              <Text size="sm" fw={600}>결제 금액</Text>
              <Text size="sm" fw={600}>{totalAmount.toLocaleString()}원</Text>
            </Group>
          )}
        </Stack>
      </Paper>

      {/* 배송지 입력 */}
      <Stack gap="sm" mb="lg">
        <Text fw={600} size="sm">배송지</Text>
        <TextInput
          placeholder="주소 *"
          value={address.address}
          onChange={(e) => setAddress((a) => ({ ...a, address: e.target.value }))}
          radius="md"
        />
        <TextInput
          placeholder="상세 주소"
          value={address.addressDetail}
          onChange={(e) => setAddress((a) => ({ ...a, addressDetail: e.target.value }))}
          radius="md"
        />
        <TextInput
          placeholder="우편번호 *"
          value={address.zipCode}
          onChange={(e) => setAddress((a) => ({ ...a, zipCode: e.target.value }))}
          radius="md"
        />
      </Stack>

      {/* 결제 수단 */}
      <Stack gap="xs" mb="lg">
        <Text fw={600} size="sm">결제 수단</Text>
        {paymentOptions.map(({ method, label, icon }) => {
          const isSelected = paymentMethod === method
          return (
            <Paper
              key={method}
              p="sm"
              radius="md"
              onClick={() => setPaymentMethod(method)}
              style={{
                border: `2px solid ${isSelected ? 'var(--green-primary)' : 'var(--mantine-color-gray-3)'}`,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
              }}
            >
              <span>{icon}</span>
              <Text fw={isSelected ? 700 : 400} size="sm">{label}</Text>
            </Paper>
          )
        })}
      </Stack>

      {error && (
        <Alert color="red" variant="light" mb="sm">
          <Text size="sm">{error}</Text>
        </Alert>
      )}

      <Button
        fullWidth
        size="lg"
        color="brand"
        radius="md"
        disabled={!canPay}
        loading={isLoading}
        onClick={requestPayment}
      >
        {buttonLabel}
      </Button>
    </Container>
  )
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<Container size="sm" px="md" py="lg"><Text>로딩 중...</Text></Container>}>
      <CheckoutContent />
    </Suspense>
  )
}
