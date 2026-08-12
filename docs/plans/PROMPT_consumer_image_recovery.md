<!-- Language: ko -->

# consumer 운영 이미지 복구 작업 프롬프트

아래 내용을 새 작업의 첫 메시지로 그대로 사용한다.

---

`C:\Develop\greenhub`의 카카오 심사용 consumer 홈페이지 후속 작업으로 운영 이미지 복구를 수행한다. 모든 응답·작업 설명·코드 주석·문서 내용·commit 메시지는 한국어로 작성한다.

실제 작업 위치:

- worktree: `C:\Users\tazan\.codex\worktrees\7573\greenhub`
- branch: `codex/kakao-business-channel-proof`
- 시작 기준 HEAD: `0a02b31806812e85104a409f4284302f64e38c17`
- 시작 기준 상태: clean
- 로컬 branch는 원격 작업 branch보다 2개 commit 앞선 상태다.

시작 전 필수 확인:

1. 지정 worktree에서 branch와 HEAD를 확인한다.
2. `git status`, 작업 트리 diff, staging diff를 모두 확인한다.
3. branch, HEAD, clean 상태가 시작 기준과 다르거나 예상하지 못한 변경이 있으면 아무것도 수정하지 말고 즉시 중단해 보고한다.
4. `apps/consumer/AGENTS.md`, `docs/memory.md`, `docs/plans/PLAN_consumer_image_recovery.md`, `docs/plans/REPORT_kakao_business_channel_reapproval.md`를 먼저 읽는다.
5. consumer 코드를 수정하기 전에 설치된 Next.js 16 문서에서 현재 Image와 Server·Client Component 규칙을 확인한다.

확정된 장애 증거:

- 운영 배너와 활성 상품 5개의 이미지 주소는 모두 `firebasestorage.googleapis.com`을 사용한다.
- 배너와 상품 5개 원본은 모두 HTTP `402 Payment Required`, 콘텐츠 형식 `application/json`을 반환했다.
- 운영 홈의 배너와 상품 이미지 5개는 로드 완료 상태지만 실제 크기가 `0×0`이었다.
- 공개 상품 상세 5개에서 대표·상세 이미지와 공통 스토어 로고도 실제 크기가 `0×0`이었다.
- Vercel 최근 오류 로그와 브라우저 콘솔에는 관련 서버 예외가 없었다.
- Firebase 공식 정책상 2026년 2월 3일부터 기존 Cloud Storage 버킷 접근에도 Blaze 요금제가 필요하며 Spark 프로젝트의 요청은 `402` 또는 `403`으로 실패한다.

작업 목표:

1. `docs/plans/PLAN_consumer_image_recovery.md`의 Task를 순서대로 실행한다.
2. Firebase Storage 접근을 복구해 기존 배너·상품·상세·스토어 사진이 다시 보이게 한다.
3. 원본 장애가 재발해도 배너는 사진 없이 유지하고 상품은 로컬 대체 이미지, 스토어 로고는 첫 글자 아바타로 표시한다.
4. consumer 테스트, lint, production build, 데스크톱과 375×812 모바일 검증을 통과한다.
5. 검증된 consumer 범위만 commit·push·PR·main 병합·production 배포하고 운영 화면과 로그를 재확인한다.

승인 범위:

- consumer 코드 수정, 테스트, 검증, 한국어 checkpoint commit, push, PR, main 병합과 consumer production 배포는 승인됐다.
- Firebase Blaze 전환, Cloud Billing 계정 연결, 카드·결제수단 선택, 비용 발생과 예산 설정은 아직 승인되지 않았다.
- Task 0.2에서 실제 요금제와 Billing 상태를 읽기 전용으로 확인한 뒤 Blaze 전환이 필요하면 예상 영향과 예산 알림 방안을 짧게 보고하고 사용자의 명시적 승인을 요청한다.
- 비용 변경 승인 전에는 Firebase 플랜이나 Billing 상태를 변경하지 않는다.

구현 원칙:

- 기존 Firebase 이미지 주소와 객체를 보존한 상태에서 접근 복구를 우선한다.
- Blaze 전환 뒤 기존 원본이 200으로 회복되면 상품·배너·스토어 DB 주소를 수정하지 않는다.
- 일부 객체가 404 또는 권한 오류라면 정확한 누락 대상만 보고하고 승인된 원본 없이 임의 교체하지 않는다.
- Blaze 전환이 승인되지 않으면 consumer 실패 대체 처리까지만 진행할 수 있지만 실제 사진 복구 완료로 선언하지 않는다. 저장소 마이그레이션은 별도 계획으로 분리한다.
- `packages/shared`, API, seller, driver는 변경하지 않는다.
- 배너 데이터와 문구·동작은 유지하고 이미지 실패 시 사진 구획만 숨긴다.
- 상품 대표 사진 실패 시 기존 로컬 대체 이미지를 사용한다.
- 상품 상세의 자유 비율 이미지 실패는 레이아웃을 깨뜨리지 않도록 해당 이미지만 숨긴다.
- 스토어 로고 실패는 기존 미등록 분기와 같은 첫 글자 아바타로 수렴한다.
- 대체 이미지 실패가 무한 재시도되지 않도록 실패 전환을 한 번으로 제한한다.
- 실패 계약을 먼저 추가하고 구현 뒤 통과시킨다.
- 여러 TSX 컴포넌트를 수정한 뒤 React 접근성·상태·성능 회귀를 점검한다.

검증 원칙:

- 원본 검증기는 전체 이미지 주소와 토큰을 출력하지 않고 이름, 호스트, HTTP 상태와 콘텐츠 형식만 출력한다.
- 배너, 활성 상품 5개, 상품 상세 이미지와 스토어 로고를 확인한다.
- 배포 후보에서 정상 원본 표시와 네트워크 실패 강제 시 대체 표시를 모두 검증한다.
- 운영에서는 홈과 상품 상세 5개를 확인하되 주소·연락처 등 개인정보 영역의 전체 화면이나 전체 DOM을 출력하지 않는다.
- consumer 관련 계약 테스트, `pnpm --filter consumer lint`, `pnpm --filter consumer build`, `git diff --check`를 통과한다.
- 배포 뒤 consumer Vercel 오류 로그와 브라우저 콘솔 오류를 확인한다.
- seller·driver·Railway API에 새 배포가 생겼는지 확인하고 예상 밖 배포가 있으면 상태만 보고하며 추가 변경하지 않는다.

외부 변경 제한:

- 카카오 재신청과 카카오 채널·이메일·DNS·ALIGO·공개 소식은 변경하지 않는다.
- 상품·배너·스토어 문서를 삭제하지 않는다.
- 주소, 비공개 Gmail, 로그인·인증 정보, 사업자등록증 이미지와 생년월일을 기록하거나 재출력하지 않는다.
- Git 작성자·커미터는 저장소 이력의 공개 GitHub `noreply` 메타데이터를 사용한다.

작업 완료 또는 중단 시 새로운 인계 프롬프트를 갱신한다. 최종 인계에는 branch·HEAD·git 상태·전체 diff·수정 파일·검증 결과·commit·push·PR·배포 식별자·Firebase 변경·운영 확인·남은 위험을 포함한다.

---
