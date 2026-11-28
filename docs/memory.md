<!-- Language: ko -->

# 프로젝트 현재 상태

> 현재 작업 판단에 필요한 최소 상태만 유지한다. 상세 Acceptance Criteria는 `docs/BACKLOG.md`와 current spec을 사용한다.
>
> 2026-11-28 이전 snapshot(S2 → R1 종료, #63·#71 기준선, Release 이전 운영 배포 이력, 지난 E2E run, 10월 배포 뒤 상세)은 [memory 아카이브](archive/memory_archive_20261128.md)에 있다. 역사 기록이며 현재 지시가 아니다.

## 검증 기준

- 2026-11-28 KST 저장소 기록(코드·설정·BACKLOG·spec)으로 다시 정리했다. GitHub 설정·Railway·Vercel·PortOne·ALIGO 콘솔은 이때 직접 재조회하지 않았다.
- Vercel 배포 안전·exact-source Preview: 역사적 증거 snapshot; 현재 release proof로 재사용하지 않는다.
- ALIGO provider current metadata: 콘솔 기준 템플릿 8종 `VERIFIED`(2026-09-28), 운영 컨테이너의 API 대조도 2026-09-28 일치 — 아래 ALIGO 상태 참고.
- 운영 상태 변경은 별도 승인 없이 수행하지 않는다.

## Git·배포 기준선

- 저장소: `booker-lab/greenhub`. 기본 브랜치 `main`; HEAD는 작업 시작 시 직접 재조회한다.
- `main` 보호: PR 필수, 최신 `main` 반영(strict), force-push·삭제 차단. 필수 검사의 마지막 기록은 2026-10-24 BACKLOG `CI-REQUIRED-CHECK`의 5개 — `verify`(`deployment-safety.yml`)와 `lint · typecheck`·`unit tests`·`Firebase rules (emulator)`·`build`(`ci.yml` job 이름)다. `ci.yml`의 `ci-ok`는 필수 검사를 이 job 하나로 등록하려고 만든 집계 job이지만, GitHub 설정을 `ci-ok`로 바꿨다는 기록은 없다. 현재 값은 GitHub에서 직접 재조회한다.
- 세 프런트 `apps/{consumer,seller,driver}/vercel.json`은 모두 `git.deploymentEnabled: false`라 어느 브랜치 push도 Vercel 배포를 만들지 않는다. 앱 변경이 없는 SHA(문서만 바뀐 경우 포함)는 `scripts/vercel/ignore-build.mjs`가 빌드를 생략한다.
- `AGENTS.md`와 deployment safety CI(`verify`)가 branch+PR 원칙을 소유한다.

`main` merge는 production 배포 승인이 아니다. production은 검증된 exact release SHA + 별도 사용자 승인으로만 한다(아래 `다음 작업`의 운영 배포 순서).

## 제품 현재 상태

- 회차 직배송 MVP는 `main` 통합 완료. consumer 구매, seller 회차·주문, driver 직배송, 결제·환불·재배송비·보류·사진·운영 예외 흐름이 있다.
- 카카오 비즈니스 채널 승인 완료. ALIGO 템플릿·실발송 상태는 아래 `ALIGO 상태`.
- 운영 배포 `DONE`(2026-09-28 출시 SHA `197f84a4`), activation `DONE`(2026-09-29 사용자 승인으로 디어 오키드 `salesMode`를 `legacy → round_direct`로 전환). **현재 운영 SHA와 배포 이력은 GitHub Release(Latest, tag `prod-<KST 날짜>-<SHA 8자리>`, 범위 `all`)가 소유한다.**
- 첫 회차(`e8ca686f-a9db-4c6b-8ebf-2bf190351a3c`) 상태: **2026-11-28 기준 저장소 기록으로는 확인할 수 없다.** 마지막 기록은 2026-10-28 일정 변경("12월 1일 배송 회차", 주문 11/22(일) 10:00 자동 오픈, BACKLOG `PORTONE-CHANNEL-CHECK`)과 2026-10-30 "첫 회차를 UI 교체가 끝난 뒤로 미룬다" 사용자 결정(아래 8절)이다. 10/30 결정 뒤 회차 일정을 실제로 옮겼는지, 11/22에 주문이 열렸는지는 기록이 없어 사용자 확인이 필요하다. `SCHEDULED` 회차는 `orderOpenAt`이 지나면 저장값과 상관없이 `OPEN`으로 계산된다(`apps/api/src/sale-rounds/sale-round-state.contract.ts` `resolveAutomaticState`).
- 결제 채널: 2026-10-30 기록으로 운영 consumer의 카카오페이·카드 채널 키는 모두 TEST이고 LIVE 채널이 없다. 상점·채널 확인 PR(#426 → #540을 대체한 #829, 초안)도 LIVE 채널이 생길 때까지 병합 보류다. 이 상태로 회차가 열리면 TEST 채널 결제로 주문이 확정된다. 진행 상황과 순서는 BACKLOG `PORTONE-CHANNEL-CHECK`가 소유한다.
- 파일럿 준비: 파일럿용 기사 계정은 2026-10-31 사업자 휴대폰으로 기사 가입 → 관리자 승인 → 기사 앱 로그인까지 마쳤다(사용자 확인. 기사 앱은 기사 역할만 허용하므로 관리자 계정과 다른 계정이다, #381). 디어 오키드 매장 판매자 연결은 BACKLOG `DEAR-ORCHID-STORE-OWNER-LINK`.
- live round 주문, 실제 결제·환불, first-round completion은 저장소에 완료 기록이 없다(BACKLOG `상태 구분`·`NEXT` `외부·권한 gate`).

## 현재 release residual

> #63 accepted classification을 현재 release 문서의 기준으로 사용한다. 아래 상태는 implementation, verification, external/runtime, authority, product policy, docs delta를 서로 합치지 않는다. 1~5절의 2026-11-28 이전 원문은 아카이브에 있다.

### 1. Sale-round state atomicity and recovery

`IMPLEMENTATION_PROVEN` + `PUBLISHED` — #66이 구현 proof를 accepted했고 PR #70으로 merge됐다. 이 proof만으로 production deployment·activation·live round·actual payment/notification을 주장하지 않는다. 상세는 BACKLOG `IMPLEMENTED / PUBLISHED`.

### 2. Preview·exact-SHA proof

출시 SHA의 증거는 그 SHA로 다시 돌린 원격 회차 E2E run만 인정한다. `production-deploy.yml`은 같은 SHA로 통과한 `Round direct E2E` run ID(`e2e_run_id`)를 입력으로 받아 `production-deploy.mjs verify-e2e`로 확인한 뒤에만 배포한다. 절차는 `docs/specs/ops/mvp-sales-round-e2e-environment.md` §2, 판정 기준은 아래 `검증 상태`.

### 3. Auth.js session runtime

`RUNTIME_PROVEN`(Preview, 2026-09-28 run `36341189483`, `apps/e2e/tests/auth-session-lifecycle.spec.ts` 12건)이고 이후 회차 E2E가 이 12건을 함께 돈다. revocation window 계약은 `docs/specs/api/auth.md`, 남은 일은 BACKLOG `AUTH-LOGOUT-SERVER-REVOCATION`·`AUTH-SIGNOUT-SESSION-RESURRECTION-FLAKE`.

4절 ALIGO provider metadata는 아래 `ALIGO 상태`로 합쳤다.

### 5. Production activation

상태: production deployment `DONE`(2026-09-28) / activation `DONE`(2026-09-29) / live round·실제 결제: 위 `제품 현재 상태`의 첫 회차 항목.

GitHub Release가 생기기 전(2026-09-28 ~ 2026-10-24) 운영 배포 이력 — 배포 ID·되돌리기 대상·배포 뒤 확인·activation 기록 — 은 [`docs/archive/memory_archive_20261128.md`](archive/memory_archive_20261128.md)의 `5. Production activation`으로 옮겼다. 그 뒤 이력과 현재 운영 SHA는 `production-deploy.yml`의 `record` job이 배포마다 남기는 GitHub Release를 따른다. 되돌리기·비상 신규 주문 중단은 `docs/specs/ops/mvp-sales-round-runbook.md` §7을 따른다(2026-11-10 결정: 회차 마감·취소로 멈추고, `legacy` 전환은 비상 수단이 아니다 — §7.2·§7.4).

6절(소비자 직접 취소 `ORDER_CANCELLED`, `RESOLVED`)·7절(Pilot marketing wording, `VERIFIED`)은 닫혀 뺐다. 정본은 BACKLOG `Consumer self-cancel ORDER_CANCELLED notification`·DOC_DELTA `Pilot marketing contract`와 `docs/specs/api/notifications.md`다.

### 8. UI 교체 동결 (Mantine → shadcn/ui)

상태: `open` — 2026-11-01 사용자 결정으로 소비자 동결(`consumer-freeze`)을 풀었다(카카오페이 심사·LIVE 결제·실결제 확인 전이지만 소비자 교체 병합 진행). 2026-10-30 결정과 구간 규칙은 `docs/specs/frontend/ui-stack-migration-plan.md` §8.

도구: 상태 파일 `docs/release/ui-migration-freeze.json`을 `scripts/release/freeze-guard.mjs`가 읽고, PR CI `UI 교체 동결` job(`ci-ok`에 포함)과 `production-deploy.yml`의 "UI 교체 동결 확인"이 쓴다. 소비자 동결 때 막는 공용 파일은 `packages/ui/src/styles/base.css`다(P6에서 `theme.ts`를 지우고 `style.css`를 옮겼다).

병합은 배포가 아니다. 소비자 화면이 바뀐 SHA를 운영에 낼 때는 배포 승인 전에 그 사실을 알린다. 다음 회차 일정을 잡으면 그 회차 기준으로 `pre-candidate`·`candidate`를 다시 쓴다(계획 §8 "회차 기준 동결").

## ALIGO 상태

- repository logical 8-code contract `VERIFIED`(#65). provider 템플릿 UK_5691~5698은 2026-09-28 콘솔에서 코드·이름·승인완료·본문·변수가 저장소 계약과 일치했고, 채널 `@greenlove` 정상, 버튼 없음, 템플릿 대체문자 `발송안함`이다(SMS fallback은 코드가 따로 한다). 2026-08-27 승인 증거: `docs/reports/REPORT_aligo_template_approval_20260827.md`.
- production mapping: Railway production 변수 `ALIGO_TEMPLATE_CODES_JSON`이 8종을 올바른 코드로 매핑하고, 2026-09-28 출시 배포로 운영 API 프로세스에 반영됐다.
- 운영 송신 IP: ALIGO는 등록 IP만 허용하고 Railway 송신 IP는 재배포로 바뀐다(`152.55.176.19` → `152.55.177.34`). 그래서 ALIGO 호출은 Fixie 고정 IP 프록시(`ALIGO_OUTBOUND_PROXY_URL`)의 고정 IP 2개를 거치며, 두 IP를 ALIGO 허용 IP에 등록했다(2026-09-28, 조회 `code=0`). **Railway Pro 전환 시에는 고정 IP 3개를 먼저 ALIGO에 추가 등록한 뒤 `ALIGO_OUTBOUND_PROXY_URL`을 삭제한다.** Cloud Run 전환 때 Fixie를 없애는 순서는 `docs/specs/ops/api-hosting-cloud-run-plan.md`.
- 실발송: 알림톡은 2026-09-28 격리 시험(`ORDER_PREPARING`, 가짜 주문번호 `TEST-0928`)에서 휴대폰 도착(첫 시도는 선불 잔액 부족으로 거부, 충전 뒤 성공). 문자는 개인 번호 발신이 통신사 번호도용 문자차단에 막혀, 2026-10-08 운영 `ALIGO_SENDER_PHONE`을 ALIGO 승인된 사업자 번호(끝 2104)로 바꾼 뒤 `TEST-1008`·`TEST-1008-SMS`가 모두 실수신됐다(사용자 확인). 알림톡 실패 뒤 문자로 넘어가는 자동 fallback은 운영에서 재현하지 않았다(코드 회귀만, BACKLOG `NEXT` `외부·권한 gate`).
- 실제 발송과 production ALIGO 설정 변경은 별도 승인 없이 하지 않는다.

## 판매 활성화 legal 상태

- 공개 `/privacy`·`/terms`의 판과 개정 이력은 `docs/specs/legal/README.md` `변경 이력`이 소유한다. 2026-11-28 기준 기록: `/privacy`는 2026-11-08 시행판 뒤 2026-11-28 시행 개정판을 작성했고, `/terms`는 2026-11-01 시행판이다. 어느 판이 운영에 나가 있는지는 Latest Release SHA로 확인한다.
- 통신판매업 신고는 2026-10-21 끝났다(footer #668). 남은 법무 정합성 일은 BACKLOG `법무·출시 후보 정합성`.
- Pilot marketing policy는 `MARKETING_NOT_USED_IN_PILOT`이다. broad read를 legal 문구로 정당화하지 않는다.

## 검증 상태

- 원격 회차 E2E 판정 기준은 #447부터 64건(소비자·셀러·드라이버 32건 × chromium·mobile) + 세션 수명주기 12건이다. 셀러 상품 등록·수정·삭제(`seller-product-lifecycle`)는 원격 Preview에서 통과할 수 없어 뺐다(BACKLOG `SELLER-PRODUCT-E2E-REMOTE-FIREBASE`).
- 최근 run은 GitHub Actions `Round direct E2E` 기록과 각 Release의 E2E run이 소유한다. 2026-11-22 기록: #876 뒤 원격 회차 E2E 3회(run `44932901485`·`44934378626`·`44936097221`)가 세션 12건을 재실행 없이 통과했고, 로그아웃 경쟁 상태의 남은 틈은 BACKLOG `AUTH-SIGNOUT-SESSION-RESURRECTION-FLAKE`가 소유한다.
- 운영 배포 대기: 현재 운영 SHA(Latest Release) 뒤 `main`에 병합된 변경은 원격 회차 E2E로 판정하지 않았고 운영에 나가지 않았다(`git log <운영 SHA>..origin/main`). 운영에 나갈 SHA가 바뀌면 그 SHA로 다시 판정한다.
- 과거 run을 현재 release 증거로 확장하지 않는다. 2026-10-10 결제·인증·규칙 재대조의 남은 일 가운데 열린 것은 BACKLOG `PORTONE-CHANNEL-CHECK`·`STORAGE-CORS-APPLY`다(`docs/reports/REPORT_payments_auth_rules_reaudit_20261010.md`).

## 활성 문서

- 라우팅: `docs/README.md`
- 정합성 기준: `docs/DOCUMENT_CONSISTENCY.md`
- 작업 규칙: `AGENTS.md`
- Context router: `docs/PROJECT_MAP.md`
- 상태 SSOT: 이 문서
- 미완료: `docs/BACKLOG.md`
- 재개 지점: 이 문서의 `다음 작업`
- 역사 자료(현재 지시 아님): `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`, `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`(2026-09-05 snapshot), `docs/archive/memory_archive_20261128.md`(이 문서의 2026-11-28 이전 기록)
- 배포 안전: `docs/plans/PLAN_deployment_safety_guards_20260823.md`
- legal gate: `docs/specs/legal/README.md`

## 승인 경계

명시적 승인 없이 ALIGO 실제 발송/설정, production 환경변수·Firebase·운영 데이터 변경, Railway/Vercel production 배포·rollback, 운영 회차/`salesMode`, 실제 결제·환불을 실행하지 않는다.

## 다음 작업

1. 첫 회차 상태 확인(사용자): 위 `제품 현재 상태`의 첫 회차 기록이 2026-10-30에서 끊겨 있다. 실제 운영 회차 일정·상태와 PortOne LIVE 채널 진행을 확인해 BACKLOG `PORTONE-CHANNEL-CHECK`에 적는다. 파일럿 시작 직후 실결제 1건 시험(결제 → 접수 알림톡 → 소비자 취소·환불 → 취소 알림톡)은 같은 항목과 BACKLOG `NEXT` `외부·권한 gate`가 소유한다.
2. **운영 Railway 변수를 바꾸면 검증된 SHA로 곧바로 다시 배포하거나 운영 배포와 함께 넣는다.** 2026-10-08 변수 변경이 Railway 재배포를 일으켜 검증 안 된 `main` HEAD가 나갔고, 곧바로 검증 SHA `f259b433`으로 다시 배포했다.
3. 운영 배포 순서: 검증된 SHA를 지정해 `.github/workflows/production-deploy.yml`로 한다(사용자가 채팅에서 SHA를 지정해 승인한 뒤 dispatch). 같은 SHA 회차 E2E run 확인 → Firestore 인덱스(READY 대기) → API(Railway 또는 Cloud Run, `/health` commit 확인) → 프런트 3개 → Firestore·Storage 규칙 → `post-deploy-smoke`를 한 번에 하고, `scope`로 일부만 다시 할 수 있다. Railway UI "Deploy"는 `main` HEAD를 배포하므로 병합 후 미검증 코드가 나갈 수 있다.
   - 배포 전 `node scripts/release/pre-deploy-check.mjs`(읽기 전용)는 workflow에 없어 따로 돌린다. 새 복합 인덱스가 READY가 아니면 그 쿼리를 쓰는 API가 실패하고, 규칙이 새 쿼리 조건을 요구하면(예: #469 `dailyCaps` 목록 조회 limit) 그 조건을 보내는 프런트가 규칙보다 먼저 나가야 한다(2026-10-13 `bd159830`에 적용한 원칙).
4. 열린 사용자·운영 작업은 BACKLOG가 소유한다: `PORTONE-CHANNEL-CHECK`, `STORAGE-CORS-APPLY`(`cors.json` 미적용), `DEAR-ORCHID-OWNER-PHONE`, `CONSUMER-UX-AUDIT-FOLLOWUPS`(C-01 실기기), 첫 실회차 전 비상 신규 주문 중단 준비(`NEXT` `외부·권한 gate`).
5. 배포 뒤 확인 기록이 없는 항목(사용자, 운영 읽기 전용, 2026-10-13 배포분):
   - `bd159830`: 첫 cron 실행 때 운영 Firestore에 `jobLeases` 문서 2개가 생겼는지(#491, 일일 운영 요약·보관 파기를 하루 1회로 제한. 아침 운영 요약 자체는 2026-10-24 도착, BACKLOG `OPS-ALERTING`). 상품 문구 생성이 `@google/genai` SDK로 바뀌었으므로(#493) 판매자 앱에서 한 번 생성해 실제 응답을 보고, Railway 운영 변수에 `GOOGLE_GEMINI_BASE_URL`이 없는지 본다(SDK가 이 값을 읽으면 호출 주소가 바뀐다).
   - `098affbc`: Railway HTTP 로그의 요청자 IP가 실제 클라이언트 IP인지 1회(#404), 판매자·기사 앱 firebase-token 정상(#488), 판매자 앱 운영 기록 해결·초대 화면(#510·#512), 소비자 상품 상세 `/products/<id>`(`?round=` 포함)와 링크 미리보기 메타데이터(#509).
   - `032b221a`: 판매자 앱 관리자 초대 화면에서 이메일 입력 후 발급(#518).
   - 선택 환경 변수 `KAKAO_APP_ID`의 운영 설정 여부(없으면 카카오 토큰 앱 확인을 건너뛰고 경고 로그, `apps/api/src/auth/kakao.client.ts`).
   - `OPS_TELEGRAM_BOT_TOKEN`·`OPS_TELEGRAM_CHAT_ID`는 미확인이 아니다. 2026-10-24 Railway 운영과 GitHub Actions 비밀값에 넣었고 같은 날 08:30 KST 아침 운영 요약이 텔레그램에 실제로 도착했다(BACKLOG `OPS-ALERTING`).
