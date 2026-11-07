/**
 * 배송 완료 사진 화면의 "어느 집" 안내와 완료 알림 문구 (DOM·네트워크 없음, vitest로 검증).
 *
 * 값은 기사 주문 조회(`GET /driver/orders/{id}`) 응답에서 읽는다. 업로드 명령에 쓰는 판매자 ID와 같이
 * 같은 주문의 응답일 때만 읽고(readDriverOrderStoreId와 같은 방식), 형식이 맞지 않으면 null로 두어
 * 화면이 안내 줄을 숨기게 한다. 주소는 목록·상세와 같은 splitDeliveryAddress로 나눈다(지어내지 않는다).
 */
import { splitDeliveryAddress } from '../../../../lib/address-parts';

export type PhotoOrderSummary = {
  /** 동·호수(상세 주소). 나눌 수 없으면 전체 주소. */
  place: string;
  /** 받는 분 이름. 없으면 null. */
  recipient: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 기사 주문 상세 응답에서 같은 주문의 주소·받는 분만 안전하게 읽는다. 주소가 없으면 null. */
export function readPhotoOrderSummary(payload: unknown, orderId: string): PhotoOrderSummary | null {
  if (!isRecord(payload) || payload.id !== orderId) return null;
  const deliveryAddress = isRecord(payload.deliveryAddress)
    ? readText(payload.deliveryAddress.address)
    : null;
  const parts = splitDeliveryAddress(readText(payload.address), deliveryAddress);
  if (!parts) return null;
  return { place: parts.detail ?? parts.base, recipient: readText(payload.buyerName) };
}

/** 촬영 화면 제목 아래 한 줄. 예: "101동 1203호 · 받는 분 김그린" */
export function photoOrderSummaryLine(summary: PhotoOrderSummary): string {
  return summary.recipient ? `${summary.place} · 받는 분 ${summary.recipient}` : summary.place;
}

/** 배송 완료로 수렴한 뒤 목록으로 돌아가며 띄우는 알림. 주소를 모르면 주소 없이 쓴다. */
export function deliveryCompletedMessage(summary: PhotoOrderSummary | null): string {
  return summary ? `${summary.place} 배송을 완료했어요.` : '배송을 완료했어요.';
}
