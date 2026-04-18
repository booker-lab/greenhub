'use client'

import { Box, Group, Stack, Text } from '@mantine/core'

const POINTS = [
  { icon: '🌿', title: '산지 직송', desc: '농가에서 고객까지 중간 유통 없이 바로 배송' },
  { icon: '✂️', title: '신선도 보장', desc: '수확 후 최단 시간 내 포장·출하' },
  { icon: '🤝', title: '농가 직거래', desc: '판매 수익이 고스란히 재배 농가에게' },
]

export default function GreenLoveBrandSection() {
  return (
    <Box
      py="xl"
      px="md"
      style={{
        background: 'linear-gradient(135deg, var(--green-bg) 0%, #f0faf0 100%)',
        borderRadius: 16,
      }}
    >
      <Stack gap="md">
        <Stack gap={4}>
          <Text size="xs" fw={600} c="var(--green-primary)" tt="uppercase">
            Green Love
          </Text>
          <Text size="lg" fw={700} c="dark">
            화훼 농가 직거래 플랫폼
          </Text>
          <Text size="sm" c="gray.6" style={{ lineHeight: 1.6 }}>
            그린러브는 꽃을 사랑하는 농가와 소비자를 직접 연결합니다.
          </Text>
        </Stack>

        <Stack gap="sm">
          {POINTS.map(({ icon, title, desc }) => (
            <Group key={title} gap="sm" align="flex-start">
              <Text size="xl" style={{ lineHeight: 1 }}>{icon}</Text>
              <Box>
                <Text size="sm" fw={600} c="dark">{title}</Text>
                <Text size="xs" c="gray.5">{desc}</Text>
              </Box>
            </Group>
          ))}
        </Stack>
      </Stack>
    </Box>
  )
}
