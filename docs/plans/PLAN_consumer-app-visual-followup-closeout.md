# 소비자 앱 후속 작업 종료 템플릿

`PLAN_consumer-app-visual-followup.md`의 500라인 한도를 지키기 위해 공통 종료 템플릿을 분리한다.

## 묶음별 핸드오프 템플릿

각 묶음 종료 시 아래 내용을 해당 Conclusion 또는 세션 메모리에 남긴다.

```text
[Wn 핸드오프]
- 완료 범위:
- 제외·새 발견:
- 커밋:
- Preview 배포:
- Production 배포:
- 자동 검증:
- 육안검증:
- 문서 갱신:
- 다음 묶음: Wn+1
- 다음 첫 행동:
```

## 전체 종료 체크리스트

- [x] W0~W11이 순서대로 완료됐거나 범위 밖 사유가 기록됐다.
- [x] 각 묶음의 독립 커밋과 Preview·Production 배포 증거가 있다.
- [x] 각 묶음의 모바일·데스크톱 육안검증 체크가 완료됐다.
- [x] 발견 큐와 선 설계 문서 상태가 일치한다.
- [x] 수정 파일은 모두 500라인 이하다.
- [x] `docs/memory.md`가 200라인 이하이며 최신 핸드오프를 가리킨다.
- [x] 각 묶음은 Preview 검증 후 동일 artifact를 Production으로 승격하고 운영 도메인을 확인했다.

## 2026-06-23 종료 판정

- 소비자앱 후속 W0~W11은 모두 완료됐다.
- 운영주소 보정 쓰기는 `docs/plans/PLAN_consumer-address-data-repair.md` 기준으로 별도 완료됐다.
- 소비자앱 사용자 흐름 기준으로 남은 추가 구현 작업은 없다.
- CSS preload warning 추적은 `docs/plans/PLAN_consumer-css-preload-warning.md` 기준으로 완료됐다.

## 2026-06-24 검증 캡처 보강 판정

- [x] W0~W11 각 묶음에는 Preview·Production 배포 증거와 375px·1440px 육안검증 관찰 기록이 있다.
- [x] CSS preload warning 추적에서 운영·Preview 홈, `/stores`, 대표 상점 상세 총 6개 URL의 콘솔 error 0, page error 0, hydration 오류 0, 스타일 누락 0, 가로 넘침 0을 확인했다.
- [x] 별도 이미지 캡처 파일은 발견되지 않았지만, 현재 문서화된 관찰 기록만으로 사용자 흐름 종료 판정을 유지할 수 있다.
- [x] 추가 캡처는 새 결함, 배포 회귀, 외부 감사 요청처럼 재현 증거가 필요한 경우에만 별도 계획으로 수행한다.
