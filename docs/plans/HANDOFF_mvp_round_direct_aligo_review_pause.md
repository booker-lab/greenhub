<!-- Language: ko -->

# 회차 직배송 MVP — ALIGO 심사 대기 인계

> 현재 재개 순서만 유지한다. 상세 과거 증거는 `docs/plans/REPORT_mvp_round_direct_launch.md`와 Git 이력에서 확인한다.

## 현재 상태 — 2026-08-23 KST

- 회차 직배송 MVP는 PR #11을 통해 `main` 통합 완료.
- 기능 통합 기준 SHA: `e55f25914cc7d01576fbd4639583daaf0fe6385e`.
- 카카오 비즈니스 채널 최종 승인 완료.
- ALIGO 발신 프로필·`senderkey` 준비 완료.
- 회차 알림 템플릿 8종 provider 등록·심사 요청 완료, 전부 `검수중`.
- 실제 알림톡·SMS 발송 0건.
- production ALIGO 자격 증명·8종 매핑 미반영.
- 첫 운영 회차 미생성, `salesMode=legacy`.

현재 외부 차단점은 **ALIGO 8종 provider 심사 완료**다.

동시에 해결 가능한 P0는 두 가지다.

1. **결제 finalization `PAID` 최종 방어** — 현재 `main`의 `finalizePaidOrder()`는 전달받은 provider status를 자체 강제하지 않음.
2. **Issue #32 `main` branch protection/ruleset 활성화**.

현재 상태 정본은 `docs/memory.md`, 미완료 목록은 `docs/BACKLOG.md`를 우선한다.

## 결제 finalization P0

현재 `apps/api/src/payments/payment-finalization.service.ts`의 `finalizePaidOrder()`는 주문 상태·금액·reservation을 검사하지만 전달받은 `paymentData.status === 'PAID'`를 메서드 내부에서 직접 강제하지 않는다.

현재 일반 호출 경로는 일부 방어한다.

- scheduler는 원격 상태가 `PAID`일 때만 finalization 호출.
- webhook은 `Transaction.Paid` 이벤트에서 원격 결제를 재조회.

하지만 finalization service 자체가 비`PAID` 입력을 최종 차단하는 구조는 아니다.

따라서 actual release SHA를 확정하기 전에:

- 비`PAID` 차단 구현,
- `PENDING`/`FAILED`/`CANCELLED` 회귀,
- `PAID` 일반·공동구매·회차 정상 경로,
- 금액 불일치,
- 기존 reservation/race 회귀

를 통과하고 수정이 `main`에 포함됐음을 확인한다.

정본: `docs/specs/api/payments.md`.

## 배포 안전성 변경

2026-08-23 배포 감사에서 `main` push가 문서 변경만으로 Vercel production deployment를 만들던 구조를 확인했고 repo-side remediation을 적용했다.

- PR #30: consumer·seller·driver `main` Vercel Git auto-deploy 차단.
- PR #30 merge 후 세 프로젝트 신규 deployment 0건 확인.
- docs-only `main` push는 Preview sync/E2E 제외.
- deployment safety CI 추가.
- `AGENTS.md`: direct `main` commit/push 금지.
- PR #31: 순수 docs/Markdown Vercel build skip.
- pure-docs branch 검증에서도 세 프로젝트 신규 deployment 0건 확인.

남음:

- GitHub `main`은 마지막 재조회에서 `protected=false`.
- Issue #32에서 PR required + safety required check + force-push/delete 차단 필요.

**중요:** `main` merge는 더 이상 production 배포 경로가 아니다. production은 actual release SHA를 고정·검증한 뒤 별도 승인으로 exact-SHA deploy/promotion을 수행한다.

상세: `docs/plans/PLAN_deployment_safety_guards_20260823.md`.

## 판매 활성화 법적 상태

production `/privacy`, `/terms`는 현재 비판매 상태를 전제로 한다.

따라서 ALIGO 실제 발송 검증 뒤 release SHA를 고정하기 전에:

- 실제 주문·결제·취소·환불·배송·재배송비·보류 정책,
- PortOne/결제사업자 개인정보 처리,
- ALIGO 고객 알림 처리,
- seller/driver 배송정보 접근,
- 시행일·이전 버전,
- `legal-documents.test.mjs`

을 `docs/specs/legal/README.md` 계약에 맞게 갱신한다.

## ALIGO 템플릿 현황

| 논리 템플릿 | 상태 |
|---|---|
| `ORDER_ACCEPTED` | 검수중 |
| `ORDER_PREPARING` | 검수중 |
| `ORDER_DELIVERING` | 검수중 |
| `ORDER_DELIVERY_HELD` | 검수중 |
| `ORDER_REDELIVERY_PAYMENT_REQUESTED` | 검수중 |
| `ORDER_REDELIVERY_SCHEDULED` | 검수중 |
| `ORDER_DELIVERED` | 검수중 |
| `ORDER_CANCELLED` | 검수중 |

- 중복·오류·반려 없음.
- 비밀값 원문 기록 금지.

## 검증 기준

- 마지막 전체 원격 회차 E2E 역사 증거: SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`.
- chromium 26 + mobile 26 = 52, 양쪽 cleanup 성공.
- 현재 release SHA 증거로 확장 적용하지 않는다.
- 결제 finalization P0와 법적 변경까지 포함한 actual release SHA에서 다시 검증한다.

## 지금 하지 말아야 할 작업

- 심사 중 템플릿 중복 등록·임의 수정.
- 승인 전 실제 알림톡·SMS 발송.
- ALIGO secret/`tpl_code` 원문 Git 기록.
- direct `main` commit/push.
- `main` merge를 production 배포 승인으로 해석.
- 별도 Task 승인 없이 production 배포·Firebase 운영 변경·운영 회차 생성·`salesMode` 변경.
- 비판매 법적 문구를 판매 공개 전에 임의로 미리 전환.
- 결제 finalization P0가 `main`에 반영되기 전에 release SHA를 확정.

## 지금 병렬로 할 수 있는 작업

1. 결제 finalization `PAID` guard 구현·회귀 검증·통합.
2. Issue #32 `main` protection/ruleset 관리자 설정.
3. read-only 문서/코드 정합성 감사.
4. ALIGO provider 심사 상태 조회.

## ALIGO 승인 뒤 재개 순서

1. 결제 finalization P0가 `main`에 통합됐는지 확인.
2. 8종 모두 승인/수정요청/반려 여부 확인.
3. 승인 `tpl_code` 8종 ↔ 내부 논리 템플릿 1:1 매핑 검사.
4. 별도 승인 후 격리 실제 알림톡 정상 발송.
5. 별도 승인 후 SMS fallback 실제 검증.
6. 판매 활성화 법적 문서·테스트 재정합화.
7. Issue #32 완료 확인.
8. 법적 변경과 모든 P0 코드 보정까지 포함한 actual release SHA 확정.
9. exact SHA 원격 회차 E2E 52건 + fixture cleanup.
10. 운영 Firebase read-only 재조회.
11. 별도 승인 후 production ALIGO 설정 반영·검증.
12. exact-SHA production deploy/promotion 절차 확정.
13. 사용자의 별도 `Task 3.1 승인` 뒤에만 production 배포.
14. deployment metadata SHA 대조 → 운영 smoke.
15. 첫 회차 검수 → 최종 출시 판정 → `salesMode: round_direct` 전환.

## 재개 완료 조건

- [x] 회차 직배송 코드 `main` 통합
- [x] 카카오 비즈니스 채널 승인
- [x] ALIGO 발신 프로필·senderkey 준비
- [x] ALIGO 템플릿 8종 등록·심사 요청
- [x] repo-side `main` 자동 production deploy 차단
- [x] deployment safety CI와 docs-only ignore 적용
- [ ] 결제 finalization `PAID` guard + 회귀 검증 + `main` 통합
- [ ] Issue #32 branch protection/ruleset
- [ ] ALIGO 템플릿 8종 최종 승인
- [ ] 실제 알림톡 정상 발송
- [ ] SMS fallback
- [ ] 판매 활성화 법적 문서 정합화
- [ ] actual release SHA 원격 E2E 52건+cleanup
- [ ] production ALIGO 설정
- [ ] Task 3.1 별도 승인

미완료 게이트를 건너뛰어 production 배포 또는 `salesMode` 전환을 진행하지 않는다.
