'use client';

import type { StoreCoupon } from '@greenhub/shared';
import {
  Badge,
  Button,
  Container,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { notFound } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { apiJson } from '@/lib/api';
import { isFeatureOn } from '@/lib/features';
import { couponSummary } from './coupon-summary';

// 가게 쿠폰 만들기·켜고 끄기. 소비자는 홈에서 받고 결제할 때 가장 큰 할인이 자동 적용된다.

const EMPTY = { name: '', discountType: 'amount' as 'amount' | 'percent', value: '', maxDiscount: '', minOrderAmount: '', endsAt: '' };

export default function CouponsPage() {
  if (!isFeatureOn('coupons')) notFound();
  const { data: session } = useSession();
  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;
  const [coupons, setCoupons] = useState<StoreCoupon[] | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!storeId || !token) return;
    apiJson<StoreCoupon[]>(`/stores/${storeId}/coupons`, token)
      .then(setCoupons)
      .catch(() => setCoupons([]));
  }, [storeId, token]);
  useEffect(load, [load]);

  async function create() {
    if (!storeId || !token) return;
    const value = Number(draft.value);
    if (!draft.name.trim() || !Number.isInteger(value) || value < 1) {
      setError('쿠폰 이름과 할인 값을 입력해 주세요.');
      return;
    }
    if (draft.discountType === 'percent' && value > 90) {
      setError('할인율은 90%까지예요.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/stores/${storeId}/coupons`, token, {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          discountType: draft.discountType,
          value,
          ...(draft.discountType === 'percent' && draft.maxDiscount ? { maxDiscount: Number(draft.maxDiscount) } : {}),
          minOrderAmount: Number(draft.minOrderAmount || 0),
          ...(draft.endsAt ? { endsAt: new Date(`${draft.endsAt}T23:59:59+09:00`).toISOString() } : {}),
          active: true,
          claimable: true,
        }),
      });
      setDraft(EMPTY);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '쿠폰을 만들지 못했어요.');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(coupon: StoreCoupon, active: boolean) {
    if (!storeId || !token) return;
    setCoupons((current) => current?.map((c) => (c.id === coupon.id ? { ...c, active } : c)) ?? null);
    try {
      await apiJson(`/stores/${storeId}/coupons/${coupon.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      });
    } catch {
      load();
    }
  }

  const digits = (value: string) => value.replace(/[^0-9]/g, '');

  return (
    <PageShell>
      <PageHeader title="쿠폰" />
      <Container size="sm" px="md" py="md">
        <Stack gap="sm">
          <Paper radius="lg" shadow="xs" p="md">
            <Stack gap="sm">
              <Text fw={700}>새 쿠폰</Text>
              <TextInput
                label="이름"
                maxLength={30}
                placeholder="예: 첫 주문 3,000원"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
              />
              <SegmentedControl
                color="green"
                data={[
                  { value: 'amount', label: '금액 할인' },
                  { value: 'percent', label: '% 할인' },
                ]}
                value={draft.discountType}
                onChange={(value) => setDraft({ ...draft, discountType: value as 'amount' | 'percent' })}
              />
              <Group grow>
                <TextInput
                  label={draft.discountType === 'amount' ? '할인 금액(원)' : '할인율(%)'}
                  inputMode="numeric"
                  value={draft.value}
                  onChange={(event) => setDraft({ ...draft, value: digits(event.currentTarget.value) })}
                />
                {draft.discountType === 'percent' && (
                  <TextInput
                    label="최대 할인(원)"
                    inputMode="numeric"
                    value={draft.maxDiscount}
                    onChange={(event) => setDraft({ ...draft, maxDiscount: digits(event.currentTarget.value) })}
                  />
                )}
              </Group>
              <Group grow>
                <TextInput
                  label="최소 주문 금액(원)"
                  inputMode="numeric"
                  value={draft.minOrderAmount}
                  onChange={(event) => setDraft({ ...draft, minOrderAmount: digits(event.currentTarget.value) })}
                />
                <TextInput
                  label="마감일"
                  type="date"
                  value={draft.endsAt}
                  onChange={(event) => setDraft({ ...draft, endsAt: event.currentTarget.value })}
                />
              </Group>
              {error && (
                <Text role="alert" size="sm" c="var(--color-danger)">
                  {error}
                </Text>
              )}
              <Button radius="xl" loading={saving} onClick={create}>
                쿠폰 만들기
              </Button>
              <Text size="sm" c="var(--color-text-secondary)">
                할인액은 가게 정산에서 빠져요. 구매 스탬프 보상 쿠폰은 자동으로 만들어져요.
              </Text>
            </Stack>
          </Paper>

          {coupons === null ? (
            <LoadingState />
          ) : coupons.length === 0 ? (
            <EmptyState text="아직 만든 쿠폰이 없어요" />
          ) : (
            coupons.map((coupon) => (
              <Paper key={coupon.id} radius="lg" shadow="xs" p="md">
                <Group justify="space-between" wrap="nowrap">
                  <Stack gap={2} style={{ minWidth: 0 }}>
                    <Group gap={6}>
                      <Text fw={700}>{coupon.name}</Text>
                      {!coupon.active && <Badge color="gray">꺼짐</Badge>}
                    </Group>
                    <Text size="sm" c="var(--color-text-secondary)">
                      {couponSummary(coupon)}
                      {coupon.endsAt ? ` · ${new Date(coupon.endsAt).toLocaleDateString('ko-KR')}까지` : ''}
                    </Text>
                  </Stack>
                  <Switch
                    color="green"
                    aria-label={`${coupon.name} 켜기`}
                    checked={coupon.active}
                    onChange={(event) => void toggle(coupon, event.currentTarget.checked)}
                  />
                </Group>
              </Paper>
            ))
          )}
        </Stack>
      </Container>
    </PageShell>
  );
}
