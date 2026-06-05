# 육안 검증 보완 작업 모음

> 작성일: 2026-05-31
>
> 목적: 순차 육안 검증에서 통과하지 못한 항목의 수정 내용을 한곳에 모아, 검증 종료 후 일괄 수정한다.
> 원칙: 이 문서는 수정 대기 목록이다. 원본 체크리스트의 결과와 재현 메모는 유지하고, 여기에는 구현에 필요한 보완 내용을 기록한다.

## 1. 기록 규칙

1. 육안 검증에서 실패하거나 보완이 필요하면 원본 항목은 `[ ]`로 유지한다.
2. 원본 항목 메모에는 이 문서의 작업 번호와 화면, URL, 뷰포트, 재현 조건을 기록한다.
3. 이 문서에는 증상, 추정 원인, 수정 후보, 완료 기준을 기록한다.
4. 수정 작업은 검증 진행과 분리한다. 사용자가 일괄 수정 시작을 요청하면 우선순위와 영향 범위를 확인한 뒤 SDD를 갱신하고 구현한다.
5. 수정과 재검증이 끝난 항목만 `[x]`로 바꾸고 완료 메모를 남긴다.

## 2. 보완 작업

### [x] VF-001 소비자 홈 배너 헤드라인과 이미지 겹침

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-05-31 |
| 연결 항목 | `pending-visual-verify-20260529.md` §29 `#260` |
| 화면 | 소비자 홈 공개 화면 |
| URL | `https://greenlove.co.kr` |
| 뷰포트 | 첨부 화면 기준 데스크톱, 약 `1920px` 브라우저 창 |
| 증상 | 배너 헤드라인 `그린러브의 호접란 화병을 만나보세요`가 오른쪽 이미지 영역까지 확장되어 이미지와 겹친다. 텍스트 일부가 어두운 이미지 위에 놓여 가독성이 떨어진다. |
| 추정 원인 | `apps/consumer/src/components/HeroBannerSlide.tsx`에서 이미지는 오른쪽 `50%`를 차지하지만, 텍스트 컨테이너에는 이미지 영역을 피하는 폭 제한이 없다. |
| 수정 계약 | 이미지가 있는 배너의 데스크톱 텍스트 컨테이너는 왼쪽 `50%` 안으로 제한한다. `480px` 이하에서는 이미지와 텍스트를 세로로 쌓고, 이미지 높이는 고정해 헤드라인·CTA가 이미지 영역으로 넘어가지 않게 한다. |
| 완료 기준 | 데스크톱과 `375px` 모바일에서 헤드라인·보조 문구·CTA가 이미지 및 캐러셀 컨트롤과 겹치지 않고, 가로 스크롤이 생기지 않는다. |
| 상태 메모 | 2026-05-31 consumer 운영 배포 `greenhubconsumer-3qzqh5rdq...` 후 `https://greenlove.co.kr` 재검증 완료. 데스크톱 `1280x720`은 텍스트·이미지가 절반 폭으로 분리되고, 모바일 `375x812`는 이미지 `140px` 아래에 텍스트가 적층되며 가로 넘침이 없다. |

### [x] VF-002 판매자 주문 일괄 준비 체크박스 표시 중복

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-05-31 |
| 연결 항목 | `pending-visual-verify-20260529.md` §17 `#162~#163`, `#167` |
| 화면 | 판매자 주문 목록의 일괄 준비 액션 바와 주문 카드 |
| URL | `https://seller.greenlove.co.kr/orders` |
| 뷰포트 | 첨부 화면 기준 데스크톱, 중앙 콘텐츠 폭 약 `480px` |
| 증상 | 액션 바의 전체 선택 체크박스와 준비 가능 주문 카드의 체크박스 아래에 큰 검은 체크 표시가 별도로 중복 노출된다. 미선택 상태와 선택 상태 모두에서 재현되며, 체크박스와 주변 텍스트의 수직 정렬도 흐트러진다. |
| 추정 원인 | Mantine `Checkbox` 내부 아이콘 스타일이 전역 스타일 또는 배포 CSS와 충돌하는지 확인이 필요하다. 관련 사용처는 `apps/seller/src/app/orders/_components/OrderBulkActionBar.tsx`와 `OrderCard.tsx`다. |
| 확정 원인 | seller 선택적 Mantine CSS import 목록에 `@mantine/core/styles/Checkbox.css`가 빠져 `Checkbox` 내부 아이콘의 크기·위치 스타일이 적용되지 않았다. |
| 수정 계약 | seller `globals.css`에 Mantine `Checkbox.css`를 추가한다. 주문 목록뿐 아니라 같은 앱의 어드민 정산 `Checkbox`에도 공통 적용한다. |
| 완료 기준 | 액션 바와 주문 카드에서 체크박스 아이콘이 박스 내부에 한 번만 표시되고, 미선택·선택·부분 선택 상태가 정상 정렬된다. `375px`에서도 카드 내용 및 버튼과 겹치지 않는다. |
| 상태 메모 | 2026-05-31 seller 운영 배포 `greenhub-seller-4p3cn2a57...` 후 주문 지연 목록 재검증 완료. 액션 바와 택배 주문 카드의 체크박스 내부 아이콘은 박스 내부 절대 위치와 정상 크기로 복구됐다. 어드민 정산은 운영 목록이 `0건`이라 행 체크박스 실물은 없었으나 같은 seller 전역 `Checkbox.css` 계약을 사용한다. |

### [x] VF-003 운영 API 배너 최신 계약 미배포

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-05-31 |
| 연결 항목 | `pending-visual-verify-20260529.md` §31~§32 `#266~#268` |
| 화면 | 소비자 홈 공개 화면과 Railway 운영 API |
| URL | `https://greenlove.co.kr`, `https://api-production-13e7.up.railway.app` |
| 증상 | 소비자 홈은 구 단건 기본 배너를 표시하지만 운영 API `GET /banners/active`는 404 `Cannot GET /banners/active`, 구 `GET /banner`는 200으로 단건 JSON을 반환한다. 최신 seller UI의 `/admin/banner`도 `GET /admin/banners` 404로 목록이 0건처럼 표시된다. |
| 추정 원인 | 저장소 최신 코드에는 `137f173`의 `AppController.getActiveBanners()`와 `0f5146a`의 구 공개 `GET /banner` 제거가 반영되어 있으나 Railway 운영 API 배포가 해당 커밋을 포함하지 않았다. Railway 콘솔에서 활성 API 배포는 6일 전 `#CL-53` 커밋이고 이후 GitHub 변경은 `No changes to watched files`로 건너뛴 기록을 확인했다. |
| 수정 후보 | Railway API 최신 커밋 배포 상태와 배포 소스를 확인하고, 운영 쓰기 승인을 받은 뒤 최신 API를 배포한다. 배포 후 `/health` 200, `/banners/active` 200, `/banner` 404, 소비자 홈 기본 배너 및 기간 배너 캐러셀을 재검증한다. |
| 완료 기준 | 운영 API가 신규 공개 계약만 제공하고 소비자 홈이 `/banners/active` 응답으로 기본 배너 1장 또는 기간 배너+기본 배너를 정상 표시한다. |
| 상태 메모 | 2026-05-31 사용자 승인 후 Railway CLI를 `booker-lab's Projects`의 `enchanting-enjoyment` 프로젝트로 제한 인증하고, 깨끗한 `14426f8` 스냅샷을 `api` 운영 서비스에 직접 배포했다. 배포 `f422b2ba-4cad-4b4c-aea4-d86bd6641789` `SUCCESS`. `/health` 200, `/banners/active` 200, `/banner` 404, 인증 없는 `/admin/banners` 401, 로그인 어드민 `/admin/banner` 기본 배너 1건 복구 확인 |

### [x] VF-004 겸직 계정 사업자 프로필 기존 값 미조회

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-05-31 |
| 연결 항목 | `pending-visual-verify.md` §3-A `#42` |
| 화면 | 판매자 설정 → 사업자 프로필 수정 |
| URL | `https://seller.greenlove.co.kr/onboarding` |
| 증상 | 겸직 계정(정연, 연결 스토어 난플렉스)으로 `/onboarding` 진입은 성공하지만 상호명·대표자명·연락처·소재지·사업자등록번호 입력값이 모두 비어 있다. |
| 확정 원인 | `StoresController`가 `GET/PATCH /stores/:storeId`에서 `user.role`을 서비스에 전달하지 않고, `StoresService`도 항상 `ownerId === requesterId`만 허용한다. API 명세의 `admin` 소유권 검증 우회가 이 두 경로에서 누락됐다. `/onboarding`은 GET 실패를 조용히 무시해 빈 폼 저장 위험까지 만든다. |
| 수정 계약 | `GET/PATCH /stores/:storeId`에 `role`을 전달하고 `admin`이면 소유권 검증을 우회한다. `/onboarding` 편집 진입은 기존 정보 조회 중 로딩을 표시하고, 실패 시 오류 노출과 저장 차단을 적용한다. 정상 조회 시 기존 값을 폼에 채운다. |
| 완료 기준 | 겸직 계정과 일반 셀러 모두 기존 스토어 정보가 채워진 편집 폼을 보고, 조회 실패 시 빈 폼 저장으로 기존 정보를 덮어쓸 수 없다. |
| 상태 메모 | 2026-05-31 운영 읽기 전용 재현 완료. 입력 5개가 모두 빈 값이고 화면 오류가 없음을 확인했다. 로컬 수정 완료: API `admin` 우회, 온보딩 조회 실패 노출·저장 차단, API 단위 테스트 4/4, API·seller 빌드 통과. 사용자 승인 후 API 배포 `8faa96e8-6186-4889-a03f-a279be2dd697` `SUCCESS`, seller 배포 `dpl_CQinDk7rjZMZkjaMagY1p7doeUW1` `READY` 및 `seller.greenlove.co.kr` 별칭 연결 완료. 배포 후 읽기 전용 재검증에서 겸직 계정의 기존 상호명·대표자명·연락처·소재지가 정상 조회되었고 오류가 없었다. 사업자등록번호는 기존 저장값이 없는 선택 항목이라 빈 값이다. 저장은 실행하지 않았다. |

### [x] VF-005 소비자 홈 공개 배너 미노출

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-05-31 |
| 연결 항목 | `pending-visual-verify-20260529.md` §29 `#255`, §30 `#265`, §31 `#266`, §32 `#268` |
| 화면 | 소비자 홈 공개 화면 |
| URL | `https://greenlove.co.kr` |
| 뷰포트 | 데스크톱 `1280x720`, 모바일 `375x812` |
| 증상 | 운영 API `GET /banners/active`는 `scheduled: []`, `default: main_hero`를 정상 반환하지만 소비자 홈은 배너 캐러셀을 전혀 렌더링하지 않는다. 로고 소개 영역 다음에 공동구매 섹션이 바로 표시된다. 데스크톱과 모바일 모두 동일하며 콘솔 오류는 없다. |
| 추정 원인 | 로컬 최신 코드에는 `apps/consumer/src/app/page.tsx`의 `<HeroBanner />` 조립과 `/banners/active` 조회가 존재한다. Vercel 소비자 프로젝트의 최근 배포는 `READY`지만 모두 `target: null`이며, 최신 `14426f8` 미승격 배포를 보호 URL로 열면 `Failed to fetch`가 표시된다. 운영 도메인이 배너 렌더 코드가 없는 과거 승격본을 가리키고, 미승격 프리뷰는 API CORS 허용 범위 밖인 상태로 추정한다. |
| 수정 후보 | 소비자 운영 배포 SHA와 별칭을 확인하고, 홈 페이지의 `HeroBanner` 조립 및 `/banners/active` 조회 경로를 점검한다. 수정 전 `VF-001`과 동일 화면 결함인지 별도 회귀인지 구분한다. |
| 완료 기준 | 운영 소비자 홈 데스크톱과 `375px`에서 기본 배너 1장이 표시되고, 기간 배너가 없을 때 좌우 버튼·점 인디케이터가 숨겨진다. `/banners/active` 기본 배너 응답과 화면이 일치한다. |
| 상태 메모 | 2026-05-31 사용자 승인 후 최신 미승격 소비자 배포를 운영 승격했다. 승격 배포 `dpl_93VjrxXyf11ZkBJupJ8t3eziYQve`는 `READY`, `target: production`. 운영 `https://greenlove.co.kr` 데스크톱 `1280x720`과 모바일 `375x812`에서 기본 배너 1장 렌더 복구를 확인했다. 기간 배너가 없어 좌우 버튼과 점 인디케이터는 숨겨졌다. 헤드라인과 이미지 겹침은 별도 `VF-001`로 유지한다. |

### [x] VF-006 판매자 주문 필터 변경 후 일괄 택배 선택 유지

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-05-31 |
| 연결 항목 | `pending-visual-verify-20260529.md` §17 `#164` |
| 화면 | 판매자 주문 목록의 일괄 택배 발송 액션 바 |
| URL | `https://seller.greenlove.co.kr/orders` |
| 뷰포트 | 데스크톱, 중앙 콘텐츠 폭 약 `480px` |
| 증상 | 지연 주문 알림으로 택배 주문 1건을 노출하고 해당 주문을 선택한 뒤 상태 필터 `대기 중`을 누르면 선택 건수 `1건`과 활성화된 `택배 발송` 버튼이 그대로 유지된다. |
| 추정 원인 | `apps/seller/src/app/orders/page.tsx`의 선택 정리 효과가 `bulkEligibleIds`에 여전히 포함된 주문을 보존한다. 필터 전환 자체를 선택 초기화 경계로 취급하지 않는다. |
| 수정 계약 | 상태 탭, 날짜 필터, 일반·공동구매 탭, 배송 중 하위 필터, 우선 알림 이동처럼 목록 범위를 바꾸는 입력이 변경되면 선택을 명시적으로 초기화한다. 목록 갱신에 따른 자격 제거 효과는 별도로 유지한다. |
| 완료 기준 | 일괄 처리 대상 주문을 선택한 뒤 목록 범위를 바꾸는 필터를 조작하면 선택 건수는 `0건`으로 초기화되고 일괄 액션 버튼은 비활성화된다. |
| 상태 메모 | 2026-05-31 seller 운영 배포 후 `RESET-reset-order-parcel` 읽기 전용 재검증 완료. 택배 주문 1건 선택 뒤 `대기 중` 탭을 누르면 선택 건수 `0건`, 액션 버튼 비활성, 체크박스 미선택으로 복귀한다. API 호출 없음. |

### [x] VF-007 판매자 주문 상세 수거 예정 시각 `Invalid Date`

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-05-31 |
| 연결 항목 | `pending-visual-verify.md` §1-B `#21`, `pending-visual-verify-20260529.md` §14 `#143~#148` |
| 화면 | 판매자 주문 상세 |
| URL | `https://seller.greenlove.co.kr/orders/reset-order-parcel` |
| 뷰포트 | 데스크톱 |
| 증상 | 택배 준비 중 주문의 배송 정보에 `수거 예정 시각 Invalid Date`가 노출된다. |
| 확정 원인 | 목록 훅 `useOrders`는 Firestore `Timestamp`를 ISO 문자열로 정규화하지만 상세 훅 `useOrderDetail`은 주문 문서를 원본 객체로 전달한다. 상세 표시가 `new Date(order.preparedAt)`를 호출하면 Firestore `Timestamp` 객체를 해석하지 못한다. |
| 수정 계약 | 상세 조회 경계에서 `createdAt`, `updatedAt`, `requestedDeliveryDate`, `preparedAt`의 Firestore `Timestamp`를 ISO 문자열로 정규화한다. 목록과 상세가 같은 `Order` 날짜 계약을 사용하게 한다. |
| 완료 기준 | 택배 준비 중 주문 상세에서 수거 예정 시각이 한국어 날짜·시각으로 표시되고 `Invalid Date`가 노출되지 않는다. |
| 상태 메모 | 2026-05-31 운영 읽기 전용 재현 후 로컬 수정 완료. seller 변경 파일 Biome 0, 타입체크 0, 빌드 0. 사용자 승인 후 seller 운영 배포 `dpl_3uKynyzevpMuLXZvdfNuBpswmZGs` `READY` 및 `seller.greenlove.co.kr` 별칭 연결을 확인했다. 운영 `RESET-reset-order-parcel` 상세를 새로고침한 뒤 `수거 예정 시각 5월 23일 오후 05:31` 표시를 확인해 종결했다. |

### [x] VF-008 운영 판매자 상호 깨짐 데이터

> 상태 메모: 2026-06-05 `scripts/ops/repair-mojibake-data.mjs --apply`로 운영 Firestore allowlist 대상 `stores/9b2cb652-ff77-46b9-a773-e1efa78fb763.name`을 `테스트 상점`, 연결 seller `users/424b9334-cc05-41b0-a451-840e88733446.name`을 `테스트 판매자`로 보정했다. 쓰기 전 최소 백업은 `docs/archive/ops/mojibake-repair-2026-06-05T05-08-29-077Z.json`에 남겼고, 재조회 dry-run에서 깨짐 의심 `아니오`를 확인했다.

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-05-31 |
| 연결 항목 | `pending-visual-verify.md` §4 `#60` |
| 화면 | 관리자 판매자 목록 |
| URL | `https://seller.greenlove.co.kr/admin/stores` |
| 뷰포트 | 데스크톱 |
| 증상 | 활성 판매자 1건의 상호명이 `�׽�Ʈ �ɰ���`처럼 깨진 문자열로 표시된다. |
| 추정 원인 | 화면 렌더가 아니라 Firestore에 저장된 기존 상호 데이터의 인코딩 손상으로 추정한다. 같은 목록의 `난플렉스`, `테스트 꽃 농장`은 정상 표시된다. |
| 수정 후보 | 해당 스토어 ID `9b2cb652-ff77-46b9-a773-e1efa78fb763`의 원본 값을 운영 데이터에서 확인했다. 운영 데이터 수정은 지금 진행하지 않는다. 향후 정상 상호명을 사용자에게 확인받고 운영 Firestore 수정에 대한 별도 승인을 받은 뒤 `name`만 정리한다. |
| 완료 기준 | 관리자 판매자 목록과 연결 화면에서 해당 상호가 정상 한글로 표시된다. |

### [x] VF-009 seller `NumberInput.css` 선택 import 누락

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-05-31 |
| 연결 항목 | `pending-visual-verify.md` §4 `#61`, `#64` |
| 화면 | 관리자 판매자 목록 수수료 설정 |
| URL | `https://seller.greenlove.co.kr/admin/stores` |
| 뷰포트 | 데스크톱 |
| 증상 | 수수료 `NumberInput`의 DOM에는 증감 버튼 2개가 존재하지만 운영 화면에서 보이지 않는다. |
| 확정 원인 | seller 선택적 Mantine CSS import 목록에 `@mantine/core/styles/NumberInput.css`가 빠졌다. |
| 수정 계약 | seller `globals.css`에 `NumberInput.css`를 추가한다. |
| 완료 기준 | 데스크톱과 모바일 수수료 편집에서 증감 제어가 정상 표시되고 입력·저장·취소 배치와 충돌하지 않는다. |
| 상태 메모 | 2026-05-31 로컬 CSS 보완 후 변경 CSS Biome 0, seller 타입체크 0, seller 빌드 0. 사용자 승인 후 seller 운영 배포 `dpl_G5uNkgqeE7rgQkSCfYaFhwoWVacn` `READY` 및 `seller.greenlove.co.kr` 별칭 연결을 확인했다. 운영 난플렉스 수수료 편집에서 증감 제어 2개 표시와 위 제어 `0 → 0.01`, 아래 제어 하한 `0` 유지를 확인하고 취소했다. 저장 API는 호출하지 않았다. |

### [x] VF-010 어드민 주문 상태 필터 조회 실패 시 이전 목록 유지

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-06-01 |
| 연결 항목 | `pending-visual-verify.md` §10 `#117`, §12 `#132` |
| 화면 | 관리자 주문 목록 |
| URL | `https://seller.greenlove.co.kr/admin/orders` |
| 뷰포트 | 데스크톱 |
| 증상 | 상태 Select에서 `취소됨`을 골라도 전체 10건이 유지된다. 난플렉스 스토어 필터로 7건을 조회한 뒤 `준비중`을 골라도 7건 전체가 유지된다. 상태 Select 표시값은 바뀌지만 목록은 필터링되지 않는다. |
| 확인 범위 | 스토어 Select는 난플렉스 선택 시 전체 10건에서 해당 스토어 7건으로 정상 축소된다. 로컬 프론트 코드는 상태를 `/admin/orders?status=...` 쿼리에 포함하고 API 서비스도 `dto.status`를 Firestore 조건에 반영한다. 로컬 `firestore.indexes.json`에는 주문 `status + createdAt` 및 `storeId + status + createdAt` 인덱스가 정의돼 있다. |
| 확정 원인 | 운영 Firestore에 기본 정렬 `createdAt DESC`와 함께 필요한 `status + createdAt DESC`, `storeId + status + createdAt DESC` 복합 인덱스가 배포되지 않았다. 상태 조건 조회가 실패했지만 프론트 훅은 오류를 화면에 노출하지 않은 채 이전 `orders`를 보존했다. |
| 수정 후보 | Railway 운영 로그 또는 인증된 읽기 전용 API 응답으로 실패 원인을 확정한다. 운영 인덱스 미배포면 인덱스를 배포한다. 프론트는 주문 조회 오류를 사용자가 인지할 수 있게 표시하고, 실패한 필터가 정상 적용된 것처럼 이전 목록을 보여주지 않도록 상태 계약을 정한다. |
| 프론트 수정 계약 | 첫 페이지 조회가 실패하면 현재 `orders`와 `nextCursor`를 비우고 오류 안내를 노출한다. 필터 변경 실패 시 이전 목록을 새 필터 결과처럼 남기지 않는다. `더 보기` 조회 실패는 이미 읽은 목록을 유지하되 오류 안내를 노출한다. |
| 완료 기준 | 상태 단독·스토어+상태 조합에서 해당 상태 주문만 표시되고, 조회 실패 시 이전 목록을 필터 결과처럼 오인할 수 없는 오류 UI가 노출된다. |
| 상태 메모 | 2026-06-01 프론트 오인 방지 수정과 운영 인덱스 배포 완료. `firebase deploy --only firestore:indexes --project green-e4fe3` 후 신규 인덱스 `READY`를 확인했고, seller 운영 배포 `dpl_EyfUmAr6xfJgADfyxe9ded3hDW47`도 `READY` 및 `seller.greenlove.co.kr` 별칭 연결을 확인했다. 운영에서 `취소됨` 1건, 난플렉스 7건 중 `준비중` 3건 조회와 오류 안내 미노출을 확인했다. 최신 preview `dpl_6i5Uo2rCSSQ381eVdL7nWbcPihFd`를 직접 지정한 `admin-orders.spec.ts` chromium·mobile 회귀도 22/22 통과해 종결했다. |

### [x] VF-011 운영 소비자 이름 깨짐 데이터 의심

> 상태 메모: 2026-06-05 `scripts/ops/repair-mojibake-data.mjs --apply`로 운영 Firestore allowlist 대상 `users/69dcfab6-4dca-43c0-952d-908001257168.name`을 `E2E 검증 사용자`로 보정했다. 재조회 dry-run에서 현재 name이 정상값이고 깨짐 의심 `아니오`임을 확인했다.

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-06-01 |
| 연결 항목 | `pending-visual-verify.md` §5 `#67` |
| 화면 | 관리자 소비자 목록 |
| URL | `https://seller.greenlove.co.kr/admin/users` |
| 뷰포트 | 데스크톱 |
| 증상 | 소비자 23건 중 ID 접두사 `69dcfab6…` 1건의 이름이 깨진 문자열로 표시된다. 같은 목록의 다른 한글 이름은 정상 표시된다. |
| 확정 원인 | 운영 Firestore `users/69dcfab6-4dca-43c0-952d-908001257168`의 원본 `name` 자체가 깨진 문자열 `���`로 저장되어 있다. 같은 화면의 다른 한글 이름은 정상 표시되므로 화면 전체 인코딩 문제가 아니다. |
| 수정 후보 | 정상 이름을 사용자에게 확인받고 운영 Firestore 수정에 대한 별도 승인을 받은 뒤 대상 사용자의 `name`만 정리한다. |
| 완료 기준 | 원본 데이터와 정상 이름을 확인하고 관리자 소비자 목록에서 정상 한글로 표시된다. |
| 상태 메모 | 2026-06-01 Firebase Admin SDK 읽기 전용 조회와 Chrome `정연` 프로필의 운영 `/admin/users` 화면을 대조했다. 대상 ID, 이메일 `admin@test.com`, 원본·화면 이름 `���`가 일치한다. 운영 데이터 수정은 수행하지 않았다. |

### [x] VF-012 seller 주문 상세 시각 포맷 hydration 불일치

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-06-03 |
| 연결 항목 | `pending-visual-verify.md` §11 `#126` |
| 화면 | seller 주문 상세 정보 섹션 |
| URL | 로컬 `http://localhost:3011/e2e/order-cancel-status` |
| 증상 | `OrderInfoSection`의 생성 시각이 서버에서는 `AM`, 브라우저에서는 `오전`으로 렌더되어 React hydration 오류가 발생했다. |
| 확정 원인 | `toLocaleString('ko-KR')`의 오전·오후 표기가 서버와 브라우저 런타임에서 달라질 수 있는데 `hour12` 계약을 고정하지 않았다. 같은 포맷을 사용하는 수거 예정 시각도 동일 위험이 있었다. |
| 수정 계약 | 생성 시각과 수거 예정 시각의 `toLocaleString('ko-KR')` 옵션에 `hour12: false`를 추가해 서버·브라우저 출력을 24시간제로 고정한다. |
| 완료 기준 | seller fixture 상세가 hydration 오류 없이 렌더되고 전용 회귀의 `pageerror`가 0건이다. |
| 상태 메모 | 2026-06-03 `OrderInfoSection` 두 포맷을 보완했다. 전용 Playwright chromium·mobile `12/12`, seller 타입체크·기본 빌드를 통과했다. |

## 3. 완료 기록

| 완료일 | 작업 번호 | 수정 요약 | 재검증 결과 |
|--------|-----------|-----------|-------------|
| 2026-05-31 | VF-003 | Railway 운영 API를 `14426f8` 스냅샷으로 직접 배포해 신규 배너 계약 복구 | 배포 `f422b2ba-4cad-4b4c-aea4-d86bd6641789` 성공, 공개·어드민 경로 재검증 통과 |
| 2026-05-31 | VF-004 | 겸직 계정의 스토어 조회 권한과 온보딩 조회 실패 처리를 보정 | 운영 `/onboarding`에서 기존 상호명·대표자명·연락처·소재지 조회 복구, 저장 미실행 |
| 2026-05-31 | VF-005 | 최신 소비자 Vercel 배포를 운영 승격 | 배포 `dpl_93VjrxXyf11ZkBJupJ8t3eziYQve` `READY`, 데스크톱·`375px` 기본 배너 렌더 복구 |
| 2026-05-31 | VF-001 | 배너 데스크톱 텍스트 폭 제한과 모바일 이미지·텍스트 적층 | consumer 운영 배포 후 데스크톱·`375px` 분리 배치와 가로 넘침 0 확인 |
| 2026-05-31 | VF-002 | seller Mantine `Checkbox.css` 선택 import 추가 | seller 운영 주문 액션 바·카드 체크박스 아이콘 정상 크기·위치 확인 |
| 2026-05-31 | VF-006 | 주문 목록 범위 변경 시 일괄 선택 초기화 | seller 운영에서 택배 1건 선택 후 `대기 중` 탭 전환 시 `0건`·비활성 복귀 확인 |
| 2026-05-31 | VF-007 | 주문 상세 Firestore 날짜 필드를 ISO 문자열로 정규화 | seller 운영 배포 후 택배 주문 상세의 수거 예정 시각이 `5월 23일 오후 05:31`로 정상 표시 |
| 2026-05-31 | VF-009 | seller Mantine `NumberInput.css` 선택 import 추가 | seller 운영 배포 후 수수료 입력 증감 제어 표시와 `0 → 0.01`, 하한 `0` 동작 확인 |
| 2026-06-01 | VF-010 | 주문 상태 조회 복합 인덱스 배포와 실패 시 오래된 목록 폐기 | 운영 `#117` 취소됨 1건, `#132` 난플렉스+준비중 3건 조회, 오류 안내 미노출, preview 회귀 22/22 통과 |
| 2026-06-03 | VF-012 | seller 주문 상세 생성·수거 예정 시각을 24시간제로 고정 | 로컬 seller fixture hydration 오류 해소, 전용 회귀 chromium·mobile 12/12 통과 |
| 2026-06-05 | VF-008 | 운영 테스트 스토어 상호와 연결 seller 사용자명을 테스트/e2e 용도 명칭으로 보정 | Firestore 재조회 dry-run에서 `테스트 상점`, `테스트 판매자`, 깨짐 의심 `아니오` 확인 |
| 2026-06-05 | VF-011 | 운영 테스트 consumer 사용자명을 `E2E 검증 사용자`로 보정 | Firestore 재조회 dry-run에서 `E2E 검증 사용자`, 깨짐 의심 `아니오` 확인 |
