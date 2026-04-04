'use client'

import { useState } from 'react'
import { useAdminSettlements } from '@/hooks/useAdmin'
import { Badge, Box, Button, Group, Paper, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  confirmed: '확정',
  paid: '지급완료',
  cancelled: '취소',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'gray',
  confirmed: 'blue',
  paid: 'green',
  cancelled: 'red',
}

export default function AdminSettlementsClient() {
  const [storeFilter, setStoreFilter] = useState('')
  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')
  const { settlements, loading, markAsPaid } = useAdminSettlements({
    storeId: storeFilter || undefined,
    from: fromFilter || undefined,
    to: toFilter || undefined,
  })
  const [processingId, setProcessingId] = useState<string | null>(null)

  const handlePay = async (settlementId: string) => {
    if (!confirm('이 정산을 지급 완료 처리하시겠습니까?')) return
    setProcessingId(settlementId)
    const ok = await markAsPaid(settlementId)
    setProcessingId(null)
    if (!ok) alert('처리에 실패했습니다.')
  }

  const totalNet = settlements.reduce((sum, s) => sum + s.netAmount, 0)
  const totalFee = settlements.reduce((sum, s) => sum + s.platformFee, 0)

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>
          정산 목록{' '}
          <Text component="span" fz="sm" fw={400} c="dimmed">({settlements.length})</Text>
        </Title>
      </Group>

      {/* 필터 */}
      <Group gap="sm" mb="md" style={{ flexWrap: 'wrap' }}>
        <TextInput
          placeholder="스토어 ID 필터"
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          style={{ flex: 1, minWidth: 140 }}
          radius="md"
          size="sm"
        />
        <input
          type="date"
          value={fromFilter}
          onChange={(e) => setFromFilter(e.target.value)}
          style={{
            border: '1px solid var(--mantine-color-gray-3)',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 14,
          }}
        />
        <input
          type="date"
          value={toFilter}
          onChange={(e) => setToFilter(e.target.value)}
          style={{
            border: '1px solid var(--mantine-color-gray-3)',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 14,
          }}
        />
      </Group>

      {/* 요약 카드 */}
      {settlements.length > 0 && (
        <SimpleGrid cols={2} mb="md">
          <Paper radius="lg" style={{ border: '1px solid var(--mantine-color-gray-1)' }} p="md">
            <Text size="xs" c="dimmed" mb={4}>플랫폼 수수료 합계</Text>
            <Text fz="lg" fw={700}>₩{totalFee.toLocaleString()}</Text>
          </Paper>
          <Paper radius="lg" style={{ border: '1px solid var(--mantine-color-gray-1)' }} p="md">
            <Text size="xs" c="dimmed" mb={4}>판매자 지급 합계</Text>
            <Text fz="lg" fw={700} c="green.7">₩{totalNet.toLocaleString()}</Text>
          </Paper>
        </SimpleGrid>
      )}

      {loading ? (
        <Text ta="center" py={80} c="dimmed">불러오는 중...</Text>
      ) : (
        <Paper radius="lg" shadow="xs" style={{ border: '1px solid var(--mantine-color-gray-1)', overflow: 'hidden' }}>
          {settlements.length === 0 ? (
            <Text ta="center" py={64} c="dimmed">정산 내역이 없습니다.</Text>
          ) : (
            <Box component="table" style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
              <Box component="thead" style={{ backgroundColor: 'var(--mantine-color-gray-0)', borderBottom: '1px solid var(--mantine-color-gray-1)' }}>
                <tr>
                  <Box component="th" style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>스토어</Box>
                  <Box component="th" style={{ textAlign: 'right', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>거래금액</Box>
                  <Box component="th" style={{ textAlign: 'right', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>수수료</Box>
                  <Box component="th" style={{ textAlign: 'right', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>지급액</Box>
                  <Box component="th" style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 500, color: 'var(--mantine-color-gray-6)' }}>상태</Box>
                  <Box component="th" style={{ padding: '12px 16px' }} />
                </tr>
              </Box>
              <Box component="tbody">
                {settlements.map((s) => (
                  <Box component="tr" key={s.id} style={{ borderTop: '1px solid var(--mantine-color-gray-0)' }}>
                    <Box component="td" style={{ padding: '12px 16px' }}>
                      <Text fz={12} c="dimmed" ff="monospace">{s.storeId.slice(0, 8)}…</Text>
                    </Box>
                    <Box component="td" style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--mantine-color-gray-7)' }}>
                      ₩{s.totalAmount.toLocaleString()}
                    </Box>
                    <Box component="td" style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--mantine-color-red-5)' }}>
                      ₩{s.platformFee.toLocaleString()}
                    </Box>
                    <Box component="td" style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500, color: 'var(--mantine-color-green-7)' }}>
                      ₩{s.netAmount.toLocaleString()}
                    </Box>
                    <Box component="td" style={{ padding: '12px 16px' }}>
                      <Badge color={STATUS_COLOR[s.status] ?? 'gray'} variant="light" radius="xl">
                        {STATUS_LABEL[s.status] ?? s.status}
                      </Badge>
                    </Box>
                    <Box component="td" style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {s.status === 'confirmed' && (
                        <Button
                          onClick={() => handlePay(s.id)}
                          disabled={processingId === s.id}
                          size="xs"
                          variant="outline"
                          color="blue"
                          radius="md"
                        >
                          {processingId === s.id ? '처리중…' : '지급처리'}
                        </Button>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  )
}
