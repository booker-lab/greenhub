'use client';

import { Box, Container, Text, TextInput } from '@mantine/core';

interface Props {
  value: string;
  onChange: (next: string) => void;
  phoneSearching: boolean;
  phoneSearchError: boolean;
}

/** 주문 목록 통합 검색 한 칸 — 손님 이름·전화·주문번호 */
export function OrderSearchInput({ value, onChange, phoneSearching, phoneSearchError }: Props) {
  return (
    <Box
      style={{
        backgroundColor: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <Container size="sm" py="xs">
        <TextInput
          type="search"
          aria-label="주문 검색"
          placeholder="이름·전화·주문번호 검색"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          radius="md"
          size="sm"
        />
        {phoneSearching && (
          <Text
            aria-live="polite"
            mt={4}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            전화번호로 찾는 중입니다…
          </Text>
        )}
        {phoneSearchError && (
          <Text mt={4} style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
            전화번호로 찾지 못했습니다. 이름·주문번호가 맞는 주문만 보여 줍니다.
          </Text>
        )}
      </Container>
    </Box>
  );
}
