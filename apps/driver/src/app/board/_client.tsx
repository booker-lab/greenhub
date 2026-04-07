"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { db } from "@/lib/firebase";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import OrderCard from "@/components/OrderCard";
import { Box, Stack, Title, Text, UnstyledButton, Badge, Anchor } from "@mantine/core";

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

export default function BoardClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const tab = searchParams.get("tab") ?? "preparing";

  const [preparing, setPreparing] = useState<Order[]>([]);
  const [delivering, setDelivering] = useState<Order[]>([]);

  useEffect(() => {
    const qPreparing = query(
      collection(db, "orders"),
      where("status", "==", "PREPARING"),
      orderBy("preparedAt", "asc")
    );
    const unsubPreparing = onSnapshot(qPreparing, (snap) => {
      setPreparing(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order)));
    });

    const driverId = session?.user?.id;
    const deliveringConditions = driverId
      ? [where("status", "==", "DELIVERING"), where("driverId", "==", driverId), orderBy("updatedAt", "asc")]
      : [where("status", "==", "DELIVERING"), orderBy("updatedAt", "asc")];
    const qDelivering = query(collection(db, "orders"), ...deliveringConditions);
    const unsubDelivering = onSnapshot(qDelivering, (snap) => {
      setDelivering(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order)));
    });

    return () => {
      unsubPreparing();
      unsubDelivering();
    };
  }, [session?.user?.id]);

  const orders = tab === "preparing" ? preparing : delivering;
  const today = new Date().toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });

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
          padding: "16px 16px 0",
        }}
      >
        <Box mb="sm">
          <Title order={4}>오늘 배송</Title>
          <Text size="xs" c="dimmed">{today}</Text>
        </Box>

        {/* 탭 */}
        <Box style={{ display: "flex" }}>
          {[
            { key: "preparing", label: "수거 대기", count: preparing.length },
            { key: "delivering", label: "배송 중", count: delivering.length },
          ].map(({ key, label, count }) => (
            <UnstyledButton
              key={key}
              onClick={() => router.replace(`/board?tab=${key}`)}
              style={{
                flex: 1,
                padding: "12px 0",
                textAlign: "center",
                fontSize: 14,
                fontWeight: 600,
                borderBottom: `2px solid ${tab === key ? "var(--green-primary)" : "transparent"}`,
                color: tab === key ? "var(--green-primary)" : "var(--mantine-color-gray-5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {label}
              {count > 0 && (
                <Badge
                  size="xs"
                  color={key === "preparing" ? "red" : "blue"}
                  circle
                >
                  {count}
                </Badge>
              )}
            </UnstyledButton>
          ))}
        </Box>
      </Box>

      {/* 주문 목록 */}
      <Box component="main" style={{ flex: 1, padding: "16px" }}>
        {orders.length === 0 ? (
          <Stack align="center" justify="center" h={192} gap="xs">
            <Text size="sm" c="dimmed">
              {tab === "preparing" ? "오늘 수거할 주문이 없습니다" : "현재 배송 중인 주문이 없습니다"}
            </Text>
            {tab === "preparing" && (
              <Anchor size="xs" c="brand.6" onClick={() => router.push("/map")}>
                지도에서 경로 보기
              </Anchor>
            )}
          </Stack>
        ) : (
          <Stack gap="sm">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} tab={tab} />
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
