# Consumer E2E 실 검증 리스트

> 기준: `https://greenlove.co.kr` | 최종 업데이트: 2026-05-03
> 현재 e2e 스위트가 커버하지 못하는 **실제 사용자 플로우** 중심

---

## 커버리지 현황

| 파일 | 커버 영역 | 상태 |
|------|-----------|------|
| `consumer-home.spec.ts` | 홈 렌더링·BottomNav·공동구매 섹션 | ✅ 완료 |
| `consumer-groupbuy.spec.ts` | 공동구매 목록·카드 클릭 이동 | ✅ 완료 |
| `consumer-design-system.spec.ts` | DS 토큰 T0~T9 전체 | ✅ 완료 |
| `perf-css-regression.spec.ts` | CSS 성능 회귀 | ✅ 완료 |
| `consumer-auth.spec.ts` | 로그인 UI·유효성·오픈리디렉트 방어·보호경로 리디렉트 | ✅ 완료 |
| `consumer-product-detail.spec.ts` | 상품 상세·뒤로가기·가격·담기 버튼·404 | ✅ 완료 |
| `consumer-cart.spec.ts` | /cart 인증 보호 리디렉트 (인증 후 CRUD는 주석 블록) | ✅ 완료 |
| `consumer-checkout.spec.ts` | /checkout·/order/* 인증 보호 리디렉트 | ✅ 완료 |
| `consumer-search.spec.ts` | 검색창 포커스·빈 상태·검색어 입력·X 초기화 | ✅ 완료 |
| `consumer-mypage.spec.ts` | /mypage/* 인증 보호 리디렉트·BottomNav MY | ✅ 완료 |

> **결과: 60 passed, 2 skipped** (2026-05-03 기준, chromium+mobile)
> skipped: 검색 결과 없을 때 `검색 결과 카드 클릭` 조건부 skip — 정상 동작

### 인증 후 테스트 활성화 방법
각 spec 파일 하단 주석 블록 해제 + `storageState` 설정:
```bash
# global-setup.ts 실행으로 .auth/user.json 생성 후
PLAYWRIGHT_TEST_EMAIL=test@example.com PLAYWRIGHT_TEST_PASSWORD=pw pnpm --filter e2e test
```

---

## 신규 추가 필요 테스트 (우선순위 순)

### P0 — 핵심 전환 경로 (구매 퍼널)

#### `consumer-auth.spec.ts`
- [ ] `/login` — 페이지 렌더링 정상 (이메일·소셜 로그인 버튼 노출)
- [ ] 잘못된 이메일 형식 입력 시 유효성 에러 표시
- [ ] 비로그인 상태에서 `/cart` 접근 → `/login` 리디렉트

#### `consumer-product-detail.spec.ts`
- [ ] 홈의 첫 번째 상품 링크 클릭 → `/products/[id]` 이동
- [ ] 상품명·가격·이미지 노출 확인
- [ ] "공동구매 참여" 버튼 또는 "장바구니 담기" 버튼 가시성
- [ ] 재고 없음 상태 시 버튼 비활성화 표시

#### `consumer-cart.spec.ts`
- [ ] `/cart` — 장바구니 비어있을 때 빈 상태 UI 노출
- [ ] 상품 상세에서 담기 → 장바구니 수량 배지 업데이트
- [ ] 장바구니 내 수량 증가·감소 동작
- [ ] 개별 상품 삭제 후 목록 갱신 확인
- [ ] "전체 선택" 체크박스 토글

#### `consumer-checkout.spec.ts`
- [ ] `/checkout` — 배송지 목록 노출 또는 배송지 없음 안내
- [ ] 결제 버튼 클릭 시 PortOne 결제창 호출 (팝업 차단 예외 허용)
- [ ] `/order/success` — 주문 완료 메시지·주문번호 노출

---

### P1 — 탐색·검색 플로우

#### `consumer-search.spec.ts`
- [ ] `/search` — 검색창 포커스 시 커서 진입
- [ ] 검색어 입력 후 Enter → 결과 목록 또는 "결과 없음" UI 노출
- [ ] 검색 결과 카드 클릭 → 상품 상세 이동

#### `consumer-category.spec.ts` (기존 DS 스펙과 분리)
- [ ] 탭 버튼 클릭 → URL 파라미터 또는 필터 상태 변경
- [ ] 카테고리 변경 시 상품 목록 재렌더링 (스피너 → 목록)
- [ ] 상품 없는 카테고리 → "상품 없음" UI

---

### P2 — 마이페이지 CRUD

#### `consumer-mypage.spec.ts`
- [ ] 비로그인 → `/mypage` 접근 시 로그인 페이지 이동
- [ ] 로그인 후 프로필(닉네임·이메일) 표시 확인
- [ ] `/mypage/orders` — 주문 목록 렌더링 (또는 빈 상태)
- [ ] `/mypage/orders/[id]` — 주문 상세: 상품명·수량·금액 표시
- [ ] `/mypage/addresses` — 배송지 추가 폼 노출
- [ ] 배송지 저장 → 목록에 항목 추가 확인
- [ ] 배송지 삭제 → 목록에서 제거 확인
- [ ] `/mypage/notifications` — 알림 목록 렌더링 (또는 빈 상태)
- [ ] 읽지 않은 알림 뱃지 카운트 표시

---

### P3 — 엣지케이스·회귀

#### `consumer-regression.spec.ts`
- [ ] `/products/존재하지않는ID` → 404 또는 에러 UI (크래시 없음)
- [ ] `/checkout` 직접 접근 (장바구니 비어있을 때) → 안내 UI
- [ ] 네트워크 응답 지연 시 스켈레톤·스피너 표시 (slow3G 프로파일)
- [ ] 뒤로가기(back navigation) 후 스크롤 위치 유지 확인

---

## 인증이 필요한 테스트 처리 방안

> Firebase Auth를 사용하므로 실제 계정 기반 테스트가 필요합니다.

```ts
// playwright.config.ts에 추가할 storageState 설정
use: {
  storageState: 'e2e/.auth/user.json', // 사전 로그인된 세션
}

// global-setup.ts — Firebase 커스텀 토큰으로 로컬 로그인
// apps/e2e/global-setup.ts
```

**권장 접근법:**
1. `PLAYWRIGHT_TEST_EMAIL` / `PLAYWRIGHT_TEST_PASSWORD` 환경 변수로 테스트 계정 관리
2. `globalSetup`에서 1회 로그인 후 `storageState` 저장
3. 인증 필요 테스트는 `test.use({ storageState })` 적용

---

## 실행 명령

```bash
# 전체 실행
pnpm --filter e2e exec playwright test --reporter=list

# 파일 단위
pnpm --filter e2e exec playwright test consumer-cart --reporter=list

# UI 모드 (디버깅)
pnpm --filter e2e exec playwright test --ui
```
