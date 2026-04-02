"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { apiFetch } from "@/lib/api";
import { use } from "react";

type Order = {
  id?: string;
  storeId: string;
  status: string;
  deliveryMethod: string;
  buyerName?: string;
  address?: string;
  hubName?: string;
  hubAddress?: string;
  productName?: string;
  quantity?: number;
  preparedAt?: { seconds: number } | null;
  sellerPhone?: string;
  buyerPhone?: string;
};

const METHOD_BADGE: Record<string, string> = {
  direct: "직배송",
  hub: "거점 픽업",
  parcel: "택배",
};

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);
  const { data: session } = useSession();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "orders", orderId), (snap) => {
      if (snap.exists()) setOrder({ id: snap.id, ...snap.data() } as Order);
    });
    return unsub;
  }, [orderId]);

  async function updateStatus(status: string, extra?: Record<string, unknown>) {
    if (!order || !session) return;
    setLoading(true);
    try {
      const res = await apiFetch(
        `/stores/${order.storeId}/orders/${orderId}/status`,
        session.user.accessToken,
        {
          method: "PATCH",
          body: JSON.stringify({ status, ...extra }),
        }
      );
      if (!res.ok) throw new Error("상태 전환 실패");
      if (status === "DELIVERED" || status === "HUB_ARRIVED") {
        router.replace("/board?tab=preparing");
      }
    } catch {
      alert("오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-green-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isDelivering = order.status === "DELIVERING";
  const isPreparing = order.status === "PREPARING";
  const isHub = order.deliveryMethod === "hub";

  const preparedAtStr = order.preparedAt
    ? new Date(order.preparedAt.seconds * 1000).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "시간 미정";

  return (
    <div className="flex flex-col min-h-screen">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-500 p-1">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-800">
            {METHOD_BADGE[order.deliveryMethod] ?? order.deliveryMethod}
          </span>
          {isDelivering && (
            <span className="text-sm font-semibold text-blue-600">배송 중</span>
          )}
        </div>
      </header>

      {/* 본문 */}
      <main className="flex-1 px-4 py-6 space-y-6">
        {/* 주문 정보 */}
        <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500">주문 정보</h2>
          <InfoRow label="상품" value={`${order.productName ?? "-"} ${order.quantity ? `× ${order.quantity}` : ""}`} />
          {isPreparing && (
            <InfoRow label="수거 예정" value={preparedAtStr} />
          )}
          {isHub ? (
            <>
              <InfoRow label="거점명" value={order.hubName ?? "-"} />
              <InfoRow label="거점 주소" value={order.hubAddress ?? "-"} />
            </>
          ) : (
            <InfoRow label="배송지" value={order.address ?? "-"} />
          )}
          {isPreparing && (
            <InfoRow label="소비자" value={order.buyerName ?? "-"} />
          )}
        </section>

        {/* 연락처 */}
        <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500">연락처</h2>
          {isPreparing && order.sellerPhone && (
            <ContactRow label="판매자" phone={order.sellerPhone} />
          )}
          {isDelivering && !isHub && order.buyerPhone && (
            <ContactRow label="소비자" phone={order.buyerPhone} />
          )}
          {isDelivering && isHub && order.sellerPhone && (
            <ContactRow label="판매자" phone={order.sellerPhone} />
          )}
        </section>
      </main>

      {/* 하단 CTA 버튼 */}
      <div className="sticky bottom-[72px] px-4 pb-4">
        {isPreparing && (
          <ActionButton
            label="수거 완료 / 배송 시작"
            color="bg-green-primary"
            loading={loading}
            onClick={() => updateStatus("DELIVERING")}
          />
        )}
        {isDelivering && !isHub && (
          <ActionButton
            label="배송 완료"
            color="bg-green-primary"
            loading={loading}
            onClick={() => updateStatus("DELIVERED")}
          />
        )}
        {isDelivering && isHub && (
          <ActionButton
            label="거점 도착"
            color="bg-blue-600"
            loading={loading}
            onClick={() =>
              router.push(`/board/${orderId}/photo`)
            }
          />
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-900 dark:text-gray-100 font-medium text-right max-w-[60%]">
        {value}
      </span>
    </div>
  );
}

function ContactRow({ label, phone }: { label: string; phone: string }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{phone}</p>
      </div>
      <a
        href={`tel:${phone}`}
        className="flex items-center gap-1.5 bg-green-pale dark:bg-green-dark text-green-dark dark:text-green-light text-sm font-semibold px-4 py-2 rounded-xl"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
        전화
      </a>
    </div>
  );
}

function ActionButton({
  label,
  color,
  loading,
  onClick,
}: {
  label: string;
  color: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`w-full ${color} text-white font-bold py-4 rounded-2xl text-base disabled:opacity-50 transition-opacity min-h-[56px]`}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          처리 중...
        </span>
      ) : (
        label
      )}
    </button>
  );
}
