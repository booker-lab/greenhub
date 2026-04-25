import Link from "next/link";
import { Card, Badge, Text, Stack, Group } from "@mantine/core";

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
  updatedAt?: { seconds: number } | null;
};

const METHOD_BADGE: Record<string, { label: string; color: string }> = {
  direct: { label: "직배송", color: "green" },
  hub: { label: "거점 픽업", color: "blue" },
  parcel: { label: "택배", color: "gray" },
};

function formatTime(ts?: { seconds: number } | null) {
  if (!ts) return "시간 미정";
  return new Date(ts.seconds * 1000).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OrderCard({ order, tab }: { order: Order; tab: string }) {
  const badge = METHOD_BADGE[order.deliveryMethod] ?? METHOD_BADGE.direct;
  const displayAddress =
    order.deliveryMethod === "hub" ? order.hubAddress ?? "-" : order.address ?? "-";
  const displayLocation =
    order.deliveryMethod === "hub"
      ? `${order.hubName ?? "거점"} · ${displayAddress}`
      : displayAddress;

  return (
    <Card
      component={Link}
      href={`/board/${order.id}`}
      radius="xl"
      withBorder
      p="md"
      style={{ textDecoration: "none" }}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Badge color={badge.color} variant="light" size="md">
            {badge.label}
          </Badge>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            {tab === "preparing"
              ? `수거 ${formatTime(order.preparedAt)}`
              : `배송 시작 ${formatTime(order.updatedAt)}`}
          </Text>
        </Group>
        <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }}>
          {order.buyerName ?? "소비자"}
        </Text>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} truncate="end">
          {displayLocation}
        </Text>
        {order.productName && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            {order.productName}
            {order.quantity && order.quantity > 1 ? ` 외 ${order.quantity - 1}건` : ""}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
