"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";

type Order = {
  id: string;
  status: string;
  deliveryMethod: string;
  buyerName?: string;
  address?: string;
  hubName?: string;
  hubAddress?: string;
  lat?: number;
  lng?: number;
};

// 최근접 이웃 알고리즘으로 추천 방문 순서 계산
function nearestNeighbor(orders: Order[]): Order[] {
  if (orders.length <= 1) return orders;
  const visited = new Set<string>();
  const result: Order[] = [];
  let current = orders[0];
  result.push(current);
  visited.add(current.id);

  while (result.length < orders.length) {
    let nearest: Order | null = null;
    let minDist = Infinity;
    for (const o of orders) {
      if (visited.has(o.id)) continue;
      if (!o.lat || !o.lng || !current.lat || !current.lng) {
        nearest = o;
        break;
      }
      const dist = Math.hypot(o.lat - current.lat, o.lng - current.lng);
      if (dist < minDist) {
        minDist = dist;
        nearest = o;
      }
    }
    if (!nearest) break;
    result.push(nearest);
    visited.add(nearest.id);
    current = nearest;
  }
  return result;
}

export default function MapPage() {
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    const q = query(
      collection(db, "orders"),
      where("status", "in", ["PREPARING", "DELIVERING"])
    );
    const unsub = onSnapshot(q, (snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order)));
    });
    return unsub;
  }, []);

  const sorted = nearestNeighbor(orders);

  function buildKakaoNaviUrl() {
    if (sorted.length === 0) return "";
    const destinations = sorted.map((o, i) => {
      const addr =
        o.deliveryMethod === "hub" ? o.hubAddress ?? "" : o.address ?? "";
      if (o.lat && o.lng) {
        return i === sorted.length - 1
          ? `ep=${o.lat},${o.lng}&eName=${encodeURIComponent(addr)}`
          : `via${i}=${o.lat},${o.lng}`;
      }
      return "";
    });
    const last = sorted[sorted.length - 1];
    const lastAddr =
      last.deliveryMethod === "hub" ? last.hubAddress ?? "" : last.address ?? "";
    return (
      `kakaomap://route?ep=${last.lat ?? 0},${last.lng ?? 0}` +
      `&eName=${encodeURIComponent(lastAddr)}` +
      (sorted.length > 1
        ? "&" +
          sorted
            .slice(0, -1)
            .map((o, i) =>
              o.lat
                ? `via${i}Lat=${o.lat}&via${i}Lng=${o.lng}`
                : ""
            )
            .filter(Boolean)
            .join("&")
        : "")
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-4 py-4">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          오늘 배송 경로
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">
          총 {orders.length}건
        </p>
      </header>

      {/* 지도 플레이스홀더 (카카오맵 SDK는 환경변수 설정 후 활성화) */}
      <div className="mx-4 mt-4 h-48 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center border border-gray-200 dark:border-gray-700">
        <div className="text-center text-gray-400">
          <svg className="w-10 h-10 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <p className="text-xs">카카오맵 SDK 연동 후 활성화</p>
          <p className="text-[10px] mt-1">NEXT_PUBLIC_KAKAO_MAP_KEY 설정 필요</p>
        </div>
      </div>

      {/* 경유지 목록 */}
      <div className="flex-1 px-4 mt-4 space-y-2">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            오늘 배송 주문이 없습니다
          </div>
        ) : (
          sorted.map((order, idx) => {
            const addr =
              order.deliveryMethod === "hub"
                ? `${order.hubName ?? "거점"} · ${order.hubAddress ?? "-"}`
                : order.address ?? "-";
            return (
              <div
                key={order.id}
                className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-4 py-3"
              >
                <span className="w-6 h-6 flex-shrink-0 rounded-full bg-green-primary text-white text-xs font-bold flex items-center justify-center">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {order.buyerName ?? "소비자"}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{addr}</p>
                </div>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    order.status === "DELIVERING"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-yellow-100 text-yellow-700"
                  }`}
                >
                  {order.status === "DELIVERING" ? "배송 중" : "수거 대기"}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* 주행 시작 버튼 */}
      {sorted.length > 0 && (
        <div className="sticky bottom-[72px] px-4 pb-4 pt-3">
          <a
            href={buildKakaoNaviUrl()}
            className="block w-full bg-green-primary text-white font-bold text-center py-4 rounded-2xl text-base"
          >
            주행 시작 (카카오내비)
          </a>
        </div>
      )}
    </div>
  );
}
