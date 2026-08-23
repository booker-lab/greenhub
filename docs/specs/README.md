# Specs 문서 라우팅

> `docs/specs`는 **현행 도메인 계약**과 **구현 전 계획 문서**가 섞여 있다. 파일명에 `specs`가 포함된 경로라고 해서 모두 현재 계약은 아니다.

## 현행 핵심 명세

- 회차 직배송: `mvp-sales-round-direct-delivery.md`
- API: `api/README.md`에서 현행 domain spec 선택
- 운영: `ops/README.md`
- 법적 문서: `legal/consumer-legal-documents.md`
- frontend: `frontend/README.md`의 라우팅 규칙을 먼저 확인

AI 상품 콘텐츠는 실제 대상 코드와 `ai_product_content.md`를 함께 확인한다.

## 역사 계획

다음은 `docs/memory.md` 또는 `docs/BACKLOG.md`에서 다시 활성화하지 않는 한 기본적으로 역사 자료다.

- 파일명 `*-plan.md`
- `*-roadmap.md`
- 구현 전 SDD/리팩터링 계획
- 특정 과거 테스트/시각 검증 체크리스트

예: `seller-order-group-refactor-plan.md` 같은 문서는 현재 회차 주문 계약보다 우선하지 않는다.

## 충돌 시

현재 `main` 코드·공유 타입·테스트와 문서가 충돌하면 현재 구현을 검증한 뒤 **현행 spec을 수정**한다. 과거 계획을 코드 위에 우선시키지 않는다.

진행 상태·외부 심사·배포 여부는 spec에 복제하지 않고 `docs/memory.md`에서 관리한다.
