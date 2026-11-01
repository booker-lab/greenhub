'use client';

import { type DeliveryMethod, getGroupBuyStatus, type Product } from '@greenhub/shared';
import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
import { Checkbox } from '@greenhub/ui/components/checkbox';
import { Progress } from '@greenhub/ui/components/progress';
import { useRouter } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import GreenLoveBrandSection from '@/components/GreenLoveBrandSection';
import ProductCTABar from '@/components/ProductCTABar';
import ResilientImage from '@/components/ResilientImage';
import { useCart } from '@/hooks/useCart';
import { useGroupProduct } from '@/hooks/useGroupProduct';
import { useStore } from '@/hooks/useProducts';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';
import DeliveryDatePicker from './DeliveryDatePicker';

const deliveryLabels: Record<DeliveryMethod, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
};

interface Props {
  product: Product;
}

// Mantine ActionIcon(size lg 34px·variant default·radius md 8px) 계산값: 흰 면, gray-4 1px 테두리, 검정 글자,
// 줄 높이 1, 글꼴은 물려받는다. hover(가능한 기기만) gray-0 면.
const QUANTITY_BUTTON =
  'relative m-0 inline-flex size-[34px] min-h-[34px] min-w-[34px] cursor-pointer appearance-none items-center justify-center overflow-hidden rounded-[8px] border border-solid border-[#ced4da] bg-white p-0 text-left leading-none text-black no-underline select-none [font-family:inherit] [font-size:inherit] [font-weight:inherit] [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid active:translate-y-px [@media(hover:hover)]:hover:bg-[#f8f9fa]';

function StoreInitialAvatar({ name }: { name: string }) {
  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: 'var(--color-primary-surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-primary-dark)',
        fontWeight: 'var(--fw-bold)',
        fontSize: 'var(--font-size-md)',
      }}
    >
      {name.trim().charAt(0) || '그'}
    </div>
  );
}

// 매초 바뀌는 카운트다운 state를 이 작은 컴포넌트에만 두어 상품 영역 전체가 매초 다시 그려지지 않게 한다.
function GroupCountdownBadge({ deadline }: { deadline: string | undefined }) {
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    if (!deadline) return;
    let id: ReturnType<typeof setInterval> | undefined;
    // 남은 시간이 있으면 true. 마감되면 '마감'으로 고정하고 더 세지 않는다.
    const tick = () => {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) {
        setCountdown('마감');
        if (id !== undefined) clearInterval(id);
        return false;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
      );
      return true;
    };
    if (!tick()) return;
    id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!countdown) return null;
  return (
    <Badge
      variant="destructive-filled"
      className="rounded-[32px]"
      style={{ fontFamily: 'monospace', fontSize: 13 }}
    >
      {countdown}
    </Badge>
  );
}

export default function LegacyProductActions({ product }: Props) {
  const router = useRouter();
  const { data: session } = useSession();
  const {
    config: groupConfig,
    loading: groupLoading,
    error: groupError,
    retry: retryGroupConfig,
  } = useGroupProduct(product.saleType === 'group' ? product.id : null);
  const { store } = useStore(product.storeId ?? null);
  const { addItem } = useCart();

  const [quantity, setQuantity] = useState(1);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('direct');
  const [groupConsent, setGroupConsent] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState<string | null>(null);

  const isGroup = product.saleType === 'group';
  // read failure는 missing과 구분되는 fail-closed 상태다. 이전 config가 표시용으로
  // 남아 있더라도 최신 error가 있으면 구매 가능으로 판정하지 않는다.
  const isGroupLoading = isGroup && groupLoading;
  const isGroupReadError = isGroup && !groupLoading && groupError != null;
  const groupStatus = isGroup ? getGroupBuyStatus(groupConfig) : 'open';
  const isFull = !isGroupLoading && !isGroupReadError && groupStatus === 'full';
  const isExpired = !isGroupLoading && !isGroupReadError && groupStatus === 'expired';
  const isGroupUnavailable =
    isGroup && (isGroupLoading || isGroupReadError || groupStatus !== 'open');
  const unavailableLabel = isGroupLoading
    ? '상품 확인 중'
    : isGroupReadError
      ? '공동구매 정보를 불러오지 못했습니다'
      : isExpired
        ? '모집 마감'
        : isFull
          ? '모집 완료'
          : '판매 준비 중';
  const totalAmount = product.price * quantity;
  // 일반 상품의 배송일 선택은 슬롯 검증 대상(택배 제외)일 때만 필수.
  // 택배는 slot 미검증 분기이므로 배송일도 불필요 (플랜 D3 분기 조건 일치).
  const needsDeliveryDate = !isGroup && deliveryMethod !== 'parcel';
  // group은 config read 확정(open) 전에는 fail-closed: loading/read-failure에서 구매 불가.
  const canBuy = isGroup
    ? groupConsent && !isGroupUnavailable && !isGroupLoading && !isGroupReadError
    : !needsDeliveryDate || deliveryDate !== null;

  function handleAddToCart() {
    if (isGroupUnavailable || isGroupLoading || isGroupReadError) return;
    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      image: product.images?.[0] ?? '',
      saleType: product.saleType,
      deliveryMethod,
      storeId: product.storeId,
      quantity,
      ...(needsDeliveryDate && deliveryDate ? { requestedDeliveryDate: deliveryDate } : {}),
    });
    router.push('/cart');
  }

  function handleBuyNow() {
    if (isGroupUnavailable || isGroupLoading || isGroupReadError) return;
    const p = new URLSearchParams({
      productId: product.id,
      quantity: String(quantity),
      saleType: product.saleType,
      deliveryMethod,
    });
    if (needsDeliveryDate && deliveryDate) {
      p.set('requestedDeliveryDate', deliveryDate);
    }
    const checkoutUrl = `/checkout?${p.toString()}`;
    if (!session) {
      signIn(undefined, { callbackUrl: checkoutUrl });
      return;
    }
    router.push(checkoutUrl);
  }

  return (
    // ① 외형 유지(UI 교체 P5): Mantine Stack(gap 0·px md·pb 88)·Paper(radius md 8·lg 16, p md·lg)·Group·
    // Text(16/1.55, span도 16/1.55)·Badge filled·Progress(xl 16px·radius xl)·Button·ActionIcon default·
    // Checkbox·Divider 계산값. 예전 판매 화면이라 구성은 그대로 둔다(design-standard.md §5).
    <div className="flex flex-col items-stretch justify-start gap-0 px-4 pb-[88px]">
      {/* 공동구매 실시간 현황 */}
      {isGroup && groupConfig && (
        <div
          className="mb-5 block rounded-[16px] p-5"
          style={{
            border: `2px solid ${isGroupUnavailable ? 'var(--color-border)' : 'var(--color-primary)'}`,
            background: isGroupUnavailable
              ? 'var(--color-surface-muted)'
              : 'var(--color-primary-surface)',
          }}
        >
          <div className="mb-4 flex flex-row flex-wrap items-center justify-between gap-4">
            <p
              className="m-0 p-0 text-base"
              style={{
                fontWeight: 'var(--fw-bold)',
                color: isGroupUnavailable
                  ? 'var(--color-text-secondary)'
                  : 'var(--color-primary-dark)',
              }}
            >
              ⚡ 공동구매 현황
            </p>
            {isGroupUnavailable ? (
              <Badge className="rounded-[32px] bg-[#868e96] text-white">{unavailableLabel}</Badge>
            ) : (
              <GroupCountdownBadge deadline={groupConfig?.recruitDeadline} />
            )}
          </div>

          <div className="mb-4 text-center">
            <p
              className="m-0 p-0"
              style={{
                fontSize: 36,
                fontWeight: 'var(--fw-bold)',
                lineHeight: 1,
                color: isGroupUnavailable
                  ? 'var(--color-text-disabled)'
                  : 'var(--color-primary-dark)',
              }}
            >
              {groupConfig.currentQuantity}
              <span
                className="m-0 p-0 leading-[1.55]"
                style={{
                  fontSize: 18,
                  fontWeight: 'var(--fw-medium)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {' '}
                / {groupConfig.targetQuantity}개
              </span>
            </p>
            <p
              className="m-0 mt-1 p-0 leading-[1.55] font-normal"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              최소 {groupConfig.minQuantity}개 이상 모이면 확정
            </p>
          </div>

          <Progress
            value={Math.min((groupConfig.currentQuantity / groupConfig.minQuantity) * 100, 100)}
            className="mb-4 h-4 rounded-[32px]"
            indicatorClassName={isGroupUnavailable ? 'bg-[#868e96]' : undefined}
          />

          <div className="flex flex-row flex-wrap items-center justify-between gap-4">
            <p
              className="m-0 p-0 leading-[1.55] font-normal"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              마감{' '}
              <span
                className="m-0 p-0 text-base"
                style={{
                  fontWeight: 'var(--fw-bold)',
                  color: isGroupUnavailable
                    ? 'var(--color-text-secondary)'
                    : 'var(--color-primary-dark)',
                }}
              >
                {new Date(groupConfig.recruitDeadline).toLocaleString('ko-KR', {
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </p>
            <p
              className="m-0 p-0 leading-[1.55] font-normal"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              배송{' '}
              <span
                className="m-0 p-0 text-base"
                style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-primary-dark)' }}
              >
                {new Date(groupConfig.groupDeliveryDate).toLocaleDateString('ko-KR', {
                  month: 'long',
                  day: 'numeric',
                  weekday: 'short',
                })}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* group config read failure: missing과 구분되는 recovery 상태. 구매 CTA는 fail-closed. */}
      {isGroupReadError && (
        <div
          className="mb-5 block rounded-[8px] p-4"
          data-testid="group-config-error"
          style={{
            background: 'var(--color-caution-bg)',
            border: '1px solid var(--color-caution-border)',
          }}
        >
          <p
            className="m-0 mb-1 p-0 leading-[1.55]"
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text)',
              fontWeight: 'var(--fw-bold)',
            }}
          >
            공동구매 정보를 불러오지 못했습니다
          </p>
          <p
            className="m-0 mb-3 p-0 leading-[1.55] font-normal"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            네트워크 상태를 확인한 뒤 다시 시도해 주세요. 정보를 확인할 때까지 구매할 수 없습니다.
          </p>
          <Button
            variant="plain"
            className="rounded-[8px]"
            data-testid="group-config-retry"
            onClick={retryGroupConfig}
          >
            다시 시도
          </Button>
        </div>
      )}

      <div
        className="mb-4 block rounded-[8px] p-4"
        style={{ background: 'var(--color-surface-muted)' }}
      >
        <p
          className="m-0 mb-3 p-0 leading-[1.55]"
          style={{
            fontWeight: 'var(--fw-bold)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text)',
          }}
        >
          배송 방법
        </p>
        <div className="flex flex-row flex-wrap items-center justify-start gap-2.5">
          {(['direct', 'hub', 'parcel'] as DeliveryMethod[]).map((method) => (
            <Button
              key={method}
              variant={deliveryMethod === method ? 'default' : 'plain'}
              className="flex-1 rounded-[8px]"
              onClick={() => setDeliveryMethod(method)}
            >
              {deliveryLabels[method]}
            </Button>
          ))}
        </div>
      </div>

      {/* 일반 상품 배송일 선택 — 공동구매는 groupConfig 고정, 택배는 슬롯 미검증이라 미노출 */}
      {needsDeliveryDate && (
        <DeliveryDatePicker
          storeId={product.storeId ?? null}
          value={deliveryDate}
          onChange={setDeliveryDate}
        />
      )}

      <div
        className="mb-5 block rounded-[8px] p-4"
        style={{ background: 'var(--color-surface-muted)' }}
      >
        <p
          className="m-0 mb-3 p-0 leading-[1.55]"
          style={{
            fontWeight: 'var(--fw-bold)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text)',
          }}
        >
          수량
        </p>
        <div className="flex flex-row flex-wrap items-center justify-start gap-3">
          <button
            type="button"
            className={QUANTITY_BUTTON}
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
          >
            −
          </button>
          <p
            className="m-0 w-8 p-0 text-center leading-[1.55]"
            style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--fw-bold)' }}
          >
            {quantity}
          </p>
          <button
            type="button"
            className={QUANTITY_BUTTON}
            onClick={() => {
              const maxQty = isGroup && groupConfig ? groupConfig.maxPerPerson : 99;
              setQuantity(Math.min(maxQty, quantity + 1));
            }}
          >
            +
          </button>
        </div>
        {isGroup && groupConfig && (
          <p
            className="m-0 mt-1.5 p-0 leading-[1.55] font-normal"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            1인 최대 {groupConfig.maxPerPerson}개까지 구매 가능
          </p>
        )}
      </div>

      {isGroup && (
        <div
          className="mb-5 block rounded-[8px] p-4"
          style={{
            background: 'var(--color-caution-bg)',
            border: '1px solid var(--color-caution-border)',
          }}
        >
          <Checkbox
            checked={groupConsent}
            onCheckedChange={setGroupConsent}
            label={
              <p
                className="m-0 p-0 font-normal"
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-secondary)',
                  lineHeight: 1.6,
                }}
              >
                공동구매{' '}
                <span className="m-0 p-0 text-base" style={{ fontWeight: 'var(--fw-bold)' }}>
                  확정 이후 취소·환불이 불가
                </span>
                함을 이해하고 동의합니다. (전자상거래법 제17조)
              </p>
            }
          />
        </div>
      )}

      {/* Mantine Divider: 1px gray-3 윗선, 역할 separator(가로) */}
      <hr className="m-0 mb-8 h-0 border-0 border-t border-solid border-[#dee2e6]" />
      <div className="mb-8">
        <GreenLoveBrandSection />
      </div>

      {store && (
        <div className="pt-8" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p
            className="m-0 mb-3 p-0 leading-[1.55]"
            style={{
              fontWeight: 'var(--fw-bold)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
            }}
          >
            판매자 정보
          </p>
          <div className="mb-3 flex flex-row flex-wrap items-center justify-start gap-3">
            {store.logoUrl ? (
              <ResilientImage
                src={store.logoUrl}
                alt={store.name}
                width={44}
                height={44}
                fallback={<StoreInitialAvatar name={store.name} />}
                style={{ borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <StoreInitialAvatar name={store.name} />
            )}
            <div>
              <p
                className="m-0 p-0 leading-[1.55]"
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-bold)',
                  color: 'var(--color-text)',
                }}
              >
                {store.name}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-stretch justify-start gap-1">
            <p
              className="m-0 p-0 leading-[1.55] font-normal"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              📍 {PUBLIC_BUSINESS_INFO.address}
            </p>
            <p
              className="m-0 p-0 leading-[1.55] font-normal"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              📞 {PUBLIC_BUSINESS_INFO.phone}
            </p>
          </div>
        </div>
      )}

      <ProductCTABar
        totalAmount={totalAmount}
        isGroup={isGroup}
        isUnavailable={isGroupUnavailable}
        unavailableLabel={unavailableLabel}
        canBuy={canBuy}
        onAddToCart={handleAddToCart}
        onBuyNow={handleBuyNow}
      />
    </div>
  );
}
