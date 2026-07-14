# Green Love 프로젝트 메모리
> **SSOT**: 세션 종료 전 최신 상태만 유지한다. 200라인 초과 전 아카이브하고 50라인 이내 요약으로 갱신한다.
> 최신 아카이브: `docs/archive/memory_archive_20260715_before_round_direct_task2.md`

최종 수정: 2026-07-15 (주간 판매 회차·직배송 MVP Phase 2 일부 구현)

---

## 현재 진행

- 현재 브랜치: `codex/mvp-sales-round-direct`
- 실행 계획 정본: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 구현 명세 정본: `docs/specs/mvp-sales-round-direct-delivery.md`
- 핵심 결정: `docs/CRITICAL_LOGIC.md` #CL-166

## 최근 완료

- Phase 0.1~0.6 완료: 회차·예약·주문·알림·스토어 shared 계약과 공개 API export 반영.
- Phase 1.1~1.5 완료: 판매 회차 API, 서비스, 컨트롤러, 모듈 export 반영.
- Phase 2.1 완료: `mvp-order-flow.spec.ts` 계약 수집.
- Phase 2.2 완료: `CreateOrderDto`가 회차 상품 배열, 배송 전화번호, 마케팅 동의, 유입 값을 수용.
- 이번 세션: 회차 주문 용량 서비스와 활성 계약 통과를 위해 주문 생성·조회·생명주기·재배송비 최소 구현을 반영.

## 이번 세션 검증

- `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` 통과: 6개 테스트 통과.
- `pnpm --filter api build` 통과.
- 수정 코드 파일은 모두 500라인 미만.

## 주의할 점

- PLAN의 단일 Target/Dependency 원칙을 유지하되, `mvp-order-flow.spec.ts`는 후속 Task 계약도 활성화되어 있어 구현과 PLAN 상태 갱신 범위를 신중히 맞춘다.
- `OrderCapacityService`는 15분 `checkoutReservations` 확보·소비·반환을 멱등 키 기준으로 처리한다.
- `OrdersCreateService`의 `round_direct` 분기는 회차 상품 배열을 한 주문·한 결제 금액으로 묶고, 배송 가능 도시 검증 뒤 예약을 잡는다.
- `OrdersLifecycleService`는 회차 주문 마감 전 취소와 `DELIVERY_HELD` 보류 카운터를 반영한다.
- `OrderChargesService`는 고객 책임 배송 보류 주문에 재배송비 결제 항목을 멱등 생성한다.

## 다음 진입

- PLAN과 실제 구현 범위를 정리한 뒤 남은 Phase 2 Dependency를 계속 진행한다.
- 특히 `orders.controller.ts`, `orders.module.ts`, `payments.service.spec.ts`, `payments.service.ts` 순서를 확인한다.
