<!-- Language: ko -->

# consumer 상품 상세 사업자 연락처 전환 인계

## 현재 상태

- worktree: `C:\Users\tazan\.codex\worktrees\7573\greenhub`
- branch: `codex/kakao-business-channel-proof`
- 최종 기능 HEAD: `d8b545487babde1babfb79e57cef846e21d9503d`
- 기능 main 병합 SHA: `7617b987ded9cc26c2b22359cbdca5b205de82a8`
- 기능 PR: #20, `MERGED`
- 기능 commit과 원격 push 뒤 작업 트리와 staging은 비어 있었다.
- 이 인계 문서 commit은 문서 자체가 자신의 SHA를 포함할 수 없으므로 최종 응답과 `git log -1`에서 확인한다.

## 수행한 변경

- `apps/consumer/src/lib/publicBusinessInfo.ts`
  - 사용자가 공개를 확인한 공식 사업자 주소를 사업자 정보 정본에 추가했다.
- `apps/consumer/src/app/products/[id]/_components/ProductActions.tsx`
  - 판매자 정보의 주소와 전화번호를 스토어 문서 값 대신 `PUBLIC_BUSINESS_INFO`에서 표시한다.
  - 스토어명, 대표자명, 로고와 로고 실패 시 첫 글자 아바타는 기존 동작을 유지한다.
- `apps/consumer/src/app/products/[id]/_components/ProductActions.test.mjs`
  - 상품 상세가 사업자 정본의 주소·전화번호를 사용하고 스토어 연락처를 사용하지 않는 계약을 추가했다.
- `apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- `apps/consumer/src/components/BusinessRelationshipNotice.test.mjs`
  - 이전의 주소 미공개 계약을 사용자가 확인한 공개 사업자 주소 계약으로 갱신했다.
- `packages/shared`, API, seller, driver 코드는 변경하지 않았다.

## 수행한 검증과 결과

- 변경 전 계약 실패를 확인한 뒤 구현했다.
- consumer 전체 계약 테스트: 24/24 통과.
- `pnpm --filter consumer lint`: 오류 0건, 기존 경고 23건.
- `pnpm --filter consumer build`: Next.js 16.2.5 compile·TypeScript·정적 페이지 13/13 통과.
- `git diff --check`: 통과.
- 로컬 상품 상세는 로컬 API·Auth 환경변수 부재로 404여서 데이터 화면 검증에 사용하지 않았다.
- consumer 미리보기 배포는 `READY`였지만 Vercel 인증 보호 화면 때문에 육안 검증에 사용하지 않았다.
- 운영 데스크톱 1440×1000:
  - 대표 공개 상품 상세에서 판매자 정보, 사업자 주소, 사업자 전화번호 표시 확인.
  - 가로 넘침과 오류 화면 없음.
- 운영 모바일 375×812:
  - 같은 판매자 정보와 주소·전화번호 표시 확인.
  - 가로 넘침과 오류 화면 없음.
- 운영 도메인 브라우저 콘솔 오류 0건.
- consumer Vercel 최근 1시간 런타임 오류 0건.

## commit·push·PR·배포

- 기능 commit: `d8b5454` — `fix(consumer): 판매자 연락처를 사업자 정보로 통일`
- 원격 작업 branch에 push했다.
- PR #20의 검사가 모두 통과한 뒤 merge commit 방식으로 main에 병합했다.
- consumer production:
  - Vercel `dpl_5AJdVsWfeAoqWUH7ZTdpu25doeqq`, `READY`
  - main 병합 SHA와 일치하고 `greenlove.co.kr` 별칭 연결을 확인했다.
- seller·driver는 main과 preview 연동 이벤트가 생겼지만 모두 Ignored Build Step으로 취소되어 실제 배포되지 않았다.

## Firebase·DB·외부 서비스

- 이번 작업에서는 Firebase 요금제, Cloud Billing, 예산, Storage를 변경하지 않았다.
- 기존 운영 프로젝트의 Blaze·활성 Billing·예산 알림 상태는 이전 이미지 복구 작업 결과를 유지한다.
- 상품·배너·스토어를 포함한 운영 DB 문서와 이미지 주소는 변경하지 않았다.
- 카카오 재신청과 카카오 채널·이메일·DNS·ALIGO·공개 소식은 변경하지 않았다.

## 남은 위험과 다음 권장 작업

- 사업자 주소가 변경되면 `PUBLIC_BUSINESS_INFO.address`와 관련 계약 테스트를 함께 갱신해야 한다.
- 주소는 상품 상세의 공개 정보로 client bundle에 포함된다. 공개 의도가 바뀌면 코드와 배포본에서 제거해야 한다.
- lint의 기존 경고 23건은 이번 변경과 무관하며 별도 작업으로 관리한다.
- 카카오 재신청은 승인되지 않았으므로 별도 명시적 요청 전에는 수행하지 않는다.

## 다음 시작 시 확인

1. `git status --short --branch`, `git diff`, `git diff --cached`를 확인한다.
2. `git log -1 --oneline`과 `origin/main`을 확인해 이 인계 문서 commit과 main 반영 상태를 확인한다.
3. 공개 상품 상세의 판매자 주소·전화번호가 `PUBLIC_BUSINESS_INFO`와 일치하는지 확인한다.
4. 사업자 연락처 변경 요청이 오면 운영 DB 대신 공개 사업자 정보 정본부터 갱신한다.
