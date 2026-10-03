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

/** 파일 선택 사진을 그릴 수 있는 형태로 연다. 촬영 방향(EXIF)을 반영한다. */
export async function loadImageSource(file: Blob): Promise<DecodedPhoto> {
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
