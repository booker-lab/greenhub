<!-- Language: ko -->

# 카카오 비즈니스 채널 홈페이지 증빙 작업 REPORT

## 작업 범위

- **worktree**: `C:\Users\tazan\.codex\worktrees\7573\greenhub`
- **branch**: `codex/kakao-business-channel-proof`
- **기준 commit**: `164f65b77e317c41b7e0825377684f0a4db981d4`
- **수행 범위**: Task 0.1부터 Task 3.4 결과 반영 및 후속 홈페이지 보완까지
- **현재 결과**: 반복 반려 원인을 보완해 홈페이지와 채널의 공개 증빙을 강화하고 3차 재심사를 접수했으며, 후속 consumer 홈 증빙 화면 정돈을 로컬에서 완료함

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

- **Status**: 로컬 검증 완료, checkpoint 포함
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
- push, PR 생성·병합, production 배포, 카카오 재신청을 수행하지 않았다. 이메일·DNS·카카오 채널·공개 소식·ALIGO를 변경하지 않았다.
- 비공개 주소·Gmail·로그인 정보·등록증 이미지·생년월일을 새로 기록하지 않았다.

## 외부 상태와 금지 범위 준수

- PR #13과 후속 증빙 PR #14를 merge commit 방식으로 `main`에 병합하고 consumer production만 새 성공 배포로 전환했다.
- PR #14 병합 SHA의 GitHub deployment는 `Production – greenhubconsumer` 1건뿐이며 seller·driver는 배포 경로 필터에 따라 기존 서비스 배포를 유지했다.
- Railway API 경로는 변경하지 않아 새 배포와 restart를 유발하지 않았다.
- 카카오 비즈니스 2차 재심사 반려 뒤 공개 증빙을 보완하고 3차 재심사 접수 완료
- Firebase·ALIGO 변경 없음
- 회차 출시 branch 변경 없음
- `salesMode`, 회차, 실제 알림 변경 없음
- 최신 공식 값이 확인되지 않은 주소·비공개 전달 Gmail 주소·계정 로그인 이메일·등록증 원본 이미지·생년월일을 기록하지 않음

## 재개 지점

Task 4.5에서 채널 소개·상품 소식·공식 채널 링크·정적 대표상품 증거를 보완하고 공개 상태를 검증한 뒤 3차 재심사를 접수했다. 다음 작업은 카카오 결과를 확인해 Task 4.4의 상태를 승인 또는 추가 보완으로 갱신하는 것이다. ALIGO와 회차 출시 계획은 카카오 승인 전까지 계속 보류한다.
