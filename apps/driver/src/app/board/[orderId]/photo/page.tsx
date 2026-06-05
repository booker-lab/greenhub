'use client';

import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { use, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { storage } from '@/lib/firebase';
import { buildHubArrivedPayload, getDeliveryPhotoPath } from '../_lib';
import { PhotoCaptureView } from './_components/PhotoCaptureView';

export default function PhotoPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const storeId = useSearchParams().get('storeId') ?? '';
  const { data: session } = useSession();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function startCamera() {
    setError('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.play();
      }
    } catch {
      setError('카메라 접근 권한이 필요합니다.');
    }
  }

  function capture() {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(
      (b) => {
        if (!b) return;
        setBlob(b);
        setCaptured(canvas.toDataURL('image/jpeg', 0.85));
        stream?.getTracks().forEach((track) => {
          track.stop();
        });
        setStream(null);
      },
      'image/jpeg',
      0.85,
    );
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
      const storageRef = ref(storage, getDeliveryPhotoPath(orderId));
      await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
      const photoUrl = await getDownloadURL(storageRef);

      const res = await apiFetch(
        `/stores/${storeId}/orders/${orderId}/status`,
        session.user.accessToken,
        { method: 'PATCH', body: buildHubArrivedPayload(photoUrl) },
      );
      if (!res.ok) throw new Error('상태 전환 실패');

      router.replace('/board?tab=preparing');
    } catch {
      setError('업로드 실패. 다시 시도해주세요.');
    } finally {
      setUploading(false);
    }
  }

  function goBack() {
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    router.back();
  }

  return (
    <PhotoCaptureView
      videoRef={videoRef}
      canvasRef={canvasRef}
      stream={stream}
      captured={captured}
      uploading={uploading}
      error={error}
      onBack={goBack}
      onStartCamera={startCamera}
      onCapture={capture}
      onRetake={retake}
      onUpload={upload}
    />
  );
}
