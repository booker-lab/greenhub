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

### 병합·운영 반영 (2026-11-08 KST)

| PR | 내용 | `main` | 운영 |
|---|---|---|---|
| #827 | 1·2차 배치 + 후속(G1~G3) + 결정 반영(H1~H3) | `2d747da4` | **배포 완료** — Release `prod-20261108-2d747da4`, 원격 회차 E2E run `42391155363`(attempt 2에서 76/76; attempt 1은 세션 1건 실패) |
| #832 | C1~C3: 테스트 Firestore undefined 거부, 상품 등록·수정·삭제 E2E, 뒤로가기 판정 | `a9c25c3` | **배포 완료** — `0c0e402`(Release `prod-20261108-0c0e402e`, 원격 회차 E2E run `42404687874`) |
| #834 | 로그인 화면은 카카오 복귀 때만 세션 확인(세션 되살아남 경합 축소) | `1770201` | **배포 완료** — `0c0e402` |

- 운영에서 확인(비로그인·읽기 전용, `2d747da4` 배포 직후): 초대 화면 하단 탭 없음(S-19), 보호 경로 → `/login?callbackUrl=…`(S-13).
- `0c0e402` 배포 뒤 consumer·seller 운영 배포는 이 SHA로 READY이고, driver는 코드 변경이 없어 빌드를 생략해 직전 배포가 계속 서비스한다.
- 운영 상품 저장(S-01·S-02)은 운영 데이터를 바꾸지 않는 원칙 때문에 직접 확인하지 않았다. 판매자가 비공개 상품으로 등록·수정·삭제를 확인해야 한다.
- #832의 `seller-product-lifecycle` E2E는 원격 회차 E2E에 포함되지 않아 release train에서 돌지 않았다(일반 E2E `e2e.yml`은 BACKLOG `LEGACY-E2E-WORKFLOW-VARS`로 막혀 있다). → 이 브랜치에서 회차 E2E 묶음에 넣었다(판정 64→66건, project별 회차 셀러 계정 사용). 다음 release train부터 돈다. → 2026-11-10 `ae4f6593` 원격 실행(run `42836237176`)에서 chromium·mobile 모두 실패해 다시 뺐다(판정 66→64건). 원격 판매자 Preview의 상품 목록은 운영 Firebase를 구독하고 E2E는 상품을 E2E Firebase(staging API)에 저장하기 때문이다. 원격에서 돌리는 일은 BACKLOG `SELLER-PRODUCT-E2E-REMOTE-FIREBASE`.
- 운영 판매자 확인(2026-11-08): 상품 등록·수정·재등록은 된다. 소비자 앱에 안 보이는 것은 `round_direct` 가게가 판매 회차 상품만 보여 주기 때문이다(결함 아님). 상품을 작성 중·판매 예정 회차에 넣어 공개하면 보인다.

### 이번 작업에서 새로 드러난 후속 후보

| 항목 | 분류 | 근거 |
|---|---|---|
| 같은 원인의 undefined 쓰기: 주소 수정, 내 정보 수정, 관리자 배너 저장 | **완료(G1)** — 공용 `common/firestore/firestore-data.ts`로 옮기고, 추가로 찾은 카카오 로그인 거절 기록·알림 설정·회차 주문 유입 정보까지 고쳤다 | 지점별 실제 SDK spec(수정 전 실패 확인) |
| 셀러 `PENDING` 라벨 '대기' vs 관리자 '결제 대기' | **완료(G3)** — '결제 대기'로 통일, 셀러 주문 E2E 기대값 포함 | `apps/seller/src/app/orders/_constants.ts` |
| `REVIEWED`를 셀러는 '구매 확정', 관리자는 '후기 작성'으로 표시 | `SEMANTIC_CONFLICT` — 사람 결정 | 두 화면의 상태 해석이 다르다 |
| `useStoreSalesMode`가 조회 실패도 'legacy'로 돌려줘 S-05 경고를 단정할 수 없음 | **완료(G2)** — 조회 상태 훅 추가, 실제 legacy는 단정 경고·조회 실패는 약한 안내 | `apps/seller/src/hooks/useStoreSalesMode.ts` |
| 하위 화면 뒤로가기의 `history.length` 판정은 앱 밖 기록까지 센다 | 알려진 한계 | `apps/seller/src/components/PageHeader.tsx` |
| 관리자 초대 화면은 `apiJson`을 거치지 않아 한국어 오류 변환이 적용되지 않음 | **완료(G3)** | `apps/seller/src/hooks/useAdmin.invite.ts` |
| API 기존 서비스 파일에 `biome check --write`를 돌리면 safe fix `useImportType`이 Nest DI 생성자 import를 `import type`으로 바꾼다 | 도구 주의(사람 결정: api override로 끌지) | `biome.json` — 이번 작업에서는 API 서비스에 쓰기 모드를 쓰지 않았고 `main` 대비 `import type` 변경 0건 |

## 3. 사람 결정이 필요한 항목 (이번 작업에서 구현하지 않음)

| 항목 | 이유 |
|---|---|
| S-04 판매자 새 주문 알림톡, S-07 손님 취소 판매자 알림 | 알림 발송과 ALIGO 템플릿 등록은 명시 승인 대상이다(AGENTS.md §3). `SELLER_ORDER_BATCH`가 콘솔에 등록·승인된 템플릿인지도 확인해야 한다 |
| S-05 신규 가게 기본 판매 방식, 관리자 판매 방식 전환 UI | 운영 정책 결정. 2차 배치에서는 셀러 화면 경고만 넣는다 |
| S-11 셀러 데스크톱 레이아웃 | 디자인 범위 결정 |
| S-15 로그인 첫 화면을 홈으로, 시작 체크리스트 | 제품 흐름 결정 |
| S-20 초대 토큰 사전 확인 | 비로그인 공개 조회 API가 새로 필요하다(토큰 추측 공격 면 검토) |
| 빠진 기능 목록(findings.md §3) | 각각 별도 제품 결정 |

## 4. 사람 결정 반영 (2026-11-07)

| 항목 | 결정 | 상태 |
|---|---|---|
| 셀러 알림톡(새 주문·손님 취소) | 파일럿 동안 보류. 셀러가 늘면 '회차 마감 요약' 템플릿 1종을 등록한다 | 보류 |
| 신규 가게 판매 방식 | 공용 기본값은 그대로 두고 가게 생성 때 `round_direct`를 명시, 관리자 전환 API·화면 추가(진행 중 회차가 있으면 예전 방식 전환 409, 감사 기록) | 반영 |
| 셀러 데스크톱 레이아웃 | UI 교체 단계가 끝난 뒤 주문 목록·회차 상세·준비 화면부터 | 보류 |
| 로그인 첫 화면 | `/orders` 유지, 새 셀러 시작 체크리스트(상품·회차·정산 계좌)를 `/orders`·홈 맨 위에 | 반영 |
| 초대 토큰 사전 확인 공개 API | 만들지 않는다(비로그인 조회 면 증가 대비 얻는 것이 적음) | 기각 |
| `REVIEWED` 라벨 | 관리자도 '구매 확정'(손님 구매 확정·정산 진행 상태) | 반영 |
| biome `useImportType` | `apps/api/**`에서만 끈다(Nest DI 값 import 보호, API lint는 eslint) | 반영 |
