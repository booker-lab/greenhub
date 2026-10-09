'use client';

import { Button, Loader, Text, Title } from '@mantine/core';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { readDriverOrderCommandErrorCodeFromResponse } from '../../_lib/driver-order-detail';
import { uploadLegacyHubPhoto } from './legacy-hub-photo';
import {
  type DecodedPhoto,
  encodeDeliveryJpeg,
  loadImageSource,
  PhotoEncodeError,
} from './photo-encode';
import {
  classifyPhotoUploadFailure,
  decideIdempotencyKey,
  isDeliveryPhotoAck,
  type PhotoUploadFailureKind,
  photoEncodeFailureMessage,
  readDriverOrderStatus,
  resolvePhotoUploadFailure,
} from './photo-upload-policy';

type PhotoMode = 'legacy' | 'round-direct';

type PhotoCaptureProps = {
  orderId: string;
  mode: PhotoMode;
};

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

export default function PhotoCapture({ orderId, mode }: PhotoCaptureProps) {
  const storeId = useSearchParams().get('storeId') ?? '';
  const isRoundDirect = mode === 'round-direct';
  const { data: session } = useSession();
  // 새로고침·직접 진입 등으로 세션을 다시 받는 동안에는 완료 버튼을 막는다
  // (세션 없이 누르면 업로드가 조용히 무시되어 화면에 머문다).
  const sessionReady = Boolean(session?.user?.accessToken);
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
      setError('카메라 미리보기를 재생할 수 없습니다. 다시 시도해주세요.');
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
          ? '카메라를 사용할 수 없습니다. 사진 파일 선택으로 계속해주세요.'
          : '카메라를 사용할 수 없습니다.',
      );
      return;
    }

    stopStream();
    const requestId = cameraRequestRef.current;

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
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
          ? '카메라 접근 권한이 필요합니다. 사진 파일 선택으로 계속해주세요.'
          : '카메라 접근 권한이 필요합니다.',
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
      setError('카메라 화면이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.');
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
      setError('JPEG 사진만 선택할 수 있습니다.');
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

  async function readOrderStatus(token: string): Promise<string | null> {
    try {
      const response = await apiFetch(`/driver/orders/${encodeURIComponent(orderId)}`, token);
      if (!response.ok) return null;
      return readDriverOrderStatus(await response.json(), orderId);
    } catch {
      return null;
    }
  }

  // 사진은 연결됐는데 DELIVERED 전이만 빠진 경우의 서버 마무리 경로.
  // 서버는 사진이 연결된 DELIVERING 주문에서만 이 전이를 허용한다.
  async function finishDelivery(token: string): Promise<boolean> {
    try {
      const response = await apiFetch(`/stores/${storeId}/orders/${orderId}/status`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'DELIVERED' }),
      });
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
  ): Promise<boolean> {
    let resolution = resolvePhotoUploadFailure({
      failure,
      orderStatus: await readOrderStatus(token),
      finishAttempted: false,
    });
    if (resolution.action === 'finish-delivery') {
      if (await finishDelivery(token)) return true;
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
  async function uploadRoundDirect(token: string, blob: Blob): Promise<boolean> {
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
        `/stores/${storeId}/orders/${orderId}/delivery-photos`,
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
    return recoverAfterUploadFailure(token, failure);
  }

  async function upload() {
    if (!blob || !session) return;
    if (uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    setUploading(true);
    setError('');
    const token = session.user.accessToken;
    try {
      if (isRoundDirect) {
        if (!(await uploadRoundDirect(token, blob))) return;
      } else {
        const photoUrl = await uploadLegacyHubPhoto(orderId, blob);
        const response = await apiFetch(`/stores/${storeId}/orders/${orderId}/status`, token, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'HUB_ARRIVED', photoUrl }),
        });
        if (!response.ok) throw new Error('거점 도착 전환 실패');
        let ack: { orderId?: unknown; status?: unknown };
        try {
          ack = (await response.json()) as { orderId?: unknown; status?: unknown };
        } catch {
          throw new Error('결과를 확인할 수 없습니다. 주문 상태를 다시 확인하세요.');
        }
        if (ack.orderId !== orderId || ack.status !== 'HUB_ARRIVED') {
          throw new Error('결과를 확인할 수 없습니다. 주문 상태를 다시 확인하세요.');
        }
      }

      router.replace('/board?tab=preparing');
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('결과를 확인할 수 없습니다. 주문 상태를 다시 확인하세요.')
      ) {
        setError(error.message);
      } else {
        setError('업로드 실패. 다시 시도해주세요.');
      }
    } finally {
      uploadInFlightRef.current = false;
      setUploading(false);
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
          padding: '16px',
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
            color: 'var(--color-bg)',
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
        <Title
          order={1}
          style={{
            color: 'var(--color-bg)',
            fontSize: 'var(--font-size-md)',
            fontWeight: 'var(--fw-bold)',
          }}
        >
          {isRoundDirect ? '배송 완료 사진' : '거점 하차 인증 사진'}
        </Title>
      </header>

      <div style={{ flex: 1, position: 'relative' }}>
        {isRoundDirect && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg"
            capture="environment"
            onChange={selectPhoto}
            aria-label="사진 파일 선택"
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
            <Text style={{ color: 'var(--color-bg)', fontSize: 'var(--font-size-sm)' }}>
              {isRoundDirect ? '문 앞 배송 완료 상태를 촬영해주세요' : '하차 물품을 촬영해주세요'}
            </Text>
            <Button
              onClick={startCamera}
              disabled={preparing}
              color="white"
              style={{ color: 'var(--color-text)' }}
              radius="md"
            >
              {isRoundDirect ? '카메라 촬영' : '사진 촬영'}
            </Button>
            {isRoundDirect && (
              <Button
                onClick={() => fileInputRef.current?.click()}
                loading={preparing}
                disabled={preparing}
                variant="outline"
                color="white"
                style={{ color: 'var(--color-bg)' }}
                radius="md"
              >
                사진 파일 선택
              </Button>
            )}
            {error && (
              <Text
                style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}
                ta="center"
                px="xl"
              >
                {error}
              </Text>
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
                  backgroundColor: 'var(--color-bg)',
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
            gap: 12,
            padding: '16px 16px 32px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
          }}
        >
          {captured && (
            <Button
              flex={1}
              onClick={retake}
              disabled={uploading}
              variant="outline"
              color="white"
              radius="xl"
              size="lg"
            >
              재촬영
            </Button>
          )}
          <Button
            flex={1}
            onClick={upload}
            disabled={!captured || uploading || !sessionReady}
            color="brand"
            radius="xl"
            size="lg"
            leftSection={uploading ? <Loader size="xs" color="white" /> : null}
          >
            {uploading ? '업로드 중...' : isRoundDirect ? '사진을 등록하고 배송 완료' : '업로드'}
          </Button>
        </div>
      )}

      {error && captured && (
        <div
          style={{
            position: 'absolute',
            top: 80,
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
