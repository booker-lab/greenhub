/**
 * 판매자가 고른 사진을 업로드 전에 canvas로 다시 그려 JPEG로 저장한다.
 * 다시 그린 픽셀만 남기므로 원본의 EXIF(촬영 위치·기기 정보 등) 메타데이터가 업로드되지 않는다.
 * 촬영 방향은 디코딩 단계에서 반영한 뒤 버린다.
 *
 * 기사 앱의 배송 사진 인코더(apps/driver/.../photo/photo-encode.ts)와 같은 방식이다.
 */

export type JpegEncodeStep = { maxEdge: number; quality: number };

export type ReencodeOptions = {
  /** 긴 변·품질을 단계적으로 낮춘다. 앞 단계 결과가 maxBytes를 넘을 때만 다음 단계로 간다. */
  steps: readonly JpegEncodeStep[];
  maxBytes: number;
};

/** 상품 사진: Storage 규칙 5MB 한도 안에서 여유를 둔다. */
export const PRODUCT_IMAGE_ENCODE: ReencodeOptions = {
  steps: [
    { maxEdge: 2048, quality: 0.85 },
    { maxEdge: 1600, quality: 0.8 },
    { maxEdge: 1280, quality: 0.7 },
  ],
  maxBytes: 4 * 1024 * 1024,
};

/** 매장 로고: Storage 규칙 2MB 한도 안에서 여유를 둔다. */
export const LOGO_IMAGE_ENCODE: ReencodeOptions = {
  steps: [
    { maxEdge: 1024, quality: 0.9 },
    { maxEdge: 768, quality: 0.8 },
    { maxEdge: 512, quality: 0.7 },
  ],
  maxBytes: 1.5 * 1024 * 1024,
};

export type ImageReencodeFailureReason = 'DECODE_FAILED' | 'ENCODE_FAILED' | 'TOO_LARGE';

export class ImageReencodeError extends Error {
  readonly reason: ImageReencodeFailureReason;

  constructor(reason: ImageReencodeFailureReason) {
    super(reason);
    this.name = 'ImageReencodeError';
    this.reason = reason;
  }
}

export function imageReencodeFailureMessage(reason: ImageReencodeFailureReason): string {
  if (reason === 'DECODE_FAILED') return '사진을 읽을 수 없습니다. 다른 사진을 선택해주세요.';
  if (reason === 'TOO_LARGE') return '사진 용량을 줄이지 못했습니다. 다른 사진을 선택해주세요.';
  return '사진을 변환하지 못했습니다. 다시 시도해주세요.';
}

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
  options: ReencodeOptions,
): 'accept' | 'retry' | 'give-up' {
  if (encodedSize > 0 && encodedSize <= options.maxBytes) return 'accept';
  return stepIndex + 1 < options.steps.length ? 'retry' : 'give-up';
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

/** 파일 선택 사진을 그릴 수 있는 형태로 연다. 촬영 방향(EXIF)을 반영한다. */
async function loadImageSource(file: Blob): Promise<DecodedImage> {
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
      // 일부 브라우저는 옵션이나 Blob 입력을 지원하지 않는다 → img로 대체.
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
    throw new ImageReencodeError('DECODE_FAILED');
  }
}

function toJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
}

/** 사진을 다시 그려 메타데이터 없는 JPEG Blob으로 만든다. */
export async function reencodeImageToJpeg(file: Blob, options: ReencodeOptions): Promise<Blob> {
  const decoded = await loadImageSource(file);
  try {
    for (let stepIndex = 0; stepIndex < options.steps.length; stepIndex += 1) {
      const step = options.steps[stepIndex];
      const size = computeScaledSize(decoded.width, decoded.height, step.maxEdge);
      if (!size) throw new ImageReencodeError('DECODE_FAILED');

      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) throw new ImageReencodeError('ENCODE_FAILED');
      // JPEG에는 투명도가 없으므로 투명한 PNG·WebP 배경을 흰색으로 채운다.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(decoded.source, 0, 0, size.width, size.height);
      const blob = await toJpegBlob(canvas, step.quality);
      // 큰 캔버스 메모리를 바로 돌려준다(모바일 메모리 한도).
      canvas.width = 0;
      canvas.height = 0;

      if (!blob || blob.type !== 'image/jpeg' || blob.size <= 0) {
        throw new ImageReencodeError('ENCODE_FAILED');
      }
      const plan = planNextEncodeStep(stepIndex, blob.size, options);
      if (plan === 'accept') return blob;
      if (plan === 'give-up') break;
    }
    throw new ImageReencodeError('TOO_LARGE');
  } finally {
    decoded.release();
  }
}
