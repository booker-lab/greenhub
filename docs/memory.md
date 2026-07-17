<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 4.19 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.19 시작 SHA: `bf1cbb31bdcd7ca9039e874b8db05fec1066b2e4`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.19 `apps/consumer/src/app/mypage/notifications/settings/page.tsx`
- 다음: Task 5.1 `apps/e2e/tests/seller-sale-rounds.spec.ts`
- Task 5.1 이후 셀러·드라이버 화면, 당근 유입 연결, 인덱스 작업은 선행하지 않는다.

## Task 4.19 확정

- 현재 동의 상태는 소비자 세션·임의 기본값·브라우저 저장값이 아니라 인증된 `GET /auth/me` 응답만 사용한다.
- `notificationPreferences.alimtalk`와 `sms`가 모두 boolean일 때만 카카오톡·문자 상태를 표시한다.
- 동의된 채널의 철회는 기존 `PATCH /notifications/me/preferences`에 해당 채널의 `false`만 전송한다.
- PATCH 응답의 두 채널 boolean과 요청 채널 `false`를 검증한 뒤에만 화면 상태를 갱신한다.
- 실패·손상 응답에서는 기존 상태를 유지하고 다른 채널 값을 클라이언트가 임의로 전송하지 않는다.
- 주문·결제·배송 정보성 연락을 선택 마케팅과 분리해 안내한다.
- 동의·철회 증거와 보관 기록은 서버 정책에 맡기고 클라이언트에서 모방·직접 접근하지 않는다.
- 운영 파일 313줄, 테스트 144줄로 500줄 제한을 지켰다.

## 검증 상태

- Task 4.19 전용 5개와 Task 4.8~4.18 회귀 64개, 총 Node 테스트 69개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 수준 검사와 `git diff --check` 통과
- build가 갱신한 tracked 생성물 5개는 시작 SHA 상태로 복원해 범위에서 제외했다.

## 명시적 후속 위험

- 소비자 E2E 24개는 실행 데이터 준비 전이라 `test.fixme`다.
- 사진 record의 실제 업로드 API·서명 URL 라우트·드라이버 연결은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않았다.
