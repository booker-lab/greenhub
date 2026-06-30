# Frontend Specs 문서 허브

**프론트엔드 명세는 사용자 앱별로 나누고, 장문 육안 검증은 별도 SSOT로 분리한다.**

## 공통 기준

| 문서 | 용도 |
|------|------|
| [manual-visual-verify-checklist.md](manual-visual-verify-checklist.md) | 수동 시각 검증 진행 원칙 |
| [preview-visual-verify-policy.md](preview-visual-verify-policy.md) | 프리뷰 배포 시각 검증 정책 |
| [pending-visual-verify.md](pending-visual-verify.md) | 미완료 시각 검증 통합 목록 |
| [visual-verify-fix-backlog.md](visual-verify-fix-backlog.md) | 시각 검증 후속 수정 목록 |

## 앱별 주요 문서

| 영역 | 주요 문서 |
|------|-----------|
| 소비자 | [consumer-stores-tab-improve-plan.md](consumer-stores-tab-improve-plan.md), [consumer-groupbuy-tab-improve-plan.md](consumer-groupbuy-tab-improve-plan.md), [consumer-home-groupbuy-improve-plan.md](consumer-home-groupbuy-improve-plan.md) |
| 판매자 | [seller-orders-refactor-plan.md](seller-orders-refactor-plan.md), [seller-refactor-visual-verify.md](seller-refactor-visual-verify.md), [seller-refactor-f-visual-path.md](seller-refactor-f-visual-path.md), [seller-refactor-m-path.md](seller-refactor-m-path.md) |
| 드라이버 | [driver-app-refactor-plan.md](driver-app-refactor-plan.md), [driver-kakao-map-plan.md](driver-kakao-map-plan.md) |
| 관리자 | [admin/admin-tab-users-plan.md](admin/admin-tab-users-plan.md), [admin/admin-tab-orders-plan.md](admin/admin-tab-orders-plan.md), [admin/admin-tab-settlements-plan.md](admin/admin-tab-settlements-plan.md), [admin/admin-tab-drivers-plan.md](admin/admin-tab-drivers-plan.md) |
| 디자인 시스템 | [design-system-refactor-plan.md](design-system-refactor-plan.md), [button-size-unify-plan.md](button-size-unify-plan.md), [app-refactor-roadmap.md](app-refactor-roadmap.md) |

## 정리 기준

- 상위 계획 문서에는 범위, 태스크, 완료 여부를 둔다.
- 긴 실행 동선은 `*-visual-path.md` 또는 `*-handoff-YYYYMMDD.md`로 분리한다.
- 이미 종결된 날짜별 handoff는 `docs/archive/frontend/`로 이관한다.
- 운영 쓰기가 필요한 수동 검증은 위험도를 명시하고, 읽기 전용 검증과 분리한다.
