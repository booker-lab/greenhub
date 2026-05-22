# e2e CI seed step 추가 — 플랜 (CI-SEED)

> 작성: 2026-05-22 (세션70 진단·선설계). 구현은 차기 세션.
> 사용자 결정: ① 본 세션 = **진단·플랜만**(SDD 선설계) ② CI 인증 = **기존 시크릿 `FIREBASE_SERVICE_ACCOUNT_JSON` 재사용**.

---

## 0. 문제 정의 — 왜 이 작업이 필요한가

### 재발 이력 (3회)

| 세션 | 증상 | 임시 봉합 |
|------|------|-----------|
| 61 | 자동 dispatch 3회 연속 동일 2건 실패 | 로컬 멱등 시드 재주입 후 수동 dispatch |
| 67 | BUG-16 parcel spec 1차 실패 | 동일 — `e2e-parcel-order-001` 로컬 주입 후 통과 |
| 69 | UX-11 orderNumber spec 1차 실패 | 동일 — orderNumber 주입분 로컬 재실행 후 통과 |

**공통 근본 원인**: `.github/workflows/e2e.yml`에 **seed 단계가 없다**. CI 러너는 비어 있거나 stale한 Firestore 상태로 spec을 실행 → 시드 의존 spec(주문 카드·parcel·orderNumber)이 1차에 깨짐. 매번 로컬에서 사람이 시드를 재주입하는 수동 루프가 반복됨.

### 부수 문제 (B — 본 플랜 범위 밖, 별도 평가)

`sync-preview.yml` success ≠ Vercel 실배포 완료. 자동 dispatch가 stale preview를 치는 race(세션60·61·69). seed step을 넣어도 이 race는 남는다. **본 플랜은 A(seed 부재)만 해소**하고 B는 후속 별건으로 분리(§6).

---

## 1. 핵심 정합성 갭 (구현 전 반드시 해소)

### GAP-1 — seed 스크립트가 CI에서 인증 불가 (치명)

[scripts/seed-e2e-orders.mjs:22](../../../scripts/seed-e2e-orders.mjs#L22):

```js
const serviceAccount = require(join(__dirname, '../apps/api/firebase-adminsdk.json'));
```

→ **로컬 파일을 하드코딩 require**. `apps/api/firebase-adminsdk.json`은 gitignore 대상이라 **CI 체크아웃에 존재하지 않음** → 워크플로에 step만 추가하면 `MODULE_NOT_FOUND`로 즉시 크래시.

**해법**: 같은 디렉토리의 [scripts/cleanup-spec-residue.mjs:24-46](../../../scripts/cleanup-spec-residue.mjs#L24-L46) `resolveCredential()`이 이미 **env-우선 + 로컬 폴백 + BOM 방어**를 검증된 형태로 구현. 이 함수를 seed에 그대로 이식한다(중복 허용 — 두 스크립트가 독립 실행되며 공유 모듈 신설은 표면 확대).

규약(두 스크립트 동일):
1. `FIREBASE_SERVICE_ACCOUNT_JSON` env (CI 러너 — JSON 문자열, BOM trim)
2. `apps/api/firebase-adminsdk.json` 로컬 키 (개발자 머신 폴백)

### GAP-2 — seed 실행 순서·타이밍

seed는 **playwright test 실행 직전**에 1회 돌아야 한다(스크린샷·spec이 시드 데이터 의존). 단 seed는 **운영 Firestore에 직접 write** → preview 환경이 가리키는 Firestore와 동일 프로젝트인지 확인 필요(현재 단일 프로젝트 전제. memory.md 툴체인 참조).

### GAP-3 — 멱등성·정리 정책 영향 없음 확인

seed는 `e2e-` prefix 멱등 set. `cleanup-spec-residue.mjs`는 `e2e-` 시드를 **보존**(별도 정책, seed 스크립트 주석 12행). → CI에서 seed → test → cleanup 순서로 돌아도 시드가 지워지지 않음. **충돌 없음**.

---

## 2. 사전 정합성 검토 (실측 — 2026-05-22 세션70)

> 구현 진입 전 5항목 + 본 작업 고유 갭. **추측 아닌 실측 결과**.

| # | 항목 | 실측 결과 | 판정 |
|---|------|-----------|------|
| C1 | 직전 머지 정합 | working tree clean, `fc3113f`(세션69) 종결 커밋 | ✅ |
| C2 | `firebase-admin` 의존성 위치 | **루트 [package.json:29](../../../package.json#L29)** — `node scripts/...`가 루트에서 해석 가능 | ✅ |
| C3 | gitignore의 키 파일 제외 | `.gitignore:12-13` `firebase-adminsdk*.json`/`*-adminsdk-*.json` → **CI 체크아웃에 파일 부재 확정** (GAP-1 유효) | ✅ |
| C4 | `resolveCredential()` 자기완결성 | [cleanup-spec-residue.mjs:24-46](../../../scripts/cleanup-spec-residue.mjs#L24-L46) — 외부 의존 없는 순수 함수, 그대로 복사 가능 | ✅ |
| C5 | seed import 표면 | `firebase-admin/app`·`firebase-admin/firestore` + Node 빌트인(`module`/`url`/`path`)만 → 루트 의존성으로 충분 | ✅ |
| C6 | cleanup step과 충돌 여부 | cleanup은 **e2e.yml step 아님** — spec 내부([seller-auth-invite.spec.ts:6](../../../apps/e2e/tests/seller-auth-invite.spec.ts#L6)) afterAll에서 호출. seed step은 신규 독립 step, **순서 충돌 0** | ✅ |
| C7 | seed step 정당성(코드 근거) | 4개 spec이 주석으로 "seed-e2e-orders.mjs 실행 필요" 선행 명시(consumer-delivery-date·seller-orders·seller-parcel-ship·consumer-mypage) | ✅ |
| C8 | seed 실패 시 silent pass | seed [260행](../../../scripts/seed-e2e-orders.mjs#L260) `process.exit(1)` → step fail → 후속 test 미실행 | ✅ |

**500라인 한도**: seed 265 → ~285행(안전). e2e.yml 54 → ~60행(구성 파일, 무관).

**유일한 잔여 리스크**: preview가 가리키는 Firestore = CI seed가 쓰는 Firestore 동일 프로젝트인지(단일 프로젝트 전제, memory.md 툴체인). T0에서 1회 확인.

---

## 3. 아토믹 태스크 분해 (구현 세션)

각 태스크는 독립 검증 가능 단위. **순서 의존**: T1 → T2 → T3 → T4(검증). T0은 진입 게이트.

### T0. 진입 게이트 — Firestore 프로젝트 동일성 확인 (코드 변경 0)

- preview 환경 Firestore project ID = `FIREBASE_SERVICE_ACCOUNT_JSON` 시크릿의 project_id 일치 확인.
- **불일치 시 즉시 중단** — seed가 엉뚱한 프로젝트에 write하면 안 됨. (단일 프로젝트면 통과)
- **DoD**: 동일 프로젝트 확인 또는 사용자 에스컬레이션.

### T1. seed 인증 env-우선화 (스크립트 단독, CI 무관 검증 가능)

**파일**: `scripts/seed-e2e-orders.mjs`

- 14~16행 import에 `cert` 유지(이미 있음), 22행 하드코딩 require 제거.
- `cleanup-spec-residue.mjs:24-46` `resolveCredential()` 이식(중복 허용 — §6 YAGNI 근거).
- 24행 `initializeApp({ credential: cert(serviceAccount) })` → `initializeApp({ credential: resolveCredential() })`.
- `createRequire` import는 `resolveCredential` 폴백 경로에서 계속 사용 → 유지.
- **DoD (CI 없이 로컬 단독 검증)**:
  - [ ] `FIREBASE_SERVICE_ACCOUNT_JSON` env 세팅 → `node scripts/seed-e2e-orders.mjs` 인증 성공("🎉 E2E 시드 완료")
  - [ ] env 미설정 → 로컬 파일 폴백 정상(개발자 머신 회귀 0)
- **롤백 단위**: 이 커밋만 되돌리면 원복.

### T2. e2e.yml seed step 신설 (구성 파일 단독)

**파일**: `.github/workflows/e2e.yml`

[Run E2E tests 스텝(30행)](../../../.github/workflows/e2e.yml#L30) **직전**에 삽입:

```yaml
      - name: Seed E2E fixtures (Firestore)
        env:
          FIREBASE_SERVICE_ACCOUNT_JSON: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_JSON }}
        run: node scripts/seed-e2e-orders.mjs
```

- 시크릿은 **이미 44행 등록된 `FIREBASE_SERVICE_ACCOUNT_JSON` 재사용** → 신규 0건(사용자 결정).
- 배치: `Install Playwright`(28행) 이후 · `Run E2E`(30행) 이전. install 완료 후라 의존성 확보.
- **DoD**: yml 문법 유효(들여쓰기 2-space 일관) · seed step이 test step 앞.

### T3. 실패 가드 명문화 (확인 + 주석, 코드 거의 0)

- seed `process.exit(1)`로 step fail → silent pass 불가(C8 확인). 추가 코드 불필요.
- e2e.yml seed step에 한 줄 주석으로 "실패 시 후속 test 미실행" 의도 명시(가독성).
- **DoD**: 주석 1줄 추가.

### T4. 통합 검증 — 자동 dispatch 1차 통과 (= 본 작업 성공 지표)

- push → preview 동기화 → **자동 e2e run 관찰**.
- **DoD (로그로 A/B 구분)**:
  - [ ] seed step 로그 "🎉 E2E 시드 완료" 출력
  - [ ] **자동 run 1차에 시드 의존 spec 통과** = 3회 재발 패턴 종결(A 해소)
  - [ ] 만약 test만 stale 실패(seed 성공) → A는 해소, B(stale race)만 잔존 → §6 별건으로 기록
- biome/타입체크: 스크립트·yml만 변경이라 영향 0(확인만).

### T5. 결정 로그 + 메모리 (#CL-42)

- `docs/CRITICAL_LOGIC.md`에 #CL-42 등재(§5 내용, 1000행 한도 확인).
- `docs/memory.md` 세션 기록(200행 한도 — 요약).
- BACKLOG §12-1 활동 로그에 CI-SEED ✅ 마킹.

---

## 4. 결정 로그 후보 (#CL-42)

**CI seed 인증 규약 단일화** — seed·cleanup 두 스크립트 모두 `resolveCredential()`(env-우선 + 로컬 폴백 + BOM 방어) 사용. CI는 `FIREBASE_SERVICE_ACCOUNT_JSON` 시크릿 재사용(신규 0건). Why: 로컬 파일 하드코딩이 CI 크래시의 단일 원인. How: cleanup 검증 패턴 이식.

## 5. 범위 외 (별건)

- **B (stale preview race)**: sync-preview 후 Vercel 실배포 대기/헬스체크 step — `reference_e2e_preview_race` 메모리에만 기록됨. seed와 독립 문제. 별도 플랜.
- seed 데이터의 동적 일자(today+N) → 고정 일자 전환 (현재 일반/공구는 동적, parcel·orderNumber는 고정 — 혼재). 안정성 영향 평가 별건.
- 공유 인증 모듈(`scripts/_lib/firebase-credential.mjs`) 추출 — 2회 중복 시점 YAGNI, 3번째 스크립트 생기면 재평가.

## 6. 후속 진입점 (CI-SEED 외 누적 후보)

- Driver Kakao Maps SDK (세션53 Outage 이후 미진행)
- 백엔드 단일 장애점 회고 (Railway Outage 교훈)
- B (stale preview race) 별건
- UX-11 T14 수동 검증 2건 (운영 폴백 스크린샷·orderCounters Console — 사용자 몫)
