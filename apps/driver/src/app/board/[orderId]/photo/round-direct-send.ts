/**
 * 회차 직배송 완료 사진 한 번 보내기와 결과 분류. 사진 화면(photo-capture)과 업로드 대기열 실행기
 * (pending-photo-runner)가 같은 함수를 쓴다.
 *
 * - 보내는 것은 `POST /stores/:storeId/orders/:orderId/delivery-photos` 하나뿐이다. 서버가 사진 연결과
 *   DELIVERED 전이를 함께 처리하므로 별도 PATCH DELIVERED를 보내지 않는다.
 * - 성공은 response.ok가 아니라 semantic ACK(같은 주문·photoId·DELIVERED)로만 판정한다.
 * - 사진 바이트와 멱등 키는 호출자가 준 그대로 보낸다. 다시 인코딩하거나 키를 만들지 않는다.
 * - 네트워크 오류·시간 초과(ApiTimeoutError)는 던지지 않고 NETWORK(불확실)로 돌려준다.
 */

import { apiPathSegment } from '@greenhub/shared';
import { readDriverOrderErrorCode } from '../../_lib/driver-order-detail';
import {
  classifyPhotoUploadFailure,
  DELIVERY_PHOTO_NO_HOLD,
  DELIVERY_PHOTO_STALE_HOLD_CODE,
  isDeliveryPhotoAck,
} from './photo-upload-policy';
import type { PendingPhotoSendResult } from './pending-photo-policy';

export type RoundDirectPhotoSendResult = PendingPhotoSendResult;

/** apiFetch와 같은 모양. 테스트는 가짜 fetch를 넣는다. */
export type RoundDirectPhotoPost = (
  path: string,
  token: string,
  init: { method: 'POST'; body: FormData },
) => Promise<Response>;

export function roundDirectDeliveryPhotoPath(storeId: string, orderId: string): string {
  return `/stores/${apiPathSegment(storeId)}/orders/${apiPathSegment(orderId)}/delivery-photos`;
}

export async function sendRoundDirectPhoto(args: {
  post: RoundDirectPhotoPost;
  token: string;
  storeId: string;
  orderId: string;
  idempotencyKey: string;
  photo: Blob;
  /**
   * 촬영 때 본 주문 보류 표시. 문자열은 그 heldAt, null은 보류 이력 없음('none'으로 싣는다).
   * undefined면 싣지 않는다(이전 대기열 항목·보류 표시를 모르는 경우: 서버가 확인하지 않는다).
   */
  expectedHoldAt?: string | null;
}): Promise<RoundDirectPhotoSendResult> {
  const { orderId } = args;
  let path: string;
  try {
    path = roundDirectDeliveryPhotoPath(args.storeId, orderId);
  } catch {
    // 경로에 넣을 수 없는 ID면 보내지 않는다. 서버가 받은 적 없는 확정 거절로 닫는다.
    return { kind: 'failure', failure: 'REJECTED', status: null };
  }
  try {
    const form = new FormData();
    form.append('photo', args.photo, 'delivery.jpg');
    form.append('idempotencyKey', args.idempotencyKey);
    if (args.expectedHoldAt !== undefined) {
      form.append('expectedHoldAt', args.expectedHoldAt ?? DELIVERY_PHOTO_NO_HOLD);
    }
    const response = await args.post(path, args.token, { method: 'POST', body: form });
    if (response.ok) {
      let result: unknown = null;
      try {
        result = await response.json();
      } catch {
        result = null;
      }
      if (isDeliveryPhotoAck(result, orderId)) return { kind: 'ack' };
      return {
        kind: 'failure',
        failure: classifyPhotoUploadFailure({ kind: 'ack' }),
        status: response.status,
      };
    }
    return {
      kind: 'failure',
      failure: classifyPhotoUploadFailure({
        kind: 'http',
        status: response.status,
        code: await readPhotoErrorCode(response),
      }),
      status: response.status,
    };
  } catch {
    return {
      kind: 'failure',
      failure: classifyPhotoUploadFailure({ kind: 'network' }),
      status: null,
    };
  }
}

/** 오류 응답의 코드. 기사 명령 공통 코드와 이 경로 전용 코드(촬영 뒤 새 보류)만 읽는다. */
async function readPhotoErrorCode(response: Pick<Response, 'json'>): Promise<string | null> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    (body as { code?: unknown }).code === DELIVERY_PHOTO_STALE_HOLD_CODE
  ) {
    return DELIVERY_PHOTO_STALE_HOLD_CODE;
  }
  return readDriverOrderErrorCode(body);
}
