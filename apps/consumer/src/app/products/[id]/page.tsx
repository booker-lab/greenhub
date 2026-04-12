'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signIn } from 'next-auth/react'
import {
  Container, Box, Text, Title, Button, Group, Stack, Badge,
  Paper, Progress, ActionIcon, Checkbox, Skeleton,
} from '@mantine/core'
import { useProduct, useStore } from '@/hooks/useProducts'
import { useGroupProduct } from '@/hooks/useGroupProduct'
import { useDailyCap } from '@/hooks/useDailyCap'
import { useCart } from '@/hooks/useCart'
import type { SaleType, DeliveryMethod } from '@greenhub/shared'

const deliveryLabels: Record<DeliveryMethod, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
}

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const { data: session } = useSession()
  const { product, loading, error } = useProduct(id)
  const { store } = useStore(product?.storeId ?? null)
  const { config: groupConfig } = useGroupProduct(
    product?.saleType === 'group' ? id : null,
  )
  const { remainingSlots } = useDailyCap(product?.storeId ?? null)
  const { addItem } = useCart()

  const [quantity, setQuantity] = useState(1)
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('direct')
  const [groupConsent, setGroupConsent] = useState(false)

  if (loading) {
    return (
      <Container size="sm" px="md" py="lg">
        <Skeleton height={300} radius="lg" mb="md" />
        <Skeleton height={24} width="60%" mb="xs" />
        <Skeleton height={32} width="30%" />
      </Container>
    )
  }

  if (error || !product) {
    return (
      <Container size="sm" px="md" py={64}>
        <Stack align="center" gap="sm">
          <Text size="xl">😔</Text>
          <Text size="sm" c="gray.4">{error ?? '상품을 찾을 수 없습니다.'}</Text>
          <Button variant="transparent" c="brand.6" onClick={() => router.back()}>돌아가기</Button>
        </Stack>
      </Container>
    )
  }

  const isGroup = product.saleType === 'group'
  const isFull = isGroup && !!groupConfig && groupConfig.currentParticipants >= groupConfig.maxParticipants
  const unitPrice = product.price
  const totalAmount = unitPrice * quantity
  const canBuy = isGroup ? (groupConsent && !isFull) : true

  function handleAddToCart() {
    if (!product) return
    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      image: product.images?.[0] ?? '',
      saleType: product.saleType,
      deliveryMethod,
      storeId: product.storeId,
      quantity,
    })
    router.push('/cart')
  }

  function handleBuyNow() {
    if (!product) return
    const p = new URLSearchParams({
      productId: product.id,
      quantity: String(quantity),
      saleType: product.saleType,
      deliveryMethod,
      totalAmount: String(totalAmount),
    })
    const checkoutUrl = `/checkout?${p.toString()}`
    if (!session) {
      signIn(undefined, { callbackUrl: checkoutUrl })
      return
    }
    router.push(checkoutUrl)
  }

  return (
    <Container size="sm" p={0}>
      {/* 뒤로가기 */}
      <Box px="md" pt="md">
        <Button variant="transparent" size="sm" c="gray.5" onClick={() => router.back()} pl={0}>
          ← 뒤로
        </Button>
      </Box>

      {/* 이미지 */}
      <Box style={{ aspectRatio: '1', background: 'var(--mantine-color-gray-0)', overflow: 'hidden' }}>
        <img
          src={product.images?.[0] ?? '/icons/icon-192x192.png'}
          alt={product.name}
          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
        />
      </Box>

      {/* 정보 */}
      <Stack gap="md" px="md" py="lg">
        {isGroup && (
          <Badge color="brand" variant="filled">공동구매</Badge>
        )}

        <Title order={2}>{product.name}</Title>
        <Text size="xl" fw={700} c="brand.8">{unitPrice.toLocaleString()}원</Text>

        {product.description && (
          <Text size="sm" c="gray.6" style={{ lineHeight: 1.6 }}>
            {product.description}
          </Text>
        )}

        {/* 공동구매 실시간 정보 */}
        {isGroup && groupConfig && (
          <Paper bg={isFull ? 'gray.1' : 'brand.0'} radius="md" p="md">
            <Group justify="space-between" mb="xs">
              <Text fw={700} size="sm" c={isFull ? 'gray.6' : 'brand.8'}>공동구매 현황</Text>
              {isFull && <Badge color="gray" variant="filled" size="sm">모집 완료</Badge>}
            </Group>
            <Group justify="space-between" mb={4}>
              <Text size="sm" c="gray.5">현재 참여</Text>
              <Text size="sm" fw={600}>
                {groupConfig.currentParticipants}/{groupConfig.maxParticipants}명
              </Text>
            </Group>
            <Group justify="space-between" mb="xs">
              <Text size="sm" c="gray.5">최소 인원</Text>
              <Text size="sm" fw={600}>{groupConfig.minParticipants}명</Text>
            </Group>
            <Progress
              value={Math.min(
                (groupConfig.currentParticipants / groupConfig.minParticipants) * 100,
                100,
              )}
              color="brand"
              size="sm"
              radius="xl"
            />
            <Text size="xs" c="gray.4" mt="xs">
              모집 마감:{' '}
              {new Date(groupConfig.recruitDeadline).toLocaleString('ko-KR', {
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
            <Text size="xs" c="brand.7" mt={4} fw={600}>
              배송 예정일:{' '}
              {new Date(groupConfig.groupDeliveryDate).toLocaleDateString('ko-KR', {
                month: 'long',
                day: 'numeric',
                weekday: 'short',
              })}
            </Text>
          </Paper>
        )}

        {/* Daily Cap */}
        {remainingSlots > 0 && (
          <Text size="xs" c="gray.4">
            🕐 오늘 잔여 배송 가능: <Text span fw={700}>{remainingSlots}건</Text>
          </Text>
        )}

        {/* 배송 방법 */}
        <Box>
          <Text fw={600} size="sm" mb="xs">배송 방법</Text>
          <Group gap="xs">
            {(['direct', 'hub', 'parcel'] as DeliveryMethod[]).map((method) => (
              <Button
                key={method}
                size="xs"
                radius="md"
                variant={deliveryMethod === method ? 'filled' : 'outline'}
                color={deliveryMethod === method ? 'brand' : 'gray'}
                style={{ flex: 1 }}
                onClick={() => setDeliveryMethod(method)}
              >
                {deliveryLabels[method]}
              </Button>
            ))}
          </Group>
        </Box>

        {/* 수량 */}
        <Box>
          <Text fw={600} size="sm" mb="xs">수량</Text>
          <Group gap="sm">
            <ActionIcon
              size="lg"
              variant="outline"
              color="gray"
              radius="md"
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
            >
              −
            </ActionIcon>
            <Text size="lg" fw={700} w={32} ta="center">{quantity}</Text>
            <ActionIcon
              size="lg"
              variant="outline"
              color="gray"
              radius="md"
              onClick={() => setQuantity(quantity + 1)}
            >
              +
            </ActionIcon>
          </Group>
        </Box>

        {/* 공동구매 동의 */}
        {isGroup && (
          <Paper bg="yellow.0" radius="md" p="md">
            <Checkbox
              checked={groupConsent}
              onChange={(e) => setGroupConsent(e.currentTarget.checked)}
              color="brand"
              label={
                <Text size="sm" c="gray.7" style={{ lineHeight: 1.5 }}>
                  공동구매 <Text span fw={700}>확정 이후 취소·환불이 불가</Text>함을 이해하고
                  동의합니다. (전자상거래법 제17조)
                </Text>
              }
            />
          </Paper>
        )}

        {/* 합계 */}
        <Group justify="space-between" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
          <Text size="sm" c="gray.5">총 금액</Text>
          <Text size="xl" fw={700} c="brand.8">{totalAmount.toLocaleString()}원</Text>
        </Group>

        {/* CTA 버튼 */}
        <Group gap="xs">
          <Button
            flex={1}
            variant="outline"
            color="brand"
            radius="md"
            size="md"
            onClick={handleAddToCart}
          >
            장바구니
          </Button>
          <Button
            flex={1}
            color="brand"
            radius="md"
            size="md"
            disabled={!canBuy}
            onClick={handleBuyNow}
          >
            {isFull ? '모집 완료' : '바로 결제'}
          </Button>
        </Group>

        {/* 판매자 정보 */}
        {store && (
          <Box pt="md" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
            <Text fw={600} size="sm" c="gray.7" mb="xs">판매자 정보</Text>
            <Group gap="sm" mb="xs">
              {store.logoUrl ? (
                <img
                  src={store.logoUrl}
                  alt={store.name}
                  style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', background: 'var(--green-bg)' }}
                />
              ) : (
                <Box
                  style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: 'var(--green-bg)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    color: 'var(--green-primary)', fontWeight: 700, fontSize: 14,
                  }}
                >
                  {store.name[0]}
                </Box>
              )}
              <Box>
                <Text size="sm" fw={600} c="dark">{store.name}</Text>
                <Text size="xs" c="gray.4">{store.ceoName}</Text>
              </Box>
            </Group>
            <Stack gap={4}>
              <Text size="xs" c="gray.5">📍 {store.address}</Text>
              <Text size="xs" c="gray.5">📞 {store.phone}</Text>
            </Stack>
          </Box>
        )}
      </Stack>
    </Container>
  )
}
