<!-- Language: ko -->

# consumer 개인정보처리방침·이용약관과 카카오 재심사 작업 인계

## 요청

그린러브 consumer에 실제 서비스 기준의 개인정보처리방침과 이용약관을 공개하고 홈페이지 하단에서 쉽게 접근하게 만든 뒤, 운영 검증을 통과한 상태로 카카오 비즈니스 재심사를 다시 받을 수 있도록 실행 계획을 세운다.

이 대화에서는 먼저 검증 가능한 `docs/plans/PLAN_consumer_legal_documents_kakao_reapproval.md`를 작성한다. 계획이 확정되고 사용자가 `PLAN 전체 실행`을 요청한 뒤에만 Task를 순서대로 구현한다.

모든 응답·작업 설명·코드 주석·문서 내용·commit 메시지는 한국어로 작성한다. 기술 식별자와 코드만 원문을 유지한다.

## 실제 작업 위치와 기준선

- worktree: `C:\Users\tazan\.codex\worktrees\7573\greenhub`
- branch: `codex/kakao-business-channel-proof`
- 문서 작성 전 기준 HEAD: `18a5d8efa304055be0164628c79dcc333ad8aded`
- 이 기준 HEAD의 원격 작업 branch: 동일 SHA
- 이 기준 시점의 `origin/main`: `7da6655bb3f5de36d2958c9bc9ad71bc9238fbdf`
- 다음 대화 시작 시 위 값들을 신뢰하지 말고 읽기 전용으로 다시 확인한다.

이번 인계 작성 직후 예상되는 미커밋 문서는 다음 3개뿐이다.

- `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- `docs/plans/PROMPT_kakao_business_channel_reapplication_20260818.md`
- `docs/plans/PROMPT_consumer_legal_documents_kakao_reapproval_20260819.md`

다른 작업 트리 변경이나 staging 변경이 있으면 아무것도 수정하지 말고 중단해 보고한다. 예상 문서 3개의 diff도 먼저 읽어 기존 사용자 변경을 덮어쓰지 않는다.

## 시작 전 필수 확인

1. 지정 worktree에서 branch와 HEAD를 확인한다.
2. `git status`, 작업 트리 diff, staging diff를 모두 확인한다.
3. 다음 문서를 먼저 읽는다.
   - `apps/consumer/AGENTS.md`
   - `docs/memory.md`
   - `docs/CRITICAL_LOGIC.md`의 MVP 직접 판매 결정
   - `docs/plans/REPORT_kakao_business_channel_reapproval.md`
   - `docs/plans/PROMPT_kakao_business_channel_reapplication_20260818.md`
   - 이 인계 문서
   - `docs/plans/PLAN_consumer_business_footer_reformat.md`
   - `docs/specs/ops/kakao-business-channel-proof.md`
4. consumer 코드를 수정하기 전에 설치된 Next.js 16 문서에서 App Router, Server·Client Component, metadata와 route 규칙을 확인한다.
5. 2026년 현재 개인정보보호위원회의 개인정보 처리방침 작성지침·표준안, 공정거래위원회의 전자상거래 표준약관과 현행 전자상거래법을 공식 원문으로 다시 확인한다.
6. 외부 공식 자료에서 가져온 문구는 그대로 복사하지 말고 실제 그린러브 처리 흐름에 맞는지 항목별로 대조한다.

## 확정된 4차 반려 사유

- 대상 채널: `그린러브`
- 검색용 아이디: `@greenlove`
- 홈페이지: `https://greenlove.co.kr/`
- 2026년 8월 19일 카카오 고객센터는 홈페이지에서 개인정보처리방침과 이용약관을 확인할 수 없어 사업자채널 연관성을 검증할 수 없다고 답변했다.
- 이번 답변은 채널 전화번호 불일치를 반려 사유로 제시하지 않았다.
- 운영 홈페이지 HTML에는 개인정보처리방침·이용약관 문구와 링크가 없다.
- `/privacy`, `/terms`를 포함한 통상적인 후보 경로는 404였다.
- 현재 `BusinessInfoFooter`는 사업자 공개 정보만 표시하며 두 법적 문서 링크를 제공하지 않는다.

## 회차 직배송 원계획과의 관계

- 회차 직배송 branch: `codex/mvp-sales-round-direct`
- 해당 branch 기본 worktree: `C:\Develop\greenhub`
- 확인 당시 HEAD: `674b59cda5212ff37cbf283b1a9871ff0da2c1c2`
- 원계획과 관련 문서:
  - `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
  - `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`
  - `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
  - `docs/plans/REPORT_mvp_round_direct_launch.md`
  - `docs/specs/mvp-sales-round-direct-delivery.md`
  - `docs/specs/ops/mvp-sales-round-runbook.md`
- 위 문서 전체에서 개인정보처리방침·이용약관·법적 고지 푸터 Task는 확인되지 않았다.
- 기존 카카오 푸터 계획도 사업자 정보 공개까지만 포함하며 법적 고지 본문과 링크는 범위에 없었다.
- 따라서 이번 별도 consumer 작업에서 법적 고지 작성·노출·운영 검증·카카오 재심사를 반드시 수행한다.
- 회차 직배송 출시는 이 작업이 main에 병합되고 회차 branch에 통합되기 전에는 재개하지 않는다.
- 실행이 끝난 원계획의 Task 구조를 소급해 바꾸지 않는다. 회차 출시를 재개할 때 중단 인계와 출시 차단 상태에 법적 고지 완료를 선행 조건으로 기록한다.
- 확인 당시 `C:\Develop\greenhub`에는 미추적 `docs/plans/PLAN_kakao_business_channel_homepage_reapproval.md`가 있었다. 해당 worktree를 수정하기 전 branch·HEAD·status·전체 diff를 다시 확인하고 이 미추적 파일을 덮어쓰거나 삭제하지 않는다.

## 사용자에게 확인된 현재 운영 방향

- 현재 운영 중인 결제 대행사는 없다는 사용자 설명을 기준으로 시작한다.
- 카카오페이·네이버페이를 우선 도입하고 향후 일반 PG 카드결제를 도입할 계획이다.
- 아직 운영하지 않는 결제사를 현재 처리 수탁자나 제3자 제공 대상으로 단정해 기재하지 않는다.
- 배송은 회차별 직배송을 먼저 운영하고 택배 기능은 후속으로 열어 택배사를 정할 계획이다.
- 주문 정보는 판매자나 실제 배송 담당자에게 배송에 필요한 최소 항목만 전달한다.
- 마케팅 문자 수신정보는 별도로 수집·보관하지 않는다.
- 교환·반품 비용과 자체 배송 기준은 아직 확정되지 않았다.
- 임의 금액·기간·택배사·결제사·반품 주소를 추측해서 문서에 넣지 않는다.

## 계획 전에 코드와 운영에서 확정할 사실

1. 운영 홈페이지에서 실제 주문 확정과 결제가 가능한지, 상품 열람·공동구매 참여 의사 표시까지만 가능한지 확인한다.
2. consumer의 로그인·회원정보·장바구니·주문·결제·문의·알림 설정 화면에서 입력·보관되는 항목을 추적한다.
3. API DTO, Firestore 문서, 인증, 주문, 결제, 환불, 알림과 로그에서 개인정보가 어디에 저장되고 얼마나 유지되는지 확인한다.
4. PortOne 관련 코드·환경과 운영 활성 상태를 구분한다. 코드 존재만으로 현재 운영 결제사라고 단정하지 않는다.
5. Vercel, Railway, Firebase, 인증 제공자, 문자 서비스 등 실제 개인정보 처리 위탁·국외 이전 가능성을 공식 계약·운영 설정과 대조한다.
6. 판매자와 배송 담당자에게 실제 전달되는 최소 주문정보를 코드 기준으로 확인한다.
7. 쿠키, 로컬 저장소, 분석 도구, 접속기록과 보안 로그 사용 여부를 확인한다.
8. 법령상 보존기간과 실제 시스템의 보존·삭제 기능이 충돌하는지 확인한다.
9. 코드와 읽기 전용 운영 확인으로 결론을 낼 수 없는 사실만 사용자에게 짧게 질문한다.

주소·연락처·계정·주문정보·토큰·환경변수의 원문을 로그나 문서에 불필요하게 재출력하지 않는다.

## 새 PLAN에 반드시 포함할 범위

### 법적 문서 계약

- 개인정보처리방침과 이용약관의 필수 항목을 먼저 테스트 또는 정적 계약으로 고정한다.
- 운영 주체 `디어 오키드`, 서비스 `그린러브`와 기존 공개 사업자 정본의 일관성을 검증한다.
- 미래 계획과 현재 운영 상태를 분리한다.
- 빈 문서, 복사한 표준약관 원문, 실제 기능과 다른 약속을 금지한다.

### 개인정보처리방침

- 공개 경로는 우선 `/privacy`를 사용한다.
- 처리 목적, 항목, 수집 방법, 보유기간, 법정 보존, 제3자 제공, 처리 위탁, 국외 이전 여부, 파기, 이용자 권리, 쿠키·로그, 보호책임자·문의처, 시행일과 변경 고지를 실제 흐름에 맞게 작성한다.
- 해당하지 않는 항목은 숨기지 말고 현재 해당 없음인지, 도입 시 사전 개정할 사항인지 명확히 구분한다.

### 이용약관

- 공개 경로는 우선 `/terms`를 사용한다.
- 서비스 범위, 계약 성립 시점, 주문·결제, 공급·직배송, 취소·청약철회, 교환·반품·환불, 사업자와 이용자 의무, 개인정보 보호, 분쟁 처리와 시행일을 실제 운영 단계에 맞게 작성한다.
- 교환·반품 비용과 배송 기준이 미확정인 상태에서 실제 판매 계약을 받는다면 출시 차단점으로 다룬다.
- 현재 주문·결제를 받지 않는다면 제공하지 않는 기능을 제공 중인 것처럼 쓰지 않는다.

### 푸터와 접근성

- 홈페이지 하단에 `개인정보처리방침`과 `이용약관`이라는 정확한 링크 이름을 노출한다.
- 개인정보처리방침 링크는 시각적으로 식별 가능하게 하되 전체 디자인과 모바일 터치 기준을 지킨다.
- 로그인 없이 두 페이지에 직접 접근할 수 있어야 한다.
- 법적 문서에서 홈페이지와 서로 이동할 수 있어야 한다.
- 현재 홈 전용 `BusinessInfoFooter`를 공통 공개 푸터로 확장할지, 홈에 링크만 추가할지 consumer layout과 고정 하단 navigation 영향을 분석해 PLAN에서 확정한다.
- 375×812 모바일에서 마지막 문장까지 가리지 않고 가로 넘침이 없어야 한다.

### 자동 검증과 화면 검증

- 관련 consumer 계약 테스트를 먼저 실패시키고 구현 뒤 통과시킨다.
- `pnpm --filter consumer exec tsc --noEmit`
- `pnpm --filter consumer lint`
- `pnpm --filter consumer build`
- `git diff --check`
- 데스크톱과 375×812 모바일에서 홈·개인정보처리방침·이용약관을 확인한다.
- 운영 또는 배포 후보에서 `/`, `/privacy`, `/terms`가 HTTP 200이고 로그인·오류 화면으로 전환되지 않는지 확인한다.
- 링크 이름, 운영 주체, 시행일, 모바일 가독성, 가로 넘침, 브라우저 콘솔 오류를 확인한다.

### 원격 반영과 카카오 재심사

- 전체 diff가 consumer·테스트·법적 문서·관련 보고서 범위만 포함하는지 확인한다.
- 공개 GitHub noreply 메타데이터와 한국어 commit 메시지를 사용한다.
- 작업 branch push, main 대상 PR, 검사 통과, main 병합, consumer production 배포와 운영 재검증을 순서대로 진행한다.
- seller·driver·Railway API에 예상 밖 배포가 생기면 상태만 보고하고 임의 rollback하지 않는다.
- 운영 배포 뒤 홈페이지 원문과 실제 브라우저에서 두 링크와 본문을 다시 확인한다.
- 카카오 재심사는 사용자의 명시적 최종 제출 승인 뒤에만 진행한다.
- 재심사 홈페이지 주소는 `https://greenlove.co.kr`를 정확히 사용한다.
- 연관성 설명에는 `디어 오키드가 그린러브 서비스를 직접 운영하며 개인정보처리방침과 이용약관에서 동일 운영 주체를 확인할 수 있다`는 사실을 글자 수 제한 안에서 반영한다.

## 승인 없이 하지 않을 것

- 카카오 채널 전화번호·소개·소식·관리자 변경
- 새 카카오 채널 생성 또는 기존 채널 삭제
- 카카오 재심사 최종 제출
- ALIGO 발신 프로필·템플릿·자격 증명·실제 발송 변경
- Firebase 플랜·Billing·Storage·예산 변경
- 운영 DB의 회원·상품·주문·판매자·배송 데이터 변경
- 결제사·택배사 계약 또는 운영 활성화
- 교환·반품 비용과 배송 기준 추정
- 이메일·DNS·공개 소식 변경
- seller·driver·API 기능 변경
- 회차 생성, `salesMode` 변경 또는 회차 직배송 출시 재개

## PLAN 작성 형식

- 파일: `docs/plans/PLAN_consumer_legal_documents_kakao_reapproval.md`
- `Origin Intent`, `Edge Case Trace`, `Diagnosis & Findings`, `Architectural Deepening`, `Agent Completion Contract`를 포함한다.
- Task는 대상 파일 하나, 단일 목표, 실제 Verify 명령과 미완료 Conclusion 슬롯을 가진다.
- 법적 문서 내용 계약을 구현보다 먼저 배치한다.
- 작성 뒤 저장소에 `plan-preread`와 `plan-lint`가 있으면 모두 통과시킨다.
- 계획 작성 단계에서는 애플리케이션 코드를 수정하지 않는다.
- 계획이 완성되면 사용자에게 핵심 범위, 확인이 필요한 사실, 실행 승인 게이트를 짧게 보고한다.

## 완료 기준

- 현재 서비스 흐름과 공식 지침에 맞는 개인정보처리방침과 이용약관이 존재한다.
- 홈페이지 푸터에서 로그인 없이 두 문서에 접근할 수 있다.
- 두 문서가 `그린러브`와 `디어 오키드`의 운영 관계를 명확히 한다.
- 운영 `/`, `/privacy`, `/terms`가 데스크톱과 모바일에서 정상 표시된다.
- consumer 테스트·타입 검사·lint·production build·`git diff --check`가 통과한다.
- consumer production만 의도대로 배포되고 운영 오류가 없다.
- 카카오 재심사 성공 화면을 확인하고 보고서에 결과를 기록한다.
- 회차 직배송 중단 인계에 법적 고지 완료와 최신 main 통합이 출시 재개 선행 조건으로 반영된다.

## 최종 인계에 포함할 내용

- 최신 branch와 HEAD
- git status와 전체 diff·staging 상태
- 작성한 정책의 공식 근거와 실제 서비스 대조 결과
- 수정 파일과 공개 경로
- 테스트·타입 검사·lint·build·모바일·운영 검증 결과
- commit, push, PR, main 병합 상태
- Vercel 배포 식별자와 운영 도메인 확인 결과
- 카카오 재심사 신청일과 결과
- Firebase·운영 DB·카카오 채널·ALIGO·다른 외부 서비스 변경 여부
- 회차 직배송 branch 통합 여부
- 남은 법률·운영 위험과 다음 권장 작업
