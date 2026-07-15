# Green Love 프로젝트 메모

> **SSOT**: 세션 종료 시 최신 상태만 유지한다. 200라인 초과 시 아카이브하고 50라인 이내 요약으로 갱신한다.
> 최신 아카이브: `docs/archive/memory_archive_20260715_before_round_direct_task2.md`

최종 수정: 2026-07-15 (회차 직배송 Task 2.8 주문 모듈 연결 완료)

---

## 현재 진행

- 현재 브랜치: `codex/mvp-sales-round-direct`
- 기능 계획 정본: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료 보정 계획 정본: `docs/plans/PLAN_mvp_sales_round_review_remediation.md`, `docs/plans/PLAN_mvp_sales_round_build_gate_remediation.md`
- 구현 명세 정본: `docs/specs/mvp-sales-round-direct-delivery.md`
- 핵심 결정: `docs/CRITICAL_LOGIC.md` #CL-166

## 최근 완료

- Phase 0.1~0.6 완료: 회차·예약·주문·알림·스토어 shared 계약과 공개 API export 반영.
- Phase 1.1~1.5 완료: 판매 회차 API, 서비스, 컨트롤러, 모듈 export 반영.
- Phase 2.1~2.6 완료: `mvp-order-flow.spec.ts`, `CreateOrderDto`, 주문 용량, 주문 생성, 주문 조회, 주문 생명주기 최소 구현 반영.
- Phase 2.7 완료: `orders.controller.ts`에 회차 장바구니 검증, 고객 취소, 배송 보류, 재배송비, 배송 사진 API 경로 연결.
- Phase 2.8 완료: `OrdersModule`에 `OrderCapacityModule`, `PaymentsModule`, `OrderChargesService` 필수 연결을 확인하고 API 빌드 통과.
- 리뷰 보정 Task 0.1~4.6 완료: 회차·주문 권한, 상태표, 취소 환불, 예약 소비·반환, 보류 카운터, 재배송비 소유권, 금액·Timestamp 계약과 실제 모듈 연결 반영.
- 빌드 게이트 보정 Task 0.1~3.3 완료: Windows 안전 패키지 선택 검사, 명시적 앱 build, consumer 알림 코드 6종, seller `DELIVERY_HELD` 상태 표시 계약 반영.

## 이번 세션 검증

- `node scripts/check-workspace-build-selection.mjs` 통과: 공용 패키지 선행과 `api`, `consumer`, `seller`, `driver` 명시 선택 확인.
- `pnpm --filter consumer build`, `pnpm --filter seller build` 통과.
- `pnpm build` 통과: `@greenhub/shared` 선행 후 필수 런타임 앱 4개가 모두 실제 build됐고 필터 0건 메시지가 없었다.
- `pnpm --filter api test -- --runInBand` 통과: 8개 스위트, 34개 테스트 통과.
- `pnpm --filter api test:e2e -- mvp-sales-round-review-remediation.e2e-spec.ts --runInBand` 통과: 2개 테스트 통과.
- 수정 코드 파일은 모두 500라인 미만.

## 주의사항

- PLAN의 단일 Target/Dependency 원칙을 유지한다.
- Task 2.8의 선행 불가능한 보관 의존성 문구는 현재 생성된 용량·결제·재배송비 연결로 보정했으며, 보관 모듈 연결은 Task 3.11·3.14에서 수행한다.
- PortOne 샌드박스 검증은 원 계획 Task 2.10 전, Firebase Emulator 검증은 원 계획 Task 6.4 전에 완료한다.
- `OrderChargesService`의 원 계획 Task 2.11 Status는 선행 2.8~2.10 때문에 todo로 유지한다.

## 다음 진입

- `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`의 Task 2.9가 다음 실행 진입점이다.
- Task 2.9는 `apps/api/src/payments/payments.service.spec.ts` 단일 Target에서 늦은 결제·중복 웹훅·한도 재확보 실패 자동 환불 테스트를 먼저 고정한다.
- PortOne 샌드박스 검증은 원 계획 Task 2.10 전, Firebase Emulator 검증은 원 계획 Task 6.4 전에 완료한다.
