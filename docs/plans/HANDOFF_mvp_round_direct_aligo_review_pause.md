<!-- Language: ko -->

# 회차 직배송 MVP — ALIGO 심사 대기 인계

> 현재 재개 순서만 유지한다. 상세 과거 증거는 `docs/plans/REPORT_mvp_round_direct_launch.md`와 Git 이력에서 확인한다.

## 현재 상태 — 2026-08-23 KST

완료:

- 회차 직배송 MVP PR #11 `main` 통합
- 카카오 비즈니스 채널 최종 승인
- ALIGO 발신 프로필·`senderkey` 준비
- 회차 알림 템플릿 8종 provider 등록·심사 요청
- repo-side `main` 자동 Vercel production deploy 차단

현재 미완료 P0:

- **Issue #37** — F-001 driver 승인·주문 접근 보안 remediation을 `main`에 통합
- **Issue #32** — GitHub `main` branch protection/ruleset
- **ALIGO 8종 provider 심사** — 전부 `검수중`

실제 알림톡·SMS 발송은 0건이며 production ALIGO 설정, 첫 운영 회차, `salesMode` 전환은 미실행이다. 최신 운영 확인 기준 `salesMode=legacy`다.

## F-001 병렬 P0

2026-08-23 current `main` 직접 재검증:

- 신규 Kakao driver가 `driverApproved: true`로 생성됨
- 승인 필드 없는 기존 driver가 로그인 시 자동 승인됨
- `/driver/orders`가 driver와 seller 모두 허용
- driverId로 주문 서버 필터가 적용되지 않음
- Firestore Rules가 role이 driver이면 전체 order read 허용

따라서 ALIGO 심사를 기다리는 동안 Issue #37 remediation은 **즉시 병렬 진행 가능하며 출시 전 필수**다.

Issue #37 완료 조건은 `docs/BACKLOG.md`와 GitHub Issue #37을 따른다.

**Issue #37 완료 전 actual release SHA를 확정하지 않는다.**

## 배포 안전성

repo-side remediation:

- PR #30: 세 프런트 `main` Vercel Git auto-deploy 차단
- docs-only `main` push Preview sync/E2E 제외
- deployment safety CI
- `AGENTS.md` direct-main 금지
- PR #31: 순수 docs/Markdown Vercel build skip
- 반복 docs-only merge에서 세 Vercel 프로젝트 신규 deployment 0건 확인

남은 관리자 P0는 Issue #32다.

`main` merge는 production 배포 경로가 아니다. production은 actual release SHA를 고정·검증한 뒤 별도 승인으로 exact-SHA deploy/promotion한다.

## 판매 활성화 법적 상태

production `/privacy`, `/terms`는 현재 비판매 상태를 전제로 한다.

ALIGO 실제 발송 검증 뒤 release SHA 고정 전에 다음을 `docs/specs/legal/README.md`에 맞춰 재정합화한다.

- 주문·결제·취소·환불·배송·재배송비·보류 정책
- PortOne/결제사업자 개인정보 처리
- ALIGO 고객 알림 처리
- seller/driver 배송정보 접근
- 시행일·이전 버전
- `legal-documents.test.mjs`

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

중복·오류·반려 없음. 비밀값 원문 기록 금지.

## 검증 기준

- 마지막 전체 원격 회차 E2E 역사 증거: SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`
- chromium 26 + mobile 26 = 52, 양쪽 cleanup 성공
- 이 과거 run을 actual release SHA 증거로 사용하지 않는다.

## 지금 하지 말아야 할 작업

- 심사 중 ALIGO 템플릿 중복 등록·임의 수정
- 승인 전 실제 알림톡·SMS 발송
- ALIGO secret/`tpl_code` 원문 Git 기록
- direct `main` commit/push
- `main` merge를 production 배포 승인으로 해석
- Issue #37 미해결 상태에서 release SHA 고정·release E2E·production deploy 진행
- 별도 승인 없이 production 배포·Firebase 운영 변경·운영 회차 생성·`salesMode` 변경
- 비판매 legal 문구를 판매 공개 전에 미리 전환

## 지금 병렬로 할 수 있는 작업

1. **Issue #37 F-001 remediation의 최신 `main` 통합·검증**
2. Issue #32 `main` protection/ruleset 관리자 설정
3. read-only 문서/코드 정합성 감사
4. ALIGO provider 심사 상태 조회

## 이후 재개 순서

병렬 P0는 가능한 한 ALIGO 심사 대기 중 먼저 닫는다.

1. Issue #37 F-001 remediation `main` 통합·검증
2. Issue #32 branch protection/ruleset 완료
3. ALIGO 8종 최종 상태 확인
4. 승인 `tpl_code` 8종 ↔ 내부 논리 템플릿 1:1 매핑 검사
5. 별도 승인 후 격리 실제 알림톡 정상 발송
6. 별도 승인 후 SMS fallback 실제 검증
7. 판매 활성화 legal docs/test 재정합화
8. 위 변경까지 포함한 actual release SHA 확정
9. exact SHA 원격 회차 E2E 52건 + fixture cleanup
10. 운영 Firebase read-only 재조회 — F-001 Rules 포함
11. 별도 승인 후 production ALIGO 설정
12. exact-SHA production deploy/promotion 절차 확정
13. 별도 `Task 3.1 승인` 뒤 production 배포
14. deployment metadata SHA 대조 → 운영 smoke
15. 첫 회차 검수 → 최종 출시 판정 → `salesMode: round_direct` 전환

## 재개 완료 조건

- [x] 회차 직배송 코드 `main` 통합
- [x] 카카오 비즈니스 채널 승인
- [x] ALIGO 발신 프로필·senderkey 준비
- [x] ALIGO 템플릿 8종 등록·심사 요청
- [x] repo-side `main` 자동 production deploy 차단
- [ ] Issue #37 F-001 `main` 통합·검증
- [ ] Issue #32 branch protection/ruleset
- [ ] ALIGO 템플릿 8종 최종 승인
- [ ] 실제 알림톡 정상 발송
- [ ] SMS fallback
- [ ] 판매 활성화 legal docs/test
- [ ] actual release SHA E2E 52건+cleanup
- [ ] production ALIGO 설정
- [ ] Task 3.1 별도 승인

미완료 게이트를 건너뛰어 production 배포 또는 `salesMode` 전환을 진행하지 않는다.