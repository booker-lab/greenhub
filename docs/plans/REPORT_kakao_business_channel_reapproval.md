<!-- Language: ko -->

# 카카오 비즈니스 채널 홈페이지 증빙 작업 REPORT

## 작업 범위

- **worktree**: `C:\Users\tazan\.codex\worktrees\7573\greenhub`
- **branch**: `codex/kakao-business-channel-proof`
- **기준 commit**: `164f65b77e317c41b7e0825377684f0a4db981d4`
- **수행 범위**: Task 0.1부터 Task 3.4 결과 반영 및 후속 홈페이지 보완까지
- **현재 결과**: 2026년 8월 10일 반복 반려 뒤 공개 시험용 상품과 만료 공동구매 문제를 정상화해 consumer·API production 반영과 운영 검증을 완료함

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
- 사용자 확인에 따라 공식 사업자명 `디어 오키드`, 대표자 `조정연`, 브랜드 `그린러브`를 확정했다.
- `카카오톡 채널 ‘그린러브’와 본 화훼 쇼핑몰은 사업자 ‘디어 오키드’가 운영합니다.` 문구의 공개 승인을 확인했다.
- 네이버 플레이스와 통신판매업 신고번호는 현재 없으므로 홈페이지 노출 대상에서 제외한다.
- 주소는 최신 공식 원문을 이 작업에서 확인하지 못했으므로 공개 정본에서 계속 제외했다.
- 공개 정본은 `그린러브`, `디어 오키드`, `조정연`, `505-28-01702`, `010-4452-2104`, `support@greenlove.co.kr`과 승인된 운영 관계 문구로 확정했다.
- 최신 공식 값이 확인되지 않은 주소는 기록하지 않고 footer·문서·PR에서 제외했다.
- 네이버 플레이스와 통신판매업 신고번호는 현재 없으므로 홈페이지 노출 대상에서 제외한다.
- ImprovMX 도메인·별칭 Active, 공개 MX/SPF, 테스트 메일 `DELIVERED`, 기존 홈페이지 A/CNAME과 서비스 응답 유지를 확인했다.
- 미확인 주소, 비공개 전달 Gmail 주소, 계정 로그인 이메일, 사업자등록증 원본 이미지와 생년월일은 저장소·REPORT·PR에 첨부하거나 복사하지 않았다.
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

### Task 3.3 — 카카오 비즈니스 채널 재신청

- **Status**: done
- 2026년 8월 6일 대상 채널 `그린러브`의 비즈니스 재심사를 신청했다.
- 카카오 관리자에서 접수 성공과 `비즈니스 심사가 진행 중이에요` 상태를 재확인했다.
- 안내된 심사 기간은 영업일 기준 3~5일이다.
- 제출 범위는 매장 없음, 공개 사업자등록번호, 기존 완료된 대표자 전자증명, 승인된 운영 관계 문장, `https://greenlove.co.kr/`, 인허가 비대상이다.
- 파일 첨부는 0건이며 고객센터 번호와 이메일은 별도 입력 없이 공개 홈페이지에서 확인할 수 있게 유지했다.
- 비공개 주소·Gmail·로그인 정보·생년월일은 입력하거나 제출하지 않았다.
- 카카오 내부 업체명 표기에 홈페이지 정본과 띄어쓰기 차이가 남아 있으나 사업자등록번호와 대표자는 일치한다. 심사 결과에서 관련 보완 요청이 오는지 Task 3.4에서 확인한다.
- **Verify**: 대상 채널, 요청일, 심사 진행 상태, 제출 링크와 최소 개인정보 범위를 제출 후 재조회

### Task 3.4 — 카카오 심사 결과 반영

- **Status**: done — 반려
- 2026년 8월 6일 카카오 관리자에서 심사 결과가 `반려`로 전환된 사실을 확인했다.
- 반려 사유는 사업자 정보와 채널 운영의 연관성을 확인·검증할 수 없다는 내용이며, 사업자 정보·채널명·판매 콘텐츠를 함께 확인할 수 있는 홈페이지 URL 등의 자료를 요구했다.
- 카카오 사업자정보 화면의 주소는 사업자등록번호 확인 과정에서 자동 표시된 값으로 보이며, 현재 공식 주소인지 검증되지 않아 홈페이지나 저장소에 복사하지 않았다.
- 승인된 후속 조치는 상세 사업자정보 footer를 유지하면서 홈 상단과 상품 목록 사이에 채널·쇼핑몰·사업자의 관계를 직접 표시하는 것이다.
- **Verify**: 카카오 반려 화면의 비민감 사유와 재신청 안내 확인

### 후속 홈페이지 연관성 증거 보완

- **Status**: production 반영 및 재심사 접수 완료
- 공식 상호 띄어쓰기를 `디어 오키드`로 통일했다.
- `PUBLIC_BUSINESS_INFO`를 단일 공개 정본으로 추가해 상단 안내와 footer의 사업자명·대표자·등록번호·연락처·운영 관계 문구가 일치하도록 했다.
- `HeroBanner` 다음, `HomeProductList` 전에 `BusinessRelationshipNotice`를 배치해 심사자가 첫 화면에서 운영 관계를 확인할 수 있게 했다.
- 최신 공식 주소는 확인되지 않았고 공개하지 않았으며, 비공개 Gmail·로그인 정보·사업자등록증 이미지·생년월일도 추가하지 않았다.
- 관련 테스트 10/10, scoped lint, TypeScript, consumer lint(error 0·기존 warning 25), production build, 모바일·데스크톱 브라우저 검증이 모두 통과했다.
- 비공개 Gmail 작성자 메타데이터가 있던 로컬 문서 커밋 2개를 포함해 원격 미반영 3개 커밋의 작성자·커미터를 공개 GitHub `noreply`로 재작성했다. 재작성 전후 파일 트리가 동일함을 확인했다.

### Task 4.2 — 보완분 원격 반영과 consumer production 배포

- **Status**: done
- 안전한 branch head `91b2153fc52ce880c50e0f562349baefa50824f5`를 push하고 `main` 대상 PR #13을 생성했다.
- PR #13의 consumer 미리보기 배포는 성공했고 seller·driver는 Ignored Build Step으로 취소됐다. 모든 검사가 통과한 뒤 merge commit `ff757e6bf9ceea33dc5eda99d7e49342f9724019`로 병합했다.
- GitHub production deployment `5775093449`의 환경은 `Production – greenhubconsumer`, 상태는 성공이며 merge SHA와 일치한다.
- seller·driver production 배포는 생성되지 않았고 Railway API는 `No deployment needed - watched paths not modified`로 기존 활성 배포를 유지했다.
- `https://greenlove.co.kr/`의 원시 HTTP와 실제 브라우저에서 운영 관계 문구, `디어 오키드`, 사업자등록번호, 상품 목록, footer를 확인했다. 과거 붙여쓰기 표기는 production 응답에 없었다.
- **Verify**: PR #13 `MERGED`, merge SHA·production deployment SHA 일치, consumer 배포 성공, 비대상 서비스 미변경, 공개 증거 노출

### Task 4.3 — 카카오 비즈니스 채널 재심사

- **Status**: done — 2차 재심사 반려
- 2026년 8월 6일 `그린러브` 채널의 비즈니스 재심사를 다시 신청했다.
- 카카오 양식의 사업자등록증 업체명은 `디어 오키드`로 홈페이지 정본과 정확히 일치했다. 주소는 재심사 양식에서 요구되지 않았고 입력하거나 제출하지 않았다.
- 매장 없음, 사업자등록번호, 대표자 전자증명 완료, 인허가 비대상을 유지했다.
- 연관성 사유에는 카카오톡 채널·화훼 쇼핑몰을 사업자 `디어 오키드`가 직접 운영하며 홈페이지 첫 화면의 운영 안내, 상품 목록, 하단 사업자정보에서 관계를 확인할 수 있다고 명시했다.
- 링크는 `https://greenlove.co.kr/`만 제출했고 파일 첨부는 0건이다. 비공개 주소·계정 정보·등록증 이미지·생년월일은 추가 제출하지 않았다.
- 최종 화면에서 요청 내용 `비즈니스 재심사 신청`, 요청일 `2026. 8. 6.`, 영업일 기준 평균 3~7일 안내를 확인했다.
- **Verify**: 카카오 재심사 접수 성공 화면과 요청일 확인

### Task 4.4 — 2차 재심사 결과와 반복 반려 원인 확인

- **Status**: done — 반려
- 2026년 8월 6일 카카오 관리자 본문에서 `비즈니스 심사가 반려됐어요` 상태와 이전과 동일한 `사업자-채널의 연관성 확인/검증 불가` 사유를 확인했다.
- 공개 카카오 채널 홈은 채널명 `그린러브`만 표시하고 `등록된 채널 정보가 없습니다` 상태였으며, 채널홈 설정의 소개 문구는 0자였다.
- 공개 홈페이지는 운영 사업자 안내와 footer를 노출하지만 공식 카카오 채널 URL로 가는 링크가 없었다.
- 홈페이지의 전체 상품은 클라이언트 조회 뒤 표시되어 문서가 열린 직후에는 상품 카드가 없고, 약 1초 뒤에야 판매상품 링크가 나타났다. 자동 심사나 짧은 확인에서는 판매 콘텐츠를 확인하지 못할 수 있다.
- 이번 결과로 홈페이지 자체 선언 URL 하나만 반복 제출하는 방식은 중단한다. 다음 재신청 전 채널 소개 문구, 실제 판매상품 소식, 홈페이지와 공식 채널의 상호 링크, 자바스크립트 없이 보이는 대표 판매상품 증거를 먼저 준비한다.
- 최신 공식 주소, 비공개 계정 정보, 등록증 이미지와 그 밖의 민감정보는 새로 수집하거나 기록하지 않았다.
- **Verify**: 카카오 관리자 반려 상태, 공개 채널 홈, 채널홈 소개 설정, 공개 홈페이지 초기·지연 렌더 상태의 읽기 전용 확인

### Task 4.5 — 반복 반려 보완과 3차 재심사 접수

- **Status**: done — 3차 재심사 결과 대기
- 홈페이지 첫 문서에 공식 카카오 채널 링크와 대표 판매상품 `오렌지 글로우`, `빅립`, `만천홍`의 상세 링크를 정적으로 노출하고 metadata에 `그린러브`와 `디어 오키드`의 운영 관계를 반영했다.
- 관련 테스트 14/14, consumer lint error 0·기존 warning 25, consumer production build와 `git diff --check`가 통과했다.
- PR #14의 모든 검사가 통과했고 merge commit `63919226b0f33b98fc6ec788208b36fed76a86f4`로 `main`에 병합했다. consumer production 배포 `5777238917`이 동일 SHA로 성공했다.
- `https://greenlove.co.kr/`에서 metadata 제목, 상단 운영 관계, 공식 채널 링크, 정적 대표상품 3종과 footer 사업자정보를 공개 상태로 확인했다.
- 공개 채널 소개를 `디어 오키드 운영 그린러브`로 갱신하고 운영 관계와 대표 판매상품 3종을 담은 공개 소식 `https://pf.kakao.com/_vGfjX/114197977`을 발행해 로그인 없이 확인했다.
- 카카오 연관성 사유에는 사업자 `디어 오키드`가 화훼 쇼핑몰과 채널 `그린러브`를 직접 운영한다는 점, 홈페이지 첫 화면의 사업자·채널·대표상품 증거, 공개 채널 소식의 실제 상품 상세 링크를 명시했다.
- 링크 항목에는 `https://greenlove.co.kr/`과 공개 채널 소식 주소를 함께 제출했다. 파일 첨부는 0건이며 비공개 주소·계정 정보·등록증 이미지·생년월일은 제출하지 않았다.
- 최종 화면에서 요청 내용 `비즈니스 재심사 신청`, 요청일 `2026. 8. 6.`, 영업일 기준 평균 3~7일 안내를 확인했다.
- **Verify**: PR #14 검사·병합, consumer production 배포 SHA, 운영 홈페이지와 공개 채널 소식, 카카오 3차 재심사 접수 성공 화면 확인

### 후속 consumer 홈 증빙 화면 정돈

- **Status**: done — production 반영 및 운영 화면 검증 완료
- **작업 기준**: branch `codex/kakao-business-channel-proof`, 기준 HEAD `5646a734238ca5ccd57c81825f7f9282e04e4f7b`
- 상단 핵심 문구를 `그린러브는 디어 오키드가 운영하는 화훼 쇼핑몰입니다.`로 정돈하고 공개 정보 정본과 정적 코드 계약을 일치시켰다.
- `BusinessRelationshipNotice`에서 대표자명·사업자등록번호를 포함한 상세 사업자정보 `<dl>`을 제거하고, 공식 카카오톡 채널 동작과 가격·이미지 없는 대표상품 타일 `오렌지 글로우`, `빅립`, `만천홍`만 유지했다.
- 대표자명·사업자등록번호·고객센터·이메일은 기존 `BusinessInfoFooter`에서 계속 제공하며, 홈 순서 `HeroBanner → BusinessRelationshipNotice → HomeProductList → BusinessInfoFooter`는 바꾸지 않았다.
- 정적 증빙 구획은 상품 조회 훅과 연결하지 않아 실제 상품 목록의 빈 상태나 조회 실패와 무관하게 렌더링된다. 상품 API, Firestore 운영 데이터, 시험용 운영 상품, 이미지 데이터는 변경하지 않았다.
- 관련 계약 테스트는 13/13 통과했다. 구현 전에는 새 핵심 문장·타일 구조·상단 상세정보 제거 계약 3건이 의도대로 실패함을 확인했다.
- `pnpm --filter consumer lint`는 종료 코드 0, error 0, 기존 warning 25건으로 통과했다.
- `pnpm --filter consumer build`는 compile·TypeScript·정적 페이지 13/13 생성을 포함해 종료 코드 0으로 통과했다.
- 로컬 production 화면을 데스크톱과 375×812 모바일로 확인했다. 핵심 문구, 대표상품 타일 3개, footer 상세정보, 상품 목록 접근성이 유지됐고 가로 넘침이 없었다.
- 공식 채널 링크는 새 탭에서 `https://pf.kakao.com/_vGfjX`의 `카카오톡채널 - 그린러브`로 열림을 확인했다.
- checkpoint 생성 당시에는 push, PR 생성·병합, production 배포, 카카오 재신청을 수행하지 않았다.
- 비공개 주소·Gmail·로그인 정보·등록증 이미지·생년월일을 새로 기록하지 않았다.
- 후속 요청에 따라 checkpoint `1fb055be49af0ebdab58a2e8e651ad7e51f5eabe`를 push하고 `main` 대상 PR #15를 생성했다. consumer 미리보기 배포가 성공했고 seller·driver는 Ignored Build Step으로 취소됐다.
- PR #15의 검사가 모두 통과한 뒤 merge commit `8c1707aebbd877d44c6b0568a77c8eb7482011f5`로 병합했다. GitHub production deployment `5781274942`와 Vercel 배포 `dpl_Czsh6iubchy5hkzPQr5RJ3wQ4UMj`가 성공했고 `https://greenlove.co.kr/` 별칭이 해당 배포를 가리킨다.
- 운영 도메인을 데스크톱과 375×812 모바일로 확인했다. 새 핵심 문구, 공식 카카오톡 채널, 대표상품 타일 3개, 상품 목록, footer 상세정보가 순서대로 노출됐고 가로 넘침이 없었다.
- 배포 후 최근 1시간 Vercel error 로그는 0건이었다. 카카오 재신청과 이메일·DNS·카카오 채널·공개 소식·ALIGO 변경은 수행하지 않았다.

### Task 4.6 — 반복 반려 후 공개 판매상품 정상화

- **Status**: production 반영 및 운영 검증 완료
- 2026년 8월 10일 카카오 비즈니스 채널 심사가 이전과 같은 `사업자-채널의 연관성 확인/검증 불가` 사유로 다시 반려된 사실을 확인했다.
- 카카오 안내는 사업자 정보, 채널명, 콘텐츠 또는 판매상품을 한 자료에서 함께 확인할 수 있어야 한다는 조건을 다시 명시했다.
- 운영 홈의 진행 중 공동구매와 전체 상품에 고정 E2E 상품이 노출되고, 시험용 문구와 테스트 상점이 실제 판매 콘텐츠에 섞인 상태를 확인했다.
- 운영 Firestore의 정확한 대상 두 건을 읽기 전용으로 확인한 뒤 삭제하지 않고 `isActive=false`, `testOnly=true`로 원자적으로 변경했으며 적용 후 같은 값을 재조회했다.
- 복구 스크립트는 정확한 `e2e-` 대상 두 건만 허용하며 `--restore` 실행 시 공개 제외 표식을 유지한 채 활성 상태만 되돌린다.
- 공개 상품 목록 API는 활성 공개 상품만 반환하고 `testOnly=true`를 제외한다. 공개 상품 상세도 비활성·시험용 상품을 상품 없음으로 처리한다.
- E2E 시드는 두 상품에 `testOnly=true`를 강제하고 실제 소비자 배송 슬롯을 만들 상점을 고를 때 시험용 상품을 제외한다.
- 공동구매 상태 판정을 shared 함수로 통합해 목표 수량, 모집기한, 설정 누락을 홈·공구 목록·상품 카드·상세에서 일관되게 처리한다.
- 만료 또는 설정 누락 공동구매 상세에서는 장바구니와 결제 동선을 모두 비활성화하고 상태 문구를 구분한다.
- shared 테스트 9/9, API 테스트 6/6, consumer·시드 계약 테스트 18/18, consumer TypeScript, API build, consumer production build가 통과했다.
- consumer lint는 오류 0건과 기존 경고 25건으로 통과했다. API 서비스 범위 lint는 기존 `any` 관련 오류가 다수 있어 기준 검사로 사용하지 않았으며 새 테스트 파일 자체 lint는 통과했다.
- 현재 운영 홈에서는 DB 비활성화 뒤 E2E·검증용 문구 미노출, 운영 관계 문구, 공식 채널 링크, 실제 상품 링크, 모바일 가로 넘침 부재와 콘솔 오류 0건을 확인했다.
- 기존 배포의 만료 공동구매 상세에서 결제 버튼은 비활성이지만 장바구니 버튼이 활성인 문제를 재현했으며, 새 코드에서는 두 동선을 모두 차단한다.
- 코드 commit `f04a3458747d83a41c693efab13b7e48704fbc6f`를 push하고 main 대상 PR #17을 생성했다. 작성자 메타데이터 오류로 Vercel 검사가 한 번 즉시 실패했으나 이전 성공 commit의 공개 `noreply` 메타데이터로 파일 트리 변경 없이 바로잡았다.
- PR #17의 consumer·seller·driver Vercel 검사가 모두 통과한 뒤 merge commit `098ad98c72a8bdcb5e3c1a95ed2c6b3287cf0ab2`로 병합했다.
- consumer production 배포 `dpl_H9YdEa8HWd5PkM1PKZTw6g7EF3Fo`가 Ready이고 운영 도메인 별칭이 연결됐다.
- 필요한 공개 API 방어를 포함한 Railway production 배포 `d054f564-5fc7-4656-816b-7c05578e260e`가 같은 merge SHA로 성공했다.
- 운영 API는 공개 상품 5건, E2E 상품 0건을 반환했다. `isActive=false` 요청도 같은 공개 목록을 반환했고 E2E 상세 두 건은 모두 404였다.
- 운영 데스크톱과 375×812 모바일에서 관계 문구, 공식 채널, E2E·검증용 문구 미노출, 진행 중 공동구매 구획에서 만료 상품 제외, 만료 표시, 실제 일반상품 3종, 가로 넘침 부재를 확인했다.
- 만료 공동구매 상세에서는 장바구니와 참여 버튼이 모두 비활성이고 `모집 마감`이 표시됐다. 실제 일반상품 상세에서는 운영 관계와 활성 장바구니 동선을 확인했다.
- 배포 후 consumer Vercel 오류 로그는 0건이고 Railway 배포 오류와 5xx 로그도 0건이다.
- 예상과 달리 `packages/shared` 변경이 공통 빌드 경로로 인식되어 seller production `dpl_5CdhRd1XAW7LFxUTiEe2HHY7qTqP`와 driver production `dpl_FZbbKMh362QGayFyeTNLTBSU5cKi`도 자동 생성됐다. 두 배포는 같은 merge SHA에서 Ready, 각 공개 도메인은 HTTP 200, 최근 1시간 오류 로그는 0건이다. 추가 수동 배포나 rollback은 수행하지 않았다.
- 카카오 재신청과 카카오 채널·이메일·DNS·ALIGO·공개 소식 변경은 수행하지 않았다.
- 운영 화면 캡처에서 배너 이미지가 깨져 보이는 상태를 추가 진단했다. 배너 API에는 Firebase Storage 이미지가 설정돼 있지만 원본 요청이 HTTP 402를 반환한다. E2E 상품 정상화와 별개의 운영 콘텐츠 변경이므로 이번에는 수정하지 않았고 사용자 승인 뒤 이미지 교체 또는 설정 제거가 필요하다.

## 외부 상태와 금지 범위 준수

## 후속 consumer 운영 이미지 복구

### 이미지 복구 Task 0.1 — 작업공간 기준선 확인

- **Status**: done
- 지정 worktree의 branch는 `codex/kakao-business-channel-proof`, HEAD는 `0a02b31806812e85104a409f4284302f64e38c17`로 기준과 일치했다.
- 작업 트리에는 예상된 미추적 문서 `docs/plans/PLAN_consumer_image_recovery.md`, `docs/plans/PROMPT_consumer_image_recovery.md`만 있었다.
- 작업 트리 diff와 staging diff는 모두 비어 있었고 branch는 원격 작업 branch보다 2개 commit 앞선 상태였다.
- **Verify**: `git status --short --branch`, `git diff`, `git diff --cached`
- **종료 코드**: 모두 0

### 이미지 복구 Task 0.2 — Storage 오류와 결제 상태 확정

- **Status**: done
- 운영 배너와 공개 상품 5개 대표 이미지 원본을 전체 주소와 토큰을 출력하지 않는 방식으로 재조회했다.
- 6개 원본은 모두 호스트 `firebasestorage.googleapis.com`, HTTP 402, 콘텐츠 형식 `application/json`을 반환했다.
- 한 원본의 오류 본문을 구조화해 확인한 결과 오류 코드는 402이고, 소유 프로젝트에 연결된 결제 계정이 `closed` 상태라 비활성이라는 내용이었다.
- Firebase 콘솔에 표시된 현재 요금제는 `Spark`였다.
- Firebase 프로젝트 자체는 활성 상태지만 Cloud Billing 계정은 연결된 채 닫혀 있었고 `billingEnabled=false`였다. 결제 계정 식별자와 결제수단 정보는 조회 결과에 기록하지 않았다.
- Firebase 공식 문서에 따르면 2026년 2월 3일부터 기존 기본 버킷을 포함한 Cloud Storage for Firebase 접근에는 Blaze 요금제가 필요하고, Spark 프로젝트의 요청은 402 또는 403으로 실패한다.
- 기존 사진 접근 복구에는 닫힌 Cloud Billing 계정을 다시 열거나 다른 활성 계정을 연결해 Blaze로 전환해야 한다. 이 변경은 비용 발생 가능성이 있어 사용자 승인 전에는 수행하지 않는다.
- 기존 `*.appspot.com` 기본 버킷은 Blaze에서도 저장 5GB, 다운로드 1GB/일, 업로드 20,000회/일, 다운로드 50,000회/일의 무료 사용량을 유지하며 초과분은 사용량 기준으로 청구된다.
- 예산과 예산 알림은 사용량이나 비용을 자동 차단하지 않으며 알림 도착이 지연될 수 있다. 승인 시 프로젝트 한정 월 예산과 낮은 초기 임계값을 함께 설정하는 방안을 적용한다.
- **공식 근거**: `https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024`, `https://firebase.google.com/docs/projects/billing/firebase-pricing-plans`, `https://firebase.google.com/docs/projects/billing/avoid-surprise-bills`, `https://cloud.google.com/billing/docs/how-to/verify-billing-enabled`
- **외부 변경**: 없음. Firebase 플랜·Billing·결제수단·예산은 변경하지 않았다.
- **Verify**: 원본 6건 읽기 전용 HTTP 조회, Firebase 콘솔 플랜 조회, Firebase CLI 프로젝트 조회, Cloud Billing CLI 상태 조회
- **종료 코드**: 모두 0

### 이미지 복구 Task 0.3 — 승인된 Firebase Storage 접근 복구

- **Status**: done
- 사용자의 명시적 승인 뒤 운영 프로젝트 `green-e4fe3`를 기존 활성 Cloud Billing 계정에 연결했다.
- Cloud Billing은 `billingEnabled=true`, 연결 계정은 `open=true`, Firebase 콘솔은 `Blaze / 사용한 만큼만 지불`로 전환된 것을 확인했다.
- 운영 프로젝트만 범위로 한정한 월 10,000원 예산 `그린러브 운영 월 예산`을 만들고 실제 비용 10·50·90·100%에서 결제 관리자·사용자에게 알리도록 설정했다.
- 예산 알림은 비용을 자동으로 차단하지 않고 도착이 지연될 수 있다. 결제수단과 다른 프로젝트·결제 계정은 변경하지 않았다.
- **외부 변경**: 운영 프로젝트의 Billing 연결과 Blaze 활성화, 프로젝트 한정 예산 알림 1건
- **Verify**: Cloud Billing CLI 읽기, Firebase 콘솔 플랜 확인, 예산 생성 성공 화면

### 이미지 복구 Task 0.4 — 기존 원본 재검증

- **Status**: done
- 주소와 다운로드 토큰을 출력하지 않는 읽기 전용 검증기 `apps/consumer/scripts/verify-public-images.mjs`를 추가했다.
- 운영 배너와 활성 상품 5개는 모두 호스트 `firebasestorage.googleapis.com`, HTTP 200, 콘텐츠 형식 `image/png`으로 복구됐다.
- 검사 6건 중 정상 6건, 실패·누락 0건이었다. 기존 상품·배너·스토어 DB 주소와 Storage 객체는 변경하지 않았다.
- **Verify**: `node --check apps/consumer/scripts/verify-public-images.mjs`, `node apps/consumer/scripts/verify-public-images.mjs`
- **종료 코드**: 모두 0

### 이미지 복구 Task 1.1~1.9 — consumer 실패 대체 처리

- **Status**: done
- 구현 전에 배너 숨김, 상품 로컬 대체 이미지, 자유 비율 상세 이미지 숨김, 스토어 첫 글자 아바타 계약을 추가했다. 문법 검사는 통과했고 공통 컴포넌트 부재로 의도한 RED를 확인했다.
- 좁은 `'use client'` 경계의 `ResilientImage`를 추가해 원본 실패를 화면별 대체 상태로 한 번만 전환하고, 대체 이미지도 실패하면 최종 숨김으로 종료하도록 했다.
- `HeroBanner`, `ProductCard`, `HomeProductList`, `DeadlineSection`, `ProductImages`, `ProductInfo`, `ProductActions`에 적용했다.
- 배너는 사진 실패 시 문구와 버튼을 유지하고, 상품은 기존 로컬 아이콘을 사용하며, 자유 비율 상세 이미지는 실패 요소만 숨긴다. 스토어 로고 미등록과 실패는 동일한 상호 첫 글자 아바타를 사용한다.
- `packages/shared`, API, seller, driver와 운영 DB는 변경하지 않았다.
- **Verify**: `node --test apps/consumer/src/components/ResilientImage.test.mjs`
- **결과**: 5/5 통과

### 이미지 복구 Task 2.1~2.3 — 자동 검증

- **Status**: done
- 이미지 계약과 기존 상품 상태·운영 관계·홈 계약은 17/17 통과, 실패 0건이었다.
- `pnpm --filter consumer exec tsc --noEmit`은 종료 코드 0으로 통과했다.
- `pnpm --filter consumer lint`는 오류 0건, 경고 23건으로 통과했다. 기준 25건보다 2건 줄었고 새 경고는 없다.
- Next.js 16.2.5 production build는 compile·TypeScript·정적 페이지 13/13 생성을 포함해 종료 코드 0으로 통과했다.
- `git diff --check`도 종료 코드 0으로 통과했다.
- React 검토에서는 Client Component 경계, 함수형 상태 전환, 대체 텍스트, `sizes`와 `preload` 유지에 새 접근성·상태·성능 회귀가 없음을 확인했다.

### 이미지 복구 Task 2.4 — 배포 후보 화면 검증

- **Status**: done
- Vercel 미리보기 `dpl_EbiC6jebymZswZCcvVcCADNgZMuc`를 만들고 API CORS가 허용하는 팀 범위의 임시 미리보기 별칭에서 확인했다. 검증 뒤 임시 별칭은 제거했다.
- 데스크톱과 375×812 모바일 홈에서 배너와 활성 상품 5개 이미지의 실제 크기가 모두 0보다 컸고, 가로 넘침과 애플리케이션 오류가 없었다.
- 공개 상품 상세 5개 모두 대표·상세 이미지가 양수 크기로 표시됐고, 스토어 로고는 뷰포트 진입 뒤 48×48로 로드됐다. 처음 관찰한 `0×0`은 화면 아래 lazy-load 대기 상태였으며 프록시 응답 200 `image/png`, 자체 디코딩 96×96, 스크롤 뒤 실제 크기 48×48로 확인했다.
- 강제 실패 시 배너 사진만 제거되고 문구와 두 버튼은 유지됐다. 상품 5개는 로컬 대체 이미지로 전환됐고 상세 대표는 대체 이미지, 자유 비율 상세 이미지는 숨김, 스토어 로고는 `디` 첫 글자 아바타로 전환됐다.
- 대체 이미지 자체 실패를 다시 발생시켜 이미지 영역이 최종 숨김으로 종료되고 깨진 이미지 0건인 것을 확인했다.
- 모바일 강제 실패에서도 같은 결과와 가로 넘침 없음, 브라우저 애플리케이션 오류 0건을 확인했다.
- Vercel 보호 화면의 Google 로그인 위젯에서 발생한 FedCM 경고·오류는 보호 우회 쿠키 설정 전 로그인 화면에 한정됐고 consumer 애플리케이션 오류가 아니다. 실제 검증 세션에서는 이를 분리해 판단했다.

### 이미지 복구 Task 3.1 — checkpoint와 PR 생성

- **Status**: done
- 공개 GitHub noreply 메타데이터와 한국어 메시지로 checkpoint `936a5c9`를 만들고 작업 branch에 push했다.
- main 대상 PR #18을 생성했고, consumer·seller·driver Vercel 검사와 Preview Comments가 모두 성공했다.
- 최초 검증기는 루트 `scripts/**`에 있어 seller·driver Ignore 명령의 공통 영향 경로로 판정됐다. 그 결과 비대상 미리보기가 실제 생성됐으며 상태만 기록하고 rollback하지 않았다.
- production의 비대상 배포를 막기 위해 검증기를 내용 변경 없이 `apps/consumer/scripts/verify-public-images.mjs`로 옮기고 한국어 commit `d7afe55`로 push했다.
- 경로 이동 commit도 루트 파일 삭제 자체 때문에 비대상 미리보기가 한 번 더 생성됐지만, PR의 main 대비 최종 diff에는 루트 `scripts/**`가 없고 `apps/consumer/**`와 문서만 남았다.
- 문서 전용 최신 commit `9be3473`에서 consumer 미리보기는 성공했고 seller·driver는 모두 `Canceled by Ignored Build Step`으로 종료됐다.

### 이미지 복구 Task 3.2 — main 병합과 consumer production 배포

- **Status**: done
- PR #18의 모든 검사가 통과한 뒤 merge commit `e6c2138e3c969616e19f2ba8882c1842a3cf0dfb`로 main에 병합했다.
- consumer production 배포 `dpl_9LQkxbkSpuHQwYnPTSYdg5L2g14g`와 GitHub deployment `5863377298`은 merge SHA와 일치하고 READY·성공 상태다. `greenlove.co.kr`을 포함한 운영 별칭이 연결되고 원시 HTTP 200을 확인했다.
- seller production 후보 `dpl_3D2gAGP2d6Evez3fQmgsiLnN1wKE`와 driver 후보 `dpl_DSTjpvqChdJKTdrA5nNPsmVUc7td`는 Ignored Build Step으로 취소됐다.
- seller·driver 최신 production은 이전 SHA `098ad98c`의 deployment를 유지했다. Railway API 최신 production deployment도 2026년 8월 11일의 같은 이전 SHA를 유지해 새 배포나 restart가 없었다.

### 이미지 복구 Task 3.3 — 운영 이미지와 로그 재검증

- **Status**: done
- 운영 배너와 활성 상품 5개 원본은 6/6 HTTP 200, `image/png`이었다. 전체 주소와 토큰은 기록하지 않았다.
- 운영 Next 이미지 프록시는 배너 기준 HTTP 200, `image/png`을 반환했다.
- 데스크톱과 375×812 모바일 홈에서 배너와 상품 5개가 모두 양수 실제 크기로 표시됐고 깨진 이미지 0건, 가로 넘침 없음이었다.
- 공개 상품 상세 5개 모두 대표·상세 이미지와 공통 스토어 로고가 양수 실제 크기로 표시됐고 깨진 이미지 0건, 가로 넘침 없음이었다.
- 브라우저 애플리케이션 콘솔·페이지 오류는 0건이었다. consumer Vercel 최근 1시간 런타임 오류와 production 배포 5xx 집계도 0건이었다.
- 운영 DB의 상품·배너·스토어 주소와 문서, Storage 객체는 변경하지 않았다.

### 이미지 복구 Task 3.4 — closeout과 외부 상태

- **Status**: done
- Firebase 운영 프로젝트는 승인된 활성 Billing 계정에 연결된 Blaze 상태이며 프로젝트 한정 월 10,000원 예산과 실제 비용 10·50·90·100% 알림이 설정됐다.
- 다른 Firebase 프로젝트·결제 계정과 결제수단은 변경하거나 닫지 않았다.
- 카카오 재신청, 카카오 채널·이메일·DNS·ALIGO·공개 소식은 변경하지 않았다.
- 기능·배포 작업은 완료됐고 남은 운영 위험은 예산 알림이 비용을 차단하지 않으며 지연될 수 있다는 점, Firebase 무료 사용량 초과 시 사용량 기반 비용이 발생할 수 있다는 점이다.

## 후속 consumer 사업자 푸터 정돈

### 사업자 푸터 Task 1.1~2.4 — 공개 정본과 구현·자동 검증

- **Status**: 배포 후보 구현 및 자동 검증 완료
- **작업 기준**: branch `codex/kakao-business-channel-proof`, 기준 HEAD `9ec03b3b624b705bfce690cc01b594d73e04b90f`
- 사용자가 제시한 최신 사업자등록증과 재확인을 통해 공개 주소를 `경기도 이천시 백사면 도지리 543-2`로 확정했다. 증명서 원본과 발급번호·주민등록번호·등록일 같은 불필요한 정보는 저장소에 복사하지 않았다.
- 공개 사업자 정본에 호스팅서비스 제공자 `Vercel Inc.`와 상담가능시간 `09:00~18:00 (점심시간 12:00~13:00)`을 추가했다. 확인되지 않은 상담 요일과 통신판매업 신고번호는 만들거나 노출하지 않았다.
- 상단의 `그린러브는 디어 오키드가 운영하는 화훼 쇼핑몰입니다.` 문장은 유지하고 footer에서는 같은 문장을 제거했다.
- footer는 상호·대표·주소·사업자등록번호·호스팅서비스 제공자·이메일·고객센터·상담가능시간을 줄바꿈 가능한 정의 목록으로 렌더링한다. 전화와 이메일은 각각 `tel:`·`mailto:` 링크이며 44px 높이의 터치 영역을 유지한다.
- 설치된 Next.js 16.2.5 문서에 따라 상태·이벤트·브라우저 API가 없는 footer를 Server Component로 유지했다.
- 푸터·상단 안내·홈 배치 계약 테스트는 14/14 통과했다. consumer lint는 오류 0건과 기존 경고 23건으로 통과했고 production build는 compile·TypeScript·정적 페이지 13/13 생성까지 종료 코드 0으로 통과했다.
- `git diff --check`는 종료 코드 0이었고 변경 범위는 consumer footer·계약·공개 정본과 카카오 공개 증빙·계획·보고서 문서로 한정했다.

### 사업자 푸터 Task 3.1 — 배포 후보 화면 검증

- **Status**: 로컬 화면 검증 완료, 원격 반영 대기
- 데스크톱과 375×812 모바일에서 공개 필드 8개가 모두 보이고 운영 관계 문장은 상단에만 1회 표시되며 footer 안에는 반복되지 않는 것을 확인했다.
- 375×812에서 문서 너비가 뷰포트를 넘지 않았고 주소·이메일·상담시간이 안전하게 줄바꿈됐다. 이메일과 고객센터 링크는 각각 44px 높이였다.
- 로컬 기본 실행은 환경 파일이 없어 Auth.js 설정 오류와 로컬 API 404가 발생했다. 저장소나 운영 설정을 바꾸지 않고 검증 프로세스에만 더미 인증값과 공개 운영 API 주소를 주입해 다시 확인한 결과 브라우저 콘솔 오류·경고는 0건이었다.
- 이 시점에는 checkpoint·push·PR·main 병합·production 배포를 수행하지 않았다. 카카오 재신청과 카카오 채널·이메일·DNS·ALIGO·공개 소식도 변경하지 않았다.

### 사업자 푸터 Task 3.2~3.3 — 원격 반영과 운영 재검증

- **Status**: production 반영 및 운영 검증 완료
- 공개 GitHub `noreply` 메타데이터와 한국어 메시지로 checkpoint `8898102bd451870255e22cbf263e683f33a83668`을 만들고 작업 branch에 push했다.
- main 대상 PR #22의 consumer 미리보기와 Preview Comments가 성공했다. seller·driver 미리보기는 모두 Ignored Build Step으로 취소됐고 실제 배포되지 않았다.
- PR #22의 모든 검사가 통과한 뒤 merge commit `0a73f9360e287e3ae95c5cc7af59f18af0c4c35c`로 main에 병합했다.
- consumer production GitHub deployment `5958653908`이 성공했고 Vercel 배포 `dpl_Bnn4DCf77F1rLE9sVRwojrXHF3bR`가 `Ready` 상태다. `greenlove.co.kr`, `www.greenlove.co.kr`과 기본 Vercel 별칭이 연결됐고 운영 응답은 HTTP 200, `text/html`이었다.
- 운영 데스크톱과 375×812 모바일에서 공개 필드 8개, 상단 운영 관계 문장 1회, footer 안 관계 문장 0회를 확인했다. 가로 넘침과 깨진 이미지가 없고 전화·이메일 링크는 올바른 `tel:`·`mailto:` 주소와 44px 높이를 유지했다.
- 운영 브라우저 콘솔 오류·경고는 0건이고 consumer Vercel 최근 1시간 error 로그도 0건이었다.
- merge SHA의 GitHub deployment는 consumer production 1건뿐이다. Railway API 후보 `ea1f214a-9ae2-4165-ae27-0929a3e56094`는 `No changes to watched files`로 건너뛰었고, 활성 production은 이전 SHA `098ad98c`의 `d054f564-5fc7-4656-816b-7c05578e260e`를 유지했다.
- 운영 DB와 Firebase 플랜·Billing·Storage, 카카오 재신청·채널, 이메일·DNS·ALIGO·공개 소식은 변경하지 않았다.

- PR #13, 후속 증빙 PR #14와 화면 정돈 PR #15를 merge commit 방식으로 `main`에 병합하고 consumer production만 새 성공 배포로 전환했다.
- PR #15 병합 SHA의 GitHub deployment는 `Production – greenhubconsumer` 1건뿐이며 seller·driver는 배포 경로 필터에 따라 기존 서비스 배포를 유지했다.
- Railway API 경로는 변경하지 않아 새 배포와 restart를 유발하지 않았다.
- 카카오 비즈니스 2차 재심사 반려 뒤 공개 증빙을 보완하고 3차 재심사 접수 완료
- Firebase·ALIGO 변경 없음
- 회차 출시 branch 변경 없음
- `salesMode`, 회차, 실제 알림 변경 없음
- 최신 공식 값이 확인되지 않은 주소·비공개 전달 Gmail 주소·계정 로그인 이메일·등록증 원본 이미지·생년월일을 기록하지 않음

## 재개 지점

Task 4.5에서 채널 소개·상품 소식·공식 채널 링크·정적 대표상품 증거를 보완하고 공개 상태를 검증한 뒤 3차 재심사를 접수했다. 다음 작업은 카카오 결과를 확인해 Task 4.4의 상태를 승인 또는 추가 보완으로 갱신하는 것이다. ALIGO와 회차 출시 계획은 카카오 승인 전까지 계속 보류한다.
