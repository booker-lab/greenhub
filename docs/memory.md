<!-- Language: ko -->

# 프로젝트 현재 상태

> 현재 작업 판단에 필요한 최소 상태만 유지한다. 상세 Acceptance Criteria는 `docs/BACKLOG.md`와 current spec을 사용한다.

## 검증 기준

- Git·GitHub와 #63/#70/#71 release state: `2026-09-06 KST` 직접 재조회
- 파일럿 준비 재판정: `2026-09-28 KST` — live `main`, 원격 회차 E2E, Auth.js 세션 E2E, ALIGO 콘솔, 운영 Railway 배포 기록을 직접 재조회
- Vercel 배포 안전·exact-source Preview: 역사적 증거 snapshot; 현재 release proof로 재사용하지 않는다.
- ALIGO provider current metadata: 콘솔 기준 템플릿 8종 `VERIFIED`(2026-09-28), API read-back은 출시 배포 뒤 재확인 — 아래 ALIGO 상태 참고.
- 운영 상태 변경은 별도 승인 없이 수행하지 않는다.

## Git·배포 기준선

- 저장소: `booker-lab/greenhub`
- 기본 브랜치: `main`; HEAD는 작업 시작 시 직접 재조회한다.
- 회차 직배송 기능 통합 기준 SHA(역사적 기능 기준선): `e55f25914cc7d01576fbd4639583daaf0fe6385e`
- #63이 accepted한 pre-publication main 기준 SHA: `ffd999423f8a98b0c1f34d020d832d7929feab72` — historical baseline
- #70/#71이 publication 후 재확인한 현재 live `main`: `fe5e680fa58c8b3af5e508d07115bb8ab9df272a`
- `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`는 historical exact-source Preview 기준선이며 현재 main이나 production source가 아니다.
- PR #30/#31로 세 프런트의 `main` Vercel Git auto-production과 pure-doc build를 repo-side 차단했다.
- docs-only main 변경은 Preview sync/일반 E2E 제외.
- `AGENTS.md` + deployment safety CI가 branch+PR 원칙을 소유한다.
- GitHub `main`은 직접 재조회에서 `protected=true`이며 PR required, strict `verify` check, force-push·branch 삭제 차단이 적용됐다. Issue #32는 `CLOSED`다.

`main` merge는 production 배포 승인이 아니다. production은 검증된 exact release SHA + 별도 승인 절차를 사용한다.

## S2 → R1 Public Readiness 종료 상태

> 아래 `CLOSED`·`PASS` 상태는 #63이 인정한 closure와 historical Preview/browser/fixture evidence를 구분해 기록한다. 이 docs-only 작업에서는 Browser R3, physical device, fixture provisioning/cleanup을 재실행하지 않았으며, 새로운 runtime proof를 만들지 않는다.

- S2 Browser Readiness: `CLOSED`
- exact-source Browser R3: `PASS`
- physical-device disposition: `PHYSICAL_DEVICE_NOT_REQUIRED` — physical-device proof를 수행했다고 주장하지 않는다.
- canonical R3 fixture cleanup: `CLOSED`
  - project: `greenhub-round-direct-e2e`
  - runId: `s2-authbound-20260904-r3`
  - manifest ownership: `4/4`
  - exact Firestore documents: `4 deleted`
  - Storage targets: `0`
  - independent readback: `4/4 HTTP 404`
- R1 Combined Public Readiness: `PUBLIC_READINESS_CLOSED`
- S2 → R1 campaign: `TERMINAL_SUCCESS`
- historical exact-source Preview source: `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c`
- historical Driver Preview: deployment `dpl_4UVQ2BuTNfrBc1zm68X5Kjbvu9PE`, target `preview`, state `READY`. 당시 metadata가 해당 historical source와 일치했다는 뜻이며 현재 main·candidate·production proof가 아니다.
- pre-publication main accepted by #63: `ffd999423f8a98b0c1f34d020d832d7929feab72`; PR #60/#61/#62가 merge된 historical publication baseline이다.
- current live main after #70/#71: `fe5e680fa58c8b3af5e508d07115bb8ab9df272a`; PR #70이 merge된 Sale Round publication state다.

## Readiness·publication·production 구분

- `IMPLEMENTATION`: #66이 `SALE-ROUND-STATE-ATOMICITY-AND-RECOVERY`의 구현과 race/recovery proof를 accepted하여 `IMPLEMENTATION_PROVEN`이다.
- `VERIFICATION`: Sale Round focused/integration/regression proof는 `PROVEN`; exact-release Preview/browser/runtime과 Auth.js session/logout/rotation/stale-claim lifecycle은 별도 `PENDING`/`EXTERNAL_RUNTIME_BLOCKED` gate다.
- `CANDIDATE`: 기존 documentation candidate는 `9c921684a26597cb57887b6049288f1143b017c8`; 후속 candidate는 PR #69 head로 갱신한다.
- `REMOTE_ADDRESSABLE`: #70 semantic candidate와 현재 live main `fe5e680fa58c8b3af5e508d07115bb8ab9df272a`는 remote-addressable이며, 문서 후속 candidate도 PR #69 원격 head로 read-back한다.
- `PR`: PR #70은 `MERGED`; 기존 documentation PR #69는 `OPEN`이며 이번 Goal은 merge하지 않는다.
- `PUBLISHED/MERGED`: Sale Round publication은 `PUBLISHED`; live main read-back은 `fe5e680fa58c8b3af5e508d07115bb8ab9df272a`다.
- `PREVIEW_PROOF`: exact-release runtime/browser proof는 `PENDING`; `7cc4d9862dd49b68fb1542e49c53fb953bfdf59c` Preview deployment는 historical evidence다.
- production deployment/activation, live round, actual payment, actual notification, first-round completion: `PRODUCTION_AUTHORITY_PENDING` / `NOT CLAIMED`.

## 현재 source·publication 기준

#63/#68 작업의 pre-publication 기준과 #71 publication 후 live authority를 read-only로 확인한 결과를 기록한다. 문서 변경 후 생기는 commit은 이 source baseline과 별도의 documentation publication candidate다.

- 작업 시작 branch: `main`
- 작업 시작 source HEAD/local `main`: `ffd999423f8a98b0c1f34d020d832d7929feab72`
- 작업 시작 local `origin/main`: `ffd999423f8a98b0c1f34d020d832d7929feab72`
- 작업 시작 live remote `main`: `fe5e680fa58c8b3af5e508d07115bb8ab9df272a` — #71 publication read-back
- pre-publication live baseline `ffd999423f8a98b0c1f34d020d832d7929feab72`는 #63/#68의 historical baseline이다.
- #70 semantic candidate `4169bf250d3bdf4a5196209090307ca979e8d32a`는 `PUBLISHED`; documentation candidate는 PR #69에서 후속 갱신하며 main merge가 아니다.
- historical `7cc4d9862dd49b68fb1542e49c53bf953bfdf59c`와 이전 provider snapshot은 current SHA·current provider metadata·production proof로 사용하지 않는다.
- GitHub main 보호 때문에 direct main commit/push는 금지되며, 문서 변경은 purpose branch + PR 경계를 따른다.

기존 Task 2F-B candidate의 상세는 [Task 2D integration closeout report](plans/REPORT_task_2d_integration_closeout.md)와 해당 historical handoff를 따른다. 아래 출시 P0 서술은 S2 → R1 campaign 종료와 별개의 broader release dependency이며, 이번 문서화로 자동 종료하거나 다시 열지 않는다.

## 제품 현재 상태

- 회차 직배송 MVP는 `main` 통합 완료.
- consumer 구매, seller 회차·주문, driver 직배송, 결제·환불·재배송비·보류·사진·운영 예외 흐름 존재.
- 카카오 비즈니스 채널 승인 완료.
- repository ALIGO logical 8-code contract: `VERIFIED` — #65에서 확인한 repository 계약.
- ALIGO 템플릿 8종(UK_5691~5698): 2026-09-28 콘솔에서 코드·이름·승인완료·본문·변수 일치 확인. actual send는 `NOT RUN`이다.
- **운영 배포 완료(2026-09-28, 출시 SHA `197f84a4`)**: API·프런트 3개·Firestore/Storage 규칙·인덱스가 같은 SHA로 반영됐다. 이후 2026-09-30 `389066c8`(회차 주문 요청사항 칸 포함), 2026-10-03 `f89f9ed9`(회차 자동 오픈·55분 로그아웃 방지 등 #325~#340)로 API·프런트 3개를 갱신했다(규칙·인덱스 변경 없음). 상세는 아래 5절.
- production 배포 완료. 첫 회차 "11월 10일 배송 회차"가 `SCHEDULED`다(주문 11/1 10:00 오픈).
- 판매 모드: **`round_direct`**(2026-09-29 전환). 파일럿 운영 시작은 **2026-11-01로 연기**했다.

## 현재 release residual

> #63 accepted classification을 현재 release 문서의 기준으로 사용한다. 아래 상태는 implementation, verification, external/runtime, authority, product policy, docs delta를 서로 합치지 않는다.

### 1. Sale-round state atomicity and recovery

상태: `IMPLEMENTATION_PROVEN` + `PUBLISHED` — `SALE-ROUND-STATE-ATOMICITY-AND-RECOVERY`.

#66이 회차 수정·수동 개방·주문 예약·취소 복구의 fresh state/time/ownership 경계를 직접 검증하고
구현 proof를 accepted했다. semantic candidate `4169bf250d3bdf4a5196209090307ca979e8d32a`는
PR #70으로 merge되었고, #71 publication read-back의 현재 live `main`은
`fe5e680fa58c8b3af5e508d07115bb8ab9df272a`다.

이 상태는 implementation과 repository publication에 대한 proof다. exact-release Preview/browser/runtime
proof는 `PENDING`, production authority는 `PENDING`이며 production deployment·activation·`salesMode`·
live round·actual payment/notification·first-round completion을 주장하지 않는다.

### 2. Preview·exact-SHA proof

상태: `PRE_RELEASE_PROVEN` — 출시 SHA 확정 뒤 같은 절차로 재실행이 필요하다.

2026-09-28 원격 회차 E2E가 exact-SHA Preview 3개 + 스테이징 API로 전건 통과했다.

- run `36338292480`(SHA `31d122c5`): Playwright 52/52, fixture cleanup 잔여 0
- run `36341189483`(SHA `9ba65c1f`, #309): 52/52 + 세션 수명주기 12/12, cleanup 잔여 0
- run `36348002412`(live `main` `c8bec1f5`, #310 포함): 52/52 + 세션 12/12, cleanup 잔여 0 — 가장 최근 증거
- 절차: `docs/specs/ops/mvp-sales-round-e2e-environment.md` §2의 exact Preview 생성 방식

이 결과는 해당 SHA에 대한 증거이며 출시 SHA의 증거를 대신하지 않는다.

### 3. Auth.js session runtime

상태: `RUNTIME_PROVEN`(Preview, 2026-09-28).

run `36341189483`에서 consumer·seller·driver × chromium·mobile로 다음을 실제 Preview 브라우저에서 확인했다(`apps/e2e/tests/auth-session-lifecycle.spec.ts`, 12건).

- Credentials 로그인 쿠키 발급과 같은 컨텍스트 유지
- Auth.js 로그아웃 후 쿠키·세션 소멸
- 계정 정지(consumer·seller)·기사 승인 철회(driver) 뒤 다음 세션 조회에서 세션 종료, 복원 후 재로그인

revocation window 결정(D2, 2026-09-28)은 `docs/specs/api/auth.md`를 따른다. 로그아웃 시 서버 refresh token 폐기는 출시 후 `AUTH-LOGOUT-SERVER-REVOCATION`으로 다룬다.

### 4. ALIGO provider metadata

상태: 템플릿 `VERIFIED`(콘솔) / 운영 반영·IP·실발송 `RELEASE_GATE`.

- 템플릿 8종과 운영 매핑 `ALIGO_TEMPLATE_CODES_JSON`(Railway 저장값)은 일치한다.
- 실행 중인 운영 API 프로세스에는 ALIGO 변수가 아직 없다(8/23 이전 배포). 출시 배포 때 반영된다.
- ALIGO는 등록 IP만 허용한다. Railway 현재 요금제에 고정 송신 IP가 없어 Fixie 고정 IP 프록시(`ALIGO_OUTBOUND_PROXY_URL`)를 거친다. 2026-09-28 운영 컨테이너 조회에서 `code=0`, 템플릿 8종 API 기준 글자 단위 일치를 확인했다.
- 격리 실발송: 알림톡은 휴대폰 도착까지 확인했다. 문자(SMS fallback)는 발신번호(`ALIGO_SENDER_PHONE`, 개인 휴대폰)가 통신사 번호도용 문자차단 서비스에 가입돼 차단된다 → 사업자 번호로 교체 필요.

### 5. Production activation

상태: production deployment `DONE`(2026-09-28) / activation `PRODUCTION_AUTHORITY_PENDING`.

출시 SHA `197f84a4`(원격 회차 E2E run `36372493414` 52/52 + 세션 12/12, cleanup 잔여 0)를 사용자 승인(Task 3.1)으로 배포했다. 순서는 API → 프런트 3개 → 규칙·인덱스다. 옛 프런트(8/11·8/23 배포본)가 Firestore를 직접 읽었으므로 규칙을 앱보다 먼저 배포하지 않았다.

| 대상 | 새 배포 | 이전(되돌리기) |
|---|---|---|
| API (Railway production) | `3f851757-ee67-48b2-9197-9eb29a2fb5db` SUCCESS | `aee6057b-8cac-4ba5-8613-607f21f19ab3` (`e55f2591`) |
| consumer (Vercel) | `dpl_79CBcA2hcxsUt88u2fQNv7NRfDWF` | `dpl_DmjsrFiKga82mHjvc7e3Srw3taQ5` |
| seller (Vercel) | `dpl_FXtMd6FkhLGZgikQD48mHjqXi7yg` | `dpl_5CdhRd1XAW7LFxUTiEe2HHY7qTqP` |
| driver (Vercel) | `dpl_FBSZWeeMnzSMM6njySy5DwNJT3gx` | `dpl_FZbbKMh362QGayFyeTNLTBSU5cKi` |
| Firestore 규칙 | ruleset `2562b836-5c66-4253-a672-023e7c580afc` | `32837978-27e9-4076-a953-b42e1838e2fa` (2026-07-31) |
| Storage 규칙 | ruleset `b723c937-fb80-4cfc-8bc8-d112b5177c26` | `798bd8ce-8f20-46a9-b8f3-648f3e2afe45` (2026-07-31) |

- 배포 뒤 확인: 배포 기록 SHA 일치, API health 200, 운영 도메인 주요 페이지 200, CORS 허용, 비인증 driver API 401, 5xx 없음, 규칙 재조회 저장소 일치, 인덱스 41개 반영(운영 전용 미사용 인덱스 1개 유지).
- 운영 규칙 반영으로 driver 전체 주문 읽기 등 7/31 이후 수정된 경계가 운영에서도 적용된다.
- 2026-09-28 운영 API `781285ea`(ALIGO 송신 프록시, 배포 `1e3e57b1…`), 판매자 앱 `437af74b`(새 회차 화면, `dpl_7bcozKG2bkMhoHWXMumUoH1B27Yr`, 이전 `dpl_FXtMd6FkhLGZgikQD48mHjqXi7yg`)로 갱신했다. 각 SHA는 원격 회차 E2E 52 + 세션 12를 통과했다(run `36383185604`, `36410582745`).
- 2026-09-30 API·프런트 3개를 `389066c8`로 갱신했다(프런트 PR #314~#320·#323·#332, API는 #332 요청사항 칸). 배포 전 같은 SHA exact Preview로 원격 회차 E2E 52 + 세션 12 통과, fixture 잔여 0(run `36727676723`). Railway 배포 `7f956a35…` SUCCESS·health 200, Vercel production consumer `dpl_4ByBmtSMWAsfEpJXSwT4DLF5mZQB`·seller `dpl_EgQY1EYSJjpk2vB6h4bXSbpWWbWn`·driver `dpl_A748dkEL9DU9hWSpuFhK48TFCRz6`, 배포 기록 SHA 일치, 운영 도메인 주요 페이지 200·CORS 정상·비인증 401. 롤백 대상: API `1e3e57b1…`(`781285ea`), consumer `dpl_79CBcA2hcxsUt88u2fQNv7NRfDWF`·seller `dpl_7bcozKG2bkMhoHWXMumUoH1B27Yr`·driver `dpl_FBSZWeeMnzSMM6njySy5DwNJT3gx`.
- 2026-10-03 API·프런트 3개를 `f89f9ed9`로 갱신했다. 포함: 회차 주문 경로의 자동 `OPEN` 판정(#326 — 저장값 `SCHEDULED`여도 `orderOpenAt` 경과 시 예약·장바구니 검증 통과, 첫 예약 때 `OPEN` 저장), Auth.js proxy 쿠키 반영과 refresh 회전 60초 유예(#333), 기사 연락처·Mantine CSS·카메라 정책(#327·#329·#331·#336·#337), 소비자 결제 재시도·MY 주문·손님 화면(#328·#330·#335), 자동 배포 끔(#339). 배포 전 같은 SHA exact Preview로 원격 회차 E2E 52 + 세션 12 통과·cleanup 성공(run `37023360349`). Railway 배포 `3272e92b…` SUCCESS·health 200, Vercel production consumer `dpl_5PkihD5zHMUAa14HWRxDH54cdueC`·seller `dpl_D3aUXpRxg5ZYgNzBhoQLhDYCP9j3`·driver `dpl_CriRnQ2sccPvj6LaLFqCEGzmifUH`, 운영 최신 배포 SHA 일치, 운영 도메인 주요 페이지 200·CORS 정상·비인증 401. 롤백 대상: API `7f956a35…`(`389066c8`), consumer `dpl_4ByBmtSMWAsfEpJXSwT4DLF5mZQB`·seller `dpl_EgQY1EYSJjpk2vB6h4bXSbpWWbWn`·driver `dpl_A748dkEL9DU9hWSpuFhK48TFCRz6`.
- 2026-10-04(아침) API·consumer·driver를 `f259b433`으로 갱신했다. 포함: 회차에 없는 상품 화면 개선(#382), 로그인 후 원래 화면 복귀(#377), 기사 앱 관리자 계정 차단(#381), ALIGO 알림톡·문자 HTTP 8초 시간 제한(#378), 기사 앱 API 시간 제한·명령 시간 초과 후 실제 상태 수렴(#379). seller는 코드 변경이 없어 `6628842b` 배포를 유지한다. 규칙·인덱스 변경 없음. 배포 전 같은 SHA exact Preview로 원격 회차 E2E run `37156347524`: 1차에 52/52 + 세션 12/12 통과. Railway 배포 `86d66af9…` SUCCESS·health 200, Vercel production consumer `dpl_EPSQ37VPh95yyzLVMvgeme3tZwyW`·driver `dpl_BfKcgzHxabu349hk85xtwJMmjqLQ`(seller는 빌드 생략 규칙으로 취소). 운영 확인: 오렌지 글로우 상품 주소가 사진·설명과 "이번 회차에서 판매하지 않는 상품이에요" 안내를 보이고 구매 버튼 없음, 기사 로그인 200, 비인증 driver API 401. 대표 판매상품 3개는 사용자 결정으로 카카오톡 채널 승인 전까지 바꾸지 않는다. 롤백 대상: API `073908bd…`(`53f8e374`), consumer `dpl_8fhnwLHXdwxuZL2Z8yqUonBFn6bj`·driver `dpl_7SkzbqrsYtEA8FFUai61ZfCGaSZz`(`6628842b`).
- 2026-10-04(새벽) consumer·seller를 `6628842b`로 갱신했다. 포함: 판매자 머리줄 겹침·기준 밖 색 정리(#370), 회차 노란 마감 띠·연두 요약·노랑 연한 변형 글자색(#371), Mantine 글자 크기=디자인 토큰(xs 13·sm 15)·소비자 작은 설명 글씨 15px·결제 주문 정보 흰 카드(#373), MY 주문 썸네일(#374), 홈 footer 개편(#375), round 없는 상품 주소를 공개 현재 회차 상품으로 연결(#376), 주문 상세 "주문자" 라벨(#369). API·driver는 코드 변경이 없어 각각 `53f8e374`·`aa713e12` 배포를 유지한다. 규칙·인덱스 변경 없음. 배포 전 같은 SHA exact Preview로 원격 회차 E2E run `37154470721`: 1차에 52/52 + 세션 12/12 통과. Vercel production consumer `dpl_8fhnwLHXdwxuZL2Z8yqUonBFn6bj`·seller `dpl_5qiPrx9uYATyKRg4Gu9RhfPjrwgV`(driver는 빌드 생략 규칙으로 취소). 운영 확인: 홈 대표 판매상품 빅립·만천홍은 11월 10일 배송 회차로 연결되고, 오렌지 글로우는 현재 회차에 없어 "이번 회차에서 판매하지 않는 상품이에요" 안내, 새 footer 반영, 판매자 로그인 200. 롤백 대상: consumer `dpl_7PUDZbCYBZuiQ27v7zUmJmDBtGiv`(`0ea8b52b`), seller `dpl_7B7TFhLJGw7aUy5N4wkZ1Y73wm8J`(`aa713e12`).
- 2026-10-03(밤) consumer를 `0ea8b52b`로 갱신했다. 포함: 한국어 404 화면(#367, 없는 주소·내려간 상품). API 코드 변경이 없어 API는 `53f8e374` 배포를 유지한다. 규칙·인덱스 변경 없음. 배포 전 같은 SHA exact Preview로 원격 회차 E2E run `37116860727`: 1차에 52/52 + 세션 12/12 통과. Vercel production consumer `dpl_7PUDZbCYBZuiQ27v7zUmJmDBtGiv`. seller·driver는 빌드 생략 규칙으로 취소돼 `aa713e12` 배포가 계속 서비스한다. 운영에서 `/no-such-page` 404와 내려간 상품 주소가 한국어 안내를 보이고 홈이 정상임을 브라우저로 확인했다. 운영 데이터 변경: `banners/main_hero.isActive`를 false로 바꿨다(배너 내용 보존, 어드민 배너 탭에서 다시 켤 수 있음). 롤백 대상: consumer `dpl_6VFMSqKwksK2KPQoVupuWzgMMUVe`(`53f8e374`).
- 2026-10-03(저녁) API·consumer를 `53f8e374`로 갱신했다. 포함: 홈 배너 겹침 수정(#365). 규칙·인덱스 변경 없음. 배포 전 같은 SHA exact Preview로 원격 회차 E2E run `37111848578`: 1차에서 세션 1건(chromium driver 로그아웃 뒤 세션 재생성) 실패 → 실패 작업만 재실행해 52/52 + 세션 12/12 통과(BACKLOG `AUTH-SIGNOUT-SESSION-RESURRECTION-FLAKE` 두 번째 관측). Railway 배포 `073908bd…` SUCCESS·health 200, Vercel production consumer `dpl_6VFMSqKwksK2KPQoVupuWzgMMUVe`. seller·driver 운영 배포는 빌드 생략 규칙(`scripts/vercel/ignore-build.mjs`, 두 앱 관련 변경 없음)으로 취소돼 같은 코드의 `aa713e12` 배포가 계속 서비스한다. 운영 홈에서 새 배너 배치 반영과 "공구 참여하기" 미노출을 확인했다. 운영 데이터 변경: `banners/main_hero.cta2`를 빈 값으로 바꿨다(이전 값 "공구 참여하기 " → `/groupbuy`). 롤백 대상: API `1a8b032d…`(`aa713e12`), consumer `dpl_9kwxyHT7SG84gbYbikt6o7P8JM9z`.
- 2026-10-03(오후) API·프런트 3개를 `aa713e12`로 갱신했다. 포함: 프런트 디자인 개편(#343~#356, 새 색·글꼴 기준과 소비자 회차 구매 동선 7화면, 판매자 어드민 넓은 레이아웃·상태 색), 새 로고·앱 아이콘(#358, Nunito "Green Love"·두 잎 하트), ALIGO 영구 오류 처리(#357), 기사 지도·상세·사진 업로드(#359~#361), 소비자 모바일 결제 리다이렉트 처리(#362). 규칙·인덱스 변경 없음. 배포 전 같은 SHA exact Preview로 원격 회차 E2E run `37108803974`: 1차에서 세션 1건(mobile seller 로그아웃 뒤 세션 재생성) 실패 → 같은 Preview로 실패 작업만 재실행해 52/52 + 세션 12/12 통과(BACKLOG `AUTH-SIGNOUT-SESSION-RESURRECTION-FLAKE`). Railway 배포 `1a8b032d…` SUCCESS·health 200, Vercel production consumer `dpl_9kwxyHT7SG84gbYbikt6o7P8JM9z`·seller `dpl_7B7TFhLJGw7aUy5N4wkZ1Y73wm8J`·driver `dpl_DvqHy3NzPmjideZ4zuJQSkzs99V8`, 운영 최신 배포 SHA 일치, 운영 주요 페이지·새 아이콘·글꼴·대체 그림 200, CORS 정상, 비인증 driver API 401. 롤백 대상: API `3272e92b…`(`f89f9ed9`), consumer `dpl_5PkihD5zHMUAa14HWRxDH54cdueC`·seller `dpl_D3aUXpRxg5ZYgNzBhoQLhDYCP9j3`·driver `dpl_CriRnQ2sccPvj6LaLFqCEGzmifUH`.
- **activation(2026-09-29)**: 첫 회차 `e8ca686f-a9db-4c6b-8ebf-2bf190351a3c` "10월 6일 배송 회차"를 판매자 앱에서 만들어 `SCHEDULED`로 예약했다(주문 10/1 목 10:00 ~ 10/5 월 00:00, 경매 10/5 07:00, 배송 10/6 00:00~09:00, 경기도 이천시, 배송지 15곳·수량 30개, 빅립 30,000·만천홍 25,000·v3 45,000원 각 10개). 2026-09-29 파일럿 연기에 맞춰 같은 회차를 "11월 10일 배송 회차"(주문 11/1 일 10:00 ~ 11/9 월 00:00, 경매 11/9 07:00, 배송 11/10 00:00~09:00)로 옮겼다(`SCHEDULED` 유지, 공개 API 반영 확인). 사용자 승인으로 `salesMode`를 `legacy → round_direct`로 전환했고(dry-run 대상 1곳 확인 후 `--confirm` 적용), 공개 회차 API에서 회차와 상품 3개를 확인했다. 전환 시점 미해결 운영 예외 0건.
- 회차 상태는 조회 시 계산된다: `SCHEDULED`는 `orderOpenAt` 경과 시 자동 `OPEN`, `orderCloseAt` 경과 시 자동 `CLOSED`다. 공개 회차에는 `SCHEDULED`도 노출된다.
- 롤백: `node scripts/enable-dear-orchid-round-direct.mjs --apply --target-mode=legacy --confirm=80189070-2c3d-45f2-bc11-68a870b13951:round_direct:legacy`
- live round 주문, 실제 결제·환불, first-round completion은 `NOT DONE`이다. 파일럿 운영은 2026-11-01로 연기했다.

### 6. Consumer self-cancel `ORDER_CANCELLED`

상태: `RESOLVED` — 2026-09-28 결정(D1)과 #310 구현.

소비자 회차 직접 취소도 `ORDER_CANCELLED`를 보낸다. 결제 전·이미 취소된 주문은 제외하고 사유는 고정 문구 `고객 요청`이다. 계약은 `docs/specs/api/notifications.md`가 소유한다.

### 7. Pilot marketing wording

상태: `DOC_DELTA_CANDIDATE`.

Pilot 정책은 `MARKETING_NOT_USED_IN_PILOT`이며, 선택 consent/retention wording만 문서에서 정규화한다. 새로운 runtime 사실이나 marketing 기능을 만들지 않는다.

## HISTORICAL / CLOSED BY REL-STATE-01

> 2026-09-28 재대조: 아래 P0의 구현·직접 회귀는 현재 `main`에 있다(결제 PAID guard, webhook 서명, 재배송 PAID 게이트, admin 강제환불·권한, 정산 lifecycle, auth 세션 폐기 근거 spec 7개 191건 통과, `firestore.rules`의 orders read는 seller·admin만 허용). 각 절의 "미완료" 서술은 당시 기록이다.

> 아래 과거 P0 서술은 #63의 `A-N closed semantic work` 분류에 따른 historical record다. 현재 release blocker, current implementation finding, current verification proof, remote-addressable candidate, PR, merged, Preview, production 상태를 이 기록만으로 추론하지 않는다.

> S2 → R1 campaign의 종료는 아래 broader release P0를 production-ready로 만들지 않으며, 닫힌 S2·S3A·S3B·S4 작업을 새로 재수용하지 않는다.

### 1. Driver 승인·세션 권한 — 최우선 security coupling

관리자 승인 전 driver 권한을 얻을 수 없어야 한다. 현재 accepted source에서 다음 approval-gate 하위 범위가 검증됐다.

- public `register(role=driver)`는 `driverApproved: false`를 저장하고 client approval 주입을 거부한다.
- public `register → login`의 false/missing approval driver는 token side effect 전에 거부된다.
- 신규/legacy Kakao driver 자동승인이 제거됐고, JWT strategy/Firebase custom-token 경계가 current user 상태를 확인한다.

**S4 Driver/Auth Initial Gate = CLOSED**. `AUTH-SESSION-CLAIM-REVOCATION`의 refresh/stale-claim/session lifecycle은 **OPEN**이며, broad driver Firestore read와 결합 위험도 남는다.

이 P0는 broad driver Firestore read가 남아 있는 `ORDER-DIRECT-READ-AUTHORIZATION-AND-MINIMIZATION`과 결합 위험이 크므로 우선 함께 닫는다.

정본: `docs/specs/api/auth.md`; 증거: `docs/reports/REPORT_auth_orders_admin_verification_audit_20260824.md`.

### 2. 주문 direct Firestore read·개인정보 최소화

API driver read는 배정 경계가 있고 직접 테스트로 `VERIFIED`지만 current Rules는 driver role에 broad order read를 허용하며 seller/driver frontend는 raw document를 사용한다.

**시스템 전체 driver read authorization + seller/driver data minimization = P0 IMPLEMENTATION FINDING**.

API query authorization 자체는 `VERIFIED`를 유지하며 direct Firestore 경계와 혼동하지 않는다.

### 3. 재배송비 결제·재개 상태머신

운영 계약은 고객 책임 유료 재배송에서 `결제 전 재배송 금지`를 요구한다.

2026-08-24 감사에서 다음 두 우회/불일치가 확인됐다.

- driver `DELIVERY_HELD → DELIVERING`: charge `PAID` 확인 없음 + UI `배송 재개` 항상 노출.
- seller `DELIVERY_HELD → PREPARING`: 고객 책임+양수 재배송비에서도 성공하며 hold를 해소하지만, charge 생성 API와 consumer 결제 UI는 `status === DELIVERY_HELD`를 요구해 payment-request 뒤 결제 dead-end가 가능하다. 이후 `PREPARING → DELIVERING`도 과거 미결제 hold를 확인하지 않는다.

따라서 **`ORDER-REDELIVERY-PAID-RESUME-GATE` = P0 재배송 상태머신 `IMPLEMENTATION FINDING`**이다.

정본: `docs/specs/api/orders.md`, `docs/BACKLOG.md`, 운영 근거 `docs/specs/ops/mvp-sales-round-runbook.md`.

### 4. 관리자 강제 환불 lifecycle

admin refund는 본 결제 환불 뒤 주문을 직접 `CANCELLED` write하며 정상 cancellation의 추가 charge·reservation/capacity·held counter·settlement 후속효과를 재사용하지 않는다.

**`ADMIN-FORCE-REFUND-CONSISTENCY` = P0 IMPLEMENTATION FINDING**.

### 5. Admin privileged mutation coverage

`AdminController`의 JWT + admin role guard와 `markAsPaid()` transaction 구현은 존재한다. 그러나 admin 전용 server unit/API E2E가 없고 현재 Playwright admin 테스트는 UI redirect/read smoke 중심이라 high-impact mutation의 non-admin 직접 거부·side-effect 0 및 settlement 지급 상태/race를 직접 고정하지 않는다.

**`ADMIN-PRIVILEGED-MUTATION-COVERAGE` = IMPLEMENTED / UNVERIFIED + P0 COVERAGE GAP**.

정본: `docs/specs/api/admin.md`, `docs/specs/api/settlements.md`; 증거: `docs/reports/REPORT_auth_orders_admin_verification_audit_20260824.md`.

### 6. Settlement core lifecycle coverage

`SettlementsService`는 transaction 기반 생성·`pending → confirmed`·취소·paid 역전 방지를 구현한다. 회차 E2E fixture도 실제 service를 주입한다.

그러나 전용 settlement lifecycle test가 없고 회차 통합 E2E도 settlement 생성 1건, 중복 방지, confirm cutoff/race, cancel/paid 보존을 직접 assertion하지 않는다. 실제 service의 간접 실행은 core 금전 상태의 직접 증거로 세지 않는다.

**`SETTLEMENT-LIFECYCLE-COVERAGE` = IMPLEMENTED / UNVERIFIED + P0 COVERAGE GAP**.

Admin `confirmed → paid`는 기존 `ADMIN-PRIVILEGED-MUTATION-COVERAGE`가 별도로 소유한다.

정본: `docs/specs/api/settlements.md`; 증거: `docs/reports/REPORT_settlements_notifications_legal_ops_audit_20260824.md`.

### 7. 역사적 marketing consent lifecycle finding

round checkout에는 선택 마케팅 consent가 있고 consent retention record도 생성한다. 반면 MY 설정은 별도 `users.notificationPreferences`만 사용하고, checkout consent는 이를 동기화하지 않으며 신규 user 기본 preference도 없다. “즉시 철회”는 preference만 false로 바꾸고 withdrawal retention evidence를 남기지 않는다.

현재 실제 선택 마케팅 sender는 확인되지 않았고, 주문·결제·배송 정보성 연락은 선택 마케팅과 별개의 계약이다.

**`MARKETING-CONSENT-LIFECYCLE-CONSISTENCY` = historical P0 finding**. 현재 Pilot 정책은 `MARKETING_NOT_USED_IN_PILOT`이며, 이 기록으로 현재 implementation blocker나 marketing runtime을 주장하지 않는다.

MVP에서 마케팅을 사용하지 않으면 consent 수집/설정 노출을 비활성화·제거하는 선택도 가능하고, 유지한다면 user-level SSOT + checkout sync + withdrawal evidence + sender gating을 구현한다.

정본: `docs/specs/api/notifications.md`, `docs/specs/legal/README.md`; 증거: `docs/reports/REPORT_settlements_notifications_legal_ops_audit_20260824.md`.

### 8. 결제 finalization provider 상태 방어

`finalizePaidOrder()` boundary가 비`PAID` provider 입력을 자체 차단하지 않는다.

**`PAYMENT-FINALIZATION-PAID-GUARD` = P0 IMPLEMENTATION FINDING**.

### 9. PortOne webhook signature 검증 coverage

webhook signature 구현은 raw body + id/timestamp/signature, timestamp ±5분, HMAC SHA-256 timing-safe 검증을 사용한다. 그러나 현재 회차 E2E의 signature verifier는 mock이며 real verifier의 valid HMAC 성공·non-empty invalid HMAC 거부·body/id/timestamp 변조 거부를 직접 고정한 증거가 부족하다.

**`PAYMENT-WEBHOOK-SIGNATURE-COVERAGE` = IMPLEMENTED / PARTIALLY VERIFIED + P0 COVERAGE GAP**. 구현 결함으로 단정하지 않는다.

정본: `docs/specs/api/payments.md`; 증거: `docs/reports/REPORT_payment_webhook_signature_coverage_20260824.md`.

### 10. 주문 mutation authorization 회귀

ownership guard는 구현돼 있으나 타-store seller·비담당 driver·first-claim 외 action과 거부 side-effect 0 직접 회귀가 부족하다.

**`ORDER-MUTATION-AUTHORIZATION-COVERAGE` = IMPLEMENTED / UNVERIFIED + P0 COVERAGE GAP**.

### 11. GitHub main protection

repo-side 배포 방어와 GitHub main 보호를 직접 재확인했다. `protected=true`, PR required, strict `verify` required check, force-push·delete 차단이며 Issue #32는 `CLOSED`다.

## ALIGO 상태

현재 상태:

- repository logical 8-code contract: `VERIFIED` — #65에서 8개 logical code/body/required-variable 계약을 확인했다.
- provider 템플릿 metadata: `VERIFIED`(2026-09-28 콘솔) — UK_5691~5698 코드·이름·승인완료·본문·변수가 저장소 계약과 일치하고, 채널 `@greenlove`는 정상, 버튼은 없다. 템플릿 대체문자는 `발송안함`이며 SMS fallback은 코드가 별도로 수행한다.
- production mapping: Railway production 변수 `ALIGO_TEMPLATE_CODES_JSON`이 8종을 올바른 코드로 매핑한다. 다만 실행 중인 운영 API 프로세스에는 아직 반영되지 않았다(8/23 이전 배포).
- 운영 송신 IP: Railway 송신 IP는 재배포로 바뀐다(`152.55.176.19` → `152.55.177.34`). 그래서 ALIGO 호출은 Fixie 고정 IP 2개를 거치며, 두 IP를 ALIGO 허용 IP에 등록했다(2026-09-28, 조회 `code=0`). Railway Pro 전환 시에는 고정 IP 3개를 먼저 추가 등록한 뒤 `ALIGO_OUTBOUND_PROXY_URL`을 삭제한다.
- actual Alimtalk: 2026-09-28 격리 시험(`ORDER_PREPARING`, 가짜 주문번호 `TEST-0928`)에서 `@greenlove` 채널로 휴대폰 도착 확인. 첫 시도는 ALIGO 선불 잔액 부족으로 거부됐고 충전 뒤 성공했다.
- actual SMS: ALIGO 접수 뒤 `이통사 번호도용문자차단서비스에 가입된 발신번호 사용`으로 차단. 사업자 번호를 ALIGO 발신번호로 추가 등록(통신서비스 이용증명원 필요)하고 승인 뒤 `ALIGO_SENDER_PHONE`을 교체한 다음 재시험한다. 새 번호가 승인되기 전에 변수를 바꾸면 알림톡 요청에도 같은 발신번호가 쓰여 실패한다.

### 역사적 provider snapshot

마지막 provider snapshot — 2026-08-27 15:06 KST 경:

- 발신 프로필·senderkey 준비 완료.
- 회차 알림 템플릿 8종 등록·심사 요청 완료.
- 8종 모두 `승인완료`.
- provider 심사 외부 blocker 해소.
- 실제 알림톡·SMS 발송 0건.
- production ALIGO 자격 증명·매핑 미반영.

승인 템플릿:

- `UK_5691` 주문 접수
- `UK_5692` 상품 준비 시작
- `UK_5693` 배송 시작
- `UK_5694` 배송 보류
- `UK_5695` 재배송비 결제 요청
- `UK_5696` 재배송 예정
- `UK_5697` 배송 완료
- `UK_5698` 주문 취소

코드 레벨 알림톡 3회 retry→SMS fallback, 설정 fail-closed, notification delivery idempotency는 직접 테스트가 있다. 이를 실제 provider 발송 증거로 확장하지 않는다.

승인 증거: `docs/reports/REPORT_aligo_template_approval_20260827.md`.

위 snapshot은 현재 provider metadata read-back이 아니다. 다음 ALIGO gate는 provider code 1:1 매핑 확인 → 승인된 템플릿 격리 알림톡 → SMS fallback 실제 검증이며, 실제 발송과 production 설정은 별도 승인 없이는 수행하지 않는다.

## 판매 활성화 legal 상태

- production `/privacy`, `/terms`는 2026-08-19 비판매 상태 기준.
- 실제 판매 전 주문·취소·환불·재배송비·보류, PortOne/PG, ALIGO, seller/driver 개인정보 접근을 재정합화해야 한다.
- 2026-08-19 consumer legal baseline의 “마케팅 수신 동의 기능 없음” 사실은 현재 코드와 달라 `docs/specs/legal/README.md`의 2026-08-24 errata가 해당 구현 사실을 우선한다.
- Pilot marketing policy는 `MARKETING_NOT_USED_IN_PILOT`이다. 이 문서화는 marketing runtime sender, consent lifecycle, provider 상태를 새로 주장하지 않는다.
- broad read를 legal 문구로 정당화하지 않는다.
- 재배송 payment-required 상태머신과 admin refund 실제 정책을 legal의 재배송비·환불 설명에 반영한다.
- settlement 생성·확정·취소·지급 검증 결과와 Pilot `MARKETING_NOT_USED_IN_PILOT` wording을 legal 확정 전에 반영한다.

## 검증 상태

- 최근 원격 회차 E2E: run `37023360349`(현재 운영 SHA `f89f9ed9`) 52/52 + 세션 12/12, cleanup 성공. 운영에 나갈 SHA가 바뀌면 그 SHA로 다시 판정한다.
- 이전 운영 SHA 증거: 출시 `197f84a4` run `36372493414`, API `781285ea` run `36383185604`, 판매자 앱 `437af74b` run `36410582745`(각 52/52 + 세션 12/12, cleanup 0).
- 이전 역사 증거: SHA `6e0fc9d4cec08073ed2504208cc8bb1ea395ee7d`, run `32351887404`(52건).
- 과거 run을 현재 release 증거로 확장하지 않는다.
- exact-SHA Preview/browser/fixture와 필요한 legal/release proof는 actual release candidate에서 다시 판정한다.

## 활성 문서

- 라우팅: `docs/README.md`
- 정합성 기준: `docs/DOCUMENT_CONSISTENCY.md`
- 작업 규칙: `AGENTS.md`
- Context router: `docs/PROJECT_MAP.md`
- 상태 SSOT: 이 문서
- 미완료: `docs/BACKLOG.md`
- 재개: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`
- 출시 의존성: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`
- 배포 안전: `docs/plans/PLAN_deployment_safety_guards_20260823.md`
- legal gate: `docs/specs/legal/README.md`

## 승인 경계

명시적 승인 없이 ALIGO 실제 발송/설정, production 환경변수·Firebase·운영 데이터 변경, Railway/Vercel production 배포·rollback, 운영 회차/`salesMode`, 실제 결제·환불을 실행하지 않는다.

## 다음 작업

1. 파일럿 시작(2026-11-01) 전 프런트엔드 점검: 첫 회차는 `orderOpenAt`(11/1 10:00)에 자동 `OPEN`된다. 일정을 다시 미루면 그 전에 회차 일정을 옮긴다. 결정 3건(`ADMIN-CANCELLED-REFUND-RETRY`·`SELLER-ORDER-LIST-BUYER-INFO`·`ADMIN-DESKTOP-TABLE-IN-480-SHELL`)도 파일럿 전에 정한다.
2. SMS 발신번호를 사업자 번호로 교체하고 문자 재시험. 사업자 번호를 ALIGO 발신번호로 추가 등록해 승인 대기 중이다(2026-10-02). 승인 전에 `ALIGO_SENDER_PHONE`을 바꾸면 알림톡도 실패하므로 승인 확인 뒤 바꾼다.
3. 파일럿 시작 직후 실제 결제 1건(결제 → 접수 알림톡 → 소비자 취소·환불 → 취소 알림톡)으로 운영 PortOne 경로를 확인한다. 결제는 지금까지 E2E 모의 결제로만 검증됐다.
4. 운영 배포는 검증된 SHA를 지정해 API → 프런트 → 규칙 순으로 한다. Railway UI "Deploy"는 `main` HEAD를 배포하므로 병합 후 미검증 코드가 나갈 수 있다.
5. Pilot `MARKETING_NOT_USED_IN_PILOT`와 legal/source wording을 문서 범위에서 정합화한다.
