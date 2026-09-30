'use client';

import type { Order } from '@greenhub/shared';
import { Button, Paper, Stack, Text } from '@mantine/core';
import { displayBuyerName, displayBuyerPhone, displayRequestNote, toTelHref } from '../_lib';
import { Row } from './OrderRow';

export function CustomerInfoSection({ order }: { order: Order }) {
  const phone = displayBuyerPhone(order);
  const telHref = phone ? toTelHref(phone) : null;
  const requestNote = displayRequestNote(order);

  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Text
        style={{
          fontWeight: 'var(--fw-medium)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-secondary)',
        }}
        mb="xs"
      >
        손님 정보
      </Text>
      <Stack gap={6}>
        <Row label="받는 분" value={displayBuyerName(order)} />
        <Row label="연락처" value={phone ?? '연락처 없음'} />
        {requestNote && (
          <Stack gap={2} mt={4}>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              요청사항
            </Text>
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {requestNote}
            </Text>
          </Stack>
        )}
        {telHref && (
          <Button
            component="a"
            href={telHref}
            variant="light"
            fullWidth
            size="md"
            radius="xl"
            mt="xs"
            style={{ fontWeight: 'var(--fw-medium)' }}
          >
            전화 걸기
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
