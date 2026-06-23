# Green Hub 메모리
> SSOT: 세션 종료 시 최신 요약만 유지한다. 200라인 초과 시 50라인 이내로 압축한다.
> 이전 이력은 `docs/archive/`, `docs/CRITICAL_LOGIC.md`, `docs/BACKLOG.md`를 참조한다.

최종 수정: 2026-06-23

## 현재 진행 요약

- 소비자 앱 후속 실행 W7을 종결했다. `ProductCard`에 `compact`, `discovery`, `store` variant를 추가하고 `/category`는 discovery, `/stores/[storeId]`는 store를 적용했다. 커밋 `afb37d8`, Preview `dpl_8wxtf5FC836RY7UmLfNEzVTDu7mJ`, Production `dpl_5eJxNgtTWSsF8VxSXsPzUdp73N58`가 `READY`다.
- 사용자 상시 결정에 따라 W1 이후 모든 묶음은 Preview 자동·육안검증 통과 후 동일 artifact를 Production으로 승격하고 운영 도메인 검증까지 마쳐야 종결한다. 다음 묶음은 W8 공개 상품 API 탐색 계약 확장이다.
- 문서작업 세션이 종료되면 다음 작업자가 바로 시작할 수 있도록 완료 묶음, 재수행 금지 범위, 다음 묶음, 첫 행동, 필수 참조 문서, 검증·배포 게이트, 알려진 제약을 담은 핸드오프 프롬프트를 작성한다.
- 핸드오프 프롬프트 1번은 육안검증 종결 가지, 2번은 개발·릴리즈 트레인 가지로 분리했다. 다음 대화에서 번호를 순서로 해석하지 않는다.
- 프롬프트 1번 육안검증은 현재 실행 가능한 항목을 종결했다. `#43`, `#79`는 운영 쓰기 승인 또는 전용 테스트 계정·정지 refresh token 조건 부재로 `[-]` 처리했다.
- 프롬프트 2번 릴리즈 트레인은 `shared-contracts`, `api-backend`, `consumer-web`, `seller-admin`, `driver-web`, `e2e-ops`, 후속 consumer fixture 보정까지 커밋·푸시·Vercel Preview READY 확인이 끝났다.
- 남은 로컬 작업은 seller/admin 검증 보강과 문서 정리다. 핵심 seller-admin 변경은 일괄 택배 발송 부분 실패 처리, 초대 취소 배지·알림 위치 검증, 판매자 치우기·복구·archived 상세 검증, 온보딩 역할 분리 검증이다.
- 셀러 대검증 전 운영 Firestore 정리용 `scripts/cleanup-seller-validation-data.mjs`를 추가했다. 기본은 dry-run이고, 실제 삭제는 백업 후 `--apply`를 명시해야 한다.
- 2026-06-09 정리 대상 두 스토어는 백업 후 정리 완료했다. `난플렉스` 35건, `테스트 상점` 9건을 삭제했고 `dailyCaps`는 보존했다.

## 최신 검증

- W6: 변경 파일 Biome, `pnpm --filter consumer lint` 오류 0·기존 경고 14, `pnpm --filter consumer build`, `pnpm --filter consumer exec tsc --noEmit`, `git diff --check`, 로컬·Preview branch alias `consumer-stores.spec.ts` chromium/mobile 8/8 통과. Preview branch alias와 Production `greenlove.co.kr/stores` 375px·1440px 스모크에서 가로 넘침 0, 오류 오버레이 0, 콘솔 오류 0, `구매 가능순`·`준비 중`·`상품 준비 중` 표시 확인.
- `git diff --check` 통과.
- `pnpm exec biome check` 변경 핵심 파일 10개 통과.
- `node --check scripts/cleanup-seller-validation-data.mjs` 통과.
- `pnpm --filter seller build` 통과.
- `pnpm --filter e2e test -- admin-invite-revoke.spec.ts --project=chromium --project=mobile` 32/32 통과.
- `pnpm --filter e2e test -- seller-onboarding.spec.ts --project=chromium` 12/12 통과.
- `pnpm --filter e2e test -- admin-stores-filter-sort.spec.ts --project=chromium` 14/14 통과.
- `pnpm --filter e2e test -- admin-store-archive.spec.ts --project=chromium --grep "archived 판매자 상세"` 1/1 통과.
- `ENABLE_E2E_FIXTURES=true` seller dev 서버와 `SELLER_FIXTURE_BASE=http://127.0.0.1:3011` 기준 `seller-order-bulk-parcel-ship.spec.ts` 2/2 통과.

## 다음 진입 후보

- 소비자 앱 육안검증 후속 큐의 실행 Blueprint를 `docs/plans/PLAN_consumer-app-visual-followup.md`로 분리했다. W0~W6은 완료됐고, 다음은 W7이다.
- 다음 첫 행동은 `docs/specs/frontend/consumer-category-exploration-plan.md`, `apps/consumer/src/components/ProductCard.tsx`, 상점 상세 사용처를 대조해 `compact`, `discovery`, `store` variant의 표시 필드와 접근성 계약을 먼저 확정하는 것이다.

- `docs-policy`와 `seller-admin` 변경을 분리 stage·커밋하고 Vercel Preview READY를 확인한다.
- `misc-review`에 남은 `AGENTS.md`, hub staff 문서, archive/plan 파일은 이번 seller 검증 묶음에 섞지 말고 별도 검토한다.
- 커밋 전 `pnpm release:plan`, staged diff, 파일 라인 수, `docs/memory.md` 라인 수를 다시 확인한다.
- 2026-06-09 `docs/specs/full-flow-manual-test-guide.md` 추가. 셀러/소비자/드라이버 전체 흐름 수동 검증 준비, 상태 전이, 환경 변수, 테스트 데이터, E2E 연결, 정산 확인 항목을 정리했다.
- 2026-06-09 소비자 홈에 남은 `테스트 장미 (E2E 전용)` 원인 확인 및 삭제. 세 번째 스토어 `test-store-001`의 `test-product-001`이었고, cleanup 스크립트로 1건 삭제 완료. 전체 products/orders 집계 0건, Firestore activeProducts 0건, 운영 API `GET /products?isActive=true` 응답 `items: [], total: 0` 확인.
- 2026-06-10 상품 등록 `판매 단위` 자유 입력 제거. 현재 수량 계약은 `quantity`와 공동구매 수량 필드가 담당하고, 향후 포장 단위가 계산 기준이 되면 별도 SDD로 구조화 필드를 설계한다.

- 2026-06-10 AI 생성 장애 원인은 `gemini-3-flash-preview`의 간헐 503 과부하로 확인. 공식 문서 기준 최신 기본값은 `gemini-3.5-flash`로 전환하고, `gemini-3.1-flash-lite` → `gemini-2.5-flash` → `gemini-2.5-flash-lite` fallback 체인으로 보강. `pnpm --filter api build`, 실제 `AiService` 3회, Chrome 육안검증 화면 성공.
- 2026-06-11 판매자 온보딩 `should not exist` 수정이 후속 운영 배포로 덮인 것을 확인해 재배포. API Railway `abce0e41-3ccd-41f9-aa7a-3a4241f1743e`, seller Vercel `dpl_Gb2D6A8jJKuJt43Vx79fPbxEDZaV`가 운영 alias에 반영됐고 `/health`, `/onboarding` 200 확인.
- 2026-06-10 운영 AI 생성 장애 복구. Railway API `cde0020d-d1f7-42a6-867e-a7589975ff57` 성공 배포, `/ai/generate-content` 최종 POST 201 확인. 원인은 프론트 payload와 AI DTO nested 검증 불일치 및 Nest DI type-only import 부팅 실패였고, AI 미리보기 DTO는 객체 수용 후 기본 selection 병합으로 완화했다. Chrome 운영 화면 육안검증에서 헤드라인/상세 설명 생성 성공.
- 2026-06-13 소비자 앱 로그인 페이지 장바구니 배지 노출 원인 확인 및 수정. `BottomNav`가 인증 상태 없이 `localStorage.greenhub_cart` 기반 `useCart().itemCount`를 표시해 미로그인 화면에서도 이전 장바구니 수량이 보였다. `useSession().status === 'authenticated'`일 때만 배지를 표시하도록 제한했다.
- 2026-06-13 `full-flow-manual-test-guide.md` 5.1~5.8 수동 검증을 대화별 핸드오프로 진행하도록 준비. 5.1 전용 새 Codex 대화 `019ebf97-59ee-7641-bcef-91060a04d241`를 생성했고, 완료 시 5.2 핸드오프 프롬프트를 남기도록 지시했다.
- 2026-06-13 전체 거래 수동 검증은 5.1부터 사용자가 실제 Chrome 로그인 세션에서 육안 수행하는 방식으로 전환했다. Playwright preview에서 `POST /stores/:storeId/products`가 `selection.property bundleUnit should not exist` 400으로 차단된 사전 관찰을 남겼고, 실제 Chrome에서도 재현되면 5.1 차단 결함으로 기록한 뒤 5.2를 시작하지 않는다.
- 2026-06-17 소비자 공구 탭 안정화+핵심개선 선 설계 문서 `docs/specs/frontend/consumer-groupbuy-tab-improve-plan.md`를 추가했다. 다음 진입은 공구 상태 유틸과 테스트부터 시작한다.
- 2026-06-17 소비자 카테고리 탐색 완성형 선 설계와 구현을 진행했다. URL 쿼리를 필터 SSOT로 두고, `saleType` 계약을 `normal | group`로 정리했으며, 색상 접기/초기화, 정렬, 검색 진입, 공동구매 카드 보강, `consumer-category.spec.ts` fixture E2E를 추가했다. `pnpm --filter consumer build`, `pnpm --filter consumer exec tsc --noEmit`, 변경 파일 Biome, fixture E2E 5/5 통과. 로컬 브라우저 검증은 CORS 때문에 `127.0.0.1` 대신 `http://localhost:3001` 기준으로 확인한다.
- 2026-06-17 소비자 홈 공동구매 미리보기 개선 구현. 이미지 부모 영역 고정, 남은 시간·남은 수량 표시, 목표 달성 상품 홈 미리보기 제외, `targetQuantity <= 0` fallback을 적용했다. 변경 파일 Biome와 `pnpm --filter consumer build` 통과, 전체 lint는 기존 이슈로 실패, Playwright 모킹 모바일 검증 통과.
- 2026-06-17 소비자 카테고리 탐색 보강. `ColorOption` 누락 색상 4종을 카테고리 칩에 추가하고 공개 상품 API의 공동구매 `recruitDeadline`을 ISO 문자열로 직렬화하도록 맞췄다.
- 2026-06-22 소비자 lint 기준선을 종결했다. `useCart.ts`·`useNotifications.ts`의 파일별 Biome 오류를 제거해 전체 lint 오류 0건을 고정했고, 잔여 경고 14건은 `CONSUMER-LINT-FOLLOWUP`으로 파일별 분리했다.
- 2026-06-17 소비자 상점 탭 개선 구현. 공개 상점 훅 경계와 `StoreCard` 공통화, `/stores` 검색·정렬·결과 없음 상태, `consumer-stores.spec.ts` fixture 검증을 확인했다. `pnpm --filter consumer build`, `pnpm --filter e2e test tests/consumer-stores.spec.ts`, `git diff --check` 통과.
- 2026-06-17 소비자 공구 탭 안정화 구현. 공유 `getGroupBuyStatus()`와 테스트를 추가하고, `/groupbuy` 모집 중·완료/종료·정보 확인 필요 분류, 공구 카드 표시, 상세 CTA와 판매자 지정 배송 방식 고정, API 공구 설정 30개 단위 병합, 공구 E2E 계약 보강을 완료했다. `pnpm --filter consumer exec tsc --noEmit`, `pnpm --filter consumer lint`, `pnpm --filter @greenhub/shared test`, `pnpm --filter api test -- products.service.spec.ts`, `pnpm --filter api build` 통과.
- 2026-06-17 소비자 장바구니 결제 전 차단 구현. `cartValidation` 유틸을 장바구니와 checkout이 공유하고, 문제 항목 사유·`다시 선택하기`·결제 버튼 비활성화·`checkout_cart` 쓰기 차단을 적용했다. `pnpm --filter consumer lint`, `pnpm --filter consumer build`, 로컬 `CONSUMER_BASE=http://localhost:3002` 기준 `consumer-cart.spec.ts`, `consumer-checkout.spec.ts`, `git diff --check` 통과.
- 2026-06-17 상품 상세 일반 상품 CTA 발견성 개선. 배송 방법·배송 희망일 선택을 가격 바로 아래로 올리고, 하단 고정 CTA에 비활성 사유를 표시해 배송일 선택 위치를 안내했다. `pnpm --filter consumer lint`, `pnpm --filter consumer build`, 로컬 브라우저 DOM 확인 통과.
- 2026-06-17 소비자 MY 주문 안심 개선 구현·배포. MY 목록 표시 모델과 주문 상세 행동 모델을 `_lib.ts`로 분리하고, 공동구매 구분·행동 신호·수령/운송장 안내·구매 확정 오류 표시·refetch 결함을 정리했다. 브랜치 `codex/consumer-mypage-order-confirm`, 커밋 `0773a89`, preview `greenhubconsumer-cwjkdcswi-jos-projects-d1cecc0c.vercel.app` READY. `pnpm --filter consumer lint`, `pnpm --filter consumer build` 통과. preview 기준 `consumer-mypage.spec.ts`는 9/11 통과, 인증 주문 목록·고정 택배 상세 fixture/API 조회 실패는 `docs/BACKLOG.md`의 `CONSUMER-MYPAGE-E2E-FIXTURE`로 이관했다.
- 2026-06-17 운영 홈 탭 육안검증 후 소비자 앱 후속 작업 문서 `docs/specs/frontend/consumer-app-visual-followup-plan.md`를 추가했다. 홈 공구 이미지는 카드 내부 고정으로 기술 버그는 해결됐지만, 카드가 과도하게 커서 컴팩트 미리보기 개선이 필요하다고 기록했다.
- 2026-06-17 운영 카테고리 탭 육안검증 결과를 후속 문서에 반영했다. URL 기반 탭·정렬·검색 진입은 정상으로 보고, 공동구매 탭에 `모집 실패` 상품이 노출되는 정책 문제를 `C-CATEGORY-02`로 기록했다.
- 2026-06-17 상점 탭 운영 육안검증에서 정렬 드롭다운 화면 떨림을 확인해 고정 버튼형 정렬로 교체했다. 커밋 `751d1bb`, 운영 배포 `dpl_84RxZN21EGoDxoS2pxrGPXNZvge8` READY, `greenlove.co.kr/stores` 200 확인.
- 2026-06-17 상점 탭 계획 이후 개선점을 후속 문서에 추가했다. 상품 0개 상점 노출 정책, 정렬 문구 명확화, 상점 상세 카드 밀도, CSS preload 경고 정리를 다음 후보로 기록했다.
- 2026-06-21 카테고리 탭 계획 밖 개선 후보를 소비자 앱 후속 문서에 추가했다. 활성 필터 요약, 빈 상태 맥락, 가격대·배송 방식 필터, 판매자·배송 힌트, 색상 그룹화, 정렬 UI, 스크롤 복원, total 분리, 공유 행동, 색상 OR 안내, `ProductCard` variant 분리를 기록했다.
- 2026-06-22 소비자 후속 W1을 종결했다. MY 전용 택배·픽업·공구 fixture 3건을 멱등 복구하고 Preview MY E2E 11/11, 375px·1440px 육안검증, Production `dpl_2NfvKCxpmj3KeBp9gCQwo1mpQx7W` 승격과 운영 200을 확인했다. 다음 묶음은 W2 공구·장바구니 운영 검증 종결이며 첫 행동은 두 E2E를 공유 상태 계약과 대조하는 것이다.
- 2026-06-23 소비자 후속 W3을 종결했다. 홈·카테고리·공구의 참여 가능 기준을 공유 `getGroupBuyStatus()`의 `recruiting`으로 통일하고, 홈·카테고리는 모집 중만 노출하며 실패·종료·설정 오류는 공구 탭 상태 영역으로 분리했다. 구현 커밋 `a243bb5`, Preview `dpl_Bsph794hKAmhztqFFBcGavgnW77h`, Production `dpl_2KRFF5nzqVtXP9E7UrnMeDSX5Ndb`를 확인했고 로컬·Preview E2E chromium/mobile, Preview·Production 375px·1440px 육안검증, 운영 HTTP 200이 통과했다. 다음 묶음은 W4 홈 공동구매 컴팩트 카드이며 첫 행동은 홈 카드 밀도와 W4.1 선 설계를 대조하는 것이다.
- 2026-06-23 소비자 후속 W8 공개 상품 API 탐색 계약 확장 완료. `GET /products`에 `priceMin`·`priceMax`·`deliveryMethod` 쿼리와 `sellerSummary`·`deliverySummary`·서버 필터 기준 `total` 응답 계약을 추가했고, UI 필터 연결과 카드 표시는 W9 범위로 남겼다. 검증은 API 단위 테스트, API 빌드, consumer build·tsc, diff-check를 통과했다.
- 2026-06-23 소비자 후속 W9 카테고리 확장 필터·정보 힌트 완료. `/category`에 가격대·배송 방식 URL 필터와 서버 `total` 표시를 연결하고, `ProductCard` discovery variant에 판매자·배송 힌트를 추가했다. W10 이후 UX와 W11 운영 데이터 정리는 수행하지 않았다. 검증은 Biome, consumer lint·build·tsc, diff-check, `consumer-category.spec.ts` chromium/mobile 18/18 통과.
- 2026-06-23 소비자 후속 W10 카테고리 보조 탐색 UX 완료. 색상 그룹화·OR 안내, 버튼형 정렬, `fromCategory` 상세 복귀 anchor, 현재 조건 링크 복사를 추가했다. W11 운영 데이터 정리는 수행하지 않았다. 검증은 consumer tsc·build·lint, 변경 파일 Biome, diff-check, `consumer-category.spec.ts` chromium/mobile 20/20, 375px Playwright 스모크 통과.
