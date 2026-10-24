// next-pwa가 sw.js에 importScripts로 넣는 사용자 정의 워커다.
// 로그인 검사 화면(/board·/map·/profile)의 문서·RSC 응답에는 루트 layout이 넘긴 세션(API 토큰
// 포함)이 실린다. 새 워커는 이 경로를 NetworkOnly로 두지만, 이전 워커(next-pwa 기본
// runtimeCaching)는 같은 응답을 "pages" 계열 캐시에 남겼고 NetworkOnly 규칙은 이미 남은 항목을
// 지우지 않는다. 그래서 활성화 때 이 경로 항목만 지우고, 이전 워커가 활성화 직후까지 붙잡고 있던
// 요청이 늦게 쓴 항목은 이후 보호 경로 요청 때마다 다시 지운다. 공개 화면 항목은 그대로 둔다.
const PAGE_CACHE_NAMES = ['pages', 'pages-rsc', 'pages-rsc-prefetch'];
const PROTECTED_PATH = /^\/(?:board|map|profile)(?:\/|$)/;

function isProtectedUrl(href) {
  const url = new URL(href);
  return url.origin === self.location.origin && PROTECTED_PATH.test(url.pathname);
}

async function purgeProtectedPageEntries() {
  await Promise.all(
    PAGE_CACHE_NAMES.map(async (cacheName) => {
      // caches.open은 없는 캐시를 새로 만들므로 있는 캐시만 연다.
      if (!(await self.caches.has(cacheName))) return;
      const cache = await self.caches.open(cacheName);
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter((request) => isProtectedUrl(request.url))
          // Next 응답은 RSC 헤더 등으로 Vary가 걸려 있어, 저장 때 헤더와 무관하게 URL로 지운다.
          .map((request) => cache.delete(request, { ignoreVary: true })),
      );
    }),
  );
}

self.addEventListener('activate', (event) => {
  event.waitUntil(purgeProtectedPageEntries());
});

// 응답은 workbox 라우트가 만든다. 여기서는 respondWith 없이 정리만 이어 붙인다.
self.addEventListener('fetch', (event) => {
  if (isProtectedUrl(event.request.url)) event.waitUntil(purgeProtectedPageEntries());
});
