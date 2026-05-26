# 다중 배너·기간 운영 SDD (#CL-55 §G T7 / G-11)

> **출처:** `admin-tab-banner-plan.md` §G-11 (운영 모델·확정·작업 목록).
> 본 SDD는 §G-11.1~G-11.8을 옮기지 않고 **링크로 참조**하며, **세션별 실행 플랜**(작업 순서·아토믹 분해·정합성·e2e)만 누적한다.
> **구현 미착수** — 세션 S1부터 순차 진행.

## 1. 목적·범위

단일 `banners/main_hero` 한 장 운영 → **다중 배너 + 기간(start/end) + 기본 배너 1장 보장**으로 확장.

- **운영 모델·확정 결과:** [`admin-tab-banner-plan.md §G-11.1~G-11.8`](./admin-tab-banner-plan.md#g-11-further-확정--다중-배너기간-운영-모델-세션92-further-2026-05-26)
- **결함 진단(T1·T2·T3)·기능 부재(T4·T5·T6):** [`§G-2~G-7`](./admin-tab-banner-plan.md#g-2-정합성-진단----useeffect-잘못된-의존성-입력-덮어쓰기--루프-구조)
- **확정 표 Q1~Q13:** [`§G-11.8`](./admin-tab-banner-plan.md#g-118-grill-me-확정-2026-05-26-13건)

## 2. 정합성 기준

본 SDD는 [`admin-tab-banner-plan.md §0 (C1~C7)`](./admin-tab-banner-plan.md#0-공통-정합성-검토-기준-모든-어드민-탭-공통) + **C8 이전 안전성** + **C9 기간 경계 KST**를 그대로 적용.

---

## 3. 세션별 실행 플랜 (작업 순서·아토믹 분해·정합성·e2e)

> **목적:** §G-7 + §G-11.4 + §G-11.8을 한 줄의 실행 순서로 정렬하고, 세션 단위로 아토믹 태스크·정합성 검토·마지막 e2e까지 풀어 SSOT로 누적.
> **원칙:** 한 세션 = 한 PR/한 커밋 묶음. 세션 내부에서도 한 태스크당 한 커밋(세션91 패턴). 각 세션 종료 직전 §0 C1~C7 (+ 해당 시 C8·C9) 전수 통과해야 커밋.
> **세션 길이 가정:** 어드민·셀러·소비자 3앱 정합성 한 사이클(tsc/biome/build)은 약 6~12분. 세션 1회는 평균 2~4시간(태스크 1~3개) 가정.

### 3.0 전체 순서 (Phase 흐름)

```
[Phase 0] 결함 해소 (T1·T2·T3)         ← G-11과 무관, 가벼움
   ↓
[Phase 1] 가드 + 반응형 (T5a·T6)        ← SDD와 독립, 본 탭 단독 마무리 가능 구간
   ↓
[Phase 2] SDD 작성 (본 문서)            ← 코드 변경 0, 문서만
   ↓
[Phase 3] 백엔드·데이터 (U1·U2·U3·T5b)  ← 셀러/소비자 영향 없음, 어드민·API만
   ↓
[Phase 4] 어드민 UI 재구성 (U4·U5·U6·U7) ← T1은 U7에 자연 흡수(Q7 재고 여지)
   ↓
[Phase 5] 손님 화면 캐러셀 (U8·U9·T4)   ← T4(미리보기)는 U5 옆 패널로 동시
   ↓
[Phase 6] e2e + 마이그레이션 + 육안     ← 마지막 안전망
```

### 3.1 세션 S1 — 결함 해소 (T2·T3)

**목표:** G-11과 무관한 표면 결함 2건을 먼저 닫아 패턴 선례(에러 표시) 생성.

| 태스크 | 파일 | 변경 요지 |
|--------|------|-----------|
| **S1-T2** | `_components/BannerCtaSection.tsx`, `_client.tsx handleSave` | CTA label↔href 둘 중 하나만 채운 비대칭 입력 → 저장 차단 + 인라인 안내("URL 또는 라벨 중 하나만 비울 수 없습니다"). 기본 hrefs 빈 문자열 허용 단, 둘 다 비면 통과(섹션 전체 미사용). |
| **S1-T3a** | `useAdmin.ts useAdminBanner` | `save` catch 안에서 에러 사유를 throw 대신 반환값으로 전파(예: `{ ok: false, reason: string }`). hook 인터페이스 변경 시 호출부 동시 수정. |
| **S1-T3b** | `_client.tsx handleSave`, `handleImageUpload` | 실패 시 `notifications.show({ color: 'red', message })` (Mantine notifications). 성공 메시지는 기존 유지. |

**커밋:** 3건. 각 태스크당 1커밋(`fix(admin/banner): #CL-55 ...`).

**정합성 검토 (세션 종료 직전):**
- C1 tsc 0 (어드민·셀러·소비자).
- C2 biome 0 (신규).
- C3 `npm run build` 0.
- C4 500라인 — `_client.tsx`·`BannerCtaSection.tsx` 한도 내 확인.
- C5 SSOT 토큰 — 새 안내 문구는 SSOT 라벨 패턴 따름.
- C6 가드 — 저장 실패 시 로딩 종료·메시지 노출 보장.
- C7 시각 회귀 — 정상 입력 경로는 회귀 0.

**e2e:** 본 세션 불필요(어드민 e2e 인프라는 세션90에 신설됐으나 배너 탭 스펙 미존재). Phase 6에서 통합.

---

### 3.2 세션 S2 — T1 흡수 결정 + Phase 1 잔여 (T5a·T6)

**목표:** Q7 재검토 후 T1 처리 + 본 탭 단독 마무리 가능 잔여 2건.

**선결 결정(세션 착수 직전):**
- **Q7 재고:** Phase 2(SDD 작성) 착수가 본 세션 직후로 잡혀 있다면 T1을 U7에 흡수(작업 중복 회피). 1주 이상 텀이 생기면 T1 단독 선행. **착수 직전 사용자 확정.**

| 태스크 | 파일 | 변경 요지 |
|--------|------|-----------|
| **S2-T1** (조건부) | `_client.tsx:29-32` | `useEffect` deps `[banner]`로 좁힘 + `{...defaultForm, ...banner}` 또는 `useRef` 가드("최초 1회 + banner 갱신 시만 hydrate"). `eslint-disable` 제거. |
| **S2-T5a** | `_client.tsx handleImageUpload` | 업로드 전 가드: ① 파일 형식 화이트리스트(`image/png`·`image/jpeg`·`image/webp`) ② 용량 상한(예: 2MB) ③ 위반 시 inline 메시지 + 토스트. orphan cleanup은 T5b(Phase 3 U2)에 위임. |
| **S2-T6** | `_components/BannerCtaSection.tsx` | `Group grow` → `<SimpleGrid cols={{ base: 1, sm: 2 }}>` 또는 `Group wrap="wrap"`. 모바일에서 1열, sm 이상에서 2열. 시각 미세 변경(C7 의도적). |

**커밋:** 2~3건(T1 흡수 결정에 따라).

**정합성 검토:** S1과 동일 + **C7 시각 회귀 = T6은 의도적 변경, 육안 대상으로 `pending-visual-verify.md`에 항목 추가**.

**e2e:** 본 세션 불필요.

---

### 3.3 세션 S3 — 본 SDD 작성 (코드 변경 0)

**목표:** 본 문서 자체. (Phase 2 = 현 단계)

**산출물:** SDD 문서 1개(본 파일). 포함 항목:
1. 목적·범위·운영 모델(참조).
2. 정합성 기준(참조).
3. 세션별 실행 플랜 §3 (본 절).
4. 마이그레이션 절차 §4.
5. e2e 시나리오 §5.
6. 위험·롤백 §6.

**커밋:** 1건(`docs(banner-sdd): #CL-55 다중 배너 SDD 초안 작성`).

**정합성 검토:** 문서 검토만. lint·build 영향 없음. 500라인 한도 준수 권고.

**e2e:** 해당 없음.

---

### 3.4 세션 S4 — Phase 3 백엔드·데이터 (U1·U2·U3·T5b)

**목표:** 다중 배너 데이터 모델·CRUD·손님 조회 엔드포인트·마이그레이션 완료. UI는 손대지 않음.

| 태스크 | 파일 | 변경 요지 |
|--------|------|-----------|
| **S4-U1a** (모델) | shared `types/banner.ts` 또는 admin 도메인 | `Banner` 타입: `id`, `kind: 'default' \| 'scheduled'`, `imageUrl`, `tag`, `headline`, `subtext`, `cta1?`, `cta2?`, `startDate?`(YYYY-MM-DD), `endDate?`, `createdAt`. `isActive` 제거(Q5). |
| **S4-U1b** (마이그레이션 스크립트) | `apps/admin/scripts/migrate-banners-kind.ts` (일회용) | 기존 `banners/main_hero` 1건에 `kind:'default'` 필드 add(merge). 멱등성: 이미 `kind` 있으면 skip. 실행 후 로그로 결과 확인. **PR 머지 후 다음 세션에 스크립트 삭제 커밋**. |
| **S4-U2a** (CRUD) | `api/src/admin/admin.service.ts`, `admin.controller.ts` | `GET /admin/banners` 목록 / `POST` 생성 / `PUT /:id` 수정 / `DELETE /:id` 삭제. 입력 검증: `kind === 'scheduled'`이면 `startDate`·`endDate` 필수 + `endDate >= startDate`. **`kind === 'default'` DELETE 차단(422)**. CTA 비대칭 검증 동반(S1-T2 백엔드판). |
| **S4-U2b** (T5b orphan cleanup) | `admin.service.ts DELETE 핸들러` | 배너 삭제 시 `imageUrl`이 Firebase Storage 경로면 동반 삭제. PUT으로 이미지 교체 시 옛 파일도 삭제(옛 imageUrl이 있고 새 imageUrl과 다르면). |
| **S4-U3** (손님 조회) | `api/src/app.controller.ts` | 기존 `GET /banner`(단건) → `GET /banners/active` 신설(현 단건 엔드포인트는 deprecate 표시·1세션 유지 후 다음 PR에서 제거). 응답: `{ scheduled: Banner[], default: Banner }`. 정렬 = `createdAt desc`. 서버사이드 today 필터(Q6·Q12): `kind:'scheduled' && startDate <= todayKST() && endDate >= todayKST()`. `revalidate: 60` 유지. |
| **S4-U2c** (유닛 테스트) | `api/src/admin/__tests__/banners.spec.ts` (신설) | ① `kind:'default'` DELETE → 422 ② `endDate < startDate` → 400 ③ `kind:'scheduled' + startDate 누락` → 400 ④ 정상 CRUD 라운드트립 ⑤ orphan cleanup 호출 검증(mock). |

**커밋:** 5~6건. 한 태스크당 1커밋, 마이그레이션 실행은 별 커밋(스크립트 실행 결과 로그 첨부).

**정합성 검토:**
- C1·C2·C3 + 백엔드 빌드(`nest build`) 0.
- **C8 이전 안전성** — 마이그레이션 스크립트 실행 직후 손님 `GET /banner`(구) + `GET /banners/active`(신) 둘 다 정상 응답 확인. 신/구 1세션 병행.
- **C9 기간 경계** — 유닛 테스트에 `todayKST()` 모킹으로 어제·오늘·내일 경계 케이스 포함.
- 유닛 테스트 통과(vitest 또는 jest, 세션85 vitest 선례).

**e2e:** 본 세션 불필요. API 라운드트립은 유닛 테스트로 커버. 통합 e2e는 Phase 6.

---

### 3.5 세션 S5 — Phase 4 어드민 UI (U4·U5·U6·U7 [+ T1 흡수])

**목표:** 단건 편집 폼 → 목록 + 행별 추가/수정/삭제로 재구성. T1을 U7에 자연 흡수(Q7 선택지 A).

| 태스크 | 파일 | 변경 요지 |
|--------|------|-----------|
| **S5-U7** (hook 재구성) | `useAdmin.ts` | `useAdminBanner` → `useAdminBanners`. 목록 load + `create`·`update`·`delete` mutate. 에러 전파 패턴은 S1-T3 형태 재사용. `useEffect` 의존성 결함(T1) 자연 해소. |
| **S5-U4** (목록 화면) | `banner/_client.tsx` 재작성 + `_components/BannerListTable.tsx`·`BannerListCard.tsx` 신설 | 데스크톱 테이블·모바일 카드(세션88 `hiddenFrom`/`visibleFrom` 패턴). 행별 "수정"·"삭제" 버튼. **기본 배너 행 = 별도 섹션 상단 강조 + "삭제" 비노출**(Q1 invariant). **만료 배너 = "만료" 배지(회색)** (Q13). "새 배너" 버튼은 우상단. |
| **S5-U5** (추가/수정 폼) | `_components/BannerEditDrawer.tsx` 또는 `BannerEditModal.tsx` 신설 | 기존 3개 섹션(`BannerImageSection`·`BannerTextSection`·`BannerCtaSection`) 재사용 + **`DatePickerInput` 2개(start·end)** 추가. `kind === 'default'`이면 기간 입력 숨김(Q5와 정합). 저장 시 S1-T2 CTA 검증 + S4-U2 백엔드 검증 동시 작동. |
| **S5-T4** (라이브 미리보기, Q9) | `_components/BannerLivePreview.tsx` 신설 | 소비자 `HeroBanner` 마크업을 어드민에 복제(consumer 패키지 의존 회피) — form 값 실시간 반영. Drawer/Modal 안에 form 옆 패널로 배치. **시각 회귀 0 ≠ 의도적 신설**(C7 의도적 변경, 육안 대상). |
| **S5-U6** (입력 검증 통합) | `_client.tsx` 저장 핸들러 | `endDate < startDate`·과거 종료일·CTA 비대칭을 한 묶음으로 검증·안내. S1-T2와 충돌 없도록 유틸 추출(가능 시). |

**커밋:** 5건. 한 태스크당 1커밋.

**정합성 검토:**
- C1~C7 전수.
- C4 500라인 — `BannerListTable.tsx`·`BannerEditDrawer.tsx`·`_client.tsx` 각 한도 내. 초과 시 즉시 분할.
- C5 SSOT 토큰 — 만료 배지 색은 토큰(shared `STATUS_LABEL`/색 SSOT 또는 신설 `BANNER_STATUS_LABEL`).
- C6 가드 — 목록 로딩·빈결과·실패 분기 노출(S1 패턴 재사용).
- C7 시각 회귀 — 편집 폼은 의도적 재구성(육안 대상), 손님 화면은 본 세션에서 변경 없음.

**e2e:** 본 세션 불필요. UI 통합 e2e는 Phase 6.

---

### 3.6 세션 S6 — Phase 5 손님 화면 캐러셀 (U8·U9)

**목표:** 손님 첫 화면이 다중 배너 캐러셀로 동작. SSR 안전성 보존.

| 태스크 | 파일 | 변경 요지 |
|--------|------|-----------|
| **S6-U9a** (server fetch 변경) | `apps/consumer/.../HeroBanner.tsx` server component | 단건 `GET /banner` → `GET /banners/active`로 교체. 응답 정규화: `{ scheduled, default }` → 슬라이드 배열로 평탄화(`[...scheduled, default]`, Q3). `revalidate: 60` 유지. |
| **S6-U8a** (캐러셀 클라이언트) | `apps/consumer/.../HeroBannerCarousel.tsx` 신설 (client component, `"use client"`) | `@mantine/carousel` 의존성 추가. props로 배너 배열 받음. 자동 5초 + 인디케이터 + stopOnInteraction·stopOnHover (Q4). |
| **S6-U8b** (1장 처리, Q11) | `HeroBannerCarousel.tsx` 분기 | `slides.length === 1`이면 캐러셀 미사용, `<HeroBannerSlide>` 정적 렌더. 자동·인디케이터 비활성. |
| **S6-U8c** (개별 슬라이드) | `HeroBannerSlide.tsx` 신설 또는 기존 마크업 추출 | 기존 `HeroBanner.tsx:1-155` 마크업을 슬라이드 1장 단위 컴포넌트로 분리. 어드민 미리보기(S5-T4)와 마크업 정합 — 가능하면 shared로 추출(consumer 패키지 의존 회피 위해 어드민·소비자 양쪽 복제 유지하되, 한 쪽 변경 시 동시 수정 규칙을 본 SDD에 기록). |
| **S6-U9b** (호환 정리) | `app.controller.ts` | S4-U3에서 deprecate 표시한 구 `GET /banner` 제거(이번 PR 머지 후 N+1 세션에서 안전 제거). |

**커밋:** 4~5건.

**정합성 검토:**
- C1~C7 전수.
- **C8 이전 안전성 = 본 세션의 핵심.** 손님 첫 화면이 마이그레이션 직후 상태(scheduled 0건, default 1건)에서 정적 1장 정상 노출(Q11). 배포 직후 즉시 육안 1회.
- **C9 기간 경계** = 종료일 당일 KST 자정 전후 노출/비노출 전환. e2e 또는 수동 검증(Phase 6).
- C5 SSOT — 캐러셀 인디케이터 색 토큰.
- C6 가드 — 손님 빈배열은 절대 발생 안 함(기본 1장 보장), 그러나 방어 코드 1줄(빈배열이면 null 반환) 권고.

**e2e:** 본 세션 부분 — `consumer/__tests__/e2e/hero-banner-carousel.spec.ts` 신설은 Phase 6.

---

### 3.7 세션 S7 — Phase 6 e2e + 마이그레이션 사후 + 육안 (마지막 안전망)

**목표:** 어드민·소비자 양쪽 e2e 신설 + 운영 마이그레이션 실행 + 육안 검증 완주.

#### 3.7.1 e2e 시나리오 (어드민)

**파일:** `apps/admin/__tests__/e2e/banner-multi.spec.ts` (세션90 어드민 e2e 인프라 활용)

| 시나리오 | 검증 |
|---------|------|
| **E-A1** 배너 목록 노출 | 어드민 로그인 → `/admin/banner` → 기본 배너 1행 + 만료/활성 배지 정상 분기. |
| **E-A2** 기간 배너 추가 | "새 배너" → 폼 작성(시작·종료·이미지·텍스트·CTA) → 저장 → 목록에 1행 추가 + 활성 배지. |
| **E-A3** 잘못된 기간 차단 | `endDate < startDate` 입력 → 저장 버튼 비활성 또는 422 메시지 노출. |
| **E-A4** CTA 비대칭 차단 | label만 입력 → 저장 차단 + 인라인 메시지. |
| **E-A5** 기본 배너 삭제 불가 | 기본 배너 행에 삭제 버튼 미노출. 직접 API 호출 시 422. |
| **E-A6** 기간 배너 삭제 + orphan cleanup | 삭제 → 목록에서 제거 + (가능 시) Storage 객체 부재 확인. |
| **E-A7** 이미지 가드 | 3MB 파일 업로드 시도 → 차단 메시지. PDF 업로드 → 차단. |

#### 3.7.2 e2e 시나리오 (소비자)

**파일:** `apps/consumer/__tests__/e2e/hero-banner-carousel.spec.ts`

| 시나리오 | 검증 |
|---------|------|
| **E-C1** 기본 배너 단독 | 시드 = `kind:'default'` 1건만 → 손님 첫 화면 정적 1장(캐러셀 비활성, 인디케이터 없음, Q11). |
| **E-C2** 다중 배너 캐러셀 | 시드 = 기본 1 + 기간 2 → 슬라이드 3장(`createdAt desc`, 기본 맨 뒤) + 인디케이터 점 3개. |
| **E-C3** 자동 슬라이드 | 5초 경과 후 다음 슬라이드(Q4) — Playwright `page.waitForTimeout(5500)` 후 active 슬라이드 인덱스 변화. |
| **E-C4** 손가락/마우스 hover 시 자동 정지 | hover 동안 슬라이드 변화 없음. |
| **E-C5** 기간 경계 (KST 자정) | 시드 = 종료일 = 어제 → 비노출. 종료일 = 오늘 → 노출. 종료일 = 내일 → 노출. (Q12, `todayKST()` 모킹) |
| **E-C6** CTA 클릭 | href 클릭 → 내부 라우트 이동. |
| **E-C7** SSR revalidate 보존 | 응답 헤더 `Cache-Control` 또는 next 캐시 동작 확인. |

#### 3.7.3 마이그레이션 실행

1. **준비** — 운영 백업(Firestore export) 확인.
2. **신 API 배포** — S4·S5·S6 머지 후 운영 배포. 구 `GET /banner` 일시 병행(deprecate).
3. **마이그레이션 스크립트 실행** — S4-U1b 스크립트로 `kind:'default'` add. 로그 확인.
4. **C8 즉시 검증** — 손님 첫 화면 새로고침 1회, 기본 배너 1장 정적 노출(Q11).
5. **구 엔드포인트 제거** — S6-U9b 커밋 머지로 `GET /banner` 제거.
6. **스크립트 삭제 커밋** — S4-U1b 마이그레이션 스크립트 파일 삭제(`chore: 일회용 마이그레이션 스크립트 정리`).

#### 3.7.4 육안 검증 (사용자 위임)

`docs/specs/frontend/pending-visual-verify.md`에 본 PR 항목 추가:
- 어드민 목록 화면 데스크톱·모바일 폭.
- 어드민 편집 폼 라이브 미리보기 동기화.
- 손님 첫 화면 기본 배너만 / 기본+기간 / 캐러셀 자동·수동 넘김.
- KST 자정 경계 1회(가능 시 시드 조작).
- T6 CTA 모바일 1열 회귀 0.

#### 3.7.5 정합성 검토 (최종)

- C1~C9 전수 + 어드민·소비자 e2e 0 fail.
- 어드민 e2e는 세션90 함정 3건(세션 격리·networkidle·dotenv#) 재발 여부 확인.
- 소비자 e2e는 세션82 `reference_e2e_preview_race.md`(sync-preview 직후 stale) 주의.

**커밋:** e2e 신설 1~2건 + 마이그레이션 실행/스크립트 정리 별 1건.

---

### 3.8 세션 매핑 요약 표

| 세션 | Phase | 범위 | 코드 변경 | e2e | C8/C9 검증 |
|------|-------|------|-----------|-----|------------|
| S1 | Phase 0 | T2·T3 (CTA 검증·에러 표시) | O | X | X |
| S2 | Phase 0~1 | T1(조건부)·T5a·T6 | O | X | X |
| S3 | Phase 2 | SDD 문서 작성(본 문서) | X(문서만) | X | X |
| S4 | Phase 3 | U1·U2·U3·T5b + 유닛 테스트 | O(API+마이그) | 유닛 | 부분(유닛) |
| S5 | Phase 4 | U4·U5·U6·U7·T4 | O(어드민 UI) | X | X |
| S6 | Phase 5 | U8·U9 | O(소비자 UI) | X | C8 즉시 |
| S7 | Phase 6 | e2e + 마이그 실행 + 육안 | O(테스트만) | 어드민·소비자 | C8·C9 전수 |

---

## 4. 위험·롤백

### 4.1 위험 표

| 위험 | 영향 | 완화 |
|------|------|------|
| S4 마이그레이션 부분 실패 | 일부 문서에 `kind` 누락 | 소비자 쿼리 폴백: `kind` 누락 = `default` 취급(Q1 근거). 재실행 멱등성 보장. |
| S6 캐러셀 1장 처리 누락 | 마이그 직후 빈 화면 또는 인디케이터 1점 | Q11 명세 + E-C1 e2e로 차단. |
| S6 SSR/CSR 경계 깨짐 | hydration mismatch | server에서 fetch + props 전달, 캐러셀만 client component. |
| 기간 경계 KST 오프셋 오류 | 종료일 당일 새벽 비노출 | `todayKST()` 사용(세션85), E-C5 e2e로 차단. |
| 운영 배포 후 구 엔드포인트 즉시 제거 | 캐시된 구 응답 호출 실패 | S4에서 1세션 병행 유지, S6-U9b로 제거. |

### 4.2 비상 롤백 시나리오

1. **S4·S5 머지 후 손님 화면 회귀 발견** → 신 `GET /banners/active` 폴백을 구 `GET /banner` 응답 흉내로 1줄 패치(default 1건만 반환). 캐러셀 측은 1장 처리(Q11)로 자동 정적 표시.
2. **마이그레이션 데이터 손상** → Firestore export로 복구 + 스크립트 멱등 재실행.
3. **e2e 대량 실패** → S7 머지 보류, 어드민·소비자 분리 머지(어드민만 먼저 또는 소비자 보류).

---

## 5. 차기 진입점

- **즉시 시작 = 세션 S1** (T2·T3 결함 해소, G-11과 무관, 가벼움).
- **본 SDD 갱신 트리거** — Q7 재고 결과(S2 착수 직전), 캐러셀 마크업 SSOT 결정(S5/S6 사이) 등 새 결정 발생 시 본 문서 §3 해당 절 직접 수정.

## 6. 참고 문서

- 모(母) 문서: [`admin-tab-banner-plan.md`](./admin-tab-banner-plan.md)
- 통합 인덱스: [`../admin-tabs-improve-plan.md`](../admin-tabs-improve-plan.md)
- 멀티앱 리팩토링 로드맵: [`../app-refactor-roadmap.md`](../app-refactor-roadmap.md)
- 육안 검증: [`../pending-visual-verify.md`](../pending-visual-verify.md)
- 어드민 e2e 인프라 선례: 세션90 (`d10c60f`).
- KST 유틸 선례: 세션85 `todayKST()` / `toDateStrKST()` (vitest 신설).
