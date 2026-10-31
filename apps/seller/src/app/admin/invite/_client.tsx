'use client';

import { Box, Group, Text, Title } from '@mantine/core';
import { notify } from '@/components/AppToaster';
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { describeListCap, type IssuedInvite, useAdminInvite } from '@/hooks/useAdmin';
import { InviteGenerator } from './_components/InviteGenerator';
import { InviteHistoryTable } from './_components/InviteHistoryTable';
import { ManualCopyModal } from './_components/ManualCopyModal';
import { buildInviteLink, describeInviteRevokeOutcome, parseInviteRecipientEmail } from './_lib';
import { useTokenCopy } from './_useTokenCopy';

export default function AdminInviteClient() {
  const { invites, cap, loading, error, reload, generating, generateError, generate, revoke } =
    useAdminInvite();
  const [lastToken, setLastToken] = useState<IssuedInvite | null>(null);
  // 복사 로직 SSOT — 발급 직후 초대와 발급 내역 행별 복사가 공유한다(성공 피드백·실패 폴백 포함).
  const { copiedToken, manualLink, copy, closeManual } = useTokenCopy();
  const copied = lastToken !== null && copiedToken === lastToken.token;
  // 발급 직후 보여 줄 초대 링크. lastToken은 발급 버튼을 누른 뒤(브라우저)에만 생겨 window를 읽을 수 있다.
  const lastLink = lastToken ? buildInviteLink(lastToken.token, window.location.origin) : null;

  // 받는 사람 이메일(필수) — 비었거나 형식이 틀리면 요청하지 않고 입력란에 오류를 보여 준다.
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientEmailError, setRecipientEmailError] = useState<string | null>(null);

  const handleRecipientEmailChange = (value: string) => {
    setRecipientEmail(value);
    setRecipientEmailError(null);
  };

  const handleGenerate = async () => {
    const recipient = parseInviteRecipientEmail(recipientEmail);
    if (!recipient.ok) {
      setRecipientEmailError(recipient.error);
      return;
    }
    const result = await generate(recipient.value);
    // 성공한 경우에만 lastToken 갱신 — 실패(null)는 이전 성공 token을 덮어쓰지 않는다.
    if (result) setLastToken(result);
    // 다음 발급이 같은 받는 사람으로 묶이지 않게 성공한 뒤에만 입력을 비운다.
    if (result) setRecipientEmail('');
  };

  // 초대 취소 — 확인 창(pendingRevoke)을 거친 뒤에만 요청한다.
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);

  const runRevoke = async () => {
    if (!pendingRevoke) return;
    setRevokingToken(pendingRevoke);
    try {
      const outcome = await revoke(pendingRevoke);
      setPendingRevoke(null);
      const notice = describeInviteRevokeOutcome(outcome);
      if (!notice) return;
      notify({ color: notice.color, title: notice.title, message: notice.message });
      // 404·409·결과 불확정은 화면 목록이 서버와 어긋났을 수 있어 다시 조회한다.
      if (notice.needsReload) void reload();
    } finally {
      setRevokingToken(null);
    }
  };

  const handleCopy = () => {
    if (!lastToken) return;
    void copy(lastToken.token);
  };

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>판매자 초대 링크</Title>
      </Group>

      <InviteGenerator
        generating={generating}
        lastToken={lastToken}
        lastLink={lastLink}
        copied={copied}
        generateError={generateError}
        recipientEmail={recipientEmail}
        recipientEmailError={recipientEmailError}
        onRecipientEmailChange={handleRecipientEmailChange}
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
        revokingToken={revokingToken}
        onRevoke={setPendingRevoke}
      />
      {cap !== null && !loading && error === null && (
        <Text size="xs" mt="xs" style={{ color: 'var(--color-text-secondary)' }}>
          {describeListCap(cap)}
        </Text>
      )}
      <ManualCopyModal link={manualLink} onClose={closeManual} />
      <ConfirmModal
        opened={pendingRevoke !== null}
        title="초대 취소"
        message={`토큰 ${pendingRevoke ?? ''} 초대를 취소할까요?\n취소한 초대 링크로는 가입할 수 없고, 되돌릴 수 없어요.`}
        confirmLabel="초대 취소"
        cancelLabel="닫기"
        confirmColor="red"
        loading={revokingToken !== null}
        onConfirm={runRevoke}
        onClose={() => {
          if (revokingToken === null) setPendingRevoke(null);
        }}
      />
    </Box>
  );
}
