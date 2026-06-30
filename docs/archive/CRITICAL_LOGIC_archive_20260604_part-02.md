# Critical Logic archive 20260604 part 02

> 원본: $Path에서 2026-06-29 문서 정리 시 분리.

---

## [#CL-53] 어드민 판매자 "치우기"(아카이브) + 어드민 e2e 인프라 신설 (2026-05-25~26, 세션90)

**기능 배경**: 어드민 판매자 목록([stores/_client.tsx](../apps/seller/src/app/admin/stores/_client.tsx))에 시드·온보딩 테스트로 들어온 빈 판매자가 운영 판매자(난플렉스)와 섞여 지저분. 목록에서 치울 길이 없었음.

**설계 결정 — `/further`→`/grill-me` 확정안**: 주문·정산 기록 **없는 판매자만** "치우기"(`store.status='archived'`, **영구삭제 아님 — 법적 책임 대비 기록 보존**) → 평소 숨김, "정리된 판매자 보기" 토글로 표시+복구.

**grill-me가 막아낸 핵심 (왜 이 범위인가)**:
- **원래 안전장치 "정지된 판매자만 치우기"는 성립 불가** — `toggleSuspend`는 `users`(소비자·드라이버)만 대상, **판매자 정지 기능 자체가 코드베이스에 없음**.
- **셀러앱 가드 [proxy.ts](../apps/seller/src/proxy.ts)는 `storeId`만 봄**(store.status 무시) → store를 archived로 바꿔도 영업이 안 막힘. 그래서 **"빈 판매자만 치운다"**로 범위를 좁혀 "판매자 정지 시스템 신설"(큰 작업)을 회피.
- **실수 방지 = 기록 있으면 서버 400 차단**(난플렉스 등 운영 판매자는 주문 있어 자동 보호) + `window.confirm`.

**구현(T1~T5)**: T1 [admin.service.ts](../apps/api/src/admin/admin.service.ts) `archiveStore`(orders·settlements `.where('storeId','==',id).limit(1)` 기록 가드→`BadRequestException` 또는 `status='archived'`)/`restoreStore`(`FieldValue.delete()`로 archivedAt 제거 — 래퍼는 [firestore.service.ts:24-26](../apps/api/src/firestore/firestore.service.ts#L24-L26)에 노출 확인) · T2 controller `PATCH stores/:id/archive`·`/restore`(클래스 `@Roles('admin')` 상속) · T3 [useAdmin.ts](../apps/seller/src/hooks/useAdmin.ts) — 차단 사유 UI 전달 위해 `runAction`(에러 삼킴) 대신 `apiJson` 직접 호출로 `ApiError` 전파 · T4 `showArchived` 토글+`visible` 필터 · T5 `renderArchiveButton`(치우기/복구+notification)+`STATUS archived='정리됨'`. **데스크톱 테이블+모바일 카드 양쪽.** 정합성 C1~C6 통과(tsc0·biome0·build0·500라인 최대388·archived 기록조회 회귀0·기록가드400). 커밋 `d10c60f` push·배포.

**어드민 e2e 인프라 신설 (프로젝트 첫 어드민 e2e)**: 어드민 e2e는 3중 차단(admin 전용 스펙 0개·테스트 계정 seller role·백엔드 `@Roles('admin')` 403)으로 불가였음. **사용자 확정 = 전용 e2e admin 계정 + 읽기 전용 스모크(운영 DB 쓰기 0)**. 전용 계정 `e2e-admin@test.com`(role=admin·storeId 없는 순수 어드민·특수문자 없는 28자 비번), [admin-store-archive.spec.ts](../apps/e2e/tests/admin-store-archive.spec.ts) 8테스트(chromium·mobile×4) 통과. 커밋 `b72298b`+`20c8e7a`.

**⚠️ 라이브 실행에서 잡은 함정 3건 (다음 앱 e2e에도 재발 가능 — 규약화)**:
1. **admin 세션이 seller에 가려짐** — admin은 어드민 화면=셀러앱 `/admin/*` 경로라 `SELLER_BASE` 공유. NextAuth `authjs.session-token` 쿠키 슬롯이 **도메인당 1개**뿐 → 같은 BrowserContext에 seller·admin 누적 시 마지막 것만 남아 충돌(증상: admin인데 셀러 "주문 관리" 화면 노출). **해결 = admin 전용 컨텍스트에서 `.admin-state.json` 격리 발급**([auth.ts](../apps/e2e/tests/_helpers/auth.ts) `ADMIN_STATE_PATH`, [global-setup.ts](../apps/e2e/global-setup.ts) 별도 컨텍스트). `.gitignore` 추가(세션 토큰).
2. **`networkidle` 무한 대기** — 셀러/어드민 화면은 SSE "실시간 연결"이 상시 열려 networkidle에 도달 못 해 timeout. **해결 = `domcontentloaded` + 명시적 요소(`getByText`) 대기.**
3. **비번 `#` 문자가 dotenv에서 주석 처리** — `.env`의 `TEST_ADMIN_PASSWORD`에 `#` 포함 시 그 이후가 잘림(24→14자) → 로그인 거부(set-cookie 0, 인증 race 아님). **해결 = 특수문자 없는 비번**(또는 `.env`에서 따옴표). 진단 핵심 = bcrypt `compare=true`로 DB 데이터 무결을 먼저 확인해 원인을 인증경로로 격리.

**부수 발견**: `admin@test.com`이 이미 **카카오 consumer 계정**으로 운영 DB 실재(2026-04-06) → 로그인 `where('email').limit(1).docs[0]` 비결정성. 전용 계정을 `e2e-admin@test.com`으로 분리해 회피.

**연관**: 계획서=`docs/plans/admin-store-archive-plan.md`. 육안=`pending-visual-verify.md` §4(#53~59, 상태변경 클릭은 e2e 미수행→육안 전용). 커밋=`d10c60f`·`b72298b`·`20c8e7a`. 잔여=상태변경(치우기·복구·차단) 육안만.

## [#CL-54] 어드민 탭별 SDD 분리 — settlements 모범 패턴을 나머지 6개 탭에 적용 (2026-05-26, 세션91)

**배경**: 어드민 7개 탭 중 **settlements만 `_lib`(순수함수)/`_components`(테이블·필터·요약) 분리**(SETTLE-REFACTOR 선례, `_client.tsx` 92라인 조립만). 나머지 6개(stores·orders·invite·users·drivers·banner)는 모놀리식 `_client.tsx`(223~335라인)에 fetch·상태·테이블·카드·모달이 뭉쳐 있었음. 반응형(#CL-51, 세션88)은 이미 완료. 이번은 **표현 레이어 SDD 분리만**(로직·hook·API 불변).

**사용자 확정 2건(AskUserQuestion)**: ① 범위 = **SDD 전면 분리**(settlements 패턴) ② 단위 = **한 탭씩 완결 후 커밋**(stores부터).

**분리 패턴(6개 탭 공통)**: ① `thBase` 스타일 상수 추출(테이블 `<th>` 인라인 스타일 반복 제거) ② 테이블/카드를 한 컴포넌트로 묶고 **로딩·빈결과 가드를 컴포넌트 안으로** 이동 ③ 라벨/색·필터·상태판정 중복 로직을 `_lib.ts`로 SSOT화. **순수 변환 함수가 없는 탭(users·banner)은 `_lib` 미생성 — 과분할 회피.**

**탭별 결과(라인 변화·분리물·커밋)**:
- **stores** 335→118 — `_lib`(STATUS_LABEL/COLOR·filterVisible·formatRate)+`StoresTable`. 커밋 `354475a`.
- **orders** 309→63 — `_lib`(STATUS_LABEL·getStatusColor·REFUNDABLE·buildStatusOptions)+`OrdersFilters`·`OrdersTable`. 커밋 `83998d0`.
- **invite** 291→61 — `_lib`(inviteStatus 판정 **테이블·카드 중복 제거**·만료 포맷 2종)+`InviteGenerator`·`InviteHistoryTable`. 커밋 `44c311b`.
- **users** 234→76 — `UsersTable`만(`_lib` 미생성, 라벨 분기 단순). 커밋 `5bf29ff`.
- **drivers** 228→92 — `_lib`(ACTION_META·STATUS_TABS·filterByTab+DriverAction/PendingAction 타입)+`DriverBadge`·`DriverList`. 커밋 `124768a`.
- **banner** 223→97 — 섹션 3분할(`BannerImageSection`·`BannerTextSection`·`BannerCtaSection`, `_lib` 미생성). 커밋 `cb2d114`.

**정합성(탭마다 반복)**: tsc0 · biome0(자동 포맷만, 신규 경고 0) · `npm run build`0 · 500라인 한도(전 탭 최대 212라인). **DOM 동일 → 시각 회귀 0.** e2e는 순수 표현 레이어라 회귀 위험 낮음.

**연관**: 로드맵 `app-refactor-roadmap.md`(어드민 미착수🔴→완료✅, 커밋 `e6a2e55`). 잔여=상태변경(치우기·환불·승인 등) 육안 `pending-visual-verify.md` §4. 다음 리팩토링 차례=드라이버 앱(로드맵 §4). 커밋=`354475a`·`83998d0`·`44c311b`·`5bf29ff`·`124768a`·`cb2d114`·`e6a2e55`.

## [#CL-55] 어드민 stores 탭 — `StoreStatus` SSOT 3중 불일치 교정 (PR-A C1·C2) (2026-05-26, 세션93)

**배경**: 어드민 탭 개선(#CL-55, 세션92 진단) 첫 PR. store status가 3곳에서 어긋남 — `@greenhub/shared` `StoreStatus`=`invited|active|suspended`(**archived 없음**), 어드민 [_lib.ts](../apps/seller/src/app/admin/stores/_lib.ts) 로컬 맵=invited·active·suspended·**archived 추가**, 실제 `stores.service`가 set하는 값=invited→active→archived(**suspended는 어디서도 set 안 됨, 죽은 값**). 어드민 `_lib.ts:4` 주석이 자인.

**세션93 사전 grep 3종(§A-0a)**: ① `rg "store\.status"`=**0건** ② `rg "'suspended'"`=9건 **전부 store 무관**(DriverStatus·admin.dto/service·auth.service·drivers/_lib·store.types 본인) ③ `rg "StoreStatus"`=활성 3건(`store.types.ts:1, 12`·`stores/_lib.ts:4` 주석). consumer/driver는 store status 미분기. → 세션92 스냅샷과 일치, 영향 범위 1곳뿐이라 T0 안전.

**커밋 C1 (`6c474ce`) — T0 shared `StoreStatus` 교정**: `packages/shared/src/store.types.ts:1` `'invited'|'active'|'suspended'` → `'invited'|'active'|'archived'`. shared 재빌드(dist `.d.ts`+`.map` 동반 커밋, 본 저장소 관례). 같은 커밋에 SDD [`admin-tab-stores-plan.md`](../docs/specs/frontend/admin/admin-tab-stores-plan.md) §A-0a grep 표 채움 포함(미추적 신규 SDD라 함께 트래킹).

**커밋 C2 (`1bd259a`) — T1+T2 어드민 union 적용 + 죽은 '정지' 라벨 제거**: ① [useAdmin.ts:14](../apps/seller/src/hooks/useAdmin.ts#L14) `AdminStore.status: string` → `StoreStatus` import 후 적용 ② [_lib.ts](../apps/seller/src/app/admin/stores/_lib.ts) `STATUS_LABEL`·`STATUS_COLOR`를 `Record<string,string>` → `Record<StoreStatus,string>` 좁힘 ③ `suspended:'정지'`·`suspended:'gray'` 항목 삭제(세션90 grill-me 결론 "판매자 정지 기능 없음"과 일치) ④ 주석 갱신(불일치 자인 → 정합성 확보 기록). **`StoresTable.tsx`의 `?? store.status`·`?? 'gray'` 폴백은 미래 union 확장 안전망으로 유지**(SDD 지시).

**정합성 — 두 커밋 공통(C1·C2 각각 검토)**: tsc 4앱(seller·consumer·driver·api) 0 errors / biome **변동 0**(baseline=변경후 동일: seller 0e/2w·consumer 7e/25w·driver 2e/5w·api 0e/0w) / 4앱 빌드 통과(seller=어드민 포함 23+ 라우트·api=Nest) / 500라인 한도(_lib.ts 27·useAdmin.ts 388·store.types.ts 25) / SSOT 키가 union과 정확히 일치.

**SDD 구도 (PR-A는 1/5 PR)**: PR-A(C1+C2 SSOT 교정, **이번 종결**) → PR-B(C3 T6+T9 검색·필터·정렬·URL 쿼리 + 빈결과 2종) → PR-C(C4 T3 `parseRate` 순수함수+vitest 9) → PR-D(C5 T4 NumberInput, 시각 회귀 격리) → PR-E(E1 어드민 stores e2e 8 케이스, 세션90 인프라 재사용). 본 PR-A는 신규 기능 0·시각 회귀 0이라 별도 육안 불요(통합 육안 §추가 항목만 다음 세션에 등록).

**연관**: SDD [`docs/specs/frontend/admin/admin-tab-stores-plan.md`](../docs/specs/frontend/admin/admin-tab-stores-plan.md) §A-0a~A-3 · 인덱스 [`admin-tabs-improve-plan.md`](../docs/specs/frontend/admin-tabs-improve-plan.md). 다음 세션 진입 = PR-B(C3) 또는 PR-D(C5 시각 격리 우선) 사용자 선택. 커밋 `6c474ce`·`1bd259a` push.

---

## [#CL-55 / PR-B C3] 어드민 stores 검색·필터·정렬·새로고침 + URL 복원 (2026-05-28, 구현 세션 종결)

**선행**: PR-A(C1·C2, `6c474ce`·`1bd259a`)로 `StoreStatus`가 `invited|active|archived`에 정합된 뒤 진행. 본 작업은 `admin-tab-stores-plan.md`의 T6+T9이며 백엔드·데이터모델은 변경하지 않는다.

**설계 결정**:
1. 기존 "정리된 판매자 보기" Switch는 상태 Select로 흡수한다. 항목은 **전체·활성·초대됨·운영중·정리됨**, 기본값은 **활성**(`invited|active`, archived 숨김)으로 기존 기본 노출 체감을 보존한다.
2. `'활성'` URL 값은 `status=current`로 표현한다. `status=active`는 실제 단일 상태인 `'운영중'`과 충돌하므로 사용하지 않는다.
3. URL 쿼리는 `keyword/status/sort/dir`만 사용하며 기본값(`status=current`, `sort=name`, `dir=asc`)은 생략한다. 기존 `/admin/stores` 진입 주소를 유지하면서 변경 조건만 공유·뒤로가기 복원한다.
4. 정렬 조작은 화면 폭에 맞춘다. 데스크톱은 테이블 헤더 토글, 모바일 카드는 상단 Select를 사용해 카드 내부 액션 영역을 흔들지 않는다.
5. 빈 결과는 데이터 자체 없음과 조건 불일치를 분리한다. 조건 불일치일 때만 "필터 초기화" 동선을 제공한다.

**구현(`76f8f17`)**: [StoresFilters.tsx](../apps/seller/src/app/admin/stores/_components/StoresFilters.tsx) 신설 · [_lib.ts](../apps/seller/src/app/admin/stores/_lib.ts)에 필터/정렬/빈결과/options SSOT 추가 · [_client.tsx](../apps/seller/src/app/admin/stores/_client.tsx)에 URL 상태 동기화·새로고침 배선 · [StoresTable.tsx](../apps/seller/src/app/admin/stores/_components/StoresTable.tsx)에 정렬 헤더·조건 불일치 가드 추가 · 기존 읽기 전용 [admin-store-archive.spec.ts](../apps/e2e/tests/admin-store-archive.spec.ts)는 삭제된 Switch 대신 상태 필터 기본값을 확인하도록 갱신.

**정합성**: seller·consumer·driver·api tsc 0 · seller biome 신규 0(기존 `<img>` warning 2건만 잔존) · seller build 성공(`/admin/stores` 포함 23라우트) · 최대 변경 코드 `StoresTable.tsx` 274라인으로 300행 선택 분할 트리거와 500라인 절대 한도 모두 미발동 · 갱신 e2e 8사례 수집 정상.

**검증 위임 사유**: 로컬 런타임에 `AUTH_SECRET`이 없어 `Auth.js MissingSecret`이 발생하고 `/api/auth/csrf`가 500을 반환해 인증 스모크가 실행 전에 차단됐다. 따라서 배포 후 상호작용 육안은 [pending-visual-verify.md](../docs/specs/frontend/pending-visual-verify.md) #55·#60으로 위임한다.

**차기 진입**: PR-C(C4) `parseRate(input): ParseRateResult` 순수함수 추출 + vitest 9케이스. PR-D(C5 NumberInput)는 PR-C 이후 시각 회귀 단독 격리로 진행.

---

## [#CL-55 / PR-C C4] 어드민 stores 수수료 입력 검증 순수함수화 + 단위 테스트 (2026-05-28, 구현 세션 종결)

**선행**: PR-B(C3, `76f8f17`)까지의 검색·필터·정렬·URL 복원 코드는 유지한다. 본 작업은 `admin-tab-stores-plan.md`의 T3이며 수수료 저장 API와 입력 UI는 변경하지 않는다.

**설계 결정**:
1. 입력 문자열 해석은 [_lib.ts](../apps/seller/src/app/admin/stores/_lib.ts)의 `parseRate(input): ParseRateResult`로 분리한다. 성공은 `rate`, 실패는 `EMPTY | NOT_NUMBER | OUT_OF_RANGE` 코드만 반환하므로 표현 계층과 검증 규칙의 책임을 나눈다.
2. 순수 추출 C7 기준을 지키기 위해 [_client.tsx](../apps/seller/src/app/admin/stores/_client.tsx)의 기존 사용자 알림 문구는 모든 실패 코드에서 그대로 유지한다. 오류별 문구 세분화는 사용자 행동 변경이므로 별도 UX 범위다.
3. 세션85의 `vitest`는 `packages/shared`에만 존재했다. 로직 소유 경로인 `apps/seller`에서 테스트를 실행할 수 있도록 seller 작업공간에 `test` 스크립트와 `vitest` 개발 의존성을 연결한다.

**구현**: `_lib.ts`에 `ParseRateError`·`ParseRateResult`·`parseRate` 추가 · `_client.tsx`의 인라인 검증을 `parseRate` 결과 분기로 치환 · [_lib.test.ts](../apps/seller/src/app/admin/stores/_lib.test.ts) 신설(정상·경계·빈값·공백·비숫자·범위 초과·trim 총 9건) · `apps/seller/package.json`/`pnpm-lock.yaml` 테스트 실행 기반 추가.

**정합성**: `pnpm --filter seller test` **9/9 통과** · seller/consumer/driver/api `tsc --noEmit` 통과 · seller biome 신규 0(기존 `<img>` warning 2건만) · `pnpm --filter seller build` 통과(`/admin/stores` 포함) · 변경 코드 라인 한도 `_lib.ts` 123, `_client.tsx` 177, `_lib.test.ts` 40으로 전부 500 미만. 누적돼 500행을 넘은 활성 SDD는 완료된 PR-A·PR-B 절차 중복을 본 결정 로그 참조 요약으로 접어 `admin-tab-stores-plan.md` 447행으로 축소했다.

**차기 진입**: PR-D(C5) native 수수료 입력을 Mantine `NumberInput`으로 교체하는 시각 회귀 격리 작업. PR-B 배포 후 육안 잔여는 기존 `pending-visual-verify.md` #55·#60에서 계속 관리한다.

---

## [#CL-55 / PR-D C5] 어드민 stores 수수료 입력 Mantine NumberInput 교체 (2026-05-28, 구현 종결·육안 위임)

**선행**: PR-C의 `parseRate(input): ParseRateResult` 검증 규칙과 기존 저장 API는 유지한다. 본 작업은 입력 표현 계층 교체와 시각 회귀 격리에 한정한다.

**설계 결정**:
1. [StoresTable.tsx](../apps/seller/src/app/admin/stores/_components/StoresTable.tsx)의 공용 편집 렌더에 Mantine `NumberInput`을 적용한다. 공용 렌더 한 곳을 바꿔 데스크톱 테이블과 모바일 카드가 같은 입력 계약을 사용한다.
2. `min={0}`·`max={1}`만으로 저장 전 직접 입력을 방치하지 않도록 `clampBehavior="strict"`를 지정하고, 모바일 소수 입력 의도는 `inputMode="decimal"`로 명시한다. `step={0.01}`·`decimalScale={2}`는 수수료 입력 정밀도를 UI에서 드러낸다.
3. `NumberInput`의 `number | string` 결과는 호출 경계에서 `String(value)`로 정규화한다. 검증·저장 책임은 계속 PR-C `parseRate`와 `_client.tsx`에 두어 표현 컴포넌트가 비즈니스 규칙을 소유하지 않게 한다.

**구현**: native `<input type="number">`를 `<NumberInput ... />`으로 치환하고 `size="xs"`·`radius="sm"`·`w={104}`로 기존 인라인 편집 밀도를 보존했다.

**정합성**: `pnpm --filter seller test` **9/9 통과** · seller/consumer/driver/api `tsc --noEmit` 통과 · seller biome 신규 0(기존 `<img>` warning 2건만) · `pnpm --filter seller build` 통과(`/admin/stores` 포함) · `StoresTable.tsx` 294라인, `_client.tsx` 177라인, `_lib.ts` 123라인으로 코드 파일 전부 500라인 미만이며 300행 선택 분할 기준도 미발동.

**육안 위임 사유**: 로컬 `http://localhost:3010/admin/stores` 확인은 `AUTH_SECRET` 부재의 `Auth.js MissingSecret`과 [proxy.ts](../apps/seller/src/proxy.ts)의 비어 있는 `session.user.role` 접근 오류로 입력 UI 렌더 전에 차단됐다. 따라서 데스크톱·모바일 배치, focus, 증감/소수 키보드, 범위 차단, 정상 저장 육안은 [pending-visual-verify.md](../docs/specs/frontend/pending-visual-verify.md) #61~#66으로 위임한다.

**차기 진입**: PR-D 배포 후 육안 통과를 선행 조건으로 PR-E 어드민 stores e2e 스펙을 신설한다.

---

## [#CL-55 / PR-E E1] 어드민 stores 상호작용 e2e 데이터 격리 결정 (2026-05-28, 프리뷰 검증 종결)

**진입 조건 처리**: PR-D의 브라우저 육안은 로컬 인증 환경 차단으로 사용자 검증에 위임됐다. 사용자가 해당 위임 상태로 PR-E 진행을 지시했으므로, 시각 확인 완료를 기다리지 않고 회귀 자동화를 착수하며 육안 잔여는 기존 `pending-visual-verify.md` #61~#66에서 독립 관리한다.

**발견 사항**: 계획의 검색·상태 필터 검증은 이름에 `디어`가 포함된 판매자와 `archived` 판매자를 요구하지만, 기존 [seed-test-data.mjs](../scripts/seed-test-data.mjs)는 `테스트 꽃 농장` 한 건만 생성하고 상태 조합을 보장하지 않는다. 또한 수수료 저장 클릭을 실 API로 실행하면 회귀 검증이 운영 데이터 변경을 수반한다.

**설계 결정**:
1. 세션90의 [admin-store-archive.spec.ts](../apps/e2e/tests/admin-store-archive.spec.ts)는 실제 인증 세션과 실 API 목록 렌더 스모크로 그대로 둔다.
2. 신규 `admin-stores-filter-sort.spec.ts`는 `.admin-state.json` 인증 컨텍스트를 재사용하되, 상호작용별 `GET /admin/stores`만 상태 3종·수수료율 3종 fixture로 응답한다. 이 범위는 PR-A~D가 소유하는 화면 필터·정렬·URL·입력 계약이며 API 비즈니스 로직이 아니다.
3. 수수료 입력 사례의 `PATCH /admin/stores/:id/commission`은 테스트 컨텍스트에서 응답을 가로채고 요청 본문을 관찰한다. 따라서 `1.5` 범위 밖 값 차단을 확인하면서도 실제 DB 쓰기를 발생시키지 않는다.

**의도**: 인증 경계의 실연결 스모크와 표현 계층 상태 변환 회귀를 역할별로 분리해, 데이터 상태·테스트 순서·운영 쓰기에 영향받지 않는 반복 가능한 PR-E 검증을 만든다.

**구현**: [admin-stores-filter-sort.spec.ts](../apps/e2e/tests/admin-stores-filter-sort.spec.ts)에 8개 시나리오를 신설했다. 기본 활성 필터, 검색, 정리됨 상태와 URL, 새로고침 재조회, 반응형 정렬 URL, 빈결과 초기화, 직접 URL 복원, `NumberInput` 범위 밖 저장 차단을 다루며 `chromium`·`mobile` 양쪽에서 수집된다.

**정합성**: 관련 `biome check` 통과 · seller `vitest` **9/9 통과** · seller/consumer/driver/api `tsc --noEmit` 통과 · seller build 통과(`/admin/stores` 포함) · `playwright test admin-stores-filter-sort --list`에서 **16건 수집**(8시나리오×2 viewport) · 종결 시점 신규 e2e 파일 192라인, 활성 SDD 447라인, 본 누적 로그 923라인으로 1000라인 이관 기준 미만.

**런타임 검증 종결**: 작업 트리를 seller 임시 프리뷰 `greenhub-seller-blkcqzhnf-jos-projects-d1cecc0c.vercel.app`에 반영하고 Vercel 상태 `READY`를 확인한 뒤 해당 주소를 `SELLER_BASE`로 지정했다. 첫 실행에서 `getByLabel('상태'|'정렬')`가 정렬 버튼·목록까지 포괄하는 선택자 결함과 Mantine `Select`가 내부 키가 아닌 표시값(`활성`·`운영중`)을 입력값으로 노출하는 단언 결함을 발견했다. 신규 스펙을 `combobox` 정확 역할과 표시값 단언으로 보정한 뒤 동일 프리뷰에서 `pnpm test:e2e -- admin-stores-filter-sort` **16/16 통과**(27.3초)를 확인했다. `GET` fixture와 `PATCH` 가로채기 원칙은 유지되어 운영 DB 쓰기는 발생하지 않는다.

**후속 범위 승격 결정 (2026-05-28)**: 사용자가 본 PR 범위에서 제외됐던 T7(판매자 상세 드릴다운)과 T8(플랫폼 기본 수수료율 설정)을 향후 구현 작업으로 등록하도록 확정했다. 두 작업은 PR-A~E의 종결 상태를 변경하지 않으며, 각각 집계 API·라우트 및 전역 config·적용 정책이라는 새 계약을 포함하므로 `docs/BACKLOG.md` 미완료 항목으로 승격하고 구현 전 별도 SDD 작성을 게이트로 둔다.

---

## [#CL-55 / 머지 후 CI] 고정 preview 정산 날짜 검증의 KST 계약 교정 (2026-05-28)

**관찰**: PR #3 병합 뒤 `Sync preview branch`는 SHA 일치 배포까지 성공했지만, 후속 `E2E Tests` 실행 `26526534062`는 기존 `seller-settlements.spec.ts` 한 건에서만 실패했다. CI 실행 시각은 UTC `2026-05-27`이지만 앱의 날짜 선택기는 `todayKST()` 계약에 따라 `2026-05-28`을 노출해, 테스트의 UTC 기대값이 실제 제품 계약보다 하루 뒤처졌다.

**결정**: 정산 e2e 날짜 입력 기대값을 앱과 같은 UTC+9 날짜 문자열 계산으로 통일한다. `max` 단언뿐 아니라 어제 날짜 입력·레이블 단언도 같은 보조 함수로 계산해 KST 자정 경계에서 재발하지 않게 한다. admin stores 신규 스펙의 CI 건너뜀은 Actions에 `TEST_ADMIN_EMAIL/PASSWORD` 시크릿이 없는 기존 구성 때문이며, PR-E의 인증 가능한 임시 프리뷰 16/16 검증 근거는 유지한다.

**사전 검증**: 변경 스펙 `biome check` 통과 · 인증 가능한 프리뷰 대상으로 `seller-settlements.spec.ts`와 `admin-stores-filter-sort.spec.ts`를 함께 실행해 `chromium` **16/16 통과**.

**병합 후 종결**: 보정 커밋 `1a924a7`을 PR #4로 merge(`8827b87`)한 뒤 `Sync preview branch` 실행 `26527167757`이 SHA 일치 고정 preview 배포를 통과했고, 이어진 `E2E Tests` 실행 `26527463226`도 성공했다. `pending-visual-verify.md`의 육안 잔여는 본 자동 종결과 분리해 미완료로 유지한다.

---

## [#CL-55 / Users S4] 어드민 소비자 목록 최신순·상한 조회 결정 (2026-05-29)

**문제**: `/admin/users`는 `role === 'consumer'` 전체를 제한 없이 읽고 있었다. 프론트 검색·상태 필터가 클라이언트 소유인 현재 구조에서는 전체 읽기가 운영 데이터 증가와 함께 Firestore 비용·응답 지연을 선형으로 키운다.

**결정**:
1. `AdminService.getUsers()`는 `role == consumer` 조건에 `createdAt desc` 정렬과 `limit(5000)`을 적용한다.
2. 현재 admin users 검색은 최근 운영 확인·CS 조회 용도이며 페이지네이션이 아직 SDD 범위 밖이므로, 5000건 상한을 MVP 안전 한계로 둔다. 5000건 초과 운영 규모가 확인되면 서버 검색·커서 페이지네이션을 별도 SDD로 승격한다.
3. Firestore 복합 인덱스 `users(role asc, createdAt desc)`를 `firestore.indexes.json`에 추가한다. 배포 전 인덱스 배포 확인은 S4의 수동 게이트로 유지한다.

**구현**: [admin.service.ts](../apps/api/src/admin/admin.service.ts)의 `getUsers()`에 `ADMIN_USERS_LIMIT` 상수와 `.limit(ADMIN_USERS_LIMIT)` 추가 · [admin.md](../docs/specs/api/admin.md)에 응답 계약 갱신 · [firestore.indexes.json](../firestore.indexes.json)에 users 복합 인덱스 추가.

**검증**: api 타입체크·빌드와 seller S1~S3 정합성 검증으로 확인한다. 인덱스 실제 배포와 운영 화면 최신순 육안은 [pending-visual-verify.md](../docs/specs/frontend/pending-visual-verify.md) §5에 위임한다.

---

## [#CL-55 / Users S5] 어드민 소비자 탭 e2e 회귀 자동화 추가 (2026-05-29)

**진입 조건 처리**: S1~S4 코드가 아직 운영 `seller.greenlove.co.kr`에 반영되지 않은 상태에서도, 사용자가 S5 계속 진행을 지시했다. 세션90·PR-E 선례와 같이 어드민 인증 컨텍스트는 `.admin-state.json`을 재사용하고, UI 상호작용은 `GET /admin/users`와 `PATCH /admin/users/:id/status`를 Playwright 라우트 fixture로 격리해 운영 DB 쓰기 없이 반복 가능하게 한다.

**설계 결정**:
1. 신규 [admin-users.spec.ts](../apps/e2e/tests/admin-users.spec.ts)는 인증 경계 자체보다 S2~S3 표현 계약을 검증한다. 실제 `/admin/users` API 연결 스모크와 Firestore 인덱스 배포 확인은 육안·운영 확인 항목으로 분리한다.
2. fixture는 정상 2명·정지 1명, 전화번호 하이픈 포함/미포함/빈값, 가입일 3일치를 포함한다. 검색·상태 필터·빈결과·새로고침·정지 확인창 요청 본문까지 확인하되 실제 DB 변경은 가로챈다.
3. D1 refresh 정지 차단은 이미 [auth.service.spec.ts](../apps/api/src/auth/auth.service.spec.ts)가 refresh token rotation과 함께 직접 검증하므로, S5 Playwright에서는 중복하지 않는다. 운영 refresh 401 수동 확인은 `pending-visual-verify.md` §5에 남긴다.

**구현**: 7개 시나리오를 신설했다. 데스크톱 가입일·전화 컬럼, 모바일 카드 가입일·전화, 새로고침 재조회, 전체·정상·정지 탭 필터, 이름·이메일·전화 검색, 검색 결과 없음 문구와 필터 유지, 검색·필터 상태에서 정지 확인창과 `suspended: true` 요청 본문을 다룬다. `chromium`·`mobile` 프로젝트 양쪽에서 수집되므로 총 14개 테스트다.

**검증 상태**: `pnpm --filter e2e test -- admin-users.spec.ts`를 현재 환경에서 실행했으나, `SELLER_BASE`가 운영 도메인을 가리켜 새 검색 입력이 없는 기존 화면을 로드했다. 결과는 14/14 실패이며 공통 원인은 `getByLabel('소비자 검색')` 미노출이다. 이는 스펙 셀렉터 결함이 아니라 배포 대상 불일치로 판단한다. 새 코드가 반영된 프리뷰 또는 운영 배포 후 같은 명령을 재실행해야 S5 런타임 종결이 가능하다.

**잔여**: S4 인덱스 운영 배포, 운영 user 수 5000 미만 확인, S5 e2e를 새 코드 반영 프리뷰에서 재실행, 그리고 [pending-visual-verify.md](../docs/specs/frontend/pending-visual-verify.md) §5의 데스크톱·모바일 육안 확인.

---

## [#CL-55 / Settlements F2 SDD] 어드민 정산 일괄 지급 계약 결정 (2026-05-29)

**문제**: `/admin/settlements`는 confirmed 정산을 단건으로만 지급 처리할 수 있어, 정산 마감 후 여러 판매자 지급을 반복 클릭해야 한다. 기존 단건 API는 트랜잭션으로 동시 클릭 경합을 막지만, 운영 단위의 다중 선택 계약과 부분 실패 표현은 아직 없다.

**결정**:
1. 일괄 지급 API는 `POST /admin/settlements/bulk-pay`로 추가하고 요청은 `{ ids: string[] }`, 응답은 `{ ok: string[], failed: { id: string, reason: string }[] }`로 고정한다.
2. 서버는 ID를 중복 제거한 뒤 단건 `markAsPaid`와 같은 조건부 트랜잭션을 건별 반복한다. batch write 대신 부분 성공을 허용해 한 건의 상태 불일치가 전체 지급을 막지 않게 한다.
3. 프론트는 `confirmed` 상태만 선택 가능하게 하며, 전체 선택도 현재 목록의 `confirmed` 건만 대상으로 한다. 선택 건수·지급 합계·확인 모달·부분 실패 알림은 UI 계약으로 둔다.
4. 실제 운영 DB 쓰기 위험이 있으므로 육안 검증은 테스트 DB, fixture 프리뷰, 또는 되돌릴 수 있는 검증 데이터에서만 수행한다.

**산출물**: [admin-tab-settlements-bulk-pay-plan.md](../docs/specs/frontend/admin/admin-tab-settlements-bulk-pay-plan.md)를 신설하고, 구현 후 확인할 항목을 [pending-visual-verify.md](../docs/specs/frontend/pending-visual-verify.md) §6 #80~#89에 추가했다.

**차기 진입**: T-F2a~c 백엔드 DTO·service·controller 구현 후, T-F2d~e 프론트 hook·다중 선택 UI를 진행한다.

---

## [#CL-55 / Settlements F2 UI] 일괄 지급 부분 실패 선택 유지 결정 (2026-05-29)

**문제**: 일괄 지급 API는 `{ ok, failed }` 부분 성공을 허용한다. 프론트가 처리 후 전체 선택을 무조건 해제하면 실패 건을 운영자가 다시 찾기 어렵고, 전체 선택을 그대로 유지하면 이미 성공한 지급 건에 재시도 의도가 섞인다.

**결정**: `/admin/settlements` 일괄 지급 후 성공 건은 선택에서 제거하고 실패 건만 선택 상태로 유지한다. 성공 0건·실패 N건도 같은 규칙을 적용하며, 알림에는 성공/실패 건수와 최대 3개 실패 사유를 표시한다.

**의도**: 서버의 건별 트랜잭션 계약과 UI 복구 흐름을 맞춰, 운영자가 실패 건만 즉시 재검토·재시도할 수 있게 한다. 실제 지급 처리는 운영 DB 쓰기 위험이 있으므로 `pending-visual-verify.md` §6의 테스트 DB·fixture 프리뷰 게이트를 유지한다.

---

## [#CL-55 / Settlements N+3] KST 정산일시·조회 실패·새로고침 표준화 결정 (2026-05-29)

**문제**: 어드민 정산 화면은 자체 `toLocaleDateString('ko-KR')` 포맷을 사용해 판매자 정산 화면의 KST SSOT와 표시 기준이 달랐다. 또한 조회 실패가 빈 결과와 시각적으로 분리되지 않고, hook의 `reload`가 화면에 노출되지 않아 운영자가 수동 재조회하기 어려웠다.

**결정**:
1. shared `toDateStrKST(date, { hour, minute })` 옵션을 추가해 기존 날짜 전용 계약은 유지하면서, 정산일시가 필요한 화면은 `YYYY-MM-DD HH:mm` KST 형식을 사용한다.
2. `/admin/settlements`는 `useAdminSettlements.error`를 `_client.tsx`에서 직접 구독하고 필터 아래 Alert로 표시한다. Table 컴포넌트는 loading/empty/data 3분기 책임만 유지한다.
3. 헤더 우측에는 기존 users 탭과 같은 `RotateCw` ActionIcon 새로고침을 배치하고, 합계 카드 라벨에는 confirmed+paid 한정 합계 설명 Tooltip을 붙인다.

**검증**: shared build, shared date vitest 7건, seller `tsc --noEmit`, 변경 파일 biome check를 통과했다. 육안검증은 `pending-visual-verify.md` §6 #91~#94에 등록했다.

---

## [#CL-55 / Settlements N+4] 어드민 정산 status 필터 계약 결정 (2026-05-29)

**문제**: 판매자 정산 화면은 shared `SettlementStatus` 기반 status 필터를 제공하지만, 어드민 정산 화면은 storeId·기간만 전달해 운영자가 `confirmed` 지급 대상이나 `paid` 완료 건만 빠르게 좁혀 볼 수 없었다.

**결정**:
1. 백엔드 `GET /admin/settlements`는 `status?: SettlementStatus`를 쿼리로 받으며, DTO 검증은 shared `SETTLEMENT_STATUSES`를 사용한다.
2. Firestore 쿼리는 기존 `settledAt desc` 정렬을 유지하고, status가 있을 때 `where('status', '==', status)`를 추가한다.
3. `firestore.indexes.json`에는 이미 `settlements(status asc, settledAt desc)`와 `settlements(storeId asc, status asc, settledAt desc)`가 있어 새 인덱스를 추가하지 않는다. 운영 배포 여부는 육안검증 게이트로 남긴다.
4. 프론트는 어드민 전용 `_constants.ts`에서 `all + SETTLEMENT_STATUSES` 탭을 구성하되, 라벨은 shared `STATUS_LABEL`만 재사용한다. 판매자 화면 `_constants`를 cross-import하지 않는다.

**검증 예정**: api·seller 타입체크와 변경 파일 biome check로 정합성을 확인하고, 새 코드 반영 프리뷰에서 `/admin/settlements` status 탭 전환과 인덱스 오류 부재를 육안 확인한다.

---

## [#CL-55 / Orders 세션α] OrderStatus 타입화와 강제환불 위험 단계 가드 (2026-05-29)

**문제**: 어드민 주문 탭은 shared `OrderStatus`가 있는데도 프론트 `AdminOrder.status`와 `_lib.ts` 라벨 맵을 `string`으로 다뤄 상태 오타·누락을 컴파일 시점에 잡지 못했다. 또한 강제환불은 프론트 버튼은 배달 전 4개 상태만 노출하지만, 백엔드는 `CANCELLED`만 막아 배달 진행 후 주문도 사유 없이 직접 환불 호출이 가능했다.

**결정**:
1. 어드민 주문 표현 계층은 shared `OrderStatus`를 사용한다. `_lib.ts`의 `STATUS_LABEL`은 `satisfies Record<OrderStatus, string>`로 누락 검증을 받되, 화면 표시부의 안전망은 유지한다.
2. `GET /admin/orders?status=` DTO는 `OrderStatus` 값만 허용한다.
3. `forceRefund`는 `CANCELLED`를 기존처럼 차단하고, `DELIVERING·HUB_ARRIVED·PICKED_UP·DELIVERED·REVIEWED`는 trim 기준 5자 이상 사유가 없으면 400으로 차단한다.
4. 일반 상태는 기존 동작을 유지하며, 빈 사유는 `관리자 강제 환불` 기본 사유로 저장한다.

**검증**: `admin.service.spec.ts`에 11개 상태 × 3개 사유 조합을 추가했다. seller/api/consumer/driver 타입검사, 변경 파일 Biome, API 단위 테스트로 정합성을 확인하고, 운영 반영 후 회귀 확인은 `pending-visual-verify.md` §10에 위임한다.
