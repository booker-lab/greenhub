<!-- Language: ko -->

# 그린허브 소비자 앱 UX 여정 감사 (분석 전용)

- 실행일: 2026-11-07 KST(2026-11-06 UTC)
- 코드 기준: `booker-lab/greenhub` 브랜치 `claude/exciting-edison-ji0tdt` HEAD `f08efb4`(작업 시작 시점, 코드 수정 없음)
- 뷰포트: 모바일 390×844(터치), 주요 화면은 1280×800에서 한 번 더 확인. 캡처는 2배율로 찍은 뒤 저장소 용량 때문에 1배율·256색으로 줄여 저장했다
- 스크린샷: `docs/ux-audit/consumer/screenshots/` (경로는 이 파일 기준 상대 경로)
  - `J<단계>-*`: 여정 단계, `X-*`: 추가 상황, `D-*`: 1280×800, `_explore/*`: 전체 라우트 일괄 점검(전체 페이지 캡처)

## 0. 실행 환경과 한계 (먼저 읽기)

운영 사이트(`greenlove.co.kr`)는 이 감사 세션(클라우드 컨테이너)에서 열리지만, 브라우저가 직접 호출하는 운영 API(`api-production-13e7.up.railway.app`)가 네트워크 정책에 막혀 있었습니다. 또 `auth/consumer.json`이 없고, 헤드리스 컨테이너에서는 카카오 로그인을 직접 할 수 없었습니다. 그래서 사용자 승인에 따라 **로컬 스택**에서 감사했습니다.

| 항목 | 이번 감사 | 운영과의 차이 |
|---|---|---|
| 앱 | consumer `next dev`(저장소 코드 그대로) | 운영 빌드가 아니다. 개발 표시("N")는 캡처에서 숨겼다 |
| 기능 토글 | 운영 HTML의 `greenhub-features` meta 값 22개를 그대로 지정(`guest-cart`·`payment-fail-stay`·`order-success-guide`·`wishlist`·`reviews` 등) | 같음 |
| API·DB | 로컬 API(`dev:local` 계약) + Firebase 에뮬레이터 | 운영 데이터가 아니다 |
| 데이터 | 회차 E2E fixture 생성기(`scripts/round-direct-e2e-fixtures.mjs`의 `buildFixtureManifest`)로 열린 회차·품절·숨김 상품·상태별 주문을 넣고, 상품에 `category: 'orchid'`, 소비자에 기본 배송지를 추가 | 상품명이 "E2E 호접란" 같은 테스트 이름, 사진은 자리표시 이미지 |
| 로그인 | 로그인 화면이 카카오 버튼에 넘기는 `callbackUrl`을 그대로 써서 이메일 로그인(E2E 헤더 게이트)으로 **완료 지점만** 대체 | 카카오 인증 화면 자체는 확인하지 못했다(`kauth.kakao.com` 요청 발생까지만 확인) |
| 결제 | E2E와 같은 방식으로 `window.PortOne`을 브라우저 stub으로 대체. 모바일은 "체크아웃 → 가짜 결제사 화면 → 취소 → `redirectUrl` 복귀" 순서로 같은 탭 이동을 재현했고, PC는 Promise로 취소 응답을 받는다 | 실제 PortOne 결제창·PG 화면은 열지 않았다. 실결제 없음 |
| 외부 스크립트 | 다음 우편번호·카카오 SDK 등 외부 호스트는 모두 차단 | 주소 검색 팝업 동작은 확인하지 못했다(저장된 배송지 자동 채움으로 진행) |

**확인 방식 표기**
- `실행`: 위 로컬 스택에서 직접 실행하고 스크린샷으로 확인했다.
- `실행(stub)`: 결제사 부분만 stub으로 대체했다. 실제 PG·기기에서는 재확인이 필요하다.
- `코드`: 화면을 실행하지 못해 코드로만 확인했다.

**로컬 환경 때문에 확인하지 못한 것**(결함으로 세지 않음)
- 배송 완료 주문 상세: 로컬 API가 배송 사진 서명 URL을 만들 GCP 자격 증명이 없어 500을 냈다(`screenshots/J09-order-detail-delivered.png`의 오류 화면은 환경 문제).
- 결제된 주문의 취소 성공: 로컬 정책(`DENY_ALL_EXTERNAL_PROVIDER_DISPATCH`)이 PortOne 환불을 막아 500. 실패 시 보이는 화면만 확인했다.
- 공동구매(11단계): 회차 판매(`round_direct`) 가게에서는 `/groupbuy`가 홈으로 돌아가고, 하단 탭에도 공동구매가 없다(실행 확인). 운영 판매 모드도 `round_direct`이므로 소비자가 들어갈 공동구매 흐름이 없다.

## 1. 라우트 표

표기: O 있음 / X 없음 / – 해당 없음. "헤더" 열의 값: 앱 헤더(로고·알림·장바구니), 상단 바(뒤로·로고·홈·장바구니), 제목만(페이지 제목 글자만), 없음. 근거: `screenshots/_explore/explore-{guest|user}-*.png`와 각 여정 캡처.

| 라우트 | 레이아웃 | 하단네비 | 헤더 | 뒤로가기(화면 안) | 새로고침·URL 직접 접근 | 비로그인 접근 결과 |
|---|---|---|---|---|---|---|
| `/` 홈 | 기본(430px 열) + 사업자 정보 푸터 | O | 앱 헤더 + 검색창 + 마감 카운트다운 | X(탭 화면) | 정상 | 정상 표시 |
| `/products/[id]` 상세 | 몰입(하단 고정 CTA) + 푸터 | X(의도) | 상단 바 | O. 단, 기록 없는 새 탭에서는 무반응(C-10) | 정상. `?round=` 자동 부착 | 정상 표시 |
| `/products/[id]`(숨김·없는 상품) | 404 | X | 없음 | X("홈으로 가기"만) | 정상 | "페이지를 찾을 수 없어요" |
| `/category` 상품 | 기본 | O | 제목만 | X(탭) | 정상 | 정상 |
| `/search` | 기본 | O | 검색 입력 | X | 정상. `?q=`는 무시됨(C-14) | 정상 |
| `/cart` | 기본 | O | 제목만("전체 삭제") | X(탭) | 정상(localStorage 유지) | 비회원 장바구니로 정상(`guest-cart`) |
| `/login` | 기본 | O | 없음(로고) | X("로그인 없이 더 둘러보기") | 정상 | 정상. 로그인 상태에서도 그대로 보임(C-27) |
| `/checkout` | 몰입 + 푸터 | X(의도) | 제목만 | X(브라우저 뒤로만) | 같은 탭 새로고침은 정상, 새 탭·URL 직접은 막다른 화면(C-04) | `/login?callbackUrl=/checkout…` |
| `/order/success` | 몰입 | X(의도) | 없음 | X("주문 내역 보기"/"홈으로") | 정상(서버 상태 재조회) | `/login?callbackUrl=/order/success` |
| `/mypage` | 기본 | O | 프로필 카드 | X(탭) | 정상 | `/login?callbackUrl=/mypage` |
| `/mypage/orders/[id]` | 기본 | O | 제목만 | O | 정상 | 로그인 후 복귀하도록 `callbackUrl` 포함 |
| `/mypage/addresses` | 기본 | O | 제목만 | X(C-24) | 정상 | 로그인 리다이렉트 |
| `/mypage/notifications` | 기본 | O | 제목만 | X(C-24) | 정상 | 로그인 리다이렉트 |
| `/mypage/notifications/settings` | 기본 | O | 제목만 | O("뒤로 가기") | 정상 | 로그인 리다이렉트 |
| `/mypage/wishlist` | 기본 | O | 제목만 | X(C-24) | 정상 | 로그인 리다이렉트 |
| `/mypage/purchase-history` | 기본 | O | 제목만 | X(C-24) | 정상 | 로그인 리다이렉트 |
| `/mypage/withdraw` | 기본 | O | 제목만 | O("뒤로 가기") | 정상 | 로그인 리다이렉트 |
| `/groupbuy` | – | – | – | – | 홈(`/`)으로 이동 | 홈으로 이동 |
| `/guarantee` 품질 보장 | 기본 | O | 상단 바 | O | 정상 | 정상 |
| `/store/[storeId]` 판매자 | 기본 | O | 상단 바 | O | 정상 | 정상 |
| `/terms`, `/privacy` | 문서 | O | 문서 제목 | X(C-24) | 정상 | 정상 |
| `/partner` | 404(기능 꺼짐) | O | 없음 | X | 404 | 404 |
| 없는 경로 | 404 | O | 없음 | X("홈으로 가기") | 404 | 404 |

## 2. 문제 표

심각도: P0 주문·결제 불가 / P1 이탈 유발 / P2 혼란 / P3 다듬기. 스크린샷 경로는 `screenshots/` 기준.

| ID | 여정 단계 | 라우트 | 문제 | 재현 경로 | 심각도 | 스크린샷 | 관련 파일:라인 | 수정 제안 | 확인 방식 |
|---|---|---|---|---|---|---|---|---|---|
| C-01 | 7 결제 진입 | `/checkout` | 모바일 결제는 같은 탭에서 결제사 화면으로 이동하는데, 결제 진행 중(`isLoading`)에 `beforeunload` 경고가 걸려 있어 이동할 때마다 "사이트에서 나가시겠습니까?" 확인창이 뜬다(2회 시도 모두 발생). 여기서 "머무르기"를 누르면 결제 버튼이 스피너("처리 중...")로 26초 넘게 고정되고, 새로고침 말고는 빠져나갈 수 없다 | 로그인 → 장바구니 → 결제 → 확인 체크 → "카카오페이로 결제하기" → 확인창에서 머무르기 | P1 | `J07-beforeunload-stay-stuck.png`, `J07-beforeunload-stay-after26s.png`, `J07-fake-pg.png`(머물지 않으면 결제사 화면으로 감). 확인창은 브라우저 기본 대화상자라 캡처되지 않아 Playwright `dialog` 이벤트(type=`beforeunload`)로 기록 | `apps/consumer/src/app/checkout/_components/CheckoutForm.tsx:232-240` | 리다이렉트 결제(모바일)에서는 `requestPayment` 호출 직전에 경고를 해제한다. `pagehide`·`pageshow`에서 결제 상태를 `idle`로 되돌린다 | 실행(stub). 실제 PG의 이동 방식과 기기별 확인창 표시(iOS Safari는 미표시, Android·인앱 브라우저는 표시 가능)는 실기기 확인 필요 |
| C-02 | 7 결제 취소 후 재시도 | `/checkout` | 결제창을 취소하거나 결제사 화면에서 뒤로 나올 때마다 15분짜리 결제 예약이 하나씩 남는다. 같은 회차에서 3개가 차면 네 번째 결제가 "이전 결제 시도를 아직 처리하고 있어요. 잠시 후 다시 시도하거나…"로 막힌다. 얼마나 기다려야 하는지 알 수 없다. 결제 수단을 바꿔 보려는 사용자가 세 번 만에 막힌다 | 결제 → 결제사 화면에서 뒤로 → 다시 결제 → 취소 → 다시 결제하기 → 결제(4번째) | P1 | `X-checkout-hold-limit-blocked.png`, `J07-mypage-after-cancel.png`(남은 시도 3건) | `apps/api/src/orders/order-capacity.service.ts:35-45`(한도 3), `:310`(15분) | 같은 고객·같은 품목의 새 시도가 오면 이전 미결제 예약을 반환하거나 넘겨받는다. 취소 복귀 화면에서 예약을 정리한다. 막을 때는 남은 시간과 "주문 내역에서 확인" 링크를 보인다 | 실행 |
| C-03 | 6 주문 정보 입력 | `/checkout` | 회차 결제는 "상품·가격·회차 변경 내용을 확인했습니다" 체크가 늘 필수다. 그런데 안내 문구는 "상품 정보가 **변경되면** … 다시 확인해야 합니다"라는 조건문이라, 변경이 없으면 건너뛰어도 되는 것처럼 읽힌다. 체크하지 않으면 결제 버튼이 회색으로만 바뀌고 이유가 어디에도 나오지 않는다 | 로그인 → 장바구니 → 결제 → 배송지·연락처가 채워져 있어도 버튼 비활성 | P1 | `J06-checkout-scroll2.png`, `J06-checkout-scroll3.png` | `apps/consumer/src/app/checkout/_components/CheckoutForm.tsx:225-226`, `:571-580` | 문구를 "아래 상품·수량·가격을 확인했어요(필수)"로 바꾼다. 비활성일 때 버튼 위에 빠진 항목(확인 체크, 연락처 형식, 이천 주소)을 적는다 | 실행 |
| C-04 | 6 / 새로고침·직접 접근 | `/checkout` | 결제할 상품은 탭 단위 `sessionStorage`에만 있어서, 새 탭·URL 직접 열기·저장소가 비워진 인앱 브라우저에서는 빨간 문구 "결제할 장바구니 정보를 확인할 수 없습니다." 한 줄과 푸터만 보인다. 하단 네비도 없고 장바구니·홈으로 갈 버튼이 없다 | 로그인 후 `/checkout?from=cart`를 새 탭에서 연다 | P1 | `D-checkout.png` | `apps/consumer/src/app/checkout/page.tsx:655` | 이 상태에서는 "장바구니로 가기" 버튼을 두거나 `/cart`로 바로 보낸다. 회차 장바구니(localStorage)로 다시 구성할 수 있으면 다시 만든다 | 실행 |
| C-05 | 7 결제 취소 후 복귀 | `/checkout` | 결제사 화면에서 브라우저 뒤로가기로 돌아오거나 "다시 결제하기"로 돌아오면 체크아웃이 새로 그려진다. 고쳐 쓴 연락처는 저장된 값으로, 요청사항은 빈칸으로, 확인 체크는 해제된 상태로 돌아간다. PC(Promise) 취소에서는 유지된다 | 연락처를 010-2222-3333으로, 요청사항을 입력 → 결제 → 결제사 화면에서 뒤로 | P2 | `X-back-from-pg.png`, `X-back-from-pg-bottom.png`, `J07-retry-checkout.png`, (비교) `J07-pc-cancel-result.png` | `apps/consumer/src/app/checkout/page.tsx:467-468`(상태가 메모리에만 있음) | 결제 직전 입력값을 `sessionStorage`에 저장하고 복귀할 때 복원한다(결제 시도 기록 `PendingOrderPayment`와 함께) | 실행(stub) |
| C-06 | 7·9 | `/mypage`, `/mypage/orders/[id]` | 취소한 결제 시도가 주문 내역 맨 위에 "결제 확인 중" 주문으로 하나씩 쌓인다(3건). 상세에는 배송 현황 단계와 "주문 취소" 버튼이 있어 실제 주문처럼 보인다 | C-02 재현 뒤 MY | P2 | `J07-mypage-after-cancel.png`, `J09-order-detail-pending-payment.png` | `apps/consumer/src/app/mypage/_client.tsx:16`, `apps/consumer/src/app/mypage/orders/[id]/_client.tsx:55` | 결제 전 주문은 목록에서 빼거나 "결제 미완료(15분 뒤 자동 취소)"로 따로 묶고, "이어서 결제"·"취소" 버튼을 둔다 | 실행 |
| C-07 | 7 결제 취소 | `/order/success`(실패 복귀), `/checkout`(PC) | 결제 실패 문구에 PG 원문 코드가 그대로 나온다: "[PAY_PROCESS_CANCELED] 사용자가 결제를 취소하였습니다" | 결제 → 결제사 화면에서 취소 | P2 | `J07-cancel-return.png`, `J07-pc-cancel-result-bottom.png` | `apps/consumer/src/app/order/success/page.tsx:588`, `apps/consumer/src/hooks/usePayment.ts:319` | 코드별 한국어 문구로 바꾼다(취소는 "결제를 취소했어요. 장바구니는 그대로예요"). 원문은 화면에 쓰지 않는다(`payment-redirect.ts` 주석의 pgMessage 규칙과 같게) | 실행(stub) |
| C-08 | 9 주문 내역·상세 | `/mypage` → `/mypage/orders/[id]` | 같은 주문(ACCEPTED)이 목록에서는 "결제 완료", 상세 머리에서는 "주문 접수"로 다르게 표시된다 | MY → "결제 완료" 카드 | P2 | `J12-mypage-top.png`(목록), `J09-order-detail-accepted.png`(상세) | `apps/consumer/src/app/mypage/_client.tsx:19`, `apps/consumer/src/app/mypage/orders/[id]/_client.tsx:58` | 상태 이름 표를 하나로 합친다(알림 화면 `ORDER_ACCEPTED: '결제 완료'`와도 맞춘다) | 실행 |
| C-09 | 추가: 세션 만료 | 전 화면 | 서버에서 세션이 끝나면 `signOut({ callbackUrl: '/login' })`로 보낸다. 로그인 화면에 이유 안내가 없고, 다시 로그인하면 보던 화면(장바구니 등)이 아니라 홈으로 간다 | 로그인 → 장바구니 → (서버에서 세션 폐기) → 새로고침 | P2 | `X-session-expired-cart.png`, `X-session-expired-after-pay.png` | `apps/consumer/src/app/providers.tsx:12`, `:35` | `callbackUrl`에 현재 경로를 싣고, 로그인 화면에 "로그인이 만료됐어요. 다시 로그인하면 보던 화면으로 돌아가요"를 보인다 | 실행 |
| C-10 | 1 공유 링크 진입 | `/products/[id]` | 공유 링크를 새 탭으로 열면(기록 1개) 상단 "뒤로" 버튼을 눌러도 아무 일도 일어나지 않는다(`router.back()`만 호출) | 다른 페이지에서 `window.open(상세 URL)` → "뒤로" | P2 | `J01-shared-link-back-noop.png` | `apps/consumer/src/components/ProductTopBar.tsx:41` | `history.length <= 1`이거나 같은 출처 referrer가 없으면 홈(또는 상품 탭)으로 보낸다 | 실행 |
| C-11 | 추가: 네트워크 오류 | `/`, `/category`, 모든 탭 | API 조회가 실패하면 (1) 하단 네비가 통째로 사라지고 (2) 영어 원문 "Failed to fetch"가 그대로 보이며 (3) 판매 방식을 모르는 상태라 예전(legacy) 화면이 나온다. 홈 제목이 "전체 상품"이 되고, 상품 탭에 공동구매·절화·관엽 탭과 색상 칩이 나온다 | API 연결을 끊고 홈·상품·MY 열기 | P2 | `X-api-down-guest-home.png`, `X-api-down-guest-category.png`, `X-api-down-user-mypage.png`(네비 없음) | `apps/consumer/src/components/BottomNav.tsx:111`, `:80`, `apps/consumer/src/hooks/useProducts.ts:88`, `apps/consumer/src/app/category/page.tsx:182` | 오류일 때도 마지막 탭 구성을 유지해 네비를 보인다. 오류 문구는 한국어 고정 문구("연결이 불안정해요. 다시 시도해 주세요")로 바꾼다. 판매 방식을 모르면 legacy 화면 대신 오류 상태를 보인다. 참고: 주문 내역·상세의 오류 상태는 한국어 문구와 다시 시도가 있어 양호하다(`X-api-down-user-order-detail.png`) | 실행 |
| C-12 | 추가: 마감된 회차 | `/cart`(비로그인) | 주문 마감이 지나도 비회원 장바구니는 "11월 7일(토) 오전 12시 9분까지 결제해야 이번 회차로 배송돼요"(지난 시각), 총 결제 금액 12,000원, "로그인하고 주문하기"를 그대로 보인다. 로그인한 뒤에야 "판매가 마감되었습니다"가 나온다 | 상품을 담음 → 회차 마감 → 비로그인으로 장바구니 | P2 | `X-closed-cart-guest.png`, (로그인 후) `X-closed-cart-user.png` | `apps/consumer/src/app/cart/page.tsx:489`, `:500` | 비로그인 상태에서도 공개 회차 정보로 마감을 판정해 "이번 회차는 마감됐어요"와 다음 행동(다음 회차 알림)을 보이고, 로그인 유도 버튼을 막는다 | 실행 |
| C-13 | 추가: 마감된 회차 | `/checkout`, `/cart`(로그인) | 체크아웃에 머무는 동안 마감되면 결제할 때 "현재 주문 가능한 회차가 아닙니다."만 나오고 버튼은 그대로다. 로그인 장바구니는 "0개 상품 한 번에 결제"(비활성)만 남고, 노란 안내는 지난 시각을 "까지 결제해야"로 계속 보인다. 다음 회차 안내·알림 신청이 없다 | 체크아웃 화면 진입 → 회차 마감 → 결제 | P2 | `X-closed-checkout-pay.png`, `X-closed-cart-user-bottom.png` | `apps/api/src/sale-rounds/sale-round-state.contract.ts:60`, `apps/consumer/src/app/cart/page.tsx:489` | 마감 응답을 받으면 마감 안내 화면(다음 회차 소식 받기, 장바구니 비우기)으로 바꾼다. 마감 뒤에는 노란 안내 문구를 "마감됐어요"로 바꾼다 | 실행 |
| C-14 | 2 검색 | `/search` | 검색어가 URL에 남지 않아, 결과에서 상세로 갔다가 뒤로 오면 입력과 결과가 비어 있다. `/search?q=호접란` 같은 링크도 무시된다 | 홈 검색창 → "미니" 입력 → 결과 탭 → 뒤로 | P2 | `J02-search-result.png`, `J02-search-after-back.png`, `J02-search-hojeop.png`(`?q=` 무시) | `apps/consumer/src/app/search/page.tsx:33` | 검색어를 `?q=`로 `router.replace`하고 첫 렌더에서 읽는다 | 실행 |
| C-15 | 4 수량 변경 | `/cart` | 수량 1에서 "−"를 누르면 확인이나 되돌리기 없이 상품이 바로 장바구니에서 빠진다. "삭제"도 즉시 빠진다 | 장바구니 → 수량 1인 상품의 "−" | P2 | `J04-cart-guest.png`(전), `J04-cart-dec-at-1.png`(후: "E2E 호접란"이 사라짐) | `apps/consumer/src/hooks/useCart.ts:306`, `apps/consumer/src/app/cart/page.tsx:682` | 수량 1에서는 "−"를 비활성화하고 삭제는 "삭제" 버튼으로만 하거나, 빠진 뒤 "되돌리기" 토스트를 보인다 | 실행 |
| C-16 | 10 주문 취소 | `/mypage/orders/[id]` | 취소 안내·확인창 문구가 내부 동작을 설명한다: "서버가 회차 마감 여부를 다시 확인하고 환불과 주문 한도 반환을 처리합니다", 확인창 "서버에서 회차 마감 전인지 다시 확인합니다". 실패하면 "취소 요청 결과를 확정할 수 없습니다… 중복 요청 전에 다시 시도로 현재 상태를 확인해 주세요"가 나와 무엇을 해야 할지 알기 어렵다. 환불 금액·기간 안내도 없다 | 결제 완료 주문 → "주문 취소" → 확인 | P2 | `J09-order-detail-accepted.png`, `J10-cancel-result.png`(실패 문구), `J10-pending-cancel-result.png`(성공: "사유: 고객 요청"만) | `apps/consumer/src/app/mypage/orders/[id]/_client.tsx:327`, `:349`, `:1108`, `:1168` | "주문 마감(○월 ○일 ○시) 전까지 취소할 수 있어요. 결제 수단으로 ○영업일 안에 환불돼요"처럼 고객 기준으로 쓰고, 실패하면 "상태 새로고침"과 고객센터 연결을 둔다 | 실행(실패 문구는 로컬 환불 차단으로 발생. 운영에서는 환불 실패·시간 초과 때 같은 문구가 나온다) |
| C-17 | 8·9·10·12 | `/order/success`, `/mypage`, `/mypage/orders/[id]` | 주문 완료 화면은 "문제가 있으면 사진과 함께 고객센터로 알려 주세요"라고만 하고 연락 수단이 없다. MY와 주문 상세에도 고객센터·문의 링크가 없다. 고객센터 번호는 홈·상세·결제 화면 푸터에만 있다 | 주문 완료 → MY → 주문 상세 | P2 | `J08-success-after-paid.png`, `J12-mypage-bottom.png`, `J09-order-detail-held.png` | `apps/consumer/src/app/order/success/page.tsx`(받은 뒤 안내), `apps/consumer/src/app/mypage/_client.tsx`(내 정보 메뉴) | 주문 상세·완료 화면에 "문의하기"(전화·카카오 채널, 주문번호 자동 첨부)를 두고, MY 메뉴에 고객센터를 추가한다 | 실행 |
| C-18 | 1·3 | `/`, `/products/[id]`, `/cart` | 자정 직후 시각을 "오전 12시 44분"으로 표기한다(00:44). 코드 주석의 예시는 "밤 12시"인데 실제 출력과 다르다 | 마감이 0시대인 회차의 홈·상세 | P3 | `J01-home-top.png`, `J01-detail-direct-top.png` | `apps/consumer/src/lib/round-schedule-label.ts:32`, `:41-44` | 0시대는 "밤 12시 44분"(또는 "자정") 규칙을 정해 한 곳에서 처리한다 | 실행 |
| C-19 | 4·12 | `/cart`, `/mypage/notifications/settings` | 내부 용어가 그대로 보인다: "같은 회차 상품을 서버에서 확인해 한 번에 결제합니다", "서버 확인 완료 · 같은 회차 상품", "파일럿에서는 마케팅 수신 동의와 설정을 운영하지 않습니다" | 장바구니(로그인 전·후), 알림 설정 | P3 | `J04-cart-guest.png`, `J05-after-login-cart.png`, `J12-mypage-notifications-settings.png` | `apps/consumer/src/app/cart/page.tsx:466`, `:333`, `apps/consumer/src/app/mypage/notifications/settings/page.tsx:208` | "이번 회차 상품을 한 번에 결제해요", "구매 가능"처럼 고객 기준 문구로 바꾼다 | 실행 |
| C-20 | 12 마이페이지 | `/mypage` | 설치 프롬프트가 없는 브라우저(헤드리스·iOS Safari·인앱 브라우저)에서는 "앱 설치" 제목만 있고 내용이 비어 있다 | MY 맨 아래 | P3 | `J12-mypage-bottom.png` | `apps/consumer/src/app/mypage/_client.tsx:441-444`, `apps/consumer/src/components/A2HSButton.tsx:23` | 버튼이 없으면 제목도 숨기거나, iOS용 "홈 화면에 추가" 안내를 보인다 | 실행 |
| C-21 | 추가: 주문 0건 | `/mypage` | "주문 내역이 없습니다." 한 줄만 있고 상품 보러 가기 등 다음 행동이 없다("구매한 꽃" 빈 상태에는 "이번 회차 보러 가기"가 있음) | 주문 없는 계정으로 MY | P3 | `X-orders-empty.png` | `apps/consumer/src/app/mypage/_client.tsx:333` | "이번 회차 보러 가기" 버튼을 추가한다 | 실행 |
| C-22 | 9 주문 상세 | `/mypage/orders/[id]` | 배송 예정일이 "2026-11-10"(ISO)로 나온다. 다른 화면은 "11월 10일(화)" 형식이다 | 회차 주문 상세 | P3 | `J09-order-detail-pending-payment.png` | `apps/consumer/src/app/mypage/orders/[id]/_client.tsx:984` | 공통 날짜 포맷(요일 포함)을 쓰고 도착 시각("오전 9시까지")도 함께 보인다 | 실행 |
| C-23 | 추가: 네트워크 오류 | 탭 이동 | 오프라인에서 하단 탭(상품)을 누르면 아무 반응이 없다. 오프라인 안내가 없다 | 홈 → 오프라인 → "상품" 탭 | P3 | `X-offline-tab-nav.png` | (전역 처리 없음) | `online`/`offline` 이벤트로 상단에 "인터넷 연결을 확인해 주세요" 띠를 보인다 | 실행 |
| C-24 | 12 / 공통 | `/mypage/addresses`, `/mypage/notifications`, `/mypage/wishlist`, `/mypage/purchase-history`, `/terms`, `/privacy` | MY 하위 화면과 약관 화면에 화면 안 뒤로가기가 없다(같은 MY 하위인 알림 설정·탈퇴·주문 상세에는 있음). 하단 네비는 있어 막히지는 않는다 | MY → 배송지 목록 | P3 | `J12-mypage-addresses.png`, `J12-mypage-notifications.png`, `_explore/explore-guest-terms.png` | 각 페이지 컴포넌트(공통 헤더 없음) | MY 하위 화면에 같은 "뒤로 가기" 헤더를 쓴다 | 실행 |
| C-25 | 공통 푸터 | `/`, `/products/[id]`, `/checkout` | 푸터에 사업자 정보·통신판매업 신고번호·이용약관·개인정보처리방침·KB에스크로 표시는 있지만, 교환·환불 정책 링크는 따로 없다(환불은 이용약관 본문 안에 있음). 장바구니·MY·주문 완료에는 푸터가 없다 | 홈 맨 아래 | P3 | `J01-home-scroll4.png`, `J06-checkout-scroll3.png` | `apps/consumer/src/components/BusinessInfoFooter.tsx:118-126` | 푸터에 "교환·환불 안내" 링크(약관 해당 조 바로가기 또는 별도 페이지)를 추가한다. 법적 필요 범위는 담당자 판단이 필요하다 | 실행 |
| C-26 | 추가: 마감된 회차 | `/`, `/products/[id]` | 마감 뒤 홈은 "E2E round open · 주문 마감" 라벨과 함께 "주문 마감 11월 7일(토) 오전 12시 9분**까지**"를 그대로 보인다. 다음 회차 일정·알림 신청이 홈에 없다(상세에는 "다음 회차에 다시 보고 싶어요"가 있음) | 회차 마감 → 홈 | P3 | `X-closed-home.png`, `X-closed-detail.png` | `apps/consumer/src/lib/round-schedule-label.ts`(마감 문구) | 마감 뒤에는 "주문 마감됨 · 다음 회차는 ○월 ○일 오픈"과 카카오 채널 알림 버튼을 홈 상단에 보인다 | 실행 |
| C-27 | 5 로그인 | `/login` | 로그인한 상태로 `/login`에 오면 카카오 로그인 화면이 그대로 보인다 | 로그인 후 `/login` 직접 열기 | P3 | `_explore/explore-user-login.png` | `apps/consumer/src/app/login/page.tsx` | 세션이 있으면 `callbackUrl`(없으면 홈)로 보낸다 | 실행 |
| C-28 | 9 배송 보류 | `/mypage/orders/[id]` | 배송 보류 안내가 "출입 정보 확인 필요 / 고객 책임: 해당 / 재배송비: 3,000원"뿐이다. 왜 고객 책임인지, 결제하지 않으면 어떻게 되는지, 다음 배송이 언제인지, 출입 정보를 어디서 고치는지가 없다 | 배송 보류 주문 상세 | P3 | `J09-order-detail-held.png` | `apps/consumer/src/app/mypage/orders/[id]/_client.tsx:995` | "출입 정보가 없어 배송하지 못했어요. 재배송비 3,000원을 결제하면 ○일에 다시 배송해요" + 출입 정보 입력 + 문의 버튼 | 실행 |

### 잘 동작한 것 (참고)
- 비로그인 구매 시도 → 로그인 → 복귀: 장바구니의 "로그인하고 주문하기"는 `/cart`로, 상세의 "바로 구매"는 `/checkout?from=cart`로 돌아오고 담은 상품이 유지된다. 로그인 화면이 "장바구니는 그대로 남아 있어요"라고 안내한다(`J05-login-from-cart.png`, `J05-after-login-cart.png`, `J05-buynow-after-login-checkout.png`).
- 상세의 회차 가격·주문 마감·새벽 경매·문 앞 도착 시각이 한 블록에 정리되어 있고 청약철회 제한도 미리 보인다(`J01-detail-direct-top.png`, `J03-detail-scroll2.png`).
- 품절 상품은 "품절"(비활성)과 "다음 회차에 다시 보고 싶어요"를 보인다(`X-soldout-detail.png`). 숨김 상품은 404로 처리된다(`X-product-404.png`).
- 결제 취소 뒤 장바구니가 유지되고(`J07-cart-after-cancel.png`), 완료 화면은 서버 확인 대기 → 완료로 전환되며 도착 시각과 받은 뒤 관리 안내를 보인다(`J08-success-pending.png`, `J08-success-after-paid.png`. 완료 전환은 주문 문서를 결제 완료로 바꾸어 웹훅을 모사).

## 3. 빠진 단계·기능 목록

화면이 있는데 결함인 것이 아니라 여정에 아예 없는 것입니다.

| 빠진 것 | 왜 필요한가 |
|---|---|
| 배송 회차 선택 | 장바구니 상품의 회차로 배송일이 고정되고 다음 회차를 고르는 단계가 없다. 이번 회차를 놓친 고객이 다음 회차로 미리 주문할 수 없다. |
| 거점 픽업 선택 | 결제 화면에 배송 방식 선택이 없고 이천 직배송만 가능하다(요청한 "직배송/거점픽업 선택" 단계가 없음). 의도된 범위인지 제품 결정이 필요하다. |
| 주소 직접 입력 대체 수단 | 주소 칸이 읽기 전용이라 "주소 검색"(외부 우편번호 스크립트)이 실패하면 저장된 배송지가 없는 고객은 주소를 넣을 방법이 없다(`CheckoutForm.tsx:443`). |
| 주문 후 배송지·연락처 변경 | 주문 상세에 수정 기능이 없다. 마감 전 오타나 받는 곳 변경을 스스로 고칠 수 없다. |
| 결제 미완료 주문 이어서 결제 | "결제 확인 중" 주문 상세에 "이어서 결제"가 없다. 취소 후에는 장바구니에서 새로 결제해야 하고 예약 한도(C-02)에 걸린다. |
| 재주문(다시 주문하기) | 코드에는 `reorder` 기능이 있지만 운영 토글에서 꺼져 있다. 매주 사는 회차 판매에서 재구매 경로가 짧아진다. |
| 배송 후 교환·환불(하자) 접수 | 배송 완료 뒤 사진 첨부 하자 접수나 환불 요청 화면이 없고, 완료 화면은 "고객센터로 알려 주세요"라고만 한다. |
| 고객센터·1:1 문의(MY·주문 상세) | 주문에 묶인 문의 경로가 없어 주문번호를 손으로 옮겨야 한다. |
| 배송 진행 실시간 안내(앱 안) | 상세의 배송 현황은 4단계 표시만 있다. 출발·도착 예정 시각과 기사 연락 같은 당일 정보가 앱 안에 없다(알림 내역은 비어 있음). |
| 다음 회차 오픈 알림(홈) | 마감 뒤 홈에 다음 회차 일정이나 알림 신청이 없다. 상세의 "다음 회차에 다시 보고 싶어요"는 신청 수만 모으고 발송하지 않는다(`restock-alert` 설명). |
| 결제 영수증·증빙 | 주문 상세에 카드 전표나 현금영수증 등 증빙 조회가 없다. |
| 공동구매 참여 | 회차 판매 모드에서는 소비자 공동구매 진입점이 없다(`/groupbuy`가 홈으로 이동). 운영에서 공동구매를 다시 쓸 계획이면 진입 경로가 필요하다. |

## 4. 요약

- P0: **0건**. 로컬 재현 범위에서 주문·결제가 아예 불가능한 경로는 없었다.
- P1: **4건**. C-01 모바일 결제 이동 시 이탈 확인창과 버튼 고착, C-02 결제 재시도 3회 차단, C-03 결제 버튼 비활성 이유 미표시, C-04 체크아웃 직접 접근 시 막다른 화면.
- P2: 13건, P3: 11건.

가장 먼저 고칠 5개:
1. **C-01**: 실기기(Android 카카오톡 인앱, Android Chrome)에서 실제 PortOne 결제창 이동 때 확인창이 뜨는지부터 확인한다. 뜬다면 결제 이탈에 가장 직접적인 원인이다.
2. **C-02**: 취소나 뒤로가기 세 번이면 15분 동안 결제가 막힌다. 결제 수단을 바꿔 보는 정상 행동이 차단된다.
3. **C-03**: 결제 직전 확인 체크를 필수로 분명히 표시하고, 비활성 이유를 버튼 근처에 보인다.
4. **C-04**: 체크아웃의 막다른 화면에 장바구니로 돌아가는 버튼을 둔다.
5. **C-05 + C-07**: 결제 취소 뒤 입력값을 보존하고 PG 원문 코드를 고객 문구로 바꾼다. 취소 후 재시도 경험을 함께 정리한다.
