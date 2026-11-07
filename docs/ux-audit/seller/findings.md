<!-- Language: ko -->

# 그린허브 셀러 앱 UX 여정 감사 (2026-11-06)

> 분석 전용. 코드 수정·커밋 없음. 운영 데이터 변경 없음.

## 0. 실행 환경과 한계 (먼저 읽기)

| 항목 | 내용 |
|---|---|
| 운영 URL | `https://seller.greenlove.co.kr` — **비로그인 화면만** 실행 확인(로그인, 보호 경로 리다이렉트, 초대, 로그인 오류). 스크린샷 접두어 `prod-` |
| 로그인 세션 | `auth/seller.json`(storageState)이 이 클라우드 세션에 없고, headed 브라우저로 카카오 로그인을 받을 수 없어 **운영 로그인 상태는 확인하지 못했다.** |
| 대체 실행 | 저장소의 로컬 하네스(`scripts/dev/local/launcher.mjs`, Firebase 에뮬레이터 + 로컬 API + 셀러 앱 `next dev`). 작업 브랜치 HEAD `f08efb43`. 운영 최신 태그 `prod-20261105-7a028753`과 아래 P0·P1 관련 파일(`products.service.ts`, `product-extras.dto.ts`, `apps/api/tsconfig.json`, `sale-rounds.service.ts`)이 같은 코드임을 `git show`로 확인했다. |
| 로컬 데이터 | 초대 토큰·계정·가게·상품·회차·주문을 **에뮬레이터에만** 만들었다. 로컬이라 상품 등록·회차 저장·판매 예정 전환은 최종 저장까지 진행했다. 주문 **강제 취소**와 **준비 시작**은 확정 모달까지만 진행했다(알림·결제 경로). |
| 테스트 회차/비공개 상품 기능 | 사용하지 않았다(운영에서 저장 동작을 하지 않았기 때문). |
| 로컬 하네스 결함(이번 감사 범위 밖) | ① `seed-seller-orders.mjs`의 초대 ID `local-seller-invite-01`이 API 토큰 형식(`^[A-Za-z0-9]{1,64}$`)에 걸려 시드가 404로 실패한다 → 영숫자 토큰을 에뮬레이터에 직접 넣어 우회했다. ② 로컬 Storage 에뮬레이터 이미지 주소(127.0.0.1)가 `next/image` 허용 호스트에 없어 사진 업로드 직후 화면이 오류 경계로 떨어진다(`p1-image-ok-m.png`) → **로컬 전용 현상**이라 문제 표에는 넣지 않았고, 사진 업로드 성공 경로는 확인하지 못했다. ③ 로컬은 `GEMINI_API_KEY`가 없어 AI 미리보기가 실패한다(`p3-step4-ai-m.png`) → 문제 표에서 뺐다. |
| 뷰포트 | 390×844(`-m`), 1280×800(`-d`). 전체 페이지 스크린샷에서는 고정 하단 탭이 페이지 중간에 겹쳐 찍힌다(캡처 방식 때문이며 실제 화면 결함이 아님). 개발 모드 배지(N)는 개발 서버 표시다. |
| 계정 구분 | `audit-seller`(일반 셀러, 운영과 같은 `round_direct` 가게), `audit-new`(가게 없음), `audit-admin`(로컬에서 `role=admin`을 준 **겸직** 계정). 운영 계정(셀러 겸 어드민)은 쓰지 않았다. |

확인 방식 표기: **실행(운영)** = 운영 URL에서 실행, **실행(로컬)** = 로컬 하네스에서 실행, **코드** = 코드로만 확인.

## 1. 라우트 표

레이아웃: `셀러` = 최대 폭 480px 가운데 열 + 하단 탭(`components/AppShell.tsx:18`, `components/BottomNav.tsx:7-13`). `관리자` = 넓은 레이아웃 + 사이드바(모바일은 햄버거).
뒤로가기: 화면 안 뒤로가기 버튼 유무. 홈 아이콘은 `PageHeader`를 쓰는 모든 화면 제목 옆에 있다(`components/PageHeader.tsx:59-69`).
새로고침: 같은 URL에서 새로고침했을 때 같은 화면이 다시 나오는지(실행(로컬), 두 뷰포트 모두).

| 라우트 | 레이아웃 | 네비 | 뒤로가기 | 새로고침 정상 | 어드민 전용 | 일반 셀러 차단 확인 |
|---|---|---|---|---|---|---|
| `/login` | 단독 카드 | 없음(의도) | 없음 | 예(운영) | 아니오 | 해당 없음 |
| `/login/error` | 단독 카드 | 없음 | "로그인 화면으로" 링크 | 예(운영) | 아니오 | 해당 없음 |
| `/invite/[token]` | 단독 카드 | **하단 탭 노출**(S-19) | 없음 | 예(운영) | 아니오 | 해당 없음 |
| `/onboarding` | 단독 폼 | 없음(의도) | 신규: 없음 / 수정 모드: 설정으로 | 예 | 아니오 | 해당 없음 |
| `/` (홈) | 셀러 | 하단 탭(활성 탭 없음) | 없음 | 예 | 아니오 | 해당 없음 |
| `/orders` | 셀러 | 하단 탭 | 없음(1단계) | 예 | 아니오 | 해당 없음 |
| `/orders/[id]` | 셀러 + 하단 고정 버튼 | 하단 탭 | 있음 | 예 | 아니오 | 다른 가게 주문은 API 403(코드) |
| `/sale-rounds` | 셀러 | 하단 탭 | 없음(1단계) | 예 | 아니오 | 해당 없음 |
| `/sale-rounds/new` | 셀러 | 하단 탭 | 있음 | 예(입력은 초기화) | 아니오 | 해당 없음 |
| `/sale-rounds/[id]` | 셀러 | 하단 탭 | 있음 | 예 | 아니오 | 다른 가게 회차는 API 403(코드) |
| `/products` | 셀러 | 하단 탭 | 없음(1단계) | 예 | 아니오 | 해당 없음 |
| `/products/new` | 셀러, 5단계 폼 | 하단 탭 | 있음 | 예(단계 이동 후 임시저장분 복원) | 아니오 | 해당 없음 |
| `/products/[id]/edit` | 셀러, 5단계 폼 | 하단 탭 | 있음 | 예 | 아니오 | 해당 없음 |
| `/prep` | 셀러 | 하단 탭 | 없음(1단계) | 예 | 아니오 | 해당 없음 |
| `/settings` | 셀러 | 하단 탭 | 없음(1단계) | 예 | 아니오 | "관리자 콘솔로 이동"은 겸직만 노출(실행(로컬)) |
| `/settlements` | 셀러 | 하단 탭(활성 탭 없음) | **없음**(S-14) | 예 | 아니오 | 해당 없음 |
| `/settings/payout-account` | 셀러 | 하단 탭 | **없음**(S-14) | 예 | 아니오 | 해당 없음 |
| `/settings/delivery`, `/settings/daily-caps` | 셀러 | 하단 탭 | 있음 | 예 | 아니오 | 회차 판매 가게에는 설정 메뉴에서 숨김 |
| `/settings/option-stocks` | 셀러 | 하단 탭 | 없음 | 예 | 아니오 | 기능 토글 메뉴 |
| `/settings/store-profile`, `/reactions` | 셀러 | 하단 탭 | — | 기능 꺼짐 → "페이지를 찾을 수 없어요"(의도) | 아니오 | 해당 없음 |
| `/hubs`, `/hubs/new`, `/hubs/[id]…` | 셀러 | 하단 탭 | 목록: 없음 / 하위: 있음 | 예 | 아니오 | 회차 판매 가게에는 메뉴 숨김, URL로는 열림 |
| `/operations` | 셀러 | 하단 탭(활성 탭 없음) | **없음**(S-14) | 예 | 아니오 | 해당 없음 |
| `/admin` → `/admin/stores` | 관리자 | 사이드바 / 모바일 햄버거 + "셀러 화면으로" | 해당 없음 | 예 | **예** | **실행(로컬)**: 일반 셀러가 `/admin`, `/admin/stores` 열면 `/orders`로 이동 |
| `/admin/orders`, `/admin/settlements` | 관리자 | 사이드바 | 해당 없음 | 예 | **예** | 같은 layout 가드(`app/admin/layout.tsx:10-12`) + API `@Roles('admin')`(코드) |
| `/admin/users`, `drivers`, `invite`, `banner`, `audit`, `partner-inquiries`, `reviews` | 관리자 | 사이드바 | 해당 없음 | 미실행 | **예** | 코드: 같은 layout 가드, 호출 API 전부 `AdminController`/`AdminEngagementController` 클래스 단위 `@Roles('admin')`(`apps/api/src/admin/admin.controller.ts:21-23`, `engagement/engagement.controller.ts:190-192`) |
| `/dev/overlays` | — | — | — | — | 로컬 미리보기 전용 | `isLocalPreviewEnabled()` 아니면 `notFound()`(코드) |

비로그인 상태에서 운영의 `/orders`, `/admin`, `/sale-rounds/abc`, 없는 경로는 모두 `/login`으로 이동했다(`prod-*-m.png`).

**권한 결론**: 일반 셀러에게 관리자 메뉴는 보이지 않고(하단 탭 5개 고정, 설정의 관리자 링크는 `role==='admin' && storeId`일 때만, `app/settings/page.tsx:74`), 화면은 `app/admin/layout.tsx:10-12`가 `/orders`로 돌려보내며, API는 `RolesGuard` + DB 역할 재조회(`auth/strategies/jwt.strategy.ts:52-70`)로 막는다. 가게 소유 검사로 다른 가게 경로는 403이다(예: `orders-query.service.ts:305-314`, `products.service.ts:499-505`, `sale-rounds.service.ts:626-631`, `settlements.service.ts:369-373`). **권한 노출(P0)은 발견하지 못했다.** 주의할 점: `RolesGuard`는 `@Roles`가 없는 경로를 통과시키므로(`common/guards/roles.guard.ts:15`) 새 관리자 API에 데코레이터를 빠뜨리지 않아야 한다.

## 2. 문제 표

스크린샷 경로는 `docs/ux-audit/seller/` 기준.

| ID | 여정 | 라우트 | 문제 | 재현 경로 | 심각도 | 스크린샷 | 관련 파일:라인 | 수정 제안 | 확인 |
|---|---|---|---|---|---|---|---|---|---|
| S-01 | 3 상품 등록 | `/products/new` | **상품 등록이 항상 500으로 실패.** 기능 토글이 꺼진 상태(운영 기본값)에서는 화면이 `size` 등 추가 정보를 보내지 않는데, API DTO 클래스의 선택 필드가 `undefined` 자체 속성으로 남아(`target: ES2023` → 클래스 필드 정의) `...productFields`로 Firestore에 그대로 쓰이고, Firestore가 `Cannot use "undefined" as a Firestore value (found in field "size")`로 거부한다. | 로그인 → 상품 → + 등록 → 이름 → 다음 → 색상 → 다음×3 → 가격 25,000 → 등록하기 → "Internal server error". 요청 본문에 `size` 없음, 응답 500 | **P0** | `screenshots/p3-after-submit-m.png` | `apps/api/src/products/products.service.ts:166-174`, `apps/api/src/products/dto/product-extras.dto.ts:150-153`, `apps/api/tsconfig.json:13` | 쓰기 전에 `undefined` 값을 걸러내는 공통 함수(또는 Firestore `ignoreUndefinedProperties`)를 적용하고, 토글 꺼짐 + 사진 없음 + 옵션 없음 본문으로 API 통합 테스트 추가. E2E(`apps/e2e/tests/seller-product-create.spec.ts`)는 제출까지 가지 않아 이 결함을 잡지 못한다 | 실행(로컬, 운영 태그와 같은 코드) + 코드. 운영에서는 저장 금지라 미실행 |
| S-02 | 5 상품 수정 | `/products/[id]/edit` | **상품 수정 저장도 500.** 같은 원인(`...fields` 스프레드에 `undefined` 포함). 판매 중/비활성 토글은 별도 `/active` API라 정상 동작. | 상품 → 수정 → 다음×4 → 가격 27,000 → 저장하기 → "Internal server error" | **P0** | `screenshots/p5-edit-save-m.png`, `screenshots/p5-toggle-result-m.png` | `apps/api/src/products/products.service.ts:209` | S-01과 같은 수정 | 실행(로컬) + 코드 |
| S-03 | 3·4 회차 상품 | `/sale-rounds/new` | **사진 없는 상품을 회차에 넣으면 회차 저장이 500.** 상품 API는 `images: []`를 허용하는데 회차 저장은 `images[0]`(=`undefined`)을 `productImageUrlSnapshot`에 그대로 쓴다. 화면은 "저장 실패 Internal server error"만 보여 원인을 알 수 없다. | 사진 없는 상품이 있는 가게 → 회차 → 새 회차 → 회차 저장 | P1 | `screenshots/r1-after-save-m.png`(오류), `screenshots/r1-after-save2-m.png`(사진 넣은 뒤 저장 성공) | `apps/api/src/sale-rounds/sale-rounds.service.ts:770`, `apps/api/src/products/dto/create-product.dto.ts:94-97` | 스냅샷을 `?? null`로 저장하거나, 상품 등록 시 대표 사진을 필수로 하고 화면에서 막기 | 실행(로컬) + 코드 |
| S-04 | 6 주문 확인 | `/orders`, `/` | **새 주문을 알 방법이 없다.** 주문 화면을 열어 둔 상태에서 새 주문이 들어와도 90초 동안 "처리 필요" 수가 그대로였고 "새로고침"을 눌러야 반영됐다. 화면 복귀(visibilitychange) 때만 다시 읽는다. 결제 확정 시 새 주문 알림은 운영자 텔레그램으로만 가고, 판매자용 템플릿 `SELLER_ORDER_BATCH`는 정의만 있고 호출하는 곳이 없다. | 주문 화면을 연 채 새 주문 추가 → 30/60/90초 "처리 필요 2" 유지 → 새로고침 후 3 | P1 | `screenshots/n1-orders-90s-after-new-order-m.png` | `apps/seller/src/hooks/useOrders.ts:151-158`, `apps/api/src/payments/payment-finalization.service.ts:302-330`, `apps/api/src/notifications/notification-templates.ts:103-106` | 판매자 알림톡(회차별 묶음 또는 건별) 발송, 주문 화면 주기 재조회 또는 실시간 구독, 탭 제목·하단 탭 배지에 새 주문 수 | 실행(로컬) + 코드 |
| S-05 | 1 최초 상태 / 3 회차 | `/sale-rounds`, `/settings`, `/orders` | **새로 가입한 가게는 판매 방식이 `legacy`로 시작한다.** 이 상태에서도 셀러 화면에서 회차 만들기 화면이 그대로 열리고 경고가 없지만, 손님용 공개 회차 API는 404이고(같은 회차를 `legacy`/`round_direct`로 바꿔 가며 확인) 회차 주문 생성도 거절된다(코드). 또 회차 판매와 관계없는 배송비·배송 슬롯·거점 메뉴와 일반/공동구매 탭이 보인다. 판매 방식을 바꾸는 관리자 화면은 없고 가게 하나를 겨냥한 일회성 스크립트만 있다. | 판매 중 회차 A의 가게 판매 방식을 미설정(=legacy)으로 바꿈 → 공개 API `GET /stores/:id/sale-rounds/public/:rid` = 404, `round_direct`로 되돌리면 200 | P1 | `screenshots/e0-settings-m.png`, `screenshots/e0-orders-m.png`, `screenshots/e0-sale-rounds_new-m.png` | `packages/shared/src/store.types.ts:5`, `apps/api/src/sale-rounds/sale-rounds.service.ts:636-641`, `apps/api/src/orders/round-order-create.service.ts:75`, `scripts/enable-dear-orchid-round-direct.mjs` | 신규 가게 기본값을 운영 판매 방식에 맞추거나, 관리자 가게 화면에 판매 방식 전환 추가. `legacy` 가게의 회차 화면에 "손님에게 보이지 않음" 경고 | 실행(로컬, API 응답·화면) + 코드 |
| S-06 | 3·4 회차 작성 / 추가 상황 | `/sale-rounds/new`, `/sale-rounds/[id]` | **회차 폼은 다른 메뉴로 갔다 오거나 세션이 만료되면 입력이 모두 사라지고 경고도 없다.** 회차 이름을 바꾼 뒤 하단 탭 이동 → 뒤로가기 하면 기본값 "11월 17일 배송 회차"로 돌아왔다. 쿠키가 만료된 상태에서 회차 저장을 누르면 `/login`으로 이동하고, 다시 로그인하면 `/orders`로 가서 작성분이 없다. 앱 어디에도 `beforeunload` 경고가 없다. | 새 회차 → 이름 입력 → 하단 "상품" → 뒤로 / 이름 입력 → 쿠키 삭제 → 회차 저장 | P1 | `screenshots/s4-save-after-session-expired-m.png` | `apps/seller/src/app/sale-rounds/new/page.tsx:27-34`(진입 시점 템플릿으로 매번 초기화), 회차 폼에 localStorage 사용 없음 | 회차 폼 임시저장(상품 폼과 같은 방식), 변경이 있으면 이탈 확인, 401일 때 입력을 보관한 뒤 재로그인하고 원래 화면으로 복귀 | 실행(로컬) |
| S-07 | 8 취소 | `/orders` | **손님이 회차 주문을 직접 취소해도 판매자에게 알림이 없다.** 취소 알림은 손님에게만 간다. 경매 전에 구매 목록이 줄어드는 것을 판매자가 화면을 다시 열어야 알 수 있다. | 코드 경로: 손님 취소 → `cancelByConsumer` → 손님에게 `ORDER_CANCELLED` 알림 | P1 | (화면 없음 — 코드 확인) | `apps/api/src/orders/orders-lifecycle.service.ts:466-483` | 판매자 알림(회차·상품·수량 포함)과 주문 화면의 "최근 취소" 표시 | 코드 |
| S-08 | 3·4·5 | `/products/new`, `/products/[id]/edit`, `/sale-rounds/new` | 서버 오류가 영문 원문 **"Internal server error"** 그대로 보인다. 다음에 무엇을 해야 할지 알려주지 않는다. | S-01·S-02·S-03 재현 | P2 | `screenshots/p3-after-submit-m.png`, `screenshots/r1-after-save-m.png` | `apps/seller/src/app/products/_components/useProductForm.ts:274` | 5xx는 한국어 안내 + 입력 보존 안내 + 문의 경로, 오류 ID 표시 | 실행(로컬) |
| S-09 | 1 최초 상태 | `/onboarding` | 사업자 정보 "저장 후 시작하기"로 가게가 만들어진 뒤에도(POST 201) 화면이 `/orders`로 가지 않고 같은 URL에서 **"사업자 프로필 수정"** 화면으로 바뀐다. 3개 계정 모두 같았다. 다시 저장해야 하는지 헷갈린다. 새로고침해도 그대로이고, 주소를 직접 `/orders`로 입력하면 정상 진입한다. | 초대 가입 직후 로그인 → 입력 → 저장 후 시작하기 → 12초 대기 | P2 | `screenshots/01-after-onboarding-m.png`, `screenshots/01-after-onboarding-wait-m.png` | `apps/seller/src/app/onboarding/page.tsx:181-193`, `apps/seller/src/proxy.ts:51-53` | 가게 생성 뒤 세션 쿠키에 storeId가 반영됐는지 확인한 다음 전체 이동(`window.location.assign('/orders')`)하거나, 성공 화면에 "시작하기" 버튼 제공. 원인(쿠키 갱신 경합 추정)은 검증하지 못했다 | 실행(로컬, `next dev`) |
| S-10 | 1 최초 상태 | `/onboarding` | 가게가 없는 계정은 모든 경로가 `/onboarding`으로 강제되는데 이 화면에 **로그아웃·문의 수단이 없다.** 다른 카카오 계정으로 잘못 들어온 사람은 빠져나갈 수 없다. | 가게 없는 계정 로그인 → `/orders`, `/settings`, `/admin` 모두 `/onboarding` | P2 | `screenshots/01-onboarding-m.png` | `apps/seller/src/proxy.ts:51-53`, `apps/seller/src/app/onboarding/page.tsx` | 하단에 "다른 계정으로 로그인(로그아웃)"과 운영 문의 링크 | 실행(로컬) |
| S-11 | 추가 상황 PC/모바일 | 셀러 전 화면 | **PC에서도 셀러 화면은 480px 한 열이다.** 1280px 화면의 대부분이 비고, 주문·회차 상품 목록을 한눈에 비교할 수 없다(관리자 콘솔만 넓은 레이아웃). PC와 모바일의 기능 차이는 없었다. | 1280×800으로 `/orders`, `/sale-rounds` | P2 | `screenshots/e1-orders-d.png`, `screenshots/r3-round-list-d.png`, `screenshots/e0-products_new-d.png` | `apps/seller/src/components/AppShell.tsx:6-18` | 셀러 화면에 데스크톱 구간(주문 표·회차 상품 표·좌측 메뉴) 추가. 최소한 주문·회차 상세는 넓게 | 실행(로컬) |
| S-12 | 6 주문 필터 | `/orders` | **주문 화면에서 회차를 고를 수 없다.** 회차 필터는 `?round=` 주소로만 켜지고(회차 상세의 통계 링크), 날짜·상태 필터만 보인다. 회차가 여러 개 겹치면 원하는 회차만 보기 어렵다. | `/orders` 화면에 회차 선택 UI 없음 | P2 | `screenshots/e1-orders-m.png` | `apps/seller/src/app/orders/page.tsx:142-178` | 날짜 칩 옆에 회차 선택(기본: 진행 중 회차) | 실행(로컬) + 코드 |
| S-13 | 6·추가 상황 | 보호된 모든 경로 | **로그인하면 원래 열려던 화면으로 돌아가지 않는다.** 로그인 안 된 상태로 주문 상세 링크를 열면 `/login`으로 가는데 돌아갈 주소를 넘기지 않아, 로그인 후 항상 `/orders`로 간다. 알림톡·메신저로 받은 링크가 끊긴다. | 운영: `/sale-rounds/abc` → `/login`. 로컬: 쿠키 삭제 → `/orders/audit-round-order-02` → 로그인 → `/orders` | P2 | `screenshots/prod-sale-rounds_abc-m.png` | `apps/seller/src/proxy.ts:44-46`, `apps/seller/src/lib/admin-landing.ts:5,19-21` | `/login?callbackUrl=<원래 경로>`(같은 출처만 허용)로 보내고 로그인 후 그 경로로 이동 | 실행(운영 + 로컬) |
| S-14 | 9·11 | `/settlements`, `/settings/payout-account`, `/operations`, `/hubs` | 설정이나 홈에서 들어가는 2단계 화면인데 **뒤로가기 버튼이 없고**, 하단 탭에서도 활성 탭이 없다. 홈 아이콘이나 브라우저 뒤로가기에만 의존한다. 정산 화면은 하단 탭에 없어 홈 "더보기" 또는 설정 → 정산 관리로만 들어간다. | 설정 → 정산 관리 | P2 | `screenshots/e0-settlements-m.png`, `screenshots/e0-settings_payout-account-m.png`, `screenshots/e0-operations-m.png` | `apps/seller/src/app/settlements/page.tsx:40`, `settings/payout-account/page.tsx:98`, `operations/page.tsx:145`, `hubs/page.tsx:94` | `PageHeader onBack` 추가, 하단 탭 활성 판정에 정산 → 설정 매핑 | 실행(로컬) + 코드 |
| S-15 | 2 대시보드 | `/` | 상품 0·회차 0·정산 계좌 미등록인 **새 가게 홈에 "오늘 할 일을 모두 마쳤어요"**가 뜬다. 첫 할 일(상품 등록 → 회차 만들기 → 정산 계좌)이 안내되지 않는다. 또 로그인 후 첫 화면이 홈이 아니라 `/orders`라서 홈의 "오늘 할 일" 카드를 일부러 찾아가야 한다(홈은 제목 옆 집 아이콘으로만 진입). | 신규 가게로 `/` | P2 | `screenshots/e0-root-m.png`, `screenshots/e1-root-m.png`(데이터 있을 때) | `apps/seller/src/app/_components/TodayTasksCard.tsx:62`, `apps/seller/src/lib/admin-landing.ts:5` | 시작 체크리스트(상품·회차·정산 계좌·판매 방식), 진행 중 회차 마감 카운트다운을 홈 첫 카드로. 로그인 첫 화면을 홈으로 | 실행(로컬) |
| S-16 | 8 취소·환불 | `/orders/[id]` | 판매자 취소 버튼 이름이 **"강제 취소"**이고, 모달은 "소비자에게 알림톡으로 전달됩니다"만 안내한다. **환불 금액·범위·되돌릴 수 없음**이 표시되지 않는다. 또 이 버튼이 "준비 시작" 바로 아래에 같은 폭으로 고정돼 있어 잘못 누르기 쉽다. | 결제 완료 주문 → 강제 취소 | P2 | `screenshots/o1-cancel-modal-m.png`, `screenshots/o1-order-detail-viewport-m.png` | `apps/seller/src/app/orders/[id]/_components/CancelOrderModal.tsx:38,58`, `apps/seller/src/app/orders/[id]/page.tsx:476` | "주문 취소·전액 환불(₩50,000)" 형태로 금액과 되돌릴 수 없음을 명시, 취소 버튼은 보조 메뉴로 이동 | 실행(로컬, 확정 직전까지) |
| S-17 | 4 회차 가격 | `/sale-rounds/new`, `/sale-rounds/[id]` | 회차 가격은 "상품의 지금 가격"으로 미리 채워지고, **경매 예상가·원가·마진을 넣거나 볼 칸이 없다.** "판매 시작 전까지만 고칠 수 있다"는 사실은 판매가 시작된 **뒤에야** 표시된다(작성 중 화면에는 언제까지 정해야 하는지 안내가 없다). | 새 회차 → 회차 상품 / 판매 예정 전환 후 상세 | P2 | `screenshots/e0-sale-rounds_new-m.png`, `screenshots/r3-round-after-schedule-m.png` | `apps/seller/src/app/sale-rounds/[id]/RoundForm.sections.tsx:285-345`, `apps/seller/src/app/sale-rounds/[id]/page.logic.ts:26-29` | 작성 중 화면에 "주문 시작(11/12 10:00) 이후 가격 고정" 표시, 상품별 예상 경매가 입력과 마진 표시 | 실행(로컬) + 코드 |
| S-18 | 3 회차 | `/sale-rounds/new` | 상품이 없을 때 경고("회차에 넣을 상품을 먼저 등록해 주세요")에 **상품 등록으로 가는 링크가 없다.** | 상품 0인 가게 → 새 회차 | P3 | `screenshots/e0-sale-rounds_new-m.png` | `apps/seller/src/app/sale-rounds/new/page.tsx:75-80` | 경고 안에 "상품 등록하기" 버튼 | 실행(로컬) |
| S-19 | 1 최초 진입 | `/invite/[token]` | **운영 초대 화면에 셀러 하단 탭이 보인다.** 로그인 전 초대받은 사람에게 주문·회차 탭이 노출되고, 누르면 로그인 화면으로 간다. | 운영 `/invite/abc123` | P3 | `screenshots/prod-invite_abc123-m.png` | `apps/seller/src/components/BottomNav.tsx:22` | 숨김 경로에 `/invite` 추가 | 실행(운영) |
| S-20 | 1 최초 진입 | `/invite/[token]` | 초대 화면이 토큰을 미리 확인하지 않아, **아무 토큰이나 "판매자로 초대받았어요"**를 보여 준다. 만료·사용된 링크인지는 카카오 로그인을 거친 뒤에야 안다. | 운영 `/invite/abc123` | P3 | `screenshots/prod-invite_abc123-m.png` | `apps/seller/src/app/invite/[token]/page.tsx` | 페이지 진입 시 토큰 상태(유효/만료/사용됨) 조회 API로 먼저 안내 | 실행(운영) + 코드 |
| S-21 | 추가 상황 오류 | 오류 경계 | 오류 화면이 "**아래 오류 번호**와 함께 알려 주세요"라고 하는데, 클라이언트 오류에는 digest가 없어 번호가 표시되지 않는다. | 오류 경계 진입(로컬 이미지 호스트 오류로 확인) | P3 | `screenshots/p1-image-ok-m.png` | `apps/seller/src/app/error.tsx:98-104` | digest가 없으면 문구를 바꾸거나 클라이언트에서 오류 ID를 만들어 표시 | 실행(로컬) + 코드 |
| S-22 | 6 주문 | `/orders` vs `/admin/orders` | 같은 상태(`ACCEPTED`)가 셀러 화면은 "결제 완료", 관리자 콘솔은 "접수됨"으로 보인다. 겸직 계정과 운영자 사이에 혼선이 생긴다. | 같은 주문을 두 화면에서 비교 | P3 | `screenshots/e1-orders-m.png`, `screenshots/a1-admin_orders-m.png` | `apps/seller/src/app/orders/_constants.ts:46`, `apps/seller/src/app/admin/orders/_lib.ts:8` | 상태 라벨을 공용 상수로 통일 | 실행(로컬) |
| S-23 | 3·4 | `/sale-rounds/[id]` | 회차 상품 카드에 **내부 상품 ID**가 이름 아래 그대로 보인다(운영에서는 UUID). | 회차 상세 → 회차 상품 | P3 | `screenshots/r3-round-after-schedule-m.png` | `apps/seller/src/app/sale-rounds/[id]/RoundForm.sections.tsx:308` | ID 대신 상품 기준가·사진 표시 | 실행(로컬) |
| S-24 | 3 / 추가 상황 | `/products/new` | 상품 폼은 **단계를 넘길 때만** 자동 임시저장된다. 1단계에서 이름만 쓰고 다른 탭으로 갔다 오면 사라진다(2단계 이후는 복원됨). 이탈 경고는 없다. | 상품명 입력 → 하단 "회차" → 뒤로 → 상품명 빈칸 | P3 | `screenshots/p3-step1-lost-m.png`, `screenshots/p2-draft-after-back-m.png` | `apps/seller/src/app/products/_components/useProductForm.ts:120,180` | 입력 변화 시 자동 저장(디바운스) | 실행(로컬) |
| S-25 | 공통 | `PageHeader`를 쓰는 하위 화면 | 화면 안 뒤로가기 버튼에 **접근성 이름이 없다**(아이콘만). 화면 낭독기가 버튼 용도를 읽지 못한다. | 주문 상세 등 | P3 | `screenshots/e1-orders_audit-round-order-01-m.png` | `apps/seller/src/components/PageHeader.tsx:53-57` | `aria-label="뒤로"` | 코드 + 실행(자동 탐지에서 이름 없음) |

### 확인했고 문제 없던 항목 (참고)

- 비로그인 → 보호 경로는 `/login`으로(운영 실행). 로그아웃 후 브라우저 뒤로가기도 `/login`에 머문다(로컬 실행).
- 회차 판매 가게의 설정 메뉴는 배송·거점 메뉴를 숨기고, 주문 화면의 일반/공동구매 탭도 숨긴다(`e1-settings-m.png`, `e1-orders-m.png`).
- 판매 시작(OPEN) 뒤 회차는 읽기 전용이고 "회차 내용은 판매 시작 전에만 고칠 수 있어요"를 보여 준다(`r3-round-after-schedule-m.png`).
- 반복 작업: 회차 카드마다 "이전 회차 복사"가 있고(`r3-round-list-d.png`), 회차 상세에 "결제 완료 N건 모두 준비 시작" 일괄 처리와 확인 모달이 있다(`o1-bulk-confirm-m.png`). 준비 화면에 회차 구매 목록이 있다(`e1-prep-m.png`).
- 이미지 형식 오류("사진을 읽을 수 없습니다. 다른 사진을 선택해주세요.")는 안내된다(`p1-image-invalid-m.png`).
- 주문 0건·상품 0건·회차 0건·정산 0원 빈 상태 문구와 다음 행동 링크가 있다(`e0-*`).
- 없는 주문은 "주문을 찾을 수 없습니다 / 돌아가기"(`e1-orders_nonexistent-id-m.png`).

## 3. 빠진 단계·기능

| 기능 | 왜 필요한가 |
|---|---|
| 새 주문 알림(판매자 알림톡·브라우저 알림·하단 탭 배지) | 회차 판매는 마감 전 짧은 시간에 주문이 몰리는데, 지금은 화면을 새로고침해야만 안다(S-04). |
| 손님 취소 알림과 "최근 취소" 표시 | 경매 구매 수량이 바뀌는 사건을 판매자가 놓친다(S-07). |
| 신규 셀러 시작 체크리스트 | 상품 → 회차 → 정산 계좌 → 판매 방식 순서를 모르는 첫 판매자가 막힌다(S-05, S-15). |
| 판매 방식 전환 관리자 UI | 지금은 가게 하나를 겨냥한 스크립트뿐이라 새 가게마다 개발자가 필요하다(S-05). |
| 주문 화면 회차 선택 필터 | 겹치는 회차의 주문을 나눠 보려면 지금은 회차 상세의 링크를 거쳐야 한다(S-12). |
| 주문 다건 선택 일괄 처리 | 일괄 준비 시작은 회차 상세에만 있고, 주문 화면에서는 한 건씩 눌러야 한다. |
| 회차 가격 일괄 조정·예상 경매가 입력 | 매 회차 경매 시세에 맞춰 상품 가격을 한 번에 올리고 내리는 수단이 없고, 마진을 볼 수 없다(S-17). |
| 출고 체크리스트·포장 라벨/구매 목록 인쇄·내보내기 | 포장·라벨 작업은 종이나 PC에서 하는데 인쇄·CSV는 정산에만 있다. |
| 기사 인계 확인(수거 완료 표시) | 준비 시작 후 기사가 실제로 가져갔는지 셀러 화면에서 확인하는 단계가 없다(상태 "배송 중"으로만 간접 확인). |
| 회차별 정산 요약 | 정산 화면은 일별·기간별·주문별뿐이라 "이번 회차 얼마 남았나"를 계산해야 한다. |
| 폼 이탈 경고·회차 임시저장 | 회차 폼은 이동·세션 만료 시 전부 사라진다(S-06). |
| 로그인 후 원래 화면 복귀 | 알림 링크가 끊긴다(S-13). |
| 데스크톱 레이아웃 | 셀러는 PC 작업 비중이 높은데 480px 한 열이다(S-11). |

## 4. 요약

- **P0 2개**(S-01 상품 등록 500, S-02 상품 수정 500), **P1 5개**(S-03~S-07). P2 10개, P3 8개.
- P0은 운영 최신 태그와 같은 코드를 로컬에서 실행해 재현했다. 운영에서는 저장을 하지 않았으므로 **운영 재현은 확인하지 않았다.** 운영에서 상품 등록이 되고 있다면 원인 판단을 다시 해야 한다.
- 운영 로그인 화면은 `auth/seller.json`이 없어 확인하지 못했다. 다음 감사에서 storageState를 주면 운영 읽기 전용 크롤로 같은 표를 다시 채울 수 있다.

**가장 먼저 고칠 5개**

1. **S-01·S-02** 상품 등록·수정 500 — Firestore 쓰기 전에 `undefined` 값을 제거하고, 제출까지 가는 API 테스트를 추가.
2. **S-03** 사진 없는 상품의 회차 저장 500 — `productImageUrlSnapshot ?? null` 저장 또는 대표 사진 필수화.
3. **S-04** 새 주문 알림 — 판매자 알림톡(미사용 `SELLER_ORDER_BATCH` 활용 검토)과 주문 화면 자동 갱신.
4. **S-05** 신규 가게 판매 방식 — 기본값 또는 관리자 전환 UI, `legacy` 회차의 "손님에게 안 보임" 경고.
5. **S-06** 회차 폼 입력 보존 — 임시저장 + 이탈 경고 + 세션 만료 뒤 복귀.
