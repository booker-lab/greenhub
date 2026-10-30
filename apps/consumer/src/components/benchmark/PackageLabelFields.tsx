'use client';

import { PACKAGE_LABEL_MAX_LENGTH } from '@greenhub/shared';
import { Group, Radio, Stack, Text, TextInput } from '@mantine/core';

// 포장 라벨(무료). 화분 포장 겉면에 붙일 문구를 주문마다 한 장 받는다.
// 직접 사는 손님은 "없음"이 기본이고, "넣기"를 고르면 문구 칸이 열린다(보내는 분 이름이 아니어도 된다).
// 선물로 보내면 이 칸 대신 선물 칸의 보내는 분 이름이 라벨이 된다(결제 폼이 이 칸을 숨긴다).
// 축하 문구는 상품 옵션 시트의 축하 토퍼로 고른다.

export type PackageLabelState = { enabled: boolean; text: string };

export const EMPTY_PACKAGE_LABEL: PackageLabelState = { enabled: false, text: '' };

/** 줄바꿈·앞뒤 공백을 정리한 문구. 서버(resolvePackageLabel)와 같은 기준으로 한 줄로 만든다. */
export function normalizePackageLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * 주문에 실을 라벨 문구. "없음"이면 null, "넣기"인데 비었거나 너무 길면 'invalid'(결제를 막는다).
 */
export function packageLabelPayload(state: PackageLabelState): string | null | 'invalid' {
  if (!state.enabled) return null;
  const text = normalizePackageLabel(state.text);
  if (!text || Array.from(text).length > PACKAGE_LABEL_MAX_LENGTH) return 'invalid';
  return text;
}

export default function PackageLabelFields({
  value,
  onChange,
}: {
  value: PackageLabelState;
  onChange: (next: PackageLabelState) => void;
}) {
  const length = Array.from(normalizePackageLabel(value.text)).length;
  return (
    <Stack gap="sm" p="md" style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}>
      <Radio.Group
        label="포장 라벨 (무료)"
        description="화분 포장 겉면에 붙이는 라벨이에요."
        value={value.enabled ? 'on' : 'off'}
        onChange={(next) => onChange({ ...value, enabled: next === 'on' })}
      >
        <Group gap="lg" mt={8}>
          <Radio value="off" label="없음" />
          <Radio value="on" label="문구 넣기" />
        </Group>
      </Radio.Group>
      {value.enabled && (
        <TextInput
          label="라벨 문구"
          description={`한 줄, ${PACKAGE_LABEL_MAX_LENGTH}자까지. 보내는 분 이름이나 가게 이름을 적어요.`}
          placeholder="예) 그린플라워 대표 김그린"
          required
          value={value.text}
          maxLength={PACKAGE_LABEL_MAX_LENGTH}
          onChange={(event) => onChange({ ...value, text: event.currentTarget.value })}
          rightSection={
            <Text size="xs" c="var(--color-text-disabled)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {length}/{PACKAGE_LABEL_MAX_LENGTH}
            </Text>
          }
          rightSectionWidth={52}
        />
      )}
    </Stack>
  );
}
