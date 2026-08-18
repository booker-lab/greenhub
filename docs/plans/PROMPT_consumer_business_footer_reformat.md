<!-- Language: ko -->

# consumer 사업자 푸터 보강 최종 인계

## 현재 상태

- worktree: `C:\Users\tazan\.codex\worktrees\7573\greenhub`
- branch: `codex/kakao-business-channel-proof`
- 최종 기능·검증 HEAD: `8898102bd451870255e22cbf263e683f33a83668`
- main 병합 SHA: `0a73f9360e287e3ae95c5cc7af59f18af0c4c35c`
- PR: #22, `MERGED`
- 기능 branch는 원격 작업 branch와 동기화됐고 기능·배포 작업 종료 시 작업 트리와 staging은 비어 있었다.
- 이 인계와 PLAN·REPORT closeout을 담는 문서 commit은 문서 자체가 자신의 SHA를 포함할 수 없으므로 최종 응답과 `git log -1`에서 확인한다.

## 수정 파일

- `apps/consumer/src/components/BusinessInfoFooter.tsx`
  - footer의 운영 관계 중복 문장을 제거했다.
  - 상호·대표·주소·사업자등록번호·호스팅서비스 제공자·이메일·고객센터·상담가능시간을 줄바꿈 가능한 정의 목록으로 렌더링한다.
  - 전화·이메일 링크의 44px 터치 영역과 긴 문자열 줄바꿈을 유지한다.
- `apps/consumer/src/components/BusinessInfoFooter.test.mjs`
  - 공개 필드, 상단 전용 운영 관계 문장, 주소·호스팅서비스 제공자·상담시간, 좁은 화면 줄바꿈과 Server Component 경계를 검증한다.
- `apps/consumer/src/lib/publicBusinessInfo.ts`
  - 호스팅서비스 제공자 `Vercel Inc.`와 상담가능시간 `09:00~18:00 (점심시간 12:00~13:00)`을 단일 공개 정본에 추가했다.
- `docs/specs/ops/kakao-business-channel-proof.md`
  - 공식 주소와 footer 공개 경계를 최신 증빙 상태로 갱신했다.
- `docs/plans/PLAN_consumer_business_footer_reformat.md`
  - Task 10개와 Release Gate의 실측 결과를 기록했다.
- `docs/plans/REPORT_kakao_business_channel_reapproval.md`
  - 구현·검증·병합·배포·운영 재검증 결과를 기록했다.
- `docs/plans/PROMPT_consumer_business_footer_reformat.md`
  - 현재 인계 문서다.

## 수행한 검증과 결과

- 설치된 Next.js 16.2.5 문서에서 상태·이벤트·브라우저 API가 없는 정적 footer는 Server Component로 유지하는 규칙을 확인했다.
- 구현 전 계약: 4건 중 3건이 의도한 RED였고 공개 정본 추가 뒤 남은 footer 계약 2건이 RED였다.
- 최종 푸터·상단 안내·홈 배치 계약: 14/14 통과.
- consumer lint: 오류 0건, 기존 경고 23건.
- consumer production build: compile·TypeScript·정적 페이지 13/13 통과.
- `git diff --check`: 종료 코드 0.
- 로컬 배포 후보 데스크톱·375×812:
  - 공개 필드 8개 전체 노출, 운영 관계 문장은 상단에만 1회 노출.
  - footer 안 운영 관계 문장 없음, 가로 넘침 없음.
  - 전화·이메일 링크 높이 44px, 환경값 보정 재검증에서 콘솔 오류·경고 0건.
- 운영 데스크톱·375×812:
  - 같은 공개 필드와 문장 경계를 확인했다.
  - 가로 넘침 없음, 깨진 이미지 0건, 브라우저 콘솔 오류·경고 0건.
  - 원시 운영 응답 HTTP 200, consumer Vercel 최근 1시간 error 로그 0건.

## commit·push·PR 상태

- checkpoint: `8898102bd451870255e22cbf263e683f33a83668` — `consumer 사업자 푸터 공개 정보를 보강한다`
- 공개 GitHub `noreply` 작성자·커미터 메타데이터를 사용했다.
- checkpoint를 `origin/codex/kakao-business-channel-proof`에 push했다.
- PR #22의 consumer 미리보기와 Preview Comments가 성공했고 seller·driver는 Ignored Build Step으로 취소됐다.
- 모든 검사가 통과한 뒤 PR #22를 merge commit `0a73f9360e287e3ae95c5cc7af59f18af0c4c35c`로 main에 병합했다.

## 배포 식별자와 운영 확인 결과

- consumer preview GitHub deployment: `5958625941`, 성공.
- consumer production GitHub deployment: `5958653908`, 성공.
- consumer production Vercel: `dpl_Bnn4DCf77F1rLE9sVRwojrXHF3bR`, `Ready`.
- `greenlove.co.kr`, `www.greenlove.co.kr`, 기본 Vercel 별칭이 새 production에 연결됐다.
- merge SHA의 GitHub deployment는 consumer production 1건뿐이며 seller·driver production은 생성되지 않았다.
- Railway API 후보 `ea1f214a-9ae2-4165-ae27-0929a3e56094`는 `No changes to watched files`로 건너뛰었다.
- Railway API 활성 production은 `d054f564-5fc7-4656-816b-7c05578e260e`, 이전 SHA `098ad98c72a8bdcb5e3c1a95ed2c6b3287cf0ab2`를 유지했다.

## Firebase·운영 DB·외부 서비스

- 이번 footer 작업에서 Firebase 플랜·Billing·결제수단·예산·Storage를 변경하지 않았다.
- 기존 상태는 운영 프로젝트가 활성 Billing에 연결된 Blaze이며 프로젝트 한정 월 10,000원 예산과 실제 비용 10·50·90·100% 알림이 설정된 상태다.
- 상품·배너·스토어 문서와 이미지 주소를 포함한 운영 DB는 변경하지 않았다.
- 카카오 재신청과 카카오 채널 전화번호·소개·소식, 이메일·DNS·ALIGO는 변경하지 않았다.
- 반복 반려 문의 답변은 아직 확인되지 않았고, 답변 전에는 채널 정보 변경이나 추가 재신청을 수행하지 않는다.

## 남은 위험과 다음 권장 작업

- footer 보강은 홈페이지의 사업자 정보 확인성을 높이지만 카카오 승인 자체를 보장하지 않는다.
- 카카오 문의 답변에서 채널 전화번호 불일치가 실제 반려 사유인지 먼저 확인한다. 확인 전에는 사업자 번호로 새 채널을 만들거나 기존 채널 정보를 바꾸지 않는다.
- 통신판매업 신고번호는 현재 공개 정본에 없으므로 임의 생성하지 않는다. 실제 발급 뒤 공개 승인을 받은 경우에만 정본과 footer를 갱신한다.
- 기존 404 홍보 링크 문제는 이번 footer 범위와 분리돼 있다. 카카오 추가 제출 전 공개 링크 전체를 다시 점검한다.
- consumer lint의 기존 경고 23건은 이번 변경에서 늘지 않았으며 별도 유지보수 범위다.
- Firebase 예산 알림은 비용을 자동 차단하지 않으므로 첫 결제 주기 동안 Storage 사용량과 비용을 계속 확인한다.

## 다음 시작 시 확인

1. `git status --short --branch`, `git diff`, `git diff --cached`를 확인한다.
2. `git log -1 --oneline`, `origin/codex/kakao-business-channel-proof`, `origin/main`에서 closeout 문서 commit과 병합 상태를 확인한다.
3. 카카오 문의 답변을 읽기 전용으로 확인하고 반려 사유를 추정과 확정으로 구분한다.
4. 추가 재신청 권한을 별도로 확인한 뒤 홈페이지 URL은 정확히 `https://greenlove.co.kr/`로 사용한다.
