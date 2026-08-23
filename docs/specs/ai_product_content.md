# AI 상품 콘텐츠 — 역사 설계·구현 기록

> 원 작성 시점: 2026-04
> 최종 문서 정합화: 2026-08-23 KST
> 상태: **Historical design / implementation record**
>
> 이 파일은 AI 상품 상세 자동화가 도입될 당시의 설계 의도와 구현 단계를 보존한다. 현재 API·DTO·상품 schema의 정본이 아니며, 본문의 과거 `구현 대기`, 단계 체크리스트, 모델명, 필수/선택 필드 정의를 현재 작업 지시로 사용하지 않는다.

## 현재 계약을 확인하는 경로

AI 상품 콘텐츠를 수정하거나 회귀를 조사할 때는 다음 순서로 확인한다.

1. `apps/api/src/ai/**` — 현재 controller/service/guardrail/DTO
2. `apps/api/src/varieties/**` — 품종 가드레일 데이터 API
3. `packages/shared/src/product.types.ts` — 현재 `Product`, `Selection`, `GeneratedContent` 타입
4. `docs/specs/api/products.md` — 현재 상품 API/domain 계약
5. 실제 seller/consumer 사용처와 직접 관련 테스트

현재 `main` 코드가 이 문서의 과거 설계와 다르면 **현재 코드·공유 타입·current products spec이 우선**한다.

## 현재 코드와 과거 설계가 이미 달라진 예

원 계획을 현재 계약으로 재사용하면 안 되는 대표 차이:

- 현재 `Product`의 AI 관련 필드(`varietyId`, `selection`, `sellerNote`, `content`, `sellerOverride`)는 공유 타입에서 optional이다.
- 현재 `Selection`에는 과거 초안에 없던 `stemType`이 필수이며 `careLevel`도 지원된다.
- `/ai/generate-content`는 현재 `JwtAuthGuard`로 보호된다.
- 현재 요청 DTO는 `varietyId?`, `category?`, `selection`, `sellerNote?` 구조이며 `selection`에 `colors`, `stemType`, `fragrance`, `bloomCondition`, `bundleUnit`, `careLevel?`을 사용한다.
- guardrail 검증은 현재 품종의 향기 정보와 seller note/선택값 충돌, `typicalColors` 밖의 색상 선택을 warning으로 반환한다.
- AI provider 초기화·모델명·오류 처리 방식은 `apps/api/src/ai/ai.service.ts`를 직접 확인한다. 이 문서의 과거 모델명 기록을 운영 설정 정본으로 사용하지 않는다.

## 당시 설계 목표

초기 목표는 판매자가 상품의 사실 정보를 직접 입력하고 AI가 이를 자연스러운 상품 설명으로 조합하는 **Fact-Based Composition**이었다.

핵심 개념은 다음과 같았다.

- 판매자 입력 상품명과 AI 생성 headline을 분리
- 품종 가드레일 DB와 판매자 메모·선택 정보를 조합
- 향기·색상 등 확인 가능한 품종 정보와 입력이 충돌하면 warning 제공
- 판매자가 경고를 확인한 뒤 실제 상품 특성에 따라 예외 등록할 수 있는 흐름
- AI가 만든 headline/description을 판매자가 최종 편집 가능
- 소비자 상품 상세에는 구조화된 품종·선택 정보와 생성 콘텐츠를 표시

이 철학은 현재 구현을 이해하는 배경으로는 유효하지만, 세부 필드와 화면 단계는 현재 코드를 다시 확인한다.

## 당시 구현 범위 기록

2026-04 작업에서 다음 영역이 도입됐다.

### 공유 타입·데이터

- `Product`에 품종/선택/판매자 메모/생성 콘텐츠/override 관련 필드 추가
- `Variety` 타입과 `varieties` 데이터 도입
- 기존 `description`·`colors` 호환 경로 유지

### API

- `varieties` 조회·관리 모듈
- `POST /ai/generate-content`
- 상품 생성/수정 시 AI 관련 필드 저장
- 품종 정보 기반 guardrail warning

### Seller

- 품종 선택
- 색상·향기·개화 상태·판매 단위 등 구조화 입력
- 판매자 메모
- AI 생성 결과 미리보기·편집
- 충돌 warning 확인 흐름

### Consumer

- AI headline/description 표시
- 구조화된 상품 속성 표시
- 마이그레이션 기간 구 필드 fallback

정확한 현재 화면 존재 여부·단계 순서·컴포넌트 이름은 seller/consumer 현재 소스를 확인한다.

## 역사적 설계 결정

당시 중요하게 본 원칙:

- 가드레일 데이터는 AI 추측보다 우선한다.
- AI 생성 결과를 판매자가 통제할 수 있어야 한다.
- 구 상품과 신규 상품을 동시에 읽을 수 있도록 마이그레이션 호환성을 둔다.
- AI 생성 콘텐츠와 고정 브랜드 설명을 구분한다.
- 모델/provider 호출 실패가 상품 데이터의 사실 계약을 바꾸면 안 된다.

## 현재 작업에서 금지하는 해석

이 문서를 보고 다음을 자동 실행하지 않는다.

- 과거 `GEMINI_API_KEY`·모델명을 현재 production 환경에 적용
- Firestore 품종 시드·마이그레이션 재실행
- 과거 체크박스를 현재 미완료 Backlog로 복원
- 과거 schema를 기준으로 현재 shared type을 되돌림
- 실제 provider/API 호출을 문서 검증 목적으로 실행

환경 변수·외부 AI provider·운영 데이터 변경은 현재 Task의 별도 승인 경계를 따른다.

## 재설계가 필요할 때

AI 상품 콘텐츠를 다시 확장하려면 과거 Phase 순서를 이어서 실행하지 않고 새 Task로 시작한다.

최소 확인 항목:

- 현재 shared product/variety 타입
- 현재 AI endpoint의 인증·입력·응답·오류 계약
- provider SDK와 모델 지원 상태
- seller 입력 UX와 consumer 노출 요구
- 생성 콘텐츠의 사실성·편집·fallback 정책
- 단위 테스트와 API 회귀 테스트
- 운영 secret/provider 변경 승인 경계

## 관련 문서

- Specs router: `docs/specs/README.md`
- Products current spec: `docs/specs/api/products.md`
- 현재 상태: `docs/memory.md`
- 프로젝트 라우팅: `docs/PROJECT_MAP.md`

원래의 상세 구현 계획과 단계별 체크리스트는 Git history에 보존되어 있으며, 과거 결정의 상세 배경이 필요할 때만 조회한다.
