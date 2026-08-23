<!-- Language: ko -->

# Consumer 디자인 시스템 E2E — 역사 검증 요약

> 상태: Historical test record
> 원 기준: 2026-05
> 최종 정합화: 2026-08-23 KST

## 문서 성격

이 파일은 과거 `consumer-design-system.spec.ts`를 기준으로 CSS token과 화면 렌더링을 확인하던 체크리스트다. 당시 28개 chromium/mobile 조합을 기준으로 작성됐으며 **현재 E2E 전체 수, 현재 production 검증 절차, 현재 출시 게이트가 아니다.**

현재 테스트 목록과 실제 case 수는 `apps/e2e/tests/**`와 Playwright 설정을 직접 확인한다.

## 당시 검증 범위

- mypage, cart, category, product detail의 JS critical error
- 주요 CSS variable/token 해석
- 홈·BottomNav·ProductTopBar의 compact visual rule
- chromium/mobile viewport 조합

이 항목은 디자인 시스템 회귀의 과거 의도를 이해하는 참고 자료로만 사용한다.

## 현재 사용하면 안 되는 과거 절차

원문은 production `greenlove.co.kr`에서 직접 E2E를 실행하고, 상품이 없으면 실제 DB 상품 상태를 확인하는 절차를 포함했다. 현재는 다음 원칙을 따른다.

- production을 일반 E2E fixture 환경으로 사용하지 않는다.
- 테스트 통과를 위해 production 상품·사용자·주문 데이터를 생성하거나 수정하지 않는다.
- 회차 직배송 다역할 E2E는 `docs/specs/ops/mvp-sales-round-e2e-environment.md`의 비운영 격리 계약을 따른다.
- production smoke가 필요한 경우 상태 변경 없는 범위와 별도 승인 경계를 먼저 확인한다.

## 현재 검증 시 확인할 것

새 디자인 시스템 회귀 검증이 필요하면:

1. 현재 `consumer-design-system.spec.ts` 존재 여부와 실제 assertion을 확인한다.
2. `packages/ui`와 consumer CSS/theme의 current token을 확인한다.
3. 테스트 환경이 production data write를 요구하지 않는지 확인한다.
4. 과거 `28/28` 숫자를 현재 통과 기준으로 재사용하지 않는다.
5. 현재 release gate와 관계가 있으면 활성 PLAN/HANDOFF에 명시적으로 추가한다.

## 관련 문서

- frontend 라우터: `docs/specs/frontend/README.md`
- 현재 상태: `docs/memory.md`
- E2E 환경 계약: `docs/specs/ops/mvp-sales-round-e2e-environment.md`
- 디자인 토큰 current source: `packages/ui`
