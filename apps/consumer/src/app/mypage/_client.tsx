'use client';

import type { Order, OrderStatus } from '@greenhub/shared';
import { Button, ButtonLink } from '@greenhub/ui/components/button';
import { StatusDot, type StatusDotTone } from '@greenhub/ui/components/status-dot';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect } from 'react';
import A2HSButton from '@/components/A2HSButton';
import ResilientImage, { PRODUCT_IMAGE_FALLBACK } from '@/components/ResilientImage';
import { useOrders } from '@/hooks/useOrders';
import { isFeatureOn } from '@/lib/features';
import { orderListPendingPaymentNotice } from '@/lib/order-pending-payment';
import { ORDER_STATUS_LABELS as STATUS_LABELS } from '@/lib/order-status';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';
import { currentMyPageLoginUrl } from './_login';

// ② 방향(design-standard §5, 판매자 주문 상태와 같은 규칙): 상태는 배지 면 없이 점 + 글자. 문제=빨강, 끝났거나 멈춘 상태=회색, 나머지 검정.
const STATUS_TONES: Partial<Record<OrderStatus, StatusDotTone>> = {
  PENDING: 'done',
  DELIVERY_HELD: 'problem',
  DELIVERED: 'done',
  CANCELLED: 'done',
  REVIEWED: 'done',
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
  const tone = STATUS_TONES[order.status] ?? 'default';
  const label = STATUS_LABELS[order.status] ?? order.status;
  const summary = readOrderListSummary(order);
  // 결제 확인 중 주문은 결제를 끝내지 않은 시도일 수 있어 실제 접수된 주문과 구분되게 설명 한 줄을 붙인다.
  const pendingNotice = orderListPendingPaymentNotice(order.status);

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="order-card"
      className={UNSTYLED_BUTTON}
      style={{
        display: 'block',
        width: '100%',
        background: 'var(--color-surface-muted)',
        borderRadius: 'var(--radius)',
        padding: '16px',
      }}
    >
      <div className="mb-2 flex flex-row flex-wrap items-center justify-between gap-4">
        <StatusDot tone={tone} size={13} className="font-bold">
          {label}
        </StatusDot>
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
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
            background: 'var(--color-bg)',
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
      {pendingNotice && (
        <p
          className={`${TEXT} mt-3`}
          data-testid="order-card-pending-notice"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          {pendingNotice}
        </p>
      )}
    </button>
  );
}

export default function MyPageClient() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { orders, loading, error, refetch } = useOrders();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(currentMyPageLoginUrl());
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="py-[60px] text-center">
        <p className={`${TEXT} text-[16px]`} style={{ color: 'var(--color-text-secondary)' }}>
          로딩 중...
        </p>
      </div>
    );
  }

  if (!session) return null;

  const disabledTextStyle = {
    color: 'var(--color-text-secondary)',
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
        style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius)' }}
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
        {/* 빈 상태는 "구매한 꽃" 화면과 같은 관례(안내 + 이번 회차 보러 가기)로 다음 행동을 준다. */}
        {!loading && !error && orders.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className={TEXT} style={disabledTextStyle}>
              아직 주문한 꽃이 없어요.
            </p>
            <ButtonLink render={<Link href="/" />}>이번 회차 보러 가기</ButtonLink>
          </div>
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
              background: 'var(--color-surface-muted)',
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
              background: 'var(--color-surface-muted)',
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
          <SupportCallLink />
          <MenuLink label="회원 탈퇴" onClick={() => router.push('/mypage/withdraw')} />
        </div>
      </div>

      {/* 앱 설치: A2HSButton은 설치 프롬프트가 없는 브라우저(iOS Safari·인앱 브라우저 등)에서 아무것도
          그리지 않는다. 제목만 남지 않도록 묶음 안에 버튼(button)이 그려졌을 때만 묶음 전체를 보인다. */}
      <div className="hidden has-[button]:block" data-testid="mypage-install">
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
        background: 'var(--color-surface-muted)',
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

// 고객센터 전화 연결. 번호·상담 시간은 footer와 같은 공개 사업자 정보(PUBLIC_BUSINESS_INFO)를 쓴다.
function SupportCallLink() {
  return (
    <a
      href={PUBLIC_BUSINESS_INFO.phoneHref}
      data-testid="mypage-support-call"
      className={UNSTYLED_BUTTON}
      style={{
        alignItems: 'center',
        background: 'var(--color-surface-muted)',
        borderRadius: 'var(--radius)',
        display: 'flex',
        gap: 12,
        justifyContent: 'space-between',
        minHeight: 'var(--touch-target)',
        padding: '14px 16px',
        width: '100%',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p
          className={TEXT}
          style={{
            color: 'var(--color-text)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          고객센터 전화 {PUBLIC_BUSINESS_INFO.phone}
        </p>
        <p
          className={TEXT}
          style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}
        >
          상담 시간 {PUBLIC_BUSINESS_INFO.supportHours}
        </p>
      </div>
      <ChevronRight size={18} color="var(--color-text-disabled)" aria-hidden />
    </a>
  );
}
