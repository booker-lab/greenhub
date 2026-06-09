# 육안 검증 재개 핸드오프 — 2026-06-01

> 2026-06-06 활성 파일 축소:
>
> 2026-06-01~2026-06-03 상세 이력과 1~33번 섹션은 `docs/archive/frontend/visual-verify-handoff-20260601-archive-20260606.md`로 이관했다.
> 이 파일은 핸드오프 프롬프트 1번의 최신 종료 이력과 다음 진입점만 유지한다.

> 2026-06-06 분기 정정:
>
> **이 문서는 핸드오프 프롬프트 1번, 즉 육안검증 종결 가지의 원본 활성 이력이다.**
> 프롬프트 2번의 개발·릴리즈 트레인과 순서로 이어지지 않는다.
>
> - 1번 다음 진입점: `docs/specs/frontend/handoff-prompt-1-visual-closeout.md`
> - 2번 다음 진입점: `docs/specs/ops/handoff-prompt-2-release-train.md`

## 34. 2026-06-06 소비자 주문 상세 송장 표시 `#147` 재검증 결과

- 핸드오프 프롬프트 1번 재개 기준에 맞춰 release wave로 가지 않고, 보류 중인 판매자·소비자 택배 발송 묶음 중 남은 `#147`을 먼저 재검증했다.
- 기존 `3010`과 첫 재시도 `3012`는 consumer fixture가 아니라 seller 로그인 화면을 반환해 실패했다. 기존 프로세스는 건드리지 않고 consumer 앱 디렉터리에서 `ENABLE_E2E_FIXTURES=true`로 `127.0.0.1:3013` dev 서버를 별도 기동했다.
- 실제 consumer 주문 상세 컴포넌트를 쓰는 `/e2e/order-cancel-status` fixture에서 `deliveryMethod`가 `direct`여도 송장 필드가 있으면 `택배사`, `CJ대한통운`, `운송장번호`, `1234567890`이 표시되고 모바일 가로 넘침이 0임을 확인했다.
- `CONSUMER_FIXTURE_BASE=http://127.0.0.1:3013 pnpm exec playwright test --config playwright.fixture.config.ts -- consumer-order-cancel-status.spec.ts --grep "택배사와 운송장번호"` chromium `1/1` 통과.
- 원본 `pending-visual-verify-20260529.md` `#147`을 `[x]`로 종결했다.

### 다음 진입점

- 판매자·소비자 택배 발송 묶음 `#146~#148`은 모두 종결됐다.
- 현재 잔여는 운영·계정 조건 또는 쓰기 승인이 필요한 `#43`, `#49~#51`, `#53~#58`, `#79`, 통합 데이터 계층 또는 쓰기 가능한 테스트 데이터가 필요한 `#173`이다.

## 35. 2026-06-06 판매자 주문 일괄 택배 발송 결과 `#173` 종결

- 운영 쓰기 없이 닫을 수 있도록 일괄 처리 결과 계산을 `orders/_bulkActionResults.ts`로 분리하고, 제품 페이지와 fixture가 같은 성공·실패 요약 계약을 사용하게 했다.
- `seller-order-bulk-parcel-ship.spec.ts`에서 성공 주문 `DELIVERED` 전환, 성공 주문 선택 해제, 실패 주문 선택 유지, 부분 실패 알림 `성공 1건, 실패 1건`을 검증했다.
- `SELLER_FIXTURE_BASE=http://127.0.0.1:3011 pnpm --filter e2e exec playwright test --config playwright.fixture.config.ts -- seller-order-bulk-parcel-ship.spec.ts` chromium `2/2` 통과. 원본 `pending-visual-verify-20260529.md` `#173`을 `[x]`로 종결했다.
- 후속으로 `admin-invite-revoke.spec.ts`에 취소됨 Badge orange 계열 계산 색상과 `375px` reason 알림 위치 단언을 추가해 `#208~#209`를 종결했다.
- `pnpm --filter e2e test admin-invite-revoke.spec.ts --project=chromium --project=mobile` 32/32 통과.
- 다음 1번 잔여는 운영·계정 조건 또는 쓰기 승인이 필요한 `#43`, `#49~#51`, `#53~#58`, `#79`다.

## 36. 2026-06-06 일반 셀러·순수 어드민 역할 분리 `#49~#51` 종결

- `TEST_SELLER_*`는 API 로그인 응답 기준 `role=seller`, `storeId` 보유 계정이고 `TEST_ADMIN_*`는 `role=admin`, `storeId` 없음 계정임을 확인했다. 토큰과 계정값은 출력하지 않았다.
- `seller-onboarding.spec.ts`에 일반 셀러 설정의 `관리자 콘솔로 이동` 미노출, 설정 `사업자 프로필 수정` 클릭 후 `/onboarding` 자기 프로필 pre-fill, 순수 어드민 `/onboarding` 접근 시 `/admin/stores` 리다이렉트 단언을 추가했다.
- `pnpm --filter e2e test -- seller-onboarding.spec.ts --project=chromium` 재실행 기준 12/12 통과했다.
- 원본 `pending-visual-verify.md` `#49~#51`을 `[x]`로 종결했다. 다음 1번 잔여는 운영 쓰기 승인이 필요한 겸직 프로필 저장 `#43`, 스토어 치우기·복구·기록 보존 `#53~#58`, 정지 사용자 refresh token 수동 확인 `#79`다.

## 37. 2026-06-06 관리자 스토어 치우기·복구 `#53~#57` 종결

- 운영 DB 쓰기 없이 닫을 수 있도록 `admin-stores-filter-sort.spec.ts`의 `/admin/stores` fixture를 상태ful로 보강하고 `archive`·`restore`·기록 보유 판매자 차단 응답을 같은 계약으로 주입했다.
- 빈 판매자 `디어 플라워` 치우기 확인창 문구, 성공 후 활성 목록 제거, archived 판매자 `정리된 정원` 필터 표시와 복구 후 활성 목록 재노출, 기록 있는 판매자 `초대 농원`의 400 차단 알림을 검증했다.
- 기본 수수료 패널과 행 수수료 저장 버튼 이름 충돌을 피하도록 기존 수수료 테스트를 행 단위 locator로 좁혔다.
- `pnpm --filter e2e test -- admin-stores-filter-sort.spec.ts --project=chromium`는 14개 테스트 중 첫 `기본 진입`이 한 번 로드 타임아웃 후 재시도 통과했고, 최종 13 passed + 1 flaky로 종료 코드 0을 반환했다.
- 원본 `pending-visual-verify.md` `#53~#57`을 `[x]`로 종결했다. `#58`은 archived 판매자의 과거 주문·정산 상세 데이터가 연결된 테스트 판매자 또는 운영 쓰기 승인이 필요해 `[ ]`로 유지한다.

### 다음 진입점

- 프롬프트 1번 잔여는 운영 쓰기 승인 또는 수동 토큰 조건이 필요한 겸직 프로필 저장 `#43`, archived 과거 주문·정산 보존 `#58`, 정지 사용자 refresh token 수동 확인 `#79`다.

## 38. 2026-06-06 archived 판매자 과거 주문·정산 보존 `#58` 종결

- 운영 DB 쓰기 없이 닫을 수 있도록 `admin-store-archive.spec.ts`에 `/admin/stores/e2e-store-archived/summary` fixture를 추가했다.
- archived 판매자 상세에서 `정리됨` 배지, 과거 주문 2건, 주문 금액 `₩87,000`, 플랫폼 수수료 `₩6,100`, 실지급 합계 `₩80,900`, 주문 상태 `배송 완료`·`주문 취소`, 정산 상태 `확정`·`지급 완료`가 그대로 표시되는지 검증했다.
- `pnpm --filter e2e test -- admin-store-archive.spec.ts --project=chromium --grep "archived 판매자 상세"` chromium `1/1` 통과.
- 원본 `pending-visual-verify.md` `#58`을 `[x]`로 종결했다.

### 다음 진입점

- 프롬프트 1번 잔여는 운영 쓰기 승인 또는 수동 토큰 조건이 필요한 겸직 프로필 저장 `#43`, 정지 사용자 refresh token 수동 확인 `#79`다.

## 39. 2026-06-06 정지 사용자 refresh 차단 `#79` 보류 재확인

- 프롬프트 1번 기준으로 release wave로 가지 않고 남은 계정·토큰 검증 중 `#79`를 먼저 확인했다.
- 현재 `apps/e2e/.env`에는 `TEST_CONSUMER_*`와 일반 인증 값만 있고, 정지 소비자 refresh token 또는 별도 정지 테스트 계정은 없다. 토큰값은 출력하지 않았다.
- 운영 사용자 정지나 refresh token 조작은 쓰기 영향이 있으므로 수행하지 않았다.
- 자동 계약 근거로 `pnpm --filter api test -- auth.service.spec.ts --runInBand`를 재실행해 `auth.service.spec.ts` 6/6 통과를 확인했다. 이 안에는 정지 사용자 refresh 401 차단과 정상 사용자 refresh rotation 발급 케이스가 포함된다.
- 원본 `pending-visual-verify.md` `#79`는 수동 토큰 조건이 충족되지 않아 `[ ]`로 유지했다.

### 다음 진입점

- 프롬프트 1번 잔여는 운영 쓰기 승인 또는 되돌릴 수 있는 겸직 계정 데이터가 필요한 프로필 저장 `#43`, 정지 소비자 refresh token 또는 별도 정지 테스트 계정이 필요한 `#79`다.

## 40. 2026-06-06 조건 부재 항목 `#43`, `#79` 확인 불가 처리

- 사용자 지시에 따라 프롬프트 1번의 남은 수동 조건 항목을 이번 세션 조건 부재로 확인 불가 처리했다.
- 원본 `pending-visual-verify.md`에서 겸직 계정 프로필 저장 `#43`은 운영 쓰기 승인 또는 되돌릴 수 있는 겸직 테스트 계정이 없어 `[-]`로 전환했다.
- 원본 `pending-visual-verify.md`에서 정지 사용자 refresh 차단 수동 확인 `#79`는 정지 소비자 refresh token 또는 별도 정지 테스트 계정이 없어 `[-]`로 전환했다. 자동 계약 근거인 `pnpm --filter api test -- auth.service.spec.ts --runInBand`는 6/6 통과 상태를 유지한다.

### 현재 결론

- 실행 가능한 핸드오프 프롬프트 1번 육안검증은 종료했다. 운영 쓰기 승인 또는 전용 테스트 계정이 확보되기 전까지 추가로 닫을 항목은 없다.
