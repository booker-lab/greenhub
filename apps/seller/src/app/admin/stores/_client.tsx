'use client'

import { useState } from 'react'
import { useAdminStores } from '@/hooks/useAdmin'
import { Badge, Box, Button, Group, Paper, Stack, Text, TextInput, Title } from '@mantine/core'

const STATUS_LABEL: Record<string, string> = {
  active: '운영중',
  invited: '초대됨',
  suspended: '정지',
}

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  invited: 'yellow',
  suspended: 'gray',
}

export default function AdminStoresClient() {
  const { stores, loading, setCommission } = useAdminStores()
  const [editId, setEditId] = useState<string | null>(null)
  const [rateInput, setRateInput] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async (storeId: string) => {
    const rate = parseFloat(rateInput)
    if (isNaN(rate) || rate < 0 || rate > 1) {
      alert('0~1 사이의 수수료율을 입력하세요 (예: 0.05 = 5%)')
      return
    }
    setSaving(true)
    const ok = await setCommission(storeId, rate)
    setSaving(false)
    if (ok) {
      setEditId(null)
      setRateInput('')
    }
  }

  if (loading) {
    return (
      <Text ta="center" py={80} c="dimmed">불러오는 중...</Text>
    )
  }

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>
          판매자 목록{' '}
          <Text component="span" fz="sm" fw={400} c="dimmed">({stores.length})</Text>
        </Title>
      </Group>

      <Paper radius="lg" shadow="xs" style={{ border: '1px solid var(--mantine-color-gray-1)', overflow: 'hidden' }}>
        {stores.length === 0 ? (
          <Text ta="center" py={64} c="dimmed">등록된 판매자가 없습니다.</Text>
        ) : (
          <Box component="table" style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
            <Box component="thead" style={{ backgroundColor: 'var(--mantine-color-gray-0)', borderBottom: '1px solid var(--mantine-color-gray-1)' }}>
              <tr>
                <Box component="th" style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>상호</Box>
                <Box component="th" style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>상태</Box>
                <Box component="th" style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>수수료율</Box>
                <Box component="th" style={{ padding: '12px 16px' }} />
              </tr>
            </Box>
            <Box component="tbody" style={{ borderTop: 'none' }}>
              {stores.map((store) => (
                <Box component="tr" key={store.id} style={{ borderTop: '1px solid var(--mantine-color-gray-0)' }}>
                  <Box component="td" style={{ padding: '12px 16px' }}>
                    <Text fw={500}>{store.name || '(미설정)'}</Text>
                    <Text fz={12} c="dimmed" ff="monospace">{store.id.slice(0, 8)}…</Text>
                  </Box>
                  <Box component="td" style={{ padding: '12px 16px' }}>
                    <Badge
                      color={STATUS_COLOR[store.status] ?? 'gray'}
                      variant="light"
                      radius="xl"
                    >
                      {STATUS_LABEL[store.status] ?? store.status}
                    </Badge>
                  </Box>
                  <Box component="td" style={{ padding: '12px 16px' }}>
                    {editId === store.id ? (
                      <Group gap="xs">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="1"
                          value={rateInput}
                          onChange={(e) => setRateInput(e.target.value)}
                          placeholder="0.05"
                          style={{
                            width: 80,
                            border: '1px solid var(--mantine-color-gray-3)',
                            borderRadius: 6,
                            padding: '4px 8px',
                            fontSize: 14,
                          }}
                        />
                        <Button
                          onClick={() => handleSave(store.id)}
                          disabled={saving}
                          size="xs"
                          color="green"
                          radius="md"
                        >
                          저장
                        </Button>
                        <Button
                          onClick={() => { setEditId(null); setRateInput('') }}
                          size="xs"
                          variant="subtle"
                          color="gray"
                          radius="md"
                        >
                          취소
                        </Button>
                      </Group>
                    ) : (
                      <Text c="gray.7">
                        {store.commissionRate !== undefined
                          ? `${(store.commissionRate * 100).toFixed(1)}%`
                          : '기본'}
                      </Text>
                    )}
                  </Box>
                  <Box component="td" style={{ padding: '12px 16px', textAlign: 'right' }}>
                    {editId !== store.id && (
                      <Button
                        onClick={() => {
                          setEditId(store.id)
                          setRateInput(String(store.commissionRate ?? ''))
                        }}
                        size="xs"
                        variant="subtle"
                        color="blue"
                      >
                        수수료 설정
                      </Button>
                    )}
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
