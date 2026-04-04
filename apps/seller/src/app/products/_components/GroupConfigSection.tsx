'use client'

import { Box, Button, Group, Text } from '@mantine/core'

const GROUP_DELIVERY_METHODS = [
  { value: 'direct', label: '꽃차 직배송' },
  { value: 'parcel', label: '택배' },
] as const

interface GroupConfigForm {
  minParticipants: string
  maxParticipants: string
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
        maxHeight: visible ? 400 : 0,
        transition: 'max-height 0.3s ease-in-out',
        marginTop: visible ? 16 : 0,
      }}
    >
      <Box style={{ borderTop: '1px solid var(--mantine-color-gray-1)', paddingTop: 16 }}>
        <Group gap="xs" mb="sm">
          <Box style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" mb={4}>최소 인원</Text>
            <input
              type="number" placeholder="2" min={2}
              value={config.minParticipants}
              onChange={(e) => setGroupConfig('minParticipants', e.target.value)}
              style={{ width: '100%', border: '1px solid var(--mantine-color-gray-3)', borderRadius: 12, padding: '10px 12px', fontSize: 14 }}
            />
          </Box>
          <Box style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" mb={4}>최대 인원</Text>
            <input
              type="number" placeholder="10" min={2}
              value={config.maxParticipants}
              onChange={(e) => setGroupConfig('maxParticipants', e.target.value)}
              style={{ width: '100%', border: '1px solid var(--mantine-color-gray-3)', borderRadius: 12, padding: '10px 12px', fontSize: 14 }}
            />
          </Box>
        </Group>

        <Box mb="sm">
          <Text size="xs" c="dimmed" mb={4}>모집 마감일</Text>
          <input
            type="date"
            value={config.recruitDeadline}
            onChange={(e) => setGroupConfig('recruitDeadline', e.target.value)}
            style={{ width: '100%', border: '1px solid var(--mantine-color-gray-3)', borderRadius: 12, padding: '10px 12px', fontSize: 14 }}
          />
        </Box>

        <Box mb="sm">
          <Text size="xs" c="dimmed" mb={4}>배송 예정일</Text>
          <input
            type="date"
            value={config.groupDeliveryDate}
            onChange={(e) => setGroupConfig('groupDeliveryDate', e.target.value)}
            style={{ width: '100%', border: '1px solid var(--mantine-color-gray-3)', borderRadius: 12, padding: '10px 12px', fontSize: 14 }}
          />
        </Box>

        <Box>
          <Text size="xs" c="dimmed" mb={4}>배송 수단</Text>
          <Group gap="xs">
            {GROUP_DELIVERY_METHODS.map(({ value, label }) => (
              <Button
                key={value}
                type="button"
                onClick={() => setGroupConfig('groupDeliveryMethod', value as 'direct' | 'parcel')}
                flex={1} size="sm" radius="xl" variant="outline" color="gray"
                style={config.groupDeliveryMethod === value
                  ? { backgroundColor: 'var(--green-bg)', borderColor: 'var(--green-primary)', color: 'var(--green-primary)' }
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
