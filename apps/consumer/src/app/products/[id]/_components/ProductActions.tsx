'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useSession, signIn } from 'next-auth/react'
import {
  Box, Text, Button, Group, Stack, Badge,
  Paper, Progress, ActionIcon, Checkbox, Divider,
} from '@mantine/core'
import { useGroupProduct } from '@/hooks/useGroupProduct'
import { useDailyCap } from '@/hooks/useDailyCap'
import { useStore } from '@/hooks/useProducts'
import { useCart } from '@/hooks/useCart'
import GreenLoveBrandSection from '@/components/GreenLoveBrandSection'
import ProductCTABar from '@/components/ProductCTABar'
import type { Product, DeliveryMethod } from '@greenhub/shared'

const deliveryLabels: Record<DeliveryMethod, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
}

interface Props {
  product: Product
}

export default function ProductActions({ product }: Props) {
  const router = useRouter()
  const { data: session } = useSession()
  const { config: groupConfig } = useGroupProduct(
    product.saleType === 'group' ? product.id : null,
  )
  const { remainingSlots } = useDailyCap(product.storeId ?? null)
  const { store } = useStore(product.storeId ?? null)
  const { addItem } = useCart()

  const [quantity, setQuantity] = useState(1)
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('direct')
  const [groupConsent, setGroupConsent] = useState(false)
  const [countdown, setCountdown] = useState('')

  useEffect(() => {
    const deadline = groupConfig?.recruitDeadline
    if (!deadline) return
    const tick = () => {
      const diff = new Date(deadline).getTime() - Date.now()
      if (diff <= 0) { setCountdown('마감'); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setCountdown(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [groupConfig?.recruitDeadline])

  const isGroup = product.saleType === 'group'
  const isFull = isGroup && !!groupConfig && groupConfig.currentQuantity >= groupConfig.targetQuantity
  const totalAmount = product.price * quantity
  const canBuy = isGroup ? (groupConsent && !isFull) : true

  function handleAddToCart() {
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
    <Stack gap={0} px="md" pb={88}>
      {/* 공동구매 실시간 현황 */}
      {isGroup && groupConfig && (
        <Paper radius="lg" p="lg" mb="lg" style={{
          border: `2px solid ${isFull ? 'var(--color-border)' : 'var(--color-primary)'}`,
          background: isFull ? 'var(--color-surface-muted)' : 'var(--color-primary-surface)',
        }}>
          <Group justify="space-between" mb="md">
            <Text style={{ fontWeight: 'var(--fw-bold)', color: isFull ? 'var(--color-text-secondary)' : 'var(--color-primary)' }}>⚡ 공동구매 현황</Text>
            {isFull
              ? <Badge color="gray" variant="filled" radius="xl">모집 완료</Badge>
              : countdown && <Badge color="red" variant="filled" radius="xl" style={{ fontFamily: 'monospace', fontSize: 13 }}>{countdown}</Badge>
            }
          </Group>

          <Box ta="center" mb="md">
            <Text style={{ fontSize: 36, fontWeight: 'var(--fw-bold)', lineHeight: 1, color: isFull ? 'var(--color-text-disabled)' : 'var(--color-primary)' }}>
              {groupConfig.currentQuantity}
              <Text span style={{ fontSize: 18, fontWeight: 'var(--fw-medium)', color: 'var(--color-text-secondary)' }}>
                {' '}/ {groupConfig.targetQuantity}개
              </Text>
            </Text>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mt={4}>최소 {groupConfig.minQuantity}개 이상 모이면 확정</Text>
          </Box>

          <Progress
            value={Math.min((groupConfig.currentQuantity / groupConfig.minQuantity) * 100, 100)}
            color={isFull ? 'gray' : 'brand'}
            size="xl"
            radius="xl"
            mb="md"
          />

          <Group justify="space-between">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              마감{' '}
              <Text span style={{ fontWeight: 'var(--fw-bold)', color: isFull ? 'var(--color-text-secondary)' : 'var(--color-primary)' }}>
                {new Date(groupConfig.recruitDeadline).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </Text>
            </Text>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              배송{' '}
              <Text span style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-primary)' }}>
                {new Date(groupConfig.groupDeliveryDate).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
              </Text>
            </Text>
          </Group>
        </Paper>
      )}

      {remainingSlots > 0 && (
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mb="md">
          오늘 잔여 배송 가능: <Text span style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text-secondary)' }}>{remainingSlots}건</Text>
        </Text>
      )}

      <Paper radius="md" p="md" mb="md" style={{ background: 'var(--color-surface-muted)' }}>
        <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }} mb="sm">배송 방법</Text>
        <Group gap="xs">
          {(['direct', 'hub', 'parcel'] as DeliveryMethod[]).map((method) => (
            <Button
              key={method}
              size="sm"
              radius="md"
              variant={deliveryMethod === method ? 'filled' : 'default'}
              color={deliveryMethod === method ? 'brand' : undefined}
              style={{ flex: 1 }}
              onClick={() => setDeliveryMethod(method)}
            >
              {deliveryLabels[method]}
            </Button>
          ))}
        </Group>
      </Paper>

      <Paper radius="md" p="md" mb="lg" style={{ background: 'var(--color-surface-muted)' }}>
        <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }} mb="sm">수량</Text>
        <Group gap="sm">
          <ActionIcon size="lg" variant="default" radius="md" onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</ActionIcon>
          <Text style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--fw-bold)' }} w={32} ta="center">{quantity}</Text>
          <ActionIcon size="lg" variant="default" radius="md" onClick={() => {
            const maxQty = isGroup && groupConfig ? groupConfig.maxPerPerson : 99
            setQuantity(Math.min(maxQty, quantity + 1))
          }}>+</ActionIcon>
        </Group>
        {isGroup && groupConfig && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mt={6}>1인 최대 {groupConfig.maxPerPerson}개까지 구매 가능</Text>
        )}
      </Paper>

      {isGroup && (
        <Paper radius="md" p="md" mb="lg" style={{ background: 'var(--color-caution-bg)', border: '1px solid var(--color-caution-border)' }}>
          <Checkbox
            checked={groupConsent}
            onChange={(e) => setGroupConsent(e.currentTarget.checked)}
            color="brand"
            label={
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                공동구매 <Text span style={{ fontWeight: 'var(--fw-bold)' }}>확정 이후 취소·환불이 불가</Text>함을 이해하고
                동의합니다. (전자상거래법 제17조)
              </Text>
            }
          />
        </Paper>
      )}

      <Divider mb="xl" />
      <Box mb="xl"><GreenLoveBrandSection /></Box>

      {store && (
        <Box pt="xl" style={{ borderTop: '1px solid var(--color-border)' }}>
          <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }} mb="sm">판매자 정보</Text>
          <Group gap="sm" mb="sm">
            {store.logoUrl ? (
              <Image src={store.logoUrl} alt={store.name} width={44} height={44} style={{ borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <Box style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--color-primary-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)', fontWeight: 700, fontSize: 16 }}>
                {store.name[0]}
              </Box>
            )}
            <Box>
              <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>{store.name}</Text>
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{store.ceoName}</Text>
            </Box>
          </Group>
          <Stack gap={4}>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>📍 {store.address}</Text>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>📞 {store.phone}</Text>
          </Stack>
        </Box>
      )}

      <ProductCTABar
        totalAmount={totalAmount}
        isGroup={isGroup}
        isFull={isFull}
        canBuy={canBuy}
        onAddToCart={handleAddToCart}
        onBuyNow={handleBuyNow}
      />
    </Stack>
  )
}
