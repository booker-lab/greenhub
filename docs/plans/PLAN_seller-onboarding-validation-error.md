<!-- Language: ko -->

# Project Blueprint: 판매자 온보딩 검증 오류 해결

## 문서 메타
- **작성일**: 2026-06-10
- **Priority**: 1
- **Labels**: bug, seller, api
- **Architectural Goal**: 판매자 온보딩 요청 계약을 프론트와 API에서 단일하게 맞추고, 검증 실패는 한국어 사용자 메시지로 변환한다.

## 업무 요약
### 개요
운영 판매자 온보딩 화면에서 `property ceoName should not exist, property phone should not exist, property address should not exist`가 노출된다. 이 문구는 NestJS 전역 `ValidationPipe`가 요청 본문에 DTO가 허용하지 않는 필드가 있다고 판단할 때 발생한다.

### 생산자 확인 기준
- 판매자 온보딩의 신규 생성과 기존 스토어 보완 저장이 모두 성공한다.
- 같은 검증 실패가 발생하더라도 사용자 화면에는 한국어 안내가 표시된다.
- API의 저장 DTO, 공유 타입, 프론트 요청 본문이 같은 필드 계약을 사용한다.

## Diagnosis & Findings
- **현상**: `/onboarding` 저장 시 영어 검증 메시지가 빨간 오류로 노출된다.
- **근본 원인 후보 1**: 운영 API 배포본의 `UpdateStoreDto`가 `ceoName`, `phone`, `address`를 허용하지 않는 오래된 빌드일 가능성이 높다.
- **근본 원인 후보 2**: 프론트가 최신 계약 필드를 보내지만, 연결된 API 주소가 의도한 최신 API가 아닐 수 있다.
- **사용자 메시지 문제**: `apps/seller/src/app/onboarding/page.tsx`가 `ApiError.message`를 그대로 화면에 표시해 서버 내부 검증 문구가 사용자에게 노출된다.
- **로컬 코드 근거**: 현재 로컬 `UpdateStoreDto`와 `Store` 공유 타입은 `ceoName`, `phone`, `address`를 포함한다.

## Architectural Deepening
- **Business Logic**: 스토어 온보딩 완료 조건과 저장 필드는 API `stores` 도메인에 둔다.
- **Infrastructure**: NestJS `ValidationPipe`, 배포 상태 확인, 환경변수 확인은 인프라 검증으로 분리한다.
- **Interface Contract**: `UpdateStoreDto`와 `UpdateStoreRequest`를 동일 계약으로 유지하고 프론트는 이 계약만 전송한다.
- **User Error Boundary**: 서버 검증 메시지를 프론트에서 그대로 노출하지 않고 온보딩 전용 한국어 문구로 변환한다.

## Agent Completion Contract
Task 완료 시 Verify 명령을 통과시킨 뒤 Status를 갱신한다.

> **에이전트 스코프**: 진단 → 계약 보정 → 사용자 오류 문구 보정 → 배포 확인 → 운영 재검증 순서로 진행한다.

## Execution Plan

#### Task 0.1: 현재 원인 확정 [Unit: Atomic]
- **Task-ID**: 0.1
- **Pre-read**: `apps/api/src/main.ts`, `apps/api/src/stores/dto/update-store.dto.ts`, `apps/seller/src/app/onboarding/page.tsx`
- **Target**: `docs/plans/PLAN_seller-onboarding-validation-error.md`
- **Goal**: 화면 오류와 로컬 코드의 스키마 불일치 가능성을 문서화한다.
- **Verify**: `powershell -Command "(Get-Content docs/plans/PLAN_seller-onboarding-validation-error.md | Measure-Object -Line).Lines"`
- **Conclusion**: 로컬 DTO에는 필드가 있으므로 운영 배포본 또는 API 연결 대상 불일치가 1순위 원인이다.
- **Status**: done

#### Task 1.1: 운영 API 배포본 확인 [Unit: Atomic]
- **Task-ID**: 1.1
- **Pre-read**: `apps/seller/src/lib/api.ts`, Vercel `NEXT_PUBLIC_API_URL`, Railway 배포 로그
- **Target**: `apps/api/src/stores/dto/update-store.dto.ts`
- **Goal**: 실제 운영 API가 `ceoName`, `phone`, `address`를 허용하는 빌드인지 확인한다.
- **Verify**: `pnpm --filter api build`
- **Conclusion**: 원인은 DTO 필드 부재가 아니라 `StoresController`의 `UpdateStoreDto` type-only import로 인한 Nest 런타임 메타데이터 손실이었다. API 빌드와 Railway 운영 배포를 통과했다.
- **Status**: done

#### Task 1.2: 온보딩 계약 회귀 테스트 추가 [Unit: Atomic]
- **Task-ID**: 1.2
- **Pre-read**: `apps/api/src/stores/stores.service.spec.ts`, `apps/api/src/stores/dto/update-store.dto.ts`
- **Target**: `apps/api/src/stores/dto/update-store.dto.spec.ts`
- **Goal**: `ceoName`, `phone`, `address`가 저장 계약에서 빠지면 실패하는 테스트를 먼저 추가한다.
- **Verify**: `pnpm --filter api test -- stores.service.spec.ts`
- **Conclusion**: `ceoName`, `phone`, `address` 허용과 미등록 필드 거부를 DTO 테스트로 고정했다.
- **Status**: done

#### Task 1.3: 프론트 요청 타입을 공유 계약에 맞춤 [Unit: Atomic]
- **Task-ID**: 1.3
- **Pre-read**: `packages/shared/src/store.types.ts`, `apps/seller/src/app/onboarding/page.tsx`
- **Target**: `apps/seller/src/app/onboarding/page.tsx`
- **Goal**: 온보딩 요청 본문이 `UpdateStoreRequest` 계약을 따르도록 명시한다.
- **Verify**: `pnpm --filter seller build`
- **Conclusion**: 온보딩 조회 응답과 저장 payload를 `UpdateStoreRequest`로 명시했다.
- **Status**: done

#### Task 1.4: 사용자용 한국어 오류 변환 [Unit: Atomic]
- **Task-ID**: 1.4
- **Pre-read**: `apps/seller/src/lib/api.ts`, `apps/seller/src/app/onboarding/page.tsx`
- **Target**: `apps/seller/src/lib/api.ts`
- **Goal**: 서버 검증 원문 대신 한국어 안내를 표시한다.
- **Verify**: `pnpm --filter seller build`
- **Conclusion**: `should not exist` 검증 메시지는 공통 API 클라이언트에서 한국어 문구로 정규화한다.
- **Status**: done

#### Task 1.5: 운영 재배포와 브라우저 검증 [Unit: Atomic]
- **Task-ID**: 1.5
- **Pre-read**: `docs/specs/ops/staged-preview-release-pipeline.md`
- **Target**: `docs/specs/full-flow-manual-test-guide.md`
- **Goal**: API와 seller 앱 배포 후 실제 `seller.greenlove.co.kr/onboarding` 저장 성공을 확인한다.
- **Verify**: `pnpm --filter e2e test -- seller-onboarding.spec.ts --project=chromium`
- **Conclusion**: 2026-06-11 후속 운영 배포가 온보딩 수정을 덮어쓴 것을 확인해 재배포했다. API는 Railway 배포 `abce0e41-3ccd-41f9-aa7a-3a4241f1743e`가 성공했고 `/health` 200을 확인했다. seller는 Vercel 배포 `dpl_Gb2D6A8jJKuJt43Vx79fPbxEDZaV`가 Ready이며 `seller.greenlove.co.kr` alias와 `/onboarding` 200을 확인했다.
- **Status**: done

## Completion Checklist
- [x] `docs/memory.md` 200라인 이하 확인
- [x] 원인 후보를 로컬 코드와 화면 메시지 기준으로 분리
- [x] 계획 문서 작성
- [x] API 빌드 검증
- [x] 셀러 빌드 검증
- [x] 운영 배포 및 `/onboarding` 응답 검증
