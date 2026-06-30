# Critical Logic archive 20260604 part 01

> 원본: $Path에서 2026-06-29 문서 정리 시 분리.

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
