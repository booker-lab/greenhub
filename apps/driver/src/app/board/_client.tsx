"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import OrderCard from "@/components/OrderCard";

type Order = {
  id: string;
  status: string;
  deliveryMethod: string;
  buyerName?: string;
  address?: string;
  hubName?: string;
  hubAddress?: string;
  productName?: string;
  quantity?: number;
  preparedAt?: { seconds: number } | null;
  deliveredAt?: { seconds: number } | null;
};

export default function BoardPage() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get("tab") ?? "preparing";

  const [preparing, setPreparing] = useState<Order[]>([]);
  const [delivering, setDelivering] = useState<Order[]>([]);

  useEffect(() => {
    // PREPARING 실시간 리스너
    const qPreparing = query(
      collection(db, "orders"),
      where("status", "==", "PREPARING"),
      orderBy("preparedAt", "asc")
    );
    const unsubPreparing = onSnapshot(qPreparing, (snap) => {
      setPreparing(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order)));
    });

    // DELIVERING 실시간 리스너
    const qDelivering = query(
      collection(db, "orders"),
      where("status", "==", "DELIVERING"),
      orderBy("updatedAt", "asc")
    );
    const unsubDelivering = onSnapshot(qDelivering, (snap) => {
      setDelivering(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order))
      );
    });

    return () => {
      unsubPreparing();
      unsubDelivering();
    };
  }, []);

  const orders = tab === "preparing" ? preparing : delivering;

  const today = new Date().toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  return (
    <div className="flex flex-col min-h-screen">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-4 pt-4 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              오늘 배송
            </h1>
            <p className="text-xs text-gray-400">{today}</p>
          </div>
        </div>

        {/* 탭 */}
        <div className="flex">
          <button
            onClick={() => router.replace("/board?tab=preparing")}
            className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${
              tab === "preparing"
                ? "border-green-primary text-green-primary"
                : "border-transparent text-gray-400"
            }`}
          >
            수거 대기{" "}
            {preparing.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 bg-red-500 text-white text-[10px] rounded-full">
                {preparing.length}
              </span>
            )}
          </button>
          <button
            onClick={() => router.replace("/board?tab=delivering")}
            className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${
              tab === "delivering"
                ? "border-green-primary text-green-primary"
                : "border-transparent text-gray-400"
            }`}
          >
            배송 중{" "}
            {delivering.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 bg-blue-500 text-white text-[10px] rounded-full">
                {delivering.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* 주문 목록 */}
      <main className="flex-1 px-4 py-4 space-y-3">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <p className="text-sm">
              {tab === "preparing"
                ? "오늘 수거할 주문이 없습니다"
                : "현재 배송 중인 주문이 없습니다"}
            </p>
            {tab === "preparing" && (
              <button
                onClick={() => router.push("/map")}
                className="mt-3 text-xs text-green-primary underline"
              >
                지도에서 경로 보기
              </button>
            )}
          </div>
        ) : (
          orders.map((order) => (
            <OrderCard key={order.id} order={order} tab={tab} />
          ))
        )}
      </main>
    </div>
  );
}
