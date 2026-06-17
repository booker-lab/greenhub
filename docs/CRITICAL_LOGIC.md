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

## [결정 #CL-128] 핸드오프 프롬프트 1번과 2번은 순서가 아니라 분기 식별자다 (2026-06-06)

- **결정**: 프롬프트 1번은 `handoff-prompt-1-visual-closeout.md` 기준의 육안검증 종결 가지, 프롬프트 2번은 `handoff-prompt-2-release-train.md` 기준의 개발·릴리즈 트레인 가지로 분리한다.
- **이유**: 번호만 보고 1번 완료 후 2번을 같은 작업선의 다음 순서로 인식하면, 육안검증 마감 흐름과 새 가지 개발·커밋 웨이브가 섞인다.
- **계약**: 1번에서는 보류 체크리스트 중 현재 조건으로 닫을 수 있는 검증 묶음을 고르고, 2번에서는 `release:stage` 웨이브를 분리 커밋·Preview 검증한다. 두 가지의 다음 진입점은 서로 대체하지 않는다.

## [결정 #CL-129] 셀러 검증 데이터 정리는 storeId 단위 dry-run 우선 스크립트로 제한 (2026-06-09)

- **결정**: 셀러 대검증 전 테스트 데이터 정리는 `scripts/cleanup-seller-validation-data.mjs <storeId>`로 대상 `storeId` 하나만 조회하고, 기본 실행은 dry-run으로 제한한다.
- **이유**: 운영 Firestore의 상품·주문·결제·정산 데이터는 삭제 영향이 크므로, 수동 콘솔 조작이나 광범위 쿼리보다 명시 범위와 사전 검토가 필요하다.
- **계약**: 실제 삭제는 백업 이후 `--apply`를 명시한 경우에만 수행한다. 기본 범위는 `products`, `orders`, `payments`, `settlements`, 삭제 상품과 같은 ID의 `groupProductConfig`이며, `stores`, `users`, `deliveryFeeConfig`, `auditLogs`, `refreshTokens`는 정리 범위에서 제외한다.

## [결정 #CL-130] 판매자 로고는 `logos/` Storage 경계로 분리 (2026-06-10)

- **결정**: 판매자 온보딩 로고 업로드는 Firebase Storage `logos/{allPaths=**}` 경로를 사용하고, 해당 경로는 공개 읽기와 인증 사용자 쓰기만 허용한다.
- **이유**: 로고는 상품 이미지(`products/`)와 배너 이미지(`banners/`)의 수명주기와 소유 경계가 다르므로 별도 인프라 규칙으로 분리해야 한다.
- **계약**: 사업자 정보 저장은 기존 API/Firestore 도메인에 유지하고, 이미지 업로드 권한은 `storage.rules`에서 관리한다. 운영 반영에는 `firebase deploy --only storage`가 필요하다.

## [결정 #CL-131] 판매 단위 자유 입력은 MVP 상품 등록에서 제거 (2026-06-10)

- **결정**: 셀러 상품 등록의 `selection.bundleUnit` 자유 입력, AI 프롬프트 전달, 소비자 상세 표시를 제거한다.
- **이유**: 현재 주문·결제·공동구매 계약은 `quantity`, `price`, `minQuantity`, `targetQuantity`, `maxPerPerson`가 담당한다. 판매 단위가 계산 기준이 아닌 상태에서 `1분`, `3묶음`, `1박스`를 받으면 셀러에게 불필요한 판단 비용만 만든다.
- **계약**: 향후 포장 단위가 가격·재고·배송비 계산 기준이 되면 `bundleUnit` 자유 입력 복구가 아니라 `packageSize`, `unitLabel`, `baseQuantity` 등 구조화 필드를 별도 SDD로 설계한다.

## [결정 #CL-132] Gemini preview 종료 대응과 안정 모델 fallback (2026-06-10)

- **결정**: 상품 AI 문구 생성 기본 모델을 `gemini-3.5-flash`로 전환하고, Gemini 호출이 실패하면 `gemini-3.1-flash-lite`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` 순서로 fallback한다. 모델명은 `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_LEGACY_FALLBACK_MODEL`, `GEMINI_LEGACY_FALLBACK_LITE_MODEL` 환경변수로 분리한다.
- **이유**: 2026-06-10 운영 `/ai/generate-content`에서 201 성공과 500 실패가 같은 입력으로 반복되었고, 로컬 동일 키 호출에서 `gemini-3-flash-preview`가 `[503 Service Unavailable] This model is currently experiencing high demand`를 간헐 반환했다. 공식 Gemini API 문서도 `gemini-3-flash-preview`에서 `gemini-3.5-flash`로의 모델명 갱신을 안내하므로 preview 모델 고정을 해소한다.
- **계약**: guardrail, prompt, 상품 저장 스키마는 변경하지 않는다. fallback은 외부 Gemini 호출 인프라 복구 수단으로만 동작하며, fallback도 실패하면 마지막 Gemini 오류를 포함해 기존 500 흐름을 유지한다.

## [결정 #CL-133] Nest 런타임 메타데이터 대상은 value import로 유지 (2026-06-10)

- **결정**: `ValidationPipe` DTO, 컨트롤러 메서드 본문 DTO, Nest DI 생성자 주입 대상 클래스는 `import type`이 아니라 런타임 value import로 유지한다.
- **이유**: TypeScript의 type-only import는 빌드 후 제거되므로 Nest가 `reflect-metadata`로 읽는 DTO/주입 대상이 `Function` 또는 빈 메타타입으로 남을 수 있다. 이 경우 whitelist 검증은 정상 필드를 `should not exist`로 거부하고, DI는 `UnknownDependenciesException`으로 기동 실패한다.
- **계약**: 린터가 type import를 권장하더라도 Nest 런타임 메타데이터가 필요한 import에는 파일 단위가 아닌 해당 import 근처에 예외 주석을 남긴다.

## [결정 #CL-134] AI 미리보기 payload 검증은 저장 API보다 관대하게 유지 (2026-06-10)

- **결정**: `/ai/generate-content`의 `selection` DTO는 nested enum 검증을 하지 않고 객체 여부만 확인한 뒤, 컨트롤러에서 `colors`, `stemType`, `fragrance`, `bloomCondition`, `careLevel` 기본값과 병합한다.
- **이유**: 상품 AI 미리보기는 저장 전 초안 생성 기능이며, 브라우저 draft나 프론트 bundle 값이 조금 달라도 400으로 차단되면 판매자 흐름이 끊긴다. 실제 상품 저장 검증은 별도 Product DTO와 도메인 로직에서 유지한다.
- **계약**: AI 프롬프트와 guardrail은 보정된 selection을 입력으로 받는다. 누락값은 기본값으로 생성하고, 저장 시점의 필수값 검증은 기존 상품 등록 경계에서 수행한다.

## [결정 #CL-135] 전체 거래 5.1 검증은 사용자 Chrome 육안 검증으로 전환 (2026-06-13)

- **결정**: `docs/specs/full-flow-manual-test-guide.md`의 5.1부터는 사용자가 실제 Chrome 로그인 세션에서 육안으로 수행한다. Codex는 화면 조작 자동화나 API 본문 우회를 하지 않고, 체크리스트 정리와 API 응답 해석, 다음 단계 핸드오프만 보조한다.
- **이유**: Chrome 제어 도구가 현재 스레드에 노출되지 않았고, Playwright preview 검증은 로그인 세션 재발급은 가능했으나 상품 등록 `POST /stores/:storeId/products`가 `selection.property bundleUnit should not exist` 400으로 차단됐다. 이 상태에서 본문을 변조해 통과시키면 실제 사용자 흐름 검증이 아니라 우회 자동화가 된다.
- **계약**: 실제 Chrome 육안 검증에서도 같은 400이 재현되면 5.1은 상품 등록 차단 결함으로 기록하고 5.2를 시작하지 않는다. 일반 상품 ID와 공동구매 상품 ID가 실제 화면과 API에서 확인된 뒤에만 5.2 핸드오프를 작성한다.

## [결정 #CL-136] 소비자 장바구니는 결제 전 문제 항목을 숨기지 않고 차단한다 (2026-06-17)

- **결정**: 소비자 장바구니에서 `storeId` 누락 또는 배송일 누락 등 결제 불가 항목은 자동 삭제하거나 결제 대상에서 조용히 제외하지 않고, 카드 안에 사유와 `다시 선택하기` 행동을 표시한다. 문제가 하나라도 남아 있으면 전체 결제 버튼을 비활성화한다.
- **이유**: 장바구니는 결제 직전 확인 화면이다. 일부 상품을 조용히 제외하면 사용자가 부분 결제를 놓칠 수 있고, 문제를 checkout까지 미루면 돈이 오가는 흐름 가까이에서 실패한다.
- **계약**: checkout의 기존 최종 검증은 유지한다. 장바구니 검증은 선제 안내와 진입 차단이며, `checkout_cart`는 장바구니 검증을 통과한 경우에만 쓴다.

## [결정 #CL-137] 소비자 공구 탭 개선은 안정화와 핵심 기능 개선을 한 묶음으로 설계 (2026-06-17)

- **결정**: 소비자 앱 공구 탭 1차 개선은 깨진 문구 복구, 공구 상태 계산 통일, 공구 카드 정보 강화, 상세 구매 영역의 공구 배송 방식 고정을 한 묶음으로 설계한다.
- **이유**: 공구 탭의 기능 개선은 단순 UI 장식이 아니라 `groupSummary`, `groupProductConfig`, `saleType`, `deliveryMethod` 정합성과 직접 연결된다. 문구만 고치거나 카드만 개선하면 모집 완료, 마감, 설정 누락, 배송 방식 불일치가 계속 남는다.
- **계약**: 선 설계 문서는 `docs/specs/frontend/consumer-groupbuy-tab-improve-plan.md`를 기준으로 삼고, 구현은 아토믹 태스크 단위로 진행한다. 공구 상태 판단은 단일 유틸로 통일하며, 공구 배송일과 배송 방식은 판매자 설정값을 소비자 화면에서 읽기 전용으로 사용한다.

## [결정 #CL-138] 소비자 홈 공동구매 개선은 표시 계층에 한정한다 (2026-06-17)

- **결정**: 소비자 홈 공동구매 개선은 카드 이미지 영역 고정, 남은 시간 표시, 남은 수량 표시, 목표 달성 상품 제외까지로 한정한다.
- **이유**: 이번 문제의 핵심은 홈 탭에서 공동구매 미리보기의 신뢰도와 판단 정보가 부족한 점이다. 모집 확정, 취소, 환불 같은 상태 전환까지 함께 바꾸면 프론트엔드 표시 개선과 도메인 규칙 변경이 섞여 검증 범위가 과도하게 커진다.
- **계약**: 홈 화면은 `groupSummary`를 읽어 표시만 보강한다. 공동구매 모집 가능 여부의 최종 판단과 상태 변경은 API·도메인 레이어 책임으로 유지한다. 마감 시간이 지난 실데이터 정리는 별도 운영 과제로 분리한다.

## [결정 #CL-139] 소비자 상점 탭 S8은 공개 API 계약 변경 없이 프론트 탐색 개선으로 한정한다 (2026-06-17)

- **결정**: 소비자 상점 탭 개선은 상점명·주소 검색, 가나다순·상품 수순·거점 수순 정렬, 상점 카드 공통화, 공개 상점 훅 분리까지로 한정한다.
- **이유**: 현재 상점 탭은 목록·상세·상품 진입 계약은 갖췄지만, 상점 수가 늘 때 소비자가 원하는 판매자를 찾는 기능과 프론트 표현 계층의 재사용성이 부족하다. API 응답 필드나 주문 계약을 함께 바꾸면 장바구니·결제 회귀 범위가 커진다.
- **계약**: `GET /public/stores`, `GET /public/stores/:storeId`, 상품 상세의 `fromStore`·`storeName`, 장바구니·결제의 `storeId` 계약은 변경하지 않는다. 백엔드 count 집계, 지도·전화·거점 상세는 후속 과제로 분리한다.

## [결정 #CL-140] 소비자 MY 탭 1차 개선은 수령·구매 확정 안정화에 집중한다 (2026-06-17)

- **결정**: 소비자 MY 탭 개선은 주문 목록과 상세를 모두 얇게 보강하되, 1차 범위는 수령 정보와 구매 확정 행동을 분명히 하는 데 집중한다.
- **이유**: MY 탭의 핵심 가치는 소비자가 내 주문이 어디까지 왔고 지금 무엇을 해야 하는지 확인하는 것이다. 고객센터, 후기 작성, 알림 동기화까지 함께 넣으면 주문 상태 안정화와 보조 기능이 섞여 검증 범위가 커진다.
- **계약**: 구매 확정 버튼은 `DELIVERED` 또는 `PICKED_UP` 이후에만 노출한다. `HUB_ARRIVED`에서는 픽업 코드는 표시하되 구매 확정은 숨긴다. 선 설계 문서는 `docs/specs/frontend/consumer-mypage-receive-confirm-plan.md`를 기준으로 삼는다.

## [결정 #CL-141] 소비자 카테고리 탐색 상태는 URL 쿼리를 SSOT로 둔다 (2026-06-17)

- **결정**: 소비자 카테고리 화면의 `category`, `saleType`, `colors`, `sort` 상태는 URL 쿼리를 단일 출처로 둔다.
- **이유**: 카테고리 탭과 색상 필터가 로컬 상태에만 있으면 새로고침, 뒤로가기, 공유 링크, 상품 상세 복귀 흐름에서 같은 탐색 조건을 유지할 수 없다.
- **계약**: `saleType`은 공유 계약의 `normal | group`만 허용하고, 배송 방식의 `direct`를 판매 방식으로 사용하지 않는다. 정렬은 API `sort` 쿼리로 위임하며, 선 설계 문서는 `docs/specs/frontend/consumer-category-exploration-plan.md`를 기준으로 삼는다.

## [결정 #CL-142] 소비자 홈 공동구매 목표 수량 누락은 표시 fallback으로 처리한다 (2026-06-17)

- **결정**: 소비자 홈 공동구매 미리보기에서 `targetQuantity`가 없거나 0 이하인 상품은 목표 달성 제외 필터에 넣지 않고 `모집 중`으로 표시한다.
- **이유**: 홈 화면은 표시 계층이므로 목표 수량 누락 데이터를 임의로 모집 완료나 주문 불가로 확정하면 API·도메인 레이어의 상태 판단을 침범한다.
- **계약**: `targetQuantity > 0`이고 `currentQuantity >= targetQuantity`인 상품만 홈 진행 중 미리보기에서 제외한다. 전체 공동구매 페이지와 주문 가능 여부 판단은 기존 정책을 유지한다.

## [결정 #CL-143] 소비자 카테고리 탐색 색상과 공구 마감일은 공유 계약에 맞춘다 (2026-06-17)

- **결정**: 카테고리 색상 필터는 공유 `ColorOption` 전체 허용값을 노출하고, 공개 상품 API의 `groupSummary.recruitDeadline`은 소비자 카드가 바로 파싱 가능한 ISO 문자열로 직렬화한다.
- **이유**: UI 색상 목록이 공유 타입보다 좁으면 합법 데이터가 URL 파서에서 누락되고, Firestore `Timestamp`가 그대로 내려가면 소비자 카드의 마감 표시가 환경별로 흔들릴 수 있다.
- **계약**: `colors` URL 쿼리는 공유 허용값만 통과시키며, 공동구매 카드 표시는 API 응답의 직렬화된 `recruitDeadline`을 기준으로 한다.

## [결정 #CL-144] 소비자 공동구매 참여 가능 여부는 공유 상태 유틸로 판정한다 (2026-06-17)

- **결정**: 소비자 공동구매 목록, 카드, 상세 CTA는 `getGroupBuyStatus()`의 `recruiting` 상태만 참여 가능으로 본다.
- **이유**: `currentQuantity >= targetQuantity`만 기준으로 삼으면 설정 누락, 마감 후 최소수량 미달, 마감 종료, 잘못된 수량·날짜가 모두 진행 중처럼 보일 수 있다. 참여 가능 여부는 표시 계층에서도 동일한 도메인 기준을 써야 한다.
- **계약**: `missing_config`와 `invalid_config`는 정보 확인 필요로 분리하고 CTA를 비활성화한다. 공구 상세의 배송 방식과 배송일은 `groupProductConfig`의 판매자 지정값을 읽기 전용으로 사용하며, 상품 목록 API는 Firestore `in` 제한에 맞춰 공구 설정을 30개 단위로 병합한다.
