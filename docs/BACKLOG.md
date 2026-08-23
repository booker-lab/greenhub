<!-- Language: ko -->

# Greenhub Backlog

> 기준일: 2026-08-23 KST
>
> 이 문서는 **현재 미완료·향후 작업만** 관리한다. 완료된 세션별 상세 이력은 Git history, `docs/CRITICAL_LOGIC.md`, `docs/archive/`, 완료 PLAN·REPORT에서 확인한다. 현재 출시 상태는 `docs/memory.md`, 실행 순서는 활성 HANDOFF·PLAN을 우선한다.

## 우선순위 규칙

- **ACTIVE**: 지금 진행 가능한 최우선 작업
- **BLOCKED_EXTERNAL**: 외부 심사·승인·계약 때문에 기다리는 작업
- **NEXT**: 현재 게이트가 풀리면 바로 이어서 할 작업
- **LATER**: MVP 출시를 막지 않는 후속 개선
- **STALE_OR_SUPERSEDED**: 과거에는 미완료였지만 현재 상태를 다시 확인하기 전 실행하면 안 되는 항목
- 완료 작업은 이 문서에 장문 이력으로 누적하지 않는다.

---

## ACTIVE

현재 즉시 실행할 P0 개발 작업은 없다. 회차 직배송 MVP 코드는 `main`에 통합됐고, 출시 흐름은 외부 ALIGO 심사 결과를 기다리는 상태다.

문서·코드 정합성 점검처럼 비파괴 작업은 별도 Task로 계속 수행할 수 있지만, 아래 외부 게이트를 우회해 운영 변경을 진행하지 않는다.

---

## BLOCKED_EXTERNAL

### P0 — ALIGO 회차 알림 템플릿 8종 최종 승인

- [ ] `ORDER_ACCEPTED` 승인
- [ ] `ORDER_PREPARING` 승인
- [ ] `ORDER_DELIVERING` 승인
- [ ] `ORDER_DELIVERY_HELD` 승인
- [ ] `ORDER_REDELIVERY_PAYMENT_REQUESTED` 승인
- [ ] `ORDER_REDELIVERY_SCHEDULED` 승인
- [ ] `ORDER_DELIVERED` 승인
- [ ] `ORDER_CANCELLED` 승인

현재 상태:

- 8종 모두 provider 등록·심사 요청 완료
- 8종 모두 `검수중`
- 중복·오류·반려 없음
- 실제 알림톡·SMS 발송 0건

재개 기준은 `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`를 따른다.

---

## NEXT — ALIGO 승인 직후

### P0 — 실제 알림·출시 후보 검증

- [ ] 승인된 실제 `tpl_code` 8종과 내부 논리 템플릿의 1:1 매핑 준비상태 검사
- [ ] 사용자 승인 후 격리 수신자 실제 알림톡 정상 발송 검증
- [ ] 사용자 승인 후 SMS fallback 실제 검증
- [ ] 실제 출시 대상 `main` SHA 확정
- [ ] 해당 SHA에서 원격 회차 E2E chromium 26건 + mobile 26건, 총 52건 통과
- [ ] 동일 run에서 chromium·mobile fixture cleanup 성공 확인
- [ ] 운영 Firebase 인덱스·Firestore Rules·Storage Rules 현재 상태 읽기 전용 재조회
- [ ] 사용자 승인 후 운영 ALIGO 자격 증명 4개 반영
- [ ] 사용자 승인 후 `ALIGO_TEMPLATE_CODES_JSON` 반영 및 8종 매핑 검사
- [ ] 별도 `Task 3.1 승인` 후 Railway production API 배포
- [ ] consumer·seller·driver production을 API와 동일 출시 SHA로 배포
- [ ] 운영 무변경 smoke 및 배포 후 오류 확인
- [ ] 첫 운영 회차 `DRAFT` 생성·검수
- [ ] 첫 회차 `SCHEDULED` 전환
- [ ] 최종 출시 판정·롤백 dry-run
- [ ] 최종 승인 후 `salesMode: round_direct` 전환
- [ ] 전환 직후 smoke 통과 뒤 외부 유입 링크 공개
- [ ] 첫 두 회차 집중 모니터링 및 Closeout

상세 dependency와 승인 게이트는 `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`를 따른다.

---

## LATER — 출시 후 품질·운영 개선

### NOTIFICATION-RETRY-POLICY — 알림 재시도 정책 고도화

현재 MVP의 최소 retry/fallback 계약을 바꾸지 않고 출시 이후 별도 SDD로 진행한다.

- [ ] 재시도 간격과 backoff 정책 정의
- [ ] 일시 오류/영구 오류 분류 기준 정의
- [ ] timeout·네트워크 예외·응답 파싱·rate limit 처리 기준 정의
- [ ] 시도 횟수·최종 채널·실패 분류의 구조화 관측 지표 정의
- [ ] SMS 중복 발송 방지와 프로세스 재시작 이후 멱등성 범위 결정
- [ ] mock 기반 단위 테스트와 격리 staging 검증 절차 마련

### API-LINT-BASELINE — API lint 부채 분리 정리

- [ ] `apps/api/src/auth/auth.service.ts` Firestore `data()` 반환과 주소 흐름의 `any` 제거
- [ ] `apps/api/src/auth/auth.service.spec.ts` mock의 `any`를 타입 있는 테스트 더블로 전환
- [ ] 수정형 lint와 읽기 전용 lint를 `lint:fix` / `lint:check`로 분리할지 결정

### LOAD-TEST-FORMAL — 정식 부하테스트 재개 조건

- [ ] 실제 유입 증가·광고 확대·429/5xx·응답 지연 등 재개 트리거 정의 유지
- [ ] 정식 baseline 전 production과 분리된 staging DB 또는 동등 격리 환경 확보
- [ ] 환경별 k6 seed 대상과 테스트 계정 확정
- [ ] `baseline → launch → growth → spike → soak` 순서로 단계별 실행
- [ ] 기준 문서 `docs/specs/ops/k6-load-test-plan.md` 재검증 후 실행

### Seller/Admin 후속

- [ ] **ADMIN-STORES-T7** — 판매자 상세 드릴다운
  - store별 주문·정산 집계
  - 상세 라우트
  - 관리자 권한 경계
  - 목록 URL 복원
  - 별도 SDD 선행
- [ ] **ADMIN-STORES-T8** — 플랫폼 기본 수수료율 설정
  - 전역 config 모델
  - store override 우선순위
  - 소급 적용 여부
  - 검증 범위 확장
  - 별도 SDD 선행
- [ ] 준비 물량 탭에 공동구매 주문 포함 여부 재설계
- [ ] 정산 화면 잔여 육안 검증이 아직 필요하면 별도 UX 검증 Task로 재개

### Seller 성능/DX

- [ ] **PERF-01** — seller `<img>` → `next/image` 마이그레이션 재검토
  - onboarding 로고/이미지
  - 상품 이미지 업로드 썸네일
  - Firebase Storage remotePatterns·sizes·LCP 영향 확인

### Driver/배송 고도화

- [ ] Driver Kakao Maps SDK 연동 필요성 재평가 후 구현
- [ ] 밀크런 경로 프리뷰가 실제 운영에 필요해질 때 지도 경로 시각화
- [ ] 실시간 GPS 추적은 플랫폼형 드라이버 운영 전까지 보류

### 인프라 복원력

- [ ] Railway 단일 장애점 리스크 재평가
- [ ] 필요 시 Fly.io/Render 등 대체 backend contingency 비교
- [ ] 실제 운영 규모가 커질 때 hot-standby 필요성 결정

---

## LATER — 비즈니스 확장 트리거가 있을 때

### 다중 판매자 Phase 2

- [ ] active 상점 목록 API
- [ ] 상점 상세 API
- [ ] consumer 상점 목록·상세 화면
- [ ] 단일 상점 가정 제거 및 동적 `storeId` 전환
- [ ] 판매자 자체 가입 → 플랫폼 승인 플로우 설계

### 거점 배송 오픈

트리거: 실제 협력 업체 거점 계약 확정.

- [ ] 운영 거점 등록
- [ ] consumer 배송 수단에서 `hub` 노출 조건 활성화
- [ ] 운영 권한·픽업 절차 최종 검수
- [ ] 필요 시 QR 픽업 인증 고도화

### 거점 스태프 권한

트리거: 협력 업체 직원이 직접 픽업 처리해야 할 때.

- [ ] `hub_staff` 역할 설계
- [ ] hub↔staff 관계 모델
- [ ] 초대·온보딩 UI
- [ ] API 권한·hub 스코핑
- [ ] 전용 접근 경로와 감사 로그

### 외부 드라이버 정산

트리거: 판매자 본인이 아닌 외부 드라이버를 고용할 때.

- [ ] `driverSettlements` 모델 설계
- [ ] 건당/거리 기반 배송료 정책 결정
- [ ] 드라이버별 정산 API
- [ ] driver 앱 수익 요약
- [ ] admin 지급 처리
- [ ] 판매자 정산과 driver fee 관계 확정

### 플랫폼형 드라이버 모델

트리거: 불특정 다수 드라이버를 모집할 때.

- [ ] 신원·면허·보험 검증 체계
- [ ] 실시간 위치 수집
- [ ] 자동 배정 알고리즘
- [ ] 소비자 실시간 위치 노출
- [ ] 자동 정산·인센티브 정책

### 결제 수단 확장

- [ ] 카드 PG 추가 계약 필요성을 실제 사업 운영 기준으로 재평가
- [ ] 네이버페이 신규 출시 필요성을 현재 PortOne·사업 전략과 다시 비교한 뒤 별도 Task로 결정

---

## STALE_OR_SUPERSEDED — 실행 전 재검증 필수

다음 항목은 과거 Backlog에서는 미완료로 남았지만 현재 상태를 그대로 전제로 실행하면 안 된다.

### 네이버페이 “승인 메일 대기 / 채널키만 넣으면 즉시 활성화”

2026-04의 상태 문구다. 현재 파트너 승인·계약·PortOne 채널 설정·제품 전략을 다시 확인하지 않고 환경 변수부터 추가하지 않는다.

### BUG-03 — Firestore 공개 read와 Firebase Custom Token

과거 Rules·인증 구조를 전제로 한 항목이다. 이후 회차 E2E·Firebase 인증·Rules 변경이 많이 있었으므로 현재 코드와 Rules를 직접 감사한 뒤 살아 있는 결함일 때만 새 보안 Task로 등재한다.

### 운영 DB의 `reset-*` / `visual-settle-*` 시드 잔존

과거에는 정리 Task가 있었지만 이후 출시 진단에서 기존 reset·visual 검증 시드가 운영 상품·주문·정산 컬렉션에 남아 있지 않은 것으로 확인됐다. 새 증거 없이 삭제 스크립트를 실행하지 않는다.

### Railway 2026-05 Major Outage 당시 상태

당시 장애 원인·복구 기록은 `TROUBLESHOOTING`/결정 로그의 역사 자료다. 현재 Railway 장애로 간주하지 않는다. 단일 공급자 복원력 검토는 위 LATER 항목으로 별도 유지한다.

### 과거 PR #11 OPEN/Draft·병합 금지

PR #11은 2026-08-23 `MERGED`·`CLOSED` 됐다. 과거 PLAN·REPORT·PR 본문의 해당 표현은 역사 기록이며 현재 작업 지시가 아니다.

### 회차 알림 템플릿 8종 “미등록”

2026-08-23 provider 등록·심사 요청이 완료됐으므로 더 이상 유효하지 않다. 현재 상태는 8종 모두 `검수중`이다.

---

## DONE_HISTORY — 현재 판단에 필요한 마일스톤만

- 회차 직배송 MVP 구현 완료 및 PR #11을 통해 `main` 통합
- 통합 기준 SHA `e55f25914cc7d01576fbd4639583daaf0fe6385e`
- 카카오 비즈니스 채널 최종 승인
- consumer 법적 고지 production 반영 및 운영 검증
- ALIGO 발신 프로필 1건 등록·`senderkey` 발급
- 내부 논리 템플릿 코드↔ALIGO `tpl_code` 분리 및 필수 변수 검증 구현
- 회차 알림 템플릿 8종 provider 등록·심사 요청
- 운영 Firebase 인덱스·Firestore Rules·Storage Rules 출시 준비 반영
- 과거 전체 원격 회차 E2E 52건 + 양쪽 cleanup 성공 증거 확보

완료된 기능·보안·UX·세션별 수백 개 항목은 Git history와 `docs/CRITICAL_LOGIC.md`, `docs/archive/`, 관련 완료 PLAN·REPORT를 사용한다.

## 백로그 관리 원칙

1. 완료 항목을 장문 세션 로그로 이 문서에 계속 누적하지 않는다.
2. 현재 행동 가능한 미완료만 `ACTIVE/BLOCKED_EXTERNAL/NEXT/LATER`에 둔다.
3. 오래된 외부 상태는 날짜만 갱신하지 말고 실제 재조회 후 상태를 바꾼다.
4. 외부 운영 변경은 Backlog 체크박스만으로 승인된 것으로 보지 않는다.
5. 현재 출시 우선순위와 충돌하면 `docs/memory.md`와 활성 HANDOFF·PLAN을 우선한다.
6. 완료 이력 보존이 필요하면 Git history 또는 `docs/archive/`를 사용한다.
