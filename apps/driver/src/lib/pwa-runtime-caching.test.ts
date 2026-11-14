import { runtimeCaching as defaultRuntimeCaching } from '@ducanh2912/next-pwa';
import { describe, expect, it } from 'vitest';
import { networkOnlyRuntimeCaching } from '../../next.config';

type Rule = {
  urlPattern: unknown;
  handler: unknown;
  options?: { cacheName?: string };
};

const APP_ORIGIN = 'https://driver.example.test';

/**
 * next-pwa extendDefaultRuntimeCaching와 같은 순서(사용자 규칙 먼저, 같은 cacheName 기본 규칙은 뺀다)로
 * 합친 뒤 workbox 라우터처럼 처음 맞는 규칙을 고른다. 정규식은 다른 출처일 때 맨 앞에서 맞아야 한다.
 */
function mergedRules(): Rule[] {
  const custom = networkOnlyRuntimeCaching as Rule[];
  const names = new Set(custom.map((rule) => rule.options?.cacheName).filter(Boolean));
  const defaults = (defaultRuntimeCaching as Rule[]).filter(
    (rule) => !rule.options?.cacheName || !names.has(rule.options.cacheName),
  );
  return [...custom, ...defaults];
}

function firstMatch(href: string): Rule | undefined {
  const url = new URL(href);
  const sameOrigin = url.origin === APP_ORIGIN;
  const request = new Request(href);
  return mergedRules().find((rule) => {
    if (rule.urlPattern instanceof RegExp) {
      const match = rule.urlPattern.exec(url.href);
      return match !== null && (sameOrigin || match.index === 0);
    }
    if (typeof rule.urlPattern === 'function') {
      return Boolean(rule.urlPattern({ url, request, sameOrigin, event: undefined }));
    }
    return false;
  });
}

const SIGNED_PHOTO =
  'https://storage.googleapis.com/demo.appspot.com/deliveryPhotos/order-1/abc.jpg?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=x&X-Goog-Signature=f00';

describe('서비스워커 런타임 캐시: 배송 사진', () => {
  it.each([
    ['서명 URL(경로형)', SIGNED_PHOTO],
    [
      '서명 URL(버킷 하위 도메인)',
      'https://demo.appspot.com.storage.googleapis.com/deliveryPhotos/order-2/def.jpg?X-Goog-Signature=f01',
    ],
    [
      'Firebase 다운로드 URL',
      'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/deliveryPhotos%2Forder-3_1.jpg?alt=media&token=t',
    ],
    [
      '이미지 최적화 경유',
      `${APP_ORIGIN}/_next/image?url=${encodeURIComponent(SIGNED_PHOTO)}&w=640&q=75`,
    ],
  ])('%s는 기본 cross-origin·이미지 캐시보다 먼저 NetworkOnly에 걸린다', (_label, href) => {
    const rule = firstMatch(href);
    expect(rule?.handler).toBe('NetworkOnly');
    expect(rule?.options?.cacheName).toBe('delivery-photos-network-only');
  });

  it('다른 출처 정적 응답(카카오 프로필 사진)과 같은 출처 정적 이미지는 기본 규칙 그대로다', () => {
    expect(
      firstMatch('https://k.kakaocdn.net/dn/profile/img_640x640.jpg')?.options?.cacheName,
    ).toBe('cross-origin');
    expect(firstMatch(`${APP_ORIGIN}/icons/icon-192x192.png`)?.options?.cacheName).toBe(
      'static-image-assets',
    );
  });
});
