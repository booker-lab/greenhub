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

### Task 3.1 — main 병합과 consumer production 배포

- **Status**: done
- PR #12의 최종 head `b14c55db7be50c035248eda4a350b0c57226c1f8`을 merge commit `3345c27f949abcd1107b8030be346b58198e6b64`로 `main`에 반영했다.
- consumer production 배포 `dpl_GTh9LYV6BUa128DefU9E1qsuez2p`가 merge SHA `3345c27f949abcd1107b8030be346b58198e6b64`로 `READY`이고 공개 별칭도 해당 배포를 가리킨다.
- seller·driver의 Ignored Build Step과 Railway API Watch Paths를 승인된 경계로 설정한 뒤 병합 전 production 배포 식별자를 고정했다.
- seller와 driver는 merge SHA에 대한 `CANCELED` 기록이 각각 1건 생성됐지만 빌드와 production 별칭 전환은 차단됐고, 기존 `READY` production 배포를 유지했다.
- Railway API는 merge commit을 `No changes to watched files`로 건너뛰었고 기존 활성 배포 `c59bfad1-52e8-4ca7-aaab-4dd4b60e0fc1`을 유지했다.
- **Verify**: PR 상태 `MERGED`, `origin/main` SHA와 merge commit 일치, consumer production SHA와 상태 일치, seller·driver·API 기존 서비스 배포 유지

### Task 3.2 — 공개 증거 재조회

- **Status**: done
- `https://greenlove.co.kr/`은 깨끗한 비로그인 환경에서 HTTP 200으로 열리고 로그인 화면 없이 홈과 footer를 표시한다.
- 브랜드-사업자 운영 관계, 공개 사업자 정본, 전화 링크와 `mailto:support@greenlove.co.kr` 링크를 확인했다.
- 공개 미동의 주소 문자열은 배포본에 없었다.
- 390×844 모바일 최하단에서 footer 증빙과 고정 하단 navigation 사이 약 120px 간격을 확인해 마지막 증빙 링크까지 가려지지 않았다.
- 기존 방문 이력이 있는 브라우저에서는 구버전 로그인 화면이 일시 관찰됐으나, 원시 HTTP 응답과 깨끗한 비로그인 환경은 최신 production을 정상 표시했다.
- **Verify**: 비로그인 HTTP 200, 공개 정본 노출, 연락 링크, 비공개 주소 부재, 모바일 footer 접근성 확인

## 외부 상태와 금지 범위 준수

- PR #12를 merge commit 방식으로 `main`에 병합하고 consumer production만 새 `READY` 배포로 전환했다.
- seller·driver는 배포 경로 필터가 빌드와 production 전환을 차단해 기존 서비스 배포를 유지했다.
- Railway API는 Watch Paths가 변경 없는 병합을 건너뛰어 새 배포와 restart가 없었다.
- 카카오 재신청 없음
- Firebase·ALIGO 변경 없음
- 회차 출시 branch 변경 없음
- `salesMode`, 회차, 실제 알림 변경 없음
- 공개 미동의 주거지 주소·비공개 전달 Gmail 주소·계정 로그인 이메일·등록증 원본 이미지·생년월일을 기록하지 않음

## 재개 지점

다음 Task는 승인 게이트인 Task 3.3이다. 별도 승인 전에는 카카오 비즈니스 채널 재신청을 수행하지 않는다.
