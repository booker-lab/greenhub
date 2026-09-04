'use client';

import { Button, Loader, Text, Title } from '@mantine/core';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { type ChangeEvent, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { uploadLegacyHubPhoto } from './legacy-hub-photo';

type PhotoMode = 'legacy' | 'round-direct';

type PhotoCaptureProps = {
  orderId: string;
  mode: PhotoMode;
};

export default function PhotoCapture({ orderId, mode }: PhotoCaptureProps) {
  const storeId = useSearchParams().get('storeId') ?? '';
  const isRoundDirect = mode === 'round-direct';
  const { data: session } = useSession();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef<string | null>(null);

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

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      setStream(nextStream);
      if (videoRef.current) {
        videoRef.current.srcObject = nextStream;
        void videoRef.current.play();
      }
    } catch {
      setError(
        isRoundDirect
          ? '카메라 접근 권한이 필요합니다. 사진 파일 선택으로 계속해주세요.'
          : '카메라 접근 권한이 필요합니다.',
      );
    }
  }

  function stopStream() {
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    setStream(null);
  }

  function capture() {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(
      (nextBlob) => {
        if (!nextBlob) return;
        setBlob(nextBlob);
        setCaptured(canvas.toDataURL('image/jpeg', 0.85));
        stopStream();
      },
      'image/jpeg',
      0.85,
    );
  }

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
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

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setError('사진 미리보기를 만들 수 없습니다.');
        return;
      }
      setError('');
      setBlob(file);
      setCaptured(reader.result);
    };
    reader.onerror = () => {
      setError('사진을 읽을 수 없습니다. 다시 선택해주세요.');
    };
    reader.readAsDataURL(file);
  }

  function retake() {
    setCaptured(null);
    setBlob(null);
    startCamera();
  }

  async function upload() {
    if (!blob || !session) return;
    setUploading(true);
    setError('');
    try {
      if (isRoundDirect) {
        requestIdRef.current ??= globalThis.crypto.randomUUID();
        const form = new FormData();
        form.append('photo', blob, 'delivery.jpg');
        form.append('idempotencyKey', requestIdRef.current);
        const response = await apiFetch(
          `/stores/${storeId}/orders/${orderId}/delivery-photos`,
          session.user.accessToken,
          { method: 'POST', body: form },
        );
        if (!response.ok) throw new Error('배송 사진 업로드 실패');
        const result = (await response.json()) as {
          orderId?: unknown;
          photoId?: unknown;
          status?: unknown;
        };
        if (
          result.orderId !== orderId ||
          typeof result.photoId !== 'string' ||
          !result.photoId ||
          result.status !== 'DELIVERED'
        ) {
          throw new Error('배송 완료 응답 불일치');
        }
      } else {
        const photoUrl = await uploadLegacyHubPhoto(orderId, blob);
        const response = await apiFetch(
          `/stores/${storeId}/orders/${orderId}/status`,
          session.user.accessToken,
          { method: 'PATCH', body: JSON.stringify({ status: 'HUB_ARRIVED', photoUrl }) },
        );
        if (!response.ok) throw new Error('거점 도착 전환 실패');
      }

      router.replace('/board?tab=preparing');
    } catch {
      setError('업로드 실패. 다시 시도해주세요.');
    } finally {
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
            fontSize: 'var(--font-size-base)',
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
              color="white"
              style={{ color: 'var(--color-text)' }}
              radius="md"
            >
              {isRoundDirect ? '카메라 촬영' : '사진 촬영'}
            </Button>
            {isRoundDirect && (
              <Button
                onClick={() => fileInputRef.current?.click()}
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
            <canvas ref={canvasRef} style={{ display: 'none' }} />
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
                onClick={capture}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-bg)',
                  border: '4px solid var(--color-primary)',
                  cursor: 'pointer',
                }}
              />
            </div>
          </>
        )}

        {captured && (
          <>
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
            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </>
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
            disabled={!captured || uploading}
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
