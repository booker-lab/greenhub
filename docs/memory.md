# Green Hub 메모리
> SSOT: 세션 종료 시 최신 요약만 유지한다. 200라인 초과 시 50라인 이내로 압축한다.
> 이전 이력은 `docs/archive/`, `docs/CRITICAL_LOGIC.md`, `docs/BACKLOG.md`를 참조한다.

최종 수정: 2026-06-05

## 현재 진행 요약

- 2026-06-05 `hub_staff` 초대·온보딩·다중 거점 배정·초대 취소 관리까지 완료했다.
- 2026-06-05 운영 mojibake 데이터 3건은 사용자 확인 후 allowlist 방식으로 보정했고, 백업은 `docs/archive/ops/mojibake-repair-2026-06-05T05-08-29-077Z.json`에 남겼다.
- 2026-06-05 `HUB-STAFF-PICKUP-CONFIRM` 완료. `#CL-123`에서 `hub_staff`는 JWT `storeId`/`hubId`/`hubIds`와 `hubs.staffIds` 배정이 모두 일치하는 거점의 `HUB_ARRIVED` 주문만 `hub-confirm`으로 `PICKED_UP` 전환할 수 있게 확정했다. 판매자 기존 소유권 경로는 유지했다.
- 2026-06-05 `HUB-STAFF-PICKUP-CTA` 완료. `/hubs/[id]` 픽업 대기 주문 카드에 주문 식별 정보·픽업 코드·명시적 `픽업 확인` 버튼을 노출했다. API 권한 경계는 `#CL-123` 그대로 유지했다.
- 2026-06-05 `/admin` 권한 설계 연계 완료. `#CL-125`에서 `hub_staff` 도입 후에도 `/admin/*` UI·API는 `role='admin'` 전용으로 유지하고, 거점 스태프 초대·배정·회수는 admin 승격 경로를 만들지 않기로 확정했다.
- 2026-06-05 육안검증 축 복귀. `/admin/drivers` 상세 정보 `#269~#271`을 최신 seller 프리뷰 admin state와 375px Playwright fixture로 확인해 종결했다.
- 2026-06-05 단건 택배 발송 육안검증 재개. seller 상세 송장 표시 `#146`과 모바일 모달 배치 `#148`은 최신 프리뷰 fixture로 종결했다. consumer 상세 `#147`은 API 응답에 송장 필드가 있으나 consumer 프리뷰 화면에 송장 행이 없어 보류했다.
- 2026-06-05 `docs/CRITICAL_LOGIC.md`와 `docs/memory.md`의 mojibake 손상을 정상 한국어 요약 로그로 복구했다.

- 2026-06-05 consumer 상세 `#147` 보강. 주문 상세 UI가 송장 필드(`courierCompany`/`trackingNumber`) 존재 시 `deliveryMethod` 불일치와 무관하게 택배사·운송장번호를 표시하도록 수정하고 fixture 회귀 케이스를 추가했다. 로컬 `consumer build`는 통과했지만 dev 서버가 `/e2e/order-cancel-status` 컴파일에서 멈춰 Playwright 육안검증은 보류했다.
- 2026-06-05 Preview 육안검증 우선 정책 확정. 이후 육안검증은 로컬 dev 서버가 아니라 GitHub push 후 Vercel Preview URL을 기본 축으로 사용한다. 세부 정책은 `docs/specs/frontend/preview-visual-verify-policy.md`, 결정 로그는 `#CL-126`에 기록했다.
- 2026-06-05 단계별 Preview 릴리즈 트레인 확정. 누적 미푸시 작업은 `docs-policy -> shared-contracts -> api-backend -> consumer-web -> seller-admin -> driver-web -> e2e-ops` 순서로 커밋·푸시·Preview 확인을 반복한다. 실행 보조 명령은 `pnpm release:plan`, `pnpm release:stage -- <wave>`이다.
## 최신 검증

- `pnpm --filter api test -- orders-lifecycle.service.spec.ts --runInBand` 3/3 통과.
- `pnpm --filter api exec tsc --noEmit` 통과.
- `pnpm --filter api exec biome check src/orders/orders.controller.ts src/orders/orders.service.ts src/orders/orders-lifecycle.service.ts src/orders/orders-lifecycle.service.spec.ts` 통과. DI 메타데이터 보존용 `useImportType` 경고 9건은 기존 정책대로 유지했다.
- `pnpm --filter seller exec biome check src/app/hubs/[id]/page.tsx` 통과.
- `pnpm --filter seller exec tsc --noEmit` 통과.
- `pnpm --filter api test -- roles.guard.spec.ts --runInBand` 통과.
- `pnpm --filter api exec biome check src/common/guards/roles.guard.spec.ts src/common/guards/roles.guard.ts src/admin/admin.controller.ts` 통과.
- `pnpm --filter api exec tsc --noEmit` 재통과.
- `pnpm --filter api test -- hub-staff-invites.service.spec.ts hubs.service.spec.ts roles.guard.spec.ts orders-lifecycle.service.spec.ts --runInBand` 24/24 통과.
- `pnpm --filter api test -- admin-invites.service.spec.ts admin-drivers.service.spec.ts admin-orders.service.spec.ts admin.service.spec.ts --runInBand` 70/70 통과.
- `pnpm --filter consumer exec tsc --noEmit`, `pnpm --filter driver exec tsc --noEmit` 통과.
- `pnpm --filter seller exec biome check src/app/hubs/[id]/page.tsx src/app/staff-invite/page.tsx src/hooks/useAdminInvite.ts src/hooks/useAdmin.ts src/proxy.ts src/auth.ts` 통과.
- `node test-results/manual-admin-drivers-visual-check.mjs` 수동 fixture 검증 통과 후 임시 스크립트 삭제. 결과: API `status=pending/approved&sort=createdAt_desc&limit=100`, 연락처·차량·가입일·전화번호 검색 true, 가로 넘침 false.
- `SKIP_CONSUMER_AUTH_SETUP=true pnpm --filter e2e test -- seller-parcel-ship.spec.ts --grep "배송 완료 택배|모바일 택배"` 4/4 통과.
- `pnpm --filter e2e test -- consumer-mypage.spec.ts --grep "택배 주문 상세"` 실패. API 응답에는 `courierCompany`, `trackingNumber`가 있으나 consumer 프리뷰 DOM에 송장 행이 없다.
- 2026-06-05 현재 개발 가지 재개 검증 재실행. `git diff --check`, 수정·신규 파일 500라인 가드, shared build, shared test 14/14, API/seller/consumer/driver `tsc --noEmit`, API hub_staff·roles·orders lifecycle 24/24, API admin 초대·드라이버·주문·서비스 70/70 통과. 변경 범위 `biome check --write`는 종료 코드 0이며 남은 항목은 실패가 아닌 `auth.service.ts` `useLiteralKeys` 정보성 제안이다.

## 다음 진입 후보

- 조건 후보: 네이버페이 채널 키 승인 후 Vercel 환경변수 설정, 운영 인증 가능한 모바일 실기기 시각 검증 재개.
- 운영 데이터 후보: 오서비스 스토어 및 `샘플팜스(80189070)` 시각 검증용 시드 정리.
- 육안검증 후보: consumer 상세 `#147`을 최신 consumer 배포 또는 로컬 최신 빌드에서 재검증한다.
- 2026-06-05 핸드오프 프롬프트 1번 재개. 범위는 **운영 관리자 기능 마감과 검증 종결**로 고정했고 새 기능 추가 없이 재검증을 우선했다. 재확인 결과: `git diff --check`, 수정·신규 파일 500라인 가드, shared build/test 14/14, API/seller/consumer/driver 타입체크, API 핵심 테스트 24/24·70/70·21/21 통과. seller admin/hooks Biome 5건은 `--write`로 정리 후 재검증 통과. `pnpm release:plan` 기준 커밋 분리는 `docs-policy -> shared-contracts -> api-backend -> consumer-web -> seller-admin -> driver-web -> e2e-ops` 순서를 유지한다.
