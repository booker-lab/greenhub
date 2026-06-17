# GreenHub 전체 거래 흐름 수동 테스트 가이드

> 작성일: 2026-06-09
> 목적: 셀러, 소비자, 드라이버 앱을 관통하는 상품 등록, 구매 방식 선택, 결제, 배송, 결산, 정산 흐름을 현재 구조 기준으로 직접 검증하기 위한 준비 문서

## 1. 범위

**이 문서는 새 기능 설계가 아니라, 현재 구현된 구조를 기준으로 통합 검증을 수행하기 위한 테스트 준비 명세이다.**

검증 대상은 다음 앱과 도메인이다.

| 영역 | 경로 | 역할 |
| --- | --- | --- |
| 소비자 앱 | `apps/consumer` | 상품 탐색, 장바구니, 구매 방식 선택, 결제, 주문 추적 |
| 셀러 앱 | `apps/seller` | 온보딩, 상품 등록, 주문 준비, 배송 처리, 정산 조회 |
| 드라이버 앱 | `apps/driver` | 배송 보드, 주문 상세, 지도, 배송 상태 확인 |
| API | `apps/api` | 인증, 상품, 주문, 결제 웹훅, 배송 상태, 정산 도메인 처리 |
| 공유 계약 | `packages/shared/src` | `Product`, `Order`, `Payment`, `Settlement` 타입 SSOT |
| E2E | `apps/e2e` | Playwright 기반 프론트 검증과 일부 fixture 검증 |

## 2. 구조 요약

**비즈니스 로직의 기준점은 NestJS API이며, 프론트 앱은 상태 입력과 Firestore 기반 조회를 담당한다.**

핵심 도메인 분리는 다음과 같다.

| 도메인 | 주요 파일 | 확인할 책임 |
| --- | --- | --- |
| 상품 | `apps/api/src/products`, `packages/shared/src/product.types.ts` | 일반 상품과 공동구매 상품 생성, 활성 상태, 배송 설정 |
| 주문 | `apps/api/src/orders`, `packages/shared/src/order.types.ts` | 주문 생성, 상태 전이, 취소, 픽업/거점 확인 |
| 결제 | `apps/api/src/payments`, `packages/shared/src/payment.types.ts` | Portone 결제 검증, 웹훅, 환불 |
| 정산 | `apps/api/src/settlements`, `packages/shared/src/settlement.types.ts` | 완료 주문 기준 정산 생성, 확정, 지급 |
| 드라이버 | `apps/api/src/driver`, `apps/driver/src/app/board` | 배송 대상 조회와 배송 보드 렌더링 |
| 거점 | `apps/api/src/hubs`, `apps/seller/src/app/hubs` | 거점 배송, 직원 초대, 거점 주문 확인 |

## 3. 거래 상태 기준

**테스트의 성공 여부는 화면 표시보다 먼저 주문 상태와 결제/정산 문서가 기대 순서대로 변하는지로 판정한다.**

현재 공유 타입 기준 주문 상태는 다음과 같다.

```txt
PENDING
RECRUITING
CONFIRMED
ACCEPTED
PREPARING
DELIVERING
HUB_ARRIVED
PICKED_UP
DELIVERED
CANCELLED
REVIEWED
```

일반 판매의 기본 흐름:

```txt
PENDING -> ACCEPTED -> PREPARING -> DELIVERING -> DELIVERED -> REVIEWED
```

거점 픽업 흐름:

```txt
PENDING -> ACCEPTED -> PREPARING -> DELIVERING -> HUB_ARRIVED -> PICKED_UP -> REVIEWED
```

공동구매 흐름:

```txt
PENDING -> RECRUITING -> CONFIRMED -> PREPARING -> DELIVERING -> DELIVERED -> REVIEWED
```

정산 생성 트리거:

```txt
DELIVERED 또는 PICKED_UP 또는 REVIEWED 도달 시 settlements/{orderId} 생성 대상
```

## 4. 실행 전 준비

### 4.1 환경 변수

**로컬에서 전 구간을 직접 테스트하려면 API, 세 프론트 앱, Firebase, Portone, 테스트 계정이 같은 환경을 바라봐야 한다.**

API 쪽 필수 확인 항목:

| 변수 | 용도 |
| --- | --- |
| `PORT` | API 서버 포트, 기본 `3000` |
| `JWT_SECRET` | API JWT 서명 |
| `FIREBASE_PROJECT_ID` | Firebase 프로젝트 |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | 서버 SDK 인증 |
| `CORS_ORIGIN` | 소비자, 셀러, 드라이버 로컬 주소 허용 |
| `PORTONE_V2_SECRET` | Portone 결제 조회/환불 |
| `PORTONE_WEBHOOK_SECRET` | Portone 웹훅 검증 |
| `PLATFORM_FEE_RATE` | 정산 수수료율, 기본 `0.05` |
| `SETTLEMENT_CONFIRM_DELAY_DAYS` | 정산 확정 지연일, 기본 `1` |

프론트 앱 공통 확인 항목:

| 변수 | 용도 |
| --- | --- |
| `AUTH_SECRET` | NextAuth 세션 |
| `NEXT_PUBLIC_API_URL` | API 주소 |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase 클라이언트 |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase 인증 도메인 |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase 프로젝트 |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | 이미지/배송 사진 저장소 |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase 메시징 |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase 앱 |

소비자 결제 확인 항목:

| 변수 | 용도 |
| --- | --- |
| `NEXT_PUBLIC_PORTONE_STORE_ID` | Portone 스토어 |
| `NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY` | 카카오페이 결제 채널 |
| `NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY` | 네이버페이 결제 채널, 없으면 비활성 |

드라이버 지도 확인 항목:

| 변수 | 용도 |
| --- | --- |
| `NEXT_PUBLIC_KAKAO_MAP_KEY` | 드라이버 지도 화면 |

### 4.2 로컬 서버

권장 실행 순서:

```bash
pnpm install
pnpm --filter ./packages/shared build
pnpm --filter api start:dev
pnpm --filter consumer dev
pnpm --filter seller dev
pnpm --filter driver dev
```

포트 충돌이 없을 때의 기본 접근:

| 앱 | 주소 |
| --- | --- |
| API | `http://localhost:3000` |
| 소비자 | `http://localhost:3001` 또는 Next 기본 포트 |
| 셀러 | `http://localhost:3002` 또는 Next 기본 포트 |
| 드라이버 | `http://localhost:3003` |

실제 포트는 각 터미널의 Next 출력과 `.env`의 `NEXTAUTH_URL`, `NEXT_PUBLIC_API_URL`, `CORS_ORIGIN`을 맞춰 확정한다.

### 4.3 테스트 계정과 권한

**수동 테스트는 최소 네 계정이 필요하다. 한 계정에 여러 역할을 겹치면 권한 문제를 놓치기 쉽다.**

| 계정 | 필요 역할 | 검증 위치 |
| --- | --- | --- |
| 소비자 | 일반 구매자 | `apps/consumer` |
| 셀러 | 특정 `storeId` 소유자 | `apps/seller` |
| 드라이버 | 배송 담당자 | `apps/driver` |
| 관리자 | 관리자 | `apps/seller/src/app/admin` |

확인할 권한 조건:

- 셀러 계정은 테스트할 `storeId`와 연결되어 있어야 한다.
- 소비자 계정은 주문 생성과 마이페이지 주문 조회가 가능해야 한다.
- 드라이버 계정은 배송 보드에서 대상 주문을 볼 수 있어야 한다.
- 관리자 계정은 정산 확정/지급 화면과 스토어, 주문 화면에 접근 가능해야 한다.

### 4.4 테스트 데이터

준비할 데이터는 다음 순서가 좋다.

| 순서 | 데이터 | 확인할 필드 |
| --- | --- | --- |
| 1 | 테스트 스토어 | `storeId`, 수수료율, 활성 상태 |
| 2 | 배송 설정 | `directFee`, `hubFee`, `parcelFee`, 무료배송 기준 |
| 3 | 일자별 수용량 | `dailyCaps/{storeId_date}`의 `totalCap`, `usedSlots` |
| 4 | 거점 | `hubId`, 거점 주소, 거점 직원 |
| 5 | 일반 상품 | `saleType=normal`, 활성 상태, 배송 가능 방식 |
| 6 | 공동구매 상품 | `saleType=group`, 최소/목표 수량, 마감일 |
| 7 | 소비자 주소 | 직배송/택배/거점 검증용 주소 |

테스트 후 정리해야 할 컬렉션:

```txt
products
orders
payments
settlements
dailyCaps
groupProductConfigs
hubs
notifications
```

## 5. 수동 테스트 시나리오

### 5.1 셀러 온보딩과 상품 등록

**상품 등록은 이후 모든 거래 흐름의 시작점이므로 일반 판매와 공동구매를 반드시 분리해서 만든다.**

1. 셀러 앱 로그인
2. `/onboarding` 또는 `/settings`에서 스토어 정보와 배송 설정 확인
3. `/products/new`에서 일반 상품 등록
4. 가격, 이미지, 카테고리, 배송 크기, 활성 상태 확인
5. `/products/new`에서 공동구매 상품 등록
6. 최소 수량, 목표 수량, 1인 최대 수량, 모집 마감, 공동 배송일 확인
7. 소비자 앱 홈, 검색, 상품 상세에서 두 상품이 노출되는지 확인

관찰 포인트:

- API `POST /stores/:storeId/products`
- API `GET /products?isActive=true`
- 상품 문서의 `saleType`, `isActive`, `groupSummary`
- 이미지 업로드가 Firebase Storage URL로 저장되는지

### 5.2 일반 판매, 직배송

1. 소비자 앱에서 일반 상품 상세 진입
2. 구매 수량과 배송 희망일 선택
3. 배송 방식 `direct` 선택
4. 장바구니 또는 바로 구매에서 결제 화면 진입
5. 결제 수단 선택 후 Portone 결제 진행
6. 웹훅 수신 후 주문 상태가 `ACCEPTED`가 되는지 확인
7. 셀러 앱 `/orders`에서 주문 확인
8. 셀러가 준비 처리하여 `PREPARING` 전환
9. 셀러가 배송 시작 처리하여 `DELIVERING` 전환
10. 드라이버 앱 `/board`에서 주문 확인
11. 배송 완료 처리로 `DELIVERED` 전환
12. 소비자 마이페이지 주문 상세에서 상태 확인
13. 정산 문서 생성 확인

관찰 포인트:

- `orders/{orderId}.status`: `PENDING -> ACCEPTED -> PREPARING -> DELIVERING -> DELIVERED`
- `payments/{orderId}.status`: `PAID`
- `dailyCaps.usedSlots`: 주문 생성 시 증가
- `settlements/{orderId}.status`: `pending`

### 5.3 일반 판매, 택배

1. 소비자 앱에서 일반 상품 구매
2. 배송 방식 `parcel` 선택
3. 결제 완료 후 셀러 앱 주문 상세 진입
4. 셀러가 준비 처리
5. 택배사와 송장번호 입력 후 배송 시작 처리
6. 소비자 주문 상세에서 택배 정보 표시 확인
7. 배송 완료 처리 후 정산 생성 확인

관찰 포인트:

- `courierCompany`, `trackingNumber`
- 셀러 주문 상세의 택배 발송 모달
- 기존 E2E `seller-parcel-ship.spec.ts`, `seller-order-bulk-parcel-ship.spec.ts`

### 5.4 일반 판매, 거점 픽업

1. 셀러 앱에서 거점 생성 또는 기존 거점 확인
2. 소비자 앱에서 배송 방식 `hub` 선택
3. 소비자가 거점 선택 후 결제
4. 웹훅 후 `ACCEPTED` 확인
5. 셀러가 준비와 배송 시작 처리
6. 드라이버가 거점 도착 처리
7. 상태가 `HUB_ARRIVED`인지 확인
8. 거점 또는 소비자 확인으로 `PICKED_UP` 전환
9. 정산 생성 확인

관찰 포인트:

- `hubId`, `hubName`, `hubAddress`, `pickupCode`
- API `PATCH /stores/:storeId/orders/:orderId/hub-confirm`
- API `PATCH /stores/:storeId/orders/:orderId/pickup-confirm`
- 정산 트리거가 `PICKED_UP`에서도 동작하는지

### 5.5 공동구매 성공

1. 셀러 앱에서 공동구매 상품 등록
2. 소비자 A가 공동구매 상품 구매
3. 웹훅 후 주문 상태 `RECRUITING` 확인
4. 소비자 B, C가 참여하여 최소 수량 이상 도달
5. 모집 마감 또는 확정 조건에서 `CONFIRMED` 전환 확인
6. 셀러 앱에서 공동구매 주문 그룹 표시 확인
7. 준비, 배송 시작, 배송 완료 처리
8. 정산 문서가 참여 주문별로 생성되는지 확인

관찰 포인트:

- `groupBuyConsent.agreed`
- `groupProductConfig.currentQuantity`
- `RECRUITING -> CONFIRMED`
- 셀러 주문 화면의 일반/공구 토글

### 5.6 공동구매 실패와 환불

1. 공동구매 상품을 최소 수량보다 낮게 참여
2. 모집 마감 조건을 지난 상태로 만든다
3. 자동 취소 또는 운영자 취소 경로를 실행한다
4. 주문 상태 `CANCELLED` 확인
5. 결제 환불 상태 확인
6. 소비자 알림과 주문 상세의 취소 사유 확인

관찰 포인트:

- `orders.status=CANCELLED`
- `orders.cancelReason`
- `payments.status=CANCELLED`
- `payments.refundAmount`, `refundedAt`, `refundReason`
- `dailyCaps.usedSlots` 복구 여부

### 5.7 셀러 강제 취소와 환불

1. 결제 완료된 일반 주문 생성
2. 셀러 앱 주문 상세에서 취소 실행
3. 취소 사유 입력
4. 주문 상태와 결제 환불 상태 확인
5. 소비자 주문 상세과 알림 확인

관찰 포인트:

- API `PATCH /stores/:storeId/orders/:orderId/cancel`
- 환불 가능한 상태 제한
- 이미 정산 생성된 주문의 정산 취소 여부

### 5.8 정산 확정과 지급

1. 완료 주문으로 `settlements/{orderId}` 생성 확인
2. 셀러 앱 `/settlements`에서 일별 요약, 기간별 조회, 주문별 상세 확인
3. 관리자 앱 `/admin/settlements`에서 `pending`, `confirmed`, `paid`, `cancelled` 필터 확인
4. 확정 배치 조건 또는 수동 데이터 조정으로 `confirmed` 상태 확보
5. 관리자 지급 처리 실행
6. 셀러 앱에서 지급 완료 반영 확인

관찰 포인트:

- `platformFee`, `netAmount`
- `settledAt`, `confirmedAt`, `paidAt`
- API `GET /stores/:storeId/settlements`
- API `GET /stores/:storeId/settlements/summary`
- 관리자 정산 목록의 페이지네이션과 상태 필터

## 6. 자동화 테스트 연결

**현재 E2E는 전체 결제 실거래를 완전히 대신하기보다, 주요 화면과 상태별 UI 회귀를 보조하는 구조다.**

우선 실행할 묶음:

```bash
pnpm --filter e2e test -- seller-product-create.spec.ts
pnpm --filter e2e test -- consumer-checkout.spec.ts
pnpm --filter e2e test -- consumer-groupbuy.spec.ts
pnpm --filter e2e test -- seller-orders.spec.ts
pnpm --filter e2e test -- seller-order-detail.spec.ts
pnpm --filter e2e test -- seller-parcel-ship.spec.ts
pnpm --filter e2e test -- driver.spec.ts
pnpm --filter e2e test -- seller-settlements.spec.ts
pnpm --filter e2e test -- admin-settlements.spec.ts
```

E2E `.env`에서 확인할 값:

| 변수 | 용도 |
| --- | --- |
| `SELLER_BASE` | 셀러 앱 주소 |
| `CONSUMER_BASE` | 소비자 앱 주소 |
| `DRIVER_BASE` | 드라이버 앱 주소 |
| `TEST_SELLER_EMAIL`, `TEST_SELLER_PASSWORD` | 셀러 인증 |
| `TEST_CONSUMER_EMAIL`, `TEST_CONSUMER_PASSWORD` | 소비자 인증 |
| `TEST_ADMIN_EMAIL`, `TEST_ADMIN_PASSWORD` | 관리자 인증 |
| `TEST_DRIVER_EMAIL`, `TEST_DRIVER_PASSWORD` | 드라이버 인증 |
| `E2E_TEST_SECRET` | 테스트 전용 Credentials 게이트 |
| `SELLER_BYPASS_SECRET`, `CONSUMER_BYPASS_SECRET`, `DRIVER_BYPASS_SECRET` | Vercel Preview 보호 우회 |

fixture 전용 화면:

| 영역 | 기본 주소 |
| --- | --- |
| 소비자 fixture | `CONSUMER_FIXTURE_BASE=http://localhost:3010` |
| 셀러 fixture | `SELLER_FIXTURE_BASE=http://localhost:3011` |

## 7. 데이터 관찰 체크리스트

Firestore에서 주문 하나를 끝까지 따라갈 때 다음 순서로 확인한다.

- [ ] `products/{productId}`가 의도한 `storeId`, `saleType`, `isActive`를 가진다.
- [ ] `orders/{orderId}`가 `PENDING`으로 생성된다.
- [ ] Portone 웹훅 뒤 `payments/{orderId}`가 `PAID`로 생성된다.
- [ ] 주문 상태가 일반 판매는 `ACCEPTED`, 공동구매는 `RECRUITING`으로 전환된다.
- [ ] 배송 방식별 필드가 정확하다.
- [ ] 상태 전이에 따라 셀러, 소비자, 드라이버 화면이 같은 주문을 표시한다.
- [ ] 취소 시 `payments` 환불 필드와 `dailyCaps` 복구가 함께 일어난다.
- [ ] 완료 시 `settlements/{orderId}`가 생성된다.
- [ ] 정산 금액은 `totalAmount - platformFee = netAmount`를 만족한다.
- [ ] 관리자 지급 처리 후 `paidAt`과 셀러 정산 화면이 일치한다.

## 8. 결함을 찾기 쉬운 지점

**아래 항목은 화면 테스트만으로 놓치기 쉬우므로 데이터와 API 응답을 같이 봐야 한다.**

- `NEXT_PUBLIC_API_URL` 불일치로 프론트가 다른 API를 바라보는 경우
- `CORS_ORIGIN` 누락으로 로그인 또는 결제가 특정 앱에서만 실패하는 경우
- Portone 웹훅은 성공했지만 금액 검증 실패로 주문이 취소되는 경우
- `dailyCaps.usedSlots`가 취소/환불 후 복구되지 않는 경우
- 공동구매 수량 필드와 주문 상태가 불일치하는 경우
- 거점 주문에서 `HUB_ARRIVED`, `PICKED_UP` 정산 트리거가 누락되는 경우
- 택배 주문의 송장 정보는 화면에 보이나 주문 문서에 저장되지 않는 경우
- 정산 생성 후 취소된 주문이 `settlements.status=cancelled`로 연결되지 않는 경우
- 셀러와 관리자 정산 라벨이 공유 타입과 다르게 표시되는 경우
- 드라이버 앱 인증이 Kakao OAuth 중심이라 E2E 자동 로그인과 다르게 동작하는 경우

## 9. 권장 실행 순서

**처음부터 전체 실결제를 바로 돌리기보다, 화면 회귀와 API 계약을 먼저 확인한 뒤 결제 실거래를 최소 횟수로 실행한다.**

1. 빌드와 타입 확인: `pnpm build`
2. API 단위 테스트: `pnpm --filter api test`
3. 셀러 상품/주문 화면 E2E 실행
4. 소비자 상품/체크아웃 화면 E2E 실행
5. 드라이버 로그인/보드 E2E 실행
6. 정산 셀러/관리자 E2E 실행
7. Firestore 테스트 데이터 준비
8. 일반 판매 직배송 실거래 1건
9. 일반 판매 택배 실거래 1건
10. 거점 픽업 실거래 1건
11. 공동구매 성공 케이스 1묶음
12. 공동구매 실패/환불 케이스 1묶음
13. 정산 생성, 확정, 지급 확인
14. 테스트 데이터 백업 후 정리

## 10. 테스트 완료 기준

- [ ] 셀러가 일반 상품과 공동구매 상품을 등록할 수 있다.
- [ ] 소비자가 상품을 찾고 구매 방식과 배송 방식을 선택할 수 있다.
- [ ] 결제 성공 후 주문 상태가 판매 방식에 맞게 전환된다.
- [ ] 셀러 주문 관리에서 준비, 배송 시작, 취소가 정상 처리된다.
- [ ] 드라이버 앱에서 배송 대상 주문이 보이고 상태가 연결된다.
- [ ] 직배송, 택배, 거점 픽업이 각각 다른 필드와 상태를 남긴다.
- [ ] 환불 케이스에서 주문, 결제, 수용량, 알림이 함께 정리된다.
- [ ] 완료 주문에서 정산이 생성된다.
- [ ] 셀러와 관리자 정산 화면이 같은 금액과 상태를 보여준다.
- [ ] 테스트 후 생성 데이터가 식별 가능하고 정리 가능하다.

## 11. 2026-06-13 수동 검증 운영 메모

**5.1부터의 전체 흐름 검증은 사용자가 실제 Chrome 로그인 세션에서 육안으로 수행한다. Codex는 코드 수정이나 우회 자동화를 하지 않고, 관찰 결과 정리와 다음 단계 핸드오프 작성만 보조한다.**

### 11.1 적용 범위

- 시작 지점: `5.1 셀러 온보딩과 상품 등록`
- 실행 방식: 사용자가 실제 웹앱 화면에서 직접 클릭, 입력, 저장, 소비자 앱 노출 확인
- 보조 방식: Codex는 요청 시 체크리스트 정리, Network/API 응답 해석, 다음 단계 핸드오프 문구 작성
- 금지: 사용자 승인 없는 코드 수정, 리팩터링, 커밋, 푸시, 데이터 삭제, API 본문 우회 변조

### 11.2 5.1 사용자 기록 양식

```txt
5.1 결과:
- 상태: 통과 / 차단 / 보류
- 셀러 앱 URL:
- 소비자 앱 URL:
- 일반 상품명:
- 일반 상품 ID:
- 공동구매 상품명:
- 공동구매 상품 ID:
- 소비자 홈 노출:
- 소비자 검색 노출:
- 일반 상품 상세 URL:
- 공동구매 상품 상세 URL:
- API POST /stores/:storeId/products:
- API GET /products?isActive=true:
- 상품 문서 확인: saleType / isActive / groupSummary
- 이미지 URL 확인: Firebase Storage URL 여부
- 결함 또는 우회:
- 5.2에서 사용할 일반 상품:
```

### 11.3 현재 사전 관찰

- Playwright preview 검증 중 `POST /stores/:storeId/products`가 일반/공동구매 모두 `400`을 반환했다.
- 관찰된 API 메시지: `selection.property bundleUnit should not exist`
- 이 오류가 실제 Chrome 육안 검증에서도 재현되면 5.1은 상품 등록 단계 차단으로 기록하고 5.2를 시작하지 않는다.
- 운영 도메인 자동 credentials 로그인은 세션 쿠키가 발급되지 않아, 사용자가 이미 로그인한 실제 Chrome 세션에서 확인하는 방식을 우선한다.
