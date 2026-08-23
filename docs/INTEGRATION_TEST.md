<!-- Language: ko -->

# Greenhub — 통합 검증 진입점

> 이 문서는 오래된 수동 시나리오 기록이 아니라 **현재 저장소에서 통합 검증을 시작할 안전한 진입점**만 제공한다. 실제 검증 범위와 환경은 대상 Task의 spec·PLAN·HANDOFF를 우선한다.

## 원칙

- 테스트용 비밀번호·토큰·서비스 계정 원문을 문서에 기록하지 않는다.
- 운영 Firestore 문서를 콘솔에서 수동으로 바꿔 통합 테스트하지 않는다.
- 운영 결제·환불·알림 발송·주문 상태 변경을 단순 검증 목적으로 실행하지 않는다.
- seed·cleanup·deploy·migration·실제 발송은 대상 환경과 승인 경계를 먼저 확인한다.
- 과거에 체크된 배포 완료 상태를 현재 상태 증거로 재사용하지 않는다.
- 현재 전체 회귀 기준은 `apps/e2e`와 관련 GitHub Actions workflow를 사용한다.

## 1. 기준선 확인

작업 시작 전 확인:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git fetch origin
```

추가로 읽을 문서:

1. `AGENTS.md`
2. `docs/memory.md`
3. `docs/PROJECT_MAP.md`의 대상 영역
4. 현재 Task의 PLAN/HANDOFF/spec

## 2. 설치와 기본 정적 검증

루트 `package.json` 기준:

```bash
pnpm install

# production build 대상
pnpm build

# workspace typecheck
pnpm typecheck

# Firebase Rules
pnpm test:firestore-rules
pnpm test:storage-rules
```

주의:

- 루트 `pnpm lint`는 workspace별 lint를 재귀 실행하고 API lint가 수정형일 수 있으므로 읽기 전용 검증으로 사용하기 전에 실제 package script를 확인한다.
- build·test가 생성하는 산출물은 의도한 변경과 구분한다.

## 3. 로컬 개발 서버

```bash
# API
pnpm dev:api

# Consumer
pnpm dev:consumer
```

Seller·Driver는 각 package의 현재 `scripts`를 확인하고 실행한다. 문서에 과거 로컬 배치 파일이나 고정 사용자 환경 경로를 SSOT로 두지 않는다.

## 4. API 기본 smoke

로컬 API가 실행 중일 때 상태 변경 없는 health 확인부터 시작한다.

```text
GET http://localhost:3000/health
```

인증·주문·결제·알림 같은 상태 변경 시나리오는 현재 API spec과 전용 테스트를 사용한다. 임시 계정을 문서에 하드코딩하거나 운영 데이터를 수동 생성하지 않는다.

## 5. Firebase Rules 검증

Firestore·Storage 접근 계약을 변경한 경우 루트 테스트를 사용한다.

```bash
pnpm test:firestore-rules
pnpm test:storage-rules
```

운영 Firebase Console에서 문서를 직접 수정해 Rules 동작을 시험하지 않는다.

## 6. Playwright E2E

현재 멀티앱 통합 검증 진입점:

```bash
pnpm test:e2e
```

UI 모드가 필요할 때:

```bash
pnpm test:e2e:ui
```

실행 전 확인:

- `apps/e2e/playwright.config.ts`
- `apps/e2e/global-setup.ts`
- 대상 spec
- 현재 E2E 환경·seed·cleanup 계약
- 배포 대상 SHA와 Preview 준비상태

회차 직배송 출시 검증에서는 활성 출시 PLAN/HANDOFF가 요구하는 동일 SHA 원격 workflow, chromium/mobile 결과, fixture cleanup을 최종 증거로 사용한다.

## 7. 부하·운영 probe

현재 루트 scripts에는 다음 진입점이 있다.

```bash
pnpm load:check-baseline
pnpm load:check-probe
pnpm load:readiness
pnpm load:smoke
```

단, k6 실행은 대상 URL·데이터·부하 강도에 따라 외부 상태에 영향을 줄 수 있다. `docs/specs/ops/k6-load-test-plan.md`와 현재 Backlog의 재개 조건을 확인하고 승인 범위 밖의 production 부하를 실행하지 않는다.

## 8. 배포 전 통합 검증 체크

- [ ] 현재 branch와 HEAD가 Task가 전제한 기준과 일치한다.
- [ ] 작업 트리의 기존 사용자 변경을 보존했다.
- [ ] 변경 영역의 build/typecheck/unit test가 통과했다.
- [ ] 공개 API·DTO·상태 변경이면 관련 spec과 shared 계약을 정합화했다.
- [ ] Firebase 계약 변경이면 Rules 테스트를 통과했다.
- [ ] 다역할 사용자 흐름 변경이면 관련 Playwright E2E를 통과했다.
- [ ] 출시 Task라면 실제 출시 대상 SHA의 원격 검증을 따로 확인했다.
- [ ] 실행하지 않은 검증을 완료로 기록하지 않았다.
- [ ] 비밀값·개인정보·운영 데이터 원문을 로그·문서·Git에 남기지 않았다.

## 9. 운영 변경 경계

다음은 통합 테스트라는 이유만으로 실행하지 않는다.

- production 환경 변수 변경
- Railway/Vercel/Firebase production 배포
- 운영 Firestore 데이터 생성·수정·삭제
- 실제 결제·환불
- 실제 알림톡·SMS 발송
- 운영 회차 상태 변경
- `salesMode` 전환

필요한 경우 해당 활성 PLAN의 승인 게이트를 먼저 따른다.
