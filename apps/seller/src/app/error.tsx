'use client';

import { Box, Container, Stack, Text, Title } from '@mantine/core';
import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';

const actionStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--touch-target)',
  padding: '0 24px',
  borderRadius: 'var(--radius-full)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-bold)',
  textDecoration: 'none',
  cursor: 'pointer',
} as const;

// 화면을 그리다 런타임 오류가 났을 때 Next 기본(영어) 오류 화면 대신 보여주는 안내 화면.
// 소비자 앱(#568)과 같은 모양이다. 오류 메시지·스택은 보이지 않게 하고,
// 서버 기록과 맞춰볼 digest만 작게 보여준다.
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <Container size="sm" px="md" py={64}>
      <title>잠시 문제가 생겼어요</title>
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
          <TriangleAlert size={32} strokeWidth={1.8} />
        </Box>
        <Title
          order={1}
          ta="center"
          style={{
            color: 'var(--color-text)',
            fontSize: 'var(--font-size-lg)',
            fontWeight: 'var(--fw-bold)',
          }}
        >
          잠시 문제가 생겼어요
        </Title>
        <Text
          ta="center"
          c="var(--color-text-secondary)"
          style={{ fontSize: 'var(--font-size-sm)', wordBreak: 'keep-all' }}
        >
          화면을 불러오는 중에 문제가 생겼어요.
          <br />
          잠시 뒤 다시 시도해 주세요. 입력하던 내용은 저장되지 않았을 수 있어요.
        </Text>
        <Stack gap="xs" w="100%" maw={280}>
          {/* retry는 서버 데이터를 다시 받아 화면을 다시 그린다(reset은 다시 그리기만 한다) */}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              ...actionStyle,
              border: 'none',
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-bg)',
            }}
          >
            다시 시도
          </button>
          <Link
            href="/"
            style={{
              ...actionStyle,
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
          >
            홈으로 가기
          </Link>
        </Stack>
        <Text
          ta="center"
          c="var(--color-text-secondary)"
          style={{ fontSize: 'var(--font-size-sm)', wordBreak: 'keep-all' }}
        >
          계속 같은 화면이 나오면 아래 오류 번호와 함께 운영팀에 알려 주세요.
        </Text>
        {error.digest ? (
          <Text
            ta="center"
            c="var(--color-text-secondary)"
            style={{ fontSize: 'var(--font-size-sm)' }}
          >
            오류 번호 {error.digest}
          </Text>
        ) : null}
      </Stack>
    </Container>
  );
}
