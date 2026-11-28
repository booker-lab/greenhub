import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { pwaOptions } from '../../next.config';

type Rule = {
  urlPattern: unknown;
  handler: unknown;
  options?: { cacheName?: string };
};

const APP_ORIGIN = 'https://seller.example.test';

/** workbox 라우터처럼 처음 맞는 규칙을 고른다. 정규식은 다른 출처일 때 맨 앞에서 맞아야 한다. */
function firstMatch(href: string): Rule | undefined {
  const url = new URL(href);
  const sameOrigin = url.origin === APP_ORIGIN;
  return (pwaOptions.workboxOptions.runtimeCaching as Rule[]).find((rule) => {
    if (typeof rule.urlPattern === 'string') {
      return url.href === new URL(rule.urlPattern, APP_ORIGIN).href;
    }
    if (rule.urlPattern instanceof RegExp) {
      const match = rule.urlPattern.exec(url.href);
      return match !== null && (sameOrigin || match.index === 0);
    }
    if (typeof rule.urlPattern === 'function') {
      return Boolean(rule.urlPattern({ url, request: new Request(href), sameOrigin }));
    }
    return false;
  });
}

describe('서비스워커 런타임 캐시: 판매자 세션이 실린 화면 문서', () => {
  it('next-pwa 첫 화면(start-url) 캐시를 두 값 모두 꺼서 끈다', () => {
    // next-pwa 10.2.9는 dynamicStartUrl(기본 true)만으로 '/' NetworkFirst "start-url" 규칙과 화면 이동 때
    // fetch('/') 저장 코드를 넣고, dynamicStartUrl을 끈 채 cacheStartUrl(기본 true)이 남으면 '/' 문서를
    // precache한다. 둘 다 false여야 '/' 문서(세션·API 토큰 포함)가 Cache Storage에 남지 않는다.
    expect(pwaOptions.cacheStartUrl).toBe(false);
    expect(pwaOptions.dynamicStartUrl).toBe(false);
  });

  it('기본 runtimeCaching("pages"·"pages-rsc" 등 문서 캐시)을 다시 붙이지 않는다', () => {
    expect(
      (pwaOptions as { extendDefaultRuntimeCaching?: boolean }).extendDefaultRuntimeCaching,
    ).not.toBe(true);
  });

  // 이 시험은 사용자 정의 runtimeCaching만 본다. '/' "start-url" 규칙은 next-pwa가 빌드 때 넣으므로
  // 여기로는 잡히지 않고, 그 회귀는 위의 cacheStartUrl·dynamicStartUrl 단언이 막는다
  // (빌드 결과 확인: public/sw.js에 "start-url"이 없어야 한다).
  it.each([
    '/',
    '/orders',
    '/orders/abc',
    '/settings',
    '/admin/stores',
    '/onboarding',
    '/?_rsc=a1',
    '/orders?_rsc=b2',
  ])('%s 문서·RSC 응답은 캐시하는 규칙에 걸리지 않는다', (path) => {
    const rule = firstMatch(`${APP_ORIGIN}${path}`);
    expect(rule === undefined || rule.handler === 'NetworkOnly').toBe(true);
  });

  it('JS 청크는 기존 NetworkFirst 규칙을 따르고 Firestore 요청은 캐시하지 않는다', () => {
    expect(firstMatch(`${APP_ORIGIN}/_next/static/chunks/main.js`)?.handler).toBe('NetworkFirst');
    const firestore = firstMatch(
      'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel',
    );
    expect(firestore === undefined || firestore.handler === 'NetworkOnly').toBe(true);
  });
});

type Listener = (event: Record<string, unknown>) => void;

async function loadWorker() {
  const source = await readFile(new URL('../../worker/index.js', import.meta.url), 'utf8');
  const listeners = new Map<string, Listener>();
  const deleted: string[] = [];
  const self = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    caches: {
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    },
  };
  vm.runInNewContext(source, { self });
  return { listeners, deleted };
}

async function dispatch(listener: Listener | undefined, extra: Record<string, unknown> = {}) {
  if (!listener) throw new Error('listener missing');
  const pending: Promise<unknown>[] = [];
  listener({ ...extra, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
  await Promise.all(pending);
  return pending.length;
}

describe('사용자 정의 워커(worker/index.js): 이전 "start-url" 캐시 정리', () => {
  it('새 서비스워커 활성화 때 이전 버전이 남긴 "start-url" 캐시를 지운다', async () => {
    const { listeners, deleted } = await loadWorker();
    expect(await dispatch(listeners.get('activate'))).toBe(1);
    expect(deleted).toEqual(['start-url']);
  });

  it('새로고침하지 않은 이전 화면이 다시 저장한 항목은 다음 페이지 이동 때 지우고, 다른 요청에서는 지우지 않는다', async () => {
    const { listeners, deleted } = await loadWorker();
    const fetchListener = listeners.get('fetch');
    for (const mode of ['cors', 'no-cors', 'same-origin']) {
      expect(await dispatch(fetchListener, { request: { mode, url: `${APP_ORIGIN}/` } })).toBe(0);
    }
    expect(deleted).toEqual([]);

    const navigation = { mode: 'navigate', url: `${APP_ORIGIN}/login` };
    expect(await dispatch(fetchListener, { request: navigation })).toBe(1);
    expect(deleted).toEqual(['start-url']);
  });
});
