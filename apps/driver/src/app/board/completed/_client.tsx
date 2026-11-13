'use client';

import { CloseIcon } from '@greenhub/ui/components/close-button';
import {
  Dialog,
  DialogClose,
  DialogOverlay,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { cn } from '@greenhub/ui/lib/utils';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AppButton } from '@/components/app-button';
import { text } from '@/components/look';
import { Spinner } from '@/components/spinner';
import { apiRead } from '@/lib/api';
import {
  classifyDriverCompletedPhotoStatus,
  type DriverCompletedOrder,
  readDriverCompletedPhoto,
  readDriverCompletedToday,
} from '@/lib/driver-completed-today';
import {
  buildDriverListScope,
  shouldPreserveDriverListOnReadError,
  toDriverListReadError,
  toDriverListReadErrorKind,
} from '@/lib/driver-list-read';
import {
  readDriverDetailBackContext,
  resolveDriverDetailBackAction,
} from '../_lib/driver-order-detail';
import { buildCompletedRowView } from './_lib/completed-row';

/** 복귀 재조회 묶음 간격. focus·visibilitychange가 이 간격 안에 겹치면 한 번만 다시 조회한다(작업 보드와 같다). */
const REVALIDATE_COALESCE_MS = 1_500;

/**
 * 사진 보기 창 상태. 사진 주소는 열 때마다 새로 받는다(15분 서명 주소라 기억해 두지 않는다).
 * refetched: 이미지 로드 실패로 주소를 한 번 다시 받았는지. 다시 받은 주소도 실패하면 실패 안내로 멈춘다.
 */
type PhotoViewer = {
  order: DriverCompletedOrder;
  phase: 'loading' | 'ready' | 'missing' | 'error';
  url: string | null;
  refetched: boolean;
};

export default function CompletedTodayClient() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();

  const [orders, setOrders] = useState<DriverCompletedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasSuccessfulRead, setHasSuccessfulRead] = useState(false);
  const requestIdRef = useRef(0);
  const hasSuccessfulReadRef = useRef(false);
  // user identity + role + access token scope가 바뀌면 이전 scope의 완료 내역·사진을
  // 새 조회 완료 전에 동기적으로 지운다(작업 보드와 같은 scope 판정).
  const listScopeRef = useRef<string | null>(null);

  const [viewer, setViewer] = useState<PhotoViewer | null>(null);
  // 사진 조회 세대. 창 닫기·scope 전환·권한 상실이 올리면 이전 조회 응답은 화면에 쓰지 않는다.
  const photoSeqRef = useRef(0);
  const photoAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  // 렌더 중 동기 갱신되는 live scope: 사진 조회 중 세션이 바뀌면 effect 실행 전에도 응답을 버린다.
  const liveScopeRef = useRef<string | null>(null);
  liveScopeRef.current = session?.user.accessToken
    ? buildDriverListScope({
        userId: session.user.id,
        role: session.user.role,
        token: session.user.accessToken,
      })
    : '__no_token__';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      photoSeqRef.current += 1;
      photoAbortRef.current?.abort();
    };
  }, []);

  // 사진 창을 닫고 진행 중인 사진 조회를 버린다.
  const closeViewer = () => {
    photoSeqRef.current += 1;
    photoAbortRef.current?.abort();
    photoAbortRef.current = null;
    setViewer(null);
  };

  // 권한 상실(401·403·토큰 없음): 완료 내역과 사진을 즉시 지우고 로그인 안내로 바꾼다.
  // 진행 중인 목록 조회가 지운 목록을 다시 채우지 않도록 조회 순번도 무효화한다.
  const loseAuthority = () => {
    requestIdRef.current += 1;
    hasSuccessfulReadRef.current = false;
    setHasSuccessfulRead(false);
    setOrders([]);
    closeViewer();
    setAuthRequired(true);
    setError(null);
    setLoading(false);
    setRefreshing(false);
  };

  // focus 복귀·visibility 복귀 때 다시 조회한다. 앱 복귀 한 번에 두 이벤트가 함께 오므로 한 번으로 묶는다.
  useEffect(() => {
    let lastRevalidateAt = Number.NEGATIVE_INFINITY;
    const revalidate = () => {
      const now = Date.now();
      if (now - lastRevalidateAt < REVALIDATE_COALESCE_MS) return;
      lastRevalidateAt = now;
      setReloadKey((key) => key + 1);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') revalidate();
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is an intentional manual-refresh trigger for the retry button
  useEffect(() => {
    if (sessionStatus === 'loading') return;

    const token = session?.user.accessToken;
    if (!token) {
      // 쓸 수 있는 토큰이 없으면 0건 성공으로 보이지 않고 이전 내역·사진도 남기지 않는다.
      listScopeRef.current = '__no_token__';
      loseAuthority();
      return;
    }

    const nextScope = buildDriverListScope({
      userId: session?.user.id,
      role: session?.user.role,
      token,
    });
    if (listScopeRef.current !== nextScope) {
      // user/role/token scope 변경: 새 조회를 기다리지 않고 이전 scope의 완료 내역·사진·성공 기록을 지운다.
      // 진행 중이던 이전 scope 조회는 순번 무효화로 덮어쓰기를 막는다.
      requestIdRef.current += 1;
      listScopeRef.current = nextScope;
      hasSuccessfulReadRef.current = false;
      setHasSuccessfulRead(false);
      setOrders([]);
      closeViewer();
      setError(null);
      setAuthRequired(false);
      setLoading(true);
      setRefreshing(false);
    }

    const controller = new AbortController();
    let active = true;
    // Abort에만 기대지 않는 순번 가드: 오래된 응답이 최신 요청을 덮지 못한다.
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    const isCurrent = () => active && requestId === requestIdRef.current;
    if (hasSuccessfulReadRef.current) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setAuthRequired(false);
    setError(null);

    apiRead('/driver/completed-today', token, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw toDriverListReadError(response.status, '완료 내역을 불러오지 못했어요');
        const parsed = readDriverCompletedToday(await response.json());
        if (!parsed) throw new Error('driver completed-today response is malformed');
        return parsed.orders;
      })
      .then((nextOrders) => {
        if (!isCurrent()) return;
        setOrders(nextOrders);
        hasSuccessfulReadRef.current = true;
        setHasSuccessfulRead(true);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!isCurrent() || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        const kind = toDriverListReadErrorKind(cause);
        if (kind === 'AUTH_ERROR') {
          // 권한 상실(401·403): 이전 완료 내역·사진을 즉시 지우고 로그인 안내로 바꾼다.
          loseAuthority();
          return;
        }
        if (shouldPreserveDriverListOnReadError(kind, hasSuccessfulReadRef.current)) {
          // 이전 성공이 있을 때만 마지막 내역을 지우지 않고 보여 준다.
          setError('최신 완료 내역을 불러오지 못했어요.');
        } else {
          setOrders([]);
          setError('완료 내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
        }
      })
      .finally(() => {
        if (!isCurrent()) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [session?.user.id, session?.user.role, session?.user.accessToken, sessionStatus, reloadKey]);

  const retry = () => setReloadKey((key) => key + 1);

  // 사진 주소를 새로 받아 창에 띄운다. 누를 때마다 새로 받는다.
  async function loadPhoto(order: DriverCompletedOrder, refetched: boolean) {
    const token = session?.user.accessToken;
    if (!token) {
      loseAuthority();
      return;
    }
    photoSeqRef.current += 1;
    const seq = photoSeqRef.current;
    photoAbortRef.current?.abort();
    const controller = new AbortController();
    photoAbortRef.current = controller;
    const startScope = liveScopeRef.current;
    const isCurrent = () =>
      mountedRef.current && seq === photoSeqRef.current && liveScopeRef.current === startScope;
    const show = (phase: PhotoViewer['phase'], url: string | null = null) =>
      setViewer({ order, phase, url, refetched });
    show('loading');
    try {
      const response = await apiRead(
        `/driver/completed-today/${encodeURIComponent(order.id)}/photo`,
        token,
        { signal: controller.signal },
      );
      if (!isCurrent()) return;
      if (!response.ok) {
        const kind = classifyDriverCompletedPhotoStatus(response.status);
        if (kind === 'AUTH_ERROR') {
          // 사진을 보는 중 권한을 잃으면 사진과 완료 내역을 모두 지운다.
          loseAuthority();
          return;
        }
        show(kind === 'MISSING' ? 'missing' : 'error');
        return;
      }
      const photo = readDriverCompletedPhoto(await response.json());
      if (!isCurrent()) return;
      if (photo) show('ready', photo.url);
      else show('error');
    } catch {
      if (!isCurrent() || controller.signal.aborted) return;
      show('error');
    }
  }

  // 이미지 로드 실패: 서명 주소가 만료됐을 수 있어 주소를 한 번만 다시 받는다. 그래도 실패하면 실패 안내다.
  const handleImageError = () => {
    if (viewer?.phase !== 'ready') return;
    if (!viewer.refetched) {
      void loadPhoto(viewer.order, true);
      return;
    }
    setViewer({ ...viewer, phase: 'error', url: null });
  };

  // 앱 안 이전 기록이 있을 때만 브라우저 뒤로, 없으면(링크로 바로 연 경우) 작업 보드로 바꿔 보낸다(상세와 같다).
  const goBack = () => {
    if (resolveDriverDetailBackAction(readDriverDetailBackContext(window)) === 'back') {
      router.back();
      return;
    }
    router.replace('/board');
  };

  const showCount = hasSuccessfulRead && !authRequired;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      {/* 머리: 뒤로 + "오늘 완료 n곳". 틀은 흰 바탕·검정 글자(상세 머리와 같다). */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backgroundColor: 'var(--color-bg)',
          padding: '4px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={goBack}
          className="-ml-2.5 flex size-11 cursor-pointer appearance-none items-center justify-center border-0 bg-transparent p-0 no-underline"
          style={{ color: 'var(--color-text)' }}
          aria-label="뒤로가기"
        >
          <svg
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <h1
          className="m-0"
          style={{
            fontSize: 'var(--font-size-md)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-text)',
            lineHeight: 1.4,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {showCount ? `오늘 완료 ${orders.length}곳` : '오늘 완료 내역'}
        </h1>
      </header>

      <main style={{ flex: 1, padding: '8px 16px 24px' }}>
        {loading ? (
          <CenterMessage>완료 내역을 불러오고 있어요</CenterMessage>
        ) : authRequired ? (
          <CenterMessage tone="danger" message="로그인이 끝났어요. 다시 로그인해 주세요.">
            {/* 같은 토큰으로 다시 조회해도 401·403이 반복되므로 다시 시도 없이 로그인으로 보낸다(작업 보드와 같다). */}
            <AppButton onClick={() => void signOut({ redirectTo: '/login' })}>
              다시 로그인
            </AppButton>
          </CenterMessage>
        ) : error && !hasSuccessfulRead ? (
          <ProblemPanel>
            <p className={text} style={problemText}>
              {error}
            </p>
            <AppButton tone="brand-outline" onClick={retry}>
              다시 시도
            </AppButton>
          </ProblemPanel>
        ) : (
          <div className="flex flex-col gap-3">
            {refreshing && (
              <p className={text} style={mutedText}>
                최신 정보를 확인하고 있어요…
              </p>
            )}
            {error && (
              <ProblemPanel>
                <p className={text} style={problemText}>
                  {error} (이전 목록 표시 중)
                </p>
                <AppButton tone="brand-outline" onClick={retry}>
                  다시 시도
                </AppButton>
              </ProblemPanel>
            )}
            {orders.length === 0 ? (
              <CenterMessage>오늘 마친 배송이 없어요</CenterMessage>
            ) : (
              <ul className="m-0 list-none p-0">
                {orders.map((order, index) => (
                  <li
                    key={order.id}
                    style={index === 0 ? undefined : { borderTop: 'var(--border)' }}
                  >
                    <CompletedRow order={order} onOpenPhoto={() => void loadPhoto(order, false)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>

      <PhotoDialog
        viewer={viewer}
        onClose={closeViewer}
        onRetry={() => {
          if (viewer) void loadPhoto(viewer.order, false);
        }}
        onImageError={handleImageError}
      />
    </div>
  );
}

// 한국어 글이 낱말 중간에서 줄을 바꾸지 않게 한다. 긴 주소·낱말만 아무 데서나 끊는다(상세와 같다).
const keepWords = { wordBreak: 'keep-all', overflowWrap: 'anywhere' } as const;
const mutedText = { fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' } as const;
const problemText = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-bold)',
  color: 'var(--color-text)',
} as const;

/** 한 행: 동·호수(크게), 기본 주소(작게), 상품 요약, 완료 시각·상태와 사진 보기. 손님 이름·전화는 없다. */
function CompletedRow({
  order,
  onOpenPhoto,
}: {
  order: DriverCompletedOrder;
  onOpenPhoto: () => void;
}) {
  const view = buildCompletedRowView(order);
  return (
    <div data-testid={`driver-completed-${order.id}`} className="flex flex-col gap-0.5 py-3">
      <p
        className={text}
        style={{
          fontSize: 'var(--font-size-lg)',
          fontWeight: 'var(--fw-bold)',
          color: 'var(--color-text)',
          lineHeight: 1.4,
          fontVariantNumeric: 'tabular-nums',
          ...keepWords,
        }}
      >
        {view.primary}
      </p>
      {view.secondary && (
        <p className={text} style={{ ...mutedText, ...keepWords }}>
          {view.secondary}
        </p>
      )}
      <p className={text} style={{ ...mutedText, ...keepWords }}>
        {view.itemsText}
      </p>
      <div className="flex items-center justify-between gap-3">
        <p
          className={text}
          style={{ ...mutedText, fontVariantNumeric: 'tabular-nums', ...keepWords }}
        >
          {view.time ? `${view.time} 완료` : '완료'}
          {view.statusLabel && (
            <>
              {' · '}
              <span style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' }}>
                {view.statusLabel}
              </span>
            </>
          )}
        </p>
        {order.hasPhoto ? (
          <button
            type="button"
            className="m-0 min-h-11 shrink-0 cursor-pointer appearance-none border-0 bg-transparent p-0 underline underline-offset-4"
            style={{
              fontSize: 'var(--font-size-md)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-text)',
              wordBreak: 'keep-all',
            }}
            onClick={onOpenPhoto}
          >
            사진 보기
          </button>
        ) : (
          <p className={cn(text, 'shrink-0')} style={{ ...mutedText, wordBreak: 'keep-all' }}>
            사진이 없어요
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * 배송 완료 사진 전체 화면 창. 서명 주소 이미지는 next/image 최적화를 거치지 않고 브라우저가 바로 받으며
 * 주소가 다른 곳으로 새지 않도록 referrer를 보내지 않는다.
 */
function PhotoDialog({
  viewer,
  onClose,
  onRetry,
  onImageError,
}: {
  viewer: PhotoViewer | null;
  onClose: () => void;
  onRetry: () => void;
  onImageError: () => void;
}) {
  const view = viewer ? buildCompletedRowView(viewer.order) : null;
  return (
    <Dialog
      open={viewer !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        {/* 하단 탭(z 100) 위를 덮도록 z 200으로 둔다(다른 확인 창과 같다). */}
        <DialogOverlay className="z-[200] bg-black" />
        <DialogPopup
          data-slot="dialog-content"
          className="fixed inset-0 z-[200] flex flex-col bg-black text-white outline-none"
        >
          <div
            className="flex items-center gap-2"
            style={{ padding: 'calc(4px + env(safe-area-inset-top)) 8px 4px 16px' }}
          >
            <DialogTitle
              className="m-0 min-w-0 flex-1 p-0 text-white"
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                lineHeight: 1.4,
                ...keepWords,
              }}
            >
              {view
                ? `${view.primary}${view.time ? ` · ${view.time} 완료` : ''}`
                : '배송 완료 사진'}
            </DialogTitle>
            <DialogClose
              aria-label="닫기"
              className="flex size-11 shrink-0 cursor-pointer appearance-none items-center justify-center rounded-full border-0 bg-transparent p-0 text-white"
            >
              <CloseIcon />
            </DialogClose>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            {viewer?.phase === 'loading' && <Spinner />}
            {viewer?.phase === 'ready' && viewer.url && (
              // biome-ignore lint/performance/noImgElement: 15분 서명 주소라 next/image 최적화·캐시를 거치지 않고 브라우저가 바로 받는다.
              <img
                key={viewer.url}
                src={viewer.url}
                alt="배송 완료 사진"
                referrerPolicy="no-referrer"
                decoding="async"
                className="max-h-full max-w-full object-contain"
                onError={onImageError}
              />
            )}
            {viewer?.phase === 'missing' && (
              <p className={cn(text, 'text-center text-white')} style={keepWords}>
                사진이 없어요
              </p>
            )}
            {viewer?.phase === 'error' && (
              <div className="flex flex-col items-center gap-3">
                <p className={cn(text, 'text-center text-white')} style={keepWords}>
                  사진을 불러오지 못했어요
                </p>
                <AppButton tone="white-outline" onClick={onRetry}>
                  다시 시도
                </AppButton>
              </div>
            )}
          </div>
          <div style={{ padding: '12px 16px calc(12px + env(safe-area-inset-bottom))' }}>
            <AppButton tone="white-outline" size="xl" fullWidth onClick={onClose}>
              닫기
            </AppButton>
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

function CenterMessage({
  children,
  message,
  tone,
}: {
  children: ReactNode;
  message?: string;
  tone?: 'danger';
}) {
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-2.5">
      {message ? (
        <>
          <p
            className={cn(text, 'text-center')}
            style={{
              ...mutedText,
              ...keepWords,
              color: tone === 'danger' ? 'var(--color-danger)' : mutedText.color,
            }}
          >
            {message}
          </p>
          {children}
        </>
      ) : (
        <p className={cn(text, 'text-center')} style={{ ...mutedText, ...keepWords }}>
          {children}
        </p>
      )}
    </div>
  );
}

/** 문제 상태 면: 테두리 없이 빨강 연한 면, 글자는 검정(상세 ProblemPanel과 같다). */
function ProblemPanel({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-2.5 rounded-[var(--radius)] p-4"
      style={{ backgroundColor: 'var(--color-danger-surface)' }}
    >
      {children}
    </div>
  );
}
