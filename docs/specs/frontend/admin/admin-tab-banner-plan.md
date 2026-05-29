# 어드민 배너(banner) 탭 개선 — 아토믹 태스크 (#CL-55 §G)

> **출처:** `admin-tabs-improve-plan.md` §G (세션95 진단) + §G-11 (세션92 `/further` 다중 배너·기간 운영 모델).
> SDD 분리는 세션91에 끝남(`_client`→`page`+`_client`+3개 `_components/` 섹션, `cb2d114`).
> **표현 레이어·500라인·SSOT 토큰은 이미 통과** — 순수함수가 없어 `_lib.ts`도 (의도적) 없음.
> 따라서 본 진단은 분리가 아니라 **① 버그성 결함 ② 기능 부재**에 집중.
> **구현 진행:** 2026-05-30 T1·T2·T3 완료. T6 CTA 반응형 일부(SimpleGrid 1열/2열) 동시 반영.

## 0. 공통 정합성 검토 기준 (모든 어드민 탭 공통)

각 커밋 직전 아래를 모두 통과해야 한다(세션85~91 동일).

- **C1 tsc 0** — 어드민·셀러·소비자 3앱 전체. T4·T7 시 consumer/shared 포함 재검증.
- **C2 biome 0** — 신규 경고 0.
- **C3 `npm run build` 0** — ⚠️ `npx next build` 금지(Turbopack 충돌).
- **C4 500라인 한도** — 단일 파일 500라인 초과 시 즉시 분할.
- **C5 SSOT 토큰** — 하드코딩 색·라벨 0.
- **C6 가드 유지** — 로딩·실패·빈상태 구분.
- **C7 시각 회귀 0** — T4(라이브 미리보기)·T6(CTA 반응형)은 의도적 변경, 육안 대상.

### G-11 추가 기준 (다중 배너·스케줄링 한정)
- **C8** — **이전 안전성**. 마이그레이션 후 손님 첫 화면이 회귀 없이 한 장(기본 배너) 정상 노출. 배포 직후 검증.
- **C9** — **기간 경계 동작**. 종료일 당일 자정 기준 노출/비노출 전환(KST). 세션85 `todayKST`/`toDateStrKST` 재사용.

---

## G-0. 사용자 확정 (착수 시)
- **B-6(다중 배너·노출 스케줄링) 이번 개선 범위에 포함** — 단일 `banners/main_hero` 고정을
  다중 배너/슬롯/노출 기간으로 확장. ⚠️ 백엔드·데이터모델 신설 규모 → 본 탭 **최대 비중 태스크**.
- **이번 세션 = 진단·문서화만**(코드 변경 0). 구현은 별도 착수.

## G-1. 진단 대상 파일 (현 상태)
| 파일 | 라인 | 역할 |
|------|------|------|
| `banner/page.tsx` | 5 | 단순 래퍼 |
| `banner/_client.tsx` | 97 | form 상태·이미지 업로드·저장 핸들러 |
| `_components/BannerImageSection.tsx` | 58 | 이미지 미리보기 + 업로드 라벨 |
| `_components/BannerTextSection.tsx` | 44 | 태그·헤드라인·서브텍스트 입력 |
| `_components/BannerCtaSection.tsx` | 62 | CTA 1·2 (label·href) 입력 |
| `useAdmin.ts useAdminBanner` | 310-354 | 단건 load/save (PUT) |
| api `admin.service.ts` getBanner/upsertBanner | 306-321 | `banners/main_hero` 단건 set(merge) |
| api `app.controller.ts` GET /banner | 22-26 | 공개 조회(소비자용) |
| consumer `HeroBanner.tsx` | 1-155 | 소비자 소비처(isActive 시만 렌더) |

→ 모두 500 한도 내. **분할(과분할) 불필요.** 분리는 세션91에 완료.

## G-2. 정합성 진단 — 🔴 useEffect 잘못된 의존성 (입력 덮어쓰기 + 루프 구조)
`_client.tsx:29-32`
```js
useEffect(() => {
  if (banner) setForm({ ...form, ...banner });
}, [banner, form]);   // ⚠️ form이 deps + effect 내 setForm → 재실행 구조
```
- `form`을 deps에 넣고 effect 안에서 `setForm(form 참조)` 호출 → `form` 변경 → effect 재실행 루프.
  `eslint-disable`로 **경고만 억제**한 상태(`:31`).
- `{...form, ...banner}` 순서상 **서버 `banner`가 항상 사용자 입력을 덮어씀** → 저장 전 `banner`가
  한 번이라도 재공급되면(reload 등) 입력 유실 가능.
- 교정 = deps `[banner]`로 좁힘 + "최초 1회 또는 banner 변경 시에만 hydrate" 의도 명확화
  (`{...defaultForm, ...banner}` 또는 ref 가드). **결함 — 우선 해소.**

## G-3. 정합성 진단 — 🔴 CTA 빈 href 검증 부재 (소비자 깨진 링크)
- 어드민은 label만 입력하고 href를 비울 수 있음(`BannerCtaSection.tsx` 검증 없음).
- 소비자 `HeroBanner.tsx:111`은 **`cta1?.label`만 보고** 버튼을 렌더 → `href=""`인 링크가 노출.
- label↔href 둘 중 하나만 채운 비대칭 입력을 어드민 단계에서 차단/안내해야 함. **결함.**

## G-4. 정합성 진단 — 에러 전파 단절 (저장·업로드 실패 침묵)
| 위치 | 현황 |
|------|------|
| `useAdminBanner.save` (`useAdmin.ts:346`) | `catch`로 에러 삼킴 → false만 반환 |
| `_client.tsx handleSave:49-55` | `ok===false`면 **아무 표시 없음** |
| `_client.tsx handleImageUpload:43-46` | `finally`만, 업로드 실패 시 토스트·메시지 없음 |

→ 저장 성공만 "저장 완료!" 표시(`:92`), **실패는 전부 침묵.** 사용자가 실패를 인지 못 함. (drivers·settlements·users의 error 미구독과 같은 계열)

## G-5. 기능 부재 (UX)
- **F1. 미리보기 부재** — 입력 결과가 소비자 화면에서 어떻게 보이는지 확인 불가. 이미지만 단독
  표시될 뿐 태그·헤드라인·서브텍스트·CTA 합본(소비자 `HeroBanner` 레이아웃) 미확인.
  **배너 탭 체감 최대 결손** — `HeroBanner` 마크업을 어드민에 재사용한 라이브 프리뷰 추가 여지.
- **F2. 이미지 업로드 가드 부재** — 크기·형식·용량 제한 없이 Firebase Storage 직행
  (`_client.tsx:34-47`). 교체 시 옛 파일(`banners/main_hero/*`) **orphan 누적**(cleanup 없음).
- **F3. CTA href 자유 입력** — 내부 경로(`/products`)만 유효한데 검증·자동완성 없음.
  오타 시 소비자 404. 내부 라우트 Select 또는 패턴 검증 여지.
- **F4. 단일 배너 고정** → **G-0 확정으로 이번 범위 편입(B-6).** `banners/main_hero` 단일 문서라
  다중 배너·슬롯·노출 기간(스케줄) 불가. **백엔드·데이터모델 신설 규모.**

## G-6. 표현·반응형 — 소소한 정리
- **R1. CTA 가로 2열 반응형 미검증** — `BannerCtaSection.tsx:19/39` `Group grow`(text+link 2열).
  세션88 반응형은 테이블 5개만 다룸 → 배너 탭 모바일 폭 미검증. 좁은 화면 줄바꿈 확인 필요.
- **R2. 섹션 헤더 스타일 인라인 3회 중복** — 3개 섹션 컴포넌트가 동일한
  `Text{fontSize:sm, fontWeight:medium}` 헤더를 각자 인라인. 공통 `SectionTitle` 추출 여지(저우선).

## G-7. 아토믹 태스크 (의존순) — 확정 대기

### 그룹 A — 결함 해소 (저위험·선결)
- [x] **T1 (G-2). useEffect 의존성 교정** — deps `[banner]`로 좁힘, hydrate 의도 명확화
  (입력 유실 방지). `eslint-disable` 제거 가능 여부 확인. (독립, 최우선)
- [x] **T2 (G-3). CTA 비대칭 입력 검증** — label↔href 둘 중 하나만 채운 경우 어드민 저장 차단·안내.
  (독립)
- [x] **T3 (G-4). 에러 표시** — `save`/`handleImageUpload` 실패를 토스트·인라인 메시지로 노출.
  hook이 에러 사유 전파하도록 보강. (독립)

### 그룹 B — 기능 추가 (이번 범위)
- **T4 (F1). 라이브 미리보기** — 소비자 `HeroBanner` 마크업을 공유 컴포넌트화하거나 어드민에
  복제해 form 값 실시간 반영. ⚠️ 소비자/어드민 마크업 SSOT화 시 consumer 패키지 의존 확인.
- **T5 (F2). 이미지 업로드 가드** — 크기·형식·용량 검증 + (선택) 교체 시 옛 파일 삭제.
- [x] **T6 (R1). CTA 반응형** — 모바일에서 2열→1열 또는 `wrap`. 시각 미세 변경.

### 그룹 C — 별도 SDD (백엔드·데이터모델 신설, 이번 범위·최대 비중)
- **T7 (F4·B-6). 다중 배너·노출 스케줄링** — `banners/main_hero` 단건 → 컬렉션(다중 슬롯)
  + 노출 기간(start/end)·우선순위·활성 토글. 백엔드 데이터모델·CRUD·소비자 선택 로직(현재
  활성 배너 1개 선택) 전부 신설. 소비자 `HeroBanner`도 "기간·우선순위로 1개 선택" 로직 추가.
  → **G-0에서 범위 편입 확정**이나 규모가 커 **선설계(SDD) 문서 별도 작성 후 착수** 권장.
  - 하위 결정 선행(D-G1): 동시 노출 1개만? 캐러셀? / 기간 겹칠 때 우선순위 규칙 / 마이그레이션
    (기존 main_hero 단건 → 컬렉션 1건 이전).

### 선택 (과분할 주의)
- **R2** — 섹션 헤더 `SectionTitle` 공통화. 우선순위 최하.
- **F3** — CTA 내부 라우트 검증/Select. 저우선.

## G-8. 커밋 단위 (한 태스크씩 — 세션91 패턴)
T1 / T2 / T3 / T4(격리·육안) / T5 / T6(격리). **T7(다중 배너)은 별도 SDD 문서 + 다수 커밋.**

## G-9. 차기 진입점
- 구현 착수 = **그룹 A(T1~T3, 결함·저위험)부터.**
- T7(다중 배너·스케줄링) = **G-11 하위 결정(D-G1) grill-me/사용자 확정 → 별도 SDD 선설계 후 착수.**

---

## G-11. Further 확정 — 다중 배너·기간 운영 모델 (세션92 `/further`, 2026-05-26)

> §G-7 그룹C T7(F4·B-6) "다중 배너·노출 스케줄링"의 **선행 결정**을 `/further`로 한 걸음씩 닫음.
> 본 절은 **확정된 운영 모델 + 해야 할 작업 목록**을 SSOT로 누적한다. **별도 SDD 작성 전 단계**이며,
> 구현 착수 전 D-G1 하위 결정(아래 §G-11.5)을 그릴/사용자 확정으로 마저 닫고 별도 SDD로 위임한다.

### G-11.1 운영 모델 (확정)

| 항목 | 결정 | 비고 |
|------|------|------|
| 방향 | **여러 배너·기간 운영** | 단일 `banners/main_hero` 한 장 → 다중 |
| 손님 노출 | **여러 장 캐러셀** | 자동 슬라이드 또는 손가락 넘김(세부 G-11.5) |
| 순서 규칙 | **최근에 만든 것이 먼저** | 어드민 수동 순서 매김 없음 → `createdAt desc` |
| 기간 입력 | **시작일·종료일 둘 다 필수** | 무기한 배너 ❌, 종료 후 자동 비노출 |
| 빈 날 처리 | **기본 배너 1장을 항상 보유** | 기간 한정 배너 0개여도 손님 첫 화면 절대 안 빔 |
| 이전 작업 | **현 `banners/main_hero` 1장 → 자동으로 기본 배너 자리로 이전** | 어드민 손댈 일 없음(일회용 마이그레이션 코드) |
| 데이터 모델 | **"기본 배너 1장 + 기간 한정 배너 N장"** 두 슬롯 | 단일 컬렉션 + `kind: 'default' | 'scheduled'` 또는 두 경로 분리 — SDD에서 확정 |

### G-11.2 잘 됐다고 말하는 장면 (성공 기준 — 한 가지)
**"같은 날 두 배너(기본 + 기간 한정 1장)를 만들어두면, 손님 첫 화면이 그걸 순서대로 넘겨 보여준다."**
→ 어드민 한 화면에서 등록 → 손님 첫 화면 새로고침 1회로 끝나는 육안 검증.

### G-11.3 이번에 안 하는 것 (별도 SDD / 추후)
- **F3(CTA href 자유 입력 검증/Select)** — 저우선, 본 모델과 독립.
- **F5(이미지 업로드 가드 — 크기·형식·orphan cleanup)** — 본 모델과 직교, 그룹 B로 별도 가능.
- **임시 정지 스위치** — "기간=활성" 한 가지로 단순화하지, 별도 활성/비활성 토글을 둘지(§G-11.5 하위 결정).
- **캐러셀 세부(슬라이드 간격·인디케이터·자동/수동)** — SDD에서 확정.

### G-11.4 해야 할 작업 목록 (별도 SDD에 넘길 단위 — 아토믹 후보)

> **현 §G-7 T7(F4·B-6) 한 줄**을 아래로 풀어쓴 것. 본 목록은 SDD 작성 시 그대로 태스크 표로 옮길 수 있다.
> **세부 결정 일부는 §G-11.5(D-G1)에 남아 있으며, 그것이 닫혀야 SDD 본격 착수 가능.**

#### 그룹 D — 데이터·백엔드 (선결)
- **U1. 컬렉션 설계 + 마이그레이션** — `banners/main_hero` 단건 → 다중 슬롯 구조 확정(단일 컬렉션 `banners/*` + `kind` 또는 두 경로). 기본 배너 1장 보장 규칙(레코드 1건만, 삭제 불가 또는 마지막 1장 보호).
  - 마이그레이션: 기존 `banners/main_hero` 1건을 `kind:'default'` 1건으로 복제(원본 보존 또는 삭제 — SDD 확정).
- **U2. CRUD 엔드포인트** — `GET/POST/PUT/DELETE /admin/banners`(목록·생성·수정·삭제) + 기본 배너 단건 엔드포인트(또는 통합). 입력 검증: 기간 한정은 `startDate`·`endDate` 필수, `endDate >= startDate`.
- **U3. 손님용 조회 변경** — `GET /banner`(현 단건) → `GET /banners/active`(오늘 날짜에 들어맞는 기간 한정 N건 + 기본 배너 1건). 정렬 = `createdAt desc`. **revalidate 정책 유지**(현재 60s).

#### 그룹 E — 어드민 UI (목록형으로 재구성)
- **U4. 배너 목록 화면** — `banner/_client.tsx` 현재 한 장 편집 폼 → 목록(테이블/카드 반응형) + "새 배너" 버튼. 행별 수정·삭제. 기본 배너는 별도 섹션(또는 행 강조)으로 노출, 삭제 버튼 비노출.
- **U5. 배너 추가/수정 폼** — 기존 3개 섹션(`BannerImageSection`/`BannerTextSection`/`BannerCtaSection`) 재사용 + **`DatePickerInput` 2개(시작·종료)** 추가. `kind === 'default'`이면 기간 입력 숨김.
- **U6. 입력 검증** — 저장 단계에서 `endDate < startDate`, 과거 종료일만 잡은 배너 차단(어드민에 안내). G-3(CTA 빈 href) 검증과 한 묶음 가능.
- **U7. `useAdminBanner` → `useAdminBanners` hook 재구성** — 단건 load/save → 목록 load + 단건 mutate(create/update/delete). G-2(useEffect 의존성 결함)는 본 재구성으로 자연 해소.

#### 그룹 F — 손님 화면 (캐러셀)
- **U8. `HeroBanner` 캐러셀화** — 현 단건 fetch + `isActive` 분기 → 목록 fetch + 캐러셀 컴포넌트(`@mantine/carousel` 또는 자체 슬라이드). 빈 목록 + 기본 배너만 있는 경우 = 기본 배너 1장만 정적 표시(캐러셀 불필요).
- **U9. SSR 안전성** — 현 `HeroBanner`가 server component(`async function`)인 점 유지하면서 캐러셀(클라이언트) 분리. `next: { revalidate: 60 }` 보존.

### G-11.5 선결 결정 (D-G1, 별도 SDD 착수 전 — grill-me/사용자 확정 필요)
- **D-G1-a. 캐러셀 동작** — 자동 슬라이드 간격(예: 5초)인가, 손가락/버튼 넘김만인가? 인디케이터(점) 노출?
- **D-G1-b. 기본 배너 + 기간 배너 캐러셀 배치** — 기본 배너도 캐러셀의 한 슬라이드로 들어가는가, 아니면 "기간 배너 0개일 때만" 단독 표시?
- **D-G1-c. 데이터 모델 분기** — 단일 컬렉션 `banners/*` + `kind` 필드(쿼리 시 분기) vs 두 경로 분리(`banners/default` 단건 + `banners/scheduled/*` 컬렉션). 마이그레이션 난이도·손님 fetch 횟수 트레이드오프.
- **D-G1-d. 임시 정지 스위치 유지 여부** — 현 `isActive` 스위치(`_client.tsx:69`)를 새 모델에서도 둘지. "기간=활성"으로만 운영하면 스위치 중복.

### G-11.6 §G-7 본체와의 관계
- **G-7 그룹 A(T1~T3, 결함 해소: useEffect·CTA·에러 표시)** = **본 G-11과 독립 진행 가능.**
  - 단 U7(`useAdminBanners` hook 재구성)이 T1(useEffect 결함)을 자연 해소하므로, **G-11 착수가 가까우면 T1은 묶어서 진행 권장.**
  - T2(CTA 비대칭 검증)·T3(에러 표시)는 G-11과 무관, 먼저 가볍게 처리 가능.
- **G-7 그룹 B(T4 미리보기·T5 업로드 가드·T6 CTA 반응형)** = **G-11 이후 또는 병행.** T4(미리보기)는 다중 배너 모델 확정 후 "어느 배너의 미리보기인가"가 자연스럽게 정해진다.
- **G-7 그룹 C(T7)** = **본 §G-11이 그 T7의 선행 결정·작업 목록을 풀어쓴 것.** SDD 작성 시 T7은 본 G-11.4의 U1~U9로 치환.

### G-11.7 차기 진입점
- **선결 = §G-11.5(D-G1) 4개 하위 결정** grill-me 또는 사용자 추가 확정. → **§G-11.8에서 닫힘(2026-05-26).**
- **닫히면 = 별도 SDD 문서 작성**(예: `docs/specs/frontend/admin-banner-multi-sdd.md`)에 본 §G-11.1~G-11.6 + §G-11.8을 옮기고 U1~U9를 T 태스크 표로 풀어 진행.
- **병행 가능 = G-7 그룹 A T2·T3**(CTA 검증·에러 표시) — G-11과 무관, 가벼움.

### G-11.8 grill-me 확정 (2026-05-26, 13건)

> §G-11.5 D-G1 4개 하위 결정 + §G-7 본체 가정 + §G-11.4 누락 명세를 grill-me로 한 번에 닫음. 별도 SDD 작성 시 본 표를 그대로 옮긴다.

| ID | 결정 | 근거 |
|----|------|------|
| **Q1 (D-G1-c)** | **단일 컬렉션 `banners/*` + `kind: 'default' \| 'scheduled'` 필드** | 손님 fetch 1회, 마이그레이션 1줄(`main_hero`에 `kind:'default'` add). "기본 1장 보호"는 백엔드 invariant(DELETE 차단 422)로 강제. |
| **Q2** | **기존 `banners/main_hero` 문서 ID 유지** | ID는 내부 키, 변경하면 마이그레이션 비용만 증가. |
| **Q3 (D-G1-b)** | **기본 배너도 캐러셀에 포함, 항상 마지막 슬라이드** | `createdAt desc` 정렬상 마이그레이션 시점의 기본 배너는 자연히 최하위. G-11.2 성공 기준이 이미 전제. |
| **Q4 (D-G1-a)** | **자동 5초 + 인디케이터(점) + stopOnInteraction/Hover** | 노출 효율 + 접근성(`prefers-reduced-motion`은 `@mantine/carousel`이 자동 존중). |
| **Q5 (D-G1-d)** | **`isActive` 토글 제거** | "기간=활성"과 중복. 긴급 차단은 삭제로(soft delete는 별도). `_client.tsx:69` Switch + hook 필드 제거, 기존 문서의 `isActive` 값은 무시(dead field). |
| **Q6** | **손님 쿼리 = `kind` 기준 전건 fetch + 서버사이드 today 필터링** | Firestore 복합 인덱스 회피(세션80 선례). 배너 수십건 이하 가정. 수백건 도달 시점에 인덱스 추가(YAGNI). |
| **Q7** | **T1(useEffect 결함) 단독 선행** | SDD 작성 기간 1주 이상 예상 → 그 사이 입력 유실 위험 단기 차단. U7에서 일부 재작업 발생 수용. |
| **Q8** | **T2(CTA 검증)·T3(에러 표시) G-11 이전 선행** | T2는 폼 컴포넌트 재사용으로 G-11에서도 살아남음. T3는 에러 전파 패턴 선례를 만들어 U7에서 재사용. |
| **Q9** | **T4(라이브 미리보기) G-11 SDD 안으로 흡수** | 목록+행별 편집 구조에서 U5(추가/수정 폼) 옆 패널로 설계. G-11 전에 만들면 재배치 강제. |
| **Q10** | **T5 둘로 분리: T5a(가드, 독립) / T5b(orphan cleanup, U2 안)** | 다중 배너로 이미지 N배 → cleanup 누락 시 누적. cleanup은 DELETE 엔드포인트에 묶어 누락 차단. |
| **Q11** | **U8에 "슬라이드 1장이면 자동·인디케이터 비활성, 정적 표시" 명시** | 마이그레이션 직후 = `kind:'default'` 1건만 존재 상태에서 회귀 0 보장. |
| **Q12** | **종료일 당일 종일 노출: `endDate >= todayKST()`** | "9/1~9/7 입력 → 9/7 종일 노출"이 직관 일치. 세션85 `todayKST()` 문자열 비교로 자정 경계 자동 처리. |
| **Q13** | **만료 배너도 목록 유지 + "만료" 배지** | 보관함 분리 추가 비용 회피. 재사용 용이. 자동 정리는 별도 SDD(soft delete 권고). |

#### G-11.8.1 확정 결과가 §G-11.4 작업 목록에 미치는 영향
- **U1 컬렉션 설계** → Q1·Q2로 확정: 단일 컬렉션, 기존 문서 ID 유지, `kind:'default'` add 1줄 마이그레이션.
- **U1 기본 배너 보호** → Q5와 연계: `kind:'default'` 문서 DELETE 차단(controller 422) + 1건만 존재 invariant. 유닛 테스트 1건 권고.
- **U2 입력 검증** → Q12 적용: `endDate >= startDate` + 과거 종료일 차단. G-3(CTA 빈 href) 검증 한 묶음.
- **U2 DELETE 엔드포인트** → T5b(Q10) 흡수: Storage orphan cleanup 동반.
- **U3 손님 쿼리** → Q6·Q12 적용: `where('kind','==','scheduled')` 전건 + `where('kind','==','default').limit(1)` → 서버에서 `endDate >= todayKST() && startDate <= todayKST()` 필터. `revalidate: 60` 유지.
- **U4 어드민 목록** → Q13 적용: 만료 배지 추가. 기본 배너 행은 삭제 버튼 비노출 + 별도 강조.
- **U5 폼** → Q5 적용: `isActive` Switch 제거. `kind === 'default'`이면 기간 입력 숨김.
- **U7 hook** → Q7과 연계: T1 단독 선행했어도 U7에서 단건 → 목록 hook 재구성으로 통합 흡수.
- **U8 캐러셀** → Q3·Q4·Q11 적용: `@mantine/carousel`, 자동 5초+인디케이터+stopOn*, 기본 배너 마지막 슬라이드, 1장이면 정적 표시.
- **U9 SSR** → Q6 결과를 server component에서 처리, 클라이언트 캐러셀에 props 전달, `revalidate: 60` 보존.

#### G-11.8.2 별도 SDD 작성 시 옮길 항목
1. §G-11.1 운영 모델 표.
2. §G-11.2 성공 기준 1문장.
3. §G-11.4 U1~U9 + §G-11.8.1 영향 반영.
4. §G-11.8 확정 표(Q1~Q13) 전체.
5. C8·C9 정합성 기준 + §0 C1~C7.

#### G-11.8.3 차기 진입점 (갱신)
- **즉시 가능 = T2·T3 단독 진행**(Q8). T1은 T2·T3 직후 또는 동시.
- **그 다음 = 별도 SDD 문서 작성**(`docs/specs/frontend/admin-banner-multi-sdd.md`). §G-11.8.2 항목을 옮긴 뒤 U1~U9를 T 태스크로 풀어 착수.
- **T4·T5b는 SDD에 흡수**(Q9·Q10), 별 태스크 만들지 말 것.
- **T5a는 SDD 전/후 어느 시점이든 가능**(Q10).

---

## G-11.9 세션별 실행 플랜 → 별도 SDD로 이전

> §G-11.8 확정 결과를 바탕으로 한 **세션별 실행 플랜(작업 순서·아토믹 분해·정합성·e2e)** 은 본 문서 500라인 한도 보호를 위해 별도 SDD로 이전됨(2026-05-26).

- **다중 배너 SDD (세션별 플랜·e2e 포함):** [`./admin-banner-multi-sdd.md`](./admin-banner-multi-sdd.md)
  - §3 세션별 실행 플랜 (S1~S7, Phase 0~6)
  - §4 위험·롤백
  - §5 차기 진입점 = **세션 S1 (T2·T3 결함 해소)**
---

## 참고 문서

### 본 탭이 직접 참조하는 외부 문서
- **다중 배너 SDD (G-11 후속 — 작성 완료, 2026-05-26):** [`./admin-banner-multi-sdd.md`](./admin-banner-multi-sdd.md)
  - §3 세션별 실행 플랜(S1~S7) · §4 위험·롤백 · §5 차기 진입점.
  - 본 모(母) 문서는 §G-11.1~G-11.8(운영 모델·확정 결과·D-G1)만 유지. 세션별 플랜은 SDD가 SSOT.
- **육안 검증 (코드 완료 후 §추가)** — [`../pending-visual-verify.md`](../pending-visual-verify.md) — T4(라이브 미리보기)·T6(CTA 반응형) + G-11.2 성공 기준 장면.
- **선결 결정 (D-G1 4건)** — grill-me 대기. 캐러셀 동작/배치/데이터 모델/임시 정지 스위치.
- **선결 결정·별도 SDD 후보 (이번 범위 제외)**
  - **F3 CTA 내부 라우트 검증/Select** — 저우선, 본 모델과 독립.
  - **F7 만료기간 7일 외 다른 값** — invite 탭과 무관, 본 모델과 직교.

### 상위 인덱스 · 로드맵
- 통합 인덱스: [`../admin-tabs-improve-plan.md`](../admin-tabs-improve-plan.md)
- 멀티앱 리팩토링 로드맵: [`../app-refactor-roadmap.md`](../app-refactor-roadmap.md)

### 인접 어드민 탭
- [stores](./admin-tab-stores-plan.md) · [orders](./admin-tab-orders-plan.md) · [drivers](./admin-tab-drivers-plan.md) · [settlements](./admin-tab-settlements-plan.md) · [users](./admin-tab-users-plan.md) · [invite](./admin-tab-invite-plan.md)

### 선례
- 세션91 SDD 분리 — `cb2d114` banner 탭 SDD 분리(223→97, 섹션 3분할). 순수함수 부재로 `_lib` 미생성.
- 세션88 어드민 반응형 — 테이블 5개만 대상, 배너 탭 미포함(R1 모바일 폭 미검증의 근거).
- 세션85 타임존 KST 보정 — C9(기간 경계 자정 KST) 직접 선례.
- 세션86 정산 status 필터 — C6(로딩·실패·빈상태 구분) 가드 패턴.
