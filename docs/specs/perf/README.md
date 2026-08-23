# Performance spec 문서 라우팅

> `docs/specs/perf/`의 파일들은 2026-04 성능 측정과 당시 코드 구조를 전제로 작성된 **최적화 계획/분석 기록**이다. 현재 성능 baseline이나 즉시 실행할 Task 목록으로 사용하지 않는다.

## 현재 분류

다음 문서는 모두 historical optimization record다.

- `image-optimization.md` — 당시 `next/image` 전환 계획과 2026-04 Lighthouse baseline
- `bundle-optimization.md` — 당시 번들 분석·HeroBanner SSR 전환 제안
- `mantine-treeshaking.md` — 당시 Mantine tree-shaking 검토
- `redirect-optimization.md` — 당시 redirect/렌더링 최적화 검토

문서 안의 `현재`, `필수`, `진행 금지`, 성능 수치, 파일 줄번호, 실행 명령은 **작성 당시 기준**이다. `docs/memory.md` 또는 `docs/BACKLOG.md`가 명시적으로 재활성화하지 않는 한 현재 지시로 승계하지 않는다.

## 현재 성능 작업을 시작할 때

1. 최신 `main` SHA를 고정한다.
2. 대상 앱의 현재 코드와 `next.config.*`, package script를 먼저 확인한다.
3. production을 변경하는 측정 대신 가능한 한 Preview/격리 환경에서 baseline을 다시 만든다.
4. Lighthouse, Web Vitals, bundle 분석은 측정 시각·환경·SHA를 함께 기록한다.
5. 과거 수치와 새 수치를 직접 이어 붙이지 않는다.
6. 실제 병목이 확인된 항목만 새 Task/Backlog로 올린다.

현재 출시에서 정식 부하테스트 재개 조건은 `docs/BACKLOG.md`의 `LOAD-TEST-FORMAL`과 `docs/specs/ops/k6-load-test-plan.md`를 따른다.

## 성능 증거 저장 위치와 구분

- `docs/performance/README.md` — 과거 Lighthouse/load raw artifact의 보존·해석 규칙
- `docs/specs/perf/` — 과거 최적화 아이디어와 설계 기록

둘 다 현재 baseline의 자동 정본이 아니다. 최신 성능 판단은 현재 SHA에서 새로 측정한 증거를 사용한다.
