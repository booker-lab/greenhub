'use client';

import { createContext, useContext, useState } from 'react';
import {
  dismissPendingPhoto,
  runPendingPhotoNow,
} from '@/app/board/[orderId]/photo/pending-photo-client';
import {
  PENDING_PHOTO_BADGE_LABEL,
  PENDING_PHOTO_MESSAGES,
  PENDING_PHOTO_UPLOAD_NOW_LABEL,
  type PendingPhotoBadgeKind,
  type PendingPhotoSummary,
  pendingPhotoBadgeKind,
  pendingPhotoStatusMessage,
} from '@/app/board/[orderId]/photo/pending-photo-policy';
import { AppButton } from './app-button';
import { text } from './look';

// 사진 업로드 대기열(Y3) 표시: 목록 행 배지와 상세 안내. 틀은 흰 바탕·검정 글자이고 실패만 빨강이다.

/** 목록 행 배지: 배송 중 주문 ID → 대기열 표시 상태. 목록 화면(BoardClient)이 채운다. */
const PendingPhotoBadgeContext = createContext<ReadonlyMap<string, PendingPhotoBadgeKind>>(
  new Map(),
);

export const PendingPhotoBadgeProvider = PendingPhotoBadgeContext.Provider;

export function usePendingPhotoBadge(orderId: string): PendingPhotoBadgeKind | null {
  return useContext(PendingPhotoBadgeContext).get(orderId) ?? null;
}

export function PendingPhotoBadge({ kind }: { kind: PendingPhotoBadgeKind }) {
  const failed = kind === 'failed';
  return (
    <span
      data-testid="pending-photo-badge"
      className="inline-flex items-center gap-1.5"
      style={{
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--fw-bold)',
        color: failed ? 'var(--color-danger)' : 'var(--color-text)',
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block size-2 rounded-full"
        style={{ backgroundColor: failed ? 'var(--color-danger)' : 'var(--color-text)' }}
      />
      {PENDING_PHOTO_BADGE_LABEL[kind]}
    </span>
  );
}

/**
 * 주문 상세의 대기열 안내. 기다리는 사진은 "지금 올리기"(자동 실행과 같은 함수·잠금, 사진 화면·목록 안내와
 * 같은 버튼 이름·같은 안내 문구), 멈춘 사진은 원인과 "확인했어요"(항목 지우기)를 보인다.
 */
export function PendingPhotoNotice({
  entry,
  userId,
}: {
  entry: PendingPhotoSummary;
  userId: string;
}) {
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState('');
  const now = Date.now();
  const kind = pendingPhotoBadgeKind(entry, now);
  const failed = kind === 'failed';
  return (
    <section
      aria-label="배송 완료 사진"
      className="flex flex-col gap-2 rounded-[var(--radius)] p-4"
      style={{
        backgroundColor: failed ? 'var(--color-danger-surface)' : 'var(--color-surface-muted)',
      }}
    >
      <PendingPhotoBadge kind={kind} />
      <p className={text} style={{ color: 'var(--color-text)', wordBreak: 'keep-all' }}>
        {pendingPhotoStatusMessage(entry, now)}
      </p>
      {note && (
        <p
          className={text}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' }}
        >
          {note}
        </p>
      )}
      {failed ? (
        <AppButton
          tone="brand-outline"
          onClick={() => void dismissPendingPhoto(userId, entry.orderId)}
        >
          확인했어요
        </AppButton>
      ) : (
        <AppButton
          tone="brand-outline"
          loading={running || kind === 'sending'}
          disabled={running || kind === 'sending'}
          onClick={() => {
            if (running) return;
            setRunning(true);
            setNote('');
            void runPendingPhotoNow(entry.orderId)
              .then((result) => {
                if (result === 'not-due') setNote(PENDING_PHOTO_MESSAGES.SOON);
              })
              .finally(() => setRunning(false));
          }}
        >
          {PENDING_PHOTO_UPLOAD_NOW_LABEL}
        </AppButton>
      )}
    </section>
  );
}
