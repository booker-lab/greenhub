# Green Hub 프로젝트 메모리
> **SSOT**: 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `archive/memory_archive_20260425.md` · `archive/memory_archive_20260517.md` · `archive/memory_archive_20260529.md`

최종 수정: 2026-05-29 (어드민 드라이버 탭 S2 타입 정규화)

---

## 최신 진행 현황

**어드민 소비자(users) 탭 개선 S1~S5 코드·문서 정리**:
- S1: `AuthService.refresh()`가 refresh token rotation 검증 후 `users/{userId}.suspended === true`면 401을 반환한다. 이미 발급된 access token의 최대 1시간 자연 만료 지연은 수용한다.
- S2: `/admin/users`에 가입일(KST `toDateStrKST`)·전화 표시와 새로고침 버튼을 추가했다.
- S3: `UsersFilters`와 `_lib.ts`를 신설해 이름·이메일·전화 검색, 전체/정상/정지 필터, 빈결과 분기를 순수함수로 분리했다.
- S4: `AdminService.getUsers()`에 `createdAt desc` 최신순과 `limit(5000)`을 적용하고 `firestore.indexes.json`에 `users(role ASC, createdAt DESC)` 인덱스를 추가했다.
- S5: `apps/e2e/tests/admin-users.spec.ts`를 신설했다. 가입일·전화 데스크톱/모바일 표시, 새로고침, 검색, 상태 필터, 빈결과, 정지 ConfirmModal 요청 본문을 fixture 격리로 검증한다.

**어드민 settlements F2 일괄 지급 진행**:
- T-F2a~c 백엔드 완료: `BulkPaySettlementsDto`, `AdminService.bulkMarkAsPaid(ids)`, `POST /admin/settlements/bulk-pay`, 성공·부분 실패·전체 실패 단위 테스트.
- T-F2d~e 프론트 완료: `useAdminSettlements.bulkMarkAsPaid(ids)`, `/admin/settlements` 데스크톱·모바일 `confirmed` 전용 체크박스, 전체 선택, 선택 건수·지급 합계 액션 바, 확인 모달, 성공·부분 실패 알림.
- 부분 실패 UX 결정: 성공 건은 선택 해제, 실패 건만 선택 유지. 실패 사유는 알림에 최대 3개 표시.
- N+3 그룹 A 완료: shared `toDateStrKST`에 `hour`·`minute` 옵션을 추가하고, 어드민 정산일시는 `YYYY-MM-DD HH:mm` KST로 통일했다. 조회 실패 Alert, 헤더 새로고침 ActionIcon, 합계 카드 Tooltip을 추가했다.
- `pending-visual-verify.md` §6 #80~#94를 구현 반영 후 육안 확인 대상으로 갱신했다.
- N+4 그룹 B 완료: 기존 Firestore 정산 status 인덱스를 확인하고 `GET /admin/settlements?status=` DTO·service·hook·status 탭 UI를 연결했다. `pending-visual-verify.md` §7 #95~#101에 육안 확인 항목을 등록했다.
- N+5 그룹 C 완료: shared `periodRange(thisWeek|thisMonth|lastMonth)`를 KST·월요일 시작 기준으로 추가하고, 어드민 정산 필터의 native date input을 Mantine `DatePickerInput` + 빠른 기간 3버튼으로 교체했다. `@mantine/dates`·`dayjs`를 seller 의존성에 추가하고 날짜 스타일을 로드했다.
- `pending-visual-verify.md` §8 #102~#108에 DatePicker·빠른 기간 육안 확인 항목을 등록했다.
- N+6 E3/E5 진행: `apps/e2e/tests/admin-settlements.spec.ts`를 신설해 status 탭, 일괄 지급 부분 실패, 새로고침·단건 지급, 빠른 기간 KST 쿼리를 fixture 격리로 검증한다.
- `pending-visual-verify.md` §9 #109~#114에 N+6 통합 회귀 육안 확인 항목을 등록했다.
- 새 seller preview `https://greenhub-seller-e0w9ozr5s-jos-projects-d1cecc0c.vercel.app`를 생성했다. 최초 재실행은 4/10 통과·6 실패였고, 원인은 e2e fixture가 쿼리 포함 `GET /admin/settlements?status=...`를 실제 API로 흘려보낸 테스트 인프라 결함이었다. route 정규식 보정 후 동일 preview에서 10/10 통과, §9 #109 체크 완료.
- N+6 E1/E2 완료: shared build/test, 4앱 tsc, API unit test, seller·consumer·driver·api build, 정산 변경 파일 biome check 통과. PowerShell에서 루트 `pnpm build`의 앱 필터가 미적중해 앱별 build로 대체 검증했다.
- `pending-visual-verify.md` §9 #115에 E1/E2 자동 정합성 재검증 완료 항목을 추가하고 체크했다. 실화면 최종 확인은 §9 #110~#114에 유지했다.
- 동일 seller preview에서 `admin-settlements.spec.ts`를 재실행해 10/10 통과를 재확인하고, fixture 프리뷰 캡처(`desktop-action-bar.png`, `mobile-action-bar.png`, `mobile-modal.png`)로 §9 #110~#114를 체크 완료했다. 모바일 `scrollWidth/clientWidth`는 375/375로 문서 가로 스크롤 0을 확인했다.
- 사용자 요청으로 정산 후속 구현 3건을 `BACKLOG.md`에 등록했다: `ADMIN-SETTLEMENTS-F4` 스토어명 표시·Select화, `ADMIN-SETTLEMENTS-F3` 500건 하드캡 페이지네이션, `ADMIN-SETTLEMENTS-A1` 입금일 표시. 모두 별도 SDD 선작성 후 구현한다.

**어드민 orders 세션α 완료**:
- T1: `apps/seller/src/app/admin/orders/_lib.ts`와 `apps/seller/src/hooks/useAdmin.ts`에 shared `OrderStatus`를 적용했다. `STATUS_LABEL`은 `satisfies Record<OrderStatus, string>`로 누락을 컴파일 검증한다.
- T2: `AdminService.forceRefund()`에 위험 상태(`DELIVERING·HUB_ARRIVED·PICKED_UP·DELIVERED·REVIEWED`) 사유 5자 이상 가드를 추가했다. `CANCELLED`는 기존처럼 차단하고, 일반 상태의 빈 사유는 기본 사유로 유지한다.
- `admin.service.spec.ts`에 11개 상태 × 사유 없음·짧음·정상 사유 매트릭스를 추가했고, `pending-visual-verify.md` §10 #116~#120에 운영 반영 후 확인 항목을 등록했다.

**검증 완료(2026-05-29)**:
- `pnpm --filter seller exec tsc --noEmit` 0
- `pnpm --filter consumer exec tsc --noEmit` 0
- `pnpm --filter driver exec tsc --noEmit` 0
- `pnpm --filter api exec tsc --noEmit` 0
- `pnpm --filter ./packages/shared build` 0
- `pnpm --filter ./packages/shared test` 11/11
- 변경 파일 `biome check` 0
- `pnpm --filter seller exec biome check src/hooks/useAdmin.ts src/app/admin/settlements/_client.tsx src/app/admin/settlements/_components/SettlementTable.tsx` 0
- `pnpm --filter seller build` 0
- `pnpm --filter api test -- auth.service.spec.ts` 2/2
- `pnpm --filter seller test -- src/app/admin/users/_lib.test.ts` 8/8
- `pnpm --filter e2e test --list admin-users.spec.ts` 14건 수집
- `pnpm --filter e2e exec playwright test --list admin-settlements.spec.ts` 10건 수집
- `SELLER_BASE=https://greenhub-seller-e0w9ozr5s-jos-projects-d1cecc0c.vercel.app pnpm --filter e2e test -- admin-settlements.spec.ts` 10/10
- `pnpm --filter api test -- admin.service.spec.ts --runInBand` 36/36
- 동일 preview fixture 캡처: `apps/e2e/test-results/admin-settlements-visual/desktop-action-bar.png`, `mobile-action-bar.png`, `mobile-modal.png` 확인
- 이전 세션 기준: api build 0, seller lint 종료 코드 0(기존 `<img>` 경고 2건)

**잔여 확인**:
- `pnpm --filter e2e test -- admin-users.spec.ts`는 현재 `SELLER_BASE`가 운영 기존 화면을 가리켜 `소비자 검색` 미노출로 14/14 실패했다. 새 코드 반영 프리뷰 또는 운영 배포 후 재실행 필요.
- `SELLER_BASE=https://greenhub-seller-git-preview-jos-projects-d1cecc0c.vercel.app pnpm --filter e2e test -- admin-settlements.spec.ts` 10/10 실패 이력은 고정 preview 구버전 문제로 보존. 새 preview 재검증은 통과 완료.
- Firestore `users(role ASC, createdAt DESC)` 인덱스 운영 배포 확인 필요.
- `pending-visual-verify.md` §5 #67~#79에서 `/admin/users` 육안 검증 필요.
- api ESLint 단독 실행은 기존 `any` 계열 부채로 실패한다.

## 다음 진입점

- 새 코드 반영 프리뷰를 만든 뒤 `SELLER_BASE=<프리뷰> pnpm --filter e2e test -- admin-users.spec.ts` 재실행.
- `firebase deploy --only firestore:indexes --project green-e4fe3` 후 §5 #77 체크.
- 운영 또는 인증 가능한 프리뷰에서 `/admin/users` 데스크톱·모바일 육안 확인 후 §5 체크박스 갱신.
- 어드민 orders 다음 진입점은 세션β: `docs/specs/frontend/admin/admin-tab-orders-cancel-paths.md`를 작성해 셀러·소비자 취소 경로를 전수 조사하고, 필요한 경우 동일 위험 단계 가드를 동기화한다.
- 어드민 settlements §9 통합 회귀 육안검증은 fixture 프리뷰 기준 체크 완료. §6~§8의 세부 육안 항목은 운영 또는 인증 가능한 프리뷰에서 필요 시 추가 확인한다.
- 로컬 브라우저 확인은 `/admin/settlements`가 `/login`으로 리다이렉트되고 현재 env의 Firebase `auth/invalid-api-key` 및 Auth.js 설정 오류로 실제 필터 영역 진입이 막힌 상태까지 확인했다.
- 2026-05-29 어드민 orders 세션γ T4·T5 구현: 스토어 ID TextInput을 `useAdminStores` 기반 Select로 교체하고 `치운 스토어 포함` 토글, 헤더 수동 새로고침, 30초 자동 새로고침 토글을 추가했다.
- 검증: `pnpm --filter seller exec tsc --noEmit` 0, `pnpm --filter seller exec biome check src/app/admin/orders src/hooks/useAdmin.ts` 0, `pnpm --filter seller build` 0. 변경 파일 라인 수: `_client.tsx` 98, `OrdersFilters.tsx` 66, `memory.md` 70.
- 로컬 브라우저 확인: `http://localhost:3000/admin/orders`는 `/login`으로 진입했고, 기존 로컬 env 문제(`AUTH_SECRET` 부재, Firebase `auth/invalid-api-key`)로 인증 뒤 주문 탭 실화면 육안 확인은 차단됐다.
- `docs/specs/frontend/admin/admin-tab-orders-plan.md` 세션γ 체크박스 완료 처리, `docs/specs/frontend/pending-visual-verify.md` §12 #127~#135 추가. 다음 진입점은 세션δ(T6 환불 모달 + T7 e2e).
- 2026-05-29 어드민 orders 세션δ T6 구현: `prompt()` 강제환불 입력을 Mantine `RefundModal`로 교체하고, 일반 단계는 사유 선택, 위험 단계(`DELIVERING·HUB_ARRIVED·PICKED_UP·DELIVERED·REVIEWED`)는 빨간 경고와 5자 이상 사유 필수로 분기했다. 위험 단계 주문에도 강제환불 버튼을 노출한다.
- T7: `apps/e2e/tests/admin-orders.spec.ts`를 추가했다. 스토어 Select, 치운 스토어 토글, 상태 Select, 수동 새로고침, 자동 새로고침, 일반/위험 환불 모달, 위험 단계 사유 누락 400을 fixture 격리로 검증한다.
- `docs/specs/frontend/admin/admin-tab-orders-plan.md` 세션δ T6 체크박스 완료 처리 및 T7 작성·수집 상태 갱신, `docs/specs/frontend/pending-visual-verify.md` §13 #136~#142 추가. 다음 진입점은 새 코드 반영 프리뷰에서 `admin-orders.spec.ts` 실행이다.
- 검증: `pnpm --filter seller exec tsc --noEmit` 0, `pnpm exec biome check apps/e2e/tests/admin-orders.spec.ts apps/seller/src/app/admin/orders/_client.tsx apps/seller/src/app/admin/orders/_lib.ts apps/seller/src/app/admin/orders/_components/OrdersTable.tsx apps/seller/src/app/admin/orders/_components/RefundModal.tsx` 0, `pnpm --filter seller build` 0, `pnpm --filter e2e exec playwright test --list admin-orders.spec.ts` 16건 수집. `pnpm --filter e2e exec tsc --noEmit`은 e2e 패키지에 `tsconfig.json`이 없어 TypeScript 도움말만 출력하고 종료 1. 변경 코드 파일 모두 500라인 미만.
- 2026-05-29 T7 실행 완료: 로컬 seller `http://localhost:3010`에 `AUTH_SECRET`, `NEXT_PUBLIC_API_URL`, Firebase 공개 더미 env를 주입해 실행했고 `SELLER_BASE=http://localhost:3010 pnpm --filter e2e test -- admin-orders.spec.ts`가 chromium·mobile 16/16 통과했다. 실패 원인이던 Mantine Select strict selector는 `getByRole('combobox', { name })`로 보정했다.
- `pending-visual-verify.md` §12·§13에 e2e 통과 항목을 체크했다. 순수 육안 잔여는 #131·#132·#135·#140·#141이다.

## 고정 규칙 요약

- 신규 기능은 `docs/specs/` 선설계 후 구현한다.
- 결정 발생 시 `docs/CRITICAL_LOGIC.md`에 기록한다. 1000라인 초과 시 종결·SUPERSEDED 항목을 `docs/archive/`로 이관한다.
- 단일 코드 파일 500라인 초과 금지. `docs/CRITICAL_LOGIC.md`, `docs/BACKLOG.md`, memory archive는 누적 로그 예외다.

## 2026-05-29 어드민 드라이버 탭 S2 타입 정규화
- `admin-tab-drivers-plan.md` S2(T2)를 진행해 `AdminService.getDrivers()` 내부 `any`를 로컬 `DriverRow` 타입으로 좁히고, `createdAt` 정렬 접근도 `unknown` 가드로 정리했다.
- `DriverBadge`와 `DriverList`의 `suspended` 옵셔널 분기를 `!!driver.suspended` 기반 상수로 명시했고, `AdminDriver.suspended?: boolean`은 유지했다.
- `pending-visual-verify.md` §14 #219에 S2 런타임 회귀 확인 항목을 추가했다. 검증: API/seller/consumer/driver tsc 0, 변경 파일 Biome 0, 루트 build 0(앱 필터 미매칭), API·seller 개별 build 0. 변경 파일과 `memory.md`는 라인 제한 미만.

## 2026-05-29 판매자 택배 운송장 필수화
- `seller-orders-improve-plan.md` 짠A를 이어서 택배 `PREPARING → DELIVERED` 전환 전 택배사와 운송장번호를 받는 Mantine 모달을 추가했다.
- API `UpdateStatusDto`와 `OrdersLifecycleService`에 같은 필수값 검증을 넣어 직접 호출 우회를 차단하고, `Order` 타입과 shared dist에 `courierCompany`, `trackingNumber`를 반영했다.
- 판매자 주문 상세와 소비자 주문 상세에 저장된 택배사/운송장번호를 노출하고, `pending-visual-verify.md` 짠14 #143~#148에 육안검증 항목을 추가했다.
- 검증: shared build, API/seller/consumer tsc, 변경 파일 Biome, API/seller/consumer build, `seller-parcel-ship.spec.ts` 4/4 통과. 변경 코드 파일은 모두 500라인 미만, `memory.md` 200라인 미만.

## 2026-05-29 어드민 주문 목록 송장 표시
- `admin-tab-orders-plan.md` B-8.5 A1 부채를 이어서 `/admin/orders` 데스크톱 테이블과 모바일 카드에 읽기 전용 송장 정보를 추가했다.
- API 계약 변경 없이 `AdminOrder` 타입에 `courierCompany`, `trackingNumber`를 반영하고, 송장 없는 주문은 `-`로 표시한다.
- `pending-visual-verify.md` §15 #149~#154에 육안검증 항목을 추가했다.
- 검증: seller tsc, 변경 파일 Biome, seller build, `admin-orders.spec.ts` 수집 18건, 로컬 seller fixture e2e 18/18 통과. §15 #149·#154 체크 완료, #150~#153은 운영/프리뷰 육안 확인으로 유지한다.

## 2026-05-29 판매자 주문 우선 알림 배너
- `seller-orders-improve-plan.md` §B 1차 범위를 푸시가 아닌 화면 내 우선 알림 배너로 확정했다.
- `/orders` 상단에 처리 필요·지연 주문 건수 배너를 추가하고, `처리 필요 보기`·`지연 주문 보기` 버튼으로 해당 탭에 이동하게 했다.
- 기본 `이번 주` 날짜 필터에서도 지연 주문이 숨지 않도록 지연 주문은 날짜 범위 필터 예외로 두고 `지연` 그룹 최상단에 노출한다.
- 공동구매 지연은 기존 `groupProductConfig.groupDeliveryDate` 조인 결과를 기준으로 계산한다.
- `pending-visual-verify.md` §16 #155~#160에 육안검증 항목을 추가했다.
- 검증: seller tsc, 변경 파일 Biome, `src/app/orders/_constants.test.ts` 3/3 통과, seller build 0. 로컬 `http://localhost:3012/orders` 브라우저 확인은 `/login` 리다이렉트 후 기존 env 문제(`AUTH_SECRET` 부재, Firebase `auth/invalid-api-key`)로 실제 주문 화면 진입이 차단됐다.
- 보강: 공구 지연 배너 계산에서 현재 탭 밖의 공구 주문도 누락하지 않도록 `groupProductConfig` 조인 대상을 공구 전체 `productId`로 넓혔다.
- `pending-visual-verify.md` §16 #161에 공구 탭 밖 지연 주문 육안검증 항목을 추가했다.
- 추가 검증: `pnpm --filter seller test -- src/app/orders/_constants.test.ts` 4/4, `pnpm --filter seller exec tsc --noEmit` 0, 변경 파일 Biome 0.

## 2026-05-29 판매자 주문 일괄 준비 시작
- `seller-orders-improve-plan.md` §C 1차 범위를 송장번호와 충돌하지 않는 `ACCEPTED`·`CONFIRMED` 주문 일괄 준비 시작으로 확정했다.
- `/orders` 카드에 준비 가능 주문 체크박스를 추가하고, 목록 상단에 전체 선택·선택 해제·준비 시작 액션 바와 확인 모달을 추가했다.
- 실행은 기존 단건 상태 변경 API를 주문별로 호출해 API의 상태 전이 가드를 그대로 사용한다. 성공 건은 선택 해제하고 일부 실패는 알림에 성공/실패 건수로 표시한다.
- `pending-visual-verify.md` §17 #162~#167에 육안검증 항목을 추가했다.
- 검증: `pnpm --filter seller exec tsc --noEmit` 0, `pnpm --filter seller test -- src/app/orders/_constants.test.ts` 5/5, 변경 파일 Biome 0, `pnpm --filter seller build` 0. 로컬 `http://localhost:3013/orders` 브라우저 확인은 `/login` 리다이렉트까지 확인했고 인증 후 실주문 화면은 기존 로컬 인증 환경 제약으로 육안검증 목록에 남겼다.

## 2026-05-29 판매자 주문 일괄 택배 발송
- `seller-orders-improve-plan.md` §C 2차 범위를 `PREPARING`·택배 주문의 주문별 송장 입력 모달 발송으로 확정했다.
- `/orders`의 `대기 중` 탭에서 택배 발송 가능 주문을 선택하고, `BulkParcelShipModal`에서 주문별 택배사·운송장번호를 입력해 기존 단건 상태 변경 API를 반복 호출한다.
- 단건 발송과 같은 택배사 목록을 공유하고, `기타` 직접 입력과 3자 이상 운송장번호 필수값을 프론트에서 막는다. 백엔드 parcel 가드는 그대로 SSOT로 둔다.
- `pending-visual-verify.md` §18 #168~#174에 육안검증 항목을 추가했다.
- 검증: `pnpm --filter seller exec tsc --noEmit` 0, `pnpm --filter seller test -- src/app/orders/_constants.test.ts` 6/6, 변경 파일 Biome 0, `pnpm --filter seller build` 0. 로컬 `http://localhost:3013/orders` 브라우저 확인은 `/login` 리다이렉트까지 확인했고 인증 후 실주문 화면은 기존 로컬 인증 환경 제약으로 육안검증 목록에 남겼다.

## 2026-05-29 어드민 주문 상세 1차 모달
- `admin-tab-orders-plan.md` B-9에 F3 1차 범위를 추가했다. 새 상세 API 없이 `/admin/orders` 목록 응답 필드만 읽기 전용 모달로 펼친다.
- `/admin/orders` 데스크톱 행에 상세 보기 아이콘, 모바일 카드에 `상세` 버튼을 추가하고 `OrderDetailModal`에서 주문번호·상태·상품·수량·구매자·배송지·송장·생성/수정일 등을 표시한다.
- `pending-visual-verify.md` §19 #175~#181에 데스크톱·모바일 육안검증 항목을 추가했다.
- 검증: seller tsc 0, 변경 파일 Biome 0, seller build 0, `admin-orders.spec.ts` 20건 수집. 로컬 e2e 실행은 `AUTH_SECRET` 미비 → 보정 후 `NEXT_PUBLIC_API_URL` 미비 → 보정 후 Firebase 공개 env 미비로 `/admin/orders` 렌더가 `This page couldn’t load`에서 차단되어 §19 #181에 재실행 대상으로 남겼다.

## 2026-05-29 어드민 주문 F5 정렬·커서 페이지네이션
- `admin-tab-orders-plan.md` B-10에 F5 1차 범위를 추가했다. `/admin/orders`는 `createdAt` 기준 최신순/오래된순, `limit`, `cursor`를 받으며 `nextCursor`를 반환한다.
- `/admin/orders` 화면에 정렬 Select, 페이지 크기 Select(25/50/100), `더 보기` 버튼을 추가했다. 필터·정렬·페이지 크기 변경은 첫 페이지를 다시 불러오고, 수동/자동 새로고침은 현재 조건의 첫 페이지를 갱신한다.
- Firestore 복합 인덱스에 orders `status+createdAt desc`, `storeId+createdAt asc`, `storeId+status+createdAt asc/desc`를 추가했다.
- `pending-visual-verify.md` §20 #182~#188에 육안검증 항목을 추가했다.
- 검증: API 단위 테스트 `admin.service.spec.ts` 38/38, seller tsc 0, api build 0, seller build 0, 변경 파일 Biome 0. `memory.md` 136라인, 변경 코드 파일 500라인 미만.

## 2026-05-29 어드민 주문 향후 과제 등록
- 사용자 요청으로 `BACKLOG.md` P3 기타 기능 작업에 `ADMIN-ORDERS-A2`, `ADMIN-ORDERS-F3-FULL`, `ADMIN-ORDERS-F5-ADV`, `ORDER-STATUS-LABEL-SSOT` 4건을 등록했다.
- `admin-tab-orders-plan.md` 참고 문서에도 위 4건이 BACKLOG 향후 과제로 승격됐음을 표시했다.

## 2026-05-29 어드민 초대 탭 S-A 보기 개선
- `admin-tab-invite-plan.md`를 확인하고 S-A(T0~T3)를 진행했다. T0 결과, 셀러 초대 토큰 검증은 `AuthService.register()` 한 곳 안의 사전 검증과 트랜잭션 내 재검증 2단계라 다음 S-B revoke 가드는 두 지점 모두에 들어가야 한다.
- `/admin/invite` 발급 내역에 행별 복사 아이콘, 발급일, 사용일을 추가했다. 발급/사용 시각은 shared `toDateTimeStrKST()`로 `MM-DD HH:mm` KST 포맷을 사용한다.
- clipboard 실패 시 textarea 폴백과 실패 notification을 추가했고, 발급 직후 복사와 행별 복사가 같은 `copiedToken` 상태를 공유하도록 정리했다.
- `pending-visual-verify-20260529.md` §21 #189~#194에 육안검증 항목을 추가했다. 메인 `pending-visual-verify.md`는 500라인 가드 때문에 2026-05-29 추가 묶음 인덱스만 남기고 하위 문서로 분리했다. 로컬 dev 서버는 기존 `AUTH_SECRET`/Firebase env 문제로 `/admin/invite` 실제 화면 진입이 차단되어 운영/프리뷰 육안 확인 대상으로 남았다.
- 검증: shared build, shared `date.test.ts` 12/12, seller tsc 0, 변경 파일 Biome 0, seller build 0. `memory.md`는 200라인 미만, 변경 코드 파일은 모두 500라인 미만.

## 2026-05-29 어드민 초대 탭 S-B 토큰 취소
- `admin-tab-invite-plan.md` S-B(T4~T7)를 이어서 `POST /admin/invite/:token/revoke`와 `AdminService.revokeInvite()`를 추가했다. 유효 토큰만 `revokedAt`·`revokedBy`로 병합 기록하고, 사용됨·이미 취소됨·만료는 409 reason으로 거절한다.
- `AuthService.register()`의 초대 토큰 사전 검증과 트랜잭션 내 재검증 양쪽에 `revokedAt` 차단을 추가해 취소 토큰 가입을 막았다.
- `/admin/invite` hook·타입·상태 판정·UI를 확장했다. 유효 토큰에만 취소 아이콘이 보이고, Mantine 확인창은 토큰 전체 16자와 가입 불가 문구를 보여준다. `@mantine/modals`를 seller 의존성에 추가하고 Provider에 연결했다.
- `pending-visual-verify-20260529.md` §22 #195~#200에 육안검증 항목을 추가했다. 로컬 브라우저는 `/admin/invite`가 `/login`으로 리다이렉트되고 기존 Firebase 공개 env/Auth.js 설정 오류로 실제 화면 진입이 차단되어 운영/프리뷰 확인 대상으로 남겼다.
- 검증: API 단위 테스트 `admin.service.spec.ts` 42/42, API·seller tsc 0, API·seller build 0, shared build 0, seller 변경 파일 Biome 0, API admin 변경 파일 Biome 0. `auth.service.ts`를 포함한 API 전체 lint는 기존 `any`·non-null 부채로 실패한다. 변경 코드 파일과 `memory.md`는 500/200라인 미만.

## 2026-05-29 어드민 초대 탭 S-C prefix 검색
- `GET /admin/invite?q=`가 4자 이상 토큰 prefix만 Firestore range 검색하고, 3자 이하는 기존 최신 50건으로 보호한다.
- `/admin/invite` 발급 내역 위에 300ms debounce 검색 입력을 추가했고, 4자 이상 검색 결과가 없으면 `일치하는 토큰이 없습니다.`를 표시한다.
- `pending-visual-verify-20260529.md` §23 #201~#206에 검색 관련 육안검증 항목을 추가했다.
- 검증: API 단위 테스트 `admin.service.spec.ts` 42/42, API·seller tsc 0, API·seller build 0, 변경 파일 Biome 0. 첫 seller tsc는 stale `.next/types`로 실패했으나 build 후 재실행 통과. 변경 코드 파일과 `memory.md`는 500/200라인 미만.

## 2026-05-29 어드민 초대 탭 S-D e2e 검증
- `admin-tab-invite-plan.md` S-D(T10~T12)의 스펙 작성 범위를 진행했다. `apps/e2e/tests/admin-invite-revoke.spec.ts`에서 어드민 초대 취소 확인창·취소 후 `취소됨` 상태·`already_revoked` 알림·prefix 검색 복귀를 네트워크 fixture로 검증한다.
- 취소 토큰 가입 차단은 `AuthService.register()`의 사전 검증과 트랜잭션 재검증 두 지점 단위 테스트로 고정했다. 취소 토큰은 사용자 생성과 invite `usedAt` 소비 처리 없이 `취소된 초대 토큰입니다.`로 거부된다.
- `pending-visual-verify-20260529.md` §24 #207~#210에 S-D 이후 육안검증 항목을 추가했다. 실제 운영/프리뷰에서는 확인창 배치, `취소됨` orange 배지, reason 알림 위치, 검색 결과 행/카드 배치를 확인하면 된다.
- 검증: API `auth.service.spec.ts` 4/4 통과, 변경 TS 파일 Biome 0. 기본 운영 도메인 실행은 이전 UI를 보고 실패했지만, 로컬 seller env를 `AUTH_SECRET`/API URL 기준으로 보정한 뒤 `SELLER_BASE=http://127.0.0.1:3016 pnpm --filter e2e test -- admin-invite-revoke.spec.ts`를 재실행해 chromium·mobile 합산 6/6 통과했다.

## 2026-05-29 어드민 초대 탭 육안검증 인덱스 정리
- 메인 `pending-visual-verify.md`의 2026-05-29 추가 묶음 인덱스에 초대 탭 §22~§24 링크를 보강했다. 실제 항목 본문은 500라인 가드 때문에 `pending-visual-verify-20260529.md`에 유지한다.
- 코드 변경은 없고 문서 정합성만 보강했다. `memory.md`는 200라인 미만, 수정 문서는 모두 500라인 미만이다.

## 2026-05-29 어드민 초대 탭 향후 작업 등록
- 사용자 요청으로 초대 탭의 제외 항목을 BACKLOG P3 향후 작업으로 승격했다. 등록 항목은 `ADMIN-INVITE-F6-F5-ADV`, `ADMIN-INVITE-SCALE-1000`, `ADMIN-INVITE-F7-EXPIRY`, `ADMIN-INVITE-SELLER-ROLLBACK`, `ADMIN-INVITE-REVOKE-NONVALID` 5건이다.
- `admin-tab-invite-plan.md` 참고 문서에도 각 항목이 BACKLOG로 승격됐음을 표시했다.

## 2026-05-29 어드민 드라이버 탭 S1 status 서버 필터 배선
- `admin-tab-drivers-plan.md` S1(T1)을 진행해 `useAdminDrivers({ status })`가 `all` 외 탭에서 `/admin/drivers?status=pending|approved|suspended`를 호출하도록 배선했다. `_client.tsx`의 `filterByTab` 호출과 `_lib.ts`의 클라이언트 필터 함수는 제거했다.
- `pending-visual-verify.md` §14 #211~#218에 드라이버 4탭, 전체 탭 status 쿼리 미전달, 승인/정지 후 목록 이동, 로딩·빈결과, 시각 회귀 육안검증 항목을 추가했다.
- 검증: `pnpm typecheck` 0, 변경 파일 Biome 0, `pnpm --filter seller build` 0. `pnpm lint` 전체는 기존 consumer/driver 진단으로 실패했고, `pnpm --filter seller lint`는 기존 경고 2건만 출력 후 0 종료. 변경 파일과 `memory.md`는 라인 제한 미만.
