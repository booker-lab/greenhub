# Critical Logic archive 20260604 part 03

> 원본: $Path에서 2026-06-29 문서 정리 시 분리.

---

## 2026-05-29 — CL-56 택배 발송 완료 전 운송장 필수화

- **결정**: 판매자 주문 상세에서 택배 주문을 `PREPARING → DELIVERED`로 전환할 때 `courierCompany`와 `trackingNumber`를 필수로 저장한다.
- **이유**: 운송장 없이 배송 완료 처리되면 소비자가 추적 정보를 확인할 수 없고, CS가 판매자 화면 밖에서 발생한다.
- **검증 경계**: 프론트 모달은 입력 누락을 막고, API는 동일 필수값을 재검증해 직접 호출 우회를 차단한다.
- **범위**: 이번 차수는 단일 운송장만 지원한다. 배송조회 링크, 실시간 택배 상태 연동, 분할 배송은 별도 SDD로 남긴다.

## 2026-05-29 — CL-57 어드민 주문 목록 송장 표시

- **결정**: `/admin/orders`는 주문 문서의 `courierCompany`와 `trackingNumber`를 별도 조회 없이 목록에 표시한다.
- **이유**: 셀러 송장 필수화 이후 운영자가 소비자 CS를 처리할 때 어드민 주문 목록에서 바로 송장을 확인해야 한다.
- **범위**: 이번 차수는 읽기 전용 표시만 수행한다. 송장 사후 수정과 배송조회 링크는 별도 SDD로 남긴다.

## 2026-05-29 — CL-58 판매자 주문 우선 알림 배너

- **결정**: `/orders`는 처리 필요 주문과 배송 예정일이 지난 활성 주문을 화면 내 우선 알림 배너로 먼저 노출한다.
- **이유**: 푸시 알림 범위는 아직 미확정이지만, 사장님이 화면에 진입했을 때 새 주문과 지연 주문을 탭 배지만으로 놓치는 문제는 즉시 줄일 수 있다.
- **범위**: 이번 차수는 화면 내 배너와 탭 이동만 수행한다. 브라우저 푸시, 문자·카카오 알림, 읽음 상태 저장은 별도 SDD로 남긴다.
- **보강**: 공동구매 지연 판단에 필요한 `groupProductConfig` 조인은 현재 탭이 아니라 공구 전체 주문의 `productId`를 대상으로 한다. 그래야 현재 탭 밖의 지연 주문도 배너 건수와 이동 대상에 포함된다.

## 2026-05-29 — CL-59 판매자 주문 일괄 준비 시작

- **결정**: 여러 주문 일괄 처리의 1차 범위는 `ACCEPTED`·`CONFIRMED` 주문을 `PREPARING`으로 바꾸는 일괄 준비 시작만 허용한다.
- **이유**: 택배 발송은 주문별 운송장번호가 필요해 일괄 입력 UX와 검증 정책이 별도로 필요하다. 준비 시작은 송장번호와 충돌하지 않아 즉시 클릭 수를 줄일 수 있다.
- **검증 경계**: 프론트는 선택·확인·주문별 요청 오케스트레이션만 담당하고, 상태 전이 비즈니스 규칙은 기존 단건 API가 계속 검증한다.
- **범위**: 백엔드 일괄 API, 일괄 택배 발송, 준비 시간 일괄 입력은 별도 SDD로 남긴다.
# 2026-05-29 — SELLER-ORDERS-BULK-PARCEL-01

## 결정
**셀러 주문 목록의 택배 발송 일괄 처리는 백엔드 일괄 API 없이, `PREPARING`·`parcel` 주문만 선택해 주문별 택배사와 운송장번호를 입력한 뒤 기존 단건 상태 변경 API를 반복 호출한다.**

## 이유
- 송장번호는 주문마다 다르므로 `준비 시작`처럼 단일 확인 모달로 처리할 수 없다.
- 기존 `PATCH /stores/:storeId/orders/:orderId/status`에는 택배 주문의 `PREPARING → DELIVERED` 필수값 가드가 이미 있어 비즈니스 규칙을 중복하지 않아도 된다.
- 현재 운영 규모에서는 백엔드 일괄 API보다 프론트 오케스트레이션이 범위와 위험이 작고, 부분 실패 처리는 기존 일괄 준비 시작 UX와 같은 방식으로 흡수할 수 있다.

## 범위
- 포함: `대기 중` 탭의 `PREPARING` 택배 주문 선택, 주문별 송장 입력 모달, 성공 건 선택 해제, 부분 실패 알림.
- 제외: CSV 업로드, 바코드 스캔, 택배사별 상세 자릿수 검증, 백엔드 일괄 API, 송장 사후 수정.

---

## 2026-05-29 — CL-60 어드민 주문 상세 1차 모달

**결정**: `/admin/orders`의 주문 상세 드릴다운은 1차에서 새 상세 API와 라우트를 만들지 않고, 기존 목록 응답에 포함된 주문 필드를 읽기 전용 Mantine 모달로 표시한다.

**이유**: 운영자가 CS 중 주문번호·상태·배송지·송장·구매자 정보를 한 화면에서 확인해야 하지만, 상품 라인·결제 타임라인·상태 이력까지 포함한 정식 상세 조회는 별도 API와 페이지네이션 설계가 필요하다. 따라서 목록 응답 기반 1차 모달로 운영 통증을 먼저 줄이고, 큰 조회 계약은 별도 SDD로 남긴다.

**범위**: 포함은 데스크톱 행 상세 아이콘, 모바일 카드 상세 버튼, 읽기 전용 상세 모달이다. 제외는 상세 라우트, 주문 상세 조회 API, 송장 사후 수정, 결제·상태 이력 타임라인이다.

---

## 2026-05-29 — CL-61 어드민 주문 정렬·커서 페이지네이션

**결정**: `/admin/orders` 목록은 `createdAt` 기준 `최신순/오래된순`과 `limit/cursor` 기반 `더 보기` 페이지네이션을 제공한다.

**이유**: 기존 `limit(200)` 고정 조회는 운영 주문이 200건을 넘으면 뒤쪽 주문이 누락된다. 다만 정확한 전체 카운트와 offset 페이지 번호는 Firestore 비용과 일관성 리스크가 크므로, 현재 운영 흐름에는 cursor 연속 탐색이 더 작고 안전하다.

**범위**: 포함은 API DTO 검증, `nextCursor` 응답, 프론트 정렬·페이지 크기 Select, `더 보기` 버튼이다. 제외는 임의 페이지 번호, 이전 페이지, `createdAt` 외 컬럼 정렬, 정확한 총 건수 계산이다.

---

## 2026-05-29 — CL-62 어드민 초대 내역 S-A 보기 개선

**결정**: `/admin/invite` 발급 내역은 행별 복사 버튼과 `발급일`·`사용일`을 함께 표시하고, 일시 포맷은 shared `toDateTimeStrKST()`(`MM-DD HH:mm`)로 통일한다.

**이유**: 운영자가 “이 토큰 왜 안 돼요?” 문의를 처리할 때 토큰 복사, 발급 시각, 사용 시각, 상태가 한 행에 있어야 화면 하나에서 답변할 수 있다. 기존 발급 직후 복사만으로는 과거 토큰 재전달과 사용 여부 확인이 불가능했다.

**검증 경계**: clipboard는 `navigator.clipboard` 실패 시 textarea `execCommand('copy')` 폴백을 시도하고, 폴백도 실패하면 빨간 notification으로 실패를 드러낸다. `revokedAt` 취소 상태와 prefix 검색은 다음 세션 S-B/S-C 범위다.

---

## 2026-05-29 — CL-63 어드민 초대 토큰 취소

**결정**: `/admin/invite`는 유효 토큰만 취소할 수 있고, 취소는 토큰 문서를 삭제하지 않고 `revokedAt`·`revokedBy`를 병합 기록한다.

**이유**: 운영자가 잘못 발급했거나 노출된 토큰을 즉시 막아야 하지만, 발급 이력과 CS 추적성은 유지해야 한다. 삭제 방식은 “왜 가입이 안 됐는지”를 설명하기 어렵고, 사용됨·만료 토큰 취소는 가입 이력과 만료 정책을 흐릴 수 있다.

**검증 경계**: revoke API는 이미 사용됨·이미 취소됨·만료를 모두 HTTP 409와 reason(`already_used`·`already_revoked`·`expired`)으로 반환한다. 판매자 가입 경로는 `AuthService.register()`의 사전 검증과 트랜잭션 내 재검증 두 지점 모두에서 `revokedAt`을 차단한다. UI는 유효 토큰에만 취소 버튼을 보이고, 확인창에서 토큰 16자와 가입 불가 문구를 명시한다.

**잔여**: 취소된 토큰으로 가입 시도 시 거부되는 흐름은 T11 e2e에서 자동화해야 하며, 운영/프리뷰 육안 확인은 `pending-visual-verify-20260529.md` §22에 남긴다.

---

## 2026-05-29 — CL-55 어드민 드라이버 status 서버 필터 e2e fixture화

**결정**: 드라이버 status 필터 S3 e2e는 운영 드라이버 데이터를 직접 시드하거나 승인·정지 상태를 변경하지 않고, Playwright `page.route('**/admin/drivers**')` 네트워크 fixture로 `pending`·`approved`·`suspended`·`all` 응답을 고정한다.

**이유**: 운영 단일 DB의 드라이버 승인·정지 상태를 쓰기 없이 보호하면서도, 프론트 hook이 실제로 보내는 URL 쿼리와 화면 카드 명단의 1:1 정합성을 검증하기 위해서다.

**검증**: 로컬 최신 seller 서버(`SELLER_BASE=http://localhost:3017`)에서 `admin-drivers-status-filter.spec.ts`가 chromium·mobile 합산 8/8 통과했다. 기본 운영 `SELLER_BASE` 실행은 아직 구버전 배포 번들을 바라봐 status 쿼리 기대가 실패하므로, 배포 후 CI 또는 프리뷰 재실행으로 최종 종결한다.

---

## 2026-05-30 — CL-55 어드민 드라이버 액션 결과 알림

**결정**: 드라이버 승인·정지·정지 해제 성공 후 카드를 현재 탭에 억지로 남기거나 자동 탭 이동하지 않고, 성공 notification으로 다음 확인 위치를 안내한다.

**이유**: status 서버 필터가 이미 SSOT이므로 액션 후 현재 탭에서 카드가 사라지는 것은 올바른 동작이다. 다만 운영자에게는 카드 소실처럼 보일 수 있어, 승인·정지 해제는 `승인 완료 탭`, 정지는 `정지됨 탭`에서 확인하라고 안내하는 방식이 가장 작은 UX 보강이다.

**검증 경계**: 액션 실패 시 ConfirmModal은 닫지 않고 빨간 notification만 표시해 재시도 가능성을 유지한다. 자동 탭 이동, 낙관적 카드 이동, 백엔드 계약 변경은 범위 밖이다.

---
## 2026-05-30 — #CL-55 admin banner multi API foundation

**결정**: 다중 배너 Phase 3는 기존 `AdminService`에 누적하지 않고 `AdminBannersService`와 `BannerQueryService`로 분리한다.

**이유**: `admin.service.ts`가 500라인 한도에 근접해 있었고, 관리자 CRUD와 손님 활성 배너 조회는 각각 권한·검증과 공개 조회·KST 필터라는 다른 책임을 가진다.

**계약**: 기존 `GET/PUT /admin/banner` 및 `GET /banner`는 기본 배너 호환 경로로 유지한다. 신규 경로는 `GET/POST/PUT/DELETE /admin/banners`, `GET /banners/active`이며, `kind:'default'` 배너 삭제는 422로 차단한다.

---
## 2026-05-30 — #CL-55 배너 캐러셀 구현 방식

**결정**: 소비자 첫 화면 다중 배너 캐러셀은 신규 `@mantine/carousel` 의존성 없이 자체 클라이언트 컴포넌트로 구현한다.

**이유**: 원 계획은 `@mantine/carousel` 또는 자체 슬라이드를 허용하며, 이번 S6의 필수 계약은 `GET /banners/active` 소비, 기본 배너 마지막 배치, 1장 정적 표시, 5초 자동 전환, 점 인디케이터, hover/사용자 조작 시 자동 전환 중지다. 자체 구현으로 잠금 파일과 번들 변동을 줄이면서 동일 계약을 충족할 수 있다.

**계약**: `HeroBanner` 서버 컴포넌트는 `/banners/active`를 `revalidate: 60`으로 조회해 `scheduled + default` 배열을 만들고, 클라이언트 캐러셀은 슬라이드가 1장일 때 자동 전환과 인디케이터를 렌더하지 않는다. CTA는 label과 href가 모두 있을 때만 노출한다.

---
## 2026-05-30 — #CL-55 배너 공개 조회 호환 종료

**결정**: 소비자 공개 배너 조회의 SSOT를 `GET /banners/active`로 확정하고, 구 `GET /banner` 엔드포인트와 일회성 `migrate-banners-kind` 스크립트를 제거한다.

**이유**: S7에서 consumer·seller·driver 최신 배포가 READY임을 확인했고, 소비자 `HeroBanner`가 이미 `/banners/active`만 호출한다. 구 단건 엔드포인트와 마이그레이션 스크립트를 계속 유지하면 새 다중 배너 계약과 낡은 단건 계약이 병존해 운영·테스트 경계가 흐려진다.

**계약**: 공개 조회는 `{ scheduled, default }` 응답을 반환하는 `/banners/active`만 사용한다. 기존 `GET/PUT /admin/banner` 관리자 호환 경로는 기본 배너 편집 호환을 위해 유지하되, 손님용 단건 `GET /banner`는 제거한다.

---
## 2026-05-30 — 육안 검증 운영 분류

**결정**: 미검증 육안 항목은 원문 순서대로 바로 실행하지 않고 A 자동 재검증, B 브라우저 육안, C 인증·권한 필요, D 쓰기 위험, E 배포·데이터 확인으로 먼저 재분류한다.

**이유**: `pending-visual-verify.md`와 `pending-visual-verify-20260529.md`에는 읽기 전용 확인과 지급·환불·정지·삭제 같은 운영 DB 변경 항목이 섞여 있어, 전수 진행 시 누락 또는 위험한 쓰기가 발생할 수 있다.

**계약**: D 분류 항목은 운영 DB에서 바로 실행하지 않고 테스트 데이터, fixture 프리뷰, 또는 롤백 가능한 데이터가 확인된 경우에만 별도 승인 후 진행한다. 실행 지도는 `docs/specs/frontend/visual-verify-execution-map-20260530.md`를 따른다.

---
## 2026-05-31 — 육안 검증 보완 작업 누적

**결정**: 순차 육안 검증에서 실패하거나 보완이 필요한 항목은 원본 체크리스트를 `[ ]`로 유지하고, `docs/specs/frontend/visual-verify-fix-backlog.md`에 수정 내용을 누적한다.

**이유**: 검증 중 즉시 수정하면 아직 확인하지 않은 화면의 회귀 범위가 섞이고, 유사한 UI 결함을 묶어 고칠 기회를 놓칠 수 있다. 검증과 구현을 분리해 전체 결함을 먼저 수집한 뒤 영향 범위와 우선순위를 확인하고 일괄 수정한다.

**계약**: 새 문서에는 작업 번호, 연결된 원본 항목, 화면·URL·뷰포트·재현 조건, 증상, 추정 원인, 수정 후보, 완료 기준을 기록한다. 첫 항목은 소비자 홈 배너 헤드라인과 이미지 겹침 `VF-001`이다.

---
## 2026-05-31 — CL-64 겸직 어드민 사업자 프로필 조회 권한 일관화

**결정**: `GET/PATCH /stores/:storeId`는 다른 스토어 도메인 API와 동일하게 `role === 'admin'`이면 `ownerId` 소유권 검증을 우회한다. `/onboarding` 편집 화면은 기존 스토어 조회 실패 시 빈 폼 저장을 허용하지 않는다.

**이유**: API 명세는 admin의 전체 store 접근을 허용하지만 `StoresService`만 역할 정보를 받지 않아 겸직 계정의 연결 스토어 조회가 거절됐다. 프론트가 이 실패를 숨기면 빈 폼으로 운영 정보를 덮어쓸 수 있다.

**계약**: 컨트롤러는 `user.role`을 서비스에 전달하고, 서비스는 seller의 기존 소유권 검증을 유지하면서 admin만 우회한다. 온보딩 편집 화면은 조회 중 로딩을 표시하고, 실패 시 오류를 노출하며 저장 버튼과 제출 처리를 모두 차단한다. 신규 seller의 최초 등록 흐름은 유지한다.

---
## 2026-05-31 — CL-65 육안 검증 보완 묶음 1차

**결정**: 운영 읽기 전용으로 재현한 `VF-001`, `VF-002`, `VF-006`을 한 묶음으로 보완한다. 배너는 이미지 유무와 모바일 폭에 따라 텍스트 영역을 분리하고, seller는 Mantine `Checkbox.css`를 명시적으로 포함하며, 주문 목록 범위 변경은 일괄 선택 초기화 경계로 취급한다.

**이유**: 세 결함은 운영 데이터 변경 없이 재현됐고 수정 경계가 각각 소비자 배너 레이아웃, seller 공통 스타일, seller 주문 선택 상태로 분리된다. 특히 `VF-006`은 목록에서 사라진 ID만 제거하는 기존 효과로는 같은 ID가 남는 탭 전환을 정리할 수 없다.

**계약**: 이미지가 있는 배너의 데스크톱 텍스트는 왼쪽 `50%` 안에 머물고 `480px` 이하에서는 이미지와 텍스트를 세로 적층한다. seller 전역 스타일은 Mantine `Checkbox.css`를 포함한다. 주문의 판매 유형·상태 탭·날짜 필터·배송 중 하위 필터·우선 알림 이동은 선택을 즉시 비우며, 실시간 목록 갱신의 자격 제거 효과는 유지한다.

---
## 2026-05-31 — CL-66 VF-007 주문 상세 날짜 계약 정규화

**발견**: 운영 seller `RESET-reset-order-parcel` 상세의 배송 정보에서 `수거 예정 시각 Invalid Date`가 노출됐다.

**원인**: 목록 훅 `useOrders`는 Firestore `Timestamp`를 ISO 문자열로 정규화하지만 상세 훅 `useOrderDetail`은 원본 객체를 그대로 전달했다. `Order.preparedAt` 타입 계약은 `string | null`인데 상세 경계만 이를 지키지 않았다.

**결정**: `useOrderDetail`이 주문 문서를 받을 때 `createdAt`, `updatedAt`, `requestedDeliveryDate`, `preparedAt`을 ISO 문자열로 정규화한다. 표시 컴포넌트에 예외 처리를 흩뿌리지 않고 데이터 조회 경계에서 목록과 상세 계약을 통일한다.

**검증**: 변경 seller 파일 Biome 0, seller 타입체크 0, seller 빌드 0. 사용자 승인 후 seller 운영 배포 `dpl_3uKynyzevpMuLXZvdfNuBpswmZGs`가 `READY` 및 `seller.greenlove.co.kr` 별칭 연결됨을 확인했다. 운영 `RESET-reset-order-parcel` 상세 새로고침 후 `수거 예정 시각 5월 23일 오후 05:31` 표시를 확인해 `VF-007`을 종결했다.

---
## 2026-05-31 — CL-67 seller Mantine `NumberInput` 선택 스타일 포함

**발견**: 운영 `/admin/stores` 수수료 편집에서 `NumberInput` DOM에는 증감 버튼 2개가 있지만 화면에는 보이지 않았다.

**원인**: seller는 Mantine 스타일을 필요한 컴포넌트 단위로 선택 import한다. `StoresTable`이 `NumberInput`을 사용하지만 `globals.css`에 `@mantine/core/styles/NumberInput.css`가 빠졌다.

**결정**: seller 전역 스타일에 `NumberInput.css`를 명시적으로 포함한다. 운영 데이터 상호 깨짐은 별도 `VF-008` 데이터 정리 항목으로 분리한다.

**계약**: 수수료 입력은 기존 `min=0`, `max=1`, `step=0.01`, `clampBehavior="strict"`, `inputMode="decimal"` 계약을 유지한다. CSS 보완 후 데스크톱과 모바일에서 증감 제어와 버튼 배치를 재검증한다.

**검증**: 변경 CSS Biome 0, seller 타입체크 0, seller 빌드 0. 사용자 승인 후 seller 운영 배포 `dpl_G5uNkgqeE7rgQkSCfYaFhwoWVacn`가 `READY` 및 `seller.greenlove.co.kr` 별칭 연결됨을 확인했다. 운영 난플렉스 수수료 편집에서 증감 제어 2개 표시, 위 제어 `0 → 0.01`, 아래 제어 하한 `0` 유지를 확인하고 취소해 `VF-009`를 종결했다. 저장 API는 호출하지 않았다.

---
## 2026-06-01 — CL-68 어드민 주문 조회 실패 시 오래된 목록 폐기

**발견**: 운영 `/admin/orders`에서 상태 필터를 바꾸면 Select 값은 바뀌지만 이전 목록이 그대로 남았다. Railway CLI 인증 만료로 운영 로그는 확인하지 못했으나, 프론트 훅이 조회 실패 시 기존 `orders`를 보존하고 화면이 오류를 렌더링하지 않는 결함은 코드에서 확정했다.

**결정**: 첫 페이지 조회 실패 시 `orders`와 `nextCursor`를 비우고 주문 목록 위에 오류 안내를 노출한다. `더 보기` 실패는 이미 읽은 목록을 유지하면서 같은 오류 안내를 노출한다.

**이유**: 실패한 필터 결과로 오래된 목록을 보여주면 관리자가 상태 조건이 적용됐다고 오인한다. 첫 페이지와 추가 페이지는 사용자 인지가 다르므로 폐기 범위를 구분한다.

**검증**: 변경 파일 Biome 0, seller 타입체크 0, seller 빌드 0, `admin-orders.spec.ts` chromium·mobile 22건 수집 확인. 운영 e2e는 현재 배포본에 로컬 최신 `스토어` Select가 없어 기존 테스트부터 진입 실패했고, 로컬 e2e는 `AUTH_SECRET`·Firebase 공개 키 부재로 `/api/auth/csrf` 500에서 차단됐다. Railway CLI도 OAuth 만료 상태라 운영 API 실패 원인 확정과 배포 재검증은 잔여다.

---
## 2026-06-01 — CL-69 어드민 주문 상태 조회 운영 인덱스 배포

**원인**: 운영 Firestore에는 `status + createdAt DESC`, `storeId + status + createdAt DESC` 복합 인덱스가 없었다. 어드민 주문 API는 기본 정렬로 `createdAt DESC`를 사용하므로 상태 단독 및 스토어+상태 조합 조회가 실패했다.

**결정**: 저장소의 `firestore.indexes.json`을 운영 프로젝트 `green-e4fe3`에 배포한다. 프론트의 CL-68 오인 방지 계약도 함께 운영 배포해 향후 조회 실패 시 오래된 목록을 결과처럼 표시하지 않는다.

**검증**: `firebase deploy --only firestore:indexes --project green-e4fe3` 성공 후 `gcloud firestore indexes composite list --project=green-e4fe3`에서 신규 인덱스가 모두 `READY`임을 확인했다. seller 운영 배포 `dpl_EyfUmAr6xfJgADfyxe9ded3hDW47`는 `READY`, `seller.greenlove.co.kr` 별칭 연결 완료. 운영 `/admin/orders`에서 `취소됨` 1건, 난플렉스 7건, 난플렉스+`준비중` 3건 조회와 오류 안내 미노출을 확인했다. `apps/e2e/.env` 기본 `SELLER_BASE`는 오래된 branch preview 별칭이라 첫 회귀가 과거 UI에서 22건 실패했으나, 최신 preview `dpl_6i5Uo2rCSSQ381eVdL7nWbcPihFd`를 직접 지정한 `admin-orders.spec.ts` chromium·mobile 회귀는 22/22 통과했다. `VF-010`, `#117`, `#132`를 종결했다.

---
## 2026-06-01 — CL-70 운영 소비자 이름 손상은 원본 데이터 정리로 분리

**발견**: 운영 `/admin/users`에서 소비자 ID `69dcfab6-4dca-43c0-952d-908001257168`, 이메일 `admin@test.com`의 이름이 `���`로 표시된다.

**원인**: Firebase Admin SDK 읽기 전용 조회 결과 Firestore 원본 `name` 자체가 동일한 깨진 문자열이다. 같은 목록의 다른 한글 이름은 정상 표시되므로 프론트 렌더링 결함이 아니다.

**결정**: 코드 수정과 분리한 `VF-011` 운영 데이터 정리 항목으로 유지한다. 정상 이름을 사용자에게 확인받고 운영 Firestore 수정에 대한 별도 승인을 받은 뒤 해당 문서의 `name`만 변경한다.

**검증**: 운영 Firestore 읽기 전용 조회와 Chrome `정연` 프로필의 `/admin/users` 화면을 대조했다. 운영 데이터 수정은 수행하지 않았다.

---
## 2026-06-01 — CL-71 인증 모바일 육안 제약의 자동 회귀 보완

**결정**: 운영 Chrome 확장 브라우저에 뷰포트 강제 기능이 없는 동안, fixture 인증을 사용하는 최신 seller 고정 프리뷰 `mobile` 회귀로 관리자 settlements·orders·stores·invite·users 카드 전환을 우선 검증한다.

**이유**: 로그인 운영 세션은 `1920px`로만 제어할 수 있고 앱 내 브라우저의 `375px` 세션에는 seller·admin 인증이 없다. 운영 계정 설정을 바꾸지 않으면서도 모바일 카드 분기의 구조적 회귀를 차단할 자동 근거가 필요하다.

**계약**: 자동 게이트는 `375px`에서 핵심 액션 접근, 데스크톱 테이블 숨김, `scrollWidth <= clientWidth`를 검증한다. 실제 카드 밀도, 터치 감각, 로딩·빈 상태, `768px` 전환 경계 육안 판정은 인증 가능한 모바일 브라우저 확보 후 별도로 종결한다.

**검증**: 최신 seller 고정 프리뷰 `greenhub-seller-kql0toqxe-jos-projects-d1cecc0c.vercel.app`에서 관련 5개 spec의 `mobile` 프로젝트 39/39 통과. 원본 `#25~#26`, `#30`, `#34`, `#40`을 종결했다.

---
## 2026-06-01 — CL-72 관리자 반응형 `sm` 경계 자동 회귀

**결정**: 인증 가능한 모바일 운영 브라우저가 없는 동안 fixture 인증 Playwright에 관리자 settlements·orders·stores·invite·users 5개 화면의 Mantine `sm` 경계 회귀를 추가한다.

**이유**: 기존 자동 게이트는 `375px` 카드 상태만 확인해 `hiddenFrom="sm"`·`visibleFrom="sm"` 분기가 정확히 `768px`에서 전환되는지 보장하지 못했다. 공통 경계를 한 도우미로 검증하면 화면별 분기 회귀를 같은 계약으로 차단할 수 있다.

**계약**: 각 화면은 `767px`에서 카드를 유지하고 테이블을 숨기며 가로 넘침이 없어야 한다. `768px`에서는 테이블을 표시해야 한다. 실제 카드 밀도와 터치 감각은 인증 가능한 모바일 브라우저 확보 후 육안으로 별도 종결한다.

**검증**: 최신 seller 고정 프리뷰 `greenhub-seller-kql0toqxe-jos-projects-d1cecc0c.vercel.app`에서 관리자 5개 spec chromium·mobile 전체 88/88 통과. 카드 필수 정보와 액션 단언도 보강해 원본 `#24`, `#27`, `#29`, `#31~#32`, `#35`, `#41`, `#67`, `#73`, `#80`, `#88`, `#91`, `#101`, `#108`, `#116`, `#178`, `#190`, `#192`, `#199`, `#206`을 종결했다.

---
## 2026-06-01 — CL-73 판매자 주문 실시간 연결 이후 fixture 판정

**결정**: Firestore 실시간 구독에 의존하는 판매자 주문 E2E는 `실시간 연결` 표시 이후에만 목록·빈 상태·모바일 액션 바를 판정한다.

**이유**: 배포 CORS 불일치 또는 Firebase token sync 미완료 상태는 화면을 `연결 중`에 머물게 한다. 이 상태를 주문 부재로 오인하면 fixture 데이터와 UI 회귀를 구분할 수 없다.

**계약**: `seller-orders.spec.ts`의 데이터 기반 시나리오는 `waitForRealtimeOrders()`를 선행한다. 최신 인증 git preview가 준비되기 전까지 `#159`, `#160`, `#167`, `#174`는 자동화 추가 상태로 유지하고 런타임 종결하지 않는다.

**검증**: `getOrderAlertMeta()` 빈 메타 단위 회귀를 추가해 seller 단위 테스트 7/7을 통과했다. E2E는 최신 고정 프리뷰의 CORS 불일치, 허용 git preview의 과거 번들, 로컬 Firebase token sync 미완료를 각각 분리 확인했다.

---
## 2026-06-02 — CL-74 seller Mantine `Drawer` 선택 CSS 포함

**발견**: 관리자 배너 fixture 모바일 회귀에서 `375px` Drawer CTA 입력 좌표가 `left=200`, `right=493`으로 화면 폭을 벗어났다. 긴 Drawer의 저장 버튼도 자동 스크롤로 접근할 수 없었다.

**원인**: seller는 Mantine 스타일을 컴포넌트 단위로 선택 import한다. `BannerEditDrawer`가 `Drawer`를 사용하지만 `apps/seller/src/app/globals.css`에 `@mantine/core/styles/Drawer.css`가 빠져 있어 Drawer의 `max-width`와 내부 스크롤 규칙이 적용되지 않았다.

**결정**: seller 전역 선택 스타일에 `Drawer.css`를 추가하고 배너 Drawer의 `size`를 `min(780px, 100vw)`로 제한한다. 공통 Mantine Drawer 계약을 복구하면서도 배너 편집기의 넓은 데스크톱 폭이 모바일 뷰포트를 넘어가지 않게 한다.

**검증**: 변경 파일 Biome 0, seller 타입체크 0, seller 빌드 0. seller 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`가 `READY`이며, 해당 프리뷰에서 `seller-banner.spec.ts` chromium·mobile 10/10을 통과했다. 저장 `500` 실패 복구, Storage `403` 실패 복구, `375px` CTA 1열·가로 넘침 0을 확인했다.

---
## 2026-06-02 — CL-75 관리자 기간 배너 쓰기 흐름은 상태형 fixture로 검증

**결정**: 운영 기간 배너를 만들거나 수정하지 않고, `seller-banner.spec.ts`의 목록 fixture가 `PUT`·`DELETE` 요청을 메모리 상태에 반영한 뒤 후속 `GET` 재조회에 반환하도록 한다.

**이유**: `#252~#253`은 목록 갱신과 성공 알림을 확인해야 하지만 운영에는 기본 배너 1건만 있고, 기간 배너 생성·수정·삭제는 운영 쓰기다. 상태형 fixture면 실제 UI 훅의 저장 후 재조회 계약을 운영 데이터 변경 없이 검증할 수 있다.

**검증**: seller 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `seller-banner.spec.ts` chromium·mobile 12/12를 통과했다. 기간 배너 수정 후 Drawer 닫힘·성공 알림·목록 헤드라인 갱신, 삭제 후 성공 알림·목록 제거·기본 배너 유지·삭제 버튼 미노출을 확인했다.

---
## 2026-06-02 — CL-76 소비자 캐러셀 E2E는 환경 변수 게이트 하네스로 검증

**결정**: 소비자 서버 컴포넌트의 `/banners/active` 조회를 브라우저 가로채기로 흉내 내지 않는다. `ENABLE_E2E_FIXTURES=true`일 때만 열리는 `e2e/hero-banner` 경로에서 실제 `HeroBannerCarousel`을 fixture 슬라이드로 렌더하고, 별도 Playwright 설정으로 검증한다. 기본 환경에서는 `notFound()`로 차단한다.

**이유**: `HeroBanner`의 API 호출은 서버 렌더링 중 실행되므로 `page.route()`가 가로챌 수 없다. 운영에 기간 배너를 쓰지 않고도 실제 클라이언트 캐러셀의 자동 전환, 사용자 조작 중지, hover·focus 정지를 검증할 경로가 필요하다.

**계약**: UI 하네스는 소비자 캐러셀 동작만 검증한다. 기간 포함 여부와 `createdAt desc` 정렬은 `BannerQueryService` 단위 테스트가 책임진다. 운영·일반 프리뷰에서 하네스 경로는 404를 반환한다.

**검증**: 로컬 consumer 개발 서버에서 하네스 렌더와 콘솔 오류 0건, 포인터 이탈 후 5초 자동 전환을 직접 확인했다. 전용 Playwright `consumer-banner-carousel.spec.ts` chromium 4/4, API 배너 테스트 6/6, consumer 타입체크·빌드, 변경 파일 Biome을 통과했다. 환경 변수 없이 생성한 consumer 기본 빌드의 `e2e/hero-banner`는 404를 반환한다.

---
## 2026-06-02 — CL-77 관리자 주문 커서 회귀는 선택적 상태형 fixture로 검증

**결정**: `admin-orders.spec.ts`의 기본 4건 fixture는 유지하고, `#185`, `#188` 전용 시나리오에서만 30건 상태형 fixture와 페이지네이션 응답을 켠다. 응답 필터·정렬·커서 잘라내기와 대량 fixture 생성은 `_helpers/admin-orders-pagination.ts`로 분리한다.

**이유**: 운영 주문은 25건 미만이라 `더 보기`를 재현할 수 없고 운영 데이터 생성은 금지되어 있다. 선택적 fixture면 실제 UI 훅의 `limit`, `cursor`, `nextCursor`, 이어붙이기 계약을 검증하면서 기존 주문 회귀의 응답 형태를 바꾸지 않는다. 하위 모듈 분리는 spec의 500줄 제한도 지킨다.

**검증**: 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `admin-orders.spec.ts` chromium·mobile 28/28 통과. `25개` 첫 조회 후 `cursor=25` 다음 5건 이어붙이기, 마지막 `더 보기` 제거, `375px` 4개 필터와 가로 넘침 0을 확인했다.

---
## 2026-06-02 — CL-78 관리자 주문 송장 모바일 회귀는 긴 번호 fixture로 검증

**결정**: 관리자 주문 모바일 카드의 송장 행은 기본 fixture의 송장 보유 주문에 40자 운송장번호를 주입하고, 송장 미보유 주문과 함께 카드 내부 수납과 가로 넘침을 검증한다.

**이유**: 운영 화면은 송장 미보유 주문만 확인할 수 있고, 실제 운송장번호 길이에 따라 모바일 카드 수납 회귀가 달라질 수 있다. fixture를 사용하면 운영 쓰기 없이 송장 보유·빈 값·긴 번호 경계를 한 시나리오에서 검증할 수 있다.

**검증**: 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `admin-orders.spec.ts` chromium·mobile 30/30 통과. `375px` 카드의 스토어 ID 아래 송장 행, 송장 미보유 `-`, 40자 운송장번호, 송장 카드·문서 가로 넘침 0을 확인했다.

---
## 2026-06-03 — CL-79 판매자 택배 상세 회귀는 상태 분리 fixture와 선택 인증 setup으로 검증

**결정**: 판매자 택배 상세의 쓰기 후 표시, 소비자 상세 송장 노출, 모바일 모달 배치를 하나의 변경 가능한 주문에 의존하지 않는다. 송장 보유 `DELIVERED` 읽기 전용 주문과 모바일 모달 전용 `PREPARING` 주문을 별도 시드로 추가한다. seller 전용 회귀 실행 시 consumer 운영 인증 장애가 전체 global setup을 막지 않도록 `SKIP_CONSUMER_AUTH_SETUP=true` 게이트를 허용한다.

**이유**: 기존 `seller-parcel-ship.spec.ts`는 `PREPARING → DELIVERED` 쓰기를 수행하므로 반복 실행과 프로젝트 순서에 따라 후속 검증이 달라진다. 또한 consumer 운영 Credentials 쿠키 미발급이 seller 전용 검증까지 차단하고 있어 앱별 인증 장애를 분리할 실행 경로가 필요하다.

**검증 상태**: 시드 재적재와 변경 파일 Biome은 통과했다. 최신 seller 고정 프리뷰는 새 seller 세션에서도 `/orders/:id` 상세 데이터가 비어 seller chromium 4/4가 실패했다. seller·consumer 운영 도메인은 Credentials 응답의 `set-cookie count=0`이 각각 3회 반복됐다. 원본 `#146~#148`은 실행 환경 복구 후 재검증하며 아직 종결하지 않는다.

---
## 2026-06-03 — CL-80 판매자 우선 알림 배치는 환경 변수 게이트 하네스로 검증

**결정**: 판매자 주문 우선 알림의 빈 상태와 모바일 배치는 `ENABLE_E2E_FIXTURES=true`일 때만 열리는 `/e2e/order-priority-alert` 경로에서 실제 `OrderPriorityAlert`, 공통 `SegmentedTabs`, `EmptyState`를 조합해 검증한다. 기본 환경에서는 `notFound()`로 차단한다.

**이유**: 실제 `/orders`는 인증 세션과 Firestore 시드 상태에 묶여 있어 처리 필요·지연 주문이 모두 없는 상태를 반복 가능하게 만들기 어렵다. 전용 하네스는 운영 데이터 쓰기 없이 알림 미노출과 `375px` 두 버튼 수납 계약만 독립 검증한다.

**계약**: 알림 건수 계산은 `getOrderAlertMeta()` 단위 테스트가 책임진다. UI 하네스는 빈 메타에서 알림이 렌더되지 않는지, 알림 메타에서 텍스트·두 버튼·탭·빈 상태가 가로 넘침 없이 공존하는지만 검증한다. seller `proxy.ts`도 같은 환경 변수 조건에서만 `/e2e/*` 인증 우회를 허용하고, 공통 `Providers`는 해당 경로에서 세션·Firebase 인증 동기화를 생략한다.

---
## 2026-06-03 — CL-81 관리자 정산 지급 상태 보조 문구는 기록 시각만 표시

**결정**: `/admin/settlements`의 상태 Badge 아래에 `paid`는 `입금 완료 YYYY-MM-DD HH:mm`, `confirmed`는 `지급 대기 · 확정 YYYY-MM-DD HH:mm`을 표시한다. 과거 데이터에 `confirmedAt`이 없으면 `지급 대기`만 표시하고, `pending`·`cancelled`에는 보조 문구를 추가하지 않는다.

**이유**: `paidAt`·`confirmedAt`은 이미 저장되지만 화면이 가리고 있어 일괄 지급 성공 후 운영자가 처리 시각을 확인할 수 없었다. 반면 백엔드에는 입금 예정일 필드가 없으므로 임의의 예정 시각 계산은 실제 지급 정책처럼 오인될 수 있다.

**계약**: 데스크톱 표와 모바일 카드는 같은 포맷 함수를 사용하고, 기존 KST `YYYY-MM-DD HH:mm` 표시 경로를 재사용한다. 표시 전용 변경이며 지급 API와 배치 계약은 바꾸지 않는다.

---
## 2026-06-03 — CL-82 관리자 정산 스토어명은 기존 관리자 스토어 목록으로 조인

**결정**: `/admin/settlements`는 기존 `useAdminStores()`를 함께 호출해 `storeId -> name` 표시 사전을 만들고, 필터를 검색 가능한 스토어명 `Select`로 교체한다. 정산 조회 API에는 기존처럼 선택한 `storeId`만 전달한다.

**이유**: 정산 API 응답에 스토어명을 중복 저장하거나 새 조회 API를 추가하지 않아도 현재 관리자 화면 규모에서 충분하다. 목록에 없는 과거 또는 고아 `storeId`는 축약 ID로 대체 표시해 식별 정보를 잃지 않는다.

**계약**: 데스크톱 표, 모바일 카드, 체크박스 접근성 이름은 같은 표시 사전을 사용한다. 정산 500건 하드캡 페이지네이션은 `ADMIN-SETTLEMENTS-F3`로 분리한다.

---
## 2026-06-03 — CL-83 관리자 정산 페이지네이션은 `settledAt` 커서로 기존 인덱스를 재사용

**결정**: `GET /admin/settlements`는 `limit`(기본 100, 최대 500)과 `cursor`를 받으며, `limit + 1` 조회로 `nextCursor`를 반환한다. 프론트는 `nextCursor`가 있을 때만 `더 보기`를 노출하고, 클릭 시 기존 정산 목록 뒤에 다음 페이지를 이어 붙인다.

**이유**: 기존 `.limit(500)` 하드캡은 초과 데이터를 조용히 숨겨 합계와 일괄 지급 검토 범위를 왜곡할 수 있다. 별도 신규 인덱스 배포 없이 현재 운영에 존재하는 `settledAt DESC`, `storeId/status + settledAt DESC` 인덱스를 그대로 쓰기 위해 커서는 `settledAt` ISO 문자열로 유지한다.

**계약**: 필터가 바뀌면 첫 페이지부터 다시 조회한다. 단건 지급·일괄 지급 성공 뒤에는 첫 페이지를 재조회한다. 동일 `settledAt`을 가진 대량 문서의 완전 안정 커서는 추후 문서 ID 보조 정렬과 인덱스 추가가 필요하므로, 이번 F3는 운영 하드캡 해소와 추가 페이지 노출을 우선한다.
