'use client';

import type { AdminHiddenReview } from '@greenhub/shared';
import { notFound } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { describeListCap, readCappedList } from '@/hooks/useAdmin';
import { ApiError, apiJson } from '@/lib/api';
import { isFeatureOn } from '@/lib/features';
import { AdminFetchError } from '../_components/AdminFetchError';
import { HiddenReviewCard } from './_components/HiddenReviewCard';
import { UnhideConfirmModal } from './_components/UnhideConfirmModal';

// 판매자·관리자가 숨긴 후기 목록. 숨김 해제는 관리자만 이 화면에서 한다.

export default function AdminReviewsPage() {
  if (!isFeatureOn('reviews')) notFound();
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [items, setItems] = useState<AdminHiddenReview[] | null>(null);
  // 서버 상한(최근 N건)에 닿았으면 그 건수 — "최근 N건만 보여요" 안내.
  const [cap, setCap] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // 숨김 해제 확인창 대상과 선택 사유.
  const [confirmTarget, setConfirmTarget] = useState<AdminHiddenReview | null>(null);
  const [unhideReason, setUnhideReason] = useState('');
  // 조회 실패는 빈 목록("숨긴 후기가 없어요")과 구분해 실패 화면 + 다시 조회로 보여 준다.
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setItems(null);
    setLoadFailed(false);
    try {
      const list = readCappedList<AdminHiddenReview>(
        await apiJson<unknown>('/admin/reviews/hidden', token),
        'reviews',
      );
      setItems(list.items);
      setCap(list.cap);
    } catch {
      setLoadFailed(true);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const askUnhide = (review: AdminHiddenReview) => {
    setUnhideReason('');
    setConfirmTarget(review);
  };

  const unhide = async () => {
    const review = confirmTarget;
    if (!token || !review) return;
    setBusyId(review.id);
    setErrors(({ [review.id]: _old, ...rest }) => rest);
    const reason = unhideReason.trim();
    try {
      await apiJson(`/admin/reviews/${encodeURIComponent(review.id)}/unhide`, token, {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {}),
      });
      setItems((current) => (current ? current.filter((item) => item.id !== review.id) : current));
    } catch (failure) {
      const message =
        failure instanceof ApiError ? failure.message : '처리하지 못했어요. 다시 시도해 주세요.';
      setErrors((current) => ({ ...current, [review.id]: message }));
    } finally {
      setBusyId(null);
      setConfirmTarget(null);
    }
  };

  // ① 외형 유지(UI 교체 P2b): Mantine Stack(gap sm)·Title order 3(22px·800·줄 높이 1.4)·Text sm·xs.
  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-[22px] leading-[1.4] font-extrabold">숨긴 후기</h3>
      <p className="m-0 p-0 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        숨긴 후기는 고객 화면과 별점에서 빠져 있어요. 사유에 맞지 않게 숨긴 후기는 다시 보이게 해
        주세요.
      </p>
      {loadFailed ? (
        <AdminFetchError
          title="숨긴 후기를 불러오지 못했습니다."
          detail="숨긴 후기 조회 중 오류 발생"
          onRetry={load}
        />
      ) : items === null ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState text="숨긴 후기가 없어요" />
      ) : (
        <>
          {cap !== null && (
            <p className="m-0 p-0 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {describeListCap(cap)}
            </p>
          )}
          {items.map((review) => (
            <HiddenReviewCard
              key={review.id}
              review={review}
              busy={busyId === review.id}
              error={errors[review.id] ?? null}
              onUnhide={() => askUnhide(review)}
            />
          ))}
        </>
      )}
      <UnhideConfirmModal
        target={confirmTarget}
        reason={unhideReason}
        onReasonChange={setUnhideReason}
        busy={busyId !== null}
        onConfirm={unhide}
        onClose={() => {
          if (busyId === null) setConfirmTarget(null);
        }}
      />
    </div>
  );
}
