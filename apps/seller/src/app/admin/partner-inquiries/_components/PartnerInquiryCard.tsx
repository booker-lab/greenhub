import type { PartnerInquiryItem } from '@greenhub/shared';
import { Anchor, Badge, Button, Group, Paper, Text } from '@mantine/core';
import { contactHref, formatInquiryDate } from '../_lib';

// 입점 문의 한 건: 농가·지역·받은 날·처리 상태, 누를 수 있는 연락처, 내용, 연락함 표시·삭제 버튼.

export interface PartnerInquiryCardProps {
  item: PartnerInquiryItem;
  busy: boolean;
  error: string | null;
  onToggleContacted: () => void;
  onDelete: () => void;
}

export function PartnerInquiryCard({
  item,
  busy,
  error,
  onToggleContacted,
  onDelete,
}: PartnerInquiryCardProps) {
  const contacted = item.contactedAt !== null;
  const href = contactHref(item.contact);
  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Group justify="space-between" wrap="nowrap" gap="xs">
        {/* 휴대폰에서 긴 농가 이름이 날짜를 밀어내지 않게 한 줄 말줄임 */}
        <Text
          fw={700}
          title={`${item.farmName} · ${item.region}`}
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.farmName} · {item.region}
        </Text>
        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Badge variant="light" color={contacted ? 'green' : 'gray'} radius="sm">
            {contacted ? '연락함' : '미연락'}
          </Badge>
          <Text size="sm" c="var(--color-text-secondary)">
            {formatInquiryDate(item.createdAt)}
          </Text>
        </Group>
      </Group>
      {href ? (
        <Anchor href={href} size="sm" mt={2} display="block" style={{ overflowWrap: 'anywhere' }}>
          {item.contact}
        </Anchor>
      ) : (
        <Text size="sm" mt={2} style={{ overflowWrap: 'anywhere' }}>
          {item.contact}
        </Text>
      )}
      <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {item.message}
      </Text>
      <Group justify="flex-end" gap="xs" mt={8}>
        <Button
          variant={contacted ? 'default' : 'light'}
          radius="xl"
          size="compact-sm"
          disabled={busy}
          onClick={onToggleContacted}
        >
          {contacted ? '연락 전으로 되돌리기' : '연락함으로 표시'}
        </Button>
        <Button
          variant="subtle"
          color="red"
          radius="xl"
          size="compact-sm"
          disabled={busy}
          onClick={onDelete}
        >
          삭제
        </Button>
      </Group>
      {error && (
        <Text role="alert" size="sm" mt={6} c="var(--color-danger)">
          {error}
        </Text>
      )}
    </Paper>
  );
}
