# sync-preview 배포 게이트 — 플랜 (PREVIEW-GATE / B 해소)

> 작성: 2026-05-22 (세션71 선설계). 구현은 차기 세션.
> 사용자 결정: ① 대기 메커니즘 = **deployments API 폴링**(고정 sleep·헬스체크 대비 가장 정밀) ② 폴링 timeout 시 = **fail-fast**(stale e2e로 헛수고 대신 배포 지연 원인 노출).
> 선행 종결: CI-SEED(A, `2e53fa1`·#CL-42) — 본 작업은 그 §5 범위 외로 분리됐던 **B(stale preview race)** 해소.

---

## 0. 문제 정의 — 왜 이 작업이 필요한가

### race 메커니즘 (실측 — 세션71)

[sync-preview.yml:39-42](../../../.github/workflows/sync-preview.yml#L39-L42):

```yaml
- name: Trigger E2E workflow on preview
  run: gh workflow run e2e.yml --ref preview
```

`main` push → preview 머지 → **즉시** e2e dispatch. 그러나 Vercel preview 재배포는 preview push 후 **2~4분** 더 걸린다 → e2e가 **stale(이전 커밋) 배포본**을 검사.

### 정량 증거 — CI-SEED push의 자연 실험 (커밋 `2e53fa1`, 세션71)

| 이벤트 | 시각(UTC) |
|--------|-----------|
| sync-preview success | 05:56:35 |
| **자동 e2e dispatch** (`26271119584`) | **05:56:31** |
| Preview deploy 완료 — consumer | 05:59:10 |
| Preview deploy 완료 — seller | 06:00:13 |
| Preview deploy 완료 — driver | 06:01:05 |

→ e2e가 시작될 때(05:56) preview 재배포(05:59~06:01)는 **명백히 미완**. 이번엔 변경이 워크플로/스크립트뿐(프론트 코드 무영향)이라 176 passed였을 뿐, **race는 구조적으로 잔존**. 세션39·60·61은 프론트 변경이라 stale이 실제 fail로 표출됨(`reference_e2e_preview_race` 메모리).

### 기존 임시 대응의 한계

메모리 권장 "sync-preview 후 5분+ 수동 dispatch"는 **사람이 매번 대기·재실행**하는 수동 루프. CI-SEED와 동일한 종류의 갭(자동화 부재) — 본 작업으로 **트리거 자체를 배포 완료에 게이트**한다.

---

## 1. 핵심 정합성 갭 (구현 전 반드시 해소)

### GAP-1 — deployment 매칭 기준: 시각이 아닌 SHA (치명)

`created_at >= push_ts` 시각 비교는 시계 오차·재배포(롤백/재시도)에 취약. **실측 확인**: deployment 객체의 `sha` 필드 = preview HEAD SHA와 정확히 일치(`821c845` ↔ `821c845`).

**해법**: 폴링 종료 조건 = **3앱 각각, `sha == <preview HEAD SHA>`인 deployment의 최신 status `state == 'success'`**. 시각 비교 폐기.

### GAP-2 — GITHUB_TOKEN 권한에 deployments 없음

[sync-preview.yml:19-21](../../../.github/workflows/sync-preview.yml#L19-L21) `permissions:`는 `contents: write` · `actions: write`만. deployments **read** 권한 부재 → `gh api .../deployments` 403 가능.

**해법**: `permissions:`에 `deployments: read` 추가. (Vercel 배포는 별도 GitHub App이 생성하므로 read만 필요.)

### GAP-3 — environment 이름 3종 정확성 (URL 인코딩 함정)

**실측 확인** — Preview deployment environment 이름 3종(en-dash `–` U+2013, 일반 hyphen 아님):
- `Preview – greenhub-seller`
- `Preview – greenhubconsumer` (앱명에 하이픈 없음 — seller/driver와 표기 불일치 주의)
- `Preview – greenhub-driver`

`gh api` query string에 그대로 못 넣음 → URL 인코딩 필요(`%20%E2%80%93%20` = space+en-dash+space). 실측 동작 확인된 쿼리:
`deployments?environment=Preview%20%E2%80%93%20greenhub-seller`

### GAP-4 — BASE URL ≠ deployment target_url (간접 신호임을 명시)

**실측**: e2e BASE는 **고정 브랜치 별칭** `...-git-preview-...`(`apps/e2e/.env`), deployment `target_url`은 **커밋별 고유 URL** `...-1e8vowfys-...`. 직접 같지 않음.

**전제(검증 필요)**: Vercel은 커밋 빌드 success 시 브랜치 별칭(`-git-preview-`)을 그 커밋으로 재포인팅한다. 따라서 `sha`-매칭 deployment의 success = 고정 BASE가 새 커밋을 가리키게 된 시점의 **간접 신호**. T0에서 1회 실측 검증(success 직후 BASE가 새 SHA 서빙하는지).

---

## 2. 사전 정합성 검토 (실측 — 2026-05-22 세션71)

> **추측 아닌 실측 결과**. 구현 진입 전 5항목 + 본 작업 고유 갭.

| # | 항목 | 실측 결과 | 판정 |
|---|------|-----------|------|
| C1 | 직전 머지 정합 | working tree clean, `a2457d6`(세션71 CI-SEED 종결) | ✅ |
| C2 | sync-preview 트리거 구조 | 42행 `gh workflow run e2e.yml --ref preview` 단일 step — 게이트 삽입 지점 명확(이 step 직전) | ✅ |
| C3 | deployment `sha` 필드 = preview HEAD | `821c845` 양쪽 일치 실측 — GAP-1 해법 유효 | ✅ |
| C4 | deployment_status `state` 값 | 최신 status `state:'success'` + `target_url` 존재 실측 | ✅ |
| C5 | environment 이름 3종 | en-dash·consumer 표기 불일치 실측(GAP-3) | ✅ |
| C6 | GITHUB_TOKEN deployments 권한 | 현재 permissions에 deployments 부재(GAP-2) — 추가 필요 | ⚠ 조치 |
| C7 | concurrency 영향 | sync-preview는 `group: sync-preview` 단일 — 폴링 step이 길어져도 동일 그룹 내 직렬, e2e.yml(별 워크플로)과 무관 | ✅ |
| C8 | BASE 별칭 재포인팅 전제 | 고정 `-git-preview-` vs 커밋 URL 불일치(GAP-4) — T0 실측 검증 대상 | ⚠ T0 |

**500라인 한도**: sync-preview.yml 43 → ~75행(구성 파일, 무관). 스크립트 추출 시(T2 옵션) 신규 파일 ~60행.

**유일한 잔여 리스크**: GAP-4 별칭 재포인팅 전제(T0 실측으로 해소).

---

## 3. 아토믹 태스크 분해 (구현 세션)

순서 의존: T0(게이트) → T1 → T2 → T3 → T4(검증). 각 태스크 독립 롤백 가능.

### T0. 진입 게이트 — 별칭 재포인팅 전제 실측 (코드 변경 0)

- 새 main push 1건 후: ① `sha`-매칭 deployment success 시각 기록 ② 그 직후 `curl -s $SELLER_BASE`(고정 별칭 URL)가 새 커밋 자산을 서빙하는지 확인(빌드 ID·정적 자산 해시 변화로 판정).
- **불일치 시(success인데 별칭이 stale)** → deployments success는 부정확한 신호 → 폴링 대상을 별칭 URL 헬스체크로 전환(설계 변경, 사용자 에스컬레이션).
- **DoD**: success 직후 별칭이 새 커밋 서빙 확인, 또는 에스컬레이션.

### T1. GITHUB_TOKEN 권한 확장 (GAP-2)

**파일**: `.github/workflows/sync-preview.yml`

- `permissions:`에 `deployments: read` 한 줄 추가.
- **DoD**: yml 문법 유효 · 폴링 step에서 `gh api .../deployments` 403 안 남(T4에서 실증).
- **롤백**: 이 줄만 제거.

### T2. 배포 완료 폴링 step 신설 (핵심)

**파일**: `.github/workflows/sync-preview.yml` — [Trigger E2E step(39행)](../../../.github/workflows/sync-preview.yml#L39) **직전** 삽입.

- step 로직:
  1. `HEAD_SHA=$(git rev-parse HEAD)` (이미 preview 체크아웃 상태 — checkout `ref: preview`).
  2. 3개 environment 각각, 최대 timeout(예: **10분**, 15초 간격) 폴링:
     - `gh api 'repos/.../deployments?environment=<URL인코딩>&per_page=10' --jq '.[] | select(.sha=="'$HEAD_SHA'") | .id'`로 해당 커밋 deployment id 찾기.
     - 그 id의 `/statuses` 최신 `state`가 `success`면 해당 앱 완료.
  3. 3앱 모두 success → 폴링 종료(통과).
  4. **timeout 초과 → `exit 1`(fail-fast, 사용자 결정)** → e2e dispatch 안 됨 → 배포 지연 원인 노출.
- environment 이름은 GAP-3 인코딩 사용. consumer 표기 불일치 주의.
- **DoD**: yml 문법·들여쓰기 일관 · 폴링 종료 조건 = sha-매칭 success(GAP-1) · timeout 분기 exit 1.
- **롤백**: step 블록 제거.

> **구현 형태 결정(T2 진입 시)**: 인라인 `run:` 블록 vs `scripts/wait-preview-deploy.mjs` 추출. 셸 폴링이 ~30행 넘으면 가독성 위해 스크립트 추출 고려(YAGNI — 우선 인라인, 복잡도 보고 판단).

### T3. 실패·관측성 명문화 (주석 + 로그)

- 폴링 step에 각 앱 success 시각·timeout 시 어느 앱이 미완인지 `echo` 로그.
- "fail-fast = 배포 지연 시 stale e2e 대신 원인 노출" 주석 1~2줄.
- **DoD**: 로그로 T4에서 A/B 구분 가능(어느 앱이 느린지 식별).

### T4. 통합 검증 — push 후 게이트 동작 관찰 (= 성공 지표)

- 임의 main push(또는 빈 커밋) → sync-preview 관찰.
- **DoD (로그로 확인)**:
  - [ ] 폴링 step이 3앱 success까지 대기(로그에 각 앱 success 시각 — 이전 자연 실험 기준 ~3~5분).
  - [ ] **e2e dispatch가 폴링 통과 후에야 시작** = e2e 시작 시각 > 마지막 앱 deploy 시각(race 차단 입증).
  - [ ] e2e run 1차 success(seed step 포함 — CI-SEED와 결합).
- **A/B 결합 확인**: CI-SEED(seed) + 본 게이트 둘 다 통과 = 자동 dispatch가 **시드+fresh 배포** 양쪽 보장된 1차 통과.

### T5. 결정 로그 + 메모리 (#CL-43 후보)

- `docs/CRITICAL_LOGIC.md`에 #CL-43 등재(§4, 1000행 한도 확인).
- `reference_e2e_preview_race` 메모리에 "게이트로 자동 해소됨" 갱신(수동 5분 대기 권장 → 불필요).
- `docs/memory.md` 세션 기록(200행 한도) · BACKLOG에 PREVIEW-GATE ✅.

---

## 4. 결정 로그 후보 (#CL-43)

**sync-preview 배포 게이트 — SHA-매칭 deployments 폴링** — e2e dispatch 전, 3앱 Preview deployment의 `sha == preview HEAD` + 최신 status `success`를 폴링(timeout fail-fast). Why: sync-preview success ≠ Vercel 실배포 완료라 자동 e2e가 stale 배포를 검사하는 race(세션39·60·61). How: `gh api deployments` SHA-매칭(시각 비교 폐기 — 시계/재시도 취약), `permissions: deployments:read` 추가. 별칭 재포인팅 전제는 T0 실측 검증.

## 5. 범위 외 (별건)

- e2e.yml 자체 헬스체크(소비자측 대기) — 트리거측 게이트로 충분하면 불필요(YAGNI).
- Vercel Deploy Hook / Checks API 연동 — deployments API로 충분, 추가 의존 회피.
- seed 데이터 동적 일자 고정화(CI-SEED §5에서 이월된 별건).
- 폴링 step 스크립트 추출 시 공유 인증 모듈 — 해당 없음(GITHUB_TOKEN만 사용).

## 6. 후속 진입점 (PREVIEW-GATE 외 누적 후보)

- Driver Kakao Maps SDK (세션53 Outage 이후 미진행)
- 백엔드 단일 장애점 회고 (Railway Outage 교훈)
- UX-11 T14 수동 검증 2건 (운영 폴백 스크린샷·orderCounters Console — 사용자 몫)
