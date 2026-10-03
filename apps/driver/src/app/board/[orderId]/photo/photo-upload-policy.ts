/**
 * 배송 완료 사진 업로드의 순수 판단 모음 (DOM·네트워크 없음, node:test로 검증).
 *
 * - 사진 축소 크기 계산과 JPEG 재인코딩 단계 판단
 * - 업로드 실패 원인 분류 (크기·상태 충돌·권한·없음·네트워크·서버·응답 미확인)
 * - 멱등 키 재사용/새로 만들기 판단
 * - 실패 뒤 주문 상태 재조회 결과로 다음 행동 결정
 *
 * 서버 계약 (apps/api/src/orders/delivery-photos.service.ts):
 * - photoId = hash(orderId + idempotencyKey). 같은 키·같은 사진 재전송은 멱등 성공이다.
 * - 같은 키에 다른 사진이 이미 저장돼 있으면 409, 다른 키로 이미 사진이 연결돼 있으면 403/409.
 * - "사진 연결됨 + DELIVERING"은 같은 키·같은 사진 재전송 또는
 *   PATCH status=DELIVERED(사진 연결이 전제 조건)로 마무리할 수 있다.
 */

/** 서버 multer 한도 (delivery-photos.controller.ts). */
export const DELIVERY_PHOTO_SERVER_MAX_BYTES = 5 * 1024 * 1024;

/** multipart 경계·필드 여유를 남긴 앱 쪽 목표 크기. */
export const DELIVERY_PHOTO_TARGET_MAX_BYTES = 4 * 1024 * 1024;

export type JpegEncodeStep = { maxEdge: number; quality: number };

/** 긴 변·품질을 단계적으로 낮춘다. 앞 단계 결과가 목표 크기를 넘을 때만 다음 단계로 간다. */
export const JPEG_ENCODE_STEPS: readonly JpegEncodeStep[] = [
  { maxEdge: 2048, quality: 0.8 },
  { maxEdge: 1600, quality: 0.7 },
  { maxEdge: 1280, quality: 0.6 },
];

/**
 * 긴 변이 maxEdge를 넘지 않도록 비율을 유지해 줄인 크기. 확대는 하지 않는다.
 * 원본 크기가 올바르지 않으면 null.
 */
export function computeScaledSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } | null {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(maxEdge) ||
    width <= 0 ||
    height <= 0 ||
    maxEdge <= 0
  ) {
    return null;
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 인코딩 결과 크기를 보고 이 결과를 쓸지, 다음 단계로 더 줄일지, 포기할지. */
export function planNextEncodeStep(
  stepIndex: number,
  encodedSize: number,
): 'accept' | 'retry' | 'give-up' {
  if (encodedSize > 0 && encodedSize <= DELIVERY_PHOTO_TARGET_MAX_BYTES) return 'accept';
  return stepIndex + 1 < JPEG_ENCODE_STEPS.length ? 'retry' : 'give-up';
}

export type PhotoEncodeFailureReason = 'DECODE_FAILED' | 'ENCODE_FAILED' | 'TOO_LARGE';

export function photoEncodeFailureMessage(reason: PhotoEncodeFailureReason): string {
  if (reason === 'DECODE_FAILED') return '사진을 읽을 수 없습니다. 다시 선택해주세요.';
  if (reason === 'TOO_LARGE') return '사진 용량을 줄이지 못했습니다. 다시 촬영해주세요.';
  return 'JPEG 사진을 만들 수 없습니다. 다시 시도해주세요.';
}

export type PhotoUploadFailureKind =
  // 결과 불확실: 서버가 처리했을 수 있다. 같은 키·같은 사진으로만 재시도한다.
  | 'NETWORK'
  | 'SERVER'
  | 'ACK_UNCONFIRMED'
  // 확정 거절: 서버가 이 요청을 처리하지 않았다.
  | 'TOO_LARGE'
  | 'STATE_CONFLICT'
  | 'AUTHORITY'
  | 'NOT_FOUND'
  | 'REJECTED';

export type PhotoUploadFailureInput =
  | { kind: 'network' }
  | { kind: 'ack' }
  | { kind: 'http'; status: number; code: string | null };

export function classifyPhotoUploadFailure(input: PhotoUploadFailureInput): PhotoUploadFailureKind {
  if (input.kind === 'network') return 'NETWORK';
  if (input.kind === 'ack') return 'ACK_UNCONFIRMED';
  const { status, code } = input;
  if (status === 413) return 'TOO_LARGE';
  if (status >= 500 || status === 408 || status === 429) return 'SERVER';
  if (status === 401) return 'AUTHORITY';
  if (code === 'DRIVER_ORDER_AUTHORITY_DENIED') return 'AUTHORITY';
  if (code === 'DRIVER_ORDER_NOT_FOUND' || status === 404) return 'NOT_FOUND';
  if (code === 'DRIVER_ORDER_STATE_CONFLICT' && (status === 403 || status === 409)) {
    return 'STATE_CONFLICT';
  }
  // 코드 없는 409: 같은 키에 다른 사진 등 저장소 충돌.
  if (status === 409) return 'STATE_CONFLICT';
  // 코드 없는 403은 기존 기사 명령과 같이 권한 쪽으로 닫는다.
  if (status === 403) return 'AUTHORITY';
  return 'REJECTED';
}

export function isUncertainPhotoUploadFailure(kind: PhotoUploadFailureKind): boolean {
  return kind === 'NETWORK' || kind === 'SERVER' || kind === 'ACK_UNCONFIRMED';
}

/**
 * 이번 업로드에 쓸 멱등 키를 새로 만들지 판단한다.
 * - 키가 없거나 사진이 바뀌었으면(재촬영·다른 파일) 새 키: 같은 키에 다른 사진은 서버가 409로 거절한다.
 * - 직전 실패가 확정 거절(4xx)이면 새 키.
 * - 직전 실패가 불확실(네트워크·5xx·응답 미확인)이면 같은 키: 서버가 이미 처리했을 수 있어
 *   같은 키·같은 사진 재전송만 멱등하게 수렴한다.
 */
export function decideIdempotencyKey(args: {
  hasKey: boolean;
  photoChanged: boolean;
  lastFailure: PhotoUploadFailureKind | null;
}): 'reuse' | 'renew' {
  if (!args.hasKey || args.photoChanged) return 'renew';
  if (args.lastFailure !== null && !isUncertainPhotoUploadFailure(args.lastFailure)) {
    return 'renew';
  }
  return 'reuse';
}

export const PHOTO_UPLOAD_MESSAGES = {
  TOO_LARGE: '사진 용량이 너무 큽니다. 다시 촬영하거나 다른 사진을 선택해주세요.',
  NETWORK: '네트워크 연결이 불안정합니다. 재촬영하지 말고 같은 사진으로 다시 시도해주세요.',
  SERVER: '서버 응답을 확인하지 못했습니다. 재촬영하지 말고 같은 사진으로 다시 시도해주세요.',
  AUTHORITY: '이 주문을 처리할 권한이 없거나 로그인이 만료됐습니다. 다시 로그인한 뒤 확인해주세요.',
  NOT_FOUND: '주문을 찾을 수 없습니다. 판매자 또는 운영팀에 연락해주세요.',
  REJECTED: '사진을 등록하지 못했습니다. 다시 촬영해주세요.',
  STATE_CONFLICT_STUCK:
    '이 주문에는 이미 배송 사진이 연결돼 있어 배송 완료를 마치지 못했습니다. 판매자 또는 운영팀에 연락해주세요.',
  STATUS_CHANGED:
    '주문 상태가 바뀌어 배송 완료를 할 수 없습니다. 주문 화면에서 상태를 확인해주세요.',
  STATUS_UNKNOWN_SUFFIX: ' (주문 상태도 확인하지 못했습니다.)',
} as const;

export function photoUploadFailureMessage(kind: PhotoUploadFailureKind): string {
  switch (kind) {
    case 'TOO_LARGE':
      return PHOTO_UPLOAD_MESSAGES.TOO_LARGE;
    case 'NETWORK':
      return PHOTO_UPLOAD_MESSAGES.NETWORK;
    case 'SERVER':
    case 'ACK_UNCONFIRMED':
      return PHOTO_UPLOAD_MESSAGES.SERVER;
    case 'AUTHORITY':
      return PHOTO_UPLOAD_MESSAGES.AUTHORITY;
    case 'NOT_FOUND':
      return PHOTO_UPLOAD_MESSAGES.NOT_FOUND;
    case 'STATE_CONFLICT':
      return PHOTO_UPLOAD_MESSAGES.STATE_CONFLICT_STUCK;
    default:
      return PHOTO_UPLOAD_MESSAGES.REJECTED;
  }
}

export type PhotoUploadResolution =
  | { action: 'complete' }
  | { action: 'finish-delivery' }
  | { action: 'show'; message: string };

/**
 * 업로드 실패 뒤 주문 상태를 다시 읽은 결과로 다음 행동을 정한다.
 * - DELIVERED: 서버가 이미 완료했다(응답 유실 등) → 성공처럼 보드로.
 * - DELIVERING + 사진 연결 충돌: 사진은 연결됐는데 완료 전이만 빠졌을 수 있다
 *   → 한 번만 PATCH status=DELIVERED로 마무리를 시도한다 (서버는 사진 미연결이면 거절).
 * - DELIVERING + 그 외: 원인별 안내.
 * - 다른 상태: 상태가 바뀌었다는 안내.
 * - 조회 실패(null): 원인별 안내 + 상태 미확인 표시.
 */
export function resolvePhotoUploadFailure(args: {
  failure: PhotoUploadFailureKind;
  orderStatus: string | null;
  finishAttempted: boolean;
}): PhotoUploadResolution {
  const { failure, orderStatus, finishAttempted } = args;
  if (orderStatus === 'DELIVERED') return { action: 'complete' };
  if (orderStatus === null) {
    return {
      action: 'show',
      message: photoUploadFailureMessage(failure) + PHOTO_UPLOAD_MESSAGES.STATUS_UNKNOWN_SUFFIX,
    };
  }
  if (orderStatus !== 'DELIVERING') {
    return { action: 'show', message: PHOTO_UPLOAD_MESSAGES.STATUS_CHANGED };
  }
  if (failure === 'STATE_CONFLICT') {
    return finishAttempted
      ? { action: 'show', message: PHOTO_UPLOAD_MESSAGES.STATE_CONFLICT_STUCK }
      : { action: 'finish-delivery' };
  }
  return { action: 'show', message: photoUploadFailureMessage(failure) };
}

/** 배송 사진 업로드 성공 응답(semantic ACK). */
export function isDeliveryPhotoAck(result: unknown, orderId: string): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const ack = result as { orderId?: unknown; photoId?: unknown; status?: unknown };
  return (
    ack.orderId === orderId &&
    typeof ack.photoId === 'string' &&
    ack.photoId.length > 0 &&
    ack.status === 'DELIVERED'
  );
}

/** 기사 주문 상세 응답에서 같은 주문의 상태만 안전하게 읽는다. */
export function readDriverOrderStatus(payload: unknown, orderId: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const order = payload as { id?: unknown; status?: unknown };
  if (order.id !== orderId || typeof order.status !== 'string') return null;
  return order.status;
}
