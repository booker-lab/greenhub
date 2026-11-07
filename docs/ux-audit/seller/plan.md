<!-- Language: ko -->

# 셀러 UX 감사 후속 실행 계획

> 근거: [findings.md](findings.md) (2026-11-06 감사). 기준선: `origin/main` `28654c8`(#818까지)로 다시 대조했다.
> 실행 단위: 한 frontier = 한 의미 단위 결과, 한 배치 최대 5개, 수정 파일·검증 소유가 겹치지 않는 것만 같은 배치에 넣는다(AGENTS.md §0-7).
> 검증: 로컬 우선(단위 테스트·타입 검사·lint). 원격 Preview·E2E는 이번 작업에서 쓰지 않는다(AGENTS.md §0-9).

## 1. 재대조 결과

| ID | 판정 | 근거 |
|---|---|---|
| S-01, S-02 | `IMPLEMENTATION_GAP` 유지 | #818이 `CreateProductDto`에 선택 필드 `marketRef`를 더했고, `products.service.ts`의 DTO 스프레드는 그대로다 |
| S-17 | 일부 `STALE_SPEC` | #818이 회차 가격 옆에 경매 시세 기반 예상 매입가를 보여 준다. 남은 것: 작성 중 화면의 "가격 고정 시점" 안내 |
| 그 밖 | `IMPLEMENTATION_GAP` 유지 | 관련 파일의 #813~#825 변경은 글자색 대비 조정뿐이다 |

## 2. 배치

### 1차 배치 (P0·P1 중심)

| Frontier | 항목 | 수정 범위 | 검증 |
|---|---|---|---|
| F1 상품 쓰기 undefined 제거 | S-01, S-02 | `apps/api/src/products/**` | API jest(상품) + 타입 |
| F2 회차 상품 사진 스냅샷 | S-03 | `apps/api/src/sale-rounds/**` | API jest(회차) + 타입 |
| F3 회차 폼 입력 보존 | S-06 | `apps/seller/src/app/sale-rounds/**` | seller vitest + 타입 + biome |
| F4 주문 화면 신선도·회차 필터 | S-04(화면 쪽), S-12 | `apps/seller/src/hooks/useOrders*`, `apps/seller/src/app/orders/page.tsx`·`_components` | seller vitest + 타입 + biome |
| F5 로그인 진입·온보딩 | S-13, S-09, S-10 | `apps/seller/src/proxy.ts`, `app/login/**`, `lib/admin-landing.ts`, `app/onboarding/**` | seller vitest(proxy 포함) + 타입 + biome |

### 2차 배치 (P2·P3)

| Frontier | 항목 | 수정 범위 |
|---|---|---|
| F6 상품 폼 오류·자동 저장, 오류 화면 | S-08, S-21, S-24 | `products/_components/useProductForm.ts`, `lib/api.ts`(오류 문구), `app/error.tsx` |
| F7 하위 화면 뒤로가기·탭 | S-14, S-19, S-25 | `components/PageHeader.tsx`, `components/BottomNav.tsx`, 정산·정산 계좌·운영 확인·거점 화면 |
| F8 회차 화면 안내 | S-05(셀러 화면 경고), S-17(남은 부분), S-18, S-23 | `app/sale-rounds/**` (F3 완료 뒤) |
| F9 주문 문구 | S-16, S-22 | `app/orders/[id]/**`, `app/admin/orders/_lib.ts` (F4 완료 뒤) |
| F10 로컬 하네스 | 감사 0절 ①② | `scripts/dev/local/seed-seller-orders*`, `apps/seller/next.config.ts` |

## 2.1 진행 상태 (브랜치 `claude/friendly-brown-pqdw92`)

| Frontier | 커밋 | 로컬 검증 |
|---|---|---|
| F1 | `492f056` | API jest 2,902 통과, 실제 firebase-admin 쓰기 검증 spec 12건(수정 전 12건 실패) |
| F2 | `166411b` | API jest(회차) 110 통과, 수정 전 3건 실패 확인 |
| F3 | `0b2ab42` | seller vitest, 리뷰 지적(기기 시계 비교·import 정렬) 반영 |
| F4 | `9128e91` | seller vitest |
| F5 | `2d7ca93` | seller vitest(proxy·callback 검증 포함) |
| F6 | `afc384a` | seller vitest 1,037 통과 |
| F7 | `b786f48` | seller vitest |
| F8 | `bd0c567` | seller vitest |
| F9 | `cc9a1cf` | seller vitest, 관리자 주문 E2E 기대값 갱신(원격 E2E는 release train에서) |
| F10 | `63d7b07` | `node --test` 시드 spec 9 통과 |

공통: CI와 같은 검사(API eslint·`tsconfig.build.json` 타입, consumer·seller·driver·e2e·shared·ui tsc, biome lint, CSS 변수) 통과. 원격 Preview·E2E는 실행하지 않았다.

### 이번 작업에서 새로 드러난 후속 후보

| 항목 | 분류 | 근거 |
|---|---|---|
| 같은 원인의 undefined 쓰기: 주소 수정, 내 정보 수정, 관리자 배너 저장 | `IMPLEMENTATION_GAP` 후보(셀러 범위 밖) | `apps/api/src/auth/auth.service.ts:400-401`, `:460`, `apps/api/src/admin/admin.service.ts:933-941` |
| 셀러 `PENDING` 라벨 '대기' vs 관리자 '결제 대기' | 작은 정합 | `apps/seller/src/app/orders/_constants.ts` |
| `REVIEWED`를 셀러는 '구매 확정', 관리자는 '후기 작성'으로 표시 | `SEMANTIC_CONFLICT` — 사람 결정 | 두 화면의 상태 해석이 다르다 |
| `useStoreSalesMode`가 조회 실패도 'legacy'로 돌려줘 S-05 경고를 단정할 수 없음 | 작은 개선 | `apps/seller/src/hooks/useStoreSalesMode.ts` |
| 하위 화면 뒤로가기의 `history.length` 판정은 앱 밖 기록까지 센다 | 알려진 한계 | `apps/seller/src/components/PageHeader.tsx` |
| 관리자 초대 화면은 `apiJson`을 거치지 않아 한국어 오류 변환이 적용되지 않음 | 작은 개선 | `apps/seller/src/hooks/useAdmin.invite.ts:76` |

## 3. 사람 결정이 필요한 항목 (이번 작업에서 구현하지 않음)

| 항목 | 이유 |
|---|---|
| S-04 판매자 새 주문 알림톡, S-07 손님 취소 판매자 알림 | 알림 발송과 ALIGO 템플릿 등록은 명시 승인 대상이다(AGENTS.md §3). `SELLER_ORDER_BATCH`가 콘솔에 등록·승인된 템플릿인지도 확인해야 한다 |
| S-05 신규 가게 기본 판매 방식, 관리자 판매 방식 전환 UI | 운영 정책 결정. 2차 배치에서는 셀러 화면 경고만 넣는다 |
| S-11 셀러 데스크톱 레이아웃 | 디자인 범위 결정 |
| S-15 로그인 첫 화면을 홈으로, 시작 체크리스트 | 제품 흐름 결정 |
| S-20 초대 토큰 사전 확인 | 비로그인 공개 조회 API가 새로 필요하다(토큰 추측 공격 면 검토) |
| 빠진 기능 목록(findings.md §3) | 각각 별도 제품 결정 |
