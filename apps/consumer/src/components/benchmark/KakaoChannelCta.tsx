'use client';

import { Box, Text } from '@mantine/core';
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
    <Box
      component="section"
      aria-label="오픈 알림 받기"
      p={compact ? 'sm' : 'md'}
      style={{
        alignItems: 'center',
        background: 'var(--color-deadline-surface)',
        borderRadius: 'var(--radius)',
        display: 'flex',
        gap: 12,
        justifyContent: 'space-between',
      }}
    >
      <Box style={{ minWidth: 0 }}>
        <Text style={{ color: 'var(--color-deadline-text)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}>
          {title}
        </Text>
        {!compact && (
          <Text mt={2} style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            {description}
          </Text>
        )}
      </Box>
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
    </Box>
  );
}
