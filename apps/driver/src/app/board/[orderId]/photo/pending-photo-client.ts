'use client';

/**
 * 사진 업로드 대기열의 브라우저 연결: IndexedDB 저장소·실행기 하나·화면 갱신 알림·화면용 훅.
 *
 * - 저장소를 쓸 수 없으면(IndexedDB 없음·차단) 모든 함수가 "대기열 없음"으로 조용히 끝난다.
 *   화면은 그때 예전 동작·예전 안내로 남는다.
 * - Service Worker·Background Sync는 쓰지 않는다(iOS에 SyncManager가 없고, 토큰을 SW·IDB에 두지 않는다).
 *   실행은 앱이 열려 있는 동안 PendingPhotoUploader가 맡고, 토큰은 실행마다 getSession()으로 새로 받는다.
 */

import { isSafeApiPathSegment } from '@greenhub/shared';
import { toast } from '@greenhub/ui/components/toast';
import { getSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { apiFetch, apiRead } from '@/lib/api';
import { rememberCompletedOrder } from '../../_lib/recent-completion';
import {
  type PendingPhotoEntry,
  type PendingPhotoSummary,
  pendingPhotoCompletedMessage,
  pendingPhotoKey,
  pendingPhotoLogoutLabels,
  toPendingPhotoSummary,
} from './pending-photo-policy';
import {
  createPendingPhotoRunner,
  type PendingPhotoLockManager,
  type PendingPhotoRunner,
  type PendingPhotoRunResult,
  type PendingPhotoStoreIdRead,
} from './pending-photo-runner';
import { createIndexedDbPendingPhotoStore, type PendingPhotoStore } from './pending-photo-store';
import { readDriverOrderStoreId } from './photo-upload-policy';

const CHANNEL_NAME = 'greenhub-driver-pending-photos';

type Listener = () => void;
type CompletedListener = (orderId: string) => void;

const changeListeners = new Set<Listener>();
const kickListeners = new Set<Listener>();
const completedListeners = new Set<CompletedListener>();

let storeSingleton: PendingPhotoStore | null | undefined;
let runnerSingleton: PendingPhotoRunner | null | undefined;
let channel: BroadcastChannel | null | undefined;

function emit(listeners: Set<Listener>) {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 화면 갱신 실패는 대기열 동작에 영향을 주지 않는다.
    }
  }
}

function broadcastChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
    if (channel) channel.onmessage = () => emit(changeListeners);
  } catch {
    channel = null;
  }
  return channel;
}

/** 다른 탭에도 항목이 바뀌었다고 알린다(내용은 싣지 않는다). */
function notifyChanged() {
  emit(changeListeners);
  try {
    broadcastChannel()?.postMessage('changed');
  } catch {
    // 알리지 못해도 다른 탭은 화면 복귀 때 다시 읽는다.
  }
}

/** 브라우저 IndexedDB 저장소. 쓸 수 없으면 null. */
export function getPendingPhotoStore(): PendingPhotoStore | null {
  if (storeSingleton !== undefined) return storeSingleton;
  try {
    const factory = typeof window === 'undefined' ? undefined : window.indexedDB;
    storeSingleton = factory ? createIndexedDbPendingPhotoStore(factory) : null;
  } catch {
    // 접근 자체가 SecurityError를 던지는 환경(저장소 차단).
    storeSingleton = null;
  }
  return storeSingleton;
}

async function readStoreIdForQueue(
  orderId: string,
  token: string,
): Promise<PendingPhotoStoreIdRead> {
  try {
    const response = await apiRead(`/driver/orders/${encodeURIComponent(orderId)}`, token);
    if (response.status === 404) return { kind: 'absent' };
    if (response.status === 403) return { kind: 'authority' };
    if (response.status === 401) return { kind: 'unauthorized' };
    if (!response.ok) return { kind: 'unknown' };
    const storeId = readDriverOrderStoreId(await response.json(), orderId);
    return isSafeApiPathSegment(storeId) ? { kind: 'ok', storeId } : { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}

function browserLocks(): PendingPhotoLockManager | null {
  try {
    const locks = (navigator as Navigator & { locks?: PendingPhotoLockManager }).locks;
    return locks && typeof locks.request === 'function' ? locks : null;
  } catch {
    return null;
  }
}

function onCompleted(entry: PendingPhotoEntry) {
  // 기사는 이미 다른 집에 있을 수 있어 어느 배송인지 주소 표시(동·호수)로 알린다(S-08).
  toast.add({ description: pendingPhotoCompletedMessage(entry) });
  // 완료 직후 상세(404)가 "배송을 마친 주문이에요"로 안내하도록 같은 기억을 남긴다(R-01).
  rememberCompletedOrder({ orderId: entry.orderId, userId: entry.userId });
  for (const listener of [...completedListeners]) {
    try {
      listener(entry.orderId);
    } catch {
      // 화면 이동 실패는 무시한다.
    }
  }
}

/** 브라우저 실행기 하나. 저장소를 쓸 수 없으면 null. */
export function getPendingPhotoRunner(): PendingPhotoRunner | null {
  if (runnerSingleton !== undefined) return runnerSingleton;
  const store = getPendingPhotoStore();
  if (!store) {
    runnerSingleton = null;
    return null;
  }
  runnerSingleton = createPendingPhotoRunner({
    store,
    getSession: async () => {
      // 실행마다 새로 받는다. 토큰은 저장소에 두지 않는다.
      const session = await getSession({ broadcast: false });
      const user = session?.user;
      if (!user?.id || !user.accessToken || user.tokenError) return null;
      return { userId: user.id, accessToken: user.accessToken };
    },
    post: (path, token, init) => apiFetch(path, token, init),
    readStoreId: readStoreIdForQueue,
    now: () => Date.now(),
    random: () => Math.random(),
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    locks: browserLocks(),
    onCompleted,
    onChanged: notifyChanged,
  });
  return runnerSingleton;
}

/** 항목을 대기열에 넣는다. 넣었으면 true이고 실행기를 깨운다. 저장소를 쓸 수 없으면 false. */
export async function enqueuePendingPhoto(entry: PendingPhotoEntry): Promise<boolean> {
  const store = getPendingPhotoStore();
  if (!store) return false;
  const saved = await store.put(entry);
  if (!saved) return false;
  notifyChanged();
  emit(kickListeners);
  return true;
}

/** 이 사용자·주문의 대기열 항목(사진 바이트 없이). 없거나 읽지 못하면 null. */
export async function findPendingPhoto(
  userId: string,
  orderId: string,
): Promise<PendingPhotoSummary | null> {
  const store = getPendingPhotoStore();
  if (!store) return null;
  const entry = await store.get(pendingPhotoKey(userId, orderId));
  return entry ? toPendingPhotoSummary(entry) : null;
}

/** 이 주문의 사진을 지금 올린다(사진 화면·상세의 "지금 올리기"). 자동 실행과 같은 함수·잠금을 쓴다. */
export async function runPendingPhotoNow(orderId: string): Promise<PendingPhotoRunResult> {
  const runner = getPendingPhotoRunner();
  if (!runner) return 'none';
  const result = await runner.runOrder(orderId, { manual: true });
  // 간격을 당겼거나 다시 기다리게 됐으면 자동 실행이 새 시각으로 다시 잡는다.
  emit(kickListeners);
  return result;
}

/**
 * 주문 조회(상세·목록)가 이 주문을 보류·수거 대기로 보였을 때 대기 중인 예전 사진을 멈춘다.
 * 보내는 중이면(이 탭·다른 탭) 건드리지 않는다. 저장소를 쓸 수 없으면 아무것도 하지 않는다.
 */
export async function failStalePendingPhoto(
  userId: string,
  orderId: string,
): Promise<PendingPhotoRunResult> {
  const runner = getPendingPhotoRunner();
  if (!runner) return 'none';
  return runner.failStalePhoto(userId, orderId);
}

/** 로그인한 사용자의 모든 사진을 지금 올린다(목록 안내의 "지금 올리기"). */
export async function runAllPendingPhotosNow(): Promise<void> {
  const runner = getPendingPhotoRunner();
  if (!runner) return;
  await runner.runAll({ manual: true });
  emit(kickListeners);
}

/** 멈춘(failed) 항목을 기사가 확인해 지운다. 기다리는 항목은 지우지 않는다. */
export async function dismissPendingPhoto(userId: string, orderId: string): Promise<void> {
  const store = getPendingPhotoStore();
  if (!store) return;
  const key = pendingPhotoKey(userId, orderId);
  const entry = await store.get(key);
  if (entry?.state !== 'failed') return;
  await store.delete(key);
  notifyChanged();
}

/** 로그아웃: 이 기기의 대기열을 모두 지운다. */
export async function clearPendingPhotoQueue(): Promise<void> {
  const store = getPendingPhotoStore();
  if (!store) return;
  await store.clear();
  notifyChanged();
}

export function subscribePendingPhotoChanges(listener: Listener): () => void {
  broadcastChannel();
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** 새 항목·"지금 올리기" 뒤 실행기를 깨우는 신호(PendingPhotoUploader가 듣는다). */
export function subscribePendingPhotoKick(listener: Listener): () => void {
  kickListeners.add(listener);
  return () => kickListeners.delete(listener);
}

/** 대기열이 사진을 올려 완료로 수렴했을 때(주문 ID). */
export function subscribePendingPhotoCompleted(listener: CompletedListener): () => void {
  completedListeners.add(listener);
  return () => completedListeners.delete(listener);
}

export type PendingPhotosView = {
  /** 저장소를 쓸 수 있고 한 번 이상 읽었는가. false면 대기열 없이 예전 동작이다. */
  ready: boolean;
  entries: PendingPhotoSummary[];
};

/**
 * 사용자 한 명의 대기열 항목(사진 바이트 없이). 사용자 ID가 없으면 빈 목록.
 * 항목이 바뀌면(이 탭·다른 탭) 다시 읽는다. 보내는 중 표시가 끝나는 시각에도 다시 그린다.
 */
export function usePendingPhotos(userId: string | null | undefined): PendingPhotosView {
  const [view, setView] = useState<PendingPhotosView>({ ready: false, entries: [] });
  useEffect(() => {
    const store = getPendingPhotoStore();
    if (!store || !userId) {
      setView({ ready: false, entries: [] });
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      void store.list().then((entries) => {
        if (!active) return;
        const mine = entries.filter((entry) => entry.userId === userId).map(toPendingPhotoSummary);
        setView({ ready: true, entries: mine });
        // 보내는 중 표시가 끝나면(닫힌 탭의 흔적) "대기"로 다시 그린다.
        clearTimeout(timer);
        const leaseEnds = mine
          .filter((entry) => entry.state === 'sending')
          .map((entry) => entry.leaseUntil - Date.now());
        if (leaseEnds.length > 0) timer = setTimeout(load, Math.max(1_000, Math.min(...leaseEnds)));
      });
    };
    load();
    const unsubscribe = subscribePendingPhotoChanges(load);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [userId]);
  return view;
}

/**
 * 이 기기 대기열에서 아직 올리지 못한 사진(모든 사용자, 멈춘 항목 제외)의 주소 표시 목록.
 * 길이가 사진 수이고 주소 표시를 모르는 항목은 null이다. 로그아웃 확인 문구에 쓴다. 읽지 못하면 빈 목록.
 */
export function usePendingPhotoLogoutLabels(): (string | null)[] {
  const [labels, setLabels] = useState<(string | null)[]>([]);
  useEffect(() => {
    const store = getPendingPhotoStore();
    if (!store) return;
    let active = true;
    const load = () => {
      void store.list().then((entries) => {
        if (active) setLabels(pendingPhotoLogoutLabels(entries));
      });
    };
    load();
    const unsubscribe = subscribePendingPhotoChanges(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return labels;
}
