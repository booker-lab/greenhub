'use client';

import { Box, Group, Stack, Text } from '@mantine/core';

// 실제 운영 방식(경매 당일 매입 → 이천 직배송)과 다른 표현을 쓰지 않는다.
const POINTS = [
  { icon: '🌿', title: '경매 당일 매입', desc: '월요일 경매에서 산 꽃을 매장에 쌓아 두지 않고 바로 준비합니다' },
  { icon: '🚚', title: '화요일 문 앞 배송', desc: '이천은 직접 배송해 화요일 오전 9시까지 문 앞에 둡니다' },
  { icon: '🔍', title: '농부가 고른 품질', desc: '8년차 난 농부가 꽃 상태를 직접 보고 고릅니다' },
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
              color: 'var(--color-primary-dark)',
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
            월요일 경매 당일 매입 → 화요일 문 앞 배송
          </Text>
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
            }}
          >
            8년차 난 농부가 직접 고른 싱싱한 꽃을 보내드립니다.
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
