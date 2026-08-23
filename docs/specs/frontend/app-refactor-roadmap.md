<!-- Language: ko -->

# 멀티앱 프론트 리팩토링 로드맵 — 역사 요약

> 상태: Historical roadmap
> 원 작성: 2026-05
> 최종 정합화: 2026-08-23 KST

## 문서 성격

이 파일은 2026-05 당시 seller를 기준 패턴으로 삼아 consumer·admin·driver 프론트를 순차 리팩토링하려던 로드맵이다. 현재 앱별 진행 상태, 현재 테스트 환경, 현재 출시 우선순위의 정본이 아니다.

현재 작업에서는 `docs/specs/frontend/README.md`를 먼저 읽고 실제 `main` 코드와 관련 API/domain current spec을 확인한다.

## 당시 로드맵의 핵심 방향

과거 리팩토링에서 사용한 방향은 다음과 같았다.

- 큰 페이지를 `_lib`, `_hooks`, `_components`로 분리
- `@greenhub/shared`에서 공통 타입·상수 재사용
- `packages/ui`의 공통 시각 토큰 사용
- seller 주문·정산·admin 화면의 구조 정리
- consumer 디자인 시스템 정리
- driver UI는 이후 별도 단계로 검토

이 방향 자체가 현재 코드의 완료 여부를 보장하지 않는다. 현재 구현을 수정할 때는 대상 파일을 직접 확인한다.

## 현재 사용하면 안 되는 과거 상태 문구

원문에는 당시 환경을 기준으로 다음과 같은 표현이 있었다.

- consumer는 다음 리팩토링 대상
- driver 리팩토링 미착수
- 특정 admin visual 검증이 잔여
- staging이 없고 production Firebase가 단일 검증 환경이라는 전제
- production store를 visual fixture로 재시드하는 권고

위 내용은 현재 상태가 아니다. 특히 **운영 Firebase를 visual/E2E fixture 저장소로 사용하거나 과거 reset/seed script를 검증 목적으로 실행하지 않는다.**

현재 회차 E2E는 `docs/specs/ops/mvp-sales-round-e2e-environment.md`의 비운영 격리 계약을 따른다. 실제 production 데이터 변경은 별도 승인 없이는 수행하지 않는다.

## 현재 리팩토링 작업 규칙

새 frontend 리팩토링이 필요하면:

1. `docs/memory.md`, `docs/BACKLOG.md`에서 실제 우선순위를 확인한다.
2. 해당 앱 코드와 현재 테스트를 직접 감사한다.
3. 과거 이 문서의 상태표를 재사용하지 않는다.
4. UI-only 작업이라도 API·shared 계약 변경 여부를 확인한다.
5. visual 검증은 최신 비운영 또는 안전한 환경에서 새 Task로 정의한다.
6. 테스트 계정 비밀번호·session·운영 고객 데이터를 문서에 기록하지 않는다.

## 관련 현재 문서

- frontend 라우터: `docs/specs/frontend/README.md`
- 현재 상태: `docs/memory.md`
- 현재 backlog: `docs/BACKLOG.md`
- seller 과거 visual 검증 요약: `docs/specs/frontend/seller-refactor-visual-verify.md`
- 회차 직배송 current contract: `docs/specs/mvp-sales-round-direct-delivery.md`
