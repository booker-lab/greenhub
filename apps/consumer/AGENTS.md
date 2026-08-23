<!-- BEGIN:nextjs-agent-rules -->
# 학습된 지식과 다른 Next.js 버전

이 버전은 API, 관례, 파일 구조에 호환성 변경이 있을 수 있다. 코드를 작성하기 전에 `node_modules/next/dist/docs/`에서 대상 API와 직접 관련된 가이드만 확인하고 사용 중단 안내를 따른다.
<!-- END:nextjs-agent-rules -->

## 디자인 시스템 글꼴 크기 예외

다음 항목은 최소 15px 규칙의 공식 예외다. 명시적인 디자인 개편 Task가 아니라면 크기를 변경하지 않는다.

| 컴포넌트 | 값 | 이유 |
|---|---:|---|
| `BottomNav` 탭 라벨 | `fontSize: 10` | 모바일 하단 내비게이션 |
| `ProductTopBar` 버튼 라벨 | `fontSize: 10` | 모바일 상단 바의 좁은 공간 |
| `mypage/_client.tsx` 주문 상태 뱃지 | `fontSize: 12` | 작은 뱃지 패턴 |
| `ProductActions.tsx` 카운트다운 뱃지 | `fontSize: 13` | 타이머 표시 |
| `orders/[id]/_client.tsx` Stepper 단계 설명 | `fontSize: 12` | Mantine Stepper 내부 텍스트 |
