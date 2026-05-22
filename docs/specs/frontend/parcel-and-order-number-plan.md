# BUG-16 + UX-11 통합 플랜 — 택배 발송 + 주문번호 통합

> 작성: 2026-05-21 (세션66 사전 설계)
> 진행 순서: **BUG-16 먼저(1세션 예상) → UX-11(1.5세션 예상)**
> 사용자 결정(권장안 4/4 채택): ① PREPARING→DELIVERED 직행 ② `YYYYMMDD-NNNNNN` 패턴 ③ ID 폴백 + 신규만 발급 ④ BUG-16 선행

---

## 0. 진입 정합성 사실관계

### BUG-16 — 백·프론트 4파일 갭

| # | 파일 | 갭 |
|---|------|-----|
| ① | [apps/api/src/orders/orders.helpers.ts:7-10](../../../apps/api/src/orders/orders.helpers.ts#L7-L10) `SELLER_TRANSITIONS` | `PREPARING → DELIVERED` 엔트리 없음 — API가 거부함 |
| ② | [apps/api/src/orders/orders-lifecycle.service.ts:62-64](../../../apps/api/src/orders/orders-lifecycle.service.ts#L62-L64) | `DELIVERING` 시 `driverId = requesterId` 자동기록 → 셀러 호출 시 오염. parcel 경로는 DELIVERED 직행이므로 비해당이지만 회귀 가드 명문화 |
| ③ | [apps/seller/src/app/orders/[id]/page.tsx:89-92](../../../apps/seller/src/app/orders/[id]/page.tsx#L89-L92) | `canPrepare = ACCEPTED \|\| CONFIRMED` 만 — parcel+PREPARING 분기 없음 |
| ④ | [apps/driver/src/app/board/_client.tsx:39-43](../../../apps/driver/src/app/board/_client.tsx#L39-L43) | `where(status==PREPARING)` 만 — parcel이 수거 대기 목록에 잘못 노출 |

### UX-11 — 주문번호 표시 5곳 + 백엔드 1곳

| 위치 | 현행 표시 | 수정 후 |
|------|----------|---------|
| `apps/api/src/orders/orders-create.service.ts:76, 140-176` | 없음 (uuidv4만) | `orderNumber: YYYYMMDD-NNNNNN` 발급 + 문서 필드 추가 |
| `apps/seller/src/app/orders/_components/OrderCard.tsx:46` | `order.id.slice(-8).toUpperCase()` | `order.orderNumber ?? id.slice(-8).toUpperCase()` |
| `apps/seller/src/app/orders/[id]/_components/OrderInfoSection.tsx:44` | 동일 패턴 | 동일 폴백 |
| `apps/seller/src/app/admin/orders/_client.tsx:182` | `id.slice(0,12)…` | `orderNumber ?? id.slice(0,12)…` |
| `apps/consumer/src/app/mypage/orders/[id]/_client.tsx:202` | 전체 UUID | 폴백 적용 |
| `apps/consumer/src/app/order/success/page.tsx:87` | 전체 UUID | 폴백 적용 |
| `packages/shared/src/order.types.ts:30-59` | `Order` 타입에 필드 없음 | `orderNumber?: string` 추가 |

**백로그 정정**: §12-1 493행 "프론트 3곳"은 실측 **5곳**(셀러 OrderCard·OrderInfoSection·admin · 소비자 mypage상세·success).

### Railway 의존성

UX-11은 백엔드 변경 동반 → 풀런 e2e 필수. BUG-16도 helpers 수정으로 백엔드 동반. **두 작업 모두 Railway 가동 상태 전제**.

---

## 1. BUG-16 — 택배 발송 완료 (Phase A, 1세션)

### T1. 셀러 FSM 확장 — `PREPARING → DELIVERED` 허용

**파일**: `apps/api/src/orders/orders.helpers.ts`

```ts
export const SELLER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  ACCEPTED: ['PREPARING'],
  CONFIRMED: ['PREPARING'],
  PREPARING: ['DELIVERED'], // ← parcel 발송 완료 (T1 신설)
};
```

**리스크**: direct/hub 주문도 셀러가 임의로 DELIVERED 마킹 가능해짐 → ② lifecycle service에서 `deliveryMethod === 'parcel'` 가드 추가로 막아야 함.

### T2. lifecycle service 가드 — parcel만 셀러 DELIVERED 허용

**파일**: `apps/api/src/orders/orders-lifecycle.service.ts`

`updateStatus()` 메서드 안, `getAllowedTransitions` 통과 후·`firestore.doc().update()` 직전에 가드 삽입:

```ts
// parcel 발송 완료는 deliveryMethod === 'parcel' 일 때만 허용
if (
  role === 'seller' &&
  currentStatus === 'PREPARING' &&
  dto.status === 'DELIVERED' &&
  order['deliveryMethod'] !== 'parcel'
) {
  throw new ForbiddenException('택배 발송 완료는 택배 주문에서만 가능합니다.');
}
```

**추가 처리**:
- `DELIVERED` 전환 시점에 [orders-lifecycle.service.ts:87-89](../../../apps/api/src/orders/orders-lifecycle.service.ts#L87-L89) 기존 `settlements.createSettlement(order, 'DELIVERED')` 자동 호출 — parcel도 동일하게 정산 생성됨. 별도 코드 없음.
- 알림: [orders.helpers.ts:30-33](../../../apps/api/src/orders/orders.helpers.ts#L30-L33) `NOTIFICATION_MAP.DELIVERING.DELIVERED: 'ORDER_DELIVERED'` 만 존재. **`PREPARING → DELIVERED` 매핑은 없음** → 알림 안 감.
  - 결정 사항: `PREPARING: { DELIVERED: 'ORDER_DELIVERED' }` 추가로 동일 템플릿 재사용 권장.

### T3. 셀러 주문 상세 — "택배 발송 완료" 버튼

**파일**: `apps/seller/src/app/orders/[id]/page.tsx`

```ts
const isParcel = order.deliveryMethod === 'parcel';
const canShipParcel = isParcel && order.status === 'PREPARING';
const showFooter = !isReadonly && !showPrepareForm && (canPrepare || canCancel || canShipParcel);
```

**중요**: `READONLY_STATUSES`(orders/[id]/_lib.ts:28)에 `PREPARING`이 **없음** → 그대로 분기 가능. 단, parcel+PREPARING은 현재 액션이 없어 빈 footer가 안 떴는데, 추가 후엔 뜸. 검증 동선.

**버튼 추가** (canCancel 옆에 배치):
```tsx
{canShipParcel && (
  <Button
    onClick={() => handleShipParcel()}
    disabled={actionLoading}
    fullWidth size="lg" radius="xl"
    style={{ backgroundColor: 'var(--color-primary)' }}
  >
    택배 발송 완료
  </Button>
)}
```

**핸들러**: `useOrderDetailActions` 훅에 `handleShipParcel = () => updateStatus('DELIVERED')` 추가.

**ConfirmModal 적용**: `#CL-37` 정책에 따라 native confirm() 금지 — 사용자 결정 필요한 경우만 모달 띄울지, 단순 버튼만 둘지. **권장**: 무모달(이미 명시적 버튼 클릭이 의도 표명) → BUG-16 본문이 단순 발송 처리이므로.

### T4. 드라이버 보드 — parcel 제외 필터

**파일**: `apps/driver/src/app/board/_client.tsx`

```ts
const qPreparing = query(
  collection(db, 'orders'),
  where('status', '==', 'PREPARING'),
  where('deliveryMethod', 'in', ['direct', 'hub']), // ← T4 추가
  orderBy('preparedAt', 'asc'),
);
```

**Firestore 인덱스**: `status + deliveryMethod + preparedAt` 복합 인덱스가 필요할 수 있음 — Firebase Console에서 자동 생성 링크 제공 가능. 첫 배포 후 콘솔 에러 확인 절차 포함.

### T5. e2e spec 신설 — 택배 발송 동선

**파일**: `apps/e2e/tests/seller-parcel-ship.spec.ts` (신설)

- 시드: 기존 `seed-e2e-orders.mjs`에 `deliveryMethod: 'parcel', status: 'PREPARING'` 주문 1건 추가
- 동선: seller 로그인 → /orders → parcel 주문 상세 진입 → "택배 발송 완료" 버튼 클릭 → status DELIVERED 확인
- 추가: driver 로그인 → /board → 같은 parcel 주문이 목록에 **없음** 확인

### T6. 사후 검증 (필수 5종)

- [ ] 셀러 타입체크 `exit 0`
- [ ] 셀러 빌드 23라우트 통과
- [ ] 드라이버 타입체크·빌드
- [ ] API 빌드 + `pnpm --filter api test` (lifecycle 단위 테스트 영향)
- [ ] biome `apps/seller apps/driver apps/api` → baseline 동일(T-CLEAN1 0e/2w 유지)
- [ ] e2e 풀런 신규 spec 포함 — sync-preview 후 11분 대기 → 수동 dispatch ([reference_e2e_preview_race](../../../C:/Users/tazan/.claude/projects/c--Develop-greenhub/memory/reference_e2e_preview_race.md))

### BUG-16 범위 외

- 드라이버 앱 admin 페이지에서 parcel 주문 별도 조회 화면 신설(향후 필요시 별건)
- 운송장 번호 입력·연동(우체국·CJ API 등) — MVP 범위 외
- 셀러 알림 발송 실패 시 재시도 — 별건

---

## 2. UX-11 — orderNumber 통합 (Phase B, 1.5세션)

### T7. shared 타입 확장

**파일**: `packages/shared/src/order.types.ts`

```ts
export interface Order {
  id: string
  orderNumber?: string  // ← T7 신설. YYYYMMDD-NNNNNN. 기존 주문은 undefined.
  // ... 기존 필드
}
```

**Optional 이유**: 기존 주문 백필 안 함 → 폴백 표시(사용자 결정 ③).

### T8. 백엔드 발급 — 일자별 카운터

**파일**: `apps/api/src/orders/orders-create.service.ts`

**전략**: 기존 `runTransaction` 블록(79~177행) 내부에 카운터 read/write 추가. 이미 트랜잭션 안이라 동시성 안전.

**카운터 문서**: `orderCounters/YYYYMMDD` → `{ seq: number }` 단일 카운터(MVP 트래픽 기준 충분, Firestore 단일 문서 write QPS ~1).

```ts
await this.firestore.runTransaction(async (t) => {
  // ... 기존 daily cap / group buy 검증 (read 먼저)

  // T8: orderNumber 발급 — read
  const kstDate = new Date(Date.now() + 9 * 3600 * 1000);
  const yyyymmdd = kstDate.toISOString().slice(0, 10).replace(/-/g, '');
  const counterRef = this.firestore.doc(`orderCounters/${yyyymmdd}`);
  const counterSnap = await t.get(counterRef);
  const seq = (counterSnap.exists ? counterSnap.data()!['seq'] as number : 0) + 1;
  const orderNumber = `${yyyymmdd}-${String(seq).padStart(6, '0')}`;

  // ... 기존 group buy gc 처리

  // T8: 카운터 write + orderNumber 주입
  t.set(counterRef, { seq, updatedAt: now }, { merge: true });
  t.set(this.firestore.doc(`orders/${orderId}`), {
    id: orderId,
    orderNumber, // ← T8 추가
    // ... 기존 필드 전체
  });
});
```

**리스크**:
- Firestore 트랜잭션 안에서 read는 write 전에 모두 끝나야 함 → 카운터 read를 daily cap read 옆에 배치
- KST 일자 경계: 자정에 두 클라이언트가 동시 주문 시 같은 카운터 충돌은 트랜잭션 재시도로 해결됨
- 카운터 문서가 매일 새로 생성 → orphan 카운터 누적(30일 = 30 문서) — 무시 가능. TTL 정리는 향후 별건

### T9. 응답 본문 확장

**파일**: `apps/api/src/orders/orders-create.service.ts:179-187`

```ts
return {
  orderId,
  orderNumber,  // ← T9 추가
  portonePaymentParams: { ... },
};
```

**consumer 결제 성공 페이지**: [order/success/page.tsx:29-87](../../../apps/consumer/src/app/order/success/page.tsx#L29-L87) — 현재 `orderId`만 쿼리에서 받음. 결제 후 리다이렉트 URL에 `orderNumber`도 동봉할지 결정.
- **권장**: 결제 성공 페이지가 `useOrderStatus(orderId)`로 주문을 다시 가져오므로 응답에 `orderNumber` 포함되면 자동 표시 가능 → 쿼리 URL 변경 불필요.

### T10. 프론트 표시 5곳 폴백 적용

각 위치에 동일 패턴 적용:

```ts
const displayNumber = order.orderNumber ?? `#${order.id.slice(-8).toUpperCase()}`;
// 또는 소비자 측: order.orderNumber ?? `미발급(${order.id.slice(0,8)})`
```

| # | 파일 | 라인 | 폴백 패턴 |
|---|------|------|----------|
| T10-a | `apps/seller/src/app/orders/_components/OrderCard.tsx` | 46 | `orderNumber ?? '#' + id.slice(-8).toUpperCase()` |
| T10-b | `apps/seller/src/app/orders/[id]/_components/OrderInfoSection.tsx` | 44 | 동일 |
| T10-c | `apps/seller/src/app/admin/orders/_client.tsx` | 182 | `orderNumber ?? id.slice(0,12) + '…'` |
| T10-d | `apps/consumer/src/app/mypage/orders/[id]/_client.tsx` | 202 | `orderNumber ?? id`(소비자는 전체 ID 폴백) |
| T10-e | `apps/consumer/src/app/order/success/page.tsx` | 87 | 동일 |

**리팩토링 기회**: 5곳 모두 비슷한 패턴이므로 `packages/shared` 또는 각 앱의 유틸 함수로 추출 가능. **권장**: 본 세션 범위 외(YAGNI), 5곳 인라인 처리 후 향후 중복 발생 시 추출.

### T11. 드라이버 OrderCard 검토

**파일**: `apps/driver/src/components/OrderCard.tsx` (사전 조사에서 `order.id` 참조 발견)

- 현재 표시 패턴 확인 후 동일 폴백 적용 필요할 수 있음 (실측 시 결정)

### T12. e2e 검증 보강

**파일**: `apps/e2e/tests/seller-orders.spec.ts` / `consumer-mypage.spec.ts`

- 신규 주문 생성 spec(현재 e2e 시드 주문은 직접 Firestore write — orderNumber 없음 가능성) 확인
- 권장: 시드 스크립트(`scripts/seed-e2e-orders.mjs`)에 `orderNumber: 'E2E-TEST'` 또는 카운터 패턴 시뮬레이션 주입 — **사용자 결정** 필요(시드도 폴백 의존 vs. 시드도 발급).
  - **권장**: 시드도 패턴 일치 발급(`20260521-000001`) — e2e가 폴백 분기 안 타도록.

### T13. CRITICAL_LOGIC.md 등재

**파일**: `docs/CRITICAL_LOGIC.md`

- #CL-40 (또는 다음 빈 번호) "orderNumber 정책": 패턴·발급 시점·백필 부재·폴백 표시 명문화. Why·How 포함.

### T14. 사후 검증 (필수 6종)

- [ ] 셀러·소비자·드라이버·API 타입체크 `exit 0`
- [ ] 각 앱 빌드 통과
- [ ] biome baseline 유지(0e/2w)
- [ ] e2e 풀런 전 spec 통과(주문번호 표시 회귀 가드 포함)
- [ ] **실서비스 회귀 가드**: 기존 운영 주문(orderNumber 없음)이 폴백으로 정상 표시되는지 스크린샷 검증
- [ ] Firestore Console에서 `orderCounters/YYYYMMDD` 문서 생성·증가 확인

### UX-11 범위 외

- 카운터 문서 TTL/정리
- 백필 스크립트(사용자 결정 ③에 따라)
- 결제 수단(naverpay/kakaopay)별 주문번호 prefix 분기
- 환불·취소 시 orderNumber 재사용/소멸 정책 — 현재 그대로 유지(취소돼도 번호 보존)

---

## 3. 진행 순서·세션 계획

| 세션 | 작업 | 산출물 |
|------|------|--------|
| **세션66 (사전 정합성)** | 본 플랜 작성 + 사용자 4건 결정 | 본 문서 |
| **세션67** | BUG-16 T1~T6 전부 | helpers/lifecycle/seller-orders/driver-board 4파일 + e2e spec 신설. 1세션 봉합. |
| **세션68** | UX-11 T7~T11 (백엔드 + 프론트 5곳) | shared 타입·create.service·표시 5곳. 정적 검증 종결. |
| **세션69** | UX-11 T12~T14 (e2e·CRITICAL_LOGIC·실서비스 검증) | e2e 풀런 + 실데이터 폴백 확인 + #CL 등재 |

**병합 최소 단위**: 세션67 1 커밋, 세션68 1 커밋, 세션69 1 커밋(또는 e2e fix별 분리).

---

## 4. Fatal Constraint 사전 점검

- [ ] [orders.helpers.ts](../../../apps/api/src/orders/orders.helpers.ts) 94라인 → +6라인 = 100라인 (한도 안전)
- [ ] [orders-lifecycle.service.ts](../../../apps/api/src/orders/orders-lifecycle.service.ts) 281라인 → +8라인 가드 = 289라인 (안전)
- [ ] [orders-create.service.ts](../../../apps/api/src/orders/orders-create.service.ts) 202라인 → +10라인 카운터 = 212라인 (안전)
- [ ] [seller orders/[id]/page.tsx](../../../apps/seller/src/app/orders/[id]/page.tsx) 205라인 → +15라인 분기·버튼 = 220라인 (안전)
- [ ] [driver board/_client.tsx](../../../apps/driver/src/app/board/_client.tsx) 157라인 → +1라인 필터 = 158라인 (안전)
- [ ] memory.md 본 세션 기록 시 200라인 한도 준수

## 5. 사용자 결정 사항(확정)

| # | 질문 | 결정 |
|---|------|------|
| ① | 택배 발송 status 전환 | **PREPARING → DELIVERED 직행**. 중간 DELIVERING 무의미, driverId 오염 회피, 정산 자동 생성 활용 |
| ② | orderNumber 패턴 | **`YYYYMMDD-NNNNNN`**. 백로그 §12-1 493행 명시 패턴 그대로 |
| ③ | 기존 주문 백필 | **ID 폴백 + 신규만 발급**. 운영 중 주문 변경 0건, 가장 안전 |
| ④ | 작업 순서 | **BUG-16 → UX-11**. BUG-16 변경 표면 작음·실서비스 영향 큼 |

---

## 6. 위험 요약

| 위험 | 완화책 |
|------|--------|
| Firestore 인덱스 신설(T4) 첫 배포 시 쿼리 실패 | Firebase Console 자동 생성 링크 즉시 클릭 절차 — 배포 직후 모니터링 |
| 셀러가 direct/hub 주문에도 "발송 완료" 마킹 시도 | T2 lifecycle 가드(`deliveryMethod === 'parcel'`)로 차단 |
| 트랜잭션 안에서 read 순서 위반 | T8 카운터 read를 기존 daily-cap/group-buy read와 함께 배치 — write는 마지막 |
| 알림 미발송(NOTIFICATION_MAP 누락) | T2 후속 — `PREPARING.DELIVERED: 'ORDER_DELIVERED'` 매핑 추가 |
| e2e 시드 주문에 orderNumber 부재로 spec 깨짐 | T12 결정 — 시드도 패턴 일치 발급 |
| 실서비스 기존 주문 폴백 누락 | T14 회귀 가드(스크린샷 검증) |
| Railway Outage 재발 | UX-11은 백엔드 의존 → Outage 발생 시 BUG-16만 완료하고 UX-11 보류 가능 |
