'use client';

import { apiPathSegment, isSafeApiPathSegment, readRouteParam } from '@greenhub/shared';
import { toast } from '@greenhub/ui/components/toast';
import { cn } from '@greenhub/ui/lib/utils';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { AppButton } from '@/components/app-button';
import { text } from '@/components/look';
import { Spinner } from '@/components/spinner';
import { apiFetch, apiRead } from '@/lib/api';
import { readDriverOrderCommandErrorCodeFromResponse } from '../../_lib/driver-order-detail';
import { uploadLegacyHubPhoto } from './legacy-hub-photo';
import {
  type DecodedPhoto,
  encodeDeliveryJpeg,
  loadImageSource,
  PhotoEncodeError,
} from './photo-encode';
import {
  deliveryCompletedMessage,
  type PhotoOrderSummary,
  photoOrderSummaryLine,
  readPhotoOrderSummary,
} from './photo-order-summary';
import {
  classifyPhotoUploadFailure,
  decideIdempotencyKey,
  isDeliveryPhotoAck,
  type PhotoUploadFailureKind,
  photoEncodeFailureMessage,
  readDriverOrderStatus,
  readDriverOrderStoreId,
  resolvePhotoUploadFailure,
} from './photo-upload-policy';

type PhotoMode = 'legacy' | 'round-direct';

type PhotoCaptureProps = {
  orderId: string;
  mode: PhotoMode;
};

// 다크 모드(D5): 촬영 화면은 두 구성 모두 검정 바탕(#000)이므로 그 위 글자·셔터 면은 흰색으로 고정한다(--color-bg는 어둠에서 어두워진다).
const CAMERA_ON = '#ffffff';
// 촬영 화면의 흰 버튼(tone white, 두 구성 모두 흰 면) 위 글자. 밝음 --color-text 값으로 고정한다.
const CAMERA_BUTTON_INK = '#111111';

const INVALID_ORDER_ADDRESS_MESSAGE =
  '주문 주소가 올바르지 않아요. 배송 목록에서 주문을 다시 선택해 주세요.';
// 명령을 보내기 전에 실패하므로 같은 사진으로 다시 시도해도 안전하다.
const ORDER_STORE_UNKNOWN_MESSAGE =
  '주문 정보를 확인하지 못해 사진을 올리지 않았어요. 잠시 뒤 다시 시도하거나 주문 화면에서 확인해 주세요.';
// 받는 형식은 JPEG 그대로다(2026-11-08 결정). 형식 이름 대신 바로 할 일을 안내한다.
const NON_JPEG_PHOTO_MESSAGE =
  "이 사진 형식은 올릴 수 없어요. '카메라 촬영'이나 '카메라 앱으로 찍기'로 새로 찍어 주세요.";

function encodeErrorMessage(cause: unknown): string {
  return photoEncodeFailureMessage(
    cause instanceof PhotoEncodeError ? cause.reason : 'ENCODE_FAILED',
  );
}

function stopMediaStream(mediaStream: MediaStream | null) {
  mediaStream?.getTracks().forEach((track) => {
    track.stop();
  });
}

// 촬영 화면 안내 줄용 주소·받는 분. 읽지 못하면 null이고 화면은 안내 줄만 숨긴다.
async function fetchPhotoOrderSummary(
  orderId: string,
  token: string,
  signal: AbortSignal,
): Promise<PhotoOrderSummary | null> {
  try {
    const response = await apiRead(`/driver/orders/${encodeURIComponent(orderId)}`, token, {
      signal,
    });
    if (!response.ok) return null;
    return readPhotoOrderSummary(await response.json(), orderId);
  } catch {
    return null;
  }
}

export default function PhotoCapture({ orderId: rawOrderId, mode }: PhotoCaptureProps) {
  const router = useRouter();
  // 경로 파라미터는 형식을 검사한 원래 ID로 읽는다. 맞지 않으면 촬영·업로드 화면을 열지 않는다.
  const orderId = readRouteParam(rawOrderId);
  if (!orderId) {
    return (
      <div
        style={{
          minHeight: '100dvh',
          backgroundColor: '#000',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
        }}
      >
        <p
          className={cn(text, 'text-center')}
          style={{ color: CAMERA_ON, fontSize: 'var(--font-size-sm)' }}
        >
          {INVALID_ORDER_ADDRESS_MESSAGE}
        </p>
        <AppButton
          onClick={() => router.replace('/board')}
          tone="white"
          className="rounded-sm"
          style={{ color: CAMERA_BUTTON_INK }}
        >
          배송 목록으로
        </AppButton>
      </div>
    );
  }
  return <PhotoCaptureScreen orderId={orderId} mode={mode} />;
}

function PhotoCaptureScreen({ orderId, mode }: PhotoCaptureProps) {
  const isRoundDirect = mode === 'round-direct';
  const { data: session } = useSession();
  // 새로고침·직접 진입 등으로 세션을 다시 받는 동안에는 완료 버튼을 막는다
  // (세션 없이 누르면 업로드가 조용히 무시되어 화면에 머문다).
  const sessionReady = Boolean(session?.user?.accessToken);
  const accessToken = session?.user?.accessToken;
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const preparingRef = useRef(false);
  // 멱등 키는 "이 사진으로 보낸 요청" 단위다. 재촬영·확정 거절이면 새로 만들고,
  // 응답이 불확실한 재시도는 같은 키·같은 사진을 유지한다 (photo-upload-policy).
  const requestIdRef = useRef<string | null>(null);
  const requestPhotoRef = useRef<Blob | null>(null);
  const lastFailureRef = useRef<PhotoUploadFailureKind | null>(null);
  const uploadInFlightRef = useRef(false);
  // 촬영 화면 제목 아래 "어느 집" 안내(회차 직배송만). 읽지 못하면 null이고 안내 줄만 숨긴다.
  const [orderSummary, setOrderSummary] = useState<PhotoOrderSummary | null>(null);
  // 안내 줄을 읽어 온 주문 ID. 다른 주문으로 바뀌면 이전 주문의 주소를 남기지 않고 다시 읽는다.
  const orderSummaryLoadedForRef = useRef<string | null>(null);

  // 화면을 열 때 기사 주문 조회로 주소·받는 분을 한 번 읽는다. 업로드 때 판매자 ID는 여기 값을 쓰지 않고
  // 매번 조회 응답에서 다시 확인한다(readOrderStoreId).
  useEffect(() => {
    if (!isRoundDirect || !accessToken || orderSummaryLoadedForRef.current === orderId) return;
    setOrderSummary(null);
    const controller = new AbortController();
    void fetchPhotoOrderSummary(orderId, accessToken, controller.signal).then((summary) => {
      // 읽지 못하면 안내 줄만 숨긴다. 업로드 동작에는 영향이 없다.
      if (controller.signal.aborted || !summary) return;
      orderSummaryLoadedForRef.current = orderId;
      setOrderSummary(summary);
    });
    return () => controller.abort();
  }, [isRoundDirect, accessToken, orderId]);

  useEffect(() => {
    if (!stream) {
      setFrameReady(false);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    let active = true;
    const updateFrameReadiness = () => {
      if (!active) return;
      const ready =
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0;
      setFrameReady(ready);
      if (ready) setError('');
    };

    video.addEventListener('loadedmetadata', updateFrameReadiness);
    video.addEventListener('loadeddata', updateFrameReadiness);
    video.addEventListener('canplay', updateFrameReadiness);
    video.srcObject = stream;
    updateFrameReadiness();
    void video.play().catch(() => {
      if (!active) return;
      setFrameReady(false);
      setError('카메라 미리보기를 재생할 수 없어요. 다시 시도해 주세요.');
    });

    return () => {
      active = false;
      video.removeEventListener('loadedmetadata', updateFrameReadiness);
      video.removeEventListener('loadeddata', updateFrameReadiness);
      video.removeEventListener('canplay', updateFrameReadiness);
      if (video.srcObject === stream) {
        video.pause();
        video.srcObject = null;
      }
    };
  }, [stream]);

  // 미리보기 object URL은 사진이 바뀌거나 화면을 떠날 때 돌려준다.
  useEffect(() => {
    if (!captured) return;
    return () => URL.revokeObjectURL(captured);
  }, [captured]);

  // 화면이 숨으면(잠금·앱 전환) 카메라 미리보기를 끈다. 돌아오면 촬영 시작 버튼이 다시 보이고
  // 사용자가 눌러 다시 켠다. 사진을 만드는 중(preparing)에는 프레임을 읽고 있으므로 끄지 않는다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stopStream은 ref와 상태 setter만 쓰므로 매 렌더 새 함수여도 동작이 같다
  useEffect(() => {
    if (!stream) return;
    const handleVisibility = () => {
      if (document.visibilityState !== 'hidden' || preparingRef.current) return;
      stopStream();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [stream]);

  useEffect(() => {
    return () => {
      cameraRequestRef.current += 1;
      const currentStream = streamRef.current;
      streamRef.current = null;
      stopMediaStream(currentStream);
    };
  }, []);

  async function startCamera() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        isRoundDirect
          ? '카메라를 사용할 수 없어요. 카메라 앱으로 찍거나 사진을 선택해 계속해 주세요.'
          : '카메라를 사용할 수 없어요.',
      );
      return;
    }

    stopStream();
    const requestId = cameraRequestRef.current;

    try {
      // 해상도를 따로 청하지 않으면 브라우저가 640×480으로 여는 경우가 많아 밤 사진이 뭉개진다.
      // ideal이라 지원하지 않는 기기는 가능한 해상도로 열린다. 업로드 전 4MB 이하 JPEG 재인코딩은 그대로다.
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (cameraRequestRef.current !== requestId) {
        stopMediaStream(nextStream);
        return;
      }
      streamRef.current = nextStream;
      setStream(nextStream);
    } catch {
      if (cameraRequestRef.current !== requestId) return;
      setError(
        isRoundDirect
          ? '카메라 접근 권한이 필요해요. 카메라 앱으로 찍거나 사진을 선택해 계속해 주세요.'
          : '카메라 접근 권한이 필요해요.',
      );
    }
  }

  function stopStream() {
    cameraRequestRef.current += 1;
    const currentStream = streamRef.current;
    streamRef.current = null;
    stopMediaStream(currentStream);
    setStream(null);
    setFrameReady(false);
  }

  async function capture() {
    const video = videoRef.current;
    if (!video) return;
    if (
      !frameReady ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.videoWidth <= 0 ||
      video.videoHeight <= 0
    ) {
      setError('카메라 화면이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    if (preparingRef.current) return;
    preparingRef.current = true;
    setPreparing(true);
    try {
      // 카메라 프레임도 파일 선택과 같은 축소·재인코딩 경로를 탄다.
      const nextBlob = await encodeDeliveryJpeg(video, video.videoWidth, video.videoHeight);
      showPhoto(nextBlob);
      stopStream();
    } catch (cause) {
      setError(encodeErrorMessage(cause));
    } finally {
      preparingRef.current = false;
      setPreparing(false);
    }
  }

  function showPhoto(nextBlob: Blob) {
    setError('');
    setBlob(nextBlob);
    setCaptured(URL.createObjectURL(nextBlob));
  }

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    stopStream();
    setCaptured(null);
    setBlob(null);

    if (file.type !== 'image/jpeg') {
      setError(NON_JPEG_PHOTO_MESSAGE);
      return;
    }
    if (preparingRef.current) return;
    preparingRef.current = true;
    setPreparing(true);
    setError('');
    let decoded: DecodedPhoto | null = null;
    try {
      // 원본 카메라 사진은 서버 한도(5MB)를 넘기 쉬워 항상 축소해서 올린다.
      decoded = await loadImageSource(file);
      const nextBlob = await encodeDeliveryJpeg(decoded.source, decoded.width, decoded.height);
      showPhoto(nextBlob);
    } catch (cause) {
      setError(encodeErrorMessage(cause));
    } finally {
      decoded?.release();
      preparingRef.current = false;
      setPreparing(false);
    }
  }

  function retake() {
    setCaptured(null);
    setBlob(null);
    startCamera();
  }

  // 명령 경로의 판매자 ID는 주소창 쿼리가 아니라 기사 주문 조회 응답에서 읽는다.
  // 같은 주문의 응답이 아니거나 형식이 맞지 않으면 null이고, 그때는 명령을 보내지 않는다.
  async function readOrderStoreId(token: string): Promise<string | null> {
    try {
      const response = await apiRead(`/driver/orders/${encodeURIComponent(orderId)}`, token);
      if (!response.ok) return null;
      const storeId = readDriverOrderStoreId(await response.json(), orderId);
      return isSafeApiPathSegment(storeId) ? storeId : null;
    } catch {
      return null;
    }
  }

  async function readOrderStatus(token: string): Promise<string | null> {
    try {
      const response = await apiRead(`/driver/orders/${encodeURIComponent(orderId)}`, token);
      if (!response.ok) return null;
      return readDriverOrderStatus(await response.json(), orderId);
    } catch {
      return null;
    }
  }

  // 사진은 연결됐는데 DELIVERED 전이만 빠진 경우의 서버 마무리 경로.
  // 서버는 사진이 연결된 DELIVERING 주문에서만 이 전이를 허용한다.
  async function finishDelivery(token: string, storeId: string): Promise<boolean> {
    try {
      const response = await apiFetch(
        `/stores/${apiPathSegment(storeId)}/orders/${apiPathSegment(orderId)}/status`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: 'DELIVERED' }),
        },
      );
      if (!response.ok) return false;
      const ack = (await response.json()) as { orderId?: unknown; status?: unknown };
      return ack.orderId === orderId && ack.status === 'DELIVERED';
    } catch {
      return false;
    }
  }

  // 실패 뒤 주문 상태를 다시 읽어, 서버가 이미 완료했으면 성공으로 수렴한다.
  async function recoverAfterUploadFailure(
    token: string,
    failure: PhotoUploadFailureKind,
    storeId: string,
  ): Promise<boolean> {
    let resolution = resolvePhotoUploadFailure({
      failure,
      orderStatus: await readOrderStatus(token),
      finishAttempted: false,
    });
    if (resolution.action === 'finish-delivery') {
      if (await finishDelivery(token, storeId)) return true;
      resolution = resolvePhotoUploadFailure({
        failure,
        orderStatus: await readOrderStatus(token),
        finishAttempted: true,
      });
    }
    if (resolution.action === 'complete') return true;
    if (resolution.action === 'show') setError(resolution.message);
    return false;
  }

  // 회차 직배송 업로드. 완료(서버가 이미 완료한 경우 포함)면 true, 안내를 띄웠으면 false.
  async function uploadRoundDirect(token: string, blob: Blob, storeId: string): Promise<boolean> {
    const keyDecision = decideIdempotencyKey({
      hasKey: requestIdRef.current !== null,
      photoChanged: requestPhotoRef.current !== blob,
      lastFailure: lastFailureRef.current,
    });
    const requestId =
      keyDecision === 'renew' || requestIdRef.current === null
        ? globalThis.crypto.randomUUID()
        : requestIdRef.current;
    requestIdRef.current = requestId;
    requestPhotoRef.current = blob;

    let failure: PhotoUploadFailureKind;
    try {
      const form = new FormData();
      form.append('photo', blob, 'delivery.jpg');
      form.append('idempotencyKey', requestId);
      const response = await apiFetch(
        `/stores/${apiPathSegment(storeId)}/orders/${apiPathSegment(orderId)}/delivery-photos`,
        token,
        { method: 'POST', body: form },
      );
      if (response.ok) {
        let result: unknown = null;
        try {
          result = await response.json();
        } catch {
          result = null;
        }
        if (isDeliveryPhotoAck(result, orderId)) {
          lastFailureRef.current = null;
          return true;
        }
        failure = classifyPhotoUploadFailure({ kind: 'ack' });
      } else {
        failure = classifyPhotoUploadFailure({
          kind: 'http',
          status: response.status,
          code: await readDriverOrderCommandErrorCodeFromResponse(response),
        });
      }
    } catch {
      failure = classifyPhotoUploadFailure({ kind: 'network' });
    }
    lastFailureRef.current = failure;
    return recoverAfterUploadFailure(token, failure, storeId);
  }

  async function upload() {
    if (!blob || !session) return;
    if (uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    setUploading(true);
    setError('');
    const token = session.user.accessToken;
    // 완료로 목록에 옮겨 가는 중이면 잠금을 풀지 않는다(옮겨 가기 전 버튼이 다시 켜져 같은 요청·완료 알림이 두 번 나가지 않게).
    let leaving = false;
    try {
      // 사진·명령을 보내기 전에 주문 응답에서 판매자 ID를 확인한다. 실패하면 아무 명령도 보내지 않는다.
      const storeId = await readOrderStoreId(token);
      if (!storeId) {
        setError(ORDER_STORE_UNKNOWN_MESSAGE);
        return;
      }
      if (isRoundDirect) {
        if (!(await uploadRoundDirect(token, blob, storeId))) return;
        // 완료로 수렴했을 때만(정상 ACK·서버가 이미 완료) 알린다. 불확실·실패는 위에서 안내하고 머문다.
        // 알림은 루트 AppToaster가 그리므로 목록으로 옮긴 뒤에도 남는다.
        toast.add({ description: deliveryCompletedMessage(orderSummary) });
      } else {
        const photoUrl = await uploadLegacyHubPhoto(orderId, blob);
        const response = await apiFetch(
          `/stores/${apiPathSegment(storeId)}/orders/${apiPathSegment(orderId)}/status`,
          token,
          {
            method: 'PATCH',
            body: JSON.stringify({ status: 'HUB_ARRIVED', photoUrl }),
          },
        );
        if (!response.ok) throw new Error('거점 도착 전환 실패');
        let ack: { orderId?: unknown; status?: unknown };
        try {
          ack = (await response.json()) as { orderId?: unknown; status?: unknown };
        } catch {
          throw new Error('결과를 확인할 수 없어요. 주문 상태를 다시 확인해 주세요.');
        }
        if (ack.orderId !== orderId || ack.status !== 'HUB_ARRIVED') {
          throw new Error('결과를 확인할 수 없어요. 주문 상태를 다시 확인해 주세요.');
        }
      }

      leaving = true;
      router.replace('/board?tab=delivering');
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('결과를 확인할 수 없어요. 주문 상태를 다시 확인해 주세요.')
      ) {
        setError(error.message);
      } else {
        setError('업로드하지 못했어요. 다시 시도해 주세요.');
      }
    } finally {
      if (!leaving) {
        uploadInFlightRef.current = false;
        setUploading(false);
      }
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        backgroundColor: '#000',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          // 홈 화면 앱(viewportFit cover·투명 상태 표시줄)에서 제목·주소 줄이 상태 표시줄에 가리지 않게 안전 영역만큼 내린다.
          padding: 'calc(16px + env(safe-area-inset-top)) 16px 16px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)',
        }}
      >
        <button
          type="button"
          aria-label="뒤로가기"
          onClick={() => {
            stopStream();
            router.back();
          }}
          style={{
            color: CAMERA_ON,
            padding: 4,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
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
        <div style={{ minWidth: 0 }}>
          <h1
            className="m-0 leading-[1.3]"
            style={{
              color: CAMERA_ON,
              fontSize: 'var(--font-size-md)',
              fontWeight: 'var(--fw-bold)',
            }}
          >
            {isRoundDirect ? '배송 완료 사진' : '거점 하차 인증 사진'}
          </h1>
          {isRoundDirect && orderSummary && (
            <p
              className={cn(text, 'm-0 leading-[1.3]')}
              style={{
                color: CAMERA_ON,
                fontSize: 'var(--font-size-sm)',
                overflowWrap: 'anywhere',
              }}
            >
              {photoOrderSummaryLine(orderSummary)}
            </p>
          )}
        </div>
      </header>

      <div style={{ flex: 1, position: 'relative' }}>
        {isRoundDirect && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg"
            capture="environment"
            onChange={selectPhoto}
            aria-label="카메라 앱으로 찍기·사진 선택"
            style={{ display: 'none' }}
          />
        )}
        {!stream && !captured && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 24,
            }}
          >
            <p className={text} style={{ color: CAMERA_ON, fontSize: 'var(--font-size-sm)' }}>
              {isRoundDirect ? '문 앞 배송 완료 상태를 촬영해 주세요' : '하차 물품을 촬영해 주세요'}
            </p>
            <AppButton
              onClick={startCamera}
              disabled={preparing}
              tone="white"
              className="rounded-sm"
              style={{ color: CAMERA_BUTTON_INK }}
            >
              {isRoundDirect ? '카메라 촬영' : '사진 촬영'}
            </AppButton>
            {isRoundDirect && (
              <AppButton
                onClick={() => fileInputRef.current?.click()}
                loading={preparing}
                disabled={preparing}
                tone="white-outline"
                className="rounded-sm"
                style={{ color: CAMERA_ON }}
              >
                카메라 앱으로 찍기·사진 선택
              </AppButton>
            )}
            {error && (
              <p
                className={cn(text, 'px-8 text-center')}
                style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}
              >
                {error}
              </p>
            )}
          </div>
        )}

        {stream && (
          <>
            <video
              ref={videoRef}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
              playsInline
              muted
            />
            <div
              style={{
                position: 'absolute',
                bottom: 120,
                left: 0,
                right: 0,
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <button
                type="button"
                aria-label="사진 촬영"
                aria-busy={preparing}
                onClick={capture}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  backgroundColor: CAMERA_ON,
                  border: '4px solid var(--color-primary)',
                  cursor: 'pointer',
                }}
                disabled={!frameReady}
              />
            </div>
          </>
        )}

        {captured && (
          <Image
            src={captured}
            alt="촬영 미리보기"
            fill
            sizes="100vw"
            unoptimized
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        )}
      </div>

      {(captured || isRoundDirect) && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            display: 'flex',
            // 좁은 폭(360px)에서도 확정 버튼 글자가 잘리지 않게 한 줄 전체 폭으로 두고, 재촬영은 그 위에 쌓는다.
            flexDirection: 'column',
            gap: 12,
            padding: '16px 16px max(32px, calc(16px + env(safe-area-inset-bottom)))',
            background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
          }}
        >
          {captured && (
            <AppButton
              onClick={retake}
              disabled={uploading}
              tone="white-outline"
              size="lg"
              fullWidth
            >
              재촬영
            </AppButton>
          )}
          <AppButton
            onClick={upload}
            disabled={!captured || uploading || !sessionReady}
            size="lg"
            fullWidth
            leftSection={uploading ? <Spinner size={18} className="text-white" /> : null}
          >
            {uploading ? '올리는 중…' : isRoundDirect ? '사진을 등록하고 배송 완료' : '업로드'}
          </AppButton>
        </div>
      )}

      {error && captured && (
        <div
          style={{
            position: 'absolute',
            // 제목 아래 주소 줄이 있으면 머리가 길어지므로 그만큼 내려 가리지 않는다.
            top: `calc(${orderSummary ? 104 : 80}px + env(safe-area-inset-top))`,
            left: 16,
            right: 16,
            backgroundColor: 'var(--color-danger)',
            color: 'var(--color-bg)',
            fontSize: 'var(--font-size-sm)',
            textAlign: 'center',
            padding: '8px 16px',
            borderRadius: 12,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
