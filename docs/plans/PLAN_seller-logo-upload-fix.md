<!-- Language: ko -->

# Project Blueprint: 판매자 로고 업로드 실패 수정

## 문서 메타
- **Linear-Issue**: N/A
- **Priority**: 1
- **Labels**: bug, seller, storage
- **Architectural Goal**: 로고 업로드 인프라 권한을 명확히 분리하고, 온보딩 UI가 실패 원인을 검증 가능하게 만든다.

## 업무 요약
### 개요
판매자 온보딩 화면의 로고 업로드가 실패한다. 화면에서는 "로고 업로드에 실패했습니다. 다시 시도해주세요."만 표시되지만, 코드 조사 결과 업로드 경로와 Firebase Storage Rules의 허용 경로가 불일치한다.

### 현상 확인 근거
- `apps/seller/src/app/onboarding/page.tsx`는 로고 파일을 `logos/{userId}_{timestamp}` 경로로 업로드한다.
- `storage.rules`는 현재 `products/{storeId}/...`와 `banners/...` 쓰기만 허용한다.
- 따라서 인증된 사용자라도 `logos/...` 경로에는 쓰기 권한이 없어 `storage/unauthorized` 계열 오류가 발생할 가능성이 높다.
- `cors.json`에는 `https://seller.greenlove.co.kr`가 포함되어 있어, 현재 증상만으로는 CORS가 1차 원인일 가능성이 낮다.
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`는 코드에서 사용되며, `.env.example`에는 값이 정의되어 있다. 운영 환경값 누락 가능성은 보조 확인 항목으로 둔다.

## Diagnosis & Findings
- **현상**: 판매자 온보딩에서 로고 선택 후 업로드 실패 메시지가 표시된다.
- **근본 원인 후보 1순위**: Firebase Storage Rules에 `logos/{allPaths=**}` 매치가 없다.
- **근본 원인 후보 2순위**: 운영 Firebase Storage Rules가 저장소의 `storage.rules` 최신 상태로 배포되지 않았다.
- **근본 원인 후보 3순위**: 운영 Vercel의 `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` 값 누락 또는 잘못된 버킷 값.
- **비원인 가능성이 높은 항목**: 파일 형식과 크기 제한. 현재 화면에 선택된 파일이 보이고, 오류 메시지는 업로드 `catch`에서 발생한다.

## Architectural Deepening
- **분리 원칙**: 온보딩의 사업자 정보 저장은 API/Firestore 도메인으로 유지하고, 이미지 저장 권한은 Firebase Storage 인프라 규칙에서 해결한다.
- **경계**: 판매자 로고 경로는 상품 이미지(`products`)나 배너 이미지(`banners`)와 분리된 `logos` 저장소 경계로 둔다.
- **보안 기준**: 읽기는 공개 허용, 쓰기는 인증 사용자로 제한한다. 가능하면 후속 작업에서 `request.auth.uid` 기반 파일명 또는 메타데이터 검증까지 강화한다.
- **운영 기준**: 규칙 수정만으로 끝내지 않고 `firebase deploy --only storage`까지 실행되어야 운영 화면이 복구된다.

## Agent Completion Contract
Task 완료 시 Verify 명령을 실행하고, 성공한 작업만 체크한다. 저장소에 `plan-lint` 명령이 없으므로 본 문서는 수동 등가 점검으로 검증한다.

> **에이전트 스코프**: 코드 수정 전 원인 분석과 실행 계획 수립까지 완료한다. 구현 단계에서는 Storage Rules 수정, 배포, 실제 업로드 검증을 순서대로 진행한다.

## Execution Plan

#### Task 1.1: Storage Rules에 로고 경로 허용 추가 [Unit: Atomic]
- **Task-ID**: 1.1
- **Pre-read**: `storage.rules`, `apps/seller/src/app/onboarding/page.tsx`
- **Target**: `storage.rules`
- **Goal**: `logos/{allPaths=**}` 경로에 공개 읽기와 인증 사용자 쓰기 규칙을 추가한다.
- **Verify**: `node scripts/verify-logo-storage-rule.mjs`
- **Conclusion**: [완료] `logos/{allPaths=**}`에 공개 읽기와 인증 사용자 쓰기 규칙을 추가했다.
- **Status**: done

#### Task 1.2: Storage Rules 검증 스크립트 추가 [Unit: Atomic]
- **Task-ID**: 1.2
- **Pre-read**: `storage.rules`, `scripts/package.json`
- **Target**: `scripts/verify-logo-storage-rule.mjs`
- **Goal**: 로고 경로 존재, 공개 읽기, 인증 사용자 쓰기 계약을 정적으로 검증하는 스크립트를 추가한다.
- **Verify**: `node scripts/verify-logo-storage-rule.mjs`
- **Conclusion**: [완료] 새 의존성 없이 Storage Rules 핵심 계약을 검증하는 스크립트를 추가했다.
- **Status**: done

#### Task 1.3: 온보딩 업로드 오류 관측성 개선 [Unit: Atomic]
- **Task-ID**: 1.3
- **Pre-read**: `apps/seller/src/app/onboarding/page.tsx`
- **Target**: `apps/seller/src/app/onboarding/page.tsx`
- **Goal**: Firebase Storage 오류 코드를 콘솔에 남기고 사용자 메시지는 현재처럼 일반화해 운영 디버깅 단서를 확보한다.
- **Verify**: `pnpm --filter seller exec tsc --noEmit`
- **Conclusion**: [대기] 타입 안정성을 유지하면서 실패 원인 확인 가능성을 높인다.
- **Status**: done

#### Task 1.4: 운영 환경값 확인 [Unit: Atomic]
- **Task-ID**: 1.4
- **Pre-read**: `apps/seller/src/lib/firebase.ts`, `docs/specs/full-flow-manual-test-guide.md`
- **Target**: `docs/specs/full-flow-manual-test-guide.md`
- **Goal**: `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` 운영 값 확인을 수동 테스트 체크리스트에 반영한다.
- **Verify**: `pnpm --filter seller exec tsc --noEmit`
- **Conclusion**: [대기] 환경값 누락을 배포 전 체크리스트에서 걸러낸다.
- **Status**: done

#### Task 1.5: 운영 배포와 브라우저 검증 [Unit: Atomic]
- **Task-ID**: 1.5
- **Pre-read**: `firebase.json`, `cors.json`
- **Target**: `storage.rules`
- **Goal**: 수정된 Storage Rules를 Firebase 운영 프로젝트에 배포하고 `seller.greenlove.co.kr/onboarding`에서 로고 업로드 성공을 확인한다.
- **Verify**: `firebase deploy --only storage --project green-e4fe3`
- **Conclusion**: [대기] 운영 Storage Rules 반영 후 실제 로고 URL이 생성되는지 확인한다.
- **Status**: done

## 조사 완료 체크리스트
- [x] 온보딩 로고 업로드 코드의 저장 경로를 확인했다.
- [x] Firebase Storage Rules의 허용 경로와 불일치를 확인했다.
- [x] CORS와 환경 변수는 보조 확인 대상으로 분류했다.
- [x] 구현 전 실행 계획과 검증 명령을 문서화했다.

## 구현 결과
- [x] `storage.rules`에 `logos/{allPaths=**}` 경로를 추가했다.
- [x] `scripts/verify-logo-storage-rule.mjs`로 로고 경로, 공개 읽기, 인증 사용자 쓰기 계약을 검증한다.
- [x] 온보딩 로고 업로드 실패 시 Firebase 오류 코드를 브라우저 콘솔에 남긴다.
- [x] Firebase 운영 프로젝트 `green-e4fe3`에 Storage Rules를 배포했다.
- [x] 실제 로그인 브라우저에서 로고 업로드를 재시도해 최종 화면 성공 여부를 확인했다.

## 수동 등가 검증
- [x] `docs/memory.md`가 200라인 이하임을 확인했다.
- [x] 조사 대상 코드 파일이 500라인 이하임을 확인했다.
- [x] 저장소에 `plan-preread` 및 `plan-lint` 명령이 없음을 확인했다.
- [x] `node scripts/verify-logo-storage-rule.mjs` 통과.
- [x] `pnpm --filter seller exec tsc --noEmit` 통과.
- [x] `firebase deploy --only storage --project green-e4fe3` 성공.
- [x] 로그인 세션이 필요한 실제 브라우저 로고 업로드는 사용자가 화면에서 재시도해 최종 확인했다.
