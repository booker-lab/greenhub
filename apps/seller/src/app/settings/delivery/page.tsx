'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import {
  ActionIcon,
  Box,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core'

interface DeliveryConfig {
  directFee: number
  hubFee: number
  parcelFee: number
  freeThresholdDirect: number
  freeThresholdHub: number
  freeThresholdParcel: number
  weatherRestrictionActive: boolean
}

const DEFAULTS: DeliveryConfig = {
  directFee: 3000,
  hubFee: 1000,
  parcelFee: 4000,
  freeThresholdDirect: 50000,
  freeThresholdHub: 30000,
  freeThresholdParcel: 50000,
  weatherRestrictionActive: false,
}

export default function DeliverySettingsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [config, setConfig] = useState<DeliveryConfig>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const storeId = session?.user.storeId
  const token = session?.user.accessToken

  useEffect(() => {
    if (!storeId || !token) return
    apiFetch(`/stores/${storeId}/delivery-config`, token)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) setConfig({ ...DEFAULTS, ...data })
      })
      .finally(() => setLoading(false))
  }, [storeId, token])

  function handleNum(field: keyof DeliveryConfig, value: string) {
    const num = parseInt(value, 10)
    if (!isNaN(num) && num >= 0) setConfig((prev) => ({ ...prev, [field]: num }))
  }

  async function handleSave() {
    if (!storeId || !token) return
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch(`/stores/${storeId}/delivery-config`, token, {
        method: 'PATCH',
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        setError('저장에 실패했습니다')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Box component="main" style={{ minHeight: '100vh', backgroundColor: 'var(--color-surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>불러오는 중...</Text>
      </Box>
    )
  }

  return (
    <Box
      component="main"
      style={{ minHeight: '100vh', backgroundColor: 'var(--color-surface-muted)', padding: '32px 16px' }}
    >
      <Container size="xs">
        <Group gap="sm" mb="lg">
          <ActionIcon variant="subtle" color="gray" onClick={() => router.back()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </ActionIcon>
          <Title order={2} style={{ fontSize: 'var(--font-size-xl)' }}>배송비 설정</Title>
        </Group>

        <Stack gap="md">
          {/* 배송 방법별 기본 배송비 */}
          <Paper radius="lg" shadow="sm" p="lg">
            <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em' }} mb="md">
              기본 배송비
            </Text>
            <Stack gap="sm">
              {([
                { label: '직배송', field: 'directFee' },
                { label: '거점 픽업', field: 'hubFee' },
                { label: '택배', field: 'parcelFee' },
              ] as { label: string; field: keyof DeliveryConfig }[]).map(({ label, field }) => (
                <Group key={field} justify="space-between" gap="md">
                  <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }} w={80}>{label}</Text>
                  <Group gap="xs" style={{ flex: 1 }}>
                    <input
                      type="number"
                      min="0"
                      step="500"
                      value={config[field] as number}
                      onChange={(e) => handleNum(field, e.target.value)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        border: '1px solid var(--color-border)',
                        borderRadius: 12,
                        fontSize: 14,
                        textAlign: 'right',
                      }}
                    />
                    <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)', flexShrink: 0 }}>원</Text>
                  </Group>
                </Group>
              ))}
            </Stack>
          </Paper>

          {/* 무료 배송 기준 */}
          <Paper radius="lg" shadow="sm" p="lg">
            <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em' }} mb="md">
              무료 배송 기준금액
            </Text>
            <Stack gap="sm">
              {([
                { label: '직배송', field: 'freeThresholdDirect' },
                { label: '거점 픽업', field: 'freeThresholdHub' },
                { label: '택배', field: 'freeThresholdParcel' },
              ] as { label: string; field: keyof DeliveryConfig }[]).map(({ label, field }) => (
                <Group key={field} justify="space-between" gap="md">
                  <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }} w={80}>{label}</Text>
                  <Group gap="xs" style={{ flex: 1 }}>
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={config[field] as number}
                      onChange={(e) => handleNum(field, e.target.value)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        border: '1px solid var(--color-border)',
                        borderRadius: 12,
                        fontSize: 14,
                        textAlign: 'right',
                      }}
                    />
                    <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)', flexShrink: 0 }}>원</Text>
                  </Group>
                </Group>
              ))}
            </Stack>
          </Paper>

          {/* 기상 제한 토글 */}
          <Paper radius="lg" shadow="sm" p="lg">
            <Group justify="space-between">
              <Stack gap={2}>
                <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--color-text)' }}>기상 제한 배송</Text>
                <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>악천후 시 배송 제한 활성화</Text>
              </Stack>
              <Switch
                checked={config.weatherRestrictionActive}
                onChange={(e) => setConfig((prev) => ({ ...prev, weatherRestrictionActive: e.currentTarget.checked }))}
                color="brand"
              />
            </Group>
          </Paper>

          {error && <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }} ta="center">{error}</Text>}

          <Button
            onClick={handleSave}
            disabled={saving}
            fullWidth
            size="md"
            radius="xl"
            style={{ backgroundColor: saved ? 'var(--color-status-info-text)' : 'var(--color-primary)' }}
          >
            {saving ? '저장 중...' : saved ? '저장 완료!' : '저장'}
          </Button>
        </Stack>
      </Container>
    </Box>
  )
}
