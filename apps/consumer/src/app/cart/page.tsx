'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Container, Box, Group, Text, Title, Button, ActionIcon, Paper, Stack, Badge } from '@mantine/core'
import { useCart } from '@/hooks/useCart'

export default function CartPage() {
  const router = useRouter()
  const { items, updateQuantity, removeItem, clearCart, totalAmount, itemCount } = useCart()

  function handleCheckout() {
    if (items.length === 0) return
    const first = items[0]
    const params = new URLSearchParams({
      productId: first.productId,
      quantity: String(first.quantity),
      saleType: first.saleType,
      deliveryMethod: first.deliveryMethod,
      totalAmount: String(totalAmount),
    })
    router.push(`/checkout?${params.toString()}`)
  }

  if (items.length === 0) {
    return (
      <Container size="sm" px="md" py={64}>
        <Stack align="center" gap="md">
          <Text size="xl">🛒</Text>
          <Text c="gray.5">장바구니가 비어있습니다.</Text>
          <Button component={Link} href="/" color="brand" radius="md">
            쇼핑하러 가기
          </Button>
        </Stack>
      </Container>
    )
  }

  return (
    <Container size="sm" px="md" pt="lg" pb="md">
      {/* 헤더 */}
      <Group justify="space-between" mb="lg">
        <Title order={2}>장바구니</Title>
        <Button variant="transparent" size="xs" c="gray.4" onClick={clearCart} style={{ textDecoration: 'underline' }}>
          전체 삭제
        </Button>
      </Group>

      {/* 아이템 목록 */}
      <Stack gap="sm" mb="lg">
        {items.map((item) => (
          <Paper key={item.productId} p="sm" radius="md" withBorder>
            <Group gap="sm" align="flex-start">
              {/* 이미지 */}
              <Box
                component={Link}
                href={`/products/${item.productId}`}
                style={{ flexShrink: 0, width: 80, height: 80, borderRadius: 8, background: 'var(--mantine-color-gray-1)', overflow: 'hidden', display: 'block' }}
              >
                <img
                  src={item.image || '/icons/icon-192x192.png'}
                  alt={item.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </Box>

              {/* 정보 */}
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text
                  component={Link}
                  href={`/products/${item.productId}`}
                  size="sm"
                  fw={600}
                  c="dark"
                  style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
                >
                  {item.name}
                </Text>

                {item.saleType === 'group' && (
                  <Badge size="xs" mt={4} style={{ background: 'var(--green-pale)', color: 'var(--green-dark)' }}>
                    공동구매
                  </Badge>
                )}

                <Text size="md" fw={700} c="brand.8" mt={4}>
                  {(item.price * item.quantity).toLocaleString()}원
                </Text>

                {/* 수량 조절 */}
                <Group gap="xs" mt="xs">
                  <ActionIcon
                    size="sm"
                    variant="outline"
                    color="gray"
                    radius="sm"
                    onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                  >
                    −
                  </ActionIcon>
                  <Text size="sm" fw={600} w={24} ta="center">{item.quantity}</Text>
                  <ActionIcon
                    size="sm"
                    variant="outline"
                    color="gray"
                    radius="sm"
                    onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                  >
                    +
                  </ActionIcon>
                  <Button
                    variant="transparent"
                    size="xs"
                    c="gray.4"
                    ml="auto"
                    onClick={() => removeItem(item.productId)}
                  >
                    삭제
                  </Button>
                </Group>
              </Box>
            </Group>
          </Paper>
        ))}
      </Stack>

      {/* 합계 */}
      <Paper bg="gray.0" radius="md" p="md" mb="md">
        <Group justify="space-between" mb={4}>
          <Text size="sm" c="gray.5">상품 수</Text>
          <Text size="sm">{itemCount}개</Text>
        </Group>
        <Group justify="space-between">
          <Text fw={600}>총 결제 금액</Text>
          <Text size="xl" fw={700} c="brand.8">{totalAmount.toLocaleString()}원</Text>
        </Group>
      </Paper>

      {/* 결제 버튼 */}
      <Button fullWidth size="lg" color="brand" radius="md" onClick={handleCheckout}>
        결제하기
      </Button>
    </Container>
  )
}
