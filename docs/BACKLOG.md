<!-- Language: ko -->

# Greenhub Backlog

> 기준일: 2026-08-23 KST
>
> 현재 미완료·향후 작업만 관리한다. 완료 상세는 Git history, `docs/CRITICAL_LOGIC.md`, `docs/archive/`, 완료 PLAN·REPORT를 사용한다.

## 우선순위 규칙

- **ACTIVE**: 지금 진행 가능한 최우선 작업
- **BLOCKED_EXTERNAL**: 외부 심사·승인 때문에 기다리는 작업
- **NEXT**: 현재 게이트가 풀리면 바로 진행할 작업
- **LATER**: MVP 출시를 막지 않는 후속 개선
- **STALE_OR_SUPERSEDED**: 현재 상태 재검증 전 실행 금지

---

## ACTIVE

### P0 — DEPLOY-SAFETY-MAIN-PROTECTION

repo-side 자동배포 차단은 완료됐지만 GitHub `main` 자체 보호는 아직 비활성이다.

완료:

- [x] PR #30 — consumer/seller/driver `main` Vercel Git auto-deploy 차단
- [x] PR #30 merge 뒤 3앱 Vercel 신규 deployment 0건 확인
- [x] docs-only `main` push의 `sync-preview`/일반 E2E 제외
- [x] `AGENTS.md` direct-main 금지 규칙
- [x] deployment safety CI
- [x] PR #31 — 순수 docs/Markdown Vercel build skip
- [x] pure-docs branch commit 뒤 3앱 신규 deployment 0건 확인

남음:

- [ ] Issue #32 — `main` branch protection/ruleset 활성화
- [ ] PR required
- [ ] `Deployment safety guard / verify` required check
- [ ] force push 차단
- [ ] branch deletion 차단
- [ ] 재조회에서 `protected=true` 또는 동등 enforcement 확인

Issue #32 완료 전에도 repo-side Vercel guard는 동작하지만, direct push 자체를 GitHub가 강제 차단하지는 못한다. 따라서 모든 작업은 `AGENTS.md`에 따라 branch+PR로 수행한다.

---

## BLOCKED_EXTERNAL

### P0 — ALIGO 회차 알림 템플릿 8종 최종 승인

- [ ] `ORDER_ACCEPTED`
- [ ] `ORDER_PREPARING`
- [ ] `ORDER_DELIVERING`
- [ ] `ORDER_DELIVERY_HELD`
- [ ] `ORDER_REDELIVERY_PAYMENT_REQUESTED`
- [ ] `ORDER_REDELIVERY_SCHEDULED`
- [ ] `ORDER_DELIVERED`
- [ ] `ORDER_CANCELLED`

현재:

- 8종 provider 등록·심사 요청 완료
- 8종 모두 `검수중`
- 중복·오류·반려 없음
- 실제 알림톡·SMS 발송 0건

재개 순서: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`

---

## NEXT — ALIGO 승인 직후

### P0 — 실제 알림 검증

- [ ] 승인된 실제 `tpl_code` 8종 ↔ 내부 논리 템플릿 1:1 매핑 검사
- [ ] 사용자 승인 후 격리 수신자 실제 알림톡 정상 발송
- [ ] 사용자 승인 후 SMS fallback 실제 검증

### P0 — 판매 활성화 법적 문서 재정합화

현재 production `/terms`, `/privacy`는 2026-08-19 **비판매 상태**를 전제로 한다.

- [ ] 상용 주문·결제·배송 상태와 약관 문구 일치
- [ ] 주문 성립·취소·환불·배송·재배송비·배송 보류 정책 검수
- [ ] PortOne·실제 결제사업자 개인정보 처리 역할 검수
- [ ] ALIGO 고객 알림 전화번호·메시지 처리 고지 검수
- [ ] seller·driver 고객 배송정보 접근 설명 검수
- [ ] 시행일·이전 버전 관리
- [ ] `apps/consumer/src/app/legal-documents.test.mjs` 갱신
- [ ] 변경된 `/privacy`, `/terms`를 release SHA에 포함

정본: `docs/specs/legal/README.md`

### P0 — 출시 후보 검증·운영 준비

- [ ] Issue #32 branch protection 완료
- [ ] 법적 페이지 포함 actual release SHA 확정
- [ ] exact SHA 원격 회차 E2E chromium 26 + mobile 26 = 52건 통과
- [ ] 양쪽 fixture cleanup 성공
- [ ] 운영 Firebase indexes·Firestore Rules·Storage Rules 읽기 전용 재조회
- [ ] 사용자 승인 후 운영 ALIGO 자격 증명 4개·`ALIGO_TEMPLATE_CODES_JSON` 반영
- [ ] 8종 매핑 검사
- [ ] production exact-SHA deploy/promotion 절차 확정
- [ ] 별도 `Task 3.1 승인`
- [ ] 승인된 exact release SHA로 Railway API production 배포
- [ ] consumer·seller·driver를 동일 release SHA로 production 배포
- [ ] deployment metadata SHA 일치 확인
- [ ] 운영 무변경 smoke: health·인증·legacy·회차 read·`/privacy`·`/terms`
- [ ] 첫 운영 회차 `DRAFT` 생성·검수
- [ ] 첫 회차 `SCHEDULED` 전환
- [ ] 최종 출시 판정·롤백 dry-run
- [ ] 최종 승인 후 `salesMode: round_direct`
- [ ] 전환 직후 smoke 뒤 외부 유입 링크 공개
- [ ] 첫 두 회차 집중 모니터링 및 Closeout

상세 dependency: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`

---

## LATER — 출시 후 품질·운영 개선

### NOTIFICATION-RETRY-POLICY

- [ ] backoff·일시/영구 오류 분류
- [ ] timeout·rate limit 처리 기준
- [ ] 중복 SMS 방지·재시작 이후 멱등성
- [ ] 구조화 관측 지표와 격리 테스트

### API-LINT-BASELINE

- [ ] auth 흐름의 `any` 제거
- [ ] spec mock 타입 정리
- [ ] `lint:check` / `lint:fix` 분리 검토

### LOCAL-DEV-FULLSTACK

- [ ] API 3000 / consumer 3001 / seller 3002 / driver 3003 launcher 설계
- [ ] seller·driver local CORS origin 계약 확인
- [ ] 기존 `dev.bat` frontend-only 유지 여부 결정

### LOAD-TEST-FORMAL

- [ ] production과 분리된 staging/equivalent 환경 확보
- [ ] 재개 트리거 정의
- [ ] `baseline → launch → growth → spike → soak`
- [ ] `docs/specs/ops/k6-load-test-plan.md` 재검증

### Seller/Admin

- [ ] ADMIN-STORES-T7 판매자 상세 드릴다운
- [ ] ADMIN-STORES-T8 플랫폼 기본 수수료율 설정
- [ ] 준비 물량 공동구매 주문 포함 여부 재설계
- [ ] 필요 시 정산 UX 육안 검증 재개

### Driver/배송

- [ ] Kakao Maps SDK 필요성 재평가
- [ ] 밀크런 경로 프리뷰 필요 시 구현
- [ ] 플랫폼형 드라이버 전까지 실시간 GPS 추적 보류

### 인프라 복원력

- [ ] Railway 단일 장애점 재평가
- [ ] 필요 시 대체 backend contingency 비교

### 확장 트리거

- [ ] 다중 판매자 Phase 2
- [ ] 실제 협력 거점 계약 시 hub 운영 오픈
- [ ] 필요 시 `hub_staff` 역할
- [ ] 외부 드라이버 정산
- [ ] 플랫폼형 드라이버 모델
- [ ] 결제수단 확장 재평가

---

## STALE_OR_SUPERSEDED

다음은 과거 상태를 그대로 전제로 실행하지 않는다.

- 네이버페이 “승인 메일 대기 / 채널키만 넣으면 즉시 활성화”
- 과거 BUG-03 Firestore 공개 read/Firebase Custom Token 가정
- 과거 운영 DB `reset-*` / `visual-settle-*` cleanup 지시
- 2026-05 Railway outage 당시 상태
- PR #11 OPEN/Draft·병합 금지 표현
- 회차 ALIGO 템플릿 8종 “미등록” 표현
- `main` merge가 자동 production 배포를 해야 한다는 과거 전제

---

## 관리 원칙

1. 완료 이력을 장문으로 누적하지 않는다.
2. 현재 행동 가능한 미완료만 ACTIVE/BLOCKED_EXTERNAL/NEXT/LATER에 둔다.
3. 외부 상태는 실제 재조회 뒤에만 갱신한다.
4. Backlog 체크박스는 production 변경 승인으로 간주하지 않는다.
5. 현재 출시 우선순위 충돌 시 `docs/memory.md`와 활성 HANDOFF·PLAN을 우선한다.
6. 모든 repository 변경은 direct `main`이 아니라 branch+PR로 수행한다.
