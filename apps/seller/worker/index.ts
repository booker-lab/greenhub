import { registerRoute } from 'workbox-routing'
import { NetworkOnly, NetworkFirst } from 'workbox-strategies'

// Firestore WebChannel 스트리밍 요청은 캐시 불가 — NetworkOnly로 처리
registerRoute(
  ({ url }) => url.hostname === 'firestore.googleapis.com',
  new NetworkOnly(),
)

// 배포마다 해시가 바뀌는 JS 청크는 NetworkFirst — 구 캐시로 인한 HTML 404 수신 방지
registerRoute(
  ({ url }) => url.pathname.startsWith('/_next/static/chunks/'),
  new NetworkFirst(),
)
