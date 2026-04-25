'use client'

import { Box, Button, Group, Text } from '@mantine/core'

const GROUP_DELIVERY_METHODS = [
  { value: 'direct', label: '꽃차 직배송' },
  { value: 'parcel', label: '택배' },
] as const

interface GroupConfigForm {
  minQuantity: string
  targetQuantity: string
  maxPerPerson: string
  recruitDeadline: string
  groupDeliveryDate: string
  groupDeliveryMethod: 'direct' | 'parcel'
}

interface Props {
  visible: boolean
  config: GroupConfigForm
  setGroupConfig: <K extends keyof GroupConfigForm>(key: K, value: GroupConfigForm[K]) => void
}

export default function GroupConfigSection({ visible, config, setGroupConfig }: Props) {
  return (
    <Box
      style={{
        overflow: 'hidden',
        maxHeight: visible ? 600 : 0,
        transition: 'max-height 0.3s ease-in-out',
        marginTop: visible ? 16 : 0,
      }}
    >
      <Box style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
        <Group gap="xs" mb="sm">
          <Box style={{ flex: 1 }}>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mb={4}>최소 수량</Text>
            <input
              type="number" placeholder="10" min={1}
              value={config.minQuantity}
              onChange={(e) => setGroupConfig('minQuantity', e.target.value)}
              style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 12, padding: '10px 12px', fontSize: 'var(--font-size-sm)' }}
            />
          </Box>
          <Box style={{ flex: 1 }}>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mb={4}>목표 수량</Text>
            <input
              type="number" placeholder="50" min={1}
              value={config.targetQuantity}
              onChange={(e) => setGroupConfig('targetQuantity', e.target.value)}
              style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 12, padding: '10px 12px', fontSize: 'var(--font-size-sm)' }}
            />
          </Box>
        </Group>
        <Box mb="sm">
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mb={4}>1인 최대 구매 수량</Text>
          <input
            type="number" placeholder="5" min={1}
            value={config.maxPerPerson}
            onChange={(e) => setGroupConfig('maxPerPerson', e.target.value)}
            style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 12, padding: '10px 12px', fontSize: 'var(--font-size-sm)' }}
          />
        </Box>

        <Box mb="sm">
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mb={4}>모집 마감일시</Text>
          <input
            type="datetime-local"
            value={config.recruitDeadline}
            onChange={(e) => setGroupConfig('recruitDeadline', e.target.value)}
            style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 12, padding: '10px 12px', fontSize: 'var(--font-size-sm)' }}
          />
        </Box>

        <Box mb="sm">
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mb={4}>배송 예정일</Text>
          <input
            type="date"
            value={config.groupDeliveryDate}
            onChange={(e) => setGroupConfig('groupDeliveryDate', e.target.value)}
            style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 12, padding: '10px 12px', fontSize: 'var(--font-size-sm)' }}
          />
        </Box>

        <Box>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mb={4}>배송 수단</Text>
          <Group gap="xs">
            {GROUP_DELIVERY_METHODS.map(({ value, label }) => (
              <Button
                key={value}
                type="button"
                onClick={() => setGroupConfig('groupDeliveryMethod', value as 'direct' | 'parcel')}
                flex={1} size="sm" radius="xl" variant="outline" color="gray"
                style={config.groupDeliveryMethod === value
                  ? { backgroundColor: 'var(--color-primary-surface)', borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }
                  : {}}
              >
                {label}
              </Button>
            ))}
          </Group>
        </Box>
      </Box>
    </Box>
  )
}
