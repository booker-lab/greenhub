import { registerRoute } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'

// Firestore WebChannel 스트리밍 요청은 캐시 불가 — NetworkOnly로 처리
registerRoute(
  ({ url }) => url.hostname === 'firestore.googleapis.com',
  new NetworkOnly(),
)
