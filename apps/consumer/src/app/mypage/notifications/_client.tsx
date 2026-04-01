'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useNotifications } from '@/hooks/useNotifications'
import type { Notification, NotificationTemplateCode } from '@greenhub/shared'

// ── 템플릿 코드 → 한글 레이블 ───────────────────────────────
const TEMPLATE_LABELS: Record<NotificationTemplateCode, string> = {
  ORDER_ACCEPTED: '결제 완료',
  ORDER_PREPARING: '상품 준비 중',
  ORDER_DELIVERING: '배송 시작',
  ORDER_HUB_ARRIVED: '거점 도착',
  ORDER_DELIVERED: '배송 완료',
  ORDER_CANCELLED: '주문 취소',
  GROUP_JOINED: '공동구매 참여',
  GROUP_DEADLINE_SOON: '공동구매 마감 임박',
  GROUP_CONFIRMED: '공동구매 확정',
  GROUP_CANCELLED_LACK: '공동구매 취소 (인원 미달)',
  GROUP_CANCELLED_SELF: '공동구매 취소',
  GROUP_PREPARING: '공동구매 준비 중',
  GROUP_DELIVERING: '공동구매 배송 시작',
  GROUP_DELIVERED: '공동구매 배송 완료',
}

const TEMPLATE_ICONS: Record<NotificationTemplateCode, string> = {
  ORDER_ACCEPTED: '✅',
  ORDER_PREPARING: '📦',
  ORDER_DELIVERING: '🚚',
  ORDER_HUB_ARRIVED: '📍',
  ORDER_DELIVERED: '🎉',
  ORDER_CANCELLED: '❌',
  GROUP_JOINED: '👥',
  GROUP_DEADLINE_SOON: '⏰',
  GROUP_CONFIRMED: '✅',
  GROUP_CANCELLED_LACK: '❌',
  GROUP_CANCELLED_SELF: '❌',
  GROUP_PREPARING: '📦',
  GROUP_DELIVERING: '🚚',
  GROUP_DELIVERED: '🎉',
}

// ── 날짜 포맷 ────────────────────────────────────────────────
function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60_000) return '방금 전'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

// ── variables 파싱 → productName 추출 ───────────────────────
function extractProductName(n: Notification): string | null {
  try {
    const vars = JSON.parse(n.message) as Record<string, string>
    return vars['productName'] ?? null
  } catch {
    return null
  }
}

// ── NotificationItem ─────────────────────────────────────────
function NotificationItem({
  notification,
  isRead,
  onRead,
  onOrderClick,
}: {
  notification: Notification
  isRead: boolean
  onRead: () => void
  onOrderClick: () => void
}) {
  const label = TEMPLATE_LABELS[notification.templateCode] ?? notification.templateCode
  const icon = TEMPLATE_ICONS[notification.templateCode] ?? '🔔'
  const productName = extractProductName(notification)
  const date = formatDate(notification.sentAt ?? notification.createdAt)

  return (
    <div
      onClick={() => { onRead(); if (notification.orderId) onOrderClick() }}
      style={{
        display: 'flex',
        gap: '12px',
        padding: '14px 16px',
        background: isRead ? '#fff' : '#F0F7F4',
        borderBottom: '1px solid #f0f0f0',
        cursor: notification.orderId ? 'pointer' : 'default',
        transition: 'background 0.15s',
      }}
    >
      {/* 아이콘 */}
      <div
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: '#e8f5e9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>

      {/* 내용 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: isRead ? '500' : '700', color: '#222' }}>
            {label}
          </span>
          <span style={{ fontSize: '11px', color: '#aaa', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {date}
          </span>
        </div>
        {productName && (
          <div style={{ fontSize: '12px', color: '#666', marginTop: '3px' }}>{productName}</div>
        )}
        {notification.orderId && (
          <div style={{ fontSize: '11px', color: '#2D6A4F', marginTop: '3px' }}>주문 상세 보기 ›</div>
        )}
      </div>

      {/* 안읽음 점 */}
      {!isRead && (
        <div
          style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: '#2D6A4F',
            flexShrink: 0,
            marginTop: '6px',
          }}
        />
      )}
    </div>
  )
}

// ── 메인 클라이언트 ──────────────────────────────────────────
export default function NotificationsClient() {
  const { status } = useSession()
  const router = useRouter()
  const { notifications, readIds, loading, error, markAllRead, markRead } = useNotifications()

  // 페이지 진입 시 전체 읽음 처리
  useEffect(() => {
    if (!loading && notifications.length > 0) {
      markAllRead()
    }
  }, [loading, notifications.length, markAllRead])

  if (status === 'unauthenticated') {
    router.replace('/login')
    return null
  }

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length

  return (
    <main style={{ maxWidth: '480px', margin: '0 auto', paddingBottom: '80px' }}>
      {/* 헤더 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '20px 16px 12px',
          borderBottom: '1px solid #f0f0f0',
          position: 'sticky',
          top: 0,
          background: '#fff',
          zIndex: 10,
        }}
      >
        <button
          onClick={() => router.back()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#333', padding: '0 4px 0 0' }}
        >
          ←
        </button>
        <h1 style={{ fontSize: '18px', fontWeight: '700', flex: 1 }}>알림 내역</h1>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            style={{ fontSize: '12px', color: '#2D6A4F', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
          >
            모두 읽음
          </button>
        )}
      </div>

      {/* 오류 */}
      {error && (
        <div
          style={{
            margin: '16px',
            background: '#FFF3F3',
            border: '1px solid #F5C6C6',
            borderRadius: '8px',
            padding: '12px 14px',
            fontSize: '13px',
            color: '#C62828',
          }}
        >
          {error}
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div style={{ textAlign: 'center', color: '#999', padding: '60px 0', fontSize: '14px' }}>
          불러오는 중...
        </div>
      )}

      {/* 빈 상태 */}
      {!loading && !error && notifications.length === 0 && (
        <div style={{ textAlign: 'center', color: '#999', padding: '60px 24px', fontSize: '14px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔔</div>
          알림 내역이 없습니다.
        </div>
      )}

      {/* 목록 */}
      {!loading && notifications.length > 0 && (
        <div>
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
    </main>
  )
}
