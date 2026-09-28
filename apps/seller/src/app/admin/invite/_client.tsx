'use client';

import { Box, Group, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { useAdminInvite } from '@/hooks/useAdmin';
import { InviteGenerator } from './_components/InviteGenerator';
import { InviteHistoryTable } from './_components/InviteHistoryTable';
import { ManualCopyModal } from './_components/ManualCopyModal';
import { useTokenCopy } from './_useTokenCopy';

export default function AdminInviteClient() {
  const { invites, loading, error, reload, generating, generateError, generate } =
    useAdminInvite();
  const [lastToken, setLastToken] = useState<{ token: string; expiresAt: string } | null>(null);
  // 복사 로직 SSOT — 발급 직후 토큰과 발급 내역 행별 복사가 공유한다(성공 피드백·실패 폴백 포함).
  const { copiedToken, manualToken, copy, closeManual } = useTokenCopy();
  const copied = lastToken !== null && copiedToken === lastToken.token;

  const handleGenerate = async () => {
    const result = await generate();
    // 성공한 경우에만 lastToken 갱신 — 실패(null)는 이전 성공 token을 덮어쓰지 않는다.
    if (result) setLastToken(result);
  };

  const handleCopy = () => {
    if (!lastToken) return;
    void copy(lastToken.token);
  };

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>초대 토큰 발급</Title>
      </Group>

      <InviteGenerator
        generating={generating}
        lastToken={lastToken}
        copied={copied}
        generateError={generateError}
        onGenerate={handleGenerate}
        onCopy={handleCopy}
      />

      <Text
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--color-text-secondary)',
        }}
        mb="sm"
      >
        발급 내역
      </Text>
      <InviteHistoryTable
        invites={invites}
        loading={loading}
        error={error}
        onRetry={reload}
        copiedToken={copiedToken}
        onCopy={(token) => void copy(token)}
      />
      <ManualCopyModal token={manualToken} onClose={closeManual} />
    </Box>
  );
}
