'use client';

import { Badge, Box, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useAdminStores } from '@/hooks/useAdmin';

const STATUS_LABEL: Record<string, string> = {
  active: '운영중',
  invited: '초대됨',
  suspended: '정지',
};

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  invited: 'yellow',
  suspended: 'gray',
};

export default function AdminStoresClient() {
  const { stores, loading, setCommission } = useAdminStores();
  const [editId, setEditId] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async (storeId: string) => {
    const rate = parseFloat(rateInput);
    if (Number.isNaN(rate) || rate < 0 || rate > 1) {
      notifications.show({
        color: 'orange',
        title: '입력 값을 확인하세요',
        message: '0~1 사이의 수수료율을 입력해야 합니다 (예: 0.05 = 5%).',
      });
      return;
    }
    setSaving(true);
    const ok = await setCommission(storeId, rate);
    setSaving(false);
    if (ok) {
      setEditId(null);
      setRateInput('');
    }
  };

  if (loading) {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  // 수수료율 표시/편집 — 테이블·카드 공용(중복 제거)
  const renderRate = (store: (typeof stores)[number]) =>
    editId === store.id ? (
      <Group gap="xs">
        <input
          type="number"
          step="0.01"
          min="0"
          max="1"
          value={rateInput}
          onChange={(e) => setRateInput(e.target.value)}
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
          onClick={() => handleSave(store.id)}
          disabled={saving}
          size="xs"
          color="green"
          radius="md"
        >
          저장
        </Button>
        <Button
          onClick={() => {
            setEditId(null);
            setRateInput('');
          }}
          size="xs"
          variant="subtle"
          color="gray"
          radius="md"
        >
          취소
        </Button>
      </Group>
    ) : (
      <Text style={{ color: 'var(--color-text-secondary)' }}>
        {store.commissionRate !== undefined
          ? `${(store.commissionRate * 100).toFixed(1)}%`
          : '기본'}
      </Text>
    );

  // 수수료 설정 진입 버튼 — 테이블·카드 공용
  const renderSetButton = (store: (typeof stores)[number]) =>
    editId !== store.id && (
      <Button
        onClick={() => {
          setEditId(store.id);
          setRateInput(String(store.commissionRate ?? ''));
        }}
        size="xs"
        variant="subtle"
        color="blue"
      >
        수수료 설정
      </Button>
    );

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>
          판매자 목록{' '}
          <Text
            component="span"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            ({stores.length})
          </Text>
        </Title>
      </Group>

      {stores.length === 0 ? (
        <Paper
          radius="lg"
          shadow="xs"
          style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          <Text ta="center" py={64} style={{ color: 'var(--color-text-disabled)' }}>
            등록된 판매자가 없습니다.
          </Text>
        </Paper>
      ) : (
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
                    <Text style={{ fontWeight: 'var(--fw-medium)' }}>
                      {store.name || '(미설정)'}
                    </Text>
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
                  {renderSetButton(store)}
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
                <Box
                  component="th"
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontWeight: 500,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  상호
                </Box>
                <Box
                  component="th"
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontWeight: 500,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  상태
                </Box>
                <Box
                  component="th"
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontWeight: 500,
                    color: 'var(--color-text-secondary)',
                  }}
                >
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
                    <Text style={{ fontWeight: 'var(--fw-medium)' }}>
                      {store.name || '(미설정)'}
                    </Text>
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
                  <Box component="td" style={{ padding: '12px 16px' }}>{renderRate(store)}</Box>
                  <Box component="td" style={{ padding: '12px 16px', textAlign: 'right' }}>
                    {renderSetButton(store)}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
          </Paper>
        </>
      )}
    </Box>
  );
}
