'use client';

import type { PartnerInquiryContactedRequest, PartnerInquiryItem } from '@greenhub/shared';
import { Stack, Text, Title } from '@mantine/core';
import { notFound } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { ApiError, apiJson } from '@/lib/api';
import { isFeatureOn } from '@/lib/features';
import { AdminFetchError } from '../_components/AdminFetchError';
import { PartnerInquiryCard } from './_components/PartnerInquiryCard';

// 소비자 앱 '입점 문의'로 들어온 농가·생산자 연락. 개인정보라 1년 뒤 지우는 것을 전제로 받는다.
// 문의한 사람이 파기를 요청하면 1년을 기다리지 않고 여기서 바로 지운다.

const failureMessage = (failure: unknown) =>
  failure instanceof ApiError ? failure.message : '처리하지 못했어요. 다시 시도해 주세요.';

export default function AdminPartnerInquiriesPage() {
  if (!isFeatureOn('partner-inquiry')) notFound();
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [items, setItems] = useState<PartnerInquiryItem[] | null>(null);
  // 조회 실패는 빈 목록("입점 문의가 아직 없어요")과 구분해 실패 화면 + 다시 조회로 보여 준다.
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<PartnerInquiryItem | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setItems(null);
    setLoadFailed(false);
    try {
      setItems(await apiJson<PartnerInquiryItem[]>('/admin/partner-inquiries', token));
    } catch {
      setLoadFailed(true);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // 한 건 작업: 시작 시 그 건의 이전 오류를 지우고, 실패하면 그 카드 아래에 사유를 보여 준다.
  const runFor = async (item: PartnerInquiryItem, action: (token: string) => Promise<void>) => {
    if (!token) return;
    setBusyId(item.id);
    setErrors(({ [item.id]: _old, ...rest }) => rest);
    try {
      await action(token);
    } catch (failure) {
      setErrors((current) => ({ ...current, [item.id]: failureMessage(failure) }));
    } finally {
      setBusyId(null);
    }
  };

  const toggleContacted = (item: PartnerInquiryItem) =>
    runFor(item, async (accessToken) => {
      const body: PartnerInquiryContactedRequest = { contacted: item.contactedAt === null };
      const result = await apiJson<{ id: string; contactedAt: string | null }>(
        `/admin/partner-inquiries/${encodeURIComponent(item.id)}/contacted`,
        accessToken,
        { method: 'PUT', body: JSON.stringify(body) },
      );
      setItems((current) =>
        current
          ? current.map((row) =>
              row.id === item.id ? { ...row, contactedAt: result.contactedAt } : row,
            )
          : current,
      );
    });

  const confirmDelete = async () => {
    const item = deleteTarget;
    if (!item) return;
    await runFor(item, async (accessToken) => {
      await apiJson(`/admin/partner-inquiries/${encodeURIComponent(item.id)}`, accessToken, {
        method: 'DELETE',
      });
      setItems((current) => (current ? current.filter((row) => row.id !== item.id) : current));
    });
    setDeleteTarget(null);
  };

  return (
    <Stack gap="sm">
      <Title order={3}>입점 문의</Title>
      <Text size="sm" c="var(--color-text-secondary)">
        받은 날부터 1년 동안만 보관해요. 연락처는 입점 상담에만 써 주세요. 문의한 분이 지워 달라고
        하면 바로 삭제해 주세요.
      </Text>
      {loadFailed ? (
        <AdminFetchError
          title="입점 문의를 불러오지 못했습니다."
          detail="입점 문의 조회 중 오류 발생"
          onRetry={load}
        />
      ) : items === null ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState text="입점 문의가 아직 없어요" />
      ) : (
        items.map((item) => (
          <PartnerInquiryCard
            key={item.id}
            item={item}
            busy={busyId === item.id}
            error={errors[item.id] ?? null}
            onToggleContacted={() => toggleContacted(item)}
            onDelete={() => setDeleteTarget(item)}
          />
        ))
      )}
      <ConfirmModal
        opened={deleteTarget !== null}
        title="입점 문의 삭제"
        message={
          deleteTarget
            ? `${deleteTarget.farmName} · ${deleteTarget.region}\n연락처와 내용을 바로 지웁니다. 되돌릴 수 없습니다.`
            : ''
        }
        confirmLabel="삭제"
        loading={busyId !== null}
        onConfirm={confirmDelete}
        onClose={() => {
          if (busyId === null) setDeleteTarget(null);
        }}
      />
    </Stack>
  );
}
