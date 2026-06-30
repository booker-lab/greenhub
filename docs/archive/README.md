# Archive 문서 허브

**`docs/archive/`는 완료되었거나 현재 SSOT가 아닌 문서를 보관하는 영역이다.** 활성 작업의 기준은 `docs/`, `docs/specs/`, `docs/plans/`의 현재 문서를 우선한다.

## 하위 영역

| 폴더 | 보관 대상 |
|------|-----------|
| [sessions/](sessions/) | 세션 준비·결과·다음 작업 기록 |
| [frontend/](frontend/) | 종결된 프론트 시각 검증 handoff |
| [design/](design/) | 과거 설계 문서 |
| [migrations/](migrations/) | 종결된 마이그레이션 계획 |
| [ops/](ops/) | 운영 데이터 보정 결과 원본 |
| [qa/](qa/) | 과거 QA 체크리스트 |

## 참조 규칙

- 과거 근거가 필요할 때만 archive 문서를 연다.
- archive의 긴 로그는 원문 보존을 우선하며, 활성 문서의 500라인 분리 기준과 별도로 다룬다.
- archive에서 재개되는 작업은 `docs/specs/` 또는 `docs/plans/`에 현재 기준 문서를 새로 만든 뒤 진행한다.
