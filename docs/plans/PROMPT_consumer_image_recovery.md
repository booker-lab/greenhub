<!-- Language: ko -->

# consumer 운영 이미지 복구 최종 인계

## 현재 상태

- worktree: `C:\Users\tazan\.codex\worktrees\7573\greenhub`
- branch: `codex/kakao-business-channel-proof`
- 최종 기능·검증 HEAD: `9be3473e7b54f8dc6a0c71651387bfaf56dc8c50`
- main 병합 SHA: `e6c2138e3c969616e19f2ba8882c1842a3cf0dfb`
- PR: #18, `MERGED`
- 기능 branch는 원격 작업 branch와 동기화됐고 기능·배포 작업 종료 시 작업 트리와 staging은 비어 있었다.
- 이 인계와 PLAN·REPORT closeout을 담는 문서 commit은 문서 자체가 자신의 SHA를 포함할 수 없으므로 최종 응답과 `git log -1`에서 확인한다.

## 수행한 변경

- `apps/consumer/src/components/ResilientImage.tsx`
  - 원본 실패를 한 번 감지해 로컬 이미지 또는 화면별 대체 UI로 전환한다.
  - 대체 이미지도 실패하면 최종 숨김으로 종료해 무한 재시도를 막는다.
  - 자유 비율 상세 이미지 실패 시 해당 요소만 숨기는 경계를 포함한다.
- `HeroBanner`, `ProductCard`, `HomeProductList`, `DeadlineSection`, `ProductImages`, `ProductInfo`, `ProductActions`
  - 배너 사진 숨김, 상품 로컬 대체 이미지, 상세 이미지 숨김, 스토어 첫 글자 아바타를 적용했다.
- `apps/consumer/src/components/ResilientImage.test.mjs`
  - 이미지 실패 계약 5건을 추가했다.
- `apps/consumer/scripts/verify-public-images.mjs`
  - 주소와 토큰 없이 구분값·호스트·HTTP 상태·콘텐츠 형식만 출력한다.
- `docs/plans/PLAN_consumer_image_recovery.md`, `docs/plans/REPORT_kakao_business_channel_reapproval.md`
  - 승인·구현·검증·배포·운영 결과를 기록했다.
- `packages/shared`, API, seller, driver 코드는 변경하지 않았다.

## 검증 결과

- 구현 전 계약 RED: 공통 컴포넌트 부재로 종료 코드 1을 확인했다.
- 이미지 계약 구현 후: 5/5 통과.
- 관련 consumer 회귀 계약: 17/17 통과, 실패 0건.
- consumer TypeScript: 종료 코드 0.
- consumer lint: 오류 0건, 기존 경고 23건.
- consumer production build: Next.js 16.2.5 compile·TypeScript·정적 페이지 13/13 통과.
- `git diff --check`: 종료 코드 0.
- 읽기 전용 원본 검증: 배너와 활성 상품 5개 6/6 HTTP 200, `image/png`.
- 배포 후보 데스크톱·375×812:
  - 홈 배너·상품 5개, 상세 5개의 대표·상세·스토어 로고 실제 크기 양수.
  - 강제 실패 시 배너 사진만 숨고 문구·버튼 유지.
  - 상품 5개는 로컬 대체 이미지, 자유 비율 상세는 숨김, 스토어 로고는 `디` 아바타로 전환.
  - 대체 이미지 자체 실패는 최종 숨김으로 종료.
  - 깨진 이미지 0건, 가로 넘침 없음, 애플리케이션 오류 0건.
- 운영 재검증:
  - 원본 6/6과 Next 이미지 프록시 HTTP 200 이미지 응답.
  - 데스크톱·375×812 홈과 공개 상품 상세 5개 모두 실제 크기 양수.
  - 깨진 이미지 0건, 가로 넘침 없음, 브라우저 오류 0건.
  - consumer Vercel 최근 1시간 런타임 오류 0건, production 5xx 0건.

## commit·push·PR·배포

- `936a5c9` — `consumer 운영 이미지 복구와 실패 대체 처리`
- `d7afe55` — `consumer 검증기 경로를 앱 범위로 제한`
- `9be3473` — `이미지 복구 PR 검증 결과 기록`
- 모두 원격 작업 branch에 push했다.
- PR #18의 검사가 모두 통과한 뒤 merge commit 방식으로 main에 병합했다.
- consumer production:
  - Vercel `dpl_9LQkxbkSpuHQwYnPTSYdg5L2g14g`, `READY`
  - GitHub deployment `5863377298`, 성공
  - merge SHA와 일치하고 `greenlove.co.kr` 별칭 연결·HTTP 200 확인
- seller production 후보 `dpl_3D2gAGP2d6Evez3fQmgsiLnN1wKE`와 driver 후보 `dpl_DSTjpvqChdJKTdrA5nNPsmVUc7td`는 Ignored Build Step으로 취소됐다.
- seller·driver와 Railway API 최신 production은 이전 SHA `098ad98c`를 유지했다.
- 루트 `scripts/**`에 검증기를 처음 추가·이동한 두 commit에서는 seller·driver 미리보기가 예상 밖으로 실제 생성됐다. 상태만 확인하고 rollback하지 않았으며 최종 consumer 경로로 옮긴 뒤 seller·driver Ignore 동작을 재확인했다.

## Firebase·DB·외부 서비스

- 사용자 승인 뒤 운영 프로젝트 `green-e4fe3`를 기존 활성 Cloud Billing 계정에 연결했다.
- 현재 `billingEnabled=true`, 결제 계정 `open=true`, Firebase `Blaze / 사용한 만큼만 지불` 상태다.
- 운영 프로젝트만 범위로 한정한 월 10,000원 예산과 실제 비용 10·50·90·100% 알림을 만들었다.
- 다른 Firebase 프로젝트·결제 계정과 결제수단은 변경하거나 닫지 않았다.
- 기존 상품·배너·스토어 DB 주소와 문서, Firebase Storage 객체는 변경하지 않았다.
- 카카오 재신청과 카카오 채널·이메일·DNS·ALIGO·공개 소식은 변경하지 않았다.

## 남은 위험과 권장 작업

- 예산 알림은 비용을 자동 차단하지 않으며 알림이 지연될 수 있다.
- Firebase 무료 사용량을 초과하면 사용량 기반 비용이 발생할 수 있으므로 첫 결제 주기 동안 비용과 Storage 사용량을 주기적으로 확인한다.
- 월 10,000원 예산의 10% 알림이 도착하면 예상 트래픽인지 먼저 확인하고, 이상 사용이면 Storage 요청량과 다운로드량을 조사한다.
- 카카오 재신청은 승인되지 않았으므로 별도 명시적 요청 전에는 수행하지 않는다.

## 다음 시작 시 확인

1. `git status --short --branch`, `git diff`, `git diff --cached`를 확인한다.
2. `git log -1 --oneline`과 `origin/main`을 확인해 이 closeout 문서 commit과 main 반영 상태를 확인한다.
3. 이미지 이상 재발 시 `node apps/consumer/scripts/verify-public-images.mjs`로 원본부터 확인한다.
4. Firebase 비용 경고가 오면 프로젝트 범위·Storage 사용량·요청량을 읽기 전용으로 먼저 점검한다.
