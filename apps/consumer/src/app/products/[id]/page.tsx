'use client'

import { use, useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signIn } from 'next-auth/react'
import {
  Container, Box, Text, Title, Button, Group, Stack, Badge,
  Paper, Progress, ActionIcon, Checkbox, Skeleton, Divider, SimpleGrid,
} from '@mantine/core'
import { useProduct, useStore, useVariety } from '@/hooks/useProducts'
import { useGroupProduct } from '@/hooks/useGroupProduct'
import { useDailyCap } from '@/hooks/useDailyCap'
import { useCart } from '@/hooks/useCart'
import GreenLoveBrandSection from '@/components/GreenLoveBrandSection'
import ProductTopBar from '@/components/ProductTopBar'
import ProductCTABar from '@/components/ProductCTABar'
import type { DeliveryMethod } from '@greenhub/shared'

const deliveryLabels: Record<DeliveryMethod, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
}

const FRAGRANCE_LABEL: Record<string, string> = {
  none: '없음', light: '은은함', strong: '진함',
}
const BLOOM_LABEL: Record<string, string> = {
  bud: '봉오리', half: '반개화', full: '활짝 핌',
}
const CARE_LABEL: Record<string, string> = {
  easy: '쉬움', normal: '보통', hard: '어려움',
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
  const { variety } = useVariety(product?.varietyId)
  const { config: groupConfig } = useGroupProduct(
    product?.saleType === 'group' ? id : null,
  )
  const { remainingSlots } = useDailyCap(product?.storeId ?? null)
  const { addItem } = useCart()

  const [quantity, setQuantity] = useState(1)
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('direct')
  const [groupConsent, setGroupConsent] = useState(false)
  const [activeImageIdx, setActiveImageIdx] = useState(0)
  const carouselRef = useRef<HTMLDivElement>(null)
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

  if (loading) {
    return (
      <Container size="sm" px="md" py="lg">
        <Skeleton height={340} radius="md" mb="md" />
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
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>{error ?? '상품을 찾을 수 없습니다.'}</Text>
          <Button variant="transparent" style={{ color: 'var(--color-primary)' }} onClick={() => router.back()}>돌아가기</Button>
        </Stack>
      </Container>
    )
  }

  const isGroup = product.saleType === 'group'
  const isFull = isGroup && !!groupConfig && groupConfig.currentQuantity >= groupConfig.targetQuantity
  const unitPrice = product.price
  const totalAmount = unitPrice * quantity
  const canBuy = isGroup ? (groupConsent && !isFull) : true

  const headline = product.content?.headline ?? null
  const description = product.content?.description ?? product.description ?? null
  const displayColors = product.selection?.colors ?? product.colors ?? []

  const careCards = [
    product.selection?.bloomCondition
      ? { icon: '🌸', label: '개화 상태', value: BLOOM_LABEL[product.selection.bloomCondition] ?? product.selection.bloomCondition }
      : null,
    product.selection?.fragrance
      ? { icon: '💨', label: '향기', value: FRAGRANCE_LABEL[product.selection.fragrance] ?? product.selection.fragrance }
      : null,
    product.selection?.careLevel
      ? { icon: '⭐', label: '관리 난이도', value: CARE_LABEL[product.selection.careLevel] ?? product.selection.careLevel }
      : null,
  ].filter((c): c is { icon: string; label: string; value: string } => c !== null)

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
      <ProductTopBar />

      <Box style={{ paddingTop: 'calc(52px + env(safe-area-inset-top))' }}>

      {/* 이미지 캐러셀 */}
      <Box
        ref={carouselRef}
        onScroll={(e) => {
          const el = e.currentTarget
          const idx = Math.round(el.scrollLeft / el.offsetWidth)
          setActiveImageIdx(idx)
        }}
        style={{
          display: 'flex',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          scrollBehavior: 'smooth',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
          aspectRatio: '4/5',
          background: 'var(--color-surface-muted)',
        }}
      >
        {(product.images?.length ? product.images : ['/icons/icon-192x192.png']).map((src, i) => (
          <Box
            key={i}
            style={{ flexShrink: 0, width: '100%', scrollSnapAlign: 'start', aspectRatio: '4/5', overflow: 'hidden' }}
          >
            <img src={src} alt={`${product.name} ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </Box>
        ))}
      </Box>

      {/* 썸네일 스트립 */}
      {(product.images?.length ?? 0) > 1 && (
        <Box style={{ display: 'flex', gap: 6, padding: '8px 12px', overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', background: 'var(--color-surface-muted)' }}>
          {product.images!.map((src, i) => (
            <Box
              key={i}
              onClick={() => {
                setActiveImageIdx(i)
                carouselRef.current?.scrollTo({ left: i * carouselRef.current.offsetWidth, behavior: 'smooth' })
              }}
              style={{
                flexShrink: 0, width: 56, height: 56, borderRadius: 6, overflow: 'hidden', cursor: 'pointer',
                border: activeImageIdx === i ? '2px solid var(--color-primary)' : '2px solid transparent',
                transition: 'border-color 0.15s',
              }}
            >
              <img src={src} alt={`${product.name} 썸네일 ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </Box>
          ))}
        </Box>
      )}

      <Stack gap={0} px="md" pt="lg" pb={88}>
        {headline && (
          <Text mb="xs" style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--fw-bold)', color: 'var(--color-primary)', lineHeight: 1.3 }}>
            {headline}
          </Text>
        )}

        <Stack gap="xs" mb="lg">
          <Group gap="xs">
            {isGroup && <Badge color="brand" variant="filled" size="sm">공동구매</Badge>}
            <Badge color="gray" variant="light" size="sm">
              {product.category === 'cut_flower' ? '절화' : product.category === 'orchid' ? '난' : '관엽'}
            </Badge>
          </Group>
          <Title order={2} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>{product.name}</Title>
          <Text style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>{unitPrice.toLocaleString()}원</Text>
        </Stack>

        <Divider mb="lg" />

        {careCards.length > 0 && (
          <Paper radius="md" p="md" mb="md" style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
            <SimpleGrid cols={careCards.length} spacing="xs">
              {careCards.map(({ icon, label, value }) => (
                <Stack key={label} gap={4} align="center">
                  <Text size="xl" style={{ lineHeight: 1 }}>{icon}</Text>
                  <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>{value}</Text>
                  <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>{label}</Text>
                </Stack>
              ))}
            </SimpleGrid>
          </Paper>
        )}

        {product.varietyId && (
          <Box mb="lg">
            <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }} mb="sm">상품 정보</Text>
            <Stack gap={6}>
              {([
                variety ? ['품종', variety.name] : null,
                displayColors.length > 0 ? ['색상', displayColors.join(' · ')] : null,
                variety ? ['추천 관상 기간', variety.bloomDuration] : null,
                product.selection?.bundleUnit ? ['판매 단위', product.selection.bundleUnit] : null,
                product.selection?.stemType ? ['출하 형태', product.selection.stemType] : null,
              ] as ([string, string] | null)[])
                .filter((r): r is [string, string] => r !== null)
                .map(([label, value]) => (
                  <Group key={label} justify="space-between" style={{ borderBottom: '1px solid var(--color-surface-muted)', paddingBottom: 6 }}>
                    <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{label}</Text>
                    <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--color-text)' }}>{value}</Text>
                  </Group>
                ))}
            </Stack>
          </Box>
        )}

        {description && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-line' }} mb="lg">
            {description}
          </Text>
        )}

        {(product.images?.length ?? 0) > 0 && (
          <Box mx={-16} mb="lg">
            {product.images!.map((src, i) => (
              <img key={i} src={src} alt={`${product.name} 상세 ${i + 1}`} style={{ width: '100%', display: 'block' }} />
            ))}
          </Box>
        )}

        {displayColors.length > 0 && (
          <Group gap="xs" mb="lg" style={{ flexWrap: 'wrap' }}>
            {displayColors.map((color) => (
              <Badge key={color} variant="outline" color="gray" radius="xl" size="sm">{color}</Badge>
            ))}
          </Group>
        )}

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
                <img src={store.logoUrl} alt={store.name} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
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
      </Stack>
      </Box>

      <ProductCTABar
        totalAmount={totalAmount}
        isGroup={isGroup}
        isFull={isFull}
        canBuy={canBuy}
        onAddToCart={handleAddToCart}
        onBuyNow={handleBuyNow}
      />
    </Container>
  )
}
