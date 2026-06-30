# Critical Logic archive 20260516 part 02

> 원본: $Path에서 2026-06-29 문서 정리 시 분리.

---

## [2026-03-25] 백엔드 아키텍처 확정

### 결정: NestJS (Layered Architecture) + Firestore 혼합

**선택지 비교**

| 항목 | Option A: Next.js API Routes | Option B: NestJS (채택) |
|------|------------------------------|------------------------|
| 비즈니스 로직 위치 | 3개 앱에 분산 | NestJS 단일 집중 |
| 주문 도메인 일관성 | 앱마다 다르게 구현될 위험 | 단일 Service로 보장 |
| Daily Cap 동시성 | 각 앱 API Routes에서 개별 처리 | NestJS 트랜잭션으로 처리 |
| 다중 판매자 확장 | 앱 전체 수정 필요 | NestJS 모듈 추가만으로 대응 |
| 배포 비용 | Vercel 무료 | +Railway $5/월 |

**채택 이유**

소비자·판매자·드라이버 세 앱이 동일한 `orders` 도메인을 공유한다.
주문 상태 전환·결제 검증·공동구매 자동 환불·Daily Cap 동시성 처리 등
핵심 비즈니스 로직이 복잡하고, 이를 3개 앱의 API Routes에 분산하면
나중에 혼자 유지보수하기 어렵다. 처음부터 NestJS로 통합하는 것이
나중에 마이그레이션하는 비용보다 훨씬 낮다.

**DDD 미적용 이유**

NestJS Layered Architecture(Controller → Service → Repository)만으로 충분.
DDD 풀세트(Entity·ValueObject·Aggregate·DomainService·Mapper)는
혼자 개발하는 MVP에서 오버엔지니어링이며, 500라인 제한(CLAUDE.md)과도 충돌한다.

---

## [2026-03-25] 모노레포 구조 확정

### 결정: pnpm workspace 모노레포

```
greenhub/
├── packages/
│   └── shared/          ← OrderStatus, Product, Store 등 공통 타입·상수
├── apps/
│   ├── consumer/        ← Next.js 15 (소비자 PWA)
│   ├── seller/          ← Next.js 15 (판매자 앱)
│   ├── driver/          ← Next.js 15 (드라이버 앱)
│   └── api/             ← NestJS (비즈니스 로직 전담)
└── pnpm-workspace.yaml
```

**채택 이유**

`OrderStatus` 타입이 세 앱에서 다르게 정의되면 Firestore 실시간 리스너 오작동.
`packages/shared`에 단일 정의 후 세 앱이 import하는 구조로 타입 불일치를 원천 차단.

---

## [2026-03-25] 공동구매 결제·취소·환불 정책 확정

### 결제 시점
- **즉시 결제 (Option A)** 채택 — 참여 즉시 Portone으로 실제 청구
- Pre-auth(사전 승인) 미적용 — 카카오페이·네이버페이가 pre-auth 미지원

### 취소 가능 구간
| 구간 | 취소 | 환불 |
|------|------|------|
| RECRUITING | 가능 | 즉시 처리 (Portone 환불 API) |
| CONFIRMED 이후 | **불가** | 불가 |

### CONFIRMED 이후 취소 불가 이유
CONFIRMED는 계약 성립 시점 — 판매자가 생산/조달 시작. 단일 취소가 `currentParticipants < minParticipants`를 유발해 전체 참여자에 영향.

### 법적 동의 수령 (전자상거래법 제17조)
참여 전 "확정 이후 취소 불가" 동의 체크박스 + Firestore `groupBuyConsent` 기록:
```ts
groupBuyConsent: { agreed: true, agreedAt: Timestamp, userId: string }
```

### 동의 수령 위치 (와이어프레임 반영)
1. `GroupBuyOptionSheet` — "확정 이후 취소·환불 불가" 체크박스 (미체크 시 버튼 비활성)
2. `checkout/group` — 약관 동의 문구 구체화

### 알림톡 발송 시점
| 트리거 | 수신자 |
|--------|--------|
| RECRUITING → CONFIRMED | 전체 참여자 |
| RECRUITING → CANCELLED (기간 만료) | 전체 참여자 (+ 자동 환불 안내) |
| CONFIRMED → PREPARING | 전체 참여자 |
| PREPARING → DELIVERING | 전체 참여자 |
개인 취소(RECRUITING 중) → 본인 UI만, 타 참여자 알림 없음

---

## [2026-03-25] 실시간 데이터 전략 확정

### 결정: Firestore 직접 리스너 유지 (단, 결제 완료 화면 예외)

| 데이터 | 방식 |
|--------|------|
| 주문 상태 변경 (결제 완료 화면) | **Firestore REST API 폴링 3초** ← [2026-03-27] 변경 |
| 공동구매 참여 인원 (`currentParticipants`) | Firestore 실시간 리스너 |
| Daily Cap 잔여량 (`usedSlots`) | Firestore 실시간 리스너 |
| 결제 검증·환불·알림 | NestJS API |

WebSocket·Redis·SSE 별도 구성 없음. Firestore가 실시간 채널 역할 전담.
NestJS Repository 추상화 없이 Firestore SDK 직접 사용 (이중 추상화 불필요).

### [2026-03-27] useOrderStatus: onSnapshot → REST API 폴링 변경

**원인**: PWA Service Worker(`@ducanh2912/next-pwa`)가 Firebase SDK의 내부 HTTP/2 스트리밍 요청을 가로채 응답하지 않음. `onSnapshot`, `getDoc` 모두 동일하게 실패. Firestore REST API 직접 `fetch()`는 정상 동작 확인.

**결정**: `/order/success` 페이지의 `useOrderStatus`는 Firebase SDK 대신 `https://firestore.googleapis.com/v1/...` REST API를 직접 호출하는 3초 폴링으로 대체. 결제 완료 화면은 밀리초 단위 실시간이 불필요하므로 UX 영향 없음.

**향후**: PWA Service Worker에 Firebase URL 예외 처리 추가 시 `onSnapshot` 복구 가능.

---

## [2026-03-26] 4단계 정합성 검토 미해결 백로그

### 🔴 Critical — apps/api 보완 필요 (Step 4 완료 후 일괄 처리)

| # | 엔드포인트 | 파일 | 조치 |
|---|-----------|------|------|
| C-1 | `PATCH /stores/:storeId/products/:id/active` | `products.controller.ts` | ✅ 2026-03-26 완료 |
| C-2 | `PATCH /stores/:storeId/orders/:id/review` | `orders.controller.ts` | ✅ 2026-03-26 완료 |
| C-3 | `GET /stores/:storeId/daily-caps` | `products.controller.ts` | ✅ 2026-03-26 완료 |
| C-4 | `PATCH /stores/:storeId/daily-caps/:date` | `products.controller.ts` | ✅ 2026-03-26 완료 |

### 🟡 Warning — Step 5 전 보완

| # | 항목 | 파일 | 조치 |
|---|------|------|------|
| W-1 | `GET /notifications/me` | `notifications.controller.ts` | ✅ 2026-03-26 완료 |
| W-2 | `PATCH /notifications/me/preferences` | `notifications.controller.ts` | ✅ 2026-03-26 완료 |
| W-3 | `GET /payments/:paymentId` | `payments.controller.ts` | ✅ 2026-03-26 완료 |
| W-4 | `GET /stores/:storeId/orders/:id/payment` | `payments.controller.ts` | ✅ 2026-03-26 완료 |
| W-5 | Kakao/Naver OAuth Provider | `apps/consumer/src/auth.ts` | ⏸ 키 발급 후 주석 해제 (스켈레톤 추가됨) |
| W-6 | Firestore Timestamp → ISO8601 직렬화 | `src/common/interceptors/timestamp.interceptor.ts` | ✅ 2026-03-26 전역 인터셉터로 완료 |

---

## [2026-03-27] 2차 정합성 검토 — Vercel 배포 후

| # | 등급 | 항목 | 파일 | 조치 |
|---|------|------|------|------|
| C-1 | 🔴 Critical | PWA 아이콘 누락 | `public/icons/*.png` | ✅ 192x192, 512x512 생성 완료 |
| M-1 | 🟡 Major | `portonePaymentParams.buyerName`에 userId 사용 | `orders.service.ts` | ✅ users Firestore 조회 후 name 사용으로 수정 |
| m-1 | 🟢 Minor | 상품 조회 API 미사용 (Firestore 직접 접근) | Consumer hooks | 설계 의도대로 — Firestore 직접 접근 유지 |
| m-2 | 🟢 Minor | `/auth/me` 미사용 | Consumer | 향후 프로필 갱신 기능 추가 시 활용 |
| m-3 | 🟢 Minor | `/notifications/*` 미사용 | Consumer | 알림 기능 구현 시 사용 예정 |

---

## [2026-03-28] 5차 정합성 검토 — seller 설계 문서 ↔ 전체 spec 교차 검증

### 수정 완료

| # | 등급 | 항목 | 파일 | 조치 |
|---|------|------|------|------|
| C-1 | 🔴 Critical | `products.md` stores 스키마 — 판매자 프로필 7개 필드 누락 (businessNumber 등) | `docs/specs/products.md`, `docs/소비자 설계 - 1단계 요구사항 정의.md` | ✅ 두 문서 모두 확장 필드 반영 |
| C-2 | 🔴 Critical | `orders.md` + shared 타입 — `preparedAt` 필드 누락 | `docs/specs/orders.md` | ✅ 스키마 + Order 인터페이스에 `preparedAt: string | null` 추가 |
| M-1 | 🟡 Major | `notifications.md` — SELLER_* 5종 템플릿 spec 미반영 (코드는 4차 검토에서 구현됨) | `docs/specs/notifications.md` | ✅ 판매자 알림 섹션 + `NotificationTemplateCode` 타입 추가 |
| M-2 | 🟡 Major | `products.md` groupProductConfig — `isProcessed` 플래그 누락 (4차 검토 minor 수정 반영) | `docs/specs/products.md` | ✅ `isProcessed: boolean` 필드 추가 |
| m-1 | 🟢 Minor | `auth.md` — 역할별 로그인 Provider 정책 미명시 | `docs/specs/auth.md` | ✅ seller 네이버 미지원 + 이유 명시 |

### 설계 공백 — seller 앱 스캐폴딩 착수 시 spec 추가 필요

| 항목 | 현황 | 조치 |
|------|------|------|
| `settlements` 모듈 | 스키마: 판매자 설계 1단계 §7에 정의. API·트리거 로직 미정의 | seller 앱 착수 시 `docs/specs/settlements.md` 신규 작성 |
| `hubs` 모듈 | 스키마: 판매자 설계 1단계 §7에 정의. CRUD API 미정의 | seller 앱 착수 시 `docs/specs/hubs.md` 신규 작성 |
| `orders.preparedAt` API 반영 | spec 업데이트 완료. NestJS `PATCH /orders/:id/status` PREPARING 전환 시 `preparedAt` 수신 필요 | seller 앱 착수 시 `orders.service.ts` 수정 |

---

## [2026-03-28] 4차 정합성 검토 — seller 앱 설계 착수 전

### 수정 완료

| # | 등급 | 항목 | 파일 | 조치 |
|---|------|------|------|------|
| C-1 | 🔴 Critical | Webhook 후 소비자 알림 미발송 (`ORDER_ACCEPTED`, `GROUP_JOINED`) | `payments.service.ts` | ✅ handleWebhook 성공 분기에 `notifications.sendToUser` 추가 |
| C-2 | 🔴 Critical | `PaymentsService` ↔ `NotificationsService` 순환 의존성 | `payments.module.ts`, `notifications.module.ts`, `notifications.service.ts`, `payments.service.ts` | ✅ NestJS `forwardRef()` 로 해소 |
| C-3 | 🔴 Critical | 판매자 알림 전무 (신규주문·공동구매달성·개인취소·자동환불) | `notifications.service.ts`, `orders.service.ts` | ✅ `SELLER_*` 템플릿 4종 추가, `sendToStoreOwner` 구현 |
| M-1 | 🟡 Major | `getOrder`/`getOrders` 판매자 storeId 소유권 검증 누락 | `orders.service.ts` | ✅ `user.storeId !== storeId` 시 403 추가 |
| M-2 | 🟡 Major | `portonePaymentParams.merchantUid` V1 필드명 잔존 | `orders.service.ts` | ✅ 제거 — spec(`payments.md`) 기준 `{ name, amount, buyerName }` 정렬 |
| m-1 | 🟢 Minor | 공동구매 스케줄러 매분 중복 쿼리 | `notifications.service.ts` | ✅ `groupProductConfig.isProcessed` 플래그 도입, 처리 후 `true` 설정 |

### 설계 의도 확정 (코드 변경 불필요)

| 항목 | 결정 |
|------|------|
| 드라이버 주문 접근 제어 | driver는 storeId 범위 내 전체 주문 조회 허용 — 배송 담당자는 해당 storeId 모든 주문을 알아야 함. 드라이버 앱 설계 시 재검토 |
| `SELLER_TRANSITIONS` 중복 항목 (`DELIVERING: ['CANCELLED']`) | `getAllowedTransitions`의 일반 취소 로직과 중복이나 명시적 선언으로 유지 — 제거 시 의도 불명확 |

---

## [2026-03-28] 6차 정합성 검토 — 판매자 설계 + 운영 구조 결정 반영

### 수정 완료

| # | 등급 | 항목 | 파일 | 조치 |
|---|------|------|------|------|
| C-1 | 🔴 Critical | `UserRole`에 `'admin'` 미포함 | `auth.md`, `auth.types.ts` | ✅ `'admin'` 추가, 접근 제어 테이블 반영 |
| C-2 | 🔴 Critical | `stores` 스키마에 `status` 필드 누락 | `products.md` | ✅ 5개 값 추가 |
| C-3 | 🔴 Critical | `settlements.status`에 `'paid'` 누락 | `판매자 설계 1단계` | ✅ `'paid'` 추가, 의미 주석 포함 |
| M-1 | 🟡 Major | seller 초대 토큰 가입 플로우·스키마 미정의 | `auth.md` | ✅ §5-2 신규 추가 + `invite_tokens` 스키마 정의 |
| M-2 | 🟡 Major | admin API 접근 제어 미정의 | `auth.md` | ✅ §7 테이블에 admin 컬럼 추가 + 우회 원칙 명시 |
| M-3 | 🟡 Major | 주문 목록 조회 admin 케이스 미반영 | `orders.md` | ✅ `userId` admin 시 선택적으로 변경, 주석 추가 |
| M-4 | 🟡 Major | 판매자 알림 "미구현" 표기 오류 | `판매자 설계 1단계` | ✅ 4차 검토 구현 완료로 현행화 |

### 설계 공백 — seller 스캐폴딩 착수 시 처리

| 항목 | 현황 |
|------|------|
| `settlements.md` spec | 스캐폴딩 착수 시 작성 |
| `settlements.md` spec | 스캐폴딩 착수 시 작성 |
| `hubs.md` spec | 스캐폴딩 착수 시 작성 |

### [2026-03-28] 판매자 알림 정책 확정

**결정**: 매 건 알림 제거 → 공동구매 결과 즉시 알림 + 일반 판매 배치 집계 알림으로 정리.

| 유지 | 제거 |
|------|------|
| `SELLER_GROUP_CONFIRMED` — 공동구매 목표 달성 즉시 | `SELLER_NEW_ORDER` — 일반 판매 매 건 알림 (과잉) |
| `SELLER_GROUP_CANCELLED_LACK` — 미달 자동 취소 즉시 | `SELLER_ORDER_CANCELLED` — 소비자 개인 취소 알림 (과잉) |
| `SELLER_ORDER_BATCH` — 일반 판매 배치 집계 (신규) | |

**이유**: 일반 판매 다건 운영 시 매 주문마다 알림이 오면 노이즈. 공동구매는 판매자 행동(준비 시작)이 즉시 필요하므로 실시간 유지.

**코드 조치**: `SELLER_NEW_ORDER`, `SELLER_ORDER_CANCELLED` 호출부는 seller 앱 스캐폴딩 시 `orders.service.ts`에서 제거.

### [2026-03-28] 온보딩 Guard 완성 조건 확정

**필수 (미입력 시 `active` 전환 불가)**
```
name            상호명
ceoName         대표자명
phone           연락처
address         소재지
```

**선택 (없어도 `active` 전환 가능)**
```
businessNumber  사업자등록번호
logoUrl         로고 이미지
```

**전환 조건**: 필수 4개 모두 입력 완료 시 `stores.status: 'invited' → 'active'` 자동 전환.
로고·사업자번호는 설정 화면에서 언제든 추가 가능.

> 당근비즈 벤치마킹은 이후 Phase 2 다중 판매자 온보딩 UX 개선 시 참조 예정.

### [2026-03-28] SELLER_ORDER_BATCH 발송 주기 확정

**1일 1회** — 발송 시각은 seller 앱 착수 시 확정 (오후 8시 유력).
0건이면 미발송.

---

## [2026-03-29] 결제 E2E 테스트 완료 — 발견된 버그 및 수정 결정

### 버그 1: Portone V2 웹훅 DTO 400 에러

**현상**: Portone이 웹훅 전송 시 `timestamp`(최상위)와 `data.transactionId` 필드를 포함하나,
DTO에 해당 필드가 없어 `forbidNonWhitelisted` 검증에서 400 반환.

**수정**: `portone-webhook.dto.ts`에 두 필드를 `@IsOptional()`로 추가.

### 버그 2: Transaction.Ready 웹훅 오처리

**현상**: Portone V2는 결제창 오픈 시 `Transaction.Ready` 이벤트를 먼저 발송.
기존 코드가 `type !== 'Transaction.Paid'` 조건으로 즉시 주문 CANCELLED 처리.
결제 완료 후 `Transaction.Paid`가 도착해도 이미 CANCELLED라 무시됨.

**수정**: `payments.service.ts`에서 `Transaction.Ready` 타입을 명시적으로 무시(early return).

**Portone V2 웹훅 이벤트 순서**:
```
결제창 오픈 → Transaction.Ready (무시)
결제 완료   → Transaction.Paid  (처리: PENDING→ACCEPTED)
결제 실패   → Transaction.Failed (처리: PENDING→CANCELLED)
```

### 버그 3: Firestore Timestamp NaN 표시

**현상**: `onSnapshot`으로 받은 `createdAt`이 Firestore Timestamp 객체라
`new Date(createdAt)`이 NaN 반환 → "NaN일 전" 표시.

**수정**: `toDate()` 메서드 존재 여부로 분기 처리.

---

## [2026-03-29] 마이페이지 Phase B 구현 — 기술 결정 사항

### 결정 1: consumer 주문 목록 — Firestore runQuery → NestJS API

**원인**: Firestore 보안 규칙이 단일 문서 `get`은 허용하나 컬렉션 `list`(runQuery POST)는 차단.

**결정**: `GET /stores/:storeId/orders?userId={id}` NestJS 엔드포인트로 대체.
- 인증 토큰 사용으로 보안 향상
- Firestore 규칙 수정 없이 해결

**수정된 서비스 응답**: `getOrders`가 `{ orders: [...] }` → `Order[]` 평탄화 + `id` 포함.
seller 앱은 Firestore SDK 직접 사용이라 영향 없음.

### 결정 2: NextAuth v5 beta.30 — session.user.id 명시적 전달 필수

`token.sub → session.user.id` 자동 매핑이 beta.30에서 불안정.
`jwt` 콜백에 `token.id = user.id`, `session` 콜백에 `session.user.id = token.id` 명시 필수.
`next-auth.d.ts`에 `id: string` 타입 추가.

### 결정 3: ssr: false 동적 import 패턴

`useSession`을 사용하는 페이지는 Next.js 정적 프리렌더 시 SessionProvider 미존재로 오류.
`page.tsx`(`'use client'`) → `next/dynamic(() => import('./_client'), { ssr: false })`로 래핑.
`force-dynamic`만으로는 클라이언트 훅 프리렌더를 막을 수 없음.

### 결정 4: 네이버페이 가입 시점 — 도메인 확정 후

네이버페이 파트너센터는 실제 운영 URL 필수. 도메인·브랜드명 확정 전 가입 불가.
브랜드명 변경은 manifest.json + 화면 텍스트만 수정하면 되므로 코드 영향 없음.

---
