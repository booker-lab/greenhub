<!-- Language: ko -->

# 카카오 비즈니스 채널 홈페이지 증빙 작업 REPORT

## 작업 범위

- **worktree**: `C:\Users\tazan\.codex\worktrees\7573\greenhub`
- **branch**: `codex/kakao-business-channel-proof`
- **기준 commit**: `164f65b77e317c41b7e0825377684f0a4db981d4`
- **수행 범위**: Task 0.1부터 Task 2.2까지
- **현재 결과**: Task 2.2까지 로컬 검증과 단일 checkpoint commit 완료

## Task 결과

### Task 0.1 — main 기반 전용 worktree와 branch 준비

- **Status**: done
- 현재 HEAD와 `origin/main`이 기준 commit으로 일치함을 확인했다.
- 기존 diff가 없는 detached HEAD에서 `codex/kakao-business-channel-proof` branch를 생성했다.
- 다른 worktree의 미커밋 PLAN을 읽기만 하고 이 worktree에 동일한 사본을 생성했다.
- 사본 생성 직후 두 PLAN 파일의 SHA-256 일치를 확인했다.
- **Verify**: `git status --short --branch`
- **종료 코드**: 0

### Task 1.1 — 사업자·브랜드 증거 정본 확정

- **Status**: done
- 사용자가 제시한 사업자등록증과 확인 내용에 따라 사업자명 `디어오키드`, 대표자 `조정연`, 브랜드 `그린러브`를 확정했다.
- `그린러브는 디어오키드가 운영하는 화훼 판매 브랜드입니다.` 문구의 공개 승인을 확인했다.
- 네이버 플레이스와 통신판매업 신고번호는 현재 없으므로 홈페이지 노출 대상에서 제외한다.
- 변경된 사업자등록증을 제시받아 사업장 소재지 정정 처리 완료를 확인했다.
- 공개 정본은 `그린러브`, `디어오키드`, `조정연`, `505-28-01702`, `010-4452-2104`, `support@greenlove.co.kr`과 승인된 운영 관계 문구로 확정했다.
- 공개 미동의인 주거지 주소는 값 자체를 기록하지 않고 footer·문서·PR에서 제외했다.
- 네이버 플레이스와 통신판매업 신고번호는 현재 없으므로 홈페이지 노출 대상에서 제외한다.
- ImprovMX 도메인·별칭 Active, 공개 MX/SPF, 테스트 메일 `DELIVERED`, 기존 홈페이지 A/CNAME과 서비스 응답 유지를 확인했다.
- 공개 미동의 주거지 주소, 비공개 전달 Gmail 주소, 계정 로그인 이메일, 사업자등록증 원본 이미지와 생년월일은 저장소·REPORT·PR에 첨부하거나 복사하지 않았다.
- 확정 정본과 이메일 검증 증거는 `docs/specs/ops/kakao-business-channel-proof.md`에 기록했다.
- **Verify**: `git diff --check -- docs/specs/ops/kakao-business-channel-proof.md`
- **종료 코드**: 0

### Task 1.2 — 사업자 footer 계약 테스트

- **Status**: done
- 공개 동의된 사업자 필드, 브랜드 운영 관계, 의미 있는 footer, 고객센터 링크, 비공개 주소와 미확정 외부 증거 비노출을 4개 테스트로 고정했다.
- **Verify**: `node --check apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- **종료 코드**: 0
- **TDD RED**: 구현 전 `node --test apps/consumer/src/components/BusinessInfoFooter.test.mjs` 0통과·4실패, 종료 코드 1

### Task 1.3 — 사업자 footer 구현

- **Status**: done
- 공개 정본을 단일 정적 계약으로 관리하는 Server Component를 구현했다.
- 의미 있는 footer와 사업자 필드, 전화·이메일 링크를 제공하고 미확정 외부 증거는 노출하지 않는다.
- **Verify**: `node --test apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- **결과**: 4통과·0실패
- **종료 코드**: 0

### Task 1.4 — 홈 화면 연결 테스트

- **Status**: done
- footer를 상품 목록 뒤에 렌더링하고 고정 하단 navigation 회피 여백을 확보하는 2개 테스트를 작성했다.
- **Verify**: `node --check apps/consumer/src/app/page.test.mjs`
- **종료 코드**: 0
- **TDD RED**: 연결 전 `node --test apps/consumer/src/app/page.test.mjs` 0통과·2실패, 종료 코드 1

### Task 1.5 — 홈 화면 footer 연결

- **Status**: done
- 기존 브랜드·배너·상품 목록 순서를 보존하고 상품 목록 뒤에 사업자 footer를 연결했다.
- 하단 navigation 회피 여백을 `96px`로 확대했다.
- **Verify**: `node --test apps/consumer/src/app/page.test.mjs`
- **결과**: 2통과·0실패
- **종료 코드**: 0

### Task 2.1 — consumer 정적 검사

- **Status**: done
- **Verify**: `pnpm --filter consumer lint`
- **결과**: 0개 error·25개 warning
- **종료 코드**: 0
- 신규 footer의 `lint/a11y/useAriaPropsSupportedByRole` 오류를 의미 있는 `<footer>`는 유지하고 `aria-label`만 제거하는 방식으로 해결했다.
- `useCart.ts`와 `useNotifications.ts`는 `forEach` 콜백의 암시적 반환을 제거했다.
- `useProducts.ts`는 색상 배열의 primitive `colorKey`를 query 생성과 effect dependency에 함께 사용해 `useIterableCallbackReturn` 1건과 `useExhaustiveDependencies` 4건을 해소했다.
- hook scoped lint와 consumer TypeScript는 각각 종료 코드 0이다.
- footer 테스트 4/4와 홈 연결 테스트 2/2도 각각 종료 코드 0이다.
- warning은 `lint/correctness/noUnusedVariables` 1건, `lint/performance/noImgElement` 3건, `lint/style/noNonNullAssertion` 12건, `lint/suspicious/noArrayIndexKey` 9건이다.

### Task 2.2 — consumer production build

- **Status**: done
- **Verify**: `pnpm --filter consumer build`
- **결과**: compile·TypeScript·정적 페이지 13/13·홈 포함 15개 route 생성 성공
- **종료 코드**: 0
- webpack cache 큰 문자열 직렬화 warning은 있었으나 build 결과에는 영향이 없었다.

## 로컬 checkpoint

- **Status**: done
- Task 2.2까지의 변경을 이 REPORT와 함께 하나의 한국어 메시지 로컬 checkpoint commit으로 마감했다.
- Task 2.3 사전 병렬 검토에서 공개 미동의 주거지 주소와 비공개 Gmail 작성자 메타데이터를 발견했다.
- 주소 값과 footer 노출을 제거하고 공개 `noreply` 작성자 메타데이터로 동일 checkpoint를 로컬 재작성했다.
- 재작성 전 checkpoint는 원격에 push되지 않았다.
- 안전한 checkpoint만 Task 2.3에서 원격에 push했다.

### Task 2.3 — main 대상 PR 준비

- **Status**: done
- branch `codex/kakao-business-channel-proof`를 push하고 `main` 대상 PR #12를 생성했다.
- **PR**: `https://github.com/booker-lab/greenhub/pull/12`
- PR 생성 시 head는 `64fc033b1e17c2dc5384126d04c930fa58209c3f`, base는 `main`, 상태는 `OPEN`, draft는 `false`였다.
- 공개 미동의 주소와 비공개 이메일 메타데이터는 원격 commit에 포함되지 않는다.
- PR 병합·production 배포·카카오 재신청은 수행하지 않았다.
- **Verify**: `gh pr view 12 --json headRefOid,baseRefName,state,mergeStateStatus`

## 외부 상태와 금지 범위 준수

- 안전한 작업 branch push와 PR #12 생성 완료, PR 변경·병합 없음
- Vercel production 배포 없음
- 카카오 재신청 없음
- API·seller·driver·Firebase·Railway·ALIGO 변경 없음
- 회차 출시 branch 변경 없음
- `salesMode`, 회차, 실제 알림 변경 없음
- 공개 미동의 주거지 주소·비공개 전달 Gmail 주소·계정 로그인 이메일·등록증 원본 이미지·생년월일을 기록하지 않음

## 재개 지점

다음 Task는 승인 게이트인 Task 3.1이다. 별도 승인 전에는 PR을 병합하거나 consumer production을 배포하지 않는다.
