# Specs 문서 허브

**`docs/specs/`는 구현보다 먼저 갱신하는 SDD 명세 영역이다.** 도메인 계약, 화면 동선, 운영 파이프라인, 성능 개선 계획은 이 폴더에서 출발한다.

## 하위 영역

| 폴더 | 역할 | 대표 문서 |
|------|------|-----------|
| [api/](api/) | API 도메인 계약과 백엔드 리팩토링 계획 | [orders.md](api/orders.md), [settlements.md](api/settlements.md), [admin.md](api/admin.md) |
| [frontend/](frontend/README.md) | 소비자·판매자·드라이버·관리자 앱 화면 명세 | [manual-visual-verify-checklist.md](frontend/manual-visual-verify-checklist.md) |
| [frontend/admin/](frontend/admin/) | 관리자 탭별 SDD와 아토믹 태스크 | [admin-tab-users-plan.md](frontend/admin/admin-tab-users-plan.md) |
| [ops/](ops/) | 배포·릴리스·운영 데이터 정리 계획 | [staged-preview-release-pipeline.md](ops/staged-preview-release-pipeline.md) |
| [perf/](perf/) | 성능 최적화 계획 | [image-optimization.md](perf/image-optimization.md), [bundle-optimization.md](perf/bundle-optimization.md) |

## 작성 기준

- 문서명은 `대상-기능-계획.md` 또는 `도메인.md` 형식을 우선한다.
- 구현 태스크는 체크박스로 남기고, 완료 시 `[x]`로 갱신한다.
- 자동 검증, 수동 검증, 운영 쓰기 검증은 섞지 않고 구분한다.
- 500라인에 가까워지면 실행 로그·긴 체크리스트를 별도 문서로 분리한다.
