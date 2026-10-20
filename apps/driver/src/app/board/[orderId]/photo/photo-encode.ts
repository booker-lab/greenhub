import {
  computeScaledSize,
  JPEG_ENCODE_STEPS,
  type PhotoEncodeFailureReason,
  planNextEncodeStep,
} from './photo-upload-policy';

export class PhotoEncodeError extends Error {
  readonly reason: PhotoEncodeFailureReason;

  constructor(reason: PhotoEncodeFailureReason) {
    super(reason);
    this.name = 'PhotoEncodeError';
    this.reason = reason;
  }
}

export type DecodedPhoto = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

/** 디코드 없이 머리 정보만 읽어 사진 크기를 얻는다. 읽지 못하면 null. */
async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('IMAGE_SIZE_UNREADABLE'));
      image.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 원본 해상도로 디코드하지 않도록 긴 변을 첫 인코딩 단계 크기로 줄여 디코드할 옵션.
 * 한 변만 지정해 비율은 브라우저가 유지한다. 두 변이 모두 목표보다 클 때만 줄이므로
 * 방향(EXIF) 적용 순서가 브라우저마다 달라도 확대되거나 찌그러지지 않는다.
 */
async function decodeResizeOptions(file: Blob): Promise<ImageBitmapOptions> {
  const maxEdge = JPEG_ENCODE_STEPS[0].maxEdge;
  const size = await readImageSize(file);
  if (!size || Math.min(size.width, size.height) <= maxEdge) return {};
  return size.width >= size.height
    ? { resizeWidth: maxEdge, resizeQuality: 'high' }
    : { resizeHeight: maxEdge, resizeQuality: 'high' };
}

/** 파일 선택 사진을 그릴 수 있는 형태로 연다. 촬영 방향(EXIF)을 반영한다. */
export async function loadImageSource(file: Blob): Promise<DecodedPhoto> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
        ...(await decodeResizeOptions(file)),
      });
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
    throw new PhotoEncodeError('DECODE_FAILED');
  }
}

function toJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
}

/**
 * 카메라 프레임·선택 사진을 같은 경로로 축소·JPEG 재인코딩한다.
 * 긴 변·품질을 단계적으로 낮추며 목표 크기 이하가 되면 멈춘다.
 */
export async function encodeDeliveryJpeg(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): Promise<Blob> {
  for (let stepIndex = 0; stepIndex < JPEG_ENCODE_STEPS.length; stepIndex += 1) {
    const step = JPEG_ENCODE_STEPS[stepIndex];
    const size = computeScaledSize(sourceWidth, sourceHeight, step.maxEdge);
    if (!size) throw new PhotoEncodeError('DECODE_FAILED');

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new PhotoEncodeError('ENCODE_FAILED');
    context.drawImage(source, 0, 0, size.width, size.height);
    const nextBlob = await toJpegBlob(canvas, step.quality);
    // 큰 캔버스 메모리를 바로 돌려준다(모바일 메모리 한도).
    canvas.width = 0;
    canvas.height = 0;

    if (!nextBlob || nextBlob.type !== 'image/jpeg' || nextBlob.size <= 0) {
      throw new PhotoEncodeError('ENCODE_FAILED');
    }
    const plan = planNextEncodeStep(stepIndex, nextBlob.size);
    if (plan === 'accept') return nextBlob;
    if (plan === 'give-up') break;
  }
  throw new PhotoEncodeError('TOO_LARGE');
}
