'use client';

import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';

// 주문 시작 전 회차의 "오픈 알림 받기"(기능 토글 open-alert).
// 자체 알림 신청은 마케팅 동의가 필요해 파일럿에서 쓰지 않으므로, 카카오 채널 추가로 안내한다.
export default function KakaoChannelCta({
  title = '주문이 열리면 카카오톡으로 알려드려요',
  description = '그린러브 채널을 추가하면 회차 오픈 소식을 받을 수 있어요.',
  compact = false,
}: {
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    // ① 외형 유지(UI 교체 P6): Mantine Box(section, p sm 12px·md 16px)·Text(p, 줄 높이 1.55, 400, 여백 0, mt 2px) 계산값.
    <section
      aria-label="오픈 알림 받기"
      className={compact ? 'p-3' : 'p-4'}
      style={{
        alignItems: 'center',
        background: 'var(--color-deadline-surface)',
        borderRadius: 'var(--radius)',
        display: 'flex',
        gap: 12,
        justifyContent: 'space-between',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p
          className="m-0 p-0 leading-[1.55]"
          style={{
            color: 'var(--color-deadline-text)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
          }}
        >
          {title}
        </p>
        {!compact && (
          <p
            className="m-0 mt-0.5 p-0 font-normal leading-[1.55]"
            style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}
          >
            {description}
          </p>
        )}
      </div>
      <a
        href={PUBLIC_BUSINESS_INFO.kakaoChannel.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          alignItems: 'center',
          background: '#FEE500',
          borderRadius: 'var(--radius-full)',
          color: '#191600',
          display: 'inline-flex',
          flexShrink: 0,
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--fw-extrabold)',
          minHeight: 'var(--touch-target)',
          padding: '0 16px',
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        채널 추가
      </a>
    </section>
  );
}
