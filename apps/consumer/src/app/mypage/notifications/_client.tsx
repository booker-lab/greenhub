'use client';

import type { Notification, NotificationTemplateCode } from '@greenhub/shared';
import { Alert, AlertDescription } from '@greenhub/ui/components/alert';
import { Button } from '@greenhub/ui/components/button';
import {
  AlarmClock,
  Bell,
  BellOff,
  CalendarClock,
  ChevronLeft,
  CircleCheck,
  CirclePause,
  CircleX,
  CreditCard,
  type LucideIcon,
  MapPin,
  Package,
  PackageCheck,
  TriangleAlert,
  Truck,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect } from 'react';
import { useNotifications } from '@/hooks/useNotifications';

const TEMPLATE_LABELS: Record<NotificationTemplateCode, string> = {
  ORDER_ACCEPTED: '결제 완료',
  ORDER_PREPARING: '상품 준비 중',
  ORDER_DELIVERING: '배송 시작',
  ORDER_DELIVERY_HELD: '배송 보류',
  ORDER_REDELIVERY_PAYMENT_REQUESTED: '재배송비 결제 요청',
  ORDER_REDELIVERY_SCHEDULED: '재배송 예정',
  ORDER_HUB_ARRIVED: '거점 도착',
  ORDER_DELIVERED: '배송 완료',
  ORDER_CANCELLED: '주문 취소',
  ROUND_ORDER_CONFIRMED: '회차 주문 확정',
  OPERATION_ISSUE_CREATED: '주문 처리 확인 필요',
  CUSTOMER_NOTICE_FAILED: '안내 전송 실패',
  GROUP_JOINED: '공동구매 참여',
  GROUP_DEADLINE_SOON: '공동구매 마감 임박',
  GROUP_CONFIRMED: '공동구매 확정',
  GROUP_CANCELLED_LACK: '공동구매 취소 (인원 미달)',
  GROUP_CANCELLED_SELF: '공동구매 취소',
  GROUP_PREPARING: '공동구매 준비 중',
  GROUP_DELIVERING: '공동구매 배송 시작',
  GROUP_DELIVERED: '공동구매 배송 완료',
};

type NoticeTone = 'success' | 'waiting' | 'danger';

const NOTICE_TONE: Record<NoticeTone, { background: string; color: string }> = {
  success: { background: 'var(--color-primary-surface)', color: 'var(--color-primary-dark)' },
  waiting: { background: 'var(--color-deadline-surface)', color: 'var(--color-deadline-text)' },
  danger: { background: 'var(--color-danger-surface)', color: 'var(--color-danger)' },
};

// 알림 종류별 선 아이콘과 색(디자인 기준: 이모지 대신 색 원 + 선 아이콘)
const TEMPLATE_ICONS: Record<NotificationTemplateCode, { Icon: LucideIcon; tone: NoticeTone }> = {
  ORDER_ACCEPTED: { Icon: CircleCheck, tone: 'success' },
  ORDER_PREPARING: { Icon: Package, tone: 'success' },
  ORDER_DELIVERING: { Icon: Truck, tone: 'success' },
  ORDER_DELIVERY_HELD: { Icon: CirclePause, tone: 'danger' },
  ORDER_REDELIVERY_PAYMENT_REQUESTED: { Icon: CreditCard, tone: 'danger' },
  ORDER_REDELIVERY_SCHEDULED: { Icon: CalendarClock, tone: 'waiting' },
  ORDER_HUB_ARRIVED: { Icon: MapPin, tone: 'success' },
  ORDER_DELIVERED: { Icon: PackageCheck, tone: 'success' },
  ORDER_CANCELLED: { Icon: CircleX, tone: 'danger' },
  ROUND_ORDER_CONFIRMED: { Icon: CircleCheck, tone: 'success' },
  OPERATION_ISSUE_CREATED: { Icon: TriangleAlert, tone: 'danger' },
  CUSTOMER_NOTICE_FAILED: { Icon: BellOff, tone: 'danger' },
  GROUP_JOINED: { Icon: Users, tone: 'success' },
  GROUP_DEADLINE_SOON: { Icon: AlarmClock, tone: 'waiting' },
  GROUP_CONFIRMED: { Icon: CircleCheck, tone: 'success' },
  GROUP_CANCELLED_LACK: { Icon: CircleX, tone: 'danger' },
  GROUP_CANCELLED_SELF: { Icon: CircleX, tone: 'danger' },
  GROUP_PREPARING: { Icon: Package, tone: 'success' },
  GROUP_DELIVERING: { Icon: Truck, tone: 'success' },
  GROUP_DELIVERED: { Icon: PackageCheck, tone: 'success' },
};

// ① 외형 유지(UI 교체 P5): Mantine Group(gap xs 10, wrap)·Stack·Text(p, 줄 높이 1.55, size xl은 20px·1.65)·
// Alert light red(안쪽 16)·Button transparent(왼쪽 여백 0)·Button default xs(radius xl)와 같은 값.
const TEXT = 'm-0 p-0 leading-[1.55]';
const DEFAULT_BUTTON_XS = { variant: 'plain', size: 'xs' } as const;
const DISABLED_TEXT_STYLE = {
  color: 'var(--color-text-disabled)',
  fontSize: 'var(--font-size-sm)',
} as const;
const SMALL_TEXT_STYLE = { fontSize: 'var(--font-size-sm)' } as const;

const DEFAULT_ICON = { Icon: Bell, tone: 'success' as NoticeTone };

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return '방금 전';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function extractProductName(n: Notification): string | null {
  try {
    const vars = JSON.parse(n.message) as Record<string, string>;
    return vars.productName ?? null;
  } catch {
    return null;
  }
}

function NotificationItem({
  notification,
  isRead,
  onRead,
  onOrderClick,
}: {
  notification: Notification;
  isRead: boolean;
  onRead: () => void;
  onOrderClick: () => void;
}) {
  const label = TEMPLATE_LABELS[notification.templateCode] ?? notification.templateCode;
  const { Icon, tone } = TEMPLATE_ICONS[notification.templateCode] ?? DEFAULT_ICON;
  const productName = extractProductName(notification);
  const date = formatDate(notification.sentAt ?? notification.createdAt);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 교체 전(Mantine Box)과 같은 div다. 역할 변경은 ② 단계에서 다룬다.
    // biome-ignore lint/a11y/useKeyWithClickEvents: 위와 같다.
    <div
      onClick={() => {
        onRead();
        if (notification.orderId) onOrderClick();
      }}
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 16px',
        background: isRead ? 'var(--color-bg)' : 'var(--color-primary-surface)',
        borderBottom: '1px solid var(--color-border)',
        cursor: notification.orderId ? 'pointer' : 'default',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          ...NOTICE_TONE[tone],
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
        aria-hidden
      >
        <Icon size={18} strokeWidth={2.2} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex flex-row flex-wrap items-start justify-between gap-2.5">
          <p
            className={TEXT}
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: isRead ? 'var(--fw-medium)' : 'var(--fw-bold)',
              color: 'var(--color-text)',
            }}
          >
            {label}
          </p>
          <p
            className={TEXT}
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-disabled)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {date}
          </p>
        </div>
        {productName && (
          <p
            className={`${TEXT} mt-[3px]`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            {productName}
          </p>
        )}
        {notification.orderId && (
          <p
            className={`${TEXT} mt-[3px]`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-dark)' }}
          >
            주문 상세 보기 ›
          </p>
        )}
      </div>

      {!isRead && (
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--color-primary)',
            flexShrink: 0,
            marginTop: 6,
          }}
        />
      )}
    </div>
  );
}

export default function NotificationsClient() {
  const { status } = useSession();
  const router = useRouter();
  const { notifications, readIds, loading, error, refetch, markAllRead, markRead } =
    useNotifications();

  useEffect(() => {
    // authoritative successful load에서만 자동 읽음 처리한다.
    // stale list + failure 상태에서는 read receipt 의미를 바꾸지 않는다.
    if (!loading && !error && notifications.length > 0) {
      markAllRead();
    }
  }, [loading, error, notifications.length, markAllRead]);

  if (status === 'unauthenticated') {
    router.replace('/login');
    return null;
  }

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 80 }}>
      <div
        className="flex flex-row flex-wrap items-center justify-start gap-2.5 px-4 pt-5 pb-3"
        style={{
          position: 'sticky',
          top: 0,
          background: 'var(--color-bg)',
          zIndex: 10,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <Button
          type="button"
          variant="ghost"
          className="ps-0 hover:bg-transparent"
          style={{ color: 'var(--color-text)' }}
          onClick={() => router.back()}
        >
          <ChevronLeft size={20} className="size-5" />
        </Button>
        <p
          className={TEXT}
          style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-lg)', flex: 1 }}
        >
          알림 내역
        </p>
        {unreadCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="hover:bg-transparent"
            style={{ color: 'var(--color-primary-dark)' }}
            onClick={markAllRead}
          >
            모두 읽음
          </Button>
        )}
      </div>

      {loading && notifications.length === 0 && (
        <p className={`${TEXT} py-[60px] text-center`} style={DISABLED_TEXT_STYLE}>
          불러오는 중...
        </p>
      )}

      {!loading && error && notifications.length === 0 && (
        <div className="flex flex-col items-stretch justify-start gap-2.5 p-4">
          <Alert role="alert" variant="destructive">
            <AlertDescription>
              <p className={TEXT} style={SMALL_TEXT_STYLE}>
                {error}
              </p>
            </AlertDescription>
          </Alert>
          <Button
            type="button"
            {...DEFAULT_BUTTON_XS}
            onClick={refetch}
            data-testid="notifications-retry"
          >
            다시 시도
          </Button>
        </div>
      )}

      {!loading && !error && notifications.length === 0 && (
        <div className="flex flex-col items-center justify-start gap-4 px-5 py-[60px]">
          <p className="m-0 p-0 text-[20px] leading-[1.65]">🔔</p>
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            알림 내역이 없습니다.
          </p>
        </div>
      )}

      {notifications.length > 0 && (
        <div>
          {loading && (
            <p className={`${TEXT} py-3 text-center`} style={DISABLED_TEXT_STYLE}>
              업데이트 중...
            </p>
          )}
          {error && (
            <div className="p-4">
              <Alert role="alert" variant="destructive">
                <AlertDescription>
                  <p className={TEXT} style={SMALL_TEXT_STYLE}>
                    최신 알림을 불러오지 못했습니다. 이전 목록을 표시합니다.
                  </p>
                  <p className={`${TEXT} mt-1`} style={SMALL_TEXT_STYLE}>
                    {error}
                  </p>
                </AlertDescription>
              </Alert>
              <Button
                type="button"
                {...DEFAULT_BUTTON_XS}
                className="mt-2.5"
                onClick={refetch}
                data-testid="notifications-retry"
              >
                다시 시도
              </Button>
            </div>
          )}
          {notifications.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              isRead={readIds.has(n.id)}
              onRead={() => markRead(n.id)}
              onOrderClick={() => n.orderId && router.push(`/mypage/orders/${n.orderId}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
