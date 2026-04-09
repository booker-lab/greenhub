"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useFirebaseAuth } from "@/hooks/useFirebaseAuth";
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { apiFetch } from "@/lib/api";
import { use } from "react";
import { notifications } from "@mantine/notifications";
import {
  Box, Stack, Group, Text, Title, Badge, Card,
  Button, Loader, UnstyledButton, Anchor,
} from "@mantine/core";

type Order = {
  id?: string;
  storeId: string;
  status: string;
  deliveryMethod: string;
  buyerName?: string;
  address?: string;
  deliveryAddress?: { address?: string };
  hubName?: string;
  hubAddress?: string;
  productName?: string;
  quantity?: number;
  preparedAt?: { seconds: number } | null;
  sellerPhone?: string;
  buyerPhone?: string;
};

const METHOD_LABEL: Record<string, string> = {
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
  const { firebaseReady } = useFirebaseAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!firebaseReady) return;

    const unsub = onSnapshot(doc(db, "orders", orderId), (snap) => {
      if (snap.exists()) setOrder({ id: snap.id, ...snap.data() } as Order);
    });
    return unsub;
  }, [orderId, firebaseReady]);

  async function updateStatus(status: string) {
    if (!order || !session) return;
    setLoading(true);
    try {
      const res = await apiFetch(
        `/stores/${order.storeId}/orders/${orderId}/status`,
        session.user.accessToken,
        { method: "PATCH", body: JSON.stringify({ status }) }
      );
      if (!res.ok) throw new Error("상태 전환 실패");
      if (status === "DELIVERED" || status === "HUB_ARRIVED") {
        router.replace("/board?tab=preparing");
      }
    } catch {
      notifications.show({ color: 'red', message: '오류가 발생했습니다. 다시 시도해주세요.' });
    } finally {
      setLoading(false);
    }
  }

  if (!order) {
    return (
      <Box style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader color="brand" />
      </Box>
    );
  }

  const isDelivering = order.status === "DELIVERING";
  const isPreparing = order.status === "PREPARING";
  const isHub = order.deliveryMethod === "hub";
  const preparedAtStr = order.preparedAt
    ? new Date(order.preparedAt.seconds * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : "시간 미정";

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
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <UnstyledButton onClick={() => router.back()} style={{ color: "var(--mantine-color-gray-6)", padding: 4 }}>
          <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </UnstyledButton>
        <Group gap="xs">
          <Badge color="green" variant="light" size="sm">
            {METHOD_LABEL[order.deliveryMethod] ?? order.deliveryMethod}
          </Badge>
          {isDelivering && <Text size="sm" fw={600} c="blue">배송 중</Text>}
        </Group>
      </Box>

      {/* 본문 */}
      <Box component="main" style={{ flex: 1, padding: "24px 16px" }}>
        <Stack gap="md">
          {/* 주문 정보 */}
          <Card radius="xl" withBorder p="md">
            <Stack gap="sm">
              <Text size="sm" fw={600} c="dimmed">주문 정보</Text>
              <InfoRow label="상품" value={`${order.productName ?? "-"}${order.quantity ? ` × ${order.quantity}` : ""}`} />
              {isPreparing && <InfoRow label="수거 예정" value={preparedAtStr} />}
              {isHub ? (
                <>
                  <InfoRow label="거점명" value={order.hubName ?? "-"} />
                  <InfoRow label="거점 주소" value={order.hubAddress ?? "-"} />
                </>
              ) : (
                <InfoRow label="배송지" value={order.address ?? order.deliveryAddress?.address ?? "-"} />
              )}
              {isPreparing && <InfoRow label="소비자" value={order.buyerName ?? "-"} />}
            </Stack>
          </Card>

          {/* 연락처 */}
          <Card radius="xl" withBorder p="md">
            <Stack gap="sm">
              <Text size="sm" fw={600} c="dimmed">연락처</Text>
              {isPreparing && order.sellerPhone && <ContactRow label="판매자" phone={order.sellerPhone} />}
              {isDelivering && !isHub && order.buyerPhone && <ContactRow label="소비자" phone={order.buyerPhone} />}
              {isDelivering && isHub && order.sellerPhone && <ContactRow label="판매자" phone={order.sellerPhone} />}
            </Stack>
          </Card>
        </Stack>
      </Box>

      {/* 하단 CTA */}
      <Box style={{ position: "sticky", bottom: 72, padding: "0 16px 16px" }}>
        {isPreparing && (
          <Button fullWidth size="lg" radius="xl" color="brand" loading={loading} onClick={() => updateStatus("DELIVERING")}>
            수거 완료 / 배송 시작
          </Button>
        )}
        {isDelivering && !isHub && (
          <Button fullWidth size="lg" radius="xl" color="brand" loading={loading} onClick={() => updateStatus("DELIVERED")}>
            배송 완료
          </Button>
        )}
        {isDelivering && isHub && (
          <Button fullWidth size="lg" radius="xl" color="blue" loading={loading} onClick={() => router.push(`/board/${orderId}/photo`)}>
            거점 도착
          </Button>
        )}
      </Box>
    </Box>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between" align="flex-start">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="sm" fw={500} ta="right" style={{ maxWidth: "60%" }}>{value}</Text>
    </Group>
  );
}

function ContactRow({ label, phone }: { label: string; phone: string }) {
  return (
    <Group justify="space-between" align="center">
      <Stack gap={2}>
        <Text size="xs" c="dimmed">{label}</Text>
        <Text size="sm" fw={500}>{phone}</Text>
      </Stack>
      <Anchor
        component="a"
        href={`tel:${phone}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          backgroundColor: "var(--green-pale)",
          color: "var(--green-dark)",
          fontWeight: 600,
          fontSize: 14,
          padding: "8px 16px",
          borderRadius: 12,
          textDecoration: "none",
        }}
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
        전화
      </Anchor>
    </Group>
  );
}
