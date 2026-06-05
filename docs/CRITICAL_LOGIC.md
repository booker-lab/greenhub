# Critical Logic — 설계 결정 이력

> 이 파일은 되돌리기 어려운 설계 결정과 그 이유를 기록합니다.
> 결정 변경 시 반드시 이유와 날짜를 함께 기록하세요.
> **누적 결정 로그** — 1000라인 초과 시 종결 엔트리를 `archive/`로 이관(활성 ~500라인 목표).
> 2026-03~04 #CL 이전 엔트리: [archive/CRITICAL_LOGIC_archive_20260516.md](archive/CRITICAL_LOGIC_archive_20260516.md)
> 2026-05-08~21 #CL-19~#CL-39 엔트리: [archive/CRITICAL_LOGIC_archive_20260529.md](archive/CRITICAL_LOGIC_archive_20260529.md)
> 2026-05-22~06-03 #CL-40~#CL-83 엔트리: [archive/CRITICAL_LOGIC_archive_20260604.md](archive/CRITICAL_LOGIC_archive_20260604.md)

---

## [결정 #CL-126] Preview 육안검증 우선 정책 (2026-06-05)

- **결정**: 육안검증의 기본 축을 로컬 dev 서버가 아니라 GitHub push 이후 생성되는 Vercel Preview URL로 둔다.
- **이유**: consumer `#147` 재검증 중 로컬 `next dev`가 `/e2e/order-cancel-status` 컴파일에서 멈췄고, 인증·포트·컴파일 상태가 검증 신뢰도를 떨어뜨렸다.
- **계약**: 로컬은 빠른 개발 확인용 보조 수단으로만 사용하고, 검증 종료 여부는 Preview URL, 커밋 SHA, 문서화된 결과를 기준으로 판단한다. 작업트리가 섞여 있으면 사용자 확인 없이 전체 stage/push하지 않는다.
- **참조**: `docs/specs/frontend/preview-visual-verify-policy.md`

## [결정 #CL-127] 미푸시 누적 작업은 단계별 Preview 릴리즈 트레인으로 검증 (2026-06-05)

- **결정**: 누적된 미푸시 작업은 `docs-policy`, `shared-contracts`, `api-backend`, `consumer-web`, `seller-admin`, `driver-web`, `e2e-ops` 웨이브로 나누어 커밋·푸시·Preview 확인을 반복한다.
- **이유**: 현재 작업트리에 여러 기능군이 섞여 있어 전체 stage/push는 회귀 원인 추적과 Preview 육안검증을 어렵게 만든다.
- **계약**: 각 웨이브는 Preview `READY`와 해당 앱 검증이 끝난 뒤 다음 웨이브로 진행한다. `pnpm release:plan`으로 범위를 확인하고 `pnpm release:stage -- <wave>`로 해당 웨이브만 stage한다.
- **참조**: `docs/specs/ops/staged-preview-release-pipeline.md`

## [결정 #CL-84] 관리자 판매자 상세는 읽기 전용 집계로 제한 (2026-06-03)

- **결정**: `ADMIN-STORES-T7`의 1차 범위는 `/admin/stores/[id]` 읽기 전용 상세와 `GET /admin/stores/:storeId/summary` 집계 API로 제한한다.
- **이유**: 판매자별 주문·정산 운영 상태 확인은 즉시 가치가 있지만, 상태 변경·주문 상세·정산 상세까지 한 번에 묶으면 권한 경계가 커진다.
- **계약**: 상세 API는 store·owner 기본 정보, 주문 상태별 건수·총액, 정산 상태별 건수·플랫폼 수수료·실지급 합계를 반환한다. 목록 복원은 `back` 쿼리로 처리한다.

## [결정 #CL-85] 플랫폼 기본 수수료율은 신규 스토어 기본값으로만 사용 (2026-06-03)

- **결정**: Firestore `platform/config.defaultCommissionRate`를 전역 기본 수수료율로 관리하되, store별 `commissionRate`가 있으면 항상 override로 우선한다.
- **이유**: 기존 store 문서에 기본값 변경을 일괄 반영하면 과거 운영 합의와 정산 결과가 흔들릴 수 있다.
- **계약**: 신규 store 생성 시 현재 기본값을 `stores/{id}.commissionRate`에 복사한다. 기존 store 소급 변경은 별도 승인과 배치 SDD가 필요하다.

## [결정 #CL-86] 관리자 드라이버 상세는 저장된 필드만 표시 (2026-06-03)

- **결정**: `/admin/drivers` 응답과 카드 UI에 `phone`을 추가하고, 차량 정보는 `vehicleType`·`vehicleNumber`가 있을 때만 표시한다.
- **이유**: 현재 데이터 모델에는 전화번호는 있으나 차량 정보 입력 경로가 없다. 없는 값을 추정하면 운영 확인 기준처럼 오해될 수 있다.
- **계약**: 드라이버 검색은 이름·이메일·전화번호를 대상으로 한다. 차량 정보 입력과 증빙 검증은 별도 SDD에서 다룬다.

## [결정 #CL-87] 관리자 드라이버 페이지네이션은 Firestore 커서 계약으로 처리 (2026-06-03)

- **결정**: `GET /admin/drivers?status=&sort=&limit=&cursor=` 계약을 사용한다. 기본 정렬은 `createdAt_desc`, 기본 limit은 100, 최대 limit은 500이다.
- **이유**: 기존 100건 조회 후 메모리 필터링은 초과 데이터 누락 가능성이 있었다. status 조건과 `createdAt` 커서를 서버 계약으로 올려 비용과 정확성을 고정한다.
- **계약**: `pending`·`approved`는 `driverApproved`와 `suspended` 조합으로 보정하고, `suspended`는 `suspended=true` 문서만 별도 조회한다.

## [결정 #CL-88] 드라이버 앱 1차 리팩터링은 순수 표현 로직 분리로 제한 (2026-06-03)

- **결정**: `board`와 `map`의 라벨·시간·주소·정렬·카카오내비 URL 생성 같은 순수 로직을 `_lib.ts`로 분리한다.
- **이유**: Firestore 구독, 상태 전환 API, Kakao Maps SDK를 동시에 바꾸면 현장 배송 흐름의 회귀면이 커진다.
- **계약**: Firestore 쿼리와 상태 전환 API, Kakao Maps SDK 실제 연동은 변경하지 않는다.

## [결정 #CL-89] 드라이버 상세·사진 업로드는 순수 판정만 먼저 분리 (2026-06-03)

- **결정**: `board/[orderId]` 상세 표시 판정, CTA 판정, 연락처 노출 판정, 사진 업로드 Storage 경로와 payload 생성을 `_lib.ts`로 분리한다.
- **이유**: 상세 화면과 사진 화면의 UI·구독·업로드 책임이 섞여 있어 테스트 경계 확보가 먼저 필요하다.
- **계약**: Firestore 문서 구조, 상태 전환 API, 카메라 권한 흐름, Firebase Storage 업로드 방식은 변경하지 않는다.

## [결정 #CL-90] 드라이버 사진 업로드 UI는 전용 컴포넌트로 분리 (2026-06-03)

- **결정**: `photo/page.tsx`는 카메라 stream, 캡처 blob, 업로드 상태와 API 호출을 조립하고, 화면 UI는 `PhotoCaptureView`가 담당한다.
- **이유**: 브라우저 카메라와 Storage 계약을 유지하면서 큰 page 파일의 시각 책임을 줄인다.
- **범위**: `apps/driver/src/app/board/[orderId]/photo/page.tsx`, `PhotoCaptureView.tsx`.

## [결정 #CL-91] globalSetup storageState 저장은 안정화 헬퍼로 통합 (2026-06-03)

- **결정**: E2E `storageState` 저장 직전에 `about:blank` load 안정화와 짧은 재시도를 수행하는 공통 헬퍼를 사용한다.
- **이유**: 로그인 성공 후 저장 시점에 `/login` 리다이렉트가 끼어드는 레이스가 있었다.
- **계약**: BYPASS, AUTH, ADMIN 저장 경로 모두 같은 헬퍼를 사용한다.

## [결정 #CL-92] 드라이버 지도 SDK는 좌표와 키가 있을 때만 실제 지도로 표시 (2026-06-03)

- **결정**: `NEXT_PUBLIC_KAKAO_MAP_KEY`와 주문 좌표가 있을 때 Kakao Maps SDK로 마커·경로선을 표시한다.
- **이유**: 운영 키 또는 좌표가 없는 환경에서도 기존 플레이스홀더와 목록 흐름은 깨지면 안 된다.
- **계약**: 키 누락, 좌표 누락, SDK 로드 실패 시 기존 대체 UI를 유지한다.

## [결정 #CL-93] 관리자 주문 정식 상세는 읽기 전용 API와 라우트로 1차 확장 (2026-06-03)

- **결정**: `GET /admin/orders/:orderId`와 `/admin/orders/[id]` 읽기 전용 상세를 추가한다.
- **이유**: 목록 응답 기반 모달만으로는 상품 라인, 결제 정보, 상태 타임라인을 안정적으로 확인하기 어렵다.
- **계약**: 응답은 `order`, `store`, `buyer`, `payment`, `items`, `timeline`으로 분리한다. 상태 이력 저장소와 결제 쓰기는 제외한다.

## [결정 #CL-94] 관리자 주문 고급 페이지네이션은 page 요청에서만 count/offset 사용 (2026-06-03)

- **결정**: `page` 기반 요청에서 총 건수·현재 페이지·총 페이지를 계산하고, 기존 cursor 계약은 호환용으로 유지한다.
- **이유**: 운영자가 임의 페이지로 이동하려면 count가 필요하지만, 모든 요청에 count를 붙이면 비용이 커진다.
- **계약**: 깊은 offset 탐색 비용이 문제가 되면 서버 검색·커서 스택·전용 집계 문서를 별도 SDD로 승격한다.

## [결정 #CL-95] 주문 상태 라벨은 shared SSOT로 통합 (2026-06-03)

- **결정**: `@greenhub/shared`에 `ORDER_STATUSES`, `ORDER_STATUS_LABEL`, `ORDER_STATUS_COLOR`를 두고 4앱의 주문 상태 표기를 통일한다.
- **이유**: `픽업완료`와 `픽업 완료`, `배달중`과 `배송 중`처럼 앱별 표현 차이가 있었다.
- **계약**: API FSM 표 기준의 긴 사용자 문구를 표준으로 삼고, UI는 shared 라벨을 재사용한다.

## [결정 #CL-96] 관리자 송장번호 수정은 발송 후 사후 정정으로 제한 (2026-06-03)

- **결정**: `PATCH /admin/orders/:orderId/tracking`은 발송 이후 송장 정정 용도로만 제공한다.
- **이유**: 미발송 무송장 주문의 최초 발송은 기존 셀러 발송 플로우에 남겨야 감사 경계가 분리된다.
- **계약**: 정정 시 `trackingUpdatedAt`, `trackingUpdatedBy`, `updatedAt`을 기록한다.

## [결정 #CL-97] 관리자 초대 페이지네이션은 현재 정렬 축별 커서로 제한 (2026-06-04)

- **결정**: `GET /admin/invite?q=&limit=&cursor=`는 기본 목록에서 `createdAt desc` ISO 커서, 검색 중에는 token 커서를 사용한다.
- **이유**: 4자 prefix 검색과 생성일 정렬을 하나의 정확한 cursor로 합치기 어렵다.
- **계약**: 1000건 이상 발급량 대응은 별도 `ADMIN-INVITE-SCALE-1000`로 분리한다.

## [결정 #CL-98] 초대 대량 검색은 tokenPrefixes와 createdAt desc 인덱스로 처리 (2026-06-04)

- **결정**: 초대 토큰 검색을 위해 `tokenPrefixes` 배열과 `array-contains + createdAt desc` 인덱스를 사용한다.
- **이유**: `token >= prefix && token < prefix+\uf8ff` 방식은 정렬·페이지네이션 결합에서 누락 위험이 있다.
- **계약**: 신규 초대 생성 시 prefix 배열을 저장하고, 기존 문서는 backfill 또는 폴백 정책을 별도로 둔다.

## [결정 #CL-99] 관리자 초대 만료기간은 제한된 일수 선택으로 지원 (2026-06-04)

- **결정**: `POST /admin/invite`에 `expiresInDays`를 추가하고 기본값은 7일, 검증 범위는 1~30일로 둔다.
- **이유**: 운영 상황에 따라 초대 유효 기간을 조절해야 하지만, 임의 긴 기간은 보안 위험을 키운다.
- **계약**: UI는 `3일`, `7일`, `14일`, `30일` Select만 제공한다.

## [결정 #CL-100] 관리자 초대 취소는 유효 토큰 회수 이벤트로만 기록 (2026-06-04)

- **결정**: 사용됨, 이미 취소됨, 만료된 토큰은 취소 대상으로 넓히지 않고 409 reason으로 차단한다.
- **이유**: 비유효 토큰에 `revokedAt`을 추가하면 상태 의미와 감사 로그가 섞인다.
- **계약**: `revokedAt`은 유효 토큰 회수 감사 이벤트에만 기록한다.

## [결정 #CL-101] 가입 완료 초대 rollback은 스토어 미연결 판매자 정지로 제한 (2026-06-04)

- **결정**: 1차 rollback은 `storeId`가 없는 판매자 계정 정지, refresh token 폐기, 초대 문서 감사 필드 기록으로 제한한다.
- **이유**: 스토어 연결 판매자는 주문·정산·스토어 lifecycle과 얽혀 전역 정책이 필요하다.
- **계약**: 스토어 연결 판매자 rollback은 별도 `ADMIN-SELLER-LIFECYCLE`로 분리한다.

## [결정 #CL-102] seller `<img>` 경고는 Firebase remote pattern 안에서 `next/image`로 해소 (2026-06-04)

- **결정**: Firebase Storage 이미지에 한해 `next/image`를 사용하고 `apps/seller/next.config.ts` remote pattern을 유지한다.
- **이유**: 성능 경고를 해소하되 외부 이미지 허용 범위를 넓히면 안 된다.
- **계약**: 이미지 컨테이너는 고정 크기와 `position: relative`를 유지한다.

## [결정 #CL-103] 스토어 연결 판매자 rollback은 기록 없는 스토어 보존 아카이브까지 허용 (2026-06-04)

- **결정**: 주문·정산 기록이 0건인 store 연결 판매자는 계정 정지, refresh token 삭제, 초대 rollback 감사 기록과 함께 store를 보존 아카이브할 수 있다.
- **이유**: store 문서를 삭제하면 운영 감사와 초대 이력 추적이 약해진다.
- **계약**: 주문·정산 기록이 있으면 `store_has_records`, store 문서 누락은 `store_not_found`로 차단한다.

## [결정 #CL-104] 소비자 공개 상점 API는 `/public/stores`로 분리 (2026-06-04)

- **결정**: 기존 인증용 `GET /stores/:storeId`는 유지하고, 공개 조회는 `GET /public/stores`, `GET /public/stores/:storeId`로 분리한다.
- **이유**: 인증 API를 공개로 전환하면 사업자·온보딩 필드와 401 E2E 계약의 보안 경계가 흐려진다.
- **계약**: 공개 응답은 `name`, `address`, `logoUrl`, 상품 수, 거점 수, active 상품 요약으로 제한한다.

## [결정 #CL-105] 소비자 상점 탐색은 하단 내비와 홈 미리보기로 연결 (2026-06-04)

- **결정**: 소비자 하단 내비에 `/stores` 진입점을 추가하고, 홈에는 공개 상점 미리보기를 최대 3개 표시한다.
- **이유**: `STORE_ID` 제거와 주문 생성 재설계는 단계적으로 진행하되, 공개 탐색 가치는 먼저 노출할 수 있다.
- **계약**: 상품 카드, 상품 상세, 장바구니, 결제의 `storeId` 전달 방식은 그대로 유지한다.

## [결정 #CL-106] 소비자 공개 상점 상품 진입은 읽기 맥락 쿼리로만 보존 (2026-06-04)

- **결정**: `/stores/[storeId]` 상품 링크는 `/products/[id]?fromStore=...&storeName=...` 형태로 읽기 맥락만 전달한다.
- **이유**: 상품 구매 계약은 상품 응답의 `storeId`가 권위여야 하며, URL 쿼리가 주문 store를 결정하면 안 된다.
- **계약**: `fromStore`는 상점 복귀 UI에만 사용한다.

## [결정 #CL-107] 소비자 주문 생성 storeId는 상품 응답을 권위로 사용 (2026-06-04)

- **결정**: 바로구매와 장바구니 구매의 `storeId`는 공개 상품 API 응답에서 온 값을 사용한다.
- **이유**: URL, localStorage, Portone store id는 결제 또는 UI 맥락일 뿐 주문의 판매자 권위가 아니다.
- **계약**: 상품 로딩 전 또는 `storeId` 누락 시 주문 CTA를 비활성화한다.

## [결정 #CL-108] 소비자 장바구니 주문은 상점·배송 조건 검증 통과 항목만 허용 (2026-06-04)

- **결정**: 장바구니 결제는 `storeId`, 배송 방식, 배송일 조건을 통과한 항목만 API 호출로 넘긴다.
- **이유**: 오래된 localStorage 항목이 `/stores//orders` 같은 잘못된 주문 경로를 만들 수 있다.
- **계약**: 결제 완료 시 `checkout_cart`와 `greenhub_cart`를 함께 정리한다.

## [결정 #CL-109] 소비자 상품 상세 판매자 정보는 공개 상점 API만 사용 (2026-06-04)

- **결정**: 상품 상세 하단의 판매자 정보는 `/public/stores/:storeId` 응답을 재사용한다.
- **이유**: 소비자 화면이 인증 store API나 Firestore 직접 조회에 의존하면 공개 경계가 흔들린다.
- **계약**: 판매자 정보 카드는 `/stores/:storeId`로 이동하는 읽기 링크만 제공한다.

## [결정 #CL-110] 소비자 상점 탐색 테스트는 공개 API mock과 fixture 상품 상세로 분리 (2026-06-04)

- **결정**: `/stores` 테스트는 공개 API route mock을 사용하고, 상품 상세 회귀는 `ENABLE_E2E_FIXTURES=true`의 fixture 경로로 검증한다.
- **이유**: 공개 API 네트워크와 상품 상세 fetch 타이밍을 한 spec에 묶으면 테스트가 불안정해진다.
- **계약**: fixture 상품은 `storeId`와 구매 가능 조건을 명시해 404와 빈 주문 경로를 막는다.

## [결정 #CL-111] 준비 물량의 공동구매 배송일은 기존 groupProductConfig 조인을 재사용 (2026-06-04)

- **결정**: 공구 주문은 `groupProductConfig/{productId}.groupDeliveryDate`를 기준으로 오늘분·지연분에 합산한다.
- **이유**: 일반 주문의 `requestedDeliveryDate`와 공구 배송일은 저장 위치가 다르므로 기존 조인 계약을 재사용해야 한다.
- **계약**: 설정 누락 또는 파싱 불가 공구 주문은 날짜 미정으로 간주하고 집계에서 제외한다.

## [결정 #CL-112] 일반 주문 슬롯 검증과 보상은 선택 배송일을 단일 기준으로 사용 (2026-06-04)

- **결정**: 일반 상품 주문의 슬롯 검증은 `requestedDeliveryDate`를 기준으로 `dailyCaps/{storeId}_{date}`를 갱신한다.
- **이유**: 결제 실패 보상도 같은 날짜 기준으로 이루어져야 cap 정합성이 맞는다.
- **계약**: 공구 주문은 `requestedDeliveryDate: null`로 두고 공구 설정의 배송일 계약을 따른다.

## [결정 #CL-113] 드라이버 login·profile 리팩터링은 인증 계약 유지와 화면 책임 분리로 제한 (2026-06-04)

- **결정**: login은 Kakao `signIn`, profile은 `auth()`와 `signOut` 흐름을 유지하고 UI 책임만 `_components`로 분리한다.
- **이유**: 인증 흐름은 작은 변경도 리다이렉트 회귀를 만들 수 있으므로 화면 구조 정리와 분리한다.
- **계약**: provider, redirect, session 판정은 기존 계약을 유지한다.

## [결정 #CL-114] 거점 스태프 1차 권한은 배정 거점 읽기 전용으로 제한 (2026-06-05)

- **결정**: `hub_staff`는 `hubs/{hubId}.staffIds`에 포함된 거점의 목록·상세·주문 조회만 할 수 있다.
- **이유**: 판매자 권한과 운영 거점 권한을 분리해야 다른 거점 주문이나 판매자 전역 데이터 노출을 막을 수 있다.
- **계약**: 경로 `storeId`·`hubId`, JWT 스코프, `hubs.staffIds` 배정을 모두 검증한다.

## [결정 #CL-115] 거점 스태프 초대는 관리자 판매자 초대와 별도 컬렉션으로 분리 (2026-06-05)

- **결정**: 거점 스태프 초대는 `hubStaffInvites/{token}`로 관리하고, 관리자 판매자 초대 `invites`와 분리한다.
- **이유**: 판매자 초대 rollback, 스토어 lifecycle, 거점 스태프 배정 lifecycle은 감사 의미와 권한 경계가 다르다.
- **계약**: 초대 수락은 `role='hub_staff'`, `inviteToken`, `hubs.staffIds` 배정 트랜잭션으로 처리한다.

## [결정 #CL-116] hub_staff Kakao 수락은 `kakao-login` 타깃 역할로 처리 (2026-06-05)

- **결정**: seller `/staff-invite?token=...`은 토큰을 임시 저장한 뒤 Kakao OAuth 이후 `POST /auth/kakao-login`에 `targetRole:'hub_staff'`와 `inviteToken`을 전달한다.
- **이유**: OAuth provider 콜백만으로는 query 토큰을 안정적으로 보존하기 어렵다.
- **계약**: `targetRole='hub_staff'` 요청은 초대 토큰이 있을 때만 허용하고, 임의 admin·seller 승격 경로로 사용하지 않는다.

## [결정 #CL-117] 운영 mojibake 데이터 보정은 allowlist 단발 스크립트로 제한 (2026-06-05)

- **결정**: `VF-008`, `VF-011` 운영 데이터 보정은 `scripts/ops/repair-mojibake-data.mjs`의 명시적 allowlist와 `--apply` 옵션으로만 처리한다.
- **이유**: 자동 복원 또는 광범위 문자열 치환은 정상 운영 데이터를 훼손할 수 있다.
- **계약**: 적용 전 백업 JSON을 `docs/archive/ops/`에 남기고, 정상 상호명·사용자명·판매자명이 모두 제공된 경우에만 `name` 필드를 수정한다.

## [결정 #CL-118] 거점 스태프 권한 회수는 계정 정지와 refresh token 삭제까지 포함 (2026-06-05)

- **결정**: 거점 스태프 회수는 `hubs.staffIds` 제거, `hub_staff` 계정 `suspended:true`, refresh token 삭제를 함께 수행한다.
- **이유**: 배정만 제거하면 기존 refresh token으로 접근권이 이어질 수 있다.
- **계약**: 회수 API는 판매자 소유권과 대상 staff의 store·hub 배정을 검증한다.

## [결정 #CL-119] hub_staff JWT 스코프는 storeId와 hubId를 함께 고정 (2026-06-05)

- **결정**: `hub_staff` JWT에는 `storeId`와 대표 `hubId`를 포함한다.
- **이유**: 거점 API는 경로 `storeId`·`hubId`와 토큰 스코프를 즉시 대조해야 한다.
- **계약**: refresh 시에도 최신 사용자 문서와 거점 배정을 반영해 스코프를 재생성한다.

## [결정 #CL-120] hub_staff 다중 거점 배정은 `hubIds` 배열을 병행 도입 (2026-06-05)

- **결정**: 단일 `hubId`만으로는 다중 거점 스태프를 표현하기 어려우므로 JWT와 사용자 문서에 `hubIds`를 병행한다.
- **이유**: 단일 hubId만 쓰면 추가 배정 시 기존 거점 접근이 403으로 막힐 수 있다.
- **계약**: `hubId`는 대표/호환 필드로 유지하고, 접근 검증은 `hubIds` 포함 여부를 우선한다.

## [결정 #CL-121] 기존 hub_staff 추가 거점 배정은 후보 조회와 명시 배정으로 분리 (2026-06-05)

- **결정**: 기존 `hub_staff`를 다른 거점에 추가 배정할 때 후보 조회와 배정 API를 분리한다.
- **이유**: 초대 링크 재사용 없이 이미 존재하는 스태프를 명시적으로 배정해야 운영자가 의도를 확인할 수 있다.
- **계약**: 후보는 같은 `storeId`, `role='hub_staff'`, `suspended !== true`, 현재 hub 미배정 사용자로 제한한다.

## [결정 #CL-122] hub_staff 초대 링크 취소는 삭제가 아니라 감사 필드 기록 (2026-06-05)

- **결정**: 거점 스태프 초대 취소는 `hubStaffInvites/{token}` 문서를 삭제하지 않고 `revokedAt`, `revokedBy`, `updatedAt`을 기록한다.
- **이유**: 초대 링크는 외부 공유될 수 있어 취소 이력과 발급자를 추적해야 한다.
- **계약**: 이미 사용됨, 이미 취소됨, 만료된 초대는 추가 쓰기 없이 409로 차단한다.

## [결정 #CL-123] hub_staff 거점 픽업 확인 권한 (2026-06-05)

- **결정**: `hub_staff`는 배정된 거점의 `HUB_ARRIVED` 주문에 한해 `PATCH /stores/:storeId/orders/:orderId/hub-confirm`으로 `PICKED_UP` 전환할 수 있다.
- **이유**: 거점 스태프는 현장 픽업 확인에 필요한 최소 상태 변경만 가져야 한다.
- **계약**: JWT `storeId`, JWT `hubId` 또는 `hubIds`, 주문 `hubId`, `hubs.staffIds`의 요청자 포함 여부를 모두 검증한다. 판매자 소유자 경로는 유지한다.

## [결정 #CL-124] hub_staff 현장 픽업 확인 CTA 노출 (2026-06-05)

- **결정**: `/hubs/[id]`의 `HUB_ARRIVED` 주문 카드에 주문 식별 정보, 픽업 코드, 명시적인 `픽업 확인` 버튼을 노출한다.
- **이유**: 카드 전체 클릭만으로는 현장 스태프가 즉시 수행해야 할 작업이 충분히 드러나지 않는다.
- **계약**: 상태 변경 API와 권한 경계는 `#CL-123`의 `hub-confirm` 계약을 그대로 유지하고, 이번 변경은 seller 거점 상세 표현 레이어에 한정한다.

## [결정 #CL-125] hub_staff 도입 후에도 `/admin/*`은 admin 전용 경계 유지 (2026-06-05)

- **결정**: 거점 스태프 초대·배정·회수는 seller 거점 경로에서 처리하고, `/admin/*` UI와 API는 계속 `role='admin'` 전용으로 유지한다.
- **이유**: `hub_staff`는 seller 운영 보조 역할이며 플랫폼 운영 관리자 권한과 목적이 다르다.
- **계약**: `AdminController`는 `@Roles('admin')`를 유지하고, admin layout과 `RolesGuard`는 `hub_staff`를 admin 경로에서 차단한다.
