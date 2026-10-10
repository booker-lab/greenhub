// next-pwa가 sw.js에 importScripts로 넣는 사용자 정의 워커다.
// 이전 서비스워커(next-pwa 기본 runtimeCaching)는 교차 출처 API 응답, 같은 출처 /api/*(세션),
// RSC 응답을 Cache Storage에 남겼다. 새 버전이 활성화될 때마다 이 런타임 캐시를 비워
// 이전 사용자 응답이 기기에 남거나 다른 사용자에게 돌아가지 않게 한다.
const STALE_RUNTIME_CACHE_NAMES = ['cross-origin', 'apis', 'pages-rsc', 'pages-rsc-prefetch'];

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all(STALE_RUNTIME_CACHE_NAMES.map((cacheName) => self.caches.delete(cacheName))),
  );
});
