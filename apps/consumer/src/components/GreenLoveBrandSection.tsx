'use client';

import { Box, Group, Stack, Text } from '@mantine/core';

const POINTS = [
  { icon: '🌿', title: '산지 직송', desc: '농가에서 고객까지 중간 유통 없이 바로 배송' },
  { icon: '✂️', title: '신선도 보장', desc: '수확 후 최단 시간 내 포장·출하' },
  { icon: '🤝', title: '농가 직거래', desc: '판매 수익이 고스란히 재배 농가에게' },
];

export default function GreenLoveBrandSection() {
  return (
    <Box
      py="xl"
      px="md"
      style={{
        background: 'var(--color-primary-surface)',
        borderRadius: 'var(--radius)',
      }}
    >
      <Stack gap="md">
        <Stack gap={4}>
          <Text
            tt="uppercase"
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-primary)',
            }}
          >
            Green Love
          </Text>
          <Text
            style={{
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-text)',
            }}
          >
            화훼 농가 직거래 플랫폼
          </Text>
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
            }}
          >
            그린러브는 꽃을 사랑하는 농가와 소비자를 직접 연결합니다.
          </Text>
        </Stack>

        <Stack gap="sm">
          {POINTS.map(({ icon, title, desc }) => (
            <Group key={title} gap="sm" align="flex-start">
              <Text size="xl" style={{ lineHeight: 1 }}>
                {icon}
              </Text>
              <Box>
                <Text
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--fw-bold)',
                    color: 'var(--color-text)',
                  }}
                >
                  {title}
                </Text>
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  {desc}
                </Text>
              </Box>
            </Group>
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}
