'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';

export interface ConflictWarning {
  field: string;
  message: string;
  suggestion: string;
}

interface Props {
  loading: boolean;
  headline: string;
  description: string;
  isEditedByUser: boolean;
  conflicts: ConflictWarning[];
  onHeadlineChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onRegenerate: () => Promise<void>;
  onSellerOverride: () => void;
}

export default function AIPreviewPanel({
  loading,
  headline,
  description,
  isEditedByUser,
  conflicts,
  onHeadlineChange,
  onDescriptionChange,
  onRegenerate,
  onSellerOverride,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  async function handleRegenerate() {
    setConfirmOpen(false);
    setRegenerating(true);
    await onRegenerate();
    setRegenerating(false);
  }

  if (loading || regenerating) {
    return (
      <Stack align="center" py="xl" gap="md">
        <Loader size="md" color="var(--color-primary)" />
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          AI가 상세 페이지를 작성하는 중...
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      {conflicts.length > 0 && (
        <Alert color="yellow" title="가드레일 충돌 감지">
          <Stack gap="xs">
            {conflicts.map((c, i) => (
              <Text key={i} style={{ fontSize: 'var(--font-size-sm)' }}>
                {c.message}
                <br />
                <Text
                  component="span"
                  style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}
                >
                  {c.suggestion}
                </Text>
              </Text>
            ))}
          </Stack>
          <Group mt="sm" gap="xs">
            <Button size="xs" variant="outline" color="yellow" onClick={handleRegenerate}>
              수정 반영하기
            </Button>
            <Button size="xs" variant="subtle" color="gray" onClick={onSellerOverride}>
              그대로 등록하기
            </Button>
          </Group>
        </Alert>
      )}

      <Paper radius="lg" shadow="xs" p="md">
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--color-text-disabled)',
          }}
          mb="xs"
        >
          헤드라인 (AI 생성)
        </Text>
        <TextInput
          value={headline}
          onChange={(e) => onHeadlineChange(e.target.value)}
          placeholder="AI가 생성한 마케팅 문구"
          size="md"
          radius="md"
        />
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            color:
              headline.length > 15
                ? 'var(--color-status-warning-text)'
                : 'var(--color-text-disabled)',
          }}
          ta="right"
          mt={4}
        >
          {headline.length} / 15자 권장
        </Text>
      </Paper>

      <Paper radius="lg" shadow="xs" p="md">
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--color-text-disabled)',
          }}
          mb="xs"
        >
          상세 설명 (AI 생성)
        </Text>
        <Textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="AI가 생성한 상세 설명"
          autosize
          minRows={5}
          radius="md"
          styles={{ input: { fontSize: 15, lineHeight: 1.7 } }}
        />
      </Paper>

      <Button
        variant="subtle"
        color="gray"
        size="sm"
        onClick={() => (isEditedByUser ? setConfirmOpen(true) : handleRegenerate())}
      >
        다시 생성하기
      </Button>

      <Modal
        opened={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="다시 생성하기"
        centered
        size="xs"
      >
        <Text style={{ fontSize: 'var(--font-size-sm)' }} mb="md">
          직접 편집한 내용이 있습니다. 새로 생성하면 편집 내용이 사라집니다.
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" color="gray" onClick={() => setConfirmOpen(false)}>
            취소
          </Button>
          <Button color="red" onClick={handleRegenerate}>
            새로 생성
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
