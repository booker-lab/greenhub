'use client'

import { useEffect, useRef, useState } from 'react'
import { useAdminInvite } from '@/hooks/useAdmin'
import { Badge, Box, Button, Group, Paper, Stack, Text, Title } from '@mantine/core'

export default function AdminInviteClient() {
  const { invites, loading, generating, generate } = useAdminInvite()
  const [lastToken, setLastToken] = useState<{ token: string; expiresAt: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const handleGenerate = async () => {
    const result = await generate()
    if (result) setLastToken(result)
  }

  const handleCopy = () => {
    if (!lastToken) return
    navigator.clipboard.writeText(lastToken.token)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    setCopied(true)
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>초대 토큰 발급</Title>
      </Group>

      {/* 발급 카드 */}
      <Paper radius="lg" shadow="xs" style={{ border: '1px solid var(--mantine-color-gray-1)' }} p="lg" mb="xl">
        <Text size="sm" c="dimmed" mb="md">
          판매자 초대 토큰을 생성합니다. 토큰은 발급 후 <strong>7일간</strong> 유효합니다.
        </Text>

        <Button
          onClick={handleGenerate}
          disabled={generating}
          size="md"
          radius="xl"
          style={{ backgroundColor: 'var(--green-primary)' }}
        >
          {generating ? '생성중…' : '새 토큰 생성'}
        </Button>

        {lastToken && (
          <Box
            mt="md"
            p="md"
            style={{
              backgroundColor: 'var(--mantine-color-green-0)',
              border: '1px solid var(--mantine-color-green-2)',
              borderRadius: 12,
            }}
          >
            <Text size="xs" c="green.7" fw={500} mb="xs">생성된 초대 토큰</Text>
            <Group gap="sm">
              <Text
                component="code"
                fz="lg"
                fw={700}
                c="green.8"
                ff="monospace"
                style={{ flex: 1, letterSpacing: '0.15em' }}
              >
                {lastToken.token}
              </Text>
              <Button
                onClick={handleCopy}
                size="xs"
                variant="outline"
                color="green"
                radius="md"
              >
                {copied ? '복사됨!' : '복사'}
              </Button>
            </Group>
            <Text size="xs" c="green.6" mt="xs">
              만료: {new Date(lastToken.expiresAt).toLocaleDateString('ko-KR', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </Text>
          </Box>
        )}
      </Paper>

      {/* 발급 내역 */}
      <Text size="sm" fw={600} c="gray.7" mb="sm">발급 내역</Text>
      {loading ? (
        <Text ta="center" py={32} c="dimmed">불러오는 중...</Text>
      ) : (
        <Paper radius="lg" shadow="xs" style={{ border: '1px solid var(--mantine-color-gray-1)', overflow: 'hidden' }}>
          {invites.length === 0 ? (
            <Text ta="center" py={48} c="dimmed">발급된 토큰이 없습니다.</Text>
          ) : (
            <Box component="table" style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
              <Box component="thead" style={{ backgroundColor: 'var(--mantine-color-gray-0)', borderBottom: '1px solid var(--mantine-color-gray-1)' }}>
                <tr>
                  <Box component="th" style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>토큰</Box>
                  <Box component="th" style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>상태</Box>
                  <Box component="th" style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>만료일</Box>
                </tr>
              </Box>
              <Box component="tbody">
                {invites.map((inv) => {
                  const isUsed = !!inv.usedAt
                  const expDate = inv.expiresAt && typeof (inv.expiresAt as any).toDate === 'function'
                    ? (inv.expiresAt as any).toDate()
                    : inv.expiresAt
                      ? new Date(inv.expiresAt as string)
                      : null
                  const isExpired = expDate ? expDate < new Date() : false

                  return (
                    <Box component="tr" key={inv.token} style={{ borderTop: '1px solid var(--mantine-color-gray-0)' }}>
                      <Box component="td" style={{ padding: '12px 16px' }}>
                        <Text component="code" ff="monospace" c="gray.8" style={{ letterSpacing: '0.1em' }}>
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
                      <Box component="td" style={{ padding: '12px 16px', color: 'var(--mantine-color-gray-5)', fontSize: 12 }}>
                        {expDate ? expDate.toLocaleDateString('ko-KR') : '-'}
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  )
}
