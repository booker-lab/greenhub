<!-- Language: ko -->

# 개발 환경 현대화 · API Cloud Run 이전 계획

> 2026-10-23 수립. 이 문서는 **결정과 단계 순서**만 소유한다. 각 단계의 실제 진행 상태는 PR과 운영 read-back으로 확인하고, 여기 체크 표시를 현재 사실로 간주하지 않는다.

## 1. 현재 상태 (2026-10-23 실측)

생각보다 최신이다. 큰 틀(Next 16·React 19·NestJS 11·Firebase 12·Mantine 9·Node 22·pnpm 10·Biome 2·Vitest 4·Jest 30·ESLint 9)은 이미 현행 세대다. 남은 차이는 아래 두 종류다.

| 구분 | 내용 |
|---|---|
| 같은 큰 버전 안 | next 16.4.0→16.4.2, react 19.2→19.3, mantine 9.0→9.7, playwright 1.59→1.64, biome 2.4→2.6 등 |
| 큰 버전 변경 | NestJS 11→12(관련 패키지 일괄), firebase 12→13, firebase-admin 13→14, ESLint 9→10, Vitest 4→5, TypeScript 5.9→7, undici 6→8, firebase-tools 14→15, @firebase/rules-unit-testing 5→6, dotenv 17→18 |
| 런타임 | Node 22(유지보수 단계, 2027-04 지원 종료) → Node 24 LTS |
| 결제 SDK | `@portone/browser-sdk` 0.1.3→0.1.13 — 결제 흐름 전용 검증과 함께 별도 |

## 2. 확정 결정 (2026-10-23 사용자 확정)

1. **진행 순서 = 작은 업데이트 → API Cloud Run 이전 → 큰 버전 업데이트를 하나씩.**
2. **API Cloud Run 이전**은 이 문서가 아니라 [`api-hosting-cloud-run-plan.md`](api-hosting-cloud-run-plan.md)(계획·결정 정본)와 [`api-cloud-run-runbook.md`](api-cloud-run-runbook.md)(실행 명령)가 소유한다. 이 세션에서 정한 운영 방식(항상 1대·최대 1대·CPU 상시)과 고정 주소 `api.greenlove.co.kr`(전환 때 바로, 11/10 첫 회차 전)는 그 계획서에 반영했다.

## 3. 단계

### 1단계 — 같은 큰 버전 안 업데이트 (코드만, 위험 낮음)
- 대상: §1 첫 줄. 새 린트 규칙으로 드러난 지적(불필요한 타입 단언 등)을 동작 변화 없이 정리.
- 증거: Biome·ESLint·타입·단위 테스트·4앱 운영 빌드 로컬 통과.

### 2단계 — API Cloud Run 이전
- `api-hosting-cloud-run-plan.md`의 C1~C8을 따른다.

### 3단계 — 큰 버전 업데이트 (하나씩 별도 PR)
권장 순서: Node 24 → firebase-admin 14 / firebase 13 → NestJS 12 묶음 → ESLint 10 → Vitest 5 → 나머지 도구. TypeScript 7(네이티브 컴파일러)은 Next·Nest 도구 호환을 확인한 뒤 마지막에 판단한다.

## 4. 하지 않는 것
- 화면·도메인 로직 리팩토링은 이 계획 범위가 아니다(`docs/specs/frontend/app-refactor-roadmap.md` 소유).
