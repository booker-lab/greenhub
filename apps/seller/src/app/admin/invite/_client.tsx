'use client';

import { Box, Button, Group, Text, TextInput, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  type InviteRevokeReason,
  type InviteRollbackReason,
  useAdminInvite,
} from '@/hooks/useAdmin';
import { InviteGenerator } from './_components/InviteGenerator';
import { InviteHistoryTable } from './_components/InviteHistoryTable';

export default function AdminInviteClient() {
  const {
    invites,
    loading,
    loadingMore,
    generating,
    query,
    setQuery,
    hasMore,
    generate,
    revoke,
    rollbackSeller,
    loadMore,
  } = useAdminInvite();
  const [lastToken, setLastToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [expiresInDays, setExpiresInDays] = useState('7');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [rollingBackToken, setRollingBackToken] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState(query);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchValue), 300);
    return () => clearTimeout(timer);
  }, [searchValue, setQuery]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleGenerate = async () => {
    const result = await generate(Number(expiresInDays));
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

  const revokeFailureMessage = (reason: InviteRevokeReason) => {
    if (reason === 'already_used') return '이미 사용된 토큰은 취소할 수 없습니다.';
    if (reason === 'already_revoked') return '이미 취소된 토큰입니다.';
    if (reason === 'expired') return '만료된 토큰은 취소할 수 없습니다.';
    return '토큰 취소에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  };

  const rollbackFailureMessage = (reason: InviteRollbackReason) => {
    if (reason === 'not_used') return '아직 사용되지 않은 토큰입니다.';
    if (reason === 'already_rolled_back') return '이미 되돌린 판매자입니다.';
    if (reason === 'user_not_found') return '토큰과 연결된 판매자 계정을 찾을 수 없습니다.';
    if (reason === 'not_seller') return '판매자 가입에 사용된 토큰이 아닙니다.';
    if (reason === 'store_not_found') return '판매자와 연결된 스토어를 찾을 수 없습니다.';
    if (reason === 'store_has_records')
      return '주문·정산 기록이 있는 판매자는 초대 탭에서 되돌릴 수 없습니다.';
    return '가입 판매자 되돌리기에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  };

  const handleRevokeToken = (token: string) => {
    modals.openConfirmModal({
      title: '초대 토큰 취소',
      children: (
        <Text size="sm">
          토큰 {token} 을 취소하시겠습니까?
          <br />
          취소 후에는 이 토큰으로 가입할 수 없습니다.
        </Text>
      ),
      labels: { confirm: '취소', cancel: '닫기' },
      confirmProps: { color: 'orange' },
      onConfirm: async () => {
        setRevokingToken(token);
        const result = await revoke(token);
        setRevokingToken(null);
        if (result.ok) {
          notifications.show({ color: 'green', message: '초대 토큰을 취소했습니다.' });
          return;
        }
        notifications.show({ color: 'red', message: revokeFailureMessage(result.reason) });
      },
    });
  };

  const handleRollbackSeller = (token: string) => {
    modals.openConfirmModal({
      title: '가입 판매자 되돌리기',
      children: (
        <Text size="sm">
          토큰 {token} 으로 가입한 판매자 계정을 정지하시겠습니까?
          <br />
          주문·정산 기록이 없는 판매자만 되돌릴 수 있습니다.
        </Text>
      ),
      labels: { confirm: '되돌리기', cancel: '닫기' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        setRollingBackToken(token);
        const result = await rollbackSeller(token);
        setRollingBackToken(null);
        if (result.ok) {
          notifications.show({ color: 'green', message: '가입 판매자를 되돌렸습니다.' });
          return;
        }
        notifications.show({ color: 'red', message: rollbackFailureMessage(result.reason) });
      },
    });
  };

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>초대 토큰 발급</Title>
      </Group>

      <InviteGenerator
        generating={generating}
        lastToken={lastToken}
        expiresInDays={expiresInDays}
        copied={copiedToken === lastToken?.token}
        onExpiresInDaysChange={setExpiresInDays}
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
      <TextInput
        aria-label="초대 토큰 검색"
        leftSection={<Search size={16} />}
        value={searchValue}
        onChange={(event) => setSearchValue(event.currentTarget.value)}
        placeholder="토큰 4자 이상 검색"
        mb="sm"
      />
      <InviteHistoryTable
        invites={invites}
        loading={loading}
        searchActive={query.trim().length >= 4}
        copiedToken={copiedToken}
        revokingToken={revokingToken}
        rollingBackToken={rollingBackToken}
        onCopyToken={handleCopyToken}
        onRevokeToken={handleRevokeToken}
        onRollbackSeller={handleRollbackSeller}
      />
      {hasMore ? (
        <Group justify="center" mt="md">
          <Button variant="light" loading={loadingMore} onClick={loadMore}>
            더 보기
          </Button>
        </Group>
      ) : null}
    </Box>
  );
}
