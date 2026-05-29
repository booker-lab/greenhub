'use client';

import { Box, Group, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useRef, useState } from 'react';
import { useAdminInvite } from '@/hooks/useAdmin';
import { InviteGenerator } from './_components/InviteGenerator';
import { InviteHistoryTable } from './_components/InviteHistoryTable';

export default function AdminInviteClient() {
  const { invites, loading, generating, generate } = useAdminInvite();
  const [lastToken, setLastToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleGenerate = async () => {
    const result = await generate();
    if (result) setLastToken(result);
  };

  const fallbackCopy = (token: string) => {
    const textarea = document.createElement('textarea');
    textarea.value = token;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  };

  const handleCopyToken = async (token: string) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(token);
      ok = true;
    } catch {
      ok = fallbackCopy(token);
    }

    if (!ok) {
      notifications.show({
        color: 'red',
        message: '토큰 복사에 실패했습니다. 브라우저 권한을 확인해 주세요.',
      });
      return;
    }

    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    setCopiedToken(token);
    copyTimerRef.current = setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleCopyLastToken = () => {
    if (!lastToken) return;
    void handleCopyToken(lastToken.token);
  };

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>초대 토큰 발급</Title>
      </Group>

      <InviteGenerator
        generating={generating}
        lastToken={lastToken}
        copied={copiedToken === lastToken?.token}
        onGenerate={handleGenerate}
        onCopy={handleCopyLastToken}
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
        copiedToken={copiedToken}
        onCopyToken={handleCopyToken}
      />
    </Box>
  );
}
