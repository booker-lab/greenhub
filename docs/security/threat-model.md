# Greenhub 보안 위협 모델

작성일: 2026-07-07  
대상: 소비자앱, 셀러앱, 드라이버앱, API, Firebase rules

## 시스템 개요

Greenhub는 pnpm monorepo로 구성되어 있다.

| 영역 | 경로 | 주요 역할 |
| --- | --- | --- |
| 소비자앱 | `apps/consumer` | 상품 탐색, 장바구니, 주문, 결제, 마이페이지 |
| 셀러앱 | `apps/seller` | 상품 관리, 주문 관리, 정산, admin 화면 |
| 드라이버앱 | `apps/driver` | 배송 보드, 주문 상세, 지도, 배송 상태 처리 |
| API | `apps/api` | 인증, 주문, 결제, 정산, 상품, 스토어, 드라이버, 알림 |
| 공유 타입 | `packages/shared` | 공통 타입과 도메인 계약 |
| Firebase rules | `firestore.rules`, `storage.rules` | 클라이언트 직접 접근 제어 |

## 신뢰 경계

| 경계 | 설명 | 주요 위험 |
| --- | --- | --- |
| 브라우저와 API | 사용자가 조작 가능한 요청이 API로 들어옴 | role, id, 금액, 상태 값 변조 |
| NextAuth 세션과 API JWT | 앱 세션과 API 인증 정보가 연결됨 | 세션 role 불일치, 토큰 검증 누락 |
| API와 Firestore Admin SDK | 서버가 권한 있는 DB 작업 수행 | 소유권 검증 누락 시 전체 데이터 접근 |
| Firestore client SDK와 rules | 일부 공개 데이터는 클라이언트 직접 조회 | rules가 API 정책보다 넓을 수 있음 |
| 외부 결제/인증 제공자 | Kakao, PortOne 등 외부 콜백 | 콜백 위조, 금액 검증 누락 |
| Vercel preview와 테스트 우회 | preview protection bypass, 테스트 계정 | 우회 secret 노출, preview와 production 혼동 |

## 역할별 보안 관심사

### 소비자앱

주요 자산:

- 사용자 계정과 세션
- 주문 내역
- 배송지와 연락처
- 결제 요청과 결제 결과
- 장바구니와 PWA cache

주요 점검:

- 비로그인 사용자가 보호 페이지에 접근할 수 없는가
- 주문 생성 시 `userId`, 금액, 상품 가격, 배송비를 클라이언트 값으로 신뢰하지 않는가
- 결제 성공 처리에서 PortOne 검증과 서버 금액 검증이 있는가
- 마이페이지 주문 조회가 본인 주문으로 제한되는가
- PWA cache나 localStorage에 민감 정보가 남지 않는가

### 셀러앱

주요 자산:

- 상품 정보
- 주문 상태
- 정산 데이터
- 스토어 설정
- admin 경로와 운영 기능

주요 점검:

- `storeId` 소유권 검증이 모든 seller API에 있는가
- seller가 다른 store의 주문, 상품, 정산을 조회/수정할 수 없는가
- admin role이 필요한 화면과 API가 seller role로 열리지 않는가
- 주문 상태 전이가 role별 허용 범위를 지키는가
- 정산 금액과 수수료가 클라이언트 입력으로 변조되지 않는가

### 드라이버앱

주요 자산:

- 배정 주문
- 배송 상태
- 배송 주소와 연락처
- 지도/위치 정보
- 배송 인증 사진

주요 점검:

- driver가 자신에게 배정되지 않은 주문을 볼 수 없는가
- 배송 상태 전이가 driver에게 허용된 범위로 제한되는가
- `driverId`를 클라이언트가 임의로 바꿔 요청해도 서버에서 검증하는가
- 지도/위치 정보가 과도하게 저장되거나 노출되지 않는가
- 인증 사진 업로드와 조회 권한이 제한되는가

### API와 Firebase

주요 자산:

- JWT secret과 provider secret
- Firebase service account
- Firestore 데이터
- 주문/결제/정산 도메인 계약
- rate limit과 CORS 정책

주요 점검:

- 모든 민감 API에 `JwtAuthGuard`와 `RolesGuard`가 적절히 적용되는가
- role과 id 검증이 Firestore 재조회 실패 시 안전하게 실패하는가
- Firestore rules가 클라이언트 직접 접근을 과도하게 허용하지 않는가
- CORS가 production/preview/local 의도와 맞는가
- `firebase-adminsdk.json`, bypass secret, 테스트 계정 정보가 저장소에 남아 있지 않은가
- webhook은 서명, 원본, idempotency, 금액 검증을 갖추는가

## 공통 공격 시나리오

| ID | 시나리오 | 우선순위 |
| --- | --- | --- |
| T01 | 소비자가 다른 사용자의 주문 ID를 넣어 주문 상세 조회 | Critical |
| T02 | 셀러가 다른 `storeId`의 주문 상태를 변경 | Critical |
| T03 | 드라이버가 다른 driver에게 배정된 주문을 조회 또는 배송 완료 처리 | Critical |
| T04 | 클라이언트가 결제 금액을 낮춰 주문 생성 | Critical |
| T05 | admin 전용 API가 seller role에 열림 | High |
| T06 | Firestore rules가 API보다 넓게 주문 데이터를 허용 | High |
| T07 | preview bypass secret이나 service account 파일이 저장소에 포함 | High |
| T08 | PWA cache가 개인정보 또는 인증 응답을 저장 | Medium |
| T09 | 주문 상태 전이 fallback이 consumer 권한으로 잘못 처리 | High |
| T10 | webhook 재전송으로 결제/정산 중복 처리 | High |

## 수정 전 확인 질문

각 finding을 수정하기 전에 아래를 확인한다.

- 이 finding이 실제 권한 우회인가, UI 표시 문제인가
- 서버에서 막아야 하는가, Firebase rules에서 막아야 하는가
- 앱별 수정인가, 공통 API 수정인가
- 기존 E2E나 unit test로 재현할 수 있는가
- production 데이터 마이그레이션이 필요한가

