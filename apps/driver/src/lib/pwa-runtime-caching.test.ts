import { runtimeCaching as defaultRuntimeCaching } from '@ducanh2912/next-pwa';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { networkOnlyRuntimeCaching, pwaFallbacks } from '../../next.config';

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

describe('서비스워커 오프라인 대체 문서(S-01)', () => {
  const offlinePageSource = readFileSync(
    new URL('../app/~offline/page.tsx', import.meta.url),
    'utf8',
  );
  const reopenSource = readFileSync(
    new URL('../app/~offline/reopen-button.tsx', import.meta.url),
    'utf8',
  );

  it('신호 없이 문서를 받지 못하면 /~offline을 보이고, 로그인 검사 화면은 그대로 NetworkOnly다', () => {
    expect(pwaFallbacks).toEqual({ document: '/~offline' });
    for (const path of ['/board', '/board/order-1', '/board/order-1/photo', '/map', '/profile']) {
      const rule = firstMatch(`${APP_ORIGIN}${path}`);
      expect(rule?.handler, path).toBe('NetworkOnly');
      expect(rule?.options?.cacheName, path).toBe('driver-protected-pages-network-only');
    }
    // 대체 문서는 로그인 검사 경로가 아니다(설치 때 미리 받는 문서에 세션이 실리지 않는다).
    expect(/^\/(?:board|map|profile)(?:\/|$)/.test(pwaFallbacks.document)).toBe(false);
  });

  it('대체 문서는 주문·손님 정보나 세션을 읽지 않는 고정 문구다', () => {
    const text = offlinePageSource.replace(/\s+/g, ' ');
    expect(text).toContain('신호가 없어요.');
    expect(text).toContain('사진은 휴대폰에 저장돼 있어요. 신호가 잡히면 앱을 다시 열어 주세요.');
    for (const source of [offlinePageSource, reopenSource]) {
      expect(source).not.toMatch(
        /@\/lib\/api|auth\(|useSession|getSession|headers\(|cookies\(|fetch\(/,
      );
    }
    expect(reopenSource).toMatch(/window\.location\.reload\(\)/);
  });
});
