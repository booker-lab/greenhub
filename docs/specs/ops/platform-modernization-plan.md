<!-- Language: ko -->

# 개발 환경 현대화 · API Cloud Run 이전 계획

> 2026-10-23 수립. 이 문서는 **결정과 단계 순서**만 소유한다. 각 단계의 실제 진행 상태는 PR과 운영 read-back으로 확인하고, 여기 체크 표시를 현재 사실로 간주하지 않는다.

## 1. 현재 상태 (2026-10-23 실측)

생각보다 최신이다. 큰 틀(Next 16·React 19·NestJS 11·Firebase 12·Mantine 9·Node 22·pnpm 10·Biome 2·Vitest 4·Jest 30·ESLint 9)은 이미 현행 세대다. 남은 차이는 아래 두 종류다.

| 구분 | 내용 |
|---|---|
| 같은 큰 버전 안 | next 16.4.0→16.4.2, react 19.2→19.3, mantine 9.0→9.7, playwright 1.59→1.64, biome 2.4→2.6 등 |
| 큰 버전 변경 | NestJS 11→12(관련 패키지 일괄), firebase 12→13, firebase-admin 13→14, ESLint 9→10, Vitest 4→5, TypeScript 5.9→7, undici 6→8, firebase-tools 14→15, @firebase/rules-unit-testing 5→6, dotenv 17→18 |
| 런타임 | Node 22(유지보수 단계, 2027-04 지원 종료) → Node 24 LTS |
| 결제 SDK | `@portone/browser-sdk` 0.1.3→0.1.13 — 결제 흐름 전용 검증과 함께 별도 |

## 2. 확정 결정 (2026-10-23 사용자 확정)

1. **Cloud Run 운영 방식 = 항상 1대 켜두기.** 최소 인스턴스 1, CPU 상시 할당(인스턴스 기반 과금). API 안의 정기 작업 7개(`@Cron`)와 응답 뒤 고객 알림(#602)이 지금처럼 동작하도록 코드 구조를 바꾸지 않는다.
2. **최대 인스턴스 = 1로 시작.** 정기 작업 중 일부(결제 대기 정리의 `cleanupInFlight`, 마감 임박 알림, 정산 04:00, 참여 03:20)는 프로세스 안 잠금만 있어 여러 대가 동시에 돌면 중복 실행될 수 있다. 여러 대로 늘리려면 이 작업들에 lease(`common/job-lease`)를 먼저 붙인다.
3. **API 주소 = 고정 주소 `api.greenlove.co.kr`.** 서울(asia-northeast3) Cloud Run은 도메인 직접 연결을 지원하지 않으므로 **구글 외부 애플리케이션 부하분산기(serverless NEG) + 관리형 인증서**로 연결한다. 이후 서버를 옮겨도 가비아 DNS만 바꾸면 된다.
4. **진행 순서 = 작은 업데이트 → Cloud Run 준비(코드) → 인프라 생성·전환 → 큰 버전 업데이트를 하나씩.**

## 3. 단계

### 1단계 — 같은 큰 버전 안 업데이트 (코드만, 위험 낮음)
- 대상: §1 첫 줄. 새 린트 규칙으로 드러난 지적(불필요한 타입 단언 등)을 동작 변화 없이 정리.
- 증거: Biome·ESLint·타입·단위 테스트·4앱 운영 빌드 로컬 통과.

### 2단계 — Cloud Run 준비 (코드만, 운영 무변경)
Railway 전용 가정을 플랫폼 중립으로 바꾼다. Railway에서 동작은 그대로여야 한다.
- 배포 환경 이름: `GREENHUB_DEPLOY_ENVIRONMENT`(신규)를 `RAILWAY_ENVIRONMENT_NAME`과 함께 본다. 하나라도 `production`이면 운영(fail-closed). Cloud Run 스테이징이 `NODE_ENV=production`만으로 운영 취급되지 않는다.
- `/health` 커밋: 이미지 빌드 인자 `GREENHUB_COMMIT_SHA`를 먼저 보고, 없으면 `RAILWAY_GIT_COMMIT_SHA`.
- 프록시 홉: Cloud Run(`K_SERVICE`)에서 `TRUST_PROXY_HOPS`가 없으면 기동 거부. 부하분산기 뒤 실측 후 명시한다.
- Firebase 자격 증명: 이미 키가 없으면 ADC로 접속한다(변경 불필요). Cloud Run에서는 런타임 서비스 계정을 쓰고 키를 두지 않는다.
- 배포 스크립트(`production-deploy.mjs`의 `cloudrun` 명령, Workload Identity Federation 인증)는 실제 프로젝트·지역·서비스 이름이 정해지는 3단계에서 만든다.

### 3단계 — 인프라 생성·전환 (외부 변경, 단계마다 사용자 승인)
1. GCP(`green-e4fe3`)에서 Cloud Run·Artifact Registry·Secret Manager API 켜기, 런타임 서비스 계정 생성(Firestore·Storage 권한만).
2. 비밀값을 Secret Manager로 옮기기(JWT·PortOne·SMS·알림 등). Railway 값은 전환 완료까지 그대로 둔다.
3. **스테이징** Cloud Run 서비스 먼저 → 스테이징 E2E·프록시 홉 실측.
4. 운영 Cloud Run 서비스 생성(서울, min 1·max 1, CPU 상시) — 이 시점엔 트래픽 없음.
5. 부하분산기 + `api.greenlove.co.kr` 인증서 발급, 가비아 DNS A 레코드 추가.
6. 전환: Vercel `NEXT_PUBLIC_API_URL`·CORS·PortOne 웹훅 주소·uptime·워크플로의 Railway 주소를 고정 주소로 교체 → 운영 배포 → smoke.
7. 관찰 기간(최소 며칠) 뒤 Railway 정지. 정기 작업이 두 곳에서 동시에 돌지 않도록 **전환 순간 Railway를 먼저 내린다**(또는 Railway 쪽 정기 작업을 끈다).

### 4단계 — 큰 버전 업데이트 (하나씩 별도 PR)
권장 순서: Node 24 → firebase-admin 14 / firebase 13 → NestJS 12 묶음 → ESLint 10 → Vitest 5 → 나머지 도구. TypeScript 7(네이티브 컴파일러)은 Next·Nest 도구 호환을 확인한 뒤 마지막에 판단한다.

## 4. 하지 않는 것
- 화면·도메인 로직 리팩토링은 이 계획 범위가 아니다(`docs/specs/frontend/app-refactor-roadmap.md` 소유).
- 정기 작업을 Cloud Scheduler로 옮기는 구조 변경은 하지 않는다(결정 1).
