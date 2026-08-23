# Greenhub 프로젝트 맵

> 저장소 구조와 Task별 Context 경로를 찾기 위한 **라우터**다. 진행 상태, 외부 URL, 비밀값, 완료 이력은 이 문서에 복제하지 않는다.

## 1. 정본 우선순위

Task를 시작할 때 필요한 문서만 연다.

| 필요한 정보 | 정본 |
|---|---|
| 현재 Git 상태·활성 작업·외부 차단 요인 | `docs/memory.md` |
| 저장소 영역·Context 경로 | 이 문서 |
| 문서 전체 분류 | `docs/README.md` |
| API 계약 | `docs/specs/api/README.md` → 직접 관련 current spec |
| Frontend 계약/역사 계획 구분 | `docs/specs/frontend/README.md` |
| Ops 계약 | `docs/specs/ops/README.md` |
| 판매 활성화 법적 문서 | `docs/specs/legal/README.md` |
| 보안 문서 | `docs/security/README.md` |
| 현재 실행 순서 | `docs/memory.md`가 지정한 활성 HANDOFF·PLAN |
| 미완료 작업 | `docs/BACKLOG.md` |
| 중요한 설계 결정 | `docs/CRITICAL_LOGIC.md` |
| 장애 해결 이력 | `docs/TROUBLESHOOTING.md` |
| 환경·배포 URL | `docs/URLS.md` + 필요 시 외부 재검증 |

동작 계약이 충돌하면 현재 `main`의 코드·설정·테스트를 기준으로 current spec을 고친다. 운영·작업 상태가 충돌하면 직접 재검증 결과 → `docs/memory.md` → 활성 HANDOFF·PLAN → 역사 자료 순으로 판정한다.

## 2. 구조 기준선

- 저장소: `booker-lab/greenhub`
- 기본 기준 브랜치: `main`
- 회차 직배송 기능 통합 기준 SHA: `e55f25914cc7d01576fbd4639583daaf0fe6385e`
- 구조·라우팅 재검증일: `2026-08-23 KST`
- `codex/mvp-sales-round-direct`는 통합 완료된 과거 개발 branch이며 신규 작업의 기준 branch가 아니다.
- 기능 통합 뒤 문서 정합화 commit 때문에 `main` HEAD는 위 기능 기준 SHA보다 앞설 수 있다. 새 작업 시작 시 현재 `main` HEAD를 다시 조회한다.

## 3. 저장소 영역

| 영역 | 역할 |
|---|---|
| `apps/consumer` | 소비자용 Next.js PWA |
| `apps/seller` | 판매자·관리자용 Next.js PWA |
| `apps/driver` | 배송기사용 Next.js PWA |
| `apps/api` | NestJS API와 중앙 비즈니스 로직 |
| `apps/e2e` | Playwright 다역할 E2E |
| `packages/shared` | 앱 간 공개 도메인 타입·순수 유틸리티 |
| `packages/ui` | 공통 Mantine theme·CSS |
| `scripts` | 시드·마이그레이션·진단·E2E/운영 도구 |
| `tests` | Firebase Rules·k6 등 저장소 레벨 검증 |
| 루트 인프라 | Firebase, Vercel, Railway, Docker, GitHub Actions 설정 |

workspace 범위는 `pnpm-workspace.yaml`의 `apps/*`, `packages/*`, `scripts`다.

## 4. 소유권 경계

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
          └─> Firebase client

api ──────┬─> @greenhub/shared
          ├─> Firebase Admin
          └─> 인증·결제·알림 외부 공급자

e2e ───────> 배포된 consumer·seller·driver·API
scripts ───> Firebase Admin·배포 서비스·운영 환경
```

- 공개 DTO·enum·상태·날짜/판매모드 계약은 `packages/shared`를 우선한다.
- 서버 mutation·권한·결제·주문 상태 규칙은 `apps/api`가 소유한다.
- 화면 상태와 사용자 상호작용은 각 frontend 앱이 소유한다.
- Firebase client 접근 권한은 `firestore.rules`, `storage.rules`가 소유한다.
- 공통 시각 토큰은 `packages/ui`가 소유한다.
- 여러 역할을 잇는 최종 사용자 흐름 검증은 `apps/e2e`가 담당한다.
- 개인정보처리방침·이용약관의 공개 계약은 `docs/specs/legal/README.md`와 consumer 법적 페이지가 함께 관리한다.

## 5. 영역별 Context 라우팅

| 영역 | 첫 진입 경로 | 함께 읽을 현행 명세 | 확장 조건 |
|---|---|---|---|
| consumer | 대상 `src/app/**`, 관련 hook/lib/api/auth | 회차 직배송 + 직접 관련 API spec + 판매/개인정보 동작이면 legal | HTTP 계약이면 API, 공통 DTO면 shared, Firebase 직접 접근이면 Rules, 결제·고객 알림·배송 개인정보면 legal 포함, 다역할이면 E2E |
| seller/admin | 대상 page, hook, lib/api, auth | admin·orders·products·hubs·settlements | mutation/응답이면 API, 공통 상태면 shared, Firebase 직접 접근이면 Rules, 고객 배송정보 노출 구조 변경이면 legal 검토 |
| driver | board/map/profile, lib/api, auth | orders·auth·회차 직배송 | 상태 전이면 API, 사진이면 Storage Rules, 고객 주소·전화번호 접근 범위 변경이면 legal 검토, 다역할이면 E2E |
| API | module/controller/service/DTO/spec | `docs/specs/api/README.md`에서 current domain spec 선택 | 공개 계약이면 shared와 소비 앱, Firebase 쿼리면 Rules/index, 결제·알림 공급자/개인정보 흐름이면 ops+legal |
| E2E | config, global setup, 대상 spec/helper | 회차 E2E/ops 문서 | 실패한 흐름의 직접 화면·API까지만 확장 |
| shared | 대상 타입·유틸·test | 대응 domain spec | 실제 import 사용처만 검색 |
| UI | theme/style/component | 직접 관련 frontend 문서 | 실제 소비 앱만 확인 |
| scripts | 대상 script + 호출 workflow/package script | 직접 관련 ops/gate 문서 | 데이터면 domain/shared, 배포면 infrastructure |
| infrastructure | `.github/workflows`, Firebase/Vercel/Railway 설정 | 직접 관련 ops/security 문서 + 배포 작업이면 활성 deployment safety PLAN | 증거가 있을 때만 앱 소스로 확장 |

## 6. 도메인 빠른 라우팅

| 도메인 | 1차 코드 | 1차 명세 |
|---|---|---|
| 인증 | `apps/api/src/auth`, 각 앱 `src/auth.ts` | `docs/specs/api/auth.md` |
| 상품 | `apps/api/src/products`, `apps/api/src/varieties`, AI 사용 시 `apps/api/src/ai` | `docs/specs/api/products.md`; AI 상세 생성은 실제 AI 코드 우선 + `docs/specs/ai_product_content.md`는 설계 참고 |
| 주문 | `apps/api/src/orders` | `docs/specs/api/orders.md` |
| 결제 | `apps/api/src/payments`, consumer payment flow | `docs/specs/api/payments.md` + 판매 공개 시 `docs/specs/legal/README.md` |
| 알림 | `apps/api/src/notifications` | `docs/specs/api/notifications.md` + 실제 고객 발송 시 legal 검토 |
| 정산 | `apps/api/src/settlements` | `docs/specs/api/settlements.md` |
| 회차 직배송 | `apps/api/src/sale-rounds`, 관련 orders | `docs/specs/mvp-sales-round-direct-delivery.md` |
| 거점 | `apps/api/src/hubs` | `docs/specs/api/hubs.md` |
| 관리자 | `apps/api/src/admin`, seller admin UI | `docs/specs/api/admin.md` |
| 개인정보·약관 | consumer privacy/terms, 결제·알림·배송 데이터 흐름 | `docs/specs/legal/README.md`, `consumer-legal-documents.md` |
| Firebase 권한 | `firestore.rules`, `storage.rules`, indexes | `docs/security/README.md` + 직접 관련 ops/spec |
| CI·Preview | `.github/workflows`, `apps/e2e`, scripts | 현행 workflow·E2E 문서. 완료된 `*-plan.md`는 역사 자료 |

전용 API spec이 없는 영역은 대상 코드와 인접 current spec을 먼저 사용한다. 실제 계약 공백이 있을 때만 새 명세를 만든다.

## 7. 검증 진입점

실행 전 대상 package의 `package.json`과 workflow를 다시 확인한다.

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

주의:

- 루트 `pnpm lint`와 API lint는 수정형 동작이 포함될 수 있으므로 read-only 감사 명령으로 간주하지 않는다.
- 루트 `pnpm typecheck`가 모든 앱의 typecheck를 보장한다고 가정하지 않는다.
- build/test/format이 만든 산출물과 의도한 소스 변경을 구분한다.
- seed, migration, deploy, 외부 발송, 운영 데이터 변경은 문서에 명령이 있어도 별도 승인 없이 실행하지 않는다.

## 8. Context 확장·중단 규칙

1. 주 영역 하나로 시작한다.
2. 대상 package 설정, 파일, 직접 test, current spec만 먼저 읽는다.
3. 심볼의 import/caller 근거가 있을 때만 인접 영역으로 확장한다.
4. 공개 계약 변경일 때만 shared 전체 영향 범위를 확인한다.
5. Firebase client 접근 변경일 때만 Rules/indexes를 연다.
6. 결제·실제 고객 알림·고객 배송정보 처리 흐름이 바뀌면 legal 계약을 확인한다.
7. 여러 역할 Acceptance Criteria가 있을 때만 E2E 전체 흐름을 연다.
8. 운영 데이터·배포·외부 공급자 작업일 때만 scripts/infrastructure를 연다.
9. 완료 PLAN·REPORT·archive는 회귀 원인 또는 결정 충돌을 추적할 때만 읽는다.
10. 필요한 근거를 확보하면 확장을 중단한다.

## 9. 유지관리 규칙

앱·패키지·대표 진입점·의존 방향·도메인 소유권·검증 진입점이 바뀔 때만 갱신한다. 진행률, 외부 심사 상태, 배포 성공/실패, 실제 URL, 비밀값, 일회성 장애를 이 문서에 적지 않는다.
