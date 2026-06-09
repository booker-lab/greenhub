# Green Hub 메모리
> SSOT: 세션 종료 시 최신 요약만 유지한다. 200라인 초과 시 50라인 이내로 압축한다.
> 이전 이력은 `docs/archive/`, `docs/CRITICAL_LOGIC.md`, `docs/BACKLOG.md`를 참조한다.

최종 수정: 2026-06-09

## 현재 진행 요약

- 핸드오프 프롬프트 1번은 육안검증 종결 가지, 2번은 개발·릴리즈 트레인 가지로 분리했다. 다음 대화에서 번호를 순서로 해석하지 않는다.
- 프롬프트 1번 육안검증은 현재 실행 가능한 항목을 종결했다. `#43`, `#79`는 운영 쓰기 승인 또는 전용 테스트 계정·정지 refresh token 조건 부재로 `[-]` 처리했다.
- 프롬프트 2번 릴리즈 트레인은 `shared-contracts`, `api-backend`, `consumer-web`, `seller-admin`, `driver-web`, `e2e-ops`, 후속 consumer fixture 보정까지 커밋·푸시·Vercel Preview READY 확인이 끝났다.
- 남은 로컬 작업은 seller/admin 검증 보강과 문서 정리다. 핵심 seller-admin 변경은 일괄 택배 발송 부분 실패 처리, 초대 취소 배지·알림 위치 검증, 판매자 치우기·복구·archived 상세 검증, 온보딩 역할 분리 검증이다.
- 셀러 대검증 전 운영 Firestore 정리용 `scripts/cleanup-seller-validation-data.mjs`를 추가했다. 기본은 dry-run이고, 실제 삭제는 백업 후 `--apply`를 명시해야 한다.
- 2026-06-09 정리 대상 두 스토어는 백업 후 정리 완료했다. `난플렉스` 35건, `테스트 상점` 9건을 삭제했고 `dailyCaps`는 보존했다.

## 최신 검증

- `git diff --check` 통과.
- `pnpm exec biome check` 변경 핵심 파일 10개 통과.
- `node --check scripts/cleanup-seller-validation-data.mjs` 통과.
- `pnpm --filter seller build` 통과.
- `pnpm --filter e2e test -- admin-invite-revoke.spec.ts --project=chromium --project=mobile` 32/32 통과.
- `pnpm --filter e2e test -- seller-onboarding.spec.ts --project=chromium` 12/12 통과.
- `pnpm --filter e2e test -- admin-stores-filter-sort.spec.ts --project=chromium` 14/14 통과.
- `pnpm --filter e2e test -- admin-store-archive.spec.ts --project=chromium --grep "archived 판매자 상세"` 1/1 통과.
- `ENABLE_E2E_FIXTURES=true` seller dev 서버와 `SELLER_FIXTURE_BASE=http://127.0.0.1:3011` 기준 `seller-order-bulk-parcel-ship.spec.ts` 2/2 통과.

## 다음 진입 후보

- `docs-policy`와 `seller-admin` 변경을 분리 stage·커밋하고 Vercel Preview READY를 확인한다.
- `misc-review`에 남은 `AGENTS.md`, hub staff 문서, archive/plan 파일은 이번 seller 검증 묶음에 섞지 말고 별도 검토한다.
- 커밋 전 `pnpm release:plan`, staged diff, 파일 라인 수, `docs/memory.md` 라인 수를 다시 확인한다.
