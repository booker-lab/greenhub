<!-- Language: ko -->

# Seller 프론트 리팩토링 육안 검증 — 역사 요약

> 상태: Historical evidence
> 원 작성 기간: 2026-05
> 최종 정합화: 2026-08-23 KST

## 문서 성격

이 파일은 2026-05에 수행한 seller/consumer 프론트 리팩토링의 브라우저 육안 검증 기록이다. **현재 UI 계약, 현재 테스트 계정, 현재 운영 DB 검증 절차, 현재 출시 게이트가 아니다.**

과거 원문에는 당시 테스트 계정 식별자·평문 테스트 비밀번호, 운영 DB를 대상으로 한 재시드 절차, 세션별 임시 진입법이 포함돼 있었다. 해당 값과 실행 지시는 현재 보안·운영 기준에 맞지 않아 제거했다. 필요한 과거 세부 diff는 Git history에서만 확인한다.

## 당시 검증 범위 요약

- seller 홈 대시보드 구조와 BottomNav
- 주문 목록·상세 UI 리팩토링
- 기간 필터·상태 탭·주문 카드 시각 계약
- seller 상품·정산·설정 흐름
- 일부 admin 반응형 화면
- consumer와 seller의 디자인 시스템 적용 결과

당시 M-PATH 검증은 리팩토링 대상의 주요 시각 회귀를 확인하기 위한 수동 검증이었다. 그 결과를 **2026-08 현재 코드가 동일하다는 증거로 재사용하면 안 된다.**

## 과거 검증에서 파생된 이슈의 현재 처리

당시 발견된 정산 인덱스, 날짜 표시, 버튼 크기, admin 반응형, 준비 물량 등의 후속 이슈는 이후 여러 Task에서 수정·재분류됐다. 현재 남은 작업은 `docs/BACKLOG.md`만 사용한다.

`pending-visual-verify.md`처럼 과거에 미완료로 남은 육안 검증 체크리스트도 현재 운영 DB에 seed를 넣는 지시로 사용하지 않는다. 필요하면 최신 코드와 비운영 환경을 기준으로 별도 UX 검증 Task를 만든다.

## 현재 검증 경로

현재 seller 동작을 검증할 때는 다음 순서를 따른다.

1. `docs/memory.md`와 활성 PLAN/HANDOFF에서 현재 Task를 확인한다.
2. `docs/specs/frontend/README.md`에서 current vs historical 문서를 구분한다.
3. 실제 seller 코드와 관련 API current spec을 확인한다.
4. 비운영 E2E가 필요한 회차 직배송 흐름은 `docs/specs/ops/mvp-sales-round-e2e-environment.md`를 따른다.
5. production 데이터 변경·seed·계정 변경은 별도 승인 없이 수행하지 않는다.

## 보안·개인정보 원칙

- 테스트 계정 이메일·비밀번호·세션 값·bypass secret을 문서에 기록하지 않는다.
- 실제 사용자 식별자·전화번호·주소를 육안 검증 문서에 복사하지 않는다.
- 운영 DB를 visual fixture 저장소로 사용하지 않는다.
- 과거 Git history에 있던 자격정보는 현재 유효한 비밀값으로 간주하지 말고 필요 시 별도 회전·폐기 상태를 확인한다.

## 관련 현재 문서

- 현재 상태: `docs/memory.md`
- 현재 미완료 작업: `docs/BACKLOG.md`
- frontend 라우터: `docs/specs/frontend/README.md`
- seller 관련 API: `docs/specs/api/orders.md`, `docs/specs/api/products.md`, `docs/specs/api/settlements.md`, `docs/specs/api/admin.md`
- 회차 직배송: `docs/specs/mvp-sales-round-direct-delivery.md`
