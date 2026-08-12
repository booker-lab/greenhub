<!-- Language: ko -->

# 🗺️ Project Blueprint: 카카오 심사용 consumer 홈 증빙 화면 정돈

## 문서 메타

- **Linear-Issue**: 없음
- **Priority**: 1
- **Labels**: consumer, kakao-business, ui-cleanup
- **Related**: `docs/plans/PLAN_kakao_business_channel_homepage_reapproval.md`
- **Architectural Goal**: 카카오 심사 증거를 정적 상태로 유지하면서 상단 증빙 구획을 일반 쇼핑 화면에 어울리는 작은 Server Component로 정돈한다.

## 📋 업무 요약 (협업용)

### 개요

현재 홈페이지는 카카오 심사에 필요한 운영 관계, 공식 채널, 대표 판매상품을 모두 공개하지만 상단 카드에 상세 사업자정보까지 함께 담아 소명자료처럼 보인다. 상단에는 운영 주체 관계를 한 문장으로 먼저 보여 주고 공식 채널 동작과 대표상품 타일만 남긴다. 상세 사업자정보는 기존 하단 정보 구획에서 계속 제공한다.

### 끝났을 때 확인할 것

- 상단에서 “그린러브는 디어 오키드가 운영하는 화훼 쇼핑몰입니다.”가 가장 먼저 읽힌다.
- 공식 카카오톡 채널 동작과 대표상품 타일 3개가 로그인이나 상품 조회 상태와 무관하게 보인다.
- 상단에는 대표자명과 사업자등록번호를 반복하지 않고 상세 정보는 하단에서 확인할 수 있다.
- 모바일과 데스크톱에서 가로 넘침이 없고 증빙 구획이 상품 탐색을 과도하게 밀어내지 않는다.
- 기존 상품 조회, 주문, 판매 데이터 계약은 바뀌지 않는다.

### 이번에 하지 않는 것

- 시험용 운영 상품 삭제와 이미지 데이터 정리
- 상품 API와 Firestore 데이터 변경
- consumer 전체 디자인 개편과 디자인 시스템 선행 작업
- footer 공개 사업자 필드 추가
- push, PR, production 배포, 카카오 재신청
- 주소, 비공개 Gmail, 로그인 정보, 사업자등록증 이미지, 생년월일 기록

## 🎯 Origin Intent

- **출처**: `docs/discussions/DISCUSS_consumer_home_proof_ui.md`와 사용자의 카카오 심사 화면 정돈 요청
- **원래 목적**: 카카오 심사 증거를 잃지 않으면서 홈페이지가 정상적인 화훼 쇼핑몰처럼 보이게 한다.
- **완료 관찰**: 심사자는 첫 화면에서 운영 주체와 공식 채널과 대표 판매상품을 확인하고 일반 고객은 과도한 사업자 카드 없이 상품 목록으로 이동한다.

## ⚠️ Edge Case Trace

| 엣지 케이스 | 출처 | Task-ID / 범위 밖 | 안전 조건 |
| :--- | :--- | :--- | :--- |
| 실제 상품 목록이 비어 있음 | discuss | 1.2, 1.4, 2.1 | 정적 운영 안내와 대표상품 타일 3개를 유지 |
| 실제 상품 목록 조회 실패 | discuss | 1.2, 1.4, 2.1 | 증빙 구획을 상품 조회 상태와 결합하지 않음 |
| 모바일 화면 폭이 좁음 | discuss | 1.4, 2.3 | 타일을 줄바꿈하고 가로 넘침을 허용하지 않음 |
| 사업자 상세 정보가 상단과 하단에서 반복됨 | 현재 화면 | 1.2, 1.4 | 상단의 대표자명과 등록번호를 제거하고 하단 정본을 유지 |
| 공개 미승인 정보가 다시 노출됨 | 보안 경계 | 1.1, 2.1 | 공개 정본 외 값을 추가하지 않음 |
| 시험용 상품과 이미지 미노출 | 사용자 범위 결정 | 범위 밖 | 향후 전체 프론트엔드 작업에서 별도 정리 |

## 🔍 Diagnosis & Findings

- `BusinessRelationshipNotice`는 운영 관계, 채널 동작, 사업자명, 대표자명, 등록번호, 대표상품 목록을 하나의 큰 유색 카드에 표시한다.
- 동일한 사업자 상세 정보는 `BusinessInfoFooter`에도 있어 상단과 하단의 역할이 겹친다.
- 대표상품은 글머리표 링크로 표시돼 실제 쇼핑 상품과 시각적 성격이 다르다.
- 운영 관계와 대표상품은 `PUBLIC_BUSINESS_INFO` 정적 계약을 사용하므로 실제 상품 목록이 실패해도 독립적으로 렌더링할 수 있다.
- `HomePage`는 증빙 구획을 배너 다음과 실제 상품 목록 전에 두고 있어 컴포넌트 내부만 정돈해도 화면 순서와 판매 로직을 보존할 수 있다.

## 🏗️ Architectural Deepening

- **문구 경계**: 공개 운영 관계 문장은 `PUBLIC_BUSINESS_INFO.relationship` 한 곳에서 관리한다.
- **화면 경계**: `BusinessRelationshipNotice`는 운영 관계, 공식 채널 동작, 대표상품 타일만 담당한다.
- **상세정보 경계**: 대표자명, 사업자등록번호, 고객센터는 기존 `BusinessInfoFooter`에서만 자세히 보여 준다.
- **데이터 경계**: 정적 대표상품은 실제 상품 조회 훅과 연결하지 않아 빈 목록과 네트워크 실패의 영향을 받지 않는다.
- **교체 경계**: 새 공통 디자인 시스템을 만들지 않고 향후 전체 개편에서 쉽게 교체할 수 있는 단일 컴포넌트로 유지한다.
- **검증 경계**: 정적 계약 테스트, consumer lint, production build, 모바일·데스크톱 육안 확인을 모두 통과해야 로컬 checkpoint를 만든다.

## Agent Completion Contract

1. Task를 Dependency 순서대로 한 번에 하나씩 실행한다.
2. Task 1.4 전에 `apps/consumer/AGENTS.md`와 관련 Next.js 16 문서를 읽는다.
3. 애플리케이션 변경은 실패 계약을 먼저 고정한 뒤 구현한다.
4. 각 Task의 Verify 종료 코드가 0일 때만 Conclusion과 Status를 닫는다.
5. PLAN 전체 실행 요청 뒤 Blueprint 구조는 고정하고 Conclusion·Status·Closeout만 갱신한다.
6. 공개 사업자 정본 외 개인정보를 코드, 문서, 로그, commit에 기록하지 않는다.
7. 예상하지 못한 diff, 검증 실패, Git 충돌, 추가 권한 필요 시에만 중단한다.
8. push, PR, production 배포, 카카오 재신청은 수행하지 않는다.
9. 모든 검증이 통과한 뒤 예상 변경만 포함한 한국어 메시지 로컬 checkpoint commit 하나를 만든다.

> **에이전트 스코프**: 사용자가 PLAN 전체 실행을 요청하면 공개 정본 갱신부터 계약 테스트, 증빙 컴포넌트 정돈, 관련 회귀 검증, 문서화, 로컬 checkpoint까지 순서대로 진행한다. 운영 데이터와 외부 서비스 상태는 변경하지 않는다.

## Execution Plan

### Phase 1 — 공개 계약과 증빙 컴포넌트 정돈

#### Task 1.1 — 심사용 공개 문구 정본 갱신 [Unit: Atomic]

- **Task-ID**: 1.1
- **Dependency**: 없음
- **Pre-read**: `docs/discussions/DISCUSS_consumer_home_proof_ui.md`, `docs/specs/ops/kakao-business-channel-proof.md`
- **Target**: `docs/specs/ops/kakao-business-channel-proof.md`
- **Goal**: 카카오 공개 정본에 상단 핵심 문구와 정보 역할 분리를 기록한다.
- **Verify**: `git diff --check -- docs/specs/ops/kakao-business-channel-proof.md`
- **Conclusion**: 완료 — 합의된 핵심 문구와 상단·footer 역할 분리, 상품 조회 상태와 독립된 정적 증빙 원칙을 공개 정본에 기록했다. `git diff --check -- docs/specs/ops/kakao-business-channel-proof.md` 종료 코드 0.
- **Status**: done

#### Task 1.2 — 증빙 화면 계약 테스트 갱신 [Unit: Atomic]

- **Task-ID**: 1.2
- **Dependency**: Task 1.1
- **Pre-read**: `apps/consumer/src/components/BusinessRelationshipNotice.test.mjs`, `apps/consumer/src/components/BusinessRelationshipNotice.tsx`
- **Target**: `apps/consumer/src/components/BusinessRelationshipNotice.test.mjs`
- **Goal**: 운영 주체 핵심 문장과 상단 상세정보 비노출과 대표상품 타일 구조를 실패 테스트로 고정한다.
- **Verify**: `node --check apps/consumer/src/components/BusinessRelationshipNotice.test.mjs`
- **Conclusion**: 완료 — 새 핵심 문장, 대표상품 타일 구조, 상단 상세 사업자정보 비노출 계약을 추가했다. `node --check apps/consumer/src/components/BusinessRelationshipNotice.test.mjs` 종료 코드 0이며, 구현 전 테스트에서 의도한 계약 3건이 실패함을 확인했다.
- **Status**: done

#### Task 1.3 — 공개 운영 관계 문장 교체 [Unit: Atomic]

- **Task-ID**: 1.3
- **Dependency**: Task 1.2
- **Pre-read**: `apps/consumer/src/lib/publicBusinessInfo.ts`, `apps/consumer/src/components/BusinessInfoFooter.tsx`
- **Target**: `apps/consumer/src/lib/publicBusinessInfo.ts`
- **Goal**: `PUBLIC_BUSINESS_INFO.relationship`을 합의한 자연어 문장으로 교체한다.
- **Verify**: `node --test apps/consumer/src/components/BusinessRelationshipNotice.test.mjs`
- **Conclusion**: 완료 — `PUBLIC_BUSINESS_INFO.relationship`을 합의 문장으로 교체했다. 문구 계약 단독 실행이 먼저 통과했고, Task 1.4 구현 후 전체 `node --test apps/consumer/src/components/BusinessRelationshipNotice.test.mjs`도 6/6 통과했다.
- **Status**: done

#### Task 1.4 — 상단 증빙 구획 정돈 [Unit: Atomic]

- **Task-ID**: 1.4
- **Dependency**: Task 1.3
- **Pre-read**: `apps/consumer/AGENTS.md`, 관련 Next.js 16 Server Component 문서, `apps/consumer/src/components/BusinessRelationshipNotice.tsx`
- **Target**: `apps/consumer/src/components/BusinessRelationshipNotice.tsx`
- **Goal**: `BusinessRelationshipNotice`를 핵심 문장과 채널 동작과 대표상품 타일만 담는 정적 Server Component로 정돈한다.
- **Verify**: `node --test apps/consumer/src/components/BusinessRelationshipNotice.test.mjs`
- **Conclusion**: 완료 — Next.js 16 Server Component 문서를 확인하고 클라이언트 경계 없이 핵심 문장, 공식 채널 동작, 반응형 대표상품 타일 3개만 남겼다. 상단 상세 사업자정보 `<dl>`은 제거했다. 관련 테스트 6/6 통과.
- **Status**: done

### Phase 2 — 회귀와 화면 검증

#### Task 2.1 — 증빙 관련 회귀 테스트 [Unit: Atomic]

- **Task-ID**: 2.1
- **Dependency**: Task 1.4
- **Pre-read**: `apps/consumer/src/components/BusinessInfoFooter.test.mjs`, `apps/consumer/src/app/page.test.mjs`
- **Target**: `apps/consumer/src/components/BusinessRelationshipNotice.test.mjs`
- **Goal**: 상단 증빙과 하단 사업자정보와 홈 배치 계약의 회귀가 없는지 확인한다.
- **Verify**: `node --test apps/consumer/src/components/BusinessRelationshipNotice.test.mjs apps/consumer/src/components/BusinessInfoFooter.test.mjs apps/consumer/src/app/page.test.mjs`
- **Conclusion**: 완료 — 상단 증빙, footer 상세 사업자정보, 홈 배치 순서를 함께 검증했다. 관련 테스트 13/13 통과, 종료 코드 0.
- **Status**: done

#### Task 2.2 — consumer 정적 검사 [Unit: Atomic]

- **Task-ID**: 2.2
- **Dependency**: Task 2.1
- **Pre-read**: `apps/consumer/package.json`, 변경된 consumer 파일
- **Target**: `apps/consumer/src/components/BusinessRelationshipNotice.tsx`
- **Goal**: 증빙 화면 정돈이 consumer lint 규칙을 위반하지 않는지 확인한다.
- **Verify**: `pnpm --filter consumer lint`
- **Conclusion**: 완료 — `pnpm --filter consumer lint` 종료 코드 0, error 0, 기존 기준과 같은 warning 25건을 확인했다. 변경 파일에서 새 경고는 발생하지 않았다.
- **Status**: done

#### Task 2.3 — production build와 반응형 화면 확인 [Unit: Atomic]

- **Task-ID**: 2.3
- **Dependency**: Task 2.2
- **Pre-read**: `apps/consumer/src/app/page.tsx`, 변경된 증빙 컴포넌트
- **Target**: `apps/consumer/src/app/page.tsx`
- **Goal**: consumer production build를 통과한 화면에서 모바일과 데스크톱 완료 기준을 확인한다.
- **Verify**: `pnpm --filter consumer build`
- **Visual Verify**: 로컬 홈을 모바일과 데스크톱으로 열어 핵심 문구, 공식 채널 동작, 타일 3개, 가로 넘침 부재, 상품 목록 접근성을 확인한다.
- **Conclusion**: 완료 — `pnpm --filter consumer build` 종료 코드 0. 데스크톱과 375×812 모바일에서 핵심 문구, 공식 채널 새 탭 연결, 대표상품 타일 3개, 가로 넘침 부재, 상품 목록 접근성을 확인했다. footer 상세정보도 유지됐다.
- **Status**: done

### Phase 3 — 문서화와 로컬 checkpoint

#### Task 3.1 — 카카오 작업 보고서 갱신 [Unit: Atomic]

- **Task-ID**: 3.1
- **Dependency**: Task 2.3
- **Pre-read**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`, 전체 검증 결과
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 화면 정돈 범위와 검증 결과와 외부 미변경 상태를 보고서에 기록한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Conclusion**: 완료 — 화면 정돈 범위, TDD·회귀·lint·build·반응형 검증 결과, 운영 데이터와 외부 서비스 미변경 상태를 기존 REPORT에 기록했다. `git diff --check -- docs/plans/REPORT_kakao_business_channel_reapproval.md` 종료 코드 0.
- **Status**: done

#### Task 3.2 — 예상 변경 checkpoint 생성 [Unit: Atomic]

- **Task-ID**: 3.2
- **Dependency**: Task 3.1
- **Pre-read**: 전체 diff, 전체 검증 결과, Git 작성자 메타데이터
- **Target**: `docs/plans/PLAN_consumer_home_proof_ui_cleanup.md`
- **Goal**: 예상 파일과 검증 기록만 포함한 로컬 checkpoint commit 하나를 생성한다.
- **Verify**: `git status --short --branch`
- **Conclusion**: 완료 — 전체 diff와 예상 파일 8개를 확인하고 `git diff --check`를 통과했다. 기본 Git 메타데이터의 비공개 Gmail을 사용하지 않고 저장소 이력의 공개 GitHub `noreply` 메타데이터를 commit 단위로 적용해 한국어 메시지 로컬 checkpoint 하나로 마감했다.
- **Status**: done

## Closeout

- **Status**: done
- **완료 범위**: 공개 문구 정본, 실패 계약, 정적 Server Component, footer·홈 회귀 계약, REPORT를 함께 갱신했다.
- **검증**: 관련 테스트 13/13, consumer lint error 0·기존 warning 25, consumer production build, 데스크톱·375×812 모바일 화면, 공식 카카오톡 채널 새 탭 연결, 전체 `git diff --check`를 통과했다.
- **변경 경계**: 상품 API, Firestore 운영 데이터, 시험용 상품, 이미지 데이터, 주문·판매 로직은 변경하지 않았다.
- **초기 외부 상태**: checkpoint 생성 시점에는 push, PR, production 배포, 카카오 재신청, 이메일·DNS·카카오 채널·공개 소식·ALIGO 변경을 수행하지 않았다.

## 후속 배포 기록

- **Status**: done
- **원격 반영**: checkpoint `1fb055be49af0ebdab58a2e8e651ad7e51f5eabe`를 push하고 PR #15의 검사를 통과한 뒤 merge commit `8c1707aebbd877d44c6b0568a77c8eb7482011f5`로 `main`에 병합했다.
- **배포**: consumer production 배포 `dpl_Czsh6iubchy5hkzPQr5RJ3wQ4UMj`가 `Ready`이며 `https://greenlove.co.kr/` 별칭이 연결됐다. seller·driver는 Ignored Build Step으로 취소됐고 Railway API는 변경하지 않았다.
- **운영 검증**: 데스크톱과 375×812 모바일에서 핵심 문구, 공식 카카오톡 채널, 대표상품 타일 3개, 상품 목록, footer 상세정보와 가로 넘침 부재를 확인했다. 배포 후 최근 1시간 Vercel error 로그는 0건이었다.
- **변경하지 않은 외부 상태**: 카카오 재신청, 이메일·DNS·카카오 채널·공개 소식·ALIGO 변경을 수행하지 않았다.

## 2026-08-11 후속 공개 상품 정상화

- **Status**: production 반영 및 운영 검증 완료
- 2026년 8월 10일 카카오 비즈니스 채널 심사가 `사업자-채널의 연관성 확인/검증 불가` 사유로 다시 반려됐다.
- 운영 화면의 공개 상품 목록에 E2E 상품과 모집기한이 지난 공동구매가 노출되고, 만료 공동구매 상세의 장바구니 동선이 활성인 상태를 확인했다.
- 공개 API가 활성 공개 상품만 반환하고 시험용 상품은 목록과 상세에서 차단하도록 서버 방어를 추가했다.
- 고정 E2E 시드에 `testOnly=true`를 강제하고 소비자 배송 슬롯 상점 선택에서도 시험용 상품을 제외했다.
- 공동구매 상태 판정을 shared 계약으로 통합해 홈·공구 목록·상품 카드·상세 구매 동선이 목표 수량과 모집기한을 함께 사용하도록 했다.
- 운영 Firestore의 고정 `e2e-` 상품 두 건은 삭제하지 않고 `isActive=false`, `testOnly=true`로 변경했으며 적용 후 같은 값을 재조회했다.
- shared 테스트 9/9, API 테스트 6/6, consumer·시드 계약 테스트 18/18, consumer lint 오류 0·기존 경고 25건, API와 consumer production build가 통과했다.
- 코드 commit `f04a3458747d83a41c693efab13b7e48704fbc6f`를 PR #17로 병합했으며 merge commit은 `098ad98c72a8bdcb5e3c1a95ed2c6b3287cf0ab2`다.
- consumer production 배포 `dpl_H9YdEa8HWd5PkM1PKZTw6g7EF3Fo`와 Railway API production 배포 `d054f564-5fc7-4656-816b-7c05578e260e`가 같은 merge SHA로 성공했다.
- 운영 API는 공개 상품 5건을 반환하고 E2E 상품 0건, 비활성 조회 우회 결과 동일, E2E 상세 2건 모두 404임을 확인했다.
- 운영 데스크톱과 375×812 모바일에서 E2E 문구 미노출, 만료 공동구매의 진행 중 구획 제외, `모집 마감` 표시, 구매 버튼 차단, 실제 일반상품 3종, 운영 관계, 공식 채널, 가로 넘침 부재를 확인했다.
- 최근 1시간 consumer Vercel 오류 로그와 Railway 오류·5xx 로그는 0건이다.
- `packages/shared` 변경이 Vercel의 공통 빌드 경로로 인식되어 seller 배포 `dpl_5CdhRd1XAW7LFxUTiEe2HHY7qTqP`와 driver 배포 `dpl_FZbbKMh362QGayFyeTNLTBSU5cKi`도 자동 생성됐다. 두 배포는 Ready, 공개 도메인은 HTTP 200, 최근 1시간 오류 로그는 0건이다.
- 카카오 재신청과 카카오 채널·이메일·DNS·ALIGO·공개 소식 변경은 수행하지 않았다.
- **남은 위험**: 운영 배너의 Firebase Storage 이미지 원본이 HTTP 402를 반환해 브라우저에서 이미지가 깨져 보인다. 이번 승인 범위 밖의 운영 콘텐츠이므로 변경하지 않았으며, 다음 작업에서 사용자가 승인한 새 이미지로 교체하거나 배너 이미지 설정을 제거해야 한다.
