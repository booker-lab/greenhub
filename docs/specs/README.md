# Specs 문서 라우팅

> `docs/specs`는 **현행 도메인 계약**과 **구현 전 계획 문서**가 섞여 있다. 파일명에 `specs`가 포함된 경로라고 해서 모두 현재 계약은 아니다.

## 현행 핵심 명세

- 회차 직배송: `mvp-sales-round-direct-delivery.md`
- API: `api/README.md`에서 현행 domain spec 선택
- 운영: `ops/README.md`
- 법적 문서: `legal/README.md`를 먼저 열고, 현재 공개 문안 정본은 `legal/consumer-legal-documents.md`를 사용
- frontend: `frontend/README.md`의 라우팅 규칙을 먼저 확인

AI 상품 콘텐츠는 현재 전용 domain router가 없다. 실제 계약을 확인할 때는 `apps/api/src/ai/**`, 관련 seller/consumer 코드와 `api/products.md`를 우선하고, `ai_product_content.md`는 구현 배경·필드 설계 참고자료로 함께 본다. 문서 상단의 과거 상태 문구나 단계 체크리스트를 현재 진행 상태로 사용하지 않는다.

성능 최적화 문서는 `perf/README.md`를 먼저 확인한다. `perf/*.md`의 2026-04 성능 수치와 실행 계획은 현재 baseline이 아니라 historical optimization record다.

## 역사 계획

다음은 `docs/memory.md` 또는 `docs/BACKLOG.md`에서 다시 활성화하지 않는 한 기본적으로 역사 자료다.

- 파일명 `*-plan.md`
- `*-roadmap.md`
- 구현 전 SDD/리팩터링 계획
- 특정 과거 테스트/시각 검증 체크리스트
- `perf/README.md`가 historical로 분류한 과거 최적화 분석

예: `seller-order-group-refactor-plan.md` 같은 문서는 현재 회차 주문 계약보다 우선하지 않는다.

## 충돌 시

현재 `main` 코드·공유 타입·테스트와 문서가 충돌하면 현재 구현을 검증한 뒤 **현행 spec을 수정**한다. 과거 계획을 코드 위에 우선시키지 않는다.

진행 상태·외부 심사·배포 여부는 spec에 복제하지 않고 `docs/memory.md`에서 관리한다.
