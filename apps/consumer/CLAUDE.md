@AGENTS.md

## 디자인 시스템 폰트 크기 공식 예외

아래 항목은 DS 규칙(최소 15px)의 **공식 예외**입니다. 15px 적용 시 레이아웃 붕괴 위험으로 수정 금지.

| 컴포넌트 | 값 | 이유 |
|----------|----|------|
| `BottomNav` 탭 라벨 | `fontSize: 10` | 모바일 하단 내비 표준 |
| `ProductTopBar` 버튼 라벨 | `fontSize: 10` | 모바일 상단 바 compact |
| `mypage/_client.tsx` 주문 상태 뱃지 | `fontSize: 12` | compact badge 패턴 |
| `ProductActions.tsx` 카운트다운 뱃지 | `fontSize: 13` | 타이머 compact 표시 |
| `orders/[id]/_client.tsx` Stepper 단계 설명 | `fontSize: 12` | Mantine Stepper 내부 compact 텍스트 |
