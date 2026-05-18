# Green Hub — 앞으로 할 작업 백로그

> 기준일: 2026-04-10 (Seller 주문 상태 변경 E2E 완료 — 준비 시작 + 강제 취소)
> 완료 작업 전체 이력은 `CRITICAL_LOGIC.md`, `memory.md` 참조

---

## 우선순위 요약

| 순위 | 항목 | 범주 |
|------|------|------|
| ✅ | 소비자 앱 E2E 테스트 (카카오페이 결제 → seller 앱 처리) | 테스트 |
| ✅ | 소비자 앱 Phase B — `/mypage` 주문 목록 + 타임라인 | consumer 앱 |
| ✅ | Consumer 앱 카카오 로그인 E2E 검증 (greenlove.co.kr) | 인증 |
| ✅ | Seller 앱 카카오 로그인 E2E 검증 (seller.greenlove.co.kr) | 인증 |
| ✅ | Driver proxy admin 차단 버그 수정 (`proxy.ts` role 조건 수정) | 보안 |
| ✅ | Driver 앱 카카오 로그인 E2E (admin 계정, /board 정상 진입) (2026-04-10) | 인증 |
| ✅ | 네이버페이 파트너 가입 신청 완료 (심사 중 3~5 영업일) | 외부 연동 |
| ✅ | Seller 주문 상태 변경 E2E — 준비 시작 + 강제 취소 (2026-04-10) | 테스트 |
| ⭐ 1 | 네이버페이 채널키 발급 후 Vercel 환경변수 연결 | 외부 연동 |
| ✅ | Seller 앱 admin 로그인 시 `/admin/stores` 리다이렉트 (루트 page.tsx role 분기) | 인증 |
| ✅ | 프론트엔드 보안 취약점 Critical/High 수정 (SEC-01~07) | 보안 |
| ✅ | 프론트엔드 보안 취약점 Medium 수정 (SEC-09~11) | 보안 |
| ✅ | 프론트엔드 버그 수정 — BUG-01·02·04·08·09·10·12·15 수정 완료 | 버그 |
| ✅ | 프론트엔드 UX 개선 — UX-01·02·06 수정 완료 | UX |
| ✅ | 백엔드+인프라 보안 취약점 11건 수정 (2026-04-09) | 보안 |
| ✅ | 보안 수정 후 E2E 검증 (결제·로그인·admin 3앱 접근) (2026-04-10) | 테스트 |
| 💡 | 카드 결제 PG사 계약 | 외부 연동 |
| 🔵 | 다중 판매자 상점 페이지 (소비자 앱) | Phase 2 |

---

## 1. seller 앱 (`apps/seller`)

> 설계 문서: `docs/design/판매자-1단계-요구사항.md`, `docs/design/판매자-2단계-IA.md`
> 배포: Vercel (Root Directory: `apps/seller`)

### 1-1. 인프라 / 공통

- [x] `apps/seller` Next.js 16 스캐폴딩 + pnpm workspace 등록
- [x] `@greenhub/shared` 의존성 연결
- [x] NextAuth.js v5 — 이메일 + 카카오 Provider, `role: 'seller'`
- [x] PWA — manifest.json, Service Worker
- [x] Tailwind CSS + 하단 탭 5개 (`BottomNav.tsx`)
- [x] `proxy.ts` — 미로그인→/login, storeId 없음→/onboarding
- [x] `src/lib/api.ts` — `apiFetch` 헬퍼 (Bearer 토큰 자동 주입)
- [x] `src/lib/firebase.ts` — Firestore + Storage export

### 1-2. 인증 / 온보딩

- [x] `/login` — 이메일 + 카카오 OAuth
- [x] `/onboarding` — 신규 seller `POST /stores` 생성 + session.update storeId 반영
- [x] Firebase Storage 로고 업로드 → `logoUrl` 저장 (선택) ✅ 2026-04-02

### 1-3. 주문 관리 (`/orders`)

- [x] Firestore 실시간 리스너 기반 주문 목록
- [x] 상태별 탭 5종 + 배지
- [x] 주문 카드 — 결제금액, 배송수단, 주문시각
- [x] `/orders/[id]` 주문 상세
  - 상품·수량·금액·배송 정보 표시
  - "준비 시작" 버튼 (preparedAt datetime 입력) → `PATCH .../status { PREPARING }`
  - **"배송 시작" 버튼** (PREPARING → DELIVERING) ✅ 2026-03-28 추가
  - "강제 취소" 모달 (사유 최소 5자) → `PATCH .../status { CANCELLED }`
  - 읽기 전용 상태 (배송 중 이후)

### 1-4. 상품 관리 (`/products`)

- [x] 상품 목록 — Firestore 실시간 리스너
- [x] 활성/비활성 토글
- [x] `/products/new` 상품 등록 폼
  - 이미지 최대 5장 (Firebase Storage 업로드, 대표사진 뱃지, 순서 번호)
  - 상품명·카테고리·색상(멀티)·배송사이즈·가격·상세설명
  - 판매 방식 라디오 (일반/공동구매) + 공동구매 전용 필드 슬라이드 다운
  - 헤더 우측 임시저장 버튼 (localStorage)
- [x] `/products/[id]/edit` 상품 수정
  - `GET /stores/:storeId/products/:id` 로드 후 폼 pre-fill
  - Firestore Timestamp → YYYY-MM-DD 변환
- [x] 상품 삭제 버튼 (`DELETE /stores/:storeId/products/:id`) ✅ 2026-04-02

### 1-5. 정산 관리 (`/settlements`)

- [x] 일별 요약 탭 — `GET .../settlements/summary?date=`
- [x] 기간별 조회 탭 — `GET .../settlements?from=&to=`
- [x] 주문별 상세 탭
- [x] (Should Have) CSV 다운로드 ✅ 2026-04-02

### 1-6. 거점 관리 (`/hubs`)

- [x] 거점 목록 — `GET /stores/:storeId/hubs`
- [x] 활성/비활성 토글 — `PATCH .../hubs/:hubId`
- [x] 삭제 — `DELETE .../hubs/:hubId`
- [x] `/hubs/new` 거점 등록 폼 — `POST .../hubs`
- [x] **`/hubs/[id]` 거점 상세**
  - 거점 정보 (이름·주소·운영시간)
  - 픽업 대기 주문 목록 (`status: HUB_ARRIVED`, `hubId` 필터)
  - 주문 행 클릭 → `/hubs/[id]/pickup?orderId=` 자동 전달
- [x] **`/hubs/[id]/pickup` 픽업 코드 확인**
  - orderId 쿼리 파라미터 수신
  - 6자리 분리 입력 UI (붙여넣기 지원)
  - `PATCH .../orders/:orderId/hub-confirm { pickupCode }` (seller JWT)
  - 성공 시 PICKED_UP 전환 + 완료 피드백 화면

### 1-7. 설정 (`/settings`)

- [x] `/settings` 메뉴 페이지
- [x] `/settings/delivery` — 배송비 6개 필드 + 기상 제한 토글
- [x] `/settings/daily-caps` — 달력 UI + 날짜별 슬롯 수정

### 1-8. 관리자 영역 (`/admin/*`) — Phase 2

> B안: seller 앱 내 `/admin` 경로. 규모 확장 시 `apps/admin` 분리(A안).

- [x] `/admin/stores` — 판매자 목록 + 수수료 설정 ✅ 2026-04-03
- [x] `/admin/users` — 소비자 계정 조회·정지·복구 ✅ 2026-04-03
- [x] `/admin/orders` — 전체 주문 조회·환불 강제 처리 ✅ 2026-04-03
- [x] `/admin/settlements` — 판매자별 정산 처리 (이체 완료) ✅ 2026-04-03
- [x] `/admin/invite` — 초대 토큰 발급 ✅ 2026-04-03
- [x] `/admin/drivers` — 드라이버 승인 대기·승인·정지 관리 ✅ 2026-04-03

### 1-9. 거점 스태프 권한 구조 — Phase 2 (운영 거점 계약 확정 후)

> **MVP 결정**: seller가 직접 `/hubs/[id]/pickup`에서 코드 입력 확인 (패턴 C)
> **Phase 2 트리거**: 협력 업체(꽃집·과일가게 등) 계약 확정 시
> 설계 결정 상세: `archive/CRITICAL_LOGIC_archive_20260516.md` §2026-03-28 거점 픽업 확인 방식

- [ ] `users.role: 'hub_staff'` 신규 역할 추가
- [ ] `hubs.staffIds: string[]` 관계 필드 + Firestore 스키마 반영
- [ ] seller 앱 스태프 초대 링크 발급 UI (`/hubs/[id]/settings`)
- [ ] API: `hub_staff` JWT 처리 + hubId 스코핑 미들웨어
- [ ] hub_staff 전용 온보딩 플로우 (seller 앱 내 분기)
- [ ] `/admin` 영역 구축 시 함께 설계 (§1-8과 병행)

---

## 2. API (`apps/api`)

### 완료된 모든 엔드포인트

- [x] auth 모듈 (Firebase ID token 검증 → JWT 발급)
- [x] `POST /auth/refresh` — refresh token 검증 → 새 accessToken + refreshToken 발급 ✅ 2026-04-04
- [x] stores — `PATCH /stores/:storeId` (온보딩 + active 전환)
- [x] products — `GET/POST/PATCH/DELETE /stores/:storeId/products`
- [x] products — daily-caps, delivery-config CRUD
- [x] orders — `POST/GET/PATCH /stores/:storeId/orders`
- [x] orders — `status`, `cancel`, `review`, `pickup-confirm`
- [x] settlements — `GET .../settlements`, `GET .../settlements/summary`
- [x] hubs — `GET/POST/PATCH/DELETE /stores/:storeId/hubs`
- [x] **`GET /stores/:storeId/hubs/:hubId/orders?status=` (C-2 완료)**
- [x] notifications 모듈

### 8차 정합성 검토 수정 사항 (이번 세션)

- [x] **C-1**: `SELLER_TRANSITIONS` DELIVERING·HUB_ARRIVED 취소 허용 제거
- [x] **C-1**: `getAllowedTransitions` 화이트리스트 방식으로 교체 (`ACCEPTED·CONFIRMED·PREPARING`만)
- [x] **C-3**: `CreateOrderDto.hubId?: string` + hub 배송 시 필수 검증
- [x] **C-3**: `createOrder` — 주문 문서에 `hubId` 저장
- [x] **shared**: `Order.hubId: string | null`, `CreateOrderRequest.hubId?: string` 추가

### 이번 세션 추가 완료

- [x] **hub-confirm**: `PATCH /stores/:storeId/orders/:orderId/hub-confirm` — seller JWT + pickupCode 검증 → PICKED_UP
- [x] **POST /stores**: 신규 seller 스토어 생성 + user.storeId 업데이트 (2026-03-28)

### 미구현 API

- [x] settlements 취소 반영 — 주문 CANCELLED 시 `status: 'cancelled'` 업데이트 ✅ 2026-04-02
- [x] 관리자 API (`/admin/*`) — stores·users·orders·settlements·drivers CRUD ✅ 2026-04-03

---

## 3. 소비자 앱 Phase B (`apps/consumer`)

### 마이페이지 서브 화면

- [x] `/mypage` 주문 목록 + 프로필 (2026-03-29)
- [x] `/mypage/orders/[id]` — 상태 타임라인 + 픽업 코드 + 구매 확정 버튼 (2026-03-29)
- [x] 배송지 관리 (`/mypage/addresses`) — 저장 배송지 CRUD ✅ 2026-04-01
- [x] 알림 내역 (`/mypage/notifications`) — `GET /notifications/me` ✅ 2026-04-01

### 상품 화면 보완

- [x] 상품 상세 하단 판매자 정보 노출 (상호명·로고·연락처) ✅ 2026-04-02
- [x] `/category` 카테고리 탭 필터 (Firestore 복합 인덱스 + 레이아웃) ✅ 2026-04-02
- [x] `/search` 검색 페이지 (전체 상품 로드 후 클라이언트 필터) ✅ 2026-04-02

---

## 4. 외부 연동

### 4-1. 네이버페이

- [x] Vercel URL 제출 후 파트너 가입 신청 완료 ✅ 2026-04-07
- [x] 결제 코드 준비 완료 — usePayment paymentMethod 분기 + checkout UI ✅ 2026-04-07
- [ ] 채널키 발급 → Vercel `NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY` 환경변수 추가 (승인 후)
- [ ] 네이버페이 버튼 자동 노출 확인 (환경변수 추가만 하면 즉시 활성화)

### 4-2. 카드 결제 (MVP 완료 후)

- [ ] Portone + KG이니시스 또는 NHN KCP 계약 신청

---

## 5. 인프라 · 배포

### 5-1. Firebase 인덱스 배포

- [x] settlements·hubs 인덱스 4개 배포 완료
- [x] `orders storeId+createdAt DESC` 인덱스 추가 (2026-03-28)
- [x] `products storeId+isActive+category` 복합 인덱스 추가 (2026-04-02)
- [x] `groupProductConfig isProcessed+recruitDeadline` 복합 인덱스 배포 ✅ 2026-04-07

### 5-4. Firestore 보안 규칙

- [x] `products`·`stores` 컬렉션 단일 `get` 허용 추가 (2026-04-02)
- [x] `products` 컬렉션 `list` 허용 추가 — seller 앱 onSnapshot 실시간 리스너 지원 ✅ 2026-04-04

### 5-5. URL SSOT

- [x] `URLS.md` — 서비스 URL 마스터 레퍼런스 (Vercel 환경변수·Railway CORS_ORIGIN·카카오 리다이렉트 URI 체크리스트) ✅ 2026-04-04

### 5-2. Vercel seller 배포

- [x] `greenhub-seller.vercel.app` 배포 완료 (2026-03-28)
- [x] Railway `CORS_ORIGIN`에 seller URL 추가

### 5-3. Railway API 재배포

- [x] C-1·C-2·C-3 + hub-confirm + POST /stores 반영 완료 (2026-03-28)

---

## 6. 다중 판매자 확장 — Phase 2 (`apps/consumer` + `apps/api`)

> MVP는 단일 판매자(dear-orchid) 하드코딩 구조. 다중 판매자 등록 시 아래 작업으로 확장.

### 6-1. API 추가

- [ ] `GET /stores` — active 상점 목록 (이름·로고·주소·카테고리 요약)
- [ ] `GET /stores/:storeId` — 상점 상세 + 해당 상점 상품 목록

### 6-2. 소비자 앱 화면 추가

- [ ] `app/stores/page.tsx` — 상점 목록 (카드 그리드: 로고·상호명·거점 수·판매 상품 수)
- [ ] `app/stores/[storeId]/page.tsx` — 상점 상세 (프로필 + 판매 상품 + 운영 거점 목록)
- [ ] 홈 화면 하드코딩 `STORE_ID = 'dear-orchid'` → 동적 `storeId` 처리로 전환

### 6-3. 판매자 앱 연동 포인트

> **추가 개발 불필요** — 판매자 온보딩 시 입력한 `name·address·phone·logoUrl`이 이미 Firestore `stores` 컬렉션에 저장됨.

---

## 7. 보류 / 장기 과제

| 항목 | 내용 | 시점 |
|------|------|------|
| ~~드라이버 앱~~ | ✅ `apps/driver` 구현 + 배포 완료 (2026-04-03) — 카카오 로그인 E2E 검증 완료 | 완료 |
| ~~드라이버 사전 승인 플로우~~ | ✅ 구현 완료 (2026-04-03) — `driverApproved` 필드 + admin 승인 + 미승인 차단 | 완료 |
| **거점 배송 오픈** | 아래 §8 참조 | **운영 거점 계약 확정 시** |
| 다중 판매자 Phase 2 | 판매자 자체 가입 → 플랫폼 승인 플로우 | 비즈니스 요청 시 |
| 카카오 알림톡 정식 등록 | 템플릿 심사 (~1~3 영업일) | 실제 사용자 서비스 전 |
| PWA 푸시 (FCM) | firebase-messaging-sw.js | seller 완료 후 |
| 밀크런 경로 프리뷰 | Kakao Maps API — 거점 순회 경로 시각화 | Should Have |
| 리뷰·평점 시스템 | Nice to Have | Phase 2 |
| **드라이버 정산 시스템** | 아래 §9 참조 | **외부 드라이버 고용 시 (필수)** |
| **드라이버 플랫폼 노동 모델 전환** | 아래 §10 참조 | **대규모 드라이버 모집 시** |

---

## 8. 거점 배송 오픈 — 협력 업체 계약 확정 시

> **현재 상태**: 코드·FSM·API 모두 구현 완료. 소비자 앱에서 UI만 비노출 중.
> **오픈 조건**: 운영 거점(협력 업체 — 꽃집·과일가게 등) 계약 확정 시 즉시 활성화 가능.

### 이미 완료된 것 (추가 개발 불필요)

- `deliveryMethod: 'hub'`, `hubId` 타입·스키마·API 전체
- 주문 상태 `HUB_ARRIVED` · `PICKED_UP` FSM
- `pickupCode` 6자리 발급·저장·확인 (`PATCH .../pickup-confirm`)
- `GET /stores/:storeId/hubs/:hubId/orders?status=HUB_ARRIVED` API
- seller 앱 거점 CRUD (`/hubs`, `/hubs/new`)
- 알림톡 발송 트리거 (`DELIVERING → HUB_ARRIVED` 시 픽업 코드 안내)

### 오픈 시 필요한 작업 (최소 수준)

- [ ] 협력 업체를 seller 앱 `/hubs`에서 거점으로 등록
- [ ] 소비자 앱 배송 수단 선택 화면에서 `hub` 옵션 노출 조건 해제
- [x] seller 앱 `/hubs/[id]` 거점 상세 + `/hubs/[id]/pickup` 픽업 코드 확인 화면 구현

### Phase 2 고도화 (계약 후 운영 안정화 시점)

- [ ] QR 스캔 기반 픽업 인증 (현재 6자리 코드 수동 입력 방식)
- [ ] 지도 기반 실시간 위치 추적 (현재 타임라인 피드 방식)

---

---

## 9. 드라이버 정산 시스템 — 외부 드라이버 고용 시 (필수)

> **현재 상태**: MVP 드라이버 = 판매자 본인이므로 정산 불필요.
> **트리거**: 외부 드라이버 고용 시 즉시 필요. 미리 설계해두지 않으면 나중에 3개 앱 + API 동시 수정 필요.

### 준비된 인프라 (추가 작업 불필요)

- `orders.driverId: string | null` — DELIVERING 전환 시 자동 기록 (`orders.md` 반영 완료)
- 이 필드로 드라이버별 배송 건수 집계 기반이 이미 확보됨

### 구현 필요 항목

**Firestore 스키마**
- [ ] `driverSettlements/{id}` 컬렉션 신규 설계
  - `driverId`, `orderId`, `fee`, `status(pending→paid)`, `paidAt`

**정산 정책 결정 (운영 방식 확정 후 선택)**
- [ ] 건당 고정 배송료 (예: 배송 1건당 5,000원) — 단순, 초기 적합
- [ ] 거리 기반 차등 배송료 — Tmap API Phase 2와 연동 가능

**API 추가**
- [ ] `GET /drivers/:driverId/settlements?from=&to=` — 드라이버별 정산 내역
- [ ] `PATCH /drivers/:driverId/settlements/:id` — 지급 완료 처리 (admin 전용)

**드라이버 앱 화면 추가**
- [ ] `/profile` 하단 또는 별도 탭 — 기간별 배송 건수 + 수익 요약
  - "이번 달 배송 N건 / 예상 수령액 OO원"

**Admin 화면 추가 (§1-8과 병행)**
- [ ] `/admin/drivers` — 드라이버별 배송 건수·정산 내역 조회
- [ ] 지급 완료 처리 버튼 (일괄 이체 후 수동 확인)

### 설계 원칙

- **드라이버 정산은 판매자 정산(`settlements`)과 별도 컬렉션**으로 관리
  - 판매자 `netAmount`에서 드라이버 배송료를 차감하는 구조
  - `판매자 최종 수령 = totalAmount - platformFee - driverFee`
- `driverFee` 필드를 `settlements` 문서에 추가하면 기존 정산 구조 변경 최소화 가능

---

## 10. 드라이버 플랫폼 노동 모델 전환 — 대규모 드라이버 모집 시

> **현재 구조**: 고용 계약 모델 — admin이 신뢰하는 소수 드라이버를 수동 등록·승인하는 방식 (사내 시스템 계정 활성화와 유사)
> **전환 트리거**: 불특정 다수 드라이버를 플랫폼으로 모집할 시점 (배민라이더스·쿠팡이츠 모델)

### 배민/쿠팡 대비 현재 구조의 차이

| 항목 | 현재(Green Hub) | 플랫폼 노동 모델 |
|------|----------------|----------------|
| 신원 검증 | 카카오 실명 + admin 수동 승인 | 운전면허 OCR + 경찰청 결격사유 조회 + 보험 증명 |
| 온보딩 | admin 버튼 클릭 | 자동화 파이프라인 (수만 명 처리) |
| 배달 배정 | 드라이버 pull 방식 (목록에서 직접 선택) | 알고리즘 자동 배정 (거리·수락률 기반) |
| 실시간 위치 | 미구현 | GPS 상시 추적 → 배정 알고리즘 입력 + 소비자 노출 |
| 정산 | 수동 이체 (외부 드라이버 고용 시 §9 구현) | 건당 실시간 정산, 주 1~2회 자동 이체 |

### 전환 시 필요한 작업

**신원 검증 파이프라인**
- [ ] 운전면허 OCR API 연동 (카카오 또는 NICE평가정보)
- [ ] 경찰청 범죄경력 조회 API (전문 대행사 경유)
- [ ] 차량 보험 증명서 업로드 + 유효기간 관리

**배정 시스템**
- [ ] 드라이버 실시간 GPS 위치 수신 (Firestore 실시간 업데이트)
- [ ] 배정 알고리즘 설계 (거리·온라인 상태·수락률 가중치)
- [ ] 소비자 앱 드라이버 위치 노출 화면

**정산 자동화**
- [ ] §9 드라이버 정산 시스템 + 자동 이체 API 연동 (토스페이먼츠 등)
- [ ] 인센티브·프로모션 정책 엔진

---

---

## 11. 프론트엔드 보안 취약점 · 버그 잔여 목록 (2026-04-08 기준)

> 보안 감사 결과 식별. 수정 완료분 ✅, 미수정분 [ ] 표시.

### 11-1. 보안 (Security)

| ID | 심각도 | 파일 | 내용 | 상태 |
|----|--------|------|------|------|
| SEC-01 | Critical | `consumer/useOrderStatus.ts` | Firestore 공개 REST → Railway API 인증 호출 | ✅ |
| SEC-02 | Critical | `driver/board/_client.tsx` | Firestore 구독 driverId 필터 없음 → 필터 추가 | ✅ |
| SEC-03 | Critical | `driver/proxy.ts` | 쿠키 존재만 확인 → role=driver 검증 | ✅ |
| SEC-04 | High | `consumer/proxy.ts` | role 체크 없음 → driver 차단 | ✅ |
| SEC-05 | High | auth.ts 3개 앱 | accessToken 클라이언트 세션 노출 | ⚠️ 구조적 한계 (NextAuth 방식) |
| SEC-06 | High | auth.ts + providers.tsx | refresh 실패 시 빈 토큰 → TokenErrorGuard 자동 로그아웃 | ✅ |
| SEC-07 | High | `ImageUpload.tsx`, `onboarding/page.tsx` | 파일 업로드 타입·크기 미검증 → 5MB/2MB + 타입 검증 | ✅ |
| SEC-08 | Medium | NEXT_PUBLIC_API_URL | 클라이언트 노출 — 의도된 구조, 별도 처리 불필요 | — |
| SEC-09 | Medium | `consumer/login/page.tsx` | callbackUrl Open Redirect → 상대경로 검증 | ✅ |
| SEC-10 | Medium | `driver/photo/page.tsx` | Firestore storeId 읽어 API 경로 구성 → 상수 직접 사용 | ✅ |
| SEC-11 | Medium | `consumer/checkout/page.tsx` | 결제금액 URL 파라미터 신뢰 → API 직접 계산 | ✅ |
| SEC-12 | Low | firebase.ts 3개 앱 | Firebase config 노출 — 의도된 구조, Firestore Rules 강화로 대응 | — |

### 11-2. 버그 (Bug)

| ID | 심각도 | 파일 | 내용 | 상태 |
|----|--------|------|------|------|
| BUG-01 | Critical | `consumer/cart/page.tsx` | 장바구니 다중 상품 → 첫 번째만 checkout 전달 | ✅ 2026-04-08 |
| BUG-02 | Critical | `consumer/usePayment.ts` | 결제 중복 호출 방지 없음 | ✅ 2026-04-08 |
| BUG-03 | High | `useOrders`, `useStoreProducts`, `board/_client.tsx` | Firestore 구독 Firebase Auth 없음 — Rules 강화 시 중단 위험 | 🔵 보류 — Firestore Rules 강화 시점에 Firebase Custom Token 발급과 함께 처리 |
| BUG-04 | High | `consumer/useProducts.ts:68` | 내부 `fetch()` 선언이 전역 fetch 가림(shadowing) | ✅ 2026-04-08 |
| BUG-08 | Medium | `seller/useAdmin.ts` | 모든 useAdmin hooks catch 없음 — 에러 무시 | ✅ 2026-04-08 |
| BUG-09 | Medium | `seller/useAdmin.ts` mutation 함수들 | setCommission·toggleSuspend·forceRefund 에러 핸들링 전무 | ✅ 2026-04-08 |
| BUG-10 | Medium | `driver/board/[orderId]/page.tsx:69` | PWA에서 alert() 사용 | ✅ 2026-04-08 |
| BUG-12 | Medium | `consumer/checkout/page.tsx:3` | 'use client'에서 export const dynamic 무시됨 | ✅ 2026-04-08 |
| BUG-15 | High | `seller/useOrders.ts` | PENDING·RECRUITING 상태 주문이 어떤 탭에도 미표시 | ✅ 2026-04-08 |

### 11-3. UX

| ID | 심각도 | 내용 | 상태 |
|----|--------|------|------|
| UX-01 | High | 3개 앱 viewport viewportFit·safe-area 미처리 (iPhone 노치) | ✅ 2026-04-08 |
| UX-02 | High | 결제 중 뒤로가기/새로고침 방지 없음 (유령 주문 위험) | ✅ 2026-04-08 |
| UX-03 | High | accessToken 만료 시 사용자 안내 없음 → TokenErrorGuard로 해결 | ✅ |
| UX-06 | Medium | 주소 입력 Daum 우편번호 미연동 | ✅ 2026-04-08 |
| UX-07 | Medium | 셀러앱 탭 스타일 2종 혼재 — 주문(검정 underline) vs 상품·정산(초록) | 📋 세션38 감사 |
| UX-08 | Medium | 셀러 상품 카드 Badge-as-button — 상태 표시와 액션 버튼 시각 미구분 | 📋 세션38 감사 |
| UX-09 | Low | 셀러앱 `confirm()` vs Modal 혼재 — 삭제 확인 패턴 불일치 | 📋 세션38 감사 |
| UX-10 | Low | 주문 페이지 3중 sticky 스택 — 목록 가시 영역 축소 | 📋 세션38 감사 |

> **UX-07~10 상세**: 화면별 진단·우선순위는 [docs/specs/frontend/seller-ux-audit.md](specs/frontend/seller-ux-audit.md).

> **BUG-03 처리 전략**: 현재 Firestore Rules `orders allow read: if true`로 열려 있어 즉시 영향 없음.
> Rules를 인증 필요로 강화할 시점에 Firebase Custom Token 발급 API 추가 + 3개 앱 `signInWithCustomToken()` 연동을 함께 처리할 것.

---

## 12. 후속 인프라·보안 정비 (세션22~25 잔여)

> 기준일: 2026-05-17 (세션35 — docs 정리)
> 진입점: 다음 세션 시작 시 [docs/archive/sessions/session40-prep.md](archive/sessions/session40-prep.md) → 본 §12 우선순위 표 순서로 확인.
> **세션29 완료**: §12-2 e2e 잔여 B·C·D 전부 해소 (run 25957177092 — 167 passed / 0 failed).
> **세션30 완료**: P2-C `CRITICAL_LOGIC.md` 한도 정책 — 옵션 3 변형 채택·아카이브 분리(1415→229라인).
> **세션31 완료**: P2-A Railway latency 계측(`/auth/login` p50 922ms·0% 실패) + 계측 중 발견한 throttler 전역 누수 버그 수정 (#CL-30).
> **세션32 완료**: e2e 안정성 2건 해소 — `consumer-groupbuy:14` flake + `cleanup-spec-residue` CI 인증 실패. 풀런 167/0 유지·cleanup `users=2` 정상 동작.
> **세션33 완료**: P3 `/admin/banner` prerender 실패 해소 — firebase `getAuth` 지연 초기화 (#CL-31). 코드로 종결, Vercel 환경변수 조치 불필요로 확정.
> **세션34 완료**: P3 consumer@test.com 강한비번 전환 — Firestore `passwordHash` 갱신 + `apps/e2e/.env`·repo Secret `TEST_CONSUMER_PASSWORD` 교체. 풀런 167/0 유지.
> **세션35 완료**: docs 정리 — `memory.md` 200라인 한도 요약·아카이브(197→50라인) + 폴더 이동으로 깨진 상호 참조 링크 14곳 수정 + 변경 이력 순서·누락 보정. 코드 변경 없음.
> **세션36 완료**: seller 프론트엔드 리팩토링 5-Phase (#CL-32) — ProductForm 705→154라인(Fatal Constraint 해소), API 레이어 `apiJson` 통일, useAdmin 462→341 팩토리화, `useOrderActions` 통합(P3 종결), 공통 UI 컴포넌트 9개 페이지 치환. 빌드 통과.
> **세션37 완료**: P4 2건 + P3 G1 — global-setup `about:blank` storageState 레이스 해소(`be4fa2c`), CI 액션 node24 전환(checkout/setup-node v6·upload-artifact v7·pnpm/action-setup v6, node-version 22, `eb15e4e`), 거점 수정 페이지 신규(`hubs/[id]/edit`, `3888522`). Driver Kakao Maps SDK는 사용자 요청으로 차기 세션 이월.
> **세션38**: 셀러 홈 대시보드 + 준비 물량 재구성 — 전체 페이지 UX 감사 + 네이버 스마트스토어센터 벤치마크 → 8 아토믹 태스크 플랜 수립([seller-home-dashboard-plan.md](specs/frontend/seller-home-dashboard-plan.md)). 코드 변경 없음(설계·논의만). 거점 탭→설정 이동·준비 물량 탭(`/prep`) 신설 등 BottomNav IA 재구성 포함.
> **세션39 완료**: P3 셀러 홈 대시보드 재구성 — 세션38 플랜 T1~T8 전부 구현 (#CL-33, `7a01168`~`da99954`). PageHeader 홈 아이콘·홈 대시보드(오늘 할 일+현황 카드 3개)·BottomNav 거점→준비 탭 교체·준비 물량 탭(`/prep`) 신설·ConnectionStatus 추출. 타입체크·빌드(23라우트)·biome 신규 에러 0건. 준비 물량 공동구매는 1차 범위 제외(후속 등재).
> **다음 세션 최우선**: P3 Driver Kakao Maps SDK 연동 (§12-1 우선순위 표 참조).

### 12-1. 우선순위

| 순위 | 항목 | 범주 | 의존성 |
|------|------|------|--------|
| ✅ P0 | #CL-21 옵션 A 보강 — Production env에서 `E2E_TEST_SECRET` 제거 (2026-05-15 세션26 완료) | 보안 | 4단계 다중 PR |
| ✅ P1 | #CL-21 후속 — GitHub repo Secrets 11개 등록 + `preview` 자동 머지 워크플로 (2026-05-16 세션27 완료) | 인프라/DX | 단독 진행 가능 |
| ✅ P1 | #CL-23 인증 race 해소 — `storageState` 패턴 도입 (2026-05-16 세션28 완료) | 인프라/DX | 단독 진행 가능 |
| ✅ P1 | e2e 잔여 B·D — Railway CORS preview origin (#CL-28) — 재배포·풀런 검증 완료 (2026-05-16 세션29) | 인프라 | — |
| ✅ P3 | e2e 잔여 C — perf-css `networkidle` 제거 (2026-05-16 세션29 완료) | e2e | — |
| ✅ P2 | Railway `/auth/login` 로그 계측 — synthetic 측정 완료 (2026-05-16 세션31) | 관측 | — |
| ✅ P2 | Railway throttler 전역 누수 수정 — `auth` throttler 제거 (#CL-30, 2026-05-16 세션31) | 인프라/버그 | — |
| ⏹️ P2 | Vercel function cold-start mitigation 검토 — #CL-30으로 데이터상 불필요 판정 (moot) | 성능 | — |
| ✅ P2 | `CRITICAL_LOGIC.md` 한도 정책 — 옵션 3+ 채택, 아카이브 분리 (2026-05-16 세션30 완료) | 문서 정책 | 단독 |
| ✅ P3 | seller 프론트엔드 리팩토링 5-Phase — `useOrderActions` 통합 포함 (#CL-32, 2026-05-17 세션36) | DX/구조 | — |
| ✅ P3 | `/admin/banner` prerender 실패 — firebase getAuth 지연 초기화 (2026-05-17 세션33 완료) | 환경설정 | — |
| ✅ P3 | G1: `hubs/[id]/edit/page.tsx` 거점 수정 페이지 — GET 프리필 + apiJson PATCH + 상세 헤더 진입 버튼 (2026-05-17 세션37, `3888522`) | 기능 | — |
| 🟢 P3 | Driver Kakao Maps SDK 연동 | 기능 | — |
| ✅ P3 | 셀러 홈 대시보드 + 준비 물량 재구성 — 8 아토믹 태스크 (#CL-33, 2026-05-18 세션39 완료) | UX/기능 | `specs/frontend/seller-home-dashboard-plan.md` |
| 🟢 P4 | 준비 물량 탭 — 공동구매 주문 포함 (배송일 `groupProductConfig` 별도 fetch 필요, 세션39 분리) | UX/기능 | — |
| 🟢 P4 | 당일 배송 컷오프 — 소비자 앱 배송일 선택 시간 제약 (세션38 분리) | 소비자 UX | — |
| ✅ P3 | consumer@test.com 강한비번 전환 — 30자 랜덤 비번 (2026-05-17 세션34 완료) | 보안 | 단독 |
| ✅ P4 | global-setup flake 보강 — bypass 루프 직후 `about:blank` 이동으로 `storageState` 레이스 해소 (2026-05-17 세션37, `be4fa2c`) | e2e 안정성 | 단독 |
| ✅ P4 | CI 액션 Node.js 20 deprecation 대응 — checkout/setup-node v6·upload-artifact v7·pnpm/action-setup v6, node-version 22 (2026-05-17 세션37, `eb15e4e`) | CI 유지보수 | 단독 |
| ⏳ 외부 | 네이버페이 채널키 승인 → Vercel 환경변수 설정 | 외부 연동 | 승인 메일 대기 |

### 12-2. 상세 작업

#### [x] P0 — #CL-21 옵션 A 보강: Production env 분리 (4단계, 2026-05-15 세션26 완료)

**배경**: 옵션 B 헤더 게이팅(#CL-20)으로 폼 노출은 차단됐으나 SECRET이 production·preview에 동일하게 존재 → SECRET 유출 시 production 인증 위험. 옵션 A는 Production env에서 `E2E_TEST_SECRET` 자체를 제거해 attack surface 축소.

- [x] 1. `preview` 브랜치 신설 → Vercel branch Preview 배포 자동 생성 (`{project}-git-preview-…vercel.app`)
- [x] 2. 21개 spec `BASE` 환경변수화 (`SELLER_BASE`·`CONSUMER_BASE`·`DRIVER_BASE`) + `apps/e2e/.env` 추가
- [x] 3. `.github/workflows/e2e.yml` 신설 — `preview` 브랜치 push 시 Preview 대상 e2e
- [x] 4. Vercel seller·consumer Production env에서 `E2E_TEST_SECRET` 삭제 + 빈 커밋 재배포
- [x] 3.5. Preview SSO 우회 — Protection Bypass for Automation + `global-setup.ts` storageState

**검증 완료**: 옵션 B 4종 — Production seller·consumer는 유효 헤더로도 거부, Preview는 정상 통과. smoke seller-orders 11/12·consumer-mypage 9/10.

**잔여 후속**: 아래 「P1 — #CL-21 후속」 참조.

**참조**: [docs/CRITICAL_LOGIC.md #CL-21](CRITICAL_LOGIC.md)

---

#### [x] P1 — #CL-21 후속: e2e CI 활성화 (2026-05-16 세션27 완료)

**배경**: 세션26에서 `.github/workflows/e2e.yml`을 신설했으나 GitHub repo Secrets가 미등록 → `preview` 브랜치 push 시 워크플로가 시크릿 미해석으로 실패했다.

**1. GitHub repo Secrets 등록 (11개)** — `gh secret set`으로 `apps/e2e/.env` 11개 값 전부 등록 완료.
- [x] `SELLER_BASE` · `CONSUMER_BASE` · `DRIVER_BASE`
- [x] `SELLER_BYPASS_SECRET` · `CONSUMER_BYPASS_SECRET` · `DRIVER_BYPASS_SECRET`
- [x] `E2E_TEST_SECRET`
- [x] `TEST_SELLER_EMAIL` · `TEST_SELLER_PASSWORD` · `TEST_CONSUMER_EMAIL` · `TEST_CONSUMER_PASSWORD`

**2. `preview` 브랜치 동기화 — 자동 머지 워크플로 채택**
- [x] `.github/workflows/sync-preview.yml` 신설 — `main` push 시 `preview` 자동 merge·push + e2e 디스패치. 검증: `origin/preview` = `origin/main` 자동 동기 확인.

**3. e2e.yml 버그 수정**
- [x] `pnpm/action-setup` `version: 9` 고정 제거 → `package.json` `packageManager`(pnpm@10.32.1) 자동 사용 (ERR_PNPM_BAD_PM_VERSION 해소).

**가동 결과**: CI 워크플로 end-to-end 정상 가동 (124 passed, 리포트 아티팩트 업로드). 단 **37건 실패** — 전부 셀러 인증 spec, `auth.ts:64` 진단 throw가 잡은 `set-cookie count=0` = **#CL-23 인증 race와 동일 시그니처**. CI는 12 spec×독립 인증으로 race를 로컬(4건)보다 증폭. → 아래 #CL-23 항목이 직접 후속.

**잔여 운영 메모**: sync-preview가 e2e를 즉시 디스패치 → Vercel preview 재빌드 중 실행 가능성. #CL-23 해소 후 배포 readiness 대기 단계 추가 검토.

**참조**: [docs/CRITICAL_LOGIC.md #CL-21](CRITICAL_LOGIC.md)

---

#### [x] P1 — #CL-23 인증 race 해소: `storageState` 패턴 도입 (2026-05-16 세션28 완료)

**배경**: NextAuth credentials POST가 200 OK + 빈 body + set-cookie 없음 반환하는 race가 세션27 e2e CI 풀런(run 25926181316)에서 37건 재현. spec마다 `beforeEach(loginViaCredentials)` → 인증 호출 N×spec 누적이 race 증폭.

**해소**: `globalSetup`에서 seller·consumer 1회 로그인 → `.auth-state.json` storageState 저장 → 인증 spec이 `test.use({ storageState })`로 재사용. 인증 호출 풀런당 67회+retry → 2회.

- [x] T0. 실패 37건 증거 재분류 — A 인증 race 23 / B Railway `Failed to fetch` 5 / C waitForLoadState 2 / D realtime 미정착 7. (커밋 1da31fa)
- [x] T1. `global-setup.ts` 확장 — seller·consumer storageState 발급 + globalSetup 로그인 재시도(보강). (786cc9d, 52d33e0)
- [x] T2. `playwright.config.ts` + 11개 인증 describe `test.use({ storageState })` 배선. (0d65812)
- [x] T3. spec 개별 `loginViaCredentials` 제거 (헬퍼·globalSetup은 유지). (cb5b77b)
- [x] T4. e2e CI 2회 연속 풀런 — `set-cookie count=0` 두 번 모두 0건. 124/37 → 145/16, 146/15.
- [x] T5. 잔여 B·C·D 분리 기록(본 §12-2) + 인증 호출 N→1 구조 확정.

**결과**: 인증 race 23→0 해소 확정. 잔여 14~15건은 storageState 무관(아래 B·C·D 항목).

**진입 가이드**: [docs/archive/sessions/session28-prep.md](archive/sessions/session28-prep.md) (T0 분류 확정표 포함)
**참조**: [docs/CRITICAL_LOGIC.md #CL-27](CRITICAL_LOGIC.md)

---

#### [x] 세션29 — e2e 잔여 B·C·D 해소 (2026-05-16)

세션28 #CL-23 T4 후 잔여 14~15건. 세션29 T0에서 최신 풀런 run 25952638293으로 재확인 — **B 5 · C 2 · D 8 · flake 1** (세션28과 동일, 인증 race `set-cookie count=0` 0건 유지 → #CL-27 회귀 없음).

**진입 가이드**: [docs/archive/sessions/session29-prep.md](archive/sessions/session29-prep.md)

**[x] C — perf-css `waitForLoadState` 타임아웃 2건** — 완료·검증
- 대상: `perf-css-regression:87`·`:103` (Seller 로그인).
- 원인(trace 확정): Vercel preview의 `vercel.live` 피드백 위젯 상시 연결로 `networkidle`(500ms 무네트워크) 영영 미정착. 페이지 리소스는 ~2.7s 내 전부 완료·Firebase 호출 0건 → 앱 버그 아님.
- 수정: `networkidle` 대기 제거 → 로그인 폼 렌더 대기 + 1.5s 정착. 로컬 perf-css 15/15 통과. (커밋 `0d466f1`)

**[x] B·D — Railway API CORS preview origin 누락** — 해소 완료·검증
- B 대상: `consumer-groupbuy:14`·`consumer-mypage:74`·`seller-onboarding:45`·`:76`·`seller-settlements:98`. D 대상: `seller-home-dashboard` ×7 + `seller-orders:65`.
- 원인(trace 확정): Railway API가 Vercel preview origin에 `Access-Control-Allow-Origin` 미발급 → CORS 차단. B = 앱 `apiFetch` REST 호출 실패. D = `useFirebaseAuth`의 `/auth/firebase-token` fetch 실패 → `firebaseReady=false` → 대시보드 indicator `연결 중` 고착. **D는 독립 버그가 아닌 B의 하위 증상 — 단일 원인.**
- cold-start 가설 반증: 실패가 풀런 04:24~04:34 전구간 분포, `firestore.googleapis.com`은 정상 200 → Railway origin만 선택적 차단 = CORS.
- 수정: `apps/api/src/main.ts` origin 콜백에 `jos-projects-d1cecc0c` 팀 스코프 한정 정규식 추가. (커밋 `6542ecc`, #CL-28)
- [x] **검증 완료**: `c5ee52f` push가 Railway 자동 재배포 트리거 → preview origin CORS 발급·비매칭(`evil.example.com`) 차단 curl 확인 → e2e 풀런 run 25957177092 **167 passed / 0 failed / 11 skipped**. B 5·D 8 + 인증 race 전부 해소. D spec 무변경.

#### [x] P2 — Railway `/auth/login` 로그 계측 (2026-05-16 세션31 완료)

#CL-23으로 인증 호출은 풀런당 67회+retry → 2회로 **구조상 N→1 확정**. 본 세션에서 latency 수치화 완료.

**계측 방법**: Railway 배포 로그에는 요청 단위 로그가 전무 → synthetic 측정 스크립트 `scripts/measure-api-latency.mjs` 신설(Railway CLI로 대시보드 없이 접근). 측정 환경: Railway 리전 `asia-southeast1` ↔ 측정 클라이언트.

| endpoint | n | min | p50 | p95 | p99 | 실패율 |
|----------|---|-----|-----|-----|-----|--------|
| GET /health | 60+ | 379ms | 409ms | ~440ms | cold 1.0~1.1s | 0% |
| POST /auth/login | 24 | 848ms | 922ms | 1551ms | 1687ms | 0% |

- `/auth/login` 서버 작업 ≈ ~510ms (Firestore 조회 + bcrypt factor-12 + JWT 서명 + 토큰 set). bcrypt-12 지배적.
- p95/p99(1.5~1.7s)는 62초 idle 후 첫 요청의 TLS 재handshake 측정 아티팩트 — 서버 tail 아님.
- 0% 실패. ~0.9s steady latency는 e2e 차단 요인 아님(#CL-28 cold-start 반증 재확인).

- [x] `/auth/login` 응답시간 p50/p95/p99 + 실패율 추출 — `measure-api-latency.mjs`
- [x] (옵션) 정기 수치화 — 별도 endpoint 대신 재사용 가능 측정 스크립트 채택
- [x] **부수 발견·수정**: throttler 전역 누수 버그 (#CL-30, 아래 항목)

상세: [docs/CRITICAL_LOGIC.md #CL-30](CRITICAL_LOGIC.md)

---

#### [x] P2 — Railway throttler 전역 누수 수정 (2026-05-16 세션31 완료)

P2-A 계측 중 `/health`가 ~10~19회 후 429 반환 발견. `ThrottlerModule`의 named throttler는 **전 라우트에 전역 적용**되므로, `auth`(10/분) throttler 등록만으로 `/health` 등 비인증 라우트까지 10/분에 묶여 `default`(100/분) 의도가 무효화된 상태였다.

- [x] `app.module.ts`: `auth` throttler 제거 → `default`(100/분) 단일 등록
- [x] `auth.controller.ts`: register·login·kakao-login·refresh를 `@Throttle({ default: { limit: 10, ttl: 60000 } })`로 라우트 한정 오버라이드
- [x] 커밋 `23e3528` push → Railway 자동 재배포
- [x] 검증 — 재배포 후 응답 헤더: `/health` `x-ratelimit-limit:100`·`/auth/login` `x-ratelimit-limit:10`

상세: [docs/CRITICAL_LOGIC.md #CL-30](CRITICAL_LOGIC.md)

---

#### [x] 세션32 — e2e 안정성 2건 해소 (2026-05-17)

세션31 T0에서 발견·기록만 했던 e2e 안정성 이슈 2건. 167/0 베이스라인을
견고히 하기 위해 P3 착수 전 우선 처리.

**[x] consumer-groupbuy:14 flake** — 완료·검증
- 원인: `waitForSelector('모집 중').catch()` 후 `empty.isVisible()`가 false면
  "모집 중"을 강제 단언하는데, 페이지 로딩 중이면 리스트도 empty-state도 없어
  `isEmpty=false`로 오판.
- 수정: `list.or(empty)`가 visible 될 때까지 대기한 뒤 분기. (커밋 `abd2a13`)

**[x] cleanup-spec-residue CI 인증 실패** — 완료·검증
- 원인: `scripts/cleanup-spec-residue.mjs`가 gitignore된 로컬 키
  `apps/api/firebase-adminsdk.json`을 `require` → CI 러너엔 파일 부재로 `exit=1`,
  seller-auth-invite `afterAll` 정리가 CI에서 무력화(세션22 이후 상존).
- 수정: `FIREBASE_SERVICE_ACCOUNT_JSON` env 우선·로컬 키 fallback(`firestore.module.ts`와
  동일 규약) + `e2e.yml` env 주입 + repo Secret 등록. (커밋 `b095023`)
- 후속: Secret을 Windows gh CLI 파이프로 업로드 시 선두 BOM(U+FEFF) 혼입 →
  `JSON.parse` 실패. env JSON BOM/공백 제거 방어 + Secret 재업로드(no-BOM). (커밋 `4934468`)
- **검증**: e2e 풀런 run 25965438455 **167 passed / 0 failed**,
  cleanup 로그 `users=2 tokens=0 skipped=0` (잔여 계정 2건 정상 삭제).

---

#### [⏹️] P2 — Vercel function cold-start mitigation 검토 (moot)

당초 NextAuth API route cold start가 set-cookie 누락 원인일 가능성으로 등재. 그러나 #CL-28(set-cookie race = CORS)·#CL-30(P2-A 계측 0% 실패·~0.9s steady)으로 **cold-start는 e2e 차단 요인이 아님이 2중 확인**됨. 별도 mitigation 작업은 데이터상 불필요 — 실사용 성능 이슈가 관측되면 그때 재등재.

---

#### [x] P2 — `CRITICAL_LOGIC.md` 한도 정책 결정 (2026-05-16 세션30 완료)

**현황(착수 시)**: 1415라인 (#CL-28까지). CLAUDE.md §1는 단일 파일 500라인 모듈화 한도.

**결정 — 옵션 3 변형 채택** (사용자 협의):
- 누적 시계열 결정 로그는 코드 모듈과 성격이 달라(분리 시 이력 파편화·#CL 연속성·앵커 링크 손상) 500라인 모듈화 한도의 **예외**로 명시. `BACKLOG.md`·memory 아카이브도 동일 부류.
- 단, 무한 증가 방어를 위해 **크기 기반 트리거** 추가: `CRITICAL_LOGIC.md` 1000라인 초과 시 종결·SUPERSEDED 엔트리를 `docs/archive/`로 이관, 활성 파일 ~500라인으로 축소. (옵션 1의 분기 기준 대신 크기 기준 — 죽은 엔트리만 이관해 #CL 연속성 보존.)

**적용 작업 (완료)**:
- [x] `#CL-19`(2026-05-08) 경계로 분할 — 2026-03~04 #CL 이전 종결 엔트리(1208라인)를 `docs/archive/CRITICAL_LOGIC_archive_20260516.md`로 이관.
- [x] 활성 `CRITICAL_LOGIC.md` → 229라인(헤더 + #CL-19~#CL-29 + 아카이브 포인터).
- [x] `CLAUDE.md` §1에 누적 결정 로그 예외 + 1000라인 트리거 규칙 명시, §2 체크리스트 단서 추가.
- [x] 정합성 검토 — `CRITICAL_LOGIC.md` 참조 링크 점검: #CL-19~28 참조는 활성 파일 유지로 무손상. 아카이브로 이동한 섹션 참조 2건(`BACKLOG.md` §거점 픽업, `orders/orders.md` §판매자 취소 권한) 아카이브 경로로 정정.

---

#### [x] P3 — `useOrderActions` 훅 통합 (2026-05-17 세션36 완료)

**배경**: 세션23 #CL-22에서 분리됐던 항목. detail용 `useOrderDetailActions`(모달 reason + apiFetch)와 OrderCard용 `useOrderActions`(prompt() reason + raw fetch) 시그니처 불일치.

**처리**: seller 프론트엔드 5-Phase 리팩토링(#CL-32)의 Phase 4로 일괄 정비. 공통 코어 `useOrderStatusUpdate`(PATCH·loading·error) 신설 — 두 훅이 코어를 공유하고 사유 입력 UI(prompt vs 모달)만 래퍼에서 분기. 시그니처는 `updateStatus(status, extra)`로 통일, 외부 반환 형태는 보존(소비처 무수정). e2e 167/0 회귀 없음(run 25970814882 재실행). 상세: [docs/CRITICAL_LOGIC.md #CL-32](CRITICAL_LOGIC.md)

---

#### [x] P3 — `/admin/banner` prerender 실패 (2026-05-17 세션33 완료)

**배경**: 세션23 빌드 검증(#CL-22)에서 `auth/invalid-api-key`를 사전 결함으로 기록. admin/banner 페이지 자체는 무관.

**원인 확정**: `apps/seller/src/lib/firebase.ts`가 모듈 최상위에서 `getAuth(app)`를 평가 → `apiKey` 부재 시 `getAuth`가 동기 throw → 빌드 prerender 단계에서 firebase를 import하는 첫 페이지(`/admin/banner`)가 크래시. Vercel 빌드는 env 존재로 무영향(앱 정상 배포·e2e 167/0) — 실패는 로컬·env 미주입 빌드 한정.

**처리**: `getAuth`/`getStorage`를 지연 초기화 함수(`getFirebaseAuth`/`getFirebaseStorage`)로 전환. 사용처가 전부 클라이언트 런타임(useEffect·핸들러)이라 모듈 로드 시점 평가 불필요. 검증 — 수정 전 로컬 빌드 크래시 재현, 수정 후 빌드 성공. 커밋 `32738fb`. 상세: [docs/CRITICAL_LOGIC.md #CL-31](CRITICAL_LOGIC.md)

---

#### [x] P3 — consumer@test.com 강한비번 전환 (2026-05-17 세션34 완료)

**배경**: 세션22에서 `consumer@test.com` 발급 시 편의 우선으로 약한비번(`test1234!`)을 채택. 보안 follow-up으로 등재돼 있었다. 세션34에 사용자가 보안 우선으로 정책을 재확인 → 전환 착수.

**처리**: `scripts/reset-user-password.mjs`로 Firestore `users` 문서 `passwordHash`를 30자 랜덤 비번(bcrypt-12)으로 갱신. `apps/e2e/.env`(gitignored)·repo Secret `TEST_CONSUMER_PASSWORD` 동기 교체. `/auth/login` curl — 새 비번 200·기존 비번 401 확인. e2e 풀런 run 25966655016 **167 passed / 0 failed / 11 skipped**. `seller@test.com`은 본 항목 범위 밖이라 약한비번 유지.

#### [ ] P3 — 기타 기능 작업

- [ ] G1: `apps/seller/src/app/hubs/[id]/page.tsx` — 거점 수정 페이지 (Phase B 잔여)
- [ ] Driver Kakao Maps SDK 연동

#### [ ] P4 — e2e 안정성·CI 정비 (세션36 관찰 등재)

**배경**: 세션36 머지 후 e2e 1차 실행이 `global-setup.ts:133` `context.storageState()`에서 실패 — `Navigation interrupted by another navigation to /login`. 재실행은 167/0 통과 → flake 확정(코드 무관, consumer 앱 미변경).

- [ ] **global-setup flake 보강**: `loginWithRetry`는 `loginViaCredentials`의 throw만 흡수하고, 로그인 성공 후 `storageState` 시점의 in-flight 네비게이션 레이스는 못 잡는다. `global-setup.ts:133` `context.storageState()` 직전에 `page.waitForLoadState('networkidle')`(또는 명시적 안정 대기)를 넣어 레이스 창을 닫는다. 규모 소(小). #CL-23/#CL-27 인증 레이스 계열의 잔여 보강.
- [ ] **CI 액션 Node.js 20 deprecation**: `actions/checkout@v4`·`actions/setup-node@v4`·`actions/upload-artifact@v4`·`pnpm/action-setup@v4`가 Node.js 20 — 2026-06-02 강제 Node.js 24 전환. 각 액션 최신 버전으로 갱신하거나 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` 설정. `.github/workflows/*.yml` 전반 점검.

#### [⏳] 외부 대기

- [ ] 네이버페이 채널키 승인 → Vercel `NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY` 환경변수 설정 (admin.pay.naver.com 심사 결과 대기)

### 12-3. 본 사이클 완료 항목 (참고)

| 세션 | 결정 ID | 내용 |
|------|---------|------|
| 22 | #CL-20 | 옵션 B 헤더 게이팅 도입 — `auth.ts` Credentials를 `x-e2e-test-token`으로 게이팅, 12 spec helper migration |
| 22 | — | Vercel `E2E_TEST` Production env 삭제 + 약한비번 54건 일소 (보존 2건) |
| 23 | #CL-22 | 셀러 페이지 분할 — `orders/[id]` 629→217·`settlements` 531→116 (fatal constraint 해소) |
| 24 | #CL-23 | e2e 회귀 검증 (회귀 0건) + 인증 헬퍼 진단 강화 (set-cookie 검증 throw) |
| 25 | #CL-25 | biome.json 파싱 에러 해소 + `.env.vercel.tmp` gitignore 보강 + driver Credentials provider 부재 검증 |

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-03-28 | 초안 작성 |
| 2026-03-28 | seller 앱 스캐폴딩 + Firestore 연동 완료 체크 |
| 2026-03-28 | stores·settlements·hubs API + seller 앱 핵심 화면 완료 체크 / 7차 정합성 검토 반영 |
| 2026-03-28 | 다중 판매자 §6 추가, 거점 배송 §8 추가 |
| 2026-03-28 | **8차 정합성 검토**: C-1~C-3 수정 완료, /products 폼 구현 완료, 우선순위 재정비 |
| 2026-03-28 | **배포 완료**: Vercel seller + Railway + Firebase 인덱스 / seller 온보딩 버그 수정 / E2E 동작 확인 |
| 2026-04-01 | consumer 마이페이지 Phase B (배송지 관리·알림 내역) + admin 실배포 검증 + 정합성 검토 4건 수정 |
| 2026-04-02 | `/category` 버그 수정(인덱스·레이아웃) + seller 상품 삭제 버튼 + 상품 상세 판매자 정보 + Firestore 보안 규칙 수정 |
| 2026-04-03 | 드라이버 앱 IA 완료 체크 + §9 드라이버 정산 시스템 신규 추가 |
| 2026-04-08 | **버그 수정**: BUG-01(장바구니 다중 상품) · BUG-02(결제 중복) · BUG-04(fetch shadowing) · BUG-08/09(useAdmin 에러 핸들링) · BUG-10(alert→notification) · BUG-12(dynamic 제거) · BUG-15(PENDING/RECRUITING 탭) 완료. BUG-03은 Firestore Rules 강화 시점으로 보류 |
| 2026-04-08 | **UX 개선**: UX-01(3개 앱 viewportFit·safe-area) · UX-02(결제 중 beforeunload 이탈 방지) · UX-06(checkout Daum 우편번호 연동) 완료 |
| 2026-04-03 | **드라이버 앱 구현 완료**: `apps/driver` PWA + API 수정 (driverId·photoUrl) + `GET /driver/orders` + 전체 9화면 |
| 2026-04-03 | **드라이버 앱 배포 완료**: `POST /auth/kakao-login` API + 카카오 개발자 앱 설정 + Vercel 배포 + NextAuth v5 쿠키명 수정 + 카카오 로그인 E2E 검증 |
| 2026-04-03 | **정합성 검토**: Firebase Storage 로고 업로드·CSV 다운로드 완료 체크 반영 (단계 26 누락분) |
| 2026-04-03 | §10 드라이버 플랫폼 노동 모델 전환 과제 신규 추가 |
| 2026-04-04 | **consumer 앱 Mantine 마이그레이션 완료** (21개 TSX, Tailwind 완전 제거, 빌드 성공, git push) |
| 2026-04-04 | **프로덕션 E2E 완성**: 소비자 앱 상품 표시 수정 (API 방식 + 페이지네이션 언래핑) → seller 앱 인증 오류 수정 (NEXTAUTH_URL·@Roles 어노테이션·ownerId 패치) → Firestore rules list 허용 → KakaoPay 결제 완료 → seller 실시간 주문 수신 전체 확인 |
| 2026-04-04 | **Refresh token 자동 갱신 구현**: `POST /auth/refresh` API + consumer·seller·driver 앱 jwt 콜백 (55분 타이머 + 자동 재발급) |
| 2026-04-04 | **URLS.md 신설**: 서비스 URL SSOT — Vercel 환경변수·Railway CORS_ORIGIN·카카오 리다이렉트 URI 일원화 |
| 2026-04-04 | **seller 앱 Mantine 마이그레이션 완료**: 33개 TSX Tailwind → Mantine v9, 빌드 성공, Vercel 배포 완료 |
| 2026-04-04 | **FSM 버그 수정**: orders FSM admin role 허용 + JWT role 우선 사용 + 에러 피드백 추가 |
| 2026-04-04 | **E2E 연속 검증 완료**: seller PREPARING → driver DELIVERING → consumer 배송 중 실시간 확인 |
| 2026-04-04 | **버그 3건 수정**: consumer 이름 '???' fallback / orders denormalize(productName·address) / driver deliveryAddress fallback |
| 2026-04-05 | **seller·driver name fallback**: session callback '???' → email prefix (auth.ts 3개 앱 통일) |
| 2026-04-05 | **REVIEWED 타임라인 fix**: 구매 확정 후 마지막 step done 체크 표시 |
| 2026-04-05 | **orders denormalize fix**: address+addressDetail 합산 저장 / API buyerName '???' fallback |
| 2026-04-05 | **MVP E2E 완전 종료**: 결제→준비→배송→배송완료→구매확정 전 구간 실검증 완료 |
| 2026-04-05 | **정합성 검토 3건 수정**: createOrder denormalize 확장(sellerPhone·buyerPhone·hubName·hubAddress) + shared Order 타입 현행화 + driver proxy.ts 통일 |
| 2026-04-06 | **카카오 로그인 role 정책 확정**: consumer 앱에서 seller/admin 허용 + 3개 앱 name null fallback 수정 + API allowedRoles 확장 |
| 2026-04-06 | **운영자 계정 구조 확정**: 단일 카카오 계정(admin) → Consumer·Seller 모두 로그인 가능 / Driver는 별도 카카오 계정 사용 |
| 2026-04-06 | **Consumer 카카오 로그인 E2E 검증 완료**: greenlove.co.kr 정상 로그인 확인 |
| 2026-04-06 | **groupProductConfig Firestore 인덱스 누락 확인**: isProcessed + recruitDeadline 복합 인덱스 미배포 — 별도 처리 필요 |
| 2026-04-07 | **Seller 카카오 로그인 E2E 검증 완료**: seller.greenlove.co.kr 정상 로그인 확인 + proxy admin 버그 수정 |
| 2026-04-07 | **groupProductConfig 인덱스 배포**: Railway 1분 주기 에러 해소 |
| 2026-04-07 | **네이버페이 파트너 가입 신청 완료**: admin.pay.naver.com 심사 중 (3~5 영업일) |
| 2026-04-07 | **네이버페이 결제 코드 준비**: usePayment paymentMethod 분기 + checkout 결제수단 선택 UI (채널키 없으면 자동 숨김) |
| 2026-04-08 | **seller admin 루트 리다이렉트**: page.tsx role 분기 — admin → /admin/stores |
| 2026-04-08 | **프론트엔드 보안 감사 및 수정**: Critical 5건·High 9건·Medium 10건+ 식별 / SEC-01~07·09~11 수정 완료 |
| 2026-05-10 | **세션22**: 보안 결함 정리 — Vercel `E2E_TEST` Production 제거·약한비번 54건 일소·옵션 B 헤더 게이팅 도입 (#CL-20) |
| 2026-05-15 | **세션23**: 셀러 fatal constraint 해소 — `orders/[id]`·`settlements` 페이지 분할 (#CL-22) |
| 2026-05-15 | **세션24**: e2e 회귀 검증 (회귀 0건) + 인증 헬퍼 진단 강화 (#CL-23) |
| 2026-05-15 | **세션25**: 사전 결함 정리 — biome 파싱 에러·`.env.vercel.tmp` gitignore·driver Credentials 부재 검증 (#CL-25) / §12 후속 정비 백로그 신설 |
| 2026-05-15 | **세션26**: #CL-21 옵션 A 보강 — `preview` 브랜치 신설(Vercel branch Preview 자동 배포)·21개 spec `BASE` 환경변수화·`.github/workflows/e2e.yml` 신설. Vercel seller·consumer Production env `E2E_TEST_SECRET` 삭제(Preview·Development 유지·#CL-21). Preview SSO 우회 — Protection Bypass 시크릿 3개 + `global-setup.ts` `_vercel_jwt` storageState 도입 |
| 2026-05-16 | **세션27**: #CL-21 후속 — gh CLI 설치·repo Secrets 11개 등록·`sync-preview.yml` 자동 머지 워크플로 신설·e2e.yml pnpm 충돌 수정. e2e CI 가동(124 passed/37 fail). 37건은 #CL-23 인증 race로 확정 |
| 2026-05-16 | **세션28**: #CL-23 인증 race 해소 — e2e storageState 패턴 도입(T0~T5). 실패 37건 증거 재분류(A23/B5/C2/D7), globalSetup 세션 쿠키 발급 + 11개 인증 describe 배선 + spec 로그인 제거. CI 2회 풀런 124/37→145/16·146/15, `set-cookie count=0` 0건. 잔여 B·C·D는 §12-2 분리 기록 (#CL-27) |
| 2026-05-16 | **세션29**: e2e 잔여 B·C·D 해소. T0 run 25952638293 재확인(B5·C2·D8·flake1). C — perf-css `networkidle` 제거(vercel.live 상시 연결 원인, 로컬 15/15 통과). B·D — trace로 단일 원인 확정: Railway API가 Vercel preview origin에 CORS 미허용 → `apiFetch`·`/auth/firebase-token` 차단. `main.ts`에 팀 스코프 정규식 추가 (#CL-28). 재배포(c5ee52f push 자동 트리거) 후 풀런 run 25957177092 **167 passed / 0 failed / 11 skipped** — B5·D8 + 인증 race 전부 해소 |
| 2026-05-16 | **세션30**: P2-C `CRITICAL_LOGIC.md` 한도 정책 — 옵션 3 변형 채택(누적 결정 로그는 500라인 모듈화 예외 + 1000라인 초과 시 종결 엔트리 아카이브). `#CL-19` 경계로 분할 — 2026-03~04 종결 엔트리 1208라인을 `archive/CRITICAL_LOGIC_archive_20260516.md`로 이관, 활성 파일 1415→229라인. `CLAUDE.md` §1 예외 규칙 명시 |
| 2026-05-16 | **세션31**: P2-A Railway latency 계측 — synthetic 측정 스크립트 `scripts/measure-api-latency.mjs` 신설(Railway CLI 접근, `/auth/login` p50 922ms·0% 실패·서버작업 ~510ms). 계측 중 throttler 전역 누수 버그 발견 — `auth`(10/분) throttler가 `/health` 등 비인증 라우트까지 적용. `app.module.ts` `auth` throttler 제거 + 인증 라우트 `@Throttle` 라우트한정 오버라이드 (#CL-30). 재배포(23e3528) 후 헤더 검증, e2e run 25962635875 167/0. P2-B는 moot 종결 |
| 2026-05-17 | **세션32**: e2e 안정성 2건 해소. ① `consumer-groupbuy:14` flake — `list.or(empty)` 확정 렌더 대기로 오판 차단(`abd2a13`). ② `cleanup-spec-residue` CI 인증 실패 — `FIREBASE_SERVICE_ACCOUNT_JSON` env 기반 인증 전환 + `e2e.yml`·repo Secret 등록(`b095023`), Windows gh CLI 파이프 BOM 혼입 방어 + Secret no-BOM 재업로드(`4934468`). 풀런 run 25965438455 **167/0**, cleanup `users=2` 정상 삭제 |
| 2026-05-17 | **세션33**: P3 `/admin/banner` prerender 실패 해소. 원인 — `firebase.ts`가 모듈 로드 시 `getAuth(app)` 평가 → apiKey 부재 시 동기 throw → 빌드 prerender 첫 firebase-import 페이지 크래시. `getAuth`/`getStorage` 지연 초기화 함수로 전환(사용처 전부 클라이언트 런타임). env 미주입 로컬 빌드 — 수정 전 크래시 재현, 수정 후 빌드 성공. Vercel은 env 존재로 무영향(환경변수 조치 불필요 확정). 커밋 `32738fb` (#CL-31) |
| 2026-05-17 | **세션34**: P3 consumer@test.com 강한비번 전환. `reset-user-password.mjs`로 Firestore `passwordHash`를 30자 랜덤 비번(bcrypt-12)으로 갱신, `apps/e2e/.env`·repo Secret `TEST_CONSUMER_PASSWORD` 동기 교체. `/auth/login` curl로 새 비번 200·기존 401 확인, e2e 풀런 run 25966655016 **167/0**. 세션22 편의 결정(`feedback_security_convenience`)을 보안 우선으로 재확인·전환 |
| 2026-05-17 | **세션35**: docs 정리 세션 — P3 잔여 3건은 사용자 결정으로 별도 세션 이관. `memory.md` 200라인 한도 임박(197) → 50라인 이내 요약(50라인)·세션22~34 상세를 `archive/memory_archive_20260517.md`로 아카이브. 폴더 이동(`docs/design/`·`docs/specs/api/`)으로 깨진 design↔api spec 상호 참조 링크 14곳 수정. 본 변경 이력 — 세션32 행 순서 보정·누락된 세션26 행 추가. 코드 변경 없음 |