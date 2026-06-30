# GreenHub 문서 허브

**이 문서는 `docs/` 전체의 진입점이다.** 새 작업을 시작할 때는 먼저 이 파일에서 문서 위치를 확인하고, 변경 범위에 맞는 하위 SSOT를 갱신한다.

## 핵심 문서

| 문서 | 용도 | 갱신 시점 |
|------|------|-----------|
| [memory.md](memory.md) | 현재 세션 인수인계 SSOT | 세션 종료 직전 |
| [CRITICAL_LOGIC.md](CRITICAL_LOGIC.md) | 되돌리면 안 되는 핵심 설계 결정 로그 | 설계 결정 발생 즉시 |
| [BACKLOG.md](BACKLOG.md) | 누적 작업·잔여 항목 로그 | 결함·후속 작업 발견 즉시 |
| [URLS.md](URLS.md) | 운영·프리뷰·로컬 URL 기준 | 배포 대상 변경 시 |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | 반복 장애와 해결 이력 | 장애 해결 직후 |
| [INTEGRATION_TEST.md](INTEGRATION_TEST.md) | 통합 테스트 체크리스트 | 통합 검증 흐름 변경 시 |

## 폴더 구조

| 폴더 | 역할 |
|------|------|
| [specs/](specs/README.md) | SDD 기준의 도메인·프론트·운영·성능 명세 |
| [plans/](plans/) | 구현 전 실행 계획과 세션별 Blueprint |
| [design/](design/) | 사용자군별 요구사항과 IA |
| [devops/](devops/) | 도구체인과 개발 운영 기준 |
| [discussions/](discussions/) | 의사결정 전 논의 기록 |
| [performance/](performance/) | 성능 측정 원본 JSON |
| [seeds/](seeds/) | 검증·시드 보조 데이터 |
| [archive/](archive/) | 종결된 세션·마이그레이션·과거 로그 |

## 운영 규칙

**신규 기능은 `docs/specs/`의 관련 명세를 먼저 갱신한 뒤 구현한다.**

- 단일 활성 문서는 500라인을 넘기지 않는다.
- `docs/CRITICAL_LOGIC.md`, `docs/BACKLOG.md`, memory 아카이브는 누적 로그 예외로 다룬다.
- `docs/memory.md`는 200라인을 넘기지 않는다. 초과 시 50라인 이내로 요약하고 아카이브한다.
- 장문 체크리스트는 상위 문서에 요약과 링크만 남기고, 실행 동선은 하위 문서로 분리한다.
- 운영 DB 쓰기, 지급, 환불, 정지, 삭제 검증은 읽기 전용 확인과 분리해서 명시한다.
