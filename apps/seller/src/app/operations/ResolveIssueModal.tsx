'use client';

import { Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { useEffect, useState } from 'react';
import { ISSUE_LABELS } from '@/app/orders/[id]/operation-issues';
import {
  isValidManualResolveMemo,
  MANUAL_RESOLVE_MEMO_MAX_LENGTH,
  normalizeManualResolveMemo,
  type StoreOperationIssue,
} from './manual-resolve';

interface ResolveIssueModalProps {
  issue: StoreOperationIssue | null;
  onClose: () => void;
  onConfirm: (issue: StoreOperationIssue, memo: string) => Promise<void>;
}

export function ResolveIssueModal({ issue, onClose, onConfirm }: ResolveIssueModalProps) {
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (issue) {
      setMemo('');
      setError(null);
    }
  }, [issue]);

  const normalizedLength = normalizeManualResolveMemo(memo).length;
  const valid = isValidManualResolveMemo(memo);

  const handleConfirm = async () => {
    if (!issue || !valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(issue, memo);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '기록을 닫지 못했어요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      opened={issue !== null}
      onClose={submitting ? () => undefined : onClose}
      title={<Text style={{ fontWeight: 'var(--fw-bold)' }}>해결로 닫기</Text>}
      radius="lg"
      centered
    >
      <Stack gap="sm">
        {issue && (
          <Text style={{ fontWeight: 'var(--fw-medium)' }}>{ISSUE_LABELS[issue.type]}</Text>
        )}
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          어떻게 처리했는지 메모로 남겨 주세요. 닫으면 홈 "운영 확인"과 아침 요약에서 빠지고, 누가
          언제 닫았는지 함께 남아요. 같은 문제가 다시 생기면 자동으로 다시 열려요.
        </Text>
        <Textarea
          value={memo}
          onChange={(event) => setMemo(event.currentTarget.value)}
          placeholder="예: 고객과 통화해 배송 사진을 다시 확인했어요"
          aria-label="닫는 이유 메모"
          autosize
          minRows={3}
          maxLength={MANUAL_RESOLVE_MEMO_MAX_LENGTH}
          radius="md"
          disabled={submitting}
        />
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-disabled)',
            textAlign: 'right',
          }}
        >
          {normalizedLength}/{MANUAL_RESOLVE_MEMO_MAX_LENGTH}
        </Text>
        {error && (
          <Text
            role="alert"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
          >
            {error}
          </Text>
        )}
        <Group gap="xs">
          <Button
            onClick={() => void handleConfirm()}
            disabled={!valid || submitting}
            loading={submitting}
            flex={1}
            radius="xl"
            style={{ fontWeight: 'var(--fw-medium)' }}
          >
            해결로 닫기
          </Button>
          <Button
            onClick={onClose}
            disabled={submitting}
            flex={1}
            radius="xl"
            variant="outline"
            color="gray"
          >
            취소
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
