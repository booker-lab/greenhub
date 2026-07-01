# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `archive/memory_archive_20260425.md` · `archive/memory_archive_20260517.md` (세션22~34 상세)

최종 수정: 2026-07-01 (카카오 Preview auth URL 정책 분리 #CL-56)

---

## 진행 현황

**2026-07-01 후속 작업 (카카오 Preview auth URL 정책 분리 #CL-56)**:
- PR #7 Draft 범위와 섞지 않기 위해 `origin/main`에서 `codex/preview-auth-url-policy` 브랜치를 별도로 생성했다. consumer/driver는 Preview에도 `NEXTAUTH_URL`이 있어 production callback으로, seller는 Preview `NEXTAUTH_URL` 부재로 커밋별 Preview callback으로 잡히는 차이를 확인했다. 정책은 커밋별 Preview URL의 카카오 Redirect URI 등록 금지, Preview 완료 smoke는 stable branch Preview alias 또는 Auth.js redirect proxy 승인 후 진행으로 정리했다. 문서: `docs/specs/ops/preview-auth-url-policy.md`, 결정 로그 #CL-56, `docs/URLS.md` Preview Auth URL 정책.

**2026-05-28 후속 작업 (어드민 stores PR #3 병합 후 고정 preview CI 교정 #CL-55)**:
- PR #3은 `main`에 merge commit `c982ad5`로 반영됐고, 고정 preview CI에서 드러난 기존 정산 날짜 UTC/KST 결함은 PR #4(`1a924a7`, merge `8827b87`)로 교정했다. 변경 스펙 biome 및 인증 프리뷰 대상 정산+stores `chromium` **16/16 통과**, `Sync preview branch` `26527167757`과 후속 `E2E Tests` `26527463226`도 **성공**했다. Actions에 admin 인증 시크릿은 없어 CI admin 사례는 기존대로 skip되며, PR-E 인증 프리뷰 실행 근거와 육안 잔여 위임은 유지한다.

**2026-05-28 후속 작업 (어드민 stores 탭 PR-E E1 프리뷰 실행 검증 종결 #CL-55)**:
- PR-D 육안 위임 상태에서 진행한 `admin-stores-filter-sort.spec.ts`는 인증 컨텍스트를 재사용하되 `GET /admin/stores` fixture와 `PATCH /commission` 가로채기로 운영 쓰기를 차단한다. 작업 트리를 seller 임시 프리뷰 `greenhub-seller-blkcqzhnf-jos-projects-d1cecc0c.vercel.app`에 배포해 `READY`를 확인하고 실행했으며, 실행 중 Mantine `Select`에 대한 모호한 label 선택자와 내부 키 단언 결함을 `combobox` 정확 역할·표시값 단언으로 교정했다. **정합성**: 관련 biome 통과, seller vitest 9/9, 4앱 tsc 0, seller build 통과, Playwright 수집 16건, 프리뷰 런타임 **16/16 통과**(27.3초). **잔여**: `pending-visual-verify.md`의 운영 상태변경·NumberInput 시각/실저장 육안 항목만 유지.
- 사용자 확정 후속 구현: 본 범위에서 제외됐던 **T7 판매자 상세 드릴다운**과 **T8 플랫폼 기본 수수료율 설정**을 `BACKLOG.md` §1-8·§12-1 미완료 작업으로 등록했다. PR-A~E 종결은 유지하며, 두 작업 모두 새 API/데이터 정책을 포함하므로 착수 전 별도 SDD가 필수다.

**2026-05-28 후속 작업 (어드민 stores 탭 PR-D C5 구현 종결·육안 위임 #CL-55)**:
- 지정 SDD의 T4에 따라 `StoresTable.tsx` 공용 편집 입력을 native input에서 Mantine `NumberInput`으로 교체했다. `clampBehavior="strict"`로 0~1 범위 밖 직접 입력을 차단하고 `inputMode="decimal"`을 명시했으며, 값은 `String(value)`로 PR-C `parseRate` 경로에 전달한다. **정합성**: vitest 9/9, 4앱 tsc 0, seller biome 신규 0(기존 `<img>` warning 2건만), seller build 통과, 변경 코드 최대 `StoresTable.tsx` 294라인(300행 선택 분할 기준 미만). **육안 위임**: 로컬은 `AUTH_SECRET` 부재와 `proxy.ts:14`의 빈 `session.user.role` 접근 오류로 `/admin/stores` 렌더 전 차단되어 `pending-visual-verify.md` #61~#66에 남겼다. **다음 구현 진입 = PR-E(e2e), 단 PR-D 육안 통과 후.**

**2026-05-28 후속 작업 (어드민 stores 탭 PR-C C4 구현 세션 종결 #CL-55)**:
- 지정 SDD `admin-tab-stores-plan.md`에 따라 **T3 `parseRate(input): ParseRateResult` 순수함수 추출을 종결**했다. `_lib.ts`가 `EMPTY | NOT_NUMBER | OUT_OF_RANGE` 결과를 반환하고 `_client.tsx`는 이를 사용하되 기존 오류 알림 문자열을 유지해 시각·사용자 행동을 바꾸지 않았다. 테스트 소유 경로에 맞춰 seller 작업공간에 `vitest` 실행 기반을 연결하고 `_lib.test.ts` 9케이스를 신설했다. **정합성**: vitest 9/9, 4앱 tsc 0, seller biome 신규 0(기존 `<img>` warning 2건만), seller build 통과, 변경 코드 최대 `_client.tsx` 177라인·활성 SDD 447라인. **다음 구현 진입 = PR-D(C5) `NumberInput` 시각 회귀 격리.** PR-B 배포 후 육안 위임(#55·#60)은 유지.

**2026-05-28 후속 작업 (어드민 stores 탭 PR-B C3 구현 세션 종결·육안 위임 #CL-55, `76f8f17`)**:
- 지정 SDD `admin-tab-stores-plan.md`에 따라 **T6+T9 구현 종결**. 기존 "정리된 판매자 보기" Switch를 상태 Select(전체·활성·초대됨·운영중·정리됨, 기본 활성)로 흡수하고, 상호명 검색·새로고침·데스크톱 헤더 정렬·모바일 정렬 Select·조건 불일치 초기화·URL 쿼리 동기(`keyword/status/sort/dir`, 기본값 생략)를 추가. `_lib.ts`가 필터/정렬/빈결과/options SSOT를 담당하고 API·도메인 규칙은 불변. 기존 읽기전용 `admin-store-archive.spec.ts`는 삭제된 토글 대신 상태 필터 기본값을 확인하도록 갱신, `pending-visual-verify.md` #55·#60 현행화. **정합성**: 4앱 tsc 0, seller biome 신규 0(기존 `<img>` warning 2건만), seller build 23라우트 통과, 변경 코드 최대 `StoresTable.tsx` 274라인(T5 300행 트리거 미발동), e2e 8사례 수집 정상. **배포 후 육안 위임**: 로컬 런타임 `AUTH_SECRET` 부재(`Auth.js MissingSecret`, `/api/auth/csrf` 500)로 인증 스모크는 실행 전 차단. **다음 구현 진입 = PR-C(C4) `parseRate` 순수함수 + vitest 9케이스.**

**세션82~85 요약 (상세는 MEMORY.md 헤더·project 메모리·CRITICAL_LOGIC 참조)**:
- **세션82**: SETTLE-REFACTOR S6 e2e 측면 통과(육안만 사용자 위임).
- **세션83**: 셀러앱 M-PATH 육안 검증 완주·종결(시각 회귀 0). 운영 결함 4건 발견 — #CL-46 정산 desc 인덱스 부재·#CL-47 정산일시 Invalid Date 수정·배포(`701717e`), 나머지 BACKLOG 등재. 멀티앱 리팩토링 로드맵 신설.
- **세션84**: 타임존 KST 보정 #CL-48 플랜·정합성 검토(구현 미착수).
- **세션85 (#CL-48 구현 종결)**: `new Date().toISOString()` UTC 기준 → KST 00:00~08:59 날짜 전날 밀림 해소. **공통 util `todayKST()`/`toDateStrKST()`를 `@greenhub/shared`에 신설**(shared 첫 런타임 함수·dual ESM/CJS 검증) → 미보정 3곳(daily-caps:134·useSettlements:36·useDashboardSummary:30) 치환 + `orders/_lib.ts` 인라인 흡수(신·구 수식 동등 노드실측으로 ISO불변 가드, daily-caps 라인53~55 `now`/`year`/`month`는 불변). **vitest 신설**(프로젝트 첫 유닛테스트, `date.test.ts` 5케이스 `vi.setSystemTime` KST경계 가드, tsconfig에 `*.test.ts` exclude). 정합성 C1~C7 전부 통과(셀러 tsc+next build exit0·biome신규0·미보정 grep0). **차기: BACKLOG 잔여(버튼크기·status필터UI·어드민반응형·⏰CI Node20 2026-06-02 시한) 또는 로드맵상 소비자앱 리팩토링.**

**세션86~88 요약 (상세는 MEMORY.md 헤더·project 메모리·CRITICAL_LOGIC #CL-49~51 참조)**:
- **세션86**: BACKLOG 잔여 4건 정합성 검토(#CL-49) — BUG-16 stale 종결 + 3건 아토믹 플랜 수립. CI Node20 기해소 확정. 정산 [주문별 상세] status 필터 UI 신설(#245, 커밋 `6921678`).
- **세션87**: 버튼 크기 단일화(#234, #CL-50) — footer `lg→md` 한 단계, 시각 회귀 정책. 커밋 `bee7eb0`.
- **세션88 (어드민 반응형 #CL-51 종결)**: 어드민 5개 테이블(settlements·orders·stores·invite·users) 모바일 카드형 전환. **C-full(전부 카드형)·breakpoint `sm`(768px) 사용자 확정**. Mantine `hiddenFrom`/`visibleFrom` 분기 도입(셀러 앱 최초 반응형 분기) — 데스크톱 `<table>`은 `visibleFrom` Paper로 감싸기만 해 DOM 불변(회귀 0), 모바일은 `<Stack hiddenFrom>` 카드. 모바일에서 잘려 접근 불가였던 지급처리/강제환불/정지·복구/수수료설정 버튼이 카드 내 노출로 해소. stores 수수료 편집은 `renderRate`/`renderSetButton` 헬퍼 추출(중복 제거). 로직·hook·API 불변. 정합성 C1~C6 통과(tsc·biome·`npm run build` exit0·500라인 한도·SSOT 토큰 0위반). **e2e=어드민 스펙 부재+순수 표현 레이어라 대상 없음.** 잔여=모바일 폭 카드 육안(통합 문서 `pending-visual-verify.md` §2, 사용자 위임). **차기: 어드민 반응형 잔여(헤더/필터 등) 또는 소비자앱 리팩토링(`design-system-refactor-plan.md`).**
- **세션93 (어드민 stores 탭 PR-A C1·C2 종결 #CL-55, push)**: 어드민 탭 개선(세션92 진단) **첫 PR 착수·종결**. store status SSOT 3중 불일치(shared 'suspended' 죽은 값 vs 실제 set='archived')를 한 PR(C1+C2)로 봉합. **C1 (`6c474ce`)**: shared `StoreStatus` `suspended→archived` 1줄 교정 + dist 재빌드 + SDD §A-0a grep 표 채움(store.status 0건·'suspended' 9건 전부 store 무관·StoreStatus 활성 3건만, 세션92 스냅샷 일치). **C2 (`1bd259a`)**: 어드민 `AdminStore.status: string → StoreStatus` union, `_lib.ts` `Record<StoreStatus,string>` 좁힘, 죽은 '정지' 라벨/색 삭제(세션90 grill-me "판매자 정지 기능 없음"과 일치). `StoresTable`의 `?? store.status`·`?? 'gray'` 폴백 유지(미래 union 확장 안전망). 정합성 C1~C5 통과(tsc 4앱 0·biome 변동 0·4앱 빌드·500라인 한도). **다음 세션 진입 = PR-B(C3) 또는 PR-D(C5)** 사용자 선택. 상세 #CL-55·project_admin_tabs_improve.
- **세션91 (어드민 6개 탭 SDD 분리 #CL-54 종결, push·배포)**: settlements만 `_lib`/`_components` 분리돼 있고 나머지 6개(stores·orders·invite·users·drivers·banner)는 모놀리식 `_client`(223~335행)였음. **사용자 확정 = SDD 전면 분리 + 한 탭씩 완결 후 커밋(stores부터).** 반응형(#CL-51 세션88)은 기완료, 이번은 표현 레이어만. **패턴 = `thBase` 스타일 상수 추출 + 테이블/카드 한 컴포넌트로(로딩·빈결과 가드 내장) + 라벨/색·필터·상태판정 중복 `_lib` SSOT화. 순수함수 없는 탭(users·banner)은 `_lib` 미생성(과분할 회피).** 탭별(라인·커밋): stores 335→118(`354475a`)·orders 309→63(`83998d0`)·invite 291→61[inviteStatus 중복제거](`44c311b`)·users 234→76[UsersTable만](`5bf29ff`)·drivers 228→92[ACTION_META·filterByTab](`124768a`)·banner 223→97[섹션3분할](`cb2d114`)·로드맵갱신(`e6a2e55`). 탭마다 tsc0·biome0·build0·500라인(최대212) 통과. **로직·hook·API 불변, DOM 동일(시각 회귀 0).** main push→sync-preview 자동 배포. **차기=상태변경 육안(`pending-visual-verify.md` §4)+드라이버 앱 리팩토링(로드맵 §4).** 상세 #CL-54.
- **세션90 (판매자 "치우기"(아카이브) #CL-53 + 어드민 e2e 인프라 종결)**: ① **기능** — 어드민 판매자 목록에서 **주문·정산 기록 없는 판매자만** "치우기"(`store.status='archived'`, 영구삭제 아님·기록 보존)→평소 숨김·"정리된 판매자 보기" 토글로 표시+복구. `/further`→`/grill-me` 확정. **grill-me 핵심: "판매자 정지" 기능 자체가 없고(`toggleSuspend`는 `users`만) [proxy.ts](../apps/seller/src/proxy.ts)는 `storeId`만 봄 → "빈 판매자만"으로 좁혀 정지 시스템 신설 회피.** T1~T5(service 기록가드+`restoreStore`/controller PATCH 2개/`useAdmin` apiJson 직접호출로 ApiError 전파/showArchived 토글+`renderArchiveButton`). C1~C6 통과·커밋 `d10c60f`. ② **어드민 e2e 인프라 신설(프로젝트 첫 어드민 e2e)** — 3중 차단(스펙0·계정 seller role·`@Roles('admin')`403) 해소. 전용 `e2e-admin@test.com`(순수 어드민)+읽기전용 스모크, **8/8 통과**(chromium·mobile×4). 커밋 `b72298b`+`20c8e7a`. **⚠️라이브 함정 3건**: ❶admin이 seller에 가려짐(같은 도메인·`authjs.session-token` 쿠키 1슬롯 충돌)→`.admin-state.json` 격리 ❷`networkidle` 무한대기(SSE 실시간 연결)→`domcontentloaded` ❸비번 `#`이 dotenv 주석처리(24→14자 잘림·로그인 거부)→특수문자 없는 비번. **차기=상태변경(치우기·복구·차단) 육안만**(`pending-visual-verify.md` §4 #53/54/56/57; 빈 판매자+난플렉스 둘다 필요).
- **세션89 (겸직 역할 분리 #CL-52 코드 종결)**: 셀러앱 설정→"사업자 프로필 수정"이 **겸직 계정(어드민+디어 오키드 판매자)에서 어드민 콘솔로 튕기던 결함** 해소. **근본 원인=커밋 `63e56c2`(2026-04-07)의 "어드민=store 없음" 전제**가 겸직 등장으로 무효화(데이터 모델은 role·storeId 독립이라 겸직 이미 지원). **방향 A(전제 보정+양방향 문) 채택·방향 B(모드 전환 상태) 기각** — `/admin/*`와 셀러 화면이 이미 URL 네임스페이스로 분리=URL이 곧 모드, 부족한 건 "문(링크)"뿐, 겸직 1명·저빈도(YAGNI). **겸직 판정 SSOT=`role==='admin' && !!storeId`**(로그인 수단 무관·계정 하드코딩 금지). 변경 3건: ① [proxy.ts:22](../apps/seller/src/proxy.ts#L22) 가드 `!storeId` 추가(겸직은 `/onboarding` 허용) ② 설정 탭 "관리자 콘솔로 이동" 행(겸직만) ③ 어드민 헤더 "셀러 화면으로" 링크(겸직만). 정합성 C1~C5 통과(tsc0·biome0[신규0]·`npm run build` exit0·500라인). **커밋 `2d30296` push·운영 배포·육안 1차 통과**(운영 설정탭에서 "관리자 콘솔로 이동" 노출=§3 #44). **데이터 진단**: 운영 admin 1명(정연), 연결 store는 "디어 오키드" 아닌 **난플렉스**(`80189070-`, placeholder 혼동). **보안 검증**: 링크 숨김=UX, 실차단은 백엔드 4겹(admin/layout redirect+`admin.controller` `@Roles('admin')` 403+JWT 서명) → 링크 추가 보안영향 0. 잔여 육안=#42 프로필 폼 진입·#46~47 어드민→셀러 링크. **차기: 잔여 육안, 또는 소비자앱 리팩토링.**

세션22까지 + 세션23~54 완료. 셀러 주문 탭 리팩토링(T1~T7) + 배송일 풀스택+셀러 IA(T1~T6) + P4 fontSize 토큰화 종결. 세션53부터 Railway Outage 지속으로 백엔드 무관 작업(UX 잔여 플랜)으로 전환.

**세션46~51 요약**: 배송일 풀스택+셀러 IA T1~T6. T1(`5281188`), T2(`35cf229`+`e4c376c`), T3(`4e1576a` #CL-34), T4(`2c6c89d`), T5(`bffce2a` #CL-35), T6(`ed2fc95` e2e 시드+신규 spec, 세션51).

**세션52 요약**: T7-A — Railway `api-production-13e7.up.railway.app` 전 엔드포인트 404. 원인은 GCP가 Railway 조직 계정 차단(Major Outage), 재배포 무효, 복구 ETA 없음. T7-B — P4 fontSize 토큰화 3곳(`var(--font-size-2xl)`).

**세션53~60 요약 (셀러 UX 잔여 T-UX1~5 시리즈 · #CL-36/37/38)**: Railway Outage 우회 백엔드 무관 작업으로 셀러 UX 5세션. T-UX1 `SegmentedTabs` 신설+3페이지(`#CL-36`), T-UX2 ProductCard Switch+Button 분리, T-UX3 `ConfirmModal` 신설+6건 교체(`#CL-37`), T-UX4a/b/c fontSize 토큰화(admin 17·본 화면 10·_components 7건, `--font-size-xs:12px` 신설 `#CL-38`), T-UX5 정합성 검토 0건 변경. 세션60 e2e 풀런 디스패치(누적 미검증 5세션 분량). `status.railway.com` 2026-05-21 Fully Operational 복구 확인. 상세는 `archive/memory_archive_*.md`와 `BACKLOG §12-1` 활동 로그 참조.

**세션61 (e2e 풀런 회귀 가드 fix, `f6c275b`)**:
- **세션60 dispatch 결과**: 자동 26203591175·수동 26203663981·로컬 시드 후 재dispatch 26204055994 — **3회 연속 동일 2건 실패** (`consumer-mypage.spec.ts:74` + `seller-orders.spec.ts:200`). 동일 실패 = stale 무관(`reference_e2e_preview_race` 유효) + 시드 누락도 아님(로컬 멱등 시드 재실행 후에도 동일).
- **스크린샷 아티팩트 직접 대조로 원인 확정 — 회귀가 아닌 누적 selector 불일치**:
  - consumer mypage: 주문 2건 정상 렌더링되었지만 OrderCard에 `data-testid="order-card"` 부재 → 테스트 `hasOrders=false`로 잘못 판정 → 실제 주문이 있어 빈 상태 텍스트도 미노출.
  - seller orders: 공구 토글 후 카드 렌더링됐지만 `주문 #RDER-001`(`id.slice(-8).toUpperCase()`)만 표시·productName 미노출 → `text=E2E 공구 상품` 매칭 실패.
- **누적 결함의 트리거**: `ed2fc95`(세션51) e2e 시드 추가 이후 노출 — 이전엔 Firestore에 시드 부재로 빈 상태 분기/카드 0개로 흘러 통과해온 운. UX4 fontSize 토큰화는 회귀 윈도우(2026-05-19 15:14~22:13) **이후** 머지로 무관 확정.
- **수정 적용 2건**:
  - `apps/consumer/src/app/mypage/_client.tsx:79` OrderCard `UnstyledButton`에 `data-testid="order-card"` 부여.
  - `apps/seller/src/app/orders/_components/OrderCard.tsx:42` 주문번호 라인 아래에 `{order.productName && <Text lineClamp={1}>}` 옵셔널 한 줄 추가(UX 개선 겸 e2e 가드). 사용자 결정 — UX 변경 옵션 채택.
- **검증**: consumer/seller 타입체크 exit 0·두 앱 빌드 통과. ① 자동 dispatch 26204659238(sync-preview success 7초 후) — `seller-orders.spec.ts:200 ✓` 통과로 seller fix 작동 확인, 하지만 `consumer-mypage:74`는 fail(Vercel 실배포 완료 전 stale). ② 수동 dispatch 26204985493(sync-preview 후 11분 차) — **success 전건 통과**.
- **`reference_e2e_preview_race` 메모리 보강 후보**: sync-preview workflow가 success로 떨어져도 Vercel 실배포 완료까진 시간이 더 필요 → **자동 dispatch는 stale 가능성 일관 재현**(세션60·세션61 양쪽 확인). 차기 dispatch는 sync-preview 종료 후 5분+ 대기 권장.
- **다음 세션 진입점**: BUG-16(택배 갭)·UX-11(주문번호 통합)·Driver Kakao Maps SDK·백엔드 단일 장애점 회고 중 선택. 진입 문서 미작성.

**세션61 후속 — 셀러앱 리팩토링 종합 점검 + 정리 플랜 수립 (코드 변경 없음)**:
- **점검**: 세션 28~60 셀러 프론트엔드 리팩토링 전수 검토 — 전반 양호(500라인 한도 0건 위반·#CL-27~38 9건 결정 일관·공통 컴포넌트 3종 깔끔·API 레이어 통일·디자인 토큰 100% 커버). 개선 필요 4건 도출 — P0 native `alert()` 3건(admin/orders·settlements·stores) / P1 biome 40 errors 16 warnings(organizeImports FIXABLE 약 25건·noNonNullAssertion 6·noArrayIndexKey 5 등) / P2 products ProductCard `apiFetch` 잔존(#CL-32 P2 미봉합) / P3 useGroupConfigs N회 fetch(스케일 시점 회고).
- **플랜 신설**: `docs/specs/frontend/seller-cleanup-plan.md` — T-CLEAN1(Lint 정리, 세션62) → T-CLEAN2(alert → Mantine notifications, 세션63, #CL-39 예정) → T-CLEAN3(products → apiJson, 세션64) 3 아토믹 세션. **각 세션 진입 시 사전 정합성 검토 후 진입**(이전 세션 머지/baseline/의존성/e2e/500라인 5항목).
- **사용자 결정 4건**: ① 진행 순서 = 회귀 표면 작은 것부터(Lint→alert→apiJson) ② Lint 범위 = FIXABLE 자동 + 명확한 수동 fix(목표 5건 이내·위험 케이스는 biome-ignore + 사유) ③ alert 대체 = `@mantine/notifications` 도입(신규 의존성·#CL-39 등재 예정) ④ 정합성 검토 시점 = 세션 진입 시 사전 검토.
- **BACKLOG §12-1**에 셀러앱 정리 작업 행 추가. **다음 세션 진입 = 세션62 T-CLEAN1**, 진입 문서 `docs/archive/sessions/session62-prep.md` 작성 완료 — 진입 시 사전 정합성 5항목 + 사용자 결정 2건(ImageUpload 키·auth.ts env 가드) 확인 후 Phase A/B/C 진행.

**세션62 (T-CLEAN1 완료, `2f100e1`+`09061df`)**: 셀러앱 lint 정리 — biome `--write` 자동 + 수동 fix(ImageUpload url 키·biome-ignore 8건 사유 동반). 40e/16w → **0e/2w** 달성(PERF-01 noImgElement 별건 BACKLOG 등재).

**세션68~69 (UX-11 orderNumber 통합 종결, `cf79560`+`a3ea5ba`, #CL-41)**:
- **세션68(T7~T11, `cf79560`)**: shared `Order.orderNumber?:string`(T7)·`orders-create.service` 트랜잭션 내 `orderCounters/YYYYMMDD` 카운터로 `YYYYMMDD-NNNNNN` 발급(카운터 read를 첫 read로 배치=write 전 read 규칙)+응답 본문 포함(T8/T9)·프론트 표시 5곳 폴백 `orderNumber ?? <ID>`(셀러 OrderCard·OrderInfoSection·admin+AdminOrder타입, 소비자 mypage상세·결제성공)(T10)·드라이버 OrderCard는 buyerName 표시라 변경 불필요(T11). 빌드 부산물 동반 커밋(shared dist `.d.ts/.map` Railway 빌드용·seller sw.js) — 직전 BUG-16 커밋·`426e87e` 선례 따라 1커밋 포함.
- **세션69(T12~T14, `a3ea5ba`)**: T12 `seed-e2e-orders.mjs` 3주문에 `orderNumber` 주입(`20260101-00000{1,2,3}` 고정 과거일자 prefix로 실데이터 카운터 충돌 회피·멱등 set)+`seller-parcel-ship.spec.ts`에 `주문 20260101-000003` 노출 회귀 가드 1건. T13 #CL-41 등재(CRITICAL_LOGIC 557행).
- **검증**: 세션68 정적검증 전건 통과(shared 빌드 clean·API tsc/build exit 0·API테스트 2/2·셀러23·소비자13·드라이버7 라우트·셀러 biome 0e/2w). **e2e 풀런 — 자동 dispatch(26270139186) parcel spec 1건 실패 = stale preview**(sync-preview 완료 직후 시작, 세션60·61 패턴 재현), **수동 dispatch(26270156134) 30초 후 시작 → 176 passed/0 failed, parcel-ship:22 회귀가드 ✓**. 로컬 멱등 시드 재실행으로 Firestore에 orderNumber 주입 후 통과(e2e.yml seed 단계 부재 갭 여전).
- **T14 사용자 수동 잔여 2건(자동화 불가)**: ① 운영 기존 주문(orderNumber 없음) 셀러·소비자 ID 폴백 정상 표시 스크린샷 ② 신규 주문 1건 발생 시 `orderCounters/YYYYMMDD` seq 생성·증가 Console 확인(첫 쓰기 Firestore 권한 전제).
- **범위 외(#CL-41)**: 카운터 TTL/정리·백필 스크립트(결정③ ID폴백)·결제수단별 prefix·취소 시 번호 보존.

**세션70 (CI-SEED 진단·선설계만, 미커밋 → 본 세션 커밋 예정)**:
- **작업**: 후보 "e2e.yml seed step 추가"(세션61·67·69 **3회 재발**한 1차 자동 run 실패 갭) 진단 + 아토믹 플랜 수립. **코드 변경 0**(SDD 선설계, 사용자 결정).
- **핵심 발견**: [seed-e2e-orders.mjs:22](../../scripts/seed-e2e-orders.mjs#L22)가 로컬 `apps/api/firebase-adminsdk.json`을 **하드코딩 require** → gitignore 대상이라 CI 체크아웃에 부재 → step만 추가하면 `MODULE_NOT_FOUND` 즉시 크래시. 그냥 진행했으면 CI 깨질 함정.
- **해법 확정**: [cleanup-spec-residue.mjs:24](../../scripts/cleanup-spec-residue.mjs#L24) `resolveCredential()`(env-우선+로컬폴백+BOM방어, 검증됨)을 seed에 이식 + e2e.yml에 `FIREBASE_SERVICE_ACCOUNT_JSON`(이미 44행 등록 시크릿) env로 seed step 신설. **신규 시크릿 0건**(사용자 결정).
- **사전 정합성 8항목 전부 실측 통과**: firebase-admin 루트 의존(C2)·gitignore 키 제외 확정(C3)·resolveCredential 순수함수(C4)·seed import 표면 firebase-admin+빌트인만(C5)·cleanup은 spec afterAll 호출이라 yml step 충돌 0(C6)·4개 spec이 seed 선행 주석화(C7)·seed exit(1) silent pass 불가(C8).
- **플랜**: `docs/specs/api/e2e-ci-seed-plan.md` — §2 정합성·§3 아토믹 T0~T5(T0 진입게이트 Firestore 프로젝트 동일성→T1 seed env화 로컬단독검증→T2 yml step→T3 실패가드→T4 자동dispatch 1차통과=성공지표→T5 #CL-42). B(stale preview race)는 별건 분리(§5).
- **다음 세션 진입 = 구현(플랜 §3 T0~T5)**. 진입 시 T0 게이트(Firestore 프로젝트 동일성) 먼저 확인. #CL-42 후보(CI seed 인증 규약 단일화). 잔여 후보: Driver Kakao Maps·백엔드 단일장애점 회고·B(stale race).

**세션71 (CI-SEED 구현 종결, 커밋 `2e53fa1` push, #CL-42)**:
- **T1 — seed 인증 env-우선화**: [seed-e2e-orders.mjs](../../scripts/seed-e2e-orders.mjs) 22행 하드코딩 require 제거 → `cleanup-spec-residue.mjs:24-46` `resolveCredential()`(env-우선+로컬폴백+BOM방어) 이식. **로컬 폴백 회귀 검증 통과**(env 미설정 `node scripts/seed-e2e-orders.mjs` → "🎉 E2E 시드 완료", 멱등 set이라 안전). 중복 허용(2회 시점 YAGNI).
- **T2/T3 — e2e.yml seed step 신설**: `Install Playwright` 직후·`Run E2E` 직전에 `Seed E2E fixtures (Firestore)` step 추가. env `FIREBASE_SERVICE_ACCOUNT_JSON`(이미 등록된 cleanup용 시크릿 **재사용, 신규 0건**). 실패 가드 주석 2줄(seed exit(1)→step fail→silent pass 방지). yml 들여쓰기·step 순서 육안 검증 통과(YAML 파서 부재로 Read 확인).
- **T5 — 결정 로그·메모리**: #CL-42 등재(CRITICAL_LOGIC, CI seed 인증 규약 단일화)·BACKLOG CI-SEED 행 ✅·본 기록.
- **T0/T4 종결 (run `26271119584` success)**: push → sync-preview success → **자동 e2e run 1차에 step7 seed success + step8 `176 passed (4.7m)` 0 failed**. seed 로그 "🎉 E2E 시드 완료"(dailyCaps 14건·normal/group/parcel 3주문 CI write 성공). **GAP-1 봉합 입증**(로컬 키 없는 CI에서 resolveCredential env-우선 인증 성공). **T0도 사실상 입증**(틀린 프로젝트면 seed write 실패했을 것 → 동일 `green-e4fe3` 확정). 로컬 단서 전부 `green-e4fe3` 단일 일치(admin키·API .env·3앱 NEXT_PUBLIC·seller .env.vercel.local). **세션61·67·69 3회 재발 "자동 1차 실패→로컬 수동 재주입" 루프 근본 종결**. B(stale preview race)는 이번 미발현, §범위 외 별건 유지.
- **다음 세션 진입점**: **B(PREVIEW-GATE) 구현** — 선설계 완료(`docs/specs/api/preview-deploy-gate-plan.md`). 그 외 Driver Kakao Maps·백엔드 단일장애점 회고.

**세션71 후속 — B(PREVIEW-GATE) 선설계 (코드 변경 0, 미커밋→본 세션 커밋 예정)**:
- **목표**: CI-SEED §범위 외로 분리됐던 B(stale preview race) 해소 플랜. sync-preview가 e2e dispatch 전 Vercel 재배포 완료를 기다리게 게이트.
- **사용자 결정 2건**: ① 대기 = **deployments API 폴링**(고정sleep·헬스체크 대비 정밀) ② timeout 시 = **fail-fast**(stale e2e 헛수고 대신 배포 지연 노출).
- **핵심 실측 발견**: ① deployment `sha` 필드 = preview HEAD SHA 정확 일치(`821c845`↔`821c845`) → **시각 비교 아닌 SHA-매칭**으로 폴링 종료(GAP-1). ② sync-preview `permissions:`에 deployments 부재 → `deployments:read` 추가 필요(GAP-2). ③ environment 이름 en-dash(U+2013)+consumer 표기 불일치(`Preview – greenhubconsumer` 하이픈 없음, GAP-3). ④ e2e BASE는 고정 별칭 `-git-preview-`인데 deployment target_url은 커밋 URL `-1e8vowfys-` → 별칭 재포인팅 전제 T0 실측 검증(GAP-4). **CI-SEED push 자연실험으로 race 정량 입증**: 자동 e2e 05:56:31 시작 vs preview 재배포 05:59~06:01 완료(stale 확정, 단 워크플로 변경뿐이라 176 passed).
- **플랜**: §3 아토믹 T0(별칭 재포인팅 실측)→T1(권한)→T2(폴링 step)→T3(관측성)→T4(push 검증)→T5(#CL-43). 정합성 8항목 실측(C6 권한·C8 별칭만 조치/T0 잔여).

**세션71 후속 — B(PREVIEW-GATE) 구현 종결 (커밋 `1c421ca` push, #CL-43)**:
- **T0 게이트 실측 통과**: docs-only 커밋도 Vercel 3앱 재배포함(skip 안 함 — 트리거 걱정 해소). deployment `sha`=preview HEAD(`70816ec`) 일치. **GAP-4 확정** — bypass 쿠키로 별칭 URL(`-git-preview-`)과 커밋 URL이 **동일 `/_next/static/chunks` 해시** 서빙 대조 → success 시 Vercel이 별칭을 그 커밋으로 재포인팅 입증(별칭 헬스체크 폴링 불요·에스컬레이션 불요).
- **T1**: [sync-preview.yml](../.github/workflows/sync-preview.yml) `permissions:`에 `deployments:read` 추가(GAP-2).
- **T2/T3**: [scripts/wait-preview-deploy.mjs](../scripts/wait-preview-deploy.mjs) 신설 — SHA-매칭(시각비교 폐기 GAP-1)+최신 status success 판정, en-dash·consumer 표기 인코딩(GAP-3), timeout 10분 fail-fast, 앱별 success/미완 로그(T3). `execSync('gh api')` 방식. `PREVIEW_HEAD_SHA`·`WAIT_TIMEOUT_MS` env 오버라이드(검증용). Trigger E2E step 직전 폴링 step 삽입. **로컬 단독 검증**: success(배포완료 커밋→즉시 exit0)·fail-fast(미배포 SHA+짧은 timeout→미완 앱 노출 exit1) 양쪽 실측.
- **T4 검증 (run `26279110149` success 5m38s)**: 폴링 step **403 안 남**(GAP-2 권한 실증) + ~5m30s 3앱 배포 대기(driver 09:16:01·consumer 09:16:48·seller 09:17:49) → **e2e dispatch 09:17:51(마지막 배포 후)** = race 차단 정량 입증 → 자동 e2e run `26279363879` **1차 success**(6m13s). CI-SEED(시드)+PREVIEW-GATE(fresh) 결합으로 **자동 dispatch 1차 통과** — 세션39·60·61·67·69 "자동 1차 실패→수동 재dispatch" 루프 **근본 종결**.
- **T5**: #CL-43 등재(CRITICAL_LOGIC) · `reference_e2e_preview_race` 메모리 "게이트 자동 해소" 갱신(수동 5분 대기 권장 폐지) · 본 기록.
- **다음 세션 진입점**: Driver Kakao Maps SDK(세션53 Outage 이후 미진행) · 백엔드 단일장애점 회고(Railway Outage 교훈) · UX-11 T14 수동 검증 2건(운영 폴백 스크린샷·orderCounters Console — 사용자 몫).

**세션72~81 (SETTLE-REFACTOR 정산 탭 리팩토링, #CL-44·#CL-45)**:
- **핵심 발견(세션72~74)**: 정산 `pending→confirmed` 전이 코드가 **코드베이스 전체 부재** → 전 정산 pending 고착·어드민 "지급처리" 버튼(confirmed에서만 노출) 영구 미표시(A-1 단절). 16파일 전수검사로 정합 갭 N1~N11 도출. #CL-44(confirm 배치)·#CL-45(정합 갭 묶음) 등재. 로드맵 S1~S6(각 DoD=빌드+타입체크, 검증은 S6 일괄).
- **구현(세션75~79, 6태스크 종결)**: S1=B-1 confirm 배치(`@Cron 04:00 KST`)+B-2 인덱스+N9 / S2=B-5·B-6 write 4종 전부 트랜잭션·paid/cancelled 미덮어씀 대칭 / S3=B-3 SDD `_lib/` 분리+B-4 status 필터+N2 hook / S4=F-1 타입·상수 SSOT **4중→1** `packages/shared/settlement.types.ts` / S5=F-2 어드민 화면 `_components`+`_lib` 분리(311→92행)+N10 정산일시 컬럼·정렬 desc 통일+N11 합계 confirmed+paid 한정. 커밋 main 푸시(최종 `f5c941e`).
- **세션80 (S6 진입·선결① 해소)**: `firebase deploy --only firestore:indexes --project green-e4fe3` 라이브 배포 — settlements `status+settledAt` 인덱스 등록 → confirm 배치 `FAILED_PRECONDITION` 리스크 제거. ⚙️ firebase-tools v15.12.0 손상(@google-cloud/pubsub 모듈 누락→deploy exit 2)을 v15.18.0 재설치로 복구. **CI 자동 인덱스 배포는 여전히 부재** — 향후 수동 반복 필요.
- **세션81 (격자 재검토 전수 실행·완료, 코드 변경 0)**: S1~S5 정합성을 **9체크포인트×14파일 교차 검증** — 상태머신 역전이 대칭·트랜잭션 4종·타입 SSOT 1곳·백프론트 연결·정렬 desc·SDD 분리·라인≤500·인덱스·빌드 **전부 통과**. shared+api build·셀러 `tsc --noEmit` 에러 0 재확인. #CL-45에 결과 append.
- **다음 세션 진입점 = S6 잔여 검증**: ① 선결②(셀러 정렬 desc 육안 — 목록 최신순 노출) ② 전 구간 e2e(마감 경과 pending 시드→배치→confirmed→지급처리→paid) ③ 셀러·어드민 라벨/색/정렬 육안 일치 ④ T-기록(#CL-44/45 적용결과·`settlements.md` 현행화). 상세: `docs/specs/api/settlement-refactor-plan.md` T-검증, BACKLOG §13 S6, memory `project_settle_s1_s5_review_plan.md`·`project_settle_s6_preconditions.md`.

**세션67 (BUG-16 택배 발송 완료 동선 구현, `2ad71e3`, #CL-40)**:
- **사전 정합성 5/5 통과**: 진입 문서 `parcel-and-order-number-plan.md`(세션66 작성) 라인 전부 코드와 일치(helpers 94·lifecycle 281·seller page 205·driver board 157)·`updateStatus(status,extra)` 코어 훅 재사용 가능·`deliveryMethod`는 shared `Order` 타입에 존재·500라인 한도 안전.
- **변경 7파일(+e2e spec 신설)**: ① `orders.helpers.ts` `SELLER_TRANSITIONS.PREPARING:['DELIVERED']` + `NOTIFICATION_MAP.PREPARING.DELIVERED:'ORDER_DELIVERED'` ② `orders-lifecycle.service.ts` `role==='seller' && PREPARING→DELIVERED && deliveryMethod!=='parcel'` ForbiddenException 가드(getAllowedTransitions 직후) ③ `useOrderDetailActions.ts` `handleShipParcel=()=>updateStatus('DELIVERED')` ④ `orders/[id]/page.tsx` `canShipParcel` 분기 + "택배 발송 완료" 버튼(무모달, #CL-37) ⑤ `driver board/_client.tsx` 수거 대기 쿼리에 `where('deliveryMethod','in',['direct','hub'])` ⑥ `seed-e2e-orders.mjs` parcel+PREPARING 주문 1건(`e2e-parcel-order-001`) ⑦ `seller-parcel-ship.spec.ts` 신규.
- **설계 판단(전부 플랜 권장안)**: PREPARING→DELIVERED 직행(중간 DELIVERING 무의미·driverId 오염 회피·정산 자동생성 재사용)·발송 버튼 무모달·드라이버 부재 검증은 카카오 OAuth storageState 부재로 정적 검증 갈음.
- **검증**: 셀러·드라이버·API 타입체크 exit 0·API 단위테스트 2/2·셀러 23라우트·드라이버 9라우트 빌드·셀러 biome **0e/2w**(baseline 동일, `--write` 자동 포맷 1건: page.tsx showFooter 한 줄). **e2e 풀런 176 passed/0 failed**(run 26269373487) — 1차 실패는 회귀 아닌 **CI 시드 미실행**(e2e.yml에 seed 단계 없음·로컬 멱등 시드 재실행으로 `e2e-parcel-order-001` Firestore 주입 후 통과, 세션61 패턴 재현). parcel spec 2건(:22 발송 전환·:45 direct 버튼 부재) 모두 ✓.
- **Firestore 인덱스 주의**: T4 `status+deliveryMethod+preparedAt` 복합 인덱스 첫 배포 시 Console 자동생성 링크 클릭 필요(드라이버 보드 진입 확인).
- **범위 외**: 운송장 번호·택배사 API(MVP 외)·드라이버 admin parcel 별도조회(별건).
- **다음 세션 진입점**: **UX-11(주문번호 통합, T7~T14 — 같은 플랜 문서 §2)**·Driver Kakao Maps SDK·백엔드 단일 장애점 회고 중 사용자 선택. UX-11은 #CL-41 예정(orderNumber 정책).

**세션65 (T-CLEAN3-B 완료, `5f3d75f`)**:
- **사전 정합성 5/5 통과**: 직전 머지 `2291fc9` OK·잔존 8파일 grep 일치·`apiJson<T>`/`ApiError(status,message)` 시그니처 무변경·T-CLEAN1 baseline 0e/2w 유지·500라인 신규 위반 없음.
- **사용자 결정 2건 (전부 권장안)**: ① 범위 = **8파일 전부**(온보딩 회귀 표면 큼에도 1세션 봉합) ② daily-caps PATCH 실패 = `notifications.show({color:'red'})` 추가(#CL-39 일관성).
- **변경 8파일**: settlements/useSettlements 2건(summary/list `apiJson<T>` + ApiError catch)·daily-caps GET silent + PATCH notifications.show·delivery GET silent + PATCH setError·hubs/pickup ApiError.message로 서버 본문 자연 흡수·hubs/[id] Promise.all 단순화·hubs/new POST + 폴백·hubs/page GET silent + toggle notifications + delete setError·onboarding store GET silent + POST/PATCH 분기에서 `session.update({storeId})` 보존(신규 가입 패스 무변경).
- **검증**: 셀러 타입체크 exit 0·`pnpm --filter seller build` 23라우트·biome **0e/2w**(T-CLEAN1 baseline 동일·회귀 0건, `--write` 자동 포맷 2건 동반: hubs/[id]·onboarding)·**Grep `apiFetch` apps/seller/src → `lib/api.ts` 인프라 1파일만** (#CL-32 P2 완전 종결).
- **범위 외**: consumer/driver·멀티파트(ImageUpload firebase storage 직접 호출)·세션 내 수동 e2e 검증(타입체크/빌드/biome 정적 검증으로 갈음).
- **다음 세션 진입점**: BUG-16(택배 갭)·UX-11(주문번호 통합)·Driver Kakao Maps SDK·백엔드 단일 장애점 회고 중 사용자 선택. 진입 문서 미작성.

**세션64 (T-CLEAN3 Phase A 완료)**:
- **사전 정합성 검토 5/5 통과 (1 drift)**: 직전 머지 OK·plan baseline "잔존 19파일" → 실측 **9파일**(api.ts 제외)로 정정·`apiJson<T>`/`ApiError(status,message)` 시그니처 변경 없음·e2e 170p/0f/11s 유지·500라인 한도 안전(products/page.tsx 272→유사).
- **사용자 결정 2건 (전부 권장안)**: ① 에러 메시지 톤 = **useAdmin 계열 통일**(`ApiError.message` 우선 + 사용자 친화 폴백) ② Phase B 잔존 8파일 = **본 세션 미진행, BACKLOG `T-CLEAN3-B` 별건 등재** (회귀 표면·세션 아토믹성 우선).
- **변경**: `apps/seller/src/app/products/page.tsx` ProductCard. ① import `apiFetch` → `ApiError, apiJson` ② `handleToggleActive` PATCH — `await apiJson(...)` + `catch (e) { setError(e instanceof ApiError ? e.message : '상품 상태 변경에 실패했습니다') }` ③ `handleDelete` DELETE — 동일 패턴 + 폴백 "상품 삭제에 실패했습니다"·성공 시 `setConfirmOpen(false)` 보존. 자체 state(`toggling`/`deleting`/`error`/`confirmOpen`)는 #CL-37 §3 카드 내부 state 예외 유지. biome `--write` 자동 포맷 1건 동반(DELETE 호출 한 줄로 정리).
- **검증**: 셀러 타입체크 exit 0·`pnpm --filter seller build` 23라우트·biome **0 errors / 2 warnings**(T-CLEAN1 baseline 동일·회귀 0건).
- **범위 외 명시**: 잔존 `apiFetch` 8파일(hubs 4·settlements 훅·settings 2·onboarding) → `T-CLEAN3-B` 별건. 멀티파트/스트리밍은 raw `apiFetch` 유지(인프라 함수).
- **다음 세션 진입점**: `T-CLEAN3-B` / BUG-16(택배 갭) / UX-11(주문번호 통합) / Driver Kakao Maps SDK / 백엔드 단일 장애점 회고 중 사용자 선택. 진입 문서 미작성.

**세션63 (T-CLEAN2 완료, `80a7e51`+`35f8410`, #CL-39)**:
- **사전 정합성 검토 5/5 통과**: alert 3건 일치(settlements:50·orders:44·stores:28)·`@mantine/notifications` 미설치·core/hooks 9.0.0 존재·T-CLEAN1 baseline 0e/2w 일치·pnpm-lock 정합.
- **사용자 결정 3건 (전부 권장안)**: Notifications 위치 = **top-right** · autoClose = **4000ms** default · 성공 케이스 도입 = **안 함**(플랜 원안, 실패/경고만).
- **Phase A 도입(`80a7e51`)**: `pnpm --filter seller add @mantine/notifications` → 9.0.1 설치(peer 9.0.0/9.0.1 mismatch는 minor patch, 빌드 무영향 확인). `providers.tsx`에 `<Notifications position="top-right" autoClose={4000} />` MantineProvider 내부 등록. `layout.tsx`에 `@mantine/notifications/styles.css` import.
- **Phase B 치환(`35f8410`)**: ① `admin/orders:44` 환불 실패 → `color:'red'`·title="환불 처리 실패" ② `admin/settlements:50` 지급 실패 → `color:'red'`·title="지급 처리 실패" ③ `admin/stores:28` 수수료율 검증 → `color:'orange'`·title="입력 값을 확인하세요". 톤 통일: 실패=red, 경고=orange.
- **Phase C 결정 기록**: **#CL-39 등재** — 셀러앱 native `alert/confirm/prompt` 금지·`@mantine/notifications` 단일화 정책 + 호출 패턴 + 색 규칙. BACKLOG §12-1 T-CLEAN2 ✅ 마킹. (#CL-37 ConfirmModal과 정책 일관성 회복.)
- **검증**: 셀러 타입체크 exit 0·`pnpm --filter seller build`(23라우트)·biome **0 errors / 2 warnings**(T-CLEAN1 baseline 동일·회귀 0건)·Grep `alert\(` apps/seller/src **0건** 달성.
- **범위 외 명시**: consumer/driver 앱·성공 알림(`color:'green'`) 선제 도입·admin/orders `prompt('환불 사유...')` — 모두 별건 평가.
- **다음 세션 진입 = 세션64 T-CLEAN3** — products ProductCard `apiFetch` → `apiJson` 마이그레이션(#CL-32 P2 잔여분 봉합). 진입 시 사전 정합성 5항목 + `apiFetch` 잔존 19파일 grep 재확인·Phase B 확장 범위 사용자 결정 필요.

---

## e2e 인증 패턴 (옵션 B / storageState · #CL-27)

- **헬퍼**: `apps/e2e/tests/_helpers/auth.ts` `loginViaCredentials(page, base, email, password)`.
- **호출**: globalSetup이 seller·consumer 1회 로그인 → `.auth-state.json` storageState 발급. 인증 spec은 describe 상단 `test.use({ storageState })`만 — 개별 호출 없음.
- **헤더 주입**: csrf GET + credentials POST 두 호출에만 `x-e2e-test-token` 명시. **전역 extraHTTPHeaders 금지** (Firebase 등 third-party API CORS preflight 차단).
- **BASE**: `SELLER_BASE/CONSUMER_BASE/DRIVER_BASE` (Preview branch URL) — `apps/e2e/.env`.
- **Preview SSO 우회**: `global-setup.ts`가 `_vercel_jwt` bypass 쿠키 발급 → `.bypass-state.json` 재사용. 시크릿 `*_BYPASS_SECRET`. bypass 헤더도 전역 주입 금지.
- **#CL-23 set-cookie race**: 로컬·CI 모두 간헐적으로 set-cookie 누락. globalSetup은 3회 재시도. 로컬 풀런 막힐 시 시드 + 수동 육안 검증으로 보조.

---

## 툴체인·배포

- Railway API `https://api-production-13e7.up.railway.app` · Consumer `greenlove.co.kr` · Seller `seller.greenlove.co.kr`.
- next-auth 5.0.0-beta.31 · Lighthouse Perf 99 · pnpm@10.32.1 · gh CLI `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록).
- e2e CI: `.github/workflows/e2e.yml` · 동기화 `sync-preview.yml` (main push → preview merge → workflow_dispatch).

---

## 핵심 기술 특이사항

- **login/page.tsx (seller·consumer)**: `export const dynamic = 'force-dynamic'` 유지 (런타임 env 평가 보장).
- **seller firebase.ts**: `getAuth`/`getStorage`는 지연 초기화 함수 `getFirebaseAuth()`/`getFirebaseStorage()`로만 노출 — 모듈 최상위 호출 금지 (apiKey 부재 시 동기 throw → 빌드 prerender 크래시 #CL-31). `db`는 즉시 초기화 유지.
- **E2E_TEST_SECRET**: Vercel seller·consumer는 Preview·Development만 (Production 제거 #CL-21). `apps/e2e/.env` 동일값 32자. MVP 출시 시 #CL-20 정리표대로 Preview도 삭제.
- **Railway CORS**: no-origin 허용 유지 필수 (`if(!origin) return callback(null,true)`). Vercel preview origin은 `main.ts` 팀 스코프 정규식 허용(#CL-28). `CORS_ORIGIN` env는 프로덕션 도메인만.
- **Railway throttler**: `app.module.ts`는 `default`(100/분) 단일 등록 — named throttler 추가 시 전 라우트 전역 적용되므로 금지. 인증 라우트만 `@Throttle({default:{limit:10}})` 오버라이드(#CL-30).
- **cleanup-spec-residue 인증**: `FIREBASE_SERVICE_ACCOUNT_JSON` env 우선·로컬 키 fallback. gh CLI Secret 업로드 시 BOM 혼입 위험 → no-BOM UTF-8로 업로드.
- **변경 금지**: `gemini-3-flash-preview`(유효 모델명) · `aggressiveFrontEndNavCaching:false`(RSC CORS 재발) · `useStoreProducts` firebaseReady 가드(이중 인스턴스 버그).
- **shared 타입 변경 시**: `pnpm --filter @greenhub/shared build` 후 dist 커밋 필수. DS 폰트 예외 — BottomNav/ProductTopBar(10px)·주문상태뱃지(12px)·카운트다운(13px).
- **도메인·기타**: 공동구매 CONFIRMED 시스템 자동(선착순+크론, 셀러 수동 확정 없음) · preparedAt 빠른 선택지 UI · seller register inviteToken 필수 · Portone V2 시크릿 `apps/api/.env` 반영 · orders `?tab=` 딥링크는 `window.location.search` · `proxy.ts` Next.js 16 미들웨어 컨벤션 · AUTH_SECRET 3앱 Vercel 완료.
- **Windows 인코딩**: 한글 파일 일괄 편집 시 PowerShell `Get-Content`/`Set-Content` 금지(UTF-8 손상) — Python(명시적 utf-8) 또는 Edit 도구 사용.
- **seller 프론트 구조(#CL-32)**: Railway API 호출은 `lib/api.ts`의 `apiJson<T>()`(에러 시 `ApiError` throw) 사용 — raw `fetch` 금지. 페이지 셸은 `components/`의 `PageShell`/`PageHeader`/`EmptyState`/`LoadingState` 재사용. 주문 상태 변경은 `useOrderStatusUpdate` 코어 경유. 관리자 목록 훅은 `useAdminList` 팩토리. ProductForm은 `useProductForm` 훅 + 스텝 컴포넌트로 분리.
- **e2e 시드 (T6)**: `scripts/seed-e2e-orders.mjs` — 활성 상품 store에 14일치 dailyCaps + 셀러 store에 `e2e-` prefix 일반/공구 주문 + groupProductConfig. 멱등 set. `cleanup-spec-residue.mjs` 보존 정책.
