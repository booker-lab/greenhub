# Critical Logic — 설계 결정 이력

> 이 파일은 되돌리기 어려운 설계 결정과 그 이유를 기록합니다.
> 결정 변경 시 반드시 이유와 날짜를 함께 기록하세요.
> **누적 결정 로그** — 1000라인 초과 시 종결 엔트리를 `archive/`로 이관(활성 ~500라인 목표).
> 2026-03~04 #CL 이전 엔트리: [archive/CRITICAL_LOGIC_archive_20260516.md](archive/CRITICAL_LOGIC_archive_20260516.md)
> 2026-05-08~21 #CL-19~#CL-39 엔트리: [archive/CRITICAL_LOGIC_archive_20260529.md](archive/CRITICAL_LOGIC_archive_20260529.md)

---

## [결정 #CL-40] 택배(parcel) 발송 완료 — 셀러 `PREPARING → DELIVERED` 직행 + deliveryMethod 가드 (2026-05-22, 세션67)

**배경 (BUG-16)**: 택배 주문은 드라이버가 수거하지 않고 셀러가 택배사에 직접 발송한다. 그러나 기존 FSM(`SELLER_TRANSITIONS`)에는 셀러의 `PREPARING → DELIVERED` 경로가 없어 API가 전환을 거부 → 택배 주문이 PREPARING에 영구 고착되는 갭이 존재했다. 직접/허브 주문은 `PREPARING → DELIVERING`(드라이버)을 거치므로, 택배만 직행 경로가 필요하다.

**핵심 규칙**:

1. **FSM 확장**: `SELLER_TRANSITIONS`에 `PREPARING: ['DELIVERED']` 추가. 중간 `DELIVERING` 단계를 두지 않는 이유 — ① 택배는 드라이버 배차가 없어 `DELIVERING`이 무의미 ② `DELIVERING` 전환 시 `driverId = requesterId` 자동 기록 로직이 셀러 ID로 오염됨 ③ `DELIVERED` 직행 시 기존 정산 자동 생성(`createSettlement(order, 'DELIVERED')`) 로직을 그대로 활용.
2. **가드 (필수)**: FSM만으로는 셀러가 direct/hub 주문도 임의로 DELIVERED 마킹 가능 → `orders-lifecycle.service.ts`의 `updateStatus()`에서 `getAllowedTransitions` 통과 직후 가드 삽입:
   ```ts
   if (role === 'seller' && currentStatus === 'PREPARING' &&
       dto.status === 'DELIVERED' && order['deliveryMethod'] !== 'parcel') {
     throw new ForbiddenException('택배 발송 완료는 택배 주문에서만 가능합니다.');
   }
   ```
   admin은 본래 전 전환 권한 보유 → 가드는 `role === 'seller'`만 검사하여 admin 우회 허용.
3. **알림**: `NOTIFICATION_MAP`에 `PREPARING: { DELIVERED: 'ORDER_DELIVERED' }` 매핑 추가 — 기존 DELIVERING→DELIVERED 템플릿 재사용. 미추가 시 발송 완료 알림이 안 감.
4. **드라이버 보드 정합성**: parcel 주문이 드라이버 수거 대기 목록에 잘못 노출되지 않도록 `board/_client.tsx` 쿼리에 `where('deliveryMethod', 'in', ['direct', 'hub'])` 추가. **Firestore 복합 인덱스**(`status + deliveryMethod + preparedAt`) 첫 배포 시 자동 생성 필요 — Console 에러 링크 클릭.
5. **UI (#CL-37 일관성)**: 셀러 주문 상세의 "택배 발송 완료" 버튼은 무모달 — 명시적 버튼 클릭이 의도 표명이므로 ConfirmModal 불필요. `canShipParcel = deliveryMethod === 'parcel' && status === 'PREPARING'`.

**적용 (세션67, `2ad71e3`)**: `orders.helpers.ts`(FSM+알림) · `orders-lifecycle.service.ts`(가드) · `useOrderDetailActions.ts`(`handleShipParcel`) · `orders/[id]/page.tsx`(버튼) · `driver board/_client.tsx`(필터) · `seed-e2e-orders.mjs`(parcel 시드) · `seller-parcel-ship.spec.ts`(신규).

**범위 외**: 운송장 번호 입력·택배사 API 연동(MVP 외) · 드라이버 admin parcel 별도 조회(별건) · 발송 실패 재시도(별건).

**검증**: 셀러·드라이버·API 타입체크 exit 0 · API 단위 테스트 2/2 · 셀러 23라우트·드라이버 9라우트 빌드 · 셀러 biome 0e/2w(baseline 동일). e2e 풀런은 머지 후 dispatch.

---

## [결정 #CL-41] orderNumber 정책 — `YYYYMMDD-NNNNNN` 일자별 카운터 발급 + ID 폴백 (2026-05-22, 세션68~69)

**배경 (UX-11)**: 주문 식별자가 uuid(`order.id`)뿐이라 사용자·셀러가 UUID 일부를 읽어야 했다(`#id.slice(-8)`). 백로그 §12-1에 사람이 읽을 수 있는 주문번호 요구가 있었다.

**핵심 규칙**:

1. **패턴**: `YYYYMMDD-NNNNNN` — KST 일자 + 일별 6자리 시퀀스(`String(seq).padStart(6, '0')`). 예: `20260522-000001`.
2. **발급 위치 (동시성)**: `orders-create.service.ts`의 기존 `runTransaction` **내부**에서 발급. 카운터 문서 `orderCounters/YYYYMMDD`(`{ seq, updatedAt }` 단일 문서)를 트랜잭션 **첫 read**로 읽고(Firestore의 read-before-write 규칙), 모든 검증 후 write 단계에서 `t.set(counterRef, { seq }, { merge: true })`로 증가분을 커밋한 뒤 주문 문서에 `orderNumber` 주입. 자정 경계 동시 주문 충돌은 트랜잭션 재시도로 해결.
   - 단일 문서 write QPS ~1 한계는 MVP 트래픽에 충분. 고트래픽 전환 시 샤딩 카운터로 별건 검토.
3. **백필 안 함 (사용자 결정 ③)**: 기존 운영 주문은 `orderNumber` 부재 → shared `Order.orderNumber?: string`(optional). 프론트 표시 5곳 모두 `orderNumber ?? <ID 폴백>` 패턴:
   - 셀러 OrderCard·OrderInfoSection: `?? '#'+id.slice(-8).toUpperCase()`
   - 셀러 admin: `?? id.slice(0,12)+'…'` (AdminOrder 타입에도 필드 추가)
   - 소비자 mypage 상세·결제성공: `?? orderId`(전체 ID). 결제성공은 `useOrderStatus`가 응답 `orderNumber`를 자동 수신 → 리다이렉트 URL 변경 불필요.
   - 드라이버 OrderCard는 buyerName만 표시 → 변경 불필요.
4. **취소 시 보존**: 취소·환불돼도 orderNumber는 소멸·재사용하지 않고 그대로 유지(§UX-11 범위 외).
5. **e2e 시드 정합성**: `seed-e2e-orders.mjs`의 3주문에 고정 과거 일자 prefix `20260101-00000{1,2,3}` 주입 — 실데이터 카운터와 충돌 회피 + 폴백 분기를 안 타도록(`seller-parcel-ship.spec.ts`가 `주문 20260101-000003` 노출 회귀 가드).

**적용**: 세션68(`cf79560`) shared 타입·orders-create.service(발급+응답)·프론트 5곳 · 세션69 seed/spec·본 등재.

**범위 외**: 카운터 문서 TTL/정리 · 백필 스크립트 · 결제수단별 prefix 분기.

**연관**: [#CL-40] (BUG-16 parcel 직행 — 동일 세션 묶음).

---

## [결정 #CL-42] CI e2e seed step 신설 — 인증 규약 단일화 (`resolveCredential`) (2026-05-22, 세션70~71)

**배경 (3회 재발)**: `e2e.yml`에 **seed 단계가 없어** CI 러너가 stale/빈 Firestore로 spec을 실행 → 시드 의존 spec(주문 카드·parcel·orderNumber)이 자동 dispatch 1차에 깨지고, 매번 사람이 로컬에서 시드를 재주입하는 수동 루프가 세션61·67·69 3회 반복됨.

**치명 갭(GAP-1)**: seed step만 추가하면 즉시 크래시. `seed-e2e-orders.mjs:22`가 로컬 `apps/api/firebase-adminsdk.json`을 **하드코딩 require** → 그 파일은 gitignore 대상이라 CI 체크아웃에 부재 → `MODULE_NOT_FOUND`.

**핵심 규칙**:

1. **인증 규약 단일화**: seed·cleanup 두 스크립트 모두 `resolveCredential()` 사용 — ① `FIREBASE_SERVICE_ACCOUNT_JSON` env(CI, JSON 문자열, BOM trim) ② `apps/api/firebase-adminsdk.json` 로컬 폴백(개발자 머신). `cleanup-spec-residue.mjs:24-46`의 검증된 함수를 seed에 **이식**(중복 허용 — 2회 시점 YAGNI, 3번째 스크립트 생기면 공유 모듈 추출 재평가).
2. **CI 시크릿 재사용(신규 0건)**: e2e.yml에 이미 등록된 `FIREBASE_SERVICE_ACCOUNT_JSON`(cleanup용)을 seed step env로 재사용. 사용자 결정.
3. **step 배치**: `Install Playwright` 이후 · `Run E2E` 이전. seed `process.exit(1)`로 step fail → 후속 test 미실행(silent pass 방지).
4. **멱등·정리 무충돌**: seed는 `e2e-` prefix set 덮어쓰기, cleanup은 `e2e-` 시드 보존 → seed→test→cleanup 순서 충돌 0.

**적용**: 세션71 — `seed-e2e-orders.mjs` resolveCredential 이식(로컬 폴백 회귀 검증 통과) · `e2e.yml` seed step 신설 · 본 등재.

**범위 외(별건)**: B(stale preview race — sync-preview success≠Vercel 실배포) · seed 동적 일자 고정화 · 공유 인증 모듈 추출.

**연관**: [#CL-41] (seed 시드 정합성 — 동일 스크립트), `reference_e2e_preview_race`(B 별건).

---

## [결정 #CL-43] sync-preview 배포 게이트 — SHA-매칭 deployments 폴링 (2026-05-22, 세션71)

**배경 (B / stale preview race)**: `sync-preview.yml`이 success로 떨어진 직후 e2e를 dispatch하지만, Vercel 실배포는 2~4분 더 걸려 e2e가 **stale(이전 커밋) 배포본**을 검사함(세션39·60·61 재현, 자동 1차 실패→수동 재dispatch 루프). #CL-42(CI-SEED)에서 "범위 외 별건"으로 분리됐던 B를 트리거 단계에서 해소.

**핵심 규칙**:

1. **SHA-매칭(시각 비교 폐기)**: 폴링 종료 조건 = 3앱 각각 `deployment.sha == preview HEAD SHA`인 deployment의 최신 status `state == 'success'`. deployment.sha = preview HEAD commit SHA와 정확히 일치(실측). 시각(`created_at`) 비교는 시계 오차·재시도에 취약해 폐기(GAP-1).
2. **별칭 재포인팅 전제(T0 실측 확정)**: e2e BASE는 고정 별칭 `-git-preview-`, deployment URL은 커밋별 `-<hash>-`로 직접 다름. 그러나 Vercel은 커밋 빌드 success 시 별칭을 그 커밋으로 재포인팅 — 별칭/커밋 URL이 **동일 `/_next/static/chunks` 해시**를 서빙함을 bypass 쿠키로 대조 확인. 따라서 sha-매칭 success = e2e BASE가 새 커밋을 서빙하게 된 정확한 신호(GAP-4). 별칭 헬스체크 폴링 불요.
3. **권한**: `permissions:`에 `deployments: read` 추가 — `GITHUB_TOKEN`에 기본 부재라 `gh api .../deployments` 403 방지(GAP-2, 워크플로 run에서 실증).
4. **environment 이름 인코딩**: 3종 모두 구분자가 en-dash(U+2013 '–', 일반 hyphen 아님). consumer는 앱명에 하이픈 없음(`Preview – greenhubconsumer`, seller/driver와 표기 불일치). `encodeURIComponent`로 인코딩(GAP-3).
5. **timeout fail-fast**: 10분 폴링 초과 시 `exit 1` → e2e dispatch 차단 → stale e2e 헛수고 대신 배포 지연 원인 노출(사용자 결정). 미완 앱 로그 출력.

**적용**: 세션71 — `scripts/wait-preview-deploy.mjs` 신설(SHA-매칭 폴링, success/fail-fast 로컬 실측) · `sync-preview.yml` `deployments:read` + Trigger E2E 직전 폴링 step. **T4 검증(run 26279110149)**: 폴링이 ~5m30s 3앱 배포 완료 대기(driver 09:16:01·consumer 09:16:48·seller 09:17:49) → e2e dispatch 09:17:51(마지막 배포 후) → e2e run 26279363879 1차 success. CI-SEED와 결합해 자동 dispatch 1차 통과(시드+fresh 배포 양쪽 보장) — 세션39·60·61·67·69 race 루프 종결.

**범위 외(별건)**: e2e.yml 자체 헬스체크 · Vercel Deploy Hook/Checks API 연동 · seed 동적 일자 고정화 · 폴링 스크립트 공유 인증 모듈(GITHUB_TOKEN만 사용, 해당 없음).

**연관**: [#CL-42] (CI-SEED — B를 별건 분리한 결정, 본 #CL-43이 그 B 해소), `reference_e2e_preview_race`(수동 5분 대기 권장 → 게이트로 자동 해소).

---

## [결정 #CL-44] 정산 confirm 마감 배치 — pending→confirmed 자동 확정 (2026-05-22, 세션72~74)

**배경 (치명 갭 / A-1 워크플로 단절)**: `settlements.md §2`는 상태 흐름을 `pending → confirmed → paid`로 명시하나, **`pending → confirmed` 전이 코드가 코드베이스 전체에 부재**(Grep 실측). createSettlement는 항상 pending 생성([settlements.service.ts:41](../apps/api/src/settlements/settlements.service.ts#L41)), markAsPaid는 confirmed에서만 지급 허용([admin.service.ts:155](../apps/api/src/admin/admin.service.ts#L155)) → **전 정산 pending 영구 고착 → 어드민 "지급처리" 버튼이 confirmed에서만 렌더돼 영구 미노출**([_client.tsx:288](../apps/seller/src/app/admin/settlements/_client.tsx#L288)). 정산 핵심 워크플로 단절.

**핵심 규칙**:

1. **마감 배치로 confirm 전이(사용자 결정)**: 실시간 운영자 확인 대신 `@Cron('0 4 * * *')`(매일 04:00 KST) 배치가 `settledAt`이 마감 경계(`지금 - SETTLEMENT_CONFIRM_DELAY_DAYS일`, 기본 **1**) 경과한 pending을 confirmed 일괄 전이. payments `cleanupPendingOrders` cron 패턴 동형(쿼리→개별 처리). 신규 의존성 0(`@nestjs/schedule` 기설치).
2. **트랜잭션 멱등 + 취소 경합 차단(GAP-1)**: 쿼리 `status==pending AND settledAt<cutoff` 후 각 문서를 **트랜잭션 내 재확인(pending일 때만)** confirmed + confirmedAt set. cancelled는 절대 미덮어씀(cron 중복 실행·배치 중 주문 취소 경합 무해).
3. **KST 보정 필수(T0 실측)**: 서버 TZ 설정 전무(Grep) → UTC 기준. cutoff를 KST로 명시 보정하거나 `@Cron` `{ timeZone: 'Asia/Seoul' }` 옵션(@nestjs/schedule v6 지원, 우선).
4. **복합 인덱스 + 수동 배포(GAP-3, T0 정정)**: 배치 쿼리 `status+settledAt`(storeId 없음)는 신규 2필드 인덱스 필요(기존 `storeId+status+settledAt`은 storeId 필수라 부적용). **CI 자동 배포 부재 확정** → `firebase deploy --only firestore:indexes` 수동 실행 필수(미배포 시 `FAILED_PRECONDITION`).

**적용 결과(세션75 S1 구현 완료, 미커밋)**: B-1 = `confirmDueSettlements()` 신설([settlements.service.ts](../apps/api/src/settlements/settlements.service.ts)) — `@Cron('0 4 * * *', { timeZone: 'Asia/Seoul' })`(v6 `timeZone?: string` 정식 지원 실측 확인), 쿼리 후 `runTransaction`으로 문서별 재확인(pending일 때만 confirmed+confirmedAt) → cancelled 미덮어씀. createSettlement에 `confirmedAt: null` 추가. B-2 = `firestore.indexes.json`에 `status ASC + settledAt ASC` 2필드 인덱스 추가. N9 = 컨트롤러 클래스 레벨 `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin')`([admin.controller.ts:18-21](../apps/api/src/admin/admin.controller.ts#L18-L21))로 이미 보호 확인 → 메서드 레벨 추가 불필요. **DoD: `pnpm --filter api build` 통과(타입체크 포함).** 잔여: 인덱스 수동 배포(`firebase deploy --only firestore:indexes`)는 운영 배포 시점 실행.

**연관**: [#CL-45] (동일 정산 리팩토링의 정합 갭 묶음 — 본 #CL-44가 핵심 워크플로 복구, #CL-45가 부수 정합), `docs/specs/api/settlement-refactor-plan.md`(전체 플랜·태스크 분해).

---

## [결정 #CL-45] 정산 도메인 정합 갭 일괄 — 트랜잭션·역전이 가드·SSOT·UX (2026-05-22, 세션74)

**배경 (전수 검사 발견)**: 세션74 정산 탭 16파일 전수 검사에서 #CL-44(confirm)와 **독립된 정합 갭 다수 발견**(N1·N6~N11). #CL-44가 워크플로를 복구해도 이 갭들이 남으면 데이터 정합·회계·UX 신뢰가 깨짐. confirm과 별 축이라 분리 기록.

**핵심 규칙**:

1. **정산 write 3종 트랜잭션화(N1+N6, 치명 — 회계 경합)**: create·cancel·markAsPaid가 **전부 비트랜잭션 read→write**(confirm 배치만 트랜잭션이라 비대칭). markAsPaid 더블클릭 이중 paid(N1), createSettlement 동시 전이 시 중복확인 통과 후 2회 set 경합(N6). → 3종 트랜잭션 내 재확인 적용(B-5).
2. **cancelSettlement paid 역전이 가드(N7, 치명 — 회계 손실)**: 현 cancelSettlement는 status 무관 무조건 cancelled update → **이미 paid된 정산도 주문 취소 시 cancelled로 덮임**(지급 후 회계 불일치). #CL-44 GAP-1의 "cancelled 미덮어씀"과 **대칭으로 "paid 미덮어씀" 가드 신설**(B-6).
3. **타입 SSOT 4중→1(N3·N8)**: SettlementStatus/STATUS_LABEL/STATUS_COLOR가 백엔드·셀러·어드민·useAdmin **4곳** 정의 + 값 불일치(pending "정산 대기"/yellow vs "대기"/gray). `packages/shared`로 통합(셀러본 채택, API도 `@greenhub/shared` workspace 의존 확정 — T0). 앱별 필드 집합 불일치(셀러 Settlement가 storeId/paidAt/confirmedAt 누락)는 합집합 정의(F-1).
4. **어드민 화면 UX 정합(N10·N11)**: 어드민 합계가 status 무관 전건 합산 → cancelled/pending 포함 **지급액 과대 표시**(N11). 정산일시 컬럼 부재·정렬 방향 셀러와 반대(N10). 합계를 confirmed+paid 한정, 정산일시 표시(F-2).
5. **스테일 클레임 정정(세션72 §0)**: orders-lifecycle:144 인코딩 손상 = **사실 아님**(바이트 실측 정상, 정산 전 파일 mojibake 0건). 인코딩 태스크 불필요.

**적용 계획(세션74 확정)**: S2 = B-5+B-6(치명 정합 — confirm과 독립). S3 = B-3(SDD 분리)+B-4(status 필터+N2 hook 연결). S4 = F-1(SSOT). S5 = F-2(어드민 분리+N10·N11). N9(어드민 정산 엔드포인트 role 가드)는 S1에서 1줄 확인 흡수. 각 세션 DoD = 빌드+타입체크 통과, 검증(e2e·육안)은 S6 통합 세션 일괄.

**적용 결과(세션76 S2 구현 완료, 미커밋 — 규칙 1·2 해소)**: B-5 = 정산 write 3종 전부 `runTransaction` 적용. ① `createSettlement`([settlements.service.ts:30-57](../apps/api/src/settlements/settlements.service.ts#L30-L57)) — `get(exists)→set`을 트랜잭션으로 묶어 동시 전이 중복생성 경합 차단(N6). ② `markAsPaid`([admin.service.ts:146-170](../apps/api/src/admin/admin.service.ts#L146-L170)) — 트랜잭션 내 status 재확인 후 paid → 더블클릭 이중 paid 차단(N1). ③ `cancelSettlement`([settlements.service.ts:170-192](../apps/api/src/settlements/settlements.service.ts#L170-L192)) — 트랜잭션화 + cancelled 멱등 skip. B-6 = `cancelSettlement`에 **paid 역전이 가드** 신설 — `status==='paid'`면 cancelled 미적용·`logger.warn` 후 return(N7 회계 손실 차단). #CL-44 GAP-1 "cancelled 미덮어씀"과 대칭("paid 미덮어씀"). 결과: 정산 write 4종(create·cancel·markAsPaid·confirm 배치) **전부 트랜잭션**. **DoD: `pnpm --filter api build` 통과(타입체크 포함).** 잔여: S3(B-3·B-4).

**적용 결과(세션77 S3 구현 완료 — 규칙 5·6·9 일부 해소)**: B-3 = SDD 레이어 분리 — service.ts에서 ① 수수료 계산(`Math.floor(total×rate)`)을 `_lib/fee-calculator.ts`(`calcFee`) 순수 함수로, ② `getSummary`의 byStatus 집계 루프를 `_lib/settlement-aggregator.ts`(`aggregateSettlements`) 순수 함수로 추출(인프라/Firestore 의존 0 → 단위 테스트 용이). service 208→196행. B-4 = `QuerySettlementsDto`에 `status?`(`@IsIn(['pending','confirmed','paid','cancelled'])`) 추가 + `getSettlements`에 `status` where 절(`storeId==` 다음, `settledAt` range 앞 — 기존 `storeId+status+settledAt` 복합 인덱스 재사용, **신규 인덱스 불필요**). N2 = 셀러 [useSettlements.ts](../apps/seller/src/app/settlements/_hooks/useSettlements.ts) `fetchSettlements(f?,t?,status?)`가 status를 URLSearchParams로 전송(백엔드만 추가 시 무용 방지). `settlements.md` §2(`confirmedAt`)·§3-1(status 쿼리 파라미터)·§4-1(confirm 배치 신설)·§5(인덱스) 선설계 갱신. **DoD: `pnpm --filter api build` + 셀러 `tsc --noEmit` 통과.** 잔여: S4(F-1 SSOT)·S5(F-2)·S6(검증·기록).

**적용 결과(세션78 S4 구현 완료 — 규칙 3 해소: N3·N4·N8)**: F-1 = 상태 타입·라벨·색 SSOT **4중→1**. [packages/shared/src/settlement.types.ts](../packages/shared/src/settlement.types.ts) 신설 — `SettlementStatus`·`SETTLEMENT_STATUSES`·`STATUS_LABEL`·`STATUS_COLOR`(셀러본 채택: pending "정산 대기"/yellow)·공유 `Settlement` 인터페이스(필드 합집합 — `storeId`/`paidAt`/`confirmedAt` optional 포함, N8). `index.ts` export 추가. 통합처: ① 백엔드 [settlements.service.ts](../apps/api/src/settlements/settlements.service.ts) 로컬 `SettlementStatus` 제거 → shared import+re-export(DTO 경로 유지), ② aggregator 로컬 `SettlementStatusKey` 제거 → 공유 `SettlementStatus`+`SETTLEMENT_STATUSES`, ③ DTO 로컬 `SETTLEMENT_STATUSES` 배열 제거 → shared import, ④ 셀러 [_constants.ts](../apps/seller/src/app/settlements/_constants.ts) 로컬 정의 제거 → shared re-export(`_lib.ts`·components의 `from './_constants'` 경로 무변경 — N4 해소), ⑤ 어드민 [_client.tsx](../apps/seller/src/app/admin/settlements/_client.tsx) 로컬 `STATUS_LABEL`/`STATUS_COLOR`("대기"/gray) 제거 → shared import(셀러본 표기로 통일), ⑥ [useAdmin.ts](../apps/seller/src/hooks/useAdmin.ts) `AdminSettlement.status: string`→`SettlementStatus`·`confirmedAt?` 추가(N3). **DoD: `pnpm --filter @greenhub/shared build` + `pnpm --filter api build` + 셀러 `tsc --noEmit` 3종 통과.** 잔여: S5(F-2 어드민 분리+N10·N11)·S6(검증·기록).

**적용 결과(세션79 S5 구현 완료 — 규칙 7 해소: N10·N11)**: F-2 = 어드민 정산 화면 구조 분리. [admin/settlements/_client.tsx](../apps/seller/src/app/admin/settlements/_client.tsx) 311→92행 — `_components/{SettlementFilters,SummaryCards,SettlementTable}.tsx` + `_lib.ts`(`toDateStr`·`toKRW`·`sumPayable`) 추출(셀러 `_components/` 패턴 동형). **N10** = ① SettlementTable에 정산일시(`settledAt`) 컬럼 추가 — 어드민 표에 없던 컬럼(셀러는 보유), ② 셀러 백엔드 [settlements.service.ts](../apps/api/src/settlements/settlements.service.ts) `getSettlements` 정렬 `asc→desc`로 변경 → 어드민(`desc`)과 통일(양 화면 최신순). **N11** = `sumPayable`이 합계(`totalFee`/`totalNet`)를 `confirmed`+`paid` 정산만 집계 — 이전 status 무관 전건 합산은 pending·cancelled 포함해 지급액 과대 표시됐음(실제 지급 대상만 반영). `settlements.md` §3-1(정렬 desc 통일)·§6(어드민 화면 컴포넌트 구조·합계 기준·정산일시 컬럼) 선설계 갱신. **DoD: 셀러 `tsc --noEmit` + `pnpm --filter api build` 통과.** ⚠️ 셀러 정렬 `asc→desc` 변경은 S6 e2e/육안 회귀 확인 대상. 잔여: S6(검증·기록) — SETTLE-REFACTOR 구현 전부 완료, 검증만 남음.

**격자 재검토 결과(세션81 — S1~S5 구현 정합성 전수 확정, 코드 변경 0)**: S6 통합 검증 진입 직전, #CL-44·#CL-45 구현 6태스크(B-1~B-6·F-1·F-2) 전체를 **9개 정합성 체크포인트 × 14개 변경 파일 교차 검증**으로 재확인 — 전부 통과. ① **상태머신·역전이 가드 양방향 대칭**: create=pending→confirm배치=confirmed→markAsPaid=paid / cancel=cancelled. cancel은 `paid` 차단([settlements.service.ts:177](../apps/api/src/settlements/settlements.service.ts#L177))·confirm배치는 `status!==pending` skip([:150](../apps/api/src/settlements/settlements.service.ts#L150))·markAsPaid는 `confirmed`만 통과(pending 직행 차단)·이미 paid 거부([admin.service.ts:156-161](../apps/api/src/admin/admin.service.ts#L156-L161)). ② **트랜잭션 4종**: create·cancel·confirm배치 + markAsPaid([admin.service.ts:151](../apps/api/src/admin/admin.service.ts#L151)) 전부 runTransaction 내 재확인, 비트랜잭션 write 0. ③ **타입 SSOT 1곳**: Grep 전수 — 정산 SettlementStatus/STATUS_LABEL/STATUS_COLOR는 [settlement.types.ts](../packages/shared/src/settlement.types.ts) 단 1곳(나머지 grep 히트는 전부 Order 상태용·무관). ④ **백/프론트 연결**: [useSettlements.ts:87](../apps/seller/src/app/settlements/_hooks/useSettlements.ts#L87) status→[service.ts:76](../apps/api/src/settlements/settlements.service.ts#L76) where 실연결(N2)·sumPayable confirmed+paid 한정(N11). ⑤ **정렬 desc 통일**: 셀러[service.ts:90]·어드민[admin.service.ts:137] 양쪽 desc(N10)(⚠️셀러 desc 육안만 잔여=선결②). ⑥ **SDD 분리**: fee-calculator·settlement-aggregator 순수함수, service는 인프라/인증만. ⑦ **라인≤500**: 14파일 전부 통과(최대 useAdmin 323·admin.service 231·settlements.service 173). ⑧ **인덱스**: status+settledAt 라이브 배포됨(선결① 세션80). ⑨ **빌드**: `pnpm --filter @greenhub/shared build`·`pnpm --filter api build`·셀러 `tsc --noEmit` 전부 에러 0. **결론: A-1 단절(pending 고착→지급 버튼 미표시)의 양끝(confirm 배치 pending→confirmed / 어드민 버튼 `status==='confirmed'` 노출)이 코드로 맞물림 확정.** 잔여 = S6 런타임 검증(e2e·육안·선결②·T-기록)뿐.

**S6 통합 검증 결과(세션82 — 자동 검증분 완료·런타임 검증 사용자 위임)**: SETTLE-REFACTOR 최종 게이트. ① **빌드 3종 통과**: `pnpm --filter @greenhub/shared build`·`pnpm --filter api build`·셀러 `tsc --noEmit` 전부 에러 0(S6 진입 재확인). ② **e2e 회귀 0건**: 라이브 preview(최신 main `185ae79` 반영, sync-preview→e2e 자동 디스패치 run `26297450405`) 풀런 **176 passed / 0 failed / 13 skipped**. `seller-settlements.spec.ts`는 비인증 1 + 인증 7 = chromium·mobile 전 케이스 통과 — **S5 셀러 정렬 `asc→desc` 변경(N10)에도 회귀 0**(spec이 순서를 단언하지 않아 예상대로 통과 → 선결② e2e 측면 통과, 육안만 잔여). ③ **육안 검증 문서화**: `seller-refactor-visual-verify.md` E 섹션(E-T1 셀러·E-T2 어드민·E-T3 전이 입증, 연번 211~223) 신설 — 사용자 직접 검증용. **④ 전이 입증 = 라이브 스크립트로 즉시 완료(세션82)**: 라이브 배치(@Cron 04:00 KST) 자연 대기 대신 `scripts/verify-settlement-transition.mjs`가 `confirmDueSettlements`·`markAsPaid` **실제 코드 로직을 그대로 재현**해 라이브 `green-e4fe3` Firestore에서 전 구간 즉시 입증 — **10 passed / 0 failed**. ① pending 시드(settledAt 2일 전) → ② 역전이 가드(pending에 markAsPaid → `NOT_CONFIRMED` 거부) → ③ confirm 배치 로직(pending→confirmed, confirmedAt 기록) → ④ markAsPaid(confirmed→paid, paidAt 기록) → ⑤ 멱등 가드(이미 paid → `ALREADY_PAID` 거부) → ⑥ 정리(격리 단일 문서 `verify-settle-001` 삭제, 실데이터 무관). **A-1 단절(pending 고착→지급 불가) 라이브 해소 입증 완료.** `status+settledAt` 복합 쿼리가 에러 없이 실행돼 선결① 인덱스 라이브 동작도 부수 입증(FAILED_PRECONDITION 0). **사용자 위임 잔여 = 프론트 화면 육안만**: (a) 셀러·어드민 화면 라벨/색/정렬 desc(E-T1·E-T2), (b) 어드민 "지급처리" 버튼이 confirmed 행에만 노출(E-T3 #221). 다음 04:00 라이브 배치는 동일 로직이라 추가 입증 불필요. **결론: S6 백엔드 전이·빌드·e2e·문서 전부 종결, 프론트 화면 육안만 사용자 확인 대기.**

**연관**: [#CL-44] (confirm 배치 — 본 #CL-45가 그 부수 정합 갭 묶음), `docs/specs/api/settlement-refactor-plan.md §2.7`(전수 검사 N1~N11 실측), `docs/specs/frontend/seller-refactor-visual-verify.md` E 섹션(육안 검증 211~223).

---

## [#CL-46] 정산 목록 desc 인덱스 부재 — S5 정렬 전환의 인덱스 미반영 (라이브 500 결함)

**발견(세션83 M-PATH M4 육안 검증)**: 셀러 정산 탭 [주문별 상세] 및 어드민 정산 목록이 **라이브에서 500(FAILED_PRECONDITION) 에러**로 빈 화면. 원인 — S5(세션79 N10)에서 정산 정렬을 `settledAt` **asc→desc**로 통일했으나([settlements.service.ts:90](../apps/api/src/settlements/settlements.service.ts#L90), [admin.service.ts:137](../apps/api/src/admin/admin.service.ts#L137)), `firestore.indexes.json`의 settlements 복합 인덱스는 **전부 `settledAt ASCENDING`** 으로만 존재 → `where(storeId==) + orderBy(settledAt desc)` 및 `+where(status==)` 쿼리가 매칭 인덱스 없어 실패. admin SDK 재현 시 에러 메시지 `The query requires an index` + 인덱스 생성 URL 동반(원인 100% 확정).

**왜 못 잡았나(#CL-45 격자 재검토의 모순 누락)**: 세션81 격자 재검토 ⑤항은 "정렬 desc 통일(셀러·어드민 양쪽 desc)"을 확인했고, ⑧항은 "인덱스 status+settledAt 라이브 배포됨(선결①)"이라 적었으나 — **그 인덱스는 ASC였다.** ⑤(desc 쿼리)와 ⑧(asc 인덱스)이 상호 모순인데 교차검증이 방향(order)까지 대조하지 않아 통과로 오판. 세션82 e2e 풀런(176/0)도 통과했는데, preview 환경에 우연히 해당 인덱스가 (다른 경로로) 존재했거나 e2e 시드 정산 부재로 빈 쿼리가 인덱스 없이도 통과한 것으로 추정(미확정). **교훈: 복합 인덱스 검증은 fieldPath뿐 아니라 order(ASC/DESC)까지 쿼리와 1:1 대조해야 한다.**

**조치(세션83)**: `firestore.indexes.json`에 desc 복합 인덱스 3종 추가 후 `firebase deploy --only firestore:indexes` 배포 — ① `storeId ASC, settledAt DESC`(셀러 목록·어드민 storeId) ② `storeId ASC, status ASC, settledAt DESC`(status 필터) ③ `status ASC, settledAt DESC`(대칭 보강). 검증: `scripts/test-settlement-query.mjs`로 동일 쿼리 admin SDK 실행 → 빌드 완료 후 정상 반환 확인.

**연관**: [#CL-45] ⑤·⑧항(모순 누락 지점), `firestore.indexes.json`(settlements desc 3종), `scripts/test-settlement-query.mjs`(재현·검증), `seller-refactor-visual-verify.md` M4 #243.

---

## [#CL-47] 정산일시 "Invalid Date" — TimestampInterceptor(ISO) vs 화면(`_seconds`) 직렬화 불일치

**발견(세션83 M-PATH M4, #CL-46 인덱스 해소 직후)**: 정산 목록(셀러 [주문별 상세]·어드민)이 뜨자 모든 행의 정산일시가 **"Invalid Date"**(셀러) / **"-"**(어드민)로 표시. 원인 — API 전역 `TimestampInterceptor`([apps/api/src/common/interceptors/timestamp.interceptor.ts:24](../apps/api/src/common/interceptors/timestamp.interceptor.ts#L24))가 모든 Firestore Timestamp를 **`toDate().toISOString()` ISO 문자열**로 변환해 응답하는데, 화면 코드는 **`settledAt._seconds`(객체)** 를 가정 → `undefined` → `new Date(undefined*1000)=Invalid Date`(셀러 [SettlementListItem.tsx](../apps/seller/src/app/settlements/_components/SettlementListItem.tsx)), 어드민은 `'_seconds' in ts` false라 `'-'` 반환([admin/settlements/_lib.ts](../apps/seller/src/app/admin/settlements/_lib.ts)).

**왜 못 잡았나**: 셀러 `Settlement` 타입([settlements/_constants.ts:15](../apps/seller/src/app/settlements/_constants.ts#L15))이 `settledAt: { _seconds: number }`로 **실제 응답(ISO 문자열)과 다르게 정의**돼 있었고, TS는 타입 정의를 신뢰하므로 컴파일 통과. e2e도 정산일시 텍스트값 단언이 없어 미검출. shared `Settlement.settledAt`은 `unknown`(직렬화 경로별 차이 허용 주석 있음)이라 셀러/어드민 로컬 타입에서 잘못 좁힌 게 근인.

**조치(세션83)**: 양 화면 `toDateStr`을 **ISO 문자열·`{_seconds}`·number 모두 방어적 파싱**(불가 시 '-')으로 통일. 셀러 `_constants.ts` 타입을 `string | { _seconds: number }`로 정정, `SettlementListItem`은 `s.settledAt`(통째) 전달, CSV는 `toISO` 헬퍼 신설. 셀러 `tsc --noEmit` 통과. **배포 필요**(운영=main 동기).

**연관**: [#CL-46](같은 정산 목록 화면 — 인덱스 해소 후 드러난 2차 결함), `apps/api/.../timestamp.interceptor.ts`(ISO 변환 출처), `seller-refactor-visual-verify.md` M4 #243.

---

## [#CL-48] `toISOString()` 날짜 추출 KST 미보정 — 자정~오전9시 하루 밀림

**발견(세션83 M-PATH M5)**: 사용자가 KST 5/24 00:52(자정 직후) 배송 슬롯 캘린더에서 **5/23이 "오늘"로 표시·과거 차단 오작동**. 원인 — `new Date().toISOString()`은 **UTC 기준**이라 KST(UTC+9)의 **00:00~08:59**에는 `split('T')[0]`/`slice(0,10)` 추출 날짜가 **전날**로 밀림.

**영향(세션84 실측, 전수 일치)**: 셀러 src 전역 `toISOString` 날짜추출 5곳 중 미보정 3곳 — ① [daily-caps/page.tsx:134](../apps/seller/src/app/settings/daily-caps/page.tsx#L134) `todayStr`(캘린더 isToday/isPast 직접 오판) ② [useSettlements.ts:36](../apps/seller/src/app/settlements/_hooks/useSettlements.ts#L36)(일별요약 기본일) ③ [useDashboardSummary.ts:30](../apps/seller/src/hooks/useDashboardSummary.ts#L30)(홈 정산예정일). 보정됨 2곳은 [orders/[id]/_lib.ts:18~20](../apps/seller/src/app/orders/[id]/_lib.ts#L18)(라인18 `+9h`, 정상 패턴·결함 아님).

**결정(세션84)**:
1. **공통 util `todayKST()`/`toDateStrKST()`를 `@greenhub/shared`에 신설**(`packages/shared/src/date.ts`) — 사용자 결정. shared가 '타입 전용'→'런타임 함수 포함'으로 성격 확장(dual ESM/CJS 빌드 검증 필수). SSOT 원칙 우선.
2. 미보정 3곳 교체 + 정상 패턴 `_lib.ts` 인라인도 util로 흡수(중복 제거). **`daily-caps:53~55` `now`/`year`/`month`는 로컬시간(=KST) 기준이라 불변** — 라인134 추출만 교체.
3. **테스트 인프라 부재(셀러·shared `.test.ts` 0건) 확인** → `packages/shared`에 **vitest 신설**(프로젝트 첫 유닛테스트), `vi.setSystemTime`으로 KST 경계(UTC 15:00=KST 자정) 회귀 가드.

**플랜**: [timezone-kst-fix-plan.md](specs/frontend/timezone-kst-fix-plan.md) T1~T6 + 정합성 검토 §5-1(구현 전 완료).

**구현 완료(세션85)**: T1~T6 전부 완료. ① [date.ts](../packages/shared/src/date.ts) 신설 + index.ts export — dual ESM/CJS 빌드 검증(CJS require·ESM import 양쪽 해소). ② 미보정 3곳 `todayKST()` 치환. ③ `_lib.ts` 인라인 흡수(`todayKST()`+`toDateStrKST()`) — **신·구 수식 동등성 노드 실측(KST 자정 경계 today/tomorrow 일치)으로 ISO/라벨 불변 가드(C3)**. ④ **vitest 신설**([date.test.ts](../packages/shared/src/date.test.ts) 5케이스 통과, `vi.setSystemTime`으로 UTC 14:59→전날·15:30→당일 경계 가드) — 프로젝트 첫 유닛테스트. 정합성 C1~C7 전부 통과: 셀러 `tsc --noEmit` exit 0, biome 신규 0(기존 `<img>` 경고 2건 무관), 셀러 src KST 미보정 잔존 grep 0건. tsconfig(esm/cjs)에 `*.test.ts` exclude 추가로 빌드 산출물 미오염.

**통합 로직 재현 검증(세션85, 라이브 육안 대체)**: daily-caps `isToday=date===todayStr`·`isPast=date<todayStr` 추적 — 캘린더 셀 `date`는 `buildCalendar`가 `${year}-${mm}-${dd}` 제로패딩 `YYYY-MM-DD`로 생성(year/month는 로컬=KST), `todayStr`도 동일 포맷 → 사전식 비교가 날짜 비교로 성립. **KST 2026-05-24 00:30(원 결함 시점) 노드 시뮬레이션**: 수정 전 `todayStr=2026-05-23`(어제가 "오늘"로 강조·세션83 증상 일치) → 수정 후 `todayStr=2026-05-24`(5/24 isToday=true·isPast=false 입력가능, 5/23 isPast=true 차단). **결함 증상이 코드 경로 그대로 재현·해소 입증** — 라이브 자정 육안 불요 판정.

**연관**: [#CL-46]·[#CL-47](같은 세션83 M-PATH 발견 라이브 결함 계열), BACKLOG `[타임존-UTC]`.

---

## [#CL-49] BACKLOG 잔여 4건 정합성 검토 — BUG-16 stale 판정 + 3건 아토믹 플랜 수립 (2026-05-25, 세션86)

**배경**: 사용자가 BACKLOG 잔여 4건([BUG-16]·[정산-status필터UI]·[어드민-반응형]·[UI-버튼크기])을 각 독립 세션 아토믹 태스크로 분해 요청. 착수 전 4건 전수 코드 실측.

**핵심 발견 — 백로그 stale 2건(코드 변경 없이 표기 정정)**:
1. **[BUG-16] 택배 주문 상태 갭 = 이미 완료(세션67 `2ad71e3`)**. §1-3에 `[ ]`로 잔존했으나 실측상 셀러([orders/[id]/page.tsx:94](../apps/seller/src/app/orders/[id]/page.tsx#L94) `canShipParcel`·[:187](../apps/seller/src/app/orders/[id]/page.tsx#L187) 버튼·[useOrderDetailActions.ts:54](../apps/seller/src/app/orders/[id]/_hooks/useOrderDetailActions.ts#L54) "BUG-16 T3")·드라이버([board/_client.tsx:43](../apps/driver/src/app/board/_client.tsx#L43) `where('deliveryMethod','in',['direct','hub'])` "BUG-16 T4") **양쪽 모두 구현됨**. §3 P3 라인500에 종결 기록(e2e 176p/0f) 존재 — §1-3 `[ ]`만 stale. **사용자 결정: stale 정정만**(재검증 불요).
2. **[#CL-48 타임존] = 세션85 종결**인데 §1-1 `[ ]` 잔존 → `[x]` 정정.

**실착수 유효 3건(실측으로 결함·레퍼런스 확정)**:
- **[정산-status필터UI]**: hook([useSettlements.ts:29·88](../apps/seller/src/app/settlements/_hooks/useSettlements.ts#L29))·백엔드는 status 지원, [OrdersTab.tsx](../apps/seller/src/app/settlements/_components/OrdersTab.tsx) UI만 부재 확정. 이식 레퍼런스=주문 탭 공통 `SegmentedTabs<T>`([orders/page.tsx:173](../apps/seller/src/app/orders/page.tsx#L173)), 상태 SSOT=`SETTLEMENT_STATUSES`/`STATUS_LABEL`([settlement.types.ts:13](../packages/shared/src/settlement.types.ts#L13)). 규모 소~중, 리스크 낮음.
- **[어드민-반응형]**: 어드민 `<table>` 5곳(settlements·orders·stores·invite·users) 모두 `overflowX` 래퍼 없음 확정. 정산 7컬럼 마지막 상태·지급처리버튼 모바일 잘림([SettlementTable.tsx:48·134](../apps/seller/src/app/admin/settlements/_components/SettlementTable.tsx#L48)). 카드형 vs 가로스크롤 A/B/C는 착수 시 확정. 규모 중~대(Phase 분할), 로드맵 §3 어드민 트랙 진입점.
- **[UI-버튼크기]**: 카드 `sm/md`([OrderCard.tsx:78](../apps/seller/src/app/orders/_components/OrderCard.tsx#L78)) vs 상세 footer `lg/xl`([orders/[id]/page.tsx:165](../apps/seller/src/app/orders/[id]/page.tsx#L165)) 2단계 차 확정. **버그 아닌 위계 설계 판단** — A(의도된 위계, 변경0) / B(단일화, footer `lg→md` 한 단계) 착수 전 사용자 확정 필수. 규모 소.

**산출물(세션86, 코드 변경 0 — 문서만)**: 플랜 3종 신설 — [settlement-status-filter-plan.md](specs/frontend/settlement-status-filter-plan.md)·[admin-responsive-plan.md](specs/frontend/admin-responsive-plan.md)·[button-size-unify-plan.md](specs/frontend/button-size-unify-plan.md). 각 아토믹 태스크 + 정합성 체크포인트 포함. BACKLOG 4건 모두 링크·표기 정정.

**연관**: BUG-16 종결=[#CL-40], 타임존=[#CL-48], 어드민 트랙=`app-refactor-roadmap.md` §3.

---

## [#CL-50] [UI-버튼크기] 단일화 — B(괴리 완화) 확정, footer `lg→md` 한 단계 (2026-05-25, 세션87)

**배경**: [#CL-49]에서 수립한 [button-size-unify-plan.md](specs/frontend/button-size-unify-plan.md)의 §2 A/B 설계 판단을 착수 도입부에 사용자에게 제시 → **B(단일화) 확정**. "준비 시작" 동일 액션이 목록 카드 `sm`과 상세 footer `lg`로 2단계 차여서 카드→상세 이동 시 시각 괴리.

**핵심 규칙(시각 회귀 정책)**:
1. **한 축만 변경** — footer 3버튼(준비 시작·택배 발송 완료·강제 취소)을 `size="lg"`→`size="md"` 한 단계만 하향. `radius="xl"`·`fullWidth`는 **유지**(두 축 동시 변경 시 회귀 추적 곤란, 터치 타깃 보존).
2. **카드 `sm` 유지** — 목록 밀도상 카드를 올리지 않음. 결과적으로 2단계→1단계 차로 괴리 완화(완전 동일화 아님 — 위계는 보존).
3. **부수 정합(설계 근거 강화)**: footer `md`가 [PrepareForm.tsx:80·89](../apps/seller/src/app/orders/[id]/_components/PrepareForm.tsx#L80)의 폼 버튼(이미 `md`/`xl`)과 일치 → 준비 시작 → 폼 진입 시 크기 점프도 함께 해소. `radius="xl"` 유지 판단도 PrepareForm과 일치해 정합.

**구현(세션87, 파일 1개 — 로직·API 불변)**: [orders/[id]/page.tsx:165·180·195](../apps/seller/src/app/orders/[id]/page.tsx#L165) footer 3버튼 `lg→md`. 정합성 C1~C5 전부 통과: A/B 확정(C1)·footer 3버튼 동일 size(C2, orders 내 `size="lg"` 잔존 grep 0)·한 단계·토큰 불변(C3)·풀폭 유지(C4)·`tsc --noEmit` exit0·biome 신규0·`npm run build`(`--webpack`) exit0(C5).

**빌드 주의**: 셀러는 `npm run build`(=`next build --webpack`)로 실행. 맨 `npx next build`는 Next16 Turbopack/webpack config 충돌로 실패(코드 무관).

**잔여**: 육안 검증 1건(카드→상세 크기 점프 완화) — 정산 status 필터 육안과 일괄 진행 정책. 통합 문서 [pending-visual-verify.md](specs/frontend/pending-visual-verify.md) §1-B에 항목 합류.

**연관**: 선행 정합성 검토=[#CL-49], 플랜=button-size-unify-plan.md, 다음 작업=어드민 반응형(`app-refactor-roadmap.md` §3).

---

## [#CL-51] [어드민-반응형] 5개 테이블 모바일 카드형 전환 — C-full 확정, `hiddenFrom`/`visibleFrom` 분기 도입 (2026-05-25, 세션88)

**배경**: [#CL-49]에서 수립한 [admin-responsive-plan.md](specs/frontend/admin-responsive-plan.md)의 §2 A(가로스크롤)/B(카드형)/C(하이브리드) 설계 판단을 착수 도입부에 제시. 어드민 콘솔(`apps/seller/src/app/admin`) 5개 테이블(settlements·orders·stores·invite·users)이 데스크톱 `<table>` 그대로라, 모바일 폭에서 마지막 컬럼(상태·지급처리/강제환불/정지·복구/수수료설정 버튼)이 잘리고 부모 `Paper`가 `overflow:hidden`이라 가로 스크롤도 불가 → 어드민이 모바일에서 핵심 액션 버튼에 접근 불가(#246/247).

**설계 결정**:
1. **C-full(5곳 전부 카드형) 사용자 확정** — A(가로스크롤)·C(정산만 카드)보다 가독성 최상. 5개 테이블 모두 모바일 카드 분기 적용.
2. **breakpoint = `sm`(768px) 사용자 확정** — 폰=카드, 태블릿·데스크톱=테이블. 어드민 콘솔 특성상 태블릿+에서는 테이블 가독성이 우위.
3. **분기 방식 = Mantine `hiddenFrom`/`visibleFrom` prop** — 셀러 앱 최초 반응형 분기 도입(기존 코드에 `useMediaQuery`·`@media`·`hiddenFrom` 전무 확인). prop 방식 채택 근거: SSR 안전(하이드레이션 미스매치 없음)·JS 불필요·데스크톱 회귀 리스크 최소. 모바일 카드=`<Stack hiddenFrom="sm">`, 데스크톱 테이블=`<Paper visibleFrom="sm">`로 기존 `<table>`을 감싸기만 함(테이블 DOM·스타일 완전 불변).

**핵심 규칙(시각 회귀 0 정책)**:
- 데스크톱 `<table>`은 `visibleFrom="sm"` Paper로 **감싸기만** — 내부 thead/tbody/td DOM·스타일 일절 미수정(C3 회귀 0 보장).
- 카드는 셀러 [SettlementListItem.tsx](../apps/seller/src/app/settlements/_components/SettlementListItem.tsx)(`Paper`+`Group justify="space-between"`+`Stack`) 패턴 재사용.
- Badge/라벨은 SSOT 재사용 — 정산=`STATUS_LABEL`/`STATUS_COLOR`(@greenhub/shared), 나머지는 각 파일 로컬 맵 그대로(기존 테이블과 동일 소스).
- **로직 불변** — hook(`useAdmin*`)·API·액션 핸들러(`onPay`/`forceRefund`/`toggleSuspend`/`setCommission`) 미수정.

**중복 제거**: stores는 수수료 표시/편집(`renderRate`)·설정 진입(`renderSetButton`)을 컴포넌트 내부 헬퍼로 추출해 테이블·카드 공용(편집 폼 중복 방지).

**구현(세션88, 파일 5개)**: [SettlementTable.tsx](../apps/seller/src/app/admin/settlements/_components/SettlementTable.tsx)·[orders/_client.tsx](../apps/seller/src/app/admin/orders/_client.tsx)·[stores/_client.tsx](../apps/seller/src/app/admin/stores/_client.tsx)·[invite/_client.tsx](../apps/seller/src/app/admin/invite/_client.tsx)·[users/_client.tsx](../apps/seller/src/app/admin/users/_client.tsx). 정합성 C1~C6 전부 통과: 모바일 지급처리 버튼 접근(C1)·5테이블 전수 카드 분기(C2)·데스크톱 테이블 DOM 불변(C3)·SSOT·셀러 카드 패턴 재사용(C4)·`tsc`0·biome 0·`npm run build` exit0·인라인 hex/fontSize 위반 0(C5)·전 파일 500라인 한도 내(최대 309, C6).

**e2e**: 미실행. 어드민 전용 e2e 부재(`*admin*.spec.ts` 0건) + 변경이 순수 표현 레이어(로직·DOM 데스크톱 불변)라 e2e 회귀 대상 없음. 본 검증=모바일 폭 카드 육안(운영 단일 DB·카카오 로그인·DevTools/실기기 PWA — 사용자 위임).

**잔여**: 모바일 폭 카드 레이아웃 육안 검증(5개 화면). 데스크톱 회귀는 DOM 불변이라 안전.

**연관**: 선행 정합성 검토=[#CL-49], 플랜=admin-responsive-plan.md, 로드맵=`app-refactor-roadmap.md` §3 어드민 트랙. 다음=어드민 반응형 잔여(헤더/필터 등) 또는 소비자앱 리팩토링.

---

## [#CL-52] 겸직 계정(admin+seller) 역할 분리 — "어드민=store 없음" 전제 무효화 해소 (2026-05-25, 세션89)

**배경**: 셀러앱 설정 탭 "사업자 프로필 수정"([settings/page.tsx:68](../apps/seller/src/app/settings/page.tsx#L68), `href="/onboarding"`) 클릭 시 어드민 계정은 프로필 수정 화면 대신 `/admin/stores`로 튕김. 사용자는 어드민이면서 동시에 디어 오키드 store의 판매자인 **겸직 계정**(`role==='admin'` + `storeId` 보유).

**근본 원인 — 깨진 전제**: 커밋 `63e56c2`(2026-04-07) "fix: seller proxy — admin role onboarding 리다이렉트 제외"가 **"admin은 storeId 없이 정상 운영되므로"**라는 전제로 [proxy.ts](../apps/seller/src/proxy.ts)에 `isAdmin && pathname==='/onboarding' → /admin/stores` 분기를 추가. 당시엔 참이었으나, 겸직 계정 등장으로 전제 무효화. 데이터 모델은 이미 겸직 지원(role·storeId 독립 필드, [auth.ts:67-68](../apps/seller/src/auth.ts#L67-L68)) — 문제는 가드·UI가 `isAdmin` 단일 boolean으로만 분기하는 점.

**설계 결정 — 방향 A(전제 보정) 채택, 방향 B(모드 전환 상태) 기각 (사용자 확정)**:
- **A=전제 보정+양방향 문**: 가드가 `role`+`storeId`를 함께 보게 하고, 두 영역(`/admin/*` ↔ 셀러 화면)에 링크 추가. **별도 "모드 상태" 없음 — URL 네임스페이스가 곧 모드.**
- **B=전환 설계 기각 근거**: ① `/admin/*`와 셀러 화면은 이미 독립 레이아웃·가드로 물리 분리 = URL이 이미 모드 신호. ② 부족한 건 "상태"가 아니라 "문(門)"(링크)일 뿐. ③ 겸직 계정 현재 사실상 1명·저빈도 전환(YAGNI). ④ A→B 확장은 쉬우나 역행은 어려움.
- **겸직 판정 SSOT**: `role==='admin' && !!storeId`. 로그인 수단(카카오/이메일) 무관 — 역할 조합으로만 판정(특정 계정 하드코딩 금지, 확장성·기존 권한판정 일관성).

**구현 범위(3변경)**:
1. [proxy.ts:22](../apps/seller/src/proxy.ts#L22) 가드 보정 — `isAdmin && !storeId && pathname==='/onboarding'`로 조건 강화(겸직은 `/onboarding` 정상 허용, 순수 어드민만 콘솔로).
2. 셀러→어드민 문 — 설정 탭에 "관리자 콘솔" 행 추가, 겸직(`role==='admin' && storeId`)일 때만 노출.
3. 어드민→셀러 문 — [admin/layout.tsx](../apps/seller/src/app/admin/layout.tsx) 헤더에 "셀러 화면으로" 링크, 겸직일 때만 노출.

**정합성 체크포인트**: C1 겸직 `/onboarding` 진입·프로필 수정 정상 / C2 순수 어드민은 기존대로 콘솔 귀결(회귀0) / C3 일반 셀러 무영향(링크 미노출) / C4 tsc0·biome0·build0 / C5 500라인 한도.

**커밋·배포(세션89)**: 커밋 `2d30296` main push → Vercel 운영 배포. **운영 육안 1차 통과** — `seller.greenlove.co.kr/settings`에서 겸직 계정(정연, kakaoId 4827841177)에 "관리자" 섹션 + "관리자 콘솔로 이동" 행 정상 노출(§3 #44). **데이터 진단 확정**: 운영 admin 계정은 정연 1명, 연결 store는 "디어 오키드"가 아니라 **난플렉스**(`80189070-...`) — "디어 오키드"는 onboarding placeholder 예시였을 뿐. 백엔드 체인(`kakaoLogin`→`sanitizeUser` storeId 전달) 정상 확인.

**보안 방어선 검증(사용자 질의 — 일반 셀러가 링크로 어드민 침투 가능?)**: **불가. 이번 변경의 보안 영향 0.** 추가물은 `<a href>` 링크 한 줄(UI 편의)일 뿐, 권한 판정은 백엔드가 담당. 방어 4겹 확인 — ① UI 노출 게이팅(`isDualRole`, 보안 아님) ② 프론트 서버가드 [admin/layout.tsx:8](../apps/seller/src/app/admin/layout.tsx#L8) `role!=='admin'→redirect('/orders')` ③ **API 가드 [admin.controller.ts:18-20](../apps/api/src/admin/admin.controller.ts#L18-L20) 클래스 전체 `@UseGuards(JwtAuthGuard,RolesGuard)`+`@Roles('admin')` → 셀러 토큰 403** ④ JWT 서명 [jwt.strategy.ts:13](../apps/api/src/auth/strategies/jwt.strategy.ts#L13) `JWT_SECRET` 검증·role은 [auth.service.ts:319](../apps/api/src/auth/auth.service.ts#L319) Firestore 실제 문서에서 주입(클라 위조 시 서명 깨져 401). 셀러가 `/admin/*` 주소 직접 입력해도 ②에서 redirect, 우회해도 ③에서 데이터 0(403). **권장(미실행, 사용자 충분 판단)**: 셀러 JWT→admin 컨트롤러 403 백엔드 단위테스트(첫 어드민 보안 테스트) — 카카오 storageState 부재로 e2e보다 단위테스트가 현실적.

**연관**: 원인 커밋=`63e56c2`. 커밋=`2d30296`. 육안 검증=`pending-visual-verify.md` §3(42~52). 잔여 육안=#42 프로필 폼 진입·#46~47 어드민→셀러 링크.

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

## 2026-05-29 — CL-56 택배 발송 완료 전 운송장 필수화

- **결정**: 판매자 주문 상세에서 택배 주문을 `PREPARING → DELIVERED`로 전환할 때 `courierCompany`와 `trackingNumber`를 필수로 저장한다.
- **이유**: 운송장 없이 배송 완료 처리되면 소비자가 추적 정보를 확인할 수 없고, CS가 판매자 화면 밖에서 발생한다.
- **검증 경계**: 프론트 모달은 입력 누락을 막고, API는 동일 필수값을 재검증해 직접 호출 우회를 차단한다.
- **범위**: 이번 차수는 단일 운송장만 지원한다. 배송조회 링크, 실시간 택배 상태 연동, 분할 배송은 별도 SDD로 남긴다.

## 2026-05-29 — CL-57 어드민 주문 목록 송장 표시

- **결정**: `/admin/orders`는 주문 문서의 `courierCompany`와 `trackingNumber`를 별도 조회 없이 목록에 표시한다.
- **이유**: 셀러 송장 필수화 이후 운영자가 소비자 CS를 처리할 때 어드민 주문 목록에서 바로 송장을 확인해야 한다.
- **범위**: 이번 차수는 읽기 전용 표시만 수행한다. 송장 사후 수정과 배송조회 링크는 별도 SDD로 남긴다.

## 2026-05-29 — CL-58 판매자 주문 우선 알림 배너

- **결정**: `/orders`는 처리 필요 주문과 배송 예정일이 지난 활성 주문을 화면 내 우선 알림 배너로 먼저 노출한다.
- **이유**: 푸시 알림 범위는 아직 미확정이지만, 사장님이 화면에 진입했을 때 새 주문과 지연 주문을 탭 배지만으로 놓치는 문제는 즉시 줄일 수 있다.
- **범위**: 이번 차수는 화면 내 배너와 탭 이동만 수행한다. 브라우저 푸시, 문자·카카오 알림, 읽음 상태 저장은 별도 SDD로 남긴다.
- **보강**: 공동구매 지연 판단에 필요한 `groupProductConfig` 조인은 현재 탭이 아니라 공구 전체 주문의 `productId`를 대상으로 한다. 그래야 현재 탭 밖의 지연 주문도 배너 건수와 이동 대상에 포함된다.

## 2026-05-29 — CL-59 판매자 주문 일괄 준비 시작

- **결정**: 여러 주문 일괄 처리의 1차 범위는 `ACCEPTED`·`CONFIRMED` 주문을 `PREPARING`으로 바꾸는 일괄 준비 시작만 허용한다.
- **이유**: 택배 발송은 주문별 운송장번호가 필요해 일괄 입력 UX와 검증 정책이 별도로 필요하다. 준비 시작은 송장번호와 충돌하지 않아 즉시 클릭 수를 줄일 수 있다.
- **검증 경계**: 프론트는 선택·확인·주문별 요청 오케스트레이션만 담당하고, 상태 전이 비즈니스 규칙은 기존 단건 API가 계속 검증한다.
- **범위**: 백엔드 일괄 API, 일괄 택배 발송, 준비 시간 일괄 입력은 별도 SDD로 남긴다.
# 2026-05-29 — SELLER-ORDERS-BULK-PARCEL-01

## 결정
**셀러 주문 목록의 택배 발송 일괄 처리는 백엔드 일괄 API 없이, `PREPARING`·`parcel` 주문만 선택해 주문별 택배사와 운송장번호를 입력한 뒤 기존 단건 상태 변경 API를 반복 호출한다.**

## 이유
- 송장번호는 주문마다 다르므로 `준비 시작`처럼 단일 확인 모달로 처리할 수 없다.
- 기존 `PATCH /stores/:storeId/orders/:orderId/status`에는 택배 주문의 `PREPARING → DELIVERED` 필수값 가드가 이미 있어 비즈니스 규칙을 중복하지 않아도 된다.
- 현재 운영 규모에서는 백엔드 일괄 API보다 프론트 오케스트레이션이 범위와 위험이 작고, 부분 실패 처리는 기존 일괄 준비 시작 UX와 같은 방식으로 흡수할 수 있다.

## 범위
- 포함: `대기 중` 탭의 `PREPARING` 택배 주문 선택, 주문별 송장 입력 모달, 성공 건 선택 해제, 부분 실패 알림.
- 제외: CSV 업로드, 바코드 스캔, 택배사별 상세 자릿수 검증, 백엔드 일괄 API, 송장 사후 수정.

---

## 2026-05-29 — CL-60 어드민 주문 상세 1차 모달

**결정**: `/admin/orders`의 주문 상세 드릴다운은 1차에서 새 상세 API와 라우트를 만들지 않고, 기존 목록 응답에 포함된 주문 필드를 읽기 전용 Mantine 모달로 표시한다.

**이유**: 운영자가 CS 중 주문번호·상태·배송지·송장·구매자 정보를 한 화면에서 확인해야 하지만, 상품 라인·결제 타임라인·상태 이력까지 포함한 정식 상세 조회는 별도 API와 페이지네이션 설계가 필요하다. 따라서 목록 응답 기반 1차 모달로 운영 통증을 먼저 줄이고, 큰 조회 계약은 별도 SDD로 남긴다.

**범위**: 포함은 데스크톱 행 상세 아이콘, 모바일 카드 상세 버튼, 읽기 전용 상세 모달이다. 제외는 상세 라우트, 주문 상세 조회 API, 송장 사후 수정, 결제·상태 이력 타임라인이다.

---

## 2026-05-29 — CL-61 어드민 주문 정렬·커서 페이지네이션

**결정**: `/admin/orders` 목록은 `createdAt` 기준 `최신순/오래된순`과 `limit/cursor` 기반 `더 보기` 페이지네이션을 제공한다.

**이유**: 기존 `limit(200)` 고정 조회는 운영 주문이 200건을 넘으면 뒤쪽 주문이 누락된다. 다만 정확한 전체 카운트와 offset 페이지 번호는 Firestore 비용과 일관성 리스크가 크므로, 현재 운영 흐름에는 cursor 연속 탐색이 더 작고 안전하다.

**범위**: 포함은 API DTO 검증, `nextCursor` 응답, 프론트 정렬·페이지 크기 Select, `더 보기` 버튼이다. 제외는 임의 페이지 번호, 이전 페이지, `createdAt` 외 컬럼 정렬, 정확한 총 건수 계산이다.

---

## 2026-05-29 — CL-62 어드민 초대 내역 S-A 보기 개선

**결정**: `/admin/invite` 발급 내역은 행별 복사 버튼과 `발급일`·`사용일`을 함께 표시하고, 일시 포맷은 shared `toDateTimeStrKST()`(`MM-DD HH:mm`)로 통일한다.

**이유**: 운영자가 “이 토큰 왜 안 돼요?” 문의를 처리할 때 토큰 복사, 발급 시각, 사용 시각, 상태가 한 행에 있어야 화면 하나에서 답변할 수 있다. 기존 발급 직후 복사만으로는 과거 토큰 재전달과 사용 여부 확인이 불가능했다.

**검증 경계**: clipboard는 `navigator.clipboard` 실패 시 textarea `execCommand('copy')` 폴백을 시도하고, 폴백도 실패하면 빨간 notification으로 실패를 드러낸다. `revokedAt` 취소 상태와 prefix 검색은 다음 세션 S-B/S-C 범위다.

---

## 2026-05-29 — CL-63 어드민 초대 토큰 취소

**결정**: `/admin/invite`는 유효 토큰만 취소할 수 있고, 취소는 토큰 문서를 삭제하지 않고 `revokedAt`·`revokedBy`를 병합 기록한다.

**이유**: 운영자가 잘못 발급했거나 노출된 토큰을 즉시 막아야 하지만, 발급 이력과 CS 추적성은 유지해야 한다. 삭제 방식은 “왜 가입이 안 됐는지”를 설명하기 어렵고, 사용됨·만료 토큰 취소는 가입 이력과 만료 정책을 흐릴 수 있다.

**검증 경계**: revoke API는 이미 사용됨·이미 취소됨·만료를 모두 HTTP 409와 reason(`already_used`·`already_revoked`·`expired`)으로 반환한다. 판매자 가입 경로는 `AuthService.register()`의 사전 검증과 트랜잭션 내 재검증 두 지점 모두에서 `revokedAt`을 차단한다. UI는 유효 토큰에만 취소 버튼을 보이고, 확인창에서 토큰 16자와 가입 불가 문구를 명시한다.

**잔여**: 취소된 토큰으로 가입 시도 시 거부되는 흐름은 T11 e2e에서 자동화해야 하며, 운영/프리뷰 육안 확인은 `pending-visual-verify-20260529.md` §22에 남긴다.

---

## 2026-05-29 — CL-55 어드민 드라이버 status 서버 필터 e2e fixture화

**결정**: 드라이버 status 필터 S3 e2e는 운영 드라이버 데이터를 직접 시드하거나 승인·정지 상태를 변경하지 않고, Playwright `page.route('**/admin/drivers**')` 네트워크 fixture로 `pending`·`approved`·`suspended`·`all` 응답을 고정한다.

**이유**: 운영 단일 DB의 드라이버 승인·정지 상태를 쓰기 없이 보호하면서도, 프론트 hook이 실제로 보내는 URL 쿼리와 화면 카드 명단의 1:1 정합성을 검증하기 위해서다.

**검증**: 로컬 최신 seller 서버(`SELLER_BASE=http://localhost:3017`)에서 `admin-drivers-status-filter.spec.ts`가 chromium·mobile 합산 8/8 통과했다. 기본 운영 `SELLER_BASE` 실행은 아직 구버전 배포 번들을 바라봐 status 쿼리 기대가 실패하므로, 배포 후 CI 또는 프리뷰 재실행으로 최종 종결한다.

---

## 2026-05-30 — CL-55 어드민 드라이버 액션 결과 알림

**결정**: 드라이버 승인·정지·정지 해제 성공 후 카드를 현재 탭에 억지로 남기거나 자동 탭 이동하지 않고, 성공 notification으로 다음 확인 위치를 안내한다.

**이유**: status 서버 필터가 이미 SSOT이므로 액션 후 현재 탭에서 카드가 사라지는 것은 올바른 동작이다. 다만 운영자에게는 카드 소실처럼 보일 수 있어, 승인·정지 해제는 `승인 완료 탭`, 정지는 `정지됨 탭`에서 확인하라고 안내하는 방식이 가장 작은 UX 보강이다.

**검증 경계**: 액션 실패 시 ConfirmModal은 닫지 않고 빨간 notification만 표시해 재시도 가능성을 유지한다. 자동 탭 이동, 낙관적 카드 이동, 백엔드 계약 변경은 범위 밖이다.

---
## 2026-05-30 — #CL-55 admin banner multi API foundation

**결정**: 다중 배너 Phase 3는 기존 `AdminService`에 누적하지 않고 `AdminBannersService`와 `BannerQueryService`로 분리한다.

**이유**: `admin.service.ts`가 500라인 한도에 근접해 있었고, 관리자 CRUD와 손님 활성 배너 조회는 각각 권한·검증과 공개 조회·KST 필터라는 다른 책임을 가진다.

**계약**: 기존 `GET/PUT /admin/banner` 및 `GET /banner`는 기본 배너 호환 경로로 유지한다. 신규 경로는 `GET/POST/PUT/DELETE /admin/banners`, `GET /banners/active`이며, `kind:'default'` 배너 삭제는 422로 차단한다.

---
