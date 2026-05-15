# 세션24 — e2e 회귀 검증 결과 보고

> 작성: 2026-05-15 (세션24 종료 시점)
> 결정 문서: [../../CRITICAL_LOGIC.md](../../CRITICAL_LOGIC.md) #CL-23
> 선행 세션: [session23-result.md](session23-result.md) — 셀러 페이지 분할 (#CL-22)

---

## 1차 목적: 세션23 분할 리팩토링 회귀 검증 — 통과

| 항목 | 결과 |
|------|------|
| 텍스트 셀렉터 매칭 회귀 | **0건** |
| `주문 관리`/`정산 관리`/`주문 상세` 헤더 | 정상 매칭 |
| G2 `상품명` 라벨 | 정상 매칭 |
| preparedAt 빠른 선택지 3개 (오늘 2시·4시·내일 9시) | 정상 매칭 |
| 모달 reason 검증 (`선택됨:`·`선택하지 않아도`) | 정상 매칭 |
| 정산 탭 3종 (`일별 요약`·`기간별 조회`·`주문별 상세`) | 정상 매칭 |
| 분할된 컴포넌트의 DOM 구조 보존 | 확인 |

세션23 #CL-22의 "동작 변경 0" 목표는 달성되었다.

---

## 실행 결과 (Playwright)

`npx playwright test seller-orders.spec.ts seller-order-detail.spec.ts seller-settlements.spec.ts`

- 총 52 케이스 (chromium 26 + mobile 26)
- 44 passed / 4 flaky / 4 failed
- 실패·flaky 8건 모두 동일 원인: `set-cookie count=0, body.url=null` — NextAuth credentials POST가 200 OK + 빈 body + set-cookie 없음을 반환하는 케이스
- 세션23 분할 리팩토링과 무관 (텍스트 셀렉터 매칭은 인증이 통과한 케이스에서 모두 정상)

---

## 진단 과정

### 1단계 — 단순 재현
초기 실행: 1 failed / 5 flaky / 46 passed. 페이지 스냅샷이 모두 카카오 로그인 페이지(`Green Love 판매자` + `카카오로 시작하기`)로 표시. `loginViaCredentials`는 성공했으나 후속 `page.goto()`에서 미인증 상태.

### 2단계 — 세션 검증 추가
`/api/auth/session` GET을 helper에 추가. 결과: `status=200, body=null` — credentials POST 후 BrowserContext에서 세션 조회 시 user가 없음.

### 3단계 — 쿠키 검증으로 좁히기
`page.context().cookies(base)` + set-cookie 헤더 카운트 검증으로 교체. 결과:
```
session cookie not in context after signIn —
set-cookie count=0, body.url=null,
cookie names=[__Host-authjs.csrf-token, __Secure-authjs.callback-url]
```

NextAuth credentials POST 응답에 set-cookie 헤더가 **0개**. body는 빈 객체. 인증 자체가 실패한 케이스.

### 4단계 — 부하 패턴 검증
- mobile 단독 (26 케이스): 26/26 통과
- chromium 단독 (26 케이스): 25/26 통과 (1 flake)
- chromium+mobile (52 케이스, workers=3): 33/52 통과 (helper retry 활성화 시), 44/52 통과 (helper retry 비활성화 시)
- chromium+mobile (52 케이스, workers=1): 41/52 통과

**결론**: 동시성 race가 아닌 누적 부하/rate limiting 패턴. helper 내부 retry는 호출 빈도를 늘려 오히려 악화시킴.

### 5단계 — helper 최종 형태 결정
retry 루프 제거 + 진단 강화. playwright test-level `retries: 1`에 위임.

---

## helper 변경 요지 (apps/e2e/tests/_helpers/auth.ts)

- credentials POST 후 `page.context().cookies(base)` 조회
- `authjs.session-token` 미발견 시 명시적 throw
- throw 메시지에 `set-cookie count`·`body.url`·context의 cookie names 포함 — 차후 진단 가속
- 단일 시도, retry 루프 미도입

전후 비교: 동일 시드 동작이지만 실패 케이스의 가시성이 크게 향상.

---

## root cause 가설 (미해소, 후속 작업으로 분리)

NextAuth credentials POST가 200 OK + 빈 body + set-cookie 없음을 반환하는 경로:
- `apps/seller/src/auth.ts`의 `authorize`가 `fetch(${API}/auth/login)` 호출 후 `!res.ok`이면 null 반환
- Railway 응답이 일시 실패 또는 timeout → authorize null → NextAuth가 set-cookie 없는 200 응답

**가능성 있는 요인**:
1. Vercel function cold-start (특히 첫 N개 호출)
2. Railway `/auth/login` cold-start 또는 connection pool exhaustion
3. 동일 user 반복 호출에 대한 일시적 rate limiting

mobile/chromium 단독에서는 95~100% 통과하므로 단일 호출 자체는 안정적. 합산 부하에서 누적적으로 실패율이 오르는 패턴.

---

## 후속 작업 (#CL-23 후속)

1. **storageState 패턴 도입** — global setup에서 1회 인증 후 `storageState.json` 저장, 모든 spec의 BrowserContext가 재사용. Railway `/auth/login` 호출이 N→1로 감소. 가장 robust한 해소책
2. Railway `/auth/login` latency·실패율 계측 추가
3. Vercel function cold-start mitigation 검토
4. spec별 인증을 `beforeAll`로 옮기는 부분 최적화 (storageState 전환 전 임시방편)

---

## 산출 자산

- `apps/e2e/tests/_helpers/auth.ts` — 세션 쿠키 검증 + 진단 강화
- `docs/CRITICAL_LOGIC.md` #CL-23
- `docs/memory.md` 세션24 줄 추가
- `docs/archive/sessions/session24-result.md` (본 문서)

---

## CLAUDE.md 자가 검증

- [x] 수정 파일 < 500라인 (auth.ts 89라인)
- [x] memory.md 200라인 이내 (89라인)
- [x] CRITICAL_LOGIC.md에 결정 사항 기록 (#CL-23)
