"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Box, Stack, Group, Text, Title, Badge, Button } from "@mantine/core";

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
    const last = sorted[sorted.length - 1];
    const lastAddr = last.deliveryMethod === "hub" ? last.hubAddress ?? "" : last.address ?? "";
    return (
      `kakaomap://route?ep=${last.lat ?? 0},${last.lng ?? 0}` +
      `&eName=${encodeURIComponent(lastAddr)}` +
      (sorted.length > 1
        ? "&" + sorted.slice(0, -1).map((o, i) => o.lat ? `via${i}Lat=${o.lat}&via${i}Lng=${o.lng}` : "").filter(Boolean).join("&")
        : "")
    );
  }

  return (
    <Box style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      {/* 헤더 */}
      <Box
        component="header"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          backgroundColor: "var(--mantine-color-white)",
          borderBottom: "1px solid var(--mantine-color-gray-2)",
          padding: "16px",
        }}
      >
        <Title order={4}>오늘 배송 경로</Title>
        <Text size="xs" c="dimmed" mt={2}>총 {orders.length}건</Text>
      </Box>

      {/* 지도 플레이스홀더 */}
      <Box
        mx="md"
        mt="md"
        h={192}
        style={{
          borderRadius: 16,
          backgroundColor: "var(--mantine-color-gray-1)",
          border: "1px solid var(--mantine-color-gray-3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Stack align="center" gap={4}>
          <svg width="40" height="40" fill="none" stroke="var(--mantine-color-gray-5)" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <Text size="xs" c="dimmed">카카오맵 SDK 연동 후 활성화</Text>
          <Text size="xs" c="dimmed">NEXT_PUBLIC_KAKAO_MAP_KEY 설정 필요</Text>
        </Stack>
      </Box>

      {/* 경유지 목록 */}
      <Box style={{ flex: 1, padding: "16px" }}>
        {sorted.length === 0 ? (
          <Box style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 128 }}>
            <Text size="sm" c="dimmed">오늘 배송 주문이 없습니다</Text>
          </Box>
        ) : (
          <Stack gap="xs">
            {sorted.map((order, idx) => {
              const addr =
                order.deliveryMethod === "hub"
                  ? `${order.hubName ?? "거점"} · ${order.hubAddress ?? "-"}`
                  : order.address ?? "-";
              return (
                <Box
                  key={order.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    backgroundColor: "var(--mantine-color-white)",
                    borderRadius: 12,
                    border: "1px solid var(--mantine-color-gray-2)",
                    padding: "12px 16px",
                  }}
                >
                  <Box
                    style={{
                      width: 24,
                      height: 24,
                      flexShrink: 0,
                      borderRadius: "50%",
                      backgroundColor: "var(--green-primary)",
                      color: "white",
                      fontSize: 11,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {idx + 1}
                  </Box>
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate="end">{order.buyerName ?? "소비자"}</Text>
                    <Text size="xs" c="dimmed" truncate="end">{addr}</Text>
                  </Box>
                  <Badge
                    size="xs"
                    color={order.status === "DELIVERING" ? "blue" : "yellow"}
                    variant="light"
                  >
                    {order.status === "DELIVERING" ? "배송 중" : "수거 대기"}
                  </Badge>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>

      {/* 주행 시작 버튼 */}
      {sorted.length > 0 && (
        <Box style={{ position: "sticky", bottom: 72, padding: "0 16px 16px" }}>
          <Button
            component="a"
            href={buildKakaoNaviUrl()}
            fullWidth
            size="lg"
            radius="xl"
            color="brand"
          >
            주행 시작 (카카오내비)
          </Button>
        </Box>
      )}
    </Box>
  );
}
