import Link from "next/link";

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
  direct: { label: "직배송", color: "bg-green-100 text-green-800" },
  hub: { label: "거점 픽업", color: "bg-blue-100 text-blue-800" },
  parcel: { label: "택배", color: "bg-gray-100 text-gray-600" },
};

function formatTime(ts?: { seconds: number } | null) {
  if (!ts) return "시간 미정";
  return new Date(ts.seconds * 1000).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OrderCard({
  order,
  tab,
}: {
  order: Order;
  tab: string;
}) {
  const badge = METHOD_BADGE[order.deliveryMethod] ?? METHOD_BADGE.direct;
  const displayAddress =
    order.deliveryMethod === "hub"
      ? order.hubAddress ?? "-"
      : order.address ?? "-";
  const displayLocation =
    order.deliveryMethod === "hub"
      ? `${order.hubName ?? "거점"} · ${displayAddress}`
      : displayAddress;

  return (
    <Link
      href={`/board/${order.id}`}
      className="block bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm active:scale-[0.98] transition-transform"
    >
      <div className="flex items-start justify-between mb-2">
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.color}`}
        >
          {badge.label}
        </span>
        <span className="text-xs text-gray-400">
          {tab === "preparing"
            ? `수거 ${formatTime(order.preparedAt)}`
            : `배송 시작 ${formatTime(order.updatedAt)}`}
        </span>
      </div>
      <p className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {order.buyerName ?? "소비자"}
      </p>
      <p className="text-sm text-gray-500 truncate">{displayLocation}</p>
      {order.productName && (
        <p className="text-xs text-gray-400 mt-1">
          {order.productName}
          {order.quantity && order.quantity > 1 ? ` 외 ${order.quantity - 1}건` : ""}
        </p>
      )}
    </Link>
  );
}
