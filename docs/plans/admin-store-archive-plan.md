# 어드민 판매자 "치우기"(아카이브) 기능 — 설계 계획서

> 작성: 2026-05-25 (세션90) · 출처: `/further` → `/grill-me` 확정안
> 상태: 계획 수립 완료 (구현 착수 전)

---

## 1. 문제 (Problem)

어드민 판매자 목록(`/admin/stores`)에는 **목록 보기 + 수수료 설정**만 있고,
잘못/테스트로 들어온 판매자를 **목록에서 치울 길이 없다.** 시드·온보딩 테스트
과정에서 생긴 빈 판매자(예: "디어 오키드" placeholder류)가 운영 판매자(난플렉스)와
섞여 보여 목록이 지저분해진다.

**누가·언제:** 어드민이 판매자 목록을 관리할 때, 더는 쓰지 않는 판매자를 정리하고 싶을 때.

---

## 2. 범위 (Scope)

### 하는 것 (In)
- 판매자 목록에서 **"치우기"(아카이브)** — 영구 삭제가 아니라 `store.status='archived'` 표시.
- 평소 목록에서 **숨김**, "정리된 판매자 보기" 토글로 다시 표시 + **복구(active 복원)**.
- 안전장치: **주문·정산 기록이 없는 판매자에만** 치우기 버튼 노출 + **확인창**.

### 하지 않는 것 (Out)
- **영구 삭제** (법적 책임 소재 대비 — 주문·정산·로그 전부 보존).
- **판매자 정지 시스템** (store 상태로 셀러앱 로그인·주문 차단). → 별개 기능.
- **셀러앱 차단 가드 수정** ([proxy.ts](../../apps/seller/src/proxy.ts)는 `storeId`만 봄).
  치우는 대상이 "기록 없는 빈 판매자"라 애초에 영업 중이 아니므로 불필요.
- **서버측 includeArchived 쿼리 분기** (지금 판매자 수 한 자릿수 → 프론트 필터로 충분.
  규모 커지면 (B)안으로 승격).

---

## 3. 성공 기준 (Success)

- 치운 판매자는 기본 목록에서 **사라진다.**
- "정리된 판매자 보기"를 켜면 **다시 나타나고**, "복구"로 되돌릴 수 있다.
- 주문·정산 기록이 있는 판매자는 치우기 버튼이 **비활성**이라 실수로 못 치운다.
- 어드민 주문·정산 탭에서 archived 판매자의 **과거 기록은 그대로 조회**된다.

---

## 4. grill-me 확정 사실 (설계 근거)

| 결함 | 코드 근거 | 해소 |
| :--- | :--- | :--- |
| "판매자 정지" 기능 부재 | `toggleSuspend`는 `users`(소비자·드라이버)만, `stores` 무관 | 정지 단계 제거 |
| 셀러앱이 store.status 안 봄 | [proxy.ts:14-17](../../apps/seller/src/proxy.ts#L14-L17) `storeId`만 분기 | "빈 판매자만" 범위로 무력화 |
| getStores 필터 없음 | [admin.service.ts:24-33](../../apps/api/src/admin/admin.service.ts#L24-L33) 전체 반환 | 프론트 필터(A) 채택 |
| 소비자 노출 부작용 | 어드민 stores는 ownerId 조회, 소비자 경로 별개 | 위험 낮음 |

---

## 5. 구현 Task (아토믹 분해)

> 각 태스크는 **독립 커밋 가능 단위**. 위→아래 순서 의존(T1 없으면 T2 무의미).
> ⚠️ 정합성 검토(세션90)에서 확정한 사실은 각 태스크에 "검증됨" 표기.

### T1 — 백엔드 service: archive/restore + 기록 가드
파일: [admin.service.ts](../../apps/api/src/admin/admin.service.ts) (Stores 섹션, 45행 `setCommission` 아래)
- `archiveStore(storeId)`:
  1. `stores/${storeId}` 존재 확인 → 없으면 `NotFoundException`.
  2. **기록 선검사** — `orders`·`settlements` 각각 `.where('storeId','==',storeId).limit(1).get()`.
     ✅ 검증됨: 두 컬렉션 모두 `storeId` 필드 사용([dto:23,29](../../apps/api/src/admin/dto/admin.dto.ts#L23)).
  3. 하나라도 `!snap.empty` → `BadRequestException('주문·정산 기록이 있는 판매자는 정리할 수 없습니다.')`.
  4. 통과 시 `ref.update({ status:'archived', archivedAt: Timestamp.now(), updatedAt: ... })`.
- `restoreStore(storeId)`:
  1. 존재 확인 → 없으면 `NotFoundException`.
  2. `ref.update({ status:'active', archivedAt: FieldValue.delete(), updatedAt: ... })`.
     ⚠️ `FieldValue.delete()` 사용 가능 여부 차기 세션 확인(firestore.service 래퍼에 노출되는지). 안 되면 `archivedAt: null`.

### T2 — 백엔드 controller: 라우트 2개
파일: [admin.controller.ts](../../apps/api/src/admin/admin.controller.ts) (Stores 섹션, 34행 아래)
- `@Patch('stores/:storeId/archive') archiveStore(@Param('storeId') id)` → `admin.archiveStore(id)`.
- `@Patch('stores/:storeId/restore') restoreStore(@Param('storeId') id)` → `admin.restoreStore(id)`.
- ✅ 검증됨: `@Roles('admin')`은 **클래스 레벨**([controller:20](../../apps/api/src/admin/admin.controller.ts#L20))에 이미 적용 → 메서드별 재선언 불필요. DTO·body 없음(Param만).

### T3 — 프론트 hook: archive/restore 액션
파일: [useAdmin.ts](../../apps/seller/src/hooks/useAdmin.ts) `useAdminStores`(157~176행)
- `archiveStore(storeId)` / `restoreStore(storeId)` 추가 — `setCommission`(166행)과 동일 패턴:
  `runAction(token, '/admin/stores/${storeId}/archive', { method:'PATCH' })` → 성공 시 `await reload()`, boolean 반환.
- `return`에 두 함수 추가.

### T4 — 프론트 UI(a): 표시 필터 + 토글
파일: [stores/_client.tsx](../../apps/seller/src/app/admin/stores/_client.tsx)
- `const [showArchived, setShowArchived] = useState(false)`.
- 렌더 직전 `const visible = showArchived ? stores : stores.filter(s => s.status !== 'archived')`.
- 목록 상단 헤더(121~131행 `Group`)에 Mantine `Switch` "정리된 판매자 보기" 추가.
- `stores.map` → `visible.map` 으로 교체(모바일 카드·데스크톱 테이블 **양쪽**).
- 빈 목록 분기(133행)도 `visible.length` 기준으로.

### T5 — 프론트 UI(b): 치우기/복구 버튼 + 확인창
파일: [stores/_client.tsx](../../apps/seller/src/app/admin/stores/_client.tsx)
- `renderRate`/`renderSetButton` 옆에 `renderArchiveButton(store)` 헬퍼 추가(테이블·카드 공용).
  - `status !== 'archived'` → **"치우기"**(red subtle). 클릭 시 `window.confirm('OO 판매자를 정리할까요? 주문·정산 기록은 보존됩니다.')` → 확인 시 `archiveStore`.
    ✅ 검증됨: 기존 강제환불도 `prompt()`/브라우저 다이얼로그 사용([orders/_client.tsx:51](../../apps/seller/src/app/admin/orders/_client.tsx#L51)) → 일관. **Mantine modals 미설치**라 라이브러리 도입 불필요.
  - `status === 'archived'` → **"복구"**(blue subtle) → `restoreStore`.
  - 서버가 기록 가드로 400 반환 시 → `notifications.show` 로 차단 사유 안내(실패 메시지 그대로).
- `STATUS_LABEL`/`STATUS_COLOR`에 `archived: '정리됨'` / `archived: 'gray'` 추가.
- 데스크톱 테이블 마지막 컬럼(265행 `renderSetButton`)·모바일 카드(177행) 양쪽에 버튼 배치.

---

## 6. 정합성 체크리스트 (C1~C6)

- [x] **C1** tsc 0 (seller + api) — 둘 다 exit 0
- [x] **C2** biome 0 (신규 0) — `_client.tsx`·`useAdmin.ts` 2파일 0
- [x] **C3** `npm run build` 0 — api(`nest build`)·seller(`next build --webpack`) 둘 다 exit 0
- [x] **C4** 500라인 한도 — `_client.tsx` 335라인, useAdmin.ts 388, service 322 (전부 ≤500)
- [x] **C5** archived 판매자의 주문·정산 탭 조회 회귀 0 — `getOrders`/`getSettlements`는 `storeId`만 조회, `store.status` 무관(코드 레벨 확정)
- [x] **C6** 기록 있는 판매자 치우기 차단(400) — `archiveStore` limit(1) 검사→`BadRequestException`, hook이 `ApiError` 전파→notification 안내

> **미결 해소(구현 시):** `FieldValue.delete()` 래퍼 노출 확인됨 — `firestore.service.ts:24-26`에 `get FieldValue()` getter 존재 → `restoreStore`에서 `this.firestore.FieldValue.delete()` 사용(폴백 `null` 불필요).

---

## 7. 육안 검증 (구현 후)

`docs/specs/frontend/pending-visual-verify.md`에 항목 추가:
1. 빈 판매자 치우기 → 목록에서 사라짐
2. "정리된 판매자 보기" 토글 → archived 다시 표시
3. 복구 → active 목록 복귀
4. 주문 있는 판매자(난플렉스) 치우기 시도 → 차단 안내
5. 모바일 카드에서도 치우기/복구 버튼 노출·동작

---

## 8. 리스크·미결

| ID | 리스크 | 완화 |
| :--- | :--- | :--- |
| R1 | 기록 존재 검사 쿼리 비용(orders·settlements 2회 조회) | `.limit(1)`로 존재만 확인 |
| R2 | 규모 증가 시 프론트 필터 비효율 | (B) 서버 includeArchived로 승격(문서화됨) |
| R3 | `STATUS_LABEL`에 'archived' 라벨 미정 | T3에서 "정리됨" 라벨·회색 배지 추가 |

---

## 9. 어드민 e2e 인프라 신설 (세션90 후속)

> 배경: e2e 스펙은 consumer/seller/driver만 존재, **어드민 전용 스펙·계정이 0개**(3중 차단:
> ①admin 스펙 부재 ②테스트 계정 seller role ③백엔드 `@Roles('admin')` 403).
> 사용자 확정: **전용 e2e admin 계정 신설 + 읽기 전용 스모크**(운영 DB 쓰기 0).

| 작업 | 파일 | 내용 |
| :--- | :--- | :--- |
| A1 | `scripts/seed-test-data.mjs` | admin user(`test-admin-001`, `role:'admin'`, **storeId 없음=순수 어드민**) 추가, 비번은 placeholder |
| A2 | `apps/e2e/global-setup.ts` | `CREDENTIAL_TARGETS`에 ADMIN(base=`SELLER_BASE` 재사용, `TEST_ADMIN_*`) |
| A3 | `apps/e2e/tests/admin-store-archive.spec.ts` | 비인증 가드 + 인증 스모크(진입·토글·버튼 노출, **클릭=상태변경 안 함**) |
| A4 | `apps/e2e/.env` | `TEST_ADMIN_EMAIL/PASSWORD`(gitignore됨) |

**검증:** playwright `--list` 8테스트 인식(chromium·mobile×4), 비인증 1건 실제 통과(global-setup 회귀0·ADMIN 미설정 시 자동 skip 확인).

**운영 실행 절차(사용자 영역):**
1. `node scripts/seed-test-data.mjs` — admin@test.com 계정 생성(운영 DB 쓰기)
2. `node scripts/reset-user-password.mjs admin@test.com <비번>` — 실비번 설정
3. `apps/e2e/.env`의 `TEST_ADMIN_PASSWORD`에 같은 비번 기입
4. `cd apps/e2e && npx playwright test admin-store-archive` — 8테스트 실행

⚠️ **비번 값은 사용자 결정 필요**(seller=약한 비번 `test1234`, consumer=강한 비번 — [feedback_security_convenience] 정책).
