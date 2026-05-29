# 어드민 초대(invite) 탭 개선 — 아토믹 태스크 + 세션 플랜 (#CL-55 §F)

> **출처:** `admin-tabs-improve-plan.md` §F (세션97 진단, 세션98 Further 범위 확장, **세션98 grill-me 16건 확정**).
> SDD 분리는 세션91에 끝남(`_client`→`page`+`_client`+2개 `_components/`, inviteStatus 중복 제거 `44c311b`).
> **표현 레이어·500라인·모바일 카드형은 이미 통과** — 7개 탭 중 가장 깔끔하게 분리된 탭.
> 따라서 **리팩토링 시급도는 낮고, 본질은 기능 부재.** E-10의 "단순 구조라 규모 최소" 예상과 일치.
>
> **세션98 grill-me 변경 요약 (본문 말미 §F-7 변경 이력 참조):**
> - 그룹 C(페이지네이션 T8·T9) 제거 → **F5(prefix 검색) 흡수, T8'·T9' 신설**
> - revoke HTTP 상태 **409 단일화 + reason 코드** 확정
> - T4 착수 전 **`consumeInvite`/`signup` 경로 코드 확인** 선결 추가
> - **e2e 강제** (취소 동작 + 거부 가드) — C8 격상
> - 16건 결정 모두 본문에 반영

## 0. 공통 정합성 검토 기준 (모든 어드민 탭 공통)

각 커밋 직전 아래를 모두 통과해야 한다(세션85~96 동일).

- **C1 tsc 0** — 어드민·셀러·소비자 3앱 전체. shared·api 변경 시 재검증.
- **C2 biome 0** — 신규 경고 0.
- **C3 `npm run build` 0** — ⚠️ `npx next build` 금지(Turbopack 충돌).
- **C4 500라인 한도** — 단일 파일 500라인 초과 시 즉시 분할.
- **C5 SSOT 토큰** — 하드코딩 색·라벨 0(T6의 `'orange'`는 §F-2 결정8로 인정·부채 명시).
- **C6 가드 유지** — 로딩·빈결과에서도 복사·취소·검색·확인창 동작(세션86 선례).
- **C7 시각 회귀 0** — T1·T2·T7·T9'는 신규 요소 추가(의도적), 육안 대상.
- **C8 (세션98 격상)** — 백엔드 가드 정합 **e2e 필수**. T4 revoke 후 `consumeInvite`/`signup`에서 `revokedAt` 거부 동작 e2e (자동) 필수. 수동 검증으로 대체 불가.

---

## F-0. 사용자 확정 (세션98 Further + grill-me 16건 — 최종)

> **세션97 = 보기 개선만(F1·F3·F4)** → **세션98 Further로 통제·묻힘 방지까지 확장** → **세션98 grill-me로 묻힘 방지 수단을 검색으로 교체.**
> "이 토큰 왜 안 돼?" CS 1건을 이 화면에서 끝낼 수 있어야 한다는 성공 기준을 만족하려면
> 보기·통제·검색이 함께 필요. 페이지네이션은 CS 동선이 아니라 별도 SDD로 미룸.

### 이번에 하는 것 (5건 + 안전장치 1)
- **F1. 행별 토큰 복사** — 발급 내역 행·모바일 카드에 복사 버튼. **모든 상태(유효·사용됨·만료·취소됨)에 노출.**
- **F3. 사용 시각 표시** — `usedAt` 컬럼/행 추가. 없으면 `-`. 포맷 = **MM-DD HH:mm (KST)**.
- **F4. 발급일 표시** — `createdAt` 컬럼/행 추가. 동일 포맷.
- **F2. 유효 토큰 취소(revoke)** — **'유효' 상태 토큰만 취소 가능**(사용됨·만료 토큰은 버튼 비노출 + 백엔드 409 이중 가드).
  - 취소 후 상태 = **`'취소됨'` (신규 1종, 색 `orange`)** — 목록에 행을 남겨 흔적 보존(서버 삭제 아님).
  - 상태 우선순위 = **revokedAt > usedAt > expired > valid**.
  - 그 토큰으로 가입 시도 시 백엔드가 **409 + reason** 으로 거부.
- **F5. 토큰 prefix 검색 (세션98 grill-me 신설)** — 4자 이상 입력 시 prefix 부분 일치 조회(debounce 300ms). 빈 검색어면 기존 50건 목록 그대로.
- **안전장치 — 취소 확인창** — `Mantine modals.openConfirmModal`로 **토큰 전체 16자** + "취소 후엔 이 토큰으로 가입할 수 없습니다" 명시.

### 이번에 안 하는 것 (별도 SDD 또는 추후)
- **이미 가입한 판매자 되돌리기** — 판매자 정지/삭제 정책 선결 필요(§E-6 D1과 동일 계열). 초대 탭 단독 범위 밖.
- **F6. "더 보기" 페이지네이션** — grill-me Q3 결과 보류. CS 동선이 아니라 전수 열람용. 발급량 100건 도달 시 검색과 함께 묶어 별도 SDD.
- **F7. 만료기간 7일 외 다른 값** — `generateInvite` 파라미터화. 저우선.
- **F8. clipboard 폴백** — T3로 별도 커밋 유지(한 태스크·한 커밋 원칙).
- **사용된·만료 토큰 취소** — F-0 결정상 명시 제외.

### 성공 기준 (잘 됐다고 말하는 장면 — 한 가지)
**"이 토큰 왜 안 돼요?"라는 CS 문의 1건을, 운영자가 이 화면에서 해당 토큰을 prefix 4자로 검색해
발급일·사용일·상태(유효/사용됨/만료/취소됨)를 보고 그 자리에서 답한다.**

→ 이 장면이 성립하려면 **한 행에 발급일·사용일·상태가 함께 보이는 것(T2)** 과 **prefix 검색(T8'·T9')** 이 절대 빠질 수 없음(꼭 넣을 것).

## F-1. 정합성 진단 — 표현 레이어는 양호, 기능이 빈약

표현 레이어 자체는 정상이다(세션91 SDD 분리 완료):
- `_client.tsx`(61줄)·`InviteHistoryTable.tsx`(154줄)·`InviteGenerator.tsx`(91줄)·`_lib.ts`(34줄) — 전부 500라인 여유.
- `inviteStatus`/`formatExpiry`/`formatExpiryLong` 순수함수가 `_lib.ts` SSOT로 추출돼 테이블·카드 공용. 모바일 카드형(`hiddenFrom`/`visibleFrom`)도 적용됨.

남은 타입·SSOT 미세 이슈(저시급):
| 영역 | 발견 | 비고 |
|------|------|------|
| 타입 | `_lib.ts:6` `color: 'gray'\|'red'\|'green'` 로컬 유니언 | T6에서 `'orange'` 추가. SSOT 토큰화는 추후 |
| SSOT | 라벨 `사용됨/만료/유효`가 `_lib.ts:15` 인라인 리터럴 | invite는 store/order status와 무관한 독립 도메인 → shared 상수화 실익 낮음 |

## F-2. 기능 부재 진단 (이 탭의 본질)

데이터는 이미 다 오는데 UI가 버리고 있다. `InviteToken`(`useAdmin.ts:52-59`)에 `createdBy`·`usedBy`·`usedAt`·`createdAt`이 들어오나 테이블은 3컬럼(토큰/상태/만료일)만 그린다.

| # | 기능 부재 | 근거(코드 위치) | 심각도 | 백엔드 | 세션98 범위 |
|---|-----------|------------------|--------|--------|--------|
| **F1** | **과거 토큰 복사 불가** — 발급 직후 `lastToken`만 복사, 내역 행엔 복사 버튼 없음 | `_client.tsx:26-32` handleCopy가 lastToken만 참조 | **높음** | 무변경 | ✅ 포함 (T1) |
| **F3** | **사용 시각 미표시** — `usedAt` 데이터 있으나 컬럼 없음(상태 배지만) | `useAdmin.ts:55`, `InviteHistoryTable.tsx` 3컬럼 | 중 | 무변경 | ✅ 포함 (T2) |
| **F4** | **발급일 미표시** — `createdAt` 데이터 있으나 컬럼 없음 | `useAdmin.ts:58` | 중 | 무변경 | ✅ 포함 (T2) |
| **F2** | **토큰 취소(revoke) 불가** — generate/get만 존재 | `admin.service.ts:271-302`(DELETE 없음) | **중→상**(세션98 격상) | **신설**(POST `/admin/invite/:token/revoke`) | ✅ 포함 (T4~T7) |
| **F5** | **토큰 검색 없음 — CS 응대 시 토큰을 직접 못 찾음** | `getInvites`에 쿼리 파라미터 없음 | **중→상**(세션98 grill-me 격상) | **변경**(`q?: string` prefix where 추가) | ✅ 포함 (T8'·T9') |
| F6 | **페이지네이션 없음 — 51건째부터 영영 안 보임** | `admin.service.ts:298` limit(50) 하드코딩 | 알려진 한계 | 변경 | ❌ 별도 SDD (전수 열람용, CS 동선 아님) |
| F7 | **만료기간 7일 고정** — 어드민 조절 불가 | `admin.service.ts:278-279` 하드코딩 | 낮음 | 변경 | ❌ 별도 SDD |
| F8 | **clipboard 실패 무처리** — try/catch·폴백 없음(HTTPS 아님/권한거부 시 조용히 실패) | `_client.tsx:27` | 낮음 | 무변경 | ✅ 포함 (T3, 별도 커밋) |

> **`InviteStatus` 라벨 확장** — 세션98 F2 도입으로 현 `_lib.ts:6` 유니언
> `'사용됨' | '만료' | '유효'`(`color: 'gray' | 'red' | 'green'`) → **`+ '취소됨' (color: 'orange')`** 1종 추가.
> 어드민 단독 표현이라 `@greenhub/shared`로 끌어올리지는 않음(invite 도메인 독립, F-1 진단 유지).
> SSOT 토큰화는 디자인 시스템 도입 시 일괄 재정의(C5 부채로 기록).

**핵심 시나리오(F1+F5):** 판매자 "토큰 다시 알려주세요" → 어드민이 토큰 앞 4자 검색 → 행 1줄 노출 → 복사 버튼 1클릭 + 발급일·사용일·상태로 즉답. 16자 손으로 옮겨 적기·페이지 N번 넘기기 모두 사라짐.

---

## F-3. 아토믹 태스크 (의존순) — 세션98 grill-me 확정 범위

> **원칙:** 한 태스크 = 한 커밋(세션91 패턴). 백엔드 동반 태스크(T4·T8')는 프론트 태스크와
> 분리해 단독 커밋. 시각 변경 격리는 세션85~91 패턴 유지.
> **선결:** T0(코드 확인)은 코드 변경 0 — 메모 산출만, 커밋 없음.

### T0 (선결, 코드 변경 0). consumeInvite·signup 경로 확인
- 목적 = T4 거부 가드 위치 확정.
- 작업 = `apps/api` 내 `consumeInvite` / `signup` / invite 토큰 검증 경로 전수 grep.
- 산출 = 분기 표(공유 함수 1곳인가, 2경로 각자 검증인가) → 본 문서 §F-3 T4 명세 보완 + 다음 세션 핸드오프 메모.
- 정합성 = 없음(코드 변경 0). 커밋 없음.

### 그룹 A — 발급 내역 테이블 완성 (프론트만, 백엔드 무변경)

- **T1 (F1). 행별 토큰 복사** — `InviteHistoryTable.tsx` 테이블 행·모바일 카드에 복사 버튼 추가.
  - `_client.tsx` handleCopy를 `copyToken(token)` 행별 인자형으로 일반화(현재 lastToken 전용).
  - 복사됨 피드백은 토큰별 식별(현재 단일 `copied` boolean → `copiedToken: string | null` 상태).
  - **모든 상태에 노출** (유효·사용됨·만료·취소됨 공통, 결정10).
  - (선결, 독립 — 의존 없음)

- **T2 (F3+F4). 사용시각·발급일 컬럼 추가** —
  - `@greenhub/shared`에 `toDateTimeStrKST(ts): string` 신설(`MM-DD HH:mm` 포맷, KST 보정, 세션85 `todayKST`/`toDateStrKST` 옆에).
  - **vitest 케이스 1건 추가**(세션85 패턴).
  - `InviteHistoryTable.tsx` 테이블 컬럼 2개(발급일/사용일)·모바일 카드 행 추가. `usedAt` 없으면 `-`.
  - **꼭 넣을 것(F-0 잠금): 한 행에 발급일·사용일·상태 함께 보이기.**
  - (T1과 병렬 가능)

- **T3 (F8). clipboard 폴백** — `navigator.clipboard.writeText` try/catch + 실패 시 `notifications.show({ color: 'red' })` + textarea+execCommand 폴백.
  - **별도 커밋 유지** (한 태스크·한 커밋, 결정11).
  - (의존: T1)

### 그룹 B — 토큰 취소 (F2, 이번 범위 핵심)

- **T4 (F2 백엔드). revoke 엔드포인트 신설 + 거부 가드 한 커밋** —
  - `admin.service.ts`에 `revokeInvite(token)` 추가, `admin.controller.ts`에 `POST /admin/invite/:token/revoke` 라우트.
  - **가드 (HTTP 409 단일화 + reason, 결정1):**
    - `usedAt` 있음 → 409 `{ reason: 'already_used' }`
    - `revokedAt` 있음 → 409 `{ reason: 'already_revoked' }`
    - 만료 → 409 `{ reason: 'expired' }`
  - **데이터모델:** `invites/{token}` 문서에 `revokedAt: Timestamp` + `revokedBy: uid` 추가(set merge).
  - **거부 가드 동일 커밋(결정2·12):** T0 산출에 따라 `consumeInvite` 또는 `signup`(또는 양쪽)에 `revokedAt` 존재 시 동일 패턴 거부 가드.
  - 정합성: tsc 0(api), 신규 라우트 e2e는 그룹 D에서.
  - (의존: T0 산출)

- **T5 (F2 프론트 hook). useAdminInvite 확장** —
  - `useAdmin.ts`에 `revoke(token): Promise<{ ok: true } | { ok: false, reason: string }>` 추가.
  - `InviteToken` 타입에 `revokedAt?: string`·`revokedBy?: string` 필드 추가.
  - 호출 후 invites 목록 갱신(refetch 또는 낙관적 머지).
  - (의존: T4)

- **T6 (F2 상태 1종 추가). `_lib.ts inviteStatus` 확장** —
  - `InviteStatus.label`에 `'취소됨'` 추가, `color` 유니언에 `'orange'` 추가(결정8).
  - **판정 우선순위 (결정7):** `revokedAt 있음 → '취소됨'` > `usedAt 있음 → '사용됨'` > `만료 → '만료'` > 그 외 `'유효'`.
  - 단위 영향: 테이블·카드는 `inviteStatus` 통해 자동 반영(중복 없음 — 세션91 SSOT 효과).
  - (의존: T5의 타입)

- **T7 (F2 UI + 안전장치). 취소 버튼 + 확인창** —
  - `InviteHistoryTable.tsx`에 행별 `'취소' 버튼` (조건: `inviteStatus(inv).label === '유효'` 일 때만 노출).
  - 클릭 시 `modals.openConfirmModal` 확인창 (결정9, 토큰 전체 표시):
    ```
    토큰 A1B2-C3D4-E5F6-G7H8 을(를) 취소하시겠습니까?
    취소 후엔 이 토큰으로 가입할 수 없습니다.
    ```
  - 확인 → `revoke(token)` 호출 → 성공 시 목록 자동 갱신(취소됨 상태로 행 유지).
  - 실패 시 reason별 notification 분기 (`already_used`/`already_revoked`/`expired`).
  - (의존: T5, T6)

### 그룹 C — 토큰 검색 (F5, 세션98 grill-me 흡수)

- **T8' (F5 백엔드). getInvites에 q? prefix 쿼리 추가** —
  - `admin.service.ts getInvites(q?: string)`: q 없으면 현 동작(`orderBy('createdAt','desc').limit(50)`).
  - q 있으면 `where('token', '>=', q).where('token', '<', q + '￿').orderBy('token').limit(50)`.
  - 인덱스: token 단일 — Firestore 자동 단일 필드 인덱스로 충분(신규 복합 불요, 세션80 정산과 다름).
  - **읽기 보호 (결정4·14):** 4자 미만 q는 백엔드에서 무시(전체 50건 반환) — 1~3자 prefix는 결과 폭발 위험.
  - 기존 호출자 무영향(q 미전달 시 동일).
  - (선결 — T9'의 의존, T4와 병렬 가능)

- **T9' (F5 프론트). 검색박스 + debounce** —
  - `_client.tsx`(또는 `InviteHistoryTable.tsx` 상단) Mantine `TextInput` 검색박스 1개.
  - debounce 300ms, 입력 길이 4자 미만은 호출 생략(빈 검색어 = 전체 50건 복귀).
  - `useAdminInvite`가 `setQuery(q: string)` + `query` 상태 노출, getInvites 호출 시 전달.
  - 로딩·빈결과 가드: 검색 중 스피너, 결과 0건이면 "일치하는 토큰이 없습니다" (C6).
  - (의존: T8')

### 그룹 D — e2e 검증 (C8 격상, 결정15)

- **T10 (F2 e2e). 취소 동작 e2e** —
  - `apps/admin/e2e/invite-revoke.spec.ts` 신설(세션90 어드민 e2e 인프라 활용).
  - 시나리오: 어드민 로그인 → 초대 발급 → 발급 내역에서 취소 버튼 클릭 → 확인창 확인 → 상태가 `'취소됨'`(orange 배지)로 바뀜 → 새로고침 후도 유지.
  - 셀렉터: `getByRole('button', { name: '취소' })`, `getByText('취소됨')`.
  - (의존: T7)

- **T11 (F2 e2e). 거부 가드 e2e — C8 핵심** —
  - `apps/admin/e2e/invite-revoke-guard.spec.ts` 또는 위 스펙에 추가 it.
  - 시나리오: 어드민이 토큰 발급 → 취소 → **셀러 회원가입 흐름에서 동일 토큰 입력 → 409 + reason='already_revoked' 거부 확인**.
  - 셀러 회원가입 경로는 기존 e2e 인프라(`apps/seller/e2e`) 활용 또는 API 직접 호출(가능하면 UI 경유).
  - (의존: T7, T10)

- **T12 (F5 e2e, 선택). 검색 동작 e2e** —
  - 4자 prefix 검색 → 일치 토큰만 노출, 검색어 지움 → 전체 50건 복귀.
  - 우선순위 낮음 — T10·T11 통과 후 여력 시 추가.
  - (의존: T9')

### 제외 (별도 SDD — 본 확정에서 명시 제외)
- **F6(페이지네이션 "더 보기")** — CS 동선이 아닌 전수 열람용. **운영 발급량 100건 도달 시 F5(검색)와 묶어 SDD.**
- **F7(만료기간 지정)** — `generateInvite(days?: number)` 파라미터화 + UI Select.
- **이미 가입한 판매자 되돌리기** — 판매자 정지/삭제 정책 선결(§E-6 D1과 동일 계열). 어드민 전역 정책.
- **사용된·만료 토큰 취소** — F-0 결정상 명시 제외(가입한 판매자 영향 차단).
- **F5 1000건 이상 발급량 대응** — prefix 검색은 createdAt desc 정렬과 별개라 결과 누락 가능. 운영 1000건 도달 시 재검토 항목.

---

## F-4. 세션별 진행 계획 (한 세션 = 한 그룹 완결 + 정합성 검토)

> **원칙:**
> 1. **한 세션에 한 그룹**(A·B·C·D) 완결 후 종결 — 세션91 어드민 SDD 분리 패턴.
> 2. **각 태스크 커밋 직전 C1~C8 통과 확인** — 그룹 단위 아닌 태스크 단위로 정합성 검토.
> 3. **세션 종료 시점 = 해당 그룹의 모든 태스크 push 후 `docs/memory.md` 최신화 + `pending-visual-verify.md` 항목 추가.**
> 4. **사용자 지시 없이 push 하지 않음** — 코드 완료 + C1~C8 통과 후 사용자 보고·승인 대기.

### 세션 S-A (선결 + 그룹 A) — 보기 개선

**선결 작업 (커밋 0):**
- [x] **T0** — `consumeInvite`·`signup` 경로 grep, 분기 표 작성 → 본 문서 T4 명세 보완.
  - 산출(2026-05-29): 별도 `consumeInvite` 함수는 없고, 셀러 가입 경로는 `AuthService.register()` 한 곳이다. 단, 같은 메서드 안에 **사전 검증**(`inviteSnap` exists/expired/used)과 **트랜잭션 내 재검증**(`inviteDoc.exists || usedAt`)이 2단계로 존재한다. T4 `revokedAt` 거부 가드는 두 단계 모두에 추가해야 한다.

**아토믹 태스크 (커밋 3):**
- [x] **T1** — 행별 토큰 복사 버튼 (모든 상태 노출)
  - 정합성 검토 (커밋 직전):
    - [x] C1 tsc 0 (admin 앱)
    - [x] C2 biome 0 (신규 0)
    - [x] C3 `npm run build` 0
    - [x] C4 `InviteHistoryTable.tsx` 500라인 이하
    - [x] C5 라벨·색 SSOT 준수
    - [x] C6 로딩·빈결과에서도 복사 동작
    - [x] C7 시각 회귀 — 버튼 추가 외 변경 0
  - 커밋: `feat(admin): #CL-55 invite 행별 토큰 복사 (T1)`

- [x] **T2** — 발급일·사용일 컬럼 + `toDateTimeStrKST` util + vitest
  - 정합성 검토:
    - [x] C1 tsc 0 (admin·shared 양쪽)
    - [x] C2 biome 0
    - [x] C3 build 0
    - [x] C4 500라인 이하
    - [x] C5 라벨 SSOT (포맷 함수도 SSOT화)
    - [x] C6 로딩·빈결과에서도 컬럼 헤더 유지
    - [x] C7 컬럼 2개 추가 — 모바일 카드 행 추가 (육안 대상)
    - [x] **vitest** — `toDateTimeStrKST` 케이스 통과
  - 커밋: `feat(admin): #CL-55 invite 발급일·사용일 컬럼 + toDateTimeStrKST SSOT (T2)`

- [x] **T3** — clipboard try/catch + 폴백 + notification
  - 정합성 검토:
    - [x] C1·C2·C3·C4·C5·C6 통과
    - [x] C7 시각 변경 0 (실패 시 notification만 추가)
    - [ ] 수동 1회: HTTPS 아닌 환경(localhost 외) 또는 권한 거부 모킹 시 notification 노출
  - 커밋: `feat(admin): #CL-55 invite clipboard 폴백 (T3)`

**세션 종료 절차:**
- [ ] 3개 커밋 사용자 보고 → push 승인 대기
- [x] `pending-visual-verify-20260529.md` §21 #189~#194 작성 (행별 복사·발급일/사용일·clipboard 폴백)
- [x] `docs/memory.md` 최신화 — 세션 S-A 완료, T4~T11 다음 세션
- [-] `MEMORY.md` invite 항목 갱신 — 루트 `MEMORY.md` 파일 없음, `docs/memory.md`만 갱신.

---

### 세션 S-B (그룹 B) — 토큰 취소 풀스택

**선결 확인:**
- [ ] T0 산출 표 재확인 — T4 거부 가드 위치 확정 (1곳/2곳)

**아토믹 태스크 (커밋 4):**
- [ ] **T4** — 백엔드 revoke 엔드포인트 + 거부 가드 (한 커밋 강제)
  - 정합성 검토:
    - [ ] C1 tsc 0 (api·admin·seller 3앱 — `InviteToken` 타입 변경 영향)
    - [ ] C2 biome 0 (api)
    - [ ] C3 `npm run build` 0 (api)
    - [ ] C4 500라인 이하 (`admin.service.ts`·`admin.controller.ts`)
    - [ ] C5 reason 코드 enum 또는 const SSOT
    - [ ] C8 — 거부 가드 위치 (T0 산출) 양쪽 다 적용 확인 (T11에서 자동 검증)
  - 커밋: `feat(api): #CL-55 invite revoke 엔드포인트 + 거부 가드 (T4)`

- [ ] **T5** — 프론트 hook revoke + 타입 확장
  - 정합성 검토:
    - [ ] C1 tsc 0 (admin)
    - [ ] C2 biome 0
    - [ ] C3 build 0
    - [ ] C4 500라인 이하
    - [ ] C6 호출 후 목록 갱신 동작
  - 커밋: `feat(admin): #CL-55 invite revoke hook + revokedAt 타입 (T5)`

- [ ] **T6** — `_lib.ts` inviteStatus '취소됨' 추가
  - 정합성 검토:
    - [ ] C1·C2·C3·C4 통과
    - [ ] C5 — `'orange'` 부채 명시 (`_lib.ts` 주석 + 본 문서 §F-6 부채 표)
    - [ ] C7 — 기존 토큰 상태 표시 회귀 0 (revokedAt 없는 토큰은 분기 미진입)
  - 커밋: `feat(admin): #CL-55 invite '취소됨' 상태 + 우선순위 (T6)`

- [ ] **T7** — UI 취소 버튼 + 확인창 + reason별 notification
  - 정합성 검토:
    - [ ] C1·C2·C3·C4 통과
    - [ ] C5 라벨 SSOT
    - [ ] C6 — 로딩·빈결과·이미 취소 중 동시 클릭 가드
    - [ ] C7 — **시각 변경 큼(버튼 추가, 확인창, '취소됨' 배지)** — 격리 권장, 육안 필수
    - [ ] **수동 1회 (e2e 전 스모크):** 발급 → 취소 → '취소됨' 배지 → 새로고침 유지
  - 커밋: `feat(admin): #CL-55 invite 취소 버튼 + 확인창 (T7)`

**세션 종료 절차:**
- [ ] 4개 커밋 사용자 보고 → push 승인 대기 (T4·T11 사이 머지 갭 위험 — 가능하면 T11까지 끝낸 뒤 push)
- [ ] `pending-visual-verify.md` 항목 4~6 작성 (취소 동작·'취소됨' 배지·이중 가드)
- [ ] `docs/memory.md` 최신화

> **⚠️ 머지 갭 주의:** T4 push 후 T11(거부 가드 e2e)가 통과하기 전까지는 "취소된 토큰으로 가입 시도 시 거부" 동작이 자동 검증되지 않는다. 운영 배포는 **세션 S-D 완료(T11 그린) 후**로 미루는 것을 강력 권장.

---

### 세션 S-C (그룹 C) — 토큰 검색

**아토믹 태스크 (커밋 2):**
- [ ] **T8'** — 백엔드 getInvites q? prefix 쿼리
  - 정합성 검토:
    - [ ] C1 tsc 0 (api)
    - [ ] C2 biome 0
    - [ ] C3 build 0
    - [ ] C4 500라인 이하
    - [ ] C8 — q 미전달 시 기존 동작 동일 (회귀 0) — 수동 1회: 기존 어드민 invite 목록 정상 로드
    - [ ] 읽기 보호 — 4자 미만 q는 백엔드에서 무시 (단위 테스트 또는 수동 확인)
  - 커밋: `feat(api): #CL-55 invite getInvites prefix 검색 (T8')`

- [ ] **T9'** — 프론트 검색박스 + debounce 300ms
  - 정합성 검토:
    - [ ] C1·C2·C3·C4 통과
    - [ ] C5 라벨 SSOT
    - [ ] C6 — 로딩·빈결과("일치하는 토큰이 없습니다") 가드
    - [ ] C7 — 검색박스 1개 추가 (육안 대상)
    - [ ] 수동 1회: 4자 prefix 입력 → 일치 토큰 노출 / 3자 입력 → 호출 없음 / 지움 → 전체 50건 복귀
  - 커밋: `feat(admin): #CL-55 invite 토큰 prefix 검색 (T9')`

**세션 종료 절차:**
- [ ] 2개 커밋 사용자 보고 → push 승인 대기
- [ ] `pending-visual-verify.md` 항목 7 작성 (검색 동작)
- [ ] `docs/memory.md` 최신화

---

### 세션 S-D (그룹 D) — e2e 검증 (마무리, C8 강제)

**아토믹 태스크 (커밋 2~3):**
- [ ] **T10** — `apps/admin/e2e/invite-revoke.spec.ts` 신설
  - 정합성 검토:
    - [ ] e2e 그린 (취소 동작 시나리오)
    - [ ] 세션 격리·networkidle·dotenv# 함정 (세션90 선례) 회피
    - [ ] 셀렉터 안정성 — role 기반 우선
  - 커밋: `test(admin): #CL-55 invite revoke e2e (T10)`

- [ ] **T11** — 거부 가드 e2e (C8 핵심)
  - 정합성 검토:
    - [ ] e2e 그린 (어드민 취소 → 셀러 가입 시도 → 409 거부)
    - [ ] reason 코드 검증 (`already_revoked`)
    - [ ] 시나리오에 만료·사용됨 토큰 거부도 1건씩 포함 권장 (가드 전수 검증)
  - 커밋: `test(api): #CL-55 invite revokedAt 거부 가드 e2e (T11)`

- [ ] **T12 (선택)** — 검색 e2e
  - 정합성 검토:
    - [ ] e2e 그린 (prefix 검색 → 결과 / 검색어 지움 → 전체 복귀)
  - 커밋: `test(admin): #CL-55 invite 토큰 검색 e2e (T12)`

**세션 종료 절차 (=#CL-55 §F 전체 종결):**
- [ ] 모든 e2e 그린 → 사용자에게 **세션 S-B 미push 커밋과 함께 일괄 push 승인** 요청
- [ ] push 후 운영 배포 확인 (sync-preview race 주의 — `reference_e2e_preview_race.md`)
- [ ] `pending-visual-verify.md` 항목 1~7 사용자에게 육안 위임
- [ ] `docs/memory.md` 최신화 — **#CL-55 §F invite 탭 종결**
- [ ] `MEMORY.md` invite 진행표 ✅로 갱신
- [ ] `admin-tabs-improve-plan.md` §F 진행표 종결 마킹

---

## F-5. 차기 진입점 / 핸드오프

- **착수 = 세션 S-A T0 (코드 확인) → T1 (행별 복사).** T2를 같이 잡으면 "한 행에 발급일·사용일·상태" 잠금이 가장 먼저 충족돼 성공 기준에 가까워짐.
- **세션 S-B 진입 전 T0 산출 재확인** — 거부 가드 위치 미확정 상태로 T4 들어가면 안 됨.
- **세션 S-D는 단독 세션 권장** — e2e 작성은 세션90 함정(세션격리·networkidle·dotenv#)으로 시간 소모 큼. T10·T11을 한 세션 내 끝내 C8 완성.
- **육안 검증** — 코드 완료 후 `pending-visual-verify.md` §추가 7개 항목 사용자 위임.
- **별도 SDD 후보** — F6(페이지네이션, 발급량 100건 시), F7(만료기간), 가입한 판매자 되돌리기.

---

## F-6. 부채 기록 (의도적 인정)

| # | 부채 | 결정 시점 | 해소 조건 |
|---|------|-----------|-----------|
| D1 | `_lib.ts` color 유니언에 `'orange'` 하드코딩 (C5 위반) | 세션98 grill-me Q8 | 디자인 시스템 SSOT 토큰 도입 시 일괄 교체 |
| D2 | invite 라벨이 `@greenhub/shared`에 없음 | 세션91 F-1 진단 | invite 도메인이 store/order와 다른 라이프사이클 가지면 재검토 |
| D3 | F5 prefix 검색은 createdAt desc 정렬과 별개 | 세션98 grill-me Q4 | 발급량 1000건 도달 시 정렬/필터 정합 재설계 |
| D4 | F6 페이지네이션 부재 — 51건째 발견 불가 | 세션98 grill-me Q3 | 발급량 100건 도달 시 F6+F5 묶어 별도 SDD |

---

## F-7. 변경 이력

- **세션97** — F-1·F-2 진단, F1·F3·F4 보기 개선 3건 초안.
- **세션98 Further (이전 버전)** — F2·F6 확장, 5건+안전장치 1.
- **세션98 grill-me (현 버전)** — 16건 결정 확정:
  1. HTTP 409 단일화 + reason 코드
  2. T0(consumeInvite/signup 경로 확인) 선결 추가
  3. F6(페이지네이션) 보류 → F5(검색) 흡수
  4. prefix 부분일치 4자 이상, debounce 300ms
  5. 검색어 없으면 전체 50건
  6. 그룹 C 재편 (T8/T9 → T8'/T9')
  7. 상태 우선순위 revokedAt > usedAt > expired > valid
  8. '취소됨' 색 `'orange'`
  9. 확인창에 토큰 전체 16자
  10. 복사 버튼 모든 상태에 노출
  11. T3 별도 커밋
  12. UI 비노출 + 백엔드 409 이중 가드
  13. 날짜 포맷 MM-DD HH:mm KST
  14. debounce 300ms + 4자 미만 조회 없음
  15. 취소 동작 + 거부 가드 둘 다 e2e 강제 (C8 격상)
  16. 계획서에 결정 반영 + 변경 이력 명시 (현 §F-7)

---

## 참고 문서

### 본 탭이 직접 참조하는 외부 문서
- **육안 검증 (코드 완료 후 §추가)** — [`../pending-visual-verify.md`](../pending-visual-verify.md) — F-5 7개 항목.
- **선결 결정·별도 SDD 후보 (이번 범위 제외)**
  - **F6 페이지네이션 + F5 고도화** — 발급량 100건 도달 시 묶어 별도 SDD.
  - **F7 만료기간 지정** — `generateInvite(days?: number)` 파라미터화 + UI Select.
  - **이미 가입한 판매자 되돌리기** — [`./admin-tab-users-plan.md`](./admin-tab-users-plan.md) E-6 D1(어드민 전역 정지/삭제 정책)과 동일 계열. 선결 결정 필요.

### 상위 인덱스 · 로드맵
- 통합 인덱스: [`../admin-tabs-improve-plan.md`](../admin-tabs-improve-plan.md)
- 멀티앱 리팩토링 로드맵: [`../app-refactor-roadmap.md`](../app-refactor-roadmap.md)

### 인접 어드민 탭
- [stores](./admin-tab-stores-plan.md) · [orders](./admin-tab-orders-plan.md) · [drivers](./admin-tab-drivers-plan.md) · [settlements](./admin-tab-settlements-plan.md) · [users](./admin-tab-users-plan.md) · [banner](./admin-tab-banner-plan.md)

### 선례
- 세션91 SDD 분리 — `44c311b` invite 탭 SDD 분리(291→61, inviteStatus 중복 제거). 7개 탭 중 가장 깔끔하게 분리됨.
- 세션90 어드민 e2e 인프라 — `d10c60f`·`b72298b`·`20c8e7a` 첫 어드민 e2e 8/8 통과, 함정 3건(세션격리·networkidle·dotenv#) 회피 노하우 → T10·T11 그대로 활용.
- 세션86 정산 status 필터 — C6(로딩·빈결과에서 동작) 가드 패턴.
- 세션85 타임존 KST 보정 — T2 `toDateTimeStrKST` 추가 시 `todayKST`/`toDateStrKST` 옆에 배치 + vitest 패턴 재사용.
- 세션80 정산 복합 인덱스 — F5 prefix 검색은 단일 인덱스라 신규 불요(대조 선례).
