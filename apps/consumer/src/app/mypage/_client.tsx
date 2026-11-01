'use client';

import type { Order, OrderStatus } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import { ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect } from 'react';
import A2HSButton from '@/components/A2HSButton';
import ResilientImage, { PRODUCT_IMAGE_FALLBACK } from '@/components/ResilientImage';
import { useOrders } from '@/hooks/useOrders';
import { isFeatureOn } from '@/lib/features';

const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: '결제 확인 중',
  RECRUITING: '모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '결제 완료',
  PREPARING: '상품 준비 중',
  DELIVERING: '배송 중',
  DELIVERY_HELD: '배송 보류',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '주문 취소',
  REVIEWED: '구매 확정',
};

type StatusColorKey = { bg: string; text: string };
const STATUS_COLORS: Partial<Record<OrderStatus, StatusColorKey>> = {
  PENDING: { bg: 'var(--color-surface-muted)', text: 'var(--color-text-secondary)' },
  RECRUITING: { bg: 'var(--color-status-info-bg)', text: 'var(--color-status-info-text)' },
  CONFIRMED: { bg: 'var(--color-status-info-bg)', text: 'var(--color-status-info-text)' },
  ACCEPTED: { bg: 'var(--color-primary-surface)', text: 'var(--color-primary-dark)' },
  PREPARING: { bg: 'var(--color-primary-surface)', text: 'var(--color-primary-dark)' },
  DELIVERING: { bg: 'var(--color-status-warning-bg)', text: 'var(--color-status-warning-text)' },
  DELIVERY_HELD: { bg: 'var(--color-danger-surface)', text: 'var(--color-danger)' },
  HUB_ARRIVED: { bg: 'var(--color-status-warning-bg)', text: 'var(--color-status-warning-text)' },
  PICKED_UP: { bg: 'var(--color-primary-surface)', text: 'var(--color-primary-dark)' },
  DELIVERED: { bg: 'var(--color-primary-surface)', text: 'var(--color-primary-dark)' },
  CANCELLED: { bg: 'var(--color-danger-surface)', text: 'var(--color-danger)' },
  REVIEWED: { bg: 'var(--color-surface-muted)', text: 'var(--color-text-secondary)' },
};

// ① 외형 유지(UI 교체 P5): Mantine Container size sm(720px·좌우 md 16)·Stack·Group(gap md 16 기본, wrap)·
// Title order 1·2(줄 높이 1.3·1.35)·Text(p, 줄 높이 1.55)·UnstyledButton·Button default xs(radius xl)와 같은 값.
const TEXT = 'm-0 p-0 leading-[1.55]';
// Mantine UnstyledButton(+ 초점 링 mantine-focus-auto)과 같은 초기화. 모양은 각 버튼의 style이 준다.
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-[16px] text-inherit no-underline touch-manipulation [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid';
const DEFAULT_BUTTON_XS = { variant: 'plain', size: 'xs' } as const;

const sectionTitleStyle = {
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-lg)',
  fontWeight: 'var(--fw-extrabold)',
} as const;

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

interface OrderListSummary {
  representativeName: string;
  /** 대표(첫) 상품의 주문 시점 사진. 없으면 null → 대체 그림 */
  representativeImageUrl: string | null;
  additionalProductCount: number;
  productCount: number;
  totalQuantity: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function readOrderListSummary(value: unknown): OrderListSummary | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.status) ||
    !Object.hasOwn(STATUS_LABELS, value.status) ||
    !Array.isArray(value.orderItems) ||
    value.orderItems.length === 0
  ) {
    return null;
  }

  const identities = new Set<string>();
  let representativeName = '';
  let representativeImageUrl: string | null = null;
  let totalQuantity = 0;

  for (const item of value.orderItems) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.productId) ||
      !isNonEmptyString(item.productName) ||
      !isPositiveQuantity(item.quantity) ||
      (item.roundItemId !== undefined &&
        item.roundItemId !== null &&
        !isNonEmptyString(item.roundItemId))
    ) {
      return null;
    }

    const identity = isNonEmptyString(item.roundItemId) ? item.roundItemId : item.productId;
    if (identities.has(identity)) return null;
    identities.add(identity);

    if (!representativeName) {
      representativeName = item.productName.trim();
      representativeImageUrl = isNonEmptyString(item.productImageUrl) ? item.productImageUrl : null;
    }
    totalQuantity += item.quantity;
    if (!Number.isSafeInteger(totalQuantity)) return null;
  }

  return {
    representativeName,
    representativeImageUrl,
    additionalProductCount: value.orderItems.length - 1,
    productCount: value.orderItems.length,
    totalQuantity,
  };
}

function OrderCard({ order, onClick }: { order: Order; onClick: () => void }) {
  const colorScheme = STATUS_COLORS[order.status] ?? {
    bg: 'var(--color-surface-muted)',
    text: 'var(--color-text-secondary)',
  };
  const label = STATUS_LABELS[order.status] ?? order.status;
  const summary = readOrderListSummary(order);

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="order-card"
      className={UNSTYLED_BUTTON}
      style={{
        display: 'block',
        width: '100%',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: '16px',
      }}
    >
      <div className="mb-2 flex flex-row flex-wrap items-center justify-between gap-4">
        <div
          style={{
            fontSize: 12,
            fontWeight: 'var(--fw-bold)',
            color: colorScheme.text,
            background: colorScheme.bg,
            padding: '3px 10px',
            borderRadius: 'var(--radius-full)',
          }}
        >
          {label}
        </div>
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          {formatDate(order.createdAt)}
        </p>
      </div>
      <div className="flex flex-row flex-nowrap items-start justify-start gap-3">
        <div
          style={{
            position: 'relative',
            width: 64,
            height: 64,
            flexShrink: 0,
            overflow: 'hidden',
            borderRadius: 12,
            background: 'var(--color-surface-muted)',
          }}
        >
          <ResilientImage
            fill
            src={summary?.representativeImageUrl ?? PRODUCT_IMAGE_FALLBACK}
            fallbackSrc={PRODUCT_IMAGE_FALLBACK}
            alt=""
            sizes="64px"
            style={{ objectFit: 'cover' }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            className={`${TEXT} mb-1`}
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-text)',
            }}
          >
            {order.saleType === 'group' ? '[공동구매] ' : ''}
            {order.deliveryMethod === 'hub'
              ? '거점 픽업'
              : order.deliveryMethod === 'parcel'
                ? '택배'
                : '직배송'}
          </p>
          {summary && (
            <p
              className={`${TEXT} mb-1`}
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-extrabold)',
                color: 'var(--color-text)',
              }}
            >
              {summary.representativeName}
              {summary.additionalProductCount > 0 ? ` 외 ${summary.additionalProductCount}개` : ''}
            </p>
          )}
          <div className="flex flex-row flex-wrap items-baseline justify-between gap-4">
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              {summary
                ? `상품 ${summary.productCount}종 · 총 수량 ${summary.totalQuantity}개`
                : `수량 ${order.quantity}개`}
            </p>
            <p
              className={TEXT}
              style={{
                fontSize: 'var(--font-size-md)',
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 'var(--fw-extrabold)',
                color: 'var(--color-text)',
              }}
            >
              {order.totalAmount.toLocaleString('ko-KR')}원
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}

export default function MyPageClient() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { orders, loading, error, refetch } = useOrders();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="py-[60px] text-center">
        <p className={`${TEXT} text-[16px]`} style={{ color: 'var(--color-text-disabled)' }}>
          로딩 중...
        </p>
      </div>
    );
  }

  if (!session) return null;

  const disabledTextStyle = {
    color: 'var(--color-text-disabled)',
    fontSize: 'var(--font-size-sm)',
  } as const;
  const dangerTextStyle = {
    color: 'var(--color-danger)',
    fontSize: 'var(--font-size-sm)',
  } as const;

  return (
    <div className="mx-auto max-w-[720px] px-4 pt-5 pb-20">
      {/* 프로필 */}
      <div
        className="mb-8 p-5"
        style={{ background: 'var(--color-primary-surface)', borderRadius: 'var(--radius)' }}
      >
        <div className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div>
            <h1
              className="m-0 mb-1 leading-[1.3]"
              style={{
                color: 'var(--color-text)',
                fontSize: 20,
                fontWeight: 'var(--fw-extrabold)',
              }}
            >
              {session.user?.name ?? '사용자'}
            </h1>
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              {session.user?.email}
            </p>
          </div>
          <Button
            type="button"
            {...DEFAULT_BUTTON_XS}
            onClick={() => signOut({ callbackUrl: '/' })}
          >
            로그아웃
          </Button>
        </div>
      </div>

      {/* 주문 내역 */}
      <div className="mb-8">
        <h2 className="m-0 mb-4 leading-[1.35]" style={sectionTitleStyle}>
          주문 내역
        </h2>
        {loading && orders.length === 0 && (
          <p className={`${TEXT} py-5 text-center`} style={disabledTextStyle}>
            불러오는 중...
          </p>
        )}
        {!loading && error && orders.length === 0 && (
          <div className="flex flex-col items-stretch justify-start gap-2.5 py-2.5">
            <p className={TEXT} style={dangerTextStyle}>
              주문 내역을 불러올 수 없습니다.
            </p>
            <Button
              type="button"
              {...DEFAULT_BUTTON_XS}
              onClick={refetch}
              data-testid="orders-retry"
            >
              다시 시도
            </Button>
          </div>
        )}
        {!loading && !error && orders.length === 0 && (
          <p className={`${TEXT} py-8 text-center`} style={disabledTextStyle}>
            주문 내역이 없습니다.
          </p>
        )}
        {orders.length > 0 && (
          <div className="flex flex-col items-stretch justify-start gap-3">
            {loading && (
              <p className={`${TEXT} text-center`} style={disabledTextStyle}>
                업데이트 중...
              </p>
            )}
            {error && (
              <div className="flex flex-row flex-wrap items-center justify-between gap-4">
                <p className={TEXT} style={dangerTextStyle}>
                  최신 주문 내역을 불러오지 못했습니다.
                </p>
                <Button
                  type="button"
                  {...DEFAULT_BUTTON_XS}
                  onClick={refetch}
                  data-testid="orders-retry"
                >
                  다시 시도
                </Button>
              </div>
            )}
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onClick={() => router.push(`/mypage/orders/${order.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 메뉴 */}
      <div className="mb-8">
        <h2 className="m-0 mb-4 leading-[1.35]" style={sectionTitleStyle}>
          내 정보
        </h2>
        <div className="flex flex-col items-stretch justify-start gap-2.5">
          {/* 벤치마킹 비교 기능: 이번 회차 찜(wishlist) */}
          {isFeatureOn('wishlist') && (
            <MenuLink label="이번 회차 찜" onClick={() => router.push('/mypage/wishlist')} />
          )}
          {/* 벤치마킹 비교 기능: 구매한 꽃(purchase-history) */}
          {isFeatureOn('purchase-history') && (
            <MenuLink label="구매한 꽃" onClick={() => router.push('/mypage/purchase-history')} />
          )}
          <button
            type="button"
            onClick={() => router.push('/mypage/notifications')}
            className={UNSTYLED_BUTTON}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              minHeight: 'var(--touch-target)',
              padding: '14px 16px',
            }}
          >
            <p
              className={TEXT}
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--color-text)',
              }}
            >
              알림 내역
            </p>
            <ChevronRight size={18} color="var(--color-text-disabled)" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => router.push('/mypage/addresses')}
            className={UNSTYLED_BUTTON}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              minHeight: 'var(--touch-target)',
              padding: '14px 16px',
            }}
          >
            <p
              className={TEXT}
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--color-text)',
              }}
            >
              배송지 목록 · 추가 · 수정
            </p>
            <ChevronRight size={18} color="var(--color-text-disabled)" aria-hidden />
          </button>
          <MenuLink label="회원 탈퇴" onClick={() => router.push('/mypage/withdraw')} />
        </div>
      </div>

      {/* 앱 설치 */}
      <div>
        <h2 className="m-0 mb-4 leading-[1.35]" style={sectionTitleStyle}>
          앱 설치
        </h2>
        <A2HSButton />
      </div>
    </div>
  );
}

function MenuLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={UNSTYLED_BUTTON}
      style={{
        alignItems: 'center',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        display: 'flex',
        justifyContent: 'space-between',
        minHeight: 'var(--touch-target)',
        padding: '14px 16px',
        width: '100%',
      }}
    >
      <p
        className={TEXT}
        style={{
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--fw-medium)',
        }}
      >
        {label}
      </p>
      <ChevronRight size={18} color="var(--color-text-disabled)" aria-hidden />
    </button>
  );
}
