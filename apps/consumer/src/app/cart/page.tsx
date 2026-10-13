'use client';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { type CartItem, isRoundCartItem, type RoundCartItem, useCart } from '@/hooks/useCart';
import { useSaleRounds } from '@/hooks/useSaleRounds';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { getCartItemValidationIssues, getCartValidationError } from '@/lib/cartValidation';
import { formatOrderCloseLabel } from '@/lib/round-schedule-label';

const API_URL = getApiBaseUrl();
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
        reason: message ? unavailableReason(message) : '서버 검증 응답을 확인할 수 없습니다.',
      },
    ]),
  );
}
function resolveRoundCartBatchValidation(items: RoundCartItem[], value: unknown): ValidationByKey {
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
async function postRoundCartValidation(
  items: RoundCartItem[],
  accessToken: string,
  signal: AbortSignal,
) {
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
function useRoundCartValidation(
  items: CartItem[],
  accessToken: string | undefined,
  sessionStatus: 'authenticated' | 'loading' | 'unauthenticated',
) {
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
      <Text mt={6} size="sm" c="var(--color-text-secondary)" role="status">
        서버에서 구매 가능 여부 확인 중
      </Text>
    );
  }
  if (validation.status === 'eligible') {
    return (
      <Text mt={6} size="xs" fw="var(--fw-bold)" c="var(--color-primary-dark)">
        서버 확인 완료 · 같은 회차 상품
      </Text>
    );
  }
  if (validation.status === 'price_changed') {
    return (
      <Stack gap={2} mt={6} role="alert">
        <Text size="sm" c="var(--color-danger)">
          가격이 변경되었습니다: 현재 회차 가격{' '}
          {validation.currentUnitPrice.toLocaleString('ko-KR')}원
        </Text>
        <Text size="sm" c="var(--color-danger)">
          결제 대상에서 제외되었습니다.
        </Text>
      </Stack>
    );
  }
  return (
    <Stack gap={2} mt={6} role="alert">
      <Text size="sm" c="var(--color-danger)">
        {validation.reason}
      </Text>
      <Text size="sm" c="var(--color-danger)">
        결제 대상에서 제외되었습니다.
      </Text>
    </Stack>
  );
}
export default function CartPage() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { items, updateQuantity, removeItem, clearCart } = useCart();
  const validation = useRoundCartValidation(items, session?.user?.accessToken, sessionStatus);
  const isRoundCart = items.length > 0 && items.every(isRoundCartItem);
  const checkoutItems = selectCheckoutItems(items, validation.items);
  const checkoutAmount = checkoutItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const checkoutCount = checkoutItems.reduce((sum, item) => sum + item.quantity, 0);
  const excludedCount = isRoundCart ? items.length - checkoutItems.length : 0;
  const legacyItems = items.filter((item) => !isRoundCartItem(item));
  const legacyValidationError = getCartValidationError(legacyItems);
  const hasLegacyValidationIssues = legacyValidationError !== null;
  const isChecking = isRoundCart && validation.status !== 'ready';
  function handleCheckout() {
    if (checkoutItems.length === 0 || isChecking || hasLegacyValidationIssues) return;
    sessionStorage.setItem('checkout_cart', JSON.stringify(checkoutItems));
    router.push('/checkout?from=cart');
  }
  // 회차 장바구니면 같은 회차의 주문 마감 시각을 가져와 노란 안내에 쓴다(실패하면 안내만 숨긴다).
  const firstRoundItem = items.find(isRoundCartItem) ?? null;
  const saleRounds = useSaleRounds(isRoundCart ? (firstRoundItem?.storeId ?? null) : null);
  const cartRound =
    firstRoundItem && saleRounds.currentRound?.id === firstRoundItem.roundId
      ? saleRounds.currentRound
      : null;

  if (items.length === 0) {
    return (
      <Container size="sm" px="md" py={64}>
        <Stack align="center" gap="md">
          <Box
            aria-hidden
            style={{
              alignItems: 'center',
              background: 'var(--color-surface-muted)',
              borderRadius: 'var(--radius-full)',
              color: 'var(--color-text-secondary)',
              display: 'flex',
              height: 72,
              justifyContent: 'center',
              width: 72,
            }}
          >
            <ShoppingBag size={32} strokeWidth={1.8} />
          </Box>
          <Text c="var(--color-text-secondary)">장바구니가 비어있습니다.</Text>
          <Button component={Link} href="/" color="brand" radius="xl" size="md">
            쇼핑하러 가기
          </Button>
        </Stack>
      </Container>
    );
  }
  return (
    <Container size="sm" px="md" pt="lg" pb={100}>
      <Group justify="space-between" align="center" mb="md">
        <Title
          order={1}
          style={{
            color: 'var(--color-text)',
            fontSize: 22,
            fontWeight: 'var(--fw-extrabold)',
            letterSpacing: '-0.01em',
          }}
        >
          장바구니
        </Title>
        <Button variant="subtle" color="gray" size="xs" radius="xl" onClick={clearCart}>
          전체 삭제
        </Button>
      </Group>
      {isRoundCart && (
        <Stack gap="xs" mb="md">
          <Box
            p="md"
            style={{ background: 'var(--color-primary-surface)', borderRadius: 'var(--radius)' }}
          >
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Box>
                <Text fw="var(--fw-extrabold)" size="sm" c="var(--color-text)">
                  이번 주 판매
                </Text>
                <Text size="sm" c="var(--color-text-secondary)">
                  같은 회차 상품을 서버에서 확인해 한 번에 결제합니다.
                </Text>
              </Box>
              <Badge
                color={isChecking ? 'gray' : 'brand'}
                variant={isChecking ? 'light' : 'filled'}
                style={{ flexShrink: 0 }}
              >
                {isChecking ? '확인 중' : '확인 완료'}
              </Badge>
            </Group>
          </Box>
          {cartRound && (
            <Box
              px="md"
              py="sm"
              style={{
                background: 'var(--color-deadline-surface)',
                borderRadius: 'var(--radius)',
                color: 'var(--color-deadline-text)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
              }}
            >
              {formatOrderCloseLabel(cartRound.schedule.orderCloseAt)} 결제해야 이번 회차로
              배송돼요.
            </Box>
          )}
        </Stack>
      )}
      <Stack gap="sm" mb="lg">
        {items.map((item) => {
          const roundItem = isRoundCartItem(item) ? item : null;
          const itemIssues = roundItem ? [] : getCartItemValidationIssues(item);
          const productHref = roundItem
            ? `/products/${item.productId}?round=${encodeURIComponent(roundItem.roundId)}`
            : `/products/${item.productId}`;
          const itemValidation = roundItem ? validation.items[cartItemKey(roundItem)] : undefined;
          // 공개 회차가 품절로 보이는 상품은 이유를 알 수 있게 태그를 단다(결제 제외는 서버 검증이 정한다).
          const soldOut =
            roundItem !== null &&
            cartRound?.items.some(
              (candidate) =>
                candidate.id === roundItem.roundItemId && candidate.status === 'SOLD_OUT',
            ) === true;
          return (
            <Box
              key={cartItemKey(item)}
              p="sm"
              style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}
            >
              <Group gap="md" align="flex-start" wrap="nowrap">
                <Box
                  component={Link}
                  href={productHref}
                  w={76}
                  h={76}
                  bg="var(--color-surface-muted)"
                  style={{
                    flexShrink: 0,
                    borderRadius: 12,
                    overflow: 'hidden',
                    display: 'block',
                  }}
                >
                  <img
                    src={item.image || '/images/product-placeholder.png'}
                    alt={item.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </Box>
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={4} justify="space-between" align="flex-start" wrap="nowrap">
                    <Text
                      component={Link}
                      href={productHref}
                      fw="var(--fw-extrabold)"
                      c="var(--color-text)"
                      size="sm"
                      style={{
                        display: 'block',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textDecoration: 'none',
                      }}
                    >
                      {item.name}
                    </Text>
                    <Button
                      variant="subtle"
                      color="gray"
                      size="compact-sm"
                      radius="xl"
                      aria-label={`${item.name} 삭제`}
                      onClick={() => removeItem(item.productId)}
                      style={{ flexShrink: 0 }}
                    >
                      삭제
                    </Button>
                  </Group>
                  {roundItem ? (
                    <>
                      <span
                        style={{
                          background: 'var(--color-primary-surface)',
                          borderRadius: 'var(--radius-tag)',
                          color: 'var(--color-primary-dark)',
                          display: 'inline-block',
                          fontSize: 'var(--font-size-xs)',
                          fontWeight: 'var(--fw-bold)',
                          marginTop: 4,
                          padding: '2px 7px',
                        }}
                      >
                        회차 가격 {roundItem.roundPrice.toLocaleString('ko-KR')}원
                      </span>
                      {soldOut && (
                        <span
                          style={{
                            background: 'var(--color-surface-muted)',
                            borderRadius: 'var(--radius-tag)',
                            color: 'var(--color-text-secondary)',
                            display: 'inline-block',
                            fontSize: 'var(--font-size-xs)',
                            fontWeight: 'var(--fw-bold)',
                            marginLeft: 6,
                            marginTop: 4,
                            padding: '2px 7px',
                          }}
                        >
                          품절
                        </span>
                      )}
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
                      {itemIssues.length > 0 && (
                        <Alert color="orange" variant="light" mt="sm" p="xs">
                          <Stack gap={4}>
                            {itemIssues.map((issue) => (
                              <Text key={issue.code} size="sm">
                                {issue.itemMessage}
                              </Text>
                            ))}
                            <Button
                              component={Link}
                              href={productHref}
                              size="xs"
                              variant="light"
                              color="orange"
                              radius="xl"
                              mt={4}
                            >
                              다시 선택하기
                            </Button>
                          </Stack>
                        </Alert>
                      )}
                    </>
                  )}
                  <Group justify="space-between" align="center" mt="sm" wrap="nowrap">
                    <Group
                      gap={2}
                      wrap="nowrap"
                      px={2}
                      style={{
                        background: 'var(--color-surface-muted)',
                        borderRadius: 'var(--radius-full)',
                      }}
                    >
                      <ActionIcon
                        size={36}
                        variant="subtle"
                        color="dark"
                        radius="xl"
                        aria-label={`${item.name} 수량 줄이기`}
                        onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                      >
                        −
                      </ActionIcon>
                      <Text
                        fw="var(--fw-extrabold)"
                        size="sm"
                        w={24}
                        ta="center"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {item.quantity}
                      </Text>
                      <ActionIcon
                        size={36}
                        variant="subtle"
                        color="dark"
                        radius="xl"
                        aria-label={`${item.name} 수량 늘리기`}
                        onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                      >
                        +
                      </ActionIcon>
                    </Group>
                    <Text
                      fw="var(--fw-extrabold)"
                      c="var(--color-text)"
                      style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                    >
                      {(item.price * item.quantity).toLocaleString('ko-KR')}원
                    </Text>
                  </Group>
                </Box>
              </Group>
            </Box>
          );
        })}
      </Stack>
      {excludedCount > 0 && (
        <Paper
          p="sm"
          mb="md"
          role="alert"
          style={{ background: 'var(--color-danger-surface)', borderRadius: 'var(--radius)' }}
        >
          <Text size="sm" fw="var(--fw-bold)" c="var(--color-danger)">
            변경·마감·구매 불가 상품 {excludedCount}개는 장바구니에 남아 있으며 결제 대상에서
            제외됩니다.
          </Text>
        </Paper>
      )}
      <Stack
        gap={8}
        p="md"
        mb="md"
        style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius)' }}
      >
        <Group justify="space-between">
          <Text size="sm" c="var(--color-text-secondary)">
            결제 대상 상품 수
          </Text>
          <Text size="sm" c="var(--color-text)" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {checkoutCount}개
          </Text>
        </Group>
        <Group
          justify="space-between"
          align="baseline"
          pt={10}
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <Text size="sm" fw="var(--fw-bold)" c="var(--color-text)">
            총 결제 금액
          </Text>
          <Text
            style={{
              color: 'var(--color-text)',
              fontSize: 22,
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 'var(--fw-extrabold)',
            }}
          >
            {checkoutAmount.toLocaleString('ko-KR')}원
          </Text>
        </Group>
      </Stack>
      {hasLegacyValidationIssues && (
        <Text mb="xs" ta="center" size="sm" c="var(--color-text-disabled)">
          문제 있는 상품을 다시 선택하면 결제할 수 있어요.
        </Text>
      )}
      <Button
        fullWidth
        size="lg"
        color="brand"
        radius="xl"
        disabled={checkoutItems.length === 0 || isChecking || hasLegacyValidationIssues}
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
