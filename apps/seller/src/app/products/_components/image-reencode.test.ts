import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeScaledSize,
  ImageReencodeError,
  LOGO_IMAGE_ENCODE,
  PRODUCT_IMAGE_ENCODE,
  planNextEncodeStep,
  reencodeImageToJpeg,
} from './image-reencode';

describe('computeScaledSize', () => {
  it('긴 변을 maxEdge로 줄이고 비율을 유지한다', () => {
    expect(computeScaledSize(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(computeScaledSize(3000, 4000, 1024)).toEqual({ width: 768, height: 1024 });
  });

  it('작은 사진은 확대하지 않는다', () => {
    expect(computeScaledSize(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });

  it('올바르지 않은 크기는 null이다', () => {
    expect(computeScaledSize(0, 600, 2048)).toBeNull();
    expect(computeScaledSize(Number.NaN, 600, 2048)).toBeNull();
  });
});

describe('planNextEncodeStep', () => {
  it('한도 이하면 받아들이고, 넘으면 다음 단계로, 마지막 단계면 포기한다', () => {
    const max = PRODUCT_IMAGE_ENCODE.maxBytes;
    expect(planNextEncodeStep(0, max, PRODUCT_IMAGE_ENCODE)).toBe('accept');
    expect(planNextEncodeStep(0, max + 1, PRODUCT_IMAGE_ENCODE)).toBe('retry');
    expect(
      planNextEncodeStep(PRODUCT_IMAGE_ENCODE.steps.length - 1, max + 1, PRODUCT_IMAGE_ENCODE),
    ).toBe('give-up');
  });

  it('상품·로고 목표 크기는 Storage 규칙 한도(5MB·2MB)보다 작다', () => {
    expect(PRODUCT_IMAGE_ENCODE.maxBytes).toBeLessThan(5 * 1024 * 1024);
    expect(LOGO_IMAGE_ENCODE.maxBytes).toBeLessThan(2 * 1024 * 1024);
  });
});

describe('reencodeImageToJpeg', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCanvas(sizeFor: (width: number) => number) {
    const drawn: Array<{ width: number; height: number; quality: number }> = [];
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 4000, height: 3000, close })),
    );
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }),
          toBlob: (callback: (blob: Blob | null) => void, type: string, quality: number) => {
            drawn.push({ width: canvas.width, height: canvas.height, quality });
            callback(new Blob([new Uint8Array(sizeFor(canvas.width))], { type }));
          },
        };
        return canvas;
      },
    });
    return { drawn, close };
  }

  it('원본 바이트(EXIF 포함)가 아니라 canvas에서 다시 만든 JPEG를 돌려준다', async () => {
    const { drawn, close } = stubCanvas(() => 1000);
    const original = new Blob([new TextEncoder().encode('\xff\xd8\xff\xe1Exif GPS')], {
      type: 'image/jpeg',
    });

    const result = await reencodeImageToJpeg(original, PRODUCT_IMAGE_ENCODE);

    expect(result).not.toBe(original);
    expect(result.type).toBe('image/jpeg');
    expect(new TextDecoder().decode(await result.arrayBuffer())).not.toContain('Exif');
    expect(drawn).toEqual([{ width: 2048, height: 1536, quality: 0.85 }]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('목표 크기를 넘으면 더 작은 단계로 다시 인코딩한다', async () => {
    const { drawn } = stubCanvas((width) => (width > 1600 ? 5 * 1024 * 1024 : 1000));

    const result = await reencodeImageToJpeg(new Blob(['x']), PRODUCT_IMAGE_ENCODE);

    expect(result.size).toBe(1000);
    expect(drawn.map((step) => step.width)).toEqual([2048, 1600]);
  });

  it('마지막 단계도 목표 크기를 넘으면 TOO_LARGE로 실패한다', async () => {
    const { close } = stubCanvas(() => 3 * 1024 * 1024);

    await expect(reencodeImageToJpeg(new Blob(['x']), LOGO_IMAGE_ENCODE)).rejects.toMatchObject({
      reason: 'TOO_LARGE',
    });
    await expect(reencodeImageToJpeg(new Blob(['x']), LOGO_IMAGE_ENCODE)).rejects.toBeInstanceOf(
      ImageReencodeError,
    );
    expect(close).toHaveBeenCalledTimes(2);
  });
});

describe('판매자 업로드 배선', () => {
  const imageUpload = readFileSync(new URL('./ImageUpload.tsx', import.meta.url), 'utf8');
  const onboarding = readFileSync(new URL('../../onboarding/page.tsx', import.meta.url), 'utf8');

  it('상품 사진은 재인코딩한 JPEG만 업로드하고 원본 파일명을 경로에 쓰지 않는다', () => {
    expect(imageUpload).toContain('reencodeImageToJpeg(file, PRODUCT_IMAGE_ENCODE)');
    expect(imageUpload).toContain("uploadBytes(r, jpeg, { contentType: 'image/jpeg' })");
    expect(imageUpload).not.toMatch(/uploadBytes\(r, file/);
    expect(imageUpload).not.toContain('file.name}');
  });

  it('매장 로고는 재인코딩한 JPEG만 업로드한다', () => {
    expect(onboarding).toContain('reencodeImageToJpeg(file, LOGO_IMAGE_ENCODE)');
    expect(onboarding).toContain("uploadBytes(storageRef, jpeg, { contentType: 'image/jpeg' })");
    expect(onboarding).not.toMatch(/uploadBytes\(storageRef, file/);
  });
});
