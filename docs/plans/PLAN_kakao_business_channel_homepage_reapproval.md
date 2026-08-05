<!-- Language: ko -->

# 🗺️ Project Blueprint: 카카오 비즈니스 채널 재심사용 공개 홈페이지 보완

## 문서 메타

- **Linear-Issue**: 없음
- **Priority**: 1
- **Labels**: release-blocker, consumer, kakao-business
- **Architectural Goal**: 기존 회차 출시 branch와 frontend 리팩토링을 건드리지 않고 `main` 기반 공개 홈페이지에 사업자와 `그린러브` 채널의 연관성 증거를 추가한다.

## 📋 업무 요약 (협업용)

### 개요

카카오 비즈니스 채널 심사는 `그린러브`와 신청 사업자의 관계를 공개 자료에서 확인할 수 없어 반려됐다. 현재 홈페이지에는 `그린러브` 명칭은 있지만 사업자 정보와 운영 관계 설명이 없다. 최신 운영 기준에서 작은 홈페이지 보완만 먼저 배포하고, 공개 URL과 보조 자료를 확인한 뒤 재심사를 신청한다.

### 끝났을 때 확인할 것

- 홈페이지 하단에서 `그린러브`와 운영 사업자의 관계를 즉시 확인할 수 있다.
- 공개 동의된 사업자명·대표자·사업자등록번호·고객센터가 사업자 증빙과 일치한다.
- 네이버 플레이스가 준비된 경우 동일 매장명·주소·연락처를 확인할 수 있는 링크가 있다.
- 모바일 하단 navigation이 사업자 정보를 가리지 않는다.
- 로그인 없이 공개 URL에서 동일 내용을 확인할 수 있다.
- 홈페이지 보완만 production에 배포되고 회차 직배송 기능과 기존 판매 흐름은 바뀌지 않는다.
- 카카오 재신청 기록에는 공개 URL과 사업자-브랜드 관계 설명만 남고 불필요한 개인정보는 포함되지 않는다.

### 이번에 하지 않는 것

- 회차 직배송 frontend 리팩토링
- 현재 회차 출시 branch의 기능 변경
- API·seller·driver 배포
- ALIGO 발신 프로필·템플릿 등록
- 실제 알림 발송과 Railway 변수 반영
- `salesMode` 변경과 회차 생성·수정

## 🎯 Origin Intent

- **출처**: 카카오 비즈니스 채널 반려 화면과 사용자의 공개 홈페이지 보완 요청
- **원래 목적**: 공개 홈페이지에서 `그린러브`와 신청 사업자의 연관성을 증명해 카카오 비즈니스 채널 재심사를 받을 수 있게 한다.
- **완료 관찰**: 심사자가 로그인 없이 홈페이지 하단과 보조 링크에서 동일 브랜드·사업자·공개 연락처를 확인한다.

## ⚠️ Edge Case Trace

| 엣지 케이스 | 출처 | Task-ID / 범위 밖 | 안전 조건 |
| :--- | :--- | :--- | :--- |
| 채널명과 사업자 상호가 다름 | 반려 사유 | 1.1, 1.3 | 운영 관계 문장을 명시하고 증빙 원문과 대조 |
| 사업자 값이 추정되거나 오래됨 | 사업자 증빙 | 1.1 | 사업자등록증·공개 장소 정보에서 확정한 값만 사용 |
| 사업장 주소가 개인정보성 주거지임 | 개인정보 | 1.1 | 공개 미동의 주소는 값 자체를 기록하지 않고 footer·문서·PR에서 제외 |
| 네이버 플레이스가 없거나 정보가 다름 | 보조 자료 | 1.1, 3.1 | 일치 확인 전 링크를 노출·제출하지 않음 |
| 모바일 하단 navigation이 footer를 가림 | 현재 UI | 1.2~1.4 | 실제 mobile viewport에서 마지막 줄까지 접근 확인 |
| 홈페이지가 로그인·JavaScript 오류로 보이지 않음 | 공개 심사 | 1.5, 3.1 | 비로그인 production URL과 렌더링 결과 확인 |
| Vercel cache에 이전 화면이 남음 | production 배포 | 2.3, 3.1 | 배포 SHA와 공개 응답을 재조회한 뒤 제출 |
| hotfix가 회차 출시 branch에 없어 후속 배포에서 사라짐 | Git 분기 | 3.2 | 출시 재개 전에 최신 `main`을 회차 출시 branch에 통합 |
| homepage hotfix와 대규모 리팩토링이 섞임 | 변경 범위 | 범위 밖 | 별도 branch와 별도 PR로 유지 |
| 제출 과정에서 불필요한 개인정보가 첨부됨 | 심사 증거 | 3.1 | 공개 사업자 정보와 필요한 URL만 제출 |

## 🔍 Diagnosis & Findings

- `https://greenlove.co.kr/`의 현재 공개 첫 화면은 `그린러브` 명칭을 표시한다.
- 현재 공개 첫 화면에는 `footer`, 공개 동의된 사업자 필드, 사업자 연락처와 관련 공개 링크가 없다.
- `origin/main`의 consumer 홈은 `BrandHeader`, `HeroBanner`, `HomeProductList`만 조합하고 사업자 정보 구획을 렌더링하지 않는다.
- consumer 공통 layout은 모바일 폭과 고정 하단 navigation을 사용하므로 footer의 마지막 내용이 가려지지 않도록 여백 검증이 필요하다.
- 현재 회차 출시 branch는 `origin/main`보다 consumer 변경 범위가 크므로 카카오 증빙 hotfix와 리팩토링을 같은 branch에서 진행하면 검토·배포 경계가 흐려진다.
- 카카오 증빙 hotfix는 최신 `origin/main`에서 새 branch를 만들고 consumer 파일만 변경하는 것이 가장 작은 배포 단위다.

## 🏗️ Architectural Deepening

- **Branch seam**: `codex/kakao-business-channel-proof`를 최신 `origin/main`에서 생성하고 PR 대상은 `main`으로 고정한다.
- **UI seam**: 사업자 증거를 홈 화면 전용 `BusinessInfoFooter` 컴포넌트로 분리해 상품·결제·회차 상태와 결합하지 않는다.
- **Data seam**: 심사에 사용할 값은 운영 API 응답이 아니라 검증된 공개 사업자 정적 정보로 관리해 로그인·스토어 조회 실패와 무관하게 보이게 한다.
- **Evidence seam**: 홈페이지 공개 확인과 카카오 재신청은 구현 PR과 분리된 승인 게이트로 둔다.
- **Compatibility**: 기존 상품·택배·거점픽업 UI와 route는 변경하지 않고 홈 최하단에 정보 구획만 추가한다.
- **Release**: main hotfix가 승인된 뒤 회차 출시를 재개할 때 해당 commit을 회차 출시 branch에 통합하고 새 출시 SHA로 Task 0.4를 다시 수행한다.
- **Refactor isolation**: 회차 frontend 리팩토링은 hotfix가 통합된 `codex/mvp-sales-round-direct`에서 `codex/mvp-frontend-refactor`를 새로 만들고 PR 대상을 회차 출시 branch로 둔다.

## Agent Completion Contract

1. Task를 Dependency 순서대로 한 번에 하나씩 실행한다.
2. 사업자 정보 원문은 사용자 또는 공식 증빙에서 확인한 값만 사용하며 추정하지 않는다.
3. production 배포, PR 병합과 카카오 재신청은 각각 별도 사용자 승인을 받은 뒤 수행한다.
4. 한 승인으로 이후의 다른 외부 변경까지 포괄하지 않는다.
5. 각 Task의 Verify 종료 코드가 0일 때만 Conclusion과 Status를 닫는다.
6. PLAN 전체 실행 요청 뒤 Blueprint 구조는 고정하고 Conclusion·Status·Closeout만 갱신한다.
7. 회차 출시 branch, API, seller, driver, Firebase, Railway, ALIGO 발송과 운영 판매 데이터는 변경하지 않는다.
8. 사업자 증빙에 필요하지 않은 개인정보·자격 증명·로그 원문을 기록하지 않는다.
9. 오케스트레이터 대화는 작업 대화를 순차 생성하고 완료 결과를 기다린 뒤 성공 시 다음 작업 대화를 자동 생성한다.
10. 작업 대화의 내부 핸드오프에는 worktree 경로, branch·HEAD, 변경 파일, Verify 결과, 원격·PR·배포 상태와 금지 범위를 포함한다.
11. 사용자의 복사·붙여넣기 없이 오케스트레이터가 내부 핸드오프를 다음 작업 대화의 초기 프롬프트에 포함한다.
12. Verify 실패, 예상하지 못한 diff, Git 충돌, 사업자 정본 누락 또는 외부 변경 승인 게이트에서만 자동 진행을 중단한다.
13. 서로 의존하는 쓰기 작업 대화는 동시에 실행하지 않고 직전 작업의 확정 Git 상태에서만 다음 작업을 시작한다.

> **에이전트 스코프**: 사용자가 PLAN 전체 실행을 요청하면 최신 `origin/main` 기반 전용 branch에서 공개 사업자 증거를 구현하고 검증한 뒤 PR·production 배포·카카오 재신청을 각각 승인 게이트로 진행한다. 회차 frontend 리팩토링은 이 PLAN에서 수행하지 않는다.

## Execution Plan

### Phase 0 — 격리 작업공간 준비

#### Task 0.1 — main 기반 전용 worktree와 branch 준비 [승인 게이트]

- **Task-ID**: 0.1
- **Dependency**: 없음
- **Target**: `docs/plans/PLAN_kakao_business_channel_homepage_reapproval.md`
- **Goal**: 최신 `origin/main`에서 `codex/kakao-business-channel-proof`와 전용 worktree를 만들어 회차 출시 작업공간과 분리한다.
- **Verify**: `git status --short --branch`
- **Conclusion**: 통과 — 현재 worktree의 시작 HEAD와 `origin/main`이 `164f65b77e317c41b7e0825377684f0a4db981d4`로 일치했고, 깨끗한 detached HEAD에서 `codex/kakao-business-channel-proof` branch를 생성했다. 원본 PLAN과 이 worktree 사본의 SHA-256이 일치했으며 `git status --short --branch`가 종료 코드 0을 반환했다.
- **Status**: done

### Phase 1 — 공개 증거 계약과 UI

#### Task 1.1 — 사업자·브랜드 증거 정본 확정 [승인 게이트]

- **Task-ID**: 1.1
- **Dependency**: Task 0.1
- **Target**: `docs/specs/ops/kakao-business-channel-proof.md`
- **Goal**: 사업자 증빙과 공개 장소 정보를 대조해 홈페이지에 노출할 `그린러브` 운영 관계와 사업자 필드를 값 단위로 확정한다.
- **Verify**: `git diff --check -- docs/specs/ops/kakao-business-channel-proof.md`
- **Conclusion**: 통과 — 브랜드 `그린러브`, 상호 `디어오키드`, 대표자 `조정연`, 사업자등록번호 `505-28-01702`, 고객센터 `010-4452-2104`, 이메일 `support@greenlove.co.kr`, 운영 관계 문구를 공개 정본으로 확정했다. 공개 미동의인 주거지 주소는 값 자체를 기록하지 않고 footer·문서·PR에서 제외했다. ImprovMX 도메인·별칭 Active, 공개 MX/SPF, 테스트 메일 `DELIVERED`, 기존 홈페이지 A/CNAME과 서비스 응답 유지를 확인했다. 비공개 전달 Gmail 주소·계정 로그인 이메일·등록증 원본 이미지·생년월일도 기록하지 않았고 `git diff --check -- docs/specs/ops/kakao-business-channel-proof.md`가 종료 코드 0을 반환했다.
- **Status**: done

#### Task 1.2 — 사업자 footer 계약 테스트

- **Task-ID**: 1.2
- **Dependency**: Task 1.1
- **Target**: `apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- **Goal**: 공개 필수 필드와 브랜드 운영 문장과 외부 링크 계약을 실패 테스트로 고정한다.
- **Verify**: `node --check apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- **Conclusion**: 통과 — 공개 동의된 사업자 필드 6개, 브랜드 운영 관계 문장, 의미 있는 footer, `tel:`·`mailto:` 링크, 비공개 주소와 미확정 네이버·통신판매업 정보 비노출을 4개 계약 테스트로 고정했다. `node --check apps/consumer/src/components/BusinessInfoFooter.test.mjs`는 종료 코드 0, 구현 전 `node --test`는 대상 컴포넌트 부재로 4/4 실패하며 종료 코드 1을 반환해 RED 상태를 확인했다.
- **Status**: done

#### Task 1.3 — 사업자 footer 구현

- **Task-ID**: 1.3
- **Dependency**: Task 1.2
- **Target**: `apps/consumer/src/components/BusinessInfoFooter.tsx`
- **Goal**: 검증된 사업자 정보와 `그린러브` 운영 관계와 보조 링크를 공개 footer 컴포넌트로 렌더링한다.
- **Verify**: `node --test apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- **Conclusion**: 통과 — 단일 `BUSINESS_INFO` 정적 계약에서 공개 동의된 필드와 운영 관계 문장을 의미 있는 `<footer>`·`<dl>`로 렌더링하고, 비공개 주소는 제외하며 고객센터 전화·이메일을 터치 가능한 링크로 제공했다. `node --test apps/consumer/src/components/BusinessInfoFooter.test.mjs`가 4/4 통과하고 종료 코드 0을 반환했다.
- **Status**: done

#### Task 1.4 — 홈 화면 연결 테스트

- **Task-ID**: 1.4
- **Dependency**: Task 1.3
- **Target**: `apps/consumer/src/app/page.test.mjs`
- **Goal**: 홈 최하단 footer 연결과 고정 navigation 회피 여백을 실패 테스트로 고정한다.
- **Verify**: `node --check apps/consumer/src/app/page.test.mjs`
- **Conclusion**: 통과 — `BusinessInfoFooter`를 상품 목록 다음에 렌더링하고 고정 하단 navigation 위 접근 여백을 `96px`로 확보하는 2개 계약 테스트를 작성했다. `node --check apps/consumer/src/app/page.test.mjs`는 종료 코드 0, 연결 전 `node --test`는 2/2 실패하며 종료 코드 1을 반환해 RED 상태를 확인했다.
- **Status**: done

#### Task 1.5 — 홈 화면 footer 연결

- **Task-ID**: 1.5
- **Dependency**: Task 1.4
- **Target**: `apps/consumer/src/app/page.tsx`
- **Goal**: 공개 홈 최하단에 사업자 footer를 연결해 모바일 navigation 위에서 전체 정보에 접근하게 한다.
- **Verify**: `node --test apps/consumer/src/app/page.test.mjs`
- **Conclusion**: 통과 — 기존 `BrandHeader`·`HeroBanner`·`HomeProductList` 순서를 보존하고 상품 목록 뒤에 `BusinessInfoFooter`를 연결했다. 하단 navigation 회피 여백을 `96px`로 확대했으며 `node --test apps/consumer/src/app/page.test.mjs`가 2/2 통과하고 종료 코드 0을 반환했다.
- **Status**: done

### Phase 2 — 로컬 검증과 main 반영

#### Task 2.1 — consumer 정적 검사

- **Task-ID**: 2.1
- **Dependency**: Task 1.5
- **Target**: `apps/consumer/src/components/BusinessInfoFooter.tsx`
- **Goal**: 신규 footer가 consumer lint 규칙과 접근 가능한 링크 계약을 만족하는지 확인한다.
- **Verify**: `pnpm --filter consumer lint`
- **Conclusion**: 통과 — 승인된 기존 lint error 7건을 동작 보존 최소 변경으로 해소했다. `useCart`와 `useNotifications`는 `forEach` 콜백의 암시적 반환만 제거했고, `useProducts`는 색상 배열의 primitive `colorKey`를 effect 내부 query 생성과 dependency에 함께 사용해 lint 억제 없이 의존성을 일치시켰다. hook scoped lint와 consumer TypeScript, footer 테스트 4/4, 홈 연결 테스트 2/2가 모두 종료 코드 0이다. `pnpm --filter consumer lint`는 error 0·warning 25로 종료 코드 0을 반환했다. warning은 `noUnusedVariables` 1건, `noImgElement` 3건, `noNonNullAssertion` 12건, `noArrayIndexKey` 9건이다.
- **Status**: done

#### Task 2.2 — consumer production build

- **Task-ID**: 2.2
- **Dependency**: Task 2.1
- **Target**: `apps/consumer/src/app/page.tsx`
- **Goal**: 기존 택배·거점픽업 홈을 보존한 consumer production build를 검증한다.
- **Verify**: `pnpm --filter consumer build`
- **Conclusion**: 통과 — `pnpm --filter consumer build`가 compile·TypeScript·정적 페이지 생성 13/13을 완료하고 홈을 포함한 15개 route를 보존한 채 종료 코드 0을 반환했다. webpack cache의 큰 문자열 직렬화 warning은 있었으나 build 산출과 route 생성에는 영향을 주지 않았다.
- **Status**: done

#### Task 2.3 — main 대상 PR 준비 [승인 게이트]

- **Task-ID**: 2.3
- **Dependency**: Task 2.2
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 홈페이지 증빙 변경만 포함한 branch를 push해 `main` 대상 PR의 검토 경계를 만든다.
- **Verify**: `gh pr view --json headRefOid,baseRefName,state,mergeStateStatus`
- **Conclusion**: 통과 — `codex/kakao-business-channel-proof`를 push하고 `main` 대상 PR #12를 생성했다. PR 생성 시 head는 개인정보를 제거하고 공개 `noreply` 메타데이터로 재작성한 checkpoint `64fc033b1e17c2dc5384126d04c930fa58209c3f`, base는 `main`, 상태는 `OPEN`, 병합은 수행하지 않았다. production 배포와 카카오 재신청도 수행하지 않았다.
- **Status**: done

### Phase 3 — 공개 배포와 카카오 재신청

#### Task 3.1 — main 병합과 consumer production 배포 [승인 게이트]

- **Task-ID**: 3.1
- **Dependency**: Task 2.3
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 승인된 홈페이지 증빙 PR을 main에 반영해 consumer production에 공개한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Conclusion**: [판정 — main 반영과 consumer production READY와 배포 SHA 일치 여부. 검증 결과]
- **Status**: todo

#### Task 3.2 — 공개 증거 재조회

- **Task-ID**: 3.2
- **Dependency**: Task 3.1
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 비로그인 production 홈페이지에서 브랜드 관계와 사업자 필드와 보조 링크의 공개 노출을 확인한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Conclusion**: [판정 — 심사자가 접근할 공개 URL의 필수 증거와 모바일 가시성. 검증 결과]
- **Status**: todo

#### Task 3.3 — 카카오 비즈니스 채널 재신청 [승인 게이트]

- **Task-ID**: 3.3
- **Dependency**: Task 3.2
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 공개 홈페이지와 일치하는 최소 증거만 첨부해 `그린러브` 비즈니스 채널 심사를 재신청한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Conclusion**: [판정 — 재신청 접수 상태와 제출 자료의 사업자 일치와 개인정보 최소화. 검증 결과]
- **Status**: todo

#### Task 3.4 — 카카오 심사 결과 반영

- **Task-ID**: 3.4
- **Dependency**: Task 3.3
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 카카오 심사 결과와 추가 보완 요청을 비민감 상태 증거로 기록한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Conclusion**: [판정 — 승인 완료 또는 다음 보완 사유와 후속 담당. 검증 결과]
- **Status**: todo

## Refactor Branch Strategy

- 홈페이지 증빙 hotfix는 `codex/kakao-business-channel-proof`를 최신 `origin/main`에서 만든다.
- 회차 frontend 리팩토링은 `main`이나 `codex/mvp-sales-round-direct`에서 직접 작업하지 않는다.
- 홈페이지 hotfix가 main에 병합된 뒤 그 commit을 `codex/mvp-sales-round-direct`에 먼저 통합한다.
- 통합된 회차 출시 branch에서 `codex/mvp-frontend-refactor`를 새로 만든다.
- 리팩토링 PR의 base는 우선 `codex/mvp-sales-round-direct`로 두어 회차 기능과 함께 검증한다.
- 리팩토링이 회차 출시 branch에 반영되면 새 출시 SHA를 확정하고 Task 0.4 원격 게이트를 다시 실행한다.
- 리팩토링 중 기능·API 계약·운영 데이터 모델 변경은 별도 계획으로 분리한다.

## Completion Criteria

- `greenlove.co.kr`에서 `그린러브`와 운영 사업자의 관계를 로그인 없이 확인할 수 있다.
- 공개 사업자 필드가 사용자 확인 증빙과 정확히 일치한다.
- 네이버 플레이스 링크가 있는 경우 공개 정보가 홈페이지와 일치한다.
- consumer lint와 production build가 통과한다.
- `main` 대상 PR이 홈페이지 증빙 변경만 포함한다.
- consumer production의 배포 SHA와 승인된 main SHA가 일치한다.
- 카카오 재신청이 공개 URL을 근거로 접수된다.
- 회차 출시 branch와 frontend 리팩토링 branch의 경계가 유지된다.

## Closeout Roll-up

- **Status**: checkpoint_committed — Task 2.2 로컬 범위와 단일 checkpoint commit 완료, Task 2.3 승인 게이트 대기
- **사업자 증거 정본**: Task 1.1 공개 필드와 이메일 수신 검증 확정
- **홈페이지 구현**: Task 1.5 footer 연결과 하단 접근 여백 확정
- **로컬 검증**: Task 2.1 lint와 Task 2.2 production build 종료 코드 0
- **main 반영**: Task 3.1에서 확정
- **공개 증거**: Task 3.2에서 확정
- **카카오 재신청**: Task 3.3에서 확정
- **심사 결과**: Task 3.4에서 확정
