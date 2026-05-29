# Green Hub 프로젝트 메모리
> **SSOT**: 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 최신 아카이브: `archive/memory_archive_20260530.md`

최종 수정: 2026-05-30 (어드민 배너 T5a)

## 최신 진행 현황

- 2026-05-29 어드민 드라이버 탭은 S1~S5까지 완료됐다. status 서버 필터, 타입 정규화, e2e 4탭 검증, 가입일 표시, 검색·새로고침이 반영됐고 seller 프리뷰는 READY까지 확인했다.
- `pending-visual-verify.md` §14 #211~#226에 드라이버 탭 육안검증 항목이 등록돼 있다. #211~#214·#219는 자동 검증 통과, #215~#218·#220~#226은 운영/인증 프리뷰 육안 확인으로 남아 있다.
- `admin-tab-drivers-plan.md` S6(R1)를 진행해 `ACTION_META`에 버튼 라벨·색·variant를 합치고, `getDriverActions(driver)`로 승인·정지·정지 해제 노출 조건을 순수 함수화했다.
- `DriverList.tsx`는 `getDriverActions()` 결과를 map으로 렌더한다. 기존 버튼 노출, 스타일, ConfirmModal 문구, 처리 중 라벨 동작은 유지한다.
- `pending-visual-verify.md` §14 #227~#230에 액션 버튼 노출·스타일·확인창·처리 중 라벨 회귀 육안검증 항목을 추가했다.
- 검증: 변경 파일 Biome 0, `pnpm --filter seller exec tsc --noEmit` 0, `pnpm --filter seller build` 0, `admin-drivers-status-filter.spec.ts` 10건 수집. 수정 코드 파일은 500라인 미만, `memory.md`는 50라인 미만이다.
- 커밋 `d85f2fc`를 push했고 seller 프리뷰 `https://greenhub-seller-g123e4tg0-jos-projects-d1cecc0c.vercel.app`가 READY가 됐다.
- 2026-05-30 `admin-tab-drivers-plan.md` S7(R2)을 진행했다. 드라이버 status 탭 인라인 JSX를 공통 `SegmentedTabs`로 교체하고 `STATUS_TABS`를 `key/label` 형식으로 맞췄다. `pending-visual-verify-20260529.md` §25 #231~#234에 육안검증 항목을 추가했다.
- 검증: 변경 파일 Biome 0, `pnpm --filter seller exec tsc --noEmit` 0, `pnpm --filter seller build` 0. 로컬 e2e는 `AUTH_SECRET` 누락으로 `/api/auth/csrf` 500에서 차단됐고, 기본 운영 URL 대상 실행은 이전 UI를 봐 2/10만 통과했다.
- 커밋 `7503d7a`를 push했고 seller 프리뷰 `https://greenhub-seller-e8kj81qno-jos-projects-d1cecc0c.vercel.app`가 READY가 됐다. 루트 Vercel 링크가 consumer라 consumer 프리뷰도 1회 생성됐지만 변경 대상 배포는 seller 프리뷰다.
- 2026-05-30 S8(F6)을 진행했다. 승인·정지·정지 해제 성공 시 초록 알림으로 확인 위치(`승인 완료 탭`/`정지됨 탭`)를 안내하고, 실패 시 빨간 알림을 띄우되 ConfirmModal은 닫지 않도록 했다.
- `admin-drivers-status-filter.spec.ts`에 승인 성공 알림 회귀를 추가했고, `pending-visual-verify-20260529.md` §26 #235~#239에 액션 결과 알림 육안검증 항목을 등록했다.
- S8 검증: 변경 파일 Biome 0, `pnpm --filter seller build` 0, 빌드 후 `pnpm --filter seller exec tsc --noEmit` 0. e2e는 기본 운영 URL이 이전 배포를 봐 실패했고, 로컬 새 코드 대상은 Firebase 공개 env 미주입(`auth/invalid-api-key`) 오버레이로 `/admin/drivers` 진입 전 차단됐다.
- 커밋 `605f143`을 push했고 seller 프리뷰 `https://greenhub-seller-kq2loonje-jos-projects-d1cecc0c.vercel.app`가 READY가 됐다. branch alias는 `https://greenhub-seller-git-codex-admin-st-4007d3-jos-projects-d1cecc0c.vercel.app`다.
- 향후 작업으로 `ADMIN-DRIVERS-F4`(드라이버 상세 정보), `ADMIN-DRIVERS-F5`(정렬·페이지네이션), `DRIVER-APP-REFACTOR`를 `BACKLOG.md`와 `admin-tab-drivers-plan.md`에 명시했다.
- 2026-05-30 어드민 배너 탭 T1·T2·T3를 완료했다. `useEffect` hydrate deps를 `[banner]`로 교정하고, CTA 문구·URL 비대칭 저장 차단, 저장·이미지 업로드 실패 알림, CTA 모바일 1열 배치(T6 일부)를 반영했다. 커밋 `1605023`을 push했고 seller 프리뷰 `https://greenhub-seller-f2k6j1erj-jos-projects-d1cecc0c.vercel.app`가 READY가 됐다. `pending-visual-verify.md` §15 #231~#236에 육안검증 항목을 등록했다.
- 2026-05-30 어드민 배너 T5a를 완료했다. 업로드 전 PNG/JPG/WebP와 2MB 이하를 검증하고 실패 사유를 알림·인라인 오류로 표시한다. `pending-visual-verify.md` §15 #237에 육안검증 항목을 추가했다. 검증: 변경 파일 Biome 0, seller tsc 0, seller·consumer·driver·api build 0. 루트 `npm run build`는 앱 필터가 매칭되지 않아 앱 빌드가 생략되는 현상을 확인했다. 커밋 `bba9c31`을 push했고 seller 프리뷰 `https://greenhub-seller-581ox0xl0-jos-projects-d1cecc0c.vercel.app`가 READY가 됐다.
- 미추적 파일 `.codex/`, `AGENTS.md`는 사용자/환경 산출물 가능성이 있어 건드리지 않는다.

## 검증 기준

- 수정 코드 파일은 500라인 미만이어야 한다.
- 신규 기능은 `docs/specs/` 선설계 후 구현한다.
- 결정 발생 시 `docs/CRITICAL_LOGIC.md`에 기록한다. 현재 `CRITICAL_LOGIC.md`는 1000라인 미만이라 아카이브 대상이 아니다.
- 작업 완료 전 최소 검증: 변경 파일 Biome, seller 타입체크, seller build. 가능하면 관련 e2e 수집 또는 실행.

## 다음 진입점

- 인증 가능한 프리뷰 또는 운영 미적용 환경에서 `pending-visual-verify.md` §15 #231~#237을 확인한 뒤, 다중 배너 SDD Phase 3로 진입한다.
- 2026-05-30 어드민 배너 다중 배너 SDD S4를 진행했다. `AdminBannersService`와 `BannerQueryService`를 분리해 `/admin/banners` CRUD, 기존 `/admin/banner` 호환, 공개 `/banners/active` 조회, `kind:'default'` 삭제 차단, scheduled 기간 검증, CTA 비대칭 검증, Storage orphan cleanup을 추가했다.
- 공유 패키지에 `BannerKind`, `AdminBanner`, `ActiveBannersResponse`를 추가하고 dist 산출물을 갱신했다. `migrate-banners-kind.ts` 일회성 스크립트로 기존 `banners/main_hero`에 `kind:'default'`와 `id:'main_hero'`를 병합할 수 있게 했다.
- 검증: Biome 0, `pnpm --filter api test -- admin-banners.service.spec.ts banner-query.service.spec.ts --runInBand` 6/6, `pnpm --filter api exec tsc --noEmit` 0, shared/api/seller/consumer/driver build 0. 루트 `npm run build`는 기존 필터 문제로 shared만 빌드하고 앱은 매칭하지 못했다.
- 육안검증 항목은 `pending-visual-verify-20260529.md` §27 #240~#245에 추가했다. `pending-visual-verify.md` 본문은 500라인에 가까워 분리 문서를 사용했다.
- 2026-05-30 어드민 배너 다중 배너 SDD S5를 진행했다. `/admin/banner`를 목록형 UI로 바꾸고 `useAdminBanners` 훅, 기본/기간 배너 목록, 추가·수정 Drawer, 기간 입력, 저장 전 검증, 라이브 미리보기를 추가했다. `useAdmin.ts`는 397라인으로 줄여 500라인 한도를 지켰다.
- S5 육안검증 항목은 `pending-visual-verify-20260529.md` §28 #246~#254에 추가했다. 검증: `pnpm --filter seller lint`는 기존 `noImgElement` 경고 2건만 출력, `pnpm --filter seller build` 0.
