'use client';

import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import type { AdminStore } from '@/hooks/useAdmin';
import { formatRate, STATUS_COLOR, STATUS_LABEL } from '../_lib';

interface StoresTableProps {
  stores: AdminStore[];
  editId: string | null;
  rateInput: string;
  saving: boolean;
  onRateInput: (v: string) => void;
  onStartEdit: (store: AdminStore) => void;
  onCancelEdit: () => void;
  onSave: (storeId: string) => void;
  onArchive: (store: AdminStore) => void;
  onRestore: (store: AdminStore) => void;
}

const thBase = {
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

export function StoresTable({
  stores,
  editId,
  rateInput,
  saving,
  onRateInput,
  onStartEdit,
  onCancelEdit,
  onSave,
  onArchive,
  onRestore,
}: StoresTableProps) {
  if (stores.length === 0) {
    return (
      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <Text ta="center" py={64} style={{ color: 'var(--color-text-disabled)' }}>
          등록된 판매자가 없습니다.
        </Text>
      </Paper>
    );
  }

  // 수수료율 표시/편집 — 테이블·카드 공용(중복 제거)
  const renderRate = (store: AdminStore) =>
    editId === store.id ? (
      <Group gap="xs">
        <input
          type="number"
          step="0.01"
          min="0"
          max="1"
          value={rateInput}
          onChange={(e) => onRateInput(e.target.value)}
          placeholder="0.05"
          style={{
            width: 80,
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 'var(--font-size-sm)',
          }}
        />
        <Button
          onClick={() => onSave(store.id)}
          disabled={saving}
          size="xs"
          color="green"
          radius="md"
        >
          저장
        </Button>
        <Button onClick={onCancelEdit} size="xs" variant="subtle" color="gray" radius="md">
          취소
        </Button>
      </Group>
    ) : (
      <Text style={{ color: 'var(--color-text-secondary)' }}>
        {formatRate(store.commissionRate)}
      </Text>
    );

  // 수수료 설정 진입 버튼 — 테이블·카드 공용
  const renderSetButton = (store: AdminStore) =>
    editId !== store.id && (
      <Button onClick={() => onStartEdit(store)} size="xs" variant="subtle" color="blue">
        수수료 설정
      </Button>
    );

  // 치우기/복구 버튼 — 테이블·카드 공용
  const renderArchiveButton = (store: AdminStore) =>
    editId !== store.id &&
    (store.status === 'archived' ? (
      <Button onClick={() => onRestore(store)} size="xs" variant="subtle" color="blue">
        복구
      </Button>
    ) : (
      <Button onClick={() => onArchive(store)} size="xs" variant="subtle" color="red">
        치우기
      </Button>
    ));

  return (
    <>
      {/* 모바일(<sm): 카드 리스트 — 수수료율·설정 버튼 잘림 방지 */}
      <Stack gap="sm" hiddenFrom="sm">
        {stores.map((store) => (
          <Paper
            key={store.id}
            radius="md"
            px="md"
            py="sm"
            shadow="xs"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <Group justify="space-between" mb="xs" align="flex-start">
              <Box>
                <Text style={{ fontWeight: 'var(--fw-medium)' }}>{store.name || '(미설정)'}</Text>
                <Text
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-disabled)',
                  }}
                  ff="monospace"
                >
                  {store.id.slice(0, 8)}…
                </Text>
              </Box>
              <Badge color={STATUS_COLOR[store.status] ?? 'gray'} variant="light" radius="xl">
                {STATUS_LABEL[store.status] ?? store.status}
              </Badge>
            </Group>
            <Group justify="space-between" align="center" mt="xs">
              {renderRate(store)}
              <Group gap="xs">
                {renderSetButton(store)}
                {renderArchiveButton(store)}
              </Group>
            </Group>
          </Paper>
        ))}
      </Stack>

      {/* 데스크톱(≥sm): 기존 테이블 유지(시각 회귀 0) */}
      <Paper
        radius="lg"
        shadow="xs"
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        visibleFrom="sm"
      >
        <Box
          component="table"
          style={{ width: '100%', fontSize: 'var(--font-size-sm)', borderCollapse: 'collapse' }}
        >
          <Box
            component="thead"
            style={{
              backgroundColor: 'var(--color-surface-muted)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <tr>
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                상호
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                상태
              </Box>
              <Box component="th" style={{ ...thBase, textAlign: 'left' }}>
                수수료율
              </Box>
              <Box component="th" style={{ padding: '12px 16px' }} />
            </tr>
          </Box>
          <Box component="tbody" style={{ borderTop: 'none' }}>
            {stores.map((store) => (
              <Box
                component="tr"
                key={store.id}
                style={{ borderTop: '1px solid var(--color-border)' }}
              >
                <Box component="td" style={{ padding: '12px 16px' }}>
                  <Text style={{ fontWeight: 'var(--fw-medium)' }}>{store.name || '(미설정)'}</Text>
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-disabled)',
                    }}
                    ff="monospace"
                  >
                    {store.id.slice(0, 8)}…
                  </Text>
                </Box>
                <Box component="td" style={{ padding: '12px 16px' }}>
                  <Badge color={STATUS_COLOR[store.status] ?? 'gray'} variant="light" radius="xl">
                    {STATUS_LABEL[store.status] ?? store.status}
                  </Badge>
                </Box>
                <Box component="td" style={{ padding: '12px 16px' }}>
                  {renderRate(store)}
                </Box>
                <Box component="td" style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <Group gap="xs" justify="flex-end">
                    {renderSetButton(store)}
                    {renderArchiveButton(store)}
                  </Group>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Paper>
    </>
  );
}
