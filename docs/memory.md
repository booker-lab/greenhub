<!-- Language: ko -->

# 프로젝트 현재 상태

> 현재 작업 판단에 필요한 최소 상태만 유지한다. 완료 이력과 상세 증거는 기본 Context로 읽지 않는다.

## 검증 기준

- Git·GitHub 직접 재검증: `2026-08-23 KST`
- 외부 환경 상태 기준: `2026-08-23 KST`
- GitHub PR #11 병합 상태와 `main`↔기존 회차 branch 비교를 직접 재조회했다.
- ALIGO 템플릿 상태는 2026-08-23 provider 등록 결과를 기준으로 한다.
- Firebase·Railway·Vercel 운영 상태와 `salesMode`는 활성 HANDOFF의 최신 확인 결과를 사용한다.
- 별도 승인 없이 외부 운영 상태를 변경하지 않는다.

## Git 기준선

- 저장소: `booker-lab/greenhub`
- 기본 브랜치: `main`
- 통합 완료 회차 branch: `codex/mvp-sales-round-direct`
- 기능 통합 기준 SHA: `e55f25914cc7d01576fbd4639583daaf0fe6385e`
- PR #11은 2026-08-23 KST에 `MERGED`·`CLOSED` 됐다.
- 병합 직후 `main`과 기존 회차 branch는 기능 기준 SHA에서 `identical`이었다.
- 이후 문서 정합화 commit이 `main`에 추가됐으므로 새 작업 시작 시 현재 `main` HEAD를 다시 확인한다.
- 기존 회차 branch는 새 기능 작업의 장기 기준 branch로 재사용하지 않는다.

## 제품 현재 상태

- 회차 직배송 MVP 구현은 `main`에 통합됐다.
- API에는 회차 주문·결제 최종화·환불·재배송비·운영 예외·보관·배송 사진 흐름이 포함된다.
- consumer에는 회차 구매 흐름, seller에는 회차 관리·주문 운영 흐름, driver에는 직배송 흐름이 구현돼 있다.
- 공통 회차 계약은 `packages/shared/src/sale-round.types.ts`가 소유한다.
- 카카오 비즈니스 채널 최종 승인 완료.
- ALIGO 발신 프로필 1건 등록과 `senderkey` 발급 완료.
- 내부 논리 템플릿 코드↔provider `tpl_code` 분리 및 필수 변수 검증 구현 완료.
- 회차 알림 템플릿 8종 provider 등록·심사 요청 완료.
- 현재 8종 모두 `검수중`, 중복·오류·반려 없음.
- 실제 알림톡·SMS 발송 0건. 실제 알림톡 정상 발송과 SMS fallback 검증 미실행.
- 운영 ALIGO 자격 증명 4개와 `ALIGO_TEMPLATE_CODES_JSON` 미반영.
- 회차 출시 후보 production 배포, 첫 운영 회차 생성, `salesMode` 전환 미실행.
- 판매 모드는 최신 운영 확인 기준 `legacy`.
- 운영 Firebase indexes·Firestore Rules·Storage Rules는 기존 출시 준비에서 반영 완료 상태.
- 따라서 회차 직배송 MVP 코드는 `main`에 통합됐지만 운영 기능 공개 전인 `paused_external_review` 상태다.

## 판매 활성화 법적 문서 상태

- 현재 production `/privacy`, `/terms`는 2026-08-19 시행 버전이다.
- 이용약관·개인정보처리방침은 현재 상용 주문·결제·배송을 운영하지 않는 **비판매 상태**를 명시한다.
- 개인정보 정본은 PortOne·결제사업자를 현재 상용 처리 수탁자로 운영하지 않는다고 적고 있다.
- 실제 고객 ALIGO 알림의 공급자 처리도 현재 공개 고지에 별도 반영돼 있지 않다.
- 그러므로 기존 법적 고지의 production 반영 완료는 **판매 활성화 법적 준비 완료를 뜻하지 않는다.**
- ALIGO 실제 발송 검증 뒤, 실제 출시 대상 SHA를 고정하기 전에 `docs/specs/legal/README.md`의 P0 재정합화 게이트를 수행한다.
- 판매가 아직 공개되지 않은 현재는 비판매 문구를 임의로 먼저 `판매 중` 상태로 바꾸지 않는다.

## ALIGO 템플릿 심사 현황

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

- 실제 알림톡·SMS 발송: 0건
- 비밀값 원문은 기록하지 않는다.

## 검증 상태

- 마지막 전체 원격 회차 E2E 성공 증거: SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`.
- chromium 26 + mobile 26 = 총 52건 및 양쪽 fixture cleanup 성공.
- 이후 commit에 이 과거 run을 현재 release SHA 성공으로 확장하지 않는다.
- production 배포 전 실제 출시 대상 SHA에서 전체 원격 회차 E2E와 cleanup을 다시 통과해야 한다.

## 문서 정합성 상태

2026-08-23 문서 감사에서 다음 고위험 영역을 현재 상태와 분리·정합화했다.

- 현재 상태: `memory`, 활성 HANDOFF·출시 PLAN, `BACKLOG`
- 라우팅: `docs/README.md`, `PROJECT_MAP`, plans/API/frontend/ops/security/design/performance README
- 실행/환경: README, `INTEGRATION_TEST`, `URLS`, `TROUBLESHOOTING`, toolchain
- API 현행 계약: auth, products, orders, payments, notifications, hubs, settlements, admin
- ops: 회차 runbook, E2E 환경, Preview auth URL 정책, 카카오 채널 증빙, k6 계획
- frontend/security: 과거 `*-plan`·감사 템플릿과 현재 계약 분리, 위험한 운영 DB visual seed 지시 제거
- legal: 비판매 공개 문서와 향후 판매 활성화 사이의 P0 재정합화 게이트 추가

과거 PLAN·REPORT·frontend plan·security findings template는 삭제하지 않고 역사 자료로 보존한다. 파일 내부의 과거 `TODO/대기/next`를 현재 지시로 자동 승계하지 않는다.

## 활성 문서

- 문서 전체 라우팅: `docs/README.md`
- 저장소 작업 규칙: `AGENTS.md`
- Context 라우터: `docs/PROJECT_MAP.md`
- 현재 상태 SSOT: 이 문서
- 현재 재개 순서: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 출시 실행 계약: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`
- 판매 활성화 법적 게이트: `docs/specs/legal/README.md`
- 현재 미완료 작업: `docs/BACKLOG.md`
- 설계 결정: `docs/CRITICAL_LOGIC.md`

동작 계약이 충돌하면 현재 `main` 코드·설정·테스트를 기준으로 현행 spec을 정합화한다. 운영·진행 상태가 충돌하면 직접 재검증 결과, 이 문서, 최신 HANDOFF·PLAN, 역사 자료 순으로 판정한다.

## 외부 승인 경계

사용자의 명시적 승인 없이 다음을 수행하지 않는다.

- ALIGO 템플릿 추가 등록·변경 또는 실제 알림톡·SMS 발송
- 운영 자격 증명·환경 변수·데이터 변경
- Railway·Vercel·Firebase 운영 변경 또는 배포
- 운영 회차 생성·상태 변경 또는 `salesMode` 전환
- 실제 결제·환불

비밀값과 개인정보 원문은 문서, 명령 출력, 로그, Git에 기록하지 않는다.

## 다음 작업

1. ALIGO 회차 알림 템플릿 8종 심사 결과를 기다린다. 상태가 바뀌기 전에는 실제 발송·운영 변수·배포 단계로 진행하지 않는다.
2. 8종 승인 뒤 격리 실제 알림톡 정상 발송 → SMS fallback 검증을 수행한다.
3. 그 다음 **판매 활성화 법적 문서 재정합화**를 완료한다. 이 단계에서 consumer `/privacy`, `/terms`와 법적 테스트가 실제 결제·알림·배송 정책과 일치해야 한다.
4. 법적 페이지 변경까지 포함한 실제 출시 대상 SHA를 확정한 뒤 전체 원격 회차 E2E 52건+cleanup을 다시 통과시킨다.
5. 이후 운영 Firebase 재조회 → 승인된 ALIGO 운영 설정 → 별도 `Task 3.1 승인` → production 배포 → 첫 회차 → 최종 판정 → `salesMode` 전환 순으로 진행한다.
6. 문서 감사는 링크·참조 무결성과 개별 current spec의 코드 충돌만 낮은 우선순위로 계속 점검한다.
