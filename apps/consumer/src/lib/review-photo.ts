// 후기 사진 고르기·줄이기의 순수 판단. 다른 모듈을 런타임에 불러오지 않아 node:test가 그대로 실행한다.
// 한도 값(장 수·바이트)은 부르는 쪽이 @greenhub/shared의 REVIEW_PHOTO_* 상수로 넘긴다.

export type ReviewPhotoEncodeStep = { maxEdge: number; quality: number };

/** 긴 변·품질을 단계적으로 낮춘다(기사 앱 배송 사진과 같은 방식). */
export const REVIEW_PHOTO_ENCODE_STEPS: readonly ReviewPhotoEncodeStep[] = [
  { maxEdge: 1600, quality: 0.8 },
  { maxEdge: 1280, quality: 0.7 },
  { maxEdge: 1024, quality: 0.6 },
];

/** 서버 한도보다 조금 작게 줄여 multipart 여유를 남긴다. */
export function reviewPhotoTargetBytes(serverMaxBytes: number): number {
  return Math.floor(serverMaxBytes * 0.8);
}

/** 긴 변이 maxEdge를 넘지 않게 비율을 유지해 줄인 크기. 확대하지 않는다. 크기가 이상하면 null. */
export function computeScaledSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } | null {
  if (![width, height, maxEdge].every((value) => Number.isFinite(value) && value > 0)) return null;
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 인코딩 결과를 쓸지, 더 줄일지, 포기할지. */
export function planReviewPhotoEncode(
  stepIndex: number,
  encodedSize: number,
  targetBytes: number,
): 'accept' | 'retry' | 'give-up' {
  if (encodedSize > 0 && encodedSize <= targetBytes) return 'accept';
  return stepIndex + 1 < REVIEW_PHOTO_ENCODE_STEPS.length ? 'retry' : 'give-up';
}

/**
 * 새로 고른 파일 중 담을 것을 정한다. 이미지가 아닌 파일은 빼고, 남은 자리만큼만 담는다.
 * 담지 못한 파일이 있으면 안내 문구를 돌려준다.
 */
export function selectReviewPhotos<T extends { type: string }>(
  currentCount: number,
  picked: readonly T[],
  maxCount: number,
): { accepted: T[]; message: string | null } {
  const images = picked.filter((file) => file.type.startsWith('image/'));
  const room = Math.max(0, maxCount - currentCount);
  const accepted = images.slice(0, room);
  if (images.length < picked.length) return { accepted, message: '사진 파일만 올릴 수 있어요.' };
  if (accepted.length < images.length)
    return { accepted, message: `사진은 ${maxCount}장까지 올릴 수 있어요.` };
  return { accepted, message: null };
}

/** 쓴 후기에 사진을 더할 수 있는지(숨겨진 후기는 서버도 거절한다). */
export function canAddReviewPhotos(
  review: { hidden?: boolean; photoUrls?: readonly string[] },
  maxCount: number,
): boolean {
  return review.hidden !== true && (review.photoUrls?.length ?? 0) < maxCount;
}
