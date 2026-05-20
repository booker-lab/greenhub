'use client';

import { Badge, Box, Button, Group, Paper, Text, Title } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { useAdminInvite } from '@/hooks/useAdmin';

export default function AdminInviteClient() {
  const { invites, loading, generating, generate } = useAdminInvite();
  const [lastToken, setLastToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
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

  const handleCopy = () => {
    if (!lastToken) return;
    navigator.clipboard.writeText(lastToken.token);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    setCopied(true);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>초대 토큰 발급</Title>
      </Group>

      {/* 발급 카드 */}
      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)' }}
        p="lg"
        mb="xl"
      >
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          mb="md"
        >
          판매자 초대 토큰을 생성합니다. 토큰은 발급 후 <strong>7일간</strong> 유효합니다.
        </Text>

        <Button
          onClick={handleGenerate}
          disabled={generating}
          size="md"
          radius="xl"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {generating ? '생성중…' : '새 토큰 생성'}
        </Button>

        {lastToken && (
          <Box
            mt="md"
            p="md"
            style={{
              backgroundColor: 'var(--color-primary-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
            }}
          >
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-primary)',
                fontWeight: 'var(--fw-medium)',
              }}
              mb="xs"
            >
              생성된 초대 토큰
            </Text>
            <Group gap="sm">
              <Text
                component="code"
                ff="monospace"
                style={{
                  flex: 1,
                  letterSpacing: '0.15em',
                  fontSize: 'var(--font-size-lg)',
                  fontWeight: 'var(--fw-bold)',
                  color: 'var(--color-primary-dark)',
                }}
              >
                {lastToken.token}
              </Text>
              <Button onClick={handleCopy} size="xs" variant="outline" color="green" radius="md">
                {copied ? '복사됨!' : '복사'}
              </Button>
            </Group>
            <Text
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)' }}
              mt="xs"
            >
              만료:{' '}
              {new Date(lastToken.expiresAt).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </Box>
        )}
      </Paper>

      {/* 발급 내역 */}
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
      {loading ? (
        <Text ta="center" py={32} style={{ color: 'var(--color-text-disabled)' }}>
          불러오는 중...
        </Text>
      ) : (
        <Paper
          radius="lg"
          shadow="xs"
          style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          {invites.length === 0 ? (
            <Text ta="center" py={48} style={{ color: 'var(--color-text-disabled)' }}>
              발급된 토큰이 없습니다.
            </Text>
          ) : (
            <Box
              component="table"
              style={{ width: '100%', fontSize: 'var(--font-size-sm)', borderCollapse: 'collapse' }}
            >
              <Box
                component="thead"
                style={{
                  backgroundColor: 'var(--color-surface-muted)',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <tr>
                  <Box
                    component="th"
                    style={{
                      textAlign: 'left',
                      padding: '12px 16px',
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    토큰
                  </Box>
                  <Box
                    component="th"
                    style={{
                      textAlign: 'left',
                      padding: '12px 16px',
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    상태
                  </Box>
                  <Box
                    component="th"
                    style={{
                      textAlign: 'left',
                      padding: '12px 16px',
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    만료일
                  </Box>
                </tr>
              </Box>
              <Box component="tbody">
                {invites.map((inv) => {
                  const isUsed = !!inv.usedAt;
                  const expDate = inv.expiresAt ? new Date(inv.expiresAt) : null;
                  const isExpired = expDate ? expDate < new Date() : false;

                  return (
                    <Box
                      component="tr"
                      key={inv.token}
                      style={{ borderTop: '1px solid var(--color-border)' }}
                    >
                      <Box component="td" style={{ padding: '12px 16px' }}>
                        <Text
                          component="code"
                          ff="monospace"
                          style={{ letterSpacing: '0.1em', color: 'var(--color-text)' }}
                        >
                          {inv.token}
                        </Text>
                      </Box>
                      <Box component="td" style={{ padding: '12px 16px' }}>
                        <Badge
                          color={isUsed ? 'gray' : isExpired ? 'red' : 'green'}
                          variant="light"
                          radius="xl"
                        >
                          {isUsed ? '사용됨' : isExpired ? '만료' : '유효'}
                        </Badge>
                      </Box>
                      <Box
                        component="td"
                        style={{
                          padding: '12px 16px',
                          color: 'var(--color-text-disabled)',
                          fontSize: 'var(--font-size-sm)',
                        }}
                      >
                        {expDate ? expDate.toLocaleDateString('ko-KR') : '-'}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
}
