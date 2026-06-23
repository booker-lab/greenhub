<!-- Language: ko -->

# Project Blueprint: 소비자 앱 육안검증 후속 작업 순차 실행

## 문서 메타

- **작성일**: 2026-06-22
- **Priority**: 1
- **Labels**: consumer, frontend, visual-verification, release
- **SSOT Check**: 발견 큐는 `docs/specs/frontend/consumer-app-visual-followup-plan.md`, 실행 순서와 종료 게이트는 이 문서를 기준으로 한다.
- **Architectural Goal**: 소비자 앱 후속 개선을 구매 신뢰도 순서로 분리하고 각 작업을 독립 검증·커밋·배포·육안검증한 뒤 다음 작업으로 넘긴다.

## 업무 요약

### 개요

소비자 앱 후속 큐에는 이미 구현된 항목의 잔여 검증, 즉시 수정 가능한 화면 개선, 정책 결정이 필요한 기능, API 계약 확장이 필요한 기능이 섞여 있다. 이 계획은 이를 의존성과 중요도에 따라 실행 묶음으로 나누며, **한 묶음이 Preview 육안검증까지 닫히기 전에는 다음 묶음을 시작하지 않는다.**

### 끝났을 때 확인할 것

- 주문·공구·장바구니에서 사용자가 가능한 행동을 오해하지 않는다.
- 홈·카테고리·상점에서 탐색 밀도와 현재 조건이 명확하다.
- 프론트 표시 규칙과 공유 타입·API 응답 계약이 일치한다.
- 각 실행 묶음에 독립 커밋, Preview·Production 주소, 검증 결과, 육안검증 체크가 남는다.
- 다음 작업자는 직전 묶음의 핸드오프만 읽고 이어서 진행할 수 있다.

## 🎯 Origin Intent

- **출처**: `consumer-app-visual-followup-plan.md`에 기록된 추가 작업을 실행 가능한 순서로 재구성해 달라는 사용자 요청.
- **원래 목적**: 각 후속 작업을 아토믹 태스크, 정합성 검토, 커밋·배포, 육안검증 체크리스트로 닫고 다음 작업으로 안전하게 넘긴다.
- **완료 관찰**: 모든 실행 묶음의 상태가 `완료` 또는 사유가 있는 `범위 밖`이며 발견 큐와 관련 선 설계 문서의 상태가 일치한다.

## ⚠️ Edge Case Trace

| 엣지 케이스 | 처리 위치 | 처리 원칙 |
| --- | --- | --- |
| 기존 구현이 이미 문제를 해결함 | W0 | 새 코드를 만들지 않고 검증 증거와 큐 상태만 갱신한다. |
| 인증 fixture가 없어 육안검증이 막힘 | W1 | fixture/API 권한을 먼저 복구하며 임시 운영 데이터로 우회하지 않는다. |
| 공구 설정 또는 수량이 누락됨 | W2 | 공유 상태 유틸의 `missing_config`·`invalid_config` 계약을 유지한다. |
| API 계약 확장이 필요함 | W8·W9 | API 선 설계·테스트·배포를 프론트 구현보다 먼저 닫는다. |
| 운영 데이터 문자열이 깨짐 | W11 | 프론트에서 임의 치환하지 않고 운영 데이터 정리로 분리한다. |
| Preview와 운영 화면이 다름 | 모든 묶음 | Preview를 먼저 검증하고 운영 승격 후 핵심 경로를 다시 확인한다. |
| 전체 lint의 기존 오류가 검증을 막음 | W0 | baseline을 먼저 0 errors로 만들고 이후 새 경고 증가를 금지한다. |
| 한 묶음에서 범위 밖 결함이 발견됨 | 모든 묶음 | 현재 묶음을 확장하지 않고 발견 큐에 새 ID로 기록한다. |

## 우선순위와 실행 순서

| 순서 | 묶음 | 중요도 | 선행 조건 | 종료 조건 |
| ---: | --- | --- | --- | --- |
| W0 | 기준선·문서 정합화 | 최우선 | 없음 | lint 기준선과 큐 상태가 현재 코드와 일치 |
| W1 | MY 주문 fixture·육안검증 종결 | 최우선 | W0 | E2E 11/11과 인증 화면 체크 완료 |
| W2 | 공구·장바구니 운영 검증 종결 | 최우선 | W1 | 참여 가능 상태와 결제 차단 체크 완료 |
| W3 | 공구 노출 정책 통일 | 높음 | W2 | 홈·카테고리·공구 탭이 같은 상태 기준 사용 |
| W4 | 홈 공동구매 컴팩트 카드 | 높음 | W3 | 모바일 홈 탐색 밀도 개선 확인 |
| W5 | 카테고리 필터 맥락 개선 | 높음 | W3 | 활성 조건과 빈 상태 해제 행동 확인 |
| W6 | 상점 노출 정책·카드 밀도 | 높음 | W0 | 상품 0개 정책과 상점 상세 밀도 확인 |
| W7 | `ProductCard` 화면별 variant | 중간 | W4·W6 | 홈·카테고리·상점 카드 책임 분리 |
| W8 | 공개 상품 API 탐색 계약 확장 | 중간 | W7 | 가격·배송·판매자·total 계약 배포 완료 |
| W9 | 카테고리 확장 필터·정보 힌트 | 중간 | W8 | 확장 필터와 카드 정보 육안검증 완료 |
| W10 | 카테고리 보조 탐색 UX | 낮음 | W9 | 색상·정렬·복귀·공유 UX 확인 |
| W11 | 운영 데이터·경고 정리 | 낮음/운영 | W0 | 데이터 정리와 CSS 경고를 별도 증거로 종결 |

## 공통 작업 종료 게이트

모든 묶음은 아래 순서를 지킨다. 하나라도 실패하면 다음 묶음으로 넘어가지 않는다.

1. **선 설계 확인**: 관련 `docs/specs/frontend/` 문서의 범위와 완료 기준을 먼저 갱신한다.
2. **아토믹 구현**: 한 태스크는 한 책임과 주 대상 파일 하나만 가진다.
3. **정합성 검토**: 화면, 데이터 계약, 상태 계산, 접근성, 500라인 제한을 확인한다.
4. **자동 검증**: 태스크별 Verify와 묶음별 lint·build·관련 E2E를 통과한다.
5. **독립 커밋**: 해당 묶음 파일만 stage하고 `consumer: <사용자 변화>` 형식으로 커밋한다.
6. **Preview 배포**: 커밋을 push하고 Vercel Preview `READY`와 대상 경로 HTTP 200을 확인한다.
7. **Preview 육안검증**: 375px 모바일과 데스크톱에서 체크리스트를 확인하고 캡처 또는 관찰 기록을 남긴다.
8. **Production 승격**: Preview 검증을 통과한 동일 artifact를 Production으로 승격한다. 검증 실패 시 승격하지 않으며, 승격 실패 시 다음 묶음으로 넘어가지 않는다.
9. **운영 도메인 검증**: Production `READY`, 배포 커밋 일치, 운영 도메인 HTTP 200과 핵심 화면을 확인한다. Production에서 테스트 Credentials가 비활성인 인증 경로는 Preview 인증 E2E 증거와 운영 비인증 smoke를 함께 기록한다.
10. **문서 종결**: 발견 큐 상태, 관련 선 설계 체크박스, 이 문서의 Conclusion을 갱신한다.
11. **핸드오프**: 아래 핸드오프 템플릿을 채운 뒤 다음 묶음을 시작한다.

### 공통 정합성 체크리스트

- [ ] 비즈니스 상태 판단은 공유 유틸 또는 API 계약에 있고 화면에서 재구현하지 않는다.
- [ ] 운영 데이터 정리와 프론트 표시 fallback을 같은 변경에 섞지 않는다.
- [ ] URL 쿼리, 공유 타입, API DTO, 화면 라벨의 허용값이 일치한다.
- [ ] 로딩·오류·빈 상태·부분 데이터 상태가 서로 구분된다.
- [ ] 키보드 역할과 선택 상태가 시각 스타일뿐 아니라 접근성 속성에도 반영된다.
- [ ] 수정 파일은 500라인 이하이며 초과 예상 시 먼저 하위 모듈로 분리한다.
- [ ] `docs/memory.md`는 200라인 이하이고 세션 종료 시 최신 상태를 반영한다.

### 공통 자동 검증

각 명령은 개별 실행하고 실패 원인을 현재 변경과 기존 기준선으로 구분한다.

- `pnpm --filter consumer lint`
- `pnpm --filter consumer build`
- `pnpm --filter consumer exec tsc --noEmit`
- 관련 `pnpm --filter e2e test -- <spec> --project=chromium`
- `git diff --check`

### 공통 육안검증 체크리스트

- [ ] 375px 화면에서 가로 넘침, 겹침, 잘린 CTA가 없다.
- [ ] 데스크톱 화면에서 콘텐츠 폭과 카드 밀도가 과도하게 늘어나지 않는다.
- [ ] 로딩·오류·빈 상태에서 하단 내비게이션과 복구 행동이 유지된다.
- [ ] 새로고침·뒤로가기·상세 진입 후 복귀에서 조건과 위치가 의도대로 유지된다.
- [ ] 콘솔에 새 오류나 hydration 경고가 없다.
- [ ] Preview에서 확인한 커밋 해시와 배포 커밋 해시가 일치한다.

## Agent Completion Contract

각 묶음은 Verify exit 0 → 독립 커밋 → Preview `READY` → Preview 육안검증 → 동일 artifact Production 승격 → 운영 도메인 검증 → 문서 Conclusion 갱신 순서로 종료한다. 구현이나 Preview 검증만 끝난 상태를 `완료`로 기록하지 않는다.

> **에이전트 스코프**: 사용자가 PLAN 전체 실행을 요청하면 W0부터 Dependency 순서로 한 묶음씩 진행한다. 각 아토믹 태스크는 목표 파일 하나를 중심으로 수정하고, 묶음 종료 게이트가 닫히기 전 다음 묶음을 시작하지 않는다. 실행 중 새 결함은 현재 범위에 끼워 넣지 않고 발견 큐에 기록한다.

## Execution Plan

### W0. 기준선·문서 정합화

**대상 ID**: 전체 큐, `CONSUMER-LINT-BASELINE`
**목표**: 이미 끝난 구현과 실제 잔여 작업을 분리하고 이후 모든 묶음이 신뢰할 lint 기준선을 만든다.

| Task-ID | 아토믹 태스크 | Target | Verify |
| --- | --- | --- | --- |
| 0.1 | 소비자 lint의 `forEach` 반환 오류를 블록 본문으로 고친다. | `apps/consumer/src/hooks/useCart.ts` | `pnpm exec biome check apps/consumer/src/hooks/useCart.ts` |
| 0.2 | 알림 훅의 `forEach` 반환 오류를 블록 본문으로 고친다. | `apps/consumer/src/hooks/useNotifications.ts` | `pnpm exec biome check apps/consumer/src/hooks/useNotifications.ts` |
| 0.3 | 이미지·index key·non-null assertion 경고를 파일별 후속 태스크로 분리해 0 errors 기준을 고정한다. | `docs/BACKLOG.md` | `pnpm --filter consumer lint` |
| 0.4 | 후속 큐를 코드·기존 선 설계 문서와 대조해 상태를 갱신한다. | `docs/specs/frontend/consumer-app-visual-followup-plan.md` | `git diff --check` |

**육안검증**: 없음. W0는 코드 동작 불변을 전제로 관련 소비자 E2E smoke를 통과한다.
**커밋 예시**: `consumer: lint 기준선과 후속 작업 상태를 정리`
**Conclusion**: [완료 — 2026-06-22. 소비자 lint 오류 2건을 제거하고 오류 0건·경고 14건 기준선을 확정했다. 경고는 `CONSUMER-LINT-FOLLOWUP`으로 파일별 분리했다. 파일별 Biome, 전체 lint, 타입체크, build, `git diff --check`가 통과했고, 최종 커밋 `244f49d`의 Preview `dpl_6sjaVsNrPxJLEJZrU7yHgkPzLmkV`가 `READY`·HTTP 200임을 확인했다. 해당 브랜치 Preview에서 장바구니 8/8·알림 2/2 smoke를 통과했으며, 375px·데스크톱 홈은 가로 넘침·오류 오버레이·콘솔 오류 없이 렌더됐다. 동일 artifact를 Production `dpl_5cahZW5RbmnU3MiTHfbErH7so62j`로 승격해 `greenlove.co.kr`·`www.greenlove.co.kr` alias와 HTTP 200을 확인했다. Production 인증 E2E는 테스트 Credentials 비활성 정책에 따라 실행하지 않고 Preview 인증 E2E 증거를 유지한다.]

#### W0 종료 체크리스트

- [x] 선 설계와 발견 큐의 lint 기준선을 현재 코드에 맞췄다.
- [x] `useCart.ts`와 `useNotifications.ts`를 파일별 책임 안에서 수정했다.
- [x] 수정 코드·문서의 정합성과 500라인 제한을 확인했다.
- [x] 자동 검증과 관련 소비자 E2E smoke를 통과했다.
- [x] 독립 커밋 `554eef3`을 push했다.
- [x] Vercel Preview `READY`, 루트 HTTP 200, 배포 커밋 일치를 확인했다.
- [x] 브랜치 Preview를 375px·데스크톱에서 육안검증했다.
- [x] 동일 artifact를 Production으로 승격하고 운영 도메인 HTTP 200을 확인했다.
- [x] 발견 큐, BACKLOG, Conclusion, `docs/memory.md`를 종결 상태로 맞췄다.

```text
[W0 핸드오프]
- 완료 범위: 소비자 lint 오류 0건 기준선, 경고 14건 후속 분리, 실행 계획 SSOT 연결
- 제외·새 발견: 기능 변경 없음. 고정 git-preview의 장바구니 2건 실패는 오래된 배포 불일치였고 현재 브랜치 Preview 8/8 통과로 종결
- 커밋: 554eef3 consumer: lint 기준선과 후속 작업 상태를 정리 / 244f49d 문서: W0 검증 종결과 W1 핸드오프 기록
- Preview 배포: dpl_6sjaVsNrPxJLEJZrU7yHgkPzLmkV / greenhubconsumer-git-codex-consume-29d333-jos-projects-d1cecc0c.vercel.app / READY
- Production 배포: dpl_5cahZW5RbmnU3MiTHfbErH7so62j / greenlove.co.kr / READY / HTTP 200
- 자동 검증: Biome 2/2, lint 오류 0·경고 14, tsc, build, diff-check, 장바구니 8/8, 알림 2/2
- 육안검증: 375px·데스크톱 홈 가로 넘침 0, 오류 오버레이 0, 콘솔 오류 0, 핵심 콘텐츠·하단 내비 정상
- 문서 갱신: BACKLOG, CRITICAL_LOGIC, 발견 큐, 본 PLAN Conclusion·체크박스, memory
- 다음 묶음: W1
- 다음 첫 행동: consumer-mypage-receive-confirm-plan.md와 global-setup.ts의 고정 주문 fixture 계약을 대조하고, 선 설계를 먼저 갱신한다.
```

### W1. MY 주문 fixture·육안검증 종결

**대상 ID**: `C-MYPAGE-01`, `CONSUMER-MYPAGE-E2E-FIXTURE`
**목표**: 주문 목록·택배 상세 fixture를 복구하고 MY 개선을 운영 화면 기준으로 닫는다.

| Task-ID | 아토믹 태스크 | Target | Verify |
| --- | --- | --- | --- |
| 1.1 | 고정 택배 주문 fixture의 소유자·상태·운송장 계약을 보정한다. | `apps/e2e/global-setup.ts` | `pnpm --filter e2e test -- consumer-mypage.spec.ts --project=chromium` |
| 1.2 | 주문 목록·빈 상태·택배 상세 기대값을 fixture 계약으로 고정한다. | `apps/e2e/tests/consumer-mypage.spec.ts` | `pnpm --filter e2e test -- consumer-mypage.spec.ts --project=chromium` |
| 1.3 | MY 선 설계의 T7과 완료 체크를 실제 결과로 종결한다. | `docs/specs/frontend/consumer-mypage-receive-confirm-plan.md` | `git diff --check` |

**정합성 집중 검토**: `consumer@test.com` 소유권, `DELIVERED`·`PICKED_UP` 구매 확정 조건, 택배사·운송장 부분 누락 표시.
**육안검증**: 로그인 MY 목록, 일반/공구 구분, 택배 상세, 거점 픽업 코드, 구매 확정 성공·실패를 확인한다.
**커밋 예시**: `consumer: MY 주문 fixture와 수령 검증을 종결`
**Conclusion**: [완료 — 2026-06-22. `consumer@test.com` 소유의 택배 완료·픽업 완료·공동구매 주문 3건을 `global-setup.ts`에서 멱등 복구하도록 고정했다. MY 목록의 일반/공구 구분과 `확정 가능` 신호, 픽업 코드·수령 장소, 택배사·운송장, 구매 확정 실패·성공을 E2E로 보강했다. Biome, 소비자 lint 오류 0·기존 경고 14, 타입체크, build, `git diff --check`가 통과했고 최종 Preview `dpl_6oHtew8tXvvQ5Fa48tg89shTF3Eu`에서 chromium 11/11을 통과했다. 375px·1440px의 MY 목록·픽업 상세·택배 상세 6개 화면은 가로 넘침 0·콘솔 오류 0이며 하단 내비게이션 가림이 없었다. 동일 artifact를 Production `dpl_2NfvKCxpmj3KeBp9gCQwo1mpQx7W`로 승격해 커밋 `b7fb1e2`, `greenlove.co.kr`·`www.greenlove.co.kr` alias, 운영 루트 200과 비인증 MY 로그인 이동 200을 확인했다.]

#### W1 종료 체크리스트

- [x] 고정 MY fixture의 소유자·상태·수령 정보를 현재 인증 계약에 맞췄다.
- [x] 목록·픽업·택배·구매 확정 성공·실패 기대값을 E2E로 고정했다.
- [x] 수정 파일의 정합성·500라인 제한과 `memory.md` 200라인 제한을 확인했다.
- [x] lint·타입체크·build·Biome·diff-check와 MY E2E 11/11을 통과했다.
- [x] 구현 커밋 `fedf215`와 fixture 보강 커밋 `b7fb1e2`를 push했다.
- [x] 최종 Preview `READY`, HTTP 200, 배포 커밋 일치를 확인했다.
- [x] 375px·1440px에서 MY 목록·픽업 상세·택배 상세를 육안검증했다.
- [x] 동일 artifact를 Production으로 승격하고 운영 도메인 핵심 경로를 확인했다.
- [x] 선 설계 T7, 발견 큐, Conclusion, `docs/memory.md`를 종결 상태로 맞췄다.

```text
[W1 핸드오프]
- 완료 범위: MY 전용 택배·픽업·공구 fixture 3건 멱등 복구, 목록 일반/공구 구분, 픽업 코드·택배 송장·구매 확정 성공/실패 검증 종결
- 제외·새 발견: 고유 Preview URL은 Railway CORS 허용 목록 밖이라 인증 API 검증은 배포 커밋이 같은 고정 브랜치 alias에서 수행. 기능 결함은 아님
- 커밋: fedf215 consumer: MY 주문 fixture와 수령 검증을 종결 / b7fb1e2 consumer: MY 픽업과 공구 fixture 검증을 보강
- Preview 배포: dpl_6oHtew8tXvvQ5Fa48tg89shTF3Eu / greenhubconsumer-bnea90hc3-jos-projects-d1cecc0c.vercel.app / READY
- Production 배포: dpl_2NfvKCxpmj3KeBp9gCQwo1mpQx7W / greenlove.co.kr / READY / HTTP 200
- 자동 검증: Biome 3파일, lint 오류 0·경고 14, tsc, build, diff-check, MY chromium 11/11
- 육안검증: 375px·1440px 목록·픽업·택배 6화면, 가로 넘침 0, 콘솔 오류 0, 하단 내비 가림 없음
- 문서 갱신: CRITICAL_LOGIC #CL-149, MY 선 설계 T7, 발견 큐 C-MYPAGE-01, 본 PLAN Conclusion·체크박스, memory
- 남은 문제: W1 기능 결함 없음. 고유 Preview URL CORS 제약은 기존 고정 브랜치 alias 검증 계약을 유지
- 다음 묶음: W2
- 다음 첫 행동: consumer-groupbuy.spec.ts와 consumer-cart.spec.ts를 현재 공유 getGroupBuyStatus()·cartValidation 계약과 대조해 2.1 선행 검증 범위를 확정한다.
```

### W2. 공구·장바구니 운영 검증 종결

**대상 ID**: `C-GROUPBUY-01`, `C-CART-01`
**목표**: 이미 구현된 상태 분류와 결제 전 차단이 Preview에서도 동일하게 동작함을 입증한다.

| Task-ID | 아토믹 태스크 | Target | Verify |
| --- | --- | --- | --- |
| 2.1 | 공구 E2E를 모집 중·완료·정보 확인 필요 상태 기준으로 보강한다. | `apps/e2e/tests/consumer-groupbuy.spec.ts` | `pnpm --filter e2e test -- consumer-groupbuy.spec.ts --project=chromium` |
| 2.2 | 장바구니 E2E를 문제 사유·재선택·결제 차단 기준으로 보강한다. | `apps/e2e/tests/consumer-cart.spec.ts` | `pnpm --filter e2e test -- consumer-cart.spec.ts --project=chromium` |
| 2.3 | 운영 관찰 결과와 새 발견 ID를 후속 큐에 반영한다. | `docs/specs/frontend/consumer-app-visual-followup-plan.md` | `git diff --check` |

**정합성 집중 검토**: `getGroupBuyStatus()` 단일 기준, 판매자 지정 배송 방식, `cartValidation`의 장바구니·checkout 공유.
**육안검증**: 공구 세 구역, CTA 활성 조건, 문제 장바구니 항목 유지, `다시 선택하기`, 전체 결제 비활성을 확인한다.
**커밋 예시**: `consumer: 공구와 장바구니 운영 검증을 고정`
**Conclusion**: [완료 — 2026-06-22. 공구 모집 중·완료·정보 확인 필요 3상태를 결정적 API fixture로 고정하고, 장바구니의 배송일·상점 정보 복합 누락 항목이 유지된 채 각 사유와 `다시 선택하기` 경로를 표시하며 전체 결제와 `checkout_cart` 기록을 차단하는 계약을 보강했다. 소비자 lint 오류 0·기존 경고 14, 타입체크, build, 변경 E2E Biome, `git diff --check`가 통과했다. 커밋 `dbda8e1`의 Preview `dpl_25u3e1xZsLFiWNR93tw9EDvUy5Ra`는 `READY`이며 chromium 15/15·mobile 15/15를 통과했다. 브랜치 alias의 375px·1440px 공구 화면은 가로 넘침 0, 콘텐츠 폭 제한, 하단 내비게이션 유지, 콘솔 오류·경고 0이었다. 동일 artifact를 Production `dpl_Ei7vJxiawQEynYepUEoV5q6eRq4E`로 승격해 `greenlove.co.kr` 루트·공구 HTTP 200과 비인증 장바구니 로그인 이동을 확인했다.]

#### W2 종결 체크리스트
- [x] 공구 모집 중·완료·정보 확인 필요 상태를 결정적 fixture로 고정했다.
- [x] 문제 장바구니 항목 유지, 사유, 재선택 경로, 전체 결제 차단을 고정했다.
- [x] 공유 `getGroupBuyStatus()`와 `cartValidation` 계약을 화면에서 재구현하지 않았음을 확인했다.
- [x] 수정 파일 500라인 이하와 `memory.md` 200라인 이하를 확인했다.
- [x] lint·타입체크·build·Biome·diff-check와 Preview E2E 30건을 통과했다.
- [x] 독립 커밋 `dbda8e1`을 push했다.
- [x] Preview `READY`, 배포 커밋 일치, 모바일·데스크톱 육안검증을 완료했다.
- [x] 동일 artifact를 Production으로 승격하고 운영 핵심 경로를 확인했다.
- [x] 발견 큐, Conclusion, `docs/memory.md`와 W3 핸드오프를 종결 상태로 맞췄다.

```text
[W2 핸드오프]
- 완료 범위: 공구 3상태 결정적 fixture, 장바구니 복합 문제 유지·사유·재선택·결제 차단 계약, Preview·Production 검증
- 제외·새 발견: 기능 결함 없음. 고유 Preview URL은 API CORS 제약이 있어 기존 브랜치 alias 육안검증 계약을 유지
- 커밋: dbda8e1 consumer: 공구와 장바구니 운영 검증을 고정
- Preview 배포: dpl_25u3e1xZsLFiWNR93tw9EDvUy5Ra / greenhubconsumer-dy7dfx1rh-jos-projects-d1cecc0c.vercel.app / READY
- Production 배포: dpl_Ei7vJxiawQEynYepUEoV5q6eRq4E / greenlove.co.kr / READY / 루트·공구 HTTP 200
- 자동 검증: lint 오류 0·기존 경고 14, tsc, build, Biome, diff-check, chromium 15/15, mobile 15/15
- 육안검증: 375px·1440px 공구 가로 넘침 0, 430px 콘텐츠 폭, 하단 내비게이션 유지, 콘솔 오류·경고 0; 운영 장바구니 비인증 로그인 이동 정상
- 문서 갱신: 발견 큐, PLAN W2 Conclusion·체크리스트, memory
- 다음 묶음: W3
- 다음 첫 행동: consumer-groupbuy-tab-improve-plan.md에서 홈·카테고리·공구의 `recruiting` 노출 정책을 대조하고 3.1 설계 결정을 먼저 확정한다.
```

### W3. 공구 노출 정책 통일

**대상 ID**: `C-HOME-02`, `C-CATEGORY-02`
**목표**: 홈·카테고리·공구 탭이 참여 가능 공구와 종료·오류 공구를 같은 기준으로 구분한다.

| Task-ID | 아토믹 태스크 | Target | Verify |
| --- | --- | --- | --- |
| 3.1 | 세 화면의 상태별 노출 정책을 선 설계에 확정한다. | `docs/specs/frontend/consumer-groupbuy-tab-improve-plan.md` | `git diff --check` |
| 3.2 | 홈 미리보기 필터를 공유 상태 유틸 기준으로 교체한다. | `apps/consumer/src/components/HomeProductList.tsx` | `pnpm --filter consumer build` |
| 3.3 | 카테고리 공구 탭의 상태별 노출 규칙을 적용한다. | `apps/consumer/src/app/category/_client.tsx` | `pnpm --filter e2e test -- consumer-category.spec.ts --project=chromium` |

**정합성 집중 검토**: `recruiting`만 참여 가능, 실패·종료는 공구 탭에서 정보 제공, 누락 설정은 구매 CTA 비활성.
**육안검증**: 같은 fixture가 홈에서는 숨겨지고 공구 탭에서는 올바른 상태 영역에 보이며 카테고리에서 참여 가능으로 오인되지 않는지 확인한다.
**커밋 예시**: `consumer: 공구 참여 가능 노출 기준을 통일`
**Conclusion**: [완료 — 2026-06-23. 홈·카테고리·공구의 참여 가능 기준을 공유 `getGroupBuyStatus()`의 `recruiting`으로 통일했다. 홈 진행 중 공동구매와 카테고리 공동구매 탭은 `recruiting`만 노출하고, 모집 완료·마감·실패·설정 오류 상태는 공구 탭의 상태별 정보 영역으로 분리한다. Biome, 소비자 build, 타입체크, lint 오류 0·기존 경고 14, `git diff --check`, 로컬 chromium 6/6·mobile 6/6, Preview branch alias chromium 6/6·mobile 6/6이 통과했다. 구현 커밋 `a243bb5`의 Preview `dpl_Bsph794hKAmhztqFFBcGavgnW77h`는 `READY`이며, 375px·1440px 홈·카테고리·공구 육안검증에서 가로 넘침 0, 콘솔 오류·경고 0, 상태별 분리 표시를 확인했다. 동일 artifact를 Production `dpl_2KRFF5nzqVtXP9E7UrnMeDSX5Ndb`로 승격해 `greenlove.co.kr`·`www.greenlove.co.kr` alias, 운영 루트·공구·카테고리 공동구매 HTTP 200, 375px·1440px 운영 육안검증 가로 넘침 0·콘솔 오류 0을 확인했다. 고유 Preview URL은 Vercel 보호·API CORS 제약이 있어 브랜치 alias와 인증 우회 상태로 검증했다.]

#### W3 종료 체크리스트

- [x] 3.1 선 설계와 `CRITICAL_LOGIC`에 `recruiting` 노출 정책 결정을 기록했다.
- [x] 홈 미리보기와 카테고리 공동구매 탭이 공유 상태 유틸 기준으로 `recruiting`만 노출한다.
- [x] 공구 탭은 실패·종료·설정 오류 상품을 참여 가능 목록과 분리해 정보 제공 영역에 유지한다.
- [x] 변경 파일 Biome, 소비자 build, 타입체크, lint, `git diff --check`가 통과했다.
- [x] 로컬 및 Preview branch alias E2E가 chromium·mobile에서 통과했다.
- [x] Preview와 Production 375px·1440px 육안검증에서 가로 넘침·오류 오버레이·콘솔 오류가 없음을 확인했다.
- [x] 발견 큐, Conclusion, `docs/memory.md`와 W4 핸드오프를 종결 상태로 맞췄다.

#### W3 핸드오프

- 구현 커밋: `a243bb5`
- 문서 커밋: 이 섹션 갱신 커밋
- Preview: `dpl_Bsph794hKAmhztqFFBcGavgnW77h`
- Production: `dpl_2KRFF5nzqVtXP9E7UrnMeDSX5Ndb`
- 자동 검증: 로컬 chromium 6/6·mobile 6/6, Preview branch alias chromium 6/6·mobile 6/6
- 육안검증: Preview·Production 375px·1440px 홈·카테고리·공구 가로 넘침 0, 콘솔 오류·경고 0
- 남은 문제: 고유 Preview URL API CORS·Vercel 보호 제약은 기능 결함이 아니며 branch alias 기준으로 검증한다.
- 문서 갱신: CRITICAL_LOGIC #CL-150, 공구 탭 선 설계 4.4, 발견 큐 C-HOME-02·C-CATEGORY-02, 본 PLAN W3 Conclusion·체크리스트, memory
- 다음 묶음: W4
- 다음 첫 행동: `consumer-home-groupbuy-improve-plan.md`와 현재 `HomeProductList.tsx`의 홈 공동구매 카드 밀도를 대조하고 W4.1 컴팩트 카드 규격을 먼저 확정한다.

### W4. 홈 공동구매 컴팩트 카드

**대상 ID**: `C-HOME-01`, `C-HOME-03`
**목표**: 홈 공동구매를 상세 배너가 아닌 빠른 탐색용 미리보기로 만든다.

| Task-ID | 아토믹 태스크 | Target | Verify |
| --- | --- | --- | --- |
| 4.1 | 이미지 높이·텍스트 줄 수·수량·마감 정보의 컴팩트 규격을 선 설계에 고정한다. | `docs/specs/frontend/consumer-home-groupbuy-improve-plan.md` | `git diff --check` |
| 4.2 | 홈 공동구매 카드 레이아웃을 컴팩트 규격으로 조정한다. | `apps/consumer/src/components/HomeProductList.tsx` | `pnpm --filter consumer build` |
| 4.3 | 홈 카드 높이와 하단 내비게이션 회귀를 E2E로 고정한다. | `apps/e2e/tests/consumer-groupbuy.spec.ts` | `pnpm --filter e2e test -- consumer-groupbuy.spec.ts --project=chromium` |

**육안검증**: 375px에서 첫 화면에 공동구매 카드와 다음 탐색 섹션의 시작이 함께 보이고, 이미지 잘림·텍스트 넘침이 없는지 확인한다.
**커밋 예시**: `consumer: 홈 공동구매 미리보기를 컴팩트하게 개선`
**Conclusion**: [대기 — 홈 미리보기의 탐색 밀도를 개선한다. 검증 결과 미기록]

### W5. 카테고리 필터 맥락 개선

**대상 ID**: `C-CATEGORY-03`, `C-CATEGORY-04`
**목표**: 현재 조건과 결과가 없는 이유를 사용자가 즉시 이해하고 조건을 해제할 수 있게 한다.

| Task-ID | 아토믹 태스크 | Target | Verify |
| --- | --- | --- | --- |
| 5.1 | 활성 필터 라벨·해제 규칙을 순수 유틸로 정의한다. | `apps/consumer/src/app/category/_query.ts` | `pnpm --filter consumer exec tsc --noEmit` |
| 5.2 | 활성 필터 요약 바와 조건별 해제 행동을 추가한다. | `apps/consumer/src/app/category/_client.tsx` | `pnpm --filter consumer build` |
| 5.3 | 빈 상태 문구와 전체 초기화 행동을 필터 조합별로 검증한다. | `apps/e2e/tests/consumer-category.spec.ts` | `pnpm --filter e2e test -- consumer-category.spec.ts --project=chromium` |

**정합성 집중 검토**: URL이 SSOT이며 칩 삭제·전체 초기화·뒤로가기가 같은 쿼리 계약을 사용한다.
**육안검증**: 긴 필터 조합의 가로 넘침, 칩 한 개 해제, 전체 초기화, 결과 없음 문구를 확인한다.
**커밋 예시**: `consumer: 카테고리 필터 맥락과 빈 상태를 개선`
**Conclusion**: [대기 — 필터 조건과 빈 상태 복구 행동을 명확히 한다. 검증 결과 미기록]

### W6. 상점 노출 정책·카드 밀도

**대상 ID**: `C-STORES-04`, `C-STORES-05`, `C-STORES-06`
**목표**: 구매 가능한 상점을 우선 탐색하게 하고 정렬 방향과 상세 상품 밀도를 명확히 한다.

| Task-ID | 아토믹 태스크 | Target | Verify |
| --- | --- | --- | --- |
| 6.1 | 상품 0개 상점의 하단 정렬·준비 중 표시 정책을 선 설계에 확정한다. | `docs/specs/frontend/consumer-stores-tab-improve-plan.md` | `git diff --check` |
| 6.2 | 상점 정렬 라벨과 0개 상점 표시 규칙을 적용한다. | `apps/consumer/src/app/stores/page.tsx` | `pnpm --filter consumer build` |
| 6.3 | 상점 상세 상품 그리드의 모바일 밀도를 조정한다. | `apps/consumer/src/app/stores/[storeId]/page.tsx` | `pnpm --filter consumer build` |
| 6.4 | 정렬·준비 중·상세 진입 계약을 E2E로 고정한다. | `apps/e2e/tests/consumer-stores.spec.ts` | `pnpm --filter e2e test -- consumer-stores.spec.ts --project=chromium` |

**육안검증**: `상품 많은순` 의미, 0개 상점 배지·위치, 375px 상세 그리드 비교 밀도, 상품 상세 진입·복귀를 확인한다.
**커밋 예시**: `consumer: 구매 가능 상점 탐색과 카드 밀도를 개선`
**Conclusion**: [대기 — 상점 탐색 우선순위와 모바일 밀도를 맞춘다. 검증 결과 미기록]

### W7. `ProductCard` 화면별 variant

**대상 ID**: `C-CATEGORY-07`, `C-CATEGORY-14`
**목표**: 홈·카테고리·상점 상세의 서로 다른 카드 정보 밀도를 명시적 variant로 관리한다.

| Task-ID | 아토믹 태스크 | Target | Verify |
| --- | --- | --- | --- |
| 7.1 | `compact`, `discovery`, `store`의 표시 필드와 접근성 계약을 선 설계에 기록한다. | `docs/specs/frontend/consumer-category-exploration-plan.md` | `git diff --check` |
| 7.2 | `ProductCard`에 variant별 표현 경계를 추가한다. | `apps/consumer/src/components/ProductCard.tsx` | `pnpm --filter consumer build` |
| 7.3 | 카테고리 화면에 `discovery` variant를 적용한다. | `apps/consumer/src/app/category/_client.tsx` | `pnpm --filter consumer build` |
| 7.4 | 상점 상세에 `store` variant를 적용한다. | `apps/consumer/src/app/stores/[storeId]/page.tsx` | `pnpm --filter consumer build` |

**정합성 집중 검토**: 가격·공구 상태 같은 도메인 정보는 동일하고 표시 밀도만 달라진다.
**육안검증**: 같은 상품을 카테고리와 상점 상세에서 비교해 정보 누락·중복·카드 높이 회귀가 없는지 확인한다.
**커밋 예시**: `consumer: 상품 카드의 화면별 표시 밀도를 분리`
**Conclusion**: [대기 — 카드 재사용과 화면별 밀도를 함께 유지한다. 검증 결과 미기록]

### W8. 공개 상품 API 탐색 계약 확장

**대상 ID**: `C-CATEGORY-05`, `C-CATEGORY-06`, `C-CATEGORY-07`, `C-CATEGORY-11`
**목표**: 가격대·배송 방식·판매자 힌트·전체 개수를 프론트가 추정하지 않도록 공개 API 계약으로 제공한다.

| Task-ID | 아토믹 태스크 | Target | Verify |
| --- | --- | --- | --- |
| 8.1 | 공개 상품 목록의 새 쿼리·응답 계약을 API 명세에 확정한다. | `docs/specs/api/products.md` | `git diff --check` |
| 8.2 | 가격·배송·판매자·total 계약의 실패 테스트를 먼저 추가한다. | `apps/api/src/products/products.service.spec.ts` | `pnpm --filter api test -- products.service.spec.ts` |
| 8.3 | 공개 상품 조회를 새 계약에 맞춘다. | `apps/api/src/products/products.service.ts` | `pnpm --filter api build` |
| 8.4 | 소비자 상품 훅이 새 필터와 total을 전달한다. | `apps/consumer/src/hooks/useProducts.ts` | `pnpm --filter consumer build` |

**정합성 집중 검토**: 가격 경계 포함 여부, 복수 배송 방식 의미, 판매자명 fallback, 현재 페이지 개수와 서버 total 구분.
**육안검증**: API Preview 응답을 먼저 확인하며 이 묶음에서는 UI를 추가하지 않는다.
**커밋 예시**: `api: 소비자 상품 탐색 계약을 확장`
**Conclusion**: [대기 — 프론트 탐색 확장에 필요한 API 계약을 먼저 배포한다. 검증 결과 미기록]

### W9. 카테고리 확장 필터·정보 힌트

**대상 ID**: `C-CATEGORY-05`, `C-CATEGORY-06`, `C-CATEGORY-07`, `C-CATEGORY-11`
**목표**: W8 계약을 사용해 가격·배송 조건과 판매자·배송 힌트를 탐색 화면에 제공한다.

| Task-ID | 아토믹 태스크 | Target | Verify |
| --- | --- | --- | --- |
| 9.1 | 가격대·배송 방식 URL 파싱 규칙을 추가한다. | `apps/consumer/src/app/category/_query.ts` | `pnpm --filter consumer exec tsc --noEmit` |
| 9.2 | 가격대·배송 방식 필터와 서버 total 표시를 추가한다. | `apps/consumer/src/app/category/_client.tsx` | `pnpm --filter consumer build` |
| 9.3 | 상품 카드에 판매자·배송 힌트를 variant 계약으로 표시한다. | `apps/consumer/src/components/ProductCard.tsx` | `pnpm --filter consumer build` |
| 9.4 | 필터 조합·새로고침·total·배지를 E2E로 고정한다. | `apps/e2e/tests/consumer-category.spec.ts` | `pnpm --filter e2e test -- consumer-category.spec.ts --project=chromium` |

**육안검증**: 가격 경계값, 복수 배송 방식, 긴 판매자명, 결과 0건, 서버 total과 렌더 개수를 확인한다.
**커밋 예시**: `consumer: 가격과 배송 기준 상품 탐색을 추가`
**Conclusion**: [대기 — API 계약 기반 확장 필터를 화면에 연결한다. 검증 결과 미기록]

### W10. 카테고리 보조 탐색 UX

**대상 ID**: `C-CATEGORY-08`, `C-CATEGORY-09`, `C-CATEGORY-10`, `C-CATEGORY-12`, `C-CATEGORY-13`
**목표**: 핵심 구매 판단을 해치지 않는 범위에서 긴 탐색의 조작 편의와 공유성을 높인다.

| Task-ID | 아토믹 태스크 | Target | Verify |
| --- | --- | --- | --- |
| 10.1 | 색상 그룹과 OR 의미 안내 상수를 정의한다. | `apps/consumer/src/app/category/_constants.ts` | `pnpm --filter consumer exec tsc --noEmit` |
| 10.2 | 색상 그룹·버튼형 정렬·OR 안내를 적용한다. | `apps/consumer/src/app/category/_client.tsx` | `pnpm --filter consumer build` |
| 10.3 | 상세 복귀 anchor와 현재 조건 공유 행동을 추가한다. | `apps/consumer/src/app/category/page.tsx` | `pnpm --filter consumer build` |
| 10.4 | 키보드·뒤로가기·링크 복사를 E2E로 고정한다. | `apps/e2e/tests/consumer-category.spec.ts` | `pnpm --filter e2e test -- consumer-category.spec.ts --project=chromium` |

**육안검증**: 19색 탐색 부담, 선택 색 OR 안내, 정렬 버튼 넘침, 상세 복귀 위치, 공유 링크 재진입을 확인한다.
**커밋 예시**: `consumer: 카테고리 보조 탐색과 공유 흐름을 개선`
**Conclusion**: [대기 — 긴 카테고리 탐색의 조작 편의를 보강한다. 검증 결과 미기록]

### W11. 운영 데이터·경고 정리

**대상 ID**: `C-HOME-04`, `C-STORES-01`, `C-STORES-07`
**목표**: 프론트 기능 변경과 분리해 깨진 주소 데이터와 CSS preload 경고를 추적 가능한 운영 작업으로 닫는다.

| Task-ID | 아토믹 태스크 | Target | Verify |
| --- | --- | --- | --- |
| 11.1 | 깨진 주소 대상 상점과 안전한 정리·복구 절차를 운영 명세에 기록한다. | `docs/specs/ops/seller-validation-data-cleanup.md` | `git diff --check` |
| 11.2 | CSS preload 경고의 재현 조건과 원인을 프론트 명세에 기록한다. | `docs/specs/frontend/consumer-app-visual-followup-plan.md` | `pnpm --filter consumer build` |
| 11.3 | 승인된 데이터 정리 후 홈·상점 주소를 운영 화면에서 재확인한다. | `docs/specs/frontend/manual-visual-verify-checklist.md` | `git diff --check` |

**정합성 집중 검토**: 운영 쓰기는 백업·dry-run·명시적 승인 뒤 수행하며 프론트 fallback으로 원본 훼손을 숨기지 않는다.
**육안검증**: 홈·상점 목록·상점 상세 주소, 콘솔 경고의 감소, 기능 오류와 경고 구분을 확인한다.
**커밋 예시**: `ops: 소비자 화면 운영 데이터와 경고 정리 절차를 기록`
**Conclusion**: [대기 — 운영 데이터와 낮은 우선순위 경고를 별도 작업으로 종결한다. 검증 결과 미기록]

## 계획 작성 검증

- [x] 발견 큐의 미완료 ID를 W0~W11 실행 묶음에 연결했다.
- [x] 완료 상태인 `C-CATEGORY-01`, `C-STORES-02`, `C-STORES-03`은 W0 대조 대상으로 유지하고 재구현 대상에서 제외했다.
- [x] 각 묶음에 아토믹 태스크, 정합성 집중 검토, 커밋 예시, Preview 이후 육안검증 기준, Conclusion을 배치했다.
- [x] 현재 계획 대상 코드 파일이 모두 500라인 이하임을 확인했다.
- [x] `docs/memory.md`가 200라인 이하임을 확인했다.

## 묶음별 핸드오프 템플릿

각 묶음 종료 시 아래 내용을 이 문서의 해당 Conclusion 또는 세션 메모리에 남긴다.

```text
[Wn 핸드오프]
- 완료 범위:
- 제외·새 발견:
- 커밋:
- Preview 배포:
- Production 배포:
- 자동 검증:
- 육안검증:
- 문서 갱신:
- 다음 묶음: Wn+1
- 다음 첫 행동:
```

## 전체 종료 체크리스트

- [ ] W0~W11이 의존성 순서로 완료되었거나 범위 밖 사유가 기록됐다.
- [ ] 각 묶음에 독립 커밋과 Preview·Production 배포 증거가 있다.
- [ ] 각 묶음의 모바일·데스크톱 육안검증 체크가 완료됐다.
- [ ] 발견 큐와 탭별 선 설계 문서의 상태가 일치한다.
- [ ] 수정 파일은 모두 500라인 이하이다.
- [ ] `docs/memory.md`가 200라인 이하이며 최신 핸드오프를 가리킨다.
- [ ] 각 묶음은 Preview 검증 뒤 동일 artifact를 Production으로 승격하고 운영 도메인을 확인했다.
