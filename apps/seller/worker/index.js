// next-pwa가 sw.js에 importScripts로 넣는 사용자 정의 워커다.
// 이전 서비스워커와 화면 코드(next-pwa 기본 start-url 설정)는 첫 화면('/') 문서를 "start-url" 캐시에
// 남겼다. 이 문서에는 루트 layout이 넘긴 판매자 세션(API 토큰·이름·이메일·가게 ID)이 실려 로그아웃
// 뒤에도 기기에 남고, 오프라인에서는 그대로 돌려줬다. 새 버전은 이 설정을 끄므로(next.config.ts)
// 활성화 때 남은 캐시를 지운다. 새로고침하지 않은 이전 화면이 활성화 뒤 다시 저장한 항목은
// 다음 페이지 이동(로그아웃 뒤 /login 이동 포함) 때 다시 지운다.
const STALE_RUNTIME_CACHE_NAMES = ['start-url'];

function deleteStaleRuntimeCaches() {
  return Promise.all(STALE_RUNTIME_CACHE_NAMES.map((cacheName) => self.caches.delete(cacheName)));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(deleteStaleRuntimeCaches());
});

// 응답은 workbox 라우트(또는 네트워크)가 만든다. 여기서는 respondWith 없이 정리만 이어 붙인다.
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.waitUntil(deleteStaleRuntimeCaches());
});
