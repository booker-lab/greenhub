# Frontend 문서 라우팅

> `docs/specs/frontend`에는 현재 UI 계약뿐 아니라 2026년 상반기 구현 전 계획과 검증 메모가 함께 남아 있다.

## 현재 작업에서의 사용 원칙

- 화면 동작은 현재 `main`의 각 앱 코드와 직접 관련 API/domain spec을 먼저 본다.
- 회차 직배송 UI는 `docs/specs/mvp-sales-round-direct-delivery.md`와 활성 출시 문서를 우선한다.
- 인증은 `docs/specs/api/auth.md`, 주문·결제·상품·정산은 해당 API spec을 함께 본다.
- 공통 visual token은 `packages/ui`의 현재 구현을 정본으로 본다.

## 기본적으로 역사 자료인 파일

`docs/memory.md`나 `docs/BACKLOG.md`가 명시적으로 다시 활성화하지 않는 한 다음 이름 패턴은 완료된 설계/실행 기록으로 취급한다.

- `*-plan.md`
- `*-roadmap.md`
- `*-sdd.md`
- `*-verify.md`
- admin 하위의 `admin-tab-*-plan.md`

문서 안에 남은 `TODO`, `다음 단계`, `미구현`, 과거 테스트 결과를 현재 작업으로 자동 승계하지 않는다.

## E2E 문서 주의

`e2e-coverage-checklist.md`와 `e2e-ds-checklist.md`는 과거 시점의 프론트 검증 기록이다. 현재 테스트 커버리지는 `apps/e2e/tests/**`, `.github/workflows/**`, 최신 원격 run을 직접 확인한다.

특히 회차 직배송 출시 게이트는 과거 consumer 전체 E2E 숫자가 아니라 `.github/workflows/e2e-round-direct.yml`의 chromium/mobile 52건과 cleanup 계약을 사용한다.

## 새 frontend 문서 작성 기준

새 UI 계약이 필요하면 과거 계획을 덧붙여 현재화하기보다:

1. 현재 문제와 사용자 흐름을 짧게 정의하고,
2. 실제 코드 경로를 명시하고,
3. 관련 API/domain 계약을 링크하고,
4. 검증 기준을 현재 테스트 파일 기준으로 적는다.

진행률·배포 상태·외부 심사 상태는 frontend spec에 복제하지 않는다.
