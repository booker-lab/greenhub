<!-- Language: ko -->

# Green Love 프로젝트 메모

> SSOT: 세션 종료 시 최신 상태만 유지한다. 200줄 초과 시 아카이브하고 50줄 이내로 요약한다.
> 최신 아카이브: `docs/archive/memory_archive_20260717_before_full_review_remediation_plan.md`

최종 수정: 2026-07-18 (원 계획 Task 4.18 Closeout)

## 현재 진행

- 브랜치: `codex/mvp-sales-round-direct`
- Task 4.18 시작 SHA: `a485e26f6961f6a79a4aa3b544951665b30b75e4`
- 실행 SSOT: `docs/plans/PLAN_mvp_sales_round_direct_delivery.md`
- 완료: Task 4.18 `apps/consumer/src/app/mypage/orders/[id]/_client.tsx`
- 다음: Task 4.19 `apps/consumer/src/app/mypage/notifications/settings/page.tsx`
- Task 4.19 이후 화면, 당근 유입 연결, 셀러·드라이버·인덱스 작업은 선행하지 않는다.

## Task 4.18 확정

- 회차 주문 상세은 인증된 `/orders/:orderId` 응답의 식별자·상태·회차 주문번호·다중 `orderItems`·금액 정합성을 모두 검증한다.
- 손상된 회차 상품, 보류 스냅샷, 사진 URL은 임의 상품·상태·동작으로 승격하지 않는다.
- 상품명·수량·소계·합계는 서버가 정규화한 `orderItems`만 사용한다.
- `DELIVERY_HELD`에서만 서버 `deliveryHold`의 사유·고객 책임·재배송비·다음 연락·다음 배송을 표시한다.
- 고객 책임의 양수 재배송비만 기존 서버 API 응답의 청구·주문·스토어·금액·PortOne 식별자를 검증한 뒤 카카오페이로 요청한다.
- 배송 완료 사진은 인증 주문 응답의 HTTPS `deliveryPhotoUrl`만 표시하고 Firebase Storage 직접 접근·업로드를 추가하지 않았다.
- 회차 취소는 서버가 마감 여부를 최종 재검증하는 기존 취소 API만 사용한다.
- 단일 legacy·공동구매·거점픽업·구매 확정 상세 계약은 유지한다.
- 순수 판독기를 `_detail.ts`로 분리해 운영 파일 447줄·296줄로 500줄 제한을 지켰다.

## 검증 상태

- Task 4.18 전용 5개와 Task 4.8~4.17 회귀 59개, 총 Node 테스트 64개 통과
- consumer `tsc --noEmit`, 전체 `pnpm typecheck`, `pnpm build` 통과
- Playwright chromium·mobile 24개 목록 수집 통과
- 변경 파일 Biome 오류 수준 검사와 `git diff --check` 통과
- build가 갱신한 tracked 생성물 5개는 시작 SHA 상태로 복원해 범위에서 제외했다.

## 명시적 후속 위험

- 소비자 E2E 24개는 실행 데이터 준비 전이라 `test.fixme`다.
- 사진 record의 실제 업로드 API·서명 URL 라우트·드라이버 연결은 Task 5.12다.
- Firestore 인덱스·보안 규칙과 Storage 규칙은 Task 6.1~6.3이다.
- `salesMode` 전환·배포·push는 수행하지 않았다.
