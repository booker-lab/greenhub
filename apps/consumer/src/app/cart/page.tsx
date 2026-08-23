'use client';
import { ActionIcon, Badge, Box, Button, Container, Divider, Group, Paper, Stack, Text, Title } from '@mantine/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { type CartItem, isRoundCartItem, type RoundCartItem, useCart } from '@/hooks/useCart';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
type RoundCartValidation =
  | { status: 'eligible'; currentUnitPrice: number }
  | { status: 'price_changed'; currentUnitPrice: number; reason: string }
  | { status: 'unavailable'; reason: string };
type ValidationByKey = Record<string, RoundCartValidation | undefined>;
type ValidationState =
  | { status: 'idle'; items: ValidationByKey }
  | { status: 'loading'; items: ValidationByKey }
  | { status: 'ready'; items: ValidationByKey };
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function unavailableReason(message?: string) {
  if (!message) return '서버에서 구매 가능 여부를 확인하지 못했습니다.';
  if (/수량|한도|품절/.test(message)) return '요청한 수량을 구매할 수 없습니다.';
  if (/마감|현재 주문 가능한 회차|구매할 수 없는/.test(message)) return '판매가 마감되었습니다.';
  if (/찾을 수 없/.test(message)) return '현재 구매할 수 없는 상품입니다.';
  return '서버에서 구매 가능 여부를 확인하지 못했습니다.';
}
function readErrorMessage(value: unknown) {
  if (!isRecord(value)) return undefined;
  if (typeof value.message === 'string') return value.message;
  if (Array.isArray(value.message)) {
    return value.message.find((message): message is string => typeof message === 'string');
  }
  return undefined;
}
function cartItemKey(item: CartItem) {
  return isRoundCartItem(item)
    ? `${item.roundId}:${item.roundItemId}:${item.productId}`
    : `legacy:${item.productId}`;
}
function buildRoundCartValidationRequest(value: RoundCartItem | RoundCartItem[]) {
  const items = Array.isArray(value) ? value : [value];
  const item = items[0];
  if (!item) throw new Error('검증할 회차 상품이 없습니다.');
  return {
    productId: item.productId,
    quantity: item.quantity,
    saleType: 'normal' as const,
    deliveryMethod: 'direct' as const,
    // 기존 주문 DTO를 재사용하는 검증 API의 필수 형식이다. 고객 개인정보는 전송하지 않는다.
    requestedDeliveryDate: '1970-01-01',
    deliveryAddress: {
      address: '경기도 이천시',
      addressDetail: '',
      zipCode: '',
    },
    deliveryPhone: '00000000',
    roundId: item.roundId,
    roundItems: items.map(({ roundItemId, quantity }) => ({ roundItemId, quantity })),
  };
}
function resolveRoundCartValidation(
  item: RoundCartItem,
  value: unknown,
  failureMessage?: string,
): RoundCartValidation {
  if (failureMessage) {
    return { status: 'unavailable', reason: unavailableReason(failureMessage) };
  }
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length !== 1) {
    return { status: 'unavailable', reason: '서버 검증 응답을 확인할 수 없습니다.' };
  }
  const serverItem = value.items[0];
  if (
    value.ok !== true ||
    value.salesMode !== 'round_direct' ||
    value.roundId !== item.roundId ||
    !isRecord(serverItem) ||
    serverItem.roundItemId !== item.roundItemId ||
    serverItem.productId !== item.productId ||
    serverItem.quantity !== item.quantity ||
    value.itemQuantityTotal !== item.quantity ||
    !isPrice(serverItem.unitPrice) ||
    serverItem.subtotalAmount !== serverItem.unitPrice * item.quantity ||
    value.totalAmount !== serverItem.subtotalAmount
  ) {
    return { status: 'unavailable', reason: '서버 검증 응답을 확인할 수 없습니다.' };
  }
  if (serverItem.unitPrice !== item.roundPrice) {
    return {
      status: 'price_changed',
      currentUnitPrice: serverItem.unitPrice,
      reason: '가격이 변경되어 확인이 필요합니다.',
    };
  }
  return { status: 'eligible', currentUnitPrice: serverItem.unitPrice };
}
function unavailableValidations(items: RoundCartItem[], message?: string): ValidationByKey {
  return Object.fromEntries(
    items.map((item) => [
      cartItemKey(item),
      {
        status: 'unavailable',
        reason: message
          ? unavailableReason(message)
          : '서버 검증 응답을 확인할 수 없습니다.',
      },
    ]),
  );
}
function resolveRoundCartBatchValidation(
  items: RoundCartItem[],
  value: unknown,
): ValidationByKey {
  if (
    items.length === 0 ||
    !isRecord(value) ||
    value.ok !== true ||
    value.salesMode !== 'round_direct' ||
    value.roundId !== items[0]?.roundId ||
    !items.every((item) => item.roundId === value.roundId) ||
    !Array.isArray(value.items) ||
    value.items.length !== items.length
  ) {
    return unavailableValidations(items);
  }
  const resolved: ValidationByKey = {};
  let quantityTotal = 0;
  let totalAmount = 0;
  for (const item of items) {
    const matches = value.items.filter(
      (candidate) => isRecord(candidate) && candidate.roundItemId === item.roundItemId,
    );
    if (matches.length !== 1 || !isRecord(matches[0]) || !isPrice(matches[0].subtotalAmount)) {
      return unavailableValidations(items);
    }
    const serverItem = matches[0];
    resolved[cartItemKey(item)] = resolveRoundCartValidation(item, {
      ...value,
      itemQuantityTotal: item.quantity,
      totalAmount: serverItem.subtotalAmount,
      items: [serverItem],
    });
    quantityTotal += item.quantity;
    totalAmount += serverItem.subtotalAmount as number;
  }
  if (value.itemQuantityTotal !== quantityTotal || value.totalAmount !== totalAmount) {
    return unavailableValidations(items);
  }
  return resolved;
}
function selectCheckoutItems(items: CartItem[], validationByKey: ValidationByKey) {
  if (!items.every(isRoundCartItem)) return items;
  return items.filter((item) => validationByKey[cartItemKey(item)]?.status === 'eligible');
}
async function postRoundCartValidation(items: RoundCartItem[], accessToken: string, signal: AbortSignal) {
  try {
    const response = await fetch(
      `${API_URL}/stores/${encodeURIComponent(items[0]?.storeId ?? '')}/orders/validate-cart`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(buildRoundCartValidationRequest(items)),
        signal,
      },
    );
    const body = (await response.json().catch(() => null)) as unknown;
    return response.ok
      ? ({ ok: true, body } as const)
      : ({ ok: false, message: readErrorMessage(body) } as const);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return { ok: false, message: undefined } as const;
  }
}
function useRoundCartValidation(items: CartItem[], accessToken: string | undefined, sessionStatus: 'authenticated' | 'loading' | 'unauthenticated') {
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle', items: {} });
  useEffect(() => {
    const roundItems = items.filter(isRoundCartItem);
    if (roundItems.length === 0) {
      setValidation({ status: 'idle', items: {} });
      return;
    }
    if (sessionStatus === 'loading') {
      setValidation({ status: 'loading', items: {} });
      return;
    }
    if (!accessToken) {
      setValidation({
        status: 'ready',
        items: Object.fromEntries(
          roundItems.map((item) => [
            cartItemKey(item),
            { status: 'unavailable', reason: '로그인 후 구매 가능 여부를 확인해 주세요.' },
          ]),
        ),
      });
      return;
    }

    const controller = new AbortController();
    let active = true;
    setValidation({ status: 'loading', items: {} });
    void Promise.all(
      roundItems.map(async (item) => {
        const response = await postRoundCartValidation([item], accessToken, controller.signal);
        const result = response.ok
          ? resolveRoundCartValidation(item, response.body)
          : resolveRoundCartValidation(item, null, response.message);
        return [cartItemKey(item), result] as const;
      }),
    )
      .then(async (results) => {
        let resolved = Object.fromEntries(results) as ValidationByKey;
        const candidates = roundItems.filter(
          (item) => resolved[cartItemKey(item)]?.status === 'eligible',
        );
        if (candidates.length > 1) {
          const response = await postRoundCartValidation(
            candidates,
            accessToken,
            controller.signal,
          );
          resolved = {
            ...resolved,
            ...(response.ok
              ? resolveRoundCartBatchValidation(candidates, response.body)
              : unavailableValidations(candidates, response.message)),
          };
        }
        if (active) setValidation({ status: 'ready', items: resolved });
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof Error && error.name === 'AbortError')) {
          setValidation({
            status: 'ready',
            items: unavailableValidations(roundItems, '서버 검증 실패'),
          });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [accessToken, items, sessionStatus]);
  return validation;
}
function RoundValidationNotice({ validation }: { validation: RoundCartValidation | undefined }) {
  if (!validation) {
    return (
      <Text mt={6} size="xs" c="var(--color-text-secondary)" role="status">서버에서 구매 가능 여부 확인 중</Text>
    );
  }
  if (validation.status === 'eligible') {
    return (
      <Text mt={6} size="xs" c="green">서버 확인 완료 · 같은 회차 상품</Text>
    );
  }
  if (validation.status === 'price_changed') {
    return (
      <Stack gap={2} mt={6} role="alert">
        <Text size="xs" c="red">
          가격이 변경되었습니다: 현재 회차 가격 {validation.currentUnitPrice.toLocaleString('ko-KR')}원
        </Text>
        <Text size="xs" c="red">결제 대상에서 제외되었습니다.</Text>
      </Stack>
    );
  }
  return (
    <Stack gap={2} mt={6} role="alert">
      <Text size="xs" c="red">{validation.reason}</Text>
      <Text size="xs" c="red">결제 대상에서 제외되었습니다.</Text>
    </Stack>
  );
}
export default function CartPage() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { items, updateQuantity, removeItem, clearCart } = useCart();
  const validation = useRoundCartValidation(
    items,
    session?.user?.accessToken,
    sessionStatus,
  );
  const isRoundCart = items.length > 0 && items.every(isRoundCartItem);
  const checkoutItems = selectCheckoutItems(items, validation.items);
  const checkoutAmount = checkoutItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const checkoutCount = checkoutItems.reduce((sum, item) => sum + item.quantity, 0);
  const excludedCount = isRoundCart ? items.length - checkoutItems.length : 0;
  const isChecking = isRoundCart && validation.status !== 'ready';
  function handleCheckout() {
    if (checkoutItems.length === 0 || isChecking) return;
    sessionStorage.setItem('checkout_cart', JSON.stringify(checkoutItems));
    router.push('/checkout?from=cart');
  }
  if (items.length === 0) {
    return (
      <Container size="sm" px="md" py={64}>
        <Stack align="center" gap="md">
          <Text size="xl">🛒</Text>
          <Text c="var(--color-text-disabled)">장바구니가 비어있습니다.</Text>
          <Button component={Link} href="/" color="brand" radius="md">
            쇼핑하러 가기
          </Button>
        </Stack>
      </Container>
    );
  }
  return (
    <Container size="sm" px="md" pt="lg" pb={100}>
      <Group justify="space-between" mb="lg">
        <Title order={3} fw="var(--fw-bold)" c="var(--color-text)">
          장바구니
        </Title>
        <Button variant="transparent" size="xs" c="var(--color-text-disabled)" onClick={clearCart}>
          전체 삭제
        </Button>
      </Group>
      {isRoundCart && (
        <Paper p="md" radius="md" mb="md" bg="var(--color-surface-muted)">
          <Group justify="space-between" align="flex-start">
            <Box>
              <Text fw="var(--fw-bold)" size="sm">
                이번 주 판매
              </Text>
              <Text size="xs" c="var(--color-text-secondary)">
                같은 회차 상품을 서버에서 확인해 한 번에 결제합니다.
              </Text>
            </Box>
            <Badge color={isChecking ? 'gray' : 'brand'} variant="light">
              {isChecking ? '확인 중' : '확인 완료'}
            </Badge>
          </Group>
        </Paper>
      )}
      <Stack gap="sm" mb="lg">
        {items.map((item) => {
          const roundItem = isRoundCartItem(item) ? item : null;
          const productHref = roundItem
            ? `/products/${item.productId}?round=${encodeURIComponent(roundItem.roundId)}`
            : `/products/${item.productId}`;
          const itemValidation = roundItem ? validation.items[cartItemKey(roundItem)] : undefined;
          return (
            <Paper key={cartItemKey(item)} p="md" radius="md" withBorder>
              <Group gap="md" align="flex-start">
                <Box
                  component={Link}
                  href={productHref}
                  w={72}
                  h={72}
                  bg="var(--color-surface-muted)"
                  style={{
                    flexShrink: 0,
                    borderRadius: 'var(--radius-sm)',
                    overflow: 'hidden',
                    display: 'block',
                  }}
                >
                  <img
                    src={item.image || '/icons/icon-192x192.png'}
                    alt={item.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </Box>
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    component={Link}
                    href={productHref}
                    fw="var(--fw-bold)"
                    c="var(--color-text)"
                    size="sm"
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textDecoration: 'none',
                    }}
                  >
                    {item.name}
                  </Text>
                  {roundItem ? (
                    <>
                      <Badge size="xs" color="brand" variant="light" mt={4}>
                        회차 가격 {roundItem.roundPrice.toLocaleString('ko-KR')}원
                      </Badge>
                      <RoundValidationNotice validation={itemValidation} />
                    </>
                  ) : (
                    <>
                      {item.saleType === 'group' && (
                        <Badge size="xs" color="brand" variant="light" mt={4}>
                          공동구매
                        </Badge>
                      )}
                      {item.requestedDeliveryDate && (
                        <Text size="sm" c="var(--color-text-disabled)" mt={4}>
                          배송 희망일{' '}
                          {new Date(item.requestedDeliveryDate).toLocaleDateString('ko-KR', {
                            month: 'long',
                            day: 'numeric',
                            weekday: 'short',
                          })}
                        </Text>
                      )}
                    </>
                  )}
                  <Text fw="var(--fw-bold)" c="var(--color-text)" mt={6}>
                    {(item.price * item.quantity).toLocaleString('ko-KR')}원
                  </Text>
                  <Group gap="xs" mt="sm">
                    <ActionIcon
                      size="lg"
                      variant="default"
                      radius="md"
                      aria-label={`${item.name} 수량 줄이기`}
                      onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                    >
                      −
                    </ActionIcon>
                    <Text fw="var(--fw-bold)" size="sm" w={24} ta="center">
                      {item.quantity}
                    </Text>
                    <ActionIcon
                      size="lg"
                      variant="default"
                      radius="md"
                      aria-label={`${item.name} 수량 늘리기`}
                      onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                    >
                      +
                    </ActionIcon>
                    <Button
                      variant="transparent"
                      size="xs"
                      c="var(--color-text-disabled)"
                      ml="auto"
                      onClick={() => removeItem(item.productId)}
                    >
                      삭제
                    </Button>
                  </Group>
                </Box>
              </Group>
            </Paper>
          );
        })}
      </Stack>
      {excludedCount > 0 && (
        <Paper p="sm" radius="md" mb="md" withBorder role="alert">
          <Text size="sm" c="red">
            변경·마감·구매 불가 상품 {excludedCount}개는 장바구니에 남아 있으며 결제 대상에서
            제외됩니다.
          </Text>
        </Paper>
      )}
      <Paper radius="md" p="lg" mb="md" bg="var(--color-text)" c="var(--color-bg)">
        <Group justify="space-between" mb={8}>
          <Text size="sm" c="var(--color-text-secondary)">
            결제 대상 상품 수
          </Text>
          <Text size="sm" c="var(--color-bg)">
            {checkoutCount}개
          </Text>
        </Group>
        <Divider mb={12} style={{ borderColor: 'rgba(255,255,255,0.15)' }} />
        <Group justify="space-between">
          <Text size="sm" fw="var(--fw-bold)" c="var(--color-text-secondary)">
            총 결제 금액
          </Text>
          <Text size="xl" fw="var(--fw-bold)" c="var(--color-bg)">
            {checkoutAmount.toLocaleString('ko-KR')}원
          </Text>
        </Group>
      </Paper>
      <Button
        fullWidth
        size="lg"
        color="brand"
        radius="md"
        disabled={checkoutItems.length === 0 || isChecking}
        onClick={handleCheckout}
      >
        {isChecking
          ? '구매 가능 여부 확인 중'
          : isRoundCart
            ? `${checkoutCount}개 상품 한 번에 결제`
            : '결제하기'}
      </Button>
    </Container>
  );
}
