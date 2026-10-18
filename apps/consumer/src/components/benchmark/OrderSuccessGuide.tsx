'use client';

import { Paper, Stack, Text } from '@mantine/core';
import KakaoChannelCta from './KakaoChannelCta';

// 주문 완료 안내(order-success-guide): 실제 도착 날짜, 받는 방법, 다음 할 일.
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' → '11월 10일(화)'. 형식이 틀리면 null. */
export function formatDeliveryDay(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const [, y, m, d] = match;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay()];
  return `${Number(m)}월 ${Number(d)}일(${weekday})`;
}

export default function OrderSuccessGuide({ requestedDeliveryDate }: { requestedDeliveryDate: string | null }) {
  const day = formatDeliveryDay(requestedDeliveryDate);
  return (
    <Stack gap="sm" mt="sm" w="100%">
      <Paper p="md" style={{ background: 'var(--color-primary-surface)', borderRadius: 'var(--radius)' }}>
        <Text fw="var(--fw-extrabold)" c="var(--color-primary-dark)">
          {day ? `${day} 오전 9시까지 문 앞에 둘게요` : '화요일 오전 9시까지 문 앞에 둘게요'}
        </Text>
        <Text size="sm" mt={4}>
          경기도 이천시 직접배송이에요. 배송을 마치면 문 앞 사진을 MY 주문 내역에 올려 드려요.
        </Text>
      </Paper>
      <Paper p="md" style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}>
        <Text fw="var(--fw-extrabold)" size="sm" mb={6}>
          받은 뒤에는
        </Text>
        <ol style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
          <li>포장을 풀고 직사광선이 없는 밝은 곳에 두세요.</li>
          <li>바로 물을 주지 말고, 겉흙이 마르면 주세요.</li>
          <li>꽃이나 잎에 문제가 있으면 사진과 함께 고객센터로 알려 주세요.</li>
        </ol>
      </Paper>
      <KakaoChannelCta compact title="배송 소식과 관리 팁을 카카오톡으로 받아요" />
    </Stack>
  );
}
