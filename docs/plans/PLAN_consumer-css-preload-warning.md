# Project Blueprint: 소비자 CSS preload warning 추적

## 문서 메타

- 작성일: 2026-06-24
- Priority: 3
- Labels: consumer, ops, css, console-warning
- SSOT Check: 소비자 앱 후속 발견 큐의 `C-STORES-07` 및 W11 운영 정리 계약을 따른다.
- Architectural Goal: 기능 오류와 낮은 우선순위 운영 진단 warning을 분리하고, 비즈니스 로직·인프라 레이어 변경 없이 증거 기반으로 종결한다.

## 업무 요약

소비자 운영 화면에서 반복 노출된 CSS preload warning을 기능 결함과 분리해 추적한다. 콘솔 error, hydration 오류, 스타일 누락, 화면 깜빡임, 레이아웃 깨짐이 없으면 배포 차단 조건으로 올리지 않고 낮은 우선순위 운영 진단 항목으로 유지한다.

## 판정 기준

- 콘솔 error 0
- hydration 오류 0
- 스타일 누락 0
- 화면 깜빡임 또는 레이아웃 깨짐 0
- 위 조건을 만족하면 CSS preload warning은 기능 결함이 아니다.

## 실행 계획

### W0. 운영/Preview 화면별 콘솔 warning 수집 기준 고정

**목표**: 동일한 화면과 판정 기준으로 warning을 수집한다.

| Task-ID | 작업 | Target | Verify |
| --- | --- | --- | --- |
| 0.1 | 운영 도메인과 Preview 또는 branch alias의 확인 URL을 고정한다. | 소비자 홈, `/stores`, 대표 상세 화면 | URL 목록 기록 |
| 0.2 | warning, error, hydration 메시지 수집 항목을 분리한다. | 브라우저 콘솔 | warning/error 개수 기록 |
| 0.3 | 기능 영향 판정 항목을 고정한다. | 화면 렌더링 | 스타일 누락, 깜빡임, 레이아웃 깨짐 여부 기록 |

**Conclusion**: [x] 2026-06-24 운영 `https://greenlove.co.kr`와 Preview branch alias `https://greenhubconsumer-git-codex-consume-29d333-jos-projects-d1cecc0c.vercel.app` 기준 홈, `/stores`, `/stores/9b2cb652-ff77-46b9-a773-e1efa78fb763`를 확인 대상으로 고정했다. Preview는 Vercel share URL로 보호를 우회한 뒤 같은 branch alias 경로를 수집했다.

### W1. warning resource URL과 원인 분류

**목표**: warning이 지칭하는 resource URL과 원인을 기능 오류와 분리한다.

| Task-ID | 작업 | Target | Verify |
| --- | --- | --- | --- |
| 1.1 | warning 메시지의 resource URL을 수집한다. | 브라우저 콘솔 | URL 또는 메시지 원문 요약 |
| 1.2 | preload 선언과 실제 사용 시점 불일치 여부를 분류한다. | Next.js asset preload | 원인 분류 기록 |
| 1.3 | 동일 warning 반복 여부를 화면별로 기록한다. | 확인 URL 목록 | 화면별 warning 개수 |

**Conclusion**: [x] 2026-06-24 운영과 Preview 모두 홈은 preload warning 0건, `/stores`와 대표 상세는 `/_next/static/css/2d41fe806411b45f.css` preload 미사용 warning 1건씩 관찰됐다. 메시지는 page load 직후 수 초 안에 쓰이지 않은 CSS preload이며, 원인은 Next.js CSS asset preload와 해당 화면의 실제 stylesheet 사용 시점 불일치로 분류했다.

### W2. 기능 영향도 판정

**목표**: warning이 사용자 흐름을 차단하는지 확인한다.

| Task-ID | 작업 | Target | Verify |
| --- | --- | --- | --- |
| 2.1 | 콘솔 error와 hydration 오류를 확인한다. | 확인 URL 목록 | error 0, hydration 0 |
| 2.2 | 스타일 누락과 레이아웃 깨짐 여부를 확인한다. | 화면 DOM·스크린샷 | 이상 없음 기록 |
| 2.3 | 기능 결함 또는 운영 진단 항목 여부를 판정한다. | W0~W2 증거 | 판정 기록 |

**Conclusion**: [x] 2026-06-24 운영·Preview 총 6개 URL 모두 HTTP 200, 콘솔 error 0, page error 0, hydration 오류 0으로 확인했다. 확인 viewport 390px에서 `documentElement.scrollWidth === innerWidth`, stylesheet 적용, 본문 렌더링을 확인했으므로 스타일 누락, 화면 깜빡임, 레이아웃 깨짐은 0으로 판정한다. CSS preload warning은 기능 결함이 아닌 낮은 우선순위 운영 진단 항목이다.

### W3. 수정 필요 시 최소 수정, 불필요 시 낮은 우선순위 추적으로 종결

**목표**: 기능 영향이 없으면 구현 수정 없이 문서 추적으로 닫는다.

| Task-ID | 작업 | Target | Verify |
| --- | --- | --- | --- |
| 3.1 | W2에서 기능 영향이 확인되면 최소 수정 범위를 별도 설계한다. | consumer frontend | 선 설계 후 구현 |
| 3.2 | 기능 영향이 없으면 수정하지 않고 낮은 우선순위로 문서 종결한다. | 이 문서, memory | 체크박스 완료 |
| 3.3 | 종료 검증을 수행한다. | 문서와 작업트리 | `git diff --check`, 라인 수 확인, 필요 시 build |

**Conclusion**: [x] 2026-06-24 기능 영향이 없어 구현 수정은 수행하지 않았다. `git diff --check`, 관련 문서 라인 수 확인, `pnpm --filter consumer build`를 통과했다.

## 종료 상태

- [x] W0 기준 고정 완료
- [x] W1 warning URL과 원인 분류 완료
- [x] W2 기능 영향도 판정 완료
- [x] W3 구현 수정 불필요 판정 완료
- [x] 종료 검증 완료
- [x] `docs/memory.md` 최신화 완료
