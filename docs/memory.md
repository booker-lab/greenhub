<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 4.16 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.16 시작 SHA: `3eb8c54850bf9c06b2c3d9fbace799f6b8c42d0a`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.16 `apps/consumer/src/app/order/success/page.tsx`
- 다음: Task 4.17 `apps/consumer/src/app/mypage/_client.tsx`
- Task 4.18 이후 화면과 당근 유입 연결은 선행하지 않는다.

## Task 4.16 확정

- 주문 완료 URL은 공백·제어·경로 문자·중복값 없는 단일 `orderId`만 조회에 사용한다.
- 요청 `orderId`와 서버 응답 `id`, 성공 상태, 회차 식별자·주문번호가 일치해야 성공이다.
- 회차 상품명·수량·소계·합계는 인증된 서버 `orderItems` 응답만 사용한다.
- 빈 상품, 중복 회차 상품, 단가·소계·주문 합계 불일치는 오류 상태로 닫는다.
- 회차 성공 화면은 화요일 오전 9시까지 이천시 문 앞 배송 약속을 표시한다.
- 기존 단일 상품·legacy 주문번호 폴백과 공동구매 모집 안내를 유지한다.
- Task 4.14~4.15의 한 주문·한 결제, 완료 후 `checkout_cart` 삭제, 배송·동의 계약은 변경하지 않았다.

## 검증 상태

- Task 4.16 전용 5개와 Task 4.8~4.15 계약 50개 등 Node 테스트 55개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- 소비자 Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 수준 검사와 `git diff --check` 통과
- build가 갱신한 tracked 생성물 5개는 시작 SHA 상태로 복원해 범위에서 제외했다.

## 명시적 후속 위험

- 소비자 E2E 24개는 후속 화면과 실행 데이터 준비 전이라 `test.fixme`다.
- 다중 상품 대표명과 배송 보류 주문 목록은 Task 4.17이다.
- 주문 상세·마케팅 동의 화면과 당근 유입 연결은 후속 Task로 남아 있다.
- 배송 사진 실제 업로드 API·드라이버 호출은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않았다.
