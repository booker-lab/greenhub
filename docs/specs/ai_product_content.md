# AI 상세페이지 자동화 시스템 — 구현 계획서

> 최종 수정: 2026-04-19  
> 상태: 설계 확정, 구현 대기

---

## 핵심 철학

**Fact-Based Composition** — 임의 분석이 아닌 확인된 사실의 조합.  
사진 분석의 불확실성을 제거하고, 판매자의 실제 지식 + 가드레일 DB를 조합하여 신뢰도 높은 상세페이지 자동 생성.

---

## 확정된 설계 결정

| 항목 | 결정 내용 |
|------|------|
| 색상 필드 | 기존 `colors[]` 유지, `selection`의 일부로 편입 |
| 설명 입력 | 기존 `description` → `sellerNote`로 역할 전환 |
| 상품명 | `name`(판매자 입력) + `headline`(AI 생성) 공존 |
| headline 수정 | 셀러가 수정한 버전 저장, 재생성으로 덮어쓰기 금지 |
| 카테고리 | MVP는 호접란(phalaenopsis) 20~30종 집중 |
| 가드레일 DB | Firestore 수동 입력, 필요 시 Claude가 대신 추가 |
| AI 모델 | Gemini 3 Flash Preview — `gemini-3-flash-preview` (Google AI Studio API 키) |
| 가드레일 충돌 | AI 수정 제안 + 판매자 강행 등록 허용 (`sellerOverride: true`) |

---

## 시스템 아키텍처

```
셀러 앱 (Next.js 15)
  ├─ Step 1: 품종 선택 (varietyId)
  ├─ Step 2: 터치 선택 (color, fragrance, bloom, unit)
  ├─ Step 3: 판매자 메모 (sellerNote)
  ├─ Step 4: AI 미리보기 (headline + description 편집)
  └─ Step 5: 게시

NestJS API
  ├─ /varieties           — 가드레일 DB CRUD
  ├─ /ai/generate-content — Gemini 호출 + 충돌 검증
  └─ /products            — 기존 + 신규 필드 저장

Firestore
  ├─ products/            — 기존 컬렉션 + 신규 필드
  └─ varieties/           — 가드레일 DB (신규)

Google Gemini 3 Flash API
```

---

## 스키마 정의

### packages/shared — 신규/변경 타입

```typescript
interface Selection {
  colors: ColorOption[]
  fragrance: 'none' | 'light' | 'strong'
  bloomCondition: 'bud' | 'half' | 'full'
  bundleUnit: string
}

interface GeneratedContent {
  headline: string
  description: string
  isEditedByUser: boolean
}

// Product 인터페이스 변경사항
// 제거: description, colors
// 추가: varietyId, selection, sellerNote, content, sellerOverride
interface Product {
  id: string
  storeId: string
  name: string                 // 내부 식별용 정식 상품명 (판매자 입력)
  price: number
  category: Category
  images: string[]
  saleType: SaleType
  deliverySize: DeliverySize
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  varietyId: string
  selection: Selection
  sellerNote: string
  content: GeneratedContent
  sellerOverride: boolean
}
```

### Firestore — varieties 컬렉션 (신규)

```typescript
interface Variety {
  id: string
  name: string                 // "아마빌리스 계열"
  category: Category           // "orchid"
  subCategory: string          // "phalaenopsis"
  hasFragrance: boolean
  fragranceLevel: 'none' | 'light' | 'strong'
  bloomDuration: string        // "60~90일"
  careLevel: 'easy' | 'normal' | 'hard'
  typicalColors: ColorOption[]
  notes: string
  createdAt: Date
}
```

---

## 가드레일 충돌 처리

**우선순위**: 가드레일 DB > 판매자 메모 > 터치 선택

**충돌 감지 규칙**:
- `hasFragrance: false`인데 메모에 "향기" 포함 시 충돌
- `typicalColors`에 없는 색상 선택 시 경고

**처리 흐름**:
```
AI 제안: "이 품종은 원래 향기가 없다고 알려져 있어요. 수정할까요?"

판매자 선택:
  ① 수정 반영 → AI가 내용 제거 후 재생성
  ② 그대로 등록 → sellerOverride: true 저장
```

`sellerOverride: true` 누적 시 → 해당 품종 가드레일 DB 재검토 신호로 활용.

---

## Phase A — 데이터 기반 구축

- [x] A1. `packages/shared/src/product.types.ts` — `Selection`, `GeneratedContent` 인터페이스 추가, `Product` 업데이트
- [x] A1. `packages/shared/src/variety.types.ts` — `Variety` 인터페이스 신규 생성
- [ ] A2. Firestore `varieties` 컬렉션 생성 + 호접란 10종 시드 입력 ← **다음 세션 착수**
- [x] A3. 기존 Product 데이터 마이그레이션 스크립트
  - `colors[]` → `selection.colors`
  - `description` → `sellerNote`
  - `content.headline` = `name` 초기값
  - `content.isEditedByUser: true`
  - `sellerOverride: false`

---

## Phase B — NestJS: Varieties 모듈

- [x] B1. `apps/api/src/varieties/varieties.module.ts` 생성 + AppModule 등록
- [x] B2. `dto/create-variety.dto.ts` — class-validator 데코레이터 포함
- [x] B3. `varieties.service.ts` — `findAll`, `findOne`, `create`, `update`
- [x] B4. `varieties.controller.ts`
  - `GET /varieties` — 카테고리별 조회 (셀러 품종 선택용)
  - `GET /varieties/:id` — 단건
  - `POST /varieties` — 신규 (JwtAuthGuard)
  - `PATCH /varieties/:id` — 수정

---

## Phase C — NestJS: AI 콘텐츠 생성 모듈

- [x] C1. `GEMINI_API_KEY` 환경 변수 추가, `@google/generative-ai` 패키지 설치
- [x] C2. `apps/api/src/ai/ai.service.ts` — Gemini 3 Flash Preview (`gemini-3-flash-preview`) 클라이언트 초기화
- [x] C3. `apps/api/src/ai/prompts/product-content.prompt.ts` — 프롬프트 템플릿
  - 시스템: 가드레일 사실 최우선, sellerNote 매끄럽게 확장, JSON 출력
  - 언어: 한국어, 시니어 친화적
- [x] C4. `apps/api/src/ai/guardrail-validator.service.ts` — 충돌 감지 로직
- [x] C5. `apps/api/src/ai/ai.controller.ts`
  - `POST /ai/generate-content` — Request: `{varietyId, selection, sellerNote}` / Response: `{headline, description, conflicts[]}`

---

## Phase D — NestJS: Products 모듈 업데이트

- [x] D1. `create-product.dto.ts` 수정 — `SelectionDto`, `ContentDto` 중첩 DTO 추가, 기존 `description`/`colors` 제거
- [x] D2. `products.service.ts` — `create()` 신규 필드 저장, `update()` headline 수정 시 `isEditedByUser: true` 자동 세팅

---

## Phase E — 셀러 앱: UI 구현

- [x] E1. `VarietySelector.tsx` — 품종 드롭다운 (카테고리 그룹핑)
- [x] E2. `TouchSelector.tsx` — 향기/개화상태/판매단위 아이콘 버튼 (큰 버튼, 시니어 UX)
- [x] E3. 기존 ColorSelector → `TouchSelector` 섹션에 통합, 상태 변수 `colors[]` → `selection.colors`
- [x] E4. `SellerNoteInput.tsx` — 큰 텍스트에어리어, 힌트 문구, 200자 카운터
- [x] E5. `AIPreviewPanel.tsx`
  - headline / description 편집 가능 필드
  - 가드레일 충돌 경고 Alert (노란색)
  - "수정 반영하기" / "그대로 등록하기" 버튼
  - "다시 생성하기" (편집본 덮어쓰기 확인 모달 포함)
- [x] E6. `ProductForm.tsx` — 5단계 스텝 구조 전환
  ```
  Step 1: 사진 업로드 + 품종 선택
  Step 2: 터치 선택 (색상·향기·개화·단위)
  Step 3: 판매자 메모 입력
  Step 4: AI 미리보기 + 편집
  Step 5: 가격·배송·공동구매 설정 + 게시
  ```
  - Step 3→4 전환 시 `/ai/generate-content` 자동 호출
  - 로컬스토리지 임시저장 각 스텝마다 유지

---

## Phase F — 소비자 앱

- [x] F1. `apps/consumer/src/app/products/[id]/page.tsx` — headline + description 표시 신규 구현
  - 상단: `product.content.headline` — 강조 마케팅 문구 (폰트 크기 업)
  - 본문: `product.content.description` — AI 생성 상세 설명
  - 폴백 처리 (마이그레이션 기간 호환):
    ```typescript
    const headline = product.content?.headline ?? product.name
    const description = product.content?.description ?? product.description
    ```
- [x] F2. `apps/consumer/src/app/products/[id]/page.tsx` — 색상 칩 섹션 추가
  - `selection.colors` 우선, 없으면 `colors` 폴백 (마이그레이션 기간 호환)
- [x] F3. `apps/consumer/src/app/products/[id]/page.tsx` — 상품 속성 테이블 추가
  - `variety` 데이터 + `selection` 데이터를 조합하여 구조화된 테이블로 표시
  - 표시 항목 (가드레일 DB에서 자동 조회):
    | 항목 | 데이터 소스 |
    |------|------|
    | 품종 | `variety.name` |
    | 색상 | `selection.colors` |
    | 향기 | `variety.fragranceLevel` |
    | 개화 상태 | `selection.bloomCondition` |
    | 추천 관상 기간 | `variety.bloomDuration` |
    | 판매 단위 | `selection.bundleUnit` |
  - `varietyId` 없는 기존 상품은 테이블 미표시 (graceful 처리)
- [x] F4. `apps/consumer/src/components/GreenLoveBrandSection.tsx` — 공통 브랜드 섹션 신규 생성
  - 모든 상품 상세 페이지 하단에 고정 노출 (AI 생성 아닌 정적 콘텐츠)
  - 포함 내용:
    - 그린러브 소개 (화훼 농가 직거래 플랫폼)
    - 그린러브 장점 (산지 직송, 중간 유통 없음, 신선도 보장)
    - 판매자(농가) 신뢰 포인트
  - 디자인: 브랜드 컬러 배경, 아이콘 + 짧은 문구 카드 형태
- [x] F5. 상품 상세 페이지 최종 레이아웃 순서 확정
  ```
  1. 상품 이미지
  2. headline (AI 생성 마케팅 문구)
  3. 가격 / CTA 버튼
  4. 속성 테이블 (품종·색상·향기 등)
  5. description (AI 생성 상세 설명)
  6. 색상 칩
  7. ── 구분선 ──
  8. Green Love 브랜드 섹션 (고정)
  ```

---

## 작업 순서 및 의존성

```
A1 (타입 정의)
  ├─→ A2 (가드레일 시드)
  ├─→ A3 (마이그레이션)
  ├─→ B1~B4 (Varieties 모듈)
  ├─→ C1~C5 (AI 모듈)          ← B 완료 후
  ├─→ D1~D2 (Products 업데이트) ← C 완료 후
  └─→ E1~E6 (셀러 앱 UI)       ← D 완료 후
       └─→ F1 (소비자 앱)      ← 병렬 진행 가능
```

---

## 환경 변수 추가

```bash
# apps/api/.env
GEMINI_API_KEY=
```

---

## Phase 2 확장 계획 (MVP 이후)

- 음성 인식(STT): 마이크 버튼으로 sellerNote 음성 입력
- 이미지 비전 분석: 품종 자동 매칭 정확도 향상
- 소비자 상세 페이지: "판매자 직접 확인 정보" 배지 표시 (sellerOverride 상품)
- 품종 관리 화면: Firestore 콘솔 대신 셀러 앱 내 UI
