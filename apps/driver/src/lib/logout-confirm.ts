// 로그아웃 확인 문구. 내 정보 화면이 서버에서 기사 목록을 한 번 읽어 배송 중·보류 주문 수를 센다.
// 목록 API가 보여 주는 배송 중·보류 주문은 모두 요청한 기사 본인에게 배정된 주문이다(노출 판정).

export type ActiveDeliverySummary = { delivering: number; held: number };

/** 목록 응답에서 배송 중·보류 주문 수를 센다. 목록이 아니면 null(확인 없이 기존대로 로그아웃). */
export function summarizeActiveDeliveries(payload: unknown): ActiveDeliverySummary | null {
  if (!Array.isArray(payload)) return null;
  let delivering = 0;
  let held = 0;
  for (const order of payload) {
    if (typeof order !== 'object' || order === null) continue;
    const status = (order as { status?: unknown }).status;
    if (status === 'DELIVERING') delivering += 1;
    else if (status === 'DELIVERY_HELD') held += 1;
  }
  return { delivering, held };
}

/** 확인 문구에 이름을 드는 대기 사진 주소 표시 수. 나머지는 "외 n건"으로 줄인다. */
const LISTED_PENDING_PHOTO_LABELS = 2;

/**
 * 올리지 못한 사진 안내 한 문장(S-09). 로그아웃하면 사진이 지워지고 그 배송은 완료되지 않는다는 결과와
 * 할 일을 쓴다. 주소 표시는 앞의 둘까지 쓰고 나머지는 "외 n건"이다(주소를 모르는 사진도 n에 센다).
 * 예: "올리지 못한 사진 3건(101동 1203호, 102동 304호 외 1건)이 지워지고 그 배송은 완료되지 않아요.
 * 신호가 잡힌 뒤 로그아웃해 주세요."
 */
export function pendingPhotoLogoutSentence(labels: readonly (string | null)[]): string | null {
  const count = labels.length;
  if (count === 0) return null;
  const known = labels.filter(
    (label): label is string => typeof label === 'string' && label !== '',
  );
  const listed = known.slice(0, LISTED_PENDING_PHOTO_LABELS);
  const rest = count - listed.length;
  const detail =
    listed.length === 0 ? '' : `(${listed.join(', ')}${rest > 0 ? ` 외 ${rest}건` : ''})`;
  return `올리지 못한 사진 ${count}건${detail}이 지워지고 그 배송은 완료되지 않아요. 신호가 잡힌 뒤 로그아웃해 주세요.`;
}

/**
 * 배송 중·보류 주문이나 올리지 못한 사진(이 기기 사진 업로드 대기열)이 있으면 확인 문구, 없거나 셀 수 없으면 null.
 * 로그아웃은 대기열을 지우므로 사진이 있으면 지워지고 그 배송이 완료되지 않는다고 알린다.
 * pendingPhotoLabels는 올리지 못한 사진마다 주소 표시(모르면 null)다(pendingPhotoLogoutLabels).
 */
export function logoutConfirmMessage(
  summary: ActiveDeliverySummary | null,
  pendingPhotoLabels: readonly (string | null)[] = [],
): string | null {
  const parts: string[] = [];
  if (summary) {
    const { delivering, held } = summary;
    if (delivering > 0 && held > 0) {
      parts.push(`배송 중인 주문 ${delivering}건, 보류 중인 주문 ${held}건이 있어요.`);
    } else if (delivering > 0) {
      parts.push(`배송 중인 주문 ${delivering}건이 있어요.`);
    } else if (held > 0) {
      parts.push(`보류 중인 주문 ${held}건이 있어요.`);
    }
  }
  const photoSentence = pendingPhotoLogoutSentence(pendingPhotoLabels);
  if (photoSentence) parts.push(photoSentence);
  if (parts.length === 0) return null;
  // 사진이 있으면 신호를 기다리라고 권한 뒤 묻는다.
  return `${parts.join(' ')} ${photoSentence ? '그래도 로그아웃할까요?' : '로그아웃할까요?'}`;
}
