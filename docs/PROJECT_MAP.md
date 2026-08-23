# Greenhub 프로젝트 맵

> 저장소 구조와 Task별 Context 경로를 찾기 위한 라우터다. 구현 상세, 진행 상태, 외부 URL, 비밀값, 완료 이력은 복제하지 않는다.

## 1. 사용법

이 문서는 다음 질문에만 답한다.

- 변경 대상은 어느 앱·패키지·운영 영역에 속하는가?
- 처음 읽어야 할 코드와 명세는 무엇인가?
- 어떤 근거가 있을 때 다른 영역까지 Context를 확장하는가?
- 어떤 검증 진입점을 사용할 수 있는가?

다른 정보의 정본은 다음과 같다.

- 현재 브랜치, 활성 작업, 차단 요인: `docs/memory.md`
- API·도메인 계약: 해당 `docs/specs/`
- 현재 실행 계약: `docs/memory.md`가 지정한 활성 PLAN·HANDOFF
- 설계 결정: `docs/CRITICAL_LOGIC.md`
- 문제 해결 기록: `docs/TROUBLESHOOTING.md`
- 배포 URL: `docs/URLS.md`

Task를 시작할 때 이 문서 전체를 구현 명세처럼 읽지 않는다. 먼저 아래 표에서 주 영역 하나를 고른 뒤 관련 경로와 명세만 연다.

## 2. 구조 검증 기준선

- 저장소: `booker-lab/greenhub`
- 브랜치: `codex/mvp-sales-round-direct`
- SHA: `0086f1302f0939a95457a6df5aff25dd09af5e55`
- 검증일: `2026-08-23`

이 기준선은 구조 확인 시점이며 현재 작업 상태를 뜻하지 않는다. 현재 브랜치와 활성 Task는 Git 상태와 `docs/memory.md`에서 다시 확인한다.

## 3. 저장소 영역

| 영역 | 역할 |
|---|---|
| `apps/consumer` | 소비자용 Next.js PWA |
| `apps/seller` | 판매자·관리자용 Next.js PWA |
| `apps/driver` | 배송기사용 Next.js PWA |
| `apps/api` | NestJS API와 중앙 비즈니스 로직 |
| `apps/e2e` | Playwright 기반 다역할 통합 검증 |
| `packages/shared` | 앱 간 도메인 타입과 순수 유틸리티 |
| `packages/ui` | 공통 Mantine 테마와 CSS |
| `scripts` | 시드, 마이그레이션, 진단, 배포·E2E 운영 도구 |
| `tests` | Firebase Rules와 k6 검증 |
| 루트 인프라 | Firebase, Vercel, Railway, Docker, GitHub Actions 설정 |

workspace 범위는 `pnpm-workspace.yaml`의 `apps/*`, `packages/*`, `scripts`다.

## 4. 런타임과 소유권 경계

```text
consumer ─┬─> @greenhub/shared
          ├─> @greenhub/ui
          ├─> API
          ├─> Firebase client
          └─> PortOne

seller ───┬─> @greenhub/shared
          ├─> @greenhub/ui
          ├─> API
          └─> Firebase client

driver ───┬─> @greenhub/shared
          ├─> @greenhub/ui
          ├─> API
          └─> Firebase Auth·Firestore·Storage

api ──────┬─> @greenhub/shared
          ├─> Firebase Admin
          └─> 인증·결제·알림 외부 공급자

e2e ───────> 배포된 consumer·seller·driver·API
scripts ───> Firebase Admin·배포 서비스·운영 환경
```

- 공개 DTO, 상태, 날짜·판매 모드 유틸리티는 `packages/shared`가 소유한다.
- 서버 쓰기와 핵심 비즈니스 규칙은 `apps/api`가 소유한다.
- 화면 상태와 사용자 상호작용은 각 frontend 앱이 소유한다.
- Firebase 접근 권한은 `firestore.rules`, `storage.rules`가 소유한다.
- 공통 색상, radius, font, CSS는 `packages/ui`가 소유한다.
- 다역할 사용자 흐름의 최종 검증은 `apps/e2e`가 담당한다.

## 5. 영역별 Context 라우팅

| 영역 | 첫 진입 경로 | 함께 읽을 명세 | 다른 영역 확장 조건 |
|---|---|---|---|
| `apps/consumer` | 대상 `src/app/**/page.tsx`, 관련 `src/hooks`, `src/lib/api.ts`, `src/lib/firebase.ts`, `src/auth.ts` | 회차 직배송, consumer 법적 문서, 직접 관련 API·frontend 명세 | HTTP 계약·쓰기면 `api`; 공통 DTO·상태면 `shared`; Firebase 직접 접근이면 Rules; 결제면 payments·PortOne; 다역할 조건이면 `e2e` |
| `apps/seller` | 대상 seller/admin page, 관련 `src/hooks`, `src/lib/api.ts`, `src/lib/firebase.ts`, `src/auth.ts` | admin·hubs·orders·products·settlements API 명세와 직접 관련 frontend 명세 | mutation·응답 계약이면 `api`; 공통 상태·정산·날짜면 `shared`; 실시간 조회면 Rules; 다역할 흐름이면 실제 관련 앱·`e2e` |
| `apps/driver` | `src/app/board`, `src/app/map`, `src/app/profile`, `src/lib/api.ts`, `src/lib/firebase.ts`, `src/auth.ts` | 회차 직배송, orders·auth API 명세, 직접 관련 ops 명세 | 상태 전이면 API driver·orders; 사진 권한이면 `storage.rules`; 공통 주문 상태면 `shared`; 다역할 흐름이면 관련 앱·`e2e` |
| `apps/api` | `src/main.ts`, `src/app.module.ts`, 대상 module/controller/service/DTO/spec | 직접 관련 `docs/specs/api/<domain>.md`, 회차 직배송, AI 상품 명세 | 공개 계약이면 `shared`와 실제 소비 앱; Firestore 쿼리·권한이면 infrastructure; 공급자 설정이면 ops |
| `apps/e2e` | `playwright.config.ts`, `global-setup.ts`, 대상 `tests/*.spec.ts`, 관련 helper | E2E coverage, E2E 환경, runbook, 직접 관련 gate 문서 | 실패한 spec의 직접 화면·API까지만; fixture 변경이면 `scripts`와 관련 타입 |
| `packages/shared` | `src/index.ts`, 변경 대상 타입·유틸리티, 직접 test | 의미가 대응하는 API 또는 회차 직배송 명세 | 변경 심볼을 실제 import하는 앱만 `rg`로 찾음; API 계약 타입이면 해당 API 포함 |
| `packages/ui` | `src/index.ts`, `src/theme.ts`, `src/style.css` | 디자인 시스템과 직접 관련 frontend 명세 | 변경 theme·style을 실제 소비하는 앱만; 시각 토큰만으로 API를 열지 않음 |
| `scripts` | 대상 `.mjs`, `scripts/package.json`, 호출 workflow 또는 루트 script | 직접 관련 ops, E2E seed·Preview gate, toolchain, artifact 보존 정책 | 데이터 형태면 `shared`·해당 API; 배포면 infrastructure; 외부 대상이면 승인 경계부터 확인 |
| infrastructure | 대상 루트 설정, `.github/workflows`, `tests/firestore`, `tests/storage`, `tests/load` | toolchain, ops, Preview gate, 직접 관련 security 문서 | build root·runtime URL·CORS·인증·Rules 문제의 직접 증거가 있을 때만 앱 소스로 확장 |

`driver`, `operations`, `retention`, `stores`, `varieties`에는 전용 API 명세가 없을 수 있다. 대상 코드와 현재 Task, 인접 명세를 먼저 사용하고 실제 계약 공백이 확인될 때만 새 명세를 추가한다.

## 6. 도메인별 빠른 라우팅

| 도메인 | 1차 코드 | 1차 명세 | 필요 시 확장 |
|---|---|---|---|
| 인증 | `apps/api/src/auth`, 각 앱 `src/auth.ts` | `docs/specs/api/auth.md` | frontend provider, shared auth 타입, 인증 E2E |
| 상품·품종 | `apps/api/src/products`, `apps/api/src/varieties` | `docs/specs/api/products.md` | consumer·seller 상품 화면, shared product·variety 타입 |
| 주문 | `apps/api/src/orders` | `docs/specs/api/orders.md` | consumer checkout·주문, seller orders, driver board, shared order 타입 |
| 결제 | `apps/api/src/payments`, consumer payment hook | `docs/specs/api/payments.md` | PortOne 설정, 주문 생성, 결제 E2E |
| 알림 | `apps/api/src/notifications` | `docs/specs/api/notifications.md` | consumer 알림, shared notification 타입, 공급자 ops |
| 정산 | `apps/api/src/settlements` | `docs/specs/api/settlements.md` | seller/admin 정산, shared settlement 타입 |
| 회차 직배송 | `apps/api/src/sale-rounds`, 관련 orders | `docs/specs/mvp-sales-round-direct-delivery.md` | consumer checkout, seller sale-rounds, driver, E2E |
| 허브 | `apps/api/src/hubs` | `docs/specs/api/hubs.md` | seller hubs, 회차 배송 명세 |
| 관리자 | `apps/api/src/admin`, `apps/seller/src/app/admin` | `docs/specs/api/admin.md`, 관련 frontend/admin 명세 | 실제 관리 대상 도메인 |
| AI 상품 콘텐츠 | `apps/api/src/ai` | `docs/specs/ai_product_content.md` | products·varieties, 공급자 설정 |
| 디자인 시스템 | `packages/ui`, 각 앱 globals·components | 직접 관련 frontend 명세 | 실제 영향 앱과 디자인 E2E |
| Firebase 권한 | `firestore.rules`, `storage.rules`, indexes | 직접 관련 security·ops 문서 | 해당 collection을 읽고 쓰는 앱·API |
| CI·Preview | `.github/workflows`, 배포 설정 | Preview gate·ops 문서 | `scripts/wait-preview-deploy.mjs`, E2E 설정 |

## 7. 문서 라우팅

| 필요한 정보 | 로드 방식 |
|---|---|
| 현재 브랜치·SHA·활성 작업·차단 요인 | `docs/memory.md` |
| 저장소 영역과 Context 경로 | 이 문서의 관련 절만 |
| API·도메인 계약 | 직접 관련 `docs/specs/` 파일만 |
| 활성 PLAN·HANDOFF | `docs/memory.md`가 지정한 정확한 파일만 |
| 중요한 설계 결정 | `docs/CRITICAL_LOGIC.md`를 ID·도메인으로 검색 |
| 현재 Backlog | `docs/BACKLOG.md`를 Task ID·영역으로 검색 |
| 문제 해결 기록 | `docs/TROUBLESHOOTING.md`를 증상으로 검색 |
| 환경별 URL | 배포·인증·CORS Task에서만 `docs/URLS.md` 확인 후 외부 재검증 |
| 보안 모델·검증 | 보안 또는 권한 Task에서 관련 `docs/security/`만 |
| 완료 PLAN·REPORT·PROMPT·discussion·archive·원시 성능 자료 | 결정 충돌·회귀 원인의 증거가 필요할 때만 검색 |

동작 계약이 충돌하면 현재 기준 브랜치의 코드·설정과 테스트 증거를 확인한 뒤 현행 spec을 정합화한다. 운영·작업 상태가 충돌하면 직접 재검증 결과, `docs/memory.md`, 활성 HANDOFF·PLAN, 역사 자료 순으로 판정한다. 충돌은 조용히 선택하지 말고 현재 Task에 근거와 해결 결정을 남긴다.

## 8. 검증 진입점

대표 진입점은 다음과 같으며, 실행 전 대상 package의 실제 script를 다시 확인한다.

```text
pnpm build
pnpm --filter api test --runInBand
pnpm --filter seller test
pnpm --filter @greenhub/shared typecheck
pnpm --filter @greenhub/shared test
pnpm test:firestore-rules
pnpm test:storage-rules
pnpm test:e2e
pnpm load:smoke
```

- 루트 `pnpm lint`는 API의 수정형 `eslint ... --fix`까지 재귀 실행하므로 읽기 전용 검사에 사용하지 않는다.
- 루트 `pnpm typecheck`는 모든 앱의 typecheck를 보장하지 않는다.
- build, format, test가 생성하는 산출물을 Task의 변경 허용 범위와 구분한다.
- seed, migration, deploy, 외부 발송 명령은 승인 전 검증 명령으로 실행하지 않는다.

## 9. Context 확장·중단 규칙

1. Task의 주 영역은 한 개로 시작한다.
2. package 설정, 대상 파일, 직접 test, 직접 spec만 먼저 읽는다.
3. 대상 심볼의 import·caller가 확인될 때만 인접 파일로 확장한다.
4. 공개 DTO·enum·상태 변경이 있을 때만 `packages/shared` 사용처를 연다.
5. HTTP 요청·응답 또는 서버 쓰기가 바뀔 때만 API 도메인을 연다.
6. Firebase client 접근이 바뀔 때만 Rules와 indexes를 연다.
7. 여러 역할의 Acceptance Criteria가 있을 때만 E2E 영역을 연다.
8. 운영 데이터·배포·공급자 작업일 때만 `scripts`와 infrastructure를 연다.
9. 단일 화면 변경을 이유로 다른 frontend 앱을 열지 않는다.
10. 완료 계획·보고서·archive는 결정 충돌이나 회귀 원인을 추적할 때만 읽는다.
11. 필요한 근거를 확보하면 Context 확장을 중단하고 Task 범위로 돌아간다.

## 10. 유지관리 규칙

앱·패키지·대표 진입점·의존 방향·도메인 소유권·검증 진입점이 바뀔 때만 이 문서를 갱신한다. 진행률, 외부 심사·배포 상태, 실제 URL, 비밀값, 완료 이력, 일회성 장애는 기록하지 않는다.

구조를 변경한 Task는 종료 전에 경로와 라우팅이 여전히 유효한지 확인한다. 단순 기능 변경은 라우팅이 바뀌지 않았다면 이 문서를 수정하지 않는다.
