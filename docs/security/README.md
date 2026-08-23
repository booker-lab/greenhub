# Security 문서 라우팅

> `docs/security`에는 현행 위협 모델과 2026-07에 시작한 Codex Security 병렬 감사 틀이 함께 있다.

## 현행으로 사용하는 문서

### `threat-model.md`

현재 보안/권한 Task의 출발점이다. 단, 실제 취약 여부는 현재 `main` 코드·Rules·테스트로 다시 확인한다.

위협 모델의 시나리오는 감사 체크리스트이지 미해결 finding 목록이 아니다.

## 역사 자료

다음 문서는 2026-07-07 병렬 보안 감사 운영을 준비하면서 만든 기록이다.

- `codex-security-plan.md`
- `parallel-chat-prompts.md`
- `findings-board.md`
- `findings-common.md`
- `findings-consumer.md`
- `findings-seller.md`
- `findings-driver.md`
- `verification-log.md`

이 감사 묶음은 초기 템플릿 상태에서 멈췄으며, `SEC-000`/`COMMON-000` 같은 초기화 행과 `대기` 체크리스트를 현재 미해결 보안 결함으로 해석하지 않는다.

## 새 보안 감사 시작 규칙

새 감사가 필요하면 과거 board의 `대기` 상태를 이어 쓰지 않고 현재 `main`에서 다시 시작한다.

1. 현재 SHA와 감사 범위를 고정한다.
2. `threat-model.md`에서 관련 시나리오만 고른다.
3. 코드·Firestore Rules·Storage Rules·workflow를 read-only로 검토한다.
4. 실제 재현 가능하거나 정책과 충돌하는 항목만 finding으로 만든다.
5. Critical/High는 수정 전 영향 범위와 회귀 테스트를 함께 정의한다.
6. 운영 환경·secret·실데이터 변경은 별도 승인 없이 수행하지 않는다.

## 현재 출시와의 관계

2026-08-23 현재 회차 직배송 출시의 활성 외부 차단점과 실행 순서는 `docs/memory.md`, 활성 HANDOFF·PLAN을 따른다. 이 디렉터리의 2026-07 `대기` 표시는 출시 차단 게이트가 아니다.
