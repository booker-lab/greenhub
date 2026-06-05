'use client';

import { Button, Loader, Text } from '@mantine/core';
import Image from 'next/image';
import type { RefObject } from 'react';

type PhotoCaptureViewProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  stream: MediaStream | null;
  captured: string | null;
  uploading: boolean;
  error: string;
  onBack: () => void;
  onStartCamera: () => void;
  onCapture: () => void;
  onRetake: () => void;
  onUpload: () => void;
};

export function PhotoCaptureView({
  videoRef,
  canvasRef,
  stream,
  captured,
  uploading,
  error,
  onBack,
  onStartCamera,
  onCapture,
  onRetake,
  onUpload,
}: PhotoCaptureViewProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#000',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <PhotoCaptureHeader onBack={onBack} />

      <div style={{ flex: 1, position: 'relative' }}>
        {!stream && !captured && <CameraEmptyState error={error} onStartCamera={onStartCamera} />}
        {stream && (
          <CameraCaptureStage videoRef={videoRef} canvasRef={canvasRef} onCapture={onCapture} />
        )}
        {captured && <CapturedPreview captured={captured} canvasRef={canvasRef} />}
      </div>

      {captured && <PhotoActionBar uploading={uploading} onRetake={onRetake} onUpload={onUpload} />}

      {error && captured && <PhotoErrorToast error={error} />}
    </div>
  );
}

function PhotoCaptureHeader({ onBack }: { onBack: () => void }) {
  return (
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
        onClick={onBack}
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
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <Text style={{ color: 'var(--color-bg)', fontWeight: 'var(--fw-bold)' }}>
        거점 하차 인증 사진
      </Text>
    </header>
  );
}

function CameraEmptyState({ error, onStartCamera }: { error: string; onStartCamera: () => void }) {
  return (
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
        하차 물품을 촬영해주세요
      </Text>
      <Button
        onClick={onStartCamera}
        color="white"
        style={{ color: 'var(--color-text)' }}
        radius="md"
      >
        카메라 시작
      </Button>
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
  );
}

function CameraCaptureStage({
  videoRef,
  canvasRef,
  onCapture,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onCapture: () => void;
}) {
  return (
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
          bottom: 32,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <button
          type="button"
          onClick={onCapture}
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
  );
}

function CapturedPreview({
  captured,
  canvasRef,
}: {
  captured: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  return (
    <>
      <Image
        src={captured}
        alt="촬영 미리보기"
        fill
        sizes="100vw"
        unoptimized
        style={{
          objectFit: 'cover',
        }}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </>
  );
}

function PhotoActionBar({
  uploading,
  onRetake,
  onUpload,
}: {
  uploading: boolean;
  onRetake: () => void;
  onUpload: () => void;
}) {
  return (
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
      <Button
        flex={1}
        onClick={onRetake}
        disabled={uploading}
        variant="outline"
        color="white"
        radius="xl"
        size="lg"
      >
        재촬영
      </Button>
      <Button
        flex={1}
        onClick={onUpload}
        disabled={uploading}
        color="brand"
        radius="xl"
        size="lg"
        leftSection={uploading ? <Loader size="xs" color="white" /> : null}
      >
        {uploading ? '업로드 중...' : '업로드'}
      </Button>
    </div>
  );
}

function PhotoErrorToast({ error }: { error: string }) {
  return (
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
  );
}
