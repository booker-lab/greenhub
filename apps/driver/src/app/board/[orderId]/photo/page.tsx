"use client";

import { useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { storage, db } from "@/lib/firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { doc, getDoc } from "firebase/firestore";
import { apiFetch } from "@/lib/api";
import { use } from "react";

export default function PhotoPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);
  const { data: session } = useSession();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [captured, setCaptured] = useState<string | null>(null); // base64 preview
  const [blob, setBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function startCamera() {
    setError("");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.play();
      }
    } catch {
      setError("카메라 접근 권한이 필요합니다.");
    }
  }

  function capture() {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(
      (b) => {
        if (!b) return;
        setBlob(b);
        setCaptured(canvas.toDataURL("image/jpeg", 0.85));
        stream?.getTracks().forEach((t) => t.stop());
        setStream(null);
      },
      "image/jpeg",
      0.85
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
    setError("");
    try {
      // Firebase Storage 업로드
      const timestamp = Date.now();
      const storageRef = ref(
        storage,
        `deliveryPhotos/${orderId}_${timestamp}.jpg`
      );
      await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
      const photoUrl = await getDownloadURL(storageRef);

      // 주문 storeId 조회
      const orderSnap = await getDoc(doc(db, "orders", orderId));
      const storeId = orderSnap.data()?.storeId as string;

      // 상태 전환: DELIVERING → HUB_ARRIVED + photoUrl
      const res = await apiFetch(
        `/stores/${storeId}/orders/${orderId}/status`,
        session.user.accessToken,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "HUB_ARRIVED", photoUrl }),
        }
      );
      if (!res.ok) throw new Error("상태 전환 실패");

      router.replace("/board?tab=preparing");
    } catch {
      setError("업로드 실패. 다시 시도해주세요.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* 헤더 */}
      <header className="absolute top-0 left-0 right-0 z-20 flex items-center gap-3 px-4 pt-safe pt-4 pb-3 bg-gradient-to-b from-black/60 to-transparent">
        <button
          onClick={() => {
            stream?.getTracks().forEach((t) => t.stop());
            router.back();
          }}
          className="text-white p-1"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-white font-semibold">거점 하차 인증 사진</span>
      </header>

      {/* 카메라 / 미리보기 */}
      <div className="flex-1 relative">
        {!stream && !captured && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
            <p className="text-white text-sm">하차 물품을 촬영해주세요</p>
            <button
              onClick={startCamera}
              className="bg-white text-gray-900 font-semibold px-8 py-3 rounded-xl"
            >
              카메라 시작
            </button>
            {error && <p className="text-red-400 text-sm text-center px-6">{error}</p>}
          </div>
        )}

        {stream && (
          <>
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute bottom-8 left-0 right-0 flex justify-center">
              <button
                onClick={capture}
                className="w-16 h-16 bg-white rounded-full border-4 border-green-primary shadow-lg"
              />
            </div>
          </>
        )}

        {captured && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={captured}
              alt="촬영 미리보기"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />
          </>
        )}
      </div>

      {/* 하단 버튼 */}
      {captured && (
        <div className="absolute bottom-0 left-0 right-0 flex gap-3 px-4 pb-8 pt-4 bg-gradient-to-t from-black/70 to-transparent">
          <button
            onClick={retake}
            disabled={uploading}
            className="flex-1 bg-white/20 text-white font-semibold py-4 rounded-2xl border border-white/30"
          >
            재촬영
          </button>
          <button
            onClick={upload}
            disabled={uploading}
            className="flex-1 bg-green-primary text-white font-semibold py-4 rounded-2xl disabled:opacity-50"
          >
            {uploading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                업로드 중...
              </span>
            ) : (
              "업로드"
            )}
          </button>
        </div>
      )}

      {error && captured && (
        <div className="absolute top-20 left-4 right-4 bg-red-500 text-white text-sm text-center py-2 rounded-xl">
          {error}
        </div>
      )}
    </div>
  );
}
