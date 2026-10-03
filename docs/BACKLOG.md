<!-- Language: ko -->

# Greenhub Backlog

> 기준일: 2026-10-04 KST
>
> 현재 미완료·향후 작업만 관리한다. 완료 상세는 Git history, `docs/CRITICAL_LOGIC.md`, `docs/archive/`, 완료 PLAN·REPORT를 사용한다.
> 현재 프로젝트 상태(운영 배포·회차·외부 승인)는 [memory.md](memory.md)가 소유한다. 이 문서는 그 상태를 다시 적지 않는다.

## 분류 규칙

- **자동 진행 중(PR)**: 다른 작업자가 PR로 만들고 있다. 병합되면 완료 표로 옮긴다.
- **사람 결정 필요**: 정책·우선순위·도구 선택을 사람이 정해야 착수할 수 있다.
- **외부 게이트**: 외부 심사·운영 변경·실기기·실결제처럼 별도 승인이나 바깥 상태를 기다린다.
- **프런트(디자인 개편과 함께)**: 사용자가 디자인 개편과 함께 직접 챙기는 화면 작업이다.
- **LATER**: 파일럿을 막지 않는 후속 작업이다.

항목 ID는 다른 문서가 참조하므로 바꾸지 않는다.

---

## 자동 진행 중(PR)

### API-SPEC-TYPES-BIOME-CLEANUP
- API spec 타입 오류와 biome forEach 반환값 오류 정리. PR #387. `API-LINT-BASELINE`의 spec mock 타입 부분을 맡는다.

### DRIVER-TEST-LINT-REPAIR
- 기사 앱 테스트 명령·`noUnsafeFinally` 린트 고장 수리. PR #388.

### CONSUMER-STALE-TESTS-REPAIR
- 소비자 앱의 낡은 테스트 23건 수리. 진행 중(PR 예정).

### ADMIN-INVITE-REVOKE-BACKEND
- 어드민 초대 토큰 취소 백엔드(invite T0+T4: revoke API + 가입 거부 가드). 진행 중(PR 예정). 화면(T5~T7)은 프런트 절.

### ADMIN-SETTLEMENTS-STATUS-FILTER-BACKEND
- 어드민 정산 status 필터 백엔드(settlements T4b). 진행 중(PR 예정). 필요한 복합 인덱스는 `firestore.indexes.json`에 있으며 운영 배포 확인은 외부 게이트 `SETTLEMENT-STATUS-INDEX-DEPLOY`.

### ADMIN-DRIVERS-SERVER-FILTER
- 어드민 기사 탭 서버 status 필터(drivers T1/S1). 진행 중(PR 예정).

---

## 사람 결정 필요

### AUTH-LOGOUT-SERVER-REVOCATION
- 세 앱 Auth.js 로그아웃이 API `POST /auth/logout`을 부르지 않아 서버 `refreshTokens/{sub}`가 남는다(앱 코드에 호출 없음). 로그아웃 전에 복사된 쿠키가 refresh 만료(30일)까지 재사용될 수 있다.
- 2026-09-28 결정(D2)으로 출시 후 과제. 사용자당 refresh 문서가 1개라 같은 계정의 다른 기기도 함께 로그아웃되는 영향을 설계에서 정한다. 계약: `docs/specs/api/auth.md`.

### API-LINT-BASELINE
- API `lint`는 eslint(`apps/api/package.json`)이고 기존 오류가 대량(사전 조사 1951건)이다. auth `any` 정리와 lint 명령 분리 전에 eslint 유지/biome 전환을 정한다. spec 타입 부분은 PR #387.

### AUTH-SIGNOUT-SESSION-RESURRECTION-FLAKE
- 원격 E2E에서 로그아웃 직후 `/api/auth/session`이 세션을 돌려준 실패가 두 번 있었다(run `37108803974` mobile seller, run `37111848578` chromium driver, 재실행 통과). 로그아웃 순간 다른 요청이 갱신 쿠키를 다시 써 넣는 경쟁으로 추정(#333 관련 가능). 로컬 재현 조사 착수 여부를 정한다.

### EXACT-PREVIEW-WORKFLOW-CREDENTIALS
- `create-exact-preview-deployment.yml`은 앱별 Vercel 토큰 미등록으로 성공한 적이 없다. 지금은 로컬 Vercel CLI로 `preview-exact/<scope>/<sha>` ref를 만든다. 워크플로 경로로 옮길지 정한다.

### LOCAL-DEV-FULLSTACK
- 새 런처(`dev-local.bat` → `scripts/dev/local/launcher.mjs`)는 있다. 남은 것: 예전 `dev.bat`(프런트 3개만 띄움)을 지울지 유지할지.

### KAKAO-API-OUTAGE-MESSAGE
- 카카오 API 장애 때 사용자 문구를 "로그인 실패"로 통일할지 "외부 인증 장애"로 나눌지 정한다. 출처: `docs/plans/PLAN_kakao-auth-hardening-loadtest-handoff.md`.

### LEGAL-SALES-FINAL
- 공개 문서는 2026-08-30 실제 사용 정합화본이 운영에 나가 있다. 남은 것: 법률 자문 판단, 회원 탈퇴 API, 카카오 연결 해제 webhook, 일반 컬렉션 자동 만료 삭제. 소유: `docs/specs/legal/README.md`.

### PILOT-GO-AND-ROLLBACK-DRILL
- 파일럿 최종 GO 판정, rollback dry-run, 초기 두 회차 모니터링·Closeout. 롤백 명령과 대상은 memory.md 5절.

### ADMIN-STORES-T7
- 어드민 판매자 T7 상세 드릴다운·T8 기본 수수료 설정. 둘 다 별도 SDD 선결(집계 범위·권한, 판매자별 수수료와의 우선순위·소급). `docs/specs/frontend/admin/admin-tab-stores-plan.md`.

### ADMIN-SETTLEMENTS-BULK-PAY
- 어드민 정산 일괄 지급(F2). SDD-2(반복 처리 vs batch write) 결정이 선결. `admin-tab-settlements-plan.md`.

### ADMIN-USERS-LIMIT-AND-AUDIT
- 어드민 손님 목록 `limit` 값(S4, 운영 사용자 수 확인 뒤)과 별도 SDD 항목(F3·F5) 범위. `admin-tab-users-plan.md`.

### Driver/배송
- Kakao Maps·밀크런 preview 재평가, 플랫폼형 전 GPS 보류.

### 인프라/확장
- Railway contingency, 다중 판매자, hub_staff, 외부 driver 정산, 결제수단 확장.

---

## 외부 게이트

### ALIGO-SMS-SENDER-SWITCH
- 문자(SMS fallback)는 개인 번호 차단으로 실패했다. 사업자 번호 ALIGO 발신번호 심사 승인 → `ALIGO_SENDER_PHONE` 교체 → 격리 환경 알림톡·문자·fallback 재시험. 승인 전에 바꾸면 알림톡도 실패한다. 현재 심사 상태는 memory.md.

### PILOT-START
- 파일럿 운영 시작 2026-11-01(첫 회차 주문 10:00 자동 오픈). 시작 직후 실제 결제 → 접수 알림톡 → 소비자 취소·환불 → 취소 알림톡 1건으로 운영 PortOne 경로를 확인한다.

### NEXT-PRODUCTION-DEPLOY
- 2026-10-04 아침 배포(`f259b433`) 뒤 병합된 #383(API·seller), #386(seller)이 운영 미반영. 같은 SHA exact Preview 원격 E2E 뒤 API → 프런트 순서로 배포한다(승인 필요).

### PILOT-DRIVER-ACCOUNT
- 파일럿 기사 계정을 관리자 계정과 다른 카카오 계정으로 가입·승인해 둔다(기사 앱은 기사 역할만 허용, #381).

### SETTLEMENT-STATUS-INDEX-DEPLOY
- 정산 status 필터용 복합 인덱스(`status+settledAt`, `storeId+status+settledAt`)의 운영 Firestore 반영 확인. `ADMIN-SETTLEMENTS-STATUS-FILTER-BACKEND` 배포 전에 필요.

### BANNER-MULTI-DATA-MIGRATION
- 다중 배너 모델로 갈 때 운영 `banners/main_hero` 데이터 이전(Firestore 백업 확인 후 사람이 실행). `docs/specs/frontend/admin/admin-banner-multi-sdd.md` 3.7.3.

### LOAD-TEST-FORMAL
- staging 또는 동등 환경, 재개 트리거, baseline → soak, k6 plan. `docs/specs/ops/k6-load-test-plan.md`.

### PREVIEW-GENERIC-ENV-ALIGNMENT
- 브랜치 미지정 Preview env에서 판매자 앱이 API=스테이징, Firebase=운영(`green-e4fe3`)으로 어긋나 Firebase 클라이언트 로그인이 실패한다. 세 앱의 해당 Firebase 설정을 비운영 프로젝트로 분리할지 정하고 Vercel env를 바꾼다.

### LEGACY-E2E-WORKFLOW-VARS
- 일반 E2E `e2e.yml`이 저장소 수준 `vars.ROUND_DIRECT_E2E_*`를 읽지만 값이 `round-direct-e2e` 환경에만 있어 매번 실패한다. legacy 판매 재도입 전에 설정 출처를 고치고 legacy 흐름을 새 코드로 검증한다.

---

## 프런트(디자인 개편과 함께)

### ADMIN-TABS-UI-REMAINING
- 어드민 탭 화면 잔여. 탭별 현황표: [admin-tabs-improve-plan.md](specs/frontend/admin-tabs-improve-plan.md).
  - orders: T4 스토어 Select, T5 새로고침·폴링, T6 `prompt` → 모달, T7 e2e
  - settlements: T3 툴팁, T5 status 탭(T4b 뒤), T6 DatePicker(셀러 #CL-56 T2 뒤), T7 새로고침
  - drivers: T2 타입·`!!suspended`, S3 e2e, T3 가입일·T4 검색·T5 새로고침
  - users: S3 검색·상태 필터, S5 e2e
  - invite: T2 발급일·사용일, T5~T7 취소 버튼·'취소됨' 상태, T8'·T9' 검색, T10~T12 e2e
  - banner: T2 CTA 검증, T5a 업로드 가드, T6 CTA 반응형, 다중 배너 SDD S4~S7

### BRAND-APP-ICON-REDESIGN
- 앱 아이콘 상징(두 잎 하트)은 임시안이다. 로고(Nunito "Green Love")와 앱별 구성은 확정. 원본 `packages/ui/brand/`, 기준 `docs/specs/frontend/design-standard.md` §7.

### REAL-DEVICE-CHECKS
- 실기기 확인: 카카오톡 인앱 브라우저·iOS·Android 결제, 기사 배송 사진 업로드, 지도 링크.

### PILOT-FRONTEND-REVIEW
- 2026-11-01 전 세 앱 프런트 점검.

### CONSUMER-BIOME-WARNINGS
- consumer biome 경고 `noArrayIndexKey`·`noImgElement`(`biome.json`에서 warn) 정리.

---

## LATER

### DRIVER-SELLER-PHONE-BEFORE-PICKUP
- 기사 IA는 수거 전 판매자 연락처를 보이지만 코드·테스트는 미배정 주문의 `sellerPhone`을 숨긴다. 2026-10-04 결정: 파일럿 동안 숨김 유지. 외부 기사를 쓰기 시작할 때 노출 범위를 정하고 IA 또는 테스트를 맞춘다.

### ROUND-PAYMENT-RETRY-DOUBLE-HOLD
- 결제창을 닫고 새 시도로 다시 결제하면 이전 시도의 `PENDING` 주문·`HELD` 예약이 최대 약 16분 한도를 함께 차지한다. 2026-10-04 결정: 파일럿 동안 유지. 오픈 날 '한도 마감'이 비정상적으로 빨리 나오면 우선 대응한다.

### Seller/Admin
- 준비 물량 공동구매 재설계, 필요 시 정산 UX.

### MARKETING-REENABLE
- 향후 마케팅을 다시 켤 때만 동의·철회·보관·법무·provider 증거를 현재 권위로 재검증하고 별도 승인 Task로 범위를 정한다. 현재 Pilot 정책은 `MARKETING_NOT_USED_IN_PILOT`.

### RETENTION-LEGACY-STOREID
- `storeId`가 없는 옛 배송 사진 보관 기록은 store 운영 목록에 안 보일 수 있다. 필요하면 migration·visibility Task로 다룬다.

---

## 최근 완료 확인(2026-10-04)

코드·테스트·memory.md로 확인했다. 상세는 Git history와 근거 파일을 본다.

| 항목 | 근거 |
|---|---|
| `PAYMENT-FINALIZATION-PAID-GUARD` | `apps/api/src/payments/payment-finalization.service.ts` 비`PAID` 반환, `payments.service.spec.ts` |
| `PAYMENT-WEBHOOK-SIGNATURE-COVERAGE` | `apps/api/src/payments/portone-webhook-boundary.spec.ts` |
| `ORDER-REDELIVERY-PAID-RESUME-GATE` | `apps/api/src/orders/redelivery-resume-gate.ts` + spec 8건 |
| `ADMIN-FORCE-REFUND-CONSISTENCY` | `apps/api/src/admin/admin.service.ts` `forceRefund`, `apps/api/test/admin-force-refund.e2e-spec.ts` |
| `ADMIN-PRIVILEGED-MUTATION-COVERAGE` | `apps/api/src/admin/admin-privileged-mutation.spec.ts` |
| `SETTLEMENT-LIFECYCLE-COVERAGE` | `apps/api/src/settlements/settlements-lifecycle.spec.ts` |
| `ORDER-MUTATION-AUTHORIZATION-COVERAGE` | `apps/api/src/orders/order-mutation-authorization.spec.ts` |
| `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION` | `firestore.rules` orders read는 seller·admin만, 기사는 API |
| `AUTH-DRIVER-APPROVAL-AND-SESSION-REVOCATION`, `AUTH-SESSION-CLAIM-REVOCATION` | `apps/api/src/auth/auth.service.ts` refresh·`getSession` authoritative 재조회, `auth.service.spec.ts`, D2 즉시 철회. 남은 것은 `AUTH-LOGOUT-SERVER-REVOCATION` |
| `MARKETING-CONSENT-LIFECYCLE-CONSISTENCY`, Pilot marketing 문서 정합(DOC_DELTA) | Pilot 미사용으로 대체 종결: `round-order-create.service.ts` `marketingConsent` 거부, MY 설정 안내, `docs/specs/legal/README.md`, `apps/consumer/src/app/privacy/page.tsx` |
| `DEPLOY-SAFETY-MAIN-PROTECTION` | Issue #32 `CLOSED`, main 보호(memory.md) |
| `SALE-ROUND-STATE-ATOMICITY-AND-RECOVERY` | #66 proof, #70 병합 |
| Auth.js 세션 런타임 | Preview run `36341189483` `auth-session-lifecycle.spec.ts` 12건 |
| Consumer self-cancel `ORDER_CANCELLED` | #310, `docs/specs/api/notifications.md` |
| 출시 체크리스트(release SHA·E2E·운영 배포·activation) | memory.md 5절: 2026-09-28 `197f84a4` 배포, 2026-09-29 `round_direct` 전환 |
| ALIGO 템플릿 승인·code 1:1·운영 반영·격리 알림톡 | memory.md ALIGO 상태(2026-09-28) |
| 카카오 비즈니스 채널 승인 | memory.md 제품 현재 상태 |
| `RETENTION-DELETE-ISSUE-ROUTING` | `apps/api/src/retention/delivery-photo-store-routing.spec.ts`, `retention.service.spec.ts` |
| 보관 기록 정기 파기 | `apps/api/src/retention/retention.service.ts` `@Cron('0 3 * * *')` |
| 카카오 토큰 서버 검증 | `apps/api/src/auth/kakao.client.ts` `/v2/user/me` 조회, `kakao.client.spec.ts` |
| `OPERATION-ACTION-CLAIM-FENCING` | `apps/api/src/operations/operations-action-claim-lease-expiry.spec.ts`, `operations-action-claim-occ-retry.spec.ts` |
| `LEGACY-GROUP-CANCEL-NOTIFICATION` | `apps/api/src/notifications/legacy-group-cancel-notification.spec.ts` |
| `NOTIFICATION-RETRY-POLICY` | `notification-retry-policy.spec.ts`, `notification-retry-metrics.spec.ts` |
| `SELLER-SETTLEMENT-KST` | #320, `apps/seller/src/app/settlements/_lib.test.ts` |
| `SELLER-ORDER-LIST-BUYER-INFO` | #314(상세), #383(목록 이름·통합 검색) |
| `ADMIN-CANCELLED-REFUND-RETRY` | 2026-10-04 결정으로 만들지 않음(#384). 기존 복구 경로 `RETRY_REFUND` 유지 |
| `ADMIN-DESKTOP-TABLE-IN-480-SHELL` | #354, `apps/seller/src/components/AppShell.test.ts` |
| `DRIVER-MANTINE-CSS-AUDIT` | 2026-10-03 세 앱 import 대조 |
| `HOME-BANNER-OVERLAP-AND-LEGACY-CTA` | #365, #367, 운영 배너 `isActive:false`(memory.md 5절) |
| `ADMIN-TAB-PLANS-STALE-PROGRESS` | 이 정합화로 어드민 탭 계획 진행표 갱신 |

---

## STALE_OR_SUPERSEDED

다음 전제는 현재 상태 재검증 전 실행하지 않는다.

- 네이버페이 과거 승인 대기, 과거 BUG-03 공개 read/Custom Token 가정
- 운영 DB reset/visual cleanup 지시, 2026-05 Railway outage 상태
- PR #11 OPEN/Draft, ALIGO 8종 "미등록" 표현
- `main` merge가 auto-production이어야 한다는 전제

## 관리 원칙

1. 미완료만 유지한다. 완료는 위 표에 한 줄만 남기고 다음 정리 때 지운다.
2. 현재 상태는 memory.md에 두고 여기서는 링크만 한다.
3. 외부 상태는 직접 재조회 뒤 갱신한다. 체크 표시는 운영 승인이 아니다.
4. 우선순위가 충돌하면 memory.md와 활성 HANDOFF·PLAN이 우선한다.
5. 저장소 변경은 branch+PR, `VERIFIED` 승격은 `docs/DOCUMENT_CONSISTENCY.md` 기준.
