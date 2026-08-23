<!-- Language: ko -->

# API 명세 라우팅

> 기준일: 2026-08-23 KST
>
> `docs/specs/api/`에는 **현재 API 계약**과 **과거 구현 계획**이 함께 존재한다. 파일 위치가 같다는 이유로 `*-plan.md`를 현행 계약으로 사용하지 않는다.

## 현재 계약 문서

아래 문서는 현재 `main` 코드와 대조해 현행화한 API/domain SSOT다.

| 도메인 | 현행 명세 |
|---|---|
| Admin | `admin.md` |
| Auth | `auth.md` |
| Hubs | `hubs.md` |
| Notifications | `notifications.md` |
| Orders | `orders.md` |
| Payments | `payments.md` |
| Products | `products.md` |
| Settlements | `settlements.md` |

회차 직배송의 통합 계약은 이 디렉터리가 아니라 `docs/specs/mvp-sales-round-direct-delivery.md`를 사용한다.

## 역사적 구현 계획

다음 파일은 당시 문제·설계·실행 순서를 보존하는 **역사 자료**다. 제목이나 본문에 “구현은 차기 세션”, “미구현”, 과거 SHA·Preview 구조가 남아 있어도 현재 작업 지시가 아니다.

- `e2e-ci-seed-plan.md` — 2026-05 CI seed 문제 해결을 위한 당시 선설계
- `preview-deploy-gate-plan.md` — 2026-05 Preview stale race 해결을 위한 당시 선설계
- `settlement-refactor-plan.md` — 2026-05 settlement 리팩터링 선설계. 현재 settlement 계약은 `settlements.md`를 사용

이 역사 문서의 결론이 현재 코드와 충돌하면 현재 `main` 코드·테스트와 위 현행 명세가 우선한다.

## 문서 사용 순서

1. 현재 작업·차단 상태: `docs/memory.md`
2. 영역 라우팅: `docs/PROJECT_MAP.md`
3. 해당 도메인의 현행 `*.md`
4. 실제 `main` 코드·DTO·shared type·test 대조
5. 결정의 배경이 필요할 때만 `*-plan.md`, 완료 PLAN/REPORT, `docs/CRITICAL_LOGIC.md`, archive 검색

## 관리 규칙

- 새 현행 API 계약은 도메인 이름의 `*.md`에 유지한다.
- 일회성 리팩터링·배포·마이그레이션 계획을 현행 domain spec에 섞지 않는다.
- 완료된 계획 문서는 삭제하지 않아도 되지만, 현재 상태 판정 근거로 인용하지 않는다.
- 외부 provider 승인·환경 변수 현재값은 API spec에 복제하지 않고 `docs/memory.md`와 활성 HANDOFF/PLAN에서 관리한다.
- 공개 DTO·enum·상태의 정본이 `packages/shared`에 있으면 spec은 해당 파일을 명시하고 중복 정의를 최소화한다.
