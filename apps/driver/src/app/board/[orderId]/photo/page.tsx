"use client";

import { useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { storage, db } from "@/lib/firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { doc, getDoc } from "firebase/firestore";
import { apiFetch } from "@/lib/api";
import { use } from "react";
import { Button, Text, Loader } from "@mantine/core";

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
  const [captured, setCaptured] = useState<string | null>(null);
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
      const timestamp = Date.now();
      const storageRef = ref(storage, `deliveryPhotos/${orderId}_${timestamp}.jpg`);
      await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
      const photoUrl = await getDownloadURL(storageRef);

      const orderSnap = await getDoc(doc(db, "orders", orderId));
      const storeId = orderSnap.data()?.storeId as string;

      const res = await apiFetch(
        `/stores/${storeId}/orders/${orderId}/status`,
        session.user.accessToken,
        { method: "PATCH", body: JSON.stringify({ status: "HUB_ARRIVED", photoUrl }) }
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
    <div style={{ position: "fixed", inset: 0, backgroundColor: "#000", display: "flex", flexDirection: "column" }}>
      {/* 헤더 */}
      <header style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 20,
        display: "flex", alignItems: "center", gap: 12,
        padding: "16px",
        background: "linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)",
      }}>
        <button
          onClick={() => { stream?.getTracks().forEach((t) => t.stop()); router.back(); }}
          style={{ color: "white", padding: 4, background: "none", border: "none", cursor: "pointer" }}
        >
          <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <Text c="white" fw={600}>거점 하차 인증 사진</Text>
      </header>

      {/* 카메라 / 미리보기 */}
      <div style={{ flex: 1, position: "relative" }}>
        {!stream && !captured && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24,
          }}>
            <Text c="white" size="sm">하차 물품을 촬영해주세요</Text>
            <Button onClick={startCamera} color="white" c="dark" radius="md">
              카메라 시작
            </Button>
            {error && <Text c="red.4" size="sm" ta="center" px="xl">{error}</Text>}
          </div>
        )}

        {stream && (
          <>
            <video
              ref={videoRef}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
              playsInline
              muted
            />
            <canvas ref={canvasRef} style={{ display: "none" }} />
            <div style={{ position: "absolute", bottom: 32, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
              <button
                onClick={capture}
                style={{
                  width: 64, height: 64, borderRadius: "50%",
                  backgroundColor: "white", border: "4px solid var(--green-primary)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)", cursor: "pointer",
                }}
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
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
            <canvas ref={canvasRef} style={{ display: "none" }} />
          </>
        )}
      </div>

      {/* 하단 버튼 */}
      {captured && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          display: "flex", gap: 12, padding: "16px 16px 32px",
          background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
        }}>
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
          <Button
            flex={1}
            onClick={upload}
            disabled={uploading}
            color="brand"
            radius="xl"
            size="lg"
            leftSection={uploading ? <Loader size="xs" color="white" /> : null}
          >
            {uploading ? "업로드 중..." : "업로드"}
          </Button>
        </div>
      )}

      {error && captured && (
        <div style={{
          position: "absolute", top: 80, left: 16, right: 16,
          backgroundColor: "#ef4444", color: "white",
          fontSize: 14, textAlign: "center", padding: "8px 16px", borderRadius: 12,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
