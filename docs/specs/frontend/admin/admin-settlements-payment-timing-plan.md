# 관리자 정산 입금 시각 표시 SDD

> **작성일**: 2026-06-03
> **상태**: 설계 확정
> **출처**: `pending-visual-verify.md` §6 `#85`, `admin-tab-settlements-plan.md` D-11 A1
> **범위**: `/admin/settlements` 행·모바일 카드의 지급 상태 보조 문구

## 1. 목표

관리자가 정산 목록 한 행에서 지급 완료 여부와 처리 시각을 확인한다.

**운영자가 확정 정산과 지급 완료 정산을 구분하되, 백엔드에 없는 입금 예정일은 추정하지 않는다.**

## 2. 표시 계약

| 상태 | 보조 문구 |
|------|----------|
| `paid` | `입금 완료 YYYY-MM-DD HH:mm` |
| `confirmed` + `confirmedAt` 있음 | `지급 대기 · 확정 YYYY-MM-DD HH:mm` |
| `confirmed` + `confirmedAt` 없음 | `지급 대기` |
| `pending`, `cancelled` | 보조 문구 없음 |

- 시각은 기존 shared `toDateStrKST(..., { hour, minute })` 경로를 재사용한다.
- 직렬화 형태는 API ISO 문자열과 Firestore raw `{ _seconds }`를 모두 허용한다.
- 보조 문구는 상태 Badge 아래 작은 회색 글씨로 표시한다.
- 데스크톱 테이블과 모바일 카드가 같은 표현 함수를 사용한다.

## 3. 비범위

- 입금 예정일 계산
- 지급 정책, 배치, API 변경
- 셀러 정산 화면 T3 구현
- `paidAt` 또는 `confirmedAt`이 없는 과거 데이터 보정

## 4. 검증

| 시나리오 | 기대 |
|----------|------|
| 기존 `paid` fixture | `입금 완료 2026-05-26 13:00` 표시 |
| `confirmed` fixture | `지급 대기 · 확정 ...` 표시 |
| 일괄 지급 전부 성공 | 재조회 후 `paid` 탭에서 신규 `입금 완료 ...` 표시 |
| 모바일 카드 | Badge와 보조 문구가 375px 폭 안에 표시되고 가로 넘침 없음 |

## 5. 완료 기준

- `pending-visual-verify.md` §6 `#85` 자동 검증 종결
- 관련 Playwright chromium·mobile 통과
- seller 타입체크와 변경 파일 Biome 통과
- 수정 코드 파일 500라인 이하 유지
