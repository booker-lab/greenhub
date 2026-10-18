'use client';

import { REVIEW_PHOTO_MAX_BYTES } from '@greenhub/shared';
import {
  computeScaledSize,
  planReviewPhotoEncode,
  REVIEW_PHOTO_ENCODE_STEPS,
  reviewPhotoTargetBytes,
} from '@/lib/review-photo';

// 고른 사진을 JPEG로 다시 그려 올린다. 다시 그리면 위치·기기 정보(EXIF)가 빠지고 크기도 줄어든다.
// 서버도 형식·크기를 다시 확인하고 메타데이터를 한 번 더 지운다.

export class ReviewPhotoEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewPhotoEncodeError';
  }
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // 일부 브라우저는 옵션이나 형식을 지원하지 않는다 → img로 대체.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new ReviewPhotoEncodeError('사진을 읽지 못했어요. 다른 사진을 골라 주세요.');
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function encodeReviewPhoto(file: Blob): Promise<Blob> {
  const decoded = await decode(file);
  const target = reviewPhotoTargetBytes(REVIEW_PHOTO_MAX_BYTES);
  try {
    for (let index = 0; index < REVIEW_PHOTO_ENCODE_STEPS.length; index += 1) {
      const step = REVIEW_PHOTO_ENCODE_STEPS[index];
      const size = computeScaledSize(decoded.width, decoded.height, step.maxEdge);
      if (!size) throw new ReviewPhotoEncodeError('사진을 읽지 못했어요. 다른 사진을 골라 주세요.');
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) throw new ReviewPhotoEncodeError('사진을 준비하지 못했어요.');
      context.drawImage(decoded.source, 0, 0, size.width, size.height);
      const blob = await toJpeg(canvas, step.quality);
      // 큰 캔버스 메모리를 바로 돌려준다(모바일 메모리 한도).
      canvas.width = 0;
      canvas.height = 0;
      if (!blob || blob.type !== 'image/jpeg')
        throw new ReviewPhotoEncodeError('사진을 준비하지 못했어요.');
      const plan = planReviewPhotoEncode(index, blob.size, target);
      if (plan === 'accept') return blob;
      if (plan === 'give-up') break;
    }
  } finally {
    decoded.release();
  }
  throw new ReviewPhotoEncodeError('사진 용량을 줄이지 못했어요. 다른 사진을 골라 주세요.');
}
