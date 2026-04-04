'use client'

import { useState } from 'react'
import { useAdminUsers } from '@/hooks/useAdmin'
import { Badge, Box, Button, Group, Paper, Text, Title } from '@mantine/core'

export default function AdminUsersClient() {
  const { users, loading, toggleSuspend } = useAdminUsers()
  const [processingId, setProcessingId] = useState<string | null>(null)

  const handleToggle = async (userId: string, currentlySuspended: boolean) => {
    if (!confirm(currentlySuspended ? '계정 정지를 해제하시겠습니까?' : '이 계정을 정지하시겠습니까?')) return
    setProcessingId(userId)
    await toggleSuspend(userId, !currentlySuspended)
    setProcessingId(null)
  }

  if (loading) {
    return <Text ta="center" py={80} c="dimmed">불러오는 중...</Text>
  }

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>
          소비자 계정{' '}
          <Text component="span" fz="sm" fw={400} c="dimmed">({users.length})</Text>
        </Title>
      </Group>

      <Paper radius="lg" shadow="xs" style={{ border: '1px solid var(--mantine-color-gray-1)', overflow: 'hidden' }}>
        {users.length === 0 ? (
          <Text ta="center" py={64} c="dimmed">등록된 소비자가 없습니다.</Text>
        ) : (
          <Box component="table" style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
            <Box component="thead" style={{ backgroundColor: 'var(--mantine-color-gray-0)', borderBottom: '1px solid var(--mantine-color-gray-1)' }}>
              <tr>
                <Box component="th" style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>이름</Box>
                <Box component="th" style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>이메일</Box>
                <Box component="th" style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>상태</Box>
                <Box component="th" style={{ padding: '12px 16px' }} />
              </tr>
            </Box>
            <Box component="tbody">
              {users.map((user) => (
                <Box component="tr" key={user.id} style={{ borderTop: '1px solid var(--mantine-color-gray-0)' }}>
                  <Box component="td" style={{ padding: '12px 16px' }}>
                    <Text fw={500}>{user.name}</Text>
                    <Text fz={12} c="dimmed" ff="monospace">{user.id.slice(0, 8)}…</Text>
                  </Box>
                  <Box component="td" style={{ padding: '12px 16px', color: 'var(--mantine-color-gray-7)' }}>
                    {user.email}
                  </Box>
                  <Box component="td" style={{ padding: '12px 16px' }}>
                    <Badge
                      color={user.suspended ? 'red' : 'green'}
                      variant="light"
                      radius="xl"
                    >
                      {user.suspended ? '정지됨' : '정상'}
                    </Badge>
                  </Box>
                  <Box component="td" style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <Button
                      onClick={() => handleToggle(user.id, !!user.suspended)}
                      disabled={processingId === user.id}
                      size="xs"
                      variant="outline"
                      color={user.suspended ? 'green' : 'red'}
                      radius="md"
                    >
                      {processingId === user.id ? '처리중…' : user.suspended ? '복구' : '정지'}
                    </Button>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Paper>
    </Box>
  )
}
